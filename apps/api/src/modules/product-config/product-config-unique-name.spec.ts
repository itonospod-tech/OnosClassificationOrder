import { BadRequestException } from '@nestjs/common';

import { ProductConfigService } from './product-config.service';

/** Tạo/đổi tên ProductConfig trùng `fullName` (không phân biệt hoa thường) → 400. */
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

describe('ProductConfig — fullName duy nhất', () => {
  it('create trùng tên → 400, không tạo', async () => {
    const { svc, repo } = build({ _id: 'old' });
    await expect(svc.createProductConfig({ fullName: ' satin robe ' } as never)).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.findOne.mock.calls[0][0].fullName).toEqual({ $regex: '^satin robe$', $options: 'i' });
  });

  it('create tên mới → tạo', async () => {
    const { svc, repo } = build(null);
    await svc.createProductConfig({ fullName: 'New Robe' } as never);
    expect(repo.create).toHaveBeenCalled();
  });

  it('update đổi tên trùng bản KHÁC → 400; loại trừ chính nó', async () => {
    const { svc, repo } = build({ _id: 'other' });
    await expect(svc.updateProductConfig('p1', { fullName: 'Robe' } as never)).rejects.toThrow(BadRequestException);
    expect(repo.findOne.mock.calls[0][0]._id).toEqual({ $ne: 'p1' });
    expect(repo.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('update không đổi tên → không kiểm', async () => {
    const { svc, repo } = build({ _id: 'other' });
    await svc.updateProductConfig('p1', { status: 'active' } as never);
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('ký tự regex trong tên được escape', async () => {
    const { svc, repo } = build(null);
    await svc.createProductConfig({ fullName: 'Shirt (2XL)+' } as never);
    expect(repo.findOne.mock.calls[0][0].fullName.$regex).toBe('^Shirt \\(2XL\\)\\+$');
  });
});
