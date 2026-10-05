# Auth & Identity — Function Description

> **File FE:** `apps/web/src/pages/login/index.tsx`, `apps/web/src/store/authStore.ts`
> **File BE:** `apps/api/src/modules/auth/`, `user/`, `role/`, `custom-role/`, `permission/`, `departments/`
> **Route:** `/adm/login`
> **API:** `/v1/auth/*`
>
> Đây là auth cho **nhân viên** (staff). Khách hàng dùng hệ thống riêng —
> `RoleType.Customer` + JWT branch trong `JwtStrategy` — xem [`CustomerPortal.md`](CustomerPortal.md).

---

## 1. Overview

Module Auth bao gồm toàn bộ luồng xác thực + phân quyền của hệ thống, kế thừa từ OnosFactory base và **giữ lại sau khi cleanup** (các module business khác đã xóa). Bao gồm:

- **Auth flow** — login bằng email/password, JWT access + refresh token
- **User** — CRUD user, gán role + custom role + department
- **Role** — fixed enum (SuperAdmin / Admin / Manager / User)
- **Custom Role** — role tự định nghĩa, gắn permissions
- **Permission** — danh sách permission constants từ `shared` package
- **Department** — phòng ban, gắn cho user

---

## 2. Luồng Login

```
User vào /adm/login
  → Form shadcn (email + password + checkbox "Ghi nhớ đăng nhập") + react-hook-form + zod
  → Submit → POST /v1/auth/login { email, password, rememberMe, recaptchaToken:'' }
  → BE: validateHash(password, user.password) (bcryptjs) [+ MASTER_PASSWORD nếu bật]
  → BE trả: { userId, accessToken, expiresIn, user }
  → FE: setToken(accessToken, rememberMe) → setTokenExpiredAt(now + expiresIn*1000)
       → setProfile(user) → GET /v1/auth/me lấy profile kèm role.permissionCodes
  → Redirect: role Designer → /ffm/my-tasks, còn lại → PATHS.HOME
```

### 2.1 Mật khẩu mặc định (seed)
- Admin: `admin@onos.com` / `Admin@123456`
- ⚠️ Bcrypt → bcryptjs migration đã xong (tránh native binding fail trên macOS arm64)

### 2.2 Refresh token
- **Hiện KHÔNG dùng refresh token** — `createRefreshToken()` và các call-site đã comment lại trong
  `auth.service.ts` / `auth.controller.ts`. Phiên chỉ sống bằng accessToken; hết hạn là phải đăng nhập lại.
- TTL accessToken lấy từ env: `JWT_EXPIRATION_TIME` (86400s = 24h) và
  `JWT_REMEMBER_EXPIRATION_TIME` khi tick ghi nhớ (optional env, **mặc định 30 ngày**).
- `JwtStrategy` chỉ verify chữ ký + `exp` rồi load user từ DB — **không** đối chiếu Redis,
  nên restart API/Redis không làm mất phiên.

### 2.3 "Ghi nhớ đăng nhập" (remember me)

Áp dụng cho **cả 2 cổng**: nhân viên (`authStore`) và Customer Portal (`customerAuthStore`).
Hạ tầng dùng chung: `apps/web/src/store/sessionPersist.ts`.

| Lớp | remember = **true** | remember = **false** |
|-----|--------------------|----------------------|
| BE — TTL accessToken | `JWT_REMEMBER_EXPIRATION_TIME` (mặc định 30 ngày) | `JWT_EXPIRATION_TIME` (24h) |
| FE — nơi persist blob zustand | `localStorage` | `sessionStorage` |
| Đóng hẳn trình duyệt | **giữ đăng nhập** | mất phiên → phải đăng nhập lại |
| Prefill lần sau | nhớ email + tick sẵn checkbox | không nhớ gì |

Chi tiết cơ chế:

- **Marker `onosfactory-remember-me`** (`…-customer-remember-me`) sống riêng ở `localStorage` vì
  phải đọc được TRƯỚC khi biết route blob vào storage nào. `setToken()` ghi marker **trước** `set()`.
  `storage.setItem` luôn dọn storage còn lại → không bao giờ sót 2 bản phiên.
- **`partialize`** — chỉ persist `token` / `tokenExpiredAt` / `profile`. `loading` là state tức thời,
  persist nó thì reload đúng lúc đang loading sẽ rehydrate `loading = true` vĩnh viễn.
- **Dọn phiên hết hạn lúc boot** — `onRehydrateStorage`: `tokenExpiredAt <= now` → `resetSession()`
  (xóa state + cả 2 storage + marker). `resetSession()` **không** điều hướng; `clearToken()` =
  `resetSession()` + `window.location.href = PATHS.LOGIN` (dùng cho logout / 401).
  KHÔNG dọn trong `getToken()` vì hàm đó chạy trong lúc render (`isAuthenticated`) và trong axios interceptor.
- **Chuyền phiên sang tab mới (session handoff)** — `sessionStorage` là *per-tab*, nên phiên
  "không ghi nhớ" mở tab mới sẽ trắng và bị đá về trang đăng nhập. `main.tsx` khi khởi động:
  1. `serveSessionHandoff()` — tab đang có phiên lắng nghe `storage` event để chuyền blob.
  2. `requestSessionHandoff()` — tab mới hỏi, chờ tối đa **1500ms**. Chỉ hỏi khi hội đủ 4 điều kiện:
     tab này chưa có phiên THẬT, không ở chế độ ghi nhớ, marker = `'0'`, và có cờ
     `<store>:alive` (đang có tab giữ phiên).

     Hai cái bẫy đã trả giá ở đây, đừng vặn ngược:
     - **Ngân sách phải rộng.** Bản đầu chờ 150ms và hụt 5/6 lần: `storage` event của tab trả lời bị
       xếp hàng sau việc load/parse app của chính tab mới, timer nổ trước. (Đo riêng khi main thread
       rảnh thì tab kia trả lời trong ~1ms — bên trả lời không có lỗi gì.)
     - **Phải kiểm tra phiên THẬT, không phải sự tồn tại của key.** zustand `persist` ghi blob RỖNG
       (`token: null`) ngay khi hydrate, nên tab từng hụt sẽ có key; nếu chỉ xét `getItem() != null`
       thì tab đó **không bao giờ hỏi lại** và kẹt vĩnh viễn ở màn đăng nhập dù tab khác vẫn đăng nhập.
       `hasSession()` parse blob và xét `state.token`.

     Cờ `<store>:alive` bật khi có tab ghi phiên không-ghi-nhớ (`storage.setItem`) hoặc khi tab đang
     giữ phiên khởi động (`serveSessionHandoff`); tắt khi `clearAll()` (đăng xuất/hết hạn) và khi một
     lần hỏi hết giờ mà không ai trả lời (cờ rác của phiên đã đóng). Nhờ đó người đã đăng xuất không
     phải chờ tí nào; trường hợp xấu nhất là **đúng 1 lần** chờ ~1.5s sau khi mở lại trình duyệt, rồi
     cờ rác bị dọn và các lần sau tức thì.
  3. Hydrate 2 store (đang bật **`skipHydration: true`**) rồi mới `ReactDOM.render` → lần render đầu
     đã biết chính xác còn đăng nhập hay không, không chớp trang login.

  Đóng HẾT tab ⇒ không ai trả lời ⇒ phiên mất — vẫn đúng ngữ nghĩa "không ghi nhớ".
  ⚠️ Vì `skipHydration`, **mọi store auth mới thêm cũng phải được `rehydrate()` trong `main.tsx`**.
- **Prefill email** — `onosfactory-remembered-email` (`…-customer-remembered-email`): chỉ ghi khi
  đăng nhập có tick ghi nhớ, **không bao giờ lưu mật khẩu**, và **không** bị `resetSession()` xóa
  (đăng xuất là kết thúc phiên, không phải quên người dùng). Lần sau vào trang login: điền sẵn email + tick sẵn.

---

## 3. Backend modules

### 3.1 `auth/`
| File | Mô tả |
|------|-------|
| `auth.controller.ts` | `/login`, `/register`, `/refresh`, `/logout`, `/me` |
| `auth.service.ts` | Login logic, JWT sign, refresh rotation |
| `auth.module.ts` | JwtModule + PassportModule config |

### 3.2 `user/`
- CRUD user
- Field: `email`, `fullName`, `password` (bcryptjs hash), `roleType`, `customRoleId`, `departmentId`, `isActive`, `factoryId?` (ref FactoryEntity), `telegramChatId?`, `hireDate?`
- Endpoint: `/v1/users` (GET list, POST create, PATCH :id, DELETE :id)
- **`factoryId` required khi role=Fulfillment** (BE validate trong `createUser` + `adminUpdateUser`; throw 400 nếu thiếu). Per-factory scope: Fulfillment user chỉ thấy đơn ở `factoryId` hoặc `originalFactoryId` của mình (xem `Orders.md §7`)
- `telegramChatId` + `hireDate` dùng cho `/designer/team` page (Designer/DesignerLeader role)
- **`roleId` dùng `RefIDZod` chứ KHÔNG dùng `IDZod`** (`packages/shared/constants/common-zod.ts`): bảng `roles` có bản ghi `_id` đặt tay (`role_admin` 10 ký tự, `role_seller_manager` 19) bên cạnh các mã 16 ký tự sinh tự động. Ràng buộc `IDZod` (đúng 16 ký tự) làm **không tạo được user Admin/SellerManager** qua giao diện — dropdown vẫn liệt kê nhưng lưu là báo `roleId - String must be exactly 16 characters long`. Sự tồn tại của role vẫn được `UserService.createUser`/`adminUpdateUser` kiểm ở tầng dưới (`Invalid role`).
- `getUserById` projection bao gồm: `_id, status, email, fullName, departmentId, factoryId, fulfillmentStage, telegramChatId, hireDate, role, customRole, rateLimitBypass, forcePassChange` — đảm bảo `AuthUser()` decorator có đủ field cho visibility filter
- ⚠️ **Gotcha quan trọng:** `getUserById` $project + `getMe` $project là 2 aggregation pipeline **độc lập** — field nào không có trong list sẽ silently `undefined` trên user object. Bất kỳ field mới nào trên `UserEntity` mà BE/FE cần access (qua `@AuthUser()` hoặc `authStore.profile`) đều phải add vào **cả 2** $project. Đã có precedent: thiếu `fulfillmentStage` ở `getUserById` → endpoint `/v1/fulfillment/my-tasks` báo "Thiếu stage" dù user đã được gán đúng. Xem `FulfillmentWorkflow.md §5.6`.
- ⚠️ Phase Designer-Task-Workflow Phase 6 **xoá** field `user.assigneeCode` — designer identity model giờ dùng `user._id` trực tiếp (Order.assignee = user._id)

### 3.3 `role/`
- **Static enum** `RoleType` từ `shared`: SuperAdmin / Admin / Manager / User
- Mỗi role có set permission cố định trong code (RolesGuard check)

### 3.4 `custom-role/`
- Role tự định nghĩa do Admin tạo
- Schema: `{ name, description, permissions: PermissionType[] }`
- User có thể có cả `roleType` (fixed) + `customRoleId` (tùy chọn) → permission = union

### 3.5 `permission/`
- List tất cả `PermissionType` từ `shared` package
- Endpoint `/v1/permissions` cho FE render dropdown trong form custom role

### 3.6 `departments/`
- CRUD department: `{ name, code, parentId?, managerId? }`
- Hỗ trợ cây phân cấp (parentId)
- User được gán 1 department

---

## 4. Guards & Decorators

### 4.1 `@Auth()` composite
```ts
@Auth(
  [RoleType.Admin, RoleType.Manager],     // roles allowed
  [PermissionType.ViewProduct],            // permissions required
  { public: false }                        // skip auth if true
)
```
Tự apply:
1. **AuthGuard** — verify JWT
2. **RateLimiterGuard** — chống brute force
3. **PermissionsGuard** — check permissions của custom role + role mặc định
4. **RolesGuard** — check `roleType` của user trong list cho phép

Kèm theo phần khai báo cho Swagger: `ApiUnauthorizedResponse`, và `ApiBearerAuth` **chỉ khi
`public !== true`** (`HF-1`). Trước đó nhãn bearer gắn vô điều kiện, nên route public vẫn bị đặc tả khai
là cần JWT — chỗ lộ ra là 5 endpoint agent, cửa thật của chúng là `AgentApiKeyGuard`. Đây là decorator
**tài liệu**: nó không tham gia quyết định cho gọi hay không, cửa vẫn là `AuthGuard({ public })`.

### 4.2 Param decorators
- `@AuthUser()` — inject `UserDocument` đã verify
- `@ClientIp()` — IP từ Fastify req
- `@UserAgent()` — header
- `@AccessToken()` — raw JWT

---

## 5. Frontend (`apps/web`)

### 5.1 `authStore.ts` (Zustand + persist)
```ts
/** Profile từ BE getMe: User + virtual `role` populate (name có thể là custom role → string). */
type UserProfile = User & { role?: { name: string; permissionCodes?: string[]; isSystem?: boolean } };

interface AuthStore {
  token: string | null;
  tokenExpiredAt: number;
  profile: UserProfile | null;
  loading: boolean;
  setToken(data: string): void;
  getToken(isPublic?: boolean): string | null;
  isAuthenticated(): boolean;
  setTokenExpiredAt(data: number): void;
  clearToken(): void; // xóa token + profile, redirect /login
  setProfile(data: UserProfile): void;
  setLoading(data: boolean): void;
}
```

### 5.2 Permission helpers (`apps/web/src/utils/permission.ts`)
- `validatePermission(required)` — check user có quyền không
- `permissionMap` — map route → permission cần thiết
- Sidebar item ẩn/hiện theo permission

### 5.3 Axios interceptor
- Request: attach `Authorization: Bearer {accessToken}`
- Response 401: thử refresh → retry → nếu refresh fail → logout + redirect `/login`

---

## 6. Trang trong web (FE)

| Trang | File | Mô tả |
|-------|------|-------|
| Login | `pages/login/index.tsx` | Form login + logo + tagline |
| Register | `pages/register/index.tsx` | (Demo, có thể tắt) |
| Account | `pages/account/index.tsx` | Profile + đổi password |
| Users | `pages/users/` | Admin quản lý user — mặc định lọc "Đang hoạt động" + chip Đã khóa/Tất cả kèm số đếm + lọc theo vai trò (FE, tải limit=200; cảnh báo khi `total` > 200) |
| Roles | `pages/roles/` | Hiển thị role mặc định + permission |
| Custom Roles | `pages/custom-roles/` | **Trang giữ chỗ** (tiêu đề + "comingSoon", chưa từng làm CRUD) — gỡ khỏi menu 01/10/2026, route vẫn gác `page.roles` qua `ROUTE_ONLY_PAGES` |
| Departments | `pages/departments/` | **Trang giữ chỗ** (tiêu đề + "comingSoon", chưa từng làm CRUD) — gỡ khỏi menu 01/10/2026, route vẫn gác `page.users` qua `ROUTE_ONLY_PAGES`; BE `departments/` giữ nguyên |
| Settings | `pages/settings/` | System config (Admin only) |
| Notifications | `pages/notifications/` | List notification của user |

---

## 7. Permission Catalog (Phase 5)

Hệ thống dùng **catalog tĩnh** trong `packages/shared/constants/permission-catalog.ts` (`PERMISSION_CATALOG`) làm danh sách quyền duy nhất cho cả UI matrix và BE check. Role có field `permissionCodes: string[]` chứa subset code được cấp.

### 7.1 Nhóm permission

| Group | Code mẫu | Mục đích |
|-------|----------|----------|
| `page` | `page.dashboard`, `page.orders`, `page.workshop_config`, `page.users`, `page.roles` | Quyết định sidebar item có hiện hay không. |
| `order` | `order.import`, `order.delete`, `order.view_admin_table`, `order.view_workshop_table` | Hành động cấp module. |
| `order_field` | `order.field.printStatus.{view\|edit}` (× 8 field) | Field-level — Danh sách đơn ẩn/khóa cột. |
| `workshop` | `workshop.manage` | CRUD Workshop Config. |
| `admin` | `user.manage`, `role.manage` | Quản trị user/role. |
| `audit` | `order.log.view` | Xem timeline thay đổi đơn hàng. |

### 7.2 Preset role mặc định (`DEFAULT_ROLE_PERMISSIONS`)

| Role | Page | Order action | Field view | Field edit | Khác |
|------|------|--------------|-----------|-----------|------|
| SuperAdmin / Admin / Manager | tất cả | tất cả | tất cả | tất cả | tất cả |
| Support | dashboard / orders / products | `order.import`, `order.view_workshop_table` | tất cả | ❌ | `order.log.view` · **trang Sản phẩm: TẠO + SỬA product config, KHÔNG xóa/import/crawl, 3 tab Xưởng/Danh mục/Collection chỉ đọc (AUTH-6, mở rộng 10/09/2026)** |

> **AUTH-6 — quyền Support ở trang Sản phẩm (cập nhật 10/09/2026: Support được TẠO + SỬA sản phẩm).** Support có `page.products` nên vào được `/adm/products`. Ban đầu chỉ ĐỌC (các route GET danh sách của `product-configs` · `factories` · `machine-types` · `product-categories` · `collections`); từ 10/09/2026 mở thêm cho Support 4 route của `product-config.controller.ts`: `GET /product-configs/:id` · `POST /product-configs` · `PATCH /product-configs/:id` · `POST /product-configs/upload-image` (form tạo/sửa cần upload mockup). **Vẫn CHỈ Admin+Manager**: `DELETE /product-configs/:id`, mọi route import/crawl/backfill, và toàn bộ route ghi của factory/machine-type/product-category/collection (3 tab kia Support vẫn chỉ đọc).
>
> Chặn **hai lớp**: giao diện qua hook `apps/web/src/hooks/useProductWriteAccess.ts` — nay trả 2 cờ mirror đúng `@Auth`: `canWriteProducts` (tạo/sửa product config — có Support) và `canManageProducts` (xóa + công cụ import/crawl + ghi 3 tab Xưởng/Danh mục/Collection — chỉ SuperAdmin/Admin/Manager); API vẫn từ chối độc lập. Sửa một bên mà quên bên kia thì hoặc Support bấm nút rồi ăn 403, hoặc tệ hơn là ghi được thật — **đổi ở hook thì đổi cả ở `@Auth`**.
>
> **Support đọc được giá vốn qua API**: response danh sách kèm `variations[]` có `cost`/`nonShipCost`/`wholesalePrice` dù bảng không hiện cột giá. BA đã chấp nhận (quy tắc cứng của repo chỉ cấm lộ giá vốn ra **khách/public**, Support là nhân viên nội bộ). Muốn siết thì phải lọc trường riêng cho vai này — **task riêng, không tự chế**.

> **KHÔNG có mã quyền mới nào được thêm** vào `permission-catalog.ts` cho việc này — `page.products` sẵn có đã đủ diễn đạt. Đây là chủ ý: preset `Manager` tính bằng `ALL_PERMISSION_CODES.filter(...)` nên thêm mã quyền có thể lặng lẽ đổi quyền Manager, và `role.service.ts onModuleInit` sync preset mỗi lần boot.
| **DesignerLeader** | dashboard / orders / workshop_config / **designer_team** / **designer_stats** / my_tasks | `order.import`, `order.transfer`, `order.delete`, `order.view_workshop_table` | tất cả designer/order field + designerStatus | `assignee` + `toolResultNote` + `productionErrorSource` + machineNumber + tool/errorFile* + assigneeNote | `designer.team.manage`, `designer.task.assign`, `designer.task.override`, `order.log.view` |
| **Designer** (sub) | dashboard / orders / **my_tasks** | `order.view_workshop_table` | tool* / errorFile* / assigneeNote* / designerStatus / productionError | tool / errorFile* / errorFileNote / assigneeNote / machineNumber (**KHÔNG** edit assignee + toolResultNote — BE auto derive khi state machine `complete`) | `designer.task.transition` |
| Fulfillment | dashboard / orders | `order.view_workshop_table`, `order.transfer` | printStatus* / machineNumber / productionError* / **productionErrorSource** | printStatus* / machineNumber / productionError* / **productionErrorSource** | ❌ |

> `*` = cả 2 sub-permission `view` + `edit` của field đó.

**Phase Designer-Task-Workflow** đổi role landscape:
- Thêm role `DesignerLeader` (quản lý sub-designer + assign + xem stats)
- Role `Designer` cũ trở thành **sub-designer** — quyền giảm: bỏ `assignee.edit` + `toolResultNote.edit` (BE auto derive qua state machine), thêm `designer.task.transition`
- Migration: chạy `POST /v1/designer/migrate-leader` (Admin) một lần để promote 1 user Designer cũ duy nhất → DesignerLeader role + đổi email sang `designerleader@onospod.com`

**Field-level perm mới** (Phase Fulfillment per-factory + ProductionErrorSource):
- `order.field.designerStatus.view` — read-only badge trong workshop table
- `order.field.productionErrorSource.view/.edit` — picker designer/factory

### 7.3 RoleEntity (Phase 5 extension)

```ts
@DatabaseEntity({ collection: 'roles' })
class RoleEntity {
  name: RoleType;
  description?: string;
  permissionIds: string[];      // legacy — vẫn giữ cho tương thích
  permissionCodes: string[];    // NEW — codes từ PERMISSION_CATALOG
  isSystem: boolean;            // NEW — true cho 4+ role mặc định
  status: Status;
}
```

`RoleService.onModuleInit()` seed **7 system role** (SuperAdmin, Admin, Manager, Support, **DesignerLeader**, Designer, Fulfillment) với preset tương ứng. Phase Designer-Task-Workflow đổi `SYSTEM_ROLES`: thêm DesignerLeader đứng trước Designer. Role đã tồn tại trên DB **bị overwrite về preset mới mỗi boot** (sync catalog là source of truth) — admin muốn role custom phải tạo role mới với `isSystem=false`.

### 7.4 Endpoints quản lý role (mới)

| Method | Path | Quyền | Mô tả |
|--------|------|-------|-------|
| GET | `/v1/roles` | Admin / Manager / Accountant | List role + populate permissionCodes |
| POST | `/v1/roles` | Admin / SuperAdmin | Tạo role custom |
| PATCH | `/v1/roles/:id` | Admin / SuperAdmin | Update mô tả / status |
| PATCH | `/v1/roles/:id/permissions` | Admin / SuperAdmin | Thay toàn bộ `permissionCodes` (validate code có trong catalog) |
| POST | `/v1/roles/:id/reset-permissions` | Admin / SuperAdmin | Reset về preset mặc định (chỉ hoạt động với role hệ thống) |
| DELETE | `/v1/roles/:id` | Admin / SuperAdmin | Soft delete — bị chặn nếu `isSystem=true` |

### 7.5 Endpoints quản lý user (mới)

| Method | Path | Quyền | Mô tả |
|--------|------|-------|-------|
| POST | `/v1/users` | Admin / SuperAdmin | Tạo user mới (fullName, email, password, roleId) |
| PATCH | `/v1/users/:userId` | Admin / SuperAdmin | Update bất kỳ target user (đổi role, đổi tên...) |
| DELETE | `/v1/users/:userId` | Admin / SuperAdmin | Soft delete — chặn xóa chính mình |
| POST | `/v1/users/:userId/toggle-active` | Admin / SuperAdmin | Toggle Status.Active ↔ Inactive |

---

## 8. Frontend UI Phase 5

### 8.1 `/users` (rebuild)
- Table list user (Name, Email, Role badge + **Factory badge** khi role=Fulfillment, Switch trạng thái, action Sửa / Xóa).
- Dialog Thêm/Sửa: fullName, email, password (chỉ khi tạo), select role, **conditional Factory dropdown** (chỉ hiện khi role được chọn === Fulfillment, required, load từ `/v1/factories`).
- Form validate: nếu role=Fulfillment mà chưa pick factoryId → toast error + block submit. BE cũng enforce (defense).
- Reset `factoryId` về `''` khi user đổi role sang ≠ Fulfillment (tránh data thừa).
- Service: `RepositoryRemote.users.{createUser, adminUpdateUser, adminDeleteUser, toggleActive}` + `RepositoryRemote.factory.getFactories()`.

> Designer team (sub-designer) management dùng page riêng `/designer/team` — xem `DesignerTaskWorkflow.md §4.1`. Page `/users` tổng dành cho mọi role; admin tạo sub-designer ở đâu cũng được, nhưng `/designer/team` UX tối ưu hơn (random password gen, hireDate, telegramChatId, count task active).

### 8.2 `/roles` (rebuild)
- Table list role (Name, Description, số permissions, badge System).
- Click row → `<Sheet>` (drawer phải) với `PermissionMatrix` component.
- `PermissionMatrix` (`components/roles/PermissionMatrix.tsx`):
  - Render 5 group checkbox list (`page` / `order` / `workshop` / `admin` / `audit`).
  - Render bảng matrix 8 × 2 cho `order_field` (cột view / edit).
  - Track `Set<string>` codes, toggle qua callback `onChange`.
- Footer drawer: Reset preset (chỉ enable nếu `isSystem=true`) + Hủy + Lưu.
- Save → `PATCH /v1/roles/:id/permissions`.

### 8.3 Sidebar dynamic
- `NAV_GROUPS` chia **4 nhóm**: 1 nhóm **không header** (`title: ''`) ở trên cùng gồm 3 menu bung `Dashboard` · `Quản lý đơn` · `Công việc`; rồi 3 nhóm có header `Danh mục` · `Quản trị` · `Cá nhân`. Header rỗng không render (`showLabels && group.title`), key nhóm fallback `group-${idx}`. Mỗi `NavItem` có `perm?: string` từ `page.*`; item có `children` → menu bung/gộp (SidebarParent), item lẻ → leaf.
- Menu `Công việc` (parent, không perm) gộp `Task của tôi` (`page.my_tasks`) + `Task Fulfillment` (`page.fulfillment_my_tasks`). `Team Designer` (`page.designer_team`) nằm trong menu `Nhân sự & phân quyền` (nhóm Quản trị).
- `NavChild` field gating: `perm?: string` (1 quyền), `anyPerm?: string[]` (OR — hiện khi có BẤT KỲ quyền nào), `hideForRoles?: string[]` (ẩn theo tên role, bổ sung cho perm).
- Hàm `filterMenuByPermissions(groups, codes, isAdmin, roleName?)` lọc theo `profile.role.permissionCodes`. `allow(perm, anyPerm)`: Admin bypass → `anyPerm` (OR) → `perm` (đơn). Parent giữ lại nếu còn ≥1 child; nhóm rỗng bị bỏ.
- Admin / SuperAdmin bypass (full menu) — tránh khóa cứng nếu seed lỗi.
- `getUserById` projection thêm `role.permissionCodes` + `role.isSystem` để FE nhận đủ data từ `/v1/auth/me`.
- **Menu `Dashboard`** (nhóm Tổng quan) là parent bung ra 7 child = 7 tab, mỗi child link `/dashboard?tab=<key>` (`factory/stats/status/lifecycle/tool-check/person-error/designer`). Tab ngang ở page vẫn giữ; bấm submenu chỉ deep-link tới đúng tab. Gating child: `tool-check`→`page.tool_check`, `person-error`→`anyPerm:[page.designer_stats, page.tool_check]`, `designer`→`page.designer_stats`; 4 tab còn lại luôn hiện (theo `page.dashboard` của parent). `home/index.tsx` tự gắn `?tab=<activeTab>` khi vào `/dashboard` trần để submenu highlight đúng.
- **Menu `Quản lý đơn`** (nhóm Đơn hàng) 5 child: `Danh sách đơn` (`/orders/workshop`), `Nhật ký bù lỗi` (`/orders/error-log`, `hideForRoles:['Support']`), `Quét mã` (`page.scan_error`), `Import Order` + `Import File Cutting` (`order.import`).
- **Menu nhóm `HR`** (menu 6 nhóm, MenuRestructure-CEO.md) theo luồng làm việc: `Người dùng` (`user.manage`) → `Vai trò` (`role.manage`) → `Team Designer` (`page.designer_team`) → `Mạo danh` (chỉ SuperAdmin). `Phòng ban`/`Vai trò tùy chỉnh` đã gỡ khỏi menu (trang giữ chỗ). `Cài đặt` ở nhóm Hệ thống (`role.manage`).
- **Gác route từ cây menu (AUTH-7, `buildPagePermissionMap` → `RequirePagePermission`)**: route chỉ được gác khi mục menu của nó khai mã `page.*` (`perm`/`pagePerm`); trang rời sidebar phải khai vào `ROUTE_ONLY_PAGES` cùng commit, nếu không route MỞ (MenuRestructure-CEO.md §9.1). **Trang khoá-theo-vai nằm NGOÀI bảng này là CÓ CHỦ ĐÍCH**: `CEO Dashboard` (`/adm/ceo`) và `Ví` (`/adm/wallets`) chỉ có `onlyForRoles: [SuperAdmin, Admin]`, không mã `page.*`, nên tầng route không chặn — vẫn an toàn vì (1) chính trang tự đá vai khác về HOME, (2) BE gác `@Auth([Admin])` (`ceo/*`, `admin/customer-wallets*`), dữ liệu không rò. Muốn chặn ở tầng route thì thêm mã `page.*` vào permission-catalog — việc riêng, đụng bảng quyền. Rà bảng quyền thấy hai trang này vắng thì KHÔNG phải sót.
- `NavChild.defaultQuery`: query menu thêm khi MỞ trang (view mặc định có nghĩa, §8.1), KHÔNG thuộc danh tính mục — sáng menu + tín hiệu reset chỉ so `to`. Dùng khi trạng thái "tắt lọc" của trang là THIẾU param (vd Ví `activeOnly=true`). Chỉ khai giá trị BẬT: `z.coerce.boolean` đọc chuỗi `"false"` thành `true`.
- Active state detect qua `isLinkActive(linkPath, currentPath, currentSearch)` — so sánh path + query subset, nên link có `?tab=` vẫn highlight đúng.

> ⚠️ Cache Redis `user:${id}` và `user:info:${id}` giữ payload cũ. Sau khi deploy Phase 5, admin gọi `POST /v1/users/:id/clear-user-cache` hoặc đợi TTL để FE thấy permission mới.

---

## 9. Legacy permission cheat sheet (sẽ deprecate ở Phase 0)

| Role | Quyền |
|------|-------|
| **SuperAdmin** | Tất cả + manage admins |
| **Admin** | Tất cả module business + user/role/department |
| **Manager** | Products + Orders + Dashboard, read-only user |
| **User** | Chỉ profile cá nhân |

Permission constants (subset) trong `shared/enums/permission.enum.ts`:
- `ViewProduct`, `CreateProduct`, `UpdateProduct`, `DeleteProduct`
- `ViewOrder`, `CreateOrder`, `UpdateOrder`, `DeleteOrder`, `ImportOrder`
- `ViewDashboard`
- `ViewUser`, `ManageUser`, `ManageRole`, `ManageDepartment`

---

## 8. Bảo mật notes

- Password hash: **bcryptjs** (saltRounds=10) — không dùng native bcrypt
- JWT secret: env `JWT_SECRET` (BẮT BUỘC override khi prod)
- Refresh token rotation: mỗi lần refresh → tạo token mới, revoke token cũ
- Rate limit: 10 req/s mặc định, 5 req/min cho `/login`
- Không log password / token (Winston filter)

---

## 10. Mạo danh tài khoản (SuperAdmin fake login) — `AUTH-1`

> **Đây là đường vòng xác thực có chủ đích.** Đọc hết mục này trước khi sửa bất
> kỳ file nào bên dưới. Thiết kế đầy đủ + lý do từng đánh đổi:
> [`.devtasks/design/AUTH-1.md`](../../.devtasks/design/AUTH-1.md).

### 10.1 Nguyên tắc lõi

**Danh tính hiệu lực trong phiên là NGƯỜI BỊ MẠO DANH; SuperAdmin chỉ là siêu dữ
liệu đi kèm.**

```
JWT thường:   { sessionId, userId, type, role }
JWT mạo danh: { sessionId, userId, type, role, impersonatorId }
                              ↑ người BỊ mạo danh   ↑ SuperAdmin thật
```

`JwtStrategy.validate()` load **người bị mạo danh** từ `userId` như bình thường,
nên `RolesGuard` / `PermissionsGuard` / mọi service **không hề biết** có mạo danh.
Vì thế **quyền SuperAdmin không có đường nào rò rỉ vào phiên**: token không mang
role SuperAdmin, và **không guard nào được đọc `impersonatorId` để cấp quyền**.

### 10.2 Endpoint

| Method | Path | Auth | Ghi chú |
|---|---|---|---|
| POST | `/v1/auth/impersonate` | `@Auth()` — chỉ yêu cầu đã đăng nhập | Chặn "chỉ SuperAdmin" nằm **tường minh trong service**, xem 10.5 |
| POST | `/v1/auth/impersonate/stop` | `@Auth([], [], { public: true })` | **Cố ý public**, xem 10.4. Đường thoát của phiên mạo danh **NHÂN VIÊN** |
| POST | `/v1/customer/auth/impersonate/stop` | `@Auth([], [], { public: true })` | `AUTH-3` — đường thoát của phiên mạo danh **KHÁCH HÀNG**, xem 10.4a. Gọi CHUNG `ImpersonationService.stop()` với đường trên |
| GET | `/v1/auth/me` · `/v1/customer/auth/me` | như cũ | Trả thêm `impersonatedBy`, xem 10.3 |

### 10.3 `impersonatedBy` là field ĐỘNG — bẫy dễ sót nhất

`impersonatedBy` do `JwtStrategy.validate()` **đính lên document**, **không tồn
tại trong schema Mongo**. Hệ quả:

- **Sống sót** qua guard và service — chúng đọc thẳng từ instance.
- **CHẾT** ở mọi chỗ tuần tự hoá lại: `toObject()`, `$project`, aggregation.

Nên **cả hai** endpoint `me` phải chép nó **tường minh**:

| Endpoint | Vì sao rơi | Chép ở đâu |
|---|---|---|
| `/v1/auth/me` | `UserService.getMe()` truy vấn **lại** DB rồi trả object MỚI; nó chỉ chép tay `role` + `customRole` | `getMe()`, ngay cạnh 2 dòng đó |
| `/v1/customer/auth/me` | `toSafeCustomer()` chạy `toObject()` → chỉ giữ path trong schema | `CustomerAuthController.me()` |

> `role` sống được **chỉ vì** `getMe()` chép tay nó. `impersonatedBy` cần đúng đối
> xử đó. Cùng họ với [`Common_Pitfalls.md`](../Architecture/Common_Pitfalls.md) §1,
> khác ở chỗ thêm vào `$project` **không cứu được** vì field không nằm trong DB.

### 10.4a Vì sao có HAI đường thoát (`AUTH-3`)

Token của phiên mạo danh **khách** mang role `Customer`, mà `RolesGuard`
(`apps/api/src/guards/roles.guard.ts`, `CUSTOMER_ALLOWED_PREFIXES = ['/customer/']`)
chặn cứng role đó khỏi **mọi** URL không chứa `/customer/` — kể cả route khai
`public`, vì guard vẫn đọc được user từ token. Nên `POST /auth/impersonate/stop`
trả **403** khi đang mạo danh khách, và người dùng kẹt trong portal khách.

Cách sửa đã chốt: **đưa đường thoát VÀO TRONG rào, không nới rào**. Endpoint
`POST /customer/auth/impersonate/stop` (`CustomerAuthController`) gọi ĐÚNG
`ImpersonationService.stop()` của `AUTH-1` — không nhân bản logic, hai đường cho
kết quả giống hệt nhau. `CUSTOMER_ALLOWED_PREFIXES` **giữ nguyên**, không thêm
phần tử nào.

Hàng rào thật vẫn nằm trong service: token khách **thật** không có claim
`impersonatorId` nên bị từ chối ngay — không có đường đổi token khách lấy token
nhân viên.

**Seller Portal riêng (`apps/seller`, SellerPortal.md §2.3):** khi `VITE_SELLER_URL` khác rỗng, `impersonationStart.ts` KHÔNG ghi token vào `customerAuthStore` nữa mà chuyển sang `${VITE_SELLER_URL}/auth/handoff#token=…&exp=…` (fragment không tới server/log); bên seller đổi thành cookie httpOnly sau khi xác minh qua `customer/auth/me`. Thoát mạo danh từ seller đi qua `POST /api/auth/logout` của Next → `customer/auth/impersonate/stop` (cùng đường 10.4a) → quay về `NEXT_PUBLIC_ADMIN_URL`.

FE chọn đường theo loại phiên trong `apps/web/src/utils/impersonation.ts`
(`activeImpersonationSession()` + bảng `STOP_PATH`): phiên nào giữ
`profile.impersonatedBy` ở `customerAuthStore` thì đi đường khách, còn lại đi
đường nhân viên.

### 10.4 Thoát mạo danh — vì sao endpoint để public

`POST /auth/impersonate/stop` **không đi qua guard `jwt`**; service tự xác thực
**chữ ký thôi, bỏ qua hạn** (`ignoreExpiration: true`).

Lý do: token mạo danh có TTL ngắn (mặc định 60 phút). Nếu endpoint thoát đòi token
còn hạn thì **token hết hạn sẽ không thoát được** — đúng kịch bản mà tính năng
"tự đưa về SuperAdmin khi hết hạn" sinh ra để xử lý.

Bù lại là **3 lớp siết**. Bỏ bất kỳ lớp nào thì token mạo danh cũ thành **vé đổi ra
quyền SuperAdmin vô thời hạn**:

1. Đọc lại SuperAdmin từ DB **ngay lúc thoát** — còn đúng role, còn hoạt động.
2. Phiên còn bản ghi trong `actions` và **chưa** đánh dấu kết thúc.
3. Chặn cứng theo `iat` — quá `IMPERSONATION_EXCHANGE_MAX_AGE` (mặc định 24h) thì từ chối.

### 10.5 Chỉ SuperAdmin — nhưng kiểm trong service, không phải `@Auth`

Yêu cầu đòi **vừa** từ chối **vừa** ghi vết lần thử trái phép. `@Auth([SuperAdmin])`
ném ngay ở guard nên **không có chỗ nào ghi**. Vì vậy endpoint dùng `@Auth()` rồi
kiểm role tường minh trong `ImpersonationService.start()`, ghi
`ActionType.ImpersonateRejected` trước khi ném `ForbiddenException`.

> **Đánh đổi có ý thức, CHỈ áp cho endpoint này. Đừng nhân rộng mẫu này.**

### 10.6 Mật khẩu mặc định + `passwordSource`

Mạo danh một tài khoản **chưa có mật khẩu** sẽ đặt mật khẩu mặc định cho nó. Hai
ràng buộc đi kèm, cả hai đều dễ làm hỏng:

**a) Tài khoản ĐÃ có mật khẩu thì tuyệt đối không đụng.** Điều kiện nằm **ngay
trong filter** của lệnh update, **không** đọc-rồi-ghi:

```js
updateOne({ _id, $or: [{password: {$exists:false}}, {password: null}, {password: ''}] }, { $set: {...} })
```

Đọc rồi ghi có khe đua: giữa lúc đọc và lúc ghi, chính chủ có thể vừa đặt mật khẩu
— ghi đè lên là **khoá họ khỏi tài khoản của chính họ**.

**b) Không được khoá chính chủ khỏi luồng tự đăng ký.**
`CustomerService.register()` vốn coi `password !== ''` là "đã đăng ký". Nếu giữ
nguyên, mạo danh một lần là khách **vĩnh viễn** không tự đăng ký được. Nay phân
biệt bằng `CustomerEntity.passwordSource`:

| `password` | `passwordSource` | `register()` |
|---|---|---|
| rỗng | — | claim (như cũ) |
| có | `'system'` | **vẫn claim** — chính chủ ghi đè được |
| có | `'self'` hoặc **thiếu** | từ chối (như cũ; bản ghi cũ = khách tự đặt) |

> **TUYỆT ĐỐI KHÔNG nhận biết bằng cách so giá trị mật khẩu với chuỗi mặc định.**
> Khách có thể **tự chọn** đúng chuỗi đó; khi ấy tài khoản của họ bị coi là chưa
> claim và **người khác đăng ký đè lên được** — vá một lỗ hổng bằng cách mở một
> lỗ hổng nặng hơn.
>
> **Và KHÔNG BAO GIỜ trả `passwordSource` ra API.** `'system'` chính là tín hiệu
> *"tài khoản này đang dùng mật khẩu mặc định"*; lộ ra thì bất kỳ ai đọc được danh
> sách khách đều lọc ra ngay tập tài khoản đăng nhập được. `toSafeCustomer()` xoá
> tường minh — thêm field nhạy cảm vào `CustomerEntity` phải cân nhắc đúng chỗ đó.

### 10.6a Tìm tài khoản: gõ KHÔNG DẤU vẫn ra, khớp đúng lên đầu (`AUTH-4`)

Ô tìm tài khoản (popup trên thanh nav lẫn trang `/impersonate`) gọi hai nguồn
sẵn có: `GET /users?search=` và `GET /customers?search=`. Cả hai từng dùng
`$regex` thô nên chỉ bỏ qua hoa thường — 35/45 nhân viên có dấu trong tên nên
gõ nhanh gần như không tìm ra ai.

- **Khớp bỏ dấu** làm ở BACKEND bằng `diacriticInsensitiveRegex()`
  (`apps/api/src/utils/diacritic-regex.ts`): đổi từng chữ cái người dùng gõ
  thành lớp ký tự gồm cả biến thể có dấu (`a` → `[aàáảãạăằắẳẵặâầấẩẫậ]`), `đ`
  nằm trong lớp `d` vì NFD KHÔNG tách được `đ`. Lớp ký tự là **tập cha** của
  chữ vừa gõ nên chuỗi CÓ dấu vẫn ra đúng như trước — không mất kết quả nào.
  > **Collation của MongoDB KHÔNG áp dụng cho `$regex`** — đừng đi hướng đó.
- **Xếp hạng** làm ở FRONTEND trong `useImpersonationSearch` (khớp chính xác →
  khớp đầu chuỗi → khớp giữa chuỗi, tính trên mọi trường đang tìm, sort ổn
  định nên gõ lại cùng chuỗi cho cùng thứ tự). Cố ý KHÔNG đụng thứ tự của
  màn quản trị người dùng / khách hàng.

Hai endpoint này dùng chung với trang **Quản trị Khách hàng** (`Customers.md`)
nên các màn đó cũng tìm được không dấu — cải thiện kèm theo, không đổi gì khác.

**Dòng kết quả** (`AUTH-5`): nhân viên hiện `[Nhân viên] tên [vai trò]` rồi email
ở dòng dưới — vai trò là badge RIÊNG chứ không ghép vào dòng email, vì email dài
cắt mất nó trong popup 340px. Nhãn vai trò hiện **thô**, không dịch (đúng tiền lệ
trang Users và dải cảnh báo mạo danh). Tài khoản khách giữ nguyên badge
`Khách hàng`, KHÔNG bịa vai trò.

### 10.7 Ghi vết

Tái dùng collection `actions` (đã có `ip`/`userAgent`/`sessionId`/`active`) thay vì
dựng bảng mới. `ActionType` thêm 4 giá trị: `Impersonate`, `ImpersonateStop`,
`ImpersonateRejected`, `ImpersonatePasswordSet`.

Thay đổi dữ liệu trong phiên mạo danh truy được về **cả hai** danh tính ở 2 nơi hệ
thống đã có ghi vết: `orderLogs` (`impersonatorId` + `impersonatorName`) và
`userLogs` (`impersonatorId`).

> **Thêm field vào bảng log thì phải sửa CẢ HAI nơi: Zod DTO *và* `@Prop` trong
> entity.** Mongoose chạy strict mode — field không có trong schema bị **âm thầm
> loại bỏ** lúc ghi: không lỗi, không cảnh báo, dữ liệu chỉ đơn giản biến mất.
>
> `assertSameType<UserLog, UserLogEntity>()` **không** cứu được: field optional mà
> thiếu ở một bên vẫn assignable trong TypeScript, nên typecheck xanh trong khi
> schema và DTO đã lệch. Đây chính là bug `AUTH-1-B1` — `userLogs` mất dấu
> SuperAdmin thật suốt trong khi `orderLogs` làm đúng.
>
> Guard hiện có: `apps/api/src/modules/user/user-log-schema.spec.ts` kiểm thẳng
> `Schema.path(...)`. Thêm field truy vết mới thì thêm case vào đó.

> **Rủi ro tồn dư đã biết:** 14 module còn lại **không có ghi vết nào** (product-config,
> promotion, factory, workshop-config, các bảng cấu hình, role/permission…). Mạo danh
> không tạo ra lỗ hổng này nhưng làm nó nghiêm trọng hơn — trước đây người sửa luôn là
> người đăng nhập thật. Giảm nhẹ: mốc bắt đầu/kết thúc từng phiên trong `actions` giúp
> khoanh được khoảng thời gian khi điều tra.

### 10.8 Không đá ai ra khỏi phiên

Phiên mạo danh **bắt buộc dùng `sessionId` MỚI**. Cache token khoá theo
`token:${sessionId}:${userId}` và `clearTokens()` xoá theo đúng khoá đó — tái dùng
`sessionId` của phiên thật sẽ đá người bị mạo danh (hoặc chính SuperAdmin) ra.

### 10.9 Mã lỗi riêng khi phiên hết hiệu lực

BE trả **`error.impersonationExpired`** thay vì 401 trơn.

Bắt buộc, không phải tuỳ chọn: `apps/web/src/apis/index.tsx` bắt 401 rồi gọi
`authStore.clearToken()`, mà hàm đó `resetSession()` + `sessionPersist.clearAll()` +
chuyển hẳn sang trang đăng nhập. Không có mã riêng thì hết hạn phiên mạo danh sẽ
**xoá sạch phiên thật của SuperAdmin** và đá về màn hình đăng nhập.

### 10.10 Env

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `JWT_IMPERSONATION_EXPIRATION_TIME` | `3600` | TTL phiên mạo danh (giây) — **ngắn hơn** phiên thường |
| `IMPERSONATION_EXCHANGE_MAX_AGE` | `86400` | Quá hạn này thì token mạo danh không đổi ra SuperAdmin được nữa |
