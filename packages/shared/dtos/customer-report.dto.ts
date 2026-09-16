import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { z } from 'zod';

import { IDZod } from '../constants';

/**
 * Báo cáo KHÁCH HÀNG cho agent — song song với `ceo-report`.
 *
 * Tên trường bằng tiếng Anh theo đúng đặc tả bên tiêu thụ (agent) đưa sang, còn
 * mọi phần CHỮ là tiếng Việt viết sẵn để agent đọc thẳng cho Chủ tịch, không
 * phải diễn giải lại. Khác quy ước tiếng Việt của `ceo-report` (`tomTat`,
 * `ketLuan`…) — cố ý giữ nguyên hợp đồng bên gọi đã thống nhất, chứ không đổi
 * một endpoint đang chạy.
 */

/** Ngưỡng nhận diện tăng/giảm bất thường — CỐ ĐỊNH để hai lần chạy cho cùng kết quả. */
export const CUSTOMER_REPORT_RULES = {
  /** Kỳ trước phải đạt mức này mới xét là "tụt" — khách 2 đơn còn 1 không phải tin tức. */
  decliningMinPrev: 20,
  /** Giảm từ mức này trở lên (%) mới tính là tụt mạnh. */
  decliningDropPct: 50,
  /** Kỳ này phải đạt mức này mới xét là "tăng đột biến". */
  surgingMinNow: 20,
  /** Tăng từ mức này trở lên (%). */
  surgingRisePct: 100,
} as const;

export const CustomerReportRowZod = z.object({
  userSku: z.string(),
  /** Tên người liên hệ lấy từ danh tính Zalo đã duyệt; rỗng khi chưa nối. */
  customerName: z.string().optional(),
  tier: z.number().nullable().optional(),
  orders: z.number(),
  ordersPrev: z.number(),
  /** `null` khi kỳ trước bằng 0 — không chia được, đừng hiện "∞%". */
  changePct: z.number().nullable(),
});
export type CustomerReportRow = z.infer<typeof CustomerReportRowZod>;

export const CustomerReportIssueZod = z.object({
  userSku: z.string(),
  customerName: z.string().optional(),
  /** `gap` = gấp, `can-chu-y` = cần chú ý — lấy nguyên `mucDo` của bản tóm tắt nhóm. */
  severity: z.string(),
  issue: z.string(),
  /** Số ngày việc cũ nhất chưa xong còn treo; rỗng khi checklist trống. */
  pendingDays: z.number().optional(),
});
export type CustomerReportIssue = z.infer<typeof CustomerReportIssueZod>;

export const CustomerReportFindingZod = z.object({
  code: z.string(),
  severity: z.enum(['critical', 'warning', 'good', 'info']),
  params: z.record(z.unknown()),
  action: z.string().optional(),
});

export const CustomerReportZod = z.object({
  _id: IDZod,
  periodKey: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.string(),
  /** Đoạn văn gửi Chủ tịch — agent trích NGUYÊN VĂN. */
  summary: z.string(),
  metrics: z.object({
    activeCustomers: z.number(),
    activeCustomersPrev: z.number(),
    totalOrders: z.number(),
    totalOrdersPrev: z.number(),
    changePct: z.number().nullable(),
    newCustomerCount: z.number(),
    churnRiskCount: z.number(),
  }),
  topCustomers: CustomerReportRowZod.array(),
  surging: CustomerReportRowZod.array(),
  declining: CustomerReportRowZod.array(),
  newCustomers: CustomerReportRowZod.array(),
  customerIssues: CustomerReportIssueZod.array(),
  conclusions: z.string().array(),
  actionItems: z.string().array(),
  findings: CustomerReportFindingZod.array(),
  generatedAt: z.string(),
  trigger: z.string(),
});
export type CustomerReport = z.infer<typeof CustomerReportZod>;

export const GetCustomerReportResZod = z.object({
  success: z.literal(true),
  data: z.object({ report: CustomerReportZod.nullable(), generating: z.boolean() }),
});
export class GetCustomerReportResDto extends createZodDto(extendApi(GetCustomerReportResZod)) {}
