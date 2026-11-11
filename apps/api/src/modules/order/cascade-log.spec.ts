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

/**
 * R5: clearing a tool note on an order whose pipeline nobody started wipes `currentFulfillmentStage` and
 * `fulfillmentStages`. The stage state (waitingAt, reworkAt, status) exists nowhere else, so the wipe is
 * logged with the full snapshot — the bulk undo restores from it.
 */
describe('a tool note change that wipes the stages logs a snapshot of them', () => {
  const waitingAt = new Date('2026-11-10T12:53:24Z');
  const reported = {
    _id: 'T1',
    toolResultNote: 'error',
    productionErrorSource: 'tool-check',
    readyForFulfill: false,
    currentFulfillmentStage: 'print',
    fulfillmentStages: { print: { status: 'waiting', reworkCount: 0, workMs: 0, waitingAt } },
  };

  async function clearNote(before: Record<string, unknown>) {
    const rows: Array<Record<string, unknown>> = [];
    let update: Record<string, unknown> | undefined;
    const svc = Object.create(OrderService.prototype) as unknown as Record<string, unknown> & { updateField: OrderService['updateField'] };
    svc.assertValueAllowed = () => Promise.resolve();
    svc.orderRepository = { findOneById: () => Promise.resolve(before) };
    svc.orderModel = {
      findOneAndUpdate: (_f: unknown, u: Record<string, unknown>) => {
        update = u;
        return Promise.resolve({ ...before, _id: before._id });
      },
    };
    svc.orderLogService = { write: (r: Record<string, unknown>) => rows.push(r), writeMany: (r: Array<Record<string, unknown>>) => rows.push(...r) };
    svc.invalidateListCache = () => Promise.resolve();
    await svc.updateField(String(before._id), { field: 'toolResultNote', value: null } as never, RoleType.SuperAdmin);
    return { rows, set: (update?.$set ?? {}) as Record<string, unknown> };
  }

  it('never-started Print: wiped, and the log keeps note + stage pointer + the whole stage snapshot', async () => {
    const { rows, set } = await clearNote(reported);
    expect(set).toMatchObject({ toolResultNote: null, currentFulfillmentStage: null, fulfillmentStages: {} });
    expect(rows.map((r) => [r.field, r.before, r.after])).toEqual([
      ['toolResultNote', 'error', null],
      ['currentFulfillmentStage', 'print', null],
      ['fulfillmentStages', reported.fulfillmentStages, {}],
    ]);
  });

  it('a started Print stage is kept, so no snapshot row is written', async () => {
    const started = { ...reported, fulfillmentStages: { print: { ...reported.fulfillmentStages.print, status: 'in-progress', firstStartedAt: waitingAt } } };
    const { rows, set } = await clearNote(started);
    expect(set).not.toHaveProperty('fulfillmentStages');
    expect(rows.map((r) => r.field)).toEqual(['toolResultNote']);
  });
});
