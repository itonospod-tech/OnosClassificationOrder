import { previewWalletOperation, requiresStatementCheck, WALLET_BIG_AMOUNT_USD } from 'shared/client';

import { checkWalletGuard } from './wallet-guard';

/**
 * The staff dialog tells a person "balance before → after" and blocks debits the API would refuse. If that
 * preview ever disagreed with the real guard, the dialog would promise something the server then denies
 * (or worse, allow the click and surprise the operator), so the two are pinned together here.
 */
describe('wallet operation preview', () => {
  it('a top-up adds to the balance and never leaves the seller over limit unless they already were', () => {
    const p = previewWalletOperation({ balance: 10, creditLimit: 0 }, 'topup', 200);
    expect(p).toMatchObject({ balanceBefore: 10, balanceAfter: 210, availableAfter: 210, overLimitAfter: false, blocked: false });
  });

  it('a top-up of an indebted seller shows the debt shrinking', () => {
    const p = previewWalletOperation({ balance: -50, creditLimit: 100 }, 'topup', 20);
    expect(p).toMatchObject({ balanceAfter: -30, availableAfter: 70, overLimitAfter: false });
  });

  it('a debit that would break the limit is flagged as blocked', () => {
    const p = previewWalletOperation({ balance: 10, creditLimit: 5 }, 'adjust', -20);
    expect(p).toMatchObject({ balanceAfter: -10, blocked: true, overLimitAfter: true });
  });

  it('a debit that lands exactly on the limit is allowed', () => {
    expect(previewWalletOperation({ balance: 10, creditLimit: 5 }, 'adjust', -15).blocked).toBe(false);
  });

  it('does not leak floating point noise', () => {
    expect(previewWalletOperation({ balance: 0.1, creditLimit: 0 }, 'topup', 0.2).balanceAfter).toBe(0.3);
  });

  it('lowering a limit below an existing debt is allowed but flagged', () => {
    const p = previewWalletOperation({ balance: -80, creditLimit: 100 }, 'credit', 50);
    expect(p).toMatchObject({ creditLimitBefore: 100, creditLimitAfter: 50, availableAfter: -30, overLimitAfter: true, blocked: false });
  });

  it('agrees with the real guard on every case', () => {
    const balances = [-120, -50, -0.01, 0, 0.01, 10, 999.99];
    const limits = [0, 5, 100];
    const amounts = [-500, -20, -15, -0.01, 0.01, 15, 200];
    for (const balance of balances) {
      for (const creditLimit of limits) {
        for (const amount of amounts) {
          const preview = previewWalletOperation({ balance, creditLimit }, 'adjust', amount);
          const guard = checkWalletGuard(balance, creditLimit, amount);
          expect({ balance, creditLimit, amount, blocked: preview.blocked, after: preview.balanceAfter }).toEqual({
            balance,
            creditLimit,
            amount,
            blocked: !guard.ok,
            after: guard.balanceAfter,
          });
        }
      }
    }
  });
});

describe('big amount check', () => {
  it('triggers at the threshold, in either direction', () => {
    expect(requiresStatementCheck(WALLET_BIG_AMOUNT_USD)).toBe(true);
    expect(requiresStatementCheck(-WALLET_BIG_AMOUNT_USD)).toBe(true);
    expect(requiresStatementCheck(WALLET_BIG_AMOUNT_USD - 0.01)).toBe(false);
    expect(requiresStatementCheck(-999.99)).toBe(false);
  });
});
