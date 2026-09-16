import { duocTruyCapZalo, ZALO_ALLOWED_EMAILS } from './zalo-access';

describe('duocTruyCapZalo', () => {
  it('cho đúng hai tài khoản trong danh sách', () => {
    expect(ZALO_ALLOWED_EMAILS).toHaveLength(2);
    expect(duocTruyCapZalo('tuankudo199@gmail.com')).toBe(true);
    expect(duocTruyCapZalo('automation@onosfactory.com')).toBe(true);
  });

  it('bỏ qua hoa thường và khoảng trắng', () => {
    expect(duocTruyCapZalo('  TuanKudo199@Gmail.com  ')).toBe(true);
  });

  it('TỪ CHỐI mọi tài khoản khác, kể cả SuperAdmin', () => {
    // Hệ thống có 8 SuperAdmin; quyền đọc chat KHÔNG đi theo role.
    for (const e of ['admin@local.dev', 'lechinguyen09@gmail.com', 'admin_dev@gmail.com', 'thanhthuy@onospod.com']) {
      expect(duocTruyCapZalo(e)).toBe(false);
    }
  });

  it('fail-closed khi không có email', () => {
    expect(duocTruyCapZalo(undefined)).toBe(false);
    expect(duocTruyCapZalo(null)).toBe(false);
    expect(duocTruyCapZalo('')).toBe(false);
    expect(duocTruyCapZalo('   ')).toBe(false);
  });

  it('không khớp một phần', () => {
    expect(duocTruyCapZalo('tuankudo199@gmail.com.attacker.net')).toBe(false);
    expect(duocTruyCapZalo('xtuankudo199@gmail.com')).toBe(false);
  });
});
