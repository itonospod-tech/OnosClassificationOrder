import { AdjustWalletZod, TopupWalletZod, WALLET_BIG_AMOUNT_USD } from 'shared';

import type { CustomerWalletService } from './customer-wallet.service';
import type { WalletTestDb } from './wallet-test-db';
import { createWalletTestDb, describeDb } from './wallet-test-db';

/**
 * Regression cases from the PR #77 test report (release 07/11), bug 7: the big-amount tick was checked on
 * the RAW amount, but the ledger stores `round2(amount)`. 999.995 passed without `largeAmountAck` and was
 * written as $1,000. Contract: the threshold applies to the amount that will be written (rounded to cents).
 *
 * Boundaries: 999.99 and 999.994 (→ 999.99) need no tick; 999.995 (→ 1000) and 1000 do.
 */
const base = { requestId: 'req-round-0001', note: 'bank transfer' };
const issuePath = (r: { success: boolean; error?: { issues: Array<{ path: unknown[] }> } }) => (r.success ? null : r.error?.issues[0]?.path);

describe('bug 7 — big-amount tick is judged on the rounded amount (shared validation)', () => {
  it('sanity: the threshold is still $1,000', () => {
    expect(WALLET_BIG_AMOUNT_USD).toBe(1000);
  });

  it.each([999.995, 999.999])('topup %s without largeAmountAck is refused (it would be written as $1,000)', (amount) => {
    const res = TopupWalletZod.safeParse({ ...base, amount });
    expect(res.success).toBe(false);
    expect(issuePath(res)).toEqual(['largeAmountAck']);
  });

  // -999.996 is booked as -1000.00. (-999.995 is booked as -999.99: round2 = Math.round, which rounds .5 up.)
  it.each([-999.996, 999.995])('adjust %s without largeAmountAck is refused', (amount) => {
    const res = AdjustWalletZod.safeParse({ ...base, amount });
    expect(res.success).toBe(false);
    expect(issuePath(res)).toEqual(['largeAmountAck']);
  });

  // ---- neighbours (pass today, must keep passing) ----
  it.each([999.99, 999.994, 500])('topup %s needs no tick', (amount) => {
    expect(TopupWalletZod.safeParse({ ...base, amount }).success).toBe(true);
  });

  it.each([-999.99, -999.994, -999.995, 999.994])('adjust %s needs no tick (booked below $1,000)', (amount) => {
    expect(AdjustWalletZod.safeParse({ ...base, amount }).success).toBe(true);
  });

  it('1000 still needs the tick, and 999.995 / 1000 pass once acknowledged', () => {
    expect(TopupWalletZod.safeParse({ ...base, amount: 1000 }).success).toBe(false);
    expect(AdjustWalletZod.safeParse({ ...base, amount: -1000 }).success).toBe(false);
    for (const amount of [999.995, 1000]) {
      expect(TopupWalletZod.safeParse({ ...base, amount, largeAmountAck: true }).success).toBe(true);
      expect(AdjustWalletZod.safeParse({ ...base, amount: -amount, largeAmountAck: true }).success).toBe(true);
    }
  });
});

/**
 * End to end through the server half: what the admin controller does (validate the DTO, then
 * `applyTransaction`) must never leave a $1,000 row that nobody acknowledged.
 */
describeDb('bug 7 — no unacknowledged $1,000 reaches the ledger (real MongoDB)', () => {
  let db: WalletTestDb;
  let service: CustomerWalletService;
  let sellerA: string;

  beforeAll(async () => {
    db = await createWalletTestDb();
    service = db.service;
  });
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    ({ sellerA } = await db.reset());
  });

  /** Validation pipe + controller call, as `CustomerWalletAdminController.topup` does it. */
  const submitTopup = async (body: Record<string, unknown>): Promise<'rejected' | number> => {
    const dto = TopupWalletZod.safeParse(body);
    if (!dto.success) return 'rejected';
    const txn = await service.applyTransaction({
      customerId: sellerA,
      kind: 'topup',
      amount: dto.data.amount,
      note: dto.data.note,
      refs: { requestId: dto.data.requestId },
      strictReplay: true,
    });
    return txn.amount;
  };
  const rows = () => db.txnModel.countDocuments({ customerId: sellerA });

  it('999.995 without the tick is rejected and nothing is written', async () => {
    expect(await submitTopup({ ...base, amount: 999.995 })).toBe('rejected');
    expect(await rows()).toBe(0);
    expect((await service.getWallet(sellerA)).balance).toBe(0);
  });

  // ---- neighbours (pass today, must keep passing) ----
  it('999.994 without the tick is written as 999.99', async () => {
    expect(await submitTopup({ ...base, amount: 999.994 })).toBe(999.99);
    expect((await service.getWallet(sellerA)).balance).toBe(999.99);
  });

  it('999.995 with the tick is written as 1000', async () => {
    expect(await submitTopup({ ...base, amount: 999.995, largeAmountAck: true })).toBe(1000);
    expect(await rows()).toBe(1);
  });

  it('1000 without the tick is rejected', async () => {
    expect(await submitTopup({ ...base, amount: 1000 })).toBe('rejected');
    expect(await rows()).toBe(0);
  });
});
