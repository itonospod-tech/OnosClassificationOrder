import type { CeoOverview } from 'shared';
import { CUSTOMER_REPORT_RULES, type CustomerReportRow } from 'shared';

/**
 * Luật của báo cáo khách hàng — hàm THUẦN, không đụng DB.
 *
 * Vì sao tách ra: đây là chỗ quyết định "khách nào đang tụt" đi thẳng vào báo
 * cáo gửi Chủ tịch. Ngưỡng nằm rải trong service thì mỗi lần sửa là một lần
 * đoán, và không ai đối chiếu được vì sao hôm nay có tên này mà hôm qua không.
 *
 * Số liệu lấy từ `CeoOverview` chứ KHÔNG tự gộp lại từ `customer_orders`. Đo
 * 11/09/2026 trên cùng kỳ 04→10/09: gộp từ staging ra 81 khách / 5.373 đơn,
 * còn CEO Dashboard ra 80 khách / 5.337 đơn — vì CEO loại đơn hủy, đơn chưa
 * map xưởng và đơn xưởng US. Hai báo cáo cùng gửi Chủ tịch trong một buổi sáng
 * mà lệch nhau thì không ai giải thích nổi, nên chốt: một nguồn duy nhất.
 */

/** `null` khi kỳ trước bằng 0 — chia cho 0 ra `Infinity`, hiện lên là "∞%". */
export function phanTramDoi(now: number, prev: number): number | null {
  if (!prev) return null;

  return Math.round(((now - prev) / prev) * 1000) / 10;
}

export interface KhachThoRow {
  userSku: string;
  orders: number;
  prevOrders: number;
  tier?: number | null;
}

/** Dựng một dòng báo cáo, gắn tên người liên hệ nếu đã nối được. */
export function dungDong(r: KhachThoRow, ten?: string): CustomerReportRow {
  return {
    userSku: r.userSku,
    customerName: ten || undefined,
    tier: r.tier ?? null,
    orders: r.orders,
    ordersPrev: r.prevOrders,
    changePct: phanTramDoi(r.orders, r.prevOrders),
  };
}

/**
 * Khách tụt mạnh — nguy cơ mất khách.
 *
 * Đòi cả SÀN kỳ trước lẫn MỨC GIẢM: chỉ nhìn phần trăm thì khách 2 đơn còn 1
 * cũng là "giảm 50%", và danh sách gửi Chủ tịch đầy những cái tên không có ý
 * nghĩa thương mại nào.
 */
export function khachTut(rows: KhachThoRow[]): KhachThoRow[] {
  return rows
    .filter((r) => {
      if (r.prevOrders < CUSTOMER_REPORT_RULES.decliningMinPrev) return false;
      const drop = ((r.prevOrders - r.orders) / r.prevOrders) * 100;

      return drop >= CUSTOMER_REPORT_RULES.decliningDropPct;
    })
    .sort((a, b) => b.prevOrders - a.prevOrders);
}

/** Khách tăng đột biến — đòi cả sàn kỳ này lẫn mức tăng, cùng lý do như trên. */
export function khachTang(rows: KhachThoRow[]): KhachThoRow[] {
  return rows
    .filter((r) => {
      if (r.orders < CUSTOMER_REPORT_RULES.surgingMinNow) return false;
      // Khách mới toanh (kỳ trước 0 đơn) tính là tăng đột biến.
      if (!r.prevOrders) return true;
      const rise = ((r.orders - r.prevOrders) / r.prevOrders) * 100;

      return rise >= CUSTOMER_REPORT_RULES.surgingRisePct;
    })
    .sort((a, b) => b.orders - a.orders);
}

/** Số ngày việc cũ nhất chưa xong còn treo. */
export function soNgayTonDong(checklist: Array<{ xong?: boolean; taoLuc?: string | Date }> | undefined, moc: Date): number | undefined {
  const chuaXong = (checklist ?? []).filter((c) => !c.xong && c.taoLuc);
  if (chuaXong.length === 0) return undefined;
  const cuNhat = Math.min(...chuaXong.map((c) => new Date(c.taoLuc!).getTime()));

  return Math.max(0, Math.floor((moc.getTime() - cuNhat) / 86_400_000));
}

/**
 * Câu tóm tắt gửi Chủ tịch. Viết bằng luật, KHÔNG gọi mô hình: báo cáo này chạy
 * mỗi sáng và phải ra cùng một câu cho cùng một bộ số — mô hình viết lại mỗi
 * lần một kiểu thì không ai đối chiếu được hôm nay với hôm qua.
 */
export function vietTomTat(o: CeoOverview, tut: KhachThoRow[], tang: KhachThoRow[]): string {
  const c = o.customers;
  const d = phanTramDoi(o.production.in, o.production.prevIn);
  const chieu = d == null ? 'chưa có kỳ trước để so' : d >= 0 ? `tăng ${d}%` : `giảm ${Math.abs(d)}%`;
  const cau = [
    `Kỳ ${o.period.from} → ${o.period.to} có ${c.active} khách đặt đơn (kỳ trước ${c.prevActive}), tổng ${o.production.in} đơn vào, ${chieu} so kỳ trước.`,
  ];
  if (c.newCount > 0) cau.push(`${c.newCount} khách mới.`);
  if (tang.length > 0) cau.push(`${tang.length} khách tăng mạnh, dẫn đầu ${tang[0].userSku} (${tang[0].prevOrders} → ${tang[0].orders} đơn).`);
  if (tut.length > 0) {
    cau.push(`${tut.length} khách tụt sâu cần hỏi lại, nặng nhất ${tut[0].userSku} (${tut[0].prevOrders} → ${tut[0].orders} đơn).`);
  } else {
    cau.push('Không có khách nào tụt sâu.');
  }

  return cau.join(' ');
}
