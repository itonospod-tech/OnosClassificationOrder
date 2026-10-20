import { OnospodProductImportService } from './onospod-product-import.service';

/**
 * Import sản phẩm từ OnosPod: xưởng của sản phẩm TẠO MỚI chỉ lấy theo app khi
 * `ONOSPOD_FACTORY_SYNC_MODE=on` (Products.md §2.7a). `off`/`dry-run` giữ hành
 * vi cũ: không gọi thêm OnosPod, không đặt key `factoryId`.
 */
function setup(mode: string) {
  const create = jest.fn((doc: Record<string, unknown>) => Promise.resolve(doc));
  const productConfigModel = {
    findOne: () => ({ lean: () => Promise.resolve(null) }),
    create,
  };
  const service = new OnospodProductImportService(
    { onospodFactorySync: { mode, factoryMap: '' } } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { findAll: () => Promise.resolve([{ _id: 'f-tn', shortName: 'TN' }]) } as never,
    productConfigModel as never,
  );
  const internals = service as unknown as Record<string, unknown>;
  internals.fetchPage = jest.fn(() =>
    Promise.resolve({ rows: [{ _id: 'p1', name: 'New Product', sku: 'NEW-1', manufacture_id: 'm-tn' }], total: 1 }),
  );
  internals.fetchLegacyTagSlugs = jest.fn(() => Promise.resolve(new Map()));
  internals.fetchLegacyTechniqueSlugs = jest.fn(() => Promise.resolve(new Map()));
  internals.mapProduct = jest.fn(() => Promise.resolve({ fullName: 'New Product', sku: 'NEW-1' }));
  internals.ensureDefaultVariations = jest.fn(() => Promise.resolve(0));
  const fetchManufactures = jest.spyOn(service, 'fetchManufactures').mockResolvedValue([{ _id: 'm-tn', sku: 'TN' }]);
  return { service, create, fetchManufactures };
}

describe('OnospodProductImportService — xưởng sản phẩm tạo mới theo env', () => {
  it.each(['off', 'dry-run', ''])('mode "%s": không gọi danh sách xưởng, không đặt factoryId', async (mode) => {
    const t = setup(mode);
    await t.service.importFromOnospod({ page: 1, limit: 500 } as never);
    expect(t.fetchManufactures).not.toHaveBeenCalled();
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.create.mock.calls[0][0]).not.toHaveProperty('factoryId');
  });

  it('mode "on": sản phẩm mới mang xưởng app qua bảng quy đổi', async () => {
    const t = setup('on');
    await t.service.importFromOnospod({ page: 1, limit: 500 } as never);
    expect(t.fetchManufactures).toHaveBeenCalledTimes(1);
    expect(t.create.mock.calls[0][0]).toEqual(expect.objectContaining({ factoryId: 'f-tn' }));
  });

  it('mode "on" nhưng lấy danh sách xưởng lỗi → vẫn tạo, để trống xưởng, báo lỗi', async () => {
    const t = setup('on');
    t.fetchManufactures.mockRejectedValue(new Error('500'));
    const res = await t.service.importFromOnospod({ page: 1, limit: 500 } as never);
    expect(t.create.mock.calls[0][0]).not.toHaveProperty('factoryId');
    expect(JSON.stringify(res)).toContain('Không lấy được danh sách xưởng');
  });
});
