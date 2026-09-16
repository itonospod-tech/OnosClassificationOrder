import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ZaloGroupKind } from '@shared/enums';
import { BaseEntityZod, PageQueryZod, PageResZod, ResZod } from '@shared/types';
import { z } from 'zod';

import { IDZod } from '../constants/common-zod';

/**
 * Mối nối NHÓM Zalo ↔ khách hàng (seller) trong OnosFactory.
 *
 * Khoá thật là `groupGlobalId`, KHÔNG phải id hội thoại. Engine Zalo lưu một
 * bản ghi hội thoại cho MỖI nick công ty có mặt trong nhóm, nên một nhóm thật
 * hiện ra thành nhiều dòng — đo trên `onosceo` ngày 29/08: 157 dòng hội thoại
 * nhóm = 147 nhóm thật. Khoá theo hội thoại nghĩa là người vận hành phải gắn
 * lại cùng một nhóm nhiều lần, và bỏ sót một lần là phân tích hụt dữ liệu của
 * nick đó. (`thghub` đã trả giá đúng chỗ này — migration `20260824`.)
 */
export const ZaloGroupLinkZod = BaseEntityZod.extend({
  /** Khoá thật của một nhóm bên engine Zalo. Duy nhất toàn hệ thống. */
  groupGlobalId: z.string().min(1).max(120),
  /** Tên nhóm — ảnh chụp lúc đồng bộ, để danh sách hiển thị không phải gọi sang engine. */
  title: z.string().max(300).optional(),
  kind: z.nativeEnum(ZaloGroupKind).default(ZaloGroupKind.Unreviewed),
  /**
   * Khách sở hữu nhóm. RỖNG được, và rỗng là có nghĩa: nhóm vận hành/nội bộ đã
   * xét vẫn phải lưu được. Bắt buộc có khi `kind = 'seller'` (service kiểm).
   */
  customerId: IDZod.optional(),
  /**
   * Ảnh chụp `userSku` của khách tại thời điểm gắn. Đơn hàng nối với khách qua
   * `userSku`/`userEmail` chứ không qua `customerId`, nên không có trường này
   * thì mọi báo cáo nối nhóm ↔ đơn đều phải tra thêm một vòng sang `customers`.
   */
  userSku: z.string().max(200).optional(),
  /**
   * Người CHỊU TRÁCH NHIỆM chính, do quản lý chỉ định.
   *
   * Khác hẳn `memberNicks` bên dưới: nick nào đang ở trong nhóm là SỰ THẬT đọc
   * từ Zalo và hệ thống không đổi được (muốn đổi phải thêm/bớt người trong nhóm
   * thật). Nhưng một nhóm có thể có nhiều nick mà chỉ một người thực sự chịu
   * trách nhiệm — đó là quyết định quản lý, không suy ra được từ dữ liệu.
   */
  ownerUserId: IDZod.optional(),
  /** Các id hội thoại engine gộp về nhóm này (mỗi nick một dòng). */
  conversationIds: z.string().array().default([]),
  /** Nick công ty đang có mặt trong nhóm — đọc từ Zalo, chỉ để hiển thị. */
  memberNicks: z.string().array().default([]),
  lastMessageAt: z.date().optional(),
  note: z.string().max(1000).optional(),
  linkedByUserId: IDZod.optional(),
  linkedAt: z.date().optional(),
  /** Lần đồng bộ gần nhất từ engine. */
  syncedAt: z.date().optional(),
});
export type ZaloGroupLink = z.infer<typeof ZaloGroupLinkZod>;

//
export const GetZaloGroupLinksZod = PageQueryZod.extend({
  kind: z.nativeEnum(ZaloGroupKind).optional(),
  customerId: IDZod.optional(),
  /** `true` → chỉ nhóm CHƯA gắn khách; `false` → chỉ nhóm đã gắn. Bỏ trống = tất cả. */
  unlinked: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
});
export class GetZaloGroupLinksDto extends createZodDto(extendApi(GetZaloGroupLinksZod)) {}

/**
 * Tóm tắt gọn kèm theo mỗi dòng nhóm.
 *
 * Đính vào chính bảng gắn nhóm chứ không bắt mở màn hình khác: người vận hành
 * nhìn danh sách nhóm là thấy ngay nhóm nào đang có việc, khỏi phải nhớ sang
 * chỗ khác tra. (Cùng cách `thghub` làm ở trang mapping của họ.)
 */
export const ZaloGroupLinkTomTatZod = z.object({
  tieuDe: z.string().optional(),
  mucDo: z.string(),
  /** Số việc chưa tick xong — con số người vận hành cần nhất. */
  viecConLai: z.number(),
  tomTatLuc: z.date().optional(),
  /** Mốc tin cuối đã vào tóm tắt. */
  denMocTin: z.date().optional(),
  /** Nhóm có tin sau `denMocTin` chưa được tóm tắt — tính lúc gọi, không lưu. */
  coTinMoi: z.boolean().optional(),
});

export const ZaloGroupLinkRowZod = ZaloGroupLinkZod.extend({
  tomTat: ZaloGroupLinkTomTatZod.optional(),
});
export type ZaloGroupLinkRow = z.infer<typeof ZaloGroupLinkRowZod>;

export const GetZaloGroupLinksResZod = PageResZod.extend({ data: ZaloGroupLinkRowZod.array() });
export class GetZaloGroupLinksResDto extends createZodDto(extendApi(GetZaloGroupLinksResZod)) {}

//
export const UpdateZaloGroupLinkZod = z.object({
  kind: z.nativeEnum(ZaloGroupKind).optional(),
  /** Truyền `null` để gỡ liên kết khách. */
  customerId: IDZod.nullable().optional(),
  /**
   * Tạo khách MỚI mang mã này rồi ghép luôn — dùng khi nhóm trỏ tới seller chưa
   * từng đặt đơn nên chưa có bản ghi khách. Loại trừ lẫn nhau với `customerId`.
   * Mã đã tồn tại thì ghép vào khách đó chứ không tạo trùng.
   */
  newCustomerSku: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, 'Mã khách chỉ gồm chữ, số và . _ -')
    .optional(),
  ownerUserId: IDZod.nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
});
export class UpdateZaloGroupLinkDto extends createZodDto(extendApi(UpdateZaloGroupLinkZod)) {}

export const UpdateZaloGroupLinkResZod = ResZod.extend({ data: ZaloGroupLinkZod });
export class UpdateZaloGroupLinkResDto extends createZodDto(extendApi(UpdateZaloGroupLinkResZod)) {}

//
/** Một nhóm thô lấy từ engine, đã gộp theo `groupGlobalId` trước khi nạp. */
export const ZaloGroupSnapshotZod = z.object({
  groupGlobalId: z.string().min(1).max(120),
  title: z.string().max(300).optional(),
  conversationIds: z.string().array().default([]),
  memberNicks: z.string().array().default([]),
  lastMessageAt: z.coerce.date().optional(),
});
export type ZaloGroupSnapshot = z.infer<typeof ZaloGroupSnapshotZod>;

export const SyncZaloGroupsZod = z.object({ groups: ZaloGroupSnapshotZod.array().min(1) });
export class SyncZaloGroupsDto extends createZodDto(extendApi(SyncZaloGroupsZod)) {}

export const SyncZaloGroupsResZod = ResZod.extend({
  data: z.object({
    /** Nhóm mới nạp lần đầu. */
    created: z.number(),
    /** Nhóm đã có, cập nhật lại tiêu đề/nick/mốc tin. */
    updated: z.number(),
    /** Dòng hội thoại thô nhận vào, trước khi gộp. */
    rawConversations: z.number(),
  }),
});
export class SyncZaloGroupsResDto extends createZodDto(extendApi(SyncZaloGroupsResZod)) {}

//
/** Một gợi ý ghép nhóm ↔ khách do hệ thống đoán, người vẫn phải duyệt. */
export const ZaloGroupSuggestionZod = z.object({
  groupGlobalId: z.string(),
  title: z.string().optional(),
  /**
   * `link` = ghép vào khách ĐANG CÓ. `create` = tên nhóm mang mã seller nhưng
   * chưa có khách nào mang mã đó — duyệt là tạo khách rồi ghép.
   *
   * Vì sao cần loại thứ hai (đo prod 11/09/2026): bảng `customers` sinh ra TỪ
   * đơn hàng, nên 19/52 nhóm chưa xét trỏ tới seller thật mà chưa từng đặt đơn
   * — không có gì để ghép vào, và trước đây chúng biến mất khỏi danh sách gợi ý
   * mà không ai biết vì sao.
   */
  action: z.enum(['link', 'create']),
  /** Chỉ có với `action='link'`. */
  customerId: IDZod.optional(),
  userSku: z.string(),
  customerName: z.string().optional(),
  /** 0..1 — càng cao càng chắc. Khớp nguyên `userSku` trong tên nhóm là cao nhất. */
  score: z.number(),
  /** Vì sao đoán vậy — để người duyệt không phải tin mù. */
  reason: z.string(),
});
export type ZaloGroupSuggestion = z.infer<typeof ZaloGroupSuggestionZod>;

export const GetZaloGroupSuggestionsResZod = ResZod.extend({ data: ZaloGroupSuggestionZod.array() });
export class GetZaloGroupSuggestionsResDto extends createZodDto(extendApi(GetZaloGroupSuggestionsResZod)) {}

//
/** Bảng phủ sóng — trả lời "còn bao nhiêu chưa gắn" bằng một lần gọi. */
export const ZaloGroupCoverageResZod = ResZod.extend({
  data: z.object({
    totalGroups: z.number(),
    byKind: z.record(z.string(), z.number()),
    /** Nhóm `seller` đã có khách. */
    linkedGroups: z.number(),
    /** Khách có ít nhất một nhóm. */
    customersWithGroup: z.number(),
    /** Khách chưa có nhóm nào. */
    customersWithoutGroup: z.number(),
    totalCustomers: z.number(),
  }),
});
export class ZaloGroupCoverageResDto extends createZodDto(extendApi(ZaloGroupCoverageResZod)) {}
