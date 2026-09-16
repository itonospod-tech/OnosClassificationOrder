import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  History,
} from 'lucide-react';
import type { WorkshopAvailableFilters, WorkshopStageFilterKey } from 'shared';
import { useVirtualizer } from '@tanstack/react-virtual';

import { PATHS } from '@/constants/paths';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { BulkEditToolbar } from '@/components/orders/BulkEditToolbar';
import { CancelledBadge } from '@/components/orders/CancelledBadge';
import { DesignerBacklogDialog } from '@/components/orders/DesignerBacklogDialog';
import { HeldBadge, OnospodHoldBadge } from '@/components/orders/HeldBadge';
import { OrderDetailDialog } from '@/components/orders/OrderDetailDialog';
import type { OrderFilterFacet } from '@/components/orders/OrderFilterBar';
import { OrderLogTimelineDialog } from '@/components/orders/OrderLogTimelineDialog';
import { OrderRowActionsMenu } from '@/components/orders/OrderRowActionsMenu';
import {
  buildColGroups,
  GroupCellContent,
  groupTitle,
  type ResolvedColGroup,
  WORKSHOP_COLS,
  type WorkshopOrderRow,
  type WorkshopRenderCtx,
} from '@/components/orders/workshopTableConfig';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { isCancelled, isHeld, showOnospodHoldFlag } from '@/utils/orderActions';

import { useDebounce } from '@/hooks/useDebounce';
import { useFactoryScope } from '@/hooks/useFactoryScope';
import { useIsNoTool } from '@/hooks/useIsNoTool';
import { usePendingDesignsPoll } from '@/hooks/usePendingDesignsPoll';
import { usePermission } from '@/hooks/usePermission';
import { useSidebarResetSignal } from '@/hooks/useSidebarResetSignal';

import { DesignerSummaryPanel } from './DesignerSummaryPanel';
import { STAGE_COLORS } from './workshop/stageColors';
import { WorkshopStageStrip } from './workshop/WorkshopStageStrip';
import { type WorkshopPillKey, WorkshopToolbar } from './workshop/WorkshopToolbar';
import { TYPE_NONE_TOKEN, WorkshopTypeRail } from './workshop/WorkshopTypeRail';

// Types and column config live in workshopTableConfig.tsx (shared with OrdersMiniTable).
type OrderRow = WorkshopOrderRow;
type RenderCtx = WorkshopRenderCtx;
const COLS = WORKSHOP_COLS;

// Pagination unit is product types (not rows). 20 products fits comfortably
// in the collapsed view; user can drill in via chevron.
const DEFAULT_PAGE_SIZE = 20;


function todayISO(): string {
  // Local date components — KHÔNG dùng toISOString() (UTC) vì sẽ trả hôm
  // trước khi ở UTC+ buổi sáng.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Combo = (size + loại vải + mockup). Dùng để đếm ×N + highlight combo trùng.
const comboKeyOf = (r: OrderRow) => `${r.size || ''}|${r.fabricType || ''}|${r.mockupOriginalUrl || r.mockupUrl || ''}`;

// Virtualization cần cột width CỐ ĐỊNH (table-fixed) để không giật khi cuộn.
const CHECKBOX_COL_W = 32; // khớp `w-8` + sticky left-8 của group đầu tiên
const ACTIONS_COL_W = 64; // khớp `w-16` cột action cuối

// Scroll thật của app nằm ở `<main className="overflow-auto">` (MainLayout),
// KHÔNG phải window → virtualizer phải trỏ đúng scroll container này. Tìm
// ancestor gần nhất có overflow-y auto/scroll; fallback documentElement.
const getScrollParent = (node: HTMLElement | null): HTMLElement => {
  let el = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return el;
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement;
};

interface ProductRowProps {
  row: OrderRow;
  groups: ResolvedColGroup[];
  ctx: RenderCtx;
  comboN: number;
  isHeaviest: boolean;
  isSelected: boolean;
  noTool: boolean;
  onCheckboxChange: (id: string) => void;
  onCheckboxMouseDown: (shiftKey: boolean) => void;
  onHistory: (id: string, productionId: string) => void;
  patchRow: (id: string, patch: Partial<OrderRow>) => void;
  /** react-virtual: đo chiều cao thật của row (dynamic size) + map data-index. */
  measureRef?: (el: HTMLElement | null) => void;
  dataIndex?: number;
}

/**
 * 1 hàng đơn (product row) — `React.memo` để tick checkbox / mở preview / poll
 * design KHÔNG re-render toàn bảng. Props đều primitive/stable (isSelected,
 * comboN, noTool…) hoặc callback đã `useCallback` ở parent → shallow-compare
 * chuẩn. `ctx` (renderCtx) memo ở parent nên identity ổn định.
 */
const ProductRow = React.memo(function ProductRow({
  row,
  groups,
  ctx,
  comboN,
  isHeaviest,
  isSelected,
  noTool,
  onCheckboxChange,
  onCheckboxMouseDown,
  onHistory,
  patchRow,
  measureRef,
  dataIndex,
}: ProductRowProps) {
  const { t } = useTranslation('orders');
  const cancelled = isCancelled(row);
  const held = isHeld(row);
  const dim = cancelled || held;
  // Flatten toàn bộ member cols của mọi group → render 1 lần, lookup lại theo
  // key khi build từng group cell. Memo theo [groups, row, ctx, held] giống
  // logic renderedCells cũ — chỉ đổi từ mảng theo index sang Map theo key vì
  // giờ 1 group cell cần nhiều member render ghép lại.
  // Đơn đang GIỮ → override canEditField=false cho mọi cell (read-only). Menu
  // "..." (Mở giữ) nằm ở cột riêng nên vẫn thao tác được.
  const renderedByKey = useMemo(() => {
    const effectiveCtx = held ? { ...ctx, canEditField: () => false } : ctx;
    const map = new Map<string, React.ReactNode>();
    for (const g of groups) {
      for (const c of g.members) map.set(c.key, c.render(row, effectiveCtx));
    }
    return map;
  }, [groups, row, ctx, held]);
  // Trải thẳng bg classes (KHÔNG dùng bg-inherit vì sticky cell cần own bg để
  // mask cell scroll phía sau — `inherit` không reliable với TR background).
  // BẮT BUỘC màu ĐẶC (không alpha `/NN`) — sticky cell (checkbox/identity/action)
  // dùng chính class này làm nền che nội dung cuộn phía sau; màu có alpha sẽ để
  // lộ chữ của cột khác đè lên khi cuộn ngang (cột "Mã đơn / Ưu tiên" bị xuyên thấu).
  // Bản 2026-09 (Orders.md §10.2b): KHÔNG tô nền cả hàng theo trạng thái nữa —
  // "thiếu tool"/"đang giữ" chỉ còn dải 2px bên trái + chip; combo nặng nhất giữ
  // badge ×N màu cảnh báo. Nền chỉ đổi khi ĐANG CHỌN (cần cho thao tác hàng loạt).
  const rowBgClass = isSelected ? 'bg-indigo-50 dark:bg-indigo-950' : 'bg-card';
  return (
    <TableRow
      ref={measureRef}
      data-index={dataIndex}
      className={cn(
        'group',
        rowBgClass,
        !isSelected && 'hover:bg-muted/30',
        noTool && 'border-l-2 border-l-sky-400 dark:border-l-sky-400/60',
        held && 'border-l-2 border-l-amber-400 dark:border-l-amber-400/60',
        dim && 'opacity-60',
      )}
    >
      <TableCell className={cn('sticky left-0 z-10', rowBgClass)}>
        <input
          type="checkbox"
          checked={isSelected}
          onMouseDown={(e) => onCheckboxMouseDown(e.shiftKey)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onCheckboxChange(row._id)}
          title={t('tableWorkshop.shiftClickRangeSelect')}
        />
      </TableCell>
      {groups.map((g, gi) => (
        <TableCell
          key={g.key}
          className={cn(
            'py-1.5 align-top',
            gi === 0 && cn('sticky left-8 z-10 shadow-[1px_0_0_0_var(--border)]', rowBgClass),
          )}
        >
          <div className="flex flex-col gap-1">
            {gi === 0 && cancelled && <CancelledBadge reason={row.cancelReason} />}
            {gi === 0 && held && !cancelled && <HeldBadge reason={row.holdReason} source={row.holdSource} />}
            {gi === 0 && showOnospodHoldFlag(row) && <OnospodHoldBadge />}
            <GroupCellContent
              group={g}
              renderedByKey={renderedByKey}
              extra={(key) =>
                key === 'mockupTypeSize' && comboN > 1 ? (
                  <Badge
                    variant={isHeaviest ? 'warning' : 'secondary'}
                    className="font-mono text-[10px] px-1 py-0 shrink-0"
                    title={t('tableWorkshop.comboHint', { count: comboN })}
                  >
                    ×{comboN}
                  </Badge>
                ) : null
              }
            />
          </div>
        </TableCell>
      ))}
      <TableCell className={cn('sticky right-0 z-10', rowBgClass)}>
        {/* Thao tác hàng chỉ hiện khi rê chuột / focus — bảng đỡ rối; menu "..." mở ra vẫn giữ. */}
        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [&:has([data-state=open])]:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t('tableWorkshop.history')}
            onClick={() => onHistory(row._id, row.productionId)}
          >
            <History size={13} className="text-muted-foreground" />
          </Button>
          <OrderRowActionsMenu order={row} onChanged={(u) => patchRow(u._id, u)} />
        </div>
      </TableCell>
    </TableRow>
  );
});

export function OrderTableWorkshop() {
  const { t } = useTranslation('orders');
  const { has, canViewField, canEditField, roleName } = usePermission();
  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);

  // URL params (prefix `w` = workshop). F5 giữ nguyên filter. Single-select
  // mỗi facet sau khi chuyển sang SelectFilter — multi-value support removed.
  const [searchParams, setSearchParams] = useSearchParams();
  const factoryScope = useFactoryScope();

  const [items, setItems] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('wpage'));
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const s = Number(searchParams.get('wsize'));
    return Number.isFinite(s) && s > 0 ? s : DEFAULT_PAGE_SIZE;
  });
  // `?pid=<productionId>` — filter RIÊNG, tìm CHÍNH XÁC 1 đơn theo productionId
  // (khác `search`/`wsearch` — match "contains" trên 5 field). Gửi xuống BE qua
  // param `productionIds` (exact, case-insensitive — có sẵn, dùng chung với
  // "Nhiều mã") thay vì `search`. Persist thật vào URL (không tự xóa) — F5/share
  // link giữ nguyên. Set 1 lần lúc mount, sau đó là state bình thường như mọi
  // filter khác (đổi qua chip "Mã đơn" hoặc `clearAllFilters`).
  const [pid, setPid] = useState(() => searchParams.get('pid')?.trim() || '');

  // Default = today (workshop dùng "đơn hôm nay" làm view chính), TRỪ khi có
  // `pid` lúc mount (tìm chính xác 1 đơn, không giới hạn ngày — đơn có thể
  // KHÔNG thuộc "hôm nay"). User vẫn có thể chọn range khác hoặc clear hẳn
  // qua DateRangePicker.
  const [createdFrom, setCreatedFrom] = useState(() => searchParams.get('wfrom') || (pid ? '' : todayISO()));
  const [createdTo, setCreatedTo] = useState(() => searchParams.get('wto') || (pid ? '' : todayISO()));
  const [search, setSearch] = useState(() => searchParams.get('wsearch') || '');
  const debouncedSearch = useDebounce(search, 300);
  // Lọc bulk theo danh sách productionId (modal "Nhiều mã"). Transient — không
  // sync URL vì danh sách có thể rất dài. Loại trừ nhau với search thường.
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Anchor cho shift+click range-select. Update mỗi lần user click checkbox. */
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  /**
   * Bắt shiftKey ở mousedown (chạy TRƯỚC native checkbox toggle), đọc lại
   * trong onChange. Không thể đọc shiftKey từ onChange synthetic event vì
   * change event không carry modifier keys.
   */
  const shiftKeyRef = useRef(false);
  const [preview, setPreview] = useState<{
    url: string;
    originalUrl?: string;
    title: string;
    sourceUrl?: string;
  } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ id: string; productionId: string } | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ id: string; productionId: string } | null>(null);
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());

  const toggleType = useCallback((t: string) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  // Filters by workshop code — single value mỗi facet.
  const [filterPrintStatus, setFilterPrintStatus] = useState<string>(() => searchParams.get('wprint') || '');
  const [filterToolResultNote, setFilterToolResultNote] = useState<string>(() => searchParams.get('wnote') || '');
  const [filterAssignee, setFilterAssignee] = useState<string>(() => searchParams.get('wassign') || '');
  const [filterProductionError, setFilterProductionError] = useState<string>(() => searchParams.get('werror') || '');
  const [filterFabricType, setFilterFabricType] = useState<string>(() => searchParams.get('wfabric') || '');
  const [filterMachineNumber, setFilterMachineNumber] = useState<string>(() => searchParams.get('wmnum') || '');
  const [filterToolResult, setFilterToolResult] = useState<string>(() => searchParams.get('wtool') || '');
  const [filterErrorFile, setFilterErrorFile] = useState<string>(() => searchParams.get('werrfile') || '');
  const [filterDesignerStatus, setFilterDesignerStatus] = useState<string>(() => searchParams.get('wdstatus') || '');
  const [filterUserSku, setFilterUserSku] = useState<string>(() => searchParams.get('wusersku') || '');
  // Toggle "Đang giữ" — chỉ hiện đơn đang bị giữ (heldAt set).
  const [filterHeld, setFilterHeld] = useState<boolean>(() => searchParams.get('wheld') === 'true');
  // Toggle "Đã hủy" — chỉ hiện đơn đã hủy (cancelledAt set). Mặc định tắt: đơn
  // hủy vẫn hiện tô xám trong list nhưng KHÔNG tính vào facet count.
  const [filterCancelled, setFilterCancelled] = useState<boolean>(() => searchParams.get('wcancel') === 'true');
  // Ô phễu chặng (Orders.md §10.2b) — BE `workshopStage`, URL `wstage`.
  const [filterStage, setFilterStage] = useState<WorkshopStageFilterKey | ''>(
    () => (searchParams.get('wstage') as WorkshopStageFilterKey | null) || '',
  );
  // Pill "Ưu tiên" — BE `priority=__any__` (đơn có đặt ưu tiên), URL `wprio`.
  const [filterPriority, setFilterPriority] = useState<string>(() => searchParams.get('wprio') || '');
  // Rail loại sản phẩm (bản 3): '' = Tất cả, tên loại, hoặc `__none__` — BE `type` (gửi dạng lặp
  // `append`, KHÔNG `set`, vì tên loại có thể chứa dấu phẩy — mirror Classic `ctype`), URL `wtype`.
  const [filterType, setFilterType] = useState<string>(() => searchParams.get('wtype') || '');
  // Bảng tổng hợp designer thu gọn mặc định — mở qua nút "Tồn thiết kế" trên thanh công cụ.
  const [showDesignerSummary, setShowDesignerSummary] = useState(false);

  // Sync state → URL (replace). Strip default/empty values.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        pid.trim() ? sp.set('pid', pid.trim()) : sp.delete('pid');
        search ? sp.set('wsearch', search) : sp.delete('wsearch');
        createdFrom ? sp.set('wfrom', createdFrom) : sp.delete('wfrom');
        createdTo ? sp.set('wto', createdTo) : sp.delete('wto');
        filterPrintStatus ? sp.set('wprint', filterPrintStatus) : sp.delete('wprint');
        filterToolResultNote ? sp.set('wnote', filterToolResultNote) : sp.delete('wnote');
        filterAssignee ? sp.set('wassign', filterAssignee) : sp.delete('wassign');
        filterProductionError ? sp.set('werror', filterProductionError) : sp.delete('werror');
        filterFabricType ? sp.set('wfabric', filterFabricType) : sp.delete('wfabric');
        filterMachineNumber ? sp.set('wmnum', filterMachineNumber) : sp.delete('wmnum');
        filterToolResult ? sp.set('wtool', filterToolResult) : sp.delete('wtool');
        filterErrorFile ? sp.set('werrfile', filterErrorFile) : sp.delete('werrfile');
        filterDesignerStatus ? sp.set('wdstatus', filterDesignerStatus) : sp.delete('wdstatus');
        filterUserSku ? sp.set('wusersku', filterUserSku) : sp.delete('wusersku');
        filterHeld ? sp.set('wheld', 'true') : sp.delete('wheld');
        filterCancelled ? sp.set('wcancel', 'true') : sp.delete('wcancel');
        filterStage ? sp.set('wstage', filterStage) : sp.delete('wstage');
        filterPriority ? sp.set('wprio', filterPriority) : sp.delete('wprio');
        filterType ? sp.set('wtype', filterType) : sp.delete('wtype');
        page > 1 ? sp.set('wpage', String(page)) : sp.delete('wpage');
        pageSize !== DEFAULT_PAGE_SIZE ? sp.set('wsize', String(pageSize)) : sp.delete('wsize');
        return sp;
      },
      { replace: true },
    );
  }, [
    pid,
    search,
    createdFrom,
    createdTo,
    filterPrintStatus,
    filterToolResultNote,
    filterAssignee,
    filterProductionError,
    filterFabricType,
    filterMachineNumber,
    filterToolResult,
    filterErrorFile,
    filterDesignerStatus,
    filterUserSku,
    filterHeld,
    filterCancelled,
    filterStage,
    filterPriority,
    filterType,
    page,
    pageSize,
    setSearchParams,
  ]);

  const [workshopFilters, setWorkshopFilters] = useState<WorkshopAvailableFilters | null>(null);

  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  // Permission filter theo field — thứ tự KHÔNG còn ý nghĩa (group quyết định
  // thứ tự hiển thị, xem `colGroups` bên dưới), chỉ dùng để tra cứu theo key.
  const visibleCols = useMemo(() => COLS.filter((c) => !c.perm || canViewField(c.key)), [canViewField]);

  // Server returns groups of products (page = N products, not N rows). We keep
  // the flat `items` list for things like bulk select + checkbox state, but
  // also retain the group structure to render section headers without
  // recomputing per-product totals on the client.
  const [groups, setGroups] = useState<
    Array<{ type: string; totalOrders: number; totalQuantity: number; orders: OrderRow[] }>
  >([]);

  const buildFilterParams = (): URLSearchParams => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    // `pid` (tìm chính xác 1 đơn) ưu tiên hơn "Nhiều mã" nếu cả 2 cùng set —
    // 2 filter dùng chung 1 param BE (`productionIds`, exact match) nên không
    // kết hợp được cả 2 cùng lúc.
    const pidTrimmed = pid.trim();
    if (pidTrimmed) params.set('productionIds', pidTrimmed);
    else if (bulkIds.length) params.set('productionIds', bulkIds.join(','));
    if (filterPrintStatus) params.set('printStatus', filterPrintStatus);
    if (filterToolResultNote) params.set('toolResultNote', filterToolResultNote);
    if (filterAssignee) params.set('assignee', filterAssignee);
    if (filterProductionError) params.set('productionError', filterProductionError);
    if (filterFabricType) params.set('fabricType', filterFabricType);
    if (filterMachineNumber) params.set('machineNumber', filterMachineNumber);
    if (filterToolResult) params.set('toolResult', filterToolResult);
    if (filterErrorFile) params.set('errorFile', filterErrorFile);
    if (filterDesignerStatus) params.set('designerStatus', filterDesignerStatus);
    if (filterUserSku) params.set('userSku', filterUserSku);
    if (filterHeld) params.set('held', 'true');
    if (filterCancelled) params.set('cancelled', 'true');
    if (filterStage) params.set('workshopStage', filterStage);
    if (filterPriority) params.set('priority', filterPriority);
    if (filterType) params.append('type', filterType);
    if (createdFrom) params.set('createdFrom', createdFrom);
    if (createdTo) params.set('createdTo', createdTo);
    // Phạm vi xưởng từ "cụm menu theo xưởng" ở sidebar. Lọc TƯỜNG MINH nên đơn
    // xưởng ngoài luồng sản xuất (US) cũng xem được ở cụm của chính nó.
    if (factoryScope) params.set('factoryId', factoryScope);
    return params;
  };

  const fetchData = async () => {
    const params = buildFilterParams();
    params.set('page', String(page));
    params.set('limit', String(pageSize));

    try {
      const res = await RepositoryRemote.order.getOrdersGrouped('?' + params.toString());
      const grouped = (res.data?.data || []) as Array<{
        type: string;
        totalOrders: number;
        totalQuantity: number;
        orders: OrderRow[];
      }>;
      setGroups(grouped);
      setItems(grouped.flatMap((g) => g.orders));
      // total = number of product types (server pagination unit).
      setTotal(res.data?.total || 0);
      // Default: every product section is collapsed. User clicks chevron or
      // "Mở hết" to expand. TRỪ khi mở từ link `?pid=` — mở hết sẵn để thấy
      // ngay đơn cần tìm, không phải tự bấm mở group.
      // Chọn 1 loại ở rail → mở sẵn (bảng phải là danh sách đơn của loại đó, không có hàng nhóm).
      setCollapsedTypes(pid.trim() || filterType ? new Set() : new Set(grouped.map((g) => g.type || t('tableWorkshop.noTypeName'))));
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const fetchFilters = async () => {
    const params = buildFilterParams();
    try {
      const res = await RepositoryRemote.order.getWorkshopFilters('?' + params.toString());
      setWorkshopFilters((res.data?.data || null) as WorkshopAvailableFilters | null);
    } catch (err) {
      handleAxiosError(err);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchData(), fetchFilters()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    page,
    pageSize,
    debouncedSearch,
    pid,
    bulkIds,
    filterPrintStatus,
    filterToolResultNote,
    filterAssignee,
    filterProductionError,
    filterFabricType,
    filterMachineNumber,
    filterToolResult,
    filterErrorFile,
    filterDesignerStatus,
    filterUserSku,
    filterHeld,
    filterCancelled,
    filterStage,
    filterPriority,
    filterType,
    createdFrom,
    createdTo,
    factoryScope,
  ]);

  /**
   * Optimistic update sau khi cell PATCH thành công. Phải đồng bộ CẢ 2 state:
   *   - `items` (flat list, dùng cho select-all + visibleOrderedIds + poll)
   *   - `groups` (grouped-by-type, RENDER chính của table — body map từ
   *     `groups[].orders`). Nếu chỉ update `items` thì UI không đổi cho đến
   *     khi user F5 (fetchData ghi đè `groups`).
   */
  const patchRow = useCallback((id: string, patch: Partial<OrderRow>) => {
    setItems((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)));
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        orders: g.orders.map((r) => (r._id === id ? { ...r, ...patch } : r)),
      })),
    );
  }, []);

  // Panel Designer summary chỉ tự fetch theo filter → mọi thay đổi dữ liệu do
  // chính người dùng gây ra (sửa ô inline, bulk, nút "Tải lại") phải bump cờ này.
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const bumpSummary = useCallback(() => setSummaryRefresh((v) => v + 1), []);

  /** patchRow cho thao tác NGƯỜI DÙNG — patch row + làm mới panel KPI. Poll
   * ảnh (usePendingDesignsPoll) vẫn dùng `patchRow` trần, không bump. */
  const patchRowByUser = useCallback(
    (id: string, patch: Partial<OrderRow>) => {
      patchRow(id, patch);
      bumpSummary();
    },
    [patchRow, bumpSummary],
  );

  usePendingDesignsPoll(items, patchRow);

  const openPreview = useCallback(
    (url: string, title: string, originalUrl?: string, sourceUrl?: string) =>
      setPreview({ url, originalUrl, title, sourceUrl }),
    [],
  );

  const onCheckboxMouseDown = useCallback((shiftKey: boolean) => {
    shiftKeyRef.current = shiftKey;
  }, []);

  const onHistory = useCallback((id: string, productionId: string) => setHistoryTarget({ id, productionId }), []);

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map((it) => it._id));
    });
  };

  type DecoratedGroup = {
    type: string;
    totalOrders: number;
    totalQuantity: number;
    maxCombo: number;
    sortedOrders: OrderRow[];
    rowMeta: Map<string, { comboN: number; isHeaviest: boolean }>;
  };

  /**
   * Decorate 1 lần khi `groups` đổi: đếm combo (size+vải+mockup) + sort theo
   * combo desc + meta ×N/heaviest theo rowId. KHÔNG phụ thuộc selection/collapse
   * → tick checkbox / mở-đóng group KHÔNG tính lại sort. Trước đây comboCount +
   * sort chạy lại MỖI render ngay trong body (một lần cho render, một lần nữa
   * trong visibleOrderedIds) → đây là hot-path chính khi bảng nhiều đơn.
   */
  const decoratedGroups = useMemo<DecoratedGroup[]>(() => {
    return groups.map((g) => {
      const comboCount = new Map<string, number>();
      for (const r of g.orders) {
        const k = comboKeyOf(r);
        comboCount.set(k, (comboCount.get(k) || 0) + 1);
      }
      const maxCombo = Math.max(0, ...Array.from(comboCount.values()));
      const sortedOrders = [...g.orders].sort((a, b) => {
        const pa = a.priority || 0;
        const pb = b.priority || 0;
        if (pb !== pa) return pb - pa;
        const ca = comboCount.get(comboKeyOf(a)) || 1;
        const cb = comboCount.get(comboKeyOf(b)) || 1;
        if (cb !== ca) return cb - ca;
        return comboKeyOf(a).localeCompare(comboKeyOf(b));
      });
      const rowMeta = new Map<string, { comboN: number; isHeaviest: boolean }>();
      for (const r of g.orders) {
        const n = comboCount.get(comboKeyOf(r)) || 1;
        rowMeta.set(r._id, { comboN: n, isHeaviest: n > 1 && n === maxCombo });
      }
      return {
        type: g.type || t('tableWorkshop.noTypeName'),
        totalOrders: g.totalOrders,
        totalQuantity: g.totalQuantity,
        maxCombo,
        sortedOrders,
        rowMeta,
      };
    });
  }, [groups, t]);

  /**
   * Flat ordered list of currently visible order IDs (skip groups bị collapse).
   * Khớp THỨ TỰ render dưới body — anchor index cho shift+click range select.
   */
  const visibleOrderedIds = useMemo(() => {
    const out: string[] = [];
    for (const g of decoratedGroups) {
      if (collapsedTypes.has(g.type)) continue;
      for (const r of g.sortedOrders) out.push(r._id);
    }
    return out;
  }, [decoratedGroups, collapsedTypes]);

  // Refs mirror state để `handleCheckboxChange` giữ identity ổn định (useCallback
  // deps rỗng) mà vẫn đọc được giá trị mới nhất tại thời điểm click.
  const selectedRef = useRef(selected);
  const lastClickedIdRef = useRef(lastClickedId);
  const visibleOrderedIdsRef = useRef<string[]>(visibleOrderedIds);
  selectedRef.current = selected;
  lastClickedIdRef.current = lastClickedId;
  visibleOrderedIdsRef.current = visibleOrderedIds;

  // Đếm số đơn đã chọn theo product type — cho badge "x/y chọn" + trạng thái
  // checkbox group header. Memo để không quét toàn bộ orders mỗi render.
  const selectedCountByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of decoratedGroups) {
      let c = 0;
      for (const r of g.sortedOrders) if (selected.has(r._id)) c++;
      m.set(g.type, c);
    }
    return m;
  }, [selected, decoratedGroups]);

  // ---- Virtualization (window scroll) --------------------------------------
  // Flatten groups + rows (theo collapse) thành 1 danh sách phẳng để virtualize:
  // mỗi item là 'header' (dòng tiêu đề sản phẩm) hoặc 'row' (1 đơn). Cuộn tới
  // đâu render tới đó → không mount hàng trăm DOM row 1 lúc khi mở nhóm lớn.
  type FlatItem =
    | { kind: 'header'; key: string; group: DecoratedGroup }
    | {
        kind: 'row';
        key: string;
        row: OrderRow;
        groupType: string;
        comboN: number;
        isHeaviest: boolean;
      };
  const flatItems = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    for (const g of decoratedGroups) {
      // Đang chọn 1 loại ở rail → bỏ hàng tiêu đề nhóm (tiêu đề đã nằm trên đầu bảng phải).
      if (!filterType) out.push({ kind: 'header', key: `h:${g.type}`, group: g });
      if (collapsedTypes.has(g.type)) continue;
      for (const row of g.sortedOrders) {
        const meta = g.rowMeta.get(row._id);
        out.push({
          kind: 'row',
          key: row._id,
          row,
          groupType: g.type,
          comboN: meta?.comboN ?? 1,
          isHeaviest: meta?.isHeaviest ?? false,
        });
      }
    }
    return out;
  }, [decoratedGroups, collapsedTypes, filterType]);

  // Group các field liên quan vào 1 cột hiển thị (xem `buildColGroups` trong
  // workshopTableConfig.tsx — dùng chung với OrdersMiniTable/OrderFactoryTab) —
  // chỉ giữ member nào còn trong visibleCols (đã lọc quyền), bỏ hẳn group nào
  // rỗng (mọi member đều bị ẩn quyền).
  const colGroups = useMemo(() => buildColGroups(visibleCols, roleName), [visibleCols, roleName]);

  // Width cố định (table-fixed) tính theo GROUP (không phải field lẻ) + tổng
  // width bảng cho horizontal scroll — đây là phần giảm scroll ngang chính:
  // nhiều field xếp CHIỀU DỌC trong 1 group thay vì mỗi field 1 cột ngang.
  const totalTableWidth = useMemo(
    () => CHECKBOX_COL_W + colGroups.reduce((s, g) => s + g.width, 0) + ACTIONS_COL_W,
    [colGroups],
  );

  // scrollMargin = offset (tính từ đỉnh document) của <tbody> — nơi row index 0
  // bắt đầu. Re-measure khi layout phía trên đổi (panel/filter chips) qua
  // ResizeObserver trên rootRef (bọc TOÀN BỘ nội dung trong scroll container,
  // KHÔNG dùng document.body — body không co giãn theo nội dung bên trong
  // scroll container "main.overflow-auto" nên không bắt được thay đổi layout
  // của filter/banner phía trên bảng, khiến scrollMargin bị "đơ" từ lần đo
  // đầu tiên → lệch khoảng trắng lớn trên đầu bảng khi thu gọn hết nhóm, vì
  // sai số cố định (px) trở nên đáng kể so với tổng chiều cao danh sách ngắn)
  // + window resize (sum getBoundingClientRect().top + scrollY ổn định khi
  // cuộn → chỉ cần đo lại lúc layout đổi).
  const rootRef = useRef<HTMLDivElement>(null);
  /** Vùng cuộn của THÂN BẢNG (dọc + ngang) — virtualizer bám vào đây thay cho <main>. */
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Xác định scroll container thật (main.overflow-auto) sau khi mount.
  useLayoutEffect(() => {
    // Bảng tự cuộn trong card (07/09/2026) → scroll container là chính div thân bảng; fallback
    // scroll parent gần nhất nếu vì lý do nào đó ref chưa gắn.
    const sc = tableScrollRef.current ?? getScrollParent(rootRef.current);
    scrollElRef.current = sc;
    setScrollEl(sc);
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const body = tbodyRef.current;
      const sc = scrollElRef.current;
      if (!body || !sc) return;
      // Offset của <tbody> trong nội dung cuộn của scroll container (không đổi
      // khi cuộn vì trừ đi bù cộng scrollTop) — chỉ đo lại khi layout đổi.
      const margin = body.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      setScrollMargin(Math.max(0, margin));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [scrollEl]);

  const rowVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollEl,
    // Ước lượng SÁT chiều cao thật. Row giờ xếp field CHIỀU DỌC trong từng
    // group (group đầy nhất — "Mã đơn/Ưu tiên" — có tới 4 dòng) nên cao hơn
    // trước (~68px/2-3 dòng) → estimate ~130px. measureElement vẫn tự đo lại
    // chính xác sau khi render.
    estimateSize: (i) => (flatItems[i]?.kind === 'header' ? 42 : 130),
    overscan: 12,
    scrollMargin,
    getItemKey: (i) => flatItems[i]?.key ?? i,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualPadTop = virtualItems.length ? virtualItems[0].start - rowVirtualizer.options.scrollMargin : 0;
  const virtualPadBottom = virtualItems.length
    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0;
  const fullColSpan = colGroups.length + 2;

  /**
   * Excel-style range select. Native checkbox toggle chạy bình thường (visual
   * sync chính xác), state sync ở onChange. shiftKey lấy từ ref đã set ở
   * mousedown vì change event không carry modifier keys.
   *
   * Trước đó dùng preventDefault trên onClick → React skip update DOM `checked`
   * cho row vừa click → state đúng nhưng UI miss tick row cuối.
   */
  const handleCheckboxChange = useCallback((id: string) => {
    const isShift = shiftKeyRef.current;
    shiftKeyRef.current = false;
    const lastClicked = lastClickedIdRef.current;
    const ordered = visibleOrderedIdsRef.current;
    if (isShift && lastClicked && lastClicked !== id) {
      const lastIdx = ordered.indexOf(lastClicked);
      const curIdx = ordered.indexOf(id);
      if (lastIdx >= 0 && curIdx >= 0) {
        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        const range = ordered.slice(from, to + 1);
        // Native đã toggle row hiện tại — newState = trạng thái sau toggle.
        const newState = !selectedRef.current.has(id);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const rid of range) {
            if (newState) next.add(rid);
            else next.delete(rid);
          }
          return next;
        });
        setLastClickedId(id);
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);
  }, []);

  type GroupSelectionState = 'all' | 'some' | 'none';

  const toggleGroupSelection = useCallback((orders: OrderRow[]) => {
    setSelected((prev) => {
      const allSelected = orders.length > 0 && orders.every((o) => prev.has(o._id));
      const next = new Set(prev);
      if (allSelected) {
        for (const o of orders) next.delete(o._id);
      } else {
        for (const o of orders) next.add(o._id);
      }
      return next;
    });
  }, []);

  const openDetail = useCallback((id: string, productionId: string) => setDetailTarget({ id, productionId }), []);
  const renderCtx: RenderCtx = useMemo(
    () => ({ canEditField, patchRow: patchRowByUser, openPreview, openDetail, t }),
    [canEditField, patchRowByUser, openPreview, openDetail, t],
  );
  const isNoTool = useIsNoTool();

  // Designer summary chỉ hiện cho role có quyền xem stats designer.
  const canSeeDesignerSummary = has('page.designer_stats') || has('designer.task.assign');

  // Inject "Chưa gán" option vào assignee SelectFilter (token __none__).
  const assigneeOptions = useMemo(() => {
    const base = workshopFilters?.assignee || [];
    // Đã có __none__ từ BE thì giữ nguyên; chưa có thì prepend option fake với
    // count tính từ /designer-breakdown — đơn giản hoá: chỉ thêm static option.
    if (base.find((o) => o.value === '__none__')) return base;
    return [{ value: '__none__', label: t('listTab.unassigned'), count: 0 }, ...base];
  }, [workshopFilters?.assignee, t]);

  const designerStatusOptions = workshopFilters?.designerStatus || [];

  // Reset chọn đơn về 0 mỗi khi BẤT KỲ filter nào đổi (search/date/facet).
  // KHÔNG phụ thuộc page/pageSize → đổi trang vẫn giữ selection.
  useEffect(() => {
    setSelected(new Set());
    setLastClickedId(null);
  }, [
    debouncedSearch,
    bulkIds,
    createdFrom,
    createdTo,
    filterPrintStatus,
    filterToolResultNote,
    filterAssignee,
    filterProductionError,
    filterFabricType,
    filterMachineNumber,
    filterToolResult,
    filterErrorFile,
    filterDesignerStatus,
    filterUserSku,
    filterHeld,
    filterCancelled,
    filterStage,
    filterPriority,
    filterType,
  ]);

  // Định nghĩa facet 1 lần — dùng cho cả OrderFilterBar lẫn chip "đang lọc".
  const facets: OrderFilterFacet[] = [
    {
      key: 'fabricType',
      label: t('tableWorkshop.facets.fabricType'),
      value: filterFabricType,
      onChange: setFilterFabricType,
      options: workshopFilters?.fabricType || [],
      perm: 'order.field.fabricType.view',
    },
    {
      key: 'machineNumber',
      label: t('tableWorkshop.facets.machineNumber'),
      value: filterMachineNumber,
      onChange: setFilterMachineNumber,
      options: workshopFilters?.machineNumber || [],
      perm: 'order.field.machineNumber.view',
    },
    {
      key: 'printStatus',
      label: t('tableWorkshop.facets.printStatus'),
      value: filterPrintStatus,
      onChange: setFilterPrintStatus,
      options: workshopFilters?.printStatus || [],
      perm: 'order.field.printStatus.view',
    },
    {
      key: 'toolResult',
      label: t('tableWorkshop.facets.toolResult'),
      value: filterToolResult,
      onChange: setFilterToolResult,
      options: workshopFilters?.toolResult || [],
      perm: 'order.field.toolResult.view',
    },
    {
      key: 'toolResultNote',
      label: t('tableWorkshop.facets.toolResultNote'),
      value: filterToolResultNote,
      onChange: setFilterToolResultNote,
      options: workshopFilters?.toolResultNote || [],
      perm: 'order.field.toolResultNote.view',
    },
    {
      key: 'errorFile',
      label: t('tableWorkshop.facets.errorFile'),
      value: filterErrorFile,
      onChange: setFilterErrorFile,
      options: workshopFilters?.errorFile || [],
      perm: 'order.field.errorFile.view',
    },
    {
      key: 'userSku',
      label: t('tableWorkshop.facets.userSku'),
      value: filterUserSku,
      onChange: setFilterUserSku,
      options: workshopFilters?.userSku || [],
    },
    {
      key: 'assignee',
      label: t('tableWorkshop.facets.assignee'),
      value: filterAssignee,
      onChange: setFilterAssignee,
      options: assigneeOptions,
      perm: 'order.field.assignee.view',
    },
    {
      key: 'designerStatus',
      label: t('tableWorkshop.facets.designerStatus'),
      value: filterDesignerStatus,
      onChange: setFilterDesignerStatus,
      options: designerStatusOptions,
      hidden: !canSeeDesignerSummary,
    },
    {
      key: 'productionError',
      label: t('tableWorkshop.facets.productionError'),
      value: filterProductionError,
      onChange: setFilterProductionError,
      options: workshopFilters?.productionError || [],
      perm: 'order.field.productionError.view',
    },
  ];


  const clearAllFilters = () => {
    setSearch('');
    setPid('');
    setBulkIds([]);
    setFilterHeld(false);
    setCreatedFrom(todayISO());
    setCreatedTo(todayISO());
    setFilterFabricType('');
    setFilterMachineNumber('');
    setFilterPrintStatus('');
    setFilterToolResult('');
    setFilterToolResultNote('');
    setFilterErrorFile('');
    setFilterAssignee('');
    setFilterDesignerStatus('');
    setFilterProductionError('');
    setFilterUserSku('');
    setFilterStage('');
    setFilterPriority('');
    setFilterType('');
    setPage(1);
  };

  // Click lại menu "Danh sách đơn" ở sidebar khi đang đứng đúng trang này →
  // xóa hết filter (xem `useSidebarResetSignal`).
  useSidebarResetSignal(PATHS.ORDERS_WORKSHOP, clearAllFilters);

  /**
   * Click cell trong summary panel → set filter list. userId='__none__' tương
   * ứng "Chưa gán" (token BE); status null = chỉ filter assignee.
   */
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

  // Modal "Chi tiết tồn đọng" — click 1 ngày → lọc bảng (assignee + ngày) +
  // đóng modal để xem danh sách task ngay trên bảng chính.
  const [backlogOpen, setBacklogOpen] = useState(false);
  const handleBacklogDrill = (userId: string, day: string, status?: string) => {
    setFilterAssignee(userId === '__unassigned__' ? '__none__' : userId);
    setFilterDesignerStatus(status || ''); // status rỗng = mọi trạng thái ngày đó
    if (day === '__nodate__') {
      setCreatedFrom('');
      setCreatedTo('');
    } else {
      setCreatedFrom(day);
      setCreatedTo(day);
    }
    setPage(1);
    setBacklogOpen(false);
  };

  // Build qs để pass vào panel — cùng shape với buildFilterParams nhưng
  // KHÔNG include `page/limit` (panel scoped theo filter, không pagination).
  const summaryFilterQs = useMemo(() => {
    return buildFilterParams().toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedSearch,
    bulkIds,
    filterPrintStatus,
    filterToolResultNote,
    filterAssignee,
    filterProductionError,
    filterFabricType,
    filterMachineNumber,
    filterToolResult,
    filterErrorFile,
    filterDesignerStatus,
    filterHeld,
    filterCancelled,
    createdFrom,
    createdTo,
  ]);

  // Pill "Thiếu tool" = MỌI mã toolResult không thuộc nhóm "Có tool" (mirror
  // `useIsNoTool`), gửi BE dạng danh sách phẩy — khớp cách BE đếm `pillCounts.noTool`.
  const noToolCodes = useMemo(
    () =>
      (workshopFilters?.toolResult || [])
        .map((o) => o.value)
        .filter((v) => v !== '__none__' && isNoTool(v))
        .join(','),
    [workshopFilters?.toolResult, isNoTool],
  );
  const selectedTypeStat = useMemo(
    () => (workshopFilters?.typeStats || []).find((r) => (r.type || TYPE_NONE_TOKEN) === filterType),
    [workshopFilters?.typeStats, filterType],
  );
  const activePills: Record<WorkshopPillKey, boolean> = {
    errorFile: filterErrorFile === '__any__',
    noTool: !!noToolCodes && filterToolResult === noToolCodes,
    unreviewed: filterToolResult === '__none__',
    priority: filterPriority === '__any__',
    held: filterHeld,
  };
  const togglePill = (key: WorkshopPillKey) => {
    switch (key) {
      case 'errorFile':
        setFilterErrorFile((v) => (v === '__any__' ? '' : '__any__'));
        break;
      case 'noTool':
        setFilterToolResult((v) => (v === noToolCodes ? '' : noToolCodes));
        break;
      case 'unreviewed':
        setFilterToolResult((v) => (v === '__none__' ? '' : '__none__'));
        break;
      case 'priority':
        setFilterPriority((v) => (v === '__any__' ? '' : '__any__'));
        break;
      case 'held':
        setFilterHeld((v) => !v);
        break;
    }
    setPage(1);
  };
  return (
    <TooltipProvider delayDuration={200}>
      {/* Khung cột cố định: phễu + thanh công cụ đứng yên, vùng rail|bảng chiếm phần còn lại, CHỈ thân bảng cuộn. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4" ref={rootRef}>
        <WorkshopStageStrip
          filters={workshopFilters}
          activeStage={filterStage}
          onStageChange={(st) => {
            setFilterStage(st);
            setPage(1);
          }}
        />

        <WorkshopToolbar
          onBulkApply={(ids) => {
            setSearch(''); // bulk và search thường loại trừ nhau
            setBulkIds(ids);
            setPage(1);
          }}
          bulkIds={bulkIds}
          createdFrom={createdFrom}
          createdTo={createdTo}
          onDateRangeChange={(f, to) => {
            setCreatedFrom(f);
            setCreatedTo(to);
            setPage(1);
          }}
          facets={facets}
          onClearFilters={clearAllFilters}
          onReload={() => {
            setLoading(true);
            bumpSummary();
            Promise.all([fetchData(), fetchFilters()]).finally(() => setLoading(false));
          }}
          loading={loading}
          pillCounts={workshopFilters?.pillCounts}
          heldCount={workshopFilters?.heldCount ?? 0}
          activePills={activePills}
          onTogglePill={togglePill}
          cancelledCount={workshopFilters?.cancelledCount ?? 0}
          filterCancelled={filterCancelled}
          onToggleCancelled={() => {
            setFilterCancelled((v) => !v);
            setPage(1);
          }}
          designBacklogCount={workshopFilters?.pillCounts?.designBacklog}
          showDesignerSummary={canSeeDesignerSummary ? showDesignerSummary : undefined}
          onToggleDesignerSummary={canSeeDesignerSummary ? () => setShowDesignerSummary((v) => !v) : undefined}
        />

        {canSeeDesignerSummary && showDesignerSummary && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBacklogOpen(true)}>
                <CalendarClock size={14} className="mr-1" />
                {t('tableWorkshop.backlogDetail')}
              </Button>
            </div>
            <DesignerSummaryPanel filterQs={summaryFilterQs} onClickCell={handleSummaryCellClick} refreshKey={summaryRefresh} />
          </div>
        )}

        {/* Vùng rail|bảng chiếm phần còn lại; tối thiểu 260px (màn thấp thì <main> cuộn thay). */}
        <div className="flex min-h-[260px] flex-1 items-stretch gap-4">
          {/* Rail loại sản phẩm — cao bằng vùng bảng, tự cuộn bên trong. */}
          <WorkshopTypeRail
            typeStats={workshopFilters?.typeStats || []}
            totalOrders={workshopFilters?.totalOrders ?? 0}
            selected={filterType}
            onSelect={(ty) => {
              setFilterType(ty);
              setPage(1);
            }}
            className="h-full"
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Table */}
        {/* Card = cột flex: tiêu đề (shrink-0) · thân bảng (flex-1, cuộn dọc+ngang) · chân bảng (shrink-0, luôn thấy). */}
        <LoadingOverlay active={loading && items.length > 0} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
          {/* Tiêu đề bảng phải: CHỈ khi đang chọn 1 loại (xem Tất cả thì ẩn — tổng đã có ở hàng gộp). */}
          {filterType && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[13px] font-semibold text-foreground">
                {filterType
                  ? filterType === TYPE_NONE_TOKEN
                    ? t('tableWorkshop.noTypeName')
                    : filterType
                  : t('workshopBoard.rail.all')}
              </h2>
              <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-secondary-foreground">
                {filterType
                  ? t('tableWorkshop.orderCount', { count: selectedTypeStat?.orders ?? items.length })
                  : t('workshopBoard.rail.allHeader', {
                      orders: workshopFilters?.totalOrders ?? 0,
                      types: workshopFilters?.totalTypes ?? 0,
                    })}
              </span>
              {/* Chia theo xưởng của loại đang chọn (BE `factoryCounts` bỏ qua filter xưởng). */}
              {(workshopFilters?.factoryCounts || []).length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                  {(workshopFilters?.factoryCounts || []).map((f, i) => (
                    <React.Fragment key={f.factoryId}>
                      {i > 0 && <span className="text-muted-foreground">·</span>}
                      <span className="tabular-nums">
                        {f.shortName || f.name || '?'} {f.count}
                      </span>
                    </React.Fragment>
                  ))}
                </span>
              )}
            </div>
            {filterType && selectedTypeStat && (
              <div className="flex flex-wrap items-center gap-1.5">
                {Object.entries(selectedTypeStat.stages || {})
                  .filter(([, n]) => n > 0)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 4)
                  .map(([k, n]) => (
                    <span
                      key={k}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                        STAGE_COLORS[k as keyof typeof STAGE_COLORS]?.chip || 'bg-muted text-muted-foreground',
                        k === filterStage && 'ring-2 ring-indigo-400',
                      )}
                    >
                      {t(`workshopBoard.stages.${k}`)} <span className="tabular-nums">{n}</span>
                    </span>
                  ))}
              </div>
            )}
          </div>
          )}
          <div ref={tableScrollRef} className="min-h-0 flex-1 overflow-auto">
            <Table className="table-fixed" style={{ width: totalTableWidth, minWidth: '100%' }}>
              <colgroup>
                <col style={{ width: CHECKBOX_COL_W }} />
                {colGroups.map((g) => (
                  <col key={g.key} style={{ width: g.width }} />
                ))}
                <col style={{ width: ACTIONS_COL_W }} />
              </colgroup>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 w-8 sticky left-0 z-30 bg-card">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selected.size === items.length}
                      onChange={toggleAll}
                      title={t('tableWorkshop.selectAllOnPage')}
                    />
                  </TableHead>
                  {colGroups.map((g, i) => (
                    <TableHead
                      key={g.key}
                      className={cn(
                        // `overflow-hidden text-ellipsis`: bảng là `table-fixed`
                        // + width cột cố định, mà tiêu đề `whitespace-nowrap` —
                        // chuỗi EN dài hơn VI nên tràn ĐÈ sang cột kế bên
                        // ("FACTORY · FABRIC · MACHINEPRINT STATUS"). Cắt bằng …,
                        // nội dung đầy đủ vẫn ở tooltip `title`.
                        'h-9 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] font-medium uppercase tracking-wide text-muted-foreground',
                        // Group "Mã đơn/Ưu tiên" luôn đứng đầu (i===0) — sticky
                        // cạnh checkbox để khi scroll ngang vẫn nhìn thấy ID.
                        // shadow-r mô phỏng viền cho user biết chỗ sticky kết thúc.
                        i === 0 && 'sticky left-8 z-30 bg-card shadow-[1px_0_0_0_var(--border)]',
                      )}
                      title={`${groupTitle(t, g.key, g.title)} — ${g.members.map((m) => m.label).join(' · ')}`}
                    >
                      {groupTitle(t, g.key, g.title)}
                    </TableHead>
                  ))}
                  <TableHead className="h-9 w-16 sticky right-0 z-30 bg-card"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody ref={tbodyRef}>
                {loading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={fullColSpan} className="text-center py-10">
                      <Spinner size={20} className="text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={fullColSpan} className="text-center py-10 text-sm text-muted-foreground">
                      {t('tableWorkshop.noMatchingOrders')}
                    </TableCell>
                  </TableRow>
                )}
                {/* Spacer trên — chiều cao phần row phía trên vùng đang thấy. */}
                {virtualPadTop > 0 && (
                  <TableRow className="border-0 hover:bg-transparent" style={{ height: virtualPadTop }}>
                    <TableCell colSpan={fullColSpan} className="p-0 border-0" />
                  </TableRow>
                )}
                {virtualItems.map((vi) => {
                  const item = flatItems[vi.index];
                  if (!item) return null;
                  if (item.kind === 'header') {
                    const g = item.group;
                    const selCount = selectedCountByType.get(g.type) || 0;
                    const groupState: GroupSelectionState =
                      selCount === 0 ? 'none' : selCount === g.sortedOrders.length ? 'all' : 'some';
                    return (
                      <TableRow
                        key={vi.key}
                        data-index={vi.index}
                        ref={rowVirtualizer.measureElement}
                        className="bg-card hover:bg-muted/30"
                      >
                        <TableCell className="py-1.5 sticky left-0 z-10 bg-card" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={groupState === 'all'}
                            ref={(el) => {
                              if (el) el.indeterminate = groupState === 'some';
                            }}
                            onChange={() => toggleGroupSelection(g.sortedOrders)}
                            title={t('tableWorkshop.selectAllOfProduct', { count: g.sortedOrders.length })}
                          />
                        </TableCell>
                        {/*
                          `position: sticky` trên 1 <TableCell colSpan={nhiều}>
                          KHÔNG ghim khi cuộn ngang (browser bug thực tế đã xác
                          nhận — colSpan phá sticky). Nhưng tách thành 1 cell
                          hẹp KHÔNG colSpan (chỉ rộng bằng group `identity`)
                          thì lại che mất tên dài. Giải pháp: cell sticky vẫn
                          KHÔNG colSpan (để ghim đúng) nhưng cho nội dung TRÀN
                          (overflow-visible + shrink-0 mọi item, bỏ line-clamp)
                          ra ngoài biên cell — phần tràn đè lên trên cell filler
                          rỗng bên cạnh nhờ z-10 (element sticky luôn vẽ đè lên
                          sibling KHÔNG position). Filler luôn trống (không có
                          nội dung/data thật) nên phần tràn không bao giờ che
                          thông tin khác, kể cả khi đã cuộn ngang.
                        */}
                        <TableCell
                          className="py-1.5 cursor-pointer sticky left-8 z-10 bg-card shadow-[1px_0_0_0_var(--border)] overflow-visible"
                          onClick={() => toggleType(g.type)}
                        >
                          <div className="flex items-center gap-2 text-xs whitespace-nowrap w-max">
                            {collapsedTypes.has(g.type) ? (
                              <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                            )}
                            <span className="font-semibold text-foreground shrink-0 whitespace-nowrap">{g.type}</span>
                            <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                              {t('tableWorkshop.orderCount', { count: g.totalOrders })}
                            </span>
                            {groupState !== 'none' && (
                              <Badge variant="success" className="font-mono text-[10px] shrink-0">
                                {t('tableWorkshop.selectedCount', { selected: selCount, total: g.sortedOrders.length })}
                              </Badge>
                            )}
                            {g.maxCombo > 1 && (
                              <span
                                className="shrink-0 rounded-full bg-amber-50 px-1.5 text-[10px] font-medium tabular-nums text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700"
                                title={t('tableWorkshop.maxComboHint')}
                              >
                                max ×{g.maxCombo}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell
                          colSpan={colGroups.length}
                          className="py-1.5 cursor-pointer bg-card"
                          onClick={() => toggleType(g.type)}
                        />
                      </TableRow>
                    );
                  }
                  return (
                    <ProductRow
                      key={vi.key}
                      measureRef={rowVirtualizer.measureElement}
                      dataIndex={vi.index}
                      row={item.row}
                      groups={colGroups}
                      ctx={renderCtx}
                      comboN={item.comboN}
                      isHeaviest={item.isHeaviest}
                      isSelected={selected.has(item.row._id)}
                      noTool={isNoTool(item.row.toolResult)}
                      onCheckboxChange={handleCheckboxChange}
                      onCheckboxMouseDown={onCheckboxMouseDown}
                      onHistory={onHistory}
                      patchRow={patchRowByUser}
                    />
                  );
                })}
                {/* Spacer dưới — chiều cao phần row phía dưới vùng đang thấy. */}
                {virtualPadBottom > 0 && (
                  <TableRow className="border-0 hover:bg-transparent" style={{ height: virtualPadBottom }}>
                    <TableCell colSpan={fullColSpan} className="p-0 border-0" />
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Chân bảng (phân trang / "Đang xem") — hàng riêng dưới vùng cuộn, luôn thấy như khối tài khoản ở sidebar. */}
          <div className="shrink-0 bg-card">
          {filterType ? (
            <div className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              {t('workshopBoard.rail.viewing', { shown: items.length, total: selectedTypeStat?.orders ?? items.length })}
            </div>
          ) : (
            <PaginationBar
              position="bottom"
              page={page}
              pageSize={pageSize}
              total={total}
              loading={loading}
              onChange={(p, ps) => {
                setPage(p);
                setPageSize(ps);
              }}
            />
          )}
          </div>
        </LoadingOverlay>
          </div>
        </div>

        <BulkEditToolbar
          selectedIds={Array.from(selected)}
          onClear={() => setSelected(new Set())}
          onApplied={() => {
            setSelected(new Set());
            bumpSummary();
            fetchData();
          }}
        />

        <ImagePreviewDialog
          open={!!preview}
          onOpenChange={(o) => !o && setPreview(null)}
          url={preview?.url}
          originalUrl={preview?.originalUrl}
          title={preview?.title}
          ensurePreviewSource={preview?.sourceUrl}
        />

        <OrderLogTimelineDialog
          open={!!historyTarget}
          onOpenChange={(o) => !o && setHistoryTarget(null)}
          orderId={historyTarget?.id}
          productionId={historyTarget?.productionId}
        />

        <OrderDetailDialog
          open={!!detailTarget}
          onOpenChange={(o) => !o && setDetailTarget(null)}
          orderId={detailTarget?.id ?? null}
          productionId={detailTarget?.productionId}
        />

        <DesignerBacklogDialog
          open={backlogOpen}
          onClose={() => setBacklogOpen(false)}
          onDrillDay={handleBacklogDrill}
        />
      </div>
    </TooltipProvider>
  );
}
