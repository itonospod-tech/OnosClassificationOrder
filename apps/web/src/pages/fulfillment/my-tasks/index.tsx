import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import type { TFunction } from 'i18next';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  History,
  ListChecks,
  Loader2,
  MousePointerClick,
  PlayCircle,
  RefreshCw,
  RotateCw,
  ScanLine,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type { FulfillmentTransitionDto, ProductionOrderRow } from 'shared';
import { FulfillmentStage, FulfillmentTransitionAction } from 'shared';
import { toast } from 'sonner';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';

import { RepositoryRemote } from '@/services';

import { DateRangePicker } from '@/components/common/DateRangePicker';
import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { PipelineDailyOverview } from '@/components/common/PipelineDailyOverview';
import { SelectFilter } from '@/components/common/SelectFilter';
import { Spinner } from '@/components/common/Spinner';
import { AssignDesignerDialog } from '@/components/orders/AssignDesignerDialog';
import { OrderDetailDialog } from '@/components/orders/OrderDetailDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { getStageLabel } from '@/utils/fulfillmentStageLabel';

import { useDebounce } from '@/hooks/useDebounce';
import { useSidebarResetSignal } from '@/hooks/useSidebarResetSignal';

import { FulfillmentScanActionDialog } from '../../orders/scan-error/FulfillmentScanActionDialog';
import { OrderErrorScanDialog } from '../../orders/scan-error/OrderErrorScanDialog';
import { FulfillmentTaskCard } from './FulfillmentTaskCard';
import { PackWeightDialog } from './PackWeightDialog';
import PrintWorkshopView from './PrintWorkshopView';
import { ReworkBackDialog } from './ReworkBackDialog';
import { StageErrorPanel } from './StageErrorPanel';

type ScannedOrder = ProductionOrderRow & {
  factory?: { name?: string; shortName?: string };
  machineType?: { name?: string; shortName?: string };
};

/** ISO → ngày VN (YYYY-MM-DD) để lọc client-side theo cột ngày. */
function vnDay(iso?: string): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const BARCODE_PREFIX = 'N-';
const SEARCH_HISTORY_KEY = 'fulfillment-search-history';

/** Số card tối đa render 1 lần trong 1 cột kanban (xem `Column`). */
const COLUMN_RENDER_LIMIT = 100;
const MAX_SEARCH_HISTORY = 20;

type SearchHistoryEntry = {
  id: string;
  code: string;
  at: string;
  status: 'found' | 'not-found';
};

/**
 * Ô Search vừa dùng gõ tay vừa nhận máy quét USB (xuất "N-PROD1234<Enter>").
 * DB lưu `productionId` không có tiền tố → tự bóc "N-"/"n-" ở đầu trước khi
 * so khớp. So sánh case-insensitive vì máy quét có thể xuất chữ thường.
 */
function stripBarcodePrefix(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.slice(0, BARCODE_PREFIX.length).toUpperCase() === BARCODE_PREFIX) {
    return trimmed.slice(BARCODE_PREFIX.length).trim();
  }
  return trimmed;
}

/**
 * Kanban 4 cột cho user Fulfillment — đồng bộ visual + UX với
 * `pages/designer/my-tasks` (header / KPI / hint / filter / kanban / sticky bulk).
 *
 * Khác Designer:
 *   - Cột "watching" thay vì "done" — read-only, không drag, không bulk.
 *   - DnD chỉ enable: waiting/rework → in-progress = action `start`.
 *   - Bulk actions:
 *     - Cùng cột waiting/rework → "Bắt đầu" (loop transition start).
 *     - Cùng cột in-progress → "Hoàn thành" (loop transition complete).
 *     - Rework-back KHÔNG bulk (cần dialog input lý do per đơn).
 *   - Filter facets derive client-side từ data đã load (không gọi BE
 *     `myTaskFilters` riêng vì queue per stage < 200 đơn).
 */
// Worker fulfillment: 5 columns (waiting / in-progress / rework / done /
// watching). Admin/Manager: thêm column `unassigned` (đơn chưa được gán
// Designer — admin gán qua AssignDesignerDialog).
type ColKey = 'waiting' | 'in-progress' | 'rework' | 'done' | 'fixed' | 'watching' | 'unassigned';

type Columns = Record<ColKey, ProductionOrderRow[]>;

const EMPTY_COLS: Columns = {
  waiting: [],
  'in-progress': [],
  rework: [],
  done: [],
  fixed: [],
  watching: [],
  unassigned: [],
};

const WORKER_COL_ORDER: ColKey[] = ['waiting', 'in-progress', 'rework', 'done', 'fixed', 'watching'];
const ADMIN_COL_ORDER: ColKey[] = ['unassigned', ...WORKER_COL_ORDER];

// Tailwind cần class tĩnh → tra theo số cột đang hiện (rework/watching trống bị ẩn).
const KANBAN_GRID_BY_COUNT: Record<number, string> = {
  4: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
  5: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-5',
  6: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-6',
  7: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-7',
};

type BulkAction = 'start' | 'complete' | 'start-complete';

type ColMeta = Record<
  ColKey,
  {
    label: string;
    icon: React.ElementType;
    accent: string;
    kpiAccent: string;
    bulk: BulkAction[];
  }
>;

function buildColMeta(t: TFunction): ColMeta {
  return {
    waiting: {
      label: t('stageStatus.waiting'),
      icon: Clock,
      accent: 'border-zinc-300 dark:border-zinc-700',
      kpiAccent: 'text-zinc-700 dark:text-zinc-200',
      bulk: ['start'],
    },
    'in-progress': {
      label: t('stageStatus.inProgress'),
      icon: PlayCircle,
      accent: 'border-indigo-300 dark:border-indigo-700',
      kpiAccent: 'text-indigo-600',
      bulk: ['complete'],
    },
    rework: {
      label: t('stageStatus.rework'),
      icon: RotateCw,
      accent: 'border-amber-300 dark:border-amber-700',
      kpiAccent: 'text-amber-600',
      bulk: ['start'],
    },
    done: {
      label: t('stageStatus.done'),
      icon: CheckCircle2,
      accent: 'border-emerald-300 dark:border-emerald-700',
      kpiAccent: 'text-emerald-600',
      bulk: [],
    },
    fixed: {
      label: t('stageStatus.fixed'),
      icon: CheckCircle2,
      accent: 'border-teal-300 dark:border-teal-700',
      kpiAccent: 'text-teal-600',
      bulk: [],
    },
    watching: {
      label: t('stageStatus.watching'),
      icon: RotateCw,
      accent: 'border-sky-300 dark:border-sky-700',
      kpiAccent: 'text-sky-600',
      bulk: [],
    },
    unassigned: {
      label: t('stageStatus.unassigned'),
      icon: ListChecks,
      accent: 'border-rose-300 dark:border-rose-700',
      kpiAccent: 'text-rose-600',
      bulk: [],
    },
  };
}

type Filters = {
  type: string;
  fabricType: string;
  machineNumber: string;
  toolResult: string;
  userSku: string;
};

const EMPTY_FILTERS: Filters = {
  type: '',
  fabricType: '',
  machineNumber: '',
  toolResult: '',
  userSku: '',
};

/**
 * Size ordering chuẩn theo nội bộ. Lowercase compare để chấp nhận biến thể
 * (xxl ↔ 2XL, xxxl ↔ 3XL). Unknown → 99 (đẩy về cuối, vẫn ổn định).
 */
const SIZE_RANK: Record<string, number> = {
  xs: 0,
  s: 1,
  m: 2,
  l: 3,
  xl: 4,
  '2xl': 5,
  xxl: 5,
  '3xl': 6,
  xxxl: 6,
  '4xl': 7,
  xxxxl: 7,
  '5xl': 8,
  xxxxxl: 8,
  '6xl': 9,
  '7xl': 10,
  '8xl': 11,
};
function sizeRank(raw?: string): number {
  if (!raw) return 99;
  return SIZE_RANK[raw.trim().toLowerCase()] ?? 99;
}

/**
 * Dispatcher theo stage: user "In" (print) dùng bảng admin-like
 * (`PrintWorkshopView`); các stage khác dùng kanban (`FulfillmentKanbanView`).
 * Chỉ gọi `useAuthStore` rồi rẽ nhánh → không vi phạm Rules of Hooks.
 */
export default function FulfillmentMyTasksPage() {
  const myStage = useAuthStore((s) => s.profile)?.fulfillmentStage as FulfillmentStage | undefined;
  if (myStage === FulfillmentStage.Print) return <PrintWorkshopView />;
  return <FulfillmentKanbanView />;
}

function FulfillmentKanbanView() {
  const { t } = useTranslation(['fulfillmentWorkflow', 'common']);
  const colMeta = useMemo(() => buildColMeta(t), [t]);
  const profile = useAuthStore((s) => s.profile);
  const myStage = profile?.fulfillmentStage as FulfillmentStage | undefined;
  // Admin/Manager/SupportManager (= override roles ở BE) → thấy thêm column
  // "Chưa gán Designer" + được phép gọi tab=unassigned.
  const roleName = profile?.role?.name as string | undefined;
  const isOverrideRole = ['SuperAdmin', 'Admin', 'Manager', 'SupportManager'].includes(roleName ?? '');
  const colOrder = isOverrideRole ? ADMIN_COL_ORDER : WORKER_COL_ORDER;

  const [columns, setColumns] = useState<Columns>(EMPTY_COLS);
  // Đơn user đã rework-back, đang chờ quay lại — render ở drawer dưới kanban
  // (giống pattern Designer's "File không làm được").
  const [watching, setWatching] = useState<ProductionOrderRow[]>([]);
  const [showWatching, setShowWatching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reworkOrder, setReworkOrder] = useState<ProductionOrderRow | null>(null);
  const [activeOrder, setActiveOrder] = useState<ProductionOrderRow | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string; original?: string } | null>(null);

  // ─── Filter state ──────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // ─── Scan → detail/action dialog (clone luồng trang "Quét mã") ──
  // Enter/quét mã trong ô search → tra cứu chính xác theo productionId → mở
  // FulfillmentScanActionDialog (Hoàn thành / Báo lỗi). "Báo lỗi" → errorMode
  // chuyển sang OrderErrorScanDialog.
  const [scannedOrder, setScannedOrder] = useState<ScannedOrder | null>(null);
  const [scanErrorMode, setScanErrorMode] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  // Lịch sử tra cứu (mã đã Enter/quét) — persist localStorage, xem qua modal.
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
      return raw ? (JSON.parse(raw) as SearchHistoryEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory));
  }, [searchHistory]);
  const pushSearchHistory = useCallback((code: string, status: 'found' | 'not-found') => {
    setSearchHistory((prev) => {
      const entry: SearchHistoryEntry = {
        id: `${Date.now()}-${code}`,
        code,
        status,
        at: new Date().toISOString(),
      };
      return [entry, ...prev].slice(0, MAX_SEARCH_HISTORY);
    });
  }, []);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Date range gửi xuống BE — match scope `OrderFactoryTab` (7 ngày). undefined
  // = chưa pick → BE default 7 ngày. Empty string sau khi user clear =
  // all-time. Render: nếu undefined → init 7d window để DateRangePicker show.
  const init7d = useMemo(() => {
    const d = new Date();
    const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const from = new Date(d);
    from.setDate(from.getDate() - 6);
    const fromStr = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    return { from: fromStr, to };
  }, []);
  const [dateFrom, setDateFrom] = useState<string>(init7d.from);
  const [dateTo, setDateTo] = useState<string>(init7d.to);
  // Ngày đang lọc (YYYY-MM-DD VN) từ bảng "Tổng quan theo ngày" — chỉ lọc
  // client-side các cột kanban, KHÔNG refetch. Reset khi đổi khoảng ngày.
  const [dayFilter, setDayFilter] = useState('');
  useEffect(() => {
    setDayFilter('');
  }, [dateFrom, dateTo]);
  const toggleDay = (day: string) => setDayFilter((cur) => (cur === day ? '' : day));
  // Bump sau mỗi lần load kanban (gồm sau transition) → bảng tổng quan refetch.
  const [overviewToken, setOverviewToken] = useState(0);
  // "Đã copy search" — giữ trạng thái cho đến khi user đổi value hoặc F5.
  // Reset khi search thay đổi (gồm cả case clear) — đồng bộ ý nghĩa "icon
  // tick = giá trị này đã được copy".
  const [searchCopied, setSearchCopied] = useState(false);
  useEffect(() => {
    setSearchCopied(false);
  }, [search]);

  // productionId card đã copy gần nhất — chỉ 1 card được tick tại 1 thời điểm
  // (copy card khác sẽ reset card cũ). Persist cho đến khi F5.
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);

  // Order chi tiết — mở qua click productionId trên card. Reuse component
  // OrderDetailDialog (đã wire link mockup/design dạng URL + cuttingFile preview).
  const [detailOrder, setDetailOrder] = useState<{ id: string; productionId: string } | null>(null);
  // Assign-designer dialog cho cột `unassigned` (admin-only). Reuse component
  // bulk-assign existing — single-id list. Reload sau khi gán xong.
  const [assignDesignerOrderId, setAssignDesignerOrderId] = useState<string | null>(null);
  const handleCopyProductionId = async (order: ProductionOrderRow) => {
    try {
      await navigator.clipboard.writeText(order.productionId);
      setCopiedOrderId(order._id);
    } catch {
      toast.error(t('toast.copyError'));
    }
  };

  // ─── Selection state ───────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<{ colKey: ColKey; id: string } | null>(null);

  // Click lại menu "Task Fulfillment" ở sidebar khi đang đứng đúng trang này
  // → xóa hết filter (xem `useSidebarResetSignal`). `dayFilter` tự clear qua
  // effect riêng khi `dateFrom`/`dateTo` đổi, không cần set tay ở đây.
  useSidebarResetSignal(PATHS.FULFILLMENT_MY_TASKS, () => {
    setSearch('');
    setFilters(EMPTY_FILTERS);
    setDateFrom(init7d.from);
    setDateTo(init7d.to);
    setSelected(new Set());
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    // Admin không có fulfillmentStage → vẫn cho phép vào page để xem unassigned.
    // Worker không có stage → return (BE sẽ throw 400).
    if (!myStage && !isOverrideRole) return;
    setLoading(true);
    try {
      // Truyền date range cho BE — match scope `OrderFactoryTab`. Empty string
      // = user clear → BE coi là explicit "all-time".
      const dateParams = { createdFrom: dateFrom, createdTo: dateTo };
      // Worker: 5 tabs. Admin: thêm unassigned (gọi song song).
      const adminUnassignedPromise = isOverrideRole
        ? RepositoryRemote.fulfillment.myTasks({ tab: 'unassigned', size: 5000, ...dateParams })
        : Promise.resolve({ data: { data: [] } });
      const [w, ip, rw, dn, fx, wt, un] = await Promise.all([
        RepositoryRemote.fulfillment.myTasks({ tab: 'waiting', size: 5000, ...dateParams }),
        RepositoryRemote.fulfillment.myTasks({ tab: 'in-progress', size: 5000, ...dateParams }),
        RepositoryRemote.fulfillment.myTasks({ tab: 'rework', size: 5000, ...dateParams }),
        RepositoryRemote.fulfillment.myTasks({ tab: 'done', size: 5000, ...dateParams }),
        RepositoryRemote.fulfillment.myTasks({ tab: 'fixed', size: 5000, ...dateParams }),
        RepositoryRemote.fulfillment.myTasks({ tab: 'watching', size: 5000, ...dateParams }),
        adminUnassignedPromise,
      ]);
      setColumns({
        waiting: w.data.data ?? [],
        'in-progress': ip.data.data ?? [],
        rework: rw.data.data ?? [],
        done: dn.data.data ?? [],
        fixed: fx.data.data ?? [],
        watching: wt.data.data ?? [],
        unassigned: un.data.data ?? [],
      });
      // Backward compat — `watching` state cũ vẫn để cho `filteredWatching`
      // hoạt động nếu chỗ nào còn ref (drawer block bị comment ra rồi).
      setWatching(wt.data.data ?? []);
      setSelected(new Set());
      lastClickedRef.current = null;
      setOverviewToken((t) => t + 1);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  }, [myStage, isOverrideRole, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tra cứu chính xác 1 đơn theo productionId (đã bóc tiền tố "N-") → mở dialog
  // thao tác. Reuse RepositoryRemote.order.getByProductionId như trang Quét mã.
  const handleScanLookup = useCallback(
    async (raw: string) => {
      const code = stripBarcodePrefix(raw);
      if (!code || lookupLoading) return;
      setLookupLoading(true);
      try {
        const res = await RepositoryRemote.order.getByProductionId(code);
        const data = res.data?.data as ScannedOrder | undefined;
        if (!data?._id) {
          toast.error(t('toast.notFound'));
          pushSearchHistory(code, 'not-found');
          return;
        }
        setScanErrorMode(false);
        setScannedOrder(data);
        pushSearchHistory(code, 'found');
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status === 404) {
          toast.error(t('toast.notFound'));
          pushSearchHistory(code, 'not-found');
        } else {
          handleAxiosError(err);
        }
      } finally {
        setLookupLoading(false);
      }
    },
    [lookupLoading, pushSearchHistory, t],
  );

  const closeScanDialog = useCallback(() => {
    setScannedOrder(null);
    setScanErrorMode(false);
    // Xong 1 đơn → clear ô search + re-focus để quét đơn kế tiếp.
    setSearch('');
    setTimeout(() => searchInputRef.current?.focus(), 80);
  }, []);

  // ─── Filter application (client-side) ──────────────────────────
  const filteredColumns = useMemo<Columns>(() => {
    // Date filter giờ chạy BE (xem `load()`) — không filter date ở FE nữa.
    const q = stripBarcodePrefix(debouncedSearch).toLowerCase();
    const apply = (arr: ProductionOrderRow[]) =>
      arr.filter((o) => {
        if (dayFilter && vnDay(o.inProductionAt as string | undefined) !== dayFilter) return false;
        if (q) {
          const hit = o.productionId?.toLowerCase().includes(q) || o.orderId?.toLowerCase().includes(q);
          if (!hit) return false;
        }
        if (filters.type && o.type !== filters.type) return false;
        if (filters.fabricType && o.fabricType !== filters.fabricType) return false;
        if (filters.machineNumber && o.machineNumber !== filters.machineNumber) return false;
        if (filters.toolResult && o.toolResult !== filters.toolResult) return false;
        if (filters.userSku && o.userSku !== filters.userSku) return false;
        return true;
      });
    return {
      waiting: apply(columns.waiting),
      'in-progress': apply(columns['in-progress']),
      rework: apply(columns.rework),
      done: apply(columns.done),
      fixed: apply(columns.fixed),
      watching: apply(columns.watching),
      unassigned: apply(columns.unassigned),
    };
  }, [columns, debouncedSearch, filters, dayFilter]);

  const filteredWatching = useMemo(() => {
    const q = stripBarcodePrefix(debouncedSearch).toLowerCase();
    return watching.filter((o) => {
      if (q) {
        const hit = o.productionId?.toLowerCase().includes(q) || o.orderId?.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (filters.type && o.type !== filters.type) return false;
      if (filters.fabricType && o.fabricType !== filters.fabricType) return false;
      if (filters.machineNumber && o.machineNumber !== filters.machineNumber) return false;
      if (filters.toolResult && o.toolResult !== filters.toolResult) return false;
      if (filters.userSku && o.userSku !== filters.userSku) return false;
      return true;
    });
  }, [watching, debouncedSearch, filters]);

  // ─── Facet options (count theo data đã filter trừ facet hiện tại) ──
  // Giống pattern faceted search ở Designer — count phản ánh kết quả khi áp
  // các filter khác (exclude own facet). Tính client-side vì queue nhỏ.
  const filterOptions = useMemo(() => {
    const all: ProductionOrderRow[] = [
      ...columns.waiting,
      ...columns['in-progress'],
      ...columns.rework,
      ...columns.done,
      ...columns.watching,
      ...columns.unassigned,
    ];
    const facetFor = (
      key: keyof Filters,
      getter: (o: ProductionOrderRow) => string | undefined,
    ): { value: string; label: string; count: number }[] => {
      const filtered = all.filter((o) => {
        if (key !== 'type' && filters.type && o.type !== filters.type) return false;
        if (key !== 'fabricType' && filters.fabricType && o.fabricType !== filters.fabricType) return false;
        if (key !== 'machineNumber' && filters.machineNumber && o.machineNumber !== filters.machineNumber) return false;
        if (key !== 'toolResult' && filters.toolResult && o.toolResult !== filters.toolResult) return false;
        if (key !== 'userSku' && filters.userSku && o.userSku !== filters.userSku) return false;
        return true;
      });
      const counts = new Map<string, number>();
      for (const o of filtered) {
        const v = getter(o);
        if (!v) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value, label: value, count }))
        .sort((a, b) => b.count - a.count);
    };
    return {
      type: facetFor('type', (o) => o.type),
      fabricType: facetFor('fabricType', (o) => o.fabricType),
      machineNumber: facetFor('machineNumber', (o) => o.machineNumber),
      toolResult: facetFor('toolResult', (o) => o.toolResult),
      userSku: facetFor('userSku', (o) => o.userSku),
    };
  }, [columns, filters]);

  // ─── Transition + bulk ────────────────────────────────────────
  // Công đoạn Đóng hàng: hỏi cân kiện TRƯỚC khi chốt hoàn thành (GAP-26).
  // Giữ nguyên đơn đang chờ ở đây thay vì cờ boolean — dialog cần mã sản xuất
  // để công nhân biết mình đang cân kiện nào.
  const [canKien, setCanKien] = useState<ProductionOrderRow | null>(null);

  const callTransition = async (
    order: ProductionOrderRow,
    action: FulfillmentTransitionAction,
    body?: Pick<FulfillmentTransitionDto, 'target' | 'reason' | 'weightGram' | 'dimensions'>,
  ) => {
    if (!myStage) return;
    try {
      await RepositoryRemote.fulfillment.transition(order._id, {
        stage: myStage,
        action,
        ...body,
      } as FulfillmentTransitionDto);
      toast.success(actionToastLabel(t, action));
      void load();
    } catch (err) {
      handleAxiosError(err);
      void load();
    }
  };

  /** Bulk: 1 request duy nhất `POST /fulfillment/bulk-transition` — BE loop
   *  transition từng đơn (giữ đủ hook). Trước đây FE bắn N request song song,
   *  400 đơn = 400-800 call → chạm rate limiter. */
  const callBulk = async (action: BulkAction) => {
    if (!myStage || selected.size === 0) return;
    const ids = Array.from(selected);
    try {
      const res = await RepositoryRemote.fulfillment.bulkTransition({
        stage: myStage,
        action,
        orderIds: ids,
      });
      const { ok, fail } = (res.data.data ?? { ok: 0, fail: 0 }) as { ok: number; fail: number };
      const verb = actionLabelInfinitive(t, action);
      if (fail === 0) toast.success(t('toast.bulkDone', { verb, count: ok }));
      else toast.warning(t('toast.bulkPartial', { verb, ok, total: ok + fail, fail }));
      void load();
    } catch (err) {
      handleAxiosError(err);
      void load();
    }
  };

  // ─── DnD ──────────────────────────────────────────────────────
  const handleDragStart = (e: DragStartEvent) => {
    const id = e.active.id as string;
    const card = filteredColumns.waiting.find((o) => o._id === id) || filteredColumns.rework.find((o) => o._id === id);
    if (card) setActiveOrder(card);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveOrder(null);
    const orderId = e.active.id as string;
    const fromCol = (e.active.data.current as { col?: ColKey } | undefined)?.col;
    const toCol = e.over?.id as ColKey | undefined;
    if (!fromCol || !toCol || fromCol === toCol) return;

    if (toCol !== 'in-progress' || (fromCol !== 'waiting' && fromCol !== 'rework')) {
      toast.warning(
        t('kanban.dragWarning', {
          waiting: t('stageStatus.waiting'),
          rework: t('stageStatus.rework'),
          inProgress: t('stageStatus.inProgress'),
          complete: t('actions.complete'),
          reportError: t('actions.reportError'),
        }),
      );
      return;
    }

    const order = columns[fromCol].find((o) => o._id === orderId) || ({ _id: orderId } as ProductionOrderRow);
    setColumns((prev) => ({
      ...prev,
      [fromCol]: prev[fromCol].filter((o) => o._id !== orderId),
      'in-progress': [order, ...prev['in-progress']],
    }));
    void callTransition(order, FulfillmentTransitionAction.Start);
  };

  // ─── Selection helpers ────────────────────────────────────────
  const orderedIdsPerColumn = useMemo(() => {
    const out: Record<ColKey, string[]> = {
      waiting: [],
      'in-progress': [],
      rework: [],
      done: [],
      fixed: [],
      watching: [],
      unassigned: [],
    };
    const noTypeLabel = t('kanban.column.noType');
    for (const k of colOrder) {
      const groups = groupByType(filteredColumns[k], noTypeLabel);
      for (const [, rows] of groups) for (const r of rows) out[k].push(r._id);
    }
    return out;
  }, [filteredColumns, colOrder, t]);

  const toggleId = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleCardCheckbox = (colKey: ColKey, id: string, checked: boolean, withShift: boolean) => {
    if (
      withShift &&
      lastClickedRef.current &&
      lastClickedRef.current.colKey === colKey &&
      lastClickedRef.current.id !== id
    ) {
      const arr = orderedIdsPerColumn[colKey];
      const a = arr.indexOf(lastClickedRef.current.id);
      const b = arr.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) {
            if (checked) next.add(arr[i]);
            else next.delete(arr[i]);
          }
          return next;
        });
        lastClickedRef.current = { colKey, id };
        return;
      }
    }
    toggleId(id, checked);
    lastClickedRef.current = { colKey, id };
  };

  const toggleGroup = (rows: ProductionOrderRow[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (checked) next.add(r._id);
        else next.delete(r._id);
      }
      return next;
    });
  };

  // Cột "Cần làm lại" / "Đang chờ quay lại" KHÔNG có task nào → ẩn hẳn cho
  // gọn màn hình. Xét trên dữ liệu THÔ (chưa qua filter client) — cột trống
  // do filter thì vẫn hiện, tránh cột nhấp nháy khi gõ filter.
  const visibleCols = useMemo(
    () => colOrder.filter((k) => (k === 'rework' || k === 'watching' ? columns[k].length > 0 : true)),
    [colOrder, columns],
  );

  // Tính cột nào có ít nhất 1 đơn đã chọn → quyết định bulk action nào hợp lệ.
  const selectedColumns = useMemo(() => {
    const cols = new Set<ColKey>();
    for (const k of colOrder) {
      for (const r of columns[k]) {
        if (selected.has(r._id)) {
          cols.add(k);
          break;
        }
      }
    }
    return cols;
  }, [selected, columns, colOrder]);

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (selectedColumns.size !== 1) return [];
    const [only] = [...selectedColumns];
    const actions: BulkAction[] = [...colMeta[only].bulk];
    // Riêng Đóng hàng: cột chờ/làm lại cho "Hoàn thành" thẳng — tự start rồi
    // complete từng đơn, cùng hành vi 1 lần quét ở FulfillmentScanActionDialog.
    if (myStage === FulfillmentStage.Pack && (only === 'waiting' || only === 'rework')) {
      actions.push('start-complete');
    }
    return actions;
  }, [selectedColumns, colMeta, myStage]);

  if (!myStage) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {t('kanban.noStage')} <strong>{t('kanban.noStageStrong')}</strong>
        {t('kanban.noStageSuffix')}
      </div>
    );
  }

  const counts: Record<ColKey, number> = {
    waiting: filteredColumns.waiting.length,
    'in-progress': filteredColumns['in-progress'].length,
    rework: filteredColumns.rework.length,
    done: filteredColumns.done.length,
    fixed: filteredColumns.fixed.length,
    watching: filteredColumns.watching.length,
    unassigned: filteredColumns.unassigned.length,
  };

  const onPreview = (url: string, title: string, original?: string) => setPreview({ url, title, original });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
              <ListChecks size={20} className="text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {t('kanban.header.title', { stage: getStageLabel(t, myStage) })}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t('kanban.header.factory', { factory: profile?.factoryId ?? '—' })}
              </p>
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>

        {/* KPI */}
        <div
          className={cn(
            'grid gap-2',
            colOrder.length === 7
              ? 'grid-cols-2 md:grid-cols-4 xl:grid-cols-7'
              : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
          )}
        >
          {colOrder.map((k) => (
            <KPI key={k} label={colMeta[k].label} value={counts[k]} accent={colMeta[k].kpiAccent} />
          ))}
        </div>

        {/* Ô thống kê lỗi công đoạn — click xổ bảng lỗi theo ngày (inProductionAt). */}
        <StageErrorPanel
          stage={myStage}
          from={dateFrom || undefined}
          to={dateTo || undefined}
          reloadToken={overviewToken}
        />

        {/* Hint */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
          <MousePointerClick size={13} className="text-primary shrink-0 mt-0.5" />
          <div>
            <strong className="text-foreground">{t('kanban.hint.tip')}</strong> {t('kanban.hint.body1')}{' '}
            <kbd className="px-1 bg-background border rounded">Shift</kbd> {t('kanban.hint.body2')}
          </div>
        </div>

        {/* Filter bar — search + date trên 1 row, các facet ở row dưới */}
        <div className="rounded-md border border-border bg-card p-2.5 space-y-2">
          {/* Row 1: Search (flex-1) + DateRangePicker */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[220px]">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                {t('kanban.search.label')}
              </label>
              <div className="mt-1 flex items-center gap-1.5">
                <div className="relative flex-1">
                  <button
                    type="button"
                    disabled={!stripBarcodePrefix(search)}
                    title={searchCopied ? t('common:actions.copied') : t('kanban.search.copyTitle')}
                    onClick={async () => {
                      const v = stripBarcodePrefix(search);
                      if (!v) return;
                      try {
                        await navigator.clipboard.writeText(v);
                        setSearchCopied(true);
                      } catch {
                        toast.error(t('toast.copyError'));
                      }
                    }}
                    className={cn(
                      'absolute left-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded transition-colors',
                      stripBarcodePrefix(search)
                        ? searchCopied
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        : 'text-muted-foreground/40 cursor-not-allowed',
                    )}
                  >
                    {searchCopied ? <CheckCircle2 size={13} /> : <Copy size={12} />}
                  </button>
                  {lookupLoading ? (
                    <Loader2
                      size={15}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin"
                    />
                  ) : (
                    <ScanLine
                      size={15}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                    />
                  )}
                  <Input
                    ref={searchInputRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleScanLookup(search);
                      }
                    }}
                    placeholder={t('kanban.search.placeholder')}
                    className="h-11 pl-9 pr-9 text-sm font-mono"
                    disabled={!!scannedOrder}
                  />
                </div>
                {/* Nút mở modal lịch sử tra cứu. */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setHistoryOpen(true)}
                  title={t('kanban.search.historyTitle')}
                  className="relative h-11 w-11 shrink-0 p-0"
                >
                  <History size={17} />
                  {searchHistory.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold inline-flex items-center justify-center">
                      {searchHistory.length}
                    </span>
                  )}
                </Button>
              </div>
              {/* Feedback khi máy quét xuất tiền tố "N-" — cho biết mã thực sẽ tìm. */}
              {stripBarcodePrefix(search) !== search.trim() && !!search.trim() ? (
                <p className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                  {t('kanban.search.strippedPrefix', { prefix: BARCODE_PREFIX })}{' '}
                  <code className="font-mono">{stripBarcodePrefix(search)}</code>
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {t('kanban.search.hintPre')} <strong>{t('actions.complete')}</strong> /{' '}
                  <strong>{t('actions.reportError')}</strong>
                  {t('kanban.search.hintSuffix')}
                </p>
              )}
            </div>
          </div>

          {/* Row ngày — thanh preset inline full-width */}
          <DateRangePicker
            variant="inline"
            from={dateFrom}
            to={dateTo}
            onChange={(f, to) => {
              setDateFrom(f);
              setDateTo(to);
            }}
            placeholder={t('kanban.dateAllPlaceholder')}
          />

          {/* Row 2: 5 facet filters */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
            <SelectFilter
              label={t('kanban.filters.type')}
              value={filters.type}
              onChange={(v) => setFilters({ ...filters, type: v })}
              options={filterOptions.type}
            />
            <SelectFilter
              label={t('kanban.filters.fabricType')}
              value={filters.fabricType}
              onChange={(v) => setFilters({ ...filters, fabricType: v })}
              options={filterOptions.fabricType}
            />
            <SelectFilter
              label={t('kanban.filters.machineNumber')}
              value={filters.machineNumber}
              onChange={(v) => setFilters({ ...filters, machineNumber: v })}
              options={filterOptions.machineNumber}
            />
            <SelectFilter
              label={t('kanban.filters.toolResult')}
              value={filters.toolResult}
              onChange={(v) => setFilters({ ...filters, toolResult: v })}
              options={filterOptions.toolResult}
            />
            <SelectFilter
              label={t('kanban.filters.userSku')}
              value={filters.userSku}
              onChange={(v) => setFilters({ ...filters, userSku: v })}
              options={filterOptions.userSku}
            />
          </div>
        </div>

        {/* Bảng tổng quan theo ngày — click 1 ngày lọc kanban client-side. */}
        <PipelineDailyOverview
          stage={myStage}
          from={dateFrom || undefined}
          to={dateTo || undefined}
          reloadToken={overviewToken}
          dayFilter={dayFilter}
          onPickDay={toggleDay}
        />

        {/* Kanban — 6 cột worker / 7 cột admin; cột rework/watching trống bị ẩn */}
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className={cn('grid gap-3', KANBAN_GRID_BY_COUNT[visibleCols.length] ?? KANBAN_GRID_BY_COUNT[6])}>
            {visibleCols.map((key) => (
              <Column
                key={key}
                colKey={key}
                meta={colMeta[key]}
                cards={filteredColumns[key]}
                myStage={myStage}
                activeDragId={activeOrder?._id}
                selected={selected}
                copiedOrderId={copiedOrderId}
                onCopyProductionId={handleCopyProductionId}
                onClickProductionId={(o) => setDetailOrder({ id: o._id, productionId: o.productionId })}
                onAssignDesigner={(o) => setAssignDesignerOrderId(o._id)}
                onStart={(o) => void callTransition(o, FulfillmentTransitionAction.Start)}
                onComplete={(o) =>
                  myStage === FulfillmentStage.Pack
                    ? setCanKien(o)
                    : void callTransition(o, FulfillmentTransitionAction.Complete)
                }
                onReportError={(o) => setReworkOrder(o)}
                onPreview={onPreview}
                onCheckCard={(id, checked, withShift) => handleCardCheckbox(key, id, checked, withShift)}
                onCheckGroup={toggleGroup}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeOrder ? (
              <div className="rotate-1 shadow-2xl ring-2 ring-primary/40 rounded-md w-[260px] cursor-grabbing">
                <FulfillmentTaskCard order={activeOrder} myStage={myStage} colKey="waiting" />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {loading && (
          <div className="flex items-center justify-center p-4">
            <Spinner size={18} className="text-primary" />
          </div>
        )}

        {/* Watching drawer — đơn user đã đẩy về xử lý (rework-back), đang
            chờ quay lại. Clone pattern Designer's "File không làm được". */}
        {/* <div className="rounded-md border border-border bg-card">
          <button
            type="button"
            onClick={() => setShowWatching((s) => !s)}
            className="w-full flex items-center justify-between p-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              <ChevronRight size={13} /> Đơn đã đẩy về xử lý ({filteredWatching.length})
            </span>
            {showWatching ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showWatching && (
            <div className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {filteredWatching.length === 0 && (
                <p className="text-xs text-muted-foreground col-span-full italic">
                  Chưa đẩy đơn nào về xử lý.
                </p>
              )}
              {filteredWatching.map((o) => (
                <FulfillmentTaskCard
                  key={o._id}
                  order={o}
                  myStage={myStage}
                  colKey="watching"
                  onPreview={onPreview}
                />
              ))}
            </div>
          )}
        </div> */}

        {/* Sticky bulk toolbar */}
        {selected.size > 0 && (
          <div className="sticky bottom-3 z-30 flex justify-center px-4 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card shadow-lg px-4 py-2 flex-wrap">
              <CheckCircle2 size={14} className="text-primary" />
              <span className="text-sm">
                {t('kanban.selection.selected')} <span className="font-semibold">{selected.size}</span>
              </span>
              {selectedColumns.size > 1 ? (
                <span className="text-xs text-muted-foreground italic">{t('kanban.selection.multiColumn')}</span>
              ) : (
                <>
                  {bulkActions.includes('start') && (
                    <Button size="sm" onClick={() => callBulk('start')}>
                      <PlayCircle size={14} /> {t('actions.start')}
                    </Button>
                  )}
                  {bulkActions.includes('complete') && (
                    <Button size="sm" onClick={() => callBulk('complete')}>
                      <CheckCircle2 size={14} /> {t('actions.complete')}
                    </Button>
                  )}
                  {bulkActions.includes('start-complete') && (
                    <Button size="sm" onClick={() => callBulk('start-complete')}>
                      <CheckCircle2 size={14} /> {t('actions.complete')}
                    </Button>
                  )}
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X size={13} />
              </Button>
            </div>
          </div>
        )}

        <PackWeightDialog
          open={!!canKien}
          productionId={canKien?.productionId}
          onCancel={() => setCanKien(null)}
          onConfirm={(value) => {
            const don = canKien;
            setCanKien(null);
            if (don) void callTransition(don, FulfillmentTransitionAction.Complete, value);
          }}
        />

        {reworkOrder && (
          <ReworkBackDialog
            order={reworkOrder}
            myStage={myStage}
            onClose={() => setReworkOrder(null)}
            onSubmit={async (target, reason) => {
              await callTransition(reworkOrder, FulfillmentTransitionAction.ReworkBack, {
                target,
                reason,
              });
              setReworkOrder(null);
            }}
          />
        )}

        <ImagePreviewDialog
          open={!!preview}
          onOpenChange={(o) => !o && setPreview(null)}
          url={preview?.url}
          originalUrl={preview?.original}
          title={preview?.title}
        />

        <OrderDetailDialog
          open={!!detailOrder}
          onOpenChange={(o) => !o && setDetailOrder(null)}
          orderId={detailOrder?.id ?? null}
          productionId={detailOrder?.productionId}
        />

        {/* Admin gán designer cho đơn unassigned. Reuse bulk component với
            list 1 phần tử. Reload cả kanban sau khi gán xong → đơn rời cột
            unassigned, xuất hiện trong queue designer. */}
        <AssignDesignerDialog
          open={!!assignDesignerOrderId}
          selectedIds={assignDesignerOrderId ? [assignDesignerOrderId] : []}
          onClose={() => setAssignDesignerOrderId(null)}
          onApplied={() => {
            setAssignDesignerOrderId(null);
            void load();
          }}
        />

        {/* Quét/Enter trong ô search → dialog thao tác (Hoàn thành / Báo lỗi),
            clone luồng trang "Quét mã". Reload kanban sau mỗi thao tác. */}
        {scannedOrder &&
          (scanErrorMode ? (
            <OrderErrorScanDialog order={scannedOrder} onClose={closeScanDialog} onSaved={() => void load()} />
          ) : (
            <FulfillmentScanActionDialog
              order={scannedOrder}
              myStage={myStage}
              myFactoryId={profile?.factoryId}
              onClose={closeScanDialog}
              onCompleted={() => void load()}
              onReportError={() => setScanErrorMode(true)}
            />
          ))}

        {/* Modal lịch sử tra cứu — click 1 dòng để tra cứu lại. */}
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History size={18} className="text-primary" />
                {t('kanban.history.title')}
                <span className="text-xs font-normal text-muted-foreground">
                  ({searchHistory.length}/{MAX_SEARCH_HISTORY})
                </span>
              </DialogTitle>
            </DialogHeader>
            {searchHistory.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t('kanban.history.empty')}</div>
            ) : (
              <>
                <ul className="divide-y max-h-[60vh] overflow-y-auto -mx-2">
                  {searchHistory.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryOpen(false);
                          setSearch(h.code);
                          void handleScanLookup(h.code);
                        }}
                        className="w-full flex items-center gap-2.5 px-2 py-2.5 text-left rounded hover:bg-muted transition-colors"
                      >
                        <span className="shrink-0">
                          {h.status === 'found' ? (
                            <CheckCircle2 size={15} className="text-emerald-500" />
                          ) : (
                            <XCircle size={15} className="text-amber-500" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-sm font-medium truncate">{h.code}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {h.status === 'found' ? t('kanban.history.found') : t('kanban.history.notFound')}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {new Date(h.at).toLocaleString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setSearchHistory([])}>
                    <Trash2 size={13} className="mr-1.5" /> {t('kanban.history.clear')}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function actionToastLabel(t: TFunction, action: FulfillmentTransitionAction): string {
  switch (action) {
    case FulfillmentTransitionAction.Start:
      return t('toast.started');
    case FulfillmentTransitionAction.Complete:
      return t('toast.completed');
    case FulfillmentTransitionAction.ReworkBack:
      return t('toast.reworkedBack');
  }
}

function actionLabelInfinitive(t: TFunction, action: BulkAction): string {
  return action === 'start' ? t('verbs.start') : t('verbs.complete');
}

function KPI({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function groupByType(cards: ProductionOrderRow[], noTypeLabel: string): [string, ProductionOrderRow[]][] {
  const map = new Map<string, ProductionOrderRow[]>();
  for (const r of cards) {
    const k = r.type || noTypeLabel;
    const arr = map.get(k) || [];
    arr.push(r);
    map.set(k, arr);
  }
  // Sort orders trong cùng 1 type theo size priority (S, M, L, XL, 2XL...).
  // Tiebreak: giữ thứ tự gốc (BE đã sort theo inProductionAt desc) — dùng
  // index gốc trong array làm secondary key qua `Array.prototype.sort` stable.
  for (const [, arr] of map) {
    arr.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

interface ColumnProps {
  colKey: ColKey;
  meta: ColMeta[ColKey];
  cards: ProductionOrderRow[];
  myStage: FulfillmentStage;
  activeDragId?: string;
  selected: Set<string>;
  copiedOrderId: string | null;
  onCopyProductionId: (o: ProductionOrderRow) => void;
  onClickProductionId: (o: ProductionOrderRow) => void;
  /** Chỉ truyền nếu admin (cột `unassigned`). Card unassigned bind button "Gán Designer". */
  onAssignDesigner?: (o: ProductionOrderRow) => void;
  onStart: (o: ProductionOrderRow) => void;
  onComplete: (o: ProductionOrderRow) => void;
  onReportError: (o: ProductionOrderRow) => void;
  onPreview: (url: string, title: string, original?: string) => void;
  onCheckCard: (id: string, checked: boolean, withShift: boolean) => void;
  onCheckGroup: (rows: ProductionOrderRow[], checked: boolean) => void;
}

function Column({
  colKey,
  meta,
  cards,
  myStage,
  activeDragId,
  selected,
  copiedOrderId,
  onCopyProductionId,
  onClickProductionId,
  onAssignDesigner,
  onStart,
  onComplete,
  onReportError,
  onPreview,
  onCheckCard,
  onCheckGroup,
}: ColumnProps) {
  const { t } = useTranslation('fulfillmentWorkflow');
  const Icon = meta.icon;
  const { setNodeRef, isOver } = useDroppable({ id: colKey });
  const noTypeLabel = t('kanban.column.noType');

  // Trần số card RENDER mỗi cột. Cột "Đã xong" của 1 xưởng lớn có thể tới vài
  // nghìn card (mỗi card kèm ảnh mockup) — render hết làm treo hẳn tab ngay khi
  // gõ 1 ký tự vào ô "TÌM / QUÉT MÃ" (ô chính của máy quét tại trạm). Cắt bớt
  // + nút "Xem thêm"; mọi phép đếm/chọn cả cột vẫn chạy trên `cards` đầy đủ.
  const [renderLimit, setRenderLimit] = useState(COLUMN_RENDER_LIMIT);
  useEffect(() => {
    setRenderLimit(COLUMN_RENDER_LIMIT);
  }, [cards]);
  const visibleCards = useMemo(
    () => (cards.length > renderLimit ? cards.slice(0, renderLimit) : cards),
    [cards, renderLimit],
  );
  const hiddenCount = cards.length - visibleCards.length;
  const groups = useMemo(() => groupByType(visibleCards, noTypeLabel), [visibleCards, noTypeLabel]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (type: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  // Cột done không có checkbox (đã xong rồi — không có bulk action).
  const showCheckbox = colKey !== 'done' && colKey !== 'fixed';
  const colSelCount = useMemo(() => cards.filter((c) => selected.has(c._id)).length, [cards, selected]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md border-2 bg-muted/30 p-2.5 transition-colors min-h-[200px] flex flex-col gap-2',
        meta.accent,
        isOver && 'bg-muted/60',
      )}
    >
      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
        <span className="inline-flex items-center gap-1.5">
          {/* Chọn/bỏ chọn CẢ CỘT — tick 1 phát rồi bulk, khỏi tick từng đơn. */}
          {showCheckbox && cards.length > 0 && (
            <input
              type="checkbox"
              className="shrink-0 accent-indigo-500"
              title={t('kanban.column.selectAll')}
              ref={(el) => {
                if (el) el.indeterminate = colSelCount > 0 && colSelCount < cards.length;
              }}
              checked={cards.length > 0 && colSelCount === cards.length}
              onChange={(e) => onCheckGroup(cards, e.target.checked)}
            />
          )}
          <Icon size={13} /> {meta.label}
        </span>
        <span className="text-muted-foreground">
          {colSelCount > 0 ? `${colSelCount}/${cards.length}` : cards.length}
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto max-h-[calc(100vh-380px)]">
        {cards.length === 0 && (
          <div className="text-[11px] text-muted-foreground italic text-center py-6">{t('kanban.column.empty')}</div>
        )}
        {groups.map(([type, rows]) => {
          const selCount = rows.filter((r) => selected.has(r._id)).length;
          const allChecked = rows.length > 0 && selCount === rows.length;
          const indeterminate = selCount > 0 && !allChecked;
          const isCollapsed = collapsed.has(type);
          return (
            <div key={type} className="space-y-1.5">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleCollapse(type)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCollapse(type);
                  }
                }}
                className="flex items-center gap-2 px-1.5 py-1 rounded bg-card/60 text-[11px] font-medium text-foreground cursor-pointer hover:bg-card select-none"
                title={isCollapsed ? t('kanban.column.expandTitle') : t('kanban.column.collapseTitle')}
              >
                {showCheckbox && (
                  <input
                    type="checkbox"
                    className="shrink-0 accent-indigo-500"
                    ref={(el) => {
                      if (el) el.indeterminate = indeterminate;
                    }}
                    checked={allChecked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onCheckGroup(rows, e.target.checked)}
                  />
                )}
                {isCollapsed ? (
                  <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate" title={type}>
                  {type}
                </span>
                {showCheckbox && (
                  <span className="text-muted-foreground font-normal">
                    {selCount}/{rows.length}
                  </span>
                )}
                {!showCheckbox && <span className="text-muted-foreground font-normal">{rows.length}</span>}
              </div>

              {!isCollapsed && (
                <div className="space-y-2 pl-2 pr-2 border-l-2 border-border/40 ml-2.5">
                  {rows.map((o) => {
                    const checked = selected.has(o._id);
                    const isDragging = activeDragId === o._id;
                    return (
                      <div key={o._id} className={cn('relative group', isDragging && 'opacity-30')}>
                        {showCheckbox && (
                          <div className="absolute top-1.5 left-1.5 z-10">
                            <input
                              type="checkbox"
                              checked={checked}
                              onClick={(e) => {
                                const me = e.nativeEvent as MouseEvent;
                                (
                                  e.currentTarget as HTMLInputElement & {
                                    __shift?: boolean;
                                  }
                                ).__shift = me.shiftKey;
                              }}
                              onChange={(e) => {
                                const ws =
                                  (e.currentTarget as HTMLInputElement & { __shift?: boolean }).__shift || false;
                                onCheckCard(o._id, e.currentTarget.checked, ws);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="w-3.5 h-3.5 accent-indigo-500"
                            />
                          </div>
                        )}

                        <div
                          className={
                            checked
                              ? 'rounded-md ring-1 ring-indigo-400/70 bg-indigo-50/40 dark:bg-indigo-500/5 transition-colors'
                              : 'transition-colors'
                          }
                        >
                          <FulfillmentTaskCard
                            order={o}
                            myStage={myStage}
                            colKey={colKey}
                            isCopied={copiedOrderId === o._id}
                            onCopyProductionId={() => onCopyProductionId(o)}
                            onClickProductionId={() => onClickProductionId(o)}
                            onAssignDesigner={
                              colKey === 'unassigned' && onAssignDesigner ? () => onAssignDesigner(o) : undefined
                            }
                            onPreview={onPreview}
                            onStart={() => onStart(o)}
                            onComplete={() => onComplete(o)}
                            onReportError={() => onReportError(o)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setRenderLimit((v) => v + COLUMN_RENDER_LIMIT)}
            className="w-full rounded border border-dashed border-border py-1.5 text-[11px] text-muted-foreground hover:bg-card"
          >
            {t('kanban.column.showMore', {
              count: Math.min(hiddenCount, COLUMN_RENDER_LIMIT),
              shown: visibleCards.length,
              total: cards.length,
            })}
          </button>
        )}
      </div>
    </div>
  );
}
