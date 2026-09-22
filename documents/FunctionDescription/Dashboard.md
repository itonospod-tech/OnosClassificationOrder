# Dashboard — Function Description

> **File FE:** `apps/web/src/pages/home/index.tsx` (6 tab: `stats|status|factory|lifecycle|tool-check|designer`)
> **⚠️ BỎ thanh tab tại chỗ (2026-07):** `index.tsx` KHÔNG còn render `TabsList/TabsTrigger` — chuyển tab CHỈ qua submenu sidebar (`Sidebar.tsx` Link `?tab=<key>`, thay cả query string nên param của tab cũ tự biến mất; đã xóa `handleTabChange` + logic strip param chéo tab). `index.tsx` render điều kiện `{activeTab === 'x' && <XTab/>}`, vẫn đọc/gắn `?tab=` để deep-link + sidebar highlight; nhóm i18n `dashboard:tabs.*` đã xóa (vi+en).
> **⚠️ TẠM ẨN (2026-07):** tab **`status` (Tình trạng đơn hàng)** và **`person-error` (Lỗi theo người)** đang bị comment (không cần nữa) — code/BE/i18n giữ nguyên, chỉ comment ở `pages/home/index.tsx` (import + `TABS` + `canSeePersonError`/`isTabAllowed` + khối render điều kiện) và 2 entry `dash-status`/`dash-person-error` trong `components/sidebar/Sidebar.tsx`. Bật lại theo ghi chú "TẠM ẨN" tại chỗ trong 2 file đó.
> **Tab "Soát tool" (`tool-check`)** — Support/Admin: đơn In trả về "do soát tool" + backlog chưa soát + **dải tổng quan theo ngày (6 hàng: Tổng đơn/Chưa soát/Đã soát/Soát lỗi/Soát OK/Cần làm lại; click ngày → lọc list, click CON SỐ → drill `DesignerDrillPanel` có filter Designer/Khách)** + **3 filter Sản phẩm/Khách/Máy** + thống kê lỗi theo sản phẩm/khách. **Doc riêng:** [`ToolCheckWorkflow.md`](ToolCheckWorkflow.md) (API `GET /v1/designer/tool-check-overview`, perm `page.tool_check`, gate `isAdmin || has('page.tool_check')`).
> **Tab "Vòng đời đơn" (`lifecycle`)** — phễu 9 chặng soát tool→thiết kế→7 stage fulfillment. **MỌI tài khoản** (Fulfillment khóa xưởng). **Doc riêng:** [`OrderLifecycle.md`](OrderLifecycle.md) (API `GET /v1/orders/lifecycle-overview`).
> **Strip "Vòng đời đơn"** (`LifecycleStrip.tsx`) — 1 dòng gọn trên đầu Dashboard, TRÊN mọi tab, cho mọi tài khoản: mặc định mini-phễu backlog theo ngày; nhập `productionId` → hành trình 1 đơn (API `GET /v1/orders/lifecycle-track/:code`). Xem `OrderLifecycle.md`.
> **Tab A — Thống kê:** `apps/web/src/pages/home/OrderStatsTab.tsx` > **Tab A — Thống kê đơn & sản phẩm:** `apps/web/src/pages/home/OrderStatsTab.tsx`. Filter top bar dùng chung `<OrderFilterBar>` — xem `Orders.md §10.3`. 2 search field (`searchType` main + `searchUser` qua `topActionsRight`); auto-fetch debounce 300ms.
> **Tab B — Tình trạng:** `apps/web/src/pages/home/OrderStatusTab.tsx` + `status/{KpiCard,BreakdownCard,StatusFilterExtras,OrdersMiniTable,useStatusFilter}.tsx`. Filter top bar dùng chung `<OrderFilterBar>` (apps/web/src/components/orders/OrderFilterBar.tsx) — xem `Orders.md §10.3`.
> **Tab C — Đơn theo xưởng:** `apps/web/src/pages/home/OrderFactoryTab.tsx` + `apps/web/src/pages/home/exportOrders.ts` (XLSX builder)
> **Tab D — Designer:** `apps/web/src/pages/home/DesignerStatsTab.tsx` (+ `DesignerDailyOverview.tsx`, `DesignerDrillPanel.tsx`, `DesignerAssignBacklog.tsx`, `TeamDailyMatrix.tsx`, `StatusBarCharts.tsx`, `TopDesigners.tsx`) — Admin/Manager/Leader **+ Designer (sub)** (perm `page.designer_stats`)
> **File BE:** `apps/api/src/modules/order/order.service.ts` → `getDashboard()`, `getStatusOverview()`, `getFactoryOverview()`, `exportOrders()`, `transferOrder()`, `bulkTransferOrders()` + `apps/api/src/modules/designer/designer-stats.service.ts` → `getPerformance()`, `getTimeline()`, `getErrorStats()`, `getTeamDailyBreakdown()` > **Route:** `/ffm/dashboard?tab=stats|status|factory|designer` > **API:**
>
> - `GET /v1/orders/dashboard` (Tab A)
> - `GET /v1/orders/status-overview` (Tab B)
> - `GET /v1/orders/factory-overview` (Tab C)
> - `GET /v1/orders/export` (Tab C — full-list export, không phân trang)
> - `PATCH /v1/orders/:id/transfer` + `PATCH /v1/orders/bulk-transfer` (Tab C — chuyển xưởng)
> - `GET /v1/designer/performance` + `/timeline/:userId` + `GET /v1/orders/error-stats` (Tab D — **tạm KHÔNG gọi**, legacy stats tắt qua `SHOW_LEGACY_STATS=false`)

---

## 1. Overview

Dashboard chia 4 tab độc lập (Tab D chỉ Leader/Admin/Manager):

### Tab A — "Thống kê đơn & sản phẩm" (cũ)

Tổng quan đơn theo kỳ thời gian:

- 4 metric card (đơn hàng / số lượng / chi phí SX / phí ship)
- Biểu đồ tròn phân bổ **xưởng → loại máy** (hover drill-down)
- Bảng **pivot sản phẩm × size** (`SizeMatrixTable`) — đặt **ngay trên** bảng "Chi tiết theo loại sản phẩm". Mỗi dòng 1 type, mỗi cột 1 size (XS→S→M→L→XL→2XL…, biến thể XXL/XXXL normalize về 2XL/3XL qua `normalizeSize`), ô = số lượng (0 → `–` mờ), cột cuối + dòng cuối = Tổng. Header trái + cột Tổng sticky, scroll ngang khi nhiều size.
  - **Lọc theo xưởng**: dropdown "Tất cả xưởng" + từng xưởng. Options = field `factoryOptions` của `getDashboard` (đọc THẲNG bảng `factories`, xưởng đang bật, đã bỏ xưởng US) **hợp** với distinct `sizeMatrix[].factoryId` — xưởng 0 đơn trong kỳ vẫn chọn được (bảng ra rỗng), xưởng đã tắt mà còn đơn vẫn lọc được. Lọc client-side; chọn "Tất cả" thì cộng dồn qua mọi xưởng theo type.
  - **Khóa xưởng theo role**: user gắn 1 xưởng (`profile.factoryId`, không thuộc SuperAdmin/Admin/Manager/SupportManager) → `lockedFactoryId` ép bảng chỉ hiển thị xưởng của họ, ẩn dropdown (thay bằng badge tên xưởng). Admin/Manager/Support chọn được mọi xưởng.
  - Dữ liệu từ field mới `sizeMatrix` của `getDashboard` (group sẵn theo factory × type × size ở BE) — không gọi API riêng.
  - **Nút "Xuất Excel"** (`buildSizeMatrixWorkbook` trong `pages/home/exportOrders.ts`) — xuất đúng bảng đang xem (theo xưởng đã lọc) ra `.xlsx`: dòng tiêu đề (LỆNH SẢN XUẤT — <xưởng> — <khoảng ngày>), header `Sản phẩm | <size…> | Tổng`, dòng cuối = tổng cột. Ô 0 để trống. Reuse `downloadWorkbook`.
- Bảng nhóm theo **production type** (expand size / mockup / duplicate)
- Card **Top khách hàng đặt nhiều**
- Bộ lọc time range + search type + search user

Data từ `GET /v1/orders/dashboard`.

### Tab B — "Tình trạng đơn hàng" (Phase 6)

Thống kê + drill-down theo workshop fields:

- 4–6 **KPI card** đổi theo role (xem mục 5)
- **Filter chip bar** + date range
- **Grid breakdown card** đếm đơn theo từng workshop category (printStatus, toolResultNote, assignee, ...) + factory + machineType
- **Mini order list** (20 row/page) lọc theo filter hiện tại, có inline edit theo permission — **compact grouped columns** (8 group thay vì ~20 cột lẻ, field xếp chiều dọc trong 1 cell), xem `Orders.md §10.2a`

Data từ `GET /v1/orders/status-overview` + `GET /v1/orders` (list).

### Tab C — "Đơn hàng theo xưởng" (Phase 7)

Dashboard chuyển xưởng + xuất Excel + filter chiều sâu:

- **3 Factory cards** (ML / TN / US) — **đang lọc theo 1 xưởng thì CHỈ hiện thẻ của xưởng đó**, các xưởng khác ẩn đi (mọi `filterMode` có `factoryId`: `at`/`in`/`out`/`print`/`error`); khối "Luồng chuyển xưởng" cũng chỉ giữ luồng có dính xưởng đang lọc (đi hoặc đến). Chip bar phía dưới **vẫn liệt kê đủ xưởng** — đó là đường đổi xưởng / bỏ lọc. Mỗi card: tổng đơn đang sản xuất tại đó, pure, nhận từ xưởng khác, đã chuyển đi, **5 mini stats** (sản phẩm / loại vải / **phòng** = distinct machineTypeId / **loại máy** = distinct workshop_config.machine code / có tool), **khối Design 4 số** (được gán / chưa gán / đã xong / chưa xong — theo `designerStatus`, mỗi cặp cộng lại = total)
- **Flow visualization** — danh sách luồng `(Từ xưởng → Đến xưởng, count, totalQuantity)`
- **Filter chip bar** factory `Tất cả / Đang ở ML / Đang ở TN / Đang ở US` + **7 select filter** (Sản phẩm / Loại vải / **Phòng** = machineTypeId / **Máy** = workshop_config.machine code / Kết quả Tool / **Note Tool** = `toolResultNote` / **Khách hàng** = `userSku`) auto-scope theo factory chip đã chọn. 7 select filter dùng **faceted-search pattern**: BE nhận đủ facet, mỗi dropdown aggregate bằng `scopeMatch + (facetFilters trừ field hiện tại)` qua helper `buildFacetMatch(excludeKey)` — count phản ánh đúng cross-filter. Options trả trong `availableFilters` (thêm `toolResultNotes` + `users` — userSku giới hạn top 300 theo số đơn). Các facet **scope luôn thẻ xưởng** (flow/stats/breakdown đều dùng `cardMatch = matchMapped + facetFilters`) → vd. lọc theo khách hàng thì mỗi thẻ xưởng chỉ đếm đơn của khách đó; đồng thời lọc **bảng đơn chi tiết** (`getOrders`) + thu hẹp count các dropdown khác (cross-facet `buildFacetMatch`). Riêng chip factory/printStage/hasError chỉ áp cho bảng chi tiết + `availableFilters`, KHÔNG đổi thẻ xưởng (ma trận flow toàn cục). URL prefix `f` (`ftoolnote`, `fuser`).
  **Đơn chưa map xưởng (`factoryId` null/missing) KHÔNG còn hiện ở tab này** (đã bỏ chip "Chưa xác định xưởng" + `totals.unmapped`) — `matchMapped`/`cardMatch` mặc định chỉ tính đơn đã map. Xem toàn bộ đơn unmapped qua menu riêng **"Không xác định xưởng"** (`Orders.md §19`).
- **Bảng đơn** — cột "Xưởng (đang / gốc)" riêng + **compact grouped columns** (8 group từ `WORKSHOP_COLS`, xem `Orders.md §10.2a`) — cell inline edit theo permission
- **Bulk transfer** — checkbox row → toolbar `Send` mở Transfer dialog (chọn xưởng đích + lý do, tối đa 200 ký tự)
- **Xuất Excel** — bypass phân trang, gom toàn bộ đơn theo filter hiện tại + overview thành workbook .xlsx multi-sheet
- Date filters mặc định **= hôm nay** (`createdFrom = createdTo = todayISO()`) mỗi lần mount. Tên giữ là `createdFrom/createdTo` nhưng filter theo `orderAt` (ngày khách lên đơn) — xem `Orders.md §7.0`.

Data từ `GET /v1/orders/factory-overview` + `GET /v1/orders?sort=grouped&...` + `GET /v1/orders/export` (khi bấm Xuất Excel).

### Tab D — "Designer" (Phase Designer-Task-Workflow Phase 5)

**Chỉ hiển thị khi user có perm `page.designer_stats`** (DesignerLeader / Admin / Manager **+ Designer sub** — sub-designer cũng xem được thống kê toàn team). BE: 5 endpoint tab (`designer-stats.controller.ts`, const `LEADER_ROLES`) đã bao gồm `RoleType.Designer`. Xem `DesignerTaskWorkflow.md` để hiểu workflow tổng.

Layout (thứ tự render trên tab: **Bộ lọc chung → Tổng quan N ngày → panel drill-down inline (khi bấm số) → Cần gán designer → Ma trận toàn team → nút "Làm mới"**). **Period switcher + Leaderboard + Timeline + Error pie TẠM TẮT** — flag `SHOW_LEGACY_STATS = false` trong `DesignerStatsTab.tsx` (code giữ nguyên để bật lại), KHÔNG gọi 3 API `designer/performance` / `designer/timeline/:userId` / `orders/error-stats`. **Khối "Cơ cấu trạng thái" (§2b, `StatusBarCharts.tsx`) TẠM ẨN (2026-07)** — comment import + render trong `DesignerStatsTab.tsx` VÀ comment endpoint `GET /designer/product-breakdown` (CHỈ khối này dùng) trong `designer-stats.controller.ts`; file component + service `getProductBreakdown()` + DTOs shared + i18n giữ nguyên, bật lại theo ghi chú "TẠM ẨN" tại chỗ trong 2 file đó. Đánh số dưới đây theo nhóm chức năng, không theo thứ tự dọc:

**0. Bộ lọc chung sản phẩm + khách hàng + switcher ngày** (card `Filter` render **ĐẦU TIÊN trên cùng tab**):

- 2 dropdown `<SelectFilter>` (native select có count + typeahead): **Sản phẩm** (`order.type`) + **Khách hàng** (`order.userSku`). State `filterType`/`filterCustomer`, truyền **props `type`/`customer`** xuống StatusBarCharts + TeamDailyMatrix + DesignerDailyOverview + DesignerAssignBacklog.
- **Thanh ngày `<DateRangePicker variant="inline">`** (preset ngang full-width: Hôm nay · Hôm qua · 7/14/30 ngày · Tháng này · Tháng trước · Tùy chỉnh) — state `dateFrom`/`dateTo`, **mặc định 7 ngày gần nhất** (`last-7d`). Điều khiển **CẢ** `DesignerDailyOverview` VÀ `DesignerAssignBacklog` VÀ biểu đồ cột. Đã **bỏ nhóm nút 7/14/30 riêng** (model `rangeDays` cũ) — nay luôn gửi `from`/`to`; prop `days` truyền hằng `7` (BE bỏ qua khi có from/to). Xem `DateRangePicker-InlineRedesign.md`.
- Option list load từ `GET /v1/designer/breakdown-filters?from&to` — **refetch mỗi khi đổi khoảng ngày**, BE scope `buildProductTimeMatch` (đơn đã gán designer có `inProductionAt` trong [from,to] + loại hủy/chưa map xưởng) nên danh sách + count khớp đúng kỳ đang lọc (DTO `GetBreakdownFiltersDto`). Giá trị đang chọn không còn trong kỳ mới → FE tự reset về '' (tránh lọc rỗng ngầm). Nút **"Xóa lọc"** hiện khi có filter active.
- **Ảnh hưởng section 0b (tổng quan) + 0c (cần gán) + 2 (ma trận) + 2b (biểu đồ cột)** — KHÔNG ảnh hưởng Leaderboard/Timeline/Error pie (period switcher riêng).
- **Card "Top Designer"** (`TopDesigners.tsx`) nằm **bên phải card Bộ lọc chung**
  (flex row, cột phải `lg:w-80 xl:w-96`; mobile xuống dưới): top **3** designer
  theo tổng **Đã xong** trong scope filter chung (gọi riêng
  `GET /v1/designer/team-daily-breakdown` với from/to + type/customer, đọc
  `rows[].totals.done`, loại bucket `__inactive__`, chỉ lấy done > 0). Mỗi hàng:
  huy chương 🥇🥈🥉 + avatar chữ cái đầu (chưa có ảnh thật — API không trả avatar)
  - tên + progress bar tím (tỉ lệ so với hạng 1) + "N thiết kế". Refetch theo
    `matrixToken` (nút Làm mới).
- **Dòng chỉ số phụ mỗi hàng Top Designer** (đọc `rows[].metrics` — field optional
  của `TeamDailyRowZod`): 3 chip icon Lucide + số trên CÙNG 1 hàng (no-wrap),
  tooltip Radix qua `Hint forceRich` (bọc `TooltipProvider delayDuration=150`):
  `Package` "N SP" (số **LOẠI** sản phẩm khác nhau = distinct `order.type`,
  KHÔNG phải sum `quantity` — mỗi production = 1 sản phẩm nên sum quantity ≈ số
  task, vô nghĩa; **hover → liệt kê tên từng loại** từ `metrics.productTypeNames`,
  BE sort A→Z cap 30, dư hiện "+N loại khác") · `Zap` phản hồi TB · `Timer` làm
  TB (`metrics.totalTasks` vẫn trả về nhưng FE không hiển thị — đã bỏ chip task
  theo yêu cầu). BE (`getTeamDailyBreakdown`) chạy thêm 1
  aggregation song song cùng `$match` scope ma trận (`inProductionAt` trong kỳ +
  type/customer + loại đơn hủy/chưa map xưởng), group theo `assignee`:
  `totalTasks` + `typeSet` (`$addToSet type` → FE nhận `productTypes` đã đếm);
  `avgResponseMin`/`avgWorkMin` CHỈ trên task done — cùng công thức leaderboard
  `getPerformance` (response = `designerFirstStartedAt`||`designerStartedAt`
  − `designerAssignedAt`; work = `designerWorkMs` cộng dồn, fallback
  `completedAt − startedAt` legacy). Row `__inactive__` không có metrics. FE format
  `<60p → "Xp"`, còn lại `"XgYp"`; giá trị 0 (chưa có task done) hiển thị `—`.
  i18n `topDesigners.{productTypes,moreTypes,*Tip,durationMin,durationHourMin}`.
- **Nút "Xem tất cả"** (góc phải header card Top Designer, prop `onViewAll`/`viewAllOpen`)
  → toggle **panel "Thời gian theo sản phẩm"** (`ProductTimePanel.tsx`, render
  full-width NGAY DƯỚI hàng Filter+TopDesigners trong `DesignerStatsTab`, state
  `productTimesOpen`): bảng thời gian TB nhận/làm task theo TỪNG loại sản phẩm
  (`order.type`) của **TOÀN BỘ designer** trong kỳ lọc chung (from/to +
  type/customer, refetch theo `matrixToken`). Body scroll `max-h-[70vh]` +
  thead sticky, font `text-sm`. **Thanh filter nội bộ panel** (dưới header):
  CHỈ ô search sản phẩm (lọc client-side `visibleRows` theo tên type, không
  refetch) — khách hàng KHÔNG có select riêng, ăn theo filter chung của tab
  (prop `customer`). i18n `productTimes.{searchProductPlaceholder,noMatch}`. Cột: Sản phẩm (kèm **thumbnail mockup đại diện**
  `rows[].mockupUrl` = `$max mockupUrl` của loại đó, click → `ImagePreviewDialog`,
  `stopPropagation` khỏi toggle row) · Task · Đã xong ·
  `Zap` Nhận TB · `Timer` Làm TB — API `GET /v1/designer/product-time-overview`
  (`getProductTimeOverview()`: group `$type` cùng match scope ma trận qua
  `buildProductTimeMatch()`, time exprs dùng chung `designerTimeAggExprs()`/
  `designerTimeGroupFields()` với metrics Top Designer, sort taskCount desc).
  **Click 1 hàng sản phẩm** → expand inline **GOM THEO DESIGNER** (lazy-load
  1 lần, cache theo type trong state `orderRows`): mỗi designer 1 nhóm
  **tự mở rộng/thu gọn riêng** (button header, state `openDesigners` Set key
  `type::userId`, **mặc định THU GỌN** — reset khi refetch) — header chevron +
  `User` tên + badge "N đơn" + "xong M" + `Zap`/`Timer` TB **của riêng designer
  đó trên sản phẩm đó** (aggregation `$group assignee` trên TOÀN BỘ đơn khớp,
  không cap — field `designers[]` của response, sort taskCount desc); mở nhóm →
  TỪNG đơn của designer đó (viền trái tím): thumbnail `mockupUrl`
  (click → `ImagePreviewDialog`) + `productionId` + `UserRound` **khách hàng**
  (`rows[].userSku`) + `CalendarDays` **ngày vào SX**
  (`rows[].inProductionAt` ISO, FE format `DD/MM`) + `Zap`/`Timer` thời gian
  nhận/làm riêng mỗi đơn — API `GET /v1/designer/product-time-orders?type=...`
  (`getProductTimeOrders()`: `designers[]` + `rows[]` cap 300 đơn mới nhất theo
  `inProductionAt` có `assigneeId` để FE gom nhóm; thiếu đơn cũ hơn cap → dòng
  "... còn N đơn"; đơn chưa đủ mốc thời gian → `—`; `type=''` match đơn không
  có type). Cả 2 endpoint `@Auth(LEADER_ROLES)`. DTOs `ProductTimeRowZod`/
  `ProductTimeDesignerZod`/`ProductTimeOrderRowZod` + Get* DTOs trong
  `designer.dto.ts`. i18n block `productTimes.*` + nút `topDesigners.viewAll`.
- **2 cột "Level" + "Gợi ý" trong panel Thời gian theo sản phẩm** (độ khó
  sản phẩm 1..10, hiện ở cả chế độ Xem tất cả lẫn per-designer):
  - **Level** = `ProductConfig.level` sẵn có (badge màu `PRODUCT_LEVEL_MAP`
    ở `packages/shared/constants/product-level.ts` — CÙNG dữ liệu với trang
    chi tiết sản phẩm). BE map row→config theo `fullName` khớp `order.type`
    case-insensitive (cùng cách `importOrders`), fallback `productConfigId`
    (`$max`) trên đơn; load 1 query `productConfigModel.find({deletedAt
    $exists false}, {fullName, level})`. Row không có config → "—" + tooltip
    `noConfigTip` (phải tạo config trước). FE: SuperAdmin/Admin/Manager
    (mirror `@Auth` của `PATCH /product-configs/:id`, const
    `LEVEL_EDIT_ROLES`) thấy **select 1..10 nền màu level** đổi tại chỗ —
    tái dùng `RepositoryRemote.productConfig.updateProductConfig(id,
    {level})`, KHÔNG endpoint mới; role khác chỉ xem badge (`LevelBadge`).
  - **Gợi ý** (`suggestedLevel` + căn cứ `suggestDone`/`suggestAvgWorkMin`/
    `suggestReworkPct` trong `ProductTimeRowZod`) — BE
    `computeProductLevelSuggestions()`: thang **TƯƠNG ĐỐI** (percentile nội
    bộ, tự cân chỉnh, KHÔNG trừ hao tay nghề) trên cửa sổ **60 ngày CỐ ĐỊNH**
    toàn hệ thống (không theo kỳ lọc — đổi filter gợi ý không nhảy):
    `độ khó = 0.7 × percentile(thời gian làm TB) + 0.3 × percentile(tỉ lệ
    làm lại = Σ designerReworkCount / done)` → level `1 + round(độ khó × 9)`.
    Chỉ xét sản phẩm ≥ `PRODUCT_SUGGEST_MIN_DONE (5)` đơn xong trong cửa sổ
    (util `percentileOf` tie = TB thứ hạng, ≤1 phần tử → 0.5); thiếu dữ liệu
    → "—" + tooltip `suggestInsufficient`. FE: chip `→ n` viền màu level,
    hover tooltip căn cứ ("X đơn xong · làm TB Y · Z% làm lại"), Admin/Manager
    bấm chip → gán luôn level đó (chip mờ `opacity-40` khi đã trùng level
    chính thức). i18n `productTimes.{colLevel,colSuggest,levelSaved,
    noConfigTip,suggestTipTitle,suggestTip,suggestApplyTip,suggestInsufficient}`.
    Level này là nền cho auto-gán task khó/dễ theo `designerLevel` (chưa làm).
- **Bảng "Xếp hạng hiệu suất"** (`DesignerPerformanceCard.tsx`, render dưới
  hàng Filter+TopDesigners, theo kỳ lọc chung + refetch `matrixToken`): mỗi
  designer đang bật 1 hàng — **badge hạng S/A/B/C/D** (S≥85 teal · A≥70 xanh ·
  B≥55 vàng · C≥40 cam · D đỏ, util `rankFromScore` ở
  `packages/shared/enums/designer-rank.ts`) + **điểm 0-100** + **trend** so kỳ
  liền trước cùng độ dài (↑/↓) + **5 bar thành phần** (hover tooltip giải thích
  + số thô) + Xong/Nhận + cột **Level chính thức**. Công thức điểm (BE
  `getPerformanceScores` + `computePerfWindow`/`scorePerfWindow`, mỗi thành
  phần 0..1, 0.5 = trung bình team/thiếu dữ liệu): **tốc độ 30%** =
  `expectedMs/actualMs` trong đó expected = Σ(giờ TB của TEAM cho loại SP đó ×
  số đơn done theo loại) — chuẩn hóa theo ĐỘ KHÓ rổ sản phẩm, người làm hàng
  khó không bị thiệt; **chất lượng 25%** = 1 − tỉ lệ làm lại
  (`designerReworkCount`/done); **sản lượng 15%** = done so median team;
  **phản hồi 10%** = avgResponse so median team; **độ tin cậy 10%** = 1 − tỉ
  lệ bàn giao "Không làm được" (`designerRejections`); **chủ động 10%** = số
  lần TỰ "Nhận về mình" (OrderLog `field='assignee'` mà actor `userId` ===
  `after` — leader gán hộ không tính, trục thời gian `createdAt` của log;
  0 lần = 0.5 trung lập KHÔNG phạt, = median người-có-nhận → 0.75, gấp đôi →
  1). `done < minDone (10)` →
  `insufficient` (badge xám mờ "chưa đủ dữ liệu", trend null). API
  `GET /designer/performance-scores?from&to` (`@Auth(LEADER_ROLES)`), DTOs
  `PerformanceScoreRowZod`/`GetPerformanceScoresDto/Res` + enum `DesignerRank`.
  Card `onLoaded` đẩy rows lên `DesignerStatsTab.scoreRows` → **badge hạng
  cũng gắn cạnh tên trong widget Top Designer** (prop `scoreRows`, component
  `RankBadge` export từ card). i18n block `performance.*`. **Hướng dẫn nguồn
  số liệu**: nút `BookOpen` "Hướng dẫn" mở **DIALOG** (Radix Dialog, max-w-2xl
  scroll 85vh) viết bằng ngôn ngữ đời thường: intro thang điểm → dải 5 badge
  hạng kèm khoảng điểm + nhãn (Xuất sắc/Tốt/Khá/TB/Cần hỗ trợ) → 6 card thành
  phần (chấm màu khớp donut + chip "tối đa N điểm" + câu hỏi nó trả lời + cách
  đo + **ví dụ số cụ thể**) → mục Lưu ý (phạm vi/ngưỡng/trend/level). i18n
  `performance.guideDialog.*`. MỌI header cột vẫn có tooltip riêng (gạch chấm
  dưới chữ, hover) dùng string `performance.guide.*`.
  **Cột Thành phần 2 chế độ** (toggle icon `PieChart`/`BarChart3` trên header,
  state `vizMode`, mặc định donut): **donut** = conic-gradient thuần CSS
  (`ComponentDonut`, KHÔNG dùng recharts) — mỗi màu là số điểm thành phần đó
  ĐÓNG GÓP (component × trọng số × 100), phần xám = điểm thiếu tới 100, số
  điểm ở lỗ giữa, hover ra breakdown X/35, Y/25...; **bars** = 5 cột mini như
  cũ (tooltip từng cột kèm số thô).
- **Level chính thức designer (`UserEntity.designerLevel`, enum S-D)**: cột
  cuối bảng xếp hạng — Admin/SuperAdmin thấy select S/A/B/C/D/— (set/xóa qua
  `PATCH /designer/level/:userId` `@Auth([Admin])`, service `setDesignerLevel`
  validate role Designer; DTO `SetDesignerLevelDto/Res`) + **chip "Gợi ý: X"**
  = hạng từ điểm **rolling 60 ngày** (field `suggestedLevel`, null nếu thiếu
  dữ liệu; bấm chip → áp dụng làm level). Role khác chỉ xem badge. Field đã
  add vào CẢ 2 `$project` `getUserById` + `getMe` (Common_Pitfalls §1) +
  `UserZod.designerLevel`. Level này để SAU nối vào auto-gán task khó/dễ theo
  `productConfig.level` (chưa làm).
- **Nút "Xem chi tiết" per-designer** (icon `Eye` cuối mỗi hàng widget Top
  Designer, props `onViewDesigner`/`activeDesignerId`): mở CÙNG `ProductTimePanel`
  nhưng chế độ 1 designer — cả 2 endpoint nhận query `designerId` optional
  (`buildProductTimeMatch` ép `assignee = designerId`), title panel
  `productTimes.titleDesigner` kèm tên; drill sản phẩm chỉ có 1 nhóm designer →
  **tự mở sẵn** danh sách đơn (auto-add key vào `openDesigners` khi
  `designers.length === 1`). State `DesignerStatsTab.productTimesView`
  (`{designerId?, designerName?} | null` — `{}` = Xem tất cả); bấm lại nút đang
  active → đóng panel. i18n `topDesigners.viewDetail` +
  `productTimes.{titleDesigner,subtitleDesigner,customerTip}`.

**0c. Bảng "Cần gán designer"** (`DesignerAssignBacklog.tsx` — render **NGAY DƯỚI bảng tổng quan**; gom theo sản phẩm):

- **Pool:** `toolResultNote ∉ [null,'','ok']` (đã soát & ≠ ok) **VÀ** (`unassigned` / `rejected` / `rework chưa ôm` = rework + assignee rỗng).
- **Gom theo sản phẩm** (`productConfigId` → mockup/level/fullName; đơn chưa map → nhóm **"Chưa map"**). Mỗi nhóm header: checkbox chọn-cả-nhóm (tristate) + thu/mở + **ảnh mockup** (click → `ImagePreviewDialog`) + **badge level** + tên + count.
- **Mở nhóm** → bảng đơn **ĐẦY ĐỦ inline** (giống bảng workshop / drill-down §0b): checkbox chọn + **nhóm cột nghiệp vụ** `buildColGroups`/`GroupCellContent`/`WORKSHOP_COLS` (Mã đơn·Ưu tiên · Sản phẩm · Kết quả Tool · Xưởng·Vải·Máy · Trạng thái in · File lỗi · Lỗi xưởng · Người TH…). **Lazy-load per-nhóm** qua `GET /v1/orders/by-ids?ids=<CSV _id>` (`order.service.getOrdersByIds` — populate factory/machineType/productConfig, **KHÔNG scoping role** vì đơn CHƯA gán, nếu dùng `getOrders` role Designer sẽ bị lọc `assignee=self` → ẩn hết); cache theo `g.key` trong state `fullRows`, xóa khi refetch pool. Inline edit field qua `patchRow` (đổi state cục bộ), ảnh qua `openPreview`.
- **Chip đếm ngược hạn design** (`getStageDeadline(priority,'designer',inProductionAt)` + `formatCountdown`, đơn ở đây CHƯA chạy bước designer nên mốc = `inProductionAt`, xem `Orders.md §17.4`) gắn cạnh badge **Ưu tiên** trong group `identity` qua prop `extra` của `GroupCellContent`.
- **Chọn đơn lẻ / cả nhóm** → nút **"Gán design (N)"** mở `AssignDesignerDialog` (tái dùng preview + `bulk-assign-designer`). 2 nút **"Gán design"** / **"Nhận về mình"** **LUÔN hiển thị** (theo role), **mờ/`disabled` khi chưa chọn đơn nào** — không còn ẩn cả cụm khi selection rỗng; "Bỏ chọn" chỉ hiện khi có chọn. Gán xong → refetch bảng này + `onAssigned()` bump `matrixToken` → **Tổng quan refetch cập nhật số Tổng tồn/Chưa gán**.
- **Nút "Ghi nhớ cấu hình"** (CHỈ `SuperAdmin/Admin`, icon `BookmarkPlus`, disabled khi chưa tick): mở `RememberAssignConfigDialog` — gán ngay các đơn đang tick cho designer + tùy chọn ghi nhớ mapping sản phẩm→designer vào config auto-gán Ưu tiên 2 với hạn **Hiện tại / 1 ngày / 7 ngày / Vĩnh viễn** (mặc định Vĩnh viễn; hết hạn tự vô hiệu). Chi tiết `DesignerAutoAssign.md §2c`.
- Data từ `GET /v1/designer/assign-backlog?days=7|14|30` (+ `type`/`customer`). v1 trả full compact rows (thu/mở chỉ là UI).

**0b. Bảng "Tổng quan N ngày"** (`DesignerDailyOverview.tsx` — render **NGAY DƯỚI bộ lọc, TRÊN bảng cần gán**; nhận `days` từ switcher §0 (bỏ switcher nội bộ); cột = ngày `inProductionAt` VN, cũ→mới trái→phải; BE trả mới→cũ, FE `reverse()` days+rows):

- **10 hàng chỉ số** (cột cuối = Tổng) — **các hàng ok/chưa-soát/lỗi/tồn phân loại HOÀN TOÀN theo `toolResultNote`, KHÔNG theo `designerStatus`**:
  - **Tổng đơn** — tất cả đơn vào SX ngày đó (mọi trạng thái). `total`.
  - **Tổng xong** — `toolResultNote === 'ok'` (đã soát xong, không lỗi). `ok`. Màu emerald.
  - **Chưa soát** — `toolResultNote` rỗng/null. `unreviewed`.
  - **Soát lỗi** — `toolError` = đơn **TỪNG** bị người soát tool đánh note lỗi ≠ 'ok' — nguồn BỀN VỮNG **`toolCheckErrorNotes` non-empty** (xem `ToolCheckWorkflow.md`): số LỊCH SỬ, KHÔNG giảm khi đơn sửa về 'ok'; tự loại note='error' do In báo (đơn treo chưa soát lại) vì hook không ghi array. Ghi từ 3 đường: updateField/bulk + importRework + markToolCheckDone. Màu orange. Mỗi ô (kể cả cột Tổng) có **tooltip breakdown theo từng mã lỗi** (`toolErrorByNote` — BE group theo **mã MỚI NHẤT** của đơn = phần tử cuối `toolCheckErrorNotes`; mỗi đơn đúng 1 dòng → **tổng breakdown = con số ngoài ô**; cột Tổng cộng dồn client-side `allToolErrorBreakdown`) + dòng **Chưa gán designer** (`toolErrorUnassigned` = còn đang lỗi & assignee rỗng) + dòng **Đã sửa xong** (`toolErrorFixed` = note hiện tại đã về 'ok'). **TỪNG DÒNG tooltip bấm được** → drill: dòng mã lỗi = `toolErrorNote=<code>` (filter mới, $expr arrayElemAt -1); Chưa gán = `toolCheckedError=1&assignee=__none__&toolResultNote=<mã lỗi hiện tại>`; Đã sửa xong = `toolCheckedError=1&toolResultNote=ok` (hàm `openToolErrorLine`).
  - **OK/chưa soát → đẩy về** — `wasOkPushed` = đơn CHƯA TỪNG lỗi soát tool (`toolCheckErrorNotes` rỗng) nhưng đã vào flow designer (`designerStatus ∈ [assigned, in-progress, rework, done]`, gồm cả rework chưa ai ôm) — tức đơn ok/chưa soát bị công đoạn đẩy về, tính LỊCH SỬ (không giảm khi fix xong). Màu purple. Tooltip 2 dòng bấm được: Đã gán (`assignedWasOk`) / Chưa gán (`wasOkPushed − assignedWasOk`).
  - **Chưa gán designer** — `unassignedNeed` = pool cần designer (`toolCheckErrorNotes` non-empty ∨ `designerStatus ∈ 4`) & chưa gán & **ĐANG lỗi (note set ≠ 'ok')** — KHÔNG tính đơn đã về ok. Màu teal. Tooltip 3 dòng bấm được: Từ soát lỗi (`unassignedNeedTool`) / OK-chưa soát đẩy về (`unassignedNeed − unassignedNeedTool`) / **Đã xử lý không cần designer** (`unassignedResolved` = pool & chưa gán & note đã về ok/rỗng — giữ để bất biến vẫn đối soát được).
  - **Đã gán designer** — `assignedToolError + assignedWasOk` = tổng đơn ĐÃ GIAO cho designer (assignee set + `designerStatus ∈ 4` — MIRROR match của `getTeamDailyBreakdown`) → **KHỚP CHÍNH XÁC hàng "Tổng / ngày" của bảng "Tất cả designer theo ngày"** từng cột ngày. Màu indigo, sub-label "= Tổng/ngày bảng designer". Tooltip 2 dòng bấm được: **Từ soát lỗi** (`assignedToolError`) + **OK/chưa soát → đẩy về** (`assignedWasOk`). Tooltip hàng Soát lỗi cũng có dòng "Đã gán designer" (= `assignedToolError`).
  - **Design đã xong** — `designDone` = assignee set + `designerStatus='done'` (⊂ Đã gán designer — khớp cột "Đã xong" ma trận team). Màu emerald. Drill `assignee=__any__&designerStatus=done`.
  - **BẤT BIẾN đối soát:** `Soát lỗi + OK/chưa soát → đẩy về = Đã gán designer + Chưa gán designer + Đã-xử-lý-không-cần-designer (dòng tooltip)` (đúng từng ô ngày + cột Tổng) và `Đã gán designer = Tổng/ngày ma trận team`.
  - **Tổng lỗi** — `toolError + wasOkPushed` (tính client-side) = **Soát lỗi + OK/chưa soát → đẩy về** — tổng đơn từng có lỗi cần designer, LỊCH SỬ (2 nguồn không giao nhau nên luôn khớp đúng tổng 2 hàng trên). Tooltip 2 dòng bấm được (mở đúng drill 2 hàng nguồn); bấm ô → drill `needDesigner=1` (toàn pool). LƯU Ý: KHÔNG còn quan hệ với Tổng tồn (Tổng tồn là snapshot hiện tại); field `error` (đang lỗi) vẫn trả về trong DTO, chỉ hiển thị ở header panel xổ Tổng tồn ("= Chưa soát + Đang lỗi").
  - **Tổng tồn** — **UNION lăng kính designer**: chưa soát (note rỗng) ∨ đã gán chưa xong (assignee + status assigned/in-progress/rework) ∨ đang lỗi chưa gán (`unassignedNeedCond`) — đơn thuộc 2 nhóm chỉ đếm 1 lần. Công thức hiển thị: `Tổng tồn ≈ Chưa soát + (Đã gán − Design đã xong) + Chưa gán designer` (bằng chính xác khi không có đơn chưa-soát-nhưng-đã-gán). Drill = filter mới `designBacklog=1` (mirror union). **Click hàng → xổ bảng con**: header hiện công thức trên + bảng `backlogByDesigner` (designer × Cần làm/Đang làm/Làm lại, theo `designerStatus`) + dòng "Chưa gán" (`unassignedBacklog` = `designerStatus=unassigned`); ẩn designer tồn = 0.
- **Bất biến sạch:** `Tổng tồn ≈ Chưa soát + (Đã gán − Design đã xong) + Chưa gán` (union — lệch đúng bằng số đơn chưa-soát-nhưng-đã-gán, hiếm). Bất biến cũ `Tổng đơn = Tổng xong + Tổng tồn` KHÔNG còn (Tổng tồn đã đổi sang lăng kính designer).
- **Drill-down (bấm con số → panel INLINE, KHÔNG còn dialog):** MỌI con số > 0 (10 hàng chỉ số + cả bảng con "Tồn theo designer") đều click được → đổ vào **`<DesignerDrillPanel>`** (`apps/web/src/pages/home/DesignerDrillPanel.tsx`) — panel hiện **NGAY DƯỚI card Tổng quan, TRÊN bảng "Cần gán designer"** (sibling qua `space-y` của tab; auto `scrollIntoView`), có tiêu đề + nút Đóng; bấm con số khác → panel thay nội dung. **Thanh thống kê + filter nội bộ** (`FacetBar` — dưới header): 2 hàng chip **Designer** (per-assignee + "Chưa gán", resolve tên qua `designerTeamStore`) và **Khách** (per-`userSku`), mỗi chip = giá trị · count; bấm lọc / bấm lại bỏ; **cross-facet client-side** (count chiều này tính trên rows đã lọc bởi chiều kia), lọc trên tập rows đã fetch (≤500), reset khi đổi con số; header hiện "đang lọc: N đơn". Bảng đơn **gom nhóm theo SẢN PHẨM giống `DesignerAssignBacklog`** (header nhóm: mockup click preview + badge level + tên + count; **mặc định THU GỌN mọi nhóm** — bấm nhóm mới mở → bảng cột workshop `buildColGroups`/`GroupCellContent`, inline edit theo quyền + nút Lịch sử `OrderLogTimelineDialog`; nhóm build client-side theo `productConfigId`, đơn chưa map → nhóm "Chưa map"). **Đơn CHƯA map** → nút **"Gán xưởng"** (amber, chỉ `isAdmin || order.transfer`) cạnh ô Xưởng (qua `extra` của `GroupCellContent`) → mở `AssignFactoryDialog` (**export từ `OrderFactoryTab.tsx`**, prop `factories: AssignFactoryOption[]` — panel map từ `GET /v1/factories` lazy-load; `OrderFactoryTab` vẫn truyền `overview.factories`); gán xong → panel refetch (giữ nguyên nhóm đang mở, chỉ thu gọn khi đổi con số). **Fetch qua `GET /v1/orders/overview-list` — KHÔNG scoping theo role** nên **mọi role thấy cùng tập đơn khớp con số như admin** (con số overview là team-wide/unscoped; nếu dùng `GET /orders` thì role Designer bị ép `assignee=self`, Fulfillment bị scope xưởng → ra rỗng); fetch 1 lần `limit=500` (total > 500 → chú thích "hiển thị N đơn đầu"). `getOrders` populate thêm `productConfig (fullName/shortName/mockup/level)` để panel có ảnh/level nhóm. Cột hiển thị vẫn **lọc theo quyền** qua `canViewField`. Query build client-side (param `createdFrom`/`createdTo` = lọc `inProductionAt`; `sort=grouped`; + `type`/`customer` từ bộ lọc chung), map metric → `toolResultNote`:
  - Ô ngày → `createdFrom=createdTo=day`; ô cột **Tổng** → `days[0]..days[last]` (cả kỳ).
  - **Tổng đơn** = không lọc note · **Tổng xong** = `toolResultNote=ok` · **Chưa soát** = `toolResultNote=__none__` · **Soát lỗi** = `toolCheckedError=1` (filter `GetProductionOrdersZod` enum '1'/'0' → `'toolCheckErrorNotes.0': {$exists:true/false}` — khớp chính xác aggregation) · **OK/chưa soát → đẩy về** = `toolCheckedError=0&designerStatus=assigned,in-progress,rework,done` (+ `assignee=__any__/__none__` khi bấm dòng tooltip Đã gán/Chưa gán) · **Chưa gán designer** = `needDesigner=1&assignee=__none__&toolResultNote=<mã lỗi>` (filter `needDesigner` = pool `toolCheckErrorNotes` non-empty ∨ `designerStatus ∈ 4`; kèm mã note lỗi để CHỈ ra đơn đang lỗi; dòng Từ soát lỗi = `toolCheckedError=1&...`; dòng Đã-xử-lý = `needDesigner=1&assignee=__none__&toolResultNote=ok`) · **Đã gán designer** = `assignee=__any__&designerStatus=assigned,in-progress,rework,done` (token `__any__` = đơn đã gán bất kỳ ai; + `toolCheckedError=1/0` khi bấm dòng tooltip Từ soát lỗi / OK-đẩy-về) · **Tổng lỗi** = `needDesigner=1` (toàn pool; 2 dòng tooltip mở drill của hàng Soát lỗi / OK-đẩy-về) · **Tổng tồn** = `designBacklog=1` (union 3 nhóm — filter mới, mirror aggregation). Số trên hàng "Tổng tồn" `stopPropagation` để không toggle bảng con.
  - Bảng con "Tồn theo designer": ô Cần làm/Đang làm/Làm lại/Tổng click được → `getOrders?assignee=<userId>&designerStatus=assigned|in-progress|rework[,...]` (cùng range `inProductionAt` cả kỳ). Dòng "Chưa gán" **không** click (lăng kính `designerStatus=unassigned` lệch filter `getOrders`).
- **Chế độ chọn + gán trong panel (2026-07, CHỈ drill hàng "Chưa gán designer"):** `DrillTarget.selectable=true` (set ở `openUnassignedNeed` các kind `all`/`tool`/`wasOk` — KHÔNG bật cho dòng "đã xử lý không cần designer" vì đơn đã về 'ok'). Panel hiện **checkbox chọn đơn** (per-row + tristate per-nhóm sản phẩm) + thanh nút **GIỐNG HỆT bảng "Cần gán designer"**: "Nhận về mình" (`Designer/DesignerLeader` → `claimDesignerTasks`), "Gán design" (`SuperAdmin/Admin/Manager/DesignerLeader` → `AssignDesignerDialog`), "Ghi nhớ cấu hình" (`SuperAdmin/Admin` → `RememberAssignConfigDialog`, xem `DesignerAutoAssign.md §2c`), "Tự động gán" (phạm vi = toàn bộ đơn đang hiển thị trong panel SAU filter chip, qua `AutoAssignPlanDialog` — component tách chung từ backlog, `apps/web/src/components/orders/AutoAssignPlanDialog.tsx`). Gán xong → panel tự refetch (`reloadKey`) + `onMutated` → `DesignerDailyOverview.onAssigned` → bump `matrixToken` ở `DesignerStatsTab` (bảng Tổng quan + "Cần gán" + ma trận cùng cập nhật số). i18n tái dùng `dashboard:assignBacklog.*`.
- Data từ `GET /v1/designer/daily-overview?days=7|14|30` (+ `type`/`customer` từ bộ lọc chung). Row + `columnTotals` có thêm **`errorUnassigned`** + **`toolError`/`toolErrorFixed`/`toolErrorUnassigned`** (+ row-level `toolErrorByNote`) + **`assignedToolError`/`assignedWasOk`/`wasOkPushed`/`unassignedNeed`/`unassignedNeedTool`/`unassignedResolved`/`designDone`** — ĐÃ BỎ `errorTotal`, `stageError/stageErrorTotal`, `errorAssignedPending/errorReworkPrevError/errorReworkWasOk` (DTO `DailyOverviewRowZod`/`DailyOverviewColumnTotalsZod`, agg trong `DesignerStatsService.getDailyOverview`). Nhận `reloadToken` (= `matrixToken`). Seq-guard chống race.
- **Lưu ý QA:** bảng con "Tồn theo designer" là **lăng kính `designerStatus`** (chỉ đơn ĐÃ gán ở assigned/in-progress/rework + dòng Chưa gán; **rejected/"Không làm được" KHÔNG tính**) → tổng của nó (`backlogGrand`) **có thể lệch** với "Tổng tồn" (theo Tool, gồm cả đơn chưa soát chưa ai xử lý). Đã ghi chú rõ trong header bảng con. Số "Chưa soát" hiển thị luôn để đối chiếu.

**1. Leaderboard table** — **TẠM TẮT** (`SHOW_LEGACY_STATS=false`, không gọi `GET /v1/designer/performance`; code giữ nguyên) — (`<Table>` shadcn) sort theo `completedInPeriod` desc, auto-include sub-designer chưa có task (row count 0):

| Cột                                       | Mô tả                                                                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #                                         | Rank                                                                                                                                                                                                                   |
| Designer                                  | fullName + email                                                                                                                                                                                                       |
| Cần làm / Đang làm / Đã xong / **Đã sửa** | Snapshot count theo `designerStatus`; **Đã xong** = `completedInPeriod − fixedInPeriod` (hoàn thành không lỗi trong period); **Đã sửa** (`fixedInPeriod`, teal) = hoàn thành sau khi sửa lỗi (`designerReworkCount>0`) |
| Trả (hiện) / L.lại (hiện)                 | Snapshot — task đang ở status rejected/rework                                                                                                                                                                          |
| **Tổng trả / Tổng l.lại**                 | **Cumulative** — đếm số LẦN transition tới rejected/rework trong period từ OrderLog (kể cả task đã chuyển trạng thái sau đó)                                                                                           |
| Avg phản hồi                              | Trung bình `designerFirstStartedAt − designerAssignedAt` (phút). Fallback `designerStartedAt` cho legacy.                                                                                                              |
| Avg làm                                   | Trung bình `designerWorkMs` (cumulative cycle-by-cycle). Fallback `designerCompletedAt − designerStartedAt` cho legacy.                                                                                                |
| Tỉ lệ lỗi                                 | `designerReworkCount` trung bình / completed → badge color (xanh / vàng / đỏ)                                                                                                                                          |

Click row → set `selectedUserId` → reload timeline chart.

**2. Ma trận toàn team × ngày** (`TeamDailyMatrix.tsx` — component riêng, **render ĐẦU TIÊN trên cùng tab**, trên cả period switcher & Leaderboard):

- **Mục đích:** thấy **MỌI designer theo thời gian + trạng thái** cùng lúc (Leaderboard chỉ có tổng, Timeline chỉ 1 designer). **Snapshot lens theo `inProductionAt`** (giống panel `/my-tasks` §`DesignerTaskWorkflow.md 4.2b` nhưng scope toàn team).
- **Switcher `7/14/30 ngày` RIÊNG** (state `range` nội bộ, độc lập period switcher của tab) — tránh custom range sinh quá nhiều cột. Seq-guard chống race.
- **Bảng ma trận full-width** (`table w-full` → cột ngày **giãn hết chiều rộng** khi ít ngày; nhiều ngày → cuộn ngang): cột trái **sticky = Designer** (tên + "chưa xong N · xong M"), header **sticky = các ngày** theo chiều **cũ→mới (quá khứ→hiện tại), trái→phải** (BE trả mới→cũ, FE `reverse()` cả `days`+`cells`+`columnTotals`). Mỗi ô = **5 số mini `Cần làm·Làm lại·Đang làm·Đã xong·Không làm được`** (assigned·rework·inProgress·done·**rejected**, màu zinc/amber/indigo/emerald/rose) + badge **`+N` (received, sky)** khi có nhận bàn giao thêm — **BẤT BIẾN: Tổng đã nhận = 5 số cộng lại** (`rejected`/`received` = số LẦN bàn giao đếm từ event `designerRejections` unwind theo fromUserId/toUserId, cùng scope + day theo `inProductionAt`; `received` ĐÃ nằm trong 5 số của người nhận nên KHÔNG cộng riêng — tooltip ghi rõ). Nền heatmap amber theo tổng chưa xong của ô (done/rejected/received KHÔNG ảnh hưởng nền); ô rỗng = `·`. Row label thêm "đã nhận T" (+ k.làm được/nhận khi >0); grand strip thêm `Không làm được` + `Nhận thêm` + `Tổng đã nhận`; title attr mỗi ô hiện đầy đủ công thức. **Mỗi con số có tooltip riêng** — dùng **Radix `Hint forceRich`** (bọc `TooltipProvider` ở root component; **KHÔNG** dùng native `title` vì không hiện ổn định) nội dung `"Cần làm/Cần làm lại/Đang làm/Đã xong: N"`. Footer sticky `Tổng/ngày` cũng hiện **4 số breakdown**. Grand summary strip trên đầu.
- **Sort designer theo `unfinished` desc** (ai tồn nhiều lên đầu), rồi done desc, rồi tên.
- **Scope ĐỒNG BỘ bảng Tổng quan** (từ 2026-07): match thêm `cancelledAt: null` + `factoryId $exists/$ne null` (loại đơn hủy + chưa map xưởng), `assignee $nin [null,'']`; đơn gán cho **designer đã tắt / ngoài team** KHÔNG bị bỏ nữa mà gộp vào dòng **"Khác (designer đã tắt)"** (uid ảo `__inactive__`) → bất biến: `Tổng/ngày = assignedToolError + assignedWasOk` (hàng "Đã gán designer" bảng Tổng quan) đúng từng ngày.
- Data từ `GET /v1/designer/team-daily-breakdown?days=7|14|30`. Refetch khi bấm Refresh của tab (prop `reloadToken` = `matrixToken` bump trong `fetchAll`) **hoặc khi đổi bộ lọc chung** (props `type`/`customer` → thêm vào query `&type=&customer=`).
- **Lưu ý window:** đếm `inProductionAt ∈ [today−(N−1)..today]` → đơn tồn ngoài N ngày ẩn; dùng 14/30 để mở rộng. `done` gộp theo `inProductionAt` (KHÁC "completed in period" của Leaderboard dùng `designerCompletedAt`).

**2b. Biểu đồ cột cơ cấu trạng thái — ⚠️ TẠM ẨN (2026-07, xem ghi chú đầu Tab D)** (`StatusBarCharts.tsx` — 1 card có **toggle**, render **ĐẦU TIÊN trên cùng tab**, trên cả ma trận; Recharts `BarChart` stacked):

- **Toggle "Theo designer / Theo ngày"** — 1 khu vực biểu đồ, 2 chế độ, chung bộ màu 4 trạng thái (Cần làm zinc `#71717A` · Cần làm lại amber `#F59E0B` · Đang làm indigo `#6366F1` · Đã xong emerald `#10B981`) + legend + custom tooltip (hover hiện **số lượng + %** từng trạng thái + Tổng).
- **Breakdown sản phẩm mode "Theo designer":** dữ liệu = sản phẩm designer được gán (mọi đơn assigned/in-progress/rework/done) **theo bộ lọc chung tab** (days/from/to + type/customer), mỗi sản phẩm = **ảnh mockup + badge level** (ProductConfig) + **số đơn**. Data từ `GET /v1/designer/product-breakdown` (props `filterDays`/`filterFrom`/`filterTo`; map `userId → {products,total}`; `designerData` có `userId`).
  - **Hover tooltip (recharts):** rê vào cột → tooltip hiện count/% + **TẤT CẢ sản phẩm** (không giới hạn chiều cao / không scroll — vì tooltip recharts bám con trỏ, rê vào để cuộn sẽ mất). `ChartTooltip` nhận prop `breakdown` (map `userId→{products,total}`), tra cứu qua `payload[0].payload.userId` (đã thêm `userId` vào `designerData`).
  - **Lưu ý:** breakdown dùng bộ lọc chung, có thể KHÁC date-range riêng của cột (bars). Nếu 1 designer có quá nhiều sản phẩm tooltip sẽ cao.
  - **Theo designer:** mỗi **cột = 1 designer** (chỉ người có đơn), **stack 100%** (`stackOffset="expand"`, YAxis %) → xong hết = 100% xanh. Có **date-range RIÊNG** (`DateRangePicker`, mặc định 30 ngày) → gọi `team-daily-breakdown?from=&to=`, lấy `rows[].totals`.
  - **Theo ngày:** mỗi **cột = 1 ngày** (cũ→mới trái→phải), **stack số lượng** (`stackOffset="none"`) → thấy khối lượng/ngày. Switcher **7/14/30** + dropdown **lọc theo người** (Tất cả = `columnTotals`; 1 người = `rows[].cells`). Gọi `team-daily-breakdown?days=`.
- **Bấm cột 1 designer (mode "Theo designer") → panel "thống kê 7 ngày"** hiện dưới biểu đồ (`WeekStatsPanel` cùng file; click bắt qua `BarChart onClick` → `activePayload.userId`; auto `scrollIntoView`; nút Đóng): header tên designer + **6 chip tổng** (4 trạng thái + **Không làm được** rose + **Nhận thêm** sky — `PANEL_ROWS = STATUS + EVENT_ROWS`) + **bảng 6 hàng × 7 ngày** (cột = ngày cũ→mới + Tổng) + **bảng sản phẩm designer làm trong 7 ngày** (mockup + badge level + tên + count, max-height scroll). 2 hàng sự kiện đọc `cells[].rejected/received` (số LẦN bàn giao — khớp ma trận). **MỌI con số > 0 (ô ngày + cột Tổng + chip) bấm được** → `DesignerDrillPanel` inline dưới panel (target `{title, query}` → `GET /orders/overview-list`): hàng trạng thái query `assignee=<userId>&designerStatus=<db-value>` (map `STATUS_DB` vì key `inProgress` ≠ `'in-progress'`), hàng sự kiện query `rejectedBy=<userId>` / `receivedBy=<userId>`; đều kèm `createdFrom/createdTo` (1 ngày hoặc cả cửa sổ 7 ngày) + `type`/`userSku` bộ lọc chung + `sort=grouped`. Title drill hàng sự kiện ghi "(N lần — 1 đơn bàn giao nhiều lần chỉ 1 dòng)" + footnote dưới bảng giải thích lần vs đơn. Drill reset khi đổi designer/bộ lọc chung. Data RIÊNG **LUÔN 7 ngày gần nhất** (`team-daily-breakdown?days=7` + `product-breakdown?days=7`, kèm `type`/`customer` bộ lọc chung) — KHÔNG theo date-range của biểu đồ (mặc định 30 ngày); cache 1 lần, reset khi đổi bộ lọc chung.
- Cả 2 chế độ tái dùng **cùng endpoint** `GET /v1/designer/team-daily-breakdown` (đã bổ sung nhận `from`/`to` + `type`/`customer`; range tùy chỉnh cap 100 cột nhưng `totals` tính TRỰC TIẾP từ agg nên luôn đúng dù cap). Nhận props `type`/`customer` từ bộ lọc chung (§0) → refetch khi đổi. Fetch độc lập, seq-guard chống race.

**3. Timeline per-designer** — **TẠM TẮT** (`SHOW_LEGACY_STATS=false`, không gọi `GET /v1/designer/timeline/:userId`) — (Recharts `LineChart`, 4 series: assigned / started / completed / rework):

- Dropdown chọn designer (default = top leaderboard)
- Bucket per-day timezone Asia/Ho_Chi_Minh, fill mọi ngày trong period kể cả 0
- 4 line colors: zinc / indigo / emerald / amber
- Data từ `GET /v1/designer/timeline/:userId`

**4. Error source pie + breakdown** — **TẠM TẮT** (`SHOW_LEGACY_STATS=false`, không gọi `GET /v1/orders/error-stats`) — (Recharts `PieChart`):

- 3 slice: designer (violet) / factory (sky) / unknown (slate) — split theo `order.productionErrorSource`
- List dưới: từng productionError code với count + dot color theo source
- Data từ `GET /v1/orders/error-stats`

**Period switcher** `today | 7d | 30d | custom` — **TẠM ẨN cùng 3 khối legacy** (chỉ phục vụ Leaderboard + Timeline + Error pie; thay bằng nút **"Làm mới"** bump `matrixToken`). Custom có **`<DateRangePresets>`** (Hôm nay/Tuần này/Tháng này… từ `utils/dateRangePresets.ts`) + 2 date input. **Bảng Tổng quan + Cần gán + Ma trận KHÔNG dùng period này** — dùng switcher 7/14/30 ở Bộ lọc chung (hoặc riêng của ma trận).

---

## 2. Luồng hoạt động

### 2.1 Khởi tạo

```
User vào /dashboard
  → fetchDashboard({ startDate, endDate, searchType, searchUser })
  → BE: 1 aggregate pipeline trả về { totals, byType, byFactory, byUser, filter }
  → FE memoize chartData, mergedFactory, topUsers theo state
  → Render 4 sections song song
```

### 2.2 Đổi filter

```
User chọn date range / nhập search type / nhập search user / chọn Top N
  → debounce 300ms (search) hoặc immediate (date / topN)
  → Re-fetch dashboard
  → Skeleton loader hiển thị trong khi chờ
```

### 2.3 Hover pie chart (drill-down xưởng)

```
User di chuột vào 1 slice xưởng
  → activeShape lift slice + halo background
  → Side panel hiển thị danh sách loại máy của xưởng đó (machineTypeBreakdown)
  → Move ra ngoài → reset
```

---

## 3. API: `GET /v1/orders/dashboard`

### 3.1 Query params

| Param        | Type            | Mặc định           | Mô tả                                         |
| ------------ | --------------- | ------------------ | --------------------------------------------- |
| `startDate`  | ISO date string | đầu tháng hiện tại | Bao gồm                                       |
| `endDate`    | ISO date string | hôm nay            | Bao gồm cuối ngày                             |
| `searchType` | string          | —                  | Substring tên product type (case-insensitive) |
| `searchUser` | string          | —                  | Substring `userSku` hoặc `userEmail`          |

### 3.2 Response shape

```ts
{
  totals: {
    totalOrders: number;
    totalQuantity: number;
    totalProductionCost: number;
    totalShippingCost: number;
    totalCost: number;
    cancelledOrders: number;  // đơn HỦY (đã LOẠI khỏi mọi số liệu trên; đếm riêng cùng scope + inProductionAt)
  },
  byType: TypeSummary[];      // Bảng "Group by Production Type"
  byFactory: FactoryBreakdown[]; // Pie chart + drill-down
  sizeMatrix: SizeMatrixRow[]; // Bảng pivot size, group theo (factory, type) → sizes[]
  factoryOptions: FactoryOption[]; // Options dropdown xưởng — nguồn bảng `factories`, KHÔNG suy từ đơn
  byUser: UserBreakdown[];    // Top users card
  filter: { startDate, endDate, searchType, searchUser }
}

// SizeMatrixRow = { factoryId?, factoryName, type, sizes: { size, count }[] }
// BE: aggregate $group {factoryId, type, size} → $lookup factories → gom (factory,type).
```

---

## 4. UI Components

### 4.1 Filter bar (top)

| Field             | Component                | Mô tả                                          |
| ----------------- | ------------------------ | ---------------------------------------------- |
| Khoảng thời gian  | shadcn `DateRangePicker` | Preset: hôm nay / 7 ngày / 30 ngày / tháng này |
| Tìm theo sản phẩm | shadcn `Input`           | Substring match cho `type`                     |
| Tìm khách hàng    | shadcn `Input`           | Match `userSku` hoặc `userEmail`               |
| Top N             | shadcn `Select`          | 3 / 5 / 10 / All                               |

### 4.2 Metric cards (4 ô uniform nhỏ)

- Card style: `rounded-lg`, `border-border`, `px-3 py-2.5`, h=68px
- Icon size 14 + nhãn 11px + giá trị 18px `tabular-nums`
- Skeleton khi loading

| Card           | Source                       | Format       |
| -------------- | ---------------------------- | ------------ |
| Đơn hàng       | `totals.totalOrders`         | `12,345`     |
| Sản phẩm       | `totals.totalQuantity`       | `12,345 cái` |
| Chi phí SX     | `totals.totalProductionCost` | `$12,345.67` |
| Phí vận chuyển | `totals.totalShippingCost`   | `$12,345.67` |

**Card "Đơn đã hủy"** (`Ban`, đỏ khi >0) hàng riêng dưới lưới KPI = `totals.cancelledOrders` — bấm mở `CancelledOrdersDialog` (`GET /orders/cancelled-list?from&to&factoryId`) xem danh sách đơn hủy. Đơn hủy đã bị **loại khỏi toàn bộ số liệu** dashboard/công đoạn (chỉ còn hiện ở bảng đơn chính với badge). Xem `documents/Plans/CancelledOrders-ExcludeFromStages.md`.

### 4.3 FactoryDistribution (pie chart)

- Header: icon **Factory** (sky-100 box) + tiêu đề "Phân bổ theo xưởng"
- Recharts `PieChart` + `Pie` với `activeShape` lift + halo
- Click-disable focus outline (CSS override trong `globals.css`)
- `PIE_COLORS` — bảng màu tonal desaturated (không rainbow)
- Side panel: di chuột vào slice → hiển thị `byMachineType[]` với % và quantity

### 4.4 Group by Production Type table

- Layout: **CSS Grid div** (không phải `<table>`) để `position: sticky` scope đúng
- Sticky header row + sticky summary row khi expand
- `content-visibility: auto` cho rows ngoài viewport (perf)
- Expand row hiển thị:
  - **Sizes**: sort theo `sizeRank` (XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL)
  - **Mockups duy nhất**: ảnh + count
  - **Mockup trùng**: ảnh + count (mockups xuất hiện ≥ 2 đơn)
- Mỗi mockup click → mở `ImagePreviewDialog` (display URL + original URL)

### 4.5 TopUsersCard

- Header: icon **Crown** (violet-100 box) + tiêu đề "Khách hàng top đơn"
- Mỗi row:
  - `RankBadge` (Medal vàng/bạc/đồng cho 1/2/3, số plain cho 4+)
  - Avatar tròn 32px với initial 2 ký tự (màu hash từ tên)
  - Tên (truncate) — `displayName` lấy từ `userSku || userEmail`
  - Email subtitle 11px (chỉ hiện khi `userEmail !== displayName`)
  - Quantity badge bên phải + tổng chi phí
  - Progress bar violet (% so với user top 1)

---

## 5. Backend aggregation logic

### 5.1 Pipeline `getDashboard()`

```
match chung: { inProductionAt between [startDate, endDate] (nếu có), type ~ searchType,
               $or [userSku ~ searchUser, userEmail ~ searchUser], cancelledAt $exists:false,
               factoryId scope (Fulfillment/factoryId tường minh/productionFactoryClause) }
8 truy vấn ĐỘC LẬP chạy SONG SONG qua Promise.all (2026-09 — trước đây await tuần tự, ~4.5s):
  countDocuments cancelled + countDocuments held
  totals: $group { _id: null, totalOrders, totalQuantity, totalProductionCost, totalShippingCost }
  byType: $group by type → min/max/sum cost + $push rows (size/mockup) → post-process JS
  byFactory: $group (factoryId, machineTypeId) → $lookup factories + machineTypes → tính %
  sizeMatrix: $group (factoryId, type, size) → $lookup factories
  byUser: $group by userEmail||userSku → $sort orderCount desc
  listFactoryOptions()
```

### 5.2 Helper functions

- **`sizeRank(size)`**: map S/M/L/XL/2XL/3XL/4XL/5XL → số để sort
- **`processDesigns(designs)`**: transform Drive URL → Teehub CDN URL + giữ lại original

### 5.3 Cache

- **Hiện TẮT** — các block đọc/ghi Redis trong `getDashboard` đang comment `[cache disabled]`;
  tốc độ dựa vào việc chạy song song 8 truy vấn (§5.1). Bật lại cache = mở comment 2 block đó.

---

## 6. Performance notes

| Tối ưu                     | Vị trí                                   | Mục đích                             |
| -------------------------- | ---------------------------------------- | ------------------------------------ |
| `React.memo`               | `MetricCard`, `RankBadge`, `TopUserRow`  | Tránh re-render khi parent thay đổi  |
| `useMemo`                  | `chartData`, `topUsers`, `mergedFactory` | Tính toán nặng chỉ chạy khi deps đổi |
| `useCallback`              | `onPieHover`, `setActiveIndex`           | Stable ref cho child memo            |
| `content-visibility: auto` | Bảng byType khi expand                   | Browser skip render off-screen rows  |
| Native `title` attribute   | Tooltip mockup                           | Nhẹ hơn Radix Tooltip x100 lần       |
| Redis cache 60s            | API dashboard                            | Tránh aggregate lặp lại              |

---

## 7. Permissions

Page mở cho mọi role có `page.dashboard` (Admin, Manager, Support, Designer, Fulfillment). Decorator BE: `@Auth(ORDER_VIEW_ROLES)` cho 3 endpoint `dashboard` / `status-overview` / `factory-overview` / `export`.

Tab C — **chuyển xưởng** (`/:id/transfer`, `/bulk-transfer`) gắn `@Auth(ORDER_WRITE_ROLES)` (SuperAdmin / Admin / Manager / Support). FE check thêm bằng `isAdmin || has('order.transfer')` để ẩn checkbox + nút bulk transfer khỏi Designer/Fulfillment.

**Scope theo xưởng cho Fulfillment (mọi tab Dashboard):** tài khoản role `Fulfillment` **chỉ thấy đơn xưởng mình** trên cả 3 tab data (`getDashboard` Stats, `getStatusOverview` tab B, `getFactoryOverview` tab C) — controller truyền `user?.factoryId` + `user?.fulfillmentStage`:

- **Stage In (print)**: thấy **mọi trạng thái** (bỏ `readyForFulfill`, gồm đơn lỗi/chưa ready) nhưng scope `factoryId = user.factoryId` (equality, không gồm `originalFactoryId`).
- **Stage khác** (Ép/QC/May/Đóng): `readyForFulfill=true` + (`factoryId` hoặc `originalFactoryId` = xưởng mình).

Phân biệt qua helper `OrderService.isPrintAdminView(roleName, fulfillmentStage)`. `getDashboard` gộp factory-scope $or + searchUser $or vào `$and`để không ghi đè. Admin/Manager không bị scope (thấy mọi xưởng). Xem`FulfillmentWorkflow.md §4.5`.

---

## 8. Tab B — Tình trạng đơn hàng (Phase 6)

### 8.1 Endpoint `GET /v1/orders/status-overview`

Query params (extends list filter):

- `printStatus`, `printStatusNote`, `toolResult`, `toolResultNote`, `errorFile`, `assignee`, `assigneeNote` — CSV codes (multi-select OR trong cùng category, AND giữa các category)
- `factoryId`, `machineTypeId`
- `readyForFulfill` (bool)
- `createdFrom`, `createdTo` (yyyy-mm-dd, mặc định 7 ngày gần nhất)
- `search`

Response:

```ts
{
  totals: {
    total, today, pendingToolOk, readyForFulfill, done, errors,
    byMachine: [{ machineCode, machineName, printed, pending }] // mini KPI cho Fulfill
  },
  breakdown: {
    printStatus, printStatusNote, toolResult, toolResultNote, errorFile, assignee, assigneeNote,
    factory: [{ factoryId, name, count }], // ĐỦ xưởng đang bật — xưởng 0 đơn trong kỳ vẫn có chip (count: 0) để bấm sang
    machineType: [{ machineTypeId, name, count }],
    readyForFulfill: [{ key: boolean, count }]
  },
  filter: { ... echo back ... }
}
```

### 8.2 Aggregation (`getStatusOverview()`)

1. Build base match (visibility filter theo role + query filters).
2. `$facet` 16 nhánh chạy SONG SONG: 6 KPI count + 9 breakdown group + 1 ready breakdown — 1 round-trip DB.
3. Hậu xử lý FE-friendly:
   - Workshop codes → name + color + icon qua `WorkshopConfigRepository.findAll()` (1 bulk fetch, build Map).
   - Factory / MachineType codes → name qua direct collection query.
   - Bù chip xưởng thiếu: `listFactoryOptions()` (bảng `factories`, `isActive: true`, bỏ xưởng US) — xưởng nào chưa có trong breakdown thì push thêm `count: 0`. Nếu không, xưởng 0 đơn biến mất khỏi bộ lọc và khi đang chọn 1 xưởng thì không bấm sang xưởng khác được.
   - Per-machine KPI cho Fulfillment: lọc `printStatus` buckets theo whitelist `machine-1..4, machine-94`.

### 8.3 Per-role KPI cards (FE)

| Role                      | KPI                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin / Manager / Support | Tổng đơn · Hôm nay · Chờ Ok Tool · Sẵn sàng in · Đã in xong · Lỗi cần xử lý                                                                                                                   |
| Designer                  | Cần check · Ok hôm nay · Đơn lỗi · Tổng (range)                                                                                                                                               |
| Fulfillment               | Sẵn sàng in · Đã in xong · Đơn hôm nay · Tổng (range) **+ mini KPI từng máy**. Cell `toolResultNote` (Note kq Tool 1) hiển thị inline-edit để Fulfillment cập nhật tình trạng đơn sau khi in. |

### 8.4 Breakdown card visibility

Mỗi card render conditional theo `usePermission().canViewField(field)`:

- Designer: ẩn `printStatus`, `printStatusNote` (vì không phải việc của Designer)
- Fulfillment: ẩn `toolResult*`, `errorFile*`, `assignee*`
- Support: thấy tất cả (view-only)
- Admin / Manager: thấy tất cả

Factory + MachineType breakdown chỉ hiển thị cho user có `order.view_admin_table` hoặc isAdmin.

**Lưu ý mặc định range:** từ Phase 7, `useStatusFilter` mặc định **hôm nay** (`todayISO()` dùng local-date components, không phải `toISOString()`) thay vì 7 ngày để khớp hành vi với Tab A/C. Designer/Fulfill vẫn được BE giữ cửa sổ 7 ngày qua `buildVisibilityFilter` nếu client không gửi date override.

### 8.5 Filter state — `useStatusFilter` hook

```ts
const { filter, queryString, isActive, toggle, setScalar, clearAll } = useStatusFilter();
```

- State đồng bộ với URL searchParams → reload/share giữ nguyên filter.
- `toggle(category, code)`: thêm/bớt code vào CSV của category đó.
- `setScalar('createdFrom' | 'createdTo' | 'factoryId' | ..., value)`: scalar field.
- `queryString` đã build sẵn `'?printStatus=...&toolResultNote=ok&...'` để pass trực tiếp vào API.

Default range: 7 ngày gần nhất (khớp với BE visibility cho Designer/Fulfill).

### 8.6 OrdersMiniTable (dưới breakdown)

Bảng dùng **compact grouped columns** — 8 group build từ `WORKSHOP_COLS` (lọc theo `canViewField` per field) qua `buildColGroups()` (`workshopTableConfig.tsx`, dùng chung với `OrderTableWorkshop`/`OrderFactoryTab` — xem `Orders.md §10.2a`), mỗi group render qua `<GroupCellContent>` (field xếp chiều dọc trong 1 cell, field không có cột riêng có label ngắn phía trước) + 1 cột action cuối (sticky right, History dialog). Field bị ẩn quyền tự loại khỏi group; group rỗng hết member tự ẩn cả cột.

Inline edit dùng `ColorBadgeSelectCell` / `IconSelectCell` từ Phase 4 — vẫn theo `canEditField` permission.

### 8.7 Cell sync giữa các tab/component

Optimistic update qua callback `onUpdated(newValue)` → patch row local state. Khi user chuyển breakdown filter, OrdersMiniTable tự reload qua `queryString` thay đổi.

---

## 9. Performance Tab B

| Tối ưu                            | Vị trí                                        |
| --------------------------------- | --------------------------------------------- |
| 1 round-trip cho overview         | `$facet` 16-branch aggregation                |
| Parallel overview + list          | 2 fetch chạy song song khi filter đổi         |
| Workshop name resolve             | 1 bulk fetch all configs vào Map; lookup O(1) |
| URL state thay vì component state | Refresh / back-forward không mất filter       |
| Optimistic update cell            | Không re-fetch toàn list khi sửa 1 field      |

---

## 10. Tab C — Đơn hàng theo xưởng (Phase 7)

### 10.1 Khái niệm chuyển xưởng

Mỗi order có 2 field factory:

- `factoryId` — xưởng **hiện tại** đang sản xuất (mutable qua transfer).
- `originalFactoryId` — xưởng **gốc** tại lúc import (immutable, backfill bằng `factoryId` cho legacy rows ở `OrderService.onModuleInit()`).

Phân loại đơn:

- **Pure** — `factoryId === originalFactoryId` (chưa chuyển).
- **Transferred** — `factoryId !== originalFactoryId`.
  - Với từng xưởng X: `transferredIn` = đơn `factoryId=X, originalFactoryId≠X`; `transferredOut` = `originalFactoryId=X, factoryId≠X`.

### 10.2 Endpoint `GET /v1/orders/factory-overview`

Query: `createdFrom`, `createdTo`, `factoryId?` (chỉ scope `availableFilters` — cards + flow giữ global).

Response `FactoryOverview` (shared DTO `production-order.dto.ts`):

```ts
{
  totals: { total, transferred, pure },
  factories: FactoryOverviewCell[],  // 1 cell / factory — CHỈ xưởng đang giữ đơn trong kỳ
  factoryOptions: FactoryOption[],   // ĐỦ xưởng đang bật (bảng `factories`, GIỮ cả xưởng US vì tab này không loại) — options cho select "Chuyển xưởng"
  flows: FactoryFlow[],              // origin→current pairs (count > 0, from ≠ to)
  availableFilters: {
    products:    { value, label, count }[],
    fabrics:     { ... },
    toolResults: { ... },
    machineTypes:{ ... }
  }
}

FactoryOverviewCell = {
  factoryId, factoryName, factoryShortName,
  total, pure, transferredIn, transferredOut,
  productCount, fabricCount, machineCount, withToolCount,
  // 3 print stage — disjoint, cộng lại = total (Phase 7.1)
  notPrintedCount,   // printStatus null/empty
  printingCount,     // printStatus tồn tại nhưng KHÔNG ∈ PRINTED_MACHINE_CODES
  printedCount,      // printStatus ∈ PRINTED_MACHINE_CODES
  // Lỗi xưởng — Phase 8. Đếm độc lập với 3 print stage.
  errorCount,        // productionError tồn tại và khác empty
  // Design theo designerStatus — 2 cặp disjoint, mỗi cặp cộng lại = total:
  designAssignedCount,    // designerStatus ≠ unassigned/null (đã từng gán, gồm done)
  designUnassignedCount,  // designerStatus unassigned/null
  designDoneCount,        // designerStatus = done
  designNotDoneCount,     // designerStatus ≠ done
  breakdowns: { products, fabrics, sizes, toolResults }  // top 20 mỗi dimension
}
```

Aggregation chính (`OrderService.getFactoryOverview`):

1. `$match` theo `orderAt` range (đổi từ `createdAt` tháng 2026-06 — xem `Orders.md §7.0`) + `factoryId, originalFactoryId` đều tồn tại + (`readyForFulfill=true` nếu role là Fulfillment).
2. `$group` theo `(originalFactoryId, factoryId)` → bảng flow.
3. Bulk fetch tên factory từ collection `factories`.
4. Duyệt flow rows để xây `cellMap` (pure / in / out / total).
5. Aggregation song song:
   - **statRows** — distinct types/fabrics/machines + withToolCount per factory (`toolResult ∈ toolHasCodes` với `toolHasCodes = workshop_config { category=tool_result, name ~ '^Có' }`).
   - **4 breakdownRows** — group `(factoryId, value)` cho products / fabrics / sizes / toolResults.
   - **4 optionRows** — distinct values theo `filterMatch` (= match + `factoryId` nếu user đã chọn chip).
6. Resolve fabric/tool codes → name qua `WorkshopConfigRepository.findAll({ category })`, machine ID → `shortName · name` qua collection `machineTypes`.

### 10.3 Endpoint `GET /v1/orders/export`

Cùng filter shape như `GET /v1/orders` (kế thừa `buildOrderListFilter` + `buildVisibilityFilter`), **bỏ phân trang**, populate `factory / machineType / productConfig`. FE giới hạn payload bằng cách giữ filter chặt (date range + factory chip + selects).

Sort `{ type:1, size:1, fabricType:1, createdAt:-1 }` để file Excel xuất ra đã nhóm sẵn.

Sheet "Chi tiết đơn" resolve code → tên hiển thị qua workshop config store (`buildDetailRow`). Field multi-code `errorFile` (cột "File sửa lỗi") phải đi qua `normalizeCodes()` (flatten nested array `[["code"]]` + coerce string legacy) — MIRROR `MultiIconSelectCell`; nếu không, data lồng mảng sẽ resolve trượt và xuất ra raw code thay vì tên.

### 10.4 Endpoint chuyển xưởng

| Method | Path                       | Body                                                                                      | Mô tả                                                                                                                                                                                                                                                                     |
| ------ | -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH  | `/v1/orders/:id/transfer`  | `{ targetFactoryId, reason? }`                                                            | Đổi `factoryId` cho 1 order; nếu trùng target trả `modified: 0`.                                                                                                                                                                                                          |
| PATCH  | `/v1/orders/bulk-transfer` | `{ ids[], targetFactoryId, reason? }`                                                     | Pre-filter ID đã ở target (skip no-op), `updateMany` phần còn lại.                                                                                                                                                                                                        |
| PATCH  | `/v1/orders/bulk-assign`   | `{ ids[], factoryId, fabricType?, machineTypeId?, machineNumber?, toolResult?, reason? }` | Initial-assign cho đơn **UNMAPPED**. Pre-filter `factoryId` null/missing, `updateMany` set `factoryId + originalFactoryId + 4 optional fields`, log `bulk_update` với before/after từng field thay đổi. Đơn đã có factory bị skip (đếm `matched` nhưng không `modified`). |

Cả 3 đều:

- Ghi `OrderLog` (xem `OrderLog.md`) với `before/after` field thay đổi (`transfer` action cho 2 endpoint đầu, `bulk_update` cho `bulk-assign`).
- Gọi `invalidateListCache()` để clear cache `orders:list:*`.

`bulk-assign` thêm validate:

- `factoryId` tồn tại qua `FactoryRepository.findOne`.
- `machineTypeId` (nếu set) qua `MachineTypeRepository.findOne`.
- `fabricType`, `machineNumber`, `toolResult` (nếu set) qua `assertValueAllowed()` ⇒ workshop_config category tương ứng (`fabric`, `machine`, `tool_result`).

### 10.5 UI components Tab C

| Section               | Component                                                                                                                                                                                                      | Mô tả                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date range bar        | `Input type=date` x2 + `RefreshCw` + `Download`                                                                                                                                                                | Default = today. Nút `Tải lại` re-fetch overview + rows.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Factory cards         | `FactoryCard` (3 cards horizontal)                                                                                                                                                                             | Click số chính → set `filterMode={kind:'at', factoryId}`. Click ô "Nhận từ xưởng khác" / "Đã chuyển đi" → `{kind:'in'\|'out', factoryId}`. 3 button "Chưa in / Đang in / Đã in xong" → `{kind:'print', factoryId, stage}` để drill-down list theo trạng thái in.                                                                                                                                                                                                                          |
| Flow visualization    | Button rows                                                                                                                                                                                                    | `[fromShortName] → [toShortName]` + `count + totalQuantity`. Click → filter `{kind:'in', factoryId=to}`.                                                                                                                                                                                                                                                                                                                                                                                  |
| Filter chip bar       | `FilterChip` (`Tất cả` + 1 chip/factory) + 4 `SelectFilter`                                                                                                                                                    | Selects auto-reset khi đổi factory chip để tránh combo zero-result.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Bulk toolbar          | Toolbar sticky khi `selected.size > 0`                                                                                                                                                                         | Chỉ render khi `canTransfer = isAdmin \|\| has('order.transfer')`. Nút **"Chuyển xưởng"** (mở `TransferDialog`) — bảng này chỉ còn đơn ĐÃ map (đơn unmapped bị loại khỏi tab từ `order.service.ts`, xem `Orders.md §19`) nên không còn nhánh "Gán xưởng" ở đây nữa.                                                                                                                                                                                                                       |
| Table                 | `Table` với 1 cột "Xưởng (đang / gốc)" + **compact grouped columns** (8 group từ `WORKSHOP_COLS` filtered theo `canViewField`, qua `buildColGroups()`/`<GroupCellContent>` — `Orders.md §10.2a`) + cột History | Row có `originalFactoryId !== factoryId` hiện badge `warning` + `← Gốc: shortName`. Mọi row luôn có xưởng (không còn nhánh "Gán xưởng"/"Chưa map" inline).                                                                                                                                                                                                                                                                                                                                |
| `TransferDialog`      | `Dialog`                                                                                                                                                                                                       | Select target + Input lý do (max 200). Gọi `bulkTransferOrders({ids, targetFactoryId, reason})`. Options lấy từ `overview.factoryOptions` (KHÔNG phải `overview.factories`) — nếu không thì xưởng chưa có đơn nào không nằm trong select và không chuyển đơn sang được.                                                                                                                                                                                                                                                                                                                                                                                          |
| `AssignFactoryDialog` | `Dialog`                                                                                                                                                                                                       | Initial-assign cho đơn UNMAPPED. Single mode: hiển thị `productionId / type / size / qty + link design (target="_blank" → originalUrl)`; Bulk mode: tiêu đề "Gán xưởng cho N đơn đã chọn". Form: 1 select required (Xưởng) + 4 select optional (Loại vải / Phòng / Máy / Tool). Source options: factory ← `overview.factories`, fabric/machine/tool ← `useWorkshopConfigStore` (full catalog), Phòng ← lazy fetch `machineType.getMachineTypes()` lần đầu open. Gọi `bulkAssignOrders()`. |

### 10.6 Filter mode → query params

`FilterMode` (FE-only union):

- `{kind:'all'}` → không gửi `factoryId`/`transferStatus`.
- `{kind:'at', factoryId}` → `?factoryId=…` (đơn đang ở X).
- `{kind:'in', factoryId}` → `?transferStatus=transferred-in:<fid>`.
- `{kind:'out', factoryId}` → `?transferStatus=transferred-out:<fid>`.
- `{kind:'print', factoryId, stage}` → `?factoryId=…&printStage=printed|printing|not-printed` (drill-down theo trạng thái in tại xưởng X).

BE (`OrderService.buildOrderListFilter`) parse `transferStatus` thành `$expr` so sánh `originalFactoryId` vs `factoryId`. Xem `Orders.md §7.x` để biết các token (`transferred / pure / transferred-in:<fid> / transferred-out:<fid>`).

### 10.7 Excel export — multi-sheet workbook

File: `apps/web/src/pages/home/exportOrders.ts` (dùng `xlsx` SheetJS).

Hàm chính: `buildWorkbook(orders, overview, { resolve })` → `XLSX.WorkBook`. Resolve workshop codes thành tên người dùng qua `useWorkshopConfigStore.resolve`. Tải về qua `downloadWorkbook(filename, wb)` → `XLSX.writeFile(..., { bookType:'xlsx' })`.

Cấu trúc workbook:

| Sheet               | Mô tả                                                                       | Cấu trúc                                                                                                                                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tổng quan**       | Snapshot scope hiện tại                                                     | TỔNG QUAN (total/pure/transferred) → bảng `(Xưởng, Mã, Tổng, Pure, Nhận vào, Chuyển đi, Sản phẩm, Loại vải, Loại máy, Có tool)` → bảng `LUỒNG CHUYỂN XƯỞNG (Từ, Đến, Số đơn, Tổng sản phẩm)`.                                                                                               |
| **Breakdown**       | Long-form pivotable                                                         | 4 cột `(Xưởng, Loại, Giá trị, Số đơn)` × mỗi factory × `{Sản phẩm, Loại vải, Size, Kết quả Tool}`.                                                                                                                                                                                          |
| **Chi tiết đơn**    | Detail dump 21 cột                                                          | Production ID · User SKU · Size · Trạng thái in · Note Trạng thái in · Kết quả Tool · Note kq Tool 1 · File sửa lỗi · Ghi chú file lỗi · Color · Người thực hiện · Note người thực hiện · Type · Mockup · Design Front · Order ID · In Production At · Type.1 · Nhà máy · Phòng · Loại vải. |
| **[shortName]** × N | 1 sheet / factory (`sanitizeSheetName` cắt 31 ký tự + thay `:\/?*[]` → `_`) | Header xưởng + dòng `(Tổng, Pure, Nhận vào, Chuyển đi)` + bảng 4 cột song song `Sản phẩm / Loại vải / Size / Kết quả Tool`.                                                                                                                                                                 |

Tên file: `don-hang-YYYY-MM-DD-HH-MM-SS.xlsx` (timestamp lấy bằng `toLocaleString('sv-SE')` → ISO-like local time).

Trước khi gọi: nếu `data.length === 0` toast warning, không build workbook.

### 10.8 Performance Tab C

| Tối ưu                                               | Vị trí                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Tránh re-fetch overview khi đổi page/pageSize        | `overviewQuery` chỉ phụ thuộc `(createdFrom, createdTo, filterMode)` |
| Reset `selectFilters` khi đổi factory chip           | `useEffect([filterMode])` — tránh combo zero-result phải debug       |
| Workshop config store load 1 lần                     | `useEffect` check `loaded` trước khi gọi `load()`                    |
| Bulk transfer pre-filter                             | Skip ID đã ở target → không ghi log no-op                            |
| Indeterminate progress bar khi `rowsLoading`         | Giữ UI mượt thay vì block toàn bảng                                  |
| Sort `grouped` trên list                             | BE sort `(type, size, fabricType)` để đơn cùng combo gom liền nhau   |
| Export bypass phân trang nhưng giữ visibility filter | BE chia query → tránh client tải 10k rows × 20 page                  |

### 10.9 Print stage drill-down (Phase 7.1)

3 button trong mỗi `FactoryCard` — disjoint, cộng lại = `total`:

| Button         | Định nghĩa BE                                                                                                  | Tone (FE) |
| -------------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| **Chưa in**    | `printStatus` null/empty/missing                                                                               | slate     |
| **Đang in**    | `printStatus` tồn tại, KHÔNG ∈ `PRINTED_MACHINE_CODES`                                                         | sky       |
| **Đã in xong** | `printStatus` ∈ `PRINTED_MACHINE_CODES` = `['machine-1', 'machine-2', 'machine-3', 'machine-4', 'machine-94']` | emerald   |

Constant `PRINTED_MACHINE_CODES` ở module-level `order.service.ts` — dùng chung giữa `getStatusOverview()`, `getFactoryOverview()` (statRows aggregation), và `buildOrderListFilter()` (filter `printStage` query) để 3 chỗ luôn nhất quán.

Click button → `FilterMode = { kind: 'print', factoryId, stage }`:

- Bảng đơn lọc theo xưởng đó + stage.
- Chip "Đang ở Xưởng X" cũng active (vì scope vẫn ở xưởng).
- 4 select filter `availableFilters` (sản phẩm/vải/máy/tool) thu hẹp về options thực sự có trong (xưởng × stage) — `GetFactoryOverviewDto.printStage` thread xuống `filterMatch`.

Click chip "Đang ở X" lúc đang ở print mode → switch về `kind:'at'` (giữ xưởng, bỏ stage). Click button stage đang active → reset về `kind:'all'`.

### 10.10 Lỗi xưởng (Phase 8)

Xưởng (role Fulfillment) báo lỗi đơn hàng sau khi nhận file: chọn mã lý do (workshop_config `category=production_error`) + nhập mô tả tự do.

**Schema** (`OrderEntity`):

```ts
productionError?: string;       // code (wrong-size / wrong-color / print-misalign / fabric-damage / machine-jam / other...)
productionErrorNote?: string;   // free text mô tả chi tiết
```

Đơn được coi là "có lỗi" ⇔ `productionError` tồn tại và khác `null` / `''`. Không có boolean flag riêng — chỉ check sự tồn tại của `productionError`.

**Mã lý do default** (seed `workshop-config.seed.ts`, color badge):

| Code             | Tên hiển thị      | Màu       |
| ---------------- | ----------------- | --------- |
| `wrong-size`     | Sai size          | `#EF4444` |
| `wrong-color`    | Sai màu           | `#F97316` |
| `wrong-fabric`   | Sai loại vải      | `#F59E0B` |
| `print-misalign` | In lệch           | `#DC2626` |
| `print-blur`     | In mờ/nhòe        | `#B91C1C` |
| `fabric-damage`  | Vải lỗi/rách      | `#A855F7` |
| `wrong-design`   | Sai design        | `#7C3AED` |
| `missing-design` | Thiếu file design | `#9333EA` |
| `machine-jam`    | Máy lỗi/kẹt       | `#0EA5E9` |
| `other`          | Lỗi khác          | `#64748B` |

**Permission codes** (catalog):

- `order.field.productionError.view / .edit` — Fulfillment + admin.
- `order.field.productionErrorNote.view / .edit` — Fulfillment + admin.

**Filter trên list endpoint** (`GetProductionOrdersDto`):

- `productionError=wrong-size,print-misalign` — CSV codes.
- `hasError=true` — tất cả đơn có productionError. (`hasError=false` không support — không lọc tức là "tất cả".)

**Factory tab — nút "Lỗi xưởng" thay vị trí "Đang in":**

| Ô (mỗi card)        | Filter mode                           | Query                       |
| ------------------- | ------------------------------------- | --------------------------- |
| Chưa in             | `{kind:'print', stage:'not-printed'}` | `factoryId + printStage`    |
| **Lỗi xưởng** (mới) | `{kind:'error', factoryId}`           | `factoryId + hasError=true` |
| Đã in xong          | `{kind:'print', stage:'printed'}`     | `factoryId + printStage`    |

Card hiện `cell.errorCount` ở giữa (tone `rose`); active khi `filterMode.kind === 'error' && factoryId match`. Chip "Đang ở Xưởng X" cũng active đồng thời (giữ context xưởng).

URL params: `fmode=error&ffactory=<id>` (cùng namespace `f*` với các filter khác của Tab C).

**Status tab (Tab B):**

- Toggle nhanh "Lỗi cần xử lý" (button rose) trong `<FilterChipBar>` — đặt `hasError=true` URL param.
- Breakdown card "Lỗi xưởng" hiện 10 lý do hàng đầu (mode color). Click code → toggle `productionError` CSV filter.
- KPI "Lỗi cần xử lý" giờ đếm cả `productionError` (cộng dồn với `toolResultNote='error'` và `errorFile != null`).

**Cách aggregation đếm `errorCount`** (`getFactoryOverview` statRows):

```js
errorCount: {
  $sum: {
    $cond: [{ $ne: [{ $ifNull: ['$productionError', ''] }, ''] }, 1, 0];
  }
}
```

---

## 11. URL state persistence (Phase 7.2)

### 11.1 Param namespace per tab

Mỗi tab có **prefix riêng** để các param không clash khi user switch tab. Parent `home/index.tsx` `handleTabChange` strip param của 2 tab kia mỗi lần đổi tab.

| Tab                         | Prefix         | Params                                                                                                                                                                                           |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stats (`OrderStatsTab`)     | `s`            | `sfrom`, `sto`, `stype`, `suser`                                                                                                                                                                 |
| Status (`useStatusFilter`)  | _không prefix_ | `createdFrom`, `createdTo`, `printStatus`, `printStatusNote`, `toolResult`, `toolResultNote`, `errorFile`, `assignee`, `assigneeNote`, `factoryId`, `machineTypeId`, `readyForFulfill`, `search` |
| Factory (`OrderFactoryTab`) | `f`            | `ffrom`, `fto`, `fview`, `ffactory`, `fmode`, `fstage`, `ftype`, `ffabric`, `ftool`, `fmachine`, `fmnum`, `fpage`, `fsize`                                                                       |

**`fview` (sub-view) — admin only:**

- `fview` absent / khác → `by-factory` (default — 3 factory card breakdown).
- `fview=total` → "Tổng" sub-view: hiển thị 1 `TotalCard` gộp tất cả xưởng (productCount/fabricCount/machineCount lấy từ `availableFilters.*.length` để đếm DISTINCT chuẩn; print/error counts là sum across cells; transferred/pure lấy từ `overview.totals`). Click stage button → set `FilterMode.kind = 'print-all'|'error-all'` → fetchRows bỏ `factoryId`, chỉ pass `printStage` hoặc `hasError` → BE filter cross-factory.
- Non-admin nếu nhận URL với `fview=total` thì init state fallback `by-factory` (guard `v === 'total' && isAdmin`).
- Khi user toggle sub-view → `handleSwitchView` reset `filterMode → all`, `selectFilters → {}`, `page → 1` để không leak filter cũ qua view mới.

### 11.2 Pattern sync state ↔ URL

Mỗi tab dùng pattern thống nhất:

```ts
// 1) Initial state đọc URL → fallback default
const [createdFrom, setCreatedFrom] = useState(
  () => searchParams.get('ffrom') || todayISO()
);

// 2) Sync ngược state → URL (1 useEffect, replace để không spam history)
useEffect(() => {
  setSearchParams((prev) => {
    const sp = new URLSearchParams(prev);
    // Date LUÔN ghi vào URL (kể cả today) để URL reflect đúng state user thấy.
    createdFrom ? sp.set('ffrom', createdFrom) : sp.delete('ffrom');
    // ... các param khác
    return sp;
  }, { replace: true });
}, [createdFrom, ...]);

// 3) Guard `isFirstRender ref` cho useEffect cleanup (vd. setPage(1) khi
//    filterMode đổi) — skip render đầu để không ghi đè URL params mới load.
```

### 11.3 Phân loại param: strip default vs always-write

| Loại                                                           | Quy tắc                            | Lý do                                                                            |
| -------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| **Date** (`*from`, `*to`, `createdFrom/To`)                    | **Luôn ghi vào URL** (kể cả today) | URL phải hiển thị explicit ngày đang xem để share link / copy URL không gây nhầm |
| **Filter chips/selects** (workshop codes, factory, stage, ...) | Strip khi rỗng/default             | URL gọn khi không filter                                                         |
| **Pagination** (`*page`, `*size`)                              | Strip khi `page=1`/`size=20`       | Default state không cần param                                                    |
| **Search**                                                     | Strip khi rỗng                     | Default state không cần param                                                    |

### 11.4 Default = today cho mọi date filter

4 tab (Stats / Status / Factory + Workshop tab ở Orders module) đều default `createdFrom = createdTo = todayISO()`. Helper `todayISO()` dùng local date components — KHÔNG dùng `toISOString()` (UTC) vì sẽ lệch ngày khi ở Việt Nam buổi sáng.

### 11.5 Ví dụ URL khôi phục đầy đủ

```
/dashboard?tab=stats&sfrom=2026-06-15&sto=2026-06-18&stype=Tee&suser=user@gmail
/dashboard?tab=status&createdFrom=2026-06-15&createdTo=2026-06-18&printStatus=in-progress&factoryId=...
/dashboard?tab=factory&ffrom=2026-06-15&fto=2026-06-18&ffactory=...&fstage=printed&ftype=Hoodie
```

F5 cả 3 URL trên đều khôi phục đúng state → user share link không lo mất filter.

---

## 12. UI components dùng chung (Phase 7.2)

### 12.1 `<DateRangePicker>` — `apps/web/src/components/common/DateRangePicker.tsx`

Popover gói gọn cả 8 preset + 2 input "Từ/đến" trong 1 trigger button.

- **Trigger**: `<Button>` hiển thị smart label
  - Khớp preset → tên preset (vd. "Tuần này")
  - Range custom → `dd/mm/yy → dd/mm/yy`
  - Rỗng → placeholder
- **Popover content**:
  - Grid 4×2 nút preset (Hôm nay / Hôm qua / Tuần này / Tuần trước / Tháng này / Tháng trước / Năm nay / Năm trước) — click preset → apply ngay + đóng popover.
  - 2 `<Input type="date">` với buffer state `(draftFrom, draftTo)` — gõ KHÔNG trigger fetch, đợi "Áp dụng".
  - Nút "Xóa" (nếu `clearable && hasValue`) reset `('', '')`.
- Preset definitions: `apps/web/src/utils/dateRangePresets.ts` (`DATE_PRESETS` + `matchPreset()`). Tuần bắt đầu thứ Hai (ISO/VN).

Đã thay thế block `2 Input + nút preset` ở 4 chỗ: Stats / Status / Factory tab + `OrderTableWorkshop`.

### 12.2 `<PaginationBar>` — `apps/web/src/components/common/PaginationBar.tsx`

Wrapper đóng gói `<Pagination>` + khung phù hợp cho top/bottom của table.

```tsx
<PaginationBar position="top" {...paginationProps} />
<div className="rounded-lg border border-border bg-card">
  <Table>...</Table>
  <PaginationBar position="bottom" {...paginationProps} />
</div>
```

- `position="top"` → standalone card có viền + nền (đặt trên cụm table).
- `position="bottom"` → dải có `border-t` (đặt trong card của table).
- Auto ẩn khi `total <= 0` hoặc `loading=true` (tránh nhấp nháy).

Áp dụng cho 4 table: `ListOrderTab`, `OrderTableWorkshop`, `OrderFactoryTab`, `OrdersMiniTable` (tất cả đều có top + bottom).

### 12.3 `<MultiSelectFilter>` — `apps/web/src/components/common/MultiSelectFilter.tsx`

Popover multi-select thay thế cho "FilterChips dàn ngang chiếm chiều ngang".

- **Trigger button**: `Label: A, B +N` + badge số đếm khi có chọn.
- **Popover content**: search bar + checkbox list + footer "Chọn tất cả · N/Total".
- `renderType='color'` → chấm tròn màu trước tên (khớp `workshop_config.color`).
- Auto ẩn khi `options.length === 0`.

> **Lưu ý hook order**: tất cả `useMemo` PHẢI khai báo TRƯỚC `if (options.length === 0) return null` để tránh React error "Rendered more hooks than during the previous render" khi options load async.

Đã thay thế `FilterChips` (custom inline) trong `OrderTableWorkshop` cho 3 filter `printStatus` / `toolResultNote` / `assignee`.

---

## Bổ sung: Tab "Lỗi theo người" (2 chiều)

- **File FE:** `apps/web/src/pages/home/PersonErrorTab.tsx` (tab `person-error` trong `index.tsx`, gate `isAdmin || page.designer_stats || page.tool_check`).
- **API:** `GET /designer/person-error-overview` + `GET /designer/person-error-orders` (`designer-stats.controller.ts`, role Admin/Manager/DesignerLeader/SupportManager).
- **Leaderboard 2 chiều** (`DesignerStatsService.getPersonErrorOverview`):
  - `needFixCount` — đơn lỗi ĐANG cần người đó sửa (bị quy lỗi/phải sửa): fulfillment theo `(factory, currentFulfillmentStage)` → user giữ stage; designer theo `designerStatus=rework` + `assignee`.
  - `reportedCount` — số lần người đó ĐÃ báo lỗi (đẩy về) trong kỳ, đếm từ `fulfillmentTimeline` (action `rework-back`, `byUserId`).
- Click 1 dòng → xổ **list đơn lỗi đang cần fix** (`getPersonErrorOrders`, hỗ trợ synthetic id `stage:<factory>:<stage>` cho công đoạn chưa gán người). Loại đơn hủy (`cancelledAt`). Date field: `inProductionAt` (needFix) / `timeline.at` (reported).
