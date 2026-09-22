import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FactoryEntity, FactorySchema } from '@/modules/factory/factory.entity';
import { OrderEntity, OrderSchema } from '@/modules/order/order.entity';
import { ProductConfigEntity, ProductConfigSchema } from '@/modules/product-config/product-config.entity';

import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';
import { InventoryItemEntity, InventoryItemSchema } from './inventory-item.entity';
import { InventoryReceiptEntity, InventoryReceiptSchema } from './inventory-receipt.entity';
import { InventoryTransactionEntity, InventoryTransactionSchema } from './inventory-transaction.entity';

/**
 * Tồn kho theo xưởng — sổ cái append-only + cache tồn. Chỉ bind model
 * Order/ProductConfig/Factory (không import cả module) — tránh kéo cây phụ
 * thuộc của OrderModule vào đây (khuôn của CustomerWalletModule).
 * Plan: `documents/Plans/Inventory-FactoryStock.md`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InventoryItemEntity.name, schema: InventoryItemSchema },
      { name: InventoryTransactionEntity.name, schema: InventoryTransactionSchema },
      { name: InventoryReceiptEntity.name, schema: InventoryReceiptSchema },
      { name: OrderEntity.name, schema: OrderSchema },
      { name: ProductConfigEntity.name, schema: ProductConfigSchema },
      { name: FactoryEntity.name, schema: FactorySchema },
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
