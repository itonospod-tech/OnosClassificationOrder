import { NotFoundException } from '@nestjs/common';

import type { CustomerWalletService } from './customer-wallet.service';
import type { WalletTestDb } from './wallet-test-db';
import { createWalletTestDb, describeDb } from './wallet-test-db';

/**
 * Raising a seller's credit limit lets them spend money they have not paid in, so every real change must
 * leave a durable trace, atomically with the change itself. Runs on a real MongoDB replica set.
 */
describeDb('credit limit audit trail (real MongoDB)', () => {
  let db: WalletTestDb;
  let service: CustomerWalletService;
  let sellerA: string;
  const staff = { userId: 'U1', userName: 'Nguyen Van A' };

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

  it('records who changed the limit, from what, to what and why', async () => {
    const res = await service.updateCreditLimit(sellerA, 500, staff, 'trusted partner, approved by CEO');

    expect(res.creditLimit).toBe(500);
    const history = await service.listCreditLimitHistory(sellerA, { page: 1, limit: 20 });
    expect(history.total).toBe(1);
    expect(history.data[0]).toMatchObject({
      customerId: sellerA,
      from: 0,
      to: 500,
      byUserId: 'U1',
      byUserName: 'Nguyen Van A',
      note: 'trusted partner, approved by CEO',
    });
    expect(history.data[0].createdAt).toBeInstanceOf(Date);
  });

  it('lists changes newest first, each starting from the previous value', async () => {
    await service.updateCreditLimit(sellerA, 500, staff);
    await service.updateCreditLimit(sellerA, 200, staff, 'reduced after overdue');

    const { data } = await service.listCreditLimitHistory(sellerA, { page: 1, limit: 20 });
    expect(data.map((c) => [c.from, c.to])).toEqual([
      [500, 200],
      [0, 500],
    ]);
  });

  it('setting the value it already has writes nothing: no change, no audit row', async () => {
    await service.updateCreditLimit(sellerA, 500, staff);
    await service.updateCreditLimit(sellerA, 500, staff, 'same again');

    expect(await db.creditLimitChangeModel.countDocuments({ customerId: sellerA })).toBe(1);
  });

  it('the limit and its audit row move together: an unknown seller changes nothing', async () => {
    await expect(service.updateCreditLimit('does-not-exist', 500, staff)).rejects.toBeInstanceOf(NotFoundException);
    expect(await db.creditLimitChangeModel.countDocuments({})).toBe(0);
  });

  it('concurrent changes each record the value they actually replaced, with no gap or duplicate', async () => {
    await Promise.all([100, 200, 300, 400].map((v) => service.updateCreditLimit(sellerA, v, staff)));

    const { data } = await service.listCreditLimitHistory(sellerA, { page: 1, limit: 20 });
    expect(data).toHaveLength(4);
    // A chain: every row's `from` is the previous row's `to`, starting at the original 0.
    const chronological = [...data].reverse();
    expect(chronological[0].from).toBe(0);
    for (let i = 1; i < chronological.length; i += 1) {
      expect(chronological[i].from).toBe(chronological[i - 1].to);
    }
    const stored = (await service.getWallet(sellerA)).creditLimit;
    expect(stored).toBe(chronological[chronological.length - 1].to);
  });

  it("does not leak into the seller's own customer document", async () => {
    await service.updateCreditLimit(sellerA, 500, staff, 'secret reason');

    const customer = (await db.customerModel.findById(sellerA).lean()) as unknown as Record<string, unknown>;
    expect(JSON.stringify(customer)).not.toContain('Nguyen Van A');
    expect(JSON.stringify(customer)).not.toContain('secret reason');
  });
});
