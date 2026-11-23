/**
 * Luật quét mã tại trạm cho đơn ĐÃ HỦY / ĐANG GIỮ — hàm thuần dùng chung 2 nơi quét của
 * `apps/web` (Task Fulfillment `pages/fulfillment/my-tasks/index.tsx` + trang Quét mã
 * `pages/orders/scan-error/FulfillmentScanActionDialog.tsx`). apps/web không có test runner
 * nên luật được ghim bằng spec ở `apps/api/src/modules/fulfillment/scan-guard.spec.ts`.
 *
 * Bối cảnh: đơn bị hủy SAU khi đã in (vd khách hủy lúc đang chờ Ép) biến mất khỏi kanban
 * nhưng hàng vật lý vẫn ở xưởng — quét trúng phải báo to "đơn đã hủy, bỏ ra", không mở
 * thao tác. Server vốn đã chặn transition đơn hủy (`fulfillment-task.service.ts`).
 */

type ScanGuardOrder = { cancelledAt?: string | Date | null; heldAt?: string | Date | null };

export const isOrderCancelled = (o: ScanGuardOrder | null | undefined): boolean => !!o?.cancelledAt;

/**
 * Kết quả tra mã ở ô TÌM/QUÉT của Task Fulfillment:
 * - `action`: mở dialog thao tác (Hoàn thành / Báo lỗi) như cũ.
 * - `detail`: chế độ chỉ xem (Admin/Manager) → mở chi tiết đơn như cũ.
 * - `cancelled-blocked`: công nhân quét đơn hủy → chỉ cảnh báo, KHÔNG mở thao tác.
 * - `cancelled-detail`: chỉ xem + đơn hủy → cảnh báo VÀ vẫn mở chi tiết đơn.
 */
export type ScanLookupOutcome = 'action' | 'detail' | 'cancelled-blocked' | 'cancelled-detail';

export function resolveScanLookupOutcome(order: ScanGuardOrder, opts: { viewOnly: boolean }): ScanLookupOutcome {
  const cancelled = isOrderCancelled(order);
  if (opts.viewOnly) return cancelled ? 'cancelled-detail' : 'detail';
  return cancelled ? 'cancelled-blocked' : 'action';
}

/**
 * Lý do khoá MỌI thao tác trong popup quét công đoạn (hoàn thành, báo lỗi, in tem/label,
 * trừ kho). Hủy đứng trước giữ: đơn hủy thì không bao giờ làm tiếp, kể cả khi đang giữ.
 */
export type ScanActionLock = 'cancelled' | 'held' | null;

export function scanActionLock(order: ScanGuardOrder): ScanActionLock {
  if (isOrderCancelled(order)) return 'cancelled';
  if (order.heldAt) return 'held';
  return null;
}
