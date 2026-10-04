import { CustomerWalletService } from './customer-wallet.service';

/**
 * Staff all-sellers ledger: rows must carry who the seller is and the productionIds
 * behind `refs.orderIds` (those hold order _ids, which mean nothing to staff).
 */
interface ServiceSurface {
  listAllTransactions(dto: Record<string, unknown>): Promise<{
    data: Array<Record<string, unknown>>;
    total: number;
  }>;
  [k: string]: unknown;
}

const txn = (over: Record<string, unknown>) => ({
  _id: 'T1',
  customerId: 'C1',
  kind: 'label',
  amount: -5,
  balanceBefore: 10,
  balanceAfter: 5,
  createdAt: new Date('2026-10-04T03:00:00.000Z'),
  ...over,
});

const build = (docs: unknown[], opts: { found?: Array<{ _id: string }> } = {}) => {
  const queries: Array<Record<string, unknown>> = [];
  const svc = Object.create(CustomerWalletService.prototype) as ServiceSurface;
  svc.txnModel = {
    find: (filter: Record<string, unknown>) => {
      queries.push(filter);
      const chain = { sort: () => chain, skip: () => chain, limit: () => Promise.resolve(docs) };
      return chain;
    },
    countDocuments: () => Promise.resolve(docs.length),
    db: {
      collection: () => ({
        find: () => ({ toArray: () => Promise.resolve([{ _id: 'O1', productionId: 'AA-00001-00001' }]) }),
      }),
    },
  };
  svc.customerModel = {
    find: () => ({
      select: () => {
        const result = opts.found ?? [{ _id: 'C1', userSku: 'DESI', userEmail: 'd@x.com', fullName: 'Desi' }];
        const promise = Promise.resolve(result) as Promise<unknown> & { limit: () => Promise<unknown> };
        promise.limit = () => Promise.resolve(result);
        return promise;
      },
    }),
  };
  return { svc, queries };
};

describe('list ledger transactions across sellers', () => {
  it('attaches seller identity and translates order _ids to productionIds', async () => {
    const { svc } = build([txn({ refs: { orderIds: ['O1', 'O-unknown'] } })]);
    const { data, total } = await svc.listAllTransactions({ page: 1, limit: 20 });

    expect(total).toBe(1);
    expect(data[0]).toMatchObject({ userSku: 'DESI', userEmail: 'd@x.com', fullName: 'Desi' });
    // The unknown order id is dropped rather than shown as a raw _id.
    expect(data[0].productionIds).toEqual(['AA-00001-00001']);
  });

  it('a transaction without orders gets an empty productionIds list', async () => {
    const { svc } = build([txn({ kind: 'topup', amount: 100 })]);
    const { data } = await svc.listAllTransactions({ page: 1, limit: 20 });
    expect(data[0].productionIds).toEqual([]);
  });

  it('a search that matches no seller returns nothing without querying the ledger', async () => {
    const { svc, queries } = build([txn({})], { found: [] });
    const res = await svc.listAllTransactions({ page: 1, limit: 20, search: 'nobody' });

    expect(res).toEqual({ data: [], total: 0 });
    expect(queries).toEqual([]);
  });
});
