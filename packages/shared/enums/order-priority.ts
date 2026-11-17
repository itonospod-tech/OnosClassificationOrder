/**
 * 4 mức ưu tiên đơn hàng. Giá trị số càng cao = càng ưu tiên — dùng trực tiếp
 * làm sort key (`{ priority: -1 }`) ở mọi danh sách đơn.
 *
 * `Urgent` (4 — "Làm ngay") là mức CHỈ HỆ THỐNG đặt: ghi thẳng DB (bot vận hành),
 * KHÔNG ai đặt/sửa được qua web hay API (`updateField`/`bulkUpdateField` chặn cả
 * đặt lên 4 lẫn sửa đơn đang ở 4; cấu hình ưu tiên theo khách không có cột 4).
 * Mục đích: giữ mức này hiếm để không bị dồn như mức 3. Xem Orders.md §17.
 */
export enum OrderPriority {
  Low = 1,
  Normal = 2,
  High = 3,
  Urgent = 4,
}

/** Mọi mức hợp lệ trong DB (hiển thị, lọc, schema, estimate). */
export const ORDER_PRIORITIES: OrderPriority[] = [
  OrderPriority.Low,
  OrderPriority.Normal,
  OrderPriority.High,
  OrderPriority.Urgent,
];

/** Các mức người dùng được chọn qua web/API — KHÔNG có `Urgent`. */
export const ORDER_PRIORITIES_SETTABLE: OrderPriority[] = [
  OrderPriority.Low,
  OrderPriority.Normal,
  OrderPriority.High,
];

/** Mức chỉ hệ thống đặt được (ghi thẳng DB) — web/API không đặt cũng không sửa. */
export const isSystemOnlyPriority = (p: unknown): boolean => Number(p) === OrderPriority.Urgent;

export const ORDER_PRIORITY_LABELS: Record<OrderPriority, string> = {
  [OrderPriority.Low]: 'Ưu tiên',
  [OrderPriority.Normal]: 'Ưu tiên cao',
  [OrderPriority.High]: 'Ưu tiên nhất',
  [OrderPriority.Urgent]: 'Làm ngay',
};
