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
  Briefcase,
  Building2,
  ChevronDown,
  ChevronRight,
  Contact,
  Crown,
  Factory,
  FileDown,
  FileSearch,
  LayoutGrid,
  List,
  LogOut,
  MapPin,
  MessageSquare,
  MessagesSquare,
  Package,
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
  ShoppingCart,
  Tag,
  Truck,
  User,
  UserCog,
  Users,
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

/** Badge số đếm trên 1 entry sidebar (đỏ = cần xử lý gấp, vàng = chờ gán/làm lại). */
interface SidebarBadge {
  count: number;
  tone: 'red' | 'amber';
  title: string;
}

type BadgeMap = Record<string, SidebarBadge[]>;

const SIDEBAR_BADGE_POLL_MS = 60_000;
// Mutation bump store → đợi ngắn cho các call liên tiếp (bulk) gộp 1 lần fetch.
const SIDEBAR_BADGE_DEBOUNCE_MS = 1_200;

async function fetchSidebarCounts(): Promise<void> {
  try {
    const res = await RepositoryRemote.designer.sidebarCounts();
    useSidebarBadgeStore.getState().setCounts(res.data?.data ?? null);
  } catch {
    // Poll nền — lỗi tạm thời thì giữ số cũ, không toast spam.
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

/** Chấm màu góc icon khi sidebar thu gọn / parent thu gọn — tooltip liệt kê từng số. */
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

/** Gộp badge của các entry con về 2 pill (đỏ/vàng) cho hàng parent đang đóng. */
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
   * AUTH-7 — mã `page.*` của trang này, khai RIÊNG khi `perm` là mã HÀNH ĐỘNG.
   * Menu vẫn ẩn/hiện theo `perm` như cũ (không đổi một mục nào); route thì gác
   * theo `pagePerm` vì quyền VÀO TRANG rộng hơn quyền THAO TÁC trên trang.
   */
  pagePerm?: string;
  /** Hiện khi user có BẤT KỲ perm nào trong danh sách (điều kiện OR, thay cho `perm`). */
  anyPerm?: string[];
  /** Role names to hide this entry from (bổ sung cho check `perm`). */
  hideForRoles?: string[];
  /**
   * CHỈ hiện cho đúng các role này. Khác `perm`: nhánh tắt `isAdmin` trong
   * `allow()` cho Admin lẫn SuperAdmin qua hết, nên `perm` KHÔNG thu hẹp được
   * xuống riêng SuperAdmin. Dùng cho mục Mạo danh (AUTH-1 BR-1).
   */
  onlyForRoles?: string[];
  /** Active cả khi đang ở route con của `to` (vd `/adm/settings/<section>`). */
  matchPrefix?: boolean;
}

interface NavItem {
  key: string;
  label: string;
  to?: string;
  icon: React.ReactNode;
  children?: NavChild[];
  perm?: string;
  /** CHỈ hiện cho đúng các role này — xem `NavChild.onlyForRoles`. */
  onlyForRoles?: string[];
  /** Ẩn với các role này — xem `NavChild.hideForRoles`. */
  hideForRoles?: string[];
  /** AUTH-7 — xem `NavChild.pagePerm`. */
  pagePerm?: string;
  /** Active cả khi đang ở route con của `to` (vd `/adm/settings/<section>`). */
  matchPrefix?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
  /**
   * Đánh dấu nhóm "cụm sản xuất" (Dashboard + Quản lý đơn + Công việc) để chèn
   * các cụm-theo-xưởng ngay sau nó. Không dò theo vị trí trong mảng: nhóm nào
   * cũng có thể bị lọc mất vì quyền, index sẽ trượt.
   */
  id?: string;
}

/** `NavGroup.id` của cụm sản xuất chung (toàn bộ xưởng). */
const PRODUCTION_GROUP_ID = 'production';

/**
 * AUTH-7 — bảng tra "đường dẫn trang → mã quyền", dựng TỪ CHÍNH cây menu ở dưới.
 *
 * Cố ý KHÔNG viết một bảng ánh xạ thứ hai bằng tay: menu và route được duy trì
 * tách rời nhau chính là thứ đẻ ra lỗi AUTH-7 (menu đã ẩn mục nhưng gõ thẳng URL
 * vẫn vào được). Thêm một bảng nữa là thêm một chỗ nữa để quên đồng bộ.
 *
 * Đường dẫn KHÔNG có trong bảng ⇒ trang đó không khai mã quyền ⇒ CHO VÀO (giữ
 * nguyên hành vi cũ). Mặc định mở là có chủ ý: chặn nhầm thì khoá nhân viên ra
 * khỏi trang họ dùng hằng ngày, còn lọt một trang thì API vẫn tự từ chối.
 */
export function buildPagePermissionMap(t: TFunction<'layout'>): Map<string, string> {
  const map = new Map<string, string>();
  const put = (to: string | undefined, perm: string | undefined) => {
    if (!to || !perm) return;
    // CHỈ nhận mã `page.*`. Vài mục menu gác bằng mã HÀNH ĐỘNG (`workshop.manage`,
    // `user.manage`, `role.manage`, `order.import`) — chúng chặt hơn quyền VÀO
    // TRANG: DesignerLeader có `page.workshop_config` nhưng không có
    // `workshop.manage`, lấy mã đó gác route là khoá mất trang họ được vào.
    // Những mục đó khai `pagePerm` riêng (caller đã ưu tiên), còn mục nào KHÔNG
    // có mã trang nào thì để route mở như trước — mặc định cho vào.
    if (!perm.startsWith('page.')) return;
    // Mục con của Dashboard trỏ tới cùng một trang kèm `?tab=...` — route chỉ
    // biết phần đường dẫn, nên cắt query đi. Giữ mục ĐẦU TIÊN gặp: cùng một
    // trang mà nhiều mục con khai perm khác nhau (vd Dashboard) thì lấy perm
    // của chính trang đó, không lấy perm hẹp hơn của một tab bên trong.
    const path = to.split('?')[0];
    if (!map.has(path)) map.set(path, perm);
  };
  for (const group of buildNavGroups(t)) {
    for (const item of group.items) {
      put(item.to ?? item.key, item.pagePerm ?? item.perm);
      for (const child of item.children ?? []) put(child.to, child.pagePerm ?? child.perm ?? item.pagePerm ?? item.perm);
    }
  }
  return map;
}

/**
 * Gắn `?factoryId=` vào link của "cụm menu theo xưởng". Link gốc có thể đã có
 * sẵn query (`?tab=factory`) nên phải chọn đúng dấu nối.
 */
function withFactory(to: string, factoryId?: string): string {
  if (!factoryId) return to;
  return `${to}${to.includes('?') ? '&' : '?'}factoryId=${encodeURIComponent(factoryId)}`;
}

/**
 * Cụm sản xuất: Dashboard + Quản lý đơn + Công việc. Dùng 2 lần —
 *  - `factoryId` rỗng: cụm CHUNG ở đầu sidebar (toàn bộ xưởng, như trước);
 *  - có `factoryId`: 1 cụm riêng cho mỗi xưởng, mọi link kèm `?factoryId=` nên
 *    trang mở ra đã lọc sẵn xưởng đó (`useFactoryScope`).
 *
 * `keyPrefix` để key menu không đụng nhau giữa các cụm (React key + badgeMap).
 * Cụm xưởng KHÔNG gắn badge: số badge là số toàn hệ thống, treo lên cụm xưởng
 * sẽ đọc nhầm thành số của riêng xưởng đó.
 */
function buildProductionItems(t: TFunction<'layout'>, factoryId?: string, keyPrefix = '', scopeOnly = false): NavItem[] {
  const k = (key: string) => `${keyPrefix}${key}`;
  const to = (path: string) => withFactory(path, factoryId);
  const items: NavItem[] = [
    {
      key: k(PATHS.HOME),
      label: t('sidebar.dashboard.title'),
      icon: <LayoutGrid size={17} />,
      perm: 'page.dashboard',
      children: [
        {
          key: k('dash-factory'),
          label: t('sidebar.dashboard.factory'),
          to: to(`${PATHS.HOME}?tab=factory`),
          icon: <Factory size={14} />,
        },
        {
          key: k('dash-stats'),
          label: t('sidebar.dashboard.stats'),
          to: to(`${PATHS.HOME}?tab=stats`),
          icon: <BarChart3 size={14} />,
        },
        // Entry "Tình trạng đơn hàng" TẠM ẨN (2026-07, không cần nữa) —
        // bật lại: bỏ comment + import lại ClipboardList từ lucide-react,
        // đồng bộ với tab "status" đang comment ở pages/home/index.tsx.
        // {
        //   key: k('dash-status'),
        //   label: t('sidebar.dashboard.status'),
        //   to: to(`${PATHS.HOME}?tab=status`),
        //   icon: <ClipboardList size={14} />,
        // },
        {
          key: k('dash-lifecycle'),
          label: t('sidebar.dashboard.lifecycle'),
          to: to(`${PATHS.HOME}?tab=lifecycle`),
          icon: <Workflow size={14} />,
        },
        {
          key: k('dash-tool-check'),
          label: t('sidebar.dashboard.toolCheck'),
          to: to(`${PATHS.HOME}?tab=tool-check`),
          icon: <FileSearch size={14} />,
          perm: 'page.tool_check',
        },
        // Entry "Lỗi theo người" TẠM ẨN (2026-07, không cần nữa) — đồng bộ
        // với tab "person-error" đang comment ở pages/home/index.tsx.
        // {
        //   key: k('dash-person-error'),
        //   label: t('sidebar.dashboard.personError'),
        //   to: to(`${PATHS.HOME}?tab=person-error`),
        //   icon: <AlertTriangle size={14} />,
        //   anyPerm: ['page.designer_stats', 'page.tool_check'],
        // },
        {
          key: k('dash-designer'),
          label: t('sidebar.dashboard.designer'),
          to: to(`${PATHS.HOME}?tab=designer`),
          icon: <Palette size={14} />,
          perm: 'page.designer_stats',
        },
      ],
    },
    {
      key: k(PATHS.ORDERS),
      label: t('sidebar.orders.title'),
      icon: <ShoppingCart size={17} />,
      perm: 'page.orders',
      children: [
        // "List Order" (tab cũ) đang tạm tắt (xem pages/orders/ListOrderTab.tsx)
        // — thay bằng "Danh sách đơn", đúng trang default thật hiện tại.
        {
          key: k('orders-workshop'),
          label: t('sidebar.orders.list'),
          to: to(PATHS.ORDERS_WORKSHOP),
          icon: <List size={14} />,
        },
        {
          key: k('orders-error-log'),
          label: t('sidebar.orders.errorLog'),
          to: to(PATHS.ORDERS_ERROR_LOG),
          icon: <AlertTriangle size={14} />,
          hideForRoles: ['Support'],
        },
        {
          key: k('orders-scan-error'),
          label: t('sidebar.orders.scanError'),
          to: to(PATHS.ORDERS_SCAN_ERROR),
          icon: <ScanLine size={14} />,
          perm: 'page.scan_error',
        },
        {
          key: k('orders-stage-errors'),
          label: t('sidebar.orders.stageErrors'),
          to: to(PATHS.ORDERS_STAGE_ERRORS),
          icon: <Barcode size={14} />,
          perm: 'page.stage_errors',
        },
        {
          key: k('orders-unmapped'),
          label: t('sidebar.orders.unmapped'),
          to: to(PATHS.ORDERS_UNMAPPED),
          icon: <MapPin size={14} />,
          perm: 'page.unmapped_factory',
        },
        {
          key: k('orders-shipments'),
          label: t('sidebar.orders.shipments'),
          to: to(PATHS.SHIPMENTS),
          icon: <Truck size={14} />,
          // Toàn bộ bề mặt VNP shipping chỉ Admin/SuperAdmin (VnpShipping.md §7).
          onlyForRoles: [RoleType.SuperAdmin, RoleType.Admin],
        },
        {
          key: k('orders-import'),
          label: t('sidebar.orders.import'),
          to: to(PATHS.ORDERS_IMPORT),
          icon: <FileDown size={14} />,
          perm: 'order.import',
        },
        {
          key: k('orders-cutting-files'),
          label: t('sidebar.orders.cuttingFiles'),
          to: to(PATHS.ORDERS_CUTTING_FILES),
          icon: <Scissors size={14} />,
          perm: 'order.import',
        },
      ],
    },
    {
      key: k('work'),
      label: t('sidebar.work.title'),
      icon: <Briefcase size={17} />,
      children: [
        {
          key: k(PATHS.MY_TASKS),
          label: t('sidebar.work.myTasks'),
          to: to(PATHS.MY_TASKS),
          icon: <List size={14} />,
          perm: 'page.my_tasks',
        },
        {
          key: k(PATHS.FULFILLMENT_MY_TASKS),
          label: t('sidebar.work.fulfillmentTasks'),
          to: to(PATHS.FULFILLMENT_MY_TASKS),
          icon: <Factory size={14} />,
          perm: 'page.fulfillment_my_tasks',
        },
      ],
    },
    {
      // Hướng dẫn quy trình DTF theo vai (DtfRoleGuide.md) — trang tĩnh, nội dung không phụ thuộc xưởng; link vẫn
      // mang `?factoryId=` như cả cụm để quay lại trang khác không mất phạm vi xưởng đang chọn.
      key: k(PATHS.DTF_GUIDE),
      label: t('sidebar.guideDtf'),
      to: to(PATHS.DTF_GUIDE),
      icon: <BookOpen size={17} />,
      perm: 'page.guide_dtf',
    },
  ];
  // `scopeOnly` (07/09/2026): cụm sản xuất CHUNG chỉ MANG THEO `?factoryId=` đang chọn ở bộ chọn
  // xưởng trên header (để đổi trang không mất phạm vi), KHÔNG ẩn/đổi nhãn như cụm riêng từng xưởng cũ.
  if (!factoryId || scopeOnly) return items;

  // Trong cụm của 1 xưởng, các mục này KHÔNG thuộc phạm vi xưởng nào cả: danh
  // mục lỗi công đoạn là danh mục dùng chung, "Không xác định xưởng" theo định
  // nghĩa là đơn CHƯA có xưởng, import đơn / import file cắt là thao tác nạp dữ
  // liệu toàn hệ thống, quét mã là thao tác tại trạm (máy quét đã ở đúng xưởng
  // rồi), còn Designer không thuộc xưởng nào (liên kết designer↔xưởng chỉ tồn
  // tại trong cấu hình auto-gán).
  const hidden = new Set([
    k('dash-designer'),
    k('orders-scan-error'),
    k('orders-stage-errors'),
    k('orders-unmapped'),
    k('orders-import'),
    k('orders-cutting-files'),
  ]);
  // Tiêu đề cụm đã là tên xưởng rồi, nên nhãn bên trong bỏ phần lặp lại
  // ("Đơn hàng theo xưởng" → "Tổng quan xưởng", "Quản lý đơn" → "Đơn hàng").
  const relabel: Record<string, string> = {
    [k(PATHS.HOME)]: t('sidebar.factoryScope.dashboard'),
    [k('dash-factory')]: t('sidebar.factoryScope.overview'),
    [k(PATHS.ORDERS)]: t('sidebar.factoryScope.orders'),
  };
  return items
    .map((it) => ({
      ...it,
      label: relabel[it.key] ?? it.label,
      children: it.children
        ?.filter((c) => !hidden.has(c.key))
        .map((c) => ({ ...c, label: relabel[c.key] ?? c.label })),
    }))
    .filter((it) => !it.children || it.children.length > 0);
}

function buildNavGroups(t: TFunction<'layout'>, factoryScopeId?: string, userEmail?: string): NavGroup[] {
  return [
    {
      id: PRODUCTION_GROUP_ID,
      title: '',
      // Link mang theo xưởng đang chọn ở header (`FactoryScopeSwitch`) — xem Orders.md §25.
      items: buildProductionItems(t, factoryScopeId, '', true),
    },
    {
      // Nhóm menu RIÊNG cho "Đơn hàng" (bảng phẳng, phân trang THẬT, KHÔNG gộp
      // theo sản phẩm — khác "Danh sách đơn" ở nhóm trên dùng getOrdersGrouped).
      // Cùng cột/filter/bulk với Workshop, chỉ khác cách hiển thị + KHÔNG có
      // Designer Summary. Xem OrderTableClassic.tsx.
      title: t('sidebar.groups.orders'),
      items: [
        {
          key: PATHS.ORDERS_CLASSIC,
          label: t('sidebar.orders.classic'),
          to: PATHS.ORDERS_CLASSIC,
          icon: <Rows3 size={17} />,
          perm: 'page.orders',
        },
      ],
    },
    {
      title: t('sidebar.groups.catalog'),
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
          // DesignerLeader CÓ `page.workshop_config` nhưng KHÔNG có `workshop.manage`:
          // menu vẫn ẩn như trước, còn route thì mở — đúng quyền vào trang của họ.
          pagePerm: 'page.workshop_config',
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
    {
      // Bảng điều hành cho lãnh đạo — CHỈ SuperAdmin/Admin (không mã quyền: khóa cứng theo vai,
      // cùng cách với Chat Zalo). Trang cũng tự chặn vai khác (pages/ceo/index.tsx).
      title: t('sidebar.groups.ceo'),
      items: [
        {
          key: PATHS.CEO_DASHBOARD,
          label: t('sidebar.ceoDashboard'),
          to: PATHS.CEO_DASHBOARD,
          icon: <Crown size={17} />,
          onlyForRoles: [RoleType.SuperAdmin, RoleType.Admin],
        },
      ],
    },
    {
      title: t('sidebar.groups.admin'),
      items: [
        {
          key: 'admin-people',
          label: t('sidebar.peoplePermissions'),
          icon: <Users size={17} />,
          children: [
            {
              key: PATHS.DESIGNER_TEAM,
              label: t('sidebar.designerTeam'),
              to: PATHS.DESIGNER_TEAM,
              icon: <Palette size={14} />,
              perm: 'page.designer_team',
            },
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
        {
          key: PATHS.CUSTOMERS,
          label: t('sidebar.customers'),
          to: PATHS.CUSTOMERS,
          icon: <Contact size={17} />,
          perm: 'page.customers',
        },
        // Ba mục Zalo/Telegram chỉ hiện cho tài khoản trong danh sách trắng
        // (`constants/zaloAccess.ts`). Chốt THẬT nằm ở backend — đây là lớp hiển
        // thị để người không có quyền khỏi bấm vào rồi nhận 403.
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
                // Màn chat Zalo nhúng (module của nhà cung cấp). Phân quyền chi
                // tiết vẫn ở dialog "Phân quyền" của engine; danh sách trắng này
                // đứng trước, quyết ai được cấp phiên.
                key: PATHS.ZALO_CHAT,
                label: t('sidebar.zaloChat'),
                to: PATHS.ZALO_CHAT,
                icon: <MessagesSquare size={17} />,
              },
              {
                // Cùng engine, cùng phiên với màn Zalo — nên cùng chốt.
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
    !(roleName && c.hideForRoles?.includes(roleName)) && (!c.onlyForRoles || (!!roleName && c.onlyForRoles.includes(roleName)));
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
  /** Thu gọn/mở rộng (desktop) — nút nằm cạnh logo, dời từ header sang 07/09/2026. */
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
  // `factoryId` so khớp HAI CHIỀU, khác mọi param khác: cụm chung và cụm từng
  // xưởng dùng CHUNG đường dẫn, chỉ khác param này. Nếu chỉ kiểm "link ⊆ URL"
  // như bên dưới thì mục ở cụm chung (không có `factoryId`) luôn active kể cả
  // khi đang xem một xưởng — sáng cùng lúc 2 mục, và bấm mục chung trông như
  // không có tác dụng gì.
  if ((linkParams.get('factoryId') || '') !== (currentParams.get('factoryId') || '')) return false;
  if (!queryPart) return true;
  // exact query param subset check
  for (const [k, v] of linkParams.entries()) {
    if (currentParams.get(k) !== v) return false;
  }
  return true;
}

/**
 * Đường dẫn dùng cho tín hiệu "click lại menu đang active → xóa filter trang".
 * Cắt `factoryId` đi vì trang đăng ký tín hiệu bằng `to` GỐC (không có phạm vi
 * xưởng) — giữ nguyên thì mục trong cụm xưởng không bao giờ khớp, bấm lại
 * không xóa được filter.
 */
function resetPathOf(to: string): string {
  const [path, query] = to.split('?');
  if (!query) return to;
  const sp = new URLSearchParams(query);
  sp.delete('factoryId');
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
  return (
    <Link
      to={item.to}
      // Click lại menu ĐANG active → Router coi là no-op (không điều hướng),
      // nên phát tín hiệu riêng để trang tự xóa filter (xem `useSidebarResetSignal`).
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
            <SidebarLeaf key={c.key} item={c} collapsed={false} level={1} badges={badgeMap[c.key]} />
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
  // Quyền xem dữ liệu Zalo đi theo TÀI KHOẢN, không theo role — xem `constants/zaloAccess.ts`.
  const userEmail = profile?.email as string | undefined;
  const permissionCodes = useMemo(
    () => new Set<string>(profile?.role?.permissionCodes || []),
    [profile?.role?.permissionCodes],
  );
  // Phạm vi xưởng đang chọn (URL `factoryId`, đặt từ bộ chọn ở header) — link cụm sản
  // xuất mang theo để đổi trang không mất phạm vi. 5 cụm menu riêng từng xưởng đã GỠ
  // (07/09/2026) — thay bằng `FactoryScopeSwitch` trên header (Orders.md §25).
  const [searchParams] = useSearchParams();
  const factoryScopeId = searchParams.get('factoryId') || undefined;
  const navGroups = useMemo(
    () => filterMenuByPermissions(buildNavGroups(t, factoryScopeId, userEmail), permissionCodes, isAdmin, roleName),
    [t, factoryScopeId, userEmail, permissionCodes, isAdmin, roleName],
  );

  const counts = useSidebarBadgeStore((s) => s.counts);
  const refreshRequestedAt = useSidebarBadgeStore((s) => s.refreshRequestedAt);
  const profileId = profile?._id;

  // Polling nhẹ 60s (chỉ khi tab đang hiển thị) — endpoint count-only, vài chục ms.
  useEffect(() => {
    if (!profileId) return;
    fetchSidebarCounts();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchSidebarCounts();
    }, SIDEBAR_BADGE_POLL_MS);
    return () => clearInterval(id);
  }, [profileId]);

  // Mutation liên quan vừa thành công (bump từ axios interceptor) → refetch ngay
  // sau debounce ngắn để số giảm liền khi chính user làm xong task.
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
    // Nhật ký bù lỗi: số theo góc nhìn chặng của viewer (Fulfillment/Designer =
    // việc của mình; Admin/Manager = toàn hệ thống) — title đổi theo cho đúng nghĩa.
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
    // TooltipProvider cho tooltip badge (BadgePill/BadgeDot) — delay ngắn để
    // hover là thấy ngay con số nghĩa là gì.
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col h-full bg-background">
        <div
          className={cn('flex items-center gap-2 h-14 border-b border-border', showLabels ? 'px-3' : 'justify-center px-1')}
        >
          {showLabels && <img src={logoUrl} alt="Logo" className="h-7 w-auto min-w-0 object-contain" />}
          {/* Nút thu gọn/mở rộng — chỉ desktop (mobile dùng Sheet có nút đóng riêng). */}
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
                <p
                  className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
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
        // Cao đúng màn hình + không tràn: chỉ danh sách menu bên trong cuộn, logo trên
        // và khối tài khoản dưới ghim cố định (khung cố định — MainLayout).
        'h-screen shrink-0 overflow-hidden border-r border-border bg-background transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-[240px]',
      )}
    >
      {renderContent()}
    </aside>
  );
}

export default Sidebar;
