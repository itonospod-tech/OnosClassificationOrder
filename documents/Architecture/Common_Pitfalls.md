# Common Pitfalls — Cross-Cutting Gotchas

> Tổng hợp các bug pattern đã từng xảy ra ở dự án — đọc trước khi extend code core (User, Auth, Order entity, Shared DTOs). Mỗi entry: **Triệu chứng → Root cause → Fix → Rule chung**.

---

## 1. ⚠️ User field silently undefined ở BE service / FE profile

### Triệu chứng

- Endpoint mới reject với "Thiếu X (user chưa gán X)" **dù admin đã gán đúng trong DB**.
- Hoặc UI page báo "Tài khoản chưa được cấu hình X" dù field đã set.
- `console.log(user)` trên BE service hoặc `console.log(authStore.profile)` trên FE → field thiếu.

### Root cause

`UserService` có **2 aggregation pipeline độc lập** strip field bằng `$project`:

| Method | Audience | Consumer |
|---|---|---|
| `getUserById(id)` (`apps/api/src/modules/user/user.service.ts:41`) | BE | JwtStrategy → `@AuthUser()` decorator |
| `getMe(id, user)` (`apps/api/src/modules/user/user.service.ts:123`) | FE | `GET /v1/auth/me` → `authStore.profile` |

Cả 2 đều có `$project` **whitelist** — field nào KHÔNG có trong list sẽ **silently** `undefined` trên user object. Mongoose không warn, TypeScript không catch (lean → `any`/`UserDocument` cast).

### Fix

Add field vào **cả 2** `$project`:

```ts
// getUserById
$project: { _id: 1, status: 1, email: 1, ..., fulfillmentStage: 1, ... }

// getMe
$project: { _id: 1, email: 1, name: 1, ..., fulfillmentStage: 1, ... }
```

### Rule chung

Khi thêm field mới trên `UserEntity` mà downstream cần access:

| Use case | Project vào |
|---|---|
| BE service / controller dùng `user.X` qua `@AuthUser()` | `getUserById` |
| FE display / authStore lookup | `getMe` |
| Cả 2 (vd: `fulfillmentStage`) | Cả 2 |
| Chỉ DB schema (private, không có business logic) | Không cần (vẫn lưu DB) |

**Khi không chắc:** add vào cả 2 — overhead negligible, false-negative bug rất tốn thời gian debug.

### Precedent đã xảy ra

- `fulfillmentStage` (2026-06): Forgot ở `getUserById` → `/v1/fulfillment/my-tasks` báo "Thiếu stage" toàn dự án. Fix: `user.service.ts:96` + `:170`. Xem `FunctionDescription/FulfillmentWorkflow.md §5.6`.

---

## 2. ⚠️ Shared package factory const với `new Date()` bị freeze ở module load

### Triệu chứng

Field timestamp ở record mới luôn = server start time, không phải thời điểm tạo. Test development không phát hiện (vì restart server thường xuyên), prod log mới rõ.

### Root cause

```ts
// SAI — `new Date()` evaluate 1 lần ở module load.
const ENTRY_PATCH = {
  createdAt: new Date(),
  ...
} as const;
```

`as const` không "lazy" — value tính ngay khi module require/import. Mọi caller dùng `Object.assign(patch, ENTRY_PATCH)` về sau đều ghi cùng timestamp.

### Fix

Convert thành factory function — evaluate mỗi call:

```ts
function buildEntryPatch(): Record<string, unknown> {
  return {
    createdAt: new Date(),
    ...
  };
}
```

### Rule chung

- **Const literal patch object** chỉ được chứa giá trị tĩnh (string/enum/0).
- Bất kỳ field nào cần evaluate runtime (`new Date()`, `randomUUID()`, `+new Date()` shortcut) phải nằm trong factory function.

### Precedent đã xảy ra

- `FULFILLMENT_ENTRY_SET` (2026-06): Const `waitingAt: new Date()` → mọi đơn vào fulfillment đều có `waitingAt = server boot time`. Fix: refactor thành `buildFulfillmentEntrySet()`. Xem `FunctionDescription/FulfillmentWorkflow.md §5.4`.

---

## 3. ⚠️ Enum extension không migrate đơn cũ → "ghost data" mất visibility

### Triệu chứng

Sau khi enum (vd `FulfillmentStage`) thay đổi (5 → 7 stage, hoặc 4 → 5 tab), đơn cũ với enum value cũ vẫn nằm trong DB nhưng **không match filter nào** ở FE → biến mất khỏi UI.

### Root cause

- BE filter `currentFulfillmentStage: { $in: NEW_VALUES }` — không bao gồm `'qc'`, `'sew'` cũ.
- Frontend `FULFILLMENT_STAGE_LABELS[stage]` lookup → undefined.

### Fix options

| Option | Khi nào dùng |
|---|---|
| **Migration script onModuleInit** — rewrite `'qc'` → `'qc-post-press'` etc. | Khi có business value cần giữ đơn cũ. |
| **Chấp nhận data loss** — đơn cũ ghost, admin xoá hoặc bỏ qua | Khi đơn cũ "chưa chuẩn" (theo confirm từ stakeholder). |
| **Backward-compat fallback** — code đọc cả enum cũ + mới | KHÔNG khuyên — bloat code lâu dài. |

### Rule chung

Khi refactor enum trên field index trong production:

1. Xác định **rõ ràng** với stakeholder: migrate hay drop?
2. Nếu drop: doc rõ ràng "data cũ mất visibility, áp dụng cho đơn mới from {date}".
3. Tránh option 3 — kỹ thuật nợ tích lũy.

### Precedent đã xảy ra

- `FulfillmentStage` (2026-06): 5 → 7 stage refactor. Stakeholder confirm "data cũ chưa chuẩn, không cần migrate". Xem `FunctionDescription/FulfillmentWorkflow.md §1` refactor history.

---

## 4. ⚠️ Mongoose Zod `as const` patch không type-check `$inc` field

### Triệu chứng

`$inc: { someCounter: 1 }` được set nhưng counter không tăng — silently fail vì Mongoose schema không có `someCounter` declare.

### Rule chung

Field nào dùng `$inc` PHẢI có `@Prop({ type: Number, default: 0 })` declare trong Mongoose schema.

---

## 5. ⚠️ Shared package build không tự động — TypeScript/runtime mismatch

### Triệu chứng

Sửa enum / DTO trong `packages/shared/` → BE / FE không thấy giá trị mới dù typecheck pass.

### Root cause

Shared package compile sang `dist/index.js` + `dist/index.cjs`. BE/FE import từ `'shared'` resolve về `dist/` (theo package.json `exports`). Khi sửa source, **phải rebuild**.

### Fix

```bash
cd packages/shared && pnpm build
```

Hoặc `pnpm dev` chạy watch mode trong shared package.

### Rule chung

- Sau khi sửa `packages/shared/`, **luôn** rebuild trước khi test BE/FE.
- CI/deploy script tự rebuild — local dev cần manual.

---

## 6. ⚠️ "Code đúng nhưng server chạy code cũ" — query param bị Zod strip âm thầm + deploy/PM2 không reload sạch

> Mở rộng #5 sang phần **runtime/deploy**. #5 nói "rebuild dist"; pitfall này về việc **dù dist mới, PROCESS đang chạy vẫn dùng code cũ** và hệ quả **silent** (không có lỗi, param/field biến mất). Tốn nhiều giờ debug trong phiên 2026-06.

### Triệu chứng

- Thêm query param mới (vd. `userSku`, `toolResultNote`) vào FE + BE + shared, typecheck pass, **local chạy mượt**, nhưng **trên server filter không áp dụng** / facet mới không trả về / field response (vd. `inProductionAt`, `toolResultNote`) bị thiếu — **không có error nào**.
- Hoặc: server **lúc trả field mới lúc không** (intermittent).

### Root cause (3 lớp, hay cộng hưởng)

1. **Global `ZodValidationPipe` (`apps/api/src/main-nest.ts`) strip key lạ.** Pipe gọi `zodSchema.safeParse(query)` rồi `return parseResult.data`. Zod `z.object({...})` **mặc định xóa mọi key không khai báo**. Nếu process đang chạy nắm `GetXxxZod` từ **dist cũ** (chưa có param mới) → param bị **cắt khỏi query trước khi vào controller** → service không bao giờ nhận. **Silent, không lỗi.** (Tương tự: `toCard`/mapper build object field-by-field → field mới chỉ xuất hiện nếu dòng map đó có trong code đang chạy.)
2. **Process Node cache module trong RAM.** Build lại `dist` trên đĩa **vô tác dụng** cho tới khi **restart process**. Rebuild ≠ reload.
3. **PM2 cluster `reload` để lại orphan worker.** `pm2 reload` (rolling, cluster mode) có thể spawn worker mới nhưng worker cũ không chết hẳn (graceful shutdown kẹt) → 2 process cùng phục vụ qua listening socket kế thừa → **request rơi ngẫu nhiên vào worker cũ/mới** → "lúc có lúc không". Dấu hiệu: `ps aux | grep start.js` ra **>1 dòng**, `restarts` count cao bất thường.

### Fix

- **Quy trình deploy đúng:** `git pull/reset` → `pnpm --filter shared build` → `pnpm build:api` → **RESTART** (không chỉ rebuild). Verify: `git log -1`, `pm2 list` (uptime ~0), `ps aux | grep start.js` (chỉ 1 dòng).
- **`deploy.sh` ordering:** reload/restart API **NGAY sau `build:api`, TRƯỚC `build:web`**. Vì `set -e` + `build:web` dễ OOM trên server RAM thấp → nếu web build fail thì script abort **trước** bước reload → API chạy code cũ dù `dist-prod` đã mới. (Đã sửa: dùng `pm2 restart` thay `reload` để kill sạch worker cũ, tránh orphan.)
- **Orphan PM2:** `kill <pid_cũ>` thủ công, rồi `pm2 delete <app> && pm2 start ecosystem.config.cjs` để chỉ còn 1 bản. Thêm `kill_timeout` vào ecosystem để worker cũ bị SIGKILL khi reload.

### Cách phân biệt nhanh (FE vs BE vs deploy)

- DevTools → Network: request có chứa param mới (vd. `userSku=`) không? **Có** mà kết quả không đổi ⇒ BE strip ⇒ server chạy code cũ ⇒ restart.
- Gọi endpoint facet (vd. `/my-task-filters`): response **thiếu hẳn key mới** (vd. không có `userSku`) ⇒ service cũ ⇒ chưa deploy. (Response không bị ZodValidationPipe đụng — pipe chỉ validate **input**; key thiếu = do code service.)

### Liên quan timezone (red herring đã gặp)

Khác biệt local/server **không phải lúc nào cũng do timezone.** Phiên 2026-06: nghi server UTC gây lệch ngày, nhưng `timedatectl` cho thấy VPS cũng `+07` → loại. Nguyên nhân thật là code cũ. **Tuy vậy rule vẫn đúng:** filter theo ngày phải hardcode `+07:00` (`new Date(\`${d}T00:00:00+07:00\`)`), KHÔNG dùng `setHours()` (giờ local server) — để đúng bất kể TZ server.

### Rule chung

- Sửa `packages/shared` hoặc BE service → **rebuild + RESTART process**, không chỉ rebuild.
- Param/field mới "biến mất" mà không có lỗi → nghi ngay **Zod strip do dist cũ** hoặc **process chưa restart**, không phải bug logic.
- Bug "lúc được lúc không" trên server → nghi **nhiều instance/orphan process** chạy lẫn code cũ + mới.

### Precedent đã xảy ra

- 2026-06: `userSku` + `toolResultNote` filter + `inProductionAt` ở `/designer/my-tasks` — local đúng, server sai/thiếu. Root cause: server chạy bản `designer-task.service.ts` cũ + orphan PM2 worker (`pid` từ hôm trước) + `deploy.sh` reload sau web-build-OOM. Fix: kill orphan + đổi `reload`→`restart` + reorder deploy.

---

## §6. `packages/shared` — circular barrel import → bundle phình 74× → `Maximum call stack size exceeded` khi load

### Triệu chứng
- API crash lúc **khởi động** (require-time), stack trace trỏ vào `zod/lib/helpers/util.js` / `zod/lib/locales/en.js` (red herring — zod chỉ là "giọt nước tràn ly"): `RangeError: Maximum call stack size exceeded`.
- Load được khi `node --stack-size=2000` (>default ~984) → **hữu hạn nhưng quá sâu**, KHÔNG phải đệ quy vô hạn (schema tự tham chiếu).

### Root cause (2 tầng)
- Leaf files trong `packages/shared` (`dtos/*.dto.ts`, `constants/*.ts`, `utils/*.ts`...) import primitives (`IDZod`, `Status`, `BaseEntityZod`...) từ **`'..'` = thư mục gói** → Node/esbuild resolve qua `package.json` (`module: dist/index.js`) → **tsup NUỐT NGUYÊN `dist/index.js` CŨ vào bundle mới** (marker `// dist/index.js` trong `dist/index.cjs`).
- **Snowball mỗi lần build:** build N chứa dist của build N-1 bên trong → mỗi symbol có suffix tăng dần (`ALL_PERMISSION_CODES`, `...2`, ... `...24` = 24 lớp) — vì `prebuild: rimraf dist` **KHÔNG chạy** (pnpm mặc định bỏ qua pre/post scripts). Bundle phồng dần (8–21MB tuỳ số lớp). Eval N lớp lồng nhau lúc require → tràn stack.
- Nếu dist SẠCH lúc build, `'..'` fallback về `index.ts` → **cycle-qua-entry thật** → esbuild sắp thứ tự eval sai → `TypeError: Cannot read properties of undefined (reading 'extend')` (`BaseEntityZod` chưa init). Tức là kiểu import `'..'` sai ở CẢ 2 nhánh — chỉ "chạy được" nhờ ăn dist cũ.
- **Tích lũy âm thầm:** vượt ngưỡng stack lúc nào không biết → **chỉ lộ khi rebuild/deploy** (dist gitignore, mỗi máy build riêng; máy Node mới stack lớn hơn vẫn chạy được trong khi server Node cũ crash).

### Fix (đã áp 2026-07, branch fix/factory-by-customer)
- Đổi **mọi** leaf import `from '..'` → **import trực tiếp module nguồn** (`from '../constants/common-zod'`, `from './common-length'`, `from '../utils/getObjectValues'`...) — codemod 40 files. Không còn cycle-qua-entry, không còn resolve vào dist. Bundle: **8.13MB → 526KB**, `ALL_PERMISSION_CODES` 24→**1**, load OK cả với `--stack-size=200` (1448 exports, không mất export nào).
- `packages/shared/package.json` build script thêm **`--clean`**: `tsup index.ts --format cjs,esm --clean` — tsup tự xoá dist trước mỗi build (không phụ thuộc `prebuild` vốn bị pnpm bỏ qua) → hết đường snowball tái phát.

### Rule chung
- **TUYỆT ĐỐI KHÔNG** `import ... from '..'` (entry/thư mục gói) bên trong `packages/shared`. Import **file module cụ thể** (hoặc sub-barrel `@shared/enums`/`@shared/types` — alias tsconfig trỏ source, an toàn).
- Sau khi thêm file/DTO vào `shared`: `grep -rn "from '\.\.'" packages/shared --include=*.ts | grep -v dist` phải **= 0**.
- Sanity sau `pnpm --filter shared build`: `grep -c "^// dist/index" packages/shared/dist/index.cjs` phải **= 0** và `grep -c "var ALL_PERMISSION_CODES" ...` phải **= 1** (>1 = tái phát) + `node --stack-size=200 -e "require('./packages/shared/dist/index.cjs')"` không tràn stack; size dist/index.cjs ~500KB (thấy MB là có chuyện).

---

## 7. ⚠️ CORS whitelist cứng 1 cổng → dev server nhảy cổng là "Network Error" mù mịt

### Triệu chứng

Trang FE gọi API và chỉ báo `Network Error` (axios), không status code, không log
lỗi ở BE. `curl` cùng URL lại trả 200 bình thường → dễ tưởng BE hỏng hoặc endpoint
chưa nạp, trong khi thật ra request bị **trình duyệt** chặn trước khi tới server.

### Root cause

`apps/api/src/main-nest.ts` whitelist CORS đúng `http://localhost:5173`. Nhưng
`apps/web` chạy `vite --host`, nên:

- 5173 bị chiếm (đã mở sẵn 1 dev server khác) → Vite tự nhảy 5174, 5175…
- mở trang qua IP LAN để test trên điện thoại → origin là `http://192.168.x.x:5173`.

Cả 2 trường hợp đều không khớp whitelist → không có header
`access-control-allow-origin` → trình duyệt chặn. `curl` không gửi `Origin` nên
không dính CORS, vì vậy **`curl` 200 KHÔNG chứng minh FE gọi được**.

### Fix

`origin` nhận **hàm** thay vì mảng cố định: giữ nguyên whitelist, và CHỈ khi
`NODE_ENV !== 'production'` thì chấp nhận thêm origin máy dev
(`localhost`/`127.0.0.1`/`::1`/IP LAN riêng tư, cổng bất kỳ) qua `isLocalDevOrigin()`.
Từ chối bằng `callback(null, false)` — ném `Error` sẽ thành lỗi 500 thay vì để
trình duyệt chặn như bình thường.

### Rule chung

- Chẩn đoán `Network Error` thì **so sánh curl CÓ và KHÔNG có header `Origin`**.
  Khác nhau ⇒ CORS, không phải lỗi server.
- Whitelist CORS không bao giờ nên cứng đúng 1 cổng localhost khi dev script dùng
  `--host` hoặc cổng có thể tự nhảy.
- Nới lỏng cho dev phải gate bằng `NODE_ENV !== 'production'`, đừng nới ở production.

### Precedent đã xảy ra

2026-08: trang `/catalog` public báo `Network Error` suốt dù API trả 200 qua curl
— Vite phải chạy ở `:5175` vì 5173/5174 đã bị chiếm. Trang chủ `/` không lộ lỗi
này vì nó là trang tĩnh, không gọi API nào.

---

## 8. ⚠️ EventEmitter hạ tầng không có listener `'error'` → 1 lần mất kết nối là chết cả process

### Triệu chứng

API dev đang chạy bình thường thì tự chết, nodemon in `[nodemon] app crashed`,
log kết thúc bằng:

```
node:events:502
      throw er; // Unhandled 'error' event
Error: read ECONNRESET
Emitted 'error' event on Commander instance at:
    at RedisSocket.<anonymous> (.../@redis/client/dist/lib/client/index.js:412:14)
```

Hay xảy ra sau vài phút **không ai gọi API** — càng để yên càng dễ chết, khởi
động lại thì lại chạy được một lúc, nên rất dễ bị đổ oan cho RabbitMQ/Mongo đang
báo lỗi kết nối cùng lúc trong log.

### Root cause

Hai lớp cộng lại:

1. **Redis chủ động đóng connection rỗi.** `redis.conf` có `timeout 300` (mặc
   định nhiều bản cài sẵn) ⇒ client không chạy lệnh nào trong 300s là bị Redis
   đóng. Trên Windows cú đóng đó tới Node dưới dạng `read ECONNRESET`.
   `tcp-keepalive` KHÔNG cứu được: Redis đếm `timeout` theo **lần chạy lệnh cuối**,
   không theo gói keep-alive tầng TCP.
2. **Không ai nghe `'error'`.** `redisStore()` của `cache-manager-redis-yet` chỉ
   gọi `createClient()` rồi `connect()`, không gắn listener nào. Node quy định
   EventEmitter phát `'error'` mà không có listener thì **ném thẳng thành uncaught
   exception** → chết process. Nghĩa là mọi cú mất kết nối Redis thoáng qua
   (restart Redis, mạng chớp, failover) đều đủ giết API, kể cả trên production.

Đây KHÔNG phải lỗi riêng của Redis: mọi client hạ tầng dựa trên EventEmitter
(`redis`, `ioredis`, `amqplib`, driver socket…) đều có bẫy này.

### Fix

`apps/api/src/app.module.ts` — tự tạo store rồi gắn handler, thay vì đưa thẳng
`store: redisStore` cho Nest:

```ts
useFactory: async (configService: ApiConfigService) => {
  const logger = new Logger('RedisCache');
  const store = await redisStore({
    /* ... */
    socket: { host, port, reconnectStrategy: (retries) => Math.min(1000 + retries * 500, 10_000) },
    pingInterval: 60_000, // giữ connection không bao giờ "rỗi" dưới mắt Redis
  });
  store.client.on('error', (error) => logger.error(`Redis client error: ${error.message}`));
  return { store };
};
```

`pingInterval` chặn nguyên nhân (không bị đóng nữa), `.on('error')` chặn hậu quả
(có bị đóng cũng chỉ log + tự reconnect). Phải có **cả hai** — sửa `redis.conf`
thành `timeout 0` chỉ chữa được máy đang ngồi, không chữa được server khác.

### Rule chung

- Bất kỳ client hạ tầng nào lấy ra từ thư viện (`store.client`, connection,
  channel…) đều **phải** được gắn `.on('error')` ngay tại chỗ khởi tạo. Thư
  viện bọc ngoài thường KHÔNG gắn hộ.
- Crash `Unhandled 'error' event` thì đọc dòng `Emitted 'error' event on <X>` để
  biết đúng emitter nào thiếu listener — đó mới là chỗ cần sửa, không phải chỗ
  in ECONNRESET.
- Lỗi kết nối in ra log liên tục (RabbitMQ ECONNREFUSED chẳng hạn) mà process vẫn
  sống thì **không phải** thủ phạm: nó có handler nên mới in được. Thủ phạm là cái
  làm process chết ngay lần đầu.

### Precedent đã xảy ra

2026-08-20: API dev trên máy Windows crash lặp đi lặp lại. Log đầy
`AmqpConnection Failed to connect to RabbitMQ` nên ban đầu tưởng do RabbitMQ chưa
bật, nhưng RabbitMQ chỉ retry chứ không giết process — thủ phạm là client Redis
của `CACHE_MANAGER` bị Redis đóng vì `timeout 300` trong `D:\dev\redis\redis.conf`.

## 9. ⚠️ Hai bản `@types/react` trong monorepo → pnpm hoist bản CAO NHẤT → app React 18 type-check vỡ

**Triệu chứng (07/09/2026, khi thêm `apps/seller` Next 16/React 19):** `pnpm build-types` ở `apps/web` (React 18) đột nhiên báo `'Outlet' cannot be used as a JSX component` / `'Routes' … not a valid JSX element type` ở mọi chỗ dùng react-router, dù `apps/web` không đổi dòng nào.

**Root cause:** `react-router` (và mọi package khai `react` là peer) không có `@types/react` riêng trong `.pnpm/<pkg>/node_modules` → TS đi lên `node_modules/.pnpm/node_modules/@types/react` (thư mục hoist ẩn của pnpm, `hoist-pattern=*` mặc định). Có 2 phiên bản trong workspace thì pnpm đặt **bản cao nhất** (19) vào đó → d.ts của react-router được đọc bằng React 19 types, còn `apps/web` dùng 18 → hai `ReactNode` khác nhau.

**Rule:** app nào cần khoá phiên bản React types thì ghim trong `tsconfig.json` của app đó:

```json
"paths": { "react": ["./node_modules/@types/react"], "react-dom": ["./node_modules/@types/react-dom"] }
```

`paths` áp cho MỌI import trong chương trình (kể cả d.ts trong node_modules) nên react-router cũng bị ghim về 18. Vite không đọc `tsconfig.paths` (alias khai ở `vite.config`) nên runtime không đổi. Không chỉnh `hoist-pattern` toàn workspace — nhiều package khác đang sống nhờ hoist ẩn đó.

## 10. ⚠️ Logger wrapper thiếu method → TypeError nổ NGAY TRONG catch block, nuốt cả luồng xử lý lỗi

**Triệu chứng (09/09/2026, test e2e mua label seller):** `POST customer/shipping/orders/:id/label` trả `500 Internal server error` raw (đáng lẽ 400 `service_unavailable`) và **ví seller bị trừ tiền mà không hoàn** — nhánh auto-refund không bao giờ chạy. Log Nest: `TypeError: this.logger.error is not a function`.

**Root cause:** token DI `'winston'` (`apps/api/src/modules/winston/`) cung cấp `LoggerWrapper` — trước đây CHỈ có `.info()`. Các service inject nó nhưng khai type là winston `Logger` (`@Inject('winston') private readonly logger: Logger`) nên `this.logger.error(...)` type-check qua ngon lành, runtime mới nổ. Chết chỗ hiểm nhất: **lệnh log lỗi nằm đầu catch block** → TypeError thay thế lỗi gốc, mọi bước sau trong catch (hoàn tiền, dịch mã lỗi an toàn) bị nuốt. Lúc phát hiện có 19 call site `.error/.warn/.debug` trên 6 file dính bug tiềm ẩn này, gồm cả `shipping-vnp.service.ts` (9 chỗ — cron đối soát/hủy label).

**Fix (đã áp):** thêm `error`/`warn`/`debug` delegate vào `LoggerWrapper` (`logger.wrapper.ts`) — 1 chỗ sửa chữa cả 19 call site.

**Rule:**
- Wrapper che một interface có sẵn thì phải phủ ĐỦ các method mà type khai ra — hoặc khai type là chính wrapper, đừng mượn type của thư viện gốc.
- Code trong catch block phải "không được ném": lệnh đầu tiên của catch mà ném thì toàn bộ xử lý lỗi phía sau (refund, dịch mã lỗi) chết theo. Nghi ngờ gì thì log SAU khi làm việc quan trọng (hoàn tiền trước, log sau).
- Test nhánh lỗi bằng cách ép dependency fail thật (thiếu config, service down) — unit test mock logger đủ method nên không bao giờ bắt được lỗi này.

## 11. ⚠️ Một tiến trình, HAI Nest context → mọi `@Cron` đăng ký hai lần và chạy hai lần

`apps/api/src/main.ts` gọi **cả** `bootstrap()` lẫn `bootstrapMicroservice()`, hai context cùng nạp `AppModule` trong MỘT tiến trình Node. Hệ quả: `ScheduleModule` quét và đăng ký mọi `@Cron` hai lần.

**Đo trên prod 10–11/09/2026:** mỗi báo cáo CEO sinh **2 bản cách nhau 1 giây** (gọi Agent SDK gấp đôi — tiền thật), và báo cáo Telegram theo lịch gửi **2 lần**. Khoá chống trùng trong bộ nhớ (`Set`, cờ `running`) **KHÔNG cứu được**: hai context giữ hai thực thể service khác nhau nên mỗi bên có khoá riêng.

### Cách SAI đã thử (đừng lặp lại)

| Cách | Vì sao hỏng |
|---|---|
| Gỡ lịch bằng `SchedulerRegistry` **sau `app.listen()`** ở tiến trình microservice | Trên prod `listen()` của transport RMQ **không bao giờ trả về** (log chưa từng có dòng "Microservice is listening"), trong khi cron ở context đó vẫn nổ → fix vô tác dụng đúng ở nơi cần nhất. Dev thì `listen()` xong nên nhìn như đã sửa |
| Gọi `app.init()` trước rồi gỡ, sau đó `listen()` | `listen()` đăng ký lịch **lần nữa** trong cùng context → trùng tên → `SchedulerRegistry` **ném và sập cả tiến trình**. Dev crash-loop tới khi revert |

### Cách ĐÚNG

Chốt nằm trong **thân từng cron**, không phải quanh bootstrap — `apps/api/src/utils/cron-guard.ts`:

```ts
@Cron('0 7 * * *', { name: '...' })
async cronDaily(): Promise<void> {
  if (!laTienTrinhChayCron(this.adapterHost)) return;
  ...
}
```

Dấu hiệu nhận biết context: **không có HTTP adapter = tiến trình microservice** (cùng dấu hiệu `ZaloProxyService` dùng để không gắn proxy). Lịch vẫn được đăng ký ở cả hai context, nhưng tới giờ thì một bên thoát ngay — không phụ thuộc vào việc bootstrap chạy tới đâu.

### Rule chung

**Thêm `@Cron` mới ở `apps/api` thì dòng đầu thân hàm phải là chốt này.** Quên là cron chạy hai lần, và triệu chứng (ghi đúp, gửi đúp, tốn đúp) rất khó lần ra vì log hai lần trông y hệt nhau, chỉ lệch nhau một giây.

Cron nạp từ DB (`CronjobRunnerService`) chặn ở `onModuleInit` vì nó đăng ký trong `setTimeout` 2 giây — sau mọi bước dọn dẹp ở bootstrap.

## 12. ⚠️ ID của hệ ngoài có thể là ID THEO GÓC NHÌN, không phải ID toàn cục — so nhầm hai không gian thì trượt IM LẶNG

**Gặp ở:** `apps/api/src/modules/agent-api/agent-zalo-inbound.logic.ts`, `agent-zalo-read.service.ts` (12/09/2026, bắt được TRƯỚC khi bật cho agent).

**Triệu chứng:** bộ lọc "có ai @ đúng nick công ty không" không bao giờ khớp. Không lỗi, không cảnh báo, không ngoại lệ — chỉ là tính năng im lặng vĩnh viễn. Đo lại mới lộ: **không một uid nào** trong 12 uid bị tag nhiều nhất khớp bảng `zalo_accounts`.

**Root cause:** uid Zalo **phụ thuộc nick đang nhìn**. Cùng một người mang uid khác nhau tuỳ nick nào của công ty thấy họ — đo trên prod: "Hoàng Anh" có **8 uid**, Chủ tịch có 8. Và `zalo_accounts.zalo_uid` là uid nick **tự nhìn mình**, khác hẳn uid mà người khác thấy nó. Hai cột cùng tên `uid`, cùng kiểu `text`, trông như nhau, so được với nhau mà không hề đúng.

**Vì sao type system không cứu:** cả hai đều là `string`. Không có gì để bắt.

**Rule:**

1. Trước khi so hai ID từ hệ ngoài, **chứng minh chúng cùng không gian** bằng dữ liệu thật — đếm số dòng khớp. Khớp 0 dòng trên dữ liệu sống là bằng chứng bạn đang so nhầm, không phải "chưa có dữ liệu".
2. Không tồn tại "ID của một người" cho đến khi đã kiểm. Mặc định dùng `Set<string>`, không dùng `string`.
3. Danh tính đã được người xét (ở đây: `zalo_identities`) đáng tin hơn ID suy ra từ hệ ngoài, vì nó khoá đúng không gian mà người xét nhìn thấy.

**Anh em cùng gốc — cùng một nguyên nhân, hậu quả ngược lại:** engine lưu **một bản ghi cho mỗi nick công ty** trong nhóm, nên một câu nói thật ra 2–7 dòng với 2–7 id khác nhau (7 ngày: 26.034 dòng = 12.189 tin thật). Khoá chống trùng theo id bản ghi của hệ ngoài là **đánh thức agent 2–7 lần cho cùng một câu**. Khoá đúng phải theo id do NGUỒN GỐC cấp (`zaloMsgId`), không phải id do hệ trung gian cấp.

## Khi nào update file này

- Phát hiện bug pattern cross-cutting (ảnh hưởng > 1 module).
- Code review thấy lỗi tương tự lặp lại từ precedent đã ghi.
- Bug debug mất > 1h vì root cause subtle (silent failure, type system không catch).
