import React from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/utils/cn';

import type { GuideCallout } from './guideSteps';

/**
 * Nguồn làm sáng một chú thích. Chuột và focus giữ state RIÊNG (`useCalloutHighlight` ở `GuideStepBlock`) —
 * dùng chung 1 state thì `mouseleave` (chuột rời mục, hoặc trang cuộn dưới con trỏ khi Tab) xoá mất
 * chú thích đang được focus bàn phím (TEST-04 BUG-1). `pin` = bấm / mở hộp phóng to từ huy hiệu.
 *
 * Chuột sáng bằng `mousemove` chứ KHÔNG `mouseenter`: nội dung cuộn dưới con trỏ đứng yên (Tab trong hộp phóng
 * to, hộp tự cuộn tới huy hiệu) chỉ bắn `mouseover/mouseenter`, không bắn `mousemove` → không cướp chỗ của focus/ghim.
 */
export type HighlightSource = 'hover' | 'focus' | 'pin';

interface CalloutListProps {
  callouts: GuideCallout[];
  labelOf: (n: number) => string;
  detailOf: (n: number) => string;
  active: number | null;
  onActiveChange: (n: number | null, source: HighlightSource) => void;
  /** Bấm 1 mục → cuộn chấm số tương ứng vào tầm nhìn. */
  onSelect: (n: number) => void;
  /** `stack` = cột dọc cạnh ảnh hẹp; `grid` = lưới dưới ảnh rộng. */
  layout?: 'stack' | 'grid';
}

const GRID_COLS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

/**
 * Danh sách chú thích cùng số với chấm trên ảnh. Rê chuột / focus một mục làm
 * chấm tương ứng sáng lên (và ngược lại — state `active` do component cha giữ).
 */
function CalloutList({
  callouts,
  labelOf,
  detailOf,
  active,
  onActiveChange,
  onSelect,
  layout = 'stack',
}: CalloutListProps) {
  const { t } = useTranslation('orderGuide');

  return (
    <ol
      aria-label={t('shot.calloutsLabel')}
      className={cn('grid gap-2.5', layout === 'grid' && GRID_COLS[callouts.length])}
    >
      {callouts.map((c) => {
        const isActive = active === c.n;
        return (
          <li key={c.n}>
            <button
              type="button"
              onMouseMove={() => onActiveChange(c.n, 'hover')}
              onMouseLeave={() => onActiveChange(null, 'hover')}
              onFocus={() => onActiveChange(c.n, 'focus')}
              onBlur={() => onActiveChange(null, 'focus')}
              onClick={() => onSelect(c.n)}
              className={cn(
                'flex h-full w-full gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
                isActive ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white hover:border-brand-200',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white transition-colors',
                  isActive ? 'bg-brand-700' : 'bg-brand-600',
                )}
              >
                {c.n}
              </span>
              <span className="min-w-0">
                <span className="block break-words text-sm font-semibold text-[#0f110f]">{labelOf(c.n)}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-slate-600">{detailOf(c.n)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default CalloutList;
