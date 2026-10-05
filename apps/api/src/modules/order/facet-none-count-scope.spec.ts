import { FulfillmentStage, GetProductionOrdersZod, RoleType } from 'shared';

import { OrderService } from './order.service';

/**
 * The three "none" facet counts (toolResultNote / toolResult / type) used to call
 * buildOrderListFilter without the Fulfillment factory + stage, so a worker's scope
 * collapsed to `factoryId: '__no_factory__'` and the counts were always 0.
 */
describe('getWorkshopAvailableFilters — "none" counts keep the Fulfillment factory scope', () => {
  type Filter = Record<string, unknown>;
  const countFilters: Filter[] = [];
  const svc = Object.create(OrderService.prototype) as unknown as {
    [k: string]: unknown;
    getWorkshopAvailableFilters: (...a: unknown[]) => Promise<unknown>;
  };
  svc.orderModel = {
    db: {},
    countDocuments: (f: Filter) => {
      countFilters.push(f);
      return Promise.resolve(0);
    },
    aggregate: () => Promise.resolve([]),
  };
  svc.userModel = { find: () => ({ lean: () => Promise.resolve([]) }) };
  svc.workshopConfigRepository = { findAll: () => Promise.resolve([]) };
  svc.resolveToolHasCodes = () => Promise.resolve([]);

  it.each([FulfillmentStage.Print, FulfillmentStage.Press])(
    'stage %s: scoped to the worker factory, not __no_factory__',
    async (stage) => {
      countFilters.length = 0;
      const dto = GetProductionOrdersZod.parse({ page: 1, limit: 20 });
      await svc.getWorkshopAvailableFilters(dto, RoleType.Fulfillment, 'u1', 'FACTORY_X', stage).catch(() => undefined);
      const noneCounts = countFilters.filter((f) => JSON.stringify(f).includes('$exists'));
      expect(noneCounts.length).toBeGreaterThanOrEqual(3);
      for (const f of noneCounts) expect(JSON.stringify(f)).not.toContain('__no_factory__');
      expect(noneCounts.some((f) => JSON.stringify(f).includes('FACTORY_X'))).toBe(true);
    },
  );
});
