# Ưu tiên gán xưởng theo khách hàng — Function Description

> **File FE:** `apps/web/src/pages/settings/index.tsx` + `apps/web/src/components/settings/CustomerAssignmentConfig.tsx` + `apps/web/src/components/settings/CustomerPriorityConfig.tsx` (§8) + `apps/web/src/components/settings/CustomerFactoryKanban.tsx` (kanban khách dùng chung, prop `columns`) + `apps/web/src/services/customer.ts` (CRUD khách đã HỢP NHẤT về trang `/adm/customers` — xem `Customers.md`) + `apps/web/src/services/customerAssignment.ts` > **File BE:** `apps/api/src/modules/customer/` (entity + repository + service + controller + module) + `apps/api/src/modules/customer-assignment/` (service + controller + module) + `apps/api/src/modules/order/order.service.ts` → hook trong `importOrders` > **Route:** `/adm/settings/customer-factory` (mục "Gán xưởng theo khách") + `/adm/settings/customer-priority` (mục "Ưu tiên đơn theo khách", §8) trong Settings, gate quyền `role.manage`
> **API:** `GET/POST /v1/customers`, `POST /v1/customers/sync`, `PATCH /v1/customers/:id/tier`, `POST /v1/customers/import-tiers`, `GET/PUT /v1/customer-assignment/config`, `GET/PUT /v1/customer-assignment/priority-config` (§8)

## 1. Overview

Thêm một **tầng ưu tiên gán xưởng theo khách hàng**, đứng **trên** việc map xưởng
theo product config lúc **import đơn mới**.

- **Công tắc bật/tắt** (`enabled`):
  - **Tắt** → import lấy `factoryId` theo product config như cũ.
  - **Bật** → mỗi đơn, nếu cặp **(userSku, userEmail)** khớp một khách đã gán trong
    config → **ép `factoryId`** theo xưởng của khách, **bỏ qua** factory của product
    config. Khách **không** được gán → **vẫn rơi về product config**.
- **Bất biến:** 1 khách chỉ thuộc **1 xưởng** (validate BE lúc lưu + FE lúc chọn).
- **Chỉ ép `factoryId`** — `machineTypeId / fabricType / toolResult / machineNumber`
  vẫn lấy từ product config của sản phẩm. Áp cả đơn **chưa map** product config.
- Khóa nhận diện khách = **cặp (userSku, userEmail)** — hàm `customerMatchKey`
  (userSku nguyên văn đã trim; email so sánh không phân biệt hoa/thường).

Chưa có bảng khách hàng sẵn → có nút **Sync** quét `orders` gom distinct
(userSku, userEmail) và nút **Thêm** khách thủ công.

### Tier khách hàng (VIP 0..5 + khách lẻ)

Mỗi khách có thể có **tier VIP 0 → VIP 5** (6 mức, badge màu); `tier = null` =
**khách lẻ** (chưa xếp hạng — mặc định mọi khách). Tier hiện **chỉ để hiển thị /
quản lý** (chưa ảnh hưởng logic gán xưởng hay ưu tiên đơn). Xem/sửa qua nút
**Danh sách khách** (dialog bảng khách: search + filter theo tier + đổi tier từng
khách) và **Import tier** hàng loạt từ file `TÊN TÀI KHOẢN | VIP n`.

## 2. Luồng hoạt động

1. Admin vào `/settings` → section "Ưu tiên gán xưởng theo khách hàng".
2. **Sync khách hàng** (`POST /v1/customers/sync`): quét `orders`, upsert distinct
   cặp (userSku, userEmail) vào `customers`. **Chỉ thêm mới**, không xóa khách cũ /
   khách nhập tay.
3. (Tùy chọn) **Thêm khách** thủ công (`POST /v1/customers`, `source='manual'`).
4. Bật công tắc + chọn khách cho từng xưởng → **Lưu** (`PUT /v1/customer-assignment/config`).
5. Khi **import đơn mới** (`importOrders`): nếu config bật → dựng map
   `customerMatchKey → factoryId` (1 lần trước vòng lặp); mỗi đơn khớp → ép `factoryId`.

## 3. API / Schema

| Method | Path                             | Auth             | Mô tả                                                                                                              |
| ------ | -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/customers`                  | `@Auth([Admin])` | Danh sách khách (query `search` optional)                                                                          |
| POST   | `/v1/customers`                  | `@Auth([Admin])` | Thêm khách thủ công (userSku + userEmail)                                                                          |
| POST   | `/v1/customers/sync`             | `@Auth([Admin])` | Sync từ orders → `{ scanned, created, existing, total }`                                                           |
| PATCH  | `/v1/customers/:id/tier`         | `@Auth([Admin])` | Sửa tier 1 khách (`{ tier: 0..5 \| null }`, null = khách lẻ)                                                       |
| POST   | `/v1/customers/import-tiers`     | `@Auth([Admin])` | Import tier hàng loạt (`{ rows: [{userSku, tier}] }`, max 2000) → `{ matchedSkus, updatedCustomers, skippedSkus }` |
| GET    | `/v1/customer-assignment/config` | `@Auth([Admin])` | Lấy cấu hình                                                                                                       |
| PUT    | `/v1/customer-assignment/config` | `@Auth([Admin])` | Lưu (validate 1-khách-1-xưởng)                                                                                     |
| GET    | `/v1/customer-assignment/priority-config` | `@Auth([Admin])` | Lấy cấu hình ưu tiên đơn theo khách (§8)                                                                  |
| PUT    | `/v1/customer-assignment/priority-config` | `@Auth([Admin])` | Lưu cấu hình ưu tiên đơn theo khách (validate 1-khách-1-mức, §8)                                          |

Collection `customers`: `{ userSku, userEmail, source: 'sync'|'manual'|'register', tier: number|null, password, fullName, phone, status }`,
**unique index `{ userSku: 1, userEmail: 1 }`**. Zod: `CustomerTierZod`
(int 0..5, coerce) + constants `CUSTOMER_TIERS` / `CUSTOMER_TIER_MIN/MAX` +
`UpdateCustomerTier*` / `ImportCustomerTiers*` DTOs + Portal auth DTOs
(`CustomerRegister*` / `CustomerLogin*` / `GetCustomerMe*`). Từ khi có Customer
Portal (xem [`CustomerPortal.md`](CustomerPortal.md)), bảng này dùng CHUNG cho cả
mục đích dedup gán xưởng + tier VIP VÀ tài khoản đăng nhập khách hàng — record
tạo qua sync/thêm tay có `password=''` (chưa đăng ký), `userSku` không còn bắt
buộc (khách tự đăng ký có thể chưa có lịch sử đơn hàng).

Config lưu blob JSON trong `system_configs` (key `customer_assignment_config`,
Redis-cache 1h). Shared DTO `packages/shared/dtos/customer.dto.ts` +
`customer-assignment.dto.ts`:

```ts
CustomerAssignmentConfig = {
  enabled: boolean;
  factories: Array<{ factoryId: string; customerIds: string[] }>;
  updatedAt?: string;
}
customerMatchKey(userSku, userEmail) // khóa so khớp chung BE/FE
```

Constant `CUSTOMER_ASSIGNMENT_CONFIG_KEY = 'customer_assignment_config'`.

## 4. UI Components

`CustomerAssignmentConfig.tsx`:

- Mount: `factory.getFactories()` + `customer.list()` + `customerAssignment.getConfig()`.
- Header + nút **Lưu** (kèm chip cam "● Chưa lưu" khi dirty). Thanh công cụ:
  `ui/switch` bật/tắt + nút link **Mở trang Khách hàng** → `/adm/customers`
  (Sync / Thêm tay / Danh sách / Import tier đã DỜI hết sang trang đó — xem
  `Customers.md`; `CustomerListDialog.tsx` đã xóa).
- Gán khách ↔ xưởng bằng **kanban kéo thả** (`CustomerFactoryKanban.tsx`, xem dưới).
- **Dirty tracking**: `snapshot(enabled, alloc)` (sort ids + bỏ xưởng rỗng) so với
  `baseline` (set lúc load + sau save). Khi dirty: `beforeunload` (đóng tab/reload
  → confirm mặc định browser) + capture-phase click listener trên `a[href]`
  (`window.confirm`) chặn điều hướng trong app — BrowserRouter không có API block.
- Stack FE thực tế là shadcn `ui/*` + lucide (KHÔNG dùng antd).
- **Lưu** → `saveConfig({ enabled, factories })` (chỉ gửi xưởng có ≥ 1 khách) →
  cập nhật baseline.

`CustomerFactoryKanban.tsx` (thay grid MultiSelectFilter cũ):

- Cột đầu **"Chưa gán"** (`UNASSIGNED_COL='__unassigned__'`, khách không nằm trong
  alloc nào) + 1 cột / xưởng. Grid `xl:grid-cols-4`, mỗi cột cao cố định
  `h-[70vh]` scroll riêng, hiện toàn bộ khách. Section này đặt TRÊN
  `DesignerAssignmentConfig` trong `/settings` (`pages/settings/index.tsx`).
- Mỗi khách 1 card: userSku + email + `TierBadge` (import từ `@/components/common/TierBadge`).
- **Sort trong cột**: có tier lên đầu theo **VIP 0 → VIP 5** (`tierRank`, khách lẻ
  rank 999 xuống cuối), cùng nhóm xếp A→Z theo userSku. Thứ tự trong cột KHÔNG
  lưu — luôn auto-sort.
- **Search 1 ô cho mọi cột** (userSku/email, client-side); card không khớp bị ẩn,
  header cột hiện `khớp/tổng`.
- DnD: `@dnd-kit/core` (`useDraggable` card + `useDroppable` cột + `DragOverlay`,
  PointerSensor distance 4 — cùng pattern kanban Fulfillment). Kéo tự do giữa mọi
  cột; thả vào cột → `onMove(customerId, factoryId|null)` → parent gỡ khách khỏi
  mọi list rồi thêm vào đích (tự đảm bảo 1 khách 1 xưởng). Thay đổi chỉ trong
  state, phải bấm **Lưu** mới ghi config.

**Danh sách khách / đổi tier / Import tier** — đã HỢP NHẤT về trang
`/adm/customers` (xem `Customers.md` §4): bảng khách + `TierBadge` đổi nhanh
(`PATCH /customers/:id/tier`) nằm ở trang mới; flow Import tier tách thành
`pages/customers/ImportTiersDialog.tsx` (giữ nguyên parse `parseTierText`/
`parseTierGrid` + i18n keys `customerListDialog.import.*` của namespace này).
`CustomerListDialog.tsx` đã XÓA.

## 5. Backend logic

### 5.1 `CustomerService`

- `list(dto)`: filter `search` regex trên userSku/userEmail, sort userSku.
- `create(dto)`: normalize (email lowercase+trim); chặn trùng cặp → `BadRequest`;
  `source='manual'`.
- `sync()`: aggregate `orders` `$group` theo `{ userSku, $toLower(userEmail) }`
  (bỏ userSku rỗng) → `bulkWrite` upsert `$setOnInsert` (không đụng bản ghi cũ).
- `updateTier(id, dto)`: `findByIdAndUpdate` set `tier` (null = khách lẻ) → 404 nếu không có.
- `importTiers(dto)`: dedupe SKU trong file (dòng sau thắng) → load toàn bộ
  `userSku` hiện có, dựng map `lower(sku) → các sku thật` → mỗi SKU khớp
  (KHÔNG phân biệt hoa/thường) 1 op `updateMany({userSku ∈ actual}, {$set:{tier}})`
  qua bulkWrite (gán cho MỌI email trùng SKU); SKU không có → `skippedSkus`,
  **không tự tạo khách mới**.

### 5.2 `CustomerAssignmentService`

- `getConfig()` / `saveConfig(dto)` — validate 1 `customerId` không ở ≥ 2 xưởng
  (và không lặp trong cùng xưởng) → `BadRequest`. Lưu `system_configs`.
- `getImportOverride()`: nếu `!enabled` → `{ enabled:false, map:empty }`. Ngược lại
  fetch customers theo `customerIds`, dựng `Map<customerMatchKey, factoryId>`.
- Tra khách theo id dùng `CustomerRepository.findMatchRowsByIds()` (dùng chung với
  `getPriorityImportOverride`/`getPriorityCustomers` và mức 1 auto-gán designer theo
  khách ở `order.service.ts`). Khách tạo qua `customers/sync` (bulkWrite upsert) có
  `_id` **ObjectId** trong DB, còn schema khai `_id: String` → query qua Mongoose
  không bao giờ khớp và cấu hình bị bỏ qua im lặng (lỗi gặp 20/11/2026 với khách
  FFMTEEZ). Hàm đi thẳng collection, khớp cả chuỗi lẫn ObjectId, bỏ khách đã xoá mềm.
- DTO lưu cấu hình: `customerIds` dùng `RefIDZod` (không ép 16 ký tự) ở cả 3 cấu hình
  theo khách (gán xưởng, ưu tiên, designer mức 1) — `IDZod` cũ trả 400 khi lưu khách
  có `_id` ObjectId 24 hex.

### 5.3 Hook trong `OrderService.importOrders`

- Trước vòng lặp: `const customerOverride = await customerAssignmentService.getImportOverride()`.
- Trong loop, sau đoạn map product config: nếu `enabled` & khớp
  `customerMatchKey(row.userSku, row.userEmail)` → `factoryId = forced`. Đoạn tính
  `factoryCount` / `data.factoryId` / `originalFactoryId` dùng `factoryId` đã ép.

## 6. Performance notes

- Config cache Redis 1h → đọc gần free ở hook import.
- Import: `getImportOverride` = 1 `getConfig` (cache) + 1 `find` customers (chỉ khi
  bật). Map dựng 1 lần, match O(1) mỗi dòng.
- Sync: 1 aggregate distinct + 1 bulkWrite upsert (nút bấm thủ công).

## 7. Permissions

- Cấu hình + customers CRUD: `@Auth([Admin])`.
- **FE gate = `adminOnly: true`** ở registry `pages/settings/index.tsx`, KHÔNG phải `perm: 'role.manage'`. Manager có `role.manage` nên trước đây vẫn thấy mục trong menu Cài đặt, mở ra thì mọi API trả 403 và trang hiện RỖNG y hệt trạng thái "chưa cấu hình gì" (không toast, không thông báo) — hiểu nhầm là hệ thống chưa cấu hình phân bổ tự động. Áp cùng cách cho "Ưu tiên đơn theo khách", "Tự động gán designer" và "Gửi thông báo khách hàng" (đều `@Auth([Admin])`). "Gán xưởng theo sản phẩm" giữ `role.manage` vì BE cho phép Manager thật.
- 2 trang kanban còn chốt `baseline` trong nhánh `catch` lúc load: load hỏng (403/network) mà không chốt thì cờ "• Chưa lưu" tự bật ngay khi mở và chặn rời trang dù người dùng chưa thao tác gì.
- Ép xưởng chạy server-side trong `importOrders` theo actor import.

## 8. Ưu tiên đơn theo khách hàng

Tab Settings riêng **"Ưu tiên đơn theo khách"** (`/adm/settings/customer-priority`,
component `CustomerPriorityConfig.tsx`, gate `role.manage`) — kéo khách vào 1
trong **3 cột mức ưu tiên** (`OrderPriority` 1=Ưu tiên / 2=Ưu tiên cao / 3=Ưu
tiên nhất, xem `Orders.md §17`), lúc **import đơn** (tay lẫn tự động — cùng đi
qua `importOrders`) đơn khớp khách được **auto-gán `priority`** đó.
Mức 4 "Làm ngay" KHÔNG có cột ở đây — chỉ hệ thống ghi thẳng DB
(`ORDER_PRIORITIES_SETTABLE` dựng cột, `CustomerPriorityAllocZod` chặn 4 ở BE —
xem `Orders.md §17.1`).

### 8.1 Quy tắc gán (chốt với user)

- **CHỈ gán khi đơn chưa có `priority`**: đơn mới luôn được gán; đơn cũ
  re-import mà chưa ai set thì được điền; đơn đã chỉnh tay **không bao giờ bị
  đè** (config đổi mức cũng không đè đơn đã có priority).
- **KHÔNG backfill** đơn đang chạy khi lưu config — chỉ áp cho đơn import từ
  lúc đó trở đi.
- Khách ở cột **"Chưa gán"** → đơn thường (không badge/estimate, xếp sau).
- **Bất biến:** 1 khách chỉ thuộc 1 mức (validate BE `savePriorityConfig` + FE
  kanban tự gỡ khỏi cột cũ khi thả).
- **Độc lập với tier VIP 0..5** — tier chỉ để hiển thị + sort card trong cột
  (VIP 0→5 lên đầu, khách lẻ cuối, như kanban gán xưởng).

### 8.2 Schema / BE

Config blob `system_configs` key `CUSTOMER_PRIORITY_CONFIG_KEY =
'customer_priority_config'` (cache Redis 1h qua `SystemConfigService`), shared
DTO trong `packages/shared/dtos/customer-assignment.dto.ts`:

```ts
CustomerPriorityConfig = {
  enabled: boolean;
  levels: Array<{ priority: OrderPriority; customerIds: string[] }>;
  updatedAt?: string;
}
```

`CustomerAssignmentService` (mirror 3 hàm của config gán xưởng):
`getPriorityConfig()` / `savePriorityConfig()` (validate 1-khách-1-mức) /
`getPriorityImportOverride()` → `Map<customerMatchKey, OrderPriority>`.

Hook `OrderService.importOrders`: đọc `priorityOverride` 1 lần trước loop
(cạnh `customerOverride` gán xưởng); mỗi row tính `forcedPriority` theo
`customerMatchKey(row.userSku, row.userEmail)`; projection `beforeDoc` thêm
`priority: 1`, và chỉ khi `beforeDoc?.priority == null` mới thêm `priority`
vào `data` **trước** upsert — nhờ vậy diff log import tự ghi lại thay đổi
(`before: null → after: <mức>`) trong Order Log, không cần code log riêng.

### 8.3 UI

`CustomerPriorityConfig.tsx` — copy pattern `CustomerAssignmentConfig.tsx`:
switch bật/tắt + nút Sync khách hàng + nút Lưu + chip "● Chưa lưu" + dirty
guard (beforeunload + chặn click link). Kanban tái dùng
`CustomerFactoryKanban.tsx` — component đã generalize nhận prop
`columns: CustomerKanbanColumnDef[]` (`{ id, title, shortName?, icon? }`,
cột "Chưa gán" luôn tự thêm ở đầu): tab gán xưởng truyền danh sách xưởng, tab
này truyền 3 mức từ `ORDER_PRIORITIES` với icon `Flag` màu theo
`buildPriorityMeta` (`PrioritySelectCell.tsx` — xanh lam/vàng/đỏ, label từ
namespace `orders` key `priority.*`). i18n namespace mới `customerPriority`
(vi+en) + key nav `auth.settings.nav.customerPriority`.
