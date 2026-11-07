import { OrderPriority } from 'shared';

import { formatVnDateTime, REPORT_DAY_COUNT, SLA_DAY_COUNT, SLA_TARGETS } from '../../scheduled-reports/build-period';
import { supportHoldLine } from '../../scheduled-reports/support-hold';
import type { ReportDayStats, SlaCohortRow } from '../../scheduled-reports/types';
import type { DailyOrdersReportNotification } from '../types';
import { clamp, escapeMd } from './_helpers';

const PRIORITY_EMOJI: Record<OrderPriority, string> = {
  [OrderPriority.High]: '🔴',
  [OrderPriority.Normal]: '🟠',
  [OrderPriority.Low]: '🔵',
};

/** Mức cao → thấp, khớp sort của `getPriorityCustomers()`. */
const PRIORITY_ORDER: OrderPriority[] = [OrderPriority.High, OrderPriority.Normal, OrderPriority.Low];

/**
 * Phễu vòng đời đơn **xoay ngang** (chặng = HÀNG, ngày = CỘT) → bảng gọn
 * (Chặng + N ngày), vừa 1 dòng trên điện thoại, không bị wrap. Đọc dọc:
 * Tổng → Soát → Thiết kế → In/Ép/QC → May → Đóng → Hoàn thành. Nhãn hàng đầy đủ
 * nên không cần legend. Tồn 6 chặng cộng lại = Tổng.
 */
const FUNNEL_ROWS: { label: string; get: (d: ReportDayStats) => number | string }[] = [
  { label: 'Tổng', get: (d) => d.total },
  { label: 'Soát', get: (d) => d.soat },
  { label: 'Thiết kế', get: (d) => d.design },
  { label: 'In/Ép/QC', get: (d) => d.inPressQc },
  { label: 'May vào/ra', get: (d) => d.sew },
  { label: 'Đóng hàng', get: (d) => d.pack },
  { label: 'Hoàn thành', get: (d) => d.stockOut },
  { label: '% ≤2 ngày', get: (d) => (d.total > 0 ? `${Math.round((d.completedWithin2d / d.total) * 100)}%` : '-') },
];

/** Bảng phễu xoay ngang cho 1 tập ngày (view chính = N ngày; khách = ngày có đơn). */
function funnelTable(days: ReportDayStats[]): string[] {
  const header = ['Chặng', ...days.map((d) => d.label)];
  const rows = FUNNEL_ROWS.map((r) => [r.label, ...days.map((d) => r.get(d))]);

  return table(header, rows);
}

/** Nhãn môi trường đầu message — phân biệt báo cáo từ dev hay production. */
function envBanner(isProduction: boolean): string {
  return isProduction ? '🟢 *PROD*' : '🧪 *DEV*';
}

/**
 * Section "SLA sản xuất" — mỗi lô ngày SX 1 dòng, % TỪNG MỐC RỜI NHAU theo
 * NGÀY LỊCH VN: `N0 + N1 + N2 + N3+ + Còn = 100%` (N3+ gộp xong-từ-N3-trở-đi;
 * cột cộng ngang được — bài học từ bản % cộng dồn cũ khiến người đọc cộng
 * ngang ra >100%). Mốc lô chưa sống tới hiện `—`, mốc = 0 hiện `-`. Tổng bề
 * ngang ~33 ký tự — vừa 1 dòng điện thoại (Telegram mobile VẪN wrap trong
 * code block nếu rộng hơn, đã dính ở bản gap-2-space). Dưới bảng: bảng
 * "🚨 TỒN SAU HẠN N2" — mỗi lô đến hạn/quá hạn 1 dòng, cột = chặng đang kẹt
 * (Soát+Thiết kế gộp cột TK cho hẹp). Chỉ tiêu `SLA_TARGETS` chỉ nêu ở tiêu
 * đề (theo nghĩa cộng dồn) — không gắn cờ vào ô để bảng sạch. Kết section
 * bằng 1 dòng trống ngăn với section khách ưu tiên.
 */
function slaSection(slaDays: SlaCohortRow[]): string[] {
  const pct = (num: number, total: number) => `${Math.round((num / total) * 100)}%`;
  // Ô % 1 mốc: lô chưa sống tới mốc → '—' (khác '-' = mốc đã qua nhưng 0 đơn).
  const bucketCell = (d: SlaCohortRow, n: number, count: number): string => {
    if (d.total === 0) return '-';
    if (d.ageDays < n) return '—';

    return count === 0 ? '-' : pct(count, d.total);
  };

  const targetLabel = SLA_TARGETS.map((t) => `N${t.n}≥${t.pct}`).join('·');
  const lines: string[] = [];
  lines.push(`⏱ *SLA SẢN XUẤT · ${SLA_DAY_COUNT} NGÀY*`);
  lines.push(
    ...table(
      ['Ngày', 'Tổng', 'N0', 'N1', 'N2', 'N3+', 'Còn'],
      slaDays.map((d) => [
        d.label,
        d.total,
        bucketCell(d, 0, d.doneN0),
        bucketCell(d, 1, d.doneN1),
        bucketCell(d, 2, d.doneN2),
        bucketCell(d, 3, d.doneN3 + d.doneLate),
        d.total === 0 || d.notDone === 0 ? '-' : pct(d.notDone, d.total),
      ]),
    ),
  );

  // Bảng tồn sau hạn N2: lô đã đến hạn (age ≥ 2) còn đơn chưa xong — kẹt ở chặng nào.
  const overdue = slaDays.filter((d) => d.total > 0 && d.notDone > 0 && d.ageDays >= 2);
  if (overdue.length > 0) {
    lines.push('🚨 *TỒN SAU HẠN N2* — kẹt ở:');
    lines.push(
      ...table(
        ['Ngày', 'Hạn', 'Còn', 'TK', 'IÉQ', 'May', 'Đóng'],
        overdue.map((d) => [
          d.label,
          d.ageDays === 2 ? 'NAY' : 'QUÁ',
          d.notDone,
          d.stuckSoat + d.stuckDesign,
          d.stuckInPressQc,
          d.stuckSew,
          d.stuckPack,
        ]),
      ),
    );
    lines.push('_TK=soát tool+thiết kế · IÉQ=In/Ép/QC · NAY=hạn N2 là hôm nay_');
  }
  lines.push('');

  return lines;
}

/**
 * Bảng canh cột monospace (```code```): cột đầu canh trái, các cột số canh
 * phải → số thẳng hàng dọc, dễ soi. Telegram cuộn ngang trong block nếu rộng
 * (KHÔNG vỡ dòng như text thường — bài học Phase 2.1).
 *
 * `RIGHT_PAD` = 3 space đuôi mỗi dòng: chừa chỗ cho nút `</>` mà Telegram vẽ
 * đè góc phải-trên code block, khỏi che mất tiêu đề cột cuối ("Tồn").
 *
 * Bảng hẹp hơn `TABLE_TARGET_WIDTH` được GIÃN ĐỀU khoảng cách cột cho mọi
 * bảng bằng nhau, chiếm trọn bề ngang màn điện thoại. KHÔNG đặt target cao
 * hơn — Telegram mobile wrap trong code block khi dòng dài hơn ~35 ký tự
 * (bài học bản gap-2-space).
 */
const TABLE_TARGET_WIDTH = 34;

function table(header: string[], rows: (string | number)[][], leftCols = 1): string[] {
  const RIGHT_PAD = '   ';
  // Số 0 → "-" cho đỡ nhiễu mắt (chỉ ô số; ô nhãn giữ nguyên).
  const cellStr = (v: string | number) => (typeof v === 'number' && v === 0 ? '-' : String(v));
  const cells = [header, ...rows.map((r) => r.map(cellStr))];
  const widths = header.map((_, c) => Math.max(...cells.map((row) => (row[c] ?? '').length)));
  // Giãn đều: cộng thêm space vào từng khoảng cách cột (xoay vòng) tới target.
  const gaps = new Array(Math.max(header.length - 1, 0)).fill(1);
  let lineWidth = widths.reduce((a, b) => a + b, 0) + gaps.length + RIGHT_PAD.length;
  for (let i = 0; lineWidth < TABLE_TARGET_WIDTH && gaps.length > 0; i = (i + 1) % gaps.length) {
    gaps[i]++;
    lineWidth++;
  }
  const fmt = (row: string[]) =>
    row.reduce((acc, cell, c) => {
      const padded = c < leftCols ? cell.padEnd(widths[c]) : cell.padStart(widths[c]);

      return acc + (c > 0 ? ' '.repeat(gaps[c - 1]) : '') + padded;
    }, '') + RIGHT_PAD;

  return ['```', ...cells.map(fmt), '```'];
}

/** Cắt gọn + bỏ ký tự phá code block (`` ` ``/newline) cho ô tên trong bảng. */
function fit(s: string, n: number): string {
  const clean = (s || '').replace(/[`\n]/g, '');

  return clean.length <= n ? clean : `${clean.slice(0, n - 1)}…`;
}

/**
 * Bảng "tồn sau hạn N2 theo xưởng" — ma trận NGÀY × XƯỞNG: mỗi lô đã đến hạn
 * 1 dòng (tồn của từng xưởng trong lô đó), chốt 2 dòng Tổng + % (tỷ trọng
 * trên tổng tồn quá hạn toàn hệ thống). `byDay[i]` khớp `slaDays[i]` (các lô
 * đã đến hạn = mọi lô trừ 2 lô cuối — cùng quy ước `aggregateSla`).
 */
function slaFactoryTable(
  slaDays: SlaCohortRow[],
  rows: DailyOrdersReportNotification['data']['slaFactories'],
): string[] {
  const grand = rows.reduce((s, r) => s + r.total, 0);
  if (rows.length === 0 || grand === 0) return [];

  const dayCount = rows[0].byDay.length;
  const labels = slaDays.slice(0, dayCount).map((d) => d.label);
  const body: (string | number)[][] = labels.map((label, i) => [
    label,
    ...rows.map((r) => r.byDay[i]),
    rows.reduce((s, r) => s + r.byDay[i], 0),
  ]);
  body.push(['Tổng', ...rows.map((r) => r.total), grand]);
  body.push(['%', ...rows.map((r) => `${Math.round((r.total / grand) * 100)}%`), '100%']);

  return ['🏭 *TỒN SAU HẠN N2 THEO XƯỞNG*', ...table(['Ngày', ...rows.map((r) => fit(r.name, 7)), 'Tổng'], body)];
}

/**
 * View chính (cron + nút 🔄) — CHỈ tập trung SLA: bảng SLA 7 ngày làm việc +
 * tồn sau hạn N2 + tồn theo xưởng. Phễu vòng đời + khách ưu tiên dời sang nút
 * "📋 Chi tiết" (`formatDetailReport`). `factoryName` có (nút "🏭 <tên>") =
 * chi tiết 1 xưởng: phễu + SLA cùng lọc theo xưởng đó.
 */
export function formatDailyOrdersReport(payload: DailyOrdersReportNotification, factoryName?: string): string {
  const { data, generatedAt } = payload;
  const lines: string[] = [];

  lines.push(envBanner(payload.isProduction));
  if (factoryName) {
    lines.push(
      `🏭 *XƯỞNG ${escapeMd(factoryName)} · ${REPORT_DAY_COUNT} NGÀY* · 🕐 _${formatVnDateTime(generatedAt)}_`,
    );
    lines.push(...funnelTable(data.days));
    lines.push(...slaSection(data.slaDays));
  } else {
    lines.push(`📊 *BÁO CÁO SLA SẢN XUẤT* · 🕐 _${formatVnDateTime(generatedAt)}_`);
    lines.push(...slaSection(data.slaDays));
    lines.push(...slaFactoryTable(data.slaDays, data.slaFactories));
    const holdLine = supportHoldLine(data.supportHold);
    if (holdLine) lines.push('', holdLine);
  }

  return clamp(lines.join('\n'));
}

/**
 * View "📋 Chi tiết" — phễu vòng đời `REPORT_DAY_COUNT` ngày + section khách
 * ưu tiên (nguyên trạng view chính CŨ trước khi view chính chuyển sang SLA-only).
 */
export function formatDetailReport(payload: DailyOrdersReportNotification): string {
  const { data, generatedAt } = payload;
  const lines: string[] = [];

  lines.push(envBanner(payload.isProduction));
  lines.push(`📋 *CHI TIẾT ĐƠN · ${REPORT_DAY_COUNT} NGÀY* · 🕐 _${formatVnDateTime(generatedAt)}_`);
  lines.push(...funnelTable(data.days));

  for (const level of PRIORITY_ORDER) {
    for (const r of data.priorityRows.filter((c) => c.priority === level)) {
      const sku = escapeMd(r.userSku || r.userEmail || '?');
      const activeDays = r.days.filter((d) => d.total > 0);
      if (activeDays.length === 0) {
        lines.push(`${PRIORITY_EMOJI[level]} *${sku}* — _không có đơn_`);
        continue;
      }
      lines.push(`${PRIORITY_EMOJI[level]} *${sku}*`);
      lines.push(...funnelTable(activeDays));
    }
  }

  return clamp(lines.join('\n'));
}

/** View "Theo designer" — mỗi ngày 1 bảng (tên viết tắt canh trái + 4 trạng thái). */
export function formatDesignerViewReport(payload: DailyOrdersReportNotification): string {
  const { data, generatedAt } = payload;
  const lines: string[] = [];

  lines.push(envBanner(payload.isProduction));
  lines.push(`👤 *BÁO CÁO DESIGNER · ${REPORT_DAY_COUNT} NGÀY* · 🕐 _${formatVnDateTime(generatedAt)}_`);

  for (const day of data.designerDays) {
    const suffix = day.unassignedNeed > 0 ? ` · 🚨 chưa gán *${day.unassignedNeed}*` : '';
    lines.push(`📅 *${day.label}*${suffix}`);
    if (day.rows.length === 0) {
      lines.push('_không có task_');
    } else {
      const sum = (k: 'errorCount' | 'done' | 'inProgress' | 'rework' | 'needAction') =>
        day.rows.reduce((s, r) => s + r[k], 0);
      const rows = day.rows.map((r) => [
        fit(r.fullName, 12),
        r.errorCount,
        r.done,
        r.inProgress,
        r.rework,
        r.needAction,
      ]);
      rows.push(['Tổng', sum('errorCount'), sum('done'), sum('inProgress'), sum('rework'), sum('needAction')]);
      lines.push(...table(['Designer', 'Lỗi', 'Xong', 'ĐL', 'LL', 'CL'], rows));
    }
  }

  lines.push('_Lỗi=đơn từng soát lỗi · Xong=TK xong · ĐL=đang làm · LL=làm lại · CL=cần làm_');

  return clamp(lines.join('\n'));
}

/** Các hàng bảng Soát tool (xoay ngang: chỉ số = hàng, ngày = cột) — mirror "Tổng quan theo ngày" tab Soát tool. */
const TOOLCHECK_ROWS: {
  label: string;
  get: (d: DailyOrdersReportNotification['data']['toolCheckDays'][number]) => number;
}[] = [
  { label: 'Tổng đơn', get: (d) => d.total },
  { label: 'Chưa soát', get: (d) => d.unreviewed },
  { label: 'Đã soát', get: (d) => d.reviewed },
  { label: 'Note ko ok', get: (d) => d.noteNotOk },
  { label: 'Soát OK', get: (d) => d.reviewedOk },
  { label: 'Cần làm lại', get: (d) => d.rework },
];

/** View "Soát tool" — xoay ngang, chỉ số soát tool theo từng ngày. */
export function formatToolCheckReport(payload: DailyOrdersReportNotification): string {
  const { data, generatedAt } = payload;
  const lines: string[] = [];

  lines.push(envBanner(payload.isProduction));
  lines.push(`🔍 *BÁO CÁO SOÁT TOOL · ${REPORT_DAY_COUNT} NGÀY* · 🕐 _${formatVnDateTime(generatedAt)}_`);

  const header = ['Chỉ số', ...data.toolCheckDays.map((d) => d.label)];
  const rows = TOOLCHECK_ROWS.map((r) => [r.label, ...data.toolCheckDays.map((d) => r.get(d))]);
  lines.push(...table(header, rows));

  return clamp(lines.join('\n'));
}
