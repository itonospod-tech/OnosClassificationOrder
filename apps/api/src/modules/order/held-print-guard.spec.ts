import { BadRequestException } from '@nestjs/common';

import { resolveLabelExportSources } from './label-export';
import { OrderService } from './order.service';

/**
 * A held order must never get print data (Orders.md §9b): holding stopped the ledger but not the
 * printer, so a worker scanned a held order, printed it, and only learned at "Done" that it was held.
 * Batches skip held orders and report them; a request where everything is held fails with the reason.
 */
type Doc = { _id: string; productionId: string; heldAt?: Date; holdReason?: string; orderId?: string };
const DOCS: Doc[] = [
  { _id: 'A', productionId: 'KH-00001-00001', orderId: 'O1' },
  { _id: 'H', productionId: 'KH-13604-99037', orderId: 'O2', heldAt: new Date(), holdReason: 'Chờ khách xác nhận' },
  { _id: 'H2', productionId: 'KH-00002-00002', orderId: 'O3', heldAt: new Date() },
];

const make = () => {
  const svc = Object.create(OrderService.prototype) as unknown as {
    [k: string]: unknown;
    getBarcodeLabels: OrderService['getBarcodeLabels'];
    getShippingLabels: OrderService['getShippingLabels'];
  };
  // Minimal fake: honours `_id $in` and `heldAt $exists`, which is all the print paths filter on.
  svc.orderRepository = {
    findAll: (filter: { _id?: { $in: string[] }; heldAt?: { $exists: boolean } }) => {
      if (!filter._id) return Promise.resolve([]); // sibling lookup by orderId: not needed here
      return Promise.resolve(
        DOCS.filter((d) => filter._id!.$in.includes(d._id)).filter((d) =>
          filter.heldAt ? filter.heldAt.$exists === !!d.heldAt : true,
        ),
      );
    },
  };
  svc.productConfigRepository = { findAll: () => Promise.resolve([]) };
  svc.factoryRepository = { findAll: () => Promise.resolve([]) };
  return svc;
};

describe.each(['getBarcodeLabels', 'getShippingLabels'] as const)('%s', (method) => {
  it('leaves held orders out of a batch and reports them', async () => {
    const res = await make()[method](['A', 'H']);
    expect(res.labels.map((l) => l.productionId)).toEqual(['KH-00001-00001']);
    expect(res.skippedHeld).toEqual([{ productionId: 'KH-13604-99037', holdReason: 'Chờ khách xác nhận' }]);
  });

  it('a single held order fails with its code and hold reason', async () => {
    await expect(make()[method](['H'])).rejects.toThrow(
      new BadRequestException('Đơn KH-13604-99037 đang bị giữ (Chờ khách xác nhận) — mở lại (bỏ giữ) trước khi in.'),
    );
  });

  it('a batch of only held orders fails', async () => {
    await expect(make()[method](['H', 'H2'])).rejects.toThrow('2 đơn đều đang bị giữ');
  });

  it('nothing held: unchanged', async () => {
    const res = await make()[method](['A']);
    expect(res.labels).toHaveLength(1);
    expect(res.skippedHeld).toEqual([]);
  });
});

it('carrier label PDF export skips held orders as `held`', () => {
  const r = resolveLabelExportSources(
    ['A', 'H'],
    [
      { _id: 'A', productionId: 'P-A', tracking: { labelUrl: 'https://x/a.pdf' } },
      { _id: 'H', productionId: 'P-H', tracking: { labelUrl: 'https://x/h.pdf' }, heldAt: new Date() },
    ],
  );
  expect(r.sources.map((s) => s.productionId)).toEqual(['P-A']);
  expect(r.skipped).toEqual([{ productionId: 'P-H', reason: 'held' }]);
});
