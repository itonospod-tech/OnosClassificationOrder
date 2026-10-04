import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateProductTechniqueDto,
  CreateProductTechniqueResDto,
  GetProductTechniquesDto,
  GetProductTechniquesResDto,
  RoleType,
  UpdateProductTechniqueDto,
  UpdateProductTechniqueResDto,
} from 'shared';

import { Auth } from '@/decorators';

import { ProductTechniqueService } from './product-technique.service';

@Controller('product-techniques')
@ApiTags('product-techniques')
export class ProductTechniqueController {
  constructor(private readonly productTechniqueService: ProductTechniqueService) {}

  @Get()
  // Support may READ (products page); writes stay Admin+Manager, enforced at the API layer.
  @Auth([RoleType.Admin, RoleType.Manager, RoleType.Support])
  @ApiOperation({ summary: 'Get product techniques' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetProductTechniquesResDto })
  async getProductTechniques(@Query() dto: GetProductTechniquesDto): Promise<GetProductTechniquesResDto> {
    return this.productTechniqueService.getProductTechniques(dto);
  }

  @Post()
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Create product technique' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CreateProductTechniqueResDto })
  async createProductTechnique(@Body() dto: CreateProductTechniqueDto): Promise<CreateProductTechniqueResDto> {
    return { success: true, data: await this.productTechniqueService.createProductTechnique(dto) };
  }

  @Patch(':id')
  @Auth([RoleType.Admin, RoleType.Manager])
  @ApiOperation({ summary: 'Update product technique' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UpdateProductTechniqueResDto })
  async updateProductTechnique(@Param('id') id: string, @Body() dto: UpdateProductTechniqueDto): Promise<UpdateProductTechniqueResDto> {
    return { success: true, data: await this.productTechniqueService.updateProductTechnique(id, dto) };
  }
}
