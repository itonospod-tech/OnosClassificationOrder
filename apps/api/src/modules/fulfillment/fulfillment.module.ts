import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CustomerEventModule } from '../customer-event/customer-event.module';
import { OrderEntity, OrderSchema } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { OrderLogModule } from '../order-log/order-log.module';
import { ShippingVnpModule } from '../shipping-vnp/shipping-vnp.module';
import { UserEntity, UserSchema } from '../user/user.entity';
import { FulfillmentTaskController } from './fulfillment-task.controller';
import { FulfillmentTaskService } from './fulfillment-task.service';

/**
 * Fulfillment 5-stage workflow module.
 *
 * Phase 2: transition state machine + my-tasks (4 tab).
 * Phase 5: team admin (queue overview + worker mgmt).
 * Phase 6: stats (throughput + cycle time).
 */
@Module({
  imports: [
    OrderLogModule,
    // OrderService cho hook auto-gán designer khi rework-back target=designer.
    OrderModule,
    // ORD-4/ORD-5 — sự kiện `order.production_completed` khi đóng hàng xong.
    CustomerEventModule,
    // Ghi KIỆN lúc Đóng hàng xong (GAP-25/26/27) — module này không import
    // ngược Fulfillment nên chiều phụ thuộc vẫn một chiều.
    ShippingVnpModule,
    MongooseModule.forFeature([{ name: OrderEntity.name, schema: OrderSchema }]),
    MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
  ],
  controllers: [FulfillmentTaskController],
  providers: [FulfillmentTaskService],
  exports: [FulfillmentTaskService],
})
export class FulfillmentModule {}
