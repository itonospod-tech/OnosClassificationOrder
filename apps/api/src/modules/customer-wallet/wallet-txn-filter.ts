import type { GetAdminWalletTxnsDto } from 'shared';

/** `YYYY-MM-DD` as a Vietnam-time day boundary. `new Date('2026-10-01')` would be UTC midnight = 07:00 in Vietnam. */
const vnDayStart = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
const vnDayEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999+07:00`);

/**
 * Mongo filter for the all-sellers ledger.
 * `searchCustomerIds` is the result of resolving `dto.search` to sellers (undefined = no search).
 * Returns `null` when the filters can match nothing, so the caller can skip the query.
 */
export function buildAdminTxnFilter(
  dto: Pick<GetAdminWalletTxnsDto, 'customerId' | 'kind' | 'from' | 'to'>,
  searchCustomerIds?: string[],
): Record<string, unknown> | null {
  const filter: Record<string, unknown> = {};

  if (searchCustomerIds) {
    if (searchCustomerIds.length === 0) return null;
    if (dto.customerId) {
      // Both given: the seller must satisfy the search too.
      if (!searchCustomerIds.includes(dto.customerId)) return null;
      filter.customerId = dto.customerId;
    } else {
      filter.customerId = { $in: searchCustomerIds };
    }
  } else if (dto.customerId) {
    filter.customerId = dto.customerId;
  }

  if (dto.kind) filter.kind = dto.kind;
  if (dto.from || dto.to) {
    filter.createdAt = {
      ...(dto.from ? { $gte: vnDayStart(dto.from) } : {}),
      ...(dto.to ? { $lte: vnDayEnd(dto.to) } : {}),
    };
  }
  return filter;
}
