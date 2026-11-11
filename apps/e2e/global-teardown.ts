/** Drops the throwaway database (only ever an onos-e2e-* name). Set E2E_KEEP_DB=1 to inspect it after a run. */
import { mongodb } from './support/deps';
import { DB_PREFIX, dbName, mongoServerUri } from './support/env';

export default async function globalTeardown() {
  const name = dbName();
  if (!name.startsWith(DB_PREFIX)) throw new Error('refusing to drop ' + name);
  if (process.env.E2E_KEEP_DB === '1') {
    console.log(`[e2e] keeping database ${name}`);
    return;
  }
  const client = await new mongodb.MongoClient(mongoServerUri()).connect();
  try {
    await client.db(name).dropDatabase();
    console.log(`[e2e] dropped database ${name}`);
  } finally {
    await client.close();
  }
}
