import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import {
  ApplyCuttingFilesDto,
  ApplyCuttingFilesResDto,
  AutoAssignApplyDto,
  AutoAssignApplyResDto,
  AutoAssignPreviewDto,
  AutoAssignPreviewResDto,
  BulkAssignDesignerDto,
  BulkAssignDesignerPreviewDto,
  BulkAssignDesignerPreviewResDto,
  BulkAssignDesignerResDto,
  BulkAssignOrderDto,
  BulkAssignOrderResDto,
  BulkCheckOrderDesignDto,
  BulkCheckOrderDesignResDto,
  BulkHoldOrderDto,
  BulkHoldOrderResDto,
  BulkResolveErrorDto,
  BulkResolveErrorResDto,
  BulkTransferOrderDto,
  BulkUpdateOrderFieldDto,
  BulkUpdateOrderFieldResDto,
  CancelOrderDto,
  CancelOrderResDto,
  CheckOrderDesignResDto,
  ClaimDesignerTasksDto,
  DesignerBacklogResDto,
  DesignerBreakdownResDto,
  ForceCompleteOrderResDto,
  FulfillmentStatusCountsResDto,
  GetBarcodeLabelsDto,
  GetBarcodeLabelsResDto,
  GetShippingLabelsDto,
  GetShippingLabelsResDto,
  GetCancelledOrdersDto,
  GetCancelledOrdersResDto,
  GetDesignReviewErrorFileOptionsResDto,
  GetDesignReviewOrderByIdResDto,
  GetErrorLogDto,
  GetErrorLogResDto,
  GetFactoryOverviewDto,
  GetFactoryOverviewResDto,
  GetGroupedProductionOrdersResDto,
  GetImportSummaryDto,
  GetImportSummaryResDto,
  GetLifecycleOverviewDto,
  GetLifecycleOverviewResDto,
  GetLifecycleTrackResDto,
  GetNextDesignReviewOrderDto,
  GetNextDesignReviewOrderResDto,
  GetOrderByProductionIdResDto,
  GetOrderDashboardDto,
  GetOrderDashboardResDto,
  GetOrderLogsDto,
  GetOrderLogsResDto,
  GetOrderStatusOverviewDto,
  GetOrderStatusOverviewResDto,
  GetProductionOrdersDto,
  GetProductionOrdersResDto,
  HoldOrderDto,
  HoldOrderResDto,
  ImportFromOnosPodDto,
  ImportFromOnosPodResDto,
  ImportProductionOrdersDto,
  ImportProductionOrdersResDto,
  ImportReworkOrdersDto,
  ImportReworkOrdersResDto,
  PreviewCuttingFilesDto,
  PreviewCuttingFilesResDto,
  RecoverHeldOrdersResDto,
  RemapUnmappedOrdersResDto,
  ResDto,
  RoleType,
  SetDesignReviewResultDto,
  SetDesignReviewResultResDto,
  SetProductionErrorDto,
  SetProductionErrorResDto,
  SyncDesignByCustomerDto,
  SyncDesignByCustomerResDto,
  SyncOnospodHoldResDto,
  ToolCheckDoneResDto,
  TransferOrderDto,
  TransferOrderResDto,
  UpdateOrderDesignDto,
  UpdateOrderDesignResDto,
  UpdateOrderFieldDto,
  UpdateOrderFieldResDto,
  WorkshopAvailableFiltersResDto,
} from 'shared';
import { Logger } from 'winston';

import { Auth, ClientIp, UserAgent } from '@/decorators';

import type { UserDocument } from '../user/user.entity';
import { OnospodHoldSyncService } from './onospod-hold-sync.service';
import { OnospodImportService } from './onospod-import.service';
import { OrderService } from './order.service';

const ORDER_VIEW_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.Support,
  RoleType.DesignerLeader,
  RoleType.Designer,
  RoleType.Fulfillment,
];

const ORDER_WRITE_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.Support,
  RoleType.DesignerLeader,
  RoleType.Fulfillment,
];

/**
 * Role gate cho các endpoint edit field (route-level). Whitelist rộng — service
 * sẽ check tiếp field-by-field qua `assertCanEditField()` (ưu tiên
 * `role.permissionCodes`, fallback `FIELD_EDIT_ROLES` map). Tức là Support
 * vào được endpoint nhưng chỉ edit được field nào có `order.field.<X>.edit`
 * trong `role.permissionCodes` (Admin enable qua UI Roles).
 */
const ORDER_FIELD_EDIT_ROLES = [
  RoleType.SuperAdmin,
  RoleType.Admin,
  RoleType.Manager,
  RoleType.DesignerLeader,
  RoleType.Designer,
  RoleType.Fulfillment,
  RoleType.Support,
  RoleType.SupportManager,
];

@Controller('orders')
@ApiTags('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly onospodImportService: OnospodImportService,
    private readonly onospodHoldSyncService: OnospodHoldSyncService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  @Get()
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'List production orders' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductionOrdersResDto })
  async getOrders(
    @Query() dto: GetProductionOrdersDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetProductionOrdersResDto> {
    return this.orderService.getOrders(
      dto,
      user?.role?.name,
      user?._id ? String(user._id) : undefined,
      user?.factoryId,
      user?.fulfillmentStage,
    );
  }

  @Get('dashboard')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'Order dashboard with per-type breakdown' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetOrderDashboardResDto })
  async getDashboard(
    @Query() dto: GetOrderDashboardDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetOrderDashboardResDto> {
    return this.orderService.getDashboard(dto, user?.role?.name, user?.fulfillmentStage, user?.factoryId);
  }

  @Get('status-overview')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'Status counts + per-field breakdown for dashboard tab B' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetOrderStatusOverviewResDto })
  async getStatusOverview(
    @Query() dto: GetOrderStatusOverviewDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetOrderStatusOverviewResDto> {
    return this.orderService.getStatusOverview(
      dto,
      user?.role?.name,
      user?._id ? String(user._id) : undefined,
      user?.factoryId,
      user?.fulfillmentStage,
    );
  }

  @Get('grouped')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary: 'List orders grouped by product type — pagination unit = product (no row split)',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetGroupedProductionOrdersResDto })
  async getOrdersGrouped(
    @Query() dto: GetProductionOrdersDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetGroupedProductionOrdersResDto> {
    return this.orderService.getOrdersGroupedByType(
      dto,
      user?.role?.name,
      user?._id ? String(user._id) : undefined,
      user?.factoryId,
      user?.fulfillmentStage,
    );
  }

  @Get('by-ids')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'Lookup đơn theo danh sách _id (không scoping role) — drill-down dashboard' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductionOrdersResDto })
  async getOrdersByIds(@Query() dto: GetProductionOrdersDto): Promise<GetProductionOrdersResDto> {
    const ids = (dto.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.orderService.getOrdersByIds(ids, dto.page, dto.limit);
  }

  /**
   * POST chứ không GET: 500 id × 16 ký tự là ~8.5KB query string — quá trần URL
   * của một số proxy; body giữ nguyên mảng, khỏi nối chuỗi dấu phẩy.
   */
  @Post('barcode-labels')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary: 'Dữ liệu tem barcode xưởng theo danh sách _id — nút "In tem barcode" ở thanh bulk (Orders.md §16.7)',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetBarcodeLabelsResDto })
  async getBarcodeLabels(
    @Body() dto: GetBarcodeLabelsDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetBarcodeLabelsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/orders/barcode-labels', userId: user._id, count: dto.ids.length }),
    });
    return { success: true, data: await this.orderService.getBarcodeLabels(dto.ids) };
  }

  /**
   * `@Auth([])` chứ KHÔNG `ORDER_VIEW_ROLES` — theo chốt nghiệp vụ label giao
   * hàng in được ở MỌI công đoạn bởi MỌI role đăng nhập (Designer/Fulfillment/
   * Support...). Chỉ đọc, không đổi gì trên đơn. POST vì cùng lý do trần URL
   * với `barcode-labels` ở trên.
   */
  @Post('shipping-labels')
  @Auth([])
  @ApiOperation({
    summary: 'Dữ liệu label giao hàng 4×6in theo danh sách _id — menu "..." + thanh bulk (Orders.md §16.8)',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetShippingLabelsResDto })
  async getShippingLabels(
    @Body() dto: GetShippingLabelsDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetShippingLabelsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/orders/shipping-labels', userId: user._id, count: dto.ids.length }),
    });
    return { success: true, data: await this.orderService.getShippingLabels(dto.ids) };
  }

  @Get('overview-list')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary:
      'List đơn cho drill-down dashboard — KHÔNG áp visibility filter theo role (mọi role thấy CÙNG tập đơn khớp con số; cột hiển thị vẫn lọc theo quyền ở FE). Khác GET /orders (scoping assignee/factory theo role).',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductionOrdersResDto })
  async getOverviewList(@Query() dto: GetProductionOrdersDto): Promise<GetProductionOrdersResDto> {
    // roleName = undefined → buildVisibilityFilter bỏ qua scoping Designer/Fulfillment,
    // chỉ giữ filter tường minh (date range + toolResultNote + assignee/designerStatus…).
    return this.orderService.getOrders(dto);
  }

  @Get('workshop-filters')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary: 'Aggregate workshop dropdown options + count theo cross-facet pattern',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkshopAvailableFiltersResDto })
  async getWorkshopFilters(
    @Query() dto: GetProductionOrdersDto,
    @AuthUser() user: UserDocument,
  ): Promise<WorkshopAvailableFiltersResDto> {
    return this.orderService.getWorkshopAvailableFilters(
      dto,
      user?.role?.name,
      user?._id ? String(user._id) : undefined,
      user?.factoryId,
      user?.fulfillmentStage,
    );
  }

  @Get('fulfillment-status-counts')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'Đếm đơn theo 5 trạng thái stage Fulfillment (bảng trang In)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FulfillmentStatusCountsResDto })
  async getFulfillmentStatusCounts(
    @Query() dto: GetProductionOrdersDto,
    @AuthUser() user: UserDocument,
  ): Promise<FulfillmentStatusCountsResDto> {
    return this.orderService.getFulfillmentStatusCounts(
      dto,
      user?.role?.name,
      user?._id ? String(user._id) : undefined,
      user?.factoryId,
      user?.fulfillmentStage,
    );
  }

  @Get('import-summary')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: "Aggregate today's imported orders by (type, size, fabric)" })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetImportSummaryResDto })
  async getImportSummary(@Query() dto: GetImportSummaryDto): Promise<GetImportSummaryResDto> {
    return this.orderService.getImportSummary(dto);
  }

  @Post('backfill-fabric')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Re-derive order.fabricType from productConfig — for orders missing fabric',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ResDto })
  async backfillOrderFabric(): Promise<{ success: true; data: { scanned: number; updated: number } }> {
    const result = await this.orderService.backfillOrderFabric();
    return { success: true, data: result };
  }

  @Post('check-pending')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary: 'Poll subset of orders for designsStatus updates (R2 pipeline)',
  })
  @HttpCode(HttpStatus.OK)
  async checkPendingDesigns(@Body() body: { ids?: string[] }): Promise<{
    success: true;
    data: Array<{ _id: string; designs?: Record<string, string>; designsStatus?: Record<string, string> }>;
  }> {
    const result = await this.orderService.checkPendingDesigns(body?.ids || []);
    return { success: true, data: result };
  }

  @Get('export')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'Return ALL orders matching filter (no pagination) for spreadsheet export' })
  @HttpCode(HttpStatus.OK)
  async exportOrders(@Query() dto: GetProductionOrdersDto, @AuthUser() user: UserDocument) {
    return this.orderService.exportOrders(
      dto,
      user?.role?.name,
      user?._id ? String(user._id) : undefined,
      user?.factoryId,
    );
  }

  @Get('factory-overview')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'Factory transfer dashboard — totals + flow matrix' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetFactoryOverviewResDto })
  async getFactoryOverview(
    @Query() dto: GetFactoryOverviewDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetFactoryOverviewResDto> {
    return this.orderService.getFactoryOverview(dto, user?.role?.name, user?.factoryId, user?.fulfillmentStage);
  }

  @Get('lifecycle-overview')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary: 'Vòng đời đơn — phễu 10 chặng (soát tool → thiết kế → 8 stage fulfillment). Fulfillment khóa theo xưởng.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetLifecycleOverviewResDto })
  async getLifecycleOverview(
    @Query() dto: GetLifecycleOverviewDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetLifecycleOverviewResDto> {
    return this.orderService.getLifecycleOverview(dto, user?.role?.name, user?.factoryId);
  }

  @Get('cancelled-list')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary: 'Danh sách đơn HỦY (drill-down thống kê Dashboard). Scope xưởng + khoảng inProductionAt như dashboard.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetCancelledOrdersResDto })
  async getCancelledOrders(
    @Query() dto: GetCancelledOrdersDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetCancelledOrdersResDto> {
    return this.orderService.getCancelledOrders(dto, user?.role?.name, user?.factoryId);
  }

  @Get('lifecycle-track/:code')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'Tra cứu vòng đời 1 đơn theo productionId (strip Dashboard). Fulfillment khóa theo xưởng.' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetLifecycleTrackResDto })
  async getLifecycleTrack(
    @Param('code') code: string,
    @AuthUser() user: UserDocument,
  ): Promise<GetLifecycleTrackResDto> {
    return this.orderService.getLifecycleTrack(
      code,
      user?.role?.name,
      user?.factoryId,
    ) as Promise<GetLifecycleTrackResDto>;
  }

  @Patch('bulk-transfer')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Transfer multiple orders to another factory' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TransferOrderResDto })
  async bulkTransferOrders(
    @Body() dto: BulkTransferOrderDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<TransferOrderResDto> {
    return this.orderService.bulkTransferOrders(dto, { user, ip, userAgent });
  }

  @Patch('bulk-assign')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Initial-assign factory + optional setup fields cho đơn UNMAPPED',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkAssignOrderResDto })
  async bulkAssignOrders(
    @Body() dto: BulkAssignOrderDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkAssignOrderResDto> {
    return this.orderService.bulkAssignOrders(dto, { user, ip, userAgent });
  }

  @Post('remap-unmapped')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Re-map toàn bộ đơn unmapped theo Product Config hiện tại (nút "Tự động gán xưởng")',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RemapUnmappedOrdersResDto })
  async remapUnmappedOrders(
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<RemapUnmappedOrdersResDto> {
    return { success: true, data: await this.orderService.remapUnmappedOrders({ user, ip, userAgent }) };
  }

  @Patch(':id/transfer')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Transfer a single order to another factory' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TransferOrderResDto })
  async transferOrder(
    @Param('id') id: string,
    @Body() dto: TransferOrderDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<TransferOrderResDto> {
    return this.orderService.transferOrder(id, dto, { user, ip, userAgent });
  }

  @Post(':id/cancel')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Hủy đơn (soft) — chỉ khi chưa bắt đầu in. Admin only.' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CancelOrderResDto })
  async cancelOrder(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<CancelOrderResDto> {
    const data = await this.orderService.cancelOrder(id, dto, user.role?.name as RoleType, {
      user,
      ip,
      userAgent,
    });
    return { success: true, data } as unknown as CancelOrderResDto;
  }

  @Post(':id/force-complete')
  @Auth([RoleType.SuperAdmin])
  @ApiOperation({
    summary:
      'Chuyển hoàn thành — ép đơn về đã hoàn thành sản xuất, khâu chưa xong được chia đều mốc từ lúc vào sản xuất tới lúc bấm. SuperAdmin only.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ForceCompleteOrderResDto })
  async forceCompleteOrder(
    @Param('id') id: string,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<ForceCompleteOrderResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: `/orders/${id}/force-complete`, userId: user?._id }),
    });
    return this.orderService.forceCompleteOrder(id, user?.role?.name as RoleType, { user, ip, userAgent });
  }

  @Patch('bulk-hold')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Giữ / mở giữ nhiều đơn cùng lúc' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkHoldOrderResDto })
  async bulkSetHold(
    @Body() dto: BulkHoldOrderDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkHoldOrderResDto> {
    return this.orderService.bulkSetHold(dto, user?.role?.name as RoleType, { user, ip, userAgent });
  }

  @Post(':id/hold')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Giữ đơn (tạm dừng — khóa mọi thao tác tới khi mở lại)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HoldOrderResDto })
  async holdOrder(
    @Param('id') id: string,
    @Body() dto: HoldOrderDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<HoldOrderResDto> {
    return this.orderService.holdOrder(id, dto, user?.role?.name as RoleType, { user, ip, userAgent });
  }

  @Post(':id/unhold')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Mở giữ đơn (tiếp tục hoàn thành)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HoldOrderResDto })
  async unholdOrder(
    @Param('id') id: string,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<HoldOrderResDto> {
    return this.orderService.unholdOrder(id, user?.role?.name as RoleType, { user, ip, userAgent });
  }

  // Nút thủ công "Kiểm tra design mới" (Danh sách đơn, action menu từng
  // hàng) — ép tra OnosPod cho 1 đơn bất kỳ, dùng chung logic với cron
  // recover-held-from-onospod (Orders.md §9c) nhưng KHÔNG yêu cầu đơn đang
  // giữ.
  @Post(':id/check-design-from-onospod')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Kiểm tra design mới từ OnosPod cho 1 đơn (thủ công, không cần đang giữ)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CheckOrderDesignResDto })
  async checkOrderDesignFromOnospod(
    @Param('id') id: string,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<CheckOrderDesignResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/orders/:id/check-design-from-onospod',
        id,
        userId: user?._id,
        ip,
        userAgent,
      }),
    });
    return this.orderService.checkOrderDesignFromOnospod(id, { user, ip, userAgent });
  }

  // Nút "Kiểm tra design mới" bản HÀNG LOẠT (bulk toolbar, các đơn ĐANG TICK
  // CHỌN ở Danh sách đơn) — CÙNG logic check-design-from-onospod (reset
  // toolResult/toolResultNote + forceUnhold) áp cho từng đơn trong `ids`.
  @Patch('bulk-check-design-from-onospod')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Kiểm tra design mới từ OnosPod cho nhiều đơn (bulk, các đơn đang tick chọn)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkCheckOrderDesignResDto })
  async bulkCheckOrderDesignFromOnospod(
    @Body() dto: BulkCheckOrderDesignDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkCheckOrderDesignResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'PATCH',
        url: '/orders/bulk-check-design-from-onospod',
        ids: dto.ids,
        userId: user?._id,
        ip,
        userAgent,
      }),
    });
    return this.orderService.bulkCheckOrderDesignFromOnospod(dto.ids, { user, ip, userAgent });
  }

  // Nút thủ công "Đồng bộ design theo mã khách hàng" — truyền `userSku`, tìm
  // TOÀN BỘ đơn của khách để tra lại OnosPod, CHỈ cập nhật designs (KHÔNG
  // reset toolResult, KHÔNG đụng heldAt như check-design-from-onospod).
  @Get('design-sync-by-customer')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Đồng bộ lại design từ OnosPod cho TOÀN BỘ đơn của 1 mã khách hàng (thủ công)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SyncDesignByCustomerResDto })
  async syncDesignByCustomer(
    @Query() dto: SyncDesignByCustomerDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<SyncDesignByCustomerResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/orders/design-sync-by-customer',
        userSku: dto.userSku,
        userId: user?._id,
        ip,
        userAgent,
      }),
    });
    return this.orderService.syncDesignByCustomer(dto.userSku, { user, ip, userAgent });
  }

  @Post(':id/tool-check-done')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.SupportManager, RoleType.Support])
  @ApiOperation({
    summary:
      'Soát xong đơn In trả về (tool-check hold) — cần thiết kế: về designer cũ (rework) hoặc auto-gán / backlog "Cần gán"',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ToolCheckDoneResDto })
  async markToolCheckDone(
    @Param('id') id: string,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<ToolCheckDoneResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: `/orders/${id}/tool-check-done`, userId: user._id }),
    });
    return this.orderService.markToolCheckDone(id, { user, ip, userAgent });
  }

  @Patch(':id/design')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Đổi URL mockup/design. Admin only.' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UpdateOrderDesignResDto })
  async updateOrderDesign(
    @Param('id') id: string,
    @Body() dto: UpdateOrderDesignDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<UpdateOrderDesignResDto> {
    const data = await this.orderService.updateOrderDesign(id, dto, user.role?.name as RoleType, {
      user,
      ip,
      userAgent,
    });
    return { success: true, data } as unknown as UpdateOrderDesignResDto;
  }

  @Post('import')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Bulk import production orders' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImportProductionOrdersResDto })
  async importOrders(
    @Body() dto: ImportProductionOrdersDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<ImportProductionOrdersResDto> {
    return this.orderService.importOrders(dto, { user, ip, userAgent });
  }

  @Post('import-rework')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Import file soát — UPDATE đơn hiện có theo productionId' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImportReworkOrdersResDto })
  async importRework(
    @Body() dto: ImportReworkOrdersDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<ImportReworkOrdersResDto> {
    return this.orderService.importRework(dto, { user, ip, userAgent });
  }

  @Post('import-from-onospod')
  @Auth(ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Fetch production export từ OnosPod QC rồi import đơn (thay thao tác export/paste thủ công)',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImportFromOnosPodResDto })
  async importFromOnosPod(
    @Body() dto: ImportFromOnosPodDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<ImportFromOnosPodResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/orders/import-from-onospod', userId: user._id, body: dto }),
    });
    return this.onospodImportService.importFromOnosPod(dto, { user, ip, userAgent });
  }

  // Public — không cần JWT, để external crontab (curl) gọi trực tiếp không
  // phải config token/env. Period tự tính theo giờ gọi (resolvePeriod()):
  // trước 12h trưa → từ 12h trưa hôm trước; từ 12h trưa → từ 00h00 hôm nay.
  @Get('import-from-onospod/cron')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: '[Public] Endpoint cho external crontab gọi tự động import đơn từ OnosPod' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ImportFromOnosPodResDto })
  async importFromOnosPodCron(
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<ImportFromOnosPodResDto> {
    // Endpoint public không định danh — log ip/userAgent làm audit trace duy nhất.
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/orders/import-from-onospod/cron', ip, userAgent }),
    });
    return this.onospodImportService.importFromOnosPod({}, { ip, userAgent });
  }

  // Public — cron đồng bộ trạng thái GIỮ theo OnosPod (item MRP "On Hold").
  // Giữ đơn chưa xong, nhả đơn do đồng bộ giữ khi OnosPod nhả. Lỗi/nghi ngờ →
  // `status='aborted'`, không ghi gì. Xem Orders.md §9d. Lịch khuyến nghị 10 phút.
  @Get('onospod-hold-sync/cron')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: '[Public] Cron: đồng bộ giữ/nhả đơn theo trạng thái On Hold bên OnosPod' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SyncOnospodHoldResDto })
  async onospodHoldSyncCron(
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<SyncOnospodHoldResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/orders/onospod-hold-sync/cron', ip, userAgent }),
    });
    return { success: true, data: await this.onospodHoldSyncService.sync({ ip, trigger: 'cron' }) };
  }

  // Public — cron riêng, tách khỏi import-from-onospod/cron ở trên. Quét đơn
  // đang GIỮ lý do "chờ khách cập nhật" (design/địa chỉ), tự lấy ngược từ
  // OnosPod + mở giữ nếu khách đã cập nhật. Xem Orders.md §9c.
  @Get('recover-held-from-onospod/cron')
  @Auth([], [], { public: true })
  @ApiOperation({
    summary: '[Public] Cron: lấy ngược design/địa chỉ ship từ OnosPod cho đơn đang giữ chờ khách cập nhật',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RecoverHeldOrdersResDto })
  async recoverHeldFromOnospodCron(
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<RecoverHeldOrdersResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/orders/recover-held-from-onospod/cron', ip, userAgent }),
    });
    return this.orderService.recoverHeldOrders({ ip, userAgent });
  }

  // ─── Cutting File Mapping (post-import) ──────────────────────────
  // Permission: Support + Admin + Manager (theo confirm với user — gọn hơn
  // ORDER_WRITE_ROLES vì designer/fulfill không cần map file cutting).
  @Post('cutting-files/preview')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'Preview cutting-file mapping — fetch tên file từ Drive + match đơn' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PreviewCuttingFilesResDto })
  async previewCuttingFiles(
    @Body() dto: PreviewCuttingFilesDto,
    @AuthUser() _user: UserDocument,
  ): Promise<PreviewCuttingFilesResDto> {
    return this.orderService.previewCuttingFiles(dto);
  }

  @Post('cutting-files/apply')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'Apply cutting-file mappings (bulk write + audit log)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ApplyCuttingFilesResDto })
  async applyCuttingFiles(
    @Body() dto: ApplyCuttingFilesDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<ApplyCuttingFilesResDto> {
    return this.orderService.applyCuttingFiles(dto, { user, ip, userAgent });
  }

  @Patch('bulk-field')
  @Auth(ORDER_FIELD_EDIT_ROLES)
  @ApiOperation({ summary: 'Bulk update a workshop field on multiple orders' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkUpdateOrderFieldResDto })
  async bulkUpdateField(
    @Body() dto: BulkUpdateOrderFieldDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkUpdateOrderFieldResDto> {
    return this.orderService.bulkUpdateField(
      dto,
      user?.role?.name,
      { user, ip, userAgent },
      user?.role?.permissionCodes,
    );
  }

  @Get('designer-breakdown')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.DesignerLeader])
  @ApiOperation({
    summary: 'Designer KPI + matrix per-user theo filter hiện tại + overall baseline. Cho Admin/Leader.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DesignerBreakdownResDto })
  async getDesignerBreakdown(
    @Query() dto: GetProductionOrdersDto,
    @AuthUser() user: UserDocument,
  ): Promise<DesignerBreakdownResDto> {
    return this.orderService.getDesignerBreakdown(dto, user?.role?.name, user?.factoryId);
  }

  @Get('designer-backlog')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.DesignerLeader])
  @ApiOperation({
    summary: 'Backlog tồn đọng (đơn chưa done) theo Designer × Ngày vào sản xuất — mọi ngày. Cho Admin/Leader.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DesignerBacklogResDto })
  async getDesignerBacklog(@AuthUser() user: UserDocument): Promise<DesignerBacklogResDto> {
    return this.orderService.getDesignerBacklog(user?.role?.name, user?.factoryId);
  }

  @Get('error-log')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary: 'Nhật ký bù lỗi — đơn đang lỗi xưởng, sort theo thời gian lỗi cũ nhất; áp dụng visibility theo role.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetErrorLogResDto })
  async getErrorLog(@Query() dto: GetErrorLogDto, @AuthUser() user: UserDocument): Promise<GetErrorLogResDto> {
    return this.orderService.getErrorLog(
      dto,
      user?.role?.name,
      user?._id ? String(user._id) : undefined,
      user?.factoryId,
      user?.fulfillmentStage,
    );
  }

  @Post(':id/resolve-error')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Đánh dấu hoàn thành lỗi — ẩn đơn tồn đọng khỏi tab "Cần xử lý"' })
  @HttpCode(HttpStatus.OK)
  async resolveError(
    @Param('id') id: string,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<{ success: boolean }> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: `/orders/${id}/resolve-error`, userId: user?._id }),
    });
    return this.orderService.resolveError(id, { user, ip, userAgent });
  }

  @Post('bulk-resolve-error')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Đánh dấu hoàn thành lỗi HÀNG LOẠT' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkResolveErrorResDto })
  async bulkResolveError(
    @Body() dto: BulkResolveErrorDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkResolveErrorResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/orders/bulk-resolve-error',
        count: dto.ids?.length,
        userId: user?._id,
      }),
    });
    return {
      success: true,
      data: await this.orderService.bulkResolveError(dto.ids, { user, ip, userAgent }),
    };
  }

  @Post('bulk-assign-designer-preview')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.DesignerLeader])
  @ApiOperation({
    summary: 'Pre-flight preview cho bulk assign designer — count theo status hiện tại + ai đang ôm task.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkAssignDesignerPreviewResDto })
  async bulkAssignDesignerPreview(@Body() dto: BulkAssignDesignerPreviewDto): Promise<BulkAssignDesignerPreviewResDto> {
    return this.orderService.bulkAssignDesignerPreview(dto);
  }

  @Post('bulk-assign-designer')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.DesignerLeader])
  @ApiOperation({
    summary:
      'Bulk assign 1 designer cho N đơn. Skip đơn đang in-progress/done/rework + trả skipped list. Set reassignOthers=true để override đơn đã gán cho người khác.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkAssignDesignerResDto })
  async bulkAssignDesigner(
    @Body() dto: BulkAssignDesignerDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkAssignDesignerResDto> {
    return this.orderService.bulkAssignDesigner(
      dto,
      user?.role?.name,
      { user, ip, userAgent },
      user?.role?.permissionCodes,
    );
  }

  @Post('auto-assign-preview')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.DesignerLeader])
  @ApiOperation({
    summary:
      'Preview "Tự động gán theo config" cho pool Cần gán — routing 3 mức khách→sản phẩm→xưởng, KHÔNG ghi DB. Trả plan mỗi designer nhận bao nhiêu đơn + số không gán được.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AutoAssignPreviewResDto })
  async autoAssignPreview(@Body() dto: AutoAssignPreviewDto, @AuthUser() user: UserDocument): Promise<AutoAssignPreviewResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/orders/auto-assign-preview', userId: user?._id }),
    });
    return { success: true, data: await this.orderService.previewAutoAssign(dto.orderIds) };
  }

  @Post('auto-assign-apply')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.DesignerLeader])
  @ApiOperation({
    summary:
      'Áp ĐÚNG plan auto-gán đã preview (không tính lại). Đơn đổi trạng thái giữa chừng bị bỏ qua, trả {assigned, skipped}.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AutoAssignApplyResDto })
  async autoAssignApply(
    @Body() dto: AutoAssignApplyDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<AutoAssignApplyResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/orders/auto-assign-apply', userId: user?._id }),
    });
    return {
      success: true,
      data: await this.orderService.applyAutoAssignPlan(dto.assignments, { user, ip, userAgent }),
    };
  }

  @Post('claim-designer-tasks')
  @Auth([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.DesignerLeader, RoleType.Designer])
  @ApiOperation({
    summary:
      'Designer TỰ NHẬN (self-claim) N đơn từ pool cần gán về chính mình. Chỉ nhận đơn chưa ai ôm (unassigned/rejected/rework-chưa-ôm). Ghi log ai nhận + lúc nào.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkAssignDesignerResDto })
  async claimDesignerTasks(
    @Body() dto: ClaimDesignerTasksDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkAssignDesignerResDto> {
    return this.orderService.claimDesignerTasks(dto.ids, { user, ip, userAgent });
  }

  @Post(':id/set-production-error')
  @Auth(ORDER_FIELD_EDIT_ROLES)
  @ApiOperation({
    summary: 'Atomic set productionError + source + note. Code="other" bắt buộc source + note (BE validate).',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SetProductionErrorResDto })
  async setProductionError(
    @Param('id') id: string,
    @Body() dto: SetProductionErrorDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<SetProductionErrorResDto> {
    return this.orderService.setProductionError(
      id,
      dto,
      user?.role?.name,
      { user, ip, userAgent },
      user?.role?.permissionCodes,
    );
  }

  @Patch(':id/field')
  @Auth(ORDER_FIELD_EDIT_ROLES)
  @ApiOperation({ summary: 'Inline update a single workshop field' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UpdateOrderFieldResDto })
  async updateField(
    @Param('id') id: string,
    @Body() dto: UpdateOrderFieldDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<UpdateOrderFieldResDto> {
    return this.orderService.updateField(
      id,
      dto,
      user?.role?.name,
      { user, ip, userAgent },
      user?.role?.permissionCodes,
    );
  }

  @Get(':id/logs')
  // Lịch sử đơn cho MỌI user đã đăng nhập xem (roles rỗng → RolesGuard pass).
  @Auth([])
  @ApiOperation({ summary: 'List audit log entries for an order (Phase 3)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetOrderLogsResDto })
  async getLogs(@Param('id') id: string, @Query() dto: GetOrderLogsDto): Promise<GetOrderLogsResDto> {
    return this.orderService.getLogs(id, dto);
  }

  // Public — không cần JWT, để tool ngoài duyệt thiết kế gọi trực tiếp. Trả về
  // 1 đơn ở bước đầu tiên (chưa soát tool + chưa gán designer) mỗi lần gọi,
  // ưu tiên cao trước. Không định danh caller — log ip/userAgent làm audit
  // trace duy nhất (giống import-from-onospod/cron). Optional `from`/`to`
  // (YYYY-MM-DD) lọc theo `inProductionAt` — cùng semantics `createdFrom`/
  // `createdTo` ở danh sách đơn. Xem Orders.md §18.
  @Get('design-review/next')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: '[Public] Lấy 1 đơn ở bước đầu tiên cho tool duyệt thiết kế' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetNextDesignReviewOrderResDto })
  async getNextDesignReviewOrder(
    @Query() dto: GetNextDesignReviewOrderDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<GetNextDesignReviewOrderResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/orders/design-review/next',
        ip,
        userAgent,
        from: dto.from,
        to: dto.to,
        pid: dto.pid,
      }),
    });
    return this.orderService.getNextDesignReviewOrder(dto) as Promise<GetNextDesignReviewOrderResDto>;
  }

  // Public — bổ sung cho `design-review/next` (lấy đơn TIẾP THEO theo hàng
  // đợi). Endpoint này lấy TRỰC TIẾP 1 đơn theo `productionId` để tool soát
  // lại/tra cứu — KHÔNG áp filter hàng đợi, KHÔNG claim lease. Xem Orders.md §18.
  @Get('design-review/by-production-id/:productionId')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: '[Public] Lấy thông tin 1 đơn (kèm mockup) theo productionId để tool soát design' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetDesignReviewOrderByIdResDto })
  async getDesignReviewOrderByProductionId(
    @Param('productionId') productionId: string,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<GetDesignReviewOrderByIdResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/orders/design-review/by-production-id',
        productionId,
        ip,
        userAgent,
      }),
    });
    return this.orderService.getDesignReviewOrderByProductionId(
      productionId,
    ) as Promise<GetDesignReviewOrderByIdResDto>;
  }

  // Public — bổ sung cho `design-review/next`/`by-production-id`. Trả về danh
  // mục "File lỗi" (workshop_config category=error_file_type, chỉ code
  // active) để tool ngoài hiển thị lựa chọn khi Note kq Tool 1 = 'error', rồi
  // truyền `code` lại qua field `errorFile` ở `POST /design-review/result`.
  // Xem Orders.md §18.
  @Get('design-review/error-file-options')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: '[Public] Danh mục "File lỗi" để truyền vào POST /design-review/result' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetDesignReviewErrorFileOptionsResDto })
  async getDesignReviewErrorFileOptions(
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<GetDesignReviewErrorFileOptionsResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'GET',
        url: '/orders/design-review/error-file-options',
        ip,
        userAgent,
      }),
    });
    return this.orderService.getDesignReviewErrorFileOptions();
  }

  // Public — không cần JWT, để tool ngoài duyệt thiết kế lưu Kết quả Tool
  // (`toolResult`). KHÔNG đụng `toolResultNote` — field đó chỉ nhân viên sửa
  // tay, TRỪ KHI tool tự truyền tường minh (cùng cơ chế cho `errorFile`/
  // `errorFileNote`, dùng khi `toolResultNote='error'`). Không định danh
  // caller — log ip/userAgent làm audit trace duy nhất. Xem Orders.md §18.
  @Post('design-review/result')
  @Auth([], [], { public: true })
  @ApiOperation({
    summary:
      '[Public] Lưu Kết quả Tool (toolResult) + optional Note kq Tool 1 (toolResultNote) + optional File lỗi (errorFile) + optional Ghi chú (errorFileNote) + optional Drive URL file cutting/file in (cuttingFileUrl) + optional Drive URL file in tạm khi lỗi (tempFileUrl)',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SetDesignReviewResultResDto })
  async setDesignReviewResult(
    @Body() dto: SetDesignReviewResultDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<SetDesignReviewResultResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/orders/design-review/result',
        productionId: dto.productionId,
        toolResult: dto.toolResult,
        toolResultNote: dto.toolResultNote,
        errorFile: dto.errorFile,
        errorFileNote: dto.errorFileNote,
        cuttingFileUrl: dto.cuttingFileUrl,
        tempFileUrl: dto.tempFileUrl,
        ip,
        userAgent,
      }),
    });
    return this.orderService.setDesignReviewResult(
      dto.productionId,
      {
        toolResult: dto.toolResult,
        toolResultNote: dto.toolResultNote,
        errorFile: dto.errorFile,
        errorFileNote: dto.errorFileNote,
        cuttingFileUrl: dto.cuttingFileUrl,
        tempFileUrl: dto.tempFileUrl,
      },
      { ip, userAgent },
    ) as Promise<SetDesignReviewResultResDto>;
  }

  @Get('by-production-id/:code')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({
    summary: 'Lookup đơn theo productionId (workshop quét barcode USB) — exact match case-insensitive.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetOrderByProductionIdResDto })
  async getByProductionId(
    @Param('code') code: string,
    @AuthUser() user: UserDocument,
  ): Promise<GetOrderByProductionIdResDto> {
    return this.orderService.getByProductionId(
      code,
      user?.role?.name,
      user?._id ? String(user._id) : undefined,
      user?.factoryId,
    ) as Promise<GetOrderByProductionIdResDto>;
  }

  @Get(':id')
  @Auth(ORDER_VIEW_ROLES)
  @ApiOperation({ summary: 'Get single order — full info cho detail dialog.' })
  @HttpCode(HttpStatus.OK)
  async getOrderById(
    @Param('id') id: string,
    @AuthUser() user: UserDocument,
  ): Promise<{ success: true; data: unknown }> {
    // KHÔNG truyền factoryId — getOrderById chỉ scope theo Designer (assignee),
    // không khóa xưởng (tham số thừa trước đây bị JS bỏ qua, giữ nguyên hành vi).
    return this.orderService.getOrderById(id, user?.role?.name, user?._id ? String(user._id) : undefined);
  }

  @Delete(':id')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Delete order (soft)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ResDto })
  async deleteOrder(
    @Param('id') id: string,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<ResDto> {
    await this.orderService.deleteOrder(id, { user, ip, userAgent });
    return { success: true };
  }

  @Post('backfill-designer-status')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({
    summary:
      'Infer designerStatus + timestamps for legacy orders from assignee + toolResultNote + OrderLog (idempotent).',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ResDto })
  async backfillDesignerStatus(): Promise<ResDto> {
    const result = await this.orderService.backfillDesignerStatus();
    return { success: true, data: result };
  }
}
