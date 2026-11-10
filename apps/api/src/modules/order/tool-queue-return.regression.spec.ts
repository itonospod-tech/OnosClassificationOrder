import { DESIGNER_STATUSES, DesignerStatus } from 'shared';

import { OrderService } from './order.service';
import { runToolQueueReturn, type ToolQueueDoc, toolQueueReturnEligibility } from './tool-queue-return.logic';

/**
 * Regression cases from the PR #77 test report (release 07/11), bug 5: "return to the tool queue" said
 * done for orders the tool's queue never takes (a designer already holds them), and put orders that are
 * already in production back into tool review.
 *
 * Contract: not eligible, with a named reason,
 *  - 'designer-assigned' when `designerStatus` exists and is not 'unassigned';
 *  - 'in-fulfillment'    when `currentFulfillmentStage` is non-empty;
 * re-checked at write time like every other reason. And the invariant the bug broke: every order this
 * feature returns must actually match the queue filter (`designReviewQueueFilter` in order.service.ts).
 *
 * `ToolQueueDoc` does not declare the two fields yet, so docs are cast.
 */
const US = 'f-us';
const SKIP_ID = 'f-dtf';
const SKIP = new Set([SKIP_ID]);

// The queue filter reads the US factory and the skip-tool-check factories from process caches.
jest.mock('../../utils/excluded-factory', () => ({
  ...jest.requireActual('../../utils/excluded-factory'),
  getExcludedFactoryIdSync: () => 'f-us',
}));
jest.mock('../../utils/merged-flow-factory', () => ({
  ...jest.requireActual('../../utils/merged-flow-factory'),
  listSkipToolCheckFactoryIdsSync: () => ['f-dtf'],
}));

type Doc = ToolQueueDoc & { designerStatus?: unknown; currentFulfillmentStage?: unknown; productionId?: string };
const doc = (over: Record<string, unknown> = {}): Doc =>
  ({ factoryId: 'f-ml', toolResult: 'has-tool', toolResultNote: '', designerStatus: DesignerStatus.Unassigned, ...over }) as Doc;
const verdict = (over: Record<string, unknown> = {}) => toolQueueReturnEligibility(doc(over), US, SKIP);

describe('bug 5 — eligibility knows about the designer and the production stage', () => {
  it.each(DESIGNER_STATUSES.filter((s) => s !== DesignerStatus.Unassigned))("designerStatus '%s' → 'designer-assigned'", (status) => {
    expect(verdict({ designerStatus: status, assignee: 'HUONG' })).toBe('designer-assigned');
  });

  it.each(['print', 'press', 'qc-post-press', 'pack'])("currentFulfillmentStage '%s' → 'in-fulfillment'", (stage) => {
    expect(verdict({ currentFulfillmentStage: stage })).toBe('in-fulfillment');
  });

  // ---- neighbours (pass today, must keep passing) ----
  it("still eligible: designerStatus 'unassigned', no stage (empty / null / missing)", () => {
    expect(verdict()).toBeNull();
    expect(verdict({ currentFulfillmentStage: '' })).toBeNull();
    expect(verdict({ currentFulfillmentStage: null })).toBeNull();
    expect(verdict({ currentFulfillmentStage: undefined })).toBeNull();
    expect(verdict({ toolResult: 'no-tool' })).toBeNull();
  });

  it('the existing reasons are unchanged', () => {
    expect(verdict({ toolResultNote: 'ok' })).toBe('has-note');
    expect(verdict({ toolResult: '' })).toBe('no-tool-result');
    expect(verdict({ cancelledAt: new Date() })).toBe('cancelled');
    expect(verdict({ fulfillmentCompletedAt: new Date() })).toBe('completed');
    expect(verdict({ factoryId: US })).toBe('excluded-factory');
    expect(verdict({ factoryId: SKIP_ID })).toBe('skip-tool-check');
    expect(verdict({ factoryId: undefined })).toBe('unmapped');
    expect(verdict({ heldAt: new Date() })).toBe('held');
  });
});

describe("review — designerStatus missing / null / '' is blocked: the queue filter only takes 'unassigned'", () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty string', ''],
  ])("designerStatus %s → 'designer-status-missing'", (_label, designerStatus) => {
    expect(verdict({ designerStatus })).toBe('designer-status-missing');
  });
});

describe('bug 5 — runToolQueueReturn re-checks the new reasons right before each write', () => {
  const makeDb = (docs: Record<string, Doc>) => {
    const written: string[] = [];
    return {
      docs,
      written,
      load: (id: string) => Promise.resolve(docs[id] ?? null),
      write: (id: string) => {
        written.push(id);
        docs[id] = { ...docs[id], toolResult: '' };
        return Promise.resolve();
      },
    };
  };

  it('skips (and never writes) orders a designer took or production started on between preview and click', async () => {
    const db = makeDb({
      a: doc({ productionId: 'P-A' }),
      b: doc({ productionId: 'P-B' }),
      c: doc({ productionId: 'P-C' }),
      d: doc({ productionId: 'P-D' }),
    });
    db.docs.b = { ...db.docs.b, designerStatus: DesignerStatus.Assigned, assignee: 'HUONG' } as Doc;
    db.docs.c = { ...db.docs.c, currentFulfillmentStage: 'press' };

    const res = await runToolQueueReturn({ ids: ['a', 'b', 'c', 'd'], load: db.load, write: db.write, excludedFactoryId: US, skipToolCheckIds: SKIP });

    expect(db.written).toEqual(['a', 'd']);
    expect(res.done).toEqual(['a', 'd']);
    expect(res.skipped).toEqual([
      { id: 'b', productionId: 'P-B', reason: 'designer-assigned' },
      { id: 'c', productionId: 'P-C', reason: 'in-fulfillment' },
    ]);
    expect(db.docs.b.toolResult).toBe('has-tool');
    expect(db.docs.c.toolResult).toBe('has-tool');
  });

  it('neighbour: eligible orders are still returned and their previous value recorded', async () => {
    const db = makeDb({ a: doc({ productionId: 'P-A', toolResult: 'no-tool' }), b: doc({ productionId: 'P-B' }) });
    const res = await runToolQueueReturn({ ids: ['a', 'b'], load: db.load, write: db.write, excludedFactoryId: US, skipToolCheckIds: SKIP });
    expect(res.done).toEqual(['a', 'b']);
    expect(res.skipped).toEqual([]);
    expect(res.previous).toEqual([['a', 'no-tool'], ['b', 'has-tool']]);
  });
});

/**
 * Minimal evaluator for the operators the queue filter uses ($exists / $in / $nin / equality). Fields are
 * read exactly as stored: a missing / null / '' `designerStatus` is NOT 'unassigned' for Mongo (the schema
 * default only applies to documents written through Mongoose; imports and old data can lack it).
 */
const queueFilter = (): Record<string, unknown> =>
  (OrderService.prototype as unknown as { designReviewQueueFilter: (this: unknown) => Record<string, unknown> }).designReviewQueueFilter.call({
    orderModel: { db: {} },
  });
function matches(filter: Record<string, unknown>, raw: Record<string, unknown>): boolean {
  const d = raw;
  return Object.entries(filter).every(([k, cond]) => {
    const v = (d as Record<string, unknown>)[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('$exists' in c) return (v !== undefined) === c.$exists;
      if ('$in' in c) return (c.$in as unknown[]).includes(v ?? null);
      if ('$nin' in c) return !(c.$nin as unknown[]).includes(v ?? null);
      throw new Error(`queue filter uses an operator this test does not know: ${JSON.stringify(c)}`);
    }
    return v === cond;
  });
}

describe('bug 5 — consistency: an order the feature returns is an order the tool queue takes', () => {
  it('sanity: the evaluator reads the real queue filter (designer unassigned, US/skip factories out)', () => {
    const f = queueFilter();
    expect(f).toMatchObject({ toolResult: { $in: [null, ''] }, designerStatus: DesignerStatus.Unassigned, factoryId: { $nin: [US, SKIP_ID] } });
    expect(matches(f, { factoryId: 'f-ml', toolResult: '', designerStatus: DesignerStatus.Unassigned })).toBe(true);
    expect(matches(f, { factoryId: 'f-ml', toolResult: '' })).toBe(false); // designerStatus missing: the queue never takes it
    expect(matches(f, { factoryId: 'f-ml', toolResult: '', designerStatus: DesignerStatus.Assigned })).toBe(false);
    expect(matches(f, { factoryId: US, toolResult: '', designerStatus: DesignerStatus.Unassigned })).toBe(false);
  });

  it('for every combination: eligible ⇒ after clearing toolResult it matches the queue filter', () => {
    const f = queueFilter();
    const bad: string[] = [];
    let eligible = 0;
    for (const designerStatus of [undefined, null, '', ...DESIGNER_STATUSES])
      for (const currentFulfillmentStage of [undefined, '', 'print', 'press'])
        for (const factoryId of ['f-ml', US, SKIP_ID, undefined])
          for (const heldAt of [undefined, new Date(0)])
            for (const toolResult of ['has-tool', 'no-tool']) {
              const d = { factoryId, toolResult, toolResultNote: '', designerStatus, currentFulfillmentStage, heldAt };
              if (toolQueueReturnEligibility(d as Doc, US, SKIP) !== null) continue;
              eligible++;
              if (!matches(f, { ...d, toolResult: '' })) bad.push(JSON.stringify({ designerStatus, currentFulfillmentStage, factoryId }));
            }
    expect(eligible).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
