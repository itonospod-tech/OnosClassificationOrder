import { lastValueFrom, of } from 'rxjs';
import { PRICE_FIELD_KEYS, RoleType } from 'shared';

import { PriceVisibilityInterceptor, stripPriceFields } from './price-visibility.interceptor';

/**
 * Known bug (expected to fail). `STRICT_KNOWN=1` runs it as a normal test, to read the exact failure it hits
 * and check it fails for the right reason. Flip to `it` once the bug is fixed.
 */
const itKnown = process.env.STRICT_KNOWN ? it : it.failing;

/**
 * PR #77 report, bug 6 (present before the PR): a Designer no longer sees `baseCost` on the order list and
 * detail, but `GET /orders/:id/logs` still answers `{ field: 'baseCost', before: 5.09, after: 6 }` — the
 * interceptor drops price KEYS, and in a log row the price is a VALUE under `before`/`after`.
 * Log rows are seeded as the re-import writes them (order.service.ts, importOrders: one row per changed key).
 */
const priceRow = (field: string) => ({ _id: `L-${field}`, orderId: 'O1', action: 'update', field, before: 5.09, after: 6, createdAt: new Date(0) });
const logsBody = (rows: Array<Record<string, unknown>>) => ({ success: true, data: rows, total: rows.length });

/** Every log row that still carries a price value. */
const leakedPriceValues = (body: unknown): string[] =>
  ((body as { data: Array<Record<string, unknown>> }).data ?? [])
    .filter((r) => PRICE_FIELD_KEYS.includes(String(r.field)) && (r.before !== undefined || r.after !== undefined))
    .map((r) => String(r.field));

const run = async (role: string, body: unknown) => {
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: { role: { name: role } } }) }) };
  return lastValueFrom(new PriceVisibilityInterceptor().intercept(ctx as never, { handle: () => of(body) }) as never);
};

describe('bug 6 — price in order-log rows (pre-existing)', () => {
  // known bug present on main, not fixed in release 07/11 — flip to it() when fixed
  itKnown.each(PRICE_FIELD_KEYS)("stripPriceFields hides before/after of a '%s' log row", (field) => {
    expect(leakedPriceValues(stripPriceFields(logsBody([priceRow(field)])))).toEqual([]);
  });

  // known bug present on main, not fixed in release 07/11 — flip to it() when fixed
  itKnown('Designer through the interceptor: no price value in the logs response', async () => {
    const out = await run(RoleType.Designer, logsBody([priceRow('baseCost'), priceRow('shipCost')]));
    expect(leakedPriceValues(out)).toEqual([]);
  });

  // ---- neighbours (pass today, must keep passing) ----
  it('Designer: non-price log rows keep their before/after', async () => {
    const rows = [
      { _id: 'L1', orderId: 'O1', action: 'update', field: 'size', before: 'M', after: 'L' },
      { _id: 'L2', orderId: 'O1', action: 'update', field: 'designerStatus', before: 'assigned', after: 'done' },
    ];
    const out = (await run(RoleType.Designer, logsBody(rows))) as { data: unknown[] };
    expect(out.data).toEqual(rows);
  });

  it('Designer: a price KEY nested inside a log value is still removed (what already works)', async () => {
    const row = { _id: 'L3', orderId: 'O1', action: 'create', after: { productionId: 'P1', baseCost: 5.09, nested: { shipCost: 1 } } };
    const out = (await run(RoleType.Designer, logsBody([row]))) as { data: Array<{ after: Record<string, unknown> }> };
    expect(out.data[0].after).toEqual({ productionId: 'P1', nested: {} });
  });

  it('Admin gets the price log rows untouched', async () => {
    const body = logsBody([priceRow('baseCost')]);
    expect(await run(RoleType.Admin, body)).toBe(body);
  });

  it('list / detail shaped bodies stay stripped for Designer', async () => {
    const list = { success: true, data: [{ _id: 'O1', baseCost: 5.09, shipCost: 1, size: 'M' }], total: 1 };
    const detail = { success: true, data: { _id: 'O1', baseCost: 5.09, productConfig: { minCost: 1, maxCost: 2, fullName: 'Tee' } } };
    expect(await run(RoleType.Designer, list)).toEqual({ success: true, data: [{ _id: 'O1', size: 'M' }], total: 1 });
    expect(await run(RoleType.Designer, detail)).toEqual({ success: true, data: { _id: 'O1', productConfig: { fullName: 'Tee' } } });
  });
});
