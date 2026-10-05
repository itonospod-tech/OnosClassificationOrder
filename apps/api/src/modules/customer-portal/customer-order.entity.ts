import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type {
  CustomerOrderPriceSnapshot,
  CustomerOrderSource,
  CustomerOrderTracking,
  CustomerShipMethod,
  DesignFields,
  ProductionOrderShippingAddress,
} from 'shared';
import type { ProductLine } from 'shared';
import { CUSTOMER_ORDER_SOURCES } from 'shared';

import type { CustomerDocument } from '@/modules/customer/customer.entity';

/**
 * 1 item trong staging đơn khách = 1 dòng CSV template cũ / 1 sản phẩm form.
 * Lưu dạng subdocument thô (`type: Object`) — cùng pattern `fulfillmentStages`
 * của OrderEntity. Push xong mỗi item link sang 1 `OrderEntity` qua
 * `productionId`.
 */
export interface CustomerOrderItem {
  /** SKU variation (CSV bắt buộc, form có thể trống — plan §13.1). */
  sku?: string;
  merchantSku?: string;
  /** Resolve từ SKU lúc import — nguồn chân lý cho type/size/color. */
  productConfigId?: string;
  type?: string;
  color?: string;
  size?: string;
  quantity: number;
  shipMethod?: CustomerShipMethod;
  activeService?: boolean;
  mockupUrl?: string;
  printMethod?: string;
  /** PRD-8 — dòng sản phẩm, stamp từ ProductConfig lúc tạo/import (đơn cũ derive từ OrderEntity). */
  productLine?: ProductLine;
  weight?: number;
  width?: number;
  height?: number;
  length?: number;
  designs?: DesignFields;
  /**
   * Tracking/label khách tự cấp. Từ ORD-26 KHÔNG còn dừng ở mức lưu-hiển-thị:
   * `pushToProduction` đẩy nguyên field này vào `importOrders` → snapshot lên
   * `OrderEntity.tracking` + record `shipments` (provider `customer`).
   */
  tracking?: CustomerOrderTracking;
  /** Tính tham khảo lúc tạo, CHỐT LẠI + đóng băng lúc push. */
  priceSnapshot?: CustomerOrderPriceSnapshot;
  /**
   * Cấp NGAY lúc tạo/import (`XX-#####-#####`, unique cả `orders` lẫn staging)
   * — mã đi xuyên suốt portal → xưởng; push GIỮ NGUYÊN mã này làm
   * `OrderEntity.productionId`.
   */
  productionId?: string;
}

/**
 * Staging đơn khách hàng — 1 document = 1 ĐƠN (nhiều item + 1 địa chỉ chung).
 * Đơn Pending KHÔNG BAO GIỜ là `OrderEntity` → pipeline sản xuất + thống kê
 * nội bộ không thấy đơn này. Sau push, trạng thái derive at read-time từ
 * `OrderEntity` theo `items[].productionId` — KHÔNG dual-write.
 * Xem `documents/Plans/CustomerOrderIntake-CSV-API.md` §2.
 */
@DatabaseEntity({ collection: 'customer_orders' })
export class CustomerOrderEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, ref: 'CustomerEntity', index: true })
  customerId: string;

  // Denorm match keys từ customer — dùng backfill/đối chiếu, KHÔNG dùng auth.
  @Prop({ trim: true, default: '' })
  userSku: string;

  @Prop({ trim: true, default: '' })
  userEmail: string;

  /** Idempotency mức ĐƠN — `customerOrderKey(orderId, identifier)` (shared). */
  @Prop({ required: true, trim: true })
  orderKey: string;

  /** Giá trị khách điền — giữ nguyên văn để hiển thị listing. */
  @Prop({ trim: true })
  orderId?: string;

  @Prop({ trim: true })
  identifier?: string;

  @Prop({ trim: true })
  orderName?: string;

  @Prop({ type: String, enum: CUSTOMER_ORDER_SOURCES, default: 'form' })
  source: CustomerOrderSource;

  /**
   * CHỈ trạng thái TRƯỚC push (`pending`/`cancelled`) — sau push trạng thái
   * khách (processing/in-production/...) derive từ OrderEntity, không lưu ở đây.
   */
  @Prop({ type: String, enum: ['pending', 'cancelled'], default: 'pending', index: true })
  status: 'pending' | 'cancelled';

  /** 1 địa chỉ CHUNG cho cả đơn (đã gồm email/company của template cũ). */
  @Prop({ type: Object })
  shippingAddress?: ProductionOrderShippingAddress;

  @Prop({ type: [Object], default: [] })
  items: CustomerOrderItem[];

  @Prop({ trim: true })
  note?: string;

  /** Set lúc push nguyên đơn — backfill Luồng A set = createdAt đơn cũ. */
  @Prop({ type: Date, default: null, index: true })
  pushedAt?: Date | null;

  /**
   * Chỗ giữ trước khi gọi `importOrders()` — chống đẩy trùng (ORD-20). Đặt
   * bằng 1 lệnh ghi có điều kiện (`pushedAt: null` + chưa ai giữ), nên hai
   * lượt push song song chỉ 1 lượt giành được; lượt kia nhận thông báo rõ ràng
   * thay vì lỗi trùng khoá `productionId` từ tầng dưới.
   *
   * KHÔNG dùng chính `pushedAt` làm chỗ giữ: đặt `pushedAt` trước khi đơn thật
   * sự vào sản xuất thì tiến trình chết giữa chừng sẽ để lại đơn "đã đẩy" mà
   * không có đơn sản xuất nào. Trường riêng thì hỏng giữa chừng chỉ để lại chỗ
   * giữ cũ, và chỗ giữ quá `PUSH_CLAIM_STALE_MS` tự hết hiệu lực.
   */
  @Prop({ type: Date, default: null })
  pushingAt?: Date | null;

  @Prop({ ref: 'CustomerPaymentEntity' })
  paymentId?: string;

  @Prop({ type: Date, default: null })
  cancelledAt?: Date | null;

  @Prop({ trim: true })
  cancelReason?: string;

  /** Đơn đã thanh toán bị hủy + đã hoàn tiền (tab Refunded) — phase này chưa có flow set. */
  @Prop({ type: Date, default: null })
  refundedAt?: Date | null;

  /**
   * Hub "Trashed" tab (legacy parity, admin only). Only orders never pushed to production can
   * be trashed: a pushed order already has production orders on the floor. Trashed orders are
   * hidden from every list, count and lookup (seller portal, hub, public track, open API) and
   * cannot be edited, cancelled or pushed until restored. NOT `deletedAt`: the repository hides
   * `deletedAt` everywhere, so the Trashed tab could not even count itself.
   */
  @Prop({ type: Date, default: null })
  trashedAt?: Date | null;

  @Prop({ trim: true })
  trashedBy?: string;
}

export const CustomerOrderSchema = SchemaFactory.createForClass(CustomerOrderEntity);
// Idempotency: 1 khách không thể có 2 đơn cùng orderKey (import retry an toàn).
CustomerOrderSchema.index({ customerId: 1, orderKey: 1 }, { unique: true });
// Listing portal: lọc theo khách + trạng thái staging + mới nhất trước.
CustomerOrderSchema.index({ customerId: 1, status: 1, createdAt: -1 });
// Lookup ngược từ OrderEntity (derive trạng thái + backfill idempotent).
CustomerOrderSchema.index({ 'items.productionId': 1 });

CustomerOrderSchema.virtual('customer', {
  ref: 'CustomerEntity',
  localField: 'customerId',
  foreignField: '_id',
  justOne: true,
});

export type CustomerOrderDocument = HydratedDocument<CustomerOrderEntity> & { customer?: CustomerDocument };
