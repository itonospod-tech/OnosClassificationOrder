# Orders — Function Description

> **File FE:** `apps/web/src/pages/orders/index.tsx` (Tabs wrapper, route theo permission)
> **File FE tabs:** `ListOrderTab.tsx` (KHÔNG dùng nữa — đã tách route riêng, xem `pages/orders/index.tsx`), `ErrorLogTab.tsx` (mọi role — Nhật ký bù lỗi), `OrderTableWorkshop.tsx` (grouped theo sản phẩm — Designer/Fulfill/Support), `OrderTableClassic.tsx` (flat + phân trang thật, KHÔNG gộp theo sản phẩm — §10.2b), `ImportOrderTab.tsx`, `parseOrders.ts`
> **Cell components:** `apps/web/src/components/orders/cells/{ColorBadgeSelectCell,IconSelectCell,TextEditCell,ImageThumbCell,DesignThumbsCell,SelectPopover,AssigneeSelectCell,ProductionErrorSelectCell,ProductionErrorOtherDialog,ErrorSourceCell}.tsx`
> **Bulk edit:** `apps/web/src/components/orders/BulkEditToolbar.tsx` + `AssignDesignerDialog.tsx`
> **Workshop columns (shared with Dashboard Tab C):** `apps/web/src/components/orders/workshopTableConfig.tsx` (`WORKSHOP_COLS` + `WorkshopOrderRow` + `WorkshopRenderCtx`)
> **Designer KPI panel (Admin/Leader):** `apps/web/src/pages/orders/DesignerSummaryPanel.tsx`
> **File BE:** `apps/api/src/modules/order/`
> **Route:** `/ffm/orders`
> **API:**
>  - `GET /v1/orders` · `GET /v1/orders/:id` · `GET /v1/orders/grouped` · `GET /v1/orders/overview-list` · `GET /v1/orders/by-ids` · `GET /v1/orders/workshop-filters` · `GET /v1/orders/fulfillment-status-counts` · `GET /v1/orders/import-summary` · `GET /v1/orders/error-log`
>  - `GET /v1/orders/export` (full-list, không phân trang — xem `Dashboard.md §10.3`)
>  - `GET /v1/orders/factory-overview` (xem `Dashboard.md §10.2`)
>  - `GET /v1/orders/designer-breakdown` (KPI panel Designer — xem `DesignerTaskWorkflow.md §2.5`)
>  - `POST /v1/orders/import` · `POST /v1/orders/backfill-fabric` · `POST /v1/orders/backfill-designer-status`
>  - `PATCH /v1/orders/:id/field` · `PATCH /v1/orders/bulk-field`
>  - `POST /v1/orders/:id/set-production-error` (atomic — bắt buộc khi code='other')
>  - `POST /v1/orders/bulk-assign-designer-preview` + `POST /v1/orders/bulk-assign-designer`
>  - `POST /v1/orders/:id/designer-transition` · `POST /v1/designer/bulk-transition` (xem `DesignerTaskWorkflow.md`)
>  - `PATCH /v1/orders/:id/transfer` · `PATCH /v1/orders/bulk-transfer`
>  - `GET /v1/orders/:id/logs` · `DELETE /v1/orders/:id`

---

## 1. Overview

Module **Orders** quản lý đơn hàng sản xuất từ hệ thống ngoài (Google Sheets / TikTok / Etsy export...). UI chia tab động theo quyền của user:

- **Tab List Order** — bảng admin cũ (card row, preview mockup/design, copy URL). Cần `order.view_admin_table`.
- **Tab Nhật ký bù lỗi** — danh sách đơn đang chờ xử lý lỗi (xem `§14`). Hiển thị cho mọi role có quyền xem orders; visibility BE tự scope theo role. **Sidebar có entry riêng** `Orders → Nhật ký bù lỗi` link thẳng vào `?tab=error-log`.
- **Tab Danh sách đơn** — bảng nghiệp vụ 20 cột với inline select / bulk edit. Cần `order.view_workshop_table`.
- **Tab Import Order** — paste TSV từ Google Sheets → parse → preview → bulk import. Cần `order.import`.

User không có quyền nào → trang hiển thị "Bạn không có quyền xem trang Orders".

Mỗi đơn hàng gồm:
- Production ID duy nhất (key dedupe)
- SKU sản phẩm, user info (sku + email)
- Type / color / size / quantity / cost
- 1 mockup URL + nhiều design URL (`front`, `back`, `sleeve`, `hood`, ...)
- Mapping tới factory + machineType qua ProductConfig

---

## 2. Tab `List` (`ListOrderTab.tsx`)

### 2.1 Tính năng
| Chức năng | Mô tả |
|-----------|-------|
| List | Card list (không phải table) cho mỗi đơn, pageSize=20 default |
| Phân trang | Top + bottom (cả 2 chỗ), shadcn `Pagination` |
| Filter | `isMapped` / `factoryId` / `machineTypeId` / `status` |
| Search | `productionId`, `userSku`, `userEmail`, `orderId`, `type` (regex contains, case-insensitive). **Hỗ trợ nhiều mã**: dán/nhập nhiều token cách nhau bằng khoảng trắng / dấu phẩy (paste 1 cột từ Google Sheets → newline tự đổi thành khoảng trắng) → BE tách token qua `buildSearchOr()` → match nếu BẤT KỲ token nào khớp BẤT KỲ field nào (OR). Badge "N mã" hiện trong ô khi parse ra >1 mã. Enter để tìm. |
| Tìm bulk Production ID | Nút icon `ListChecks` cạnh ô search → mở `BulkProductionIdDialog` (mode=`filter`). Dán nhiều mã (mỗi mã 1 dòng / phẩy / khoảng trắng) → "Lọc bảng" → set `bulkIds` (state, **không** sync URL) → param `productionIds` (CSV, exact match) khi fetch → bảng chính chỉ còn các mã đó. Badge "Đang lọc N mã ✕" để xoá. Khác ô search ở chỗ: dialog match **exact** từng mã (chỉ `productionId`), ô search match **contains** trên 5 field. Bulk và search thường loại trừ nhau. |
| Preview mockup | Click ảnh → `ImagePreviewDialog` |
| Preview design | Click thumb design → `ImagePreviewDialog` |
| Copy URL | CopyButton cho display URL + original URL |
| Delete | Confirm → soft delete |

### 2.2 OrderRowItem (memoized)
- Wrap `React.memo` để chỉ re-render khi order data đổi
- Hiển thị:
  - Thumbnail mockup (Teehub CDN variant `s200`)
  - `productionId` + copy button
  - `type` truncate 1 dòng + ellipsis (không line-clamp 2)
  - `userSku` + `userEmail`
  - Badge factory + machineType + status
  - Grid thumbnail design (max 6 ảnh visible, "+N" badge nếu nhiều hơn)
  - Quantity + base cost + ship cost

### 2.3 Performance
| Tối ưu | Mục đích |
|--------|----------|
| `React.memo(OrderRowItem)` | Skip re-render rows không đổi |
| Native `title` attribute | Tooltip nhẹ thay Radix |
| Teehub CDN thumb `s200` | Ảnh thumbnail nhỏ ~5KB thay ảnh gốc MB |
| `content-visibility: auto` | Browser skip render row ngoài viewport |
| `MAX_VISIBLE_DESIGNS = 6` | Giới hạn DOM size cho đơn nhiều design |
| Service Worker cache | Cache ảnh lần 2 → instant load |
| Compound index `{priority: -1, inProductionAt: -1}` (BE, `order.entity.ts`) | Khớp sort mặc định của `getOrders` — trước đây chỉ có index đơn lẻ nên Mongo in-memory sort toàn tập kết quả mỗi request (~1.2s trên data production) |

---

## 3. Tab `Import` (`ImportOrderTab.tsx`)

Có **2 mode** (toggle button ở header card):
- **"Import đơn mới"** (`mode=new`) — flow gốc, parse + upsert đơn mới qua `POST /v1/orders/import`.
- **"Import file soát"** (`mode=rework`) — UPDATE QC fields cho đơn hiện có qua `POST /v1/orders/import-rework`. Không tạo mới.

### 3.1 Flow

**Mode `new`:**
```
User paste TSV (Ctrl+V from Google Sheets) vào textarea
  → parseOrderRows() (parseOrders.ts) chia tab + dòng
  → Header detection (auto match column theo tên)
  → Preview table (50 dòng đầu, scrollable)
  → Submit → POST /v1/orders/import
  → BE upsert by productionId → trả về { imported, updated, mapped, unmapped, skipped[] }
  → Toast + reload list nếu user chuyển tab
```

**Mode `rework` (file soát):**
```
Header sheet (20 cột):
  Production ID | User SKU | Size | Trang_thai_in | Note_trang_thai_in |
  ket_qua_tool | Note_kq_Tool | File_sua_loi | Ghi_chu_file_loi |
  Nguoi_thuc_hien | Note_nguoi_thuc_hien | Type | Color | Mockup |
  Design Front | Order ID | In Production At | Type.1 | Nhà máy | Phòng

parseReworkOrderRows() chỉ lấy 5 cột: productionId + 4 QC field (toolResultNote,
errorFile, errorFileNote, assignee). Các cột khác BỎ QUA (không đè dữ liệu cũ).

  → Submit → POST /v1/orders/import-rework
  → BE `importRework`:
      1. Preload workshop_config (tool_result_note + error_file_type) + tất cả User.
      2. Loop từng row → lookup order theo productionId:
         - Nếu không tồn tại → notFound++ + skipped[].
         - Match `Note_kq_Tool` (vd "loi") → workshop_config.name normalize → code → set `toolResultNote`.
           Code ≠ 'ok' → kèm `$addToSet toolCheckErrorNotes` (lịch sử soát lỗi bền vững — xem `ToolCheckWorkflow.md`).
         - Match `File_sua_loi` (vd "Vien co") → tương tự.
         - `Ghi_chu_file_loi` → set `errorFileNote` (raw). Nếu chứa "huy don" (normalize) → set
           `cancelledAt = new Date()` + `cancelReason = note` (counter `cancelled++`).
         - Match `Nguoi_thuc_hien` (fullName normalize) → user._id → set `assignee` +
           `designerStatus='assigned'` + `designerAssignedAt=new Date()` (counter `assigneeMatched++`).
      3. Cell rỗng → giữ DB cũ. Match fail → skip field đó, log warning, các field còn
         lại vẫn update (không reject cả row).
      4. Audit log: `action='bulk_update'`, `field='import_rework'`, before/after = $set object.
  → Response: { updated, notFound, cancelled, assigneeMatched, skipped[] }
```

### 3.2 Parse logic (`parseOrders.ts`)
- Detect header row (chứa `productionId` hoặc alias)
- Map column theo header (vd: `Production ID` / `Prod ID` → `productionId`)
- Parse numeric: `quantity`, `weight`, `baseCost`, `shipCost`, `width`, `height`, `length`
- Parse date: `orderAt`, `inProductionAt` (ISO hoặc `M/d/yyyy`)
  - **Cột "In production at" để trống (2026-09-05)**: đơn MỚI nhận mốc mặc định = **lúc import**, đi qua `$setOnInsert` nên re-import KHÔNG ghi đè mốc thật. Bắt buộc phải có: mọi màn hình đơn + dashboard lọc theo `inProductionAt` (§7.0), nên đơn thiếu mốc này là đơn **tàng hình** — import báo thành công nhưng không lọt qua bất kỳ khoảng ngày nào, không ai soát tool / gán designer / vào fulfillment được. Cùng nguyên tắc với `pushToProduction` của Customer Portal.
- Parse designs: detect column như `Front`, `Back Design`, `Sleeve`, ... → nest vào `designs.{key}`
- **Vận đơn khách tự cấp (ORD-26)**: 4 cột `Tracking Number` / `Tracking Carrier` / `Tracking URL` / `Shipping Label` (kèm alias `tracking_id`, `tracking_code`, `carrier`, `label_url`…) → `row.tracking`. Khác 39 cột còn lại, mấy cột này dò **theo TÊN header** chứ không theo vị trí: sheet đang chạy ở xưởng chưa có chúng, mà file mỗi nơi xuất ra lại đặt ở chỗ khác nhau — dò theo tên thì sheet cũ vẫn parse y như trước, sheet mới thêm cột ở đâu cũng nhận đúng. Mọi ô trống → `undefined` để BE **không ghi đè** vận đơn đã nhận lúc import lại. BE lưu snapshot `OrderEntity.tracking` + ghi record vào module vận đơn — xem [`VnpShipping.md §2c`](VnpShipping.md).

### 3.3 Upsert behavior (BE)
```ts
for (row of rows):
  found = orderRepo.findByProductionId(row.productionId)
  if found:
    updated++ // overwrite các field row.* (giữ workshop fields đã chỉnh)
  else:
    imported++

  // Mapping qua product config (auto-derive xưởng + máy + vải)
  config = productConfig.findByType(row.type)
  if config:
    set productConfigId, factoryId, machineTypeId, isMapped=true
    // insertOnly — chỉ gắn khi tạo mới, không overwrite giá trị workshop đã chỉnh
    insertOnly.originalFactoryId = factoryId
    if config.fabricType: insertOnly.fabricType = config.fabricType
    // KHÔNG set insertOnly.toolResult nữa — đơn mới LUÔN để trống `toolResult`
    // (kể cả product config có default) để tool tự động soát nhận diện đúng
    // đơn "chưa soát" và tự chạy, thay vì bị default che mất.
    mapped++
  else:
    isMapped=false
    unmapped++

  // URL pipeline (xem Design-R2-Pipeline.md)
  //   - mockupUrl = mockupOriginalUrl = raw URL user paste
  //   - designsOriginal = clone(row.designs)
  //   - designs.{k}: rỗng + designsStatus.{k}='pending' khi R2 đã configure
  //     (worker BullMQ ghi sau khi download/encode/upload xong) — nếu R2 chưa
  //     configure (env R2_* trống) → designs.{k} = raw URL để không transform
```

`fabricType` được **derived từ product config** tại lúc import — workshop không phải gõ tay. Nếu product config thay đổi sau khi import (admin chỉnh fabric default), gọi `POST /v1/orders/backfill-fabric` để re-derive cho các đơn còn thiếu (chỉ điền chỗ trống, **không overwrite** giá trị admin đã chỉnh).

`toolResult` **KHÔNG còn được default từ product config lúc import** (API OnosPod lẫn CSV) — đơn mới luôn tạo với `toolResult` rỗng, để hàng đợi "Public API cho tool ngoài soát" (`GET /v1/orders/design-review/next`, xem `§18` bên dưới) nhận diện đúng đơn chưa soát và tự chạy tool, thay vì bị default từ config che mất. `ProductConfigEntity.toolResult` (field cấu hình "Kết quả Tool mặc định") vẫn còn trong schema nhưng KHÔNG còn nơi nào đọc để copy vào đơn nữa.

**Đơn đang GIỮ không bị ghi đè design khi import lại** (TASK-04, áp MỌI nguồn gọi `importOrders()`: CSV, OnosPod, `pushToProduction` của Customer Portal): đơn đã tồn tại mà `heldAt` có giá trị (giữ tay hay giữ theo OnosPod §9d đều vậy) → bỏ `designs`/`designsOriginal`/`designsStatus` khỏi `$set` và KHÔNG tạo design job cho đơn đó; mọi trường khác (`status`, `factoryId`, `type`, tracking…) vẫn cập nhật như cũ. Lý do: `designsOriginal` là mốc so sánh của cron lấy ngược design (§9c) — import ghi đè thì cron mất dấu khách đã sửa design. Hàm đọc `heldAt` trong cùng `findOne` snapshot `beforeDoc` trước upsert.

### 3.4 Trùng productionId
- **Update**, **không** tạo duplicate
- Field nào row mới có → overwrite, field nào không có → giữ nguyên giá trị cũ

### 3.5 Daily summary (`GET /v1/orders/import-summary?date=YYYY-MM-DD`)
Sau import (hoặc khi đổi date), `ImportOrderTab` gọi endpoint này để hiện bảng "Tổng hợp đơn theo ngày":
- BE aggregate theo `(type, size, fabricType)` của các order có `orderAt` trong ngày (đổi từ `createdAt` tháng 2026-06) — gộp đơn theo ngày khách đặt, không phải ngày import. Xem §7 lưu ý filter ngày.
- Sort `orderCount` desc → tổ hợp trùng nhiều nhất xếp đầu (top 3 highlight amber).
- Mỗi group trả `totalQuantity`, `orderCount`, `sampleProductionIds` (5 cái đầu), `fabricName` (resolve từ workshop_config).
- UI hiển thị progress bar tương đối theo group có count cao nhất → workshop nhìn ra ngay combo nào cần in batch chung.

### 3.6 Lấy đơn tự động từ OnosPod QC (nút "Lấy đơn từ OnosPod")

Thay cho thao tác thủ công hàng ngày (8h/17h): vào `qc.onospod.com` bấm export → tải file
xlsx → paste vào tab Import. Nút "Lấy đơn từ OnosPod" (chỉ hiện ở mode `new`) tự động hoá
toàn bộ chuỗi này trong 1 click.

Cạnh nút có 1 `DateRangePicker` (`apps/web/src/components/common/DateRangePicker.tsx`, component
dùng chung toàn app) cho phép chọn khoảng ngày tùy ý — state `onosPodFrom`/`onosPodTo` ở
`ImportOrderTab.tsx`. Để trống (mặc định) → gọi `POST /v1/orders/import-from-onospod` với
body `{}`, BE tự tính period theo giờ gọi (xem bên dưới). Nếu chọn cả 2 ngày → FE convert
sang ISO datetime bằng `dayjs(from).startOf('day').toISOString()` /
`dayjs(to).endOf('day').toISOString()` rồi truyền `{ start, end }` — khớp `ImportFromOnosPodZod`
(`packages/shared/dtos/production-order.dto.ts`).

**Cách lấy dữ liệu:** query GraphQL `paginateMrpProduct` trực tiếp (KHÔNG dùng cơ chế
export/tải file — thử ban đầu nhưng mutation `createExportProductionReport` chạy bất đồng
bộ và không tìm được API polling đúng, xem lịch sử ở git log nếu cần). `paginateMrpProduct`
trả JSON structured ngay lập tức, nhanh hơn nhiều và không cần chờ. Pull từ **TẤT CẢ
manufacture** của account trong **1 lượt phân trang duy nhất** — KHÔNG truyền tham số
`manufacture_id` (verify bằng test gọi thật 2026-07-18: tổng `total_items` khi bỏ trống
`manufacture_id` khớp 100% với cộng dồn kết quả gọi riêng từng manufacture: ML 299 + TN 216 +
GRABINK 15 + 2DUS 0 = 530). Trước đây phải gọi `manufactures` lấy danh sách rồi loop tuần tự
từng manufacture — đã bỏ, vì mỗi item trả về đã tự mang sẵn field `manufacture{_id,name,sku}`.

```
User bấm "Lấy đơn từ OnosPod"
  → POST /v1/orders/import-from-onospod (body {} → BE tự tính period theo giờ gọi, xem bên dưới)
  → OnospodImportService:
      1. Gọi ĐỒNG THỜI (`Promise.all`) 1 lượt phân trang riêng cho từng status trong
         `MRP_STATUSES = ['To Do', 'Ready']` (query GraphQL chỉ nhận `status: String` đơn,
         KHÔNG phải mảng → không gộp filter được, phải gọi riêng) — 2 lượt độc lập không
         cần chờ nhau nên chạy song song thay vì tuần tự, `.flat()` gộp kết quả lại. Mỗi
         lượt: loop page=1.. gọi `paginateMrpProduct(mrp_status=status, start, end, page,
         perpage=500)` — KHÔNG truyền `manufacture_id` — tới khi hết `paginate.total_pages`.
         (Bearer token tĩnh lưu trong env `ONOSPOD_QC_API_URL` /
         `ONOSPOD_QC_BEARER_TOKEN` — đọc qua `ApiConfigService.onospodQcConfig`, trả `null`
         nếu chưa cấu hình thay vì crash app boot, giống `r2Config`)
      2. Map từng `MrpProduct` → `ImportProductionOrderRow` (field mapping xác nhận qua
         test đối chiếu 1:1 với dòng CSV export thật — xem bảng field mapping bên dưới)
      3. `groupByManufacture()` — group lại TẤT CẢ item theo field `manufacture` có sẵn
         trên mỗi item (KHÔNG gọi/loop riêng) → chỉ để hiển thị số lượng theo manufacture
         trên toast FE, KHÔNG ảnh hưởng mapping xưởng nội bộ (vẫn qua `ProductConfig` như
         CSV, xem §3.1/§3.3)
      4. Lượt gọi THỨ HAI lấy ĐỊA CHỈ GIAO của khách (2026-09-16):
         `OnospodOrderLookupService.lookupShippingByOrderIds()` — query `orders(ids)`
         theo LÔ 50 trên `api.onospod.com` (env `ONOSPOD_API_*`, KHÁC token QC; địa chỉ
         nằm ở mức ORDER, `paginateMrpProduct` mức production item KHÔNG có). Key lô =
         `item.order_id` (Mongo `_id` order cha, MRP item mang sẵn) — dedupe trước, đơn
         nhiều item chỉ tra 1 lần; id lọc `isValidObjectIdHex` (hex 24) trước khi nhúng
         vào query. ⚠️ Phân trang OnosPod ở HEADER `x-page`/`x-per-page` — per-page phải
         ≥ số ids gửi (search rỗng KHÔNG kèm header → 502, verify gọi thật 2026-09-16).
         Bước LÀM GIÀU: method KHÔNG BAO GIỜ throw — thiếu config/OnosPod lỗi thì import
         vẫn chạy, chỉ thiếu địa chỉ (log Winston `action:'onospodShippingBatch'`).
      5. Gọi lại OrderService.importOrders({ rows }) MỘT LẦN cho toàn bộ rows đã gộp —
         TÁI DÙNG 100% pipeline upsert/mapping/design-job/notification đã có ở §3.1/§3.3
         (row có `shippingAddress` → `$set` lên đơn, xem guard đơn giữ bên dưới)
  → Response giống ImportProductionOrdersResDto + { totalFetched, period, byManufacture[],
     shippingAttached } (byManufacture: { id, name, sku, fetched, error? } — hiện trên
     toast FE; `error` giờ luôn rỗng vì gọi 1 lượt duy nhất, fail = throw luôn thay vì
     cô lập theo manufacture; `shippingAttached` = số row gắn được địa chỉ — 0/thấp bất
     thường nghĩa là OnosPod order API lỗi/thiếu `ONOSPOD_API_*`, toast FE có hiện)
```

**Field mapping (`MrpProduct` GraphQL → `ImportProductionOrderRow`):**

| Field đích | Nguồn GraphQL | Ghi chú |
|---|---|---|
| `productionId` | `increment_id` | |
| `orderId` | `increment_order_id` | |
| `userSku` | `auth.identity_label` | |
| `userEmail` | `auth.email` | |
| `type` | `product_type.name` | |
| `mockupUrl` | `src` | |
| `designs.{key}` | quét ĐỘNG mọi key `design_*` trong `print` (`extractDesigns()`) — snake→camel (`design_chest_left`→`chestLeft`), đối chiếu whitelist 18 key `DesignFields`; response chỉ chứa key ở vị trí đơn CÓ design | query thêm vị trí mới là tự map, không phải sửa code; key lạ ngoài `DesignFields` bị bỏ qua |
| `designs.frontEmbroidery` / `backEmbroidery` | fallback khi quét động chưa có: `print.print_areas_customs[]` — entry `is_embroidery=true` + `file.src`, match front/back qua `key`/`name` lowercase (`pickEmbroiderySrc()`) | nguồn mới từ khi đồng bộ `PAGINATE_QUERY` với query thật FE OnosPod (2026-07); không match → để trống |
| `status` | `mrp_status` | filter `status` lấy TỪNG giá trị trong `MRP_STATUSES = ['To Do', 'Ready']` (gộp kết quả) — chỉ lấy đơn MỚI/chưa in, KHÔNG lấy status sau đó (In Production/Done/...). Thêm `'Ready'` từ 2026-07-31: đơn có thể chuyển "To Do"→"Ready" rất nhanh trên OnosPod, nếu chỉ lọc "To Do" sẽ lọt mất dù đúng khoảng ngày (case thật: `XQ-91783-27005`) |
| `quantity` | `quantity` | |
| `inProductionAt` | `mrp_created_at` (ISO) → format VN local | |
| `orderAt` | decode timestamp từ 4 byte đầu của `order_id` (ObjectId) → format VN local | **KHÔNG có field ngày riêng** — order_id là Mongo ObjectId, tự chứa timestamp tạo doc |
| `size` | `print.meta_data` key `"Size"` | nguồn chính thức OnosPod dùng cho export xlsx — nhận mọi giá trị ("5x78in-Pointed", "L"...), KHÔNG dùng heuristic SKU |
| `color` | `print.meta_data` key `"Color"` | vd "As Design"; null với 1 số sản phẩm |
| `baseCost` | `price` (parse number) | field gộp, KHÔNG tách được base/ship |
| `weight`, `width`, `height`, `length`, `shipCost`, `externalId`, `referent` | — | không tìm được field nguồn nào trên schema (đã probe qua GraphQL error "Did you mean" — introspection bị chặn), để trống (đều optional) |
| `shippingAddress` | lượt gọi thứ 2 `orders(ids: [order_id])` bên `api.onospod.com` → `order.shipping.{first_name,last_name,company,address_1,address_2,city,state,postcode,country,email,phone}` (snake→camel, cùng mapper `toShippingAddress()` với §9c) | địa chỉ mức ORDER — item cùng đơn dùng chung; OnosPod lỗi/thiếu `ONOSPOD_API_*` → để trống, import vẫn chạy. **Guard ở `importOrders`**: đơn đang GIỮ `holdReason=HOLD_REASON_WAITING_ADDRESS` + đã có snapshot → KHÔNG đè (snapshot cũ là baseline cron §9c so để phát hiện khách đã đổi → mở giữ; đè = tín hiệu bị nuốt, đơn giữ vĩnh viễn). Đơn khác re-import đè bình thường (địa chỉ tươi hơn) |

**Dedupe trong batch:** cùng 1 `productionId` có thể lặp lại giữa các trang (data live dịch
chuyển khi đang phân trang) — `dedupeByProductionId()` gom trước khi gọi `importOrders()`
(giữ bản ghi xuất hiện sau cùng), tránh lệch số liệu `imported`/`updated`. Response trả thêm
`duplicatesInBatch`. Chống trùng ở tầng DB: `orders.productionId` có **unique index** (schema
đã khai báo `unique: true` nhưng Mongoose autoIndex không tự tạo trên DB restore từ dump —
phải `createIndex` tay; nhớ bước này khi restore DB mới) — chặn race 2 request import đồng
thời (cron + nút UI) cùng insert 1 đơn.

**Error semantics (quan trọng cho cron monitoring):**
- Batch rỗng (không có đơn "To Do"/"Ready" mới — sáng vắng/ngày lễ) → **200 success** với
  `totalFetched: 0`, KHÔNG phải 400 — tránh báo động giả làm nhờn cảnh báo.
- Fetch lỗi (token hết hạn, OnosPod down, network) ở BẤT KỲ trang nào → **400**, throw ngay
  (KHÔNG còn cô lập lỗi theo từng manufacture như trước — giờ chỉ 1 lượt phân trang duy
  nhất nên fail = fail toàn bộ).
- `start`/`end` nhận cả ISO có offset (`+07:00`) lẫn `Z` (Zod `datetime({offset:true})`).
  Truyền `start` không kèm `end` → `end` = thời điểm gọi (backfill). Truyền `end` lẻ → 400.

**Lịch chạy do EXTERNAL crontab quản lý** (KHÔNG dùng `@nestjs/schedule` nội bộ — đã bỏ,
xem git history nếu cần bản cũ) — endpoint public để crontab `curl` trực tiếp, không cần
config token/env:

```
GET /v1/orders/import-from-onospod/cron
```

- **Public — không cần Authorization header** (`@Auth([], [], { public: true })`). `RateLimiterGuard`
  vẫn áp dụng (per-IP) dù bỏ qua JWT — hạn chế spam nhưng KHÔNG có auth thật; ai biết URL đều
  gọi được và trigger ghi dữ liệu thật + gọi OnosPod API tốn quota. Chấp nhận đánh đổi này theo
  yêu cầu "không cần config trong env" — cân nhắc thêm firewall rule giới hạn nguồn gọi nếu cần
  chặt hơn.
- **Tự tính period theo giờ gọi thực tế** (`OnospodImportService.resolvePeriod()`, giờ VN):
  - Gọi **trước 12h trưa** → lấy đơn từ **12h trưa hôm trước** tới hiện tại.
  - Gọi **từ 12h trưa trở đi** → lấy đơn từ **00h00 hôm nay** tới hiện tại.
  - Logic này cũng là default khi gọi `POST /v1/orders/import-from-onospod` (nút "Lấy đơn từ
    OnosPod" trên UI) mà không truyền `start`/`end` — dùng chung 1 rule cho cả 2 đường vào.
  - Không cộng buffer riêng — biên 12h trưa/00h00 đã đủ rộng cho lịch 2 lần/ngày (8h + 17h),
    và `importOrders()` upsert theo `productionId` nên overlap giữa các lần gọi không tạo
    trùng dữ liệu, cứ gọi lại thoải mái nếu nghi ngờ sót đơn.
- User tự cấu hình crontab hệ thống (hoặc dịch vụ cron ngoài) gọi `curl` vào URL trên đúng
  8h00 và 17h00 hàng ngày — app không tự chạy cron nội bộ nữa.

---

## 4. Backend module `order/`

### 4.1 Files
| File | Mô tả |
|------|-------|
| `order.entity.ts` | Schema + 4 virtual (`factory`, `originalFactory`, `machineType`, `productConfig`) |
| `order.repository.ts` | Extends DatabaseRepositoryAbstract |
| `order.service.ts` | `getOrders`, `getDashboard`, `getStatusOverview`, `getFactoryOverview`, `getOrdersGroupedByType`, `getImportSummary`, `exportOrders`, `importOrders`, `updateField`, `bulkUpdateField`, `transferOrder`, `bulkTransferOrders`, `backfillOrderFabric`, `deleteOrder` |
| `onospod-import.service.ts` | `OnospodImportService.importFromOnosPod()` — query GraphQL `paginateMrpProduct` từ `qc.onospod.com`, map JSON → rows + gắn `shippingAddress` qua `lookupShippingByOrderIds()` (lượt 2, `api.onospod.com`) rồi gọi lại `OrderService.importOrders()`. Xem §3.6. Unit test `onospod-import.spec.ts`. |
| `order.controller.ts` | Endpoints (xem §4.2) |

### 4.2 Endpoints
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/v1/orders` | List (filter + paginate, visibility filter theo role) — cache 60s key có gắn `role`. Populate `factory`/`machineType`/`productConfig (fullName, shortName, mockup, level)` — mockup/level phục vụ panel drill-down Dashboard Designer gom nhóm theo sản phẩm (`Dashboard.md §0b`). |
| GET | `/v1/orders/grouped` | Phân trang theo **product type** thay vì row (Phase 4 — workshop cần combo toàn vẹn) |
| GET | `/v1/orders/overview-list` | Giống `GET /orders` (cùng filter: date/toolResultNote/assignee/designerStatus…) NHƯNG **KHÔNG áp visibility filter theo role** → gọi `getOrders(dto)` với `roleName=undefined`. Dùng cho **drill-down bấm con số** ở Dashboard: mọi role (Designer/Support/Fulfillment…) thấy **CÙNG tập đơn** khớp con số như admin; cột hiển thị vẫn lọc theo quyền qua `canViewField` ở FE. Xem `Dashboard.md §0b`. |
| GET | `/v1/orders/by-ids?ids=<CSV _id>&page&limit` | Lookup đơn theo danh sách `_id`, full workshop fields (populate factory/machineType/productConfig), **KHÔNG áp visibility filter theo role** (`getOrdersByIds`). Dùng cho **lazy-load bảng đơn đầy đủ inline** khi mở rộng 1 nhóm ở "Cần gán designer" Dashboard (nhóm gồm đơn CHƯA gán → `getOrders` sẽ ẩn hết với role Designer do scoping `assignee=self`). Cũng dùng được cho `OrderListDialog` (prop `ids?: string[]`). Xem `Dashboard.md §0c`. |
| GET | `/v1/orders/dashboard` | Aggregation (xem `Dashboard.md` Tab A) — cache 60s |
| GET | `/v1/orders/status-overview` | Aggregation (xem `Dashboard.md` Tab B) |
| GET | `/v1/orders/factory-overview` | Aggregation (xem `Dashboard.md` Tab C) |
| GET | `/v1/orders/export` | Trả toàn bộ đơn theo filter, **không phân trang**. Dùng cho Excel export Tab C. Nhận thêm param `ids` (CSV `_id`) → xuất đúng đơn đã tick chọn (`BulkEditToolbar`, xem §8.6). |
| GET | `/v1/orders/fulfillment-status-counts` | Đếm đơn theo 5 trạng thái stage Fulfillment (waiting/in-progress/rework/done/watching) — dùng cho thanh filter trang "In". Xem `FulfillmentWorkflow.md §4.5`. |
| GET | `/v1/orders/import-summary?date=YYYY-MM-DD` | Bảng tổng hợp `(type, size, fabricType)` theo ngày import. Phase 5. |
| GET | `/v1/orders/:id/logs` | Audit timeline 1 order (xem `OrderLog.md`) |
| GET | `/v1/orders/error-log` | Tab "Nhật ký bù lỗi" — mọi đơn từng lỗi (productionError set), 2 sub-tab `tab=todo\|done` positional theo chặng viewer. Trả thêm `byUrgency`. Xem `§14`. |
| POST | `/v1/orders/:id/resolve-error` | Admin/Manager đánh dấu hoàn thành lỗi tồn đọng → set `errorResolvedAt`, đơn rời tab "Cần xử lý". `@Auth([SuperAdmin,Admin,Manager])`. Xem `§14.3`. |
| POST | `/v1/orders/bulk-resolve-error` | Đánh dấu hoàn thành lỗi HÀNG LOẠT (`{ids}` → `updateMany`). `@Auth([SuperAdmin,Admin,Manager])`. |
| POST | `/v1/orders/import` | Bulk upsert. `ORDER_WRITE_ROLES` (Admin / Manager / Support). |
| POST | `/v1/orders/import-from-onospod` | Tự động fetch export từ OnosPod QC + import (xem §3.6). `ORDER_WRITE_ROLES`. Body optional `{ start?, end? }` ISO string — mặc định tự tính theo giờ gọi (trước/sau 12h trưa). |
| GET | `/v1/orders/import-from-onospod/cron` | **Public** (không cần auth) — bản GET không tham số cho external crontab `curl`. Cùng logic period tự tính. Xem §3.6. |
| POST | `/v1/orders/cutting-files/preview` | Preview cutting-file mapping — fetch tên file từ Drive + parse productionId + match đơn. Xem §15. |
| POST | `/v1/orders/cutting-files/apply` | Apply mappings (bulk write `cuttingFileUrl/Name`) + audit log event `production-file-mapped`. |
| POST | `/v1/orders/backfill-fabric` | Re-derive `fabricType` + `toolResult` từ product config cho đơn còn thiếu (non-destructive). |
| PATCH | `/v1/orders/:id/field` | Inline update 1 workshop field. Phase 2. |
| PATCH | `/v1/orders/bulk-field` | Bulk apply 1 field cho nhiều order. Phase 2. |
| PATCH | `/v1/orders/:id/transfer` | Chuyển 1 đơn sang xưởng khác. Phase 7. `ORDER_WRITE_ROLES`. |
| PATCH | `/v1/orders/bulk-transfer` | Chuyển nhiều đơn sang xưởng khác. Phase 7. Pre-filter ID đã ở target. |
| POST | `/v1/orders/:id/tool-check-done` | Nút "Đã soát xong" (tab Soát tool, list "Cần làm lại") — đơn hold cần thiết kế → designer cũ (rework) / auto-gán / backlog "Cần gán". `@Auth([SuperAdmin,Admin,Manager,SupportManager,Support])`. Xem `ToolCheckWorkflow.md §2.2b`. |
| DELETE | `/v1/orders/:id` | Soft delete (Admin only) |

### 4.3 Cache
- Key list: `orders:list:${md5(query)}` TTL 60s, key có gắn `role` để Designer / Fulfillment không kế thừa cache của Admin (visibility filter khác).
- Invalidate khi: import / update field / bulk field / transfer / bulk-transfer / delete order.

---

## 5. Schema `OrderEntity`

> Shared: `ProductionOrder` (= `z.infer<ProductionOrderZod>`, `_id` optional theo `BaseEntityZod`) + helper type `ProductionOrderRow = ProductionOrder & { _id: string }` cho row đã lưu DB — FE dùng cho list/kanban/scan dialog để khỏi phải guard `_id` từng chỗ.

```ts
{
  productionId: string;        // unique index
  userSku?: string;
  userEmail?: string;
  type?: string;               // index
  color?: string;
  size?: string;
  mockupUrl?: string;          // raw URL (Drive/CDN/...) — không transform
  mockupOriginalUrl?: string;  // = mockupUrl (giữ để FE share/copy)
  printMethod?: string;
  weight?, width?, height?, length?: number;
  quantity: number;            // default 1
  baseCost?, shipCost?: number;
  designs?: DesignFields;      // R2 CDN URLs (worker ghi sau khi xử lý) hoặc raw URL khi R2 chưa configure
  designsOriginal?: DesignFields; // Raw URL user paste lúc import
  status?: string;
  orderId?, externalId?: string;
  referent?: string;
  tracking?: { number?, carrier?, url?, labelUrl? }; // ORD-26 — vận đơn KHÁCH TỰ CẤP (CSV khách/CSV admin/Public Order API).
                               // Snapshot mỏng để list render không phải join; nguồn sự thật là record `shipments`
                               // provider 'customer' (VnpShipping.md §2c). KHÁC `vnpShipment` = label hệ thống tự mua.
                               // Index `tracking.number`. Import lại mà file không có cột tracking thì KHÔNG ghi đè.
  orderAt?, inProductionAt?: Date;
  isMapped: boolean;           // default false, index
  productConfigId?: ObjectId;  // ref ProductConfig
  factoryId?: ObjectId;        // ref Factory — xưởng HIỆN TẠI (mutate qua transfer)
  originalFactoryId?: ObjectId;// ref Factory — xưởng GỐC tại import (immutable, Phase 7)
  machineTypeId?: ObjectId;    // ref MachineType

  // ─── Workshop fields (Phase 2 + 7) ───
  printStatus?: string;        // workshop_config code, index
  printStatusNote?: string;
  toolResult?: string;         // derived từ productConfig.toolResult lúc import (Phase 7)
  toolResultNote?: string;     // index — quan trọng vì điều khiển readyForFulfill
  errorFile?: string;
  errorFileNote?: string;      // free text
  assignee?: string;           // = user._id (string). Phase Designer-Task-Workflow Phase 6 đổi từ workshop_config code → userId thuần. Index.
  assigneeNote?: string;
  fabricType?: string;         // workshop_config code (category=fabric_type), index — derived từ productConfig.fabricType lúc import (Phase 7)
  machineNumber?: string;      // workshop_config code (category=machine), index

  // ─── Production error (Phase 8 + Fulfillment per-factory) — xưởng báo lỗi đơn hàng ───
  productionError?: string;    // workshop_config code (category=production_error), index. Set khác null/empty ⇒ đơn ở trạng thái "có lỗi".
  productionErrorNote?: string;// free text mô tả chi tiết lỗi
  productionErrorSource?: 'designer' | 'factory'; // index. Auto-fill từ workshop_config.errorSource khi user set productionError; user override được. 'other' bắt buộc user pick (BE 400 nếu thiếu).
  productionErrorCount: number;// default 0. $inc mỗi lần xưởng set productionError (cumulative, không reset). FE hiển thị "Lỗi ×N" trên cell toolResultNote khi count ≥ 2.
  productionFirstErrorAt?: Date; // index. Set khi `productionError` chuyển null→value (và field chưa có giá trị) → mốc bắt đầu "đang chờ xử lý lỗi" của cycle hiện tại. Clear (=null) khi đơn rời tab "Nhật ký bù lỗi": `toolResultNote='ok'` (qua `updateField`/`bulkUpdateField`/`importRework` **VÀ qua `DesignerTaskService.transition(complete)`** — designer fix rework xong) HOẶC `productionError` được clear. Dùng cho sort + tính mức độ khẩn cấp (24h/48h/72h).

  // ─── Designer task workflow (xem DesignerTaskWorkflow.md) ───
  designerStatus: DesignerStatus;   // enum, default unassigned, index
  designerAssignedAt?, designerStartedAt?, designerFirstStartedAt?, designerCompletedAt?, designerRejectedAt?, designerReworkAt?: Date;
  designerRejectedReason?: string;
  designerReworkCount: number;      // $inc khi xưởng báo lỗi designer
  designerWorkMs: number;           // cumulative work time (ms), $inc khi complete

  readyForFulfill: boolean;    // derived = (toolResultNote === 'ok' OR productionError set). default false, index. Mềm hoá invariant: khi xưởng báo lỗi (toolResultNote='error') vẫn giữ true để fulfillment thấy trong list mặc định.
}
```

`originalFactoryId` được backfill cho legacy rows ngay tại `OrderService.onModuleInit()`:
```ts
updateMany(
  { originalFactoryId: { $exists: false }, factoryId: { $exists: true, $ne: null } },
  [{ $set: { originalFactoryId: '$factoryId' } }]
)
```
→ Mọi đơn legacy được xem là **pure** (chưa từng chuyển xưởng).

Tất cả workshop fields lưu **code** từ `WorkshopConfigEntity`. FE render qua `useWorkshopConfigStore.resolve(category, code)` → ra `name + color/icon`. Xem `WorkshopConfig.md`.

### 5.1 DesignFields (18 vị trí in)
`front`, `back`, `sleeve`, `hood`, `folder`, `placket`, `chestLeft`, `chestRight`, `left`, `right`, `sleeveLeft`, `sleeveRight`, `leftUpperSleeve`, `rightUpperSleeve`, `leftCuff`, `rightCuff`, `frontEmbroidery`, `backEmbroidery`

### 5.2 Indexes
- `productionId` (unique) — dedupe import
- `type`, `orderId`, `externalId`, `isMapped`, `factoryId`, `originalFactoryId`, `machineTypeId`, `printStatus`, `toolResultNote`, `assignee`, `fabricType`, `machineNumber`, `productionError`, `productionErrorSource`, `designerStatus`, `readyForFulfill` — filter + aggregation perf

### 5.3 Virtuals
- `factory` (`factoryId` → `FactoryEntity`)
- `originalFactory` (`originalFactoryId` → `FactoryEntity`)
- `machineType` (`machineTypeId` → `MachineTypeEntity`)
- `productConfig` (`productConfigId` → `ProductConfigEntity`)

---

## 6. URL pipeline (R2 self-hosted)

Xem chi tiết: [`documents/Plans/Design-R2-Pipeline.md`](../Plans/Design-R2-Pipeline.md). Tóm tắt:

- **Mockup URL**: lưu raw (no transform). `mockupUrl = mockupOriginalUrl = URL user paste`.
- **Design URL**: nếu R2 đã configure (`R2_*` env đủ) → enqueue BullMQ job `design-image`, worker tải về → resize webp 2 variant → upload R2 → ghi `designs.{k} = https://<R2_PUBLIC_BASE>/designs/preview/{hash}.webp`. Trước khi worker xong, `designsStatus.{k} = 'pending'` (FE show spinner amber).
- Nếu R2 **chưa** configure → `designs.{k} = designsOriginal.{k} = raw URL`, không tự transform. BE log warning. FE preview có thể không render được URL Drive `?usp=sharing` — phải setup R2 để pipeline hoạt động đầy đủ.
- Helper: `apps/api/src/utils/design-url.ts` (`extractDriveId`, `hashForR2`, `buildR2Url`, `buildDriveDownloadUrl`).

---

## 7. Visibility theo role (Phase 2 + Fulfillment per-factory)

Mỗi request `GET /v1/orders` đi qua `OrderService.buildVisibilityFilter(roleName, dto, assigneeUserId?, fulfillmentFactoryId?)` để giới hạn tập kết quả trước khi áp filter của client:

| Role | Filter mặc định |
|------|------------------|
| `SuperAdmin` / `Admin` / `Manager` / `Support` / `DesignerLeader` | Không giới hạn (có thể truyền `createdFrom`/`createdTo` để filter ngày — semantics: filter trên `orderAt`, xem §7.0) |
| `Designer` (sub) | `assignee = user._id` — chỉ thấy task của mình (KHÔNG ép date window, đã narrow bởi assignee). Phase Designer-Task-Workflow Phase 6 đổi từ `assigneeCode` → `user._id`. |
| `Fulfillment` | `orderAt` ∈ [7 ngày gần nhất] **AND** `readyForFulfill = true` **AND** `$or: [{factoryId: user.factoryId}, {originalFactoryId: user.factoryId}]` — Per-factory scope (cả 2 xưởng thấy đơn transfer). Nếu user chưa gán `factoryId` → filter trả empty (an toàn). |

> **§7.0 Lưu ý filter & sort ngày (cập nhật 2026-06):** DTO `createdFrom` / `createdTo` (cộng `wfrom` / `wto` ở URL Workshop, `ffrom` / `fto` ở Factory dashboard, `startDate` / `endDate` ở Dashboard stats) được giữ tên cũ để không phá URL bookmark, **nhưng thực tế filter + sort đều trên `inProductionAt`** (thời gian đơn vào sản xuất theo sheet import).
>
> Tiến triển:
> 1. **Cũ:** filter + sort theo Mongo `createdAt` (thời gian import doc) → đơn cùng batch cluster bất kể thật sự sản xuất khi nào.
> 2. **Phase 2026-06 sớm:** đổi filter sang `orderAt` (thời gian khách đặt hàng marketplace) cho phù hợp business.
> 3. **Phase 2026-06 hiện tại:** đồng bộ filter + sort sang `inProductionAt` — manager mở Dashboard "hôm nay" thấy đơn **VÀO sản xuất hôm nay**, không phải đơn khách đặt hôm nay. Đây là metric mà xưởng care nhất (capacity tracking, queue depth).
>
> **Áp dụng filter** (5 vị trí trong `order.service.ts`): `buildVisibilityFilter()` (Designer/Fulfillment/general date override), `getDashboard()`, `getStatusOverview()` today count, `getImportSummary()` day group, `getFactoryOverview()`.
>
> **Áp dụng sort** (9 vị trí): `getOrders()` (grouped + default), `exportOrders()`, `getOrdersGroupedByType()`, `DesignerTaskService.getMyTasks()` (4 cột kanban), `FulfillmentTaskService.getMyTasks()`.
>
> Đơn legacy không có `inProductionAt` → bị loại khỏi date filter + Mongo desc sort đẩy về cuối list — chấp nhận (data cũ là test).
>
> Field có `@Prop({ index: true })` trên entity để tránh full collection scan.
>
> **Vẫn giữ `createdAt`** ở: `orderLogRepository.findAll({sort:{createdAt:1}})` (audit log chronological), `backfillDesignerStatus()` fallback (one-shot migration), `User.createdAt`, Mongoose auto timestamps. **Vẫn giữ `orderAt`** ở: `parseImportDate(row.orderAt)` (import field từ sheet, lưu cho reference + future analytics).
> Trường `orderAt` được import từ cột 37 ("Order at") của sheet. Đơn cũ thiếu `orderAt` sẽ bị filter loại khỏi date range — do data hiện tại là test, không backfill.
>
> **Timezone (quan trọng):** filter "yyyy-mm-dd" được parse là **VN local midnight** (qua helper `vnDayStart` / `vnDayEnd` ở `order.service.ts`). Lý do: MongoDB lưu UTC, `new Date("2026-06-22")` của JS parse là UTC midnight = 07:00 sáng VN → lệch ngày. Helper thêm offset `+07:00` để filter "ngày 22-06" khớp với đơn có `orderAt` từ `2026-06-21T17:00:00Z` (= 00:00 VN 22-06) đến `2026-06-22T16:59:59Z`. Áp ở mọi nơi build range trong `OrderService`.
>
> **Import date parsing:** `parseImportDate()` ở `order.service.ts` parse string từ sheet (vd "2026-06-22 00:30:48") thành Date — **giữ nguyên HH:mm:ss + interpret là VN local** (append `+07:00` nếu chuỗi không có tz). Phía FE `ImportOrderTab.tsx` đọc xlsx với `cellDates: true` + `dateNF: 'yyyy-mm-dd HH:mm:ss'` để SheetJS không truncate time component theo cell display format.

`readyForFulfill` semantic mềm hoá: vẫn `true` khi xưởng báo lỗi (`toolResultNote='error'`) — để fulfillment thấy đơn lỗi trong list mặc định mà không cần switch filter. Set lifecycle: `complete` action (state machine designer) set `toolResultNote='ok'` + `readyForFulfill=true`; user clear `toolResultNote` qua updateField trực tiếp mới set false.

**Cross-feature — fulfillment entry hook:** Khi `toolResultNote` chuyển sang `'ok'` qua bất kỳ path nào (`updateField`, `bulkUpdateField`, `importRework`) **VÀ** đơn chưa từng vào fulfillment (`!currentFulfillmentStage`) → spread `buildFulfillmentEntrySet()` (`order.service.ts:155`) vào patch để đẩy đơn vào tab "Đang chờ" của user In + set `waitingAt` mốc nhận task. Đồng bộ với hook ở `DesignerTaskService.transition(complete)`. Chi tiết xem `FulfillmentWorkflow.md §2.1 + §5.4 Entry B`.

Controller pass `user._id` + `user.factoryId` cho tất cả endpoint GET. Xem `DesignerTaskWorkflow.md §5.5`.

### 7.x Query filter mở rộng

Ngoài các filter cơ bản (`createdFrom/To`, `factoryId`, `machineTypeId`, `printStatus`, ...), Phase 7 thêm:

| Query param | Format | Mô tả |
|-------------|--------|-------|
| `search` | string (nhiều token) | Contains-match (case-insensitive) trên `productionId` / `userSku` / `userEmail` / `orderId` / `type`. **Tách đa mã** qua helper module-scope `buildSearchOr(search)` (`order.service.ts`) — split `/[\s,]+/` → mỗi token 5 clause field → 1 flat `$or` (match nếu BẤT KỲ token khớp BẤT KỲ field). Token được escape regex. Dùng chung bởi cả 3 chỗ build search: `buildOrderListFilter` (list + factory), `getWorkshopAvailableFilters` (facet counts), `buildVisibilityFilter`-path (`~L5972`). **FE**: ô search ở `ListOrderTab` (input riêng) + `<OrderFilterBar>` (shared cho `OrderTableWorkshop` / `ErrorLogTab` / `OrderFactoryTab` / `OrderStatusTab`) — `onPaste` chuẩn hoá newline→khoảng trắng để dán 1 cột mã từ Google Sheets, badge "N mã" khi parse ra >1 mã (`parseProductionIds`). |
| `productionIds` | CSV | Bulk lookup — lọc đúng danh sách productionId (exact, case-insensitive qua `$in` regex anchored `^..$`). Dùng bởi `BulkProductionIdDialog` (mode filter). Build trong `buildOrderListFilter` ngay sau khối `search`. Khác `search`: exact + chỉ `productionId`. |
| `fabricType` | CSV codes | Lọc theo nhiều fabric. |
| `originalFactoryId` | CSV IDs | Lọc theo xưởng gốc. |
| `transferStatus` | token | `transferred` · `pure` · `transferred-in:<factoryId>` · `transferred-out:<factoryId>`. Build `$expr` so sánh `originalFactoryId` vs `factoryId`. |
| `printStage` | enum | `printed` · `printing` · `not-printed`. Mutually exclusive — Dashboard Tab C drill-down 3 button trên `FactoryCard`. Định nghĩa "đã in xong" = `printStatus ∈ PRINTED_MACHINE_CODES` (`['machine-1','machine-2','machine-3','machine-4','machine-94']`). |
| `productionError` | CSV codes | (Phase 8) Lọc theo lý do lỗi xưởng (`wrong-size`, `print-misalign`, ...). |
| `hasError` | boolean | (Phase 8) `true` → đơn có `productionError` set. `false` không hỗ trợ (dùng cách không truyền filter). |
| `errorSource` | CSV | Lọc theo `productionErrorSource` (`designer`/`factory`/`tool-check`) — filter generic theo nguồn lỗi hiện tại. Kết hợp `toolResultNote=error` → drill hàng "Cần làm lại" (In trả về) dải ngày tab Soát tool. |
| `toolResultNote` | CSV codes | Lọc note kq Tool. Token: `__none__` = chưa soát (null/''/missing) · `__any__` = ĐÃ soát, note bất kỳ (`$nin [null,'']`) · `__error__` = đã soát & ≠ 'ok' (`$nin [null,'','ok']`) — 2 token sau cho drill hàng "Đã soát"/"Soát lỗi" dải "Tổng quan theo ngày" tab Soát tool (`ToolCheckTab.tsx`). |
| `priority` | `'1'`\|`'2'`\|`'3'` | Lọc theo mức ưu tiên (`filter.priority = Number(...)`) — drill tab Soát tool mang theo filter "Ưu tiên" của tab. |
| `toolCheckedError` | `'1'` \| `'0'` | `'1'` → đơn TỪNG bị soát tool đánh note lỗi: `'toolCheckErrorNotes.0': {$exists:true}`; `'0'` → chưa từng (`$exists:false`) — lịch sử bền vững, xem `ToolCheckWorkflow.md`. Drill hàng "Soát lỗi" + 2 nhóm "Đẩy lại · từng lỗi/từng ok" bảng Tổng quan N ngày. |
| `toolErrorNote` | CSV codes | Lọc theo **mã lỗi soát tool MỚI NHẤT** của đơn (`$expr $in` trên `$arrayElemAt(toolCheckErrorNotes, -1)` — push vào `$and` để không đè `$expr` của `transferStatus`). Drill dòng mã lỗi trong tooltip hàng "Soát lỗi". |
| `assignee` | CSV user._id | Lọc theo designer được gán. Token: `__none__` = chưa gán (null/''/missing) · `__any__` = ĐÃ gán bất kỳ ai (`$exists + $nin [null,'']` — drill hàng "Đã gán designer" bảng Tổng quan N ngày). |
| `needDesigner` | boolean | `true` → pool cần/qua designer: `toolCheckErrorNotes` non-empty ∨ `designerStatus ∈ [assigned, in-progress, rework, done]` ($or push vào $and). Kết hợp `assignee=__none__` → drill hàng "Chưa gán designer" bảng Tổng quan N ngày. |
| `designBacklog` | boolean | `true` → union "Tổng tồn" lăng kính designer: chưa soát (note rỗng) ∨ đã gán & chưa xong (assignee + `designerStatus ∈ [assigned,in-progress,rework]`) ∨ đang lỗi & chưa gán (pool cần designer). Drill hàng Tổng tồn bảng Tổng quan N ngày. |
| `rejectedBy` | string | userId → đơn có sự kiện bàn giao "Không làm được" ĐI từ user (`designerRejections.fromUserId`). Drill hàng "Không làm được" panel thống kê 7 ngày (StatusBarCharts). Số ở ma trận/panel đếm LẦN — danh sách đơn distinct nên có thể ít hơn. |
| `receivedBy` | string | userId → đơn có sự kiện NHẬN bàn giao (`designerRejections.toUserId`). Drill hàng "Nhận thêm" panel thống kê 7 ngày. |
| `type` | **tham số lặp** hoặc 1 chuỗi | Lọc theo **tên loại sản phẩm**, khớp CHÍNH XÁC. `?type=A&type=B` → nhiều tên; `?type=A` → đúng một tên, lấy **nguyên văn**. Token `__none__` = đơn **chưa xác định loại sản phẩm** (field thiếu/null/rỗng). **KHÔNG tách bằng dấu phẩy** — xem cảnh báo §7.x.1 ngay dưới. |
| `sort` | `'grouped'` | Sort `(type, size, fabricType, inProductionAt desc)` thay vì `inProductionAt` mặc định — để combo trùng nhau gom liền nhau (Workshop dùng để in batch chung). |

#### 7.x.1 `type` là NGOẠI LỆ CÓ CHỦ Ý — đừng "dọn cho nhất quán"

Mọi facet CSV khác trong bảng trên (`userSku`, `fabricType`, `errorFile`, `productionError`…)
mang **mã/id**, nên dấu phẩy không bao giờ nằm trong giá trị. `type` mang **tên sản phẩm tự
do nhập từ file import** — dấu phẩy ở đây là **ký tự dữ liệu hợp lệ**, không phải ký tự phân
tách. Vì vậy `parseTypeFilter()` (`apps/api/src/modules/order/parse-type-filter.ts`)
**không** `.split(',')`.

Tách ra sẽ làm tên kiểu `"Tee, Long Sleeve"` bị hiểu thành 2 sản phẩm và **lọc sai âm thầm,
không báo lỗi**. Encode **không** cứu được: `URLSearchParams` mã hoá `,` thành `%2C` nhưng
tầng parse query giải mã ngược về `,` **trước khi** `split(',')` chạy — đã đo, xem
`.devtasks/design/ORD-1.md` §9 D1.

Token `__none__` tồn tại vì `getOrdersGroupedByType()` gom nhóm bằng
`$group: { _id: { $ifNull: ['$type', ''] } }`, tức trang Workshop **vẫn hiện nhóm "đơn không
tên"**. Không có token này thì hai trang cho hai tập đơn khác nhau ngay khi xuất hiện 1 đơn
thiếu `type`. Facet `type` trong `workshop-filters` trả kèm option `__none__` (label rỗng, FE
tự đặt nhãn) và **bỏ hẳn option khi count = 0**.

> **Còn một chỗ chưa xử, ngoài phạm vi:** `getFactoryOverview()` (`order.service.ts` ~L3501)
> vẫn `dto.type.split(',')` trên `GetFactoryOverviewDto` — DTO **khác**, phục vụ tab Xưởng ở
> Dashboard. Cùng cái bẫy, chưa sửa.

---

## 8. Inline / bulk update (Phase 2)

### 8.1 Whitelist field
13 field trong `ORDER_WORKSHOP_FIELDS` (shared):
`printStatus`, `printStatusNote`, `toolResult`, `toolResultNote`, `errorFile`, `errorFileNote`, `assignee`, `assigneeNote`, `fabricType`, `machineNumber`, `productionError`, `productionErrorNote`, `productionErrorSource`.

Mỗi field có category workshop_config tương ứng trong `FIELD_CONFIG_CATEGORY` (BE) trừ:
- Free-text: `errorFileNote`, `productionErrorNote`
- `assignee` — value là `user._id` (validate qua `assertAssigneeUserValid`, không workshop_config)
- `productionErrorSource` — enum cố định `designer | factory`

### 8.2 Role allow-list per field (`FIELD_EDIT_ROLES`)

| Field | Admin/Manager | Support | DesignerLeader | Designer (sub) | Fulfillment |
|-------|:-------------:|:-------:|:--------------:|:--------------:|:-----------:|
| printStatus / printStatusNote | ✅ | ❌ | ❌ | ❌ | ✅ |
| toolResult | ✅ | ❌ | ✅ | ✅ | ❌ |
| **toolResultNote** | ✅ | ❌ | ✅ | ❌ (BE auto derive khi state machine complete) | ❌ |
| errorFile / errorFileNote | ✅ | ❌ | ✅ | ✅ | ❌ |
| **assignee** | ✅ | ❌ | ✅ | ❌ (BE đặt qua state machine) | ❌ |
| assigneeNote | ✅ | ❌ | ✅ | ✅ | ❌ |
| **fabricType** | ✅ (admin-managed) | ❌ | ❌ | ❌ | ❌ |
| **machineNumber** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **productionError / productionErrorNote** | ✅ | ❌ (view) | ❌ (view) | ❌ (view) | ✅ (Phase 8) |
| **productionErrorSource** | ✅ | ❌ (view) | ✅ | ❌ (view) | ✅ |

Support được xem nhưng không sửa — controller cho qua, service `assertCanEditField` chặn ở field level.

`fabricType` được coi như product-attribute (không phải workshop status) nên chỉ Admin / Manager / SuperAdmin sửa được; mặc định auto-derive từ product config tại lúc import.

### 8.3 Flow `updateField(id, dto, roleName)` — hooks tự động
1. `assertCanEditField` — 403 nếu role không nằm trong allow-list của field.
2. Field validation:
   - `assignee`: `assertAssigneeUserValid(value)` — check user exists + role=Designer (BE)
   - Field khác có `FIELD_CONFIG_CATEGORY`: lookup `WorkshopConfig { category, code, isActive }`
   - Missing → 400.
3. `findOneById` → 404 nếu không tồn tại.
4. `$set { [field]: value }` + hooks:
   - **`toolResultNote`**: set `readyForFulfill = (value === 'ok')`; nếu value='ok' → clear `productionFirstErrorAt` (đơn rời tab Nhật ký bù lỗi)
   - **`assignee`**: 
     - Block 409 nếu `designerStatus ∉ {unassigned, assigned, rejected}` (đang in-progress/done/rework)
     - Set value: `designerStatus='assigned'`, `designerAssignedAt=now`, clear reject fields
     - Clear value: reset tất cả designer* fields về null/0
   - **`productionError`** (xem `DesignerTaskWorkflow.md §5.3`):
     - Lookup workshop_config.errorSource → auto-fill `productionErrorSource`
     - Set `toolResultNote='error'` + `$inc productionErrorCount` (signal cho xưởng + counter cho "Lỗi ×N")
     - Nếu `productionFirstErrorAt` chưa có giá trị → set = `now` (mốc bắt đầu cycle lỗi hiện tại cho tab Nhật ký bù lỗi)
     - Clear value (=null) → clear cả `productionErrorSource` + `productionFirstErrorAt`
     - Nếu source=designer + status=done → auto rework + `$inc designerReworkCount`
   - **`productionErrorSource`**: nếu set 'designer' + status=done → auto rework
5. `findOneAndUpdate` trả document mới.
6. Audit log per field. Auto-rework cũng log riêng.
7. `invalidateListCache` (fire-and-forget).

### 8.3.1 Atomic `setProductionError(id, dto)` — POST `/v1/orders/:id/set-production-error`
Wrapper riêng cho việc set 3 field cùng lúc (productionError + source + note). Bắt buộc khi user pick code='other':
- BE 400 nếu code='other' mà thiếu source HOẶC note
- Code khác: auto-fill source từ config nếu user không pass
- Trigger cùng hook (toolResultNote='error', `$inc productionErrorCount`, auto-rework)
- Log 3 entries (1 cho mỗi field)

Phase 3 đã thêm bước push `OrderLog` cho mọi `updateField` / `bulkUpdateField` / `transferOrder` / `bulkTransferOrders` (xem `OrderLog.md`).

### 8.4 Bulk `bulkUpdateField(dto, roleName)`
Cùng check permission + validate value, sau đó `updateMany({ _id: { $in: ids }, deletedAt: { $exists: false } })`. Trả `{ matched, modified }`.

### 8.5 Cache key
`orders:list:...` được rebuild kèm `role` để Designer / Fulfillment không bị "kế thừa" cache của Admin (visibility filter khác → key khác).

### 8.6 Xuất Excel các đơn đã chọn (`BulkEditToolbar`)
- Nút **"Xuất Excel"** (`Download`, `variant="outline"`) trong pill nổi `BulkEditToolbar.tsx` — xuất **đúng** các đơn đang tick chọn (không theo filter, đúng cả khi chọn xuyên trang).
- FE `handleExport`: gọi `RepositoryRemote.order.exportOrders('?ids=' + selectedIds.join(','))` → `buildDetailOnlyWorkbook(data, { resolve })` (`apps/web/src/pages/home/exportOrders.ts`) → `downloadWorkbook('don-hang-chon-<timestamp>.xlsx')`. File chỉ **1 sheet "Chi tiết đơn"** (21 cột giống export xưởng); tên workshop_config resolve client-side qua `workshopConfigStore`.
- BE: `GET /v1/orders/export` nhận thêm param **`ids`** (CSV các `_id`, `GetProductionOrdersZod.ids`) → `buildOrderListFilter` thêm `filter._id = { $in: ids }`. Dùng chung filter builder với `getOrders`/`exportOrders`.

---

## 9. Permissions tổng quát

| Role | List | Import | Inline update | Transfer xưởng | Delete |
|------|:----:|:------:|:-------------:|:--------------:|:------:|
| SuperAdmin / Admin | ✅ | ✅ | ✅ tất cả field | ✅ | ✅ |
| Manager | ✅ | ✅ | ✅ tất cả field | ✅ | ✅ |
| Support | ✅ (full table) | ✅ | ❌ | ✅ | ❌ |
| Designer | ✅ (7 ngày) | ❌ | ✅ tool / file / assignee fields | ❌ | ❌ |
| Fulfillment | ✅ (7 ngày + ready) | ❌ | ✅ printStatus / printStatusNote / **toolResultNote** | ❌ | ❌ |

Permission code chi tiết — xem `packages/shared/constants/permission-catalog.ts`. Hook FE: `usePermission()` expose `has(code)`, `canViewField(field)`, `canEditField(field)`, `canViewAdminTable()`, `canViewWorkshopTable()`, `isAdmin`, `roleName`.

---

## 9b. Giữ đơn (Hold / Unhold)

> **Mục tiêu:** Tạm dừng 1 đơn — tô xám cả dòng + **khóa mọi thao tác** (FE + BE) cho tới khi **mở lại**. Khác đơn HỦY (`cancelledAt`): hold **REVERSIBLE** và **KHÔNG** loại đơn khỏi số liệu (chỉ tạm dừng). Ai được giữ: `ORDER_WRITE_ROLES` (Admin/Manager/Support/DesignerLeader/Fulfillment).

### 9b.1 Schema
- `OrderEntity.heldAt?: Date` (index) + `holdReason?: string` (`order.entity.ts`). Set khác null ⇒ đơn "đang giữ".
- Shared `ProductionOrderZod`: `heldAt` + `holdReason`. Filter param `held: z.coerce.boolean()` trong `GetProductionOrdersZod` (held=true → chỉ đơn giữ; false → chỉ đơn không giữ; bỏ trống → cả 2). Filter param `holdReason: z.string()` (exact match, tự ngụ ý `held=true` vì field bị `$unset` cùng `heldAt` lúc mở giữ) — bỏ trống → KHÔNG lọc theo lý do (mặc định).
- `ORDER_LOG_ACTIONS` thêm `'hold'` + `'unhold'`.
- **Nguồn giữ + cờ OnosPod** (§9d): `holdSource?: 'manual' | 'onospod'` (index sparse) — `holdOrder`/`bulkSetHold` set `'manual'`, đồng bộ OnosPod set `'onospod'`; mọi đường mở giữ `$unset` cùng `heldAt`. Đơn đang giữ thiếu trường = `manual`. `onospodHold?: { onHoldAt, seenAt }` (index sparse `onospodHold.onHoldAt`) = cờ "OnosPod đang giữ", độc lập với `heldAt`. `onospodHoldDismissedAt?: Date` = đợt giữ OnosPod đã bị nhân viên mở giữ. Hằng `HOLD_REASON_ONOSPOD`/`HoldSource` ở `packages/shared/constants/hold-reason.ts`.

### 9b.2 Endpoints (`@Auth(ORDER_WRITE_ROLES)`)
| Method | Path | Service | Mô tả |
|--------|------|---------|-------|
| POST | `/v1/orders/:id/hold` | `holdOrder` | Set `heldAt=now` + `holdReason` + `holdSource='manual'`. 400 nếu đã giữ / đã hủy. Log `hold`. |
| POST | `/v1/orders/:id/unhold` | `unholdOrder` | `$unset heldAt/holdReason/holdSource`. Đơn mang cờ `onospodHold` → set `onospodHoldDismissedAt = onospodHold.onHoldAt` (§9d). 400 nếu không đang giữ. Log `unhold`. Báo khách `order.unheld` TRỪ đơn `holdSource='onospod'` (§9d.4). |
| PATCH | `/v1/orders/bulk-hold` | `bulkSetHold` | `{ ids, hold: boolean, reason? }`. hold=true chỉ set đơn chưa giữ & chưa hủy (kèm `holdSource='manual'`); false chỉ clear đơn đang giữ (`$unset holdSource` luôn; đơn mang cờ OnosPod được `bulkWrite` mốc `onospodHoldDismissedAt` riêng từng đơn TRƯỚC `updateMany`). Log vẫn gộp 1 dòng như cũ. Trả `{ matched, modified }`. |

**Giữ với lý do `HOLD_REASON_WAITING_DESIGN` ("Đợi khách sửa design") → reset `toolResult` + `toolResultNote` về rỗng VÀ hủy gán designer hiện tại** (cả `holdOrder` lẫn `bulkSetHold`, cùng `$set` với `heldAt`/`holdReason`, ghi thẳng qua Mongo — KHÔNG qua `updateField()` nên KHÔNG kích hoạt side-effect hook thường theo `toolResultNote`) — design cũ coi như không còn giá trị:
- `toolResult` rỗng khiến đơn tự rơi lại vào điều kiện `toolResult: { $in: [null, ''] }` của hàng đợi `getNextDesignReviewOrder()` (§18) → tool ngoài tự soát lại NGAY KHI mở giữ; `toolResultNote` rỗng để mọi luồng nội bộ khác đọc field này (Soát tool, Dashboard, auto-gán designer...) cũng coi đơn là "chưa soát" nhất quán. KHÔNG đụng `toolCheckErrorNotes` (lịch sử bền vững).
- **Hủy gán designer**: `assignee=null` + `designerStatus='unassigned'` + clear `designerAssignedAt`/`designerStartedAt`/`designerCompletedAt`/`designerRejectedAt`/`designerRejectedReason` — designer đang ôm (hoặc đã làm xong) design cũ không còn giữ đơn nữa, đơn rơi lại backlog "Cần gán" để auto-assign/leader gán lại NGAY KHI mở giữ. KHÔNG đụng `designerFirstStartedAt` (immutable, dùng tính response-time) / `designerWorkMs`/`designerReworkCount`/`designerRejections` (số liệu cộng dồn lịch sử).

So khớp CHÍNH XÁC chuỗi lý do (không phải substring) — đổi text preset ở `HoldOrderDialog.tsx` phải đổi cả `HOLD_REASON_WAITING_DESIGN` (`packages/shared/constants/hold-reason.ts`).

### 9b.3 Khóa thao tác (BE guard `assertNotHeld`)
Đơn `heldAt` set → chặn (400 *"Đơn đang bị giữ — mở lại…"*) ở: `updateField`, `setProductionError`, `DesignerTaskService.transition`, `FulfillmentTaskService.transition`. `bulkUpdateField` (nhánh updateMany) + `bulkAssignDesigner` **loại** đơn giữ qua filter `heldAt: { $exists: false }` → `matched` thấp hơn để FE biết bị bỏ (nhánh side-effect loop `updateField` tự skip vì guard throw). **Không** chặn `/unhold` (để mở lại được).

> **HỦY ĐƠN KHÔNG bị chặn bởi trạng thái giữ — ở CẢ HAI TẦNG** (ORD-2).
> Nhánh `cancel` **cố ý không có** `assertNotHeld`, và giao diện cũng **không**
> disable mục "Hủy đơn" khi đơn đang giữ. Nghiệp vụ: đơn giữ thường đang chờ
> khách xác nhận — khách bảo hủy thì hủy thẳng, bắt bỏ giữ rồi mới hủy vừa thêm
> một thao tác vừa mở ra khoảng thời gian đơn có thể lọt lại vào luồng sản xuất.
> Trước ORD-2, `OrderRowActionsMenu.tsx` tự disable mục này kèm tooltip *"Đơn đang
> giữ — mở lại trước"*, tức **giao diện chặt hơn máy chủ** bằng một luật không
> yêu cầu nào quy định; đã bỏ. **Đừng "sửa cho nhất quán"** bằng cách thêm
> `assertNotHeld` vào `cancel` — người dùng đã chốt hướng ngược lại.
> Các nhánh chặn liệt kê ở trên vẫn giữ nguyên.

Đơn giữ **VẪN xuất hiện** trong `GET /orders` (mặc định — chỉ tô xám, KHÔNG ẩn, khác `cancelledAt` bị loại mặc định) — trừ hàng đợi `getNextDesignReviewOrder()` (§18): filter riêng `heldAt: { $exists: false }` LOẠI đơn giữ khỏi hàng đợi "chưa soát" cho tool ngoài, tránh tool nhặt nhầm đơn đang tạm dừng chờ khách. Lookup trực tiếp theo `productionId` (`getDesignReviewOrderByProductionId`/`GET design-review/by-production-id/:productionId`) KHÔNG áp filter này — tra cứu 1 mã cụ thể vẫn thấy đơn giữ.

### 9b.4 Thống kê
- **Dashboard tab Stats** (`getDashboard` → `totals.heldOrders`): card **"Đơn đang giữ"** (hổ phách) ở `OrderStatsTab.tsx`. VẪN nằm trong `totalOrders` (chỉ tạm dừng, không loại như đơn hủy).
- **Danh sách đơn** (`getWorkshopAvailableFilters` → `data.heldCount`): nút toggle **"Đang giữ (N)"** ở `topActionsRight` `OrderFilterBar` → set param `held=true` (URL `wheld`) + chip "Trạng thái: Đang giữ".

### 9b.5 Frontend
- Util `apps/web/src/utils/orderActions.ts`: `isHeld(o)`, `canUserHold(roleName)` (mirror `ORDER_WRITE_ROLES`).
- `HeldBadge.tsx` (hổ phách "Đang giữ" + reason) — mirror `CancelledBadge`.
- `HoldOrderDialog.tsx` (giữ 1 đơn, lý do KHÔNG bắt buộc). Export `HOLD_REASON_PRESETS` — 5 lý do phổ biến dạng chip (Đợi khách sửa design / địa chỉ / thông tin đơn, Chờ khách xác nhận, Thiếu vật tư): click chip = điền nhanh vào textarea (click lại = bỏ chọn), vẫn sửa tay/tự gõ lý do khác được — KHÔNG phải danh mục cấu hình được (khác `workshop_config`), chỉ là preset tĩnh FE.
- Tô xám + badge + **cell read-only** (override `ctx.canEditField=()=>false`) ở: `OrderTableWorkshop`, `ErrorLogTab`, `OrdersMiniTable`; tô xám + badge ở `ListOrderTab`.
- `ListOrderTab.tsx`: select **"Lý do giữ"** (options = `HOLD_REASON_PRESETS` tĩnh, KHÔNG có count/facet) — chọn 1 lý do → filter `holdReason` (param URL `lhold`); không chọn → không lọc. Đặt cạnh nút "Lỗi xưởng" trong hàng filter, tách biệt khỏi khối filter designer (`canSeeDesignerSummary`) vì áp cho MỌI role xem được danh sách đơn.
- `OrderRowActionsMenu.tsx`: item **"Giữ đơn"** (mở dialog) / **"Mở giữ"** (gọi trực tiếp) cho role `canUserHold`; menu hiện khi `isAdmin || canUserHold`. Mục **"Hủy đơn"** KHÔNG xét `held` — xem cảnh báo ở §9b.3. Các mục còn lại ("Đổi design") vẫn disable khi đơn đang giữ.
- `BulkEditToolbar.tsx`: nút **"Giữ đơn"** (dialog lý do bulk, tái dùng CHUNG `HOLD_REASON_PRESETS` từ `HoldOrderDialog.tsx`) + **"Mở giữ"** (bulk trực tiếp) → `RepositoryRemote.order.bulkHold({ ids, hold, reason })`.
- Service `services/order.ts`: `holdOrder` · `unholdOrder` · `bulkHold`.

## 9c. Tự động lấy ngược design/địa chỉ ship từ OnosPod (đơn giữ chờ khách)

> **Mục tiêu:** Đơn giữ vì "chờ khách sửa design" hoặc "chờ khách sửa địa chỉ" —
> cron public quét định kỳ, hỏi OnosPod xem khách đã cập nhật chưa, nếu có →
> tự cập nhật + **MỞ GIỮ**, không cần nhân viên check tay.

### 9c.1 Điều kiện kích hoạt
Chỉ áp dụng khi `order.holdReason` **khớp CHÍNH XÁC** (không phải substring) 1
trong 2 hằng số `shared/constants/hold-reason.ts`:
- `HOLD_REASON_WAITING_DESIGN = 'Đợi khách sửa design'` → check design.
- `HOLD_REASON_WAITING_ADDRESS = 'Đợi khách sửa địa chỉ'` → check địa chỉ ship.

`HoldOrderDialog.tsx`/`BulkEditToolbar.tsx` import 2 hằng số này làm 2 preset
chip ĐẦU trong `HOLD_REASON_PRESETS` — đổi text preset ở FE mà không đổi hằng
số dùng chung sẽ làm cron ngừng nhận diện đơn (3 preset còn lại là free-text
thường, không kích hoạt tự động).

### 9c.2 Nguồn dữ liệu OnosPod — `OnospodOrderLookupService`
Gọi `api.onospod.com/graphql` (query `orders`, **khác** host với
`OnospodImportService` đang dùng cho import hàng ngày — đó là `qc.onospod.com`
`paginateMrpProduct`). Config `ApiConfigService.onospodApiConfig` (env
`ONOSPOD_API_URL`/`ONOSPOD_API_BEARER_TOKEN`/`ONOSPOD_API_SUPER_TOKEN`) —
thiếu config → getter trả `null`, cron tự skip toàn bộ (không throw).
Service này còn có `lookupShippingByOrderIds()` — query `orders(ids)` theo lô
lấy RIÊNG địa chỉ ship cho import hàng ngày (§3.6), dùng chung mapper
`toShippingAddress()` + hằng `ONOSPOD_ORIGIN`.

⚠️ **Gateway OnosPod BẮT BUỘC header `Origin: https://app.onospod.com`** (verify
bằng test gọi thật 2026-07-23) — thiếu header này → **403 Forbidden** dù token
vẫn hợp lệ (dễ nhầm là token/password sai, KHÔNG PHẢI — đã từng chẩn đoán nhầm
1 lần). `lookupByProductionId()` set cứng `Origin`/`Referer` = `app.onospod.com`
trong request headers — nếu OnosPod đổi domain frontend, phải sửa hằng số
`ONOSPOD_ORIGIN` ở đầu file. Mọi lỗi gọi API (network/403/GraphQL error) đều
được log qua Winston (`action: 'onospodOrderLookup'`) kèm `status`/`error` —
xem log thay vì đoán khi cron báo skip "gọi API thất bại".

**Khớp line_item ↔ `productionId` nội bộ** (điểm quan trọng nhất, đã verify
bằng test gọi thật 2026-07-22): 1 order OnosPod (search theo `order.orderId`,
mã dạng `NF-xxxxx-xxxxx`) có nhiều `line_items[]` (mỗi size/màu 1 item), MỖI
`line_item` lại có mảng `productions[]` (các lượt sản xuất/rework). **`productionId`
nội bộ CHÍNH LÀ `line_items[].productions[].increment_id`** — KHÔNG phải
`line_items[].product_id` (field này có định dạng hoàn toàn khác, ví dụ
`NF-33230-29523-00`, không khớp `productionId` kiểu `EH-49336-76798`). Tìm
đúng 1 `line_item` chứa `productions[].increment_id === productionId` →
`design` lấy từ `line_item.print.design_{front,back,sleeve,hood,placket,left,
right,chest_left,chest_right,sleeve_left,sleeve_right,upper_sleeve_left,
upper_sleeve_right,left_cuff,right_cuff}.src` — **field `design_*`** (asset
design KHÁCH ĐÃ UP, đã qua xử lý, hosted trên `cdn.onospod.com`), **KHÔNG phải**
field trần `line_item.print.front/back/...` (chỉ là link Drive gốc lúc khách
paste, có thể chưa xử lý/hết quyền xem — đã sửa lại sau khi test thực tế phát
hiện field `.src` mới đúng là design cuối cùng). Không có `design_folder`
tương ứng field `folder` → vị trí này KHÔNG map/KHÔNG check. **>1 line_item
cùng khớp** (dữ liệu bất thường) → coi là `ambiguous`, **KHÔNG áp dụng**, bỏ
qua + log lý do (an toàn hơn đoán đại 1 cái). `shipping` lấy ở level ORDER
(không phải per-item): `order.shipping.{first_name,last_name,company,
address_1,address_2,city,state,postcode,country,email,phone}`.

### 9c.3 Logic so sánh + mở giữ — `OrderService.recoverHeldOrders()` + `applyDesignFromOnospod()`
- **Design**: logic lookup + so sánh + ghi nằm ở `OrderService.applyDesignFromOnospod()`
  (private helper, dùng chung bởi cron `recoverHeldOrders()`, nút thủ công
  `checkOrderDesignFromOnospod()` (§9c.5) VÀ nút thủ công theo mã khách hàng
  `syncDesignByCustomer()` (§9c.6, truyền `opts.skipSideEffects=true` — bỏ
  qua HOÀN TOÀN đoạn reset `toolResult`/mở giữ bên dưới, CHỈ ghi
  `designs`/`designsOriginal`). So sánh TRỰC TIẾP từ lần check
  đầu tiên — baseline = `order.designsOriginal ?? order.designs` (đã có sẵn từ
  lúc import, hợp lệ để so sánh ngay). Khác baseline (ở BẤT KỲ vị trí in nào
  OnosPod trả về giá trị) → `$set designs.<k>` + `designsOriginal.<k>` cho các
  vị trí đổi, **VÀ LUÔN reset `toolResult`/`toolResultNote` về `''`** (design
  cũ đã soát coi như không còn giá trị — CÙNG cơ chế `holdOrder()` làm khi giữ
  đơn lý do "Đợi khách sửa design" — để đơn tự rơi lại hàng đợi
  `getNextDesignReviewOrder()`, tool soát lại design mới; set thẳng KHÔNG qua
  `updateField()` nên KHÔNG side-effect hook, áp dụng **BẤT KỂ đơn đang ở công
  đoạn nào** kể cả đã vào Fulfillment In/Ép/May — có thể khiến đơn nằm ĐỒNG
  THỜI trong hàng đợi soát tool VÀ kanban Fulfillment công đoạn hiện tại, đây
  là lựa chọn CHỦ ĐÍCH, không phải bug) + log `update_design` (field=`designs`,
  before/after snapshot theo TỪNG vị trí đổi + `toolResult`/`toolResultNote` —
  CÙNG convention với `updateOrderDesign()` thường).
  Mở giữ (`$unset heldAt/holdReason` + log `unhold` riêng) khi: đơn ĐANG giữ
  ĐÚNG lý do "Đợi khách sửa design" (`holdReason=HOLD_REASON_WAITING_DESIGN`)
  **HOẶC** caller truyền `opts.forceUnhold=true` (chỉ nút thủ công §9c.5 dùng
  — mở giữ đơn đang giữ BẤT KỂ lý do gì, vì nhân viên đã chủ động bấm kiểm
  tra đúng đơn này). Cron `recoverHeldOrders()` KHÔNG truyền cờ này (giữ
  hành vi cũ, khớp CHÍNH XÁC lý do — chạy tự động không người giám sát nên
  cần thận trọng hơn). Đơn không giữ → chỉ cập nhật `designs`, KHÔNG đụng
  `heldAt`.
  **Tương tác với đồng bộ giữ OnosPod (§9d):** mọi nhánh mở giữ ở đây
  (`forceUnhold` của nút "Kiểm tra design mới" 1 đơn/hàng loạt, lý do "Đợi khách
  sửa design", nhánh địa chỉ bên dưới) đều `$unset holdSource`, và nếu đơn mang
  cờ `onospodHold` thì set `onospodHoldDismissedAt = onospodHold.onHoldAt` — đồng
  bộ sẽ KHÔNG giữ lại đơn cho tới khi OnosPod có đợt giữ mới hơn. Đơn giữ theo
  OnosPod có `holdReason = 'Giữ theo OnosPod'` nên cron `recoverHeldOrders()`
  (khớp CHÍNH XÁC 2 lý do) không bao giờ nhặt.
- **Địa chỉ**: nếu `order.shippingAddress` chưa có baseline → **lần check đầu
  chỉ SNAPSHOT** (`$set shippingAddress`), **KHÔNG tự mở giữ** (chưa biết có
  đổi hay không). Từ lần thứ 2 trở đi mới so sánh snapshot đã lưu với dữ liệu
  OnosPod hiện tại (so từng field, rỗng coi như `''`) — khác → cập nhật
  snapshot + mở giữ + log `unhold`; giống → giữ nguyên (vẫn chờ). Từ
  2026-09-16 **import hàng ngày đã gắn sẵn `shippingAddress` lúc tạo đơn**
  (§3.6) nên đa số đơn CÓ SẴN baseline — cron so được ngay từ lượt đầu, không
  phải chờ 2 lượt; kèm guard ở `importOrders` không cho re-import đè snapshot
  của đơn đang giữ chờ sửa địa chỉ (xem bảng field mapping §3.6). Logic địa
  chỉ CHƯA có bản thủ công per-order (chỉ chạy trong cron).
- Đơn thiếu `orderId` (chưa từng có mã đơn OnosPod) → skip, lý do rõ ràng
  trong response `skipped[]` (không đoán, không throw).

### 9c.4 API — cron (toàn bộ đơn giữ)
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/v1/orders/recover-held-from-onospod/cron` | public (`@Auth([],[],{public:true})`) | Cron — quét TOÀN BỘ đơn giữ khớp 1 trong 2 lý do trên, trả `{ checkedDesign, checkedAddress, designUpdated, addressPrimed, addressUpdated, unheld, skipped[] }`. Log ip/userAgent làm audit trace (giống `import-from-onospod/cron`). |

Không có body/param — cron gọi trực tiếp qua `curl`, không cần token (giống
mẫu `import-from-onospod/cron` đã có). Đặt lịch chạy ở crontab ngoài, độc lập
với cron import.

### 9c.5 Nút thủ công "Kiểm tra design mới" (Danh sách đơn, 1 đơn)
> Cho phép nhân viên ép tra OnosPod cho **1 ĐƠN BẤT KỲ**, không cần đơn đang
> giữ (KHÁC cron §9c.4 chỉ quét đơn hold) — dùng khi cần check ngay, không đợi
> lịch cron. Dùng lại NGUYÊN VẸN `applyDesignFromOnospod()` — chỉ khác input
> (1 đơn cụ thể thay vì query hàng loạt).

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/v1/orders/:id/check-design-from-onospod` | `ORDER_WRITE_ROLES` (SuperAdmin/Admin/Manager/Support/DesignerLeader/Fulfillment) | Kiểm tra + cập nhật design cho 1 đơn, trả `{ updated, reason?, changed?, order? }` (`order` = đơn SAU cập nhật, chỉ có khi `updated=true`). |

- `OrderService.checkOrderDesignFromOnospod(id, ctx)`: fetch đơn theo `id` →
  404 nếu không có; đơn ĐÃ HỦY (`cancelledAt`) → trả thẳng `{updated:false,
  reason:'Đơn đã hủy...'}`, KHÔNG gọi OnosPod; còn lại gọi
  `applyDesignFromOnospod(order, ctx, {forceUnhold: true})` — nếu `updated=true`
  → `invalidateListCache()`. **`forceUnhold: true`** — KHÁC cron: đơn ĐANG giữ
  (BẤT KỂ `holdReason` là gì, không riêng "Đợi khách sửa design") mà tìm thấy
  design mới → TỰ MỞ GIỮ luôn (nhân viên chủ động bấm kiểm tra đúng đơn này
  nên coi tìm thấy design mới là đủ điều kiện mở giữ). Đơn không giữ → chỉ
  cập nhật `designs`, không đụng `heldAt`.
- **UI**: `apps/web/src/components/orders/OrderRowActionsMenu.tsx` — menu item
  "Kiểm tra design mới" (icon `RefreshCw`), hiện cho role `ORDER_WRITE_ROLES`
  (mirror `HOLD_ALLOWED_ROLES`/`canUserHold` — cùng role set với Giữ đơn/Mở
  giữ), disable khi đơn đã hủy. Bấm → `POST .../check-design-from-onospod` →
  `updated=true`: toast success + patch row bằng `data.order` (`onChanged`,
  giữ trạng thái group đang mở giống Hold/Unhold); `updated=false`: `toast.info`
  hiển thị THẲNG `data.reason` từ BE (free text tiếng Việt, không qua i18n —
  cùng cách `skipped[].reason` của cron đã hiển thị dạng free text).
- Shared DTO: `CheckOrderDesignResZod`/`CheckOrderDesignResDto`
  (`packages/shared/dtos/production-order.dto.ts`).

### 9c.6 Nút thủ công "Đồng bộ design theo mã khách hàng" (thủ công, hàng loạt)
> Truyền `userSku` (mã khách hàng) → tìm **TOÀN BỘ đơn** của khách đó (mọi
> `productionId`, không giới hạn ngày/công đoạn), tra lại OnosPod cho từng
> đơn, **CHỈ cập nhật `designs`/`designsOriginal` — KHÔNG reset
> `toolResult`/`toolResultNote`, KHÔNG đụng `heldAt`/`holdReason`** (khác
> `checkOrderDesignFromOnospod` §9c.5 — yêu cầu nghiệp vụ rõ ràng: chạy đồng
> bộ hàng loạt không được kèm side-effect nào ngoài design).

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/v1/orders/design-sync-by-customer` | `ORDER_WRITE_ROLES` (SuperAdmin/Admin/Manager/Support/DesignerLeader/Fulfillment) | Query `{ userSku }`. Trả `{ total, updated, skipped[] }` (`total` = số đơn tìm thấy theo `userSku`, `skipped[]` = `{productionId, reason}`). |

- `OrderService.syncDesignByCustomer(userSku, ctx)`: `find({ userSku })` (không
  lọc xưởng/ngày — mã khách hàng đã là điều kiện lọc tường minh) → với mỗi
  đơn: đã hủy (`cancelledAt`) → skip lý do `'Đơn đã hủy — không đồng bộ.'`,
  KHÔNG gọi OnosPod; còn lại gọi `applyDesignFromOnospod(order, ctx,
  {skipSideEffects: true})` — `updated=true` → tăng đếm `updated`, ngược lại
  đẩy `{productionId, reason}` vào `skipped[]`. Có ít nhất 1 đơn update →
  `invalidateListCache()`.
- Shared DTO: `SyncDesignByCustomerZod`/`SyncDesignByCustomerDto` +
  `SyncDesignByCustomerResZod`/`SyncDesignByCustomerResDto`
  (`packages/shared/dtos/production-order.dto.ts`).
- Chưa có UI riêng (gọi trực tiếp API) — nếu cần nút bấm trên FE, thêm dialog
  nhập `userSku` (tương tự `AssignFactoryDialog`) rồi gọi endpoint trên.

### 9c.7 Nút "Kiểm tra design mới" bản HÀNG LOẠT (bulk toolbar, các đơn đang tick chọn)
> Bulk toolbar (`BulkEditToolbar.tsx`, hiện khi tick chọn ≥1 đơn ở Danh sách
> đơn) — áp `checkOrderDesignFromOnospod()` (§9c.5, KHÔNG phải
> `syncDesignByCustomer()` §9c.6) cho TỪNG đơn trong danh sách `ids` đang tick
> chọn: reset `toolResult`/`toolResultNote` + `forceUnhold: true` (mở giữ bất
> kể lý do gì nếu đơn đang giữ).

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| PATCH | `/v1/orders/bulk-check-design-from-onospod` | `ORDER_WRITE_ROLES` (SuperAdmin/Admin/Manager/Support/DesignerLeader/Fulfillment) | Body `{ ids: string[] }` (min 1). Trả `{ total, updated, skipped[] }` (`total` = số đơn tìm thấy theo `ids`, `skipped[]` = `{productionId, reason}`). |

- `OrderService.bulkCheckOrderDesignFromOnospod(ids, ctx)`: `find({ _id: {
  $in: ids } })` → với mỗi đơn: đã hủy (`cancelledAt`) → skip lý do `'Đơn đã
  hủy — không kiểm tra design.'`, KHÔNG gọi OnosPod; còn lại gọi
  `applyDesignFromOnospod(order, ctx, {forceUnhold: true})` — `updated=true`
  → tăng đếm `updated`, ngược lại đẩy `{productionId, reason}` vào
  `skipped[]`. Có ít nhất 1 đơn update → `invalidateListCache()`.
- **Xử lý lỗi:** lỗi gọi OnosPod (network/timeout/403...) cho 1 đơn KHÔNG làm
  gián đoạn — `OnospodOrderLookupService.lookupByProductionId()` tự bắt mọi
  lỗi axios/GraphQL, log rồi trả `null` (KHÔNG throw), đơn đó chỉ vào
  `skipped[]` với lý do `'OnosPod chưa cấu hình hoặc gọi API thất bại'`, các
  đơn còn lại trong `ids` vẫn xử lý tiếp bình thường. Riêng vòng lặp còn bọc
  thêm `try/catch` quanh TỪNG đơn — lỗi bất ngờ khác (vd Mongo write fail)
  cũng KHÔNG làm crash cả batch/mất kết quả các đơn đã xử lý trước đó, chỉ đẩy
  đơn lỗi vào `skipped[]` với lý do `'Lỗi hệ thống khi xử lý đơn này — thử lại
  sau.'` + log Winston (`action: 'bulkCheckOrderDesignFromOnospod'`).
- **UI**: `apps/web/src/components/orders/BulkEditToolbar.tsx` — nút "Kiểm
  tra design mới" (icon `RefreshCw`) trong nhóm nút cùng Giữ đơn/Mở giữ, gate
  theo `canHold` (mirror `HOLD_ALLOWED_ROLES`/`ORDER_WRITE_ROLES`). Bấm →
  `PATCH .../bulk-check-design-from-onospod` với `ids: selectedIds` → toast
  success hiển thị `{{updated}}/{{total}}` → `onApplied()` (reload danh sách,
  KHÔNG patch từng row cục bộ như bản đơn lẻ §9c.5 vì số lượng đơn ảnh hưởng
  có thể lớn/không xác định trước — reload cả trang đơn giản + đáng tin cậy
  hơn).
- Shared DTO: `BulkCheckOrderDesignZod`/`BulkCheckOrderDesignDto` +
  `BulkCheckOrderDesignResZod`/`BulkCheckOrderDesignResDto`
  (`packages/shared/dtos/production-order.dto.ts`).

## 9d. Đồng bộ giữ đơn theo OnosPod

> **Mục tiêu (TASK-04):** bên OnosPod đặt item sang `On Hold` → đơn cùng
> `productionId` bên mình tự GIỮ; OnosPod nhả → tự NHẢ đơn do đồng bộ giữ. Không
> báo khách, không tác dụng phụ lên tool/designer/công đoạn.

### 9d.1 Nguồn tín hiệu (đã xác minh bằng gọi thật, chỉ đọc)
- Chỉ có ở **mức item MRP** trên `qc.onospod.com`: `MrpProduct.mrp_status = "On Hold"`.
  Cấp đơn `api.onospod.com` KHÔNG có trạng thái giữ.
- Người đặt giữ là nhân viên OnosPod; **không có lý do giữ** (`mrp_log` chỉ ghi
  `"Change product to: On Hold"`). Khi nhả, OnosPod đẩy thẳng item sang `Packing`/`In Sewing`.
- Khớp đơn: `increment_id` = `productionId` bên mình.
- Query `paginateMrpProduct(mrp_status: "On Hold", start, end, perpage: 200)` —
  **bắt buộc có `start`/`end`** (thiếu → trả 0), khoảng ngày lọc theo `mrp_created_at`.
- Thời điểm đợt giữ (`onHoldAt`): log `mrp_log[]` có `mrp_status = "On Hold"` MỚI NHẤT
  → fallback `mrp_updated_at` → `mrp_created_at` (`resolveOnHoldAt`).

### 9d.2 Files
| File | Vai trò |
|---|---|
| `apps/api/src/modules/order/onospod-hold-sync.plan.ts` | Hàm THUẦN `planOnospodHoldSync()` — mọi luật quyết định + an toàn. Spec `onospod-hold-sync.plan.spec.ts`. |
| `apps/api/src/modules/order/onospod-hold-sync.service.ts` | Điều phối fetch → plan → ghi có điều kiện + log + cảnh báo Telegram. |
| `apps/api/src/modules/order/onospod-qc.client.ts` | `fetchMrpProductPage()` — HTTP/GraphQL dùng chung với `OnospodImportService` (hành vi import không đổi). |
| `packages/shared/constants/hold-reason.ts` | `HOLD_REASON_ONOSPOD = 'Giữ theo OnosPod'` + `HoldSource`. KHÔNG thêm vào preset chip FE. |
| `packages/shared/dtos/production-order.dto.ts` | `holdSource`/`onospodHold`/`onospodHoldDismissedAt` trong `ProductionOrderZod` + `OnospodHoldSyncResultZod`/`SyncOnospodHoldResDto` + `ImportFromOnosPodResZod.holdSync`. |
| `apps/web/src/components/orders/HeldBadge.tsx` | `HeldBadge source` + `OnospodHoldBadge`/`showOnospodHoldFlag`. |

### 9d.3 Trường trên `OrderEntity`
| Trường | Ý nghĩa |
|---|---|
| `holdSource?: 'manual' \| 'onospod'` | Nguồn lượt giữ hiện tại. Đơn giữ cũ thiếu trường = `manual`. |
| `onospodHold?: { onHoldAt, seenAt }` | Cờ "OnosPod đang giữ" — có khi OnosPod đang giữ, BẤT KỂ bên mình giữ hay không. `seenAt` = lần đầu đồng bộ thấy ĐỢT này (cùng `onHoldAt` thì không ghi lại). |
| `onospodHoldDismissedAt?: Date` | `onHoldAt` của đợt mà nhân viên đã mở giữ. |

### 9d.4 Luật (hàm thuần `planOnospodHoldSync`)
Mỗi lượt nạp đơn (loại đơn xóa mềm) khớp 1 trong: `productionId` ∈ tập On Hold ·
`holdSource='onospod'` và đang giữ · đang mang cờ.

**OnosPod đang giữ item:**
| Đơn bên mình | Hành động |
|---|---|
| Chưa giữ, chưa hủy, `fulfillmentCompletedAt` rỗng, chưa bỏ qua đợt này | **GIỮ**: `heldAt=now`, `holdReason='Giữ theo OnosPod'`, `holdSource='onospod'`, cờ. Log `hold`. |
| Đã hoàn thành fulfillment / đã hủy | KHÔNG giữ, chỉ gắn cờ (FE hiện nhãn "OnosPod đang giữ"). |
| Nhân viên đang giữ (`manual` hoặc thiếu nguồn) | Không đổi lý do/nguồn, chỉ gắn cờ. |
| Đã giữ theo OnosPod | Cùng đợt → không ghi gì; đợt mới → chỉ làm mới cờ. |
| `onospodHoldDismissedAt ≥ onHoldAt` (nhân viên đã mở giữ đợt này) | KHÔNG giữ lại; chỉ gắn cờ. Đợt mới hơn mốc → giữ bình thường. |

**OnosPod KHÔNG còn giữ item:**
| Đơn bên mình | Hành động |
|---|---|
| `holdSource='onospod'` đang giữ, `inProductionAt` trong cửa sổ | **NHẢ**: `$unset heldAt/holdReason/holdSource/onospodHold`. Log `unhold`. |
| `holdSource='onospod'` nhưng `inProductionAt` ngoài cửa sổ (hoặc thiếu) | KHÔNG nhả (`outOfWindowKept`) — có thể chỉ vì item trôi khỏi cửa sổ 60 ngày. |
| Nhân viên đang giữ, mang cờ | Giữ nguyên trạng thái giữ, chỉ gỡ cờ. |

Mở giữ thủ công (1 đơn / hàng loạt / `forceUnhold` §9c / nhánh địa chỉ §9c) một đơn
đang mang cờ → set `onospodHoldDismissedAt = onospodHold.onHoldAt`. Áp cho MỌI đơn
mang cờ, không riêng `holdSource='onospod'` — nhân viên đã thấy nhãn OnosPod mà vẫn
mở giữ thì đồng bộ không được giữ lại ngay lượt sau.

**Báo khách khi nhân viên mở giữ thủ công** (USER chốt 11/09/2026): đơn có
`holdSource='onospod'` NGAY TRƯỚC lúc nhả → KHÔNG gọi `emitCustomerOrderEvent`
(`order.unheld` — không chuông portal, không webhook), vì khách chưa từng được báo
đơn bị giữ. Đơn giữ tay (`manual` hoặc thiếu nguồn) báo như cũ. Quyết định ở hàm
thuần `shouldNotifyCustomerOnManualUnhold()` (`onospod-hold-sync.plan.ts`, spec
`onospod-hold-unhold-notify.spec.ts`):
- `unholdOrder`: xét `holdSource` của snapshot `before`.
- `bulkSetHold(hold=false)`: đọc các đơn đang giữ TRƯỚC `updateMany` (sau `$unset`
  không còn `holdSource`), chỉ báo tập đơn giữ tay; danh sách lẫn hai loại → chỉ
  đơn giữ tay được báo.
- `forceUnhold` (§9c "Kiểm tra design mới") và nhánh địa chỉ §9c vốn KHÔNG bắn sự
  kiện nào — giữ nguyên.
- Log `unhold` và `onospodHoldDismissedAt` KHÔNG đổi (vẫn ghi cho mọi đơn).

### 9d.5 Không tác dụng phụ
- KHÔNG gọi `emitCustomerOrderEvent` (không webhook `order.held/unheld`, không chuông portal). Nhân viên mở giữ tay một đơn giữ theo OnosPod cũng không báo (§9d.4, cuối mục).
- KHÔNG reset tool, KHÔNG hủy gán designer, KHÔNG đổi công đoạn — chỉ các trường ở §9d.3 + `heldAt`/`holdReason`.
- Log mỗi đơn 1 dòng `hold`/`unhold` riêng (không gộp), shape giống `holdOrder`/`unholdOrder`, **không có user**, `userAgent = 'onospod-hold-sync'` (+ ip của lời gọi cron nếu có). Ghi cờ không log.
- Ghi CÓ ĐIỀU KIỆN (`updateOne` kèm `heldAt $exists`, `holdSource`, `cancelledAt`, `fulfillmentCompletedAt`) → chạy lặp/chồng lượt không ghi trùng, không log trùng. Trong cùng tiến trình, lượt gọi chồng nhận chung kết quả lượt đang chạy.

### 9d.6 An toàn — `status='aborted'`, KHÔNG ghi gì
- Thiếu config `ONOSPOD_QC_API_URL`/`ONOSPOD_QC_BEARER_TOKEN`.
- Lỗi HTTP/GraphQL, thiếu `paginate.total_items`, số trang > 10, tổng item nhận ≠ `total_items`, item sai trạng thái (bộ lọc không áp), item thiếu `increment_id` hoặc mốc thời gian.
- Tập On Hold RỖNG trong khi đang có đơn giữ-do-đồng-bộ (nghi ngờ).
- Số đơn cần nhả > 20 (`ONOSPOD_HOLD_SYNC_MAX_UNHOLD`), hoặc ≥ 5 đơn VÀ > 50% số đơn đang giữ-do-đồng-bộ. Ngưỡng dưới 5 để 1–2 đơn giữ theo OnosPod vẫn nhả được.

Hai trường hợp nghi ngờ/vượt trần gửi cảnh báo Telegram (`TelegramService`, kênh
`TELEGRAM_NOTIFICATION_CHANNEL_ID` → fallback `TELEGRAM_CHANNEL_ID`, chỉ khi
`TELEGRAM_NOTIFICATION_ENABLED=true`; cùng nội dung không gửi lại trong 6 giờ);
không có kênh → chỉ log error. Lỗi fetch chỉ log error (tránh spam 10 phút/lần khi token hết hạn).

### 9d.7 Kích hoạt
| Đường | Chi tiết |
|---|---|
| `GET /v1/orders/onospod-hold-sync/cron` | Public (`@Auth([], [], { public: true })`), log ip/userAgent. Trả `SyncOnospodHoldResDto` `{ status, reason?, window, fetched, held[], unheld[], flagged[], flagCleared[], dismissedSkipped[], outOfWindowKept[], notFound, unchanged }` (mảng = `productionId`). |
| Cuối `importFromOnosPod` | Nút "Lấy đơn từ OnosPod" + `import-from-onospod/cron` chạy thêm 1 lượt sau import, kết quả ở `data.holdSync`. Bọc try/catch — lỗi đồng bộ không làm hỏng kết quả import. |

KHÔNG dùng `@Cron` nội bộ. **Lịch khuyến nghị: 10 phút/lần**, người vận hành tự đặt
crontab ngoài, ví dụ:

```
*/10 * * * * curl -fsS https://api.onosfactory.com/api/v1/orders/onospod-hold-sync/cron > /dev/null
```

### 9d.8 Giao diện
- Đơn giữ theo OnosPod hiện `HeldBadge` như mọi đơn giữ, lý do dịch `heldBadge.onospodReason` ("Giữ theo OnosPod" / "Held by OnosPod"); khóa thao tác y như §9b.3.
- Đơn mang cờ mà bên mình KHÔNG giữ → nhãn nhỏ viền hổ phách `heldBadge.onospodFlag` ("OnosPod đang giữ") ở Danh sách đơn (`ListOrderTab`), bảng xưởng (`OrderTableWorkshop`, `OrderTableClassic`) và cột Production của bảng In (`workshopTableConfig`). Chỉ báo, không khóa.

### 9d.9 Giới hạn
- OnosPod không có lý do giữ → lý do bên mình luôn là "Giữ theo OnosPod".
- Cửa sổ quét 60 ngày theo `mrp_created_at` (`ONOSPOD_HOLD_SYNC_WINDOW_DAYS`): item giữ cũ hơn không được giữ mới; đơn đã giữ-do-đồng-bộ trôi ra ngoài cửa sổ thì KHÔNG tự nhả (nhả tay).
- Đơn chưa từng import (không có `productionId` bên mình) → chỉ đếm `notFound`.
- Không phản chiếu ngược: giữ/nhả bên mình KHÔNG đẩy sang OnosPod.

---

## 10. Danh sách đơn (Phase 4)

### 10.1 Router quyết định bảng nào

`pages/orders/index.tsx` đọc permission qua hook `usePermission()`:

```tsx
const adminVisible    = canViewAdminTable();       // order.view_admin_table
const workshopVisible = canViewWorkshopTable();    // order.view_workshop_table
const canImport       = has('order.import');
```

Render tab tương ứng. User chỉ có 1 trong các quyền → 1 tab; có nhiều quyền (Admin) → cả 3 tab.

`handleTabChange` (Phase 7.2) strip param của 2 tab kia khi switch tab để URL không lẫn lộn:
- Switch sang `list` → strip `w*`.
- Switch sang `workshop` → strip `l*`.
- Switch sang `import` → strip cả 2 (import tab không có filter).

### 10.2 `OrderTableWorkshop.tsx`

#### Cấu trúc cột (định nghĩa tập trung trong `apps/web/src/components/orders/workshopTableConfig.tsx` → `WORKSHOP_COLS`)

| # | Key | Cell | Permission view |
|---|-----|------|-----------------|
| 1 | productionId | Composite (Production ID + Order ID + **Platform ID** + In Production At). Dòng `ext: <externalId>` là mã đơn bên sàn (TikTok/Etsy…) — cột "External ID" lúc import, chỉ hiện khi đơn có. Cùng cách trình bày với `ListOrderTab`. | luôn |
| 1b | **orderStatus** | Nhãn **trạng thái hiện tại** (chặng đơn đang nằm + chờ/đang làm/làm lại), suy từ `cancelledAt`/`fulfillmentCompletedAt`/`currentFulfillmentStage`/`designerStatus`/`toolResultNote` — xem §24. | luôn |
| 2 | mockupTypeSize | `ImageThumbCell` + Type + Size/Color | luôn |
| 2b | **designs** | `DesignThumbsCell` — tối đa 2 thumb inline (32px) + "+N" badge nếu nhiều hơn 2 → click badge mở Popover grid 4 cột tất cả design. Click thumb mở `ImagePreviewDialog`. Tận dụng `ImageThumbCell` cho từng thumb (pending/failed/ready state). | luôn |
| 3 | **fabricType** | `IconSelectCell` (category `fabric_type`) — Phase 7 | `order.field.fabricType.view` |
| 3b | **machineNumber** | `ColorBadgeSelectCell` (category `machine`) — badge có color (94/27/56…). Lấy từ ProductConfig khi import; xưởng có thể click sửa nếu phải chuyển máy in giữa chừng. | `order.field.machineNumber.view` / `.edit` |
| 4 | printStatus | `ColorBadgeSelectCell` | `order.field.printStatus.view` |
| 5 | printStatusNote | `IconSelectCell` | `order.field.printStatusNote.view` |
| 6 | toolResult | `IconSelectCell` | `order.field.toolResult.view` |
| 7 | **toolResultNote** | `ColorBadgeSelectCell` + suffix badge **"×N"** (rose) khi `productionErrorCount >= 2` AND value='error'. Signal cho fulfillment rằng đơn đã bị báo lỗi nhiều lần. | `order.field.toolResultNote.view` |
| 8 | errorFile | `IconSelectCell` | `order.field.errorFile.view` |
| 9 | errorFileNote | `TextEditCell` | `order.field.errorFileNote.view` |
| 10 | **productionError** | `ProductionErrorSelectCell` (category `production_error`). Pick code='other' → mở `ProductionErrorOtherDialog` bắt buộc source + note. Popover options có badge "DES"/"XƯỞNG"/"CẦN CHI TIẾT". | `order.field.productionError.view` |
| 10b | **productionErrorSource** | `ErrorSourceCell` (label "Loại lỗi") — picker designer/factory. Auto-fill từ workshop_config; user override khi cần. | `order.field.productionErrorSource.view` |
| 11 | **productionErrorNote** | `TextEditCell` — mô tả lỗi free text | `order.field.productionErrorNote.view` |
| 12 | **assignee** | `AssigneeSelectCell` — picker user từ designer team (`designerTeamStore`), value = `user._id`, display = `fullName`. KHÔNG còn dùng workshop_config. **Đơn `toolResultNote='ok'` → cell khoá (`blockedReason` + tooltip), không gán được** — xem `DesignerTaskWorkflow.md §2.2`. | `order.field.assignee.view` |
| 13 | assigneeNote | `IconSelectCell` | `order.field.assigneeNote.view` |
| 13b | **designerStatus** | Read-only badge color 6 state (Chưa gán/Cần làm/Đang làm/Đã xong/Không làm được/Cần làm lại) + suffix "×N" khi `designerReworkCount > 0`. | `order.field.designerStatus.view` |
| 14 | userSku | text + CopyButton | luôn |
| 15 | typeFullName | text (`productConfig.fullName`) | luôn |
| 16 | factoryMachine | badge `factory.name` + badge `machineType.name` (gộp 2 dòng) | luôn |

`WORKSHOP_COLS` được reuse bởi cả Tab `OrderTableWorkshop` (apps/web/src/pages/orders) **và** Dashboard Tab C `OrderFactoryTab`. Dashboard Tab C thêm 1 cột "Xưởng (đang / gốc)" ở đầu để hiển thị badge transfer.

#### 10.2a Compact grouped columns (`OrderTableWorkshop` + Dashboard `OrdersMiniTable`/`OrderFactoryTab` — giảm scroll ngang)

`WORKSHOP_COLS` gốc có ~20 cột riêng lẻ → các bảng đơn (`/ffm/orders/workshop`, Dashboard tab Trạng thái + tab Xưởng) scroll ngang rất sâu. Logic gom nhóm sống trong **`workshopTableConfig.tsx`** (dùng chung, KHÔNG duplicate ở từng trang):
- `BASE_GROUP_DEFS` + `SUPPORT_GROUP_ORDER` + `HEADLINE_KEYS` + `FIELD_LABELS` — định nghĩa group + field label.
- `buildColGroups(visibleCols, roleName)` — build group đã resolve (lọc quyền + đổi thứ tự theo role) từ `visibleCols`.
- `GroupCellContent` — component render nội dung 1 group cell (field xếp CHIỀU DỌC, tự thêm label field không có cột riêng), nhận `renderedByKey` (Map key→ReactNode đã render sẵn) + `extra` optional (chèn node cạnh 1 member, vd Badge combo cạnh `mockupTypeSize`).

3 nơi dùng: `OrderTableWorkshop.tsx` (`/ffm/orders/workshop`, có thêm sticky + virtualization), `OrdersMiniTable.tsx` (Dashboard tab Trạng thái — Tab B), `OrderFactoryTab.tsx` (Dashboard tab Xưởng — Tab C, giữ nguyên cột "Xưởng (đang / gốc)" riêng TRƯỚC các group). `ErrorLogTab`/`PrintOrderTable` (không thuộc Dashboard) vẫn dùng layout cột phẳng như cũ.

7 group hiển thị — mỗi group là 1 cột bảng nhưng bên trong xếp field CHIỀU DỌC (nhiều dòng) thay vì mỗi field 1 cột ngang:

| Group | Title header | Member field keys (thứ tự hiển thị trong cell) |
|---|---|---|
| `identity` (sticky đầu bảng) | Mã đơn / Ưu tiên | `productionId`, `orderStatus`, `priority`, `userSku`, `typeFullName` |
| `product` | Sản phẩm | `mockupTypeSize` |
| `toolCheck` | Kết quả Tool / File lỗi | `toolResult`, `toolResultNote`, `errorFile`, `errorFileNote` |
| `factory` | Xưởng · Vải · Máy | `factoryMachine`, `fabricType`, `machineNumber` |
| `print` | Trạng thái in | `printStatus`, `printStatusNote` |
| `productionError` | Lỗi xưởng | `productionError`, `productionErrorSource`, `productionErrorNote` |
| `assignee` | Người thực hiện | `assignee`, `assigneeNote`, `designerStatus` |

> Group `toolCheck` GỘP "Kết quả Tool" + "File sửa lỗi" cũ (trước là 2 group `toolCheck`/`errorFile` riêng) thành 1 cột duy nhất, 4 field xếp dọc: `toolResult` → `toolResultNote` → `errorFile` → `errorFileNote`. Áp dụng cho MỌI bảng dùng `buildColGroups` (workshop, `OrdersMiniTable`, `OrderFactoryTab`…).

Thứ tự group MẶC ĐỊNH (mọi role trừ Support) đặt `toolCheck` (gồm cả file lỗi) ngay sau `product`, TRƯỚC `factory` (soát kết quả Tool + file sửa lỗi là bước đầu tiên cần thấy). Role Support dùng `SUPPORT_GROUP_ORDER` cùng thứ tự này. Member field nào bị ẩn quyền thì loại khỏi group; group rỗng hết member thì ẩn cả cột.

- **Label cho field không còn cột riêng**: field không thuộc `HEADLINE_KEYS` (`productionId`, `mockupTypeSize`, `factoryMachine` — đã tự mô tả qua tên/ảnh/badge) được thêm 1 label ngắn phía trước value, lấy từ `FIELD_LABELS` (vd `fabricType` → "Vải", `machineNumber` → "Máy", `productionErrorNote` → "Mô tả").
- **Width cột** tính theo GROUP (`ColGroupDef.width`, cố định px) thay vì cộng dồn width từng field lẻ — tổng width bảng giảm từ ~3100px (20 cột) xuống ~1500-1700px (8 group + checkbox + action).
- **Sticky đầu bảng**: group `identity` (chứa `productionId`) luôn là group index 0 → giữ class sticky `left-8` cũ; badge "Đã hủy"/"Đang giữ" (`CancelledBadge`/`HeldBadge`) gắn ở đầu cell group này (trước đây gắn ở cột đầu tiên nói chung).
- **Header hàng tiêu đề loại sản phẩm** (`kind: 'header'` trong `flatItems`) — `position: sticky` trên 1 `<TableCell colSpan={nhiều}>` KHÔNG ghim khi cuộn ngang (browser bug thực tế, đã xác nhận qua test tay). Fix: tách 2 cell — 1 cell sticky `left-8` KHÔNG `colSpan` (ghim đúng) chứa chevron/tên/badge với `overflow-visible` + `shrink-0` mọi item (bỏ `line-clamp-1`) để nội dung TRÀN ra ngoài biên cell thay vì bị cắt, đè lên cell filler colSpan rỗng bên cạnh nhờ z-index của element sticky — filler luôn trống (không có data thật) nên phần tràn không bao giờ che thông tin khác, kể cả khi đã cuộn ngang.
- **Nền cell sticky PHẢI là màu ĐẶC (không alpha `/NN`)** — sticky cell (checkbox, group `identity`, action, checkbox+tên nhóm ở hàng tiêu đề loại sản phẩm) dùng chính `rowBgClass`/`bg-muted` làm nền để CHE nội dung cuộn phía sau nó. Trước đây dùng màu có alpha (`bg-primary/10`, `dark:bg-primary/20`, `bg-muted/40`…) → khi cuộn ngang, chữ của cột phía sau xuyên qua lớp nền trong suốt, đè lên cột đang ghim (rõ nhất ở group `identity` khi row đang được TICK CHỌN). Đã đổi `rowBgClass` (`ProductRow`) sang màu đặc: `bg-indigo-50`/`dark:bg-indigo-950` (selected), `bg-amber-50`/`dark:bg-amber-950` (heaviest combo), `bg-sky-100`/`dark:bg-sky-950` (no-tool); sticky cell của hàng tiêu đề loại sản phẩm đổi `bg-muted/40` → `bg-muted` (đặc).
- **Badge combo "×N"** vẫn gắn cạnh giá trị `mockupTypeSize` bên trong group `product`.
- **Virtualizer**: `estimateSize` row thường tăng từ 68px → 130px vì field giờ xếp dọc nhiều dòng trong 1 group (group `identity` có tới 4 dòng); `measureElement` vẫn tự đo lại chính xác sau render.

> **Trang Fulfillment "In"** dùng bảng **phẳng riêng** `PrintOrderTable` (KHÔNG group sản phẩm), KHÔNG reuse `OrderTableWorkshop`. Lấy data từ `GET /v1/orders` (`sort=grouped`). Xem `FulfillmentWorkflow.md §4.5`.

`WorkshopOrderRow` có thêm field optional `currentFulfillmentStage` + `fulfillmentStages` để consumer (PrintOrderTable) quyết định hiển thị action theo trạng thái stage.

### 10.2b `OrderTableClassic.tsx` — "Đơn hàng", flat + phân trang thật

> **Mục tiêu:** Bản thay thế KHÔNG gộp theo sản phẩm của `OrderTableWorkshop` — cùng cột/filter/bulk edit, chỉ khác cách hiển thị (phẳng, phân trang theo SỐ DÒNG ĐƠN thay vì SỐ LOẠI SẢN PHẨM) và KHÔNG có block Designer Summary. Route riêng `/ffm/orders/classic`, menu sidebar **"Đơn hàng"** (`Rows3` icon, key `sidebar.orders.classic`) — nằm trong **NHÓM MENU RIÊNG "Đơn hàng"** (`title: t('sidebar.groups.orders')`, ngang hàng nhóm "Danh mục"/"Cá nhân"/"Quản trị" trong `buildNavGroups()`, KHÔNG còn lồng trong nhóm "Quản lý đơn" nữa), gate cùng permission `page.orders` + `order.view_workshop_table` (mirror `OrdersWorkshopPage`).

**Tái dùng NGUYÊN VẸN** (không duplicate logic, chỉ đổi cách render/fetch):
- `WORKSHOP_COLS` + `buildColGroups()` + `GroupCellContent` + `groupTitle` (`workshopTableConfig.tsx`) — CÙNG 7 group cột như §10.2/§10.2a.
- `<OrderFilterBar>` — CÙNG 10 facet chuẩn (bao gồm `designerStatus`, vẫn gate theo `canSeeDesignerSummary` cho quyền XEM facet đó — khác việc ẩn PANEL thống kê) + toggle "Đang giữ"/"Đã hủy" + chip "Đang lọc". **Riêng Classic có thêm facet thứ 11 `type` (Sản phẩm)** — xem điểm 9 dưới.
- `<BulkEditToolbar>` — y hệt, bao gồm nút "Bỏ gán design" (§ DesignerAutoAssign) mới thêm.
- `AssigneeSelectCell`/`OrderRowActionsMenu`/`OrderDetailDialog`/`OrderLogTimelineDialog`/`ImagePreviewDialog` — mọi cell/dialog dùng chung.

**Khác `OrderTableWorkshop`:**
1. **Fetch** qua `RepositoryRemote.order.getOrders()` (endpoint `GET /v1/orders` thường) thay vì `getOrdersGrouped()` — `page`/`limit` áp trực tiếp lên số dòng đơn, KHÔNG phải số loại sản phẩm. Response phẳng `{ data: OrderRow[], total }`, không có `groups[]`.
2. **KHÔNG virtualize** — bảng render toàn bộ `items` của trang hiện tại bằng `<TableBody>` thường (không cần `useVirtualizer`/`scrollMargin`/measure vì không còn hàng trăm dòng ẩn trong group chưa mở).
3. **KHÔNG có**: header hàng "loại sản phẩm" (`collapsedTypes`/`toggleType`), nút "Mở hết/Đóng hết", badge combo "×N"/heaviest-combo highlight (`comboKeyOf`), `DesignerSummaryPanel` + nút "Chi tiết tồn đọng" + `DesignerBacklogDialog`.
4. **URL param prefix `c`** (khác `w` của Workshop, `l` của `ListOrderTab` cũ đã tắt) — `csearch`/`cfrom`/`cto`/**`ctype`**/`cprint`/`cnote`/`cassign`/`cerror`/`cfabric`/`cmnum`/`ctool`/`cerrfile`/`cdstatus`/`cusersku`/`cheld`/`ccancel`/`cpage`/`csize` + `pid` (share chung tên với Workshop, không prefix). Toàn bộ filter sync 2 chiều với URL (`useSearchParams` + `{replace:true}`) — copy URL chia sẻ được nguyên trạng bộ lọc đang xem, giống Workshop. Ngày `createdFrom`/`createdTo` mặc định RỖNG (không tự set "hôm nay" như Workshop) — trang cổ điển ưu tiên xem toàn bộ theo mặc định.
5. **"Cập nhật toàn bộ trang"** cho các thao tác bulk: vì đơn vị phân trang = dòng đơn thật (không phải sản phẩm), checkbox header "Chọn tất cả trang này" (`toggleAll`) tick 1 lần là chọn được TOÀN BỘ đơn đang hiển thị trên trang → `<BulkEditToolbar>` áp bulk action (gán design, đổi field, giữ đơn, ưu tiên...) cho **nguyên trang** ngay lập tức, không cần chọn tay từng dòng như khi các đơn còn nằm rải trong nhiều group đóng.
6. **`patchRow`** chỉ cần update 1 state `items` (không có `groups` song song để đồng bộ như Workshop).
7. **Sort mặc định**: `sort=inProductionAt&order=desc` — đơn vào sản xuất MỚI NHẤT hiện trước (giống default `getOrders()` khi không truyền `sort`, đặt tường minh cho rõ ràng). `priority: -1` vẫn luôn ưu tiên trước (hardcode ở BE, không đổi được qua `sort`/`order`).
8. **"Chọn tất cả N đơn khớp bộ lọc" — xuyên MỌI trang** (`handleSelectAllPages`, CHỈ có ở trang này, không có ở Workshop): khi đã tick hết trang hiện tại và còn đơn ở trang khác (`total > items.length`), hiện banner mời chọn tiếp toàn bộ `total` đơn khớp filter hiện tại. Bấm vào gọi lại `getOrders()` với CÙNG `buildFilterParams()` nhưng `page=1`/`limit=total` để lấy đủ `_id` mọi trang rồi đổ thẳng vào `selected` — mọi bulk action ở `<BulkEditToolbar>` tự áp dụng cho toàn tập vì chỉ nhận mảng `ids`, không quan tâm chúng đến từ trang nào. Box "Mẹo chọn nhiều đơn" (`selectionHint`) **đã quay lại** từ ORD-1 (`AC-09`) sau một thời gian bị gỡ khỏi trang này — nhưng **chỉ hiện `line2`** (mẹo shift-click chọn dải), **cố ý bỏ `line1`** vì dòng đó mô tả thao tác tick checkbox cạnh tên sản phẩm, vốn chỉ tồn tại ở bảng nhóm của Workshop (`SRS` ORD-1 BR-15). **Lưu ý đối chiếu 2 trang:** `handleSelectAllPages` ở điểm này là chức năng **CHỈ Classic có**, Workshop không có — đây là hệ quả của việc hai trang phân trang theo đơn vị khác nhau, xem `.devtasks/ui/ORD-1.md` §3.5.

9. **Lọc theo SẢN PHẨM — facet `type`, CHỈ Classic có** (ORD-1). Workshop không cần vì nó đã nhóm đơn theo sản phẩm sẵn; Classic phẳng nên trước đây không có đường nào thu hẹp theo sản phẩm. Ô select **đứng đầu** lưới facet (loại sản phẩm là cách khoanh vùng thô nhất), **đơn chọn** đúng như 10 facet còn lại, param URL `ctype`, chip màu lime. Từ ORD-2 facet này khai `searchable: true` → render `SearchableSelectFilter` (`apps/web/src/components/common/SearchableSelectFilter.tsx` — Popover + ô gõ từ khóa lọc option theo label, không phân biệt hoa thường) thay cho native select; chọn xong hành vi filter/chip/URL `ctype` giữ nguyên. 10 facet còn lại vẫn là native `SelectFilter`. **KHÔNG đặt `perm` gate** — cột `mockupTypeSize` (nơi tên sản phẩm vốn đã hiện) khai `perm: null` nên hiện với MỌI role, gate facet ở đây sẽ là gate giả. Options lấy từ `workshopFilters.type` của **cùng** endpoint `GET /v1/orders/workshop-filters` mà cả 2 trang đang gọi — không endpoint riêng. Gửi BE bằng `params.append('type', ...)` (dạng lặp) chứ không `set`: BE nhận cả dạng lặp lẫn CSV nhưng **chỉ dạng lặp mới không tách chuỗi bằng dấu phẩy**. Token `__none__` (đơn chưa xác định loại sản phẩm) **do BE quyết định có trả hay không** — FE KHÔNG BAO GIỜ tự tạo mục đó, chỉ gán nhãn `tableWorkshop.noTypeName` nếu backend trả về kèm `label` rỗng. Chi tiết thiết kế: [`.devtasks/ui/ORD-1.md`](../../.devtasks/ui/ORD-1.md); hợp đồng BE: [`.devtasks/design/ORD-1.md`](../../.devtasks/design/ORD-1.md) §3.

**File FE:** `apps/web/src/pages/orders/OrderTableClassic.tsx` (component) + `apps/web/src/pages/orders/classic/index.tsx` (page wrapper, mirror `orders/workshop/index.tsx`).

**Filter chips "Đang lọc" + reset selection** (`OrderTableWorkshop.tsx`):
- **Reset chọn đơn về 0 khi BẤT KỲ filter nào đổi** (search/date/9 facet) — `useEffect` deps = toàn bộ filter, KHÔNG gồm `page/pageSize` (đổi trang vẫn giữ selection). Tránh gán nhầm đơn không còn hiển thị sau khi đổi filter.
- **Thanh chip "Đang lọc:"** ngay dưới `OrderFilterBar` — render mỗi filter đang active (facet có value + search + date khi KHÁC mặc định hôm nay) thành 1 chip **màu riêng theo loại** (`FILTER_CHIP_COLORS` — static class cho Tailwind purge), có nút `×` bỏ lẻ từng filter. Chỉ hiện facet user có quyền xem (lọc theo `perm`/`hidden` như `OrderFilterBar`).
- **Nút "Xóa tất cả lọc"** (`FilterX` icon) → reset toàn bộ facet + search về rỗng, date về hôm nay, page về 1 (selection tự reset qua effect trên). Thanh chỉ hiện khi có ≥1 filter active.
- `facets` được tách thành 1 `const` dùng chung cho cả `OrderFilterBar` lẫn tính chip (1 nguồn).

**DTO / endpoint liên quan** (dùng bởi `PrintOrderTable`):
- `GetProductionOrdersDto.fulfillmentStatus` (enum `waiting|in-progress|rework|done|watching`) + `userSku` (CSV filter) — `buildOrderListFilter` + `applyFulfillmentStatusFilter` áp vào `getOrders`/`getOrdersGroupedByType`.
- `GET /v1/orders/fulfillment-status-counts` → `{all, waiting, inProgress, rework, done, watching}`.
- `getWorkshopAvailableFilters` thêm facet `type` + `userSku` (dropdown Tên sản phẩm + Khách hàng).

**"No tool" row highlight** (tô nền xanh dương nhạt) — hook `useIsNoTool()` (`apps/web/src/hooks/useIsNoTool.ts`) + class `NO_TOOL_ROW_CLASS = 'bg-sky-50/70 dark:bg-sky-500/10'`. Logic: `toolResult` set + resolve qua `workshopConfigStore` + `name` KHÔNG bắt đầu bằng "Có" (đồng bộ với BE convention ở `order.service.ts:1706` `toolHasCodes` regex `^Có`). Áp dụng tại `<TableRow>` của 4 bảng order:
- `OrderTableWorkshop` (priority: selected > heaviest-combo > no-tool tint).
- `OrderFactoryTab` (priority: selected > no-tool tint).
- `OrdersMiniTable` (selected tint không có → no-tool áp trực tiếp).
- `ErrorLogTab` (urgency badge ở cell riêng nên row class chỉ no-tool tint).

Row `toolResult` null/empty (chưa check) → KHÔNG tô (tránh hiểu nhầm "chưa biết" thành "không có tool").

#### Cell components (`components/orders/cells/`)

- **`SelectPopover`** — shared popover với "Bỏ chọn" + list options.
- **`ColorBadgeSelectCell`** — badge nền `workshop_config.color`. Click → popover → PATCH `/v1/orders/:id/field`. Hiển thị spinner trong khi save, toast success/error. Update optimistic qua callback `onUpdated(newCode)` để patch row local.
- **`IconSelectCell`** — chip màu nhẹ + icon Lucide từ `workshop_config.icon`. Cùng flow.
- **`TextEditCell`** — Input inline (dùng cho `errorFileNote` và `productionErrorNote`). Commit khi `blur` hoặc `Enter`, `Escape` revert.
- **`ImageThumbCell`** — thumb 36px (variant `s200`), click mở `ImagePreviewDialog`.

Mỗi cell tự đọc `canEditField(field)` từ `usePermission()`:
- Có quyền → click sửa được.
- Không → readonly hiển thị giá trị.

### 10.2b Selection (Phase tiếp theo Phase 7.2)

- **Header global checkbox** (cũ): tick/untick toàn bộ rows hiện tại trên page.
- **Group checkbox**: mỗi row tiêu đề sản phẩm có 1 checkbox riêng (state `all` / `some` indeterminate / `none`) → tick toàn bộ đơn của nhóm. Badge `N/M chọn` hiển thị khi nhóm có ít nhất 1 đơn được chọn.
- **Shift+click range** (Excel/Google Sheets style): user click checkbox đầu, giữ `Shift`, click checkbox khác → mọi row giữa 2 vị trí được set theo state mới của row vừa click. Anchor (`lastClickedId`) update mỗi lần click. Range chỉ tính các order ĐANG HIỂN THỊ (group đã collapse → bỏ qua). Thứ tự range đọc từ memo `visibleOrderedIds` phải khớp với thứ tự render xuống body (same sort: `comboCount` desc → key asc).

### 10.2c Bản 2026-09 — phễu chặng · dải pill · thanh công cụ một hàng (`/ffm/orders/workshop`)

> Thiết kế lại theo bản "Bảng điều hành gọn" (Superdesign, draft `216e4ad8`, dữ liệu thật 06/09/2026). Mục tiêu: quản lý xưởng nhìn 1 màn hình biết **hôm nay bao nhiêu đơn, kẹt ở chặng nào, đơn nào cần xử lý**. GIỮ NGUYÊN engine bảng (§10.2/§10.2a: 7 cột gộp, ô sửa inline, chọn nhiều, virtualization, bulk) — chỉ đổi phần KHUNG trên bảng và cách tô hàng.

**Bố cục mới (trên → dưới), file `apps/web/src/pages/orders/`:**

| Khối | Component | Nội dung |
|---|---|---|
| Phễu chặng | `workshop/WorkshopStageStrip.tsx` | 8 ô Soát tool → Thiết kế → In → Ép → QC → May vào → May ra → Đóng hàng (`LIFECYCLE_STAGE_KEYS`), số = đơn **đang ở** chặng đó trong phạm vi filter (BE `stageCounts`), thanh tỉ lệ so với ô lớn nhất, ô 0 mờ đi, ô đang chọn viền `primary`. Bấm ô = lọc `workshopStage` (bấm lại bỏ). Dòng dưới: "Tổng N đơn · M loại SP" (`totalOrders`/`totalTypes`), chia theo xưởng (`factoryCounts`), 2 chip toggle **Đang giữ**/**Đã hủy** (thay 2 nút cũ trên thanh lọc, cùng `held`/`cancelled`). |
| Thanh công cụ | `workshop/WorkshopToolbar.tsx` | Một hàng: ô tìm · nút "Nhiều mã" · **chip ngày** `‹ Hôm nay · 06/09/2026 ›` (mũi tên dịch ±1 ngày khi đang xem 1 ngày, bấm giữa mở `DateRangePicker` inline) · **nút chọn xưởng** (segmented Tất cả/TN/ML… từ `factoryCounts`, ghi `factoryId` lên URL — cùng chỗ với cụm menu theo xưởng §25, ẩn khi ≤1 xưởng hoặc tài khoản Fulfillment) · **"Bộ lọc"** (popover gom 10 facet + badge số facet đang bật, thay lưới facet trải ngang) · tải lại. Hàng dưới: **5 pill** kèm số (`pillCounts`) + nút **"Tồn thiết kế N"** mở/đóng `DesignerSummaryPanel` (mặc định ĐÓNG). |
| Gợi ý chọn | (inline) | 1 dòng mờ thay hộp 2 dòng cũ. |
| Bảng | `OrderTableWorkshop.tsx` | Header 36px chữ hoa 11px nền `muted/40`; hàng nhóm sản phẩm nền `card` mỏng + pill "N đơn"/"max ×N"; hàng đơn **không tô nền cả hàng** theo trạng thái nữa — "thiếu tool" (sky) / "đang giữ" (amber) chỉ còn **dải 2px bên trái** + chip, combo nặng nhất giữ badge ×N; nền chỉ đổi khi ĐANG CHỌN; nút Lịch sử/"..." **hiện khi rê chuột** (`group-hover`, giữ hiện khi menu đang mở); phân trang **chỉ ở dưới**. |

**Bản 3 — rail loại sản phẩm (chọn 07/09/2026, draft `32331d8f`, thay thế bố cục bảng nhóm của bản 2):** dưới thanh công cụ, thân trang chia 2 cột:

| Cột | Component | Nội dung |
|---|---|---|
| Trái 280px, ghim theo `<main>` | `workshop/WorkshopTypeRail.tsx` | Ô lọc tên loại (client-side) · hàng **"Tất cả · N đơn / M sp"** · mỗi loại sản phẩm 1 hàng: tên (2 dòng), "N đơn / M sp", **thanh mini chia theo chặng** (slate soát tool · sky thiết kế · indigo in · amber ép · violet QC · emerald may · teal đóng · emerald đậm đã xong). Nguồn: BE `typeStats` (bỏ qua chính filter `type` — chọn 1 loại vẫn thấy đủ danh sách). Hàng đang chọn: dải 3px `primary` + nền `primary/5`. |
| Phải | `OrderTableWorkshop.tsx` | Tiêu đề: tên loại đang chọn + pill "N đơn" + tối đa 4 chip chặng của loại đó (chip trùng ô phễu đang chọn tô `primary`); xem Tất cả → "N đơn · M loại sản phẩm". Chọn 1 loại → BE `type=<tên>` (gửi `append`, token `__none__` cho đơn không tên), bảng **bỏ hàng tiêu đề nhóm**, mở sẵn mọi đơn, chân bảng "Đang xem N / M đơn của loại này" thay phân trang (1 loại = 1 trang của endpoint grouped). Xem Tất cả → giữ bảng nhóm + phân trang theo loại như §10.2a. |

**Rút gọn (07/09/2026):** phễu chỉ còn 8 ô (bỏ hàng tổng/xưởng/chip dưới phễu). Hàng 1 thanh công cụ: Nhiều mã · chip ngày · Bộ lọc · tải lại · **Tồn thiết kế** (nút Tất cả/TN/ML trong trang đã bỏ 07/09/2026 — đổi xưởng bằng bộ chọn toàn cục trên header, §25); hàng 2 chỉ còn 5 pill + chip **Đã hủy**. **Đã bỏ hẳn** thanh chip "Đang lọc"/"Xóa tất cả lọc" và dòng "Tổng N đơn · M loại" (trùng với phễu/rail/pill — bỏ lọc bằng chính pill/ô/rail, hoặc nút Xóa hết lọc trong popover Bộ lọc); hằng `FILTER_CHIP_COLORS`/`fmtChipDate` đã xóa khỏi `OrderTableWorkshop`. Badge chia xưởng (`factoryCounts`) hiện ở tiêu đề bảng phải cạnh tên loại + số đơn (chỉ khi đang chọn 1 loại). Không còn dòng gợi ý chọn nhiều đơn. **Ô tìm kiếm lớn đã bỏ** — tra theo mã đơn qua nút "Nhiều mã" (`productionIds`), URL `wsearch` cũ vẫn được đọc/hiện chip nếu có.

**Tiêu đề trang lên Header (07/09/2026):** `workshop/index.tsx` không còn khối tiêu đề to (icon + h1 + phụ đề) trong thân — gọi `usePageHeader(t('workshopPage.title'), t('workshopPage.subtitle'))` (`apps/web/src/hooks/usePageHeader.ts` → store `apps/web/src/store/pageHeaderStore.ts`), `components/header/index.tsx` render tiêu đề ở góc trái; trang nào không gọi hook thì header trái để trống. Nút thu gọn sidebar cũng dời từ header VÀO thanh logo của `Sidebar.tsx` (prop `onToggleCollapse`, chỉ desktop). Khung cố định: `MainLayout` `h-screen overflow-hidden`, sidebar `h-screen`, chỉ `<main>` cuộn.

**Khung cột cố định trong trang (07/09/2026):** `MainLayout` `<main>` là `flex flex-col`, `motion.div` `flex-1 min-h-0` → trang nào đặt root `flex-1 min-h-0` sẽ chiếm đủ chiều cao còn lại (trang thường không đổi). Trang xưởng: root `flex flex-col gap-4`; phễu + thanh công cụ `shrink-0`; vùng rail|bảng `flex-1 min-h-[260px]`; card bảng = cột flex `overflow-hidden` với thân bảng `ref=tableScrollRef` `flex-1 min-h-0 overflow-auto` (cuộn dọc + ngang), chân bảng (phân trang / "Đang xem") là hàng `shrink-0` luôn thấy — như khối tài khoản ở sidebar. **Virtualizer bám vào `tableScrollRef`** (không còn dùng `<main>` làm scroll parent); `scrollMargin` đo theo cùng container. Rail `h-full` tự cuộn.

**Màu chặng một nguồn:** `workshop/stageColors.ts` (`STAGE_COLORS` bar/dot/chip + `STAGE_BAR_ORDER`) dùng chung cho chấm màu + thanh ô phễu, thanh mini rail, chip chặng tiêu đề bảng phải — lớp Tailwind tường minh (slate soát tool · sky thiết kế · indigo in · amber ép · violet QC · emerald may vào · teal may ra · lime đóng · emerald đậm đã xong); điểm nhấn chọn dùng `indigo-*` vì `bg-primary` của theme là navy. Rail ghi "N đơn", chỉ thêm "/ M sp" khi tổng số lượng khác số đơn.

State `filterType` ↔ URL `wtype`; chip "Đang lọc" màu lime (`FILTER_CHIP_COLORS.type`, cùng màu Classic `ctype`). Không thêm facet `type` vào popover "Bộ lọc" — rail đảm nhiệm.

**5 pill ↔ filter (bật là toggle, tắt là về rỗng; số của mỗi pill bỏ qua chính filter đó):**

| Pill | State/URL | Gửi BE | Đếm (BE) |
|---|---|---|---|
| Lỗi file | `filterErrorFile='__any__'` / `werrfile=__any__` | `errorFile=__any__` → `errorFile.0 $exists` | `pillCounts.errorFile` |
| Thiếu tool | `filterToolResult` = CSV mọi mã toolResult mà `useIsNoTool()` = true | `toolResult=<csv>` | `pillCounts.noTool` = toolResult `$nin [null,'',…toolHasCodes]` |
| Chưa soát | `filterToolResult='__none__'` | `toolResult=__none__` (sẵn có) | `pillCounts.unreviewed` (= `toolResultNoneCount`) |
| Ưu tiên | `filterPriority='__any__'` / `wprio` | `priority=__any__` → `priority $exists & $nin [null,0]` | `pillCounts.priority` |
| Đang giữ | `filterHeld` / `wheld` (sẵn có) | `held=true` | `heldCount` |

`pillCounts.designBacklog` = `designerStatus ∈ {assigned, in-progress, rework}` — chỉ hiện số trên nút "Tồn thiết kế".

**BE (`order.service.ts`, DTO `production-order.dto.ts`):**
- `GetProductionOrdersZod.workshopStage` — enum `WORKSHOP_STAGE_FILTER_KEYS` (8 chặng + `done`). Áp trong `buildOrderListFilter` qua `workshopStageMatch(stage)` (truy vấn thường). Chặng suy bằng **đúng luật `computeCurrentStage()`** (§24): đã đóng hàng → `done`; có `currentFulfillmentStage` → chặng đó; `designerStatus` ≠ unassigned → `done` thì `print`, còn lại `designer`; `toolResultNote` rỗng → `tool-check`, có → `designer`.
- `workshopStageExpr()` — cùng luật dạng `$switch`, CHỈ dùng trong aggregate để `$group` đếm phễu. **Bẫy:** Mongoose 7 không cast được `$switch` trong `$expr` ở `find`/`countDocuments` (`cast$expr` ném `Cannot read properties of undefined (reading 'map')`) → lọc phải đi bằng `workshopStageMatch`. Hai hàm phải cho cùng kết quả — kiểm bằng cách so tổng khi `workshopStage=X` với `stageCounts[X]` (đã đối chiếu 9/9 chặng trên dev, cửa sổ 25/08–07/09: 84/193/432/1066/35/23/110/1/3707 = 5.651).
- `getWorkshopAvailableFilters` trả thêm `stageCounts` (bỏ `workshopStage`), `factoryCounts` (bỏ `factoryId`, kèm `shortName`/`name` từ `factoryRepository`), `pillCounts`, `totalOrders`/`totalTypes` — cùng khuôn cross-facet (`baseWithout()`/`countWith()`), vẫn loại đơn hủy như mọi facet.
- Token mới: `errorFile=__any__`, `priority=__any__`.
- `typeStats` (bản 3): 1 aggregate `$group` theo `(type, chặng)` rồi gộp theo `type` (`$arrayToObject`) → `{type, orders, qty, stages}`, sắp theo `orders` giảm dần; cùng luật chặng `workshopStageExpr()`.

**URL param thêm:** `wstage` (chặng), `wprio` (`__any__`), `wtype` (loại sản phẩm — rail bản 3). `wheld`/`wcancel`/`werrfile`/`wtool` tái dùng. Trạng thái mở/đóng bảng designer KHÔNG vào URL.

**Không đổi:** `OrderFilterBar` (vẫn dùng ở ErrorLogTab/OrderFactoryTab/OrderStatusTab/Classic), `WORKSHOP_COLS`/`buildColGroups`, `BulkEditToolbar`, chip "Đang lọc" (thêm chip chặng + ưu tiên), i18n namespace `orders` → khối `workshopBoard`.

### 10.3 Filter bar

**Đồng bộ via `<OrderFilterBar>` reusable** (`apps/web/src/components/orders/OrderFilterBar.tsx`). Cùng layout dùng ở 4 bảng order: `OrderTableWorkshop` (reference) · `ErrorLogTab` · `OrderFactoryTab` (Dashboard Tab C) · `OrderStatusTab` (Dashboard Tab B). Component:
- Top row: search input (flex-1) + nút **"Nhiều mã"** (opt-in) + `<DateRangePicker>` + nút Tải lại + slot `topActionsRight` (view switcher / export / ...).
- Middle row (optional slot `middleRow`): active chip bar / factory chip bar.
- Facet grid: 2/3/5 cột responsive, mỗi cell `<SelectFilter>` đã gate qua `usePermission().has(perm)` từ `OrderFilterFacet.perm`. Facet khai `searchable: true` render `<SearchableSelectFilter>` (cùng props, trigger cùng hình dạng, popover có ô tìm kiếm) thay cho native select — hiện chỉ facet `type` của Classic dùng (ORD-2).
- **Nút "Nhiều mã"** (prop `onBulkApply`): chỉ hiện khi caller truyền callback. Mở `BulkProductionIdDialog` (mode=`filter`) — dán danh sách mã mỗi dòng 1 mã (hoặc phẩy/khoảng trắng) → trả mảng mã cho caller set param `productionIds`. `OrderTableWorkshop` wire vào state `bulkIds` (transient, không sync URL), thêm chip "Nhiều mã: N mã" vào thanh "Đang lọc", loại trừ nhau với ô search thường (set cái này clear cái kia). Search input cũng tự nhận đa mã khi dán trực tiếp (xem §7.x `search`) — nút modal chỉ tiện cho danh sách dài nhiều dòng.

Mỗi consumer truyền `facets: OrderFilterFacet[]` để cấu hình field set riêng — tránh ép tất cả tab dùng cùng 1 list:
- `OrderTableWorkshop` — 10 facet workshop chuẩn từ `getWorkshopFilters`.
- `ErrorLogTab` — 5 facet error-log: assignee · fabricType · toolResult · productionError · productionErrorSource. Date range thêm vào endpoint qua field `createdFrom`/`createdTo` mới trong `GetErrorLogZod` (filter `inProductionAt` VN tz, đồng bộ convention với 3 bảng kia).
- `OrderFactoryTab` — 5 facet factory-specific: type · fabricType · machineTypeId · machineNumber · toolResult (lấy từ `overview.availableFilters`). Search debounce 300ms, thêm vào `getOrders` qua `search` param.
- `OrderStatusTab` — không dùng facet grid (BreakdownCard grid bên dưới làm role này với multi-select chip). Chỉ search + date + reload + slot extras ("Lỗi cần xử lý" + active chips + Xóa filter) qua `<StatusFilterTopActions>`/`<StatusActiveChips>` (`apps/web/src/pages/home/status/StatusFilterExtras.tsx`).
- `OrderStatsTab` — không dùng facet grid (stats hiển thị MetricCard + pie chart, không list đơn). Search chính = `searchType` (tên sản phẩm); `searchUser` (SKU/email khách) chèn vào `topActionsRight` vì stats có 2 search term. Cả 2 search debounce 300ms; auto-fetch khi date hoặc debounced search đổi — bỏ nút "Áp dụng" cũ vì pattern đồng bộ.

> Từ bản 2026-09 (§10.2c) `OrderTableWorkshop` KHÔNG render `<OrderFilterBar>` nữa — 10 facet chuyển vào popover "Bộ lọc" của `WorkshopToolbar`, cùng `OrderFilterFacet[]`/`SelectFilter`/`SearchableSelectFilter`; phần dưới đây mô tả hợp đồng facet BE vẫn dùng chung.

**`OrderTableWorkshop` cụ thể** — 10 facet workshop chuẩn từ BE endpoint `GET /v1/orders/workshop-filters` theo **faceted-search pattern**:
- BE method `getWorkshopAvailableFilters(dto, role, assigneeCode?, fulfillmentFactoryId?)` — với mỗi facet, build `buildOrderListFilter` sau khi strip facet đó khỏi dto, rồi `$group` field tương ứng. Count phản ánh subset đã narrow theo các facet khác đang active.
- **Đơn đã hủy (`cancelledAt`) MẶC ĐỊNH bị LOẠI khỏi CẢ list LẪN mọi facet count**: `buildOrderListFilter` set `filter.cancelledAt = { $exists: dto.cancelled === true }` → mặc định (`cancelled` không bật) loại đơn hủy khỏi **mọi caller** (`getOrders`/`getOrdersGroupedByType`/`exportOrders`/`getFulfillmentStatusCounts`/facet). Facet còn spread hằng `excludeCancelled` cho các nhánh count phụ (`toolResultNoteNoneCount`/`unassignedSplit`/`heldCount`). `getErrorLog` vốn đã tự loại cancelled. **Toggle "Đã hủy (N)"** (`data.cancelledCount`, nút `Ban` cạnh "Đang giữ", URL `wcancel`) → set `cancelled=true` → **list + facet CHỈ hiện đơn hủy** (xem riêng) + chip "Trạng thái: Đã hủy". Xem đơn hủy cũng qua dialog "Đơn đã hủy" riêng. DTO `GetProductionOrdersZod.cancelled` (`z.coerce.boolean`).
- **10 facet** support: `fabricType` / `machineNumber` / `printStatus` / `toolResult` / `toolResultNote` / `errorFile` / **`userSku` (Khách hàng — luôn hiện, không perm)** / `assignee` / `productionError` / `designerStatus`. Cell hiển thị phụ thuộc permission `order.field.X.view` (trừ `userSku` không gate). URL param `wusersku`.
- `assignee` facet labels **resolve fullName từ users collection** (BE lookup users theo userIds trong facet rows). Value vẫn = user._id.
- `designerStatus` facet labels VN (Cần làm/Đang làm/Đã xong/Không làm được/Cần làm lại). **Option `unassigned` (Chưa gán) được TÁCH thành 2 token `__unassigned_notool__` ("Chưa gán · không tool", M) + `__unassigned_tool__` ("Chưa gán · có tool", N)** — loại đơn `toolResultNote='ok'`, chia theo `toolResult` "Có tool" (name `^Có`). **M = KPI "Chưa gán không tool" panel Designer** (panel chỉ hiện M; N chỉ ở dropdown). Xem `DesignerTaskWorkflow.md §5.7`.
- Token đặc biệt `__none__` cho assignee + designerStatus filter: trả đơn chưa gán (`assignee in [null,'']`) hoặc chưa có designerStatus (`$exists: false`).
- **`toolResult` facet có option "Chưa xác định"** (`value: '__none__'`) cho đơn chưa soát tool (field missing/null/rỗng) — mirror 100% pattern `toolResultNote`/"Chưa soát": BE tính `toolResultNoneCount` riêng (strip `toolResult` khỏi filter, count theo `$or: [{$exists:false},{null},{''}]`, exclude cancelled) rồi prepend vào mảng `toolResult` trong `getWorkshopAvailableFilters()` (chỉ hiện nếu count > 0). `buildOrderListFilter()` có nhánh `__none__` riêng cho `dto.toolResult` (giống `toolResultNote` — hasNone+real kết hợp qua `$or`). FE **KHÔNG cần đổi gì** — facet `toolResult` trong `OrderTableWorkshop.tsx` đã đọc thẳng `workshopFilters?.toolResult` (không như `assignee`, field này không cần FE-side wrapper vì BE đã trả `__none__` kèm count thật).
- Search productionId / userSku / orderId / type (debounced 300ms).
- `<DateRangePicker>` — 8 preset quick + 2 input custom + popover gói gọn (Phase 7.2).

Filter gửi qua query string `?printStatus=code&fabricType=code&designerStatus=...&...`. Service nhận chuỗi đơn (`$in` vẫn dùng split CSV — single value vẫn parse được).

**URL state persistence** (Phase 7.2): tất cả filter sync ↔ URL params với prefix `w` (workshop) để F5 / share link giữ nguyên state:

| Param | Default (strip URL khi == default) | Mapping |
|-------|------------------------------------|---------|
| `wsearch` | `''` | search |
| `pid` | `''` | tìm CHÍNH XÁC 1 đơn theo `productionId` (khác `wsearch`) — xem chi tiết dưới |
| `wfrom` / `wto` | **today** (always-write, kể cả today) | `createdFrom` / `createdTo` |
| `wprint` | `[]` | CSV `printStatus` codes |
| `wnote` | `[]` | CSV `toolResultNote` codes |
| `wstage` | `''` | `workshopStage` — ô phễu chặng (§10.2c) |
| `wprio` | `''` | `priority=__any__` — pill Ưu tiên (§10.2c) |
| `wtype` | `''` | `type` (append) — rail loại sản phẩm bản 3 (§10.2c) |
| `wassign` | `[]` | CSV `assignee` codes |
| `werror` | `[]` | CSV `productionError` codes (Phase 8) |
| `wpage` | `1` | trang |
| `wsize` | `20` | dòng/trang |

Workshop tab dùng date always-write vào URL (kể cả today) để URL hiển thị explicit ngày đang xem — tránh user share link mà không biết filter ngày nào. Các param khác strip khi rỗng/default.

**`?pid=<productionId>`** — filter RIÊNG, **state thật, persist vào URL** (không tự xóa) để F5/share link giữ nguyên, tách biệt hoàn toàn khỏi `wsearch`/`search` (match "contains" trên 5 field, `buildSearchOr`). Dùng cho link từ nơi khác (thông báo/tool ngoài) cần mở đúng 1 đơn theo `productionId` **chính xác**:
- Gửi xuống BE qua param **`productionIds`** (đã có sẵn — dùng chung với filter "Nhiều mã" ở `BulkEditToolbar`, exact case-insensitive match, xem `order.service.ts` dòng ~1267) thay vì `search` — tránh match nhầm field khác (`userSku`/`userEmail`/`orderId`/`type`) như `search` thường làm. `pid` set → ưu tiên hơn "Nhiều mã" (2 filter dùng chung 1 param BE, không kết hợp được).
- Có `pid` lúc mount (chưa có `wfrom`/`wto` khác) → **bỏ hẳn default `wfrom`/`wto` = today**, set `''` (tìm all-time) — nếu không, đơn không thuộc "hôm nay" sẽ bị lọc mất dù đúng mã.
- **Group product mặc định "Mở hết"** thay vì collapse như thường lệ (`fetchData()` check state `pid` hiện tại, KHÔNG chỉ lúc mount) — thấy ngay đơn cần tìm, không phải tự bấm mở group.
- Chip "Mã đơn" trong thanh filter đang lọc — click X hoặc `clearAllFilters()` để bỏ.

Ví dụ: `/ffm/orders/workshop?pid=GO-63713-02355`.

### 10.4 Bulk edit (`BulkEditToolbar`)

- Cột checkbox đầu mỗi row + select-all header + shift+click range select.
- Khi chọn ít nhất 1 row → toolbar nổi sticky bottom: "Đã chọn N · Bulk update · **Gán design** (Leader/Admin) · Bỏ chọn".
- **"Bulk update" dialog**: chọn field (chỉ field user có `edit` perm, EXCEPT `assignee` — bị BLACKLIST khỏi dropdown vì đã có dialog "Gán design" riêng) + giá trị → `PATCH /v1/orders/bulk-field`. Toast "Đã update X/Y đơn".
- **"Gán design" button** (`AssignDesignerDialog`): chỉ hiện khi `canEditField('assignee')`. Pre-flight `POST /bulk-assign-designer-preview` → dialog hiển thị KPI status + alreadyAssigned + `blockedCount`/`reworkHeldCount`/`okCount`/`noToolCount`/`eligibleCount`/`eligibleWithToolCount` + designer dropdown. **Đơn `toolResultNote='ok'` KHÔNG gán được** (banner đỏ). **Đơn CHƯA soát → banner vàng + 2 nút "Gán tất cả" / "Chỉ gán đơn đã soát"** (`skipUnreviewed`). **Đơn `rework` đang có người ôm → banner + skip** (chỉ gán được đơn rework chưa ai ôm); `in-progress/done` → skip. Conflict đa-người → ghi đè. Submit `POST /bulk-assign-designer { ids, userId, reassignOthers, skipUnreviewed }` → skip + report. Xem `DesignerTaskWorkflow.md §2.2`.

### 10.4b Designer KPI panel (Admin/Manager/Leader)

Trên cùng tab **List Order** + tab **Danh sách đơn** khi user có quyền `page.designer_stats` hoặc `designer.task.assign`:

Render `<DesignerSummaryPanel filterQs={...} onClickCell={...}>`:
- 7 KPI button-card (**Tổng chưa gán** N+M / **Chưa gán không tool** M / Cần làm/Cần làm lại/Đang làm/Đã xong/Không làm được) — click → set filter list (`assignee` / `designerStatus`)
- Bảng matrix per-designer collapsible — click cell → set filter list. Click tên designer → chỉ set `assignee`
- Toggle "Xem theo filter / Xem tổng" swap scoped ↔ overall counts
- Data từ `GET /v1/orders/designer-breakdown` (cùng filter shape với list)

Filter `Designer` SelectFilter có option **"Chưa gán"** (`__none__`); filter `TT Designer` SelectFilter mới với 6 option theo `DesignerStatus` enum.

Xem `DesignerTaskWorkflow.md §2.5` + §4.4.

### 10.5 Hook `usePermission` (`apps/web/src/hooks/usePermission.ts`)

```ts
const { has, canViewField, canEditField, canViewAdminTable, canViewWorkshopTable, isAdmin } = usePermission();
```

Đọc `profile.role.permissionCodes` từ `useAuthStore`. SuperAdmin / Admin role name bypass (legacy fallback).

### 10.6 Performance

| Tối ưu | Vị trí |
|--------|--------|
| Optimistic update qua `patchRow` | Cell `onUpdated` → cập nhật local state, không re-fetch toàn list |
| Thumbnail `s200` | `ImageThumbCell.smallThumb()` |
| Debounce search 300ms | `useDebounce(search, 300)` |
| Service Worker cache ảnh CDN | `apps/web/public/sw.js` |
| BE cache key gắn `role` | Tránh Designer thấy cache của Admin |
| `<PaginationBar position="top|bottom">` | Phân trang ở CẢ trên + dưới table, dùng chung `paginationProps` object — user không phải kéo lên/xuống mỗi lần đổi trang. |
| **Render memo hóa** (tránh re-render cả bảng) | `decoratedGroups`/`selectedCountByType`/`visibleOrderedIds` = `useMemo`; mọi handler (`patchRow`, `openPreview`, `handleCheckboxChange`, `toggleGroupSelection`…) = `useCallback` (dùng functional setState + refs); `renderCtx` = `useMemo`. Combo-count + sort chỉ tính 1 lần theo `[groups]` thay vì mỗi render × 2. |
| **`ProductRow` = `React.memo`** | Mỗi hàng đơn tách thành component memo, props primitive/stable (`isSelected`, `comboN`, `noTool`, `row`, callbacks). Tick checkbox / mở dialog / poll design KHÔNG re-render toàn bảng, chỉ hàng đổi. Bên trong dùng `renderedCells = useMemo(cols.map(c.render), [cols,row,ctx])` → đổi selection (bg sticky) không render lại các cell component. |
| **Virtualization (window scroll)** | `useWindowVirtualizer` (`@tanstack/react-virtual`) trên danh sách phẳng `flatItems` (header + row theo collapse). Cuộn cả trang, chỉ render ~hàng đang thấy + 2 spacer row (padTop/padBottom); `measureElement` đo chiều cao thật (dynamic). `scrollMargin` = offset `<tbody>` đo qua `ResizeObserver(document.body)`. Bảng dùng `table-fixed` + `<colgroup>` width cố định (lấy từ `min-w-[…px]` mỗi cột, `parseColWidth`) để cột không giật khi cuộn. Ảnh đã lazy sẵn (`ImageThumbCell` `loading="lazy"`) → chỉ tải khi cuộn tới. |
| **Poll design ổn định** | `usePendingDesignsPoll`: giữ `rows`/`patchRow` trong ref, effect chỉ depend `[hasPending]` → không tạo lại `setInterval` mỗi lần `items` đổi reference. |

### 10.7 List tab — URL state persistence

`ListOrderTab.tsx` dùng prefix `l` cho param:

| Param | Default | Mapping |
|-------|---------|---------|
| `lsearch` | `''` | search Production ID / Order ID / SKU |
| `lmapped` | `all` | `all` / `mapped` / `unmapped` |
| `lerror` | `false` | toggle "Lỗi xưởng" — gửi `hasError=true` (Phase 8) |
| `lpage` | `1` | trang |
| `lsize` | `20` | dòng/trang |

Pattern sync state ↔ URL giống Dashboard Tab Factory (xem `Dashboard.md §11`).

---

## 11. Factory transfer (Phase 7)

### 11.1 Khái niệm
- `factoryId` = xưởng **hiện tại** (mutable, đổi qua `/transfer`).
- `originalFactoryId` = xưởng **gốc tại import** (immutable). Phân biệt "đơn nhận từ xưởng khác" vs "đơn xuất phát tại đây".

### 11.2 Endpoint

| Method | Path | Body | Hành vi |
|--------|------|------|---------|
| PATCH | `/v1/orders/:id/transfer` | `{ targetFactoryId, reason?: string ≤ 200ch }` | Đổi `factoryId`. Trùng target → `modified: 0`. Ghi `OrderLog action='transfer'`. |
| PATCH | `/v1/orders/bulk-transfer` | `{ ids: ID[], targetFactoryId, reason? }` | Pre-filter ID đã ở target (skip no-op), `updateMany` phần còn lại, `writeMany` log cho mỗi ID. |

Cả 2 đều invalidate `orders:list:*` cache.

Decorator: `@Auth(ORDER_WRITE_ROLES)` — chỉ SuperAdmin / Admin / Manager / Support được dùng.

### 11.3 FE entry points

| Nơi | Component | Mô tả |
|-----|-----------|-------|
| Dashboard Tab C | `OrderFactoryTab.tsx` + `TransferDialog` (cùng file) | Bulk select rows → toolbar "Chuyển xưởng" → dialog chọn xưởng đích + lý do. |
| Audit timeline | `OrderLogTimelineDialog.tsx` | Render entry `action='transfer'` với `before.factoryId → after.factoryId` + `reason`. |

### 11.4 Backfill cho legacy
`OrderService.onModuleInit()` chạy 1 lần khi boot, set `originalFactoryId = factoryId` cho rows không có field. Log số rows được set ra console (`[order-backfill] originalFactoryId set on N legacy rows`).

---

## 12. Daily import summary (Phase 5)

`GET /v1/orders/import-summary?date=YYYY-MM-DD` — bảng tổng hợp `(type, size, fabricType)` của các order có **`orderAt`** trong ngày được chỉ định (gộp theo ngày khách đặt). Tham số `date` vẫn là ngày khách lên đơn.

Response (`ImportSummaryZod`):
```ts
{
  date: string,
  groups: Array<{
    type: string;
    size: string;
    fabricType: string;
    fabricName?: string;      // resolve từ workshop_config
    totalQuantity: number;
    orderCount: number;
    sampleProductionIds: string[]; // 5 cái đầu
  }>
}
```

- Sort `orderCount desc` → tổ hợp trùng nhiều nhất xếp đầu (top 3 highlight amber).
- UI hiển thị progress bar tương đối theo group có count cao nhất → workshop thấy ngay combo nào cần in batch chung.
- Aggregation chính: `$group { type, size, fabricType }` → `$lookup` workshop_config `fabric_type` để có `fabricName`.

---

## 13. Backfill fabric / tool (Phase 7)

`POST /v1/orders/backfill-fabric` — re-derive `fabricType` và `toolResult` từ product config cho đơn còn thiếu.

- **Non-destructive**: chỉ điền chỗ trống (`$type: 'missing'` / `null` / `''`). Đã chỉnh tay → giữ nguyên.
- Pipeline `$lookup productConfigs → $set` 2 field conditional.
- Trả `{ scanned, updated }` để UI log số đơn được fix.
- Gọi từ `/products` sau khi admin cập nhật fabric/tool default trong product config.

---

## 14. Tab `Nhật ký bù lỗi` (`ErrorLogTab.tsx`)

> **File FE:** `apps/web/src/pages/orders/ErrorLogTab.tsx`
> **Endpoint:** `GET /v1/orders/error-log`
> **Service BE:** `order.service.ts → getErrorLog(dto, role, userId?, factoryId?, fulfillmentStage?)` + helper `applyErrorLogViewFilter(filter, tab, role, stage, factoryId, assigneeUserId)`

### 14.1 Mục đích — theo dõi lỗi ĐÃ VÀO FULFILLMENT (positional)

Bảng theo dõi **đơn từng bị báo lỗi mà ĐÃ vào fulfillment** (in → ép → … → đóng gói), tách theo **góc nhìn CHẶNG của người xem** qua 2 sub-tab. Dùng mô hình vị trí + reflow của [`Plans/UpstreamWatching-ReflowChain.md`](../Plans/UpstreamWatching-ReflowChain.md) — mirror `applyFulfillmentStatusFilter`.

**Điều kiện vào bảng (base filter, mọi role):**
- `productionError ≠ null/''` AND **KHÔNG hủy/xóa** (`cancelledAt`/`deletedAt` không tồn tại).
- **`currentFulfillmentStage` đã set** — CHỈ đơn đã vào fulfillment. Loại đơn còn ở soát-tool / thiết kế trước fulfillment. **Riêng tab `done`**: chấp nhận thêm đơn `currentFulfillmentStage=null` nhưng **`fulfillmentCompletedAt` đã set** (đóng hàng xong reset stage về null — nếu không nới, đơn hoàn tất biến mất khỏi CẢ 2 tab).
- **`productionErrorSource ≠ 'tool-check'`** — **bỏ hẳn lỗi soát-tool** khỏi tab này (Support tạm ẩn tab — xem `§14.3`).
- **KHÔNG** ràng buộc `productionFirstErrorAt` (đơn designer sửa xong vẫn còn lỗi ở các chặng sau, phải hiển thị tiếp).

**2 sub-tab (param `tab`, positional theo chặng viewer `S` index `i` so với vị trí đơn `P`):**
- **`todo` (Cần xử lý)** — chặng `S` còn việc: đơn ĐANG ở `S` (`i==P`, có nút thao tác) HOẶC đơn ở chặng trước mà `S` đã từng làm / là người báo lỗi (`i>P` → "đang chờ quay lại", xám).
- **`done` (Đã xong)** — chặng `S` đã làm lại xong, đơn đã đi qua (`i<P`); **giới hạn 14 ngày** gần nhất (theo `updatedAt`), sort `updatedAt` DESC.

Ví dụ Ép báo lỗi → đẩy về designer: designer/in/ép đều thấy ở `todo`; designer xong → designer sang `done`, in vẫn `todo`; in xong → in sang `done`; ép (reporter) xong → tất cả `done`.

Sort `todo`: `priority` DESC (đơn ưu tiên lên đầu) rồi `inProductionAt` ASC (đơn vào sản xuất lâu nhất trước — khớp thang mức độ khẩn §14.2).

### 14.2 Mức độ khẩn cấp (theo GIỜ)

Tính theo **tuổi đơn kể từ ngày VÀO SẢN XUẤT** (`now - inProductionAt`), **KHÔNG** phải ngày báo lỗi (`productionFirstErrorAt`) — đơn vào sản xuất càng lâu mà còn lỗi thì càng ưu tiên. Cột "Tuổi đơn (từ SX)" hiển thị duration + ngày vào SX, khớp với badge mức độ. `inProductionAt` rỗng → xếp mức "Mới" (cả FE `urgencyOf` lẫn BE `$switch` do null < số).

| Mức độ | Ngưỡng (từ `inProductionAt`) | Màu | Mô tả |
|--------|--------|-----|-------|
| **Mới** | < 2h | Sky | Vừa vào SX |
| **Cần làm** | 2h – 4h | Amber | Cần ưu tiên |
| **Gấp** | 4h – 6h | Orange | Sắp critical |
| **Khẩn cấp** | > 6h | Rose (animate-pulse) | Quá 6 giờ — flash đỏ |

Header tab có 4 chip filter mức độ + count. Click chip để toggle filter; chỉ 1 mức độ active tại 1 lúc.

**BE (`getErrorLog`):** badge counts (`byUrgency` aggregation) + filter chip đều tính trên `inProductionAt` (aggregation `$subtract: [now, '$inProductionAt']`; filter đẩy range vào clause `$and/$or` riêng theo `inProductionAt`, KHÔNG merge vào `filter.inProductionAt` của date-range để tránh đè). `countFilter` snapshot **trước** khi thêm clause urgency → badge luôn hiện đủ 4 mức. **Sort danh sách: `priority` DESC → `inProductionAt` ASC** (đơn ưu tiên trước, rồi đơn vào SX lâu nhất lên đầu — cùng trục thời gian với thang mức độ).

### 14.3 Góc nhìn chặng + phạm vi + thao tác (theo role)

`applyErrorLogViewFilter` suy "chặng của viewer" từ role → dựng clause positional `todo`/`done`:

| Role | Chặng viewer | Phạm vi xưởng | Có nút thao tác khi |
|------|------|------|------|
| **Fulfillment** | `user.fulfillmentStage` (in→đóng) | **chỉ xưởng mình** (`factoryId`/`originalFactoryId`) | `currentFulfillmentStage === myStage` & cùng xưởng → Bắt đầu/Hoàn thành/Báo lỗi (`fulfillment.transition` + `ReworkBackDialog`) |
| **Support** | — (**tab tạm ẩn**) | — | Lỗi soát-tool không còn hiển thị ở tab này. BE trả rỗng (`_id: '__support_hidden__'`); FE ẩn tab + sidebar entry (`orders/index.tsx errorLogVisible`, `Sidebar.tsx hideForRoles:['Support']`). |
| **Designer / DesignerLeader** | designer (đơn bị đẩy lỗi NGƯỢC từ fulfillment về) | **chỉ task của mình** (`assignee = user._id`) | `todo` = `designerStatus ∈ {rework, in-progress}` → Bắt đầu/Hoàn thành (`designer.transition`); `done` = `designerStatus=done` & timeline có `reworkTarget:'designer'` (đã sửa xong, đẩy lại vào fulfillment) |
| **Admin / Manager / SuperAdmin** | **chặng BÁO LỖI của từng đơn** (entry `rework-back` CUỐI trong `fulfillmentTimeline`, field `stage` = người báo) | mọi xưởng | thấy MỌI đơn lỗi fulfillment, positional theo chặng báo lỗi (`$expr` so index): `todo` = chặng báo lỗi CHƯA làm lại xong — vị trí hiện tại của đơn ≤ chặng báo lỗi (đang làm lại ở designer = trước mọi chặng; đơn không có entry rework-back → fallback `fulfillmentCompletedAt` chưa set); `done` = đã đi QUA lại chặng báo lỗi / đã đóng hàng xong / đã resolve tay. Nút **"Đánh dấu xong"** (`POST /orders/:id/resolve-error` → `resolveError`) set `errorResolvedAt` → đơn rời "Cần xử lý" (mọi role), hiện ở "Đã xong" của Admin 14 ngày. Đảo tự động khi báo lỗi mới (`setProductionError` clear `errorResolvedAt`). **Bulk:** tab "Cần xử lý" của Admin có cột **checkbox** (+ chọn-tất-cả header) + thanh nổi **"Đánh dấu xong (N)"** → `POST /orders/bulk-resolve-error`. |

FE: đơn KHÔNG thuộc chặng viewer → hàng **xám** (`opacity-50`) + cell read-only + không nút. Với Fulfillment/Admin visibility KHÔNG lọc theo assignee (thấy hết đơn trong chặng/scope mình) — chỉ nút thao tác mới gate. Riêng **Designer** visibility LỌC theo `assignee = mình` (chỉ task được đẩy về cho mình).

### 14.4 Filters

| Filter | Field | Source |
|--------|-------|--------|
| Search | `productionId / userSku / userEmail / orderId / type` | text |
| Người thực hiện | `assignee` (CSV user._id, token `__none__` = chưa gán) | `designerTeamStore` |
| Loại vải | `fabricType` (CSV code) | `workshopConfigStore.fabric_type` |
| Kết quả Tool | `toolResult` (CSV code) | `workshopConfigStore.tool_result` |
| Mã lỗi | `productionError` (CSV code) | `workshopConfigStore.production_error` |
| Nguồn lỗi | `productionErrorSource` (CSV `designer\|factory`) | static |
| Mức độ | `urgency` (CSV `new\|attention\|urgent\|critical`) | chip filter (chỉ tab `todo`) |

Mỗi filter đổi → reset về page 1. URL state persist với prefix `e*` (`etab`, `esearch`, `eassign`, `efabric`, `etool`, `ecode`, `esource`, `eurg`, `epage`, `esize`).

### 14.5 Bảng

Cột (reuse từ `WORKSHOP_COLS` của `workshopTableConfig.tsx` nhưng filter chỉ các key liên quan):

| Cột | Cell |
|-----|------|
| Mức độ | `PriorityBadge` (nhãn ưu tiên read-only dùng chung kanban/ToolCheckTab, ẩn khi đơn không có `priority`) xếp trên badge `new/attention/urgent/critical` |
| Tuổi đơn | Duration text `Nd Mh` + ngày vào SX |
| Xưởng | `factory.shortName` |
| Production ID | `WORKSHOP_COLS.productionId` cell (copy + tooltip). **Click mã → mở `OrderDetailDialog`** (fetch qua `getByProductionId`, hiện info + link mockup/design + preview file cutting) — wire qua `renderCtx.openDetail` |
| Sản phẩm | `WORKSHOP_COLS.mockupTypeSize` cell (thumb + type + size) |
| Design | `WORKSHOP_COLS.designs` |
| Lỗi xưởng | `WORKSHOP_COLS.productionError` (ProductionErrorSelectCell) |
| Nguồn | `WORKSHOP_COLS.productionErrorSource` (ErrorSourceCell) |
| **Chặng hiện tại** | Badge chặng đơn đang đứng (suy positional: tool-check marker → designer rework → `currentFulfillmentStage` → designer assigned/in-progress) |
| **Nêu lỗi** | Chặng reporter + người báo (từ `fulfillmentTimeline` entry `rework-back` gần nhất) |
| **Ghi chú lỗi** | Note người báo nhập — `errorNote(row)`: ưu tiên `reason` của rework-back gần nhất, fallback `productionErrorNote`. Clamp 2 dòng + `title` full text |
| **Người sửa** | designer `assignee` (nếu ở designer) / `byUserName` timeline của chặng hiện tại / "Support" |
| Số lần | Badge `×N` (= `productionErrorCount`) |
| (action) | Nút thao tác theo chặng (§14.3) + History → `OrderLogTimelineDialog` + `OrderRowActionsMenu` |

Hàng thuộc chặng viewer → cho inline edit + nút thao tác; hàng khác → xám + read-only (`canEditField: () => false`).

### 14.6 Response shape

```ts
GET /v1/orders/error-log?... → {
  success: true,
  data: ProductionOrder[],       // page items, sort productionFirstErrorAt ASC
  total: number,                 // tổng đơn match filter (cho pagination)
  byUrgency: {                   // count theo mức độ, scope = filter HIỆN TẠI trừ chip urgency
    new: number,
    attention: number,
    urgent: number,
    critical: number,
  }
}
```

`byUrgency` tính qua `$switch` trong aggregation BE (xem `getErrorLog`). Sticky filter — `byUrgency` không bị thu hẹp bởi chip urgency hiện tại, để user nhìn thấy đủ 4 mức độ và biết click chip nào.

### 14.7 Backfill cho legacy

`OrderService.onModuleInit()` có thêm 1 step idempotent:
```ts
updateMany(
  {
    productionError: { $exists: true, $nin: [null, ''] },
    productionFirstErrorAt: { $in: [null, undefined] },
    $or: [{ toolResultNote: { $ne: 'ok' } }, { toolResultNote: { $exists: false } }],
  },
  [{ $set: { productionFirstErrorAt: '$updatedAt' } }],
)
```

→ Đơn legacy đang lỗi nhưng chưa có `productionFirstErrorAt` được set = `updatedAt` (best-effort). Đơn lỗi tương lai dùng `now` chính xác từ hook.

### 14.8 Permissions

| Action | Role |
|--------|------|
| Vào tab | mọi role trong `ORDER_VIEW_ROLES` (Admin/Manager/Support/DesignerLeader/Designer/Fulfillment) |
| Edit cell | theo `FIELD_EDIT_ROLES` từng field (xem `§8.2`) |
| Filter factory | không expose — Admin/Manager xem all, role khác bị visibility filter scope |



---

## 15. Cutting File Mapping (post-import)

> **Flow độc lập** với import đơn. Đơn ban đầu KHÔNG có `cuttingFileUrl` — flow này map link Drive vào đơn dựa trên `productionId` parse từ filename. Pattern filename: `XX-XXXXX-XXXXX-*.pdf` — `XX` = 2 chữ cái A-Z (không cố định, vd `BH`, `ML`, `TN`...), tiếp theo 5 số + 5 số.

### 15.1 Files

**FE:**
- `apps/web/src/pages/orders/ImportCuttingFilesTab.tsx` — tab UI (paste / xlsx col A → preview → apply)
- `apps/web/src/components/orders/OrderDetailDialog.tsx` — modal hiện preview file (iframe Drive embed `/file/d/{id}/preview`)
- `apps/web/src/services/order.ts` → `previewCuttingFiles()` + `applyCuttingFiles()`

**BE:**
- `apps/api/src/modules/order/drive-file-name.service.ts` — fetch tên file từ Drive public preview page (retry x2, backoff 500ms, concurrency cap 5)
- `apps/api/src/modules/order/order.service.ts` → `previewCuttingFiles()` + `applyCuttingFiles()`
- `apps/api/src/modules/order/order.controller.ts` → 2 endpoint mới
- `apps/api/src/modules/order/order.entity.ts` — field `cuttingFileUrl` + `cuttingFileName`

**Shared:**
- `packages/shared/dtos/production-order.dto.ts` → `PreviewCuttingFilesDto/Res`, `ApplyCuttingFilesDto/Res`, util `parseProductionIdFromCuttingFilename()`

### 15.2 Luồng

1. **User paste / upload xlsx** list Drive link (1 link/dòng; xlsx lấy cột A, không header).
2. FE call `POST /v1/orders/cutting-files/preview`.
3. BE với mỗi link:
   - Extract Drive fileId (regex `/file/d/{id}/` hoặc `?id={id}`).
   - Fetch `https://drive.google.com/file/d/{id}/view` (public — no auth).
   - Parse filename từ HTML (`og:title` → `<title>` → JSON fallback).
   - Retry x2 với backoff 500ms cho mọi error.
   - Parse productionId từ filename: regex `^([A-Z]{2}-\d{5}-\d{5})/i`.
   - Lookup đơn theo productionId (`$in`).
4. BE trả response 4 bucket:
   - `matched`: link OK + tìm thấy đơn (kèm `existingCuttingFileUrl` nếu đã có file cũ).
   - `notFound`: link OK nhưng không có đơn với productionId đó.
   - `invalid`: URL không hợp lệ / fetch fail / parse fail / không match pattern (2 chữ cái + 5 số + 5 số).
   - `conflicts`: cùng productionId xuất hiện > 1 link — user phải xoá bớt trước khi apply.
5. UI hiện summary cards + breakdown by `factory` + `machineType` + 4 collapsible section.
6. User tick **"Ghi đè file cũ"** (default OFF) → cho phép overwrite các đơn đã có cuttingFileUrl cũ.
7. User bấm **Mapping** → FE call `POST /v1/orders/cutting-files/apply` với mảng `mappings` (đã filter theo overwrite ở FE).
8. BE bulk write + ghi `OrderLog` event `production-file-mapped` (`action='bulk_update'`, `field='cuttingFileUrl'`, `after.event='production-file-mapped'`).

### 15.3 Drive name fetch chi tiết

```
extractFileId → fetchOnce (timeout 8s, browser UA) → parseFileName (3 regex fallback)
              → retry (x2, backoff 500ms) → outcome: { fileName } | { error: 'fetch-failed' | 'parse-failed' }
```

**Concurrency:** cap 5 worker song song (xem `previewCuttingFiles` factory). Tránh Drive rate-limit khi user paste 1000+ link.

**Pattern productionId:** parse trong `parseProductionIdFromCuttingFilename` (shared package). 2 chữ cái đầu không cố định — bất kỳ `[A-Z]{2}`:
```ts
/^([A-Z]{2}-\d{5}-\d{5})/i
// BH-96341-30608-M-BR-KL.pdf → "BH-96341-30608"
// ML-12345-67890-foo.pdf    → "ML-12345-67890"
```

### 15.4 OrderDetailDialog

- Trigger: click productionId trong Workshop table cell (`workshopTableConfig.tsx` đã wire `ctx.openDetail`).
- Layout: Info chung + Workshop status + Cutting file preview (iframe `https://drive.google.com/file/d/{id}/preview`).
- Khi đơn chưa có cuttingFile → hiện hint "Vào tab Import File Cutting để map".
- Icon ✂ xanh emerald cạnh productionId báo đơn đã có cuttingFile (workshop table cell).

### 15.5 Permissions

| Endpoint | Roles |
|---|---|
| `POST /v1/orders/cutting-files/preview` | SuperAdmin, Admin, Manager, Support |
| `POST /v1/orders/cutting-files/apply` | SuperAdmin, Admin, Manager, Support |

Tab `Import File Cutting` hiển thị khi `permission('order.import')` — đồng bộ với tab Import Order.

### 15.6 Performance notes

- Drive fetch ~ 200ms-1s/link (single attempt). 100 link với concurrency 5 ≈ ~10-20s.
- Worst-case retry: 3 attempt × 8s timeout = 24s/link → batch lớn (>500 link) nên chia nhỏ.
- Bulk apply: 1 `bulkWrite` Mongo + 1 `OrderLog.writeMany` — O(N) database write.
- `cuttingFileUrl` index không cần (chỉ dùng cho display + iframe embed, không query).

---

## 16. Hủy đơn + Đổi design (Admin) — menu "..." mỗi hàng

> **File FE:** `apps/web/src/components/orders/{OrderRowActionsMenu,CancelOrderDialog,EditOrderDesignDialog}.tsx`, `apps/web/src/utils/orderActions.ts`
> **File BE:** `order.service.ts` → `canCancelOrder()` + `cancelOrder()` + `updateOrderDesign()`; `order.controller.ts` → `POST /:id/cancel` + `PATCH /:id/design`
> **API:** `POST /v1/orders/:id/cancel` · `PATCH /v1/orders/:id/design`

### 16.1 Overview
Mỗi hàng đơn (ở MỌI bảng order) có nút **"..."** (`MoreHorizontal`) ở **cột thao tác pin cố định bên phải** (§16.4) — **CHỈ Admin** (`OrderRowActionsMenu` tự `usePermission().isAdmin` → non-admin render null). 2 action, mỗi cái mở dialog:
- **Đổi design** (`EditOrderDesignDialog`) — đổi URL mockup + **các vị trí design đơn ĐANG CÓ**. Lưu **raw URL** (không qua R2); URL cũ giữ trong OrderLog.
- **Hủy đơn** (`CancelOrderDialog`) — soft cancel + lý do (bắt buộc ≤200).

Menu này về sau còn nhận thêm mục cho vai khác: **Giữ đơn / Mở giữ / Kiểm tra design mới** cho `ORDER_WRITE_ROLES` (§9b, §9c) và **"Chuyển hoàn thành"** cho riêng SuperAdmin (**§23**).

**Đơn đã hủy:** vẫn hiện trong mọi bảng với component chung **`CancelledBadge`** = badge "Đã hủy" (đỏ) **+ hiện luôn LÝ DO hủy** (note, truncate + full tooltip) + **row mờ** (`opacity-60`); **KHÔNG loại khỏi thống kê/filter** (đếm bình thường). Cả 2 action **disable** khi đơn đã hủy (read-only).

**Đơn đã hủy = KHÓA CHỈNH SỬA (2026-09-05):** `updateField` gọi `assertNotCancelled(before)` và `bulkUpdateField` thêm `cancelledAt: { $exists: false }` vào `matchFilter` — mirror guard sẵn có ở `setProductionError` / `forceCompleteOrder` / `FulfillmentTaskService.transition`. Trước đó sửa ô inline trên đơn đã hủy vẫn chạy hook entry: đặt "Note kq Tool" = `ok` là đơn ĐÃ HỦY được đẩy trở lại sản xuất (`readyForFulfill=true`, `fulfillmentStages.print` = `waiting` với mốc mới tinh).

**Optimistic update:** cancel/đổi design trả về order đã cập nhật → `OrderTableWorkshop` **patch tại chỗ** (`patchRow`, KHÔNG refetch) → **giữ nguyên group sản phẩm đang mở** + cập nhật tức thì. Bảng phẳng khác refetch (không có group).

**Lịch sử (`OrderLogTimelineDialog`):** `update_design` render **từng vị trí URL cũ→mới**; `cancel` hiện **lý do hủy**.

### 16.2 Điều kiện HỦY (`canCancelOrder`)
```
ok = !cancelledAt
```
- **Admin hủy đơn ở BẤT KỲ trạng thái nào** (đã in / ép / QC / may / đóng / rework…) — theo yêu cầu vận hành. Chỉ **chặn** đơn ĐÃ hủy sẵn (không hủy 2 lần).
- Trước đây gate chặt (chỉ cho hủy khi chưa vào pipeline In hoặc In=`waiting`); đã gỡ theo yêu cầu — Admin toàn quyền hủy (action vốn Admin-only).
- **Lưu ý side-effect:** hủy đơn ĐANG ở stage giữa (Ép/QC/May…) → đơn vẫn nằm trong queue kanban của worker stage đó (my-tasks KHÔNG filter `cancelledAt` để khớp Factory Tab) nhưng **không thao tác được** (transition throw ở `FulfillmentTaskService` khi `cancelledAt`). Worker thấy card "kẹt". Nếu muốn ẩn hẳn khỏi queue worker cần thêm filter `cancelledAt: null` vào `applyTabFilter` (chưa làm — đụng invariant Factory-Tab parity).
- **1 nguồn sự thật:** helper `OrderService.canCancelOrder` (BE) ↔ mirror `apps/web/src/utils/orderActions.ts` (`canCancelOrder` — dùng disable + tooltip). Sửa 1 nơi phải sửa cả 2.

### 16.3 Backend
- `POST /:id/cancel` + `PATCH /:id/design`: `@Auth([SuperAdmin, Admin])` **VÀ** service check lại `assertOrderAdmin(roleName)` (chặn cả Manager) — enforce 2 lớp.
- `cancelOrder`: guard `canCancelOrder` → `BadRequestException(reason)` nếu fail → `$set cancelledAt+cancelReason` → OrderLog `action='cancel'` (before=null, after=reason).
- `updateOrderDesign`: set `mockupUrl`+`mockupOriginalUrl` (nếu gửi) + từng `designs.<k>`+`designsOriginal.<k>` (raw). OrderLog `action='update_design'` before/after = snapshot URL cũ→mới.
- OrderLog enum thêm 2 action: `cancel`, `update_design` (`ORDER_LOG_ACTIONS`) — render nhãn+màu trong `OrderLogTimelineDialog`.
- `ProductionOrderZod` thêm `cancelledAt`/`cancelReason` (FE hiện badge).

### 16.4 Gắn vào bảng
`OrderRowActionsMenu` + badge "Đã hủy" gắn ở: `OrderTableWorkshop`, `OrderFactoryTab` (Tab C), `ErrorLogTab`, `OrdersMiniTable` (Tab B), `PrintOrderTable` (qua `PrintWorkshopView.renderRowAction`), `ListOrderTab`. `onChanged` → refetch bảng tương ứng.

**Cột thao tác PIN CỐ ĐỊNH BÊN PHẢI** (`sticky right-0` + shadow trái) ở **mọi bảng** chứa `OrderRowActionsMenu` — luôn thấy nút "..." + Lịch sử khi cuộn ngang:
- `OrderTableWorkshop` + `PrintOrderTable`: cột action là cột cuối (`sticky right-0`), checkbox + productionId vẫn sticky-left (`left-0`/`left-8`).
- `ListOrderTab` / `ErrorLogTab` / `OrderFactoryTab` / `OrdersMiniTable`: cột action cuối bảng thêm `sticky right-0 z-10 bg-card shadow-[-1px_0_0_0_var(--border)]` (trước đây cột action bình thường, không dính); header thêm `<TableHead sticky right-0>` tương ứng.

### 16.5 Permissions
Dùng **role gate `isAdmin`** (SuperAdmin/Admin) cả FE lẫn BE — KHÔNG thêm permission-catalog. Cancel là **soft** (`cancelledAt`), khác `deleteOrder` (`deletedAt`).

### 16.6 "In tem nhỏ" — tem 60×40mm dán sản phẩm

> **File FE:** `apps/web/src/components/orders/BarcodeLabelPrint.tsx` với `size="60x40"` (mục menu từng dòng ở `OrderRowActionsMenu.tsx`, nút in hàng loạt ở `BulkEditToolbar.tsx`), i18n `orders.json` → `rowActionsMenu.printSmallLabel`/`noLabel` + `bulkEdit.printLabel*`/`noLabel`/`labelPartial`/`labelTooMany`

**Đổi 16/09/2026 (chốt từ CEO):** tem nhỏ dùng **đúng bố cục tem hệ cũ** (heading `userSku / orderId(i/n)` · ngày vào sản xuất · Code128 `N-<productionId>` · SKU + biến thể — xem §16.7 cho bố cục đầy đủ), khổ **60×40mm ngang**, thay cho tem QR 40×60mm trước đây. Hai nút in giờ dùng CHUNG một component và CHUNG một endpoint `POST /orders/barcode-labels`, chỉ khác prop `size`:

| Nút | Khổ | Dán ở đâu |
|---|---|---|
| "In tem nhỏ" | 60×40mm | sản phẩm |
| "In tem túi PE" (§16.7) | 75×50mm | túi PE |

**Bề rộng module Code128 theo khổ** — mã `N-XX-#####-#####` cố định 16 ký tự → ~211 module, cộng quiet zone tối thiểu 10 module mỗi bên: điều kiện là `231 × module ≤ lòng tem`. Khổ 75×50 (lòng 69mm) dùng `width={1}` = 0,265mm; khổ 60×40 (lòng 56mm) KHÔNG lọt ở 1px (cần 61mm) nên hạ còn `0.9` = 0,238mm → mã 50,3mm + quiet zone ~2,9mm mỗi bên; máy in decal 203dpi làm tròn lên 2 dot = 0,25mm nên vẫn đọc chắc. **Không hạ dưới ~0,19mm** — đó là ngưỡng máy quét bắt đầu trượt mã.

**Tem QR cũ:** `CustomerLabelPrint.tsx` được GIỮ trong repo nhưng hiện **không có nơi gọi** — bật lại bằng một dòng nếu quay lại tem QR. Trang tra cứu công khai `/track/:productionId` không bị ảnh hưởng (xem [`PublicOrderTracking.md`](PublicOrderTracking.md)), chỉ là mã không còn được in dưới dạng QR lên tem.

<details>
<summary>Bố cục tem QR 40×60mm cũ (không còn in — giữ để tham chiếu)</summary>

Mục **"In nhãn khách"** (`Printer`) nằm ĐẦU menu "...", nên có mặt ở mọi bảng liệt kê ở §16.4 — trong đó có bảng công đoạn **In** của Task Fulfillment (`PrintOrderTable` qua `PrintWorkshopView`), nơi xưởng thực sự cần tem. Bấm là in thẳng, không có bước xem trước: hộp thoại in của trình duyệt đã là bước xác nhận.

Nội dung tem, khổ **40×60mm dọc** (4×6cm — tem decal rời, KHÔNG phải 4×6 inch):

| Phần | Nguồn |
|---|---|
| QR | `${window.location.origin}${PATHS.TRACK}/<productionId>` → trang tra cứu công khai `/track/:productionId` (không cần đăng nhập — xem [`PublicOrderTracking.md`](PublicOrderTracking.md)) |
| Mã sản xuất | `productionId` — luôn có |
| Mã đơn | `orderId`, nhãn "Mã đơn", 6pt — **ẩn khi trùng `externalId`** (xem dưới) |
| Mã sàn | `externalId`, nhãn "Mã sàn", 6pt — cùng thứ tự với cột Production ID ở danh sách đơn (mã đơn trước, mã sàn dưới) |
| Vận đơn | `tracking.number` (vận đơn KHÁCH TỰ CẤP, [`VnpShipping.md §2c`](VnpShipping.md)) — **khối 2 dòng nổi bật**: nhãn 5pt ở trên (**tên hãng** `tracking.carrier` khi có, không có thì "Vận đơn") + dãy số **7.5pt mono đậm** ở dưới |
| Tên sản phẩm | `productConfig.fullName` → fallback `type` (đơn chưa map xưởng không có `productConfig`) |
| Biến thể | `size · color` |
| Vị trí in | các key trong `designs` CÓ file, nhãn + thứ tự lấy từ `DESIGN_KEY_ORDER`/`buildDesignLabels` (`cells/DesignThumbsCell.tsx` — đã export để tem dùng chung, KHÔNG chép danh sách thứ hai). Key lạ vẫn liệt kê ở cuối bằng chính tên key: mất nhãn tiếng Việt còn hơn tem giấu mất một vị trí phải in |

**Trùng mã đơn ↔ mã sàn thì chỉ in "Mã sàn".** Nhiều nguồn đơn nhét CÙNG một giá trị vào cả hai cột; in hai dòng y hệt nhau là tốn 3.09mm lòng tem để nói đúng một thứ. Giữ lại "Mã sàn" vì đó là mã **người mua cuối** tra được ở sàn. So sánh trim + không phân biệt hoa thường, **CỐ Ý không gọt tiền tố kiểu `#`**: hai mã khác nhau thật mà bị coi là một thì tem mất hẳn một mã — tệ hơn nhiều so với in thừa một dòng.

**In CẢ HAI mã phụ (khi khác nhau), mỗi mã tự biến mất khi rỗng.** `externalId` chỉ có ở đơn nhập từ sheet có cột "External ID" — đo trên dữ liệu thật 2026-08-24, công đoạn **In** có 2/144 đơn mang `externalId` còn 143/144 mang `orderId`; các công đoạn sau thì `externalId` phủ 40–85%. In mỗi một mã là phần lớn tem ra dòng trống. Chiều ngược lại cũng có: đơn khách tự lên qua Customer Portal chưa có `orderId`. Mã bị cắt cụt trên tem là mã sai nên dùng `break-all` (xuống dòng) chứ KHÔNG `truncate`.

Mục này **KHÔNG bị khoá** theo `cancelledAt`/`heldAt` như các mục còn lại: in tem là thao tác chỉ đọc, và kiện hàng của đơn đang giữ vẫn cần tem để tìm lại.

**Ngân sách chiều cao — kiểm lại mỗi khi thêm dòng.** Lòng tem chỉ có 36×56mm (40×60 trừ 2mm padding mỗi bên) và mọi thứ đều `overflow-hidden`, nên một dòng thừa không báo lỗi mà lặng lẽ **cắt cụt dòng cuối**. Đo ở ca xấu nhất — tên sản phẩm, biến thể, vị trí in đều tràn 2 dòng:

| Phần | Cao |
|---|---:|
| QR 72px | **19.05mm** |
| Dòng "Quét để theo dõi đơn hàng" 5pt + lề 0.6mm | 2.80mm |
| Gạch ngang + lề trên dưới 0.9mm | 2.20mm |
| `productionId` 11pt | 3.88mm |
| Mã đơn 6pt · Mã sàn 6pt | 2.65 + 2.65mm |
| Tên sản phẩm 8pt ×2 dòng + lề 0.8mm | 7.86mm |
| Biến thể 8pt ×2 dòng | 7.06mm |
| Vị trí in 7pt ×2 dòng + lề 0.5mm | 6.67mm |
| **Tổng** | **54.81 / 56mm** |

**Thứ tự ưu tiên chữ trên tem** (bản 2026-08-26): `productionId` 11pt đậm → **vận đơn 7.5pt đậm** → tên sản phẩm / biến thể 8pt → vị trí in 7pt → **mã đơn / mã sàn 6pt**. Hai mã phụ là mã tra cứu nội bộ giữa mình với người bán; thứ người cầm kiện hàng cần đọc nhanh là **mã vận đơn**, nên nó được tách hẳn thành khối 2 dòng (nhãn nhỏ trên, số to đậm dưới) thay vì nhét chung một dòng "nhãn — mã" như hai mã kia. Hạ hai mã phụ 7→6pt cũng chính là chỗ trả lại chiều cao cho khối đó.

**7.5pt là TRẦN VẬT LÝ của dãy số vận đơn, không phải lựa chọn thẩm mỹ.** Mã USPS 22 chữ số ở font mono (~0.6em/ký tự) chiếm 22 × 0.6 × 7.5pt = **34.9mm**, `tracking-tighter` kéo về ~32mm — vẫn trong 36mm lòng tem. To hơn là xuống dòng, mà xuống dòng ăn thêm 3.3mm không có trong ngân sách. Muốn số to hơn nữa thì phải **bỏ bớt dòng khác trước**, không nới cỡ chữ ở đây được.

**Khối vận đơn lấy chỗ ở đâu.** Khối 2 dòng cao 5.57mm (nhãn 5pt + số 7.5pt + lề 0.5mm), ngân sách không có sẵn chỗ đó. Nó lấy ở **dòng thứ hai của "Biến thể" và "Vị trí in"** — tem CÓ vận đơn thì hai mục này tự rút xuống `line-clamp-1`, tem không có thì giữ nguyên 2 dòng. Chọn cắt ở đó vì trên tem dán kiện gửi khách thì đó là hai thứ ít quan trọng nhất, và `line-clamp` để lại dấu `…` báo là đã cắt — khác hẳn kiểu `overflow-hidden` cắt cụt lặng lẽ mà cả mục này đang phòng. Đo lại đủ 4 tổ hợp:

| Tổ hợp | Dòng mã | Vận đơn | Biến thể / Vị trí in | Tổng |
|---|---|---|---|---:|
| 2 mã khác nhau, không vận đơn *(ca xấu nhất)* | 5.29mm | — | ×2 dòng | **54.81mm** |
| 2 mã khác nhau + vận đơn | 5.29mm | 5.57mm | ×1 dòng | 53.77mm |
| Trùng mã (1 dòng) + vận đơn | 2.65mm | 5.57mm | ×1 dòng | 51.13mm |
| Trùng mã, không vận đơn | 2.65mm | — | ×2 dòng | 52.17mm |

⇒ trần là **54.81mm**, dư **1.19mm** — rộng hơn bản trước (55.69mm) nhờ hạ hai mã phụ xuống 6pt. Rủi ro còn lại: vận đơn dài bất thường + tên hãng dài có thể xuống 2 dòng (`break-all` — mã cắt cụt là mã sai) → ăn nốt phần dư rồi cắt dòng "Vị trí in"; chấp nhận được, đúng thứ tự ưu tiên đã chọn.

**Cỡ QR là biến điều chỉnh duy nhất** — mỗi lần phóng to chữ hoặc thêm dòng đều phải trừ lại ở đó. Bản 2026-08-25 phóng chữ lên (mã sản xuất 9→11pt, tên sản phẩm + biến thể 7→8pt, vị trí in 6→7pt) nên QR phải rút 84→72px: ~48 ký tự / ECC M ra 33 module, tức **0.58mm/module** (trước là 0.67mm) — vẫn trên ngưỡng ~0.5mm mà camera điện thoại đọc được, nhưng **đã hết chỗ để nhỏ thêm**; muốn phóng chữ nữa thì phải bỏ bớt dòng chứ không rút QR được nữa. Bản 2026-08-26 (thêm khối vận đơn) KHÔNG đụng QR: chỗ cho khối đó lấy từ hai mã phụ hạ về 6pt + `line-clamp` thu hẹp, đúng cái luật vừa nói.

**Dòng dài nhất tem** giờ là dãy số vận đơn (~32mm ở 7.5pt, đo ở trên). Dòng "Mã sàn" (nhãn + 18 chữ số) ở 6pt rộng 30.3mm — hết sát mép như hồi 7pt (35.4mm/36mm), nhưng mọi thay đổi nhãn/cỡ chữ hai dòng này vẫn phải đo lại.

**In hàng loạt.** Nút **"In nhãn khách"** (`Printer`) trên thanh bulk (`BulkEditToolbar`, cạnh "Xuất Excel") in tem cho **mọi đơn đang tick chọn** — có mặt ở cả 3 bảng dùng thanh này: Danh sách đơn workshop (`OrderTableWorkshop`), Danh sách đơn classic (`OrderTableClassic`), bảng công đoạn In (`PrintOrderTable`). Cùng một `CustomerLabelPrint`, chỉ khác prop `orders` nhận N phần tử thay vì 1 → N con tem trong **1 lệnh in**, thứ tự tem = thứ tự đơn trên bảng. KHÔNG gate permission, giống mục menu từng dòng.

Ba điểm dễ làm sai nếu viết lại:

- **Dữ liệu tem lấy từ SERVER theo `ids`** (`GET /orders?ids=…&limit=<số đơn>`), KHÔNG lấy từ row đang hiển thị. Tick chọn sống xuyên trang — "Chọn tất cả N đơn khớp bộ lọc" ở Danh sách đơn classic nhét `_id` của mọi trang vào `selected` (§Classic) — nên phần lớn đơn được chọn không có mặt trong `items` của bảng; in theo row là **lặng lẽ thiếu tem**.
- **Phải truyền `includeExcludedFactory=true`.** Đơn xưởng US bị loại mặc định khỏi `buildVisibilityFilter` (§21) mà kiện hàng của nó vẫn cần tem — thiếu cờ này thì tem biến mất không một lời báo. Đơn **đã hủy** thì ngược lại: `cancelledAt` là bộ lọc loại-trừ-hoặc-chỉ-lấy nên không kéo về chung lô được, và số tem thực in sẽ ít hơn số đơn chọn → so `rows.length` với `selectedIds.length`, lệch thì `toast.warning` (`bulkEdit.labelPartial`) chứ không im lặng.
- **Trần `MAX_LABELS_PER_PRINT = 500`.** Toàn bộ N tem nằm trong DOM cho tới khi đóng hộp thoại in; vượt ngưỡng thì trình duyệt treo hẳn — tệ hơn nhiều so với báo người dùng chia nhỏ lô. Trần này CẦN vì "Chọn tất cả N đơn khớp bộ lọc" tick được hàng chục nghìn đơn chỉ bằng 1 cú bấm.

Mỗi tem là 1 trang: `.customer-label-page { break-after: page }` cho MỌI tem trừ `:last-child`. Tem cao đúng 60mm = chiều cao trang nên về lý thuyết tự sang trang, nhưng chỉ cần lệch 1 pixel do làm tròn là cả lô trôi dần và tem thứ N in đè 2 trang. Tem cuối **cố ý không ngắt** — ngắt sau tem cuối là máy đẩy thêm 1 tem trắng, tức 1 con tem hỏng (cùng lý do với `display: none` bên dưới).

**Cách in — CỐ Ý khác sheet barcode ở §Stage Error Catalog.** Nhãn được `createPortal` thẳng ra `document.body` rồi giấu anh chị em cùng cấp bằng `body > *:not(#customer-label-print) { display: none }`. Hai điểm không được đổi thành cách khác:

- **`display: none`, KHÔNG phải `visibility: hidden`.** Trang `stage-errors` dùng `visibility` nên thân trang vẫn giữ nguyên chiều cao và máy in đẩy thêm vài trang trắng — trên giấy A4 thì chấp nhận được, trên tem rời thì mỗi trang trắng là **một con tem hỏng**.
- **Portal ra `body`, KHÔNG để trong cây React.** Bộ chọn `body > *` không với tới phần tử nằm sâu trong `#root`.

`@page { size: 40mm 60mm; margin: 0 }` chỉ tồn tại trong lúc nhãn được mount (state `printingLabel`) nên không đụng các lệnh in khác của ứng dụng. Sau khi in xong, `afterprint` (kèm hẹn giờ dự phòng cho trình duyệt không bắn sự kiện đó) gỡ nhãn xuống. QR render bằng `QRCodeSVG` (`qrcode.react`) — **SVG chứ không phải canvas**, vì canvas hay ra tem trắng ở một số đường in; và `window.print()` được gọi sau 2 khung hình để SVG kịp lên màn.

</details>

### 16.7 "In tem túi PE" — tem 75×50mm quét trạm

Nút **"In tem túi PE"** (`Printer`) trên `BulkEditToolbar` (cạnh "In tem nhỏ") — tick chọn N đơn rồi bấm, **mỗi productionId 1 trang** tem ngang **75×50mm** cho máy quét 1D ở các trạm. Layout dựng theo đúng tem OnosPod cũ mà xưởng đã quen mắt (tem nhỏ §16.6 dùng CÙNG bố cục này, chỉ khác khổ):

```
PRINTERVAL / GM-02336-03868(1/1)   ← userSku khách / orderId(item thứ i / tổng n item)
2026/08/27                         ← ngày vào sản xuất (inProductionAt)
▐█▌▐▌█▐█▌▐▌█▐█▌                    ← Code128 `N-<productionId>` (react-barcode SVG)
N-PM-11594-04672
AOP-CUS-SHAPE-TIE      10.6x62.2   ← SKU sản phẩm (trái) · biến thể size+color (phải)
```

- **Payload barcode `N-<productionId>`** — CÙNG format với luồng quét ở `pages/orders/scan-error` (`utils/scanCodes.ts` `parseScanCode`), tức tem này quét được ngay ở trang Quét mã lỗi / luồng 2 bước Stage Error Catalog.
- **Dữ liệu tem BE trả sẵn** qua `POST /orders/barcode-labels` (`@Auth(ORDER_VIEW_ROLES)`, body `{ids: string[]}` max 500 — POST vì 500 id không nhét vừa query string): `OrderService.getBarcodeLabels()` trả `BarcodeLabel[]` theo ĐÚNG thứ tự ids. Hai giá trị phải resolve server-side:
  - **`sku`** — `OrderEntity` KHÔNG lưu SKU; lấy `variations[].sku` của Product Config (select đúng `variations.sku`, không lộ giá) rồi `resolveBarcodeSkuBase()` (`order/barcode-label.ts`, pure + có spec `barcode-label.spec.ts`): variation nào norm-endsWith size của đơn → cắt đuôi size (`AOP-CUS-SHAPE-TIE-10.6X62.2` + size `10.6x62.2` → `AOP-CUS-SHAPE-TIE`); không khớp → tiền tố chung dài nhất của các variation; bét nhất trả nguyên variation đầu. CỐ Ý không populate variations vào `getOrders` — phình payload mọi danh sách đơn chỉ để phục vụ lúc in.
  - **`itemIndex/itemTotal`** — vị trí item trong TOÀN BỘ item còn sống (không `cancelledAt`) của cùng **(orderId, userEmail)** trên hệ thống (ghép `userEmail` vì `orderId` chỉ unique theo nguồn đơn), KHÔNG phải trong lô đang in: chọn 1/2 item để in thì tem vẫn ghi (1/2) — số này để xưởng gom đủ kiện. Thứ tự item cố định sort theo `productionId` → in lại tem không đổi số. Đơn không có `orderId` → (1/1) và heading rơi về productionId.
- **Đơn hủy bị BE loại lặng lẽ** (`cancelledAt: {$exists: false}`) → FE so `rows.length` với `selectedIds.length`, lệch thì `toast.warning` (`bulkEdit.labelPartial`) — cùng quy tắc và cùng trần `MAX_LABELS_PER_PRINT = 500` với "In tem nhỏ" (§16.6).
- **Cơ chế in** (`components/orders/BarcodeLabelPrint.tsx`, dùng chung cho cả hai khổ §16.6/§16.7): portal ra `document.body`, `display: none` anh chị em, `@page {size: 75mm 50mm}` chỉ sống lúc mount, ngắt trang mọi tem trừ `:last-child`, in sau 2 khung hình. Barcode `width={1}`: mã cố định 16 ký tự → ~211 module ≈ 56mm luôn lọt lòng tem 69mm; KHÔNG kéo giãn SVG bằng CSS (JsBarcode xuất svg không viewBox — scale CSS chỉ cắt hình chứ không phóng vạch).

FE: `services/order.ts` `getBarcodeLabels` · i18n `bulkEdit.printBarcodeBtn/printBarcodeTitle`. Shared: `GetBarcodeLabelsDto`/`BarcodeLabelZod`/`GetBarcodeLabelsResDto` (`production-order.dto.ts`).

### 16.8 "In label giao hàng" — label 4×6 INCH kiểu carrier (2026-09-16)

Label "DO NOT SHIP" dán túi/kiện theo khuôn label OnosPod cũ (ảnh mẫu do vận hành cung cấp) — con tem THỨ BA, khác hẳn 2 tem trên: khổ **4×6 inch** (không phải 4×6cm), có ĐỊA CHỈ NGƯỜI NHẬN (từ `shippingAddress` kéo về từ OnosPod lúc import — §3.6) + ảnh mockup + SKU biến thể. **Chốt nghiệp vụ: in được ở MỌI công đoạn, bởi MỌI role đăng nhập** — vì vậy `OrderRowActionsMenu` KHÔNG còn return null cho role thường (role không có quyền hold/admin giờ vẫn thấy menu "..." nhưng chỉ gồm 2 mục in nhãn).

Layout (từ trên xuống): ô "G" + tên xưởng gửi + OnosFactory/DO NOT SHIP/ngày/cân nặng + hộp POSTAGE PAID → banner **DO NOT SHIP** + Created date → dòng xưởng gửi → QR (trỏ `/track/<productionId>`, cùng convention tem khách §16.6) + khối địa chỉ người nhận in hoa → `TRACKING #` + **Code128 = `productionId` TRẦN** (KHÔNG prefix `N-` — muốn quét trạm xưởng thì dùng tem §16.7; chữ dưới vạch in LIỀN không giãn cách, chốt nghiệp vụ) → ảnh mockup + `<SKU biến thể> × qty` + `Seller · Size · Color` + `Merchant ID: <orderId>`. Chữ trên mặt tem CỐ Ý tiếng Anh cố định (khuôn carrier quốc tế, không theo toggle ngôn ngữ — cùng tiền lệ trang Careers).

- **Dữ liệu BE trả sẵn** qua `POST /orders/shipping-labels` (`@Auth([])` — mọi role, chỉ đọc; body `{ids}` max 500): `OrderService.getShippingLabels()` trả `ShippingLabel[]` đúng thứ tự ids, đơn hủy loại lặng lẽ như §16.7. Resolve server-side: `factoryName` (bảng `factories`), `sku`/`weightGram` qua `resolveShippingLabelInfo()` (`order/shipping-label.ts`, pure + spec `shipping-label.spec.ts`) — biến thể norm-endsWith size trả **SKU ĐẦY ĐỦ** (`PAOPPOLO-SAME-DESIGN-3XL`, KHÁC `resolveBarcodeSkuBase` đã gọt đuôi); cân GRAM ưu tiên `order.weight` → cân biến thể khớp size → `ProductConfig.weight` mặc định (đơn OnosPod import không có weight nên thường rơi vào 2 nguồn sau); FE format "0 lb 10.2 oz (288 g)".
- **Đơn thiếu địa chỉ KHÔNG in tem trống** — BE vẫn trả row, FE lọc bằng `hasShippingAddress()` (export từ `ShippingLabelPrint.tsx`: cần `address1` + city/postcode): bản 1 đơn toast cảnh báo kèm productionId, bản bulk tách nhóm thiếu ra toast (`bulkEdit.shippingLabelNoAddress` liệt kê tối đa 5 mã) và chỉ in phần còn lại. Đơn cũ trước ngày kéo địa chỉ (2026-09-16) phần lớn sẽ rơi nhóm này.
- **Cơ chế in** (`components/orders/ShippingLabelPrint.tsx`): cùng khuôn portal + `@page {size: 4in 6in}` + ngắt trang như 2 tem trên, KHÁC duy nhất: tem có ẢNH mockup từ CDN → phải **chờ mọi `<img>` load xong** (trần `IMAGE_WAIT_MS=2500ms` — CDN hỏng vẫn in, ô ảnh trống) rồi mới `window.print()`, không thì tem ra ô ảnh trắng dù màn hình sau đó hiện đủ. Barcode `width={1.6}`: productionId 14 ký tự → 189 module ≈ 3.15in lọt lòng tem 3.68in.
- **Điểm vào**: menu "..." từng hàng (mục "In label giao hàng", icon `Tag`, mở cho mọi role) + nút "In label giao hàng" trên `BulkEditToolbar` (cạnh "In tem barcode", cùng trần 500 + toast in-thiếu §16.7).
- **Còn mở**: dòng "Mailed from `<zip>`" của label mẫu chưa in được — xưởng trong hệ chưa có địa chỉ/zip (thêm field cho `FactoryEntity` hoặc dùng địa chỉ ShippingFrom cấu hình VNP theo xưởng khi cần).

FE: `services/order.ts` `getShippingLabels` · i18n `rowActionsMenu.printShippingLabel/shippingLabelNotFound/shippingLabelNoAddress` + `bulkEdit.printShippingLabelBtn/printShippingLabelTitle/shippingLabelNoAddress`. Shared: `GetShippingLabelsDto`/`ShippingLabelZod`/`GetShippingLabelsResDto` (`production-order.dto.ts`).

### 16.9 "Xuất PDF label" — gộp label THẬT của carrier thành 1 file (2026-09-17)

Tick N đơn → nút **"Xuất PDF label"** trên `BulkEditToolbar` (CHỈ Danh sách đơn `/ffm/orders`, chốt nghiệp vụ) → tải về **1 file PDF, mỗi label 1 trang**. KHÁC HẲN §16.8: đây là **file label USPS/carrier thật** đã tồn tại — mua qua VNP (`vnpShipment.labelUrl`, PDF trên CloudFront) hoặc khách tự cấp ORD-26 (`tracking.labelUrl`, thường là link Google Drive) — BE **tải về và ghép nguyên văn, KHÔNG vẽ lại**.

- **BE** `POST /orders/shipping-labels/export-pdf` (`@Auth([])`, body `{ids}` max **200** — thấp hơn trần 500 của in tem vì mỗi label phải tải từ CDN/Drive): `ShippingLabelPdfService.exportPdf()` (`order/shipping-label-pdf.service.ts`, ghép bằng **pdf-lib** thuần JS — không headless browser trên VPS).
- **Chọn nguồn per đơn** = hàm thuần `resolveLabelExportSources()` (`order/label-export.ts` + spec): ưu tiên label VNP còn hiệu lực (bỏ label đã `cancelledAt`) → fallback label khách cấp; không có → skip `no-label`; id lạ → `not-found`. **GIỮ THỨ TỰ tick** — thứ tự trang = thứ tự bảng.
- **Item chung kiện** (mua gộp theo orderId — VnpShipping.md, N item chung 1 `labelUrl`) → chỉ 1 trang, item sau trả về mảng `merged` (FE toast info "đã gộp trang", KHÔNG phải lỗi).
- **Ghép file**: label PDF → copy nguyên trang (label nhiều trang giữ đủ); PNG/JPG → trang 4×6in fit ảnh; Drive link đổi sang direct-download qua `extractDriveId`/`buildDriveDownloadUrl` (`utils/design-url.ts`), Drive trả HTML (file không public) → skip `fetch-failed`. Tải song song 5 luồng, timeout 20s, trần 25MB/file. Đơn hỏng chỉ hỏng riêng nó — file vẫn ra phần còn lại (mirror khuôn in-thiếu §16.7).
- **Response** (`ExportShippingLabels*` DTOs, `production-order.dto.ts`): `{pdfBase64|null, pageCount, labelCount, merged[], skipped[{productionId, reason}]}` — FE decode base64 → Blob tải `shipping-labels-<stamp>-<n>.pdf`, toast warning nhóm skipped (5 mã đầu) + info merged + success đếm label/trang. i18n `bulkEdit.exportLabelPdf*`.

## 17. Ưu tiên đơn hàng + hạn dự kiến từng bước

> **File FE:** `apps/web/src/components/orders/cells/PrioritySelectCell.tsx` (`PrioritySelectCell` + `PriorityBadge` + `PRIORITY_META`), `apps/web/src/utils/priorityEstimate.ts` (`getStageDeadline` + `getActiveStageKey` + `formatCountdown`), `apps/web/src/hooks/useNow.ts` (tick chip đếm ngược), cột "Ưu tiên" (`PriorityCell`) trong `apps/web/src/components/orders/workshopTableConfig.tsx`, cell trong `apps/web/src/pages/orders/ListOrderTab.tsx`, nút + dialog bulk riêng trong `apps/web/src/components/orders/BulkEditToolbar.tsx`, cột hiển thị + filter trong `apps/web/src/pages/home/ToolCheckTab.tsx` (`toPriorityOpts`), badge + estimate trong `apps/web/src/pages/home/DesignerAssignBacklog.tsx`
> **File BE:** `apps/api/src/modules/order/order.entity.ts` (`priority?: OrderPriority`), `apps/api/src/modules/order/order.service.ts` (`FIELD_CONFIG_CATEGORY`/`FIELD_EDIT_ROLES`/`assertPriorityValueValid` + sort `getOrders`/`getOrdersGroupedByType`/`exportOrders`/`getErrorLog`), `apps/api/src/modules/designer/designer-stats.service.ts` (`getToolCheckOverview` — filter `priority` + facet `priorityFacetAgg` + sort; `getAssignBacklog` — projection + map `priority` + sort; `getPersonErrorOrders` sort)
> **Shared:** `packages/shared/enums/order-priority.ts` (`OrderPriority` 1=Ưu tiên/2=Ưu tiên cao/3=Ưu tiên nhất + `ORDER_PRIORITIES` + `ORDER_PRIORITY_LABELS`), `packages/shared/dtos/production-order.dto.ts` (`priority` trong `ProductionOrderZod` + `'priority'` trong `ORDER_WORKSHOP_FIELDS` + `ORDER_PRIORITY_STAGE_ESTIMATE_HOURS` cạnh `LIFECYCLE_STAGE_KEYS` + `priority` trong `GetToolCheckOverviewZod`/`ToolCheckOrderZod`/`ToolCheckOverviewResZod.facets`), `packages/shared/dtos/designer.dto.ts` (`priority` trong `AssignBacklogOrderZod`)
> **API:** tái dùng `PATCH /v1/orders/:id/field` + `PATCH /v1/orders/bulk-field` (field=`priority`) — KHÔNG có endpoint riêng. `GET /designer/tool-check-overview` nhận thêm query `priority` ('1'|'2'|'3').

### 17.1 Overview
3 mức ưu tiên cố định (không qua workshop_config): **Ưu tiên** (1, xanh lam) / **Ưu tiên cao** (2, vàng) / **Ưu tiên nhất** (3, đỏ) — số càng cao càng ưu tiên. Không set = đơn thường (không badge, không estimate, không đẩy lên đầu). Field `priority` được đưa vào `ORDER_WORKSHOP_FIELDS` nên **tái dùng nguyên vẹn** pipeline `updateField`/`bulkUpdateField` (permission gate, audit log, cache invalidate) — chỉ thêm validate riêng (`assertPriorityValueValid`: chỉ nhận `'1'|'2'|'3'`|null) vì đây không phải field workshop_config.

### 17.2 Sửa ưu tiên
- **Danh sách đơn** (`OrderTableWorkshop.tsx`): cột "Ưu tiên" (đầu bảng, cạnh Production ID) — sửa từng dòng qua `PrioritySelectCell`; **bulk gán** qua nút riêng **"Ưu tiên"** (`Flag` icon) trên `BulkEditToolbar` — mirror pattern nút "Gán design" (`UserPlus` → `AssignDesignerDialog`): mở dialog riêng chọn 1 trong 3 mức/bỏ ưu tiên, KHÔNG nằm trong dropdown "Bulk update" chung (field `priority` nằm trong `BULK_UPDATE_BLACKLIST` cùng `assignee`).
- **Tab List** (`ListOrderTab.tsx`): cột "Ưu tiên" tương tự (sửa từng dòng), **không có bulk** (tab này không có cơ chế chọn nhiều dòng).
- **Tab "Soát tool"** (`ToolCheckTab.tsx`, dashboard): chỉ **hiển thị** (`PriorityBadge` + chip đếm ngược, không sửa được ở đây) — cột "Ưu tiên" cạnh "Mã đơn" trong cả 2 list `reworkList`/`unreviewedList` + dropdown filter "Ưu tiên" (4 cột filter cùng hàng với Sản phẩm/Khách hàng/Máy). Estimate tính theo bước `tool-check` (bước đầu `LIFECYCLE_STAGE_KEYS`), mốc `enteredAt` = thẳng `inProductionAt` (không có mốc riêng "vào hàng chờ soát"/"quay lại Support" trong dữ liệu — xem `Orders.md §17.4`). Muốn đổi mức ưu tiên của đơn → sửa ở Danh sách đơn/Tab List.
- Permission: `order.field.priority.view` / `.edit` (permission-catalog, nhóm `order_field`). Fallback hard-code (`FIELD_EDIT_ROLES.priority`): Admin/SuperAdmin/Manager + DesignerLeader.
- **Auto-gán theo khách hàng lúc import**: Admin cấu hình kanban khách → 3 mức ưu tiên ở `/adm/settings/customer-priority`; `importOrders` (tay lẫn tự động) tự gán `priority` cho đơn khớp khách — CHỈ khi đơn chưa có priority (không đè chỉnh tay, không backfill đơn đang chạy). Xem `CustomerFactoryAssignment.md §8`.

### 17.3 Sort — đơn ưu tiên lên đầu
`priority: -1` là **sort key đầu tiên** (trước mọi sort/trục nhóm khác) ở **toàn bộ danh sách đơn trong dự án** — đơn KHÔNG có `priority` (missing field) tự nhiên xếp cuối khi sort desc, không ảnh hưởng thứ tự đơn thường:
- `OrderService.getOrders()` (List tab, non-grouped) + nhánh `sort=grouped` (aggregation `$sort` — batch in theo type/size, dùng bởi `OrderFactoryTab`/`PrintOrderTable`/`OrdersMiniTable`: `priority` đứng trước `type`/`__sizeRank` nên đơn ưu tiên trồi lên đầu toàn cục, chấp nhận batch bị chia nhỏ theo type để đơn gấp luôn được in trước) + `exportOrders()` (export "Đơn hàng theo xưởng").
- `OrderService.getOrdersGroupedByType()` (Workshop table — trong từng nhóm type) + client sort `decoratedGroups` (`OrderTableWorkshop.tsx`, cùng comparator trước combo-count).
- `OrderService.getErrorLog()` (tab "Nhật ký bù lỗi") — đứng trước sort theo tuổi lỗi `productionFirstErrorAt`.
- Mọi query kanban: `DesignerTaskService.getMyTasks` (cả 7 cột), `FulfillmentTaskService.getMyTasks`.
- `DesignerStatsService`: `getAssignBacklog()` (backlog "Cần gán"), `getToolCheckOverview()` (2 list `reworkRaw`/`unreviewedRaw` — tab "Soát tool"), `getPersonErrorOrders()` (drill-down "Lỗi theo người").

**Ngoài phạm vi (cố ý không đụng):** `getCancelledOrders()` (dialog đơn đã hủy) — đơn hủy đã ra khỏi mọi công đoạn sản xuất (xem `CancelledOrders-ExcludeFromStages.md`), ưu tiên không còn ý nghĩa vận hành với đơn đã đóng.

### 17.4 Hạn dự kiến từng bước (estimate) — chip đếm ngược
Với đơn CÓ priority, hạn dự kiến của bước hiện tại = **thời điểm đơn VÀO bước đó** (`waitingAt`/`startedAt`/`designerAssignedAt` tuỳ bước) **+ số giờ cấu hình** theo `(priority, bước)` — map `ORDER_PRIORITY_STAGE_ESTIMATE_HOURS` (8 bước theo `LIFECYCLE_STAGE_KEYS`: tool-check/designer/6 stage fulfillment). **Hiện tại đặt đồng loạt 4 tiếng** cho mọi bước/mức (`DEFAULT_STAGE_ESTIMATE_HOURS`) — tinh chỉnh sau bằng cách sửa trực tiếp map, không cần đổi code gọi. Tính deadline thuần FE (`getStageDeadline`, `@/utils/priorityEstimate`).

**Đơn CHƯA chạy bước nào** (`designerStatus` rỗng/`unassigned`, chưa có `currentFulfillmentStage`) — vẫn tính là đang chờ bước `designer` (`getActiveStageKey` coi `unassigned`/thiếu status = `designer`) + dùng **`inProductionAt`** (giờ vào sản xuất) làm mốc `enteredAt` khi field entered-at riêng của bước (`designerAssignedAt`/`waitingAt`...) chưa có — cả 3 nơi hiển thị (`PriorityCell`, `TaskCard`, `FulfillmentTaskCard`) đều fallback `... || inProductionAt`. Nhờ vậy đơn mới import/chưa ai nhận vẫn thấy đếm ngược ngay từ lúc vào sản xuất thay vì trống trơn.

**Hiển thị dạng đếm ngược** (không phải giờ tuyệt đối) — `formatCountdown(deadline, now)` (cùng file `priorityEstimate.ts`) trả `"Còn 2h30p"` / `"Quá hạn 45p"` (đỏ, in đậm); hover vào chip mới thấy mốc giờ tuyệt đối (`HH:mm`) qua `Hint`. `now` tick lại mỗi 30s qua hook `useNow` (`@/hooks/useNow.ts`, `setInterval` + `useState`) để chip tự cập nhật real-time không cần refetch.
- Trong `render()` thuần (không phải component — vd cột `WORKSHOP_COLS`) **KHÔNG được gọi hook trực tiếp** (số hàng đổi → vi phạm Rules of Hooks). Danh sách đơn tách riêng `PriorityCell` (component thật trong `workshopTableConfig.tsx`) rồi `render: (r, ctx) => <PriorityCell row={r} ctx={ctx} />` — Kanban Designer/Fulfillment gọi `useNow` thẳng vì `TaskCard`/`FulfillmentTaskCard` vốn đã là component.

Hiển thị (chip đồng hồ, đỏ nếu quá hạn):
- **Kanban Designer** (`TaskCard.tsx`): bước `designer`, chỉ khi status ∈ {Assigned, InProgress}.
- **Kanban Fulfillment** (`FulfillmentTaskCard.tsx`): bước = `myStage`, chỉ khi status ∈ {Waiting, InProgress}.
- **Danh sách đơn**: cột "Ưu tiên" (`PriorityCell`) tự suy bước hiện tại qua `getActiveStageKey` (ưu tiên `currentFulfillmentStage`, fallback `designer` cho assigned/in-progress/rework/unassigned/thiếu status).
- **Dashboard → backlog "Cần gán designer"** (`DesignerAssignBacklog.tsx`, xem `Dashboard.md §0c`): bước luôn = `designer`, mốc `enteredAt` = thẳng `inProductionAt` (mọi đơn trong backlog này chưa từng chạy bước designer). `useNow` gọi 1 lần ở component cha, truyền `now` xuống từng dòng trong `.map()`.
- **Dashboard → tab "Soát tool"** (`ToolCheckTab.tsx`, xem `ToolCheckWorkflow.md §2.3`): bước luôn = `tool-check`, mốc `enteredAt` = thẳng `inProductionAt` (cả `reworkList` lẫn `unreviewedList` — không có mốc riêng "vào hàng chờ soát"/"quay lại Support"). `renderRow` là closure bên trong component (không phải hàm module-level như `WORKSHOP_COLS`) nên đọc thẳng `now` từ state cha, không cần tách component riêng.
- **Tab List**: KHÔNG hiện estimate (view này không có thông tin bước/stage nào khác để tính mốc).

## 18. Design Review — public API cho tool ngoài duyệt thiết kế

> **File BE:** `apps/api/src/modules/order/order.controller.ts` → `GET /v1/orders/design-review/next` + `GET /v1/orders/design-review/by-production-id/:productionId` + `GET /v1/orders/design-review/error-file-options` + `POST /v1/orders/design-review/result`, `apps/api/src/modules/order/order.service.ts` → `getNextDesignReviewOrder()` + `getDesignReviewOrderByProductionId()` + `getDesignReviewErrorFileOptions()` + `setDesignReviewResult()`, `apps/api/src/modules/order/design-review-product-code.ts` (`PRODUCT_TYPE_CODE_MAP` — CHỈ còn là dữ liệu migration 1 lần, runtime đọc `ProductConfig.designReviewCode` qua `resolveDesignReviewProduct()` — PRD-2, xem §18.5)
> **Shared:** `packages/shared/dtos/production-order.dto.ts` (`GetNextDesignReviewOrderZod`/`GetNextDesignReviewOrderDto` + `DesignReviewOrderZod`/`DesignReviewAttributesZod`/`GetNextDesignReviewOrderResDto` + `GetDesignReviewOrderByIdResDto` + `DesignReviewErrorFileOptionZod`/`GetDesignReviewErrorFileOptionsResDto` + `SetDesignReviewResultZod`/`SetDesignReviewResultResDto`)
> **Route:** không có FE — chỉ API cho hệ thống ngoài gọi.
> **API:** `GET /v1/orders/design-review/next`, `GET /v1/orders/design-review/by-production-id/:productionId`, `GET /v1/orders/design-review/error-file-options`, `POST /v1/orders/design-review/result`

### 18.1 Overview
4 endpoint **hoàn toàn public** (`@Auth([], [], { public: true })` — không JWT, không API key, theo quyết định người dùng khi tạo tính năng), cho **nhiều client song song** (bot duyệt thiết kế) dùng theo cặp, xoay quanh field **`toolResult`** ("Kết quả Tool", KHÁC `toolResultNote` "Note kq Tool 1" — field đó giờ CHỈ nhân viên sửa tay, ngoài luồng automation này):
1. `GET /design-review/next` — lấy **1 đơn mỗi lần gọi**, luôn là đơn đang ở **bước đầu tiên của tiến trình**: chưa có Kết quả Tool (`toolResult` rỗng) **và** chưa gán designer (`designerStatus='unassigned'`). Query optional `from`/`to` (`YYYY-MM-DD`) lọc thêm theo khoảng ngày `inProductionAt` (VN tz) — cùng semantics `createdFrom`/`createdTo` ở danh sách đơn (§7.0b), chỉ đổi tên field cho gọn vì đây là API public riêng. Không truyền `from`/`to` → không giới hạn ngày (hành vi mặc định, không breaking client cũ). Query optional `pid` — ép lấy ĐÚNG 1 đơn theo `productionId`, bỏ qua mọi filter hàng đợi, không claim lease (uỷ quyền lại cho `getDesignReviewOrderByProductionId`).
2. `GET /design-review/by-production-id/:productionId` — lookup TRỰC TIẾP 1 đơn theo `productionId` để tool soát lại/tra cứu, KHÔNG áp filter hàng đợi (trả về đơn ở BẤT KỲ trạng thái nào, kể cả đã soát/đã gán) và KHÔNG claim lease. Cùng response shape `DesignReviewOrder` với `/next` (§18.4).
3. `GET /design-review/error-file-options` — trả về danh mục **"File lỗi"** (`workshop_config` category `error_file_type`, chỉ code active) để tool hiển thị lựa chọn khi Note kq Tool 1 = `'error'`, rồi truyền `code` lại qua field `errorFile` ở `/design-review/result` (xem §18.7).
4. `POST /design-review/result` — sau khi client xử lý xong, gọi lại để lưu **Kết quả Tool** (`toolResult`) — tương đương thao tác tay ở cột "Kết quả Tool" (Danh sách đơn, `/orders?tab=list`). Đơn tự rời khỏi hàng đợi `next` ngay khi `toolResult` được set (không rỗng nữa). Optional `toolResultNote` ("Note kq Tool 1") — nếu truyền, ghi luôn field này và chạy CÙNG side-effect hook với sửa tay (xem §18.7). Optional `errorFile` ("File lỗi", chọn được nhiều lỗi cùng lúc) + `errorFileNote` ("Ghi chú", free text) — cùng cơ chế optional, dùng khi `toolResultNote='error'` (xem §18.7). Optional `cuttingFileUrl` — Drive URL của file cutting/**"File in"** (design đã duyệt) — CÙNG field được `POST /orders/cutting-files/apply` set (§15), free text, cùng cơ chế optional, KHÔNG qua `workshop_config`/`updateField()` (xem §18.7).

`toolResult` **vẫn được map từ `ProductConfig.toolResult` lúc import** (CSV hoặc API OnosPod — cùng chung pipeline `importOrders()`, khớp theo `type` ↔ `ProductConfig.fullName`), giống mọi field insert-only khác — chỉ set **lần đầu tạo đơn** (`$setOnInsert`, KHÔNG bị ghi đè khi re-import). **Để tạm** như vậy (comment `// Để tạm, tool ổn sẽ xóa không lưu toolResult vào đơn nữa` ở `importOrders()`) — dự định khi tool duyệt thiết kế ổn định sẽ bỏ mapping này để MỌI đơn mới đều tự vào hàng đợi `/next` ngay từ đầu. Trong lúc chờ: đơn nào product config đã có sẵn `toolResult` sẽ KHÔNG vào hàng đợi `/next` (vì điều kiện §18.3 là `toolResult` rỗng) — chỉ đơn chưa map/product config chưa set `toolResult` mới vào hàng đợi.

### 18.2 Chống trùng — claim + lease (nhiều client gọi song song)
`findOne` thuần sẽ bị race (2 client nhận trùng đơn trước khi ai kịp set `toolResult`). Giải quyết bằng **atomic claim**: `getNextDesignReviewOrder()` dùng `findOneAndUpdate` — filter + `$set: { designReviewClaimedAt: now }` chạy atomic per-document ở Mongo, nên 2 request cùng lúc không bao giờ khớp cùng 1 doc.

- Field `OrderEntity.designReviewClaimedAt?: Date` (index) — mốc client claim đơn.
- Filter loại thêm đơn đang trong lease: `designReviewClaimedAt` không tồn tại HOẶC `< now - DESIGN_REVIEW_CLAIM_LEASE_MS`.
- `DESIGN_REVIEW_CLAIM_LEASE_MS` (`order.service.ts`, hiện = **3 phút**) — client xử lý thực tế mất ~1-2 phút, đặt gấp ~1.5x làm buffer. Sửa trực tiếp hằng số này để tinh chỉnh, không cần đổi code gọi.
- Hết lease mà đơn vẫn chưa có `toolResult` (client crash giữa chừng, không kịp báo kết quả) → đơn tự nhả lại cho lần gọi kế tiếp — KHÔNG cần endpoint release/cancel-claim riêng.
- Đơn claim xong nhưng sau đó được set `toolResult` thì bị loại khỏi query bởi điều kiện `toolResult` (không phụ thuộc lease nữa) — không cần clear `designReviewClaimedAt`.

### 18.3 Query + sort
Filter (`getNextDesignReviewOrder(dto)`):
```
deletedAt   không tồn tại
cancelledAt không tồn tại   // đơn hủy loại khỏi mọi công đoạn (quy ước chung)
heldAt      không tồn tại   // đơn đang giữ không đưa cho tool ngoài xử lý
toolResult  rỗng/null   // chưa có Kết quả Tool
designerStatus  = 'unassigned'
designReviewClaimedAt  không tồn tại HOẶC quá hạn lease (§18.2)
inProductionAt  trong [vnDayStart(dto.from), vnDayEnd(dto.to)]  // CHỈ áp khi dto.from hoặc dto.to có giá trị
```
Sort: `priority desc` → `inProductionAt asc` → `createdAt asc` (đơn ưu tiên cao trước; cùng mức ưu tiên thì đơn nhập sản xuất trước lấy trước). `findOneAndUpdate` + implicit limit 1 + `new: true` (trả doc SAU khi claim).

### 18.4 Response shape
```ts
{
  success: true,
  data: {
    productionId: string;          // khóa duy nhất, luôn có — dùng để gọi lại POST /design-review/result
    orderId?: string;              // mã đơn marketplace/sàn (import từ sheet) — có thể rỗng với 1 số đơn
    productCode: string | null;    // = `ProductConfig.designReviewCode` của sản phẩm khớp `type` (PRD-2, đọc DB) — null nếu không khớp sản phẩm nào hoặc mã trống. TÊN FIELD giữ nguyên cho tool ngoài
    attributes: { size?: string; color?: string };
    designs: DesignFields;        // chỉ các key có URL (front/back/sleeve/...), raw Drive URL (R2 pipeline đang tắt — xem ImageOptimization.md)
    mockupUrl?: string;            // ảnh mockup sản phẩm — tham chiếu trực quan khi soát design
    inProductionAt: string | null; // ngày đơn chuyển sang sản xuất (ISO date) — null nếu đơn chưa có mốc này
    // ↓ ORD-6 — CHỈ THÊM, không field cũ nào đổi tên/đổi kiểu (tool bản cũ ở xưởng phải chạy tiếp được)
    isDtf: boolean;                // đơn có in DTF không — xem §18.4a
    printAreas: {                  // vị trí in + kích thước THẬT theo size của CHÍNH đơn này — xem §18.4b
      key: string;                 //   trùng key trong `designs` (DesignFields)
      label: string;               //   nhãn tiếng Việt (PRODUCT_PRINT_AREA_LABEL_MAP)
      configured: boolean;         //   false = đơn có design ở vị trí này nhưng sản phẩm CHƯA cấu hình nó
      widthCm: number | null;      //   null = không xác định được (xem §18.4b) — KHÔNG BAO GIỜ là số đoán
      lengthCm: number | null;
    }[];
    variantSku: string | null;     // SKU biến thể khớp size+màu của đơn — null nếu không khớp hoặc khớp NHIỀU biến thể
  } | null;   // null khi không còn đơn nào ở bước đầu tiên
  remaining: number;   // tổng số đơn còn cần xử lý (đúng điều kiện §18.3, KHÔNG xét claim/lease) — bao gồm cả đơn trong `data`, đếm bằng countDocuments() song song (Promise.all) với findOneAndUpdate
}
```

Cả hai endpoint đọc đơn (`/next` và `/by-production-id/:productionId`) dùng CHUNG mapper `toDesignReviewOrder()` nên shape luôn giống hệt nhau — thêm field mới phải sửa đúng một chỗ.

### 18.4a `isDtf` — cờ đơn in DTF (ORD-6)
`true` khi **một trong hai**:

1. **Đường chính** — cấu hình sản phẩm: `ProductConfig.printMethod === 'dtf'` (mã trong danh mục `workshop_config` category `print_method`; danh mục thật: `dtg` · `dtf` · `sublimation` · `embroidery`). Hằng `DTF_PRINT_METHOD_CODE` ở `order.service.ts`.
2. **Đường phụ, quy ước CŨ** — `productCode` (tức `designReviewCode`) đúng chữ `TIFF`, không phân biệt hoa thường. Hằng `LEGACY_DTF_PRODUCT_CODE`. **GIỮ LẠI có chủ ý**: tool bản đang chạy ở xưởng nhận diện DTF bằng quy ước này, gỡ đi là gãy dây chuyền soát design. Quy ước đó cũng là lý do mọi sản phẩm DTF từng buộc phải mang cùng một mã `TIFF` nên **không phân biệt được sản phẩm nào với sản phẩm nào** — nay `printMethod` giải quyết việc đó.

Đơn không tra được sản phẩm (chưa map `type`) → `false`, response vẫn `200`.

### 18.4b `printAreas` — kích thước in theo size của ĐƠN (ORD-6)
Danh sách là **HỢP** của: vị trí in đã cấu hình ở sản phẩm (`ProductConfig.printArea[]`) **và** vị trí có URL trong `designs` của đơn. Vị trí có design mà sản phẩm chưa cấu hình vẫn được liệt kê với `configured: false` — để tool thấy được ca "có file nhưng thiếu cấu hình" thay vì im lặng bỏ qua.

`widthCm`/`lengthCm` lấy từ `ProductConfig.printArea[].sizeDimensions[]` (PRD-7) khớp **size của chính đơn** (`OrderEntity.size`), ghép **trim + không phân biệt hoa thường**. Trả `null` khi: size của đơn không khớp size nào trong cấu hình · vị trí chưa nhập kích thước · đơn không có size · sản phẩm chưa cấu hình vị trí đó.

> **KHÔNG ĐOÁN.** Không khớp thì trả rỗng, tuyệt đối không lấy tạm size khác hay số mặc định — tool dừng lại và báo lỗi vẫn tốt hơn nhiều so với in sai kích thước lên giấy DTF. Đơn vị là **cm** đúng như PRD-7 lưu; quy đổi cm → pixel theo DPI là việc của tool.

Sản phẩm chưa cấu hình vị trí in nào và đơn cũng không có design → mảng rỗng, không lỗi.

`variantSku` ghép size + màu của đơn với `variations[].attributes` qua **hàm dùng chung** `packages/shared/constants/variation-attribute.ts` (nhãn size `Item Size`/`Size` — có cả hai thì ưu tiên `Item Size`; nhãn màu `Màu`/`Color`/`Colour`), cũng trim + không phân biệt hoa thường. **Cùng file mà trang sản phẩm dùng để dựng bảng kích thước theo size (Products.md §2.4a)** — chép luật ra hai nơi là cách chắc chắn nhất để nhập được kích thước ở trang sản phẩm mà API trả rỗng; **chỉ trả khi khớp DUY NHẤT 1 biến thể** — khớp nhiều thì `null`, vì đoán sai SKU là dán nhầm nhãn nhận diện lên kiện hàng.

> **API này CÔNG KHAI, không cần JWT** — mọi field thêm vào là công khai với bất kỳ ai gọi được. Vì thế response **không có** trường tiền nào (`cost`/`retailPrice`/`wholesalePrice`/`nonShipCost`) và **không có** danh tính người thao tác. Thêm field mới ở đây phải soi lại đúng hai điều này.

### 18.5 Nguồn `productCode` — `ProductConfig.designReviewCode` trong DB (PRD-2)
`productCode` đọc từ **DB lúc gọi API**: `resolveDesignReviewProduct()` (`order.service.ts` — từ ORD-6 đọc CẢ cấu hình sản phẩm một lần cho `productCode` + `isDtf` + `printAreas` + `variantSku`) khớp `OrderEntity.type` ↔ `ProductConfig.fullName` (exact, trim + case-insensitive — đúng quy tắc map cũ) rồi trả **`designReviewCode`** của sản phẩm; không khớp sản phẩm nào / mã trống → `null`. **Sửa/thêm mã ngay trên UI Products** (ô "Mã chạy tool duyệt thiết kế", khu Sản xuất trang chi tiết sản phẩm), không cần deploy.

> **PRD-2 — mã tool KHÔNG còn nằm ở `shortName`.** ORD-3 mượn `shortName` làm khoá kỹ thuật nên tên viết tắt do người dùng đặt bị coi là mã tool; nay mã có trường riêng `designReviewCode`, còn `shortName` trở lại đúng nghĩa tên viết tắt và **không migration/import nào được ghi đè nó nữa**. Tên field `productCode` trong response GIỮ NGUYÊN — tool ngoài (`.localdev`) đang đọc đúng tên đó.

Map hardcode cũ `PRODUCT_TYPE_CODE_MAP` (`design-review-product-code.ts`) chỉ còn là **dữ liệu migration một lần** `migrateDesignReviewCodes()` (`product-config.service.ts` `onModuleInit`): đổ mã vào `designReviewCode` cho sản phẩm khớp map; **sản phẩm không khớp thì bỏ qua, không ghi, không xoá gì** — khác hẳn bản ORD-3 đã bị gỡ (nó ghi vào `shortName` và xoá trắng sản phẩm không khớp).

Cơ chế chạy-một-lần: cờ `system_configs` key `design_review_code_migration`.

- Kế hoạch đổi (kèm mã cũ + `shortName` từng sản phẩm) ghi vào cờ **TRƯỚC** khi sửa dữ liệu, nên hỏng giữa chừng vẫn còn dấu vết đối chiếu.
- Cờ kẹt ở `running` quá 10 phút → lần khởi động sau tự nhận lại việc (ORD-3 chiếm cờ rồi mới làm nên chết máy là kẹt vĩnh viễn).
- Chạy lại từ đầu bằng tay: xoá document `design_review_code_migration` trong `system_configs`.
- Lần khởi động sau khi đã `done` in log `bỏ qua ... 0 bản ghi đổi thêm` và KHÔNG đụng dữ liệu — mã người dùng sửa tay không bị đè.

`shortName` **được phép trống** ở entity/DTO/form và **không còn auto-sinh** từ fullName ở mọi đường tạo sản phẩm — xem Products.md §2.

### 18.6 `GET /design-review/error-file-options` — danh mục "File lỗi"

Không tham số. Trả về TOÀN BỘ code active của `workshop_config` category `error_file_type` (`WorkshopConfigCategory.ErrorFileType` — cùng danh mục field `errorFile` ở Danh sách đơn/tab "Soát tool"), sort theo `order`. JSON **tự định nghĩa riêng** cho luồng public này (`DesignReviewErrorFileOptionZod` — chỉ `code`/`name`, KHÁC `WorkshopConfigZod` đầy đủ dùng nội bộ, không lộ `color`/`icon`/`errorSource`).

Response mẫu (`GetDesignReviewErrorFileOptionsResDto`):
```json
GET /v1/orders/design-review/error-file-options
{
  "success": true,
  "data": [
    { "code": "vien-co", "name": "Viền cổ" },
    { "code": "lech-mau", "name": "Lệch màu" }
  ]
}
```

`code` ở đây chính là giá trị tool truyền vào field `errorFile` (mảng) ở `POST /design-review/result` (§18.7).

### 18.7 `POST /design-review/result` — lưu Kết quả Tool

Body request (`SetDesignReviewResultDto`, `packages/shared/dtos/production-order.dto.ts`):

| Param | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `productionId` | `string` | Có | Mã đơn — khóa duy nhất, luôn có, exact match case-insensitive (giống `by-production-id/:code`). KHÁC `orderId` (mã đơn marketplace gốc, KHÔNG unique vì 1 đơn có thể nhiều line item) — cố tình dùng `productionId` để tránh nhầm đơn khi update. |
| `toolResult` | `string \| null` | Có | Code `workshop_config` category `tool_result`. `null` = xoá giá trị hiện có. |
| `toolResultNote` | `string \| null` | Không | "Note kq Tool 1" — code `workshop_config` category **`tool_result_note`** (`WorkshopConfigCategory.ToolResultNote`, KHÁC `production_error`). **Không truyền field này** (bỏ hẳn key khỏi JSON) → giữ nguyên hành vi cũ, KHÔNG đụng field. **Truyền** (kể cả `null` để xoá) → ghi đè + chạy CÙNG side-effect hook với xưởng đánh tay ở Danh sách đơn/tab "Soát tool" (xem `ToolCheckWorkflow.md`) — vd `'ok'` → tự vào fulfillment hoặc rework-back designer tùy trạng thái đơn. |
| `errorFile` | `string[] \| null` | Không | "File lỗi" — mảng code `workshop_config` category **`error_file_type`**, lấy từ `GET /design-review/error-file-options` (§18.6). **Chọn được nhiều lỗi cùng lúc** (mảng nhiều phần tử). Dùng khi `toolResultNote='error'` để ghi luôn nguyên nhân lỗi file — BE **không ép buộc** theo `toolResultNote` (tool tự quyết định có truyền hay không). **Không truyền field này** → giữ nguyên hành vi cũ, KHÔNG đụng field. **Truyền** (kể cả `null`/`[]` để xoá) → ghi đè. KHÔNG có side-effect hook (chỉ 1 field workshop_config đơn thuần, khác `toolResultNote`). |
| `errorFileNote` | `string \| null` | Không | "Ghi chú" — free text, **KHÔNG** qua `workshop_config` (không validate code, nhận bất kỳ chuỗi nào) — cùng cột "Kết quả Tool / File lỗi" ở Danh sách đơn (bên cạnh `errorFile`). Cùng cơ chế optional như `errorFile`. **Không truyền field này** → giữ nguyên hành vi cũ, KHÔNG đụng field. **Truyền** (kể cả `null`/`''` để xoá) → ghi đè. KHÔNG có side-effect hook. **Lưu ý:** field này KHÁC với cơ chế detect "hủy đơn" trong `errorFileNote` ở luồng import CSV rework (`order.service.ts` — hàm import rework, nếu note chứa "hủy đơn" thì tự set `cancelledAt`/`cancelReason`) — luồng `setDesignReviewResult()` đi qua `updateField()` đơn thuần, **KHÔNG** chạy detect đó. |
| `cuttingFileUrl` | `string \| null` | Không | Drive URL của file cutting/**"File in"** (design đã duyệt, dùng ở stage "In" của Fulfillment) — **CÙNG field** `cuttingFileUrl` được `POST /orders/cutting-files/apply` set (§15) — free text, **KHÔNG** qua `workshop_config`, **KHÔNG** phải `OrderWorkshopField` nên **KHÔNG** đi qua `updateField()` (set thẳng bằng `findOneAndUpdate`). Cùng cơ chế optional như `errorFileNote`. **Không truyền field này** → giữ nguyên hành vi cũ, KHÔNG đụng field. **Truyền** (kể cả `null`/`''` để xoá) → ghi đè. KHÔNG có side-effect hook, KHÔNG chạy `assertCanEditField`/`assertValueAllowed`/`assertNotHeld` (public API, field không nằm trong permission gate của Danh sách đơn). |
| `tempFileUrl` | `string \| null` | Không | Drive URL của **file in tạm** (.pdf hoặc file design) — dùng khi đơn đang bị lỗi (`toolResultNote='error'`) để tool lưu tạm tham khảo trong lúc chờ xử lý, **KHÁC** `cuttingFileUrl` (file chính thức đã duyệt). Free text, **KHÔNG** qua `workshop_config`, **KHÔNG** phải `OrderWorkshopField`. Cùng cơ chế optional/set thẳng như `cuttingFileUrl` — nếu cả 2 field cùng truyền trong 1 request, BE gộp chung **1 lần** `findOneAndUpdate()`. |

`productionId` không khớp đơn nào → 404. `toolResult` không khớp code `workshop_config` category `tool_result` đang active → 400. `toolResultNote`/`errorFile` (nếu có truyền) không khớp code active → 400. `errorFileNote`/`cuttingFileUrl`/`tempFileUrl` không validate (free text, luôn 200 nếu qua được các field trước).

**Giá trị mẫu hiện có** (seed `workshop-config.seed.ts` — admin có thể thêm code mới qua trang Workshop Config, đây không phải enum cứng):

| Field | Code mẫu | Nhãn |
|---|---|---|
| `toolResult` | `has-tool` | Có Tool |
| `toolResult` | `no-tool` | Không có Tool |
| `toolResultNote` | `no-tool` | Không có tool |
| `toolResultNote` | `error` | Lỗi |
| `toolResultNote` | `ok` | Ok — **duy nhất giá trị kích hoạt `readyForFulfill`/entry fulfillment** (mọi code khác đều coi là "chưa đạt") |
| `toolResultNote` | `no-pdf` | Không có file PDF |
| `errorFile` | *(xem `GET /design-review/error-file-options`, §18.6)* | — |
| `errorFileNote` | *(free text, không giới hạn giá trị)* | — |

Request mẫu (chỉ `toolResult`, hành vi cũ — KHÔNG đụng `toolResultNote`/`errorFile`/`errorFileNote`):
```json
POST /v1/orders/design-review/result
{
  "productionId": "RR-03884-24456",
  "toolResult": "has-tool"
}
```

Request mẫu (kèm `toolResultNote` — ghi đè cả 2 field + chạy side-effect hook):
```json
POST /v1/orders/design-review/result
{
  "productionId": "RR-03884-24456",
  "toolResult": "has-tool",
  "toolResultNote": "ok"
}
```

Request mẫu (Note kq Tool 1 = lỗi, kèm `errorFile` **nhiều lỗi** + `errorFileNote` — ghi đè cả 4 field):
```json
POST /v1/orders/design-review/result
{
  "productionId": "RR-03884-24456",
  "toolResult": "has-tool",
  "toolResultNote": "error",
  "errorFile": ["vien-co", "lech-mau"],
  "errorFileNote": "Tay áo bị lệch mẫu, cần kiểm tra lại"
}
```

Request mẫu (Note kq Tool 1 = ok, kèm `cuttingFileUrl` — lưu Drive URL file cutting/file in):
```json
POST /v1/orders/design-review/result
{
  "productionId": "RR-03884-24456",
  "toolResult": "has-tool",
  "toolResultNote": "ok",
  "cuttingFileUrl": "https://drive.google.com/file/d/xxxxx/view"
}
```

Request mẫu (Note kq Tool 1 = error, kèm `tempFileUrl` — lưu tạm file in/design để tham khảo trong lúc chờ xử lý lỗi):
```json
POST /v1/orders/design-review/result
{
  "productionId": "RR-03884-24456",
  "toolResult": "has-tool",
  "toolResultNote": "error",
  "errorFile": ["vien-co"],
  "errorFileNote": "Tay áo bị lệch mẫu",
  "tempFileUrl": "https://drive.google.com/file/d/yyyyy/view"
}
```

Response mẫu (`SetDesignReviewResultResDto` — `data` = `ProductionOrderZod` đầy đủ của đơn SAU khi cập nhật (SAU CÙNG lần gọi `updateField()` cuối, xem cơ chế bên dưới), rút gọn các field liên quan):
```json
{
  "success": true,
  "data": {
    "productionId": "RR-03884-24456",
    "toolResult": "has-tool",
    "toolResultNote": "error",
    "errorFile": ["vien-co", "lech-mau"],
    "errorFileNote": "Tay áo bị lệch mẫu, cần kiểm tra lại",
    "designerStatus": "unassigned"
  }
}
```

**Cơ chế:** `setDesignReviewResult()` resolve `productionId` → `_id` (exact match case-insensitive, giống `getByProductionId`), rồi gọi **nguyên vẹn** `updateField()` — 1 lần cho `toolResult` (KHÔNG có side-effect hook nào, không đụng `readyForFulfill`, không auto-assign designer, không rework-back — chỉ là 1 field workshop_config đơn thuần), và nếu request có truyền `toolResultNote` (kiểm tra `!== undefined`, phân biệt với "không truyền") thì gọi THÊM 1 lần `updateField()` nữa cho field đó — CÙNG nhánh side-effect hook với sửa tay ở Danh sách đơn (`dto.field === 'toolResultNote'` trong `updateField()`: set `readyForFulfill`, auto rework-back về tool-check/designer, hoặc entry vào fulfillment tùy trạng thái đơn trước đó, VÀ auto-gán designer theo cấu hình xưởng nếu giá trị ĐÚNG BẰNG `'error'` (`TOOL_CHECK_ERROR_CODE`) — mã khác != 'ok' như `'no-tool'`/`'no-pdf'` KHÔNG tự gán — `autoAssignAfterImport`, xem `DesignerAutoAssign.md`; trước đây path này có ngoại lệ `opts.skipAutoAssign: true` khiến đơn KHÔNG tự có assignee — đã BỎ, tham số `skipAutoAssign` cũng đã xoá khỏi chữ ký `updateField()`), rồi nếu request có truyền `errorFile` (cùng kiểm tra `!== undefined`) thì gọi THÊM 1 lần `updateField()` nữa cho field đó (KHÔNG side-effect hook), rồi nếu request có truyền `errorFileNote` (cùng kiểm tra `!== undefined`) thì gọi THÊM 1 lần `updateField()` cho field đó (free text, KHÔNG side-effect hook, `assertValueAllowed` bỏ qua vì category=null), rồi nếu request có truyền `cuttingFileUrl` và/hoặc `tempFileUrl` (cùng kiểm tra `!== undefined` cho mỗi field) thì gộp field(s) có truyền vào **1 lần** `findOneAndUpdate()` riêng duy nhất (KHÔNG qua `updateField()` vì cả 2 không phải `OrderWorkshopField` — cùng cách `cuttingFileUrl` được set ở `applyCuttingFiles()`; `tempFileUrl` chỉ tồn tại ở path này). Response trả về kết quả của lần gọi/update CUỐI CÙNG đã chạy. Mọi lần gọi `updateField()` đều dùng role giả `SuperAdmin` để bypass permission gate (roleName chỉ được đọc ở đúng chỗ đó bên trong `updateField`, không ảnh hưởng business logic khác) và đều chạy `assertNotHeld` (đơn đang giữ → 409 — nếu 1 lần gọi trước đó đã thành công nhưng đơn bị giữ trước lần gọi kế tiếp, request sẽ dừng giữa chừng với các field trước đã lưu nhưng field sau chưa). Riêng `cuttingFileUrl`/`tempFileUrl` set thẳng bằng `findOneAndUpdate()` nên **KHÔNG** chạy `assertNotHeld` — đơn đang giữ vẫn lưu được 2 field này.

### 18.8 Performance
1 `findOneAndUpdate` (GET `/next`) với index sẵn có trên `toolResultNote`/`designerStatus`/`priority`/`cancelledAt`/`heldAt`/`designReviewClaimedAt` (đều đã đánh index ở `order.entity.ts`) — không cần index tổng hợp riêng vì volume đơn ở bước đầu tiên thường nhỏ. GET `/error-file-options` là 1 query `find()` nhỏ trên `workshopConfigs` (đã có unique index `{category,code}`, volume category này rất nhỏ) — không cần cache riêng. POST `/result` tái dùng `updateField()` nên chi phí giống hệt sửa tay 1 cell (1-3 lần gọi tuần tự tùy số field truyền).

## 19. "Không xác định xưởng" — tách đơn chưa map xưởng khỏi hệ thống (menu tạm)

> **Mục tiêu:** Đơn không có `factoryId` (không khớp Product Config lúc import, và không có Customer Override cứu — xem `importOrders()`) trước đây bị trộn lẫn vào mọi view. Nay bị **loại trừ mặc định** khỏi toàn bộ Danh sách đơn / Dashboard / task Designer / Fulfillment override view / Nhật ký bù lỗi / Soát tool / Lỗi theo người — chỉ xem được qua 1 menu tạm riêng.

### 19.1 Cơ chế lọc (backend)
- Không có entity field mới — vẫn dùng `factoryId` missing/null như trước, qua filter param sẵn có `unmapped: z.coerce.boolean()` trong `GetProductionOrdersZod` (`production-order.dto.ts`).
- `order.service.ts` → `buildVisibilityFilter()` (dùng chung bởi `getOrders`/`getOrdersGroupedByType`, `getStatusOverview`, `getDesignerBreakdown`, `getDesignerBacklog`): thêm `factoryId: { $exists: true, $ne: null }` mặc định, **trừ khi** `dto.unmapped === true` (trang mới opt-in xem CHỈ đơn unmapped qua chính flag này).
- Áp cùng pattern (`factoryId: { $exists: true, $ne: null }` vào base match) cho các hàm không dùng chung `buildVisibilityFilter`: `getDashboard`, `getLifecycleOverview`, `getCancelledOrders`, `getErrorLog` (`order.service.ts`); `getMyTasks`/`buildMyTaskBase` nhánh override-role (`fulfillment-task.service.ts`); `getToolCheckOverview`, `getPersonErrorOverview`, `getStageErrorDaily`, `getAssignBacklog`, `getDailyOverview`, `getErrorStats` (`designer-stats.service.ts`).
- **Không đụng** `designer-task.service.ts` (`getMyTasks`/`buildMyTaskFilter`) — chỉ lọc theo `assignee` (đơn ĐÃ gán); đơn unmapped không có `factoryId` nên auto-assign (`designer-assignment.service.ts`) không bao giờ set `assignee` cho nó.
- `getFactoryOverview` (tab Dashboard "Đơn hàng theo xưởng"): bỏ hẳn `unmappedCount`/`totals.unmapped` (không còn tiêu thụ ở FE) — `matchMapped`/`cardMatch` giữ nguyên logic cũ (đã đúng từ trước).

### 19.2 Endpoint
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/v1/orders?unmapped=true` | `getOrders` — trả đúng tập đơn chưa map xưởng, tái dùng nguyên vẹn. |
| PATCH | `/v1/orders/bulk-assign` | `bulkAssignOrders` (`BulkAssignOrderDto`) — gán xưởng + fabric/machine/tool mặc định ban đầu cho đơn đã chọn. |
| POST | `/v1/orders/remap-unmapped` | `remapUnmappedOrders()` — nút **"Tự động gán xưởng"**: re-map TOÀN BỘ đơn unmapped theo Product Config HIỆN TẠI (`@Auth(ORDER_WRITE_ROLES)`, không body). Khớp `type` ↔ `fullName` exact case-insensitive (iterate `distinct('type')` của tập unmapped, lookup map config load 1 lần) → set đủ bộ như import: `isMapped`/`productConfigId`/`factoryId`/`originalFactoryId`/`machineTypeId`; riêng `fabricType`/`machineNumber` chỉ điền khi đơn đang TRỐNG (tôn trọng chỉnh tay — cùng tinh thần insert-only của `importOrders`). Ghi `orderLog` action `bulk_update` (reason "Tự động gán xưởng theo Product Config") + invalidate cache. Res `RemapUnmappedOrdersResDto`: `{ scanned, matchedTypes, assigned }`. Dùng sau khi tạo config từ cột "Chưa xác định xưởng" ở kanban Settings (`Products.md §2.6`). |

### 19.3 Frontend
- Trang: `apps/web/src/pages/orders/unmapped/index.tsx` (route `PATHS.ORDERS_UNMAPPED = '/orders/unmapped'`). Guard quyền y hệt `scan-error`: `!isAdmin && !has('page.unmapped_factory')` → `<Navigate to={PATHS.ORDERS} />`.
- Tái dùng nguyên bộ component bảng workshop: `WORKSHOP_COLS`/`buildColGroups`/`GroupCellContent` (`workshopTableConfig.tsx`), `OrderFilterBar`, `OrderRowActionsMenu`, `PaginationBar`, `ImagePreviewDialog`, `OrderLogTimelineDialog` — không viết bảng mới.
- Dialog "Gán xưởng" được **extract** từ `OrderFactoryTab.tsx` (trước đây gắn với chip "Chưa xác định xưởng" đã bỏ) sang `apps/web/src/components/orders/AssignFactoryDialog.tsx` — tự fetch danh sách xưởng qua `RepositoryRemote.factory.getFactories()` (không còn phụ thuộc `getFactoryOverview`). Nút "Gán xưởng" (đơn lẻ + bulk) gate bởi `isAdmin || has('order.transfer')`.
- Sidebar: child "Không xác định xưởng" trong group "Quản lý đơn" (`Sidebar.tsx`, icon `MapPin`), gate `perm: 'page.unmapped_factory'`.
- Nút **"Tự động gán xưởng"** (icon `Wand2`, màu emerald, đặt cạnh counter ở `topActionsRight` của `OrderFilterBar`, gate `isAdmin || has('order.transfer')` như nút Gán xưởng) → `POST /v1/orders/remap-unmapped` → toast i18n `unmapped.autoAssignDone` (`{{assigned}}`/`{{types}}`) hoặc `unmapped.autoAssignNone` khi không đơn nào khớp → refetch bảng.
- **Facet "Sản phẩm"** (label i18n `unmapped.productFacet`) — dropdown `SelectFilter` qua prop `facets` của `OrderFilterBar`: thống kê từng `type` + số đơn trong tập unmapped (option "Tất cả (tổng)"), nguồn từ `GET /orders/workshop-filters?unmapped=true` (facet `type` sẵn có, scoped theo `search` hiện tại), chọn 1 sản phẩm → truyền param `type` sẵn có của `getOrders`. Facet refetch cùng lúc reload/gán xưởng/auto-gán; reset kèm tín hiệu sidebar (`fType`).

### 19.4 Permissions
- `page.unmapped_factory` (mới, group `page`) — Admin/SuperAdmin/Manager có sẵn qua `ALL_PERMISSION_CODES`; Support được cấp thêm trong `DEFAULT_ROLE_PERMISSIONS` (kèm `order.transfer` để nút "Gán xưởng" hiện ra — trước đó Support không có quyền này).

## 20. Click lại menu sidebar đang active → xóa filter (cross-cutting UX)

> **Vấn đề:** React Router coi click `<Link>` trỏ tới URL hiện tại là no-op — không điều hướng, không remount, không re-render. Trước đây click lại đúng menu đang đứng (vd đang lọc dở "Danh sách đơn" rồi bấm lại "Danh sách đơn") không có tác dụng gì.

**Cơ chế chung** (`apps/web/src/store/sidebarResetStore.ts` + `apps/web/src/hooks/useSidebarResetSignal.ts`):
- `sidebarResetStore` (Zustand, không persist): `{ path, nonce, requestReset(path) }` — `requestReset` set `path` + tăng `nonce`.
- `Sidebar.tsx` → `SidebarLeaf`: `<Link onClick={() => { if (active) requestReset(item.to); }}>` — CHỈ bắn tín hiệu khi item đang **active** (dùng lại `isLinkActive()` sẵn có), không đụng hành vi Link click bình thường khi chưa active.
- Trang cần phản ứng gọi `useSidebarResetSignal(path, onReset)` — `path` PHẢI khớp CHÍNH XÁC chuỗi `to` khai báo trong `NAV_GROUPS` (kể cả query string, vd `${PATHS.HOME}?tab=factory`). Hook chỉ chạy `onReset` khi `resetPath === path` VÀ `nonce` vừa tăng — không fire lúc mount.
- **Không tự động remount qua `key`** — mỗi trang tự định nghĩa "xóa filter" nghĩa là gì (set lại state về default), không có universal "reset toàn bộ component state".

**Đã wire** (path khớp `NAV_GROUPS`, hàm reset gọi qua `useSidebarResetSignal`):
| Sidebar item | Trang | Hàm reset |
|---|---|---|
| Danh sách đơn | `OrderTableWorkshop.tsx` | `clearAllFilters()` (đã có sẵn, dùng lại nguyên) |
| Nhật ký bù lỗi | `ErrorLogTab.tsx` | `clearAllFilters()` (mới thêm — reset `tab`/`search`/`createdFrom`/`createdTo`/5 filter dropdown/`selected`/`page`) |
| Không xác định xưởng | `pages/orders/unmapped/index.tsx` | inline — reset `search`/`selected`/`page` |
| Task Fulfillment | `pages/fulfillment/my-tasks/index.tsx` (`FulfillmentKanbanView`) | inline — reset `search`/`filters`/`dateFrom`/`dateTo`/`selected` (`dayFilter` tự clear qua effect có sẵn khi đổi ngày) |
| Task của tôi | `pages/designer/my-tasks/index.tsx` | inline — reset `search`/`filters`/`dateFrom`/`dateTo`/`selected` |
| Hướng dẫn DTF | `pages/guide/dtf/index.tsx` | inline — bỏ `?role=` (về vai của tài khoản) + cuộn lên đầu trang (trang không có filter; xem `DtfRoleGuide.md` §2.3) |

**CHƯA wire** (biết rõ, chưa làm — không phải bỏ sót):
- **Dashboard** (7 tab `?tab=...`) — mỗi tab filter riêng nằm trong component con (`OrderStatsTab`, `OrderStatusTab`, `OrderFactoryTab`, `LifecycleTab`, `ToolCheckTab`, `PersonErrorTab`, `DesignerStatsTab`) — cần khảo sát + sửa riêng từng tab, chưa làm trong lượt này.
- **`PrintWorkshopView.tsx`** (Fulfillment stage=Print, dùng `PrintOrderTable.tsx` filter riêng, KHÁC `FulfillmentKanbanView`) — chưa sửa.
- Các trang admin/CRUD/upload (Products, Workshop Config, Users, Import Order, Cutting Files...) — không phải dạng "danh sách filter" cùng pattern, không áp dụng.

Muốn thêm trang mới: import `useSidebarResetSignal` từ `@/hooks/useSidebarResetSignal`, gọi `useSidebarResetSignal(PATHS.XXX, resetFn)` với `resetFn` set lại mọi filter state về giá trị mặc định của trang đó.

## 21. Xưởng ngoài luồng sản xuất — loại đơn xưởng US khỏi mọi thống kê & luồng

> **Yêu cầu (2026-07):** đơn thuộc xưởng **US** không tham gia sản xuất tại chỗ → loại khỏi TOÀN BỘ thống kê + luồng, **chỉ hiển thị ở tab Dashboard "Đơn hàng theo xưởng"** (`getFactoryOverview` — KHÔNG áp exclusion) hoặc khi lọc tường minh `factoryId` = xưởng US.

### 21.1 Cơ chế nhận diện

`apps/api/src/utils/excluded-factory.ts`:
- `EXCLUDED_PRODUCTION_FACTORY_SHORT_NAME = 'US'` (hardcode theo yêu cầu — đổi xưởng ngoài luồng thì sửa constant này).
- `loadExcludedFactoryId(db)` — resolve `_id` xưởng từ collection `factories` theo shortName, await tại `OrderService.onModuleInit()` trước mọi backfill/traffic.
- `getExcludedFactoryIdSync(db)` — đọc sync từ cache module-scope (TTL 5 phút, tự refresh nền) vì các builder filter là hàm sync; cache dùng CHUNG cho order / designer-stats / designer-task / fulfillment-task service.
- `productionFactoryClause(db)` — clause chuẩn thay cho pattern unmapped cũ: `{ $exists: true, $nin: [null, <usId>] }` (fallback `{ $exists: true, $ne: null }` khi chưa có xưởng US).

### 21.2 Điểm áp dụng (exclusion)

| Nhóm | Vị trí |
|------|--------|
| Danh sách đơn + facets + mọi consumer `buildVisibilityFilter`/`buildOrderListFilter` (getOrders, grouped, workshop-filters, status-overview, designer-breakdown/backlog, export...) | `order.service.ts` → `buildVisibilityFilter()` default clause dùng `productionFactoryClause` |
| Dashboard Stats (`getDashboard`), Vòng đời (`getLifecycleOverview`), Đơn hủy (`getCancelledOrders`), Nhật ký bù lỗi (`getErrorLog`) | default `match.factoryId` từng hàm |
| Soát tool (`GET /orders/design-review/next` + `remaining`) | `getNextDesignReviewOrder()` baseFilter thêm `factoryId: { $ne: usId }` (đơn CHƯA map xưởng vẫn vào queue như cũ) |
| Auto-gán designer | `autoAssignAfterImport()` → `byFactory.delete(usId)` — kể cả khi Admin lỡ cấu hình designer cho US |
| Entry fulfillment (đơn không được đẩy vào stage In) | 3 chỗ: `updateField('toolResultNote'='ok')` + `importRework` (guard trước `buildFulfillmentEntrySet()`), `designer-task.service.ts` → `applyCompleteFulfillmentHook()` early-return (transition + bulkTransition, projection bulk thêm `factoryId`); + backfill `onModuleInit` orphan-forward thêm `factoryId: productionFactoryClause` |
| Task Fulfillment view override-role | `fulfillment-task.service.ts` → `buildMyTaskBase()` nhánh không khóa xưởng |
| Designer stats/backlog/tool-check/person-error/stage-error/daily-overview | `designer-stats.service.ts` — mọi chỗ `factoryId: { $exists: true, $ne: null }` → `productionFactoryClause` (9 điểm) |

### 21.3 Ngoại lệ: Danh sách đơn classic (ORD-19)

> Người dùng chỉ thị 2026-08-22: *"ở danh sách đơn classic, hiển thị toàn bộ đơn bao gồm cả đơn xưởng us nha"*.

Trang `/orders/classic` (`OrderTableClassic.tsx`) — **và chỉ trang đó** — hiển thị cả đơn xưởng US.

Cách làm: cờ **theo từng request** `GetProductionOrdersDto.includeExcludedFactory`. FE gắn cờ trong `buildFilterParams()` của `OrderTableClassic`; BE đọc ở `buildVisibilityFilter()` → clause `factoryId` thành `{ $exists: true, $ne: null }` thay cho `productionFactoryClause`.

Cờ phân giải bằng `BooleanFlagZod` (`packages/shared/constants/common-zod.ts`), **không phải** `z.coerce.boolean()`. Từ ORD-23, sáu cờ lọc khác của cùng DTO dùng chung helper này — xem §22. `z.coerce.boolean()` theo luật truthy của JavaScript nên mọi chuỗi khác rỗng đều thành `true`: gửi `includeExcludedFactory=false` — cách tự nhiên nhất để nói "đừng gộp" — lại **gộp** đơn xưởng US vào danh sách mà không báo lỗi gì (ORD-21, TEST đo được 39.906 thay vì 39.606). Luật: bật với `true`/`1`; tắt với `false`/`0` và mọi giá trị lạ; không gửi hoặc gửi rỗng → `undefined`. Giá trị lạ **không** ném 400 — trả về mặc định an toàn là loại đơn US. Khoá bằng `apps/api/src/modules/order/order-query-flags.spec.ts`.

**Vì sao là cờ theo request chứ không nới ở hàm dùng chung:** `GET /orders` + `buildOrderListFilter` còn phục vụ drill-down từ dashboard và nhiều bề mặt khác; nới ở đó thì danh sách drill lệch với số dashboard **mà không báo lỗi**. HF-2 (2026-08-21) đã nới diện rộng đúng kiểu đó và bị người dùng rút lại (khôi phục ở HF-3, commit `6d361fb`) — đọc §21.4 trước khi định mở rộng thêm.

Cờ này **chỉ mở đúng một nhóm**. Hai loại-trừ còn lại giữ nguyên ở trang classic:

| Nhóm | Ở trang classic |
|---|---|
| Đơn xưởng US | **hiện** |
| Đơn đã hủy (`cancelledAt`) | vẫn ẩn — chỉ hiện khi bật toggle "Đã hủy" |
| Đơn chưa map xưởng | vẫn ẩn — chỉ xem ở `/orders/unmapped` |

Đo trên DB local (2026-08-22): không cờ 39.606 đơn → có cờ 39.906, chênh đúng 300 = số đơn xưởng US. Giao lại tập kết quả classic: ∩ đơn hủy = 0, ∩ chưa map xưởng = 0, ∩ xưởng US = 300. Lọc tường minh `factoryId` vẫn ghi đè sau clause mặc định nên chọn xưởng ML không lẫn đơn US.

### 21.4 Những gì GIỮ NGUYÊN

- `getFactoryOverview` (tab "Đơn hàng theo xưởng") — US vẫn hiện card/số liệu đầy đủ.
- Lọc tường minh `factoryId` (drill từ tab xưởng, dropdown xưởng ở Danh sách đơn/Lifecycle) — `buildOrderListFilter` ghi đè `filter.factoryId = dto.factoryId` SAU default clause → chọn đúng xưởng US vẫn xem được đơn (escape hatch, cùng semantics trang unmapped).
- Dashboard / thống kê / soát tool / auto-gán designer / entry fulfillment — KHÔNG caller nào trong nhóm này gửi `includeExcludedFactory`, và `getStatusOverview` còn dựng dto mới (`{ createdFrom, createdTo }`) nên cờ không thể lọt vào. Clause mặc định của chúng không đổi một ký tự nào sau ORD-19.
- Import đơn: đơn US vẫn import + map factory bình thường (chỉ không đi tiếp vào luồng).
- Worker Fulfillment gắn xưởng US (nếu có): nhánh khóa-xưởng của `buildMyTaskBase` không áp exclusion — nhưng đơn US không bao giờ được init stage nên my-tasks rỗng.


## 22. Cờ boolean trên query string — `BooleanFlagZod`

`z.coerce.boolean()` **không dùng được** cho cờ trên query string: nó theo luật truthy của JavaScript nên mọi chuỗi khác rỗng đều thành `true`, kể cả `'false'`, `'0'`, `'no'`. Một tham số mà `false` lại có nghĩa `true` là bẫy đặt sẵn cho người viết màn hình sau và cho chính người đang gỡ lỗi bằng cách sửa URL.

Luật của `BooleanFlagZod` (`packages/shared/constants/common-zod.ts`): bật với `true`/`1`; tắt với `false`/`0` và **mọi giá trị lạ**; không gửi hoặc gửi rỗng → `undefined`, giữ nguyên nghĩa optional. Giá trị lạ **không** ném 400 — trả về mặc định an toàn, vì ném lỗi sẽ làm hỏng những nơi đang lỡ gửi giá trị lạ.

**Cờ đã chuyển sang helper này** (ORD-21 + ORD-23) — đo trên DB local, gửi `false`:

| Cờ | Trước (số đơn) | Sau | Mặc định |
|---|---|---|---|
| `includeExcludedFactory` | 39.906 (gộp cả đơn xưởng US) | 39.606 | 39.606 |
| `unmapped` | **0** (đảo hẳn sang tập đơn chưa map xưởng) | 39.606 | 39.606 |
| `cancelled` | 159 (chỉ đơn hủy) | 39.606 | 39.606 |
| `held` | 0 (chỉ đơn đang giữ) | 39.606 | 39.606 |
| `hasError` | 941 | 39.606 | 39.606 |
| `designBacklog` | 3.519 | 39.606 | 39.606 |
| `needDesigner` | 11.315 | 39.606 | 39.606 |

Giao diện chỉ gửi `'true'` hoặc `'1'` cho cả bảy cờ, nên đổi sang helper **không làm màn hình nào đổi kết quả** — đã rà từng chỗ `params.set` trước khi sửa (ORD-23 bước 1).

`held` là cờ **ba trạng thái** thật (`getOrders` kiểm `typeof dto.held === 'boolean'`): `false` nghĩa là *chỉ đơn KHÔNG giữ*, khác hẳn *không lọc*. Vì vậy chuỗi rỗng phải ra `undefined` chứ không phải `false` — nếu không, `held=` sẽ lọc mất đơn đang giữ thay vì không lọc gì.

**Cùng tên cờ thì phải cùng hành vi.** `hasError` và `unmapped` còn một bản khai thứ hai ở `GetFactoryOverviewZod` (tab Dashboard "Đơn hàng theo xưởng") — cả hai cũng đã chuyển sang `BooleanFlagZod`. Để một bản đúng và một bản còn bẫy là cái bẫy khó ngờ nhất: cùng một tham số, hai endpoint, hai kết quả. Trước khi sửa, `unmapped=false` thu hẹp cả tab xuống **0 đơn** — dashboard trắng trơn mà không báo lỗi.

Khoá bằng `apps/api/src/modules/order/order-query-flags.spec.ts` (35 ca), trong đó có bộ ca so THẲNG kết quả phân giải của hai DTO với nhau.

**`isMapped` (ORD-24) — cờ duy nhất mà giao diện THẬT SỰ gửi `'false'`,** ở `ListOrderTab.tsx:424` (nút "Chưa mapping"). Nên nó không phải bẫy tiềm ẩn mà là lỗi **đang sai**: chọn "Chưa mapping" trả về đơn **đã** mapping. Đo trên DB local: `isMapped=false` trả 39.423 đơn (đã map) thay vì 187 đơn (chưa map). Sau ORD-24: `true` → 39.423, `false` → **187**, hai tập **rời nhau** và cộng lại đúng bằng 39.610 khi không lọc.

Lưu ý về nghĩa: `isMapped` là cờ **map product config**, KHÔNG phải map xưởng — hệ hiện có 187 đơn `isMapped:false` nhưng **0** đơn thiếu `factoryId`. Hai khái niệm liên quan nhưng không bằng nhau; muốn lọc đơn chưa map xưởng thì dùng `unmapped` (trang `/orders/unmapped`).

**Quét nốt phần còn lại (ORD-28).** Đếm bằng mã nguồn: đúng **21 cờ** `z.coerce.boolean` còn lại — 16 trên query string, 5 trong thân JSON.

| Nhóm | Kết luận |
|---|---|
| `readyForFulfill` (`GetOrderStatusOverviewZod`) | **ĐÃ SỬA — đang sai thật.** `useStatusFilter.ts` gửi `String(value)` = `'false'`, nên chọn *"chưa sẵn sàng"* trả về nhóm *"đã sẵn sàng"*. Sau khi sửa: `false` → 4.145 đơn thay vì 35.411; hai tập rời nhau, cộng lại đúng 39.556 |
| `isActive` × 5 (`GetCollections`/`GetFactories`/`GetMachineTypes`/`GetProductCategories`/`GetWorkshopConfigs`) | **ĐÃ SỬA — bẫy chưa nổ.** Service kiểm `typeof === 'boolean'` nên `false` có nghĩa riêng; hiện chưa service FE nào gửi cờ này, nên đổi không làm màn hình nào đổi kết quả |
| `deleted` (`GetCustomersZod`), `hasError` (`GetOrderStatusOverviewZod`) | **GIỮ NGUYÊN — đang đúng.** Nơi gọi bỏ hẳn tham số khi tắt (`showDeleted \|\| undefined`, `set('hasError','true')`) |
| `held` (`GetCustomerStagingOrdersZod`) | **GIỮ NGUYÊN.** `customerPortal.ts:53` dùng `if (filters?.held)` nên `false` không bao giờ lên URL; service cũng chỉ kiểm truthy |
| 7 cờ trên DTO CHẾT: `isReferrerOrder` ×2, `scan`, `isExport` (`GetOrdersZod`/`GetOrderStatisticsZod`), `overdue3/5/30Days` (`GetTrackingsZod`) | **GIỮ NGUYÊN.** Không controller nào dùng ba DTO này |
| 5 cờ trong THÂN JSON: `scanTracking` ×4 (dropship/stock), `forcePassChange` (`UserZod`) | **GIỮ NGUYÊN.** Thân JSON mang boolean thật nên `z.coerce.boolean(false)` ra `false` — đúng. Đã tìm nơi gửi chuỗi `"false"` trong thân: không có |

Khoá bằng `apps/api/src/modules/order/query-flags-sweep.spec.ts` (30 ca). `isMapped` đáng chú ý nhất: `ListOrderTab.tsx:424` gửi thẳng chuỗi `'false'` — chỗ **duy nhất** trong FE làm vậy — nên bộ lọc "Chưa map xưởng" ở tab đó trả về đúng điều ngược lại. Tab đó hiện đang tắt; bật lại thì phải sửa cờ này trước.

---

## 23. "Chuyển hoàn thành" (SuperAdmin) — ép đơn về đã hoàn thành sản xuất

> **File FE:** `apps/web/src/components/orders/{OrderRowActionsMenu,ForceCompleteDialog}.tsx`, `apps/web/src/utils/orderActions.ts` (`canForceComplete`/`canForceCompleteOrder`), `apps/web/src/services/order.ts` (`forceCompleteOrder`)
> **File BE:** `apps/api/src/modules/order/force-complete-plan.ts` (`planForceComplete`) + `order.service.ts` → `forceCompleteOrder()`; `order.controller.ts` → `POST /:id/force-complete`
> **API:** `POST /v1/orders/:id/force-complete` — `@Auth([RoleType.SuperAdmin])`, không body

### 23.1 Overview

Mục **"Chuyển hoàn thành"** trong menu "..." mỗi hàng đơn (§16.4 — cùng cột thao tác pin phải), **CHỈ SuperAdmin** thấy. Bấm → dialog xác nhận → đơn được đánh dấu **đã hoàn thành sản xuất**, và **các khâu chưa xong được điền mốc thời gian chia đều** trong khoảng `[đơn vào sản xuất → lúc bấm]`, theo đúng luồng của xưởng đang giữ đơn.

Đây là **cửa sửa dữ liệu**, không phải một bước của quy trình: dùng cho đơn đã xong ngoài đời nhưng xưởng quên bấm, để nó thôi treo trên Dashboard / Lifecycle / banner quá hạn (`OverdueAlertBanner.md`) / các hàng đợi soát tool + cần gán designer.

Vì thế quyền **hẹp hơn cả Admin** (`RoleType.SuperAdmin`), enforce 2 lớp: `@Auth([SuperAdmin])` ở route **và** check lại `roleName !== SuperAdmin → ForbiddenException` trong service.

### 23.2 Chia mốc thời gian (`planForceComplete` — hàm thuần, test không cần DB)

Chuỗi khâu xét theo thứ tự dòng chảy: `tool-check` → `designer` → 6 công đoạn `FULFILLMENT_STAGES`.

| Quy tắc | Vì sao |
| --- | --- |
| Chỉ điền khâu **chưa xong**; khâu đã có mốc thật giữ nguyên | Không ghi đè lịch sử có thật |
| Mốc bắt đầu = `max(inProductionAt, mốc thật cuối cùng trên đơn)`, kẹp ≤ `now` | Nếu chia từ `inProductionAt` khi In đã xong lúc 05:00 thì "Ép" sẽ xong **trước** "In" — chuỗi thời gian chạy ngược |
| Khâu cuối đóng đúng `now` (lấy thẳng `now`, không cộng dồn `n × slice`) | Sai số chia không được đẩy mốc cuối lệch khỏi `fulfillmentCompletedAt` |
| Khâu **tự-hoàn-thành** của luồng rút gọn (`FACTORY_FLOW_AUTO_STAGES`) **không chiếm lát nào**, đóng cùng mốc khâu ngay trước | Y như khi chạy thật (§ FulfillmentWorkflow.md 2.2b): xưởng gỗ Ép dính vào In, May ra dính vào May vào; xưởng no-sew May vào + May ra dính vào QC sau ép |
| Thiếu `inProductionAt` → lùi `orderAt` → `createdAt`; hết đường thì **mọi mốc = lúc bấm** | Thà cụm lại một chỗ còn hơn bịa ra một quá khứ không có căn cứ |

Ví dụ đơn chưa làm gì, vào sản xuất 00:00, bấm lúc 08:00, xưởng `standard`: 8 khâu × 1 tiếng — `tool-check` xong 01:00, `designer` 02:00, … `pack` 08:00.
Cùng đơn đó ở xưởng `merged`: chỉ 6 khâu chiếm lát (Ép + May ra ăn theo) → mỗi khâu 80 phút.

### 23.3 Ghi gì vào đơn

- **Công đoạn fulfillment:** `status='done'`, `completedAt` = mốc cuối lát; `waitingAt`/`startedAt`/`firstStartedAt` chỉ điền **khi còn trống** (= mốc đầu lát). Công đoạn chưa từng kích hoạt → khai `reworkCount: 0` + `workMs: 0`.
- **`workMs` KHÔNG bịa** — công đoạn được ép giữ nguyên 0. Số giờ làm việc của xưởng không được phình lên vì một lần sửa dữ liệu.
- **Kết thúc:** `currentFulfillmentStage = null`, `fulfillmentCompletedAt = now`.
- **Hai chặng trước fulfillment** (nếu còn dở): `toolCheckedAt` + `toolResultNote='ok'` (chỉ khi trống — **KHÔNG** đụng `toolResult` vì field đó giữ mã `workshop_config`, bịa vào là dựng mã không tồn tại); `designerStatus='done'` + `designerCompletedAt`, các mốc designer khác chỉ điền khi trống. Đơn "hoàn thành sản xuất" mà vẫn nằm trong hàng đợi soát tool / backlog cần gán designer là trạng thái tự mâu thuẫn — và chính mấy hàng đợi đó là thứ người dùng muốn dọn khi bấm nút này.
- **`fulfillmentTimeline`:** 1 dòng cho mỗi công đoạn được điền (`action='complete'`, `byUserId`/`byUserName` = người bấm, `reason='Chuyển hoàn thành'`, khâu tự động ghi `'Chuyển hoàn thành (luồng rút gọn)'`) — nhìn lịch sử là biết đơn được ép, không phải xưởng làm.
- **OrderLog:** action mới **`force_complete`** (`ORDER_LOG_ACTIONS`), `field='fulfillmentCompletedAt'`, `before` = chặng đơn đang đứng, `after` = `{ completedAt, start, steps[] }` — đủ để dựng lại chính xác thao tác.
- **Sự kiện khách:** emit `order.production_completed` y như lúc xưởng bấm xong thật → webhook khách (ORD-4) + chuông portal (ORD-5) không phân biệt đơn xong thật với đơn chốt tay.

Ghi **thẳng** vào đơn thay vì đi qua `FulfillmentTaskService.transition()`: transition đòi đúng người giữ công đoạn và đúng thứ tự `waiting → in-progress → done`, tức phải giả lập hàng chục lượt bấm mới đi hết 6 công đoạn.

### 23.4 Guard

`OrderService.forceCompleteOrder` chặn: không phải SuperAdmin (403) · đơn đã hủy · đơn **đang giữ** (`assertNotHeld` — mở giữ trước rồi mới chốt) · đơn đã có `fulfillmentCompletedAt`. FE mirror ở `canForceCompleteOrder` (`orderActions.ts`) để disable mục menu + hiện lý do trong tooltip — sửa 1 nơi phải sửa cả 2.

### 23.5 Test

`apps/api/src/modules/order/force-complete-plan.spec.ts` — 8 ca trên hàm thuần: chia đều đủ 8 khâu, mốc liền mạch + không lọt ra ngoài khoảng, không đụng khâu đã xong, hai luồng rút gọn (`merged`/`no-sew`), thiếu `inProductionAt`, mốc bắt đầu ở tương lai, và ca "có `toolCheckedAt` nhưng `toolResultNote` trống".

---

## 24. Cột "Trạng thái" — đơn đang nằm ở chặng nào

> **File FE:** `apps/web/src/utils/orderStatusLabel.ts` (`getOrderStatusInfo` + `makeOrderStatusTranslate` + `ORDER_STATUS_TONE_CLASS`), cột `orderStatus` trong `apps/web/src/components/orders/workshopTableConfig.tsx` (thuộc group `identity`), cell trong `apps/web/src/pages/orders/ListOrderTab.tsx`, i18n `orders.json` → `statusLabel.*` + `workshopCols.col/short.orderStatus`.

### 24.1 Vì sao có cột này

Bảng đơn trước đây chỉ cho thấy **từng mảnh** trạng thái nằm rải ở nhiều cột: `toolResult`/`toolResultNote` (soát tool), `designerStatus` (thiết kế), `printStatus` (in) — người xem phải tự ghép mới biết đơn **đang** kẹt ở đâu. Cột `orderStatus` trả lời thẳng câu đó bằng **1 nhãn**.

Field `status` gốc trên `OrderEntity` (free-text từ file import) KHÔNG dùng được cho việc này: nó đứng im từ lúc nhập, không phản ánh tiến độ sản xuất. Ở `ListOrderTab` nó bị hạ xuống dòng phụ nhỏ dưới nhãn mới.

### 24.2 Luật suy trạng thái

`getOrderStatusInfo(row, tr)` tính **hoàn toàn từ field `GET /v1/orders` đã trả sẵn** — không endpoint mới, không query thêm:

1. `cancelledAt` → **Đã hủy** (đỏ).
2. `fulfillmentCompletedAt` → **Hoàn thành** (xanh lá).
3. Ngược lại, xác định chặng đang active — **MIRROR `computeCurrentStage()`** (`customer-order.service.ts`, dùng cho Customer Portal + trang tra cứu công khai `/track`):
   - `currentFulfillmentStage` set → chặng đó (index `2 + FULFILLMENT_STAGE_ORDER[stage]` trong `LIFECYCLE_STAGE_KEYS`);
   - còn không, `designerStatus` khác `unassigned` → `designer` (hoặc `print` khi `done`);
   - còn không, `toolResultNote` rỗng → `tool-check`, có giá trị → `designer`.
4. Trạng thái CON trong chặng (phần bản FE có thêm so với BE — người trong xưởng cần biết đơn kẹt **kiểu gì**, không chỉ kẹt **ở đâu**):
   - chặng `designer`: theo `designerStatus` → Đã giao / Đang thiết kế / Làm lại (vàng) / Không làm được (đỏ) / Chờ (chưa gán);
   - 6 chặng fulfillment: theo `fulfillmentStages[key].status` → `waiting` = Chờ · `in-progress` = Đang · `rework` = Làm lại (vàng).

> Đổi luật ở `orderStatusLabel.ts` thì **phải đổi cả `computeCurrentStage()`** — cùng 1 đơn mà bảng nội bộ và trang khách nói hai chuyện khác nhau là lỗi nghiệp vụ, không phải khác biệt giao diện.

**Hold CỐ Ý không nằm trong nhãn này.** Giữ đơn là cờ *chồng lên* chặng (gỡ giữ thì đơn về đúng chặng cũ), đã có `HeldBadge` riêng cạnh mã đơn — nhét vào đây sẽ mất thông tin đơn đang kẹt ở chặng nào (§9b).

### 24.3 Màu (`tone`)

`neutral` xám = đang chờ người làm · `active` chàm = có người đang làm · `warn` vàng = phải làm lại · `danger` đỏ = hủy / không làm được · `success` xanh lá = hoàn thành. Class Tailwind tra ở `ORDER_STATUS_TONE_CLASS` (đủ cặp light/dark).

### 24.4 Vì sao truyền hàm dịch thay vì `t`

`render()` của `WorkshopColMeta` là **hàm thường, không phải component** → không gọi được `useTranslation`, và `ctx.t` là optional (consumer ngoài batch i18n vẫn gọi `c.render(row, ctx)` không kèm `t`). Nên `getOrderStatusInfo` nhận `OrderStatusTranslate` — cùng khuôn với helper `tr()` sẵn có trong `workshopTableConfig.tsx`; `makeOrderStatusTranslate(ctx.t)` bọc lại, thiếu `t` thì fallback chuỗi tiếng Việt (có tự nội suy `{{stage}}`).

### 24.5 Nơi hiển thị

Cột nằm trong group `identity` (`memberKeys: productionId, orderStatus, priority, userSku, typeFullName`) nên tự có mặt ở **mọi bảng dùng `buildColGroups`**: Danh sách đơn (`/ffm/orders/workshop`), Đơn hàng classic (`/ffm/orders/classic`), Dashboard tab Trạng thái (`OrdersMiniTable`) và tab Xưởng (`OrderFactoryTab`). `perm: null` — mọi role xem được bảng đơn đều thấy, vì nhãn chỉ tổng hợp lại thứ họ đã đọc được ở các cột khác.

---

## 25. Phạm vi xưởng — bộ chọn trên header (`?factoryId=` là phạm vi dùng chung)

> **Đổi 07/09/2026:** 5 cụm menu riêng từng xưởng ở sidebar (mỗi xưởng Dashboard/Đơn hàng/Công việc) **đã GỠ** vì lặp 15 dòng. Thay bằng **`apps/web/src/components/header/FactoryScopeSwitch.tsx`** — nút "Xưởng: Tất cả ▾" cạnh tiêu đề trang, chỉ hiện ở `/ffm/*`: chọn xưởng = ghi `?factoryId=` lên URL hiện tại (xóa `wpage`/`cpage`/`page`), `useFactoryScope` VẪN là nơi duy nhất đọc. Cụm sản xuất chung ở sidebar dựng bằng `buildNavGroups(t, factoryScopeId)` → `buildProductionItems(t, id, '', scopeOnly=true)` nên mọi link **mang theo** `?factoryId=` đang chọn (đổi trang không mất phạm vi; `isLinkActive` so `factoryId` hai chiều nên vẫn sáng đúng mục). Badge tồn theo xưởng (`counts.byFactory` — trước treo trên cụm xưởng) nay nằm trong menu thả xuống (đỏ = lỗi cần xử lý, vàng = soát tool tồn); mục "Tất cả xưởng" mang số toàn hệ thống. Tài khoản Fulfillment (khóa xưởng) thấy chip tĩnh tên xưởng, không có menu. Xưởng US vẫn trong danh sách — lối duy nhất xem đơn US (§21). Phần dưới mô tả cơ chế URL/`useFactoryScope`/`FactoryScopeChip` vẫn đúng; đoạn nói về `buildProductionItems` với `keyPrefix`/relabel/hidden chỉ còn là code dự phòng, không còn nơi gọi với `scopeOnly=false`.

> **Yêu cầu (2026-09):** ngoài cụm sản xuất chung (Dashboard / Quản lý đơn / Công việc), **mỗi xưởng có một cụm menu riêng y hệt**; bấm vào là trang mở ra đã lọc sẵn xưởng tương ứng.

### 25.1 Phạm vi nằm trên URL, không nằm trong store

Mọi link của cụm xưởng mang thêm `?factoryId=<id>`; `apps/web/src/hooks/useFactoryScope.ts` là **nơi duy nhất** đọc ra phạm vi này.

Cố ý KHÔNG dùng store toàn cục: phạm vi ẩn trong store thì link gửi cho nhau mất xưởng, F5 mất xưởng, và tệ nhất là đang xem số của xưởng khác mà không có dấu hiệu gì. Hook trả thẳng `profile.factoryId` cho role `Fulfillment` — tài khoản đó bị khóa xưởng ở tầng API rồi, param có đổi cũng không đổi được dữ liệu.

### 25.2 Menu (`apps/web/src/components/sidebar/Sidebar.tsx`)

- `buildProductionItems(t, factoryId?, keyPrefix?)` — cụm sản xuất dựng **một lần, dùng hai chỗ**: `factoryId` rỗng → cụm chung (như trước); có `factoryId` → cụm của xưởng đó, `withFactory()` gắn param vào mọi link.
- Cụm xưởng chèn **ngay sau** nhóm có `id === PRODUCTION_GROUP_ID`. Không chèn theo index: nhóm nào cũng có thể bị quyền lọc mất, index sẽ trượt.
- Nguồn danh sách xưởng: `useFactoryOptionsStore` → `GET /factories/options` (`@Auth([])`, mọi tài khoản nhân viên). **KHÔNG dùng `GET /factories`** — route CRUD đó chỉ mở cho Admin/Manager/Support, Fulfillment/Designer sẽ ăn 403 và mất sạch cụm menu.
- Tài khoản có `factoryId` (Fulfillment) chỉ thấy cụm xưởng của mình.
- **Mục bị loại khỏi cụm xưởng** (không thuộc phạm vi một xưởng nào): `dash-designer` (designer không thuộc xưởng), `orders-scan-error` (thao tác tại trạm), `orders-stage-errors` (danh mục dùng chung), `orders-unmapped` (theo định nghĩa là đơn CHƯA có xưởng), `orders-import` + `orders-cutting-files` (nạp dữ liệu toàn hệ thống).
- **Nhãn rút gọn** trong cụm xưởng (tiêu đề cụm đã là tên xưởng): `sidebar.factoryScope.dashboard` ("Tổng quan"), `.overview` ("Tổng quan xưởng"), `.orders` ("Đơn hàng") — i18n namespace `layout`.
- **Badge của cụm xưởng đếm RIÊNG xưởng đó**, lấy từ `SidebarCounts.byFactory` (`GET /designer/sidebar-counts`) — tuyệt đối không dùng lại số tổng, treo số toàn hệ thống lên cụm xưởng thì ai cũng đọc thành số của riêng xưởng. Gồm `errorLogTodo` (Nhật ký bù lỗi) + `toolCheckRework`/`toolCheckUnreviewed` (Soát tool) — đúng các mục còn lại trong cụm. Key badge phải khớp `keyPrefix` = `factory-<id>-`.
  - BE: `OrderService.countErrorLogTodoByFactory()` (dùng chung `buildErrorLogBaseFilter` với badge tổng + trang, để 3 số không lệch) + `DesignerStatsService.getSidebarCountsByFactory()`. Mỗi con số là MỘT `$group` theo `factoryId`, không phải mỗi xưởng một lượt đếm.
  - Badge theo xưởng **KHÔNG** áp `productionFactoryClause` (bộ loại xưởng US): cụm menu xưởng US là lọc tường minh, badge phải khớp số trang đó mở ra chứ không phải luôn 0 (§21).
- Tiêu đề cụm xưởng in đậm hơn tiêu đề nhóm thường (`NavGroup.id === FACTORY_GROUP_ID`) — tên xưởng là thứ duy nhất phân biệt các cụm trùng hình dạng nhau.
- `resetPathOf()` cắt `factoryId` trước khi bắn tín hiệu reset filter (§20) — trang đăng ký tín hiệu bằng `to` gốc.
- **`isLinkActive` so khớp `factoryId` HAI CHIỀU** (khác mọi param khác chỉ kiểm "link ⊆ URL"): cụm chung và cụm từng xưởng dùng CHUNG đường dẫn, chỉ khác param này. Kiểm một chiều thì mục ở cụm chung luôn sáng kể cả khi đang xem 1 xưởng — 2 mục sáng cùng lúc và bấm mục chung trông như không có tác dụng.

### 25.3 Trang nào hiểu `factoryId`

| Trang | Cách áp |
| --- | --- |
| Dashboard → Thống kê (`OrderStatsTab`) | Truyền thẳng lên `GET /orders/dashboard?factoryId=` (field mới ở `GetOrderDashboardZod`) — lọc ở BE nên MỌI KPI/biểu đồ theo xưởng, không riêng bảng size. Bảng size khóa theo xưởng đó. |
| Dashboard → Đơn hàng theo xưởng (`OrderFactoryTab`) | `parseFilterModeFromURL` rơi về `factoryId` khi chưa có `ffactory`; chip xưởng trong tab ghi riêng `ffactory`. Chỉ hiện thẻ + luồng chuyển của xưởng đang lọc. |
| Dashboard → Vòng đời đơn (`LifecycleTab` + `LifecycleStrip`) | Giá trị của select xưởng (seed lúc mount + effect theo dõi param). |
| Danh sách đơn (`OrderTableWorkshop`) | `buildFilterParams()` thêm `factoryId` → `GET /orders`. |

**Trang seed state từ URL PHẢI theo dõi `factoryId` bằng effect.** Đổi cụm xưởng chỉ đổi query, React Router KHÔNG remount trang; state đã seed từ lần mount đầu sẽ đứng yên và effect đồng bộ-URL của chính trang đó còn **ghi ngược giá trị cũ trở lại** — nhìn như "bấm menu mà không có gì xảy ra". `OrderFactoryTab` (re-seed `filterMode` + `setPage(1)`), `LifecycleTab` (`selectedFactory`) và `LifecycleStrip` (`factoryId`) đều có effect này, khai **TRƯỚC** effect đồng bộ-URL. `OrderStatsTab`/`OrderTableWorkshop` đọc thẳng `useFactoryScope()` vào dependency của fetch nên không cần.

> **`factoryId` chỉ có MỘT chiều ghi: sidebar.** Effect đồng bộ-URL của trang **không được** `set`/`delete` param này (`OrderFactoryTab` dùng `ffactory` riêng cho chip trong tab). Lý do: `setSearchParams` của react-router 6.14 memo theo `location.search` nên **đổi identity mỗi lần URL đổi** — effect đồng bộ chạy lại với closure state CŨ và ghi giá trị cũ đè lên. Ghi cả hai chiều vào `factoryId` → effect ghi và effect đọc đẩy qua đẩy lại, **URL nhảy loạn giữa 2 xưởng không dừng**.

**Đang ở cụm xưởng thì ẨN filter xưởng trong nội dung** — hai chỗ đổi xưởng chọi nhau là cách chắc chắn để sai phạm vi: `OrderFactoryTab` bỏ dãy chip "Đang ở X" (chip "Tất cả" đổi nghĩa thành "bỏ drill-down in/lỗi", GIỮ xưởng), `LifecycleTab` bỏ facet xưởng, `LifecycleStrip` bỏ select xưởng, bảng size ở `OrderStatsTab` hiện nhãn xưởng thay cho dropdown. Đường bỏ phạm vi là `FactoryScopeChip` (§25.4) hoặc bấm lại cụm chung.

**Lọc tường minh `factoryId` ghi đè bộ loại trừ mặc định** ở cả 3 chỗ (`getDashboard`, `buildVisibilityFilter`, `getLifecycleOverview`) — nên cụm menu của **xưởng US cũng xem được đơn của chính nó** (§21), đúng nguyên tắc "US chỉ ẩn ở view mặc định".

### 25.4 Dấu hiệu trên màn hình

`apps/web/src/components/common/FactoryScopeChip.tsx` — chip "Đang lọc xưởng: X" + nút bỏ lọc, gắn ở `middleRow` của `OrderFilterBar` tại Danh sách đơn và tab Thống kê. Trang bị thu hẹp dữ liệu mà không có dấu hiệu gì là cách chắc chắn nhất để người ta đọc nhầm số. Chip không hiện khi xưởng do TÀI KHOẢN quy định (Fulfillment) — lúc đó bỏ lọc cũng không được.
