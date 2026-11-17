import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { isSystemOnlyPriority, ORDER_PRIORITIES_SETTABLE, OrderPriority } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { type SelectOption, SelectPopover } from './SelectPopover';

export function buildPriorityMeta(
  t: TFunction<'orders'>,
): Record<OrderPriority, { label: string; cls: string; dot: string }> {
  return {
    [OrderPriority.Low]: {
      label: t('priority.low'),
      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
      dot: '#3b82f6',
    },
    [OrderPriority.Normal]: {
      label: t('priority.normal'),
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      dot: '#f59e0b',
    },
    [OrderPriority.High]: {
      label: t('priority.high'),
      cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
      dot: '#ef4444',
    },
    [OrderPriority.Urgent]: {
      label: t('priority.urgent'),
      cls: 'bg-red-600 text-white dark:bg-red-600 dark:text-white',
      dot: '#b91c1c',
    },
  };
}

/** Badge đọc-only cho card Kanban — không có popover chỉnh sửa. */
export function PriorityBadge({ priority }: { priority?: OrderPriority | number | null }) {
  const { t } = useTranslation('orders');
  const priorityMeta = useMemo(() => buildPriorityMeta(t), [t]);
  if (!priority) return null;
  const meta = priorityMeta[priority as OrderPriority];
  if (!meta) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap',
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}

interface Props {
  orderId: string;
  value?: OrderPriority | number | null;
  canEdit: boolean;
  onUpdated?: (newValue: number | null) => void;
}

/**
 * Cell "Ưu tiên" — chọn 3 mức `ORDER_PRIORITIES_SETTABLE` (không qua workshop_config).
 * Đơn ở mức 4 "Làm ngay" (chỉ hệ thống đặt) → badge đọc-only, không mở popover. Cùng pattern
 * `ColorBadgeSelectCell`/`AssigneeSelectCell`: badge trigger + `SelectPopover`,
 * PATCH qua `updateField` field `priority`.
 */
export function PrioritySelectCell({ orderId, value, canEdit, onUpdated }: Props) {
  const { t } = useTranslation('orders');
  const priorityMeta = useMemo(() => buildPriorityMeta(t), [t]);
  const priorityOptions: SelectOption[] = useMemo(
    () =>
      ORDER_PRIORITIES_SETTABLE.map((p) => ({
        _id: String(p),
        code: String(p),
        name: priorityMeta[p].label,
        color: priorityMeta[p].dot,
      })),
    [priorityMeta],
  );
  const [saving, setSaving] = useState(false);
  const current = value ? priorityMeta[value as OrderPriority] : undefined;

  const handleSelect = async (newCode: string | null) => {
    const newValue = newCode ? Number(newCode) : null;
    if (newValue === (value || null)) return;
    try {
      setSaving(true);
      await RepositoryRemote.order.updateField(orderId, { field: 'priority', value: newCode });
      toast.success(
        newValue
          ? t('cells.changedTo', { name: priorityMeta[newValue as OrderPriority].label })
          : t('cells.priority.cleared'),
      );
      onUpdated?.(newValue);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  const trigger = (
    <span
      title={current?.label || t('cells.notSelected')}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border border-transparent whitespace-nowrap',
        current ? current.cls : 'bg-muted text-muted-foreground border-dashed border-border',
      )}
    >
      {saving && <Spinner size={10} className="text-current" />}
      {current?.label || '—'}
    </span>
  );

  if (isSystemOnlyPriority(value)) return trigger;

  return (
    <SelectPopover
      options={priorityOptions}
      value={value ? String(value) : undefined}
      onSelect={handleSelect}
      disabled={!canEdit || saving}
      renderOption={(it) => (
        <span className="inline-flex items-center gap-2 w-full">
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
          <span className="flex-1">{it.name}</span>
        </span>
      )}
    >
      {trigger}
    </SelectPopover>
  );
}
