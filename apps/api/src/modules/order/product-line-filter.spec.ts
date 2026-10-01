import { GetProductionOrdersZod } from 'shared';

import { OrderService } from './order.service';
import { productLineCondition } from './product-line-filter';

/**
 * MenuRestructure-CEO.md 1A — `GET /orders?productLine=` là bộ lọc mặc định của
 * 6 trang "Sản xuất". Lọc sai không báo lỗi, chỉ ra danh sách thừa/thiếu.
 */
const parse = (productLine?: string) =>
  GetProductionOrdersZod.parse({ page: 1, limit: 20, ...(productLine !== undefined ? { productLine } : {}) })
    .productLine;

describe('productLine — DTO', () => {
  it('nhận 1 giá trị, CSV, và token __none__', () => {
    expect(parse('3d')).toBe('3d');
    expect(parse('2d,wood,__none__')).toBe('2d,wood,__none__');
    expect(parse(undefined)).toBeUndefined();
  });

  it('giá trị lạ → lỗi (400), không âm thầm lọc ra 0 đơn', () => {
    expect(() => parse('3D')).toThrow();
    expect(() => parse('3d,dtf')).toThrow();
  });
});

describe('productLineCondition', () => {
  it('CSV → $in; __none__ → null (khớp cả field thiếu)', () => {
    expect(productLineCondition('3d')).toEqual({ $in: ['3d'] });
    expect(productLineCondition('2d,__none__')).toEqual({ $in: ['2d', null] });
  });

  it('rỗng → không lọc', () => {
    expect(productLineCondition(undefined)).toBeUndefined();
    expect(productLineCondition('')).toBeUndefined();
    expect(productLineCondition(',')).toBeUndefined();
  });
});

describe('buildOrderListFilter + productLine — GIỮ bộ lọc chuẩn', () => {
  const svc = Object.create(OrderService.prototype) as {
    orderModel: unknown;
    buildOrderListFilter: (dto: unknown) => Record<string, unknown>;
  };
  svc.orderModel = { db: {} };
  const build = (q: Record<string, unknown>) =>
    svc.buildOrderListFilter(GetProductionOrdersZod.parse({ page: 1, limit: 20, ...q }));

  it('thêm productLine mà vẫn loại đơn hủy + đơn chưa map xưởng', () => {
    const f = build({ productLine: 'wood' });
    expect(f.productLine).toEqual({ $in: ['wood'] });
    expect(f.cancelledAt).toEqual({ $exists: false });
    expect(f.factoryId).toMatchObject({ $exists: true });
  });

  it('kết hợp khoảng ngày → giữ nguyên lọc inProductionAt', () => {
    const f = build({ productLine: 'wood', createdFrom: '2026-09-01', createdTo: '2026-09-30' });
    expect(f.productLine).toEqual({ $in: ['wood'] });
    expect(f.inProductionAt).toMatchObject({ $gte: expect.any(Date), $lte: expect.any(Date) });
  });

  it('không gửi productLine → không đổi filter', () => {
    const f = build({});
    expect(f).not.toHaveProperty('productLine');
  });

  it('kết hợp search: productLine KHÔNG lẫn vào $or của search', () => {
    const f = build({ productLine: '3d', search: 'abc' });
    expect(f.productLine).toEqual({ $in: ['3d'] });
    expect(JSON.stringify(f.$or)).not.toContain('productLine');
  });
});
