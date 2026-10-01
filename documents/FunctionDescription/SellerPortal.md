# Seller Portal (`apps/seller`) — Function Description

> **File FE:** `apps/seller/src/app/{layout,page}.tsx`, `apps/seller/src/app/login/page.tsx`, `apps/seller/src/app/(portal)/layout.tsx`, `apps/seller/src/app/(portal)/portal/orders/{page,[productionId]/page,3d|2d|wood|embroidery|led|canvas/page}.tsx`, `apps/seller/src/app/track/{page,[code]/page}.tsx`, `apps/seller/src/app/auth/handoff/page.tsx`, `apps/seller/src/components/orders/{orders-list-view,order-row,product-line-tabs,orders-status-filter-pills,orders-stats-bar,push-dialog,stage-timeline}.tsx`, `apps/seller/src/components/layout/{customer-sidebar,impersonation-banner}.tsx`, `apps/seller/src/lib/{product-lines,navigation,constants,customer-orders,label-preview}.ts`, `apps/seller/src/context/session-context.tsx`, `apps/seller/src/i18n/{index,constants}.ts` + `locales/{vi,en}/{customerPortal,track,common,seller}.json`
> **File BE (Next server-side):** `apps/seller/src/app/api/auth/{login,logout,handoff}/route.ts`, `apps/seller/src/app/api/v1/[...path]/route.ts` (proxy), `apps/seller/src/lib/server/api.ts` (cookie), `apps/seller/proxy.ts` (Next 16 middleware)
> **File BE (NestJS — tái dùng, không endpoint mới):** `apps/api/src/modules/customer-portal/*` (`customer/auth/*`, `customer/orders/*`, `public/track/:code`), `apps/web/src/utils/impersonationStart.ts` (handoff mạo danh)
> **Route:** khách: `/login`, `/portal` (dashboard), `/portal/orders/:slug` (slug = dòng sản phẩm `3d|2d|wood|embroidery|led|canvas` → trang DỊCH VỤ; slug khác → chi tiết đơn `:productionId`), `/portal/orders/:line/create`, `/portal/orders/:line/import`, `/portal/orders?q=` (chỉ điều hướng), `/portal/account`, `/portal/api`, `/track`, `/track/:code`, `/auth/handoff`; **khu quản trị nhân viên (§9):** `/hub/login`, `/hub`, `/hub/sellers`, `/hub/orders`, `/hub/notifications`
> **API (same-origin của app seller):** `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/handoff`, `ANY /api/v1/*` → NestJS `${API_INTERNAL_URL}/*`

---

## 1. Overview

Cổng khách hàng (seller) **tách thành app riêng** bằng Next.js 16 App Router, clone khuôn giao diện thghub (kit `components/shared`, sidebar 210px, tab dịch vụ → tab **dòng sản phẩm**). App admin `apps/web` giữ nguyên cho vận hành nội bộ; `/customer/*` cũ vẫn chạy song song cho tới PR-D (redirect).

Khác biệt nghiệp vụ so với thghub: Onos là xưởng nên seller nhìn đơn theo **dòng sản phẩm** `productLine` (`3d · 2d · wood · embroidery · led · canvas`, PRD-8 — `Products.md §2.4b`), không phải theo dịch vụ POD/Drop/Express. Trục này chi phối menu (6 mục con của "Quản lý đơn"), tab đếm, bộ lọc, badge trên mỗi dòng đơn.

Nguyên tắc cứng:

- **Không tách API, không Prisma, không server action.** Seller chỉ gọi API NestJS có sẵn qua DTO Zod trong `packages/shared`. Một nguồn số duy nhất.
- **Token không bao giờ ra JS.** Route handler của Next giữ JWT trong cookie httpOnly; browser chỉ gọi `/api/v1/*` same-origin, proxy gắn Bearer.
- **Thiếu số/field → thêm ở BE + shared**, không tính ở FE.

PR-B (07/09/2026): login/logout/remember, danh sách đơn + 6 tab dòng sản phẩm + pill trạng thái + chip "Đang giữ", push/hủy đơn pending, chi tiết đơn (timeline 8 chặng, sửa mockup/địa chỉ), `/track/:code` công khai, handoff mạo danh từ admin. PR-C (cùng ngày): dashboard, đặt đơn (upload R2), import CSV, tài khoản, chuông thông báo. PR-D: pm2/systemd, deploy.sh, cloudflared, CORS, redirect `/customer/*` ở admin (§8).

## 2. Luồng hoạt động

### 2.1 Đăng nhập — cookie httpOnly + proxy same-origin (D5)

```
browser ──POST /api/auth/login {userEmail,password,rememberMe}──▶ Next route handler
   ◀── Set-Cookie onos_seller_token (httpOnly) + onos_seller_exp ──┘   │
                                                                      └──POST customer/auth/login──▶ NestJS
browser ──GET /api/v1/customer/orders?…──▶ proxy [...path] ──Authorization: Bearer <cookie>──▶ NestJS
```

- `rememberMe=true` → cookie `maxAge = expiresIn` của BE (BE quyết TTL theo `JWT_REMEMBER_EXPIRATION_TIME`, Auth.md §2.3); `false` → cookie phiên (đóng trình duyệt là mất).
- `onos_seller_exp` là cookie thường (JS đọc được) chỉ để client biết còn phiên; **không phải** nguồn xác thực.
- Proxy nhận **401 từ BE → xóa cookie** rồi trả 401; `use-api.ts` thấy 401 → về `/login?callbackUrl=`. `proxy.ts` (middleware) chỉ chặn sớm trang cần đăng nhập khi **không có** cookie — hết hạn thật do BE quyết.
- Proxy stream body (JSON + multipart), bỏ header hop-by-hop, gắn `Accept-Language` từ cookie `onos_lang` nếu client không gửi.

### 2.2 Đăng xuất

`POST /api/auth/logout`: xóa cookie. Nếu `customer/auth/me` báo `impersonatedBy` (phiên mạo danh) → gọi `customer/auth/impersonate/stop` (Auth.md §10.4a) rồi trả `redirectTo = NEXT_PUBLIC_ADMIN_URL`; ngược lại `redirectTo = /login`.

### 2.3 Handoff mạo danh từ admin

`apps/web/src/utils/impersonationStart.ts`: khi `VITE_SELLER_URL` khác rỗng và target là khách → `window.location.href = ${VITE_SELLER_URL}/auth/handoff#token=…&exp=…`. Token đi qua **fragment** (không tới server, không lọt access log). Trang `/auth/handoff` đọc hash, `history.replaceState` xóa hash, `POST /api/auth/handoff` → route handler **xác minh token bằng `customer/auth/me`** trước khi ghi cookie (token rác → 401, không tạo phiên) → `/portal/orders`. Banner vàng `ImpersonationBanner` hiện suốt phiên, nút "Thoát" đi đường §2.2. `VITE_SELLER_URL` rỗng → giữ hành vi cũ (mở `/customer/orders` trong `apps/web`).

### 2.4 Trang dịch vụ (mỗi dòng sản phẩm một trang) — KHÔNG có trang "tất cả đơn"

Quyết định 07/09/2026 (người dùng): seller cần dịch vụ nào thì vào đúng dịch vụ đó (`/portal/orders/3d`…), giống hub thg vào từng mảng POD/Drop. Hệ quả:
- **Không có** `/portal/orders` dạng danh sách tổng và không có tab chọn dòng cho seller (`ProductLineTabs` chỉ còn ở khu quản trị `/hub/orders`). `/portal/orders` chỉ là bộ điều hướng: `?q=<mã>` (từ chuông thông báo) → tìm đơn rồi nhảy tới chi tiết; không có → về Dashboard.
- Route dùng **một segment động** `app/(portal)/portal/orders/[slug]/page.tsx`: slug là dòng sản phẩm → `OrdersListView lockedLine`; ngược lại → `OrderDetailView productionId` (Next không cho 2 slug khác tên cùng cấp). `[slug]/create` và `[slug]/import` là đặt đơn/import **ngay trong trang dịch vụ** (`CreateOrderView line` khoá catalog theo dòng; `ImportOrdersView line` nhận mọi SKU nhưng quay về dòng đang đứng).
- Header trang dịch vụ = `ServiceHero` (trong `orders-list-view.tsx`): dải màu theo dòng → hồng logo, icon + tên dòng + số đơn, 2 CTA "Import CSV" (viền trắng) và "Đặt đơn <dòng>" (vàng logo). Sidebar chỉ còn Dashboard · Orders (6 dịch vụ) · Tài khoản — không còn mục New order/Import CSV riêng.

#### Chi tiết danh sách trong trang dịch vụ

- Thẻ số + pill trạng thái trên trang dịch vụ chỉ đếm đơn CỦA DÒNG ĐÓ: `GET customer/orders/counts?productLine=<line>` (BE `countsPipelines(..., productLine)` thêm `$match` cùng điều kiện với listing; `admin/customer-orders/counts` cũng nhận `productLine`). Đo dev TIKTOKSHOPUS: tổng 4.926 → 2D 301 / 3D 4.625.

`OrdersListView` (dùng chung 7 route): `GET customer/orders?page&limit&status&held&search&productLine` + `GET customer/orders/counts`.

- Tab dòng: `all` + 6 dòng, số đếm từ `counts.byProductLine` (một đơn nhiều dòng đếm ở mọi dòng — D9). Route `/portal/orders/<line>` truyền `lockedLine` → chỉ hiện tab đó, không đổi được.
- Pill trạng thái = `CustomerOrderStatus` (7) + "Tất cả"; chip **"Đang giữ"** là cờ chồng (`held=true`), không phải tab (CustomerOrderIntake.md §1.2); "Đang sửa lỗi" chỉ hiện số.
- Filter/trang nằm **trên URL** (`useUrlState`: `page,limit,status,held,q,line`) → F5/back giữ nguyên; search debounce 350 ms.
- **Thứ tự gọi quan trọng:** `GET customer/orders` chạy `syncLegacyOrdersForCustomer` (lazy-sync đơn hệ cũ) TRƯỚC khi list, còn `counts` thì không → gọi song song lần đầu thì tab đếm cũ (đo trên dev: 4.682 vs 4.926). FE làm tươi counts **sau khi list về** (`useEffect` gọi `mutate`).
- Tick chọn chỉ với đơn `pending` → `PushDialog`: `POST push-preview` (SWR, không effect) → xác nhận → `POST push`; hủy đơn pending → `POST staging/:id/cancel`.
- Cột: Đơn (mã + nguồn + ngày) · Sản phẩm (mockup thumb + type/sku/màu/size ×SL, "+N sản phẩm khác") · **Dòng SP** (badge `productLines[]`) · Khách nhận · Trạng thái (+ Held/Rework + chặng hiện tại) · Vận chuyển · Tổng tiền · Push/Hủy.

### 2.5 Chi tiết đơn `/portal/orders/:productionId`

`GET/PATCH customer/orders/:productionId` (`{ order: CustomerOrderSummary, track: LifecycleTrack }`). Timeline 8 chặng (`StageTimeline`, nhãn `track.progress.stages.*`), lưới thiết kế theo vị trí in (`designs`, thumbnail Drive/R2 qua `driveThumbnailUrl`, bấm mở file), mockup (sửa URL → PATCH), địa chỉ ship (form 11 trường → PATCH), link tra cứu công khai `/track/:pid` kèm nút copy. Đơn đã hủy → khóa sửa. Upload file design lên R2 làm ở PR-C.

### 2.6 Tra cứu công khai `/track/:code`

Không cookie, không sidebar. `GET /api/v1/public/track/:code` → proxy sang `public/track/:code` (PublicOrderTracking.md — danh sách trắng field hẹp, mọi lỗi = 404). Hiện thêm badge dòng sản phẩm (`product.productLine`).

### 2.7 Đặt đơn `/portal/orders/create`

Mirror `apps/web/src/pages/customer/orders/new.tsx`: bộ chọn sản phẩm từ `GET customer/catalog` (search + **tab dòng sản phẩm** `productLine`) → chọn biến thể (`lib/catalog-variant.ts`) → số lượng, mockup (bắt buộc) + design theo `printArea` (luật `designAcceptKeys` từ `shared/client`) → "Thêm vào đơn" → giỏ + 1 địa chỉ ship chung + ghi chú → `POST customer/orders` → về `/portal/orders?status=pending`. Ô file = `components/shared/file-url-or-upload-input.tsx` (dán URL hoặc upload thẳng browser→R2: `presign` → PUT presigned URL → `confirm` → poll `GET customer/designs/:sha`). **R2 bucket phải có CORS cho origin seller** (DesignStorage.md).

### 2.8 Import CSV `/portal/orders/import`

Mirror `apps/web/src/pages/customer/orders/import.tsx`: `xlsx` parse template fulfill OnosPod cũ → group `(order_id, identifier)` → validate từng đơn bằng **`CustomerImportOrderZod` import từ `shared/client`** (cùng schema BE `ImportCustomerOrdersDto`, xem §5) → `POST customer/orders/import/resolve` đối chiếu SKU (ảnh/tên/giá + cảnh báo thiếu design) → `POST customer/orders/import` → bảng kết quả created/duplicated/failed → nút sang tab Chờ đẩy SX. Template tải ở `/customer-order-template.csv` (copy từ `apps/web/public`).

### 2.10 Danh mục sản phẩm `/portal/catalog` (08/09/2026 — phản hồi vận hành)

Ops báo: sidebar KHÔNG có trang danh mục, seller chỉ thấy sản phẩm khi bấm "Đặt đơn mới" TRONG một dịch vụ (nên vào từ trang 3D thì chỉ thấy sản phẩm 3D), và **không tra được SKU để điền file CSV import** — chặn hẳn việc lên đơn 2D/Gỗ hàng loạt.

- **`/portal/catalog`** (`components/catalog/catalog-view.tsx`): entry sidebar mới "Danh mục" đặt TRÊN "Đơn hàng"; tab 6 dòng sản phẩm + số đếm lấy từ `GET customer/catalog/facets` (`productLines`), pill danh mục + collection, ô tìm kiếm debounce 350 ms, lưới card dùng lại `CatalogProductCard`, phân trang; mọi bộ lọc nằm trên URL (`line,category,collection,q,page,limit`). Nút **"Tải danh sách SKU"** kéo hết trang theo đúng bộ lọc đang xem (`components/catalog/sku-csv.ts`, trần 30 trang × 100) rồi xuất CSV `sku,product,product_line,variation,price_usd,ship_cod_usd,tiktok_usd,weight_gram,package_cm` (có BOM cho Excel).
- **`/portal/catalog/[id]`** (`catalog-detail-view.tsx`): gallery (mockup + images + size chart), badge dòng, thuế nhập Mỹ/đơn vị, link template + tài liệu in + bảng size, và **bảng biến thể có cột SKU + nút chép** — đây là thứ seller cần để điền cột `sku` của file import; kèm giá bán (đã áp khuyến mãi theo tier), Ship COD, Ship TikTok, cân nặng + kích thước; nút "Đặt đơn mới" sang đúng dịch vụ của sản phẩm. Giá vốn tuyệt đối không ra tới đây (Catalog.md).
- Trang import CSV thêm nút **"Tra SKU"** link sang `/portal/catalog?line=<dịch vụ>`.
- Hook `lib/use-debounced.ts` tách dùng chung (hub orders view dùng lại).

**Điều kiện để seller thấy sản phẩm:** `ProductConfig.status` phải là `active` (hoặc trống) — cổng hiển thị duy nhất của catalog khách. Ngày 08/09/2026 trên prod cả 3 sản phẩm Gỗ đều `inactive` nên tab Gỗ trống; 2 trong 3 còn gán nhầm xưởng Mê Linh thay vì TNW. Đây là việc cấu hình dữ liệu, không phải lỗi code.

### 2.9a API & Webhook `/portal/api` (tab riêng, 07/09/2026)

Khuôn `portal/api-keys` của thghub: tab bar **API key · Webhook · Lệnh mẫu** trong 1 card, banner vàng hiện key plain **một lần** ghim trên tab bar. Tái dùng `GET/POST/DELETE customer/api-keys` + `customer/webhooks` (ORD-4). Lệnh mẫu dựng từ `NEXT_PUBLIC_OPEN_API_URL` (mặc định `https://api.onosfactory.com/api/v1`). Nút "Tài liệu API" mở `NEXT_PUBLIC_ADMIN_URL/customer/api/docs` (tài liệu đầy đủ chuyển sang seller ở đợt 2). Danh sách sự kiện webhook lấy từ `CUSTOMER_WEBHOOK_EVENTS` — đã dời sang `shared/client` (dto re-export). Trang tài khoản chỉ còn link sang đây.

### 2.9 Dashboard `/portal` + tài khoản + chuông

- Dashboard: `GET customer/orders/dashboard` (4 KPI + 5 đơn gần nhất) + `GET customer/orders/counts` → 2 biểu đồ thanh CSS "theo dòng sản phẩm" (`byProductLine`) và "theo trạng thái", bấm là sang danh sách đúng bộ lọc. Không dùng recharts.
- Tài khoản: `PATCH customer/auth/me` (fullName/phone), `POST customer/auth/change-password`; email/SKU khoá.
- Chuông (`components/layout/notifications-bell.tsx`, trong sidebar): SWR `GET customer/notifications?page=1&limit=20` poll 60 s, `POST customer/notifications/read`; text thông báo hệ thống dựng từ `event`/`eventData` (mirror `NotificationBell.tsx` của web, namespace `customerNotifications` copy từ `apps/web`).

## 3. API / Schema

Không có endpoint NestJS mới. Route handler của Next:

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | body `{userEmail,password,rememberMe}` → gọi `customer/auth/login`, set 2 cookie, trả `{user, expiresIn}`; lỗi BE forward nguyên mã (401 sai mật khẩu, 423 khóa…) |
| POST | `/api/auth/logout` | xóa cookie (+ `impersonate/stop` nếu đang mạo danh) → `{redirectTo}` |
| POST | `/api/auth/handoff` | body `{token, exp?}` → xác minh qua `customer/auth/me` → set cookie phiên (không persist) |
| ANY | `/api/v1/*` | proxy phiên KHÁCH → `${API_INTERNAL_URL}/*` (GET/POST/PATCH/PUT/DELETE), gắn Bearer + Accept-Language, 401 → xóa cookie (`lib/server/proxy.ts` dùng chung) |
| POST | `/api/hub/auth/login` | nhân viên: `POST /auth/login` (recaptchaToken rỗng) → kiểm `GET /auth/me` role ∈ {SuperAdmin, Admin} (khác → 403, không ghi cookie) → cookie `onos_hub_token` |
| POST | `/api/hub/auth/logout` | xóa cookie hub |
| POST | `/api/hub/impersonate` | body `{customerId}` → `POST /auth/impersonate` bằng token nhân viên → cookie phiên KHÁCH (giữ nguyên cookie hub) → client mở `/portal/...` |
| ANY | `/api/hub/v1/*` | proxy phiên NHÂN VIÊN (cookie `onos_hub_token`) → NestJS |

Cookie: `onos_seller_token` (httpOnly, SameSite=Lax, Secure khi `NEXT_PUBLIC_APP_URL` là https), `onos_seller_exp`, `onos_lang` (`vi|en`, 1 năm).

Env (`apps/seller/.env.example`): `API_INTERNAL_URL=http://127.0.0.1:3007/api/v1` (server→server, không qua Internet), `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ADMIN_URL`. **`next start` không đọc `.env.development`** → dịch vụ dev-hub/prod phải truyền env qua systemd/pm2.

DTO dùng (`import type` từ `shared`): `CustomerStagingOrder` (+`productLines[]`), `CustomerOrderCounts` (+`byProductLine`), `CustomerPushQuoteOrder`, `CustomerOrderSummary`, `LifecycleTrack`, `PublicOrderTrack`, `Customer`. Runtime enum từ `shared/enums`: `CustomerOrderStatus`, `CUSTOMER_ORDER_STATUSES`, `ProductLine`, `PRODUCT_LINES`.

## 4. UI Components

| Component | Vai trò |
|---|---|
| `components/shared/*` (19 file copy thghub) | badge/button/card/confirm-modal/copy-button/data-table/empty-state/page-header/safe-image/search-input/status-pill/theme-toggle/toast/… — `badge.tsx` đổi thành `StatusBadge` (i18n `orders.status.*`) + `ProductLineBadge` |
| `components/orders/product-line-tabs.tsx` | card tab 6 dòng + "Tất cả", màu/icon từ `lib/product-lines.ts` (3d Shirt #4338ca · 2d Layers #0e7490 · wood TreePine #92400e · embroidery Scissors #7c3aed · led Lightbulb #b45309 · canvas Image #047857) |
| `orders-status-filter-pills.tsx` / `orders-stats-bar.tsx` / `orders-pagination.tsx` | pill trạng thái + chip held; 5 thẻ số (tổng/chờ push/đang SX/đã xuất+hoàn tất/đang giữ — không hiện tiền vì gate thanh toán OFF); phân trang |
| `orders-list-view.tsx` + `order-row.tsx` | bảng đơn (mirror cột `apps/web/src/pages/customer/orders/index.tsx`) |
| `push-dialog.tsx` | mirror `PushToProductionDialog.tsx` |
| `stage-timeline.tsx` | 8 chặng, dùng chung detail + track |
| `layout/customer-sidebar.tsx` | logo Onos, nav `lib/navigation.ts` (`buildCustomerNav(t)` — Orders xổ 6 dòng qua `CollapsibleNavItem`), đổi ngôn ngữ, theme, user + đăng xuất |
| `layout/impersonation-banner.tsx` | banner sticky 34px, đặt `--viewas-h` để sidebar fixed né xuống |
| `providers/i18n-provider.tsx` | `I18nextProvider` + cookie `onos_lang`; root layout (server) đọc cookie → render đúng ngôn ngữ ngay HTML đầu |
| `context/session-context.tsx` | SWR `customer/auth/me` → `{profile,isImpersonating,refresh,signOut}` |

Theme: `globals.css` `@theme` + `.dark` (khuôn thghub) với **bảng màu lấy từ logo ONOSPOD chính chủ** — sidebar tối màu mận `#3a0c24` (token riêng `--color-sidebar-fg/-muted/-hover/-border`), nền trang ngả hồng `#f6edf2`, thẻ số có viền trên màu, banner mạo danh vàng logo; 6 màu dòng sản phẩm (`lib/product-lines.ts`) và màu trạng thái (`lib/constants.ts`) cũng lấy từ 6 màu logo — (`https://app.onosfactory.com/branding/logo.svg`, lưu ở `public/onos-logo.svg`, cũng là favicon `app/icon.svg`): hồng cánh sen `#c40c68` = accent (mục đang chọn, link, tab), `#a80a58` = CTA (nút hành động), xanh lá `#48a05c`→success, vàng `#f7d21e`→warning, đỏ `#e01008`→error, đỏ sẫm `#800808`/ô-liu `#7f9a2b` cho chart. Nền trung tính ngả hồng-ấm nhẹ. Dark mode nâng sáng hồng `#ff4fa3`. Font Inter + Lexend Deca (`next/font/google`). **Đừng dùng `apps/web/src/assets/images/logo.svg`/`favicon.png` — 2 file đó là ảnh rác ("Hihihi"/icon "fla"), chỉ `logo.png` (onospod) và SVG trên là thật.** Khóa theme localStorage/cookie `onos-theme`.

Responsive (07/09/2026): `PageHeader` xếp dọc dưới `sm`; ô tìm kiếm full-width dưới `sm`; **danh sách đơn và danh sách seller đổi sang dạng THẺ dưới `md`** (`components/orders/order-card.tsx`, khối `md:hidden` trong `sellers/page.tsx`) — không cuộn ngang trên điện thoại; bảng chỉ hiện từ `md`. Đã chụp kiểm ở 1440 / 1024 / 390 px + dark mode bằng Playwright (script tạm trong scratchpad, không commit).

## 5. Backend logic

- **`packages/shared/client/`** (mới, PR-C): entry **nest-free** `shared/client` (tsup entry + `exports["./client"]`) chứa schema/hàm thuần dùng chung FE/BE mà app browser cần runtime: `DesignFieldsZod`, `ProductionOrderShippingAddressZod`/`ProductionOrderTrackingZod` (+`normalizeProductionOrderTracking`), `CUSTOMER_SHIP_METHODS`/`parseCustomerShipMethod`, `CustomerImportOrderZod` (+ Item/Address), `designAcceptKeys`, `designCdnUrl`/`designVariantUrl`/`extractDesignSha`/`Sha256Zod`. Các file `dtos/*.dto.ts` **re-export** từ đây nên BE và `apps/web` (import `shared`) không đổi. Quy tắc: file trong `client/` chỉ import `zod` và file khác trong `client/`; đã kiểm `dist/client` + chunk dùng chung không có `@nestjs`.
- Không đổi NestJS. Điểm cần nhớ khi thêm màn mới: endpoint phải dưới `customer/` (RolesGuard, Customers.md §6) hoặc `public/`.
- `syncLegacyOrdersForCustomer` chỉ chạy trong `listOrders` → xem §2.4 về thứ tự gọi counts.

## 6. Performance notes

- Bundle client `.next/static` ≈ 1,5 MB; **0 chunk chứa `@nestjs`** nhờ `shared/enums` subpath + `import type` (kiểm bằng `grep -rl @nestjs .next/static`).
- `next build` ≈ 3 s (Turbopack) trên hub; 17 trang đều dynamic (`ƒ`).
- Đo dev (khách 4.926 đơn): `counts` + list 20 dòng trả < 1 s qua proxy.

## 7. Permissions

Chỉ vai `RoleType.Customer` (JWT từ `customer/auth/login` hoặc token mạo danh). Không dùng permission-catalog nội bộ. Trang `/track/*` public.

## 9. Khu quản trị `/hub` — admin quản lý toàn bộ seller (PR-E, 07/09/2026)

Người dùng chốt: app `/adm` cũ chỉ còn cho **vận hành xưởng**; mọi việc quản lý seller làm ở cổng mới với cùng giao diện thghub. `/hub` là khu **nhân viên** (Admin/SuperAdmin) sống chung app với `/portal` (khách) nhưng **phiên riêng, cookie riêng, proxy riêng**:

| | Khách `/portal` | Nhân viên `/hub` |
|---|---|---|
| Đăng nhập | `/login` → `customer/auth/login` | `/hub/login` → `auth/login` (+ kiểm role qua `auth/me`) |
| Cookie | `onos_seller_token` | `onos_hub_token` |
| Proxy | `/api/v1/*` | `/api/hub/v1/*` |
| Middleware (`proxy.ts`) | thiếu cookie → `/login` | `/hub/*` thiếu cookie hub → `/hub/login` |
| `use-api.ts` 401 | → `/login` | đang ở `/hub/*` → `/hub/login` |

Cấu trúc: `src/app/hub/login/page.tsx` (ngoài layout gate) + `src/app/hub/(app)/{layout,page,sellers,orders,notifications}` (layout `HubSessionProvider` + `HubShell` chặn vai khác Admin/SuperAdmin). Sidebar `components/hub/hub-sidebar.tsx` (`buildHubNav`: Tổng quan · Đơn hàng (xổ 6 dịch vụ) · Vận hành · Seller · Thông báo · link "Vận hành xưởng" → `NEXT_PUBLIC_ADMIN_URL`).

Trang:
- **`/hub`** — `GET admin/customer-orders/stats`: 5 KPI (seller có đơn, tổng đơn khách, chờ đẩy, đang SX, đang giữ), thanh theo dòng/trạng thái (bấm → `/hub/orders` đúng bộ lọc), top 10 seller (số đơn/chờ/đang SX + nút xem như seller), 8 đơn mới nhất.
- **`/hub/sellers`** — `GET /customers?page&limit&search&tier&hasAccount&deleted` (API quản trị khách sẵn có, Customers.md): cột seller/hạng/số đơn (link sang `/hub/orders?seller=`)/đơn gần nhất/trạng thái; hành động **Xem như seller**, sửa (tên/điện thoại/hạng — `PATCH /customers/:id`), reset mật khẩu (`POST .../reset-password`, tự sinh → hiện 1 lần), khóa/mở (`PATCH .../status`), xóa mềm/khôi phục.
- **`/hub/orders`** — trang OMS riêng `components/hub/hub-orders-view.tsx` (khuôn `oms/orders-list-view.tsx` của thghub, 07/09/2026): header + nút làm mới → `DateRangeFilter` (BE `dateFrom/dateTo` theo `pushedAt ?? createdAt`, giờ VN) → thẻ số → **tab 6 dịch vụ** (`ProductLineTabs`, số từ `counts` không lọc dòng) → pill trạng thái (số theo dòng đang chọn) → tìm kiếm + `SellerFilterPicker` (`components/hub/seller-filter-picker.tsx`, gõ tìm seller, bấm tên seller trong bảng cũng khoá theo seller) → bảng đầu xám 12 cột (đơn/seller/sản phẩm/dịch vụ/SL/tổng/trạng thái/**Nội bộ**/khách nhận/vận đơn/**ghi chú**/ngày; ghi chú = `customer_orders.note`, 2 dòng + tooltip, thẻ điện thoại hiện khi `adminMode` — clone cột NOTE hệ cũ, 01/10/2026). Lọc **Xưởng** (`<select>`, `GET /factories/options`) + ô tick **Ưu tiên** (clone `manufacture` + `Priority` hệ cũ): tham số `factoryId`/`priority` đi vào CẢ danh sách lẫn hai lần đếm (`AdminOrderItemScopeZod`); BE `adminItemScopeStages()` quy về tập `productionId` của đơn xưởng chưa hủy thỏa điều kiện rồi `$match items.productionId $in` — chính xác, KHÔNG có trần (khác `loadCandidatePids`, vượt trần là bỏ lọc). Đơn chưa đẩy không có item ở xưởng nào nên không khớp lọc xưởng. **Cột Nội bộ** (`components/hub/internal-status.tsx`, 07/09/2026 — để admin support seller không phải mở app xưởng): chip chặng hiện tại theo màu chặng · xưởng · designer + trạng thái thiết kế · ưu tiên P1–3 · lỗi sản xuất `[nguồn] loại — ghi chú` (đỏ) · lý do giữ (vàng) · ghi chú soát tool / file lỗi / in / lý do designer từ chối (gộp, bỏ trùng, tối đa 2) · log gần nhất (`orderLogs`: action:field · người · giờ). Dữ liệu từ `items[].internal` (`AdminInternalStatusZod`) — BE `toAdminStagingOrder` chép từ `prodOrders` (PROD_DERIVE_FIELDS mở rộng thêm `factoryId assignee priority productionError* toolResult* toolCheckErrorNotes errorFileNote printStatusNote designerRejectedReason`) + `loadAdminRefs()` tra `factories`/`users`/`orderLogs` theo tập id của 1 trang (3 truy vấn nhỏ, không $lookup trong pipeline lớn). `toStagingOrder` cho khách KHÔNG chép các trường này (đã kiểm: `customer/orders` không có `internal`) + phân trang trong card; mobile dùng `OrderCard showViewAs={false}`. **Chỉ đọc, không CTA mạo danh** (mạo danh làm ở `/hub/sellers`). Mọi bộ lọc nằm trên URL (`line,status,held,q,seller,from,to,page,limit`). Sidebar hub: **Orders** xổ "Tất cả dịch vụ" + 6 dịch vụ (`buildHubNav`), mỗi dịch vụ có route `/hub/orders/<line>` — **mọi link mang mặc định `?status=processing`** như menu hệ cũ (`/orders?status=Processing`), pill "Tất cả" vẫn một chạm; `hrefDangChon` so khớp theo phần path của href (bỏ query) để mục menu vẫn sáng (`HubOrdersView lockedLine` — ẩn tab dịch vụ). **Khung cố định** (cả `/hub/orders*` lẫn trang dịch vụ seller): trang cao đúng `100dvh` trừ padding và banner mạo danh (`--viewas-h`), phần đầu + bộ lọc `shrink-0`, bảng `flex-1 overflow-auto` với `thead sticky`, phân trang `shrink-0` neo đáy — header/footer không trôi khi cuộn.
- **`/hub/notifications`** — `POST /customer-notifications` (1 seller hoặc broadcast) + `GET /customer-notifications/sent`.

### 9.1 Vận hành sản xuất `/hub/operations` (07/09/2026)

Tab dịch vụ (07/09/2026, sửa sau phản hồi "phễu giống nhau ở mọi dịch vụ"): chọn dịch vụ → `productLine` được truyền vào CẢ 3 nguồn — `orders/lifecycle-overview` (phễu 8 chặng), `admin/customer-orders` (bảng trạng thái từng đơn) VÀ `ceo/overview` (KPI kỳ, SLA, chất lượng, theo xưởng — `CeoOverviewQueryZod.productLine`, `base` match thêm `productLine`, cache key có dòng). Chỉ khối "Nhận định" (`ceo_reports`) và "Nhân sự" là toàn hệ thống. Đã kiểm: thêu `in 93/out 93` vs tất cả `3.486/3.731`.

Góc nhìn quản trị toàn quy trình, **chỉ đọc**, không endpoint tổng hợp mới — gọi 4 API sẵn có qua proxy hub: `GET ceo/overview?from&to` (CeoDashboard.md), `GET orders/lifecycle-overview?from&to&factoryId` (OrderLifecycle.md), `GET orders/factory-overview`, và `GET admin/customer-orders?stage=<chặng>` (filter mới, xem dưới). Bộ lọc trên URL: `from/to` (mặc định 7 ngày gần nhất), `factory`, `line` (tab dịch vụ ngay dưới header — `GET orders/lifecycle-overview` nhận thêm `productLine`, PRD-8), `stage`, `page`. 5 khối (`components/hub/operations-view.tsx`):
1. **KPI**: vào SX · ra SX (so kỳ trước) · đang chạy (tuổi tồn TB) · quá hạn ≥3 ngày · đúng hẹn N2 (so kỳ trước).
2. **Phễu 8 chặng**: mỗi chặng tồn + lỗi + làm lại + xong trong kỳ, thanh tỉ lệ, chặng nút thắt (`totals.bottleneckStage`) tô đỏ; **bảng "Trạng thái sản xuất từng đơn"** luôn hiện dưới phễu (15 dòng/trang, phân trang): mặc định đơn đang sản xuất của dịch vụ đang chọn; bấm chặng → lọc đúng chặng; cột chặng hiện tại tô màu chặng + Giữ/Làm lại, cột "Ở chặng" = tuổi từ `currentStageAt`. KPI/SLA/xưởng/nhân sự vẫn là số toàn hệ (CEO overview chưa lọc theo dòng).
3. **Đúng hẹn & quá hạn**: 3 thanh N0/N1/N2 so mục tiêu, quá hạn theo xưởng, 6 đơn cũ nhất. **Theo xưởng**: bảng vào/ra/tồn/ra-ngày/xả hết/N2/lỗi (CEO) + bảng in/đang in/chưa in/chưa gán thiết kế/lỗi (factory-overview).
4. **Chất lượng** (tỉ lệ lỗi, theo nguồn, loại SP hay lỗi) + **Nhân sự** (designer xong/tồn/làm lại — tồn ≥30 tô đỏ; công nhân theo công đoạn).
5. **Phát hiện & việc cần làm**: `findings[]` của CEO overview, câu chữ dịch bằng namespace `ceoDashboard` (copy từ `apps/web` qua `sync-i18n`, `findings.<code>` + `actions.<action>`).

Thao tác (gán designer, đổi xưởng, báo lỗi) vẫn ở app xưởng: nút "Mở app vận hành xưởng" → `NEXT_PUBLIC_ADMIN_URL/ffm/orders/workshop?factoryId=`.

**BE mới:** `GetAdminCustomerOrdersZod.stage` (`WORKSHOP_STAGE_FILTER_KEYS`) — `listOrdersAdmin` `$match` `$expr $in [stage, $map(prodOrders chưa hủy → workshopStageSwitchExpr('$$p.'))]`; `workshopStageSwitchExpr(prefix)` nhận tiền tố để chạy trên mảng `$lookup` (mặc định `'$'`, các nơi gọi cũ không đổi). Đo dev: press 905 · designer 326 · tool-check 975 đơn khách.

**Mạo danh trong app** (`components/hub/view-as-button.tsx`): `POST /api/hub/impersonate` → BE `POST /auth/impersonate` (AUTH-1, chỉ SuperAdmin — Admin thường bị BE từ chối, nút vẫn hiện nhưng báo lỗi) → cookie phiên khách; banner vàng ở `/portal`; nút "Thoát" → `POST /api/auth/logout` thấy còn cookie hub → `customer/auth/impersonate/stop` rồi về **`/hub/sellers`** (không còn cookie hub → về `NEXT_PUBLIC_ADMIN_URL` như trước).

**BE mới (chỉ đọc):** `apps/api/src/modules/customer-portal/customer-order-admin.controller.ts` — `GET admin/customer-orders` (+`/counts`, `/stats`), `@Auth([Admin])` (SuperAdmin qua guard); prefix `admin/...` cố ý không chứa `/customer/` nên token khách bị `RolesGuard` chặn (đã kiểm: 403). Service: `buildDerivePipeline(customerId | null)` — null = không scope khách; `assembleCounts`/`countsPipelines` tách từ `getCounts`; `listOrdersAdmin` (+ `$lookup customers` → `customer{userSku,userEmail,fullName,tier}`), `getCountsAdmin`, `getStatsAdmin` (group theo `customerId`, top 10, `$facet` đếm seller). DTO `AdminCustomerStagingOrderZod`/`GetAdminCustomerOrdersZod`/`AdminCustomerOrderStatsZod` ở `customer-order.dto.ts`. Import enum trong file API phải từ `'shared'` (KHÔNG `@shared/enums` — alias nguồn không tồn tại sau build, API dev sập `Cannot find module`).

Đo dev (07/09/2026): 125 seller có đơn, 38.095 đơn staging. Hiệu năng tải trang `/hub/orders*` xem §9.2.

**Bộ lọc ngày dạng pill** (`components/shared/date-range-filter.tsx`, 07/09/2026 — dùng ở `/hub/orders*` + `/hub/operations`): quick filter HIỆN THẲNG thành dải pill "Mọi thời gian · Hôm nay · Hôm qua · Tuần này · Tháng này · Tháng trước · Năm nay" (i18n `seller.dateFilter.*`), pill cuối "Tùy chọn" mở popover từ/đến + bước tháng (bấm tên tháng = cả tháng); khoảng tùy chọn hiện ngay trên pill đó. Không còn nút trigger gộp "All time" phải bấm mở popover. Trang Operations: bộ lọc xưởng + pill ngày nằm HÀNG RIÊNG dưới tiêu đề (nhét vào `actions` của `PageHeader` làm tiêu đề gãy dòng), **khung cố định từ `lg`** (tiêu đề + lọc + tab dịch vụ `shrink-0`, phần dưới `overflow-y-auto`; dưới `lg` để trang cuộn thường vì phần đầu đã chiếm nửa màn).

**Dữ liệu hub luôn mới (07/09/2026):** staging `customer_orders` được bồi tăng dần từ `orders` cho mọi khách (cron 5' + trước mỗi lần admin đọc — `CustomerOrderIntake.md`), nên lọc "Hôm nay" ở `/hub/orders*` có đơn xưởng vừa import, không cần khách mở portal.

### 9.5 Ops lên đơn HỘ seller `/hub/orders/create` (08/09/2026)

Trước đó chỉ seller tự đặt được đơn thủ công; ops muốn lên đơn hộ phải mạo danh. Khuôn lấy từ wizard của thghub (`components/oms/order-create-wizard.tsx`, cùng một component chạy `mode="seller"` ở `/portal/orders/create` và `mode="staff"` ở `/oms/create`, khác đúng bước "Select Seller").

- **`components/hub/hub-create-order-view.tsx`**: 3 bước — ① chọn dịch vụ (6 dòng sản phẩm) ② chọn seller (`SellerFilterPicker` dùng lại) ③ **nhúng thẳng `CreateOrderView`** với `mode="staff"` + `customerId`. Dải bước hiện ở đầu, bấm Quay lại sửa được bước trước; bộ chọn nằm trên URL (`line`, `seller`) nên chia sẻ link được.
- **KHÔNG nhân bản màn đặt đơn.** `CreateOrderView` nhận thêm `mode`/`customerId`/`onCreated`: `seller` gọi `customer/orders` như cũ, `staff` gọi `admin/customer-orders?customerId=…`. Lệch một luật kiểm (đòi file in theo `printArea`, giá theo tier, sinh `productionId`) giữa hai bản là sinh đơn hỏng mà không ai biết.
- **BE** (`customer-order-admin.controller.ts`, `@Auth([Admin])`): `GET admin/customer-orders/catalog?customerId=` (catalog THEO TIER seller đích — ops phải thấy đúng giá seller thấy; token nhân viên không gọi được `customer/catalog`), `POST admin/customer-orders?customerId=` (đặt hộ), `POST admin/customer-orders/push?customerId=` (đẩy hộ). Cả ba nạp khách theo id rồi gọi **chính** `placeOrder`/`pushToProduction`/`getCatalog` mà seller dùng.
- **Đơn tạo ra ở trạng thái CHỜ ĐẨY** y như seller tự đặt — không tự đẩy, vì đẩy là chiếm mã sản xuất và vào hàng đợi xưởng, phải có chủ đích. Nút "Lên đơn hộ seller" đặt cạnh nút Làm mới ở đầu `/hub/orders*`, trang dịch vụ thì mang sẵn `?line=`.
- Kiểm dev 08/09/2026: catalog theo tier trả 3 sản phẩm gỗ, đặt hộ tạo staging `16,37 $` mã `DG-46559-32895`; e2e phủ cả 3 bước (35 kiểm tra).
- **Ô tải file phải đi đường của vai đang dùng màn.** `FileUrlOrUploadInput` nhận thêm `designApi` (`SELLER_DESIGN_API` hoặc `hubDesignApi(customerId)`). Bản đầu để nguyên đường seller nên ở hub bốn lệnh gọi `customer/designs/*` trả 401 — và 401 làm FE **đá nhân viên về trang đăng nhập ngay khi ô tải file hiện ra**, tức ops không lên nổi đơn. BE thêm bản sao staff `GET/POST admin/customer-orders/designs/{upload-config,presign,confirm,:sha256}` (`@Auth([Admin])`): cùng `DesignStorageService`, file vẫn ghi tên **seller đích** nên quota/dedup/vòng đời không đổi.
- **Khung màn hình cố định trên laptop** (nguyên tắc vận hành: header/sidebar đứng yên, không cuộn cả trang): shell `/hub` và `/portal` đổi sang `lg:h-screen lg:overflow-hidden` với `main` là vùng cuộn duy nhất; màn đặt đơn `lg:h-full` chia hai cột tự cuộn riêng, thẻ ghi chú + nút **Đặt đơn** `lg:shrink-0` neo đáy cột phải. Trước đó nút Đặt đơn nằm dưới đáy trang, ops phải cuộn cả trang mới bấm được. E2E chốt ở 1440×900 và 1366×768: trang không tự cuộn (`scrollHeight - clientHeight ≤ 4`) và đáy nút nằm trong màn hình.
- **Bước tiếp theo sau khi tạo đơn**: đơn nằm ở tab **Chờ đẩy**; mỗi hàng có nút **Đẩy SX** (`POST admin/customer-orders/push?customerId=`) → đơn sinh `OrderEntity` theo từng item và vào hàng đợi xưởng; sau đó cột Vận đơn mở nút Mua label (§9.3).

#### 9.5a Kiểm hình thức địa chỉ giao hàng (08/09/2026)

Phản hồi vận hành: "add địa chỉ ko có verify gì cả, điều gì cũng đc". Form cũ chỉ đòi *có điền* — địa chỉ sai chỉ lộ ra lúc mua vận đơn (hãng từ chối) hoặc khi hàng bị trả về, lúc đó đã tốn tiền in, sản xuất và ship.

- `apps/seller/src/lib/address-check.ts` — `checkAddressFormat()` chạy tại trình duyệt, KHÔNG gọi mạng: tên ≥ 2 ký tự · địa chỉ ≥ 5 ký tự **và phải có chữ số** (địa chỉ Mỹ hầu như luôn có số nhà) · thành phố ≥ 2 · điện thoại 9–15 chữ số · email đúng dạng · **đơn Mỹ** (`US`/`USA`/`United States`/để trống) bắt buộc bang thuộc 59 mã USPS và mã bưu điện `#####` hoặc `#####-####`; nước khác chỉ đòi có mã bưu điện. `normalizeAddress()` cắt khoảng trắng + viết hoa mã bang trước khi gửi.
- Lỗi hiện **ngay dưới ô sai** (khoá `seller:addressCheck.*`), gộp cùng bộ lỗi "bỏ trống" sẵn có; còn lỗi thì không gọi API.
- Xác minh USPS thật (`shipping-vnp/check-address`) vẫn là bước riêng của hub, cố ý KHÔNG chặn đặt đơn khi hãng đang lỗi.

### 9.4 Kiểm end-to-end tự động (08/09/2026)

`apps/seller/e2e/run.mjs` — chạy `pnpm --filter ./apps/seller e2e`. Không thêm dependency: dùng Playwright có sẵn trên máy (`PLAYWRIGHT_PATH`), mặc định soi `http://127.0.0.1:3017`, đổi bằng `E2E_BASE`.

Vì sao có: hai lần liên tiếp tính năng mới làm hỏng tính năng cũ — thêm cột tick ở hub làm **cột mã đơn văng khỏi vị trí cố định** (ops phát hiện), và ghi sai kiểu `printArea` làm **catalog trả 500**. Cả hai đều nhìn 5 giây là thấy nhưng không ai soi lại mọi màn sau từng lần sửa.

43 kiểm tra, phủ: seller đăng nhập → catalog (thẻ sản phẩm, số đếm theo dòng, KHÔNG 500) → chi tiết sản phẩm (bảng SKU, không lộ giá vốn) → màn đặt đơn → danh sách đơn dịch vụ (thẻ số, pill, **cột mã đơn cố định**) → import CSV (nút tra SKU + template); hub đăng nhập → danh sách đơn (**cột tick dính `left:0`, cột mã đơn dính `left:32px`**, còn cột Nội bộ, còn cột vận đơn) → nút mua label + thanh chọn hàng loạt → ops lên đơn hộ seller 3 bước → **khung cố định ở 1440×900 và 1366×768** → **địa chỉ bậy bị chặn trước khi tạo đơn** (thêm sản phẩm thật vào đơn rồi gõ bang/mã bưu điện/điện thoại sai) → Vận hành (phễu 8 chặng, bảng đơn, pill ngày) → danh sách seller. Thoát mã 1 khi có kiểm tra hỏng, in rõ chỗ hỏng.

**Đọc kết quả e2e trên dev (01/10/2026):**
- Luồng **"Hub — ops lên đơn hộ seller"** (bước 1 chọn dịch vụ timeout) đang ĐỎ SẴN trên bản dev, đã đối chiếu: đỏ y hệt ở bản chưa có thay đổi nào. Đừng mất buổi truy nó khi kiểm việc khác.
- API dev (`onos-api-dev`, :3007) tự khởi động lại mỗi lần có code gộp vào `dev` (timer autopull + nodemon). Chạy e2e trúng lúc đó sẽ ra hàng loạt FAIL giả (log Next có `ECONNREFUSED 127.0.0.1:3007`). Đợi `/api/v1/health` 200 liên tục ~1 phút rồi chạy, và soát log có ECONNREFUSED trong lúc chạy không trước khi tin kết quả.
- Kiểm code của một worktree: chạy seller của worktree đó ở cổng khác (`next dev -p 3117`, tách khỏi tác vụ nền) rồi `E2E_BASE=http://127.0.0.1:3117`; API vẫn là bản dev.

### 9.3 Mua vận đơn ngay trên `/hub/orders*` (08/09/2026)

Hôm nay ops lên đơn ở OnosPod rồi sang OnosExpress mua label — hai hệ, hai lần đăng nhập. Hub gom lại: ops thấy đơn nào chưa có vận đơn thì mua ngay tại hàng, hoặc tick nhiều đơn mua một lượt (khuôn ops bên thghub).

- **Cột "Vận đơn"** (`components/hub/shipment-cell.tsx`) thay cột tracking chỉ-đọc cũ: có mã thì hiện mã + nguồn (`VNP` hay khách tự cấp) + trạng thái + link tải label; chưa có thì hiện nút **Mua label**. Đơn thiếu cân nặng hiện cảnh báo vàng (mua với cân sai là sai cước).
- **Mua hàng loạt:** ô tick ở cột đầu CHỈ hiện với đơn mua được (`canBuyLabel`: có `orderRefId`, chưa có mã vận đơn); chọn xong hiện thanh "Đã chọn N đơn → Mua vận đơn đã chọn". Mua **TUẦN TỰ** chứ không song song — mỗi lượt trừ ví và gọi hãng, bắn đồng thời là mở đường mua trùng và timeout hàng loạt; kết quả trả về "N thành công, M lỗi" kèm lỗi đầu tiên.
- **Không nhân bản nghiệp vụ:** gọi thẳng `POST /api/hub/v1/shipping-vnp/orders/:orderRefId/shipment` — chính endpoint của khu quản trị, nên chống mua trùng (`requestId` + unique index), giữ chỗ `purchasing`, đối soát ví, hủy fail-closed vẫn nằm nguyên ở `ShippingLabelPatterns.md`. Hub chỉ là chỗ bấm.
- **BE cấp thêm cho hub** (`AdminInternalStatusZod`): `orderRefId` (`OrderEntity._id` — endpoint mua nhận `_id`, không nhận mã sản xuất), `weight`, và `shipment {trackingCode, carrier, labelUrl, shipmentId, status, cancelledAt, provider}` gộp bởi `shipmentChoHub()` — ưu tiên snapshot VNP còn hiệu lực, sau đó tới vận đơn khách tự cấp. `PROD_DERIVE_FIELDS` thêm `weight width height length`.
- **Đơn thiếu cân nặng** (đơn đẩy trước 08/09/2026 chưa chép cân nặng từ biến thể — prod còn 30.363/52.616 đơn như vậy): ô vận đơn cho ops **nhập gram tại chỗ** rồi mua, thay vì nút chết. Số nhập chỉ dùng cho lượt mua đó; muốn hết cảnh báo vĩnh viễn thì điền cân nặng cho biến thể ở trang Sản phẩm (đơn MỚI tự lấy theo biến thể). Mua hàng loạt **cố ý bỏ qua** đơn thiếu cân nặng và báo số bị bỏ — gộp vào là mua với cân sai.
- **Cân nặng là bắt buộc trong payload** (`weightGram` của `CreateVnpShipmentZod`). Bản đầu 08/09/2026 quên gửi nên mọi lần bấm đều trả `400 weightGram - error.fields.undefined`; e2e đã thêm phép kiểm bắt request thật để không tái diễn.
- **Vẫn CHỈ Admin/SuperAdmin bấm** — seller không mua label; khi nào mở cho seller thì phải làm ví/ghi nợ theo seller trước, vì ví VNP là ví CHUNG của công ty.

**Cân nặng đơn cũ — `apps/api/scripts/backfill-order-weight.mjs` (08/09/2026).** Cân nặng chỉ được chép vào `OrderEntity` từ khi `pushToProduction` biết đọc biến thể, nên mọi đơn đẩy trước mốc đó để trống và ops phải gõ tay từng đơn. Script điền lại từ biến thể theo ĐÚNG luật `pickVariation` (lọc theo `size` rồi `color`, **chỉ nhận khi còn đúng 1 ứng viên** — điền cân sai tệ hơn để trống vì cước tính theo cân), chỉ ghi vào trường đang trống và không đụng đơn đã hoàn thành/đã hủy. Mặc định thử khô, `--yes` mới ghi, `--all` để gồm cả đơn đã xong.

| Phạm vi | prod 08/09/2026 | dev (đã chạy) |
| --- | --- | --- |
| Tổng đơn | 52.764 | — |
| Thiếu cân nặng | 30.628 | 1.914 (đơn còn mở) |
| Thiếu cân nặng **và còn mở** | 2.402 | 1.914 |
| Điền được từ biến thể | chưa chạy | 1.617 (84 %) |

Phần không điền được trên dev: 279 đơn có biến thể chưa khai cân nặng (phải nhờ nhóm sản phẩm điền ở trang Sản phẩm), 16 đơn biến thể mơ hồ, 2 đơn không còn product config.

#### 9.3a Đơn thuộc xưởng ngoài luồng sản xuất (08/09/2026)

Ops báo: đẩy đơn xong tìm trong app xưởng **không thấy đơn đâu**. Không phải mất đơn — sản phẩm đó map vào **xưởng US**, mà `apps/api/src/utils/excluded-factory.ts` cố ý loại xưởng này khỏi MỌI danh sách/thống kê/luồng của app xưởng (Orders.md §21). Đo prod 08/09/2026: **8 sản phẩm `active` (đều hàng may 2D) đang map vào xưởng US**, nên bất kỳ seller nào đặt mấy mã này đều gặp lại cảnh đó.

- BE gắn cờ `internal.outOfProduction` (`AdminInternalStatusZod`) khi xưởng của đơn có `shortName` trùng `EXCLUDED_PRODUCTION_FACTORY_SHORT_NAME`; hub hiện nhãn vàng **"Ngoài luồng SX"** cạnh mã xưởng, tooltip chỉ chỗ theo dõi. FE KHÔNG tự so tên xưởng.
- Đây mới là phần **nói rõ tình trạng**. Việc 8 sản phẩm kia có nên map sang xưởng trong nước, chặn ở bước đẩy, hay ẩn khỏi catalog là **quyết định nghiệp vụ chưa chốt** — chưa đổi luồng đi của đơn.

Trạng thái 08/09/2026: đăng nhập VNP môi trường thật (`nexoglobal.global`) đã thông, `checkAddress` gọi sống trả 200. Mua label còn chặn ở hai việc VẬN HÀNH, không phải code: **ví VNP đang 0 $** (hãng đòi tối thiểu 50 $) và **tài khoản chưa có địa chỉ gửi nào** (`remote-addresses` trả rỗng) nên `resolveFromAddressId` báo "Chưa cấu hình địa chỉ gửi hàng". Tạo địa chỉ ở `/adm/settings/vnp-shipping` rồi gán xưởng là chạy.

### 9.2 Hiệu năng tải `/hub/orders*` (F5, 07/09/2026)

Trước tối ưu, F5 `/hub/orders` chờ ~6 s: `admin/customer-orders` 6,3 s + `counts` 5 s (×2, cho tab + pill) + `stats` 5,4 s — nguyên nhân là `$lookup orders` + derive trạng thái chạy trên CẢ 38k document staging rồi mới phân trang.

Đã sửa ở `apps/api/src/modules/customer-portal/customer-order.service.ts`:

- **`buildPagedListPipeline()`** (dùng chung `listOrders` khách + `listOrdersAdmin`): lọc mức document trước (`customerId`, khoảng ngày, `items.productLine`, tìm kiếm) → sort `pushedAt ?? createdAt` → `$facet` **phân trang TRƯỚC**, chỉ `$lookup`/derive cho 20 dòng của trang. Đường nhanh này áp khi KHÔNG lọc trạng thái/giữ/chặng; riêng `status=pending` suy được ở mức document (`status≠cancelled`, `refundedAt=null`, `pushedAt=null`, mirror `statusDerived`) nên cũng đi đường nhanh. Lọc `status` khác / `held` / `stage` vẫn phải derive toàn bộ rồi mới sort + phân trang (đường đầy đủ). Mọi aggregate bật `allowDiskUse`.
- **Cache admin 60 s** cho `getCountsAdmin`/`getStatsAdmin` (`cachedAdmin()` — stale-while-revalidate: hết hạn vẫn trả bản cũ và tính lại nền, request trùng key dùng chung 1 promise; `warmAdminCache()` làm ấm `counts:{}` + `stats` 10 s sau boot). Số tab/pill trễ tối đa 60 s so với DB — chấp nhận được cho màn quản trị.
- Đếm theo dòng dùng CÙNG luật với danh sách: chỉ `items.productLine` (không fallback `prodOrders.productLine`) — trước đây tab 3D đếm 37.179 mà danh sách 37.004 vì 178 staging cũ thiếu `items.productLine` (đã backfill trên dev từ `orders.productLine`; prod chạy lại cùng lệnh mongosh khi deploy).
- FE `hooks/use-api.ts`: SWR `keepPreviousData` + `dedupingInterval` 5 s — đổi tab/trang giữ bảng cũ tới khi có dữ liệu mới, không nháy trắng.

| Gọi | Trước | Sau |
|---|---|---|
| `admin/customer-orders?page=1&limit=20` (38.095) | 6,3 s | 0,09 s |
| … `&productLine=3d` (37.180) | ~6 s | 0,09 s |
| … `&status=pending` | ~6 s | 0,01 s |
| … `&status=in-production` / `&stage=print` | ~6 s | 4,6 s (đường đầy đủ) |
| `admin/customer-orders/counts` | 5,0 s | 5,0 s lần đầu sau boot (đã làm ấm) → 0,005 s |
| `admin/customer-orders/stats` | 5,4 s | 5,4 s lần đầu → 0,006 s |
| `customer/orders` (seller, ~4,9k đơn) | ~1 s | 0,15 s |

- **Tra ngược từ `orders` để thu hẹp trước khi derive** (`loadCandidatePids()`, 07/09/2026 — cho lọc `stage`/`status` in-production·processing·fulfilled/`held`, cả seller lẫn hub): mỗi điều kiện suy ra tập `productionId` đơn sản xuất CÓ THỂ thỏa (điều kiện cần) bằng find/aggregate thẳng trên `orders` (có index), giao tập nếu nhiều điều kiện, rồi `$match items.productionId $in` ở mức document → derive chỉ chạy trên vài nghìn ứng viên; `$match statusDerived/heldAny/stage` sau derive vẫn giữ nên kết quả khớp từng đơn với đường cũ (đã đối chiếu total 2.769 in-production, 16 chặng In). Trần 20.000 id → vượt (completed ≈ 31k) hoặc `cancelled`/`refunded` thì về đường đầy đủ.

| Lọc (admin, 38k staging) | Trước | Sau |
|---|---|---|
| `status=in-production` | 4,7 s | 0,6 s (theo dịch vụ: 0,1 s) |
| `stage=print` / `tool-check` / `designer` | 4,6 s | 0,2–0,4 s |
| `status=processing` / `fulfilled` / `held=true` | ~4,6 s | 0,2 / 0,4 / 0,01 s |
| `status=completed` (31k, vượt trần) | 5,9 s | 5,9 s |

- **Cột "Đơn hàng" cố định bên trái** (07/09/2026): bảng `/hub/orders*` (`STICKY_TH`/`STICKY_TD` trong `hub-orders-view.tsx`) và bảng dịch vụ seller (ô tick + ô đơn, `left-0`/`left-10`, `orders-list-view.tsx` + `order-row.tsx`) dùng `position: sticky` trong khung `overflow-auto` sẵn có; ô cố định có nền đặc + viền phải, hàng `group` để đổi nền khi hover.

Còn chậm (chưa làm): `status=completed` và tính lại counts/stats nền vẫn ≈ 5–6 s vì phải derive toàn bộ. Hướng cấu trúc nếu cần: ghi **snapshot trạng thái** (`statusSnapshot`/`stageSnapshot`) lên document staging khi push/transition + cron đồng bộ, rồi lọc/đếm bằng index — khi đó mọi đường về < 0,2 s.

### 9.6 Ví seller + seller tự mua label (09/09/2026)

- Portal thêm trang **`/portal/wallet`** (số dư USD + sổ cái before→after + bảng giá) và nút **"Mua vận đơn"** trên đơn cod/tiktok đã push ở `/portal/orders*` (`BuyLabelDialog`). Hub thêm **`/hub/wallets`**: nạp/điều chỉnh ví (note bắt buộc), hạn mức nợ, drill sổ cái, upload bảng giá CSV + công tắc tổng.
- BE: `customer/wallet*` + `customer/shipping/*` (`@Auth([Customer])`) · `admin/customer-wallets*` + `admin/seller-shipping/*` (`@Auth([Admin])`). Chi tiết đầy đủ: [`SellerWallet.md`](SellerWallet.md).

## 8. Vận hành & hạ tầng (PR-D)

| Môi trường | Chạy bằng | Env | Vào từ |
|---|---|---|---|
| Dev hub | systemd `onos-seller-dev` (`/etc/systemd/system/onos-seller-dev.service`, `pnpm exec next dev -p 3017`, log `/var/log/onos-seller.log`) | `apps/seller/.env.development` (next dev đọc) | cloudflared `seller-dev-onos.autonow.vn` → `localhost:3017` (`cloudflared/config.yml`) |
| Prod VPS | pm2 `onosfactory-seller` (`apps/seller/ecosystem.config.cjs`, `next start -p 3017`) | `apps/seller/.env.production` (copy từ `.env.production.example`, không commit) | nginx `seller.onosfactory.com` → `127.0.0.1:3017` (Deployment-Ubuntu-VPS.md §8) |

- `deploy.sh`: sau bước web, **nếu có** `apps/seller/.env.production` → `pnpm --filter ./apps/seller build` (heap 2048) → `pm2 restart ecosystem.config.cjs --update-env` → health `GET /login` = 200 (12×5 s); thiếu env → bỏ qua (server chưa bật seller). `--rollback` build lại seller theo bản cũ.
- CORS API (`main-nest.ts`): thêm `https://seller.onosfactory.com` dự phòng; luồng chính là proxy server→server nên không cần CORS. Dev tunnel thêm vào `ALLOWED_ORIGINS` nếu gọi thẳng.
- **Redirect `/customer/*` ở admin** (`apps/web/src/App.tsx` `SellerRedirectGate`): khi `VITE_SELLER_URL` khác rỗng, `/customer/login|dashboard|orders|orders/new|orders/import|orders/:productionId|account` chuyển hẳn sang seller (`/login`, `/portal`, `/portal/orders`, `/portal/orders/create|import|:pid`, `/portal/account`, giữ query). Catalog/API docs/`/track`/landing vẫn ở `apps/web` tới đợt 2. Rỗng → chạy như cũ.
- R2: thêm origin seller (dev + prod) vào CORS bucket trước khi bật upload trực tiếp (DesignStorage.md).

### 8.2 Mô hình nhánh + máy dev tự kéo theo nhánh `dev` (08/09/2026, chốt lại 10/09/2026)

**Mô hình nhánh** (chốt 10/09/2026 để nhiều dev vào chung được):

```
nhánh riêng của bạn  →  dev  →  main  →  prod
```

| Nhánh | Vai trò |
|---|---|
| nhánh riêng / `feat/*` | chỗ làm việc, cắt ra từ `dev` |
| **`dev`** | nhánh TÍCH HỢP — code mọi người gặp nhau; **máy dev bám đúng nhánh này** |
| **`main`** | nhánh PHÁT HÀNH — merge `dev` vào đây rồi mới `./deploy.sh` trên prod |

KHÔNG có `master`. Nhánh `develop` cũ (dừng ở 28/08/2026, sau `main` 127 commit, không hơn commit nào) **đã chết** — đừng dùng. Nhánh cá nhân `tuantran` đã **xoá 10/09/2026**: một mình thì tiện, thêm người là hai luật, và dev server bám nhánh cá nhân khiến người khác merge vào `dev` mà không thấy gì đổi.


Máy dev (`ubuntu-server`) chạy **một** cây làm việc `/root/.vibedev/repos/onos` với ba service tự nạp lại: `onos-api-dev` (nodemon, 3007) · `onos-web-dev` (vite, 5173) · `onos-seller-dev` (next dev, 3017), phơi ra qua cloudflared thành `dev-onos` / `api-dev-onos` / `seller-dev-onos` `.autonow.vn`.

`dev-autopull.sh` + timer `onos-dev-autopull` chạy mỗi phút: fetch nhánh **`dev`**, fast-forward, `pnpm install` chỉ khi `pnpm-lock.yaml` đổi, build lại `shared`/`core` chỉ khi hai gói đó đổi, rồi restart ba service. Mã trong `apps/*` thì watcher tự nạp. Nghĩa là **đẩy code lên nhánh `dev` từ bất kỳ máy nào là một phút sau chạy trên dev**, không cần SSH.

- Chỉ đụng nhánh `dev`; các nhánh khác đẩy lên không ảnh hưởng gì tới máy này.
- Không bao giờ `reset --hard`: nhánh lệch, hoặc còn file **đang theo dõi** chưa commit (đang sửa dở trên máy) thì bỏ lượt và ghi log. File lạ chưa theo dõi không chặn.
- Cài/gỡ: `./dev-autopull.sh --install` · `systemctl disable --now onos-dev-autopull.timer`. Đổi nhánh: `ONOS_DEV_BRANCH=<nhánh> ./dev-autopull.sh --install`. Log: `/var/log/onos-dev-autopull.log`.
- Kiểm 08/09 và 10/09/2026: lùi cây làm việc 1 commit, 60 giây sau timer tự kéo lên và ghi đúng một dòng log.
- **Cây làm việc CHÍNH LÀ dev server.** Ai ngồi trực tiếp máy này thì sửa file là dev đổi ngay (watcher tự nạp), nhưng đổi lại: còn file chưa commit thì auto-pull bỏ lượt, nên bản trên `dev` của người khác tạm thời chưa lên. Commit hoặc stash là lượt sau chạy tiếp. Tệ hơn là **commit ở máy mà quên push**: người khác push `dev` thì hai bên lệch nhau, script dừng hẳn và ghi `DỪNG: nhánh trên máy dev đã lệch` — phải vào gỡ tay. Xem log trước khi nghi ngờ máy hỏng.

Prod vẫn deploy **tay** bằng `./deploy.sh` trên máy prod, không có cổng CI tự động (nhóm chốt: ai làm nấy tự kiểm rồi tự đẩy). `deploy.sh` nay nhận cả tên nhánh lẫn một SHA đầy đủ, nên đẩy đúng một commit cụ thể được: `./deploy.sh <sha>`.

### 8.1 Ghi chú vận hành

- Dev hub: systemd `onos-seller-dev` (`next dev -p 3017`, tự chạy lúc boot; 3100 của thghub đã bị dự án khác chiếm trên hub) → https://seller-dev-onos.autonow.vn (đã route DNS + restart `cloudflared-onos` 07/09/2026). Chạy tay: `pnpm dev:seller`. Smoke đã chạy 07/09/2026: login sai/đúng, cookie remember 30 ngày, proxy 401, counts + 6 tab khớp list sau lazy-sync, detail + PATCH, `/track` không cookie, handoff mạo danh + logout về admin.
- Smoke PR-C (07/09/2026, khách test `seller-smoke@onos.test`): 4 trang 200; catalog lọc `productLine=2d`; resolve SKU thật/giả; import 1 đơn CSV → created; `PATCH me`; đổi mật khẩu sai → 400; notifications; dashboard. Phát hiện + sửa lỗi PR-A: `importOrdersCsv` và luồng tạo đơn qua API **không stamp `productLine`** vào item → tab đếm/lọc bỏ sót đơn chờ đẩy (đã thêm `productLine: q.productLine` ở 2 đường đó — CustomerOrderIntake.md).
- Đồng bộ i18n: `pnpm --filter ./apps/seller sync-i18n` (tự chạy ở `prebuild`).
- Bẫy đã gặp: `@types/react` 19 của seller bị pnpm hoist vào `node_modules/.pnpm/node_modules` → `apps/web` (React 18) type-check vỡ (`'Outlet' cannot be used as a JSX component`) → `apps/web/tsconfig.json` `paths` ghim `react`/`react-dom` về `./node_modules/@types/*` (Common_Pitfalls.md §9).
