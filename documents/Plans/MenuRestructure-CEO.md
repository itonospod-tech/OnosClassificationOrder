# Gom menu `/adm` + `/ffm` còn 6 nhóm — đề xuất của CEO

> Nguồn: bản vẽ tay của CEO (01/10/2026). Đích: menu tinh gọn theo flow hệ cũ
> `app.onospod.com`. Trang đang dùng làm mốc: `/ffm/dashboard?tab=factory`.

## 1. Hiện trạng

`Sidebar.tsx` 1.049 dòng · **39 mục** · ~10 nhóm. Người dùng phải nhớ mục nằm ở
nhóm nào. CEO muốn còn **6 nhóm cấp một**.

## 2. Menu đích

| # | Nhóm | Mục con | Nguồn |
|---|---|---|---|
| 1 | **Báo cáo** | SX · Ship · Kho | Dashboard tabs + CEO Dashboard + `/adm/shipments` + `/ffm/inventory` |
| 2 | **Sản xuất** | 3D · 2D (DTG/DTF) · Thêu · LED · Canvas · Gỗ | Danh sách đơn lọc theo `productLine` |
| 3 | **Tool** | 3D · 2D–DTF | Soát tool + Design Review |
| 4 | **Ship** | — | shipments · bàn giao · label |
| 5 | **Ví** | — | **CHƯA CÓ phía nhân viên** — chỉ có bên seller |
| 6 | **HR** | — | users · roles · custom-roles · departments |

Sáu dòng ở nhóm 2 khớp **chính xác** `ProductLine` đã có:
`3d · 2d · wood · embroidery · led · canvas`.

## 3. Giả định — sai thì sửa spec trước khi code

- **⑥ trong bản vẽ = "Gỗ"**, không phải "kho" (kho đã nằm ở nhóm Báo cáo, và
  đọc là Gỗ thì khớp 6/6 với `ProductLine`).
- Menu dùng **chung cho mọi role nhân viên**, lọc theo quyền như hiện nay —
  công nhân thấy ít mục, Admin thấy đủ. KHÔNG tách menu theo role.
- "Giống flow OnosPod" hiểu là **ít mục cấp một, chọn dòng sản phẩm rồi mới
  thấy đơn**. Chưa ai xem được giao diện hệ cũ để đối chiếu.

## 4. Việc phải làm, theo thứ tự

### Đợt 1 — nền. Hai việc KHÔNG đụng file nhau, chạy song song.

**1A · BE: lọc đơn theo dòng sản phẩm** (chặn toàn bộ nhóm "Sản xuất")
- Thêm `productLine` vào `GetProductionOrdersZod` (`packages/shared`).
- Áp vào `OrderService.getOrders` + mọi hàm dùng chung bộ lọc.
- Kiểm index trên `orders.productLine`; thiếu thì thêm, vì đây là bộ lọc mặc
  định của 6 trang.
- **Giữ nguyên** bộ lọc chuẩn: loại đơn hủy / chưa map xưởng / xưởng US.
- Có test.

**1B · FE: khung menu** (sở hữu ĐỘC QUYỀN 4 file dùng chung)
- `Sidebar.tsx` → 6 nhóm.
- `paths.ts` + `routerConfig.ts` → route mới.
- i18n `layout.json` → key mới (VI + EN).
- Chưa cần trang thật; trỏ tạm vào trang sẵn có.
- **Không agent nào khác được sửa 4 file này** cho tới khi 1B xong.

### Đợt 2 — trang. Ba agent song song, mỗi người một vùng.

**2A · Sản xuất 6 dòng** — trang danh sách lọc `productLine`, badge đếm.
**2B · Báo cáo + Tool** — gom tab Dashboard, gom Soát tool.
**2C · Ví + HR** — Ví phía nhân viên (**phần mới duy nhất**), gom HR.

## 5. Ràng buộc

- **KHÔNG thêm Ant Design.** App dùng Radix + shadcn + Tailwind
  (`apps/web/CLAUDE.md` §45). Phần nhìn dùng skill `frontend-design` /
  `impeccable`, không đổi nền tảng.
- Mọi chữ hiển thị qua `react-i18next`, không hardcode (`I18n.md`).
- Sửa `packages/shared` thì **phải build shared** rồi mới type-check hai app.
- Mỗi agent chỉ chạm vùng file của mình. Cần sửa file ngoài vùng → hỏi điều phối.
- Đích cuối là **đẩy lên `dev`** để anh Tuấn test ở `dev-onos`.

## 6. Khảo sát hệ cũ `app.onospod.com` (01/10/2026, chỉ đọc)

Đăng nhập bằng tài khoản CEO, chỉ xem menu, không thao tác gì.

**Sidebar hệ cũ dùng TIÊU ĐỀ NHÓM + accordion**, không phải menu phẳng:

```
(không tiêu đề)  Dashboard · Report › Daily Report · Affiliates
MANUFACTURING    MFT Mê Linh ›        ┐
                 MFT Thái Nguyên ›    │ mỗi xưởng có CÙNG 4 mục con:
                 MFT Grabink ›        │ Productions · Batch Items
                 MFT 2D US ›          │ Box Packages · Production Report
                 MFT Thái Nguyên Decor ›
                 Return & Replacement · Grabink
SALES            Orders › Orders · Shipments · Inventory
                 Items › 3D · 2D · Grabink · Embroidery · Dropship · Handmade Wood · Category
                 Product Tags
                 Billing › Topup · Transactions · Invoice · Production Transactions · Production Invoice
                 Manufactures · Logistics › · Fulfillments · Media › · Setting ›
                 Integrations · System Notifications · Users · Extensions
                 API Logs · Blocked Logs · Support › Tickets
```

Bấm một nhóm thì nó **mở xổ ngay tại chỗ**, các mục con thụt vào kèm biểu tượng.

**Header:** Switch user · **số dư ví** (đang `-$807.48`) · `Vip: 0` · chuông · email.

**Dashboard:** hàng nút khoảng ngày (Today · Yesterday · Last 7 Days · This Month ·
Last Month · tự chọn), rồi thẻ **Order Statistics** đếm theo trạng thái
(Completed · Fulfilled · Processing · Production · Pending · Cancelled · Refund)
và một số tổng lớn bên trái.

### 6.1 Khác biệt quan trọng so với bản vẽ của CEO

Hệ cũ gom sản xuất theo **XƯỞNG**; bản vẽ của CEO gom theo **DÒNG SẢN PHẨM**.
Đây là hai trục khác nhau, không phải bắt chước.

Hệ mới đã có **bộ chọn xưởng trên header** (`FactoryScopeSwitch`, Orders.md §25),
nên để **xưởng ở header + dòng sản phẩm ở sidebar** là khớp cả hai: giữ ý CEO mà
vẫn đạt được việc hệ cũ làm, và không nhân 6 dòng × 5 xưởng thành 30 mục.

"Ví" trong bản vẽ ứng với **Billing** hệ cũ (Topup · Transactions · Invoice).

## 7. Số thật trên production (01/10/2026) — ẢNH HƯỞNG TRỰC TIẾP MENU

**203 sản phẩm theo dòng:** `3d` 169 · `2d` 15 · `embroidery` 12 · `wood` 3 ·
**`led` 0 · `canvas` 0**.

**691 đơn từ 01/10:** `3d` 616 · `embroidery` 41 · `2d` 34 · **không có đơn nào
thiếu `productLine`**.

Hai kết luận:

1. **Đơn mới KHÔNG bị thiếu `productLine`** → 6 trang có dữ liệu để hiện, không
   cần backfill gấp. Vẫn giữ `__none__` làm đường lui.
2. **LED và Canvas hiện KHÔNG có sản phẩm nào, cũng không có đơn nào.** Dựng đủ
   6 mục theo bản vẽ thì **2 mục luôn rỗng**, và Gỗ chỉ có 3 sản phẩm. Cần CEO
   quyết: hiện đủ 6 cho đúng ý, hay **chỉ hiện dòng có dữ liệu** (mục tự xuất
   hiện khi có sản phẩm đầu tiên).
