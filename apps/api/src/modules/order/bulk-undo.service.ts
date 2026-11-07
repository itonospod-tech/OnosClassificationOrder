import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { BulkUndoGroup, BulkUndoResult, BulkUndoRow } from 'shared';
import { RoleType } from 'shared';
import { Logger } from 'winston';

import type { AuditContext } from '../order-log/order-log.service';
import { OrderLogService } from '../order-log/order-log.service';
import { planUndo, UNDO_GROUP_FIELD, type UndoLogRow, type UndoWindow } from './bulk-undo.logic';
import { OrderEntity } from './order.entity';

/**
 * Undo of a mistaken bulk edit (Orders.md §27), SuperAdmin only. Preview and run both recompute
 * from the CURRENT database at click time: people keep fixing these orders by hand, and every
 * order someone already touched must be left alone.
 */
@Injectable()
export class BulkUndoService {
  /** One run at a time. */
  private running = false;

  constructor(
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    private readonly orderLogService: OrderLogService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  private assertSuperAdmin(roleName?: RoleType): void {
    if (roleName !== RoleType.SuperAdmin) throw new ForbiddenException('Chỉ SuperAdmin được hoàn tác sửa hàng loạt.');
  }

  private window(dto: { actor: string; from: Date; to: Date }): UndoWindow {
    if (!(dto.from < dto.to)) throw new BadRequestException('Mốc "từ" phải trước mốc "đến".');
    if (dto.to.getTime() - dto.from.getTime() > 24 * 3600_000) throw new BadRequestException('Khung sự cố tối đa 24 giờ.');
    return { actor: dto.actor, from: dto.from, to: dto.to };
  }

  /** Plans for the given orders (or every order the actor changed in the window). */
  private async plan(group: BulkUndoGroup, w: UndoWindow, onlyIds?: string[]) {
    const logs = this.orderModel.db.collection('orderLogs');
    const field = UNDO_GROUP_FIELD[group];
    const ids =
      onlyIds ??
      ((await logs.distinct('orderId', {
        field,
        createdAt: { $gte: w.from, $lte: w.to },
        $or: [{ userId: w.actor }, { userName: w.actor }, { userEmail: w.actor }],
      })) as string[]);
    if (ids.length === 0) return [];
    const [orders, allLogs] = await Promise.all([
      this.orderModel.find({ _id: { $in: ids } }).lean(),
      logs
        .find<UndoLogRow & { orderId: string }>(
          { orderId: { $in: ids } },
          { projection: { orderId: 1, field: 1, before: 1, after: 1, createdAt: 1, userId: 1, userName: 1, userEmail: 1 } },
        )
        .sort({ createdAt: 1 })
        .toArray(),
    ]);
    const logsOf = new Map<string, UndoLogRow[]>();
    for (const l of allLogs) (logsOf.get(l.orderId) ?? logsOf.set(l.orderId, []).get(l.orderId)!).push(l);
    const byId = new Map(orders.map((o) => [String(o._id), o as unknown as Record<string, unknown>]));
    return ids.map((id) => {
      const order = byId.get(id);
      return { id, order, plan: order ? planUndo(group, order, logsOf.get(id) ?? [], w) : null };
    });
  }

  async preview(dto: { actor: string; from: Date; to: Date; group: BulkUndoGroup }, roleName?: RoleType): Promise<BulkUndoResult> {
    this.assertSuperAdmin(roleName);
    const plans = (await this.plan(dto.group, this.window(dto))).filter((p) => p.plan);
    const rows: BulkUndoRow[] = plans.map(({ id, order, plan }) => ({
      orderId: id,
      productionId: String(order?.productionId ?? ''),
      status: plan!.status,
      reason: plan!.status === 'skip' ? plan!.reason : undefined,
      changes: plan!.changes,
    }));
    rows.sort((a, b) => (a.status === b.status ? a.productionId.localeCompare(b.productionId) : a.status === 'restore' ? -1 : 1));
    return {
      affected: rows.length,
      restorable: rows.filter((r) => r.status === 'restore').length,
      skipped: rows.filter((r) => r.status === 'skip').length,
      rows,
      userNames: await this.userNames(rows),
    };
  }

  /**
   * Restore the given orders (max BULK_UNDO_BATCH_MAX). Every order is re-planned now; the write is
   * conditional on the values the incident left (atomic per order), and each changed field gets an
   * order-log row (action 'restore') with the actor of the undo.
   */
  async run(
    dto: { actor: string; from: Date; to: Date; group: BulkUndoGroup; ids: string[]; reason: string },
    roleName?: RoleType,
    ctx?: AuditContext,
  ): Promise<BulkUndoResult> {
    this.assertSuperAdmin(roleName);
    if (this.running) throw new BadRequestException('Đang có một lượt hoàn tác khác chạy — đợi lượt đó xong.');
    this.running = true;
    const rows: BulkUndoRow[] = [];
    try {
      const plans = await this.plan(dto.group, this.window(dto), [...new Set(dto.ids)]);
      for (const { id, order, plan } of plans) {
        const productionId = String(order?.productionId ?? '');
        if (!order || !plan) {
          rows.push({ orderId: id, productionId, status: 'skip', reason: 'not-found', changes: [] });
          continue;
        }
        if (plan.status === 'skip') {
          rows.push({ orderId: id, productionId, status: 'skip', reason: plan.reason, changes: plan.changes });
          continue;
        }
        const updated = await this.orderModel.findOneAndUpdate(
          { _id: id, cancelledAt: { $exists: false }, heldAt: { $exists: false }, ...plan.guard },
          { $set: plan.set },
        );
        if (!updated) {
          rows.push({ orderId: id, productionId, status: 'skip', reason: 'changed-during-run', changes: plan.changes });
          continue;
        }
        await this.orderLogService.writeMany(
          plan.changes.map((c) => ({ orderId: id, action: 'restore' as const, field: c.field, before: c.current ?? null, after: c.restore ?? null, ctx })),
        );
        rows.push({ orderId: id, productionId, status: 'restored', changes: plan.changes });
      }
    } finally {
      this.running = false;
    }
    const restored = rows.filter((r) => r.status === 'restored').length;
    this.logger.info({
      message: JSON.stringify({ bulkUndo: dto.group, actor: dto.actor, from: dto.from, to: dto.to, reason: dto.reason, restored, skipped: rows.length - restored, by: ctx?.user?._id }),
    });
    return { affected: rows.length, restorable: restored, skipped: rows.length - restored, rows, userNames: await this.userNames(rows) };
  }

  /** Names for the assignee ids in the rows, so the before/after file reads "who", not an id. */
  private async userNames(rows: BulkUndoRow[]): Promise<Record<string, string>> {
    const ids = new Set<string>();
    for (const r of rows) for (const c of r.changes) if (c.field === 'assignee') for (const v of [c.current, c.restore]) if (typeof v === 'string' && v) ids.add(v);
    if (ids.size === 0) return {};
    const users = await this.orderModel.db
      .collection('users')
      .find<{ _id: string; fullName?: string; email?: string }>({ _id: { $in: [...ids] } } as never, { projection: { fullName: 1, email: 1 } })
      .toArray();
    return Object.fromEntries(users.map((u) => [String(u._id), u.fullName || u.email || String(u._id)]));
  }
}
