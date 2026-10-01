import React from 'react';
import { ChevronRight } from 'lucide-react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { cn } from '@/utils/cn';

import { useIsMobile } from '@/hooks/useMediaQuery';

/**
 * Where a column goes on the phone card. Anything not `title`/`subtitle`/`trailing`/`hidden` is
 * a `field`: a "label: value" line under the title, label taken from the column `header`.
 */
export type ResponsiveListSlot = 'title' | 'subtitle' | 'trailing' | 'field' | 'hidden';

export interface ResponsiveColumn<T> {
  key: string;
  /** Table header text, also the label of the phone `field` line. */
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Phone card placement (default `field`). One `title` per list; `trailing` = status chip / number on the right. */
  mobile?: ResponsiveListSlot;
  /** Width / alignment classes for the table cell AND its header. Desktop only. Text styling
   *  (weight, color, size) belongs inside `cell`, otherwise the header picks it up too. */
  className?: string;
}

export interface ResponsiveListProps<T> {
  rows: T[];
  columns: ResponsiveColumn<T>[];
  rowKey: (row: T) => string;
  /** Row / card tap. Cards become a full-width button with a chevron. */
  onRowClick?: (row: T) => void;
  /** Shown instead of the list when `rows` is empty (not while `loading`). */
  empty?: React.ReactNode;
  loading?: boolean;
  /** Table on screens ≥ md, cards below. Override for a list that should stay a table (rare). */
  forceTable?: boolean;
  className?: string;
}

/**
 * One column definition, two layouts (DesignSystem-LegacyParity.md §10): the shared `Table`
 * on wide screens, a stack of tappable cards on phones — no sideways scrolling. Most workers
 * open the app on a phone at their station, where a ten-column table is unreadable.
 *
 * ```tsx
 * <ResponsiveList
 *   rows={orders}
 *   rowKey={(o) => o._id}
 *   onRowClick={(o) => openOrder(o)}
 *   empty={t('empty')}
 *   columns={[
 *     { key: 'id', header: t('col.id'), cell: (o) => o.productionId, mobile: 'title' },
 *     { key: 'type', header: t('col.type'), cell: (o) => o.type, mobile: 'subtitle' },
 *     { key: 'status', header: t('col.status'), cell: (o) => <StatusChip status={o.status} />, mobile: 'trailing' },
 *     { key: 'factory', header: t('col.factory'), cell: (o) => o.factoryShortName },
 *     { key: 'note', header: t('col.note'), cell: (o) => o.note, mobile: 'hidden' },
 *   ]}
 * />
 * ```
 */
export function ResponsiveList<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
  loading,
  forceTable,
  className,
}: ResponsiveListProps<T>) {
  const isMobile = useIsMobile();

  if (!loading && rows.length === 0 && empty) {
    return <div className={cn('py-10 text-center text-sm text-muted-foreground', className)}>{empty}</div>;
  }

  if (!isMobile || forceTable) {
    return (
      <Table className={className}>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={c.className}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {columns.map((c) => (
                <TableCell key={c.key} className={c.className}>
                  {c.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  const slot = (c: ResponsiveColumn<T>) => c.mobile ?? 'field';
  const title = columns.find((c) => slot(c) === 'title');
  const subtitle = columns.find((c) => slot(c) === 'subtitle');
  const trailing = columns.filter((c) => slot(c) === 'trailing');
  const fields = columns.filter((c) => slot(c) === 'field');

  return (
    <ul className={cn('space-y-2', className)}>
      {rows.map((row) => {
        const body = (
          <>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {title && <div className="font-semibold text-foreground">{title.cell(row)}</div>}
                {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle.cell(row)}</div>}
              </div>
              {trailing.length > 0 && (
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {trailing.map((c) => (
                    <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>
                  ))}
                </div>
              )}
              {onRowClick && <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />}
            </div>
            {fields.length > 0 && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {fields.map((c) => (
                  <React.Fragment key={c.key}>
                    <dt className="text-muted-foreground">{c.header}</dt>
                    <dd className="min-w-0 break-words text-foreground">{c.cell(row)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
          </>
        );
        // Cards are the touch target: min 44pt tall, full width, pressed state instead of hover.
        const cardClass = 'block w-full rounded-xl bg-card p-4 text-left shadow-sm ring-1 ring-border/60';
        return (
          <li key={rowKey(row)}>
            {onRowClick ? (
              <button
                type="button"
                onClick={() => onRowClick(row)}
                className={cn(
                  cardClass,
                  'min-h-[44px] cursor-pointer border-none transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-info',
                )}
              >
                {body}
              </button>
            ) : (
              <div className={cardClass}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
