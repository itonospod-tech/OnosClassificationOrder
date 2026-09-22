# Fulfillment 6-Stage Workflow — Function Description

> **File FE:** `apps/web/src/pages/fulfillment/my-tasks/`, `apps/web/src/services/fulfillment.ts`, `apps/web/src/pages/users/index.tsx` (form chọn `fulfillmentStage`)
> **File BE:** `apps/api/src/modules/fulfillment/` (full module), hook ở `apps/api/src/modules/designer/designer-task.service.ts` → `transition()` > **Route FE:** `/fulfillment/my-tasks` > **API:** `POST /v1/orders/:id/fulfillment-transition`, `GET /v1/fulfillment/my-tasks`

---

## 1. Overview

> **Loại đơn xưởng US (2026-07):** đơn xưởng `US` không bao giờ được init stage In (guard ở cả 3 entry: designer complete, set `toolResultNote='ok'`, importRework + backfill onModuleInit) và bị loại khỏi view override-role của my-tasks — xem `Orders.md §21`.

> **Đường ghi state DUY NHẤT KHÁC ngoài `transition()`:** thao tác **"Chuyển hoàn thành"** của SuperAdmin (`Orders.md §23`) ghi thẳng `fulfillmentStages.*` + `fulfillmentCompletedAt` cho các công đoạn chưa xong, mốc chia đều từ lúc đơn vào sản xuất tới lúc bấm. Nó cố ý KHÔNG đi qua `transition()` (vốn đòi đúng người giữ công đoạn + đúng thứ tự `waiting → in-progress → done`), nhưng vẫn ghi `fulfillmentTimeline` + tôn trọng AUTO-STAGE của `flowType` và KHÔNG cộng `workMs`. Sửa shape state ở đây thì soát luôn `order.service.ts → forceCompleteOrder()`.


Sau khi Designer mark task `done` (`designerStatus === 'done'` + `readyForFulfill === true`), đơn được auto-route qua **6 stage tuần tự** trong phạm vi factory:

```
Designer done → In → Ép → QC sau ép → May nhận vào → May xuất ra → Đóng hàng → completed
                ↑    ↑       ↑              ↑              ↑             ↑
              mỗi stage có DUY NHẤT 1 user phụ trách per factory
              (BE enforce unique constraint (factoryId, fulfillmentStage))
```

| #   | Label UI          | Code enum       | Vai trò                       |
| --- | ----------------- | --------------- | ----------------------------- |
| 1   | In                | `print`         | In tem/mockup                 |
| 2   | Ép                | `press`         | Ép nhiệt lên vải              |
| 3   | QC sau ép         | `qc-post-press` | Kiểm hậu ép (chất lượng in)   |
| 4   | May nhận vào      | `sew-in`        | Tiếp nhận hàng vào tổ may     |
| 5   | May xuất ra       | `sew-out`       | Xuất hàng đã may xong khỏi tổ |
| 6   | Đóng hàng         | `pack`          | Đóng gói + chuẩn bị ship      |

- 2 xưởng × 6 stage = **12 user Fulfillment** trong hệ thống.
- Đơn đến stage X → tự nhảy vào "Task của tôi" của user X tại factory đó.
- Mỗi stage có 4 trạng thái: `waiting`, `in-progress`, `done`, `rework`.
- Khi báo lỗi, có thể đẩy về **Designer** hoặc **bất kỳ stage nào trước** đó.

**Refactor history (5 → 7 → 8 → 6 stage):** QC cũ từng tách thành `qc-post-press` + `qc-sorting`; May cũ tách thành `sew-in` + `sew-out`; thêm `qc-post-sew` ("QC sau may"). Sau đó **bỏ `qc-sorting` (QC phân hàng kiểm) + `qc-post-sew` (QC sau may)** → còn 6 stage. `Pack` đổi label "Đóng gói" → "Đóng hàng" (code không đổi). **Xử lý đơn tồn khi bỏ stage:** `qc-post-sew` chưa có đơn nào → xoá thẳng khỏi enum/schema; đơn tồn ở `qc-sorting` **migrate TIẾN về `sew-in`** (status=waiting) — có cả (a) mongo script chạy tay + (b) backfill idempotent trong `OrderService.onModuleInit()` (`updateMany({currentFulfillmentStage:'qc-sorting'}, [{$set: currentFulfillmentStage='sew-in', 'fulfillmentStages.sew-in' waiting}])`, match=0 sau lần đầu). Dữ liệu cũ mang enum đã bỏ (`qc-sorting`/`qc-post-sew`/`qc`/`sew`) không nằm trong enum mới → **mất visibility** nếu không migrate. Toàn bộ auto-advance/rework-back data-driven qua `FULFILLMENT_STAGES` + `FULFILLMENT_STAGE_ORDER` (index đánh lại 0–5) nên chỉ cần sửa enum nguồn. **User worker cũ** `fulfillmentStage IN ('qc-sorting','qc-post-sew')` cần admin reassign/disable tay (không auto-clean).

---

## 2. Luồng hoạt động

### 2.1 Vào fulfillment lần đầu

Có **2 entry point** tương đương — đều dẫn tới việc set `currentFulfillmentStage='print'` + `fulfillmentStages.print = { status: 'waiting', reworkCount: 0, workMs: 0 }` → user In của factory tự thấy đơn trong tab "Đang chờ".

#### Entry A — Designer hoàn thành task (mặc định)

1. Designer click "Hoàn thành" (`designer-transition action=complete`).
2. Hook trong `DesignerTaskService.transition()` (~line 83): nếu `!order.currentFulfillmentStage` → set entry patch.
3. Đồng thời `toolResultNote='ok'` + `readyForFulfill=true` được set (side effect).

#### Entry B — Manual set `toolResultNote='ok'` (admin/leader bypass)

Khi admin/leader/support trực tiếp đổi cell **"Note kq Tool 1"** thành `'ok'` (không qua designer state machine) — các path sau cùng kích hoạt fulfillment:

| Path                                                  | File                                                             | Hành vi                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /v1/orders/:id` field=`toolResultNote`         | `OrderService.updateField()` (`order.service.ts` ~line 2347)     | Set `readyForFulfill=true` + `productionFirstErrorAt=null`. Nếu `!before.currentFulfillmentStage` → spread `buildFulfillmentEntrySet()` vào patch. |
| `PATCH /v1/orders/bulk-update` field=`toolResultNote` | `OrderService.bulkUpdateField()` (`order.service.ts` ~line 2572) | Sau update chính, chạy thêm 1 `updateMany` cho subset `currentFulfillmentStage` null/undefined.                                                    |
| Import xlsx "soát" (`Note_kq_Tool` cell = `ok`)       | `OrderService.importRework()` (`order.service.ts` ~line 2929)    | Per-row check `!order.currentFulfillmentStage` → merge entry patch vào `$set`.                                                                     |

**Helper:** `buildFulfillmentEntrySet()` constant ở đầu file (`order.service.ts:155`) — đảm bảo 3 path dùng cùng shape. Đồng bộ với Entry A.

**Đặc biệt:** Entry B chỉ kích hoạt khi `currentFulfillmentStage` đang null/undefined để **tránh ghi đè state đang chạy**. Nếu đơn đã ở stage Press/QC/... mà admin sửa cell ok bằng tay → chỉ flip `readyForFulfill`, không reset state fulfillment.

### 2.2 Tiến qua từng stage

User Print mở `/fulfillment/my-tasks`:

- **Đang chờ** → bấm "Bắt đầu" → `POST /orders/:id/fulfillment-transition { stage: 'print', action: 'start' }`
  - Stage status: `waiting` → `in-progress`, `startedAt = now`, `firstStartedAt` set (lần đầu).
- **Đang làm** → bấm "Hoàn thành" → `action: 'complete'`
  - Stage status: `in-progress` → `done`, `completedAt = now`.
  - `workMs += (now - startedAt)`.
  - **Auto-advance**: `currentFulfillmentStage = 'press'`, `fulfillmentStages.press.status = 'waiting'`.
  - User Press tự thấy đơn.

Tiếp tục Press → QCPostPress → QCSorting → SewIn → SewOut → QCPostSew → Pack. Khi Pack `complete`:

- `currentFulfillmentStage = null`
- `fulfillmentCompletedAt = now`
- Đơn hoàn thành toàn bộ workflow.

### 2.2b Luồng rút gọn theo xưởng (`FactoryEntity.flowType` — 2026-08)

Mỗi xưởng chọn 1 luồng ở select "Luồng sản xuất" tab Xưởng `FactoryTab.tsx` (Products.md §3.2). Cơ chế chung: mỗi `flowType` có 1 tập **AUTO-STAGE** (`FACTORY_FLOW_AUTO_STAGES` trong `packages/shared/enums/factory-flow.ts`) — khi 1 công đoạn hoàn thành, mọi công đoạn kế tiếp LIÊN TỤC nằm trong tập auto tự Done cùng thời điểm (vòng `while` trong `resolveTransition()` case Complete), đơn dừng ở công đoạn thường đầu tiên sau đó:

- **`standard`** (mặc định): đủ 6 công đoạn tuần tự, không auto gì.
- **`merged`** (xưởng gỗ — TNW): auto = {`press`, `sew-out`}. **In complete → Ép tự Done** → QC; **May vào complete → May ra tự Done** → Đóng hàng.
- **`no-sew`** (xưởng Mê Linh): auto = {`sew-in`, `sew-out`}. **QC sau ép complete → May vào + May ra tự Done liên tiếp** → đơn CHỜ ở Đóng hàng (Đóng hàng vẫn xác nhận tay). In/Ép/QC nửa đầu giữ nguyên tuần tự.
- **`press-complete`** (xưởng DTF Mê Linh — 2026-09-18): auto = {`qc-post-press`, `sew-in`, `sew-out`, `pack`}. Chỉ 2 công đoạn tay **In → Ép**; **Ép complete → QC + May vào + May ra + Đóng hàng tự Done cùng lúc** → đơn KẾT THÚC fulfillment ngay (`fulfillmentCompletedAt` + bắn `production_completed` như đóng tay). KHÁC các flow trên: **Pack nằm THẲNG trong tập auto của flow** — chọn flow này là đủ, KHÔNG cần bật thêm toggle `autoCompletePack` (§2.2c). Rework-back nhắm QC/May/Đóng hàng đều lùi về **Ép**. Chỉ áp đơn chảy tới TỪ LÚC BẬT — đơn tồn ở QC/Đóng hàng xưởng tự xác nhận nốt tay. Thường đi kèm cờ `skipToolCheck` (§2.2d) để thành luồng trọn vẹn "lên đơn → In → Ép → xong".

Chi tiết auto-complete (trong `resolveTransition()` case Complete, `fulfillment-task.service.ts`):

- Auto-stage được ghi **ĐỦ state**: `status='done'`, `waitingAt=startedAt=firstStartedAt=completedAt=now` (mọi phép trừ duration ra 0 thay vì NaN), `workMs=0`, `assignee` = worker công đoạn vừa xong; push riêng 1 `fulfillmentTimeline` entry mỗi stage (`byUserId` = worker đó, `reason='Tự động hoàn thành (luồng rút gọn)'`).
- Vòng rework (auto-stage từng `completedAt`): auto-complete lại set `reworkAt` + `$inc reworkCount` — khớp ngữ nghĩa auto-advance thường.
- **Rework-back redirect**: đích lùi là auto-stage → tự lùi tiếp về công đoạn thường gần nhất phía trước (`redirectAutoTarget` — merged: press→print, sew-out→sew-in; no-sew: sew-in/sew-out→qc-post-press) ở CẢ 2 đường: `resolveTransition()` case ReworkBack (kanban/dialog) + `OrderService.buildFulfillmentReworkBack()` (scan lỗi / danh mục lỗi công đoạn `reworkTarget` / admin) — đơn không bao giờ dừng ở auto-stage nên lùi về đó sẽ kẹt (xưởng không có worker giữ).
- Nhận diện flow của xưởng: cache process-wide `utils/merged-flow-factory.ts` (`getFactoryFlowTypeSync` trả `FactoryFlowType`, TTL 60s, load `loadFactoryFlowTypes` ở `OrderService.onModuleInit` — pattern `excluded-factory.ts` nhưng theo field `flowType`, KHÔNG hardcode shortName).

**Vận hành:** xưởng rút gọn không cần user giữ các auto-stage (merged: bỏ Press/SewOut → 4 worker; no-sew: bỏ SewIn/SewOut — unique index partial cho phép thiếu). Với xưởng TẠO MỚI: bật flag trước khi cho đơn chảy vào — bật muộn thì đơn đã lỡ nằm ở auto-stage sẽ kẹt nếu xưởng không có worker stage đó (admin override cứu được). Với xưởng ĐANG CHẠY chuyển sang `no-sew` (Mê Linh): đơn đang nằm ở May vào/May ra KHÔNG kẹt nếu vẫn còn worker may — worker complete nốt là đơn tự trôi (May vào xong → May ra auto vì thuộc tập auto → Đóng hàng), sau đó 2 công đoạn may không nhận đơn mới nữa. Mọi màn hình giữ nguyên 6 công đoạn; auto-stage hiển thị Done tức thì. Unit tests: `fulfillment-transition-merged.spec.ts` (23 test: merged + no-sew + press-complete + standard + toggle autoPack).

### 2.2c Toggle "Tự hoàn thành Đóng hàng" theo xưởng (`FactoryEntity.autoCompletePack` — 2026-08-27)

Toggle **ĐỘC LẬP với `flowType`** (bật được cho mọi loại luồng, kể cả standard): bật → đơn chảy tới công đoạn **Đóng hàng tự Done luôn** — đơn kết thúc fulfillment (`currentFulfillmentStage=null` + `fulfillmentCompletedAt`), bắn `order.production_completed` (webhook + noti khách) y như đóng tay. Cơ chế TÁI DÙNG đúng vòng auto-stage §2.2b: `isAutoStage(flow, stage, autoPack)` / `redirectAutoTarget(flow, target, autoPack)` nhận thêm tham số thứ 3 (`packages/shared/enums/factory-flow.ts`); timeline entry ghi `reason='Tự động hoàn thành (xưởng bật tự xong Đóng hàng)'` để phân biệt với auto của luồng rút gọn.

- **UI**: tab Xưởng `FactoryTab.tsx` — switch "Tự hoàn thành Đóng hàng" trong dialog sửa xưởng (badge xanh "Tự xong Đóng hàng" ở bảng) + nút **"Hoàn thành đơn tồn ở Đóng hàng"** (chỉ mode edit).
- **Toggle CHỈ áp đơn MỚI chảy tới** — đơn đang tồn ở Đóng hàng không tự xong. Dọn tồn 1 lần bằng nút trên → `POST /fulfillment/complete-pack-backlog {factoryId}` (`@Auth([SuperAdmin, Admin])`): tìm mọi đơn `currentFulfillmentStage='pack'` status waiting/rework/in-progress (loại đơn hủy) → chạy qua `bulkTransition` start-complete từng đơn (giữ đủ hook; đơn giữ/hold fail riêng nó với message rõ, trả `{total, ok, fail, failures}`).
- Cache sync: `merged-flow-factory.ts` mở rộng — cùng query/TTL 60s load thêm `autoCompletePack` (`getFactoryAutoPackSync`); admin bật/tắt áp dụng chậm nhất sau 60s.
- Rework/báo lỗi nhắm về Đóng hàng khi toggle ON → redirect lùi về công đoạn thường gần nhất (standard: May ra; no-sew: QC sau ép) — cả `resolveTransition` lẫn `buildFulfillmentReworkBack`; "Chuyển hoàn thành" (`force-complete-plan.ts`) cũng coi pack là khâu auto (không chiếm lát thời gian). Unit tests: describe "Toggle autoCompletePack" trong `fulfillment-transition-merged.spec.ts`.

### 2.2d Cờ "Bỏ qua soát tool" theo xưởng (`FactoryEntity.skipToolCheck` — 2026-09-18)

Toggle **ĐỘC LẬP với `flowType`** (switch "Bỏ qua soát tool" trong dialog sửa xưởng `FactoryTab.tsx`, badge xanh dương "Bỏ soát tool" ở bảng): đơn **MỚI** import/push vào xưởng này được coi là đã soát xong ngay lúc tạo — mở thêm **Entry C** vào fulfillment bên cạnh Entry A (designer complete) và Entry B (`toolResultNote='ok'` tay):

- **Cơ chế**: trong `OrderService.importOrders()`, sau khi resolve `factoryId` (gồm cả override gán xưởng theo khách), nếu xưởng bật cờ → `$setOnInsert` stamp: `toolResultNote='ok'` + `toolCheckedAt=now` + `readyForFulfill=true` + `buildFulfillmentEntrySet()` (In waiting). Nằm trong `$setOnInsert` nên **re-import KHÔNG reset đơn đang chạy**; xưởng US không bao giờ được stamp (guard `getExcludedFactoryIdSync`).
- **Hệ quả dây chuyền tự khớp**: auto-gán designer bỏ qua (ứng viên yêu cầu `toolResultNote != 'ok'`); lifecycle funnel/badge/thống kê coi đơn đã qua chặng soát tool tại `toolCheckedAt`.
- **Tool soát TỰ ĐỘNG loại hẳn xưởng này (fix 2026-09-22)**: stamp 'ok' KHÔNG đủ để né tool ngoài — hàng đợi `getNextDesignReviewOrder` lọc theo `toolResult` (field automation, luôn rỗng lúc tạo) chứ không phải `toolResultNote`, nên trước đây đơn xưởng skip (nhất là đơn CŨ import trước khi bật cờ, không được stamp) vẫn bị tool soát lại + ghi đè kết quả. Fix 2 lớp: hàng đợi + `remaining` loại `factoryId $nin` danh sách xưởng bật cờ (`listSkipToolCheckFactoryIdsSync` — cùng cache TTL 60s), và `setDesignReviewResult` chặn 400 mọi đường ghi (kể cả `pid` tra thẳng/claim treo từ trước) cho đơn thuộc xưởng skip — muốn đổi kết quả thì nhân viên sửa tay ở Danh sách đơn.
- **Đường lỗi giữ nguyên**: công nhân In/Ép báo lỗi nguồn designer/tool-check thì đơn vẫn rơi về designer (auto-gán đơn rework chưa ai ôm) / Support làm lại rồi re-flow từ In như mọi xưởng.
- Cache sync: cùng query/TTL 60s ở `merged-flow-factory.ts` (`getFactorySkipToolCheckSync` + `listSkipToolCheckFactoryIdsSync`) — admin bật/tắt áp dụng chậm nhất sau 60s; stamp chỉ ảnh hưởng đơn tạo sau đó, còn loại-khỏi-hàng-đợi áp NGAY cho mọi đơn của xưởng.
- Đang bật cho: **DTF Mê Linh (MLDTF)** cùng flowType `press-complete` → luồng trọn vẹn: khách lên đơn → push → In → Ép → hoàn thành (E2E 20/20: import CSV khách → push vào thẳng cột In không designer → In complete → Ép complete → 4 khâu sau tự Done workMs=0 → portal khách hiện Fulfilled).

### 2.2e Cờ "Tự trừ tồn kho sau in label" theo xưởng (`FactoryEntity.autoStockOut` — 2026-09-21)

Toggle ĐỘC LẬP thứ tư trên xưởng (switch trong cùng dialog `FactoryTab.tsx`, badge vàng "Tự trừ kho"): bật → tại trạm quét, sau khi in label giao hàng của đơn thì FE tự gọi `POST /inventory/scan-out` trừ tồn kho phôi theo đơn (mặc định TẮT — quét `ACT-STOCK-OUT` xác nhận tay). Trừ idempotent theo đơn nên in lại không trừ đúp. Chi tiết toàn bộ module tồn kho: [`Inventory.md`](Inventory.md).

### 2.3 Báo lỗi (rework-back)

Trong tab "Đang làm", bấm "Báo lỗi" mở dialog:

- Chọn target: **Designer** hoặc **1 stage trước đó** (chip selectable).
- Nhập lý do (bắt buộc, max 500 ký tự).

`POST /orders/:id/fulfillment-transition { stage: <mine>, action: 'rework-back', target, reason }`:

| Target               | Effect                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'designer'`         | `designerStatus = 'rework'`, `productionErrorSource = 'designer'`, `productionErrorNote = reason`. Reporter stage về status=`waiting` (workMs cộng dồn, reworkCount++), assignee giữ nguyên. Đơn nằm ở tab **"Đang chờ quay lại"** của reporter (match nhờ `designerStatus='rework'`). **Sau khi Designer complete:** hook `DesignerTaskService.transition()` set reporter stage = `rework` (nếu stage đã từng chạy — `firstStartedAt`/`completedAt`) → tab **"Cần làm lại"**; hoặc `waiting` (nếu stage chưa từng chạy, vd chưa hề in) → tab **"Đang chờ"** (§5.4 Entry A). |
| `<previous stage X>` | `currentFulfillmentStage = X`. **CHỈ target X** → `status='rework'`, `reworkCount++`, `reworkAt`, `reworkFromStage=reporter` (X hiện tab "Cần làm lại"). **Các stage giữa X và reporter GIỮ `done`/`completedAt`** (lịch sử) → positional tab-filter cho chúng vào **"Đang chờ quay lại"** (watching) khi đơn đang upstream; auto-advance `reworkCount++` khi đơn thực sự quay về từng stage → **"chạy lại toàn chuỗi"** mà không double-count. Reporter → `status='waiting'`. |

> **Chạy lại toàn chuỗi (positional):** thay vì đánh dấu tất cả stage lùi = `rework` ngay (đơn chưa tới nơi), giờ chỉ target = rework; các công đoạn đã-xong phía sau target hiển thị **"Đang chờ quay lại"** cho tới khi đơn re-flow về đúng lượt (mỗi stage khi nhận lại → `reworkCount++` qua auto-advance → hoàn thành → "Đã sửa"). Xem `documents/Plans/UpstreamWatching-ReflowChain.md`.

#### 2.3b Báo lỗi designer qua cell "Lỗi xưởng" (tương đương rework-back target=designer)

Worker KHÔNG bắt buộc dùng nút "Báo lỗi": chọn cell **"Lỗi xưởng"** (`productionError`) mà loại lỗi (`errorSource` từ config) = **designer** → tự động mirror rework-back về designer.

> ⚠️ **Điều kiện kích hoạt** (`canReworkBackToDesigner`): `errorSource='designer'` + `designerStatus` ∈ {`done`, `unassigned`, `rejected`}. **KHÔNG** gate `=== 'done'` (đơn vào print qua manual `toolResultNote='ok'` Entry B có `designerStatus='unassigned'` — gate Done sẽ bỏ sót, bug đã sửa). Skip khi designer đang `rework` (tránh double-report) hoặc `in-progress`/`assigned` (designer đang làm dở, không giật).
>
> **Vị trí stage** (`buildDesignerReworkBackFromError`):
> - Đơn **đã trong pipeline** (`currentFulfillmentStage` set) → reporter = stage hiện tại; stage → `waiting` (reworkCount++).
> - Đơn **CHƯA vào pipeline** (`currentFulfillmentStage` null — vd đơn lỗi tool chưa từng 'ok', `designerStatus='unassigned'`) → **khởi tạo stage `print`** (`currentFulfillmentStage='print'` + subdoc `{status:'waiting', reworkCount:0, workMs:0, waitingAt}`). Vì pipeline luôn bắt đầu ở Print; bảng In là admin-view nên worker In thấy & báo lỗi cả đơn ngoài pipeline. Sau khi designer complete → hook designer-complete (currentFulfillmentStage đã set) flip Print → `rework`.


- `toolResultNote='error'` + `designerStatus='rework'` + `designerReworkAt` + `$inc designerReworkCount` (như cũ).
- **Mới:** reporter stage (`currentFulfillmentStage`) → `status='waiting'` + `reworkCount++`, và **push `fulfillmentTimeline` entry** `{ stage, action:'rework-back', byUserId:<worker>, reworkTarget:'designer', reason:productionErrorNote }` → đơn vào tab **"Đang chờ quay lại"** của worker (điều kiện match của tab watching cần đúng timeline entry này).
- Sau khi Designer complete → reporter stage = `rework` (như 2.3) → tab **"Cần làm lại"**.

Áp dụng ở `OrderService.updateField()` (field `productionError` / `productionErrorSource`) + `OrderService.setProductionError()` (scan + dialog "Lỗi khác") qua helper chung `buildDesignerReworkBackFromError()`. Kích hoạt khi `errorSource='designer'` + `canReworkBackToDesigner` + có user context; đơn chưa vào pipeline thì tự khởi tạo stage Print (xem callout "Vị trí stage" trên). **Áp cho mọi stage** (print trở đi), cả PrintOrderTable (chip watching/rework) lẫn kanban (tab watching/rework).

> **Auto-gán designer sau báo lỗi (2026-07):** cả 3 đường đẩy về designer (rework-back §2.3, cell/scan §2.3b) đều hook `OrderService.autoAssignAfterImport([orderId], ctx)` sau khi ghi DB — đơn thành `rework` mà **chưa ai ôm** (soát 'ok' từ đầu nên chưa từng có designer) sẽ được auto-gán theo cấu hình xưởng (GIỮ status `rework` → vào thẳng cột "Cần làm lại"), khỏi nằm backlog "Cần gán". Đơn đã có assignee (rework về designer cũ) → engine tự lọc, không đụng. Riêng đường rework-back của kanban: `FulfillmentTaskService` inject `OrderService` (`fulfillment.module.ts` import `OrderModule`). Xem `DesignerAutoAssign.md`.

#### 2.3c Báo lỗi "do Soát tool" (`errorSource='tool-check'`) — đẩy về Support

Song song 2.3b nhưng target = **Support** (không phải designer): worker chọn "Lỗi xưởng" loại `tool-check` (vd "Thiếu file để in") → cùng helper `buildDesignerReworkBackFromError(..., target='tool-check')` + gate `canReworkBackToSupport()`. **KHÔNG** đụng `designerStatus`; marker hold = `productionErrorSource='tool-check' AND toolResultNote='error'`.

> **CHẠY LẠI TOÀN CHUỖI (cập nhật 2026-07):** `buildDesignerReworkBackFromError` giờ **reset `currentFulfillmentStage = Print`** (đơn đã trong pipeline) — giữ `completedAt` các stage (lịch sử). Mọi công đoạn đã-xong (Thiết kế nếu gán + In + …) hiển thị **"Đang chờ quay lại"** (positional watching) trong lúc Support soát. **Support đổi Note kq Tool → 'ok'** (`OrderService.updateField`, nhận biết `wasToolCheckHold` = marker cũ): gỡ marker + **re-flow** — nếu đơn có designer từng làm → `designerStatus='rework'` (về Thiết kế "Cần làm lại" trước; designer complete → hook Entry A flip In→rework); nếu không → `fulfillmentStages.print.status='rework'` (về In "Cần làm lại"). Sau đó In→Ép… chạy lại lần lượt. Xem `documents/Plans/UpstreamWatching-ReflowChain.md` + [`ToolCheckWorkflow.md`](ToolCheckWorkflow.md).

**Ví dụ:** May xuất ra (`sew-out`) báo lỗi đẩy về In (`print`):

- `currentFulfillmentStage` chuyển từ `sew-out` → `print`.
- `fulfillmentStages.print.status: done → rework` (reworkCount++) — **CHỈ target** → In tab "Cần làm lại".
- `press` / `qc-post-press` / `sew-in`: **GIỮ `done`/`completedAt`** — positional watching → mỗi công đoạn hiển thị đơn ở tab **"Đang chờ quay lại"** (đơn đang upstream). KHÔNG đánh dấu rework sớm.
- `fulfillmentStages['sew-out'].status: in-progress → waiting` (reporter, có timeline rework-back → cũng ở "Đang chờ quay lại").
- User Print bấm "Bắt đầu" → in-progress → Hoàn thành → auto-advance Press: `press.completedAt` đã có (làm lại vòng mới) → **`reworkCount++`** → Press tab "Cần làm lại". Press xong → QC → SewIn → SewOut lần lượt, mỗi cái `reworkCount++` khi nhận lại → hoàn thành → cột "Đã sửa".
- Suốt quá trình đó, các công đoạn CHƯA tới lượt vẫn ở "Đang chờ quay lại"; công đoạn đang giữ đơn ở "Cần làm lại".
- Khi SewOut nhận lại → tab "Đang chờ"/"Cần làm lại" → "Bắt đầu" lần 2 (workMs cộng dồn, reworkCount SewOut = 1).

### 2.3b Hiển thị lý do đẩy về (2026-09-05)

`fulfillmentStages.<stage>.reworkReason` + `.reworkFromStage` được BE lưu từ đầu nhưng trước đây KHÔNG render ở đâu — thợ nhận lại đơn ở tab "Làm lại" không biết phải sửa gì. Nay:

- `components/orders/ReworkReasonNote.tsx` — khối vàng "Bị đẩy về từ &lt;công đoạn&gt;" + nguyên văn lý do. Dùng ở kanban `FulfillmentTaskCard` và ở cột "Trạng thái in" của bảng công đoạn In (`workshopTableConfig`).
- Nhật ký đơn: thao tác đẩy về ghi action riêng `rework_back` (`ORDER_LOG_ACTIONS`) — `field` = công đoạn đích (hoặc `designer`), `before` = công đoạn báo lỗi, `after` = lý do. Trước đây chỉ có 1 dòng `update` đổi status, không phân biệt được với thay đổi trạng thái thường.

### 2.4 Đơn bị hủy

Nếu `cancelledAt` được set (từ flow Import file soát / Admin bấm hủy), `BadRequestException` khi transition. **My Tasks kanban tự loại đơn hủy** — `buildMyTaskBase` set `cancelledAt: null` (trước đây KHÔNG filter "để khớp Factory Tab" → đã sửa: đơn hủy biến mất khỏi mọi cột Chờ/Đang làm/Rework/Done ngay cả khi bị hủy giữa chừng). Xem `documents/Plans/CancelledOrders-ExcludeFromStages.md`.

---

## 3. API / Schema

### 3.1 Endpoints

| Method | Path                                    | Mô tả                                                               |
| ------ | --------------------------------------- | ------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------- |
| `POST` | `/v1/orders/:id/fulfillment-transition` | Trigger state machine. Body: `{ stage, action, target?, reason? }`. |
| `GET`  | `/v1/fulfillment/my-tasks`              | List 4-tab cho worker hiện tại. Query: `tab=waiting                 | in-progress | rework | watching`, `page`, `size`. Stage + factoryId tự suy từ user (Manager có thể override). |
| `GET`  | `/v1/fulfillment/daily-overview`        | **Bảng tổng quan theo ngày** — FULL luồng mọi khâu (`@Auth OVERVIEW_ROLES` — rộng hơn transition, gồm Support/Designer/Leader). Query: `days=7\|14\|30` hoặc `from`/`to` (VN), `stage?` (chỉ để FE highlight). Trả `days[]` `{day, total, toolReviewed, toolUnreviewed, toolOk, designerReceived, designerDone, designerRework, designerFixed, stages:{<stage>:{arrived,done,remaining,rework,fixed}}}` + `columnTotals` (cùng shape) + `rangeDays`. `designerFixed` = designerStatus done & reworkCount>0; stage `fixed` = status done & reworkCount>0. Scope theo `factoryId` nếu có, ngược lại toàn cục. Xem §4.6. |

### 3.2 OrderEntity — fields mới

```ts
// apps/api/src/modules/order/order.entity.ts
type FulfillmentStage =
  | 'print' | 'press'
  | 'qc-post-press'
  | 'sew-in' | 'sew-out'
  | 'pack';

currentFulfillmentStage?: FulfillmentStage;  // null khi chưa vào hoặc xong
fulfillmentCompletedAt?: Date;  // set khi pack.complete
fulfillmentStages?: {
  print?: StageState;
  press?: StageState;
  'qc-post-press'?: StageState;
  'sew-in'?: StageState;
  'sew-out'?: StageState;
  pack?: StageState;
};
fulfillmentTimeline: TimelineEntry[];  // append-only history

priority?: OrderPriority;  // 1=Ưu tiên/2=Ưu tiên cao/3=Ưu tiên nhất, optional — xem Orders.md §17. Sort key đầu (priority: -1) ở getMyTasks.

type StageState = {
  status: 'waiting' | 'in-progress' | 'done' | 'rework';
  assignee?: string;          // = user._id
  assignedAt?: Date;
  waitingAt?: Date;           // mốc "nhận task" (vào waiting). Reset mỗi cycle.
  startedAt?: Date;           // reset mỗi cycle
  firstStartedAt?: Date;      // immutable, set lần đầu
  completedAt?: Date;
  reworkAt?: Date;
  reworkCount: number;
  reworkReason?: string;
  reworkFromStage?: FulfillmentStage;
  workMs: number;             // cumulative
};

type TimelineEntry = {
  stage: FulfillmentStage;
  action: 'start' | 'complete' | 'rework-back';
  fromStatus: StageStatus;
  toStatus: StageStatus;
  byUserId: string;
  byUserName?: string;
  at: Date;
  reworkTarget?: 'designer' | FulfillmentStage;
  reason?: string;
};
```

### 3.3 UserEntity — field mới

```ts
// apps/api/src/modules/user/user.entity.ts
fulfillmentStage?: FulfillmentStage;  // 7 giá trị — xem §3.2

// Partial unique index:
UserSchema.index(
  { factoryId: 1, fulfillmentStage: 1 },
  {
    unique: true,
    partialFilterExpression: {
      fulfillmentStage: { $exists: true, $type: 'string' },
      factoryId: { $exists: true, $type: 'string' },
    },
    name: 'unique_factory_fulfillment_stage',
  },
);
```

BE service convert E11000 → `BadRequestException` thân thiện.

### 3.4 Permissions mới

```
page.fulfillment_my_tasks         — Truy cập trang task của tôi (worker)
page.fulfillment_team             — Truy cập trang quản lý team (manager)
page.fulfillment_stats            — Truy cập trang stats (manager)
fulfillment.task.transition       — Transition stage của task bản thân
fulfillment.task.override         — Override transition (manager/admin)
fulfillment.team.manage           — Quản lý worker (factory × stage)
```

Default preset:

- `Fulfillment`: thêm `page.fulfillment_my_tasks` + `fulfillment.task.transition`.
- `Manager`, `SupportManager`, `Admin`, `SuperAdmin`: auto inherit (ALL_PERMISSION_CODES).

---

## 4. UI Components

### 4.1 `/fulfillment/my-tasks` (`pages/fulfillment/my-tasks/index.tsx`)

**Cột "Cần làm lại" + "Đang chờ quay lại" TRỐNG (0 task, xét dữ liệu thô chưa qua filter client) → ẨN HẲN khỏi kanban** — `visibleCols` memo + `KANBAN_GRID_BY_COUNT` (Tailwind class tĩnh theo số cột 4..7); KPI strip vẫn hiện đủ mọi cột. **Layout: kanban 5 cột worker / 6 cột admin** (`waiting/in-progress/rework/done/fixed/watching` + `unassigned` cho admin) — đồng bộ pixel-by-pixel với `pages/designer/my-tasks`. Cột **"Đã xong"** = hoàn thành stage KHÔNG dính lỗi (`fulfillmentStages.<stage>.reworkCount = 0`); cột **"Đã sửa"** = hoàn thành SAU KHI stage từng bị đẩy về (`reworkCount > 0`) — 2 cột loại trừ nhau; cả 2 read-only (không checkbox/bulk/DnD). Fetch thêm 1 call `tab='fixed'`.

- **Header**: icon avatar bg-indigo + "Task của tôi — {stage label}" + dòng phụ "Xưởng: {factoryId}" + nút Làm mới (ghost icon spinner khi loading).
- **KPI bar**: 6 ô (`Đang chờ` / `Đang làm` / `Làm lại` / `Đã xong` / `Đã sửa` / `Đợi quay lại`) — derive từ length các column. Cùng style với KPI ở Designer page (border-card + label uppercase + value lớn).
- **Hint bar**: rounded box bg-muted với `MousePointerClick` icon — hướng dẫn checkbox + shift-click + DnD (clone Designer hint).
- **Filter bar**: grid 5 cell (Search + 4 SelectFilter cho `type`/`fabricType`/`machineNumber`/`toolResult`) — match Designer page.
  - Search 300ms debounce → match `productionId` / `orderId`. Ô này **vừa gõ tay vừa nhận máy quét USB** (ô to `h-11 text-sm font-mono` giống trang Quét mã): helper `stripBarcodePrefix()` (mirror `normalizeCode` mode barcode ở `scan-error/index.tsx`) tự bóc tiền tố `N-`/`n-` (case-insensitive) ở đầu trước khi so khớp → quét barcode "N-PROD1234" tìm được đơn `PROD1234`. Icon `ScanLine`, hiện hint "✓ đã bỏ N- → tìm: …" khi phát hiện tiền tố; nút copy cũng copy mã đã bóc tiền tố.
  - **Gõ để lọc kanban live** (debounced) + **Enter/quét mã → mở dialog thao tác** (clone luồng trang "Quét mã"): `handleScanLookup()` gọi `RepositoryRemote.order.getByProductionId(code)` (tra cứu chính xác) → mở `FulfillmentScanActionDialog` (Hoàn thành = tự start+complete / Báo lỗi). Bấm "Báo lỗi" → `scanErrorMode` chuyển sang `OrderErrorScanDialog` (gán `productionError`). Cả 2 dialog reuse component từ `pages/orders/scan-error/`. Sau mỗi thao tác → `load()` reload kanban; đóng dialog → clear + re-focus ô search để quét đơn kế tiếp. Input `disabled` khi dialog mở.
  - **Nút "Lịch sử tra cứu"** (`History` icon, cạnh ô search, có badge số lượng): mở modal `Dialog` liệt kê `searchHistory` (persist `localStorage` key `fulfillment-search-history`, cap `MAX_SEARCH_HISTORY=20`). Mỗi lượt Enter/quét đẩy 1 entry `{ code, status: 'found'|'not-found', at }`. Click 1 dòng → tra cứu lại (`setSearch` + `handleScanLookup`). Có nút "Xoá lịch sử".
  - Facet options derive client-side bằng pattern faceted (loại trừ chính facet đang tính) → count phản ánh đúng các filter khác.
  - Apply filter client-side trước khi group → DnD/checkbox/kanban đều thấy data đã filter.
  - **Click lại menu "Task Fulfillment" ở sidebar khi đang đứng đúng trang này** (`FulfillmentKanbanView` — CHƯA áp dụng cho `PrintWorkshopView`) → tự xóa `search`/`filters`/`dateFrom`/`dateTo`/`selected` (`useSidebarResetSignal`, xem cơ chế chung + bảng trang đã wire ở `Orders.md §20`).
- **Selection + bulk** (clone Designer):
  - Checkbox tại HEADER CỘT (chọn/bỏ chọn toàn bộ card trong cột, indeterminate khi partial; counter header đổi thành `đã chọn/tổng` khi có selection) — key i18n `kanban.column.selectAll`.
  - Checkbox tại group header (toàn bộ rows trong group) — indeterminate state khi partial.
  - Checkbox tại từng card (top-left absolute). Shift+click trong cùng cột để select range.
  - `selectedColumns` cross-column: nếu user chọn đơn ở > 1 cột → toolbar hiển thị warning, không cho bulk.
  - Sticky toolbar bottom-3 rounded-full: hiển thị count + button bulk theo cột:
    - waiting / rework → "Bắt đầu" (Promise.allSettled loop `transition(start)`).
    - in-progress → "Hoàn thành" (loop `transition(complete)`).
    - **RIÊNG stage Đóng hàng (`myStage === Pack`)**: waiting / rework có thêm nút "Hoàn thành" (`BulkAction 'start-complete'`) — cùng hành vi 1 lần quét của `FulfillmentScanActionDialog`.
    - **Mọi bulk = 1 REQUEST duy nhất `POST /v1/fulfillment/bulk-transition`** (`{stage, action: 'start'|'complete'|'start-complete', orderIds[]}` max 1000, `BulkFulfillmentTransitionDto`) — BE `bulkTransition()` loop `transition()` TỪNG đơn concurrency 5 để giữ đủ hook (timeline, auto-advance luồng rút gọn, stock-out, webhook), trả `{ok, fail, failures[]}`. Trước đây FE bắn N request song song → 400 đơn chạm rate limiter.
    - watching → không có checkbox + không có bulk (read-only).
    - Rework-back KHÔNG bulk (cần dialog per đơn → input lý do).
- **Kanban 4 column** với border accent màu:
  - `waiting` — zinc
  - `in-progress` — indigo
  - `rework` — amber
  - `done` — emerald (đơn user đã hoàn thành stage này, đã chuyển sang stage sau hoặc xong toàn bộ flow)
- **Bottom drawer** `Đơn đã đẩy về xử lý` (collapsible, default closed) — clone pattern Designer's "Đơn đã trả lại". Hiển thị danh sách `watching` (đơn user đã rework-back, đang chờ quay lại). Card read-only, không có checkbox/action.
- **Group by type** trong mỗi cột — collapsible header (chevron + type name + count) — match Designer pattern (1 difference: không có checkbox bulk).
- **Card** (`FulfillmentTaskCard.tsx`) — design lấy nguyên template từ `pages/designer/my-tasks/TaskCard.tsx`:
  - **Mockup thumbnail** 56×56 (`bg-checker`) bên trái, click → preview to qua `ImagePreviewDialog`.
  - **ProductionId** font-mono có thể clickable (hook `onClickProductionId` chưa nối, sẽ thêm detail dialog sau).
  - **Type** (line-clamp 1 + Hint tooltip).
  - **Size · Color · qty** dòng phụ.
  - **Time stamp** với `Clock` icon — switch field theo status:
    - `waiting` → `waitingAt` ("Nhận: 14:25 22/06").
    - `in-progress` → `startedAt` ("Bắt đầu: ...").
    - `rework` → `reworkAt` ("Quay lại: ...").
    - Hint tooltip on hover: format absolute + `dayjs.fromNow()` relative VI.
  - **ReworkCount badge** với `RotateCcw` icon (`×N` amber) — match Designer.
  - **Priority badge** (`PriorityBadge`, `@/components/orders/cells/PrioritySelectCell`) cạnh productionId khi `order.priority` set + **chip hạn dự kiến** (`getStageDeadline(order.priority, myStage, waitingAt|startedAt)`, `@/utils/priorityEstimate`) trong hàng timestamp khi status ∈ {Waiting, InProgress} — đỏ nếu quá hạn. Xem `Orders.md §17`.
  - **Watching badge** (chỉ tab watching): "Đang ở: <stage>" với chevron sky.
  - **Production error note** (chỉ status rework): rounded amber alert box với `MessageSquareWarning` icon — clone từ Designer.
  - **Action buttons** inline ở footer (sub-component `CardAction`):
    - Waiting/Rework: "Bắt đầu" (indigo).
    - In-progress: "Hoàn thành" (emerald) + "Báo lỗi" (rose, mở `ReworkBackDialog`).
    - Watching: ẩn hoàn toàn.
- **DnD** (`@dnd-kit/core`): `useDraggable` build-in trong card. Chỉ enable cho `waiting`/`rework` → drop vào cột `in-progress` = action `start`. Drag rule khác bị toast warning. `in-progress`/`watching` không draggable (no valid target).
- **Data fetch**: 5 `Promise.all` calls song song tới `GET /v1/fulfillment/my-tasks?tab=...&size=5000` (waiting / in-progress / rework / done / watching). FE load full queue mỗi cột (size=5000) để hiển thị toàn bộ đơn không cắt; BE cap `size` tối đa 5000 (default 50 khi không truyền). 4 fetch đầu feed 4 cột kanban, fetch thứ 5 feed bottom drawer. Đơn giản hơn add BE endpoint mới vì queue per stage thường < 200 đơn.
- **ImagePreviewDialog** dùng chung với Designer — preview ảnh mockup khi click thumb.
- Empty state mỗi cột: "Trống" (italic).

### 4.2 `ReworkBackDialog`

- Chip group target: **Designer** + N chip cho stage trước (mặc định chọn stage trước liền kề).
- Textarea reason (required, max 500).
- Submit gọi `transition({ stage, action: 'rework-back', target, reason })`.

### 4.3 User form (`pages/users/index.tsx`)

- Khi role = `Fulfillment` → show 2 select:
  1. **Xưởng** (existing).
  2. **Stage Fulfillment** (auto-derive từ shared enum: In / Ép / QC sau ép / May nhận vào / May xuất ra / Đóng hàng).
- Helper text: "Mỗi (xưởng, stage) chỉ được 1 user".

### 4.4 Sidebar entry

Thêm vào group "Workflow":

```
{ key: PATHS.FULFILLMENT_MY_TASKS, label: 'Task Fulfillment', perm: 'page.fulfillment_my_tasks' }
```

### 4.5 Stage In (print) — bảng admin-view thay kanban

> Plan gốc: `documents/Plans/PrintStage-AdminTableView.md`.

Riêng user **In** (`role=Fulfillment`, `fulfillmentStage='print'`) **KHÔNG** dùng kanban như các stage khác, mà dùng **bảng phẳng** (`PrintOrderTable` — file riêng, KHÔNG đụng `OrderTableWorkshop`) để thấy **mọi trạng thái đơn TRONG XƯỞNG MÌNH** (gồm đơn lỗi / `toolResultNote != 'ok'` / chưa vào pipeline). **CHỈ xưởng mình** (`factoryId = user.factoryId`) — không thấy đơn xưởng khác (khác user admin thấy mọi xưởng).

- **Dispatcher** `pages/fulfillment/my-tasks/index.tsx`: nếu `myStage === FulfillmentStage.Print` → render `PrintWorkshopView`; còn lại render `FulfillmentKanbanView` (kanban cũ, đổi tên từ component cũ). Dispatcher chỉ gọi `useAuthStore` rồi rẽ nhánh → không vi phạm Rules of Hooks.
- **`PrintWorkshopView`** (`pages/fulfillment/my-tasks/PrintWorkshopView.tsx`): thin orchestrator — giữ logic transition + `ReworkBackDialog` + `reloadToken`, render `<PrintOrderTable extraRowAction reloadToken>`.
  - Action (`canPrint`) hiện khi **CHỈ 2 điều kiện**: **(1)** `row.toolResultNote === 'ok'` (đơn designer coi như xong) **và (2)** `row.factoryId === user.factoryId` (đơn xưởng khác chỉ xem). **KHÔNG** yêu cầu stage `print` đã init — đơn designer done qua path không hook (thiếu `currentFulfillmentStage`/`fulfillmentStages`) vẫn hiện nút → BE **self-heal** khởi tạo stage khi bấm Bắt đầu.
  - Contextual theo `fulfillmentStages.print.status`: `in-progress` → **Hoàn thành** + **Báo lỗi**; `done` (đã in xong, đã sang stage sau) → **không nút**; còn lại (`waiting`/`rework`/**undefined** = chưa init) → **Bắt đầu** (kèm **Báo lỗi** chỉ khi status đã init, vì rework-back cần stage tồn tại). `ReworkBackDialog` target chỉ có `designer` vì print là stage đầu.
  - Sau transition → bump `reloadToken` để `PrintOrderTable` refetch (bảng + count).
- **`PrintOrderTable`** (`pages/fulfillment/my-tasks/PrintOrderTable.tsx`): bảng **phẳng KHÔNG group sản phẩm** (bỏ expand), self-contained:
  - Data từ `GET /v1/orders` với `sort=grouped` → sort ưu tiên **type → size → fabric → inProductionAt**. Pagination theo **đơn** (default size 50).
  - **Thanh chips trạng thái (hàng ngang)**: 7 chip `Tất cả / Đang chờ / Đang làm / Làm lại / Đã xong / Đã sửa / Đang chờ quay lại` + số đếm (từ `GET /orders/fulfillment-status-counts`). **"Đã xong"** = stage done reworkCount=0; **"Đã sửa"** (`fixed`) = stage done reworkCount>0 (loại trừ nhau). Click → `statusFilter` → **cả list + facet dropdowns đều narrow theo status** (data qua `getOrders` + facets qua `getWorkshopAvailableFilters`, đều nhận `fulfillmentStatus`). Counts KHÔNG kèm status.
  - **Filter bar** (`OrderFilterBar`): search + date + **Tên sản phẩm** (`type`) + **Khách hàng** (`userSku`) dạng dropdown có count + các facet workshop (loại vải/máy/trạng thái in/kết quả tool/note/file lỗi/người thực hiện/TT designer/lỗi xưởng).
  - **URL params persistence** (prefix `p` = print, dùng `useSearchParams` — mirror pattern `OrderTableWorkshop`): mọi filter ghi lên query string (`psearch`, `pfrom`/`pto`, `pstatus`, `ptype`, `pusersku`, `pfabric`, `pmnum`, `pprint`, `ptool`, `pnote`, `perrfile`, `passign`, `pdstatus`, `perror`, `ppage`, `psize`). Effect sync state→URL (`{ replace: true }`) strip giá trị rỗng cho URL gọn, riêng **ngày luôn ghi** (`pfrom`/`pto` set kể cả rỗng → giữ trạng thái user clear date qua F5). State khởi tạo lazy từ `searchParams.get(...)` → **F5 / mở lại link đều khôi phục nguyên filter + search + ngày + trang**. Ngày đọc bằng `?? todayISO()` (chỉ default về hôm nay khi param vắng mặt hoàn toàn), các filter khác đọc bằng `|| ''`.
  - Cột = **`PRINT_COLS`** (biến thể riêng của `WORKSHOP_COLS` cho tài khoản In, cùng file `workshopTableConfig.tsx`, theo view-permission). Khác `WORKSHOP_COLS`: **(1)** cột "Loại vải" gộp vào cột **Mockup / Type / Size / Color / Vải** — giá trị `fabricType` (IconSelectCell, vẫn edit được) nằm **dưới Size**; **(2)** ngay sau **"Note Trạng thái in"** dời lên lần lượt: **Note kq Tool 1 → Lỗi xưởng → Loại lỗi → Mô tả lỗi xưởng**; **(3)** cột "Note Trạng thái in" thu hẹp (label rút gọn **"Note TT in"** + `min-w-[80px]`) cho đỡ tốn diện tích. **(4)** 2 cụm cột được GỘP hiển thị thành 1 cột/cụm (`PRINT_MERGE_GROUP_DEFS` trong `workshopTableConfig.tsx` + `displayUnits` trong `PrintOrderTable.tsx`): **"Máy · Trạng thái in · Note"** (machineNumber + printStatus + printStatusNote) và **"Lỗi xưởng · Loại · Mô tả"** (productionError + productionErrorSource + productionErrorNote) — field trong ô xếp dọc, mỗi mục có label riêng qua `GroupCellContent` (nhãn `workshopCols.short.*` / FIELD_LABELS: Máy/Trạng thái/Note, Lỗi xưởng/Loại lỗi/Mô tả); group chiếm vị trí member đầu tiên còn quyền xem, member bị ẩn theo quyền tự rơi khỏi cụm; header/colSpan tính theo `displayUnits`. Mỗi mục trong ô gộp cao đúng 1 DÒNG: label `whitespace-nowrap w-[68px]` cố định (không bọc 2 dòng + mọi value bắt đầu cùng mốc x → thẳng hàng dọc) + prop `singleLineValues` của `GroupCellContent` đè `line-clamp-2` của `TextEditCell` thành 1 dòng (chỉ bảng In truyền prop này — bảng workshop giữ 2 dòng như cũ). Cột action **sticky phải** (prop `extraRowAction`). Highlight no-tool. **Nền ĐỎ đơn đang lỗi** (`productionError` set + `errorResolvedAt` rỗng — đúng tập tab "Cần xử lý" của Nhật ký bù lỗi; báo lỗi không rút đơn khỏi bảng In nên tô đỏ + border trái đỏ để người in biết đơn cần làm lại; ưu tiên đỏ hơn nền no-tool, khi tick chọn thì nền chọn đè nhưng border đỏ vẫn giữ). `reloadToken` prop → ép refetch.
  - **Chế độ phím ↑↓** (toggle "Chế độ phím ↑↓" cạnh chips, state `keyboardMode` — **mặc định On**): bật → nghe `keydown` window, phím `↑`/`↓` di chuyển `cursorIndex` trong trang + copy `productionId` dòng đó vào clipboard (`navigator.clipboard`). Dòng đang focus có ring + auto `scrollIntoView`. **CHỈ dòng vừa copy (cursor đang trỏ) hiện ✓** (`copiedId: string | null` — KHÔNG còn tích lũy Set; mỗi lần copy thay thế giá trị cũ → di chuyển cursor thì ✓ nhảy theo, dòng cũ mất tick), render `CheckCircle2` cạnh checkbox. Bỏ qua khi target là input/textarea/select. `copiedId` reset khi đổi filter/search/date/status/facet; `cursorIndex` reset thêm khi đổi trang.
  - **Chọn nhiều + bulk CHUYỂN TRẠNG THÁI** (không phải bulk-edit field): checkbox chỉ tick được đơn **hợp lệ** (`isRowSelectable` = `canPrint` [toolResultNote='ok' + đúng xưởng] + `print.status !== 'done'` — gồm cả đơn chưa init stage; đơn khác bị disable). Toolbar (`renderBulkBar`) hiện 2 nút riêng **Bắt đầu** (cho đơn chờ/làm lại) + **Hoàn thành** (cho đơn đang làm). Nếu chọn lẫn trạng thái → **popup xác nhận** trước khi chuyển (chỉ áp cho subset hợp lệ với nút đó, số còn lại bỏ qua). Bulk loop `transition` song song → toast gộp.
- **BE filter + count**:
  - `GetProductionOrdersZod.fulfillmentStatus` (enum 5 giá trị) + `userSku` (CSV filter). `OrderService.applyFulfillmentStatusFilter()` mirror `FulfillmentTaskService.applyTabFilter` (không ép scope factory/ready; `watching` dùng userId elemMatch timeline). Áp ở `getOrders` + `getOrdersGroupedByType` + `getFulfillmentStatusCounts`.
  - `GET /v1/orders/fulfillment-status-counts` (`@Auth(ORDER_VIEW_ROLES)`) trả `{all, waiting, inProgress, rework, done, watching}` (all = tổng đơn theo filter, không kèm status).
  - `getWorkshopAvailableFilters` thêm facet `type` + `userSku` (cho dropdown). `buildOrderListFilter` thêm filter `userSku`.
- **Visibility BE**: helper `OrderService.isPrintAdminView(roleName, fulfillmentStage)` (true khi Fulfillment + print) bỏ qua `readyForFulfill` + window 7 ngày **NHƯNG vẫn scope `factoryId = user.factoryId`** (chỉ xưởng mình, dùng equality — KHÔNG gồm `originalFactoryId`). Áp tại:
  - `buildVisibilityFilter()` → cover `GET /orders` + `GET /orders/grouped` + `GET /orders/workshop-filters` + `GET /orders/status-overview` + `GET /orders/fulfillment-status-counts`.
  - `getDashboard()` + `getFactoryOverview()` (Dashboard tab Stats + Factory).
  - Controller truyền `user?.fulfillmentStage` cho các endpoint trên (gồm `GET /orders`).
  - **Ngoài scope** (giữ scope Fulfillment cũ): `getErrorLog`, `getByProductionId`, `getDesignerBreakdown`.
- **Permission**: preset `Fulfillment` được bổ sung các `order.field.*.view` còn thiếu (`toolResult`, `errorFile`, `errorFileNote`, `assignee`, `assigneeNote`, `designerStatus`) + `order.log.view` để hiển thị đủ 16 cột + nút Lịch sử (chỉ **view**, không mở edit). `RoleService.onModuleInit` tự sync khi boot.
- **Cột "Loại lỗi" (`productionErrorSource`) tự fill theo "Lỗi xưởng" (`productionError`), KHÔNG cho sửa tay**:
  - Chọn `productionError` (code) → BE auto-fill `productionErrorSource = config.errorSource` (`order.service.ts:3294`;
    **bỏ chọn productionError → clear source** `:3318`). FE `ProductionErrorSelectCell` resolve sẵn `cfg.errorSource` truyền
    qua `onUpdated(code, source)`; handler cột trong `workshopTableConfig.tsx` patch `productionErrorSource` ngay (kể cả khi
    `!code` → clear) → cột "Loại lỗi" cập nhật tức thì, không chờ F5. Áp cho mọi bảng dùng `WORKSHOP_COLS` (`PrintOrderTable` +
    `OrderTableWorkshop`).
  - Preset `Fulfillment` **bỏ `order.field.productionErrorSource.edit`** (giữ `.view`) → `ErrorSourceCell` render
    read-only. Permission theo **role `Fulfillment` (1 role chung cả 6 stage)** nên áp mọi stage — đúng logic vì loại lỗi luôn
    suy ra từ lỗi xưởng. `RoleService.onModuleInit` revoke quyền khi restart (catalog = source of truth). Vẫn giữ
    `productionError.edit` để worker chọn lỗi xưởng.

### 4.6 Bảng "Tổng quan theo ngày" (`components/common/PipelineDailyOverview.tsx`) — FULL luồng, MỌI stage

Component **dùng chung 3 nơi**: Task Fulfillment (kanban 6 stage + bảng In stage print, prop `stage`), **Designer my-tasks** (prop `lane='designer'`) và **tab Soát tool** (prop `lane='tool'`). Gom **MỌI đơn** theo **`inProductionAt`** (VN) — cùng trục với bảng Designer/Soát tool ⇒ 1 đơn nằm cùng cột ngày ở mọi khâu, giúp worker biết **ưu tiên** (cohort ngày SX cũ mà "Còn lại/Lỗi" > 0 = làm trước). **Không** giới hạn theo đơn đã tới stage nào → thấy được cả luồng đầu (tool/designer) lẫn đuôi.

- **Các hàng** (cột = ngày cũ→mới; BE trả mới→cũ, FE `reverse()` + cột **Tổng**):
  - **Tổng đơn** — count đơn có `inProductionAt` ngày đó.
  - **Soát tool** — ô 2 số `đã soát / chưa soát` (`toolResultNote` có nội dung / ∈ {null,''}).
  - **Designer** — ô 2 số `đã làm / còn lại` (đã làm = `done`; còn lại = `designerReceived − done`; tổng nhận = `designerStatus ≠ unassigned`, ở tooltip).
  - **6 stage fulfillment** — mỗi stage 1 hàng ô 2 số `đã xong / còn lại` (đã xong = `done`, emerald; còn lại = `arrived − done`, indigo). Hàng công đoạn hiện `0` khi = 0 (thay dấu `·`).
- **Stage của user** (`stage` prop) → hàng đó **bung 5 hàng nhỏ** `Đến / Đã làm (done−fixed) / Đã sửa (fixed, teal) / Còn lại / Lỗi cần sửa` (phân loại theo `fulfillmentStages.<myStage>.status` HIỆN TẠI) và **highlight** (nền indigo, nhãn đậm). Hàng **"Lỗi cần sửa" tô đỏ** cho nổi. Các stage khác **làm mờ** (`opacity-70`, nhãn muted).
- **Lane của user** (`lane` prop, loại trừ với `stage`) → bung hàng tương ứng thành header + 4 hàng con:
  - `lane='designer'` (trang Designer): **Nhận** (`designerReceived`) / **Đã xong** (`designerDone − designerFixed`) / **Đã sửa** (`designerFixed`, teal) / **Còn lại** (`received − done − rework`) / **Lỗi cần sửa** (`designerRework`, đỏ).
  - `lane='tool'` (tab Soát tool): **Chưa soát** (`toolUnreviewed`) / **Đã soát** (`toolReviewed`) / **Lỗi** (`toolReviewed − toolOk`, đỏ) / **OK** (`toolOk`) — thứ tự cố định dưới hàng "Tổng đơn" chung. Lane tool suy hết từ field sẵn có (không cần thêm BE).
- **`caption` prop** (optional) — ghi chú phụ header (Designer/Soát tool nhắc phạm vi **TOÀN nhà máy**, không chỉ đơn của mình).
- **Ô 2 số** chia đều 2 bên: `đã xong` (emerald, sát mép trái) `/` `còn lại` (indigo, sát mép phải), slash **căn giữa**; ô **1 số** căn **trái**. `còn lại` = `arrived − done` (chưa hoàn thành, cộng dồn theo cohort). Soát tool: `đã soát`(emerald)`/`chưa soát`(amber). Hàng công đoạn fulfillment hiện `0` khi = 0 (thay `·`).
- **Tooltip mỗi ô** (`title` HTML, không cần provider) mô tả chi tiết: ngày + tên chỉ số + ý nghĩa từng con số. Cột "Tổng" tip ghi "Tổng cả kỳ".
- **Click 1 ngày** (header hoặc ô) → lọc danh sách bên dưới:
  - **Kanban** (6 stage): lọc **client-side** các cột theo `vnDay(inProductionAt) === dayFilter`; date-range + bảng tổng quan giữ nguyên. Chip "Đang lọc dd/MM ✕" để bỏ.
  - **Bảng In** (print): bảng phân trang **server** → không lọc client được → truyền `dayOverride` cho `PrintOrderTable` ép `createdFrom=createdTo=day` (narrow qua query). Chip bỏ giống trên.
- Data từ `GET /v1/fulfillment/daily-overview`; refetch qua `reloadToken` (bump sau mỗi transition/refresh). Kanban truyền `from`/`to` = date-range hiện tại; bảng In dùng default 7 ngày.
- **Scope**: user CÓ `factoryId` (Fulfillment) → chỉ xưởng đó (`$or[factoryId, originalFactoryId]`); user KHÔNG có factory (Designer/Support/Admin) → **funnel TOÀN CỤC** (mọi xưởng). Luôn loại `deletedAt`/`cancelledAt`. `stage`/`lane` chỉ để FE highlight — BE trả đủ mọi khâu.
- **Auth endpoint**: `OVERVIEW_ROLES` = SuperAdmin/Admin/Manager/SupportManager/**Support**/Fulfillment/**DesignerLeader**/**Designer** (rộng hơn `TRANSITION_ROLES` vì read-only, không ghi factory). 2 endpoint transition vẫn giữ `TRANSITION_ROLES`.

---

## 5. Backend logic

### 5.1 `FulfillmentTaskService.transition()`

Pseudocode:

```
1. findById(orderId) → assert not cancelled, not deleted.
1b. SELF-HEAL "In": nếu body.stage=print & action=start & order.toolResultNote='ok'
   & currentFulfillmentStage !== 'print' & print.status !== 'done'
   → updateOne set currentFulfillmentStage='print' + readyForFulfill=true
     (+ init print.status='waiting' nếu thiếu; GIỮ nguyên waiting/rework nếu đã có) → reload order.
   Mục đích: designer done qua path không hook (currentFulfillmentStage lệch) vẫn cho In start.
2. Role check: nếu không phải override role → user.fulfillmentStage === body.stage
   && order.factoryId === user.factoryId && order.currentFulfillmentStage === body.stage.
3. resolveTransition() → patch + nextStatus:
   - start: status → in-progress, set startedAt + (firstStartedAt nếu chưa).
   - complete: status → done, $inc workMs += delta, set completedAt.
     Auto-advance: nextStage waiting / nếu pack thì fulfillmentCompletedAt.
   - rework-back: reporter → waiting (cộng workMs), target → rework, intermediates → rework, currentStage = target.
     Nếu target = 'designer': designerStatus=rework + productionErrorSource=designer + designerReworkCount++.
4. findOneAndUpdate({ _id, fulfillmentStages.<stage>.status: currentStatus }, patch).
5. Nếu match miss → 409 (race condition).
6. orderLogService.write({ field: 'fulfillmentStages.<stage>.status', before, after }).
```

### 5.1b `FulfillmentTaskService.getDailyOverview(user, {days, from?, to?, stage?})`

Trả **FULL luồng** (không giới hạn theo stage). 1 aggregate: `$match` (factory scope `$or[factoryId, originalFactoryId]` + `inProductionAt ∈ window` + alive — **KHÔNG** còn điều kiện `<stage>.status $exists`) → `$group` theo `$dateToString(inProductionAt, +07:00)`. Accumulator `$sum`/`$cond`: `total`, `toolReviewed` (`$strLenCP($ifNull(toolResultNote,'')) > 0`), `toolUnreviewed`, `toolOk` (`=='ok'`), `designerReceived` (`designerStatus ≠ unassigned`), `designerDone`, `designerFixed` (done & `designerReworkCount>0`), và **cho cả 6 stage** (gen động qua `FULFILLMENT_STAGES`) key `s_<stage>_{arrived,done,remaining,rework,fixed}` (arrived = `$ifNull(status) ≠ null`; fixed = status done & `reworkCount>0`). `$group` cast `PipelineStage.Group['$group']`. Reshape agg row → `{day, total, tool*, designer*, stages: {<stage>: {arrived,done,remaining,rework,fixed}}}` + `columnTotals` (cùng shape). `resolveDayWindow` (private, tz VN, cap 60) trả `days[]` mới→cũ + `start`/`end`. `stage` param chỉ dùng ở FE (highlight).

### 5.2 Race-safe atomicity

Cùng pattern designer: `findOneAndUpdate` với filter chứa `expected status` → nếu 2 user transition đồng thời, người sau nhận 409 + FE refetch.

### 5.3 `getMyTasks()` — 6 tab filter

| Tab           | Filter                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `waiting`     | `currentFulfillmentStage = stage` && `fulfillmentStages.<stage>.status = waiting` && `designerStatus != 'rework'`                                                                                            |
| `in-progress` | `currentFulfillmentStage = stage` && `status = in-progress`                                                                                                                                                  |
| `rework`      | `currentFulfillmentStage = stage` && `status = rework`                                                                                                                                                       |
| `done`        | **positional** — `completedAt $exists` && **`reworkCount ∈ {0,null}`** && đơn **downstream** (`$nor: [...upstreamClauses(stage), {currentFulfillmentStage: stage}]`). Đơn bị đẩy lùi phía trên → chuyển sang `watching`, KHÔNG còn ở `done`. |
| `fixed`       | Y hệt `done` NHƯNG `reworkCount > 0` = **"Đã sửa"** (hoàn thành sau khi stage từng bị đẩy về, đơn downstream). Loại trừ với `done`. |
| `watching`    | **positional** — (`completedAt $exists` **HOẶC** `fulfillmentTimeline.elemMatch({stage, action:'rework-back'})` [reporter]) **VÀ** đơn **upstream** (`$or: upstreamClauses(stage)`). = "đã làm stage này rồi + đơn đang ở phía TRƯỚC mình" (bất kỳ công đoạn đã-xong nào bị đơn đẩy lùi qua đầu đều vào watching, KHÔNG chỉ người báo lỗi). Bỏ lọc `byUserId` (stage-scoped). |

> **`upstreamClauses(stage)`** (helper `FulfillmentTaskService.upstreamClauses` + mirror `OrderService.upstreamOfStageClauses`) = đơn đang ở phía TRƯỚC `stage`: `$or: [ {productionErrorSource:'tool-check', toolResultNote:'error'} (tool-check hold), {designerStatus:'rework'} (designer đang làm lại), {currentFulfillmentStage: {$in: FULFILLMENT_STAGES.slice(0, indexOf(stage))}} (stage fulfillment trước) ]`. Xem `documents/Plans/UpstreamWatching-ReflowChain.md`.

> `countAllTabs` đếm cả `fixed`; DTO `tabCounts` + `FulfillmentStatusCountsResZod.data` + `GetProductionOrdersZod.fulfillmentStatus` enum đều có `fixed`. Bảng In (`applyFulfillmentStatusFilter` ở `order.service.ts`) mirror cùng logic done/fixed.

Common: `cancelledAt: null` + scope theo `user.factoryId`.

### 5.4 Hook entry → fulfillment

Có 2 entry point gọi vào cùng patch shape — code tham chiếu cùng helper `buildFulfillmentEntrySet()` ở `order.service.ts:155`:

```ts
// Factory function (không phải const) để `waitingAt` evaluate mỗi lần gọi —
// const với `as const` sẽ freeze timestamp ở module load time.
function buildFulfillmentEntrySet(): Record<string, unknown> {
  return {
    currentFulfillmentStage: FulfillmentStage.Print,
    'fulfillmentStages.print': {
      status: FulfillmentStageStatus.Waiting,
      reworkCount: 0,
      workMs: 0,
      waitingAt: new Date(), // mốc nhận task cho user In
    },
  };
}
```

#### Entry A — Designer complete (`designer-task.service.ts:83`)

```ts
if (action === Complete && nextStatus === Done && !order.currentFulfillmentStage) {
  // GUARD: đơn ĐÃ HOÀN THÀNH fulfillment cũng có stage=null (pack complete set
  // currentFulfillmentStage=null + fulfillmentCompletedAt) → designer complete
  // muộn KHÔNG init lại print (nếu không xưởng làm lại oan cả chuỗi).
  if (order.fulfillmentCompletedAt) return;
  // Lần đầu vào fulfillment.
  set.currentFulfillmentStage = 'print';
  set['fulfillmentStages.print'] = { status: 'waiting', reworkCount: 0, workMs: 0 };
} else if (action === Complete && nextStatus === Done && order.currentFulfillmentStage) {
  // Cycle quay về (đơn bị worker báo lỗi designer rồi designer fix xong).
  // Phân biệt theo stage ĐÃ từng chạy chưa (firstStartedAt/completedAt):
  const st = order.fulfillmentStages?.[stage];
  if (st?.firstStartedAt || st?.completedAt) {
    // Stage đã chạy thật → LÀM LẠI → tab "Cần làm lại".
    set[`fulfillmentStages.${stage}.status`] = 'rework';
    set[`fulfillmentStages.${stage}.reworkAt`] = now;
  } else {
    // Stage CHƯA từng chạy (vd đơn báo lỗi designer khi chưa hề in — §2.3b init
    // print=waiting) → lần vào ĐẦU TIÊN → "Đang chờ" (waiting), KHÔNG rework.
    set[`fulfillmentStages.${stage}.status`] = 'waiting';
    set[`fulfillmentStages.${stage}.waitingAt`] = now;
  }
}
```

Trường hợp designer rework cycle (đẩy từ fulfillment về, qua nút "Báo lỗi" hoặc cell "Lỗi xưởng" §2.3b): `currentFulfillmentStage` đã set sẵn (= reporter stage). Trong lúc designer làm, reporter giữ stage=`waiting` + `designerStatus='rework'` → đơn nằm tab **"Đang chờ quay lại"**. Khi designer complete → nhánh `else if` phân biệt theo stage đã chạy chưa:
- Stage **đã từng chạy thật** (`firstStartedAt`/`completedAt` — worker đã start/complete rồi mới báo lỗi) → set reporter stage=`rework` → tab **"Cần làm lại"**.
- Stage **CHƯA từng chạy** (đơn báo lỗi designer khi chưa hề in — §2.3b init print=`waiting`) → set reporter stage=`waiting` → tab **"Đang chờ"** (lần vào đầu tiên, không có gì để "làm lại"). **Đây là fix bug: trước đây luôn set `rework` khiến đơn in lần đầu kẹt ở "Cần làm lại", user In tưởng không thao tác được.**

#### Entry B — Manual `toolResultNote='ok'` (3 path)

**B1. `OrderService.updateField()`** — single update qua workshop cell:

```ts
if (dto.field === 'toolResultNote') {
  patch.readyForFulfill = normalized === READY_FOR_FULFILL_CODE;
  if (normalized === READY_FOR_FULFILL_CODE) {
    patch.productionFirstErrorAt = null;
    if (!before.currentFulfillmentStage && !before.fulfillmentCompletedAt) Object.assign(patch, buildFulfillmentEntrySet());
  }
}
```

**B2. `OrderService.bulkUpdateField()`** — field `toolResultNote` thuộc `SIDE_EFFECT_FIELDS` → **delegate loop `updateField()`** per-đơn (không còn `updateMany` riêng), nên guard B1 phủ luôn bulk.

**B3. `OrderService.importRework()`** — per-row check trong import xlsx:

```ts
if (code === READY_FOR_FULFILL_CODE) {
  $set.readyForFulfill = true;
  $set.productionFirstErrorAt = null;
  if (!order.currentFulfillmentStage && !order.fulfillmentCompletedAt) Object.assign($set, buildFulfillmentEntrySet());
}
```

**Guard `!currentFulfillmentStage && !fulfillmentCompletedAt`** đảm bảo không ghi đè state đang chạy VÀ không kéo ngược đơn đã hoàn thành — vì pack complete CỐ Ý set `currentFulfillmentStage=null` + `fulfillmentCompletedAt`, nên `stage=null` một mình KHÔNG có nghĩa "chưa từng vào fulfillment". **Bug 2026-07-23:** backfill orphan-thuận trong `OrderService.onModuleInit()` (init Print cho đơn `readyForFulfill=true` + `stage=null`) thiếu điều kiện loại `fulfillmentCompletedAt`/`heldAt` → MỖI LẦN API restart kéo TOÀN BỘ đơn đã đóng hàng xong về print/waiting (139 đơn/lần, 1949 đơn bị xưởng Thái Nguyên làm lại oan trong 7 ngày). Đã thêm exclusion vào backfill + guard `fulfillmentCompletedAt` ở Entry A/B1/B3 + self-heal In (`fulfillment-task.service.ts` transition).

### 5.4b Hook báo lỗi designer qua cell → rework-back (watching → cần làm lại)

> Spec UI §2.3b. Mục đích: worker chọn cell "Lỗi xưởng" loại designer → đơn vào tab **"Đang chờ quay lại"** của worker; designer fix xong → tab **"Cần làm lại"**.

**2 helper ở `order.service.ts`:**

```ts
// Gate: designerStatus nào được phép đẩy về designer khi báo lỗi loại designer.
private canReworkBackToDesigner(current: DesignerStatus): boolean {
  return current !== Rework        // tránh báo trùng
      && current !== InProgress    // designer đang làm dở, không giật
      && current !== Assigned;     // → fire khi done / unassigned / rejected
}

// Build patch + timeline entry mirror rework-back target=designer của FulfillmentTaskService.
private buildDesignerReworkBackFromError(before, reason, ctx) {
  const userId = ctx?.user?._id; if (!userId) return null;
  const existingStage = before.currentFulfillmentStage;
  const stage = existingStage || FulfillmentStage.Print;  // chưa pipeline → vào Print
  if (!existingStage) {
    set.currentFulfillmentStage = stage;
    set['fulfillmentStages.print'] = { status:'waiting', reworkCount:0, workMs:0, waitingAt:now };
  } else {
    set[`fulfillmentStages.${stage}.status`] = 'waiting';
    set[`fulfillmentStages.${stage}.reworkCount`] = (prev ?? 0) + 1;
  }
  timelineEntry = { stage, action:'rework-back', byUserId:userId, reworkTarget:'designer', reason };
  return { set, timelineEntry };
}
```

**3 call-site** (đều: nếu `errorSource==='designer'` + `canReworkBackToDesigner` → set `designerStatus='rework'` + `$inc designerReworkCount` + merge `rb.set` vào patch + `$push fulfillmentTimeline rb.timelineEntry`):

| Path | File | Trigger |
| --- | --- | --- |
| `updateField` field=`productionError` | `order.service.ts` (~3360) | Cell "Lỗi xưởng" code thường (FE `ProductionErrorSelectCell` → `updateField`) |
| `updateField` field=`productionErrorSource` | `order.service.ts` (~3395) | Cell "Loại lỗi" đổi tay sang designer (admin) |
| `setProductionError` | `order.service.ts` (~4520) | Scan barcode + dialog "Lỗi khác" (`POST /set-production-error`) |

**Vòng đời đầy đủ** (đơn `designerStatus='unassigned'`, chưa pipeline):

1. Worker In bấm "Lỗi xưởng" = thiếu file design (designer) → `toolResultNote='error'`, `designerStatus='rework'`, `currentFulfillmentStage='print'`, `fulfillmentStages.print.status='waiting'`, timeline có `rework-back byUserId=worker`.
2. Tab **"Đang chờ quay lại"** match (timeline + `designerStatus='rework'`). KHÔNG lọt waiting (gate `designerStatus != rework`) / rework (status=waiting).
3. Leader gán designer → designer start → complete → `designerStatus='done'` + Entry A nhánh `else if`: vì print **CHƯA từng chạy** (`!firstStartedAt`) → set `fulfillmentStages.print.status='waiting'` (KHÔNG rework).
4. Tab **"Đang chờ"** match (`currentStage=print` + `status=waiting` + `designerStatus != rework`). Rời watching. User In bấm "Bắt đầu" như đơn in lần đầu. (Nếu print đã từng in dở rồi mới báo lỗi → bước 3 set `rework` → tab "Cần làm lại".)

**Đồng bộ 2 view:** áp cho cả `PrintOrderTable` (chip qua `applyFulfillmentStatusFilter`) lẫn kanban (tab qua `applyTabFilter`). Lưu ý: chip/tab `watching` lọc theo `byUserId` = người bấm lỗi; do worker In tự bấm trên đơn của xưởng mình nên khớp.

### 5.5 User service — Fulfillment validation

`createUser` + `adminUpdateUser`:

- `role === Fulfillment && !factoryId` → 400.
- `role === Fulfillment && !fulfillmentStage` → 400.
- Try/catch quanh `userRepository.create/update`: convert E11000 (duplicate `unique_factory_fulfillment_stage`) → 400 với message rõ ràng.

### 5.6 ⚠️ Gotcha: `getUserById` $project phải include `fulfillmentStage`

JWT strategy gọi `UserService.getUserById()` để build `@AuthUser() user` context cho mọi protected endpoint. Aggregation pipeline trong method này có 1 `$project` stage explicit — **chỉ field nào trong list mới có trên `user` object**, các field khác bị strip silently.

Trong khi đó, `FulfillmentTaskService.getMyTasks()` + `transition()` đều dùng `user.fulfillmentStage` để:

- Resolve stage mặc định khi query không truyền.
- Check ownership (`user.fulfillmentStage === body.stage`).

→ Nếu `getUserById` $project thiếu `fulfillmentStage`, mọi call tới `/v1/fulfillment/my-tasks` sẽ throw `"Thiếu stage (user chưa gán fulfillmentStage)"` **dù user đã được admin gán đúng trong DB**.

Đã fix tại `apps/api/src/modules/user/user.service.ts:96` — thêm `fulfillmentStage: 1` vào `$project`. Tương tự cho `getMe()` ($project khác, audience FE).

**Rule chung:** Bất kỳ field mới nào trên `UserEntity` mà downstream service / controller cần access qua `@AuthUser()` phải:

1. Thêm vào `$project` của `getUserById()` (BE auth context).
2. Thêm vào `$project` của `getMe()` (FE profile context — nếu cần hiển thị / store ở authStore).

Trừ khi field thuần private (chỉ DB schema, không có business logic dùng tới), luôn add cả 2 chỗ để tránh debug nhầm hướng.

---

## 6. Performance notes

- **My Tasks query**: index hỗ trợ
  - `factoryId` (existing).
  - `currentFulfillmentStage` (new, single field).
  - `inProductionAt` (existing, dùng làm tiebreak sort sau `orderAt`).
  - Sub-field `fulfillmentStages.<stage>.status` không index riêng (Mongo sẽ scan trong scope của factoryId + currentStage) — đủ nhanh vì queue per stage thường < 200 đơn.
- **Sort**: `{ orderAt: -1, inProductionAt: -1 }` — `orderAt` primary (thời gian khách đặt), `inProductionAt` secondary tiebreak (thời gian vào xưởng). Đổi từ `createdAt` Mongo timestamp → `inProductionAt` business time để khớp với toàn bộ flow order (xem `Orders.md` §7.0b).
- **Tab counts**: 5 query song song `countDocuments` (waiting/in-progress/rework/done/watching) — tổng < 50ms với dataset ~10k đơn/factory.
- **Timeline**: append-only, không index. Reads chỉ khi user mở chi tiết đơn (lazy).
- **Trần render kanban (`COLUMN_RENDER_LIMIT = 100`)**: mỗi cột chỉ render tối đa 100 card 1 lần, phần còn lại sau nút "Xem thêm" (`pages/fulfillment/my-tasks/index.tsx` → `Column`). Bắt buộc phải có: cột "Đã xong" của xưởng lớn với preset 7 ngày lên tới vài nghìn card (mỗi card kèm ảnh mockup), render hết làm ĐƠ HẲN tab ngay khi gõ 1 ký tự vào ô "TÌM / QUÉT MÃ" — ô chính của máy quét barcode tại trạm. Header cột, checkbox "chọn cả cột" và mọi phép đếm vẫn chạy trên danh sách ĐẦY ĐỦ, chỉ phần DOM bị cắt.
- **fulfillmentTimeline** có thể grow theo thời gian → nếu đơn rework nhiều lần (>50 entry) cần consider archive sau. Hiện tại chấp nhận.

---

## 7. Permissions

| Role                         | Quyền                                                             | Page truy cập           |
| ---------------------------- | ----------------------------------------------------------------- | ----------------------- |
| `Fulfillment` worker         | `fulfillment.task.transition` (chỉ transition stage của bản thân) | `/fulfillment/my-tasks` |
| `Manager` / `SupportManager` | `fulfillment.task.override`, `fulfillment.team.manage`            | All fulfillment pages   |
| `Admin` / `SuperAdmin`       | ALL                                                               | All                     |

Worker scope enforce ở BE: `user.fulfillmentStage === body.stage` && `user.factoryId === order.factoryId`.

---

## 8. Deferred (Phase 6/7 chưa làm)

- **Stats endpoint + page** (`/fulfillment/stats`): throughput per stage per period, cycle time avg, top worker. DTO đã định nghĩa (`GetFulfillmentStatsDto`, `FulfillmentStageStatRowZod`) — service + UI chưa.
- **Telegram noti**: aggregator + formatter cho fulfillment block trong scheduled report 3 slot. Optional cron alert đơn kẹt 24h.
- **Team admin queue page** (`/fulfillment/team`): kanban 5 column × factory. Hiện tại workers quản lý qua `/users` (form đã hỗ trợ stage dropdown).

---

## 9. Files / Folders liên quan

**Shared:**

- `packages/shared/enums/fulfillment-stage.ts` — enum + label + order
- `packages/shared/dtos/production-order.dto.ts` — fulfillment fields + transition DTOs + **`GetFulfillmentDailyOverviewDto`/`FulfillmentDailyRow` (+ `designerRework`)/`FulfillmentDailyOverviewResDto`**
- `apps/web/src/pages/fulfillment/my-tasks/PrintOrderTable.tsx` — + prop `dayOverride` (ép ngày cho bảng In khi click daily overview)
- `apps/web/src/pages/fulfillment/my-tasks/PrintWorkshopView.tsx` — + daily overview + `dayFilter`→`dayOverride`
- `apps/web/src/components/common/PipelineDailyOverview.tsx` — bảng dùng chung (prop `stage`/`lane`/`caption`), §4.6
- `apps/web/src/pages/designer/my-tasks/index.tsx` — + `<PipelineDailyOverview lane="designer">` trên "Chi tiết theo ngày"
- `apps/web/src/pages/home/ToolCheckTab.tsx` — + `<PipelineDailyOverview lane="tool">` trên dải focus 2 hàng
- `apps/web/src/services/fulfillment.ts` — + `dailyOverview()`
- `packages/shared/dtos/user.dto.ts` — `fulfillmentStage` field
- `packages/shared/constants/permission-catalog.ts` — 6 permission mới

**Backend:**

- `apps/api/src/modules/fulfillment/fulfillment.module.ts`
- `apps/api/src/modules/fulfillment/fulfillment-task.service.ts` — + `getDailyOverview()` + `resolveDayWindow()` (§5.1b)
- `apps/api/src/modules/fulfillment/fulfillment-task.controller.ts` — + `GET /fulfillment/daily-overview` (`OVERVIEW_ROLES` rộng hơn transition)
- `apps/api/src/modules/order/order.entity.ts` — 4 field mới + `makeEmptyStageState` helper
- `apps/api/src/modules/user/user.entity.ts` — `fulfillmentStage` + partial unique index
- `apps/api/src/modules/user/user.service.ts` — validation + E11000 handler
- `apps/api/src/modules/designer/designer-task.service.ts` — hook entry A (designer.complete) + nhánh `else if` cycle quay về set reporter stage = `rework` (§5.4)
- `apps/api/src/modules/order/order.service.ts` — helper `buildFulfillmentEntrySet()` + hook entry B ở `updateField` / `bulkUpdateField` / `importRework`; **helper `canReworkBackToDesigner()` + `buildDesignerReworkBackFromError()` + 3 call-site (`updateField` ×2 + `setProductionError`) cho hook báo lỗi designer qua cell (§5.4b)**

**Frontend:**

- `apps/web/src/pages/fulfillment/my-tasks/index.tsx` — kanban 4 cột + DnD + **daily overview + lọc client theo ngày**
- `apps/web/src/components/common/PipelineDailyOverview.tsx` — **bảng "Tổng quan theo ngày" dùng chung 3 nơi (Fulfillment kanban/print + Designer my-tasks + Soát tool), prop `stage`/`lane`/`caption`, §4.6**
- `apps/web/src/pages/fulfillment/my-tasks/FulfillmentTaskCard.tsx` — card component dùng chung 4 cột
- `apps/web/src/pages/fulfillment/my-tasks/PrintOrderTable.tsx` — bảng phẳng stage In (§4.5): chế độ phím ↑↓ (1 dấu ✓ theo cursor) + URL params persistence (prefix `p`, F5 giữ filter/ngày/search/status/trang)
- `apps/web/src/pages/fulfillment/my-tasks/PrintWorkshopView.tsx` — orchestrator transition + ReworkBackDialog cho stage In
- `apps/web/src/pages/fulfillment/my-tasks/ReworkBackDialog.tsx`
- `apps/web/src/services/fulfillment.ts`
- `apps/web/src/pages/users/index.tsx` — form thêm stage dropdown
- `apps/web/src/constants/paths.ts` — 3 PATH mới
- `apps/web/src/constants/routerConfig.ts` — lazy route
- `apps/web/src/components/sidebar/Sidebar.tsx` — entry "Task Fulfillment"

---

## Bổ sung: Báo lỗi toàn cục + Tab "Đang chờ quay lại" theo công đoạn

> Xem kế hoạch chi tiết: [`documents/Plans/UniversalErrorReporting-PerPersonStageStats.md`](../Plans/UniversalErrorReporting-PerPersonStageStats.md).

### 1. Tab "Đang chờ quay lại" (watching) → theo STAGE + XƯỞNG
- **Trước:** chỉ ĐÚNG người bấm báo lỗi (`byUserId`) mới thấy đơn trong tab watching.
- **Sau:** **mọi người đang giữ công đoạn đó trong xưởng** đều thấy (đã bỏ điều kiện `byUserId`), kể cả người báo là người khác / đã đổi ca.
- **Sửa ĐỒNG THỜI 2 chỗ** (nếu lệch → sai count giữa kanban worker và Print-admin view):
  - `apps/api/src/modules/fulfillment/fulfillment-task.service.ts` → `applyTabFilter` case `watching`.
  - `apps/api/src/modules/order/order.service.ts` → `applyFulfillmentStatusFilter` case `watching`.
- Giữ điều kiện "đơn đang ở stage TRƯỚC (`$in earlierStages`) HOẶC designer rework HOẶC tool-check pending" + scope factory. **KHÔNG** dùng `currentFulfillmentStage != stage` (kẹt vĩnh viễn).

### 2. Báo lỗi ĐƠN đã đi qua công đoạn mình / đã hoàn thành
- Điểm vào **duy nhất**: `OrderService.setProductionError` (không dính stage-guard của `transition`) — thêm field `target` (`SetProductionErrorDto.target: 'designer' | 'tool-check' | FulfillmentStage`).
- Helper mới `OrderService.buildFulfillmentReworkBack(before, target, reason, ctx)`: xác định `furthest` (currentStage, hoặc Pack nếu đã completed) → set `target..furthest` = `rework` (**làm lại toàn chuỗi**), `currentFulfillmentStage=target`, clear `fulfillmentCompletedAt` nếu reopen. `timelineEntry.stage = user.fulfillmentStage ?? furthest` → đúng công đoạn watch.
- Enforce chỉ lùi (`targetIdx < furthestIdx`).
- FE: `pages/fulfillment/my-tasks/FulfillmentTaskCard.tsx` hiện **badge lỗi tổng quát** (nguồn + công đoạn hiện tại + note + ×N) ở MỌI cột khi đơn mang lỗi (`productionError` + `toolResultNote='error'`).

### 3. Ô "Thống kê lỗi công đoạn" trong trang task
- `pages/fulfillment/my-tasks/StageErrorPanel.tsx` — click xổ **bảng lỗi theo ngày** (`inProductionAt`, VN tz; hàng = mã lỗi, cột = ngày). BE: `GET /fulfillment/stage-error-daily` (khóa stage+xưởng theo user role Fulfillment).

---

## Bổ sung: KIỆN HÀNG + BÀN GIAO (17/09/2026)

> **File BE:** `apps/api/src/modules/shipping-vnp/packing.service.ts` + `packing.logic.ts` (+ spec) · `shipping-package.entity.ts` (11 field mới) · 2 endpoint trong `shipping-vnp.controller.ts` · hook trong `fulfillment-task.service.ts`
> **File FE:** `apps/web/src/pages/handover/{index,HandoverSheetPrint}.tsx` · `pages/fulfillment/my-tasks/PackWeightDialog.tsx`
> **Route:** `/ffm/fulfillment/handover` · **API:** `GET /shipping-vnp/packages` · `POST /shipping-vnp/packages/handover`
> **Lấp GAP-25/26/27** của tài liệu chuyển đổi OnosPod.

Trước đây bản ghi kiện CHỈ sinh lúc mua vận đơn và chỉ gom danh sách mã — hệ không biết xưởng đã đóng cái gì, nặng bao nhiêu, ra khỏi kho lúc nào. Ba thứ đó hệ cũ có, và là **đầu vào bắt buộc để đối soát cước** ở giai đoạn sau.

**Ba chốt nghiệp vụ (chốt với người vận hành 17/09/2026):**

| Chốt | Quyết định | Vì sao |
| --- | --- | --- |
| Đơn vị kiện | **1 kiện = 1 đơn seller** (`khoaGopKien`) | Khớp cách mua label VNP (nhiều item chung 1 label) và cách xưởng đóng thật. Đơn không có mã đơn → mỗi item một kiện, KHÔNG gộp nhóm thiếu dữ liệu với nhau |
| Nhập cân | **Tuỳ chọn** ở bước Đóng hàng | Trạm chưa có cân điện tử vẫn phải đóng được hàng. Bắt buộc nhập = ngày triển khai đầu tiên cả chuyền đứng. Kiện thiếu cân bị đánh dấu ở màn Bàn giao |
| Phiếu bàn giao | Gom theo **xưởng + ngày + hãng** | Một chuyến xe một phiếu, tài xế ký một tờ. Hệ cũ in theo seller nên một chuyến phải in nhiều phiếu |

**Luồng:**

1. Công nhân hoàn thành công đoạn **Đóng hàng** → FE chặn lại bằng `PackWeightDialog` hỏi cân + số đo (có nút **Bỏ qua**) → gửi kèm `weightGram`/`dimensions` trong `FulfillmentTransitionDto`.
2. BE ở cạnh chuyển thật (`!wasCompleted && nowCompleted`) gọi `PackingService.ghiNhanDongGoi()` → upsert kiện theo `(orderId, factoryId)`, `$addToSet` mã item, đóng dấu `packedAt`/`packedByUserId`/`packedByUserName`. Item thứ hai cùng đơn **ghép vào kiện đã có**, quét lại cùng item không đẻ kiện mới.
3. Kho mở `/ffm/fulfillment/handover` → danh sách kiện đã đóng **chưa bàn giao** (sắp theo `packedAt` tăng dần — kiện nằm lâu nhất lên đầu) → tick → nhập hãng → **Bàn giao + in phiếu**.
4. `banGiao()` cấp **một mã `BG-<xưởng>-<ngày VN>-<số>`** cho cả lô, đóng dấu `handoverAt` (giờ xuất kho), rồi FE in `HandoverSheetPrint` (A4, có ô ký hai bên).

**Bốn quyết định kỹ thuật đáng nhớ:**

- **Hook không được ném lỗi** — `PackingService` tự nuốt và ghi log; công nhân đóng xong hàng rồi thì không thể vì lỗi ghi sổ mà bắt đóng lại.
- **Cân + in phiếu là MỘT thao tác** với việc đóng dấu giờ xuất kho. Tách ra sẽ có phiếu in rồi mà kiện vẫn nằm trong danh sách chờ.
- **Kiện đã bàn giao bị loại khỏi lượt sau** (`handoverAt: {$exists: false}` trong filter update) — đóng dấu đè sẽ xoá mất giờ xuất kho thật của chuyến trước; số kiện bị loại trả về `skipped` để FE báo.
- **Cân tính cước** dùng chung công thức với lúc seller tự mua label: `max(cân thật, dài×rộng×cao/6)`, thiếu một chiều thì bỏ phần quy đổi chứ không tính thể tích bằng 0 (`canTinhCuoc`, có spec).

**Chưa làm (vẫn thuộc phase P2 của lộ trình chuyển đổi):** chưa sinh bút toán chi phí trả xưởng khi đóng kiện (GAP-18), chưa đối soát cước thật với cân vừa thu được (GAP-19), chưa có thùng master gộp nhiều kiện (`parentPackageId` đã chừa sẵn field).
