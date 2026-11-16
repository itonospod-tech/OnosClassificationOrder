import { OrderLogService } from './order-log.service';

describe('OrderLogService — impersonator on every write path', () => {
  const ctx = {
    user: {
      _id: 'u1',
      fullName: 'Support A',
      email: 'a@x.com',
      role: { name: 'Support' },
      impersonatedBy: { _id: 'sa1', fullName: 'Super Admin' },
    },
    ip: '1.2.3.4',
    userAgent: 'jest',
  } as any;

  it('write() records the impersonator', async () => {
    const repo = { create: jest.fn().mockResolvedValue(undefined) } as any;
    await new OrderLogService(repo).write({ orderId: 'o1', action: 'update', field: 'f', before: 1, after: 2, ctx } as any);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ impersonatorId: 'sa1', impersonatorName: 'Super Admin' }),
    );
  });

  it('writeMany() records the impersonator on each row like write()', async () => {
    const repo = { createMany: jest.fn().mockResolvedValue(undefined) } as any;
    await new OrderLogService(repo).writeMany([
      { orderId: 'o1', action: 'update', field: 'f', before: 1, after: 2, ctx },
      { orderId: 'o2', action: 'update', field: 'f', before: 1, after: 2, ctx },
    ] as any);
    const rows = repo.createMany.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ impersonatorId: 'sa1', impersonatorName: 'Super Admin', userId: 'u1' });
    }
  });

  it('writeMany() leaves the impersonator empty for a normal session', async () => {
    const repo = { createMany: jest.fn().mockResolvedValue(undefined) } as any;
    const plain = { ...ctx, user: { ...ctx.user, impersonatedBy: undefined } };
    await new OrderLogService(repo).writeMany([{ orderId: 'o1', action: 'update', field: 'f', ctx: plain }] as any);
    expect(repo.createMany.mock.calls[0][0][0].impersonatorId).toBeUndefined();
  });
});
