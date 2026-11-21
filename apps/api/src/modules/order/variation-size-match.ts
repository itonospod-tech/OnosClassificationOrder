/**
 * Chọn variation SKU khớp size của đơn — MỘT luật dùng chung cho label giao
 * hàng, cột SKU biến thể, tem barcode và SKU kho (Orders.md §16.7/§16.8).
 *
 * Luật cũ `norm(sku).endsWith(norm(size))` + lấy phần tử ĐẦU khớp nhầm khi
 * size này là đuôi của size kia: đơn size `L` với variations
 * `[...-XL, ...-L]` → ra `...-XL` (cũng vậy `XL` vs `2XL`, `S` vs `XS`).
 *
 * Thứ tự ưu tiên:
 * 1. Đuôi khớp ĐÚNG RANH GIỚI: trước phần đuôi size là dấu nối (`-`/`_`/khoảng
 *    trắng) hoặc đầu chuỗi — `SHIRT-XL` khớp `XL`, KHÔNG khớp `L`.
 * 2. SKU KHÔNG có dấu nối nào (dính liền `TEEXL`) → so lỏng như cũ, nhưng chọn
 *    SKU NGẮN NHẤT trong các SKU khớp: cùng gốc thì SKU ngắn nhất là SKU có
 *    đuôi size đúng bằng size đơn (`TEEL` thắng `TEEXL` cho size `L`).
 *    SKU CÓ dấu nối mà đuôi không đúng ranh giới (`SHIRT-XL` với size `L`) là
 *    khớp nhầm → bỏ, kể cả khi đó là SKU duy nhất.
 * Không khớp gì → `undefined` (người gọi tự quyết fallback).
 */

/** Bỏ ký tự phân tách để so khớp size lỏng tay: `10.6x62.2` == `10.6X62.2`. */
export function normSize(s: string): string {
  return s.replace(/[\s_-]+/g, '').toUpperCase();
}

const SEP = /[\s_-]/;

/**
 * Vị trí cắt phần đuôi size khỏi `sku` (đi lùi đủ số ký tự "có nghĩa" của size,
 * bỏ qua dấu nối lẫn trong đuôi). Gọi khi đã biết `normSize(sku).endsWith(target)`.
 */
export function sizeTailStart(sku: string, target: string): number {
  let need = target.length;
  let cut = sku.length;
  while (cut > 0 && need > 0) {
    cut -= 1;
    if (!SEP.test(sku[cut])) need -= 1;
  }
  return cut;
}

export function matchVariationBySize<T>(items: T[], size: string | undefined, skuOf: (item: T) => string | undefined): T | undefined {
  if (!size?.trim()) return undefined;
  const target = normSize(size);
  if (!target) return undefined;

  let boundary: T | undefined;
  let loose: { item: T; len: number } | undefined;
  for (const item of items) {
    const sku = skuOf(item)?.trim();
    if (!sku || !normSize(sku).endsWith(target)) continue;
    const cut = sizeTailStart(sku, target);
    if (cut === 0 || SEP.test(sku[cut - 1])) {
      boundary ??= item;
    } else if (!SEP.test(sku) && (!loose || sku.length < loose.len)) {
      loose = { item, len: sku.length };
    }
  }
  return boundary ?? loose?.item;
}
