import { OrderPriority, RoleType } from 'shared';

/** Phạm vi người xem cho trang "Đơn Làm ngay" (Orders.md §17.6). */
export interface UrgentOpenOrdersScope {
  roleName?: RoleType | string;
  /** = user.factoryId — chỉ dùng cho Fulfillment (khóa xưởng). */
  fulfillmentFactoryId?: string;
  /** Xưởng chọn trên header (`?factoryId=`). */
  factoryId?: string;
}

/**
 * Filter đơn mức 4 "Làm ngay" CHƯA XONG — dùng chung cho trang `GET /orders/urgent` và badge
 * sidebar (`urgentOpen`) để 2 con số luôn khớp.
 *
 * "Chưa xong" = chưa đóng hàng (`fulfillmentCompletedAt` thiếu/null — đúng phần bù của chặng
 * `done`, như `workshopStage=__open__`) + loại đơn hủy/đã xóa. Đơn đang giữ VẪN tính (còn phải
 * làm, card tự hiện badge giữ).
 *
 * Phạm vi: mọi role thấy đơn ở MỌI công đoạn (chỉ đọc; thao tác do BE từng endpoint tự chặn).
 * Fulfillment khóa vào xưởng của mình — xưởng chọn trên header chỉ được THU HẸP (AND), giống
 * `applyExplicitFactory`. Role khác: xưởng chọn tường minh THAY điều kiện xưởng mặc định
 * (`defaultFactoryClause` — thường là `productionFactoryClause`, loại đơn chưa map + xưởng US).
 */
export function buildUrgentOpenOrdersFilter(
  scope: UrgentOpenOrdersScope,
  defaultFactoryClause: Record<string, unknown>,
  /** Trang thêm đơn đóng hàng xong từ mốc này (ô "Đã xong tuần này"); badge không truyền. */
  completedSince?: Date,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    priority: OrderPriority.Urgent,
    deletedAt: { $exists: false },
    cancelledAt: { $exists: false },
    // `$not: {$lt}` khớp cả field thiếu/null (đơn chưa xong) lẫn mốc ≥ `completedSince`.
    fulfillmentCompletedAt: completedSince ? { $not: { $lt: completedSince } } : { $in: [null] },
  };
  if (scope.roleName === RoleType.Fulfillment) {
    filter.factoryId = scope.fulfillmentFactoryId || '__no_factory__';
    if (scope.factoryId && scope.factoryId !== filter.factoryId) filter.$and = [{ factoryId: scope.factoryId }];
  } else {
    filter.factoryId = scope.factoryId || defaultFactoryClause;
  }
  return filter;
}
