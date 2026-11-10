/**
 * Seller wallet, staff side (/adm/wallets → ledger sheet → WalletActionDialog), as a SuperAdmin would use
 * it. Lost connections are reproduced with `page.route`: the request reaches the server (`route.fetch()`)
 * and then the browser is told the connection dropped (`route.abort()`), so the money is written but the
 * screen never sees the answer — exactly the PR #77 report's setup for bugs 1 and 2.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { call } from '../support/api';
import { customer, walletTxns } from '../support/db';
import { knownBug } from '../support/known';
import { seedSeller } from '../support/seed';
import { loginAs } from '../support/ui';

const TOPUP = '**/admin/customer-wallets/*/topup';
const ADJUST = '**/admin/customer-wallets/*/adjust';

let token = '';

test.beforeEach(async ({ page }) => {
  token = await loginAs(page, 'admin');
});

/** Opens the seller's ledger the way staff do: search the wallet list, click the row. */
async function openLedger(page: Page, seller: { name: string; userSku: string }): Promise<Locator> {
  await page.goto('/adm/wallets');
  await expect(page.getByRole('heading', { name: 'Seller wallets' })).toBeVisible();
  const search = page.getByPlaceholder('Search by account, email, name…');
  await search.fill(seller.userSku);
  await search.press('Enter');
  await page.getByText(seller.name, { exact: true }).click();
  const sheet = page.getByRole('dialog', { name: `Wallet ledger — ${seller.name}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function openAction(page: Page, sheet: Locator, action: 'Top up' | 'Adjust', sellerName: string): Promise<Locator> {
  await sheet.getByRole('button', { name: action, exact: true }).click();
  const title = action === 'Top up' ? `Top up ${sellerName}` : `Adjust wallet of ${sellerName}`;
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillForm(dialog: Locator, f: { amount: string; ref?: string; note?: string; mode?: 'topup' | 'adjust' }) {
  await dialog.getByLabel(f.mode === 'adjust' ? 'Adjustment amount (USD)' : 'Top-up amount (USD)').fill(f.amount);
  if (f.ref !== undefined) await dialog.getByLabel('Bank transaction ID').fill(f.ref);
  await dialog.getByLabel('Note (required)').fill(f.note ?? 'e2e top-up');
}

/** The footer "Close" (the corner X has the same accessible name). */
const closeDialog = (dialog: Locator) => dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
/**
 * The 409 notice. It must stay TRUE for every 409 kind — one of them (a resend whose bank reference / note
 * changed) means the money WAS recorded by the earlier attempt — so it may never say "nothing written".
 */
const CONFLICT_NOTICE = /Nothing more was written this time\. An earlier attempt may ALREADY have been recorded/;
const confirmButton = (dialog: Locator) => dialog.getByRole('button', { name: /^(Top up|Adjust) [-−]?\$/ });

/** The next request matching `pattern` reaches the server, but the browser only sees a dropped connection. */
async function loseNextResponse(page: Page, pattern: string) {
  await page.route(
    pattern,
    async (route) => {
      await route.fetch();
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
}
/** The next request matching `pattern` never leaves the browser. */
async function blockNextRequest(page: Page, pattern: string) {
  await page.route(pattern, (route) => route.abort('internetdisconnected'), { times: 1 });
}

async function balanceOf(id: string): Promise<number> {
  return (await customer(id)).walletBalance;
}

test.describe('wallet top-up / adjust', () => {
  test('normal top-up: success shown, balance and ledger update on screen', async ({ page }) => {
    const seller = await seedSeller(0);
    const sheet = await openLedger(page, seller);
    await expect(sheet.getByText('No transactions yet.')).toBeVisible();

    const dialog = await openAction(page, sheet, 'Top up', seller.name);
    await fillForm(dialog, { amount: '125.5', ref: `E2E-NORMAL-${seller.userSku}`, note: 'e2e normal top-up' });
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('Balance before → after')).toBeVisible();
    await expect(dialog.getByText('$0.00 → $125.50')).toBeVisible();
    await confirmButton(dialog).click();
    await expect(dialog.getByText('Written successfully.')).toBeVisible();
    await expect(dialog.getByText('$125.50', { exact: true })).toBeVisible();
    await closeDialog(dialog);

    await expect(sheet.getByText('$125.50').first()).toBeVisible();
    await expect(sheet.getByRole('cell', { name: 'Top-up', exact: true })).toBeVisible();
    await expect(sheet.getByText('e2e normal top-up')).toBeVisible();

    expect(await balanceOf(seller._id)).toBe(125.5);
    const txns = await walletTxns(seller._id);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ kind: 'topup', amount: 125.5, balanceBefore: 0, balanceAfter: 125.5 });
  });

  test('big amount: $1,000 needs the statement tick, $999.99 does not; 3-decimal input refused (bug 7)', async ({ page }) => {
    const seller = await seedSeller(0);
    const sheet = await openLedger(page, seller);

    // 3 decimals never leave the form.
    let dialog = await openAction(page, sheet, 'Top up', seller.name);
    await fillForm(dialog, { amount: '999.995' });
    await expect(dialog.getByText('At most 2 decimal places.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Continue' })).toBeDisabled();

    // $1,000: the confirm button stays disabled until the tick.
    await fillForm(dialog, { amount: '1000', note: 'e2e big top-up' });
    await dialog.getByRole('button', { name: 'Continue' }).click();
    const tick = dialog.getByRole('checkbox', { name: /checked this amount against the bank statement/ });
    await expect(dialog.getByText('Amounts of $1,000.00 or more must be checked before writing.')).toBeVisible();
    await expect(confirmButton(dialog)).toBeDisabled();
    await tick.check();
    await expect(confirmButton(dialog)).toBeEnabled();
    await confirmButton(dialog).click();
    await expect(dialog.getByText('Written successfully.')).toBeVisible();
    await closeDialog(dialog);
    expect(await balanceOf(seller._id)).toBe(1000);

    // $999.99: no tick asked.
    dialog = await openAction(page, sheet, 'Top up', seller.name);
    await fillForm(dialog, { amount: '999.99', note: 'e2e just under' });
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('$1,000.00 → $1,999.99')).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await confirmButton(dialog).click();
    await expect(dialog.getByText('Written successfully.')).toBeVisible();
    await closeDialog(dialog);
    expect(await balanceOf(seller._id)).toBe(1999.99);

    // Bug 7 lives behind the form (the browser cannot send 3 decimals), so check the server rule with the
    // same session: the threshold is applied to the ROUNDED amount.
    const rid = (s: string) => `e2e-b7-${s}-${Date.now()}`;
    const path = `/admin/customer-wallets/${seller._id}/topup`;
    const noAck = await call(token, 'POST', path, { requestId: rid('a'), amount: 999.995, note: 'e2e 999.995' });
    expect(noAck.status, '999.995 rounds to 1000, so it needs the tick').toBe(422);
    const withAck = await call(token, 'POST', path, { requestId: rid('b'), amount: 999.995, note: 'e2e 999.995', largeAmountAck: true });
    expect(withAck.status).toBeLessThan(300);
    const under = await call(token, 'POST', path, { requestId: rid('c'), amount: 999.994, note: 'e2e 999.994' });
    expect(under.status).toBeLessThan(300);
    const amounts = (await walletTxns(seller._id)).map((t) => t.amount);
    expect(amounts).toEqual([1000, 999.99, 1000, 999.99]);
    expect(await balanceOf(seller._id)).toBe(3999.98);
  });

  test('duplicate bank reference: 409 notice with the server message, balance unchanged', async ({ page }) => {
    const first = await seedSeller(0);
    const second = await seedSeller(0);
    const ref = `E2E-DUP-${first.userSku}`;
    // The reference was already credited (to another seller) through the API.
    const prior = await call(token, 'POST', `/admin/customer-wallets/${first._id}/topup`, {
      requestId: `e2e-dup-${Date.now()}`,
      amount: 50,
      note: 'e2e first use of the reference',
      externalTxnId: ref,
    });
    expect(prior.status).toBeLessThan(300);

    const sheet = await openLedger(page, second);
    const dialog = await openAction(page, sheet, 'Top up', second.name);
    await fillForm(dialog, { amount: '50', ref, note: 'e2e reused reference' });
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await confirmButton(dialog).click();

    await expect(dialog.getByText(CONFLICT_NOTICE)).toBeVisible();
    await expect(dialog.getByText(`Mã giao dịch "${ref}" đã được nạp cho ${first.userSku}`)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'View ledger' })).toBeVisible();
    await expect(dialog.getByText('If the connection drops, just press again')).toHaveCount(0);

    expect(await balanceOf(second._id)).toBe(0);
    expect(await walletTxns(second._id)).toHaveLength(0);
  });

  test('lost connection, press again with the same values: credited once, shown as a replay', async ({ page }) => {
    const seller = await seedSeller(0);
    const sheet = await openLedger(page, seller);
    const dialog = await openAction(page, sheet, 'Top up', seller.name);
    await fillForm(dialog, { amount: '300', ref: `E2E-LOST-${seller.userSku}`, note: 'e2e lost connection' });
    await dialog.getByRole('button', { name: 'Continue' }).click();

    await loseNextResponse(page, TOPUP);
    await confirmButton(dialog).click();
    await expect(dialog.getByText(/The connection dropped before an answer arrived/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'View ledger' })).toBeVisible();
    // The write did land on the server.
    await expect.poll(() => balanceOf(seller._id)).toBe(300);

    await confirmButton(dialog).click();
    await expect(dialog.getByText(/An earlier attempt of this request had already gone through/)).toBeVisible();
    await closeDialog(dialog);

    expect(await balanceOf(seller._id)).toBe(300);
    expect(await walletTxns(seller._id)).toHaveLength(1);
  });

  test('lost connection, then the bank reference / note is edited and resent: 409, credited exactly once (bug 2)', async ({ page }) => {
    const seller = await seedSeller(0);
    const sheet = await openLedger(page, seller);
    const dialog = await openAction(page, sheet, 'Top up', seller.name);
    const ref1 = `E2E-B2A-${seller.userSku}`;
    const ref2 = `E2E-B2B-${seller.userSku}`;
    await fillForm(dialog, { amount: '300', ref: ref1, note: 'e2e bug 2' });
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await loseNextResponse(page, TOPUP);
    await confirmButton(dialog).click();
    await expect(dialog.getByText(/The connection dropped/)).toBeVisible();
    await expect.poll(() => balanceOf(seller._id)).toBe(300);

    // The operator "fixes" the reference and the note, then resends.
    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.getByLabel('Bank transaction ID').fill(ref2);
    await dialog.getByLabel('Note (required)').fill('e2e bug 2 corrected');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await confirmButton(dialog).click();

    await expect(dialog.getByText(CONFLICT_NOTICE)).toBeVisible();
    await expect(dialog.getByText(/Thay đổi mã giao dịch ngân hàng \(đã ghi: "E2E-B2A-/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'View ledger' })).toBeVisible();
    // The money of the FIRST attempt is in the ledger: the notice must not claim otherwise.
    await expect(dialog.getByText(/wrote nothing|Not saved/)).toHaveCount(0);

    // The operator closes and reopens (a NEW request key): the dialog shows the balance credited exactly
    // once — the 409 resend wrote nothing more — so there is no reason to top up again.
    await closeDialog(dialog);
    await expect(dialog).toBeHidden();
    const reopened = await openAction(page, sheet, 'Top up', seller.name);
    await expect(reopened.getByText('$300.00').first()).toBeVisible();
    await fillForm(reopened, { amount: '1', note: 'e2e bug 2 look only' });
    await reopened.getByRole('button', { name: 'Continue' }).click();
    await expect(reopened.getByText('$300.00 → $301.00')).toBeVisible();
    await closeDialog(reopened);
    await expect(reopened).toBeHidden();

    expect(await balanceOf(seller._id)).toBe(300);
    const txns = await walletTxns(seller._id);
    expect(txns).toHaveLength(1);
    expect(txns[0].refs?.externalTxnId).toBe(ref1);
    expect(txns[0].note).toBe('e2e bug 2');

    // And the reference that was NOT saved is not "used": the real bank line ABC2 can still be credited later
    // — but only once (the ledger keeps one owner per reference).
    const later = await call(token, 'POST', `/admin/customer-wallets/${seller._id}/topup`, {
      requestId: `e2e-b2-later-${Date.now()}`,
      amount: 300,
      note: 'e2e real second bank line',
      externalTxnId: ref2,
    });
    expect(later.status).toBeLessThan(300);
    expect(await balanceOf(seller._id)).toBe(600);
  });

  test('bug 1: lost on A, B blocked, back to A — credited ONCE', async ({ page }) => {
    // known bug present on main, not fixed in release 07/11
    knownBug();
    const seller = await seedSeller(1000);
    const sheet = await openLedger(page, seller);
    const dialog = await openAction(page, sheet, 'Adjust', seller.name);

    await fillForm(dialog, { amount: '500', note: 'e2e bug 1', mode: 'adjust' });
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await loseNextResponse(page, ADJUST);
    await confirmButton(dialog).click();
    await expect(dialog.getByText(/The connection dropped/)).toBeVisible();
    await expect.poll(() => balanceOf(seller._id)).toBe(1500);

    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.getByLabel('Adjustment amount (USD)').fill('600');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await blockNextRequest(page, ADJUST);
    await confirmButton(dialog).click();
    await expect(dialog.getByText(/The connection dropped/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Back' }).click();
    await dialog.getByLabel('Adjustment amount (USD)').fill('500');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await confirmButton(dialog).click();
    await expect(dialog.getByText(/Written successfully|An earlier attempt/)).toBeVisible();

    // Expected once: 1000 + 500. The bug credits it twice (2000) under two request ids.
    expect(await balanceOf(seller._id)).toBe(1500);
  });

  test('adjust: a negative adjustment debits the wallet', async ({ page }) => {
    const seller = await seedSeller(200);
    const sheet = await openLedger(page, seller);
    await expect(sheet.getByText('$200.00').first()).toBeVisible();
    const dialog = await openAction(page, sheet, 'Adjust', seller.name);
    await fillForm(dialog, { amount: '-75.25', note: 'e2e refund correction', mode: 'adjust' });
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('$200.00 → $124.75')).toBeVisible();
    await confirmButton(dialog).click();
    await expect(dialog.getByText('Written successfully.')).toBeVisible();
    await closeDialog(dialog);
    await expect(sheet.getByRole('cell', { name: 'Adjustment', exact: true })).toBeVisible();
    await expect(sheet.getByText('$124.75').first()).toBeVisible();
    expect(await balanceOf(seller._id)).toBe(124.75);
    const [txn] = await walletTxns(seller._id);
    expect(txn).toMatchObject({ kind: 'adjust', amount: -75.25, balanceBefore: 200, balanceAfter: 124.75 });
  });
});
