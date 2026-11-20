import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { isSystemOnlyPriority } from '@shared/enums';
import { ResZod } from '@shared/types';
import { z } from 'zod';

import { IDZod, RefIDZod } from '../constants/common-zod';
import { OrderPriorityZod } from './production-order.dto';

/**
 * Cấu hình **ưu tiên gán xưởng theo khách hàng** (cao hơn product config).
 *
 * - `enabled` **false** → import lấy xưởng theo product config như bình thường.
 * - `enabled` **true** → mỗi đơn, nếu cặp (userSku, userEmail) khớp một khách đã
 *   gán trong config → **ép `factoryId`** theo xưởng của khách, bỏ qua factory
 *   của product config. Khách KHÔNG được gán → vẫn rơi về product config.
 * - **Bất biến:** 1 khách chỉ thuộc 1 xưởng (validate BE lúc lưu + FE lúc chọn).
 *
 * Lưu blob JSON trong collection `system_configs` (key bên dưới, cache Redis 1h).
 */
export const CUSTOMER_ASSIGNMENT_CONFIG_KEY = 'customer_assignment_config';

export const CustomerFactoryAllocZod = z.object({
  factoryId: IDZod,
  // RefIDZod, KHÔNG IDZod: khách tạo qua `customers/sync` có `_id` ObjectId 24 hex (vd FFMTEEZ) —
  // ép đúng 16 ký tự là không lưu được khách đó vào cấu hình. Áp chung 3 cấu hình theo khách.
  customerIds: RefIDZod.array(),
});
export type CustomerFactoryAlloc = z.infer<typeof CustomerFactoryAllocZod>;

export const CustomerAssignmentConfigZod = z.object({
  enabled: z.boolean().default(false),
  factories: CustomerFactoryAllocZod.array(),
  updatedAt: z.string().optional(),
});
export type CustomerAssignmentConfig = z.infer<typeof CustomerAssignmentConfigZod>;

export class SaveCustomerAssignmentConfigDto extends createZodDto(extendApi(CustomerAssignmentConfigZod)) {}

export const GetCustomerAssignmentConfigResZod = ResZod.extend({
  data: CustomerAssignmentConfigZod,
});
export class GetCustomerAssignmentConfigResDto extends createZodDto(extendApi(GetCustomerAssignmentConfigResZod)) {}

export const SaveCustomerAssignmentConfigResZod = ResZod.extend({
  data: CustomerAssignmentConfigZod,
});
export class SaveCustomerAssignmentConfigResDto extends createZodDto(extendApi(SaveCustomerAssignmentConfigResZod)) {}

/**
 * Cấu hình **ưu tiên đơn theo khách hàng** — kéo khách vào 1 trong 3 cột mức
 * ưu tiên (`OrderPriority` 1|2|3 — mức 4 chỉ hệ thống đặt, không có ở đây), lúc `importOrders` (tay lẫn tự động) đơn
 * khớp `customerMatchKey(userSku, userEmail)` được auto-gán `priority` đó.
 *
 * - CHỈ gán khi đơn **chưa có** `priority` (đơn mới, hoặc đơn cũ import lại mà
 *   chưa ai set) — không bao giờ đè chỉnh tay. KHÔNG backfill đơn đang chạy.
 * - Khách không nằm trong cột nào ("Chưa gán") → đơn thường (không priority).
 * - **Bất biến:** 1 khách chỉ thuộc 1 mức (validate BE lúc lưu + FE kanban).
 * - Độc lập với tier VIP 0..5 (tier chỉ hiển thị/sort card trong cột).
 *
 * Lưu blob JSON trong `system_configs` (key bên dưới, cache Redis 1h) — cùng
 * pattern `customer_assignment_config` phía trên.
 */
export const CUSTOMER_PRIORITY_CONFIG_KEY = 'customer_priority_config';

export const CustomerPriorityAllocZod = z.object({
  // Mức 4 "Làm ngay" chỉ hệ thống đặt (ghi thẳng DB) — không cho vào cấu hình theo khách.
  priority: OrderPriorityZod.refine((p) => !isSystemOnlyPriority(p), { message: 'System-only priority' }),
  customerIds: RefIDZod.array(),
});
export type CustomerPriorityAlloc = z.infer<typeof CustomerPriorityAllocZod>;

export const CustomerPriorityConfigZod = z.object({
  enabled: z.boolean().default(false),
  levels: CustomerPriorityAllocZod.array(),
  updatedAt: z.string().optional(),
});
export type CustomerPriorityConfig = z.infer<typeof CustomerPriorityConfigZod>;

export class SaveCustomerPriorityConfigDto extends createZodDto(extendApi(CustomerPriorityConfigZod)) {}

export const GetCustomerPriorityConfigResZod = ResZod.extend({
  data: CustomerPriorityConfigZod,
});
export class GetCustomerPriorityConfigResDto extends createZodDto(extendApi(GetCustomerPriorityConfigResZod)) {}

export const SaveCustomerPriorityConfigResZod = ResZod.extend({
  data: CustomerPriorityConfigZod,
});
export class SaveCustomerPriorityConfigResDto extends createZodDto(extendApi(SaveCustomerPriorityConfigResZod)) {}
