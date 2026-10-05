import { FulfillmentStage, GetProductionOrdersZod, RoleType } from 'shared';

import { andWith } from './and-with';
import { OrderService } from './order.service';

/**
 * Shared order-filter builders used to assign `filter.$or` directly. The Fulfillment
 * factory scope also lives in `filter.$or` (`buildVisibilityFilter`), so:
 *   - search / printStage=not-printed OVERWROTE it → a worker typing anything in the
 *     search box saw every factory's orders;
 *   - the five `__none__` + real-value facets APPENDED to it → scope OR facet.
 * These tests lock the fix: every extra condition goes through `$and`.
 */
const svc = Object.create(OrderService.prototype) as {
  orderModel: unknown;
  buildOrderListFilter: (
    dto: unknown,
    roleName?: RoleType,
    assigneeCode?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ) => Record<string, unknown>;
};
svc.orderModel = { db: {} };

const dto = (q: Record<string, unknown>) => GetProductionOrdersZod.parse({ page: 1, limit: 20, ...q });
const asAdmin = (q: Record<string, unknown>) => svc.buildOrderListFilter(dto(q), RoleType.Admin);
const asWorker = (q: Record<string, unknown>) =>
  svc.buildOrderListFilter(dto(q), RoleType.Fulfillment, undefined, 'FACTORY_X', FulfillmentStage.Press);

const SCOPE = [{ factoryId: 'FACTORY_X' }, { originalFactoryId: 'FACTORY_X' }];

/** `__none__` + a real value for each facet that used to append to `$or`. */
const NONE_FACETS: Array<[string, Record<string, unknown>]> = [
  ['toolResultNote', { toolResultNote: '__none__,ok' }],
  ['type', { type: ['__none__', 'Hoodie'] }],
  ['toolResult', { toolResult: '__none__,has-tool' }],
  ['designerStatus', { designerStatus: '__none__,assigned' }],
  ['assignee', { assignee: '__none__,user-1' }],
];

const andOf = (f: Record<string, unknown>) => (f.$and as Array<Record<string, unknown>>) ?? [];

describe('1. search + facet → AND, not OR', () => {
  it.each(NONE_FACETS)('search + %s: two separate $and clauses, no top-level $or', (_name, q) => {
    const f = asAdmin({ search: 'ABC-123', ...q });
    expect(f.$or).toBeUndefined();
    const ors = andOf(f).map((c) => JSON.stringify(c.$or));
    expect(ors.some((o) => o?.includes('ABC-123'))).toBe(true);
    // The facet clause is its own $and member, never merged with the search $or.
    expect(ors.filter((o) => o?.includes('ABC-123'))).toHaveLength(1);
    expect(andOf(f).length).toBeGreaterThanOrEqual(2);
  });
});

describe('2. two __none__ facets at once → AND of two ORs', () => {
  it('toolResult + assignee each get their own $or inside $and', () => {
    const f = asAdmin({ toolResult: '__none__,has-tool', assignee: '__none__,user-1' });
    expect(f.$or).toBeUndefined();
    expect(andOf(f)).toEqual(
      expect.arrayContaining([
        { $or: [{ toolResult: { $in: [null, ''] } }, { toolResult: { $in: ['has-tool'] } }] },
        { $or: [{ assignee: { $in: [null, ''] } }, { assignee: { $in: ['user-1'] } }] },
      ]),
    );
  });
});

describe('3. Fulfillment factory scope is never dropped or widened', () => {
  it('baseline: scope is the top-level $or', () => {
    expect(asWorker({}).$or).toEqual(SCOPE);
  });

  it('search keeps the scope (this was the live leak)', () => {
    const f = asWorker({ search: 'ABC-123' });
    expect(f.$or).toEqual(SCOPE);
    expect(JSON.stringify(f.$and)).toContain('ABC-123');
  });

  it('printStage=not-printed keeps the scope', () => {
    expect(asWorker({ printStage: 'not-printed' }).$or).toEqual(SCOPE);
  });

  it.each(NONE_FACETS)('%s with __none__ + a real value keeps the scope', (_name, q) => {
    expect(asWorker(q).$or).toEqual(SCOPE);
  });

  it('search + every facet at once still keeps the scope', () => {
    const all = Object.assign({ search: 'ABC-123', printStage: 'not-printed' }, ...NONE_FACETS.map(([, q]) => q));
    expect(asWorker(all).$or).toEqual(SCOPE);
  });

  it('unmapped=true no longer replaces an existing $and', () => {
    // designerStatus=__unassigned_notool__ pushes into $and BEFORE the unmapped block;
    // the old unmapped code rebuilt $and from scratch and silently dropped it.
    const f = asAdmin({ unmapped: 'true', search: 'ABC-123', designerStatus: '__unassigned_notool__' });
    const and = JSON.stringify(f.$and);
    expect(and).toContain('ABC-123');
    expect(and).toContain('"factoryId":null');
    expect(and).toContain('"toolResultNote":{"$ne":"ok"}');
  });
});

describe('3b. explicit ?factoryId can only NARROW a Fulfillment factory lock', () => {
  const OWN = 'FACTORY_OWN00001';
  const OTHER = 'FACTORY_OTHER001';
  const build = (q: Record<string, unknown>, ...scope: unknown[]) =>
    svc.buildOrderListFilter(GetProductionOrdersZod.parse({ page: 1, limit: 20, ...q }), ...(scope as []));
  const ands = (f: Record<string, unknown>) => (f.$and as unknown[]) ?? [];

  it('print-stage worker (lock = factoryId equality): other factory is ANDed, lock kept', () => {
    const f = build({ factoryId: OTHER }, RoleType.Fulfillment, 'u1', OWN, FulfillmentStage.Print);
    expect(f.factoryId).toBe(OWN); // used to become OTHER — the leak
    expect(ands(f)).toContainEqual({ factoryId: OTHER }); // OWN AND OTHER → empty
  });

  it('other-stage worker (lock = $or): scope $or kept, other factory ANDed', () => {
    const f = build({ factoryId: OTHER }, RoleType.Fulfillment, 'u1', OWN, FulfillmentStage.Press);
    expect(f.$or).toEqual([{ factoryId: OWN }, { originalFactoryId: OWN }]);
    expect(ands(f)).toContainEqual({ factoryId: OTHER });
  });

  it.each([FulfillmentStage.Print, FulfillmentStage.Press])(
    'worker without a factory (%s): __no_factory__ lock is kept',
    (stage) => {
      const f = build({ factoryId: OTHER }, RoleType.Fulfillment, 'u1', undefined, stage);
      expect(f.factoryId).toBe('__no_factory__');
      expect(ands(f)).toContainEqual({ factoryId: OTHER });
    },
  );

  it('worker picking their OWN factory still sees it (narrowing, not blocking)', () => {
    const f = build({ factoryId: OWN }, RoleType.Fulfillment, 'u1', OWN, FulfillmentStage.Print);
    expect(f.factoryId).toBe(OWN);
    expect(ands(f)).toContainEqual({ factoryId: OWN });
  });

  it('Designer (not factory-locked): explicit factory replaces the default clause, own-task lock kept', () => {
    const f = build({ factoryId: OTHER }, RoleType.Designer, 'u1');
    expect(f.factoryId).toBe(OTHER);
    expect(f.assignee).toBe('u1');
  });

  it('Admin: explicit factory replaces the default clause (keeps US viewable, Orders.md §21)', () => {
    const f = build({ factoryId: OTHER }, RoleType.Admin);
    expect(f.factoryId).toBe(OTHER);
    expect(ands(f)).not.toContainEqual({ factoryId: OTHER });
  });
});

describe('4. andWith (also used by the facet "none" counts)', () => {
  it('appends to an existing $and and keeps $or', () => {
    const base = { $or: SCOPE, $and: [{ a: 1 }] };
    const match: Record<string, unknown> = { ...base, cancelledAt: { $exists: false } };
    andWith(match, { $or: [{ b: null }] });
    expect(match.$and).toEqual([{ a: 1 }, { $or: [{ b: null }] }]);
    expect(match.$or).toEqual(SCOPE);
  });

  it('does not mutate the source filter it was spread from', () => {
    const base = { $and: [{ a: 1 }] };
    const match: Record<string, unknown> = { ...base };
    andWith(match, { b: 2 });
    expect(base.$and).toEqual([{ a: 1 }]);
  });

  it('creates $and when missing', () => {
    const match: Record<string, unknown> = {};
    andWith(match, { b: 2 });
    expect(match.$and).toEqual([{ b: 2 }]);
  });
});
