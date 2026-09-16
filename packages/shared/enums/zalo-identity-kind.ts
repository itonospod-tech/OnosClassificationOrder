/**
 * Một người gửi tin trong nhóm Zalo là ai.
 *
 * Khoá của bảng định danh là `zaloUid`, KHÔNG phải tên hiển thị: đo trên dữ
 * liệu thật ngày 30/08 — cùng uid `623149364320559023` từng mang hai tên
 * "Ceo Onos" và "Onos Ai"; ngược lại tên "Onos" thuộc hai uid khác nhau. Khoá
 * theo tên là sai ngay từ ngày đầu.
 */
export enum ZaloIdentityKind {
  /** Chưa xét — mặc định khi mới đồng bộ về. */
  Unknown = 'unknown',
  /**
   * Tài khoản trợ lý AI trực nhóm.
   *
   * Tách RIÊNG khỏi `staff` chứ không gộp: khi AI trả lời khách, câu hỏi quan
   * trọng nhất với quản lý là "nhóm nào AI đang gánh một mình mà chưa nhân
   * viên nào vào". Gộp chung là mất luôn câu đó.
   */
  AiSupport = 'ai-support',
  /**
   * Chủ tịch.
   *
   * Tách khỏi `Staff` vì đây là một ĐIỀU KIỆN KÍCH HOẠT: ông nhắn trong nhóm là
   * agent phải tỉnh dậy xem có việc của mình không. Gộp vào `staff` thì điều
   * kiện đó không diễn đạt được.
   *
   * ⚠️ Một người có NHIỀU dòng ở bảng này. Đo trên dữ liệu thật 12/09: uid Zalo
   * phụ thuộc NICK ĐANG NHÌN — "Hoàng Anh" mang 8 uid khác nhau, mỗi nick công
   * ty thấy một uid. Nên đánh dấu Chủ tịch phải đánh dấu ĐỦ mọi dòng của ông,
   * không phải một dòng. Thiếu dòng nào thì trong nhóm mà nick đó trực, agent
   * im lặng mà không có triệu chứng gì.
   */
  Chairman = 'chairman',
  /** Nhân viên công ty — kể cả khi dùng tài khoản Zalo cá nhân. */
  Staff = 'staff',
  /** Phía khách hàng. */
  Customer = 'customer',
}

export const ZALO_IDENTITY_KINDS = Object.values(ZaloIdentityKind);

export const ZALO_IDENTITY_KIND_LABELS: Record<ZaloIdentityKind, string> = {
  [ZaloIdentityKind.Unknown]: 'Chưa xét',
  [ZaloIdentityKind.AiSupport]: 'Trợ lý AI',
  [ZaloIdentityKind.Chairman]: 'Chủ tịch',
  [ZaloIdentityKind.Staff]: 'Nhân viên',
  [ZaloIdentityKind.Customer]: 'Khách hàng',
};

/** Nhãn dùng trong đoạn chat gửi cho mô hình. */
export const ZALO_IDENTITY_CHAT_LABELS: Record<ZaloIdentityKind, string> = {
  [ZaloIdentityKind.Unknown]: 'CHƯA RÕ',
  [ZaloIdentityKind.AiSupport]: 'TRỢ LÝ AI',
  [ZaloIdentityKind.Chairman]: 'CHỦ TỊCH',
  [ZaloIdentityKind.Staff]: 'NHÂN VIÊN',
  [ZaloIdentityKind.Customer]: 'KHÁCH',
};

/**
 * Nhãn thay cho KHÁCH khi dựng dòng chat của NHÓM VẬN HÀNH: người ngoài công ty
 * trong nhóm đó là nhà cung cấp / forwarder / xưởng gia công, không phải khách.
 * Đây là hàm của NHÓM chứ không phải của người, nên không thêm loại danh tính.
 */
export const ZALO_PARTNER_CHAT_LABEL = 'ĐỐI TÁC';

/**
 * Ngưỡng gieo tự động, đo từ dữ liệu thật (262 người gửi trên 147 nhóm):
 * 23 người xuất hiện ở ≥5 nhóm — không ai trong số đó là khách; 184 người chỉ
 * ở đúng 1 nhóm — đó là khách. Khoảng giữa để người xét.
 */
export const ZALO_STAFF_MIN_GROUPS = 5;
