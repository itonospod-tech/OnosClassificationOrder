import { ZodValidationPipe } from '@anatine/zod-nestjs';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import {
  BulkFulfillmentTransitionDto,
  BulkFulfillmentTransitionResDto,
  CompletePackBacklogDto,
  CompletePackBacklogResDto,
  FulfillmentDailyOverviewResDto,
  FulfillmentTransitionDto,
  FulfillmentTransitionResDto,
  GetFulfillmentDailyOverviewDto,
  GetFulfillmentMyTasksDto,
  GetFulfillmentMyTasksResDto,
  RoleType,
} from 'shared';
import { Logger } from 'winston';

import { Auth, ClientIp, UserAgent } from '@/decorators';

import { UserDocument } from '../user/user.entity';
import { FulfillmentTaskService } from './fulfillment-task.service';

const TRANSITION_ROLES: RoleType[] = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.SupportManager,
  RoleType.Fulfillment,
];

// Bảng "Tổng quan theo ngày" (read-only, funnel toàn cục) — dùng chung cho Task
// Fulfillment + trang Designer my-tasks + tab Soát tool. Rộng hơn TRANSITION_ROLES
// (thêm Support/Designer/DesignerLeader) vì chỉ đọc, không transition/ghi factory.
const OVERVIEW_ROLES: RoleType[] = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.SupportManager,
  RoleType.Support,
  RoleType.Fulfillment,
  RoleType.DesignerLeader,
  RoleType.Designer,
];

@Controller()
@ApiTags('fulfillment')
@UsePipes(ZodValidationPipe)
export class FulfillmentTaskController {
  constructor(
    private readonly taskService: FulfillmentTaskService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  @Post('orders/:id/fulfillment-transition')
  @Auth(TRANSITION_ROLES)
  @ApiOperation({
    summary:
      'Trigger fulfillment state-machine transition. Worker chỉ thao tác stage của mình; Manager/Admin override.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FulfillmentTransitionResDto })
  async transition(
    @Param('id') id: string,
    @Body() dto: FulfillmentTransitionDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<FulfillmentTransitionResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: `/orders/${id}/fulfillment-transition`,
        userId: user._id,
        stage: dto.stage,
        action: dto.action,
        target: dto.target,
      }),
    });
    const data = await this.taskService.transition(id, user, dto, { user, ip, userAgent });
    return { success: true, data } as unknown as FulfillmentTransitionResDto;
  }

  @Post('fulfillment/bulk-transition')
  @Auth(TRANSITION_ROLES)
  @ApiOperation({
    summary:
      'Bulk transition N đơn trong 1 request (chọn cả cột ở kanban) — BE loop transition từng đơn giữ đủ hook.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkFulfillmentTransitionResDto })
  async bulkTransition(
    @Body() dto: BulkFulfillmentTransitionDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkFulfillmentTransitionResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/fulfillment/bulk-transition',
        userId: user._id,
        stage: dto.stage,
        action: dto.action,
        count: dto.orderIds.length,
      }),
    });
    const data = await this.taskService.bulkTransition(user, dto, { user, ip, userAgent });
    return { success: true, data };
  }

  @Post('fulfillment/complete-pack-backlog')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({
    summary:
      'Dọn đơn tồn ở các công đoạn tự hoàn thành của 1 xưởng (auto-stage theo flowType + Đóng hàng). dryRun mặc định true = chỉ đếm.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CompletePackBacklogResDto })
  async completePackBacklog(
    @Body() dto: CompletePackBacklogDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<CompletePackBacklogResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/fulfillment/complete-pack-backlog',
        userId: user._id,
        factoryId: dto.factoryId,
        dryRun: dto.dryRun,
      }),
    });
    const data = await this.taskService.completePackBacklog(user, dto.factoryId, dto.dryRun, { user, ip, userAgent });
    return { success: true, data };
  }

  @Get('fulfillment/my-tasks')
  @Auth(TRANSITION_ROLES)
  @ApiOperation({ summary: 'My Tasks 4 tab cho worker (waiting/in-progress/rework/watching).' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetFulfillmentMyTasksResDto })
  async getMyTasks(
    @Query() query: GetFulfillmentMyTasksDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetFulfillmentMyTasksResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/fulfillment/my-tasks',
        userId: user._id,
        tab: query.tab,
      }),
    });
    const result = await this.taskService.getMyTasks(user, query);
    return {
      success: true,
      data: result.data,
      total: result.total,
      page: result.page,
      size: result.size,
      tabCounts: result.tabCounts,
    } as unknown as GetFulfillmentMyTasksResDto;
  }

  @Get('fulfillment/daily-overview')
  @Auth(OVERVIEW_ROLES)
  @ApiOperation({ summary: 'Bảng tổng quan theo ngày (Đến/Đã làm/Còn lại/Lỗi) cho stage của tôi.' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FulfillmentDailyOverviewResDto })
  async getDailyOverview(
    @Query() query: GetFulfillmentDailyOverviewDto,
    @AuthUser() user: UserDocument,
  ): Promise<FulfillmentDailyOverviewResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/fulfillment/daily-overview',
        userId: user._id,
        days: query.days,
      }),
    });
    const data = await this.taskService.getDailyOverview(user, {
      days: Number(query.days),
      from: query.from,
      to: query.to,
      stage: query.stage,
    });
    return { success: true, data } as unknown as FulfillmentDailyOverviewResDto;
  }
}
