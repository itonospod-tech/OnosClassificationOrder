# Clone hệ cũ OnosPod — spec khảo sát & khoảng trống

> Mục tiêu anh Tuấn đặt: **hệ mới làm được mọi việc hệ cũ đang làm**, và nhìn quen
> tay với người đang dùng hệ cũ. Tài liệu này là BẢN ĐỒ + BẢNG KHOẢNG TRỐNG, chưa
> phải lệnh code.
>
> Nguồn: khảo sát `app.onospod.com` ngày 01/10/2026 (chỉ đọc) + 
> `documents/Architecture/OnosPodLegacy-BusinessFlows.md`.

## 1. Định nghĩa "clone 100%" — đọc trước khi làm

"Clone" ở đây là **ngang bằng NĂNG LỰC + quen thuộc về giao diện**, KHÔNG phải
sao chép từng màn hình.

Lý do: nhiều phần hệ mới đã làm khác và làm tốt hơn (6 công đoạn Fulfillment có
rework-back, auto-gán designer 3 mức, soát tool). Sao y màn hình hệ cũ ở những
chỗ đó là **bước lùi**. Ngược lại có vùng hệ mới **chưa có gì** (hoá đơn, giao
dịch sản xuất) — đó mới là chỗ phải xây.

Mỗi vùng dưới đây phải kết luận một trong ba:
- **GIỮ HỆ MỚI** — đã đủ, chỉ cần đổi nhãn/đường đi cho quen.
- **BỔ SUNG** — có nền, thiếu phần.
- **XÂY MỚI** — chưa có gì.

## 2. Bản đồ menu hệ cũ (đầy đủ, lấy từ DOM)

```
Dashboard · Report › Daily Report · Affiliates
MANUFACTURING
  MFT Mê Linh / Thái Nguyên / Grabink / 2D US / Thái Nguyên Decor
     mỗi xưởng: Productions · Batch Items · Box Packages · Production Report
  Return & Replacement · Grabink
SALES
  Orders › Orders · Shipments · Inventory
  Items › 3D · 2D · Grabink · Embroidery · Dropship · Handmade Wood
          · Category · Tags · Techniques · Materials
  Product Tags
  Billing › Topup · Transactions · Invoice · Production Transactions
            · Production Invoice
  Manufactures · Logistics › Shipping Methods · Locations
  Fulfillments · Media › Files
  Setting › Shipping table · Storage · Call To Action
  Integrations · System Notifications · Users · Extensions
  API Logs · Blocked Logs · Support › Tickets
```

**Luật rút ra, áp cho mọi màn hình clone:** mọi link menu hệ cũ đều mang **bộ lọc
mặc định** (`?status=Processing`, `?mrp_status=To Do`, `?tab=last7day`). Bấm menu
là ra view hữu ích nhất, không phải danh sách thô.

## 3. Cấu trúc màn hình đã lấy được

**Orders** (`/orders?status=Processing`)
- Tabs trạng thái kèm số: All · Pending · Processing · In Production · Fulfilled
  · Completed · Refunded · Cancelled · Trashed
- Hàng nút khoảng ngày: Today · Yesterday · Last 7 Days · This Month · Last Month
- Lọc: search · rows per page · Priority · provider · manufacture
- Cột: `# · ITEM(S) · BUYER · STATUS · FF · SHIPMENT · NOTE · ACTION`

**Productions / MRP** (`/manufactures/<id>/mrp`)
- Cột: `# · ITEM PHOTOS · ITEM INFO · Price · STATUS · BARCODE · BATCH ID · NOTE · ACTION`
- Lọc: group name · product type · production ID · rows per page

**Dashboard**
- Hàng nút khoảng ngày + thẻ **Order Statistics** đếm theo trạng thái
  (Completed · Fulfilled · Processing · Production · Pending · Cancelled · Refund)
- Khối **Getting Started** · Latest Invoices · Latest Refund

**Header**: Switch user · số dư ví · hạng VIP · chuông · email.

## 4. Chia vùng cho agent

| Vùng | Agent | Nội dung |
|---|---|---|
| Đơn hàng · Vận đơn · Tồn kho | `a1` | Orders, Shipments, Inventory |
| Khung giao diện | `a2` | sidebar, header, dashboard, khung trang danh sách |
| Danh mục sản phẩm | `a3` | Items 6 loại, Category, Tags, Techniques, Materials |
| Sản xuất theo xưởng | `a4` | Productions, Batch Items, Box Packages, Production Report, R&R |
| Tiền | `tool` | Billing 5 trang, Affiliates |

Phần còn lại (Manufactures, Logistics, Fulfillments, Media, Setting,
Integrations, Notifications, Users, Extensions, API Logs, Support) để đợt sau.

## 5. Mỗi agent nộp gì

Một bảng cho vùng của mình:

| Màn hình hệ cũ | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|

Kèm: ảnh chụp màn hình hệ cũ, danh sách cột/bộ lọc/hành động, và **bộ lọc mặc
định** của từng link menu.

**Chưa code.** Khảo sát trước — hôm nay đã hai lần quyết định sai vì suy từ mô tả
thay vì mở ra xem.
