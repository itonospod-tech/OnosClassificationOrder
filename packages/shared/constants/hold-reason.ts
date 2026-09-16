/**
 * Lý do giữ đơn "chờ khách cập nhật" — giá trị chính xác được set khi giữ đơn
 * (`HoldOrderDialog.tsx`/`BulkEditToolbar.tsx`) và match CHÍNH XÁC (không phải
 * substring) bởi cron tự động lấy ngược design/địa chỉ ship từ OnosPod
 * (`OrderService.getHeldOrdersForRecovery`). Đổi text ở đây là đổi luôn cả 2
 * chỗ — KHÔNG sửa lẻ ở FE.
 */
export const HOLD_REASON_WAITING_DESIGN = 'Đợi khách sửa design';
export const HOLD_REASON_WAITING_ADDRESS = 'Đợi khách sửa địa chỉ';

/**
 * Lý do giữ do HỆ THỐNG đặt khi đồng bộ trạng thái "On Hold" từ OnosPod
 * (`OnospodHoldSyncService`, Orders.md §9d). KHÔNG nằm trong preset chip của FE
 * — nhân viên không tự chọn lý do này. OnosPod không cung cấp lý do giữ gốc.
 */
export const HOLD_REASON_ONOSPOD = 'Giữ theo OnosPod';

/**
 * Nguồn của lượt giữ đơn hiện tại (`OrderEntity.holdSource`).
 * - `manual`: nhân viên bấm giữ (`holdOrder`/`bulkSetHold`). Đơn giữ cũ KHÔNG
 *   có trường này cũng coi là `manual`.
 * - `onospod`: đồng bộ tự giữ theo OnosPod — CHỈ loại này được đồng bộ tự nhả.
 */
export const HoldSource = {
  Manual: 'manual',
  Onospod: 'onospod',
} as const;
export type HoldSource = (typeof HoldSource)[keyof typeof HoldSource];
export const HOLD_SOURCES = [HoldSource.Manual, HoldSource.Onospod] as const;
