import axios from 'axios';

import { mapItemToRow } from './onospod-import.service';
import { OnospodOrderLookupService } from './onospod-order-lookup.service';

/**
 * Address enrichment of the OnosPod import. It must never break the import, but its failures
 * must be COUNTED: before 2026-10-04 they were only log lines on a cron, and 910 orders reached
 * production without an address in 18 days.
 */
jest.mock('axios');
// jest.mock has replaced axios.post with a mock; this reference only reads it to assert calls, it is never
// invoked detached from axios.
// eslint-disable-next-line @typescript-eslint/unbound-method
const post = axios.post as jest.Mock;

const make = () => {
  const svc = Object.create(OnospodOrderLookupService.prototype) as {
    apiConfigService: unknown;
    logger: unknown;
    lookupShippingByOrderIds: OnospodOrderLookupService['lookupShippingByOrderIds'];
  };
  svc.apiConfigService = { onospodApiConfig: { apiUrl: 'http://x', bearerToken: 't', superToken: 's' } };
  svc.logger = { error: jest.fn() };
  return svc;
};
const ids = (n: number, start = 0) => Array.from({ length: n }, (_, i) => (start + i).toString(16).padStart(24, 'a'));

beforeEach(() => post.mockReset());

describe('lookupShippingByOrderIds — counts failures, never throws', () => {
  it('all batches ok → no failure', async () => {
    post.mockResolvedValue({ data: { data: { orders: [{ _id: ids(1)[0], shipping: { city: 'Austin' } }] } } });
    const r = await make().lookupShippingByOrderIds(ids(60));
    expect(post).toHaveBeenCalledTimes(2); // 50 + 10
    expect(r.failedBatches).toBe(0);
    expect(r.byOrderId.get(ids(1)[0])).toMatchObject({ city: 'Austin' });
  });

  it('a network failure and a GraphQL error each count as a failed batch; the run still completes', async () => {
    post
      .mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 403'), { isAxiosError: true }))
      .mockResolvedValueOnce({ data: { errors: [{ message: 'banned' }] } })
      .mockResolvedValueOnce({ data: { data: { orders: [] } } });
    const r = await make().lookupShippingByOrderIds(ids(120));
    expect(r.failedBatches).toBe(2);
    expect(r.failedOrderIds).toBe(100);
    expect(r.firstError).toBeTruthy();
  });

  it('no OnosPod config → empty result, nothing called', async () => {
    const svc = make();
    svc.apiConfigService = { onospodApiConfig: undefined };
    const r = await svc.lookupShippingByOrderIds(ids(3));
    expect(post).not.toHaveBeenCalled();
    expect(r.failedBatches).toBe(0);
  });
});

describe('mapItemToRow stores the OnosPod order _id for later batch backfills', () => {
  it('onospodOrderId = item.order_id', () => {
    const row = mapItemToRow({ order_id: '6aaa05f1e2d3c4b5a6978811', increment_id: 'EH-1', increment_order_id: 'NF-1', print: null });
    expect(row.onospodOrderId).toBe('6aaa05f1e2d3c4b5a6978811');
    expect(row.orderId).toBe('NF-1');
  });
});
