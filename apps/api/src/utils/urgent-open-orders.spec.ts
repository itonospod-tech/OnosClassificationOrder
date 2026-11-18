import { OrderPriority, RoleType } from 'shared';

import { buildUrgentOpenOrdersFilter } from './urgent-open-orders';

describe('buildUrgentOpenOrdersFilter (Orders.md §17.6)', () => {
  const defaultClause = { $exists: true, $nin: [null, 'US'] };
  const base = {
    priority: OrderPriority.Urgent,
    deletedAt: { $exists: false },
    cancelledAt: { $exists: false },
    fulfillmentCompletedAt: { $in: [null] },
  };

  it('admin: open level-4 orders of every production factory', () => {
    expect(buildUrgentOpenOrdersFilter({ roleName: RoleType.Admin }, defaultClause)).toEqual({
      ...base,
      factoryId: defaultClause,
    });
  });

  it('an explicit factory replaces the default factory clause (US can be viewed when picked)', () => {
    expect(buildUrgentOpenOrdersFilter({ roleName: RoleType.Manager, factoryId: 'US' }, defaultClause)).toEqual({
      ...base,
      factoryId: 'US',
    });
  });

  it('designer is not narrowed to own tasks — the page is read-only across stages', () => {
    expect(buildUrgentOpenOrdersFilter({ roleName: RoleType.Designer }, defaultClause).factoryId).toBe(defaultClause);
  });

  it('fulfillment is locked to its own factory', () => {
    expect(
      buildUrgentOpenOrdersFilter({ roleName: RoleType.Fulfillment, fulfillmentFactoryId: 'TN' }, defaultClause),
    ).toEqual({ ...base, factoryId: 'TN' });
  });

  it('fulfillment picking another factory only narrows (returns nothing), never leaks it', () => {
    const f = buildUrgentOpenOrdersFilter(
      { roleName: RoleType.Fulfillment, fulfillmentFactoryId: 'TN', factoryId: 'ML' },
      defaultClause,
    );
    expect(f.factoryId).toBe('TN');
    expect(f.$and).toEqual([{ factoryId: 'ML' }]);
  });

  it('fulfillment without a factory sees nothing', () => {
    expect(buildUrgentOpenOrdersFilter({ roleName: RoleType.Fulfillment }, defaultClause).factoryId).toBe(
      '__no_factory__',
    );
  });
});

describe('buildUrgentOpenOrdersFilter — completedSince', () => {
  it('also matches orders packed since the given time (open orders still match: $not $lt keeps null/missing)', () => {
    const since = new Date('2026-11-17T17:00:00Z');
    const f = buildUrgentOpenOrdersFilter({ roleName: RoleType.Admin }, { $exists: true, $ne: null }, since);
    expect(f.fulfillmentCompletedAt).toEqual({ $not: { $lt: since } });
  });
});
