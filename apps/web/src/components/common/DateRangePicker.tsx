import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Calendar, ChevronDown, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { cn } from '@/utils/cn';
import { DATE_PRESETS, matchPreset, QUICK_PRESET_KEYS } from '@/utils/dateRangePresets';

function presetLabel(t: TFunction<'common'>, key: string, fallback: string): string {
  return t(`datePresets.${key}`, { defaultValue: fallback });
}

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Cho phép clear range về `('', '')`. Default `true`. */
  clearable?: boolean;
  /** Override label khi `from === to === ''`. Default "Chọn ngày". */
  placeholder?: string;
  /**
   * `popover` (default) — nút + Popover gói gọn 8 preset + input tùy chỉnh.
   * `inline` — thanh ngang chiếm nguyên chiều ngang: 7 pill preset nhanh +
   * pill "Tùy chỉnh" (mở popover chọn tay). Xem `DateRangePicker-InlineRedesign.md`.
   */
  variant?: 'popover' | 'inline';
  className?: string;
}

/**
 * Block "2 input date + Áp dụng/Xóa" dùng chung cho cả popover chính lẫn popover
 * "Tùy chỉnh" của variant inline. Draft state init từ props mỗi lần mount (Radix
 * unmount content khi đóng nên mở lại luôn sync giá trị mới nhất).
 */
function CustomRangeBody({
  from,
  to,
  onChange,
  clearable,
  heading,
  onClose,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  clearable: boolean;
  heading: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const hasValue = !!(from || to);

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{heading}</p>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">{t('dateRange.from')}</label>
        <Input
          type="date"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        <label className="text-xs text-muted-foreground">{t('dateRange.to')}</label>
        <Input
          type="date"
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
          className="h-8 text-xs flex-1"
        />
      </div>
      <div className="flex items-center justify-end gap-1.5 pt-1">
        {clearable && hasValue && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              onChange('', '');
              onClose();
            }}
          >
            <X size={11} /> {t('actions.clearFilter')}
          </Button>
        )}
        <Button
          size="sm"
          className="text-xs h-7"
          disabled={draftFrom === from && draftTo === to}
          onClick={() => {
            onChange(draftFrom, draftTo);
            onClose();
          }}
        >
          {t('actions.apply')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Filter ngày dùng chung toàn app. 2 biến thể:
 *   - `popover` (default): 1 nút → Popover chứa 8 preset + input tùy chỉnh.
 *   - `inline`: thanh preset ngang hiện sẵn ra ngoài (không cần bấm mới thấy).
 *
 * Pattern dùng:
 *   <DateRangePicker from={createdFrom} to={createdTo}
 *     onChange={(f, t) => { setCreatedFrom(f); setCreatedTo(t); }} />
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  clearable = true,
  placeholder,
  variant = 'popover',
  className,
}: DateRangePickerProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const activeKey = matchPreset(from, to);
  const hasValue = !!(from || to);
  const resolvedPlaceholder = placeholder ?? t('dateRange.placeholder');

  // ─── Variant inline ─────────────────────────────────────────────
  if (variant === 'inline') {
    const isCustom = activeKey === null && hasValue;
    const quickPresets = QUICK_PRESET_KEYS.map((k) => DATE_PRESETS.find((p) => p.key === k)).filter(
      (p): p is (typeof DATE_PRESETS)[number] => !!p,
    );
    const pillBase =
      'h-8 px-2.5 rounded-md border text-xs transition-colors whitespace-nowrap inline-flex items-center gap-1 shrink-0 snap-start touch:h-10 touch:px-3.5 touch:rounded-full';
    const pillActive = 'border-primary bg-primary/10 text-primary font-medium';
    const pillIdle = 'border-border bg-background hover:bg-muted/40 text-foreground';

    return (
      // Phones: ONE row you swipe sideways (hidden scrollbar, bleeds to the card edge) instead of
      // three wrapped rows of pills that pushed the list down; `sm` and up keeps the wrap.
      <div
        className={cn(
          'flex w-full items-center gap-1.5 overflow-x-auto max-sm:-mx-3 max-sm:w-[calc(100%+1.5rem)] max-sm:snap-x max-sm:scroll-px-3 max-sm:px-3 max-sm:pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible',
          className,
        )}
      >
        {quickPresets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              const r = p.range();
              onChange(r.from, r.to);
            }}
            className={cn(pillBase, p.key === activeKey ? pillActive : pillIdle)}
          >
            {presetLabel(t, p.key, p.label)}
          </button>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={cn(pillBase, isCustom ? pillActive : pillIdle)}>
              <Calendar size={12} className={cn(!isCustom && 'text-muted-foreground')} />
              {isCustom ? `${fmt(from)} → ${fmt(to)}` : t('dateRange.custom')}
              <ChevronDown size={11} className="text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[320px] p-3" sideOffset={6}>
            <CustomRangeBody
              from={from}
              to={to}
              onChange={onChange}
              clearable={clearable}
              heading={t('dateRange.customHeading')}
              onClose={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  // ─── Variant popover (mặc định — giữ nguyên hành vi cũ) ──────────
  const activeLabel = activeKey
    ? presetLabel(t, activeKey, DATE_PRESETS.find((p) => p.key === activeKey)?.label ?? '')
    : undefined;
  const label = activeLabel || (from && to ? `${fmt(from)} → ${fmt(to)}` : from || to || resolvedPlaceholder);

  return (
    <div className={cn('inline-flex items-center', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs justify-start font-normal">
            <Calendar size={13} className="text-muted-foreground" />
            <span className={cn(!hasValue && 'text-muted-foreground')}>{label}</span>
            <ChevronDown size={12} className="text-muted-foreground ml-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[420px] p-3" sideOffset={6}>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {DATE_PRESETS.map((p) => {
              const isActive = p.key === activeKey;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    const r = p.range();
                    onChange(r.from, r.to);
                    setOpen(false);
                  }}
                  className={cn(
                    'text-xs h-8 px-2 rounded-md border transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border bg-background hover:bg-muted/40 text-foreground',
                  )}
                >
                  {presetLabel(t, p.key, p.label)}
                </button>
              );
            })}
          </div>

          <div className="border-t border-border pt-3">
            <CustomRangeBody
              from={from}
              to={to}
              onChange={onChange}
              clearable={clearable}
              heading={t('dateRange.customHeadingOr')}
              onClose={() => setOpen(false)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function fmt(iso: string): string {
  // yyyy-mm-dd → dd/mm
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y.slice(2)}`;
}
