import { GetDailyBySellerZod, RoleType } from 'shared';

import { loadExcludedFactoryId } from '../../utils/excluded-factory';
import { OrderService } from './order.service';

/** Legacy "Daily report": VN days, standard exclusions, a worker locked to their factory, items + packages merged per (day, seller). */
describe('getDailyBySeller', () => {
  const US = 'US_ID';
  beforeAll(async () => {
    await loadExcludedFactoryId({ collection: () => ({ findOne: () => Promise.resolve({ _id: US }) }) } as never);
  });
  const make = () => {
    const pipes: { orders?: Array<Record<string, unknown>>; packages?: Array<Record<string, unknown>> } = {};
    const svc = Object.create(OrderService.prototype) as unknown as Record<string, unknown> & { getDailyBySeller: OrderService['getDailyBySeller'] };
    svc.orderModel = {
      aggregate: (p: Array<Record<string, unknown>>) => {
        pipes.orders = p;
        return Promise.resolve([{ _id: { date: '2026-10-01', userSku: 'A' }, items: 3, quantity: 4 }]);
      },
      db: {
        collection: () => ({
          aggregate: (p: Array<Record<string, unknown>>) => {
            pipes.packages = p;
            return { toArray: () => Promise.resolve([{ _id: { date: '2026-10-01', userSku: 'A' }, packages: 2 }, { _id: { date: '2026-10-02', userSku: 'B' }, packages: 1 }]) };
          },
        }),
      },
    };
    return { svc, pipes };
  };
  const dto = (x: object = {}) => GetDailyBySellerZod.parse({ from: '2026-10-01', to: '2026-10-07', ...x }) as never;

  it('merges items and packages per VN day and seller', async () => {
    const { svc, pipes } = make();
    const rows = await svc.getDailyBySeller(dto(), RoleType.Admin);
    expect(rows).toEqual([
      { date: '2026-10-01', userSku: 'A', items: 3, quantity: 4, packages: 2 },
      { date: '2026-10-02', userSku: 'B', items: 0, quantity: 0, packages: 1 },
    ]);
    const match = pipes.orders![0].$match as Record<string, unknown>;
    expect(match).toMatchObject({ cancelledAt: { $exists: false }, deletedAt: { $exists: false } });
    expect(match.fulfillmentCompletedAt).toEqual({ $gte: new Date('2026-10-01T00:00:00+07:00'), $lte: new Date('2026-10-07T23:59:59.999+07:00') });
    expect(JSON.stringify(match)).toContain(US); // US factory excluded
    expect(JSON.stringify(pipes.orders)).toContain('Asia/Ho_Chi_Minh');
  });

  it('a Fulfillment worker is locked to their own factory whatever they ask', async () => {
    const { svc, pipes } = make();
    await svc.getDailyBySeller(dto({ factoryId: 'OTHERFACTORY0001' }), RoleType.Fulfillment, 'MYFACTORY0000001');
    const s = JSON.stringify(pipes.orders![0].$match) + JSON.stringify(pipes.packages![0].$match);
    expect(s).toContain('MYFACTORY0000001');
    expect(s).not.toContain('OTHERFACTORY0001');
  });

  it('rejects a reversed or too long range', async () => {
    const { svc } = make();
    await expect(svc.getDailyBySeller(dto({ from: '2026-10-07', to: '2026-10-01' }), RoleType.Admin)).rejects.toThrow();
    await expect(svc.getDailyBySeller(dto({ from: '2026-08-01' }), RoleType.Admin)).rejects.toThrow('31');
  });
});
