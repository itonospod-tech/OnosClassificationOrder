import React from 'react';

import { cn } from '@/utils/cn';

export type StatTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatCardItem {
  key?: string;
  label: React.ReactNode;
  value: React.ReactNode;
  /** Colors the value by meaning (info = where you are, success = done, warning = waiting/running, danger = error). */
  tone?: StatTone;
  /** Makes the card a button (e.g. drill into the list behind the number). */
  onClick?: () => void;
}

export interface StatCardsProps {
  items: StatCardItem[];
  /** Columns on large screens (default 4). Below that: 2 on phones, 3 on tablets (capped at `cols`). */
  cols?: 2 | 3 | 4 | 5 | 6 | 8;
  className?: string;
}

const TONE_CLS: Record<StatTone, string> = {
  neutral: 'text-foreground',
  info: 'text-tone-info',
  success: 'text-tone-success',
  warning: 'text-tone-warning',
  danger: 'text-tone-danger',
};

// Tailwind needs static class names, so the column counts are looked up rather than interpolated.
const LG_COLS: Record<NonNullable<StatCardsProps['cols']>, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
  8: 'lg:grid-cols-8',
};

/**
 * Row of number cards (KPI tiles). One component for the pattern every statistics header copied as
 * `grid grid-cols-2 sm:grid-cols-3 …`, which on a phone left the third card alone on its row like a
 * layout bug. Here: 2 equal columns on phones and an ODD LAST card stretches across the full row;
 * 3 columns on tablets (or fewer if `cols` is smaller); `cols` columns on large screens.
 *
 * ```tsx
 * <StatCards
 *   cols={6}
 *   items={[
 *     { label: t('kpi.waiting'), value: counts.waiting },
 *     { label: t('kpi.inProgress'), value: counts.inProgress, tone: 'info' },
 *     { label: t('kpi.rework'), value: counts.rework, tone: 'warning', onClick: openRework },
 *   ]}
 * />
 * ```
 */
export function StatCards({ items, cols = 4, className }: StatCardsProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-2',
        cols >= 3 && 'sm:grid-cols-3',
        LG_COLS[cols],
        // An odd last card would sit alone in the 2-column phone grid; let it span the row there only.
        'max-sm:[&>*:last-child:nth-child(odd)]:col-span-2',
        className,
      )}
    >
      {items.map((it, i) => {
        const body = (
          <>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{it.label}</p>
            <p className={cn('text-lg font-bold tabular-nums', TONE_CLS[it.tone ?? 'neutral'])}>{it.value}</p>
          </>
        );
        const cls = 'rounded-md border border-border bg-card p-3 text-left';
        return it.onClick ? (
          <button
            key={it.key ?? i}
            type="button"
            onClick={it.onClick}
            className={cn(cls, 'transition-colors hover:bg-accent/50 touch:min-h-11 active:bg-accent')}
          >
            {body}
          </button>
        ) : (
          <div key={it.key ?? i} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
