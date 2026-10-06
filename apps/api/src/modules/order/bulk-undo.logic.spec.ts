import { DesignerStatus } from 'shared';

import { incidentRows, planUndo, type UndoLogRow } from './bulk-undo.logic';

/**
 * Undo of a mistaken bulk edit (Orders.md §27): rewind to the state before the window, rebuild the
 * unlogged cascades, and never touch an order someone already changed afterwards.
 */
const t = (iso: string) => new Date(iso);
const ACTOR = 'Admin User';
const W = { actor: ACTOR, from: t('2026-10-05T21:33:00Z'), to: t('2026-10-05T21:35:00Z') };
const INCIDENT = t('2026-10-05T21:33:15Z');
const huong = 'VWN640JU2VX1HWWM';
const log = (field: string, before: unknown, after: unknown, at: string, userName = 'Huong'): UndoLogRow => ({ field, before, after, createdAt: t(at), userName });

/** State the incident left on one of Huong's finished orders: assignee gone, status reset (unlogged cascade). */
const afterIncident = { _id: 'O1', productionId: 'P1', assignee: null, designerStatus: DesignerStatus.Unassigned, designerReworkCount: 0 };
const huongLogs: UndoLogRow[] = [
  log('assignee', null, huong, '2026-10-05T02:00:00Z', 'Leader'),
  log('designerStatus', 'assigned', 'in-progress', '2026-10-05T03:00:00Z'),
  log('designerStatus', 'in-progress', 'done', '2026-10-05T05:30:00Z'),
  { field: 'assignee', before: huong, after: null, createdAt: INCIDENT, userName: ACTOR },
];

describe('designer group', () => {
  it("rebuilds Huong's finished task from her own logged transitions", () => {
    const p = planUndo('designer', afterIncident, huongLogs, W);
    expect(p?.status).toBe('restore');
    if (p?.status !== 'restore') return;
    expect(p.set).toEqual({
      assignee: huong,
      designerStatus: DesignerStatus.Done,
      designerAssignedAt: t('2026-10-05T02:00:00Z'),
      designerStartedAt: t('2026-10-05T03:00:00Z'),
      designerCompletedAt: t('2026-10-05T05:30:00Z'),
      designerReworkAt: null,
      designerReworkCount: 0,
    });
    expect(p.guard).toEqual({ assignee: { $in: [null, ''] }, designerStatus: { $in: [null, DesignerStatus.Unassigned] } });
  });

  it('only the cycle after the last assignment counts (an older done cycle of another designer is ignored)', () => {
    const logs = [log('designerStatus', 'in-progress', 'done', '2026-10-01T00:00:00Z', 'Other'), ...huongLogs.filter((l) => l.field !== 'designerStatus')];
    const p = planUndo('designer', afterIncident, logs, W);
    expect(p?.status === 'restore' && p.set.designerStatus).toBe(DesignerStatus.Assigned);
  });

  it('skips an order someone re-assigned after the incident', () => {
    const logs = [...huongLogs, log('assignee', null, 'OTHER', '2026-10-06T01:00:00Z', 'Hanh')];
    expect(planUndo('designer', { ...afterIncident, assignee: 'OTHER' }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });

  it('skips when the current value is not what the incident left, even without a later log', () => {
    expect(planUndo('designer', { ...afterIncident, assignee: 'OTHER' }, huongLogs, W)).toMatchObject({ status: 'skip', reason: 'current-differs' });
  });

  it('skips held and cancelled orders', () => {
    expect(planUndo('designer', { ...afterIncident, heldAt: t('2026-10-06T00:00:00Z') }, huongLogs, W)).toMatchObject({ reason: 'held' });
    expect(planUndo('designer', { ...afterIncident, cancelledAt: t('2026-10-06T00:00:00Z') }, huongLogs, W)).toMatchObject({ reason: 'cancelled' });
  });
});

describe('what counts as the incident', () => {
  it('ignores no-op rows (None -> None), other actors and rows outside the window', () => {
    const logs = [
      { field: 'assignee', before: null, after: null, createdAt: INCIDENT, userName: ACTOR },
      { field: 'assignee', before: huong, after: null, createdAt: INCIDENT, userName: 'Someone else' },
      { field: 'assignee', before: huong, after: null, createdAt: t('2026-10-05T22:00:00Z'), userName: ACTOR },
    ];
    expect(incidentRows('designer', logs, W)).toEqual([]);
    expect(planUndo('designer', afterIncident, logs, W)).toBeNull();
  });

  it('matches the actor by userId, userName or userEmail', () => {
    const row = { field: 'assignee', before: huong, after: null, createdAt: INCIDENT, userId: 'U1', userEmail: 'admin@local.dev' };
    expect(incidentRows('designer', [row], { ...W, actor: 'U1' })).toHaveLength(1);
    expect(incidentRows('designer', [row], { ...W, actor: 'admin@local.dev' })).toHaveLength(1);
  });
});

describe('tool-ok group', () => {
  const okLogs: UndoLogRow[] = [
    log('toolResultNote', null, 'ok', '2026-10-05T08:00:00Z', 'Hanh'),
    { field: 'toolResultNote', before: 'ok', after: null, createdAt: INCIDENT, userName: ACTOR },
  ];

  it('puts the order back in the print queue, waiting since its original ok, when the cascade emptied it', () => {
    const p = planUndo('tool-ok', { _id: 'O2', productionId: 'P2', toolResultNote: null, readyForFulfill: false }, okLogs, W);
    expect(p?.status).toBe('restore');
    if (p?.status !== 'restore') return;
    expect(p.set).toEqual({
      toolResultNote: 'ok',
      readyForFulfill: true,
      currentFulfillmentStage: 'print',
      'fulfillmentStages.print': { status: 'waiting', reworkCount: 0, workMs: 0, waitingAt: t('2026-10-05T08:00:00Z') },
    });
  });

  it('keeps a stage that was started (the cascade did not clear it): note + ready only', () => {
    const p = planUndo('tool-ok', { _id: 'O3', productionId: 'P3', toolResultNote: null, currentFulfillmentStage: 'press', fulfillmentStages: { print: { completedAt: t('2026-10-05T09:00:00Z') } } }, okLogs, W);
    expect(p?.status === 'restore' && p.set).toEqual({ toolResultNote: 'ok', readyForFulfill: true });
  });

  it('skips when someone set a tool note again after the incident', () => {
    const logs = [...okLogs, log('toolResultNote', null, 'ok', '2026-10-06T02:00:00Z', 'Hoang Anh')];
    expect(planUndo('tool-ok', { _id: 'O2', productionId: 'P2', toolResultNote: 'ok' }, logs, W)).toMatchObject({ status: 'skip', reason: 'edited-after' });
  });
});

it('tool-result group: plain rewind of the field, guarded on the incident value', () => {
  const logs = [{ field: 'toolResult', before: 'no-tool', after: 'has-tool', createdAt: INCIDENT, userName: ACTOR }];
  const p = planUndo('tool-result', { _id: 'O4', productionId: 'P4', toolResult: 'has-tool' }, logs, W);
  expect(p?.status === 'restore' && { set: p.set, guard: p.guard }).toEqual({ set: { toolResult: 'no-tool' }, guard: { toolResult: 'has-tool' } });
});
