import type { Connection, Model } from 'mongoose';
import mongoose from 'mongoose';

import { CustomerEntity, CustomerSchema } from '@/modules/customer/customer.entity';

import {
  CustomerCreditLimitChangeEntity,
  CustomerCreditLimitChangeSchema,
} from './customer-credit-limit-change.entity';
import { CustomerWalletService } from './customer-wallet.service';
import {
  CustomerWalletTransactionEntity,
  CustomerWalletTransactionSchema,
} from './customer-wallet-transaction.entity';

/**
 * Test harness for specs that need a REAL MongoDB replica set (transactions and unique indexes cannot be
 * faked). Each call creates a throwaway database, dropped by `drop()`; nothing else on the server is touched.
 *
 * `autoIndex` is OFF on purpose: the only indexes that exist are the ones `ensureIndexes()` creates, so a
 * green run proves the explicit boot-time creation works, not that Mongoose happened to build them.
 *
 * Needs the replica set the project already requires for development (`rs0`). Set WALLET_TEST_MONGO_URI to
 * point elsewhere, or SKIP_DB_TESTS=1 to skip these suites explicitly. An unreachable Mongo FAILS the run on
 * purpose — a silently skipped money test is worse than a red one.
 */
const BASE_URI = process.env.WALLET_TEST_MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';

/** `describe` for DB-backed suites: skipped only when SKIP_DB_TESTS is set. */
export const describeDb = process.env.SKIP_DB_TESTS ? describe.skip : describe;

export interface WalletTestDb {
  connection: Connection;
  txnModel: Model<CustomerWalletTransactionEntity>;
  customerModel: Model<CustomerEntity>;
  creditLimitChangeModel: Model<CustomerCreditLimitChangeEntity>;
  service: CustomerWalletService;
  /** Wipes every collection and creates two sellers; returns their ids. */
  reset(): Promise<{ sellerA: string; sellerB: string }>;
  drop(): Promise<void>;
}

export async function createWalletTestDb(): Promise<WalletTestDb> {
  const dbName = `onos-wallet-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const connection = await mongoose
    .createConnection(BASE_URI, { dbName, autoIndex: false, serverSelectionTimeoutMS: 4000 })
    .asPromise();
  const txnModel = connection.model(CustomerWalletTransactionEntity.name, CustomerWalletTransactionSchema);
  const customerModel = connection.model(CustomerEntity.name, CustomerSchema);
  const creditLimitChangeModel = connection.model(CustomerCreditLimitChangeEntity.name, CustomerCreditLimitChangeSchema);
  const service = new CustomerWalletService(
    txnModel as never,
    customerModel as never,
    creditLimitChangeModel as never,
    connection,
  );
  await service.ensureIndexes();
  // Collections must exist before a transaction can touch them.
  await customerModel.createCollection();
  await txnModel.createCollection();
  await creditLimitChangeModel.createCollection();

  return {
    connection,
    txnModel,
    customerModel,
    creditLimitChangeModel,
    service,
    async reset() {
      await Promise.all([txnModel.deleteMany({}), customerModel.deleteMany({}), creditLimitChangeModel.deleteMany({})]);
      const [a, b] = await customerModel.create([
        { userSku: 'SELLERA', userEmail: 'a@test.com', fullName: 'Seller A' },
        { userSku: 'SELLERB', userEmail: 'b@test.com', fullName: 'Seller B' },
      ]);
      return { sellerA: String(a._id), sellerB: String(b._id) };
    },
    async drop() {
      await connection.dropDatabase();
      await connection.close();
    },
  };
}
