import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Info } from 'lucide-react';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';

import { cn } from '@/utils/cn';

import { useSidebarResetSignal } from '@/hooks/useSidebarResetSignal';

import DtfFlowDiagram from './DtfFlowDiagram';
import type { DtfRoleId } from './dtfGuideRoles';
import { DTF_ROLE_BY_ID, DTF_ROLE_IDS, DTF_ROLES, dtfRoleAnchorId, isDtfRoleId, userDtfRole } from './dtfGuideRoles';
import DtfRoleSection from './DtfRoleSection';
import { pickerOffset, scrollToElement, scrollToTopOf } from './dtfScroll';

interface SelectOptions {
  /** Cuộn tới đầu phần vai (`ifHidden`: chỉ khi đầu phần đang khuất phía trên thanh chọn vai). */
  scroll?: 'force' | 'ifHidden';
  /** Nút vừa bấm nằm trong phần vai cũ (sẽ bị gỡ) → đưa focus về tiêu đề vai mới. */
  focusHeading?: boolean;
}

/**
 * Hướng dẫn quy trình DTF theo vai — `/ffm/guide/dtf` (`PATHS.DTF_GUIDE`), trang NỘI BỘ, 100% tĩnh (không gọi API).
 * Ảnh chụp thật `apps/web` trên dữ liệu demo ở `public/guide/dtf/`. Vai đang xem nằm trên URL `?role=`; không có thì
 * mở vai của tài khoản đang đăng nhập (`userDtfRole`). Tài liệu: DtfRoleGuide.md.
 */
function DtfGuidePage() {
  const { t } = useTranslation('dtfGuide');
  const roleName = useAuthStore((s) => s.profile?.role?.name);
  const stage = useAuthStore((s) => s.profile?.fulfillmentStage);
  const [searchParams, setSearchParams] = useSearchParams();

  const userRole = userDtfRole(roleName, stage);
  const urlRole = searchParams.get('role');
  const activeRole: DtfRoleId = isDtfRoleId(urlRole) ? urlRole : (userRole ?? DTF_ROLE_IDS[0]);

  const topRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pillScrollerRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<SelectOptions | null>(null);

  /** Cuộn/focus theo yêu cầu đang chờ — chạy SAU khi phần vai mới đã render. */
  const applyPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const section = document.getElementById(dtfRoleAnchorId(activeRole));
    if (!section) return;
    if (pending.scroll) {
      const pickerBottom = pickerRef.current?.getBoundingClientRect().bottom ?? 0;
      if (pending.scroll === 'force' || section.getBoundingClientRect().top < pickerBottom) {
        scrollToElement(section, pickerOffset());
      }
    }
    if (pending.focusHeading) {
      document.getElementById(`${dtfRoleAnchorId(activeRole)}-title`)?.focus({ preventScroll: true });
    }
  }, [activeRole]);

  useEffect(() => {
    applyPending();
  }, [applyPending]);

  const selectRole = useCallback(
    (id: DtfRoleId, options: SelectOptions = {}) => {
      pendingRef.current = options;
      if (id === activeRole) {
        applyPending();
        return;
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('role', id);
          return next;
        },
        { replace: true },
      );
    },
    [activeRole, applyPending, setSearchParams],
  );

  // Bấm lại menu "Hướng dẫn DTF" đang active → bỏ `?role=` (về vai của tài khoản) + lên đầu trang (Orders.md §20).
  useSidebarResetSignal(PATHS.DTF_GUIDE, () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('role');
        return next;
      },
      { replace: true },
    );
    scrollToTopOf(topRef.current);
  });

  // Vai sáng đổi → cuộn NGANG thanh chọn vai để nút đó lọt khung (điện thoại không đủ chỗ cho 8 nút). Chỉ đặt
  // scrollLeft của chính thanh — `scrollIntoView` trên phần tử trong thanh sticky kéo cả trang cuộn dọc.
  useEffect(() => {
    const scroller = pillScrollerRef.current;
    const pill = scroller?.querySelector<HTMLElement>(`[data-role="${activeRole}"]`);
    if (!scroller || !pill || scroller.scrollWidth <= scroller.clientWidth) return;
    const s = scroller.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    const pad = 8;
    let delta = 0;
    if (p.left < s.left + pad) delta = p.left - s.left - pad;
    else if (p.right > s.right - pad) delta = p.right - s.right + pad;
    if (Math.abs(delta) >= 1) scroller.scrollTo({ left: scroller.scrollLeft + delta });
  }, [activeRole]);

  return (
    <div ref={topRef} className="mx-auto w-full min-w-0 max-w-6xl space-y-6 pb-12">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BookOpen size={20} aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-3xl break-words text-sm leading-relaxed text-muted-foreground">{t('subtitle')}</p>
        </div>
      </header>

      <div className="flex gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <Info size={15} className="mt-px shrink-0" aria-hidden />
        <p className="min-w-0 break-words">
          {t('demoNote')} {t('uiNote')}
        </p>
      </div>

      <DtfFlowDiagram activeRole={activeRole} onSelect={(id) => selectRole(id, { scroll: 'force' })} />

      {/* Thanh chọn vai dính đầu vùng cuộn (<main> là khung cuộn của MainLayout). `-mx`/`px` bằng padding của <main>
          để nền thanh phủ kín bề ngang, `-top` bằng padding-top để thanh dính sát mép trên. */}
      <div
        ref={pickerRef}
        data-dtf-picker
        className="sticky -top-4 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur md:-top-6 md:-mx-6 md:px-6"
      >
        <div
          ref={pillScrollerRef}
          role="group"
          aria-label={t('picker.label')}
          className="flex gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]"
        >
          {DTF_ROLES.map((role) => {
            const Icon = role.icon;
            const isActive = role.id === activeRole;
            return (
              <button
                key={role.id}
                type="button"
                data-role={role.id}
                aria-pressed={isActive}
                onClick={() => selectRole(role.id, { scroll: 'ifHidden' })}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon size={14} aria-hidden />
                {t(`roles.${role.id}.short`)}
                {role.id === userRole && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide',
                      isActive ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary',
                    )}
                  >
                    {t('picker.yours')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <DtfRoleSection
        key={activeRole}
        role={DTF_ROLE_BY_ID[activeRole]}
        onSelectRole={(id) => selectRole(id, { scroll: 'force', focusHeading: true })}
      />
    </div>
  );
}

export default DtfGuidePage;
