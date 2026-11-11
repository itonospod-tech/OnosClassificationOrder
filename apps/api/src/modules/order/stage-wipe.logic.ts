/**
 * Moving `toolResultNote` away from 'ok' takes an order out of a fulfillment pipeline nobody has started yet:
 * `currentFulfillmentStage` and every `fulfillmentStages` entry are cleared (`OrderService.updateField`).
 * The wiped stage state (status, waitingAt, reworkAt…) exists nowhere else, so it is logged as a
 * `fulfillmentStages` row whose `before` is the full snapshot; the bulk undo puts it back from there
 * instead of guessing (Orders.md §27). Pure, so the rule is tested without a database.
 */

type StageState = ({ firstStartedAt?: unknown } & Record<string, unknown>) | null | undefined;

export interface StageWipeInput {
  currentFulfillmentStage?: string | null;
  fulfillmentStages?: Record<string, StageState> | null;
}

/**
 * The stages to wipe and keep as a snapshot, or null when nothing is wiped: no current stage, or a worker
 * already started a stage (the worker keeps the order and carries on).
 */
export function planStageWipe(before: StageWipeInput): { snapshot: Record<string, StageState> } | null {
  const stages = before.fulfillmentStages || {};
  const anyStageStarted = Object.values(stages).some((s) => !!s?.firstStartedAt);
  if (!before.currentFulfillmentStage || anyStageStarted) return null;
  return { snapshot: stages };
}
