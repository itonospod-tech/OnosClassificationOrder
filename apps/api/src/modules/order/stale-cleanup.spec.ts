import { OPEN_ORDER_STALE_DAYS, RoleType, STALE_CLEANUP_NO_ACTIVITY_DAYS } from 'shared';

import { OrderService } from './order.service';
import { lastProductionActivity, staleCleanupEnd, staleEligibility, staleStageKey } from './stale-cleanup.logic';

/**
 * Stale-order cleanup (Orders.md §23b). What must hold:
 *  - only stale, open, unheld, mapped, non-US orders with no production activity in the stale
 *    window can be completed;
 *  - the completion date is in the past (last activity, or inProductionAt + N2), never "now";
 *  - the cleanup never tells the customer, the single-order button still does.
 */
const DAY = 86_400_000;
const NOW = new Date('2026-10-05T03:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const US = 'US_FACTORY';
const stale = (extra: Record<string, unknown> = {}) => ({ _id: 'O1', productionId: 'P1', factoryId: 'TN', inProductionAt: ago(100), ...extra });

describe('staleEligibility', () => {
  it.each<[string, Record<string, unknown> | null, string | null]>([
    ['eligible', stale(), null],
    ['missing', null, 'not-found'],
    ['cancelled', stale({ cancelledAt: ago(1) }), 'cancelled'],
    ['completed', stale({ fulfillmentCompletedAt: ago(50) }), 'completed'],
    ['unmapped', stale({ factoryId: undefined }), 'unmapped'],
    ['US factory', stale({ factoryId: US }), 'excluded-factory'],
    ['held', stale({ heldAt: ago(3) }), 'held'],
    ['not stale yet', stale({ inProductionAt: ago(OPEN_ORDER_STALE_DAYS - 1) }), 'not-stale'],
    ['moved recently (stage step)', stale({ fulfillmentStages: { press: { startedAt: ago(2) } } }), 'recent-activity'],
    ['moved recently (timeline)', stale({ fulfillmentTimeline: [{ at: ago(10), stage: 'qc-post-press' }] }), 'recent-activity'],
    ['old activity only', stale({ fulfillmentStages: { print: { completedAt: ago(90) } } }), null],
  ])('%s', (_name, doc, expected) => {
    expect(staleEligibility(doc, NOW, US)).toBe(expected);
  });
});

describe('staleCleanupEnd: a past date, never now', () => {
  it('last production activity when there is one', () => {
    const doc = stale({ fulfillmentStages: { press: { waitingAt: ago(80) } }, fulfillmentTimeline: [{ at: ago(85) }] });
    expect(staleCleanupEnd(doc)).toEqual(ago(80));
    expect(lastProductionActivity(doc)?.field).toBe('fulfillmentStages.press.waitingAt');
  });
  it('no activity at all: inProductionAt + N2', () => {
    expect(staleCleanupEnd(stale())).toEqual(new Date(ago(100).getTime() + STALE_CLEANUP_NO_ACTIVITY_DAYS * DAY));
  });
  it('activity dated before inProductionAt does not pull the end before it', () => {
    const end = staleCleanupEnd(stale({ toolCheckedAt: ago(120) }));
    expect(end.getTime()).toBeGreaterThan(ago(100).getTime());
  });
});

it('staleStageKey follows the workshop stage rule', () => {
  expect(staleStageKey({ currentFulfillmentStage: 'press' })).toBe('press');
  expect(staleStageKey({ designerStatus: 'done' })).toBe('print');
  expect(staleStageKey({ designerStatus: 'in-progress' })).toBe('designer');
  expect(staleStageKey({ toolResultNote: '' })).toBe('tool-check');
  expect(staleStageKey({ toolResultNote: 'ok' })).toBe('designer');
});

describe('runStaleCleanup vs forceCompleteOrder', () => {
  const make = (docs: Record<string, unknown>[]) => {
    const updates: Array<{ id: string; update: { $set: Record<string, unknown> } }> = [];
    const logs: Array<Record<string, unknown>> = [];
    const svc = Object.create(OrderService.prototype) as unknown as Record<string, unknown> & {
      runStaleCleanup: OrderService['runStaleCleanup'];
      forceCompleteOrder: OrderService['forceCompleteOrder'];
      emitCustomerOrderEvent: jest.Mock;
    };
    svc.orderModel = {
      db: {},
      find: () => ({ lean: () => Promise.resolve(docs) }),
      findById: (id: string) => ({ lean: () => Promise.resolve(docs.find((d) => d._id === id)) }),
      findByIdAndUpdate: (id: string, update: { $set: Record<string, unknown> }) => {
        updates.push({ id, update });
        return Promise.resolve({ _id: id });
      },
    };
    svc.orderLogService = { write: (l: Record<string, unknown>) => logs.push(l) };
    svc.emitCustomerOrderEvent = jest.fn();
    svc.invalidateListCache = () => Promise.resolve();
    svc.logger = { info: () => undefined };
    return { svc, updates, logs };
  };
  beforeAll(() => jest.useFakeTimers({ now: NOW }));
  afterAll(() => jest.useRealTimers());

  it('cleanup: past completion date, no customer event, reason + run id in the log, ineligible skipped', async () => {
    const { svc, updates, logs } = make([stale(), stale({ _id: 'O2', productionId: 'P2', heldAt: ago(1) })]);
    const res = await svc.runStaleCleanup(['O1', 'O2'], 'Ops confirmed delivered', RoleType.SuperAdmin);
    expect(res.done).toBe(1);
    expect(res.skipped).toEqual([{ id: 'O2', productionId: 'P2', reason: 'held' }]);
    const completedAt = updates[0].update.$set.fulfillmentCompletedAt as Date;
    expect(completedAt).toEqual(new Date(ago(100).getTime() + STALE_CLEANUP_NO_ACTIVITY_DAYS * DAY));
    expect(completedAt.getTime()).toBeLessThan(NOW.getTime());
    expect(svc.emitCustomerOrderEvent).not.toHaveBeenCalled();
    expect(logs[0].after).toMatchObject({ mode: 'stale-cleanup', reason: 'Ops confirmed delivered', customerNotified: false, runId: res.runId });
  });

  it('single-order button: still now, still tells the customer', async () => {
    const { svc, updates } = make([stale()]);
    await svc.forceCompleteOrder('O1', RoleType.SuperAdmin);
    expect(updates[0].update.$set.fulfillmentCompletedAt).toEqual(NOW);
    expect(svc.emitCustomerOrderEvent).toHaveBeenCalledWith('order.production_completed', expect.any(Array));
  });

  it('SuperAdmin only', async () => {
    const { svc } = make([stale()]);
    await expect(svc.runStaleCleanup(['O1'], 'reason long enough', RoleType.Admin)).rejects.toThrow('Chỉ SuperAdmin');
  });
});

it('preview lists filled steps in flow order', async () => {
  const svc = Object.create(OrderService.prototype) as unknown as Record<string, unknown> & { previewStaleCleanup: OrderService['previewStaleCleanup'] };
  svc.orderModel = { db: {}, find: () => ({ lean: () => Promise.resolve([stale({ toolResultNote: '' })]) }) };
  svc.factoryRepository = { findAll: () => Promise.resolve([{ _id: 'TN', shortName: 'TN' }]) };
  const p = await svc.previewStaleCleanup(['O1'], RoleType.SuperAdmin);
  expect(p.stepsFilled.map((s) => s.key)).toEqual(['tool-check', 'designer', 'print', 'press', 'qc-post-press', 'sew-in', 'sew-out', 'pack']);
  expect(p.neverProduced).toBe(1);
  expect(p.completedTo!.getTime()).toBeLessThan(Date.now());
});
