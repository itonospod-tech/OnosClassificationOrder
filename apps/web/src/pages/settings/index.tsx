import React, { lazy, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Bell, Bot, Flag, Package, Settings as SettingsIcon, Truck, UserCog, Users } from 'lucide-react';

import { PATHS } from '@/constants/paths';

import { PageHeader } from '@/components/common/PageHeader';
import { Spinner } from '@/components/common/Spinner';

import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

// Lazy theo mục — chỉ mount (và fetch data) mục đang mở.
const CustomerAssignmentConfig = lazy(() => import('@/components/settings/CustomerAssignmentConfig'));
const CustomerPriorityConfig = lazy(() => import('@/components/settings/CustomerPriorityConfig'));
const DesignerAssignmentConfig = lazy(() => import('@/components/settings/DesignerAssignmentConfig'));
const ProductFactoryKanban = lazy(() => import('@/components/settings/ProductFactoryKanban'));
const CustomerNotificationSender = lazy(() => import('@/components/settings/CustomerNotificationSender'));
const AgentApiGuide = lazy(() => import('@/components/settings/AgentApiGuide'));
const VnpShippingConfig = lazy(() => import('@/components/settings/VnpShippingConfig'));

interface SettingsSection {
  key: string; // segment URL /adm/settings/<key>
  label: string;
  icon: React.ReactNode;
  perm: string;
  /** true = CHỈ role Admin/SuperAdmin thấy — perm cấp qua custom role không đủ. */
  adminOnly?: boolean;
  component: React.ComponentType;
}
interface SettingsGroup {
  label: string;
  items: SettingsSection[];
}

/**
 * Registry mục cài đặt — thêm mục mới chỉ cần thêm 1 entry (URL, quyền, lazy
 * component tự có). Nhóm mới → thêm 1 group.
 */
function buildGroups(t: (key: string) => string): SettingsGroup[] {
  return [
    {
      label: t('settings.groups.autoAssign'),
      items: [
        {
          key: 'customer-factory',
          label: t('settings.nav.customerFactory'),
          icon: <Users size={15} />,
          perm: 'role.manage',
          // BE là `@Auth([RoleType.Admin])` — Manager mở được menu thì mọi API trả
          // 403 và trang hiện RỖNG y như "chưa cấu hình gì", không báo lỗi nào.
          adminOnly: true,
          component: CustomerAssignmentConfig,
        },
        {
          key: 'customer-priority',
          label: t('settings.nav.customerPriority'),
          icon: <Flag size={15} />,
          perm: 'role.manage',
          // BE là `@Auth([RoleType.Admin])` — Manager mở được menu thì mọi API trả
          // 403 và trang hiện RỖNG y như "chưa cấu hình gì", không báo lỗi nào.
          adminOnly: true,
          component: CustomerPriorityConfig,
        },
        {
          key: 'designer-assign',
          label: t('settings.nav.designerAssign'),
          icon: <UserCog size={15} />,
          perm: 'role.manage',
          // BE là `@Auth([RoleType.Admin])` — Manager mở được menu thì mọi API trả
          // 403 và trang hiện RỖNG y như "chưa cấu hình gì", không báo lỗi nào.
          adminOnly: true,
          component: DesignerAssignmentConfig,
        },
        {
          key: 'product-factory',
          label: t('settings.nav.productFactory'),
          icon: <Package size={15} />,
          perm: 'role.manage',
          component: ProductFactoryKanban,
        },
      ],
    },
    {
      label: t('settings.groups.notification'),
      items: [
        {
          key: 'customer-notify',
          label: t('settings.nav.customerNotify'),
          icon: <Bell size={15} />,
          perm: 'role.manage',
          // BE là `@Auth([RoleType.Admin])` — Manager mở được menu thì mọi API trả
          // 403 và trang hiện RỖNG y như "chưa cấu hình gì", không báo lỗi nào.
          adminOnly: true,
          component: CustomerNotificationSender,
        },
      ],
    },
    {
      label: t('settings.groups.system'),
      items: [
        {
          // API-3 — CHI SuperAdmin/Admin. `page.agent_api` da loai tru Manager
          // tuong minh o permission-catalog (AC-02); dung `role.manage` nhu cac
          // muc khac se cho Manager vao.
          key: 'agent-api',
          label: t('settings.nav.agentApi'),
          icon: <Bot size={15} />,
          perm: 'page.agent_api',
          component: AgentApiGuide,
        },
        {
          key: 'vnp-shipping',
          label: t('settings.nav.vnpShipping'),
          icon: <Truck size={15} />,
          perm: 'role.manage',
          adminOnly: true,
          component: VnpShippingConfig,
        },
      ],
    },
  ];
}

export default function Settings() {
  const { t } = useTranslation('auth');
  const { has, isAdmin } = usePermission();
  const { section } = useParams();

  const groups = useMemo(() => {
    return buildGroups(t)
      .map((g) => ({ ...g, items: g.items.filter((it) => (it.adminOnly ? isAdmin : has(it.perm))) }))
      .filter((g) => g.items.length > 0);
  }, [t, has, isAdmin]);

  const allItems = groups.flatMap((g) => g.items);
  const active = allItems.find((it) => it.key === section);

  if (allItems.length > 0 && !active) {
    return <Navigate to={`${PATHS.SETTINGS}/${allItems[0].key}`} replace />;
  }

  const ActiveComponent = active?.component;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<SettingsIcon size={20} />}
        title={t('settings.title')}
        description={t('settings.subtitle')}
      />

      {allItems.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border border-slate-100 dark:border-slate-700/60 text-center">
          <p className="text-slate-500 dark:text-slate-400">{t('settings.noAccess')}</p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row items-start gap-4">
          <aside className="w-full lg:w-60 shrink-0 lg:sticky lg:top-4 space-y-4">
            {groups.map((g) => (
              <div key={g.label} className="space-y-1">
                <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
                {g.items.map((it) => {
                  const isActive = it.key === active?.key;
                  return (
                    <Link
                      key={it.key}
                      to={`${PATHS.SETTINGS}/${it.key}`}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                        isActive
                          ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-medium'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60',
                      )}
                    >
                      <span className={cn(isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400')}>
                        {it.icon}
                      </span>
                      <span className="truncate">{it.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </aside>

          <div className="flex-1 min-w-0 w-full bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700/60">
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-12">
                  <Spinner size={20} className="text-muted-foreground" />
                </div>
              }
            >
              {ActiveComponent && <ActiveComponent />}
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
