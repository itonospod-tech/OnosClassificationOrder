import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { BaseEntityZod, PageQueryZod, PageResZod } from '@shared/types';
import { z } from 'zod';

export const ORDER_LOG_ACTIONS = [
  'create',
  'update',
  'delete',
  'import',
  'bulk_update',
  'transfer',
  'cancel',
  'update_design',
  'hold',
  'unhold',
  /** SuperAdmin ép đơn về "đã hoàn thành sản xuất" — xem `Orders.md §23`. */
  'force_complete',
  /** Undo of a mistaken bulk edit: the field rewound to its value before the incident (Orders.md §27). */
  'restore',
  /**
   * Đẩy đơn NGƯỢC chặng (rework-back) ở luồng fulfillment. Tách khỏi `update`
   * để nhật ký nói rõ "đẩy về công đoạn nào, vì lý do gì" — trước đây thao tác
   * này chỉ để lại 1 dòng đổi status trông y hệt thay đổi thường.
   * `field` = stage đích, `before` = stage đã báo lỗi, `after` = lý do.
   */
  'rework_back',
] as const;
export type ProductionOrderLogAction = (typeof ORDER_LOG_ACTIONS)[number];
export const ProductionOrderLogActionZod = z.enum(ORDER_LOG_ACTIONS);

export const ProductionOrderLogZod = BaseEntityZod.extend({
  orderId: z.string().min(1),
  userId: z.string().optional(),
  userName: z.string().optional(), // snapshot fullName
  userEmail: z.string().optional(), // snapshot email
  roleCode: z.string().optional(), // snapshot role.name
  /**
   * AUTH-1 AC-06 — SuperAdmin THẬT khi thay đổi phát sinh trong phiên mạo danh.
   * `userId`/`userName` vẫn là người bị mạo danh (danh tính hiệu lực trong
   * phiên), 2 field này mới cho biết ai thực sự ngồi gõ. Rỗng ở phiên thường.
   */
  impersonatorId: z.string().optional(),
  impersonatorName: z.string().optional(),
  action: ProductionOrderLogActionZod,
  field: z.string().optional(), // field name khi action = update/bulk_update
  before: z.any().optional(),
  after: z.any().optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
});
export type ProductionOrderLog = z.infer<typeof ProductionOrderLogZod>;

//
export const GetOrderLogsZod = PageQueryZod.extend({
  action: ProductionOrderLogActionZod.optional(),
  field: z.string().optional(),
});
export class GetOrderLogsDto extends createZodDto(extendApi(GetOrderLogsZod)) {}

export const GetOrderLogsResZod = PageResZod.extend({ data: ProductionOrderLogZod.array() });
export class GetOrderLogsResDto extends createZodDto(extendApi(GetOrderLogsResZod)) {}
