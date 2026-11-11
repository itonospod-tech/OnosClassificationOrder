import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkshopAvailableFilters, WorkshopStageFilter, WorkshopStageFilterKey } from 'shared';
import { LIFECYCLE_STAGE_KEYS } from 'shared';

import { useOrderViewStore } from '@/store/orderViewStore';

import { cn } from '@/utils/cn';

import { STAGE_COLORS } from './stageColors';

/**
 * Dải phễu 8 chặng trên đầu trang "Đơn hàng theo xưởng" (Orders.md §10.2b):
 * Soát tool → Thiết kế → In → Ép → QC → May vào → May ra → Đóng hàng. Số trên
 * mỗi ô = số đơn ĐANG ở chặng đó trong phạm vi filter hiện tại (BE
 * `stageCounts`, đã bỏ qua chính filter chặng nên bấm ô này vẫn thấy số ô kia).
 * Bấm ô = lọc bảng theo chặng (bấm lại để bỏ). Tổng/xưởng/chip Đang giữ–Đã hủy
 * nằm ở hàng gộp của `WorkshopToolbar` (gom 3 hàng thành 1, 07/09/2026).
 */
export interface WorkshopStageStripProps {
  filters: WorkshopAvailableFilters | null;
  /** May be `__open__` (product-line default): no cell is highlighted then. */
  activeStage: WorkshopStageFilter | '';
  /** Drawn inside a card the caller owns (no border, background or padding of its own). */
  embedded?: boolean;
  onStageChange: (stage: WorkshopStageFilterKey | '') => void;
}

export function WorkshopStageStrip({
  filters,
  activeStage,
  embedded,
  onStageChange,
}: WorkshopStageStripProps) {
  const { t } = useTranslation('orders');
  const counts = filters?.stageCounts || {};
  const max = Math.max(1, ...LIFECYCLE_STAGE_KEYS.map((k) => counts[k] || 0));
  const expanded = useOrderViewStore((s) => s.funnelExpanded);
  const toggleFunnel = useOrderViewStore((s) => s.toggleFunnel);

  // Compact funnel (default): the same eight stages and counts as one row of chips, still clickable as
  // filters. The full tiles are a glance at the start of a shift, so they fold away and the choice is kept.
  if (!expanded) {
    return (
      <div className={cn('flex items-center gap-1.5', !embedded && 'rounded-lg border border-border bg-card px-2.5 py-1.5')}>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {LIFECYCLE_STAGE_KEYS.map((key) => {
            const n = counts[key] || 0;
            const active = activeStage === key;
            const label = t(`workshopBoard.stages.${key}`);
            return (
              <button
                key={key}
                type="button"
                title={t('workshopBoard.stageTileTitle', { stage: label })}
                aria-pressed={active}
                onClick={() => onStageChange(active ? '' : key)}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
                  active ? cn('border-2', STAGE_COLORS[key].tileActive) : n > 0 ? STAGE_COLORS[key].tile : 'border-border bg-muted/30 hover:bg-accent',
                )}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', STAGE_COLORS[key].dot, n === 0 && !active && 'opacity-40')} />
                <span className={cn('font-medium', n === 0 && !active ? 'text-muted-foreground/60' : STAGE_COLORS[key].text)}>{label}</span>
                <span className={cn('font-bold tabular-nums', n === 0 && !active ? 'text-muted-foreground/50' : STAGE_COLORS[key].text)}>{n}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={toggleFunnel}
          title={t('workshopBoard.funnelExpand')}
          aria-label={t('workshopBoard.funnelExpand')}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('relative', !embedded && 'rounded-lg border border-border bg-card p-3')}>
      <button
        type="button"
        onClick={toggleFunnel}
        title={t('workshopBoard.funnelCollapse')}
        aria-label={t('workshopBoard.funnelCollapse')}
        className="absolute right-1 top-1 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
      >
        <ChevronDown size={13} className="rotate-180" />
      </button>
      {/* Phones: 8 tiles cannot share 390px, so the row scrolls on its own with a readable minimum tile width. */}
      <div className="flex items-stretch gap-1.5 max-md:-mx-1 max-md:overflow-x-auto max-md:px-1 max-md:pb-1">
        {LIFECYCLE_STAGE_KEYS.map((key, i) => {
          const n = counts[key] || 0;
          const active = activeStage === key;
          const empty = n === 0;
          const label = t(`workshopBoard.stages.${key}`);
          return (
            <div key={key} className="flex flex-1 items-center gap-1.5 min-w-0 max-md:min-w-[112px]">
              <button
                type="button"
                title={t('workshopBoard.stageTileTitle', { stage: label })}
                aria-pressed={active}
                onClick={() => onStageChange(active ? '' : key)}
                className={cn(
                  'flex-1 min-w-0 rounded-lg border px-3 py-2 text-left transition-colors',
                  // Meaning, not decoration: a stage with orders wears its own stage tint, the selected
                  // one a stronger tint + 2px border, an empty one stays neutral (0 is information).
                  active
                    ? cn('border-2', STAGE_COLORS[key].tileActive)
                    : empty
                      ? 'border-border bg-muted/30 hover:bg-accent'
                      : STAGE_COLORS[key].tile,
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* Chấm màu chặng — cùng bảng màu với thanh mini ở rail loại sản phẩm. */}
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', STAGE_COLORS[key].dot, empty && !active && 'opacity-40')} />
                    <span
                      className={cn(
                        'truncate text-[11px] font-medium',
                        active ? cn('font-semibold', STAGE_COLORS[key].text) : empty ? 'text-muted-foreground/60' : cn('font-medium', STAGE_COLORS[key].text),
                      )}
                    >
                      {label}
                    </span>
                  </span>
                  {active && <Check size={11} className={cn('shrink-0', STAGE_COLORS[key].text)} />}
                </div>
                <div
                  className={cn(
                    'mt-1 text-xl font-bold leading-none tabular-nums',
                    empty && !active ? 'text-muted-foreground/50' : STAGE_COLORS[key].text,
                  )}
                >
                  {n}
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background/70 dark:bg-background/40">
                  {n > 0 && (
                    <div
                      className={cn('h-full rounded-full', STAGE_COLORS[key].bar)}
                      style={{ width: `${Math.max(6, Math.round((n / max) * 100))}%` }}
                    />
                  )}
                </div>
              </button>
              {i < LIFECYCLE_STAGE_KEYS.length - 1 && (
                <ChevronRight size={14} className="shrink-0 text-muted-foreground/50" />
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
