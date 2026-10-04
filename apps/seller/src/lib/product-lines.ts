import type { LucideIcon } from 'lucide-react';
import { Image, Layers, Lightbulb, Package, Scissors, Shirt, TreePine } from 'lucide-react';
import { PRODUCT_LINES, ProductLine } from 'shared/enums';

/** Màu + icon từng dòng sản phẩm — pattern `SERVICE_COLORS/ICONS` của thghub; 6 màu lấy từ logo ONOSPOD (hồng/xanh lá/đỏ sẫm/ô-liu/vàng/đỏ). */
export const PRODUCT_LINE_META: Record<ProductLine, { color: string; icon: LucideIcon; slug: string }> = {
  [ProductLine.ThreeD]: { color: '#c40c68', icon: Shirt, slug: '3d' },
  [ProductLine.TwoD]: { color: '#48a05c', icon: Layers, slug: '2d' },
  [ProductLine.Wood]: { color: '#800808', icon: TreePine, slug: 'wood' },
  [ProductLine.Embroidery]: { color: '#7f9a2b', icon: Scissors, slug: 'embroidery' },
  [ProductLine.Led]: { color: '#c9a400', icon: Lightbulb, slug: 'led' },
  [ProductLine.Canvas]: { color: '#e01008', icon: Image, slug: 'canvas' },
  [ProductLine.Dropship]: { color: '#5b6b7b', icon: Package, slug: 'dropship' },
};

export { PRODUCT_LINES, ProductLine };

export function isProductLine(v: string | null | undefined): v is ProductLine {
  return !!v && (PRODUCT_LINES as readonly string[]).includes(v);
}

export function productLineColor(line?: string | null): string {
  return isProductLine(line) ? PRODUCT_LINE_META[line].color : '#6b7280';
}

/** Route con `/portal/orders/<slug>` của từng dòng. */
export function productLineHref(line: ProductLine): string {
  return `/portal/orders/${PRODUCT_LINE_META[line].slug}`;
}
