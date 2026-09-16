import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Ban, FilterX, History, MousePointerClick, PauseCircle, X } from 'lucide-react';
import type { WorkshopAvailableFilters } from 'shared';

import { PATHS } from '@/constants/paths';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { BulkEditToolbar } from '@/components/orders/BulkEditToolbar';
import { CancelledBadge } from '@/components/orders/CancelledBadge';
import { HeldBadge, OnospodHoldBadge } from '@/components/orders/HeldBadge';
import { OrderDetailDialog } from '@/components/orders/OrderDetailDialog';
import { OrderFilterBar, type OrderFilterFacet } from '@/components/orders/OrderFilterBar';
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
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { isCancelled, isHeld, showOnospodHoldFlag } from '@/utils/orderActions';

import { useDebounce } from '@/hooks/useDebounce';
import { useIsNoTool } from '@/hooks/useIsNoTool';
import { usePendingDesignsPoll } from '@/hooks/usePendingDesignsPoll';
import { usePermission } from '@/hooks/usePermission';
import { useSidebarResetSignal } from '@/hooks/useSidebarResetSignal';

// Types and column config dùng CHUNG với OrderTableWorkshop/OrdersMiniTable — xem workshopTableConfig.tsx.
type OrderRow = WorkshopOrderRow;
type RenderCtx = WorkshopRenderCtx;
const COLS = WORKSHOP_COLS;

const DEFAULT_PAGE_SIZE = 20;

// Màu chip filter — CÙNG palette với OrderTableWorkshop (giữ đồng nhất UI 2 trang).
const FILTER_CHIP_COLORS: Record<string, string> = {
  search: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  date: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  fabricType: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  machineNumber:
    'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  printStatus: 'bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
  toolResult:
    'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  toolResultNote:
    'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
  errorFile: 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800',
  assignee:
    'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800',
  designerStatus:
    'bg-teal-100 text-teal-700 border-teal-300 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800',
  productionError: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  userSku:
    'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300 dark:bg-fuchsia-900/30 dark:text-fuchsia-300 dark:border-fuchsia-800',
  // Chỉ Classic có — Workshop nhóm theo sản phẩm nên không cần chip này (ORD-1).
  type: 'bg-lime-100 text-lime-700 border-lime-300 dark:bg-lime-900/30 dark:text-lime-300 dark:border-lime-800',
};
const FILTER_CHIP_DEFAULT =
  'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-600';
const fmtChipDate = (s: string) => (s ? s.split('-').reverse().slice(0, 2).join('/') : '');

interface RowProps {
  row: OrderRow;
  groups: ResolvedColGroup[];
  ctx: RenderCtx;
  isSelected: boolean;
  noTool: boolean;
  onCheckboxChange: (id: string) => void;
  onCheckboxMouseDown: (shiftKey: boolean) => void;
  onHistory: (id: string, productionId: string) => void;
  patchRow: (id: string, patch: Partial<OrderRow>) => void;
}

/** 1 hàng đơn — memo để tick checkbox / mở preview KHÔNG re-render toàn bảng (mirror ProductRow ở OrderTableWorkshop, bỏ combo/heaviest vì list phẳng không gộp theo sản phẩm). */
const OrderRowItem = React.memo(function OrderRowItem({
  row,
  groups,
  ctx,
  isSelected,
  noTool,
  onCheckboxChange,
  onCheckboxMouseDown,
  onHistory,
  patchRow,
}: RowProps) {
  const { t } = useTranslation('orders');
  const cancelled = isCancelled(row);
  const held = isHeld(row);
  const dim = cancelled || held;
  const renderedByKey = useMemo(() => {
    const effectiveCtx = held ? { ...ctx, canEditField: () => false } : ctx;
    const map = new Map<string, React.ReactNode>();
    for (const g of groups) {
      for (const c of g.members) map.set(c.key, c.render(row, effectiveCtx));
    }
    return map;
  }, [groups, row, ctx, held]);
  const rowBgClass = isSelected ? 'bg-indigo-50 dark:bg-indigo-950' : noTool ? 'bg-sky-100 dark:bg-sky-950' : 'bg-card';
  return (
    <TableRow
      className={cn(
        rowBgClass,
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
          className={cn('py-2 align-top', gi === 0 && cn('sticky left-8 z-10 shadow-[1px_0_0_0_var(--border)]', rowBgClass))}
        >
          <div className="flex flex-col gap-1">
            {gi === 0 && cancelled && <CancelledBadge reason={row.cancelReason} />}
            {gi === 0 && held && !cancelled && <HeldBadge reason={row.holdReason} source={row.holdSource} />}
            {gi === 0 && showOnospodHoldFlag(row) && <OnospodHoldBadge />}
            <GroupCellContent group={g} renderedByKey={renderedByKey} />
          </div>
        </TableCell>
      ))}
      <TableCell className={cn('sticky right-0 z-10', rowBgClass)}>
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t('tableWorkshop.history')} onClick={() => onHistory(row._id, row.productionId)}>
            <History size={13} className="text-muted-foreground" />
          </Button>
          <OrderRowActionsMenu order={row} onChanged={(u) => patchRow(u._id, u)} />
        </div>
      </TableCell>
    </TableRow>
  );
});

export function OrderTableClassic() {
  const { t } = useTranslation('orders');
  const { has, canViewField, canEditField, roleName } = usePermission();
  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);

  // URL params (prefix `c` = classic) — F5/copy link giữ nguyên toàn bộ filter.
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('cpage'));
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const s = Number(searchParams.get('csize'));
    return Number.isFinite(s) && s > 0 ? s : DEFAULT_PAGE_SIZE;
  });
  const [pid, setPid] = useState(() => searchParams.get('pid')?.trim() || '');
  const [createdFrom, setCreatedFrom] = useState(() => searchParams.get('cfrom') || '');
  const [createdTo, setCreatedTo] = useState(() => searchParams.get('cto') || '');
  const [search, setSearch] = useState(() => searchParams.get('csearch') || '');
  const debouncedSearch = useDebounce(search, 300);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [selectingAllPages, setSelectingAllPages] = useState(false);
  const shiftKeyRef = useRef(false);
  const [preview, setPreview] = useState<{ url: string; originalUrl?: string; title: string; sourceUrl?: string } | null>(
    null,
  );
  const [historyTarget, setHistoryTarget] = useState<{ id: string; productionId: string } | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ id: string; productionId: string } | null>(null);

  // Lọc theo LOẠI SẢN PHẨM — chỉ Classic có (ORD-1). Workshop không cần vì nó
  // đã nhóm đơn theo sản phẩm sẵn; đây là ngoại lệ duy nhất `AC-02` cho phép.
  const [filterType, setFilterType] = useState<string>(() => searchParams.get('ctype') || '');
  const [filterPrintStatus, setFilterPrintStatus] = useState<string>(() => searchParams.get('cprint') || '');
  const [filterToolResultNote, setFilterToolResultNote] = useState<string>(() => searchParams.get('cnote') || '');
  const [filterAssignee, setFilterAssignee] = useState<string>(() => searchParams.get('cassign') || '');
  const [filterProductionError, setFilterProductionError] = useState<string>(() => searchParams.get('cerror') || '');
  const [filterFabricType, setFilterFabricType] = useState<string>(() => searchParams.get('cfabric') || '');
  const [filterMachineNumber, setFilterMachineNumber] = useState<string>(() => searchParams.get('cmnum') || '');
  const [filterToolResult, setFilterToolResult] = useState<string>(() => searchParams.get('ctool') || '');
  const [filterErrorFile, setFilterErrorFile] = useState<string>(() => searchParams.get('cerrfile') || '');
  const [filterDesignerStatus, setFilterDesignerStatus] = useState<string>(() => searchParams.get('cdstatus') || '');
  const [filterUserSku, setFilterUserSku] = useState<string>(() => searchParams.get('cusersku') || '');
  const [filterHeld, setFilterHeld] = useState<boolean>(() => searchParams.get('cheld') === 'true');
  const [filterCancelled, setFilterCancelled] = useState<boolean>(() => searchParams.get('ccancel') === 'true');

  // Sync state → URL (replace). Strip default/empty values — copy URL để share cho nhau.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        pid.trim() ? sp.set('pid', pid.trim()) : sp.delete('pid');
        search ? sp.set('csearch', search) : sp.delete('csearch');
        createdFrom ? sp.set('cfrom', createdFrom) : sp.delete('cfrom');
        createdTo ? sp.set('cto', createdTo) : sp.delete('cto');
        filterType ? sp.set('ctype', filterType) : sp.delete('ctype');
        filterPrintStatus ? sp.set('cprint', filterPrintStatus) : sp.delete('cprint');
        filterToolResultNote ? sp.set('cnote', filterToolResultNote) : sp.delete('cnote');
        filterAssignee ? sp.set('cassign', filterAssignee) : sp.delete('cassign');
        filterProductionError ? sp.set('cerror', filterProductionError) : sp.delete('cerror');
        filterFabricType ? sp.set('cfabric', filterFabricType) : sp.delete('cfabric');
        filterMachineNumber ? sp.set('cmnum', filterMachineNumber) : sp.delete('cmnum');
        filterToolResult ? sp.set('ctool', filterToolResult) : sp.delete('ctool');
        filterErrorFile ? sp.set('cerrfile', filterErrorFile) : sp.delete('cerrfile');
        filterDesignerStatus ? sp.set('cdstatus', filterDesignerStatus) : sp.delete('cdstatus');
        filterUserSku ? sp.set('cusersku', filterUserSku) : sp.delete('cusersku');
        filterHeld ? sp.set('cheld', 'true') : sp.delete('cheld');
        filterCancelled ? sp.set('ccancel', 'true') : sp.delete('ccancel');
        page > 1 ? sp.set('cpage', String(page)) : sp.delete('cpage');
        pageSize !== DEFAULT_PAGE_SIZE ? sp.set('csize', String(pageSize)) : sp.delete('csize');
        return sp;
      },
      { replace: true },
    );
  }, [
    pid,
    search,
    createdFrom,
    createdTo,
    filterType,
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
    page,
    pageSize,
    setSearchParams,
  ]);

  const [workshopFilters, setWorkshopFilters] = useState<WorkshopAvailableFilters | null>(null);

  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  const visibleCols = useMemo(() => COLS.filter((c) => !c.perm || canViewField(c.key)), [canViewField]);

  const buildFilterParams = (): URLSearchParams => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    const pidTrimmed = pid.trim();
    if (pidTrimmed) params.set('productionIds', pidTrimmed);
    else if (bulkIds.length) params.set('productionIds', bulkIds.join(','));
    // `append` chứ KHÔNG `set`: `type` là facet DUY NHẤT nhận tham số lặp
    // (`?type=A&type=B`) — BE `parseTypeFilter()` cố ý KHÔNG tách dấu phẩy vì
    // tên sản phẩm nhập tự do từ file import, dấu phẩy là ký tự DỮ LIỆU chứ
    // không phải ký tự phân tách. Giữ `append` để nâng lên đa chọn sau này
    // không phải sửa gì. Xem `Orders.md` §7.x.1.
    if (filterType) params.append('type', filterType);
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
    if (createdFrom) params.set('createdFrom', createdFrom);
    if (createdTo) params.set('createdTo', createdTo);
    // ORD-19 — trang này hiển thị CẢ đơn xưởng US (xưởng ngoài luồng sản xuất,
    // mặc định bị loại khỏi mọi danh sách). Gửi theo request thay vì nới ở BE
    // cho mọi caller: `GET /orders` còn phục vụ drill-down từ dashboard, số ở
    // đó phải khớp số dashboard. Đơn đã hủy + đơn chưa map xưởng vẫn ẩn như cũ.
    params.set('includeExcludedFactory', 'true');
    // Sắp theo ngày vào sản xuất, MỚI NHẤT trước.
    params.set('sort', 'inProductionAt');
    params.set('order', 'desc');
    return params;
  };

  // Flat + phân trang THẬT (đơn vị trang = số dòng đơn, KHÔNG gộp theo sản
  // phẩm) — dùng `getOrders()` thường, KHÁC `getOrdersGrouped()` ở OrderTableWorkshop.
  const fetchData = async () => {
    const params = buildFilterParams();
    params.set('page', String(page));
    params.set('limit', String(pageSize));
    try {
      const res = await RepositoryRemote.order.getOrders('?' + params.toString());
      setItems((res.data?.data || []) as OrderRow[]);
      setTotal(res.data?.total || 0);
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
    filterType,
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
    createdFrom,
    createdTo,
  ]);

  const patchRow = useCallback((id: string, patch: Partial<OrderRow>) => {
    setItems((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  }, []);

  usePendingDesignsPoll(items, patchRow);

  const openPreview = useCallback(
    (url: string, title: string, originalUrl?: string, sourceUrl?: string) => setPreview({ url, originalUrl, title, sourceUrl }),
    [],
  );
  const onCheckboxMouseDown = useCallback((shiftKey: boolean) => {
    shiftKeyRef.current = shiftKey;
  }, []);
  const onHistory = useCallback((id: string, productionId: string) => setHistoryTarget({ id, productionId }), []);

  // "Chọn tất cả trang này" — checkbox header. Vì phân trang thật (không gộp
  // theo sản phẩm), đây CHÍNH LÀ "cập nhật toàn bộ trang": tick 1 lần → mọi
  // đơn đang hiển thị được chọn → bulk action bất kỳ ở BulkEditToolbar áp cho
  // TOÀN BỘ trang hiện tại.
  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map((it) => it._id));
    });
  };

  // "Chọn tất cả N đơn khớp bộ lọc" — xuyên MỌI trang, không chỉ trang hiện
  // tại. Gọi lại `getOrders()` với CÙNG filter nhưng `limit=total` để lấy đủ
  // `_id` mọi trang, rồi đổ thẳng vào `selected` — mọi bulk action
  // (BulkEditToolbar) tự động áp dụng cho toàn bộ tập này vì chỉ nhận mảng ids.
  const handleSelectAllPages = async () => {
    if (total <= 0) return;
    setSelectingAllPages(true);
    try {
      const params = buildFilterParams();
      params.set('page', '1');
      params.set('limit', String(total));
      const res = await RepositoryRemote.order.getOrders('?' + params.toString());
      const allIds = ((res.data?.data || []) as OrderRow[]).map((it) => it._id);
      setSelected(new Set(allIds));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSelectingAllPages(false);
    }
  };

  const visibleOrderedIds = useMemo(() => items.map((r) => r._id), [items]);
  const selectedRef = useRef(selected);
  const lastClickedIdRef = useRef(lastClickedId);
  const visibleOrderedIdsRef = useRef<string[]>(visibleOrderedIds);
  selectedRef.current = selected;
  lastClickedIdRef.current = lastClickedId;
  visibleOrderedIdsRef.current = visibleOrderedIds;

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

  const openDetail = useCallback((id: string, productionId: string) => setDetailTarget({ id, productionId }), []);
  const renderCtx: RenderCtx = useMemo(
    () => ({ canEditField, patchRow, openPreview, openDetail, t }),
    [canEditField, patchRow, openPreview, openDetail, t],
  );
  const isNoTool = useIsNoTool();

  // KHÔNG có Designer Summary block — vẫn giữ facet designerStatus trong bộ
  // lọc (permission riêng), chỉ ẩn panel thống kê + nút "Chi tiết tồn đọng".
  const canSeeDesignerSummary = has('page.designer_stats') || has('designer.task.assign');

  const assigneeOptions = useMemo(() => {
    const base = workshopFilters?.assignee || [];
    if (base.find((o) => o.value === '__none__')) return base;
    return [{ value: '__none__', label: t('listTab.unassigned'), count: 0 }, ...base];
  }, [workshopFilters?.assignee, t]);

  const designerStatusOptions = workshopFilters?.designerStatus || [];

  /**
   * Options facet sản phẩm. KHÁC `assigneeOptions`: FE **không bao giờ tự tạo**
   * mục `__none__` (đơn chưa xác định loại sản phẩm) — chỉ backend mới biết có
   * đơn nào khớp hay không, và hôm nay không có đơn nào nên mục này không xuất
   * hiện (`SRS` BR-13). Nếu backend trả về thì nó gửi kèm `label` RỖNG và FE
   * gán nhãn ở đây, đúng mẫu `assignee`/`toolResult` — không xử thì option sẽ
   * render ra một dòng trắng không ai hiểu.
   */
  const typeOptions = useMemo(
    () =>
      (workshopFilters?.type || []).map((o) =>
        o.value === '__none__' ? { ...o, label: o.label || t('tableWorkshop.noTypeName') } : o,
      ),
    [workshopFilters?.type, t],
  );

  useEffect(() => {
    setSelected(new Set());
    setLastClickedId(null);
  }, [
    debouncedSearch,
    bulkIds,
    createdFrom,
    createdTo,
    filterType,
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
  ]);

  const facets: OrderFilterFacet[] = [
    // Sản phẩm đứng ĐẦU: đây là cách người dùng khoanh vùng thô nhất, các facet
    // còn lại là thuộc tính bên trong một loại hàng. KHÔNG đặt `perm` — cột
    // `mockupTypeSize` (nơi tên sản phẩm vốn đã hiện) khai `perm: null` nên hiện
    // với MỌI role; gate facet ở đây sẽ là gate giả. Xem `.devtasks/ui/ORD-1.md` §2.
    {
      key: 'type',
      label: t('tableWorkshop.facets.type'),
      value: filterType,
      onChange: setFilterType,
      options: typeOptions,
      // Danh sách sản phẩm dài → select có ô tìm kiếm (ORD-2). Các facet khác giữ native select.
      searchable: true,
    },
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

  // Chip "đang lọc" — chỉ facet user thấy được (perm/hidden) + search + date custom.
  const activeFilters: Array<{ key: string; label: string; display: string; color: string; onClear: () => void }> = [];
  for (const f of facets) {
    if (f.hidden || (f.perm && !has(f.perm)) || !f.value) continue;
    const opt = f.options.find((o) => o.value === f.value);
    activeFilters.push({
      key: f.key,
      label: f.label,
      display: opt?.label || f.value,
      color: FILTER_CHIP_COLORS[f.key] || FILTER_CHIP_DEFAULT,
      onClear: () => {
        f.onChange('');
        setPage(1);
      },
    });
  }
  if (search.trim()) {
    activeFilters.push({
      key: 'search',
      label: t('tableWorkshop.chips.search'),
      display: search.trim(),
      color: FILTER_CHIP_COLORS.search,
      onClear: () => {
        setSearch('');
        setPage(1);
      },
    });
  }
  if (pid.trim()) {
    activeFilters.push({
      key: 'pid',
      label: t('tableWorkshop.chips.pid'),
      display: pid.trim(),
      color: FILTER_CHIP_COLORS.search,
      onClear: () => {
        setPid('');
        setPage(1);
      },
    });
  }
  if (bulkIds.length) {
    activeFilters.push({
      key: 'bulkIds',
      label: t('tableWorkshop.chips.bulkIds'),
      display: t('listTab.tokenCount', { count: bulkIds.length }),
      color: FILTER_CHIP_COLORS.search,
      onClear: () => {
        setBulkIds([]);
        setPage(1);
      },
    });
  }
  if (createdFrom || createdTo) {
    activeFilters.push({
      key: 'date',
      label: t('tableWorkshop.chips.date'),
      display: `${fmtChipDate(createdFrom) || '…'} → ${fmtChipDate(createdTo) || '…'}`,
      color: FILTER_CHIP_COLORS.date,
      onClear: () => {
        setCreatedFrom('');
        setCreatedTo('');
        setPage(1);
      },
    });
  }
  if (filterHeld) {
    activeFilters.push({
      key: 'held',
      label: t('tableWorkshop.chips.status'),
      display: t('tableWorkshop.holding'),
      color: FILTER_CHIP_COLORS.date,
      onClear: () => {
        setFilterHeld(false);
        setPage(1);
      },
    });
  }
  if (filterCancelled) {
    activeFilters.push({
      key: 'cancelled',
      label: t('tableWorkshop.chips.status'),
      display: t('tableWorkshop.cancelled'),
      color: FILTER_CHIP_COLORS.date,
      onClear: () => {
        setFilterCancelled(false);
        setPage(1);
      },
    });
  }

  const clearAllFilters = () => {
    setSearch('');
    setPid('');
    setBulkIds([]);
    setFilterHeld(false);
    // KHÔNG reset về hôm nay như Workshop — Classic cố ý mặc định rỗng (BR-8,
    // người dùng đã chọn giữ nguyên khác biệt này).
    setCreatedFrom('');
    setCreatedTo('');
    setFilterType('');
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
    setPage(1);
  };

  useSidebarResetSignal(PATHS.ORDERS_CLASSIC, clearAllFilters);

  const colGroups = useMemo(() => buildColGroups(visibleCols, roleName), [visibleCols, roleName]);
  const fullColSpan = colGroups.length + 2;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 pb-24">
        <OrderFilterBar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            if (v && bulkIds.length) setBulkIds([]);
          }}
          onBulkApply={(ids) => {
            setSearch('');
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
          onReload={() => {
            setLoading(true);
            Promise.all([fetchData(), fetchFilters()]).finally(() => setLoading(false));
          }}
          loading={loading}
          topActionsRight={
            <>
              <Button
                variant={filterHeld ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-8"
                onClick={() => {
                  setFilterHeld((v) => !v);
                  setPage(1);
                }}
                title={t('tableWorkshop.heldOnlyTitle')}
              >
                <PauseCircle size={14} className="mr-1" />
                {t('tableWorkshop.holding')}
                {typeof workshopFilters?.heldCount === 'number' && workshopFilters.heldCount > 0 && (
                  <span className="ml-1 rounded-full bg-amber-200 dark:bg-amber-500/30 px-1.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                    {workshopFilters.heldCount}
                  </span>
                )}
              </Button>
              <Button
                variant={filterCancelled ? 'default' : 'outline'}
                size="sm"
                className="text-xs h-8"
                onClick={() => {
                  setFilterCancelled((v) => !v);
                  setPage(1);
                }}
                title={t('tableWorkshop.cancelledOnlyTitle')}
              >
                <Ban size={14} className="mr-1" />
                {t('tableWorkshop.cancelled')}
                {typeof workshopFilters?.cancelledCount === 'number' && workshopFilters.cancelledCount > 0 && (
                  <span className="ml-1 rounded-full bg-rose-200 dark:bg-rose-500/30 px-1.5 text-[10px] font-semibold text-rose-800 dark:text-rose-200">
                    {workshopFilters.cancelledCount}
                  </span>
                )}
              </Button>
            </>
          }
          facets={facets}
        />

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">{t('tableWorkshop.filtering')}</span>
            {activeFilters.map((f) => (
              <span
                key={f.key}
                className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', f.color)}
              >
                <span className="opacity-70">{f.label}:</span>
                <span className="max-w-[160px] truncate">{f.display}</span>
                <button
                  type="button"
                  onClick={f.onClear}
                  className="ml-0.5 rounded-full hover:opacity-60"
                  title={t('tableWorkshop.clearFilterTitle', { label: f.label })}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs text-muted-foreground hover:text-foreground" onClick={clearAllFilters}>
              <FilterX size={13} className="mr-1" />
              {t('tableWorkshop.clearAllFilters')}
            </Button>
          </div>
        )}

        {/* Gợi ý chọn nhiều đơn (ORD-1 AC-09) — mirror Workshop, CÙNG điều kiện
            hiện. Cố ý BỎ `selectionHint.line1`: dòng đó mô tả thao tác tick
            checkbox cạnh tên sản phẩm, vốn chỉ có ở bảng nhóm của Workshop —
            giữ lại sẽ là nhãn cho một thao tác không tồn tại ở đây (BR-15). */}
        {selected.size === 0 && items.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <MousePointerClick size={13} className="mt-0.5 shrink-0 text-primary" />
            <p>
              <span className="font-medium text-foreground">{t('tableWorkshop.selectionHint.title')}</span>{' '}
              {t('tableWorkshop.selectionHint.line2Before')}{' '}
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">Shift</kbd>{' '}
              {t('tableWorkshop.selectionHint.line2After')}
            </p>
          </div>
        )}

        <PaginationBar
          position="top"
          page={page}
          pageSize={pageSize}
          total={total}
          loading={loading}
          onChange={(p, ps) => {
            setPage(p);
            setPageSize(ps);
          }}
        />

        {selected.size > 0 && selected.size === items.length && total > items.length && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {t('tableWorkshop.selectAllPagesPrompt', { count: items.length })}
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={handleSelectAllPages}
              disabled={selectingAllPages}
            >
              {selectingAllPages && <Spinner size={12} className="mr-1" />}
              {t('tableWorkshop.selectAllPagesBtn', { total })}
            </Button>
          </div>
        )}

        {selected.size > 0 && selected.size === total && total > items.length && (
          <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary">
            {t('tableWorkshop.selectedAllPages', { total })}
          </div>
        )}

        <LoadingOverlay active={loading && items.length > 0} className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="table-fixed" style={{ minWidth: '100%' }}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 sticky left-0 z-30 bg-card">
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
                      // `overflow-hidden text-ellipsis` — xem comment ở `OrderTableWorkshop`.
                      className={cn(
                        'whitespace-nowrap overflow-hidden text-ellipsis text-xs',
                        i === 0 && 'sticky left-8 z-30 bg-card shadow-[1px_0_0_0_var(--border)]',
                      )}
                      title={`${groupTitle(t, g.key, g.title)} — ${g.members.map((m) => m.label).join(' · ')}`}
                    >
                      {groupTitle(t, g.key, g.title)}
                    </TableHead>
                  ))}
                  <TableHead className="w-16 sticky right-0 z-30 bg-card"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
                {items.map((row) => (
                  <OrderRowItem
                    key={row._id}
                    row={row}
                    groups={colGroups}
                    ctx={renderCtx}
                    isSelected={selected.has(row._id)}
                    noTool={isNoTool(row.toolResult)}
                    onCheckboxChange={handleCheckboxChange}
                    onCheckboxMouseDown={onCheckboxMouseDown}
                    onHistory={onHistory}
                    patchRow={patchRow}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

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
        </LoadingOverlay>

        <BulkEditToolbar
          selectedIds={Array.from(selected)}
          onClear={() => setSelected(new Set())}
          onApplied={() => {
            setSelected(new Set());
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
      </div>
    </TooltipProvider>
  );
}
