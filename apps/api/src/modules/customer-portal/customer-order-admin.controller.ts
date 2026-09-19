import { ZodValidationPipe } from '@anatine/zod-nestjs';
import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleType } from 'shared';
import {
  AdminPlaceOrderForDto,
  ConfirmDesignUploadDto,
  ConfirmDesignUploadResDto,
  CustomerStagingOrderResDto,
  GetAdminCustomerOrderCountsDto,
  GetAdminCustomerOrdersDto,
  GetAdminCustomerOrdersResDto,
  GetAdminCustomerOrderStatsResDto,
  GetCustomerCatalogDto,
  GetCustomerCatalogResDto,
  GetCustomerOrderCountsResDto,
  GetDesignFileResDto,
  GetDesignUploadConfigResDto,
  PlaceCustomerOrderDto,
  PresignDesignUploadDto,
  PresignDesignUploadResDto,
  PushCustomerOrdersDto,
  PushCustomerOrdersResDto,
} from 'shared';

import { Auth } from '@/decorators';

import { CustomerService } from '../customer/customer.service';
import { DesignStorageService } from '../design-storage/design-storage.service';
import { CustomerCatalogService } from './customer-catalog.service';
import { CustomerOrderService } from './customer-order.service';

/**
 * Khu quản trị `/hub` trong Seller Portal (SellerPortal.md §9) — nhân viên
 * Admin/SuperAdmin đọc đơn staging của MỌI seller. CHỈ ĐỌC; mọi thao tác trên
 * đơn khách trước đây phải đi qua mạo danh; từ 08/09/2026 ops **lên đơn và đẩy
 * đơn thay seller** ngay tại hub (khuôn `mode="staff"` của wizard thghub) qua
 * hai endpoint dưới — vẫn gọi CHÍNH `placeOrder`/`pushToProduction` mà seller
 * dùng, chỉ khác ở chỗ khách được nạp theo `customerId` thay vì token.
 * Prefix `admin/...` cố ý KHÔNG chứa `/customer/` → RolesGuard chặn token khách.
 */
@ApiTags('customer-orders-admin')
@Controller('admin/customer-orders')
@UsePipes(ZodValidationPipe)
export class CustomerOrderAdminController {
  constructor(
    private readonly customerOrderService: CustomerOrderService,
    private readonly customerService: CustomerService,
    private readonly customerCatalogService: CustomerCatalogService,
    private readonly designStorageService: DesignStorageService,
  ) {}

  /** Nạp seller đích; khách đã xoá mềm/khoá thì không cho đặt hộ. */
  private async target(customerId: string) {
    const customer = await this.customerService.getById(customerId);
    if (!customer || customer.deletedAt) throw new NotFoundException('Không tìm thấy seller.');

    return customer;
  }

  @Get('catalog')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Catalog theo tier của seller đích — ops đặt đơn hộ phải thấy ĐÚNG giá seller thấy' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetCustomerCatalogResDto })
  async catalogFor(
    @Query() q: AdminPlaceOrderForDto,
    @Query() dto: GetCustomerCatalogDto,
  ): Promise<GetCustomerCatalogResDto> {
    // Cùng service của portal khách → giá/khuyến mãi/cổng hiển thị y hệt, khỏi lệch.
    return this.customerCatalogService.getCatalog(await this.target(q.customerId), dto);
  }

  @Post()
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Ops đặt đơn THAY seller (đơn vào trạng thái chờ đẩy như seller tự đặt)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CustomerStagingOrderResDto })
  async placeFor(
    @Query() q: AdminPlaceOrderForDto,
    @Body() dto: PlaceCustomerOrderDto,
  ): Promise<CustomerStagingOrderResDto> {
    return this.customerOrderService.placeOrder(await this.target(q.customerId), dto);
  }

  @Post('push')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Ops đẩy đơn chờ của seller vào sản xuất' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PushCustomerOrdersResDto })
  async pushFor(
    @Query() q: AdminPlaceOrderForDto,
    @Body() dto: PushCustomerOrdersDto,
  ): Promise<PushCustomerOrdersResDto> {
    return this.customerOrderService.pushToProduction(await this.target(q.customerId), dto);
  }

  @Get()
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Đơn khách (staging) của mọi seller — lọc seller/trạng thái/dòng/held/search' })
  @ApiOkResponse({ type: GetAdminCustomerOrdersResDto })
  list(@Query() dto: GetAdminCustomerOrdersDto): Promise<GetAdminCustomerOrdersResDto> {
    return this.customerOrderService.listOrdersAdmin(dto);
  }

  @Get('counts')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Đếm đơn khách theo trạng thái/dòng — toàn hệ hoặc 1 seller' })
  @ApiOkResponse({ type: GetCustomerOrderCountsResDto })
  counts(@Query() dto: GetAdminCustomerOrderCountsDto): Promise<GetCustomerOrderCountsResDto> {
    return this.customerOrderService.getCountsAdmin(dto);
  }

  @Get('stats')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Dashboard khu quản trị seller: đếm toàn hệ + top seller + đơn mới' })
  @ApiOkResponse({ type: GetAdminCustomerOrderStatsResDto })
  stats(): Promise<GetAdminCustomerOrderStatsResDto> {
    return this.customerOrderService.getStatsAdmin();
  }

  /**
   * Ba route design dưới đây là BẢN SAO STAFF của `customer/designs/*`.
   *
   * Vì sao phải có: ô tải file dùng chung giữa hai màn đặt đơn. Ở hub, nhân viên
   * cầm token nhân viên nên gọi thẳng `customer/designs/*` trả 401 — và 401 làm
   * FE đá người dùng về trang đăng nhập ngay khi ô tải file hiện ra, tức ops
   * KHÔNG lên nổi đơn cho seller. File tải lên vẫn thuộc về seller đích (quota,
   * vòng đời, dedup tính theo seller), nên chỉ khác chỗ nạp khách.
   */
  @Get('designs/upload-config')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Giới hạn kích thước/định dạng cho ô tải file khi ops đặt đơn hộ' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetDesignUploadConfigResDto })
  designUploadConfig(): GetDesignUploadConfigResDto {
    return { success: true, data: this.designStorageService.getUploadConfig() };
  }

  @Post('designs/presign')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Cấp URL tải file thẳng lên R2, ghi tên seller đích' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PresignDesignUploadResDto })
  async designPresign(
    @Query() q: AdminPlaceOrderForDto,
    @Body() dto: PresignDesignUploadDto,
  ): Promise<PresignDesignUploadResDto> {
    return { success: true, data: await this.designStorageService.presign(await this.target(q.customerId), dto) };
  }

  @Post('designs/confirm')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Xác nhận tải xong → đẩy job xử lý ảnh' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ConfirmDesignUploadResDto })
  async designConfirm(
    @Query() q: AdminPlaceOrderForDto,
    @Body() dto: ConfirmDesignUploadDto,
  ): Promise<ConfirmDesignUploadResDto> {
    return { success: true, data: await this.designStorageService.confirm(await this.target(q.customerId), dto) };
  }

  @Get('designs/:sha256')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Trạng thái 1 file design (FE chờ xử lý xong để hiện ảnh nhỏ)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetDesignFileResDto })
  async designBySha(@Param('sha256') sha256: string): Promise<GetDesignFileResDto> {
    return { success: true, data: await this.designStorageService.getBySha(sha256.toLowerCase()) };
  }
}
