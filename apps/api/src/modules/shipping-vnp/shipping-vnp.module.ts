import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrderEntity, OrderSchema } from '../order/order.entity';
import { SystemConfigModule } from '../system-config/system-config.module';
import { PackingService } from './packing.service';
import { ShipmentEntity, ShipmentSchema } from './shipment.entity';
import { ShipmentIngestService } from './shipment-ingest.service';
import { ShippingPackageEntity, ShippingPackageSchema } from './shipping-package.entity';
import { ShippingVnpController } from './shipping-vnp.controller';
import { ShippingVnpService } from './shipping-vnp.service';
import { VnpEglobalClient } from './vnp-eglobal.client';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderEntity.name, schema: OrderSchema },
      { name: ShippingPackageEntity.name, schema: ShippingPackageSchema },
      { name: ShipmentEntity.name, schema: ShipmentSchema },
    ]),
    SystemConfigModule,
  ],
  controllers: [ShippingVnpController],
  providers: [ShippingVnpService, VnpEglobalClient, ShipmentIngestService, PackingService],
  // `ShipmentIngestService` export cho OrderModule ghi vận đơn KHÁCH TỰ CẤP
  // (CSV/API) vào cùng bảng `shipments` — module này KHÔNG import OrderModule
  // (chỉ bind model) nên chiều phụ thuộc 1 chiều, không sinh vòng DI.
  // `PackingService` export cho FulfillmentModule ghi kiện lúc Đóng hàng xong.
  exports: [ShippingVnpService, ShipmentIngestService, PackingService],
})
export class ShippingVnpModule {}
