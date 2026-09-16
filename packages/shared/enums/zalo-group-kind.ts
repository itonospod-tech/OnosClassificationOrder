/**
 * Phân loại một nhóm Zalo sau khi người vận hành xét.
 *
 * Vì sao cần `Unreviewed` là một giá trị THẬT chứ không phải để trống: nhóm đã
 * xét mà KHÔNG thuộc seller nào (nhóm vận hành, nhóm nội bộ) vẫn phải ghi lại
 * được. Không có nó thì danh sách chờ gắn không bao giờ cạn, và không phân biệt
 * nổi "chưa ai xét" với "đã xét rồi, không phải nhóm khách" — bài học lấy từ
 * `thghub` (migration `20260824_zalo_group_seller_map`).
 *
 * `Private` là chốt RIÊNG TƯ. Dữ liệu Zalo kéo về lẫn nhóm cá nhân của nhân viên
 * (nhóm gia đình, nhóm lớp, nhóm tổ dân phố). Mọi bước đọc nội dung chat để phân
 * tích BẮT BUỘC lọc bỏ nhóm mang nhãn này — đưa chúng vào mô hình là đọc đời tư
 * nhân viên.
 *
 * ⚠️ Vai đó TRƯỚC 13/09/2026 do `Internal` gánh, nhưng thực tế không ai dùng
 * `Internal` theo nghĩa đó: 10 nhóm mang nhãn này trên prod đều là việc công ty
 * (Kế Toán Onos Group, Report Ceo, Tín Dụng Onos - Vietinbank…), không có nhóm
 * gia đình/lớp/tổ dân phố nào. Tài liệu nói một đằng, người vận hành dùng một
 * nẻo — nên tách ra: `Internal` = nội bộ CÔNG TY (phân tích được), `Private` =
 * riêng tư (không bao giờ phân tích). Không tách thì lúc cho tóm tắt nhóm nội bộ
 * là mất luôn cái nhãn để nói "đừng đọc nhóm này".
 */
export enum ZaloGroupKind {
  /** Mới đồng bộ về, chưa ai xét. Mặc định. */
  Unreviewed = 'unreviewed',
  /** Nhóm làm việc với một khách/seller — phải có `customerId`. */
  Seller = 'seller',
  /** Nhóm vận hành nội bộ theo chức năng (Vận Hành Sx TN/ML, Đóng hàng, ghép file…). */
  Operation = 'operation',
  /**
   * Nhóm NỘI BỘ CÔNG TY (kế toán, IT, ban điều hành, đối tác chiến lược).
   *
   * Phân tích được: có tóm tắt, agent đọc và nhắn được. Dùng cho nhóm việc của
   * công ty mà không thuộc một khách nào.
   */
  Internal = 'internal',
  /**
   * Nhóm RIÊNG TƯ của nhân viên — LOẠI khỏi mọi phân tích, mọi đường đọc/gửi
   * của agent, và không bao giờ có bản tóm tắt. Xem ghi chú đầu file.
   */
  Private = 'private',
}

export const ZALO_GROUP_KINDS = Object.values(ZaloGroupKind);

/** Nhãn tiếng Việt dùng ở BE (log/thông báo). FE có i18n riêng. */
export const ZALO_GROUP_KIND_LABELS: Record<ZaloGroupKind, string> = {
  [ZaloGroupKind.Unreviewed]: 'Chưa xét',
  [ZaloGroupKind.Seller]: 'Nhóm khách',
  [ZaloGroupKind.Operation]: 'Nhóm vận hành',
  [ZaloGroupKind.Internal]: 'Nội bộ công ty',
  [ZaloGroupKind.Private]: 'Riêng tư',
};

/**
 * Nhóm được phép đưa nội dung chat vào phân tích. Dùng ở MỌI truy vấn đọc tin
 * nhắn — đừng viết lại điều kiện này ở từng chỗ, lệch một chỗ là rò đời tư.
 */
/**
 * Nhóm được đọc nội dung chat để phân tích/tóm tắt.
 *
 * `Internal` vào đây từ 13/09/2026 (nhóm nội bộ công ty cũng cần tóm tắt cho
 * agent tài chính/nội bộ). `Private` thì KHÔNG BAO GIỜ — đó là cả lý do nó tồn
 * tại. `Unreviewed` cũng không: chưa ai xét thì chưa biết là nhóm gì.
 */
export const ZALO_GROUP_ANALYZABLE_KINDS: ZaloGroupKind[] = [ZaloGroupKind.Seller, ZaloGroupKind.Operation, ZaloGroupKind.Internal];
