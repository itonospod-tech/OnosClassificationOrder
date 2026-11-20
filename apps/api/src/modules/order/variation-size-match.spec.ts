import { resolveInventorySku } from '../inventory/inventory.logic';
import { resolveBarcodeSkuBase } from './barcode-label';
import { resolveShippingLabelInfo } from './shipping-label';
import { matchVariationBySize } from './variation-size-match';

const sku = (s: string) => s;

describe('matchVariationBySize — size là đuôi của size khác (L/XL, XL/2XL, S/XS)', () => {
  it.each([
    [['SHIRT-BLK-XL', 'SHIRT-BLK-L'], 'L', 'SHIRT-BLK-L'],
    [['SHIRT-BLK-2XL', 'SHIRT-BLK-XL'], 'XL', 'SHIRT-BLK-XL'],
    [['SHIRT-XS', 'SHIRT-S'], 'S', 'SHIRT-S'],
    [['SHIRT-L', 'SHIRT-XL'], 'XL', 'SHIRT-XL'],
    [['SHIRT_XL', 'SHIRT_L'], 'l', 'SHIRT_L'],
  ])('%j size %s → %s', (skus, size, want) => {
    expect(matchVariationBySize(skus, size, sku)).toBe(want);
  });

  it('SKU có dấu nối nhưng đuôi không đúng ranh giới → không khớp, kể cả khi là SKU duy nhất', () => {
    expect(matchVariationBySize(['SHIRT-XL'], 'L', sku)).toBeUndefined();
  });

  it('dấu nối lẫn trong đuôi size vẫn khớp (`A-2-XL` ↔ `2XL`, `10.6x62.2`)', () => {
    expect(matchVariationBySize(['A-XL', 'A-2-XL'], '2XL', sku)).toBe('A-2-XL');
    expect(matchVariationBySize(['AOP-TIE-10.6X62.2'], '10.6x62.2', sku)).toBe('AOP-TIE-10.6X62.2');
  });

  it('SKU dính liền không dấu nối → chọn SKU ngắn nhất khớp', () => {
    expect(matchVariationBySize(['TEEXL', 'TEEL'], 'L', sku)).toBe('TEEL');
    expect(matchVariationBySize(['TEE3XL'], '3XL', sku)).toBe('TEE3XL');
  });

  // Giới hạn ĐÃ BIẾT: luật chỉ xét size, không xét màu (đơn lưu `color: 'BLACK'`, SKU mã màu `BLK`).
  // Config nhiều màu → lấy biến thể ĐÚNG SIZE đứng ĐẦU danh sách config, có thể khác màu đơn.
  // Ca thật prod 20/11: "Women's Micro Rib Baby Tee - 1010", 2 đơn size S màu BLACK → `WT-1010-BAE-S`.
  // Test này khoá hành vi hiện tại; đổi sang khớp màu thì sửa test có chủ đích.
  it('config nhiều màu: chọn biến thể đúng size đứng đầu danh sách, KHÔNG xét màu (giới hạn đã biết)', () => {
    const wt1010 = ['WT-1010-BLK-XS', 'WT-1010-BAE-XS', 'WT-1010-BAE-S', 'WT-1010-PIK-S', 'WT-1010-BLK-S', 'WT-1010-BLK-M'];
    expect(matchVariationBySize(wt1010, 'S', sku)).toBe('WT-1010-BAE-S');
    expect(resolveBarcodeSkuBase(wt1010, 'S')).toBe('WT-1010-BAE');
    // Dù sai màu, size vẫn đúng — không còn rơi vào XS như luật cũ.
    expect(matchVariationBySize(wt1010, 'S', sku)).not.toMatch(/-XS$/);
  });

  it('thiếu size / không khớp → undefined', () => {
    expect(matchVariationBySize(['A-L'], undefined, sku)).toBeUndefined();
    expect(matchVariationBySize(['A-L'], '  ', sku)).toBeUndefined();
    expect(matchVariationBySize(['A-L'], 'M', sku)).toBeUndefined();
  });
});

describe('3 nơi dùng chung luật — không còn khớp nhầm L ↔ XL', () => {
  const vars = [
    { sku: 'SHIRT-BLK-XL', weight: 300 },
    { sku: 'SHIRT-BLK-L', weight: 250 },
  ];

  it('label giao hàng: size L → SKU + cân của biến thể L', () => {
    expect(resolveShippingLabelInfo(vars, 'L', undefined, 100)).toEqual({ sku: 'SHIRT-BLK-L', weightGram: 250 });
  });

  it('tem barcode: size L → gốc `SHIRT-BLK` (không phải `SHIRT-BLK-X`)', () => {
    expect(resolveBarcodeSkuBase(['SHIRT-BLK-XL', 'SHIRT-BLK-L'], 'L')).toBe('SHIRT-BLK');
  });

  it('SKU kho: size L → trừ đúng phôi `SHIRT-BLK-L`', () => {
    expect(resolveInventorySku({ type: 'Shirt', size: 'L' }, ['SHIRT-BLK-XL', 'SHIRT-BLK-L'])).toEqual({
      sku: 'SHIRT-BLK-L',
      resolvedBy: 'variation',
    });
  });

  it('kho: chỉ có biến thể XL mà đơn size L → không mượn XL, rơi về gốc + size', () => {
    expect(resolveInventorySku({ type: 'Shirt', size: 'L' }, ['SHIRT-BLK-XL', 'SHIRT-BLK-M'])).toEqual({
      sku: 'SHIRT-BLK-L',
      resolvedBy: 'base-size',
    });
  });
});
