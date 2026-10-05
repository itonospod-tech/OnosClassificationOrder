import type { WorkshopStageFilterKey } from 'shared';

/**
 * Màu MỘT NGUỒN cho 8 chặng (+ `done`) của trang "Đơn hàng theo xưởng": ô phễu
 * (`WorkshopStageStrip`), thanh mini theo loại sản phẩm (`WorkshopTypeRail`) và chip
 * chặng ở tiêu đề bảng phải dùng CÙNG bảng này để người xem đối chiếu bằng mắt.
 * Dùng lớp Tailwind tường minh (không `bg-primary` — biến `--primary` của theme là
 * navy đậm, không phải indigo của hệ thiết kế).
 */
export const STAGE_COLORS: Record<WorkshopStageFilterKey, { bar: string; dot: string; chip: string; tile: string; tileActive: string; text: string }> = {
  'tool-check': { bar: 'bg-slate-400', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200', tile: 'border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-900/60 dark:bg-slate-950/40 dark:hover:bg-slate-950/60', tileActive: 'border-slate-500 bg-slate-100 dark:border-slate-400 dark:bg-slate-900/50', text: 'text-slate-700 dark:text-slate-300' },
  designer: { bar: 'bg-sky-400', dot: 'bg-sky-400', chip: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200', tile: 'border-sky-200 bg-sky-50 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/40 dark:hover:bg-sky-950/60', tileActive: 'border-sky-500 bg-sky-100 dark:border-sky-400 dark:bg-sky-900/50', text: 'text-sky-700 dark:text-sky-300' },
  print: { bar: 'bg-indigo-500', dot: 'bg-indigo-500', chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200', tile: 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/60', tileActive: 'border-indigo-500 bg-indigo-100 dark:border-indigo-400 dark:bg-indigo-900/50', text: 'text-indigo-700 dark:text-indigo-300' },
  press: { bar: 'bg-amber-400', dot: 'bg-amber-400', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200', tile: 'border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:hover:bg-amber-950/60', tileActive: 'border-amber-500 bg-amber-100 dark:border-amber-400 dark:bg-amber-900/50', text: 'text-amber-700 dark:text-amber-300' },
  'qc-post-press': { bar: 'bg-violet-400', dot: 'bg-violet-400', chip: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200', tile: 'border-violet-200 bg-violet-50 hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/40 dark:hover:bg-violet-950/60', tileActive: 'border-violet-500 bg-violet-100 dark:border-violet-400 dark:bg-violet-900/50', text: 'text-violet-700 dark:text-violet-300' },
  'sew-in': { bar: 'bg-emerald-400', dot: 'bg-emerald-400', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200', tile: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60', tileActive: 'border-emerald-500 bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-900/50', text: 'text-emerald-700 dark:text-emerald-300' },
  'sew-out': { bar: 'bg-teal-500', dot: 'bg-teal-500', chip: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200', tile: 'border-teal-200 bg-teal-50 hover:bg-teal-100 dark:border-teal-900/60 dark:bg-teal-950/40 dark:hover:bg-teal-950/60', tileActive: 'border-teal-500 bg-teal-100 dark:border-teal-400 dark:bg-teal-900/50', text: 'text-teal-700 dark:text-teal-300' },
  pack: { bar: 'bg-lime-500', dot: 'bg-lime-500', chip: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-200', tile: 'border-lime-200 bg-lime-50 hover:bg-lime-100 dark:border-lime-900/60 dark:bg-lime-950/40 dark:hover:bg-lime-950/60', tileActive: 'border-lime-500 bg-lime-100 dark:border-lime-400 dark:bg-lime-900/50', text: 'text-lime-700 dark:text-lime-300' },
  done: { bar: 'bg-emerald-700', dot: 'bg-emerald-700', chip: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100', tile: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60', tileActive: 'border-emerald-500 bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-900/50', text: 'text-emerald-700 dark:text-emerald-300' },
};

/** Thứ tự vẽ thanh mini (cùng thứ tự phễu, thêm `done` cuối). */
export const STAGE_BAR_ORDER: WorkshopStageFilterKey[] = [
  'tool-check',
  'designer',
  'print',
  'press',
  'qc-post-press',
  'sew-in',
  'sew-out',
  'pack',
  'done',
];
