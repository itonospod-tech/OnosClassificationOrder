import { ZaloGroupKind } from 'shared';

import { NHOM_DUOC_GUI } from './agent-zalo-send.logic';

/**
 * Luật cho đường NGHE tin Zalo — hàm THUẦN, không đụng DB, không gọi engine.
 *
 * Hai thứ được quyết ở đây, và cả hai đều hỏng theo kiểu đắt tiền nếu sai:
 *
 * 1. **Nhóm nào được nghe.** Engine không biết khái niệm `kind`; nó đẩy mọi tin
 *    của mọi nhóm. Nếu không chặn ở đây thì nội dung nhóm KHÁCH HÀNG và nhóm cá
 *    nhân của nhân viên chảy ra ngoài hệ thống — phá đúng cái chốt riêng tư mà
 *    `kind=internal` sinh ra để giữ.
 *
 * 2. **Tin nào đáng đánh thức agent.** Đo thật 7 ngày trên nhóm nội bộ/vận hành:
 *    1.888 tin/ngày. Đánh thức mỗi tin ≈ 18–28 triệu token/ngày — không kham nổi,
 *    và đó là con số hệ cũ đã trả giá để biết. Lọc "có mention bất kỳ" giảm còn
 *    736/ngày, vẫn quá nhiều. Lọc đúng — Chủ tịch gửi HOẶC mention trúng nick của
 *    công ty — còn **165/ngày**.
 */

/**
 * ⚠️ uid Zalo PHỤ THUỘC NICK ĐANG NHÌN. Đo trên dữ liệu thật 12/09: "Hoàng Anh"
 * mang 8 uid, mỗi nick công ty thấy một uid riêng; Chủ tịch mang 6. Nghĩa là
 * KHÔNG có "uid của một người" — chỉ có TẬP uid. Mọi thứ dưới đây nhận `Set`
 * chứ không nhận một chuỗi, và đó không phải để linh hoạt mà vì một chuỗi là sai.
 *
 * Hệ quả thứ hai: `zalo_accounts.zalo_uid` (uid nick tự nhìn mình) KHÁC uid mà
 * người khác thấy nó, nên so `mentions[].uid` với bảng account là so hai không
 * gian khác nhau — luôn trượt, và trượt im lặng. Nguồn đúng là `zalo_identities`,
 * bảng người vận hành đã xét, vốn khoá theo uid phía contact.
 */

/** Vai người gửi, đủ để agent tự xét "việc của mình không". */
export const VAI = {
  chairman: 'chairman',
  staff: 'staff',
  aiSupport: 'ai-support',
  customer: 'customer',
  unknown: 'unknown',
} as const;
export type Vai = (typeof VAI)[keyof typeof VAI];

/**
 * Suy vai từ uid.
 *
 * `uidChuTich` xét TRƯỚC bảng danh tính vì nó là đường ghi đè bằng tay: Chủ tịch
 * nhắn từ Zalo cá nhân nên vài dòng của ông trong `zalo_identities` rất có thể
 * còn ở `unknown` hoặc bị đoán nhầm thành khách, và đợi xét xong mới chạy thì
 * điều kiện kích hoạt (a) im lặng suốt thời gian đó.
 *
 * `ai-support` GIỮ RIÊNG chứ không gộp vào `staff`: đó là các nick AI của chính
 * mình, và agent phải phân biệt được để không đối thoại với chính nó.
 */
export function suyVai(zaloUid: string | undefined, uidChuTich: Set<string>, kindTheoUid: Map<string, string>): Vai {
  if (!zaloUid) return VAI.unknown;
  if (uidChuTich.has(zaloUid)) return VAI.chairman;

  const k = kindTheoUid.get(zaloUid);
  if (k === 'chairman') return VAI.chairman;
  if (k === 'staff') return VAI.staff;
  if (k === 'ai-support') return VAI.aiSupport;
  if (k === 'customer') return VAI.customer;

  return VAI.unknown;
}

/** Nhóm có được nghe không — dùng chung đúng bộ luật với đường GỬI. */
export function nhomDuocNghe(kind: string | undefined): boolean {
  return kind !== ZaloGroupKind.Seller && NHOM_DUOC_GUI.includes(String(kind));
}

export interface TinDeXet {
  senderUid?: string;
  mentions?: Array<{ uid?: string }>;
}

export type LyDoKichHoat = 'chairman' | 'mention';

/**
 * Tin này có đáng đánh thức agent không, và vì lý do gì.
 *
 * `null` = không. Trả về LÝ DO chứ không phải boolean: bên nhận cần biết mình
 * được gọi vì Chủ tịch nói hay vì bị tag, hai việc xử lý khác nhau — và khi phải
 * dò vì sao agent im hoặc vì sao nó nổ, lý do là thứ đầu tiên người ta tìm.
 *
 * `uidNickAgent` là tập uid của các nick TRỢ LÝ AI nhìn từ phía người khác
 * (`zalo_identities.kind='ai-support'`), KHÔNG phải `zalo_accounts.zalo_uid` —
 * xem ghi chú về không gian uid ở đầu file.
 */
export function lyDoKichHoat(tin: TinDeXet, uidChuTich: Set<string>, uidNickAgent: Set<string>): LyDoKichHoat | null {
  if (tin.senderUid && uidChuTich.has(tin.senderUid)) return 'chairman';

  // Tag người ngoài không tính: chỉ nổ khi ai đó gọi đúng một nick trợ lý.
  for (const m of tin.mentions ?? []) {
    if (m.uid && uidNickAgent.has(m.uid)) return 'mention';
  }

  return null;
}

/**
 * Khoá chống trùng cho một tin.
 *
 * KHÔNG dùng id bản ghi của engine: engine lưu MỘT bản cho MỖI nick công ty có
 * mặt trong nhóm, nên một câu nói thật thành 2–7 dòng với 2–7 id khác nhau —
 * đo trên 7 ngày: 26.034 dòng = 12.189 tin thật. Khoá theo id bản ghi thì agent
 * bị đánh thức 2–7 lần cho cùng một câu, và mỗi lần nó sẽ trả lời lại.
 *
 * `zaloMsgId` là id phía Zalo nên giống nhau trên mọi bản. Thiếu nó (tin cũ,
 * tin hệ thống) thì lùi về id bản ghi: thà trùng còn hơn mất.
 */
export function khoaChongTrung(groupGlobalId: string, zaloMsgId: string | undefined, messageId: string): string {
  return zaloMsgId ? `${groupGlobalId}:${zaloMsgId}` : `rec:${messageId}`;
}

/**
 * Xác thực chữ ký webhook của engine: `x-webhook-signature` = HMAC-SHA256 hex
 * của **nguyên văn thân yêu cầu**.
 *
 * So bằng `timingSafeEqual` chứ không `===`: so chuỗi thường thoát ra ở byte đầu
 * khác nhau, và thời gian thoát đó đủ để dò dần chữ ký đúng.
 */
export function chuKyKhop(kyNhanDuoc: string | undefined, kyTinh: string): boolean {
  if (!kyNhanDuoc || kyNhanDuoc.length !== kyTinh.length) return false;

  let khac = 0;
  for (let i = 0; i < kyTinh.length; i++) khac |= kyNhanDuoc.charCodeAt(i) ^ kyTinh.charCodeAt(i);

  return khac === 0;
}
