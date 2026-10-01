/**
 * AND a condition into a Mongo filter through `$and`. Shared order-filter builders
 * must never assign `filter.$or` directly: `buildVisibilityFilter` keeps the
 * Fulfillment factory scope in `$or`, so overwriting it drops the scope and
 * appending to it widens the scope into an OR — either way a worker sees other
 * factories' orders.
 */
export function andWith(filter: Record<string, unknown>, cond: Record<string, unknown>): void {
  filter.$and = [...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []), cond];
}
