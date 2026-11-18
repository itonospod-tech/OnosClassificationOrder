import type { TFunction } from 'i18next';

/**
 * Mức độ khẩn theo GIỜ kể từ khi vào sản xuất (`inProductionAt`) — dùng chung "Nhật ký bù lỗi"
 * (`ErrorLogTab`) và "Đơn Làm ngay" (`pages/orders/urgent`). BE `getErrorLog` đếm `byUrgency`
 * cùng ngưỡng: Mới <2h · Cần làm 2–4h · Gấp 4–6h · Khẩn cấp >6h.
 */
export type UrgencyKey = 'new' | 'attention' | 'urgent' | 'critical';

export interface UrgencyMeta {
  label: string;
  cls: string;
  chipCls: string;
  ringCls: string;
}

export function buildUrgencyMeta(t: TFunction<'orderLog'>): Record<UrgencyKey, UrgencyMeta> {
  return {
    new: {
      label: t('urgency.new'),
      cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
      chipCls: 'bg-sky-50 border-sky-300 text-sky-700',
      ringCls: 'ring-sky-200',
    },
    attention: {
      label: t('urgency.attention'),
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      chipCls: 'bg-amber-50 border-amber-300 text-amber-700',
      ringCls: 'ring-amber-200',
    },
    urgent: {
      label: t('urgency.urgent'),
      cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
      chipCls: 'bg-orange-50 border-orange-300 text-orange-700',
      ringCls: 'ring-orange-200',
    },
    critical: {
      label: t('urgency.critical'),
      cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 animate-pulse',
      chipCls: 'bg-rose-50 border-rose-300 text-rose-700',
      ringCls: 'ring-rose-200',
    },
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function urgencyOf(dateStr?: string): UrgencyKey {
  if (!dateStr) return 'new';
  const age = Date.now() - new Date(dateStr).getTime();
  if (age < 2 * HOUR_MS) return 'new';
  if (age < 4 * HOUR_MS) return 'attention';
  if (age < 6 * HOUR_MS) return 'urgent';
  return 'critical';
}

/** Tuổi đơn dạng `2d 3h` / `3h 12m` / `40m`. */
export function formatDuration(dateStr?: string): string {
  if (!dateStr) return '—';
  const age = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(age / DAY_MS);
  const hours = Math.floor((age % DAY_MS) / HOUR_MS);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((age % HOUR_MS) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatDayOnly(d?: string): string {
  if (!d) return '—';
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}
