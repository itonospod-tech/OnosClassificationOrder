/**
 * "Support hold" = orders a worker sent back to Support (tool check) that nobody has cleared yet
 * (`productionErrorSource='tool-check'` AND `toolResultNote='error'`).
 *
 * The report's per-day "Cần làm lại" column only sees a 7-day cohort and has no age, so an old hold
 * silently drops out of it. This line is counted over ALL ages and watches the oldest one — it is the
 * stop-rule watcher of `documents/Plans/ToolCheck-Redesign.md`.
 */
export type SupportHold = { count: number; oldestHours: number };

export const SUPPORT_HOLD_WARN_HOURS = 24;

/** One short Telegram line, or null when nothing is held (a quiet report stays quiet). */
export function supportHoldLine(hold: SupportHold | null | undefined): string | null {
  if (!hold || hold.count <= 0) return null;
  const hours = Math.max(0, Math.round(hold.oldestHours));
  const age = hours >= 48 ? `${Math.round(hours / 24)} ngày` : `${hours}h`;
  const text = `Hold Support: ${hold.count} đơn · già nhất ${age}`;

  return hours > SUPPORT_HOLD_WARN_HOURS ? `⚠️ ${text} (quá ${SUPPORT_HOLD_WARN_HOURS}h)` : `🛠 ${text}`;
}
