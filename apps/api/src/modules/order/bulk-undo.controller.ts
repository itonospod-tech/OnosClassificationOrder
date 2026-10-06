import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import { BulkUndoPreviewDto, BulkUndoResDto, BulkUndoRunDto, RoleType } from 'shared';
import { Logger } from 'winston';

import { Auth, ClientIp, UserAgent } from '@/decorators';
import type { UserDocument } from '@/modules/user/user.entity';

import { BulkUndoService } from './bulk-undo.service';

/** Undo of a mistaken bulk edit (Orders.md §27). SuperAdmin; the owner clicks, batch by batch. */
@Controller('orders/bulk-undo')
@ApiTags('orders')
export class BulkUndoController {
  constructor(
    private readonly bulkUndoService: BulkUndoService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  @Post('preview')
  @Auth([RoleType.SuperAdmin])
  @ApiOperation({ summary: 'Xem trước hoàn tác sửa hàng loạt (chỉ đọc, tính lại lúc bấm) — SuperAdmin' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkUndoResDto })
  async preview(@Body() dto: BulkUndoPreviewDto, @AuthUser() user: UserDocument): Promise<BulkUndoResDto> {
    this.logger.info({ message: JSON.stringify({ method: 'POST', url: '/orders/bulk-undo/preview', userId: user?._id, group: dto.group }) });
    return { success: true, data: await this.bulkUndoService.preview(dto, user?.role?.name as RoleType) };
  }

  @Post('run')
  @Auth([RoleType.SuperAdmin])
  @ApiOperation({ summary: 'Hoàn tác sửa hàng loạt cho một lô đơn — ghi nhật ký từng trường — SuperAdmin' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BulkUndoResDto })
  async run(
    @Body() dto: BulkUndoRunDto,
    @AuthUser() user: UserDocument,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string,
  ): Promise<BulkUndoResDto> {
    this.logger.info({ message: JSON.stringify({ method: 'POST', url: '/orders/bulk-undo/run', userId: user?._id, group: dto.group, count: dto.ids.length }) });
    return { success: true, data: await this.bulkUndoService.run(dto, user?.role?.name as RoleType, { user, ip, userAgent }) };
  }
}
