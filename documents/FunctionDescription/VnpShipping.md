# VNP eGlobal Shipping — Function Description

> **File FE:** `apps/web/src/components/orders/VnpShipmentDialog.tsx`, `apps/web/src/pages/shipments/index.tsx` (trang `/adm/shipments`), `apps/web/src/components/settings/VnpShippingConfig.tsx` (mục `/adm/settings/vnp-shipping`), `apps/web/src/services/vnpShipping.ts`, entry ở `apps/web/src/components/orders/OrderRowActionsMenu.tsx` + Sidebar group Orders (`onlyForRoles` Admin/SuperAdmin)
> **File BE:** `apps/api/src/modules/shipping-vnp/` (`vnp-eglobal.client.ts`, `shipping-vnp.service.ts`, `shipping-vnp.controller.ts`, `shipping-vnp.module.ts`, `shipping-package.entity.ts`, `shipment.entity.ts`)
> **Route:** dialog mở từ menu "..." của hàng đơn (trang Orders) + trang quản lý `/adm/shipments`
> **API:** `/v1/shipping-vnp/*`

## 1. Overview

Tích hợp **VNP eGlobal Shipment API** (carrier aggregator của VNPost/Nexo, staging `https://vnp-eglobal.itel.dev`) để tạo vận đơn + label cho đơn sản xuất. **Giai đoạn hiện tại là TEST**: Admin/SuperAdmin bấm tay từng đơn qua nút "Vận đơn VNP" ở bảng đơn hàng, mục tiêu là chạy thật toàn trình (check địa chỉ → tạo vận đơn → tracking → hủy) và **soi raw response tìm xem label nằm ở đâu** — spec VNP không khai response body (mọi endpoint trả `object` trống trong OpenAPI, PDF cũng bỏ trống mục Response).

Nguồn spec: `Data/Tai_lieu_API_VNP_eGlobal_dev.pdf` + OpenAPI sống `https://vnp-eglobal.itel.dev/api/v3/api-docs` (151 endpoints, auth Bearer JWT qua `POST /auth/signin`).

Định hướng sau khi test ổn (CHƯA làm): auto-hook tạo vận đơn khi đơn vào công đoạn Đóng hàng, nút in label trên màn quét của công nhân pack, đổ tracking về Customer Portal.

## 2. Luồng hoạt động

1. Bảng đơn hàng → menu "..." của hàng → **"Vận đơn VNP"** (chỉ Admin/SuperAdmin) → mở `VnpShipmentDialog`.
2. Dialog gọi `GET /shipping-vnp/status` — thiếu env thì hiện banner cảnh báo kèm tên biến thiếu.
3. **Bước 1 — Kiểm tra địa chỉ** (2 lớp, `ShippingVnpService.checkAddress()`): (a) **pre-check local** các gate mà createShipment chắc chắn chặn nhưng USPS bỏ qua/tự sửa — country phải US, state phải thuộc `VALID_US_STATE_SET`, đủ street/city/zip; (b) gọi `POST /shipment/usps/checkAddress` và parse CHÍNH XÁC `result.verifications.{zip4,delivery}` (delivery bắt cả số nhà không tồn tại `E.ADDRESS.NOT_FOUND`; `code` ngoài cùng LUÔN 200 kể cả khi sai — không dùng `looksOk`). USPS tự sửa state theo zip (gõ "ZZ" vẫn trả "NC") → nếu state USPS trả khác state của đơn thì đánh invalid bắt sửa dữ liệu. Badge hợp lệ/không + message lý do (nối bằng " • ") + raw.
4. **Bước 2 — Tạo vận đơn** — **GỘP THEO `orderId` seller (1 đơn nhiều item = 1 label)**: phía mình mỗi item là 1 `OrderEntity` có `productionId` riêng, nhưng seller đặt 1 đơn (`orderId`) nhiều item và chỉ mua 1 label. Dialog gọi `GET /shipping-vnp/orders/:id/group` hiện danh sách item cùng `orderId` (loại đơn hủy); item khác trong nhóm đã có vận đơn active → chặn tạo thêm. Chọn service (`Standard/Express/Uniuni/Letter/FirstFlat/FirstClass/UpsGround`) + shipping_type (`GDE/DOMESTIC`) + cân nặng fallback gram (chỉ áp cho item thiếu `order.weight`) → BE chuỗi:
   - `POST /shipment/createAddress` (type `ShippingTo`, map từ `shippingAddress`) → lấy `toAddressId`;
   - `POST /shipment/createShipment` — **1 entry `package_details` cho MỖI item của nhóm** (weight riêng từng item), **`shipping_from_id` resolve THEO XƯỞNG của đơn** (xem §2b), `shipping_unit_id` = env, **`rep1` = `productionId` từng item** (unique bên VNP → chống tạo trùng, tra ngược `GET /shipment/getByRef1/{ref1}`), `rep2` = `orderId`, `ship_date`/`ready_time`/`last_time_available` = hôm nay, `disable_fallback: true` chỉ khi service Uniuni;
   - dò response (`digString` BFS các key phổ biến) nhặt `shipmentId`/`trackingCode`/`labelUrl` → **lưu subdoc `order.vnpShipment` lên CẢ nhóm** (item nào mở dialog cũng thấy); tracking/hủy/nhặt-bù-label cũng updateMany theo `vnpShipment.shipmentId`.
5. Đơn đã có vận đơn: dialog hiện shipmentId/tracking/link label + 3 nút **Tra tracking** / **Chi tiết shipment** (GET `/shipment/{id}` — soi bù label nếu createShipment không trả) / **Hủy vận đơn** (hủy xong được phép tạo lại). **Hủy FAIL-CLOSED từ 2026-09-05 (ShippingLabelPatterns.md §4):** ① từ chối nếu `scannedAt` đã có HOẶC `publicTrack` báo có hành trình (`hasCarrierSignal` — nhân tiện ghi luôn `scannedAt` làm bằng chứng) HOẶC không hỏi được hãng/không có tracking code — nghi ngờ thì chọn hướng không mất hàng; ② chuyển record `cancelling` + `cancelRequestedAt`; ③ gọi VNP hủy — không nhận được trả lời → GIỮ `cancelling` cho cron dọn, hãng trả lỗi rõ → trả record về trạng thái mở cũ; ④ chỉ khi hãng trả lời OK mới chốt `cancelled` (shape response cancel thật CHƯA đo — khi đo được siết thêm điều kiện xác nhận). Record kẹt `cancelling` quá 15 phút do cron `reconcileCancelling()` dọn: hãng nói không còn (404/text dạng cancelled qua `isCancelledStatusText`) → chốt `cancelled`; tracking có tín hiệu → **hủy bất thành**, revive `in_transit` + `scannedAt` + `carrierNote` cho ops; mù mờ → giữ nguyên + warn, KHÔNG tự mở đường hoàn tiền. Dưới cùng dialog có section **"Lịch sử vận đơn"** — mọi record của đơn (kể cả đã hủy) từ bảng `shipments`.
6. Client VNP tự đăng nhập lấy JWT (`LoginRq {email,password}`), cache in-memory, dính 401 thì re-login 1 lần rồi retry.

### 2a. Model lưu trữ — bảng `shipping_packages` + `shipments` (từ 26/08)

Nghiệp vụ: 1 đơn sản xuất (`OrderEntity`) = 1 **item** của khách; 1 đơn khách (`orderId` seller) nhiều item; **label luôn dán lên 1 KIỆN vật lý** → shipment trỏ vào **pack**, KHÔNG trỏ đơn khách. Đơn khách **không bao giờ tách** ra nhiều pack.

- **`shipping_packages`** (`ShippingPackageEntity`) — 1 kiện: `code` (`PK-XXXXXXXXXX` qua `genCode`), `factoryId`, `orderCodes[]` (orderId seller — hiện luôn ≤1), `productionOrderIds[]` (OrderEntity.\_id — index, dùng tra lịch sử theo đơn), `productionIds[]` (snapshot hiển thị), `parentPackageId` (**để dành CHƯA dùng** — sau này thùng master gom nhiều kiện đi hub có label riêng; gộp 2 đơn cùng địa chỉ 1 label = thêm phần tử `orderCodes`, đều không phải đổi schema). Pack **tự sinh ngầm** lúc Admin bấm mua label, hiện 1 pack = 1 đơn khách.
- **`shipments`** (`ShipmentEntity`) — **mỗi lần mua label = 1 record MỚI, không bao giờ ghi đè**: `packageId` (ref), `provider` ('vnp-eglobal' — sau này thêm khi tự ship), `vnpShipmentId`/`trackingCode`/`labelUrl`/`service`/`shippingType`/`fromAddressId`/`toAddressId`/`shippingCost` (VNP trả lúc tạo), `status` (`purchasing|created|in_transit|delivered|cancelling|cancelled|failed` — `cancelling` để dành cho luồng hủy fail-closed), `failReason`, `cancelledAt`, `lastTrackingStatus`/`lastTrackingAt` + `trackingEvents[]` (lịch sử poll), `createdByUserId/Name`. Hủy → set `status='cancelled'`, mua lại → record mới ⇒ **lịch sử tự có**.
- **Trạng thái HÃNG tách khỏi trạng thái MUA (từ 2026-09-05 — ShippingLabelPatterns.md §3, helper thuần `carrier-status.ts` + spec):** `lastTrackingStatus` = text thô của hãng (≡ carrierStatus khuôn), `lastTrackingAt` ≡ carrierSyncedAt, **`scannedAt`** = lần ĐẦU hãng báo label vào mạng lưới — **chốt an toàn của luồng hủy** (set đúng 1 lần, không bao giờ clear; text "no tracking information" KHÔNG tính là tín hiệu), **`carrierNote`** = note/reason từ hãng cho ops cứu đơn (cố ý không nhặt key `message` — VNP nhét message generic). `buildCarrierPatch()` dùng chung cho cron poll + nút tra tay; snapshot `order.vnpShipment` sync thêm `scannedAt`. **Response LỖI của hãng không được đọc làm trạng thái** (`hasCarrierError()` + `extractStatusText()` chỉ nhận string, không mò vào nhánh `error`): VNP trả `{code:200, result:{error:{status:500}}}` khi cạn quota USPS — từng bị digString nhặt `500` làm text tracking → set `scannedAt` oan (dính thật staging 2026-09-05, spec giữ nguyên response đó làm test case); luồng hủy gặp response lỗi → cùng nhánh fail-closed với lỗi mạng. 2 giá trị `in_transit`/`delivered` trong `status` chỉ là phase tổng hợp cho FE/stats — chốt hủy sẽ đọc `scannedAt`, không đọc status. Index `(provider, status, createdAt)` đặt theo đường quét của 2 cron (chú thích tại entity).
- **Luồng mua GIỮ CHỖ (từ 2026-09-05 — ShippingLabelPatterns.md §1):** `createShipment()` tạo pack + record `status='purchasing'` **TRƯỚC** khi gọi VNP → gọi hãng → **ghi ngay** `vnpShipmentId`/tracking/label/cost vào record (bước ③ tách riêng) → chốt sang `created` bằng **update có điều kiện** (`{_id, status:'purchasing'}`). Nhánh lỗi: VNP trả lời rõ là lỗi → `failed` + `failReason` (không mất tiền); VNP KHÔNG trả lời được (network/5xx) → **GIỮ `purchasing`** cho cron đối soát, message UI dặn "KHÔNG bấm mua lại ngay". Guard chặn mua chồng: nhóm còn record `purchasing` → từ chối tạo lượt mới. **Cron đối soát `reconcilePurchasing()`** chạy ĐẦU mỗi lượt tracking cron (chung khóa in-flight): quét record `purchasing` quá 15 phút (trần 50/lượt, giãn nhịp 800ms), probe VNP (`getShipment` theo id đã ghi ở ③, fallback `getByRef1` theo rep1=productionId) rồi phân loại theo §8 qua helper thuần `interpretVnpLookup()` (`purchase-reconcile.ts`, spec `purchase-reconcile.spec.ts` giữ luật): found → chốt nốt `created` + sync snapshot (nếu shipmentId đã thuộc record khác = label lượt trước → `failed`); hãng nói không có (404/result rỗng) → `failed` + `failReason`; không hỏi được → ĐỂ NGUYÊN chờ lượt sau. **KHÔNG BAO GIỜ xóa record kẹt** — nó là dấu vết tiền. Client có `probe()` không-ném trả `{http, body}` để phân biệt 404 ≠ 5xx (`request()` chung gộp mọi lỗi nên không dùng được).
- **`order.vnpShipment` trên orders GIỮ LẠI làm SNAPSHOT mỏng** (sync như cũ ở create/cancel/tracking/detail, updateMany cả nhóm) — để bảng đơn/list render không phải join; **nguồn sự thật là 2 bảng mới**. Data test cũ trước 26/08 không backfill (chưa lên production).
- **Vận đơn KHÁCH TỰ CẤP cũng nằm ở đây (ORD-26)** — xem §2c.
- **Trạng thái ship cập nhật — cron poll 2 lần/ngày** (`pollTrackingCron()`, endpoint public `GET /shipping-vnp/tracking/cron` — hệ thống crontab bên ngoài gọi; **khóa secret `VNP_TRACKING_CRON_SECRET`** qua header `X-Cron-Secret`/`?secret=`, pattern giống webhook Telegram, KHÔNG mở trần như `recover-held-from-onospod/cron`): poll các shipment `created`/`in_transit` **tạo trong 30 ngày** (quá 30 ngày = label chết, dừng poll; delivered cũng dừng), tuần tự giãn nhịp 800ms, limit 200/lần + khóa in-flight chống gọi chồng. Nguồn: `GET /tracking/public/track/{trackingCode}` (VietNamLogistics, **không token, không ăn quota USPS**) — `GET /shipment/tracking` proxy USPS Web Tools **dính quota dùng chung** (staging đã cạn 26/08) chỉ dùng bấm tay. Chỉ ghi `trackingEvents` khi status text ĐỔI; `classifyTrackingStatus()` conservative (text chứa "delivered" → `delivered`, còn lại `in_transit` — shape response khi hàng chạy thật CHƯA biết, bổ sung map khi có đơn thật). Spec VNP **không có webhook đăng ký cho partner** (`POST /public/webhook` là đầu nhận phía họ).
- **Tiền**: (1) số dư ví hiện ở dialog mua label (cạnh tiêu đề Bước 2) + trang `/adm/shipments`; (2) **đối soát**: sau mỗi createShipment thành công BE gọi `availableBalance` lưu `balanceAfter` vào record (lỗi thì bỏ qua, không fail luồng mua); cột `shippingCost` + `balanceAfter` đủ đối soát tổng chi với biến động ví. **Báo giá TRƯỚC khi mua (`calculateFee`/`getRate`): CHƯA làm — chờ user báo.** Cảnh báo ví Telegram: user quyết KHÔNG cần.
- **Trang `/adm/shipments`** (`pages/shipments/index.tsx`, sidebar "Vận đơn" trong group Orders, `onlyForRoles` Admin/SuperAdmin + guard `isAdmin` trong page): card số dư ví + **dashboard chi phí** (`GET /shipping-vnp/shipments/stats` — cards tổng/chi phí/active/delivered/cancelled + 3 bảng theo tháng (giờ VN)/xưởng (resolve shortName)/service, filter from/to; cost + 3 bảng bucket chỉ tính record `VNP_SHIPMENT_COUNTED_STATUSES` (`created|in_transit|delivered`) — loại `purchasing`/`failed`/`cancelled`; policy hoàn tiền khi hủy của VNP chưa rõ) + list search/filter status + click hàng mở **timeline sự kiện** (created → trackingEvents → cancelled). i18n namespace `shipments`. **Clone màn Shipments hệ cũ (04/10/2026, `LegacyClone-Orders.md`):** (1) **thang trạng thái HÃNG 10 mức** như `shipment_status` hệ cũ (Processing · Picked Up · Processed · In Transit · Out For Delivery · Delivery Attempt · Delivered · Failed · Exception · Other) — hàng pill trên danh sách, nhãn màu dưới nhãn trạng thái MUA; **suy LÚC ĐỌC từ text thô `lastTrackingStatus`, KHÔNG lưu** (`packages/shared/client/carrier-phase.ts`: một danh sách luật có thứ tự, `carrierPhaseOf()` cho FE, `carrierPhaseFilter()` dựng bộ lọc Mongo "khớp luật này VÀ không khớp luật nào trước" cho BE `GET /shipping-vnp/shipments?carrierPhase=`). Luật là ĐOÁN theo câu chữ USPS/VNP vì chưa ai thấy text VNP khi hàng chạy thật — có text thật thì sửa luật, lịch sử tự phân loại lại, không migrate. Chỉ label còn sống (`created|in_transit|delivered`) có thang; vận đơn khách tự cấp không có text → `other` (mình không poll), label mình mua chưa có text → `processing`. `carrier-phase.spec.ts` khoá: lọc theo X ≡ gắn nhãn X trên 350 dòng mẫu (bộ lượng giá nhỏ + đã chạy lại trên Mongo thật), mỗi label sống đúng 1 mức. (2) Cột **Sản phẩm** + **Giao tới** — `listShipments` nạp theo lô đơn sản xuất của kiện (`withItemsAndShipTo`, 1 truy vấn/trang, `items[]` + `shipTo` trên `VnpShipmentRecordZod`). (3) Một `DateRangePicker` inline (Hôm nay/Hôm qua/7 ngày/Tháng này/Tháng trước…) điều khiển CẢ dashboard chi phí lẫn danh sách (`from`/`to` mới trên `GetVnpShipmentsZod`, theo `createdAt` giờ VN). Mọi điều kiện lọc ghép bằng `$and`, không gán đè (search `$or` + thang `$or`/`$nor`).

### 2c. Vận đơn KHÁCH TỰ CẤP — `provider = 'customer'` (ORD-26)

Không phải label nào cũng do hệ thống mua. Khách hàng lớn (SBTT / hệ cũ / khách chạy Public Order API) mua label bên ngoài rồi gửi kèm ngay lúc lên đơn — xưởng chỉ việc in ra dán. Trước ORD-26 mấy giá trị đó chết ở staging `customer_orders.items[].tracking`: đơn đẩy vào sản xuất là mất dấu, người đóng gói không thấy label đâu.

Chỗ đúng để chứa chúng là **CHÍNH cặp bảng ở §2a**, không phải bảng thứ ba: luật "label dán lên KIỆN" không đổi theo chỗ mua label, và bảng thứ hai chỉ tổ bắt mọi chỗ đọc vận đơn phải union 2 nguồn mãi mãi. Phân biệt bằng `provider`:

| `provider` | Nguồn label | Hủy được không |
| --- | --- | --- |
| `vnp-eglobal` | hệ thống mua qua VNP (§2a) | có — `POST /shipping-vnp/orders/:id/cancel` |
| `customer` | khách mang tới lúc lên đơn | **không** — hệ thống không sở hữu label này |

- **3 đường vào, 1 cổng ra:** CSV Customer Portal (`tracking_number`/`tracking_carrier`/`tracking_url`/`shipping_label` — đã có sẵn trong template) · CSV admin (`Tracking Number`/`Tracking Carrier`/`Tracking URL`/`Shipping Label`, dò **theo TÊN header** nên sheet cũ không có cột vẫn parse y như trước) · Public Order API (`items[].tracking`). Cả ba đều hội tụ ở `ImportProductionOrderRow.tracking` → `OrderService.importOrders()`.
- **Ghi bởi `ShipmentIngestService`** (`shipment-ingest.service.ts`, export từ `ShippingVnpModule`, `OrderModule` import vào — chiều phụ thuộc 1 chiều, không vòng DI). Chạy SAU khi đơn đã vào DB (record cần `OrderEntity._id`) và **được bọc try/catch ở cả 2 tầng**: đơn đã import xong rồi, hỏng khâu ghi vận đơn không được phép biến cả lô import thành lỗi.
- **Idempotent theo (provider, trackingCode)** — hoặc `labelUrl` khi đơn chỉ có file label: import lại cùng file / push lại cùng đơn chỉ `$addToSet` item vào kiện cũ, KHÔNG đẻ record thứ hai. **`trackingCode` lưu + tra CÙNG dạng chuẩn hóa** (`normalizeTrackingCode` — bỏ mọi khoảng trắng + uppercase): cùng một số gõ "9400 1000…" và "94001000…" phải quy về 1 kiện. Nhiều item cùng số tracking = **1 kiện** (đúng mô hình pack). Cố ý KHÔNG gộp xuyên `orderId` seller: trùng số tracking giữa 2 đơn khác nhau gần như luôn là lỗi dữ liệu, gộp lại là trộn nhầm kiện.
- **Snapshot `OrderEntity.tracking`** (`{number, carrier, url, labelUrl}`, index `tracking.number`) — tách hẳn khỏi `vnpShipment` để nút "Vận đơn VNP" không tưởng đơn đã có label hệ thống. Import lại mà file không có cột tracking thì **không ghi đè** (`normalizeProductionOrderTracking` trả `undefined` → key bị bỏ khỏi `$set`), tránh xoá mất vận đơn đã nhận.
- **Hiển thị**: bảng đơn hàng hiện chip `🏷️ Label KH` + số tracking ở cột thông tin (`workshopTableConfig.tsx`) — **KHÔNG gate theo role admin** như chip label VNP, vì người cần nó nhất là công nhân Đóng hàng.
- Test giữ luật: `apps/api/src/modules/shipping-vnp/shipment-ingest.spec.ts`.

### 2d. Label do SELLER tự mua qua portal (09/09/2026)

Seller mua label cho đơn cod/tiktok của mình ở Seller Portal — dùng NGUYÊN `createShipment()` của module này (giữ chỗ/chống trùng/đối soát không đổi), chỉ khác: trả bằng **ví seller** theo bảng giá riêng và record `shipments` có thêm `sellerPrice` (giá thu seller, USD) + `sellerCustomerId` + `sellerWalletTxnId` — margin = `sellerPrice − shippingCost`, hiện ở cột "Thu seller" `/adm/shipments`. Toàn bộ luồng/ví/lỗi an toàn: xem [`SellerWallet.md`](SellerWallet.md).

### 2b. Địa chỉ gửi (ShippingFrom) theo xưởng — cấu hình UI, sống theo môi trường

- **Cài đặt → Vận chuyển VNP** (`/adm/settings/vnp-shipping`, perm `role.manage`, component `VnpShippingConfig.tsx`): (1) form **tạo địa chỉ gửi** — BE gọi thẳng `POST /shipment/createAddress` (type `ShippingFrom`) bên VNP rồi lưu id + snapshot; (2) bảng **gán xưởng → địa chỉ** (mỗi xưởng 1 select; nhiều xưởng chung 1 địa chỉ OK — 2D Thái Nguyên + Gỗ Thái Nguyên → cùng địa chỉ Thái Nguyên) + **địa chỉ mặc định**.
- Config lưu blob `system_configs` key `VNP_SHIPPING_CONFIG_KEY = 'vnp_shipping_config'` (`{addresses[], factoryMap{factoryId→vnpAddressId}, defaultAddressId}`) — **sống theo môi trường**: production tự bấm tạo/gán trên UI, KHÔNG restore data từ local (id địa chỉ bên VNP staging/production khác nhau).
- `resolveFromAddressId(order)` khi tạo vận đơn: `factoryMap[order.factoryId]` → `defaultAddressId` → env `VNP_EGLOBAL_FROM_ADDRESS_ID` (fallback cuối, giờ TÙY CHỌN) → không có thì báo lỗi trỏ về trang Settings.
- Địa chỉ đầu tiên tạo ra tự thành mặc định. Nút gỡ chỉ xóa khỏi config (không xóa bên VNP) + tự dọn mapping trỏ vào nó.
- **Phát hiện khi test staging (2026-08-24) — ĐÃ TẠO LABEL THÀNH CÔNG:**
  - Shipping unit staging `b47b8c02...` = **USPS_zone (supplier usps, nội địa US)** → `shipping_type: "DOMESTIC"`; from PHẢI khớp 1 trong 8 **hub US** (Carson CA 90810 / Jamaica NY 11434 / Garden Grove CA 92841 / Houston TX 77099 / Westminster CA 92683 / St. Louis MO 63132 / Wentzville MO 63385 / Columbus OH 43219) — danh sách nằm trong lỗi `valid_from_address`.
  - **BẪY MAPPING QUAN TRỌNG NHẤT: VNP map `district` của address thành `state` phía carrier — field `state` gửi lên bị BỎ QUA lúc createShipment, `ward` chỉ là placeholder.** Xác nhận bằng test cô lập 24/08 (chỉ `district`=NC → tạo label OK; chỉ `ward`=NC → "State field is invalid") + khớp curl mẫu tài liệu VNP (`district: "TX"`). Địa chỉ US phải điền `district` = MÃ BANG ("CA"); createAddress không gửi `state` thì VNP tự copy district→state, lỗi chỉ nổ ở createShipment. Service đã tự xử lý (`createShipment` + `createFromAddress` với country=US set district=mã bang). Lưu ý phụ: thiếu `ready_time`/`last_time_available` ở createShipment → lỗi mù `"Cannot invoke method getTime() on null object"` — service luôn gửi đủ.
  - Carrier validate thêm: kích thước ≥ 0.1 (đơn thiếu dims → service gửi 1cm), phone người nhận bắt đầu khác 0 + 8-15 số (`normalizeVnpPhone`, fail → placeholder `9999999999`).
  - **Response createShipment thành công**: `{ code:200, result:[{ id (=shipmentId uuid), shipping_cost, zone, shipmentResults:{ id, tracking_code (USPS 30 số), image_url (**LABEL PDF** trên CloudFront) } }] }` — service parse chính xác các field này, digString chỉ còn là fallback.
  - Ví phải ≥ $50 (lỗi "Insufficient wallet balance"). Format lỗi VNP: `{code, message (JSON lồng của carrier), timestamp, details, traceCode}` — `traceCode` gửi Nexo để tra log.

## 3. API / Schema

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/v1/shipping-vnp/status` | Trạng thái cấu hình (tên env thiếu — không lộ secret) |
| GET | `/v1/shipping-vnp/config` | Config địa chỉ gửi theo xưởng (blob) |
| POST | `/v1/shipping-vnp/from-addresses` | Tạo địa chỉ ShippingFrom bên VNP + lưu blob |
| GET | `/v1/shipping-vnp/remote-addresses` | Địa chỉ đã lưu bên VNP (raw — tìm id hub US) |
| POST | `/v1/shipping-vnp/from-addresses/import` | Thêm địa chỉ ĐÃ TỒN TẠI bên VNP vào config bằng id |
| GET | `/v1/shipping-vnp/wallet` | Số dư ví VNP (cần ≥ $50 mới tạo được vận đơn) |
| PUT | `/v1/shipping-vnp/config/map` | Lưu factoryMap + defaultAddressId |
| DELETE | `/v1/shipping-vnp/from-addresses/:vnpAddressId` | Gỡ địa chỉ khỏi config (không xóa bên VNP) |
| GET | `/v1/shipping-vnp/orders/:orderId/group` | Nhóm item cùng `orderId` seller (1 đơn = 1 label) |
| POST | `/v1/shipping-vnp/orders/:orderId/check-address` | Bước 1 — USPS checkAddress cho địa chỉ đơn |
| POST | `/v1/shipping-vnp/orders/:orderId/shipment` | Bước 2 — createAddress + createShipment, lưu `vnpShipment` |
| GET | `/v1/shipping-vnp/orders/:orderId/tracking` | Bước 3 — tra tracking |
| GET | `/v1/shipping-vnp/orders/:orderId/shipment-detail` | GET /shipment/{id} bên VNP, nhặt bù label/tracking |
| PUT | `/v1/shipping-vnp/orders/:orderId/cancel` | Bước 4 — hủy vận đơn FAIL-CLOSED (gate `scannedAt` + hỏi hành trình trước, trạng thái trung gian `cancelling` — xem §2 điểm 5) |
| GET | `/v1/shipping-vnp/shipments` | Danh sách vận đơn toàn hệ thống (bảng `shipments`, paging + search tracking/mã kiện/mã đơn + filter `status`) |
| GET | `/v1/shipping-vnp/shipments/stats` | Dashboard chi phí label (tổng/tháng/xưởng/service, from/to giờ VN) — trang `/adm/shipments` |
| GET | `/v1/shipping-vnp/orders/:orderId/shipments` | Lịch sử vận đơn của 1 đơn (mọi record kể cả đã hủy) — section "Lịch sử vận đơn" trong dialog |
| GET | `/v1/shipping-vnp/tracking/cron` | **[Public + secret]** Cron 2 lần/ngày: chạy `reconcilePurchasing()` (dọn record kẹt `purchasing` — §2a) TRƯỚC rồi poll tracking (dừng khi delivered / quá 30 ngày). Khóa bằng env `VNP_TRACKING_CRON_SECRET` — header `X-Cron-Secret` hoặc `?secret=`, sai/thiếu → 401; env trống → từ chối tất cả (fail-closed, ShippingLabelPatterns.md §7) |

Tất cả `@Auth([SuperAdmin, Admin])`. Mọi Res kèm `raw` (JSON nguyên văn VNP).

```ts
// packages/shared/dtos/vnp-shipping.dto.ts
VnpShipmentInfoZod = { shipmentId?, trackingCode?, labelUrl?, service?, shippingType?,
  toAddressId?, addressValid?, addressCheckedAt?, createdAt?, cancelledAt?,
  lastTrackingStatus?, lastTrackingAt? }
// OrderEntity.vnpShipment (subdoc raw, order.entity.ts) + ProductionOrderZod.vnpShipment — SNAPSHOT mỏng
CreateVnpShipmentZod = { service, shippingType, weightGram, lengthCm?, wideCm?, heightCm?, packageType?, packages }
// Bảng riêng (§2a):
VnpShippingPackageZod = { _id, code, factoryId?, orderCodes[], productionOrderIds[], productionIds[], parentPackageId?, createdAt? }
VnpShipmentRecordZod = { _id, packageId, provider, vnpShipmentId?, trackingCode?, labelUrl?, service?, shippingType?,
  fromAddressId?, toAddressId?, shippingCost?, status (VNP_SHIPMENT_RECORD_STATUSES 7 giá trị), failReason?,
  cancelRequestedAt?, cancelledAt?, lastTrackingStatus?, lastTrackingAt?, scannedAt?, carrierNote?,
  createdByUserId?, createdByUserName?, createdAt?, package? }
// VnpShipmentInfoZod (snapshot order.vnpShipment) thêm scannedAt?
// CreateVnpShipmentZod thêm requestId? (khoá idempotency §2 — FE sinh uuid mỗi intent mua)
// ShipmentEntity thêm groupKey/purchaseKey + 2 unique partial index
// `unique_vnp_group_active`/`unique_vnp_purchase_key` (spec shipment-unique-index.spec.ts):
// chống mua trùng Ở TẦNG DB — cùng requestId gọi lặp → `replayPurchase()` trả nhãn
// lượt trước (không lỗi); record cancelled/failed thoát partial filter → mua lại OK.
// ShippingVnpService.onModuleInit ÉP createIndexes + log lỗi rõ — autoIndex của
// mongoose build nền nuốt lỗi, từng boot xong THIẾU index mà không có dòng log nào
// VNP_SHIPMENT_COUNTED_STATUSES = ['created','in_transit','delivered'] — status tính vào dashboard chi phí
// VnpTrackingCronResZod thêm `reconcile? {scanned, finalized, failed, unknown}` — kết quả dọn record kẹt purchasing
GetVnpShipmentsZod = { page, size, search? }
```

Env (`apps/api/.env.development.example`): `VNP_EGLOBAL_API_URL` (default staging), `VNP_EGLOBAL_EMAIL`, `VNP_EGLOBAL_PASSWORD`, `VNP_EGLOBAL_SHIPPING_UNIT_ID` (staging: `b47b8c02-5dd0-40cf-9b22-10978d82bdc4`), `VNP_EGLOBAL_FROM_ADDRESS_ID`. Thiếu email/password → `vnpEglobalConfig` getter (api-config.service.ts) trả null, feature tự disable.

## 4. UI Components

- `VnpShipmentDialog.tsx` — dialog 3 section (địa chỉ / vận đơn / **lịch sử vận đơn** từ `GET orders/:id/shipments`, badge Đang hoạt động/Đã hủy + link label + phí + người tạo), mỗi call hiện `RawBlock` (details/pre collapsible) chứa raw response. Select native styled, i18n namespace `orders` key `vnp.*` (+ `vnp.history*`) + `rowActionsMenu.vnpShipment` (vi/en).
- `OrderRowActionsMenu.tsx` — item "Vận đơn VNP" (icon Truck), chỉ `isAdmin`, disable khi đơn hủy.
- `workshopTableConfig.tsx` — `WorkshopOrderRow` thêm `weight`/`shippingAddress`/`vnpShipment`.

## 5. Backend logic

- `VnpEglobalClient` — axios, baseURL từ config, timeout 30s; `digString()` không nằm ở client mà ở service.
- `ShippingVnpService.loadGroup()` — nhóm theo `orderId` (trim, loại `cancelledAt`); đơn không có `orderId` → nhóm 1 mình. `createShipment()` guard 3 lớp: (1) pre-check đọc snapshot/`purchasing` record (message thân thiện); (2) **unique partial index `unique_vnp_group_active`** — cuộc đua 2 click thắng thua ở tầng DB, E11000 quy về lỗi mềm trỏ tới Lịch sử vận đơn (§2); (3) `rep1` unique chặn thêm phía VNP. Idempotency: `requestId` (FE sinh uuid mỗi intent) → `purchaseKey` unique — gọi lặp trả nhãn lượt trước qua `replayPurchase()` (record đang `purchasing`/`cancelling` → lỗi mềm bảo chờ đối soát).
- Chưa nói đến GIÁ label trong PDF/spec — hệ VNP chạy mô hình VÍ: `GET /availableBalance`, `POST /payment/generateQr` (topup), `GET /payment/exchangeRate`, `POST /public/calculateFee` + `POST /shipment/usps/getRate` (báo giá trước khi mua — cần JWT dù path "public"). Khi có tài khoản cần test thêm calculateFee + soi số dư trước/sau createShipment.
- Mapping địa chỉ US: `district` ← MÃ BANG (field carrier đọc làm state — bắt buộc), `ward` ← placeholder (service hiện điền cùng mã bang, vô hại), `state` ← mã bang (VNP bỏ qua lúc createShipment nhưng gửi kèm cho tự mô tả).
- `looksOk()` heuristic lỗi: `code>=400 || status>=400 || error` trên response — còn dùng cho createAddress/tracking/cancel; riêng checkAddress đã parse exact `verifications` (heuristic chỉ là fallback khi VNP đổi shape).

## 6. Performance notes

- Chỉ chạy khi bấm tay, 1 đơn/lần — không ảnh hưởng luồng chung. JWT cache in-memory (mất khi restart, tự login lại).

## 7. Permissions

- **Mọi bề mặt VNP đều CHỈ Admin/SuperAdmin** (rà soát 25/08; các endpoint lịch sử/stats thêm 26/08 cùng gate):
  - BE: 17 endpoint `@Auth([SuperAdmin, Admin])` + 1 endpoint cron public-có-secret (`GET /shipping-vnp/tracking/cron` — không JWT nhưng phải khớp `VNP_TRACKING_CRON_SECRET`; không trả data nhạy cảm, khóa vì mỗi lượt kéo tới 200 lần gọi ra VNP).
  - Trang `/adm/shipments`: sidebar `onlyForRoles` Admin/SuperAdmin + guard `isAdmin` redirect trong page.
  - Nút "Vận đơn VNP" + `VnpShipmentDialog`: gate `isAdmin` ở `OrderRowActionsMenu.tsx` (mount duy nhất).
  - Entry settings `/adm/settings/vnp-shipping`: `adminOnly: true` ở `pages/settings/index.tsx` — perm `role.manage` cấp qua custom role KHÔNG đủ, phải đúng role Admin/SuperAdmin.
  - Link 🏷️ Label ở cột mã đơn (`workshopTableConfig.tsx`): helper `isAdminViewer()` đọc `authStore` — role khác không thấy link/tracking.
- Agent API: field `orders.vnpShipment` khai trong registry (đọc được qua DSL — bề mặt riêng key-gated, không phải UI nhân viên).
