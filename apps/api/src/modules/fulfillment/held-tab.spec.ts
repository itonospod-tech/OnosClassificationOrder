import { FulfillmentStage } from 'shared';

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
