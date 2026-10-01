import { FulfillmentStage, GetProductionOrdersZod, PRODUCT_LINE_WINDOW_DAYS, RoleType } from 'shared';

import { OrderService } from './order.service';

/**
 * Sidebar badge `productLineCounts` must equal the row count behind the menu entry
 * (`GET /orders?productLine=X&workshopStage=__open__` over the product-line window).
 * The badge is built from the same `buildOrderListFilter`, so the strongest check is
 * structural: badge `$match` + `productLine: X` must be exactly the page filter.
 */
type Svc = {
  orderModel: { db: unknown; aggregate: jest.Mock };
  buildOrderListFilter: (...args: unknown[]) => Record<string, unknown>;
  countOpenOrdersByProductLine: (...args: unknown[]) => Promise<Record<string, number>>;
};

const NOW = new Date('2026-10-01T03:00:00.000Z'); // 10:00 VN, 1 Oct
const make = (rows: Array<{ _id: string | null; n: number }> = []) => {
  const svc = Object.create(OrderService.prototype) as Svc;
  svc.orderModel = { db: {}, aggregate: jest.fn().mockResolvedValue(rows) };
  return svc;
};
const pageFilter = (svc: Svc, productLine: string, ...scope: unknown[]) =>
  svc.buildOrderListFilter(
    GetProductionOrdersZod.parse({
      page: 1,
      limit: 20,
      productLine,
      workshopStage: '__open__',
      createdFrom: '2026-09-25', // today - (window - 1), VN
      createdTo: '2026-10-01',
    }),
    ...scope,
  );

beforeAll(() => {
  jest.useFakeTimers({ now: NOW });
});
afterAll(() => {
  jest.useRealTimers();
});

describe('workshopStage=__open__', () => {
  it('is accepted by the DTO; junk is not', () => {
    expect(GetProductionOrdersZod.parse({ page: 1, limit: 20, workshopStage: '__open__' }).workshopStage).toBe('__open__');
    expect(() => GetProductionOrdersZod.parse({ page: 1, limit: 20, workshopStage: '__all__' })).toThrow();
  });

  it('is the exact complement of done', () => {
    const svc = make();
    const and = (stage: string) =>
      (svc.buildOrderListFilter(GetProductionOrdersZod.parse({ page: 1, limit: 20, workshopStage: stage })).$and as unknown[])[0];
    expect(and('done')).toEqual({ fulfillmentCompletedAt: { $exists: true, $ne: null } });
    expect(and('__open__')).toEqual({ fulfillmentCompletedAt: { $in: [null] } });
  });
});

describe('countOpenOrdersByProductLine — same filter as the page', () => {
  it('window is 7 VN days ending today', () => {
    expect(PRODUCT_LINE_WINDOW_DAYS).toBe(7);
  });

  it.each([
    ['Admin', [RoleType.Admin]],
    ['Fulfillment press worker (factory scope in $or)', [RoleType.Fulfillment, 'u1', 'FACTORY_X', FulfillmentStage.Press]],
    ['Fulfillment print worker (admin-like view)', [RoleType.Fulfillment, 'u1', 'FACTORY_X', FulfillmentStage.Print]],
    ['Designer (own tasks)', [RoleType.Designer, 'u1']],
  ])('%s: badge $match + productLine === page filter (+ deletedAt)', async (_name, scope) => {
    const svc = make();
    await svc.countOpenOrdersByProductLine(...scope);
    const match = svc.orderModel.aggregate.mock.calls[0][0][0].$match;
    expect({ ...match, productLine: { $in: ['wood'] } }).toEqual({
      ...pageFilter(svc, 'wood', ...scope),
      deletedAt: { $exists: false },
    });
  });

  it('zero-fills every line, maps null/unknown to __none__', async () => {
    const svc = make([
      { _id: '3d', n: 616 },
      { _id: 'embroidery', n: 41 },
      { _id: '2d', n: 34 },
      { _id: null, n: 2 },
      { _id: 'legacy-junk', n: 1 },
    ]);
    expect(await svc.countOpenOrdersByProductLine(RoleType.Admin)).toEqual({
      '3d': 616,
      '2d': 34,
      wood: 0,
      embroidery: 41,
      led: 0,
      canvas: 0,
      __none__: 3,
    });
  });
});
