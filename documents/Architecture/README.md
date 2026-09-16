# OnosFactory — System Architecture

Print-on-demand fulfillment platform. Sellers submit orders; the system routes them
through an 8-stage production pipeline and ships to end buyers.

Monorepo: pnpm workspaces + Turborepo.

---

## 1. Workspace layout

| Package | Stack | Scope |
|---|---|---|
| `apps/api` | NestJS + Fastify | Business logic. Port 3007, prefix `api/v1` |
| `apps/web` | React + Vite + Tailwind/Radix | Internal app (`/adm`, `/ffm`) |
| `apps/seller` | Next.js 16 | Customer-facing app. Port 3017 |
| `apps/design-worker` | Node + sharp | Image processing, deployed on a separate host |
| `packages/shared` | Zod | DTO / enum contract shared FE ↔ BE |
| `packages/core` | NestJS | Guards, decorators, abstract repository |

### Code placement

| Change type | Location |
|---|---|
| Business logic, persistence | `apps/api/src/modules/<feature>/` |
| Internal UI | `apps/web/src/pages/` |
| Customer UI | `apps/seller/src/app/` |
| Shared types | `packages/shared/dtos/` |
| Browser-runtime pure functions | `packages/shared/client/` — no NestJS imports |

Every `apps/api` module follows a fixed layout:

```
modules/<feature>/
  <feature>.module.ts        NestJS module
  <feature>.controller.ts    HTTP endpoints
  <feature>.service.ts       business logic
  <feature>.repository.ts    data access — services never touch models directly
  <feature>.entity.ts        Mongoose schema
```

`packages/shared` is the single source of type safety: Zod schemas are converted to
DTO classes via `createZodDto` for backend validation and Swagger, and the frontend
imports the same inferred types. A change there affects both applications — run
`pnpm build-types` across the repo, not per package.

### Routers and sessions (`apps/web`)

| Router | Session | Status |
|---|---|---|
| `/adm` | `authStore` (staff) | Active |
| `/ffm` | `authStore` (staff) | Active |
| `/customer` | `customerAuthStore`, `RoleType.Customer` | Legacy, feature-frozen, superseded by `apps/seller` |

Public routes (no auth): landing, catalog, order tracking, careers.

### Terminology

| Symbol | Meaning |
|---|---|
| `apps/seller` | Customer-facing application |
| `RoleType.Customer` | Customer account role |
| `RoleType.Seller` | **Internal staff role** — sales, unrelated to customers |

---

## 2. Order lifecycle

```
Order intake (portal form | CSV | Public Order API)
        │
        ▼
  customer_orders                staging collection
        │  pushToProduction() — price lock, productionId assignment
        ▼
     orders                      one document per item
        │
        ▼
  ┌───────────────────── 8-stage pipeline ──────────────────────┐
  │  tool-check → design →                                      │
  │  print → press → qc-post-press → sew-in → sew-out → pack    │
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  Shipping label → carrier
```

Stages 1–2 run on desktop; stages 3–8 are `FulfillmentStage` enum values executed by
factory workers, one worker per (factory, stage).

**Non-monotonic state.** Any stage can rework an order back to a previous stage or to
the designer. State machines must not assume forward-only transitions.

**Per-factory flow.** `FactoryEntity.flowType` selects the set of auto-completed
stages (`FACTORY_FLOW_AUTO_STAGES`):

| `flowType` | Auto-completed stages |
|---|---|
| `standard` | — |
| `merged` | `press`, `sew-out` |
| `no-sew` | `sew-in`, `sew-out` |

When a stage completes, consecutive auto stages complete with it and the order stops
at the next regular stage. Auto stages are never the current stage and need no
assigned worker. Transition logic must read `flowType`; the 6-stage chain must not be
hard-coded.

**Collection cardinality.** `customer_orders` holds `items[]`; `pushToProduction()`
emits one `orders` document per item. Code must not assume a 1:1 mapping.

**Audit trail.** Order mutations are written to `orderLogs`. `OrderService.updateField`
and `bulkUpdateField` are the central write path — order logging, auto-rework and
fulfillment entry hooks all attach there.

---

## 3. Data layer

| Store | Role | Constraint |
|---|---|---|
| MongoDB | Primary store | **Replica set required** — transactions are used in the wallet / payment ledger |
| Redis | Cache + BullMQ queues | Config blob cache, TTL 1h |
| RabbitMQ | Message broker | Both env vars mandatory at boot |

Core collections: `orders` (production orders), `customer_orders` (staging),
`orderLogs` (audit trail), `productConfigs` (products and variations), `customers`.

Entities extend a shared abstract base; references are stored as string ids with
`@Prop({ ref: 'Entity' })` and resolved through Mongoose virtuals.

`apps/design-worker` consumes a RabbitMQ queue on a separate host and writes to
MongoDB directly over Tailscale with a minimal schema.

A legacy platform holds pre-migration history and billing; part of the order flow is
still synced from it on a cron schedule.

---

## 4. AuthN / AuthZ

JWT, RS256. Two independent account spaces share the same token infrastructure:
staff (`users`) and customers (`customers`, role `RoleType.Customer`).

Every endpoint is annotated with a single decorator:

```ts
@Auth(roles, permissions, options)
```

It composes four guards in order — `AuthGuard` → `RateLimiterGuard` →
`PermissionsGuard` → `RolesGuard` — and attaches the authenticated user to the
request. `@Auth([], [], { public: true })` marks a public route.

Authorization has two layers: coarse `RoleType`, and fine-grained `PermissionType`
from a permission catalog shared between frontend and backend, so UI visibility and
API enforcement derive from one definition.

Two additional authentication schemes exist alongside JWT:

- **`X-Api-Key`** — public Order API for customer integrations, keys stored as
  sha256 hashes against the customer record.
- **`X-Agent-Api-Key`** — internal read-only data API for AI agents, separate from
  the permission catalog.

Responses follow `{ success, data, total?, message? }`. Exceptions are converted by
global filters; controllers do not catch.

---

## 5. Asynchronous processing

| Mechanism | Use |
|---|---|
| RabbitMQ | Cross-process work; consumers declared with `@RabbitSubscribe`. `apps/design-worker` consumes from a separate host with a dead-letter queue |
| BullMQ (Redis) | In-app job queues — image variants, summarisation, refresh jobs |
| `@Cron` | Scheduled reports, data sync, reconciliation |

`apps/api/src/main.ts` boots **two** application contexts in one process:
`bootstrap()` (HTTP/Fastify) and `bootstrapMicroservice()` (RabbitMQ). Consequence:
every `@Cron` handler is registered twice and fires twice. The first statement of
each handler must be the process guard:

```ts
if (!laTienTrinhChayCron(this.adapterHost)) return;
```

---

## 6. Cross-cutting constraints

**Order query filters.** Statistics queries on `orders` exclude three groups:
cancelled (`cancelledAt` set), unmapped factory (`factoryId` empty), and factories
outside the production pipeline (`apps/api/src/utils/excluded-factory.ts`). New
aggregations must apply the same filter set or they will disagree with the
dashboards.

**Timezone.** Day and month boundaries are Vietnam midnight (UTC+7). Aggregations use
`timezone: 'Asia/Ho_Chi_Minh'`; timestamps are built as `T00:00:00+07:00`.

**External identifier scope.** Third-party identifiers may be scoped to the requesting
account rather than global — the same entity can carry a different id per integration
account. Verify that two identifier spaces match against real data before joining on
them; a 0-row join is evidence of a scope mismatch, not of missing data.

**Config cache.** `SystemConfigService.get()` caches config blobs in Redis with a 1h
TTL. `set()` invalidates the key; direct writes to the `system_configs` collection do
not. Out-of-band writes must invalidate explicitly.

**i18n.** `apps/web` ships vi (default) and en. No hard-coded display strings,
including module-scope constants.

**Caching.** Read paths cache in Redis under `entity:${id}`; every update or delete
invalidates.

---

## 7. Environments

```bash
pnpm build          # required once — builds packages/shared + core
pnpm dev            # api + web
pnpm build-types    # repo-wide type-check
pnpm lint
cd apps/api && pnpm test
```

API dev `:3007` with prefix `api/v1`; web dev `:5173`. Local infrastructure runs on
Docker: MongoDB (replica set), Redis, RabbitMQ.

**Branching:** `feature → dev → main → production`. The dev host auto-pulls `dev`.
Production deploy is manual via `./deploy.sh`. No `master` branch.

**Production:** the API and seller apps run under pm2; the web app is served as a
static build.

---

## 8. Documentation model

Architecture documents live in `documents/Architecture/` (C4 model, auth, event-driven
design, infrastructure, known bug patterns). Each feature has a matching specification
in `documents/FunctionDescription/`.

Changing a feature requires updating its specification in the same pull request.
