import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';

/**
 * Danh mục hàng tồn kho theo xưởng (phôi áo, vật tư...) — mỗi record là 1 SKU
 * của 1 xưởng, `quantity` là CACHE số tồn: mọi biến động đi qua
 * `InventoryService.applyTransaction()` (ghi sổ cái + cập nhật cache trong CÙNG
 * transaction Mongo, mirror khuôn ví seller). Tồn ĐƯỢC PHÉP ÂM (hàng về trước
 * giấy tờ sau) — FE cảnh báo đỏ chứ không chặn.
 * Plan: `documents/Plans/Inventory-FactoryStock.md`.
 */
@DatabaseEntity({ collection: 'inventory_items' })
export class InventoryItemEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, ref: 'FactoryEntity', index: true })
  factoryId: string;

  /** SKU kho — thường là variation SKU đầy đủ (`CAMOSHIRT-XL`, giữ đuôi size). */
  @Prop({ required: true, trim: true, uppercase: true })
  sku: string;

  @Prop({ trim: true })
  name?: string;

  @Prop({ trim: true, default: 'cái' })
  unit?: string;

  /** CACHE tồn — có thể âm. Đừng update trực tiếp ngoài applyTransaction(). */
  @Prop({ required: true, default: 0 })
  quantity: number;

  /** Sinh tự động lúc quét gặp SKU chưa có — thủ kho cần rà lại tên/đơn vị. */
  @Prop({ default: false })
  autoCreated: boolean;

  @Prop({ type: String, enum: ['active', 'inactive'], default: 'active' })
  status: 'active' | 'inactive';
}

export const InventoryItemSchema = SchemaFactory.createForClass(InventoryItemEntity);
// 1 SKU chỉ có 1 dòng tồn trong 1 xưởng.
InventoryItemSchema.index({ factoryId: 1, sku: 1 }, { unique: true });

export type InventoryItemDocument = HydratedDocument<InventoryItemEntity>;
