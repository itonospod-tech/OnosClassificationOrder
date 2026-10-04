# Clone hệ cũ — Đơn hàng · Vận đơn · Tồn kho (bảng khoảng trống §5)

> Bảng nộp theo `LegacyClone-Spec.md §5`, lập 01/10/2026 (agent a1), chép vào repo 04/10/2026. Trạng thái thực hiện ở §6 cuối file.

Nguồn hệ cũ: cấu trúc giao diện do `onos-49` khảo sát (chỉ đọc, không có dữ liệu đơn).
Nguồn hệ mới: đọc code trên `dev` (c5b2ae4). Chỗ nào chưa xác minh thì ghi rõ.

Công sức: S ≤ 0,5 ngày · M ≈ 1–2 ngày · L ≈ 3–5 ngày · XL > 1 tuần (một agent, đã tính test + doc).

## 0. Khung trước khi đọc bảng

- **Hệ mới có hai lớp đơn, khớp với hệ cũ:** `customer_orders` là lớp ĐƠN (trạng thái pending · processing · in-production · fulfilled · completed · refunded · cancelled, mirror OnosPod, chỉ `pending`/`cancelled`/`refundedAt` được lưu, còn lại tính lúc đọc). `OrderEntity` là lớp ITEM, tương đương "production" của hệ cũ. Màn `/orders` hệ cũ là lớp ĐƠN, nên đối chiếu với lớp đơn, KHÔNG với `cancelledAt` + chặng của item.
- **Màn tương đương của hệ mới nằm ở `apps/seller` khu `/hub`** (`hub-orders-view.tsx`, `GET admin/customer-orders{,/counts,/stats}`, chỉ Admin/SuperAdmin), không ở `/adm`. CLAUDE.md đã chốt `/adm` chỉ còn cho vận hành xưởng.
- **Câu kiến trúc cần anh Tuấn chốt TRƯỚC khi làm màn đơn:** "In Production" hệ cũ = đã trừ ví + mua label (bước `process_order`). Hệ mới = item đã vào công đoạn In. Hai mốc khác nhau nên số đếm tab hai hệ không bao giờ khớp. Chọn "gắn với tiền" thì kéo theo luồng thanh toán trước sản xuất (vùng Billing), lớn hơn nhiều so với một màn hình.

## 1. Orders — `/orders?status=Processing`

| Thành phần hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|
| Tab All · Pending · Processing · In Production · Fulfilled · Completed · Refunded · Cancelled (có số) | Pill trạng thái có số, đủ 7 trạng thái + toggle "Đang giữ" (`OrdersStatusFilterPills` + `/counts`) | GIỮ HỆ MỚI | Đổi nhãn cho quen tay nếu cần. Lưu ý định nghĩa In Production (§0) | S |
| Tab **Trashed** | Không có trạng thái hay tab "thùng rác" cho đơn khách. Entity có soft-delete ở tầng repository nhưng không lộ ra UI | BỔ SUNG | Thêm hành động đưa vào thùng rác/khôi phục + tab Trashed. Cần chốt: khác Cancelled ở đâu (hệ cũ có `trashOrder` riêng) | M |
| Tab **Rejected** (tài liệu cũ có) | — | KHÔNG CẦN (chưa chắc) | DOM hệ cũ không có tab này. Nhiều khả năng là HÀNH ĐỘNG trên chi tiết đơn (Cancel/Reject/Refund). Xác minh khi xem menu ACTION | — |
| Tab **Refunded** có dữ liệu | Có tab + trường `refundedAt`, nhưng KHÔNG luồng nào set (comment entity: "phase này chưa có flow set") | BỔ SUNG, phụ thuộc Billing | Luồng hoàn tiền nằm ở vùng Tiền (`tool`); màn đơn chỉ cần hiển thị | thuộc Billing |
| Hàng nút ngày Today · Yesterday · **Last 7 Days** · This Month · Last Month · tự chọn | `DateRangeFilter`: Today · Yesterday · This week · This month · Last month · This year + chọn tháng/năm + tự chọn | BỔ SUNG nhỏ | Thêm preset "Last 7 Days" (hệ mới có This week thay vào) | S |
| Select tháng | Có (bước tháng/năm trong popover) | GIỮ HỆ MỚI | — | — |
| Search | Có (`SearchInput`, debounce) | GIỮ HỆ MỚI | — | — |
| Rows per page 10/20/50/100 | Có select số dòng trong `OrdersPagination` (trần 100). Giá trị cụ thể của select chưa đối chiếu | GIỮ HỆ MỚI | Kiểm có đủ 10/20/50/100 | S |
| Lọc **manufacture** (xưởng) | KHÔNG có trên màn hub. Xưởng nằm ở lớp item (`OrderEntity.factoryId`), không có trên `customer_orders` | BỔ SUNG | Lọc đơn theo "có item ở xưởng X" qua lookup item, giống cách đã derive trạng thái. Thêm param vào `admin/customer-orders{,/counts}` | M |
| Lọc **provider** (Private / Grabink) | Không có khái niệm đối tác fulfil ngoài | KHÔNG CẦN (chờ xác nhận) | Legacy doc §2/§14.6: Grabink/2D US 0 hoạt động 30 ngày. Hỏi anh Tuấn có bỏ hẳn không | — |
| Checkbox **Priority** | `priority` có ở lớp ITEM (`OrderEntity`), không có ở lớp đơn, hub không lọc | BỔ SUNG | Lọc "đơn có ≥1 item ưu tiên" qua lookup item | S–M |
| Tab **dòng sản phẩm** | Hệ mới CÓ, hệ cũ không (6 tab `ProductLineTabs` có số) | GIỮ HỆ MỚI (hơn) | — | — |
| Lọc **seller** | Hệ mới có (`SellerFilterPicker`), hệ cũ không thấy trên DOM | GIỮ HỆ MỚI (hơn) | — | — |
| Cột `#` | Cột mã đơn (`columns.order`) | GIỮ HỆ MỚI | — | — |
| Cột ITEM(S) | Cột sản phẩm + số lượng | GIỮ HỆ MỚI | — | — |
| Cột BUYER | Cột khách (`columns.customer`) + cột seller riêng | GIỮ HỆ MỚI | — | — |
| Cột STATUS | Badge trạng thái + chặng | GIỮ HỆ MỚI | — | — |
| Cột **FF** | Cột trạng thái nội bộ (`InternalStatus`), chưa chắc cùng nghĩa vì nhãn FF hệ cũ chưa xem được | CHƯA XÁC MINH | Cần anh Tuấn mô tả nhãn trong cột FF | — |
| Cột SHIPMENT | Cột tracking + `ShipmentCell` (mua label từ hub) | GIỮ HỆ MỚI | Đối chiếu nhãn khi có | — |
| Cột **NOTE** | `customer_orders.note` CÓ trong entity, nhưng hub không có cột Note | BỔ SUNG | Thêm cột Note | S |
| Cột ACTION (menu từng hàng) | Hub có: đẩy sản xuất (Push), mua label | CHƯA XÁC MINH | Nội dung menu hệ cũ chưa xem được (phải mở trên đơn thật). Theo tài liệu cũ, chi tiết đơn có: Request/Cancel shipment, in label, Request active USPS +0,7$, Cancel/Reject/Refund, Split, Clone, Keep in stock, Transform to inventory, Add transaction. Phần lớn chưa có ở hệ mới | L (nếu đủ bộ) |
| Nút hàng loạt | Hub có: mua label các đơn đã chọn (`buyPicked`) | CHƯA XÁC MINH | Phải tick đơn thật mới thấy | — |
| Nút tạo đơn | Có (`hub:createOrder.newOrder`) | GIỮ HỆ MỚI | — | — |
| **Mặc định của link menu** `status=Processing` | Hub mặc định `status=''` (All) | BỔ SUNG nhỏ | Link menu hub trỏ `?status=processing` | S |

**Kết luận Orders: BỔ SUNG.** Nền đủ (mô hình đơn 2 lớp, tab, ngày, search, phân trang, cột chính). Thiếu: Trashed, lọc xưởng, lọc Priority, cột Note, preset Last 7 Days, mặc định Processing ≈ 4–6 ngày. Phần lớn (menu ACTION) chưa đo được. Chặn bởi: câu In Production (§0) và vùng Billing cho Refunded.

## 2. Shipments — `/shipments?shipment_status=All`

| Thành phần hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|
| Trang danh sách vận đơn | `/adm/shipments` (Admin): bảng `shipments` + `shipping_packages`, timeline sự kiện, ví VNP, thống kê theo xưởng/tháng/dịch vụ. Cả vận đơn khách tự cấp (`provider='customer'`, ORD-26) cũng vào cùng bảng | GIỮ HỆ MỚI làm nền | — | — |
| `shipment_status` = **trạng thái HÃNG** (Processing → Picked Up → … → Delivered/Failed/Exception, 11 mức theo tài liệu cũ) | Lọc `status` của hệ mới là trạng thái MUA LABEL (`VNP_SHIPMENT_RECORD_STATUSES`). Trạng thái hãng tách riêng (`scannedAt`, `carrierNote`, cron tracking), mức chi tiết thấp hơn | BỔ SUNG | Thêm lọc theo trạng thái hãng + chuẩn hoá trạng thái hãng về thang hệ cũ (cần biết VNP trả những mức nào) | M–L |
| Cột `#` | Cột kiện/mã | GIỮ HỆ MỚI | — | — |
| Cột **ITEM(S)** | KHÔNG có trên bảng shipments | BỔ SUNG | Join item của kiện | S–M |
| Cột **SHIPPING ADDRESS** | KHÔNG có trên bảng (địa chỉ nằm trên đơn) | BỔ SUNG | Hiện địa chỉ rút gọn | S |
| Cột STATUS | Có (badge trạng thái mua) | BỔ SUNG | Theo dòng trạng thái hãng ở trên | (gộp) |
| Cột TRACKING | Có | GIỮ HỆ MỚI | — | — |
| Cột ACTION | Hệ mới: mở label, timeline, hủy (fail-closed). Hệ cũ chưa xem được | CHƯA XÁC MINH | Tài liệu cũ: `maskAsDelivered`, import tracking hàng loạt, xuất phiếu pickup | M nếu cần đủ |
| Search | Có | GIỮ HỆ MỚI | — | — |
| Rows per page, select tháng, hàng nút ngày | Hệ mới có lọc khoảng ngày cho thống kê (`stats.from/to`). Chưa đối chiếu có preset ngày + chọn số dòng trên bảng | BỔ SUNG nhỏ | Dùng lại bộ ngày + phân trang như màn đơn | S |
| Cột hệ mới không có ở hệ cũ: chi phí VNP, giá thu seller, người mua label, dịch vụ | — | GIỮ HỆ MỚI (hơn) | — | — |
| **Mặc định link menu** `shipment_status=All` | Mặc định tất cả | GIỮ HỆ MỚI | — | — |

**Kết luận Shipments: BỔ SUNG.** Nền tốt hơn hệ cũ ở phía tiền (chi phí, giá thu seller, ví). Thiếu thang trạng thái HÃNG để lọc, cột item + địa chỉ, preset ngày ≈ 3–5 ngày. Lưu ý: hệ mới mới chỉ có VNP + vận đơn khách tự cấp. Hệ cũ còn ONOSEXPRESS/SBTT/GHTK/COD, việc đó thuộc vùng Logistics, không phải màn hình này.

## 3. Inventory — `/inventory?status=Processing`

| Thành phần hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|
| Link menu có, mở ra **404** với tài khoản CEO | `/ffm/inventory` = sổ **PHÔI theo xưởng** (nhập phiếu, trừ khi quét tem, kiểm kê). KHÁC khái niệm: Inventory nhóm SALES hệ cũ, theo hành động "Keep in stock" / "Transform to inventory" trên đơn, nhiều khả năng là hàng THÀNH PHẨM của seller | **KHÔNG CẦN CLONE (đề xuất), chờ xác nhận** | Hỏi anh Tuấn/vận hành: trang đã bỏ hay chỉ mở cho vai khác (seller?). Nếu đã bỏ thì xoá khỏi phạm vi clone. Nếu còn dùng ở vai khác thì là XÂY MỚI (khái niệm hàng thành phẩm giữ kho, KHÔNG dùng lại `/ffm/inventory`) | 0 hoặc L |

**Kết luận Inventory:** đừng kết luận "GIỮ HỆ MỚI" vì trùng tên. `/ffm/inventory` không phải cùng một thứ. Đề xuất "không cần clone" cho tới khi có người xác nhận trang còn dùng.

## 4. Chưa đo được (vì phải chạm dữ liệu thật) — cần anh Tuấn tự mở và mô tả

1. Nút hàng loạt ở Orders (phải tick đơn).
2. Nội dung menu ACTION từng hàng ở Orders và Shipments.
3. Nhãn trong cột FF và SHIPMENT (Orders), STATUS (Shipments).
4. Inventory: còn dùng không, cho vai nào.

## 5. Câu hỏi cho anh Tuấn (quyết định trước khi code)

1. "In Production" gắn với TIỀN (như cũ: trừ ví + mua label) hay với SẢN XUẤT (như mới: vào công đoạn In)?
2. Trashed khác Cancelled thế nào trong vận hành? Có cần khôi phục?
3. Bỏ hẳn lọc provider (Grabink/Private) được không?
4. Inventory nhóm SALES còn dùng không?

## 6. Trạng thái thực hiện (04/10/2026)

| Việc | Commit | Trạng thái |
|---|---|---|
| Link menu hub mặc định `?status=processing` | `18f11d3` | Đã gộp `dev` |
| Cột Ghi chú (`customer_orders.note`) | `18f11d3` | Đã gộp `dev` |
| Lọc xưởng + Ưu tiên (list + counts, chính xác, không trần) | `5b9ab6c` | Đã gộp `dev`, kiểm API: list = counts ở 10 tổ hợp |
| Tab Thùng rác (chỉ đơn chưa đẩy, admin, có khôi phục) | `456a087`, `3ed1862` | Đã gộp `dev` |
| Số đếm hub: lọc trước `$lookup`, `byLine` bỏ derive | `4043788` | Đã gộp `dev`, số không đổi |
| Shipments: lọc trạng thái hãng + cột item/địa chỉ + preset ngày | `0759e98` | Xong trên `agent/a1`, chờ gộp |
| Preset "Last 7 Days" cho hub | (commit này) | Xong trên `agent/a1`, e2e 33/36 (3 đỏ có sẵn) |
| Bỏ lọc provider (Grabink/Private) | — | Đã duyệt bỏ; hub chưa từng có lọc này nên KHÔNG có gì để gỡ — chỉ ghi nhận ở đây |
| Nhãn/ngữ nghĩa tab Orders | — | CHẶN: chờ câu "In Production gắn tiền hay sản xuất" |
| Inventory nhóm SALES | — | Đề xuất KHÔNG CLONE (404 với CEO), chờ chủ dự án |

Ảnh chụp hệ cũ: không có — phiên a1 bị chặn đọc production và không đi vòng; cấu trúc giao diện ở bảng do onos-49 khảo sát, chỉ phần tab/cột/lọc/mặc định.
