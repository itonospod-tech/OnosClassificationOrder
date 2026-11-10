/**
 * Single source of the e2e environment. Everything here is TEST-ONLY: own ports, own throwaway database,
 * own accounts. Nothing points at the developer DB (`onos-classifycation`), the developer servers
 * (:3007 / :5173) or any production host.
 */
import path from 'node:path';

export const E2E_DIR = path.resolve(__dirname, '..');
export const REPO_DIR = path.resolve(E2E_DIR, '..', '..');
export const API_DIR = path.join(REPO_DIR, 'apps', 'api');
export const WEB_DIR = path.join(REPO_DIR, 'apps', 'web');

export const API_PORT = Number(process.env.E2E_API_PORT || 3107);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5273);
export const API_BASE = `http://localhost:${API_PORT}/api/v1`;
export const WEB_BASE = `http://localhost:${WEB_PORT}`;

/** Every e2e database is named like this; setup and teardown refuse any other name. */
export const DB_PREFIX = 'onos-e2e-';
const MONGO_HOST = process.env.E2E_MONGO_HOST || 'mongodb://localhost:27017';

/**
 * The config file is evaluated in the runner AND in every worker. The runner picks the name once and puts it
 * in process.env, which the workers and the API child process inherit.
 */
export function dbName(): string {
  if (!process.env.E2E_DB) process.env.E2E_DB = `${DB_PREFIX}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  if (!process.env.E2E_DB.startsWith(DB_PREFIX)) throw new Error(`E2E_DB must start with ${DB_PREFIX}`);
  return process.env.E2E_DB;
}
export const mongoServerUri = () => `${MONGO_HOST}/?replicaSet=rs0&directConnection=true`;

/** Test-only accounts, created in the fresh database by global setup. */
export const PASSWORD = 'E2e!Test#2026';
export const USERS = {
  admin: { email: 'e2e.superadmin@test.local', fullName: '[E2E] Super Admin', role: 'SuperAdmin' },
  /** Second SuperAdmin: the "person who made the mistake" in the bulk-undo incidents. */
  culprit: { email: 'e2e.culprit@test.local', fullName: '[E2E] Culprit Admin', role: 'SuperAdmin' },
  designer: { email: 'e2e.designer@test.local', fullName: '[E2E] Designer A', role: 'Designer' },
  designer2: { email: 'e2e.designer2@test.local', fullName: '[E2E] Designer B', role: 'Designer' },
} as const;
export type UserKey = keyof typeof USERS;

/** Comment carried by every expected-failure test. */
export const KNOWN_BUG = 'known bug present on main, not fixed in release 07/11';
