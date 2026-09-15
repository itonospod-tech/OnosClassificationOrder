# OnosFactory — System Architecture

Print-on-demand fulfillment platform. Sellers (Etsy / TikTok Shop / Shopify) submit
orders; the system routes them through an 8-stage production pipeline and ships to
end buyers in the US.

Monorepo: pnpm workspaces + Turborepo. Entry point của thư mục `Architecture/`.
Updated 15/09/2026, metrics measured on production.

---

## 1. Workspace layout

| Package | Files | Stack | Scope |
|---|---:|---|---|
| `apps/api` | 410 | NestJS + Fastify | Business logic, port 3007, prefix `api/v1` |
| `apps/web` | 371 | React + Vite + Tailwind/Radix | Internal app (`/adm`, `/ffm`) |
| `apps/seller` | 133 | Next.js 16 | Customer-facing app, port 3017 |
| `apps/design-worker` | 6 | Node + sharp | Image processing, separate host |
| `packages/shared` | 139 | Zod | DTO / enum contract shared FE ↔ BE |
| `packages/core` | 44 | NestJS | Guards, decorators, abstract repository |

### Code placement

| Change type | Location |
|---|---|
| Business logic, persistence | `apps/api/src/modules/<feature>/` |
| Internal UI | `apps/web/src/pages/` |
| Customer UI | `apps/seller/src/app/` |
| Shared types | `packages/shared/dtos/` |
| Browser-runtime pure functions | `packages/shared/client/` — no NestJS imports |

`apps/api` modules (48) follow a fixed layout: `module / controller / service /
repository / entity`. Changes in `packages/shared` affect both apps — run
`pnpm build-types` across the repo.

### Routers and sessions (`apps/web`)

| Router | Session | Status |
|---|---|---|
| `/adm` | `authStore` (staff) | Active |
| `/ffm` | `authStore` (staff) | Active |
| `/customer` | `customerAuthStore`, `RoleType.Customer` | Legacy, feature-frozen, superseded by `apps/seller` |

Public routes (no auth): `/`, `/catalog`, `/track/:productionId`, careers.

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
to the designer.

**Per-factory flow.** `FactoryEntity.flowType` defines auto-completed stages
(`FACTORY_FLOW_AUTO_STAGES`):

| Factory | `flowType` | Auto-completed stages |
|---|---|---|
| TN | `standard` | — |
| TNW | `merged` | `press`, `sew-out` |
| ML, MLDTF | `no-sew` | `sew-in`, `sew-out` |
| US | unset | Excluded from pipeline (§5.1) |

Transition logic must read `flowType`; do not hard-code the 6-stage chain.

**Collection cardinality.** `customer_orders` holds `items[]`; `pushToProduction()`
emits one `orders` document per item. Current data: 57.610 staging / 57.610 items /
57.608 pushed / 57.608 production. The 1.00 ratio is a property of migrated data,
not a constraint.

Reference: [`Orders.md`](../FunctionDescription/Orders.md),
[`FulfillmentWorkflow.md`](../FunctionDescription/FulfillmentWorkflow.md),
[`CustomerOrderIntake.md`](../FunctionDescription/CustomerOrderIntake.md).

---

## 4. Data layer

| Store | Role | Constraint |
|---|---|---|
| MongoDB | Primary store, 42 collections | **Replica set required** — transactions in wallet / payment ledger |
| Redis | Cache + BullMQ queues | Config blob cache TTL 1h |
| RabbitMQ | Message broker | Both env vars mandatory at boot |

| Collection | Documents | Content |
|---|---:|---|
| `orderLogs` | 3.259.313 | Order mutation audit trail |
| `agentApiLogs` | 419.308 | Agent API audit, TTL 90d |
| `customer_orders` | 57.610 | Staging orders |
| `orders` | 57.608 | Production orders |
| `productConfigs` | 196 | Product config + variations |
| `customers` | 168 | Customer accounts |

`apps/design-worker` writes to MongoDB directly over Tailscale with a minimal schema.

Legacy system OnosPod (`app.onospod.com`) holds pre-06/2026 data and billing;
partial order sync via cron `orders/import-from-onospod/cron`.
Reference: [`OnosPodLegacy-BusinessFlows.md`](OnosPodLegacy-BusinessFlows.md).

---

## 5. Cross-cutting constraints

### 5.1 Order query filters

Statistics queries on `orders` exclude:

- cancelled — `cancelledAt` set
- unmapped factory — `factoryId` empty
- US factory — `apps/api/src/utils/excluded-factory.ts`

Reference: [`Orders.md`](../FunctionDescription/Orders.md) §19, §21.

### 5.2 Timezone

Day / month boundaries are Vietnam midnight (UTC+7). Aggregations use
`timezone: 'Asia/Ho_Chi_Minh'`; timestamps built as `T00:00:00+07:00`.

### 5.3 Dual Nest context

`apps/api/src/main.ts` boots two contexts in one process: `bootstrap()` (HTTP) and
`bootstrapMicroservice()` (RabbitMQ). Every `@Cron` handler registers twice. First
statement of each handler:

```ts
if (!laTienTrinhChayCron(this.adapterHost)) return;
```

Reference: [`Common_Pitfalls.md`](Common_Pitfalls.md) §11.

### 5.4 External identifier scope

Third-party identifiers may be scoped to the requesting account rather than global:
the same entity can carry a different id per integration account. Verify two
identifier spaces match against production data before comparing; a 0-row join is
evidence of a scope mismatch.

Reference: [`Common_Pitfalls.md`](Common_Pitfalls.md) §12.

### 5.5 Config cache

`SystemConfigService.get()` caches config blobs in Redis, TTL 1h. `set()` invalidates;
direct writes to `system_configs` do not. Invalidate the key after out-of-band writes.

### 5.6 i18n

`apps/web` ships vi (default) + en. No hard-coded display strings, including
module-scope constants. Reference: [`I18n.md`](../FunctionDescription/I18n.md).

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
RabbitMQ): [`README.md`](../../README.md).

**Branching:** `feature → dev → main → production`. Dev host auto-pulls `dev` every
minute. Production deploy is manual via `./deploy.sh`. No `master` branch.

**Production:** pm2 processes `onosfactory-api`, `onosfactory-seller`.
Reference: [`Infrastructure.md`](Infrastructure.md).

---

## 7. Documentation index

| Topic | Document |
|---|---|
| Context / container / component diagrams | [`C4_Model.md`](C4_Model.md) |
| AuthN, AuthZ, `@Auth()` decorator | [`Auth_System.md`](Auth_System.md) |
| RabbitMQ, BullMQ, cron | [`Event_Driven.md`](Event_Driven.md) |
| Deployment, pm2, nginx, Docker | [`Infrastructure.md`](Infrastructure.md) |
| Known bug patterns + root causes | [`Common_Pitfalls.md`](Common_Pitfalls.md) |
| Legacy OnosPod flows | [`OnosPodLegacy-BusinessFlows.md`](OnosPodLegacy-BusinessFlows.md) |
| Production data verification | [`CheckProductionData.md`](CheckProductionData.md) |
| Shipping label patterns | [`ShippingLabelPatterns.md`](ShippingLabelPatterns.md) |
| Per-feature specs (40 docs) | [`documents/FunctionDescription/`](../FunctionDescription/) |

Feature changes require updating the matching `FunctionDescription` document in the
same pull request. Lookup table: [`CLAUDE.md`](../../CLAUDE.md).
