import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { z } from 'zod';

import { PRODUCT_LINES } from '../enums/product-line';

/**
 * CEO Dashboard — `GET /v1/ceo/overview?from&to` (CeoDashboard.md). Một phản hồi gom
 * 7 khối cho lãnh đạo; MỌI số là tổng hợp máy chủ (không tính ở FE) và là "sự thật
 * chung" để Agent báo cáo cùng số. Kỳ so sánh = kỳ liền trước cùng độ dài.
 * Tiền = `orders.baseCost` (+ `shipCost`) của đơn sản xuất — "giá trị đơn theo base
 * cost", KHÔNG phải doanh thu kế toán (giá chốt phía khách chưa đủ dữ liệu).
 */
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CeoOverviewQueryZod = z.object({
  /** Ngày vào sản xuất từ (yyyy-mm-dd, giờ VN). */
  from: DateStr,
  /** Đến hết ngày (yyyy-mm-dd, giờ VN). Tối đa 92 ngày. */
  to: DateStr,
  /** PRD-8 — chỉ đơn thuộc dòng sản phẩm này (tab dịch vụ ở Seller Hub Operations). Bỏ trống = toàn bộ. */
  productLine: z.enum(PRODUCT_LINES).optional(),
});
export class CeoOverviewQueryDto extends createZodDto(extendApi(CeoOverviewQueryZod)) {}

export const CEO_FINDING_SEVERITIES = ['critical', 'warning', 'good', 'info'] as const;
export type CeoFindingSeverity = (typeof CEO_FINDING_SEVERITIES)[number];

/** Kết luận sinh theo luật — FE dịch `code` thành câu, `params` điền vào câu, `action` = mã việc cần làm. */
export const CeoFindingZod = z.object({
  code: z.string(),
  severity: z.enum(CEO_FINDING_SEVERITIES),
  params: z.record(z.union([z.string(), z.number()])).default({}),
  action: z.string().optional(),
});

const DayRow = z.object({ day: DateStr, in: z.number(), out: z.number(), revenue: z.number(), errors: z.number() });
const FactoryRow = z.object({
  factoryId: z.string(),
  shortName: z.string().optional(),
  name: z.string().optional(),
  in: z.number(),
  out: z.number(),
  backlog: z.number(),
  revenue: z.number(),
  errored: z.number(),
  /** % đơn đủ tuổi (≥2 ngày) đã ra trong N2. null khi chưa có đơn đủ tuổi. */
  n2Pct: z.number().nullable(),
  outPerDay: z.number(),
  daysToClear: z.number().nullable(),
});

export const CeoOverviewZod = z.object({
  period: z.object({
    from: DateStr,
    to: DateStr,
    days: z.number(),
    prevFrom: DateStr,
    prevTo: DateStr,
    /** Kỳ so sánh chính luôn là kỳ liền trước cùng độ dài (`previous`); kỳ 1 ngày = hôm qua, kèm `production.reference`. */
    compareMode: z.enum(['same-weekday', 'previous']),
    /** Thứ trong tuần VN của ngày `from` (0=CN..6=T7) — để FE/agent nhận biết cuối tuần. */
    weekday: z.number(),
    generatedAt: z.string(),
    cached: z.boolean(),
  }),
  production: z.object({
    in: z.number(),
    out: z.number(),
    prevIn: z.number(),
    prevOut: z.number(),
    /** Chuỗi ngày phủ CẢ kỳ trước + kỳ này (cũ → mới); kỳ 1 ngày phủ 7 ngày trước + hôm nay. */
    daily: z.array(DayRow),
    /** CHỈ kỳ 1 ngày: tham chiếu nhịp — cùng thứ tuần trước và trung bình 7 ngày liền trước (D−7..D−1). */
    reference: z
      .object({
        sameWeekday: z.object({ day: DateStr, in: z.number(), out: z.number(), revenue: z.number() }),
        avg7: z.object({ in: z.number(), out: z.number(), revenue: z.number() }),
      })
      .nullable(),
    byFactory: z.array(FactoryRow),
  }),
  revenue: z.object({
    total: z.number(),
    prev: z.number(),
    ship: z.number(),
    avgPerOrder: z.number(),
    prevAvgPerOrder: z.number(),
    currency: z.literal('USD'),
    basis: z.literal('baseCost'),
  }),
  sla: z.object({
    targets: z.array(z.object({ n: z.number(), pct: z.number() })),
    /** Lô đơn được đánh giá: kỳ ≥2 ngày = chính kỳ; kỳ 1 ngày = lô vào ngày D−2 (đã đủ tuổi N2). */
    cohortFrom: DateStr,
    cohortTo: DateStr,
    /** Đơn kỳ này đã đủ tuổi đánh giá N2 (vào SX ≥ 2 ngày trước). */
    mature: z.number(),
    within: z.array(z.object({ n: z.number(), count: z.number(), pct: z.number().nullable() })),
    prevN2Pct: z.number().nullable(),
    dailyN2: z.array(z.object({ day: DateStr, total: z.number(), pct: z.number().nullable() })),
    overdue: z.object({
      total: z.number(),
      byFactory: z.array(z.object({ factoryId: z.string(), shortName: z.string().optional(), count: z.number() })),
      sample: z.array(
        z.object({
          productionId: z.string(),
          userSku: z.string().optional(),
          factory: z.string().optional(),
          stage: z.string(),
          ageDays: z.number(),
        }),
      ),
    }),
  }),
  quality: z.object({
    errored: z.number(),
    ratePct: z.number().nullable(),
    prevRatePct: z.number().nullable(),
    bySource: z.array(z.object({ source: z.string(), count: z.number() })),
    topTypes: z.array(z.object({ type: z.string(), count: z.number(), total: z.number() })),
  }),
  customers: z.object({
    active: z.number(),
    prevActive: z.number(),
    newCount: z.number(),
    top10SharePct: z.number().nullable(),
    top: z.array(
      z.object({
        userSku: z.string(),
        orders: z.number(),
        prevOrders: z.number(),
        revenue: z.number(),
        tier: z.number().nullable(),
        held: z.number(),
        errored: z.number(),
      }),
    ),
    rising: z.array(z.object({ userSku: z.string(), orders: z.number(), prevOrders: z.number() })),
    dropping: z.array(z.object({ userSku: z.string(), orders: z.number(), prevOrders: z.number() })),
  }),
  capacity: z.object({
    /** Tồn HOẠT ĐỘNG: đơn chưa đóng hàng vào SX trong `staleDays` ngày gần đây. */
    backlog: z.number(),
    prevBacklog: z.number(),
    avgAgeDays: z.number().nullable(),
    /** Đơn còn mở nhưng vào SX quá `staleDays` ngày — coi là nợ dữ liệu/đơn treo, KHÔNG tính vào tồn/quá hạn. */
    staleOpen: z.number(),
    staleDays: z.number(),
    byStage: z.array(z.object({ stage: z.string(), count: z.number() })),
    history: z.array(z.object({ day: DateStr, backlog: z.number() })),
  }),
  people: z.object({
    designers: z.array(z.object({ userId: z.string(), name: z.string(), done: z.number(), backlog: z.number(), rework: z.number() })),
    workers: z.array(z.object({ userId: z.string(), name: z.string(), stage: z.string(), done: z.number() })),
  }),
  findings: z.array(CeoFindingZod),
});
export type CeoOverview = z.infer<typeof CeoOverviewZod>;
export type CeoFinding = z.infer<typeof CeoFindingZod>;

export const CeoOverviewResZod = z.object({ success: z.literal(true), data: CeoOverviewZod });
export class CeoOverviewResDto extends createZodDto(extendApi(CeoOverviewResZod)) {}

// ── Nhận định của hệ thống (Agent SDK viết từ chính `CeoOverview`) ──────────
export const CEO_REPORT_KINDS = ['day', 'week', 'month', 'custom'] as const;
export type CeoReportKind = (typeof CEO_REPORT_KINDS)[number];

/** Một bản nhận định cho một kỳ — lưu `ceo_reports`, bản mới nhất theo `periodKey` là bản hiển thị. */
export const CeoReportZod = z.object({
  _id: z.string(),
  periodKey: z.string(),
  from: DateStr,
  to: DateStr,
  kind: z.enum(CEO_REPORT_KINDS),
  /** 2–3 câu tóm tắt kỳ — tiếng Việt, có số. */
  tomTat: z.string(),
  ketLuan: z.array(z.string()),
  viecCanLam: z.array(z.string()),
  ruiRo: z.array(z.string()),
  diemSang: z.array(z.string()),
  /** Số cốt lõi lúc sinh — để agent/Telegram trích cùng số với bản nhận định. */
  soLieu: z.object({
    in: z.number(),
    out: z.number(),
    revenue: z.number(),
    n2Pct: z.number().nullable(),
    errorRatePct: z.number().nullable(),
    backlog: z.number(),
    overdue: z.number(),
  }),
  findings: z.array(CeoFindingZod),
  model: z.string(),
  generatedAt: z.string(),
  /** 'cron' | 'manual' — ai kích hoạt. */
  trigger: z.string(),
});
export type CeoReport = z.infer<typeof CeoReportZod>;

export const CeoReportResZod = z.object({
  success: z.literal(true),
  data: z.object({ report: CeoReportZod.nullable(), generating: z.boolean() }),
});
export class CeoReportResDto extends createZodDto(extendApi(CeoReportResZod)) {}

export const CeoReportGenerateZod = CeoOverviewQueryZod;
export class CeoReportGenerateDto extends createZodDto(extendApi(CeoReportGenerateZod)) {}
