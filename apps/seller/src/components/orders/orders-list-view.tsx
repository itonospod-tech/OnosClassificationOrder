'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileUp, PackagePlus, PackageSearch } from 'lucide-react';
import { CustomerOrderStatus } from 'shared/enums';
import type { AdminCustomerStagingOrder, CustomerOrderCounts, CustomerStagingOrder } from 'shared';
import { OrderCard } from '@/components/orders/order-card';
import { OrderRow } from '@/components/orders/order-row';
import { OrdersPagination } from '@/components/orders/orders-pagination';
import { OrdersStatsBar } from '@/components/orders/orders-stats-bar';
import { OrdersStatusFilterPills } from '@/components/orders/orders-status-filter-pills';
import { ProductLineTabs, type ProductLineTabKey } from '@/components/orders/product-line-tabs';
import { BuyLabelDialog } from '@/components/orders/buy-label-dialog';
import { PushDialog } from '@/components/orders/push-dialog';
import { Button } from '@/components/shared/button';
import { ConfirmModal } from '@/components/shared/confirm-modal';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { useToast } from '@/components/shared/toast';
import { apiFetch, useApi } from '@/hooks/use-api';
import { useUrlState } from '@/hooks/use-url-state';
import { orderDisplayCode, type ApiRes } from '@/lib/customer-orders';
import { isProductLine, PRODUCT_LINE_META, productLineHref, type ProductLine } from '@/lib/product-lines';

interface OrdersListViewProps {
  /** Route `/portal/orders/<line>` khoá dòng — tab không đổi được, filter luôn theo dòng đó. */
  lockedLine?: ProductLine;
  /**
   * Khu quản trị `/hub/orders` (SellerPortal.md §9): đọc đơn của MỌI seller qua proxy nhân viên
   * `/api/hub/v1/admin/customer-orders` — thêm cột Seller + lọc seller, ẩn push/hủy/tạo/import.
   */
  adminMode?: boolean;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function OrdersListView({ lockedLine, adminMode = false }: OrdersListViewProps) {
  const { t } = useTranslation(['customerPortal', 'seller', 'hub']);
  const { toast } = useToast();
  const [state, setState] = useUrlState({ page: '1', limit: '20', status: '', held: '', q: '', line: '', seller: '' });
  const page = Math.max(1, Number(state.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(state.limit) || 20));
  const status = state.status || null;
  const heldOnly = state.held === '1';
  const [searchInput, setSearchInput] = useState(state.q);
  const search = useDebounced(searchInput.trim(), 350);
  const line: ProductLineTabKey = lockedLine ?? (isProductLine(state.line) ? state.line : 'all');

  useEffect(() => {
    if (search !== state.q) setState({ q: search, page: '1' });
  }, [search, state.q, setState]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) p.set('status', status);
    if (heldOnly) p.set('held', 'true');
    if (search) p.set('search', search);
    if (line !== 'all') p.set('productLine', line);
    if (adminMode && state.seller) p.set('customerId', state.seller);
    return p.toString();
  }, [page, limit, status, heldOnly, search, line, adminMode, state.seller]);

  const listUrl = adminMode ? `/api/hub/v1/admin/customer-orders?${query}` : `/api/v1/customer/orders?${query}`;
  const countsQs = new URLSearchParams();
  if (adminMode && state.seller) countsQs.set('customerId', state.seller);
  if (line !== 'all') countsQs.set('productLine', line);
  const countsUrl = `${adminMode ? '/api/hub/v1/admin/customer-orders/counts' : '/api/v1/customer/orders/counts'}${countsQs.size ? `?${countsQs}` : ''}`;
  const { data: listRes, loading, refetch } = useApi<ApiRes<AdminCustomerStagingOrder[]>>(listUrl);
  const { data: countsRes, refetch: refetchCounts } = useApi<ApiRes<CustomerOrderCounts>>(countsUrl);
  const orders = useMemo(() => listRes?.data ?? [], [listRes]);
  // `GET customer/orders` chạy lazy-sync đơn hệ cũ TRƯỚC khi list (customer-order.service.ts
  // `syncLegacyOrdersForCustomer`), còn `counts` thì không → gọi song song thì số tab bị cũ.
  // Đợi list về rồi mới làm tươi counts (mutate của SWR, không phải setState).
  useEffect(() => {
    if (listRes) refetchCounts();
  }, [listRes, refetchCounts]);
  const total = listRes?.total ?? 0;
  const counts = countsRes?.data ?? null;

  const lineCounts = useMemo(() => {
    if (!counts) return undefined;
    return { all: counts.all, ...(counts.byProductLine ?? {}) } as Partial<Record<ProductLineTabKey, number>>;
  }, [counts]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pushIds, setPushIds] = useState<string[]>([]);
  const [cancelTarget, setCancelTarget] = useState<CustomerStagingOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Mua vận đơn (chỉ portal seller) — render dialog CÓ ĐIỀU KIỆN để mỗi lần mở
  // là 1 mount mới (requestId idempotency sinh 1 lần / lượt mở).
  const [buyTarget, setBuyTarget] = useState<CustomerStagingOrder | null>(null);

  // Đổi filter/trang → bỏ chọn (khuôn "adjust state while rendering", không dùng effect).
  const filterKey = `${status}|${heldOnly}|${search}|${line}|${page}`;
  const [seenFilterKey, setSeenFilterKey] = useState(filterKey);
  if (filterKey !== seenFilterKey) {
    setSeenFilterKey(filterKey);
    setSelected(new Set());
  }

  const refreshAll = useCallback(() => {
    refetch();
    refetchCounts();
  }, [refetch, refetchCounts]);

  const pendingOrders = useMemo(() => orders.filter((o) => o.status === CustomerOrderStatus.Pending), [orders]);
  const allPendingSelected = pendingOrders.length > 0 && pendingOrders.every((o) => selected.has(o._id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const cancelOrder = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await apiFetch(`/api/v1/customer/orders/staging/${encodeURIComponent(cancelTarget._id)}/cancel`, { method: 'POST', body: '{}' });
      toast('success', t('customerPortal:orders.cancelSuccess'));
      setCancelTarget(null);
      refreshAll();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  const hasFilter = !!search || heldOnly || !!status;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    // Khung cố định như khu quản trị: đầu trang + lọc đứng yên, chỉ bảng/thẻ cuộn, phân trang neo đáy.
    <div className="flex flex-col gap-3 h-[calc(100dvh-4.25rem-var(--viewas-h,0px))] lg:h-[calc(100dvh-2.5rem-var(--viewas-h,0px))]">
      <div className="shrink-0 space-y-3">
      {adminMode ? (
        <PageHeader
          title={t('hub:orders.title')}
          subtitle={`${t('hub:orders.subtitle')}${total > 0 ? ` · ${t('customerPortal:orders.resultsCount', { count: total })}` : ''}`}
        />
      ) : lockedLine ? (
        <ServiceHero line={lockedLine} total={total} />
      ) : null}

      <OrdersStatsBar counts={counts} compact />
      {adminMode && state.seller && (
        <p className="text-[11px] text-text-secondary">
          {t('hub:orders.sellerFilter')}: <b className="font-mono">{orders[0]?.customer?.userSku ?? state.seller}</b>
          <button type="button" onClick={() => setState({ seller: '', page: '1' })} className="ml-2 text-accent hover:underline">{t('hub:orders.allSellers')}</button>
        </p>
      )}

      {/* Tab dòng sản phẩm CHỈ ở khu quản trị; seller vào thẳng trang dịch vụ, không có trang tổng. */}
      {adminMode && (
        <ProductLineTabs
          active={line}
          counts={lineCounts}
          onChange={(next) => setState({ line: next === 'all' ? '' : next, page: '1' })}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <OrdersStatusFilterPills
          active={status}
          counts={counts}
          heldOnly={heldOnly}
          onToggleHeld={() => setState({ held: heldOnly ? '' : '1', page: '1' })}
          onChange={(s) => setState({ status: s ?? '', page: '1' })}
        />
        <div className="flex-1" />
        <SearchInput value={searchInput} onChange={setSearchInput} placeholder={t('seller:common.search')} className="w-full sm:w-72" />
        {!adminMode && selected.size > 0 && (
          <Button variant="primary" size="sm" onClick={() => setPushIds([...selected])}>
            {t('seller:list.pushSelected', { count: selected.size })}
          </Button>
        )}
      </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-3">
      {loading && orders.length === 0 ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<PackageSearch size={28} />}
          title={hasFilter || line !== 'all' ? t('customerPortal:orders.emptyFiltered') : t('customerPortal:orders.empty')}
          description={status === CustomerOrderStatus.Processing ? t('customerPortal:orders.processingEmpty') : undefined}
          action={
            hasFilter ? (
              <Button variant="outline" size="sm" onClick={() => { setSearchInput(''); setState({ q: '', held: '', status: '', page: '1' }); }}>
                {t('customerPortal:orders.clearFilters')}
              </Button>
            ) : adminMode || !lockedLine ? undefined : (
              <Link href={`${productLineHref(lockedLine)}/create`} prefetch={false} className="text-accent text-sm hover:underline">
                {t('customerPortal:orders.placeFirst')}
              </Link>
            )
          }
        />
      ) : (
        <>
        {/* < md: thẻ dọc (không cuộn ngang); ≥ md: bảng */}
        <div className={`md:hidden space-y-2 flex-1 min-h-0 overflow-y-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {orders.map((o) => (
            <OrderCard key={o._id} order={o} adminMode={adminMode} selected={selected.has(o._id)} onToggle={() => toggle(o._id)} onPushOne={() => setPushIds([o._id])} onCancel={() => setCancelTarget(o)} onBuyLabel={adminMode ? undefined : () => setBuyTarget(o)} />
          ))}
        </div>
        <div className={`hidden md:block bg-card border border-border1 rounded-xl flex-1 min-h-0 overflow-auto scrollbar-thin transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left min-w-[960px]">
            <thead className="sticky top-0 z-10 bg-surface-muted">
              <tr className="text-[10px] uppercase tracking-wider text-text-muted">
                <th className="px-2 py-2.5 w-10 min-w-10 sticky left-0 z-20 bg-surface-muted">
                  {!adminMode && status === CustomerOrderStatus.Pending && pendingOrders.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allPendingSelected}
                      onChange={() => setSelected(allPendingSelected ? new Set() : new Set(pendingOrders.map((o) => o._id)))}
                      aria-label={t('seller:list.selectAllPending')}
                      className="accent-[var(--color-accent)]"
                    />
                  )}
                </th>
                <th className="px-3 py-2.5 font-semibold sticky left-10 z-20 bg-surface-muted border-r border-border2">{t('customerPortal:orders.columns.order')}</th>
                {adminMode && <th className="px-3 py-2.5 font-semibold">{t('hub:orders.columns.seller')}</th>}
                <th className="px-3 py-2.5 font-semibold">{t('customerPortal:orders.columns.items')}</th>
                <th className="px-3 py-2.5 font-semibold">{t('seller:nav.orders')}</th>
                <th className="px-3 py-2.5 font-semibold">{t('customerPortal:orders.columns.customer')}</th>
                <th className="px-3 py-2.5 font-semibold">{t('customerPortal:orders.columns.status')}</th>
                <th className="px-3 py-2.5 font-semibold">{t('customerPortal:orders.columns.tracking')}</th>
                <th className="px-3 py-2.5 font-semibold text-right">{t('customerPortal:orders.columns.total')}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <OrderRow
                  key={o._id}
                  order={o}
                  adminMode={adminMode}
                  selected={selected.has(o._id)}
                  onToggle={() => toggle(o._id)}
                  onPushOne={() => setPushIds([o._id])}
                  onCancel={() => setCancelTarget(o)}
                  onBuyLabel={adminMode ? undefined : () => setBuyTarget(o)}
                />
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {total > 0 && (
        <div className="shrink-0 bg-card border border-border1 rounded-xl">
          <OrdersPagination
            page={page}
            limit={limit}
            pages={pages}
            total={total}
            onChange={(next) => setState({ ...(next.page ? { page: String(next.page) } : {}), ...(next.limit ? { limit: String(next.limit), page: '1' } : {}) })}
          />
        </div>
      )}
      </div>

      <PushDialog ids={pushIds} open={pushIds.length > 0} onClose={() => setPushIds([])} onPushed={() => { setSelected(new Set()); refreshAll(); }} />
      {buyTarget && (
        <BuyLabelDialog
          stagingId={buyTarget._id}
          code={orderDisplayCode(buyTarget)}
          onClose={() => setBuyTarget(null)}
          onBought={refreshAll}
        />
      )}
      <ConfirmModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancelOrder}
        loading={cancelling}
        title={t('seller:detail.cancel')}
        message={cancelTarget ? t('customerPortal:orders.cancelConfirm', { name: orderDisplayCode(cancelTarget) }) : ''}
        confirmLabel={t('seller:detail.cancel')}
      />
    </div>
  );
}

/** Header dịch vụ: dải màu theo dòng sản phẩm + CTA đặt đơn / import ngay trong trang (không CTA chung). */
function ServiceHero({ line, total }: { line: ProductLine; total: number }) {
  const { t } = useTranslation(['customerPortal', 'seller']);
  const meta = PRODUCT_LINE_META[line];
  const Icon = meta.icon;
  return (
    <div
      className="rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-white shadow-elevated"
      style={{ background: `linear-gradient(135deg, ${meta.color} 0%, var(--color-accent) 100%)` }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0"><Icon size={20} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold font-display leading-tight">{t(`customerPortal:productLines.${line}`)}</h1>
          <p className="text-[12px] text-white/80">{t('seller:list.heroSubtitle', { count: total })}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        <Link href={`${productLineHref(line)}/import`} prefetch={false} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-bold bg-white/15 text-white border border-white/40 hover:bg-white/25 no-underline">
          <FileUp size={14} />{t('customerPortal:orders.importCsv')}
        </Link>
        <Link href={`${productLineHref(line)}/create`} prefetch={false} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-bold bg-[#f7d21e] text-[#3a2a00] hover:bg-[#ffe04a] no-underline shadow-card">
          <PackagePlus size={14} />{t('seller:list.newOrderIn', { line: t(`customerPortal:productLines.${line}`) })}
        </Link>
      </div>
    </div>
  );
}
