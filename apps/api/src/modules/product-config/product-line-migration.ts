import type { ProductLine, ProductLineSource } from 'shared';
import { ProductLine as PL } from 'shared';

/**
 * PRD-8 — suy luận DÒNG SẢN PHẨM cho sản phẩm chưa gắn (hàm thuần, có spec).
 * Thứ tự ưu tiên khớp kế hoạch: collection → xưởng → phòng máy → mã in → mặc định 3d.
 * Trả `source` để admin biết cái nào máy đoán (`default` = không có tín hiệu).
 */
export interface ProductLineSignals {
  /** shortName/name của các collection sản phẩm thuộc về (đã lower/trim). */
  collections?: string[];
  /** shortName xưởng (đã upper). */
  factoryShortName?: string;
  /** shortName phòng máy (đã upper). */
  machineTypeShortName?: string;
  /** `printMethod` của sản phẩm (đã lower). */
  printMethod?: string;
}

/** Ưu tiên khi 1 sản phẩm thuộc nhiều collection khác dòng: thêu > gỗ > 2d > 3d. */
const COLLECTION_PRIORITY: Array<[RegExp, ProductLine]> = [
  [/^(embroidery|theu|thêu)$/, PL.Embroidery],
  [/^(handmade[-\s]?wood|wood|go|gỗ)$/, PL.Wood],
  [/^2d$/, PL.TwoD],
  [/^3d$/, PL.ThreeD],
];

export function inferProductLine(s: ProductLineSignals): { productLine: ProductLine; source: ProductLineSource } {
  const cols = (s.collections ?? []).map((c) => c.trim().toLowerCase());
  for (const [rx, line] of COLLECTION_PRIORITY) {
    if (cols.some((c) => rx.test(c))) return { productLine: line, source: 'collection' };
  }
  const f = (s.factoryShortName ?? '').toUpperCase();
  if (f === 'TNW') return { productLine: PL.Wood, source: 'factory' };
  if (f === 'MLDTF') return { productLine: PL.TwoD, source: 'factory' };
  if ((s.machineTypeShortName ?? '').toUpperCase() === 'HT') return { productLine: PL.Embroidery, source: 'machineType' };
  const pm = (s.printMethod ?? '').trim().toLowerCase();
  if (pm === 'embroidery' || pm === 'emb') return { productLine: PL.Embroidery, source: 'printMethod' };
  if (pm === 'dtf' || pm === 'dtg') return { productLine: PL.TwoD, source: 'printMethod' };
  return { productLine: PL.ThreeD, source: 'default' };
}

/** Dòng cho ĐƠN không map được sản phẩm — cùng luật nhưng không có collection. */
export function inferOrderProductLine(s: Omit<ProductLineSignals, 'collections'>): ProductLine {
  return inferProductLine(s).productLine;
}

/**
 * Product line for a NEWLY created product, from its OnosPod collection only. Anything the
 * collection does not name (e.g. `dropship`) is left unset: guessing would silently file the
 * product under 3d. Never applied to existing products — fill-only stays fill-only.
 */
export function productLineForNew(collection: string | null | undefined) {
  const guess = inferProductLine({ collections: collection ? [collection] : [] });
  return guess.source === 'collection' ? { productLine: guess.productLine, productLineSource: guess.source } : {};
}

