import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  BarChart3,
  Barcode,
  Bell,
  Box,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Contact,
  Crown,
  Factory,
  FileDown,
  FileSearch,
  Frame,
  Layers,
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
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Spline,
  Tag,
  TreePine,
  Truck,
  User,
  UserCog,
  Wallet,
  Workflow,
} from 'lucide-react';
import { PRODUCT_LINE_WINDOW_DAYS, PRODUCT_LINES, RoleType } from 'shared';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { cn } from '@/utils/cn';

import logoUrl from '@/assets/images/logo.png';

import { PATHS } from '../../constants/paths';
import { duocTruyCapZalo } from '../../constants/zaloAccess';
import { useFactoryScope } from '../../hooks/useFactoryScope';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { RepositoryRemote } from '../../services';
import { useAuthStore } from '../../store/authStore';
import { useSidebarBadgeStore } from '../../store/sidebarBadgeStore';
import { useSidebarResetStore } from '../../store/sidebarResetStore';
import { handleAxiosError } from '../../utils';
import { TAB_BAR_ROLES } from './MobileTabBar';

/**
 * Count badge on one sidebar entry: red = urgent, amber = waiting to be assigned/reworked,
 * neutral = informational volume (product-line open orders) — not a to-do, so it never
 * feeds the collapsed-parent pills or the collapsed-sidebar dot, which signal work.
 */
interface SidebarBadge {
  count: number;
  tone: 'red' | 'amber' | 'neutral';
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
            badge.tone === 'red'
              ? 'bg-red-500 text-white'
              : badge.tone === 'amber'
                ? 'bg-amber-400 text-amber-950'
                : 'bg-muted text-muted-foreground',
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

/** Drop informational (neutral) badges — the dot and the folded pills only signal work to do. */
function urgentOnly(badges: SidebarBadge[]): SidebarBadge[] {
  return badges.filter((b) => b.tone !== 'neutral');
}

/** Fold the children's badges into 2 pills (red/amber) for a collapsed parent row. */
function aggregateBadges(badges: SidebarBadge[]): SidebarBadge[] {
  const byTone = new Map<SidebarBadge['tone'], { count: number; titles: string[] }>();
  for (const b of urgentOnly(badges)) {
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
  /**
   * Children sharing a `subgroup` fold into ONE collapsible sub-row at the position of the first
   * of them (Production › By product line). The tree stays flat on purpose: the permission map and
   * the role filter walk `children` exactly as before.
   */
  subgroup?: 'lines';
  /**
   * Stay active when the URL carries a DIFFERENT `productLine`/`view` scope than the link (see
   * `SCOPE_PARAMS`). For an entry whose page switches that scope itself (Tool: the 3D/2D toggle).
   */
  looseScope?: boolean;
  /**
   * Query the menu adds when OPENING the page (its most useful default view, MenuRestructure-CEO.md
   * §8.1) — NOT part of the entry's identity: active highlighting and the "click again to clear
   * filters" signal compare `to` only. Needed when the page's "filter off" state is the param being
   * absent (e.g. `activeOnly`): put in `to`, unticking the filter would un-highlight the menu while
   * the user is still on the page. Only ever list ON values here — `z.coerce.boolean` reads the
   * string "false" as true, so a filter is turned off by omitting its param, never by `=false`.
   */
  defaultQuery?: string;
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
  /** Same meaning as on `NavChild` — only used when the item is a top-level link. */
  looseScope?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const ADMIN_ROLES: string[] = [RoleType.SuperAdmin, RoleType.Admin];

/** Menu icon per product line (the only hand-kept part of the line list). */
const LINE_ICONS: Record<string, React.ReactNode> = {
  '3d': <Box size={14} />,
  '2d': <Shirt size={14} />,
  embroidery: <Spline size={14} />,
  led: <Lightbulb size={14} />,
  canvas: <Frame size={14} />,
  wood: <TreePine size={14} />,
  dropship: <ShoppingBag size={14} />,
};

/** Order of the first lines in the menu, from the CEO's drawing; anything else sorts after them. */
const LINE_MENU_ORDER = ['3d', '2d', 'embroidery', 'led', 'canvas', 'wood'];
const lineMenuRank = (code: string) => {
  const i = LINE_MENU_ORDER.indexOf(code);
  return i === -1 ? LINE_MENU_ORDER.length : i;
};

/** Roles that own a task board (designer / fulfillment kanban) — same set as the phone tab bar. */
const TASK_BOARD_ROLES = TAB_BAR_ROLES;

/**
 * URL params matched BOTH WAYS in `isLinkActive` (every other param only needs
 * link ⊆ URL): entries sharing a path differ only by these — "All orders" vs
 * "3D", the shared cluster vs one factory. A one-way check would light the entry
 * WITHOUT the param together with the entry that has it. These are also the params
 * stripped from the "click again to clear filters" signal (`resetPathOf`), since pages register with the bare path.
 */
const SCOPE_PARAMS = ['factoryId', 'productLine', 'view'];

/**
 * Pages that have NO sidebar entry but still need their route gated. The menu tree is
 * also the permission table (see `buildPagePermissionMap`), so removing a menu entry
 * silently UNGATES its route for every account (MenuRestructure-CEO.md §9.1). A page
 * that leaves the sidebar must be listed here in the same change.
 */
const ROUTE_ONLY_PAGES: { to: string; perm: string }[] = [
  // DTF role guide — reached from the Dashboard "Getting started" block since 01/10/2026.
  { to: PATHS.DTF_GUIDE, perm: 'page.guide_dtf' },
  // Departments and custom roles are placeholder pages (title + "coming soon", never built);
  // off the menu since 01/10/2026, routes and BE kept. Same page codes their menu entries used.
  { to: PATHS.DEPARTMENTS, perm: 'page.users' },
  { to: PATHS.CUSTOM_ROLES, perm: 'page.roles' },
];

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
  for (const page of ROUTE_ONLY_PAGES) put(page.to, page.perm);
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
function buildMainItems(t: TFunction<'layout'>, factoryId?: string, roleName?: string): NavItem[] {
  const to = (path: string) => withFactory(path, factoryId);
  // Follows PRODUCT_LINES, so a new line shows up in the menu without touching this file; only the
  // icon is mapped by hand (unknown lines get a generic package). The CEO's drawing fixes the order of
  // the first six; lines added later go after them.
  const lines = [...PRODUCT_LINES]
    .sort((a, b) => lineMenuRank(a) - lineMenuRank(b))
    .map((code) => ({ code, icon: LINE_ICONS[code] ?? <Package size={14} /> }));

  // Each role's own task board comes FIRST for the roles that own one (Designer, DesignerLeader,
  // Fulfillment): 77% of production users (26 Fulfillment + 15 Designer of 53) open it all day,
  // and each sees only the board of their own role. Other roles (Admin, Manager, Support) have no
  // board of their own — "My tasks" would open an empty kanban for them — so the order lists lead,
  // which is also where clicking the group icon goes when the sidebar is collapsed (first child).
  const tasksFirst = !!roleName && TASK_BOARD_ROLES.includes(roleName);
  const taskBlock: NavChild[] = [
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
      key: 'orders-error-log',
      label: t('sidebar.orders.errorLog'),
      to: to(PATHS.ORDERS_ERROR_LOG),
      icon: <AlertTriangle size={14} />,
      perm: 'page.orders',
      hideForRoles: ['Support'],
    },
  ];
  if (!tasksFirst) taskBlock[0] = { ...taskBlock[0], sectionBefore: t('sidebar.work.title') };
  const orderBlock: NavChild[] = [
    {
      key: 'orders-workshop',
      label: t('sidebar.nav.production.all'),
      to: to(PATHS.ORDERS_WORKSHOP),
      icon: <List size={14} />,
      perm: 'page.orders',
      sectionBefore: t('sidebar.nav.production.orders'),
    },
    {
      // Flat table, REAL pagination, NOT grouped by product (OrderTableClassic.tsx). Daily work
      // (hundreds of visits a day on production), so it sits with the order lists, not under System.
      key: PATHS.ORDERS_CLASSIC,
      label: t('sidebar.orders.classic'),
      to: PATHS.ORDERS_CLASSIC,
      icon: <Rows3 size={14} />,
      perm: 'page.orders',
    },
    ...lines.map(({ code, icon }) => ({
      key: `line-${code}`,
      label: t(`sidebar.nav.lines.${code}`),
      to: to(withQuery(PATHS.ORDERS_WORKSHOP, `productLine=${code}`)),
      icon,
      perm: 'page.orders',
      subgroup: 'lines' as const,
    })),
  ];
  const stationBlock: NavChild[] = [
    {
      key: 'orders-scan-error',
      label: t('sidebar.orders.scanError'),
      to: to(PATHS.ORDERS_SCAN_ERROR),
      icon: <ScanLine size={14} />,
      perm: 'page.scan_error',
      sectionBefore: t('sidebar.nav.production.station'),
    },
    {
      key: 'orders-stage-errors',
      label: t('sidebar.orders.stageErrors'),
      to: to(PATHS.ORDERS_STAGE_ERRORS),
      icon: <Barcode size={14} />,
      perm: 'page.stage_errors',
    },
  ];
  const productionChildren = tasksFirst
    ? [...taskBlock, ...orderBlock, ...stationBlock]
    : [...orderBlock, ...taskBlock, ...stationBlock];

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
      children: [...productionChildren],
    },
    {
      // One link, not a group: the group wrapped a single overview page plus two line views. The 3D / 2D
      // scope is a toggle inside the page now (`ToolCheckTab`), so Tool opens in one click. The key stays
      // `dash-tool-check` — `badgeMap` attaches the Tool counts by key.
      key: 'dash-tool-check',
      label: t('sidebar.nav.tool.title'),
      to: to(`${PATHS.HOME}?tab=tool-check`),
      icon: <FileSearch size={17} />,
      perm: 'page.tool_check',
      looseScope: true,
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
      children: [
        {
          // Staff wallet page (SellerWallet.md). Opens on wallets with money or activity — the full
          // list of every seller, empty wallets included, is the raw list §8.1 says not to open on.
          // Role-locked like the CEO dashboard: no `page.*` code, the page redirects non-admins and
          // the BE `admin/customer-wallets*` endpoints are `@Auth([Admin])` (Auth.md).
          key: 'wallet-sellers',
          label: t('sidebar.nav.wallet.sellers'),
          to: PATHS.WALLETS,
          defaultQuery: 'activeOnly=true',
          icon: <Wallet size={14} />,
          onlyForRoles: ADMIN_ROLES,
        },
        {
          // Ledger across all sellers. Opens on the last 7 days (`range=all` is the whole history).
          key: PATHS.WALLET_TRANSACTIONS,
          label: t('sidebar.nav.wallet.transactions'),
          to: `${PATHS.WALLET_TRANSACTIONS}?range=7d`,
          icon: <ScrollText size={14} />,
          onlyForRoles: ADMIN_ROLES,
        },
      ],
    },
  ];
}

function buildNavGroups(
  t: TFunction<'layout'>,
  factoryScopeId?: string,
  userEmail?: string,
  roleName?: string,
): NavGroup[] {
  return [
    { title: '', items: buildMainItems(t, factoryScopeId, roleName) },
    {
      // Group 7 "System" (MenuRestructure-CEO.md §8.2 #1/#3/#5): admin and data-intake work that the
      // legacy app also kept in a separate flat admin area. Each entry keeps its own permission, so
      // Support still sees Import Order / Unmapped here — the group is not hard-locked to Admin.
      // Folded into ONE closed row (Oct 2026): these are occasional admin tools, and 41 of 53
      // production accounts never open them — eleven permanent rows buried the daily ones.
      title: '',
      items: [
        {
          key: 'nav-system',
          label: t('sidebar.groups.system'),
          icon: <Settings size={17} />,
          children: [
            {
              key: 'orders-import',
              label: t('sidebar.orders.import'),
              to: withFactory(PATHS.ORDERS_IMPORT, factoryScopeId),
              icon: <FileDown size={14} />,
              perm: 'order.import',
            },
            {
              key: 'orders-cutting-files',
              label: t('sidebar.orders.cuttingFiles'),
              to: withFactory(PATHS.ORDERS_CUTTING_FILES, factoryScopeId),
              icon: <Scissors size={14} />,
              perm: 'order.import',
            },
            {
              key: 'orders-unmapped',
              label: t('sidebar.orders.unmapped'),
              to: withFactory(PATHS.ORDERS_UNMAPPED, factoryScopeId),
              icon: <MapPin size={14} />,
              perm: 'page.unmapped_factory',
            },
            {
              key: PATHS.PRODUCTS,
              label: t('sidebar.products'),
              to: PATHS.PRODUCTS,
              icon: <Package size={14} />,
              perm: 'page.products',
            },
            {
              key: PATHS.PROMOTIONS,
              label: t('sidebar.promotions'),
              to: PATHS.PROMOTIONS,
              icon: <Tag size={14} />,
              perm: 'page.promotions',
            },
            {
              key: PATHS.WORKSHOP_CONFIG,
              label: t('sidebar.workshopConfig'),
              to: PATHS.WORKSHOP_CONFIG,
              icon: <Building2 size={14} />,
              perm: 'workshop.manage',
              // DesignerLeader HAS `page.workshop_config` but NOT `workshop.manage`:
              // the menu stays hidden as before, while the route opens — matching their right to enter the page.
              pagePerm: 'page.workshop_config',
            },
            {
              key: PATHS.CUSTOMERS,
              label: t('sidebar.customers'),
              to: PATHS.CUSTOMERS,
              icon: <Contact size={14} />,
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
                    icon: <MessageSquare size={14} />,
                    perm: 'page.zalo_groups',
                  },
                  {
                    // Embedded Zalo chat (vendor module). Fine-grained permissions still live
                    // in the engine's "Permissions" dialog; this allowlist comes first and
                    // decides who is granted a session.
                    key: PATHS.ZALO_CHAT,
                    label: t('sidebar.zaloChat'),
                    to: PATHS.ZALO_CHAT,
                    icon: <MessagesSquare size={14} />,
                  },
                  {
                    // Same engine, same session as the Zalo screen — so the same gate.
                    key: PATHS.TELEGRAM,
                    label: t('sidebar.telegram'),
                    to: PATHS.TELEGRAM,
                    icon: <Send size={14} />,
                  },
                ]
              : []),
            {
              key: PATHS.USERS,
              label: t('sidebar.users'),
              to: PATHS.USERS,
              icon: <User size={14} />,
              perm: 'user.manage',
              pagePerm: 'page.users',
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
              key: PATHS.DESIGNER_TEAM,
              label: t('sidebar.designerTeam'),
              to: PATHS.DESIGNER_TEAM,
              icon: <Palette size={14} />,
              perm: 'page.designer_team',
            },
            {
              key: PATHS.IMPERSONATE,
              label: t('sidebar.impersonate'),
              to: PATHS.IMPERSONATE,
              icon: <UserCog size={14} />,
              onlyForRoles: [RoleType.SuperAdmin],
            },
            {
              key: PATHS.SETTINGS,
              label: t('sidebar.settings'),
              to: PATHS.SETTINGS,
              icon: <Settings size={14} />,
              perm: 'role.manage',
              matchPrefix: true,
            },
          ],
        },
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

function isLinkActive(
  linkPath: string,
  currentPath: string,
  currentSearch: string,
  matchPrefix = false,
  looseScope = false,
): boolean {
  // linkPath may include `?...` for children
  const [pathPart, queryPart] = linkPath.split('?');
  const pathMatches = matchPrefix
    ? currentPath === pathPart || currentPath.startsWith(`${pathPart}/`)
    : pathPart === currentPath;
  if (!pathMatches) return false;
  const linkParams = new URLSearchParams(queryPart || '');
  const currentParams = new URLSearchParams(currentSearch);
  // Scope params are matched BOTH WAYS — see `SCOPE_PARAMS`.
  if (!looseScope && SCOPE_PARAMS.some((p) => (linkParams.get(p) || '') !== (currentParams.get(p) || ''))) return false;
  if (!queryPart) return true;
  // exact query param subset check
  for (const [k, v] of linkParams.entries()) {
    if (looseScope && SCOPE_PARAMS.includes(k)) continue;
    if (currentParams.get(k) !== v) return false;
  }
  return true;
}

/** Where clicking a menu entry navigates: its path plus the entry's default view, if any. */
function hrefOf(item: Pick<NavChild, 'to' | 'defaultQuery'>): string {
  return item.defaultQuery ? withQuery(item.to, item.defaultQuery) : item.to;
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
  const active = isLinkActive(item.to, location.pathname, location.search, item.matchPrefix, item.looseScope);
  const requestReset = useSidebarResetStore((s) => s.requestReset);
  const hasBadges = !!badges?.length;
  return (
    <Link
      to={hrefOf(item)}
      // Clicking the ALREADY active menu → the Router treats it as a no-op (no navigation),
      // so emit a separate signal for the page to clear its own filters (see `useSidebarResetSignal`).
      onClick={() => {
        if (active) requestReset(resetPathOf(item.to));
      }}
      title={collapsed ? item.label : undefined}
      className={cn(
        'relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
        // Active entry keeps the legacy violet's ROLE (where you are) without its 2018 gradient +
        // glow: tinted fill, accent text and a thin indicator bar (DesignSystem-LegacyParity.md §9).
        active
          ? 'bg-nav-accent/10 font-medium text-nav-accent before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-nav-accent'
          : 'text-nav-text hover:bg-nav-open hover:text-foreground',
        collapsed && 'justify-center',
        !collapsed && level === 1 && 'ml-5 py-1.5 text-[13px]',
        !collapsed && level > 1 && 'ml-9 py-1.5 text-[13px]',
      )}
    >
      <span className={active ? 'text-nav-accent' : 'text-nav-text'}>{item.icon}</span>
      {!collapsed && (
        // Child labels wrap to two lines instead of being cut: Vietnamese labels run long
        // ("Danh sách đơn (bảng phẳng)") and a truncated entry hides what it opens.
        <span className={cn(level > 0 ? 'line-clamp-2 leading-snug' : 'truncate', hasBadges && 'flex-1')}>
          {item.label}
        </span>
      )}
      {!collapsed && hasBadges && (
        <span className="flex items-center gap-1 shrink-0">
          {badges!.map((b) => (
            <BadgePill key={b.title} badge={b} />
          ))}
        </span>
      )}
      {collapsed && urgentOnly(badges ?? []).length > 0 && <BadgeDot badges={urgentOnly(badges!)} />}
    </Link>
  );
}

/**
 * Collapsible sub-row inside a group (Production › Product lines). It lists EVERY entry in its fixed
 * order — a 0 count is information ("nothing today"), not a reason to hide a line: the badge counts
 * only the recent window, so a line with older open orders would otherwise lose its way in. The
 * active entry opens the row by itself so the user never loses their place.
 */
function SidebarSubGroup({
  label,
  icon,
  items,
  badgeMap,
}: {
  label: string;
  icon: React.ReactNode;
  items: NavChild[];
  badgeMap: BadgeMap;
}) {
  const location = useLocation();
  const anyActive = items.some((c) => isLinkActive(c.to, location.pathname, location.search, c.matchPrefix, c.looseScope));
  const [open, setOpen] = useState(anyActive);
  useEffect(() => {
    if (anyActive) setOpen(true);
  }, [anyActive]);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2.5 rounded-lg border-none px-3 py-1.5 text-left text-[13px] transition-colors cursor-pointer',
          open
            ? 'bg-transparent text-foreground'
            : 'bg-transparent text-nav-text hover:bg-nav-open hover:text-foreground',
          anyActive && 'font-medium',
        )}
      >
        <span className={anyActive ? 'text-nav-accent' : 'text-nav-text'}>{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="space-y-0.5 py-0.5">
          {items.map((c) => (
            <SidebarLeaf key={c.key} item={c} collapsed={false} level={2} badges={badgeMap[c.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarParent({
  item,
  collapsed,
  badgeMap,
  open,
  onToggle,
}: {
  item: NavItem;
  collapsed: boolean;
  badgeMap: BadgeMap;
  /** Accordion state lives in `Sidebar`: opening one group closes the others. */
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('layout');
  const location = useLocation();
  const hasChildren = !!item.children?.length;
  const childBadges = hasChildren ? item.children!.flatMap((c) => badgeMap[c.key] || []) : [];

  if (!hasChildren && item.to) {
    return <SidebarLeaf item={item as NavChild} collapsed={collapsed} badges={badgeMap[item.key]} />;
  }

  // Parent with children
  const anyChildActive = item.children!.some((c) =>
    isLinkActive(c.to, location.pathname, location.search, c.matchPrefix, c.looseScope),
  );

  if (collapsed) {
    // Collapsed: show parent icon only; clicking still navigates to first child
    return (
      <Link
        to={hrefOf(item.children![0])}
        title={item.label}
        className={cn(
          'flex items-center justify-center px-3 py-2 rounded-lg text-sm transition-colors relative',
          anyChildActive ? 'bg-nav-accent/10 text-nav-accent' : 'text-nav-text hover:bg-nav-open hover:text-foreground',
        )}
      >
        <span className={anyChildActive ? 'text-nav-accent' : 'text-nav-text'}>{item.icon}</span>
        {urgentOnly(childBadges).length > 0 && <BadgeDot badges={urgentOnly(childBadges)} />}
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left border-none cursor-pointer',
          // An open group sits on a very light grey row with regular text, as in the legacy app —
          // the violet is reserved for the one active entry so it stays the single eye-catcher.
          open ? 'bg-nav-open text-foreground' : 'bg-transparent text-nav-text hover:bg-nav-open hover:text-foreground',
          anyChildActive && 'font-medium',
        )}
      >
        <span className={open || anyChildActive ? 'text-foreground' : 'text-nav-text'}>{item.icon}</span>
        <span className="truncate flex-1">{item.label}</span>
        {!open && childBadges.length > 0 && (
          <span className="flex items-center gap-1 shrink-0">
            {aggregateBadges(childBadges).map((b) => (
              <BadgePill key={b.tone} badge={b} />
            ))}
          </span>
        )}
        {!open && anyChildActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-nav-accent" aria-hidden />}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {/* Slide open/closed like the legacy menu: animate grid rows 0fr→1fr (no fixed height).
          Closed children stay mounted for the animation, so they are `inert` (out of tab order
          and the accessibility tree); reduced-motion users get the instant toggle. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
        {...(open ? {} : { inert: '' })}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-0.5 py-1">
            {item.children!.map((c, idx, all) => {
              if (c.subgroup) {
                // The whole sub-group renders once, where its first member sits.
                if (all.findIndex((x) => x.subgroup === c.subgroup) !== idx) return null;
                return (
                  <SidebarSubGroup
                    key={`sub-${c.subgroup}`}
                    label={t('sidebar.nav.production.byLine')}
                    icon={<Layers size={14} />}
                    items={all.filter((x) => x.subgroup === c.subgroup)}
                    badgeMap={badgeMap}
                  />
                );
              }
              return (
                <React.Fragment key={c.key}>
                  {c.sectionBefore && (
                    <p className="ml-5 px-3 pt-2 pb-0.5 text-[11px] font-medium uppercase tracking-[.14px] text-nav-group">
                      {c.sectionBefore}
                    </p>
                  )}
                  <SidebarLeaf item={c} collapsed={false} level={1} badges={badgeMap[c.key]} />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
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
  // Through `useFactoryScope` (Orders.md §25): a Fulfillment account is always on its own factory,
  // even when a shared link carries another `?factoryId=` — the BE splits its badges only for that.
  const factoryScopeId = useFactoryScope();
  const navGroups = useMemo(
    () =>
      filterMenuByPermissions(
        buildNavGroups(t, factoryScopeId, userEmail, roleName),
        permissionCodes,
        isAdmin,
        roleName,
      ),
    [t, factoryScopeId, userEmail, permissionCodes, isAdmin, roleName],
  );

  // Accordion: one group open at a time. The group holding the current page opens itself on every
  // navigation, so the user is never left looking at a closed menu with no sign of where they are.
  const location = useLocation();
  const [openKey, setOpenKey] = useState<string | null>(null);
  useEffect(() => {
    const holder = navGroups
      .flatMap((g) => g.items)
      .find((it) => it.children?.some((c) => isLinkActive(c.to, location.pathname, location.search, c.matchPrefix, c.looseScope)));
    if (holder) setOpenKey(holder.key);
  }, [navGroups, location.pathname, location.search]);

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

    // Production › 3D/2D/…: open orders of the line, equal to the rows the line page lists on its
    // default view (MenuRestructure-CEO.md 2A). Shown even at 0 so every line is visibly there
    // (§8.3). With a factory picked in the header, read that factory's split — the line page is
    // scoped to it too. `null` at the top level = the role cannot open the order list: no badges.
    // A factory missing from `byFactory` just has no open order the viewer can see: all zeros.
    if (counts.productLineCounts) {
      const lineCounts = factoryScopeId
        ? counts.byFactory?.[factoryScopeId]?.productLineCounts
        : counts.productLineCounts;
      for (const code of PRODUCT_LINES) {
        (map[`line-${code}`] ||= []).push({
          count: lineCounts?.[code] ?? 0,
          tone: 'neutral',
          title: t('sidebar.badges.productLineOpen', { days: PRODUCT_LINE_WINDOW_DAYS }),
        });
      }
    }

    return map;
  }, [counts, roleName, t, factoryScopeId]);

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
                <p className="px-3 mb-1.5 text-[12.6px] font-medium uppercase tracking-[.14px] text-nav-group">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarParent
                    key={item.key}
                    item={item}
                    collapsed={!showLabels}
                    badgeMap={badgeMap}
                    open={openKey === item.key}
                    onToggle={() => setOpenKey((k) => (k === item.key ? null : item.key))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {profile && (
          // The account block is also the menu for the two rarely-opened personal pages, so they do not
          // take permanent rows in the list above: Notifications · Account · Sign out.
          <div className="border-t border-border p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title={showLabels ? undefined : profile?.fullName}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg border-none bg-transparent p-1 text-left transition-colors cursor-pointer hover:bg-nav-open',
                    !showLabels && 'justify-center',
                  )}
                >
                  <div className="w-9 h-9 shrink-0 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                    <User size={16} />
                  </div>
                  {showLabels && (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{profile?.fullName}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {profile?.role?.name || t('sidebar.member')}
                        </p>
                      </div>
                      <ChevronUp size={14} className="shrink-0 text-muted-foreground" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem asChild>
                  <Link to={PATHS.NOTIFICATIONS}>
                    <Bell size={14} />
                    {t('sidebar.notifications')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={PATHS.ACCOUNT}>
                    <User size={14} />
                    {t('sidebar.account')}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                  <LogOut size={14} />
                  {t('sidebar.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        // Legacy look: no border, a soft shadow on the right. Dark mode has no visible shadow, so the
        // border returns there (--nav-rail-shadow is `none` in .dark).
        'relative z-10 h-screen shrink-0 overflow-hidden bg-background shadow-nav-rail transition-[width] duration-200 dark:border-r dark:border-border',
        collapsed ? 'w-[72px]' : 'w-[240px]',
      )}
    >
      {renderContent()}
    </aside>
  );
}

export default Sidebar;
