import { isOrderCancelled, resolveScanLookupOutcome, scanActionLock } from 'shared';

/**
 * Luật quét mã đơn hủy/giữ tại trạm (`packages/shared/client/scan-guard.ts`), dùng ở 2 nơi quét của
 * apps/web: ô TÌM/QUÉT của Task Fulfillment (`resolveScanLookupOutcome`) và popup quét công đoạn ở
 * trang Quét mã (`scanActionLock`). apps/web không có test runner nên luật được ghim ở đây.
 *
 * Bối cảnh 23/11/2026: 2 đơn hoodie bị khách hủy SAU khi đã in, xưởng quét ở Ép không biết là đã hủy.
 */
const CANCELLED_AT = '2026-11-21T14:05:15.178Z';

describe('isOrderCancelled', () => {
  it('đơn có cancelledAt (chuỗi ISO từ API hoặc Date) → đã hủy', () => {
    expect(isOrderCancelled({ cancelledAt: CANCELLED_AT })).toBe(true);
    expect(isOrderCancelled({ cancelledAt: new Date(CANCELLED_AT) })).toBe(true);
  });

  it('đơn thiếu cancelledAt / null / rỗng / chính đơn null → chưa hủy', () => {
    expect(isOrderCancelled({})).toBe(false);
    expect(isOrderCancelled({ cancelledAt: null })).toBe(false);
    expect(isOrderCancelled({ cancelledAt: '' })).toBe(false);
    expect(isOrderCancelled(null)).toBe(false);
    expect(isOrderCancelled(undefined)).toBe(false);
  });
});

describe('resolveScanLookupOutcome — ô TÌM/QUÉT của Task Fulfillment', () => {
  it('đơn bình thường, công nhân → mở dialog thao tác như cũ', () => {
    expect(resolveScanLookupOutcome({}, { viewOnly: false })).toBe('action');
  });

  it('đơn bình thường, chế độ chỉ xem (Admin/Manager) → mở chi tiết như cũ', () => {
    expect(resolveScanLookupOutcome({}, { viewOnly: true })).toBe('detail');
  });

  it('đơn hủy, công nhân → chỉ cảnh báo, KHÔNG mở thao tác', () => {
    expect(resolveScanLookupOutcome({ cancelledAt: CANCELLED_AT }, { viewOnly: false })).toBe('cancelled-blocked');
  });

  it('đơn hủy, chế độ chỉ xem → cảnh báo VÀ vẫn mở chi tiết (giữ hành vi cũ của Admin/Manager)', () => {
    expect(resolveScanLookupOutcome({ cancelledAt: CANCELLED_AT }, { viewOnly: true })).toBe('cancelled-detail');
  });

  it('đơn đang giữ KHÔNG đổi luồng tra mã (popup tự khoá như trước)', () => {
    const held = { heldAt: '2026-11-21T10:00:00.000Z' };
    expect(resolveScanLookupOutcome(held, { viewOnly: false })).toBe('action');
    expect(resolveScanLookupOutcome(held, { viewOnly: true })).toBe('detail');
  });
});

describe('scanActionLock — popup quét công đoạn (trang Quét mã)', () => {
  it('đơn bình thường → không khoá', () => {
    expect(scanActionLock({})).toBeNull();
    expect(scanActionLock({ cancelledAt: null, heldAt: null })).toBeNull();
  });

  it('đơn hủy → khoá lý do cancelled', () => {
    expect(scanActionLock({ cancelledAt: CANCELLED_AT })).toBe('cancelled');
  });

  it('đơn giữ → khoá lý do held (hành vi cũ không đổi)', () => {
    expect(scanActionLock({ heldAt: '2026-11-21T10:00:00.000Z' })).toBe('held');
  });

  it('vừa hủy vừa giữ → cancelled đứng trước (đơn hủy không bao giờ làm tiếp)', () => {
    expect(scanActionLock({ cancelledAt: CANCELLED_AT, heldAt: '2026-11-21T10:00:00.000Z' })).toBe('cancelled');
  });
});
