import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ResZod } from '@shared/types';
import { z } from 'zod';

import { IDZod, RefIDZod } from '../constants/common-zod';

/**
 * Cấu hình auto-gán designer — chuỗi ưu tiên 3 mức khi `OrderService.autoAssignAfterImport`
 * chọn designer cho đơn (sau soát tool `toolResultNote` != 'ok' / báo lỗi designer):
 *
 * 1. **Khách hàng → designer** (`customers`): đơn khớp khách (customerMatchKey
 *    userSku+userEmail với bảng `customers`) → gán thẳng designer đó, BẤT KỂ xưởng.
 * 2. **Sản phẩm → designer** (`products`): đơn có `productConfigId` nằm trong cấu
 *    hình → gán thẳng designer đó, BẤT KỂ xưởng.
 * 3. **Theo xưởng** (`factories`): chia cho designer của xưởng theo trọng số,
 *    cân bằng tải thực tế (`allocateByLoad`).
 *
 * Bất biến:
 * - 1 designer chỉ thuộc 1 xưởng (mức 3); 1 khách / 1 sản phẩm chỉ thuộc 1 designer
 *   (mức 1/2) — validate ở BE lúc lưu + FE (kanban 1 card 1 cột).
 * - Trọng số mức 3 tự do (không cần cộng đủ 100); tỉ lệ thực = `weight/Σweight`.
 *
 * Lưu dưới dạng blob JSON trong collection `system_configs` (key bên dưới).
 */
export const DESIGNER_ASSIGNMENT_CONFIG_KEY = 'designer_assignment_config';

/** Ưu tiên 1 — các khách hàng (bảng `customers`) do 1 designer đảm nhận. */
export const DesignerCustomerAllocZod = z.object({
  designerId: IDZod,
  customerIds: RefIDZod.array(),
});
export type DesignerCustomerAlloc = z.infer<typeof DesignerCustomerAllocZod>;

/** Ưu tiên 2 — các sản phẩm (Product Config) do 1 designer đảm nhận. */
export const DesignerProductAllocZod = z.object({
  designerId: IDZod,
  productConfigIds: IDZod.array(),
});
export type DesignerProductAlloc = z.infer<typeof DesignerProductAllocZod>;

export const DesignerAllocEntryZod = z.object({
  designerId: IDZod,
  /** Trọng số nhận task (>= 0). Tỉ lệ thực = weight / tổng weight của xưởng. */
  weight: z.number().min(0),
});
export type DesignerAllocEntry = z.infer<typeof DesignerAllocEntryZod>;

export const DesignerFactoryAllocZod = z.object({
  factoryId: IDZod,
  designers: DesignerAllocEntryZod.array(),
});
export type DesignerFactoryAlloc = z.infer<typeof DesignerFactoryAllocZod>;

export const DesignerAssignmentConfigZod = z.object({
  /** Ưu tiên 1 — khách hàng → designer. Config cũ chưa có field → coi như []. */
  customers: DesignerCustomerAllocZod.array().default([]),
  /** Ưu tiên 2 — sản phẩm → designer. Config cũ chưa có field → coi như []. */
  products: DesignerProductAllocZod.array().default([]),
  /** Ưu tiên 3 — chia theo xưởng (trọng số + cân bằng tải). */
  factories: DesignerFactoryAllocZod.array(),
  /**
   * Hạn hiệu lực mapping sản phẩm→designer (mức 2): `productConfigId → ISO date`.
   * Sản phẩm KHÔNG có entry = vĩnh viễn. Quá hạn → engine bỏ qua + bị prune
   * khỏi `products` khi đọc/lưu config (lazy expiry, không cần cron).
   * Ghi từ nút "Ghi nhớ cấu hình" ở bảng "Cần gán designer" (1 ngày / 7 ngày).
   */
  productExpiries: z.record(z.string()).optional(),
  updatedAt: z.string().optional(),
});
export type DesignerAssignmentConfig = z.infer<typeof DesignerAssignmentConfigZod>;

export class SaveDesignerAssignmentConfigDto extends createZodDto(extendApi(DesignerAssignmentConfigZod)) {}

/**
 * "Ghi nhớ cấu hình" từ bảng "Cần gán designer": gán các sản phẩm cho 1 designer
 * ở mức Ưu tiên 2, kèm hạn hiệu lực. `expiresAt` bỏ trống = vĩnh viễn.
 * Sản phẩm đang thuộc designer khác sẽ bị chuyển sang designer mới (FE cảnh báo).
 */
export const RememberProductAssignmentZod = z.object({
  designerId: IDZod,
  productConfigIds: IDZod.array().min(1),
  /** ISO date — thời điểm hết hạn ghi nhớ. Bỏ trống = vĩnh viễn. */
  expiresAt: z.string().optional(),
});
export type RememberProductAssignment = z.infer<typeof RememberProductAssignmentZod>;
export class RememberProductAssignmentDto extends createZodDto(extendApi(RememberProductAssignmentZod)) {}

export const GetDesignerAssignmentConfigResZod = ResZod.extend({
  data: DesignerAssignmentConfigZod,
});
export class GetDesignerAssignmentConfigResDto extends createZodDto(extendApi(GetDesignerAssignmentConfigResZod)) {}

export const SaveDesignerAssignmentConfigResZod = ResZod.extend({
  data: DesignerAssignmentConfigZod,
});
export class SaveDesignerAssignmentConfigResDto extends createZodDto(extendApi(SaveDesignerAssignmentConfigResZod)) {}
