import { Types } from 'mongoose';

import { CustomerAssignmentService } from '../customer-assignment/customer-assignment.service';
import { CustomerRepository } from './customer.repository';

/**
 * Collection giả mô phỏng đúng so khớp `_id` của MongoDB: chuỗi chỉ khớp chuỗi,
 * ObjectId chỉ khớp ObjectId (đây chính là lý do Mongoose với schema
 * `_id: String` không tìm thấy khách có `_id` ObjectId).
 */
function fakeModel(docs: Array<Record<string, unknown>>) {
  const sameId = (a: unknown, b: unknown) => {
    if (a instanceof Types.ObjectId || b instanceof Types.ObjectId) {
      return a instanceof Types.ObjectId && b instanceof Types.ObjectId && a.equals(b);
    }
    return a === b;
  };
  const find = jest.fn((filter: { _id: { $in: unknown[] }; deletedAt?: { $exists: boolean } }) => ({
    toArray: () =>
      Promise.resolve(
        docs.filter(
          (d) =>
            filter._id.$in.some((id) => sameId(id, d._id)) &&
            (filter.deletedAt?.$exists === false ? !('deletedAt' in d) : true),
        ),
      ),
  }));
  return { model: { collection: { find } }, find };
}

const OID_HEX = '6aee9c64d506256f5c5d57cb';

describe('CustomerRepository.findMatchRowsByIds', () => {
  const docs = [
    { _id: new Types.ObjectId(OID_HEX), userSku: 'FFMTEEZ', userEmail: 'ffm.teez@gmail.com' },
    { _id: 'VOV00HY8Z5BIHFX0', userSku: 'SHOPA', userEmail: 'a@x.com' },
    { _id: 'DELETED000000001', userSku: 'OLD', userEmail: 'o@x.com', deletedAt: new Date() },
  ];

  it('khớp cả khách _id ObjectId lẫn _id chuỗi, trả _id dạng chuỗi', async () => {
    const { model } = fakeModel(docs);
    const repo = new CustomerRepository(model as never);
    const rows = await repo.findMatchRowsByIds([OID_HEX, 'VOV00HY8Z5BIHFX0']);
    expect(rows).toEqual([
      { _id: OID_HEX, userSku: 'FFMTEEZ', userEmail: 'ffm.teez@gmail.com' },
      { _id: 'VOV00HY8Z5BIHFX0', userSku: 'SHOPA', userEmail: 'a@x.com' },
    ]);
  });

  it('bỏ khách đã xoá mềm, id rỗng thì không query', async () => {
    const { model, find } = fakeModel(docs);
    const repo = new CustomerRepository(model as never);
    expect(await repo.findMatchRowsByIds(['DELETED000000001'])).toEqual([]);
    find.mockClear();
    expect(await repo.findMatchRowsByIds([])).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('id không phải hex 24 ký tự thì không ép sang ObjectId', async () => {
    const { model, find } = fakeModel(docs);
    const repo = new CustomerRepository(model as never);
    await repo.findMatchRowsByIds(['VOV00HY8Z5BIHFX0']);
    expect(find.mock.calls[0][0]._id.$in).toEqual(['VOV00HY8Z5BIHFX0']);
  });
});

describe('CustomerAssignmentService.getImportOverride với khách _id ObjectId', () => {
  it('ép xưởng được cho khách tạo qua sync (FFMTEEZ → Mê Linh)', async () => {
    const { model } = fakeModel([
      { _id: new Types.ObjectId(OID_HEX), userSku: 'FFMTEEZ', userEmail: 'ffm.teez@gmail.com' },
    ]);
    const repo = new CustomerRepository(model as never);
    const systemConfig = {
      get: jest.fn(() =>
        Promise.resolve({ enabled: true, factories: [{ factoryId: '80HF1JV8P6CLEBUQ', customerIds: [OID_HEX] }] }),
      ),
    };
    const service = new CustomerAssignmentService(systemConfig as never, repo);
    const override = await service.getImportOverride();
    expect(override.enabled).toBe(true);
    expect([...override.map.values()]).toEqual(['80HF1JV8P6CLEBUQ']);
    expect(override.map.size).toBe(1);
  });
});
