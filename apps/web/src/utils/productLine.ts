import type { TFunction } from 'i18next';
import type { ProductLine } from 'shared';
import { PRODUCT_LINES } from 'shared';

/**
 * PRD-8 — Dòng sản phẩm (3d/2d/wood/embroidery/led/canvas/dropship): màu badge + nhãn i18n
 * dùng chung ở admin (tab sản phẩm, trang chi tiết). Nhãn tra `products:productLines.<code>`
 * (I18n.md §2.3 — nhãn enum shared để ở FE dictionary, KHÔNG sửa shared).
 */
export const PRODUCT_LINE_BADGE_CLASS: Record<ProductLine, string> = {
  '3d': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
  '2d': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200',
  wood: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  embroidery: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200',
  led: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
  canvas: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  dropship: 'bg-slate-200 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
};

export const productLineLabel = (t: TFunction<'products'>, code?: string | null): string =>
  code ? t(`productLines.${code}`, { defaultValue: code }) : t('productLines.none');

export const PRODUCT_LINE_OPTIONS = PRODUCT_LINES;
