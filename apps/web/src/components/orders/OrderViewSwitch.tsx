import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutList, Rows3 } from 'lucide-react';

import { PATHS } from '@/constants/paths';

import { type OrderView, useOrderViewStore } from '@/store/orderViewStore';

import { cn } from '@/utils/cn';

/** Scope params both order pages understand — carried across when switching view. */
const CARRIED_PARAMS = ['factoryId', 'productLine'];

const VIEW_PATH: Record<OrderView, string> = {
  grouped: PATHS.ORDERS_WORKSHOP,
  flat: PATHS.ORDERS_CLASSIC,
};

/**
 * "Group by product" / "Flat table": two views of one order set, switched here instead of by two sidebar
 * entries. Writes the current view to `useOrderViewStore` on mount so the sidebar's single "All orders"
 * link reopens the view the person used last. Both routes stay, so old links keep working.
 */
export function OrderViewSwitch({ current }: { current: OrderView }) {
  const { t } = useTranslation('orders');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setView = useOrderViewStore((s) => s.setView);

  useEffect(() => {
    setView(current);
  }, [current, setView]);

  const go = (view: OrderView) => {
    if (view === current) return;
    const next = new URLSearchParams();
    for (const key of CARRIED_PARAMS) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    navigate(qs ? `${VIEW_PATH[view]}?${qs}` : VIEW_PATH[view]);
  };

  const items: { key: OrderView; label: string; icon: React.ReactNode }[] = [
    { key: 'grouped', label: t('viewSwitch.grouped'), icon: <LayoutList size={14} /> },
    { key: 'flat', label: t('viewSwitch.flat'), icon: <Rows3 size={14} /> },
  ];
  return (
    <div role="group" aria-label={t('viewSwitch.label')} className="inline-flex h-9 items-center gap-0.5 rounded-md border border-input bg-background p-0.5">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={current === it.key}
          onClick={() => go(it.key)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors',
            current === it.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
