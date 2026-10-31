import type { ResyncAppItem, ResyncOrderState } from './onospod-order-resync.plan';
import { diffDesignKeys, formatResyncReport, planOnospodOrderResync } from './onospod-order-resync.plan';

/**
 * Đồng bộ đơn theo app (Orders.md §9e). Sai ở đây là ghi đè design/size của đơn
 * đã in, hoặc kéo nhầm đơn ngoài xưởng decor — nên phủ đủ từng luật USER chốt.
 * Dữ liệu dựa trên ca thật 29/10/2026: Wooden Ornament Garland đổi design + 5in→4in.
 */
const TYPE = 'Wooden Ornament Garland';
const OLD = { front: 'https://cdn/old-front.png', back: 'https://cdn/old-back.png' };
const NEW = { front: 'https://cdn/new-front.png', back: 'https://cdn/new-back.png' };

let seq = 0;
const order = (over: Partial<ResyncOrderState> = {}): ResyncOrderState => {
  seq++;
  return {
    orderId: `o${seq}`,
    productionId: `BN-${seq}`,
    type: TYPE,
    size: '5 in-10 ornaments',
    baseCost: 5.12,
    designs: OLD,
    printStarted: false,
    ...over,
  };
};
const item = (o: ResyncOrderState, over: Partial<ResyncAppItem> = {}): ResyncAppItem => ({
  productionId: o.productionId,
  manufactureSku: 'TN-DECOR',
  type: TYPE,
  size: '5 in-10 ornaments',
  sku: 'WOGLD-5-IN-10-ORNAMENTS',
  baseCost: 5.12,
  designs: OLD,
  ...over,
});
const run = (items: ResyncAppItem[], orders: ResyncOrderState[], maxWrites?: number) =>
  planOnospodOrderResync({ items, orders, manufactures: ['TN-DECOR'], maxWrites });
const pids = (xs: Array<{ productionId: string }>) => xs.map((x) => x.productionId);

describe('đồng bộ đơn theo app — phạm vi', () => {
  it('chỉ xét manufacture trong danh sách (không phân biệt hoa thường)', () => {
    const decor = order();
    const ml = order();
    const plan = planOnospodOrderResync({
      items: [item(decor, { manufactureSku: 'tn-decor', designs: NEW }), item(ml, { manufactureSku: 'ML', designs: NEW })],
      orders: [decor, ml],
      manufactures: ['TN-DECOR'],
    });
    expect(plan.considered).toBe(1);
    expect(pids(plan.designUpdates)).toEqual([decor.productionId]);
  });

  it('đơn hủy / đã xong fulfillment → bỏ qua', () => {
    const cancelled = order({ cancelledAt: new Date() });
    const done = order({ fulfillmentCompletedAt: new Date() });
    const plan = run([item(cancelled, { designs: NEW }), item(done, { size: '4 in-10 ornaments' })], [cancelled, done]);
    expect(plan.designUpdates).toEqual([]);
    expect(plan.sizeUpdates).toEqual([]);
    expect(plan.notices).toEqual([]);
  });

  it('app có mà fac chưa có đơn → notFound, không ghi', () => {
    const ghost = order();
    const plan = run([item(ghost, { designs: NEW })], []);
    expect(plan.notFound).toEqual([ghost.productionId]);
    expect(plan.designUpdates).toEqual([]);
  });

  it('không lệch gì → unchanged', () => {
    const o = order();
    const plan = run([item(o)], [o]);
    expect(plan.unchanged).toBe(1);
    expect(plan.designUpdates.length + plan.sizeUpdates.length + plan.notices.length).toBe(0);
  });
});

describe('đồng bộ đơn theo app — design', () => {
  it('design đổi, đơn chưa vào In, không giữ → cập nhật (liệt kê vị trí đổi)', () => {
    const o = order();
    const plan = run([item(o, { designs: NEW })], [o]);
    expect(plan.designUpdates).toEqual([{ orderId: o.orderId, productionId: o.productionId, changedKeys: ['front', 'back'] }]);
  });

  it('so với designsOriginal trước (cùng cách nút "Kiểm tra design mới")', () => {
    const o = order({ designs: { front: 'https://cdn/processed.png' }, designsOriginal: { front: NEW.front } });
    expect(diffDesignKeys({ front: NEW.front }, o)).toEqual([]);
  });

  it('app không trả vị trí đó → không coi là lệch', () => {
    const o = order({ designs: { ...OLD, sleeve: 'https://cdn/sleeve.png' } });
    expect(diffDesignKeys(OLD, o)).toEqual([]);
  });

  it('đã vào In → CHỈ BÁO, không ghi', () => {
    const o = order({ printStarted: true });
    const plan = run([item(o, { designs: NEW })], [o]);
    expect(plan.designUpdates).toEqual([]);
    expect(plan.notices.map((n) => n.reason)).toEqual(['design-after-print']);
  });

  it('đang giữ → CHỈ BÁO (đơn giữ có luồng lấy design riêng §9c)', () => {
    const o = order({ heldAt: new Date() });
    const plan = run([item(o, { designs: NEW })], [o]);
    expect(plan.designUpdates).toEqual([]);
    expect(plan.notices.map((n) => n.reason)).toEqual(['design-held']);
  });
});

describe('đồng bộ đơn theo app — size (map lại SKU)', () => {
  it('size đổi, chưa vào In → cập nhật size + giá vốn theo app', () => {
    const o = order();
    const plan = run([item(o, { size: '4 in-10 ornaments', sku: 'WOGLD-4-IN-10-ORNAMENTS', baseCost: 4.8 })], [o]);
    expect(plan.sizeUpdates).toEqual([
      {
        orderId: o.orderId,
        productionId: o.productionId,
        before: '5 in-10 ornaments',
        after: '4 in-10 ornaments',
        baseCostBefore: 5.12,
        baseCostAfter: 4.8,
        sku: 'WOGLD-4-IN-10-ORNAMENTS',
      },
    ]);
  });

  it('khác hoa thường / khoảng trắng → không coi là lệch', () => {
    const o = order({ size: ' 5 In-10 Ornaments ' });
    expect(run([item(o)], [o]).sizeUpdates).toEqual([]);
  });

  it('app không có size → không đụng', () => {
    const o = order();
    expect(run([item(o, { size: undefined })], [o]).sizeUpdates).toEqual([]);
  });

  it('đã vào In → CHỈ BÁO', () => {
    const o = order({ printStarted: true });
    const plan = run([item(o, { size: '4 in-10 ornaments' })], [o]);
    expect(plan.sizeUpdates).toEqual([]);
    expect(plan.notices.map((n) => n.reason)).toEqual(['size-after-print']);
  });

  it('đổi cả design lẫn size (ca 29/10) → 2 cập nhật cho cùng đơn', () => {
    const o = order();
    const plan = run([item(o, { designs: NEW, size: '4 in-10 ornaments' })], [o]);
    expect(pids(plan.designUpdates)).toEqual([o.productionId]);
    expect(pids(plan.sizeUpdates)).toEqual([o.productionId]);
  });
});

describe('đồng bộ đơn theo app — đổi sản phẩm + an toàn', () => {
  it('đổi hẳn loại sản phẩm → CHỈ BÁO, không ghi design/size', () => {
    const o = order();
    const plan = run([item(o, { type: 'Wooden Door Corner Sign', designs: NEW, size: '1 layer' })], [o]);
    expect(plan.designUpdates).toEqual([]);
    expect(plan.sizeUpdates).toEqual([]);
    expect(plan.notices).toEqual([
      { orderId: o.orderId, productionId: o.productionId, reason: 'product-changed', detail: `${TYPE} → Wooden Door Corner Sign` },
    ]);
  });

  it('số đơn cần ghi vượt trần → bỏ cả lượt (đếm theo đơn, không theo dòng)', () => {
    const os = [order(), order(), order()];
    const items = os.map((o) => item(o, { designs: NEW, size: '4 in-10 ornaments' }));
    expect(run(items, os, 3).aborted).toBe(false);
    const plan = run(items, os, 2);
    expect(plan.aborted).toBe(true);
    expect(plan.reason).toContain('vượt trần 2');
  });

  it('item trùng productionId → gộp, giữ bản sau cùng', () => {
    const o = order();
    const plan = run([item(o, { designs: NEW }), item(o)], [o]);
    expect(plan.considered).toBe(1);
    expect(plan.unchanged).toBe(1);
  });
});

describe('báo cáo Telegram', () => {
  it('không có gì → null (không gửi)', () => {
    const o = order();
    expect(formatResyncReport(run([item(o)], [o]), { dryRun: true })).toBeNull();
  });

  it('dry-run ghi rõ là chưa ghi + liệt kê từng nhóm', () => {
    const a = order();
    const b = order({ printStarted: true });
    const text = formatResyncReport(run([item(a, { designs: NEW, size: '4 in-10 ornaments' }), item(b, { designs: NEW })], [a, b]), {
      dryRun: true,
    });
    expect(text).toContain('DRY-RUN');
    expect(text).toContain('chưa ghi');
    expect(text).toContain(`${a.productionId}: front, back`);
    expect(text).toContain(`${a.productionId}: 5 in-10 ornaments → 4 in-10 ornaments`);
    expect(text).toContain(`${b.productionId}: đổi design, đơn đã vào In`);
  });

  it('bị dừng → báo lý do', () => {
    const os = [order(), order()];
    const text = formatResyncReport(run(os.map((o) => item(o, { designs: NEW })), os, 1), { dryRun: false });
    expect(text).toContain('DỪNG');
  });
});
