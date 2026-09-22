import { resolveBarcodeSkuBase } from '../order/barcode-label';

/**
 * Hàm thuần cho module tồn kho — tách khỏi service để test không cần Nest.
 * Plan: `documents/Plans/Inventory-FactoryStock.md`.
 */

/** Bỏ ký tự phân tách để so khớp size lỏng tay (cùng luật với barcode-label). */
function norm(s: string): string {
  return s.replace(/[\s_-]+/g, '').toUpperCase();
}

export type InventorySkuResolvedBy = 'variation' | 'base-size' | 'fallback';

/**
 * Suy SKU KHO từ đơn — KHÁC tem barcode (tem gọt đuôi size để công nhân đối
 * chiếu kệ; kho thì phôi phân biệt theo size nên phải GIỮ đuôi):
 * 1. Có variation SKU mà norm kết thúc đúng size đơn → dùng NGUYÊN variation
 *    đó (`CAMOSHIRT-XL`) — ca chuẩn.
 * 2. Có variations nhưng không khớp size → SKU gốc (resolveBarcodeSkuBase)
 *    + `-<size>` nếu đơn có size.
 * 3. Không có config/variation → `type` + `-<size>` — đánh dấu `fallback`
 *    để thủ kho biết cần soát lại.
 * Kết quả luôn UPPERCASE (khớp `uppercase: true` của entity).
 */
export function resolveInventorySku(
  order: { type?: string | null; size?: string | null },
  variationSkus: string[],
): { sku: string | null; resolvedBy: InventorySkuResolvedBy | null } {
  const skus = variationSkus.map((s) => s?.trim()).filter(Boolean);
  const size = order.size?.trim();

  if (size && skus.length > 0) {
    const target = norm(size);
    const matched = skus.find((sku) => norm(sku).endsWith(target));
    if (matched) return { sku: matched.toUpperCase(), resolvedBy: 'variation' };
  }

  if (skus.length > 0) {
    const base = resolveBarcodeSkuBase(skus);
    if (base) {
      const sku = size ? `${base}-${norm(size)}` : base;
      return { sku: sku.toUpperCase(), resolvedBy: 'base-size' };
    }
  }

  const type = order.type?.trim();
  if (type) {
    const sku = size ? `${type}-${norm(size)}` : type;
    return { sku: norm(type) === '' ? null : sku.toUpperCase(), resolvedBy: 'fallback' };
  }

  return { sku: null, resolvedBy: null };
}

/** requestId lượt xuất theo đơn: `<productionId>#<attempt>` (attempt từ 1). */
export function buildScanOutRequestId(productionId: string, attempt: number): string {
  return `${productionId}#${attempt}`;
}

/** Hai chữ số cuối năm + tháng + ngày theo giờ VN — cùng luật `ngayVN` của packing. */
function ymdVN(luc: Date): string {
  const vn = new Date(luc.getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');

  return `${p(vn.getUTCDate())}${p(vn.getUTCMonth() + 1)}${String(vn.getUTCFullYear()).slice(-2)}`;
}

/** Số phiếu: `NK-MLDTF-210926-01` (in) / `XK-...` (out). */
export function buildReceiptCode(type: 'in' | 'out', factoryShortName: string | undefined, luc: Date, seqInDay: number): string {
  const prefix = type === 'in' ? 'NK' : 'XK';
  const factory = (factoryShortName ?? 'NA').trim().toUpperCase() || 'NA';

  return `${prefix}-${factory}-${ymdVN(luc)}-${String(seqInDay).padStart(2, '0')}`;
}

/** [start, end) của 1 ngày `YYYY-MM-DD` theo giờ VN — dùng cho đối soát. */
export function vnDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 3_600_000);

  return { start, end };
}

/**
 * Filter Mongo cho ĐỐI SOÁT NGÀY: đơn của xưởng có khâu In hoàn thành trong
 * ngày (giờ VN), chưa hủy. Việc "đã trừ kho hay chưa" soát ở bước sau bằng tra
 * `inventory_transactions.refs.productionId` — không nhét $lookup vào đây để
 * filter còn test thuần được.
 */
export function buildReconcileOrderFilter(factoryId: string, date: string): Record<string, unknown> {
  const { start, end } = vnDayRange(date);

  return {
    factoryId,
    cancelledAt: { $exists: false },
    'fulfillmentStages.print.completedAt': { $gte: start, $lt: end },
  };
}
