import { ZALO_STAFF_MIN_GROUPS, ZaloGroupKind, ZaloIdentityKind } from 'shared';

import { doanPhanLoai, nhanKhachTuNhom } from './zalo-identity.logic';

/**
 * Test NỀN cho heuristic phân loại người gửi — ghi lại hành vi HIỆN TẠI trước
 * khi Đợt 1 mục 1.2d cho nó nhìn thêm loại nhóm.
 */
describe('doanPhanLoai — đoán từ số nhóm', () => {
  it('tài khoản công ty → trợ lý AI, bất kể số nhóm', () => {
    expect(doanPhanLoai(1, true)).toBe(ZaloIdentityKind.AiSupport);
  });

  it('đủ ngưỡng nhóm → nhân viên', () => {
    expect(doanPhanLoai(ZALO_STAFF_MIN_GROUPS, false)).toBe(ZaloIdentityKind.Staff);
  });

  it('đúng 1 nhóm, không biết loại nhóm → khách (giữ hành vi cũ cho dữ liệu thiếu)', () => {
    expect(doanPhanLoai(1)).toBe(ZaloIdentityKind.Customer);
  });

  it('đúng 1 nhóm và nhóm đó là nhóm khách → khách', () => {
    expect(doanPhanLoai(1, false, ZaloGroupKind.Seller)).toBe(ZaloIdentityKind.Customer);
  });

  it('đúng 1 nhóm nhưng là nhóm vận hành → để người xét (đối tác, không phải khách)', () => {
    expect(doanPhanLoai(1, false, ZaloGroupKind.Operation)).toBe(ZaloIdentityKind.Unknown);
  });

  it('đúng 1 nhóm nhưng nhóm chưa duyệt / nội bộ / không có link → để người xét', () => {
    expect(doanPhanLoai(1, false, ZaloGroupKind.Unreviewed)).toBe(ZaloIdentityKind.Unknown);
    expect(doanPhanLoai(1, false, ZaloGroupKind.Internal)).toBe(ZaloIdentityKind.Unknown);
    expect(doanPhanLoai(1, false, null)).toBe(ZaloIdentityKind.Unknown);
  });

  it('2–4 nhóm → để người xét', () => {
    expect(doanPhanLoai(3)).toBe(ZaloIdentityKind.Unknown);
  });
});

describe('nhanKhachTuNhom — suy khách từ nhóm người đó nhắn', () => {
  const map = { khachTheoNhom: new Map([['g1', 'KH_A'], ['g2', 'KH_A'], ['g3', 'KH_B']]) };

  it('người ở các nhóm CÙNG một khách → nhận khách đó', () => {
    expect(nhanKhachTuNhom(ZaloIdentityKind.Customer, ['g1', 'g2'], map)).toBe('KH_A');
  });

  it('người ở nhóm của HAI khách → không đoán, trả null', () => {
    // Gán đại một trong hai là bịa quan hệ, và cái sai đó đi thẳng vào báo cáo.
    expect(nhanKhachTuNhom(ZaloIdentityKind.Customer, ['g1', 'g3'], map)).toBeNull();
  });

  it('nhóm chưa nối khách thì bỏ qua, không cản phần còn lại', () => {
    expect(nhanKhachTuNhom(ZaloIdentityKind.Customer, ['g1', 'chua-noi'], map)).toBe('KH_A');
  });

  it('không phải khách thì không gán, dù chỉ ở một nhóm', () => {
    expect(nhanKhachTuNhom(ZaloIdentityKind.Staff, ['g1'], map)).toBeNull();
    expect(nhanKhachTuNhom(ZaloIdentityKind.Unknown, ['g1'], map)).toBeNull();
  });

  it('chưa có danh sách nhóm (dữ liệu cũ) thì trả null chứ không nổ', () => {
    expect(nhanKhachTuNhom(ZaloIdentityKind.Customer, undefined, map)).toBeNull();
    expect(nhanKhachTuNhom(ZaloIdentityKind.Customer, [], map)).toBeNull();
  });
});
