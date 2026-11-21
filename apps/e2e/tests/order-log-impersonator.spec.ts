/**
 * D10 — rows written by `OrderLogService.writeMany()` carry the impersonator, like `write()`.
 * A REAL impersonation session (`POST /auth/impersonate`) makes a REAL bulk edit (`PATCH /orders/bulk-field`,
 * logged through writeMany); the rows are read back from `orderLogs`.
 */
import { expect, test } from '@playwright/test';

import { call, must, tokenFor } from '../support/api';
import { db } from '../support/db';
import { actor, seedOrder, user } from '../support/seed';

/** writeMany is fire-and-forget after the response — wait for the rows instead of a fixed sleep. */
async function bulkRows(orderIds: string[]): Promise<any[]> {
  const logs = (await db()).collection('orderLogs');
  for (let i = 0; i < 40; i++) {
    const rows = await logs.find({ orderId: { $in: orderIds }, action: 'bulk_update', field: 'priority' }).toArray();
    if (rows.length >= orderIds.length) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return logs.find({ orderId: { $in: orderIds }, action: 'bulk_update', field: 'priority' }).toArray();
}

test('@api a bulk edit made while impersonating logs the impersonator on every row (D10)', async () => {
  const [a, b] = [await seedOrder(), await seedOrder()];
  const admin = await user('admin');
  const culprit = await user('culprit');

  const started = await must('admin', 'POST', '/auth/impersonate', { targetType: 'user', targetId: String(culprit._id) });
  const impersonated = started.data.accessToken as string;

  const res = await call(impersonated, 'PATCH', '/orders/bulk-field', { ids: [a._id, b._id], field: 'priority', value: '2' });
  expect(res.status).toBe(200);

  const rows = await bulkRows([a._id, b._id]);
  expect(rows.map((r) => r.orderId).sort()).toEqual([a._id, b._id].sort());
  const who = await actor('culprit');
  for (const r of rows) {
    // The effective user is the impersonated account; the impersonator is recorded beside it.
    expect(r).toMatchObject({ userId: who.userId, userEmail: who.userEmail });
    expect([String(r.before), String(r.after)]).toEqual(['0', '2']);
    expect(r.impersonatorId).toBe(String(admin._id));
    expect(r.impersonatorName).toBe(admin.fullName);
  }
});

test('@api the same bulk edit from a normal session leaves the impersonator empty (D10)', async () => {
  const [a, b] = [await seedOrder(), await seedOrder()];
  const res = await call(await tokenFor('culprit'), 'PATCH', '/orders/bulk-field', { ids: [a._id, b._id], field: 'priority', value: '3' });
  expect(res.status).toBe(200);

  const rows = await bulkRows([a._id, b._id]);
  expect(rows).toHaveLength(2);
  const who = await actor('culprit');
  for (const r of rows) {
    expect(r.userId).toBe(who.userId);
    expect(String(r.after)).toBe('3');
    expect(r.impersonatorId ?? null).toBeNull();
    expect(r.impersonatorName ?? null).toBeNull();
  }
});
