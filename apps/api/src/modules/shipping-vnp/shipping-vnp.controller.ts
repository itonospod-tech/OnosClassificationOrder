import { ZodValidationPipe } from '@anatine/zod-nestjs';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import {
  CancelVnpShipmentResDto,
  CheckVnpAddressResDto,
  CreateVnpFromAddressDto,
  CreateVnpFromAddressResDto,
  CreateVnpShipmentDto,
  CreateVnpShipmentResDto,
  DeleteVnpFromAddressResDto,
  GetPackingPackagesDto,
  GetPackingPackagesResDto,
  GetVnpOrderShipmentsResDto,
  GetVnpRemoteAddressesResDto,
  GetVnpShipmentGroupResDto,
  GetVnpShipmentResDto,
  GetVnpShipmentsDto,
  GetVnpShipmentsResDto,
  GetVnpShipmentStatsDto,
  GetVnpShipmentStatsResDto,
  GetVnpShippingConfigResDto,
  GetVnpShippingStatusResDto,
  GetVnpTrackingResDto,
  GetVnpWalletResDto,
  HandoverPackagesDto,
  HandoverPackagesResDto,
  ImportVnpFromAddressDto,
  RoleType,
  RunVnpTrackingCronResDto,
  SaveVnpShippingMapDto,
  SaveVnpShippingMapResDto,
} from 'shared';
import { Logger } from 'winston';

import { Auth, ClientIp } from '@/decorators';

import { UserDocument } from '../user/user.entity';
import { PackingService } from './packing.service';
import { ShippingVnpService } from './shipping-vnp.service';

/**
 * Vận đơn VNP eGlobal — giai đoạn TEST, chỉ SuperAdmin/Admin bấm tay từ
 * bảng đơn hàng. Mọi response kèm `raw` (JSON nguyên văn từ VNP) vì spec
 * bên đó không khai response body — mục tiêu đợt test là tìm label.
 */
@Controller('shipping-vnp')
@ApiTags('shipping-vnp')
@UsePipes(ZodValidationPipe)
export class ShippingVnpController {
  constructor(
    private readonly shippingVnpService: ShippingVnpService,
    private readonly packingService: PackingService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  // ─── Kiện hàng ở công đoạn Đóng hàng (GAP-25/26/27) ───────────────────────
  //
  // `@Auth([])` — MỌI role đăng nhập. Người bàn giao cho hãng là nhân sự kho
  // của xưởng, không phải admin; bắt quyền admin ở đây là đẩy họ quay lại ký
  // giấy tay như hệ cũ.

  @Get('packages')
  @Auth([])
  @ApiOperation({ summary: 'Kiện đã đóng gói — mặc định lấy kiện CHƯA bàn giao' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetPackingPackagesResDto })
  async getPackages(@Query() query: GetPackingPackagesDto, @AuthUser() user: UserDocument): Promise<GetPackingPackagesResDto> {
    this.logger.info({ message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/packages', userId: user._id }) });
    const rows = await this.packingService.danhSachKien({
      factoryId: query.factoryId,
      daBanGiao: query.daBanGiao,
      limit: query.limit,
    });

    return { success: true, data: rows as never };
  }

  @Post('packages/handover')
  @Auth([])
  @ApiOperation({ summary: 'Bàn giao lô kiện cho hãng — cấp mã phiếu + đóng dấu giờ xuất kho' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HandoverPackagesResDto })
  async handover(@Body() body: HandoverPackagesDto, @AuthUser() user: UserDocument): Promise<HandoverPackagesResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/shipping-vnp/packages/handover', userId: user._id, count: body.ids.length }),
    });
    // Xưởng lấy theo người bàn giao: nhân sự kho thuộc đúng một xưởng, và phiếu
    // phải mang tên xưởng đó chứ không phải xưởng của kiện đầu tiên trong lô.
    const data = await this.packingService.banGiao(
      body.ids,
      { factoryId: (user as unknown as { factoryId?: string }).factoryId, carrier: body.carrier },
      { _id: String(user._id) },
    );

    return { success: true, data };
  }

  @Get('status')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'VNP eGlobal config status (không lộ secret)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpShippingStatusResDto })
  getStatus(@AuthUser() user: UserDocument): GetVnpShippingStatusResDto {
    this.logger.info({ message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/status', userId: user._id }) });
    return { success: true, data: this.shippingVnpService.getStatus() };
  }

  @Get('wallet')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Số dư ví VNP (tối thiểu $50 mới tạo được vận đơn)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpWalletResDto })
  async getWallet(@AuthUser() user: UserDocument): Promise<GetVnpWalletResDto> {
    this.logger.info({ message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/wallet', userId: user._id }) });
    return { success: true, data: await this.shippingVnpService.getWallet() };
  }

  @Get('config')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Cấu hình địa chỉ gửi theo xưởng (blob system_configs)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpShippingConfigResDto })
  async getConfig(@AuthUser() user: UserDocument): Promise<GetVnpShippingConfigResDto> {
    this.logger.info({ message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/config', userId: user._id }) });
    return { success: true, data: await this.shippingVnpService.getShippingConfig() };
  }

  @Get('remote-addresses')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Danh sách địa chỉ đã lưu bên VNP (raw — tìm hub US có sẵn)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpRemoteAddressesResDto })
  async listRemoteAddresses(@AuthUser() user: UserDocument): Promise<GetVnpRemoteAddressesResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/remote-addresses', userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.listRemoteAddresses() };
  }

  @Post('from-addresses/import')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Thêm địa chỉ ĐÃ TỒN TẠI bên VNP vào config bằng id' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SaveVnpShippingMapResDto })
  async importFromAddress(
    @Body() dto: ImportVnpFromAddressDto,
    @AuthUser() user: UserDocument,
  ): Promise<SaveVnpShippingMapResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/shipping-vnp/from-addresses/import', userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.importFromAddress(dto) };
  }

  @Post('from-addresses')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Tạo địa chỉ gửi (ShippingFrom) bên VNP + lưu vào config' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CreateVnpFromAddressResDto })
  async createFromAddress(
    @Body() dto: CreateVnpFromAddressDto,
    @AuthUser() user: UserDocument,
  ): Promise<CreateVnpFromAddressResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: '/shipping-vnp/from-addresses', userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.createFromAddress(dto) };
  }

  @Put('config/map')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Lưu mapping xưởng → địa chỉ gửi + địa chỉ mặc định' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SaveVnpShippingMapResDto })
  async saveMap(@Body() dto: SaveVnpShippingMapDto, @AuthUser() user: UserDocument): Promise<SaveVnpShippingMapResDto> {
    this.logger.info({ message: JSON.stringify({ method: 'PUT', url: '/shipping-vnp/config/map', userId: user._id }) });
    return { success: true, data: await this.shippingVnpService.saveShippingMap(dto) };
  }

  @Delete('from-addresses/:vnpAddressId')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Gỡ địa chỉ gửi khỏi config (không xóa bên VNP)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: DeleteVnpFromAddressResDto })
  async deleteFromAddress(
    @Param('vnpAddressId') vnpAddressId: string,
    @AuthUser() user: UserDocument,
  ): Promise<DeleteVnpFromAddressResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'DELETE', url: `/shipping-vnp/from-addresses/${vnpAddressId}`, userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.deleteFromAddress(vnpAddressId) };
  }

  @Get('orders/:orderId/group')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Nhóm item cùng orderId seller (1 đơn nhiều item = 1 label)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpShipmentGroupResDto })
  async getGroup(@Param('orderId') orderId: string, @AuthUser() user: UserDocument): Promise<GetVnpShipmentGroupResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: `/shipping-vnp/orders/${orderId}/group`, userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.getGroup(orderId) };
  }

  @Post('orders/:orderId/check-address')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Bước 1 — kiểm tra địa chỉ nhận của đơn (USPS checkAddress)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CheckVnpAddressResDto })
  async checkAddress(@Param('orderId') orderId: string, @AuthUser() user: UserDocument): Promise<CheckVnpAddressResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: `/shipping-vnp/orders/${orderId}/check-address`, userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.checkAddress(orderId) };
  }

  @Post('orders/:orderId/shipment')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Bước 2 — createAddress(ShippingTo) + createShipment, lưu kết quả vào đơn' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CreateVnpShipmentResDto })
  async createShipment(
    @Param('orderId') orderId: string,
    @Body() dto: CreateVnpShipmentDto,
    @AuthUser() user: UserDocument,
  ): Promise<CreateVnpShipmentResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: `/shipping-vnp/orders/${orderId}/shipment`, userId: user._id }),
    });
    return {
      success: true,
      data: await this.shippingVnpService.createShipment(orderId, dto, {
        userId: String(user._id),
        userName: user.fullName,
      }),
    };
  }

  @Get('shipments/stats')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Dashboard chi phí label (tổng/tháng/xưởng/service — trang /adm/shipments)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpShipmentStatsResDto })
  async getShipmentStats(
    @Query() query: GetVnpShipmentStatsDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetVnpShipmentStatsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/shipments/stats', userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.getShipmentStats(query) };
  }

  // Public (không JWT — external crontab gọi) nhưng KHÓA bằng secret: mỗi lượt
  // cron kéo tới 200 lần gọi ra VNP nên không được để ai gọi cũng kích được
  // (ShippingLabelPatterns.md §7). Pattern giống telegram-webhook.controller.ts:
  // so secret bằng env, sai/thiếu → 401 trước khi chạm logic. Fail-closed: chưa
  // đặt env VNP_TRACKING_CRON_SECRET thì endpoint từ chối tất cả.
  @Get('tracking/cron')
  @Auth([], [], { public: true })
  @ApiOperation({
    summary:
      '[Public + secret] Cron: poll tracking các vận đơn đang mở (2 lần/ngày — VNP không có webhook; dừng khi delivered hoặc quá 30 ngày). Yêu cầu header X-Cron-Secret hoặc query ?secret khớp env VNP_TRACKING_CRON_SECRET',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RunVnpTrackingCronResDto })
  async runTrackingCron(
    @ClientIp() ip: string,
    @Headers('x-cron-secret') secretHeader?: string,
    @Query('secret') secretQuery?: string,
  ): Promise<RunVnpTrackingCronResDto> {
    const expected = process.env.VNP_TRACKING_CRON_SECRET || '';
    if (!expected || (secretHeader !== expected && secretQuery !== expected)) {
      this.logger.warn({
        message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/tracking/cron', ip, denied: true }),
      });
      throw new UnauthorizedException();
    }
    this.logger.info({ message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/tracking/cron', ip }) });
    return { success: true, data: await this.shippingVnpService.pollTrackingCron() };
  }

  @Get('shipments')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Danh sách vận đơn (bảng shipments — lịch sử toàn hệ thống)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpShipmentsResDto })
  async listShipments(
    @Query() query: GetVnpShipmentsDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetVnpShipmentsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/shipping-vnp/shipments', userId: user._id }),
    });
    const result = await this.shippingVnpService.listShipments(query);
    return { success: true, data: result.data, total: result.total } as unknown as GetVnpShipmentsResDto;
  }

  @Get('orders/:orderId/shipments')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Lịch sử vận đơn của 1 đơn (mọi record kể cả đã hủy)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpOrderShipmentsResDto })
  async getOrderShipments(
    @Param('orderId') orderId: string,
    @AuthUser() user: UserDocument,
  ): Promise<GetVnpOrderShipmentsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: `/shipping-vnp/orders/${orderId}/shipments`, userId: user._id }),
    });
    return {
      success: true,
      data: await this.shippingVnpService.getOrderShipments(orderId),
    } as unknown as GetVnpOrderShipmentsResDto;
  }

  @Get('orders/:orderId/tracking')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Bước 3 — tra tracking vận đơn của đơn' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpTrackingResDto })
  async getTracking(@Param('orderId') orderId: string, @AuthUser() user: UserDocument): Promise<GetVnpTrackingResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: `/shipping-vnp/orders/${orderId}/tracking`, userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.getTracking(orderId) };
  }

  @Get('orders/:orderId/shipment-detail')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'GET /shipment/{id} bên VNP — soi raw tìm label sau khi tạo' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetVnpShipmentResDto })
  async getShipmentDetail(
    @Param('orderId') orderId: string,
    @AuthUser() user: UserDocument,
  ): Promise<GetVnpShipmentResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: `/shipping-vnp/orders/${orderId}/shipment-detail`, userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.getShipmentDetail(orderId) };
  }

  @Put('orders/:orderId/cancel')
  @Auth([RoleType.SuperAdmin, RoleType.Admin])
  @ApiOperation({ summary: 'Bước 4 — hủy vận đơn VNP của đơn (để tạo lại khi test)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CancelVnpShipmentResDto })
  async cancelShipment(
    @Param('orderId') orderId: string,
    @AuthUser() user: UserDocument,
  ): Promise<CancelVnpShipmentResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'PUT', url: `/shipping-vnp/orders/${orderId}/cancel`, userId: user._id }),
    });
    return { success: true, data: await this.shippingVnpService.cancelShipment(orderId) };
  }
}
