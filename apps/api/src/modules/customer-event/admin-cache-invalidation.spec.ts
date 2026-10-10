import {
  adminOrderCacheSizeForTests,
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
  svc.notify = async () => undefined;
  return { svc, emitted };
};

const primeCache = async () => {
  clearAdminOrderCache();
  await cachedAdminOrderNumbers('counts:{}', async () => ({ all: 1 }));
  expect(adminOrderCacheSizeForTests()).toBe(1);
};

describe('admin order cache invalidation on customer order events', () => {
  it.each(['order.pushed', 'order.production_completed', 'order.held', 'order.unheld', 'order.cancelled'] as const)(
    'clears the cached staff counts on %s',
    async (event) => {
      await primeCache();
      const { svc, emitted } = makeService();

      svc.emit(event as Parameters<CustomerOrderEventService['emit']>[0], [{ productionId: 'AB-10000-20000' }]);

      expect(adminOrderCacheSizeForTests()).toBe(0);
      expect(emitted).toHaveLength(1); // the event still fans out; invalidation is additive
    },
  );

  it('does not clear the cache when there is nothing to report', async () => {
    await primeCache();
    const { svc, emitted } = makeService();

    // No productionId → `emit` returns early, nothing happened, so the cached numbers are still correct.
    svc.emit('order.pushed' as Parameters<CustomerOrderEventService['emit']>[0], [{} as { productionId: string }]);

    expect(adminOrderCacheSizeForTests()).toBe(1);
    expect(emitted).toHaveLength(0);
  });
});
