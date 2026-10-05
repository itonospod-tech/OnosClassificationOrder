import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Download, Factory, History, Layers, Send } from 'lucide-react';
import type { FactoryOption, FactoryOverview, FactoryOverviewCell } from 'shared';
import { toast } from 'sonner';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { CancelledBadge } from '@/components/orders/CancelledBadge';
import { OrderFilterBar, type OrderFilterFacet } from '@/components/orders/OrderFilterBar';
import { OrderLogTimelineDialog } from '@/components/orders/OrderLogTimelineDialog';
import { OrderRowActionsMenu } from '@/components/orders/OrderRowActionsMenu';
import {
  buildColGroups,
  GroupCellContent,
  WORKSHOP_COLS,
  type WorkshopOrderRow,
  type WorkshopRenderCtx,
} from '@/components/orders/workshopTableConfig';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { isCancelled } from '@/utils/orderActions';

import { useDebounce } from '@/hooks/useDebounce';
import { useFactoryScope } from '@/hooks/useFactoryScope';
import { NO_TOOL_ROW_CLASS, useIsNoTool } from '@/hooks/useIsNoTool';
import { usePermission } from '@/hooks/usePermission';

import { DailyBySellerReport } from './DailyBySellerReport';
import { buildWorkbook, downloadWorkbook, type ExportableOrder } from './exportOrders';

type PrintStage = 'printed' | 'printing' | 'not-printed';

/** View mode — "Theo xưởng" (per-factory cards) hay "Tổng" (1 card gộp tất cả).
 *  Tab "Tổng" chỉ admin xem được. */
type ViewMode = 'by-factory' | 'total';

type FilterMode =
  | { kind: 'all' }
  | { kind: 'at'; factoryId: string }
  | { kind: 'in'; factoryId: string } // transferred-in to factoryId
  | { kind: 'out'; factoryId: string } // transferred-out from factoryId
  | { kind: 'print'; factoryId: string; stage: PrintStage }
  | { kind: 'print-all'; stage: PrintStage } // print stage across ALL factories (Tổng view)
  | { kind: 'error'; factoryId: string } // đơn lỗi xưởng tại factoryId
  | { kind: 'error-all' }; // đơn lỗi xưởng across ALL factories (Tổng view)

interface SelectFilters {
  type: string;
  fabric: string;
  tool: string;
  /** machineTypeId — "Phòng" (loại máy in). */
  machine: string;
  /** workshop_config code (category=machine) — số máy thực. */
  machineNumber: string;
  /** workshop_config code (category=tool_result_note) — cột "Note kq Tool". */
  toolNote: string;
  /** userSku — khách sở hữu đơn. */
  user: string;
}

function todayISO() {
  // Local date — `toISOString()` would shift to UTC and return yesterday for
  // UTC+ timezones in the morning.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const DEFAULT_PAGE_SIZE = 20;

// URL params dùng prefix `f` (factory) để không clash với param của status tab.
// Ví dụ URL khôi phục đầy đủ:
//   /dashboard?tab=factory&ffrom=2026-06-18&fto=2026-06-18&ffactory=<id>&fstage=printed&ftype=Tee
function parseFilterModeFromURL(sp: URLSearchParams, factoryScope: string): FilterMode {
  const mode = sp.get('fmode');
  const stage = sp.get('fstage') as PrintStage | null;
  if (mode === 'error-all') return { kind: 'error-all' };
  if (mode === 'print-all' && (stage === 'printed' || stage === 'printing' || stage === 'not-printed')) {
    return { kind: 'print-all', stage };
  }
  // `ffactory` = the tab's own factory chip (a separate choice, kept). Without it, fall back to
  // the header factory scope — passed in from `useFactoryScope` (Orders.md §25), never read
  // from `?factoryId=` here, which would skip the Fulfillment lock.
  const fid = sp.get('ffactory') || factoryScope;
  if (!fid) return { kind: 'all' };
  if (stage === 'printed' || stage === 'printing' || stage === 'not-printed') {
    return { kind: 'print', factoryId: fid, stage };
  }
  if (mode === 'error') return { kind: 'error', factoryId: fid };
  if (mode === 'in') return { kind: 'in', factoryId: fid };
  if (mode === 'out') return { kind: 'out', factoryId: fid };
  return { kind: 'at', factoryId: fid };
}

export default function OrderFactoryTab() {
  const { t } = useTranslation('dashboard');
  const { t: tOrders } = useTranslation('orders');
  const { canViewField, canEditField, has, isAdmin, roleName } = usePermission();
  const canTransfer = isAdmin || has('order.transfer');
  const [searchParams, setSearchParams] = useSearchParams();

  // Inline cells (fabric / tool / printStatus / assignee …) resolve their
  // dropdown options + labels through the workshop config store — make sure
  // it's loaded before rows render. Each tab is mounted independently so we
  // can't rely on another page having warmed the cache.
  const loadWorkshopConfig = useWorkshopConfigStore((s) => s.load);
  const workshopConfigLoaded = useWorkshopConfigStore((s) => s.loaded);
  useEffect(() => {
    if (!workshopConfigLoaded) loadWorkshopConfig();
  }, [workshopConfigLoaded, loadWorkshopConfig]);

  // Date filters default to today on every mount. Workshop staff scan
  // "today's orders" by default; widen the range manually if needed.
  // F5 / reload đọc lại từ URL params nếu có.
  const [createdFrom, setCreatedFrom] = useState(() => searchParams.get('ffrom') || todayISO());
  const [createdTo, setCreatedTo] = useState(() => searchParams.get('fto') || todayISO());

  // Search (Production ID / SKU / Order ID / Type) — đồng bộ với 3 bảng order
  // khác. Debounce 300ms vì BE getOrders chạy aggregate khá nặng.
  const [search, setSearch] = useState(() => searchParams.get('fsearch') || '');
  const debouncedSearch = useDebounce(search, 300);

  const [overview, setOverview] = useState<FactoryOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const v = searchParams.get('fview');
    return v === 'total' && isAdmin ? 'total' : 'by-factory';
  });
  const factoryScopeParam = useFactoryScope() || '';
  const [filterMode, setFilterMode] = useState<FilterMode>(() => parseFilterModeFromURL(searchParams, factoryScopeParam));
  const [selectFilters, setSelectFilters] = useState<SelectFilters>(() => ({
    type: searchParams.get('ftype') || '',
    fabric: searchParams.get('ffabric') || '',
    tool: searchParams.get('ftool') || '',
    machine: searchParams.get('fmachine') || '',
    machineNumber: searchParams.get('fmnum') || '',
    toolNote: searchParams.get('ftoolnote') || '',
    user: searchParams.get('fuser') || '',
  }));

  const [rows, setRows] = useState<WorkshopOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const resolveWorkshop = useWorkshopConfigStore((s) => s.resolve);
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('fpage'));
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const s = Number(searchParams.get('fsize'));
    return Number.isFinite(s) && s > 0 ? s : DEFAULT_PAGE_SIZE;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bấm sang cụm xưởng khác (hoặc về cụm chung) chỉ đổi `factoryId` trên URL —
  // state của tab thì đã seed từ lần mount đầu, không tự đổi theo. Không có
  // effect này thì effect đồng bộ URL bên dưới ghi ngược giá trị cũ trở lại và
  // người dùng thấy "bấm menu mà không có gì xảy ra".
  useEffect(() => {
    setFilterMode((prev) => {
      const current = 'factoryId' in prev ? prev.factoryId : '';
      if (current === factoryScopeParam) return prev;
      return factoryScopeParam ? { kind: 'at', factoryId: factoryScopeParam } : { kind: 'all' };
    });
    setPage(1);
  }, [factoryScopeParam]);

  // Sync state → URL (replace để không spam history). Mỗi state đổi → cập
  // nhật URL, F5 sẽ đọc lại đúng. Date LUÔN ghi vào URL (kể cả today) để
  // URL reflect đúng state user thấy; page/size default thì strip để gọn.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        // Date luôn ghi
        createdFrom ? sp.set('ffrom', createdFrom) : sp.delete('ffrom');
        createdTo ? sp.set('fto', createdTo) : sp.delete('fto');
        // Search
        search ? sp.set('fsearch', search) : sp.delete('fsearch');
        // View mode
        viewMode === 'total' ? sp.set('fview', 'total') : sp.delete('fview');
        // Filter mode
        sp.delete('ffactory');
        sp.delete('fmode');
        sp.delete('fstage');
        // TUYỆT ĐỐI không đụng tới `factoryId` ở đây: nó do sidebar (cụm menu
        // xưởng) làm chủ, effect này chỉ ĐỌC. `setSearchParams` của
        // react-router 6.14 đổi identity mỗi lần URL đổi (memo theo
        // `location.search`) nên effect chạy lại với closure state CŨ; ghi
        // `factoryId` ở đây là chiều ghi thứ hai vào cùng một param mà effect
        // theo dõi phạm vi đang đọc → hai bên đẩy qua đẩy lại, URL nhảy loạn
        // giữa 2 xưởng không dừng.
        if (filterMode.kind === 'print-all') {
          sp.set('fmode', 'print-all');
          sp.set('fstage', filterMode.stage);
        } else if (filterMode.kind === 'error-all') {
          sp.set('fmode', 'error-all');
        } else if (filterMode.kind !== 'all') {
          sp.set('ffactory', filterMode.factoryId);
          if (filterMode.kind === 'print') {
            sp.set('fstage', filterMode.stage);
          } else if (filterMode.kind === 'error') {
            sp.set('fmode', 'error');
          } else if (filterMode.kind !== 'at') {
            sp.set('fmode', filterMode.kind);
          }
        }
        // Select filters
        selectFilters.type ? sp.set('ftype', selectFilters.type) : sp.delete('ftype');
        selectFilters.fabric ? sp.set('ffabric', selectFilters.fabric) : sp.delete('ffabric');
        selectFilters.tool ? sp.set('ftool', selectFilters.tool) : sp.delete('ftool');
        selectFilters.machine ? sp.set('fmachine', selectFilters.machine) : sp.delete('fmachine');
        selectFilters.machineNumber ? sp.set('fmnum', selectFilters.machineNumber) : sp.delete('fmnum');
        selectFilters.toolNote ? sp.set('ftoolnote', selectFilters.toolNote) : sp.delete('ftoolnote');
        selectFilters.user ? sp.set('fuser', selectFilters.user) : sp.delete('fuser');
        // Pagination
        page > 1 ? sp.set('fpage', String(page)) : sp.delete('fpage');
        pageSize !== DEFAULT_PAGE_SIZE ? sp.set('fsize', String(pageSize)) : sp.delete('fsize');
        return sp;
      },
      { replace: true },
    );
  }, [createdFrom, createdTo, search, viewMode, filterMode, selectFilters, page, pageSize, setSearchParams]);

  const [preview, setPreview] = useState<{ url: string; originalUrl?: string; title: string } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ id: string; productionId: string } | null>(null);
  const [transferDialog, setTransferDialog] = useState<{ ids: string[] } | null>(null);

  // Overview query — includes the factory scope so dropdown options below
  // shrink to match the selected factory chip. Print-stage filter cũng dùng
  // factory scope vì luôn gắn với 1 xưởng cụ thể, và truyền thêm printStage
  // để BE thu hẹp availableFilters chỉ còn options của stage đó.
  // Faceted filters (type/fabric/tool/...) cũng được pass lên — BE dùng pattern
  // "exclude-own-facet" để mỗi dropdown count theo các filter khác đang active.
  const overviewQuery = useMemo(() => {
    const sp = new URLSearchParams();
    if (createdFrom) sp.set('createdFrom', createdFrom);
    if (createdTo) sp.set('createdTo', createdTo);
    if (filterMode.kind === 'at' || filterMode.kind === 'print' || filterMode.kind === 'error') {
      sp.set('factoryId', filterMode.factoryId);
    }
    if (filterMode.kind === 'print') {
      sp.set('printStage', filterMode.stage);
    }
    if (filterMode.kind === 'print-all') {
      sp.set('printStage', filterMode.stage);
    }
    if (filterMode.kind === 'error') {
      sp.set('hasError', 'true');
    }
    if (filterMode.kind === 'error-all') {
      sp.set('hasError', 'true');
    }
    if (selectFilters.type) sp.set('type', selectFilters.type);
    if (selectFilters.fabric) sp.set('fabricType', selectFilters.fabric);
    if (selectFilters.tool) sp.set('toolResult', selectFilters.tool);
    if (selectFilters.machine) sp.set('machineTypeId', selectFilters.machine);
    if (selectFilters.machineNumber) sp.set('machineNumber', selectFilters.machineNumber);
    if (selectFilters.toolNote) sp.set('toolResultNote', selectFilters.toolNote);
    if (selectFilters.user) sp.set('userSku', selectFilters.user);
    return sp.toString();
  }, [createdFrom, createdTo, filterMode, selectFilters]);

  // Xưởng đang bị lọc (chip "Đang ở X" / drill-down in / lỗi xưởng). Có lọc
  // xưởng → chỉ hiện thẻ của xưởng đó, ẩn các xưởng khác cho khỏi rối; chip bar
  // vẫn liệt kê đủ xưởng nên đổi xưởng / bỏ lọc vẫn bình thường.
  const scopedFactoryId = 'factoryId' in filterMode ? filterMode.factoryId : undefined;
  const visibleFactoryCells = useMemo(() => {
    const cells = overview?.factories || [];
    return scopedFactoryId ? cells.filter((f) => f.factoryId === scopedFactoryId) : cells;
  }, [overview, scopedFactoryId]);
  // Luồng chuyển xưởng: chỉ giữ luồng có dính xưởng đang lọc (đi hoặc đến).
  const visibleFlows = useMemo(() => {
    const flows = overview?.flows || [];
    return scopedFactoryId
      ? flows.filter((f) => f.fromFactoryId === scopedFactoryId || f.toFactoryId === scopedFactoryId)
      : flows;
  }, [overview, scopedFactoryId]);

  const fetchOverview = useCallback(async () => {
    try {
      setOverviewLoading(true);
      const res = await RepositoryRemote.order.getFactoryOverview(overviewQuery ? '?' + overviewQuery : '');
      setOverview((res.data?.data || null) as FactoryOverview | null);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setOverviewLoading(false);
    }
  }, [overviewQuery]);

  const fetchRows = useCallback(async () => {
    const sp = new URLSearchParams();
    if (createdFrom) sp.set('createdFrom', createdFrom);
    if (createdTo) sp.set('createdTo', createdTo);
    sp.set('page', String(page));
    sp.set('limit', String(pageSize));
    sp.set('sort', 'grouped');
    if (filterMode.kind === 'at') sp.set('factoryId', filterMode.factoryId);
    if (filterMode.kind === 'in') sp.set('transferStatus', `transferred-in:${filterMode.factoryId}`);
    if (filterMode.kind === 'out') sp.set('transferStatus', `transferred-out:${filterMode.factoryId}`);
    if (filterMode.kind === 'print') {
      sp.set('factoryId', filterMode.factoryId);
      sp.set('printStage', filterMode.stage);
    }
    if (filterMode.kind === 'print-all') sp.set('printStage', filterMode.stage);
    if (filterMode.kind === 'error') {
      sp.set('factoryId', filterMode.factoryId);
      sp.set('hasError', 'true');
    }
    if (filterMode.kind === 'error-all') sp.set('hasError', 'true');
    if (selectFilters.type) sp.set('type', selectFilters.type);
    if (selectFilters.fabric) sp.set('fabricType', selectFilters.fabric);
    if (selectFilters.tool) sp.set('toolResult', selectFilters.tool);
    if (selectFilters.machine) sp.set('machineTypeId', selectFilters.machine);
    if (selectFilters.machineNumber) sp.set('machineNumber', selectFilters.machineNumber);
    if (selectFilters.toolNote) sp.set('toolResultNote', selectFilters.toolNote);
    if (selectFilters.user) sp.set('userSku', selectFilters.user);
    if (debouncedSearch.trim()) sp.set('search', debouncedSearch.trim());
    try {
      setRowsLoading(true);
      const res = await RepositoryRemote.order.getOrders('?' + sp.toString());
      setRows((res.data?.data || []) as WorkshopOrderRow[]);
      setTotal(res.data?.total || 0);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setRowsLoading(false);
    }
  }, [createdFrom, createdTo, page, pageSize, filterMode, selectFilters, debouncedSearch]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Skip 2 cleanup useEffect dưới đây trong mount đầu — nếu không sẽ ghi đè
  // state đã đọc từ URL (vd. F5 với `?fpage=3&ftype=Tee` sẽ bị reset về 1+rỗng).
  const isFirstRender = React.useRef(true);
  useEffect(() => {
    if (isFirstRender.current) return;
    setPage(1);
  }, [filterMode, pageSize, selectFilters, viewMode]);

  // Switch view mode (Theo xưởng ↔ Tổng) — reset filter + page về mặc định để
  // không leak filter cũ qua view mới (vd. ở "Theo xưởng" đang chọn factory X,
  // sang "Tổng" mà vẫn dính `kind:'at'` thì list hiển thị sai).
  const handleSwitchView = useCallback((next: ViewMode) => {
    setViewMode(next);
    setFilterMode({ kind: 'all' });
    setSelectFilters({ type: '', fabric: '', tool: '', machine: '', machineNumber: '', toolNote: '', user: '' });
    setPage(1);
  }, []);

  // When user changes the factory chip the scope of available options shifts.
  // Stale selections (e.g. a product that only exists at the previous factory)
  // would silently return zero rows — clear them so the new scope is honest.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setSelectFilters({ type: '', fabric: '', tool: '', machine: '', machineNumber: '', toolNote: '', user: '' });
  }, [filterMode]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const visibleCols = useMemo(() => WORKSHOP_COLS.filter((c) => !c.perm || canViewField(c.key)), [canViewField]);
  // Gom cột theo chủ đề nghiệp vụ (giống OrderTableWorkshop) để giảm scroll
  // ngang — xem `buildColGroups`/`GroupCellContent` trong workshopTableConfig.tsx.
  const colGroups = useMemo(() => buildColGroups(visibleCols, roleName), [visibleCols, roleName]);

  /** Aggregate "Tổng" view metrics — sum print pipeline + tool counts across
   *  factory cards; distinct counts (sản phẩm/vải/phòng/máy) lấy thẳng từ
   *  `availableFilters` vì đây mới là DISTINCT thực sự (sum cells.productCount
   *  sẽ overcounting khi 1 type xuất hiện ở nhiều xưởng). */
  const totalAgg = useMemo(() => {
    const cells = overview?.factories || [];
    return {
      total: overview?.totals.total ?? 0,
      pure: overview?.totals.pure ?? 0,
      transferred: overview?.totals.transferred ?? 0,
      productCount: overview?.availableFilters.products.length ?? 0,
      fabricCount: overview?.availableFilters.fabrics.length ?? 0,
      machineCount: overview?.availableFilters.machineTypes.length ?? 0,
      actualMachineCount: overview?.availableFilters.machines.length ?? 0,
      withToolCount: cells.reduce((s, c) => s + c.withToolCount, 0),
      printedCount: cells.reduce((s, c) => s + c.printedCount, 0),
      printingCount: cells.reduce((s, c) => s + c.printingCount, 0),
      notPrintedCount: cells.reduce((s, c) => s + c.notPrintedCount, 0),
      errorCount: cells.reduce((s, c) => s + c.errorCount, 0),
      designAssignedCount: cells.reduce((s, c) => s + c.designAssignedCount, 0),
      designUnassignedCount: cells.reduce((s, c) => s + c.designUnassignedCount, 0),
      designDoneCount: cells.reduce((s, c) => s + c.designDoneCount, 0),
      designNotDoneCount: cells.reduce((s, c) => s + c.designNotDoneCount, 0),
    };
  }, [overview]);

  const patchRow = (id: string, p: Partial<WorkshopOrderRow>) =>
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...p } : r)));

  const openPreview = (url: string, title: string, originalUrl?: string) => setPreview({ url, originalUrl, title });

  const ctx: WorkshopRenderCtx = { canEditField, patchRow, openPreview, t: tOrders };
  const isNoTool = useIsNoTool();

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r._id))));

  const onAfterTransfer = () => {
    setSelected(new Set());
    setTransferDialog(null);
    fetchOverview();
    fetchRows();
  };

  // Export ALL rows matching the CURRENT filter — bypasses pagination, sends
  // the same query params as `fetchRows` minus page/limit. Names (fabric,
  // tool result, assignee…) get resolved on the client through the workshop
  // config store so the spreadsheet reads in Vietnamese.
  const handleExport = async () => {
    const sp = new URLSearchParams();
    if (createdFrom) sp.set('createdFrom', createdFrom);
    if (createdTo) sp.set('createdTo', createdTo);
    if (filterMode.kind === 'at') sp.set('factoryId', filterMode.factoryId);
    if (filterMode.kind === 'in') sp.set('transferStatus', `transferred-in:${filterMode.factoryId}`);
    if (filterMode.kind === 'out') sp.set('transferStatus', `transferred-out:${filterMode.factoryId}`);
    if (filterMode.kind === 'print') {
      sp.set('factoryId', filterMode.factoryId);
      sp.set('printStage', filterMode.stage);
    }
    if (filterMode.kind === 'print-all') sp.set('printStage', filterMode.stage);
    if (filterMode.kind === 'error') {
      sp.set('factoryId', filterMode.factoryId);
      sp.set('hasError', 'true');
    }
    if (filterMode.kind === 'error-all') sp.set('hasError', 'true');
    if (selectFilters.type) sp.set('type', selectFilters.type);
    if (selectFilters.fabric) sp.set('fabricType', selectFilters.fabric);
    if (selectFilters.tool) sp.set('toolResult', selectFilters.tool);
    if (selectFilters.machine) sp.set('machineTypeId', selectFilters.machine);
    if (selectFilters.machineNumber) sp.set('machineNumber', selectFilters.machineNumber);
    if (selectFilters.toolNote) sp.set('toolResultNote', selectFilters.toolNote);
    if (selectFilters.user) sp.set('userSku', selectFilters.user);
    try {
      setExportLoading(true);
      const res = await RepositoryRemote.order.exportOrders('?' + sp.toString());
      const data = (res.data?.data || []) as ExportableOrder[];
      if (data.length === 0) {
        toast.warning(t('factoryTab.noOrdersToExport'));
        return;
      }
      // Reuse the overview already loaded for the visible tab — it reflects
      // the same date range + factory scope, so the Summary sheet matches what
      // the user sees on screen.
      const wb = buildWorkbook(data, overview, { resolve: resolveWorkshop });
      const stamp = new Date().toLocaleString('sv-SE', { hour12: false }).replace(/[: ]/g, '-');
      downloadWorkbook(`don-hang-${stamp}.xlsx`, wb);
      toast.success(t('factoryTab.exportedSuccess', { count: data.length }));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Filter bar — đồng bộ position/layout với OrderTableWorkshop,
            ErrorLogTab, OrderStatusTab. Field set giữ factory-specific
            (Sản phẩm/Loại vải/Phòng/Máy/Tool) theo yêu cầu. */}
        <OrderFilterBar
          search={search}
          onSearchChange={setSearch}
          createdFrom={createdFrom}
          createdTo={createdTo}
          onDateRangeChange={(f, t2) => {
            setCreatedFrom(f);
            setCreatedTo(t2);
          }}
          onReload={() => {
            fetchOverview();
            fetchRows();
          }}
          loading={overviewLoading || rowsLoading}
          topActionsRight={
            <>
              {/* Admin-only view switcher: "Theo xưởng" vs "Tổng". */}
              {isAdmin && (
                <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                  <button
                    type="button"
                    onClick={() => handleSwitchView('by-factory')}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 h-7 rounded text-xs transition-colors',
                      viewMode === 'by-factory'
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Factory size={12} /> {t('factoryTab.byFactory')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchView('total')}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 h-7 rounded text-xs transition-colors',
                      viewMode === 'total'
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Layers size={12} /> {t('factoryTab.total')}
                  </button>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exportLoading || rowsLoading}
                title={t('factoryTab.exportTitle')}
              >
                {exportLoading ? <Spinner size={13} className="text-muted-foreground" /> : <Download size={13} />}
                {t('factoryTab.exportExcel')}
              </Button>
              {overview && (
                <span className="ml-auto text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground tabular-nums">{overview.totals.total}</span>{' '}
                  {t('factoryTab.orders')} ·{' '}
                  <span className="font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                    {overview.totals.transferred}
                  </span>{' '}
                  {t('factoryTab.transferredCount')}
                </span>
              )}
            </>
          }
          facets={
            [
              {
                key: 'type',
                label: t('designerStats.product'),
                value: selectFilters.type,
                onChange: (v) => setSelectFilters((s) => ({ ...s, type: v })),
                options: overview?.availableFilters.products || [],
              },
              {
                key: 'fabricType',
                label: t('export.breakdown.categories.fabric'),
                value: selectFilters.fabric,
                onChange: (v) => setSelectFilters((s) => ({ ...s, fabric: v })),
                options: overview?.availableFilters.fabrics || [],
              },
              {
                key: 'machineTypeId',
                label: t('export.headers.machineType'),
                value: selectFilters.machine,
                onChange: (v) => setSelectFilters((s) => ({ ...s, machine: v })),
                options: overview?.availableFilters.machineTypes || [],
              },
              {
                key: 'machineNumber',
                label: t('factoryTab.machine'),
                value: selectFilters.machineNumber,
                onChange: (v) => setSelectFilters((s) => ({ ...s, machineNumber: v })),
                options: overview?.availableFilters.machines || [],
              },
              {
                key: 'toolResult',
                label: t('export.breakdown.categories.toolResult'),
                value: selectFilters.tool,
                onChange: (v) => setSelectFilters((s) => ({ ...s, tool: v })),
                options: overview?.availableFilters.toolResults || [],
              },
              {
                key: 'toolResultNote',
                label: t('statusFilter.category.toolResultNote'),
                value: selectFilters.toolNote,
                onChange: (v) => setSelectFilters((s) => ({ ...s, toolNote: v })),
                options: overview?.availableFilters.toolResultNotes || [],
              },
              {
                key: 'userSku',
                label: t('designerStats.customer'),
                value: selectFilters.user,
                onChange: (v) => setSelectFilters((s) => ({ ...s, user: v })),
                options: overview?.availableFilters.users || [],
              },
            ] satisfies OrderFilterFacet[]
          }
        />

        {/* Cards section — "Theo xưởng" = 3 factory cards; "Tổng" = 1 aggregate
            card với cùng layout print pipeline (Chưa in / Lỗi / Đã in xong)
            nhưng gộp tất cả xưởng, click chip filter cross-factory (print-all,
            error-all). */}
        {viewMode === 'total' ? (
          overview ? (
            <TotalCard agg={totalAgg} filterMode={filterMode} onFilter={setFilterMode} />
          ) : (
            <div className="rounded-lg bg-muted/30 animate-pulse h-[200px]" />
          )
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {visibleFactoryCells.map((f) => (
              <FactoryCard key={f.factoryId} cell={f} filterMode={filterMode} onFilter={setFilterMode} />
            ))}
            {!overview && overviewLoading && (
              <>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-lg bg-muted/30 animate-pulse h-[130px]" />
                ))}
              </>
            )}
          </div>
        )}

        {/* Flow visualization */}
        {overview && visibleFlows.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ArrowRight size={14} /> {t('factoryTab.transferFlow')}
              </h3>
              <span className="text-[11px] text-muted-foreground">{t('factoryTab.clickToFilter')}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {visibleFlows.map((f) => {
                const active = filterMode.kind === 'in' && filterMode.factoryId === f.toFactoryId;
                return (
                  <button
                    key={`${f.fromFactoryId}-${f.toFactoryId}`}
                    type="button"
                    onClick={() => setFilterMode({ kind: 'in', factoryId: f.toFactoryId })}
                    className={cn(
                      'flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                      active
                        ? 'border-amber-400 bg-amber-50/70 dark:bg-amber-500/10'
                        : 'border-border hover:bg-muted/30',
                    )}
                  >
                    <Badge variant="secondary" className="font-mono">
                      {f.fromShortName || f.fromName}
                    </Badge>
                    <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                    <Badge variant="success" className="font-mono">
                      {f.toShortName || f.toName}
                    </Badge>
                    <div className="ml-auto text-right">
                      <p className="text-sm font-bold tabular-nums">{t('drillPanel.orderCount', { count: f.count })}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {t('factoryTab.productCount', { count: f.totalQuantity })}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Filter chip bar */}
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{t('factoryTab.filterLabel')}:</span>
            {/* Trong cụm xưởng, "Tất cả" = bỏ drill-down (in / lỗi) chứ KHÔNG bỏ
                xưởng — bỏ xưởng là việc của sidebar. */}
            <FilterChip
              active={filterMode.kind === (factoryScopeParam ? 'at' : 'all')}
              onClick={() =>
                setFilterMode(factoryScopeParam ? { kind: 'at', factoryId: factoryScopeParam } : { kind: 'all' })
              }
            >
              {t('drillPanel.all')}
            </FilterChip>
            {/* Đang ở cụm menu của 1 xưởng thì bỏ luôn dãy chip xưởng: phạm vi đã do
                sidebar quyết, để lại chỉ tổ có 2 chỗ đổi xưởng chọi nhau. */}
            {viewMode === 'by-factory' &&
              !factoryScopeParam &&
              (overview?.factories || []).map((f) => {
                // Chip "Đang ở X" hiện active khi user chọn factory chip HOẶC
                // đang ở print-stage / lỗi-xưởng drill-down của factory đó —
                // cả 3 mode đều giới hạn data về xưởng X.
                const atOrPrint =
                  (filterMode.kind === 'at' || filterMode.kind === 'print' || filterMode.kind === 'error') &&
                  filterMode.factoryId === f.factoryId;
                return (
                  <FilterChip
                    key={`at-${f.factoryId}`}
                    active={atOrPrint}
                    onClick={() =>
                      setFilterMode(
                        atOrPrint && filterMode.kind === 'at'
                          ? { kind: 'all' }
                          : { kind: 'at', factoryId: f.factoryId },
                      )
                    }
                  >
                    {t('factoryTab.currentlyAt', { name: f.factoryShortName || f.factoryName })}
                  </FilterChip>
                );
              })}
            {filterMode.kind === 'print' && (
              <FilterChip active onClick={() => setFilterMode({ kind: 'all' })}>
                {filterMode.stage === 'printed'
                  ? t('factoryTab.printed')
                  : filterMode.stage === 'printing'
                    ? t('factoryTab.printing')
                    : t('factoryTab.notPrinted')}
              </FilterChip>
            )}
            {filterMode.kind === 'print-all' && (
              <FilterChip active onClick={() => setFilterMode({ kind: 'all' })}>
                {filterMode.stage === 'printed'
                  ? t('factoryTab.printedTotal')
                  : filterMode.stage === 'printing'
                    ? t('factoryTab.printingTotal')
                    : t('factoryTab.notPrintedTotal')}
              </FilterChip>
            )}
            {filterMode.kind === 'error' && (
              <FilterChip active onClick={() => setFilterMode({ kind: 'all' })}>
                {t('factoryTab.factoryError')}
              </FilterChip>
            )}
            {filterMode.kind === 'error-all' && (
              <FilterChip active onClick={() => setFilterMode({ kind: 'all' })}>
                {t('factoryTab.factoryErrorTotal')}
              </FilterChip>
            )}
            {(filterMode.kind !== 'all' ||
              selectFilters.type ||
              selectFilters.fabric ||
              selectFilters.tool ||
              selectFilters.machine ||
              selectFilters.machineNumber ||
              selectFilters.toolNote ||
              selectFilters.user) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 ml-auto"
                onClick={() => {
                  setFilterMode({ kind: 'all' });
                  setSelectFilters({
                    type: '',
                    fabric: '',
                    tool: '',
                    machine: '',
                    machineNumber: '',
                    toolNote: '',
                    user: '',
                  });
                }}
              >
                {t('statusFilter.clearAll')}
              </Button>
            )}
          </div>
        </div>

        {/* Bulk transfer toolbar */}
        {canTransfer && selected.size > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">
              {t('factoryTab.selectedCount', { count: selected.size })}
            </span>
            <Button size="sm" onClick={() => setTransferDialog({ ids: Array.from(selected) })}>
              <Send size={13} /> {t('factoryTab.transferFactory')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t('factoryTab.deselect')}
            </Button>
          </div>
        )}

        <PaginationBar
          position="top"
          page={page}
          pageSize={pageSize}
          total={total}
          loading={rowsLoading && rows.length === 0}
          onChange={(p, ps) => {
            setPage(p);
            setPageSize(ps);
          }}
        />

        {/* Orders table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden relative">
          <div
            className={cn(
              'absolute top-0 left-0 right-0 h-0.5 overflow-hidden bg-primary/10 pointer-events-none transition-opacity duration-200 z-10',
              rowsLoading ? 'opacity-100' : 'opacity-0',
            )}
          >
            <div className="h-full w-1/4 bg-primary animate-indeterminate-bar" />
          </div>

          <div className="border-b border-border px-3 py-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              {t('statusFilter.orderList', { count: total })}
              {rowsLoading && rows.length > 0 && <Spinner size={11} className="text-muted-foreground" />}
            </h3>
          </div>

          <div
            className={cn(
              'overflow-x-auto transition-opacity duration-300',
              rowsLoading && rows.length > 0 && 'opacity-60',
            )}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {canTransfer && (
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && selected.size === rows.length}
                        onChange={toggleAll}
                      />
                    </TableHead>
                  )}
                  <TableHead className="min-w-[150px]">{t('factoryTab.currentOriginalFactory')}</TableHead>
                  {colGroups.map((g) => (
                    <TableHead key={g.key} className="whitespace-nowrap text-xs" style={{ minWidth: g.width }}>
                      {g.title}
                    </TableHead>
                  ))}
                  <TableHead className="w-20 sticky right-0 z-20 bg-card"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colGroups.length + 3} className="text-center py-8">
                      <Spinner size={18} className="text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {!rowsLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={colGroups.length + 3}
                      className="text-center py-8 text-sm text-muted-foreground"
                    >
                      {t('factoryTab.noMatchingOrders')}
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row) => {
                  const isTransferred =
                    !!row.originalFactoryId && !!row.factoryId && row.originalFactoryId !== row.factoryId;
                  const originalMeta = overview?.factories.find((f) => f.factoryId === row.originalFactoryId);
                  const renderedByKey = new Map(visibleCols.map((c) => [c.key, c.render(row, ctx)]));
                  return (
                    <TableRow
                      key={row._id}
                      className={cn(
                        isNoTool(row.toolResult) && !selected.has(row._id) && NO_TOOL_ROW_CLASS,
                        selected.has(row._id) && 'bg-primary/5',
                        isCancelled(row) && 'opacity-60',
                      )}
                    >
                      {canTransfer && (
                        <TableCell>
                          <input type="checkbox" checked={selected.has(row._id)} onChange={() => toggleRow(row._id)} />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-col gap-1 text-[11px]">
                          <Badge variant={isTransferred ? 'warning' : 'success'} className="w-fit">
                            {row.factory?.shortName || '?'} · {row.factory?.name || '?'}
                          </Badge>
                          {isTransferred && (
                            <span className="text-muted-foreground flex items-center gap-1">
                              <span>← {t('factoryTab.original')}:</span>
                              <Badge variant="secondary" className="font-mono text-[10px] py-0">
                                {originalMeta?.factoryShortName || originalMeta?.factoryName || '?'}
                              </Badge>
                            </span>
                          )}
                        </div>
                      </TableCell>
                      {colGroups.map((g, gi) => (
                        <TableCell key={g.key} className="py-2 align-top">
                          {gi === 0 && isCancelled(row) && (
                            <div className="mb-1">
                              <CancelledBadge reason={row.cancelReason} />
                            </div>
                          )}
                          <GroupCellContent group={g} renderedByKey={renderedByKey} />
                        </TableCell>
                      ))}
                      {/* Thao tác — pin cố định BÊN PHẢI */}
                      <TableCell className="sticky right-0 z-10 bg-card shadow-[-1px_0_0_0_var(--border)]">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('statusFilter.history')}
                            onClick={() => setHistoryTarget({ id: row._id, productionId: row.productionId })}
                          >
                            <History size={13} className="text-muted-foreground" />
                          </Button>
                          <OrderRowActionsMenu
                            order={row}
                            onChanged={() => {
                              fetchOverview();
                              fetchRows();
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <PaginationBar
            position="bottom"
            page={page}
            pageSize={pageSize}
            total={total}
            loading={rowsLoading && rows.length === 0}
            onChange={(p, ps) => {
              setPage(p);
              setPageSize(ps);
            }}
          />
        </div>

        {/* Legacy "Production Report › Daily report" (a1, 05/10/2026): collapsible, loads when opened. */}
        <DailyBySellerReport factoryId={filterMode.kind === 'at' ? filterMode.factoryId : undefined} />

        <ImagePreviewDialog
          open={!!preview}
          onOpenChange={(o) => !o && setPreview(null)}
          url={preview?.url}
          originalUrl={preview?.originalUrl}
          title={preview?.title}
        />
        <OrderLogTimelineDialog
          open={!!historyTarget}
          onOpenChange={(o) => !o && setHistoryTarget(null)}
          orderId={historyTarget?.id}
          productionId={historyTarget?.productionId}
        />

        <TransferDialog
          open={!!transferDialog}
          onOpenChange={(o) => !o && setTransferDialog(null)}
          ids={transferDialog?.ids || []}
          // `overview.factories` chỉ có xưởng ĐANG giữ đơn — dùng nó thì không
          // chuyển đơn sang xưởng chưa có đơn nào được. `factoryOptions` là
          // danh sách xưởng đầy đủ từ bảng `factories`.
          factories={overview?.factoryOptions || []}
          onSuccess={onAfterTransfer}
        />
      </div>
    </TooltipProvider>
  );
}

function FactoryCard({
  cell,
  filterMode,
  onFilter,
}: {
  cell: FactoryOverviewCell;
  filterMode: FilterMode;
  onFilter: (m: FilterMode) => void;
}) {
  const { t } = useTranslation('dashboard');
  const isAt = filterMode.kind === 'at' && filterMode.factoryId === cell.factoryId;
  const isIn = filterMode.kind === 'in' && filterMode.factoryId === cell.factoryId;
  const isOut = filterMode.kind === 'out' && filterMode.factoryId === cell.factoryId;
  const isError = filterMode.kind === 'error' && filterMode.factoryId === cell.factoryId;
  const activeStage = filterMode.kind === 'print' && filterMode.factoryId === cell.factoryId ? filterMode.stage : null;
  const togglePrint = (stage: PrintStage) =>
    onFilter(activeStage === stage ? { kind: 'all' } : { kind: 'print', factoryId: cell.factoryId, stage });
  const toggleError = () => onFilter(isError ? { kind: 'all' } : { kind: 'error', factoryId: cell.factoryId });
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-colors',
        isAt ? 'border-primary ring-2 ring-primary/20' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-500/15 flex items-center justify-center">
          <Factory size={18} className="text-sky-600 dark:text-sky-400" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground truncate">{cell.factoryName}</p>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {t('factoryTab.code')}: {cell.factoryShortName || '—'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onFilter(isAt ? { kind: 'all' } : { kind: 'at', factoryId: cell.factoryId })}
        className="w-full text-left mb-2 group"
      >
        <p className="text-2xl font-bold tabular-nums group-hover:text-primary transition-colors">{cell.total}</p>
        <p className="text-[11px] text-muted-foreground">{t('factoryTab.producingHere')}</p>
      </button>
      {/* Per-factory mini stats */}
      <div className="grid grid-cols-5 gap-1 text-[10px] mb-2 pb-2 border-b border-border">
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-foreground">{cell.productCount}</p>
          <p className="text-muted-foreground">{t('export.breakdown.categories.product')}</p>
        </div>
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-foreground">{cell.fabricCount}</p>
          <p className="text-muted-foreground">{t('export.breakdown.categories.fabric')}</p>
        </div>
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-foreground">{cell.machineCount}</p>
          <p className="text-muted-foreground">{t('export.headers.machineType')}</p>
        </div>
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-foreground">{cell.actualMachineCount}</p>
          <p className="text-muted-foreground">{t('factoryTab.machineType')}</p>
        </div>
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-emerald-700 dark:text-emerald-400">{cell.withToolCount}</p>
          <p className="text-muted-foreground">{t('factoryTab.hasTool')}</p>
        </div>
      </div>
      {/* Print pipeline — Chưa in / Lỗi xưởng / Đã in xong. "Đang in" tạm
          bỏ; ô giữa giờ là số đơn xưởng báo lỗi (productionError set). */}
      <div className="grid grid-cols-3 gap-1.5 text-xs mb-2">
        <PrintStageBtn
          label={t('factoryTab.notPrinted')}
          count={cell.notPrintedCount}
          active={activeStage === 'not-printed'}
          onClick={() => togglePrint('not-printed')}
          tone="slate"
        />
        <PrintStageBtn
          label={t('statusFilter.category.productionError')}
          count={cell.errorCount}
          active={isError}
          onClick={toggleError}
          tone="rose"
        />
        <PrintStageBtn
          label={t('factoryTab.printed')}
          count={cell.printedCount}
          active={activeStage === 'printed'}
          onClick={() => togglePrint('printed')}
          tone="emerald"
        />
      </div>
      {/* Design theo designerStatus — 2 cặp (được gán/chưa gán · đã xong/chưa xong),
          mỗi cặp cộng lại = tổng đơn đang SX tại xưởng. */}
      <div className="mb-2 pb-2 border-b border-border">
        <p className="text-[10px] text-muted-foreground mb-1">{t('factoryTab.design')}</p>
        <div className="grid grid-cols-4 gap-1 text-[10px]">
          <div className="text-center">
            <p className="font-bold tabular-nums text-sm text-indigo-700 dark:text-indigo-400">
              {cell.designAssignedCount}
            </p>
            <p className="text-muted-foreground">{t('factoryTab.assigned')}</p>
          </div>
          <div className="text-center">
            <p className="font-bold tabular-nums text-sm text-zinc-600 dark:text-zinc-300">
              {cell.designUnassignedCount}
            </p>
            <p className="text-muted-foreground">{t('factoryTab.unassignedShort')}</p>
          </div>
          <div className="text-center">
            <p className="font-bold tabular-nums text-sm text-emerald-700 dark:text-emerald-400">
              {cell.designDoneCount}
            </p>
            <p className="text-muted-foreground">{t('factoryTab.doneShort')}</p>
          </div>
          <div className="text-center">
            <p className="font-bold tabular-nums text-sm text-amber-700 dark:text-amber-400">
              {cell.designNotDoneCount}
            </p>
            <p className="text-muted-foreground">{t('factoryTab.notDoneShort')}</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <button
          type="button"
          onClick={() => onFilter(isIn ? { kind: 'all' } : { kind: 'in', factoryId: cell.factoryId })}
          className={cn(
            'rounded-md border px-2 py-1.5 text-left transition-colors',
            isIn ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-500/10' : 'border-border hover:bg-muted/30',
          )}
        >
          <p className="text-[10px] text-muted-foreground">{t('factoryTab.receivedFromOther')}</p>
          <p className="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-400">{cell.transferredIn}</p>
        </button>
        <button
          type="button"
          onClick={() => onFilter(isOut ? { kind: 'all' } : { kind: 'out', factoryId: cell.factoryId })}
          className={cn(
            'rounded-md border px-2 py-1.5 text-left transition-colors',
            isOut ? 'border-slate-400 bg-slate-50/60 dark:bg-slate-500/10' : 'border-border hover:bg-muted/30',
          )}
        >
          <p className="text-[10px] text-muted-foreground">{t('factoryTab.transferredOut')}</p>
          <p className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-300">{cell.transferredOut}</p>
        </button>
      </div>
    </div>
  );
}

/** Aggregate card for "Tổng" view — same layout as FactoryCard but rolled up
 *  across ALL factories. Clicking a print stage filters orders cross-factory
 *  (kind: `print-all` / `error-all`). */
function TotalCard({
  agg,
  filterMode,
  onFilter,
}: {
  agg: {
    total: number;
    pure: number;
    transferred: number;
    productCount: number;
    fabricCount: number;
    machineCount: number;
    actualMachineCount: number;
    withToolCount: number;
    printedCount: number;
    printingCount: number;
    notPrintedCount: number;
    errorCount: number;
    designAssignedCount: number;
    designUnassignedCount: number;
    designDoneCount: number;
    designNotDoneCount: number;
  };
  filterMode: FilterMode;
  onFilter: (m: FilterMode) => void;
}) {
  const { t } = useTranslation('dashboard');
  const isAll = filterMode.kind === 'all';
  const isErrorAll = filterMode.kind === 'error-all';
  const activeStage = filterMode.kind === 'print-all' ? filterMode.stage : null;
  const togglePrint = (stage: PrintStage) =>
    onFilter(activeStage === stage ? { kind: 'all' } : { kind: 'print-all', stage });
  const toggleError = () => onFilter(isErrorAll ? { kind: 'all' } : { kind: 'error-all' });

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-colors',
        isAll || activeStage || isErrorAll ? 'border-primary ring-2 ring-primary/20' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center">
          <Layers size={18} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground truncate">{t('factoryTab.totalAllFactories')}</p>
          <p className="text-[10px] text-muted-foreground tabular-nums">{t('factoryTab.totalAllFactoriesHint')}</p>
        </div>
      </div>

      <button type="button" onClick={() => onFilter({ kind: 'all' })} className="w-full text-left mb-3 group">
        <p className="text-3xl font-bold tabular-nums group-hover:text-primary transition-colors">{agg.total}</p>
        <p className="text-[11px] text-muted-foreground">{t('factoryTab.ordersInRange')}</p>
      </button>

      {/* Aggregate distinct counts */}
      <div className="grid grid-cols-5 gap-1 text-[10px] mb-3 pb-3 border-b border-border">
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-foreground">{agg.productCount}</p>
          <p className="text-muted-foreground">{t('export.breakdown.categories.product')}</p>
        </div>
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-foreground">{agg.fabricCount}</p>
          <p className="text-muted-foreground">{t('export.breakdown.categories.fabric')}</p>
        </div>
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-foreground">{agg.machineCount}</p>
          <p className="text-muted-foreground">{t('export.headers.machineType')}</p>
        </div>
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-foreground">{agg.actualMachineCount}</p>
          <p className="text-muted-foreground">{t('factoryTab.machineType')}</p>
        </div>
        <div className="text-center">
          <p className="font-bold tabular-nums text-sm text-emerald-700 dark:text-emerald-400">{agg.withToolCount}</p>
          <p className="text-muted-foreground">{t('factoryTab.hasTool')}</p>
        </div>
      </div>

      {/* Print pipeline (gộp) */}
      <div className="grid grid-cols-3 gap-1.5 text-xs mb-3">
        <PrintStageBtn
          label={t('factoryTab.notPrinted')}
          count={agg.notPrintedCount}
          active={activeStage === 'not-printed'}
          onClick={() => togglePrint('not-printed')}
          tone="slate"
        />
        <PrintStageBtn
          label={t('statusFilter.category.productionError')}
          count={agg.errorCount}
          active={isErrorAll}
          onClick={toggleError}
          tone="rose"
        />
        <PrintStageBtn
          label={t('factoryTab.printed')}
          count={agg.printedCount}
          active={activeStage === 'printed'}
          onClick={() => togglePrint('printed')}
          tone="emerald"
        />
      </div>

      {/* Design (gộp) theo designerStatus */}
      <div className="mb-3 pb-3 border-b border-border">
        <p className="text-[10px] text-muted-foreground mb-1">{t('factoryTab.design')}</p>
        <div className="grid grid-cols-4 gap-1 text-[10px]">
          <div className="text-center">
            <p className="font-bold tabular-nums text-sm text-indigo-700 dark:text-indigo-400">
              {agg.designAssignedCount}
            </p>
            <p className="text-muted-foreground">{t('factoryTab.assigned')}</p>
          </div>
          <div className="text-center">
            <p className="font-bold tabular-nums text-sm text-zinc-600 dark:text-zinc-300">
              {agg.designUnassignedCount}
            </p>
            <p className="text-muted-foreground">{t('factoryTab.unassignedShort')}</p>
          </div>
          <div className="text-center">
            <p className="font-bold tabular-nums text-sm text-emerald-700 dark:text-emerald-400">
              {agg.designDoneCount}
            </p>
            <p className="text-muted-foreground">{t('factoryTab.doneShort')}</p>
          </div>
          <div className="text-center">
            <p className="font-bold tabular-nums text-sm text-amber-700 dark:text-amber-400">
              {agg.designNotDoneCount}
            </p>
            <p className="text-muted-foreground">{t('factoryTab.notDoneShort')}</p>
          </div>
        </div>
      </div>

      {/* Bonus row: pure / transferred — read-only mini stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-border px-2 py-1.5">
          <p className="text-[10px] text-muted-foreground">{t('factoryTab.pureOrders')}</p>
          <p className="text-sm font-bold tabular-nums text-foreground">{agg.pure}</p>
        </div>
        <div className="rounded-md border border-border px-2 py-1.5">
          <p className="text-[10px] text-muted-foreground">{t('factoryTab.transferred')}</p>
          <p className="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-400">{agg.transferred}</p>
        </div>
      </div>
    </div>
  );
}

function PrintStageBtn({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: 'slate' | 'sky' | 'emerald' | 'rose';
}) {
  const toneClasses = {
    slate: {
      active: 'border-slate-400 bg-slate-50/60 dark:bg-slate-500/10',
      count: 'text-slate-700 dark:text-slate-300',
    },
    sky: { active: 'border-sky-400 bg-sky-50/60 dark:bg-sky-500/10', count: 'text-sky-700 dark:text-sky-300' },
    emerald: {
      active: 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-500/10',
      count: 'text-emerald-700 dark:text-emerald-400',
    },
    rose: { active: 'border-rose-400 bg-rose-50/60 dark:bg-rose-500/10', count: 'text-rose-700 dark:text-rose-400' },
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1.5 text-left transition-colors',
        active ? toneClasses.active : 'border-border hover:bg-muted/30',
      )}
    >
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-bold tabular-nums', toneClasses.count)}>{count}</p>
    </button>
  );
}

function FilterChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary font-medium'
          : 'border-border bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function TransferDialog({
  open,
  onOpenChange,
  ids,
  factories,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ids: string[];
  factories: FactoryOption[];
  onSuccess: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTarget('');
      setReason('');
    }
  }, [open]);

  const submit = async () => {
    if (!target) {
      toast.error(t('factoryTab.selectTargetFactory'));
      return;
    }
    try {
      setSaving(true);
      const res = await RepositoryRemote.order.bulkTransferOrders({
        ids,
        targetFactoryId: target,
        reason: reason.trim() || undefined,
      });
      toast.success(t('factoryTab.transferredSuccess', { modified: res.data.data.modified, matched: res.data.data.matched }));
      onSuccess();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('factoryTab.transferDialogTitle', { count: ids.length })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('factoryTab.targetFactory')}</Label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">{t('factoryTab.selectPlaceholder')}</option>
              {factories.map((f) => (
                <option key={f.factoryId} value={f.factoryId}>
                  {f.factoryShortName ? `${f.factoryShortName} · ${f.factoryName}` : f.factoryName}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">{t('factoryTab.originalFactoryNote')}</p>
          </div>
          <div>
            <Label className="text-xs">{t('factoryTab.reasonOptional')}</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('factoryTab.reasonPlaceholder')}
              className="mt-1 text-sm"
              maxLength={200}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('telegramReport.cancel')}
          </Button>
          <Button onClick={submit} disabled={saving || !target}>
            {saving ? <Spinner size={13} /> : <Send size={13} />} {t('factoryTab.confirmTransfer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
