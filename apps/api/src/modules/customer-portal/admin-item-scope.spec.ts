import { ORDER_PRIORITIES } from 'shared';

import { CustomerOrderService } from './customer-order.service';

/**
 * Hub order list `factoryId` / `priority` (legacy `manufacture` + `Priority`): an order matches
 * when one of its non-cancelled items is in scope. The scope is resolved to the exact set of
 * production ids, with NO cap — a cap that falls back to "no filter" would list every factory.
 */
const make = (pids: string[]) => {
  const distinct = jest.fn().mockResolvedValue(pids);
  const svc = Object.create(CustomerOrderService.prototype) as {
    customerOrderModel: unknown;
    adminItemScopeStages: (dto: { factoryId?: string; priority?: boolean }) => Promise<Record<string, unknown>[]>;
  };
  svc.customerOrderModel = { db: { collection: () => ({ distinct }) } };
  return { svc, distinct };
};

describe('adminItemScopeStages', () => {
  it('no scope → no stage, no query', async () => {
    const { svc, distinct } = make([]);
    expect(await svc.adminItemScopeStages({})).toEqual([]);
    expect(await svc.adminItemScopeStages({ priority: false })).toEqual([]);
    expect(distinct).not.toHaveBeenCalled();
  });

  it('factory → non-cancelled production orders of that factory', async () => {
    const { svc, distinct } = make(['A', 'B']);
    const stages = await svc.adminItemScopeStages({ factoryId: 'F1' });
    expect(distinct).toHaveBeenCalledWith('productionId', { cancelledAt: null, productionId: { $ne: null }, factoryId: 'F1' });
    expect(stages).toEqual([{ $match: { 'items.productionId': { $in: ['A', 'B'] } } }]);
  });

  it('priority + factory → both conditions on the same item', async () => {
    const { svc, distinct } = make([]);
    await svc.adminItemScopeStages({ factoryId: 'F1', priority: true });
    expect(distinct.mock.calls[0][1]).toEqual({
      cancelledAt: null,
      productionId: { $ne: null },
      factoryId: 'F1',
      priority: { $in: ORDER_PRIORITIES },
    });
  });

  it('keeps a scope that matches nothing as an empty $in (shows 0 orders, not all)', async () => {
    const { svc } = make([]);
    expect(await svc.adminItemScopeStages({ factoryId: 'F_EMPTY' })).toEqual([{ $match: { 'items.productionId': { $in: [] } } }]);
  });

  it('has no cap: 50k ids stay a filter', async () => {
    const many = Array.from({ length: 50_000 }, (_, i) => `P${i}`);
    const { svc } = make(many);
    const [stage] = await svc.adminItemScopeStages({ factoryId: 'F1' });
    expect((stage.$match as { 'items.productionId': { $in: string[] } })['items.productionId'].$in).toHaveLength(50_000);
  });
});
