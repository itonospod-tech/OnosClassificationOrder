import { BadRequestException } from '@nestjs/common';

import { OnospodImportService } from './onospod-import.service';
import { buildShippingWrites, orderIdsToLookUp } from './onospod-shipping-backfill.plan';

/**
 * One-off shipping-address backfill (Orders.md §3.6). The two things that must hold:
 *  - it only looks up / writes orders that still MISS an address;
 *  - it is a dry run unless told otherwise, and stays bounded (7-day window, paced calls).
 * The write itself (only the missing field, held-for-address excluded) is checked on a real
 * Mongo separately — filter semantics are not something a mock can prove.
 */
const A = { city: 'Austin', country: 'US' };
const items = [
  { increment_id: 'P1', order_id: 'O1' },
  { increment_id: 'P2', order_id: 'O1' }, // same parent order
  { increment_id: 'P3', order_id: 'O2' }, // already has an address
  { increment_id: 'P4', order_id: 'O3' }, // missing, but OnosPod returns no address
  { increment_id: 'P5' }, // no order_id: cannot be looked up
];
const missing = new Set(['P1', 'P2', 'P4', 'P5']);

describe('backfill plan', () => {
  it('looks up only parent orders that have an order still missing an address', () => {
    expect(orderIdsToLookUp(items, missing).sort()).toEqual(['O1', 'O3']);
  });

  it('one write per parent order with an address; items of the same order grouped', () => {
    const writes = buildShippingWrites(items, missing, new Map([['O1', A], ['O2', A]]));
    expect(writes).toEqual([{ onospodOrderId: 'O1', productionIds: ['P1', 'P2'], address: A }]);
  });
});

describe('backfillShippingAddresses', () => {
  const make = () => {
    const svc = Object.create(OnospodImportService.prototype) as Record<string, unknown> & {
      backfillShippingAddresses: OnospodImportService['backfillShippingAddresses'];
    };
    const fetched: string[] = [];
    svc.apiConfigService = { onospodQcConfig: { apiUrl: 'x', bearerToken: 't' } };
    svc.fetchAllPages = jest.fn((_c: unknown, status: string) => {
      fetched.push(status);
      return Promise.resolve(status === 'In Print' ? items : []);
    });
    const orderService = {
      findProductionIdsMissingAddress: jest.fn().mockResolvedValue(missing),
      fillMissingShippingAddresses: jest.fn().mockResolvedValue(2),
    };
    svc.orderService = orderService;
    const lookup = jest.fn().mockResolvedValue({ byOrderId: new Map([['O1', A]]), failedBatches: 0, failedOrderIds: 0 });
    svc.onospodOrderLookupService = { lookupShippingByOrderIds: lookup };
    return { svc, orderService, lookup, fetched };
  };
  const window = { start: '2026-09-01T00:00:00+07:00', end: '2026-09-02T00:00:00+07:00' };

  // The 1 s pauses between OnosPod calls are real setTimeouts; run them immediately here.
  beforeEach(() =>
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as never),
  );
  afterEach(() => jest.restoreAllMocks());

  it('is a DRY RUN by default: reports, writes nothing', async () => {
    const { svc, orderService } = make();
    const res = await svc.backfillShippingAddresses(window as never);
    expect(res.data.dryRun).toBe(true);
    expect(res.data.ordersUpdated).toBe(0);
    expect(res.data.addressesFound).toBe(1);
    expect(orderService.fillMissingShippingAddresses).not.toHaveBeenCalled();
  });

  it('writes only with dryRun=false, and paces the address lookup', async () => {
    const { svc, orderService, lookup } = make();
    const res = await svc.backfillShippingAddresses({ ...window, dryRun: false } as never);
    expect(orderService.fillMissingShippingAddresses).toHaveBeenCalledWith([{ onospodOrderId: 'O1', productionIds: ['P1', 'P2'], address: A }]);
    expect(res.data.ordersUpdated).toBe(2);
    expect(lookup.mock.calls[0][1]).toEqual({ pauseMs: expect.any(Number) });
  });

  it('walks every MRP status of the legacy ladder (old orders moved past To Do/Ready) and reports per status', async () => {
    const { svc, fetched } = make();
    const res = await svc.backfillShippingAddresses(window as never);
    expect(fetched).toEqual(expect.arrayContaining(['To Do', 'Ready', 'In Print', 'Packing']));
    expect(res.data.fetchedByStatus['In Print']).toBe(items.length);
  });

  it('rejects a window over 7 days or reversed', async () => {
    const { svc } = make();
    await expect(svc.backfillShippingAddresses({ start: window.start, end: '2026-09-09T00:00:00+07:00' } as never)).rejects.toThrow(BadRequestException);
    await expect(svc.backfillShippingAddresses({ start: window.end, end: window.start } as never)).rejects.toThrow(BadRequestException);
  });
});
