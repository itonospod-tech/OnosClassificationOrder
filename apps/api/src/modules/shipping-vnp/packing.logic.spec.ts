import { canTinhCuoc, khoaGopKien, maPhieuBanGiao, ngayVN } from './packing.logic';

describe('khoaGopKien — 1 kiện = 1 đơn seller', () => {
  it('có mã đơn → mọi item cùng đơn chung một khoá', () => {
    expect(khoaGopKien({ orderId: 'GM-02336-03868', productionId: 'PM-11594-04672' })).toBe('GM-02336-03868');
    expect(khoaGopKien({ orderId: 'GM-02336-03868', productionId: 'PM-99999-00001' })).toBe('GM-02336-03868');
  });

  it('không có mã đơn → mỗi item một kiện, KHÔNG gộp chung nhóm thiếu dữ liệu', () => {
    const a = khoaGopKien({ productionId: 'PM-11594-04672' });
    const b = khoaGopKien({ orderId: '   ', productionId: 'PM-99999-00001' });
    expect(a).toBe('PM-11594-04672');
    expect(b).toBe('PM-99999-00001');
    expect(a).not.toBe(b);
  });

  it('không có gì để gộp → null, người gọi bỏ qua', () => {
    expect(khoaGopKien({})).toBeNull();
  });
});

describe('maPhieuBanGiao — ngày theo giờ VN', () => {
  it('phiếu in buổi tối vẫn mang ngày hôm đó', () => {
    // 17/09 21:30 VN = 14:30 UTC
    expect(ngayVN(new Date('2026-09-17T14:30:00.000Z'))).toBe('170926');
    expect(maPhieuBanGiao('TN', new Date('2026-09-17T14:30:00.000Z'), 1)).toBe('BG-TN-170926-01');
  });

  it('qua nửa đêm giờ VN thì sang ngày mới', () => {
    // 17/09 18:00 UTC = 18/09 01:00 VN
    expect(maPhieuBanGiao('ML', new Date('2026-09-17T18:00:00.000Z'), 12)).toBe('BG-ML-180926-12');
  });

  it('chưa biết xưởng vẫn ra mã đọc được', () => {
    expect(maPhieuBanGiao(undefined, new Date('2026-09-17T14:30:00.000Z'), 3)).toBe('BG-NA-170926-03');
  });
});

describe('canTinhCuoc — max(cân thật, cân quy đổi)', () => {
  it('cân thật lớn hơn quy đổi', () => {
    expect(canTinhCuoc({ weightGram: 500, dimensions: { width: 10, height: 10, length: 10 } })).toBe(500);
  });

  it('quy đổi lớn hơn cân thật — hàng cồng kềnh', () => {
    // 30×30×30 / 6 = 4500
    expect(canTinhCuoc({ weightGram: 500, dimensions: { width: 30, height: 30, length: 30 } })).toBe(4500);
  });

  it('thiếu một chiều → chỉ tính cân thật, không coi thể tích bằng 0', () => {
    expect(canTinhCuoc({ weightGram: 500, dimensions: { width: 30, height: 30 } })).toBe(500);
  });

  it('chưa đo gì → null để báo cáo đánh dấu kiện thiếu cân', () => {
    expect(canTinhCuoc({})).toBeNull();
    expect(canTinhCuoc({ weightGram: 0 })).toBeNull();
  });
});
