import type { ExecutionContext } from '@nestjs/common';
import { applyDecorators, createParamDecorator, SetMetadata, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, PublicRoute } from 'core';
import type { PermissionType, RoleType } from 'shared';

import { PermissionsGuard, RateLimiterGuard, RolesGuard } from '@/guards';
import { ZaloAccessGuard } from '@/guards/zalo-access.guard';
import { AuthUserInterceptor } from '@/interceptors';

export function Auth(
  roles: RoleType[] = [],
  permission: PermissionType[] = [],
  options?: Partial<{ public: boolean }>,
): MethodDecorator {
  const isPublicRoute = options?.public;

  return applyDecorators(
    SetMetadata('roles', roles),
    SetMetadata('permission', permission),
    UseGuards(AuthGuard({ public: isPublicRoute }), RateLimiterGuard, PermissionsGuard, RolesGuard), // RateLimiterGuard
    // Nhãn bearer CHỈ gắn cho route thật sự đi qua JWT (`HF-1`). Trước đây nó
    // gắn vô điều kiện, nên route `public: true` vẫn bị Swagger khai là cần
    // bearer — nhóm endpoint agent là chỗ lộ ra: cửa thật của chúng là
    // `AgentApiKeyGuard`, mà đặc tả lại đòi thêm JWT, khiến người đọc tưởng
    // phải đăng nhập mới gọi được.
    //
    // Đây là decorator TÀI LIỆU, không phải guard: bỏ nó không đổi quyền gọi
    // của bất kỳ route nào. Cửa vẫn là `AuthGuard({ public })` ngay phía trên.
    ...(isPublicRoute ? [] : [ApiBearerAuth()]),
    UseInterceptors(AuthUserInterceptor),
    ApiUnauthorizedResponse({ description: 'Unauthorized' }),
    PublicRoute(isPublicRoute),
  );
}

export function Perm(permission: PermissionType[] = []): MethodDecorator {
  return applyDecorators(SetMetadata('permission', permission), UseGuards(AuthGuard(), PermissionsGuard));
}

export const ClientIp = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();

  return (request.headers['x-forwarded-for'] || '').split(',')[0] || request.ip;
});

export const UserAgent = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();

  return request.headers['user-agent'];
});

export const AccessToken = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();

  return request.headers.authorization.replace('Bearer ', '');
});

/**
 * `@Auth()` cộng chốt danh sách trắng cho dữ liệu Zalo.
 *
 * Thứ tự quan trọng: `Auth()` gắn `AuthGuard` (nơi tạo `request.user`), rồi mới
 * tới `ZaloAccessGuard` đọc email. Đặt `ZaloAccessGuard` ở cấp controller sẽ
 * chạy TRƯỚC `AuthGuard` và chặn cả người được phép — vì thế mọi endpoint Zalo
 * dùng decorator này chứ không tự ghép `UseGuards` tay.
 */
export function AuthZalo(roles: RoleType[] = [], permission: PermissionType[] = []): MethodDecorator {
  return applyDecorators(Auth(roles, permission), UseGuards(ZaloAccessGuard), ApiForbiddenResponse({ description: 'Không được cấp quyền đọc dữ liệu Zalo' }));
}
