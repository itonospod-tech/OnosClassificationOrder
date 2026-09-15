# OnosFactory — Tổng quan kiến trúc

**Đối tượng:** kỹ sư mới tham gia dự án.
**Phạm vi:** bối cảnh nghiệp vụ, cấu trúc monorepo, luồng dữ liệu chính, các bất
biến xuyên suốt hệ thống.
**Không thuộc phạm vi:** đặc tả từng tính năng (xem `documents/FunctionDescription/`),
hướng dẫn cài đặt máy (xem [`README.md`](../../README.md) gốc repo).

Tài liệu này là entry point của thư mục `Architecture/`. Mỗi mục dẫn tới tài liệu
chi tiết tương ứng thay vì lặp lại nội dung.

**Cập nhật:** 15/09/2026. Số liệu đo trên production cùng ngày.

---

## 1. Bối cảnh nghiệp vụ

Onos vận hành xưởng **in theo đơn (print-on-demand)**. Khách hàng của Onos là các
nhà bán lẻ trên Etsy, TikTok Shop, Shopify; khi họ có đơn từ người mua cuối, đơn
được đẩy sang Onos. Onos sản xuất và giao thẳng tới người mua cuối tại Mỹ.

Hai đặc điểm của mô hình này chi phối phần lớn quyết định thiết kế:

**Đơn hàng là một vật thể vật lý cần gia công, không phải một giao dịch.** Đơn đi
qua dây chuyền có người thật đứng ở từng chặng; mỗi chặng có thể phát hiện lỗi và
đẩy đơn ngược về chặng trước. Hệ quả: `OrderEntity` mang nhiều cột mốc thời gian,
và bảng nhật ký `orderLogs` lớn gấp 57 lần bảng đơn (3.259.313 dòng so với 57.608).
Quy mô đó là chủ đích — khi một đơn giao sai, câu hỏi luôn là *ai đổi gì lúc nào*.

**Khách hàng của Onos đồng thời là người bán.** Họ cần cổng riêng để đặt đơn, theo
dõi tiến độ, tra giá, nạp ví và mua nhãn vận chuyển. Đây là lý do tồn tại một
application riêng (`apps/seller`) thay vì một khu vực trong app quản trị.

### 1.1 Quan hệ với hệ thống cũ

Trước OnosFactory, nghiệp vụ chạy trên **OnosPod** (`app.onospod.com`) — hệ thống
đã mất source code, chỉ còn truy cập qua API. OnosFactory bắt đầu ghi nhận đơn thật
từ **tháng 06/2026**.

Ba hệ quả cần biết trước khi viết báo cáo hoặc truy vấn lịch sử:

- Dữ liệu trước 06/2026 **không tồn tại** trong hệ thống này.
- Một phần đơn vẫn được đồng bộ từ OnosPod qua cron (`orders/import-from-onospod/cron`).
- Nghiệp vụ tài chính (hóa đơn, công nợ) vẫn nằm ở hệ cũ.

Chi tiết: [`OnosPodLegacy-BusinessFlows.md`](OnosPodLegacy-BusinessFlows.md).

### 1.2 Lưu ý thuật ngữ: "seller"

Từ *seller* mang ba nghĩa khác nhau trong codebase. Nhầm lẫn giữa chúng dẫn tới
phân quyền sai:

| Ký hiệu | Nghĩa |
|---|---|
| `apps/seller` | Application dành cho **khách hàng** của Onos |
| `RoleType.Customer` | Vai của **tài khoản khách hàng**, dùng cho `apps/seller` và Customer Portal |
| `RoleType.Seller` | Vai của **nhân viên nội bộ** phụ trách kinh doanh — không liên quan tới khách |

`ZaloGroupKind.Seller` cũng mang nghĩa "nhóm chat với khách hàng", tức khớp với
`RoleType.Customer` chứ không phải `RoleType.Seller`.

---

## 2. Cấu trúc monorepo

pnpm workspaces + Turborepo.

| Package | Quy mô | Stack | Vai trò |
|---|---:|---|---|
| `apps/api` | 410 file | NestJS + Fastify | Toàn bộ nghiệp vụ. Cổng 3007, prefix `api/v1` |
| `apps/web` | 371 file | React + Vite + Tailwind/Radix | Application nội bộ (`/adm`, `/ffm`) |
| `apps/seller` | 133 file | Next.js 16 | Application cho khách hàng. Cổng 3017 |
| `apps/design-worker` | 6 file | Node + sharp | Xử lý ảnh thiết kế, triển khai trên máy chủ riêng |
| `packages/shared` | 139 file | Zod | Hợp đồng dữ liệu dùng chung FE/BE |
| `packages/core` | 44 file | NestJS | Guard, decorator, abstract repository dùng chung |

### 2.1 Quy tắc xác định vị trí code

| Loại thay đổi | Vị trí |
|---|---|
| Nghiệp vụ, tính toán, ghi cơ sở dữ liệu | `apps/api/src/modules/<feature>/` |
| Giao diện cho nhân viên | `apps/web/src/pages/` |
| Giao diện cho khách hàng | `apps/seller/src/app/` |
| Kiểu dữ liệu dùng chung FE và BE | `packages/shared/dtos/` |
| Hàm thuần cần chạy trên trình duyệt | `packages/shared/client/` — **không được import NestJS** |

Mỗi module trong `apps/api` (hiện có 48) tuân theo cấu trúc bắt buộc
`module / controller / service / repository / entity`. Quy ước chi tiết:
[`apps/api/CLAUDE.md`](../../apps/api/CLAUDE.md).

> **Bắt buộc:** thay đổi trong `packages/shared` ảnh hưởng đồng thời cả hai
> application. Luôn chạy `pnpm build-types` (type-check toàn repo), không chỉ
> type-check package đang sửa.

### 2.2 Phân vùng người dùng trong `apps/web`

Ba router gốc, hai phiên đăng nhập độc lập:

- **`/adm`** — quản trị: sản phẩm, khách hàng, cấu hình, báo cáo.
- **`/ffm`** — vận hành xưởng: hàng việc của công nhân theo công đoạn.

  Hai router trên dùng chung layout và phiên nhân viên (`authStore`).

- **`/customer`** — Customer Portal thế hệ cũ. Phiên và token **riêng**
  (`customerAuthStore`, `RoleType.Customer`). Đang được thay thế bởi `apps/seller`
  và **đã đóng băng tính năng mới**.

Ngoài ba router trên còn các trang public không yêu cầu đăng nhập: landing `/`,
catalog `/catalog`, tra cứu đơn `/track/:productionId`, tuyển dụng.

---

## 3. Luồng dữ liệu chính: vòng đời một đơn hàng

```
Khách đặt đơn (form portal | CSV | Public Order API)
        │
        ▼
  customer_orders          staging — chưa phải đơn sản xuất
        │  pushToProduction(): chốt giá, cấp productionId
        ▼
     orders                đơn sản xuất, MỘT DÒNG cho mỗi item
        │
        ▼
  ┌──────────────────── dây chuyền 8 chặng ─────────────────────┐
  │  Soát tool → Thiết kế →                                     │
  │  In → Ép → QC sau ép → May nhận vào → May xuất ra → Đóng gói│
  └─────────────────────────────────────────────────────────────┘
        │
        ▼
  Gắn nhãn vận chuyển → giao tới người mua cuối
```

Hai chặng đầu thực hiện trên máy tính. Sáu chặng sau do công nhân thực hiện tại
xưởng, định nghĩa ở enum `FulfillmentStage`:
`print` → `press` → `qc-post-press` → `sew-in` → `sew-out` → `pack`.

### 3.1 Ba đặc điểm cần nắm trước khi sửa code liên quan tới đơn

**Trạng thái đơn không đơn điệu tăng.** Bất kỳ chặng nào phát hiện lỗi đều có thể
đẩy đơn ngược về chặng trước hoặc về designer. Không được giả định đơn chỉ tiến.

**Không phải xưởng nào cũng chạy đủ 6 chặng.** `FactoryEntity.flowType` xác định
tập chặng được **tự động hoàn thành** khi đơn chảy tới. Cấu hình thực tế:

| Xưởng | `flowType` | Ý nghĩa |
|---|---|---|
| TN — Thái Nguyên | `standard` | Chạy đủ 6 chặng |
| TNW — Gỗ Thái Nguyên | `merged` | In xong thì Ép tự Done; May vào xong thì May ra tự Done |
| ML — Mê Linh · MLDTF — DTF Mê Linh | `no-sew` | QC sau ép xong thì hai chặng may tự Done |
| US — Xưởng US | *(không đặt)* | Nằm ngoài luồng sản xuất, xem §5.1 |

Logic chuyển chặng phải đọc `flowType`; không được hard-code chuỗi 6 chặng.

**`customer_orders` và `orders` là hai collection độc lập**, không phải hai trạng
thái của cùng một bảng. `customer_orders` chứa mảng `items[]`; `pushToProduction()`
sinh ra một document `orders` cho **mỗi item**.

Số đo hiện tại dễ gây hiểu nhầm là quan hệ 1:1:

| Chỉ số | Giá trị |
|---|---:|
| `customer_orders` | 57.610 |
| Tổng số item | 57.610 (trung bình **1,00** item/đơn) |
| Đã đẩy sản xuất | 57.608 |
| `orders` | 57.608 |

Tỉ lệ 1,00 item/đơn là **đặc điểm của dữ liệu di cư từ hệ cũ**, không phải ràng
buộc thiết kế. Đơn nhiều item được hỗ trợ đầy đủ (CSV cho phép nhiều dòng cùng
`order_id`), nên code không được giả định một đơn khách sinh ra đúng một đơn sản xuất.

Tài liệu chi tiết: [`Orders.md`](../FunctionDescription/Orders.md),
[`FulfillmentWorkflow.md`](../FunctionDescription/FulfillmentWorkflow.md),
[`CustomerOrderIntake.md`](../FunctionDescription/CustomerOrderIntake.md).

---

## 4. Tầng lưu trữ

| Thành phần | Vai trò | Ràng buộc |
|---|---|---|
| MongoDB | Cơ sở dữ liệu chính, 42 collection | **Bắt buộc replica set** — hệ thống dùng transaction (ví seller, sổ cái thanh toán) |
| Redis | Cache + hàng đợi BullMQ | Cache cấu hình có TTL 1 giờ (xem §5.6) |
| RabbitMQ | Message broker | Thiếu biến môi trường thì application không khởi động |

Quy mô các collection chính trên production:

| Collection | Số document | Nội dung |
|---|---:|---|
| `orderLogs` | 3.259.313 | Nhật ký thay đổi trên đơn |
| `agentApiLogs` | 419.308 | Nhật ký API cho AI agent, TTL 90 ngày |
| `customer_orders` | 57.610 | Đơn khách, tầng staging |
| `orders` | 57.608 | Đơn sản xuất |
| `productConfigs` | 196 | Cấu hình sản phẩm và biến thể |
| `customers` | 168 | Tài khoản khách hàng |

`apps/design-worker` ghi MongoDB **trực tiếp qua Tailscale** với schema tối giản,
không đi qua API.

---

## 5. Bất biến xuyên suốt hệ thống

Các quy tắc trong mục này áp dụng cho nhiều module. Mỗi quy tắc tương ứng với một
lỗi đã xảy ra trên production.

### 5.1 Bộ lọc mặc định của truy vấn đơn hàng

Mọi truy vấn thống kê trên `orders` phải loại trừ ba nhóm:

- đơn đã hủy — `cancelledAt` có giá trị;
- đơn chưa gán xưởng — `factoryId` rỗng;
- đơn thuộc xưởng US — xưởng nằm ngoài luồng sản xuất, định nghĩa tại
  `apps/api/src/utils/excluded-factory.ts`.

Aggregation mới thiếu bộ lọc này sẽ cho kết quả lệch so với dashboard, và lệch một
cách âm thầm. Chi tiết: [`Orders.md`](../FunctionDescription/Orders.md) §19, §21.

### 5.2 Múi giờ

Ranh giới ngày và tháng là **nửa đêm giờ Việt Nam (UTC+7)**, không phải UTC.
Aggregation dùng `timezone: 'Asia/Ho_Chi_Minh'`; mốc thời gian dựng bằng
`new Date('YYYY-MM-DDT00:00:00+07:00')`. Tính theo UTC gây lệch 7 giờ mỗi ngày —
sai số nhỏ, do đó khó phát hiện.

### 5.3 Một process, hai Nest context

`apps/api/src/main.ts` khởi động **hai** application context trong cùng một process:
`bootstrap()` (HTTP/Fastify) và `bootstrapMicroservice()` (RabbitMQ). Hệ quả: mọi
`@Cron` được đăng ký hai lần và thực thi hai lần.

Dòng đầu tiên trong thân mỗi cron handler phải là:

```ts
if (!laTienTrinhChayCron(this.adapterHost)) return;
```

Chi tiết: [`Common_Pitfalls.md`](Common_Pitfalls.md) §11.

### 5.4 Định danh từ hệ thống ngoài có thể phụ thuộc góc nhìn

Định danh do hệ thống bên thứ ba cấp không nhất thiết là định danh toàn cục. Ví dụ
đã gặp: uid Zalo **phụ thuộc tài khoản đang truy vấn** — cùng một người mang 8 uid
khác nhau tùy theo nick nào của công ty nhìn thấy họ. So sánh hai cột cùng tên `uid`
lấy từ hai bảng khác nhau cho kết quả khớp 0 dòng, không phát sinh lỗi.

Quy tắc: trước khi so sánh hai định danh từ hệ thống ngoài, **xác minh chúng thuộc
cùng không gian định danh bằng dữ liệu thật**. Kết quả khớp 0 dòng trên dữ liệu
production là bằng chứng của phép so sánh sai, không phải của việc thiếu dữ liệu.

Chi tiết: [`Common_Pitfalls.md`](Common_Pitfalls.md) §12.

### 5.5 Chốt riêng tư trên dữ liệu hội thoại

Hệ thống thu thập hội thoại Zalo phục vụ phân tích. Nhóm mang phân loại `private`
là nhóm cá nhân của nhân viên và **không bao giờ** được đọc nội dung.

Mọi truy vấn đọc nội dung chat phải đi qua hằng số `ZALO_GROUP_ANALYZABLE_KINDS`.
Các chốt dành cho AI agent (`NHOM_DUOC_GUI`, `kiemNguoiNhanDm`) được cài đặt dưới
dạng **danh sách trắng**, nhờ đó phân loại mới bổ sung về sau tự động bị loại trừ.
Không chuyển các chốt này sang dạng danh sách đen.

### 5.6 Cache cấu hình

`SystemConfigService.get()` cache blob cấu hình trong Redis với TTL **1 giờ**.
Phương thức `set()` tự xóa cache; thao tác ghi thẳng vào collection `system_configs`
thì không. Bỏ qua bước xóa cache dẫn tới cấu hình mới không có hiệu lực trong tối
đa một giờ, và không phát sinh lỗi nào.

### 5.7 Đa ngữ

`apps/web` mặc định tiếng Việt, có bản tiếng Anh. Không hard-code chuỗi hiển thị,
kể cả trong module-scope constant. Chi tiết: [`I18n.md`](../FunctionDescription/I18n.md).

---

## 6. Môi trường và triển khai

### 6.1 Lệnh thường dùng

```bash
pnpm build          # BẮT BUỘC chạy lần đầu — build packages/shared và core
pnpm dev            # chạy song song API và web
pnpm build-types    # type-check toàn repo — chạy trước khi mở PR
pnpm lint
cd apps/api && pnpm test
```

API dev: `http://localhost:3007`, prefix `api/v1`. Web dev: `http://localhost:5173`.
Thiết lập Docker (MongoDB replica set, Redis, RabbitMQ): [`README.md`](../../README.md) gốc repo.

### 6.2 Mô hình nhánh

```
nhánh tính năng → dev (tích hợp) → main (phát hành) → production
```

Máy dev tự động pull nhánh `dev` mỗi phút. Deploy production thực hiện thủ công
bằng `./deploy.sh`. Repository không có nhánh `master`.

### 6.3 Production

Hai process pm2 (`onosfactory-api`, `onosfactory-seller`) và ba container Docker
phục vụ engine Zalo. Chi tiết: [`Infrastructure.md`](Infrastructure.md).

---

## 7. Tài liệu liên quan

| Chủ đề | Tài liệu |
|---|---|
| Sơ đồ context, container, component | [`C4_Model.md`](C4_Model.md) |
| Xác thực, phân quyền, decorator `@Auth()` | [`Auth_System.md`](Auth_System.md) |
| RabbitMQ, BullMQ, hệ thống cron | [`Event_Driven.md`](Event_Driven.md) |
| Triển khai, pm2, nginx, Docker | [`Infrastructure.md`](Infrastructure.md) |
| Bug pattern đã xảy ra, kèm root cause | [`Common_Pitfalls.md`](Common_Pitfalls.md) |
| Nghiệp vụ hệ thống cũ OnosPod | [`OnosPodLegacy-BusinessFlows.md`](OnosPodLegacy-BusinessFlows.md) |
| Quy trình kiểm chứng số liệu production | [`CheckProductionData.md`](CheckProductionData.md) |
| Nghiệp vụ nhãn vận chuyển | [`ShippingLabelPatterns.md`](ShippingLabelPatterns.md) |
| Đặc tả từng tính năng (40 tài liệu) | [`documents/FunctionDescription/`](../FunctionDescription/) |

### 7.1 Quy ước bắt buộc về tài liệu

Mỗi tính năng có một tài liệu tương ứng trong `documents/FunctionDescription/`.
Thay đổi code của một tính năng **bắt buộc kèm cập nhật tài liệu của tính năng đó
trong cùng pull request**.

Bảng tra cứu "Feature → Doc" nằm tại [`CLAUDE.md`](../../CLAUDE.md) gốc repo: đọc
tài liệu trước khi sửa, cập nhật sau khi sửa.
