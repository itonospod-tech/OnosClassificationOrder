import { CustomerOrderService } from './customer-order.service';
import { PRODUCTION_COST_PRODUCTION_ID_INDEX, ProductionCostEntrySchema } from './production-cost.entity';

/**
 * The unique index on `productionId` is the idempotency guarantee of the shadow cost
 * ledger. It must be created explicitly on every boot — autoIndex builds in the
 * background and swallows errors, so a missing index would double-count silently.
 */
interface InitSurface {
  onModuleInit(): Promise<void>;
  [k: string]: unknown;
}

describe('production cost ledger — unique index', () => {
  it('the schema declares the same unique index the boot code creates', () => {
    const declared = ProductionCostEntrySchema.indexes().find(([keys]) => 'productionId' in keys);
    expect(declared?.[0]).toEqual(PRODUCTION_COST_PRODUCTION_ID_INDEX.keys);
    expect(declared?.[1]).toMatchObject({ unique: true, name: PRODUCTION_COST_PRODUCTION_ID_INDEX.name });
  });

  it('onModuleInit creates it explicitly, even when the backfill marker is already set', async () => {
    const created: Array<{ keys: unknown; options: unknown }> = [];
    const svc = Object.create(CustomerOrderService.prototype) as InitSurface;
    svc.warmAdminCache = () => undefined;
    // Marker already set → the backfill returns early; the index must not depend on it.
    svc.systemConfigService = { get: () => Promise.resolve('done') };
    svc.productionCostModel = {
      collection: {
        createIndex: (keys: unknown, options: unknown) => {
          created.push({ keys, options });
          return Promise.resolve('productionId_unique');
        },
      },
    };

    await svc.onModuleInit();

    expect(created).toEqual([
      { keys: { productionId: 1 }, options: { name: 'productionId_unique', unique: true } },
    ]);
  });

  it('an index build failure is swallowed to the log and does not break boot', async () => {
    const svc = Object.create(CustomerOrderService.prototype) as InitSurface;
    svc.warmAdminCache = () => undefined;
    svc.systemConfigService = { get: () => Promise.resolve('done') };
    svc.productionCostModel = { collection: { createIndex: () => Promise.reject(new Error('E11000 duplicate key')) } };

    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r)); // let the un-awaited catch run
  });
});
