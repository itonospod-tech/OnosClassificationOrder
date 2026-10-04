import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CollectionModule } from '../collection/collection.module';
import { ProductTagModule } from '../product-tag/product-tag.module';
import { ProductTechniqueModule } from '../product-technique/product-technique.module';
import { FactoryModule } from '../factory/factory.module';
import { MachineTypeModule } from '../machine-type/machine-type.module';
import { OrderEntity, OrderSchema } from '../order/order.entity';
import { ProductCategoryModule } from '../product-category/product-category.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { WorkshopConfigModule } from '../workshop-config/workshop-config.module';
import { OnospodProductImportService } from './onospod-product-import.service';
import { ProductConfigController } from './product-config.controller';
import { ProductConfigEntity, ProductConfigSchema } from './product-config.entity';
import { ProductConfigRepository } from './product-config.repository';
import { ProductConfigService } from './product-config.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProductConfigEntity.name, schema: ProductConfigSchema }]),
    // Chỉ cần model đơn (KHÔNG import OrderModule — tránh vòng lặp DI) cho
    // `getUnmatchedOrderTypes()`: quét type trên đơn chưa có config.
    MongooseModule.forFeature([{ name: OrderEntity.name, schema: OrderSchema }]),
    CollectionModule,
    ProductTagModule,
    ProductTechniqueModule,
    FactoryModule,
    MachineTypeModule,
    ProductCategoryModule,
    // Cờ migration 1 lần `design_review_code_migration` (PRD-2).
    SystemConfigModule,
    WorkshopConfigModule,
  ],
  controllers: [ProductConfigController],
  providers: [ProductConfigService, ProductConfigRepository, OnospodProductImportService],
  exports: [ProductConfigService, ProductConfigRepository],
})
export class ProductConfigModule {}
