import { BadRequestException } from '@nestjs/common';

import { ProductConfigService } from './product-config.service';

/** Creating or renaming a ProductConfig onto an existing `fullName` (case-insensitive) → 400. */
function build(clash: Record<string, unknown> | null) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(clash),
    findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'p1' }),
    create: jest.fn().mockResolvedValue({ _id: 'new' }),
  };
  const none = null as never;
  const svc = new ProductConfigService(repo as never, none, none, none, none, none, none, none, none);
  return { svc, repo };
}

describe('ProductConfig — unique fullName', () => {
  it('create with a taken name → 400, nothing created', async () => {
    const { svc, repo } = build({ _id: 'old' });
    await expect(svc.createProductConfig({ fullName: ' satin robe ' } as never)).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.findOne.mock.calls[0][0].fullName).toEqual({ $regex: '^satin robe$', $options: 'i' });
  });

  it('create with a new name → created', async () => {
    const { svc, repo } = build(null);
    await svc.createProductConfig({ fullName: 'New Robe' } as never);
    expect(repo.create).toHaveBeenCalled();
  });

  it('rename onto ANOTHER record\'s name → 400; the record itself is excluded', async () => {
    const { svc, repo } = build({ _id: 'other' });
    await expect(svc.updateProductConfig('p1', { fullName: 'Robe' } as never)).rejects.toThrow(BadRequestException);
    expect(repo.findOne.mock.calls[0][0]._id).toEqual({ $ne: 'p1' });
    expect(repo.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('update without a rename → no check', async () => {
    const { svc, repo } = build({ _id: 'other' });
    await svc.updateProductConfig('p1', { status: 'active' } as never);
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('regex characters in the name are escaped', async () => {
    const { svc, repo } = build(null);
    await svc.createProductConfig({ fullName: 'Shirt (2XL)+' } as never);
    expect(repo.findOne.mock.calls[0][0].fullName.$regex).toBe('^Shirt \\(2XL\\)\\+$');
  });
});
