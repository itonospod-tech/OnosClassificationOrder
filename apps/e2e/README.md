# apps/e2e — browser e2e suite (Playwright)

Tests the web app the way staff use it: log in, open menus, click, read what is on screen — then checks the
database / API state behind it. Covers the PR #77 release report (bugs 1–7 + UI notes) and the flows around
them.

## Isolation (what it never touches)

- **Own throwaway database** `onos-e2e-<UTC timestamp>` on the local replica set, dropped after the run
  (older leftovers > 3 h are dropped at the next start). Never `onos-classifycation`.
- **Own API** on `:3107` (the built `apps/api/dist-prod`, `node ./start.js`) and **own Vite** on `:5273`.
  The developer servers on `:3007` / `:5173` are left alone; the Vite dep cache is `apps/e2e/.vite-cache`.
- `scripts/start-api.mjs` sets, in the process environment (which wins over `apps/api/.env` and
  `apps/api/.env.development` — dotenv and Nest ConfigModule never overwrite a set variable):
  - **safe by default**: every key of those two files is neutralised (URL-looking value →
    `http://127.0.0.1:9`, anything else → empty) unless allowlisted in the script — `KEEP` (local-only
    secrets the API needs: JWT keys, master password, Redis password, ...), `KEEP_CONFIG` (plain numbers /
    flags / names), `KEEP_IF_LOCAL` (`REDIS_HOST`, only while it points at localhost). A new integration key
    stays cut off until someone allowlists it. The start line logs how many keys were neutralised (never values);
  - then `DB_URI`, `PORT`, CORS/`WEB_URL`, `REDIS_DB=13`, rate limiter off, RabbitMQ → dead address;
  - **every schedule off**: `CEO_REPORT_CRON_ENABLED=false` (defaults ON — 07:00 / 07:10 Mon / 07:20 on the
    1st, would call the real Claude Agent SDK), `SCHEDULED_REPORTS_ENABLED` / `TELEGRAM_NOTIFICATION_ENABLED=false`,
    `ONOSPOD_FACTORY_SYNC_MODE` / `ONOSPOD_ORDER_RESYNC_MODE=off`, the BullMQ repeatable jobs
    (`BULLMQ_*_CRON_TIME=''`). Crons left running touch only the e2e database (customer-orders legacy sync,
    customer report).
  - The child does **not** inherit the shell environment: only an allowlist of OS variables (`SHELL_ALLOW` —
    PATH, temp/home dirs, Windows system dirs, `NODE_OPTIONS`, …) + the values above. A variable exported in
    your shell (DB_URI, an API key, a feature flag) never reaches the e2e API.
  Global setup proves the override: the test accounts exist only in the e2e database and must be able to log in.
- No production host is ever called.

## Prerequisites

- Docker MongoDB replica set `rs0` (container `onosfactory-mongodb`) + Redis running (as for `pnpm dev`).
- Node 20: `export PATH="/c/Users/ADMIN/AppData/Local/nvm/v20.20.2:$PATH"` (Git Bash) — the system Node 24
  otherwise wins.
- Dependencies installed. On this machine the private Zalo packages are stubbed:
  `pnpm install --pnpmfile ../zalo-stubs/pnpmfile.cjs --no-frozen-lockfile`, then restore
  `pnpm-lock.yaml` (`git checkout pnpm-lock.yaml`) — the committed lockfile already has `@playwright/test`.
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is fine: by default the suite runs on the installed Google Chrome
  (`channel: 'chrome'`). No Chrome on the machine (CI, Linux)? Install Playwright's own Chromium once —
  `pnpm --filter e2e exec playwright install chromium` (= `npx playwright install chromium` in `apps/e2e`) —
  and run with `E2E_CHROME_CHANNEL=` (set but empty).
- API built: `pnpm --filter ./apps/api build:win` on Windows, `pnpm --filter ./apps/api build` on Linux/macOS (the
  suite runs `dist-prod`; rebuild after API changes).
- Ports 3107 and 5273 free.

## Run

```bash
pnpm e2e                                   # from the repo root: whole suite, ~5 min incl. server start
pnpm --filter e2e test -- tests/wallet.spec.ts      # one file
pnpm --filter e2e test -- -g "bug 2"                # by name
pnpm --filter e2e report                   # open the HTML report (traces/screenshots of failures)
```

In Git Bash prefix `MSYS_NO_PATHCONV=1` when passing paths like `/ffm/...` in env vars.

Environment switches:

| Variable | Effect |
| --- | --- |
| `E2E_CHROME_CHANNEL` | browser channel: unset = installed Google Chrome (default); empty (`E2E_CHROME_CHANNEL=`) = Playwright's bundled Chromium (`npx playwright install chromium`); any other value = that Playwright channel (`msedge`, `chrome-beta`, …) |
| `E2E_UI_NOTES=1` | also run the report's UI-note tests (header truncation, duplicate NOTE label, mixed language, mobile Shift tip) — font/machine dependent, so SKIPPED by default to keep the default suite deterministic |
| `E2E_STRICT_KNOWN=1` | run the expected-failure tests as normal tests, to read the exact failure |
| `E2E_KEEP_DB=1` | keep the e2e database after the run |
| `E2E_SERVER_LOGS=1` | pipe API / Vite logs to the console |
| `E2E_REUSE_SERVERS=1` + `E2E_DB=onos-e2e-…` | reuse already running e2e servers (fast iteration; start them with `node scripts/start-api.mjs` / `start-web.mjs` and the same `E2E_DB`) |

## Layout

- `playwright.config.ts` — 1 worker (pages show global counters; tests seed their own data and stay
  independent), projects `desktop` (1440×900) and `mobile` (Pixel 7, `mobile.spec.ts`), timezone
  Asia/Ho_Chi_Minh, English UI.
- `global-setup.ts` — test accounts (SuperAdmin ×2, Designer ×2; password in `support/env.ts`, test-only),
  factory `E2E` (created through `POST /factories`), product config `E2ETEE` with one variation.
- `support/` — `env` (ports, DB name, accounts), `db` (Mongo, only for seeding state without an API and for
  assertions), `api` (real HTTP), `seed` (orders / order-log rows / sellers in the app's own shapes),
  `ui` (login through the form), `known` (`knownBug()` = expected failure).
- `tests/` — `wallet`, `bulk-undo`, `tool-queue-return`, `permissions-price`, `release-ui`, `mobile`.

Actions under test go through the browser or the real API (incidents are real `PATCH /orders/bulk-field`
calls, so cascades and logs are genuine). Lost connections are simulated with `page.route`: the request
reaches the server (`route.fetch()`) and the browser gets `route.abort()`.

## Expected failures

Tests marked with `knownBug()` reproduce bugs that are known and not fixed in release 07/11 (bug 1, bug 6,
designer reading another designer's order history, UI notes). They count as passed while the bug is there;
when one is fixed, Playwright reports "expected to fail but passed" — then delete the `knownBug()` line.

`knownBug()` is called **right before the bug's own assertion**, never at the top of the test: anything that
fails before the call (setup, navigation, a neighbouring assertion) stays a real failure instead of being
swallowed as "expected to fail". Assertions that guard something else live in normal tests — e.g. "another
designer's order is not listed and its detail is 403/404" is a normal test; only "its history is 403 too"
is the known bug. `E2E_STRICT_KNOWN=1` shows the exact failure each one hits.

The Jest side uses the same switch: `it.failing` is wrapped as
`const itKnown = process.env.STRICT_KNOWN ? it : it.failing` (apps/api `price-visibility-logs.spec.ts`,
`wallet-request-key.spec.ts`, `test/price-visibility.e2e-spec.ts`); `STRICT_KNOWN=1 pnpm test` runs them as
normal tests.

The UI-note tests (`release-ui.spec.ts` "UI notes from the report", `mobile.spec.ts` Shift tip) depend on fonts,
screen and machine; they are skipped unless `E2E_UI_NOTES=1` (`uiNoteOnly()` in `support/known.ts`), and then run as
expected failures like the bugs.

UI notes not asserted (not robust enough): "QC AFTER PRI" and the truncated assignee names (depend on data
and column widths); the Vietnamese-UI truncation `NGƯỜI THỰC HI…` is covered only through the English header
check.
