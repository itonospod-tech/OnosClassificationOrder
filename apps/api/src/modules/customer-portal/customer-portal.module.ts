import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '@/modules/auth/auth.module';
import { CollectionEntity, CollectionSchema } from '@/modules/collection/collection.entity';
import { CustomerModule } from '@/modules/customer/customer.module';
import { CustomerEventModule } from '@/modules/customer-event/customer-event.module';
import { DesignStorageModule } from '@/modules/design-storage/design-storage.module';
import { OrderEntity, OrderSchema } from '@/modules/order/order.entity';
import { OrderModule } from '@/modules/order/order.module';
import { ProductCategoryEntity, ProductCategorySchema } from '@/modules/product-category/product-category.entity';
import { ProductConfigEntity, ProductConfigSchema } from '@/modules/product-config/product-config.entity';
import { PromotionModule } from '@/modules/promotion/promotion.module';
import { SystemConfigModule } from '@/modules/system-config/system-config.module';

import { CustomerApiKeyController } from './customer-api-key.controller';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerCatalogController } from './customer-catalog.controller';
import { CustomerCatalogService } from './customer-catalog.service';
import { CustomerOpenApiController } from './customer-open-api.controller';
import { CustomerOrderController } from './customer-order.controller';
import { CustomerOrderEntity, CustomerOrderSchema } from './customer-order.entity';
import { CustomerOrderService } from './customer-order.service';
import { CustomerOrderAdminController } from './customer-order-admin.controller';
import { CustomerPaymentEntity, CustomerPaymentSchema } from './customer-payment.entity';
import { PublicCatalogController } from './public-catalog.controller';
import { PublicTrackController } from './public-track.controller';
import { PublicTrackService } from './public-track.service';

@Module({
  imports: [
    // Bind Order/ProductConfig model trực tiếp cho các query scoped-theo-khách
    // (list/track/catalog) — cùng pattern với CustomerModule, tránh phụ thuộc
    // vòng không cần thiết.
    MongooseModule.forFeature([
      { name: OrderEntity.name, schema: OrderSchema },
      { name: ProductConfigEntity.name, schema: ProductConfigSchema },
      { name: ProductCategoryEntity.name, schema: ProductCategorySchema },
      { name: CollectionEntity.name, schema: CollectionSchema },
      { name: CustomerOrderEntity.name, schema: CustomerOrderSchema },
      { name: CustomerPaymentEntity.name, schema: CustomerPaymentSchema },
    ]),
    AuthModule,
    CustomerModule,
    OrderModule,
    PromotionModule,
    // Hook touchUsage + enqueue ingest design lúc place/import/push (DesignStorage).
    DesignStorageModule,
    // Payment gate switch + số ngày Completed (`customer_order_completed_days`).
    SystemConfigModule,
    // Sự kiện `order.pushed` khi push — webhook (ORD-4) + noti portal (ORD-5).
    CustomerEventModule,
  ],
  controllers: [
    CustomerAuthController,
    CustomerOrderController,
    CustomerCatalogController,
    PublicCatalogController,
    // Tra cứu đơn công khai `/track/:productionId` (không đăng nhập).
    PublicTrackController,
    // ORD-4 — API keys (portal, JWT) + Public Order API (API key, không JWT).
    CustomerApiKeyController,
    CustomerOpenApiController,
    // Khu quản trị `/hub` của Seller Portal (Admin đọc đơn mọi seller).
    CustomerOrderAdminController],
  providers: [CustomerOrderService, CustomerCatalogService, PublicTrackService],
})
export class CustomerPortalModule {}
