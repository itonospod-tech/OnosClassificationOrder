import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  ListChecks,
  MousePointerClick,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
  XCircle,
} from 'lucide-react';
import type { DesignerMyStats, DesignerTaskCard, DesignerTeamMember, DesignerTransitionDto } from 'shared';
import { DesignerStatus, DesignerTransitionAction, WorkshopConfigCategory } from 'shared';
import { toast } from 'sonner';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';
import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { ColumnTabs } from '@/components/common/ColumnTabs';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { PipelineDailyOverview } from '@/components/common/PipelineDailyOverview';
import { SelectFilter } from '@/components/common/SelectFilter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useSidebarResetSignal } from '@/hooks/useSidebarResetSignal';

import { DailyBreakdownPanel } from './DailyBreakdownPanel';
import { RejectModal } from './RejectModal';
import { TaskCard } from './TaskCard';
import { TaskDetailDialog } from './TaskDetailDialog';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Role được mở ô "Xem task của" (xem thay kanban của designer khác). PHẢI khớp
 * `VIEW_AS_ROLES` ở `designer-task.service.ts` — BE mới là nơi chặn thật, danh
 * sách này chỉ để không hiện ô lọc rồi cho bấm vào một cái 403.
 */
const VIEW_AS_ROLES = ['SuperAdmin', 'Admin', 'Manager'];

type ColKey = 'assigned' | 'rework' | 'watching' | 'inProgress' | 'done' | 'fixed';

type Columns = Record<ColKey, DesignerTaskCard[]>;

const EMPTY_COLS: Columns = {
  assigned: [],
  rework: [],
  watching: [],
  inProgress: [],
  done: [],
  fixed: [],
};

// THỨ TỰ CỘT: Cần làm → Cần làm lại → Đang chờ quay lại → Đang làm → Đã xong → Đã sửa
const COL_ORDER: ColKey[] = ['assigned', 'rework', 'watching', 'inProgress', 'done', 'fixed'];

type ColMeta = { label: string; status: DesignerStatus; accent: string; bulk: DesignerTransitionAction[] };

function buildColMeta(t: TFunction<'designerTaskWorkflow'>): Record<ColKey, ColMeta> {
  return {
    assigned: {
      label: t('myTasks.columns.assigned'),
      status: DesignerStatus.Assigned,
      accent: 'border-zinc-300 dark:border-zinc-700',
      bulk: [DesignerTransitionAction.Start, DesignerTransitionAction.Reject],
    },
    rework: {
      label: t('myTasks.columns.rework'),
      status: DesignerStatus.Rework,
      accent: 'border-amber-300 dark:border-amber-700',
      bulk: [DesignerTransitionAction.Restart],
    },
    // "Đang chờ quay lại" = task đã xong/đang chờ làm lại của đơn đang bị giữ ở
    // Soát tool phía trên. Read-only (không kéo/không bulk); Support soát xong →
    // BE tự chuyển sang "Cần làm lại". status giữ Done cho hợp kiểu.
    watching: {
      label: t('myTasks.columns.watching'),
      status: DesignerStatus.Done,
      accent: 'border-sky-300 dark:border-sky-700',
      bulk: [],
    },
    inProgress: {
      label: t('myTasks.columns.inProgress'),
      status: DesignerStatus.InProgress,
      accent: 'border-indigo-300 dark:border-indigo-700',
      bulk: [DesignerTransitionAction.Complete, DesignerTransitionAction.Reject],
    },
    done: {
      label: t('myTasks.columns.done'),
      status: DesignerStatus.Done,
      accent: 'border-emerald-300 dark:border-emerald-700',
      bulk: [],
    },
    // "Đã sửa" = done nhưng từng bị báo lỗi (designerReworkCount>0). Terminal, không
    // phải drop target (guard trong planTransition). status giữ Done cho hợp kiểu.
    fixed: {
      label: t('myTasks.columns.fixed'),
      status: DesignerStatus.Done,
      accent: 'border-teal-300 dark:border-teal-700',
      bulk: [],
    },
  };
}

const COL_BY_STATUS: Partial<Record<DesignerStatus, ColKey>> = {
  [DesignerStatus.Assigned]: 'assigned',
  [DesignerStatus.Rework]: 'rework',
  [DesignerStatus.InProgress]: 'inProgress',
  [DesignerStatus.Done]: 'done',
};

type FilterOption = { value: string; label: string; count: number };

type Filters = {
  type: string;
  fabricType: string;
  machineNumber: string;
  toolResult: string;
  toolResultNote: string;
  userSku: string;
  /** CSV các mã file sửa lỗi đã chọn (multi-select). Field mảng trên order. */
  errorFile: string;
};

const EMPTY_FILTERS: Filters = {
  type: '',
  fabricType: '',
  machineNumber: '',
  toolResult: '',
  toolResultNote: '',
  userSku: '',
  errorFile: '',
};

/** Drag rules: từ status `from` sang cột `to` ⇒ action gì (hoặc null). */
function planTransition(
  from: DesignerStatus,
  to: ColKey,
  colMeta: Record<ColKey, ColMeta>,
): { action: DesignerTransitionAction; needsReason?: boolean } | null {
  // "Đã sửa" + "Đang chờ quay lại" là cột read-only (terminal / chờ hệ thống) —
  // không cho kéo thả vào.
  if (to === 'fixed' || to === 'watching') return null;
  const target = colMeta[to].status;
  if (target === from) return null;
  if (target === DesignerStatus.InProgress) {
    if (from === DesignerStatus.Assigned) return { action: DesignerTransitionAction.Start };
    if (from === DesignerStatus.Rework) return { action: DesignerTransitionAction.Restart };
  }
  if (target === DesignerStatus.Done && from === DesignerStatus.InProgress) {
    return { action: DesignerTransitionAction.Complete };
  }
  return null;
}

export default function MyTasksPage() {
  const { t } = useTranslation(['designerTaskWorkflow', 'common']);
  const colMeta = useMemo(() => buildColMeta(t), [t]);
  // Phones: one column at a time from a tab strip, sections reordered so the cards come first, and
  // the facet selects folded behind a "Filters" button (same pattern as the fulfillment board).
  const isMobile = useIsMobile();
  const [mobileCol, setMobileCol] = useState<ColKey | null>(null);
  const [facetsOpen, setFacetsOpen] = useState(false);
  const [columns, setColumns] = useState<Columns>(EMPTY_COLS);
  const [rejected, setRejected] = useState<DesignerTaskCard[]>([]);
  const [showRejected, setShowRejected] = useState(false);
  const [stats, setStats] = useState<DesignerMyStats | null>(null);
  // Bộ lọc ngày theo `inProductionAt` (kanban 4 cột + facet counts). Mặc định
  // 7 ngày gần nhất. Lưu vào URL params (`from`/`to`) để F5 giữ lựa chọn.
  const [searchParams, setSearchParams] = useSearchParams();
  const [dateFrom, setDateFrom] = useState<string>(() => searchParams.get('from') || daysAgoISO(6));
  const [dateTo, setDateTo] = useState<string>(() => searchParams.get('to') || todayISO());
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState<string | undefined>(undefined);

  // ── "Xem task của" — quản lý mở đúng kanban của 1 nhân viên và thao tác thay.
  // Rỗng = xem task của chính mình (hành vi cũ với mọi designer). Giá trị đi
  // kèm MỌI request `my-*` của trang; BE tự 403 nếu role không được phép.
  const roleName = useAuthStore((st) => st.profile?.role?.name);
  const canViewAs = !!roleName && VIEW_AS_ROLES.includes(roleName);
  const [viewUserId, setViewUserId] = useState<string>(() => searchParams.get('viewUserId') || '');
  const [designers, setDesigners] = useState<DesignerTeamMember[]>([]);
  // `canViewAs` sai (role thường) thì KHÔNG gửi `viewUserId` dù URL có sẵn —
  // link dán tay từ máy admin sang máy designer sẽ 403 cả trang thay vì chỉ bỏ qua.
  const effectiveViewUserId = canViewAs ? viewUserId : '';

  // Filter bar cũng lưu vào URL params để F5 giữ lựa chọn (đọc 1 lần khi mount).
  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    type: searchParams.get('type') || '',
    fabricType: searchParams.get('fabricType') || '',
    machineNumber: searchParams.get('machineNumber') || '',
    toolResult: searchParams.get('toolResult') || '',
    toolResultNote: searchParams.get('toolResultNote') || '',
    userSku: searchParams.get('userSku') || '',
    errorFile: searchParams.get('errorFile') || '',
  }));
  const [filterOptions, setFilterOptions] = useState<{
    type: FilterOption[];
    fabricType: FilterOption[];
    machineNumber: FilterOption[];
    toolResult: FilterOption[];
    toolResultNote: FilterOption[];
    userSku: FilterOption[];
    errorFile: FilterOption[];
  }>({ type: [], fabricType: [], machineNumber: [], toolResult: [], toolResultNote: [], userSku: [], errorFile: [] });

  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search, 300);

  // Selection state — global Set chứa tất cả id đã chọn. Bulk action chỉ
  // valid khi tất cả id đã chọn nằm trong CÙNG 1 cột status.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Click lại menu "Task của tôi" ở sidebar khi đang đứng đúng trang này →
  // xóa hết filter (xem `useSidebarResetSignal`).
  useSidebarResetSignal(PATHS.MY_TASKS, () => {
    setSearch('');
    setFilters({ ...EMPTY_FILTERS });
    setDateFrom(daysAgoISO(6));
    setDateTo(todayISO());
    setSelected(new Set());
    setViewUserId('');
  });

  const [rejectTarget, setRejectTarget] = useState<DesignerTaskCard | null>(null);
  const [bulkReject, setBulkReject] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string; original?: string } | null>(null);

  // ID + cardSnapshot of card đang drag — render trong DragOverlay để
  // visible khi kéo qua cột khác.
  const [activeCard, setActiveCard] = useState<DesignerTaskCard | null>(null);

  const lastClickedRef = useRef<{ colKey: ColKey; id: string } | null>(null);

  // Seq guard chống race: khi đổi ngày/filter liên tiếp, nhiều request chạy
  // song song. Mạng không đảm bảo thứ tự trả về → response cũ về muộn có thể
  // ghi đè data mới. Mỗi fetch tăng seq, chỉ response của request MỚI NHẤT
  // (seq khớp ref) mới được áp dụng.
  const tasksSeqRef = useRef(0);
  const filtersSeqRef = useRef(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const fetchTasks = async () => {
    const seq = ++tasksSeqRef.current;
    try {
      setLoading(true);
      const res = await RepositoryRemote.designer.myTasks({
        ...filters,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        search: debouncedSearch || undefined,
        viewUserId: effectiveViewUserId || undefined,
      });
      // Response cũ đến muộn → bỏ qua, không ghi đè data của request mới hơn.
      if (seq !== tasksSeqRef.current) return;
      const data = res.data?.data as
        | {
            columns: Columns;
            rejected: DesignerTaskCard[];
            fullName?: string;
          }
        | undefined;
      setColumns(data?.columns || EMPTY_COLS);
      setRejected(data?.rejected || []);
      setFullName(data?.fullName);
      setSelected(new Set());
      lastClickedRef.current = null;
    } catch (err) {
      if (seq === tasksSeqRef.current) handleAxiosError(err);
    } finally {
      if (seq === tasksSeqRef.current) setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await RepositoryRemote.designer.myStats({
        period: 'custom',
        from: dateFrom || undefined,
        to: dateTo || undefined,
        viewUserId: effectiveViewUserId || undefined,
      });
      setStats((res.data?.data || null) as DesignerMyStats | null);
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const fetchFilters = async () => {
    const seq = ++filtersSeqRef.current;
    try {
      const res = await RepositoryRemote.designer.myTaskFilters({
        ...filters,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        viewUserId: effectiveViewUserId || undefined,
      });
      // Response cũ đến muộn → bỏ qua (tránh facet count lệch với data đang hiện).
      if (seq !== filtersSeqRef.current) return;
      // Merge với default rỗng → mọi key luôn là array kể cả khi response BE
      // thiếu facet nào đó (vd. backend cũ chưa có `userSku`) → tránh crash.
      const empty = {
        type: [],
        fabricType: [],
        machineNumber: [],
        toolResult: [],
        toolResultNote: [],
        userSku: [],
        errorFile: [],
      };
      setFilterOptions({ ...empty, ...(res.data?.data || {}) } as typeof filterOptions);
    } catch (err) {
      if (seq === filtersSeqRef.current) handleAxiosError(err);
    }
  };

  // Sync ngày + toàn bộ filter bar (+ search) → URL params để F5 giữ lựa chọn.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        const setOrDel = (k: string, v: string) => (v ? sp.set(k, v) : sp.delete(k));
        setOrDel('from', dateFrom);
        setOrDel('to', dateTo);
        setOrDel('type', filters.type);
        setOrDel('fabricType', filters.fabricType);
        setOrDel('machineNumber', filters.machineNumber);
        setOrDel('toolResult', filters.toolResult);
        setOrDel('toolResultNote', filters.toolResultNote);
        setOrDel('userSku', filters.userSku);
        setOrDel('errorFile', filters.errorFile);
        setOrDel('search', debouncedSearch);
        setOrDel('viewUserId', effectiveViewUserId);
        return sp;
      },
      { replace: true },
    );
  }, [dateFrom, dateTo, filters, debouncedSearch, effectiveViewUserId, setSearchParams]);

  useEffect(() => {
    fetchTasks();
    fetchFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.type,
    filters.fabricType,
    filters.machineNumber,
    filters.toolResult,
    filters.toolResultNote,
    filters.userSku,
    filters.errorFile,
    debouncedSearch,
    dateFrom,
    dateTo,
    effectiveViewUserId,
  ]);

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, effectiveViewUserId]);

  // Danh sách designer cho ô "Xem task của" — chỉ nạp khi role được phép, 1 lần.
  useEffect(() => {
    if (!canViewAs) return;
    (async () => {
      try {
        const res = await RepositoryRemote.designer.listTeam();
        setDesigners((res.data?.data || []) as DesignerTeamMember[]);
      } catch (err) {
        handleAxiosError(err);
      }
    })();
  }, [canViewAs]);

  // Nạp workshop_config (1 lần) để TaskCard + filter bar resolve label (name)
  // thay vì hiển thị raw code (đồng bộ với bảng đơn).
  const loadWorkshopConfig = useWorkshopConfigStore((s) => s.load);
  useEffect(() => {
    loadWorkshopConfig();
  }, [loadWorkshopConfig]);

  // Subscribe byCategory để re-render khi config load xong; map option.value
  // (code) → name cho dropdown filter. Giữ nguyên value (code) để gửi xuống BE.
  const byCategory = useWorkshopConfigStore((s) => s.byCategory);
  const labelOpts = (cat: WorkshopConfigCategory, opts: FilterOption[]): FilterOption[] =>
    opts.map((o) => ({
      ...o,
      label: byCategory[cat]?.find((i) => i.code === o.value)?.name || o.label,
    }));

  // Bump để DailyBreakdownPanel refetch mỗi khi kanban đổi (transition/refresh)
  // → số liệu theo ngày luôn đồng bộ với kanban.
  const [breakdownToken, setBreakdownToken] = useState(0);

  const refreshAll = () => {
    fetchTasks();
    fetchFilters();
    fetchStats();
    setBreakdownToken((prev) => prev + 1);
  };

  // Cho mỗi cột → ordered array của id (sau khi đã group by type, để
  // shift+click visual order khớp với DOM order).
  const orderedIdsPerColumn = useMemo(() => {
    const out: Record<ColKey, string[]> = {
      assigned: [],
      rework: [],
      watching: [],
      inProgress: [],
      done: [],
      fixed: [],
    };
    for (const k of COL_ORDER) {
      const groups = groupByType(columns[k], t('myTasks.noType'));
      for (const [, rows] of groups) for (const r of rows) out[k].push(r._id);
    }
    return out;
  }, [columns, t]);

  // ─── Selection helpers ─────────────────────────────────────────
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

  const toggleGroup = (rows: DesignerTaskCard[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (checked) next.add(r._id);
        else next.delete(r._id);
      }
      return next;
    });
  };

  // Tính status của các đơn đã chọn — để biết bulk action nào valid.
  const selectedColumns = useMemo(() => {
    const cols = new Set<ColKey>();
    for (const k of COL_ORDER) {
      for (const r of columns[k]) {
        if (selected.has(r._id)) {
          cols.add(k);
          break;
        }
      }
    }
    return cols;
  }, [selected, columns]);

  const bulkActions = useMemo<DesignerTransitionAction[]>(() => {
    if (selectedColumns.size !== 1) return []; // mixed cols → no bulk
    const [only] = [...selectedColumns];
    return colMeta[only].bulk;
  }, [selectedColumns, colMeta]);

  // ─── Drag handling ─────────────────────────────────────────────
  const callTransition = async (orderId: string, dto: DesignerTransitionDto) => {
    try {
      await RepositoryRemote.designer.transition(orderId, dto);
      toast.success(t('myTasks.statusUpdated'));
      refreshAll();
    } catch (err) {
      handleAxiosError(err);
      fetchTasks();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    const status = (event.active.data.current as { status?: DesignerStatus } | undefined)?.status;
    if (!status) return;
    const colKey = COL_BY_STATUS[status];
    if (!colKey) return;
    const card = columns[colKey].find((c) => c._id === id);
    if (card) setActiveCard(card);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveCard(null);
    const cardId = event.active.id as string;
    const fromStatus = (event.active.data.current as { status?: DesignerStatus } | undefined)?.status;
    const overId = event.over?.id as ColKey | undefined;
    if (!overId || !fromStatus || !colMeta[overId]) return;

    const plan = planTransition(fromStatus, overId, colMeta);
    if (!plan) {
      const targetStatus = colMeta[overId].status;
      if (targetStatus === fromStatus) return;
      toast.warning(t('myTasks.dragRuleWarning', { from: fromStatus, to: targetStatus }));
      return;
    }
    moveCardOptimistic(cardId, fromStatus, overId);
    callTransition(cardId, { action: plan.action });
  };

  const moveCardOptimistic = (id: string, from: DesignerStatus, to: ColKey): void => {
    const fromKey = COL_BY_STATUS[from];
    if (!fromKey) return;
    setColumns((prev) => {
      const card = prev[fromKey].find((c) => c._id === id);
      if (!card) return prev;
      // Hoàn thành đơn từng bị báo lỗi (reworkCount>0) → vào cột "Đã sửa" thay
      // vì "Đã xong", khớp với cách BE tách 2 cột (tránh nhấp nháy trước refetch).
      const destKey: ColKey = to === 'done' && (card.designerReworkCount || 0) > 0 ? 'fixed' : to;
      return {
        ...prev,
        [fromKey]: prev[fromKey].filter((c) => c._id !== id),
        [destKey]: [{ ...card, designerStatus: colMeta[destKey].status }, ...prev[destKey]],
      };
    });
  };

  // ─── Bulk actions ──────────────────────────────────────────────
  const callBulk = async (action: DesignerTransitionAction, reason?: string, targetUserId?: string) => {
    if (selected.size === 0) return;
    try {
      const ids = Array.from(selected);
      const res = await RepositoryRemote.designer.bulkTransition({ ids, action, reason, targetUserId });
      const data = res.data?.data as {
        matched: number;
        modified: number;
        skipped: { orderId: string; productionId: string; reason: string }[];
      };
      if (data.skipped.length === 0) {
        toast.success(t('myTasks.bulkUpdated', { modified: data.modified, matched: data.matched }));
      } else {
        toast.warning(
          t('myTasks.bulkSkippedWarning', { modified: data.modified, matched: data.matched, count: data.skipped.length }),
          { duration: 5000 },
        );
        toast.message(t('myTasks.skippedOrdersTitle'), {
          description: data.skipped
            .slice(0, 5)
            .map((s) => `• ${s.productionId}: ${s.reason}`)
            .join('\n'),
          duration: 9000,
        });
      }
      refreshAll();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const handleBulkReject = (reason: string, targetUserId: string) => {
    callBulk(DesignerTransitionAction.Reject, reason, targetUserId);
    setBulkReject(false);
  };

  const handleSingleReject = async (reason: string, targetUserId: string) => {
    if (!rejectTarget) return;
    try {
      await RepositoryRemote.designer.transition(rejectTarget._id, {
        action: DesignerTransitionAction.Reject,
        reason: reason || undefined,
        targetUserId,
      });
      toast.success(t('myTasks.rejectHandedOver'));
      setRejectTarget(null);
      refreshAll();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const onPreview = (url: string, title: string, original?: string) => setPreview({ url, title, original });

  // Phone column: the designer's pick, else the first column that has cards.
  const phoneCols = COL_ORDER.filter(
    (k) =>
      (k !== 'rework' || columns.rework.length > 0) &&
      (k !== 'watching' || columns.watching.length > 0) &&
      (k !== 'fixed' || columns.fixed.length > 0),
  );
  const mobileColActive: ColKey =
    mobileCol && phoneCols.includes(mobileCol)
      ? mobileCol
      : (phoneCols.find((k) => columns[k].length > 0) ?? phoneCols[0] ?? 'assigned');

  return (
    <TooltipProvider delayDuration={200}>
      {/* Phones reorder the sections (flex + `order-*`): tabs → filters → the cards, THEN the statistics. */}
      <div className="space-y-4 max-md:flex max-md:flex-col max-md:gap-3 max-md:space-y-0">
        {/* Header */}
        <PageHeader
          icon={<ListChecks size={20} />}
          title={`${t('myTasks.greeting')}${fullName ? `, ${fullName}` : ''}`}
          description={t('myTasks.subtitle')}
          hideDescriptionOnMobile
          inlineActionsOnMobile={!canViewAs}
          actions={
            <>
              {/* "Xem task của" — chỉ quản lý thấy. Chọn 1 designer → toàn trang
                  (kanban + KPI + Chi tiết theo ngày) đổi sang góc nhìn của người
                  đó và thao tác được y như họ. */}
              {canViewAs && (
                <div className="flex items-center gap-1.5">
                  <Eye size={13} className="text-muted-foreground" />
                  <select
                    value={viewUserId}
                    onChange={(e) => {
                      setViewUserId(e.target.value);
                      // Đổi người xem = đổi hẳn tập task → bỏ chọn cũ, nếu không
                      // bulk action sẽ bắn lên id của designer trước đó.
                      setSelected(new Set());
                    }}
                    className="h-7 max-w-[220px] rounded-md border border-input bg-background px-2 text-xs touch:h-11 touch:text-sm"
                    title={t('myTasks.viewAs.label')}
                  >
                    <option value="">{t('myTasks.viewAs.self')}</option>
                    {designers.map((d) => (
                      <option key={d._id} value={d._id}>
                        {d.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={refreshAll} disabled={loading} aria-label={t('common:actions.reload', { defaultValue: 'Reload' })}>
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </Button>
            </>
          }
        />

        {/* Banner "đang xem thay" — bắt buộc phải nổi bật: thao tác trên trang
            này ghi vào task của NGƯỜI KHÁC (order log ghi actor là mình), nhầm
            người là sửa nhầm đơn của designer khác. */}
        {effectiveViewUserId && (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="flex items-center gap-1.5">
              <Eye size={13} className="shrink-0" />
              {t('myTasks.viewAs.banner', { name: fullName || '—' })}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] border-amber-400 dark:border-amber-700"
              onClick={() => {
                setViewUserId('');
                setSelected(new Set());
              }}
            >
              {t('myTasks.viewAs.exit')}
            </Button>
          </div>
        )}

        {/* Thanh ngày — preset inline full-width */}
        <DateRangePicker
          className="max-md:order-2"
          variant="inline"
          from={dateFrom}
          to={dateTo}
          clearable={false}
          onChange={(f, to) => {
            setDateFrom(f);
            setDateTo(to);
          }}
        />

        {/* KPI */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-8 gap-2 max-md:hidden">
            <KPI label={t('myTasks.kpi.assigned')} value={stats.assignedCount} accent="text-zinc-700 dark:text-zinc-200" />
            <KPI label={t('myTasks.kpi.rework')} value={stats.reworkCount} accent="text-amber-600" />
            <KPI label={t('myTasks.kpi.watching')} value={columns.watching.length} accent="text-sky-600" />
            <KPI label={t('myTasks.kpi.inProgress')} value={stats.inProgressCount} accent="text-indigo-600" />
            <KPI
              label={t('myTasks.kpi.done')}
              value={Math.max(0, stats.completedInPeriod - stats.fixedInPeriod)}
              accent="text-emerald-600"
            />
            <KPI label={t('myTasks.kpi.fixed')} value={stats.fixedInPeriod} accent="text-teal-600" />
            <KPI label={t('myTasks.kpi.rejected')} value={stats.rejectedCount} accent="text-rose-600" />
            <KPI
              label={t('myTasks.kpi.responseWork')}
              value={`${stats.avgResponseMin}' / ${stats.avgWorkMin}'`}
              accent="text-muted-foreground"
            />
          </div>
        )}

        {/* Phones: the KPI tiles become the column picker — tap a count to see that column. */}
        {isMobile && (
          <div className="order-1">
            <ColumnTabs
              items={COL_ORDER.filter(
                (k) =>
                  (k !== 'rework' || columns.rework.length > 0) &&
                  (k !== 'watching' || columns.watching.length > 0) &&
                  (k !== 'fixed' || columns.fixed.length > 0),
              ).map((k) => ({ key: k, label: colMeta[k].label, count: columns[k].length }))}
              active={mobileColActive}
              onPick={setMobileCol}
            />
          </div>
        )}

        {/* Tổng quan theo ngày — funnel TOÀN CỤC (mọi đơn, không chỉ của bạn),
            highlight lane Designer. Ăn cùng filter ngày; click 1 ngày → lọc về
            đúng ngày đó. Khác với "Chi tiết theo ngày" bên dưới (chỉ đơn của bạn). */}
        <div className="max-md:order-6">
        <PipelineDailyOverview
          lane="designer"
          from={dateFrom || undefined}
          to={dateTo || undefined}
          reloadToken={breakdownToken}
          dayFilter={dateFrom && dateFrom === dateTo ? dateFrom : undefined}
          onPickDay={(day) => {
            setDateFrom(day);
            setDateTo(day);
          }}
          caption={t('myTasks.pipelineCaption')}
        />
        </div>

        {/* Chi tiết theo ngày — panel focus đơn chưa xong (7/14/30 ngày).
            Click 1 ngày → lọc kanban về đúng ngày đó. */}
        <div className="max-md:order-6">
        <DailyBreakdownPanel
          selectedDay={dateFrom && dateFrom === dateTo ? dateFrom : undefined}
          onPickDay={(day) => {
            setDateFrom(day);
            setDateTo(day);
          }}
          reloadToken={breakdownToken}
          viewUserId={effectiveViewUserId || undefined}
        />
        </div>

        {/* Hint — Shift/drag tips mean nothing on a touch screen. */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground max-md:hidden">
          <MousePointerClick size={13} className="text-primary shrink-0 mt-0.5" />
          <div>
            <strong className="text-foreground">{t('myTasks.hint.title')}</strong> {t('myTasks.hint.textBefore')}{' '}
            <kbd className="px-1 bg-background border rounded">Shift</kbd> {t('myTasks.hint.textAfter')}
          </div>
        </div>

        {/* Filter bar */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-8 gap-2 rounded-md border border-border bg-card p-2.5 max-md:order-2">
          <div className="max-md:col-span-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
              {t('myTasks.filters.search')}
            </label>
            <div className="relative mt-1">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('myTasks.filters.searchPlaceholder')}
                className="h-7 pl-7 text-xs touch:h-11 touch:pl-8 touch:text-base"
              />
            </div>
          </div>
          {/* Phones: the seven facet selects fold behind one button that shows how many are in use. */}
          {isMobile && (
            <Button
              variant="outline"
              size="sm"
              className={cn('col-span-2', Object.values(filters).some(Boolean) && 'border-tone-info text-tone-info')}
              aria-expanded={facetsOpen}
              onClick={() => setFacetsOpen((v) => !v)}
            >
              <SlidersHorizontal size={14} />
              {t('myTasks.filters.button', { defaultValue: 'Filters' })}
              {Object.values(filters).filter(Boolean).length > 0 && (
                <span className="rounded-full bg-tone-info px-1.5 text-[11px] font-semibold leading-4 text-white">
                  {Object.values(filters).filter(Boolean).length}
                </span>
              )}
              <ChevronDown size={13} className={cn('transition-transform', facetsOpen && 'rotate-180')} />
            </Button>
          )}
          <div className={isMobile && !facetsOpen ? 'hidden' : 'contents'}>
          <SelectFilter
            label={t('myTasks.filters.type')}
            value={filters.type}
            onChange={(v) => setFilters({ ...filters, type: v })}
            options={filterOptions.type}
          />
          <SelectFilter
            label={t('myTasks.filters.fabricType')}
            value={filters.fabricType}
            onChange={(v) => setFilters({ ...filters, fabricType: v })}
            options={labelOpts(WorkshopConfigCategory.FabricType, filterOptions.fabricType)}
          />
          <SelectFilter
            label={t('myTasks.filters.machine')}
            value={filters.machineNumber}
            onChange={(v) => setFilters({ ...filters, machineNumber: v })}
            options={labelOpts(WorkshopConfigCategory.Machine, filterOptions.machineNumber)}
          />
          <SelectFilter
            label={t('myTasks.filters.toolResult')}
            value={filters.toolResult}
            onChange={(v) => setFilters({ ...filters, toolResult: v })}
            options={labelOpts(WorkshopConfigCategory.ToolResult, filterOptions.toolResult)}
          />
          <SelectFilter
            label={t('myTasks.filters.toolResultNote')}
            value={filters.toolResultNote}
            onChange={(v) => setFilters({ ...filters, toolResultNote: v })}
            options={labelOpts(WorkshopConfigCategory.ToolResultNote, filterOptions.toolResultNote)}
          />
          <SelectFilter
            label={t('myTasks.filters.customer')}
            value={filters.userSku}
            onChange={(v) => setFilters({ ...filters, userSku: v })}
            options={filterOptions.userSku}
          />
          {/* File sửa lỗi — single-select (giống OrderTableWorkshop). Options lấy
              thẳng từ backend facet: `label` đã là name (resolve ở BE), không cần
              labelOpts/byCategory. Field mảng: BE lọc `$in` khớp đơn chứa mã đã chọn. */}
          <SelectFilter
            label={t('myTasks.filters.errorFile')}
            value={filters.errorFile}
            onChange={(v) => setFilters({ ...filters, errorFile: v })}
            options={filterOptions.errorFile}
          />
          </div>
        </div>

        {/* Kanban — cột "Cần làm lại" + "Đã sửa" chỉ render khi có task (dành chỗ
            cho các cột chính; KPI vẫn luôn hiện số). */}
        {(() => {
          const visibleCols = COL_ORDER.filter(
            (k) =>
              (k !== 'rework' || columns.rework.length > 0) &&
              (k !== 'watching' || columns.watching.length > 0) &&
              (k !== 'fixed' || columns.fixed.length > 0),
          );
          const gridClsByCount: Record<number, string> = {
            6: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3',
            5: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3',
            4: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3',
            3: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3',
          };
          const gridCls = gridClsByCount[visibleCols.length] ?? gridClsByCount[4];
          return (
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className={cn(isMobile ? 'grid grid-cols-1 gap-3' : gridCls, 'max-md:order-3')}>
                {(isMobile ? [mobileColActive] : visibleCols).map((key) => (
                  <Column
                    key={key}
                    colKey={key}
                    meta={colMeta[key]}
                    cards={columns[key]}
                    selected={selected}
                    activeDragId={activeCard?._id}
                    onCheckCard={(id, checked, withShift) => handleCardCheckbox(key, id, checked, withShift)}
                    onCheckGroup={toggleGroup}
                    onClickId={(id) => setDetailId(id)}
                    onPreview={onPreview}
                    onRejectCard={(card) => setRejectTarget(card)}
                  />
                ))}
              </div>
              <DragOverlay dropAnimation={null}>
                {activeCard ? (
                  <div className="rotate-1 shadow-2xl ring-2 ring-primary/40 rounded-md w-[260px] cursor-grabbing">
                    <TaskCard card={activeCard} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          );
        })()}

        {/* Rejected drawer */}
        <div className="rounded-md border border-border bg-card max-md:order-5">
          <button
            type="button"
            onClick={() => setShowRejected((s) => !s)}
            className="w-full flex items-center justify-between p-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span>{t('myTasks.rejectedDrawer.toggle', { count: rejected.length })}</span>
            {showRejected ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showRejected && (
            <div className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {rejected.length === 0 && (
                <p className="text-xs text-muted-foreground col-span-full">{t('myTasks.rejectedDrawer.empty')}</p>
              )}
              {rejected.map((c) => (
                <TaskCard key={c._id} card={c} onPreview={onPreview} />
              ))}
            </div>
          )}
        </div>

        {/* Sticky bulk toolbar */}
        {selected.size > 0 && (
          <div className="sticky bottom-3 z-30 flex justify-center px-4 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card shadow-lg px-4 py-2 flex-wrap">
              <CheckCircle2 size={14} className="text-primary" />
              <span className="text-sm">
                {t('myTasks.bulkToolbar.selected')} <span className="font-semibold">{selected.size}</span>
              </span>
              {selectedColumns.size > 1 ? (
                <span className="text-xs text-muted-foreground italic">{t('myTasks.bulkToolbar.mixedColumns')}</span>
              ) : (
                <>
                  {bulkActions.includes(DesignerTransitionAction.Start) && (
                    <Button size="sm" onClick={() => callBulk(DesignerTransitionAction.Start)}>
                      <PlayCircle size={14} /> {t('myTasks.bulkToolbar.start')}
                    </Button>
                  )}
                  {bulkActions.includes(DesignerTransitionAction.Restart) && (
                    <Button size="sm" onClick={() => callBulk(DesignerTransitionAction.Restart)}>
                      <RotateCcw size={14} /> {t('myTasks.bulkToolbar.restart')}
                    </Button>
                  )}
                  {bulkActions.includes(DesignerTransitionAction.Complete) && (
                    <Button size="sm" onClick={() => callBulk(DesignerTransitionAction.Complete)}>
                      <CheckCircle2 size={14} /> {t('myTasks.bulkToolbar.complete')}
                    </Button>
                  )}
                  {bulkActions.includes(DesignerTransitionAction.Reject) && (
                    <Button size="sm" variant="destructive" onClick={() => setBulkReject(true)}>
                      <XCircle size={14} /> {t('myTasks.bulkToolbar.reject')}
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

        <RejectModal
          open={!!rejectTarget || bulkReject}
          productionId={bulkReject ? t('myTasks.rejectBulkTarget', { count: selected.size }) : rejectTarget?.productionId}
          onClose={() => {
            setRejectTarget(null);
            setBulkReject(false);
          }}
          onConfirm={(reason, targetUserId) =>
            bulkReject ? handleBulkReject(reason, targetUserId) : handleSingleReject(reason, targetUserId)
          }
          ownerUserId={effectiveViewUserId || undefined}
        />
        <TaskDetailDialog orderId={detailId} onClose={() => setDetailId(null)} />
        <ImagePreviewDialog
          open={!!preview}
          onOpenChange={(o) => !o && setPreview(null)}
          url={preview?.url}
          originalUrl={preview?.original}
          title={preview?.title}
        />
      </div>
    </TooltipProvider>
  );
}

// Thứ tự ưu tiên size để các đơn cùng size đứng cạnh nhau trong mỗi nhóm sản phẩm.
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
const SIZE_ALIAS: Record<string, string> = {
  XXL: '2XL',
  XXXL: '3XL',
  XXXXL: '4XL',
  XXXXXL: '5XL',
};
function sizeRank(size?: string): number {
  if (!size) return SIZE_ORDER.length + 1; // không có size → dồn cuối
  const raw = size.trim().toUpperCase();
  const norm = SIZE_ALIAS[raw] || raw;
  const i = SIZE_ORDER.indexOf(norm);
  return i === -1 ? SIZE_ORDER.length : i; // size lạ → trước nhóm "không có size"
}

function groupByType(cards: DesignerTaskCard[], noTypeLabel: string): [string, DesignerTaskCard[]][] {
  const map = new Map<string, DesignerTaskCard[]>();
  for (const r of cards) {
    const k = r.type || noTypeLabel;
    const arr = map.get(k) || [];
    arr.push(r);
    map.set(k, arr);
  }
  // Trong mỗi nhóm sản phẩm: sắp xếp theo size ưu tiên XS→5XL (size giống nhau
  // đứng cạnh nhau). Array.sort ổn định nên cùng size vẫn giữ thứ tự ngày từ BE.
  for (const [, arr] of map) {
    arr.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function KPI({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${accent}`}>{value}</p>
    </div>
  );
}

interface ColProps {
  colKey: ColKey;
  meta: ColMeta;
  cards: DesignerTaskCard[];
  selected: Set<string>;
  activeDragId?: string;
  onCheckCard: (id: string, checked: boolean, withShift: boolean) => void;
  onCheckGroup: (rows: DesignerTaskCard[], checked: boolean) => void;
  onClickId: (id: string) => void;
  onPreview: (url: string, title: string, original?: string) => void;
  onRejectCard: (card: DesignerTaskCard) => void;
}

function Column({
  colKey,
  meta,
  cards,
  selected,
  activeDragId,
  onCheckCard,
  onCheckGroup,
  onClickId,
  onPreview,
  onRejectCard,
}: ColProps) {
  const { t } = useTranslation('designerTaskWorkflow');
  const { setNodeRef, isOver } = useDroppable({ id: colKey });
  const groups = useMemo(() => groupByType(cards, t('myTasks.noType')), [cards, t]);

  // Mặc định mở tất cả group; user click header để collapse/expand riêng từng cái.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (type: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-md border-2 ${meta.accent} bg-muted/30 p-2.5 transition-colors min-h-[200px] flex flex-col gap-2 max-md:min-h-0 max-md:border-0 max-md:bg-transparent max-md:p-0 ${
        isOver ? 'bg-muted/60' : ''
      }`}
    >
      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
        <span>{meta.label}</span>
        <span className="text-muted-foreground">{cards.length}</span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto max-h-[calc(100vh-380px)] max-md:max-h-none max-md:overflow-visible">
        {cards.length === 0 && (
          <div className="text-[11px] text-muted-foreground italic text-center py-6">{t('myTasks.column.empty')}</div>
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
                title={isCollapsed ? t('myTasks.column.expand') : t('myTasks.column.collapse')}
              >
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
                {isCollapsed ? (
                  <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate" title={type}>
                  {type}
                </span>
                <span className="text-muted-foreground font-normal">
                  {selCount}/{rows.length}
                </span>
              </div>

              {!isCollapsed && (
                <div className="space-y-2 pl-2 pr-2 border-l-2 border-border/40 ml-2.5">
                  {rows.map((c) => {
                    const checked = selected.has(c._id);
                    const isDragging = activeDragId === c._id;
                    return (
                      <div
                        key={c._id}
                        className={`relative group transition-opacity ${isDragging ? 'opacity-30' : ''}`}
                      >
                        {/* Checkbox góc — không can thiệp drag (sensor distance=6) */}
                        <div className="absolute top-1.5 left-1.5 z-10">
                          <input
                            type="checkbox"
                            checked={checked}
                            onClick={(e) => {
                              const me = e.nativeEvent as MouseEvent;
                              (e.currentTarget as HTMLInputElement & { __shift?: boolean }).__shift = me.shiftKey;
                            }}
                            onChange={(e) => {
                              const ws = (e.currentTarget as HTMLInputElement & { __shift?: boolean }).__shift || false;
                              onCheckCard(c._id, e.currentTarget.checked, ws);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="w-3.5 h-3.5 accent-indigo-500"
                          />
                        </div>

                        <div
                          className={
                            checked
                              ? 'rounded-md ring-1 ring-indigo-400/70 bg-indigo-50/40 dark:bg-indigo-500/5 transition-colors'
                              : 'transition-colors'
                          }
                        >
                          <TaskCard card={c} onPreview={onPreview} onClickProductionId={() => onClickId(c._id)} />
                        </div>

                        {(colKey === 'assigned' || colKey === 'inProgress') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRejectCard(c);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="absolute top-1 right-1 text-[10px] font-semibold text-rose-600 hover:text-rose-700 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 border border-rose-200 dark:border-rose-800 rounded px-1.5 py-0.5"
                            title={t('myTasks.rejectCardButton')}
                          >
                            {t('myTasks.rejectCardButtonShort')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
