/**
 * Dựng ảnh báo cáo điều hành — hàm THUẦN: `CeoOverview` (+ nhận định nếu có) → SVG.
 *
 * Vì sao tự vẽ SVG thay vì dùng thư viện chart: ảnh này chỉ có ba loại hình
 * (cột kép, cột ngang, thanh tiến độ) và phải chạy được trên máy chủ prod vốn
 * KHÔNG có trình duyệt. Kéo puppeteer/canvas về chỉ để vẽ mấy hình chữ nhật là
 * thêm ~300 MB phụ thuộc và một lớp hay hỏng khi nâng cấp. SVG viết tay không
 * có phụ thuộc nào, dựng lại y hệt mỗi lần, và `sharp` (đã có sẵn) đổi sang PNG.
 *
 * Vì sao PNG chứ không phải SVG: Telegram và Zalo KHÔNG nhận SVG khi gửi ảnh.
 *
 * **Font**: dùng `DejaVu Sans` — đã kiểm trên prod 10/09/2026, có sẵn trong gói
 * `fonts-dejavu-core` và hiện đúng dấu tiếng Việt. Đổi sang font khác thì phải
 * kiểm lại trên chính máy prod, vì thiếu font là chữ thành ô vuông chứ KHÔNG
 * báo lỗi.
 */
import type { CeoOverview, CeoReport } from 'shared';

const W = 1000;
const H = 720;
const FONT = 'DejaVu Sans, Liberation Sans, sans-serif';

/** Bảng màu lấy từ logo ONOSPOD (SellerPortal.md §4) để ảnh gửi ra ngoài vẫn đúng nhận diện. */
const C = {
  bg: '#ffffff',
  ink: '#1a1420',
  muted: '#6b6472',
  line: '#e6e1ea',
  accent: '#c40c68',
  good: '#2f7a40',
  warn: '#c9a400',
  bad: '#e01008',
  bar1: '#c40c68',
  bar2: '#4a90d9',
  soft: '#f7f4f8',
};

/** Thoát ký tự XML — nhãn có tên khách/sản phẩm do người nhập, không tin được. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Số kiểu Việt: 1.926 — dấu chấm ngăn nghìn. */
function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('vi-VN');
}

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return '$' + Math.round(v).toLocaleString('vi-VN');
}

function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1).replace('.', ',')}%`;
}

/** Chênh lệch so kỳ trước, kèm dấu và màu. `higherIsBetter=false` cho tồn/lỗi. */
function delta(now: number, prev: number, higherIsBetter = true): { text: string; color: string } {
  if (!prev) return { text: '', color: C.muted };
  const d = ((now - prev) / prev) * 100;
  const up = d >= 0;
  const good = higherIsBetter ? up : !up;
  return {
    text: `${up ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%`,
    color: Math.abs(d) < 1 ? C.muted : good ? C.good : C.bad,
  };
}

function text(x: number, y: number, s: string, size: number, fill: string, weight = 'normal', anchor = 'start'): string {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`;
}

function rect(x: number, y: number, w: number, h: number, fill: string, rx = 0): string {
  return `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${fill}" rx="${rx}"/>`;
}

/** Nhãn chặng: khoá kỹ thuật → chữ người đọc được. */
const STAGE_LABEL: Record<string, string> = {
  'tool-check': 'Soát tool',
  designer: 'Thiết kế',
  print: 'In',
  press: 'Ép',
  'qc-post-press': 'QC sau ép',
  'sew-in': 'May vào',
  'sew-out': 'May ra',
  pack: 'Đóng hàng',
};

/** Một ô số lớn ở dải KPI. */
function kpi(x: number, y: number, w: number, label: string, value: string, d?: { text: string; color: string }): string {
  return [
    rect(x, y, w, 96, C.soft, 10),
    text(x + 14, y + 24, label, 11, C.muted),
    text(x + 14, y + 58, value, 24, C.ink, 'bold'),
    // Chênh lệch xuống DÒNG RIÊNG. Đặt cạnh số lớn hay cạnh nhãn đều đè nhau:
    // "$9.623" và nhãn "ĐÚNG HẸN N2" đủ dài để chạm (đã thấy hai lần 10/09/2026).
    d?.text ? text(x + 14, y + 80, `${d.text} so kỳ trước`, 10, d.color) : '',
  ].join('');
}

/** Cột kép đơn vào / đóng hàng theo ngày. */
function dailyChart(x: number, y: number, w: number, h: number, rows: CeoOverview['production']['daily']): string {
  const data = rows.slice(-14);
  const out: string[] = [rect(x, y, w, h, C.bg), text(x, y - 8, 'Đơn vào (hồng) và đóng hàng (xanh) theo ngày', 13, C.ink, 'bold')];
  if (!data.length) return [...out, text(x + w / 2, y + h / 2, 'Chưa có dữ liệu', 13, C.muted, 'normal', 'middle')].join('');

  const max = Math.max(1, ...data.map((r) => Math.max(r.in, r.out)));
  const plotH = h - 26;
  const slot = w / data.length;
  const bw = Math.max(3, Math.min(14, slot / 2 - 3));
  // Lưới ngang + mốc trục: không có mốc thì người xem không đọc được độ lớn.
  const daVe = new Set<string>();
  for (let i = 0; i <= 2; i++) {
    const gy = y + plotH - (plotH * i) / 2;
    out.push(`<line x1="${x}" y1="${gy}" x2="${x + w}" y2="${gy}" stroke="${C.line}" stroke-width="1"/>`);
    // Bỏ mốc trùng: kỳ chưa có đơn nào thì `max` = 1 và ba mốc cùng làm tròn
    // thành "1 / 1 / 0" — nhìn như ảnh hỏng dù số vẫn đúng.
    const nhan = num((max * i) / 2);
    if (daVe.has(nhan)) continue;
    daVe.add(nhan);
    out.push(text(x - 6, gy + 4, nhan, 10, C.muted, 'normal', 'end'));
  }
  data.forEach((r, i) => {
    const cx = x + slot * i + slot / 2;
    const hIn = (r.in / max) * plotH;
    const hOut = (r.out / max) * plotH;
    out.push(rect(cx - bw - 1, y + plotH - hIn, bw, hIn, C.bar1, 2));
    out.push(rect(cx + 1, y + plotH - hOut, bw, hOut, C.bar2, 2));
    // Nhãn ngày dạng dd/MM, cách ngày khi chuỗi dài để chữ không chồng nhau.
    if (data.length <= 8 || i % 2 === 0) {
      out.push(text(cx, y + h - 4, `${r.day.slice(8, 10)}/${r.day.slice(5, 7)}`, 10, C.muted, 'normal', 'middle'));
    }
  });
  return out.join('');
}

/** Cột ngang: tồn theo chặng. */
function stageChart(x: number, y: number, w: number, h: number, rows: CeoOverview['capacity']['byStage']): string {
  const data = [...rows].sort((a, b) => b.count - a.count).slice(0, 8);
  const out: string[] = [text(x, y - 8, 'Tồn theo chặng', 13, C.ink, 'bold')];
  if (!data.length) return [...out, text(x + w / 2, y + h / 2, 'Chưa có dữ liệu', 13, C.muted, 'normal', 'middle')].join('');

  const max = Math.max(1, ...data.map((r) => r.count));
  const rowH = Math.min(26, h / data.length);
  const labelW = 82;
  data.forEach((r, i) => {
    const ry = y + i * rowH;
    const bw = ((w - labelW - 56) * r.count) / max;
    out.push(text(x, ry + rowH / 2 + 4, STAGE_LABEL[r.stage] ?? r.stage, 11, C.muted));
    out.push(rect(x + labelW, ry + 4, bw, rowH - 10, C.bar2, 3));
    out.push(text(x + labelW + bw + 6, ry + rowH / 2 + 4, num(r.count), 11, C.ink, 'bold'));
  });
  return out.join('');
}

/** Thanh tiến độ SLA từng mốc so với chỉ tiêu. */
function slaChart(x: number, y: number, w: number, sla: CeoOverview['sla']): string {
  const out: string[] = [text(x, y - 8, 'Đúng hẹn theo mốc (vạch đen = chỉ tiêu)', 13, C.ink, 'bold')];
  const rows = sla.within.filter((r) => r.n <= 2);
  if (!rows.length) return [...out, text(x, y + 20, 'Chưa có lô đơn đủ tuổi đánh giá', 12, C.muted)].join('');

  rows.forEach((r, i) => {
    const ry = y + i * 30;
    const target = sla.targets.find((t) => t.n === r.n)?.pct ?? null;
    const v = r.pct ?? 0;
    const barW = w - 150;
    const met = target == null ? true : v >= target;
    out.push(text(x, ry + 14, `N${r.n}`, 12, C.muted, 'bold'));
    out.push(rect(x + 30, ry + 3, barW, 15, C.soft, 4));
    out.push(rect(x + 30, ry + 3, (barW * Math.min(100, v)) / 100, 15, met ? C.good : C.warn, 4));
    if (target != null) {
      const tx = x + 30 + (barW * target) / 100;
      out.push(`<line x1="${tx}" y1="${ry}" x2="${tx}" y2="${ry + 21}" stroke="${C.ink}" stroke-width="2"/>`);
    }
    out.push(text(x + 30 + barW + 8, ry + 15, `${pct(r.pct)} · ${num(r.count)} đơn`, 11, C.ink));
  });
  return out.join('');
}

/** Cắt câu dài thành nhiều dòng vừa bề ngang (ước lượng theo số ký tự). */
function wrap(s: string, perLine: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if ((cur + ' ' + word).trim().length > perLine) {
      lines.push(cur.trim());
      cur = word;
      if (lines.length === maxLines) break;
    } else cur = `${cur} ${word}`;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  return lines.slice(0, maxLines);
}

export interface CeoChartInput {
  overview: CeoOverview;
  /** Nhận định hệ thống đã viết cho kỳ; có thì in tóm tắt xuống chân ảnh. */
  report?: CeoReport | null;
}

/** Dựng ảnh báo cáo (SVG). Không ném lỗi — thiếu dữ liệu thì phần đó hiện "Chưa có dữ liệu". */
export function buildCeoChartSvg({ overview: o, report }: CeoChartInput): string {
  const n2 = o.sla.within.find((r) => r.n === 2)?.pct ?? null;
  const ky = o.period.from === o.period.to ? `ngày ${o.period.from}` : `${o.period.from} → ${o.period.to}`;
  const luc = new Date(o.period.generatedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });

  const parts: string[] = [
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>`,
    text(40, 46, 'Báo cáo điều hành OnosFactory', 24, C.ink, 'bold'),
    text(40, 70, `Kỳ ${ky} · số chốt lúc ${luc} (giờ VN)`, 13, C.muted),
    `<line x1="40" y1="86" x2="${W - 40}" y2="86" stroke="${C.line}" stroke-width="1"/>`,
  ];

  // ── Dải KPI: 6 ô ngang ──
  const kw = (W - 80 - 5 * 10) / 6;
  const kpis: Array<[string, string, { text: string; color: string } | undefined]> = [
    ['ĐƠN VÀO', num(o.production.in), delta(o.production.in, o.production.prevIn)],
    ['ĐÓNG HÀNG', num(o.production.out), delta(o.production.out, o.production.prevOut)],
    ['DOANH THU', money(o.revenue.total), delta(o.revenue.total, o.revenue.prev)],
    ['ĐÚNG HẸN N2', pct(n2), n2 != null && o.sla.prevN2Pct != null ? delta(n2, o.sla.prevN2Pct) : undefined],
    ['TỒN', num(o.capacity.backlog), delta(o.capacity.backlog, o.capacity.prevBacklog, false)],
    ['QUÁ HẠN', num(o.sla.overdue.total), undefined],
  ];
  kpis.forEach(([label, value, d], i) => parts.push(kpi(40 + i * (kw + 10), 104, kw, label, value, d)));

  // ── Hai biểu đồ trên ──
  parts.push(dailyChart(70, 230, 540, 170, o.production.daily));
  parts.push(stageChart(650, 230, 310, 170, o.capacity.byStage));

  // ── SLA + chất lượng ──
  parts.push(slaChart(70, 450, 540, o.sla));
  parts.push(text(650, 442, 'Chất lượng & khách hàng', 13, C.ink, 'bold'));
  const q: Array<[string, string]> = [
    ['Tỉ lệ đơn lỗi', pct(o.quality.ratePct)],
    ['Đơn có lỗi', num(o.quality.errored)],
    ['Khách hoạt động', num(o.customers.active)],
    ['Đơn treo quá lâu', num(o.capacity.staleOpen)],
  ];
  q.forEach(([k, v], i) => {
    parts.push(text(650, 468 + i * 22, k, 11, C.muted));
    parts.push(text(960, 468 + i * 22, v, 12, C.ink, 'bold', 'end'));
  });

  // ── Chân ảnh: tóm tắt + việc cần làm gấp nhất ──
  parts.push(`<line x1="40" y1="576" x2="${W - 40}" y2="576" stroke="${C.line}" stroke-width="1"/>`);
  if (report?.tomTat) {
    parts.push(text(40, 600, 'Nhận định', 12, C.accent, 'bold'));
    wrap(report.tomTat, 118, 3).forEach((l, i) => parts.push(text(40, 622 + i * 19, l, 13, C.ink)));
    const viec = report.viecCanLam?.[0];
    if (viec) {
      parts.push(text(40, 692, 'Cần làm ngay', 12, C.accent, 'bold'));
      parts.push(text(150, 692, wrap(viec, 100, 1)[0] ?? '', 12, C.ink));
    }
  } else {
    parts.push(text(40, 606, 'Chưa có nhận định cho kỳ này — ảnh chỉ gồm số liệu.', 13, C.muted));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

export const CEO_CHART_SIZE = { width: W, height: H };
