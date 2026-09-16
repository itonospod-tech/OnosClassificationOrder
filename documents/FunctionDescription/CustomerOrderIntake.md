# Customer Order Intake (Staging + CSV + Push to production) — Function Description

> **File FE:** `apps/web/src/pages/customer/orders/{index,import,new}.tsx`, `apps/web/src/components/customer/PushToProductionDialog.tsx`, `apps/web/src/services/customerPortal.ts`
> **File BE:** `apps/api/src/modules/customer-portal/{customer-order.entity,customer-payment.entity,customer-order.service,customer-order.controller}.ts`
> **Route:** `/customer/orders` (listing 8 tab), `/customer/orders/import` (CSV), `/customer/orders/new` (form)
> **API:** `/v1/customer/orders/*`
> **Plan gốc:** `documents/Plans/CustomerOrderIntake-CSV-API.md` (v3 — đã implement đợt CSV/XLSX; API key + Public API + webhook hoãn Phase 2)

> **PRD-8 `productLine` trên item (07/09/2026):** cả 4 đường tạo item staging — form (`placeOrder`), CSV (`importOrdersCsv`), Public Order API, sửa đơn pending (`updateStagingOrder`) — đều stamp `productLine: q.productLine` từ `quoteItem()` (ProductConfig). Thiếu ở đường nào là đơn pending của đường đó tàng hình khỏi `counts.byProductLine` + filter `productLine` (đơn đã push còn fallback qua `prodOrders.productLine`). Thêm đường tạo item mới → nhớ stamp.

## 1. Overview

Khách hàng Customer Portal lên đơn theo mô hình **staging 2 pha** thay vì vào thẳng sản xuất:

1. **Pending (staging)** — đơn tạo qua form (`placeOrder`) hoặc import CSV theo **đúng template fulfill OnosPod cũ** nằm ở collection riêng **`customer_orders`** (1 document = 1 ĐƠN nhiều item + 1 địa chỉ chung). Đơn Pending **KHÔNG BAO GIỜ** là `OrderEntity` → toàn bộ pipeline sản xuất + thống kê nội bộ (dashboard, designer stats, fulfillment, Telegram) không thấy đơn này, không phải sửa filter nào.
2. **Push to production** — khách tick chọn đơn Pending → xem bảng **giá chốt** từng item (dialog) → confirm: mỗi item nổ ra 1 `OrderEntity` với `productionId` riêng qua đúng 1 điểm vào `orderService.importOrders()` (map ProductConfig, ép xưởng theo khách, auto-gán designer, Telegram noti như luồng nội bộ). Ledger `customer_payments` ghi 1 record `status='waived'` + tổng amount mỗi lần push (payment gate OFF đợt này — plan §12.1).

Trạng thái đơn khách **derive at read-time** từ `OrderEntity` (không dual-write): 8 tab **All / Pending / Processing / In Production / Fulfilled / Completed / Refunded / Cancelled** + 2 badge chồng **On Hold** (`heldAt`) và **Đang sửa lỗi/Rework** (`designerStatus='rework'` hoặc tool-check chưa ok). Trạng thái mức ĐƠN = item **chậm nhất** (least-advanced).

Hai luồng đơn cùng tồn tại (plan §1.3):

- **Luồng A (đa số):** đơn sync từ hệ OnosPod cũ → `importOrders()` vào thẳng `OrderEntity` như trước. Backfill + lazy-sync tạo staging row `pushedAt=createdAt` (orderKey `legacy-<productionId>`) chỉ để listing portal thấy đơn — KHÔNG payment record, KHÔNG đổi hành vi sản xuất.
- **Luồng B (khách tự lên đơn):** form/CSV → staging Pending → push.

## 2. Luồng hoạt động

### 2.1 CSV import theo template cũ

1. Khách mở `/customer/orders/import`, tải file mẫu **`customer-order-template.xlsx`** (nút "Tải file mẫu" trỏ vào bản `.xlsx`) hoặc dùng file sẵn có. Bản `.csv` cùng tên GIỮ LẠI cho link cũ/khách quen dùng CSV. File mẫu có ở CẢ `apps/web/public/` lẫn `apps/seller/public/` — sửa là phải sửa cả 2, giống hệt nhau. **Vì sao mẫu chính là `.xlsx`:** khối hướng dẫn cuối file có tiếng Việt và ô nhiều dòng — CSV mở bằng MS Excel (Windows) ra chữ hỏng nếu thiếu BOM UTF-8 và vỡ hàng nếu thiếu CRLF; `.xlsx` không có hai bẫy đó. Mọi ô trong `.xlsx` ép kiểu TEXT (`z='@'`) để `postcode`/`telephone` không mất số 0 đầu. Nếu vẫn phải chạm bản `.csv` thì bắt buộc ghi lại kèm BOM UTF-8 + CRLF.
2. FE parse tại browser (`parseTemplateRows()` trong `import.tsx`, lib `xlsx`):
   - **Trim header** (template thật có `order_id `, `quantity `... thừa khoảng trắng), match không phân biệt hoa thường.
   - **Cắt ở dòng trống hoàn toàn đầu tiên** — block hướng dẫn UPDATED/NOTE cuối template tự bị bỏ, không sinh lỗi ảo.
   - `raw:false` khi đọc sheet → `postcode`/`telephone` giữ dạng string (không mất số 0 đầu).
   - **Group nhiều dòng cùng `(order_id, identifier)` = 1 đơn nhiều item** (rule hệ cũ). Địa chỉ lấy dòng ĐẦU; dòng sau lệch địa chỉ → warning.
   - **Địa chỉ lưu ĐỦ bộ field hệ cũ** (`firstName/lastName/company/phone/email/address1/address2/city/state/postcode/country`): cột `name` template tự tách từ đầu = firstName, phần còn lại = lastName; file export hệ cũ có sẵn cột `first_name`/`last_name`/`phone` → ưu tiên dùng thẳng (alias `phone` ↔ `telephone`). `is_national`/`national` hệ cũ không áp dụng.
   - Cột `design_*` parse **động** → key `DesignFields` (snake→camel: `design_sleeve_left`→`sleeveLeft`); cột `shipping` qua `parseCustomerShipMethod()` (shared — 4 giá trị + alias `SBTT`→`tiktok`, trống→`express_us`); `tracking_number/carrier/url` + `shipping_label` → `items[].tracking` — từ **ORD-26** không còn dừng ở mức lưu-hiển-thị: lúc push, tracking đi tiếp vào `OrderEntity.tracking` + record `shipments` provider `customer` (xem [`VnpShipping.md §2c`](VnpShipping.md)).
   - **Validate bằng CHÍNH schema Zod shared** `CustomerImportOrderZod.safeParse()` từng đơn — cùng schema `ImportCustomerOrdersDto` BE validate qua ZodValidationPipe → rule FE/BE khớp 100%, KHÔNG validate tay ở FE. Giá trị thô đẩy thẳng vào Zod (quantity trống → `undefined` để default(1), coerce bắt số sai; shipping parse qua `parseCustomerShipMethod` shared, giá trị lạ giữ raw cho enum bắn `invalid_enum_value`). Zod issue được map path → (dòng file, cột template) qua `ITEM_FIELD_TO_COLUMN`/`ADDRESS_FIELD_TO_COLUMN` + dịch message theo ngôn ngữ hiện tại (`issueMessage()` → keys `importCsv.cellErrors.*`).
   - Preview = **bảng tính từng dòng** (13 cột template): ô lỗi bôi đỏ + message ngay dưới giá trị; đơn phân tách bằng border đậm. **Còn ≥1 ô lỗi → nút import DISABLE hẳn** (không còn chế độ "import đơn hợp lệ") — khách sửa file rồi tải lại.
   - Cột **"Sản phẩm hệ thống"** (ngay sau cột sku, nền tím nhạt): sau parse FE gọi `POST /import/resolve` đối chiếu từng SKU với catalog → hiện ảnh mockup + tên sản phẩm + màu/size + giá tham khảo (gạch giá gốc khi có Promotion, tính đúng công thức import/push) để khách check trước khi submit. SKU không tồn tại / sản phẩm ngừng bán → ô đỏ message từ BE + **tính vào lỗi chặn submit** (khớp rule BE fail cả đơn); dòng chưa có design thuộc `designAcceptKeys` của sản phẩm (thường = front/back) → **cảnh báo VÀNG không chặn** "sẽ bị chặn khi Đẩy sản xuất" (luật design nới 27/08 — xem §2.2); nút import disable trong lúc đang đối chiếu.
3. `POST /customer/orders/import` nhận `orders[]` đã group (cap 500 dòng) → BE validate lại: **SKU bắt buộc match `variations[].sku`** (uppercase+trim, plan §13.1) **+ sản phẩm phải `status='active'`** — SKU của sản phẩm ngừng bán (inactive/hidden) fail cả đơn với message "đã ngừng bán" (`quoteItem` trả cờ `inactive`, chặn ở CẢ import / preview resolve / push — SKU vẫn nằm trong DB để giữ liên kết đơn cũ) → resolve `productConfigId`/`type`/`size`/`color` từ variation (SKU là nguồn chân lý; size/color file chỉ tham khảo) + tính **giá tham khảo** (`priceSnapshot`) → **cấp `productionId` từng item** (`assignProductionIds()`, xem §3.2) → tạo staging doc `pending`. Response kết quả từng đơn `created | duplicated | failed` (+ `itemErrors`).
4. **Idempotency mức ĐƠN:** unique index `(customerId, orderKey)` với `orderKey = customerOrderKey(order_id, identifier)` (normalize lowercase) — import lại file → mọi đơn cũ báo `duplicated`, không tạo trùng.

### 2.2 Push to production

```
Tick đơn Pending → "Push to production" → POST /push-preview (bảng giá chốt, không commit)
  → confirm → POST /push:
     1. validate (pending, chưa push, có item, đủ địa chỉ tối thiểu)
     1a'. sản phẩm NGỪNG BÁN (ProductConfig.status != 'active' — quoteItem trả cờ
         `inactive`, chặn ở CẢ import lẫn push): đơn ĐÓ 'failed' kèm tên sản phẩm, lô chạy tiếp
     1a. CỬA CUỐI về file thiết kế: assertArtworkComplete() — thiếu mockup hoặc thiếu
         design → đơn ĐÓ 'failed' kèm mã đơn + vị trí chấp nhận, lô chạy tiếp.
         LUẬT DESIGN (nới 27/08, nguồn duy nhất `designAcceptKeys` ở shared
         product-config.dto.ts): chỉ cần 1 design ở MẶT TRƯỚC hoặc MẶT SAU;
         sản phẩm không có front/back → 1 design ở vị trí bắt buộc bất kỳ;
         toàn bộ isRequired:false → chỉ đòi mockup
     1b. GIÀNH CHỖ từng đơn: updateOne có điều kiện { pushedAt: null, chưa ai giữ }
         → $set pushingAt. Không giành được thì đơn đó 'failed' kèm lý do, lô vẫn chạy tiếp
     2. chốt giá từng item (resolveUnitPrice: cod/tiktok → nonShipCost fallback retailPrice;
        express_us/economy_us → retailPrice fallback nonShipCost; áp Promotion theo tier
        qua promotionMatches/applyPromotionDiscount — tái dùng như customer-catalog)
     3. TÁI DÙNG items[].productionId đã cấp lúc tạo/import (fallback generateUniqueProductionId
        cho staging doc cũ) → 1 lệnh importOrders() duy nhất
        (mỗi dòng mang theo items[].tracking — vận đơn khách tự cấp: importOrders
         snapshot lên đơn RỒI ghi record `shipments` provider `customer`, ORD-26)
        (type = ProductConfig.fullName resolve từ SKU → map config chính xác;
         mỗi dòng mang orderAt = lúc khách đặt + inProductionAt = mốc đẩy của cả lô
         — xem "Hai mốc thời gian của đơn" bên dưới)
     4. tạo customer_payments record { status:'waived', method:'waived', amount }
     5. $set items (priceSnapshot chốt) + pushedAt + paymentId, $set pushingAt=null
        (lệnh ghi cũng có điều kiện pushedAt: null)
     — hỏng ở bước 3 hoặc 4 → NHẢ hết chỗ giữ rồi ném lỗi, đơn quay lại đẩy được
```

**Hai mốc thời gian của đơn (`orderAt` + `inProductionAt`).** Đơn portal không đi qua sheet import nên không có sẵn cột ngày như đơn nội bộ — `pushToProduction` phải tự điền, và bước 3 truyền cả hai (dạng ISO, `importOrders` parse qua `parseImportDate`) vào từng dòng `importRows`.

| Trường | Lấy từ | Ý nghĩa |
|---|---|---|
| `orderAt` | `customer_orders.createdAt` | lúc **khách đặt** |
| `inProductionAt` | mốc đẩy của cả lô | lúc **vào sản xuất** |

Hai mốc lệch nhau đúng bằng quãng đơn nằm ở vùng nháp Pending — có thể vài phút mà cũng có thể vài ngày. Gộp làm một là mất luôn quãng chờ đó khỏi mọi báo cáo, nên đừng "đơn giản hoá" bằng cách cho cả hai cùng một giá trị. Staging doc quá cũ không có `createdAt` thì `orderAt` lùi về mốc đẩy: sai lệch một quãng đã không còn đo được, vẫn hơn để trống rồi thủng sort `orderAt: -1` ở kanban Fulfillment.

`inProductionAt` để trống thì hậu quả nặng hơn nhiều, vì nó là **trục thời gian của gần hết hệ thống**: bảng "Danh sách đơn" mặc định lọc đúng hôm nay trên chính trường này (`Orders.md §7` — hai tham số tên `createdFrom`/`createdTo` nhưng áp lên `inProductionAt`, không phải `createdAt`); Dashboard, Lifecycle, SLA và báo cáo Telegram đều bucket theo nó. Một trường **không tồn tại** thì không khoảng ngày nào khớp, nên đơn để trống sẽ vào sản xuất thật mà **vô hình với xưởng** — kể cả khi gõ đúng mã vào ô tìm kiếm, vì search áp chồng lên bộ lọc ngày chứ không thay thế nó. Đã xảy ra với `QY-02284-48568` (đẩy 2026-08-24, không ai tìm thấy trên Danh sách đơn).

Mốc đẩy lấy MỘT lần cho cả lô và dùng chung cho `OrderEntity.inProductionAt` lẫn `customer_orders.pushedAt`: hai con số tả cùng một sự kiện, gọi `new Date()` hai lần chỉ đẻ ra chênh lệch vài mili giây để người đọc số sau này phải đi giải thích. Test giữ luật: `apps/api/src/modules/customer-portal/push-in-production-at.spec.ts`.

**Cửa cuối về file thiết kế (ORD-25).** ORD-22 bắt `placeOrder` kiểm mockup + design, nhưng đó chỉ là MỘT đường vào: Public Order API đi `importOrdersCsv`, và `updateStagingOrder` cho phép gỡ design ra khỏi đơn đã tạo. Chặn ở lúc tạo là hàng rào **báo sớm**, không thể là hàng rào **đảm bảo** — mỗi đường vào mới lại phải nhớ chặn lại.

Cửa đúng là bước push: nơi đơn thật sự rời vùng nháp để vào sản xuất, điểm vào duy nhất, không đi vòng được. Đơn Pending **vẫn được phép thiếu** (vùng nháp theo đúng thiết kế hai pha — `updateStagingOrder` KHÔNG bị siết, khách lưu dở rồi bổ sung sau).

Dùng lại **đúng hàm** `assertArtworkComplete()` của ORD-22, không viết luật thứ hai. Gọi TRƯỚC bước giành chỗ (đơn hỏng thì đừng chiếm chỗ rồi phải nhả) và bọc `try/catch` để một đơn hỏng chỉ hỏng riêng nó. Đơn bị từ chối giữ nguyên trạng thái Pending, dữ liệu nguyên vẹn, bổ sung design rồi đẩy lại được.

Vì Pending được phép thiếu mà push thì chặn, trang **preview import cảnh báo SỚM** (không chặn import): `POST /import/resolve` trả thêm `designAcceptKeys` (cùng nguồn luật), FE so với cột `design_*` từng dòng → dòng nào chưa có design thuộc danh sách chấp nhận thì ô "Sản phẩm hệ thống" hiện cảnh báo vàng "sẽ bị CHẶN khi Đẩy sản xuất" + cộng vào badge cảnh báo. Form đặt đơn `new.tsx` (`canAddToCart`) cũng dùng đúng `designAcceptKeys` — 3 bề mặt 1 luật. Test: `place-order-artwork.spec.ts`.

**Chống đẩy trùng (ORD-20).** Bước 1b không thừa. Cả luồng là đọc → chốt giá → `importOrders()` → ghi `pushedAt`, và chỗ hở nằm ở **khoảng giữa đọc và ghi**: khách bấm hai lần hoặc mở hai tab thì cả hai lượt đều đọc thấy `pushedAt` rỗng và cùng chạy tới `importOrders()`. Hậu quả nặng đã được unique index `productionId` chặn (push tái dùng mã cũ nên lượt sau đụng khoá, và `customer_payments` tạo SAU `importOrders` nên cũng không đẻ ledger rác) — nhưng khách nhận về **lỗi trùng khoá tầng dưới** thay vì câu rõ ràng, và người đọc log tưởng hỏng khâu cấp mã.

Chi tiết cách giữ chỗ:

| | |
|---|---|
| Trường giữ chỗ | `pushingAt` trên `customer_orders` — **KHÔNG** dùng chính `pushedAt`: đặt `pushedAt` trước khi đơn thật sự vào sản xuất thì tiến trình chết giữa chừng để lại đơn "đã đẩy" mà không có đơn sản xuất nào |
| Hết hiệu lực | `PUSH_CLAIM_STALE_MS` = 5 phút — chỗ giữ cũ hơn thế coi như bỏ, tiến trình chết không khoá đơn vĩnh viễn |
| Lượt thua nhận gì | đơn đã đẩy xong → *"Đơn đã đẩy sản xuất trước đó"*; lượt khác đang đẩy → *"Đơn đang được đẩy sản xuất — chờ một lát rồi tải lại trang"* |
| Webhook `order.pushed` | chỉ lượt thắng có `pendingUpdates` cho đơn đó nên **không bắn hai lần** |
| Test giữ luật | `apps/api/src/modules/customer-portal/push-claim.spec.ts` — soi thẳng bộ lọc; rút `pushedAt: null` khỏi đó là mở lại chỗ hở cũ |

- **Design storage hook** (xem [`DesignStorage.md`](DesignStorage.md)): sau push, design là CDN URL → `touchUsageForUrls()`; còn là URL ngoài (Drive) → enqueue job `design-worker` tải về R2 rồi thay URL ở cả `OrderEntity.designs` lẫn staging item — push KHÔNG chờ worker.
- Push **nguyên đơn** (không lẻ item). Payment gate đọc từ `system_configs` key `customer_payment_gate_enabled` — đợt này nếu bật sẽ throw (luồng Admin confirm chưa build, plan §12.1).
- Form `placeOrder` giờ chỉ tạo staging Pending (KHÔNG gọi `importOrders` nữa) — toast hướng khách sang listing để push.

### 2.3 Derive trạng thái (plan §1)

| Trạng thái | Điều kiện |
| --- | --- |
| Pending | staging `pushedAt=null`, `status='pending'` |
| Processing | đã push, `currentFulfillmentStage=null` && `fulfillmentCompletedAt=null` |
| In Production | `currentFulfillmentStage` set (kể cả đang rework — badge chồng, KHÔNG tụt về Processing) |
| Fulfilled | `fulfillmentCompletedAt` set |
| Completed | `fulfillmentCompletedAt` ≤ now − N ngày (`system_configs` key `customer_order_completed_days`, default 14) |
| Refunded | staging `refundedAt` set (flow set chưa build đợt này — tab luôn 0) |
| Cancelled | staging cancelled HOẶC mọi `OrderEntity` của đơn `cancelledAt`/bị xóa |
| _(badge)_ On Hold | ≥1 item `heldAt` set |
| _(badge)_ Rework | ≥1 item `designerStatus='rework'` hoặc (`productionErrorSource='tool-check'` && `toolResultNote`∉{'', 'ok'}) |

## 3. API / Schema

### 3.1 Endpoints (`customer-order.controller.ts`, tất cả `@Auth([RoleType.Customer])`)

| Method | Path | Mô tả |
| --- | --- | --- |
| POST | `/v1/customer/orders` | Form đặt đơn → staging Pending (res `CustomerStagingOrderResDto`) |
| GET | `/v1/customer/orders` | Listing theo ĐƠN — filter `status`/`held`/`search`, phân trang aggregation |
| GET | `/v1/customer/orders/counts` | Đếm 8 trạng thái + `held`/`rework` cho tab bar |
| POST | `/v1/customer/orders/import/resolve` | Đối chiếu SKU với catalog cho preview import — trả tên/ảnh (`ProductConfig.mockup`)/màu-size/giá tham khảo (`resolveImportSkus()` tái dùng `quoteItem`); `found=false` → FE chặn submit |
| POST | `/v1/customer/orders/import` | CSV import (orders[] đã group) — kết quả từng đơn |
| POST | `/v1/customer/orders/push-preview` | Bảng giá chốt (không commit) + `paymentGateEnabled` |
| POST | `/v1/customer/orders/push` | Push nguyên đơn → importOrders + payment waived |
| PATCH | `/v1/customer/orders/staging/:id` | Sửa đơn PENDING tự do (orderName/note/địa chỉ/items) |
| POST | `/v1/customer/orders/staging/:id/cancel` | Hủy đơn PENDING |
| GET | `/v1/customer/orders/:productionId` | (giữ nguyên) track 1 item đã push |
| PATCH | `/v1/customer/orders/:productionId` | (giữ nguyên) sửa mockup/designs/address đơn đã push — giờ đồng bộ ngược vào staging item |

### 3.1b Public Order API + API key + Webhook (ORD-4)

**API key (portal, `customer-api-key.controller.ts`, `@Auth([RoleType.Customer])`)**

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/v1/customer/api-keys` | Danh sách key hoạt động (label + prefix + createdAt + lastUsedAt) — KHÔNG bao giờ trả hash/key plain |
| POST | `/v1/customer/api-keys` | Tạo key — response `data.key` là key plain, hiển thị đúng MỘT lần (max `CUSTOMER_API_KEY_MAX_ACTIVE`=5) |
| DELETE | `/v1/customer/api-keys/:id` | Thu hồi (`revokedAt`) — vô hiệu NGAY |

**Webhook (portal, `customer-webhook/customer-webhook.controller.ts`, `@Auth([RoleType.Customer])`)**: `GET|POST /v1/customer/webhooks`, `DELETE /v1/customer/webhooks/:id` (max `CUSTOMER_WEBHOOK_MAX_ACTIVE`=3).

**Public Order API (`customer-open-api.controller.ts`, `@UseGuards(ApiKeyGuard)` — KHÔNG JWT, KHÔNG `@Auth`)**

| Method | Path | Mô tả |
| --- | --- | --- |
| POST | `/v1/open-api/orders` | Tạo đơn Pending theo lô (≤`OPEN_API_MAX_ORDERS_PER_CALL`=100). Idempotent theo `externalRef` (map thành `orderId`/`orderKey`) — gọi lại → `duplicated`. Tái dùng NGUYÊN `importOrdersCsv(..., source='api')` |
| POST | `/v1/open-api/orders/push` | Push theo `externalRefs[]` hoặc `ids[]` → `resolveStagingIdsForApi()` → `pushToProduction()` (cùng cổng duy nhất, ledger `waived`) |
| GET | `/v1/open-api/orders` | List đơn của khách sở hữu key — cùng `listOrders()` (8 trạng thái derive + badge) |
| GET | `/v1/open-api/orders/:ref` | Tra 1 đơn theo `externalRef` **hoặc** `productionId`; ref là productionId đã push → kèm `track` mirror trang track portal |

**`ApiKeyGuard`** (`apps/api/src/guards/api-key.guard.ts`): header `X-Api-Key: onos_live_<32hex>` → sha256 → `customerService.findByApiKeyHash()` (chỉ key chưa `revokedAt`, khách `status=Active` + chưa xóa mềm) → gắn `request.user` role ảo `RoleType.Customer` (CÙNG ranh giới dữ liệu với JWT Customer — mọi service scoped theo `customer._id`). Sai/thiếu/thu hồi/khách khóa → **401 thông điệp chung**, không tiết lộ key hay khách nào tồn tại. Rate limit dùng lại `RateLimiterService` sẵn có: bucket session theo **hash key** + bucket user theo **customerId** (nhiều key của cùng khách KHÔNG nhân hạn mức) — vượt → 429. `lastUsedAt` cập nhật fire-and-forget.

**Lưu ý ranh giới:** `RolesGuard` chặn role Customer ngoài prefix `customer/...` chỉ áp cho **token JWT**; Public API đi qua `ApiKeyGuard` riêng (`@UseGuards`, không `@Auth`) nên không đụng whitelist đó — bù lại guard tự giới hạn: chỉ controller `open-api/orders` dùng nó, và mọi method service đều nhận `customer` từ key.

**Nguồn sự kiện chung** (ORD-5 bổ sung): mọi call site KHÔNG gọi thẳng webhook service nữa mà gọi `CustomerOrderEventService.emit()` (`customer-event/` — module trung gian import cả `CustomerWebhookModule` lẫn `CustomerNotificationModule`), service này fan-out sang **webhook cho khách API** (theo TỪNG item) *và* **thông báo chuông portal** (gộp MỨC ĐƠN — xem `CustomerPortal.md §8`). Thêm điểm đổi trạng thái mới thì gọi đúng hàm này.

**Webhook engine** (`customer-webhook/` — module ĐỘC LẬP, chỉ bind model để customer-event import không tạo vòng DI):
- 5 sự kiện `CUSTOMER_WEBHOOK_EVENTS`: `order.pushed` (emit ở `pushToProduction`), `order.production_completed` (ở `fulfillment-task.service.ts` transition khi `fulfillmentCompletedAt` vừa được set — chỉ bắn ở cạnh chuyển thật), `order.held`/`order.unheld`/`order.cancelled` (ở `order.service.ts` `holdOrder`/`unholdOrder`/`cancelOrder` **và `bulkSetHold`** qua helper `emitCustomerOrderEvent()`).
- Resolve khách: theo `customerId` nếu caller biết sẵn (push), còn lại theo `customerMatchKey(userSku, userEmail)` như mọi tính năng khác.
- **KHÔNG chặn luồng chính**: `emitForOrders()` là `void` + service tự nuốt lỗi; POST timeout 5s, `maxRedirects: 0`, retry 2 lần (5s/25s) rồi bỏ.
- Chữ ký: header `X-Onos-Signature: sha256=<HMAC-SHA256(body, webhook.secret)>` + `X-Onos-Event` + `X-Onos-Delivery`. Payload `{ id, event, createdAt, data: { productionId, ...extra } }` — CHỈ dữ liệu khách vốn đã thấy ở portal (không tên nhân viên/giá vốn/xưởng).
- Vết giao: collection `customerWebhookDeliveries` (TTL 30 ngày) — `status pending|delivered|failed` + `attempts` + `lastError`.

**Trang tài liệu API cho khách** (`pages/customer/api/docs.tsx`, route `PATHS.CUSTOMER_API_DOCS` = `/customer/api/docs`, mở từ nút "Tài liệu API" ở header trang API & Webhook): tài liệu tích hợp đầy đủ NGAY TRONG portal — 9 mục có mục lục anchor (Bắt đầu/Luồng/Endpoint/Tạo đơn/Push/List/Tra cứu/Webhook/Lỗi & giới hạn), bảng field từng cấp (đơn/địa chỉ/item/tracking) kèm badge **Bắt buộc/Tùy chọn + default**, quy tắc design "1 trong front/back", bảng 5 sự kiện webhook + 3 header + snippet Node verify chữ ký HMAC, curl + response mẫu mỗi endpoint. **Mọi giới hạn/enum lấy TỪ `shared` làm nguồn sống** (`OPEN_API_MAX_ORDERS_PER_CALL`, `CUSTOMER_API_KEY_MAX_ACTIVE`, `CUSTOMER_WEBHOOK_MAX_ACTIVE`, `CUSTOMER_SHIP_METHODS`, `Object.keys(DesignFieldsZod.shape)`) — không chép cứng vào FE. Khối code dùng chung `components/customer/ApiCodeBlock.tsx` (extract từ CodeBlock cũ của `api/index.tsx`). i18n namespace riêng `apiDocs` (vi + en, đăng ký ở `i18n/index.ts`).

### 3.2 Staging entity `customer_orders` (`customer-order.entity.ts`)

```ts
CustomerOrderEntity {
  customerId; userSku; userEmail;         // denorm match keys
  orderKey;                               // unique (customerId, orderKey) — idempotency mức ĐƠN
  orderId?; identifier?; orderName?;      // giữ nguyên văn giá trị khách điền
  source: 'form'|'csv'|'api'|'sync';
  status: 'pending'|'cancelled';          // CHỈ trạng thái TRƯỚC push
  shippingAddress?;                       // 1 địa chỉ CHUNG cả đơn (có email/company)
  items: CustomerOrderItem[];             // sku, productConfigId, type/size/color (resolve từ SKU),
                                          // quantity, shipMethod, activeService, mockupUrl, designs,
                                          // tracking (khách tự cấp → module vận đơn lúc push), priceSnapshot,
                                          // productionId — cấp NGAY lúc tạo/import, xem note dưới
  note?; pushedAt?; paymentId?; cancelledAt?; cancelReason?; refundedAt?;
}
// Indexes: unique (customerId, orderKey); (customerId, status, createdAt); ('items.productionId')
```

> **productionId cấp lúc tạo (không phải lúc push):** mã dạng `XX-#####-#####` (2 chữ cái + 2×5 số, cùng pattern `CUTTING_FILE_PRODUCTION_ID_REGEX`), unique trên CẢ `orders` lẫn staging (`generateUniqueProductionId()` check 2 collection). `assignProductionIds()` gọi ở `placeOrder` / `importOrdersCsv` / `updateStagingOrder` (items mới); khi sửa đơn pending FE echo-back `productionId` qua `CustomerStagingItemInputZod.productionId` — BE chỉ nhận mã ĐANG thuộc chính đơn đó (mỗi mã dùng lại tối đa 1 lần), mã lạ bị bỏ qua + cấp mã mới. `pushToProduction` **tái dùng** `item.productionId` làm `OrderEntity.productionId` (fallback sinh mới cho staging doc cũ tạo trước cơ chế này) — khách theo dõi đúng 1 mã xuyên suốt portal → xưởng. Item pending có mã nhưng CHƯA có `OrderEntity` → trang track `GET /:productionId` 404, FE chỉ render link track khi item đã push (drawer + dashboard).

### 3.3 Ledger `customer_payments` (`customer-payment.entity.ts`)

```ts
CustomerPaymentEntity {
  customerId; orderIds[];                 // staging _id các đơn thuộc lần push
  amount;                                 // tổng giá chốt (USD)
  status: 'awaiting'|'paid'|'waived'|'cancelled';
  method: 'manual'|'waived'|'wallet';
  confirmedBy?; confirmedAt?; refunds[];
}
```

### 3.4 Shared (`packages/shared`)

- `enums/customer-order-status.ts` — `CustomerOrderStatus` (7 giá trị + labels VI cho BE) + `CUSTOMER_ORDER_STATUS_PROGRESS` (thứ tự least-advanced).
- `dtos/customer.dto.ts` (ORD-4) — `CUSTOMER_API_KEY_MAX_ACTIVE`/`CUSTOMER_API_KEY_PREFIX` + `CustomerApiKeyZod`/Create/List/Revoke DTOs; `CUSTOMER_WEBHOOK_MAX_ACTIVE`/`CUSTOMER_WEBHOOK_EVENTS` + `CustomerWebhookZod`/Create/List/Delete DTOs.
- `dtos/customer-order.dto.ts` (ORD-4) — `OPEN_API_MAX_ORDERS_PER_CALL` + `OpenApiCreateOrdersDto` (`externalRef` + items dùng CHUNG shape CSV) / `OpenApiPushOrdersDto` / `OpenApiGetOrderResDto`.
- `dtos/customer-order.dto.ts` — `CUSTOMER_SHIP_METHODS` (4 giá trị) + `parseCustomerShipMethod()` + `customerOrderKey()` + toàn bộ DTOs: `CustomerStagingOrderZod`/`CustomerStagingItemZod`, `GetCustomerStagingOrders*`, `CustomerOrderCountsZod`, `ImportCustomerOrders*` (`CustomerImportOrderZod` items SKU required), `PushCustomerOrders*`/`PreviewPush*`, `UpdateCustomerStagingOrderDto`, `CancelCustomerStagingOrderDto`, payment consts. Keys `CUSTOMER_ORDER_COMPLETED_DAYS_KEY`, `CUSTOMER_PAYMENT_GATE_KEY`.

## 4. UI Components

- `pages/customer/orders/index.tsx` — listing theo ĐƠN, row giàu thông tin mirror hệ OnosPod cũ: cột Mã đơn (`#<productionId item đầu>` qua `orderDisplayCode()` — **bấm mở drawer chi tiết**, + copy + reference orderId + source + ngày), Sản phẩm (mockup + tên + sku/màu-size, đa item hiện "+N sản phẩm khác"), Khách nhận (tên + địa chỉ rút gọn), Trạng thái (StatusBadge + chip thanh toán Unpaid/Waived + badge Hold/Rework), Vận chuyển (tracking number + carrier + link label), Tổng tiền, actions (Eye mở drawer, Push/Hủy cho pending). Tab bar 8 trạng thái + count badge (`GET /counts`), chip "On Hold", search, checkbox chọn đơn Pending (tab Pending).
- `components/customer/CustomerOrderDetailDrawer.tsx` — **drawer chi tiết ĐƠN** (Sheet phải RỘNG `sm:max-w-[1150px]`, mở khi bấm productionId/Eye), layout **2 cột mirror trang chi tiết hệ OnosPod cũ**: header (mã đơn + copy + reference + chips status/payment/tổng tiền/số item/hold-rework + nút Push/Hủy cho pending); **cột trái 2/3**: card ORDER ACTIVITY (stepper **5 chặng** mirror hệ cũ: Tạo đơn → Gửi sản xuất → Sản xuất xong → Đã lấy hàng → Đã giao hàng; theo `CUSTOMER_ORDER_STATUS_PROGRESS` — Picked Up suy từ (Fulfilled + có tracking number) hoặc Completed, Delivered ≈ Completed vì chưa tích hợp carrier; dấu ✓ chặng đã qua; đơn hủy → banner đỏ; dưới stepper: tracking summary carrier + số vận đơn + link label) + card ORDER DETAILS (mỗi item: mockup LỚN 144px + tên + ID/Merchant/Fulfill code lines + **design thumbnails thật** qua `driveThumbUrl()`/`driveViewUrl()` + giá chốt gạch giá gốc + block PRODUCTIONS `#productionId` + chặng hiện tại + badge; footer totals Tạm tính/Phí ship/Tổng/Đã thanh toán) + card **Order Records** (`OrderRecords` — timeline nhật ký derive thuần FE từ mốc staging: Tạo đơn/Gửi sản xuất kèm mã/Sản xuất xong từng item/Hủy đơn, mới nhất trước; KHÔNG lộ OrderLog nội bộ); **cột phải 1/3**: SHIPPING ADDRESS (đơn đã push hiện dạng text gọn, pending → form sửa → `PATCH staging/:id`) + SHIPPING METHOD (4 option radio-style, highlight method items đang dùng + note activeService USPS) + BUYER NOTE (sửa được khi pending) + TRACKING (number/carrier/URL/nút Shipping label + **iframe preview label PDF**). Export `orderDisplayCode()`.
- `components/customer/CustomerOrderBadges.tsx` — `CustomerOrderStatusBadge` + `CustomerOrderPaymentBadge` (pending = Chưa thanh toán đỏ, đã push = Miễn thanh toán xanh — gate OFF) + `CustomerOrderOverlayBadges` (Hold/Rework) dùng chung listing + drawer.
- `components/customer/PushToProductionDialog.tsx` — gọi `push-preview` khi mở: bảng giá chốt từng item (gạch giá gốc khi có Promotion, tổng theo đơn + tổng cộng), warning dòng chưa chốt được giá, confirm → `push` → toast + reload.
- `pages/customer/dashboard/index.tsx` — mã đơn ở "Đơn gần đây" chỉ render link track khi item đã push (pending hiện text + copy, tránh 404).
- `pages/customer/orders/import.tsx` — 3 bước: chọn file → **preview bảng tính từng dòng** (validate bằng `CustomerImportOrderZod` shared, ô lỗi bôi đỏ + message i18n theo cột, warning lệch địa chỉ; còn lỗi → nút import disable, xem §2.1) → kết quả từng đơn `created/duplicated/failed`. Nút tải file mẫu = template cũ nguyên bản.
- `pages/customer/orders/new.tsx` — giữ nguyên form, chỉ đổi toast sau submit (`orderNew.successPending`).
- `pages/customer/api/index.tsx` (ORD-4) — trang **"API & Webhook"** (route `PATHS.CUSTOMER_API` = `/customer/api`, entry sidebar portal). 3 khối dọc theo đúng thứ tự khách làm việc: **API key** (bảng label/prefix/ngày tạo/lần dùng cuối + nút Tạo/Thu hồi; key plain hiện trong dialog riêng đúng MỘT lần, cảnh báo amber, nút copy) → **Webhook** (input URL + danh sách URL kèm signing secret + chip 5 tên sự kiện) → **Lệnh mẫu** (3 khối `curl` tạo đơn/push/tra trạng thái + payload webhook mẫu, mỗi khối có nút copy). Mọi giá trị máy-đọc (key, URL, endpoint, payload) đặt trong khối `font-mono` nền slate-950 để tách khỏi chữ người-đọc — hướng dẫn nằm ngay trong trang, KHÔNG làm developer-portal riêng (SRS ASSUMPTION).
- i18n: namespace `customerPortal` keys `orders.tabs/status/source/badge*/payment*/moreItems`, `orderDetail.*` (drawer), `push.*`, `importCsv.*`, `apiAccess.*` (+ `apiAccess.docsBtn` nút mở trang tài liệu) + `layout.nav.api` (vi + en); namespace `apiDocs` riêng cho trang tài liệu `/customer/api/docs`.

## 5. Backend logic

Tất cả trong `customer-order.service.ts`:

- `buildDerivePipeline()` — aggregation dùng CHUNG listing + counts + `getOrderByRefForApi`: `$lookup` orders theo `items[].productionId` (project `PROD_DERIVE_FIELDS`) → `$addFields statusDerived/heldAny/reworkAny/sortAt`. Logic MIRROR bộ hàm JS `deriveItemStatus()`/`isReworkBadge()`/`toStagingOrder()` (đổi 1 nơi phải đổi nơi kia — comment tại chỗ). **Phép nối PHẢI viết dạng `localField`/`foreignField`** — xem §6.
- `quoteItem()` + `buildPricingContext()` — resolve SKU→variation (map `bySku`) hoặc type→config (map `byType`, cho đơn form; chọn variation qua `pickVariation()` match attributes size/color, chỉ nhận khi không mơ hồ). Giá theo ship method + Promotion theo tier.
- `importOrdersCsv()` — validate + create từng đơn, bắt `E11000` → `duplicated`; đơn có item lỗi → `failed` cả đơn.
- `previewPush()` / `pushToProduction()` — mô tả ở §2.2. 1 lệnh `importOrders()` duy nhất cho mọi item (1 Telegram noti/lần push).
- `onModuleInit()` — backfill 1 lần theo marker `system_configs['customer_orders_backfill_v1']`: mọi customer → `syncLegacyOrdersForCustomer()`. Hàm này cũng chạy **lazy mỗi lần khách mở listing** để bắt đơn Luồng A sync về sau backfill (insertMany `ordered:false`, trùng orderKey tự nuốt).
- `updateOrder()` (đơn đã push) — sau khi sửa OrderEntity giờ **đồng bộ ngược** mockup/designs/address vào staging item tương ứng.
- (ORD-4) `resolveStagingIdsForApi()` / `getOrderByRefForApi()` — adapter mỏng cho Public API, scoped theo `customerId` của key; ref không thuộc khách → 404 chung chung. `importOrdersCsv()` nhận thêm tham số `source` (`'csv'` mặc định, `'api'` khi gọi qua Public API) — KHÔNG rẽ nhánh logic nào khác.

## 6. Performance notes

- Listing dùng 1 aggregation duy nhất ($lookup theo `productionId` có index unique bên `orders` + index `items.productionId` bên staging) — không N+1 per đơn; `computeCurrentStage` chạy JS trên trang hiện tại (≤100 doc).
- **ORD-18 — `$expr` trong `$lookup` không dùng được index.** Bản đầu lọc bằng `pipeline: [{ $match: { $expr: { $in: ['$productionId', '$$pids'] } } }]`. `$expr` khiến MongoDB **quét toàn bộ `orders` cho TỪNG document staging** dù `productionId_1` có sẵn: khách 3.478 đơn × 40.065 đơn sản xuất ≈ **139 triệu lượt quét**, listing **71 giây**, cả ba endpoint (listing / `counts` / `dashboard`) cùng treo vì dùng chung hàm này. Nay nối bằng `localField: 'items.productionId'` + `foreignField: 'productionId'` (giữ `pipeline` cho `$project`) — `explain` báo `indexesUsed: ["productionId_1"]`, listing **0,6 s**, counts **0,5 s**, kết quả khớp từng đơn trên cả 3.478 đơn.
- **Chốt `productionId: { $ne: null }` trong sub-pipeline không được bỏ.** Hai dạng nối KHÔNG tương đương: dạng `localField` còn khớp cả đơn có `productionId` null/thiếu khi `items` rỗng hoặc item thiếu `productionId` (đã dựng bộ 9 ca biên để đo). `OrderEntity.productionId` khai `required: true, unique: true` nên đơn như vậy không tồn tại — chốt này giữ cho tương lai, bỏ đi là đơn `items` rỗng bỗng nối vào đơn rác.
- `syncLegacyOrdersForCustomer` mỗi lần mở listing: 1 `distinct` + 1 `find $nin` scoped theo khách — chi phí tỉ lệ số đơn của chính khách đó. Khách có hàng chục nghìn đơn legacy sẽ chậm ở lần đầu (insertMany), các lần sau chỉ 2 query rỗng.
- Backfill onModuleInit chạy đúng 1 lần (marker) — boot sau không quét lại.
- Import cap 500 dòng/lần; `buildPricingContext` load config theo `$in` SKU 1 query cho cả batch.

## 7. Permissions

- Toàn bộ endpoint `@Auth([RoleType.Customer])` — không dùng permission-catalog nội bộ (pattern Customer Portal sẵn có, `RolesGuard` chặn role Customer khỏi API ngoài prefix `customer/...`).
- (ORD-4) Public Order API `open-api/orders*` KHÔNG dùng `@Auth`/JWT mà `@UseGuards(ApiKeyGuard)`; ranh giới dữ liệu do chính guard đảm bảo (key ⇄ đúng 1 khách). API key + webhook CRUD vẫn nằm dưới prefix `customer/` với JWT như mọi trang portal khác.
- Không có trang admin mới đợt này (payment gate OFF — plan §12.1).


## Ghi chú PRD-8 (07/09/2026) — dòng sản phẩm

`CustomerOrderItem.productLine` (enum 3d/2d/wood/embroidery/led/canvas) stamp từ `ProductConfig.productLine` lúc `placeOrder`/`importOrdersCsv` (`quoteItem` trả `productLine`), `pushToProduction` chuyển vào `importRows` → `OrderEntity.productLine`. Listing: `GET /customer/orders?productLine=` (đơn có ≥1 item thuộc dòng — khớp `items.productLine` HOẶC `prodOrders.productLine` sau `$lookup`), `CustomerStagingOrder.productLines[]`, `GET /customer/orders/counts` → `byProductLine`. Item cũ chưa stamp derive từ đơn sản xuất (`toStagingOrder`). Định nghĩa + backfill: Products.md §2.4b.

> **Đồng bộ đơn Luồng A vào staging cho mọi khách (07/09/2026):** `CustomerOrderService.runLegacySync()` — (1) **tăng dần** cron 5' (`customer-orders-legacy-sync`) + trước mọi lần admin đọc (`awaitLegacySync`: throttle 60 s, request đang chạy dùng chung promise, admin chờ TỐI ĐA 3 s rồi trả dữ liệu hiện có, đồng bộ tiếp ở nền); quét `orders.createdAt ≥ watermark − 15'` (`createdAt` luôn là giờ ghi DB — import `$setOnInsert new Date()`, không backdate); (2) **toàn bộ** cron 03:30 VN (`customer-orders-legacy-sync-full`) + lần đầu chưa có mốc → bắt mọi thứ lọt lưới. Khoá phân tán = document `system_configs.customer_orders_sync_lock` (claim atomic, mồ côi 15') nên cron/warm-up/nhiều process không chạy chồng; mốc `customer_orders_sync_watermark` đọc/ghi THẲNG collection (SystemConfigService.get cache Redis 1 giờ + set() findOne+create văng E11000 khi chạy sát nhau — đã gặp). Từng khách bọc try/catch, có lỗi thì KHÔNG đẩy mốc. Bỏ đơn `deletedAt` và đơn không `userSku`; cặp (userSku, email chữ thường, trim) chưa có trong `customers` → upsert chỗ giữ như `CustomerService.sync`; khách xoá mềm → bỏ. `syncLegacyOrdersForCustomer(customer, since?)` khớp email không phân biệt hoa/thường. Có dòng mới → xoá cache admin. **Chạy bù tay:** xoá document `customer_orders_sync_watermark` → lần chạy kế tiếp là FULL. Đã kiểm dev 07/09: FULL +12.707 dòng · 140 khách · 0 lỗi, admin đọc trong lúc chạy 0,1 s; prod sau deploy: 1.195/1.195 đơn hôm nay có mặt, 0 đơn chưa staging.
>
> **Độ tươi còn lại (chấp nhận):** trạng thái/chặng luôn tính lúc đọc từ `orders` (tươi tuyệt đối); `counts`/`stats` admin cache 60 s (xoá ngay khi có dòng mới, nhưng đơn đổi trạng thái thì trễ ≤ 60 s); thông tin item của đơn Luồng A (loại/size/mockup/địa chỉ) là ảnh chụp lúc đồng bộ — xưởng sửa sau đó không chép lại. Seller portal (`listOrders` khách) vẫn tự bồi đơn của chính khách mỗi lần mở như trước.

> **Ngang bằng với đường import nội bộ (08/09/2026).** Đối chiếu hợp đồng `ImportProductionOrderRow` giữa hai đường lên đơn (`apps/web/src/pages/orders/parseOrders.ts` 39 cột của nội bộ ↔ `pushToProduction` của seller) phát hiện đường seller BỎ TRỐNG các trường mà nội bộ luôn có:
>
> | Trường | Hệ quả khi trống | Đã sửa |
> |---|---|---|
> | `weight` / `width` / `height` / `length` | Mua vận đơn phải gõ tay cân nặng, kích thước rơi về mặc định 1×1×1 cm → sai cước; xưởng không có số để đóng gói | `quoteItem()` trả kèm 4 trường của biến thể → ghi vào item staging lúc đặt/import CSV, `pushToProduction` lùi về quote cho đơn cũ |
> | `baseCost` | Đơn seller đóng góp **0** vào doanh thu CEO Dashboard (`$baseCost`) | Ghi giá đã chốt (`priceSnapshot.discountedPrice ?? unitPrice`) |
> | `shipCost` | Không có cước ship để đối soát | Lấy theo `shipMethod` (`expUsShipCost` / `tiktokShipCost` của biến thể) |
> | `externalId` | Trang tra cứu công khai không có Platform ID | **Chưa làm** — đơn portal không có mã sàn; đơn CSV có thể lấy từ `order_id` của khách nếu cần |
>
> **Tracking hai chiều:** `PROD_DERIVE_FIELDS` thêm `tracking vnpShipment`, `toStagingOrder` gộp qua `trackingChoSeller()` — ưu tiên mã khách tự cấp trên item → mã ghi trên đơn sản xuất → snapshot VNP lúc Admin mua label (bỏ qua nếu đã hủy). Có kèm `labelUrl` để seller tải label như hệ cũ; trang tra cứu CÔNG KHAI vẫn giấu (luật riêng ở `public-track.service.ts`). Trước đó seller mua label xong vẫn không thấy mã vận đơn ở portal.
