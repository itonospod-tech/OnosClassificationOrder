import { CustomerPriorityAllocZod, OrderPriority, RoleType } from 'shared';

import { OrderService } from './order.service';

/**
 * Mức 4 "Làm ngay" chỉ hệ thống ghi thẳng DB — web/API không đặt lên 4, không hạ/bỏ
 * đơn đang ở 4, cấu hình ưu tiên theo khách không có cột 4. Orders.md §17.
 */
describe('priority 4 (Làm ngay) is system-only', () => {
  function makeSvc(before: Record<string, unknown>) {
    let update: Record<string, unknown> | undefined;
    let bulkFilter: Record<string, unknown> | undefined;
    const svc = Object.create(OrderService.prototype) as unknown as Record<string, unknown> & {
      updateField: OrderService['updateField'];
      bulkUpdateField: OrderService['bulkUpdateField'];
    };
    svc.orderRepository = { findOneById: () => Promise.resolve(before) };
    svc.orderModel = {
      findOneAndUpdate: (_f: unknown, u: Record<string, unknown>) => {
        update = u;
        return Promise.resolve({ ...before });
      },
      find: (f: Record<string, unknown>) => {
        bulkFilter = f;
        return { lean: () => Promise.resolve([]) };
      },
      updateMany: () => Promise.resolve({ matchedCount: 0, modifiedCount: 0 }),
    };
    svc.orderLogService = { write: () => undefined, writeMany: () => undefined };
    svc.invalidateListCache = () => Promise.resolve();
    return { svc, getUpdate: () => update, getBulkFilter: () => bulkFilter };
  }

  it('updateField rejects setting priority 4', async () => {
    const { svc } = makeSvc({ _id: 'A', priority: OrderPriority.High });
    await expect(svc.updateField('A', { field: 'priority', value: '4' } as never, RoleType.SuperAdmin)).rejects.toThrow(
      /Làm ngay/,
    );
  });

  it('updateField rejects changing or clearing an order already at 4', async () => {
    for (const value of ['3', null]) {
      const { svc, getUpdate } = makeSvc({ _id: 'A', priority: OrderPriority.Urgent });
      await expect(svc.updateField('A', { field: 'priority', value } as never, RoleType.SuperAdmin)).rejects.toThrow(
        /Làm ngay/,
      );
      expect(getUpdate()).toBeUndefined();
    }
  });

  it('updateField still sets 1..3 normally', async () => {
    const { svc, getUpdate } = makeSvc({ _id: 'A' });
    await svc.updateField('A', { field: 'priority', value: '3' } as never, RoleType.SuperAdmin);
    expect((getUpdate()?.$set as Record<string, unknown>).priority).toBe(3);
  });

  it('bulkUpdateField rejects 4 and skips orders already at 4', async () => {
    const { svc, getBulkFilter } = makeSvc({});
    await expect(
      svc.bulkUpdateField({ ids: ['A'], field: 'priority', value: '4' } as never, RoleType.SuperAdmin),
    ).rejects.toThrow(/Làm ngay/);
    await svc.bulkUpdateField({ ids: ['A', 'B'], field: 'priority', value: '2' } as never, RoleType.SuperAdmin);
    expect(getBulkFilter()?.priority).toEqual({ $ne: OrderPriority.Urgent });
  });

  it('customer priority config cannot hold level 4', () => {
    expect(CustomerPriorityAllocZod.safeParse({ priority: 4, customerIds: [] }).success).toBe(false);
    expect(CustomerPriorityAllocZod.safeParse({ priority: 3, customerIds: [] }).success).toBe(true);
  });
});
