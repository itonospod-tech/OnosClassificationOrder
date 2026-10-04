'use client';

import { useTranslation } from 'react-i18next';
import { PauseCircle, Wrench } from 'lucide-react';
import { CUSTOMER_ORDER_STATUSES } from 'shared/enums';
import type { CustomerOrderCounts } from 'shared';

const COUNT_KEY: Record<string, keyof CustomerOrderCounts> = {
  pending: 'pending',
  processing: 'processing',
  'in-production': 'inProduction',
  fulfilled: 'fulfilled',
  completed: 'completed',
  refunded: 'refunded',
  cancelled: 'cancelled',
};

interface OrdersStatusFilterPillsProps {
  active: string | null;
  onChange: (status: string | null) => void;
  counts?: CustomerOrderCounts | null;
  heldOnly: boolean;
  onToggleHeld: () => void;
}

/** Pill trạng thái (tab) + chip "Đang giữ" (cờ chồng, không phải tab — CustomerOrderIntake.md §1.2). */
export function OrdersStatusFilterPills({ active, onChange, counts, heldOnly, onToggleHeld }: OrdersStatusFilterPillsProps) {
  const { t } = useTranslation('customerPortal');
  const list: readonly string[] = ['all', ...CUSTOMER_ORDER_STATUSES];
  // Phones: one swipeable row instead of four wrapped rows above the list.
  return (
    <div className="flex items-center gap-2 md:flex-wrap max-md:overflow-x-auto max-md:no-scrollbar max-md:[&>*]:shrink-0 max-md:-mx-1 max-md:px-1">
      {list.map((status) => {
        const isActive = (status === 'all' && !active) || active === status;
        const count = counts ? (status === 'all' ? counts.all : (counts[COUNT_KEY[status]] as number)) : null;
        return (
          <button
            key={status}
            type="button"
            onClick={() => onChange(status === 'all' ? null : status)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-semibold transition-colors cursor-pointer ${
              isActive
                ? 'bg-cta text-cta-foreground border-none'
                : 'bg-card border border-border1 text-text-secondary hover:bg-card-hover'
            }`}
          >
            {t(`orders.tabs.${status}`)}
            {count !== null && count > 0 && ` (${count})`}
          </button>
        );
      })}
      <span className="w-px h-4 bg-border1 mx-1" />
      <button
        type="button"
        onClick={onToggleHeld}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-semibold transition-colors cursor-pointer ${
          heldOnly ? 'border-warning bg-warning-bg text-warning' : 'border-border1 bg-card text-text-secondary hover:bg-card-hover'
        }`}
      >
        <PauseCircle size={11} />
        {t('orders.badgeHold')}
        {counts && counts.held > 0 && ` (${counts.held})`}
      </button>
      {counts && counts.rework > 0 && (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-border1 bg-card text-[10px] font-semibold text-text-secondary">
          <Wrench size={11} />
          {t('orders.badgeRework')} ({counts.rework})
        </span>
      )}
    </div>
  );
}
