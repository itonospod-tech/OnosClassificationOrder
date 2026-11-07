import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import type { WorkshopAvailableFilters } from 'shared';

import { Input } from '@/components/ui/input';

import { cn } from '@/utils/cn';

import { STAGE_BAR_ORDER, STAGE_COLORS } from './stageColors';

/** Token BE cho đơn chưa có tên loại sản phẩm (mirror facet `type` / Classic `ctype`). */
export const TYPE_NONE_TOKEN = '__none__';

export interface WorkshopTypeRailProps {
  typeStats: NonNullable<WorkshopAvailableFilters['typeStats']>;
  totalOrders: number;
  /** Loại đang chọn: '' = Tất cả, `TYPE_NONE_TOKEN` = đơn không tên loại. */
  selected: string;
  onSelect: (type: string) => void;
  className?: string;
}

/**
 * Rail bên trái của trang "Đơn hàng theo xưởng" (bản 3, Orders.md §10.2c): danh sách loại
 * sản phẩm trong phạm vi filter hiện tại (BE `typeStats`, đã bỏ qua chính filter loại),
 * mỗi hàng = tên · "N đơn / M sp" · thanh mini chia theo chặng. Hàng đầu "Tất cả".
 * Bấm = lọc `type` cho bảng bên phải. Ô tìm chỉ lọc danh sách rail (client), không gọi API.
 */
export function WorkshopTypeRail({ typeStats, totalOrders, selected, onSelect, className }: WorkshopTypeRailProps) {
  const { t } = useTranslation('orders');
  const [q, setQ] = useState('');
  const totalQty = useMemo(() => typeStats.reduce((s, r) => s + (r.qty || 0), 0), [typeStats]);
  // "N đơn" — chỉ thêm "/ M sp" khi tổng số lượng KHÁC số đơn (đa số đơn 1 cái → trùng, gây rối).
  const qtyLabel = (orders: number, qty: number) =>
    qty && qty !== orders ? t('workshopBoard.rail.ordersQty', { orders, qty }) : t('tableWorkshop.orderCount', { count: orders });
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? typeStats.filter((r) => (r.type || t('tableWorkshop.noTypeName')).toLowerCase().includes(k)) : typeStats;
  }, [typeStats, q, t]);

  return (
    <aside className={cn('flex w-[240px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card min-[1600px]:w-[280px]', className)}>
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('workshopBoard.rail.search')} className="h-8 pl-7 pr-2 text-xs" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <button
          type="button"
          aria-pressed={selected === ''}
          onClick={() => onSelect('')}
          className={cn(
            'relative flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left transition-colors',
            selected === '' ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-muted/50',
          )}
        >
          {selected === '' && <span className="absolute left-0 top-0 h-full w-[3px] bg-indigo-500" />}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">{t('workshopBoard.rail.all')}</div>
            <div className="text-[11px] tabular-nums text-muted-foreground">
              {qtyLabel(totalOrders, totalQty)}
            </div>
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
              selected === '' ? 'bg-indigo-600 text-white' : 'bg-muted text-muted-foreground',
            )}
          >
            {totalOrders}
          </span>
        </button>
        {rows.length === 0 && <div className="px-3 py-4 text-[11px] text-muted-foreground">{t('workshopBoard.rail.empty')}</div>}
        {rows.map((r) => {
          const key = r.type || TYPE_NONE_TOKEN;
          const active = selected === key;
          const name = r.type || t('tableWorkshop.noTypeName');
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              title={name}
              onClick={() => onSelect(active ? '' : key)}
              className={cn(
                'relative flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left transition-colors',
                active ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-muted/50',
              )}
            >
              {active && <span className="absolute left-0 top-0 h-full w-[3px] bg-indigo-500" />}
              <div className="min-w-0 flex-1">
                <div className={cn('line-clamp-2 text-[12px] font-medium leading-snug', active ? 'text-indigo-700 dark:text-indigo-300' : 'text-foreground')}>{name}</div>
                <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{qtyLabel(r.orders, r.qty)}</div>
                <div className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-muted">
                  {STAGE_BAR_ORDER.map((k) => {
                    const n = r.stages?.[k] || 0;
                    if (!n || !r.orders) return null;
                    return (
                      <span key={k} className={STAGE_COLORS[k].bar} style={{ width: `${(n / r.orders) * 100}%` }} title={`${t(`workshopBoard.stages.${k}`)}: ${n}`} />
                    );
                  })}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
