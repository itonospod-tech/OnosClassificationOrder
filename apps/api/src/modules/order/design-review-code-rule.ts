import type { DesignFields } from 'shared';

/**
 * Mã chạy tool (`productCode`) theo OPTION khách chọn, cho những sản phẩm mà 1
 * SKU phải chạy nhiều tool PTS khác nhau.
 *
 * Option không có field riêng trên đơn — nó lộ ra qua VỊ TRÍ design mà OnosPod
 * gửi về (`designs.<key>`). Vd polo thêu `AOP-POLO-EMLOGO`: thêu ngực đến kèm
 * `chestLeft`, thêu trụ đến kèm `placket` (đã đối chiếu dữ liệu prod 09/2026 —
 * trước đó cả hai cùng chạy `PLNGUC`, đơn thêu trụ bị lỗi "Trụ").
 *
 * Khoá theo `ProductConfig.sku` (unique, uppercase) chứ không theo `fullName`:
 * `fullName` có bản trùng khác dấu nháy (`Men's` / `Men’s`).
 *
 * Thêm sản phẩm khác: thêm 1 entry vào map dưới đây. Sản phẩm không có entry
 * giữ nguyên hành vi cũ (`designReviewCode`).
 */
const DESIGN_REVIEW_CODE_BY_DESIGN_KEY: Record<string, Partial<Record<keyof DesignFields, string>>> = {
  'AOP-POLO-EMLOGO': {
    chestLeft: 'PLNGUC', // thêu ngực
    placket: 'PLTRU', // thêu trụ
  },
};

/**
 * Trả mã tool theo option nếu khớp ĐÚNG MỘT rule của sản phẩm; còn lại (không
 * có rule, không có design khớp, hoặc khớp từ 2 rule trở lên) → `null` để caller
 * dùng `designReviewCode` như cũ. Khớp nhiều rule (vd có cả `chestLeft` lẫn
 * `placket`) chưa có quy tắc nghiệp vụ nên KHÔNG đoán.
 *
 * Hàm thuần, tách file riêng để test được không cần Nest context.
 */
export function resolveDesignReviewCodeByDesigns(
  productSku: string | null | undefined,
  designs: DesignFields | null | undefined,
): string | null {
  const rules = productSku ? DESIGN_REVIEW_CODE_BY_DESIGN_KEY[productSku.trim().toUpperCase()] : undefined;
  if (!rules || !designs) return null;
  const hits = (Object.entries(rules) as Array<[keyof DesignFields, string]>).filter(([key]) => !!designs[key]);
  return hits.length === 1 ? hits[0][1] : null;
}
