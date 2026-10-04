/**
 * Canonical form of a bank/payment reference before it is stored and checked for reuse.
 * Bank references are case-insensitive and often copied with stray spaces ("abc 123" and
 * "ABC123" are the same transfer), so without this the uniqueness check would be trivially bypassed.
 * Returns undefined for blank input.
 */
export function normalizeExternalTxnId(raw: string | undefined | null): string | undefined {
  const normalized = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  return normalized || undefined;
}
