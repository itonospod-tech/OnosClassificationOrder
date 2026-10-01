'use client';

import Link from 'next/link';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Loader2, PauseCircle, Plus, RefreshCw, Send, Truck, Wrench } from 'lucide-react';
import type { AdminCustomerStagingOrder, CustomerOrderCounts } from 'shared';
import { InternalStatus } from '@/components/hub/internal-status';
import { buyInputFrom, buyLabel, canBuyLabel, canBuyLabelNow, ShipmentCell } from '@/components/hub/shipment-cell';
import { SellerFilterPicker } from '@/components/hub/seller-filter-picker';
import { Button } from '@/components/shared/button';
import { OrderCard } from '@/components/orders/order-card';
import { OrdersPagination } from '@/components/orders/orders-pagination';
import { OrdersStatsBar } from '@/components/orders/orders-stats-bar';
import { OrdersStatusFilterPills } from '@/components/orders/orders-status-filter-pills';
import { ProductLineTabs, type ProductLineTabKey } from '@/components/orders/product-line-tabs';
import { ProductLineBadge, StatusBadge } from '@/components/shared/badge';
import { CopyButton } from '@/components/shared/copy-button';
import { DateRangeFilter, type DateRange } from '@/components/shared/date-range-filter';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { SafeImage } from '@/components/shared/safe-image';
import { SearchInput } from '@/components/shared/search-input';
import { apiFetch, useApi } from '@/hooks/use-api';
import { useUrlState } from '@/hooks/use-url-state';
import { orderDisplayCode, type ApiRes } from '@/lib/customer-orders';
import { driveThumbnailUrl } from '@/lib/label-preview';
import { isProductLine, PRODUCT_LINE_META, type ProductLine } from '@/lib/product-lines';
import { useDebounced } from '@/lib/use-debounced';
import { fmtUSD } from '@/lib/utils';

const TH = 'py-2 px-2 text-left text-[9px] text-text-muted font-semibold uppercase tracking-wider';
// Cột "Đơn hàng" cố định bên trái khi cuộn ngang (bảng rộng 1280px+): th/td `sticky left-0`, nền đặc để không lộ chữ phía sau,
// viền phải làm mép; hàng `group` để ô cố định đổi nền cùng hover.
// Hai cột đầu ĐỀU cố định khi cuộn ngang: ô tick ở mép trái, rồi tới mã đơn.
// (08/09/2026 — thêm cột tick làm mã đơn văng khỏi vị trí cố định, ops báo ngay.)
const STICKY_TH_PICK = 'sticky left-0 z-20 bg-surface-muted';
const STICKY_TD_PICK = 'sticky left-0 z-[5] bg-card group-hover:bg-card-hover';
const STICKY_TH = 'sticky left-8 z-20 bg-surface-muted border-r border-border2';
const STICKY_TD = 'sticky left-8 z-[5] bg-card group-hover:bg-card-hover border-r border-border2';

/**
 * Đơn khách toàn hệ — khuôn `components/oms/orders-list-view.tsx` (trang OMS nội bộ của thghub):
 * header → lọc ngày → thẻ số → tab dịch vụ (6 dòng) → pill trạng thái → tìm/seller → bảng đầu xám
 * + phân trang trong card. CHỈ ĐỌC (SellerPortal.md §9), không CTA mạo danh ở đây.
 */
export function HubOrdersView({ lockedLine }: { lockedLine?: ProductLine } = {}) {
  const { t } = useTranslation(['hub', 'customerPortal', 'track']);
  const [state, setState] = useUrlState({ page: '1', limit: '20', status: '', held: '', q: '', line: '', seller: '', from: '', to: '' });
  const page = Math.max(1, Number(state.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(state.limit) || 20));
  const status = state.status || null;
  const heldOnly = state.held === '1';
  const line: ProductLineTabKey = lockedLine ?? (isProductLine(state.line) ? state.line : 'all');
  const [searchInput, setSearchInput] = useState(state.q);
  const search = useDebounced(searchInput.trim(), 350);
  useEffect(() => {
    if (search !== state.q) setState({ q: search, page: '1' });
  }, [search, state.q, setState]);
  const dateRange: DateRange = { dateFrom: state.from || null, dateTo: state.to || null };

  const base = useMemo(() => {
    const p = new URLSearchParams();
    if (state.seller) p.set('customerId', state.seller);
    if (state.from) p.set('dateFrom', state.from);
    if (state.to) p.set('dateTo', state.to);
    return p;
  }, [state.seller, state.from, state.to]);
  const listQuery = useMemo(() => {
    const p = new URLSearchParams(base);
    p.set('page', String(page));
    p.set('limit', String(limit));
    if (status) p.set('status', status);
    if (heldOnly) p.set('held', 'true');
    if (search) p.set('search', search);
    if (line !== 'all') p.set('productLine', line);
    return p.toString();
  }, [base, page, limit, status, heldOnly, search, line]);
  const lineCountsQuery = base.toString();
  const pillCountsQuery = useMemo(() => {
    const p = new URLSearchParams(base);
    if (line !== 'all') p.set('productLine', line);
    return p.toString();
  }, [base, line]);

  const { data: listRes, loading, refetch } = useApi<ApiRes<AdminCustomerStagingOrder[]>>(`/api/hub/v1/admin/customer-orders?${listQuery}`);
  // Mua vận đơn hàng loạt: ops tick vài đơn rồi mua một lượt (khuôn ops bên thghub).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDone, setBulkDone] = useState<{ ok: number; fail: number; errors: string[] } | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);

  /** Đẩy 1 đơn chờ vào sản xuất THAY seller — gọi chính luồng push của seller. */
  const pushOne = async (o: AdminCustomerStagingOrder) => {
    setPushingId(o._id);
    try {
      await apiFetch(`/api/hub/v1/admin/customer-orders/push?customerId=${encodeURIComponent(o.customerId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [o._id] }),
      });
      refetch();
    } catch (err) {
      setBulkDone({ ok: 0, fail: 1, errors: [err instanceof Error ? err.message : String(err)] });
    } finally {
      setPushingId(null);
    }
  };
  const { data: lineCountsRes } = useApi<ApiRes<CustomerOrderCounts>>(`/api/hub/v1/admin/customer-orders/counts${lineCountsQuery ? `?${lineCountsQuery}` : ''}`);
  const { data: countsRes } = useApi<ApiRes<CustomerOrderCounts>>(`/api/hub/v1/admin/customer-orders/counts${pillCountsQuery ? `?${pillCountsQuery}` : ''}`);
  const orders = listRes?.data ?? [];
  const total = listRes?.total ?? 0;
  const counts = countsRes?.data ?? null;
  const lineCounts = useMemo(() => {
    const c = lineCountsRes?.data;
    return c ? ({ all: c.all, ...(c.byProductLine ?? {}) } as Partial<Record<ProductLineTabKey, number>>) : undefined;
  }, [lineCountsRes]);
  const pages = Math.max(1, Math.ceil(total / limit));
  const noop = () => undefined;

  const lineMeta = lockedLine ? PRODUCT_LINE_META[lockedLine] : null;
  const LineIcon = lineMeta?.icon;
  // Chỉ tick được đơn mua NGAY được (đã có cân nặng). Đơn thiếu cân nặng phải
  // nhập tay ở từng dòng — gộp vào lượt mua hàng loạt là mua với cân sai.
  const buyableRows = useMemo(
    () =>
      orders
        .filter((o) => canBuyLabelNow(o.items[0]?.internal))
        .map((o) => ({ id: o._id, ref: o.items[0]!.internal!.orderRefId!, input: buyInputFrom(o.items[0]?.internal)! })),
    [orders],
  );
  const missingWeightCount = useMemo(
    () => orders.filter((o) => canBuyLabel(o.items[0]?.internal) && !canBuyLabelNow(o.items[0]?.internal)).length,
    [orders],
  );
  const pickedRefs = buyableRows.filter((r) => picked.has(r.id));

  // Mua TUẦN TỰ, không song song — mỗi lượt trừ ví và gọi hãng; bắn đồng thời là
  // mở đường mua trùng và timeout hàng loạt. Ghi lỗi từng đơn để ops biết đơn nào hỏng.
  const buyPicked = async () => {
    setBulkBusy(true);
    setBulkDone(null);
    let ok = 0;
    const errors: string[] = [];
    for (const row of pickedRefs) {
      try {
        await buyLabel(row.ref, row.input);
        ok++;
      } catch (err) {
        errors.push(`${row.ref}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBulkDone({ ok, fail: errors.length, errors: errors.slice(0, 5) });
    setPicked(new Set());
    setBulkBusy(false);
    refetch();
  };

  return (
    // Khung cố định: main không cuộn; phần đầu (header + lọc) đứng yên, chỉ BẢNG cuộn, phân trang neo đáy.
    <div className="flex flex-col gap-2 h-[calc(100dvh-4.25rem-var(--viewas-h,0px))] lg:h-[calc(100dvh-2.5rem-var(--viewas-h,0px))]">
      <div className="shrink-0 space-y-2">
      <PageHeader
        title={
          lockedLine && LineIcon ? (
            <span className="inline-flex items-center gap-2"><span className="w-7 h-7 rounded-lg flex items-center justify-center text-white" style={{ background: lineMeta?.color }}><LineIcon size={15} /></span>{t(`customerPortal:productLines.${lockedLine}`)}</span>
          ) : (
            t('hub:orders.title')
          )
        }
        subtitle={lockedLine ? t('hub:orders.subtitleLine', { line: t(`customerPortal:productLines.${lockedLine}`) }) : t('hub:orders.subtitleOms')}
        compact
        actions={
          <div className="flex items-center gap-2 flex-wrap">
          <Link href={lockedLine ? `/hub/orders/create?line=${lockedLine}` : '/hub/orders/create'} prefetch={false}>
            <Button size="sm"><Plus size={13} /> {t('hub:createOrder.newOrder')}</Button>
          </Link>
          <button type="button" onClick={refetch} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border1 bg-card text-[10px] font-bold text-text-secondary hover:bg-card-hover">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />{t('hub:orders.refresh')}
          </button>
          </div>
        }
      />

      <OrdersStatsBar counts={counts} compact />

      {!lockedLine && <ProductLineTabs active={line} counts={lineCounts} onChange={(next) => setState({ line: next === 'all' ? '' : next, page: '1', status: '' })} />}

      <OrdersStatusFilterPills active={status} counts={counts} heldOnly={heldOnly} onToggleHeld={() => setState({ held: heldOnly ? '' : '1', page: '1' })} onChange={(s) => setState({ status: s ?? '', page: '1' })} />

      <div className="flex items-center gap-2 flex-wrap">
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('hub:orders.searchPlaceholder')} className="w-full sm:w-56" />
        <SellerFilterPicker value={state.seller} onChange={(id) => setState({ seller: id, page: '1' })} />
        <DateRangeFilter value={dateRange} onChange={(r) => setState({ from: r.dateFrom ?? '', to: r.dateTo ?? '', page: '1' })} />
        <div className="ml-auto text-[10px] text-text-muted tabular-nums whitespace-nowrap">{t('hub:orders.totalOrders', { count: total })}</div>
      </div>
      </div>

      {(pickedRefs.length > 0 || bulkDone) && (
        <div className="shrink-0 flex items-center gap-3 flex-wrap px-3 py-2 rounded-xl border border-accent/40 bg-accent/5">
          {pickedRefs.length > 0 && (
            <>
              <span className="text-[11px] font-semibold text-text-primary">{t('hub:shipment.picked', { count: pickedRefs.length })}</span>
              <Button size="sm" onClick={buyPicked} loading={bulkBusy}>
                <Truck size={13} /> {t('hub:shipment.buyPicked')}
              </Button>
              <button type="button" onClick={() => setPicked(new Set())} className="text-[11px] text-text-muted hover:text-text-primary">
                {t('hub:shipment.clearPick')}
              </button>
              {missingWeightCount > 0 && (
                <span className="text-[10.5px] text-warning">{t('hub:shipment.skippedNoWeight', { count: missingWeightCount })}</span>
              )}
            </>
          )}
          {bulkDone && (
            <span className="text-[11px] text-text-secondary">
              {t('hub:shipment.result', { ok: bulkDone.ok, fail: bulkDone.fail })}
              {bulkDone.errors.length > 0 && <span className="text-error"> · {bulkDone.errors[0]}</span>}
            </span>
          )}
        </div>
      )}

      <div className="bg-card border border-border1 rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col">
        {loading && orders.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-20 text-[13px] text-text-muted"><Loader2 size={16} className="animate-spin mr-2" />{t('hub:common.loading')}</div>
        ) : orders.length === 0 ? (
          <div className="flex-1 flex items-center justify-center"><EmptyState title={t('customerPortal:orders.emptyFiltered')} icon={<span className="text-[40px]">📦</span>} /></div>
        ) : (
          <>
            <div className={`md:hidden divide-y divide-border2 flex-1 min-h-0 overflow-y-auto ${loading ? 'opacity-60' : ''}`}>
              {orders.map((o) => (
                <div key={o._id} className="p-2"><OrderCard order={o} adminMode showViewAs={false} selected={false} onToggle={noop} onPushOne={noop} onCancel={noop} /></div>
              ))}
            </div>
            <div className={`hidden md:block flex-1 min-h-0 overflow-auto scrollbar-thin ${loading ? 'opacity-60' : ''}`}>
              <table className="w-full min-w-[1280px]">
                <thead className="bg-surface-muted sticky top-0 z-10">
                  <tr className="border-b border-border2">
                    <th className={`${TH} ${STICKY_TH_PICK} w-8`}>
                      <input
                        type="checkbox"
                        aria-label={t('hub:shipment.pickAll')}
                        checked={buyableRows.length > 0 && pickedRefs.length === buyableRows.length}
                        onChange={() => setPicked(pickedRefs.length === buyableRows.length ? new Set() : new Set(buyableRows.map((r) => r.id)))}
                        className="accent-[var(--color-accent)] align-middle"
                      />
                    </th>
                    <th className={`${TH} ${STICKY_TH}`}>{t('customerPortal:orders.columns.order')}</th>
                    <th className={TH}>{t('hub:orders.columns.seller')}</th>
                    <th className={TH}>{t('customerPortal:orders.columns.product')}</th>
                    <th className={TH}>{t('hub:orders.columns.service')}</th>
                    <th className={`${TH} text-right`}>{t('customerPortal:orders.columns.quantity')}</th>
                    <th className={`${TH} text-right`}>{t('customerPortal:orders.columns.total')}</th>
                    <th className={TH}>{t('customerPortal:orders.columns.status')}</th>
                    <th className={`${TH} min-w-[220px]`}>{t('hub:internal.column')}</th>
                    <th className={TH}>{t('customerPortal:orders.columns.customer')}</th>
                    <th className={TH}>{t('customerPortal:orders.columns.tracking')}</th>
                    <th className={TH}>{t('hub:orders.columns.note')}</th>
                    <th className={TH}>{t('hub:orders.columns.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const code = orderDisplayCode(o);
                    const first = o.items[0];
                    const extra = o.items.length - 1;
                    const thumb = first?.mockupUrl ? (driveThumbnailUrl(first.mockupUrl, 100) ?? first.mockupUrl) : null;
                    const qty = o.totalQuantity ?? o.items.reduce((s, i) => s + (i.quantity ?? 0), 0);
                    const tracked = o.items.find((i) => i.tracking?.number)?.tracking;
                    const stage = first?.currentStageKey ? t(`track:progress.stages.${first.currentStageKey}`, { defaultValue: first.currentStageLabel ?? '' }) : first?.currentStageLabel;
                    const addr = o.shippingAddress;
                    return (
                      <tr key={o._id} className={`group border-b border-border2 last:border-0 hover:bg-card-hover align-top text-[11px] ${o.status === 'cancelled' ? 'opacity-60' : ''}`}>
                        <td className={`py-2 px-2 ${STICKY_TD_PICK} w-8`}>
                          {canBuyLabelNow(first?.internal) ? (
                            <input
                              type="checkbox"
                              checked={picked.has(o._id)}
                              onChange={() => setPicked((prev) => { const next = new Set(prev); if (next.has(o._id)) next.delete(o._id); else next.add(o._id); return next; })}
                              className="accent-[var(--color-accent)]"
                            />
                          ) : null}
                        </td>
                        <td className={`py-2 px-2 ${STICKY_TD}`}>
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-text-primary whitespace-nowrap">#{code}<CopyButton text={code} size={10} /></span>
                          {o.orderId && o.orderId !== code && <p className="text-[9.5px] text-text-muted truncate max-w-[150px]">{o.orderId}</p>}
                          <p className="text-[9.5px] text-text-muted">{t(`customerPortal:orders.source.${o.source}`)}</p>
                        </td>
                        <td className="py-2 px-2">
                          <button type="button" onClick={() => setState({ seller: o.customerId, page: '1' })} className="text-[11px] font-bold text-text-primary hover:text-accent">{o.customer?.userSku || '—'}</button>
                          <p className="text-[9.5px] text-text-muted truncate max-w-[160px]">{o.customer?.userEmail}{o.customer?.tier != null ? ` · VIP ${o.customer.tier}` : ''}</p>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-start gap-2">
                            <SafeImage src={thumb} alt="" className="w-9 h-9 rounded object-cover border border-border1 bg-surface-muted shrink-0" fallback={<div className="w-9 h-9 rounded border border-dashed border-border1 flex items-center justify-center text-text-muted shrink-0"><ImageIcon size={11} /></div>} />
                            <div className="min-w-0">
                              <p className="text-[11px] text-text-primary truncate max-w-[220px]">{first?.type || first?.sku || '—'}</p>
                              <p className="text-[9.5px] text-text-muted font-mono truncate max-w-[220px]">{[first?.sku, [first?.color, first?.size].filter(Boolean).join('/')].filter(Boolean).join(' · ')}</p>
                              {extra > 0 && <p className="text-[9.5px] text-accent">{t('customerPortal:orders.moreItems', { count: extra })}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-2"><div className="flex flex-wrap gap-1">{(o.productLines ?? []).map((l) => <ProductLineBadge key={l} line={l} />)}</div></td>
                        <td className="py-2 px-2 text-right text-[11px] tabular-nums">{qty}</td>
                        <td className="py-2 px-2 text-right text-[11px] font-semibold tabular-nums">{o.totalAmount != null ? fmtUSD(o.totalAmount) : '—'}</td>
                        <td className="py-2 px-2">
                          <div className="flex flex-col items-start gap-0.5">
                            <StatusBadge status={o.status} />
                            {(o.held || o.rework) && (
                              <span className="inline-flex gap-1.5 text-[9.5px] font-semibold text-warning">
                                {o.held && <span className="inline-flex items-center gap-0.5"><PauseCircle size={9} />{t('customerPortal:orders.badgeHold')}</span>}
                                {o.rework && <span className="inline-flex items-center gap-0.5"><Wrench size={9} />{t('customerPortal:orders.badgeRework')}</span>}
                              </span>
                            )}
                            {stage && o.status !== 'pending' && <span className="text-[9.5px] text-text-muted">{stage}</span>}
                            {o.status === 'pending' && (
                              // Đơn ops vừa lên hộ nằm ở CHỜ ĐẨY — đẩy ngay tại đây,
                              // khỏi phải mạo danh seller mới đẩy được.
                              <button
                                type="button"
                                disabled={pushingId === o._id}
                                onClick={() => pushOne(o)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cta text-cta-foreground text-[9.5px] font-bold disabled:opacity-60"
                              >
                                {pushingId === o._id ? <Loader2 size={9} className="animate-spin" /> : <Send size={9} />}
                                {t('hub:orders.push')}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2"><InternalStatus s={first?.internal} /></td>
                        <td className="py-2 px-2 text-[10.5px]">
                          {addr ? (<><p className="text-text-primary truncate max-w-[140px]">{[addr.firstName, addr.lastName].filter(Boolean).join(' ') || '—'}</p><p className="text-text-muted truncate max-w-[140px]">{[addr.city, addr.state, addr.country].filter(Boolean).join(', ')}</p></>) : <span className="text-text-muted">—</span>}
                        </td>
                        {/* Cột vận đơn: có mã thì hiện mã + link label, chưa có thì nút mua ngay tại hàng. */}
                        <td className="py-2 px-2"><ShipmentCell s={first?.internal} onBought={refetch} /></td>
                        <td className="py-2 px-2 text-[10.5px] text-text-secondary">
                          {o.note ? <p title={o.note} className="max-w-[180px] line-clamp-2 break-words">{o.note}</p> : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="py-2 px-2 text-[10.5px] text-text-secondary whitespace-nowrap">{dayjs(o.pushedAt ?? o.createdAt).format('DD/MM/YYYY HH:mm')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="shrink-0 border-t border-border2">
          <OrdersPagination page={page} limit={limit} pages={pages} total={total} onChange={(n) => setState({ ...(n.page ? { page: String(n.page) } : {}), ...(n.limit ? { limit: String(n.limit), page: '1' } : {}) })} />
        </div>
      </div>
    </div>
  );
}
