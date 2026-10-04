import { LEGACY_PRODUCT_TAGS } from './product-tag.seed';

describe('LEGACY_PRODUCT_TAGS', () => {
  it('has 18 tags whose shortNames are unique and fit the 30-char limit', () => {
    const shortNames = LEGACY_PRODUCT_TAGS.map((t) => t.slug.toUpperCase());
    expect(shortNames).toHaveLength(18);
    expect(new Set(shortNames).size).toBe(18);
    expect(shortNames.every((s) => s.length <= 30)).toBe(true);
  });
});
