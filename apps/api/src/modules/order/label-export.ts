/**
 * Chọn nguồn label THẬT của carrier cho từng đơn khi xuất PDF gộp (Orders.md
 * §16.9) — hàm thuần, tách khỏi service để test không cần Nest/HTTP.
 *
 * Luật:
 *  - Ưu tiên label VNP hệ thống mua (`vnpShipment.labelUrl`, bỏ qua nếu đã
 *    hủy `cancelledAt`) → fallback label KHÁCH TỰ CẤP (`tracking.labelUrl`,
 *    ORD-26). Không có cái nào → skip `no-label`.
 *  - GIỮ THỨ TỰ ids người dùng tick — thứ tự trang PDF = thứ tự bảng.
 *  - Nhiều item chung kiện (mua gộp theo orderId — VnpShipping.md) có CÙNG
 *    labelUrl → chỉ 1 trang, các item sau ghi vào `merged` (không phải lỗi).
 */

export interface LabelExportOrderDoc {
  _id: unknown;
  productionId: string;
  vnpShipment?: { labelUrl?: string; cancelledAt?: Date };
  tracking?: { labelUrl?: string };
}

export type LabelSkipReason = 'not-found' | 'no-label' | 'fetch-failed' | 'unsupported-format';

export interface LabelExportSource {
  productionId: string;
  labelUrl: string;
  provider: 'vnp' | 'customer';
}

export interface LabelExportResolution {
  sources: LabelExportSource[];
  /** productionId các item chung label với 1 item đứng trước (đã gộp trang). */
  merged: string[];
  skipped: { productionId: string; reason: LabelSkipReason }[];
}

export function resolveLabelExportSources(ids: string[], docs: LabelExportOrderDoc[]): LabelExportResolution {
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const seenUrls = new Set<string>();
  const sources: LabelExportSource[] = [];
  const merged: string[] = [];
  const skipped: LabelExportResolution['skipped'] = [];

  for (const id of ids) {
    const doc = byId.get(String(id));
    if (!doc) {
      skipped.push({ productionId: String(id), reason: 'not-found' });
      continue;
    }
    const vnpUrl = !doc.vnpShipment?.cancelledAt ? doc.vnpShipment?.labelUrl?.trim() : undefined;
    const customerUrl = doc.tracking?.labelUrl?.trim();
    const labelUrl = vnpUrl || customerUrl;
    if (!labelUrl) {
      skipped.push({ productionId: doc.productionId, reason: 'no-label' });
      continue;
    }
    if (seenUrls.has(labelUrl)) {
      merged.push(doc.productionId);
      continue;
    }
    seenUrls.add(labelUrl);
    sources.push({ productionId: doc.productionId, labelUrl, provider: vnpUrl ? 'vnp' : 'customer' });
  }

  return { sources, merged, skipped };
}
