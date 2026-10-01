/**
 * `GET /orders?productLine=` (CSV, đã validate ở `GetProductionOrdersZod`) → điều
 * kiện Mongo. `__none__` → `null`: `$in: [null]` khớp cả field thiếu lẫn null
 * (đơn trước PRD-8), không cần `$or` chen vào `$or` của search.
 */
export function productLineCondition(csv?: string): { $in: (string | null)[] } | undefined {
  const lines = (csv ?? '').split(',').filter(Boolean);
  return lines.length ? { $in: lines.map((l) => (l === '__none__' ? null : l)) } : undefined;
}
