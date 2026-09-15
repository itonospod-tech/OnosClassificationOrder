# OnosFactory

Hệ thống quản lý xưởng in theo đơn (print-on-demand): khách/seller đặt đơn, đơn
chạy qua dây chuyền 8 chặng từ soát tool tới đóng gói, rồi gửi đi Mỹ.

Monorepo pnpm + Turborepo, gồm 4 app: **API** (NestJS + Fastify), **web** nội bộ
(React + Vite + Tailwind/Radix), **seller** cho khách (Next.js), và **design-worker**
xử lý ảnh.

> 🧭 **Mới vào dự án?** Đọc [`documents/Architecture/README.md`](documents/Architecture/README.md)
> trước — bản đồ 20 phút: hệ thống làm gì, code của bạn nằm ở đâu, và sáu luật ngầm
> sẽ cắn nếu không biết trước. File README này chỉ lo phần **cài đặt và chạy máy**.

---

## Mục lục

- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Chạy lần đầu](#chạy-lần-đầu)
  - [1. Cài dependencies](#1-cài-dependencies)
  - [2. Khởi động infrastructure (MongoDB + Redis + RabbitMQ)](#2-khởi-động-infrastructure-mongodb--redis--rabbitmq)
  - [3. Cấu hình env cho API](#3-cấu-hình-env-cho-api)
  - [4. Cấu hình env cho Web](#4-cấu-hình-env-cho-web)
  - [5. Chạy dev](#5-chạy-dev)
  - [6. (Tuỳ chọn) Mở dev ra ngoài bằng Cloudflare Tunnel](#6-tuỳ-chọn-mở-dev-ra-ngoài-bằng-cloudflare-tunnel)
- [Các lệnh hay dùng](#các-lệnh-hay-dùng)
- [Tài khoản đăng nhập](#tài-khoản-đăng-nhập)
- [Troubleshooting](#troubleshooting)

---

## Yêu cầu hệ thống

| Tool | Phiên bản | Ghi chú |
|------|-----------|---------|
| **Node.js** | >= 18.0.0 | Khuyến nghị 20 LTS. Dùng `nvm` để quản lý version |
| **pnpm** | 8.6.10 | `npm install -g pnpm@8.6.10` |
| **Docker Desktop** | Mới nhất | Để chạy MongoDB / Redis / RabbitMQ bằng `docker compose` |
| **Git** | Mới nhất | |

> Nếu bạn không muốn dùng Docker, có thể cài MongoDB / Redis / RabbitMQ trực tiếp hoặc dùng cloud (MongoDB Atlas, Upstash, CloudAMQP).

---

## Cấu trúc dự án

```
.
├── apps/
│   ├── api/        # NestJS + Fastify backend
│   └── web/        # React + Vite frontend
├── packages/
│   ├── core/       # NestJS utilities (guards, decorators, services)
│   ├── shared/     # Types / DTOs / enums dùng chung giữa FE & BE
│   ├── ui/         # Shared UI components (tối giản)
│   └── ...
├── documents/      # Tài liệu thiết kế
├── pnpm-workspace.yaml
└── turbo.json
```

**Backend modules hiện có:** `auth`, `user`, `role`, `custom-role`, `permission`, `departments`, `notifications`, `mail`, `upload`, `actions`, `system-config`, `amqp`, `redis-cache`, `queue`, `cronjob`, `winston`, `counter`.

**Frontend pages hiện có:** `login`, `register`, `forgot-password`, `dashboard`, `account`, `users`, `roles`, `custom-roles`, `departments`, `notifications`, `settings`, `errors`.

---

## Chạy lần đầu

### 1. Cài dependencies

```bash
# Ở thư mục gốc dự án
pnpm install
```

### 2. Khởi động infrastructure (MongoDB + Redis + RabbitMQ)

Dự án dùng `docker-compose.yml` ở `apps/api/docker/`. Cần khai báo một vài biến môi trường trước khi `docker compose up`.

```bash
cd apps/api/docker
```

Tạo file `.env` trong thư mục `apps/api/docker/` với nội dung:

```env
# RabbitMQ
RABBITMQ_USER=admin
RABBITMQ_PASSWORD=admin123
RABBITMQ_AMQP_PORT=5672
RABBITMQ_WEB_PORT=15672
RABBITMQ_DATA_PATH=~/.docker-conf/rabbitmq/data
RABBITMQ_LOG_PATH=~/.docker-conf/rabbitmq/log

# Redis
REDIS_PORT=6379
REDIS_PASSWORD=12345678
REDIS_DB=1
REDIS_DATA_PATH=~/.docker-conf/redis/data
```

Khởi động containers:

```bash
docker compose up -d
```

Sau khi chạy:
- **MongoDB** lắng nghe ở `localhost:27017` (replica set `rs0`)
- **Redis** lắng nghe ở `localhost:6379` (password `12345678`)
- **RabbitMQ** AMQP ở `localhost:5672`, web UI ở `http://localhost:15672` (admin / admin123)

**Khởi tạo MongoDB replica set** (chỉ cần lần đầu — Mongoose của NestJS cần điều này):

```bash
docker exec -it onosfactory-mongodb mongosh --eval "rs.initiate()"
```

Kiểm tra status:

```bash
docker exec -it onosfactory-mongodb mongosh --eval "rs.status().ok"
```

### 3. Cấu hình env cho API

API dùng **2 file env với 2 vai trò tách bạch**:

| File | Vai trò | Nội dung |
| --- | --- | --- |
| `.env` | công tắc chọn môi trường | **đúng 1 dòng** `NODE_ENV=...` |
| `.env.<NODE_ENV>` | toàn bộ config thật | ~260 dòng |

`src/main.ts` nạp `.env` trước để biết `NODE_ENV`, rồi mới nạp `.env.${NODE_ENV}`.

> ⚠️ **dotenv KHÔNG ghi đè biến đã tồn tại.** Vì `.env` nạp trước, mọi key bạn thêm vào `.env` sẽ **âm thầm vô hiệu hoá** key cùng tên trong `.env.development` — sửa bên `.env.development` sẽ "không ăn" mà không có lỗi nào báo. Giữ `.env` đúng 1 dòng.

```bash
cd ../..              # về thư mục gốc
cp apps/api/.env.example apps/api/.env                          # công tắc
cp apps/api/.env.development.example apps/api/.env.development  # config
```

Mở `apps/api/.env.development` và đảm bảo các biến quan trọng:

```env
PORT=3007

# MongoDB
DB_URI=mongodb://localhost:27017/workspace?replicaSet=rs0

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=12345678
REDIS_DB=1

# RabbitMQ — CẢ HAI biến đều bắt buộc, thiếu 1 cái là app không boot được
RABBITMQ_URI=amqp://admin:admin123@localhost:5672
RABBITMQ_MAIN_EXCHANGE=onosfactory

# JWT — đã có keypair sẵn trong file mẫu, giữ nguyên cho dev
JWT_EXPIRATION_TIME=86400

# CORS — BỔ SUNG vào 3 origin cố định trong `src/main-nest.ts`, không thay thế.
# Để trống khi chỉ chạy localhost.
ALLOWED_ORIGINS=
```

> `NODE_ENV` **không cần** đặt trong `.env.development` — lúc file này được nạp thì `NODE_ENV` đã có sẵn từ `.env` rồi, và dotenv cũng sẽ không ghi đè nó.

> `.env.development.example` chứa khá nhiều biến cho các tính năng đã bị xoá (Backblaze, Telegram, providers...). Bạn có thể bỏ qua hoặc xoá bớt cho gọn — API vẫn chạy nếu chúng để trống.

### 4. Cấu hình env cho Web

```bash
cp apps/web/.env.example apps/web/.env.development
```

Sửa `apps/web/.env.development`:

```env
NODE_ENV=development
# CHỈ tới `/api`, KHÔNG kèm `/v1` — services tự nối `/${CONFIG.API_VERSION}`
# (`src/constants/index.ts`) vào trước mỗi endpoint. Ghi thừa `/v1` ở đây thì
# mọi request thành `/api/v1/v1/...` và trả 404.
VITE_API_URL=http://localhost:3007/api
```

### 5. Chạy dev

Mở 2 terminal:

**Terminal 1 — Backend:**

```bash
cd apps/api
pnpm dev
```

API sẽ chạy ở `http://localhost:3007`. Swagger docs: `http://localhost:3007/documentation?key=<AGENT_API_KEY>` — trang này **chỉ mô tả bộ API dành cho AI agent** (`/api/v1/agent`); API nội bộ cố ý không có trong đặc tả, xem `documents/FunctionDescription/AgentApi.md` §8.1.
(trang bị khoá bằng chính khoá của bộ API agent — đặt `AGENT_API_KEY` trong `.env.development`; để trống thì đóng cả trang tài liệu lẫn bộ API agent).

**Terminal 2 — Frontend:**

```bash
cd apps/web
pnpm dev
```

Web app sẽ chạy ở `http://localhost:5173`. Mở trình duyệt và bạn sẽ thấy trang Login.

> Hoặc chạy cả hai cùng lúc từ thư mục gốc: `pnpm dev`.

---

### 6. (Tuỳ chọn) Mở dev ra ngoài bằng Cloudflare Tunnel

Web và API chạy ở 2 cổng khác nhau nên cần **2 hostname**, theo quy ước
`<sub>.<domain>` cho web và `api-<sub>.<domain>` cho API:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: task.lcndev.online       # web
    service: http://127.0.0.1:5173
  - hostname: api-task.lcndev.online   # API
    service: http://127.0.0.1:3007
  - service: http_status:404
```

Phía web **không cần sửa gì**: khi chạy `vite dev`, `resolveApiUrl()` trong
`apps/web/src/constants/index.ts` tự nhận biết trang đang mở bằng localhost/IP
LAN hay bằng domain thật — localhost thì dùng `VITE_API_URL`, domain thật thì
đổi sang `api-<sub>.<domain>`. Tunnel API nằm ở hostname khác quy ước thì đặt
thêm `VITE_TUNNEL_API_URL` trong `apps/web/.env.development`.

Phía API chỉ cần thêm origin của web vào CORS — biến này **bổ sung** vào 3
origin cố định chứ không thay thế:

```env
# apps/api/.env.development
ALLOWED_ORIGINS=https://task.lcndev.online
```

Vite còn chặn Host header lạ, nên chạy web kèm `--host` và khai báo hostname
tunnel qua `vite dev --host --allowed-hosts task.lcndev.online` (hoặc thêm
`server.allowedHosts` vào `apps/web/vite.config.js`).

---

## Các lệnh hay dùng

Chạy ở thư mục gốc:

```bash
pnpm dev            # Chạy cả API + Web song song
pnpm dev:api        # Chỉ API
pnpm dev:web        # Chỉ Web
pnpm build          # Build tất cả
pnpm build:api      # Build API
pnpm build:web      # Build Web
pnpm lint           # ESLint tất cả packages
pnpm format         # Prettier format
```

### Trên Windows — dùng bộ lệnh `:win`

Bộ lệnh ở trên viết cho shell POSIX (macOS / Linux / WSL / Git Bash): dùng nháy đơn trong `--exec`, biến môi trường inline `NODE_OPTIONS=...`, và `mkdir` / `cp -rf`. Chạy bằng `cmd.exe` hoặc PowerShell sẽ lỗi kiểu `''pnpm' is not recognized...` hoặc `'cp' is not recognized...`.

Trên Windows dùng bản `:win` tương ứng (hành vi giống hệt, chỉ khác cú pháp shell):

```powershell
pnpm dev:win          # Chạy cả API + Web song song
pnpm dev:api:win      # Chỉ API
pnpm dev:web:win      # Chỉ Web
pnpm build:win        # Build tất cả
pnpm build:api:win    # Build API
pnpm build:web:win    # Build Web
pnpm start:api:win    # Chạy API đã build (dùng ./start.js, tự fallback dist-prod → dist)
```

Các lệnh còn lại (`lint`, `format`, `build-types`, `spell`, `clean-node-modules`, `clean-dist`, `reset`) chạy được trên cả hai môi trường, không cần bản `:win`.

> Nếu bạn dùng WSL hoặc Git Bash trên Windows thì cứ dùng bộ lệnh POSIX bình thường.

Dọn dẹp khi gặp vấn đề:

```bash
pnpm clean-node-modules   # Xoá toàn bộ node_modules
pnpm install              # Cài lại
```

---

## Tài khoản đăng nhập

Hiện tại chưa có seed script — database trống sau khi khởi tạo. Có 2 cách để có user đầu tiên:

**Cách 1:** Gọi endpoint `POST /api/v1/auth/register` bằng curl hoặc REST client (endpoint này **không còn trên Swagger** — trang đó nay chỉ mô tả bộ API agent) để tạo tài khoản. Lưu ý: register yêu cầu trong DB phải có sẵn 1 `Role` tên `SellerManager` và 1 `Department` tên `PKD-1` — bạn cần tự seed bằng mongosh hoặc Mongo Compass.

**Cách 2 (khuyến nghị):** Insert thủ công vào MongoDB qua mongosh:

```bash
docker exec -it onosfactory-mongodb mongosh workspace
```

```js
// Tạo role Admin
db.roles.insertOne({
  _id: "role_admin",
  name: "Admin",
  permissionIds: [],
  createdAt: new Date(),
  updatedAt: new Date()
})

// Tạo department mặc định (cần cho register flow)
db.departments.insertOne({
  _id: "dept_default",
  name: "PKD-1",
  createdAt: new Date(),
  updatedAt: new Date()
})
```

Sau đó gọi `POST /api/v1/auth/register` bằng curl hoặc REST client để tạo user (endpoint này không còn trên Swagger). Vào DB update lại `roleId` của user thành `"role_admin"` để có quyền admin.

> Nếu muốn, mình có thể viết một seed script nhỏ ở `apps/api/scripts/` để chạy `pnpm seed` tạo admin tự động — báo nhé.

---

## Troubleshooting

**API in `env undefined ...` rồi tắt với `NODE_ENV must be defined`**
→ File env thiếu dòng `NODE_ENV`. `start.js` bắt buộc phải có biến này (dùng để nạp tiếp `.env.${NODE_ENV}`). Thêm `NODE_ENV=development` vào `apps/api/.env` (hoặc `.env.development`).

**`RABBITMQ_MAIN_EXCHANGE environment variable does not set`**
→ Thêm `RABBITMQ_MAIN_EXCHANGE=onosfactory` vào file env. Lưu ý tên biến code đọc là `RABBITMQ_URI` (VIẾT HOA HẾT) — file env ghi `RabbitMQ_URI` thì trên Windows vẫn chạy (env Windows không phân biệt hoa/thường) nhưng **trên Linux/macOS sẽ lỗi**.

**`ERR AUTH <password> called without any password configured for the default user`**
→ Redis local không bật auth nhưng env lại có `REDIS_PASSWORD`. Hoặc để trống `REDIS_PASSWORD=`, hoặc chạy Redis bằng `docker compose` trong `apps/api/docker` (bản compose có set password).

**API báo lỗi `ECONNREFUSED` khi khởi động**
→ Kiểm tra MongoDB / Redis / RabbitMQ containers đã chạy chưa: `docker ps`. Nếu thiếu thì `docker compose up -d` lại trong `apps/api/docker`.

**MongoDB báo `not primary` hoặc transactions fail**
→ Replica set chưa được khởi tạo. Chạy: `docker exec -it onosfactory-mongodb mongosh --eval "rs.initiate()"`.

**Frontend gọi API bị CORS**
→ Trong `apps/api/.env.development`, set `ALLOWED_ORIGINS=http://localhost:5173`.

**`pnpm install` cài siêu lâu hoặc kẹt**
→ Xoá lockfile cũ ở các package con (nếu có) và chạy lại. Hoặc dùng `pnpm install --no-frozen-lockfile`.

**Port 3007 / 5173 đã bị chiếm**
→ Đổi `PORT` trong `apps/api/.env.development`, đổi port Vite bằng `vite --port 5174` hoặc trong `apps/web/vite.config.js`.

**TypeScript báo lỗi sau khi clone lần đầu**
→ Các `packages/shared`, `packages/core` cần build trước. Chạy `pnpm build` ở root một lần.

---

## Tài liệu nội bộ

Xem thư mục `documents/` để biết thêm:
- `Foundation/System_Overview.md` — Tổng quan hệ thống (bản gốc, có nhiều phần đã được dọn)
- `Foundation/Project_Structure.md` — Cấu trúc dự án chi tiết
- `Architecture/Auth_System.md` — Thiết kế hệ thống auth

> Lưu ý: nhiều file tài liệu vẫn mô tả các module đã bị xoá (orders, providers, tracking...). Coi như tư liệu tham khảo lịch sử.
