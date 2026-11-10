/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Seed builders. Document shapes follow what the app itself writes (see the black-box verification of
 * PR #77): orders as the importer leaves them, order logs with a 16-char string `_id` and the actor as
 * userId / userName / userEmail / roleCode.
 */
import { db, newId, uniq } from './db';
import { USERS, type UserKey } from './env';

export const H = 3600_000;
export const ago = (ms: number) => new Date(Date.now() - ms);

export const E2E_FACTORY = { name: '[E2E] Test factory', shortName: 'E2E' };

let factoryIdCache: string | undefined;
export async function factoryId(): Promise<string> {
  if (factoryIdCache) return factoryIdCache;
  const f = await (await db()).collection('factories').findOne({ shortName: E2E_FACTORY.shortName });
  if (!f) throw new Error('e2e factory missing — global setup did not run');
  factoryIdCache = String(f._id);
  return factoryIdCache;
}

/** Product config of the seeded orders: its variation SKU ends with the order size, so list rows show it. */
export const E2E_PRODUCT = { fullName: 'E2E Heavyweight Tee', shortName: 'E2ETEE', variantSku: 'E2ETEE-BLACK-L' };
let productIdCache: string | undefined;
export async function productConfigId(): Promise<string> {
  if (productIdCache) return productIdCache;
  const p = await (await db()).collection('productConfigs').findOne({ shortName: E2E_PRODUCT.shortName });
  if (!p) throw new Error('e2e product config missing — global setup did not run');
  productIdCache = String(p._id);
  return productIdCache;
}

export async function user(key: UserKey): Promise<any> {
  return (await db()).collection('users').findOne({ email: USERS[key].email });
}

/** Actor fields exactly as `OrderLogService.write` stores them. */
export async function actor(key: UserKey) {
  const u = await user(key);
  const role = await (await db()).collection('roles').findOne({ _id: u.roleId });
  return { userId: String(u._id), userName: u.fullName, userEmail: u.email, roleCode: role?.name };
}

export interface SeedOrderOpts {
  pid?: string;
  type?: string;
  [k: string]: unknown;
}

/** One order line in the e2e factory, entered production 20 min ago, tool result `has-tool`, no designer. */
export async function seedOrder(over: SeedOrderOpts = {}): Promise<{ _id: string; productionId: string; doc: any }> {
  const _id = newId();
  const productionId = over.pid ?? `E2E-${uniq()}-${uniq()}`;
  const fid = await factoryId();
  const doc = {
    _id,
    productionId,
    orderId: productionId.split('-').slice(0, 2).join('-'),
    type: over.type ?? E2E_PRODUCT.fullName,
    productConfigId: await productConfigId(),
    size: 'L',
    color: 'Black',
    quantity: 1,
    designs: [],
    factoryId: fid,
    originalFactoryId: fid,
    userSku: 'E2ESELLER',
    userEmail: 'e2e.seller@test.local',
    baseCost: 5.09,
    shipCost: 2.5,
    priority: 0,
    readyForFulfill: false,
    fulfillmentStages: {},
    fulfillmentTimeline: [],
    designerStatus: 'unassigned',
    toolResult: 'has-tool',
    toolResultNote: null,
    // Recent, so the Workshop default view (today) lists it.
    inProductionAt: ago(20 * 60_000),
    orderAt: ago(8 * H),
    createdAt: ago(8 * H),
    updatedAt: ago(1 * H),
    e2eSeed: true,
    ...over,
  };
  delete (doc as any).pid;
  await (await db()).collection('orders').insertOne(doc);
  return { _id, productionId, doc };
}

/** A historic order-log row (the shape `OrderLogService.write` produces). */
export function logRow(orderId: string, who: Record<string, unknown>, action: string, field: string, before: unknown, after: unknown, when: Date) {
  return {
    _id: newId(),
    orderId,
    ...who,
    action,
    field,
    before,
    after,
    ip: '127.0.0.1',
    userAgent: 'e2e-seed',
    createdAt: when,
    updatedAt: when,
  };
}

export async function seedLogs(rows: any[]): Promise<void> {
  if (rows.length) await (await db()).collection('orderLogs').insertMany(rows);
}

/** A seller (customers row) with an empty wallet — the shape `customers/sync` creates. */
export async function seedSeller(balance = 0): Promise<{ _id: string; name: string; userSku: string }> {
  const tag = uniq();
  const _id = newId();
  const userSku = `E2ESELLER${tag}`;
  const name = `E2E Seller ${tag}`;
  await (await db()).collection('customers').insertOne({
    _id,
    userSku,
    userEmail: `e2e.seller.${tag.toLowerCase()}@test.local`,
    fullName: name,
    password: '',
    source: 'sync',
    walletBalance: balance,
    creditLimit: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { _id, name, userSku };
}
