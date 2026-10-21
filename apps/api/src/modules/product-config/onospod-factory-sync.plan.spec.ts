import type { FactorySyncAppProduct, FactorySyncFacProduct } from './onospod-factory-sync.plan';
import {
  hashFactorySyncPlan,
  parseOnospodFactoryMap,
  parseOnospodFactorySyncMode,
  planOnospodFactorySync,
} from './onospod-factory-sync.plan';

// Dữ liệu dựng theo prod 20/10/2026: 5 manufacture bên app, 5 xưởng bên fac.
const manufactures = [
  { _id: 'm-ml', sku: 'ML', name: 'Mê Linh' },
  { _id: 'm-tn', sku: 'TN', name: 'Thái Nguyên' },
  { _id: 'm-decor', sku: 'TN-DECOR', name: 'Thái Nguyên Decor' },
  { _id: 'm-grab', sku: 'GRABINK', name: 'Grabink' },
];
const factories = [
  { _id: 'f-ml', shortName: 'ML' },
  { _id: 'f-tn', shortName: 'TN' },
  { _id: 'f-tnw', shortName: 'TNW' },
  { _id: 'f-dtf', shortName: 'MLDTF' },
  { _id: 'f-us', shortName: 'US' },
];

const app = (p: Partial<FactorySyncAppProduct> & { name: string }): FactorySyncAppProduct => ({
  _id: `a-${p.name}`,
  variationSkus: [],
  ...p,
});
const fac = (p: Partial<FactorySyncFacProduct> & { fullName: string }): FactorySyncFacProduct => ({
  _id: `c-${p.fullName}`,
  variationSkus: [],
  ...p,
});

const plan = (appProducts: FactorySyncAppProduct[], facProducts: FactorySyncFacProduct[], mapRaw?: string) =>
  planOnospodFactorySync({
    appProducts,
    manufactures,
    facProducts,
    factories,
    factoryMap: parseOnospodFactoryMap(mapRaw),
  });

describe('parseOnospodFactoryMap / parseOnospodFactorySyncMode', () => {
  it('mặc định quy đổi ML, TN, TN-DECOR→TNW, Grabink/Houston→US', () => {
    expect([...parseOnospodFactoryMap(undefined)]).toEqual([
      ['ML', 'ML'],
      ['TN', 'TN'],
      ['TN-DECOR', 'TNW'],
      ['GRABINK', 'US'],
      ['2DUS', 'US'],
    ]);
  });

  it('đọc chuỗi env, bỏ cặp hỏng, uppercase', () => {
    expect([...parseOnospodFactoryMap(' ml=ml , grabink=us, hong, =TN')]).toEqual([
      ['ML', 'ML'],
      ['GRABINK', 'US'],
    ]);
  });

  it('chế độ lạ hoặc trống = tắt', () => {
    expect(parseOnospodFactorySyncMode(undefined)).toBe('off');
    expect(parseOnospodFactorySyncMode('yes')).toBe('off');
    expect(parseOnospodFactorySyncMode(' DRY-RUN ')).toBe('dry-run');
    expect(parseOnospodFactorySyncMode('on')).toBe('on');
  });
});

describe('planOnospodFactorySync', () => {
  it('app đổi xưởng → đổi Product Config theo (khớp SKU)', () => {
    const r = plan(
      [app({ name: 'Raglan Ver 2', sku: 'R-V2', manufactureId: 'm-tn' })],
      [fac({ fullName: 'AOP Raglan Ver 2', sku: 'R-V2', factoryId: 'f-ml' })],
    );
    expect(r.changes).toEqual([
      expect.objectContaining({ productConfigId: 'c-AOP Raglan Ver 2', fromFactory: 'ML', toFactoryId: 'f-tn', toFactory: 'TN' }),
    ]);
    expect(r.unchanged).toBe(0);
  });

  it('đã đúng xưởng → không đổi', () => {
    const r = plan([app({ name: 'Hoodie', sku: 'HD', manufactureId: 'm-ml' })], [fac({ fullName: 'Hoodie', sku: 'HD', factoryId: 'f-ml' })]);
    expect(r.changes).toEqual([]);
    expect(r.unchanged).toBe(1);
  });

  it('fac đang trống xưởng → điền theo app', () => {
    const r = plan([app({ name: 'Table Decor', manufactureId: 'm-decor' })], [fac({ fullName: 'table decor' })]);
    expect(r.changes).toEqual([expect.objectContaining({ fromFactoryId: undefined, toFactory: 'TNW' })]);
  });

  it('khớp theo tên (không phân biệt hoa thường) rồi theo SKU biến thể', () => {
    const r = plan(
      [
        app({ name: 'Kids Hoodie', manufactureId: 'm-ml' }),
        app({ name: 'VD Polo', sku: 'R-PAOPPOLO', variationSkus: ['POLO-S'], manufactureId: 'm-ml' }),
      ],
      [
        fac({ fullName: 'KIDS HOODIE', factoryId: 'f-tn' }),
        fac({ fullName: 'Raglan Polo', sku: 'R-PAOPPOLO-V2', variationSkus: ['POLO-S', 'POLO-M'], factoryId: 'f-tn' }),
      ],
    );
    expect(r.changes.map((c) => c.productConfigId).sort()).toEqual(['c-KIDS HOODIE', 'c-Raglan Polo']);
  });

  it('fac để xưởng app không có (DTF TN) → giữ nguyên, báo bỏ qua', () => {
    const r = plan(
      [app({ name: 'Camo T-shirt DTF', sku: 'CAMO-TSHIRT', manufactureId: 'm-tn' })],
      [fac({ fullName: 'Camo T-shirt DTF', sku: 'CAMO-TSHIRT', factoryId: 'f-dtf' })],
    );
    expect(r.changes).toEqual([]);
    expect(r.skipped).toEqual([expect.objectContaining({ reason: 'fac-only-factory', detail: 'fac MLDTF · app Thái Nguyên' })]);
  });

  it('Grabink → US theo mặc định; bỏ khỏi bảng quy đổi thì chỉ báo bỏ qua', () => {
    const products = [app({ name: 'Youth Tee', sku: 'YT-5000B', manufactureId: 'm-grab' })];
    const facs = [fac({ fullName: 'Youth Tee', sku: 'YT-5000B', factoryId: 'f-ml' })];
    expect(plan(products, facs).changes).toEqual([expect.objectContaining({ fromFactory: 'ML', toFactory: 'US', outOfProduction: true })]);
    expect(plan(products, facs, 'ML=ML,TN=TN,TN-DECOR=TNW').skipped).toEqual([
      expect.objectContaining({ reason: 'unmapped-manufacture', detail: 'Grabink' }),
    ]);
  });

  it('bản chính + bản "VD" cùng xưởng → 1 thay đổi; khác xưởng → xung đột, không đổi', () => {
    const facs = [fac({ fullName: 'Raglan Ver 1', sku: 'R-V1', variationSkus: ['V1-S'], factoryId: 'f-ml' })];
    const main = app({ name: 'Raglan Ver 1', sku: 'R-V1', manufactureId: 'm-tn' });
    const same = plan([main, app({ name: 'VD Raglan Ver 1', sku: 'R-CLONE-V1', variationSkus: ['V1-S'], manufactureId: 'm-tn' })], facs);
    expect(same.changes).toHaveLength(1);
    expect(same.changes[0].appProducts).toHaveLength(2);

    const diff = plan([main, app({ name: 'VD Raglan Ver 1', sku: 'R-CLONE-V1', variationSkus: ['V1-S'], manufactureId: 'm-ml' })], facs);
    expect(diff.changes).toEqual([]);
    expect(diff.skipped).toEqual([expect.objectContaining({ reason: 'conflict', productConfigId: 'c-Raglan Ver 1' })]);
  });

  it('chỉ xưởng đích US mới bị đánh dấu ngoài luồng sản xuất', () => {
    const r = plan([app({ name: 'Hoodie', sku: 'HD', manufactureId: 'm-tn' })], [fac({ fullName: 'Hoodie', sku: 'HD', factoryId: 'f-ml' })]);
    expect(r.changes[0].outOfProduction).toBeUndefined();
  });

  it('bản chính CHƯA gán xưởng + bản "VD" có gán → xung đột, bản VD không tự quyết xưởng', () => {
    const r = plan(
      [
        app({ name: 'Raglan Ver 1', sku: 'R-V1' }),
        app({ name: 'VD Raglan Ver 1', sku: 'R-CLONE-V1', variationSkus: ['V1-S'], manufactureId: 'm-tn' }),
      ],
      [fac({ fullName: 'Raglan Ver 1', sku: 'R-V1', variationSkus: ['V1-S'], factoryId: 'f-ml' })],
    );
    expect(r.changes).toEqual([]);
    expect(r.skipped).toEqual([
      expect.objectContaining({ reason: 'no-manufacture', appProduct: 'Raglan Ver 1 (R-V1)' }),
      expect.objectContaining({
        reason: 'conflict',
        productConfigId: 'c-Raglan Ver 1',
        detail: 'VD Raglan Ver 1 (R-CLONE-V1): Thái Nguyên · Raglan Ver 1 (R-V1): app chưa gán xưởng',
      }),
    ]);
  });

  it('SKU trỏ config A nhưng tên trỏ đúng 1 config B khác → ambiguous, không âm thầm lấy bản SKU', () => {
    const r = plan(
      [app({ name: 'Kids Hoodie', sku: 'HDKID', manufactureId: 'm-tn' })],
      [fac({ fullName: 'Kids Hoodie Old', sku: 'HDKID', factoryId: 'f-ml' }), fac({ fullName: 'Kids Hoodie', factoryId: 'f-ml' })],
    );
    expect(r.changes).toEqual([]);
    expect(r.skipped).toEqual([
      expect.objectContaining({ reason: 'ambiguous', detail: 'SKU → Kids Hoodie Old · tên → Kids Hoodie' }),
    ]);
  });

  it('app chưa gán xưởng / không có trên fac / xưởng đích không tồn tại → bỏ qua kèm lý do', () => {
    const r = plan(
      [
        app({ name: 'No Manu' }),
        app({ name: 'Only On App', manufactureId: 'm-ml' }),
        app({ name: 'Decor', manufactureId: 'm-decor' }),
      ],
      [fac({ fullName: 'Decor', factoryId: 'f-ml' })],
      'ML=ML,TN-DECOR=GONE',
    );
    expect(r.changes).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['no-manufacture', 'not-on-fac', 'factory-missing']);
  });

  it('trùng SKU / trùng tên / SKU biến thể rơi vào nhiều config → ambiguous, không đoán, không rơi xuống bước sau', () => {
    const r = plan(
      [
        app({ name: 'Dup Sku', sku: 'DUP', manufactureId: 'm-tn' }),
        app({ name: 'Dup Name', manufactureId: 'm-tn' }),
        app({ name: 'Split Var', variationSkus: ['V-A', 'V-B'], manufactureId: 'm-tn' }),
      ],
      [
        fac({ fullName: 'Dup Sku A', sku: 'DUP', factoryId: 'f-ml' }),
        fac({ fullName: 'Dup Sku B', sku: 'dup', factoryId: 'f-ml' }),
        fac({ fullName: 'Dup Name', factoryId: 'f-ml', _id: 'n1' }),
        fac({ fullName: 'dup name', factoryId: 'f-ml', _id: 'n2' }),
        fac({ fullName: 'Var A', variationSkus: ['V-A'], factoryId: 'f-ml' }),
        fac({ fullName: 'Var B', variationSkus: ['V-B'], factoryId: 'f-ml' }),
      ],
    );
    expect(r.changes).toEqual([]);
    expect(r.skipped.map((s) => [s.reason, s.appProduct])).toEqual([
      ['ambiguous', 'Dup Sku (DUP)'],
      ['ambiguous', 'Dup Name'],
      ['ambiguous', 'Split Var'],
    ]);
  });

  it('SKU khớp đúng 1 config thì dùng luôn dù tên trùng nhiều config khác', () => {
    const r = plan(
      [app({ name: 'Same Name', sku: 'ONE', manufactureId: 'm-tn' })],
      [
        fac({ fullName: 'Same Name', sku: 'ONE', factoryId: 'f-ml', _id: 'x1' }),
        fac({ fullName: 'same name', factoryId: 'f-ml', _id: 'x2' }),
      ],
    );
    expect(r.changes).toEqual([expect.objectContaining({ productConfigId: 'x1', toFactory: 'TN' })]);
  });

  it('RỦI RO đã biết: bảo vệ "fac-only" suy từ vế phải bảng quy đổi — thêm MLDTF vào bảng là mất bảo vệ', () => {
    const products = [app({ name: 'Camo T-shirt DTF', sku: 'CAMO-TSHIRT', manufactureId: 'm-tn' })];
    const facs = [fac({ fullName: 'Camo T-shirt DTF', sku: 'CAMO-TSHIRT', factoryId: 'f-dtf' })];
    expect(plan(products, facs).changes).toEqual([]);
    expect(plan(products, facs, 'ML=ML,TN=TN,TN-DECOR=TNW,X=MLDTF').changes).toEqual([
      expect.objectContaining({ fromFactory: 'MLDTF', toFactory: 'TN' }),
    ]);
  });
});

describe('hashFactorySyncPlan', () => {
  const map = parseOnospodFactoryMap(undefined);
  const a = { productConfigId: 'a', fromFactoryId: 'f-ml', toFactoryId: 'f-tn' };
  const b = { productConfigId: 'b', toFactoryId: 'f-tn' };

  it('không phụ thuộc thứ tự dòng', () => {
    expect(hashFactorySyncPlan([a, b], map)).toBe(hashFactorySyncPlan([b, a], map));
  });

  it('đổi xưởng cũ / xưởng đích / thêm bớt dòng / đổi bảng quy đổi → mã khác', () => {
    const base = hashFactorySyncPlan([a, b], map);
    expect(hashFactorySyncPlan([{ ...a, fromFactoryId: 'f-us' }, b], map)).not.toBe(base);
    expect(hashFactorySyncPlan([{ ...a, toFactoryId: 'f-us' }, b], map)).not.toBe(base);
    expect(hashFactorySyncPlan([a], map)).not.toBe(base);
    expect(hashFactorySyncPlan([a, b], parseOnospodFactoryMap('ML=ML'))).not.toBe(base);
  });
});
