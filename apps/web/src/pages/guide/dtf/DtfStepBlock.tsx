import React, { useCallback, useRef, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';

import AnnotatedShot from '../order/AnnotatedShot';
import { isWideShot } from '../order/badgeLayout';
import type { HighlightSource } from '../order/CalloutList';
import CalloutList from '../order/CalloutList';
import type { GuideStep } from '../order/guideTypes';
import { scrollMarkerIntoView } from '../order/scrollMarker';
import ShotLightbox from '../order/ShotLightbox';
import type { DtfRoleId } from './dtfGuideRoles';
import { dtfStepAnchorId } from './dtfGuideRoles';
import { dtfShotI18n } from './dtfShotI18n';

interface HighlightState {
  hover: number | null;
  focus: number | null;
  pin: number | null;
  last: HighlightSource;
}

const NO_HIGHLIGHT: HighlightState = { hover: null, focus: null, pin: null, last: 'pin' };

/** Chờ Radix trả focus xong (nó chạy trong `setTimeout(0)` sau khi hộp gỡ khỏi DOM) rồi mới kiểm lại. */
const FOCUS_GUARD_DELAY_MS = 50;

/**
 * Chú thích đang sáng — CÙNG luật với `useCalloutHighlight` trong `pages/guide/order/GuideStepBlock.tsx` (TASK-01, hàm
 * không export nên chép lại): nguồn vừa đổi gần nhất thắng, rỗng thì lùi về chuột → focus → ghim; rê chuột / focus vào
 * một chú thích thì bỏ ghim. Sửa luật thì sửa CẢ HAI nơi.
 */
function useCalloutHighlight() {
  const [state, setState] = useState<HighlightState>(NO_HIGHLIGHT);
  const change = useCallback((n: number | null, source: HighlightSource) => {
    setState((prev) => {
      if (source === 'pin') return { ...prev, pin: n, last: 'pin' };
      if (prev[source] === n && prev.last === source && (n === null || prev.pin === null)) return prev;
      return { ...prev, [source]: n, pin: n === null ? prev.pin : null, last: source };
    });
  }, []);
  const reset = useCallback((pin: number | null) => setState({ ...NO_HIGHLIGHT, pin }), []);
  const active = state[state.last] ?? state.hover ?? state.focus ?? state.pin;
  return { active, change, reset };
}

interface DtfStepBlockProps {
  roleId: DtfRoleId;
  step: GuideStep;
  index: number;
  total: number;
  eager?: boolean;
}

/**
 * Một bước hướng dẫn DTF: số bước + tiêu đề + mô tả (+ ô lưu ý nếu có khoá `note`), ảnh có viền + huy hiệu, danh sách
 * chú thích và hộp phóng to. Ảnh/chú thích/hộp phóng to là component TASK-01 dùng nguyên; phần chữ + khung dùng UI kit
 * nội bộ. Bố cục theo hình dạng ảnh giống `GuideStepBlock`: ảnh rộng chiếm cả bề ngang, chú thích xếp lưới bên dưới;
 * ảnh hẹp nằm cột phải, chú thích cột trái. Dưới `lg` luôn chữ → ảnh → chú thích.
 */
function DtfStepBlock({ roleId, step, index, total, eager = false }: DtfStepBlockProps) {
  const { t, i18n } = useTranslation('dtfGuide');
  const rootRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { active, change: setActive } = useCalloutHighlight();
  const [zoomOpen, setZoomOpen] = useState(false);
  const { active: zoomActive, change: setZoomActive, reset: resetZoomActive } = useCalloutHighlight();
  const [zoomFrom, setZoomFrom] = useState<number | null>(null);

  const base = `roles.${roleId}.steps.${step.id}`;
  const title = t(`${base}.title`);
  const alt = t(`${base}.alt`);
  const stepLabel = t('section.stepLabel', { n: index + 1, total });
  const hasNote = i18n.exists(`${base}.note`, { ns: 'dtfGuide' });
  const labelOf = useCallback((n: number) => t(`${base}.callouts.${n}.label`), [t, base]);
  const detailOf = useCallback((n: number) => t(`${base}.callouts.${n}.detail`), [t, base]);
  const wide = isWideShot(step);

  const openZoom = (n: number | undefined, returnFocus: HTMLElement | null) => {
    returnFocusRef.current = returnFocus;
    resetZoomActive(n ?? null);
    setZoomFrom(n ?? null);
    setZoomOpen(true);
  };

  /**
   * Đóng hộp phóng to. Trả focus vẫn do `ShotLightbox` làm (`returnFocusRef`, giống TASK-01); ở đây chỉ PHÒNG HỜ cho
   * TEST-07 BUG-2 (focus rơi về BODY sau khi mở từ huy hiệu — không tái hiện được): huy hiệu đã mở hộp bị thay phần tử
   * thì tìm lại theo số chú thích, và nếu sau khi Radix trả focus mà focus vẫn nằm ở BODY thì đưa về huy hiệu đó.
   * Focus đã về đúng chỗ thì không làm gì.
   */
  const handleZoomOpenChange = (open: boolean) => {
    setZoomOpen(open);
    if (open) return;
    const from = zoomFrom;
    const badgeOf = () =>
      from == null
        ? null
        : (rootRef.current?.querySelector<HTMLElement>(`[data-shot-image] [data-callout="${from}"]`) ?? null);
    if (!returnFocusRef.current?.isConnected) returnFocusRef.current = badgeOf();
    window.setTimeout(() => {
      const current = document.activeElement;
      if (current && current !== document.body) return;
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : badgeOf();
      target?.focus({ preventScroll: true });
    }, FOCUS_GUARD_DELAY_MS);
  };

  const selectCallout = (n: number) => {
    setActive(n, 'pin');
    scrollMarkerIntoView(rootRef.current, n);
  };

  const header = (
    <div className="flex gap-3 sm:gap-4">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{stepLabel}</p>
        <h3 className="mt-0.5 break-words text-lg font-semibold leading-snug text-foreground">{title}</h3>
        <p className="mt-1.5 max-w-3xl break-words text-sm leading-relaxed text-muted-foreground">
          {t(`${base}.body`)}
        </p>
        {hasNote && (
          <div className="mt-3 flex max-w-3xl gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
            <p className="min-w-0 break-words">
              <span className="font-semibold">{t('section.stepNote')} </span>
              {t(`${base}.note`)}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const shot = (
    <AnnotatedShot
      step={step}
      alt={alt}
      labelOf={labelOf}
      active={active}
      onActiveChange={setActive}
      onZoom={openZoom}
      eager={eager}
    />
  );

  const list = (layout: 'stack' | 'grid') => (
    <CalloutList
      layout={layout}
      callouts={step.callouts}
      labelOf={labelOf}
      detailOf={detailOf}
      active={active}
      onActiveChange={setActive}
      onSelect={selectCallout}
    />
  );

  return (
    <I18nextProvider i18n={dtfShotI18n}>
      <article ref={rootRef} id={dtfStepAnchorId(roleId, step.id)} className="min-w-0 scroll-mt-24">
        {wide ? (
          <div className="grid min-w-0 grid-cols-1">
            <div className="min-w-0">{header}</div>
            <div className="mt-5 min-w-0">{shot}</div>
            <div className="mt-4 min-w-0">{list('grid')}</div>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,min(var(--shot-w),36rem))] lg:grid-rows-[auto_1fr] lg:gap-x-10"
            style={{ '--shot-w': `${step.width}px` } as React.CSSProperties}
          >
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">{header}</div>
            <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">{shot}</div>
            <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:pl-[3.25rem]">{list('stack')}</div>
          </div>
        )}

        <ShotLightbox
          open={zoomOpen}
          onOpenChange={handleZoomOpenChange}
          step={step}
          title={`${stepLabel} · ${title}`}
          alt={alt}
          labelOf={labelOf}
          detailOf={detailOf}
          active={zoomActive}
          onActiveChange={setZoomActive}
          revealOnOpen={zoomFrom}
          returnFocusRef={returnFocusRef}
        />
      </article>
    </I18nextProvider>
  );
}

export default DtfStepBlock;
