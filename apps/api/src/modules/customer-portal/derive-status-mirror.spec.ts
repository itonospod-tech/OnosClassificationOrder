// HALF OF THIS SUITE IS SKIPPED UNLESS ENABLED. The JS-vs-Mongo mirror check only runs with
// DERIVE_MIRROR_MONGO_URI set (no in-memory Mongo in this repo). Anyone editing deriveItemStatus,
// toStagingOrder or buildDerivePipeline MUST run it, or the mirror is unchecked:
//   DERIVE_MIRROR_MONGO_URI='mongodb://localhost:27017/onos_derive_mirror?replicaSet=rs0&directConnection=true' \
//     NODE_ENV=test npx jest src/modules/customer-portal/derive-status-mirror
import mongoose from 'mongoose';
import { CustomerOrderStatus } from 'shared';

import { CustomerOrderService, deriveItemStatus } from './customer-order.service';

/**
 * Customer order status is derived twice: in JS (`deriveItemStatus` + the min-progress loop in
 * `toStagingOrder`, used by detail/track) and in Mongo (`buildDerivePipeline` → `statusDerived`,
 * used by lists/counts). Rule: In Production = pushed and not fulfilled, whatever the stage —
 * a pushed item is never Processing (LegacyClone-Orders.md §7).
 *
 * The JS cases always run. The mirror check needs a real Mongo (a mock cannot evaluate a
 * pipeline): set `DERIVE_MIRROR_MONGO_URI` to a SCRATCH database, it is dropped afterwards, e.g.
 *   DERIVE_MIRROR_MONGO_URI='mongodb://localhost:27017/onos_derive_mirror?replicaSet=rs0&directConnection=true'
 */
const cutoff = new Date('2026-09-20T00:00:00Z');
const before = new Date('2026-09-10T00:00:00Z'); // fulfilled before cutoff → Completed
const after = new Date('2026-09-25T00:00:00Z'); // fulfilled after cutoff → Fulfilled

type Prod = Record<string, unknown> & { productionId: string };
const prod: Record<string, Prod> = {
  noStage: { productionId: 'P-NOSTAGE' }, // tool check / design, never reached fulfillment
  print: { productionId: 'P-PRINT', currentFulfillmentStage: 'print' },
  pack: { productionId: 'P-PACK', currentFulfillmentStage: 'pack' },
  fulfilled: { productionId: 'P-FULFILLED', fulfillmentCompletedAt: after },
  completed: { productionId: 'P-COMPLETED', fulfillmentCompletedAt: before },
  cancelled: { productionId: 'P-CANCELLED', cancelledAt: before, currentFulfillmentStage: 'print' },
};

const pushedAt = new Date('2026-09-01T00:00:00Z');
const staging = (id: string, pids: string[], extra: Record<string, unknown> = {}) => ({
  _id: id,
  customerId: 'C1',
  pushedAt,
  items: pids.map((productionId) => ({ productionId, sku: 'S', quantity: 1 })),
  ...extra,
});
const stagingDocs = [
  staging('noStage', ['P-NOSTAGE']),
  staging('print', ['P-PRINT']),
  staging('fulfilled', ['P-FULFILLED']),
  staging('completed', ['P-COMPLETED']),
  staging('allCancelled', ['P-CANCELLED']),
  staging('missingProd', ['P-GONE']), // production order deleted → cancelled
  staging('mixSlowest', ['P-COMPLETED', 'P-FULFILLED', 'P-NOSTAGE']), // slowest item wins
  staging('mixDone', ['P-COMPLETED', 'P-FULFILLED', 'P-CANCELLED']),
  staging('mixPack', ['P-PACK', 'P-COMPLETED']),
  staging('pending', ['P-PRINT'], { pushedAt: null }),
  staging('refunded', ['P-PRINT'], { refundedAt: before }),
  staging('cancelledOrder', ['P-PRINT'], { status: 'cancelled' }),
];

interface Surface {
  buildDerivePipeline(customerId: string | null, cutoff: Date): Array<Record<string, unknown>>;
  toStagingOrder(doc: Record<string, unknown>, prodByPid: Map<string, unknown>, cutoff: Date): { status: CustomerOrderStatus };
}
const svc = Object.create(CustomerOrderService.prototype) as Surface;
const prodByPid = new Map(Object.values(prod).map((p) => [p.productionId, p]));
const jsStatus = (doc: Record<string, unknown>) => svc.toStagingOrder(doc, prodByPid, cutoff).status;

describe('deriveItemStatus — In Production = pushed, not fulfilled', () => {
  it.each([
    ['noStage', CustomerOrderStatus.InProduction],
    ['print', CustomerOrderStatus.InProduction],
    ['pack', CustomerOrderStatus.InProduction],
    ['fulfilled', CustomerOrderStatus.Fulfilled],
    ['completed', CustomerOrderStatus.Completed],
    ['cancelled', CustomerOrderStatus.Cancelled],
  ])('%s → %s', (key, expected) => {
    expect(deriveItemStatus(prod[key] as never, cutoff)).toBe(expected);
  });

  it('a pushed order is never Processing', () => {
    for (const doc of stagingDocs) expect(jsStatus(doc)).not.toBe(CustomerOrderStatus.Processing);
  });
});

const uri = process.env.DERIVE_MIRROR_MONGO_URI;
(uri ? describe : describe.skip)('statusDerived (Mongo) mirrors toStagingOrder (JS)', () => {
  let conn: mongoose.Connection;
  beforeAll(async () => {
    conn = await mongoose.createConnection(uri as string).asPromise();
    await conn.dropDatabase();
    await conn.collection('orders').insertMany(Object.values(prod) as never[]);
    await conn.collection('customer_orders').insertMany(stagingDocs as never[]);
  });
  afterAll(async () => {
    await conn?.dropDatabase();
    await conn?.close();
  });

  it('every fixture derives the same status on both sides', async () => {
    const rows = await conn
      .collection('customer_orders')
      .aggregate<{ _id: string; statusDerived: string }>([...svc.buildDerivePipeline(null, cutoff), { $project: { statusDerived: 1 } }])
      .toArray();
    const mongo = Object.fromEntries(rows.map((r) => [r._id, r.statusDerived]));
    const js = Object.fromEntries(stagingDocs.map((d) => [d._id, jsStatus(d)]));
    expect(mongo).toEqual(js);
    // Pin the expectations too, so both sides drifting together still fails.
    expect(js).toEqual({
      noStage: 'in-production',
      print: 'in-production',
      fulfilled: 'fulfilled',
      completed: 'completed',
      allCancelled: 'cancelled',
      missingProd: 'cancelled',
      mixSlowest: 'in-production',
      mixDone: 'fulfilled',
      mixPack: 'in-production',
      pending: 'pending',
      refunded: 'refunded',
      cancelledOrder: 'cancelled',
    });
  });
});
