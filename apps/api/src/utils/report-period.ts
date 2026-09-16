/**
 * Nhận biết một kỳ báo cáo có phải TRỌN MỘT THÁNG LỊCH không.
 *
 * Tách ra dùng chung vì hai bộ báo cáo (CEO và khách hàng) phải gán cùng một
 * nhãn cho cùng một kỳ — agent đọc `kind` để chọn cách trình bày, hai bên trả
 * khác nhau là nó bày sai một trong hai.
 *
 * Ranh giới tính theo GIỜ VIỆT NAM, khớp với `CeoDashboardService`: mọi mốc
 * dựng bằng `T00:00:00+07:00` và mọi aggregation chạy `timezone:
 * 'Asia/Ho_Chi_Minh'`. Đọc bằng UTC thì tháng 1 sẽ hụt 7 giờ đầu và thừa 7 giờ
 * của tháng 2 — sai nhỏ, và vì nhỏ nên sẽ không ai phát hiện.
 */
export function laThangTron(from: string, to: string): boolean {
  // Dịch mốc +7h rồi đọc bằng `getUTC*`: đây là cách đọc "ngày nào theo giờ VN"
  // mà không phụ thuộc múi giờ của máy chạy.
  const dauVn = new Date(new Date(`${from}T00:00:00+07:00`).getTime() + 7 * 3_600_000);
  const sauCuoiVn = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 7 * 3_600_000 + 864e5);

  // Đầu kỳ là mùng 1, và ngày LIỀN SAU cuối kỳ cũng là mùng 1 → trọn một tháng,
  // đúng cho cả tháng 28/29/30/31 ngày mà không cần bảng số ngày.
  return dauVn.getUTCDate() === 1 && sauCuoiVn.getUTCDate() === 1;
}

/** Ngày đầu và ngày cuối của tháng `yyyy-mm`, theo giờ VN. */
export function khoangThang(nam: number, thang: number): { from: string; to: string } {
  const hai = (n: number) => String(n).padStart(2, '0');
  const from = `${nam}-${hai(thang)}-01`;
  // Ngày 0 của tháng sau = ngày cuối tháng này; `Date.UTC` tránh lệ thuộc múi giờ máy.
  const cuoi = new Date(Date.UTC(nam, thang, 0)).getUTCDate();

  return { from, to: `${nam}-${hai(thang)}-${hai(cuoi)}` };
}
