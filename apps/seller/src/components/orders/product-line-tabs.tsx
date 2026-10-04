'use client';

/**
 * Tab dòng sản phẩm cho danh sách đơn — khuôn `orders-service-tabs.tsx` của thghub
 * (card rounded-xl + icon + count), thay 4 dịch vụ bằng 6 dòng sản phẩm Onos.
 * Key `all` = không lọc; caller map về `undefined` trước khi gọi API.
 */
import { useTranslation } from 'react-i18next';
import { ClipboardList } from 'lucide-react';
import { PRODUCT_LINES, PRODUCT_LINE_META, type ProductLine } from '@/lib/product-lines';

export type ProductLineTabKey = 'all' | ProductLine;
export const PRODUCT_LINE_TAB_KEYS: readonly ProductLineTabKey[] = ['all', ...PRODUCT_LINES];

const ALL_COLOR = '#c40c68';

interface ProductLineTabsProps {
  active: ProductLineTabKey;
  onChange: (line: ProductLineTabKey) => void;
  /** `counts.byProductLine` từ API + `all` — undefined ẩn badge số. */
  counts?: Partial<Record<ProductLineTabKey, number>>;
  /** Route khoá dòng (`/portal/orders/3d`) → chỉ hiện tab đó, không đổi được. */
  locked?: ProductLine;
}

export function ProductLineTabs({ active, onChange, counts, locked }: ProductLineTabsProps) {
  const { t } = useTranslation('customerPortal');
  const keys = locked ? [locked] : PRODUCT_LINE_TAB_KEYS;
  // Phones: one swipeable row instead of four wrapped rows above the list.
  return (
    <div className="flex items-center gap-2 md:flex-wrap max-md:overflow-x-auto max-md:no-scrollbar max-md:[&>*]:shrink-0 max-md:-mx-1 max-md:px-1">
      {keys.map((key) => {
        const meta = key === 'all' ? null : PRODUCT_LINE_META[key];
        const color = meta ? meta.color : ALL_COLOR;
        const Icon = meta ? meta.icon : ClipboardList;
        const isActive = active === key;
        const count = counts ? (counts[key] ?? 0) : null;
        return (
          <button
            key={key}
            type="button"
            disabled={!!locked}
            onClick={() => onChange(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer disabled:cursor-default ${
              isActive ? 'text-white shadow-md border-none' : 'bg-card border border-border1 hover:bg-card-hover'
            }`}
            style={isActive ? { backgroundColor: color } : { color }}
          >
            <Icon size={14} />
            {key === 'all' ? t('orders.tabs.all') : t(`productLines.${key}`)}
            {count !== null && (
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold ${isActive ? 'bg-white/25' : ''}`}
                style={!isActive ? { backgroundColor: `${color}15`, color } : undefined}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
