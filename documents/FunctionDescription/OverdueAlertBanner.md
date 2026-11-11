# Overdue Alert Banner (Banner đỏ quá hạn 2 ngày) — Function Description

> **Đổi hình hài 05/10/2026:** banner đỏ toàn cục KHÔNG còn là một dải ngang dưới Header (ăn ~40px chiều cao mọi trang). Nó thành **chip đỏ trong Header** ("⚠ 16 quá hạn" — tổng chưa soát + chưa gán + designer chưa xong), bấm mở popover giữ NGUYÊN nội dung cũ: tiêu đề ngày, link "N đơn chưa soát tool", link "N đơn chưa gán designer", link "N đơn thiết kế chưa xong" kèm tên + số từng designer. Vẫn KHÔNG tắt được, vẫn luôn hiện, vẫn đỏ, cùng quyền xem (`OVERDUE_ROLES`). Component `OverdueAlertBanner.tsx` (giữ tên file/export), gắn trong `components/header/index.tsx` thay vì `MainLayout.tsx` — nhớ nó từng bị gỡ nhầm 07/09 và gắn lại 10/09: phải luôn gắn ở một chỗ của khung chung.


> **File FE:** `apps/web/src/components/common/OverdueAlertBanner.tsx`, gắn trong `apps/web/src/layouts/mainLayout/MainLayout.tsx` (giữa `<Header/>` và `<main/>`)
> **File BE:** `apps/api/src/modules/designer/designer-stats.service.ts` → `getOverdueAlert()`, `designer-stats.controller.ts`
> **Route:** không có route riêng — banner hiện trên MỌI trang `/adm` + `/ffm`
> **API:** `GET /v1/designer/overdue-alert`

## 0. Trạng thái (10/09/2026)

Banner **ĐÃ GẮN LẠI** vào `MainLayout.tsx` ngày 10/09/2026 theo yêu cầu user (từng bị gỡ 07/09/2026 khi chuyển sang khung cố định sidebar/header đứng yên). Trong khung cố định, banner nằm giữa Header và `<main>` với `shrink-0` — đứng yên cùng header, chỉ nội dung `<main>` cuộn.

## 1. Overview

Banner đỏ toàn cục cảnh báo **đơn quá hạn 2 ngày vẫn còn tồn** ở 2 chặng đầu
pipeline: **soát tool** và **thiết kế (designer)**. Ví dụ hôm nay ngày 13 mà
đơn vào sản xuất ngày 11 trở về trước vẫn còn "chưa soát" / "chưa gán" /
"designer chưa làm xong" → banner hiện to, đỏ, ngay dưới Header trên **mọi
trang**, **không tắt được**.

Chủ đích: Admin + Support + Designer (và cấp quản lý tương ứng) cùng nhìn thấy
**CÙNG một con số toàn hệ thống, kèm TÊN từng designer đang tồn việc** — để mọi
người chủ động xử lý và thúc nhau làm, không ai phải đợi nhắc.

## 2. Luồng hoạt động

1. User (role được xem) vào bất kỳ trang nào trong MainLayout → banner tự fetch
   `GET /designer/overdue-alert`, poll lại mỗi **60s**.
2. Sau mỗi mutation liên quan (theo `isBadgeAffectingMutation` của axios
   interceptor — dùng chung `sidebarBadgeStore.refreshRequestedAt` với
   [`SidebarBadges.md`](SidebarBadges.md)) → debounce 1.2s rồi refetch, số tụt
   ngay khi ai đó vừa soát/gán/hoàn thành đơn.
3. Tổng 3 số = 0 → banner tự biến mất. Ngược lại render các segment (chỉ hiện
   segment > 0), mỗi segment là link nhảy thẳng tới nơi xử lý:
   - "chưa soát tool" → `/ffm/dashboard?tab=tool-check` (chỉ role thấy được tab
     đó mới là link, designer thấy text thường)
   - "chưa gán designer" → `/ffm/dashboard?tab=designer`
   - "thiết kế chưa xong (Tên 1 n · Tên 2 m…)" → role Designer nhảy về
     `/ffm/my-tasks` của chính họ, các role còn lại về `?tab=designer`

**Định nghĩa "quá hạn":** `inProductionAt` **trước 00:00 HÔM QUA giờ VN** (hôm
nay 13 → chỉ đếm ngày 11 trở về trước; đơn ngày 12–13 chưa tính). Chặn dưới =
đầu **cửa sổ 7 ngày** (`resolveVnWindow(7)`) — đồng bộ với các trang/badge mà
banner trỏ tới, đơn cũ hơn 7 ngày rơi khỏi cả trang lẫn banner.

## 3. API / Schema

| Method | Path                     | Mô tả                                                       |
| ------ | ------------------------ | ----------------------------------------------------------- |
| GET    | `/designer/overdue-alert` | 3 số đếm quá hạn + breakdown theo designer (số toàn hệ thống) |

DTO tại `packages/shared/dtos/designer.dto.ts`:

```ts
OverdueAlertZod = {
  cutoffDay: string;            // ngày VN muộn nhất bị coi là quá hạn (yyyy-mm-dd)
  toolCheckUnreviewed: number;  // chưa soát tool  (mirror unreviewedMatch ToolCheck)
  designerUnassigned: number;   // cần gán designer (mirror match getAssignBacklog)
  designerBacklog: number;      // đã gán chưa xong = tổng byDesigner
  byDesigner: { userId; name; count }[]; // sort giảm dần — hiện tên trên banner
}
// GetOverdueAlertResDto = ResZod + data: OverdueAlertZod
```

## 4. UI Components

- `components/common/OverdueAlertBanner.tsx` — thanh `bg-red-600` chữ trắng,
  icon `AlertTriangle` (lucide) `animate-pulse`, title UPPERCASE in đậm; các
  segment cách nhau dấu `•`, tên designer dạng `(Hùng 4 · Lan 3)`. i18n
  namespace `layout` (`overdueAlert.*`, đủ cả `vi`/`en`).
- Gắn trong `MainLayout.tsx` **giữa `<Header/>` và `<main/>`** — `<main>` là
  vùng cuộn (`overflow-auto`) nên banner đứng yên, luôn trong tầm mắt, không
  bị cuộn mất; không có nút đóng.
- Role gate FE `OVERDUE_ROLES` (mirror BE): SuperAdmin, Admin, Manager,
  SupportManager, Support, DesignerLeader, Designer. Role ngoài danh sách
  (Fulfillment, Accountant…) không fetch, không thấy gì.

## 5. Backend logic

`DesignerStatsService.getOverdueAlert()` — 3 query song song trên `orders`,
**MIRROR đúng công thức các trang tương ứng** (đổi trang phải đổi đây, xem
[`SidebarBadges.md`](SidebarBadges.md) cùng nguyên tắc):

1. `toolCheckUnreviewed`: `toolResultNote ∈ [null,'']` + alive (loại đơn hủy /
   deleted / xưởng US qua `productionFactoryClause`).
2. `designerUnassigned`: `toolResultNote` có giá trị ≠ 'ok' + `designerStatus ∈
   {unassigned, rejected, rework-không-assignee}` (mirror `getAssignBacklog`).
3. `byDesigner`: aggregate `$group` theo `assignee` với `designerStatus ∈
   {assigned, in-progress, rework}` (mirror backlogAgg per-designer của
   `getDailyOverview` — "rejected" KHÔNG tính tồn), lookup tên qua `userModel`.

Cả 3 dùng chung khoảng `inProductionAt: { $gte: windowStart(7d), $lt:
00:00-hôm-qua-VN }`. Endpoint `@Auth(OVERDUE_ALERT_ROLES)` — **không** scope
theo người gọi, mọi role nhận cùng payload.

## 6. Performance notes

- 2 `countDocuments` + 1 aggregate `$group` trên index sẵn có của `orders`
  (`inProductionAt`), poll 60s/user — cùng chi phí cỡ `sidebar-counts` hiện
  hữu, không thêm index mới.
- Lookup tên designer chỉ chạy khi có tồn (`byDesigner.length > 0`), project
  3 field.

## 7. Permissions

- BE: `OVERDUE_ALERT_ROLES` trong `designer-stats.controller.ts` (7 role kể
  trên). KHÔNG dùng permission-catalog — theo role, giống `sidebar-counts`.
- FE: `OVERDUE_ROLES` trong `OverdueAlertBanner.tsx` phải giữ mirror với BE.
