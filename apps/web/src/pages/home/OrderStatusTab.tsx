import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Printer,
  Sparkles,
  TrendingUp,
  Truck,
  Wrench,
} from 'lucide-react';
import type { OrderStatusOverview } from 'shared';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { OrderFilterBar } from '@/components/orders/OrderFilterBar';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

import { BreakdownCard } from './status/BreakdownCard';
import { KpiCard } from './status/KpiCard';
import { OrdersMiniTable } from './status/OrdersMiniTable';
import { StatusActiveChips, StatusFilterTopActions } from './status/StatusFilterExtras';
import { useStatusFilter } from './status/useStatusFilter';

type KpiKey =
  | 'total'
  | 'today'
  | 'pendingToolOk'
  | 'ready'
  | 'done'
  | 'errors'
  | 'designerQueue'
  | 'designerDone'
  | 'fulfillReady';

const ICONS: Record<KpiKey, LucideIcon> = {
  total: ClipboardList,
  today: CalendarDays,
  pendingToolOk: Wrench,
  ready: Truck,
  done: Printer,
  errors: AlertTriangle,
  designerQueue: Sparkles,
  designerDone: CheckCircle2,
  fulfillReady: TrendingUp,
};

export default function OrderStatusTab() {
  const { t } = useTranslation('dashboard');
  const { roleName, isAdmin, has, canViewField } = usePermission();
  const { filter, queryString, isActive, toggle, setScalar, setHasError, clearAll } = useStatusFilter();
  const [search, setSearchLocal] = useState<string>(filter.search || '');

  // Sync search → URL through useStatusFilter, debounce 300ms tránh refetch
  // mỗi keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setScalar('search', search || undefined);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, setScalar]);

  const [overview, setOverview] = useState<OrderStatusOverview | null>(null);
  const [loading, setLoading] = useState(false);

  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);

  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      const res = await RepositoryRemote.order.getStatusOverview(queryString);
      setOverview((res.data?.data || null) as OrderStatusOverview | null);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  // ─── KPI cards per role ───────────────────────────────────────
  const kpis = useMemo(() => {
    const totals = overview?.totals;
    if (!totals) return [];

    if (roleName === 'Designer') {
      return [
        {
          key: 'designerQueue' as KpiKey,
          label: t('statusTab.kpi.needCheck'),
          value: totals.pendingToolOk,
          hint: t('statusTab.kpi.notOkYet'),
          accent: 'warning' as const,
          icon: ICONS.designerQueue,
        },
        {
          key: 'designerDone' as KpiKey,
          label: t('statusTab.kpi.okToday'),
          value: totals.today - totals.pendingToolOk > 0 ? totals.today - totals.pendingToolOk : 0,
          hint: t('statusTab.kpi.markedOk'),
          accent: 'success' as const,
          icon: ICONS.designerDone,
        },
        {
          key: 'errors' as KpiKey,
          label: t('statusTab.kpi.errorOrders'),
          value: totals.errors,
          hint: t('statusTab.kpi.needsHandling'),
          accent: 'danger' as const,
          icon: ICONS.errors,
        },
        {
          key: 'total' as KpiKey,
          label: t('statusTab.kpi.totalRange'),
          value: totals.total,
          accent: 'default' as const,
          icon: ICONS.total,
        },
      ];
    }

    if (roleName === 'Fulfillment') {
      return [
        {
          key: 'fulfillReady' as KpiKey,
          label: t('statusTab.kpi.readyToPrint'),
          value: totals.readyForFulfill,
          hint: 'readyForFulfill=true',
          accent: 'primary' as const,
          icon: ICONS.fulfillReady,
        },
        {
          key: 'done' as KpiKey,
          label: t('statusTab.kpi.printed'),
          value: totals.done,
          hint: t('statusTab.kpi.printedOnMachines'),
          accent: 'success' as const,
          icon: ICONS.done,
        },
        {
          key: 'today' as KpiKey,
          label: t('statusTab.kpi.ordersToday'),
          value: totals.today,
          accent: 'default' as const,
          icon: ICONS.today,
        },
        {
          key: 'total' as KpiKey,
          label: t('statusTab.kpi.totalRange'),
          value: totals.total,
          accent: 'default' as const,
          icon: ICONS.total,
        },
      ];
    }

    // Admin / Manager / Support
    return [
      {
        key: 'total' as KpiKey,
        label: t('statusTab.kpi.totalOrders'),
        value: totals.total,
        accent: 'default' as const,
        icon: ICONS.total,
      },
      // { key: 'today' as KpiKey, label: 'Hôm nay', value: t.today, accent: 'primary' as const, icon: ICONS.today },
      {
        key: 'pendingToolOk' as KpiKey,
        label: t('statusTab.kpi.waitingToolOk'),
        value: totals.pendingToolOk,
        hint: t('statusTab.kpi.designerNotChecked'),
        accent: 'warning' as const,
        icon: ICONS.pendingToolOk,
      },
      {
        key: 'ready' as KpiKey,
        label: t('statusTab.kpi.readyToPrint'),
        value: totals.readyForFulfill,
        accent: 'primary' as const,
        icon: ICONS.ready,
      },
      {
        key: 'done' as KpiKey,
        label: t('statusTab.kpi.printed'),
        value: totals.done,
        accent: 'success' as const,
        icon: ICONS.done,
      },
      {
        key: 'errors' as KpiKey,
        label: t('statusTab.kpi.errorsNeedHandling'),
        value: totals.errors,
        accent: 'danger' as const,
        icon: ICONS.errors,
      },
    ];
  }, [overview, roleName, t]);

  // ─── Per-machine mini KPI for Fulfillment ─────────────────────
  const showMachineKpis = roleName === 'Fulfillment' && (overview?.totals.byMachine?.length || 0) > 0;

  // ─── Which breakdown cards to show (per-role + permission) ────
  const showPrintStatus = canViewField('printStatus');
  const showPrintNote = canViewField('printStatusNote');
  const showToolResult = canViewField('toolResult');
  const showToolNote = canViewField('toolResultNote');
  const showErrorFile = canViewField('errorFile');
  const showProductionError = canViewField('productionError');
  const showAssignee = canViewField('assignee');
  const showAssigneeNote = canViewField('assigneeNote');

  const isRefetching = loading && !!overview;

  return (
    <div className="space-y-4 relative">
      {/* Indeterminate top progress bar */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 h-0.5 overflow-hidden rounded-full bg-primary/10 pointer-events-none transition-opacity duration-200',
          loading ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="h-full w-1/4 bg-primary rounded-full animate-indeterminate-bar" />
      </div>

      {/* KPI Row */}
      <div
        className={cn(
          'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 transition-opacity duration-300',
          isRefetching && 'opacity-60',
        )}
      >
        {kpis.length > 0
          ? kpis.map((k) => (
              <KpiCard
                key={k.key}
                label={k.label}
                value={k.value}
                hint={k.hint}
                accent={k.accent}
                icon={k.icon}
                loading={loading && !overview}
              />
            ))
          : [0, 1, 2, 3, 4, 5].map((i) => (
              // Placeholder skeletons while overview loads (or when fetch
              // failed and overview is null) — prevents the page from
              // appearing blank.
              <KpiCard
                key={`__skeleton-${i}`}
                label={loading ? t('statusTab.loading') : t('statusTab.noData')}
                value={0}
                accent="default"
                loading={loading}
              />
            ))}
      </div>

      {/* Per-machine mini cards for Fulfill */}
      {showMachineKpis && overview?.totals.byMachine && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2">
          {overview.totals.byMachine.map((m) => (
            <KpiCard
              key={m.machineCode}
              label={m.machineName}
              value={m.printed}
              // hint={`${m.machineName}`}
              accent="success"
            />
          ))}
        </div>
      )}

      {/* Filter bar — đồng bộ position/layout với 3 bảng order khác. Field set
          giữ status-specific: search + date + reload + "Lỗi cần xử lý" toggle.
          Filter chính qua BreakdownCard grid (multi-select chip per facet) bên
          dưới — đó là USP của tab này, không thay được bằng dropdown đơn. */}
      <OrderFilterBar
        search={search}
        onSearchChange={setSearchLocal}
        createdFrom={filter.createdFrom}
        createdTo={filter.createdTo}
        onDateRangeChange={(f, t2) => {
          setScalar('createdFrom', f || undefined);
          setScalar('createdTo', t2 || undefined);
        }}
        onReload={fetchOverview}
        loading={loading}
        topActionsRight={
          <StatusFilterTopActions
            hasError={filter.hasError}
            isActive={isActive}
            onHasError={setHasError}
            onClearAll={() => {
              clearAll();
              setSearchLocal('');
            }}
          />
        }
        middleRow={<StatusActiveChips filter={filter} onToggle={toggle} />}
      />

      {/* Breakdown grid */}
      {overview && (
        <div
          className={cn(
            'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 transition-opacity duration-300',
            isRefetching && 'opacity-60',
          )}
        >
          {showPrintStatus && overview.breakdown.printStatus.length > 0 && (
            <BreakdownCard
              title={t('statusFilter.category.printStatus')}
              items={overview.breakdown.printStatus}
              selectedCodes={filter.printStatus}
              onToggle={(c) => toggle('printStatus', c)}
              mode="color"
            />
          )}
          {showPrintNote && overview.breakdown.printStatusNote.length > 0 && (
            <BreakdownCard
              title={t('statusFilter.category.printStatusNote')}
              items={overview.breakdown.printStatusNote}
              selectedCodes={filter.printStatusNote}
              onToggle={(c) => toggle('printStatusNote', c)}
              mode="icon"
            />
          )}
          {showToolResult && overview.breakdown.toolResult.length > 0 && (
            <BreakdownCard
              title={t('statusFilter.category.toolResult')}
              items={overview.breakdown.toolResult}
              selectedCodes={filter.toolResult}
              onToggle={(c) => toggle('toolResult', c)}
              mode="icon"
            />
          )}
          {showToolNote && overview.breakdown.toolResultNote.length > 0 && (
            <BreakdownCard
              title={t('statusFilter.category.toolResultNote')}
              items={overview.breakdown.toolResultNote}
              selectedCodes={filter.toolResultNote}
              onToggle={(c) => toggle('toolResultNote', c)}
              mode="color"
            />
          )}
          {showErrorFile && overview.breakdown.errorFile.length > 0 && (
            <BreakdownCard
              title={t('statusFilter.category.errorFile')}
              items={overview.breakdown.errorFile}
              selectedCodes={filter.errorFile}
              onToggle={(c) => toggle('errorFile', c)}
              mode="icon"
            />
          )}
          {showProductionError && overview.breakdown.productionError.length > 0 && (
            <BreakdownCard
              title={t('statusFilter.category.productionError')}
              items={overview.breakdown.productionError}
              selectedCodes={filter.productionError}
              onToggle={(c) => toggle('productionError', c)}
              mode="color"
            />
          )}
          {showAssignee && overview.breakdown.assignee.length > 0 && (
            <BreakdownCard
              title={t('statusFilter.category.assignee')}
              items={overview.breakdown.assignee}
              selectedCodes={filter.assignee}
              onToggle={(c) => toggle('assignee', c)}
              mode="icon"
            />
          )}
          {showAssigneeNote && overview.breakdown.assigneeNote.length > 0 && (
            <BreakdownCard
              title={t('statusFilter.category.assigneeNote')}
              items={overview.breakdown.assigneeNote}
              selectedCodes={filter.assigneeNote}
              onToggle={(c) => toggle('assigneeNote', c)}
              mode="icon"
            />
          )}

          {/* Factory / MachineType — admin-level breakdowns */}
          {(isAdmin || has('order.view_admin_table')) && overview.breakdown.factory.length > 0 && (
            <BreakdownCard
              title={t('statusTab.factory')}
              items={overview.breakdown.factory.map((f) => ({
                code: f.factoryId,
                name: f.name,
                count: f.count,
              }))}
              selectedCodes={filter.factoryId ? [filter.factoryId] : []}
              onToggle={(c) => setScalar('factoryId', filter.factoryId === c ? undefined : c)}
              mode="icon"
            />
          )}
          {(isAdmin || has('order.view_admin_table')) && overview.breakdown.machineType.length > 0 && (
            <BreakdownCard
              title={t('statusTab.machineType')}
              items={overview.breakdown.machineType.map((m) => ({
                code: m.machineTypeId,
                name: m.name,
                count: m.count,
              }))}
              selectedCodes={filter.machineTypeId ? [filter.machineTypeId] : []}
              onToggle={(c) => setScalar('machineTypeId', filter.machineTypeId === c ? undefined : c)}
              mode="icon"
            />
          )}
        </div>
      )}

      {/* Orders list */}
      <OrdersMiniTable queryString={queryString} />
    </div>
  );
}
