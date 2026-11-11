import {
  adminOrderCacheStateForTests,
  cachedAdminOrderNumbers,
  clearAdminOrderCache,
  invalidateAdminOrderCache,
} from './admin-order-cache';

/**
 * Stale-while-revalidate of the hub tab numbers (PR #77 review, F9). Order events invalidate SOFTLY: the cached
 * value stays and is served at once while a single background refresh runs. Loads are driven by hand
 * (`deferred`) so every race is reproduced in an exact order, not by timing.
 */
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
/** Let pending `.then` / `.finally` callbacks run. */
const flush = () => new Promise((r) => setImmediate(r));

/** A load function whose every call is recorded and resolved by the test. */
const controlledLoad = () => {
  const calls: Array<Deferred<number>> = [];
  const load = () => {
    const d = deferred<number>();
    calls.push(d);
    return d.promise;
  };
  return { calls, load };
};

const KEY = 'counts:test';
const prime = async (value: number) => {
  await cachedAdminOrderNumbers(KEY, () => Promise.resolve(value));
  expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: true, fresh: true });
};

beforeEach(() => clearAdminOrderCache());

describe('admin order cache — stale-while-revalidate (F9)', () => {
  it('a fresh hit is returned at once, without calling the loader', async () => {
    await prime(1);
    const { calls, load } = controlledLoad();
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(1);
    expect(calls).toHaveLength(0);
  });

  it('an invalidation keeps the old value (only marks it stale)', async () => {
    await prime(1);
    invalidateAdminOrderCache();
    expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: true, fresh: false });
  });

  it('after an invalidation a read returns the old value at once and refreshes in the background', async () => {
    await prime(1);
    invalidateAdminOrderCache();
    const { calls, load } = controlledLoad();

    // Resolves although the refresh has not finished: the caller never waits for the scan.
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(1);
    expect(calls).toHaveLength(1);

    calls[0].resolve(2);
    await flush();
    expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: true, fresh: true });
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(2);
    expect(calls).toHaveLength(1);
  });

  it('many reads and many events at once start ONE refresh per key', async () => {
    await prime(1);
    const { calls, load } = controlledLoad();
    for (let i = 0; i < 5; i++) invalidateAdminOrderCache();

    const reads = await Promise.all(Array.from({ length: 20 }, () => cachedAdminOrderNumbers(KEY, load)));
    expect(reads.every((v) => v === 1)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('cold cache: concurrent readers wait for and share one load', async () => {
    const { calls, load } = controlledLoad();
    const reads = Array.from({ length: 10 }, () => cachedAdminOrderNumbers(KEY, load));
    expect(calls).toHaveLength(1);
    calls[0].resolve(7);
    await expect(Promise.all(reads)).resolves.toEqual(Array(10).fill(7));
  });

  it('an event during a refresh is not lost: the result is kept but stays stale, the next read refreshes again', async () => {
    await prime(1);
    invalidateAdminOrderCache();
    const { calls, load } = controlledLoad();
    await cachedAdminOrderNumbers(KEY, load); // refresh #1 starts
    invalidateAdminOrderCache(); // an order moves while #1 is scanning

    // While #1 runs, reads still get the old value and no second scan starts.
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(1);
    expect(calls).toHaveLength(1);

    calls[0].resolve(2);
    await flush();
    // Newest value there is, but computed before the event: served, never treated as fresh.
    expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: true, fresh: false });
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(2);
    expect(calls).toHaveLength(2); // refresh #2

    calls[1].resolve(3);
    await flush();
    expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: true, fresh: true });
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(3);
  });

  it('a failed refresh keeps the old value, does not crash the process, and the next read retries', async () => {
    await prime(1);
    invalidateAdminOrderCache();
    const { calls, load } = controlledLoad();
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(1);
    calls[0].reject(new Error('mongo down'));
    await flush();

    expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: true, fresh: false });
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(1);
    expect(calls).toHaveLength(2); // retried
    calls[1].resolve(5);
    await flush();
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(5);
  });

  it('a cold load that fails rejects its waiters and the next read tries again', async () => {
    const { calls, load } = controlledLoad();
    const first = cachedAdminOrderNumbers(KEY, load);
    calls[0].reject(new Error('mongo down'));
    await expect(first).rejects.toThrow('mongo down');
    const second = cachedAdminOrderNumbers(KEY, load);
    expect(calls).toHaveLength(2);
    calls[1].resolve(4);
    await expect(second).resolves.toBe(4);
  });

  it('a hard clear drops values; a load started before it never writes back and is not joined', async () => {
    await prime(1);
    invalidateAdminOrderCache();
    const { calls, load } = controlledLoad();
    await cachedAdminOrderNumbers(KEY, load); // background refresh #1 (pre-clear)
    clearAdminOrderCache(); // trash/restore or legacy sync
    expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: false, fresh: false });

    const after = cachedAdminOrderNumbers(KEY, load); // must wait for numbers computed AFTER the clear
    expect(calls).toHaveLength(2);
    calls[0].resolve(100); // pre-clear result lands late
    await flush();
    expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: false, fresh: false });

    calls[1].resolve(2);
    await expect(after).resolves.toBe(2);
    expect(adminOrderCacheStateForTests(KEY)).toEqual({ present: true, fresh: true });
  });

  it('an older load never overwrites a newer value', async () => {
    const { calls, load } = controlledLoad();
    const cold = cachedAdminOrderNumbers(KEY, load); // load A (cold)
    clearAdminOrderCache();
    const fresh = cachedAdminOrderNumbers(KEY, load); // load B, started after the clear
    calls[1].resolve(2);
    await expect(fresh).resolves.toBe(2);
    calls[0].resolve(1); // A finishes last
    await expect(cold).resolves.toBe(1); // its own waiter still gets an answer
    await flush();
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('keys are independent', async () => {
    await prime(1);
    await cachedAdminOrderNumbers('stats:test', () => Promise.resolve(9));
    invalidateAdminOrderCache();
    const { calls, load } = controlledLoad();
    await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(1);
    await expect(cachedAdminOrderNumbers('stats:test', load)).resolves.toBe(9);
    expect(calls).toHaveLength(2); // one refresh per key
  });

  it('the 60 s expiry still triggers a background refresh (unchanged from main)', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-11T08:00:00Z'), doNotFake: ['setImmediate', 'nextTick'] });
    try {
      await prime(1);
      jest.setSystemTime(new Date('2026-11-11T08:01:01Z'));
      expect(adminOrderCacheStateForTests(KEY).fresh).toBe(false);
      const { calls, load } = controlledLoad();
      await expect(cachedAdminOrderNumbers(KEY, load)).resolves.toBe(1);
      expect(calls).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
