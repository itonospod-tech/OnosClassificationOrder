/**
 * Vai + bước của trang hướng dẫn quy trình DTF (`PATHS.DTF_GUIDE` = `/ffm/guide/dtf`, DtfRoleGuide.md §2).
 *
 * Hình học ảnh (kích thước, khung chú thích, lưới mực) KHÔNG viết tay: lấy từ `dtfShots.generated.ts`
 * (sinh bằng `scripts/dtf-guide/emit-ts.mjs`). File này chỉ quyết định THỨ TỰ bước, vai nhận/giao và khoá i18n
 * (`dtfGuide` → `roles.<vai>.steps.<bước>`). Đổi tên ảnh mà quên sửa ở đây → type-check báo lỗi (`DtfShotKey`).
 */

import type { LucideIcon } from 'lucide-react';
import { ClipboardCheck, FileSearch, Flame, Package, Palette, Printer, UserCog, Users } from 'lucide-react';
import { FulfillmentStage, RoleType } from 'shared';

import type { GuideStep } from '../order/guideTypes';
import { DTF_SHOTS } from './dtfShots.generated';

/** Thứ tự vai trên thanh chọn = thứ tự thư mục ảnh trong manifest. Giá trị này cũng là `?role=` trên URL. */
export const DTF_ROLE_IDS = [
  'support',
  'designer-leader',
  'designer',
  'fulfillment-print',
  'fulfillment-press',
  'fulfillment-qc-post-press',
  'fulfillment-pack',
  'admin',
] as const;

export type DtfRoleId = (typeof DTF_ROLE_IDS)[number];

/** Ô trên sơ đồ luồng: vai + 3 ô không phải vai (đầu vào, May tự xong, kết thúc). */
export type DtfFlowNodeId = DtfRoleId | 'import' | 'sew' | 'done';

type DtfShotKey = keyof typeof DTF_SHOTS;

/**
 * `AnnotatedShot` của TASK-01 ghép `src = ${BASE_URL}guide/order/ + file` (không nhận tham số thư mục, không được sửa).
 * Nối tiền tố `../dtf/` → trình duyệt chuẩn hoá `/guide/order/../dtf/x.webp` thành `/guide/dtf/x.webp`.
 */
export const DTF_FILE_PREFIX = '../dtf/';

const shot = (key: DtfShotKey): GuideStep => {
  const s = DTF_SHOTS[key];
  return { ...s, id: key.slice(key.indexOf('/') + 1), file: `${DTF_FILE_PREFIX}${s.file}` };
};

export interface DtfRole {
  id: DtfRoleId;
  icon: LucideIcon;
  steps: GuideStep[];
  /** Nhận việc từ / giao cho — ô là vai thì hiện nút chuyển sang vai đó. */
  from: DtfFlowNodeId[];
  to: DtfFlowNodeId[];
  /** Khoá `roles.<id>.errors.<key>` — khối "Khi có lỗi / làm lại". */
  errorKeys: readonly string[];
  /** Khoá `roles.<id>.notes.<key>` — khối "Lưu ý". */
  noteKeys: readonly string[];
  /** Có cảnh báo đầu vai (`roles.<id>.alert`). */
  alert?: boolean;
}

export const DTF_ROLES: DtfRole[] = [
  {
    id: 'support',
    icon: FileSearch,
    from: ['import'],
    to: ['fulfillment-print', 'designer-leader'],
    steps: [
      shot('support/01-login'),
      shot('support/02-tool-check-overview'),
      shot('support/03-unreviewed-list'),
      shot('support/04-note-options'),
      shot('support/05-rework-list'),
      shot('support/06-hold-dialog'),
    ],
    errorKeys: ['printMissingFile', 'wrongOk', 'waitCustomer'],
    noteKeys: ['menus', 'priorityFirst', 'allFactories'],
  },
  {
    id: 'designer-leader',
    icon: Users,
    from: ['support'],
    to: ['designer'],
    steps: [
      shot('designer-leader/01-assign-backlog'),
      shot('designer-leader/02-select-orders'),
      shot('designer-leader/03-assign-dialog'),
      shot('designer-leader/04-designer-team'),
      shot('designer-leader/05-team-matrix'),
    ],
    errorKeys: ['reworkUnassigned', 'cannotDo'],
    noteKeys: ['mixedBacklog', 'noAutoAssign', 'rememberAdminOnly'],
  },
  {
    id: 'designer',
    icon: Palette,
    from: ['designer-leader'],
    to: ['fulfillment-print'],
    steps: [
      shot('designer/01-my-tasks'),
      shot('designer/02-task-card'),
      shot('designer/03-task-detail'),
      shot('designer/04-start-bulk'),
      shot('designer/05-complete-bulk'),
      shot('designer/06-rework-card'),
      shot('designer/07-watching'),
      shot('designer/08-reject-modal'),
    ],
    errorKeys: ['rework', 'watching', 'cannotDo'],
    noteKeys: ['noEdit', 'allFactories'],
  },
  {
    id: 'fulfillment-print',
    icon: Printer,
    from: ['support', 'designer'],
    to: ['fulfillment-press'],
    steps: [
      shot('fulfillment-print/01-print-table'),
      shot('fulfillment-print/02-start'),
      shot('fulfillment-print/03-complete'),
      shot('fulfillment-print/04-report-error'),
      shot('fulfillment-print/05-error-cell'),
      shot('fulfillment-print/06-rework-watching'),
      shot('fulfillment-print/07-scan'),
    ],
    errorKeys: ['designer', 'missingFile', 'reworkNoButton', 'held'],
    noteKeys: ['openMenu', 'today', 'qrWording'],
  },
  {
    id: 'fulfillment-press',
    icon: Flame,
    from: ['fulfillment-print'],
    to: ['fulfillment-qc-post-press'],
    steps: [
      shot('fulfillment-press/01-kanban'),
      shot('fulfillment-press/02-scan-dialog'),
      shot('fulfillment-press/03-card-actions'),
      shot('fulfillment-press/04-rework-dialog'),
      shot('fulfillment-press/05-watching'),
      shot('fulfillment-press/06-stage-errors'),
    ],
    errorKeys: ['back', 'returned'],
    noteKeys: ['openMenu', 'rawFactory', 'qrWording'],
  },
  {
    id: 'fulfillment-qc-post-press',
    icon: ClipboardCheck,
    alert: true,
    from: ['fulfillment-press'],
    to: ['fulfillment-pack'],
    steps: [
      shot('fulfillment-qc-post-press/01-kanban'),
      shot('fulfillment-qc-post-press/02-scan-ok'),
      shot('fulfillment-qc-post-press/03-scan-error-2x'),
      shot('fulfillment-qc-post-press/04-rework-dialog'),
      shot('fulfillment-qc-post-press/05-barcode-sheet'),
    ],
    errorKeys: ['scan', 'dialog', 'watching'],
    noteKeys: ['openMenu', 'noSew', 'scanPageOnly'],
  },
  {
    id: 'fulfillment-pack',
    icon: Package,
    alert: true,
    from: ['fulfillment-qc-post-press'],
    to: ['done'],
    steps: [
      shot('fulfillment-pack/01-kanban'),
      shot('fulfillment-pack/02-bulk-complete'),
      shot('fulfillment-pack/03-report-error'),
      shot('fulfillment-pack/04-scan-complete'),
      shot('fulfillment-pack/05-scan-done'),
    ],
    errorKeys: ['changeChip', 'onlyInProgress'],
    noteKeys: ['openMenu', 'autoPack', 'qrWording'],
  },
  {
    id: 'admin',
    icon: UserCog,
    alert: true,
    from: [],
    to: [],
    steps: [
      shot('admin/01-factory-scope'),
      shot('admin/02-lifecycle'),
      shot('admin/03-workshop-list'),
      shot('admin/04-hold-unhold'),
      shot('admin/05-error-log'),
      shot('admin/06-scan-assign-error'),
      shot('admin/07-stage-error-catalog'),
      shot('admin/08-factory-flow'),
      shot('admin/09-users-list'),
      shot('admin/10-users-worker'),
    ],
    errorKeys: ['stuck', 'hold', 'errorLog', 'noWorker'],
    noteKeys: ['errorLogNoFactory', 'catalogShared', 'noOverride', 'allFactories'],
  },
];

export const DTF_ROLE_BY_ID = Object.fromEntries(DTF_ROLES.map((r) => [r.id, r])) as Record<DtfRoleId, DtfRole>;

/** Vai có từ ngần này bước trở lên thì hiện mục lục bước (Admin 10, Designer 8, In 7, Support/Ép 6). */
export const TOC_MIN_STEPS = 6;

export const isDtfRoleId = (value: string | null | undefined): value is DtfRoleId =>
  !!value && (DTF_ROLE_IDS as readonly string[]).includes(value);

export const dtfRoleAnchorId = (roleId: DtfRoleId) => `dtf-role-${roleId}`;
export const dtfStepAnchorId = (roleId: DtfRoleId, stepId: string) => `dtf-${roleId}-${stepId}`;

const STAGE_ROLE: Partial<Record<string, DtfRoleId>> = {
  [FulfillmentStage.Print]: 'fulfillment-print',
  [FulfillmentStage.Press]: 'fulfillment-press',
  [FulfillmentStage.QCPostPress]: 'fulfillment-qc-post-press',
  [FulfillmentStage.Pack]: 'fulfillment-pack',
};

/**
 * Vai hướng dẫn ứng với tài khoản đang đăng nhập; `null` = không có vai tương ứng (vd Fulfillment giữ công đoạn
 * May, role khác). Trang mở vai này khi URL không có `?role=` hợp lệ; `null` thì mở vai đầu tiên.
 */
export function userDtfRole(roleName: string | undefined, stage: string | undefined): DtfRoleId | null {
  switch (roleName) {
    case RoleType.Support:
    case RoleType.SupportManager:
      return 'support';
    case RoleType.DesignerLeader:
      return 'designer-leader';
    case RoleType.Designer:
      return 'designer';
    case RoleType.Fulfillment:
      return (stage && STAGE_ROLE[stage]) || null;
    case RoleType.Admin:
    case RoleType.SuperAdmin:
    case RoleType.Manager:
      return 'admin';
    default:
      return null;
  }
}
