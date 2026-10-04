import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { cn } from '@/utils/cn';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];
  onChange: (page: number, pageSize: number) => void;
  className?: string;
  /** Đang tải lại dữ liệu — vô hiệu hoá điều khiển thay vì ẩn cả bar. */
  disabled?: boolean;
}

export function Pagination({
  page,
  pageSize,
  total,
  pageSizeOptions = [10, 20, 50, 100],
  onChange,
  className,
  disabled = false,
}: PaginationProps) {
  const { t } = useTranslation('common');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  // Compute page numbers to show (sliding window of 5)
  const pages: number[] = [];
  const windowSize = 5;
  let start = Math.max(1, safePage - 2);
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  const go = (p: number) => {
    if (p < 1 || p > totalPages || p === safePage) return;
    onChange(p, pageSize);
  };

  return (
    <div className={cn('flex items-center justify-between gap-3 flex-wrap', disabled && 'opacity-60', className)}>
      <p className="text-xs text-muted-foreground">
        {total === 0 ? t('pagination.noResults') : t('pagination.showing', { from, to, total })}
      </p>

      <div className="flex max-w-full flex-wrap items-center gap-1.5">
        <select
          value={pageSize}
          onChange={(e) => onChange(1, Number(e.target.value))}
          disabled={disabled}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>
              {t('pagination.perPage', { size: s })}
            </option>
          ))}
        </select>

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 touch:h-11 touch:w-11 max-sm:hidden"
          onClick={() => go(1)}
          disabled={disabled || safePage === 1}
        >
          <ChevronsLeft size={14} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 touch:h-11 touch:w-11"
          onClick={() => go(safePage - 1)}
          disabled={disabled || safePage === 1}
        >
          <ChevronLeft size={14} />
        </Button>

        {pages.map((p) => (
          <Button
            key={p}
            variant={p === safePage ? 'default' : 'outline'}
            size="sm"
            // Phones keep only the current page and its neighbours so the row fits 390px.
            className={cn('h-8 min-w-8 px-2 touch:h-11 touch:min-w-11', Math.abs(p - safePage) > 1 && 'max-sm:hidden')}
            onClick={() => go(p)}
            disabled={disabled}
          >
            {p}
          </Button>
        ))}

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 touch:h-11 touch:w-11"
          onClick={() => go(safePage + 1)}
          disabled={disabled || safePage === totalPages}
        >
          <ChevronRight size={14} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 touch:h-11 touch:w-11 max-sm:hidden"
          onClick={() => go(totalPages)}
          disabled={disabled || safePage === totalPages}
        >
          <ChevronsRight size={14} />
        </Button>
      </div>
    </div>
  );
}
