import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Factory, List, ListChecks, Menu, ScanLine } from 'lucide-react';
import { RoleType } from 'shared';

import { PATHS } from '@/constants/paths';

import { useSidebarBadgeStore } from '@/store/sidebarBadgeStore';

import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

interface Tab {
  key: string;
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | null;
}

/**
 * Roles whose phone users get the bottom tab bar (they own a task board).
 * Deliberately NOT every role: these people work standing at a station and need thumb reach, while
 * Admin/Manager need the full drawer menu more than four fixed tabs. Do not widen this to all roles.
 */
export const TAB_BAR_ROLES: string[] = [RoleType.Designer, RoleType.DesignerLeader, RoleType.Fulfillment];

/**
 * Bottom tab bar on phones for the roles that work from a task board — Fulfillment workers at
 * the station and designers, 41 of 53 production users (DesignSystem-LegacyParity.md §10).
 * Their few daily destinations sit in thumb reach instead of behind the drawer; "More" opens
 * the full drawer menu. Admins and managers keep the drawer only: they rarely work on a phone
 * and need the full menu more than speed.
 *
 * Tabs ≥ 56px tall (above the 44pt touch minimum) and padded by `env(safe-area-inset-bottom)`
 * so the home indicator never covers them.
 */
export function MobileTabBar({ roleName, onMore }: { roleName?: string; onMore: () => void }) {
  const { t } = useTranslation('layout');
  const { has, isAdmin } = usePermission();
  const location = useLocation();
  const errorLogTodo = useSidebarBadgeStore((s) => s.counts?.errorLogTodo);

  const errorTab: Tab = {
    key: 'errors',
    to: PATHS.ORDERS_ERROR_LOG,
    label: t('tabBar.errors'),
    icon: <AlertTriangle size={20} />,
    badge: errorLogTodo,
  };
  const tabs: Tab[] =
    roleName === RoleType.Fulfillment
      ? [
          { key: 'tasks', to: PATHS.FULFILLMENT_MY_TASKS, label: t('tabBar.tasks'), icon: <Factory size={20} /> },
          ...(isAdmin || has('page.scan_error')
            ? [{ key: 'scan', to: PATHS.ORDERS_SCAN_ERROR, label: t('tabBar.scan'), icon: <ScanLine size={20} /> }]
            : []),
          errorTab,
        ]
      : [
          { key: 'tasks', to: PATHS.MY_TASKS, label: t('tabBar.tasks'), icon: <ListChecks size={20} /> },
          errorTab,
          { key: 'orders', to: PATHS.ORDERS_WORKSHOP, label: t('tabBar.orders'), icon: <List size={20} /> },
        ];

  const itemClass = (active: boolean) =>
    cn(
      'relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
      'bg-transparent border-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nav-accent',
      active ? 'text-nav-accent' : 'text-nav-text',
    );

  return (
    <nav
      aria-label={t('tabBar.label')}
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      {tabs.map((tab) => {
        const active = location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
        return (
          <Link key={tab.key} to={tab.to} className={itemClass(active)} aria-current={active ? 'page' : undefined}>
            <span className="relative">
              {tab.icon}
              {!!tab.badge && tab.badge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </span>
            {tab.label}
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className={itemClass(false)}>
        <Menu size={20} />
        {t('tabBar.more')}
      </button>
    </nav>
  );
}
