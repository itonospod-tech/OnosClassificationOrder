import { ConflictException } from '@nestjs/common';
import type { Connection, Model } from 'mongoose';
import mongoose from 'mongoose';

import { CustomerEntity, CustomerSchema } from '@/modules/customer/customer.entity';

import { CustomerWalletService } from './customer-wallet.service';
import {
  CustomerWalletTransactionEntity,
  CustomerWalletTransactionSchema,
} from './customer-wallet-transaction.entity';

/**
 * Double-credit protection, proven against a REAL MongoDB replica set (transactions + unique indexes
 * cannot be faked). It uses a throwaway database that is dropped afterwards; nothing else is touched.
 *
 * `autoIndex` is OFF on purpose: the only indexes that exist are the ones `ensureIndexes()` creates,
 * so a green run proves the explicit boot-time creation works, not that Mongoose happened to build them.
 *
 * Needs the replica set the project already requires for development (`rs0`). Set WALLET_TEST_MONGO_URI
 * to point elsewhere, or SKIP_DB_TESTS=1 to skip these tests explicitly. Unreachable Mongo FAILS the
 * run on purpose — a silently skipped money test is worse than a red one.
 */
const BASE_URI = process.env.WALLET_TEST_MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';
const describeDb = process.env.SKIP_DB_TESTS ? describe.skip : describe;

type TopupInput = Parameters<CustomerWalletService['applyTransaction']>[0];

describeDb('wallet money safety (real MongoDB)', () => {
  let connection: Connection;
  let txnModel: Model<CustomerWalletTransactionEntity>;
  let customerModel: Model<CustomerEntity>;
  let service: CustomerWalletService;
  let sellerA: string;
  let sellerB: string;

  beforeAll(async () => {
    const dbName = `onos-wallet-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    connection = await mongoose
      .createConnection(BASE_URI, { dbName, autoIndex: false, serverSelectionTimeoutMS: 4000 })
      .asPromise();
    txnModel = connection.model(CustomerWalletTransactionEntity.name, CustomerWalletTransactionSchema);
    customerModel = connection.model(CustomerEntity.name, CustomerSchema);
    service = new CustomerWalletService(txnModel as never, customerModel as never, connection);
    await service.ensureIndexes();
    await customerModel.init(); // collection must exist before transactions can touch it
    await txnModel.createCollection();
  });

  afterAll(async () => {
    await connection?.dropDatabase();
    await connection?.close();
  });

  beforeEach(async () => {
    await txnModel.deleteMany({});
    await customerModel.deleteMany({});
    const [a, b] = await customerModel.create([
      { userSku: 'SELLERA', userEmail: 'a@test.com', fullName: 'Seller A' },
      { userSku: 'SELLERB', userEmail: 'b@test.com', fullName: 'Seller B' },
    ]);
    sellerA = String(a._id);
    sellerB = String(b._id);
  });

  const topup = (over: Partial<TopupInput> & { requestId: string; externalTxnId?: string }): Promise<
    Awaited<ReturnType<CustomerWalletService['applyTransaction']>>
  > =>
    service.applyTransaction({
      customerId: sellerA,
      kind: 'topup',
      amount: 100,
      note: 'bank transfer',
      strictReplay: true,
      ...over,
      refs: { requestId: over.requestId, externalTxnId: over.externalTxnId },
    });

  const balanceOf = async (id: string) => (await service.getWallet(id)).balance;
  const rows = (id: string) => txnModel.countDocuments({ customerId: id });

  it('the explicit boot step creates both unique indexes', async () => {
    const names = (await txnModel.collection.indexes()).map((i) => i.name);
    expect(names).toContain('topup_externalTxnId_unique');
    expect(names.some((n) => n?.includes('refs.requestId'))).toBe(true);
  });

  it('the same requestId sent twice credits once and reports the second as a replay', async () => {
    const first = await topup({ requestId: 'req-aaaaaaaa' });
    const second = await topup({ requestId: 'req-aaaaaaaa' });

    expect(first.replayed).toBeUndefined();
    expect(second.replayed).toBe(true);
    expect(second._id).toBe(first._id);
    expect(await rows(sellerA)).toBe(1);
    expect(await balanceOf(sellerA)).toBe(100);
  });

  it('ten concurrent submits of the same requestId still credit exactly once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => topup({ requestId: 'req-concurr1' })));

    expect(new Set(results.map((r) => r._id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await rows(sellerA)).toBe(1);
    expect(await balanceOf(sellerA)).toBe(100);
  });

  it('the same requestId with a different amount is rejected, not silently replayed', async () => {
    await topup({ requestId: 'req-mismatch', amount: 100 });

    await expect(topup({ requestId: 'req-mismatch', amount: 999 })).rejects.toBeInstanceOf(ConflictException);
    expect(await rows(sellerA)).toBe(1);
    expect(await balanceOf(sellerA)).toBe(100);
  });

  it('a bank reference cannot be credited twice by a different requestId (second tab, second person)', async () => {
    await topup({ requestId: 'req-tab-one1', externalTxnId: 'VCB123456' });

    const err = await topup({ requestId: 'req-tab-two2', externalTxnId: 'VCB123456' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    // The message names the seller and tells the operator what to do next.
    expect((err as ConflictException).message).toContain('SELLERA');
    expect((err as ConflictException).message).toContain('Điều chỉnh');
    expect(await balanceOf(sellerA)).toBe(100);
  });

  it('a bank reference is unique across sellers too', async () => {
    await topup({ requestId: 'req-seller-a1', externalTxnId: 'VCB777' });

    await expect(
      topup({ requestId: 'req-seller-b1', externalTxnId: 'VCB777', customerId: sellerB }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await balanceOf(sellerB)).toBe(0);
  });

  it('two different requestIds racing on the same bank reference: exactly one wins', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => topup({ requestId: `req-race-${i}-xxxx`, externalTxnId: 'VCB-RACE' })),
    );

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    for (const o of outcomes.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(o.reason).toBeInstanceOf(ConflictException);
    }
    expect(await rows(sellerA)).toBe(1);
    expect(await balanceOf(sellerA)).toBe(100);
  });

  it('retrying the winning operation after the bank reference is taken is still a replay, not a conflict', async () => {
    const first = await topup({ requestId: 'req-retry-win', externalTxnId: 'VCB-RETRY' });
    const again = await topup({ requestId: 'req-retry-win', externalTxnId: 'VCB-RETRY' });

    expect(again.replayed).toBe(true);
    expect(again._id).toBe(first._id);
    expect(await balanceOf(sellerA)).toBe(100);
  });

  it('a top-up without a bank reference is not blocked by another one without it', async () => {
    await topup({ requestId: 'req-noref-aaaa' });
    await topup({ requestId: 'req-noref-bbbb' });

    expect(await balanceOf(sellerA)).toBe(200);
  });

  it('only top-ups are subject to the bank-reference rule', async () => {
    await topup({ requestId: 'req-kind-topup', externalTxnId: 'VCB-KIND' });
    // An adjustment may legitimately carry the same text (it is the documented way to fix a top-up).
    const adj = await service.applyTransaction({
      customerId: sellerA,
      kind: 'adjust',
      amount: -100,
      note: 'wrong seller',
      strictReplay: true,
      refs: { requestId: 'req-kind-adjust', externalTxnId: 'VCB-KIND' },
    });

    expect(adj.replayed).toBeUndefined();
    expect(await balanceOf(sellerA)).toBe(0);
  });
});
