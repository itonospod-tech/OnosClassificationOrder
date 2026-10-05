import { OrderService } from './order.service';

/** `variantSku` on list rows: exact size match on the product's variations (shipping-label rule), never a guess. */
describe('attachVariantSku', () => {
  const svc = Object.create(OrderService.prototype) as unknown as {
    [k: string]: unknown;
    attachVariantSku: (rows: Array<Record<string, unknown>>) => Promise<void>;
  };
  let calls = 0;
  svc.productConfigRepository = {
    findAll: () => {
      calls++;
      return Promise.resolve([{ _id: 'PC1', variations: [{ sku: 'AOP-JERSEY-S' }, { sku: 'AOP-JERSEY-XL' }] }]);
    },
  };

  it('matches by size, leaves the rest empty, one query per page', async () => {
    calls = 0;
    const rows: Array<Record<string, unknown>> = [
      { productConfigId: 'PC1', size: 'xl' },
      { productConfigId: 'PC1', size: 'M' }, // no such variation: empty, not the base SKU
      { productConfigId: 'PC1' }, // no size
      { size: 'S' }, // no product config
    ];
    await svc.attachVariantSku(rows);
    expect(rows.map((r) => r.variantSku)).toEqual(['AOP-JERSEY-XL', undefined, undefined, undefined]);
    expect(calls).toBe(1);
  });
});
