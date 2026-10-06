import type { BulkUndoGroup, BulkUndoSkipReason } from 'shared';
import { DesignerStatus, FulfillmentStage, FulfillmentStageStatus } from 'shared';

/**
 * Undo a mistaken bulk edit (Orders.md §27): REWIND each affected order to its state just before
 * the incident window, never "invert each log line". Pure, so the rules are tested without a DB.
 *
 * Two unlogged cascades make a plain field restore wrong, and both are rebuilt here:
 *  - clearing `assignee` also resets `designerStatus` to unassigned and clears the designer
 *    timestamps and rework count (`updateField` / `bulkUpdateField`), but only `assignee` is logged;
 *    the state is rebuilt from the designer's own logged transitions (real timestamps, nothing guessed);
 *  - clearing `toolResultNote` from 'ok' sets `readyForFulfill=false` and, when nobody had started
 *    the print stage yet, clears `currentFulfillmentStage` + `fulfillmentStages`; the order is put
 *    back in the print queue, waiting since its original 'ok'.
 *
 * Safety: an order is only touched while its CURRENT values are exactly what the incident left and
 * nobody logged a change to the same fields after the window. Anything else is skipped and reported.
 */

export interface UndoLogRow {
  field?: string;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
  userId?: string;
  userName?: string;
  userEmail?: string;
}

export interface UndoWindow {
  from: Date;
  to: Date;
  /** Matches the log's userId, userName or userEmail. */
  actor: string;
}

export interface UndoChange {
  field: string;
  current: unknown;
  restore: unknown;
}

export type UndoPlan =
  | { status: 'restore'; changes: UndoChange[]; set: Record<string, unknown>; guard: Record<string, unknown>; restoredFrom: Date }
  | { status: 'skip'; reason: BulkUndoSkipReason; changes: UndoChange[] };

/** Fields whose incident edits define each group. */
export const UNDO_GROUP_FIELD: Record<BulkUndoGroup, string> = {
  designer: 'assignee',
  'tool-ok': 'toolResultNote',
  'tool-note': 'toolResultNote',
  'tool-result': 'toolResult',
};
/** Fields whose later edits (by anyone) mean someone already worked on the order: skip it. */
const LATER_FIELDS: Record<BulkUndoGroup, string[]> = {
  designer: ['assignee', 'designerStatus'],
  'tool-ok': ['toolResultNote'],
  'tool-note': ['toolResultNote'],
  'tool-result': ['toolResult'],
};

const READY = 'ok';
export const isEmptyValue = (v: unknown): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const norm = (v: unknown): string => (isEmptyValue(v) ? '' : Array.isArray(v) ? [...v].map(String).sort().join(',') : String(v));
export const sameValue = (a: unknown, b: unknown): boolean => norm(a) === norm(b);

export const isActorRow = (r: UndoLogRow, actor: string): boolean => r.userId === actor || r.userName === actor || r.userEmail === actor;

/** The incident's real changes of the group's field (value actually changed), oldest first. */
export function incidentRows(group: BulkUndoGroup, logs: UndoLogRow[], w: UndoWindow): UndoLogRow[] {
  const field = UNDO_GROUP_FIELD[group];
  return logs
    .filter((r) => r.field === field && r.createdAt >= w.from && r.createdAt <= w.to && isActorRow(r, w.actor) && !sameValue(r.before, r.after))
    .filter((r) => {
      if (group === 'designer') return !isEmptyValue(r.before) && isEmptyValue(r.after); // assignee removed
      if (group === 'tool-ok') return r.before === READY && isEmptyValue(r.after);
      if (group === 'tool-note') return !isEmptyValue(r.before) && r.before !== READY && isEmptyValue(r.after);
      return true;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

type OrderDoc = Record<string, unknown>;

export function planUndo(group: BulkUndoGroup, order: OrderDoc, logs: UndoLogRow[], w: UndoWindow): UndoPlan | null {
  const inc = incidentRows(group, logs, w);
  if (inc.length === 0) return null;
  const field = UNDO_GROUP_FIELD[group];
  const restoreValue = inc[0].before;
  const leftValue = inc[inc.length - 1].after;
  const preview: UndoChange[] = [{ field, current: order[field] ?? null, restore: restoreValue }];

  if (order.cancelledAt) return { status: 'skip', reason: 'cancelled', changes: preview };
  if (order.heldAt) return { status: 'skip', reason: 'held', changes: preview };
  const later = logs.some((r) => r.createdAt > w.to && LATER_FIELDS[group].includes(r.field ?? ''));
  if (later) return { status: 'skip', reason: 'edited-after', changes: preview };
  if (!sameValue(order[field], leftValue)) return { status: 'skip', reason: 'current-differs', changes: preview };

  const before = logs.filter((r) => r.createdAt < w.from);
  if (group === 'designer') return planDesigner(order, before, restoreValue as string, w.from);
  if (group === 'tool-ok') return planToolOk(order, before, w.from);
  const set = { [field]: restoreValue };
  return {
    status: 'restore',
    changes: preview,
    set,
    guard: { [field]: isEmptyValue(leftValue) ? { $in: [null, ''] } : leftValue },
    restoredFrom: w.from,
  };
}

/**
 * Designer state just before the incident, rebuilt from the logs (real timestamps):
 *  - the counters live since the last UNASSIGN (only unassigning resets them; reassigning does not);
 *  - status = last logged transition after the last assignment, else 'assigned' (assigning sets it
 *    without logging it);
 *  - entering 'rework' is itself unlogged (production-error hook, fulfillment rework-back), but
 *    leaving it is logged with `before: 'rework'`: each such row is one rework; the entry moment is
 *    taken as the first logged event after the previous transition (the event that caused it).
 */
function planDesigner(order: OrderDoc, before: UndoLogRow[], assignee: string, from: Date): UndoPlan {
  const lastUnassign = [...before].reverse().find((r) => r.field === 'assignee' && isEmptyValue(r.after));
  const inCycle = before.filter((r) => !lastUnassign || r.createdAt > lastUnassign.createdAt);
  const assignLog = [...inCycle].reverse().find((r) => r.field === 'assignee' && r.after === assignee);
  const transitions = inCycle.filter((r) => r.field === 'designerStatus');
  const sinceAssign = transitions.filter((r) => !assignLog || r.createdAt >= assignLog.createdAt);
  const status = (sinceAssign[sinceAssign.length - 1]?.after as DesignerStatus | undefined) ?? DesignerStatus.Assigned;
  const lastTo = (s: string) => [...transitions].reverse().find((r) => r.after === s)?.createdAt ?? null;

  // Rework entries: one per logged exit from 'rework', plus the current one if still in rework.
  const exits = transitions.filter((r) => r.before === DesignerStatus.Rework);
  const reworkCount = exits.length + (status === DesignerStatus.Rework ? 1 : 0);
  const entryAfter = (prev: Date | undefined, until?: Date) =>
    inCycle.find((r) => r.field !== 'designerStatus' && (!prev || r.createdAt > prev) && (!until || r.createdAt < until))?.createdAt ?? null;
  let reworkAt: Date | null = null;
  if (status === DesignerStatus.Rework) {
    reworkAt = entryAfter(transitions[transitions.length - 1]?.createdAt);
  } else if (exits.length) {
    const exit = exits[exits.length - 1];
    const prev = [...transitions].reverse().find((r) => r.createdAt < exit.createdAt);
    reworkAt = entryAfter(prev?.createdAt, exit.createdAt);
  }

  const set: Record<string, unknown> = {
    assignee,
    designerStatus: status,
    designerAssignedAt: assignLog?.createdAt ?? null,
    designerStartedAt: lastTo(DesignerStatus.InProgress),
    designerCompletedAt: lastTo(DesignerStatus.Done),
    designerReworkAt: reworkAt,
    designerReworkCount: reworkCount,
  };
  const changes = Object.entries(set).map(([field, restore]) => ({ field, current: order[field] ?? null, restore }));
  return {
    status: 'restore',
    changes,
    set,
    guard: { assignee: { $in: [null, ''] }, designerStatus: { $in: [null, DesignerStatus.Unassigned] } },
    restoredFrom: from,
  };
}

/** 'ok' back, ready for fulfillment, and back in the print queue if the cascade had emptied it. */
function planToolOk(order: OrderDoc, before: UndoLogRow[], from: Date): UndoPlan {
  const okAt = [...before].reverse().find((r) => r.field === 'toolResultNote' && r.after === READY)?.createdAt ?? (order.toolCheckedAt as Date | undefined) ?? null;
  const set: Record<string, unknown> = { toolResultNote: READY, readyForFulfill: true };
  const stages = (order.fulfillmentStages ?? {}) as Record<string, unknown>;
  const emptied = !order.currentFulfillmentStage && !order.fulfillmentCompletedAt && Object.keys(stages).length === 0;
  if (emptied) {
    set.currentFulfillmentStage = FulfillmentStage.Print;
    set['fulfillmentStages.print'] = { status: FulfillmentStageStatus.Waiting, reworkCount: 0, workMs: 0, waitingAt: okAt ?? from };
  }
  const changes: UndoChange[] = [
    { field: 'toolResultNote', current: order.toolResultNote ?? null, restore: READY },
    { field: 'readyForFulfill', current: order.readyForFulfill ?? null, restore: true },
    ...(emptied ? [{ field: 'currentFulfillmentStage', current: null, restore: `${FulfillmentStage.Print} (waiting since ${(okAt ?? from).toISOString()})` }] : []),
  ];
  return {
    status: 'restore',
    changes,
    set,
    guard: { toolResultNote: { $in: [null, ''] }, ...(emptied ? { currentFulfillmentStage: { $in: [null, ''] } } : {}) },
    restoredFrom: from,
  };
}
