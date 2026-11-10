/**
 * Return orders to the tool-check queue (/adm/tool-queue-return, SuperAdmin) — bug 5: an order already with
 * a designer, or already in production, must never be returned. Each test gives its orders a product type
 * of their own, so it can isolate them with the page's own "Group by product" view.
 */
import { expect, test, type Page } from '@playwright/test';

import { call } from '../support/api';
import { order, uniq } from '../support/db';
import { ago, H, seedOrder, user } from '../support/seed';
import { loginAs, toast } from '../support/ui';

let token = '';
test.beforeEach(async ({ page }) => {
  token = await loginAs(page, 'admin');
});

/** Three candidates (tool result, no note): one with a designer, one at Press, one free. */
async function seedTrio(type: string) {
  const designer = await user('designer');
  const withDesigner = await seedOrder({ type, assignee: String(designer._id), designerStatus: 'assigned', designerAssignedAt: ago(1 * H) });
  const inProduction = await seedOrder({
    type,
    readyForFulfill: true,
    currentFulfillmentStage: 'press',
    fulfillmentStages: {
      print: { status: 'done', reworkCount: 0, workMs: 600000, waitingAt: ago(5 * H), firstStartedAt: ago(4.5 * H), completedAt: ago(4 * H) },
      press: { status: 'waiting', reworkCount: 0, workMs: 0, waitingAt: ago(4 * H) },
    },
  });
  const free = await seedOrder({ type });
  return { withDesigner, inProduction, free };
}

const waitingCount = async (page: Page) => {
  // role=status, or role=alert once the queue looks stalled (orders waiting, the tool silent) — read the text.
  const text = await page.getByText(/orders waiting in the tool queue/).first().innerText();
  return Number(/(\d+) orders waiting/.exec(text)?.[1]);
};

/**
 * Opens the product group and returns the queue counter as the page shows it once its data has LOADED: the
 * counter comes with the list response, so wait for the grouped list's response and for the counter to show
 * that response's number (reading it earlier could pick up a value from before the response, or none).
 */
async function openGroup(page: Page, type: string): Promise<number> {
  await page.goto('/adm/tool-queue-return');
  await expect(page.getByRole('heading', { name: 'Return orders to the tool-check queue' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Returnable only' }).uncheck();
  const grouped = page.waitForResponse((r) => r.url().includes('/orders/tool-queue-return?') && r.url().includes('groupBy=type') && r.ok());
  await page.getByRole('button', { name: 'Group by product' }).click();
  const loaded = Number(((await (await grouped).json()) as { queue?: { waiting?: number } }).queue?.waiting);
  expect(Number.isFinite(loaded), 'queue counter in the list response').toBe(true);
  await expect(page.getByText(new RegExp(`\\b${loaded} orders waiting in the tool queue`)).first()).toBeVisible();
  const group = page.getByRole('listitem').filter({ hasText: type });
  await expect(group).toContainText('3 orders · 1 returnable');
  await group.getByRole('button', { name: 'View orders' }).click();
  return loaded;
}

test('the list explains why two orders cannot go back; returning the free one puts it in the tool queue (bug 5)', async ({ page }) => {
  const type = `E2E TQ ${uniq()}`;
  const { withDesigner, inProduction, free } = await seedTrio(type);
  const before = await openGroup(page, type);

  const rowOf = (pid: string) => page.getByRole('listitem').filter({ hasText: pid });
  await expect(rowOf(withDesigner.productionId)).toContainText('Already with a designer — the tool queue does not take it');
  await expect(rowOf(inProduction.productionId)).toContainText('In production (already in a stage) — not sent back to tool check');
  await expect(page.getByRole('checkbox', { name: withDesigner.productionId })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: inProduction.productionId })).toBeDisabled();
  expect(await waitingCount(page)).toBe(before);

  await page.getByRole('checkbox', { name: free.productionId }).check();
  await expect(page.getByText('Selected 1/')).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Return 1 orders to the tool-check queue' });
  await expect(dialog).toBeVisible();
  const run = dialog.getByRole('button', { name: 'Return 1 orders to the queue' });

  // Reason too short: the run stays locked (the server also refuses it, see below).
  await dialog.getByPlaceholder(/e\.g\. designReviewCode fixed/).fill('short');
  await dialog.getByRole('textbox').last().fill('1');
  await expect(run).toBeDisabled();

  await dialog.getByPlaceholder(/e\.g\. designReviewCode fixed/).fill('e2e: return the free order to the tool queue');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(toast(page, /Returned 1 orders to the queue \(run /)).toBeVisible();

  // The returned order is now in the tool queue: the page's queue counter moved by one…
  await expect.poll(() => waitingCount(page)).toBe(before + 1);
  // …and it left the candidate list (no tool result any more); the other two are still listed with their reason.
  await expect(page.getByRole('listitem').filter({ hasText: free.productionId })).toHaveCount(0);
  await expect(rowOf(withDesigner.productionId)).toBeVisible();

  const f = await order(free._id);
  expect(f.toolResult ?? null).toBeNull();
  expect(f.designerStatus).toBe('unassigned');
  expect(await order(withDesigner._id)).toMatchObject({ toolResult: 'has-tool', designerStatus: 'assigned' });
  expect(await order(inProduction._id)).toMatchObject({ toolResult: 'has-tool', currentFulfillmentStage: 'press' });
});

test('server side of the same screen: a mixed batch is done 1 / skipped 2 with reasons; a short reason is refused', async ({ page }) => {
  const type = `E2E TQ ${uniq()}`;
  const { withDesigner, inProduction, free } = await seedTrio(type);
  const ids = [withDesigner._id, inProduction._id, free._id];

  const short = await call(token, 'POST', '/orders/tool-queue-return/run', { ids: [free._id], reason: 'short' });
  expect(short.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(short.body)).toMatch(/reason/i);

  const preview = await call(token, 'POST', '/orders/tool-queue-return/preview', { ids });
  expect(preview.status).toBeLessThan(300);
  expect(preview.body.data.returnable).toBe(1);
  const reasons = Object.fromEntries((preview.body.data.skipped as Array<{ id: string; reason: string }>).map((s) => [s.id, s.reason]));
  expect(reasons).toEqual({ [withDesigner._id]: 'designer-assigned', [inProduction._id]: 'in-fulfillment' });

  const run = await call(token, 'POST', '/orders/tool-queue-return/run', { ids, reason: 'e2e: mixed batch straight to the API' });
  expect(run.status).toBeLessThan(300);
  expect(run.body.data.done).toBe(1);
  expect(run.body.data.skipped).toHaveLength(2);

  // And the screen agrees: only the two blocked orders are left in the group.
  await page.goto('/adm/tool-queue-return');
  await page.getByRole('checkbox', { name: 'Returnable only' }).uncheck();
  await page.getByRole('button', { name: 'Group by product' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: type })).toContainText('2 orders · 0 returnable');
});
