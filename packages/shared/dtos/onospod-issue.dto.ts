import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ResZod } from '@shared/types';
import { z } from 'zod';

// ─── Báo lỗi file cho khách qua OnosPod (Orders.md §9f) ─────────────────────
// Nút "Báo khách" (Admin) ở menu "..." từng đơn = nút "Send Issue" màn
// qc.onospod.com/en/workflow/support: tạo 1 issue `DESIGN` trên dòng sản xuất
// OnosPod, seller thấy ở mục "Issue Orders" của seller.onospod.com và up lại
// file → issue chuyển `NEED_TO_CHECK`.

/** Trạng thái issue phía OnosPod (`OrderIssueStatus`). */
export const ONOSPOD_ISSUE_STATUSES = ['OPEN', 'NEED_TO_CHECK', 'RESOLVED', 'CLOSED'] as const;
export type OnospodIssueStatus = (typeof ONOSPOD_ISSUE_STATUSES)[number];

/** Ghi chú gửi kèm — giới hạn để khách đọc được trong hộp issue OnosPod. */
export const ONOSPOD_ISSUE_DESCRIPTION_MAX = 2000;

export const CreateOnospodIssueZod = z.object({
  description: z.string().trim().min(1).max(ONOSPOD_ISSUE_DESCRIPTION_MAX),
});
export type CreateOnospodIssue = z.infer<typeof CreateOnospodIssueZod>;
export class CreateOnospodIssueDto extends createZodDto(extendApi(CreateOnospodIssueZod)) {}

export const OnospodIssueZod = z.object({
  /** `_id` issue bên OnosPod. */
  id: z.string(),
  code: z.string(),
  /** Giữ string (không enum) — OnosPod thêm trạng thái mới thì FE vẫn hiện được. */
  status: z.string(),
  description: z.string(),
  createdAt: z.string().nullable(),
  fileUrls: z.array(z.string()),
});
export type OnospodIssue = z.infer<typeof OnospodIssueZod>;

export const CreateOnospodIssueResZod = ResZod.extend({ data: OnospodIssueZod });
export class CreateOnospodIssueResDto extends createZodDto(extendApi(CreateOnospodIssueResZod)) {}

export const GetOnospodIssuesResZod = ResZod.extend({ data: z.array(OnospodIssueZod) });
export class GetOnospodIssuesResDto extends createZodDto(extendApi(GetOnospodIssuesResZod)) {}
