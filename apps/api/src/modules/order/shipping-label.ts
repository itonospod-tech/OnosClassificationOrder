/**
 * Resolve SKU biến thể + cân nặng cho label giao hàng 4×6in (Orders.md §16.8)
 * từ Product Config + size của đơn.
 *
 * KHÁC `resolveBarcodeSkuBase` (tem barcode xưởng): label giao hàng in SKU
 * biến thể ĐẦY ĐỦ (`PAOPPOLO-SAME-DESIGN-3XL`), không gọt đuôi size — người
 * cầm kiện đối chiếu đúng biến thể trong kiện, không phải kệ hàng.
 *
 * Hàm thuần, tách file riêng để test không cần Nest context.
 */

import { matchVariationBySize } from './variation-size-match';

export type ShippingLabelVariation = {
  sku?: string;
  /** Cân nặng GRAM của biến thể (schema Product Config lưu gram). */
  weight?: number;
};

/**
 * Chọn biến thể khớp size của đơn (`matchVariationBySize` — đuôi đúng ranh
 * giới, `-L` không khớp `-XL`):
 * - Khớp → `{ sku, weightGram }` của biến thể đó.
 * - Không khớp / thiếu size → sku để trống (KHÔNG đoán bừa biến thể khác —
 *   in sai SKU trên label tệ hơn thiếu), weight rơi về `defaultWeightGram`
 *   (cân đóng gói mặc định cấp sản phẩm).
 * - `orderWeightGram` (đơn CSV/portal có cân riêng) LUÔN thắng nếu có.
 */
export function resolveShippingLabelInfo(
  variations: ShippingLabelVariation[],
  size: string | undefined,
  orderWeightGram: number | undefined,
  defaultWeightGram: number | undefined,
): { sku?: string; weightGram?: number } {
  const matched = matchVariationBySize(variations, size, (v) => v.sku);
  const weightGram = [orderWeightGram, matched?.weight, defaultWeightGram].find(
    (w) => typeof w === 'number' && w > 0,
  );
  return { sku: matched?.sku?.trim() || undefined, weightGram };
}
