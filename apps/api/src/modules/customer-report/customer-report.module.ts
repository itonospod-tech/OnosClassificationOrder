import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CeoDashboardModule } from '../ceo-dashboard/ceo-dashboard.module';
import { CustomerReportController } from './customer-report.controller';
import { CustomerReportEntity, CustomerReportSchema } from './customer-report.entity';
import { CustomerReportService } from './customer-report.service';

/**
 * Báo cáo khách hàng cho agent. Số liệu lấy TỪ `CeoDashboardService` chứ không
 * gộp lại — xem đầu `customer-report.service.ts` vì sao.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: CustomerReportEntity.name, schema: CustomerReportSchema }]), CeoDashboardModule],
  controllers: [CustomerReportController],
  providers: [CustomerReportService],
  exports: [CustomerReportService],
})
export class CustomerReportModule {}
