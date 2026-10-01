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
