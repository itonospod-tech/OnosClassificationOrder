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

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
  const linkClass = 'font-bold underline underline-offset-2 decoration-red-300 hover:decoration-red-600 dark:decoration-red-400/60';

  // Same three facts as the old red strip, one per line; nothing was dropped, only moved behind the chip.
  const rows: React.ReactNode[] = [];
  if (alert.toolCheckUnreviewed > 0) {
    const label = t('overdueAlert.toolCheck', { count: alert.toolCheckUnreviewed });
    rows.push(
      TOOL_CHECK_LINK_ROLES.includes(roleName!) ? (
        <Link key="tool" to={`${PATHS.HOME}?tab=tool-check`} className={linkClass}>
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
    rows.push(
      <Link key="unassigned" to={`${PATHS.HOME}?tab=designer`} className={linkClass}>
        {t('overdueAlert.unassigned', { count: alert.designerUnassigned })}
      </Link>,
    );
  }
  if (alert.designerBacklog > 0) {
    rows.push(
      <div key="backlog">
        <Link to={designerTarget} className={linkClass}>
          {t('overdueAlert.backlog', { count: alert.designerBacklog })}
        </Link>
        {alert.byDesigner.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {alert.byDesigner.map((d) => (
              <li
                key={d.name}
                className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200"
              >
                {d.name} <span className="tabular-nums">{d.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>,
    );
  }

  // A chip in the header instead of a full-width strip: it still cannot be dismissed, is always red and always
  // there, but it no longer costs every page a 40px band (OverdueAlertBanner.md).
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t('overdueAlert.title', { date: cutoffLabel })}
          aria-label={t('overdueAlert.title', { date: cutoffLabel })}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-red-700 touch:h-9 sm:px-3"
        >
          <AlertTriangle size={14} className="animate-pulse" />
          <span className="tabular-nums">{total}</span>
          <span className="hidden sm:inline">{t('overdueAlert.chip')}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,420px)] p-0">
        <div className="rounded-t-md bg-red-600 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white">
          {t('overdueAlert.title', { date: cutoffLabel })}
        </div>
        <div className="space-y-2.5 px-3 py-3 text-sm">{rows.map((r, i) => <div key={i}>{r}</div>)}</div>
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t('overdueAlert.callToAction')}</div>
      </PopoverContent>
    </Popover>
  );
}

export default OverdueAlertBanner;
