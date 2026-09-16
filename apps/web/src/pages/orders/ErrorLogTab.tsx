import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { AlertTriangle, CheckCircle2, History } from 'lucide-react';
import type { FulfillmentStage, FulfillmentTransitionDto, ProductionOrder } from 'shared';
import {
  DesignerTransitionAction,
  FulfillmentStageStatus,
  FulfillmentTransitionAction,
  RoleType,
  WorkshopConfigCategory,
} from 'shared';
import { toast } from 'sonner';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';
import { useDesignerTeamStore } from '@/store/designerTeamStore';
import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { CancelledBadge } from '@/components/orders/CancelledBadge';
import { PriorityBadge } from '@/components/orders/cells/PrioritySelectCell';
import { HeldBadge } from '@/components/orders/HeldBadge';
import { OrderDetailDialog } from '@/components/orders/OrderDetailDialog';
import { OrderFilterBar, type OrderFilterFacet } from '@/components/orders/OrderFilterBar';
import { OrderLogTimelineDialog } from '@/components/orders/OrderLogTimelineDialog';
import { OrderRowActionsMenu } from '@/components/orders/OrderRowActionsMenu';
import {
  colLabel,
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
import { getStageLabel } from '@/utils/fulfillmentStageLabel';
import { isCancelled, isHeld } from '@/utils/orderActions';

import { useDebounce } from '@/hooks/useDebounce';
import { NO_TOOL_ROW_CLASS, useIsNoTool } from '@/hooks/useIsNoTool';
import { usePendingDesignsPoll } from '@/hooks/usePendingDesignsPoll';
import { usePermission } from '@/hooks/usePermission';
import { useSidebarResetSignal } from '@/hooks/useSidebarResetSignal';
import { ReworkBackDialog } from '@/pages/fulfillment/my-tasks/ReworkBackDialog';

type TimelineEntry = {
  stage?: string;
  action?: string;
  byUserName?: string;
  reworkTarget?: string;
  reason?: string;
};
type ErrorLogRow = WorkshopOrderRow & {
  productionFirstErrorAt?: string;
  productionErrorNote?: string;
  fulfillmentTimeline?: TimelineEntry[];
};
type UrgencyKey = 'new' | 'attention' | 'urgent' | 'critical';
type TabKey = 'todo' | 'done';

const DEFAULT_PAGE_SIZE = 30;

function buildUrgencyMeta(
  t: TFunction<'orderLog'>,
): Record<UrgencyKey, { label: string; cls: string; chipCls: string; ringCls: string }> {
  return {
    new: {
      label: t('urgency.new'),
      cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
      chipCls: 'bg-sky-50 border-sky-300 text-sky-700',
      ringCls: 'ring-sky-200',
    },
    attention: {
      label: t('urgency.attention'),
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      chipCls: 'bg-amber-50 border-amber-300 text-amber-700',
      ringCls: 'ring-amber-200',
    },
    urgent: {
      label: t('urgency.urgent'),
      cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
      chipCls: 'bg-orange-50 border-orange-300 text-orange-700',
      ringCls: 'ring-orange-200',
    },
    critical: {
      label: t('urgency.critical'),
      cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 animate-pulse',
      chipCls: 'bg-rose-50 border-rose-300 text-rose-700',
      ringCls: 'ring-rose-200',
    },
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Ngưỡng khẩn cấp theo GIỜ kể từ khi vào sản xuất (`inProductionAt`):
// Mới <2h · Cần làm 2–4h · Gấp 4–6h · Khẩn cấp >6h.
function urgencyOf(dateStr?: string): UrgencyKey {
  if (!dateStr) return 'new';
  const age = Date.now() - new Date(dateStr).getTime();
  if (age < 2 * HOUR_MS) return 'new';
  if (age < 4 * HOUR_MS) return 'attention';
  if (age < 6 * HOUR_MS) return 'urgent';
  return 'critical';
}

function formatDuration(dateStr?: string): string {
  if (!dateStr) return '—';
  const age = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(age / DAY_MS);
  const hours = Math.floor((age % DAY_MS) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((age % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDayOnly(d?: string): string {
  if (!d) return '—';
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

function stageLabel(key: string | undefined, t: TFunction<'orderLog'>): string {
  if (!key) return '—';
  if (key === 'designer') return t('stage.designer');
  if (key === 'tool-check') return t('stage.toolCheck');
  const fl = getStageLabel(t, key);
  if (fl !== key) return fl;
  return key;
}

// Chặng đơn ĐANG đứng (positional) — suy như getLifecycleTrack.
function currentStageInfo(row: ErrorLogRow, t: TFunction<'orderLog'>): { key: string; label: string } {
  if (row.productionErrorSource === 'tool-check' && row.toolResultNote === 'error') {
    return { key: 'tool-check', label: t('stage.toolCheck') };
  }
  if (row.designerStatus === 'rework') return { key: 'designer', label: t('stage.designer') };
  if (row.currentFulfillmentStage) {
    return { key: row.currentFulfillmentStage, label: stageLabel(row.currentFulfillmentStage, t) };
  }
  if (row.designerStatus === 'assigned' || row.designerStatus === 'in-progress') {
    return { key: 'designer', label: t('stage.designer') };
  }
  return { key: '', label: '—' };
}

// Chặng NÊU lỗi (reporter) + người báo — từ timeline rework-back gần nhất.
function reporterInfo(row: ErrorLogRow, t: TFunction<'orderLog'>): { label: string; who: string } | null {
  const tl = row.fulfillmentTimeline || [];
  for (let i = tl.length - 1; i >= 0; i--) {
    if (tl[i].action === 'rework-back') {
      return { label: stageLabel(tl[i].stage, t), who: tl[i].byUserName || '' };
    }
  }
  return null;
}

// Ghi chú lỗi người báo nhập — ưu tiên reason của rework-back gần nhất, fallback
// `productionErrorNote` (lỗi set trực tiếp không qua rework-back).
function errorNote(row: ErrorLogRow): string {
  const tl = row.fulfillmentTimeline || [];
  for (let i = tl.length - 1; i >= 0; i--) {
    if (tl[i].action === 'rework-back' && tl[i].reason) return tl[i].reason as string;
  }
  return row.productionErrorNote || '';
}

export function ErrorLogTab() {
  const { t } = useTranslation('orderLog');
  const { t: tOrders } = useTranslation('orders');
  const URGENCY_META = useMemo(() => buildUrgencyMeta(t), [t]);
  const { canEditField, canViewField, roleName } = usePermission();
  const profile = useAuthStore((s) => s.profile);
  const myStage = profile?.fulfillmentStage as FulfillmentStage | undefined;
  const myFactoryId = profile?.factoryId;
  const myUserId = profile?._id ? String(profile._id) : '';

  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);
  const productionErrorConfigs = useWorkshopConfigStore((s) => s.byCategory[WorkshopConfigCategory.ProductionError]);
  const fabricConfigs = useWorkshopConfigStore((s) => s.byCategory[WorkshopConfigCategory.FabricType]);
  const toolResultConfigs = useWorkshopConfigStore((s) => s.byCategory[WorkshopConfigCategory.ToolResult]);
  const loadDesignerTeam = useDesignerTeamStore((s) => s.fetch);
  const designerMembers = useDesignerTeamStore((s) => s.members);

  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems] = useState<ErrorLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [byUrgency, setByUrgency] = useState({ new: 0, attention: 0, urgent: 0, critical: 0 });
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState<TabKey>(() => (searchParams.get('etab') === 'done' ? 'done' : 'todo'));
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('epage'));
    return Number.isFinite(p) && p > 0 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const s = Number(searchParams.get('esize'));
    return Number.isFinite(s) && s > 0 ? s : DEFAULT_PAGE_SIZE;
  });
  const [search, setSearch] = useState(() => searchParams.get('esearch') || '');
  const debouncedSearch = useDebounce(search, 300);

  const [createdFrom, setCreatedFrom] = useState(() => searchParams.get('efrom') || '');
  const [createdTo, setCreatedTo] = useState(() => searchParams.get('eto') || '');

  const [filterAssignee, setFilterAssignee] = useState(() => searchParams.get('eassign') || '');
  const [filterFabric, setFilterFabric] = useState(() => searchParams.get('efabric') || '');
  const [filterTool, setFilterTool] = useState(() => searchParams.get('etool') || '');
  const [filterErrorCode, setFilterErrorCode] = useState(() => searchParams.get('ecode') || '');
  const [filterSource, setFilterSource] = useState(() => searchParams.get('esource') || '');
  const [filterUrgency, setFilterUrgency] = useState(() => searchParams.get('eurg') || '');
  const [historyTarget, setHistoryTarget] = useState<{ id: string; productionId: string } | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ id: string; productionId: string } | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    originalUrl?: string;
    title: string;
    sourceUrl?: string;
  } | null>(null);
  const [reworkOrder, setReworkOrder] = useState<ErrorLogRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResolving, setBulkResolving] = useState(false);

  const clearAllFilters = () => {
    setTab('todo');
    setSearch('');
    setCreatedFrom('');
    setCreatedTo('');
    setFilterAssignee('');
    setFilterFabric('');
    setFilterTool('');
    setFilterErrorCode('');
    setFilterSource('');
    setFilterUrgency('');
    setSelected(new Set());
    setPage(1);
  };

  // Click lại menu "Nhật ký bù lỗi" ở sidebar khi đang đứng đúng trang này →
  // xóa hết filter (xem `useSidebarResetSignal`).
  useSidebarResetSignal(PATHS.ORDERS_ERROR_LOG, clearAllFilters);

  useEffect(() => {
    if (!configLoaded) loadConfig();
    loadDesignerTeam();
  }, [configLoaded, loadConfig, loadDesignerTeam]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        tab === 'done' ? sp.set('etab', 'done') : sp.delete('etab');
        search ? sp.set('esearch', search) : sp.delete('esearch');
        filterAssignee ? sp.set('eassign', filterAssignee) : sp.delete('eassign');
        filterFabric ? sp.set('efabric', filterFabric) : sp.delete('efabric');
        filterTool ? sp.set('etool', filterTool) : sp.delete('etool');
        filterErrorCode ? sp.set('ecode', filterErrorCode) : sp.delete('ecode');
        filterSource ? sp.set('esource', filterSource) : sp.delete('esource');
        filterUrgency ? sp.set('eurg', filterUrgency) : sp.delete('eurg');
        createdFrom ? sp.set('efrom', createdFrom) : sp.delete('efrom');
        createdTo ? sp.set('eto', createdTo) : sp.delete('eto');
        page > 1 ? sp.set('epage', String(page)) : sp.delete('epage');
        pageSize !== DEFAULT_PAGE_SIZE ? sp.set('esize', String(pageSize)) : sp.delete('esize');
        return sp;
      },
      { replace: true },
    );
  }, [
    tab,
    search,
    filterAssignee,
    filterFabric,
    filterTool,
    filterErrorCode,
    filterSource,
    filterUrgency,
    createdFrom,
    createdTo,
    page,
    pageSize,
    setSearchParams,
  ]);

  const fetchData = async () => {
    const params = new URLSearchParams();
    params.set('tab', tab);
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    if (filterAssignee) params.set('assignee', filterAssignee);
    if (filterFabric) params.set('fabricType', filterFabric);
    if (filterTool) params.set('toolResult', filterTool);
    if (filterErrorCode) params.set('productionError', filterErrorCode);
    if (filterSource) params.set('productionErrorSource', filterSource);
    if (filterUrgency) params.set('urgency', filterUrgency);
    if (createdFrom) params.set('createdFrom', createdFrom);
    if (createdTo) params.set('createdTo', createdTo);
    params.set('page', String(page));
    params.set('limit', String(pageSize));
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await RepositoryRemote.order.getErrorLog('?' + params.toString());
      setItems((res.data?.data || []) as ErrorLogRow[]);
      setTotal(Number(res.data?.total || 0));
      setByUrgency((res.data?.byUrgency as typeof byUrgency) || { new: 0, attention: 0, urgent: 0, critical: 0 });
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    page,
    pageSize,
    debouncedSearch,
    filterAssignee,
    filterFabric,
    filterTool,
    filterErrorCode,
    filterSource,
    filterUrgency,
    createdFrom,
    createdTo,
  ]);

  const patchRow = (id: string, patch: Partial<ErrorLogRow>) => {
    setItems((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  };

  usePendingDesignsPoll(items, patchRow);

  const openPreview = (url: string, title: string, originalUrl?: string, sourceUrl?: string) =>
    setPreview({ url, originalUrl, title, sourceUrl });

  const openDetail = (orderId: string, productionId: string) => setDetailTarget({ id: orderId, productionId });

  const renderCtx: WorkshopRenderCtx = { canEditField, patchRow, openPreview, openDetail, t: tOrders };
  const isNoTool = useIsNoTool();

  const designerNameById = useMemo(
    () => new Map((designerMembers || []).map((m) => [String(m._id), String(m.fullName || m.email || m._id)])),
    [designerMembers],
  );

  const fixerName = (row: ErrorLogRow): string => {
    const cur = currentStageInfo(row, t);
    if (cur.key === 'designer') return row.assignee ? designerNameById.get(String(row.assignee)) || '—' : '—';
    if (cur.key === 'tool-check') return 'Support';
    if (cur.key) {
      const tl = row.fulfillmentTimeline || [];
      for (let i = tl.length - 1; i >= 0; i--) {
        if (tl[i].stage === cur.key && tl[i].byUserName) return tl[i].byUserName as string;
      }
    }
    return '—';
  };

  // ─── Thao tác theo role/chặng ───
  const refetch = () => fetchData();

  const doFulfillment = async (
    orderId: string,
    action: FulfillmentTransitionAction,
    body?: Pick<FulfillmentTransitionDto, 'target' | 'reason'>,
  ) => {
    if (!myStage) return;
    try {
      await RepositoryRemote.fulfillment.transition(orderId, {
        stage: myStage,
        action,
        ...body,
      } as FulfillmentTransitionDto);
      toast.success(t('actions.updated'));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      refetch();
    }
  };

  const doDesigner = async (orderId: string, action: DesignerTransitionAction) => {
    try {
      await RepositoryRemote.designer.transition(orderId, { action });
      toast.success(t('actions.updated'));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      refetch();
    }
  };

  const doSupportOk = async (orderId: string) => {
    try {
      await RepositoryRemote.order.updateField(orderId, { field: 'toolResultNote', value: 'ok' });
      toast.success(t('actions.markedToolCheckOk'));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      refetch();
    }
  };

  // Admin/Manager: đánh dấu hoàn thành lỗi tồn đọng → đơn rời tab "Cần xử lý".
  const doResolveError = async (orderId: string) => {
    try {
      await RepositoryRemote.order.resolveError(orderId);
      toast.success(t('actions.markedErrorResolved'));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      refetch();
    }
  };

  const isAdminRole = roleName === RoleType.SuperAdmin || roleName === RoleType.Admin || roleName === RoleType.Manager;
  const canBulk = tab === 'todo' && isAdminRole;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allSelected = items.length > 0 && items.every((r) => selected.has(r._id));
  const toggleAll = () =>
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((r) => r._id))));

  const doBulkResolve = async () => {
    if (selected.size === 0) return;
    try {
      setBulkResolving(true);
      const res = await RepositoryRemote.order.bulkResolveError(Array.from(selected));
      toast.success(t('actions.markedCompletedCount', { count: res.data?.data?.modified ?? selected.size }));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setBulkResolving(false);
      refetch();
    }
  };

  // Nút thao tác nếu đơn thuộc CHẶNG của viewer; null → hàng xám (read-only).
  const renderActionButtons = (row: ErrorLogRow): React.ReactNode => {
    if (isHeld(row) || isCancelled(row)) return null;

    if (
      roleName === RoleType.Fulfillment &&
      myStage &&
      row.currentFulfillmentStage === myStage &&
      String(row.factoryId ?? '') === String(myFactoryId ?? '')
    ) {
      const status = row.fulfillmentStages?.[myStage]?.status;
      if (status !== FulfillmentStageStatus.InProgress && status !== FulfillmentStageStatus.Done) {
        return (
          <>
            <Button
              size="sm"
              className="whitespace-nowrap"
              onClick={() => void doFulfillment(row._id, FulfillmentTransitionAction.Start)}
            >
              {t('actions.start')}
            </Button>
            {status && (
              <Button size="sm" variant="destructive" className="whitespace-nowrap" onClick={() => setReworkOrder(row)}>
                {t('actions.reportError')}
              </Button>
            )}
          </>
        );
      }
      if (status === FulfillmentStageStatus.InProgress) {
        return (
          <>
            <Button
              size="sm"
              className="whitespace-nowrap"
              onClick={() => void doFulfillment(row._id, FulfillmentTransitionAction.Complete)}
            >
              {t('actions.complete')}
            </Button>
            <Button size="sm" variant="destructive" className="whitespace-nowrap" onClick={() => setReworkOrder(row)}>
              {t('actions.reportError')}
            </Button>
          </>
        );
      }
      return null;
    }

    if (
      (roleName === RoleType.Designer || roleName === RoleType.DesignerLeader) &&
      myUserId &&
      String(row.assignee ?? '') === myUserId
    ) {
      const ds = row.designerStatus;
      if (ds === 'assigned' || ds === 'rework') {
        return (
          <Button
            size="sm"
            className="whitespace-nowrap"
            onClick={() => void doDesigner(row._id, DesignerTransitionAction.Start)}
          >
            {t('actions.start')}
          </Button>
        );
      }
      if (ds === 'in-progress') {
        return (
          <Button
            size="sm"
            className="whitespace-nowrap"
            onClick={() => void doDesigner(row._id, DesignerTransitionAction.Complete)}
          >
            {t('actions.complete')}
          </Button>
        );
      }
      return null;
    }

    if (roleName === RoleType.Support && row.productionErrorSource === 'tool-check' && row.toolResultNote === 'error') {
      return (
        <Button size="sm" className="whitespace-nowrap" onClick={() => void doSupportOk(row._id)}>
          {t('actions.toolCheckOk')}
        </Button>
      );
    }

    // Admin/Manager: read-only theo chặng nhưng được "đánh dấu hoàn thành" đơn
    // tồn đọng (chỉ tab Cần xử lý).
    if (
      tab === 'todo' &&
      (roleName === RoleType.SuperAdmin || roleName === RoleType.Admin || roleName === RoleType.Manager)
    ) {
      return (
        <Button size="sm" variant="outline" className="whitespace-nowrap" onClick={() => void doResolveError(row._id)}>
          <CheckCircle2 size={13} /> {t('actions.markDone')}
        </Button>
      );
    }

    return null;
  };

  // Bảng hẹp: productionId + mockup + designs + lỗi + nguồn lỗi. Các cột còn lại
  // (xưởng / chặng / nêu lỗi / người sửa) render riêng bên dưới.
  const visibleCols = useMemo(
    () =>
      WORKSHOP_COLS.filter((c) =>
        ['productionId', 'mockupTypeSize', 'designs', 'productionError', 'productionErrorSource'].includes(c.key),
      ).filter((c) => !c.perm || canViewField(c.key)),
    [canViewField],
  );

  const assigneeOptions = useMemo<Array<{ value: string; label: string; count: number }>>(() => {
    const base = (designerMembers || []).map((m) => ({
      value: String(m._id),
      label: String(m.fullName || m.email || m._id),
      count: 0,
    }));
    return [{ value: '__none__', label: tOrders('listTab.unassigned'), count: 0 }, ...base];
  }, [designerMembers, tOrders]);

  const fabricOptions = useMemo<Array<{ value: string; label: string; count: number }>>(
    () => (fabricConfigs || []).map((c) => ({ value: String(c.code), label: String(c.name), count: 0 })),
    [fabricConfigs],
  );
  const toolOptions = useMemo<Array<{ value: string; label: string; count: number }>>(
    () => (toolResultConfigs || []).map((c) => ({ value: String(c.code), label: String(c.name), count: 0 })),
    [toolResultConfigs],
  );
  const errorCodeOptions = useMemo<Array<{ value: string; label: string; count: number }>>(
    () => (productionErrorConfigs || []).map((c) => ({ value: String(c.code), label: String(c.name), count: 0 })),
    [productionErrorConfigs],
  );
  const sourceOptions = [
    { value: 'designer', label: t('filters.sourceDesigner'), count: 0 },
    { value: 'factory', label: t('filters.sourceFactory'), count: 0 },
  ];

  const toggleUrgency = (key: UrgencyKey) => {
    setFilterUrgency((prev) => (prev === key ? '' : key));
    setPage(1);
  };

  const totalErrors = byUrgency.new + byUrgency.attention + byUrgency.urgent + byUrgency.critical;
  const FIXED_COLS = 9; // Mức độ, Tuổi, Xưởng | Chặng, Nêu lỗi, Ghi chú lỗi, Người sửa, Số lần, Thao tác

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-rose-600" />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-foreground">{t('page.title')}</h2>
              <p className="text-xs text-muted-foreground">{t('page.description')}</p>
            </div>
          </div>

          {/* Sub-tab Cần xử lý / Đã xong */}
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
            {(['todo', 'done'] as TabKey[]).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => {
                  setTab(tabKey);
                  setPage(1);
                }}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  tab === tabKey
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tabKey === 'todo' ? t('page.tabTodo') : t('page.tabDone')}
              </button>
            ))}
          </div>

          {tab === 'todo' && (
            <div className="flex flex-wrap items-center gap-2">
              {(['new', 'attention', 'urgent', 'critical'] as UrgencyKey[]).map((key) => {
                const meta = URGENCY_META[key];
                const active = filterUrgency === key;
                return (
                  <button
                    key={key}
                    onClick={() => toggleUrgency(key)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
                      meta.chipCls,
                      active && 'ring-2 ring-offset-1 ' + meta.ringCls,
                    )}
                  >
                    <span>{meta.label}</span>
                    <span className="font-mono">({byUrgency[key]})</span>
                  </button>
                );
              })}
              {filterUrgency && (
                <button
                  onClick={() => {
                    setFilterUrgency('');
                    setPage(1);
                  }}
                  className="text-[11px] text-muted-foreground underline hover:text-foreground"
                >
                  {t('page.clearUrgencyFilter')}
                </button>
              )}
              <span className="text-[11px] text-muted-foreground ml-1">
                {t('page.totalToProcess', { count: totalErrors })}
              </span>
            </div>
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
          onReload={() => fetchData()}
          loading={loading}
          facets={
            [
              {
                key: 'assignee',
                label: tOrders('workshopCols.col.assignee'),
                value: filterAssignee,
                onChange: (v) => {
                  setFilterAssignee(v);
                  setPage(1);
                },
                options: assigneeOptions,
                perm: 'order.field.assignee.view',
              },
              {
                key: 'fabricType',
                label: tOrders('tableWorkshop.facets.fabricType'),
                value: filterFabric,
                onChange: (v) => {
                  setFilterFabric(v);
                  setPage(1);
                },
                options: fabricOptions,
                perm: 'order.field.fabricType.view',
              },
              {
                key: 'toolResult',
                label: tOrders('tableWorkshop.facets.toolResult'),
                value: filterTool,
                onChange: (v) => {
                  setFilterTool(v);
                  setPage(1);
                },
                options: toolOptions,
                perm: 'order.field.toolResult.view',
              },
              {
                key: 'productionError',
                label: t('filters.errorCode'),
                value: filterErrorCode,
                onChange: (v) => {
                  setFilterErrorCode(v);
                  setPage(1);
                },
                options: errorCodeOptions,
              },
              {
                key: 'productionErrorSource',
                label: t('filters.errorSource'),
                value: filterSource,
                onChange: (v) => {
                  setFilterSource(v);
                  setPage(1);
                },
                options: sourceOptions,
              },
            ] satisfies OrderFilterFacet[]
          }
        />

        <PaginationBar
          position="top"
          page={page}
          pageSize={pageSize}
          total={total}
          loading={loading}
          pageSizeOptions={[10, 20, 30, 50, 100]}
          onChange={(p, ps) => {
            setPage(p);
            setPageSize(ps);
          }}
        />

        <LoadingOverlay
          active={loading && items.length > 0}
          className="rounded-lg border border-border bg-card overflow-hidden"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {canBulk && (
                    <TableHead className="w-[36px]">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        title={t('table.selectAllOnPage')}
                      />
                    </TableHead>
                  )}
                  <TableHead className="whitespace-nowrap text-xs w-[120px]">{t('table.urgency')}</TableHead>
                  <TableHead className="whitespace-nowrap text-xs w-[120px]">{t('table.orderAge')}</TableHead>
                  <TableHead className="whitespace-nowrap text-xs w-[70px]">{t('table.factory')}</TableHead>
                  {visibleCols.map((c) => (
                    <TableHead key={c.key} className={cn('whitespace-nowrap text-xs', c.width)}>
                      {colLabel(tOrders, c.key, c.label)}
                    </TableHead>
                  ))}
                  <TableHead className="whitespace-nowrap text-xs w-[110px]">{t('table.currentStage')}</TableHead>
                  <TableHead className="whitespace-nowrap text-xs w-[140px]">{t('table.reporter')}</TableHead>
                  <TableHead className="whitespace-nowrap text-xs w-[200px]">{t('table.errorNote')}</TableHead>
                  <TableHead className="whitespace-nowrap text-xs w-[110px]">{t('table.fixer')}</TableHead>
                  <TableHead className="whitespace-nowrap text-xs w-[70px]">{t('table.errorCount')}</TableHead>
                  <TableHead className="whitespace-nowrap text-xs w-[160px] sticky right-0 z-20 bg-card"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={visibleCols.length + FIXED_COLS + (canBulk ? 1 : 0)}
                      className="text-center py-10"
                    >
                      <Spinner size={20} className="text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={visibleCols.length + FIXED_COLS + (canBulk ? 1 : 0)}
                      className="text-center py-10 text-sm text-muted-foreground"
                    >
                      {tab === 'todo' ? t('table.emptyTodo') : t('table.emptyDone')}
                    </TableCell>
                  </TableRow>
                )}
                {items.map((row) => {
                  const urg = urgencyOf(row.inProductionAt);
                  const meta = URGENCY_META[urg];
                  const held = isHeld(row);
                  const cancelled = isCancelled(row);
                  const actionNode = renderActionButtons(row);
                  const greyed = held || cancelled || actionNode === null;
                  const rowCtx = greyed ? { ...renderCtx, canEditField: () => false } : renderCtx;
                  const cur = currentStageInfo(row, t);
                  const rep = reporterInfo(row, t);
                  return (
                    <TableRow
                      key={row._id}
                      className={cn(
                        isNoTool(row.toolResult) && NO_TOOL_ROW_CLASS,
                        greyed && !canBulk && 'opacity-50',
                        canBulk && selected.has(row._id) && 'bg-primary/5',
                      )}
                    >
                      {canBulk && (
                        <TableCell className="py-2">
                          <input type="checkbox" checked={selected.has(row._id)} onChange={() => toggleOne(row._id)} />
                        </TableCell>
                      )}
                      <TableCell className="py-2">
                        {/* Nhãn ưu tiên (badge read-only dùng chung kanban/ToolCheckTab)
                          xếp trên badge mức độ — đơn ưu tiên được sort lên đầu. */}
                        <div className="flex flex-col gap-1 items-start">
                          <PriorityBadge priority={row.priority} />
                          <Badge className={cn('font-mono text-[11px]', meta.cls)}>{meta.label}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex flex-col leading-tight">
                          <span className="text-xs font-mono font-semibold text-foreground">
                            {formatDuration(row.inProductionAt)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {t('table.enteredProductionAt', { date: formatDayOnly(row.inProductionAt) })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          {row.factory?.shortName || row.factory?.name || '—'}
                        </span>
                      </TableCell>
                      {visibleCols.map((c) => (
                        <TableCell key={c.key} className="py-2">
                          {c.key === 'productionId' && (held || cancelled) ? (
                            <div className="flex items-center gap-1.5">
                              {cancelled ? (
                                <CancelledBadge reason={row.cancelReason} />
                              ) : (
                                <HeldBadge reason={row.holdReason} source={row.holdSource} />
                              )}
                              <div className="min-w-0 flex-1">{c.render(row, rowCtx)}</div>
                            </div>
                          ) : (
                            c.render(row, rowCtx)
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="py-2">
                        <Badge variant="secondary" className="text-[11px] whitespace-nowrap">
                          {cur.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        {rep ? (
                          <div className="flex flex-col leading-tight">
                            <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                              {rep.label}
                            </span>
                            {rep.who && <span className="text-[10px] text-muted-foreground truncate">{rep.who}</span>}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 max-w-[200px]">
                        {(() => {
                          const note = errorNote(row);
                          return note ? (
                            <span
                              className="text-[11px] text-foreground line-clamp-2 whitespace-pre-wrap break-words"
                              title={note}
                            >
                              {note}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="py-2">
                        <span className="text-[11px] text-foreground truncate">{fixerName(row)}</span>
                      </TableCell>
                      <TableCell className="py-2 text-center">
                        <Badge variant="secondary" className="font-mono text-[11px] bg-rose-100 text-rose-700">
                          ×{row.productionErrorCount || 1}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 sticky right-0 z-10 bg-card shadow-[-1px_0_0_0_var(--border)]">
                        <div className="flex items-center justify-end gap-0.5">
                          {actionNode}
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('table.history')}
                            onClick={() => setHistoryTarget({ id: row._id, productionId: row.productionId })}
                          >
                            <History size={13} className="text-muted-foreground" />
                          </Button>
                          <OrderRowActionsMenu order={row} onChanged={() => fetchData()} />
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
            loading={loading}
            pageSizeOptions={[10, 20, 30, 50, 100]}
            onChange={(p, ps) => {
              setPage(p);
              setPageSize(ps);
            }}
          />
        </LoadingOverlay>

        {canBulk && selected.size > 0 && (
          <div className="sticky bottom-3 z-30 flex justify-center px-4 pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card shadow-lg px-4 py-2">
              <span className="text-sm">
                {t('table.selectedLabel')} <span className="font-semibold">{selected.size}</span>
              </span>
              <Button size="sm" onClick={() => void doBulkResolve()} disabled={bulkResolving}>
                {bulkResolving ? <Spinner size={13} className="mr-1.5" /> : <CheckCircle2 size={14} />}
                {t('table.markDoneCount', { count: selected.size })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t('table.deselect')}
              </Button>
            </div>
          </div>
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

        {reworkOrder && myStage && (
          <ReworkBackDialog
            order={reworkOrder as unknown as ProductionOrder}
            myStage={myStage}
            onClose={() => setReworkOrder(null)}
            onSubmit={async (target, reason) => {
              await doFulfillment(reworkOrder._id, FulfillmentTransitionAction.ReworkBack, { target, reason });
              setReworkOrder(null);
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
