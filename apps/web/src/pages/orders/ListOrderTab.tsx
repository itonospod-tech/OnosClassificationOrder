import React, { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { History, Image as ImageIcon, ListChecks, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { CopyButton } from '@/components/common/CopyButton';
import { Hint } from '@/components/common/Hint';
import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PaginationBar } from '@/components/common/PaginationBar';
import { SelectFilter } from '@/components/common/SelectFilter';
import { Spinner } from '@/components/common/Spinner';
import { BulkProductionIdDialog, parseProductionIds } from '@/components/orders/BulkProductionIdDialog';
import { CancelledBadge } from '@/components/orders/CancelledBadge';
import { PrioritySelectCell } from '@/components/orders/cells/PrioritySelectCell';
import { HeldBadge, OnospodHoldBadge } from '@/components/orders/HeldBadge';
import { HOLD_REASON_PRESETS } from '@/components/orders/HoldOrderDialog';
import { OrderLogTimelineDialog } from '@/components/orders/OrderLogTimelineDialog';
import { OrderRowActionsMenu } from '@/components/orders/OrderRowActionsMenu';
import type { WorkshopOrderRow } from '@/components/orders/workshopTableConfig';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/date';
import { smallThumb } from '@/utils/driveThumb';
import { isCancelled, isHeld, showOnospodHoldFlag } from '@/utils/orderActions';
import { getOrderStatusInfo, makeOrderStatusTranslate, ORDER_STATUS_TONE_CLASS } from '@/utils/orderStatusLabel';

import { usePermission } from '@/hooks/usePermission';

import { DesignerSummaryPanel } from './DesignerSummaryPanel';

type FilterOption = { value: string; label: string; count: number };

interface DesignFields {
  front?: string;
  back?: string;
  sleeve?: string;
  hood?: string;
  folder?: string;
  placket?: string;
  chestLeft?: string;
  chestRight?: string;
  left?: string;
  right?: string;
  sleeveLeft?: string;
  sleeveRight?: string;
  leftUpperSleeve?: string;
  rightUpperSleeve?: string;
  leftCuff?: string;
  rightCuff?: string;
  frontEmbroidery?: string;
  backEmbroidery?: string;
}

interface OrderRow {
  _id: string;
  productionId: string;
  userSku?: string;
  userEmail?: string;
  type?: string;
  color?: string;
  size?: string;
  mockupUrl?: string;
  mockupOriginalUrl?: string;
  printMethod?: string;
  quantity?: number;
  baseCost?: number;
  shipCost?: number;
  status?: string;
  priority?: number;
  orderId?: string;
  externalId?: string;
  isMapped: boolean;
  factory?: { name: string; shortName: string };
  machineType?: { name: string; shortName: string };
  orderAt?: string;
  inProductionAt?: string;
  designs?: DesignFields;
  designsOriginal?: DesignFields;
  designsStatus?: Partial<Record<keyof DesignFields, 'pending' | 'ready' | 'failed'>>;
  cancelledAt?: string | null;
  cancelReason?: string;
  heldAt?: string | null;
  holdReason?: string;
  holdSource?: string | null;
  onospodHold?: { onHoldAt?: string; seenAt?: string } | null;
  // Field suy ra "Trạng thái hiện tại" (cột Status) — `getOrders` trả full doc
  // nên không cần nới projection BE.
  toolResultNote?: string;
  designerStatus?: string;
  currentFulfillmentStage?: string | null;
  fulfillmentStages?: Record<string, ({ status?: string } & Record<string, unknown>) | undefined>;
  fulfillmentCompletedAt?: string | null;
}

interface ListOrderTabProps {
  refreshKey: number;
}

const DEFAULT_PAGE_SIZE = 20;

interface OrderRowItemProps {
  it: OrderRow;
  onPreview: (url: string, title: string, originalUrl?: string) => void;
  onDelete: (id: string) => void;
  onHistory: (id: string, productionId: string) => void;
  onChanged: () => void;
  canEditPriority: boolean;
  onPriorityUpdated: (id: string, priority: number | null) => void;
}

const OrderRowItem = memo(
  function OrderRowItem({
    it,
    onPreview,
    onDelete,
    onHistory,
    onChanged,
    canEditPriority,
    onPriorityUpdated,
  }: OrderRowItemProps) {
    const { t } = useTranslation('orders');
    const variantBits = [it.color, it.size, it.printMethod].filter(Boolean);
    const mockupThumbSrc = smallThumb(it.mockupUrl, 200);
    const cancelled = isCancelled(it);
    const held = isHeld(it);
    const status = getOrderStatusInfo(it, makeOrderStatusTranslate(t));

    return (
      <TableRow className={cancelled || held ? 'opacity-60' : undefined}>
        {/* Order ID */}
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <CopyButton value={it.productionId} label="Production ID" />
              <Hint content="Production ID">
                <span className="font-mono text-xs font-semibold text-foreground cursor-help">{it.productionId}</span>
              </Hint>
              {cancelled && <CancelledBadge reason={it.cancelReason} />}
              {held && !cancelled && <HeldBadge reason={it.holdReason} source={it.holdSource} />}
              {showOnospodHoldFlag(it) && <OnospodHoldBadge />}
            </div>
            {it.orderId && (
              <div className="flex items-center gap-1">
                <CopyButton value={it.orderId} label="Order ID" iconSize={10} />
                <Hint content={t('listTab.orderIdHint')}>
                  <span className="font-mono text-[11px] text-muted-foreground cursor-help">#{it.orderId}</span>
                </Hint>
              </div>
            )}
            {it.externalId && (
              <div className="flex items-center gap-1">
                <CopyButton value={it.externalId} label="Platform ID" iconSize={10} />
                <Hint content={`Platform ID (External): ${it.externalId}`}>
                  <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[140px] cursor-help">
                    ext: {it.externalId}
                  </span>
                </Hint>
              </div>
            )}
            {it.orderAt && (
              <Hint content={t('listTab.orderedAtHint', { time: formatDate(it.orderAt, 'HH:mm DD/MM/YYYY') })}>
                <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1 cursor-help">
                  <span className="opacity-60">🛒</span>
                  {formatDate(it.orderAt, 'HH:mm DD/MM/YYYY')}
                </span>
              </Hint>
            )}
          </div>
        </TableCell>

        {/* Mockup */}
        <TableCell>
          {it.mockupUrl ? (
            <Hint content={t('listTab.clickToViewFullImage')}>
              <button
                type="button"
                onClick={() => onPreview(it.mockupUrl!, `Mockup — ${it.productionId}`, it.mockupOriginalUrl)}
                className="bg-transparent border-none p-0 cursor-pointer"
              >
                <img
                  src={mockupThumbSrc}
                  alt="mockup"
                  className="w-12 h-12 object-contain rounded border border-border bg-checker bg-checker-sm hover:ring-2 hover:ring-ring transition-all"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </button>
            </Hint>
          ) : (
            <div className="w-12 h-12 rounded border border-border bg-muted flex items-center justify-center text-muted-foreground">
              <ImageIcon size={16} />
            </div>
          )}
        </TableCell>

        {/* Designs — [R2-disabled] tạm ẩn cùng pipeline R2.
        <TableCell>
          <DesignThumbsCell
            designs={it.designs as Record<string, string | undefined> | undefined}
            designsOriginal={it.designsOriginal as Record<string, string | undefined> | undefined}
            designsStatus={it.designsStatus}
            productionId={it.productionId}
            openPreview={onPreview}
          />
        </TableCell>
        */}

        {/* Product */}
        <TableCell className="max-w-[300px]">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 min-w-0">
              {it.type && <CopyButton value={it.type} label={t('listTab.productName')} />}
              <Hint content={it.type || t('listTab.noProductName')}>
                <span className="text-sm font-semibold text-foreground truncate cursor-help min-w-0">
                  {it.type || '—'}
                </span>
              </Hint>
            </div>
            {variantBits.length > 0 && (
              <Hint content="Color / Size / Print Method">
                <span className="text-[11px] text-muted-foreground cursor-help">{variantBits.join(' / ')}</span>
              </Hint>
            )}
            <span className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
              <Hint content={t('listTab.quantity')}>
                <span className="cursor-help">
                  Qty: <span className="font-medium text-foreground">{it.quantity ?? 1}</span>
                </span>
              </Hint>
              {typeof it.baseCost === 'number' && (
                <Hint content={t('listTab.baseCostHint')}>
                  <span className="cursor-help">
                    · Base: <span className="font-medium text-foreground">${it.baseCost}</span>
                  </span>
                </Hint>
              )}
              {typeof it.shipCost === 'number' && (
                <Hint content={t('listTab.shipCostHint')}>
                  <span className="cursor-help">
                    · Ship: <span className="font-medium text-foreground">${it.shipCost}</span>
                  </span>
                </Hint>
              )}
            </span>
          </div>
        </TableCell>

        {/* SKU / Email */}
        <TableCell>
          <div className="flex flex-col gap-0.5">
            {it.userSku ? (
              <div className="flex items-center gap-1">
                <CopyButton value={it.userSku} label="SKU" iconSize={10} />
                <Hint content={t('listTab.userSkuHint')}>
                  <span className="text-xs font-medium cursor-help">{it.userSku}</span>
                </Hint>
              </div>
            ) : (
              <span className="text-xs font-medium">—</span>
            )}
            {it.userEmail && (
              <div className="flex items-center gap-1">
                <CopyButton value={it.userEmail} label="email" iconSize={10} />
                <Hint content={it.userEmail}>
                  <span className="text-[11px] text-muted-foreground truncate max-w-[140px] cursor-help">
                    {it.userEmail}
                  </span>
                </Hint>
              </div>
            )}
          </div>
        </TableCell>

        {/* Xưởng / Máy */}
        <TableCell>
          {it.isMapped ? (
            <div className="flex flex-col gap-1">
              <Hint content={t('listTab.factoryHint', { name: it.factory?.name, code: it.factory?.shortName })}>
                <Badge variant="success" className="w-fit cursor-help">
                  {it.factory?.shortName || '?'} · {it.factory?.name || '?'}
                </Badge>
              </Hint>
              <Hint content={t('listTab.machineTypeHint', { name: it.machineType?.name, code: it.machineType?.shortName })}>
                <Badge variant="secondary" className="w-fit cursor-help">
                  {it.machineType?.shortName || '?'} · {it.machineType?.name || '?'}
                </Badge>
              </Hint>
            </div>
          ) : (
            <Hint content={t('workshopCols.misc.noMappingHint')}>
              <Badge variant="warning" className="cursor-help">
                {t('workshopCols.misc.noMapping')}
              </Badge>
            </Hint>
          )}
        </TableCell>

        {/* Trạng thái hiện tại — chặng đơn đang nằm + trạng thái con (chờ/đang
            làm/làm lại). Trạng thái gốc lúc import (`status`, free-text) xuống
            dòng phụ vì đứng im từ lúc nhập, không phản ánh tiến độ sản xuất. */}
        <TableCell>
          <div className="flex flex-col gap-0.5 items-start">
            <Hint content={status.tooltip}>
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap cursor-help',
                  ORDER_STATUS_TONE_CLASS[status.tone],
                )}
              >
                {status.label}
              </span>
            </Hint>
            {it.status && (
              <Hint content={t('statusLabel.rawStatusHint', { status: it.status })}>
                <span className="text-[10px] text-muted-foreground cursor-help">{it.status}</span>
              </Hint>
            )}
          </div>
        </TableCell>

        {/* Ưu tiên */}
        <TableCell>
          <PrioritySelectCell
            orderId={it._id}
            value={it.priority}
            canEdit={canEditPriority}
            onUpdated={(v) => onPriorityUpdated(it._id, v)}
          />
        </TableCell>

        {/* Thao tác — pin cố định BÊN PHẢI */}
        <TableCell className="sticky right-0 z-10 bg-card shadow-[-1px_0_0_0_var(--border)]">
          <div className="flex items-center gap-0.5">
            <Hint content={t('listTab.history')}>
              <Button variant="ghost" size="icon" onClick={() => onHistory(it._id, it.productionId)}>
                <History size={14} className="text-muted-foreground" />
              </Button>
            </Hint>
            <Hint content={t('listTab.deleteOrder')}>
              <Button variant="ghost" size="icon" onClick={() => onDelete(it._id)}>
                <Trash2 size={14} className="text-destructive" />
              </Button>
            </Hint>
            <OrderRowActionsMenu order={it as unknown as WorkshopOrderRow} onChanged={onChanged} />
          </div>
        </TableCell>
      </TableRow>
    );
  },
  (prev, next) =>
    prev.it === next.it &&
    prev.onPreview === next.onPreview &&
    prev.onDelete === next.onDelete &&
    prev.onHistory === next.onHistory &&
    prev.onChanged === next.onChanged,
);

export function ListOrderTab({ refreshKey }: ListOrderTabProps) {
  const { t } = useTranslation('orders');
  // URL params (prefix `l` = list). F5 giữ nguyên filter — default values
  // bị strip khỏi URL để URL gọn khi chưa filter gì.
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(() => searchParams.get('lsearch') || '');
  // Lọc bulk theo danh sách productionId (modal). Transient — không sync URL vì
  // danh sách có thể rất dài.
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filterMapped, setFilterMapped] = useState<'all' | 'mapped' | 'unmapped'>(() => {
    const v = searchParams.get('lmapped');
    return v === 'mapped' || v === 'unmapped' ? v : 'all';
  });
  const [filterError, setFilterError] = useState<boolean>(() => searchParams.get('lerror') === 'true');
  // Lọc đơn đang GIỮ theo lý do — không chọn thì không lọc (hiện cả giữ lẫn
  // không giữ, hành vi mặc định cũ). Chọn 1 lý do → CHỈ đơn đang giữ đúng lý
  // do đó (field `holdReason` tự ngụ ý held=true, xem `buildOrderListFilter`).
  const [filterHoldReason, setFilterHoldReason] = useState<string>(() => searchParams.get('lhold') || '');
  // Designer summary filters — Admin / Leader.
  const [filterAssignee, setFilterAssignee] = useState<string>(() => searchParams.get('lassign') || '');
  const [filterDesignerStatus, setFilterDesignerStatus] = useState<string>(() => searchParams.get('ldstatus') || '');
  const [filterOptions, setFilterOptions] = useState<{
    assignee: FilterOption[];
    designerStatus: FilterOption[];
  }>({ assignee: [], designerStatus: [] });
  const { has, canEditField } = usePermission();
  const canSeeDesignerSummary = has('page.designer_stats') || has('designer.task.assign');

  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('lpage'));
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const s = Number(searchParams.get('lsize'));
    return Number.isFinite(s) && s > 0 ? s : DEFAULT_PAGE_SIZE;
  });
  const [preview, setPreview] = useState<{
    url: string;
    originalUrl?: string;
    title: string;
    sourceUrl?: string;
  } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ id: string; productionId: string } | null>(null);

  // Sync state → URL. Strip default values để URL gọn.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        search ? sp.set('lsearch', search) : sp.delete('lsearch');
        filterMapped !== 'all' ? sp.set('lmapped', filterMapped) : sp.delete('lmapped');
        filterError ? sp.set('lerror', 'true') : sp.delete('lerror');
        filterAssignee ? sp.set('lassign', filterAssignee) : sp.delete('lassign');
        filterDesignerStatus ? sp.set('ldstatus', filterDesignerStatus) : sp.delete('ldstatus');
        filterHoldReason ? sp.set('lhold', filterHoldReason) : sp.delete('lhold');
        page > 1 ? sp.set('lpage', String(page)) : sp.delete('lpage');
        pageSize !== DEFAULT_PAGE_SIZE ? sp.set('lsize', String(pageSize)) : sp.delete('lsize');
        return sp;
      },
      { replace: true },
    );
  }, [search, filterMapped, filterError, filterAssignee, filterDesignerStatus, filterHoldReason, page, pageSize, setSearchParams]);

  /** Build filter params dùng cho cả fetchData, fetchFilters, summary panel. */
  const buildFilterParams = (): URLSearchParams => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (bulkIds.length) params.set('productionIds', bulkIds.join(','));
    // `isMapped` là cờ BA TRẠNG THÁI: 'false' KHÔNG phải "tắt lọc" mà mang
    // nghĩa riêng — chỉ đơn CHƯA map product config. Đừng rút gọn thành một
    // nhánh rồi bỏ nhánh dưới: bỏ đi là mất hẳn bộ lọc "Chưa mapping".
    // Đây cũng là chỗ DUY NHẤT trong cả FE gửi chuỗi 'false', nên nó là nơi
    // lộ ra lỗi phân giải cờ (ORD-24) — xem `Orders.md §23`.
    if (filterMapped === 'mapped') params.set('isMapped', 'true');
    if (filterMapped === 'unmapped') params.set('isMapped', 'false');
    if (filterError) params.set('hasError', 'true');
    if (filterAssignee) params.set('assignee', filterAssignee);
    if (filterDesignerStatus) params.set('designerStatus', filterDesignerStatus);
    if (filterHoldReason) params.set('holdReason', filterHoldReason);
    return params;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = buildFilterParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      const resp = await RepositoryRemote.order.getOrders(`?${params.toString()}`);
      setItems(resp.data.data || []);
      setTotal(resp.data.total || 0);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFilters = async () => {
    if (!canSeeDesignerSummary) return;
    try {
      const params = buildFilterParams();
      const res = await RepositoryRemote.order.getWorkshopFilters(`?${params.toString()}`);
      const data = (res.data?.data || {}) as {
        assignee?: FilterOption[];
        designerStatus?: FilterOption[];
      };
      setFilterOptions({
        assignee: data.assignee || [],
        designerStatus: data.designerStatus || [],
      });
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    fetchData();
    fetchFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, filterMapped, filterError, filterAssignee, filterDesignerStatus, filterHoldReason, bulkIds, page, pageSize]);

  // Skip lần render đầu — nếu không sẽ ghi đè `lpage` đọc từ URL khi F5.
  const isFirstRender = React.useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setPage(1);
  }, [filterMapped, filterError, filterAssignee, filterDesignerStatus, filterHoldReason]);

  const handleSearch = () => {
    if (bulkIds.length) setBulkIds([]); // search thường loại bỏ bộ lọc bulk
    setPage(1);
    fetchData();
  };

  const applyBulk = (ids: string[]) => {
    setSearch(''); // bulk và search thường loại trừ nhau cho đỡ rối
    setBulkIds(ids);
    setPage(1);
  };

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm(t('listTab.confirmDelete'))) return;
      try {
        await RepositoryRemote.order.deleteOrder(id);
        toast.success(t('listTab.deleted'));
        fetchData();
      } catch (error) {
        handleAxiosError(error);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openPreview = useCallback(
    (url: string, title: string, originalUrl?: string, sourceUrl?: string) =>
      setPreview({ url, originalUrl, title, sourceUrl }),
    [],
  );

  const patchRow = useCallback(
    (id: string, patch: Partial<OrderRow>) =>
      setItems((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r))),
    [],
  );
  // [R2-disabled] tạm tắt poll vì pipeline R2 không chạy.
  // usePendingDesignsPoll(items as Array<{ _id: string; designs?: Record<string, string | undefined>; designsStatus?: Partial<Record<string, 'pending' | 'ready' | 'failed'>> }>, patchRow);

  const openHistory = useCallback((id: string, productionId: string) => setHistoryTarget({ id, productionId }), []);

  const handleChanged = useCallback(
    () => fetchData(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const paginationProps = {
    page,
    pageSize,
    total,
    loading,
    onChange: (p: number, ps: number) => {
      setPage(p);
      setPageSize(ps);
    },
  };

  // Inject "Chưa gán" option vào assignee.
  const assigneeOptions = canSeeDesignerSummary
    ? filterOptions.assignee.find((o) => o.value === '__none__')
      ? filterOptions.assignee
      : [{ value: '__none__', label: t('listTab.unassigned'), count: 0 }, ...filterOptions.assignee]
    : [];

  const summaryFilterQs = buildFilterParams().toString();

  // Số mã parse được từ ô search (đếm để hiện badge "N mã" khi tìm nhiều mã).
  const searchTokenCount = parseProductionIds(search).length;

  /** Click cell trong panel → set filter list. */
  const handleSummaryCellClick = (
    userId: string | null,
    status:
      | 'assigned'
      | 'in-progress'
      | 'done'
      | 'rejected'
      | 'rework'
      | 'unassigned'
      | '__unassigned_notool__'
      | '__unassigned_tool__'
      | null,
  ) => {
    if (userId !== null) setFilterAssignee(userId);
    if (status !== null) setFilterDesignerStatus(status);
    setPage(1);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4">
        {canSeeDesignerSummary && (
          <DesignerSummaryPanel filterQs={summaryFilterQs} onClickCell={handleSummaryCellClick} />
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Input
                placeholder={t('listTab.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                onPaste={(e) => {
                  // Dán 1 cột mã (mỗi mã 1 dòng) từ Google Sheets → gộp xuống dòng
                  // thành khoảng trắng để ô 1 dòng vẫn giữ đủ mã cho BE tách.
                  const text = e.clipboardData.getData('text');
                  if (!/[\r\n\t]/.test(text)) return;
                  e.preventDefault();
                  const input = e.currentTarget;
                  const start = input.selectionStart ?? search.length;
                  const end = input.selectionEnd ?? search.length;
                  const normalized = text.replace(/[\r\n\t]+/g, ' ').trim();
                  setSearch(search.slice(0, start) + normalized + search.slice(end));
                }}
                className="w-[340px] max-w-full pr-14"
              />
              {searchTokenCount > 1 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-primary pointer-events-none">
                  {t('listTab.tokenCount', { count: searchTokenCount })}
                </span>
              )}
            </div>
            <Hint content={t('listTab.searchMultipleProductionIds')}>
              <Button variant="outline" size="icon" onClick={() => setBulkOpen(true)}>
                <ListChecks size={16} />
              </Button>
            </Hint>
            {bulkIds.length > 0 && (
              <Badge variant="secondary" className="gap-1 cursor-default">
                {t('listTab.filteringCount', { count: bulkIds.length })}
                <button type="button" onClick={() => setBulkIds([])} className="ml-0.5 hover:text-foreground">
                  <X size={12} />
                </button>
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={filterMapped === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterMapped('all')}
            >
              {t('listTab.filterAll')}
            </Button>
            <Button
              variant={filterMapped === 'mapped' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterMapped('mapped')}
            >
              {t('listTab.filterMapped')}
            </Button>
            <Button
              variant={filterMapped === 'unmapped' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterMapped('unmapped')}
            >
              {t('workshopCols.misc.noMapping')}
            </Button>
            <Button
              variant={filterError ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setFilterError((v) => !v)}
              title={t('listTab.factoryErrorOnlyTitle')}
            >
              {t('listTab.factoryError')}
            </Button>
            <select
              value={filterHoldReason}
              onChange={(e) => setFilterHoldReason(e.target.value)}
              title={t('listTab.holdReasonFilterTitle')}
              className={cn(
                'h-8 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                filterHoldReason ? 'border-primary text-primary' : 'border-input',
              )}
            >
              <option value="">{t('listTab.holdReasonFilterAll')}</option>
              {HOLD_REASON_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canSeeDesignerSummary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-md border border-border bg-card p-2.5">
            <SelectFilter
              label="Designer"
              value={filterAssignee}
              onChange={setFilterAssignee}
              options={assigneeOptions}
            />
            <SelectFilter
              label="TT Designer"
              value={filterDesignerStatus}
              onChange={setFilterDesignerStatus}
              options={filterOptions.designerStatus}
            />
            {(filterAssignee || filterDesignerStatus) && (
              <div className="flex items-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterAssignee('');
                    setFilterDesignerStatus('');
                  }}
                >
                  {t('listTab.clearDesignerFilter')}
                </Button>
              </div>
            )}
          </div>
        )}

        <PaginationBar position="top" {...paginationProps} />

        <LoadingOverlay active={loading && items.length > 0} className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Order ID</TableHead>
                <TableHead className="w-16">Mockup</TableHead>
                {/* [R2-disabled] <TableHead className="min-w-[110px]">Design</TableHead> */}
                <TableHead className="min-w-[260px]">Product</TableHead>
                <TableHead>SKU / Email</TableHead>
                <TableHead>{t('listTab.factoryMachine')}</TableHead>
                <TableHead className="min-w-[130px]">{t('statusLabel.colStatus')}</TableHead>
                <TableHead>{t('workshopCols.col.priority')}</TableHead>
                <TableHead className="w-24 sticky right-0 z-20 bg-card"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10">
                    <Spinner size={20} className="text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                    {t('listTab.emptyState')}
                  </TableCell>
                </TableRow>
              )}
              {items.map((it) => (
                <OrderRowItem
                  key={it._id}
                  it={it}
                  onPreview={openPreview}
                  onDelete={handleDelete}
                  onHistory={openHistory}
                  onChanged={handleChanged}
                  canEditPriority={canEditField('priority')}
                  onPriorityUpdated={(id, priority) => patchRow(id, { priority: priority ?? undefined })}
                />
              ))}
            </TableBody>
          </Table>

          <PaginationBar position="bottom" {...paginationProps} />
        </LoadingOverlay>

        <ImagePreviewDialog
          open={!!preview}
          onOpenChange={(open) => !open && setPreview(null)}
          url={preview?.url}
          originalUrl={preview?.originalUrl}
          title={preview?.title}
          ensurePreviewSource={preview?.sourceUrl}
        />

        <OrderLogTimelineDialog
          open={!!historyTarget}
          onOpenChange={(open) => !open && setHistoryTarget(null)}
          orderId={historyTarget?.id}
          productionId={historyTarget?.productionId}
        />

        <BulkProductionIdDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          mode="filter"
          onApply={applyBulk}
          initialIds={bulkIds}
        />
      </div>
    </TooltipProvider>
  );
}
