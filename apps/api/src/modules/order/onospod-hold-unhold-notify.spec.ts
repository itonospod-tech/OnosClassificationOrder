import { HOLD_SOURCE_ONOSPOD, shouldNotifyCustomerOnManualUnhold } from './onospod-hold-sync.plan';

/**
 * USER chốt (TASK-04): nhân viên mở giữ đơn đang giữ THEO OnosPod → KHÔNG báo
 * khách (`order.unheld`), vì khách chưa từng được báo đơn bị giữ. Đơn giữ tay
 * vẫn báo như cũ. Dùng cho `unholdOrder` + `bulkSetHold(hold=false)` (Orders.md §9d.5).
 */
describe('mở giữ thủ công — có báo khách không', () => {
  const heldAt = new Date('2026-09-11T08:00:00.000Z');

  it('đơn giữ theo OnosPod → KHÔNG báo', () => {
    expect(shouldNotifyCustomerOnManualUnhold({ heldAt, holdSource: HOLD_SOURCE_ONOSPOD })).toBe(false);
  });

  it('đơn giữ tay (manual) → báo', () => {
    expect(shouldNotifyCustomerOnManualUnhold({ heldAt, holdSource: 'manual' })).toBe(true);
  });

  it('đơn giữ cũ thiếu holdSource (coi là manual) → báo', () => {
    expect(shouldNotifyCustomerOnManualUnhold({ heldAt })).toBe(true);
    expect(shouldNotifyCustomerOnManualUnhold({ heldAt, holdSource: null })).toBe(true);
  });

  it('heldAt dạng chuỗi (đọc từ JSON) vẫn tính là đang giữ', () => {
    expect(shouldNotifyCustomerOnManualUnhold({ heldAt: heldAt.toISOString(), holdSource: 'manual' })).toBe(true);
    expect(shouldNotifyCustomerOnManualUnhold({ heldAt: heldAt.toISOString(), holdSource: 'onospod' })).toBe(false);
  });

  it('đơn không đang giữ → không có gì để báo', () => {
    expect(shouldNotifyCustomerOnManualUnhold({})).toBe(false);
    expect(shouldNotifyCustomerOnManualUnhold({ heldAt: null, holdSource: 'manual' })).toBe(false);
  });

  it('danh sách lẫn hai loại (bulk) → chỉ báo đơn giữ tay', () => {
    const before = [
      { id: 'a', heldAt, holdSource: 'manual' },
      { id: 'b', heldAt, holdSource: HOLD_SOURCE_ONOSPOD },
      { id: 'c', heldAt },
      { id: 'd', heldAt, holdSource: HOLD_SOURCE_ONOSPOD },
    ];
    expect(before.filter(shouldNotifyCustomerOnManualUnhold).map((o) => o.id)).toEqual(['a', 'c']);
  });
});
