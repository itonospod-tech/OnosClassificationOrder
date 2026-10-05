import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { CheckCircle2, History, Keyboard, MousePointerClick } from 'lucide-react';
import type { WorkshopAvailableFilters } from 'shared';
import { toast } from 'sonner';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { BulkEditToolbar } from '@/components/orders/BulkEditToolbar';
import { OrderDetailDialog } from '@/components/orders/OrderDetailDialog';
import { OrderFilterBar, type OrderFilterFacet } from '@/components/orders/OrderFilterBar';
import { OrderLogTimelineDialog } from '@/components/orders/OrderLogTimelineDialog';
import {
  GroupCellContent,
  PRINT_COLS,
  PRINT_MERGE_GROUP_DEFS,
  type ResolvedColGroup,
  type WorkshopColMeta,
  type WorkshopOrderRow,
  type WorkshopRenderCtx,
} from '@/components/orders/workshopTableConfig';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useDebounce } from '@/hooks/useDebounce';
import { useIsNoTool } from '@/hooks/useIsNoTool';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { usePermission } from '@/hooks/usePermission';

type OrderRow = WorkshopOrderRow;

/** A table column, or a merged group of columns rendered as one stacked cell. */
type DisplayUnit = { kind: 'col'; col: WorkshopColMeta } | { kind: 'group'; group: ResolvedColGroup };
const COLS = PRINT_COLS;
const DEFAULT_PAGE_SIZE = 50;

type StatusCounts = {
  all: number;
  waiting: number;
  inProgress: number;
  rework: number;
  done: number;
  fixed: number;
  watching: number;
  held: number;
};
const EMPTY_COUNTS: StatusCounts = {
  all: 0,
  waiting: 0,
  inProgress: 0,
  rework: 0,
  done: 0,
  fixed: 0,
  watching: 0,
  held: 0,
};

/** value '' = tất cả (không lọc theo stage status). */
function buildStatusTabs(
  t: TFunction,
): Array<{ value: string; label: string; countKey: keyof StatusCounts; accent: string }> {
  return [
    { value: '', label: t('stageStatus.all'), countKey: 'all', accent: 'text-foreground' },
    { value: 'waiting', label: t('stageStatus.waiting'), countKey: 'waiting', accent: 'text-zinc-600 dark:text-zinc-300' },
    { value: 'in-progress', label: t('stageStatus.inProgress'), countKey: 'inProgress', accent: 'text-indigo-600' },
    { value: 'rework', label: t('stageStatus.rework'), countKey: 'rework', accent: 'text-amber-600' },
    { value: 'done', label: t('stageStatus.done'), countKey: 'done', accent: 'text-emerald-600' },
    { value: 'fixed', label: t('stageStatus.fixed'), countKey: 'fixed', accent: 'text-teal-600' },
    { value: 'watching', label: t('stageStatus.watching'), countKey: 'watching', accent: 'text-sky-600' },
    // Held orders cut out of "waiting" (Orders.md §9b). Shown only when there are some (or it is selected).
    { value: 'held', label: t('stageStatus.held'), countKey: 'held', accent: 'text-tone-warning' },
  ];
}

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface PrintOrderTableProps {
  /** Render action mỗi dòng (cột sticky phải). Trả null = dòng không có action. */
  extraRowAction?: (row: OrderRow) => React.ReactNode;
  extraActionLabel?: string;
  /** Bump để ép refetch (sau transition). */
  reloadToken?: number;
  /**
   * Đơn có được tick chọn không (vd chỉ đơn ở stage In + cùng xưởng + trạng
   * thái hợp lệ). Mặc định: tất cả chọn được.
   */
  isRowSelectable?: (row: OrderRow) => boolean;
  /**
   * Render bulk toolbar tuỳ biến (vd chuyển trạng thái). Nhận danh sách row đã
   * chọn + hàm clear. Nếu không truyền → fallback `BulkEditToolbar` mặc định.
   */
  renderBulkBar?: (selectedRows: OrderRow[], clear: () => void) => React.ReactNode;
  /**
   * Khi set (YYYY-MM-DD) → ép `createdFrom=createdTo=dayOverride` cho query
   * (bảng "Tổng quan theo ngày" click 1 ngày). Vì bảng In phân trang server nên
   * không lọc client-side được — narrow qua ngày. `null`/undefined = bỏ.
   */
  dayOverride?: string | null;
}

/**
 * Bảng phẳng (KHÔNG group theo sản phẩm) cho trang Fulfillment "In". Hiển thị
 * tất cả đơn admin-like, sort ưu tiên type → size (sort=grouped ở BE), filter
 * đầy đủ + filter Tên sản phẩm (type) + Khách hàng (userSku) dạng dropdown, +
 * thanh chips trạng thái stage. Tách riêng để không đụng `OrderTableWorkshop`.
 */
export function PrintOrderTable({
  extraRowAction,
  extraActionLabel,
  reloadToken,
  isRowSelectable,
  renderBulkBar,
  dayOverride,
}: PrintOrderTableProps = {}) {
  const { t } = useTranslation(['fulfillmentWorkflow', 'common']);
  const { t: tOrders } = useTranslation('orders');
  const statusTabs = useMemo(() => buildStatusTabs(t), [t]);
  const { canViewField, canEditField } = usePermission();
  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);
  const isNoTool = useIsNoTool();

  // URL params (prefix `p` = print). F5 giữ nguyên filter/ngày/search/status/trang.
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('ppage'));
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const s = Number(searchParams.get('psize'));
    return Number.isFinite(s) && s > 0 ? s : DEFAULT_PAGE_SIZE;
  });
  const [createdFrom, setCreatedFrom] = useState(() => searchParams.get('pfrom') ?? todayISO());
  const [createdTo, setCreatedTo] = useState(() => searchParams.get('pto') ?? todayISO());
  const [search, setSearch] = useState(() => searchParams.get('psearch') || '');
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('pstatus') || '');
  const [counts, setCounts] = useState<StatusCounts>(EMPTY_COUNTS);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const shiftKeyRef = useRef(false);

  // ─── Keyboard copy mode (chế độ phím ↑↓) ──────────────────────
  // Bật → dùng phím ↑/↓ để copy Production ID từng dòng. CHỈ dòng vừa copy
  // (dòng cursor đang trỏ) hiện ✓ — di chuyển cursor → ✓ nhảy theo, dòng cũ
  // mất tick. `cursorIndex` = dòng đang focus trong trang.
  // Arrow-key copy mode is for a station PC with a keyboard; a phone has none, so it starts off there
  // and its toggle + hint are hidden.
  const isMobile = useIsMobile();
  const [keyboardMode, setKeyboardMode] = useState(() => !window.matchMedia('(max-width: 767px)').matches);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cursorIndex, setCursorIndex] = useState(-1);
  const cursorRef = useRef(-1);
  useEffect(() => {
    cursorRef.current = cursorIndex;
  }, [cursorIndex]);
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);

  const [preview, setPreview] = useState<{
    url: string;
    originalUrl?: string;
    title: string;
    sourceUrl?: string;
  } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ id: string; productionId: string } | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ id: string; productionId: string } | null>(null);

  const [workshopFilters, setWorkshopFilters] = useState<WorkshopAvailableFilters | null>(null);

  // Facet filter state — khởi tạo từ URL params (F5 giữ nguyên).
  const [fType, setFType] = useState(() => searchParams.get('ptype') || '');
  const [fUserSku, setFUserSku] = useState(() => searchParams.get('pusersku') || '');
  const [fFabricType, setFFabricType] = useState(() => searchParams.get('pfabric') || '');
  const [fMachineNumber, setFMachineNumber] = useState(() => searchParams.get('pmnum') || '');
  const [fPrintStatus, setFPrintStatus] = useState(() => searchParams.get('pprint') || '');
  const [fToolResult, setFToolResult] = useState(() => searchParams.get('ptool') || '');
  const [fToolResultNote, setFToolResultNote] = useState(() => searchParams.get('pnote') || '');
  const [fErrorFile, setFErrorFile] = useState(() => searchParams.get('perrfile') || '');
  const [fAssignee, setFAssignee] = useState(() => searchParams.get('passign') || '');
  const [fDesignerStatus, setFDesignerStatus] = useState(() => searchParams.get('pdstatus') || '');
  const [fProductionError, setFProductionError] = useState(() => searchParams.get('perror') || '');

  // Sync state → URL (replace). Ngày luôn ghi (kể cả rỗng khi user clear),
  // các filter còn lại strip khi rỗng để URL gọn.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        search ? sp.set('psearch', search) : sp.delete('psearch');
        sp.set('pfrom', createdFrom);
        sp.set('pto', createdTo);
        statusFilter ? sp.set('pstatus', statusFilter) : sp.delete('pstatus');
        fType ? sp.set('ptype', fType) : sp.delete('ptype');
        fUserSku ? sp.set('pusersku', fUserSku) : sp.delete('pusersku');
        fFabricType ? sp.set('pfabric', fFabricType) : sp.delete('pfabric');
        fMachineNumber ? sp.set('pmnum', fMachineNumber) : sp.delete('pmnum');
        fPrintStatus ? sp.set('pprint', fPrintStatus) : sp.delete('pprint');
        fToolResult ? sp.set('ptool', fToolResult) : sp.delete('ptool');
        fToolResultNote ? sp.set('pnote', fToolResultNote) : sp.delete('pnote');
        fErrorFile ? sp.set('perrfile', fErrorFile) : sp.delete('perrfile');
        fAssignee ? sp.set('passign', fAssignee) : sp.delete('passign');
        fDesignerStatus ? sp.set('pdstatus', fDesignerStatus) : sp.delete('pdstatus');
        fProductionError ? sp.set('perror', fProductionError) : sp.delete('perror');
        page > 1 ? sp.set('ppage', String(page)) : sp.delete('ppage');
        pageSize !== DEFAULT_PAGE_SIZE ? sp.set('psize', String(pageSize)) : sp.delete('psize');
        return sp;
      },
      { replace: true },
    );
  }, [
    search,
    createdFrom,
    createdTo,
    statusFilter,
    fType,
    fUserSku,
    fFabricType,
    fMachineNumber,
    fPrintStatus,
    fToolResult,
    fToolResultNote,
    fErrorFile,
    fAssignee,
    fDesignerStatus,
    fProductionError,
    page,
    pageSize,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  const visibleCols = useMemo(() => COLS.filter((c) => !c.perm || canViewField(c.key)), [canViewField]);

  // Gộp 2 cụm cột thành 1 cột/cụm (Máy·TT in·Note + Lỗi xưởng·Loại·Mô tả) —
  // field trong ô xếp dọc, mỗi mục có label riêng qua GroupCellContent.
  // Cột ngoài cụm giữ nguyên; group chiếm vị trí member đầu tiên còn quyền xem.
  const displayUnits = useMemo<DisplayUnit[]>(() => {
    const consumed = new Set<string>();
    const units: DisplayUnit[] = [];
    for (const c of visibleCols) {
      if (consumed.has(c.key)) continue;
      const def = PRINT_MERGE_GROUP_DEFS.find((g) => g.memberKeys.includes(c.key));
      if (def) {
        const members = def.memberKeys
          .map((k) => visibleCols.find((vc) => vc.key === k))
          .filter((m): m is WorkshopColMeta => !!m);
        members.forEach((m) => consumed.add(m.key));
        units.push({ kind: 'group', group: { ...def, members } });
      } else {
        units.push({ kind: 'col', col: c });
      }
    }
    return units;
  }, [visibleCols]);

  // Build query params. `includeStatus`: kèm `fulfillmentStatus` (cho data +
  // facets để cả 2 narrow theo chip đang chọn). Counts KHÔNG kèm (đếm đủ 5).
  const buildBaseParams = (includeStatus: boolean): URLSearchParams => {
    const p = new URLSearchParams();
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim());
    // dayOverride (click 1 ngày ở bảng tổng quan) ép cửa sổ về đúng ngày đó.
    const effFrom = dayOverride || createdFrom;
    const effTo = dayOverride || createdTo;
    if (effFrom) p.set('createdFrom', effFrom);
    if (effTo) p.set('createdTo', effTo);
    if (fType) p.set('type', fType);
    if (fUserSku) p.set('userSku', fUserSku);
    if (fFabricType) p.set('fabricType', fFabricType);
    if (fMachineNumber) p.set('machineNumber', fMachineNumber);
    if (fPrintStatus) p.set('printStatus', fPrintStatus);
    if (fToolResult) p.set('toolResult', fToolResult);
    if (fToolResultNote) p.set('toolResultNote', fToolResultNote);
    if (fErrorFile) p.set('errorFile', fErrorFile);
    if (fAssignee) p.set('assignee', fAssignee);
    if (fDesignerStatus) p.set('designerStatus', fDesignerStatus);
    if (fProductionError) p.set('productionError', fProductionError);
    if (includeStatus && statusFilter) p.set('fulfillmentStatus', statusFilter);
    return p;
  };

  const fetchData = async () => {
    const p = buildBaseParams(true);
    p.set('page', String(page));
    p.set('limit', String(pageSize));
    p.set('sort', 'grouped'); // ưu tiên type → size → fabric → inProductionAt
    try {
      const res = await RepositoryRemote.order.getOrders('?' + p.toString());
      // BE đã sort type → sizeRank → fabric → inProductionAt (sort=grouped).
      setItems((res.data?.data || []) as OrderRow[]);
      setTotal(res.data?.total || 0);
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const fetchFilters = async () => {
    try {
      const res = await RepositoryRemote.order.getWorkshopFilters('?' + buildBaseParams(true).toString());
      setWorkshopFilters((res.data?.data || null) as WorkshopAvailableFilters | null);
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const fetchCounts = async () => {
    try {
      const res = await RepositoryRemote.order.getFulfillmentStatusCounts('?' + buildBaseParams(false).toString());
      if (res.data?.data) setCounts(res.data.data as StatusCounts);
    } catch (err) {
      handleAxiosError(err);
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchData(), fetchFilters(), fetchCounts()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    page,
    pageSize,
    debouncedSearch,
    createdFrom,
    createdTo,
    statusFilter,
    fType,
    fUserSku,
    fFabricType,
    fMachineNumber,
    fPrintStatus,
    fToolResult,
    fToolResultNote,
    fErrorFile,
    fAssignee,
    fDesignerStatus,
    fProductionError,
    reloadToken,
    dayOverride,
  ]);

  const patchRow = (id: string, patch: Partial<OrderRow>) =>
    setItems((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)));

  const openPreview = (url: string, title: string, originalUrl?: string, sourceUrl?: string) =>
    setPreview({ url, originalUrl, title, sourceUrl });
  const openDetail = (id: string, productionId: string) => setDetailTarget({ id, productionId });
  const renderCtx: WorkshopRenderCtx = { canEditField, patchRow, openPreview, openDetail, t: tOrders };

  // ─── Selection (flat) — chỉ tick được đơn hợp lệ ──────────────
  const canSelect = (row: OrderRow) => (isRowSelectable ? isRowSelectable(row) : true);
  const selectableIds = useMemo(
    () => items.filter((r) => canSelect(r)).map((r) => r._id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, isRowSelectable],
  );
  const orderedIds = selectableIds;
  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggleAll = () => setSelected((prev) => (allSelectableSelected ? new Set() : new Set(selectableIds)));

  const handleCheckboxChange = (id: string) => {
    const isShift = shiftKeyRef.current;
    shiftKeyRef.current = false;
    if (isShift && lastClickedId && lastClickedId !== id) {
      const a = orderedIds.indexOf(lastClickedId);
      const b = orderedIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        const range = orderedIds.slice(from, to + 1);
        const newState = !selected.has(id);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const rid of range) newState ? next.add(rid) : next.delete(rid);
          return next;
        });
        setLastClickedId(id);
        return;
      }
    }
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setLastClickedId(id);
  };

  const reload = () => {
    setLoading(true);
    Promise.all([fetchData(), fetchFilters(), fetchCounts()]).finally(() => setLoading(false));
  };

  // ─── Keyboard copy: copy 1 dòng + đánh dấu ✓ ──────────────────
  const copyProductionId = async (row: OrderRow) => {
    try {
      await navigator.clipboard.writeText(row.productionId);
      setCopiedId(row._id);
    } catch {
      toast.error(t('toast.copyError'));
    }
  };

  // Lắng nghe ↑/↓ khi bật keyboardMode. Bỏ qua khi đang gõ trong input/select.
  useEffect(() => {
    if (!keyboardMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (items.length === 0) return;
      e.preventDefault();
      const prev = cursorRef.current;
      let next: number;
      if (prev < 0) {
        next = e.key === 'ArrowDown' ? 0 : items.length - 1;
      } else {
        next = e.key === 'ArrowDown' ? Math.min(prev + 1, items.length - 1) : Math.max(prev - 1, 0);
      }
      cursorRef.current = next;
      setCursorIndex(next);
      const row = items[next];
      if (row) void copyProductionId(row);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [keyboardMode, items]);

  // Scroll dòng đang focus vào tầm nhìn.
  useEffect(() => {
    if (keyboardMode && cursorIndex >= 0) {
      activeRowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [cursorIndex, keyboardMode]);

  // Xóa ✓ + cursor khi đổi filter/search/date/status/facet ("filter khác").
  // KHÔNG phụ thuộc `page`/`reloadToken` → sang trang / reload sau thao tác giữ ✓.
  useEffect(() => {
    setCopiedId(null);
    setCursorIndex(-1);
  }, [
    debouncedSearch,
    createdFrom,
    createdTo,
    statusFilter,
    fType,
    fUserSku,
    fFabricType,
    fMachineNumber,
    fPrintStatus,
    fToolResult,
    fToolResultNote,
    fErrorFile,
    fAssignee,
    fDesignerStatus,
    fProductionError,
  ]);

  // Cursor trỏ vị trí trong trang hiện tại → reset index khi đổi trang (✓ giữ nguyên).
  useEffect(() => {
    setCursorIndex(-1);
  }, [page, pageSize]);

  const facets: OrderFilterFacet[] = [
    {
      key: 'type',
      label: t('printTable.facets.type'),
      value: fType,
      onChange: (v) => {
        setFType(v);
        setPage(1);
      },
      options: workshopFilters?.type || [],
    },
    {
      key: 'userSku',
      label: t('printTable.facets.userSku'),
      value: fUserSku,
      onChange: (v) => {
        setFUserSku(v);
        setPage(1);
      },
      options: workshopFilters?.userSku || [],
    },
    {
      key: 'fabricType',
      label: t('printTable.facets.fabricType'),
      value: fFabricType,
      onChange: setFFabricType,
      options: workshopFilters?.fabricType || [],
      perm: 'order.field.fabricType.view',
    },
    {
      key: 'machineNumber',
      label: t('printTable.facets.machineNumber'),
      value: fMachineNumber,
      onChange: setFMachineNumber,
      options: workshopFilters?.machineNumber || [],
      perm: 'order.field.machineNumber.view',
    },
    {
      key: 'printStatus',
      label: t('printTable.facets.printStatus'),
      value: fPrintStatus,
      onChange: setFPrintStatus,
      options: workshopFilters?.printStatus || [],
      perm: 'order.field.printStatus.view',
    },
    {
      key: 'toolResult',
      label: t('printTable.facets.toolResult'),
      value: fToolResult,
      onChange: setFToolResult,
      options: workshopFilters?.toolResult || [],
      perm: 'order.field.toolResult.view',
    },
    {
      key: 'toolResultNote',
      label: t('printTable.facets.toolResultNote'),
      value: fToolResultNote,
      onChange: setFToolResultNote,
      options: workshopFilters?.toolResultNote || [],
      perm: 'order.field.toolResultNote.view',
    },
    {
      key: 'errorFile',
      label: t('printTable.facets.errorFile'),
      value: fErrorFile,
      onChange: setFErrorFile,
      options: workshopFilters?.errorFile || [],
      perm: 'order.field.errorFile.view',
    },
    {
      key: 'assignee',
      label: t('printTable.facets.assignee'),
      value: fAssignee,
      onChange: setFAssignee,
      options: workshopFilters?.assignee || [],
      perm: 'order.field.assignee.view',
    },
    {
      key: 'designerStatus',
      label: t('printTable.facets.designerStatus'),
      value: fDesignerStatus,
      onChange: setFDesignerStatus,
      options: workshopFilters?.designerStatus || [],
      perm: 'order.field.designerStatus.view',
    },
    {
      key: 'productionError',
      label: t('printTable.facets.productionError'),
      value: fProductionError,
      onChange: setFProductionError,
      options: workshopFilters?.productionError || [],
      perm: 'order.field.productionError.view',
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Chips trạng thái stage — hàng ngang + count */}
        <div className="flex flex-wrap items-center gap-2 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:pb-0.5 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
          {statusTabs.map((tab) => {
            const active = statusFilter === tab.value;
            if (tab.value === 'held' && !active && !counts.held) return null;
            return (
              <button
                key={tab.value || 'all'}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.value);
                  setPage(1);
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors touch:min-h-10',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted',
                )}
              >
                <span className={active ? 'text-primary' : tab.accent}>{tab.label}</span>
                <span
                  className={cn(
                    'min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums',
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                  )}
                >
                  {counts[tab.countKey]}
                </span>
              </button>
            );
          })}

          {/* Toggle chế độ copy bằng phím ↑↓ */}
          {!isMobile && (
          <button
            type="button"
            onClick={() => setKeyboardMode((v) => !v)}
            title={t('printTable.keyboardMode.toggleTitle')}
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              keyboardMode
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:bg-muted',
            )}
          >
            <Keyboard size={14} />
            {t('printTable.keyboardMode.label')}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                keyboardMode ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {keyboardMode ? t('printTable.keyboardMode.on') : t('printTable.keyboardMode.off')}
            </span>
          </button>
          )}
        </div>

        <OrderFilterBar
          search={search}
          onSearchChange={setSearch}
          createdFrom={createdFrom}
          createdTo={createdTo}
          onDateRangeChange={(f, to) => {
            setCreatedFrom(f);
            setCreatedTo(to);
            setPage(1);
          }}
          onReload={reload}
          loading={loading}
          facets={facets}
        />

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

        {!isMobile && keyboardMode && items.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-foreground">
            <Keyboard size={13} className="mt-0.5 shrink-0 text-primary" />
            <p>
              {t('printTable.keyboardHint.pre')}{' '}
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">↑</kbd>{' '}
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">↓</kbd>{' '}
              {t('printTable.keyboardHint.mid')}{' '}
              <CheckCircle2 size={11} className="inline text-emerald-500" /> {t('printTable.keyboardHint.suffix')}
            </p>
          </div>
        )}

        {!isMobile && !keyboardMode && selected.size === 0 && items.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <MousePointerClick size={13} className="mt-0.5 shrink-0 text-primary" />
            <p>
              {t('printTable.shiftHint.pre')}{' '}
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">Shift</kbd>{' '}
              {t('printTable.shiftHint.suffix')}
            </p>
          </div>
        )}

        <LoadingOverlay
          active={loading && items.length > 0}
          className={cn(!isMobile && 'rounded-lg border border-border bg-card overflow-hidden')}
        >
          {isMobile ? (
            <PrintOrderCards
              items={items}
              loading={loading}
              selected={selected}
              canSelect={canSelect}
              isNoTool={isNoTool}
              displayUnits={displayUnits}
              renderCtx={renderCtx}
              extraRowAction={extraRowAction}
              onToggle={handleCheckboxChange}
              onDetail={(row) => setDetailTarget({ id: row._id, productionId: row.productionId })}
              noResultsLabel={t('printTable.noResults')}
              detailLabel={tOrders('printCard.details')}
            />
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 sticky left-0 z-30 bg-card">
                    <input
                      type="checkbox"
                      checked={allSelectableSelected}
                      disabled={selectableIds.length === 0}
                      onChange={toggleAll}
                      title={t('printTable.selectAllTitle')}
                    />
                  </TableHead>
                  {displayUnits.map((u, i) => (
                    <TableHead
                      key={u.kind === 'col' ? u.col.key : u.group.key}
                      className={cn(
                        'whitespace-nowrap text-xs',
                        u.kind === 'col' && u.col.width,
                        i === 0 && 'sticky left-8 z-30 bg-card shadow-[1px_0_0_0_var(--border)]',
                      )}
                      style={u.kind === 'group' ? { minWidth: u.group.width } : undefined}
                    >
                      {u.kind === 'col' ? u.col.label : u.group.title}
                    </TableHead>
                  ))}
                  <TableHead className="w-12"></TableHead>
                  {extraRowAction && (
                    <TableHead className="sticky right-0 z-30 bg-card whitespace-nowrap text-xs shadow-[-1px_0_0_0_var(--border)]">
                      {extraActionLabel ?? t('printTable.defaultActionLabel')}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={displayUnits.length + 2 + (extraRowAction ? 1 : 0)}
                      className="text-center py-10"
                    >
                      <Spinner size={20} className="text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={displayUnits.length + 2 + (extraRowAction ? 1 : 0)}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      {t('printTable.noResults')}
                    </TableCell>
                  </TableRow>
                )}
                {items.map((row, idx) => {
                  const isSel = selected.has(row._id);
                  const selectable = canSelect(row);
                  const noTool = isNoTool(row.toolResult);
                  // Đơn ĐANG lỗi (đang hiện ở Nhật ký bù lỗi tab "Cần xử lý"):
                  // báo lỗi không rút đơn khỏi bảng In — nền đỏ để người in biết
                  // đơn cần làm lại. Ưu tiên đỏ hơn nền no-tool.
                  const hasError = !!row.productionError && !row.errorResolvedAt;
                  const isCopied = copiedId === row._id;
                  const isCursor = keyboardMode && idx === cursorIndex;
                  const rowBgClass = isSel
                    ? 'bg-primary/10 dark:bg-primary/20'
                    : hasError
                      ? 'bg-red-100 dark:bg-red-500/15'
                      : noTool
                        ? 'bg-sky-100 dark:bg-sky-500/20'
                        : 'bg-card';
                  return (
                    <TableRow
                      key={row._id}
                      ref={isCursor ? activeRowRef : undefined}
                      className={cn(
                        rowBgClass,
                        hasError
                          ? 'border-l-2 border-l-red-500 dark:border-l-red-400/70'
                          : noTool && 'border-l-2 border-l-sky-400 dark:border-l-sky-400/60',
                        isCursor && 'ring-2 ring-inset ring-primary',
                      )}
                    >
                      <TableCell className={cn('sticky left-0 z-10', rowBgClass)}>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={isSel}
                            disabled={!selectable}
                            onMouseDown={(e) => {
                              shiftKeyRef.current = e.shiftKey;
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => handleCheckboxChange(row._id)}
                            title={
                              selectable ? t('printTable.rowSelectableTitle') : t('printTable.rowNotSelectableTitle')
                            }
                          />
                          {isCopied && (
                            <CheckCircle2
                              size={15}
                              className="shrink-0 text-emerald-500"
                              aria-label={t('printTable.copiedAria')}
                            />
                          )}
                        </div>
                      </TableCell>
                      {displayUnits.map((u, i) => (
                        <TableCell
                          key={u.kind === 'col' ? u.col.key : u.group.key}
                          className={cn(
                            'py-2',
                            i === 0 && cn('sticky left-8 z-10 shadow-[1px_0_0_0_var(--border)]', rowBgClass),
                          )}
                        >
                          {u.kind === 'col' ? (
                            <div className="min-w-0">{u.col.render(row, renderCtx)}</div>
                          ) : (
                            <GroupCellContent
                              group={u.group}
                              singleLineValues
                              renderedByKey={new Map(u.group.members.map((m) => [m.key, m.render(row, renderCtx)]))}
                            />
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('printTable.historyTitle')}
                          onClick={() => setHistoryTarget({ id: row._id, productionId: row.productionId })}
                        >
                          <History size={13} className="text-muted-foreground" />
                        </Button>
                      </TableCell>
                      {extraRowAction && (
                        <TableCell className={cn('sticky right-0 z-10 shadow-[-1px_0_0_0_var(--border)]', rowBgClass)}>
                          {extraRowAction(row)}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          )}

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

        {renderBulkBar ? (
          selected.size > 0 &&
          renderBulkBar(
            items.filter((r) => selected.has(r._id)),
            () => setSelected(new Set()),
          )
        ) : (
          <BulkEditToolbar
            selectedIds={Array.from(selected)}
            onClear={() => setSelected(new Set())}
            onApplied={() => {
              setSelected(new Set());
              reload();
            }}
          />
        )}

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

/** Column / group keys the phone card shows, in order. Everything else is one tap away in the detail sheet. */
const CARD_UNIT_KEYS = ['productionId', 'mockupTypeSize', 'print'] as const;

interface PrintOrderCardsProps {
  items: OrderRow[];
  loading: boolean;
  selected: Set<string>;
  canSelect: (row: OrderRow) => boolean;
  isNoTool: (toolResult?: string) => boolean;
  displayUnits: DisplayUnit[];
  renderCtx: WorkshopRenderCtx;
  extraRowAction?: (row: OrderRow) => React.ReactNode;
  onToggle: (id: string) => void;
  onDetail: (row: OrderRow) => void;
  noResultsLabel: string;
  detailLabel: string;
}

/**
 * Phone layout of the print list (DesignSystem-LegacyParity.md §10): one card per order instead of
 * a ten-column table that scrolls sideways. A card shows the few things a worker at the press
 * needs — order id, product (mockup · type · size · color), print state — and the row's action
 * buttons (Start / Complete / Report error), full width at the bottom, in thumb reach. Anything
 * else opens in the detail sheet. Red / sky left bars keep the table's error and no-tool signals.
 */
function PrintOrderCards({
  items,
  loading,
  selected,
  canSelect,
  isNoTool,
  displayUnits,
  renderCtx,
  extraRowAction,
  onToggle,
  onDetail,
  noResultsLabel,
  detailLabel,
}: PrintOrderCardsProps) {
  const unitKey = (u: DisplayUnit) => (u.kind === 'col' ? u.col.key : u.group.key);
  const cardUnits = CARD_UNIT_KEYS.map((k) => displayUnits.find((u) => unitKey(u) === k)).filter(
    (u): u is DisplayUnit => !!u,
  );
  const errorUnit = displayUnits.find((u) => u.kind === 'group' && u.group.key === 'productionError');

  const renderUnit = (u: DisplayUnit, row: OrderRow) =>
    u.kind === 'col' ? (
      u.col.render(row, renderCtx)
    ) : (
      <GroupCellContent
        group={u.group}
        singleLineValues
        renderedByKey={new Map(u.group.members.map((m) => [m.key, m.render(row, renderCtx)]))}
      />
    );

  if (items.length === 0) {
    return loading ? (
      <div className="flex justify-center py-10">
        <Spinner size={20} className="text-muted-foreground" />
      </div>
    ) : (
      <p className="py-10 text-center text-sm text-muted-foreground">{noResultsLabel}</p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((row) => {
        const isSel = selected.has(row._id);
        const hasError = !!row.productionError && !row.errorResolvedAt;
        const noTool = isNoTool(row.toolResult);
        const action = extraRowAction?.(row);
        return (
          <li
            key={row._id}
            className={cn(
              'relative overflow-hidden rounded-xl bg-card p-3 pl-4 shadow-sm ring-1 ring-border/60',
              isSel && 'ring-2 ring-primary',
              hasError && 'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-red-500',
              !hasError && noTool && 'before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-sky-400',
            )}
          >
            <div className="flex items-start gap-2">
              {/* The checkbox is wrapped so the WHOLE 44px square is the touch target. */}
              <label className="-m-1 flex h-11 w-11 shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={isSel}
                  disabled={!canSelect(row)}
                  onChange={() => onToggle(row._id)}
                />
              </label>
              <div className="min-w-0 flex-1 space-y-2">
                {cardUnits.map((u) => (
                  <div key={unitKey(u)} className="min-w-0">
                    {renderUnit(u, row)}
                  </div>
                ))}
                {hasError && errorUnit && <div className="min-w-0">{renderUnit(errorUnit, row)}</div>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              {action}
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onDetail(row)}>
                {detailLabel}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
