import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  BarChart3,
  Barcode,
  Bell,
  BookOpen,
  Box,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  Contact,
  Crown,
  ExternalLink,
  Factory,
  FileDown,
  FileSearch,
  Frame,
  Lightbulb,
  List,
  ListChecks,
  LogOut,
  MapPin,
  MessageSquare,
  MessagesSquare,
  Package,
  PackageCheck,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Rows3,
  ScanLine,
  Scissors,
  Send,
  Settings,
  ShieldCheck,
  ShieldHalf,
  Shirt,
  Spline,
  Tag,
  TreePine,
  Truck,
  User,
  UserCog,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';
import { RoleType } from 'shared';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { cn } from '@/utils/cn';

import logoUrl from '@/assets/images/logo.png';

import { PATHS } from '../../constants/paths';
import { duocTruyCapZalo } from '../../constants/zaloAccess';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { RepositoryRemote } from '../../services';
import { useAuthStore } from '../../store/authStore';
import { useSidebarBadgeStore } from '../../store/sidebarBadgeStore';
import { useSidebarResetStore } from '../../store/sidebarResetStore';
import { handleAxiosError } from '../../utils';

/** Count badge on one sidebar entry (red = urgent, amber = waiting to be assigned/reworked). */
interface SidebarBadge {
  count: number;
  tone: 'red' | 'amber';
  title: string;
}

type BadgeMap = Record<string, SidebarBadge[]>;

const SIDEBAR_BADGE_POLL_MS = 60_000;
// A mutation bumps the store → wait briefly so back-to-back calls (bulk) collapse into one fetch.
const SIDEBAR_BADGE_DEBOUNCE_MS = 1_200;

async function fetchSidebarCounts(): Promise<void> {
  try {
    const res = await RepositoryRemote.designer.sidebarCounts();
    useSidebarBadgeStore.getState().setCounts(res.data?.data ?? null);
  } catch {
    // Background poll — on a transient error keep the old numbers, no toast spam.
  }
}

function BadgePill({ badge }: { badge: SidebarBadge }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold leading-none flex items-center justify-center shrink-0',
            badge.tone === 'red' ? 'bg-red-500 text-white' : 'bg-amber-400 text-amber-950',
          )}
        >
          {badge.count}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="whitespace-pre-line">
        {badge.title}
      </TooltipContent>
    </Tooltip>
  );
}

/** Colored dot on the icon corner when the sidebar / parent is collapsed — tooltip lists each count. */
function BadgeDot({ badges }: { badges: SidebarBadge[] }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'absolute top-1 right-1 w-2 h-2 rounded-full',
            badges.some((b) => b.tone === 'red') ? 'bg-red-500' : 'bg-amber-400',
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="right">
        {badges.map((b) => (
          <div key={b.title}>
            {b.title}: {b.count}
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/** Fold the children's badges into 2 pills (red/amber) for a collapsed parent row. */
function aggregateBadges(badges: SidebarBadge[]): SidebarBadge[] {
  const byTone = new Map<SidebarBadge['tone'], { count: number; titles: string[] }>();
  for (const b of badges) {
    const cur = byTone.get(b.tone) || { count: 0, titles: [] };
    cur.count += b.count;
    cur.titles.push(`${b.title}: ${b.count}`);
    byTone.set(b.tone, cur);
  }
  return (['red', 'amber'] as const)
    .filter((tone) => byTone.has(tone))
    .map((tone) => {
      const { count, titles } = byTone.get(tone)!;
      return { tone, count, title: titles.join('\n') };
    });
}

interface NavChild {
  key: string;
  label: string;
  to: string;
  icon: React.ReactNode;
  /** Permission code from PERMISSION_CATALOG. Empty = always visible. */
  perm?: string;
  /**
   * AUTH-7 — this page's `page.*` code, declared SEPARATELY when `perm` is an ACTION code.
   * The menu still shows/hides by `perm` as before (no entry changes); the route is
   * gated by `pagePerm` because the right to ENTER a page is broader than the right to ACT on it.
   */
  pagePerm?: string;
  /** Shown when the user has ANY of these perms (OR condition, instead of `perm`). */
  anyPerm?: string[];
  /** Role names to hide this entry from (on top of the `perm` check). */
  hideForRoles?: string[];
  /**
   * Shown ONLY to exactly these roles. Unlike `perm`: the `isAdmin` shortcut in
   * `allow()` lets both Admin and SuperAdmin through, so `perm` CANNOT narrow an
   * entry down to SuperAdmin alone. Used for Impersonate (AUTH-1 BR-1).
   */
  onlyForRoles?: string[];
  /** Also active on child routes of `to` (e.g. `/adm/settings/<section>`). */
  matchPrefix?: boolean;
  /** Small section caption rendered RIGHT ABOVE this entry (splits children within one group). */
  sectionBefore?: string;
  /** `to` is an absolute URL into another app (Seller Portal) — opens a new tab, bypasses the Router. */
  external?: boolean;
}

interface NavItem {
  key: string;
  label: string;
  to?: string;
  icon: React.ReactNode;
  children?: NavChild[];
  perm?: string;
  /** Shown ONLY to exactly these roles — see `NavChild.onlyForRoles`. */
  onlyForRoles?: string[];
  /** Hidden from these roles — see `NavChild.hideForRoles`. */
  hideForRoles?: string[];
  /** AUTH-7 — xem `NavChild.pagePerm`. */
  pagePerm?: string;
  /** Also active on child routes of `to` (e.g. `/adm/settings/<section>`). */
  matchPrefix?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const ADMIN_ROLES: string[] = [RoleType.SuperAdmin, RoleType.Admin];

/** Seller Portal (`apps/seller`) — currently the only place with a wallet admin page (`/hub/wallets`). */
const SELLER_URL = ((import.meta.env.VITE_SELLER_URL as string | undefined) ?? '').replace(/\/+$/, '');

/**
 * URL params matched BOTH WAYS in `isLinkActive` (every other param only needs
 * link ⊆ URL): entries sharing a path differ only by these — "All orders" vs
 * "3D", the shared cluster vs one factory. A one-way check would light the entry
 * WITHOUT the param together with the entry that has it. These are also the params
 * stripped from the "click again to clear filters" signal (`resetPathOf`), since pages register with the bare path.
 */
const SCOPE_PARAMS = ['factoryId', 'productLine', 'view'];

/**
 * AUTH-7 — lookup table "page path → permission code", built FROM the menu tree below.
 *
 * Deliberately NOT a second hand-written mapping: keeping menu and routes in sync
 * separately is exactly what produced the AUTH-7 bug (the menu hid an entry but typing
 * the URL still got in). One more table is one more place to forget to sync.
 *
 * A path NOT in the table ⇒ that page declares no permission ⇒ LET IN (keeps the old
 * behaviour). Defaulting to open is deliberate: a wrong block locks staff out of a page
 * they use every day, while a leaked page is still refused by the API itself.
 */
export function buildPagePermissionMap(t: TFunction<'layout'>): Map<string, string> {
  const map = new Map<string, string>();
  const put = (to: string | undefined, perm: string | undefined) => {
    if (!to || !perm) return;
    // ONLY accept `page.*` codes. Some menu entries are gated by ACTION codes (`workshop.manage`,
    // `user.manage`, `role.manage`, `order.import`) — those are stricter than the right to
    // ENTER the page: DesignerLeader has `page.workshop_config` but not `workshop.manage`, so
    // gating the route by that code would lock them out of a page they may enter.
    // Those entries declare their own `pagePerm` (the caller prefers it); an entry with no
    // page code at all leaves the route open as before — default is let in.
    if (!perm.startsWith('page.')) return;
    // Several entries point at the same page with `?tab=...`/`?productLine=...` — the route
    // only knows the path, so strip the query. Keep the FIRST entry seen: when entries on
    // the same page declare different perms (e.g. Dashboard), take the perm of the leading
    // entry (Reports › Production = `page.dashboard`), not the narrower perm of a tab inside it.
    const path = to.split('?')[0];
    if (!map.has(path)) map.set(path, perm);
  };
  for (const group of buildNavGroups(t)) {
    for (const item of group.items) {
      put(item.to ?? item.key, item.pagePerm ?? item.perm);
      for (const child of item.children ?? [])
        put(child.to, child.pagePerm ?? child.perm ?? item.pagePerm ?? item.perm);
    }
  }
  return map;
}

/**
 * Append `?factoryId=` to a production link. The base link may already carry a
 * query (`?tab=factory`), so pick the right separator.
 */
function withFactory(to: string, factoryId?: string): string {
  if (!factoryId) return to;
  return `${to}${to.includes('?') ? '&' : '?'}factoryId=${encodeURIComponent(factoryId)}`;
}

/** Append a query to a path that may already contain `?`. */
function withQuery(to: string, query: string): string {
  return `${to}${to.includes('?') ? '&' : '?'}${query}`;
}

/**
 * The 6 top-level groups from the CEO proposal of 01/10/2026 (`documents/Plans/MenuRestructure-CEO.md`):
 * Reports · Production · Tool · Ship · Wallet · HR. Phase 1B is ONLY the skeleton — many entries
 * still point at existing pages for now (e.g. the 6 product lines open the order list with
 * `?productLine=`, which the page does not filter on until phase 2A).
 *
 * The KEYS of the 3 badge-carrying entries (`orders-error-log`, `dash-designer`, `dash-tool-check`)
 * MUST stay unchanged — `badgeMap` attaches counts by key (SidebarBadges.md).
 *
 * Production-area links carry the `?factoryId=` chosen in the header factory picker
 * (`FactoryScopeSwitch`, Orders.md §25) so switching pages keeps the scope.
 */
function buildMainItems(t: TFunction<'layout'>, factoryId?: string): NavItem[] {
  const to = (path: string) => withFactory(path, factoryId);
  const lines = [
    { code: '3d', icon: <Box size={14} /> },
    { code: '2d', icon: <Shirt size={14} /> },
    { code: 'embroidery', icon: <Spline size={14} /> },
    { code: 'led', icon: <Lightbulb size={14} /> },
    { code: 'canvas', icon: <Frame size={14} /> },
    { code: 'wood', icon: <TreePine size={14} /> },
  ];
  const toolLines = [
    { code: '3d', icon: <Box size={14} /> },
    { code: '2d', icon: <Shirt size={14} /> },
  ];

  return [
    {
      key: 'nav-reports',
      label: t('sidebar.nav.reports.title'),
      icon: <BarChart3 size={17} />,
      children: [
        {
          key: 'dash-factory',
          label: t('sidebar.nav.reports.production'),
          to: to(`${PATHS.HOME}?tab=factory`),
          icon: <Factory size={14} />,
          perm: 'page.dashboard',
        },
        {
          key: 'dash-stats',
          label: t('sidebar.dashboard.stats'),
          to: to(`${PATHS.HOME}?tab=stats`),
          icon: <BarChart3 size={14} />,
          perm: 'page.dashboard',
        },
        {
          key: 'dash-lifecycle',
          label: t('sidebar.dashboard.lifecycle'),
          to: to(`${PATHS.HOME}?tab=lifecycle`),
          icon: <Workflow size={14} />,
          perm: 'page.dashboard',
        },
        {
          key: 'dash-designer',
          label: t('sidebar.dashboard.designer'),
          to: to(`${PATHS.HOME}?tab=designer`),
          icon: <Palette size={14} />,
          perm: 'page.designer_stats',
        },
        {
          // Temporarily points at the Shipments page (it already has a cost dashboard) — the real shipping report comes in phase 2B.
          key: 'reports-ship',
          label: t('sidebar.nav.reports.ship'),
          to: withQuery(PATHS.SHIPMENTS, 'view=report'),
          icon: <Truck size={14} />,
          onlyForRoles: ADMIN_ROLES,
          // The Shipments route used to be gated by `page.orders` (inherited from the old "Orders" parent) — keep it.
          pagePerm: 'page.orders',
        },
        {
          // Per-factory stock (Inventory.md) — storekeepers enter receipts + view stock; stock-out happens at the scan station.
          key: PATHS.INVENTORY,
          label: t('sidebar.nav.reports.stock'),
          to: to(PATHS.INVENTORY),
          icon: <Boxes size={14} />,
          perm: 'page.inventory',
        },
        {
          // Executive board — SuperAdmin/Admin ONLY (no permission code: hard-locked by role). The page also blocks other roles.
          key: PATHS.CEO_DASHBOARD,
          label: t('sidebar.ceoDashboard'),
          to: PATHS.CEO_DASHBOARD,
          icon: <Crown size={14} />,
          onlyForRoles: ADMIN_ROLES,
        },
      ],
    },
    {
      // Key = `/ffm/orders` + `pagePerm`: keeps the old Orders page route gated by `page.orders` as when it
      // was the "Orders" parent (AUTH-7 builds the permission map from parent keys). Does not gate group visibility.
      key: PATHS.ORDERS,
      label: t('sidebar.nav.production.title'),
      icon: <Factory size={17} />,
      pagePerm: 'page.orders',
      children: [
        {
          key: 'orders-workshop',
          label: t('sidebar.nav.production.all'),
          to: to(PATHS.ORDERS_WORKSHOP),
          icon: <List size={14} />,
          perm: 'page.orders',
        },
        ...lines.map(({ code, icon }) => ({
          key: `line-${code}`,
          label: t(`sidebar.nav.lines.${code}`),
          to: to(withQuery(PATHS.ORDERS_WORKSHOP, `productLine=${code}`)),
          icon,
          perm: 'page.orders',
        })),
        {
          key: 'orders-error-log',
          label: t('sidebar.orders.errorLog'),
          to: to(PATHS.ORDERS_ERROR_LOG),
          icon: <AlertTriangle size={14} />,
          perm: 'page.orders',
          hideForRoles: ['Support'],
          sectionBefore: t('sidebar.nav.production.operations'),
        },
        {
          key: PATHS.MY_TASKS,
          label: t('sidebar.work.myTasks'),
          to: to(PATHS.MY_TASKS),
          icon: <ListChecks size={14} />,
          perm: 'page.my_tasks',
        },
        {
          key: PATHS.FULFILLMENT_MY_TASKS,
          label: t('sidebar.work.fulfillmentTasks'),
          to: to(PATHS.FULFILLMENT_MY_TASKS),
          icon: <Factory size={14} />,
          perm: 'page.fulfillment_my_tasks',
        },
        {
          key: 'orders-scan-error',
          label: t('sidebar.orders.scanError'),
          to: to(PATHS.ORDERS_SCAN_ERROR),
          icon: <ScanLine size={14} />,
          perm: 'page.scan_error',
        },
        {
          key: 'orders-stage-errors',
          label: t('sidebar.orders.stageErrors'),
          to: to(PATHS.ORDERS_STAGE_ERRORS),
          icon: <Barcode size={14} />,
          perm: 'page.stage_errors',
        },
        {
          key: 'orders-unmapped',
          label: t('sidebar.orders.unmapped'),
          to: to(PATHS.ORDERS_UNMAPPED),
          icon: <MapPin size={14} />,
          perm: 'page.unmapped_factory',
        },
        {
          // Flat table, REAL pagination, NOT grouped by product (OrderTableClassic.tsx).
          key: PATHS.ORDERS_CLASSIC,
          label: t('sidebar.orders.classic'),
          to: PATHS.ORDERS_CLASSIC,
          icon: <Rows3 size={14} />,
          perm: 'page.orders',
        },
        {
          key: 'orders-import',
          label: t('sidebar.orders.import'),
          to: to(PATHS.ORDERS_IMPORT),
          icon: <FileDown size={14} />,
          perm: 'order.import',
          sectionBefore: t('sidebar.nav.production.data'),
        },
        {
          key: 'orders-cutting-files',
          label: t('sidebar.orders.cuttingFiles'),
          to: to(PATHS.ORDERS_CUTTING_FILES),
          icon: <Scissors size={14} />,
          perm: 'order.import',
        },
        {
          // DTF process guide by role (DtfRoleGuide.md) — static page.
          key: PATHS.DTF_GUIDE,
          label: t('sidebar.guideDtf'),
          to: to(PATHS.DTF_GUIDE),
          icon: <BookOpen size={14} />,
          perm: 'page.guide_dtf',
          sectionBefore: t('sidebar.nav.production.guide'),
        },
      ],
    },
    {
      key: 'nav-tool',
      label: t('sidebar.nav.tool.title'),
      icon: <FileSearch size={17} />,
      children: [
        {
          key: 'dash-tool-check',
          label: t('sidebar.nav.tool.overview'),
          to: to(`${PATHS.HOME}?tab=tool-check`),
          icon: <FileSearch size={14} />,
          perm: 'page.tool_check',
        },
        ...toolLines.map(({ code, icon }) => ({
          key: `tool-${code}`,
          label: t(`sidebar.nav.tool.${code}`),
          to: to(`${PATHS.HOME}?tab=tool-check&productLine=${code}`),
          icon,
          perm: 'page.tool_check',
        })),
      ],
    },
    {
      key: 'nav-ship',
      label: t('sidebar.nav.ship.title'),
      icon: <Truck size={17} />,
      children: [
        {
          // The whole VNP shipping surface is Admin/SuperAdmin only (VnpShipping.md §7).
          key: 'orders-shipments',
          label: t('sidebar.orders.shipments'),
          to: PATHS.SHIPMENTS,
          icon: <Truck size={14} />,
          onlyForRoles: ADMIN_ROLES,
          pagePerm: 'page.orders',
        },
        {
          // Same permission as Fulfillment Tasks: whoever hands parcels to the carrier is the factory's warehouse staff.
          key: PATHS.HANDOVER,
          label: t('sidebar.work.handover'),
          to: to(PATHS.HANDOVER),
          icon: <PackageCheck size={14} />,
          perm: 'page.fulfillment_my_tasks',
        },
      ],
    },
    {
      key: 'nav-wallet',
      label: t('sidebar.nav.wallet.title'),
      icon: <Wallet size={17} />,
      // There is NO staff-side wallet in this app yet — temporarily open the seller wallet admin page in
      // the Seller Portal (`/hub/wallets`, also Admin/SuperAdmin only). Without `VITE_SELLER_URL` the
      // group is hidden entirely rather than pointing at a dead link. Real page: phase 2C.
      children: SELLER_URL
        ? [
            {
              key: 'wallet-sellers',
              label: t('sidebar.nav.wallet.sellers'),
              to: `${SELLER_URL}/hub/wallets`,
              icon: <Wallet size={14} />,
              onlyForRoles: ADMIN_ROLES,
              external: true,
            },
          ]
        : [],
    },
    {
      key: 'nav-hr',
      label: t('sidebar.nav.hr.title'),
      icon: <Users size={17} />,
      children: [
        {
          key: PATHS.USERS,
          label: t('sidebar.users'),
          to: PATHS.USERS,
          icon: <User size={14} />,
          perm: 'user.manage',
          pagePerm: 'page.users',
        },
        {
          key: PATHS.DEPARTMENTS,
          label: t('sidebar.departments'),
          to: PATHS.DEPARTMENTS,
          icon: <Building2 size={14} />,
          perm: 'user.manage',
          pagePerm: 'page.users',
        },
        {
          key: PATHS.DESIGNER_TEAM,
          label: t('sidebar.designerTeam'),
          to: PATHS.DESIGNER_TEAM,
          icon: <Palette size={14} />,
          perm: 'page.designer_team',
        },
        {
          key: PATHS.ROLES,
          label: t('sidebar.roles'),
          to: PATHS.ROLES,
          icon: <ShieldCheck size={14} />,
          perm: 'role.manage',
          pagePerm: 'page.roles',
        },
        {
          key: PATHS.CUSTOM_ROLES,
          label: t('sidebar.customRoles'),
          to: PATHS.CUSTOM_ROLES,
          icon: <ShieldHalf size={14} />,
          perm: 'role.manage',
          pagePerm: 'page.roles',
        },
        {
          key: PATHS.IMPERSONATE,
          label: t('sidebar.impersonate'),
          to: PATHS.IMPERSONATE,
          icon: <UserCog size={14} />,
          onlyForRoles: [RoleType.SuperAdmin],
        },
      ],
    },
  ];
}

function buildNavGroups(t: TFunction<'layout'>, factoryScopeId?: string, userEmail?: string): NavGroup[] {
  return [
    { title: '', items: buildMainItems(t, factoryScopeId) },
    {
      // Entries NOT yet in the CEO's 6 groups — kept as-is pending a placement decision (MenuRestructure-CEO.md), never deleted.
      title: t('sidebar.groups.system'),
      items: [
        {
          key: PATHS.PRODUCTS,
          label: t('sidebar.products'),
          to: PATHS.PRODUCTS,
          icon: <Package size={17} />,
          perm: 'page.products',
        },
        {
          key: PATHS.PROMOTIONS,
          label: t('sidebar.promotions'),
          to: PATHS.PROMOTIONS,
          icon: <Tag size={17} />,
          perm: 'page.promotions',
        },
        {
          key: PATHS.WORKSHOP_CONFIG,
          label: t('sidebar.workshopConfig'),
          to: PATHS.WORKSHOP_CONFIG,
          icon: <Building2 size={17} />,
          perm: 'workshop.manage',
          // DesignerLeader HAS `page.workshop_config` but NOT `workshop.manage`:
          // the menu stays hidden as before, while the route opens — matching their right to enter the page.
          pagePerm: 'page.workshop_config',
        },
        {
          key: PATHS.CUSTOMERS,
          label: t('sidebar.customers'),
          to: PATHS.CUSTOMERS,
          icon: <Contact size={17} />,
          perm: 'page.customers',
        },
        // The three Zalo/Telegram entries only show for accounts on the allowlist
        // (`constants/zaloAccess.ts`). The REAL gate is in the backend — this is the display
        // layer so people without access don't click in and get a 403.
        ...(duocTruyCapZalo(userEmail)
          ? [
              {
                key: PATHS.ZALO_GROUPS,
                label: t('sidebar.zaloGroups'),
                to: PATHS.ZALO_GROUPS,
                icon: <MessageSquare size={17} />,
                perm: 'page.zalo_groups',
              },
              {
                // Embedded Zalo chat (vendor module). Fine-grained permissions still live
                // in the engine's "Permissions" dialog; this allowlist comes first and
                // decides who is granted a session.
                key: PATHS.ZALO_CHAT,
                label: t('sidebar.zaloChat'),
                to: PATHS.ZALO_CHAT,
                icon: <MessagesSquare size={17} />,
              },
              {
                // Same engine, same session as the Zalo screen — so the same gate.
                key: PATHS.TELEGRAM,
                label: t('sidebar.telegram'),
                to: PATHS.TELEGRAM,
                icon: <Send size={17} />,
              },
            ]
          : []),
        {
          key: PATHS.SETTINGS,
          label: t('sidebar.settings'),
          to: PATHS.SETTINGS,
          icon: <Settings size={17} />,
          perm: 'role.manage',
          matchPrefix: true,
        },
      ],
    },
    {
      title: t('sidebar.groups.personal'),
      items: [
        {
          key: PATHS.NOTIFICATIONS,
          label: t('sidebar.notifications'),
          to: PATHS.NOTIFICATIONS,
          icon: <Bell size={17} />,
        },
        { key: PATHS.ACCOUNT, label: t('sidebar.account'), to: PATHS.ACCOUNT, icon: <User size={17} /> },
      ],
    },
  ];
}

/**
 * Filter sidebar menu by user.role.permissionCodes. Items without `perm` are
 * always visible (account, notifications). Empty permissionCodes (e.g. fresh
 * user / token from old session) → only no-perm items appear.
 *
 * SuperAdmin / Admin role names get an explicit bypass since their token may
 * predate the Phase 5 permissionCodes seed.
 */
function filterMenuByPermissions(
  groups: NavGroup[],
  codes: Set<string>,
  isAdmin: boolean,
  roleName?: string,
): NavGroup[] {
  const allow = (perm?: string, anyPerm?: string[]) => {
    if (isAdmin) return true;
    if (anyPerm?.length) return anyPerm.some((p) => codes.has(p));
    return !perm || codes.has(perm);
  };
  const visibleForRole = (c: Pick<NavChild, 'hideForRoles' | 'onlyForRoles'>) =>
    !(roleName && c.hideForRoles?.includes(roleName)) &&
    (!c.onlyForRoles || (!!roleName && c.onlyForRoles.includes(roleName)));
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((it) => allow(it.perm) && visibleForRole(it))
        .map((it) =>
          it.children
            ? { ...it, children: it.children.filter((c) => allow(c.perm, c.anyPerm) && visibleForRole(c)) }
            : it,
        )
        .filter((it) => !it.children || it.children.length > 0),
    }))
    .filter((g) => g.items.length > 0);
}

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** Collapse/expand (desktop) — the button sits next to the logo, moved from the header on 07/09/2026. */
  onToggleCollapse?: () => void;
}

function isLinkActive(linkPath: string, currentPath: string, currentSearch: string, matchPrefix = false): boolean {
  // linkPath may include `?...` for children
  const [pathPart, queryPart] = linkPath.split('?');
  const pathMatches = matchPrefix
    ? currentPath === pathPart || currentPath.startsWith(`${pathPart}/`)
    : pathPart === currentPath;
  if (!pathMatches) return false;
  const linkParams = new URLSearchParams(queryPart || '');
  const currentParams = new URLSearchParams(currentSearch);
  // Scope params are matched BOTH WAYS — see `SCOPE_PARAMS`.
  if (SCOPE_PARAMS.some((p) => (linkParams.get(p) || '') !== (currentParams.get(p) || ''))) return false;
  if (!queryPart) return true;
  // exact query param subset check
  for (const [k, v] of linkParams.entries()) {
    if (currentParams.get(k) !== v) return false;
  }
  return true;
}

/**
 * Path used for the "click the active menu again → clear the page's filters" signal.
 * Strips the scope params (`SCOPE_PARAMS`) because pages register the signal with the
 * BARE `to` — kept as-is, the "3D" entry or a factory-scoped entry would never match
 * and clicking again would not clear the filters.
 */
function resetPathOf(to: string): string {
  const [path, query] = to.split('?');
  if (!query) return to;
  const sp = new URLSearchParams(query);
  for (const p of SCOPE_PARAMS) sp.delete(p);
  const rest = sp.toString();
  return rest ? `${path}?${rest}` : path;
}

function SidebarLeaf({
  item,
  collapsed,
  level = 0,
  badges,
}: {
  item: NavChild;
  collapsed: boolean;
  level?: number;
  badges?: SidebarBadge[];
}) {
  const location = useLocation();
  const active = isLinkActive(item.to, location.pathname, location.search, item.matchPrefix);
  const requestReset = useSidebarResetStore((s) => s.requestReset);
  const hasBadges = !!badges?.length;
  if (item.external) {
    return (
      <a
        href={item.to}
        target="_blank"
        rel="noopener noreferrer"
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          collapsed && 'justify-center',
          !collapsed && level > 0 && 'ml-5 py-1.5 text-[13px]',
        )}
      >
        <span>{item.icon}</span>
        {!collapsed && <span className="truncate flex-1">{item.label}</span>}
        {!collapsed && <ExternalLink size={12} className="shrink-0 opacity-60" />}
      </a>
    );
  }
  return (
    <Link
      to={item.to}
      // Clicking the ALREADY active menu → the Router treats it as a no-op (no navigation),
      // so emit a separate signal for the page to clear its own filters (see `useSidebarResetSignal`).
      onClick={() => {
        if (active) requestReset(resetPathOf(item.to));
      }}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        collapsed && 'justify-center relative',
        !collapsed && level > 0 && 'ml-5 py-1.5 text-[13px]',
      )}
    >
      <span className={active ? 'text-foreground' : 'text-muted-foreground'}>{item.icon}</span>
      {!collapsed && <span className={cn('truncate', hasBadges && 'flex-1')}>{item.label}</span>}
      {!collapsed && hasBadges && (
        <span className="flex items-center gap-1 shrink-0">
          {badges!.map((b) => (
            <BadgePill key={b.title} badge={b} />
          ))}
        </span>
      )}
      {collapsed && hasBadges && <BadgeDot badges={badges!} />}
    </Link>
  );
}

function SidebarParent({ item, collapsed, badgeMap }: { item: NavItem; collapsed: boolean; badgeMap: BadgeMap }) {
  const location = useLocation();
  const hasChildren = !!item.children?.length;
  const childBadges = hasChildren ? item.children!.flatMap((c) => badgeMap[c.key] || []) : [];

  // Open by default if any child matches current path
  const initialOpen = hasChildren
    ? item.children!.some((c) => isLinkActive(c.to, location.pathname, location.search, c.matchPrefix))
    : false;
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    // Auto-expand when navigating to a child
    if (
      hasChildren &&
      item.children!.some((c) => isLinkActive(c.to, location.pathname, location.search, c.matchPrefix))
    ) {
      setOpen(true);
    }
  }, [location.pathname, location.search]);

  if (!hasChildren && item.to) {
    return <SidebarLeaf item={item as NavChild} collapsed={collapsed} badges={badgeMap[item.key]} />;
  }

  // Parent with children
  const anyChildActive = item.children!.some((c) =>
    isLinkActive(c.to, location.pathname, location.search, c.matchPrefix),
  );

  if (collapsed) {
    // The first child links into another app (Wallet → Seller Portal) — `Link` cannot open an absolute URL.
    if (item.children![0].external) {
      return <SidebarLeaf item={{ ...item.children![0], label: item.label, icon: item.icon }} collapsed />;
    }
    // Collapsed: show parent icon only; clicking still navigates to first child
    return (
      <Link
        to={item.children![0].to}
        title={item.label}
        className={cn(
          'flex items-center justify-center px-3 py-2 rounded-md text-sm transition-colors relative',
          anyChildActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        <span className={anyChildActive ? 'text-foreground' : 'text-muted-foreground'}>{item.icon}</span>
        {childBadges.length > 0 && <BadgeDot badges={childBadges} />}
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left bg-transparent border-none cursor-pointer',
          anyChildActive
            ? 'text-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        <span className={anyChildActive ? 'text-foreground' : 'text-muted-foreground'}>{item.icon}</span>
        <span className="truncate flex-1">{item.label}</span>
        {!open && childBadges.length > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            {aggregateBadges(childBadges).map((b) => (
              <BadgePill key={b.tone} badge={b} />
            ))}
          </span>
        )}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="space-y-0.5 mt-0.5">
          {item.children!.map((c) => (
            <React.Fragment key={c.key}>
              {c.sectionBefore && (
                <p className="ml-5 px-3 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {c.sectionBefore}
                </p>
              )}
              <SidebarLeaf item={c} collapsed={false} level={1} badges={badgeMap[c.key]} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ collapsed, mobileOpen, onMobileClose, onToggleCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('layout');
  const { profile } = useAuthStore();
  const isMobile = useIsMobile();

  const roleName = profile?.role?.name as string | undefined;
  const isAdmin = roleName === 'Admin' || roleName === 'SuperAdmin';
  // Access to Zalo data follows the ACCOUNT, not the role — see `constants/zaloAccess.ts`.
  const userEmail = profile?.email as string | undefined;
  const permissionCodes = useMemo(
    () => new Set<string>(profile?.role?.permissionCodes || []),
    [profile?.role?.permissionCodes],
  );
  // Currently selected factory scope (URL `factoryId`, set from the header picker) — production
  // links carry it so switching pages keeps the scope. The 5 per-factory menu clusters were
  // REMOVED (07/09/2026) — replaced by `FactoryScopeSwitch` in the header (Orders.md §25).
  const [searchParams] = useSearchParams();
  const factoryScopeId = searchParams.get('factoryId') || undefined;
  const navGroups = useMemo(
    () => filterMenuByPermissions(buildNavGroups(t, factoryScopeId, userEmail), permissionCodes, isAdmin, roleName),
    [t, factoryScopeId, userEmail, permissionCodes, isAdmin, roleName],
  );

  const counts = useSidebarBadgeStore((s) => s.counts);
  const refreshRequestedAt = useSidebarBadgeStore((s) => s.refreshRequestedAt);
  const profileId = profile?._id;

  // Light 60s polling (only while the tab is visible) — count-only endpoint, tens of ms.
  useEffect(() => {
    if (!profileId) return;
    fetchSidebarCounts();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchSidebarCounts();
    }, SIDEBAR_BADGE_POLL_MS);
    return () => clearInterval(id);
  }, [profileId]);

  // A relevant mutation just succeeded (bumped by the axios interceptor) → refetch right
  // after a short debounce so the count drops as soon as the user finishes a task.
  useEffect(() => {
    if (!profileId || !refreshRequestedAt) return;
    const timer = setTimeout(fetchSidebarCounts, SIDEBAR_BADGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [profileId, refreshRequestedAt]);

  const badgeMap = useMemo<BadgeMap>(() => {
    if (!counts) return {};
    const map: BadgeMap = {};
    const add = (key: string, count: number | null | undefined, tone: SidebarBadge['tone'], title: string) => {
      if (typeof count !== 'number' || count <= 0) return;
      (map[key] ||= []).push({ count, tone, title });
    };
    // Error log: count from the viewer's stage perspective (Fulfillment/Designer =
    // their own work; Admin/Manager = whole system) — the title changes to match.
    const personalErrorView = roleName === 'Fulfillment' || roleName === 'Designer' || roleName === 'DesignerLeader';
    add(
      'orders-error-log',
      counts.errorLogTodo,
      'red',
      personalErrorView ? t('sidebar.badges.errorLogTodo') : t('sidebar.badges.errorLogTodoAll'),
    );
    add('dash-designer', counts.designerUnassigned, 'amber', t('sidebar.badges.designerUnassigned'));
    add(
      'dash-designer',
      counts.designerBacklog,
      'red',
      roleName === 'Designer' ? t('sidebar.badges.designerBacklogSelf') : t('sidebar.badges.designerBacklog'),
    );
    add('dash-tool-check', counts.toolCheckRework, 'amber', t('sidebar.badges.toolCheckRework'));
    add('dash-tool-check', counts.toolCheckUnreviewed, 'red', t('sidebar.badges.toolCheckUnreviewed'));

    return map;
  }, [counts, roleName, t]);

  const handleLogout = async () => {
    try {
      await RepositoryRemote.auth.logout();
      useAuthStore.getState().clearToken();
      navigate(PATHS.LOGIN);
    } catch (error) {
      handleAxiosError(error);
    }
  };

  const showLabels = !collapsed || isMobile;

  const renderContent = () => (
    // TooltipProvider for the badge tooltips (BadgePill/BadgeDot) — short delay so
    // hovering shows right away what the number means.
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col h-full bg-background">
        <div
          className={cn(
            'flex items-center gap-2 h-14 border-b border-border',
            showLabels ? 'px-3' : 'justify-center px-1',
          )}
        >
          {showLabels && <img src={logoUrl} alt="Logo" className="h-7 w-auto min-w-0 object-contain" />}
          {/* Collapse/expand button — desktop only (mobile uses a Sheet with its own close button). */}
          {!isMobile && onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={t('header.toggleSidebar')}
              aria-label={t('header.toggleSidebar')}
              className={cn(
                'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground bg-transparent border-none cursor-pointer',
                showLabels && 'ml-auto',
              )}
            >
              {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-5">
          {navGroups.map((group, idx) => (
            <div key={group.title || `group-${idx}`}>
              {showLabels && group.title && (
                <p className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarParent key={item.key} item={item} collapsed={!showLabels} badgeMap={badgeMap} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {showLabels && profile && (
          <div className="border-t border-border p-3 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <User size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{profile?.fullName}</p>
              <p className="text-[11px] text-muted-foreground truncate">{profile?.role?.name || t('sidebar.member')}</p>
            </div>
            <button
              onClick={handleLogout}
              title={t('sidebar.signOut')}
              className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors bg-transparent border-none cursor-pointer"
            >
              <LogOut size={15} />
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );

  if (isMobile) {
    return (
      <Sheet open={mobileOpen} onOpenChange={(open) => !open && onMobileClose()}>
        <SheetContent side="left" className="p-0 w-[260px]">
          {renderContent()}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className={cn(
        // Exactly screen height, no overflow: only the menu list scrolls inside, with the logo on
        // top and the account block at the bottom pinned (fixed frame — MainLayout).
        'h-screen shrink-0 overflow-hidden border-r border-border bg-background transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-[240px]',
      )}
    >
      {renderContent()}
    </aside>
  );
}

export default Sidebar;
