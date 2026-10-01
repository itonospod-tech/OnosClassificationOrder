/**
 * `GET /orders?productLine=` (CSV, already validated by `GetProductionOrdersZod`) →
 * Mongo condition. `__none__` → `null`: `$in: [null]` matches both a missing field
 * and null (orders from before PRD-8), so no `$or` is needed — an `$or` here would
 * get tangled with the search `$or`.
 */
export function productLineCondition(csv?: string): { $in: (string | null)[] } | undefined {
  const lines = (csv ?? '').split(',').filter(Boolean);
  return lines.length ? { $in: lines.map((l) => (l === '__none__' ? null : l)) } : undefined;
}
