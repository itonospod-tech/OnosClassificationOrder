import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FulfillmentStage, RoleType } from 'shared';

import { FulfillmentTaskService } from './fulfillment-task.service';

/**
 * D1 — `stage` / `factoryId` on GET /fulfillment/my-tasks are an override for
 * Manager/Admin. A Fulfillment worker used to pass `?factoryId=<other factory>`
 * (ids come from GET /factories/options, open to every staff account) and read
 * that factory's queue; `?stage=` did the same for another stage.
 */
const make = () => {
  const svc = Object.create(FulfillmentTaskService.prototype) as Record<string, unknown> & {
    getMyTasks: (user: unknown, query: Record<string, unknown>) => Promise<unknown>;
    buildMyTaskBase: jest.Mock;
    applyTabFilter: jest.Mock;
  };
  const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) };
  const orderModel = { find: jest.fn().mockReturnValue(chain), countDocuments: jest.fn().mockResolvedValue(0) };
  svc.orderModel = orderModel;
  svc.buildMyTaskBase = jest.fn().mockReturnValue({});
  svc.applyTabFilter = jest.fn().mockReturnValue({});
  svc.countAllTabs = jest.fn().mockResolvedValue({});
  return { svc, orderModel };
};
const worker = { _id: 'u1', role: { name: RoleType.Fulfillment }, fulfillmentStage: FulfillmentStage.Press, factoryId: 'F1' };
const staff = (name: RoleType) => ({ _id: 'm1', role: { name } });

describe('GET /fulfillment/my-tasks scope (D1)', () => {
  it('a worker cannot read another factory with ?factoryId', async () => {
    const { svc, orderModel } = make();
    await expect(svc.getMyTasks(worker, { tab: 'waiting', factoryId: 'F2' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(orderModel.find).not.toHaveBeenCalled();
  });

  it('a worker cannot read another stage with ?stage', async () => {
    const { svc, orderModel } = make();
    await expect(svc.getMyTasks(worker, { tab: 'waiting', stage: FulfillmentStage.Print })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(orderModel.find).not.toHaveBeenCalled();
  });

  it('a worker without query params, or repeating their own values, gets their own stage and factory', async () => {
    for (const query of [{}, { stage: FulfillmentStage.Press, factoryId: 'F1' }]) {
      const { svc } = make();
      await svc.getMyTasks(worker, { tab: 'waiting', ...query });
      expect(svc.buildMyTaskBase.mock.calls[0].slice(0, 2)).toEqual([FulfillmentStage.Press, 'F1']);
      expect(svc.applyTabFilter.mock.calls[0].slice(1)).toEqual(['waiting', FulfillmentStage.Press, 'u1']);
    }
  });

  it('a worker with no stage or no factory is refused, whatever the query says', async () => {
    const { svc } = make();
    await expect(
      svc.getMyTasks({ ...worker, fulfillmentStage: undefined }, { tab: 'waiting', stage: FulfillmentStage.Print }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.getMyTasks({ ...worker, factoryId: undefined }, { tab: 'waiting', factoryId: 'F2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.SupportManager])(
    '%s still overrides stage and factory',
    async (role) => {
      const { svc } = make();
      await svc.getMyTasks(staff(role), { tab: 'waiting', stage: FulfillmentStage.Pack, factoryId: 'F2' });
      expect(svc.buildMyTaskBase.mock.calls[0].slice(0, 2)).toEqual([FulfillmentStage.Pack, 'F2']);
    },
  );

  it('an override role without params keeps the all-factory view on the default stage', async () => {
    const { svc } = make();
    await svc.getMyTasks(staff(RoleType.Admin), { tab: 'waiting' });
    expect(svc.buildMyTaskBase.mock.calls[0].slice(0, 2)).toEqual([FulfillmentStage.Print, undefined]);
  });
});
