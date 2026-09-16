/**
 * Danh sách tài khoản được phép đọc dữ liệu chat Zalo.
 *
 * ⚠️ CỐ Ý HARD-CODE, không đọc từ env hay bảng cấu hình.
 *
 * Dữ liệu chat chứa nội dung trao đổi với khách hàng và giữa nhân viên với nhau.
 * Hệ thống có 8 tài khoản SuperAdmin và danh sách đó còn dài ra mỗi khi có người
 * mới tham gia — nếu quyền đọc chat gắn theo role thì mọi tài khoản mới đều tự
 * động có quyền, và không ai nhận ra.
 *
 * Để ở env hoặc `system_configs` thì bất kỳ ai có quyền vào máy chủ hoặc vào DB
 * đều sửa được lặng lẽ. Để trong mã nguồn thì muốn đổi phải có commit + deploy,
 * tức luôn còn dấu vết trong lịch sử git.
 *
 * Thêm/bớt email ở đây là một quyết định về quyền riêng tư, không phải chỉnh cấu hình.
 */
export const ZALO_ALLOWED_EMAILS: readonly string[] = [
  // Chủ tài khoản — người duy nhất được đọc chat.
  'tuankudo199@gmail.com',
  // Tài khoản automation: cron đồng bộ nhóm, tóm tắt, và đường gửi của AI agent.
  // Gỡ email này là mọi tự động hoá liên quan Zalo dừng chạy.
  'automation@onosfactory.com',
];

/**
 * Tài khoản này có được đọc dữ liệu Zalo không.
 *
 * Fail-closed: thiếu email, email rỗng, hoặc không khớp → từ chối. So sánh
 * không phân biệt hoa thường và bỏ khoảng trắng thừa vì email lưu trong DB có
 * thể khác cách gõ ở đây.
 */
export function duocTruyCapZalo(email?: string | null): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return false;

  return ZALO_ALLOWED_EMAILS.some((x) => x.toLowerCase() === e);
}
