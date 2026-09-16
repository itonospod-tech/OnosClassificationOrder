import type { HoldSyncOrderState, OnospodHoldItem } from './onospod-hold-sync.plan';
import {
  indexOnospodHoldItems,
  ONOSPOD_HOLD_SYNC_WINDOW_DAYS,
  planOnospodHoldSync,
  resolveOnHoldAt,
} from './onospod-hold-sync.plan';

/**
 * Đồng bộ giữ đơn theo OnosPod (Orders.md §9d). Sai ở đây là nhả nhầm đơn
 * nhân viên đang giữ, hoặc giữ lại đơn nhân viên vừa cố ý mở — nên phủ đủ
 * từng luật USER đã chốt.
 */
const NOW = new Date('2026-09-11T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const WINDOW_START = new Date(NOW.getTime() - ONOSPOD_HOLD_SYNC_WINDOW_DAYS * DAY);
const RECENT = new Date(NOW.getTime() - 2 * DAY); // inProductionAt trong cửa sổ
const HOLD_T1 = new Date('2026-09-11T06:50:28.942Z');
const HOLD_T2 = new Date('2026-09-11T09:00:00.000Z');
const SEEN_OLD = new Date('2026-09-11T07:00:00.000Z');

let seq = 0;
const order = (over: Partial<HoldSyncOrderState> = {}): HoldSyncOrderState => {
  seq++;
  return { orderId: `o${seq}`, productionId: `PID-${seq}`, inProductionAt: RECENT, ...over };
};
const item = (productionId: string, onHoldAt: Date = HOLD_T1): OnospodHoldItem => ({ productionId, onHoldAt });

const run = (items: OnospodHoldItem[], orders: HoldSyncOrderState[], limits?: Parameters<typeof planOnospodHoldSync>[0]['limits']) =>
  planOnospodHoldSync({ items, orders, now: NOW, windowStart: WINDOW_START, limits });

const pids = (xs: Array<{ productionId: string }>) => xs.map((x) => x.productionId);

describe('đồng bộ giữ đơn theo OnosPod — giữ', () => {
  it('đơn chưa xong, chưa giữ, OnosPod đang giữ → GIỮ kèm cờ (seenAt = lúc chạy)', () => {
    const o = order();
    const plan = run([item(o.productionId)], [o]);
    expect(plan.aborted).toBe(false);
    expect(pids(plan.toHold)).toEqual([o.productionId]);
    expect(plan.toHold[0].flag).toEqual({ onHoldAt: HOLD_T1, seenAt: NOW });
    expect(plan.toUnhold).toEqual([]);
  });

  it('đơn đã hoàn thành fulfillment → KHÔNG giữ, chỉ gắn cờ', () => {
    const o = order({ fulfillmentCompletedAt: new Date('2026-09-10T00:00:00Z') });
    const plan = run([item(o.productionId)], [o]);
    expect(plan.toHold).toEqual([]);
    expect(plan.flagOnly).toHaveLength(1);
    expect(plan.flagOnly[0].why).toBe('completed');
  });

  it('đơn đã hủy → KHÔNG giữ, chỉ gắn cờ', () => {
    const o = order({ cancelledAt: new Date('2026-09-10T00:00:00Z') });
    const plan = run([item(o.productionId)], [o]);
    expect(plan.toHold).toEqual([]);
    expect(plan.flagOnly[0].why).toBe('cancelled');
  });

  it('nhân viên đang giữ (manual) → không đổi lý do/nguồn, chỉ gắn cờ', () => {
    const o = order({ heldAt: new Date(), holdSource: 'manual' });
    const plan = run([item(o.productionId)], [o]);
    expect(plan.toHold).toEqual([]);
    expect(plan.flagOnly[0].why).toBe('held_manual');
  });

  it('đơn giữ cũ KHÔNG có holdSource coi như manual → chỉ gắn cờ', () => {
    const o = order({ heldAt: new Date() });
    const plan = run([item(o.productionId)], [o]);
    expect(plan.toHold).toEqual([]);
    expect(plan.flagOnly[0].why).toBe('held_manual');
  });

  it('đơn nhân viên đã bỏ qua đợt giữ này (dismissedAt = onHoldAt) → không giữ lại', () => {
    const o = order({ onospodHoldDismissedAt: HOLD_T1, onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD } });
    const plan = run([item(o.productionId, HOLD_T1)], [o]);
    expect(plan.toHold).toEqual([]);
    expect(pids(plan.dismissedSkip)).toEqual([o.productionId]);
    expect(plan.flagOnly).toEqual([]); // cờ đã đúng đợt → không ghi
    expect(plan.unchanged).toBe(1);
  });

  it('OnosPod có ĐỢT giữ mới hơn mốc đã bỏ qua → giữ lại', () => {
    const o = order({ onospodHoldDismissedAt: HOLD_T1, onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD } });
    const plan = run([item(o.productionId, HOLD_T2)], [o]);
    expect(pids(plan.toHold)).toEqual([o.productionId]);
    expect(plan.toHold[0].flag).toEqual({ onHoldAt: HOLD_T2, seenAt: NOW });
  });

  it('đơn đã giữ theo OnosPod, cùng đợt → idempotent (không ghi gì)', () => {
    const o = order({
      heldAt: new Date(),
      holdSource: 'onospod',
      onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD },
    });
    const plan = run([item(o.productionId, HOLD_T1)], [o]);
    expect(plan.toHold).toEqual([]);
    expect(plan.flagOnly).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('đơn giữ theo OnosPod, OnosPod đổi sang đợt mới → chỉ làm mới cờ', () => {
    const o = order({
      heldAt: new Date(),
      holdSource: 'onospod',
      onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD },
    });
    const plan = run([item(o.productionId, HOLD_T2)], [o]);
    expect(plan.flagOnly).toHaveLength(1);
    expect(plan.flagOnly[0].why).toBe('refresh');
    expect(plan.flagOnly[0].flag).toEqual({ onHoldAt: HOLD_T2, seenAt: NOW });
  });

  it('cờ đã gắn cho đơn đã xong, cùng đợt → giữ nguyên seenAt, không ghi', () => {
    const o = order({ fulfillmentCompletedAt: new Date(), onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD } });
    const plan = run([item(o.productionId, HOLD_T1)], [o]);
    expect(plan.flagOnly).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('item OnosPod không có đơn bên mình → notFound, không lỗi', () => {
    const plan = run([item('KHONG-CO')], []);
    expect(plan.notFound).toEqual(['KHONG-CO']);
    expect(plan.aborted).toBe(false);
  });
});

describe('đồng bộ giữ đơn theo OnosPod — nhả', () => {
  const otherHeld = (n: number) =>
    Array.from({ length: n }, () => {
      const o = order({ heldAt: new Date(), holdSource: 'onospod', onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD } });
      return { o, it: item(o.productionId) };
    });

  it('đơn giữ theo OnosPod, OnosPod đã nhả → NHẢ', () => {
    const released = order({ heldAt: new Date(), holdSource: 'onospod', onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD } });
    const still = otherHeld(3);
    const plan = run(
      still.map((s) => s.it),
      [released, ...still.map((s) => s.o)],
    );
    expect(plan.aborted).toBe(false);
    expect(pids(plan.toUnhold)).toEqual([released.productionId]);
  });

  it('đơn nhân viên giữ (manual) mang cờ, OnosPod nhả → KHÔNG nhả, chỉ gỡ cờ', () => {
    const o = order({ heldAt: new Date(), holdSource: 'manual', onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD } });
    const keep = otherHeld(1);
    const plan = run([keep[0].it], [o, keep[0].o]);
    expect(plan.toUnhold).toEqual([]);
    expect(pids(plan.clearFlag)).toEqual([o.productionId]);
  });

  it('đơn giữ cũ không holdSource, OnosPod nhả → KHÔNG nhả', () => {
    const o = order({ heldAt: new Date(), onospodHold: { onHoldAt: HOLD_T1, seenAt: SEEN_OLD } });
    const plan = run([], [o]);
    expect(plan.aborted).toBe(false); // không có đơn giữ-do-đồng-bộ → tập rỗng không đáng ngờ
    expect(plan.toUnhold).toEqual([]);
    expect(pids(plan.clearFlag)).toEqual([o.productionId]);
  });

  it('đơn giữ theo OnosPod nhưng inProductionAt ngoài cửa sổ → không nhả (có thể chỉ trôi khỏi cửa sổ)', () => {
    const old = order({
      heldAt: new Date(),
      holdSource: 'onospod',
      inProductionAt: new Date(WINDOW_START.getTime() - DAY),
    });
    const keep = otherHeld(2);
    const plan = run(keep.map((k) => k.it), [old, ...keep.map((k) => k.o)]);
    expect(plan.toUnhold).toEqual([]);
    expect(pids(plan.outOfWindow)).toEqual([old.productionId]);
  });

  it('đơn giữ theo OnosPod thiếu inProductionAt → không nhả', () => {
    const o = order({ heldAt: new Date(), holdSource: 'onospod', inProductionAt: null });
    const keep = otherHeld(1);
    const plan = run([keep[0].it], [o, keep[0].o]);
    expect(plan.toUnhold).toEqual([]);
    expect(pids(plan.outOfWindow)).toEqual([o.productionId]);
  });

  it('đơn không giữ, không cờ, OnosPod không giữ → không làm gì', () => {
    const plan = run([], [order()]);
    expect(plan.unchanged).toBe(1);
    expect(plan.clearFlag).toEqual([]);
  });
});

describe('đồng bộ giữ đơn theo OnosPod — an toàn', () => {
  const syncedHeld = () => order({ heldAt: new Date(), holdSource: 'onospod' });

  it('tập On Hold RỖNG trong khi có đơn giữ-do-đồng-bộ → bỏ cả lượt', () => {
    const plan = run([], [syncedHeld()]);
    expect(plan.aborted).toBe(true);
    expect(plan.reason).toMatch(/0 item On Hold/);
  });

  it('vượt trần số đơn nhả tuyệt đối → bỏ cả lượt', () => {
    const held = Array.from({ length: 30 }, syncedHeld);
    const stillHeld = Array.from({ length: 70 }, syncedHeld);
    const plan = run(
      stillHeld.map((o) => item(o.productionId)),
      [...held, ...stillHeld],
      { maxUnhold: 20 },
    );
    expect(plan.toUnhold).toHaveLength(30);
    expect(plan.aborted).toBe(true);
    expect(plan.reason).toMatch(/vượt trần 20/);
  });

  it('vượt 50% số đơn giữ-do-đồng-bộ (≥ ngưỡng dưới) → bỏ cả lượt', () => {
    const released = Array.from({ length: 6 }, syncedHeld);
    const still = Array.from({ length: 4 }, syncedHeld);
    const plan = run(
      still.map((o) => item(o.productionId)),
      [...released, ...still],
    );
    expect(plan.aborted).toBe(true);
    expect(plan.reason).toMatch(/6\/10/);
  });

  it('nhả ít (dưới ngưỡng dưới) dù >50% → vẫn nhả (tránh kẹt khi chỉ có 1–2 đơn)', () => {
    const released = syncedHeld();
    const still = syncedHeld();
    const plan = run([item(still.productionId)], [released, still]);
    expect(plan.aborted).toBe(false);
    expect(pids(plan.toUnhold)).toEqual([released.productionId]);
  });

  it('kế hoạch bị bỏ vẫn trả danh sách để báo cáo, service không được ghi', () => {
    const plan = run([], [syncedHeld()]);
    expect(plan.aborted).toBe(true);
    expect(plan.syncedHeldCount).toBe(1);
  });
});

describe('parse item OnosPod', () => {
  it('lấy log On Hold MỚI NHẤT, bỏ log trạng thái khác', () => {
    const at = resolveOnHoldAt({
      mrp_created_at: '2026-09-10T13:19:40.841Z',
      mrp_updated_at: '2026-09-11T08:00:00.000Z',
      mrp_log: [
        { mrp_status: 'On Hold', created_at: '2026-09-10T20:00:00.000Z' },
        { mrp_status: 'In Sewing', created_at: '2026-09-11T01:00:00.000Z' },
        { mrp_status: 'On Hold', created_at: '2026-09-11T06:50:28.942Z' },
      ],
    });
    expect(at?.toISOString()).toBe('2026-09-11T06:50:28.942Z');
  });

  it('không có log On Hold → mrp_updated_at → mrp_created_at → null', () => {
    expect(resolveOnHoldAt({ mrp_updated_at: '2026-09-11T08:00:00.000Z', mrp_log: [] })?.toISOString()).toBe(
      '2026-09-11T08:00:00.000Z',
    );
    expect(resolveOnHoldAt({ mrp_created_at: '2026-09-10T00:00:00.000Z' })?.toISOString()).toBe(
      '2026-09-10T00:00:00.000Z',
    );
    expect(resolveOnHoldAt({})).toBeNull();
  });

  it('item trùng productionId → giữ đợt mới nhất, bỏ item rỗng', () => {
    const map = indexOnospodHoldItems([item('A', HOLD_T1), item('A', HOLD_T2), item(' ', HOLD_T1)]);
    expect(map.size).toBe(1);
    expect(map.get('A')).toEqual(HOLD_T2);
  });
});
