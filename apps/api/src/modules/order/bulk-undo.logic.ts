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
 *  - moving `toolResultNote` away from 'ok' — or clearing another note — when no stage was started yet
 *    clears `currentFulfillmentStage` + `fulfillmentStages`. The wipe logs a full snapshot of the
 *    stages (`stage-wipe.logic.ts`), and the tool-ok / tool-note undo writes it back exactly. Older logs
 *    have no snapshot: tool-ok then puts the order back in the print queue without a waiting moment
 *    (unknown, never made up), tool-note restores the note only.
 *
 * Safety: an order is only touched while its CURRENT values are exactly what the incident left, nobody
 * logged a change to the same fields after the window, and the OTHER side (designer ↔ production) did not
 * move from the start of the window on (`restore` rows of the same incident excepted, `isRestoreOf`).
 * One exception to the last rule: production movement does NOT block the designer undo when the designer
 * state it restores is `done` (`crossSideBlocks`) — the designer had finished, the order flows on through
 * print/press, and the undo writes designer fields only. That is the main real incident (a bulk unassign of
 * finished orders); every stage step is logged, so the blanket rule made those orders un-undoable.
 * Anything else is skipped and reported.
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
 * Whether the OTHER side's movement blocks this undo. Always for tool-ok (never send to print an order a
 * designer took). For the designer undo only when the designer state to restore is ACTIVE — anything but
 * `done`:
 *  - assigned / in-progress / rework: the designer still had work to do on a design production has since
 *    moved on with; restoring would put one order in two flows at once;
 *  - rejected: the task was handed back for re-assignment — restoring it would ask the leader to re-assign
 *    design work on an order already in production; same conflict, so it blocks too;
 *  - done: the designer had finished; restoring assignee + 'done' + the real timestamps is what production
 *    already assumes, and no production field is written. Harmless → allowed.
 */
const crossSideBlocks = (group: BulkUndoGroup, restoredDesignerStatus: string | undefined): boolean =>
  group !== 'designer' || restoredDesignerStatus !== DesignerStatus.Done;

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
  // The other side (when it blocks at all — `crossSideBlocks`): any row from the start of the window on
  // counts (the order is rewound to w.from, so a change someone else made between w.from and the incident
  // row would be silently undone too), except
  // the incident's own cascade rows (the actor, inside the window) and the `restore` rows the OTHER
  // group's undo of this same incident wrote (a combined incident is undone one group at a time).
  const before = logs.filter((r) => r.createdAt < w.from);
  const restoredDesigner = group === 'designer' ? designerCycle(before, restoreValue).status : undefined;
  const isCross = (crossSideBlocks(group, restoredDesigner) && CROSS_SIDE[group]) || (() => false);
  const crossLater = logs.some(
    (r) => isCross(r) && r.createdAt >= w.from && (r.createdAt > w.to || !isActorRow(r, w.actor)) && !isRestoreOf(r, w),
  );
  if (crossLater) return { status: 'skip', reason: 'edited-after', changes: preview };
  if (!sameValue(order[field], leftValue)) return { status: 'skip', reason: 'current-differs', changes: preview };

  // Stages the incident's cascade wiped, from the snapshot it logged (tool-ok / tool-note only). Written
  // back only onto an order still exactly as the wipe left it, and nobody moved its stages since.
  const wiped = group === 'tool-ok' || group === 'tool-note' ? wipedStagesOf(logs, w) : null;
  if (wiped) {
    if (!isEmptyValue(order.currentFulfillmentStage) || !isEmptyStages(order.fulfillmentStages)) {
      return { status: 'skip', reason: 'current-differs', changes: preview };
    }
    if (logs.some((r) => r.createdAt > w.to && isStageRow(r) && !isRestoreOf(r, w))) {
      return { status: 'skip', reason: 'edited-after', changes: preview };
    }
  }

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
    return planToolOk(order, wiped, w.from);
  }
  const set: Record<string, unknown> = { [field]: restoreValue };
  const guard: Record<string, unknown> = { [field]: isEmptyValue(leftValue) ? { $in: [null, ''] } : leftValue };
  const changes = [...preview];
  // tool-note: no snapshot (older log, or nothing was wiped) → the note only, as before; nothing is guessed.
  if (wiped) {
    Object.assign(set, stagesSet(wiped));
    Object.assign(guard, WIPED_STAGES_GUARD);
    changes.push(...stagesChanges(order, wiped));
  }
  return { status: 'restore', changes, set, guard, restoredFrom: w.from };
}

/**
 * The stage state the incident's cascade wiped: the `fulfillmentStages` row it logged (before = full
 * snapshot, after = {}) and the `currentFulfillmentStage` row cleared with it, both by the actor inside
 * the window — the earliest pair, i.e. the state at the start of the window. Null when the log has no
 * snapshot (written before it existed, or no wipe happened): the caller then guesses nothing.
 */
export function wipedStagesOf(logs: UndoLogRow[], w: UndoWindow): WipedStages | null {
  const inWindow = (r: UndoLogRow) => r.createdAt >= w.from && r.createdAt <= w.to && isActorRow(r, w.actor);
  const snap = logs.find(
    (r) => inWindow(r) && r.field === 'fulfillmentStages' && !isEmptyStages(r.before) && isEmptyStages(r.after),
  );
  const stage = logs.find((r) => inWindow(r) && r.field === 'currentFulfillmentStage' && !isEmptyValue(r.before) && isEmptyValue(r.after));
  if (!snap || !stage) return null;
  return { currentFulfillmentStage: stage.before as string, fulfillmentStages: snap.before as Record<string, unknown> };
}

export interface WipedStages {
  currentFulfillmentStage: string;
  fulfillmentStages: Record<string, unknown>;
}

/** `{}`, missing or null: what the wipe leaves (`$in: [{}, null]` matches the same in Mongo). */
const isEmptyStages = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
/** A row that moved the order's stages: stage pointer, a whole-stages snapshot or a per-stage step. */
const isStageRow = (r: UndoLogRow): boolean => r.field === 'currentFulfillmentStage' || (r.field ?? '').startsWith('fulfillmentStages');
/** Write only onto an order whose stages are still exactly what the wipe left. */
const WIPED_STAGES_GUARD = { currentFulfillmentStage: { $in: [null, ''] }, fulfillmentStages: { $in: [{}, null] } };
const stagesSet = (s: WipedStages) => ({ currentFulfillmentStage: s.currentFulfillmentStage, fulfillmentStages: s.fulfillmentStages });
const stagesChanges = (order: OrderDoc, s: WipedStages): UndoChange[] => [
  { field: 'currentFulfillmentStage', current: order.currentFulfillmentStage ?? null, restore: s.currentFulfillmentStage },
  { field: 'fulfillmentStages', current: order.fulfillmentStages ?? {}, restore: s.fulfillmentStages },
];

/**
 * Designer state just before the incident, rebuilt from the logs (real timestamps):
 *  - the counters live since the last UNASSIGN (only unassigning resets them; reassigning does not);
 *  - status = last logged transition after the last assignment, else 'assigned' (`designerCycle`);
 *  - entering 'rework' is logged on current data (production-error hook: a `designerStatus` row
 *    done → rework; fulfillment rework-back: `action: 'rework_back'`, `field: 'designer'`, read as a
 *    transition by `designerTransitions`): each entry is one rework, `designerReworkAt` = its moment.
 *    Older data only logged LEAVING rework (`before: 'rework'`): such an episode still counts once, its
 *    entry moment taken as the first logged event after the previous transition (the event that caused it).
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

/**
 * 'ok' back, ready for fulfillment, and the stages the cascade wiped put back:
 *  - from the snapshot the wipe logged (`wiped`) — status, waitingAt, reworkAt exactly as they were;
 *  - an older log without a snapshot: back in the print queue as waiting. When it had entered that queue
 *    is not known (the 'ok' row is not it — e.g. a stage sent back for rework keeps its earlier
 *    waitingAt), so no waitingAt is written rather than a made-up one.
 */
function planToolOk(order: OrderDoc, wiped: WipedStages | null, from: Date): UndoPlan {
  const set: Record<string, unknown> = { toolResultNote: READY, readyForFulfill: true };
  const stages = (order.fulfillmentStages ?? {}) as Record<string, unknown>;
  const emptied = !order.currentFulfillmentStage && !order.fulfillmentCompletedAt && Object.keys(stages).length === 0;
  const changes: UndoChange[] = [
    { field: 'toolResultNote', current: order.toolResultNote ?? null, restore: READY },
    { field: 'readyForFulfill', current: order.readyForFulfill ?? null, restore: true },
  ];
  if (wiped) {
    Object.assign(set, stagesSet(wiped));
    changes.push(...stagesChanges(order, wiped));
  } else if (emptied) {
    set.currentFulfillmentStage = FulfillmentStage.Print;
    set['fulfillmentStages.print'] = { status: FulfillmentStageStatus.Waiting, reworkCount: 0, workMs: 0 };
    changes.push({ field: 'currentFulfillmentStage', current: null, restore: FulfillmentStage.Print });
  }
  return {
    status: 'restore',
    changes,
    set,
    guard: {
      toolResultNote: { $in: [null, ''] },
      ...(wiped ? WIPED_STAGES_GUARD : emptied ? { currentFulfillmentStage: { $in: [null, ''] } } : {}),
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
