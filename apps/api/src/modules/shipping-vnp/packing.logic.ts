/**
 * Hàm thuần cho nghiệp vụ ĐÓNG KIỆN ở công đoạn Đóng hàng (GAP-25/26/27 của
 * tài liệu chuyển đổi). Tách khỏi service để kiểm thử được mà không cần DB.
 */

/**
 * Khoá gộp kiện. Chốt nghiệp vụ 17/09/2026: **1 kiện = 1 đơn seller** — mọi
 * item cùng mã đơn nằm chung một kiện, khớp cách mua label VNP (nhiều item
 * chung một label) và cách xưởng đóng gói thật.
 *
 * Đơn không có mã đơn (đơn lẻ nhập tay, đơn import thiếu trường) rơi về chính
 * `productionId` của nó — mỗi item một kiện. KHÔNG gộp nhóm "không có mã đơn"
 * lại với nhau: chúng không liên quan gì tới nhau ngoài việc cùng thiếu dữ liệu.
 */
export function khoaGopKien(don: { orderId?: string | null; productionId?: string | null }): string | null {
  const ma = (don.orderId ?? '').trim();
  if (ma) return ma;
  const sx = (don.productionId ?? '').trim();

  return sx || null;
}

/** Hai chữ số cuối của năm + tháng + ngày theo giờ Việt Nam: `170926`. */
export function ngayVN(luc: Date): string {
  const vn = new Date(luc.getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');

  return `${p(vn.getUTCDate())}${p(vn.getUTCMonth() + 1)}${String(vn.getUTCFullYear()).slice(-2)}`;
}

/**
 * Mã phiếu bàn giao: `BG-<xưởng>-<ngày VN>-<số thứ tự trong ngày>`.
 *
 * Ngày tính theo giờ VN chứ không theo UTC: phiếu in lúc 21h vẫn phải mang
 * ngày hôm đó, không nhảy sang hôm sau.
 */
export function maPhieuBanGiao(xuong: string | undefined, luc: Date, soTrongNgay: number): string {
  const ma = (xuong ?? 'NA').trim().toUpperCase() || 'NA';

  return `BG-${ma}-${ngayVN(luc)}-${String(soTrongNgay).padStart(2, '0')}`;
}

/**
 * Cân tính cước = max(cân thực tế, cân quy đổi thể tích) — cùng công thức với
 * lúc seller tự mua label (`packages/shared/client/seller-shipping.ts`), để
 * hai nơi không ra hai con số khác nhau cho cùng một kiện.
 *
 * Quy đổi: dài×rộng×cao (cm) / 6 → gram. Thiếu chiều nào thì bỏ qua phần quy
 * đổi thay vì tính bừa bằng 0 — kiện thiếu số đo là kiện chưa đo, không phải
 * kiện không có thể tích.
 */
export function canTinhCuoc(kien: {
  weightGram?: number | null;
  dimensions?: { width?: number | null; height?: number | null; length?: number | null } | null;
}): number | null {
  const that = kien.weightGram && kien.weightGram > 0 ? kien.weightGram : null;
  const d = kien.dimensions;
  const duSoDo = d?.width && d?.height && d?.length;
  const quyDoi = duSoDo ? Math.round(((d.width as number) * (d.height as number) * (d.length as number)) / 6) : null;

  if (that === null && quyDoi === null) return null;

  return Math.max(that ?? 0, quyDoi ?? 0);
}
