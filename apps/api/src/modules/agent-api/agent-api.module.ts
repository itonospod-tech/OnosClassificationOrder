import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CeoDashboardModule } from '../ceo-dashboard/ceo-dashboard.module';
import { CustomerReportModule } from '../customer-report/customer-report.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { ZaloEngineModule } from '../zalo-engine/zalo-engine.module';
import { AgentAdminService } from './agent-admin.service';
import { AgentApiController } from './agent-api.controller';
import { AgentApiRepository } from './agent-api.repository';
import { AgentApiAdminController } from './agent-api-admin.controller';
import { AgentApiKeyGuard } from './agent-api-key.guard';
import { AgentApiLogEntity, AgentApiLogSchema } from './agent-audit.entity';
import { AgentAuditService } from './agent-audit.service';
import { AgentDocsService } from './agent-docs.service';
import { AgentExceptionFilter } from './agent-exception.filter';
import { AgentQueryService } from './agent-query.service';
import { AgentReadService } from './agent-read.service';
import { AgentSellerSupportService } from './agent-seller-support.service';
import { AgentZaloInboundController } from './agent-zalo-inbound.controller';
import { AgentZaloInboundService } from './agent-zalo-inbound.service';
import { AgentZaloReadService } from './agent-zalo-read.service';
import { AgentZaloSendService } from './agent-zalo-send.service';
import { AgentZaloTriggerEntity, AgentZaloTriggerSchema } from './agent-zalo-trigger.entity';

/**
 * Bộ API nội bộ cho AI agent (`API-1`, mở hết ở `API-19`).
 *
 * KHÔNG còn bind model của các bảng nghiệp vụ: từ `API-19`, bề mặt là **mọi
 * collection**, nên `AgentApiRepository` đọc thẳng qua `Connection` thay vì tra
 * model. Bind một danh sách cố định ở đây sẽ là danh sách thứ hai để lệch với
 * thực tế, và nó không còn giới hạn được gì.
 *
 * Model còn bind là HAI bảng của chính module này, và là hai chỗ DUY NHẤT module
 * được phép ghi: nhật ký gọi API, và kho sự kiện Zalo đã lọc (`AgentZaloTrigger`).
 * Không bảng nghiệp vụ nào — `AgentApiRepository` vẫn chỉ phơi `find`/`aggregate`
 * nên phần đọc giữ nguyên bất biến BR-3.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentApiLogEntity.name, schema: AgentApiLogSchema },
      { name: AgentZaloTriggerEntity.name, schema: AgentZaloTriggerSchema },
    ]),
    // Blob cấu hình nghe Zalo: uid Chủ tịch + bên đăng ký nhận.
    SystemConfigModule,
    // Cửa ĐỌC engine Zalo dùng chung (gộp + khử trùng zaloMsgId).
    ZaloEngineModule,
    // CEO Dashboard: agent ĐỌC cùng số + cùng nhận định (không có đường ghi — BR-3 giữ nguyên).
    CeoDashboardModule,
    // Báo cáo khách hàng — cùng nguồn số với CEO Dashboard, xem `customer-report.service.ts`.
    CustomerReportModule,
  ],
  controllers: [AgentApiController, AgentApiAdminController, AgentZaloInboundController],
  providers: [
    AgentSellerSupportService,
    AgentZaloSendService,
    AgentZaloReadService,
    AgentZaloInboundService,
    AgentAdminService,
    AgentApiKeyGuard,
    AgentExceptionFilter,
    AgentApiRepository,
    AgentAuditService,
    AgentDocsService,
    AgentQueryService,
    AgentReadService,
  ],
})
export class AgentApiModule {}
