import {
  buildReceiptCode,
  buildReconcileOrderFilter,
  buildScanOutRequestId,
  resolveInventorySku,
  vnDayRange,
} from './inventory.logic';

describe('resolveInventorySku', () => {
  it('khớp size → dùng NGUYÊN variation SKU (giữ đuôi size, khác tem)', () => {
    const r = resolveInventorySku({ type: 'Camo Shirt', size: 'XL' }, ['CAMOSHIRT-M', 'CAMOSHIRT-XL']);
    expect(r).toEqual({ sku: 'CAMOSHIRT-XL', resolvedBy: 'variation' });
  });

  it('khớp size lỏng tay qua dấu phân tách (10.6x62.2 vs 10.6X62.2)', () => {
    const r = resolveInventorySku({ size: '10.6x62.2' }, ['AOP-CUS-SHAPE-TIE-10.6X62.2']);
    expect(r).toEqual({ sku: 'AOP-CUS-SHAPE-TIE-10.6X62.2', resolvedBy: 'variation' });
  });

  it('không khớp size → base SKU + đuôi size chuẩn hóa', () => {
    const r = resolveInventorySku({ size: '3XL' }, ['CAMOSHIRT-M', 'CAMOSHIRT-XL']);
    expect(r).toEqual({ sku: 'CAMOSHIRT-3XL', resolvedBy: 'base-size' });
  });

  it('đơn không size, có variations → base SKU trần', () => {
    const r = resolveInventorySku({}, ['CAMOSHIRT-M', 'CAMOSHIRT-XL']);
    expect(r.resolvedBy).toBe('base-size');
    expect(r.sku).toBe('CAMOSHIRT');
  });

  it('không có variation → fallback type + size', () => {
    const r = resolveInventorySku({ type: 'Doormat', size: '40x60' }, []);
    expect(r).toEqual({ sku: 'DOORMAT-40X60', resolvedBy: 'fallback' });
  });

  it('không có gì → null', () => {
    expect(resolveInventorySku({}, [])).toEqual({ sku: null, resolvedBy: null });
  });

  it('kết quả luôn uppercase (khớp entity uppercase:true)', () => {
    const r = resolveInventorySku({ size: 'xl' }, ['camoshirt-xl']);
    expect(r.sku).toBe('CAMOSHIRT-XL');
  });
});

describe('buildScanOutRequestId', () => {
  it('gắn attempt vào productionId — lần 1 và rework lần 2 KHÔNG đụng nhau', () => {
    expect(buildScanOutRequestId('AT-69032-00427', 1)).toBe('AT-69032-00427#1');
    expect(buildScanOutRequestId('AT-69032-00427', 2)).toBe('AT-69032-00427#2');
  });
});

describe('buildReceiptCode', () => {
  // 2026-09-21 10:00 VN = 03:00 UTC.
  const luc = new Date('2026-09-21T03:00:00Z');

  it('phiếu nhập theo khuôn NK-<xưởng>-<ngày VN>-<seq>', () => {
    expect(buildReceiptCode('in', 'MLDTF', luc, 1)).toBe('NK-MLDTF-210926-01');
  });

  it('phiếu xuất prefix XK, thiếu xưởng → NA', () => {
    expect(buildReceiptCode('out', undefined, luc, 12)).toBe('XK-NA-210926-12');
  });

  it('ngày tính giờ VN: 23h VN hôm 21 (16h UTC) vẫn là ngày 21', () => {
    expect(buildReceiptCode('in', 'ML', new Date('2026-09-21T16:30:00Z'), 3)).toBe('NK-ML-210926-03');
  });
});

describe('vnDayRange + buildReconcileOrderFilter', () => {
  it('ngày VN 2026-09-21 = [20T17:00Z, 21T17:00Z)', () => {
    const { start, end } = vnDayRange('2026-09-21');
    expect(start.toISOString()).toBe('2026-09-20T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-21T17:00:00.000Z');
  });

  it('filter: đúng xưởng + In xong trong ngày + loại đơn hủy', () => {
    const f = buildReconcileOrderFilter('fac1', '2026-09-21');
    expect(f.factoryId).toBe('fac1');
    expect(f.cancelledAt).toEqual({ $exists: false });
    const cond = f['fulfillmentStages.print.completedAt'] as { $gte: Date; $lt: Date };
    expect(cond.$gte.toISOString()).toBe('2026-09-20T17:00:00.000Z');
    expect(cond.$lt.toISOString()).toBe('2026-09-21T17:00:00.000Z');
  });
});
