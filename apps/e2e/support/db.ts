/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Direct database access — ONLY for (a) seeding state that has no API (historic order logs, tool results
 * written by the external tool, orders as the importer leaves them) and (b) asserting what was written.
 * Every action under test goes through the browser or the real HTTP API.
 */
import { DB_PREFIX, dbName, mongoServerUri } from './env';
import { mongodb } from './deps';

let client: any;

export async function db(): Promise<any> {
  const name = dbName();
  if (!name.startsWith(DB_PREFIX)) throw new Error('refusing to touch a non-e2e database: ' + name);
  if (!client) client = await new mongodb.MongoClient(mongoServerUri()).connect();
  return client.db(name);
}

export async function closeDb(): Promise<void> {
  if (client) await client.close();
  client = undefined;
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Same shape as the app's `myId()`: 16 chars [0-9A-Z]. */
export function newId(len = 16): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** Short unique tag for productionIds / names so tests never collide inside one run. */
export const uniq = () => newId(6);

export async function order(id: string): Promise<any> {
  return (await db()).collection('orders').findOne({ _id: id });
}

export async function customer(id: string): Promise<any> {
  return (await db()).collection('customers').findOne({ _id: id });
}

export async function walletTxns(customerId: string): Promise<any[]> {
  return (await db()).collection('customer_wallet_transactions').find({ customerId }).sort({ createdAt: 1 }).toArray();
}
