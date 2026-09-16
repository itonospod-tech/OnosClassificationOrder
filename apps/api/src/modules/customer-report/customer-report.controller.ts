import { ZodValidationPipe } from '@anatine/zod-nestjs';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CeoOverviewQueryDto, CeoReportGenerateDto, GetCustomerReportResDto, RoleType } from 'shared';

import { Auth } from '@/decorators';

import { CustomerReportService } from './customer-report.service';

/**
 * Đọc/sinh báo cáo khách hàng từ khu quản trị.
 *
 * Cron sinh 07:15 mỗi sáng, nhưng phải có đường sinh TAY: không thì muốn xem
 * một kỳ bất kỳ là phải đợi tới sáng hôm sau, và người kiểm sau khi sửa luật
 * cũng không có cách nào chạy lại.
 */
@ApiTags('customer-report')
@Controller('customer-report')
@UsePipes(ZodValidationPipe)
export class CustomerReportController {
  constructor(private readonly reports: CustomerReportService) {}

  @Get()
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Báo cáo khách hàng mới nhất cho kỳ (null nếu chưa có)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetCustomerReportResDto })
  async get(@Query() q: CeoOverviewQueryDto): Promise<GetCustomerReportResDto> {
    return { success: true, data: { report: await this.reports.getLatest(q.from, q.to), generating: this.reports.isGenerating(q.from, q.to) } };
  }

  @Post('generate')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Sinh báo cáo khách hàng cho kỳ (chạy nền, thăm dò GET tới khi generating=false)' })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOkResponse({ type: GetCustomerReportResDto })
  async generate(@Body() body: CeoReportGenerateDto): Promise<GetCustomerReportResDto> {
    if (!this.reports.isGenerating(body.from, body.to)) {
      void this.reports.generate(body.from, body.to, 'manual').catch(() => undefined);
    }

    return { success: true, data: { report: await this.reports.getLatest(body.from, body.to), generating: true } };
  }
}
