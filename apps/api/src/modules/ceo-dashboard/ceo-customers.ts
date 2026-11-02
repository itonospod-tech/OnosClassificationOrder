import type { CeoOverview } from 'shared';

/** Khách kỳ trước có từ chừng này đơn mà kỳ này 0 đơn → vào danh sách rời bỏ. */
export const CHURN_MIN_PREV = 3;
/** Ngưỡng "phục vụ tốt" theo khách (số thay thế cho mức độ hài lòng). */
export const SERVICE_MIN_MATURE = 5;
export const SERVICE_MAX_ERROR_PCT = 5;
export const SERVICE_MIN_N2_PCT = 80;
const LIST_LIMIT = 5;

/** Một khách trong kỳ này — đã xếp theo số đơn giảm dần. */
export interface CeoCustomerRow {
  userSku: string;
  orders: number;
  held: number;
  errorPct: number | null;
  n2Pct: number | null;
  /** Số đơn đủ tuổi đánh giá N2. */
  mature: number;
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * Giữ chân khách cũ + chất lượng phục vụ theo khách (CeoDashboard.md) — hàm THUẦN.
 * Hai số THAY THẾ cho "tỷ lệ chăm sóc lại khách cũ" và "mức độ hài lòng" vì hệ thống
 * chưa ghi nhận lần chăm sóc / điểm hài lòng nào. Bỏ đơn thiếu `userSku` ở cả hai.
 */
export function summarizeCustomerHealth(
  cur: CeoCustomerRow[],
  prevBySku: Map<string, number>,
): Pick<CeoOverview['customers'], 'retention' | 'service'> {
  const curBySku = new Map(cur.map((r) => [r.userSku, r.orders]));
  const prevNamed = [...prevBySku.entries()].filter(([sku]) => sku);
  const retained = prevNamed.filter(([sku]) => (curBySku.get(sku) || 0) > 0).length;
  const churned = prevNamed
    .filter(([sku, n]) => n >= CHURN_MIN_PREV && !curBySku.get(sku))
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIST_LIMIT)
    .map(([userSku, prevOrders]) => ({ userSku, prevOrders }));

  // Chỉ chấm khách đủ mẫu đơn đủ tuổi N2 — vài đơn lẻ thì 1 đơn trễ đã thành 0%.
  const rated = cur.filter((r) => r.userSku && r.mature >= SERVICE_MIN_MATURE);
  const isOk = (r: CeoCustomerRow) => (r.errorPct ?? 0) < SERVICE_MAX_ERROR_PCT && (r.n2Pct ?? 0) >= SERVICE_MIN_N2_PCT;
  const ok = rated.filter(isOk).length;
  const atRisk = rated
    .filter((r) => !isOk(r))
    .slice(0, LIST_LIMIT)
    .map(({ userSku, orders, errorPct, n2Pct, held }) => ({ userSku, orders, errorPct, n2Pct, held }));

  return {
    retention: { retained, base: prevNamed.length, pct: pct(retained, prevNamed.length), churned },
    service: {
      rated: rated.length,
      ok,
      okPct: pct(ok, rated.length),
      minMature: SERVICE_MIN_MATURE,
      maxErrorPct: SERVICE_MAX_ERROR_PCT,
      minN2Pct: SERVICE_MIN_N2_PCT,
      atRisk,
    },
  };
}
