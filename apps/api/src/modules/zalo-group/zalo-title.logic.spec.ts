import { khopTenNhom, macUngVien } from './zalo-title.logic';

/**
 * Tên nhóm trong các test này lấy NGUYÊN VĂN từ prod 11/09/2026 — đây là chỗ
 * quyết định ops phải duyệt tay bao nhiêu nhóm, nên phải kiểm bằng dữ liệu thật
 * chứ không phải ví dụ tự nghĩ.
 */
describe('macUngVien — tách mã khách từ tên nhóm', () => {
  it('lấy được mã ở khuôn tên chuẩn', () => {
    expect(macUngVien('OnosPod/ 2025/ TUYEN/ KL/ TOPUP')).toContain('TUYEN');
    expect(macUngVien('OnosPod/ 2025/ ANHDUC06/ KL/ TOPUP')).toContain('ANHDUC06');
    expect(macUngVien('OnosPod/ TRINITY/ 2026/ KL/ TOPUP')).toContain('TRINITY');
  });

  it('cắt đuôi loại tài khoản, GIỮ cả bản đầy đủ', () => {
    const c = macUngVien('OnosEx/ 2024/ VUDANDEBIT/ DEBIT');
    expect(c).toContain('VUDANDEBIT');
    expect(c).toContain('VUDAN');
    // Bản dài đứng trước để khớp chính xác hơn được ưu tiên.
    expect(c.indexOf('VUDANDEBIT')).toBeLessThan(c.indexOf('VUDAN'));
  });

  it('bắt được mã nằm trong ngoặc', () => {
    expect(macUngVien('BOD - Hào/ VIP (XHAODEBIT)')).toContain('XHAO');
  });

  it('bỏ năm và từ chung, không nhận nhầm làm mã', () => {
    const c = macUngVien('OnosPod PN/ SIMPLEHUBDEBIT/ 2025/ VIP 1/ DEBIT');
    expect(c).toContain('SIMPLEHUB');
    for (const rac of ['2025', 'VIP', 'PN', 'ONOSPOD', 'DEBIT', '1']) expect(c).not.toContain(rac);
  });

  it('bỏ dấu ĐÚNG cách, không đẻ ra mã rác từ chữ tiếng Việt', () => {
    // Lọc ký tự trước khi bỏ dấu thì "Nhóm" → "NHM", "Việt" → "VIT": mã rác
    // trông y như mã thật. Đây là lỗi đã mắc ở bản đầu 11/09/2026.
    expect(macUngVien('Nhóm LED')).not.toContain('NHM');
    expect(macUngVien('Đại Việt Vươn Xa - US')).not.toContain('VIT');
    expect(macUngVien('WEB/ Onos')).toEqual([]);
  });
});

describe('khopTenNhom — ghép với khách đang có', () => {
  const skus = new Set(['TUYEN', 'DESI', 'PHU']);

  it('khớp khách sẵn có, mã dài thì điểm cao', () => {
    const r = khopTenNhom('OnosPod/ 2025/ TUYEN/ KL/ TOPUP', skus);
    expect(r.matched?.sku).toBe('TUYEN');
    expect(r.matched?.score).toBeGreaterThanOrEqual(0.75);
    expect(r.unknownSku).toBeUndefined();
  });

  it('mã CHƯA có khách → đề nghị tạo mới, không im lặng bỏ qua', () => {
    // Đây là 45/52 nhóm trượt trên prod: mã có thật nhưng bảng khách chưa có.
    const r = khopTenNhom('OnosPod/ TRINITY/ 2026/ KL/ TOPUP', skus);
    expect(r.matched).toBeUndefined();
    expect(r.unknownSku).toBe('TRINITY');
  });

  it('nhóm KHÔNG theo khuôn seller thì không đề nghị tạo khách', () => {
    // Nhóm nội bộ đặt tên tự do vẫn moi ra được vài từ trông như mã — đề nghị
    // tạo khách từ đó là đẩy rác vào bảng khách.
    expect(khopTenNhom('Nhóm LED', skus)).toEqual({});
    expect(khopTenNhom('Nhóm vải siêm- A Soi Mê Linh', skus)).toEqual({});
    expect(khopTenNhom('VIC - ONOS', skus)).toEqual({});
  });
});
