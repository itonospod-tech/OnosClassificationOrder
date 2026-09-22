import { ZodValidationPipe } from '@anatine/zod-nestjs';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import {
  AdjustInventoryDto,
  AdjustInventoryResDto,
  CreateReceiptInDto,
  CreateReceiptInResDto,
  GetInventoryItemsDto,
  GetInventoryItemsResDto,
  GetInventoryReceiptsDto,
  GetInventoryReceiptsResDto,
  GetInventoryTxnsDto,
  GetInventoryTxnsResDto,
  GetScanOutPreviewResDto,
  ReconcileApplyResDto,
  ReconcileInventoryDto,
  ReconcilePreviewResDto,
  RoleType,
  ScanOutDto,
  ScanOutResDto,
  UpdateInventoryItemDto,
} from 'shared';

import { Auth } from '@/decorators';
import type { UserDocument } from '@/modules/user/user.entity';

import { InventoryService } from './inventory.service';

/**
 * Tồn kho theo xưởng — nhập tay (phiếu) · quét trừ theo đơn (`ACT-STOCK-OUT`
 * tại trạm quét) · kiểm kê · đối soát ngày. `@Auth([])` cho các đường trạm
 * quét/xem (worker Fulfillment phải gọi được bằng tài khoản công nhân); ghi
 * nhạy cảm (kiểm kê, đối soát) khoá Admin.
 * Plan: `documents/Plans/Inventory-FactoryStock.md`.
 */
@Controller('inventory')
@ApiTags('inventory')
@UsePipes(ZodValidationPipe)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  private by(user: UserDocument): { userId?: string; userName?: string } {
    return { userId: String(user._id), userName: user.fullName || user.email };
  }

  @Get('items')
  @Auth([])
  @ApiOperation({ summary: 'Danh sách tồn kho của 1 xưởng' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetInventoryItemsResDto })
  async listItems(@Query() dto: GetInventoryItemsDto): Promise<GetInventoryItemsResDto> {
    return { success: true, ...(await this.inventoryService.listItems(dto)) };
  }

  @Patch('items/:id')
  @Auth([])
  @ApiOperation({ summary: 'Sửa tên/đơn vị/trạng thái mặt hàng' })
  @HttpCode(HttpStatus.OK)
  async updateItem(@Param('id') id: string, @Body() dto: UpdateInventoryItemDto) {
    return { success: true, data: await this.inventoryService.updateItem(id, dto) };
  }

  @Post('receipts/in')
  @Auth([])
  @ApiOperation({ summary: 'Tạo phiếu nhập kho (nhiều dòng)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CreateReceiptInResDto })
  async createReceiptIn(@Body() dto: CreateReceiptInDto, @AuthUser() user: UserDocument): Promise<CreateReceiptInResDto> {
    return { success: true, data: await this.inventoryService.createReceiptIn(dto, this.by(user)) };
  }

  @Get('receipts')
  @Auth([])
  @ApiOperation({ summary: 'Danh sách phiếu nhập/xuất' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetInventoryReceiptsResDto })
  async listReceipts(@Query() dto: GetInventoryReceiptsDto): Promise<GetInventoryReceiptsResDto> {
    return { success: true, ...(await this.inventoryService.listReceipts(dto)) };
  }

  @Get('receipts/:id')
  @Auth([])
  @ApiOperation({ summary: 'Chi tiết 1 phiếu' })
  @HttpCode(HttpStatus.OK)
  async getReceipt(@Param('id') id: string) {
    return { success: true, data: await this.inventoryService.getReceipt(id) };
  }

  @Post('receipts/close-out')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Chốt phiếu xuất: gom txn out chưa có phiếu trong ngày' })
  @HttpCode(HttpStatus.OK)
  async closeOutReceipt(@Body() dto: ReconcileInventoryDto, @AuthUser() user: UserDocument) {
    return {
      success: true,
      data: await this.inventoryService.closeOutReceipt(dto.factoryId, dto.date, this.by(user)),
    };
  }

  @Post('adjust')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Kiểm kê: chốt tồn về số đếm thực tế' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdjustInventoryResDto })
  async adjust(@Body() dto: AdjustInventoryDto, @AuthUser() user: UserDocument): Promise<AdjustInventoryResDto> {
    return { success: true, data: await this.inventoryService.adjust(dto, this.by(user)) };
  }

  @Get('scan-out/preview/:productionId')
  @Auth([])
  @ApiOperation({ summary: 'Preview trừ kho cho 1 đơn (trạm quét)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetScanOutPreviewResDto })
  async scanOutPreview(@Param('productionId') productionId: string): Promise<GetScanOutPreviewResDto> {
    return { success: true, data: await this.inventoryService.getScanOutPreview(productionId) };
  }

  @Post('scan-out')
  @Auth([])
  @ApiOperation({ summary: 'Trừ tồn theo đơn (quét tay / auto sau in label / đối soát)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ScanOutResDto })
  async scanOut(@Body() dto: ScanOutDto, @AuthUser() user: UserDocument): Promise<ScanOutResDto> {
    return { success: true, data: await this.inventoryService.scanOut(dto, this.by(user)) };
  }

  @Get('transactions')
  @Auth([])
  @ApiOperation({ summary: 'Sổ cái giao dịch kho (thống kê xuất/nhập)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetInventoryTxnsResDto })
  async listTransactions(@Query() dto: GetInventoryTxnsDto): Promise<GetInventoryTxnsResDto> {
    return { success: true, ...(await this.inventoryService.listTransactions(dto)) };
  }

  @Get('reconcile/preview')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Đối soát ngày: đơn In-xong chưa trừ kho' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ReconcilePreviewResDto })
  async reconcilePreview(@Query() dto: ReconcileInventoryDto): Promise<ReconcilePreviewResDto> {
    return { success: true, data: await this.inventoryService.reconcilePreview(dto.factoryId, dto.date) };
  }

  @Post('reconcile/apply')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Đối soát ngày: trừ bù các đơn chưa trừ' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ReconcileApplyResDto })
  async reconcileApply(@Body() dto: ReconcileInventoryDto, @AuthUser() user: UserDocument): Promise<ReconcileApplyResDto> {
    return {
      success: true,
      data: await this.inventoryService.reconcileApply(dto.factoryId, dto.date, this.by(user)),
    };
  }
}
