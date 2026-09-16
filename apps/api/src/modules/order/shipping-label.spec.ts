import { resolveShippingLabelInfo } from './shipping-label';

const VARIATIONS = [
  { sku: 'PAOPPOLO-SAME-DESIGN-S', weight: 200 },
  { sku: 'PAOPPOLO-SAME-DESIGN-M', weight: 220 },
  { sku: 'PAOPPOLO-SAME-DESIGN-3XL', weight: 288 },
];

describe('resolveShippingLabelInfo — SKU biến thể + cân nặng cho label giao hàng (Orders.md §16.8)', () => {
  it('khớp size → SKU đầy đủ của biến thể + cân của biến thể', () => {
    expect(resolveShippingLabelInfo(VARIATIONS, '3XL', undefined, 180)).toEqual({
      sku: 'PAOPPOLO-SAME-DESIGN-3XL',
      weightGram: 288,
    });
  });

  it('so khớp size lỏng tay (bỏ dấu nối, không phân biệt hoa thường)', () => {
    const vars = [{ sku: 'AOP-CUS-SHAPE-TIE-10.6X62.2', weight: 90 }];
    expect(resolveShippingLabelInfo(vars, '10.6x62.2', undefined, undefined).sku).toBe('AOP-CUS-SHAPE-TIE-10.6X62.2');
  });

  it('order.weight LUÔN thắng cân biến thể/mặc định', () => {
    expect(resolveShippingLabelInfo(VARIATIONS, '3XL', 300, 180).weightGram).toBe(300);
  });

  it('không khớp size → sku trống (không đoán bừa), cân rơi về default sản phẩm', () => {
    expect(resolveShippingLabelInfo(VARIATIONS, '5XL', undefined, 180)).toEqual({
      sku: undefined,
      weightGram: 180,
    });
  });

  it('thiếu size / không có biến thể → chỉ còn default; tất cả trống → weightGram undefined', () => {
    expect(resolveShippingLabelInfo([], undefined, undefined, 180).weightGram).toBe(180);
    expect(resolveShippingLabelInfo([], undefined, undefined, undefined).weightGram).toBeUndefined();
  });

  it('cân 0/âm coi như không có (dữ liệu rác) — rơi tiếp xuống nguồn sau', () => {
    expect(resolveShippingLabelInfo([{ sku: 'X-3XL', weight: 0 }], '3XL', 0, 180).weightGram).toBe(180);
  });
});
