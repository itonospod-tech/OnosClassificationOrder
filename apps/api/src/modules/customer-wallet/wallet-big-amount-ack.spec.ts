import { AdjustWalletZod, TopupWalletZod, UpdateCreditLimitZod, WALLET_BIG_AMOUNT_USD } from 'shared';

/**
 * The big-amount tick is a CONTROL, not a hint. Until 2026-10-10 it lived only in the staff dialog, so a direct
 * API call (or a stale bundle) could move up to a million dollars with nothing to confirm it. These tests pin the
 * server half: the flag is required exactly from `WALLET_BIG_AMOUNT_USD` up, in either direction, and smaller
 * operations keep working without it.
 *
 * The credit-limit half cannot be checked by the schema — only the service knows the current limit and therefore
 * the size of the INCREASE — so here we only pin that the field is accepted; the direction rule is in
 * `CustomerWalletService.updateCreditLimit`.
 */
const base = { requestId: 'req-abcdef12', note: 'bank transfer #1' };
const small = WALLET_BIG_AMOUNT_USD - 0.01;

describe('wallet big-amount acknowledgement (server side)', () => {
  it('topup below the threshold needs no acknowledgement', () => {
    expect(TopupWalletZod.safeParse({ ...base, amount: small }).success).toBe(true);
  });

  it('topup AT the threshold is refused without the acknowledgement', () => {
    const res = TopupWalletZod.safeParse({ ...base, amount: WALLET_BIG_AMOUNT_USD });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].path).toEqual(['largeAmountAck']);
  });

  it('topup at the threshold passes once acknowledged', () => {
    expect(TopupWalletZod.safeParse({ ...base, amount: WALLET_BIG_AMOUNT_USD, largeAmountAck: true }).success).toBe(true);
  });

  it('an acknowledgement of false is not an acknowledgement', () => {
    expect(TopupWalletZod.safeParse({ ...base, amount: WALLET_BIG_AMOUNT_USD, largeAmountAck: false }).success).toBe(false);
  });

  it('adjust is gated on the SIZE, so a large debit needs the tick too', () => {
    expect(AdjustWalletZod.safeParse({ ...base, amount: -WALLET_BIG_AMOUNT_USD }).success).toBe(false);
    expect(AdjustWalletZod.safeParse({ ...base, amount: -WALLET_BIG_AMOUNT_USD, largeAmountAck: true }).success).toBe(true);
    expect(AdjustWalletZod.safeParse({ ...base, amount: -small }).success).toBe(true);
  });

  it('credit limit carries the flag through for the service to judge', () => {
    const res = UpdateCreditLimitZod.safeParse({ creditLimit: 5000, note: 'raise', largeIncreaseAck: true });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.largeIncreaseAck).toBe(true);
  });
});
