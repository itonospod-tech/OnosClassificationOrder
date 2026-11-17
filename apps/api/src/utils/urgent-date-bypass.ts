import { OrderPriority } from 'shared';

/**
 * Cột đang có việc của kanban (designer: đã giao/đang làm/cần làm lại; fulfillment: chờ/đang
 * làm/cần làm lại/giữ): đơn mức 4 "Làm ngay" hiện BẤT KỂ lọc ngày vào sản xuất — đơn tồn lâu
 * nhất lại là đơn cần làm nhất (Orders.md §17.5). Chỉ mức 4: mức 3 còn hàng trăm đơn cũ tháng
 * 8–9 (DTF Mê Linh), mở cho mức 3 sẽ ghim cả đống đó lên đầu cột.
 */
export function withUrgentDateBypass<F extends { inProductionAt?: unknown; $and?: unknown[] }>(filter: F): F {
  const { inProductionAt, ...rest } = filter;
  if (!inProductionAt) return filter;
  return {
    ...rest,
    $and: [...(rest.$and ?? []), { $or: [{ inProductionAt }, { priority: OrderPriority.Urgent }] }],
  } as unknown as F;
}
