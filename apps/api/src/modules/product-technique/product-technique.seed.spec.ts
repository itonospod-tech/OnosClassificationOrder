import { LEGACY_PRODUCT_TECHNIQUES } from './product-technique.seed';

describe('LEGACY_PRODUCT_TECHNIQUES', () => {
  it('has 5 techniques whose shortNames are unique and fit the 30-char limit', () => {
    const shortNames = LEGACY_PRODUCT_TECHNIQUES.map((t) => t.slug.toUpperCase());
    expect(shortNames).toHaveLength(5);
    expect(new Set(shortNames).size).toBe(5);
    expect(shortNames.every((s) => s.length <= 30)).toBe(true);
  });
});
