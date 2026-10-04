/**
 * Trạng thái đơn KHÁCH HÀNG (Customer Portal) — mirror mô hình OnosPod cũ,
 * xem `documents/Plans/CustomerOrderIntake-CSV-API.md` §1.
 *
 * KHÔNG phải trạng thái sản xuất nội bộ: chỉ `pending`/`cancelled` được LƯU
 * trên staging `customer_orders`; các trạng thái còn lại DERIVE at read-time
 * từ `OrderEntity` của từng item đã push (In Production = pushed, not yet
 * fulfilled, whatever the stage; Fulfilled = đóng hàng xong, Completed =
 * Fulfilled + N ngày config). Processing is never derived: push is atomic, the
 * step stays empty for a future pay-before-production gate (LegacyClone-Orders.md
 * §7). Hold + Rework là badge chồng (orthogonal), KHÔNG phải trạng thái.
 */
export enum CustomerOrderStatus {
  Pending = 'pending',
  Processing = 'processing',
  InProduction = 'in-production',
  Fulfilled = 'fulfilled',
  Completed = 'completed',
  Refunded = 'refunded',
  Cancelled = 'cancelled',
}

export const CUSTOMER_ORDER_STATUSES = Object.values(CustomerOrderStatus);

/** Nhãn tiếng Việt dùng phía BE (thông báo/log) — FE dùng i18n riêng. */
export const CUSTOMER_ORDER_STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  [CustomerOrderStatus.Pending]: 'Chờ đẩy sản xuất',
  [CustomerOrderStatus.Processing]: 'Đang xử lý',
  [CustomerOrderStatus.InProduction]: 'Đang sản xuất',
  [CustomerOrderStatus.Fulfilled]: 'Đã xuất kho',
  [CustomerOrderStatus.Completed]: 'Hoàn tất',
  [CustomerOrderStatus.Refunded]: 'Đã hoàn tiền',
  [CustomerOrderStatus.Cancelled]: 'Đã hủy',
};

/**
 * Thứ tự "tiến độ" của chuỗi tuyến tính — dùng lấy trạng thái mức ĐƠN =
 * item CHẬM NHẤT (least-advanced) khi 1 đơn có nhiều item đã push.
 * `refunded`/`cancelled` nằm ngoài chuỗi (xử lý riêng trước khi so tiến độ).
 */
export const CUSTOMER_ORDER_STATUS_PROGRESS: Partial<Record<CustomerOrderStatus, number>> = {
  [CustomerOrderStatus.Pending]: 0,
  [CustomerOrderStatus.Processing]: 1,
  [CustomerOrderStatus.InProduction]: 2,
  [CustomerOrderStatus.Fulfilled]: 3,
  [CustomerOrderStatus.Completed]: 4,
};
