import { ConflictException } from '@nestjs/common';

import type { CustomerWalletService } from './customer-wallet.service';
import type { WalletTestDb } from './wallet-test-db';
import { createWalletTestDb, describeDb } from './wallet-test-db';

/**
 * Regression cases from the PR #77 test report (release 07/11), bug 2: a retry with the same `requestId`
 * but a corrected bank reference (or note, or attachment) answered 200 "replayed" and silently kept the
 * OLD values. The corrected reference was then never recorded, so crediting that bank line later with a
 * new key was not caught as a duplicate and the seller was paid twice ($300 → $600).
 *
 * Contract: the same `requestId` with a different externalTxnId / note / attachmentUrl is a 409, nothing is
 * written; an identical replay is still a harmless replay. Real MongoDB replica set — see wallet-test-db.ts
 * (each run gets its own throwaway database).
 */
type Input = Parameters<CustomerWalletService['applyTransaction']>[0];
type TopupOver = Partial<Omit<Input, 'refs'>> & { requestId: string; externalTxnId?: string; attachmentUrl?: string };

describeDb('bug 2 — wallet replay must match the whole operation, not only the amount (real MongoDB)', () => {
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

  /** Same shape the admin controller sends for a top-up (strict replay, refs from the DTO). */
  const topup = ({ requestId, externalTxnId, attachmentUrl, ...over }: TopupOver) =>
    service.applyTransaction({
      customerId: sellerA,
      kind: 'topup',
      amount: 300,
      note: 'bank transfer',
      strictReplay: true,
      ...over,
      refs: { requestId, externalTxnId, attachmentUrl },
    });
  const balance = async () => (await service.getWallet(sellerA)).balance;
  const ledger = () => db.txnModel.find({ customerId: sellerA }).lean();
  const withRef = (ref: string) => db.txnModel.countDocuments({ kind: 'topup', 'refs.externalTxnId': ref });

  it.each<[string, TopupOver]>([
    ['bank reference', { requestId: 'req-ref-0001', externalTxnId: 'ABC2' }],
    ['note', { requestId: 'req-ref-0001', externalTxnId: 'ABC1', note: 'bank transfer (corrected)' }],
    ['attachment', { requestId: 'req-ref-0001', externalTxnId: 'ABC1', attachmentUrl: 'https://example.com/proof-2.png' }],
  ])('same requestId with a different %s → 409, nothing written, ledger unchanged', async (_what, retry) => {
    await topup({ requestId: 'req-ref-0001', externalTxnId: 'ABC1', attachmentUrl: 'https://example.com/proof-1.png' });
    const before = await ledger();

    await expect(
      topup({ attachmentUrl: 'https://example.com/proof-1.png', ...retry }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await ledger()).toEqual(before);
    expect(await balance()).toBe(300);
  });

  it("the report's scenario: after the conflict, ABC2 with a new key is ONE real credit and ABC1 stays recorded once", async () => {
    await topup({ requestId: 'req-scen-0001', externalTxnId: 'ABC1' });
    await expect(topup({ requestId: 'req-scen-0001', externalTxnId: 'ABC2' })).rejects.toBeInstanceOf(ConflictException);
    expect(await balance()).toBe(300);
    expect(await withRef('ABC2')).toBe(0);

    const second = await topup({ requestId: 'req-scen-0002', externalTxnId: 'ABC2' });
    expect(second.replayed).toBeUndefined();
    expect(await balance()).toBe(600); // a genuine second bank line

    // Retrying that new operation is a replay; crediting either reference again under any key is blocked.
    expect((await topup({ requestId: 'req-scen-0002', externalTxnId: 'ABC2' })).replayed).toBe(true);
    await expect(topup({ requestId: 'req-scen-0003', externalTxnId: 'ABC2' })).rejects.toBeInstanceOf(ConflictException);
    await expect(topup({ requestId: 'req-scen-0004', externalTxnId: 'ABC1' })).rejects.toBeInstanceOf(ConflictException);

    expect(await balance()).toBe(600);
    expect(await withRef('ABC1')).toBe(1);
    expect(await withRef('ABC2')).toBe(1);
    expect(await db.txnModel.countDocuments({ customerId: sellerA })).toBe(2);
  });

  // ---- neighbours (pass today, must keep passing) ----
  it('an identical replay (same amount, reference, note, attachment) is still a replay: one credit', async () => {
    const op: TopupOver = { requestId: 'req-same-0001', externalTxnId: 'ABC1', attachmentUrl: 'https://example.com/p.png', note: 'n1' };
    const first = await topup(op);
    const again = await topup(op);
    expect(again.replayed).toBe(true);
    expect(again._id).toBe(first._id);
    expect(await balance()).toBe(300);
    expect(await db.txnModel.countDocuments({ customerId: sellerA })).toBe(1);
  });

  it('identical replay without any reference or attachment is still a replay', async () => {
    await topup({ requestId: 'req-bare-0001' });
    expect((await topup({ requestId: 'req-bare-0001' })).replayed).toBe(true);
    expect(await balance()).toBe(300);
  });

  it('ten concurrent identical submits of one requestId credit exactly once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => topup({ requestId: 'req-conc-0001', externalTxnId: 'ABC9', note: 'same' })));
    expect(new Set(results.map((r) => r._id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balance()).toBe(300);
    expect(await withRef('ABC9')).toBe(1);
  });

  it('same requestId with a different amount is still a 409 (existing rule)', async () => {
    await topup({ requestId: 'req-amt-0001', externalTxnId: 'ABC1' });
    await expect(topup({ requestId: 'req-amt-0001', externalTxnId: 'ABC1', amount: 301 })).rejects.toBeInstanceOf(ConflictException);
    expect(await balance()).toBe(300);
  });
});
