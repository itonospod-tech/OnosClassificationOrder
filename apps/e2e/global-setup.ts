/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Runs after both web servers are up (Playwright starts `webServer` first): the API has booted on the
 * EMPTY e2e database and seeded its system roles + default factories. Here we add the test accounts and
 * the test factory, and prove the API really writes to the e2e database (not to the dev DB from
 * apps/api/.env.development): an account that exists ONLY in the e2e database must be able to log in.
 */
import { login, must, rememberToken } from './support/api';
import { bcrypt, mongodb } from './support/deps';
import { closeDb, db, newId } from './support/db';
import { DB_PREFIX, dbName, mongoServerUri, PASSWORD, USERS } from './support/env';
import { E2E_FACTORY, E2E_PRODUCT } from './support/seed';

async function dropStaleE2eDatabases(current: string) {
  const client = await new mongodb.MongoClient(mongoServerUri()).connect();
  try {
    const { databases } = await client.db().admin().listDatabases();
    const cutoff = Date.now() - 3 * 3600_000;
    for (const d of databases as Array<{ name: string }>) {
      if (!d.name.startsWith(DB_PREFIX) || d.name === current) continue;
      const stamp = d.name.slice(DB_PREFIX.length);
      const t = /^\d{14}$/.test(stamp)
        ? Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12))
        : 0;
      if (t && t < cutoff) await client.db(d.name).dropDatabase();
    }
  } finally {
    await client.close();
  }
}

export default async function globalSetup() {
  const name = dbName();
  await dropStaleE2eDatabases(name);
  const d = await db();

  // Roles are seeded by RoleService.onModuleInit; wait until all the ones we need exist.
  const need = [...new Set(Object.values(USERS).map((u) => u.role))];
  for (let i = 0; i < 60; i++) {
    const n = await d.collection('roles').countDocuments({ name: { $in: need } });
    if (n === need.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const users = d.collection('users');
  for (const u of Object.values(USERS)) {
    const role = await d.collection('roles').findOne({ name: u.role });
    if (!role) throw new Error(`role ${u.role} not seeded by the API`);
    await users.updateOne(
      { email: u.email },
      {
        $setOnInsert: { _id: newId(), createdAt: new Date() },
        $set: {
          email: u.email,
          fullName: u.fullName,
          password: bcrypt.hashSync(PASSWORD, 10),
          roleId: String(role._id),
          userCode: newId(8),
          status: '1',
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  // Isolation proof: these accounts exist only in `name`.
  const tok = await login(USERS.admin.email);
  rememberToken('admin', tok);

  if (!(await d.collection('factories').findOne({ shortName: E2E_FACTORY.shortName }))) {
    await must('admin', 'POST', '/factories', { ...E2E_FACTORY, isActive: true });
  }
  const f: any = await d.collection('factories').findOne({ shortName: E2E_FACTORY.shortName });
  if (!f || f.skipToolCheck) throw new Error('e2e factory missing or has skipToolCheck on');
  // Product config (seeded: the catalog has no small create API). One variation whose SKU ends with the
  // seeded size 'L', so list rows carry a variant SKU.
  await d.collection('productConfigs').updateOne(
    { shortName: E2E_PRODUCT.shortName },
    {
      $setOnInsert: { _id: newId(), createdAt: new Date() },
      $set: {
        fullName: E2E_PRODUCT.fullName,
        shortName: E2E_PRODUCT.shortName,
        factoryId: String(f._id),
        status: 'active',
        variations: [{ sku: E2E_PRODUCT.variantSku, size: 'L', color: 'Black' }],
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  console.log(`[e2e] database ${name} ready (factory ${f._id})`);
  await closeDb();
}
