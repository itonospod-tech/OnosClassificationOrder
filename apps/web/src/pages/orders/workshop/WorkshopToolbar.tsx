import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FileWarning,
  Flag,
  ListChecks,
  PauseCircle,
  RefreshCw,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
import type { WorkshopAvailableFilters } from 'shared';

import { DateRangePicker } from '@/components/common/DateRangePicker';
import { SearchableSelectFilter } from '@/components/common/SearchableSelectFilter';
import { SelectFilter } from '@/components/common/SelectFilter';
import { BulkProductionIdDialog } from '@/components/orders/BulkProductionIdDialog';
import type { OrderFilterFacet } from '@/components/orders/OrderFilterBar';
import { OrderViewSwitch } from '@/components/orders/OrderViewSwitch';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

/** Khóa 5 pill trạng thái — thứ tự hiển thị cố định như bản thiết kế. */
export type WorkshopPillKey = 'errorFile' | 'noTool' | 'unreviewed' | 'priority' | 'held';

const PILL_META: Record<
  WorkshopPillKey,
  { icon: LucideIcon; on: string; off: string }
> = {
  errorFile: {
    icon: FileWarning,
    on: 'bg-red-600 text-white ring-red-600',
    off: 'bg-red-100 text-red-700 ring-red-200 hover:ring-red-300 dark:bg-red-900/30 dark:text-red-200 dark:ring-red-800',
  },
  noTool: {
    icon: Wrench,
    on: 'bg-sky-600 text-white ring-sky-600',
    off: 'bg-sky-100 text-sky-700 ring-sky-200 hover:ring-sky-300 dark:bg-sky-900/30 dark:text-sky-200 dark:ring-sky-800',
  },
  unreviewed: {
    icon: EyeOff,
    on: 'bg-amber-500 text-white ring-amber-500',
    off: 'bg-amber-100 text-amber-700 ring-amber-200 hover:ring-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700',
  },
  priority: {
    icon: Flag,
    on: 'bg-indigo-600 text-white ring-indigo-600',
    off: 'bg-indigo-100 text-indigo-700 ring-indigo-200 hover:ring-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-200 dark:ring-indigo-800',
  },
  held: {
    icon: PauseCircle,
    on: 'bg-amber-500 text-white ring-amber-500',
    off: 'bg-amber-100 text-amber-700 ring-amber-200 hover:ring-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700',
  },
};

export interface WorkshopToolbarProps {
  onBulkApply: (ids: string[]) => void;
  bulkIds: string[];

  createdFrom: string;
  createdTo: string;
  onDateRangeChange: (from: string, to: string) => void;

  facets: OrderFilterFacet[];
  onClearFilters: () => void;
  onReload: () => void;
  loading?: boolean;

  pillCounts: WorkshopAvailableFilters['pillCounts'] | undefined;
  heldCount: number;
  activePills: Record<WorkshopPillKey, boolean>;
  onTogglePill: (key: WorkshopPillKey) => void;
  /** Chip "Đã hủy" (toggle `cancelled`) — nằm cạnh 5 pill. */
  cancelledCount: number;
  filterCancelled: boolean;
  onToggleCancelled: () => void;

  /** Nút "Tồn thiết kế N" — chỉ hiện với người có quyền xem bảng designer. */
  designBacklogCount?: number;
  showDesignerSummary?: boolean;
  onToggleDesignerSummary?: () => void;
}

/** Ngày ISO yyyy-mm-dd cộng/trừ n ngày. */
function shiftIso(iso: string, days: number): string {
  return dayjs(iso).add(days, 'day').format('YYYY-MM-DD');
}

/**
 * Thanh công cụ MỘT HÀNG của trang "Đơn hàng theo xưởng" (Orders.md §10.2b):
 * tìm kiếm · chip ngày có mũi tên lùi/tiến · nút chọn xưởng · "Bộ lọc" (popover
 * gom 10 facet thay vì trải hàng ngang) · tải lại; hàng dưới là 5 pill trạng thái
 * kèm số + nút bật/tắt bảng tổng hợp designer. Component KHÔNG giữ state lọc —
 * caller (OrderTableWorkshop) sở hữu, đồng bộ URL như trước.
 */
export function WorkshopToolbar({
  onBulkApply,
  bulkIds,
  createdFrom,
  createdTo,
  onDateRangeChange,
  facets,
  onClearFilters,
  onReload,
  loading = false,
  pillCounts,
  heldCount,
  activePills,
  onTogglePill,
  cancelledCount,
  filterCancelled,
  onToggleCancelled,
  designBacklogCount,
  showDesignerSummary,
  onToggleDesignerSummary,
}: WorkshopToolbarProps) {
  const { t } = useTranslation('orders');
  const { has } = usePermission();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const visibleFacets = facets.filter((f) => !f.hidden && (!f.perm || has(f.perm)));
  const activeFacetCount = visibleFacets.filter((f) => !!f.value).length;

  // Chip ngày: 1 ngày → "Hôm nay · 06/09/2026" (hoặc Hôm qua/Ngày mai/ngày đó);
  // khoảng → "dd/mm → dd/mm"; rỗng → "Mọi ngày". Mũi tên chỉ dịch khi đang xem 1 ngày.
  const singleDay = !!createdFrom && createdFrom === createdTo;
  const dateLabel = useMemo(() => {
    if (!createdFrom && !createdTo) return { title: t('workshopBoard.anyDate'), sub: '' };
    if (singleDay) {
      const d = dayjs(createdFrom);
      const today = dayjs().startOf('day');
      const diff = d.startOf('day').diff(today, 'day');
      const title =
        diff === 0
          ? t('workshopBoard.today')
          : diff === -1
            ? t('workshopBoard.yesterday')
            : diff === 1
              ? t('workshopBoard.tomorrow')
              : d.format('dddd');
      return { title, sub: d.format('DD/MM/YYYY') };
    }
    const f = createdFrom ? dayjs(createdFrom).format('DD/MM') : '…';
    const to = createdTo ? dayjs(createdTo).format('DD/MM') : '…';
    return { title: '', sub: `${f} → ${to}` };
  }, [createdFrom, createdTo, singleDay, t]);

  const pillKeys: WorkshopPillKey[] = ['errorFile', 'noTool', 'unreviewed', 'priority', 'held'];
  const pillCount = (k: WorkshopPillKey) => (k === 'held' ? heldCount : (pillCounts?.[k] ?? 0));

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-border bg-card p-3">
      {/* One row since 05/10/2026: tools and status pills are all filters, so they share a wrapping line
          (`contents` dissolves the two former rows into this one). */}
      <div className="contents">
        <OrderViewSwitch current="grouped" />

        {/* Ô tìm kiếm lớn đã bỏ (07/09/2026) — tra theo mã đơn qua "Nhiều mã", lọc loại SP ở rail. */}
        <Button variant="outline" size="sm" className="h-9" onClick={() => setBulkOpen(true)} title={t('filterBar.bulkHint')}>
          <ListChecks size={14} />
          {t('filterBar.bulkBtn')}
        </Button>

        {/* Chip ngày: [‹] [icon Hôm nay · 06/09/2026 ▾] [›] — bấm giữa mở DateRangePicker. */}
        <div className="inline-flex h-9 items-center gap-0.5 rounded-md border border-input bg-background px-1">
          <button
            type="button"
            title={t('workshopBoard.prevDay')}
            disabled={!singleDay}
            onClick={() => onDateRangeChange(shiftIso(createdFrom, -1), shiftIso(createdTo, -1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            <ChevronLeft size={14} />
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={t('workshopBoard.pickDate')}
                className="inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-xs hover:bg-accent"
              >
                <CalendarDays size={14} className="text-muted-foreground" />
                {dateLabel.title && <span className="font-medium">{dateLabel.title} ·</span>}
                <span className="tabular-nums text-muted-foreground">{dateLabel.sub}</span>
                <ChevronDown size={11} className="text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
              <DateRangePicker variant="inline" from={createdFrom} to={createdTo} onChange={onDateRangeChange} />
            </PopoverContent>
          </Popover>
          <button
            type="button"
            title={t('workshopBoard.nextDay')}
            disabled={!singleDay}
            onClick={() => onDateRangeChange(shiftIso(createdFrom, 1), shiftIso(createdTo, 1))}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Nút chọn xưởng trong trang đã bỏ (07/09/2026) — dùng bộ chọn xưởng toàn cục trên header (`FactoryScopeSwitch`). */}
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <SlidersHorizontal size={14} />
              {t('workshopBoard.filters')}
              {activeFacetCount > 0 && (
                <span className="ml-0.5 rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold tabular-nums text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                  {activeFacetCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(92vw,720px)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold">{t('workshopBoard.filtersTitle')}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={onClearFilters}>
                {t('workshopBoard.clearFilters')}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleFacets.map((f) =>
                f.searchable ? (
                  <SearchableSelectFilter key={f.key} label={f.label} value={f.value} onChange={f.onChange} options={f.options} />
                ) : (
                  <SelectFilter key={f.key} label={f.label} value={f.value} onChange={f.onChange} options={f.options} />
                ),
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Button variant="outline" size="icon" className="h-9 w-9" onClick={onReload} disabled={loading} title={t('workshopBoard.reload')}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </Button>
        {onToggleDesignerSummary && (
          <button
            type="button"
            aria-expanded={!!showDesignerSummary}
            title={t('workshopBoard.designBacklogTitle')}
            onClick={onToggleDesignerSummary}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent',
              showDesignerSummary ? 'bg-accent text-foreground' : 'bg-background text-muted-foreground',
            )}
          >
            <CalendarClock size={13} />
            {t('workshopBoard.designBacklog')}{' '}
            <span className="font-semibold tabular-nums text-foreground">{designBacklogCount ?? 0}</span>
            <ChevronDown size={11} className={cn('transition-transform', showDesignerSummary && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* Hàng 2: chỉ còn pill trạng thái + Đã hủy (chip "Đang lọc"/tổng đã bỏ 07/09/2026 — trùng lặp; xưởng hiện ở tiêu đề bảng phải). */}
      <div className="contents">
        <div className="contents">
          {pillKeys.map((k) => {
            const meta = PILL_META[k];
            const Icon = meta.icon;
            const active = activePills[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                title={t(`workshopBoard.pillTitle.${k}`)}
                onClick={() => onTogglePill(k)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
                  // Zero stays pale grey (information, not a gap); a pill with orders takes its colour as a fill.
                  active ? meta.on : pillCount(k) > 0 ? cn(meta.off, 'font-semibold') : 'bg-muted/60 text-muted-foreground/70 ring-border hover:ring-border',
                )}
              >
                <Icon size={13} />
                {t(`workshopBoard.pills.${k}`)} <span className="tabular-nums">{pillCount(k)}</span>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={filterCancelled}
            onClick={onToggleCancelled}
            title={t('tableWorkshop.cancelledOnlyTitle')}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
              filterCancelled
                ? 'bg-rose-500 text-white ring-rose-500'
                : cancelledCount > 0
                  ? 'bg-rose-100 font-semibold text-rose-700 ring-rose-200 hover:ring-rose-300 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800'
                  : 'bg-muted/60 text-muted-foreground/70 ring-border hover:ring-border',
            )}
          >
            <Ban size={13} />
            {t('workshopBoard.cancelled')} <span className="tabular-nums">{cancelledCount}</span>
          </button>
        </div>
      </div>

      <BulkProductionIdDialog open={bulkOpen} onOpenChange={setBulkOpen} mode="filter" onApply={onBulkApply} initialIds={bulkIds} />
    </div>
  );
}
