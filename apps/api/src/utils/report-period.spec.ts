import { khoangThang, laThangTron } from './report-period';

describe('laThangTron', () => {
  it('nhận đúng tháng 31, 30 và tháng 2 của năm thường', () => {
    expect(laThangTron('2026-01-01', '2026-01-31')).toBe(true);
    expect(laThangTron('2026-04-01', '2026-04-30')).toBe(true);
    expect(laThangTron('2026-02-01', '2026-02-28')).toBe(true);
  });

  it('nhận đúng tháng 2 năm nhuận', () => {
    expect(laThangTron('2024-02-01', '2024-02-29')).toBe(true);
    expect(laThangTron('2024-02-01', '2024-02-28')).toBe(false);
  });

  it('thiếu hoặc thừa một ngày là KHÔNG phải tháng', () => {
    expect(laThangTron('2026-01-01', '2026-01-30')).toBe(false);
    expect(laThangTron('2026-01-02', '2026-01-31')).toBe(false);
    expect(laThangTron('2026-01-01', '2026-02-01')).toBe(false);
  });

  it('kỳ 7 ngày không bị nhầm thành tháng', () => {
    expect(laThangTron('2026-09-04', '2026-09-10')).toBe(false);
  });
});

describe('khoangThang', () => {
  it('ra đúng ngày cuối cho mọi độ dài tháng', () => {
    expect(khoangThang(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(khoangThang(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(khoangThang(2024, 2)).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(khoangThang(2026, 4)).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(khoangThang(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('khớp với laThangTron cho cả 12 tháng', () => {
    for (let t = 1; t <= 12; t++) {
      const { from, to } = khoangThang(2026, t);
      expect(laThangTron(from, to)).toBe(true);
    }
  });
});
