import React from 'react';
import { useTranslation } from 'react-i18next';
import { PauseCircle } from 'lucide-react';

/**
 * Scan popups: a held order (Orders.md §9b) is announced first and loud, because the station is
 * where the work physically happens. Printing and stage actions are locked by the caller; this
 * only says why. Sits under the dialog header, never inside the sticky phone footer.
 */
export function ScanHeldBanner({ holdReason }: { holdReason?: string | null }) {
  const { t } = useTranslation('scanError');
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border-2 border-tone-danger bg-tone-danger/10 p-4 text-tone-danger max-md:p-3"
    >
      <PauseCircle size={28} className="mt-0.5 shrink-0 max-md:size-6" />
      <div className="min-w-0">
        <div className="text-xl font-bold uppercase tracking-wide max-md:text-base">{t('held.title')}</div>
        <div className="mt-0.5 text-lg font-semibold break-words max-md:text-sm">
          {holdReason ? t('held.reason', { reason: holdReason }) : t('held.noReason')}
        </div>
        <div className="mt-1 text-sm max-md:text-xs">{t('held.body')}</div>
      </div>
    </div>
  );
}
