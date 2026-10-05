import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { AlertTriangle } from 'lucide-react';
import type { OverdueAlert } from 'shared';
import { RoleType } from 'shared';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';
import { useSidebarBadgeStore } from '@/store/sidebarBadgeStore';

import { RepositoryRemote } from '@/services';

// MIRROR OVERDUE_ALERT_ROLES ở designer-stats.controller.ts — đổi 1 nơi phải đổi nơi kia.
const OVERDUE_ROLES: string[] = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.SupportManager,
  RoleType.Support,
  RoleType.DesignerLeader,
  RoleType.Designer,
];

// Tab "Soát tool" dashboard chỉ Support + quản lý (mirror TOOL_CHECK_ROLES BE) —
// designer bấm vào sẽ bị chặn nên với họ segment này chỉ là text.
const TOOL_CHECK_LINK_ROLES: string[] = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.SupportManager,
  RoleType.Support,
];

const OVERDUE_POLL_MS = 60_000;
// Mutation bump store (axios interceptor) → debounce gộp các call liên tiếp, cùng nhịp Sidebar badge.
const OVERDUE_DEBOUNCE_MS = 1_200;

/**
 * Banner đỏ toàn cục "quá hạn 2 ngày" — luôn hiện trên đầu mọi trang (dưới
 * Header, KHÔNG tắt được) khi còn đơn `inProductionAt` từ 2 ngày trước trở về
 * trước chưa soát tool / chưa gán / designer chưa làm xong. Admin + Support +
 * Designer cùng thấy CHUNG số toàn hệ thống (kèm tên designer đang tồn) để
 * mọi người chủ động thúc nhau xử lý. Xem OverdueAlertBanner.md.
 */
function OverdueAlertBanner() {
  const { t } = useTranslation('layout');
  const profile = useAuthStore((s) => s.profile);
  const refreshRequestedAt = useSidebarBadgeStore((s) => s.refreshRequestedAt);
  const [alert, setAlert] = useState<OverdueAlert | null>(null);

  const roleName = profile?.role?.name as string | undefined;
  const canSee = !!roleName && OVERDUE_ROLES.includes(roleName);
  const isDesigner = roleName === RoleType.Designer;

  useEffect(() => {
    if (!canSee) return undefined;
    let cancelled = false;
    const fetchAlert = async () => {
      try {
        const res = await RepositoryRemote.designer.overdueAlert();
        if (!cancelled) setAlert(res.data?.data ?? null);
      } catch {
        // Poll nền — lỗi tạm thời giữ số cũ, không toast spam.
      }
    };
    fetchAlert();
    // Poll only while the tab is visible — like the Sidebar. Forgotten background
    // tabs were the source of 85% of the 403s after every session invalidation.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchAlert();
    }, OVERDUE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [canSee]);

  useEffect(() => {
    if (!canSee || !refreshRequestedAt) return undefined;
    const id = setTimeout(async () => {
      try {
        const res = await RepositoryRemote.designer.overdueAlert();
        setAlert(res.data?.data ?? null);
      } catch {
        // như trên
      }
    }, OVERDUE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [canSee, refreshRequestedAt]);

  if (!canSee || !alert) return null;
  const total = alert.toolCheckUnreviewed + alert.designerUnassigned + alert.designerBacklog;
  if (total <= 0) return null;

  const cutoffLabel = dayjs(alert.cutoffDay).format('DD/MM');
  const designerTarget = isDesigner ? PATHS.MY_TASKS : `${PATHS.HOME}?tab=designer`;
  const segmentClass = 'underline underline-offset-2 decoration-white/70 hover:decoration-white font-bold';

  const segments: React.ReactNode[] = [];
  if (alert.toolCheckUnreviewed > 0) {
    const label = t('overdueAlert.toolCheck', { count: alert.toolCheckUnreviewed });
    segments.push(
      TOOL_CHECK_LINK_ROLES.includes(roleName!) ? (
        <Link key="tool" to={`${PATHS.HOME}?tab=tool-check`} className={segmentClass}>
          {label}
        </Link>
      ) : (
        <span key="tool" className="font-bold">
          {label}
        </span>
      ),
    );
  }
  if (alert.designerUnassigned > 0) {
    segments.push(
      <Link key="unassigned" to={`${PATHS.HOME}?tab=designer`} className={segmentClass}>
        {t('overdueAlert.unassigned', { count: alert.designerUnassigned })}
      </Link>,
    );
  }
  if (alert.designerBacklog > 0) {
    segments.push(
      <span key="backlog">
        <Link to={designerTarget} className={segmentClass}>
          {t('overdueAlert.backlog', { count: alert.designerBacklog })}
        </Link>
        {alert.byDesigner.length > 0 && (
          <>
            {/* Names are what a manager acts on, so they never get cut mid-word: wide screens list everyone,
                from 1400px up the first two plus "+N", narrower ones leave the names to the designer tab
                behind the count link. The breakpoints are measured: the line must fit without clipping. */}
            <span className="hidden font-semibold min-[1700px]:inline">
              {' '}
              ({alert.byDesigner.map((d) => `${d.name} ${d.count}`).join(' · ')})
            </span>
            <span className="hidden font-semibold min-[1400px]:inline min-[1700px]:hidden">
              {' '}
              ({alert.byDesigner.slice(0, 2).map((d) => `${d.name} ${d.count}`).join(' · ')}
              {alert.byDesigner.length > 2 &&
                ` · ${t('overdueAlert.moreDesigners', { count: alert.byDesigner.length - 2 })}`}
              )
            </span>
          </>
        )}
      </span>,
    );
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 bg-red-600 text-white px-4 py-2.5 text-sm min-[1400px]:max-[1699px]:text-[13px] shadow-md z-20 shrink-0"
    >
      <AlertTriangle size={20} className="shrink-0 animate-pulse" />
      {/* From md up the alert is ONE line (it sits above every page, so each extra line costs data area);
            the call to action only shows on very wide screens and the tail is clipped if it still overflows. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 md:flex-nowrap md:overflow-hidden md:whitespace-nowrap">
        <span className="font-extrabold uppercase tracking-wide">{t('overdueAlert.title', { date: cutoffLabel })}</span>
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="opacity-70">•</span>}
            {seg}
          </React.Fragment>
        ))}
        <span className="opacity-90 md:hidden min-[1700px]:inline">{t('overdueAlert.callToAction')}</span>
      </div>
    </div>
  );
}

export default OverdueAlertBanner;
