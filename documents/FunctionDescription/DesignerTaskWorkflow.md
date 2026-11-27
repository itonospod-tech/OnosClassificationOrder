# Designer Task Workflow — Function Description

> **File FE:**
>  - `apps/web/src/pages/designer/team/{index,TeamMemberDialog}.tsx` — Leader CRUD sub-designer
>  - `apps/web/src/pages/designer/my-tasks/{index,TaskCard,RejectModal,TaskDetailDialog}.tsx` — Sub-designer kanban
>  - `apps/web/src/pages/designer/my-tasks/DailyBreakdownPanel.tsx` — Panel "Chi tiết theo ngày" (7/14/30) focus đơn chưa xong
>  - `apps/web/src/components/common/PipelineDailyOverview.tsx` — Bảng "Tổng quan theo ngày" FULL luồng (TOÀN nhà máy) `lane='designer'`, render TRÊN "Chi tiết theo ngày" (xem `FulfillmentWorkflow.md §4.6`)
>  - `apps/web/src/pages/home/DesignerStatsTab.tsx` — Dashboard tab leader
>  - `apps/web/src/pages/orders/DesignerSummaryPanel.tsx` — KPI panel trên /orders cho leader/admin
>  - `apps/web/src/components/orders/AssignDesignerDialog.tsx` — Bulk assign từ workshop table
>  - `apps/web/src/components/orders/cells/AssigneeSelectCell.tsx` — Picker user trong order table
>  - `apps/web/src/components/orders/cells/{ProductionErrorSelectCell,ProductionErrorOtherDialog,ErrorSourceCell}.tsx` — Error workflow
>  - `apps/web/src/store/designerTeamStore.ts` — Zustand cache designer team
>  - `apps/web/src/services/designer.ts` — API client
>
> **File BE:** `apps/api/src/modules/designer/`
>  - `designer.module.ts`
>  - `designer-migration.{controller,service}.ts` — One-shot migrate legacy Designer → Leader
>  - `designer-team.{controller,service}.ts` — Leader CRUD
>  - `designer-task.{controller,service}.ts` — State machine + my-tasks + bulk transition
>  - `designer-stats.{controller,service}.ts` — Leader dashboard
>
> **Route FE:**
>  - `/ffm/designer/team` (Leader/Admin)
>  - `/ffm/my-tasks` (Designer sub)
>  - `/ffm/dashboard?tab=designer` (Leader/Admin tab)
>
> **API chính:**
>  - `POST /v1/designer/migrate-leader` (one-shot)
>  - `GET/POST/PATCH/DELETE /v1/designer/team` + `/:userId/reset-password`
>  - `POST /v1/orders/:id/designer-transition` (state machine 1 task)
>  - `POST /v1/designer/bulk-transition` (state machine N task)
>  - `GET /v1/designer/my-tasks` + `/my-task-filters` + `/my-stats` + `/my-daily-breakdown`
>  - `GET /v1/designer/performance` + `/timeline/:userId` + `/team-daily-breakdown` + `/breakdown-filters` + `/daily-overview` + `/assign-backlog` + `/product-breakdown`
>  - `GET /v1/orders/designer-breakdown` (KPI matrix per-user trong /orders)
>  - `POST /v1/orders/bulk-assign-designer-preview` + `/bulk-assign-designer` + `/claim-designer-tasks` (designer self-claim)
>  - `POST /v1/orders/:id/set-production-error` (atomic 3 field — bắt buộc khi 'other')
>  - `POST /v1/orders/backfill-designer-status` (Admin one-shot)

---

## 1. Overview

Tách role Designer cũ (1 account dùng chung) thành **DesignerLeader** + N **Designer** (sub). Workflow chính:

```
Leader assign → Sub Designer nhận → làm → hoàn thành
                                 ↘ không làm được → BÀN GIAO thẳng cho designer khác (bắt buộc chọn)
xưởng báo lỗi designer (rework) → sub làm lại → hoàn thành
```

State machine 6 trạng thái:
- `unassigned` (default khi import order)
- `assigned` (leader gán cho user)
- `in-progress` (sub bấm "Nhận làm")
- `done` (sub bấm "Hoàn thành" — auto `toolResultNote='ok'` + `readyForFulfill=true`)
- `rejected` (**LEGACY** — luồng mới KHÔNG còn tạo state này). "Báo không làm được" giờ = **bàn giao BẮT BUỘC** sang designer khác: đơn chuyển thẳng `assigned` cho người nhận (không nằm ở `rejected`). Lịch sử lưu vào mảng `designerRejections` trên order — xem §2.3b. State cũ chỉ còn ở đơn legacy trước thay đổi.
- `rework` (xưởng set productionError có errorSource='designer')

**Identity model:** `Order.assignee = user._id` (string). KHÔNG còn dùng workshop_config (category=assignee đã xoá).

**Đơn hủy (`cancelledAt`):** đã LOẠI khỏi mọi số liệu/queue của designer — my-tasks kanban (`buildMyTaskFilter`), my-stats (`getMyStats`), daily breakdown, tổng quan N ngày (`getDailyOverview`), pool "Cần gán"/self-claim (`getAssignBacklog`), ma trận KPI /orders (`getDesignerBreakdown`) đều thêm `cancelledAt: null`. Xem `documents/Plans/CancelledOrders-ExcludeFromStages.md`.

**Per-cycle work tracking:**
- `designerStartedAt` reset mỗi cycle (`start`/`restart`)
- `designerFirstStartedAt` immutable, set lần đầu start
- `designerWorkMs` cumulative ms — `$inc` mỗi `complete` bằng `(now − designerStartedAt)`
- Stats `avgWorkMin` dùng `designerWorkMs` trực tiếp (fallback `completedAt − startedAt` cho legacy)
- Stats `avgResponseMin` dùng `designerFirstStartedAt − designerAssignedAt`

---

## 2. Luồng hoạt động

### 2.1 Setup ban đầu
1. Boot API → `RoleService.onModuleInit()` seed role `DesignerLeader`, sync permissions cho Designer (sub) — bỏ `assignee.edit`, `toolResultNote.edit`.
2. Admin gọi `POST /v1/designer/migrate-leader` (1 lần) → promote 1 user Designer cũ → email `designerleader@onospod.com` + role `DesignerLeader`.
3. Login Leader → `/designer/team` → tạo các sub-designer (chỉ cần fullName + email + password + hireDate + telegramChatId optional). Code/slug đã bỏ — identity = user._id.

### 2.2 Assign task

> **⛔ Điều kiện gán designer** (helper `canAssignDesignerByStatus(status, hasAssignee)` ở `order.service.ts`, áp **cả BE + FE**, cả 3 đường: per-row cell, bulk dialog, bulk-update field):
>
> | designerStatus | Gán được? |
> |---|---|
> | `unassigned` / `assigned` / `rejected` | ✅ (assigned cho người khác → cần ghi đè `reassignOthers`) |
> | `rework` **chưa có ai ôm** (`assignee` rỗng) | ✅ — đơn lỗi xưởng-báo-designer trên đơn unassigned (xem `FulfillmentWorkflow.md §2.3b`) rơi vào nhóm này |
> | `rework` **đang có người ôm** (`assignee` != null) | ❌ skip + thông báo (kể cả ghi đè) — người đang ôm phải tự làm lại |
> | `in-progress` / `done` | ❌ |
>
> Ngoài ra **đơn `toolResultNote === 'ok'`** (`READY_FOR_FULFILL_CODE`, đã soát xong) → KHÔNG cho gán (chỉ chặn khi GÁN, vẫn cho bỏ chọn).
>
> **Bảng trên CHỈ áp khi GÁN** (`normalized` có giá trị). **BỎ GÁN** (`normalized=null`, xóa lựa chọn/nút "Bỏ gán design") **KHÔNG bị chặn bởi bất kỳ trạng thái nào** (kể cả `in-progress`/`done`/`rework`-có-người-ôm) — đây là thao tác sửa sai của leader/admin, luôn cho phép reset `designerStatus` về `unassigned` (2026-07-30, xem dòng 97 + 114).

**Single order**: Leader vào `/orders` workshop table → cell "Người thực hiện" (`AssigneeSelectCell`) → pick user từ dropdown load `/designer/team` cache (zustand `designerTeamStore`). `updateField('assignee')` BE:
- **Đơn `toolResultNote='ok'` + đang gán → `BadRequestException`** "Đơn đã 'ok' — không cần gán designer."
- **Đơn `rework` đang có người ôm + đang gán → `ConflictException`** "Đơn cần làm lại đang có người ôm — không gán cho người khác."
- Gán hợp lệ (gồm `rework` chưa ai ôm) → set `designerStatus='assigned'`, `designerAssignedAt=now`, clear reject fields.
- Block 409 nếu `!canAssignDesignerByStatus` **CHỈ khi GÁN** (`normalized` có giá trị) — in-progress/done, hoặc rework-held. **Bỏ chọn** (`normalized=null`) **KHÔNG qua check này nữa** (2026-07-30) → luôn set `designerStatus='unassigned'` + clear mốc thời gian, bất kể trạng thái hiện tại.
- FE: `AssigneeSelectCell` nhận prop `blockedReason` (set khi `r.toolResultNote==='ok'` ở `workshopTableConfig.tsx`) → cell **disabled + opacity-60 + tooltip** lý do.

**Bulk assign**: Workshop table → tick nhiều row → toolbar **"Gán design"** → `AssignDesignerDialog`:
1. Pre-flight `POST /bulk-assign-designer-preview` trả KPI per status + `alreadyAssigned[]` (CHỈ đơn eligible đang gán người khác → conflict/override; KHÔNG gồm rework-held/blocked) + `blockedCount` (in-progress/done) + **`reworkHeldCount`** (rework đang có người ôm) + **`okCount`** + **`noToolCount`** (chưa soát) + `eligibleCount` + `eligibleWithToolCount`.
2. Dialog banners:
   - `blockedCount>0` → "X đơn đang in-progress/done — sẽ bị skip."
   - **`reworkHeldCount>0`** → "X đơn **cần làm lại đang có người ôm** — không gán cho người khác được, sẽ bị bỏ qua. Chỉ gán được đơn cần làm lại chưa có ai ôm."
   - `okCount>0` → "X đơn đã OK — không gán được… chỉ gán {eligibleCount} còn lại."
   - `noToolCount>0` → "X đơn **chưa soát**. Bạn có chắc muốn gán?".
3. Counts: `eligibleCount` = `canAssignDesignerByStatus` && `!ok` (gồm rework-chưa-ôm + chưa soát) → "Gán tất cả". `eligibleWithToolCount` = subset eligible ĐÃ soát → "Chỉ gán đơn đã soát".
4. **Footer 3 chế độ:**
   - `noToolCount>0` → **2 nút**: "Chỉ gán đơn đã soát ({eligibleWithToolCount})" (`skipUnreviewed=true`) + "Gán tất cả ({eligibleCount})" (`skipUnreviewed=false`). Conflict → tự ghi đè.
   - `noToolCount=0` + conflict → "Ghi đè & Gán".
   - `noToolCount=0` + không conflict → "Gán".
5. `POST /bulk-assign-designer { ids, userId, reassignOthers, skipUnreviewed }` → skip đơn `ok` + (nếu `skipUnreviewed`) đơn chưa soát + **đơn rework đang có người ôm** ("Cần làm lại đang có người ôm — chỉ gán được đơn chưa có ai ôm.") + đơn in-progress/done → report skipped → toast + detail.

**Bulk UNassign** (`BulkEditToolbar.tsx` — nút **"Bỏ gán design"** cạnh "Gán design", cùng gate `canEditField('assignee')`, KHÔNG dialog): gọi thẳng `bulkUpdateField({ ids, field: 'assignee', value: null })` — **tái dùng nguyên vẹn** nhánh `dto.field === 'assignee'` trong `OrderService.bulkUpdateField()` (KHÔNG phải flow riêng), `normalized=null` → reset `designerStatus='unassigned'` + clear toàn bộ mốc thời gian designer (`designerAssignedAt/StartedAt/CompletedAt/RejectedAt/ReworkAt/RejectedReason/ReworkCount`). **KHÔNG còn áp `matchFilter` reassignable-status khi bỏ gán** (2026-07-30 — trước đây mirror bulk assign, loại đơn in-progress/done khỏi `matchFilter` khiến `matchedCount` thấp hơn `ids.length`; giờ `extraMatchFilter` CHỈ set khi GÁN, bỏ gán match TOÀN BỘ `ids` bất kể `designerStatus`/`assignee` hiện tại — kể cả đơn đang `in-progress`). Mirror hành vi "Xóa lựa chọn" ở `AssigneeSelectCell` (inline, per-order, cũng đã bỏ check `canAssignDesignerByStatus` khi clear) nhưng áp cho nhiều đơn cùng lúc.

> **Auto-gán khi báo lỗi designer (2026-07):** đơn bị xưởng báo lỗi nguồn designer mà **chưa ai ôm** (soát 'ok' từ đầu → chưa từng có designer, thành `rework`+assignee rỗng) giờ được **auto-gán theo cấu hình xưởng** ngay sau khi báo lỗi (hook ở `setProductionError`/`updateField`/rework-back kanban Fulfillment — giữ status `rework` → vào thẳng cột "Cần làm lại"). Backlog "Cần gán" + self-claim chỉ còn hứng đơn ngoài cấu hình auto-gán / chưa map xưởng. Xem `DesignerAutoAssign.md`.

**Self-claim (Designer TỰ NHẬN task)**: trên bảng backlog Dashboard §0c (`DesignerAssignBacklog.tsx`), khi người xem là role **`Designer`/`DesignerLeader`** → hiện nút **"Nhận về mình ({N})"** (icon `Grab`) cạnh/thay cho "Gán design" (nút "Gán design" chỉ hiện cho `SuperAdmin/Admin/Manager/DesignerLeader`; Leader thấy cả 2). Tick đơn → "Nhận về mình" → `POST /orders/claim-designer-tasks { ids }` (không preview, toast summary + skipped như bulk-transition).
- BE `OrderService.claimDesignerTasks(ids, ctx)`: `assignee` **luôn = `ctx.user._id`** (không nhận từ ngoài). Chỉ nhận đơn **chưa ai ôm** — pool status `unassigned` / `rejected` (người cũ đã trả lại, vẫn còn `assignee` cũ nhưng vẫn nhận được → ghi đè) / `rework` chưa có ai ôm; các trạng thái khác skip ("Đơn đang có người làm hoặc đã xong" / "Đơn làm lại đang có người ôm"). Đơn `note='ok'` cũng skip. Patch: `assignee`, `designerStatus='assigned'`, `designerAssignedAt=now`, clear rejected. `updateMany` guard `designerStatus ∈ {unassigned,rejected,rework}` chống race (người khác vừa nhận trước → không cướp).
- **Log ai nhận / lúc nào**: `orderLog.writeMany` (field `assignee`, `after=userId`, `ctx.user` = người nhận + timestamp) — audit trail giống bulk-assign.
- KHÔNG cần permission `order.field.assignee.edit` (self-claim là quyền tự thân của designer, chặn ở controller theo role).

**Nút "Tự động gán" (2026-07, `SuperAdmin/Admin/Manager/DesignerLeader`)**: icon `Wand2` trên header bảng "Cần gán", phạm vi = TOÀN BỘ đơn đang hiển thị theo filter bảng (không cần tick). Bấm → `POST /orders/auto-assign-preview {orderIds}` chạy đúng routing 3 mức khách→sản phẩm→xưởng của `autoAssignAfterImport` nhưng KHÔNG ghi → dialog xác nhận liệt kê mỗi designer nhận bao nhiêu đơn + số đơn không gán được (ngoài cấu hình) → "Gán {N} đơn" → `POST /orders/auto-assign-apply {assignments}` áp ĐÚNG plan đã xem (đơn vừa bị người khác ôm/đổi trạng thái → skip, toast `assigned/skipped`). Chi tiết BE: `DesignerAutoAssign.md §3`. Dialog plan tách thành component dùng chung `apps/web/src/components/orders/AutoAssignPlanDialog.tsx`. **Bảng backlog giới hạn `max-h-[80vh]` — vượt quá thì scroll trong bảng, header (các nút gán) luôn thấy.**

> **Panel drill-down "Chưa gán designer" (2026-07):** cả 4 nút trên (Nhận về mình / Gán design / Ghi nhớ cấu hình / Tự động gán) + checkbox chọn đơn cũng có trong `DesignerDrillPanel.tsx` khi bấm con số hàng "Chưa gán designer" ở bảng Tổng quan (`DrillTarget.selectable` — cùng role gate, cùng i18n `assignBacklog.*`; "Tự động gán" phạm vi = đơn đang hiển thị trong panel sau filter chip). Xem `Dashboard.md §0b`.

**Nút "Ghi nhớ cấu hình" (2026-07, CHỈ `SuperAdmin/Admin`)**: icon `BookmarkPlus`, active khi có ≥ 1 đơn được tick → mở `RememberAssignConfigDialog.tsx` (`apps/web/src/components/orders/`): chọn designer + thời hạn ghi nhớ **Hiện tại / 1 ngày / 7 ngày / Vĩnh viễn** (mặc định Vĩnh viễn). Xác nhận → (a) gán ngay các đơn đang tick cho designer (`POST /orders/bulk-assign`, `reassignOthers=false`), (b) nếu thời hạn ≠ "Hiện tại" → lưu mapping sản phẩm→designer vào config auto-gán **Ưu tiên 2** kèm hạn (`POST /designer-assignment/remember-products`, sản phẩm = các nhóm có đơn được tick, nhóm `unmapped` chỉ gán không ghi nhớ). Sản phẩm đang thuộc designer khác → cảnh báo ghi đè trong dialog. Hết hạn → mapping tự vô hiệu (lazy expiry), card về "Chưa gán". Chi tiết: `DesignerAutoAssign.md §2c/§5.4`.

### 2.3 Sub Designer xử lý task

Login Designer → auto redirect `/my-tasks` (xem `pages/login/index.tsx`).

**Layout kanban 6 cột** theo thứ tự **Cần làm → Cần làm lại → Đang chờ quay lại → Đang làm → Đã xong → Đã sửa**:
- Cột **"Đang chờ quay lại"** (`watching`, sky, read-only, auto-ẩn khi rỗng) = task designer **đã xong / đang chờ làm lại** của đơn **CỦA MÌNH** (`assignee=me`) đang bị giữ ở **Soát tool** phía trên (In báo thiếu file → marker `productionErrorSource='tool-check' AND toolResultNote='error'`). Chưa tới lượt designer (chờ Support soát xong). **Support soát 'ok' → BE tự chuyển đơn sang "Cần làm lại"** (designerStatus='rework'). Giữ nguyên lịch sử `designerCompletedAt`. BE `getMyTasks` cột `watching` = `{...marker, designerStatus∈{done,rework}}`; cột `rework`/`done`/`fixed` thêm `$nor:[marker]` để loại đơn đang giữ ở Soát tool. Xem `documents/Plans/UpstreamWatching-ReflowChain.md`.
- Cột **"Đã xong"** = done KHÔNG dính lỗi (`designerReworkCount = 0`); cột **"Đã sửa"** = done nhưng TỪNG bị báo lỗi rồi hoàn thành (`designerReworkCount > 0`) — 2 cột loại trừ nhau (BE tách sẵn trong `getMyTasks`). Kéo-thả hoàn thành 1 đơn từng bị lỗi → optimistic vào thẳng "Đã sửa".
- Cột "Cần làm lại" + "Đã sửa" auto **ẩn** khi rỗng (grid switch `xl:grid-cols-5 ↔ 4 ↔ 3`)
- Mỗi cột group cards theo `type` (sản phẩm), header collapsible với checkbox-all + indeterminate + chevron toggle. **Trong mỗi nhóm sản phẩm sắp xếp theo size ưu tiên XS→S→M→L→XL→2XL→3XL→4XL→5XL** (size giống nhau đứng cạnh nhau) qua `sizeRank()` + `SIZE_ORDER`/`SIZE_ALIAS` trong `groupByType` (sort ổn định, cùng size giữ thứ tự ngày từ BE; size lạ/không có dồn cuối).
- Mỗi card: thumbnail (click → ImagePreviewDialog), productionId (click → TaskDetailDialog) + **nút copy (`CopyButton`, copy xong hiện dấu tích)**, size/color. **Hàng badge riêng TRÊN CÙNG** (2026-08-18): badge ưu tiên + note kết quả Tool (`toolResultNote`, truncate + tooltip) nằm hàng đầu (chừa `pr-9` cho nút KLĐ góc phải), **productionId xuống hàng riêng full bề ngang — không bao giờ bị badge/nút đè** (fix theo screenshot user: badge + nút "Không làm được" che mất mã) — **resolve label + màu từ `workshop_config` (category `ToolResultNote`) qua `useWorkshopConfigStore`, đồng bộ với `ColorBadgeSelectCell` ở bảng đơn** (badge nền màu config + chữ trắng, hiện `name` thay vì raw code; page gọi `load()` 1 lần để nạp config). Hàng mốc thời gian **dàn ngang full-width dưới mockup** (tiết kiệm khoảng trống): "SX" (`inProductionAt`) + timestamp theo state + "Cập nhật" (`updatedAt`) — mỗi mốc có tooltip (`Hint`) giải thích. (`DesignerTaskCardZod` có `orderAt`/`inProductionAt`/`updatedAt`/`toolResultNote`; mapper `toCard` map từ order doc.)
- Cards indent `pl-5 border-l-2` so với group header để visualize hierarchy
- Filter bar: search + 7 `SelectFilter` single-select (Sản phẩm/Loại vải/Máy/Kết quả Tool/**Note kq Tool** = `toolResultNote`/**Khách hàng** = `userSku`/**File sửa lỗi** = `errorFile`) — cross-faceted từ `/my-task-filters`. **Loại vải/Máy/Kết quả Tool/Note kq Tool/File sửa lỗi hiển thị `name`, KHÔNG hiện raw code** — `value` gửi BE vẫn là code. 4 facet scalar resolve qua `useWorkshopConfigStore.byCategory` (helper `labelOpts`); **`errorFile` dùng thẳng `options=filterOptions.errorFile` (không `labelOpts`/`byCategory`)** vì `label`=name đã resolve **NGAY Ở BACKEND** (`getMyTaskFilters` query `workshop_config` category `error_file_type` → `nameMap`, giống `getWorkshopAvailableFilters`). **Pattern y hệt facet `errorFile` trong `OrderTableWorkshop.tsx`.** Backend: `toolResultNote` thêm vào `buildMyTaskFilter` ($in) + facet KEYS trong `getMyTaskFilters`; shared `GetMyTasksZod.toolResultNote` + `GetMyTaskFiltersResZod.data.toolResultNote`.
  - **File sửa lỗi (`errorFile`) — single-select** (field **mảng** `string[]` trên order): chọn 1 mã → đơn khớp qua `filter.errorFile = { $in: [code] }` (mảng chứa mã đó). Lưu 1 code trong `filters.errorFile` (đồng bộ URL param `errorFile` + F5 giữ). Facet count viết aggregate **riêng có `$unwind: '$errorFile'`** (không dùng helper `aggregate()` scalar chung — 1 đơn nhiều loại đếm ở nhiều option ⇒ tổng option có thể > số đơn, đúng). Shared: `GetMyTasksZod.errorFile` + `GetMyTaskFiltersResZod.data.errorFile`. BE: `buildMyTaskFilter` ($in mảng) + `errorFileFacet()` (inject `WorkshopConfigEntity` model, resolve name) trong `getMyTaskFilters`.
  - **⚠️ Data fix (bắt buộc):** legacy `errorFile` lưu **lồng 2 lớp** `[['collar']]` (ghi trước guard `normalizeFieldValue().flat(2)`) làm HỎNG cả facet (`$unwind` 1 lần trả mảng con `['collar']`) lẫn filter (`$in:['collar']` không khớp phần tử mảng) → dropdown hiện `["collar"]` + lọc ra 0. Fix bằng migration flatten trong `OrderService.onModuleInit()` (`updateMany({ errorFile: { $elemMatch: { $type: 'array' } } }, [ $reduce/$concatArrays flatten ])`, idempotent). Migration này **cũng fix filter `errorFile` của `OrderTableWorkshop`** (chung dữ liệu). Cần **restart API** để chạy onModuleInit.
- KPI 7 ô: Cần làm · Cần làm lại · Đang làm · **Đã xong** (`completedInPeriod − fixedInPeriod`) · **Đã sửa** (`fixedInPeriod`, teal) · **Không làm được** · Phản hồi/Làm
- Period switcher today/7d/30d ảnh hưởng cột "Đã xong" + completed stats

**Multi-select**:
- Checkbox per card (góc trên-trái, `accent-indigo-500`, không nuốt drag nhờ `onPointerDown stopPropagation` + PointerSensor `distance: 6`)
- Shift+click trong cùng cột → range select (`lastClickedRef + orderedIdsPerColumn`)
- Card được tick: `ring-1 ring-indigo-400/70 bg-indigo-50/40`

**Drag & drop** (dnd-kit):
- `DragOverlay` render card "fly" theo cursor (rotate-1 + shadow-2xl), card gốc opacity-30
- Drop sai → toast warning + revert. Rules: assigned→inProgress (start), inProgress→done (complete), rework→inProgress (restart)
- Mỗi drop fire `POST /orders/:id/designer-transition { action }` đơn lẻ, optimistic UI

**Bulk action toolbar** sticky bottom khi `selected.size > 0`:
- Detect cột của items đã chọn:
  - 1 cột → button theo `COL_META[col].bulk`: Cần làm (Nhận / Không làm được) · Cần làm lại (Nhận lại) · Đang làm (Hoàn thành) · Đã xong (—)
  - Nút reject trên từng card (cột Cần làm/Đang làm, hiện khi hover góc phải-trên): label rút gọn **"KLĐ"** (`myTasks.rejectCardButtonShort`, tooltip = label đầy đủ "Không làm được") — đổi từ label dài che mất productionId (2026-08-18)
  - Mixed → text "Đơn ở nhiều cột" + clear button only
- Reject mở `RejectModal` (bắt buộc chọn 1 designer nhận thay cho TẤT CẢ đơn chọn) → `POST /designer/bulk-transition { ids, action: 'reject', reason, targetUserId }` → skip per-row (kể cả đơn `targetUserId` trùng người đang ôm) + report

**Rejected drawer** dưới kanban (tiêu đề "File không làm được"): list các đơn **user hiện tại TỪNG báo không làm được rồi bàn giao đi** (query `designerRejections.fromUserId = me`, KHÔNG theo assignee hiện tại) — dùng để tra lại người đó đã không làm được những đơn nào. Lọc theo cùng cửa sổ ngày `inProductionAt` + facet của kanban.

### 2.3b "Báo không làm được" = bàn giao bắt buộc (thay cho `rejected`)

> File: `apps/web/src/pages/designer/my-tasks/RejectModal.tsx` (picker) + `designer-task.service.ts` (`transition`/`bulkTransition` + `resolveTransition` case `Reject`).

1. Designer bấm "Không làm được" (cột **Cần làm** / **Đang làm**, single hoặc bulk) → `RejectModal` **bắt buộc chọn 1 designer nhận thay** (dropdown = sub-designer đang `Active`, **loại chính mình**, kèm số đơn đang ôm để chọn người rảnh — nguồn `designerTeamStore`). Không chọn → nút "Không làm được" **disabled**. Lý do vẫn **tùy chọn**.
2. Submit → `POST /orders/:id/designer-transition { action:'reject', reason?, targetUserId }` (bulk: `/designer/bulk-transition`).
3. BE (`resolveTransition` case `Reject`, chỉ hợp lệ từ `assigned`/`in-progress`):
   - Validate `targetUserId` = sub-designer `Active`, khác `fromUserId` (`assertHandoffTargetValid`).
   - `fromUserId` = **assignee đang ôm đơn** (người "không làm được"), KHÔNG phải actor (leader có thể thao tác thay).
   - Patch: `designerStatus='assigned'`, `assignee=targetUserId`, `designerAssignedAt=now`; **reset đồng hồ per-cycle** (`designerStartedAt/FirstStartedAt/CompletedAt=null`) + clear scalar reject cũ; **giữ** `designerReworkCount`/`designerWorkMs` (lịch sử đơn).
   - `$push designerRejections { fromUserId, toUserId, reason?, at }` — append-only, là **NGUỒN thống kê "Không làm được" theo người**.
   - `findOneAndUpdate({designerStatus: current})` race-safe; bulk skip nếu `targetUserId === assignee` (no-op).
4. **Audit (OrderLog)**, actor = người thao tác + timestamp: `designerStatus` (→assigned) + `assignee` (from→to) + `designerRejectedReason` (nội dung lý do). Tra được ở `OrderLogTimelineDialog`.
5. Đơn rời board người cũ → hiện ở cột **Cần làm** của người nhận. Người cũ vẫn thấy đơn trong **drawer "Không làm được"** + KPI (đếm từ `designerRejections.fromUserId`).

### 2.4 Xưởng báo lỗi → rework cycle
1. Fulfillment vào `/orders` workshop → cell "Lỗi xưởng" (`ProductionErrorSelectCell`) pick code:
   - Code thường (vd `wrong-design`): `updateField('productionError', code)` → hook BE auto-fill `productionErrorSource` từ `workshop_config.errorSource`, set `toolResultNote='error'`, `$inc productionErrorCount`. Nếu source=designer + status=done → auto `designerStatus='rework'` + `$inc designerReworkCount`. **Nếu đơn đang trong pipeline fulfillment** (`currentFulfillmentStage` set) → đồng thời mirror rework-back về designer (reporter stage→waiting + push `fulfillmentTimeline` rework-back) để worker thấy đơn ở tab "Đang chờ quay lại" rồi "Cần làm lại" sau khi designer xong — xem `FulfillmentWorkflow.md` §2.3b.
   - Code `'other'`: mở `ProductionErrorOtherDialog` bắt buộc pick source + nhập note → `POST /orders/:id/set-production-error` atomic (BE validate 400 nếu thiếu)
   - Code có `errorSource='tool-check'` (vd "Thiếu file để in"): KHÔNG đụng designer — đẩy về **Support** (soát tool). Xem `ToolCheckWorkflow.md`.
2. Designer thấy đơn trong cột "Cần làm lại" với badge ×N + productionErrorNote
3. Designer drag → "Đang làm" (action=`restart` — reset `designerStartedAt`, giữ `designerFirstStartedAt` + `designerWorkMs` cumulative)
4. Designer drag → "Đã xong" (action=`complete` — `$inc designerWorkMs += (now − startedAt)`, set `toolResultNote='ok'`, `readyForFulfill=true`). Counter `productionErrorCount` không reset
5. Nếu xưởng báo lỗi tiếp lần 2+: cell `toolResultNote` hiển thị **"Lỗi ×N"** (rose badge) khi `productionErrorCount >= 2` + `toolResultNote='error'`

### 2.5 Leader xem stats

**Dashboard tab Designer** (`?tab=designer`): xem `Dashboard.md` mục tab Designer.

**Order list KPI panel** (`DesignerSummaryPanel` trên `/orders` cho Admin/Manager/Leader):
- KPI 7 button-card (**Tổng chưa gán** = N+M / **Chưa gán không tool** = M / Cần làm/Cần làm lại/Đang làm/Đã xong/Không làm được) — click → set filter list
- Bảng matrix per-designer (collapsible, sort total desc, "Chưa gán" lên đầu) — click cell → set `assignee + designerStatus`
- Toggle "Xem theo filter/Xem tổng" swap scoped ↔ overall counts
- Data từ `GET /v1/orders/designer-breakdown` (cùng filter shape với list)

---

## 3. API / Schema

### 3.1 OrderEntity fields (Designer-related)
```ts
designerStatus: DesignerStatus   // enum 6 values, default unassigned, indexed
designerAssignedAt?: Date
designerStartedAt?: Date          // per-cycle, reset mỗi start/restart
designerFirstStartedAt?: Date     // immutable, set lần đầu start
designerCompletedAt?: Date
designerRejectedAt?: Date
designerReworkAt?: Date
designerRejectedReason?: string
designerReworkCount: number       // default 0, $inc khi xưởng báo lỗi designer
designerWorkMs: number            // default 0, cumulative ms, $inc khi complete
designerRejections?: { fromUserId; toUserId; reason?; at }[]  // lịch sử "không làm được → bàn giao", append-only; nguồn thống kê rejected theo người (index fromUserId)

productionError?: string          // workshop_config code
productionErrorNote?: string
productionErrorSource?: 'designer' | 'factory'   // indexed, per-order
productionErrorCount: number      // default 0, $inc mỗi lần xưởng set productionError

priority?: OrderPriority           // 1=Ưu tiên/2=Ưu tiên cao/3=Ưu tiên nhất, optional — xem Orders.md §17. Sort key đầu tiên (priority: -1) ở mọi query getMyTasks.
```

### 3.2 UserEntity fields (Designer/Fulfillment-related)
```ts
telegramChatId?: string           // notification phase sau
hireDate?: Date                   // hiển thị /designer/team
factoryId?: string                // ref FactoryEntity, REQUIRED khi role=Fulfillment (BE enforce)
// `assigneeCode` đã XOÁ — identity model dùng user._id
```

### 3.3 Endpoint chính

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/v1/designer/migrate-leader` | Admin | Promote 1 user Designer cũ → Leader (idempotent) |
| GET  | `/v1/designer/team` | Admin/Manager/Leader | List sub-designer + active/completed count |
| POST | `/v1/designer/team` | Admin/Leader | Tạo sub-designer (fullName, email, password, hireDate?, telegramChatId?) |
| PATCH | `/v1/designer/team/:userId` | Admin/Leader | Update info, block status change/disable nếu còn task active |
| DELETE | `/v1/designer/team/:userId` | Admin/Leader | Soft delete, block nếu còn task active |
| POST | `/v1/designer/team/:userId/reset-password` | Admin/Leader | Force password change next login |
| POST | `/v1/orders/:id/designer-transition` | Designer/Leader/Admin | Body `{ action, reason?, targetUserId? }` (`targetUserId` **bắt buộc khi action='reject'** — bàn giao, xem §2.3b). State machine race-safe `findOneAndUpdate({ designerStatus: expected })`. Sub-designer chỉ transition task `assignee=user._id` (owner check). Override roles (Admin/Manager/Leader) bypass |
| POST | `/v1/designer/bulk-transition` | Same | Bulk N task, per-row state machine, skip + report |
| GET | `/v1/designer/my-tasks` | Designer/Leader/Admin | **`viewUserId`** (optional, chỉ SuperAdmin/Admin/Manager — xem §4.2a) đổi scope sang designer khác; `fullName` trả về là tên NGƯỜI ĐƯỢC XEM. Kanban 6 cột (`assigned/inProgress/rework/done/fixed/**watching**`; **done** = reworkCount 0, **fixed** = reworkCount>0, **watching** = "Đang chờ quay lại" đơn của mình đang giữ ở Soát tool — xem §2.3) + rejected drawer. Filter (type, fabricType, machineNumber, toolResult, search); `from`/`to` lọc **cả các cột** theo `inProductionAt` (mặc định today) |
| GET | `/v1/designer/my-task-filters` | Same | Faceted filter options (7 facets: type/fabricType/machineNumber/toolResult/toolResultNote/userSku scalar + **errorFile mảng qua `$unwind`**) cross-narrow + lọc `inProductionAt` |
| GET | `/v1/designer/my-stats?period=today\|7d\|30d\|custom` | Same | KPI cá nhân (counts + `completedInPeriod` tổng done + **`fixedInPeriod`** = done reworkCount>0 + avgResponseMin + avgWorkMin + errorRate). "Đã xong" hiển thị = `completedInPeriod − fixedInPeriod` |
| GET | `/v1/designer/my-daily-breakdown?days=7\|14\|30` | Same | **Breakdown số đơn CỦA USER theo NGÀY vào sản xuất** (`inProductionAt`, tz VN) trong N ngày gần nhất. Focus đơn **chưa xong** (assigned/rework/in-progress) + `done` kèm để đối chiếu. Trả `days[]` (mỗi ngày: assigned/rework/inProgress/done/unfinished + `ageDays`, sort mới→cũ, chỉ ngày có đơn) + `totals` + `rangeDays`. 1 aggregate `$group` theo `{day,status}`. Xem §4.2b. |
| GET | `/v1/designer/performance?from&to&userId?` | Admin/Manager/Leader/Designer | Leaderboard per-user trong period (incl. totalRejected/totalRework từ OrderLog + **`fixedInPeriod`** = done reworkCount>0 → cột "Đã sửa"; "Đã xong" hiển thị = `completedInPeriod − fixedInPeriod`) |
| GET | `/v1/designer/timeline/:userId?from&to` | Same | Per-day buckets 4 series (assigned/started/completed/rework) cho line chart |
| GET | `/v1/designer/team-daily-breakdown?days=7\|14\|30` **hoặc** `?from&to` **+ `?type&customer` (optional)** | Admin/Manager/Leader/Designer | **Ma trận MỌI designer × ngày** (`inProductionAt`, tz VN, snapshot lens). Focus 3 trạng thái chưa xong + done kèm. Trả `days[]` + `rows[]` (mỗi designer: `cells[]` đồng bộ index với `days`, `totals`) + `columnTotals[]` + `grandTotals`. Tự include designer 0 đơn. `from/to` (range tùy chỉnh, cap 100 cột; `totals` tính trực tiếp từ agg nên đúng dù cap) cho **biểu đồ "theo designer"**; `days` preset cho ma trận + biểu đồ "theo ngày". **`type` (=`order.type`) + `customer` (=`order.userSku`)** = bộ lọc chung sản phẩm/khách hàng (thêm vào `$match`). Cho tab Dashboard Designer (§0 bộ lọc + §2 ma trận + §2b biểu đồ cột). Xem `Dashboard.md` Tab D. |
| GET | `/v1/designer/daily-overview?days=7\|14\|30` **hoặc `?from&to`** **+ `?type&customer`** | Admin/Manager/Leader/Designer | **Bảng tổng quan N ngày** (`inProductionAt`, tz VN) — 4 hàng: `total` (mọi đơn) / `unreviewed` (toolResultNote rỗng) / `error` (note ≠ ok, kèm `errorByNote[]`) / `backlog` (designerStatus ≠ done). Kèm `backlogByDesigner[]` (per-designer × assigned/inProgress/rework — **"Không làm được"/rejected KHÔNG tính là tồn**) + `unassignedBacklog` cho bảng con expand hàng Tồn. `type`/`customer` = filter chung. Cho tab Dashboard §0b. Xem `Dashboard.md` Tab D. |
| GET | `/v1/designer/assign-backlog?days=7\|14\|30` **hoặc `?from&to`** **+ `?type&customer`** | Admin/Manager/Leader/Designer | **Đơn cần gán designer** (`inProductionAt`, tz VN): `toolResultNote ∉ [null,'','ok']` **VÀ** (`unassigned`/`rejected`/`rework` + assignee rỗng). Gom theo `productConfigId` → `groups[]` (mockup/level/fullName + `count` + `orderIds[]` + `orders[]` rút gọn), đơn chưa map → nhóm "Chưa map". Cho bảng Dashboard §0c → chọn + `AssignDesignerDialog`. Xem `Dashboard.md` Tab D. |
| GET | `/v1/designer/product-breakdown` — **⚠️ TẠM ẨN (2026-07)** | — | Endpoint + khối "Cơ cấu trạng thái" (`StatusBarCharts.tsx`) đã comment (route trong `designer-stats.controller.ts`, import/render trong `DesignerStatsTab.tsx`); service `getProductBreakdown()` + DTOs shared giữ nguyên để bật lại. Xem `Dashboard.md` Tab D §2b. |
| GET | `/v1/designer/breakdown-filters` | Admin/Manager/Leader/Designer | **Option list 2 dropdown** bộ lọc chung tab Designer: `products` (distinct `order.type`) + `customers` (distinct `order.userSku`, cap 300), mỗi option `{value,label,count}`, scope đơn đã gán designer, sort count desc. Load 1 lần lúc mount. |
| GET | `/v1/orders/error-stats?from&to` | Same | Pie split errorSource (designer/factory/unknown) + breakdown per code |
| GET | `/v1/orders/designer-breakdown` | Admin/Manager/Leader | KPI scoped/overall + matrix per-designer (cho /orders panel) |
| GET | `/v1/orders/designer-backlog` | Admin/Manager/Leader | **Tồn đọng** (đơn chưa `done`, gồm unassigned; **KHÔNG gồm rejected/"Không làm được"** — nằm ở backlog "Cần gán") gom theo **Designer × Ngày `inProductionAt`** (MỌI ngày). Trả cây `designers[] → days[]` (counts per status + `ageDays`). Cho modal "Chi tiết tồn đọng". |
| POST | `/v1/orders/bulk-assign-designer-preview` | Same | Pre-flight stats |
| POST | `/v1/orders/bulk-assign-designer` | Same | Body `{ ids, userId, reassignOthers }`, skip + report |
| POST | `/v1/orders/claim-designer-tasks` | Admin/Manager/Leader/**Designer** | **Self-claim** — designer tự nhận `{ ids }` về CHÍNH MÌNH (`assignee=ctx.user._id`). Chỉ nhận đơn chưa ai ôm (unassigned/rejected/rework-chưa-ôm), skip 'ok' + đang-làm/đã-xong. Ghi orderLog (ai nhận + lúc nào). Xem §2.2. |
| POST | `/v1/orders/:id/set-production-error` | Admin/Manager/Designer/Fulfillment/Leader | Atomic set 3 field, validate code='other' phải có source + note |
| POST | `/v1/orders/backfill-designer-status` | Admin | Suy ra designerStatus + timestamps cho order legacy từ assignee + toolResultNote + OrderLog (idempotent) |

### 3.4 State machine table

| From | Action | To | Side effects |
|---|---|---|---|
| `unassigned` → updateField assignee | (auto) | `assigned` | designerAssignedAt=now, clear reject fields |
| `assigned`/`rejected` → updateField assignee | (auto) | `assigned` | reassign OK; reset reject fields |
| `in-progress`/`done`/`rework` → updateField assignee | (block) | — | 409 ConflictException |
| `assigned` | `start` | `in-progress` | designerStartedAt=now; if isFirstStart → designerFirstStartedAt=now |
| `rework` | `restart` | `in-progress` | designerStartedAt=now (reset per-cycle) |
| `in-progress` | `complete` | `done` | designerCompletedAt=now; toolResultNote='ok'; readyForFulfill=true; **`productionFirstErrorAt=null`** (đơn rời "Nhật ký bù lỗi" — mirror path `updateField(toolResultNote='ok')`; trước đây state-machine bỏ sót nên đơn rework fix xong vẫn kẹt trong error log); `$inc designerWorkMs += (now − startedAt)` |
| `assigned` **hoặc** `in-progress` | `reject` (kèm `targetUserId` bắt buộc) | `assigned` (**cho người nhận**) | Bàn giao: `assignee=targetUserId`, `designerAssignedAt=now`, reset đồng hồ per-cycle, `$push designerRejections{fromUserId,toUserId,reason,at}`. KHÔNG còn set `rejected`. Xem §2.3b |
| `done`/`unassigned`/`rejected` → updateField productionError (errorSource=designer) | (auto) | `rework` | designerReworkAt=now; `$inc designerReworkCount`. Đồng thời rework-back về designer + tạo/giữ stage fulfillment → tab "Đang chờ quay lại" (xem `FulfillmentWorkflow.md` §5.4b). Skip khi `rework`/`in-progress`/`assigned` (gate `canReworkBackToDesigner`) |
| `done`/`unassigned`/`rejected` → updateField productionErrorSource → 'designer' | (auto) | `rework` | Same as above |
| `done`/`unassigned`/`rejected` → setProductionError (source=designer, scan/dialog) | (auto) | `rework` | Same as above |

### 3.5 Role/permission catalog (`packages/shared/constants/permission-catalog.ts`)

**3 page perms**: `page.designer_team`, `page.my_tasks`, `page.designer_stats`
**4 task perms**: `designer.team.manage`, `designer.task.assign`, `designer.task.transition`, `designer.task.override`
**1 field**: `order.field.designerStatus.view`

**Default mapping**:
- `DesignerLeader`: admin-like với order + tất cả designer/team perms
- `Designer` (sub): bỏ `assignee.edit`, `toolResultNote.edit` (BE auto derive); có `designer.task.transition` + `page.my_tasks`

---

## 4. UI Components

### 4.1 `/designer/team` (Leader)
- 3 stat card: Đang làm · Tạm tắt · Task active toàn team (**Task active chỉ tính user đang bật**)
- **Bộ lọc trạng thái** `Đang bật / Đã tắt / Tất cả` (mặc định **Đang bật**): fetch toàn bộ 1 lần rồi lọc client-side (thẻ thống kê vẫn tính trên full list). Đây là chỗ **xem user đã tắt + số task của họ**.
- Bảng: Họ tên · Email · Đang làm (badge) · Đã xong · Vào làm · Trạng thái (Switch) · Actions (reset pwd / edit / xoá — Trash disabled khi activeTaskCount > 0). Dòng user đã tắt tô mờ (`opacity-60`).
- **Switch bật/tắt** → `updateMember({ status: Active↔Inactive })`. ⚠️ Giá trị đúng là `Status.Inactive` (`'0'`) — **KHÔNG** dùng `Status.Disabled` (không tồn tại trong enum → gửi `undefined` → BE bỏ qua, toggle không đổi gì; đã sửa cả FE `team/index.tsx` và BE `designer-team.service.ts` `remove()`).
- `TeamMemberDialog` (mode create/edit):
  - Field: fullName, email, password (chỉ create — có random gen + copy + KeyRound hint), hireDate (date), telegramChatId (optional)
  - Validate email unique BE; block disable/delete khi user còn task active
  - Sub-designer dropdown trong các dialog assign/bulk dùng cùng `designerTeamStore` cache

### 4.1b Active-only cho danh sách + thống kê (user đã tắt)

> Enum `Status` (`packages/shared/enums/commons.ts`): `Active='1'`, `Inactive='0'`, `Pending='-1'`. "Đã tắt" = `status !== Active`.

| Nơi | Loại | Hành vi với user đã tắt |
|-----|------|--------------------------|
| **Picker GÁN MỚI** — `AssigneeSelectCell` (inline), `AssignDesignerDialog` (bulk, đã `listTeam(Status.Active)`) | List-chọn | **Ẩn** khỏi options. `AssigneeSelectCell` vẫn giữ user đã tắt trong options **nếu đơn đang gán cho họ** (hiển thị đúng tên, không mất assignment cũ). BE `assertAssigneeUserValid` chặn gán mới cho user không-active (400). |
| **Filter LỊCH SỬ** — dropdown "Người thực hiện" ở `ErrorLogTab` (store) / `OrderTableWorkshop` / `ListOrderTab` / `PrintOrderTable` (facet BE order-derived) | List-lọc | **Giữ** cả user đã tắt → lọc được đơn cũ theo họ. `designerTeamStore` vẫn `listTeam()` (tải tất cả) để resolve tên đơn cũ. |
| **Thống kê** — `getDesignerBreakdown` (DesignerSummaryPanel), `getPerformance` (leaderboard), `getDailyOverview`, `getTeamDailyBreakdown`, `getProductBreakdown` | Stats | **Chỉ tính user active** (roster `find({ status: Active })` + drop hàng order-derived có assignee không-active; self-scope `userId` vẫn xem được chính mình). Xem thống kê người đã tắt → dùng bộ lọc "Đã tắt" ở trang Team. |

### 4.2 `/my-tasks` (Sub-designer)
Xem 2.3 chi tiết.

**Bảng "Tổng quan theo ngày" (TRÊN "Chi tiết theo ngày"):** `<PipelineDailyOverview lane="designer">` (component dùng chung với Task Fulfillment, xem `FulfillmentWorkflow.md §4.6`). **Funnel TOÀN CỤC** (mọi đơn cả nhà máy, KHÔNG scope assignee — khác `DailyBreakdownPanel` bên dưới vốn chỉ đơn của user) qua endpoint `GET /v1/fulfillment/daily-overview` (auth `OVERVIEW_ROLES` đã gồm Designer). Lane "Designer" bung 5 hàng con: Nhận / Đã xong (`designerDone−designerFixed`) / **Đã sửa** (`designerFixed`, teal) / Còn lại (`received−done−rework`) / Lỗi cần sửa (`designerRework`). Ăn cùng `dateFrom`/`dateTo`; click 1 ngày → `setDateFrom=setDateTo=day` (thu về đúng ngày, đồng bộ kanban + panel). `reloadToken=breakdownToken` (refetch cùng nhịp). `caption` nhắc phạm vi toàn cục.

**Bộ lọc ngày:** chỉ dùng `<DateRangePicker>` (đã bỏ 3 preset nút Hôm nay/7 ngày/30 ngày). State `dateFrom`/`dateTo` **mặc định 7 ngày gần nhất**, **lưu vào URL params `from`/`to`** (F5 giữ lựa chọn — `useSearchParams`, đọc khi mount + sync khi đổi). Gửi `from`/`to` vào `myTasks` + `myTaskFilters` + `myStats({period:'custom', from, to})`.

**Filter bar lưu URL params:** ngoài `from`/`to`, toàn bộ filter bar (`type`/`fabricType`/`machineNumber`/`toolResult`/`toolResultNote`/`userSku`/`errorFile` + `search`) cũng **đọc từ URL khi mount + sync vào URL khi đổi** (cùng 1 `useEffect` sync, `search` sync theo `debouncedSearch`) → F5 giữ nguyên cả bộ lọc. `fetchTasks`/`fetchFilters` gửi `...filters` xuống cả 2 endpoint nên các cột bên dưới + count facet đều lọc theo. **Hai endpoint dùng chung `buildMyTaskFilter` + cùng range `inProductionAt`** ⇒ kết quả `/my-tasks` và `/my-task-filters` luôn đồng bộ.

**Click lại menu "Task của tôi" ở sidebar** khi đang đứng đúng trang này → tự xóa `search`/`filters`/`dateFrom`/`dateTo`/`selected`/`viewUserId` về mặc định (`useSidebarResetSignal`, xem cơ chế chung + bảng trang đã wire ở `Orders.md §20`).

**Chống race khi đổi ngày/filter liên tiếp (seq guard):** `fetchTasks`/`fetchFilters` mỗi lần gọi tăng `tasksSeqRef`/`filtersSeqRef`; khi response về chỉ `setState` nếu `seq` còn là mới nhất, ngược lại bỏ qua. Tránh response cũ về muộn (mạng không đảm bảo thứ tự) ghi đè data mới → trước đây gây "đổi lại ngày thì cột hiển thị loạn". Latency local ~0 nên hiếm lộ; server latency cao lộ rõ.

**Lọc theo `inProductionAt`:** áp `inProductionAt ∈ [from,to]` vào:
- `getMyTasks` (`baseFilter`) → **cả 4 cột kanban + rejected drawer** (header mỗi cột đếm đúng theo filter).
- `getMyTaskFilters` (facet aggregation) → **số đếm dropdown Sản phẩm/Vải/Máy/Kết quả Tool/Khách hàng** cũng đúng theo khoảng ngày.
- `toCard` trả `inProductionAt` (+ `orderAt`/`updatedAt`) → card hiển thị mốc "SX".

⚠️ Đơn open vào sản xuất ngoài khoảng sẽ bị ẩn — chọn khoảng rộng để thấy backlog cũ. **KPI giữ nguyên** (status counts = snapshot; `completedInPeriod` theo `designerCompletedAt`) → có thể lệch nhẹ với cột "Đã xong".

Components con:
- `TaskCard` — drag handle, productionId button (mở `TaskDetailDialog`), mockup thumbnail (mở preview), timestamp + reworkCount badge. Hiển thị thêm (nếu có): **badge "File sửa lỗi"** (`errorFile[]`, resolve name qua `workshop_config` category `error_file_type`) + **"Ghi chú file lỗi"** (`errorFileNote`). Card zod `DesignerTaskCardZod.errorFile/errorFileNote` + `toCard` map từ order. **Badge ưu tiên** (`PriorityBadge`, `@/components/orders/cells/PrioritySelectCell`) ở hàng badge trên cùng (cùng hàng note Tool, TÁCH khỏi hàng productionId — 2026-08-18) khi `card.priority` set + **chip hạn dự kiến** (`getStageDeadline(card.priority, 'designer', designerAssignedAt|designerStartedAt)`, `@/utils/priorityEstimate`) trong hàng thời gian khi status ∈ {Assigned, InProgress} — đỏ nếu quá hạn. Xem `Orders.md §17`.
- `TaskDetailDialog` — header status badge + **badge tên khách `userSku` (nền vàng, cạnh badge trạng thái — 27/11/2026, designer nhìn ngay đơn của nhà đặt nào để cân đối)** + grid info (9 field) + mockup + designs grid 4 cột + timeline (Khách lên đơn `orderAt` → **Vào sản xuất `inProductionAt`** → Được gán → Bắt đầu → Hoàn thành → Cần làm lại/Không làm được) + banner productionError/rejectedReason (banner "Xưởng báo lỗi" resolve **tên lỗi** qua category `production_error` — không hiện raw code kiểu `se-qc-post-press-3`) + **banner "File sửa lỗi"** (`errorFile[]` badge resolve name qua category `error_file_type` + `errorFileNote`). Footer có nút **"Báo khách"** (Designer/DesignerLeader/Admin — `canReportIssue()`) mở `ReportIssueDialog` gửi issue lỗi file sang OnosPod, xem `Orders.md §9f`. Fetch `GET /v1/orders/:id`
- `RejectModal` — **picker chọn designer nhận thay (BẮT BUỘC)** + textarea reason (tùy chọn, max 500). Dùng chung single + bulk. Picker = sub-designer `Active` loại **người đang ôm đơn** (prop `ownerUserId`, mặc định = chính mình; khác khi quản lý xem thay — §4.2a), từ `designerTeamStore`, kèm số đơn đang ôm. Nút submit disabled tới khi chọn người nhận. Xem §2.3b

### 4.2a "Xem task của" — quản lý mở kanban của 1 nhân viên
> File FE: `apps/web/src/pages/designer/my-tasks/index.tsx` (`VIEW_AS_ROLES` + state `viewUserId`/`effectiveViewUserId`, ô select + banner ở header) · `RejectModal.tsx` (`ownerUserId`) · `DailyBreakdownPanel.tsx` (`viewUserId`).
> File BE: `designer-task.service.ts` (`VIEW_AS_ROLES` + `resolveViewUser()`), `designer-task.controller.ts` (truyền `query.viewUserId`).
> Shared: `viewUserId` trong `GetMyTasksZod` / `GetMyStatsZod` / `GetMyDailyBreakdownZod`.

Ô select **"Xem task của"** (icon `Eye`) ở góc phải header, **chỉ hiện với SuperAdmin/Admin/Manager**. Chọn 1 designer → **toàn trang** đổi sang góc nhìn của người đó: kanban 6 cột, rejected drawer, KPI, facet count dropdown, panel "Chi tiết theo ngày". Bỏ trống = task của chính mình (hành vi cũ, mọi role).

Quản lý **thao tác được y như nhân viên** — kéo thả, bulk, báo không làm được — vì `transition`/`bulkTransition` **vốn đã** cho các role này override task của người khác (§5). Không có endpoint mới cho thao tác; chỉ có phần *xem* là mới. Order log ghi actor là **người thao tác** (quản lý), không phải designer bị xem.

Vì thao tác ghi thẳng vào đơn của người khác, header có **banner hổ phách "Đang xem và thao tác trên task của X"** kèm nút "Về task của tôi". Tuyệt đối không bỏ banner: mất nó thì admin quên mình đang ở kanban người khác rồi sửa nhầm đơn.

Bốn ràng buộc phải giữ khi sửa vùng này:

- **`viewUserId` phải đi kèm CẢ 4 endpoint `my-*`** (`my-tasks`, `my-task-filters`, `my-stats`, `my-daily-breakdown`). Thiếu 1 cái là kanban của người A còn KPI/facet của người đang đăng nhập — số đá nhau mà không có lỗi nào nổ ra.
- **`VIEW_AS_ROLES` = `[SuperAdmin, Admin, Manager]`, CỐ Ý không có `DesignerLeader`.** Đây là **giao** của `OVERRIDE_ROLES` (transition đơn lẻ) và danh sách override cứng trong `bulkTransition`. Mở rộng quá giao này thì trang nửa chạy nửa không — kéo được từng card nhưng bulk báo "Task không thuộc bạn". Muốn mở cho leader thì phải sửa **cả hai** chỗ cùng lúc.
- **FE tự bỏ `viewUserId` khi role không được phép** (`effectiveViewUserId`). Link có sẵn `?viewUserId=` dán từ máy admin sang máy designer sẽ rơi về "task của tôi" thay vì 403 cả trang. BE vẫn là nơi chặn thật (`resolveViewUser` ném `Forbidden`).
- **`fullName` trong response `/my-tasks` là tên NGƯỜI ĐƯỢC XEM**, không phải người đăng nhập — tiêu đề trang và banner đều đọc trường này. Đổi ngược lại là admin tưởng đang xem task của mình.

Đổi người xem → **xoá `selected`** (cả ở select lẫn nút thoát banner): giữ lại thì bulk action bắn lên id của designer trước đó. `RejectModal` loại **người đang ôm đơn** (`ownerUserId`) khỏi danh sách nhận thay, không phải loại người đăng nhập — nếu không, khi xem thay thì chính designer đó vẫn nằm trong dropdown và chọn vào là BE trả lỗi "không thể bàn giao cho chính mình". Click lại menu sidebar cũng reset `viewUserId` về rỗng.

### 4.2b `DailyBreakdownPanel` — "Chi tiết theo ngày" (trên /my-tasks)
> File: `apps/web/src/pages/designer/my-tasks/DailyBreakdownPanel.tsx`. Vị trí: **collapsible panel ngay dưới hàng KPI, trên kanban** (mặc định mở). Chỉ đơn CỦA USER hiện tại (scope `/my-daily-breakdown`) — hoặc của người đang được "xem thay" khi prop `viewUserId` có giá trị (§4.2a).

- **Mục đích:** trước đây KPI chỉ hiện tổng; panel này tách số đơn **theo từng ngày vào sản xuất** để designer thấy đơn **chưa làm xong** (đặc biệt đơn tồn cũ).
- **Switcher `7/14/30 ngày`** (state `range`, độc lập với DateRangePicker của kanban) → fetch riêng, seq-guard chống race khi bấm liên tiếp.
- **Summary strip:** `Chưa xong` (tổng assigned+rework+inProgress, amber khi >0) + chip Cần làm / Cần làm lại / Đang làm; bên phải `Đã xong` (emerald, muted).
- **Bảng ngày × trạng thái:** cột `Ngày | Cần làm | Cần làm lại | Đang làm | Đã xong` (`tabular-nums`), sort mới→cũ. Mỗi row:
  - Nền **tô amber theo mức tồn**: `unfinished>0` → nhạt; `unfinished>0 && ageDays>=3` → đậm hơn + **icon ⚠** trước ngày (đơn tồn cũ).
  - Date cell: thứ (T2..CN) + dd/MM + `Hint` tuổi (Hôm nay / Hôm qua / N ngày trước). Số 0 hiện `–` (muted).
  - **Click cả row → lọc kanban về đúng ngày đó** (`onPickDay` set `dateFrom=dateTo=day` ở parent). Row của ngày kanban đang lọc (`from===to===day`) có ring indigo.
  - Footer sticky `Tổng`.
- **Đồng bộ:** parent bump `reloadToken` (state `breakdownToken`) trong `refreshAll()` → panel refetch sau mỗi transition/refresh, số liệu khớp kanban.
- **Lưu ý window:** đếm theo `inProductionAt ∈ [today−(N−1) .. today]` (giống kanban) → đơn tồn ngoài N ngày ẩn; dùng 14/30 để mở rộng.

### 4.3 Dashboard tab Designer (Leader)
Xem `Dashboard.md` mục tab D.

### 4.4 `DesignerSummaryPanel` (trên /orders)
Trên cùng tab List Order + Danh sách đơn khi user có quyền `page.designer_stats`/`designer.task.assign`:
- 7 KPI button-card scoped theo filter list (gồm "Tổng chưa gán" + "Chưa gán không tool"). Toggle xem "tổng" (overall, ignore filter)
- Bảng matrix per-designer collapsible — click cell → set filter list (`handleSummaryCellClick`)
- Auto refetch khi filter list đổi (cùng query string)

### 4.4b `DesignerBacklogDialog` — modal "Chi tiết tồn đọng theo ngày"
> File: `apps/web/src/components/orders/DesignerBacklogDialog.tsx`. Trigger: nút **"Chi tiết tồn đọng"** cạnh `DesignerSummaryPanel` (gate `canSeeDesignerSummary`) trong `OrderTableWorkshop.tsx`.

- Mở modal → fetch `GET /v1/orders/designer-backlog` (MỌI ngày, không theo filter trang — backlog cần thấy đơn cũ).
- **Cây 2 cấp** (modal CHỈ hiện counts, không kéo task): Designer (gập, mặc định mở người tồn nhiều nhất) → từng **ngày `inProductionAt`** với badge **màu theo tuổi** (`ageMeta`: hôm nay=xanh, 3-7d=vàng, 8-15d=cam, >15d=đỏ) + tổng + chip mỗi trạng thái (Chưa gán/Đã gán/Đang làm/Làm lại — **"Không làm được"/rejected KHÔNG tính là tồn**).
- **Layout rộng** (`max-w-5xl`): designer chia **2 cột** (`lg:grid-cols-2`, round-robin chẵn/lẻ → 2 cột độc lập, card cao không kéo lệch cột kia). Header có nút **"Mở rộng hết / Thu gọn hết"** (`toggleAll`) + ô tìm designer.
- **Drill xem task ở bảng chính** (`onDrillDay` → `handleBacklogDrill` ở `OrderTableWorkshop`): click **vùng ngày** → lọc `assignee + ngày` (mọi trạng thái); click **1 chip trạng thái** → lọc `assignee + ngày + đúng status đó` (chính xác, loại done). Đóng modal → bảng hiện task; thanh chip "Đang lọc" hiện filter vừa set. `__unassigned__` → map `__none__`; `__nodate__` → clear filter ngày.
- Header: tổng task chưa xong + ngày cũ nhất + ô tìm designer (lọc client-side).

### 4.5 `AssignDesignerDialog` (bulk assign từ workshop)
Xem 2.2.

### 4.6 `AssigneeSelectCell` (cell "Người thực hiện")
- Load designer team từ `designerTeamStore` (lazy fetch 1 lần)
- Value = user._id, display = fullName (fallback `#{slice(-4)}` nếu user bị xoá)
- Dùng `SelectPopover` generic-ized với `SelectOption = { _id, code, name, color?, icon?, errorSource? }`
- Prop `blockedReason?: string` — khi set (vd đơn `toolResultNote='ok'` qua `workshopTableConfig.tsx`) → cell disabled + opacity-60 + tooltip lý do (xem §2.2 chặn gán đơn 'ok')

### 4.7 `ProductionErrorSelectCell` + `ProductionErrorOtherDialog`
- Popover option list có badge "DES" (violet) / "XƯỞNG" (sky) cho code có errorSource, "CẦN CHI TIẾT" (rose) cho code='other'
- Pick code thường → updateField, BE auto-fill source
- Pick 'other' → mở dialog yêu cầu pick source + note → atomic `setProductionError` endpoint
- Dialog pre-fill source/note cũ nếu đã từng set

### 4.8 `ErrorSourceCell` (cell "Loại lỗi" mới)
Picker designer/factory cho `order.productionErrorSource`. User override được khi cần.

---

## 5. Backend logic

### 5.1 Owner check + override
`DesignerTaskService.transition()`:
- Resolve `roleName`. Admin/Manager/Leader = override, bypass owner check
- Sub-designer phải có `order.assignee === String(user._id)`
- Throw `ForbiddenException` nếu fail

### 5.2 Race safety
- `findOneAndUpdate({ _id, designerStatus: expectedCurrent }, patch)` — nếu state đã đổi → match=null → `ConflictException` (FE refetch + retry)
- Bulk variant áp pattern same cho từng row

### 5.3 Auto-fill `productionErrorSource`
`order.service.updateField('productionError', code)`:
1. Lookup `workshop_config.errorSource` cho code
2. Nếu config có flag → set `order.productionErrorSource`
3. Nếu code='other' → để user pick qua dialog (atomic endpoint)
4. Nếu source='designer' AND status=done → set rework + `$inc designerReworkCount`
5. Luôn set `toolResultNote='error'` + `$inc productionErrorCount` (khi non-null)
6. Giữ `readyForFulfill` không đổi (mềm hoá invariant để fulfillment vẫn thấy đơn lỗi trong list mặc định)

### 5.4 Per-cycle work time
`resolveTransition(current, action, reason, { isFirstStart, designerStartedAt })`:
- `start` (assigned→in-progress): set `designerStartedAt=now`. Nếu `isFirstStart` → set `designerFirstStartedAt=now`
- `restart` (rework→in-progress): set `designerStartedAt=now` (reset per-cycle)
- `complete` (in-progress→done): `designerCompletedAt=now` + `$inc designerWorkMs += (now − startedAt)`

### 5.5 Visibility filter
`OrderService.buildVisibilityFilter(roleName, dto, assigneeUserId, fulfillmentFactoryId)`:
- `Designer` (sub) → `filter.assignee = user._id` (no date window)
- `Fulfillment` → `filter.readyForFulfill=true` + `$or: [{factoryId: uid}, {originalFactoryId: uid}]` (cả 2 xưởng thấy đơn transfer)
- Khác → no extra constraint (optional date range)

### 5.6 Bulk transition logic
`bulkTransition(user, ids, action, reason, ctx)`:
- Fetch tất cả docs với selected fields (productionId, assignee, designerStatus, designerStartedAt, designerFirstStartedAt)
- Loop per doc, owner check, `resolveTransition`, `findOneAndUpdate` race-safe
- Skip + report: owner fail, race conflict, action invalid → return `{matched, modified, skipped[{orderId, productionId, reason}]}`
- Audit log mỗi transition + side-effect

### 5.7 Stats aggregation

**`getMyStats`** (sub-designer):
- snapshot count theo status (current) + completed count trong period + `fixedInPeriod` (completed có reworkCount>0)
- **`rejectedCount`** = `countDocuments({ 'designerRejections.fromUserId': userId })` (all-time) = số đơn user từng báo không làm được rồi bàn giao đi — KHÔNG còn lấy từ `designerStatus='rejected'`
- avgResponseMin: trung bình `designerFirstStartedAt − designerAssignedAt` (fallback `designerStartedAt`)
- avgWorkMin: trung bình `designerWorkMs` (fallback `(completedAt − startedAt)` cho legacy data)

**`getPerformance`** (leader leaderboard):
- snapshot count per (assignee, status) → 4 cột (assignedCount, inProgressCount, reworkCount, rejectedCount)
- completed in period với timestamps + workMs cumulative; **`fixedInPeriod`** = subset completed có `designerReworkCount>0` (đếm trong cùng loop completedDocs)
- Auto-include sub-designer chưa có task (row count 0)
- **`totalRework`**: aggregate `OrderLog { field='designerStatus', after='rework', createdAt in period } → $lookup orders → group by assignee`
- **`totalRejected`**: aggregate `orders` `$unwind designerRejections` → `$match at in period (+ fromUserId nếu scope)` → group by `fromUserId` (quy ĐÚNG người bàn giao, kể cả khi đơn đã sang tay người khác — không dùng OrderLog vì log group theo assignee hiện tại sẽ sai)

**`getErrorStats`**:
- Group `(productionError, productionErrorSource)` per-order trong period (theo `updatedAt`)
- bySource: designer/factory/unknown (đếm theo field per-order, KHÔNG còn lookup config)
- byCode aggregate sum across sources

**`getDesignerBreakdown`** (panel /orders):
- scoped: KPI count theo filter list hiện tại (`buildOrderListFilter`)
- overall: ignore filter (chỉ visibility/date)
- perDesigner matrix (assignee × status), auto-include designer + pseudo row `__unassigned__`
- **"Chưa gán" panel = "Chưa gán KHÔNG tool":** bucket `unassigned` (KPI + matrix) CHỈ đếm đơn `designerStatus ∈ {unassigned,null}` & `toolResultNote≠'ok'` & `toolResult` **KHÔNG** thuộc nhóm "Có tool" (name `^Có` = `resolveToolHasCodes()`). Aggregation 3 nhánh (`$let`/`$cond` trong `$group._id`, cần `toolHasCodes`): unassigned & `ok` → `__skip_unassigned__` (bỏ hẳn); unassigned & "có tool" → `__unassigned_withtool__` (N — chỉ cộng `unassignedAll`); còn lại → `unassigned` (M — vào `unassigned` + `unassignedAll` + `total`). Đơn **đã gán** KHÔNG bị ảnh hưởng. ⇒ `counts.unassigned` = M (= dropdown "Chưa gán · không tool"). Matrix skip cả `__skip_unassigned__` + `__unassigned_withtool__` (chỉ hiện M).
- **Field `unassignedAll` (mới, shared `DesignerStatusCountsZod`) = N+M** = tổng chưa gán (cả có tool + không tool, vẫn loại 'ok'). KPI strip panel có card **"Tổng chưa gán"** (`KPI_COLS[0]`, key `unassignedAll`) đứng **TRƯỚC** card "Chưa gán không tool"; click → filterValue `'unassigned'` (list = chưa gán & note≠'ok' = N+M). Matrix KHÔNG hiện card tổng (chỉ `STATUS_COLS`).
- **Filter list khi click "Chưa gán":** `buildOrderListFilter` khi `designerStatus` CHỈ nhắm `unassigned`/`__none__` → push `$and: [{ toolResultNote: { $ne: 'ok' } }]`. (Token `__unassigned_notool__` xử lý riêng — xem dưới.)
- **Dropdown "TT Designer" tách "Chưa gán" theo tool** (`getWorkshopAvailableFilters`): option `unassigned` đơn được THAY bằng 2 option token:
  - `__unassigned_notool__` = "Chưa gán · không tool" (M) = chưa gán & `toolResultNote≠'ok'` & `toolResult` **KHÔNG** thuộc nhóm "Có tool", **gồm cả đơn chưa soát toolResult** (`$nin` match null/empty/missing).
  - `__unassigned_tool__` = "Chưa gán · có tool" (N) = chưa gán & note≠'ok' & `toolResult ∈` nhóm "Có tool".
  - **M = đúng KPI panel "Chưa gán không tool"** (cùng công thức). N chỉ hiện trong dropdown (không lên panel/total). Count tính bằng 1 aggregate `$cond $in toolHasCodes` (strip `designerStatus` — cross-narrow).
  - `buildOrderListFilter` nhận param mới `toolHasCodes?: string[]` để xử lý 2 token (caller `getOrders`/`getOrdersGroupedByType`/`exportOrders` resolve async khi `designerStatus` chứa `__unassigned_`; `getWorkshopAvailableFilters` + `getDesignerBreakdown` resolve luôn).
  - **FE:** ô KPI panel `unassigned` đổi label **"Chưa gán không tool"** + `filterValue='__unassigned_notool__'` → click KPI strip **và** matrix cell đều lọc đúng nhóm không-tool (khớp số M). Chip + SelectFilter resolve label token từ facet options.

### 5.8 OrderLog audit
Mỗi transition ghi entry `{ field: 'designerStatus', before, after, action: 'update' }` + side-effect entries (vd `toolResultNote: 'ok'` khi complete). Bulk transition gọi `writeMany`. Backfill design status không ghi log (silent).

### 5.9 Backlog tồn đọng (`OrderService.getDesignerBacklog`)
1 aggregate: `$match` (`buildVisibilityFilter` no-date + `cancelledAt` không tồn tại + `designerStatus $nin [done, rejected]` — `$nin` match cả doc thiếu field = unassigned; **"Không làm được"/rejected loại khỏi tồn**, nằm ở backlog "Cần gán") → `$group` theo `{ assignee (ifNull `__unassigned__`), day ($dateToString `inProductionAt` tz `+07:00`, thiếu → `__nodate__`), status }`. JS gom thành cây designer → days, tính `ageDays` (vnDayStart today − day), sort ngày cũ→mới + designer total desc (Chưa gán cuối). Resolve `fullName` từ `userModel`. Không kéo task (modal chỉ counts) → payload nhỏ; index `assignee`/`inProductionAt`/`designerStatus` đỡ scan.

---

## 6. Performance notes

- **Designer team list query**: filter `{ roleId: designerRoleId }` + 2 aggregate count tasks (active/completed). 8 designer × ~few hundred tasks → < 50ms.
- **My tasks query**: 5 song song find with sort, mỗi cột scope user._id + status. Mỗi user thường < 100 task → < 30ms.
- **Faceted my-task-filters**: 5 aggregate independent (type/fabricType/machineNumber/toolResult/userSku — mỗi facet exclude khỏi filter để cross-narrow count đúng). Run parallel ~50ms.
- **Performance leaderboard**: 3 aggregate (status snapshot + completed docs + OrderLog totals) parallel + user/role lookups. 1000 order × 30d → < 200ms.
- **Auto-rework hook**: thêm 1 workshop_config findOne per `updateField('productionError')`. Cache miss < 10ms (collection nhỏ).
- **Race-safe transitions**: `findOneAndUpdate filter` cost 1 query (no read-then-write). Concurrent users hiếm trên 1 task — 409 happen edge case.
- **No pagination cho /my-tasks**: assumption sub-designer < 200 active task. Nếu vượt → cần thêm pagination.

---

## 7. Permissions

| Role | Page access | Action |
|---|---|---|
| **SuperAdmin/Admin** | All | All transitions + assign + override + **"Xem task của"** trên `/my-tasks` (§4.2a) |
| **Manager** | All | Same as Admin |
| **DesignerLeader** | `/designer/team`, `/my-tasks`, `/dashboard?tab=designer`, `/orders`, `/workshop-config` | CRUD team, assign, override transitions, transfer orders, edit toolResultNote/assignee |
| **Designer** (sub) | `/dashboard`, `/orders`, `/my-tasks` | Transition own task only, KHÔNG edit assignee/toolResultNote (BE auto derive) |
| **Fulfillment** | `/dashboard`, `/orders` (scoped factory) | Edit printStatus*, productionError*, machineNumber. Transfer orders. KHÔNG transition designer task. Scope theo `user.factoryId` |
| **Support** | `/dashboard`, `/orders` | View only most fields, không edit designer-related |

Field-level perms (mới):
- `order.field.designerStatus.view` — Admin/Manager/Designer/Leader/Fulfillment
- `order.field.productionErrorSource.view/.edit` — Admin/Manager/Leader/Fulfillment

---

## 8. Migration history (one-shot endpoints)

| Endpoint | Khi nào chạy | Tác dụng |
|---|---|---|
| `POST /v1/designer/migrate-leader` | Sau khi deploy Phase 1 | Promote user Designer cũ duy nhất → Leader, đổi email |
| `POST /v1/orders/backfill-designer-status` | Sau khi deploy Phase 3 | Suy ra `designerStatus` + timestamps cho order legacy |

**Auto-cleanup khi boot:**
- `RoleService.onModuleInit()` sync role catalog (auto-add DesignerLeader, rút quyền cũ của Designer sub)
- `WorkshopConfigService.onModuleInit()` `deleteMany({ category: 'assignee' })` 1 lần (legacy category đã bỏ)
- Cùng onModuleInit backfill `errorSource` cho production_error rows chưa có
