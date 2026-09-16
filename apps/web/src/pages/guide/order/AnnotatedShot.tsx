import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2 } from 'lucide-react';

import { cn } from '@/utils/cn';

import { badgeDiameter, badgeOffsetPx, layoutBadges, shotMinWidth } from './badgeLayout';
import type { HighlightSource } from './CalloutList';
import type { GuideStep } from './guideSteps';
import { GUIDE_IMAGE_BASE } from './guideSteps';

interface AnnotatedShotProps {
  step: GuideStep;
  alt: string;
  labelOf: (n: number) => string;
  active: number | null;
  onActiveChange: (n: number | null, source: HighlightSource) => void;
  /**
   * Có → hiện nút "Phóng to"; bấm ảnh hoặc huy hiệu số sẽ mở ảnh phóng to. `returnFocus` là phần
   * tử nhận lại focus khi đóng hộp phóng to (Radix không có Trigger nên tự trả về BODY).
   */
  onZoom?: (n: number | undefined, returnFocus: HTMLElement | null) => void;
  /** `inline` = trong bài; `zoom` = trong hộp phóng to (ảnh to hơn, không có thanh cửa sổ). */
  variant?: 'inline' | 'zoom';
  eager?: boolean;
}

/**
 * Ảnh chụp màn hình + VIỀN mảnh quanh từng phần tử được chú thích (`boxPct`) + HUY HIỆU số
 * đặt NGOÀI viền (`layoutBadges`). Mọi vị trí theo % của CHÍNH khung ảnh nên co giãn cùng ảnh ở
 * mọi bề rộng, kể cả trong hộp phóng to. Viền không tô nền → không che chữ bên trong.
 *
 * Khung ảnh không bao giờ rộng hơn cột chứa nó (`max-w-full min-w-0`); ảnh chỉ giữ bề rộng tối
 * thiểu `shotMinWidth` ở LỚP TRONG và cuộn ngang trong khung → trang không bao giờ cuộn ngang.
 */
function AnnotatedShot({
  step,
  alt,
  labelOf,
  active,
  onActiveChange,
  onZoom,
  variant = 'inline',
  eager = false,
}: AnnotatedShotProps) {
  const { t } = useTranslation('orderGuide');
  const zoomBtnRef = useRef<HTMLButtonElement>(null);
  const isZoom = variant === 'zoom';
  const { width, height } = step;
  const imageLayerRef = useRef<HTMLDivElement>(null);

  const minWidth = isZoom ? Math.min(width, 960) : shotMinWidth(step);
  // Bề rộng ảnh đang vẽ, làm tròn XUỐNG bội 16px (huy hiệu tính hơi to hơn thật → an toàn, và không tính lại
  // mỗi pixel khi kéo cửa sổ). Khởi đầu bằng cỡ nhỏ nhất có thể cho tới khi ResizeObserver đo được.
  const [renderWidth, setRenderWidth] = useState(minWidth);
  useEffect(() => {
    const el = imageLayerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(16, Math.floor(entry.contentRect.width / 16) * 16);
      setRenderWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Vị trí (góc/cạnh của viền) KHÔNG phụ thuộc bề rộng → trong bài và hộp phóng to giống nhau; chỉ cỡ huy hiệu
  // co giãn theo tỉ lệ ảnh đang vẽ (20–28px).
  const badges = useMemo(() => layoutBadges(step), [step]);
  const diameter = badgeDiameter(Math.min(1, renderWidth / width));
  const hasLeader = step.callouts.some((c) => badges[c.n]?.leader);
  const swipeable = !isZoom && minWidth > 326;
  // Hộp phóng to: ảnh gốc RỘNG HƠN màn hình giữ tối thiểu `minWidth` (≤ 960) và cuộn ngang như cũ; ảnh gốc HẸP HƠN
  // hoặc bằng màn hình thì thu vừa khung, không cuộn ngang (TEST-04 BUG-5: ảnh 380px nằm trong khung 340px ở 390).
  // `clamp(0px, (W − 100vw) × 9999, minWidth)` = 0 khi W ≤ 100vw, = minWidth khi W > 100vw — thuần CSS, tự đổi khi xoay/kéo cửa sổ.
  const innerStyle: React.CSSProperties = isZoom
    ? { width: `max(min(${width}px, 100%), clamp(0px, calc((${width}px - 100vw) * 9999), ${minWidth}px))` }
    : { maxWidth: `${width}px`, minWidth: `${minWidth}px` };

  const image = (
    <img
      src={`${GUIDE_IMAGE_BASE}${step.file}`}
      width={width}
      height={height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      className="block h-auto w-full select-none"
    />
  );

  return (
    <figure className="m-0 min-w-0 max-w-full">
      <div
        className={cn(
          'mx-auto w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white',
          isZoom ? 'shadow-xl' : 'shadow-[0_18px_40px_-24px_rgba(43,39,57,0.35)]',
        )}
        style={{ maxWidth: `min(${width + 2}px, 100%)` }}
      >
        {!isZoom && (
          <div className="flex min-w-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
            <span className="flex shrink-0 gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            </span>
            <span className="min-w-0 truncate text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-400">
              {t('shot.frameLabel')}
            </span>
            {onZoom && (
              <button
                ref={zoomBtnRef}
                type="button"
                onClick={(e) => onZoom(undefined, e.currentTarget)}
                aria-label={t('shot.zoomAria', { title: alt })}
                className="ml-auto inline-flex min-h-[1.75rem] shrink-0 items-center gap-1 rounded-full px-2.5 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-slate-500 transition-colors hover:bg-white hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                <Maximize2 size={12} aria-hidden />
                {t('shot.zoom')}
              </button>
            )}
          </div>
        )}

        <div className="max-w-full overflow-x-auto overscroll-x-contain" data-shot-scroller>
          <div ref={imageLayerRef} className="relative mx-auto w-full" style={innerStyle} data-shot-image>
            {onZoom ? (
              // Đường bàn phím là nút "Phóng to" ở thanh trên — ảnh chỉ nhận chuột/chạm để khỏi thừa 1 điểm Tab.
              // Đóng hộp phóng to mở từ ảnh → focus về nút "Phóng to" (ảnh là aria-hidden, không nhận focus).
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                onClick={() => onZoom(undefined, zoomBtnRef.current)}
                className="block w-full cursor-zoom-in"
              >
                {image}
              </button>
            ) : (
              image
            )}

            {step.callouts.map((c) => {
              const isActive = active === c.n;
              return (
                <span
                  key={`box-${c.n}`}
                  aria-hidden
                  data-callout-box={c.n}
                  style={{
                    left: `${c.boxPct.x}%`,
                    top: `${c.boxPct.y}%`,
                    width: `${c.boxPct.w}%`,
                    height: `${c.boxPct.h}%`,
                  }}
                  className={cn(
                    'pointer-events-none absolute rounded-md border-2 transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none',
                    isActive ? 'border-brand-600 shadow-[0_0_0_3px_rgba(111,38,194,0.28)]' : 'border-brand-600/60',
                  )}
                />
              );
            })}

            {/* Đường dẫn ngắn (chỉ khi mọi chỗ dính viền đều che chữ — `layoutBadges`): từ viền tới tâm huy hiệu. */}
            {hasLeader && (
              <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {step.callouts.map((c) => {
                  const pos = badges[c.n];
                  if (!pos?.leader) return null;
                  return (
                    <line
                      key={`leader-${c.n}`}
                      data-callout-leader={c.n}
                      x1={pos.leader.x}
                      y1={pos.leader.y}
                      x2={pos.ax}
                      y2={pos.ay}
                      vectorEffect="non-scaling-stroke"
                      strokeWidth={active === c.n ? 2.5 : 2}
                      className={active === c.n ? 'stroke-brand-600' : 'stroke-brand-600/70'}
                    />
                  );
                })}
              </svg>
            )}

            {step.callouts.map((c) => {
              const isActive = active === c.n;
              const pos = badges[c.n];
              return (
                <button
                  key={c.n}
                  type="button"
                  data-callout={c.n}
                  aria-label={t('shot.marker', { n: c.n, label: labelOf(c.n) })}
                  onMouseMove={() => onActiveChange(c.n, 'hover')}
                  onMouseLeave={() => onActiveChange(null, 'hover')}
                  onFocus={() => onActiveChange(c.n, 'focus')}
                  onBlur={() => onActiveChange(null, 'focus')}
                  onClick={(e) => (onZoom ? onZoom(c.n, e.currentTarget) : onActiveChange(c.n, 'pin'))}
                  data-slot={pos.slot}
                  style={{
                    left: `calc(${pos.ax}% + ${badgeOffsetPx(pos.kx, pos.gx, diameter)}px)`,
                    top: `calc(${pos.ay}% + ${badgeOffsetPx(pos.ky, pos.gy, diameter)}px)`,
                    width: diameter,
                    height: diameter,
                  }}
                  className={cn(
                    // `before:` nới vùng bấm thêm 4px mỗi phía (≥ 28px) mà không đổi cỡ vẽ.
                    "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-bold text-white shadow-md shadow-ink-900/30 transition-transform duration-150 before:absolute before:-inset-1 before:rounded-full before:content-[''] focus-visible:outline-none motion-reduce:transition-none",
                    isActive
                      ? 'scale-110 bg-brand-700 ring-4 ring-brand-300'
                      : 'bg-brand-600 ring-2 ring-white hover:scale-110',
                  )}
                >
                  {c.n}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {swipeable && (
        <figcaption className="mt-2 text-center text-xs text-slate-400 sm:hidden">{t('shot.swipeHint')}</figcaption>
      )}
    </figure>
  );
}

export default AnnotatedShot;
