import { Injectable } from '@nestjs/common';
import type { GetOrderLogsDto, GetOrderLogsResDto, ProductionOrderLogAction, RoleType } from 'shared';

import type { UserDocument } from '../user/user.entity';
import { OrderLogRepository } from './order-log.repository';

export type AuditContext = {
  user?: Pick<UserDocument, '_id' | 'fullName' | 'email' | 'impersonatedBy'> & { role?: { name?: RoleType } };
  ip?: string;
  userAgent?: string;
  /** Which automated writer made the change (see `ORDER_LOG_SOURCE_*`); absent = a person or an unlabelled job. */
  source?: string;
};

/**
 * `source` of every log row written through the external design-review tool's result door
 * (`POST /orders/design-review/result` -> `OrderService.setDesignReviewResult`). The tool has no user account
 * and its rows carry no `userId`, but neither do cron jobs, syncs and other system writes: this label is
 * the only thing that tells the tool's own writes apart (the "tool looks stopped" check relies on it).
 */
export const ORDER_LOG_SOURCE_DESIGN_REVIEW_TOOL = 'design-review-tool';

type WriteParams = {
  orderId: string;
  action: ProductionOrderLogAction;
  field?: string;
  before?: unknown;
  after?: unknown;
  /** `restore` rows of the bulk undo only: the incident they rewound (Orders.md §27). */
  undoOf?: { group: string; actor: string; from: Date; to: Date };
  ctx?: AuditContext;
};

@Injectable()
export class OrderLogService {
  constructor(private readonly repo: OrderLogRepository) {}

  /**
   * Single-row write. Caller decides which field/before/after to record.
   * Failure to log must never block the user action — we swallow errors
   * but log them for observability.
   */
  async write(params: WriteParams): Promise<void> {
    try {
      await this.repo.create({
        orderId: params.orderId,
        action: params.action,
        field: params.field,
        before: params.before,
        after: params.after,
        userId: params.ctx?.user?._id?.toString(),
        userName: params.ctx?.user?.fullName,
        userEmail: params.ctx?.user?.email,
        roleCode: params.ctx?.user?.role?.name,
        // AUTH-1 AC-06 — MỘT điểm chạm duy nhất cho toàn bộ log đơn hàng, vì
        // mọi đường ghi log đều đi qua đúng hàm này.
        impersonatorId: params.ctx?.user?.impersonatedBy?._id,
        impersonatorName: params.ctx?.user?.impersonatedBy?.fullName,
        ip: params.ctx?.ip,
        userAgent: params.ctx?.userAgent,
        ...(params.ctx?.source ? { source: params.ctx.source } : {}),
      });
    } catch (err) {
      console.warn('[order-log] write failed', err);
    }
  }

  async writeMany(rows: WriteParams[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      await this.repo.createMany(
        rows.map((p) => ({
          orderId: p.orderId,
          action: p.action,
          field: p.field,
          before: p.before,
          after: p.after,
          ...(p.undoOf ? { undoOf: p.undoOf } : {}),
          userId: p.ctx?.user?._id?.toString(),
          userName: p.ctx?.user?.fullName,
          userEmail: p.ctx?.user?.email,
          roleCode: p.ctx?.user?.role?.name,
          ip: p.ctx?.ip,
          userAgent: p.ctx?.userAgent,
          ...(p.ctx?.source ? { source: p.ctx.source } : {}),
        })),
      );
    } catch (err) {
      console.warn('[order-log] writeMany failed', err);
    }
  }

  async listByOrder(orderId: string, dto: GetOrderLogsDto): Promise<GetOrderLogsResDto> {
    const { page, limit, sort, order } = dto;
    const filter: Record<string, unknown> = { orderId };
    if (dto.action) filter.action = dto.action;
    if (dto.field) filter.field = dto.field;

    const { data, total } = await this.repo.findAllAndCount(filter, {
      paging: { skip: limit * (page - 1), limit },
      sort: { [sort || 'createdAt']: order === 'asc' ? 1 : -1 },
    });

    return { success: true, data, total };
  }
}
