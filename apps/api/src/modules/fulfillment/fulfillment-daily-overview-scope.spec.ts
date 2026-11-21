import { FulfillmentStage, RoleType } from 'shared';

import { FulfillmentTaskService } from './fulfillment-task.service';

/**
 * Admin/Manager open Task Fulfillment in view-only mode and pick a factory (`?factoryId=`).
 * The daily overview must follow that pick for override roles, while a worker stays locked
 * to their own factory whatever the query says.
 */
const make = () => {
  const svc = Object.create(FulfillmentTaskService.prototype) as Record<string, unknown> & {
    getDailyOverview: (user: unknown, query: Record<string, unknown>) => Promise<unknown>;
  };
  const orderModel = { aggregate: jest.fn().mockResolvedValue([]) };
  svc.orderModel = orderModel;
  const matchOf = () => (orderModel.aggregate.mock.calls[0][0] as { $match?: Record<string, unknown> }[])[0].$match;
  return { svc, matchOf };
};

const worker = { _id: 'u1', role: { name: RoleType.Fulfillment }, fulfillmentStage: FulfillmentStage.Press, factoryId: 'F1' };
const admin = { _id: 'a1', role: { name: RoleType.Admin } };

describe('GET /fulfillment/daily-overview factory scope', () => {
  it('uses the factory an admin picked', async () => {
    const { svc, matchOf } = make();
    await svc.getDailyOverview(admin, { days: 7, stage: FulfillmentStage.Press, factoryId: 'F2' });
    expect(matchOf()?.$or).toEqual([{ factoryId: 'F2' }, { originalFactoryId: 'F2' }]);
  });

  it('keeps every factory when an admin picked none', async () => {
    const { svc, matchOf } = make();
    await svc.getDailyOverview(admin, { days: 7, stage: FulfillmentStage.Press });
    expect(matchOf()?.$or).toBeUndefined();
  });

  it('ignores factoryId from a worker', async () => {
    const { svc, matchOf } = make();
    await svc.getDailyOverview(worker, { days: 7, factoryId: 'F2' });
    expect(matchOf()?.$or).toEqual([{ factoryId: 'F1' }, { originalFactoryId: 'F1' }]);
  });
});
