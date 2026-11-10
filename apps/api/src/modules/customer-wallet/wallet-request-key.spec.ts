import { nextWalletRequestAttempt, type WalletRequestAttempt, type WalletRequestInput } from 'shared';

/**
 * Known bug (expected to fail). `STRICT_KNOWN=1` runs it as a normal test, to read the exact failure it hits
 * and check it fails for the right reason. Flip to `it` once the bug is fixed.
 */
const itKnown = process.env.STRICT_KNOWN ? it : it.failing;

/**
 * Idempotency key of the staff money dialog (`apps/web/.../WalletActionDialog.tsx`, rule extracted to
 * `packages/shared/client/wallet-request-key.ts`). apps/web has no test runner, so it is pinned here.
 *
 * PR #77 report, bug 1: +$500 written but the response was lost → Back → try $600 (never reached the server) →
 * Back → $500 again minted a NEW key and the server wrote $500 a second time ($1,000 → $2,000).
 */
/** Simulates the dialog: one starting key, then one call per press of the confirm button. */
function dialog() {
  let n = 0;
  const newId = () => `key-${++n}`;
  let attempt: WalletRequestAttempt = { requestId: newId() };
  return (input: WalletRequestInput): string => {
    attempt = nextWalletRequestAttempt(attempt, input, newId);
    return attempt.requestId;
  };
}
const adjust = (amount: number): WalletRequestInput => ({ mode: 'adjust', amount });
const topup = (amount: number): WalletRequestInput => ({ mode: 'topup', amount });

describe('wallet dialog idempotency key', () => {
  it('a retry with the same amount reuses the key (double click / retry after timeout)', () => {
    const press = dialog();
    const k = press(adjust(500));
    expect(press(adjust(500))).toBe(k);
    expect(press(adjust(500))).toBe(k);
  });

  it('the key is made from mode + amount only: note / bank reference / attachment are not inputs at all', () => {
    // A caller that still passes the form (structural typing allows the wider object) gets the same key:
    // editing metadata after a failed attempt never mints a new one (the server answers 409 if it changed).
    const press = dialog();
    const k = press(topup(300));
    const form1 = { mode: 'topup' as const, amount: 300, note: 'bank (fixed typo)', externalTxnId: 'ABC1' };
    const form2 = { mode: 'topup' as const, amount: 300, note: 'bank', externalTxnId: 'ABC2', attachmentUrl: 'https://x/2.png' };
    expect(press(form1)).toBe(k);
    expect(press(form2)).toBe(k);
  });

  it('a different mode with the same amount is a different operation: new key', () => {
    const press = dialog();
    expect(press(adjust(300))).not.toBe(press(topup(300)));
  });

  it('the first press uses the key made when the dialog opened', () => {
    expect(dialog()(adjust(500))).toBe('key-1');
  });

  it('a different amount is a different operation: new key (the server would rightly refuse it under the old one)', () => {
    const press = dialog();
    const a = press(adjust(500));
    const b = press(adjust(600));
    expect(b).not.toBe(a);
  });

  // known bug present on main, not fixed in release 07/11 — flip to it() when fixed
  itKnown('A → B → A: going back to the first amount reuses the FIRST key (bug 1: it minted a third key)', () => {
    const press = dialog();
    const a = press(adjust(500)); // written, response lost
    press(adjust(600)); // never reached the server
    expect(press(adjust(500))).toBe(a);
  });
});
