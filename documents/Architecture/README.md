# OnosFactory — System Architecture

Print-on-demand fulfillment platform. Sellers submit orders; the system routes them
through an 8-stage production pipeline and ships to end buyers.

Monorepo: pnpm workspaces + Turborepo.

Inline paths such as `documents/FunctionDescription/Orders.md` are repository paths,
given for readers with source access.

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

Every `apps/api` module follows a fixed layout: `module / controller / service /
repository / entity`. Conventions: `apps/api/CLAUDE.md`.

Changes in `packages/shared` affect both applications — run `pnpm build-types`
across the repo, not per package.

### Routers and sessions (`apps/web`)

| Router | Session | Status |
|---|---|---|
| `/adm` | `authStore` (staff) | Active |
| `/ffm` | `authStore` (staff) | Active |
| `/customer` | `customerAuthStore`, `RoleType.Customer` | Legacy, feature-frozen, superseded by `apps/seller` |

Public routes (no auth): landing, catalog, order tracking, careers.

---

## 2. Terminology

| Symbol | Meaning |
|---|---|
| `apps/seller` | Customer-facing application |
| `RoleType.Customer` | Customer account role |
| `RoleType.Seller` | **Internal staff role** — sales, unrelated to customers |

---

## 3. Order lifecycle

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

Stages 3–8 are `FulfillmentStage` enum values, executed by factory workers.

**Non-monotonic state.** Any stage can rework an order back to a previous stage or
to the designer. State machines must not assume forward-only transitions.

**Per-factory flow.** `FactoryEntity.flowType` selects the set of auto-completed
stages (`FACTORY_FLOW_AUTO_STAGES`):

| `flowType` | Auto-completed stages |
|---|---|
| `standard` | — |
| `merged` | `press`, `sew-out` |
| `no-sew` | `sew-in`, `sew-out` |

When a stage completes, consecutive auto stages complete with it and the order stops
at the next regular stage. Transition logic must read `flowType`; the 6-stage chain
must not be hard-coded.

**Collection cardinality.** `customer_orders` holds `items[]`; `pushToProduction()`
emits one `orders` document per item. Code must not assume a 1:1 mapping.

Specs: `documents/FunctionDescription/Orders.md`,
`documents/FunctionDescription/FulfillmentWorkflow.md`,
`documents/FunctionDescription/CustomerOrderIntake.md`.

---

## 4. Data layer

| Store | Role | Constraint |
|---|---|---|
| MongoDB | Primary store | **Replica set required** — transactions in wallet / payment ledger |
| Redis | Cache + BullMQ queues | Config blob cache, TTL 1h |
| RabbitMQ | Message broker | Both env vars mandatory at boot |

Core collections: `orders` (production orders), `customer_orders` (staging),
`orderLogs` (order mutation audit trail), `productConfigs`, `customers`.

`apps/design-worker` writes to MongoDB directly over Tailscale with a minimal schema.

A legacy system holds pre-migration history and billing; part of the order flow is
synced from it via cron. Reference:
`documents/Architecture/OnosPodLegacy-BusinessFlows.md`.

---

## 5. Cross-cutting constraints

### 5.1 Order query filters

Statistics queries on `orders` exclude three groups:

- cancelled — `cancelledAt` set
- unmapped factory — `factoryId` empty
- factories outside the production pipeline — `apps/api/src/utils/excluded-factory.ts`

Reference: `documents/FunctionDescription/Orders.md` §19, §21.

### 5.2 Timezone

Day and month boundaries are Vietnam midnight (UTC+7). Aggregations use
`timezone: 'Asia/Ho_Chi_Minh'`; timestamps are built as `T00:00:00+07:00`.

### 5.3 Dual Nest context

`apps/api/src/main.ts` boots two application contexts in one process: `bootstrap()`
(HTTP) and `bootstrapMicroservice()` (RabbitMQ). Every `@Cron` handler is registered
twice. First statement of each handler:

```ts
if (!laTienTrinhChayCron(this.adapterHost)) return;
```

Reference: `documents/Architecture/Common_Pitfalls.md` §11.

### 5.4 External identifier scope

Third-party identifiers may be scoped to the requesting account rather than global:
the same entity can carry a different id per integration account. Verify that two
identifier spaces match against real data before joining on them; a 0-row join is
evidence of a scope mismatch.

Reference: `documents/Architecture/Common_Pitfalls.md` §12.

### 5.5 Config cache

`SystemConfigService.get()` caches config blobs in Redis with a 1h TTL. `set()`
invalidates the key; direct writes to the `system_configs` collection do not.
Out-of-band writes must invalidate explicitly.

### 5.6 i18n

`apps/web` ships vi (default) and en. No hard-coded display strings, including
module-scope constants. Reference: `documents/FunctionDescription/I18n.md`.

---

## 6. Environments

```bash
pnpm build          # required once — builds packages/shared + core
pnpm dev            # api + web
pnpm build-types    # repo-wide type-check
pnpm lint
cd apps/api && pnpm test
```

API dev `:3007`, web dev `:5173`. Docker stack (MongoDB replica set, Redis,
RabbitMQ): `README.md` (repo root).

**Branching:** `feature → dev → main → production`. The dev host auto-pulls `dev`.
Production deploy is manual via `./deploy.sh`. No `master` branch.

**Production:** API and seller apps run under pm2. Reference:
`documents/Architecture/Infrastructure.md`.

---

## 7. Documentation index

| Topic | Document |
|---|---|
| Context / container / component diagrams | `documents/Architecture/C4_Model.md` |
| AuthN, AuthZ, `@Auth()` decorator | `documents/Architecture/Auth_System.md` |
| RabbitMQ, BullMQ, cron | `documents/Architecture/Event_Driven.md` |
| Deployment, pm2, nginx, Docker | `documents/Architecture/Infrastructure.md` |
| Known bug patterns + root causes | `documents/Architecture/Common_Pitfalls.md` |
| Legacy system flows | `documents/Architecture/OnosPodLegacy-BusinessFlows.md` |
| Shipping label patterns | `documents/Architecture/ShippingLabelPatterns.md` |
| Per-feature specs | `documents/FunctionDescription/` |

Feature changes require updating the matching `FunctionDescription` document in the
same pull request. Lookup table: `CLAUDE.md` (repo root).
