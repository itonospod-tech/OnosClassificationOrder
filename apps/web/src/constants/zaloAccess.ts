/**
 * Tài khoản được phép thấy và mở các màn liên quan dữ liệu Zalo.
 *
 * ⚠️ Đây CHỈ là lớp hiển thị. Chốt thật nằm ở backend
 * (`apps/api/src/utils/zalo-access.ts` + `ZaloAccessGuard`) — danh sách này
 * chỉ để người không có quyền khỏi thấy menu rồi bấm vào và nhận 403.
 *
 * Hai nơi phải sửa cùng lúc khi đổi danh sách. Sửa mỗi ở đây là giấu menu
 * nhưng API vẫn mở; sửa mỗi ở backend là menu hiện rồi bấm vào báo lỗi.
 */
export const ZALO_ALLOWED_EMAILS: readonly string[] = ['tuankudo199@gmail.com', 'automation@onosfactory.com'];

export function duocTruyCapZalo(email?: string | null): boolean {
  const e = String(email ?? '').trim().toLowerCase();

  return !!e && ZALO_ALLOWED_EMAILS.some((x) => x.toLowerCase() === e);
}
