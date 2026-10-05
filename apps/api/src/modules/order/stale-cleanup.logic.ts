import { FULFILLMENT_STAGES, OPEN_ORDER_STALE_DAYS, STALE_CLEANUP_NO_ACTIVITY_DAYS } from 'shared';

/**
 * Stale-order cleanup (Orders.md §23b): rules shared by the list (Mongo), the preview and the run
 * (JS re-check). Pure, so the spec covers them without a database.
 *
 * "Production activity" = a moment someone or the pipeline actually moved the order: tool check,
 * designer steps, fulfillment stage steps, timeline entries. Order logs are NOT activity: sync and
 * backfill jobs write there too, and would make a dead order look alive.
 */
const DAY_MS = 86_400_000;

export const PRODUCTION_ACTIVITY_PATHS: readonly string[] = [
  'toolCheckedAt',
  'designerAssignedAt',
  'designerStartedAt',
  'designerFirstStartedAt',
  'designerCompletedAt',
  ...FULFILLMENT_STAGES.flatMap((s) => ['waitingAt', 'startedAt', 'firstStartedAt', 'completedAt'].map((k) => `fulfillmentStages.${s}.${k}`)),
];
/** Array field: each entry's `at`. */
export const TIMELINE_PATH = 'fulfillmentTimeline';

/** Mongo expression: the latest production activity, or null. Same paths as `lastProductionActivity`. */
export function lastProductionActivityExpr(): Record<string, unknown> {
  return { $max: [...PRODUCTION_ACTIVITY_PATHS.map((p) => `$${p}`), { $max: `$${TIMELINE_PATH}.at` }] };
}

const get = (doc: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), doc);
const toDate = (v: unknown): Date | undefined => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Latest production activity and which field it came from (shown as evidence). */
export function lastProductionActivity(doc: Record<string, unknown>): { at: Date; field: string } | null {
  let best: { at: Date; field: string } | null = null;
  const consider = (at: Date | undefined, field: string) => {
    if (at && (!best || at > best.at)) best = { at, field };
  };
  for (const p of PRODUCTION_ACTIVITY_PATHS) consider(toDate(get(doc, p)), p);
  for (const e of (doc[TIMELINE_PATH] as Array<{ at?: unknown; stage?: string; action?: string }> | undefined) ?? []) {
    consider(toDate(e?.at), `timeline:${e?.stage ?? ''}:${e?.action ?? ''}`);
  }
  return best;
}

/** Orders that entered production before this instant are stale. Same boundary as the CEO Dashboard `staleOpen`. */
export const staleCutoff = (now: Date): Date => new Date(now.getTime() - OPEN_ORDER_STALE_DAYS * DAY_MS);

export type StaleBlockReason = 'not-found' | 'cancelled' | 'completed' | 'held' | 'not-stale' | 'recent-activity' | 'unmapped' | 'excluded-factory';

/**
 * Can this order be cleaned up? Re-checked on every preview and run, never trusted from the client.
 * `excludedFactoryId` = the US factory (out of the production flow, never in the list).
 */
export function staleEligibility(doc: Record<string, unknown> | null | undefined, now: Date, excludedFactoryId: string | null): StaleBlockReason | null {
  if (!doc) return 'not-found';
  if (doc.cancelledAt) return 'cancelled';
  if (doc.fulfillmentCompletedAt) return 'completed';
  if (!doc.factoryId) return 'unmapped';
  if (excludedFactoryId && String(doc.factoryId) === excludedFactoryId) return 'excluded-factory';
  if (doc.heldAt) return 'held';
  const cutoff = staleCutoff(now);
  const inProd = toDate(doc.inProductionAt);
  if (!inProd || inProd >= cutoff) return 'not-stale';
  const last = lastProductionActivity(doc);
  if (last && last.at >= cutoff) return 'recent-activity';
  return null;
}

/**
 * When the cleanup records the order as finished: the last real production activity, or, with
 * none, `inProductionAt + STALE_CLEANUP_NO_ACTIVITY_DAYS` (the SLA N2 horizon). Never today (that
 * would put thousands of completions on one day of every throughput / "stock out" report), never
 * before `inProductionAt`.
 */
export function staleCleanupEnd(doc: Record<string, unknown>): Date {
  const inProd = toDate(doc.inProductionAt) as Date; // eligibility guarantees it
  const last = lastProductionActivity(doc);
  if (last && last.at > inProd) return last.at;
  return new Date(inProd.getTime() + STALE_CLEANUP_NO_ACTIVITY_DAYS * DAY_MS);
}

/**
 * Stage key of one order in JS. MIRROR of `workshopStageSwitchExpr` (utils/workshop-stage.ts), which
 * the list uses in Mongo; the spec runs both on the same fixtures.
 */
export function staleStageKey(doc: Record<string, unknown>): string {
  if (doc.fulfillmentCompletedAt) return 'done';
  const cur = doc.currentFulfillmentStage as string | undefined;
  if (cur && (FULFILLMENT_STAGES as readonly string[]).includes(cur)) return cur;
  const ds = (doc.designerStatus as string | undefined) ?? 'unassigned';
  if (ds === 'done') return 'print';
  if (ds !== 'unassigned') return 'designer';
  if (!((doc.toolResultNote as string | undefined) ?? '')) return 'tool-check';
  return 'designer';
}
