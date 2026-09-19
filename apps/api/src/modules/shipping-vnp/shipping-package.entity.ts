import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';

/**
 * 1 kiện hàng vật lý — label luôn dán lên kiện nên shipment trỏ vào đây
 * (KHÔNG trỏ đơn khách: sau này gộp nhiều đơn cùng địa chỉ vào 1 kiện /
 * thùng master đi hub chỉ cần thêm phần tử `orderCodes` / set
 * `parentPackageId`, không đổi schema). Hiện tại pack tự sinh ngầm lúc
 * Admin mua label, 1 pack = 1 đơn khách (`orderId` seller).
 */
@DatabaseEntity({ collection: 'shipping_packages' })
export class ShippingPackageEntity extends DatabaseEntityAbstract {
  /** Mã kiện hiển thị `PK-XXXXXXXXXX`. */
  @Prop({ required: true, unique: true, trim: true })
  code: string;

  @Prop({ ref: 'FactoryEntity' })
  factoryId?: string;

  /** orderId seller trong kiện — hiện luôn ≤1 phần tử (đơn không có orderId → rỗng). */
  @Prop({ type: [String], default: [] })
  orderCodes: string[];

  /** OrderEntity._id các item trong kiện — dùng tra lịch sử theo đơn. */
  @Prop({ type: [String], default: [], index: true })
  productionOrderIds: string[];

  /** productionId hiển thị của các item (snapshot lúc tạo). */
  @Prop({ type: [String], default: [] })
  productionIds: string[];

  /** Kiện cha (thùng master gom nhiều kiện đi hub) — để dành, CHƯA dùng. */
  @Prop({ ref: 'ShippingPackageEntity' })
  parentPackageId?: string;

  /**
   * Mã đơn seller mà kiện này thuộc về — KHOÁ GỘP của kiện.
   *
   * Chốt nghiệp vụ 17/09/2026: **1 kiện = 1 đơn seller**, mọi item cùng mã đơn
   * nằm chung một kiện. Khớp đúng cách mua label VNP (nhiều item chung một
   * label) và cách xưởng đóng gói thật. Đơn không có mã đơn (đơn lẻ nhập tay)
   * thì rơi về `productionId` của chính nó.
   */
  @Prop({ trim: true, index: true })
  orderId?: string;

  /**
   * Kiện sinh ra từ đâu: `pack` = công đoạn Đóng hàng (đường chính từ
   * 17/09/2026), `label` = lúc mua vận đơn (đường cũ, giữ cho đơn mua label
   * trước khi đóng). Cùng một kiện có thể bắt đầu ở `label` rồi được công
   * đoạn đóng gói bổ sung cân — `source` giữ nguyên nơi nó SINH RA.
   */
  @Prop({ trim: true })
  source?: 'pack' | 'label';

  /** Cân THỰC TẾ do trạm đóng gói nhập, gram. Khác cân khai trên biến thể. */
  @Prop()
  weightGram?: number;

  /** Kích thước thực tế (cm) — nhập kèm cân, dùng để đối soát cước quy đổi. */
  @Prop({ type: { width: Number, height: Number, length: Number }, _id: false })
  dimensions?: { width?: number; height?: number; length?: number };

  /** Mốc đóng gói xong — đặt ở công đoạn Đóng hàng, không phải lúc mua label. */
  @Prop({ index: true })
  packedAt?: Date;

  @Prop({ trim: true })
  packedByUserId?: string;

  /** Ảnh chụp tên người đóng, để phiếu bàn giao in được mà không phải join. */
  @Prop({ trim: true })
  packedByUserName?: string;

  /** Mốc kiện rời kho, đóng dấu lúc in phiếu bàn giao. */
  @Prop({ index: true })
  handoverAt?: Date;

  /** Mã phiếu bàn giao (`BG-<xưởng>-<ngày>-<số>`) — nhiều kiện chung một mã. */
  @Prop({ trim: true, index: true })
  handoverCode?: string;

  @Prop({ trim: true })
  handoverByUserId?: string;

  /** Hãng nhận hàng, người bàn giao tự chọn — chưa ràng buộc danh mục. */
  @Prop({ trim: true })
  handoverCarrier?: string;
}

export const ShippingPackageSchema = SchemaFactory.createForClass(ShippingPackageEntity);
ShippingPackageSchema.index({ orderCodes: 1 });

export type ShippingPackageDocument = HydratedDocument<ShippingPackageEntity>;
