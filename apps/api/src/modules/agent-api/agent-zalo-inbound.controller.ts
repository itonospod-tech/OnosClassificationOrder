import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { Auth } from '@/decorators';

import { AgentZaloInboundService } from './agent-zalo-inbound.service';

/**
 * Đầu NHẬN webhook từ engine Zalo.
 *
 * Vì sao tách khỏi `AgentApiController`: controller kia gắn `AgentApiKeyGuard`
 * cho cả lớp, mà engine không có khoá agent — nó xác thực bằng chữ ký HMAC trên
 * thân yêu cầu. Nhét vào đó thì phải khoét một lỗ trong guard, và một guard có
 * ngoại lệ là guard sẽ bị khoét tiếp.
 *
 * Ẩn khỏi Swagger: trang đó mô tả hợp đồng cho AI agent, còn đường này là giữa
 * engine và hệ thống — phơi ra chỉ mời người dò.
 */
@Controller('agent/zalo')
@ApiExcludeController()
export class AgentZaloInboundController {
  constructor(private readonly inbound: AgentZaloInboundService) {}

  /**
   * Trả 200 cho cả tin bị loại.
   *
   * Engine coi mã lỗi là giao hỏng và thử lại theo lịch; mà "tin này không đáng
   * đánh thức ai" là kết quả ĐÚNG, không phải hỏng. Trả lỗi ở đây sẽ tạo ra một
   * hàng đợi giao lại vô tận cho đúng thứ mình vừa cố ý bỏ.
   */
  @Post('inbound')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async nhan(@Body() than: Record<string, unknown>, @Req() req: FastifyRequest & { rawBody?: string }) {
    const r = await this.inbound.nhanGiao(
      than as never,
      req.headers['x-webhook-signature'] as string | undefined,
      req.rawBody ?? JSON.stringify(than),
    );

    return { success: true, ...r };
  }
}
