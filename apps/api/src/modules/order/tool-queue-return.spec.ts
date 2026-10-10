import { runToolQueueReturn, type ToolQueueDoc,toolQueueReturnEligibility, toolQueueStalled } from './tool-queue-return.logic';

const US = 'f-us';
const SKIP = new Set(['f-dtf']);
const base = (over: ToolQueueDoc = {}): ToolQueueDoc => ({ factoryId: 'f-ml', toolResult: 'has-tool', toolResultNote: '', ...over });
const verdict = (over: ToolQueueDoc = {}) => toolQueueReturnEligibility(base(over), US, SKIP);

describe('toolQueueReturnEligibility — who may go back to the queue', () => {
  it('takes an order with a toolResult, no note, open, mapped, normal factory', () => {
    expect(verdict()).toBeNull();
    expect(verdict({ toolResultNote: null })).toBeNull();
    expect(verdict({ toolResultNote: undefined })).toBeNull();
    expect(verdict({ toolResult: 'no-tool' })).toBeNull();
  });

  it('NEVER takes an order whose toolResultNote has any value (someone is working it by hand)', () => {
    for (const note of ['ok', 'error', 'no-pdf', 'h', 'x']) {
      expect(verdict({ toolResultNote: note })).toBe('has-note');
    }
  });

  it('has nothing to clear when toolResult is already empty', () => {
    for (const v of ['', null, undefined, '  ']) expect(verdict({ toolResult: v })).toBe('no-tool-result');
  });

  it('refuses cancelled, deleted and completed orders', () => {
    expect(verdict({ cancelledAt: new Date() })).toBe('cancelled');
    expect(verdict({ deletedAt: new Date() })).toBe('cancelled');
    expect(verdict({ fulfillmentCompletedAt: new Date() })).toBe('completed');
  });

  it('names (never silently drops) the US factory, skip-tool-check factories, unmapped and held orders', () => {
    expect(verdict({ factoryId: US })).toBe('excluded-factory');
    expect(verdict({ factoryId: 'f-dtf' })).toBe('skip-tool-check');
    expect(verdict({ factoryId: undefined })).toBe('unmapped');
    expect(verdict({ heldAt: new Date() })).toBe('held');
  });

  it('a missing order is reported as not-found', () => {
    expect(toolQueueReturnEligibility(null, US, SKIP)).toBe('not-found');
  });
});

describe('runToolQueueReturn — re-check at write time', () => {
  // A tiny in-memory "database" so the loop is exercised exactly as the service calls it.
  const makeDb = (docs: Record<string, ToolQueueDoc & { productionId: string }>) => {
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

  it('skips and reports an order that got a note between the preview and the click, and never writes it', async () => {
    const db = makeDb({
      a: { ...base(), productionId: 'P-A' },
      b: { ...base(), productionId: 'P-B' },
      c: { ...base(), productionId: 'P-C' },
    });
    // The tool records a result for "b" AFTER the list/preview was read, BEFORE the run reaches it.
    db.docs.b = { ...db.docs.b, toolResultNote: 'ok' };

    const res = await runToolQueueReturn({ ids: ['a', 'b', 'c'], load: db.load, write: db.write, excludedFactoryId: US, skipToolCheckIds: SKIP });

    expect(db.written).toEqual(['a', 'c']);
    expect(res.done).toEqual(['a', 'c']);
    expect(res.skipped).toEqual([{ id: 'b', productionId: 'P-B', reason: 'has-note' }]);
    expect(db.docs.b.toolResult).toBe('has-tool'); // untouched
  });

  it('re-checks each order right before ITS write, not once up front', async () => {
    const db = makeDb({ a: { ...base(), productionId: 'P-A' }, b: { ...base(), productionId: 'P-B' } });
    // The note appears on "b" while "a" is being written.
    const originalWrite = db.write;
    db.write = async (id: string) => {
      await originalWrite(id);
      if (id === 'a') db.docs.b = { ...db.docs.b, toolResultNote: 'error' };
    };

    const res = await runToolQueueReturn({ ids: ['a', 'b'], load: db.load, write: db.write, excludedFactoryId: US, skipToolCheckIds: SKIP });

    expect(res.done).toEqual(['a']);
    expect(res.skipped.map((s) => [s.id, s.reason])).toEqual([['b', 'has-note']]);
  });

  it('records the previous value of every written order, skips duplicates, and survives a write error', async () => {
    const db = makeDb({
      a: { ...base({ toolResult: 'no-tool' }), productionId: 'P-A' },
      b: { ...base(), productionId: 'P-B' },
    });
    const failing = async (id: string) => {
      if (id === 'b') throw new Error('boom');
      await db.write(id);
    };

    const res = await runToolQueueReturn({ ids: ['a', 'a', 'b', 'gone'], load: db.load, write: failing, excludedFactoryId: US, skipToolCheckIds: SKIP });

    expect(res.previous).toEqual([['a', 'no-tool']]);
    expect(res.skipped).toEqual([
      { id: 'b', productionId: 'P-B', reason: 'boom' },
      { id: 'gone', productionId: undefined, reason: 'not-found' },
    ]);
  });
});

describe('toolQueueStalled — is the automatic checker alive', () => {
  const now = new Date('2026-10-06T01:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it('is stalled when orders wait and the tool has been silent past the threshold', () => {
    expect(toolQueueStalled(1053, ago(61), now)).toBe(true);
    expect(toolQueueStalled(5, ago(60 * 24), now)).toBe(true);
  });

  it('is fine when the tool wrote recently, or exactly at the threshold', () => {
    expect(toolQueueStalled(1053, ago(5), now)).toBe(false);
    expect(toolQueueStalled(1053, ago(60), now)).toBe(false);
  });

  it('with orders waiting and no write ever seen, there is no evidence it works → stalled', () => {
    expect(toolQueueStalled(3, null, now)).toBe(true);
  });

  it('an idle tool with an empty queue is normal, never an alarm', () => {
    expect(toolQueueStalled(0, ago(60 * 24), now)).toBe(false);
    expect(toolQueueStalled(0, null, now)).toBe(false);
  });
});
