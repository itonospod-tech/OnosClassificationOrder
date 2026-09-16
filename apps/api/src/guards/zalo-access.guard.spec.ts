import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';

import { ZaloAccessGuard } from './zalo-access.guard';

const ctx = (user?: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

describe('ZaloAccessGuard', () => {
  const guard = new ZaloAccessGuard();

  it('cho tài khoản trong danh sách trắng', () => {
    expect(guard.canActivate(ctx({ email: 'tuankudo199@gmail.com' }))).toBe(true);
    expect(guard.canActivate(ctx({ email: 'automation@onosfactory.com' }))).toBe(true);
  });

  it('CHẶN SuperAdmin khác — quyền đọc chat không đi theo role', () => {
    expect(() => guard.canActivate(ctx({ email: 'lechinguyen09@gmail.com', role: { name: 'SuperAdmin' } }))).toThrow(ForbiddenException);
  });

  it('FAIL-CLOSED khi không đọc được người dùng', () => {
    // Nếu một ngày thứ tự guard bị đổi và guard này chạy trước AuthGuard thì
    // `request.user` rỗng — hành vi sai phải là chặn tất cả, không phải mở tất cả.
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({}))).toThrow(ForbiddenException);
  });
});
