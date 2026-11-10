import dayjs from 'dayjs';
import type { TFunction } from 'i18next';

import { getStageLabel } from '@/utils/fulfillmentStageLabel';

const STATUS_KEY: Record<string, string> = {
  waiting: 'waiting',
  'in-progress': 'inProgress',
  done: 'done',
  rework: 'rework',
};

/**
 * One line for a whole `fulfillmentStages` value (order-log snapshot of a stage wipe, bulk-undo preview):
 * "Print: Waiting (10/11 19:53)" per stage, the time being when the stage was sent back for rework, else
 * when it started waiting. Empty → '—'.
 */
export function summarizeFulfillmentStages(value: unknown, t: TFunction): string {
  if (!value || typeof value !== 'object') return '—';
  const parts = Object.entries(value as Record<string, { status?: string; waitingAt?: string | Date; reworkAt?: string | Date } | null>).map(
    ([stage, s]) => {
      const status = s?.status
        ? t(`fulfillmentStatusLabels.${STATUS_KEY[s.status] ?? s.status}`, { ns: 'orderLog', defaultValue: s.status })
        : '—';
      const at = (s?.status === 'rework' && s.reworkAt) || s?.waitingAt;
      return `${getStageLabel(t, stage)}: ${status}${at ? ` (${dayjs(at).format('DD/MM HH:mm')})` : ''}`;
    },
  );
  return parts.length ? parts.join('; ') : '—';
}
