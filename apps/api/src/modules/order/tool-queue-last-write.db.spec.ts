import type { Collection, Connection } from 'mongoose';
import mongoose from 'mongoose';

import { describeDb } from '../customer-wallet/wallet-test-db';
import { OrderLogEntity, OrderLogSchema } from '../order-log/order-log.entity';
import { ORDER_LOG_SOURCE_DESIGN_REVIEW_TOOL, OrderLogService } from '../order-log/order-log.service';
import { designReviewToolCtx, findLastToolWrite, type OrderLogFinder, toolQueueStalled } from './tool-queue-return.logic';

/**
 * R2 on a REAL MongoDB: the "tool looks stopped" check on /adm/tool-queue-return.
 * (a) a lookup that runs past maxTimeMS must give "unknown", never "the tool has not written";
 * (b) only rows the tool's result door labelled as its own count — a newer system write with no acting
 *     user (cron, sync, bot) must not make a dead tool look alive.
 * Rows are written through the real `OrderLogService` (repo = the real collection) so the label written by
 * the door is the label the lookup reads.
 */
const BASE_URI = process.env.WALLET_TEST_MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';
const now = new Date('2026-11-10T08:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describeDb('tool queue — last write by the tool (R2, real Mongo)', () => {
  let connection: Connection;
  let logs: Collection;
  let service: OrderLogService;

  beforeAll(async () => {
    const dbName = `onos-toolwrite-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    connection = await mongoose.createConnection(BASE_URI, { dbName, autoIndex: false, serverSelectionTimeoutMS: 30_000 }).asPromise();
    const model = connection.model(OrderLogEntity.name, OrderLogSchema);
    await model.createCollection();
    await model.createIndexes();
    logs = model.collection;
    // The service stamps createdAt itself; the spec pins it so "newer"/"older" is explicit.
    let at = now;
    service = new OrderLogService({
      create: (doc: Record<string, unknown>) => logs.insertOne({ ...doc, createdAt: at }),
      createMany: (docs: Array<Record<string, unknown>>) => logs.insertMany(docs.map((d) => ({ ...d, createdAt: at }))),
    } as never);
    (service as unknown as { at: (d: Date) => void }).at = (d: Date) => {
      at = d;
    };
  }, 60_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await connection?.close();
  });

  beforeEach(async () => {
    await logs.deleteMany({});
  });

  const writeAt = async (d: Date, params: Parameters<OrderLogService['write']>[0]) => {
    (service as unknown as { at: (d: Date) => void }).at(d);
    await service.write(params);
  };
  const finder = () => logs as unknown as OrderLogFinder;

  it('(b) a newer userless system write does NOT count as the tool writing', async () => {
    // The tool last wrote 3 hours ago through its door...
    await writeAt(minutesAgo(180), {
      orderId: 'o1', action: 'update', field: 'toolResult', before: null, after: 'has-tool',
      ctx: designReviewToolCtx({ ip: '10.0.0.5', userAgent: 'python-requests/2.31' }),
    });
    // ...since then only system jobs (no user, no label) and a person touched toolResult.
    await writeAt(minutesAgo(5), { orderId: 'o2', action: 'update', field: 'toolResult', before: 'has-tool', after: null });
    await writeAt(minutesAgo(3), {
      orderId: 'o3', action: 'update', field: 'toolResult', before: null, after: 'no-tool',
      ctx: { ip: '127.0.0.1', userAgent: 'onospod-hold-sync' },
    });
    await writeAt(minutesAgo(1), {
      orderId: 'o4', action: 'update', field: 'toolResult', before: null, after: 'has-tool',
      ctx: { user: { _id: 'u1', fullName: 'Admin', email: 'a@x' } as never },
    });

    // The pre-fix rule ("toolResult row with no acting user") takes the sync's write 3 minutes ago for the tool.
    const legacy = await logs.find({ field: 'toolResult', userId: null }).sort({ createdAt: -1 }).limit(1).toArray();
    expect(legacy[0]?.createdAt).toEqual(minutesAgo(3));

    const last = await findLastToolWrite(finder());

    expect(last).toEqual({ known: true, at: minutesAgo(180) });
    expect(toolQueueStalled(42, last, now)).toBe(true);
  });

  it('(b) a recent tool write keeps the alert off', async () => {
    await writeAt(minutesAgo(2), {
      orderId: 'o1', action: 'update', field: 'toolResult', before: null, after: 'has-tool',
      ctx: designReviewToolCtx({ ip: '10.0.0.5', userAgent: 'python-requests/2.31' }),
    });
    // A labelled row of another field (the door also writes toolResultNote) is not a toolResult write.
    await writeAt(minutesAgo(1), {
      orderId: 'o1', action: 'update', field: 'toolResultNote', before: null, after: 'ok',
      ctx: designReviewToolCtx({ ip: '10.0.0.5' }),
    });

    const last = await findLastToolWrite(finder());

    expect(last).toEqual({ known: true, at: minutesAgo(2) });
    expect(toolQueueStalled(42, last, now)).toBe(false);
  });

  it('(b) only userless writes and no tool label at all → "never wrote" (alert), not alive', async () => {
    await writeAt(minutesAgo(1), { orderId: 'o2', action: 'update', field: 'toolResult', before: 'has-tool', after: null });

    const last = await findLastToolWrite(finder());

    expect(last).toEqual({ known: true, at: null });
    expect(toolQueueStalled(42, last, now)).toBe(true);
  });

  it('(b) the lookup is served by the partial index on the label', async () => {
    await writeAt(minutesAgo(2), {
      orderId: 'o1', action: 'update', field: 'toolResult', after: 'has-tool', ctx: designReviewToolCtx(),
    });
    const plan = await logs
      .find({ source: ORDER_LOG_SOURCE_DESIGN_REVIEW_TOOL, field: 'toolResult' })
      .sort({ createdAt: -1 })
      .limit(1)
      .explain('queryPlanner');

    expect(JSON.stringify(plan)).toContain('source_field_createdAt');
  });

  it('(a) a lookup that really exceeds maxTimeMS on the server is UNKNOWN — no red alert', async () => {
    for (let i = 0; i < 20; i++) {
      await writeAt(minutesAgo(10 + i), {
        orderId: `o${i}`, action: 'update', field: 'toolResult', after: 'has-tool', ctx: designReviewToolCtx(),
      });
    }
    // Same query, slowed down server-side so it cannot finish inside the 50 ms budget.
    const slow: OrderLogFinder = {
      find: (filter, options) =>
        logs.find({ ...filter, $where: 'sleep(20) || true' }, options) as unknown as ReturnType<OrderLogFinder['find']>,
    };
    let serverError: unknown;
    await logs
      .find({ $where: 'sleep(20) || true' })
      .maxTimeMS(50)
      .toArray()
      .catch((e: unknown) => (serverError = e));
    expect((serverError as { codeName?: string } | undefined)?.codeName).toBe('MaxTimeMSExpired');

    const last = await findLastToolWrite(slow, 50);

    expect(last).toEqual({ known: false });
    expect(toolQueueStalled(42, last, now)).toBeNull();
  });
});
