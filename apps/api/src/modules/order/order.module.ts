import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CustomerModule } from '../customer/customer.module';
import { CustomerAssignmentModule } from '../customer-assignment/customer-assignment.module';
import { CustomerEventModule } from '../customer-event/customer-event.module';
import { DesignImageModule } from '../design-image/design-image.module';
import { FactoryModule } from '../factory/factory.module';
import { MachineTypeModule } from '../machine-type/machine-type.module';
import { OrderLogModule } from '../order-log/order-log.module';
import { ProductConfigModule } from '../product-config/product-config.module';
import { RedisCacheModule } from '../redis-cache/redis-cache.module';
import { RoleEntity, RoleSchema } from '../role/role.entity';
import { RoleRepository } from '../role/role.repository';
import { ShippingVnpModule } from '../shipping-vnp/shipping-vnp.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { UserEntity, UserSchema } from '../user/user.entity';
import { WorkshopConfigModule } from '../workshop-config/workshop-config.module';
import { DriveFileNameService } from './drive-file-name.service';
import { OnospodHoldSyncService } from './onospod-hold-sync.service';
import { OnospodImportService } from './onospod-import.service';
import { OnospodOrderLookupService } from './onospod-order-lookup.service';
import { OrderController } from './order.controller';
import { OrderEntity, OrderSchema } from './order.entity';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: OrderEntity.name, schema: OrderSchema }]),
    MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
    // RoleRepository không export từ RoleModule (chỉ export RoleService) nên
    // tự bind model + repo trong module này — dùng cho assertAssigneeUserValid.
    MongooseModule.forFeature([{ name: RoleEntity.name, schema: RoleSchema }]),
    ProductConfigModule,
    WorkshopConfigModule,
    OrderLogModule,
    RedisCacheModule,
    FactoryModule,
    MachineTypeModule,
    DesignImageModule,
    SystemConfigModule,
    CustomerAssignmentModule,
    // CustomerRepository cho auto-gán designer ưu tiên 1 (khách → designer).
    CustomerModule,
    // ORD-4/ORD-5 — nguồn sự kiện chung: webhook khách API + noti chuông portal
    // khi đơn hold/unhold/cancel.
    CustomerEventModule,
    // ORD-26 — ghi vận đơn khách tự cấp (CSV/API) vào module vận đơn
    // (`shipments`/`shipping_packages`) ngay lúc import đơn.
    ShippingVnpModule,
  ],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderRepository,
    RoleRepository,
    DriveFileNameService,
    OnospodImportService,
    OnospodHoldSyncService,
    OnospodOrderLookupService,
  ],
  exports: [OrderService],
})
export class OrderModule {}
