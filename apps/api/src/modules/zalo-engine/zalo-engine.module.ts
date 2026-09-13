import { Module } from '@nestjs/common';

import { ZaloEngineService } from './zalo-engine.service';

/**
 * Cửa đọc engine Zalo, dùng chung cho bộ API agent và bộ tóm tắt nhóm.
 *
 * Không giữ state, không model — chỉ gọi HTTP có ký. Tách module để hai bên
 * không mỗi bên một bản khử trùng `zaloMsgId`.
 */
@Module({
  providers: [ZaloEngineService],
  exports: [ZaloEngineService],
})
export class ZaloEngineModule {}
