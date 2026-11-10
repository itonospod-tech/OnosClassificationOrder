/**
 * Smoke of the release UI the PR #77 report lists under "Đã chạy đúng" (sidebar, Workshop + funnel, flat
 * table + detail popover, variant SKU, language switch), plus the report's small UI notes written as
 * expected failures where they can be asserted reliably.
 */
import { expect, test, type Page } from '@playwright/test';

import { uniq } from '../support/db';
import { knownBug, uiNoteOnly } from '../support/known';
import { E2E_PRODUCT, seedOrder } from '../support/seed';
import { loginAs } from '../support/ui';

const sidebar = (page: Page) => page.getByRole('complementary').first();

async function searchClassic(page: Page, pid: string) {
  const search = page.getByPlaceholder(/Search Production ID|Tìm Production ID/);
  await search.fill(pid);
  await search.press('Enter');
  const row = page.getByRole('row').filter({ hasText: pid });
  await expect(row).toHaveCount(1);
  return row;
}

async function openPopover(page: Page, pid: string) {
  await page.goto('/ffm/orders/classic');
  const row = await searchClassic(page, pid);
  await row.getByRole('button', { name: 'Details and all fields' }).click();
  const pop = page.getByRole('dialog').filter({ hasText: pid });
  await expect(pop).toBeVisible();
  return pop;
}

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin');
});

test('sidebar navigation reaches the main sections', async ({ page }) => {
  await sidebar(page).getByRole('link', { name: 'Wallet' }).click();
  await expect(page).toHaveURL(/\/adm\/wallets/);
  await expect(page.getByRole('heading', { name: 'Seller wallets' })).toBeVisible();

  await sidebar(page).getByRole('link', { name: 'Production' }).click();
  await expect(page).toHaveURL(/\/ffm\/orders\/(workshop|classic)/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Order list|Orders/);

  await sidebar(page).getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/ffm\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
});

test('Workshop page: stage funnel counts the order, product rail and stage filter work', async ({ page }) => {
  const type = `E2E WS ${uniq()}`;
  const o = await seedOrder({ type });
  await page.goto('/ffm/orders/workshop');
  await expect(page.getByRole('heading', { name: 'Order list', level: 1 })).toBeVisible();
  const toolStage = page.getByRole('button', { name: /^Tool check \d+$/ });
  await expect(toolStage).toBeVisible();
  const n = Number((await toolStage.innerText()).replace(/\D+/g, ''));
  expect(n).toBeGreaterThanOrEqual(1);
  for (const stage of ['Design', 'Print', 'Press', 'QC', 'Sew in', 'Sew out', 'Pack']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${stage} \\d+$`) })).toBeVisible();
  }
  // Product rail: narrow to this test's own product type, then filter the funnel stage.
  const rail = page.getByRole('complementary').filter({ has: page.getByPlaceholder('Filter product types…') });
  await rail.getByPlaceholder('Filter product types…').fill(type);
  await rail.getByRole('button', { name: new RegExp(`^${type} 1 orders`) }).click();
  await toolStage.click();
  await expect(page.getByText(o.productionId)).toBeVisible();
  await expect(page.getByText('Waiting: Tool check').first()).toBeVisible();
});

test('flat table: search, variant SKU, detail popover', async ({ page }) => {
  const o = await seedOrder();
  await page.goto('/ffm/orders/workshop');
  await page.getByRole('button', { name: 'Flat table' }).click();
  await expect(page).toHaveURL(/\/ffm\/orders\/classic/);
  const row = await searchClassic(page, o.productionId);
  await expect(row).toContainText(E2E_PRODUCT.variantSku);
  await expect(row.getByRole('button', { name: 'Copy SKU' })).toBeVisible();
  await row.getByRole('button', { name: 'Details and all fields' }).click();
  const pop = page.getByRole('dialog').filter({ hasText: o.productionId });
  await expect(pop).toContainText('Seller account');
  await expect(pop).toContainText(E2E_PRODUCT.fullName);
  await expect(pop).toContainText('Designer status');
});

test('language switch vi ↔ en', async ({ page }) => {
  await page.goto('/ffm/orders/workshop');
  await expect(page.getByRole('heading', { name: 'Order list', level: 1 })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'en', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Danh sách đơn', level: 1 })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: 'Ví' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Danh sách đơn', level: 1 })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'vi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Order list', level: 1 })).toBeVisible();
});

test.describe('UI notes from the report (expected failures, only with E2E_UI_NOTES=1)', () => {
  // Font / machine dependent: skipped in the default suite so it stays deterministic.
  uiNoteOnly();

  test('detail popover: every field label is unique (report: two cells labelled NOTE)', async ({ page }) => {
    const o = await seedOrder();
    const pop = await openPopover(page, o.productionId);
    const labels = await pop.getByText('Note', { exact: true }).count();
    knownBug('UI note from the PR #77 report (duplicate NOTE label), not fixed in release 07/11');
    expect(labels, 'cells labelled "Note" in the popover').toBeLessThanOrEqual(1);
  });

  test('English UI has no Vietnamese leftovers (report: TRẠNG THÁI, Có Tool, NHÀ MÁY / PHÒNG)', async ({ page }) => {
    const o = await seedOrder();
    const pop = await openPopover(page, o.productionId);
    const text = (await page.locator('main').innerText()) + '\n' + (await pop.innerText());
    const leftovers = ['Trạng thái', 'Có Tool', 'Nhà máy / Phòng'].filter((s) => text.toLowerCase().includes(s.toLowerCase()));
    knownBug('UI note from the PR #77 report (mixed Vietnamese in the English UI), not fixed in release 07/11');
    expect(leftovers).toEqual([]);
  });

  test('order table headers are not cut off (report: TOOL RESULT / ERROR …, NGƯỜI THỰC HI…)', async ({ page }) => {
    const o = await seedOrder();
    await page.goto('/ffm/orders/classic');
    // Column widths settle only after the data rows and web fonts are in, so wait for both before measuring.
    await searchClassic(page, o.productionId);
    await page.evaluate(() => document.fonts.ready);
    const header = page.getByRole('row').first();
    await expect(header).toContainText('Order ID');
    // A header whose text is wider than its box is being cut with an ellipsis.
    const cut = await header.locator('th, [role="columnheader"], td').evaluateAll((cells) =>
      cells
        .flatMap((c) => [c, ...Array.from(c.querySelectorAll('*'))])
        .filter((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 && (el as HTMLElement).innerText.trim())
        .map((el) => (el as HTMLElement).innerText.trim()),
    );
    knownBug('UI note from the PR #77 report (truncated headers), not fixed in release 07/11');
    expect(cut).toEqual([]);
  });
});
