import { OrderPriority } from 'shared';

import { withUrgentDateBypass } from './urgent-date-bypass';

describe('withUrgentDateBypass (Orders.md §17.5)', () => {
  const range = { $gte: new Date('2026-11-10T00:00:00Z'), $lte: new Date('2026-11-17T00:00:00Z') };

  it('lets priority-4 orders through the inProductionAt window, keeping every other clause', () => {
    const factoryOr = [{ factoryId: 'F' }, { originalFactoryId: 'F' }];
    const out = withUrgentDateBypass({ cancelledAt: null, $or: factoryOr, inProductionAt: range });
    expect(out).toEqual({
      cancelledAt: null,
      $or: factoryOr,
      $and: [{ $or: [{ inProductionAt: range }, { priority: OrderPriority.Urgent }] }],
    });
  });

  it('appends to an existing $and instead of replacing it', () => {
    const out = withUrgentDateBypass({ $and: [{ a: 1 }], inProductionAt: range });
    expect(out.$and).toEqual([{ a: 1 }, { $or: [{ inProductionAt: range }, { priority: OrderPriority.Urgent }] }]);
  });

  it('is a no-op without a date window (all-time query)', () => {
    const f: { cancelledAt: null; inProductionAt?: unknown } = { cancelledAt: null };
    expect(withUrgentDateBypass(f)).toBe(f);
  });
});
