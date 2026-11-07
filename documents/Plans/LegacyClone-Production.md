# Clone hệ cũ — Sản xuất theo xưởng (bảng khoảng trống §5, bước 1: CHƯA code)

> Vùng `a4`: mỗi xưởng có 4 màn (Productions · Batch Items · Box Packages · Production Report) + Return & Replacement.
> Lập 04/10/2026 **chỉ từ tài liệu và code**. Phiên này KHÔNG đăng nhập `app.onospod.com` (chưa được chủ dự án xác nhận trong phiên; theo dặn của `onos-2d`, không đi vòng, không nhờ agent khác đăng nhập hộ).
> Hệ cũ có 5 xưởng: Mê Linh · Thái Nguyên · Grabink · 2D US · Thái Nguyên Decor (số liệu 30 ngày: ML 9.529 item, TN 11.122, Decor 29, Grabink 0, 2D US 0).

## 0. Cách đọc độ tin cậy

Mỗi dòng ghi nguồn bằng nhãn:

- **[MẮT]** = có người nhìn màn hình thật và ghi lại (chỉ `onos-49` ngày 01/10, chỉ cấu trúc, không có dữ liệu đơn).
- **[DOC]** = suy từ `OnosPodLegacy-BusinessFlows.md` (khảo sát qua tên lệnh GraphQL + DOM, không phải ảnh màn hình).
- **[CODE]** = đọc trong repo hệ mới.
- **[CHƯA XÁC NHẬN]** = không có nguồn nào; đừng coi là sự thật.

Ảnh chụp màn hình hệ cũ: **không có** (chưa mở được). Cột "bộ lọc mặc định" đúng với link menu ở `MenuRestructure-CEO.md §8.1` [MẮT].

Công sức: S ≤ 0,5 ngày · M 1–2 ngày · L 3–5 ngày · XL > 1 tuần (một agent, gồm test + doc).

## 1. Link menu và bộ lọc mặc định (mỗi xưởng, 4 link giống nhau)

| Link | Query mặc định hệ cũ | Nguồn |
|---|---|---|
| Productions | `/manufactures/<id>/mrp?mrp_status=To Do&source=all` | MẮT (menu) |
| Batch Items | `/manufactures/<id>/mrp_batch?status=Producting` | MẮT |
| Box Packages | `/manufactures/<id>/mrp_package?status=Processing` | MẮT |
| Production Report | `/manufactures/<id>/report?tab=last7day` | MẮT |
| Return & Replacement | `/rar/all?status=Processing&source=All` | MẮT (do `onos-80` giao) |

Hệ mới hiện tại: một trang đơn dùng chung `/ffm/orders/workshop` + bộ chọn xưởng ở header (`?factoryId=`, Orders.md §25) [CODE]. Luật cần giữ: **mỗi link mở view hữu ích nhất, không phải danh sách thô**.

## 2. Productions — `/manufactures/<id>/mrp`

Cột [MẮT, onos-49]: `# · ITEM PHOTOS · ITEM INFO · Price · STATUS · BARCODE · BATCH ID · NOTE · ACTION`. Lọc [MẮT]: group name · product type · production ID · rows per page.
Từ tài liệu [DOC]: lọc Priority Mode, tải file in ("Download Print"), in barcode/QR theo item hoặc theo lô; 6 trạng thái To Do → Ready → In Cutting → In Print → In Sewing → Packing + On Hold/Cancelled + cờ lỗi `READY_ERROR/CUTTING_ERROR/PRINT_ERROR/SEWING_ERROR/PACKAGE_ERROR` + `PACKAGE_COMPLETED`.

| Thành phần hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|
| Danh sách item theo xưởng, 1 item = 1 production | `OrderEntity` = 1 item; bảng `/ffm/orders/workshop` có phễu 8 chặng, 5 pill, rail loại SP, lọc xưởng [CODE, Orders.md §10.2c] | GIỮ HỆ MỚI | Không làm bảng mới | — |
| Tab/chip trạng thái To Do/Ready/In Cutting/In Print/In Sewing/Packing có số | Phễu chặng Soát tool→Thiết kế→In→Ép→QC→May vào→May ra→Đóng hàng (`stageCounts`) [CODE]. **Không 1-1** với MRP: hệ mới không có chặng Cắt; có Soát tool + Thiết kế phía trước; xưởng `flowType` tự Done vài chặng (§FulfillmentWorkflow 2.2b) | GIỮ HỆ MỚI + BỔ SUNG nhãn | Thêm bảng ánh xạ nhãn cũ↔mới để người quen hệ cũ đọc được (Ready≈sẵn sàng vào In; In Print≈In/Ép; In Sewing≈May vào/ra; Packing≈Đóng hàng). Chưa biết To Do vs Ready khác nhau ở xưởng [CHƯA XÁC NHẬN] | S |
| Link mặc định `mrp_status=To Do` | Link sidebar xưởng mang `?factoryId=` nhưng chưa mặc định "việc cần làm" | BỔ SUNG | Link "Productions" của xưởng mở `workshop?factoryId=<id>&workshopStage=<chặng chờ>`; chốt "To Do" nghĩa là chặng nào (đề xuất: đơn đã sẵn sàng vào In, chưa bắt đầu) | S |
| Cột ITEM PHOTOS / ITEM INFO / Price | Cột mockup+Type+Size, designs, mã đơn [CODE]. **Price (base cost) KHÔNG có ở bảng xưởng**; giá vốn đã có ở variation/`baseCost` đơn nhưng bảng workshop không hiện | BỔ SUNG (có điều kiện) | Hiện cột Price chỉ cho role được xem tiền (Admin/Manager), KHÔNG cho công nhân. Phụ thuộc vùng Tiền | S |
| Cột STATUS có cờ lỗi theo chặng | `orderStatus` + `productionError` + badge lỗi theo chặng [CODE] | GIỮ HỆ MỚI | — | — |
| Cột BARCODE (`N-<mã>`, in được) | Tem barcode `N-<productionId>` 60×40 + 75×50 [CODE, `BarcodeLabelPrint`] | GIỮ HỆ MỚI | — | — |
| Cột **BATCH ID** + lọc theo lô | Không có khái niệm lô [CODE: `batchId` = 0 chỗ dùng trong `apps/api`] | XÂY MỚI (mức nhẹ) | Xem §3 — thêm `OrderEntity.batchId` + cột + bộ lọc `batchId` trên bảng workshop | M (phần cột/lọc) |
| Cột NOTE | Có note lỗi/QC note rời rạc (`productionErrorNote`, `assigneeNote`…) [CODE]; QC note chung theo item [CHƯA XÁC NHẬN có ở hệ cũ] | GIỮ HỆ MỚI | Hỏi xưởng có dùng NOTE tự do không | — |
| Cột ACTION (chuyển bước, báo lỗi, in) | Quét `N-`/`OK`/`E-`/`ACT-*`, kanban Fulfillment, menu "..." hàng đơn [CODE] | GIỮ HỆ MỚI | — | — |
| Lọc group name (merchant group) | Không có "nhóm seller ưu tiên"; có ưu tiên đơn theo khách (`customer_priority_config`) và tier VIP [CODE] | BỔ SUNG nhỏ (chờ xác nhận) | Hỏi xưởng "group name" dùng để làm gì. Nếu chỉ là nhóm seller → lọc theo khách + tier có sẵn | S–M |
| Lọc product type / production ID / rows per page | Rail loại SP, ô tìm, "Nhiều mã", select số dòng [CODE] | GIỮ HỆ MỚI | — | — |
| Priority Mode | `priority` 1..3 + sort `priority:-1` [CODE, Orders.md §17] | GIỮ HỆ MỚI | — | — |
| "Download Print" (tải file in) | `cuttingFileUrl`/`cuttingFileName` + import file cutting từ Drive; nút xuất file in theo lô chưa có [CODE] | BỔ SUNG, phụ thuộc câu §3 | Chỉ làm nếu xưởng xác nhận tải theo lô (xem §3, nhánh 4B) | L (phụ thuộc mẫu) |
| `source=all` (lọc nguồn: Private vs Grabink) | Không có đối tác fulfil ngoài [CODE] | KHÔNG CẦN (chờ xác nhận) | Grabink/2D US = 0 hoạt động 30 ngày [DOC]. Hỏi anh Tuấn có bỏ | — |

## 3. Batch Items — `/manufactures/<id>/mrp_batch`

[MẮT, onos-49 01/10, Thái Nguyên, `status=Producting`]: cột `Name · Batch ID · Status · Note · Action`; lọc ô Batch ID, perpage 10|20|50|100, select tháng, nút ngày All Time/Today/Yesterday/Last 7 Days; **42 lô đang Producting cùng lúc ở một xưởng**; mã dạng `BV-2610-676`; tên do người đặt ("1-10 thai nguyen"); "Delay N hours" = tuổi lô (khớp từng giờ trên 3 lô); 4 nút icon trên dòng nhận ra bằng đường vẽ SVG: **printer, trending-up, edit, trash-2**; 2 link trên dòng trỏ `.../mrp?batch_id=<mã>&source=all` (một có `mrp_status=All`) → **chức năng chính của lô là lọc Productions theo lô**.
[DOC]: 7 trạng thái Producting | On Hold | Cancelled | Completed | Ready | Error | Reproduction; tiến độ theo 4 công đoạn cắt/in/may/đóng; tạo bằng `makeMrpBatchProduct(product_ids, params)` (chọn item rồi gom); `printBarcodeMrpBatch`, `exportBatchProducts`, `updateMrpBatchProduct`, `trashMrpBatchProduct`.

| Thành phần hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|
| Thực thể lô + danh sách lô theo xưởng | Không có [CODE] | XÂY MỚI (mức nhẹ, đề xuất mặc định) | `production_batches` + `OrderEntity.batchId` + tab "Lô" ở trang xưởng. Chi tiết `ProductionBatch-Proposal.md §3`. Không đụng `resolveTransition`/`flowType` | L (BE ~2–3 ngày + FE ~2–3 ngày) |
| Cột Name / Batch ID / Status / Note + "Created At" + "Delay" | — | (thuộc dòng trên) | Tuổi lô suy ra từ `createdAt` (đã xác nhận Delay = tuổi, KHÔNG phải hạn) | (gộp) |
| Lọc Batch ID, perpage, select tháng, nút ngày All Time/Today/Yesterday/Last 7 Days | `DateRangeFilter` + `SearchInput` + select số dòng có sẵn [CODE, theo `LegacyClone-Orders.md`] | GIỮ HỆ MỚI | Thêm preset "All Time" nếu chưa có | S |
| Lọc mặc định `status=Producting` | — | BỔ SUNG | Link "Lô" của xưởng mở `?status=producing` | (gộp) |
| Nút **printer** trên dòng lô | Có tem barcode đơn [CODE]; chưa tem lô | **CHƯA XÁC NHẬN: in ra gì** (tem barcode lô hay phiếu cắt/may) | Mức nhẹ gồm tem barcode lô (tái dùng `BarcodeLabelPrint`). Nếu là phiếu sản xuất → nhánh 4B (~1 tuần, cần mẫu thật) | M hoặc XL |
| Nút **trending-up** | — | **CHƯA XÁC NHẬN** (đoán: tiến độ hoặc đẩy ưu tiên; không đoán) | Hỏi xưởng | — |
| Nút edit / trash-2 | — | (thuộc dòng thực thể lô) | Sửa tên/note; xoá mềm lô, gỡ `batchId` khỏi đơn | (gộp) |
| Link dòng lô → Productions lọc `batch_id` | Chưa có bộ lọc `batchId` trên `getOrders` | BỔ SUNG | Thêm param `batchId` vào `GET /orders` + facet | S |
| Tiến độ theo 4 công đoạn (cắt/in/may/đóng, vd 0/49/76) | Có dữ liệu từng chặng trong `fulfillmentStages` [CODE] | BỔ SUNG | Suy ra khi đọc, **bỏ chặng nằm trong `FACTORY_FLOW_AUTO_STAGES` của xưởng** (DTF `press-complete`: 4 chặng sau Ép luôn Done tức thì → hiện 100% giả nếu không bỏ). Hệ mới không có "cắt" → nhãn 4 chặng cần chốt | M |
| 7 trạng thái lô | — | BỔ SUNG, suy ra | Chỉ Giữ/Hủy đặt tay; Producting/Completed suy ra; `Ready` chưa biết nghĩa; `Error`/`Reproduction` suy từ có đơn đang làm lại | S |

**Hai câu treo từ đề xuất lô** (để yêu cầu "trả lời bằng ảnh chụp, đừng suy đoán"):

1. Nút in theo lô xuất ra gì: **CHƯA XÁC NHẬN.** Chỉ biết có nút printer. In thử một lô là gọi `printBarcodeMrpBatch` (lệnh ghi/sinh tác vụ trên hệ thật), nên tôi **không** tự làm. Cách an toàn: nhờ người ở xưởng in một lô rồi gửi bản in/ảnh.
2. Một đơn có bị tách giữa hai lô không: **CHƯA XÁC NHẬN.** Mô hình hệ cũ gắn `batch_id` lên **production** (item), không lên đơn [DOC] → tách theo item là CÓ THỂ về cấu trúc (đơn nhiều item có thể vào nhiều lô). Hệ mới `batchId` đặt ở item (`OrderEntity` = item), nên không vướng. Cần xác nhận xưởng có thực tế làm vậy không.

## 4. Box Packages — `/manufactures/<id>/mrp_package`

Không có ai nhìn thấy cột/bộ lọc [CHƯA XÁC NHẬN]. Chỉ có [DOC]: bản ghi `mrpProductPackages(order_increment_id)` = kiện theo đơn/seller (`productions[]`, `shipping_method`, `weight/width/height/length`, `real_weight`, `shipping_cost`, `real_shipping_cost`, `base_cost`, `surcharge`, `status`, `packaged_at`, `pickup_at`, `delivered_at`, `confirmed`, `print_time`, `logistics{status,delivery,detail}`); counter theo hãng (MULSTRAN, ONOSEXPRESS, NETSHIP, HPW, SHOPEE, GHTK, COD, NONSHIP) và theo trạng thái tracking; hành động `scanPackageTracking`, `mrpVerifyShipmentV2`, `importShippingPackage`, `mrpPackageSplit`, `mrpProductPackageUpdateExportTime`, `trashMrpProductPackage`, `exportPickupOrders`, `dowloadPackageTracking`. Màn theo xưởng hiện **0 bản ghi 30 ngày** [DOC] → nhiều khả năng kiện quản lý ở cấp đơn/seller, không theo xưởng. Link mặc định `status=Processing` [MẮT].

| Thành phần hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|
| Kiện hàng (1 kiện/đơn seller, mã, số item, hãng, trạng thái) | `shipping_packages`: 1 kiện/đơn seller, mã phiếu `BG-<xưởng>-<ngày>-<số>`, `GET /shipping-vnp/packages` [CODE, FulfillmentWorkflow.md cuối] | GIỮ HỆ MỚI (khác grain bàn giao) | Kiểm lại 1 kiện = 1 đơn khớp hệ cũ khi 1 đơn nhiều item | S (kiểm) |
| `weight` khai báo vs `real_weight` | Cân tuỳ chọn ở trạm đóng (`PackWeightDialog`), chưa có `real_weight` thứ hai [CODE] | BỔ SUNG nhỏ | Chỉ khi xưởng dùng `real_weight` (cân lại ở kho hãng?) [CHƯA XÁC NHẬN] | S |
| `shipping_cost` ước vs `real_shipping_cost` | Có `shipments.sellerPrice`/`shippingCost` ở vùng VNP [CODE]; đối soát hai số theo kiện chưa có | BỔ SUNG, thuộc vùng Tiền/Vận đơn | Báo `a1`/`tool`; không làm ở vùng này | thuộc vùng khác |
| `base_cost` ghi lúc đóng kiện → production transaction | Chưa có [DOC BusinessFlows §6 "Thiếu hook label + tính tiền lúc đóng"] | XÂY MỚI, thuộc vùng Tiền | Hook ở `fulfillment-task.service.ts` chỗ đóng hàng xong. **Đây là phần quan trọng nhất của vùng Đóng kiện và là ranh giới với `tool`** — cần chốt ai làm | M–L |
| Quét tracking → kiện xong (`scanPackageTracking`) | Quét `N-` ở công đoạn Đóng hàng = hoàn thành; quét tracking chưa là hành động riêng | **CHƯA XÁC NHẬN cách xưởng thật làm** | Hỏi xưởng đóng hàng bằng quét mã đơn hay quét mã vận đơn dán sẵn | S–M |
| Counter theo hãng + theo trạng thái tracking | Cột carrier trong `/adm/shipments` [CODE] | BỔ SUNG nhỏ | Chip đếm theo hãng ở trang kiện | S |
| Bàn giao (`UpdateExportTime`, `exportPickupOrders`) | Trang `/ffm/handover` in phiếu + đóng dấu giờ xuất [CODE] | GIỮ HỆ MỚI | Phiếu pickup theo seller/ngày chưa có (hiện theo xưởng/ngày) | S–M (chờ xác nhận) |
| Split kiện (`mrpPackageSplit`) | Không có | CHƯA XÁC NHẬN dùng thật | Hỏi xưởng; bỏ nếu không | — |
| Tab/link mặc định `status=Processing` | — | BỔ SUNG | Link "Kiện hàng" của xưởng mở kiện chưa bàn giao | S |

## 5. Production Report — `/manufactures/<id>/report?tab=last7day`

Không ai nhìn thấy màn hình [CHƯA XÁC NHẬN cột/tab]. Chỉ biết link mặc định có `tab=last7day` [MẮT] → có các tab theo kỳ (đoán: Today/Yesterday/Last 7 Days…, **đừng coi là sự thật**). [DOC]: "báo cáo sản xuất theo xưởng theo kỳ: số production, tiền base cost, lỗi, xuất CSV có/không giá"; "Daily report": số item xử lý theo seller và packages pickup, ma trận chuyển trạng thái from→to (7 ngày: In Sewing→Packing 4.427, Ready→In Sewing 258…); API `productionStatictics`, `dailyUserReport`, `dailyProductionReport`.

| Thành phần hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|
| Số production theo kỳ, theo xưởng | Dashboard + `getFactoryOverview` + CEO Dashboard + báo cáo SLA Telegram [CODE] | GIỮ HỆ MỚI (mạnh hơn) | Thêm link "Báo cáo" của xưởng mở Dashboard tab Xưởng mặc định 7 ngày | S |
| Tiền base cost theo xưởng/kỳ | Có `baseCost` trên đơn; CEO Dashboard dùng làm tiền [CODE]; báo cáo tiền theo xưởng/seller **chưa có** [DOC §226] | BỔ SUNG, thuộc vùng Tiền | Báo `tool`; hệ cũ ghi nhận tiền lúc đóng kiện, hệ mới tính từ đơn — hai mốc khác nhau | M |
| Lỗi theo xưởng | Tab "Lỗi theo người" + stage-error-daily [CODE] | GIỮ HỆ MỚI | — | — |
| Xuất CSV có/không giá | `exportOrders` (Excel các đơn đã chọn) [CODE]; "không giá" chưa tách | BỔ SUNG nhỏ | Hai nút xuất, tuỳ role mới thấy bản có giá | S |
| Daily report: item xử lý theo seller, packages pickup | `import-summary` theo ngày; chưa có "item xử lý theo seller/ngày" [CODE] | BỔ SUNG | Agg theo `userSku`+ngày `fulfillmentCompletedAt` | M |
| Ma trận chuyển trạng thái from→to | `fulfillmentTimeline` lưu từng chuyển tiếp [CODE] | BỔ SUNG (tuỳ chọn) | Chỉ làm nếu xưởng/CEO dùng; ma trận chặng khác chặng cũ nên khó so sánh | M |
| Tab mặc định `last7day` | — | BỔ SUNG | Mặc định 7 ngày | S |

## 6. Return & Replacement — `/rar/all`

Không ai nhìn thấy [CHƯA XÁC NHẬN]. [DOC]: `replacement`/`return` là trường trên đơn; cờ `is_replacement` ở logistic; hoàn tiền `refund`/`total_refund`; RAR liệt kê là việc "có cần mang sang không" (BusinessFlows §257, câu hỏi mở 7). Menu cũ ghi "Return & Replacement · Grabink" (có thể chỉ cho Grabink — 0 hoạt động) [MẮT menu]. Link mặc định `status=Processing&source=All` [MẮT].

| Thành phần hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|
| Đơn đổi/trả (replacement/return) theo trạng thái | Không có khái niệm. Gần nhất: rework (làm lại do lỗi xưởng, `reworkCount`) và `refundedAt` mồ côi trên `customer_orders` [CODE]. Hai thứ KHÁC nhau: RAR là yêu cầu của seller/khách sau giao, rework là lỗi nội bộ trước giao | XÂY MỚI **nếu cần** | **Chưa làm gì cho tới khi anh Tuấn chốt có mang RAR sang không** (câu hỏi mở 7). Thiếu số liệu: bao nhiêu RAR 30 ngày, ai tạo, đi đâu | Chưa ước (XL nếu gồm hoàn tiền + ví) |
| Tab/lọc `status=Processing&source=All` | — | CHƯA XÁC NHẬN | Mở màn thật xem trạng thái, cột, hành động | — |

## 7. Tóm tắt ưu tiên

1. **Quyết định cần anh Tuấn:** (a) mang RAR sang không; (b) hook tiền lúc đóng kiện thuộc vùng nào (tôi nghiêng `tool`, vì đó là sổ cái); (c) bỏ Grabink/2D US khỏi menu xưởng (0 hoạt động).
2. **Làm được ngay, không cần xác nhận thêm (nhỏ):** link sidebar xưởng mang bộ lọc mặc định; ánh xạ nhãn MRP↔chặng; chip đếm theo hãng ở trang kiện. — Preset ngày "Last 7 Days/All Time" **CHƯA LÀM** (soát 10/10/2026: không tìm thấy preset này trong các trang orders; §9 đã bỏ sót nó trong im lặng).
3. **Cần xác nhận của xưởng trước khi code (chặn mô hình lô):** nút printer lô in ra gì; có giao việc theo lô không; `trending-up`; xưởng có thật sự tách đơn giữa hai lô; đóng hàng bằng quét mã đơn hay mã vận đơn.
4. **Mô hình lô mức nhẹ** làm được sau khi mục 3 không bật nhánh 4B/4C (đã viết sẵn, `ProductionBatch-Proposal.md`).

## 8. Điều tôi KHÔNG xác nhận được

Toàn bộ cột/bộ lọc của Box Packages, Production Report, Return & Replacement; ý nghĩa To Do vs Ready, `Ready`/`Reproduction` của lô; ảnh chụp màn hình. Cần một người được phép mở hệ cũ chỉ-đọc, hoặc người ở xưởng chụp hộ.

## 9. Trạng thái thực hiện

- **Hoãn có lý do:** Return & Replacement KHÔNG đưa sang đợt này (quyết định của `onos-2d` 04/10/2026). Hệ mới chưa chạy xong vòng giao hàng (58 vận đơn trên production, tất cả khách tự cấp, chưa mua nhãn VNP nào); đổi-trả là nghiệp vụ hậu-giao-hàng nên làm sau. Đây là hoãn, không phải bỏ sót.
- **Không có hook giá vốn lúc đóng kiện:** hệ cũ ghi base cost lúc THANH TOÁN đơn, làn Tiền ghi `variations[].cost` lúc đẩy sản xuất (sổ bóng). Mục này thuộc làn Tiền.
- **Grabink / 2D US:** không dựng màn riêng, nhưng KHÔNG xoá khỏi dữ liệu và vẫn hiện ở bộ chọn xưởng (Grabink là xưởng đối tác, prod vẫn có đơn mang nhãn Grabink; xưởng US đã cố ý loại khỏi thống kê ở `excluded-factory.ts`).
- **Link xưởng mang bộ lọc mặc định:** menu đã đổi sang bộ chọn xưởng trên header (Orders.md §25), nên không còn 4 link mỗi xưởng. Các link dòng sản phẩm đã mở sẵn "đơn đang mở" (`WORKSHOP_STAGE_OPEN`); link "Tất cả đơn" mặc định ngày hôm nay. Không sửa `Sidebar.tsx` (của a2).
- **Bảng ánh xạ MRP cũ ↔ chặng mới:** `packages/shared/constants/legacy-mrp-status.ts` (`LEGACY_MRP_STATUS_BY_STAGE`), test `apps/api/src/utils/legacy-mrp-status.spec.ts`. **Hiện là hằng số KHÔNG CÓ NƠI GỌI** — chỉ định nghĩa + export ở barrel (`constants/index.ts:14`) + spec; chưa nối vào UI nào, không route/gate/filter/ghi DB. Soát 10/10/2026. Giới hạn phải biết trước khi dùng: map đánh khoá theo `LifecycleStageKey` nên **không có mục cho `done`** (trả `undefined`); bỏ qua `heldAt`/`cancelledAt`; `press-waiting` và `qc-post-press` **đều** ra "In Print"; "In Cutting" không bao giờ sinh ra. Spec (3 test) chỉ kiểm cấu trúc, không khẳng định display-only. Chỉ dòng may và đóng hàng có bằng chứng từ timeline thật, còn To Do/Ready và QC sau ép là đoán.
- **Mô hình lô:** vẫn ĐÓNG chờ xưởng trả lời.
- **Chip theo hãng ở màn kiện/vận đơn: hoãn.** Đo trên production 04/10/2026: bảng `shipments` có 58 bản ghi, TẤT CẢ `provider='customer'`, `status='created'`, `lastTrackingStatus` null; chưa mua nhãn VNP thật lần nào, nên chip sẽ rỗng. Làm khi có dữ liệu thật. Cũng không có bộ lọc ngày/lịch sử bàn giao ở `/ffm/handover` (đó là tính năng mới, không phải clone).
