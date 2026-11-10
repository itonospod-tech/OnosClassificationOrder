/**
 * Undo a mistaken bulk edit (/adm/bulk-undo, SuperAdmin). The incident is a REAL bulk edit through the API
 * (`PATCH /orders/bulk-field`) by a second SuperAdmin ("culprit"), so every cascade and order-log row is the
 * one the app writes. History that has no API (who assigned the designer hours ago, the fulfillment
 * rework-back) is seeded as order-log rows in the code's own shape. The undo itself is done on screen.
 */
import { expect, test, type Page } from '@playwright/test';

import { call, must } from '../support/api';
import { order } from '../support/db';
import { USERS } from '../support/env';
import { actor, ago, H, logRow, seedLogs, seedOrder, user } from '../support/seed';
import { loginAs, toast } from '../support/ui';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** `datetime-local` value in the browser's zone (the config pins Asia/Ho_Chi_Minh, UTC+7). */
const local = (d: Date) => new Date(d.getTime() + 7 * H).toISOString().slice(0, 19);

let adminToken = '';
test.beforeEach(async ({ page }) => {
  adminToken = await loginAs(page, 'admin');
});

/** Runs `incident` as the culprit and returns a window around it, padded to whole seconds. */
async function incidentWindow(incident: () => Promise<void>): Promise<{ from: Date; to: Date }> {
  await sleep(1100);
  const from = new Date(Math.floor(Date.now() / 1000) * 1000 - 1000);
  await incident();
  const to = new Date(Math.ceil(Date.now() / 1000) * 1000 + 1000);
  await sleep(to.getTime() - Date.now() + 1100); // anything after this is "after the incident"
  return { from, to };
}

async function fillScope(page: Page, w: { from: Date; to: Date }, group: string) {
  await page.goto('/adm/bulk-undo');
  await expect(page.getByRole('heading', { name: 'Undo a bulk edit' })).toBeVisible();
  await page.getByLabel('Account that made the edit').fill(USERS.culprit.email);
  await page.getByLabel('From (local time)').fill(local(w.from));
  await page.getByLabel('To (local time)').fill(local(w.to));
  await page.getByLabel('Kind of change').selectOption({ label: group });
}

const rowOf = (page: Page, pid: string) => page.getByRole('row').filter({ hasText: pid }).first();

async function runBatch(page: Page, count: number) {
  await expect(page.getByText(`This batch: ${count} / ${count} restorable orders`)).toBeVisible();
  const runBtn = page.getByRole('button', { name: `Undo ${count} orders` });
  await page.getByPlaceholder(/Reason \(required, ≥10 characters\)/).fill('e2e: undo the mistaken bulk edit of the culprit');
  await expect(runBtn).toBeDisabled();
  await page.getByText(`Type ${count} to confirm`).locator('xpath=following-sibling::input').fill(String(count));
  await runBtn.click();
}

async function openOrderDetail(page: Page, pid: string) {
  await page.goto('/ffm/orders/classic');
  const search = page.getByPlaceholder(/Search Production ID/);
  await search.fill(pid);
  await search.press('Enter');
  await page.getByRole('button', { name: pid, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Order detail — ${pid}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('designer group: undo a mistaken unassign keeps the rework-back (bug 3) and restores a normal done order', async ({ page }) => {
  const designer = await user('designer');
  const D = String(designer._id);
  const leader = await actor('admin');
  const des = await actor('designer');
  const press = { userId: 'E2EPRESSWORKER01', userName: '[E2E] Press worker', userEmail: 'e2e.press@test.local', roleCode: 'Fulfillment' };

  // done → rework_back to the designer (fulfillment), still being reworked.
  const rework = await seedOrder({
    toolResultNote: 'no-pdf',
    assignee: D,
    designerStatus: 'rework',
    designerAssignedAt: ago(6 * H),
    designerStartedAt: ago(5.5 * H),
    designerCompletedAt: ago(5 * H),
    designerReworkAt: ago(1 * H),
    designerReworkCount: 1,
    productionErrorSource: 'designer',
    productionErrorNote: 'Sai mau in',
    currentFulfillmentStage: 'press',
    fulfillmentStages: { print: { status: 'done', reworkCount: 0, workMs: 600000, waitingAt: ago(4.9 * H), completedAt: ago(4 * H) }, press: { status: 'waiting', reworkCount: 0, workMs: 0, waitingAt: ago(1 * H) } },
  });
  // A plain done order.
  const normal = await seedOrder({
    toolResultNote: 'no-pdf',
    assignee: D,
    designerStatus: 'done',
    designerAssignedAt: ago(6 * H),
    designerStartedAt: ago(5.5 * H),
    designerCompletedAt: ago(5 * H),
    designerReworkCount: 0,
    readyForFulfill: true,
    currentFulfillmentStage: 'print',
    fulfillmentStages: { print: { status: 'waiting', reworkCount: 0, workMs: 0, waitingAt: ago(5 * H) } },
  });
  const history = (id: string) => [
    logRow(id, leader, 'update', 'assignee', null, D, ago(6 * H)),
    logRow(id, leader, 'update', 'designerStatus', 'unassigned', 'assigned', ago(6 * H)),
    logRow(id, des, 'update', 'designerStatus', 'assigned', 'in-progress', ago(5.5 * H)),
    logRow(id, des, 'update', 'designerStatus', 'in-progress', 'done', ago(5 * H)),
  ];
  await seedLogs([...history(rework._id), ...history(normal._id), logRow(rework._id, press, 'rework_back', 'designer', 'press', 'Sai mau in', ago(1 * H))]);

  // The incident: the culprit bulk-removes the designer from both orders.
  const w = await incidentWindow(async () => {
    await must('culprit', 'PATCH', '/orders/bulk-field', { ids: [rework._id, normal._id], field: 'assignee', value: null });
  });
  expect(await order(rework._id)).toMatchObject({ assignee: null, designerStatus: 'unassigned' });

  await fillScope(page, w, 'Designer removed (assignee)');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('2 orders affected · 2 restorable · 0 skipped')).toBeVisible();
  await expect(rowOf(page, rework.productionId)).toContainText('Will restore');
  await expect(rowOf(page, normal.productionId)).toContainText('Will restore');
  await runBatch(page, 2);
  await expect(toast(page, 'Restored 2 orders, skipped 0.')).toBeVisible();
  await expect(page.getByText('Restored 2 orders · skipped 0')).toBeVisible();

  const r = await order(rework._id);
  expect(r).toMatchObject({ assignee: D, designerStatus: 'rework', designerReworkCount: 1 });
  expect(r.designerReworkAt).toBeTruthy();
  expect(await order(normal._id)).toMatchObject({ assignee: D, designerStatus: 'done' });

  // What a person checking the order sees.
  const detail = await openOrderDetail(page, rework.productionId);
  await expect(detail.getByText('Designer status')).toBeVisible();
  await expect(detail).toContainText(/Designer status\s*rework/);
});

test('tool-ok group: an order a designer took after the incident is skipped "edited-after" (bug 4), the control order goes back to Print', async ({ page }) => {
  const designer = await user('designer');
  const a = await seedOrder();
  const b = await seedOrder();
  // Someone (admin) approves both with "ok" well before the incident.
  for (const o of [a, b]) {
    const res = await call(adminToken, 'PATCH', `/orders/${o._id}/field`, { field: 'toolResultNote', value: 'ok' });
    expect(res.status).toBeLessThan(300);
  }
  expect(await order(b._id)).toMatchObject({ toolResultNote: 'ok', readyForFulfill: true, currentFulfillmentStage: 'print' });

  const w = await incidentWindow(async () => {
    await must('culprit', 'PATCH', '/orders/bulk-field', { ids: [a._id, b._id], field: 'toolResultNote', value: null });
  });
  // After the incident a designer gets order A.
  const later = await call(adminToken, 'PATCH', `/orders/${a._id}/field`, { field: 'assignee', value: String(designer._id) });
  expect(later.status).toBeLessThan(300);

  await fillScope(page, w, "Tool approval 'ok' removed");
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('2 orders affected · 1 restorable · 1 skipped')).toBeVisible();
  await expect(rowOf(page, a.productionId)).toContainText('Someone changed it after the incident');
  await expect(rowOf(page, b.productionId)).toContainText('Will restore');
  await expect(page.getByText(/Skipped: Someone changed it after the incident \(1\)/)).toBeVisible();
  await runBatch(page, 1);
  // The run only receives the restorable batch, so its own summary has nothing skipped.
  await expect(toast(page, 'Restored 1 orders, skipped 0.')).toBeVisible();

  expect(await order(b._id)).toMatchObject({ toolResultNote: 'ok', readyForFulfill: true, currentFulfillmentStage: 'print' });
  const aNow = await order(a._id);
  expect(aNow.toolResultNote ?? null).toBeNull();
  expect(aNow.currentFulfillmentStage ?? null).toBeNull();
  expect(aNow.assignee).toBe(String(designer._id));
});

test('invalid window: "from" after "to" cannot be previewed, more than 24 h is refused by the server', async ({ page }) => {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  await fillScope(page, { from: now, to: new Date(now.getTime() - 60_000) }, 'Designer removed (assignee)');
  await expect(page.getByRole('button', { name: 'Preview' })).toBeDisabled();

  await page.getByLabel('From (local time)').fill(local(new Date(now.getTime() - 30 * H)));
  await page.getByLabel('To (local time)').fill(local(now));
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(toast(page, 'Khung sự cố tối đa 24 giờ.')).toBeVisible();
  await expect(page.getByText(/orders affected/)).toHaveCount(0);
});
