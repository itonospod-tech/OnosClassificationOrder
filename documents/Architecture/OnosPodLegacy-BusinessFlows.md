# Hệ cũ OnosPod (`app.onospod.com`) — Nghiệp vụ, dữ liệu và khoảng trống so với hệ mới

> **Mục đích:** tài liệu tham chiếu cho giai đoạn chuyển đổi toàn bộ vận hành từ OnosPod (mất source code) sang OnosFactory. Viết từ lượt khảo sát **chỉ đọc** ngày 07/09/2026 bằng tài khoản super admin: đi hết mọi màn hình, bắt các lệnh GraphQL giao diện gửi, đọc mã JS đã build để liệt kê lệnh ghi, và truy vấn API để lấy số liệu thật. **Không bấm bất kỳ nút nào gây ghi dữ liệu.**
>
> **Độ tin cậy:** phần "Nắm chắc" có số liệu/log chứng minh; phần "Suy ra" ghi rõ; phần "Chưa rõ" liệt kê ở §14 để người vận hành xác nhận.
>
> **Bổ sung 08/09/2026:** §1b cổng seller `seller.onospod.com`, §7b OnosExpress (hệ vận chuyển riêng của tập đoàn, có API công khai), §8 công thức giá suy ngược từ 600 đơn thật, §11b API công khai cho seller (hợp đồng cần tương thích), §13b chính sách đã công bố (175 thông báo). Bản sao tài liệu API ở `documents/Architecture/reference/`.
>
> **Liên quan:** hệ mới đọc dữ liệu OnosPod ở `apps/api/src/modules/order/onospod-order-lookup.service.ts` (tra đơn), `onospod-import.service.ts` (kéo production `PaginateMrpProduct`), `apps/api/src/modules/product-config/onospod-product-import.service.ts` (kéo sản phẩm). **Hệ mới KHÔNG ghi gì ngược về OnosPod.**

---

## 1. Kiến trúc kỹ thuật (nắm chắc)

- SPA React (CRA, 99 file JS build) tại `app.onospod.com`; API GraphQL duy nhất `POST https://api.onospod.com/graphql`. Introspection **tắt** (Apollo Server production).
- Xác thực: header `Authorization: Bearer <JWT>` (JWT HS256 chứa email + mật khẩu — **rất yếu**, ai có token là có mật khẩu) + `x-onos-super-token` cho quyền admin + `Origin/Referer` phải là `app.onospod.com` (thiếu → 403). Phân trang qua header `x-page`/`x-per-page`, tổng ở `x-total`.
- Mọi lệnh đều là **query/mutation ẩn danh** dựng bằng chuỗi (`"mutation {" + name + args`), không có `operationName`, nên log phía server không phân biệt được người gọi theo tên lệnh.
- Lưu trữ file: CDN `cdn.onospod.com` (barcode PDF, invoice xlsx, ảnh sản phẩm), `podorder.sgp1.digitaloceanspaces.com` (mockup), `poddesign.sgp1.cdn.digitaloceanspaces.com` (design), label ở `cdn.onosexpress.com`. Cấu hình S3 ở màn Storage.
- Thông báo: Telegram bot "Onos Manufacturer Bot" (nhóm `-599424200`) với 5 action bật: `tracking_update` (mention @NyanMew, nhóm ONOS-PODGEEK-Fulfill), `remind_every_day` 06:00 và 13:00, `new_production_request`, `package_done_request`, `production_error`. Cấu hình máy in: tem barcode 6×4.
- Có API token cho seller (màn "API Token"), log gọi API (`token-access-logs`), chặn IP (`block-logs`), tickets (trống), extensions (tải Chrome extension), system notifications (18 trang thông báo cho seller, tiếng Việt).

## 1b. Cổng seller `seller.onospod.com` (khảo sát 08/09/2026)

App Next.js riêng (next-auth, GraphQL proxy `/graphql`), là giao diện seller thật sự dùng — app `app.onospod.com` là admin/xưởng. Menu: **Dashboard** (số dư, thống kê đơn, Production Avg business days, Fulfilled/Delivered %), **Insights** (top sản phẩm theo đơn vị: tháng 9 4.767 unit, Baseball Jersey No Piping 11%), **Report → SLA** (đơn đẩy vào sản xuất theo ngày, Produced in 2/3/>3 days, Late rate; Ship Out/Delivered/In Transit, Delivered in 5 days), **Affiliate**, **Catalog** (collection 3D/2D/Embroidery, category, tag, technique; trang sản phẩm hiện giá theo phương thức "Express US" vs "Tiktok US Shipping", "IMPORT US TAX $0,42/unit", package gram/cm, size chart, template Drive, tải file SKU), **Orders** (tab Pending/Processing/In Production/Fulfilled/Completed/Refunded/Cancelled; "Issue Orders 99+"; nút **Push To Production**, Export, New order; cột ORDER/ITEMS/SHIPPING/STATUS/PAYMENT/SHIPMENT/NOTE; trạng thái phụ "Scheduled to Process order item design", "Mapping", "Insufficient account balance", "Ignore. Active"), **Import** (CSV theo Google Sheet mẫu), **OEM Orders** (đơn sản xuất số lượng lớn, tách khỏi đơn thường — hiện 0), **Billing** (Invoice 2.197 kỳ, Topup có tỷ giá USD/VND + mã giao dịch + ảnh chứng từ, Withdraw, Transactions), **File Library**, **Support** (FAQ: Manual Order Guide 8 bước, CSV Import Guide, Catalog, API Documentation, Design & Templates, Fast Shipping Service = onosexpress.com, Manual Topup; Freshchat + "Chat With AI Support"), **Tickets**, **Notifications** (system notifications), **Integrations** (Stores WooCommerce: connect, lịch đẩy tracking, delay ngày; Orders từ store), **Extensions**, **API**.

Luồng đặt đơn tay 8 bước (theo FAQ): chọn sản phẩm → chọn size → tải design + mockup → nhập địa chỉ → (tải label + tracking nếu seller tự ship) → chọn phương thức ship → Submit for production → gửi mã đơn cho support khi cần. Form New order có ORDER ACTIVITY (Created → Sent to fulfillment → Manufacturing → Finished → Picked Up → Delivered), bảng PRODUCT/QTY/PRICE/TAX/TOTAL, PACKAGE gram/cm, SUBTOTAL + SHIPPING + TAX (Import Tax + Customs Fee) = TOTAL, PAID, checkbox "I am responsible if the shipping address is incorrect", SHIPPING METHOD (có "No delivery needed, I will do it by myself" = COD), BUYER NOTE, TRACKING.

Hệ mới đã có Seller Portal (`apps/seller`) phủ Dashboard/Orders theo dòng/Create/Import/Account/API; **chưa có**: Insights, SLA report cho seller, Affiliate, OEM, Billing (invoice/topup/withdraw/transactions), File Library, Support/FAQ/Tickets, Integrations store, Extensions, "Push To Production" hàng loạt với kiểm tra số dư.

## 2. Quy mô (30 ngày tính đến 07/09/2026)

| Chỉ số | Số |
|---|---|
| Đơn tạo mới | 18.615 (processing 112 · in production 1.114 · fulfilled 4.459 · completed 12.362 · pending 77 · cancelled 475) |
| Đơn theo xưởng | Mê Linh 8.393 · Thái Nguyên 9.892 |
| Vận đơn | 14.820 (in transit 1.571 · delivered 9.309 · exception 7) |
| Production (item) qua MRP | Mê Linh 9.529 · Thái Nguyên 11.122 · Thái Nguyên Decor 29 · Grabink 0 · 2D US 0 |
| Kiện quét xong | Mê Linh 9.003 · Thái Nguyên 10.290 |
| Lô sản xuất | Mê Linh 66 · Thái Nguyên 63 |
| Chuyển trạng thái MRP 7 ngày | In Sewing→Packing 4.427 · Ready→In Sewing 258 · Ready→Ready 574 · On Hold→Packing 55 |
| Giao dịch ví seller (mẫu 800 gần nhất, 7 ngày) | payment 424 ($5.353) · import_tax 296 ($145) · active 76 ($53) · topup 4 ($2.569) |
| Giao dịch sản xuất (mẫu 600, 7 ngày) | 100% `payment` "Payment production <mã item>", mức 3,3–11,49 $/item |
| Người dùng | 2.761 (active 2.680 · banned 77); mẫu 600 mới nhất: 100% seller nhóm `sale+tiktok`, VIP 3 chiếm 98%, payment_type credit 62% |
| Sản phẩm | 3D 146+ · 2D 12 · Thêu 11 · Gỗ 16 · Grabink 12 · Dropship 11 (theo tab) |
| Tài khoản vận chuyển (logistics) | 125: SBTT 54 · ONOSEXPRESS 38 · SHIPEXPRESS 32 · GHTK 1; active 62 |
| Hóa đơn seller | 5.586 (pending 2.367 · paid 3.215); hóa đơn sản xuất 272 trang |

Kết luận: hệ cũ **đang là hệ vận hành thật**, không phải "chạy cho có". Xưởng Mê Linh và Thái Nguyên quét MRP cũ hằng ngày (tài khoản chung theo vai: `printer@email.com`, `packager@email.com`), tạo lô hằng ngày, và mọi tiền nong đều chốt ở đây.

## 3. Thực thể và trường quan trọng

### 3.1 User (seller / nhân viên)
Trường đáng chú ý: `identity`/`identity_label` (mã seller, ví dụ TIENHC — khớp `userSku` hệ mới), `groups[]` (vai), `vip` 0..5, `partner_vip`, `payment_type` credit|debit + `debit_limit`, `total_credit` (số dư, âm = nợ), `ship_by_seller`/`ship_by_onos`, `default_shipping_method`, `enable_non_ship`, `addition_base_cost`, `addition_shipping_service_price`, `is_international`, `active_tracking_day`/`day_update_tracking`, `process_without_design`, `disable_design_production`, `enable_check_dimension`, `hold_off`, `current_affiliate_id`, `sale_plan`.

Vai (`usergroups`, 18 nhóm): `[Super Admin] super_root`, `[Admin] root`, `[Fulfiller]`, `[Cutter] cut_group`, `[Printer] print_group`, `[Sewer] sew_group`, `[Packager] package_group`, `[Accounting]`, `[Order QC]`, `[Supporter]`, `[Designer]`, `[Seller] sale`, `[Tiktok]`, `[SUPER 0] production_member`, `[SUPER 1 - P] partner`, `[PARTNER VIP]`, `partner_sale`, CUSTOMER ROLE. Ma trận quyền theo module `view/add/update/delete` (trả về rỗng với super admin trong khảo sát).

### 3.2 Order
`identity` (mã đơn `XX-#####-#####`, cùng dạng mã hệ mới), `platform_id`/`alias_id` (mã bên sàn / merchant), `custom_id`, `status`, `auth` (seller), `manufacture_id`, `line_items[]` (mỗi item: sku biến thể, `print.meta_data` gồm Base_cost/Sale_cost/weight/package_*, design theo vị trí `front/back/sleeve/hood/chest_left/...`, `print_areas`, `production_id`, `productions[]`), `shipping` (địa chỉ, `is_national` + `national{}` cho nội địa), `shipping_method` (ONOSEXPRESS/SBTT/…), `tracking{tracking, carrier, url, shipping_label.url, shipment{status, detail[]}}`, tiền: `subtotal`, `shipping_price`, `shipping_addition_price`, `total_tax`, `total`, `base`, `discount_vip_total`, `total_refund`, `total_paid`; mốc: `created_at`, `paid_at`, `inproduction_at`, `completed_at`, `delivered_at`, `production_business_day`, `delivered_business_day`; cờ: `is_priority`, `is_test`, `ship_by_seller`, `keep_in_stock`, `defer_tracking`; `transactions[]`, `order_issues`, `queues`, `replacement`/`return` (RAR), `cancel_reason`/`reject_reason`.

### 3.3 Production (MRP product) — 1 item = 1 production
`increment_id` (mã sản xuất `XX-#####-#####`, chính là `productionId` hệ mới), `barcode` `N-<mã>` (+ PDF), `mrp_status`, `batch_id`, `manufacture_id`, `assign_to_user_id`, `print_method`, `print_size`, `price` (base), thiết kế theo vị trí, `package_completed`, `is_priority`, `note`, lỗi báo qua `reportMrpError`, QC note.

### 3.4 Batch (lô sản xuất), Package (kiện), Shipment
- **Batch** (`mrpBatchProducts`): `increment_id` dạng `BA-2609-227`, `name` ("7-9 thai nguyen"), `barcode`, `status` Producting|On Hold|Cancelled|Completed|Ready|Error|Reproduction, `assign_to_user`, `product_type`; tiến độ đếm theo 4 công đoạn cắt/in/may/đóng (ví dụ lô 76 món: 0/49/76). Tạo bằng `makeMrpBatchProduct(product_ids, params)`; in barcode lô; xuất danh sách.
- **Package** (`mrpProductPackages`): `increment_id`, `order_increment_id`, `productions[]`, `shipping_method`, `weight/width/height/length`, `real_weight`, `shipping_cost`, `real_shipping_cost`, `base_cost`, `surcharge`, `status`, `packaged_at`, `pickup_at`, `delivered_at`, `confirmed`, `print_time`, `logistics{status, delivery, detail}`. Counter phân theo hãng: MULSTRAN, ONOSEXPRESS, NETSHIP, HPW, SHOPEE, GHTK, COD, NONSHIP và theo trạng thái tracking.
- **Shipment** (`shipmentOrders`/`shipmentEvents`): trạng thái Processing → Picked Up → Processed → In Transit → Out For Delivery → Delivery Attempt → Delivered | Failed | Exception | Other. `maskAsDelivered` chốt tay.

### 3.5 Logistics (tài khoản vận chuyển của seller)
Mỗi seller có thể có nhiều: `provider` SBTT (Ship By TikTok — seller tự cấp label TikTok), ONOSEXPRESS (dịch vụ gom của Onos), SHIPEXPRESS/"Express US" (label USPS qua đối tác, file label ở `cdn.onosexpress.com`), GHTK (nội địa). Cờ `is_international`, `is_global`, `is_replacement`, `is_test`, `is_freeship`, địa chỉ hoàn (`return_*`), `addition_price`, `origin_country`, `config{user,password,token,api_url}`. 125 tài khoản, 62 đang kết nối.

### 3.6 Tiền
- **Transaction (ví seller)**: `type` payment | import_tax | active | topup | refund, `status` Paid|Pending|Error|Cancelled, `payment_method` (topup qua **PingPong**), `referent` (đơn), `balance`, `invoice_id`.
- **ProductionTransaction**: `type` payment, "Payment production <mã item>", số tiền = **base cost** của item, sinh **lúc thanh toán đơn** (cùng phút với giao dịch Payment của seller), KHÔNG phải lúc kiện quét xong. *(sửa 01/10/2026, kiểm trên màn hình — xem `documents/Plans/LegacyClone-Money.md` §1)*
- **Invoice** (seller, **kỳ theo tuần: 01–07, 08–14, 15–21, 22–cuối tháng** *(sửa 01/10/2026, kiểm trên màn hình — xem `documents/Plans/LegacyClone-Money.md` §1)*): `amount`, `total_product_cost`, `total_estimate_ship_cost`, `total_actual_ship_cost` (kèm nút "Retry fetch ship cost" — phí ship thật lấy về sau), file xlsx trên CDN, trạng thái Pending|Paid|Cancelled. Có cả **Production Invoice** riêng — tính theo **seller**, KHÔNG theo xưởng (Σ base cost của seller trong kỳ); gần như không được chốt: 12/5.829 hoá đơn Paid. *(sửa 01/10/2026, kiểm trên màn hình — xem `documents/Plans/LegacyClone-Money.md` §1)*
- **Affiliate**: nhóm giới thiệu, hoa hồng `profit_per_unit` theo phương thức COD / ONOSEXPRESS / SBTT (mặc định 0,3 $/đơn vị).

### 3.7 Product preset (sản phẩm) và biến thể
Cấp sản phẩm: `sku` (ONOS-GTS500DTF), `identity` (OY-75084), `provider` Private|Grabink|Gearment…, `collection` (3D/2D/Embroidery/Handmade Wood…), `print_method` (DTF/…), `manufacture_id` (xưởng mặc định), `category`, `type` Custom, `fix_profit`, `min_price/max_price`, `side_additional_cost` (3 $), `position_additional_cost` (2 $), `shipping_additional_cost`, `print_areas[]` (mỗi vị trí có `addition_price`/`addition_base_price`/`is_required`/`is_embroidery`), `tax_groups` (US: Duty 25% + US Import Tax 16–20% theo SKU), `visible`, `skip_design_check`, `skip_affiliate`, `unit_discounts`, `monopolist_users` (giới hạn seller), `linked_products`, size chart, print template (Drive), `specifics` cho eBay.
Cấp biến thể (`attribute_specifics[]`): `sku`, `base_price` (giá vốn/giá tính cho xưởng — 4,64), `sale_price` (giá niêm yết 14,79), `nonship_price` (5,04), `tiktok_final_price` (5,64), `wholesale_price`, `gb_price` (13,95), `ship_price`, `standard_price`, `fix_profit` (1,8), `weight` (g), `package_*` (cm), `in_stock`, `shipping_methods[]{amount,cost}`.

### 3.8 Danh mục lỗi và barcode thao tác
31 mã lỗi MRP: `1001–1011` cắt (mũ, tay trái/phải, thân trước/sau, bo tay, túi ngực, gấu, khóa), `2001–2011` in (+ `2011` lỗi design), `3001+` may. Trang "Call To Action" in barcode: 3 mã hệ thống `O-N-O-S-01..03` (thao tác chung, suy ra là "bước tiếp theo/hoàn thành/giữ") và barcode lỗi theo vai cutting/printer/sewer — công nhân quét mã lỗi tại trạm, giống `StageErrorCatalog` hệ mới.

## 4. Vòng đời đơn (nắm chắc — từ `orderSteps` của đơn thật)

| # | Bước (`step`) | Ai | Việc gì |
|---|---|---|---|
| 1 | `create_order` | seller (API "Order created via API request" hoặc tay "Order created manual", CSV) | Đơn `Pending`, chưa trừ tiền |
| 2 | `update_order` | seller | Sửa design/địa chỉ/phương thức ship (log từng thay đổi) |
| 3 | `submitted_to_processing` | seller | Gửi xử lý |
| 4 | `save_items` | hệ thống | Lưu mockup + design, tạo production, gán xưởng (`setOrderManufacture`, mặc định theo `manufacture_id` của sản phẩm) |
| 5 | `process_shipment` | hệ thống | **Mua label NGAY LÚC NÀY** (trước sản xuất): "Shipment processed. Tracking number …", label PDF, tracking USPS "PRE TRANSIT" |
| 6 | `process_order` | hệ thống | Trừ ví: `payment` (subtotal + ship) + `import_tax`; `paid_at`, `inproduction_at`; đơn → `In Production`; production → MRP `To Do` |
| 7 | MRP | xưởng | §5 |
| 8 | Kiện quét xong | packager | `package_completed` → production transaction (base cost) → đơn `Fulfilled` |
| 9 | Tracking | cron + Telegram | Hãng quét → `In Transit`… → `Delivered` → đơn `Completed` |

Trạng thái đơn: Pending · Processing · In Production · Fulfilled · Completed · Refunded · Cancelled · Rejected · Trashed. Sau khi vào sản xuất đơn bị **khóa** ("Order had been locked"). Hành động trên chi tiết đơn: chọn phương thức ship (hiện giá từng tài khoản logistics của seller + `presignOrderShippingMethod` báo giá dịch vụ), Request Shipment Order / Cancel Shipment Order, Download/Print Shipping Label, **Request active by USPS +$0.7** (giao dịch `active` — kích hoạt tracking USPS), Request Make Products, Create Print Zip File, Cancel/Reject/Refund, Split Multiple, Clone, Keep in stock, Transform to inventory, Add new transaction (điều chỉnh tiền tay).

Ví dụ tiền thật (đơn PQ-22157-83778, DESI, 1 áo baseball jersey): subtotal 6,10 (sale) · ship 8,77 · thuế 0,45 · **total 15,32** → ví: −14,87 payment, −0,45 import_tax; base 5,50 → production transaction 5,50 lúc thanh toán đơn. Seller này `total_credit` −137.266 $ (nợ, `payment_type` debit) → hóa đơn kỳ.

## 5. Sản xuất — MRP (nắm chắc)

- Màn `Productions` theo xưởng, trạng thái: **To Do → Ready → In Cutting → In Print → In Sewing → Packing** (+ On Hold, Cancelled), mỗi trạng thái có cờ lỗi riêng (`READY_ERROR`, `CUTTING_ERROR`, `PRINT_ERROR`, `SEWING_ERROR`, `PACKAGE_ERROR`) và `PACKAGE_COMPLETED`. Bộ lọc theo loại sản phẩm, merchant group (nhóm seller ưu tiên), Priority Mode, tải file in ("Download Print"), in barcode/QR theo item hoặc theo lô.
- Chuyển bước bằng **quét barcode** `N-<mã>` (`mrpProductNextProcessStep(_id)`), báo lỗi bằng mã lỗi (`reportMrpError(_id, errors[], note)`), gỡ lỗi (`mrpProductRemoveError`), ghi QC note. Timeline item thật: Ready 13:38 (admin, "Moved to batch #BA-2609-227") → In Sewing 16:01 (`printer@email.com`) → Packing 17:16 (`packager@email.com`). Tức xưởng dùng **tài khoản chung theo vai**, không định danh từng công nhân (hệ mới có định danh + thống kê lỗi theo người).
- **Lô**: mỗi ngày xưởng gom item thành lô có tên/ngày, in barcode lô, theo dõi tiến độ 4 công đoạn theo lô (0/49/76). ~2 lô/ngày/xưởng. Dùng cho phiếu cắt/may theo lô và đếm tiến độ. Hệ mới không có khái niệm này.
- Báo cáo sản xuất theo xưởng theo kỳ: số production, tiền base cost, lỗi, xuất CSV có/không giá; "Daily report": số item xử lý theo seller và **packages pickup**, ma trận chuyển trạng thái from→to.
- Xưởng Grabink (đối tác 2D US) và 2D US: 0 hoạt động 30 ngày; Thái Nguyên Decor: 29 item To Do (mới mở 18/08).

## 6. Đóng hàng, kiện, bàn giao (nắm chắc + suy ra)

- Packing = quét kiện (`scanPackageTracking(tracking)` quét mã tracking dán trên label đã in sẵn từ bước 5, hoặc `mrpVerifyShipmentV2(orders[])` xác nhận theo đơn) → `package_completed`, `packaged_at` → đơn Fulfilled + trừ tiền sản xuất + Telegram "Package Completed".
- Kiện có cân nặng khai báo vs `real_weight`, `shipping_cost` ước vs `real_shipping_cost` thật (lấy về sau qua "Retry fetch ship cost" trên hóa đơn) → seller bị tính lại phí ship thật trên hóa đơn kỳ (suy ra từ cột "Total estimate ship cost / Total actual ship cost").
- Bàn giao: `mrpProductPackageUpdateExportTime(ids)` (giờ xuất kho), `exportPickupOrders(account_id)`, `dowloadPackageTracking` — phiếu pickup theo seller/ngày; "Packages pickup" trong daily report. Không thấy khái niệm "lô bàn giao hãng" có trạng thái riêng.
- Màn "Box Packages" theo xưởng hiện **0 bản ghi 30 ngày** — suy ra kiện quản lý ở cấp đơn/seller (`mrpProductPackages(order_increment_id)`), không theo xưởng.
- Label seller tự cấp (Ship By TikTok): `importShippingPackage(orders[{order_increment_id, tracking…}])` nhập tracking hàng loạt; `ship_by_seller` trên đơn.

## 7. Vận chuyển (nắm chắc)

- Phương thức trên đơn mẫu 200 gần nhất: 100% có `shipping_method` = ONOSEXPRESS/SBTT (trường `shipping_lines` rỗng), 174/200 tracking USPS, 194/200 giao Mỹ, 6 giao VN, 175/200 đơn 1 item.
- Label mua lúc xử lý đơn qua đối tác (`cdn.onosexpress.com/express/labels/...`), tracking USPS 92xx…; kích hoạt USPS +0,7 $ tùy chọn.
- Bảng phí ship EXPRESS US (`shippingCost`): theo **cân nặng** (100 g → 4,69 $, 200 g → 5,69, 300 g → 6,99, 450 g → 8,36, 700 g → 11,77, 900 g → 13,55, 1.100 g → 15,78…) × **bậc số lượng** 1–1000 / 1001–2000 / 2001+ (giảm 0,10 $ mỗi bậc). `shipRate(method, weight, dimension)` báo giá theo kích thước.
- Tracking cập nhật bằng cron (`when_tracking_update`, `day_update_tracking`, `active_tracking_day` trên user) + Telegram; shipment `detail[]` lưu lịch sử quét.
- Nội địa VN: GHTK, địa chỉ `national{province, district, ward}`, COD (có trong affiliate và counter kiện).

## 7b. OnosExpress (`ship.onosexpress.com`) — hệ vận chuyển của tập đoàn (khảo sát chỉ đọc 08/09/2026)

Hệ **riêng, còn source, có API công khai**: Next.js + GraphQL `api.onosexpress.com/graphql` (introspection tắt) + REST `https://api-app.onosexpress.com/api/v1` (tài liệu Postman công khai, bản sao đã lưu ở `documents/Architecture/reference/onosexpress-api.postman.json`). Giới thiệu: "super-fast shipping solution for small package delivery by air from Vietnam to the United States".

**Quy mô:** 76.451 shipment tổng (74.072 processed, 2.379 cancelled); 3 tháng: 67,4 k delivered, 4,8 k in transit, 1,7 k label ready. Dòng tiền tổng: Payment −451 k$ (75 k giao dịch), Import Tax −28 k$, Active −22,5 k$ (32 k lần), Overweight −1,7 k$, Cancel +8,5 k$. 85 user (khách): tài khoản `POD_<seller>` do OnosPod tạo (DEBIT MONTHLY, số dư âm lớn: GODFFM −119 k, POD_ZGLOBAL −71 k, POD_DUC06 −51 k, POD_DESI −50 k…) + fulfillment khác dùng trực tiếp (FOLINASFFM, LENFFM, BEEFUL, Printerval, SHIP GEEK) + tài khoản credit nhỏ. Vai: ADMIN, MANAGER, CUSTOMER.

**Luồng vật lý (nắm chắc từ màn Consolidate/Packages/Boxes):** label USPS sinh ngay khi tạo shipment (`Label Ready`, "Shipping Label Created" tại LONG BEACH CA — địa chỉ gửi ảo ở Mỹ) → xưởng dán label → kiện về kho OnosExpress (Packages: `un_received` 1.465 → `received` → `scanned` → `packaged` 2.101 → `delivered`; `ConfirmPackageWeight` cân lại, phụ phí overweight) → đóng **Box** (barcode, 51 box/tháng) → **Consolidate** hằng ngày 13–16 box, 340–440 kg, 750–1.000 kiện, 5–6,5 k$ (chia Ship By TikTok / Express US) → bay **MAWB** HAN → ICN → LAX → bàn giao USPS tại LAX (ước 2 ngày) → lastmile **Vietnam Post Logistics US (VNPL)** — chính là đối tác VNP eGlobal mà hệ mới đã tích hợp → hóa đơn lastmile nhập theo tháng ("Lastmiles Importer": tháng 7/2026 8.953 kiện, 78,1 k$) và đối soát Short Paid/Refund/Claim ở màn Financial.

**Bảng giá (Pricing, có hiệu lực từ 01/05/2026):** EXPRESS US theo bậc gram: 50 g 6,11 · 100 g 6,55 · 150 g 7,21 · 200 g 7,66 · 230 g 8,59 · 250 g 8,77 · 300 g 9,21 · 400 g 11,41 · 500 g 14,35 · 700 g 16,39 · 1.000 g 20,31 · 2.000 g 32,36 · 5.000 g 67,18 · 10.000 g 140,77 $; có cột VIP 1/2/3 (hiện bằng nhau). SBTT (Ship By TikTok, chỉ kích hoạt/gom): 100 g 1,5 · 200 g 3,0 · 300 g 3,6 · 400 g 4,8 · 500 g 6,0 … 1.000 g 12 $. Ước phí live qua `ParcelRate(weight, dims)` (dim weight = W×H×L/… ; ví dụ 214 g thật, dim 105 g → tính 214 g). Phương thức đang active: `EXPRESS_US` (global, label type UGA), `SBTT`, `SBTT_US`; đã xóa: Express GB, Economy US (CN→US), Express US-US.

**Sản phẩm/Materials:** 176 product (SKU + tên + material) và material có `hts_code`, `estimate_tax`, `estimate_customs_fee` theo nước (US, GB) — nguồn của thuế nhập cố định theo SKU mà OnosPod dùng (0,45 $ jersey, 0,41 $ sweatpants…).

**Tài chính:** ví theo user (credit prepaid / debit monthly), giao dịch có `before_balance`/`after_balance`, loại: Payment, ImportTax, Active, Overweight, Surcharge, Cancel, Refund, Topup, Withdraw, Transfer; hóa đơn tháng cho debit (ví dụ POD_KSTUDIO 08/2026: payment 429,87 + tax 28,13 − cancel 9,04); nạp qua Payoneer/PingPong/LianLian/bank; `AcceptTopUp`/`AcceptWithdraw`/`MarkAsPaidDebit`/`ChargeCustomers`.

**API REST cho đối tác (đủ để hệ mới tự mua label):**
| Method | Endpoint | Ghi chú |
|---|---|---|
| POST | `/api/v1/login` (form email/password) | trả `access_token` Bearer + `refresh_token` + `expired_at`; token cũng lấy ở Account Settings → Tokens |
| GET | `/api/v1/products/?page_size&page` · `/api/v1/products/materials` | product_id `IT-…`, sku, weight/dims; material sku `ONOS####`, `estimate_tax`, `estimate_customs_fee` |
| POST | `/api/v1/order/create` | body: `order_id` (+`identifier` = cặp khóa duy nhất), `shipping_info{full_name,address_1,address_2,company,city,state,postcode,country,email,phone}`, `shipping_method` `EXPRESS_US`\|`SBTT`, `items[{name,product_id,sku,quantity,price(basecost),currency:"USD"}]`, `custom_width/height/length` (cm), `custom_weight` (g), `package_type` parcel\|box, tùy chọn `tracking_active_day` 0–5 (không dùng cùng `tracking`), `tracking{tracking_number,carrier,link_print}` (label seller cấp, bắt buộc khi box), `active_only` (SBTT chỉ kích hoạt) |
| GET | `/api/v1/order/{id}` | trạng thái (`Ready To Print`…), `tracking{tracking,carrier,url,service,shipping_label.url}`, `declared_value`, `total`, `refunds[]`, `shipping_valid` |
| DELETE | `/api/v1/order/{id}` | hủy |
| GET | `/api/v1/order/{id}/shipment/events` | lịch sử tracking |
| Webhook | Developer → Webhooks | tối đa 3 endpoint/tài khoản, POST có chữ ký khi tracking đổi, có lịch sử giao (hiện admin chưa cấu hình endpoint nào) |

GraphQL nội bộ (133 mutation, 80+ query, tên rõ nghĩa: `CreateOrder`, `RequestShipment`, `BulkRequestShipment`, `CancelShipment`, `ParcelRate`, `ConfirmPackageWeight`, `ScanPackage`, `ScanBox`, `PackBox`, `SaveConsolidation`, `ImportLastmile`, `ImportTrackings`, `ChargeCustomers`, `SaveInvoice`, `SwitchUser`, `createWebhook`…) — liệt kê từ JS build, dùng để hiểu nghiệp vụ, không cần gọi.

**Liên kết với OnosPod:** mỗi tài khoản logistics của seller trong OnosPod (`logistics.config{user,password,token,api_url}` với `api_url = https://ship.onosexpress.com`) là một tài khoản `POD_<seller>` bên OnosExpress; OnosPod đăng nhập bằng tài khoản đó rồi gọi `order/create` với `identifier = "OnosPOD"`, `order_id` = mã đơn OnosPod, giá item = base cost; shipment hiện `API` + mã đơn + tên xưởng ("Desi-10 | TH | Tùng") + Merchant Cost. Tracking về OnosPod qua cron gọi `shipment/events`.

## 8. Tiền — luồng đầy đủ và CÔNG THỨC GIÁ (suy ngược từ 600 đơn thật, 08/09/2026)

Kiểm trên 600 đơn Fulfilled/In Production/Completed mới nhất (`p2/price-rows.json` trong scratchpad khảo sát):

| Quy tắc | Khớp | Ghi chú |
|---|---|---|
| `subtotal = Σ sale × qty` | 600/600 | `sale` = `print.meta_data.Sale_cost` từng item |
| `total = subtotal + shipping_price + total_tax − discount_total` | 552/600 | 48 lệch đều là seller DUCVIET (VIP4, SBTT): total thấp hơn 0,70 $ không ghi vào trường discount — cần hỏi |
| `total_weight = Σ weight × qty` | 600/600 | `weight` khai báo trên biến thể (không phải `actual_weight`) |
| **Sale = base + markup theo seller** | — | VIP0/partner: +0,50 hoặc +0,60 $/item cố định (DESI, TIKTOKSHOPUS, ZENFFM, BF, SENP, THGPARTNER, MERCHFOXTEAM…); một số dòng +0,00 (TIENHC, sku `R-*`, `PAOPPOLO` — suy ra giá nonship/wholesale); VIP3/VIP4: +4,7…+10,9 $ tùy sản phẩm (= giá bán lẻ `sale_price` của biến thể trừ chiết khấu VIP) |
| **Thuế nhập = `estimate_tax` cố định theo SKU vật liệu × qty** | ~95% | 0,45 / 0,42 / 0,41 / 0,34 / 0,33 $ — đúng bằng cột "Import US Tax" của Materials bên OnosExpress; = 0 với COD và với ~1/3 đơn ONOSEXPRESS/SBTT (seller tính thuế ở hóa đơn?) |
| **Ship ONOSEXPRESS = bảng giá EXPRESS US của OnosExpress theo bậc cân nặng** | 43/61 đơn có ship>0 | ví dụ 234 g → bậc 250 g = 8,77 $; 222 g → 8,59 $; lệch còn lại ≤ 0,24 $ (253 g → 8,97 thay vì 9,21) — OnosPod gọi `shipRate` (live `ParcelRate` bên OnosExpress, có tính dim weight) |
| **Ship SBTT = bậc SBTT của OnosExpress + 0,70 $ kích hoạt USPS** | 19/19 | 155 g → 3,0 + 0,7 = 3,7; 291 g → 3,6 + 0,7 = 4,3 (vài đơn cũ +0,5) |
| `shipping_price = 0` | 42% đơn ONOSEXPRESS, 98% EXPRESS_US, 100% SHIPEXPRESS/COD/SBTT-thường | Seller **debit** (ship_by_onos) không trả ship lúc đặt — phí ship THẬT được tính vào hóa đơn kỳ (cột "Total actual ship cost", nút "Retry fetch ship cost") |
| `discount_vip_total` | 91/600 | VIP4: 0,90 $/đơn 1 item (~7% subtotal) |
| Phương thức | COD 243 · SBTT 174 · ONOSEXPRESS 103 · EXPRESS_US 64 · SHIPEXPRESS 15 | **COD** = seller tự lo vận chuyển hoàn toàn (ship 0, thuế 0, cả US lẫn VN — TIKTOKSHOPUS, ZENFFM, BF); **SBTT** = label TikTok seller cấp, Onos chỉ kích hoạt/quét; **ONOSEXPRESS/EXPRESS_US/SHIPEXPRESS** = Onos mua label USPS qua OnosExpress |

Luồng tiền đầy đủ:
1. Seller nạp tiền (`topup`, PingPong/Payoneer/LianLian/bank hoặc admin nạp tay có mã giao dịch ngoài + ảnh) hoặc dùng **debit** với `debit_limit` (số dư âm, thanh toán theo hóa đơn kỳ; TIENHC −896 k$, DESI −137 k$).
2. Lúc xử lý đơn: trừ `payment` = subtotal + ship (nếu prepaid) ; trừ `import_tax` theo SKU; `active` +0,70 $ khi kích hoạt USPS.
3. Lúc thanh toán đơn (cùng lúc bước 2, KHÔNG phải lúc kiện quét xong): `productionTransaction` = **base cost** (5,50 $ ví dụ) — ghi nhận chi phí sản xuất (gom theo seller vào Production Invoice — không theo xưởng).
4. Kỳ theo tuần (01–07, 08–14, 15–21, 22–cuối tháng): Invoice seller = giao dịch + phí ship thật lấy về từ OnosExpress; Pending → Paid/Cancelled; file xlsx.
5. OnosPod đồng thời là **khách hàng của OnosExpress** (§7b): mỗi seller có tài khoản `POD_<seller>` bên OnosExpress (debit monthly, `is_pod_customer`), OnosExpress trừ tài khoản đó phí label + thuế nhập (ví dụ đơn PQ-22157-83778: OnosPod thu seller 8,77 + 0,45; OnosExpress tính POD_DESI 8,59 + 0,45 → chênh 0,18 $ là lãi ship của OnosPod).
6. Hoàn tiền: `refund`, `total_refund`, RAR; Affiliate hoa hồng/đơn vị theo phương thức (COD/ONOSEXPRESS/SBTT, mặc định 0,30 $).

## 9. Sản phẩm và catalog (nắm chắc)

Tab theo collection: 3D · 2D · Grabink · Embroidery · Dropship · Handmade Wood; category/tag/technique (Embroidery, Applique, Sublimation, Laser Cut…)/material; "Hide product for seller", "Enable design check", "Disable affiliate commission"; max production time / max shipping time; mockup preset; print areas & parts với print document/print key; "Calculate Prices" tự tính giá từ base + fix_profit; giới hạn seller (`monopolist_users`). Hệ mới đã kéo catalog này về (`onospod-product-import.service.ts`) và có `productLine`/`printMethod` tương ứng `collection`/`print_method`.

## 10. Tích hợp và đối tác

- Fulfilment partner (làm thay Onos): Grabink (2D US), Gearment ("DUC - Gearment"); cấu hình sẵn cho CustomCat, Merchize, Geargag, Scalable, Printify, Private API. Đơn Grabink đi màn riêng `mrp-provider` (4.265 item all-time, 281 To Do).
- Sàn: `platform` (Temu, TikTok, eBay members email, `podorders.store`), "Ship By TikTok" = seller lấy label từ TikTok Shop; `platform_specifics` cho eBay.
- Telegram bot vận hành (§1), email SMTP (cấu hình có sẵn), extension trình duyệt cho seller.

## 11. Danh mục lệnh API quan trọng (từ mã JS + bắt mạng)

**Đọc:** `orders`, `dashboardOrder`, `orderSteps`, `orderLogistics`, `shipmentOrders`/`shipmentOrderCount`/`shipmentEvents`, `mrpProducts`, `mrpCounterQuery`, `mrpBatchProducts`/`mrpBatchCounter`/`searchBatch`, `mrpProductPackages`/`mrpPackageCounter`, `productionStatictics`, `dailyUserReport`, `dailyProductionReport`, `productionTransactions`, `transactions`, `invoices`, `productionInvoices`, `users`/`usergroups`/`usersNoneGroup`, `productPreset`/`productPresetCount`/`productMockupPresets`, `logistics`, `shippingCost`, `shipRate`, `shippingPreset`, `shippingProducts` (thuế), `manufactures`, `locations`, `fulfilments`, `appConfig`, `callToAction`, `mrpQueryErrorCodes`, `affiliateGroups`, `merchantGroups`, `systemNotifications`, `tokenAccessLogs`, `getProductByQRCode`.

**Ghi (chưa gọi, chỉ liệt kê):** `setOrderManufacture(order_id, …)`, `presignOrderShippingMethod(order_id, shipping_id)`, `makeShippingLabel(order_id)`, `chargeOrder`, `trashOrder(ids)`, `mrpProductNextProcessStep(_id)`, `reportMrpError(_id, errors[], note)`, `mrpProductRemoveError(_id)`, `makeMrpBatchProduct(product_ids, params)`, `updateMrpBatchProduct`, `trashMrpBatchProduct`, `printBarcodeMrpProduct/Batch`, `printQRCode*`, `exportBatchProducts`, `scanPackageTracking(tracking)`, `mrpVerifyShipment(V2)(orders[])`, `importShippingPackage(orders[])`, `mrpPackageSplit(_id)`, `mrpProductPackageUpdateExportTime(ids)`, `trashMrpProductPackage`, `maskAsDelivered(_id)`, `exportPickupOrders(account_id)`, `dowloadPackageTracking`, `requestProductionHistory(auth_id)`, `switchUser`, `saveMerchantGroup`, `toggleDesignProduction`, `logisticAuthorize`, `trashLogistic`, `sendRemindTelegram`, `notificationMake`, `saveProductLabel`, `applyOrderProductTags`. Tổng ~230 tên lệnh; danh sách đầy đủ trong scratchpad khảo sát (không commit).

## 11b. API công khai cho seller/đối tác (`api-app.onospod.com/api/v1`) — hợp đồng cần tương thích

Tài liệu Postman công khai "ONOS PUBLIC API" (bản sao sạch: `documents/Architecture/reference/onospod-seller-api.postman.json`). Seller/integration đang dùng hợp đồng này; hệ mới muốn nhận seller API mà không bắt họ sửa code thì Public Order API (ORD-4) nên nhận thêm **đúng hình dạng này** (adapter), ít nhất `order/create`, `order/{id}`, `shipment/events`, webhook `order.updated`.

| Method | Endpoint | Ghi chú |
|---|---|---|
| POST | `/login` `{email,password}` | Bearer token |
| GET | `/products`, `/products/{id}` | id `NZ-98233`, sku, attributes (Size/Color), `attribute_specifics[]{sku, price…}`, `print_areas`, size_chart, `tax_fee` |
| POST | `/order/create` (và `/order/create/test`) | Khóa duy nhất = (`order_id`, `identifier`); `referent_id`, `reference_id`, `order_name`, `customer_note`, `note`; `items[]{attributes[{name,option}] tối thiểu Size+Color, sku Onos, product_id của khách, name, image (mockup), price, quantity, currency, design_front/back/sleeve/hood/chest_left/chest_right… HOẶC print_areas[{key,value}] (không được trộn 2 kiểu; key phải có trong print_areas của sản phẩm)}`; `shipping_info{full_name,address_1,address_2,city,state,postcode,country,email,phone}`; `shipping_method` **ONOSEXPRESS** (mặc định, line ship Onos) \| **SBTT** (Ship by TikTok do Onos hỗ trợ, cần `tracking{tracking_number,carrier,link_print}` = label seller cấp, Onos dán và ship) \| **COD** (sản xuất xong TRẢ VỀ merchant); `inc_active_service` (kích hoạt tracking USPS, từ 29/04/2025 áp cả SBTT). Lỗi trả `status:false` + `error` (tải link_print thất bại, print_areas sai key…) |
| GET | `/order/{id}` · `/order?from&to&page&page_size` | chi tiết/danh sách |
| DELETE | `/order/{id}` | hủy |
| POST | `/order/tracking-list` `{tracking:[…]}` | tra đơn theo mã vận đơn |
| GET | `/order/{id}/shipment/events` | lịch sử tracking |
| GET/POST/DELETE | `/webhooks/` | topic `order.updated` \| `shipment.events`, `endpoint`, `secret` → header `X-Onos-Hmac-SHA256` |

Payload webhook `order.updated` (thật, 03/2026): `id` (mã fulfillment), `order_id` (merchant), `identifier`, `status` Fulfilled, `fulfillment_cost`/`base`/`base_total`/`base_ship_total`/`total`/`base_cost`/`ship_cost`, `items[]{name, product_id, sku, quantity, price, tax, design_*, attributes, fulfilment_attributes}`, `tracking{tracking, carrier, url, shipping_label}`, `production_at`, `shipping{}`, `refunds[]`, `shipping_valid`, `shipping_method`, `active_tracking_day`, `created_at`/`updated_at`/`imported_at`/`paid_at`, `shipment_id` (mã bên OnosExpress `03-26-10069863`). Hệ mới hiện phát `order.pushed/production_completed/held/unheld/cancelled` với `X-Onos-Signature` — tên topic và chữ ký khác, cần lớp tương thích.

## 12. Đối chiếu với hệ mới OnosFactory

| Khâu | Hệ cũ | Hệ mới | Khoảng trống |
|---|---|---|---|
| Lên đơn seller (form/CSV/API), tài khoản, API key, webhook | Có (§1b, §11b) | Có (Seller Portal + Public Order API) | **Hợp đồng API khác nhau** (§11b: `order/create` theo attributes/print_areas, `shipping_method` ONOSEXPRESS/SBTT/COD, webhook `order.updated` ký `X-Onos-Hmac-SHA256`) → cần adapter tương thích; thiếu Push To Production kiểm số dư, Insights/SLA seller, OEM, Billing seller, Support/Tickets, Integrations store, nhập tracking hàng loạt qua UI, Split/Clone/Keep in stock, RAR |
| Catalog, biến thể, giá | 8 loại giá + phụ phí vị trí/mặt in + thuế theo SKU + VIP/partner/unit discount | `cost`/`nonShipCost`/`retailPrice` + Promotion theo tier | **Thiếu công thức giá đầy đủ, thuế nhập, phụ phí vị trí in, giảm giá số lượng** |
| Ví, trừ tiền, nợ, hóa đơn kỳ, topup, hoàn tiền, đối soát xưởng | Có, là sổ cái | Chỉ có ledger `customer_payments` ghi `waived` | **Thiếu toàn bộ** — điểm chặn lớn nhất |
| Gán xưởng | Theo sản phẩm (`manufacture_id`) + tay | Product Config + khách→xưởng | Có |
| Sản xuất | 6 trạng thái MRP, tài khoản chung theo vai, mã lỗi 31, QC note, priority, merchant group | Soát tool → designer → 6 công đoạn, định danh người, thống kê lỗi theo người, luồng rút gọn theo xưởng | Hệ mới **mạnh hơn**; thiếu **lô sản xuất theo ngày** và "Download Print"/phiếu in theo lô |
| Label | Mua lúc xử lý đơn (trước SX) qua **OnosExpress** (REST API công khai §7b), USPS, +0,7 kích hoạt | VNP eGlobal (chính là lastmile của OnosExpress), mua tay từ menu Admin | Hệ mới có thể gọi thẳng OnosExpress `order/create` bằng tài khoản `POD_*` hiện có → giữ nguyên chuỗi HAN→LAX→VNPL; **thiếu tự động hóa + thời điểm mua + báo giá + bảng giá theo bậc** |
| Đóng kiện | Quét tracking → kiện xong → Fulfilled (tiền SX đã ghi từ lúc thanh toán đơn) | Công đoạn Đóng hàng, chưa gắn label/kiện/tiền | **Thiếu hook label lúc đóng** (tiền SX thuộc bước thanh toán đơn) |
| Bàn giao hãng | Giờ xuất kho + phiếu pickup theo seller | Chưa có | Thiếu lô bàn giao |
| Tracking | Cron + Telegram + trạng thái shipment 11 mức | Cron VNP 2 lần/ngày, trạng thái 3 mức | Thiếu đổ về seller + webhook `order.shipped` |
| Báo cáo | Daily report, production report theo xưởng có tiền, dashboard | Dashboard, CEO dashboard, Operations hub | Thiếu báo cáo tiền theo xưởng/seller |
| Đối tác fulfil ngoài (Grabink, Gearment) | Có | Không | Cần quyết định có giữ không (30 ngày qua 0 hoạt động) |
| Affiliate | Có | Không | Cần quyết định |
| Thông báo Telegram vận hành | Có | Có (báo cáo SLA, Zalo) | Bổ sung action package/error nếu cần |

## 13. Gợi ý thứ tự chuyển đổi (từ dữ liệu trên)

1. **Cầu tạm chống làm hai lần:** hệ mới quét xong công đoạn → gọi `mrpProductNextProcessStep`/`scanPackageTracking` bên cũ (cần thử trên đơn test `is_test`). Xưởng chỉ quét ở hệ mới, tiền vẫn chốt bên cũ.
2. **Ví + tính tiền** ở hệ mới (trừ lúc đẩy đơn, ghi base cost lúc thanh toán đơn, thuế nhập theo SKU, hóa đơn kỳ, topup, debit limit, hoàn tiền), chạy song song đối chiếu ≥ 1 kỳ hóa đơn với số hệ cũ (§8).
3. **Label + kiện + bàn giao** ở hệ mới (VNP), chọn mô hình mua label (trước sản xuất như cũ, hay lúc đóng).
4. **Lô sản xuất theo ngày** nếu xưởng xác nhận cần phiếu theo lô.
5. Cắt theo dòng sản phẩm: gỡ sản phẩm khỏi catalog cũ (`visible=false`/"Hide product for seller"), seller sang portal mới, tắt tài khoản logistics cũ.

## 13b. Chính sách vận hành đã công bố cho seller (từ 175 thông báo hệ thống, lưu ở `reference/onospod-system-notifications.md`)

- **Thời gian sản xuất chuẩn 2–3 ngày làm việc**, mùa cao điểm 3–4 ngày (5% tới 5 ngày); SLA report cho seller đo Produced in 2/3/>3 days và Delivered in 5 days.
- **Từ 17/06/2026 sản xuất thẳng theo file seller gửi**, không đối chiếu design với mockup; seller chịu trách nhiệm template/kích thước (tương ứng cờ `skip_design_check` / "Enable design check" theo sản phẩm).
- **Giá**: bảng giá sản phẩm điều chỉnh nhiều đợt (31/03, 21/04, 30/04, 27/05/2026); ưu đãi hạng thành viên −0,50 $ cho nhóm bikini/hawaiian/pajama từ 14/05; phụ phí USPS tạm thời +0,2 $ (mã WT/YT/UT) và +0,6 $ (HG-18500, SW-18000) từ 26/04/2026 đến 17/01/2027; bảng giá ship mới hiệu lực 01/05/2026 (khớp Pricing OnosExpress "2026-05-01").
- **Thuế nhập Mỹ**: cập nhật theo CBP (Section 122 → Section 301 từ 24/07/2026, áp từ 01/08/2026); thuế cố định theo SKU (§8).
- **Ship By TikTok / scan label**: seller phải đặt địa chỉ warehouse TikTok tại CYPRESS, TX 77429 (từ 21/05/2026; trước đó CA), lịch scan thứ 2–7 (nghỉ thứ 6 và CN theo thông báo); sự cố miss-scan, delay chuyến bay HAN→US, hải quan giữ lô (01/08/2026) đều thông báo qua kênh này.
- **Lịch nghỉ**: lễ VN (30/4–1/5, 2/9) xưởng + vận chuyển VN nghỉ; lễ US (Memorial, Juneteenth, Independence, Labor Day) USPS nghỉ scan/giao.
- **SKU/template**: mở SKU mới và đổi template liên tục (2–4 lần/tháng), size chart trên trang sản phẩm của cổng seller; sản phẩm tạm đóng khi thiếu vải.

## 14. Chưa rõ — cần người vận hành xác nhận

1. Đã suy được phần lớn công thức (§8). Còn hỏi: markup +0,5/+0,6 $ gán theo trường nào của seller (`sale_plan`? `partner_vip`?); VIP3/4 lấy `sale_price` trừ bao nhiêu %; khoản −0,70 $ trên đơn DUCVIET không ghi vào discount; phụ phí vị trí in/mặt in (`side_additional_cost` 3 $, `position_additional_cost` 2 $) áp khi nào (mẫu 600 đơn chỉ 2 đơn in nhiều mặt, markup 4,11 $).
2. Production Invoice là hóa đơn trả cho xưởng hay hóa đơn sản xuất cho seller debit? Kỳ và ai duyệt.
3. Ai quyết định phương thức ship khi đơn có nhiều tài khoản logistics (COD/SBTT/ONOSEXPRESS). ONOSEXPRESS đã rõ: gom bay HAN→ICN→LAX, bàn giao USPS, lastmile VNPL (§7b).
4. Lô sản xuất: xưởng dùng để in phiếu cắt/may hay chỉ để đếm tiến độ? Có in "Download Print" theo lô không?
5. Barcode `O-N-O-S-01..03` là thao tác gì.
6. Grabink/2D US/Gearment còn dùng không (0 hoạt động 30 ngày).
7. RAR, Affiliate, Merchant group có cần mang sang hệ mới không.
8. Quy tắc Completed (giao xong sau bao ngày), quy tắc hoàn tiền/hủy sau khi đã mua label.

## 15. Cách kiểm lại và lưu ý bảo mật

- Tài khoản OnosExpress admin dùng khảo sát 08/09/2026 cũng phải đổi mật khẩu; JWT OnosExpress không chứa mật khẩu nhưng token sống dài.
- Script khảo sát (Playwright + fetch GraphQL, chỉ đọc) nằm ở scratchpad phiên làm việc 07–08/09/2026, **không commit** vì chứa token phiên. Muốn chạy lại: đăng nhập admin, bắt header `authorization` + `x-onos-super-token` từ tab Network, gọi các query ở §11 với `Origin: https://app.onospod.com`.
- JWT của hệ cũ **chứa mật khẩu dạng rõ** → sau khảo sát phải **đổi mật khẩu** tài khoản đã dùng; không dán token/mật khẩu vào chat, ticket, hay repo.
- Token super admin đang nằm trong `apps/api/.env.production` (`ONOSPOD_API_*`) để hệ mới đọc; giữ nguyên phạm vi chỉ đọc cho tới khi làm cầu tạm ở §13.1.
