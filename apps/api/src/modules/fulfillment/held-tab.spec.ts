import { FulfillmentStage } from 'shared';

import { OrderService } from '../order/order.service';
import { FulfillmentTaskService } from './fulfillment-task.service';

/**
 * Held orders leave the `waiting` column (the list workers pick from) for their own `held` tab
 * (Orders.md §9b). The two must split the old waiting column exactly: same conditions, only the
 * `heldAt` clause differs — no order counted twice, none dropped.
 */
type Filter = Record<string, unknown>;
const svc = Object.create(FulfillmentTaskService.prototype) as unknown as {
  applyTabFilter: (base: Filter, tab: string, stage: FulfillmentStage, userId: string) => Filter;
};
const base = { cancelledAt: null, factoryId: 'F1' };

describe.each(Object.values(FulfillmentStage))('stage %s', (stage) => {
  it('waiting excludes held; held is waiting with heldAt set', () => {
    const waiting = svc.applyTabFilter(base, 'waiting', stage, 'u1');
    const held = svc.applyTabFilter(base, 'held', stage, 'u1');
    expect(waiting.heldAt).toEqual({ $exists: false });
    expect(held.heldAt).toEqual({ $exists: true });
    const { heldAt: _w, ...waitingRest } = waiting;
    const { heldAt: _h, ...heldRest } = held;
    expect(heldRest).toEqual(waitingRest);
  });

  it('work in hand keeps held orders (shown with the badge)', () => {
    for (const tab of ['in-progress', 'rework']) expect(svc.applyTabFilter(base, tab, stage, 'u1')).not.toHaveProperty('heldAt');
  });
});

/** The print-stage table (OrderService.applyFulfillmentStatusFilter) mirrors the kanban split. */
describe('print table status filter', () => {
  const orderSvc = Object.create(OrderService.prototype) as unknown as {
    applyFulfillmentStatusFilter: (f: Filter, status: string, stage?: string, userId?: string) => void;
  };
  const run = (status: string, start: Filter = {}) => {
    const f: Filter = { ...start };
    orderSvc.applyFulfillmentStatusFilter(f, status, FulfillmentStage.Print, 'u1');
    return f;
  };

  it('held = waiting with the opposite heldAt clause', () => {
    const waiting = run('waiting');
    const held = run('held');
    expect(waiting.$and).toContainEqual({ heldAt: { $exists: false } });
    expect(held.$and).toContainEqual({ heldAt: { $exists: true } });
    const strip = (f: Filter) => ({ ...f, $and: (f.$and as Filter[]).filter((c) => !('heldAt' in c)) });
    expect(strip(held)).toEqual(strip(waiting));
  });

  it('ANDs with the page "held" toggle instead of overwriting it', () => {
    const f = run('waiting', { heldAt: { $exists: true } });
    expect(f.heldAt).toEqual({ $exists: true });
    expect(f.$and).toContainEqual({ heldAt: { $exists: false } }); // together: empty, as it should be
  });
});
