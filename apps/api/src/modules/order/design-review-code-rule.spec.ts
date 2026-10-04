import { resolveDesignReviewCodeByDesigns } from './design-review-code-rule';

/**
 * Mã chạy tool theo option khách chọn (lộ qua vị trí design). `null` = caller
 * dùng `ProductConfig.designReviewCode` như cũ.
 */
describe('resolveDesignReviewCodeByDesigns — mã tool theo option', () => {
  const POLO = 'AOP-POLO-EMLOGO';
  const url = 'https://cdn.example.com/d.png';

  it('polo thêu + placket → PLTRU (thêu trụ)', () => {
    expect(resolveDesignReviewCodeByDesigns(POLO, { front: url, placket: url })).toBe('PLTRU');
  });

  it('polo thêu + chestLeft → PLNGUC (thêu ngực)', () => {
    expect(resolveDesignReviewCodeByDesigns(POLO, { front: url, chestLeft: url })).toBe('PLNGUC');
  });

  it('polo thêu không có option đặc biệt → null (dùng designReviewCode cũ)', () => {
    expect(resolveDesignReviewCodeByDesigns(POLO, { front: url })).toBeNull();
    expect(resolveDesignReviewCodeByDesigns(POLO, { front: url, placket: '' })).toBeNull();
    expect(resolveDesignReviewCodeByDesigns(POLO, {})).toBeNull();
    expect(resolveDesignReviewCodeByDesigns(POLO, undefined)).toBeNull();
    expect(resolveDesignReviewCodeByDesigns(POLO, null)).toBeNull();
  });

  it('polo thêu có CẢ placket lẫn chestLeft → null, không đoán', () => {
    expect(resolveDesignReviewCodeByDesigns(POLO, { front: url, chestLeft: url, placket: url })).toBeNull();
  });

  it('chestLeft + chestRight vẫn chỉ khớp 1 rule → PLNGUC', () => {
    expect(resolveDesignReviewCodeByDesigns(POLO, { front: url, chestLeft: url, chestRight: url })).toBe('PLNGUC');
  });

  it('SKU so khớp trim + không phân biệt hoa thường', () => {
    expect(resolveDesignReviewCodeByDesigns(' aop-polo-emlogo ', { placket: url })).toBe('PLTRU');
  });

  it('sản phẩm khác / không có SKU → null, hành vi không đổi', () => {
    expect(resolveDesignReviewCodeByDesigns('AOP-EMLOGOPOLO', { front: url, placket: url })).toBeNull();
    expect(resolveDesignReviewCodeByDesigns('PAOPPOLO', { front: url, chestLeft: url })).toBeNull();
    expect(resolveDesignReviewCodeByDesigns(undefined, { placket: url })).toBeNull();
    expect(resolveDesignReviewCodeByDesigns(null, { placket: url })).toBeNull();
    expect(resolveDesignReviewCodeByDesigns('', { placket: url })).toBeNull();
  });
});
