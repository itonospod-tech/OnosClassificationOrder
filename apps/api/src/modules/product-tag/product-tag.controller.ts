import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateProductTagDto,
  CreateProductTagResDto,
  GetProductTagsDto,
  GetProductTagsResDto,
  RoleType,
  UpdateProductTagDto,
  UpdateProductTagResDto,
} from 'shared';

import { Auth } from '@/decorators';

import { ProductTagService } from './product-tag.service';

@Controller('product-tags')
@ApiTags('product-tags')
export class ProductTagController {
  constructor(private readonly productTagService: ProductTagService) {}

  @Get()
  // Support may READ (products page); writes stay Admin+Manager, enforced at the API layer.
  @Auth([RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'Get product tags' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductTagsResDto })
  async getProductTags(@Query() dto: GetProductTagsDto): Promise<GetProductTagsResDto> {
    return this.productTagService.getProductTags(dto);
  }

  @Post()
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Create product tag' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CreateProductTagResDto })
  async createProductTag(@Body() dto: CreateProductTagDto): Promise<CreateProductTagResDto> {
    return { success: true, data: await this.productTagService.createProductTag(dto) };
  }

  @Patch(':id')
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Update product tag' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UpdateProductTagResDto })
  async updateProductTag(@Param('id') id: string, @Body() dto: UpdateProductTagDto): Promise<UpdateProductTagResDto> {
    return { success: true, data: await this.productTagService.updateProductTag(id, dto) };
  }
}
