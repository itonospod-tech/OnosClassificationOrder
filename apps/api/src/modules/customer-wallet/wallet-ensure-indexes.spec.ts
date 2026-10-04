import { CustomerWalletService } from './customer-wallet.service';

/** Index creation is a safety net, never a way to take the API down: failures are logged, not thrown. */
interface Surface {
  ensureIndexes(): Promise<void>;
  onModuleInit(): void;
  [k: string]: unknown;
}

const build = (createIndex: (keys: unknown, options: unknown) => Promise<unknown>) => {
  const svc = Object.create(CustomerWalletService.prototype) as Surface;
  svc.txnModel = { collection: { createIndex } };
  return svc;
};

describe('wallet boot indexes', () => {
  it('creates both unique indexes with the declared specs', async () => {
    const calls: Array<{ keys: unknown; options: Record<string, unknown> }> = [];
    const svc = build((keys, options) => {
      calls.push({ keys, options: options as Record<string, unknown> });
      return Promise.resolve('ok');
    });
    await svc.ensureIndexes();

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.options.unique === true)).toBe(true);
    expect(calls.map((c) => c.keys)).toEqual([
      { customerId: 1, kind: 1, 'refs.requestId': 1 },
      { 'refs.externalTxnId': 1 },
    ]);
  });

  it('a failing build is logged and does not stop the other index or reject', async () => {
    let attempts = 0;
    const svc = build(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('E11000 duplicate key')) : Promise.resolve('ok');
    });

    await expect(svc.ensureIndexes()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('onModuleInit does not throw even when every build fails', () => {
    const svc = build(() => Promise.reject(new Error('nope')));
    expect(() => svc.onModuleInit()).not.toThrow();
  });
});
