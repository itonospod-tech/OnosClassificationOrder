import { CustomerOrderService } from './customer-order.service';

/**
 * Shadow production-cost ledger, as seen from `pushToProduction`.
 *
 * What these cases pin: the ledger is written with OUR cost (`variations[].cost`),
 * never the seller price; a retried push cannot double-count; and a ledger failure
 * can neither fail the push nor release the push claims.
 */
interface PushSurface {
  pushToProduction(customer: unknown, dto: { ids: string[] }): Promise<{ data: { results: Array<{ status: string }> } }>;
  [k: string]: unknown;
}
type BulkOp = { updateOne: { filter: { productionId: string }; update: { $setOnInsert: Record<string, unknown> }; upsert: boolean } };

const staging = {
  _id: 'S1',
  orderId: 'EXT-1',
  status: 'pending',
  pushedAt: null,
  createdAt: new Date('2026-10-04T01:00:00.000Z'),
  shippingAddress: { firstName: 'A', address1: 'X', city: 'Hanoi' },
  items: [{ productionId: 'AA-00001-00001', type: 'CAMO SHIRT', size: 'S', quantity: 3 }],
};

const buildService = (opts: { bulkWrite?: (ops: BulkOp[]) => Promise<unknown> } = {}) => {
  const bulkCalls: BulkOp[][] = [];
  const releases: string[][] = [];
  const svc = Object.create(CustomerOrderService.prototype) as PushSurface;
  svc.systemConfigService = { get: () => Promise.resolve(false) };
  svc.loadPushTargets = () => Promise.resolve([{ id: 'S1', doc: staging }]);
  svc.buildPricingContext = () => Promise.resolve({});
  svc.promotionService = { getActiveInDateRange: () => Promise.resolve([]) };
  svc.quoteStagingOrder = () => ({
    quotes: [
      {
        type: 'CAMO SHIRT',
        size: 'S',
        productConfigId: 'PC1',
        variationSku: 'CAMO-S',
        // The seller price (14.51) is deliberately different from our cost (5.6).
        unitCost: 5.6,
        snapshot: { shipMethod: 'cod', unitPrice: 14.51, lineTotal: 43.53 },
      },
    ],
    orderTotal: 43.53,
  });
  svc.assertArtworkComplete = () => undefined;
  svc.claimPush = () => Promise.resolve(true);
  svc.releasePushClaims = (ids: string[]) => {
    releases.push(ids);
    return Promise.resolve();
  };
  svc.orderService = { importOrders: () => Promise.resolve(undefined) };
  svc.customerPaymentModel = { create: () => Promise.resolve({ _id: 'P1' }) };
  svc.customerOrderModel = { updateOne: () => Promise.resolve({ modifiedCount: 1 }) };
  svc.customerOrderEventService = { emit: () => undefined };
  svc.designStorageService = {
    touchUsageForUrls: () => Promise.resolve(undefined),
    enqueueUrlIngest: () => Promise.resolve(undefined),
  };
  svc.productionCostModel = {
    bulkWrite: (ops: BulkOp[]) => {
      bulkCalls.push(ops);
      return opts.bulkWrite ? opts.bulkWrite(ops) : Promise.resolve({});
    },
  };
  return { svc, bulkCalls, releases };
};

const customer = { _id: 'C1', userSku: 'TIKTOKSHOPUS', userEmail: 'a@b.com', fullName: 'A', tier: null };

describe('push to production — shadow production cost ledger', () => {
  it('records our cost per unit and the line amount, not the seller price', async () => {
    const { svc, bulkCalls } = buildService();
    await svc.pushToProduction(customer, { ids: ['S1'] });

    expect(bulkCalls).toHaveLength(1);
    const row = bulkCalls[0][0].updateOne.update.$setOnInsert;
    expect(row).toMatchObject({
      productionId: 'AA-00001-00001',
      customerId: 'C1',
      stagingOrderId: 'S1',
      productConfigId: 'PC1',
      variationSku: 'CAMO-S',
      unitCost: 5.6,
      quantity: 3,
      amount: 16.8,
    });
    expect(row.unitCost).not.toBe(14.51);
  });

  it('upserts by productionId with $setOnInsert, so a retried push never double-counts', async () => {
    const { svc, bulkCalls } = buildService();
    await svc.pushToProduction(customer, { ids: ['S1'] });

    const op = bulkCalls[0][0].updateOne;
    expect(op.filter).toEqual({ productionId: 'AA-00001-00001' });
    expect(op.upsert).toBe(true);
    expect(Object.keys(op.update)).toEqual(['$setOnInsert']);
  });

  it('a ledger failure neither fails the push nor releases the push claims', async () => {
    const { svc, releases } = buildService({ bulkWrite: () => Promise.reject(new Error('mongo down')) });
    const res = await svc.pushToProduction(customer, { ids: ['S1'] });

    expect(res.data.results[0].status).toBe('pushed');
    expect(releases).toEqual([]);
  });
});
