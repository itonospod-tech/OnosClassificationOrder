import { ZodValidationPipe } from '@anatine/zod-nestjs';
import { Controller, Get, HttpCode, HttpStatus, Param, Query, UsePipes } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  GetCustomerCatalogDto,
  GetCustomerCatalogFacetsResDto,
  GetCustomerCatalogItemResDto,   GetCustomerCatalogResDto,
} from 'shared';

import { Auth } from '@/decorators';

import { CustomerCatalogService } from './customer-catalog.service';

/**
 * Catalog công khai cho trang `/catalog` — KHÔNG cần đăng nhập, phục vụ khách
 * chưa có tài khoản xem hàng trước khi đăng ký đặt đơn.
 *
 * Khác `CustomerCatalogController` (đã đăng nhập) đúng ở phần giá: ở đây chỉ ra
 * `retailPrice` (giá niêm yết), KHÔNG áp khuyến mãi theo tier VIP — giá ưu đãi
 * theo hạng là quyền lợi riêng của khách đã có tài khoản. Giá vốn
 * (`cost`/`nonShipCost`) vốn đã không nằm trong DTO nên không có đường lọt ra.
 */
@Controller('public/catalog')
@ApiTags('public-catalog')
@UsePipes(ZodValidationPipe)
export class PublicCatalogController {
  constructor(private readonly customerCatalogService: CustomerCatalogService) {}

  @Get()
  @Auth([], [], { public: true })
  @ApiOperation({ summary: 'Danh sách sản phẩm công khai (giá niêm yết, không áp khuyến mãi theo tier)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetCustomerCatalogResDto })
  async getCatalog(@Query() dto: GetCustomerCatalogDto): Promise<GetCustomerCatalogResDto> {
    return this.customerCatalogService.getPublicCatalog(dto);
  }

  // Declared BEFORE ':id' so "facets" is not read as a product id.
  @Get('facets')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: 'Public catalog filters (categories, collections, tags, lines) with counts' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetCustomerCatalogFacetsResDto })
  async getFacets(): Promise<GetCustomerCatalogFacetsResDto> {
    return this.customerCatalogService.getFacets();
  }

  @Get(':id')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: '1 sản phẩm — trang chi tiết công khai `/catalog/:id`' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetCustomerCatalogItemResDto })
  async getCatalogItem(@Param('id') id: string): Promise<GetCustomerCatalogItemResDto> {
    return this.customerCatalogService.getPublicCatalogItem(id);
  }
}
