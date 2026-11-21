import { type CeoCustomerRow, summarizeCustomerHealth } from './ceo-customers';

const row = (userSku: string, orders: number, extra: Partial<CeoCustomerRow> = {}): CeoCustomerRow => ({
  userSku,
  orders,
  held: 0,
  errorPct: 0,
  n2Pct: 100,
  mature: orders,
  ...extra,
});

describe('summarizeCustomerHealth', () => {
  it('giữ chân = khách kỳ trước còn đơn kỳ này, bỏ đơn thiếu userSku', () => {
    const prev = new Map([
      ['A', 10],
      ['B', 4],
      ['C', 2],
      ['', 50],
    ]);
    const { retention } = summarizeCustomerHealth([row('A', 8), row('NEW', 3)], prev);
    expect(retention.retained).toBe(1);
    expect(retention.base).toBe(3);
    expect(retention.pct).toBe(33.3);
    // C chỉ 2 đơn kỳ trước → dưới ngưỡng rời bỏ; '' không bao giờ vào danh sách.
    expect(retention.churned).toEqual([{ userSku: 'B', prevOrders: 4 }]);
  });

  it('không có khách kỳ trước → pct null', () => {
    expect(summarizeCustomerHealth([row('A', 5)], new Map()).retention.pct).toBeNull();
  });

  it('phục vụ tốt = lỗi < 5% VÀ N2 ≥ 80%, chỉ chấm khách đủ 5 đơn đủ tuổi', () => {
    const cur = [
      row('OK', 100, { errorPct: 4.9, n2Pct: 80 }),
      row('LOI', 90, { errorPct: 5, n2Pct: 99 }),
      row('TRE', 80, { errorPct: 0, n2Pct: 79.9, held: 2 }),
      row('IT', 50, { errorPct: 50, n2Pct: 0, mature: 4 }),
      row('', 40, { errorPct: 50 }),
    ];
    const { service } = summarizeCustomerHealth(cur, new Map());
    expect(service.rated).toBe(3);
    expect(service.ok).toBe(1);
    expect(service.okPct).toBe(33.3);
    expect(service.atRisk.map((r) => r.userSku)).toEqual(['LOI', 'TRE']);
    expect(service.atRisk[1]).toEqual({ userSku: 'TRE', orders: 80, errorPct: 0, n2Pct: 79.9, held: 2 });
  });

  it('danh sách rời bỏ / chưa đạt tối đa 5, xếp theo số đơn', () => {
    const prev = new Map(Array.from({ length: 7 }, (_, i) => [`P${i}`, 10 + i] as [string, number]));
    const cur = Array.from({ length: 7 }, (_, i) => row(`C${i}`, 100 - i, { n2Pct: 10 }));
    const { retention, service } = summarizeCustomerHealth(cur, prev);
    expect(retention.churned.map((r) => r.userSku)).toEqual(['P6', 'P5', 'P4', 'P3', 'P2']);
    expect(service.atRisk).toHaveLength(5);
    expect(service.atRisk[0].userSku).toBe('C0');
  });
});
