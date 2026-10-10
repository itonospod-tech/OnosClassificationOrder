import { adminOrderCacheSizeForTests, cachedAdminOrderNumbers, clearAdminOrderCache } from './admin-order-cache';
import { CustomerOrderService } from './customer-order.service';

/**
 * Hub Trashed tab. Two rules carry it, both in filter SHAPES, so this suite reads the filters:
 *  1. a trashed order is in no list/count/lookup, and a never-pushed order is the only kind
 *     that can be trashed;
 *  2. trash and push cannot both win: push claims `trashedAt: null`, trash requires
 *     `pushedAt: null` and `pushingAt: null`.
 */
type Filter = Record<string, unknown>;
interface Surface {
  customerOrderModel: unknown;
  trashOrdersAdmin(ids: string[], by: string): Promise<{ data: { ok: number; skipped: string[] } }>;
  restoreOrdersAdmin(ids: string[]): Promise<{ data: { ok: number; skipped: string[] } }>;
  claimPush(id: string, customerId: string): Promise<boolean>;
  validatePushable(doc: Record<string, unknown> | undefined): string | undefined;
  buildPagedListPipeline(opts: Record<string, unknown>): Array<Record<string, unknown>>;
  buildDerivePipeline(customerId: string | null, cutoff: Date, trash?: boolean): Array<Record<string, unknown>>;
}

const make = (modified: (id: string) => number = () => 1) => {
  const updates: Array<{ filter: Filter; update: Record<string, unknown> }> = [];
  const svc = Object.create(CustomerOrderService.prototype) as Surface;
  svc.customerOrderModel = {
    updateOne: (filter: Filter, update: Record<string, unknown>) => {
      updates.push({ filter, update });
      return Promise.resolve({ modifiedCount: modified(String(filter._id)) });
    },
  };
  return { svc, updates };
};

describe('trash / restore', () => {
  it('trash only matches a never-pushed, not-being-pushed, not-yet-trashed order', async () => {
    const { svc, updates } = make();
    await svc.trashOrdersAdmin(['A'], 'admin1');
    const { filter, update } = updates[0];
    expect(filter).toMatchObject({ _id: 'A', trashedAt: null, pushedAt: null });
    expect(filter.$or).toEqual([{ pushingAt: null }, { pushingAt: { $exists: false } }]);
    expect((update.$set as Filter).trashedAt).toBeInstanceOf(Date);
    expect((update.$set as Filter).trashedBy).toBe('admin1');
  });

  it('reports exactly what changed (one conditional update per id) and clears the cached counts', async () => {
    // The counts cache moved to `admin-order-cache.ts` (file scope) on 10/10/2026, so prime it through its own
    // entry point rather than reaching into a private field of the service.
    clearAdminOrderCache();
    await cachedAdminOrderNumbers('counts:x', () => Promise.resolve(1));
    expect(adminOrderCacheSizeForTests()).toBe(1);

    const { svc, updates } = make((id) => (id === 'PUSHED' ? 0 : 1));
    const res = await svc.trashOrdersAdmin(['A', 'PUSHED', 'A'], 'admin1');
    expect(updates).toHaveLength(2); // de-duplicated
    expect(res.data).toEqual({ ok: 1, skipped: ['PUSHED'] });
    expect(adminOrderCacheSizeForTests()).toBe(0);
  });

  it('restore only touches trashed orders and clears trashedAt', async () => {
    const { svc, updates } = make();
    await svc.restoreOrdersAdmin(['A']);
    expect(updates[0].filter).toEqual({ _id: 'A', trashedAt: { $ne: null } });
    expect(updates[0].update).toEqual({ $set: { trashedAt: null }, $unset: { trashedBy: 1 } });
  });
});

describe('push vs trash', () => {
  it('a trashed order is "not found" for push (by id or by external ref), same as a missing one', () => {
    const { svc } = make();
    const doc = { status: 'pending', pushedAt: null, items: [{ productionId: 'P1' }] };
    expect(svc.validatePushable({ ...doc, trashedAt: new Date() })).toBe(svc.validatePushable(undefined));
  });

  it('push claim requires trashedAt: null', async () => {
    const { svc, updates } = make();
    await svc.claimPush('A', 'C1');
    expect(updates[0].filter.trashedAt).toBeNull();
  });
});

describe('every list/count starts by excluding trashed orders', () => {
  const cutoff = new Date();
  it('derive pipeline (counts, stats, open-API lookup)', () => {
    const { svc } = make();
    expect(svc.buildDerivePipeline('C1', cutoff)[0]).toEqual({ $match: { customerId: 'C1', trashedAt: null } });
    expect(svc.buildDerivePipeline(null, cutoff)[0]).toEqual({ $match: { trashedAt: null } });
    expect(svc.buildDerivePipeline(null, cutoff, true)[0]).toEqual({ $match: { trashedAt: { $ne: null } } });
  });

  it('paged list, fast path (derive runs after paging, so the exclusion must be a document match)', () => {
    const { svc } = make();
    const base = { customerId: 'C1', cutoff, preStages: [], held: false, skip: 0, limit: 20 };
    expect(svc.buildPagedListPipeline(base)[0]).toEqual({ $match: { customerId: 'C1', trashedAt: null } });
    expect(svc.buildPagedListPipeline({ ...base, trash: true })[0]).toEqual({ $match: { customerId: 'C1', trashedAt: { $ne: null } } });
  });
});
