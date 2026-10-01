import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import _ from 'lodash';
import { RoleType } from 'shared';

import { PathAccess } from '@/constants/force-change-password-path';
import { RedisCacheService } from '@/modules/redis-cache/redis-cache.service';

import type { UserDocument } from '../modules/user/user.entity';

/**
 * Token role=Customer (Customer Portal) là token "ngoài" — CHỈ được gọi API
 * dưới các prefix này. Mọi route khác deny mặc định, KỂ CẢ route roles-rỗng
 * `@Auth([])` (vd `GET /orders/:id/logs`). Endpoint mới muốn cho khách gọi
 * BẮT BUỘC đặt dưới `customer/...` (phase Public API sẽ thêm `open-api/`).
 * Xem documents/FunctionDescription/Customers.md.
 */
const CUSTOMER_ALLOWED_PREFIXES = ['/customer/'];

/**
 * Guard trả `false` → Nest ném `ForbiddenException('Forbidden resource')` và
 * log chỉ còn stack nội bộ Nest, không biết route/role/nhánh nào chặn. Ghi 1
 * dòng JSON có `reason` để phân biệt "bấm vào chỗ không có quyền" (`role`) với
 * phiên đã bị thay/đăng xuất (`session`) hay token khách đi lạc (`customer-prefix`).
 */
function deny(
  reason: 'customer-prefix' | 'session' | 'no-role' | 'role',
  request: { method?: string; url?: string; routeOptions?: { url?: string } },
  user: UserDocument | undefined,
  roles?: RoleType[],
): false {
  console.warn(
    JSON.stringify({
      tag: 'roles-guard-deny',
      reason,
      method: request.method,
      route: request.routeOptions?.url ?? (request.url ?? '').split('?')[0],
      role: user?.role?.name ?? null,
      userId: user?._id ? String(user._id) : null,
      allowed: roles,
    }),
  );
  return false;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(forwardRef(() => RedisCacheService))
    private readonly redisCacheService: RedisCacheService,
    private jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.get<RoleType[]>('roles', context.getHandler());

    const request = context.switchToHttp().getRequest();
    const user = <UserDocument>request.user;

    if (user?.role?.name === RoleType.Customer) {
      const url: string = (request.url ?? '').split('?')[0];

      // Chỉ deny-sớm route ngoài whitelist; route hợp lệ vẫn đi tiếp flow
      // kiểm tra session Redis + roles bên dưới như mọi token khác.
      if (!CUSTOMER_ALLOWED_PREFIXES.some((prefix) => url.includes(prefix))) {
        return deny('customer-prefix', request, user);
      }
    }

    if (_.isEmpty(roles)) {
      return true;
    }

    if (user.forcePassChange) {
      const urls: string = request.url.split('?')[0].replaceAll('api/v1/', '');

      if (!PathAccess.includes(urls)) {
        return context.switchToHttp().getResponse().status(405).send({ message: 'You need to change password' });
      }
    }

    if (request?.passAuth) {
      return true;
    }

    const accessToken = request.headers.authorization?.replace('Bearer ', '') as string;

    // Cast type-only: JWT do chính hệ thống phát hành luôn là object payload
    // có sessionId. Token hỏng → decode trả null → throw tại đây (giữ nguyên
    // hành vi cũ, AuthGuard phía trước đã chặn token invalid từ sớm).
    const userInfo = this.jwtService.decode(accessToken) as { sessionId?: string };

    const cachedKey = `token:${userInfo.sessionId}:${user._id}`;
    const cachedToken = await this.redisCacheService.getHash(cachedKey, 'accessToken');

    if (cachedToken !== accessToken) {
      return deny('session', request, user, roles);
    }

    if (user.role?.name === RoleType.SuperAdmin) {
      return true;
    }

    if (roles.includes(RoleType.Seller) && user.role?.name === RoleType.SellerManager) {
      return true;
    }

    if (!user.role) {
      return deny('no-role', request, user, roles);
    }

    return roles.includes(user.role.name) || deny('role', request, user, roles);
  }
}
