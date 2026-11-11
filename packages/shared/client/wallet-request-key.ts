import type { WalletOperationMode } from './wallet';

/**
 * Idempotency key of the staff money dialog (`apps/web/src/pages/wallets/WalletActionDialog.tsx`), pulled out
 * as a pure function so the rule can be tested. Behaviour is exactly what the dialog did inline:
 *
 *  - the key is made when the dialog opens and re-sent on every retry;
 *  - it depends ONLY on what decides money — the mode and the amount. Note, bank reference and attachment are
 *    metadata: editing them after a failed attempt must NOT mint a new key (that used to write the money twice);
 *  - a different mode/amount than the LAST attempt mints a new key.
 *
 * Known gap (PR #77 report, bug 1, also on main): only the last attempt is remembered, so A → B → A mints a
 * new key for the second A even though the first A may already have been written.
 */
export interface WalletRequestAttempt {
  requestId: string;
  /** Fingerprint of the last attempt sent with this key; unset until the first attempt. */
  fingerprint?: string;
}

/** Only what decides money. Note / bank reference / attachment are deliberately NOT inputs (see above). */
export interface WalletRequestInput {
  mode: WalletOperationMode;
  amount: number;
}

/** What identifies one money operation for the idempotency key: mode + amount, nothing else. */
export const walletRequestFingerprint = (input: WalletRequestInput): string => `${input.mode}:${input.amount}`;

/** The attempt to send now, given the previous one. `newId` makes a fresh key (crypto.randomUUID in the browser). */
export function nextWalletRequestAttempt(
  previous: WalletRequestAttempt,
  input: WalletRequestInput,
  newId: () => string,
): WalletRequestAttempt {
  const fingerprint = walletRequestFingerprint(input);
  if (previous.fingerprint && previous.fingerprint !== fingerprint) return { requestId: newId(), fingerprint };
  return { requestId: previous.requestId, fingerprint };
}
