/** Browser helpers: everything goes through the screen the way a person would use it. */
import { expect, type Page } from '@playwright/test';

import { rememberToken } from './api';
import { PASSWORD, USERS, type UserKey } from './env';

/** Logs in on /adm/login by typing into the form; returns the access token the browser received. */
export async function loginAs(page: Page, key: UserKey, lang: 'en' | 'vi' = 'en'): Promise<string> {
  await page.addInitScript((l) => {
    try {
      if (!window.localStorage.getItem('onosfactory-language')) window.localStorage.setItem('onosfactory-language', l);
    } catch {
      /* ignore */
    }
  }, lang);
  await page.goto('/adm/login');
  // The shadcn FormControl wraps a div, so the visible labels are not tied to the inputs: use the field names.
  await page.locator('input[name="email"]').fill(USERS[key].email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const loginRes = page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /^(Continue|Tiếp tục)/i }).click();
  const res = await loginRes;
  expect(res.status(), 'login answered').toBeLessThan(300);
  const json = await res.json();
  const token = (json?.data?.accessToken ?? json?.accessToken) as string;
  rememberToken(key, token);
  await expect(page).not.toHaveURL(/\/adm\/login/);
  return token;
}

/** A sonner toast with this text. */
export const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text });
