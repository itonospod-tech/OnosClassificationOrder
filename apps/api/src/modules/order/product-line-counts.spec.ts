import { FulfillmentStage, GetProductionOrdersZod, PRODUCT_LINE_WINDOW_DAYS, RoleType } from 'shared';

import { loadExcludedFactoryId } from '../../utils/excluded-factory';
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
  countOpenOrdersByProductLine: (
    ...args: unknown[]
  ) => Promise<{ total: Record<string, number>; byFactory: Record<string, Record<string, number>> }>;
};

const NOW = new Date('2026-10-01T03:00:00.000Z'); // 10:00 VN, 1 Oct
const make = (rows: unknown[] = []) => {
  const svc = Object.create(OrderService.prototype) as Svc;
  svc.orderModel = { db: {}, aggregate: jest.fn().mockResolvedValue(rows) };
  return svc;
};
const pageFilter = (svc: Svc, productLine: string, extra: Record<string, unknown>, ...scope: unknown[]) =>
  svc.buildOrderListFilter(
    GetProductionOrdersZod.parse({
      page: 1,
      limit: 20,
      ...extra,
      productLine,
      workshopStage: '__open__',
      createdFrom: '2026-09-25', // today - (window - 1), VN
      createdTo: '2026-10-01',
    }),
    ...scope,
  );

const US_ID = 'USFACTORY0000001';
beforeAll(async () => {
  jest.useFakeTimers({ now: NOW });
  // Prime the excluded-factory cache so the default filter really excludes "US".
  await loadExcludedFactoryId({ collection: () => ({ findOne: () => Promise.resolve({ _id: US_ID }) }) } as never);
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

/** `$and` member order carries no meaning; sort it so filters compare by content. */
const norm = (f: Record<string, unknown>) =>
  Array.isArray(f.$and)
    ? { ...f, $and: [...f.$and].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
    : f;
const pipelineOf = (svc: Svc) => svc.orderModel.aggregate.mock.calls[0][0];
const totalMatchOf = (svc: Svc) => pipelineOf(svc)[1].$facet.total[0].$match;
const outerMatchOf = (svc: Svc) => pipelineOf(svc)[0].$match;

const SCOPES: Array<[string, unknown[], string]> = [
  // [name, scope args, factory the role may scope the page to]
  ['Admin', [RoleType.Admin], '80HF1JV8P6CLEBUQ'],
  ['Fulfillment press worker (factory scope in $or)', [RoleType.Fulfillment, 'u1', '6V0E0LUT55TVR5YJ', FulfillmentStage.Press], '6V0E0LUT55TVR5YJ'],
  ['Fulfillment print worker (admin-like view)', [RoleType.Fulfillment, 'u1', '6V0E0LUT55TVR5YJ', FulfillmentStage.Print], '6V0E0LUT55TVR5YJ'],
  ['Designer (own tasks)', [RoleType.Designer, 'u1'], '80HF1JV8P6CLEBUQ'],
];

describe('countOpenOrdersByProductLine — same filter as the page', () => {
  it('window is 7 VN days ending today', () => {
    expect(PRODUCT_LINE_WINDOW_DAYS).toBe(7);
  });

  it.each(SCOPES)('%s — total: facet $match + productLine === page filter', async (_name, scope) => {
    const svc = make();
    await svc.countOpenOrdersByProductLine(...scope);
    expect({ ...totalMatchOf(svc), productLine: { $in: ['wood'] } }).toEqual(pageFilter(svc, 'wood', {}, ...scope));
  });

  it.each(SCOPES)('%s — per factory: outer $match + factoryId + productLine === page with ?factoryId', async (_name, scope, fid) => {
    const svc = make();
    await svc.countOpenOrdersByProductLine(...scope);
    const outer = outerMatchOf(svc);
    // Fulfillment: the page ANDs the explicit factory onto the role's factory lock;
    // other roles replace the default factory clause. Same set as the badge's group key.
    const scoped =
      scope[0] === RoleType.Fulfillment
        ? { ...outer, $and: [...((outer.$and as unknown[]) ?? []), { factoryId: fid }] }
        : { ...outer, factoryId: fid };
    expect(norm({ ...scoped, productLine: { $in: ['wood'] } })).toEqual(
      norm({ ...pageFilter(svc, 'wood', { factoryId: fid }, ...scope), deletedAt: { $exists: false } }),
    );
  });

  it('US factory: the total excludes it, the per-factory branch matches a page scoped to US', async () => {
    const svc = make();
    await svc.countOpenOrdersByProductLine(RoleType.Admin);
    expect(totalMatchOf(svc).factoryId).toEqual({ $exists: true, $nin: [null, US_ID] });
    expect(outerMatchOf(svc).factoryId).toEqual({ $exists: true, $ne: null });
    expect({ ...outerMatchOf(svc), factoryId: US_ID, productLine: { $in: ['3d'] } }).toEqual({
      ...pageFilter(svc, '3d', { factoryId: US_ID }, RoleType.Admin),
      deletedAt: { $exists: false },
    });
  });

  it('total and per-factory shaping: zero-fill, null/unknown → __none__, no null factory', async () => {
    const svc = make([
      {
        total: [
          { _id: '3d', n: 616 },
          { _id: 'embroidery', n: 41 },
          { _id: '2d', n: 34 },
          { _id: null, n: 2 },
          { _id: 'legacy-junk', n: 1 },
        ],
        byFactory: [
          { _id: { line: '3d', factoryId: 'TN' }, n: 600 },
          { _id: { line: '3d', factoryId: 'ML' }, n: 16 },
          { _id: { line: null, factoryId: 'ML' }, n: 2 },
          { _id: { line: '2d', factoryId: null }, n: 9 },
        ],
      },
    ]);
    const res = await svc.countOpenOrdersByProductLine(RoleType.Admin);
    expect(res.total).toEqual({ '3d': 616, '2d': 34, wood: 0, embroidery: 41, led: 0, canvas: 0, dropship: 0, __none__: 3 });
    expect(Object.keys(res.byFactory).sort()).toEqual(['ML', 'TN']);
    expect(res.byFactory.TN).toEqual({ '3d': 600, '2d': 0, wood: 0, embroidery: 0, led: 0, canvas: 0, dropship: 0, __none__: 0 });
    expect(res.byFactory.ML).toMatchObject({ '3d': 16, __none__: 2 });
  });
});
