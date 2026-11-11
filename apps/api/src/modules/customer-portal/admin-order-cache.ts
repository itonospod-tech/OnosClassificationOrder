/**
 * Short-lived cache for the staff-side order numbers (`/counts`, `/stats` of the hub order list). Scanning the
 * whole `customer_orders` collection is slow (the code comments have long said ~5 s; not measured on production),
 * so these are cached 60 s, stale-while-revalidate: fresh → return at once; expired or invalidated but present →
 * return the old value and recompute in the BACKGROUND; absent → wait for the in-flight computation (requests
 * sharing a key share the promise). An admin pressing F5 never waits for a scan when a value is already cached.
 *
 * Two ways to make the numbers move after a write:
 *  - `invalidateAdminOrderCache()` (order events: push, hold, unhold, cancel, production completed) — SOFT: every
 *    cached value stays and is handed back at once, but no longer counts as fresh, so the next read refreshes it in
 *    the background. These events fire all day long; dropping the values on each one (as the first version of this
 *    file did, 10/10/2026) made almost every hub load wait for a full scan (PR #77 review, F9).
 *  - `clearAdminOrderCache()` (legacy sync, trash/restore — as on main) — HARD: values are dropped and the next
 *    read waits for numbers computed after the clear.
 *
 * Races (`generation` / `hardGeneration` / `seq`):
 *  - Each load remembers the generations at its START. Its result counts as fresh only if no invalidation came
 *    after that start, so an event that lands while a refresh is running is never lost: the result is stored (it
 *    is still the newest value there is) but stays stale, and the next read refreshes again.
 *  - A load started before a HARD clear never writes its result back, and no read made after the clear joins it.
 *  - Results are stored only if their load started after the stored value's load (`seq`), so a slow old load can
 *    never overwrite a newer value.
 *  - At most one background refresh per key at a time; a failed refresh keeps the old value and the next read
 *    retries.
 *
 * It lives at FILE scope on purpose, not as a Nest provider:
 *  - One API process runs TWO Nest contexts (`Architecture/Common_Pitfalls.md` §11). A provider would be
 *    instantiated once per context, so there would be two caches and clearing one would leave the other stale.
 *  - `CustomerOrderEventService` (the single fan-out point for order-level customer events) has to invalidate this
 *    cache, and it deliberately imports only leaf modules to avoid a DI cycle. A plain function import keeps
 *    that property.
 *
 * KNOWN LIMIT: the cache is per PROCESS. With more than one API process (pm2 cluster), a write handled by
 * process A does not invalidate process B's copy, so a reader on B can still see numbers up to `ADMIN_CACHE_MS`
 * old. Making that exact needs a shared store (Redis) or a shorter TTL; it was left as is because the tab numbers
 * are a summary, not a money figure.
 */

const ADMIN_CACHE_MS = 60_000;

type Entry = { at: number; value: unknown; generation: number; seq: number };
type Inflight = { promise: Promise<unknown>; hardGeneration: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Inflight>();
/** Bumped by every invalidation (soft or hard): a value loaded before the bump is no longer fresh. */
let generation = 0;
/** Bumped by a hard clear only: a load started before it must not be written back or joined. */
let hardGeneration = 0;
/** Start order of the loads, so an older load never overwrites a newer value. */
let seqCounter = 0;

function startLoad<T>(key: string, load: () => Promise<T>): Inflight {
  const startGeneration = generation;
  const startHard = hardGeneration;
  const seq = ++seqCounter;
  const own: Inflight = { hardGeneration: startHard, promise: Promise.resolve() };
  own.promise = load()
    .then((value) => {
      const current = cache.get(key);
      if (startHard === hardGeneration && (!current || seq > current.seq)) {
        cache.set(key, { at: Date.now(), value, generation: startGeneration, seq });
      }
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === own) inflight.delete(key);
    });
  inflight.set(key, own);
  return own;
}

const isFresh = (e: Entry): boolean => e.generation === generation && Date.now() - e.at < ADMIN_CACHE_MS;

export async function cachedAdminOrderNumbers<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && isFresh(hit)) return hit.value as T;

  const running = inflight.get(key);
  if (hit) {
    // Stale copy available → hand it back now. One background refresh per key: if one is already running (even
    // one started before the latest invalidation), do not start another; its result stays stale and the read
    // after it lands refreshes again. Swallow the rejection: the caller already has an answer, and an unhandled
    // rejection would take the process down. The old value stays for the retry.
    const bg = running ?? startLoad(key, load);
    void bg.promise.catch(() => undefined);
    return hit.value as T;
  }

  // Nothing to hand back → wait. Join a running load unless it started before a hard clear.
  const own = running && running.hardGeneration === hardGeneration ? running : startLoad(key, load);
  return own.promise as Promise<T>;
}

/**
 * SOFT invalidation, called by every order event (push, hold, unhold, cancel, production completed): the cached
 * numbers stay and are still served at once, but the next read refreshes them in the background.
 */
export function invalidateAdminOrderCache(): void {
  generation++;
}

/** HARD clear (legacy sync, trash/restore): drop every cached number; the next read waits for fresh numbers. */
export function clearAdminOrderCache(): void {
  generation++;
  hardGeneration++;
  cache.clear();
}

/** How many keys are cached. Exists so a test can prove a write cleared the cache; no application caller. */
export function adminOrderCacheSizeForTests(): number {
  return cache.size;
}

/** Whether `key` holds a value and whether it is fresh. Test-only, no application caller. */
export function adminOrderCacheStateForTests(key: string): { present: boolean; fresh: boolean } {
  const e = cache.get(key);
  return { present: !!e, fresh: !!e && isFresh(e) };
}
