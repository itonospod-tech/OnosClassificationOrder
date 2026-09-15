# Kiến trúc OnosFactory — bản đồ cho người mới

> Dành cho đội dev vừa nhận việc. Mục tiêu: đọc 20 phút là biết hệ thống làm gì,
> code của mình nằm ở đâu, và những luật ngầm nào sẽ cắn nếu không biết trước.
>
> Đây là **bản đồ**, không phải đặc tả. Mỗi mục đều trỏ tới tài liệu sâu hơn.
> Cập nhật: 15/09/2026.

---

## 1. Công ty này làm gì

Onos là **xưởng in theo đơn (print-on-demand)**. Khách hàng — gọi là **seller** —
bán hàng trên Etsy/TikTok/Shopify, mỗi khi có người mua thì đẩy đơn sang Onos.
Onos in, may, đóng gói và gửi thẳng tới người mua cuối ở Mỹ.

Hai điều này chi phối gần như mọi quyết định thiết kế trong repo:

**Một đơn là một sản phẩm cần làm, không phải một giao dịch.** Nó đi qua một dây
chuyền vật lý có người thật đứng ở từng chặng, mỗi chặng có thể phát hiện lỗi và
đẩy ngược về chặng trước. Vì thế `orders` có rất nhiều cột mốc thời gian, và bảng
nhật ký `orderLogs` lớn gấp **57 lần** bảng đơn (3,26 triệu dòng / 57,6 nghìn đơn).

**Khách của Onos cũng là người bán.** Họ cần cổng riêng để đặt đơn, xem tiến độ,
xem giá, nạp ví, mua nhãn vận chuyển. Đó là lý do có hẳn một app riêng cho họ
(`apps/seller`) chứ không phải một trang trong app quản trị.

### Hệ cũ vẫn đang sống

Trước OnosFactory, công ty chạy trên **OnosPod** (`app.onospod.com`) — mất source,
chỉ còn API. Hệ mới bắt đầu có đơn thật từ **06/2026**. Nghĩa là:

- Số liệu trước 06/2026 **không có** trong hệ này. Đừng dựng báo cáo "từ đầu năm".
- Một số đơn vẫn chảy vào qua cron đồng bộ từ OnosPod.
- Phần tiền/hoá đơn vẫn nằm bên hệ cũ — đó là rào cản lớn nhất của việc chuyển hẳn.

Chi tiết: [`OnosPodLegacy-BusinessFlows.md`](OnosPodLegacy-BusinessFlows.md).

---

## 2. Bốn app, hai package — code của bạn nằm ở đâu

```
apps/
  api             410 file   NestJS + Fastify    ← toàn bộ nghiệp vụ, cổng 3007
  web             371 file   React + Vite        ← app NỘI BỘ (/adm, /ffm)
  seller          133 file   Next.js 16          ← app cho KHÁCH, cổng 3017
  design-worker     6 file   Node + sharp        ← xử lý ảnh, chạy máy riêng
packages/
  shared          139 file   Zod DTO + enum      ← hợp đồng dùng chung FE/BE
  core             44 file   guard, decorator    ← tiện ích NestJS dùng chung
```

**Quy tắc chọn chỗ đặt code:**

| Bạn đang làm | Đặt ở |
|---|---|
| Nghiệp vụ, tính toán, ghi DB | `apps/api/src/modules/<feature>/` |
| Màn hình cho nhân viên xưởng/văn phòng | `apps/web/src/pages/` |
| Màn hình cho khách/seller | `apps/seller/src/app/` |
| Kiểu dữ liệu cả FE và BE cùng dùng | `packages/shared/dtos/` |
| Hàm thuần mà **trình duyệt** cần chạy | `packages/shared/client/` (không được import NestJS) |

⚠️ **Sửa một DTO trong `packages/shared` là đụng cả hai app.** Luôn chạy
`pnpm build-types` (type-check toàn repo), không chỉ app bạn đang mở.

Mỗi module trong `apps/api` phải đủ bộ `module / controller / service / repository
/ entity` — 48 module hiện có đều theo khuôn này. Chi tiết:
[`apps/api/CLAUDE.md`](../../apps/api/CLAUDE.md).

### Hai app, hai thế giới người dùng

`apps/web` có ba router gốc, nhưng **chỉ hai phiên đăng nhập**:

- `/adm` — quản trị: sản phẩm, khách, cấu hình, báo cáo
- `/ffm` — vận hành xưởng: task của công nhân từng công đoạn

  Hai cái này dùng CHUNG layout và phiên nhân viên (`authStore`).

- `/customer` — cổng khách **cũ**, phiên và token RIÊNG (`customerAuthStore`,
  `RoleType.Customer`). Đang chuyển sang `apps/seller` và **đã đóng băng tính năng
  mới** — đừng thêm gì vào đây.

Ngoài ra còn vài trang public không cần đăng nhập: landing `/`, catalog
`/catalog`, tra cứu đơn `/track/:productionId`, tuyển dụng.

`apps/seller` là app Next riêng cho khách, phiên riêng, proxy same-origin về API.
Nó còn có khu `/hub` cho nhân viên quản trị toàn bộ seller.

---

## 3. Luồng xương sống — một đơn đi từ đâu tới đâu

Đây là thứ phải nắm trước khi sửa bất cứ gì liên quan tới đơn.

```
Khách đặt (portal / CSV / API)
        │
        ▼
  customer_orders          ← đơn TẠM, chưa phải đơn sản xuất
        │  "Push to production" (chốt giá, cấp mã)
        ▼
     orders                ← đơn sản xuất thật, mỗi item một dòng
        │
        ▼
  ┌─────────────────── dây chuyền 8 chặng ───────────────────┐
  │ Soát tool → Thiết kế → In → Ép → QC sau ép → May vào →   │
  │                              May ra → Đóng hàng          │
  └──────────────────────────────────────────────────────────┘
        │
        ▼
  Đóng hàng xong → gắn nhãn vận chuyển → gửi đi Mỹ
```

Hai chặng đầu (soát tool, thiết kế) làm trên máy tính; **sáu chặng sau là người
thật đứng máy** (`FulfillmentStage`: `print` → `press` → `qc-post-press` →
`sew-in` → `sew-out` → `pack`).

**Ba điều bất thường mà ai cũng vấp:**

1. **Đơn có thể đi LÙI.** Bất kỳ chặng nào phát hiện lỗi đều đẩy ngược về chặng
   trước hoặc về designer. Nên đừng viết code giả định trạng thái chỉ tiến.

2. **Một số xưởng bỏ bớt chặng.** `FactoryEntity.flowType` quyết định chặng nào
   tự động Done: xưởng gỗ TNW gộp In+Ép, xưởng Mê Linh bỏ khâu may. Code chuyển
   chặng phải hỏi `flowType`, không được chạy cứng 6 chặng.

3. **`customer_orders` và `orders` là HAI bảng khác nhau**, không phải hai trạng
   thái của một bảng. Đơn khách đặt nằm ở bảng đầu cho tới khi được đẩy sản xuất.
   Số lượng gần bằng nhau (57.610 / 57.608) nên rất dễ tưởng là một.

Chi tiết: [`Orders.md`](../FunctionDescription/Orders.md),
[`FulfillmentWorkflow.md`](../FunctionDescription/FulfillmentWorkflow.md),
[`CustomerOrderIntake.md`](../FunctionDescription/CustomerOrderIntake.md).

---

## 4. Dữ liệu

MongoDB (**bắt buộc replica set** — code dùng transaction, single node sẽ không
boot), Redis cho cache + hàng đợi BullMQ, RabbitMQ cho message.

Số thật trên production (15/09/2026), 42 collection:

| Collection | Số dòng | Là gì |
|---|---:|---|
| `orderLogs` | 3.259.313 | Nhật ký mọi thay đổi trên đơn |
| `agentApiLogs` | 419.308 | Nhật ký API cho AI agent (TTL 90 ngày) |
| `customer_orders` | 57.610 | Đơn khách đặt, chưa đẩy sản xuất |
| `orders` | 57.608 | Đơn sản xuất |
| `productConfigs` | 196 | Cấu hình sản phẩm + biến thể |
| `customers` | 168 | Seller |

`orderLogs` lớn như vậy là **cố ý**: khi một đơn giao sai, câu hỏi luôn là "ai đổi
gì lúc nào", và không có nhật ký thì không trả lời được. Đừng tắt nó để tối ưu.

---

## 5. Sáu luật ngầm sẽ cắn bạn

Đây là phần đáng đọc nhất. Tất cả đều là lỗi **đã xảy ra thật**.

### 5.1 Ba loại đơn bị loại khỏi mọi thống kê

Mặc định, mọi truy vấn thống kê phải loại:

- đơn đã hủy (`cancelledAt` có giá trị)
- đơn chưa gán xưởng (`factoryId` rỗng)
- đơn của **xưởng US** (xưởng ngoài luồng sản xuất, `excluded-factory.ts`)

Viết một aggregation mới về `orders` mà quên bộ lọc này là ra số **không khớp
dashboard**, và lệch âm thầm. Xem [`Orders.md`](../FunctionDescription/Orders.md) §19/§21.

### 5.2 Giờ Việt Nam ở mọi nơi

Ranh giới ngày/tháng là **nửa đêm giờ VN (UTC+7)**, không phải UTC. Aggregation
dùng `timezone: 'Asia/Ho_Chi_Minh'`, mốc dựng bằng `T00:00:00+07:00`. Đọc bằng UTC
thì mỗi ngày lệch 7 giờ — sai nhỏ, và vì nhỏ nên không ai phát hiện.

### 5.3 Một tiến trình, hai Nest context

`apps/api` khởi động **hai** context (HTTP + microservice RabbitMQ) trong cùng một
tiến trình, nên mọi `@Cron` đăng ký hai lần và chạy hai lần. Dòng đầu tiên trong
thân mỗi cron phải là:

```ts
if (!laTienTrinhChayCron(this.adapterHost)) return;
```

Xem [`Common_Pitfalls.md`](Common_Pitfalls.md) §11.

### 5.4 ID của hệ ngoài có thể là ID theo góc nhìn

uid Zalo **phụ thuộc nick đang nhìn**: cùng một người mang 8 uid khác nhau tuỳ nick
nào của công ty thấy họ. So hai cột cùng tên `uid` từ hai bảng khác nhau cho **0
dòng khớp**, không lỗi, không cảnh báo.

Luật chung: trước khi so hai ID từ hệ ngoài, **chứng minh chúng cùng không gian
bằng dữ liệu thật**. Khớp 0 dòng trên dữ liệu sống là bằng chứng bạn đang so nhầm,
không phải "chưa có dữ liệu". Xem [`Common_Pitfalls.md`](Common_Pitfalls.md) §12.

### 5.5 Chốt riêng tư trên dữ liệu chat

Hệ thống kéo hội thoại Zalo về để phân tích. Nhóm mang nhãn `private` **không bao
giờ** được đọc nội dung — đó là nhóm cá nhân của nhân viên. Mọi đường đọc chat đi
qua đúng một hằng số `ZALO_GROUP_ANALYZABLE_KINDS`; đừng viết truy vấn vòng qua nó.

Các chốt cho AI agent (`NHOM_DUOC_GUI`, `kiemNguoiNhanDm`) là **danh sách trắng**
— nhãn mới sinh ra sau này tự bị loại. Đừng đổi sang dạng đen.

### 5.6 Mọi chữ hiển thị phải qua i18n

`apps/web` mặc định tiếng Việt, có bản tiếng Anh. Không hardcode chuỗi — kể cả
label trong file constant. Xem [`I18n.md`](../FunctionDescription/I18n.md).

---

## 6. Chạy và triển khai

```bash
pnpm build          # LẦN ĐẦU BẮT BUỘC — build packages/shared + core trước
pnpm dev            # API + web song song
pnpm build-types    # type-check toàn repo — chạy trước khi mở PR
pnpm lint
cd apps/api && pnpm test
```

API dev ở `http://localhost:3007`, tiền tố `api/v1`. Web dev ở `:5173`.
Setup Docker (Mongo replica set + Redis + RabbitMQ): [`README.md`](../../README.md) gốc repo.

**Nhánh:** nhánh riêng → `dev` (tích hợp, máy dev tự kéo mỗi phút) → `main` (phát
hành) → prod deploy tay bằng `./deploy.sh`. Không có `master`.

**Production** chạy pm2 hai tiến trình (`onosfactory-api`, `onosfactory-seller`)
cộng ba container Docker cho engine Zalo. Chi tiết: [`Infrastructure.md`](Infrastructure.md).

---

## 7. Đọc tiếp ở đâu

| Bạn cần | Đọc |
|---|---|
| Sơ đồ container/component | [`C4_Model.md`](C4_Model.md) |
| Đăng nhập, phân quyền, `@Auth()` | [`Auth_System.md`](Auth_System.md) |
| RabbitMQ, BullMQ, cron | [`Event_Driven.md`](Event_Driven.md) |
| Triển khai, pm2, nginx | [`Infrastructure.md`](Infrastructure.md) |
| **Bug pattern đã từng xảy ra** | [`Common_Pitfalls.md`](Common_Pitfalls.md) |
| Nghiệp vụ hệ cũ OnosPod | [`OnosPodLegacy-BusinessFlows.md`](OnosPodLegacy-BusinessFlows.md) |
| Kiểm số liệu thật trên production | [`CheckProductionData.md`](CheckProductionData.md) |
| Nhãn vận chuyển (8 khuôn bắt buộc) | [`ShippingLabelPatterns.md`](ShippingLabelPatterns.md) |
| **Một tính năng cụ thể** | [`documents/FunctionDescription/`](../FunctionDescription/) — 40 file, tra bảng ở [`CLAUDE.md`](../../CLAUDE.md) gốc repo |

### Quy tắc bắt buộc khi sửa code

Mỗi tính năng có **một file doc** trong `documents/FunctionDescription/`. Sửa code
của tính năng nào thì **phải cập nhật file doc của nó trong cùng PR**. Bảng tra
"Feature → Doc" nằm ở [`CLAUDE.md`](../../CLAUDE.md) gốc repo — đọc doc trước khi
sửa, cập nhật doc sau khi sửa.

Doc lệch code thì lần sau người ta không tin doc nữa, và lúc đó nó thành rác.
