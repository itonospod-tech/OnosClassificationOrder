# Chat Zalo trong hệ thống (Zalo Chat) — Function Description

> **File FE:** `apps/web/src/pages/zalo/` · `apps/web/src/lib/next-shim/` · `apps/web/src/services/zaloChat.ts`
> **File BE:** `apps/api/src/modules/zalo-chat/`
> **Hạ tầng:** `docker/zalo-engine/docker-compose.yml`
> **Route:** `/adm/zalo` · `/adm/zalo/settings`
> **API:** `POST|DELETE /v1/zalo-chat/session` · proxy `/api/zalo-multi/*` (NGOÀI tiền tố `api/v1`)

## Quyền đọc dữ liệu Zalo đi theo TÀI KHOẢN, không theo role (15/09/2026)

Trước đây mọi `SuperAdmin`/`Admin` vào màn chat là `owner` — thấy toàn bộ hội
thoại. Hệ thống có **8 tài khoản SuperAdmin** và danh sách còn dài ra mỗi khi có
người mới tham gia, nên quyền đọc nội dung chat tự nới theo mà không ai nhận ra.

Từ nay quyền này gắn vào **danh sách trắng email**, hard-code trong mã nguồn:

| Tài khoản | Vai trò |
|---|---|
| `tuankudo199@gmail.com` | Người duy nhất được đọc |
| `automation@onosfactory.com` | Cron đồng bộ nhóm, tóm tắt, và đường gửi của AI agent |

**Vì sao hard-code chứ không để env / `system_configs`:** để ở env hoặc DB thì ai
có quyền vào máy chủ hoặc vào DB đều sửa được lặng lẽ. Để trong mã nguồn thì muốn
đổi phải có commit + deploy, luôn còn dấu vết trong lịch sử git. Đây là quyết định
về quyền riêng tư, không phải một tham số cấu hình.

### Cài đặt

| Lớp | Nơi |
|---|---|
| Luật (hàm thuần + spec) | `apps/api/src/utils/zalo-access.ts` |
| Guard | `apps/api/src/guards/zalo-access.guard.ts` — **fail-closed** |
| Decorator | `AuthZalo()` ở `apps/api/src/decorators/http.decorator.ts` |
| Cấp phiên màn chat | `ZaloChatService.vaiTro(role, email)` — xét danh sách trắng TRƯỚC role |
| Ẩn menu | `apps/web/src/constants/zaloAccess.ts` + `Sidebar.tsx` |

`ZaloAccessGuard` phải chạy **sau** `AuthGuard` (nơi gắn `request.user`), nên mọi
endpoint dùng `AuthZalo()` thay vì tự ghép `UseGuards` — đặt guard ở cấp controller
sẽ chạy trước `AuthGuard` và chặn cả người được phép. Guard fail-closed: không đọc
được người dùng thì từ chối, để nếu thứ tự guard bị đổi thì hỏng theo hướng *chặn
tất cả* (thấy ngay) chứ không phải *mở tất cả* (không ai thấy).

Danh sách ở FE chỉ để ẩn menu; **chốt thật ở BE**. Đổi danh sách phải sửa cả hai
file, nếu không thì hoặc menu ẩn mà API vẫn mở, hoặc menu hiện rồi bấm vào báo 403.

### Vẫn còn một đường: Agent API

`X-Agent-Api-Key` không phải tài khoản người dùng nên không đi qua chốt này. Ai có
khoá đó vẫn đọc được `zalo_group_summaries`, `zalo_identities` và các endpoint
`/v1/agent/zalo/*`. Đó là chủ đích — AI agent cần chúng — nhưng có nghĩa **khoá
agent phải được giữ như một bí mật**, không chia cho người chỉ cần quyền dev.

## 1. Overview

Nhúng module Zalo của nhà cung cấp (`@zero-126/*`) vào OnosFactory để quản lý **nick Zalo của sale**:
quét QR đăng nhập nick, chat, gán hội thoại, trả lời tự động — ngay trong `/adm`, không phải mở app khác.

Ba mảnh:

| Mảnh | Là gì | Ai viết |
|---|---|---|
| **Engine** | Container `ghcr.io/zero-126/zalo-engine` + Postgres + Redis riêng. Nói chuyện với Zalo, giữ phiên nick, lưu hội thoại. | Nhà cung cấp |
| **Proxy** | `apps/api/src/modules/zalo-chat/` — xác thực người dùng của app rồi chuyển tiếp sang engine kèm chữ ký HMAC. | Ta |
| **Giao diện** | `@zero-126/zalo-ui` (`ZaloWorkspace`, `ZaloSettings`) mount trong 2 trang React. | Nhà cung cấp |

**KHÔNG liên quan tính năng "Nối nhóm Zalo ↔ khách hàng"** ([ZaloGroupMapping.md](ZaloGroupMapping.md)): tính năng
đó đọc dữ liệu từ MỘT engine KHÁC (host `onosceo`, 2 nick của công ty) để làm báo cáo/tóm tắt. Engine ở đây là
engine THỨ HAI, license riêng, dữ liệu riêng, dành cho nick sale. Hai bên không dùng chung DB.

## 2. Luồng hoạt động

```
Trình duyệt (/adm/zalo)
   │ 1. POST /api/v1/zalo-chat/session   (JWT trong header — như mọi API khác)
   │    ← Set-Cookie: onos_zalo=<JWT RS256>; Path=/api/zalo-multi; HttpOnly
   │
   │ 2. ZaloWorkspace gọi thẳng /api/zalo-multi/... (fetch, credentials=same-origin)
   ▼
API (hook onRequest của Fastify)
   │ 3. đọc cookie → {id, displayName, role}
   │ 4. ký x-service-token = {ts}.{HMAC-SHA256(ts, ZALO_ENGINE_SECRET)}
   │    + x-user-id / x-user-name / x-user-role / x-user-scopes
   ▼
Zalo Engine (127.0.0.1:4001) ──▶ Zalo
```

### Vì sao phải có bước đổi JWT lấy cookie

SDK của nhà cung cấp gọi bằng `fetch(..., { credentials: 'same-origin' })` và **không gắn header
`Authorization`** — đó là mã đã build, không sửa được. JWT của app nằm ở `localStorage` nên không tự đi kèm.
Nên trang chat đổi JWT lấy một cookie `HttpOnly` **phạm vi hẹp đúng `/api/zalo-multi`**, sống 8 giờ. Cookie ký
bằng chính cặp khoá RS256 của hệ thống (`JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`) — một nơi để xoay khoá.

### Điều kiện bắt buộc: trang và proxy phải CÙNG ORIGIN

Giao diện gọi `/api/zalo-multi/...` bằng đường **tương đối** và `credentials: 'same-origin'`. Kéo theo hai ràng buộc:

1. Origin đang mở trang **phải phục vụ được `/api/...`**. Trên dev, tunnel đã có luật `^/api` cho
   `dev-onos.autonow.vn`. Trên **production**, `onosfactory.com` hiện CHỈ phục vụ tệp tĩnh (web gọi API qua
   `api.onosfactory.com`), nên trước khi bật màn chat phải thêm vào server block `onosfactory.com`:

   ```nginx
   # Đặt TRƯỚC location regex tệp tĩnh. `^~` chặn regex phía dưới cướp mất request.
   location ^~ /api/ {
       proxy_pass http://127.0.0.1:3007;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       client_max_body_size 50M;   # gửi ảnh/tệp qua Zalo
       proxy_read_timeout 120s;    # engine cho phép 45s cho đính kèm
   }
   ```

2. Cookie phiên phải được cấp **trên chính origin của trang**, nên `useZaloSession` gọi `fetch` đường tương đối
   `/api/v1/zalo-chat/session` chứ KHÔNG qua `RepositoryRemote`. Bản dev qua tunnel tự suy ra host API riêng
   (`api-dev-onos.autonow.vn`); gọi qua axios sẽ đặt cookie cho host đó, còn SDK gọi host của trang — cookie
   không bao giờ đi kèm và **mọi lời gọi trả 401**. Đây là lỗi đã dính lúc chạy thử lần đầu.

### Vì sao proxy nằm ở hook `onRequest` chứ không phải controller Nest

1. **Đường dẫn `/api/zalo-multi` là cố định** — giao diện gọi thẳng chuỗi này ở 8 chỗ trong mã đã build, nên nó
   phải nằm NGOÀI tiền tố `api/v1` của API.
2. **Hook `onRequest` chạy trước khâu đọc body**, nên `req.raw` còn nguyên luồng — điều kiện bắt buộc để
   chuyển tiếp multipart (gửi ảnh/tệp) mà không nạp cả tệp vào RAM.

Phần chuyển tiếp **dùng lại `createZaloProxyHandler` của SDK**, không chép tay: hợp đồng với engine còn có danh
sách header phải bỏ, trần chờ riêng cho đường chậm (gửi tệp 60s, còn lại 30s), `push/sw.js` phải phục vụ tại app
đúng MIME, và `directory` KHÔNG được forward. Chép tay bốn thứ đó là bốn chỗ lệch âm thầm mỗi lần vendor ra bản mới.

## 3. API / Schema

| Method | Path | Mô tả |
|---|---|---|
| POST | `/v1/zalo-chat/session` | Đổi JWT lấy cookie phiên. `@Auth([SuperAdmin, Admin])`. |
| DELETE | `/v1/zalo-chat/session` | Xoá cookie phiên. |
| ALL | `/api/zalo-multi/*` | Proxy sang engine. Không có cookie hợp lệ → **401**, không forward. |
| GET/POST | `/api/zalo-multi/socket` | socket.io polling → `/socket.io/` của engine. |

Không có collection Mongo nào: module này **chỉ là cầu nối**, mọi dữ liệu Zalo nằm trong Postgres của engine.

## 4. UI Components

| File | Vai trò |
|---|---|
| `pages/zalo/index.tsx` | Mount `<ZaloWorkspace basePath="/adm/zalo" settingsPath="/adm/zalo/settings">` |
| `pages/zalo/settings.tsx` | `<ZaloSettings>` bọc `ZaloConfigProvider` (component này đọc `basePath` từ context) |
| `pages/zalo/useZaloSession.ts` | Xin cookie phiên trước khi dựng giao diện |
| `lib/next-shim/link.tsx`, `navigation.ts` | Shim `next/link` + `next/navigation` — xem §5 |

Entry sidebar "Chat Zalo" nằm cạnh "Nhóm Zalo", **`onlyForRoles: [SuperAdmin, Admin]`**.

## 5. Backend logic / điểm cần biết

- **Gói giao diện viết cho Next.js.** Nó import `next/link` + `next/navigation` ngay trong mã đã build (đúng 2 chỗ).
  App này chạy Vite + react-router nên `vite.config.js` alias hai đường đó sang `src/lib/next-shim/`. **KHÔNG cài
  `next`** chỉ để thoả một import. `useRouter().refresh()` để rỗng: `refresh` của Next là nạp lại dữ liệu phía
  server, app này không có, mà reload cả trang sẽ đá người dùng khỏi cuộc trò chuyện đang mở.
- **Vai trò**: `SuperAdmin`/`Admin` → `owner` (thấy MỌI hội thoại của MỌI nick). Role khác → không cấp cookie.
  Quyết định vai trò nằm ở **một chỗ duy nhất** — `ZaloChatService.vaiTro()`; decorator `@Auth` chỉ chặn vòng ngoài.
  Muốn mở cho Manager/Support thì thêm nhánh `member` ở đó, KHÔNG nới ở proxy.
- **Tiến trình microservice**: `main-nest.ts` dựng thêm một `NestMicroservice` nạp cùng `AppModule` — ở đó
  `httpAdapter` là `null`. `ZaloProxyService.onModuleInit` phải kiểm tra trước khi gắn hook, không thì tiến trình
  đó sập lúc khởi động (đã dính một lần).
- **Engine pin theo digest**, không dùng `:latest`. Có bản mới thì engine tự ghi log "CÓ BẢN ENGINE MỚI" → đọc
  changelog ở https://zalo.autonow.vn (hoặc `curl -s https://zalo.autonow.vn/api/version`) → đổi digest trong
  compose → `docker compose pull && up -d`. **Sao lưu DB engine trước khi nâng cấp**:
  `docker exec onos-zalo-engine-db pg_dump -U zalo zalo_engine | gzip > ~/zalo-engine-backup-$(date +%F).sql.gz`.
  Bản đang chạy: `20260922-c2ec259` / gói `1.47.1` (22/09/2026). Giữ `ZALO_MULTI_ENCRYPTION_KEY` và volume DB thì
  phiên Zalo sống qua lần nâng cấp — đo lần 09/09: 6 phiên khôi phục đủ, listener nối lại trong ~10 giây.
- ⚠️ **Gói `zalo-ui` từ 1.47.1 phá build Tailwind v3.** `theme.css` bọc phần màu chữ trong `@layer base { … }`
  theo kiểu Tailwind v4 (ở đó `@layer` là tầng của chính Tailwind). Vite đưa TỪNG tệp CSS qua postcss riêng lẻ,
  nên tệp của nhà cung cấp không có `@tailwind base` đi kèm và Tailwind v3 dừng build:
  `` `@layer base` is used but no matching `@tailwind base` directive is present ``. Vá ở
  `apps/web/postcss.config.js` — plugin `go-vo-layer-zalo-ui` GỠ VỎ `@layer` (giữ nguyên khai báo bên trong)
  trước khi Tailwind chạy, chỉ áp cho đúng đường dẫn tệp đó. Nhà cung cấp bỏ `@layer` thì xoá plugin đi là xong.
  KHÔNG sửa tệp trong `node_modules`: lần cài sau là mất.
- **Máy dev cũng chạy một engine riêng** (`docker/zalo-engine` trên máy hub, cùng cổng 4001) — nâng cấp thì làm
  cả hai, không thì dev với prod lệch bản và lỗi chỉ hiện ở một bên.

## 5b. Khu Telegram (09/09/2026 — engine `20260909-dd6c38a`, gói `1.44.1`; nay chạy `20260922-c2ec259` / `1.47.1`)

Nhà cung cấp thêm khu Telegram vào CÙNG engine: quản lý bot, đọc và trả lời chat/nhóm/topic, phân quyền theo cùng cơ chế của khu Zalo.

- **Bật bằng env engine `TELEGRAM_ENABLED=1`** (đã đặt sẵn trong `docker/zalo-engine/docker-compose.yml`). Thiếu biến này thì engine tắt khu đó và giao diện hiện đúng câu hướng dẫn đặt biến.
- **Trang**: `/adm/telegram` (`apps/web/src/pages/telegram/index.tsx`) render `TelegramWorkspace` của gói. Menu sidebar `sidebar.telegram`, **không gắn mã quyền của hệ mình** — y như màn Zalo, phân quyền nằm ở dialog "Phân quyền" của engine.
- **Proxy**: đường thứ hai `TELEGRAM_PROXY_PREFIX = '/api/telegram'` dùng **CÙNG factory** `createZaloProxyHandler` với tuỳ chọn mới `enginePrefix` (có từ 1.44.1). Không chép lại phần ký HMAC / lọc header / trần chờ — chép tay là chỗ để lệch mỗi lần vendor ra bản mới.
- **Phiên dùng chung**: `cookiePhien()` nay trả **một `Set-Cookie` cho mỗi đường proxy** (`ZALO_COOKIE_PATHS`), vì cookie cũ khoá `Path=/api/zalo-multi` nên không đi kèm request `/api/telegram`. Cố ý KHÔNG nới thành `Path=/api` — nới ra là cookie đi kèm mọi lời gọi `api/v1` của app.
- **Telegram chưa có đường socket riêng**: `chuyenTiep()` chỉ coi `socket` là socket khi đi qua tiền tố Zalo.
- **Cần một bot**: mở @BotFather → `/newbot` → dán token vào nút "Thêm bot" trong màn hình → thêm bot vào nhóm cần theo dõi. Bot bật privacy mode thì chỉ thấy tin nhắc `@bot`, lệnh, và tin trả lời bot — muốn đọc hết nhóm phải tắt privacy ở BotFather.
- Kiểm 09/09/2026 trên dev: `/api/telegram/*` không cookie trả 401, có cookie thì màn hình lên đúng trạng thái "chưa có bot" lấy từ engine.

- **Engine chỉ nghe loopback** (`127.0.0.1:4001`). Nó đọc được mọi hội thoại nên tuyệt đối không mở ra mạng ngoài;
  mọi lối vào phải đi qua proxy của app.

## 6. Cấu hình

`apps/api/.env.<NODE_ENV>`:

```
ZALO_ENGINE_URL=http://127.0.0.1:4001
ZALO_ENGINE_SECRET=<trùng y hệt docker/zalo-engine/.env>
```

Production còn cần: **`GHCR_TOKEN`** trong môi trường của server (deploy chạy `pnpm install`), **license riêng**
cho máy đó, và block nginx ở §2. Phiên nick KHÔNG chuyển được giữa hai engine — lên engine mới phải quét QR lại.

`docker/zalo-engine/.env` (KHÔNG commit — xem `.env.example`): `ENGINE_PORT`, `PG_PW`, `ZALO_ENGINE_SECRET`,
`ZALO_ENCRYPTION_KEY` (đổi = mất hết phiên, phải quét QR lại), `ZALO_LICENSE_KEY` (**mỗi server một khoá**).

Gói npm nằm ở registry riêng: `.npmrc` ở gốc repo trỏ `@zero-126` sang `npm.pkg.github.com`, token đọc từ biến
môi trường `GHCR_TOKEN` — **máy nào chạy `pnpm install` (kể cả server production lúc `deploy.sh`) phải có biến này**.

## 7. Vận hành thật (từ 03/09/2026)

| Mảnh | Dev (hub) | Production (`onosnew`) |
|---|---|---|
| Engine | `docker/zalo-engine/` trong repo hub, license "ONOS _HUB" | `/var/www/onosfactory/current/docker/zalo-engine/` (`.env` gitignored, license "ONOS _HUB_PROD", 30 nick). **Docker cài ngày 03/09 chỉ cho việc này.** |
| Token registry | `/root/.onos-ghcr.env` (600), `~/.bashrc` nạp | y hệt; `deploy.sh` tự nạp cho shell không tương tác |
| `/api/` trên origin web | luật `^/api` của tunnel | block `location ^~ /api/` chèn tay vào server 443 `onosfactory.com` ở `/etc/nginx/sites-enabled/onosfactory` (bản lưu `/etc/nginx/onosfactory.bak-*`) — KHÔNG nằm trong repo |

**Sự cố lần deploy đầu (03/09):** pnpm hỏi "xoá node_modules cài lại?" khi tập registry đổi, chạy không tương tác thì
**thoát 0 mà không cài gì** → API build thiếu `@zero-126/zalo-sdk` → sập. `deploy.sh` đã vá (trả lời sẵn + kiểm gói
resolve được trước khi build). Bẫy kiểm tra: API trả `200 text/html` rỗng cho GET không có route, nên **kiểm block
nginx bằng POST** (`/api/v1/auth/login` → 422 JSON), đừng nhìn `GET /api/v1`.

## 8. Permissions

| Vai trò hệ thống | Vào `/adm/zalo` | Vai trong engine |
|---|---|---|
| SuperAdmin, Admin | có | `owner` — thấy mọi hội thoại |
| Còn lại | không (không có entry sidebar, `POST session` trả 403) | — |

> **CSS của gói UI (07/09/2026 — sự cố prod avatar phình to cả màn):** `@zero-126/zalo-ui` là JSX đã build mang sẵn class Tailwind (`size-10`, `rounded-full`, `shrink-0`…) nhưng KHÔNG kèm CSS tiện ích — chỉ có `theme.css` (12 slot `--zalo-*`). App chủ phải cho Tailwind quét dist của gói: `apps/web/tailwind.config.js` `content` thêm `./node_modules/@zero-126/zalo-ui/dist/**/*.js` (thghub làm bằng `@source` của Tailwind 4). Thiếu dòng này thì lớp nào `src/` không tình cờ dùng sẽ không được sinh → avatar không có kích thước, nút mất bo góc. Gói viết cho Tailwind 4 nên 4 tiện ích v4 (`shadow-xs`/`rounded-xs`/`outline-hidden`/`field-sizing-content`) được khai lại bằng plugin `addUtilities` trong cùng file. Kiểm sau build: `grep -c '\.size-10' apps/web/dist/assets/index-*.css` phải ≥ 1 (bundle chính tăng ≈ 123 → 163 KB).

## Phân quyền — danh bạ & phạm vi (sửa 08/09/2026)

Ops báo dialog "Phân quyền" của nhà cung cấp không khớp được role/user bên Onos: phần "Cấp lẻ từng người" luôn báo *"Không có user nào trong role này"*, rule "Match scope"/"Theo scope của user" không khớp ai. Nguyên nhân **hoàn toàn ở phía mình**, ba chỗ:

| Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|
| Không liệt kê được người để cấp quyền lẻ; ô scope không gợi ý | `ZaloProxyOptions.listUsers` **chưa khai** → proxy trả `[]` cho `GET /api/zalo-multi/directory` (SDK: "Không khai → endpoint trả []") | `ZaloChatService.danhBa()` trả `DirectoryUser[]` (nhân sự `status=1`, chưa xoá) — id, tên, tier, `roleLabel` = tên role hệ thống, `scopes`, email, phòng ban. Dữ liệu phục vụ TẠI app, KHÔNG forward sang engine |
| Rule theo scope không khớp ai | `docPhien()` luôn trả `scopes: []` | Cookie phiên mang thêm `nhan` (roleLabel) + `pv` (scopes); `phamVi()` dựng chuỗi **`role:<Tên role>` · `dept:<mã phòng ban>` · `factory:<mã xưởng>`** — tiền tố cố định để engine so chuỗi và autocomplete gom nhóm được |
| Cấp quyền cho người ngoài Admin xong họ vẫn không vào được | `vaiTro()` trả `null` cho mọi role khác Admin, controller `@Auth([SuperAdmin, Admin])`, sidebar `onlyForRoles` — không ai ngoài Admin lấy được phiên | SuperAdmin/Admin → `owner` (thấy mọi hội thoại) như cũ; **nhân sự khác → `member`**, controller đổi thành `@Auth([])`, bỏ `onlyForRoles` ở sidebar. Member KHÔNG thấy gì cho tới khi có rule/grant bên engine — đúng mô hình của nhà cung cấp |

Kiểm 08/09/2026 trên dev: `GET /api/zalo-multi/directory` trả **38 nhân sự** kèm scope thật (`role:Support`, `role:Fulfillment` + `factory:ML`, `role:Designer`…); tab "Ma trận quyền" trong Cài đặt Zalo gọi `/directory` 200 (dev chưa nối nick Zalo nào nên bảng còn trống).

**Lưu ý dữ liệu:** hiện KHÔNG nhân sự nào có `departmentId` (48/48 trống trên dev) nên chưa có scope `dept:*`. Muốn dùng rule theo phòng ban thì phải gán phòng ban cho nhân sự ở `/adm/departments` trước.

