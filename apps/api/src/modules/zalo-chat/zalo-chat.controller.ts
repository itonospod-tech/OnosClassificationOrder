import { Controller, Delete, HttpCode, HttpStatus, Logger, Post, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import type { FastifyReply } from 'fastify';

import { Auth } from '@/decorators/http.decorator';

import type { UserDocument } from '../user/user.entity';
import type { NhanSuZalo } from './zalo-chat.service';
import { ZaloChatService } from './zalo-chat.service';

/**
 * Cấp phiên cho màn chat Zalo. Xem `zalo-chat.constants.ts` vì sao phải là cookie.
 */
@Controller('zalo-chat')
@ApiTags('zalo-chat')
export class ZaloChatController {
  private readonly logger = new Logger(ZaloChatController.name);

  constructor(private readonly zaloChatService: ZaloChatService) {}

  @Post('session')
  // Mở cho MỌI nhân sự đã đăng nhập (08/09/2026): vai trò trong engine do
  // `vaiTro()` quyết: trước hết phải nằm trong danh sách trắng `ZALO_ALLOWED_EMAILS`,
  // sau đó Admin → owner, còn lại → member (member CHƯA thấy gì
  // cho tới khi có rule/grant bên dialog "Phân quyền". Khoá cứng ở decorator
  // như trước thì rule theo role/scope của nhà cung cấp không bao giờ khớp ai.
  @Auth([])
  @ApiOperation({ summary: 'Đổi JWT lấy cookie phiên cho màn chat Zalo' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse()
  async createSession(
    @AuthUser() user: UserDocument,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ success: true; data: { role: string } }> {
    this.logger.log(JSON.stringify({ method: 'POST', url: '/zalo-chat/session', userId: user._id }));

    // Nơi quyết định vai trò phải là MỘT chỗ (service), không phải danh sách
    // role rải ở decorator lẫn service.
    const vai = this.zaloChatService.vaiTro(user.role?.name, user.email);
    if (!vai) {
      void reply.header('set-cookie', this.zaloChatService.cookieXoa());
      reply.status(HttpStatus.FORBIDDEN);

      return { success: true, data: { role: 'none' } };
    }

    const ten = user.fullName || user.email || String(user._id);
    // Nhãn chức danh + phạm vi đi kèm phiên: engine so `role`/`scopes` này với
    // rule tự động ở dialog "Phân quyền".
    const pv = this.zaloChatService.phamVi(user as unknown as NhanSuZalo, await this.zaloChatService.maXuong(user.factoryId));
    void reply.header(
      'set-cookie',
      await this.zaloChatService.cookiePhien(String(user._id), ten, vai, user.role?.name, pv),
    );

    return { success: true, data: { role: vai } };
  }

  @Delete('session')
  @Auth([])
  @ApiOperation({ summary: 'Xoá cookie phiên chat Zalo' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse()
  deleteSession(@Res({ passthrough: true }) reply: FastifyReply): { success: true } {
    void reply.header('set-cookie', this.zaloChatService.cookieXoa());

    return { success: true };
  }
}
