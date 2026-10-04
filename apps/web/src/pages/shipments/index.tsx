import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { ExternalLink, RefreshCw, Truck, Wallet } from 'lucide-react';
import type { CarrierPhase, VnpShipmentRecord, VnpShipmentStats } from 'shared';
import { CARRIER_PHASES, carrierPhaseOf, VNP_SHIPMENT_RECORD_STATUSES } from 'shared';

import { PATHS } from '@/constants/paths';

import { RepositoryRemote } from '@/services';

import { DateRangePicker } from '@/components/common/DateRangePicker';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useDebounce } from '@/hooks/useDebounce';
import { usePermission } from '@/hooks/usePermission';

const PAGE_SIZE = 20;
const selectCls = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

const STATUS_BADGE_CLS: Record<string, string> = {
  purchasing: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  created: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  in_transit: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  cancelling: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  cancelled: 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300',
  failed: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('shipments');
  return (
    <span
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium',
        STATUS_BADGE_CLS[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {t(`status.${status}`, { defaultValue: status })}
    </span>
  );
}

/** Carrier ladder colours (legacy shipment_status): blue = moving, green = done, red = problem. */
const PHASE_BADGE_CLS: Record<CarrierPhase, string> = {
  processing: 'bg-muted text-muted-foreground',
  picked_up: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  processed: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  in_transit: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  out_for_delivery: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  delivery_attempt: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  exception: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  other: 'bg-muted text-muted-foreground',
};

/** Bảng bucket nhỏ (theo tháng / xưởng / service) trong dashboard chi phí. */
function BucketTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label?: string; count: number; cost: number }>;
}) {
  const { t } = useTranslation('shipments');
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold">{title}</div>
      <table className="w-full text-xs">
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="px-3 py-2 text-muted-foreground">—</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.key || '(empty)'} className="border-b border-border/50 last:border-0">
              <td className="px-3 py-1.5">{r.label ?? (r.key || '—')}</td>
              <td className="px-3 py-1.5 text-right text-muted-foreground">
                {r.count} {t('stats.count').toLowerCase()}
              </td>
              <td className="px-3 py-1.5 text-right font-mono">{r.cost.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Trang quản lý vận đơn `/adm/shipments` (CHỈ Admin/SuperAdmin — mọi bề mặt
 * VNP đều admin-only, VnpShipping.md §7): số dư ví + dashboard chi phí
 * (`GET /shipping-vnp/shipments/stats`) + list bảng `shipments` (search/filter
 * status) + click hàng mở timeline sự kiện tracking. Sự kiện do cron poll
 * 2 lần/ngày ghi (`GET /shipping-vnp/tracking/cron`) hoặc bấm tay Tra tracking.
 */
export default function ShipmentsPage() {
  const { isAdmin } = usePermission();
  if (!isAdmin) return <Navigate to={PATHS.HOME} replace />;
  return <ShipmentsContent />;
}

function ShipmentsContent() {
  const { t } = useTranslation('shipments');

  // ── Ví ──────────────────────────────────────────────────────────────────
  const [wallet, setWallet] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const loadWallet = useCallback(async () => {
    try {
      setWalletBusy(true);
      const res = await RepositoryRemote.vnpShipping.getWallet();
      setWallet((res.data?.data as { balance?: string })?.balance ?? null);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setWalletBusy(false);
    }
  }, []);
  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  // ── Dashboard chi phí ────────────────────────────────────────────────────
  const [stats, setStats] = useState<VnpShipmentStats | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    RepositoryRemote.vnpShipping
      .getShipmentStats({ from: from || undefined, to: to || undefined })
      .then((res) => setStats(res.data?.data as VnpShipmentStats))
      .catch(() => setStats(null));
  }, [from, to]);

  // ── List ─────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<VnpShipmentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState<CarrierPhase | ''>('');
  const debouncedSearch = useDebounce(search, 300);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, phase, from, to]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await RepositoryRemote.vnpShipping.listShipments({
          page,
          size: PAGE_SIZE,
          search: debouncedSearch || undefined,
          status: status || undefined,
          carrierPhase: phase || undefined,
          // One date range drives both the cost dashboard and the list (legacy date buttons).
          from: from || undefined,
          to: to || undefined,
        });
        if (cancelled) return;
        setRows((res.data?.data as VnpShipmentRecord[]) ?? []);
        setTotal((res.data?.total as number) ?? 0);
      } catch (err) {
        if (!cancelled) handleAxiosError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, debouncedSearch, status, phase, from, to, reloadTick]);

  const [selected, setSelected] = useState<VnpShipmentRecord | null>(null);

  const statCards = useMemo(
    () =>
      stats
        ? [
            { key: 'total', value: String(stats.totals.count) },
            { key: 'cost', value: stats.totals.cost.toFixed(2) },
            {
              key: 'sellerRevenue',
              value: `${(stats.totals.sellerRevenue ?? 0).toFixed(2)} (${stats.totals.sellerLabelCount ?? 0})`,
            },
            {
              key: 'sellerMargin',
              value: ((stats.totals.sellerRevenue ?? 0) - (stats.totals.sellerCost ?? 0)).toFixed(2),
            },
            { key: 'active', value: String(stats.totals.active) },
            { key: 'delivered', value: String(stats.totals.delivered) },
            { key: 'cancelled', value: String(stats.totals.cancelled) },
          ]
        : [],
    [stats],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Truck size={20} />}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Wallet size={16} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t('wallet.title')}:</span>
            <span className="text-sm font-mono font-semibold">
              {walletBusy ? '…' : (wallet ?? t('wallet.unknown'))}
            </span>
            <Button size="sm" variant="ghost" className="h-7 px-2" disabled={walletBusy} onClick={loadWallet}>
              <RefreshCw size={13} />
            </Button>
          </div>
        }
      />

      {/* ── Dashboard chi phí ── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            variant="inline"
            from={from}
            to={to}
            onChange={(f, tt) => {
              setFrom(f);
              setTo(tt);
            }}
          />
          <span className="text-[11px] text-muted-foreground">{t('stats.costNote')}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {statCards.map((c) => (
            <div key={c.key} className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{t(`stats.${c.key}`)}</div>
              <div className="text-lg font-semibold font-mono">{c.value}</div>
            </div>
          ))}
        </div>
        {stats && (
          <div className="grid gap-2 md:grid-cols-3">
            <BucketTable title={t('stats.byMonth')} rows={stats.byMonth} />
            <BucketTable
              title={t('stats.byFactory')}
              rows={stats.byFactory.map((r) => ({ ...r, label: r.factoryName ?? (r.key || t('stats.noFactory')) }))}
            />
            <BucketTable title={t('stats.byService')} rows={stats.byService} />
          </div>
        )}
      </section>

      {/* ── List ── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-9 w-80"
            placeholder={t('filter.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('filter.allStatuses')}</option>
            {VNP_SHIPMENT_RECORD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => setReloadTick((n) => n + 1)}>
            <RefreshCw size={13} />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" title={t('filter.phaseHint')}>
          {(['', ...CARRIER_PHASES] as const).map((p) => (
            <button
              key={p || 'all'}
              type="button"
              onClick={() => setPhase(p)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                phase === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted',
              )}
            >
              {t(`phase.${p || 'all'}`)}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.createdAt')}</TableHead>
                <TableHead>{t('table.package')}</TableHead>
                <TableHead>{t('table.items')}</TableHead>
                <TableHead>{t('table.shipTo')}</TableHead>
                <TableHead>{t('table.tracking')}</TableHead>
                <TableHead>{t('table.service')}</TableHead>
                <TableHead className="text-right">{t('table.cost')}</TableHead>
                <TableHead className="text-right">{t('table.sellerPrice')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                <TableHead>{t('table.label')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center">
                    <Spinner />
                  </TableCell>
                </TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    {t('table.empty')}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((rec) => (
                <TableRow key={rec._id} className="cursor-pointer" onClick={() => setSelected(rec)}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {rec.createdAt ? dayjs(rec.createdAt).format('DD/MM/YYYY HH:mm') : '—'}
                    {/* Creator folded under the date: one column less, no horizontal scroll at 1440 px. */}
                    {rec.createdByUserName && <div className="text-muted-foreground">{rec.createdByUserName}</div>}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-mono">{rec.package?.code ?? rec.packageId}</div>
                    <div className="text-muted-foreground">
                      {(rec.package?.productionIds ?? []).slice(0, 3).join(', ')}
                      {(rec.package?.productionIds?.length ?? 0) > 3
                        ? ` +${(rec.package?.productionIds?.length ?? 0) - 3}`
                        : ''}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {(rec.items ?? []).slice(0, 2).map((it) => (
                      <div key={it.productionId} className="max-w-[200px] truncate">
                        {[it.type, [it.color, it.size].filter(Boolean).join('/')].filter(Boolean).join(' · ') || it.productionId}
                      </div>
                    ))}
                    {(rec.items?.length ?? 0) > 2 && (
                      <div className="text-muted-foreground">{t('table.moreItems', { count: (rec.items?.length ?? 0) - 2 })}</div>
                    )}
                    {!rec.items?.length && '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {rec.shipTo ? (
                      <>
                        <div className="max-w-[180px] truncate">{[rec.shipTo.firstName, rec.shipTo.lastName].filter(Boolean).join(' ') || '—'}</div>
                        <div className="max-w-[180px] truncate text-muted-foreground">
                          {[rec.shipTo.city, [rec.shipTo.state, rec.shipTo.postcode].filter(Boolean).join(' '), rec.shipTo.country].filter(Boolean).join(', ')}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{rec.trackingCode ?? '—'}</TableCell>
                  <TableCell className="text-xs">{rec.service ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{rec.shippingCost ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {rec.sellerPrice != null ? `$${rec.sellerPrice.toFixed(2)}` : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={rec.status} />
                      {(() => {
                        const p = carrierPhaseOf(rec);
                        return p ? (
                          <span
                            title={rec.lastTrackingStatus}
                            className={cn('inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium', PHASE_BADGE_CLS[p])}
                          >
                            {t(`phase.${p}`)}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {rec.labelUrl && rec.status !== 'cancelled' && (
                      <a
                        href={rec.labelUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary underline"
                      >
                        <ExternalLink size={12} /> {t('timeline.openLabel')}
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationBar
            position="bottom"
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            loading={loading}
            onChange={(p) => setPage(p)}
          />
        </div>
      </section>

      {/* ── Timeline dialog ── */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('timeline.title', { code: selected?.trackingCode ?? selected?.package?.code ?? '' })}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selected.status} />
                {selected.lastTrackingStatus && (
                  <span className="text-muted-foreground">
                    {t('timeline.lastStatus')}: {selected.lastTrackingStatus}
                  </span>
                )}
                {selected.labelUrl && selected.status !== 'cancelled' && (
                  <a
                    href={selected.labelUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-primary underline"
                  >
                    <ExternalLink size={12} /> {t('timeline.openLabel')}
                  </a>
                )}
              </div>
              {selected.scannedAt && (
                <div className="text-muted-foreground">
                  {t('timeline.scannedAt')}: {dayjs(selected.scannedAt).format('DD/MM/YYYY HH:mm')}
                </div>
              )}
              {selected.carrierNote && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-amber-800 dark:text-amber-200">
                  {t('timeline.carrierNote')}: {selected.carrierNote}
                </div>
              )}
              {selected.failReason && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
                  {t('timeline.failReason')}: {selected.failReason}
                </div>
              )}
              {selected.balanceAfter && (
                <div className="text-muted-foreground">
                  {t('timeline.balanceAfter')}: <span className="font-mono">{selected.balanceAfter}</span>
                </div>
              )}
              <ol className="space-y-1.5 border-l border-border pl-3">
                {selected.createdAt && (
                  <li>
                    <span className="text-muted-foreground">{dayjs(selected.createdAt).format('DD/MM/YYYY HH:mm')}</span>{' '}
                    — {t('timeline.created')}
                    {selected.createdByUserName ? ` · ${selected.createdByUserName}` : ''}
                  </li>
                )}
                {(selected.trackingEvents ?? []).map((ev, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{dayjs(ev.at).format('DD/MM/YYYY HH:mm')}</span> —{' '}
                    {ev.status ?? '?'}
                  </li>
                ))}
                {selected.cancelledAt && (
                  <li className="text-rose-600">
                    <span className="text-muted-foreground">
                      {dayjs(selected.cancelledAt).format('DD/MM/YYYY HH:mm')}
                    </span>{' '}
                    — {t('timeline.cancelled')}
                  </li>
                )}
              </ol>
              {(selected.trackingEvents ?? []).length === 0 && !selected.cancelledAt && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground">
                  {t('timeline.empty')}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
