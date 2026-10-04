import type { ImportFullProductsDto } from 'shared';

import { ProductConfigService } from './product-config.service';

/**
 * `importFullProducts` — import sản phẩm HOÀN CHỈNH từ file (catalog + biến
 * thể). Test bằng mock deps (repo + 4 service resolve label): kiểm 5 hành vi
 * cốt lõi — tạo mới mặc định không tool, skip khi Xưởng sai, warning khi Danh
 * mục sai, merge biến thể theo SKU khi update, báo SKU trùng sản phẩm khác.
 */

type Mocks = {
  repo: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    create: jest.Mock;
  };
};

function buildService(existing: Record<string, unknown> | null = null): { svc: ProductConfigService; mocks: Mocks } {
  const repo = {
    findOne: jest.fn().mockResolvedValue(existing),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
  };
  const factoryService = {
    findByLabel: jest.fn((label: string) =>
      Promise.resolve(label.toUpperCase().includes('TNW') ? { _id: 'factory-1' } : null),
    ),
  };
  const machineTypeService = {
    findByLabel: jest.fn((label: string) =>
      Promise.resolve(label.toUpperCase() === 'UV' ? { _id: 'machine-1' } : null),
    ),
  };
  const productCategoryService = {
    findByLabel: jest.fn((label: string) =>
      Promise.resolve(label === 'Trang trí nhà' ? { _id: 'category-1' } : null),
    ),
  };
  const collectionService = {
    findByLabel: jest.fn((label: string) => Promise.resolve(label === 'Woodcraft' ? { _id: 'collection-1' } : null)),
  };
  const svc = new ProductConfigService(
    repo as never,
    factoryService as never,
    machineTypeService as never,
    productCategoryService as never,
    collectionService as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  return { svc, mocks: { repo } };
}

const baseProduct = {
  fullName: 'Wooden Custom Name Sign',
  factoryLabel: 'TNW',
  departmentLabel: 'UV',
  categoryLabel: 'Trang trí nhà',
  collectionLabels: ['Woodcraft'],
  mockup: 'https://example.com/mockup.png',
  variations: [{ sku: 'wns-30x20', retailPrice: 12.99, status: 'active' }],
} as unknown as ImportFullProductsDto['products'][number];

describe('importFullProducts — import sản phẩm hoàn chỉnh từ file', () => {
  it('tạo mới: resolve đủ label, shortName KHÔNG auto-sinh (ORD-3), mặc định KHÔNG tool, SKU uppercase', async () => {
    const { svc, mocks } = buildService(null);
    const res = await svc.importFullProducts({ products: [baseProduct] } as unknown as ImportFullProductsDto);

    expect(res.data).toMatchObject({ imported: 1, updated: 0, skipped: [], warnings: [] });
    const created = mocks.repo.create.mock.calls[0][0];
    // File không có cột viết tắt → để trống, KHÔNG sinh từ fullName (shortName = mã tool design review).
    expect(created.shortName).toBeUndefined();
    expect(created.toolResult).toBe('no-tool');
    expect(created.factoryId).toBe('factory-1');
    expect(created.machineTypeId).toBe('machine-1');
    expect(created.productCategoryId).toBe('category-1');
    expect(created.collectionIds).toEqual(['collection-1']);
    expect(created.variations[0].sku).toBe('WNS-30X20');
  });

  it('Xưởng không khớp → skip cả sản phẩm, không tạo', async () => {
    const { svc, mocks } = buildService(null);
    const res = await svc.importFullProducts({
      products: [{ ...baseProduct, factoryLabel: 'XƯỞNG LẠ' }],
    } as unknown as ImportFullProductsDto);

    expect(res.data.skipped).toHaveLength(1);
    expect(res.data.imported).toBe(0);
    expect(mocks.repo.create).not.toHaveBeenCalled();
  });

  it('Danh mục/Collection không khớp → warning nhưng VẪN import, bỏ field đó', async () => {
    const { svc, mocks } = buildService(null);
    const res = await svc.importFullProducts({
      products: [{ ...baseProduct, categoryLabel: 'Danh mục lạ', collectionLabels: ['Lạ'] }],
    } as unknown as ImportFullProductsDto);

    expect(res.data.imported).toBe(1);
    expect(res.data.warnings).toHaveLength(2);
    const created = mocks.repo.create.mock.calls[0][0];
    expect(created.productCategoryId).toBeUndefined();
    expect(created.collectionIds).toBeUndefined();
  });

  it('update: merge biến thể theo SKU — giữ biến thể cũ ngoài file, update trùng SKU, append SKU mới; field trống không ghi đè', async () => {
    const existing = {
      _id: 'p1',
      fullName: 'Wooden Custom Name Sign',
      description: 'Mô tả cũ',
      variations: [
        { sku: 'WNS-30X20', cost: 4, retailPrice: 10 },
        { sku: 'WNS-OLD', retailPrice: 8 },
      ],
    };
    const { svc, mocks } = buildService(existing);
    const res = await svc.importFullProducts({
      products: [
        {
          ...baseProduct,
          variations: [
            { sku: 'WNS-30X20', retailPrice: 12.99, status: 'active' },
            { sku: 'WNS-NEW', retailPrice: 15, status: 'active' },
          ],
        },
      ],
    } as unknown as ImportFullProductsDto);

    expect(res.data).toMatchObject({ imported: 0, updated: 1 });
    const patch = mocks.repo.findOneAndUpdate.mock.calls[0][1];
    // Field không có trong file (description) KHÔNG nằm trong patch → giữ giá trị cũ.
    expect(patch.description).toBeUndefined();
    const skus = patch.variations.map((v: { sku: string }) => v.sku);
    expect(skus).toEqual(['WNS-30X20', 'WNS-OLD', 'WNS-NEW']);
    // SKU trùng: field mới ghi đè, field cũ không có trong file giữ nguyên.
    expect(patch.variations[0]).toMatchObject({ cost: 4, retailPrice: 12.99 });
  });

  it('SKU biến thể trùng sản phẩm khác (E11000) → skip với lý do, không throw', async () => {
    const { svc, mocks } = buildService(null);
    mocks.repo.create.mockRejectedValue({ code: 11000, keyPattern: { 'variations.sku': 1 } });
    const res = await svc.importFullProducts({ products: [baseProduct] } as unknown as ImportFullProductsDto);

    expect(res.data.imported).toBe(0);
    expect(res.data.skipped[0].reason).toContain('SKU');
  });
});
