/**
 * Starts the BUILT API (apps/api/dist-prod, same as `node ./start.js`) for the e2e run, with every setting
 * that could reach something shared or real overridden in the process environment. dotenv and Nest
 * ConfigModule never override a variable that is already set, so these win over apps/api/.env.development
 * (global setup double-checks: it asks the API which database it writes to).
 *
 * Isolation:
 *  - DB_URI → the throwaway database E2E_DB on the local replica set.
 *  - PORT 3107; CORS / WEB_URL → the e2e Vite on 5273.
 *  - Redis: its own logical DB, so sessions and BullMQ queues never mix with the developer API on :3007.
 *  - RabbitMQ: a dead address (the client is `wait: false`), so this process never consumes dev queues.
 *  - Every external integration URL → a black hole; every third-party token / password → empty.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'api');
const port = process.env.E2E_API_PORT || '3107';
const webPort = process.env.E2E_WEB_PORT || '5273';
const db = process.env.E2E_DB;
if (!db || !db.startsWith('onos-e2e-')) {
  console.error('[e2e api] E2E_DB missing or not an onos-e2e-* name — refusing to start.');
  process.exit(1);
}
if (!fs.existsSync(path.join(apiDir, 'dist-prod', 'main.js')) && !fs.existsSync(path.join(apiDir, 'dist', 'main.js'))) {
  console.error('[e2e api] apps/api is not built. Run `pnpm --filter ./apps/api build:win` first.');
  process.exit(1);
}

const KEEP = new Set([
  'REDIS_PASSWORD',
  'MASTER_PASSWORD',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'API_KEY_MASTER_KEY',
  'AES_256_SECRET',
  'DOWNLOAD_HMAC_SECRET',
  'RECAPTCHA_SECRET_KEY',
  'VNP_TRACKING_CRON_SECRET',
]);
const env = { ...process.env };
const devEnvFile = path.join(apiDir, '.env.development');
if (fs.existsSync(devEnvFile)) {
  for (const line of fs.readFileSync(devEnvFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, value] = m;
    if (KEEP.has(key)) continue;
    if (/(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|CLIENT_ID|USERNAME|_EMAIL$|EMAIL_SCAN_FROM|ACCOUNT_ID)/.test(key)) env[key] = '';
    else if (/(_URL|_URI|_ENDPOINT)$/.test(key) && /^\s*https?:\/\//.test(value) && !/localhost|127\.0\.0\.1/.test(value)) env[key] = 'http://127.0.0.1:9';
  }
}
Object.assign(env, {
  NODE_ENV: 'development',
  PORT: port,
  DB_URI: `${process.env.E2E_MONGO_HOST || 'mongodb://localhost:27017'}/${db}?replicaSet=rs0&directConnection=true`,
  ALLOWED_ORIGINS: `http://localhost:${webPort}`,
  WEB_URL: `http://localhost:${webPort}`,
  REDIS_DB: process.env.E2E_REDIS_DB || '13',
  RATE_LIMITER_ENABLED: 'false',
  RABBITMQ_URI: 'amqp://127.0.0.1:1',
  RABBITMQ_MAIN_EXCHANGE: 'onosfactory-e2e',
  TELEGRAM_NOTIFICATION_ENABLED: 'false',
  SCHEDULED_REPORTS_ENABLED: 'false',
  TELEGRAM_WEBHOOK_URL: '',
  ENABLE_ORM_LOGS: 'false',
});

console.log(`[e2e api] starting on :${port} with db=${db} (redis db ${env.REDIS_DB})`);
const child = spawn(process.execPath, ['./start.js'], { cwd: apiDir, env, stdio: 'inherit' });
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
child.on('exit', (code) => process.exit(code ?? 0));
