import React from 'react';

import { cn } from '@/utils/cn';

export interface PageHeaderProps {
  title: React.ReactNode;
  /** One short sentence under the title. Hidden on phones when `hideDescriptionOnMobile`. */
  description?: React.ReactNode;
  /** Leading icon (lucide, size 20). Shown in a tinted tile from `sm` up; dropped on phones to give the title the width. */
  icon?: React.ReactNode;
  /** Buttons / controls for the page. They sit right of the title on wide screens and wrap onto their own row on phones. */
  actions?: React.ReactNode;
  /** Phones: drop the description — for station pages where the first screen must reach the input. */
  hideDescriptionOnMobile?: boolean;
  className?: string;
}

/**
 * Title block at the top of a page (DesignSystem-LegacyParity.md §10).
 *
 * Replaces the hand-built `flex items-center` row (icon · title · button) that every page copied.
 * That row had one failure on phones: an action button with a long label does not shrink, so the
 * title column was squeezed to a few pixels and broke into one word per line — on
 * `/orders/scan-error` it filled half the screen before the scan input. Here the actions get their
 * own row below `sm`, and the title always keeps the full width.
 *
 * ```tsx
 * <PageHeader
 *   icon={<ScanLine size={20} />}
 *   title={t('page.titleStage')}
 *   description={t('page.descStage')}
 *   hideDescriptionOnMobile
 *   actions={<Button variant="outline" onClick={print}>{t('actionSheet.printBtn')}</Button>}
 * />
 * ```
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  hideDescriptionOnMobile = false,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-tone-info/10 text-tone-info sm:flex">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description && (
            <p className={cn('mt-1 text-sm text-muted-foreground', hideDescriptionOnMobile && 'hidden sm:block')}>
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>}
    </div>
  );
}
