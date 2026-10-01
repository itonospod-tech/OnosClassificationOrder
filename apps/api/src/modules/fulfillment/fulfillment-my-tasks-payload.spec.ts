import { FulfillmentStage, RoleType } from 'shared';

import { FulfillmentTaskService } from './fulfillment-task.service';

/**
 * The fulfillment kanban calls GET /fulfillment/my-tasks six times in parallel
 * (one per tab, size up to 5000) on every refresh. Measured on dev data: a TN press
 * worker's 7-day refresh returned ~1,800 full order documents (~8 MB) and ran the same
 * ~8 tab counts six times over. These tests lock the two cheap fixes.
 */
const make = () => {
  const svc = Object.create(FulfillmentTaskService.prototype) as Record<string, unknown> & {
    getMyTasks: (user: unknown, query: Record<string, unknown>) => Promise<{ tabCounts?: unknown }>;
  };
  const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) };
  const orderModel = { find: jest.fn().mockReturnValue(chain), countDocuments: jest.fn().mockResolvedValue(0) };
  svc.orderModel = orderModel;
  svc.buildMyTaskBase = jest.fn().mockReturnValue({});
  svc.applyTabFilter = jest.fn().mockReturnValue({});
  svc.countAllTabs = jest.fn().mockResolvedValue({ waiting: 1 });
  return { svc, orderModel };
};
const worker = { _id: 'u1', role: { name: RoleType.Fulfillment }, fulfillmentStage: FulfillmentStage.Press, factoryId: 'F1' };

describe('GET /fulfillment/my-tasks payload', () => {
  it('does not send fulfillmentTimeline (unused by My Tasks, ~46% of each document)', async () => {
    const { svc, orderModel } = make();
    await svc.getMyTasks(worker, { tab: 'done', size: 5000 });
    expect(orderModel.find.mock.calls[0][1]).toEqual({ fulfillmentTimeline: 0 });
  });

  it('skips the tab counts unless asked', async () => {
    const { svc } = make();
    const res = await svc.getMyTasks(worker, { tab: 'waiting', size: 5000 });
    expect(svc.countAllTabs).not.toHaveBeenCalled();
    expect(res.tabCounts).toBeUndefined();
  });

  it('runs the tab counts with withCounts', async () => {
    const { svc } = make();
    const res = await svc.getMyTasks(worker, { tab: 'waiting', size: 5000, withCounts: true });
    expect(svc.countAllTabs).toHaveBeenCalledTimes(1);
    expect(res.tabCounts).toEqual({ waiting: 1 });
  });
});
