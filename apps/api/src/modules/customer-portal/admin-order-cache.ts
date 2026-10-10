/**
 * Short-lived cache for the staff-side order numbers (`/counts`, `/stats` of the hub order list). Scanning the
 * whole `customer_orders` collection takes ~5 s, so these are cached 60 s, stale-while-revalidate: fresh → return
 * at once; expired but present → return the old value and recompute in the BACKGROUND; absent → wait for the one
 * in-flight computation (requests sharing a key share the promise). An admin pressing F5 never waits 5 s twice.
 *
 * It lives at FILE scope on purpose, not as a Nest provider:
 *  - One API process runs TWO Nest contexts (`Architecture/Common_Pitfalls.md` §11). A provider would be
 *    instantiated once per context, so there would be two caches and clearing one would leave the other stale.
 *  - `CustomerOrderEventService` (the single fan-out point for order-level customer events) has to clear this
 *    cache, and it deliberately imports only leaf modules to avoid a DI cycle. A plain function import keeps
 *    that property.
 *
 * KNOWN LIMIT: the cache is per PROCESS. With more than one API process (pm2 cluster), a write handled by
 * process A does not clear process B's copy, so a reader on B can still see numbers up to `ADMIN_CACHE_MS` old.
 * Making that exact needs a shared store (Redis) or a shorter TTL; it was left as is because the tab numbers are
 * a summary, not a money figure.
 */

const ADMIN_CACHE_MS = 60_000;

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export async function cachedAdminOrderNumbers<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const fresh = !!hit && Date.now() - hit.at < ADMIN_CACHE_MS;
  if (fresh) return hit.value as T;

  let pending = inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = load()
      .then((value) => {
        cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }

  // Stale copy available → hand it back now and let the recomputation finish in the background. Swallow its
  // rejection here: the caller already has an answer, and an unhandled rejection would take the process down.
  if (hit) {
    void pending.catch(() => undefined);
    return hit.value as T;
  }
  return pending;
}

/**
 * Drop every cached number. Called from any write that can move an order between tabs — push to production,
 * hold, unhold, cancel, production completed — plus the legacy sync and the trash/restore actions.
 */
export function clearAdminOrderCache(): void {
  cache.clear();
}

/** How many keys are cached. Exists so a test can prove a write cleared the cache; no application caller. */
export function adminOrderCacheSizeForTests(): number {
  return cache.size;
}
