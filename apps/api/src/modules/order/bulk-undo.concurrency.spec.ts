import type { Connection, Model } from 'mongoose';
import mongoose from 'mongoose';
import { DesignerStatus, RoleType } from 'shared';

import { describeDb } from '../customer-wallet/wallet-test-db';
import { BulkUndoService } from './bulk-undo.service';
import { OrderEntity, OrderSchema } from './order.entity';

/**
 * R5 on a REAL MongoDB: the tool-note / tool-ok undo writes a wiped stage snapshot back only onto an order
 * still exactly as the wipe left it. Planning and writing are separate steps of `BulkUndoService.run`, so
 * a change that lands BETWEEN them must be caught by the write guard (one atomic conditional update per
 * order), not by the planner. Each case injects that change right before the write.
 */
const BASE_URI = process.env.WALLET_TEST_MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';
const ACTOR = 'Admin User';
const from = new Date('2026-10-05T21:33:00Z');
const to = new Date('2026-10-05T21:35:00Z');
const at = new Date('2026-10-05T21:33:15Z');
const waitingAt = new Date('2026-10-05T16:00:00Z');
const snapshot = { print: { status: 'waiting', reworkCount: 0, workMs: 0, waitingAt } };

describeDb('bulk undo R5 — the write guard against a change between plan and write (real Mongo)', () => {
  let connection: Connection;
  let orderModel: Model<OrderEntity>;
  let service: BulkUndoService;
  let restoreRows: Array<Record<string, unknown>>;
  /** Runs once, right before the undo's conditional write (simulates another user acting meanwhile). */
  let beforeWrite: (() => Promise<unknown>) | null;

  beforeAll(async () => {
    const dbName = `onos-undo-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    connection = await mongoose.createConnection(BASE_URI, { dbName, autoIndex: false, serverSelectionTimeoutMS: 30_000 }).asPromise();
    orderModel = connection.model(OrderEntity.name, OrderSchema);
    const write = orderModel.findOneAndUpdate.bind(orderModel);
    (orderModel as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (...args: unknown[]) => {
      const run = beforeWrite;
      beforeWrite = null;
      return (run ? run() : Promise.resolve()).then(() => (write as (...a: unknown[]) => unknown)(...args));
    };
    service = new BulkUndoService(
      orderModel as never,
      { writeMany: (rows: Array<Record<string, unknown>>) => Promise.resolve(void restoreRows.push(...rows)) } as never,
      { info: () => undefined } as never,
    );
  }, 60_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await connection?.close();
  });

  /** An order In reported (tool-check), then the culprit cleared its note in bulk: stages wiped and logged. */
  async function seedWiped(id: string, extra: Record<string, unknown> = {}) {
    restoreRows = [];
    beforeWrite = null;
    await orderModel.collection.insertOne({
      _id: id as never,
      productionId: `P-${id}`,
      toolResultNote: null,
      productionErrorSource: 'tool-check',
      readyForFulfill: false,
      currentFulfillmentStage: null,
      fulfillmentStages: {},
      assignee: null,
      designerStatus: DesignerStatus.Unassigned,
      ...extra,
    });
    const row = (field: string, before: unknown, after: unknown, createdAt: Date, userName = ACTOR) => ({ orderId: id, action: 'update', field, before, after, createdAt, userName });
    await connection.collection('orderLogs').insertMany([
      row('toolResultNote', 'ok', 'error', new Date('2026-10-05T18:00:00Z'), 'Print worker'),
      row('toolResultNote', 'error', null, at),
      row('currentFulfillmentStage', 'print', null, at),
      row('fulfillmentStages', snapshot, undefined, at), // `after: {}` is dropped by Mongoose minimize — stored missing
    ]);
  }
  const run = (id: string) => service.run({ actor: ACTOR, from, to, group: 'tool-note', ids: [id], reason: 'test R5 concurrency' }, RoleType.SuperAdmin);
  const doc = (id: string) => orderModel.collection.findOne({ _id: id as never });

  it('nothing changed meanwhile: note, stage pointer and the exact snapshot (real Dates) are written back', async () => {
    await seedWiped('C1');
    const res = await run('C1');
    expect(res.rows[0]).toMatchObject({ status: 'restored' });
    expect(await doc('C1')).toMatchObject({ toolResultNote: 'error', currentFulfillmentStage: 'print', fulfillmentStages: snapshot });
    expect(restoreRows.find((r) => r.field === 'fulfillmentStages')).toMatchObject({ after: snapshot });
  });

  it('the order re-entered Print between plan and write → changed-during-run, the new stage is kept', async () => {
    await seedWiped('C2');
    const fresh = { print: { status: 'waiting', reworkCount: 0, workMs: 0, waitingAt: new Date() } };
    beforeWrite = () => orderModel.collection.updateOne({ _id: 'C2' as never }, { $set: { currentFulfillmentStage: 'print', fulfillmentStages: fresh } });
    expect((await run('C2')).rows[0]).toMatchObject({ status: 'skip', reason: 'changed-during-run' });
    expect(await doc('C2')).toMatchObject({ toolResultNote: null, currentFulfillmentStage: 'print', fulfillmentStages: fresh });
    expect(restoreRows).toEqual([]);
  });

  it('only a stage entry appeared (pointer still empty) → changed-during-run', async () => {
    await seedWiped('C3');
    beforeWrite = () => orderModel.collection.updateOne({ _id: 'C3' as never }, { $set: { 'fulfillmentStages.print': { status: 'rework' } } });
    expect((await run('C3')).rows[0]).toMatchObject({ status: 'skip', reason: 'changed-during-run' });
  });

  it('a designer took the order between plan and write → changed-during-run', async () => {
    await seedWiped('C4');
    beforeWrite = () => orderModel.collection.updateOne({ _id: 'C4' as never }, { $set: { assignee: 'HUONG', designerStatus: DesignerStatus.Assigned } });
    expect((await run('C4')).rows[0]).toMatchObject({ status: 'skip', reason: 'changed-during-run' });
    expect(await doc('C4')).toMatchObject({ currentFulfillmentStage: null, assignee: 'HUONG' });
  });

  it('someone set the note meanwhile → changed-during-run', async () => {
    await seedWiped('C5');
    beforeWrite = () => orderModel.collection.updateOne({ _id: 'C5' as never }, { $set: { toolResultNote: 'no-pdf' } });
    expect((await run('C5')).rows[0]).toMatchObject({ status: 'skip', reason: 'changed-during-run' });
  });

  it('`fulfillmentStages` missing altogether still reads as wiped (guard `$in: [{}, null]`) → restored', async () => {
    await seedWiped('C6');
    await orderModel.collection.updateOne({ _id: 'C6' as never }, { $unset: { fulfillmentStages: '' } });
    expect((await run('C6')).rows[0]).toMatchObject({ status: 'restored' });
    expect(await doc('C6')).toMatchObject({ fulfillmentStages: snapshot });
  });
});
