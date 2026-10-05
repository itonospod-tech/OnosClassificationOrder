import { FulfillmentStage, GetProductionOrdersZod, OPEN_ORDER_STALE_DAYS, PRODUCT_LINE_WINDOW_DAYS, RoleType } from 'shared';

import { loadExcludedFactoryId } from '../../utils/excluded-factory';
import { OrderService, productLineOutOfWindowRange } from './order.service';

/**
 * Product-line "older open orders" indicator. The number must equal what the page lists after the
 * click (createdFrom/createdTo set to the returned from/to, nothing else changed). Checked
 * structurally: the indicator's count filter must be exactly the total filter of that next request.
 */
type Filter = Record<string, unknown>;
type Data = { outOfWindow?: { from: string; to: string; count: number }; totalOrders: number };

const NOW = new Date('2026-10-05T03:00:00.000Z'); // 10:00 VN, 5 Oct
const US_ID = 'USFACTORY0000001';
beforeAll(async () => {
  jest.useFakeTimers({ now: NOW });
  await loadExcludedFactoryId({ collection: () => ({ findOne: () => Promise.resolve({ _id: US_ID }) }) } as never);
});
afterAll(() => jest.useRealTimers());

const make = () => {
  const counts: Filter[] = [];
  const pipelines: Array<Array<Record<string, unknown>>> = [];
  const svc = Object.create(OrderService.prototype) as unknown as {
    [k: string]: unknown;
    getWorkshopAvailableFilters: (...a: unknown[]) => Promise<{ data: Data }>;
  };
  svc.orderModel = {
    db: {},
    countDocuments: (f: Filter) => {
      counts.push(f);
      return Promise.resolve(42);
    },
    aggregate: (p: Array<Record<string, unknown>>) => {
      pipelines.push(p);
      return Promise.resolve([]);
    },
  };
  svc.userModel = { find: () => ({ lean: () => Promise.resolve([]) }) };
  svc.workshopConfigRepository = { findAll: () => Promise.resolve([]) };
  svc.resolveToolHasCodes = () => Promise.resolve([]);
  return { svc, counts, pipelines };
};

/** `$and` member order carries no meaning. */
const norm = (f: Filter): Filter =>
  Array.isArray(f.$and) ? { ...f, $and: [...(f.$and as unknown[])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) } : f;
/** The page total ("dòng tổng"): the aggregate grouping by type then summing orders. */
const totalMatchOf = (pipelines: Array<Array<Record<string, unknown>>>) =>
  pipelines.find((p) => JSON.stringify(p).includes('"types":{"$sum":1}'))![0].$match as Filter;
/** 2026-08-22 00:00 VN, the `from` day start as stored (UTC). */
const FROM_START = '2026-08-21T17:00:00.000Z';

describe('productLineOutOfWindowRange', () => {
  it('covers the VN days between the line window and the stale horizon', () => {
    expect(productLineOutOfWindowRange('2026-10-05')).toEqual({ from: '2026-08-22', to: '2026-09-28' });
    // window [09-29 .. 10-05] (7 days) + this range (38 days) = the 45-day stale horizon, no gap, no overlap.
    expect(PRODUCT_LINE_WINDOW_DAYS + 38).toBe(OPEN_ORDER_STALE_DAYS);
  });
  it('crosses month and year boundaries', () => {
    expect(productLineOutOfWindowRange('2026-01-03')).toEqual({ from: '2025-11-20', to: '2025-12-27' });
  });
});

const SCOPES: Array<[string, unknown[], Record<string, unknown>]> = [
  ['Admin', [RoleType.Admin], {}],
  ['Admin, header factory', [RoleType.Admin], { factoryId: '80HF1JV8P6CLEBUQ' }],
  ['Admin, header factory = US', [RoleType.Admin], { factoryId: US_ID }],
  ['Fulfillment press worker', [RoleType.Fulfillment, 'u1', '6V0E0LUT55TVR5YJ', FulfillmentStage.Press], {}],
  ['Fulfillment print worker', [RoleType.Fulfillment, 'u1', '6V0E0LUT55TVR5YJ', FulfillmentStage.Print], {}],
  ['Designer', [RoleType.Designer, 'u1'], {}],
];

describe.each(SCOPES)('outOfWindow — %s', (_name, scope, extra) => {
  const base = { page: 1, limit: 20, productLine: '3d', workshopStage: '__open__', createdFrom: '2026-09-29', createdTo: '2026-10-05', ...extra };

  it('count filter == page total filter after the click', async () => {
    const first = make();
    const res = await first.svc.getWorkshopAvailableFilters(GetProductionOrdersZod.parse(base), ...scope);
    expect(res.data.outOfWindow).toEqual({ from: '2026-08-22', to: '2026-09-28', count: 42 });
    const countFilter = first.counts.find((f) => JSON.stringify(f).includes(FROM_START))!;
    expect(countFilter).toBeDefined();

    const after = make();
    const { from, to } = res.data.outOfWindow!;
    await after.svc.getWorkshopAvailableFilters(GetProductionOrdersZod.parse({ ...base, createdFrom: from, createdTo: to }), ...scope);
    expect(norm(countFilter)).toEqual(norm(totalMatchOf(after.pipelines)));
  });
});

it('is absent outside product-line views', async () => {
  const { svc } = make();
  const res = await svc.getWorkshopAvailableFilters(GetProductionOrdersZod.parse({ page: 1, limit: 20 }), RoleType.Admin);
  expect(res.data.outOfWindow).toBeUndefined();
});
