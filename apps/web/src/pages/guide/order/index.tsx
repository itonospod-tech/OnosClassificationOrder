import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ChevronDown, ClipboardList, FileSpreadsheet, Rocket } from 'lucide-react';

import { PATHS } from '@/constants/paths';

import BackToTop from '@/components/public/BackToTop';
import PillLink from '@/components/public/PillLink';
import PublicFooter from '@/components/public/PublicFooter';
import PublicHeader from '@/components/public/PublicHeader';
import Reveal from '@/components/public/Reveal';
import SectionHeading from '@/components/public/SectionHeading';
import Swoosh from '@/components/public/Swoosh';

import { cn } from '@/utils/cn';

import GuideStepBlock from './GuideStepBlock';
import type { GuideFlowId } from './guideSteps';
import { GUIDE_FLOWS } from './guideSteps';

const FLOW_ICONS: Record<GuideFlowId, LucideIcon> = {
  form: ClipboardList,
  push: Rocket,
  import: FileSpreadsheet,
};

/** Chỉ những điều đã kiểm chứng trong code apps/seller + apps/api — xem OrderGuide.md §4.4. */
const FAQ_KEYS = ['notInProduction', 'designRequired', 'editCancel', 'shareTracking', 'importDuplicates'] as const;

type NavId = GuideFlowId | 'faq';
const NAV_IDS: NavId[] = [...GUIDE_FLOWS.map((f) => f.id), 'faq'];
const sectionId = (id: NavId) => (id === 'faq' ? 'faq' : `flow-${id}`);

/**
 * Link tra cứu mà seller chép ở trang chi tiết đơn là `/track/<mã>` trên CHÍNH domain Seller Portal
 * (`apps/seller` `order-detail-view.tsx` → `window.location.origin`), và ảnh bước này chụp đúng trang đó.
 * Có `VITE_SELLER_URL` → nút mở trang tra cứu của seller để ẢNH và NÚT là một trang; không có (dev chưa
 * cấu hình) → fallback `/track` của apps/web. Xem OrderGuide.md §4.6.
 */
const SELLER_URL = ((import.meta.env.VITE_SELLER_URL as string | undefined) ?? '').replace(/\/+$/, '');
const TRACK_LINK = SELLER_URL ? { href: `${SELLER_URL}/track` } : { to: PATHS.TRACK };

/** Mép trên section vượt quá dòng này (tính từ đỉnh màn hình) thì section đó là mục đang xem. */
const NAV_LINE_RATIO = 0.4;

/**
 * Trang hướng dẫn khách lên đơn — `/guide/ordering` (`PATHS.ORDER_GUIDE`), public, 100% tĩnh (không gọi API).
 * Ảnh là ảnh chụp THẬT của Seller Portal ở `public/guide/order/`, sinh bằng
 * `apps/seller/scripts/capture-order-guide.mjs`. Tài liệu: `OrderGuide.md`.
 */
function OrderGuidePage() {
  const { t } = useTranslation('orderGuide');
  const [activeNav, setActiveNav] = useState<NavId>('form');
  /** Đang nhảy tới mục vừa bấm → bỏ qua tính theo vị trí cuộn cho tới khi cuộn xong. */
  const lockedRef = useRef(false);
  const lockTimerRef = useRef<number | undefined>(undefined);
  /** Khung cuộn ngang của thanh chuyển luồng (điện thoại không đủ chỗ cho cả 4 mục). */
  const navScrollerRef = useRef<HTMLDivElement>(null);

  const syncNavFromScroll = useCallback(() => {
    const line = window.innerHeight * NAV_LINE_RATIO;
    let current: NavId = NAV_IDS[0];
    NAV_IDS.forEach((id) => {
      const el = document.getElementById(sectionId(id));
      if (el && el.getBoundingClientRect().top <= line) current = id;
    });
    setActiveNav(current);
  }, []);

  const releaseLockAfter = useCallback(
    (ms: number) => {
      window.clearTimeout(lockTimerRef.current);
      lockTimerRef.current = window.setTimeout(() => {
        lockedRef.current = false;
        syncNavFromScroll();
      }, ms);
    },
    [syncNavFromScroll],
  );

  /** Bấm mục trên thanh luồng / thẻ ở hero: sáng NGAY mục đó, giữ nguyên trong lúc trang cuộn tới. */
  const jumpTo = (id: NavId) => {
    setActiveNav(id);
    lockedRef.current = true;
    releaseLockAfter(800);
  };

  // Thanh chuyển luồng dính: sáng mục của section có mép trên đã qua 40% màn hình (tính theo vị trí cuộn —
  // IntersectionObserver cũ không bắn khi nhảy neo làm mục sáng kẹt ở mục cũ).
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (lockedRef.current) {
        releaseLockAfter(200);
        return;
      }
      if (!frame) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          syncNavFromScroll();
        });
      }
    };
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      syncNavFromScroll();
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(lockTimerRef.current);
    };
  }, [releaseLockAfter, syncNavFromScroll]);

  // Mục sáng đổi (do cuộn hoặc do bấm) → cuộn NGANG thanh luồng để mục đó lọt hết vào khung (TEST-04 BUG-2: ở 360/390
  // "3 Import file" nằm ngoài khung, scrollLeft vẫn 0). Chỉ đặt scrollLeft của chính thanh — `scrollIntoView` trên
  // phần tử trong thanh `sticky` có thể kéo cả trang cuộn dọc.
  useEffect(() => {
    const scroller = navScrollerRef.current;
    const link = scroller?.querySelector<HTMLElement>(`[data-nav-id="${activeNav}"]`);
    if (!scroller || !link || scroller.scrollWidth <= scroller.clientWidth) return;
    const s = scroller.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    // Lề = padding `px-4` của thanh → mục đầu/cuối vẫn cách mép khung như lúc chưa cuộn.
    const pad = 16;
    let delta = 0;
    if (l.left < s.left + pad) delta = l.left - s.left - pad;
    else if (l.right > s.right - pad) delta = l.right - s.right + pad;
    if (Math.abs(delta) < 1) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ left: scroller.scrollLeft + delta, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [activeNav]);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <PublicHeader />

      <main className="flex-1">
        {/* ---- Hero ---- */}
        <section className="relative overflow-hidden bg-white">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-brand-100/70 blur-3xl"
          />
          <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-12 lg:pb-20 lg:pt-16">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">{t('hero.eyebrow')}</p>
              <h1 className="mt-3 max-w-3xl font-display text-[2rem] font-medium leading-[1.14] tracking-tight text-[#0f110f] sm:text-5xl">
                {t('hero.titleLead')}{' '}
                <span className="relative inline-block whitespace-nowrap">
                  {t('hero.titleAccent')}
                  <Swoosh />
                </span>
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">{t('hero.subtitle')}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <PillLink to={PATHS.CUSTOMER_REGISTER}>{t('actions.order')}</PillLink>
                <PillLink to={PATHS.CUSTOMER_LOGIN} variant="outline" withArrow={false}>
                  {t('actions.signIn')}
                </PillLink>
              </div>
              <p className="mt-4 max-w-2xl text-xs leading-relaxed text-slate-400">{t('hero.uiNote')}</p>
            </Reveal>

            <ol className="mt-12 grid gap-4 md:grid-cols-3">
              {GUIDE_FLOWS.map((flow, index) => {
                const Icon = FLOW_ICONS[flow.id];
                return (
                  <li key={flow.id}>
                    <Reveal delay={index * 90} className="h-full">
                      <a
                        href={`#${sectionId(flow.id)}`}
                        onClick={() => jumpTo(flow.id)}
                        className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                      >
                        <span className="flex items-center justify-between">
                          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                            <Icon size={19} aria-hidden />
                          </span>
                          <span className="font-display text-2xl font-medium text-brand-200">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                        </span>
                        <span className="mt-4 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-brand-600">
                          {t('hero.flowLabel', { n: index + 1 })}
                        </span>
                        <span className="mt-1 font-display text-lg font-medium leading-snug text-[#0f110f]">
                          {t(`flows.${flow.id}.cardTitle`)}
                        </span>
                        <span className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
                          {t(`flows.${flow.id}.cardDesc`)}
                        </span>
                        <span className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-slate-500 group-hover:text-brand-600">
                          {t('hero.stepCount', { count: flow.steps.length })}
                          <ArrowDown
                            size={14}
                            aria-hidden
                            className="transition-transform group-hover:translate-y-0.5 motion-reduce:transition-none"
                          />
                        </span>
                      </a>
                    </Reveal>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Khối bao thanh luồng + 3 luồng + FAQ: thanh luồng chỉ dính TRONG khối này. Để thẳng trong <main> thì ở
            cuối trang nó bị đẩy xuống đáy <main> → dải trắng giữa CTA tối và footer (TEST-02, 390px). */}
        <div>
        {/* ---- Thanh chuyển luồng dính (dưới header sticky h-16 / lg:h-20) ---- */}
        <nav
          aria-label={t('nav.label')}
          className="sticky top-16 z-40 border-y border-slate-200 bg-white/95 backdrop-blur lg:top-20"
        >
          <div
            ref={navScrollerRef}
            className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 py-2.5 [scrollbar-width:none]"
          >
            {NAV_IDS.map((id, index) => {
              const isActive = activeNav === id;
              return (
                <a
                  key={id}
                  data-nav-id={id}
                  href={`#${sectionId(id)}`}
                  onClick={() => jumpTo(id)}
                  aria-current={isActive ? 'location' : undefined}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
                    isActive ? 'bg-brand-600 text-white' : 'text-[#0f110f] hover:bg-brand-50 hover:text-brand-700',
                  )}
                >
                  {id !== 'faq' && (
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full text-[0.62rem]',
                        isActive ? 'bg-white/20' : 'bg-brand-50 text-brand-600',
                      )}
                    >
                      {index + 1}
                    </span>
                  )}
                  {t(`nav.${id}`)}
                </a>
              );
            })}
          </div>
        </nav>

        {/* ---- 3 luồng ---- */}
        {GUIDE_FLOWS.map((flow, flowIndex) => (
          <section
            key={flow.id}
            id={sectionId(flow.id)}
            aria-label={t(`flows.${flow.id}.cardTitle`)}
            className={cn('scroll-mt-28 lg:scroll-mt-32', flowIndex % 2 === 0 ? 'bg-slate-50/70' : 'bg-white')}
          >
            <div className="mx-auto max-w-6xl px-4 py-16 lg:py-20">
              <SectionHeading
                eyebrow={t('hero.flowLabel', { n: flowIndex + 1 })}
                lead={t(`flows.${flow.id}.titleLead`)}
                accent={t(`flows.${flow.id}.titleAccent`)}
                subtitle={t(`flows.${flow.id}.subtitle`)}
              />
              {/* Lề phải chừa chỗ nút "lên đầu trang" nổi (right-6 + 44px) để nó không đè huy hiệu sát mép ảnh;
                  từ 1280px cột nội dung đã cách mép màn đủ xa nên bỏ lề. Dưới 720px không đủ chỗ chừa. */}
              <ol className="mt-12 min-w-0 space-y-16 min-[720px]:pr-16 lg:space-y-20 min-[1280px]:pr-0">
                {flow.steps.map((step, stepIndex) => (
                  <li key={step.id}>
                    <GuideStepBlock
                      flowId={flow.id}
                      step={step}
                      index={stepIndex}
                      total={flow.steps.length}
                      eager={flowIndex === 0 && stepIndex === 0}
                      extra={
                        flow.id === 'push' && step.id === 'track' ? (
                          <PillLink {...TRACK_LINK} variant="outline" size="sm">
                            {t('flows.push.openTrack')}
                          </PillLink>
                        ) : undefined
                      }
                    />
                  </li>
                ))}
              </ol>
            </div>
          </section>
        ))}

        {/* ---- Hỏi đáp ---- */}
        <section id="faq" className="scroll-mt-28 bg-white lg:scroll-mt-32">
          <div className="mx-auto max-w-3xl px-4 py-16 lg:py-20">
            <SectionHeading
              align="center"
              eyebrow={t('faq.eyebrow')}
              lead={t('faq.titleLead')}
              accent={t('faq.titleAccent')}
            />
            <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
              {FAQ_KEYS.map((key) => (
                <details key={key} className="group px-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-4 font-display text-base font-medium text-[#0f110f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
                    {t(`faq.items.${key}.q`)}
                    <ChevronDown
                      size={18}
                      aria-hidden
                      className="shrink-0 text-brand-600 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    />
                  </summary>
                  <p className="pb-5 text-sm leading-relaxed text-slate-600">{t(`faq.items.${key}.a`)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        </div>

        {/* ---- CTA cuối ---- */}
        <section className="bg-ink-900">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center lg:py-20">
            <Reveal>
              <h2 className="mx-auto max-w-2xl font-display text-[1.75rem] font-medium leading-tight tracking-tight text-white sm:text-4xl">
                {t('cta.title')}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70">{t('cta.subtitle')}</p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <PillLink to={PATHS.CUSTOMER_REGISTER} variant="onDark">
                  {t('actions.order')}
                </PillLink>
                <PillLink to={PATHS.CUSTOMER_LOGIN} variant="outlineDark" withArrow={false}>
                  {t('actions.signIn')}
                </PillLink>
              </div>
              <p className="mt-6 text-sm text-white/55">
                {t('cta.support')}{' '}
                <a
                  href={`mailto:${t('footer.contact.email', { ns: 'landing' })}`}
                  className="font-semibold text-white transition-colors hover:text-brand-300"
                >
                  {t('footer.contact.email', { ns: 'landing' })}
                </a>
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      <PublicFooter />
      <BackToTop />
    </div>
  );
}

export default OrderGuidePage;
