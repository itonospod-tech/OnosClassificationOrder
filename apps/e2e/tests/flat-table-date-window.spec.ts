/**
 * R1107-1 / R8 — flat order table on a product-line view: the line window (`PRODUCT_LINE_WINDOW_DAYS`, ending
 * today) is the DEFAULT, derived on every render, never written into the URL. Only a range the person picks goes
 * into `cfrom`/`cto`. Before the fix the default was persisted, so F5 / a bookmark the next day kept yesterday's
 * window (with a "Date" chip) and hid today's orders; leaving the line kept the line's dates.
 */
import { expect, test, type Page, type Request } from '@playwright/test';

import { loginAs } from '../support/ui';

const WINDOW_DAYS = 7; // `PRODUCT_LINE_WINDOW_DAYS` in packages/shared
const DAY = 24 * 60 * 60 * 1000;
const LINE_URL = '/ffm/orders/classic?productLine=3d';

/**
 * YYYY-MM-DD `daysAgo` days before `now` in the BROWSER's zone (the page uses local dates, never UTC; the config
 * pins `timezoneId` to Asia/Ho_Chi_Minh, which has no DST, so whole 24h steps are calendar days).
 */
const localISO = (now: Date, daysAgo = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(now.getTime() - daysAgo * DAY));

/** The order-list request the flat table sends (not the facet / count calls). */
const isListRequest = (r: Request) => /\/api\/v1\/orders\?/.test(r.url()) && new URL(r.url()).searchParams.has('page');

/** Runs `go` and returns the `createdFrom`/`createdTo` of the next order-list request. */
async function listRange(page: Page, go: () => Promise<unknown>) {
  const req = page.waitForRequest(isListRequest);
  await go();
  const sp = new URL((await req).url()).searchParams;
  return { from: sp.get('createdFrom'), to: sp.get('createdTo'), line: sp.get('productLine') };
}

const dateChip = (page: Page) => page.getByTitle('Clear Date filter');

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin');
});

test('line view opens on the line window without writing it into the URL', async ({ page }) => {
  const now = new Date();
  const range = await listRange(page, () => page.goto(LINE_URL));
  expect(range).toEqual({ from: localISO(now, WINDOW_DAYS - 1), to: localISO(now), line: '3d' });
  await page.waitForLoadState('networkidle');
  expect(new URL(page.url()).searchParams.has('cfrom')).toBe(false);
  expect(new URL(page.url()).searchParams.has('cto')).toBe(false);
  await expect(dateChip(page)).toHaveCount(0);
});

test('F5 the next day moves the window to the new today', async ({ page }) => {
  const today = new Date();
  // "Yesterday" first, then the real clock: the access token issued at login stays valid on both days.
  await page.clock.install({ time: new Date(today.getTime() - DAY) });
  const day1 = await listRange(page, () => page.goto(LINE_URL));
  const yesterday = new Date(today.getTime() - DAY);
  expect(day1.to).toBe(localISO(yesterday));
  await page.waitForLoadState('networkidle');

  await page.clock.setSystemTime(today);
  const day2 = await listRange(page, () => page.reload());
  expect(day2).toEqual({ from: localISO(today, WINDOW_DAYS - 1), to: localISO(today), line: '3d' });
  await expect(dateChip(page)).toHaveCount(0);
});

test('a range the person chose (shared link) survives F5 and shows its chip', async ({ page }) => {
  const url = `${LINE_URL}&cfrom=2026-01-01&cto=2026-01-03`;
  const first = await listRange(page, () => page.goto(url));
  expect(first).toEqual({ from: '2026-01-01', to: '2026-01-03', line: '3d' });
  await expect(dateChip(page)).toBeVisible();

  const again = await listRange(page, () => page.reload());
  expect(again).toEqual({ from: '2026-01-01', to: '2026-01-03', line: '3d' });
  expect(new URL(page.url()).searchParams.get('cfrom')).toBe('2026-01-01');

  // Clearing the chip returns to the line window (not persisted).
  const cleared = await listRange(page, () => dateChip(page).click());
  const now = new Date();
  expect(cleared).toEqual({ from: localISO(now, WINDOW_DAYS - 1), to: localISO(now), line: '3d' });
  await expect(page).not.toHaveURL(/cfrom=/);
});

/** In-app navigation (no reload, the page stays mounted) — what the sidebar / view links do. */
const navigateInApp = (page: Page, url: string) =>
  page.evaluate((u) => {
    window.history.pushState(null, '', u);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

test('switching productLine in-app follows the new view default unless dates were chosen', async ({ page }) => {
  const now = new Date();
  await page.goto(LINE_URL);
  await page.waitForLoadState('networkidle');

  // Line → no line: the line window must not stick.
  const all = await listRange(page, () => navigateInApp(page, '/ffm/orders/classic'));
  expect(all).toEqual({ from: null, to: null, line: null });
  await page.waitForLoadState('networkidle');
  await expect(page).not.toHaveURL(/cfrom=|cto=/);

  // No line → line: opens on the new line's window.
  const twoD = await listRange(page, () => navigateInApp(page, '/ffm/orders/classic?productLine=2d'));
  expect(twoD).toEqual({ from: localISO(now, WINDOW_DAYS - 1), to: localISO(now), line: '2d' });
  await page.waitForLoadState('networkidle');

  // A range the person chose (here: opened from a shared link) survives a line switch.
  await page.goto('/ffm/orders/classic?productLine=2d&cfrom=2026-01-01&cto=2026-01-03');
  await page.waitForLoadState('networkidle');
  const kept = await listRange(page, () => navigateInApp(page, '/ffm/orders/classic?productLine=3d'));
  expect(kept).toEqual({ from: '2026-01-01', to: '2026-01-03', line: '3d' });
  await expect(page).toHaveURL(/cfrom=2026-01-01/);
});
