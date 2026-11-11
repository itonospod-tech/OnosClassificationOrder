import {
  adminOrderCacheStateForTests,
  cachedAdminOrderNumbers,
  clearAdminOrderCache,
} from '@/modules/customer-portal/admin-order-cache';

import { CustomerOrderEventService } from './customer-order-event.service';

/**
 * The staff tab numbers (`/counts`, `/stats`) are cached 60 s. Before 2026-10-10 only the legacy sync and the
 * trash/restore actions cleared that cache, so pushing, holding, unholding, cancelling or completing an order
 * left the tab counts disagreeing with the list in front of the operator for up to a minute.
 *
 * `CustomerOrderEventService.emit` is the single point every order-level customer event passes through, which is
 * why the invalidation hangs there. This suite pins that, and pins that it happens for EVERY event — a new event
 * added later inherits the behaviour instead of quietly reintroducing the staleness.
 *
 * The invalidation is SOFT (PR #77 review, F9): the cached value is kept and still served at once, only marked
 * stale so the next read refreshes it in the background. Dropping it made nearly every hub load wait for a scan.
 */
type Surface = {
  customerWebhookService: { emitForOrders: (...a: unknown[]) => void };
  notify: (...a: unknown[]) => Promise<void>;
  emit: CustomerOrderEventService['emit'];
};

const makeService = () => {
  const emitted: unknown[][] = [];
  const svc = Object.create(CustomerOrderEventService.prototype) as Surface;
  svc.customerWebhookService = { emitForOrders: (...a: unknown[]) => void emitted.push(a) };
  // The portal-notification half talks to Mongo; it is covered elsewhere and is irrelevant here.
  svc.notify = () => Promise.resolve();
  return { svc, emitted };
};

const primeCache = async () => {
  clearAdminOrderCache();
  await cachedAdminOrderNumbers('counts:{}', () => Promise.resolve({ all: 1 }));
  expect(adminOrderCacheStateForTests('counts:{}')).toEqual({ present: true, fresh: true });
};

describe('admin order cache invalidation on customer order events', () => {
  it.each(['order.pushed', 'order.production_completed', 'order.held', 'order.unheld', 'order.cancelled'] as const)(
    'marks the cached staff counts stale on %s, keeping the value',
    async (event) => {
      await primeCache();
      const { svc, emitted } = makeService();

      svc.emit(event, [{ productionId: 'AB-10000-20000' }]);

      expect(adminOrderCacheStateForTests('counts:{}')).toEqual({ present: true, fresh: false });
      expect(emitted).toHaveLength(1); // the event still fans out; invalidation is additive
    },
  );

  it('does not invalidate the cache when there is nothing to report', async () => {
    await primeCache();
    const { svc, emitted } = makeService();

    // No productionId → `emit` returns early, nothing happened, so the cached numbers are still correct.
    svc.emit('order.pushed' as Parameters<CustomerOrderEventService['emit']>[0], [{} as { productionId: string }]);

    expect(adminOrderCacheStateForTests('counts:{}')).toEqual({ present: true, fresh: true });
    expect(emitted).toHaveLength(0);
  });
});
