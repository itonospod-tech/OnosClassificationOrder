import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CustomerEntity, CustomerSchema } from '../customer/customer.entity';
import { OrderEntity, OrderSchema } from '../order/order.entity';
import { ZaloEngineModule } from '../zalo-engine/zalo-engine.module';
import { ZaloGroupController } from './zalo-group.controller';
import { ZaloGroupRepository } from './zalo-group.repository';
import { ZaloGroupService } from './zalo-group.service';
import { ZaloGroupLinkEntity, ZaloGroupLinkSchema } from './zalo-group-link.entity';
import { ZaloGroupSummaryEntity, ZaloGroupSummarySchema } from './zalo-group-summary.entity';
import { ZaloIdentityEntity, ZaloIdentitySchema } from './zalo-identity.entity';
import { ZaloIdentityService } from './zalo-identity.service';
import { ZaloSummaryProcessor } from './zalo-summary.processor';
import { ZALO_SUMMARY_QUEUE } from './zalo-summary.queue';
import { ZaloSummaryService } from './zalo-summary.service';

/**
 * Nối nhóm Zalo ↔ khách hàng.
 *
 * Chỉ bind model, KHÔNG import `CustomerModule` — module này chỉ cần đọc vài
 * trường của khách (`userSku`, `fullName`) chứ không dùng nghiệp vụ của nó, và
 * `CustomerModule` lại kéo theo cả cụm customer-portal. Bind thẳng model giữ
 * đồ thị phụ thuộc phẳng.
 */
@Module({
  imports: [
    // Cửa ĐỌC engine Zalo dùng chung: cron tóm tắt kéo tin qua đây.
    ZaloEngineModule,
    MongooseModule.forFeature([
      { name: ZaloGroupLinkEntity.name, schema: ZaloGroupLinkSchema },
      { name: ZaloGroupSummaryEntity.name, schema: ZaloGroupSummarySchema },
      { name: ZaloIdentityEntity.name, schema: ZaloIdentitySchema },
      { name: CustomerEntity.name, schema: CustomerSchema },
      { name: OrderEntity.name, schema: OrderSchema },
    ]),
    BullModule.registerQueue({
      name: ZALO_SUMMARY_QUEUE,
      defaultJobOptions: {
        // Thử lại 3 lần cách nhau tăng dần: hỏng vì mô hình quá tải hoặc API
        // vừa restart thì lần sau thường qua, không cần người can thiệp.
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { count: 200, age: 3 * 24 * 60 * 60 },
        removeOnFail: { count: 500, age: 14 * 24 * 60 * 60 },
      },
    }),
  ],
  controllers: [ZaloGroupController],
  providers: [ZaloGroupService, ZaloGroupRepository, ZaloSummaryService, ZaloSummaryProcessor, ZaloIdentityService],
  exports: [ZaloGroupService, ZaloGroupRepository, ZaloSummaryService, ZaloIdentityService, BullModule],
})
export class ZaloGroupModule {}
