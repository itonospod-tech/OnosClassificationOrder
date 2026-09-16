import React from 'react';
import { useTranslation } from 'react-i18next';
import { PauseCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

/**
 * Badge "Đang giữ" (hổ phách) + hiển thị luôn LÝ DO giữ (nếu có) cạnh badge
 * (truncate, full trong tooltip). Dùng chung cho mọi bảng order. Khác
 * `CancelledBadge` ở chỗ đơn giữ REVERSIBLE — mở lại để tiếp tục.
 *
 * `source='onospod'` (đồng bộ tự giữ, Orders.md §9d) → lý do dịch theo ngôn ngữ
 * thay vì chuỗi tiếng Việt lưu trong `holdReason`.
 */
export function HeldBadge({
  reason,
  source,
  className,
}: {
  reason?: string | null;
  source?: string | null;
  className?: string;
}) {
  const { t } = useTranslation('orders');
  const shownReason = source === 'onospod' ? t('heldBadge.onospodReason') : reason;
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 min-w-0 ${className ?? ''}`}>
      <Badge
        className="text-[10px] px-1 py-0 shrink-0 gap-0.5 border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
        title={shownReason || t('heldBadge.title')}
      >
        <PauseCircle size={10} />
        {t('heldBadge.label')}
      </Badge>
      {shownReason && (
        <span
          className="text-[10px] text-amber-600 dark:text-amber-400 truncate max-w-[180px]"
          title={shownReason}
        >
          {shownReason}
        </span>
      )}
    </span>
  );
}

/**
 * Nhãn nhỏ "OnosPod đang giữ" — đơn mang cờ `onospodHold` nhưng bên mình KHÔNG
 * giữ (đã xong, đã hủy, hoặc nhân viên đã mở giữ đợt này). Chỉ báo, không khóa.
 */
export function OnospodHoldBadge({ className }: { className?: string }) {
  const { t } = useTranslation('orders');
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1 py-0 shrink-0 gap-0.5 border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300 ${className ?? ''}`}
      title={t('heldBadge.onospodFlagTitle')}
    >
      <PauseCircle size={10} />
      {t('heldBadge.onospodFlag')}
    </Badge>
  );
}
