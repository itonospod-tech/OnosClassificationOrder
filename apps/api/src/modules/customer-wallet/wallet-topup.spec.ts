import { normalizeExternalTxnId } from './wallet-topup';

describe('normalizeExternalTxnId', () => {
  it('treats case and stray whitespace as the same reference', () => {
    expect(normalizeExternalTxnId('  abc 123 ')).toBe('ABC123');
    expect(normalizeExternalTxnId('ABC123')).toBe('ABC123');
    expect(normalizeExternalTxnId('abc\t12\n3')).toBe('ABC123');
  });

  it('returns undefined for blank input so no empty reference is ever stored', () => {
    expect(normalizeExternalTxnId('   ')).toBeUndefined();
    expect(normalizeExternalTxnId('')).toBeUndefined();
    expect(normalizeExternalTxnId(undefined)).toBeUndefined();
    expect(normalizeExternalTxnId(null)).toBeUndefined();
  });
});
