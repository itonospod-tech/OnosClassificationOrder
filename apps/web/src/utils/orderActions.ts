import type { TFunction } from 'i18next';

/**
 * Đơn tối thiểu cần để quyết định quyền hủy. Khớp `WorkshopOrderRow` (+ mọi row
 * order khác) — chỉ đọc các field liên quan.
 */
export type CancellableOrder = {
  cancelledAt?: string | Date | null;
  designerStatus?: string;
  currentFulfillmentStage?: string | null;
  fulfillmentStages?: Record<string, { status?: string } | undefined>;
};

/** True nếu đơn đã bị hủy (soft). */
export const isCancelled = (o: { cancelledAt?: string | Date | null }): boolean => !!o.cancelledAt;

/** True nếu đơn đang bị GIỮ (hold) — tạm dừng mọi thao tác tới khi mở lại. */
export const isHeld = (o: { heldAt?: string | Date | null }): boolean => !!o.heldAt;

/** Hiện nhãn "OnosPod đang giữ" — cờ `onospodHold` có mà đơn bên mình KHÔNG giữ (Orders.md §9d). */
export const showOnospodHoldFlag = (o: { heldAt?: string | Date | null; onospodHold?: unknown }): boolean =>
  !o.heldAt && !!o.onospodHold;

/**
 * Role được phép giữ / mở giữ đơn — MIRROR `ORDER_WRITE_ROLES` ở
 * `apps/api/src/modules/order/order.controller.ts`. FE chỉ hiện nút cho các role
 * này; BE vẫn enforce lại (`@Auth(ORDER_WRITE_ROLES)`).
 */
export const HOLD_ALLOWED_ROLES = [
  'SuperAdmin',
  'Admin',
  'Manager',
  'Support',
  'DesignerLeader',
  'Fulfillment',
];

export const canUserHold = (roleName?: string): boolean =>
  !!roleName && HOLD_ALLOWED_ROLES.includes(roleName);

/**
 * "Chuyển hoàn thành" (Orders.md §23) — CHỈ SuperAdmin. Đây là cửa sửa dữ liệu
 * (ép đơn về đã hoàn thành sản xuất + điền mốc cho các khâu chưa xong), không
 * phải một bước của quy trình, nên cố ý hẹp hơn cả Admin.
 * MIRROR `@Auth([RoleType.SuperAdmin])` + `forceCompleteOrder()` ở BE.
 */
export const canForceComplete = (roleName?: string): boolean => roleName === 'SuperAdmin';

/** Đơn có chuyển hoàn thành được không — MIRROR guard ở `OrderService.forceCompleteOrder`. */
export function canForceCompleteOrder(
  o: { cancelledAt?: string | Date | null; heldAt?: string | Date | null; fulfillmentCompletedAt?: string | Date | null },
  t?: TFunction<'orders'>,
): { ok: boolean; reason?: string } {
  if (o.cancelledAt) return { ok: false, reason: t ? t('orderActions.alreadyCancelled') : 'Đơn đã hủy.' };
  if (o.heldAt) return { ok: false, reason: t ? t('orderActions.heldFirst') : 'Đơn đang bị giữ — mở giữ trước.' };
  if (o.fulfillmentCompletedAt) {
    return { ok: false, reason: t ? t('orderActions.alreadyCompleted') : 'Đơn đã hoàn thành sản xuất.' };
  }
  return { ok: true };
}

/**
 * Đơn có được HỦY không — MIRROR `OrderService.canCancelOrder` ở
 * `apps/api/src/modules/order/order.service.ts`. Sửa 1 nơi phải sửa cả 2.
 *
 * Admin được hủy đơn ở **BẤT KỲ trạng thái nào** (đã in/ép/may/rework…) — chỉ
 * chặn đơn ĐÃ hủy sẵn (không hủy 2 lần). Action đã Admin-only ở BE.
 */
export function canCancelOrder(o: CancellableOrder, t?: TFunction<'orders'>): { ok: boolean; reason?: string } {
  if (o.cancelledAt) return { ok: false, reason: t ? t('orderActions.alreadyCancelled') : 'Đơn đã hủy.' };
  return { ok: true };
}
