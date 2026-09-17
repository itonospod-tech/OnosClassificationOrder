import type { LabelExportOrderDoc } from './label-export';
import { resolveLabelExportSources } from './label-export';

const doc = (id: string, over: Partial<LabelExportOrderDoc> = {}): LabelExportOrderDoc => ({
  _id: id,
  productionId: `P-${id}`,
  ...over,
});

describe('resolveLabelExportSources (Orders.md §16.9)', () => {
  it('ưu tiên label VNP, giữ đúng thứ tự ids người dùng tick', () => {
    const docs = [
      doc('A', { vnpShipment: { labelUrl: 'https://cdn/l-a.pdf' } }),
      doc('B', { tracking: { labelUrl: 'https://drive/l-b' } }),
    ];
    const r = resolveLabelExportSources(['B', 'A'], docs);
    expect(r.sources).toEqual([
      { productionId: 'P-B', labelUrl: 'https://drive/l-b', provider: 'customer' },
      { productionId: 'P-A', labelUrl: 'https://cdn/l-a.pdf', provider: 'vnp' },
    ]);
    expect(r.merged).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('label VNP đã hủy → lùi về label khách tự cấp; không có gì → no-label', () => {
    const docs = [
      doc('A', { vnpShipment: { labelUrl: 'https://cdn/l-a.pdf', cancelledAt: new Date() }, tracking: { labelUrl: 'https://drive/l-a2' } }),
      doc('B', { vnpShipment: { labelUrl: 'https://cdn/l-b.pdf', cancelledAt: new Date() } }),
      doc('C'),
    ];
    const r = resolveLabelExportSources(['A', 'B', 'C'], docs);
    expect(r.sources).toEqual([{ productionId: 'P-A', labelUrl: 'https://drive/l-a2', provider: 'customer' }]);
    expect(r.skipped).toEqual([
      { productionId: 'P-B', reason: 'no-label' },
      { productionId: 'P-C', reason: 'no-label' },
    ]);
  });

  it('id lạ → not-found', () => {
    const r = resolveLabelExportSources(['X'], []);
    expect(r.skipped).toEqual([{ productionId: 'X', reason: 'not-found' }]);
  });

  it('nhiều item chung kiện (cùng labelUrl) → 1 trang + các item sau vào merged', () => {
    const docs = [
      doc('A', { vnpShipment: { labelUrl: 'https://cdn/group.pdf' } }),
      doc('B', { vnpShipment: { labelUrl: 'https://cdn/group.pdf' } }),
      doc('C', { vnpShipment: { labelUrl: 'https://cdn/other.pdf' } }),
    ];
    const r = resolveLabelExportSources(['A', 'B', 'C'], docs);
    expect(r.sources.map((s) => s.productionId)).toEqual(['P-A', 'P-C']);
    expect(r.merged).toEqual(['P-B']);
  });

  it('labelUrl rỗng/khoảng trắng coi như không có', () => {
    const docs = [doc('A', { vnpShipment: { labelUrl: '  ' }, tracking: { labelUrl: '' } })];
    const r = resolveLabelExportSources(['A'], docs);
    expect(r.skipped).toEqual([{ productionId: 'P-A', reason: 'no-label' }]);
  });
});
