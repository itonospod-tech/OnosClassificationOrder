import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ZaloIdentityKind } from '@shared/enums';
import { BaseEntityZod, PageQueryZod, PageResZod, ResZod } from '@shared/types';
import { z } from 'zod';

import { IDZod } from '../constants/common-zod';

/**
 * Ai là ai trong các nhóm Zalo.
 *
 * Khoá là `zaloUid` — tên hiển thị đổi liên tục nên không dùng làm khoá được.
 */
export const ZaloIdentityZod = BaseEntityZod.extend({
  zaloUid: z.string().min(1).max(64),
  /** Ảnh chụp tên mới nhất, CHỈ để người đọc nhận ra — không phải khoá. */
  displayName: z.string().max(200).optional(),
  kind: z.nativeEnum(ZaloIdentityKind).default(ZaloIdentityKind.Unknown),

  /** Nối sang nhân viên thật trong hệ thống, khi biết là ai. */
  userId: IDZod.optional(),
  /** Nối sang khách hàng, khi biết. */
  customerId: IDZod.optional(),

  /**
   * BẰNG CHỨNG để người duyệt không phải tin mù: người trực nhiều nhóm là nhân
   * viên, khách chỉ ở nhóm của mình.
   */
  groupCount: z.number().default(0),
  messageCount: z.number().default(0),
  /** Hệ thống đoán từ `groupCount`; người vẫn phải xác nhận. */
  suggestedKind: z.nativeEnum(ZaloIdentityKind).optional(),
  /** Nhóm người này từng nhắn — cơ sở để suy ra khách. */
  groupGlobalIds: z.string().array().optional(),

  confirmedByUserId: IDZod.optional(),
  confirmedAt: z.date().optional(),
  syncedAt: z.date().optional(),
});
export type ZaloIdentity = z.infer<typeof ZaloIdentityZod>;

//
export const GetZaloIdentitiesZod = PageQueryZod.extend({
  kind: z.nativeEnum(ZaloIdentityKind).optional(),
  /** `true` → chỉ người CHƯA được xác nhận (danh sách việc cần làm). */
  chuaXacNhan: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
});
export class GetZaloIdentitiesDto extends createZodDto(extendApi(GetZaloIdentitiesZod)) {}

export const GetZaloIdentitiesResZod = PageResZod.extend({ data: ZaloIdentityZod.array() });
export class GetZaloIdentitiesResDto extends createZodDto(extendApi(GetZaloIdentitiesResZod)) {}

//
export const UpdateZaloIdentityZod = z.object({
  kind: z.nativeEnum(ZaloIdentityKind),
  userId: IDZod.nullable().optional(),
  customerId: IDZod.nullable().optional(),
});
export class UpdateZaloIdentityDto extends createZodDto(extendApi(UpdateZaloIdentityZod)) {}

export const UpdateZaloIdentityResZod = ResZod.extend({ data: ZaloIdentityZod });
export class UpdateZaloIdentityResDto extends createZodDto(extendApi(UpdateZaloIdentityResZod)) {}

//
/** Một người gửi lấy từ engine, đã gộp theo uid trước khi nạp. */
export const ZaloIdentitySnapshotZod = z.object({
  zaloUid: z.string().min(1).max(64),
  displayName: z.string().max(200).optional(),
  groupCount: z.number(),
  messageCount: z.number(),
  /** Có phải tài khoản công ty nối vào engine không (→ gợi ý `ai-support`). */
  laTaiKhoanCongTy: z.boolean().optional(),
  /**
   * Các nhóm người này có mặt — để heuristic nhìn LOẠI nhóm: người chỉ ở một
   * nhóm vận hành là đối tác/nhà cung cấp, không phải khách. Thiếu thì API
   * đoán như cũ (chỉ theo số nhóm).
   */
  groupGlobalIds: z.string().max(120).array().max(500).optional(),
});
export type ZaloIdentitySnapshot = z.infer<typeof ZaloIdentitySnapshotZod>;

export const SyncZaloIdentitiesZod = z.object({ identities: ZaloIdentitySnapshotZod.array().min(1) });
export class SyncZaloIdentitiesDto extends createZodDto(extendApi(SyncZaloIdentitiesZod)) {}

export const SyncZaloIdentitiesResZod = ResZod.extend({
  data: z.object({
    created: z.number(),
    updated: z.number(),
    /** Số người hệ thống tự đoán được, chờ người xác nhận. */
    suggested: z.number(),
    /** Số người vừa được nối vào khách nhờ nhóm họ nhắn (không đè liên kết gắn tay). */
    linked: z.number().default(0),
  }),
});
export class SyncZaloIdentitiesResDto extends createZodDto(extendApi(SyncZaloIdentitiesResZod)) {}
