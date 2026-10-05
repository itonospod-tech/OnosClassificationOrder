import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { AlertOctagon, CalendarClock, ChevronLeft } from 'lucide-react';
import type { StaleCleanupPreview, StaleCleanupRunResult, StaleOpenGroup, StaleOpenOrderRow, WorkshopStageFilterKey } from 'shared';
import { OPEN_ORDER_STALE_DAYS, PRODUCT_LINES, STALE_AGE_BUCKETS, STALE_CLEANUP_BATCH_MAX } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { StatCards } from '@/components/common/StatCards';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

import { STAGE_COLORS } from '../orders/workshop/stageColors';

type Summary = { total: number; byFactory: Array<{ factoryId: string; shortName?: string; count: number }>; withShippingEvidence: number; noActivity: number; neverProduced: number };
type View = 'orders' | 'type' | 'userSku';
type Filters = { factoryId: string; productLine: string; userSku: string; type: string; age: string };
const NO_FILTERS: Filters = { factoryId: '', productLine: '', userSku: '', type: '', age: '' };
const PAGE_SIZE = 50;
const fmt = (d?: Date | string | null) => (d ? dayjs(d).format('DD/MM/YYYY') : '');

/**
 * Stale-order cleanup (Orders.md §23b), SuperAdmin only, reached from the CEO Dashboard `staleOpen`
 * figure (no sidebar entry: a few-times tool, not daily work). Every row shows what the system knows
 * about whether the order was really finished; the preview re-checks every order on the server and
 * says plainly that the step cannot be undone and that the system has no delivery evidence.
 * Nothing is selected by default and a run is capped at STALE_CLEANUP_BATCH_MAX.
 */
export default function StaleOrdersPage() {
  const { t } = useTranslation('staleOrders');
  const { t: tOrders } = useTranslation('orders');
  const { roleName } = usePermission();

  const [view, setView] = useState<View>('orders');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StaleOpenOrderRow[]>([]);
  const [groups, setGroups] = useState<StaleOpenGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  // id → productionId: selection survives paging and filter changes.
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [previewOpen, setPreviewOpen] = useState(false);

  const query = useCallback(
    (extra: Record<string, string | number | undefined>) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));
      return '?' + p.toString();
    },
    [filters],
  );

  useEffect(() => {
    if (roleName !== 'SuperAdmin') return;
    let cancelled = false;
    setLoading(true);
    const extra = view === 'orders' ? { page, limit: PAGE_SIZE } : { page: 1, limit: PAGE_SIZE, groupBy: view };
    RepositoryRemote.order
      .getStaleOpen(query(extra))
      .then((res) => {
        if (cancelled) return;
        const body = res.data as { data: StaleOpenOrderRow[]; groups?: StaleOpenGroup[]; total: number; summary: Summary };
        setRows(body.data ?? []);
        setGroups(body.groups ?? []);
        setTotal(body.total ?? 0);
        setSummary(body.summary);
      })
      .catch(handleAxiosError)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [roleName, view, page, query, reload]);

  const setFilter = (k: keyof Filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const toggle = (r: StaleOpenOrderRow) => {
    if (!r.selectable) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r._id)) next.delete(r._id);
      else if (next.size >= STALE_CLEANUP_BATCH_MAX) toast.warning(t('selection.capReached', { max: STALE_CLEANUP_BATCH_MAX }));
      else next.set(r._id, r.productionId);
      return next;
    });
  };

  /** Adds the group's selectable orders, oldest first, up to the per-run cap. Never "select all". */
  const selectGroup = async (g: StaleOpenGroup) => {
    const room = STALE_CLEANUP_BATCH_MAX - selected.size;
    if (room <= 0) return toast.warning(t('selection.capReached', { max: STALE_CLEANUP_BATCH_MAX }));
    try {
      const key = view === 'type' ? 'type' : 'userSku';
      const res = await RepositoryRemote.order.getStaleOpen(query({ [key]: g.key, page: 1, limit: STALE_CLEANUP_BATCH_MAX }));
      const groupRows = ((res.data as { data: StaleOpenOrderRow[] }).data ?? []).filter((r) => r.selectable && !selected.has(r._id));
      const take = groupRows.slice(0, room);
      setSelected((prev) => new Map([...prev, ...take.map((r) => [r._id, r.productionId] as [string, string])]));
      toast.info(t('selection.groupAdded', { added: take.length, inGroup: g.selectable }));
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const openGroup = (g: StaleOpenGroup) => {
    setFilters((f) => ({ ...f, [view === 'type' ? 'type' : 'userSku']: g.key }));
    setView('orders');
    setPage(1);
  };

  if (roleName !== 'SuperAdmin') {
    return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">{t('noPermission')}</div>;
  }

  const factories = summary?.byFactory ?? [];
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4 pb-24">
      <PageHeader icon={<CalendarClock size={20} />} title={t('title')} description={t('description', { days: OPEN_ORDER_STALE_DAYS })} />

      <div role="alert" className="flex items-start gap-3 rounded-lg border-2 border-tone-danger bg-tone-danger/10 p-3 text-sm font-medium text-tone-danger">
        <AlertOctagon size={20} className="mt-0.5 shrink-0" />
        <span>{t('irreversible')}</span>
      </div>

      {summary && (
        <StatCards
          cols={4}
          items={[
            { key: 'total', label: t('summary.total'), value: summary.total.toLocaleString() },
            { key: 'evidence', label: t('summary.withEvidence'), value: summary.withShippingEvidence.toLocaleString(), tone: summary.withShippingEvidence ? 'success' : 'danger' },
            { key: 'noActivity', label: t('summary.noActivity'), value: summary.noActivity.toLocaleString(), tone: 'warning' },
            { key: 'never', label: t('summary.neverProduced'), value: summary.neverProduced.toLocaleString(), tone: 'warning' },
          ]}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm touch:min-h-11" value={filters.factoryId} onChange={(e) => setFilter('factoryId', e.target.value)} aria-label={t('filters.factory')}>
          <option value="">{t('filters.allFactories')}</option>
          {factories.map((f) => (
            <option key={f.factoryId} value={f.factoryId}>
              {(f.shortName || f.factoryId) + ` (${f.count})`}
            </option>
          ))}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm touch:min-h-11" value={filters.productLine} onChange={(e) => setFilter('productLine', e.target.value)} aria-label={t('filters.line')}>
          <option value="">{t('filters.allLines')}</option>
          {PRODUCT_LINES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm touch:min-h-11" value={filters.age} onChange={(e) => setFilter('age', e.target.value)} aria-label={t('filters.age')}>
          <option value="">{t('filters.allAges')}</option>
          {STALE_AGE_BUCKETS.map((a) => (
            <option key={a} value={a}>
              {t(`filters.age_${a}`)}
            </option>
          ))}
        </select>
        <Input className="w-36 max-md:w-full" placeholder={t('filters.customer')} value={filters.userSku} onChange={(e) => setFilter('userSku', e.target.value.trim())} />
        {filters.type && (
          <Button variant="outline" size="sm" onClick={() => setFilter('type', '')} className="max-w-full">
            <span className="truncate">{filters.type}</span> ×
          </Button>
        )}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
            {t('filters.clear')}
          </Button>
        )}
        <div className="ml-auto flex gap-1 max-md:ml-0 max-md:w-full">
          {(['orders', 'type', 'userSku'] as View[]).map((v) => (
            <Button key={v} size="sm" variant={view === v ? 'default' : 'outline'} className="max-md:flex-1" onClick={() => { setView(v); setPage(1); }}>
              {t(v === 'orders' ? 'view.orders' : v === 'type' ? 'view.byProduct' : 'view.byCustomer')}
            </Button>
          ))}
        </div>
      </div>

      {loading && rows.length === 0 && groups.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : view === 'orders' ? (
        rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <PaginationBar position="top" page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onChange={(p) => setPage(p)} />
            <ul className={cn('space-y-2', loading && 'opacity-60')}>
              {rows.map((r) => (
                <StaleRow key={r._id} row={r} checked={selected.has(r._id)} onToggle={() => toggle(r)} stageLabel={tOrders(`workshopBoard.stages.${r.stage}`, { defaultValue: r.stage })} />
              ))}
            </ul>
            <PaginationBar position="bottom" page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onChange={(p) => setPage(p)} />
          </>
        )
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.key || '—'} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="break-words font-medium">{g.key || '—'}</div>
                <div className="text-xs text-muted-foreground">
                  {t('group.orders', { count: g.count })} · {t('group.selectable', { count: g.selectable })}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => openGroup(g)}>
                <ChevronLeft size={14} className="rotate-180" /> {t('group.open')}
              </Button>
              <Button size="sm" variant="outline" disabled={!g.selectable} onClick={() => void selectGroup(g)}>
                {t('group.select')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Selection bar: fixed at the bottom of the viewport while something is selected. */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 shadow-lg backdrop-blur max-md:pb-[calc(env(safe-area-inset-bottom)+4.5rem)]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{t('selection.count', { count: selected.size, max: STALE_CLEANUP_BATCH_MAX })}</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
              {t('selection.clear')}
            </Button>
            <Button size="sm" className="ml-auto" onClick={() => setPreviewOpen(true)}>
              {t('selection.preview')}
            </Button>
          </div>
        </div>
      )}

      {previewOpen && (
        <PreviewDialog
          ids={[...selected.keys()]}
          onClose={() => setPreviewOpen(false)}
          onDone={(res) => {
            setPreviewOpen(false);
            setSelected(new Map());
            setReload((n) => n + 1);
            toast.success(t('result.done', { count: res.done, runId: res.runId }));
            if (res.skipped.length) {
              toast.warning(t('result.skipped', { count: res.skipped.length, list: res.skipped.slice(0, 5).map((s) => `${s.productionId ?? s.id} (${t(`block.${s.reason}`, { defaultValue: s.reason, days: OPEN_ORDER_STALE_DAYS })})`).join(', ') }));
            }
          }}
          stageLabel={(s) => tOrders(`workshopBoard.stages.${s}`, { defaultValue: s })}
        />
      )}
    </div>
  );
}

function EvidenceChip({ label, value }: { label: string; value?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', value ? 'bg-tone-success/10 text-tone-success' : 'bg-tone-danger/10 text-tone-danger')}>
      {label}: <span className="font-mono">{value || '—'}</span>
    </span>
  );
}

function StaleRow({ row: r, checked, onToggle, stageLabel }: { row: StaleOpenOrderRow; checked: boolean; onToggle: () => void; stageLabel: string }) {
  const { t } = useTranslation('staleOrders');
  const stageColor = STAGE_COLORS[r.stage as WorkshopStageFilterKey];
  const daysAgo = r.lastActivityAt ? dayjs().diff(dayjs(r.lastActivityAt), 'day') : null;
  return (
    <li className={cn('rounded-lg border bg-card p-3', checked ? 'border-primary ring-1 ring-primary/40' : 'border-border')}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))] touch:h-6 touch:w-6"
          checked={checked}
          disabled={!r.selectable}
          onChange={onToggle}
          aria-label={r.productionId}
          title={r.blockReason ? t(`block.${r.blockReason}`, { days: OPEN_ORDER_STALE_DAYS }) : undefined}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-sm font-semibold">{r.productionId}</span>
            <span className="text-xs text-muted-foreground">{r.userSku}</span>
            <span className="text-xs text-muted-foreground">{r.factoryShortName}</span>
            <span className="text-xs font-medium">{t('ageDays', { count: r.ageDays })}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', stageColor?.chip)}>{stageLabel}</span>
          </div>
          <div className="break-words text-xs text-muted-foreground">{r.type}</div>
          <div className="text-xs">
            <span className="text-muted-foreground">{t('col.lastActivity')}: </span>
            {r.lastActivityAt ? (
              <span>
                {fmt(r.lastActivityAt)} · {t('daysAgo', { count: daysAgo ?? 0 })} · <span className="font-mono text-muted-foreground">{r.lastActivitySource}</span>
              </span>
            ) : (
              <span className="font-semibold text-tone-warning">{t('noActivity')}</span>
            )}
            {r.lastLogAt && <span className="ml-2 text-muted-foreground">({t('lastLog', { action: r.lastLogAction, date: fmt(r.lastLogAt) })})</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <EvidenceChip label={t('evidence.shipment')} value={r.shipping.vnpTracking || r.shipping.customerTracking} />
            <EvidenceChip label={t('evidence.package')} value={r.shipping.packageCode} />
            <EvidenceChip label={t('evidence.completed')} value={undefined} />
            {r.held && <span className="rounded bg-tone-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-tone-warning">{t('evidence.held')}</span>}
          </div>
          {r.blockReason && <div className="text-xs font-medium text-tone-warning">{t(`block.${r.blockReason}`, { days: OPEN_ORDER_STALE_DAYS })}</div>}
        </div>
      </div>
    </li>
  );
}

function PreviewDialog({
  ids,
  onClose,
  onDone,
  stageLabel,
}: {
  ids: string[];
  onClose: () => void;
  onDone: (res: StaleCleanupRunResult) => void;
  stageLabel: (s: string) => string;
}) {
  const { t } = useTranslation('staleOrders');
  const [preview, setPreview] = useState<StaleCleanupPreview | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    RepositoryRemote.order
      .previewStaleCleanup(ids)
      .then((res) => setPreview((res.data as { data: StaleCleanupPreview }).data))
      .catch((err) => {
        handleAxiosError(err);
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = preview?.eligible ?? 0;
  const canRun = !!preview && n > 0 && reason.trim().length >= 10 && typed.trim() === String(n) && !running;
  const eligibleIds = useMemo(() => {
    const skippedIds = new Set(preview?.skipped.map((s) => s.id));
    return ids.filter((id) => !skippedIds.has(id));
  }, [ids, preview]);

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    try {
      const res = await RepositoryRemote.order.runStaleCleanup(eligibleIds, reason.trim());
      onDone((res.data as { data: StaleCleanupRunResult }).data);
    } catch (err) {
      handleAxiosError(err);
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-tone-danger">{t('preview.title', { count: n })}</DialogTitle>
        </DialogHeader>
        {!preview ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner size={16} /> {t('preview.loading')}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="rounded-md border border-tone-danger/40 bg-tone-danger/10 p-2 font-medium text-tone-danger">
              {t('preview.evidence', { with: preview.withShippingEvidence, count: n })}
            </p>
            {preview.neverProduced > 0 && (
              <p className="rounded-md border border-tone-danger/40 bg-tone-danger/10 p-2 font-medium text-tone-danger">{t('preview.neverProduced', { count: preview.neverProduced })}</p>
            )}
            {preview.completedFrom && preview.completedTo && (
              <p className="font-medium">{t('preview.dates', { from: fmt(preview.completedFrom), to: fmt(preview.completedTo) })}</p>
            )}
            <p className="text-muted-foreground">{t('preview.noCustomer')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Breakdown title={t('preview.byFactory')} items={preview.byFactory.map((x) => [x.shortName, x.count])} />
              <Breakdown title={t('preview.byStage')} items={preview.byStage.map((x) => [stageLabel(x.stage), x.count])} />
              <Breakdown title={t('preview.steps')} items={preview.stepsFilled.map((x) => [stageLabel(x.key), x.count])} />
            </div>
            {preview.skipped.length > 0 && (
              <p className="text-tone-warning">
                {t('preview.skipped', { count: preview.skipped.length })} {preview.skipped.slice(0, 8).map((s) => `${s.productionId ?? s.id} (${t(`block.${s.reason}`, { defaultValue: s.reason, days: OPEN_ORDER_STALE_DAYS })})`).join(', ')}
              </p>
            )}
            <label className="block space-y-1">
              <span className="font-medium">{t('preview.reason')}</span>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('preview.reasonPlaceholder')} rows={2} maxLength={500} />
            </label>
            <label className="block space-y-1">
              <span className="font-medium">{t('preview.confirm', { count: n })}</span>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" className="w-32" />
            </label>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={running}>
            {t('preview.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void run()} disabled={!canRun}>
            {running ? (
              <>
                <Spinner size={14} className="mr-1.5" /> {t('preview.running')}
              </>
            ) : (
              t('preview.run', { count: n })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Breakdown({ title, items }: { title: string; items: Array<[string, number]> }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="space-y-0.5 text-xs">
        {items.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-2">
            <span className="truncate">{k}</span>
            <span className="font-mono tabular-nums">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
