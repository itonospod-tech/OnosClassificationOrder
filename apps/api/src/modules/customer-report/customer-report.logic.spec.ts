import { CUSTOMER_REPORT_RULES } from 'shared';

import { khachTang, khachTut, phanTramDoi, soNgayTonDong } from './customer-report.logic';

/**
 * Ngưỡng ở đây quyết định tên nào xuất hiện trong báo cáo gửi Chủ tịch, nên
 * phải khoá bằng test — đổi ngưỡng mà không đổi test là đổi lén nội dung báo cáo.
 */
describe('phanTramDoi', () => {
  it('kỳ trước bằng 0 → null, KHÔNG phải vô cực', () => {
    expect(phanTramDoi(10, 0)).toBeNull();
  });

  it('làm tròn 1 chữ số', () => {
    expect(phanTramDoi(120, 100)).toBe(20);
    expect(phanTramDoi(58, 100)).toBe(-42);
  });
});

describe('khachTut — nguy cơ mất khách', () => {
  it('đòi CẢ sàn kỳ trước lẫn mức giảm', () => {
    const rows = [
      { userSku: 'TO', orders: 8, prevOrders: 58 }, // giảm 86%, nền lớn → nhận
      { userSku: 'NHO', orders: 1, prevOrders: 2 }, // giảm 50% nhưng nền 2 đơn → bỏ
      { userSku: 'NHE', orders: 45, prevOrders: 50 }, // nền lớn nhưng chỉ giảm 10% → bỏ
    ];
    expect(khachTut(rows).map((r) => r.userSku)).toEqual(['TO']);
  });

  it('xếp khách nền lớn lên trước', () => {
    const rows = [
      { userSku: 'A', orders: 0, prevOrders: 25 },
      { userSku: 'B', orders: 0, prevOrders: 90 },
    ];
    expect(khachTut(rows).map((r) => r.userSku)).toEqual(['B', 'A']);
  });

  it('đúng mốc ngưỡng thì NHẬN (biên dưới)', () => {
    const r = { userSku: 'X', orders: CUSTOMER_REPORT_RULES.decliningMinPrev / 2, prevOrders: CUSTOMER_REPORT_RULES.decliningMinPrev };
    expect(khachTut([r])).toHaveLength(1);
  });
});

describe('khachTang — tăng đột biến', () => {
  it('khách mới toanh (kỳ trước 0) tính là tăng, miễn đủ sàn kỳ này', () => {
    expect(khachTang([{ userSku: 'MOI', orders: 30, prevOrders: 0 }])).toHaveLength(1);
    expect(khachTang([{ userSku: 'MOI_NHO', orders: 3, prevOrders: 0 }])).toHaveLength(0);
  });

  it('bỏ khách tăng nhiều phần trăm nhưng số tuyệt đối bé', () => {
    expect(khachTang([{ userSku: 'BE', orders: 6, prevOrders: 1 }])).toHaveLength(0);
  });
});

describe('soNgayTonDong', () => {
  const moc = new Date('2026-09-11T00:00:00.000Z');

  it('lấy việc chưa xong CŨ NHẤT', () => {
    expect(
      soNgayTonDong(
        [
          { xong: false, taoLuc: '2026-09-08T00:00:00.000Z' },
          { xong: false, taoLuc: '2026-09-01T00:00:00.000Z' },
          { xong: true, taoLuc: '2026-08-01T00:00:00.000Z' },
        ],
        moc,
      ),
    ).toBe(10);
  });

  it('xong hết hoặc rỗng → không trả số', () => {
    expect(soNgayTonDong([{ xong: true, taoLuc: '2026-08-01T00:00:00.000Z' }], moc)).toBeUndefined();
    expect(soNgayTonDong([], moc)).toBeUndefined();
    expect(soNgayTonDong(undefined, moc)).toBeUndefined();
  });
});
