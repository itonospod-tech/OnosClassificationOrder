import { DesignerStatus, TOOL_QUEUE_STALE_MINUTES, type ToolQueueBlockKey } from 'shared';

import { type AuditContext, ORDER_LOG_SOURCE_DESIGN_REVIEW_TOOL } from '../order-log/order-log.service';

/**
 * "Return orders to the tool-check queue" (ToolCheckWorkflow.md §2.4): rules shared by the list, the
 * preview and the run. Pure, so the spec covers them without a database.
 *
 * Why it exists: the external tool's queue only takes orders whose `toolResult` is EMPTY. Setting
 * `toolResult` by hand (e.g. flipping `no-tool` to `has-tool` to "force a re-run") locks the order out
 * of the queue for good. The only write here is clearing `toolResult` back to empty.
 */
export type ToolQueueDoc = {
  cancelledAt?: unknown;
  deletedAt?: unknown;
  fulfillmentCompletedAt?: unknown;
  heldAt?: unknown;
  factoryId?: unknown;
  toolResult?: unknown;
  toolResultNote?: unknown;
  designerStatus?: unknown;
  currentFulfillmentStage?: unknown;
};

const filled = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * Can this order be returned? Re-checked on every list, preview and run — never trusted from the client.
 * `excludedFactoryId` = the US factory; `skipToolCheckIds` = factories whose flag keeps them out of the queue.
 * `toolResultNote` with ANY value means somebody is working the order by hand: it is never touched.
 */
export function toolQueueReturnEligibility(
  doc: ToolQueueDoc | null | undefined,
  excludedFactoryId: string | null,
  skipToolCheckIds: ReadonlySet<string> | readonly string[],
): ToolQueueBlockKey | null {
  if (!doc) return 'not-found';
  if (doc.cancelledAt || doc.deletedAt) return 'cancelled';
  if (doc.fulfillmentCompletedAt) return 'completed';
  if (filled(doc.toolResultNote)) return 'has-note';
  if (!filled(doc.toolResult)) return 'no-tool-result';
  if (!doc.factoryId) return 'unmapped';
  const factory = String(doc.factoryId);
  if (excludedFactoryId && factory === excludedFactoryId) return 'excluded-factory';
  const skip = skipToolCheckIds instanceof Set ? skipToolCheckIds : new Set(skipToolCheckIds);
  if (skip.has(factory)) return 'skip-tool-check';
  if (doc.heldAt) return 'held';
  // The tool's queue takes only designerStatus === 'unassigned' (`designReviewQueueFilter`, also the
  // tool's own claim filter — deliberately not widened here): an order a designer holds, or one whose
  // designerStatus is missing / null / '', would lose its result and never be picked up.
  if (!filled(doc.designerStatus)) return 'designer-status-missing';
  if (doc.designerStatus !== DesignerStatus.Unassigned) return 'designer-assigned';
  // Already in production (print, press, ...): never sent back to tool check.
  if (filled(doc.currentFulfillmentStage)) return 'in-fulfillment';

  return null;
}

export type ToolQueueRunSkip = { id: string; productionId?: string; reason: string };

/**
 * Filter of the conditional clear: the order must still be exactly as eligible as when it was loaded —
 * same `toolResult`, no note, designer 'unassigned', no production stage, open, not held, same factory.
 * A designer claim or a stage entry between the load and the write makes it match nothing.
 */
export function toolQueueReturnWriteFilter(id: string, doc: ToolQueueDoc): Record<string, unknown> {
  return {
    _id: id,
    toolResult: doc.toolResult,
    toolResultNote: { $in: [null, ''] },
    designerStatus: DesignerStatus.Unassigned,
    currentFulfillmentStage: { $in: [null, ''] },
    cancelledAt: null,
    deletedAt: null,
    fulfillmentCompletedAt: null,
    heldAt: null,
    factoryId: doc.factoryId,
  };
}

/**
 * Run loop with the I/O injected. Each order is loaded FRESH right before its write (not from a list
 * read at the start): between the preview and the click the tool may have recorded a result for some of
 * them, and those must be skipped and reported, never overwritten. `write` is a CONDITIONAL clear
 * (`toolQueueReturnWriteFilter`) that returns whether it matched — a change that lands between the load
 * and the write is reported 'changed-during-run' — and writes the order-log entry only when it matched
 * (the old value there is the only way back).
 */
export async function runToolQueueReturn(input: {
  ids: string[];
  load: (id: string) => Promise<(ToolQueueDoc & { productionId?: string }) | null>;
  write: (id: string, doc: ToolQueueDoc) => Promise<boolean>;
  excludedFactoryId: string | null;
  skipToolCheckIds: ReadonlySet<string> | readonly string[];
}): Promise<{ done: string[]; skipped: ToolQueueRunSkip[]; previous: Array<[string, string]> }> {
  const done: string[] = [];
  const previous: Array<[string, string]> = [];
  const skipped: ToolQueueRunSkip[] = [];
  for (const id of [...new Set(input.ids)]) {
    const doc = await input.load(id);
    const block = toolQueueReturnEligibility(doc, input.excludedFactoryId, input.skipToolCheckIds);
    if (block || !doc) {
      skipped.push({ id, productionId: doc?.productionId, reason: block ?? 'not-found' });
      continue;
    }
    try {
      if (!(await input.write(id, doc))) {
        skipped.push({ id, productionId: doc.productionId, reason: 'changed-during-run' });
        continue;
      }
      done.push(id);
      previous.push([id, String(doc.toolResult)]);
    } catch (err) {
      skipped.push({ id, productionId: doc.productionId, reason: (err as Error).message || 'error' });
    }
  }

  return { done, skipped, previous };
}

/**
 * Audit context of the external tool's result door (`setDesignReviewResult`): the caller's ip/userAgent plus
 * the `source` label that marks the resulting order-log rows as written BY THE TOOL. Any user on the
 * incoming context is dropped: the door is public and never acts on behalf of a person.
 */
export function designReviewToolCtx(ctx?: AuditContext): AuditContext {
  return { ip: ctx?.ip, userAgent: ctx?.userAgent, source: ORDER_LOG_SOURCE_DESIGN_REVIEW_TOOL };
}

/** Outcome of the "last tool write" lookup. `known: false` = the lookup failed or timed out: NO verdict. */
export type LastToolWrite = { known: true; at: Date | null } | { known: false };

/** The slice of a MongoDB collection `findLastToolWrite` needs (kept structural so a spec can inject failures). */
export type OrderLogFinder = {
  find(
    filter: Record<string, unknown>,
    options: { projection: Record<string, 0 | 1> },
  ): { sort(s: Record<string, 1 | -1>): { limit(n: number): { maxTimeMS(ms: number): { toArray(): Promise<unknown[]> } } } };
};

export const LAST_TOOL_WRITE_MAX_TIME_MS = 5000;

/**
 * Newest `toolResult` order-log row written by the tool itself — labelled
 * `source: ORDER_LOG_SOURCE_DESIGN_REVIEW_TOOL` by its result door. Rows with no acting user are NOT enough:
 * cron jobs, syncs and other system writers log without a user too, and counting them would make a dead
 * tool look alive. Served by the partial index `source_field_createdAt`. A failure or a timeout returns
 * `{ known: false }` — "could not tell", never "the tool has not written".
 */
export async function findLastToolWrite(
  orderLogs: OrderLogFinder,
  maxTimeMS = LAST_TOOL_WRITE_MAX_TIME_MS,
): Promise<LastToolWrite> {
  try {
    const rows = await orderLogs
      .find({ source: ORDER_LOG_SOURCE_DESIGN_REVIEW_TOOL, field: 'toolResult' }, { projection: { createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(1)
      .maxTimeMS(maxTimeMS)
      .toArray();
    const at = (rows[0] as { createdAt?: unknown } | undefined)?.createdAt;

    return { known: true, at: at instanceof Date ? at : null };
  } catch {
    return { known: false };
  }
}

/**
 * Is the automatic checker alive? Judged only when something is waiting: an idle tool with an empty
 * queue is normal, not a fault. `last` comes from `findLastToolWrite` (writes labelled as the tool's).
 * Returns `null` = unknown (the lookup failed): no alarm, and no all-clear either.
 */
export function toolQueueStalled(waiting: number, last: LastToolWrite, now: Date): boolean | null {
  if (waiting <= 0) return false;
  if (!last.known) return null;
  if (!last.at) return true;

  return now.getTime() - last.at.getTime() > TOOL_QUEUE_STALE_MINUTES * 60_000;
}
