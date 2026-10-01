import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight } from 'lucide-react';
import type { WorkshopAvailableFilters, WorkshopStageFilter, WorkshopStageFilterKey } from 'shared';
import { LIFECYCLE_STAGE_KEYS } from 'shared';

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
  onStageChange: (stage: WorkshopStageFilterKey | '') => void;
}

export function WorkshopStageStrip({
  filters,
  activeStage,
  onStageChange,
}: WorkshopStageStripProps) {
  const { t } = useTranslation('orders');
  const counts = filters?.stageCounts || {};
  const max = Math.max(1, ...LIFECYCLE_STAGE_KEYS.map((k) => counts[k] || 0));

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-stretch gap-1.5">
        {LIFECYCLE_STAGE_KEYS.map((key, i) => {
          const n = counts[key] || 0;
          const active = activeStage === key;
          const empty = n === 0;
          const label = t(`workshopBoard.stages.${key}`);
          return (
            <div key={key} className="flex flex-1 items-center gap-1.5 min-w-0">
              <button
                type="button"
                title={t('workshopBoard.stageTileTitle', { stage: label })}
                aria-pressed={active}
                onClick={() => onStageChange(active ? '' : key)}
                className={cn(
                  'flex-1 min-w-0 rounded-lg border px-3 py-2 text-left transition-colors',
                  active
                    ? 'border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                    : empty
                      ? 'border-border bg-muted/30 hover:bg-accent'
                      : 'border-border bg-card hover:bg-accent',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* Chấm màu chặng — cùng bảng màu với thanh mini ở rail loại sản phẩm. */}
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', STAGE_COLORS[key].dot, empty && !active && 'opacity-40')} />
                    <span
                      className={cn(
                        'truncate text-[11px] font-medium',
                        active ? 'font-semibold text-indigo-700 dark:text-indigo-300' : empty ? 'text-muted-foreground/60' : 'text-muted-foreground',
                      )}
                    >
                      {label}
                    </span>
                  </span>
                  {active && <Check size={11} className="shrink-0 text-indigo-600" />}
                </div>
                <div
                  className={cn(
                    'mt-1 text-lg font-bold leading-none tabular-nums',
                    active ? 'text-indigo-700 dark:text-indigo-300' : empty ? 'text-muted-foreground/50' : 'text-foreground',
                  )}
                >
                  {n}
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
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
