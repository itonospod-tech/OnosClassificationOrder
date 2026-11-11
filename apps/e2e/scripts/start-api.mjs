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
 * The child does NOT inherit the shell environment: it gets a small allowlist of OS variables (`SHELL_ALLOW`:
 * PATH, temp dirs, home, Windows system dirs, NODE_OPTIONS, ...), then the neutralised .env keys, then the
 * explicit overrides below. A developer's exported DB_URI, API key or feature flag can therefore never leak in.
 *
 * Then, explicitly:
 *  - DB_URI → the throwaway database E2E_DB on the local replica set.
 *  - Every in-process schedule that is ON by default (or could be switched on by a kept key) is turned off,
 *    so a run that crosses 07:00 does not call the real Claude Agent SDK or any other service:
 *      CEO_REPORT_CRON_ENABLED=false (ceo-report.service.ts — defaults ON, 07:00 / 07:10 Mon / 07:20 on the 1st,
 *      runs the Agent SDK), SCHEDULED_REPORTS_ENABLED / TELEGRAM_NOTIFICATION_ENABLED=false (Telegram reports),
 *      ONOSPOD_FACTORY_SYNC_MODE / ONOSPOD_ORDER_RESYNC_MODE=off (default off already; pinned), the BullMQ
 *      repeatable jobs (BULLMQ_*_CRON_TIME='' → not added, and removed from the e2e Redis DB if present:
 *      tracking-status refresh, transaction-mail scan, send-mail). The Zalo summary sweep needs the engine
 *      URL/key (neutralised) and stays idle. Remaining in-process crons only touch the e2e database
 *      (customer-orders legacy sync every 5 min, customer-report 07:15 / 07:25 on the 1st — no flag, no external call).
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
  console.error('[e2e api] apps/api is not built. Run `pnpm --filter ./apps/api build:win` (Windows) or `pnpm --filter ./apps/api build` (Linux/macOS) first.');
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

/**
 * OS variables the child process needs to run Node and spawn helpers; matched case-insensitively (Windows
 * spells it `Path`). Everything else from the shell is dropped.
 */
const SHELL_ALLOW = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE', 'USERNAME', 'USER', 'LOGNAME', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NUMBER_OF_PROCESSORS',
]);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => SHELL_ALLOW.has(k.toUpperCase())));

// Safe by default: every key of the developer env files that is not allowlisted is blanked (URL-looking
// values → the black hole), so no external host or credential can reach the e2e API.
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
  // Schedules (see the header): nothing may fire on its own during a run.
  CEO_REPORT_CRON_ENABLED: 'false',
  ONOSPOD_FACTORY_SYNC_MODE: 'off',
  ONOSPOD_ORDER_RESYNC_MODE: 'off',
  BULLMQ_REFRESH_TRACKING_STATUS_CRON_TIME: '',
  BULLMQ_SCAN_TRANSACTION_EMAIL_CRON_TIME: '',
  BULLMQ_SEND_MAIL_CRON_TIME: '',
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
