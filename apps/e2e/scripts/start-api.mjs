/**
 * Starts the BUILT API (apps/api/dist-prod, same as `node ./start.js`) for the e2e run, with every setting
 * that could reach something shared or real overridden in the process environment. `start.js` loads
 * apps/api/.env and then .env.${NODE_ENV} with dotenv, and Nest ConfigModule loads .env.${NODE_ENV} again; none
 * of them overrides a variable that is already set, so what is set here wins (global setup double-checks: it
 * asks the API which database it writes to).
 *
 * SAFE BY DEFAULT: every key of apps/api/.env and apps/api/.env.development is neutralised — a URL-looking value
 * becomes the black hole http://127.0.0.1:9, anything else '' — unless it is allowlisted: the local-only secrets
 * the API needs to boot (KEEP), plain non-network config (KEEP_CONFIG), local infrastructure kept only while it
 * points at this machine (KEEP_IF_LOCAL). A new integration key in the developer env therefore cannot reach its
 * host from the e2e API until someone allowlists it on purpose. The count is logged, never the values.
 *
 * Then, explicitly:
 *  - DB_URI → the throwaway database E2E_DB on the local replica set.
 *  - PORT 3107; CORS / WEB_URL → the e2e Vite on 5273.
 *  - Redis: its own logical DB, so sessions and BullMQ queues never mix with the developer API on :3007.
 *  - RabbitMQ: a dead address (the client is `wait: false`), so this process never consumes dev queues.
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
/** Plain configuration with no host and no credential (numbers, flags, names, cron times, local paths). */
const KEEP_CONFIG = new Set([
  'APP_NAME',
  'API_VERSION',
  'FALLBACK_LANGUAGE',
  'TRANSPORT_PORT',
  'ENABLE_DOCUMENTATION',
  'JWT_EXPIRATION_TIME',
  'JWT_REMEMBER_EXPIRATION_TIME',
  'REDIS_CACHE_ENABLED',
  'REDIS_PORT',
  'RATE_LIMITER_SESSION_MAX',
  'RATE_LIMITER_SESSION_TTL',
  'RATE_LIMITER_USER_MAX',
  'RATE_LIMITER_USER_TTL',
  'BULLMQ_REFRESH_TRACKING_STATUS_CRON_TIME',
  'BULLMQ_SCAN_TRANSACTION_EMAIL_CRON_TIME',
  'BULLMQ_SEND_MAIL_CRON_TIME',
  'DOWNLOAD_IMAGES_MAX_CONCURRENT',
  'DOWNLOAD_IMAGES_MAX_RETRY',
  'UPLOAD_IMAGES_MAX_RETRY',
  'AWS_S3_API_VERSION',
  'AWS_S3_BUCKET_REGION',
  'AWS_S3_IMAGES_BUCKET_NAME',
  'R2_BUCKET',
  'R2_MAX_DOWNLOAD_MB',
  'R2_PREVIEW_MAX_DIM',
  'R2_PREVIEW_QUALITY',
  'R2_THUMB_DIM',
  'R2_THUMB_QUALITY',
  'DESIGN_MAX_UPLOAD_MB',
  'DESIGN_ORIGINAL_TTL_DAYS',
  'DESIGN_IA_DELETE_MONTHS',
  'DESIGN_QUEUE_CONCURRENCY',
  'PARTNER_API_TIMESTAMP_WINDOW',
  'PARTNER_API_NONCE_TTL',
  'PARTNER_API_RATE_LIMIT_PER_MIN',
  'PARTNER_API_RATE_LIMIT_PER_DAY',
  'AGENT_API_MAX_LIMIT',
  'AGENT_API_READ_TIMEOUT_MS',
  'AGENT_API_QUERY_TIMEOUT_MS',
  'AGENT_DOCS_DIR',
  'USER_ACTION_INDEX',
]);
/** Local infrastructure: kept only while the value points at this machine, neutralised otherwise. */
const KEEP_IF_LOCAL = new Set(['REDIS_HOST']);
const isLocal = (v) => /^(?:[a-z+]+:\/\/)?(?:[^@/\s]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?:[:/]|$)/i.test(v.trim());
const BLACK_HOLE = 'http://127.0.0.1:9';

/** KEY=value pairs of a dotenv file (`export` prefix, surrounding quotes and trailing comments, like dotenv). */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2].trim();
    const quoted = /^(['"`])([\s\S]*)\1$/.exec(raw);
    out.push([m[1], quoted ? quoted[2] : raw.replace(/\s+#.*$/, '')]);
  }
  return out;
}

// Safe by default: every key of the developer env files that is not allowlisted is blanked (URL-looking
// values → the black hole), so no external host or credential can reach the e2e API.
const env = { ...process.env };
const neutralised = new Set();
for (const file of ['.env', '.env.development']) {
  for (const [key, value] of readEnvFile(path.join(apiDir, file))) {
    if (KEEP.has(key) || KEEP_CONFIG.has(key)) continue;
    if (KEEP_IF_LOCAL.has(key) && isLocal(value)) continue;
    env[key] = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? BLACK_HOLE : '';
    neutralised.add(key);
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

// Count only — never the values.
console.log(`[e2e api] starting on :${port} with db=${db} (redis db ${env.REDIS_DB}); ${neutralised.size} env keys from apps/api/.env* neutralised`);
const child = spawn(process.execPath, ['./start.js'], { cwd: apiDir, env, stdio: 'inherit' });
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);
child.on('exit', (code) => process.exit(code ?? 0));
