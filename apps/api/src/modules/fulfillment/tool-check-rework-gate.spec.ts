import { canSendBackToToolCheck, factoryAllowsToolCheckRework, FulfillmentStage } from 'shared';

/**
 * The "Soát tool" chip in `ReworkBackDialog` and the server guard share these two functions. If either
 * misreads the flag or the stage, the chip never shows and the experiment silently measures 0 — so the
 * exact render condition is pinned here (apps/web has no component-test setup).
 */
describe('canSendBackToToolCheck — the chip and the server guard', () => {
  it('flag ON + Print stage → allowed', () => {
    expect(canSendBackToToolCheck(true, FulfillmentStage.Print)).toBe(true);
  });

  it('flag OFF or unknown → refused', () => {
    expect(canSendBackToToolCheck(false, FulfillmentStage.Print)).toBe(false);
    expect(canSendBackToToolCheck(undefined, FulfillmentStage.Print)).toBe(false);
  });

  it('any other stage (or no stage) → refused even with the flag ON', () => {
    for (const stage of [FulfillmentStage.Press, FulfillmentStage.QCPostPress, FulfillmentStage.Pack, undefined]) {
      expect(canSendBackToToolCheck(true, stage)).toBe(false);
    }
  });
});

describe('factoryAllowsToolCheckRework — reading the flag from /factories/options', () => {
  const options = [
    { _id: 'f-ml', allowToolCheckRework: true },
    { _id: 'f-tn', allowToolCheckRework: false },
    { _id: 'f-old' }, // option row from an API that predates the field
  ];

  it('finds the worker factory by id and reads its flag', () => {
    expect(factoryAllowsToolCheckRework(options, 'f-ml')).toBe(true);
    expect(factoryAllowsToolCheckRework(options, 'f-tn')).toBe(false);
    expect(factoryAllowsToolCheckRework(options, 'f-old')).toBe(false);
  });

  it('is OFF when the id is unknown, missing, or the list has not loaded yet', () => {
    expect(factoryAllowsToolCheckRework(options, 'nope')).toBe(false);
    expect(factoryAllowsToolCheckRework(options, undefined)).toBe(false);
    expect(factoryAllowsToolCheckRework([], 'f-ml')).toBe(false);
  });

  it('matches an ObjectId-like id by its string form', () => {
    expect(factoryAllowsToolCheckRework(options, { toString: () => 'f-ml' } as unknown as string)).toBe(true);
  });
});
