import React from 'react';
import { useTranslation } from 'react-i18next';
import { XCircle } from 'lucide-react';

/**
 * Scan popups: a cancelled order (e.g. the customer cancelled after it was printed) is announced
 * first and loud, so the station pulls the item out instead of working on it. Stage actions,
 * printing and stock-out are locked by the caller (`scanActionLock`); this only says why.
 * Same placement as `ScanHeldBanner`.
 */
export function ScanCancelledBanner({ cancelReason }: { cancelReason?: string | null }) {
  const { t } = useTranslation('scanError');
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border-2 border-tone-danger bg-tone-danger/10 p-4 text-tone-danger max-md:p-3"
    >
      <XCircle size={28} className="mt-0.5 shrink-0 max-md:size-6" />
      <div className="min-w-0">
        <div className="text-xl font-bold uppercase tracking-wide max-md:text-base">{t('cancelled.title')}</div>
        <div className="mt-0.5 text-lg font-semibold break-words max-md:text-sm">
          {cancelReason ? t('cancelled.reason', { reason: cancelReason }) : t('cancelled.noReason')}
        </div>
        <div className="mt-1 text-sm max-md:text-xs">{t('cancelled.body')}</div>
      </div>
    </div>
  );
}
