import { planStageWipe } from './stage-wipe.logic';

/** Leaving 'ok' wipes a pipeline nobody started; the wiped state is what the order log keeps (Orders.md §27). */
describe('planStageWipe', () => {
  const waitingAt = new Date('2026-11-10T12:53:24Z');

  it('a stage pointer and no stage started: wipe, and the snapshot is the whole stage state', () => {
    const stages = { print: { status: 'rework', reworkCount: 0, workMs: 0, waitingAt, reworkAt: new Date('2026-11-10T13:53:44Z') } };
    expect(planStageWipe({ currentFulfillmentStage: 'print', fulfillmentStages: stages })).toEqual({ snapshot: stages });
  });

  it('a worker started a stage: nothing is wiped (the worker keeps the order)', () => {
    expect(planStageWipe({ currentFulfillmentStage: 'print', fulfillmentStages: { print: { firstStartedAt: waitingAt } } })).toBeNull();
  });

  it('a stage started earlier in another stage counts too', () => {
    expect(
      planStageWipe({ currentFulfillmentStage: 'print', fulfillmentStages: { print: {}, press: { firstStartedAt: waitingAt } } }),
    ).toBeNull();
  });

  it('no stage pointer: nothing to wipe', () => {
    expect(planStageWipe({ currentFulfillmentStage: null, fulfillmentStages: {} })).toBeNull();
  });

  it('a stage pointer without any stage entry: wiped, empty snapshot (the order log then writes no snapshot row)', () => {
    expect(planStageWipe({ currentFulfillmentStage: 'print' })).toEqual({ snapshot: {} });
  });
});
