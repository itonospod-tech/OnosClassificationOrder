/** Phone layout (project "mobile", Pixel 7): the order list renders without sideways scrolling. */
import { expect, test, type Page } from '@playwright/test';

import { knownBug } from '../support/known';
import { seedOrder } from '../support/seed';
import { loginAs } from '../support/ui';

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin');
});

test('orders list (flat and grouped) fits the phone width', async ({ page }) => {
  const o = await seedOrder();
  await page.goto('/ffm/orders/classic');
  await expect(page.getByText(o.productionId).first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto('/ffm/orders/workshop');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('multi-select tip on a phone does not tell people to hold Shift (report UI note)', async ({ page }) => {
  await seedOrder();
  await page.goto('/ffm/orders/classic');
  await expect(page.locator('p').filter({ hasText: /Tip for selecting multiple orders/ })).toBeVisible();
  knownBug('UI note from the PR #77 report (Shift tip on mobile), not fixed in release 07/11');
  await expect(page.locator('p').filter({ hasText: /Tip for selecting multiple orders/ })).not.toContainText('Shift');
});
