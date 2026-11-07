import { DesignerStatus, RoleType } from 'shared';

import { OrderService } from './order.service';

/**
 * A bulk unassign resets designer state as a side effect. On 2026-10-05 that reset was not logged
 * (only `assignee` was) and no-op rows (None -> None) were logged for every id sent. Orders.md §27.
 */
it('bulk unassign logs the designerStatus cascade, and only for orders really changed', async () => {
  const rows: Array<Record<string, unknown>> = [];
  let snapshotFilter: Record<string, unknown> | undefined;
  let updateFilter: Record<string, unknown> | undefined;
  const svc = Object.create(OrderService.prototype) as unknown as Record<string, unknown> & { bulkUpdateField: OrderService['bulkUpdateField'] };
  svc.orderModel = {
    find: (f: Record<string, unknown>) => {
      snapshotFilter = f;
      return { lean: () => Promise.resolve([
        { _id: 'A', assignee: 'HUONG', designerStatus: DesignerStatus.Done },
        { _id: 'B', assignee: null, designerStatus: DesignerStatus.Unassigned }, // nothing to change
      ]) };
    },
    updateMany: (f: Record<string, unknown>) => {
      updateFilter = f;
      return Promise.resolve({ matchedCount: 2, modifiedCount: 1 });
    },
  };
  svc.orderLogService = { writeMany: (r: Array<Record<string, unknown>>) => rows.push(...r) };
  svc.invalidateListCache = () => Promise.resolve();
  await svc.bulkUpdateField({ ids: ['A', 'B'], field: 'assignee', value: null } as never, RoleType.SuperAdmin);

  expect(snapshotFilter).toEqual(updateFilter); // the log describes exactly what was written
  expect(rows.map((r) => [r.orderId, r.field, r.before, r.after])).toEqual([
    ['A', 'assignee', 'HUONG', null],
    ['A', 'designerStatus', DesignerStatus.Done, DesignerStatus.Unassigned],
  ]);
});
