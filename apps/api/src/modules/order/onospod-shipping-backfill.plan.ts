import type { ProductionOrderShippingAddress } from 'shared';

/**
 * Pure planning for the one-off shipping-address backfill (Orders.md §3.6): orders imported
 * from OnosPod before 2026-09-16 never got an address. We re-read their MRP items (which carry
 * the parent order `_id`), look the addresses up in batches, and fill ONLY the missing field —
 * never through `importOrders`, whose `$set` would also overwrite `factoryId` and designs.
 */
export interface BackfillMrpItem {
  increment_id?: string;
  order_id?: string;
}

export interface ShippingBackfillWrite {
  onospodOrderId: string;
  productionIds: string[];
  address: ProductionOrderShippingAddress;
}

/** Group the items still missing an address by their OnosPod parent order. */
function groupMissingByOrder(items: BackfillMrpItem[], missing: ReadonlySet<string>): Map<string, string[]> {
  const byOrder = new Map<string, string[]>();
  for (const item of items) {
    const pid = item.increment_id;
    const oid = item.order_id;
    if (!pid || !oid || !missing.has(pid)) continue;
    const list = byOrder.get(oid) ?? [];
    if (!list.includes(pid)) list.push(pid);
    byOrder.set(oid, list);
  }
  return byOrder;
}

/** OnosPod order ids worth a lookup: only those with at least one of OUR orders missing an address. */
export function orderIdsToLookUp(items: BackfillMrpItem[], missing: ReadonlySet<string>): string[] {
  return [...groupMissingByOrder(items, missing).keys()];
}

/** One write per OnosPod order that came back with an address; orders without one are skipped. */
export function buildShippingWrites(
  items: BackfillMrpItem[],
  missing: ReadonlySet<string>,
  byOrderId: ReadonlyMap<string, ProductionOrderShippingAddress>,
): ShippingBackfillWrite[] {
  const writes: ShippingBackfillWrite[] = [];
  for (const [onospodOrderId, productionIds] of groupMissingByOrder(items, missing)) {
    const address = byOrderId.get(onospodOrderId);
    if (address) writes.push({ onospodOrderId, productionIds, address });
  }
  return writes;
}
