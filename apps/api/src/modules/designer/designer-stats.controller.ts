import { ZodValidationPipe } from '@anatine/zod-nestjs';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Query, UsePipes } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import type { FulfillmentStage } from 'shared';
import {
  GetAssignBacklogDto,
  GetAssignBacklogResDto,
  GetBreakdownFiltersDto,
  GetBreakdownFiltersResDto,
  GetDailyOverviewDto,
  GetDailyOverviewResDto,
  GetDesignerPerformanceDto,
  GetDesignerPerformanceResDto,
  GetDesignerTimelineDto,
  GetDesignerTimelineResDto,
  GetErrorStatsDto,
  GetErrorStatsResDto,
  GetOverdueAlertResDto,
  GetPerformanceScoresDto,
  GetPerformanceScoresResDto,
  GetPersonErrorOrdersDto,
  GetPersonErrorOverviewDto,
  // GetProductBreakdownDto + GetProductBreakdownResDto — TẠM ẨN cùng endpoint
  // product-breakdown bên dưới, thêm lại khi bật lại.
  GetProductTimeOrdersDto,
  GetProductTimeOrdersResDto,
  GetProductTimeOverviewDto,
  GetProductTimeOverviewResDto,
  GetSidebarCountsResDto,
  GetStageErrorDailyDto,
  GetTeamDailyBreakdownDto,
  GetTeamDailyBreakdownResDto,
  GetToolCheckOverviewDto,
  PersonErrorOrdersResDto,
  PersonErrorOverviewResDto,
  RoleType,
  SetDesignerLevelDto,
  SetDesignerLevelResDto,
  StageErrorDailyResDto,
  ToolCheckOverviewResDto,
} from 'shared';
import { Logger } from 'winston';

import { Auth } from '@/decorators';

import { OrderService } from '../order/order.service';
import { UserDocument } from '../user/user.entity';
import { DesignerStatsService } from './designer-stats.service';

// Bao gồm cả Designer (sub) để sub-designer cũng xem được tab Dashboard
// Designer (thống kê toàn team) — gate FE qua perm `page.designer_stats`.
const LEADER_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.DesignerLeader,
  RoleType.Designer,
];

// Tab "Soát tool" — chỉ Support + quản lý/admin (không phải designer).
const TOOL_CHECK_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.SupportManager,
  RoleType.Support,
];

// Tab "Lỗi theo người" — quản lý (không mở cho sub-designer).
const PERSON_ERROR_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.DesignerLeader,
  RoleType.SupportManager,
];

// Bảng lỗi công đoạn — công nhân Fulfillment (khóa stage/xưởng của họ) + quản lý.
const STAGE_ERROR_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.SupportManager,
  RoleType.Fulfillment,
];

// Banner đỏ quá hạn 2 ngày — Admin/Support/Designer (+ cấp quản lý tương ứng)
// cùng thấy CHUNG số toàn hệ thống để thúc nhau xử lý (OverdueAlertBanner.md).
const OVERDUE_ALERT_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.SupportManager,
  RoleType.Support,
  RoleType.DesignerLeader,
  RoleType.Designer,
];

// Badge sidebar — mọi role nhân viên gọi được, từng số tự null theo quyền.
const SIDEBAR_COUNT_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.SupportManager,
  RoleType.Support,
  RoleType.DesignerLeader,
  RoleType.Designer,
  RoleType.Fulfillment,
];

@Controller()
@ApiTags('designer')
@UsePipes(ZodValidationPipe)
export class DesignerStatsController {
  constructor(
    private readonly statsService: DesignerStatsService,
    private readonly orderService: OrderService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  @Get('designer/sidebar-counts')
  @Auth(SIDEBAR_COUNT_ROLES)
  @ApiOperation({
    summary:
      'Badge sidebar: đơn lỗi cần xử lý (góc nhìn chặng viewer) + cần gán designer / tồn 7 ngày + soát tool cần làm lại / chưa soát. Số ngoài quyền role → null.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetSidebarCountsResDto })
  async getSidebarCounts(@AuthUser() user: UserDocument): Promise<GetSidebarCountsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/designer/sidebar-counts', userId: user._id }),
    });
    const roleName = user?.role?.name;
    const designerScope =
      !roleName || !LEADER_ROLES.includes(roleName) ? 'none' : roleName === RoleType.Designer ? 'self' : 'all';
    const includeToolCheck = !!roleName && TOOL_CHECK_ROLES.includes(roleName);
    const wantErrorLog = roleName !== RoleType.Support;
    const [counts, errorLogTodo, errorLogByFactory, toolCheckByFactory] = await Promise.all([
      this.statsService.getSidebarCounts({
        designerScope,
        includeToolCheck,
        userId: user?._id ? String(user._id) : undefined,
      }),
      // Support: tab Nhật ký bù lỗi bị ẩn (mirror hideForRoles FE) → null.
      wantErrorLog
        ? this.orderService.countErrorLogTodo(
            roleName,
            user?._id ? String(user._id) : undefined,
            user?.factoryId,
            user?.fulfillmentStage,
          )
        : Promise.resolve(null),
      // Badge cho cụm menu từng xưởng — cùng phạm vi role như 2 số tổng ở trên,
      // chỉ khác ở chỗ tách theo `factoryId`.
      wantErrorLog
        ? this.orderService.countErrorLogTodoByFactory(
            roleName,
            user?._id ? String(user._id) : undefined,
            user?.factoryId,
            user?.fulfillmentStage,
          )
        : Promise.resolve<Record<string, number>>({}),
      includeToolCheck
        ? this.statsService.getSidebarCountsByFactory()
        : Promise.resolve<Record<string, { toolCheckRework: number; toolCheckUnreviewed: number }>>({}),
    ]);

    const byFactory: Record<
      string,
      { errorLogTodo: number; toolCheckRework: number; toolCheckUnreviewed: number }
    > = {};
    const cell = (id: string) =>
      (byFactory[id] ||= { errorLogTodo: 0, toolCheckRework: 0, toolCheckUnreviewed: 0 });
    for (const [id, n] of Object.entries(errorLogByFactory)) cell(id).errorLogTodo = n;
    for (const [id, c] of Object.entries(toolCheckByFactory)) {
      const target = cell(id);
      target.toolCheckRework = c.toolCheckRework;
      target.toolCheckUnreviewed = c.toolCheckUnreviewed;
    }

    return { success: true, data: { errorLogTodo, ...counts, byFactory } };
  }

  @Get('designer/overdue-alert')
  @Auth(OVERDUE_ALERT_ROLES)
  @ApiOperation({
    summary:
      'Banner đỏ quá hạn 2 ngày: đơn inProductionAt từ 2 ngày trước về trước còn chưa soát tool / chưa gán / designer chưa xong (kèm breakdown theo designer). Số toàn hệ thống, mọi role thấy như nhau.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetOverdueAlertResDto })
  async getOverdueAlert(@AuthUser() user: UserDocument): Promise<GetOverdueAlertResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/designer/overdue-alert', userId: user._id }),
    });
    return { success: true, data: await this.statsService.getOverdueAlert() };
  }

  @Get('designer/performance')
  @Auth(LEADER_ROLES)
  @ApiOperation({ summary: 'Leaderboard per-designer trong period (count + avg + errorRate)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetDesignerPerformanceResDto })
  async getPerformance(
    @Query() query: GetDesignerPerformanceDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetDesignerPerformanceResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/designer/performance', userId: user._id }),
    });
    const data = await this.statsService.getPerformance(query.from, query.to, query.userId);
    return { success: true, data };
  }

  @Get('designer/timeline/:userId')
  @Auth(LEADER_ROLES)
  @ApiOperation({ summary: 'Per-day buckets (4 series) cho line chart timeline của 1 designer' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetDesignerTimelineResDto })
  async getTimeline(
    @Param('userId') userId: string,
    @Query() query: GetDesignerTimelineDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetDesignerTimelineResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: `/designer/timeline/${userId}`,
        userId: user._id,
      }),
    });
    const data = await this.statsService.getTimeline(userId, query.from, query.to);
    return { success: true, data };
  }

  @Get('designer/team-daily-breakdown')
  @Auth(LEADER_ROLES)
  @ApiOperation({
    summary: 'Ma trận Designer × Ngày (inProductionAt, 7/14/30) — MỌI designer theo trạng thái, focus đơn chưa xong.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetTeamDailyBreakdownResDto })
  async getTeamDailyBreakdown(
    @Query() query: GetTeamDailyBreakdownDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetTeamDailyBreakdownResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/designer/team-daily-breakdown',
        userId: user._id,
        days: query.days,
      }),
    });
    const data = await this.statsService.getTeamDailyBreakdown(
      Number(query.days),
      query.from,
      query.to,
      query.type,
      query.customer,
    );
    return { success: true, data };
  }

  @Get('designer/performance-scores')
  @Auth(LEADER_ROLES)
  @ApiOperation({
    summary: 'Bảng xếp hạng hiệu suất: điểm 0-100 + hạng S/A/B/C/D + trend + hạng gợi ý 60 ngày.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetPerformanceScoresResDto })
  async getPerformanceScores(
    @Query() query: GetPerformanceScoresDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetPerformanceScoresResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/designer/performance-scores', userId: user._id }),
    });
    const data = await this.statsService.getPerformanceScores(query.from, query.to);
    return { success: true, data };
  }

  @Patch('designer/level/:userId')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Set/xóa level chính thức (S-D) cho 1 designer — Admin/SuperAdmin.' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SetDesignerLevelResDto })
  async setDesignerLevel(
    @Param('userId') userId: string,
    @Body() body: SetDesignerLevelDto,
    @AuthUser() user: UserDocument,
  ): Promise<SetDesignerLevelResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'PATCH',
        url: `/designer/level/${userId}`,
        userId: user._id,
        level: body.level,
      }),
    });
    const data = await this.statsService.setDesignerLevel(userId, body.level);
    return { success: true, data };
  }

  @Get('designer/product-time-overview')
  @Auth(LEADER_ROLES)
  @ApiOperation({
    summary: 'Thời gian TB nhận/làm task theo từng loại sản phẩm — panel "Xem tất cả" của widget Top Designer.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductTimeOverviewResDto })
  async getProductTimeOverview(
    @Query() query: GetProductTimeOverviewDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetProductTimeOverviewResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/designer/product-time-overview',
        userId: user._id,
      }),
    });
    const data = await this.statsService.getProductTimeOverview(
      query.from,
      query.to,
      query.type,
      query.customer,
      query.designerId,
    );
    return { success: true, data };
  }

  @Get('designer/product-time-orders')
  @Auth(LEADER_ROLES)
  @ApiOperation({
    summary: 'Danh sách đơn/thiết kế của 1 loại sản phẩm trong kỳ — drill từ panel "Xem tất cả".',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductTimeOrdersResDto })
  async getProductTimeOrders(
    @Query() query: GetProductTimeOrdersDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetProductTimeOrdersResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/designer/product-time-orders',
        userId: user._id,
        type: query.type,
      }),
    });
    const data = await this.statsService.getProductTimeOrders(
      query.type,
      query.from,
      query.to,
      query.customer,
      query.designerId,
    );
    return { success: true, data };
  }

  @Get('designer/breakdown-filters')
  @Auth(LEADER_ROLES)
  @ApiOperation({
    summary: 'Option list cho 2 dropdown filter (sản phẩm + khách hàng) của tab Designer — theo kỳ lọc from/to.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetBreakdownFiltersResDto })
  async getBreakdownFilters(
    @Query() query: GetBreakdownFiltersDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetBreakdownFiltersResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/designer/breakdown-filters', userId: user._id }),
    });
    const data = await this.statsService.getBreakdownFilters(query.from, query.to);
    return { success: true, data };
  }

  @Get('designer/daily-overview')
  @Auth(LEADER_ROLES)
  @ApiOperation({
    summary: 'Bảng tổng quan N ngày: tổng đơn / chưa soát / lỗi (+breakdown note) / tồn (+per-designer).',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetDailyOverviewResDto })
  async getDailyOverview(
    @Query() query: GetDailyOverviewDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetDailyOverviewResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/designer/daily-overview',
        userId: user._id,
        days: query.days,
      }),
    });
    const data = await this.statsService.getDailyOverview(
      Number(query.days),
      query.type,
      query.customer,
      query.from,
      query.to,
    );
    return { success: true, data };
  }

  @Get('designer/assign-backlog')
  @Auth(LEADER_ROLES)
  @ApiOperation({
    summary: 'Đơn cần gán designer (unassigned/rejected/rework-chưa-ôm, note ≠ ok) gom theo sản phẩm.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetAssignBacklogResDto })
  async getAssignBacklog(
    @Query() query: GetAssignBacklogDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetAssignBacklogResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/designer/assign-backlog',
        userId: user._id,
        days: query.days,
      }),
    });
    const data = await this.statsService.getAssignBacklog(
      Number(query.days),
      query.type,
      query.customer,
      query.from,
      query.to,
    );
    return { success: true, data };
  }

  // ─── TẠM ẨN (2026-07): endpoint tooltip breakdown sản phẩm CHỈ phục vụ khối
  // "Cơ cấu trạng thái" (`StatusBarCharts.tsx`) đã comment ở FE
  // (`DesignerStatsTab.tsx`) → comment theo. Service `getProductBreakdown()` +
  // DTOs shared giữ nguyên. Bật lại: bỏ comment block dưới + thêm lại
  // `GetProductBreakdownDto`/`GetProductBreakdownResDto` vào import 'shared'
  // + bỏ comment import/render StatusBarCharts ở FE. ───
  // @Get('designer/product-breakdown')
  // @Auth(LEADER_ROLES)
  // @ApiOperation({
  //   summary: 'Breakdown sản phẩm theo từng designer (số đơn/sản phẩm + level + mockup) cho tooltip.',
  // })
  // @HttpCode(HttpStatus.OK)
  // @ApiOkResponse({ type: GetProductBreakdownResDto })
  // async getProductBreakdown(
  //   @Query() query: GetProductBreakdownDto,
  //   @AuthUser() user: UserDocument,
  // ): Promise<GetProductBreakdownResDto> {
  //   this.logger.info({
  //     message: JSON.stringify({
  //       method: 'GET',
  //       url: '/designer/product-breakdown',
  //       userId: user._id,
  //       days: query.days,
  //     }),
  //   });
  //   const data = await this.statsService.getProductBreakdown(
  //     Number(query.days),
  //     query.type,
  //     query.customer,
  //     query.from,
  //     query.to,
  //   );
  //   return { success: true, data };
  // }

  @Get('designer/tool-check-overview')
  @Auth(TOOL_CHECK_ROLES)
  @ApiOperation({
    summary: 'Tab Soát tool (Support/Admin): đơn In trả về + đơn chưa soát + thống kê lỗi theo sản phẩm/khách.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ToolCheckOverviewResDto })
  async getToolCheckOverview(
    @Query() query: GetToolCheckOverviewDto,
    @AuthUser() user: UserDocument,
  ): Promise<ToolCheckOverviewResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/designer/tool-check-overview',
        userId: user._id,
        days: query.days,
        productLine: query.productLine,
      }),
    });
    const data = await this.statsService.getToolCheckOverview(
      Number(query.days),
      query.type,
      query.customer,
      query.from,
      query.to,
      query.machineNumber,
      query.priority,
      query.productLine,
    );
    return { success: true, data };
  }

  @Get('orders/error-stats')
  @Auth(LEADER_ROLES)
  @ApiOperation({
    summary: 'Production error split by errorSource (designer vs factory) + breakdown per code',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetErrorStatsResDto })
  async getErrorStats(@Query() query: GetErrorStatsDto, @AuthUser() user: UserDocument): Promise<GetErrorStatsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/orders/error-stats', userId: user._id }),
    });
    const data = await this.statsService.getErrorStats(query.from, query.to);
    return { success: true, data };
  }

  @Get('designer/person-error-overview')
  @Auth(PERSON_ERROR_ROLES)
  @ApiOperation({
    summary: 'Lỗi theo người (2 chiều): đang cần fix (bị quy lỗi) + đã báo lỗi trong kỳ.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PersonErrorOverviewResDto })
  async getPersonErrorOverview(
    @Query() query: GetPersonErrorOverviewDto,
    @AuthUser() user: UserDocument,
  ): Promise<PersonErrorOverviewResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/designer/person-error-overview', userId: user._id }),
    });
    const data = await this.statsService.getPersonErrorOverview(query.from, query.to, query.days, query.factoryId);
    return { success: true, data };
  }

  @Get('designer/person-error-orders')
  @Auth(PERSON_ERROR_ROLES)
  @ApiOperation({ summary: 'Drill-down: đơn lỗi đang cần 1 người sửa.' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PersonErrorOrdersResDto })
  async getPersonErrorOrders(
    @Query() query: GetPersonErrorOrdersDto,
    @AuthUser() user: UserDocument,
  ): Promise<PersonErrorOrdersResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/designer/person-error-orders', userId: user._id }),
    });
    const { data, total } = await this.statsService.getPersonErrorOrders(
      query.userId,
      query.from,
      query.to,
      query.days,
    );
    return { success: true, data: data as PersonErrorOrdersResDto['data'], total };
  }

  @Get('fulfillment/stage-error-daily')
  @Auth(STAGE_ERROR_ROLES)
  @ApiOperation({ summary: 'Bảng lỗi theo ngày (inProductionAt) cho 1 công đoạn fulfillment.' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: StageErrorDailyResDto })
  async getStageErrorDaily(
    @Query() query: GetStageErrorDailyDto,
    @AuthUser() user: UserDocument,
  ): Promise<StageErrorDailyResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/fulfillment/stage-error-daily', userId: user._id }),
    });
    // Worker Fulfillment: khóa theo stage + xưởng của chính họ. Admin/Manager: theo query.
    const isOverride = [RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.SupportManager].includes(
      user.role?.name as RoleType,
    );
    const stage = (isOverride ? query.stage : user.fulfillmentStage) ?? query.stage;
    const factoryId = isOverride ? query.factoryId : user.factoryId;
    const data = await this.statsService.getStageErrorDaily(
      stage as FulfillmentStage,
      factoryId,
      query.from,
      query.to,
      query.days,
    );
    return { success: true, data };
  }
}
