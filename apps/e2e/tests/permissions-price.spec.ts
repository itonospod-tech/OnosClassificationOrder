/**
 * Logged in as a Designer, like the PR #77 report did: what they must not reach (wallets, bulk undo, tool
 * queue return) and what they must not see (prices — bug 6 — and other designers' orders).
 */
import { expect, test } from '@playwright/test';

import { call } from '../support/api';
import { knownBug } from '../support/known';
import { ago, logRow, seedLogs, seedOrder, user } from '../support/seed';
import { loginAs } from '../support/ui';

/** An order assigned to `who`, with the import log row a re-import writes when the price changes. */
async function seedAssigned(who: 'designer' | 'designer2') {
  const d = await user(who);
  const o = await seedOrder({
    toolResultNote: 'no-pdf',
    assignee: String(d._id),
    designerStatus: 'assigned',
    designerAssignedAt: ago(60_000),
    baseCost: 6,
  });
  await seedLogs([logRow(o._id, {}, 'import', 'baseCost', 5.09, 6, ago(30_000))]);
  return o;
}

async function openClassicRow(page: import('@playwright/test').Page, pid: string) {
  await page.goto('/ffm/orders/classic');
  const search = page.getByPlaceholder(/Search Production ID/);
  await search.fill(pid);
  await search.press('Enter');
  return page.getByRole('row').filter({ hasText: pid });
}

test('designer: wallet / undo / tool-queue-return are not in the menu and their URLs are blocked', async ({ page }) => {
  const token = await loginAs(page, 'designer');
  const sidebar = page.getByRole('complementary').first();
  await expect(sidebar.getByRole('link', { name: 'Production' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: 'Wallet' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'System' })).toHaveCount(0);

  await page.goto('/adm/wallets');
  await expect(page).not.toHaveURL(/\/adm\/wallets/);
  await expect(page.getByRole('heading', { name: 'Seller wallets' })).toHaveCount(0);

  await page.goto('/adm/bulk-undo');
  await expect(page.getByText('Only SuperAdmin can use this page.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);

  await page.goto('/adm/tool-queue-return');
  await expect(page.getByText('SuperAdmin only.')).toBeVisible();

  // The server says no as well (the screen is only the second lock).
  const now = Date.now();
  const window = { actor: 'x', from: new Date(now - 60_000).toISOString(), to: new Date(now).toISOString(), group: 'designer' };
  expect((await call(token, 'GET', '/admin/customer-wallets')).status).toBe(403);
  expect((await call(token, 'POST', '/orders/bulk-undo/preview', window)).status).toBe(403);
  expect((await call(token, 'GET', '/orders/tool-queue-return')).status).toBe(403);
});

test('designer: order detail carries no price (screen and response)', async ({ page }) => {
  const mine = await seedAssigned('designer');
  await loginAs(page, 'designer');
  const row = await openClassicRow(page, mine.productionId);
  const detailRes = page.waitForResponse((r) => r.url().includes(`/orders/by-production-id/${mine.productionId}`));
  await row.getByRole('button', { name: mine.productionId, exact: true }).click();
  const body = await (await detailRes).json();
  expect(body.data.productionId).toBe(mine.productionId);
  expect(body.data).not.toHaveProperty('baseCost');
  expect(body.data).not.toHaveProperty('shipCost');
  const dialog = page.getByRole('dialog', { name: `Order detail — ${mine.productionId}` });
  await expect(dialog.getByText('Designer status')).toBeVisible();
  await expect(dialog).not.toContainText('5.09');
  await expect(dialog).not.toContainText('$6');
});

test('designer: the order history tab shows no baseCost values (bug 6)', async ({ page }) => {
  // known bug present on main, not fixed in release 07/11
  knownBug();
  const mine = await seedAssigned('designer');
  await loginAs(page, 'designer');
  const row = await openClassicRow(page, mine.productionId);
  await row.getByRole('button', { name: 'History' }).click();
  const dialog = page.getByRole('dialog', { name: `Change history — ${mine.productionId}` });
  await expect(dialog.getByText(/\d+ entries/)).toBeVisible();
  await expect(dialog).not.toContainText('baseCost');
  await expect(dialog).not.toContainText('5.09');
});

test("designer: another designer's order — detail is blocked, its history must be too", async ({ page }) => {
  // known bug present on main, not fixed in release 07/11
  knownBug();
  const others = await seedAssigned('designer2');
  const token = await loginAs(page, 'designer');

  // On screen the order simply is not there for this designer.
  const row = await openClassicRow(page, others.productionId);
  await expect(page.getByText(/No matching orders|Showing 0/).first()).toBeVisible();
  await expect(row).toHaveCount(0);

  // The same session asking the server directly (as a bookmarked / shared link would).
  expect((await call(token, 'GET', `/orders/by-production-id/${others.productionId}`)).status).toBe(404);
  expect((await call(token, 'GET', `/orders/${others._id}`)).status).toBe(403);
  const logs = await call(token, 'GET', `/orders/${others._id}/logs`);
  expect(logs.status, 'history of an order that is not yours').toBe(403);
});
