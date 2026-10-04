import { buildProductionCostRows } from './production-cost';

const PUSHED_AT = new Date('2026-10-04T03:00:00.000Z');
const build = (inputs: Parameters<typeof buildProductionCostRows>[2]) =>
  buildProductionCostRows('C1', PUSHED_AT, inputs);

describe('production cost rows', () => {
  it('amount is unit cost times quantity, rounded to cents', () => {
    const [row] = build([{ productionId: 'P1', stagingOrderId: 'S1', unitCost: 5.6, quantity: 3 }]);
    expect(row.amount).toBe(16.8);
    expect(row.unitCost).toBe(5.6);
    expect(row.quantity).toBe(3);
    expect(row.customerId).toBe('C1');
    expect(row.pushedAt).toBe(PUSHED_AT);
  });

  it('does not leak floating point noise into the amount', () => {
    // 0.1 * 3 = 0.30000000000000004 in raw floating point.
    const [row] = build([{ productionId: 'P1', stagingOrderId: 'S1', unitCost: 0.1, quantity: 3 }]);
    expect(row.amount).toBe(0.3);
  });

  it('keeps an item whose variation has no cost, with amount 0 and no unitCost', () => {
    const [row] = build([{ productionId: 'P1', stagingOrderId: 'S1', quantity: 2 }]);
    expect(row.amount).toBe(0);
    expect(row.unitCost).toBeUndefined();
  });

  it('treats a negative or non-finite cost as missing, never as a credit', () => {
    const rows = build([
      { productionId: 'P1', stagingOrderId: 'S1', unitCost: -4, quantity: 1 },
      { productionId: 'P2', stagingOrderId: 'S1', unitCost: Number.NaN, quantity: 1 },
    ]);
    expect(rows.map((r) => r.amount)).toEqual([0, 0]);
    expect(rows.every((r) => r.unitCost === undefined)).toBe(true);
  });

  it('defaults a missing or invalid quantity to 1', () => {
    const rows = build([
      { productionId: 'P1', stagingOrderId: 'S1', unitCost: 5 },
      { productionId: 'P2', stagingOrderId: 'S1', unitCost: 5, quantity: 0 },
    ]);
    expect(rows.map((r) => r.quantity)).toEqual([1, 1]);
    expect(rows.map((r) => r.amount)).toEqual([5, 5]);
  });

  it('skips items that have no productionId', () => {
    expect(build([{ stagingOrderId: 'S1', unitCost: 5 }])).toEqual([]);
  });
});
