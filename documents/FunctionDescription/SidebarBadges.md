# Sidebar Badges (Số đếm việc cần làm trên sidebar) — Function Description

> **File FE:** `apps/web/src/components/sidebar/Sidebar.tsx`, `apps/web/src/store/sidebarBadgeStore.ts`, `apps/web/src/apis/index.tsx`, `apps/web/src/services/designer.ts`
> **File BE:** `apps/api/src/modules/designer/designer-stats.controller.ts` (`getSidebarCounts`), `apps/api/src/modules/designer/designer-stats.service.ts` (`getSidebarCounts()` + `designerFlowConds()`), `apps/api/src/modules/order/order.service.ts` (`countErrorLogTodo()` + `buildErrorLogBaseFilter()`)
> **Route:** không có route riêng — hiển thị trên mọi trang dùng `MainLayout`/`Sidebar`
> **API:** `GET /v1/designer/sidebar-counts`

## 1. Overview

3 entry sidebar hiển thị badge số đếm việc-cần-làm, cập nhật gần realtime, hover có tooltip Radix (hiện sau ~150ms) giải thích, click vào entry đi thẳng tới trang tương ứng để xử lý:

| Entry (key sidebar)                   | Badge vàng (`amber`)                       | Badge đỏ (`red`)                              |
| ------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Sản xuất → Nhật ký bù lỗi (`orders-error-log`)   | —                                          | `errorLogTodo` — đơn lỗi tab "Cần xử lý" theo góc nhìn chặng của viewer |
| Báo cáo → Designer (`dash-designer`) | `designerUnassigned` — đơn chưa gán (7 ngày) | `designerBacklog` — tổng tồn thiết kế 7 ngày (Designer thường: tồn của chính họ) |
| Tool → Soát tool — tổng quan (`dash-tool-check`) | `toolCheckRework` — đơn In trả về cần làm lại | `toolCheckUnreviewed` — đơn chưa soát (7 ngày) |
| Sản xuất → 3D/2D/Thêu/LED/Canvas/Gỗ (`line-<code>`) | — (badge **trung tính** xám, KHÔNG phải cảnh báo) | `productLineCounts[code]` — đơn CHƯA xong của dòng, `inProductionAt` trong `PRODUCT_LINE_WINDOW_DAYS` ngày VN; = đúng số dòng trang dòng sản phẩm hiện ở mặc định (`workshopStage=__open__` + cửa sổ đó). Hiện cả khi 0 (MenuRestructure-CEO.md §8.3). Ẩn khi đang chọn xưởng trên header — số là toàn hệ thống, chờ BE tách `byFactory`. Badge trung tính không vào chấm màu/pill gộp của mục cha (chỉ báo việc cần làm). |

> Menu 6 nhóm (01/10/2026, `documents/Plans/MenuRestructure-CEO.md`) dời 3 entry sang nhóm mới nhưng GIỮ NGUYÊN key — `badgeMap` gắn số theo key, đổi key là mất badge.

Badge = 0 hoặc `null` (ngoài quyền role) → ẩn. Parent đang đóng (chevron) → hiện pill gộp theo màu; sidebar thu gọn → chấm màu góc icon (đỏ ưu tiên hơn vàng), tooltip liệt kê từng số.

## 2. Luồng hoạt động

1. `Sidebar.tsx` mount (user đã đăng nhập) → fetch `GET /designer/sidebar-counts`, lưu vào `sidebarBadgeStore`.
2. **Polling 60s** (`SIDEBAR_BADGE_POLL_MS`) — chỉ khi `document.visibilityState === 'visible'` (tab nền không gọi).
3. **Refresh ngay sau thao tác:** axios response interceptor (`apis/index.tsx` → `isBadgeAffectingMutation`) bắt mọi mutation nhân viên thành công (POST/PATCH/PUT/DELETE tới path chứa `/orders|/designer|/fulfillment`, loại trừ `/customer/`) → `useSidebarBadgeStore.getState().requestRefresh()` → `Sidebar` debounce 1.2s (`SIDEBAR_BADGE_DEBOUNCE_MS`, gộp bulk action thành 1 lần fetch) rồi refetch. Người dùng hoàn thành task/gán designer/soát tool xong → số tự giảm ngay không cần reload.
4. Store `sidebarBadgeStore` TÁCH KHỎI `services/` để interceptor import được mà không tạo vòng import (`apis` ↔ `services`).

## 3. API / Schema

| Method | Path                        | Mô tả                                                        |
| ------ | --------------------------- | ------------------------------------------------------------ |
| GET    | `/v1/designer/sidebar-counts` | 5 số đếm badge, mỗi số tự `null` nếu role không có quyền xem |

`@Auth(SIDEBAR_COUNT_ROLES)` = mọi role nhân viên (SuperAdmin/Admin/Manager/SupportManager/Support/DesignerLeader/Designer/Fulfillment), KHÔNG có Customer.

```ts
// packages/shared/dtos/designer.dto.ts
SidebarCountsZod = {
  errorLogTodo: number | null;        // null với Support (tab bị ẩn — mirror hideForRoles FE)
  designerUnassigned: number | null;  // null nếu role ∉ LEADER_ROLES
  designerBacklog: number | null;     // null nếu role ∉ LEADER_ROLES
  toolCheckRework: number | null;     // null nếu role ∉ TOOL_CHECK_ROLES
  toolCheckUnreviewed: number | null;
  // CÙNG các số trên nhưng TÁCH THEO XƯỞNG — badge cho cụm menu riêng từng xưởng
  // (`Orders.md §25`). Xưởng không có đơn thì VẮNG key (FE coi như 0, không hiện badge).
  productLineCounts: { '3d' | '2d' | wood | embroidery | led | canvas | __none__: number } | null;
  byFactory: Record<factoryId, { errorLogTodo: number; toolCheckRework: number; toolCheckUnreviewed: number }>;
}
// GetSidebarCountsResDto = ResZod + { data: SidebarCountsZod }
```

## 4. UI Components

- `Sidebar.tsx`: `BadgePill` (pill tròn hiện số CHÍNH XÁC — không rút gọn "99+", đỏ `bg-red-500`/vàng `bg-amber-400`) + `BadgeDot` (chấm màu khi thu gọn) — cả 2 dùng Radix `Tooltip` (`components/ui/tooltip.tsx`, bọc `TooltipProvider delayDuration={150}` trong `renderContent`, KHÔNG dùng `title` native vì phải giữ chuột ~1–2s mới hiện), `aggregateBadges()` (gộp badge con theo màu cho hàng parent đóng), `badgeMap` (`useMemo` map key entry → badges, build từ `counts` + i18n).
- Tooltip đổi theo role: Fulfillment/Designer/DesignerLeader dùng key `badges.errorLogTodo` ("...của bạn"), Admin/Manager dùng `badges.errorLogTodoAll`; Designer thường dùng `badges.designerBacklogSelf`.
- i18n namespace `layout`, key `sidebar.badges.*` (vi + en).

## 5. Backend logic

Nguyên tắc: **mọi con số MIRROR đúng công thức của trang tương ứng** — sửa công thức trang thì badge tự khớp:

- `errorLogTodo` — `OrderService.countErrorLogTodo()` dùng CHUNG `buildErrorLogBaseFilter('todo', ...)` với `getErrorLog()` (base + `applyErrorLogViewFilter` positional theo role + `errorResolvedAt: null`). Fulfillment: khóa stage + xưởng; Designer: `assignee=userId` + status rework/in-progress; Admin/Manager: mọi xưởng, positional theo **chặng báo lỗi** của từng đơn (`$expr` — đơn còn todo khi chưa đi QUA lại chặng của entry `rework-back` cuối; không có entry → fallback chưa `fulfillmentCompletedAt`; xem `Orders.md §14.3`).
- `designerUnassigned` — `countDocuments` mirror match `getAssignBacklog` (cửa sổ 7 ngày VN, `toolResultNote ∉ [null,'','ok']`, designerStatus unassigned/rejected/rework-chưa-ôm, `productionFactoryClause`).
- `designerBacklog` — scope `'all'` (Admin/Manager/DesignerLeader): aggregate `$expr` = `designerFlowConds().backlogCond` — CÙNG object điều kiện với hàng "Tồn" (`columnTotals.backlog`) của `getDailyOverview` (đã refactor các cond dùng chung vào `designerFlowConds()`); scope `'self'` (Designer): `countDocuments` `assignee=userId` + status ∈ {assigned, in-progress, rework} (mirror `backlogByDesigner`).
- `toolCheckRework` / `toolCheckUnreviewed` — `countDocuments` mirror `reworkMatch` / `unreviewedMatch` của `getToolCheckOverview` (7 ngày, `alive` = không xóa/hủy + `productionFactoryClause`).
- `productLineCounts` — badge 6 mục nhóm "Sản xuất": `OrderService.countOpenOrdersByProductLine()` dựng filter bằng CHÍNH `buildOrderListFilter` mà trang dòng sản phẩm gọi (`productLine=X&workshopStage=__open__`, `createdFrom/To` = `PRODUCT_LINE_WINDOW_DAYS` (7) ngày lịch VN tính cả hôm nay, cùng phạm vi role) + `deletedAt` (trang đếm qua repository), rồi `$group` theo `productLine` thay vì lọc — nên số badge = số dòng khi bấm vào. Luôn đủ 6 key + `__none__` (dòng không có đơn = 0, vẫn hiện). `null` khi role ngoài `ORDER_VIEW_ROLES` hoặc thiếu `page.orders` (Admin/SuperAdmin bỏ qua, như `usePermission`). Không áp phạm vi xưởng ở header (`?factoryId=`). Khoá bằng `product-line-counts.spec.ts` (so cấu trúc filter badge ≡ filter trang cho 4 kiểu role); đã đo trên DB dev 06/09: khớp 7/7 dòng cho Admin và công nhân Ép TN.
- `byFactory` — `OrderService.countErrorLogTodoByFactory()` (lại dùng CHUNG `buildErrorLogBaseFilter` rồi `$group` theo `factoryId`) + `DesignerStatsService.getSidebarCountsByFactory()` (2 `$group` cho rework/unreviewed). Mỗi con số MỘT lượt `$group`, không phải mỗi xưởng một lượt đếm. **Khác các số tổng ở chỗ KHÔNG áp `productionFactoryClause`**: cụm menu xưởng US là lọc tường minh nên badge phải khớp số trang đó mở ra, không phải luôn 0 (`Orders.md §21`). Phạm vi theo role thì giữ nguyên như số tổng (Support vẫn không có `errorLogTodo`, role ngoài `TOOL_CHECK_ROLES` không có số soát tool).
- `DesignerModule` import `OrderModule` (lấy `OrderService.countErrorLogTodo`; không vòng lặp — OrderModule không import DesignerModule).

## 6. Performance notes

- Endpoint chỉ chạy tối đa 8 query (4 `countDocuments` + 1 aggregate `$count` + 3 aggregate `$group` cho `byFactory`) song song qua `Promise.all`, không trả list/populate — payload ~200 byte, đo thực tế vài chục ms (so với gọi 3 endpoint trang cũ: `tool-check-overview` một mình đã chạy ~10 aggregation + 2 list 500 đơn).
- Polling 60s × mỗi user đang mở tab; tab ẩn không gọi. Mutation bump debounce 1.2s nên bulk N đơn chỉ tốn 1 lần fetch.
- Lỗi fetch badge nuốt im lặng (giữ số cũ, không toast) — poll nền không được spam thông báo.

## 7. Permissions

- Endpoint: `@Auth(SIDEBAR_COUNT_ROLES)` — từng số tự `null` theo role (bảng §3), FE ẩn badge khi `null`/0.
- Hiển thị badge phụ thuộc entry sidebar có hiện không (filter perm sẵn có): `orders-error-log` (ẩn với Support qua `hideForRoles`), `dash-designer` (`page.designer_stats`), `dash-tool-check` (`page.tool_check`).


## Ghi chú 07/09/2026 — badge theo xưởng

`counts.byFactory` không còn treo trên cụm menu xưởng ở sidebar (đã gỡ) mà hiện trong menu thả của bộ chọn xưởng trên header (`apps/web/src/components/header/FactoryScopeSwitch.tsx`): mỗi xưởng một dòng, pill đỏ = `errorLogTodo`, pill vàng = `toolCheckRework + toolCheckUnreviewed`. Endpoint và công thức không đổi.
