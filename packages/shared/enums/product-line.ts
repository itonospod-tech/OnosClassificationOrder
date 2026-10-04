/**
 * DÒNG SẢN PHẨM — trục phân loại đơn/sản phẩm mà seller nhìn thấy (menu, tab, bộ lọc,
 * catalog của Seller Portal). KHÁC `printMethod` (workshop_config `print_method`:
 * dtg/dtf/sublimation/embroidery) — đó là kỹ thuật của xưởng; 2D gồm cả DTG lẫn DTF.
 * Chốt 07/09/2026: 3D · 2D · Gỗ · Thêu · LED · Canvas. Xem Products.md §2.4b.
 * Thêm 04/10/2026: `dropship` — hàng mua sẵn, không in theo kỹ thuật nào; hệ cũ OnosPod coi đây là
 * một Collection seller duyệt ngang hàng 3D/2D/Embroidery (LegacyClone-Catalog.md §6).
 */
export const ProductLine = {
  ThreeD: '3d',
  TwoD: '2d',
  Wood: 'wood',
  Embroidery: 'embroidery',
  Led: 'led',
  Canvas: 'canvas',
  Dropship: 'dropship',
} as const;
export type ProductLine = (typeof ProductLine)[keyof typeof ProductLine];
export const PRODUCT_LINES = Object.values(ProductLine) as [ProductLine, ...ProductLine[]];

/** Nhãn tiếng Việt cho BE (log/message). FE dùng i18n riêng (`productLines.<code>`, I18n.md §2.3). */
export const PRODUCT_LINE_LABELS: Record<ProductLine, string> = {
  '3d': '3D',
  '2d': '2D',
  wood: 'Gỗ',
  embroidery: 'Thêu',
  led: 'LED',
  canvas: 'Canvas',
  dropship: 'Dropship',
};

/**
 * Nguồn của giá trị `productLine` trên sản phẩm — để admin biết cái nào máy đoán
 * (đặc biệt `default` = không có tín hiệu, gán 3d) mà gắn lại; sửa tay → `manual`.
 */
export const PRODUCT_LINE_SOURCES = ['manual', 'collection', 'factory', 'machineType', 'printMethod', 'default'] as const;
export type ProductLineSource = (typeof PRODUCT_LINE_SOURCES)[number];
