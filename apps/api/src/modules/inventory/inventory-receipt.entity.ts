import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';

export interface InventoryReceiptLine {
  sku: string;
  name?: string;
  qty: number;
  note?: string;
}

/**
 * Phiếu nhập/xuất kho — chỉ là "bìa kẹp" gom nhiều dòng transaction + số phiếu
 * để đối soát kế toán, KHÔNG có workflow duyệt. Phiếu NHẬP tạo cùng lúc với
 * các txn `in`; phiếu XUẤT sinh lười từ nút "Chốt phiếu xuất" (gom txn `out`
 * chưa có receiptId trong ngày). Số phiếu theo khuôn `BG-` của packing:
 * `NK-<xưởng>-<ngày VN>-<seq>` / `XK-...`.
 * Plan: `documents/Plans/Inventory-FactoryStock.md`.
 */
@DatabaseEntity({ collection: 'inventory_receipts' })
export class InventoryReceiptEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, unique: true })
  code: string;

  @Prop({ type: String, enum: ['in', 'out'], required: true })
  type: 'in' | 'out';

  @Prop({ required: true, ref: 'FactoryEntity', index: true })
  factoryId: string;

  /** Snapshot các dòng để render/in phiếu — nguồn sự thật vẫn là transactions. */
  @Prop({
    type: [{ sku: String, name: String, qty: Number, note: String, _id: false }],
    required: true,
  })
  lines: InventoryReceiptLine[];

  @Prop({ ref: 'UserEntity' })
  byUserId?: string;

  @Prop({ trim: true })
  byUserName?: string;

  @Prop({ trim: true })
  note?: string;
}

export const InventoryReceiptSchema = SchemaFactory.createForClass(InventoryReceiptEntity);
InventoryReceiptSchema.index({ factoryId: 1, createdAt: -1 });

export type InventoryReceiptDocument = HydratedDocument<InventoryReceiptEntity>;
