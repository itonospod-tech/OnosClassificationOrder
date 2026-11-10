import { DesignerStatus } from 'shared';

import { planUndo, restoreLogRows, type UndoLogRow, type UndoPlan } from './bulk-undo.logic';

/**
 * Regression cases from the PR #77 test report (release 07/11), bugs 3 and 4, plus the normal paths
 * around them so a fix cannot break them.
 *
 * Log rows are seeded in the exact shape the code writes them today:
 *  - fulfillment rework-back (`FulfillmentTaskService.transition`): `{ action: 'rework_back', field: <target>,
 *    before: <reporter stage>, after: <reason> }` — target 'designer' also sets designerStatus='rework',
 *    designerReworkAt=now and $inc designerReworkCount, none of which is logged;
 *  - an edit's side effects (`CASCADE_LOGGED_FIELDS` in order.service.ts): designerStatus,
 *    currentFulfillmentStage and readyForFulfill get their own `update` row, same actor and moment.
 * `action` is not part of `UndoLogRow` yet, so the rows are built untyped and cast.
 */
const t = (iso: string) => new Date(iso);
const ACTOR = 'Admin User';
const W = { actor: ACTOR, from: t('2026-10-05T21:33:00Z'), to: t('2026-10-05T21:35:00Z') };
const INCIDENT = '2026-10-05T21:33:15Z';
const AFTER = '2026-10-06T01:00:00Z';
const huong = 'VWN640JU2VX1HWWM';

const row = (field: string, before: unknown, after: unknown, at: string, userName = 'Huong', action = 'update') =>
  ({ action, field, before, after, createdAt: t(at), userName }) as UndoLogRow;
const rows = (...r: UndoLogRow[]): UndoLogRow[] => r;

/** What a mistaken bulk unassign writes for an order whose designer status was `status`. */
const unassignIncident = (status: string) => [
  row('assignee', huong, null, INCIDENT, ACTOR),
  row('designerStatus', status, DesignerStatus.Unassigned, INCIDENT, ACTOR),
];
/** State the unassign left: assignee gone, designer state reset (rework count/at cleared too). */
const unassigned = { _id: 'O1', productionId: 'P1', assignee: null, designerStatus: DesignerStatus.Unassigned, designerReworkCount: 0, designerReworkAt: null };

const assignedAndDone = rows(
  row('assignee', null, huong, '2026-10-05T02:00:00Z', 'Leader'),
  row('designerStatus', 'assigned', 'in-progress', '2026-10-05T03:00:00Z'),
  row('designerStatus', 'in-progress', 'done', '2026-10-05T05:30:00Z'),
);
const REWORK_BACK_AT = '2026-10-05T10:00:00Z';
const reworkBackToDesigner = (at = REWORK_BACK_AT) => row('designer', 'press', 'Sai màu in', at, 'Press worker', 'rework_back');

const restoreSet = (p: UndoPlan | null): Record<string, unknown> => {
  expect(p?.status).toBe('restore');
  return p?.status === 'restore' ? p.set : {};
};

describe('bug 3 — undo keeps a rework that came from a fulfillment rework-back', () => {
  it('done → rework_back (field "designer") → unassigned by mistake → undo restores rework, count 1, reworkAt = the rework-back', () => {
    const logs = [...assignedAndDone, reworkBackToDesigner(), ...unassignIncident(DesignerStatus.Rework)];
    const set = restoreSet(planUndo('designer', unassigned, logs, W));
    expect(set).toMatchObject({
      assignee: huong,
      designerStatus: DesignerStatus.Rework,
      designerReworkCount: 1,
      designerReworkAt: t(REWORK_BACK_AT),
    });
  });

  it('two rework-backs, the first one finished: still in rework, count 2, reworkAt = the second', () => {
    const second = '2026-10-05T14:00:00Z';
    const logs = [
      ...assignedAndDone,
      reworkBackToDesigner(),
      row('designerStatus', 'rework', 'done', '2026-10-05T12:00:00Z'),
      reworkBackToDesigner(second),
      ...unassignIncident(DesignerStatus.Rework),
    ];
    expect(restoreSet(planUndo('designer', unassigned, logs, W))).toMatchObject({
      designerStatus: DesignerStatus.Rework,
      designerReworkCount: 2,
      designerReworkAt: t(second),
    });
  });

  // ---- neighbours (pass today, must keep passing) ----
  it('rework-back already picked up again (rework → in-progress logged): in-progress, count 1, reworkAt kept', () => {
    const logs = [
      ...assignedAndDone,
      reworkBackToDesigner(),
      row('designerStatus', 'rework', 'in-progress', '2026-10-05T11:00:00Z'),
      ...unassignIncident(DesignerStatus.InProgress),
    ];
    expect(restoreSet(planUndo('designer', unassigned, logs, W))).toMatchObject({
      assignee: huong,
      designerStatus: DesignerStatus.InProgress,
      designerReworkCount: 1,
      designerReworkAt: t(REWORK_BACK_AT),
    });
  });

  it('a rework-back to a production STAGE is not a designer rework: done, count 0, no reworkAt', () => {
    const logs = [...assignedAndDone, row('print', 'press', 'Lem màu', REWORK_BACK_AT, 'Press worker', 'rework_back'), ...unassignIncident(DesignerStatus.Done)];
    expect(restoreSet(planUndo('designer', unassigned, logs, W))).toMatchObject({
      designerStatus: DesignerStatus.Done,
      designerReworkCount: 0,
      designerReworkAt: null,
      designerCompletedAt: t('2026-10-05T05:30:00Z'),
    });
  });

  it('normal undo (no rework): restores done with the real timestamps and the usual guard', () => {
    const p = planUndo('designer', unassigned, [...assignedAndDone, ...unassignIncident(DesignerStatus.Done)], W);
    expect(restoreSet(p)).toEqual({
      assignee: huong,
      designerStatus: DesignerStatus.Done,
      designerAssignedAt: t('2026-10-05T02:00:00Z'),
      designerStartedAt: t('2026-10-05T03:00:00Z'),
      designerCompletedAt: t('2026-10-05T05:30:00Z'),
      designerReworkAt: null,
      designerReworkCount: 0,
    });
    expect(p?.status === 'restore' && p.guard).toEqual({ assignee: { $in: [null, ''] }, designerStatus: { $in: [null, '', DesignerStatus.Unassigned] } });
  });

  it('a rework-back AFTER the incident window means someone worked the order: skipped', () => {
    const logs = [...assignedAndDone, ...unassignIncident(DesignerStatus.Done), row('assignee', null, 'OTHER', AFTER, 'Leader')];
    expect(planUndo('designer', { ...unassigned, assignee: 'OTHER' }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });
});

describe('bug 4 — undo never crosses into the other flow (designer vs tool-ok/print)', () => {
  // A tool-ok note cleared by mistake: the edit also logged its cascade (ready false, print stage emptied).
  const okThenCleared = rows(
    row('toolResultNote', null, 'ok', '2026-10-05T08:00:00Z', 'Hanh'),
    row('toolResultNote', 'ok', null, INCIDENT, ACTOR),
    row('readyForFulfill', true, false, INCIDENT, ACTOR),
    row('currentFulfillmentStage', 'print', null, INCIDENT, ACTOR),
  );
  const okCleared = { _id: 'O2', productionId: 'P2', toolResultNote: null, readyForFulfill: false, assignee: null, designerStatus: DesignerStatus.Unassigned };

  /** The plan must never put an order that a designer holds into the print queue as ready. */
  const expectNotPushedToPrint = (p: UndoPlan | null) => {
    const set = p?.status === 'restore' ? p.set : {};
    expect(set.toolResultNote === 'ok' && set.readyForFulfill === true).toBe(false);
    expect(set.currentFulfillmentStage).toBeUndefined();
  };

  it.each([
    ['assigned to a designer', [row('assignee', null, huong, AFTER, 'Leader')], { assignee: huong, designerStatus: DesignerStatus.Assigned }],
    [
      'assigned and started',
      [row('assignee', null, huong, AFTER, 'Leader'), row('designerStatus', 'assigned', 'in-progress', '2026-10-06T02:00:00Z')],
      { assignee: huong, designerStatus: DesignerStatus.InProgress },
    ],
    ['designer status changed only', [row('designerStatus', 'unassigned', 'assigned', AFTER, 'Leader')], { designerStatus: DesignerStatus.Assigned }],
  ])('tool-ok group skips an order whose designer state changed after the window (%s)', (_label, later, state) => {
    const p = planUndo('tool-ok', { ...okCleared, ...state }, [...okThenCleared, ...later], W);
    expect(p).toMatchObject({ status: 'skip', reason: 'edited-after' });
    expectNotPushedToPrint(p);
  });

  it.each([
    ['toolResultNote', row('toolResultNote', null, 'ok', AFTER, 'Tool'), { toolResultNote: 'ok' }],
    ['readyForFulfill', row('readyForFulfill', false, true, AFTER, 'Tool'), { readyForFulfill: true }],
    ['currentFulfillmentStage', row('currentFulfillmentStage', null, 'print', AFTER, 'Tool'), { currentFulfillmentStage: 'print' }],
  ])('designer group skips an order whose %s changed after the window', (_field, later, state) => {
    const logs = [...assignedAndDone, ...unassignIncident(DesignerStatus.Done), later];
    expect(planUndo('designer', { ...unassigned, ...state }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  // ---- neighbours (pass today, must keep passing) ----
  it("tool-ok normal undo: the incident's own cascade rows (inside the window) do not count as a later edit", () => {
    const p = planUndo('tool-ok', okCleared, okThenCleared, W);
    expect(restoreSet(p)).toEqual({
      toolResultNote: 'ok',
      readyForFulfill: true,
      currentFulfillmentStage: 'print',
      'fulfillmentStages.print': { status: 'waiting', reworkCount: 0, workMs: 0, waitingAt: t('2026-10-05T08:00:00Z') },
    });
  });

  it('tool-ok undo still works when a designer held the order BEFORE the window (not a later change)', () => {
    const logs = [row('assignee', null, huong, '2026-10-05T02:00:00Z', 'Leader'), row('designerStatus', 'in-progress', 'done', '2026-10-05T05:30:00Z'), ...okThenCleared];
    const p = planUndo('tool-ok', { ...okCleared, assignee: huong, designerStatus: DesignerStatus.Done }, logs, W);
    expect(p?.status).toBe('restore');
  });

  it('tool-ok: an unrelated later edit (another field) does not block the undo', () => {
    expect(planUndo('tool-ok', okCleared, [...okThenCleared, row('size', 'M', 'L', AFTER, 'Support')], W)?.status).toBe('restore');
  });

  it('tool-ok: a note set again after the incident is still skipped', () => {
    const logs = [...okThenCleared, row('toolResultNote', null, 'ok', AFTER, 'Hoang Anh')];
    expect(planUndo('tool-ok', { ...okCleared, toolResultNote: 'ok' }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  it('designer: an unrelated later edit (another field) does not block the undo', () => {
    const logs = [...assignedAndDone, ...unassignIncident(DesignerStatus.Done), row('size', 'M', 'L', AFTER, 'Support')];
    expect(planUndo('designer', unassigned, logs, W)?.status).toBe('restore');
  });
});

/**
 * Minimal Mongo matcher for the guards the planner returns ($in / equality; `null` in `$in` also matches a
 * missing field, as in Mongo), so a test can say "the write would match this order".
 */
function guardMatches(guard: Record<string, unknown>, doc: Record<string, unknown>): boolean {
  return Object.entries(guard).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && '$in' in cond) {
      const list = (cond as { $in: unknown[] }).$in;
      return list.includes(v) || (v === undefined && list.includes(null));
    }
    return v === cond;
  });
}

describe("review — the write guard accepts every designerStatus the planner reads as 'unassigned'", () => {
  const okThenCleared = rows(
    row('toolResultNote', null, 'ok', '2026-10-05T08:00:00Z', 'Hanh'),
    row('toolResultNote', 'ok', null, INCIDENT, ACTOR),
    row('readyForFulfill', true, false, INCIDENT, ACTOR),
  );
  it.each([
    ['empty string', ''],
    ['null', null],
    ['missing', undefined],
    ["'unassigned'", DesignerStatus.Unassigned],
  ])('tool-ok: designerStatus %s → planned AND the guard matches the order', (_label, designerStatus) => {
    const order: Record<string, unknown> = { _id: 'O4', toolResultNote: null, readyForFulfill: false, assignee: null, designerStatus, currentFulfillmentStage: 'print' };
    const p = planUndo('tool-ok', order, okThenCleared, W);
    expect(p?.status).toBe('restore');
    expect(p?.status === 'restore' && guardMatches(p.guard, order)).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['missing', undefined],
  ])('designer: designerStatus %s left by the incident → the guard matches the order', (_label, designerStatus) => {
    const order: Record<string, unknown> = { ...unassigned, designerStatus };
    const p = planUndo('designer', order, [...assignedAndDone, ...unassignIncident(DesignerStatus.Done)], W);
    expect(p?.status === 'restore' && guardMatches(p.guard, order)).toBe(true);
  });
});

describe('review — the designer undo sees production progress the way it is really logged', () => {
  // `FulfillmentTaskService.transition`: a stage step logs `fulfillmentStages.<stage>.status`, a rework-back to a
  // production stage logs `action: 'rework_back', field: <stage>`.
  const logsWith = (later: UndoLogRow) => [...assignedAndDone, ...unassignIncident(DesignerStatus.Done), later];
  it.each([
    ['print started', row('fulfillmentStages.print.status', 'waiting', 'in-progress', AFTER, 'Print worker')],
    ['press done', row('fulfillmentStages.press.status', 'in-progress', 'done', AFTER, 'Press worker')],
    ['sent back to print', row('print', 'press', 'Lem màu', AFTER, 'Press worker', 'rework_back')],
    ['sent back to sew-in', row('sew-in', 'pack', 'Sai size', AFTER, 'Pack worker', 'rework_back')],
  ])('skips an order that moved in production after the incident (%s)', (_label, later) => {
    expect(planUndo('designer', unassigned, logsWith(later), W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  it('neighbour: production progress BEFORE the window does not block the undo', () => {
    const logs = [...assignedAndDone, row('fulfillmentStages.print.status', 'waiting', 'in-progress', '2026-10-05T07:00:00Z', 'Print worker'), ...unassignIncident(DesignerStatus.Done)];
    expect(planUndo('designer', unassigned, logs, W)?.status).toBe('restore');
  });
});

describe('review — other-side rows inside the window, before the incident row, count too', () => {
  const BEFORE_INCIDENT = '2026-10-05T21:33:05Z'; // inside W, ten seconds before the actor's row

  it("designer: user B set 'ok' inside the window before X unassigned → skipped", () => {
    const logs = [...assignedAndDone, row('toolResultNote', null, 'ok', BEFORE_INCIDENT, 'User B'), ...unassignIncident(DesignerStatus.Done)];
    expect(planUndo('designer', { ...unassigned, toolResultNote: 'ok' }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  it('tool-ok: user B assigned a designer inside the window before X cleared the ok → skipped', () => {
    const logs = [
      row('toolResultNote', null, 'ok', '2026-10-05T08:00:00Z', 'Hanh'),
      row('assignee', null, huong, BEFORE_INCIDENT, 'User B'),
      row('toolResultNote', 'ok', null, INCIDENT, ACTOR),
    ];
    const order = { _id: 'O5', toolResultNote: null, readyForFulfill: false, assignee: huong, designerStatus: DesignerStatus.Assigned };
    expect(planUndo('tool-ok', order, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  it("neighbour: the actor's own other-side rows inside the window (the incident's cascade) still do not count", () => {
    const logs = [...assignedAndDone, row('readyForFulfill', true, false, BEFORE_INCIDENT, ACTOR), ...unassignIncident(DesignerStatus.Done)];
    expect(planUndo('designer', unassigned, logs, W)?.status).toBe('restore');
  });
});

/**
 * Combined incident: actor X, in ONE window, unassigned the designer AND cleared the tool 'ok' of the same
 * order. Each undo writes its own `restore` rows after the window; those must not block the other group's
 * undo of the same incident, and both orders of running the two groups must end in the pre-incident state.
 * `applyUndo` mimics `BulkUndoService.run` for one order: conditional write on the guard, then the restore rows.
 */
describe('review — a combined incident (designer + tool-ok) is fully undoable in either order', () => {
  const SUPER = 'Super Admin';
  const preIncidentLogs = rows(
    ...assignedAndDone,
    row('readyForFulfill', false, true, '2026-10-05T05:30:00Z'),
    row('currentFulfillmentStage', null, 'print', '2026-10-05T05:30:00Z'),
    row('toolResultNote', null, 'ok', '2026-10-05T08:00:00Z', 'Hanh'),
  );
  const incident = rows(
    row('assignee', huong, null, INCIDENT, ACTOR),
    row('designerStatus', DesignerStatus.Done, DesignerStatus.Unassigned, INCIDENT, ACTOR),
    row('toolResultNote', 'ok', null, '2026-10-05T21:34:00Z', ACTOR),
    row('readyForFulfill', true, false, '2026-10-05T21:34:00Z', ACTOR),
    row('currentFulfillmentStage', 'print', null, '2026-10-05T21:34:00Z', ACTOR),
  );
  const leftByIncident = (): Record<string, unknown> => ({
    _id: 'O9', productionId: 'P9', assignee: null, designerStatus: DesignerStatus.Unassigned, designerAssignedAt: null, designerStartedAt: null,
    designerCompletedAt: null, designerReworkAt: null, designerReworkCount: 0, toolResultNote: null, readyForFulfill: false, currentFulfillmentStage: null, fulfillmentStages: {},
  });

  function applyUndo(group: 'designer' | 'tool-ok', order: Record<string, unknown>, logs: UndoLogRow[], at: string) {
    const p = planUndo(group, order, logs, W);
    if (p?.status !== 'restore') return { plan: p, order, logs };
    expect(guardMatches(p.guard, order)).toBe(true);
    const next = { ...order, ...p.set };
    const written = restoreLogRows(group, p, W).map((r) => ({ ...r, createdAt: t(at), userName: SUPER }) as UndoLogRow);
    return { plan: p, order: next, logs: [...logs, ...written] };
  }
  const expectPreIncident = (o: Record<string, unknown>) =>
    expect(o).toMatchObject({ assignee: huong, designerStatus: DesignerStatus.Done, toolResultNote: 'ok', readyForFulfill: true, currentFulfillmentStage: 'print' });

  it('designer first, then tool-ok: both restore', () => {
    const a = applyUndo('designer', leftByIncident(), [...preIncidentLogs, ...incident], '2026-10-06T03:00:00Z');
    expect(a.plan?.status).toBe('restore');
    const b = applyUndo('tool-ok', a.order, a.logs, '2026-10-06T03:05:00Z');
    expect(b.plan?.status).toBe('restore');
    expectPreIncident(b.order);
  });

  it('tool-ok first, then designer: both restore', () => {
    const a = applyUndo('tool-ok', leftByIncident(), [...preIncidentLogs, ...incident], '2026-10-06T03:00:00Z');
    expect(a.plan?.status).toBe('restore');
    const b = applyUndo('designer', a.order, a.logs, '2026-10-06T03:05:00Z');
    expect(b.plan?.status).toBe('restore');
    expectPreIncident(b.order);
  });

  it('restore rows carry the incident they undid', () => {
    const a = applyUndo('designer', leftByIncident(), [...preIncidentLogs, ...incident], '2026-10-06T03:00:00Z');
    const restoreRows = a.logs.filter((r) => r.action === 'restore');
    expect(restoreRows.length).toBeGreaterThan(0);
    expect(restoreRows.every((r) => r.undoOf?.actor === ACTOR && r.undoOf.group === 'designer')).toBe(true);
  });

  // ---- what must still block ----
  it("a restore row of ANOTHER incident (other actor) still counts as someone's later edit", () => {
    const other = { group: 'tool-ok' as const, actor: 'Someone else', from: W.from, to: W.to };
    const logs = [...preIncidentLogs, ...incident, { ...row('toolResultNote', null, 'ok', AFTER, SUPER, 'restore'), undoOf: other }];
    expect(planUndo('designer', { ...leftByIncident(), toolResultNote: 'ok' }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  it('a restore row without an incident reference (written before the marker existed) still counts', () => {
    const logs = [...preIncidentLogs, ...incident, row('assignee', null, huong, AFTER, SUPER, 'restore')];
    expect(planUndo('tool-ok', { ...leftByIncident(), assignee: huong, designerStatus: DesignerStatus.Done }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  it('tool-ok first, then a designer is assigned by hand: the designer undo skips', () => {
    const a = applyUndo('tool-ok', leftByIncident(), [...preIncidentLogs, ...incident], '2026-10-06T03:00:00Z');
    const logs = [...a.logs, row('assignee', null, 'OTHER', '2026-10-06T04:00:00Z', 'Leader')];
    expect(planUndo('designer', { ...a.order, assignee: 'OTHER', designerStatus: DesignerStatus.Assigned }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  it('tool-ok alone (designer not undone): still refused when the incident did NOT unassign and the designer state differs', () => {
    const logs = [...preIncidentLogs, ...incident.slice(2)];
    expect(planUndo('tool-ok', { ...leftByIncident() }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });
});
