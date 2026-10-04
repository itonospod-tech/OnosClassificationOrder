import React from 'react';

import { cn } from '@/utils/cn';

export interface ColumnTabItem<K extends string = string> {
  key: K;
  label: React.ReactNode;
  count: number;
}

export interface ColumnTabsProps<K extends string = string> {
  items: ColumnTabItem<K>[];
  active: K;
  onPick: (key: K) => void;
  className?: string;
}

/**
 * Phone column picker (DesignSystem-LegacyParity.md §10): a kanban's 4–7 side-by-side columns do
 * not fit a phone, so only one is shown at a time and this swipeable pill row picks which. Each pill
 * is a column name + its card count (the job the KPI tiles do on a wide screen). 44px tall, bleeds
 * to the page edges so a pill cut off at the right invites the swipe.
 *
 * ```tsx
 * <ColumnTabs
 *   items={cols.map((k) => ({ key: k, label: meta[k].label, count: counts[k] }))}
 *   active={activeCol}
 *   onPick={setActiveCol}
 * />
 * ```
 */
export function ColumnTabs<K extends string = string>({ items, active, onPick, className }: ColumnTabsProps<K>) {
  return (
    <div
      role="tablist"
      className={cn(
        '-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(it.key)}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors',
              on ? 'border-tone-info bg-tone-info/10 text-tone-info' : 'border-border bg-card text-muted-foreground',
            )}
          >
            {it.label}
            <span
              className={cn(
                'min-w-[1.5rem] rounded-full px-1.5 text-center text-xs font-bold tabular-nums',
                on ? 'bg-tone-info text-white' : 'bg-muted text-foreground',
              )}
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
