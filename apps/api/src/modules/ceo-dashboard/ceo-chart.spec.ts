import type { CeoOverview, CeoReport } from 'shared';

import { buildCeoChartSvg } from './ceo-chart';

/**
 * Ảnh báo cáo là thứ agent gửi thẳng cho chủ tịch — không ai soi lại trước khi
 * gửi. Nên phần dựng phải là hàm THUẦN và có test: hỏng ở đây là gửi ra ngoài
 * một tấm ảnh sai hoặc vỡ, không phải một lỗi 500 ai đó nhìn thấy.
 */
const overview = (patch: Partial<CeoOverview> = {}): CeoOverview =>
  ({
    period: {
      from: '2026-09-09',
      to: '2026-09-09',
      days: 1,
      prevFrom: '2026-09-08',
      prevTo: '2026-09-08',
      compareMode: 'previous',
      weekday: 3,
      generatedAt: '2026-09-10T00:01:23.000Z',
      cached: false,
    },
    production: {
      in: 724,
      out: 981,
      prevIn: 939,
      prevOut: 897,
      daily: [
        { day: '2026-09-08', in: 939, out: 897, revenue: 4100, errors: 5 },
        { day: '2026-09-09', in: 724, out: 981, revenue: 4285.88, errors: 7 },
      ],
      reference: null,
      byFactory: [],
    },
    revenue: { total: 4285.88, prev: 4100, ship: 0, avgPerOrder: 4.4, prevAvgPerOrder: 4.6, currency: 'USD', basis: 'baseCost' },
    sla: {
      targets: [
        { n: 0, pct: 30 },
        { n: 1, pct: 80 },
        { n: 2, pct: 100 },
      ],
      cohortFrom: '2026-09-07',
      cohortTo: '2026-09-07',
      mature: 752,
      within: [
        { n: 0, count: 392, pct: 7.4 },
        { n: 1, count: 785, pct: 47.7 },
        { n: 2, count: 998, pct: 98.7 },
      ],
      prevN2Pct: 96.9,
      dailyN2: [],
      overdue: { total: 991, byFactory: [], sample: [] },
    },
    quality: { errored: 26, ratePct: 1, prevRatePct: 1.4, bySource: [], topTypes: [] },
    customers: { active: 66, prevActive: 60, newCount: 2, top10SharePct: 55, top: [], rising: [], dropping: [] },
    capacity: {
      backlog: 1926,
      prevBacklog: 1800,
      avgAgeDays: 3.2,
      staleOpen: 3417,
      staleDays: 45,
      byStage: [
        { stage: 'press', count: 697 },
        { stage: 'sew-out', count: 243 },
      ],
      history: [],
    },
    people: { designers: [], workers: [] },
    findings: [],
    ...patch,
  }) as CeoOverview;

const report = (): CeoReport =>
  ({
    _id: 'r1',
    periodKey: '2026-09-09_2026-09-09',
    from: '2026-09-09',
    to: '2026-09-09',
    kind: 'day',
    tomTat: 'Ngày 09/09 đóng hàng 981 đơn, cao hơn hôm qua 9%; đơn vào giảm còn 724 nhưng vẫn quanh trung bình 7 ngày nên chỉ là dao động theo lô.',
    ketLuan: ['991 đơn quá hạn từ 3 ngày còn mở.'],
    viecCanLam: ['Trưởng ca xưởng TN xử lý dứt điểm nhóm đơn quá hạn trong hôm nay.'],
    ruiRo: [],
    diemSang: [],
    soLieu: { in: 724, out: 981, revenue: 4285.88, n2Pct: 98.7, errorRatePct: 1, backlog: 1926, overdue: 991 },
    findings: [],
    model: 'sonnet',
    generatedAt: '2026-09-10T00:01:23.733Z',
    trigger: 'cron',
  }) as unknown as CeoReport;

describe('buildCeoChartSvg', () => {
  it('dựng SVG hợp lệ, đúng khổ, có số cốt lõi', () => {
    const svg = buildCeoChartSvg({ overview: overview(), report: report() });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('width="1000"');
    // Số hiển thị theo kiểu Việt (dấu chấm ngăn nghìn) — chủ tịch đọc bản tiếng Việt.
    expect(svg).toContain('1.926');
    expect(svg).toContain('981');
    expect(svg).toContain('98,7%');
    // Mỗi thẻ mở phải có thẻ đóng: librsvg im lặng bỏ qua SVG hỏng, ảnh ra trắng.
    expect(svg.match(/<text/g)?.length).toBe(svg.match(/<\/text>/g)?.length);
  });

  it('in tóm tắt nhận định khi có, báo rõ khi chưa có', () => {
    expect(buildCeoChartSvg({ overview: overview(), report: report() })).toContain('Nhận định');

    const khong = buildCeoChartSvg({ overview: overview(), report: null });
    expect(khong).toContain('Chưa có nhận định');
  });

  it('không vỡ khi thiếu dữ liệu — kỳ mới, chưa có ngày nào', () => {
    const trong = overview({
      production: { in: 0, out: 0, prevIn: 0, prevOut: 0, daily: [], reference: null, byFactory: [] },
      capacity: { backlog: 0, prevBacklog: 0, avgAgeDays: null, staleOpen: 0, staleDays: 45, byStage: [], history: [] },
      sla: { ...overview().sla, within: [], targets: [] },
    } as unknown as Partial<CeoOverview>);
    const svg = buildCeoChartSvg({ overview: trong, report: null });

    expect(svg).toContain('Chưa có dữ liệu');
    expect(svg).toContain('Chưa có lô đơn đủ tuổi đánh giá');
    // Chia cho 0 lọt ra là ảnh có `NaN`/`Infinity` — librsvg vẽ hỏng, không báo lỗi.
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it('thoát ký tự XML trong nhãn do người nhập', () => {
    const doc = overview({
      capacity: { ...overview().capacity, byStage: [{ stage: '<script>&"x', count: 5 }] },
    } as unknown as Partial<CeoOverview>);

    const svg = buildCeoChartSvg({ overview: doc, report: null });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
