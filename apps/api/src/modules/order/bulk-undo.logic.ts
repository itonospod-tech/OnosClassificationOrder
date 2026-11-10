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
  /** order-log action ('update', 'rework_back', ...). */
  action?: string;
  field?: string;
  before?: unknown;
  after?: unknown;
  createdAt: Date;
  userId?: string;
  userName?: string;
  userEmail?: string;
  /** Only on `restore` rows written by this undo: the incident they rewound. */
  undoOf?: UndoIncidentRef;
}

/** The incident a `restore` row belongs to (group + the window the SuperAdmin entered). */
export interface UndoIncidentRef {
  group: BulkUndoGroup;
  actor: string;
  from: Date;
  to: Date;
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
  designer: ['assignee', 'designerStatus', 'designer'],
  'tool-ok': ['toolResultNote', 'tool-check'],
  'tool-note': ['toolResultNote'],
  'tool-result': ['toolResult'],
};
/**
 * The designer and tool-ok undos overlap (one hands the order back to a designer, the other sends it
 * to print), so each also skips an order whose OTHER side changed since the incident. Matched by
 * pattern, the way the rows are really written:
 *  - production side: the tool note / ready flag / current stage cascades, every stage step
 *    (`fulfillmentStages.<stage>.status`, `FulfillmentTaskService.transition`) and every rework-back
 *    that is NOT to the designer (`action: 'rework_back'`, `field: <stage>` or 'tool-check');
 *  - designer side: assignee, designer status and the rework-back to the designer (`field: 'designer'`).
 */
const PRODUCTION_SIDE_FIELDS = new Set(['toolResultNote', 'readyForFulfill', 'currentFulfillmentStage', 'fulfillmentCompletedAt', 'tool-check']);
const isProductionSideRow = (r: UndoLogRow): boolean => {
  const f = r.field ?? '';
  return PRODUCTION_SIDE_FIELDS.has(f) || f.startsWith('fulfillmentStages') || (r.action === 'rework_back' && f !== 'designer');
};
const isDesignerSideRow = (r: UndoLogRow): boolean => r.field === 'assignee' || r.field === 'designerStatus' || r.field === 'designer';
const CROSS_SIDE: Partial<Record<BulkUndoGroup, (r: UndoLogRow) => boolean>> = {
  designer: isProductionSideRow,
  'tool-ok': isDesignerSideRow,
};

/**
 * The fulfillment "send back to designer" (`rework_back`) is logged as `field: 'designer'` (the
 * rework target; before = reporter stage, after = reason), not as a `designerStatus` row, although
 * it sets designerStatus='rework', designerReworkAt and bumps designerReworkCount.
 */
const isReworkBack = (r: UndoLogRow): boolean => r.field === 'designer' && (!r.action || r.action === 'rework_back');

/**
 * Designer status transitions in the logs: the `designerStatus` rows plus each rework-back to the
 * designer, read as a transition into 'rework'.
 */
function designerTransitions(rows: UndoLogRow[]): UndoLogRow[] {
  const out: UndoLogRow[] = [];
  let cur: unknown = null;
  for (const r of rows) {
    if (r.field === 'designerStatus') {
      out.push(r);
      cur = r.after;
    } else if (isReworkBack(r)) {
      out.push({ ...r, field: 'designerStatus', before: cur, after: DesignerStatus.Rework });
      cur = DesignerStatus.Rework;
    }
  }
  return out;
}

const designerStatusOf = (v: unknown): string => (isEmptyValue(v) ? DesignerStatus.Unassigned : String(v));
/**
 * Write guard for "designer status reads as unassigned": exactly what `designerStatusOf` maps to
 * 'unassigned' — missing / null (`null` in `$in` also matches a missing field), '' and 'unassigned'.
 * Planner and guard must agree, or such an order is always reported 'changed-during-run'.
 */
export const UNASSIGNED_DESIGNER_GUARD = { $in: [null, '', DesignerStatus.Unassigned] };

/**
 * The designer cycle as the logs leave it — ONE walk, used by the designer undo (the state it restores)
 * and the tool-ok undo (the designer state at the incident):
 *  - the cycle starts after the last UNASSIGN (only unassigning resets the designer fields);
 *  - assignee = `assignee` when given, else the last logged assignee value;
 *  - status = the last transition (`designerTransitions`) since that assignment; none → 'assigned'
 *    (assigning sets it without logging it), or 'unassigned' when nobody is assigned.
 */
function designerCycle(rows: UndoLogRow[], assignee?: unknown) {
  const lastUnassign = [...rows].reverse().find((r) => r.field === 'assignee' && isEmptyValue(r.after));
  const inCycle = rows.filter((r) => !lastUnassign || r.createdAt > lastUnassign.createdAt);
  const who = assignee !== undefined ? assignee : ([...rows].reverse().find((r) => r.field === 'assignee')?.after ?? null);
  const assigned = !isEmptyValue(who);
  const assignLog = assigned ? [...inCycle].reverse().find((r) => r.field === 'assignee' && r.after === who) : undefined;
  const transitions = designerTransitions(inCycle);
  const sinceAssign = transitions.filter((r) => !assignLog || r.createdAt >= assignLog.createdAt);
  const last = sinceAssign[sinceAssign.length - 1]?.after;
  const status = (last as DesignerStatus | null | undefined) ?? (assigned ? DesignerStatus.Assigned : DesignerStatus.Unassigned);
  return { assignee: assigned ? who : null, status, assignLog, inCycle, transitions };
}

const READY = 'ok';
export const isEmptyValue = (v: unknown): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const norm = (v: unknown): string => (isEmptyValue(v) ? '' : Array.isArray(v) ? [...v].map(String).sort().join(',') : String(v));
export const sameValue = (a: unknown, b: unknown): boolean => norm(a) === norm(b);

export const isActorRow = (r: UndoLogRow, actor: string): boolean => r.userId === actor || r.userName === actor || r.userEmail === actor;

const time = (d: Date | string): number => new Date(d).getTime();
/**
 * A `restore` row written by an undo of THIS incident: same actor, overlapping window (the SuperAdmin
 * may type the window slightly differently for each group). Rows without `undoOf` (none exist outside
 * dev before the marker) are not recognised and keep counting as a later edit — the safe side.
 */
export const isRestoreOf = (r: UndoLogRow, w: UndoWindow): boolean =>
  r.action === 'restore' &&
  !!r.undoOf &&
  r.undoOf.actor === w.actor &&
  time(r.undoOf.from) <= w.to.getTime() &&
  time(r.undoOf.to) >= w.from.getTime();

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
  // The other side: any row from the start of the window on counts (the order is rewound to w.from, so a
  // change someone else made between w.from and the incident row would be silently undone too), except
  // the incident's own cascade rows (the actor, inside the window) and the `restore` rows the OTHER
  // group's undo of this same incident wrote (a combined incident is undone one group at a time).
  const isCross = CROSS_SIDE[group] ?? (() => false);
  const crossLater = logs.some(
    (r) => isCross(r) && r.createdAt >= w.from && (r.createdAt > w.to || !isActorRow(r, w.actor)) && !isRestoreOf(r, w),
  );
  if (crossLater) return { status: 'skip', reason: 'edited-after', changes: preview };
  if (!sameValue(order[field], leftValue)) return { status: 'skip', reason: 'current-differs', changes: preview };

  const before = logs.filter((r) => r.createdAt < w.from);
  if (group === 'designer') return planDesigner(order, before, restoreValue as string, w.from);
  if (group === 'tool-ok') {
    // Never send to print an order a designer holds: its designer state must still be what it was at
    // the incident (this also catches a change nobody logged) — or, when this same incident also
    // unassigned the designer and that part is not undone yet, exactly what the incident left
    // (no assignee, unassigned). The designer undo can still run afterwards: it ignores these restore rows.
    const atIncident = designerCycle(before);
    const current = designerStatusOf(order.designerStatus);
    const sameAsIncident = sameValue(order.assignee, atIncident.assignee) && current === designerStatusOf(atIncident.status);
    const leftByThisIncident =
      incidentRows('designer', logs, w).length > 0 && isEmptyValue(order.assignee) && current === DesignerStatus.Unassigned;
    if (!sameAsIncident && !leftByThisIncident) return { status: 'skip', reason: 'edited-after', changes: preview };
    return planToolOk(order, before, w.from);
  }
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
  const { status, assignLog, inCycle, transitions } = designerCycle(before, assignee);
  const lastTo = (s: string) => [...transitions].reverse().find((r) => r.after === s)?.createdAt ?? null;

  // One rework per episode. The entry is either logged (a transition into 'rework': rework-back,
  // production-error hook) or, on older data, only visible through its logged exit
  // (`before: 'rework'`); its moment is then the first other event after the previous transition.
  const entryAfter = (prev: Date | undefined, until?: Date) =>
    inCycle.find((r) => r.field !== 'designerStatus' && !isReworkBack(r) && (!prev || r.createdAt > prev) && (!until || r.createdAt < until))
      ?.createdAt ?? null;
  let reworkCount = 0;
  let reworkAt: Date | null = null;
  let cur: unknown = null;
  transitions.forEach((r, i) => {
    if (r.after === DesignerStatus.Rework) {
      if (cur !== DesignerStatus.Rework) {
        reworkCount++;
        reworkAt = r.createdAt;
      }
    } else if (r.before === DesignerStatus.Rework && cur !== DesignerStatus.Rework) {
      reworkCount++;
      reworkAt = entryAfter(transitions[i - 1]?.createdAt, r.createdAt);
    }
    cur = r.after;
  });

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
    guard: { assignee: { $in: [null, ''] }, designerStatus: UNASSIGNED_DESIGNER_GUARD },
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
    guard: {
      toolResultNote: { $in: [null, ''] },
      ...(emptied ? { currentFulfillmentStage: { $in: [null, ''] } } : {}),
      // No designer took the order meanwhile.
      assignee: isEmptyValue(order.assignee) ? { $in: [null, ''] } : order.assignee,
      designerStatus: designerStatusOf(order.designerStatus) === DesignerStatus.Unassigned ? UNASSIGNED_DESIGNER_GUARD : order.designerStatus,
    },
    restoredFrom: from,
  };
}

/**
 * The order-log rows a successful restore writes: one `restore` row per changed field, each tagged with
 * the incident it rewound (`undoOf`) so the OTHER group's undo of the same incident can tell them apart
 * from somebody's later edit.
 */
export function restoreLogRows(
  group: BulkUndoGroup,
  plan: Extract<UndoPlan, { status: 'restore' }>,
  w: UndoWindow,
): Array<{ action: 'restore'; field: string; before: unknown; after: unknown; undoOf: UndoIncidentRef }> {
  const undoOf: UndoIncidentRef = { group, actor: w.actor, from: w.from, to: w.to };
  return plan.changes.map((c) => ({ action: 'restore' as const, field: c.field, before: c.current ?? null, after: c.restore ?? null, undoOf }));
}
