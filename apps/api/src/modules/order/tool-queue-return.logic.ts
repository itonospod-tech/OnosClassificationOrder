import { TOOL_QUEUE_STALE_MINUTES, type ToolQueueBlockKey } from 'shared';

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

  return null;
}

export type ToolQueueRunSkip = { id: string; productionId?: string; reason: string };

/**
 * Run loop with the I/O injected. Each order is loaded FRESH right before its write (not from a list
 * read at the start): between the preview and the click the tool may have recorded a result for some of
 * them, and those must be skipped and reported, never overwritten. `write` is one `updateField` call, so
 * every change keeps its order-log entry (the old value there is the only way back).
 */
export async function runToolQueueReturn(input: {
  ids: string[];
  load: (id: string) => Promise<(ToolQueueDoc & { productionId?: string }) | null>;
  write: (id: string, previous: string) => Promise<void>;
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
      await input.write(id, String(doc.toolResult));
      done.push(id);
      previous.push([id, String(doc.toolResult)]);
    } catch (err) {
      skipped.push({ id, productionId: doc.productionId, reason: (err as Error).message || 'error' });
    }
  }

  return { done, skipped, previous };
}

/**
 * Is the automatic checker alive? Judged only when something is waiting: an idle tool with an empty
 * queue is normal, not a fault. `lastToolWriteAt` = newest `toolResult` order-log entry with no acting
 * user (the tool writes through the public API, so those entries carry no user).
 */
export function toolQueueStalled(waiting: number, lastToolWriteAt: Date | null, now: Date): boolean {
  if (waiting <= 0) return false;
  if (!lastToolWriteAt) return true;

  return now.getTime() - lastToolWriteAt.getTime() > TOOL_QUEUE_STALE_MINUTES * 60_000;
}
