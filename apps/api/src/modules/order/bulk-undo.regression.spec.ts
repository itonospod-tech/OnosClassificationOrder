import { DesignerStatus } from 'shared';

import { planUndo, type UndoLogRow, type UndoPlan } from './bulk-undo.logic';

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
