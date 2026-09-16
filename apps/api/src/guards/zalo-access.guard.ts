import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { duocTruyCapZalo } from '@/utils/zalo-access';

/**
 * Chặn mọi tài khoản ngoài danh sách `ZALO_ALLOWED_EMAILS` khỏi dữ liệu Zalo.
 *
 * FAIL-CLOSED: không đọc được người dùng trên request thì TỪ CHỐI. Guard này
 * phải chạy SAU `AuthGuard` (nơi gắn `request.user`); nếu một ngày nào đó thứ
 * tự guard bị đổi, hành vi sai sẽ là "chặn tất cả" — nhìn thấy ngay — thay vì
 * "cho qua tất cả", thứ không ai nhận ra cho tới khi dữ liệu đã lộ.
 *
 * Dùng qua decorator `AuthZalo()` để không đặt nhầm thứ tự.
 */
@Injectable()
export class ZaloAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: { email?: string } }>();
    if (!duocTruyCapZalo(req?.user?.email)) {
      throw new ForbiddenException('Tài khoản này không được cấp quyền đọc dữ liệu Zalo.');
    }

    return true;
  }
}
