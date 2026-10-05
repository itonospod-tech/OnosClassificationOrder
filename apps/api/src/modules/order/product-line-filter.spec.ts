import { GetProductionOrdersZod } from 'shared';

import { OrderService } from './order.service';
import { productLineCondition } from './product-line-filter';

/**
 * MenuRestructure-CEO.md 1A — `GET /orders?productLine=` is the default filter of
 * the six "Production" pages. A wrong filter raises no error; it just returns a
 * list with too many or too few orders, so the rules are locked by tests.
 */
const parse = (productLine?: string) =>
  GetProductionOrdersZod.parse({ page: 1, limit: 20, ...(productLine !== undefined ? { productLine } : {}) })
    .productLine;

describe('productLine — DTO', () => {
  it('accepts a single value, a CSV, and the __none__ token', () => {
    expect(parse('3d')).toBe('3d');
    expect(parse('2d,wood,__none__')).toBe('2d,wood,__none__');
    expect(parse(undefined)).toBeUndefined();
  });

  it('unknown value → error (400) instead of silently filtering down to 0 orders', () => {
    expect(() => parse('3D')).toThrow();
    expect(() => parse('3d,dtf')).toThrow();
  });
});

describe('productLineCondition', () => {
  it('CSV → $in; __none__ → null (also matches a missing field)', () => {
    expect(productLineCondition('3d')).toEqual({ $in: ['3d'] });
    expect(productLineCondition('2d,__none__')).toEqual({ $in: ['2d', null] });
  });

  it('empty → no filter', () => {
    expect(productLineCondition(undefined)).toBeUndefined();
    expect(productLineCondition('')).toBeUndefined();
    expect(productLineCondition(',')).toBeUndefined();
  });
});

describe('buildOrderListFilter + productLine — KEEPS the standard exclusions', () => {
  const svc = Object.create(OrderService.prototype) as {
    orderModel: unknown;
    buildOrderListFilter: (dto: unknown) => Record<string, unknown>;
  };
  svc.orderModel = { db: {} };
  const build = (q: Record<string, unknown>) =>
    svc.buildOrderListFilter(GetProductionOrdersZod.parse({ page: 1, limit: 20, ...q }));

  it('adds productLine while still excluding cancelled and factory-unmapped orders', () => {
    const f = build({ productLine: 'wood' });
    expect(f.productLine).toEqual({ $in: ['wood'] });
    expect(f.cancelledAt).toEqual({ $exists: false });
    expect(f.factoryId).toMatchObject({ $exists: true });
  });

  it('combined with a date range → the inProductionAt filter is kept', () => {
    const f = build({ productLine: 'wood', createdFrom: '2026-09-01', createdTo: '2026-09-30' });
    expect(f.productLine).toEqual({ $in: ['wood'] });
    expect(f.inProductionAt).toMatchObject({ $gte: expect.any(Date), $lte: expect.any(Date) });
  });

  it('no productLine sent → filter unchanged', () => {
    const f = build({});
    expect(f).not.toHaveProperty('productLine');
  });

  it('combined with search: productLine does NOT leak into the search $or', () => {
    const f = build({ productLine: '3d', search: 'abc' });
    expect(f.productLine).toEqual({ $in: ['3d'] });
    expect(f.$and).toEqual([{ $or: expect.any(Array) }]);
    expect(JSON.stringify(f.$and)).not.toContain('productLine');
  });
});
