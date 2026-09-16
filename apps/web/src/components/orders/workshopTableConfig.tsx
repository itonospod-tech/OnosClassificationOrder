import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Clock } from 'lucide-react';
import { DesignerStatus, WorkshopConfigCategory } from 'shared';

import { useAuthStore } from '@/store/authStore';

import { CopyButton } from '@/components/common/CopyButton';
import { Hint } from '@/components/common/Hint';
import { AssigneeSelectCell } from '@/components/orders/cells/AssigneeSelectCell';
import { ColorBadgeSelectCell } from '@/components/orders/cells/ColorBadgeSelectCell';
import { ErrorSourceCell } from '@/components/orders/cells/ErrorSourceCell';
import { IconSelectCell } from '@/components/orders/cells/IconSelectCell';
import { ImageThumbCell } from '@/components/orders/cells/ImageThumbCell';
import { MultiIconSelectCell } from '@/components/orders/cells/MultiIconSelectCell';
import { PrioritySelectCell } from '@/components/orders/cells/PrioritySelectCell';
import { ProductionErrorSelectCell } from '@/components/orders/cells/ProductionErrorSelectCell';
import { TextEditCell } from '@/components/orders/cells/TextEditCell';
import { HeldBadge, OnospodHoldBadge } from '@/components/orders/HeldBadge';
import { ReworkReasonNote } from '@/components/orders/ReworkReasonNote';
import { Badge } from '@/components/ui/badge';

import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/date';
import { showOnospodHoldFlag } from '@/utils/orderActions';
import { getOrderStatusInfo, makeOrderStatusTranslate, ORDER_STATUS_TONE_CLASS } from '@/utils/orderStatusLabel';
import { formatCountdown, getActiveStageKey, getStageDeadline } from '@/utils/priorityEstimate';

import { useNow } from '@/hooks/useNow';

export type WorkshopOrderRow = {
  _id: string;
  productionId: string;
  userSku?: string;
  size?: string;
  color?: string;
  type?: string;
  /** Số lượng cần sản xuất — công đoạn In quyết định in bao nhiêu bản. */
  quantity?: number;
  mockupUrl?: string;
  mockupOriginalUrl?: string;
  designs?: { front?: string } & Record<string, string | undefined>;
  designsOriginal?: { front?: string } & Record<string, string | undefined>;
  /** Trạng thái pipeline R2 cho từng vị trí design (Design-R2-Pipeline). */
  designsStatus?: Partial<Record<string, 'pending' | 'ready' | 'failed'>>;
  orderId?: string;
  /** Mã đơn bên sàn (TikTok/Etsy...) — cột "External ID" lúc import. */
  externalId?: string;
  /** Thời gian khách lên đơn (lấy từ cột "Order at" trong sheet). */
  orderAt?: string;
  inProductionAt?: string;
  factory?: { name?: string; shortName?: string };
  machineType?: { name?: string; shortName?: string };
  originalFactoryId?: string;
  factoryId?: string;
  isMapped?: boolean;
  productConfigId?: string;
  productConfig?: { fullName?: string; shortName?: string; mockup?: string; level?: number };

  weight?: number;
  /** Snapshot địa chỉ nhận (đơn khách portal / kéo ngược từ OnosPod). */
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    company?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    email?: string;
    phone?: string;
  };
  /** Vận đơn VNP eGlobal (module shipping-vnp) — date là ISO string qua JSON. */
  vnpShipment?: {
    shipmentId?: string;
    trackingCode?: string;
    labelUrl?: string;
    service?: string;
    shippingType?: string;
    toAddressId?: string;
    addressValid?: boolean;
    addressCheckedAt?: string;
    createdAt?: string;
    cancelledAt?: string;
    lastTrackingStatus?: string;
    lastTrackingAt?: string;
  };
  /**
   * Vận đơn KHÁCH TỰ CẤP đi kèm lúc lên đơn (CSV khách/admin, Public Order
   * API) — khác `vnpShipment` (label hệ thống tự mua). Xưởng cần thấy để in
   * dán ở công đoạn Đóng hàng nên KHÔNG gate theo role admin.
   */
  tracking?: {
    number?: string;
    carrier?: string;
    url?: string;
    labelUrl?: string;
  };

  priority?: number;
  printStatus?: string;
  printStatusNote?: string;
  toolResult?: string;
  toolResultNote?: string;
  /** Multi-select array of workshop_config codes (category=error_file_type). */
  errorFile?: string[];
  errorFileNote?: string;
  assignee?: string;
  assigneeNote?: string;
  fabricType?: string;
  machineNumber?: string;
  productionError?: string;
  productionErrorNote?: string;
  productionErrorSource?: 'designer' | 'factory' | 'tool-check';
  productionErrorCount?: number;
  /** Set khi bấm "Hoàn thành lỗi" ở Nhật ký bù lỗi; báo lỗi mới sẽ clear. Đơn ĐANG lỗi = productionError set + field này rỗng. */
  errorResolvedAt?: string | null;

  // Phase 3 Designer-Task-Workflow
  designerStatus?: DesignerStatus;
  designerAssignedAt?: string;
  designerStartedAt?: string;
  designerCompletedAt?: string;
  designerRejectedAt?: string;
  designerReworkAt?: string;
  designerRejectedReason?: string;
  designerReworkCount?: number;

  // Fulfillment — dùng cho cột action stage In trên trang Fulfillment print.
  currentFulfillmentStage?: string | null;
  fulfillmentStages?: Record<string, ({ status?: string } & Record<string, unknown>) | undefined>;
  /** Đóng hàng xong — gate "Chuyển hoàn thành" ở menu "..." (Orders.md §23). */
  fulfillmentCompletedAt?: string | null;

  // Hủy đơn (soft) — badge "Đã hủy" + gate action.
  cancelledAt?: string | null;
  cancelReason?: string;

  // Giữ đơn (hold) — badge "Đang giữ" + khóa mọi thao tác (reversible).
  heldAt?: string | null;
  holdReason?: string;
  /** `onospod` = đồng bộ tự giữ theo OnosPod (Orders.md §9d). */
  holdSource?: string | null;
  /** Cờ "OnosPod đang giữ" — hiện nhãn khi đơn bên mình không giữ. */
  onospodHold?: { onHoldAt?: string; seenAt?: string } | null;
};

function buildDesignerStatusMeta(t: TFunction<'orders'>): Record<DesignerStatus, { label: string; cls: string; tooltip: string }> {
  return {
    [DesignerStatus.Unassigned]: {
      label: t('workshopCols.designerStatus.unassigned.label'),
      cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
      tooltip: t('workshopCols.designerStatus.unassigned.tooltip'),
    },
    [DesignerStatus.Assigned]: {
      label: t('workshopCols.designerStatus.assigned.label'),
      cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
      tooltip: t('workshopCols.designerStatus.assigned.tooltip'),
    },
    [DesignerStatus.InProgress]: {
      label: t('workshopCols.designerStatus.inProgress.label'),
      cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
      tooltip: t('workshopCols.designerStatus.inProgress.tooltip'),
    },
    [DesignerStatus.Done]: {
      label: t('workshopCols.designerStatus.done.label'),
      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      tooltip: t('workshopCols.designerStatus.done.tooltip'),
    },
    [DesignerStatus.Rejected]: {
      label: t('workshopCols.designerStatus.rejected.label'),
      cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
      tooltip: t('workshopCols.designerStatus.rejected.tooltip'),
    },
    [DesignerStatus.Rework]: {
      label: t('workshopCols.designerStatus.rework.label'),
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      tooltip: t('workshopCols.designerStatus.rework.tooltip'),
    },
  };
}

/** Fallback y hệt bản gốc — dùng khi `ctx.t` không có (consumer ngoài batch i18n này). */
const DESIGNER_STATUS_META_FALLBACK: Record<DesignerStatus, { label: string; cls: string; tooltip: string }> = {
  [DesignerStatus.Unassigned]: {
    label: 'Chưa gán',
    cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    tooltip: 'Chưa assign cho designer nào',
  },
  [DesignerStatus.Assigned]: {
    label: 'Đã gán',
    cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
    tooltip: 'Designer được giao, chưa nhận làm',
  },
  [DesignerStatus.InProgress]: {
    label: 'Đang làm',
    cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    tooltip: 'Designer đang xử lý',
  },
  [DesignerStatus.Done]: {
    label: 'Đã xong',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    tooltip: 'Designer hoàn thành — toolResultNote auto = ok',
  },
  [DesignerStatus.Rejected]: {
    label: 'Không làm được',
    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    tooltip: 'Designer báo file không làm được — leader cần giao lại',
  },
  [DesignerStatus.Rework]: {
    label: 'Cần làm lại',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    tooltip: 'Xưởng báo lỗi do design — chính designer này làm lại',
  },
};

/**
 * Header cột / group được định nghĩa module-scope (`WORKSHOP_COLS`,
 * `BASE_GROUP_DEFS`) vì được import trực tiếp (không qua factory function) bởi
 * nhiều trang khác ngoài batch i18n này (OrderFactoryTab, DesignerDrillPanel,
 * DesignerAssignBacklog, OrdersMiniTable…) — đổi shape sẽ vỡ build các trang đó.
 * 2 helper dưới đây cho phép các trang ĐÃ convert i18n (trong batch này) dịch
 * label/title mà không cần đổi shape `WORKSHOP_COLS`/`BASE_GROUP_DEFS`: dùng
 * key `workshopCols.col.<key>` / `workshopCols.group.<key>` nếu có bản dịch,
 * fallback về text tiếng Việt gốc (`fallback`) nếu chưa có key.
 */
export function colLabel(t: TFunction<'orders'>, key: string, fallback: string): string {
  return t(`workshopCols.col.${key}`, { defaultValue: fallback });
}
export function groupTitle(t: TFunction<'orders'>, key: string, fallback: string): string {
  return t(`workshopCols.group.${key}`, { defaultValue: fallback });
}

/**
 * Dịch 1 chuỗi động BÊN TRONG `render()` của `WorkshopColMeta` (hint/badge/toast)
 * qua `ctx.t` optional — xem ghi chú `WorkshopRenderCtx.t`. `render()` là hàm
 * thường (không phải component) nên KHÔNG được gọi `useTranslation` trực tiếp;
 * `ctx.t` do component cha (đã có hook context) truyền xuống.
 */
function tr(
  ctx: WorkshopRenderCtx,
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
): string {
  return ctx.t ? ctx.t(key, { defaultValue: fallback, ...options }) : fallback;
}

export interface WorkshopRenderCtx {
  canEditField: (field: string) => boolean;
  patchRow: (id: string, patch: Partial<WorkshopOrderRow>) => void;
  /**
   * `sourceUrl` = URL gốc Drive/CDN (designsOriginal). Dialog dùng để gọi
   * ensure-preview BE upload preview nếu chưa có.
   */
  openPreview: (url: string, title: string, originalUrl?: string, sourceUrl?: string) => void;
  /** Mở OrderDetailDialog cho đơn (hiện preview file cutting + info). */
  openDetail?: (orderId: string, productionId: string) => void;
  /**
   * i18n `t` (namespace `orders`) — optional để không phá vỡ các trang gọi
   * `c.render(row, ctx)` chưa convert i18n (out-of-batch). Khi có, các chuỗi
   * động bên trong render (hint/badge/toast) dịch theo ngôn ngữ hiện tại;
   * không có thì fallback y hệt text tiếng Việt gốc.
   */
  t?: TFunction<'orders'>;
}

export type WorkshopColMeta = {
  key: string;
  label: string;
  /** Permission code required to view; null = always visible. */
  perm: string | null;
  width?: string;
  render: (row: WorkshopOrderRow, ctx: WorkshopRenderCtx) => React.ReactNode;
};

/**
 * Link label VNP chỉ hiện cho Admin/SuperAdmin — mirror guard BE `shipping-vnp`
 * (`@Auth([SuperAdmin, Admin])`). Đọc thẳng authStore vì render cell không phải
 * hook; role chỉ đổi khi đăng nhập lại nên không cần reactive.
 */
function isAdminViewer(): boolean {
  const role = useAuthStore.getState().profile?.role?.name;
  return role === 'Admin' || role === 'SuperAdmin';
}

/**
 * Cell "Ưu tiên" tách riêng thành component (thay vì render inline như các
 * cột khác) vì chip đếm ngược cần `useNow` tick theo thời gian thực — hook chỉ
 * hợp lệ khi gọi trong 1 component thật, không phải trong hàm `render()` được
 * gọi lại mỗi hàng (số lần gọi hook sẽ đổi theo số dòng → vi phạm Rules of Hooks).
 */
function PriorityCell({ row, ctx }: { row: WorkshopOrderRow; ctx: WorkshopRenderCtx }) {
  const { t } = useTranslation('orders');
  const activeStage = getActiveStageKey(row);
  const stageState = activeStage
    ? (row.fulfillmentStages?.[activeStage] as { waitingAt?: string; startedAt?: string } | undefined)
    : undefined;
  // Đơn chưa chạy bước nào (unassigned, chưa có designerAssignedAt) → tính
  // giờ vào production làm mốc bắt đầu đếm ngược, thay vì bỏ trống estimate.
  const enteredAt =
    activeStage === 'designer'
      ? row.designerStartedAt || row.designerAssignedAt || row.inProductionAt
      : stageState?.startedAt || stageState?.waitingAt;
  const deadline = activeStage ? getStageDeadline(row.priority, activeStage, enteredAt) : undefined;
  const now = useNow(30_000);
  const countdown = deadline ? formatCountdown(deadline, now, t) : undefined;
  return (
    <div className="flex flex-col gap-1 items-start">
      <PrioritySelectCell
        orderId={row._id}
        value={row.priority}
        canEdit={ctx.canEditField('priority')}
        onUpdated={(v) => ctx.patchRow(row._id, { priority: v ?? undefined })}
      />
      {deadline && countdown && (
        <span
          className={cn(
            'text-[10px] inline-flex items-center gap-1 whitespace-nowrap',
            countdown.overdue ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
          )}
        >
          <Clock size={10} /> {countdown.text}
        </span>
      )}
    </div>
  );
}

export const WORKSHOP_COLS: WorkshopColMeta[] = [
  {
    key: 'factoryMachine',
    label: 'Nhà máy / Phòng',
    perm: null,
    width: 'min-w-[180px]',
    render: (r, ctx) => {
      const hasMapping = !!(r.factory?.name || r.machineType?.name);
      if (!hasMapping) {
        return (
          <Hint content={tr(ctx, 'workshopCols.misc.noMappingHint', 'Type của order không match với product config nào — chưa xác định được xưởng/máy')} forceRich>
            <Badge variant="warning" className="cursor-help">
              {tr(ctx, 'workshopCols.misc.noMapping', 'Chưa mapping')}
            </Badge>
          </Hint>
        );
      }
      const codeLabel = tr(ctx, 'workshopCols.misc.codeLabel', 'mã');
      return (
        <div className="flex flex-col gap-1">
          {r.factory?.name && (
            <Hint
              content={`${tr(ctx, 'workshopCols.misc.factoryLabel', 'Nhà máy')}: ${r.factory.name}${r.factory.shortName ? ` (${codeLabel}: ${r.factory.shortName})` : ''}`}
              forceRich
            >
              <Badge variant="success" className="w-fit cursor-help text-[10px] py-0 px-1.5">
                {r.factory.shortName || '?'} · {r.factory.name || '?'}
              </Badge>
            </Hint>
          )}
          {r.machineType?.name && (
            <Hint
              content={`${tr(ctx, 'workshopCols.misc.roomLabel', 'Phòng')}: ${r.machineType.name}${r.machineType.shortName ? ` (${codeLabel}: ${r.machineType.shortName})` : ''}`}
              forceRich
            >
              <Badge variant="secondary" className="w-fit cursor-help text-[10px] py-0 px-1.5">
                {r.machineType.shortName || '?'} · {r.machineType.name || '?'}
              </Badge>
            </Hint>
          )}
        </div>
      );
    },
  },
  {
    key: 'productionId',
    label: 'Production / Order',
    perm: null,
    width: 'min-w-[180px]',
    render: (r, ctx) => {
      const orderTxt = r.orderAt ? formatDate(r.orderAt, 'HH:mm DD/MM/YYYY') : null;
      const prodTxt = r.inProductionAt ? formatDate(r.inProductionAt, 'HH:mm DD/MM/YYYY') : null;
      const hasCuttingFile = !!(r as { cuttingFileUrl?: string }).cuttingFileUrl;
      return (
        <div className="flex flex-col leading-tight gap-0.5">
          <div className="flex items-center gap-1">
            <CopyButton
              value={r.productionId}
              label="Production ID"
              iconSize={15}
              className="p-1 hover:ring-1 hover:ring-primary/40"
            />
            <Hint
              content={
                ctx.openDetail
                  ? tr(ctx, 'workshopCols.misc.clickForDetail', 'Click để xem chi tiết')
                  : `Production ID: ${r.productionId}`
              }
              forceRich
            >
              {ctx.openDetail ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    ctx.openDetail?.(r._id, r.productionId);
                  }}
                  className="font-mono text-[13px] font-semibold text-foreground hover:text-primary hover:underline truncate max-w-[140px] text-left"
                >
                  {r.productionId}
                </button>
              ) : (
                <span className="font-mono text-[13px] font-semibold text-foreground truncate max-w-[140px]">
                  {r.productionId}
                </span>
              )}
            </Hint>
            {hasCuttingFile && (
              <Hint content={tr(ctx, 'workshopCols.misc.cuttingFileMapped', 'Đã map file cutting')} forceRich>
                <span className="text-emerald-600 dark:text-emerald-400 text-[10px]" aria-label="cutting">
                  ✂
                </span>
              </Hint>
            )}
          </div>
          {r.orderId && (
            <div className="flex items-center gap-1">
              <CopyButton value={r.orderId} label="Order ID" iconSize={10} />
              <Hint content={`Order ID: ${r.orderId}`} forceRich>
                <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">{r.orderId}</span>
              </Hint>
            </div>
          )}
          {isAdminViewer() && r.vnpShipment?.labelUrl && !r.vnpShipment.cancelledAt && (
            <div className="flex items-center gap-1">
              <CopyButton value={r.vnpShipment.labelUrl} label="link label" iconSize={10} />
              <Hint
                content={
                  tr(ctx, 'workshopCols.misc.vnpLabel', 'Label VNP — bấm mở tab mới') +
                  (r.vnpShipment.trackingCode ? ` · ${r.vnpShipment.trackingCode}` : '')
                }
                forceRich
              >
                <a
                  href={r.vnpShipment.labelUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] font-medium text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-0.5"
                >
                  🏷️ Label
                </a>
              </Hint>
            </div>
          )}
          {(r.tracking?.labelUrl || r.tracking?.number) && (
            <div className="flex items-center gap-1">
              {r.tracking.number && <CopyButton value={r.tracking.number} label="tracking" iconSize={10} />}
              <Hint
                content={
                  tr(ctx, 'workshopCols.misc.customerTracking', 'Vận đơn khách tự cấp') +
                  (r.tracking.carrier ? ` · ${r.tracking.carrier}` : '') +
                  (r.tracking.number ? ` · ${r.tracking.number}` : '')
                }
                forceRich
              >
                {r.tracking.labelUrl ? (
                  <a
                    href={r.tracking.labelUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:underline inline-flex items-center gap-0.5"
                  >
                    🏷️ {tr(ctx, 'workshopCols.misc.customerLabel', 'Label KH')}
                  </a>
                ) : (
                  <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400 truncate max-w-[140px]">
                    {r.tracking.number}
                  </span>
                )}
              </Hint>
            </div>
          )}
          {r.externalId && (
            <div className="flex items-center gap-1">
              <CopyButton value={r.externalId} label="Platform ID" iconSize={10} />
              <Hint content={`Platform ID (External): ${r.externalId}`} forceRich>
                <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[140px]">
                  ext: {r.externalId}
                </span>
              </Hint>
            </div>
          )}
          {/* {orderTxt && (
            <Hint content={`Khách lên đơn: ${orderTxt}`} forceRich>
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <span className="opacity-60">🛒</span>
                {orderTxt}
              </span>
            </Hint>
          )} */}
          {prodTxt && (
            <Hint content={`In Production At: ${prodTxt}`} forceRich>
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <span className="opacity-60">📅</span>
                {prodTxt}
              </span>
            </Hint>
          )}
        </div>
      );
    },
  },
  {
    key: 'orderStatus',
    label: 'Trạng thái',
    // Suy từ field đã có trên row (không field riêng nào để gắn quyền) — hiện
    // cho MỌI role xem được bảng đơn: ai cũng cần biết đơn đang nằm ở chặng nào.
    perm: null,
    width: 'min-w-[130px]',
    render: (r, ctx) => {
      const st = getOrderStatusInfo(r, makeOrderStatusTranslate(ctx.t));
      return (
        <Hint content={st.tooltip} forceRich>
          <span
            className={cn(
              'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap cursor-help',
              ORDER_STATUS_TONE_CLASS[st.tone],
            )}
          >
            {st.label}
          </span>
        </Hint>
      );
    },
  },
  {
    key: 'priority',
    label: 'Ưu tiên',
    perm: 'order.field.priority.view',
    width: 'min-w-[120px]',
    render: (r, ctx) => <PriorityCell row={r} ctx={ctx} />,
  },
  {
    key: 'mockupTypeSize',
    label: 'Mockup / Type / Size / Color',
    perm: null,
    width: 'min-w-[260px] max-w-[320px]',
    render: (r, ctx) => {
      const url = r.mockupOriginalUrl || r.mockupUrl;
      const sizeColorText = `${r.size || '—'}${r.color ? ' / ' + r.color : ''}`;
      return (
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-1 shrink-0">
            {url && <CopyButton value={url} label="link mockup" iconSize={11} />}
            <ImageThumbCell
              url={r.mockupUrl}
              originalUrl={r.mockupOriginalUrl}
              title={url ? `Mockup: ${url}` : 'Mockup'}
              onOpen={ctx.openPreview}
            />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0 flex-1 leading-tight">
            <Hint content={r.type ? `Type: ${r.type}` : ''} forceRich>
              <span className="text-xs line-clamp-1 break-all text-foreground">{r.type || '—'}</span>
            </Hint>
            {/* Số lượng — công đoạn In quyết định in bao nhiêu bản; thiếu số này
              là in 1 thay vì N. Nhấn mạnh khi > 1. */}
          <span
            className={cn(
              'inline-flex w-fit items-center rounded px-1 py-px text-[10px] font-semibold',
              (r.quantity ?? 1) > 1
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {ctx.t ? ctx.t('workshopCols.qty', { quantity: r.quantity ?? 1 }) : `SL ${r.quantity ?? 1}`}
          </span>
          <Hint content={`Size / Color: ${sizeColorText}`} forceRich>
              <span className="text-[11px] text-muted-foreground line-clamp-1">
                {r.size || '—'}
                {r.color ? <span> / {r.color}</span> : null}
              </span>
            </Hint>
          </div>
        </div>
      );
    },
  },
  // [R2-disabled] tạm ẩn cột Design vì pipeline R2 đang tắt — bật lại
  // bằng cách uncomment block bên dưới (cùng `processDesigns` ở BE).
  // {
  //   key: 'designs',
  //   label: 'Design',
  //   perm: null,
  //   width: 'min-w-[110px]',
  //   render: (r, ctx) => (
  //     <DesignThumbsCell
  //       designs={r.designs}
  //       designsOriginal={r.designsOriginal}
  //       designsStatus={r.designsStatus}
  //       productionId={r.productionId}
  //       openPreview={ctx.openPreview}
  //     />
  //   ),
  // },
  {
    key: 'fabricType',
    label: 'Loại vải',
    perm: 'order.field.fabricType.view',
    width: 'min-w-[130px]',
    render: (r, ctx) => (
      <IconSelectCell
        orderId={r._id}
        field="fabricType"
        category={WorkshopConfigCategory.FabricType}
        value={r.fabricType}
        canEdit={ctx.canEditField('fabricType')}
        onUpdated={(v) => ctx.patchRow(r._id, { fabricType: v ?? undefined })}
      />
    ),
  },
  {
    key: 'machineNumber',
    label: 'Máy',
    perm: 'order.field.machineNumber.view',
    width: 'min-w-[100px]',
    render: (r, ctx) => (
      <ColorBadgeSelectCell
        orderId={r._id}
        field="machineNumber"
        category={WorkshopConfigCategory.Machine}
        value={r.machineNumber}
        canEdit={ctx.canEditField('machineNumber')}
        onUpdated={(v) => ctx.patchRow(r._id, { machineNumber: v ?? undefined })}
      />
    ),
  },
  {
    key: 'printStatus',
    label: 'Trạng thái in',
    perm: 'order.field.printStatus.view',
    width: 'min-w-[140px]',
    render: (r, ctx) => (
      <div className="space-y-1">
        <ColorBadgeSelectCell
          orderId={r._id}
          field="printStatus"
          category={WorkshopConfigCategory.PrintStatus}
          value={r.printStatus}
          canEdit={ctx.canEditField('printStatus')}
          onUpdated={(v) => ctx.patchRow(r._id, { printStatus: v ?? undefined })}
        />
        {/* Lý do bị đẩy về công đoạn In — bảng In là nơi thợ nhận lại đơn. */}
        <ReworkReasonNote
          reason={r.fulfillmentStages?.print?.reworkReason as string | undefined}
          fromStage={r.fulfillmentStages?.print?.reworkFromStage as string | undefined}
        />
      </div>
    ),
  },
  {
    key: 'printStatusNote',
    label: 'Note Trạng thái in',
    perm: 'order.field.printStatusNote.view',
    width: 'min-w-[140px]',
    render: (r, ctx) => (
      <IconSelectCell
        orderId={r._id}
        field="printStatusNote"
        category={WorkshopConfigCategory.PrintStatusNote}
        value={r.printStatusNote}
        canEdit={ctx.canEditField('printStatusNote')}
        onUpdated={(v) => ctx.patchRow(r._id, { printStatusNote: v ?? undefined })}
      />
    ),
  },
  {
    key: 'toolResult',
    label: 'Kết quả Tool',
    perm: 'order.field.toolResult.view',
    width: 'min-w-[130px]',
    render: (r, ctx) => (
      <IconSelectCell
        orderId={r._id}
        field="toolResult"
        category={WorkshopConfigCategory.ToolResult}
        value={r.toolResult}
        canEdit={ctx.canEditField('toolResult')}
        onUpdated={(v) => ctx.patchRow(r._id, { toolResult: v ?? undefined })}
      />
    ),
  },
  {
    key: 'toolResultNote',
    label: 'Note kq Tool 1',
    perm: 'order.field.toolResultNote.view',
    width: 'min-w-[160px]',
    render: (r, ctx) => {
      const showCount = r.toolResultNote === 'error' && (r.productionErrorCount || 0) >= 2;
      return (
        <span className="inline-flex items-center gap-1.5">
          <ColorBadgeSelectCell
            orderId={r._id}
            field="toolResultNote"
            category={WorkshopConfigCategory.ToolResultNote}
            value={r.toolResultNote}
            canEdit={ctx.canEditField('toolResultNote')}
            onUpdated={(v) => ctx.patchRow(r._id, { toolResultNote: v ?? undefined })}
          />
          {showCount && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
              title={tr(
                ctx,
                'workshopCols.misc.factoryReportedErrors',
                `Xưởng đã báo lỗi ${r.productionErrorCount} lần trên đơn này`,
                { count: r.productionErrorCount },
              )}
            >
              ×{r.productionErrorCount}
            </span>
          )}
        </span>
      );
    },
  },
  {
    key: 'errorFile',
    label: 'File sửa lỗi',
    perm: 'order.field.errorFile.view',
    width: 'min-w-[160px]',
    render: (r, ctx) => (
      <MultiIconSelectCell
        orderId={r._id}
        field="errorFile"
        category={WorkshopConfigCategory.ErrorFileType}
        value={r.errorFile}
        canEdit={ctx.canEditField('errorFile')}
        maxVisible={2}
        onUpdated={(v) => ctx.patchRow(r._id, { errorFile: v ?? undefined })}
      />
    ),
  },
  {
    key: 'errorFileNote',
    label: 'Ghi chú file lỗi',
    perm: 'order.field.errorFileNote.view',
    width: 'min-w-[160px]',
    render: (r, ctx) => (
      <TextEditCell
        orderId={r._id}
        field="errorFileNote"
        value={r.errorFileNote}
        canEdit={ctx.canEditField('errorFileNote')}
        onUpdated={(v) => ctx.patchRow(r._id, { errorFileNote: v ?? undefined })}
        tooltipLabel={tr(ctx, 'workshopCols.col.errorFileNote', 'Ghi chú file lỗi')}
      />
    ),
  },
  {
    key: 'productionError',
    label: 'Lỗi xưởng',
    perm: 'order.field.productionError.view',
    width: 'min-w-[140px]',
    render: (r, ctx) => (
      <ProductionErrorSelectCell
        orderId={r._id}
        category={WorkshopConfigCategory.ProductionError}
        value={r.productionError}
        errorSourceValue={r.productionErrorSource}
        errorNoteValue={r.productionErrorNote}
        canEdit={ctx.canEditField('productionError')}
        onUpdated={(code, source, note) =>
          ctx.patchRow(r._id, {
            productionError: code ?? undefined,
            // Bỏ chọn lỗi xưởng → clear luôn loại lỗi (mirror BE order.service.ts:3318).
            ...(!code
              ? { productionErrorSource: undefined }
              : source !== undefined
                ? { productionErrorSource: source }
                : {}),
            ...(note !== undefined ? { productionErrorNote: note } : {}),
          })
        }
      />
    ),
  },
  {
    key: 'productionErrorSource',
    label: 'Loại lỗi',
    perm: 'order.field.productionErrorSource.view',
    width: 'min-w-[110px]',
    render: (r, ctx) => (
      <ErrorSourceCell
        orderId={r._id}
        value={r.productionErrorSource}
        canEdit={ctx.canEditField('productionErrorSource')}
        onUpdated={(v) => ctx.patchRow(r._id, { productionErrorSource: v ?? undefined })}
      />
    ),
  },
  {
    key: 'productionErrorNote',
    label: 'Mô tả lỗi xưởng',
    perm: 'order.field.productionErrorNote.view',
    width: 'min-w-[180px]',
    render: (r, ctx) => (
      <TextEditCell
        orderId={r._id}
        field="productionErrorNote"
        value={r.productionErrorNote}
        canEdit={ctx.canEditField('productionErrorNote')}
        onUpdated={(v) => ctx.patchRow(r._id, { productionErrorNote: v ?? undefined })}
        tooltipLabel={tr(ctx, 'workshopCols.col.productionErrorNote', 'Mô tả lỗi xưởng')}
      />
    ),
  },
  {
    key: 'assignee',
    label: 'Người thực hiện',
    perm: 'order.field.assignee.view',
    width: 'min-w-[140px]',
    render: (r, ctx) => (
      <AssigneeSelectCell
        orderId={r._id}
        value={r.assignee}
        canEdit={ctx.canEditField('assignee')}
        blockedReason={
          r.toolResultNote === 'ok'
            ? tr(ctx, 'workshopCols.misc.blockedAssignReason', "Đơn đã 'ok' (Note kq Tool 1) — không cần gán designer")
            : undefined
        }
        onUpdated={(v) => ctx.patchRow(r._id, { assignee: v ?? undefined })}
      />
    ),
  },
  {
    key: 'designerStatus',
    label: 'TT Designer',
    perm: 'order.field.designerStatus.view',
    width: 'min-w-[110px]',
    render: (r, ctx) => {
      const status = (r.designerStatus as DesignerStatus) || DesignerStatus.Unassigned;
      const meta = (ctx.t ? buildDesignerStatusMeta(ctx.t) : DESIGNER_STATUS_META_FALLBACK)[status];
      const rework = r.designerReworkCount && r.designerReworkCount > 0 ? ` · ${r.designerReworkCount}×` : '';
      return (
        <Hint content={meta.tooltip} forceRich>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${meta.cls} cursor-help`}
          >
            {meta.label}
            {rework}
          </span>
        </Hint>
      );
    },
  },
  {
    key: 'assigneeNote',
    label: 'Note người thực hiện',
    perm: 'order.field.assigneeNote.view',
    width: 'min-w-[140px]',
    render: (r, ctx) => (
      <IconSelectCell
        orderId={r._id}
        field="assigneeNote"
        category={WorkshopConfigCategory.AssigneeNote}
        value={r.assigneeNote}
        canEdit={ctx.canEditField('assigneeNote')}
        onUpdated={(v) => ctx.patchRow(r._id, { assigneeNote: v ?? undefined })}
      />
    ),
  },
  {
    key: 'userSku',
    label: 'User SKU',
    perm: null,
    width: 'min-w-[120px]',
    render: (r) =>
      r.userSku ? (
        <div className="flex items-center gap-1">
          <CopyButton value={r.userSku} label="User SKU" iconSize={11} />
          <Hint content={`User SKU: ${r.userSku}`} forceRich>
            <span className="text-xs truncate max-w-[140px]">{r.userSku}</span>
          </Hint>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  {
    key: 'typeFullName',
    label: 'Type.1',
    perm: null,
    width: 'min-w-[140px] max-w-[220px]',
    render: (r) => (
      <Hint content={r.productConfig?.fullName ? `Type.1: ${r.productConfig.fullName}` : ''} forceRich>
        <span className="text-xs line-clamp-1 break-all">{r.productConfig?.fullName || '—'}</span>
      </Hint>
    ),
  },
];

// ─── Compact grouped columns (dùng chung: OrderTableWorkshop, OrdersMiniTable,
// OrderFactoryTab) ───────────────────────────────────────────────────────────
// `WORKSHOP_COLS` gốc có ~20 cột riêng lẻ → bảng đơn scroll ngang rất sâu. Gom
// các field liên quan theo chủ đề nghiệp vụ thành ít group hơn — mỗi group là
// 1 cột bảng nhưng bên trong xếp field CHIỀU DỌC (nhiều dòng) thay vì mỗi
// field 1 cột ngang. Field không có cột riêng nữa → thêm label ngắn phía
// trước (xem FIELD_LABELS). Field "headline" của group (đã tự mô tả qua icon/
// ảnh/badge tên) thì bỏ qua label — xem HEADLINE_KEYS.
export type ColGroupKey =
  | 'identity'
  | 'product'
  | 'factory'
  | 'print'
  | 'toolCheck'
  | 'productionError'
  | 'assignee';

export interface ColGroupDef {
  key: ColGroupKey;
  title: string;
  width: number;
  memberKeys: string[];
}

/** Group đã resolve members (member key nào bị ẩn theo quyền thì loại sẵn). */
export type ResolvedColGroup = ColGroupDef & { members: WorkshopColMeta[] };

export const BASE_GROUP_DEFS: ColGroupDef[] = [
  {
    key: 'identity',
    title: 'Mã đơn / Ưu tiên',
    width: 230,
    memberKeys: ['productionId', 'orderStatus', 'priority', 'userSku', 'typeFullName'],
  },
  { key: 'product', title: 'Sản phẩm', width: 300, memberKeys: ['mockupTypeSize'] },
  {
    key: 'toolCheck',
    title: 'Kết quả Tool / File lỗi',
    width: 270,
    memberKeys: ['toolResult', 'toolResultNote', 'errorFile', 'errorFileNote'],
  },
  { key: 'factory', title: 'Xưởng · Vải · Máy', width: 190, memberKeys: ['factoryMachine', 'fabricType', 'machineNumber'] },
  { key: 'print', title: 'Trạng thái in', width: 150, memberKeys: ['printStatus', 'printStatusNote'] },
  {
    key: 'productionError',
    title: 'Lỗi xưởng',
    width: 210,
    memberKeys: ['productionError', 'productionErrorSource', 'productionErrorNote'],
  },
  { key: 'assignee', title: 'Người thực hiện', width: 190, memberKeys: ['assignee', 'assigneeNote', 'designerStatus'] },
];

// Support role: soát tool → in, nên muốn thấy "Kết quả Tool" + "File sửa lỗi"
// TRƯỚC "Trạng thái in" (mirror thứ tự nghiệp vụ cũ theo field lẻ).
export const SUPPORT_GROUP_ORDER: ColGroupKey[] = [
  'identity',
  'product',
  'toolCheck',
  'factory',
  'print',
  'productionError',
  'assignee',
];

// Field đã tự mô tả qua icon/ảnh/badge tên riêng → không cần thêm label.
export const HEADLINE_KEYS = new Set(['productionId', 'mockupTypeSize', 'factoryMachine']);

// Label ngắn cho field KHÔNG còn cột riêng — hiển thị trước value trong group.
export const FIELD_LABELS: Record<string, string> = {
  orderStatus: 'Trạng thái',
  priority: 'Ưu tiên',
  userSku: 'SKU',
  typeFullName: 'Loại SP',
  fabricType: 'Vải',
  machineNumber: 'Máy',
  printStatus: 'Trạng thái',
  printStatusNote: 'Note',
  toolResult: 'Kết quả',
  toolResultNote: 'Note',
  errorFile: 'File lỗi',
  errorFileNote: 'Ghi chú',
  productionError: 'Lỗi xưởng',
  productionErrorSource: 'Loại lỗi',
  productionErrorNote: 'Mô tả',
  assignee: 'Người TH',
  assigneeNote: 'Note',
  designerStatus: 'TT Designer',
};

/**
 * Build group đã resolve từ danh sách cột ĐÃ LỌC QUYỀN (`visibleCols` — member
 * key nào không có trong đây bị loại khỏi group; group rỗng hết member thì bỏ
 * hẳn). `roleName === 'Support'` đổi thứ tự group theo `SUPPORT_GROUP_ORDER`.
 */
export function buildColGroups(visibleCols: WorkshopColMeta[], roleName?: string | null): ResolvedColGroup[] {
  const defs =
    roleName === 'Support' ? SUPPORT_GROUP_ORDER.map((k) => BASE_GROUP_DEFS.find((g) => g.key === k)!) : BASE_GROUP_DEFS;
  const byKey = new Map(visibleCols.map((c) => [c.key, c]));
  return defs
    .map((g) => ({ ...g, members: g.memberKeys.map((k) => byKey.get(k)).filter((c): c is WorkshopColMeta => !!c) }))
    .filter((g) => g.members.length > 0);
}

/**
 * Nội dung 1 group cell — field xếp CHIỀU DỌC, mỗi field không thuộc
 * `HEADLINE_KEYS` có label ngắn phía trước. `renderedByKey` = map key→ReactNode
 * đã render sẵn (caller tự gọi `c.render(row, ctx)` theo field cần, thường
 * memo theo [row, ctx] để tránh re-render lãng phí). `extra` cho phép chèn
 * thêm node cạnh 1 member cụ thể (vd Badge "×N" cạnh `mockupTypeSize`).
 */
export function GroupCellContent({
  group,
  renderedByKey,
  extra,
  singleLineValues,
}: {
  group: ResolvedColGroup;
  renderedByKey: Map<string, React.ReactNode>;
  extra?: (memberKey: string) => React.ReactNode;
  /** true → ép value text 1 dòng (đè `line-clamp-2` của TextEditCell) — bảng In cần mỗi mục cao đúng 1 dòng. */
  singleLineValues?: boolean;
}) {
  const { t } = useTranslation('orders');
  return (
    <div className="flex flex-col gap-1">
      {group.members.map((c) => (
        <div key={c.key} className="flex items-center gap-1.5 min-w-0">
          {!HEADLINE_KEYS.has(c.key) && (
            // Bề rộng CỐ ĐỊNH đủ chứa nhãn dài nhất ("TT Designer") + nowrap:
            // nhãn luôn 1 dòng VÀ mọi value bên phải bắt đầu cùng 1 mốc x
            // → các mục trong ô gộp thẳng hàng dọc.
            <span className="w-[68px] shrink-0 whitespace-nowrap text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t(`workshopCols.short.${c.key}`, { defaultValue: FIELD_LABELS[c.key] || c.label })}
            </span>
          )}
          <div
            className={cn(
              'min-w-0 flex-1 flex items-center gap-1',
              singleLineValues && '[&_.line-clamp-2]:line-clamp-1',
            )}
          >
            {renderedByKey.get(c.key)}
            {extra?.(c.key)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Cột riêng cho tài khoản In (PrintOrderTable) ───────────────────────────
// Khác WORKSHOP_COLS 2 điểm:
//  1. "Loại vải" gộp vào cột Mockup/Type/Size/Color — giá trị nằm DƯỚI Size.
//  2. 3 cột Lỗi xưởng / Loại lỗi / Mô tả lỗi xưởng dời lên NGAY SAU Note Trạng thái in.
const printMockupCol: WorkshopColMeta = {
  key: 'mockupTypeSize',
  label: 'Mockup / Type / Size / Color / Vải',
  perm: null,
  width: 'min-w-[260px] max-w-[320px]',
  render: (r, ctx) => {
    const url = r.mockupOriginalUrl || r.mockupUrl;
    return (
      <div className="flex items-start gap-2">
        <div className="flex items-center gap-1 shrink-0">
          {url && <CopyButton value={url} label="link mockup" iconSize={11} />}
          <ImageThumbCell
            url={r.mockupUrl}
            originalUrl={r.mockupOriginalUrl}
            title={url ? `Mockup: ${url}` : 'Mockup'}
            onOpen={ctx.openPreview}
          />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0 flex-1 leading-tight">
          <Hint content={r.type ? `Type: ${r.type}` : ''} forceRich>
            <span className="text-xs line-clamp-1 break-all text-foreground">{r.type || '—'}</span>
          </Hint>
          {/* Số lượng — công đoạn In quyết định in bao nhiêu bản; thiếu số này
              là in 1 thay vì N. Nhấn mạnh khi > 1. */}
          <span
            className={cn(
              'inline-flex w-fit items-center rounded px-1 py-px text-[10px] font-semibold',
              (r.quantity ?? 1) > 1
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {ctx.t ? ctx.t('workshopCols.qty', { quantity: r.quantity ?? 1 }) : `SL ${r.quantity ?? 1}`}
          </span>
          <Hint content={`Size / Color: ${r.size || '—'}${r.color ? ' / ' + r.color : ''}`} forceRich>
            <span className="text-[11px] text-muted-foreground line-clamp-1">
              {r.size || '—'}
              {r.color ? <span> / {r.color}</span> : null}
            </span>
          </Hint>
          {/* Loại vải — gộp vào đây, nằm dưới Size (cho tài khoản In). */}
          <IconSelectCell
            orderId={r._id}
            field="fabricType"
            category={WorkshopConfigCategory.FabricType}
            value={r.fabricType}
            canEdit={ctx.canEditField('fabricType')}
            onUpdated={(v) => ctx.patchRow(r._id, { fabricType: v ?? undefined })}
          />
        </div>
      </div>
    );
  },
};

export const PRINT_COLS: WorkshopColMeta[] = (() => {
  // Thứ tự dời lên NGAY SAU "Note Trạng thái in": Note kq Tool 1 → 3 cột lỗi xưởng.
  const MOVED_KEYS = ['toolResultNote', 'productionError', 'productionErrorSource', 'productionErrorNote'];
  const movedCols = MOVED_KEYS.map((k) => WORKSHOP_COLS.find((c) => c.key === k)!);
  // Note Trạng thái in — thu hẹp + rút gọn label (header `whitespace-nowrap` nên
  // label dài mới là thứ ép cột rộng) để đỡ tốn diện tích. Chỉ trong PRINT_COLS.
  const narrowPrintStatusNote: WorkshopColMeta = {
    ...WORKSHOP_COLS.find((c) => c.key === 'printStatusNote')!,
    label: 'Note TT in',
    width: 'min-w-[80px] max-w-[120px]',
  };
  // Cột Production/Order + badge "Đang giữ": bảng In là danh sách việc của thợ,
  // trước đây không có dấu hiệu nào cho biết đơn bị giữ (chỉ menu "..." đổi mục).
  const baseProductionIdCol = WORKSHOP_COLS.find((c) => c.key === 'productionId')!;
  const heldAwareProductionIdCol: WorkshopColMeta = {
    ...baseProductionIdCol,
    render: (r, ctx) => (
      <div className="flex flex-col gap-0.5">
        {baseProductionIdCol.render(r, ctx)}
        {r.heldAt && !r.cancelledAt && <HeldBadge reason={r.holdReason} source={r.holdSource} />}
        {showOnospodHoldFlag(r) && <OnospodHoldBadge />}
      </div>
    ),
  };
  const result: WorkshopColMeta[] = [];
  for (const col of WORKSHOP_COLS) {
    if (col.key === 'fabricType') continue; // đã gộp vào cột mockup
    if (MOVED_KEYS.includes(col.key)) continue; // dời lên sau printStatusNote
    if (col.key === 'mockupTypeSize') {
      result.push(printMockupCol);
      continue;
    }
    if (col.key === 'productionId') {
      result.push(heldAwareProductionIdCol);
      continue;
    }
    if (col.key === 'printStatusNote') {
      result.push(narrowPrintStatusNote);
      result.push(...movedCols);
      continue;
    }
    result.push(col);
  }
  return result;
})();

/**
 * Gộp cột hiển thị CHỈ cho bảng In (PrintOrderTable): mỗi group là 1 cột bảng,
 * các field bên trong xếp CHIỀU DỌC kèm label ngắn từng mục (render qua
 * `GroupCellContent` — nhãn lấy từ `workshopCols.short.*` / FIELD_LABELS).
 * Cột khác của PRINT_COLS vẫn đứng riêng; group xuất hiện tại vị trí member
 * đầu tiên còn hiển thị theo quyền.
 */
export const PRINT_MERGE_GROUP_DEFS: ColGroupDef[] = [
  {
    key: 'print',
    title: 'Máy · Trạng thái in · Note',
    width: 190,
    memberKeys: ['machineNumber', 'printStatus', 'printStatusNote'],
  },
  {
    key: 'productionError',
    title: 'Lỗi xưởng · Loại · Mô tả',
    width: 230,
    memberKeys: ['productionError', 'productionErrorSource', 'productionErrorNote'],
  },
];
