import { ZALO_STAFF_MIN_GROUPS, ZaloGroupKind, ZaloIdentityKind } from 'shared';

/**
 * Đoán phân loại một người gửi từ bằng chứng đếm được — tách khỏi service để
 * kiểm thử được không cần Mongo.
 *
 * Người trực nhiều nhóm là nhân viên, người chỉ ở một nhóm là khách. Đo trên
 * dữ liệu thật 30/08 (262 người gửi / 147 nhóm): 23 người ở ≥5 nhóm — không ai
 * là khách; 184 người ở đúng 1 nhóm — đều là khách.
 *
 * 2–4 nhóm: chưa đủ chắc để máy quyết. Có thể là nhân viên mới, cũng có thể là
 * khách có nhiều nhóm (nhóm chính + nhóm kế toán). Để người xét.
 *
 * Người ở ĐÚNG MỘT nhóm chỉ là khách khi nhóm đó là nhóm khách (`seller`).
 * Một nhóm vận hành thì họ là forwarder/nhà cung cấp/quản lý xưởng — đo trên
 * 111 bản tóm tắt: Duyên, Đại Thịnh, Mẫn Nè, Minh Đăng đều bị đóng dấu "khách"
 * hàng loạt qua `applySuggestions` vì heuristic cũ không nhìn loại nhóm.
 * Không biết loại nhóm (`undefined`, dữ liệu cũ) thì giữ hành vi cũ.
 */
export function doanPhanLoai(
  groupCount: number,
  laTaiKhoanCongTy?: boolean,
  loaiNhomDuyNhat?: string | null,
): ZaloIdentityKind {
  if (laTaiKhoanCongTy) return ZaloIdentityKind.AiSupport;
  if (groupCount >= ZALO_STAFF_MIN_GROUPS) return ZaloIdentityKind.Staff;
  if (groupCount === 1) {
    if (loaiNhomDuyNhat === undefined) return ZaloIdentityKind.Customer;

    return loaiNhomDuyNhat === ZaloGroupKind.Seller ? ZaloIdentityKind.Customer : ZaloIdentityKind.Unknown;
  }

  return ZaloIdentityKind.Unknown;
}

export interface NhomCuaKhach {
  /** `groupGlobalId` → `customerId` của nhóm khách đã nối. */
  khachTheoNhom: Map<string, string>;
}

/**
 * Suy ra người này thuộc khách nào, từ các nhóm họ từng nhắn.
 *
 * Đây là mắt xích cuối để tên người trong Zalo dùng được cho báo cáo khách:
 * mình đã biết **nick nào là khách** (`kind`) và **nhóm nào của seller nào**
 * (`zalo_group_links.customerId`), việc còn lại là ghép hai cái đó qua danh
 * sách nhóm của từng người.
 *
 * CHỈ nhận khi mọi nhóm khách của người đó trỏ về **đúng một** khách. Người
 * xuất hiện ở nhóm của hai khách khác nhau thì gần như chắc chắn là nhân viên
 * hoặc trung gian — gán đại một trong hai là bịa quan hệ, và cái sai đó sẽ đi
 * thẳng vào báo cáo gửi lãnh đạo.
 */
export function nhanKhachTuNhom(
  kind: ZaloIdentityKind,
  groupGlobalIds: string[] | undefined,
  { khachTheoNhom }: NhomCuaKhach,
): string | null {
  // Nhân viên/AI ở nhiều nhóm khách là chuyện bình thường — không phải khách.
  if (kind !== ZaloIdentityKind.Customer) return null;

  const khach = new Set<string>();
  for (const g of groupGlobalIds ?? []) {
    const id = khachTheoNhom.get(g);
    if (id) khach.add(id);
  }

  return khach.size === 1 ? [...khach][0] : null;
}
