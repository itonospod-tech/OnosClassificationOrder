import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type { InventoryOutSource, InventoryTxnKind } from 'shared';
import { INVENTORY_OUT_SOURCES, INVENTORY_TXN_KINDS } from 'shared';

/** Tham chiếu nghiệp vụ của 1 giao dịch kho — lượt xuất theo đơn gắn đủ id để đối soát. */
export interface InventoryTxnRefs {
  /**
   * Idempotency key (unique cùng itemId+kind — index dưới). Lượt xuất theo đơn
   * dùng `<productionId>#<attempt>`: `#1` lần đầu, `#2`+ cho rework — nhờ vậy
   * quét lặp/auto gọi lặp KHÔNG trừ đúp, nhưng rework chủ đích vẫn trừ được lần 2.
   */
  requestId?: string;
  productionId?: string;
  orderId?: string;
  receiptId?: string;
  source?: InventoryOutSource;
  /** true = lượt trừ lần 2+ cho đơn làm lại. */
  rework?: boolean;
}

/**
 * Sổ cái tồn kho — APPEND-ONLY, không update/delete record. Mỗi record lưu
 * `balanceBefore → balanceAfter`. MỌI biến động đi qua
 * `InventoryService.applyTransaction()` (ghi sổ + cập nhật cache
 * `InventoryItemEntity.quantity` trong CÙNG transaction Mongo) — mirror nguyên
 * khuôn ví seller `customer_wallet_transactions`.
 * Plan: `documents/Plans/Inventory-FactoryStock.md`.
 */
@DatabaseEntity({ collection: 'inventory_transactions' })
export class InventoryTransactionEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, ref: 'FactoryEntity', index: true })
  factoryId: string;

  @Prop({ required: true, ref: 'InventoryItemEntity' })
  itemId: string;

  /** Snapshot SKU lúc giao dịch — sổ cái không join lại item. */
  @Prop({ required: true, trim: true, uppercase: true })
  sku: string;

  @Prop({ type: String, enum: INVENTORY_TXN_KINDS, required: true })
  kind: InventoryTxnKind;

  /** Dương = cộng tồn, âm = trừ tồn. */
  @Prop({ required: true })
  qty: number;

  @Prop({ required: true })
  balanceBefore: number;

  @Prop({ required: true })
  balanceAfter: number;

  @Prop({ trim: true })
  note?: string;

  @Prop({ ref: 'UserEntity' })
  byUserId?: string;

  /** Snapshot tên người thao tác — sổ cái không join lại user. */
  @Prop({ trim: true })
  byUserName?: string;

  @Prop({
    type: {
      requestId: String,
      productionId: String,
      orderId: String,
      receiptId: String,
      source: { type: String, enum: INVENTORY_OUT_SOURCES },
      rework: Boolean,
      _id: false,
    },
  })
  refs?: InventoryTxnRefs;
}

export const InventoryTransactionSchema = SchemaFactory.createForClass(InventoryTransactionEntity);
InventoryTransactionSchema.index({ factoryId: 1, createdAt: -1 });
// Tra "đơn này đã trừ chưa/mấy lần" + filter thống kê theo đơn.
InventoryTransactionSchema.index(
  { 'refs.productionId': 1 },
  { partialFilterExpression: { 'refs.productionId': { $exists: true } } },
);
// Idempotency tầng DB: cùng item + cùng loại + cùng requestId chỉ ghi được 1 lần
// — chặn trừ đúp khi FE retry / auto-label gọi lặp / đối soát chạy trùng.
InventoryTransactionSchema.index(
  { itemId: 1, kind: 1, 'refs.requestId': 1 },
  { unique: true, partialFilterExpression: { 'refs.requestId': { $exists: true } } },
);

export type InventoryTransactionDocument = HydratedDocument<InventoryTransactionEntity>;
