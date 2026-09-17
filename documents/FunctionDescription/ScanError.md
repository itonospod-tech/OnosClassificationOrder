# Scan barcode → Gán lỗi nhanh — Function Description

> **UPDATE 2026-07-21 — Quét 2 bước (hands-free):** quét đơn `N-…` xong có thể quét tiếp mã **`OK`** (tự start+complete) hoặc **barcode lỗi `E-<code>`** (tự gán lỗi + đẩy về đích cấu hình sẵn — từ 2026-07-25 in dạng barcode Code128 thay QR vì nhiều máy quét không đọc được QR, payload không đổi) NGAY KHI DIALOG ĐANG MỞ — công nhân không cần chạm máy tính. Kèm beep WebAudio (thành công/thất bại) + parse tiền tố ở input chính. Danh mục lỗi theo công đoạn + gen/in barcode: xem [`StageErrorCatalog.md`](StageErrorCatalog.md). Helper dùng chung: `apps/web/src/utils/scanCodes.ts` (`parseScanCode` / `resolveErrorScan` / beep*).

> **File FE:** `apps/web/src/pages/orders/scan-error/index.tsx` (page) + `OrderErrorScanDialog.tsx` (modal gán lỗi) + `FulfillmentScanActionDialog.tsx` (modal hoàn thành/báo lỗi cho công nhân Fulfillment)
> **File BE:** `apps/api/src/modules/order/order.controller.ts` + `order.service.ts → getByProductionId()`
> **Route FE:** `/ffm/orders/scan-error`
> **API:** `GET /v1/orders/by-production-id/:code`, `POST /v1/orders/:id/fulfillment-transition`

---

## 1b. Chế độ công nhân Fulfillment (quét → Hoàn thành / Báo lỗi)

Khi user có `profile.fulfillmentStage` (công nhân Fulfillment), page chuyển sang luồng thao tác công đoạn thay vì gán lỗi thuần:

- Quét/tra cứu đơn → render `FulfillmentScanActionDialog` (thay vì `OrderErrorScanDialog`).
- **Đúng task** (`order.currentFulfillmentStage === myStage` **&&** `order.factoryId === profile.factoryId` **&&** status ∈ {waiting, in-progress, rework}): hiển thị chi tiết + badge trạng thái. **3 cách Hoàn thành tương đương**: (1) **quét LẠI chính barcode đơn đang mở** (`N-<productionId>` — so sánh case-insensitive với `order.productionId`, update 2026-07-23) · (2) quét mã **`OK`** · (3) nhấn **Enter** — nếu đang chờ/làm lại thì tự `start` rồi `complete` (2 BE call tuần tự); nếu đang làm thì `complete`. Quét mã đơn **KHÁC** → `onScanOrder` chuyển sang đơn đó (như cũ). Có nút **Báo lỗi** → page set `errorMode=true` → mở `OrderErrorScanDialog` cho cùng đơn (giữ flow gán lỗi + rework-back cũ).
- **Không phải task** (khác stage / khác xưởng / chưa vào fulfillment / đã done ở stage này): vẫn hiển thị chi tiết + banner đỏ nêu lý do, **chặn mọi thao tác** (không Hoàn thành, không Báo lỗi). Enter = đóng để quét tiếp; quét lại mã đơn đang mở / mã OK → beepError + toast lý do chặn.
- Guard double-submit bằng `savingRef`. Sau khi xong → `onClose` reset `order` + `errorMode` → input tự re-focus để quét đơn kế tiếp; append lịch sử "Hoàn thành <stage>".
- User KHÔNG có stage (admin/support…) → giữ nguyên luồng gán lỗi (`OrderErrorScanDialog`) như mục dưới.
- **Layout dialog (GẦN FULL MÀN HÌNH — update 2026-07-21, cho công nhân đứng xa đọc được)**: `w-[96vw] h-[94vh]` flex-col, grid 2 cột `md:grid-cols-2` — **cột trái mockup chiếm 1 NỬA + cao hết modal** (`flex-1 object-contain`, click mở ảnh gốc) + **nút "Mở ảnh gốc" to riêng** (`h-14 text-lg`) dưới ảnh; **cột phải chữ lớn** (cuộn dọc khi tràn): tên sản phẩm `text-3xl` + productionId mono `text-2xl` + SKU `text-lg`; 3 ô Size/Màu/SL (`BigField` value `text-3xl`); box Xưởng / Công đoạn / **Kết quả soát tool** `text-lg` (màu theo `toolResultNote`); **Link design** chip `text-base px-4 py-2.5`. Banner trạng thái `text-base`; footer button `h-14 text-lg` (Báo lỗi / **Hoàn thành (Enter)** hoặc Đóng & quét tiếp). `OrderErrorScanDialog` cũng GẦN FULL MÀN HÌNH (`w-[96vw] h-[94vh]`, grid 2 cột): trái = mockup chiếm 1 nửa cao hết modal (click mở ảnh gốc) + box tên sản phẩm `text-2xl`/meta `text-lg`; phải = banner + form cuộn dọc — chip lỗi `text-lg px-5 py-2.5`, label `text-lg`, box nguồn/đích `text-lg`, textarea `text-lg` 3 rows, footer `h-14 text-lg`.

Reuse 100% endpoint cũ (`by-production-id` + `fulfillment-transition` start/complete/rework-back) — không thêm BE. Liên quan: [`FulfillmentWorkflow.md`](FulfillmentWorkflow.md).

---

## 1. Overview

Workshop dùng **máy quét barcode USB** (HID keyboard emulation — không cần driver) để quét mã `productionId` in trên đơn → mở dialog gán lỗi nhanh + tùy chọn đẩy về công đoạn trước.

Mục tiêu: rút ngắn thao tác từ "tìm đơn trong Danh sách đơn → click cell `productionError` → chọn lỗi → submit" xuống **1 cú quét + 1 click Submit**. Phục vụ tình huống xưởng phát hiện lỗi giữa dây chuyền in/ép/may → cần gán lỗi + đẩy về stage trước fix ngay.

**2 nghiệp vụ kết hợp trong 1 dialog:**

| Nghiệp vụ | Endpoint reuse | Tác dụng |
|---|---|---|
| Gán mã lỗi xưởng (luôn luôn) | `POST /v1/orders/:id/set-production-error` | Set `productionError` + `productionErrorSource` + `productionErrorNote`. Đơn vào tab "Nhật ký bù lỗi". Hook BE auto-set `toolResultNote='error'`, `productionErrorCount++`, `productionFirstErrorAt` (mốc bắt đầu cycle lỗi). |
| Đẩy về công đoạn (mặc định Soát tool) | `POST .../fulfillment-transition` (Designer/stage) **hoặc** `set-production-error` source=`tool-check` (Soát tool) | **Soát tool** (mặc định): không gọi transition — `setProductionError` source=`tool-check` tự đẩy về Support (support-hold). **Designer / stage trước**: `rework-back`, reset stage đích + intermediate về `rework`, chỉ khi `currentFulfillmentStage != null`. |

---

## 2. Luồng hoạt động

### 2.1 Setup máy quét USB

1. Cắm máy quét USB vào máy tính của workshop staff → OS auto-detect = **HID keyboard** (không cần driver / SDK).
2. Máy quét default kết thúc với phím **Enter**. Khi quét, nó "gõ" từng ký tự của `productionId` vào ô đang focus rồi Enter.
3. Không lưu vào clipboard — chỉ inject keystroke vào input đang focus.

### 2.2 Quét → gán lỗi

```
User vào /orders/scan-error
  → Chọn chế độ:
       • Barcode (default) — máy quét USB output kèm tiền tố "N-"
       • Nhập tay — gõ trực tiếp Production ID
  → Input autoFocus (ScanLine / Keyboard icon prefix tùy mode)
  → Mode=barcode: quét → "N-PROD1234<Enter>"
       normalizeCode() strip "N-" → còn "PROD1234"
       (Preview chip "Sẽ tra cứu: PROD1234 ✓ đã bỏ 'N-'" hiển thị live)
    Mode=normal:  gõ "PROD1234<Enter>" → search nguyên xi
  → call GET /v1/orders/by-production-id/PROD1234
  → BE match exact case-insensitive + áp visibility filter theo role
      - 404 → toast "Không tìm thấy" + append history
      - 200 → setOrder(data) → mở OrderErrorScanDialog
  → User chọn mã lỗi (chip group production_error)
      - Auto-fill source từ workshop_config.errorSource
      - Code='other' → bắt buộc nguồn + note
  → User chọn nguồn (designer/factory) — radio button
  → User nhập note (optional, trừ khi code='other')
  → User pick "Đẩy về công đoạn" (optional, chỉ khi đơn đã vào fulfillment)
      - "Chỉ mark lỗi" (default) — không gọi fulfillment-transition
      - "Designer" / "<stage trước>" — gọi rework-back với reason = note
  → Submit
      1. POST /v1/orders/:id/set-production-error { code, source, note? }
      2. Optional: POST /v1/orders/:id/fulfillment-transition { stage, action: 'rework-back', target, reason }
  → Toast success → append history → close modal → input re-focus (sau 100ms)
  → Sẵn sàng quét đơn tiếp theo
```

### 2.3 Auto-refocus

- Input có `autoFocus` lần render đầu.
- Modal đóng → `useEffect` re-focus input sau 100ms (cho phép animation modal hoàn tất).
- Trong khi modal open → input bị disable (không auto-focus, tránh keystroke máy quét rơi vào nhầm chỗ).
- Trong khi đang fetch lookup → input disable + spinner inline.

### 2.4 Recent scans

State local, không persist. Max 10 entry. Mỗi entry:
- ✅ **Success** — `productionId` + tên lỗi gán + nhãn đẩy về (vd "Lệch màu · Đẩy về In").
- ⚠️ **Not found** — `productionId` không khớp đơn nào.
- ❌ **Error** — request fail (network / 5xx).

Có nút "Xoá" clear toàn bộ. Counter mini: Thành công / Không tìm thấy / Lỗi.

---

## 3. API / Schema

### 3.1 Endpoint mới

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/v1/orders/by-production-id/:code` | Exact match case-insensitive theo `productionId`. Populate `factory`/`machineType`/`productConfig`. Áp visibility filter theo role: Designer chỉ thấy đơn `assignee=user._id`, Fulfillment chỉ thấy `factoryId=user.factoryId` hoặc `originalFactoryId=user.factoryId`. 404 nếu không tìm thấy / không thuộc scope. |

**Lý do KHÔNG dùng `GET /v1/orders?search=X`:** search endpoint dùng `$regex` không anchor → match partial nhiều đơn; không trả populate đầy đủ; permission/cache shape khác. Endpoint riêng cho rõ ràng + dễ tối ưu.

### 3.2 Endpoint tái dùng

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/v1/orders/:id/set-production-error` | Atomic set 3 field `productionError` + `source` (`designer`/`factory`/`tool-check`) + `note`. Hook BE: `toolResultNote='error'`, `productionErrorCount++`, set `productionFirstErrorAt`, auto-rework designer nếu `source=designer + designerStatus=done`, **đẩy về Support nếu `source=tool-check`** (support-hold). |
| `POST` | `/v1/orders/:id/fulfillment-transition` action=`rework-back` | Đẩy về Designer / stage trước. Reporter stage → waiting (workMs cộng dồn), target → rework, intermediate → rework, `currentFulfillmentStage` = target. |

### 3.3 DTO mới (shared)

```ts
// packages/shared/dtos/production-order.dto.ts
export const GetOrderByProductionIdResZod = ResZod.extend({ data: ProductionOrderZod });
export class GetOrderByProductionIdResDto extends createZodDto(
  extendApi(GetOrderByProductionIdResZod),
) {}
```

### 3.4 Permission mới

```
page.scan_error — Truy cập màn hình "Quét mã lỗi"
```

Default preset:
- `Fulfillment` — auto include (workshop staff là user chính của tính năng).
- `Manager`, `SupportManager`, `Admin`, `SuperAdmin` — auto inherit qua `ALL_PERMISSION_CODES`.

Page tự `<Navigate to={PATHS.ORDERS}>` nếu user thiếu perm (defense-in-depth, ngoài check sidebar).

---

## 4. UI Components

### 4.1 Page `/orders/scan-error` (`pages/orders/scan-error/index.tsx`)

- **Header**: avatar indigo + `ScanLine` icon + title "Quét mã lỗi" + sub "Cắm máy quét USB → click vào ô input → quét barcode để mở dialog gán lỗi."
- **Scan box** (card bg-card border):
  - **Mode toggle** (segmented): 2 nút "Barcode" / "Nhập tay" với icon `ScanLine` / `Keyboard`. Default = `barcode`. Persist mode trong `localStorage` key `scan-error-mode`.
  - `<Input>` autoFocus với icon prefix đổi theo mode + spinner inline khi đang fetch. Font-mono.
  - Placeholder đổi theo mode:
    - barcode → `Quét barcode (kỳ vọng "N-…")…`
    - normal → `Nhập Production ID rồi Enter…`
  - **Live preview chip** "Sẽ tra cứu: `<code>` ✓ đã bỏ 'N-'" — hiển thị khi mã input khác mã sau strip, hoặc khi mode=barcode nhưng không thấy tiền tố (warning amber).
  - `<Button>` "Tra cứu" cho user gõ tay không có Enter.
  - Hint text đổi theo mode:
    - barcode → "máy quét USB hoạt động như bàn phím — chỉ cần ô input có focus, mã 'N-…' sẽ tự nhảy vào kèm Enter. Hệ thống tự bỏ tiền tố trước khi tra cứu."
    - normal → "nhập đầy đủ Production ID (không có tiền tố) rồi nhấn Enter để tra cứu."
- **Recent history** (card):
  - Header: `History` icon + count `N/10` + counter pill (Thành công / Không tìm thấy / Lỗi) + nút "Xoá".
  - List items: icon status + `productionId` font-mono + nhãn trạng thái + sub message + thời gian (HH:mm:ss).
  - Empty state: "Chưa có quét nào. Quét hoặc gõ Production ID để bắt đầu."

### 4.2 Modal `OrderErrorScanDialog`

> **UPDATE 2026-07-21 (Stage Error Catalog):** form đã đổi — **Mã lỗi CHỈ hiển thị danh mục lỗi của công đoạn ngữ cảnh** (`user.fulfillmentStage`, fallback `order.currentFulfillmentStage`; filter store production_error theo `o.stage`). Chưa có lỗi nào → box amber + **Link sang `/orders/stage-errors`** để thêm. Chọn lỗi → **nguồn + đích đẩy về TỰ SUY từ config** (`resolveErrorScan`) hiển thị read-only — ĐÃ BỎ radio "Nguồn lỗi" + chip "Đẩy về công đoạn" (không chọn tay). Đích không hợp lệ với vị trí đơn → box đỏ + disable submit. Lỗi `other` không còn trong luồng này (note giờ luôn optional). Mô tả bên dưới là bản CŨ, giữ để tham khảo phần không đổi (summary card, banner hủy/lỗi đã ghi, footer, Cmd/Ctrl+Enter).

- **Header**: `MessageSquareWarning` rose icon + "Gán lỗi · {productionId}".
- **Order summary card** (rounded muted background):
  - Thumbnail mockup 48×48 (bg-checker) + Type + size/color/qty.
  - Grid 2 cột: Xưởng (factory shortName + machineType) · Stage hiện tại (FULFILLMENT_STAGE_LABELS[currentStage] hoặc "Chưa vào fulfillment").
  - Badge "rework ×N" amber nếu `designerReworkCount > 0`.
- **Form 3 phần**:
  1. **Mã lỗi** *(required)* — chip group từ `useWorkshopConfigStore.byCategory.production_error`, sort theo `order`. Chip 'other' có icon `AlertTriangle`. Active state: bg-rose-500.
  2. **Nguồn lỗi** *(required, mặc định "Do soát tool")* — 3 button: **Do soát tool** (amber) / Do xưởng (sky) / Do designer (violet). Auto-fill từ `workshop_config.errorSource` khi user chọn code (bao gồm `tool-check`). Hint amber khi pick `designer` ("task tự về Cần làm lại cho designer") hoặc `tool-check` ("đơn tự đẩy về Support tab Soát tool").
  3. **Mô tả lỗi** — textarea 2 rows, max 500ch, counter. Required khi code='other'.
- **Section "Đẩy về công đoạn"** *(mặc định "Soát tool")* — luôn render:
  - Chip **"Soát tool"** LUÔN có (đẩy về Support, kể cả khi đơn chưa vào fulfillment); click cũng set nguồn lỗi = `tool-check`. Chip "Designer" + N chip stage trước chỉ khi `currentFulfillmentStage != null`.
  - `reworkTarget='tool-check'` → **KHÔNG** gọi `fulfillment-transition`; `setProductionError` với `source='tool-check'` tự đẩy đơn về Support (support-hold). Hint amber tương ứng.
  - Hint khi pick target stage/designer: "Mô tả lỗi sẽ được dùng làm lý do rework. Nếu trống, mặc định 'Gán lỗi qua màn hình quét'."
- **Fallback alert** khi đơn chưa vào fulfillment *và* target ≠ Soát tool: amber box `ListChecks`: "Đơn chưa vào fulfillment — chỉ có thể đẩy về Soát tool hoặc mark lỗi."
- **Footer**: "Huỷ" + "Gán lỗi & Quét tiếp" (primary, disabled khi chưa đủ điều kiện).
- **Phím tắt**: `Cmd/Ctrl+Enter` submit nhanh khi `canSubmit`.

### 4.3 Sidebar entry

Group "Workspace" → con của "Orders":
```ts
{ key: 'orders-scan-error', label: 'Quét mã lỗi', to: PATHS.ORDERS_SCAN_ERROR, icon: <ScanLine size={14} />, perm: 'page.scan_error' }
```

---

## 5. Backend logic

### 5.1 `OrderService.getByProductionId(code, roleName, userId?, fulfillmentFactoryId?)`

```ts
1. trim(code) → 404 nếu rỗng.
2. Escape regex special chars + anchor `^...$` → exact match case-insensitive.
3. findOne + populate factory/machineType/productConfig.
4. Visibility check:
   - Designer (sub): assignee === userId → else 404 "Đơn không thuộc phạm vi của bạn."
   - Fulfillment: factoryId === fulfillmentFactoryId HOẶC originalFactoryId === fulfillmentFactoryId → else 404 "Đơn không thuộc xưởng của bạn."
   - Roles khác: không kiểm tra (full scope).
5. Return { success: true, data: doc }.
```

Lý do throw 404 (không 403) khi visibility fail: tránh leak existence — user không nên biết "đơn này tồn tại nhưng không thuộc tôi".

### 5.2 Hook chain khi submit

```
FE submit
  ↓
POST /v1/orders/:id/set-production-error
  → updateField('productionError') hook:
    - toolResultNote='error'
    - productionErrorCount++
    - productionFirstErrorAt = now (nếu chưa có) → đơn vào tab "Nhật ký bù lỗi"
    - Nếu source=designer + designerStatus=done → auto rework + designerReworkCount++
  → OrderLog write 3 entries (productionError, source, note)
  ↓
(Optional) POST /v1/orders/:id/fulfillment-transition action=rework-back
  → resolveTransition() patch + check race
  → Reporter stage → waiting, target/intermediate → rework
  → currentFulfillmentStage = target
  → OrderLog write fulfillmentStages.<stage>.status
```

---

## 6. Performance notes

- **Query lookup**: dựa trên `productionId` index (unique). Regex `^...$` case-insensitive dùng được index khi Mongo bật collation hoặc với prefix anchor. Đo: < 5ms với dataset ~50k đơn.
- **Populate**: 3 ref (`factoryId` / `machineTypeId` / `productConfigId`) đã có index. Total query time < 20ms.
- **No cache**: endpoint không cache vì lookup từng đơn riêng lẻ + visibility filter tùy user → cache miss rate cao, không lợi.
- **History client-side**: max 10 entry, không persist → 0 cost backend khi user xoá / refresh page.

---

## 7. Permissions

| Role | Truy cập page | Quét + gán lỗi |
|---|:---:|:---:|
| `Fulfillment` | ✅ (`page.scan_error` preset) | ✅ (đã có `order.field.productionError.edit` + `fulfillment.task.transition`) |
| `Admin` / `SuperAdmin` / `Manager` | ✅ (inherit ALL) | ✅ |
| `SupportManager` | ✅ (inherit ALL) | ✅ |
| `Support` | ❌ | ❌ |
| `DesignerLeader` | ❌ | ❌ (không có `productionError.edit`) |
| `Designer` (sub) | ❌ | ❌ |

Sidebar item ẩn cho role không có `page.scan_error`. Page tự `Navigate` về `/orders` nếu user lách qua URL.

---

## 8. Edge cases

| Case | Hành vi |
|---|---|
| Mode=barcode + chuỗi không có tiền tố `N-` | Vẫn search nguyên xi (permissive). UI hiển thị warning amber "không thấy tiền tố 'N-' — đảm bảo bạn đang quét đúng loại barcode" để cảnh báo workshop. |
| Mode=normal + user paste chuỗi có `N-` | Search nguyên xi (KHÔNG strip) → 404 vì DB không có `N-PROD…`. User cần đổi mode hoặc xoá `N-` thủ công. Đây là intentional: 2 mode tách biệt rõ trách nhiệm. |
| Tiền tố `N-` viết hoa/thường | Check exact `N-` (uppercase). Máy quét luôn output cùng format → không cần case-insensitive. |
| User scan đơn không tồn tại | Toast "Không tìm thấy" + history entry not-found. Input clear + re-focus. |
| User scan đơn ngoài scope (vd Fulfillment xưởng A quét đơn xưởng B) | 404 với message rõ ràng. KHÔNG phân biệt với "không tồn tại" để chống enumeration. |
| Đơn chưa vào fulfillment (`currentFulfillmentStage = null`) | Section "Đẩy về công đoạn" ẩn hoàn toàn, thay bằng alert amber. Chỉ cho gán mã lỗi. |
| **Đơn đã hủy (`cancelledAt` set)** | **KHÔNG cho báo lỗi / đẩy về công đoạn trước.** BE `setProductionError` throw `BadRequestException` "Đơn đã hủy — không thể báo lỗi / đẩy về công đoạn trước." ngay sau khi load đơn (trước mọi rework-back). FE `OrderErrorScanDialog` hiện banner đỏ "Đơn đã hủy — không thể báo lỗi" + disable nút submit (`orderCancelled` qua `isCancelled(order)`). Đơn hủy là trạng thái cuối, đã ra khỏi mọi công đoạn (xem `Plans/CancelledOrders-ExcludeFromStages.md`). |
| Đơn đã có `productionError` từ trước | Cho gán đè bình thường. `productionErrorCount` tự `$inc` bởi hook BE. |
| User pick code 'other' nhưng quên nguồn/note | Submit button disable + label hiện `*` đỏ. BE cũng validate 400 nếu lách. |
| Network fail giữa chừng (`setProductionError` xong, `rework-back` fail) | Toast lỗi từ axios. Đơn đã có productionError nhưng chưa rework. User có thể quét lại để retry rework — `setProductionError` idempotent về mặt outcome. |
| Cmd/Ctrl+Enter trong textarea | Submit nếu `canSubmit`. KHÔNG conflict với newline vì textarea swallow plain Enter. |
| User click ra khỏi input lúc đang quét tiếp | Input tự re-focus sau 100ms khi modal đóng. Trong khi modal open → input disable nên keystroke máy quét không bị nhầm. |

---

## 9. Roll-out & test

### 9.1 Manual test checklist

- [ ] Cắm máy quét USB → check OS nhận diện là HID keyboard (System Settings → USB).
- [ ] Mở `/orders/scan-error` → input autoFocus → quét 1 barcode → dialog mở.
- [ ] Đơn chưa vào fulfillment → section "Đẩy về công đoạn" ẩn, alert amber hiện.
- [ ] Đơn đang ở `press` → section hiện 2 chip "Designer" + "In" (stage trước press).
- [ ] Pick code 'other' → 2 field source/note hiện required, submit disable khi thiếu.
- [ ] Submit chỉ-mark-lỗi → DB: `productionError` set, `toolResultNote='error'`, `productionErrorCount++`, `currentFulfillmentStage` giữ nguyên.
- [ ] Submit kèm rework-back về In → DB: `currentFulfillmentStage='print'`, `fulfillmentStages.press.status='waiting'`, `fulfillmentStages.print.status='rework'`.
- [ ] Quét đơn không tồn tại → toast + history entry not-found.
- [ ] Quét đơn xưởng khác (login Fulfillment) → 404 (không leak existence).
- [ ] Modal đóng → input tự re-focus → quét tiếp được liền.

### 9.2 Test API tay (Postman/curl)

```bash
# Đăng nhập lấy token rồi:
curl -X GET http://localhost:3001/v1/orders/by-production-id/PROD-1234 \
  -H "Authorization: Bearer <token>"
# Expect: { success: true, data: { _id, productionId, factory, machineType, currentFulfillmentStage, ... } }
```

---

## 10. Khả năng mở rộng

- **Quét nhiều đơn cùng lúc** (bulk error tag): mode "batch" — accumulate productionId vào danh sách, submit 1 lần với 1 mã lỗi chung. Cần thêm endpoint bulk-set-production-error (chưa làm).
- **Beep / vibrate / animation feedback**: thêm `<audio>` element + `Web Vibration API` cho success/fail. Workshop đỡ nhìn màn hình.
- **Pattern B (global keyboard listener)**: detect scan dựa trên thời gian keystroke (< 50ms/char). Cho phép quét khi input không focus. Hiện chưa làm vì Pattern A đủ dùng cho workflow page-dedicated.
- **Lịch sử quét persist**: dùng `localStorage` để giữ giữa session — handy khi workshop quét cả ca rồi review cuối ngày.
- **Quét → mở trực tiếp Danh sách đơn filtered theo productionId**: option khác thay vì mở dialog gán lỗi. Tùy thuộc nghiệp vụ.

---

## 10b. Bảng mã hành động `ACT-*` + in tem/label từ popup (2026-09-17)

> Bối cảnh nghiệp vụ: **tem to** (tem khách 4×6cm QR `/track/:productionId` — `CustomerLabelPrint`) cho khách xem, **tem nhỏ** (tem barcode xưởng 75×50mm `N-<productionId>` — `BarcodeLabelPrint`) cho nội bộ dán vào vải/sản phẩm từ đầu chuyền, **label** (4×6 inch kiểu carrier — `ShippingLabelPrint`) cho bên vận chuyển. Công nhân đến bước đóng gói quét tem nhỏ → popup → quét mã action để in tem to + label, **hai tay không rời máy quét**.

### 10b.1 Bộ mã action (`utils/scanCodes.ts`)

Prefix mới `ACT-` (`SCAN_ACTION_PREFIX`), parse case-insensitive → `{ kind: 'action', command }`:

| Payload barcode | Command | Hành vi trong popup |
| --- | --- | --- |
| `OK` (sẵn có) | — | Như phím Enter: hoàn thành công đoạn / xác nhận in trong hộp thoại in |
| `ACT-CANCEL` | `cancel` | Như ESC: đóng popup đơn đang mở |
| `ACT-PRINT-TEM` | `print-tem` | In tem khách 4×6cm cho đơn đang mở |
| `ACT-PRINT-LABEL` | `print-label` | In label giao hàng 4×6 inch cho đơn đang mở |
| `ACT-ERROR` | `report-error` | Mở màn gán lỗi (dialog công đoạn → chuyển `OrderErrorScanDialog`; đang ở màn lỗi → toast nhắc quét thẳng `E-…`) |

`print-design` đã đặt chỗ trong type (`ScanActionCommand`) nhưng **chưa triển khai** — chưa in ra sheet. Quét `ACT-*` khi CHƯA mở đơn nào → toast "quét đơn trước" (cùng nhánh với `OK`/`E-…` ở `handleLookup`).

### 10b.2 In từ popup (`useScanPrint.tsx` — hook dùng chung 2 dialog)

- 2 nút mới ở footer CẢ 2 dialog: **"In tem khách"** + **"In label giao hàng"** — bấm tay hoặc quét `ACT-PRINT-*` đều gọi cùng handler.
- Tem khách: `getByProductionId` trả full document nên truyền thẳng order vào `CustomerLabelPrint` (cast sang `WorkshopOrderRow`). Label: fetch `POST /orders/shipping-labels` (ids=[_id]) rồi mount `ShippingLabelPrint`; thiếu địa chỉ → toast cảnh báo `printActions.labelNoAddress`, không in tem trống.
- **Cơ chế OK-để-in**: cả 2 component in đều mount → `window.print()` → hộp thoại in trình duyệt mở. Máy quét luôn gửi kèm Enter cuối mã, Enter trong hộp thoại in = nút "In" → **quét `OK` là in ra**. Muốn hủy phải bấm ESC bàn phím (mọi mã quét đều kết thúc bằng Enter nên không có mã hủy dùng được ở bước này — ghi rõ trên sheet).

### 10b.3 Sheet in bảng mã (`ActionCodeSheetPrint.tsx`)

Nút **"In bảng mã hành động"** trên header trang quét → sheet A4 Code128 (react-barcode) 5 mã trên + mô tả từng mã + ghi chú cơ chế OK/ESC, in ra dán cạnh trạm. Dùng khuôn portal + `display:none` siblings của `CustomerLabelPrint`, **KHÔNG** dùng visibility-trick luôn-mount như sheet `stage-errors` — trang này còn in tem/label từ chính nó, style `visibility: hidden` thường trực sẽ nuốt trắng các bản in kia. Sheet mount lúc in rồi tự gỡ (`afterprint` + timeout).

---

## 11. Files / Folders liên quan

**Shared:**
- `packages/shared/dtos/production-order.dto.ts` — `GetOrderByProductionIdResDto`
- `packages/shared/constants/permission-catalog.ts` — `page.scan_error` + Fulfillment preset

**Backend:**
- `apps/api/src/modules/order/order.controller.ts` — `GET /by-production-id/:code` (đặt TRƯỚC `GET /:id` để Nest match đúng)
- `apps/api/src/modules/order/order.service.ts` — `getByProductionId()`

**Frontend:**
- `apps/web/src/pages/orders/scan-error/index.tsx` — page chính (input + history + nút in bảng mã hành động)
- `apps/web/src/pages/orders/scan-error/OrderErrorScanDialog.tsx` — modal gán lỗi
- `apps/web/src/pages/orders/scan-error/useScanPrint.tsx` — hook in tem khách/label từ popup (§10b.2)
- `apps/web/src/pages/orders/scan-error/ActionCodeSheetPrint.tsx` — sheet A4 bảng mã hành động (§10b.3)
- `apps/web/src/utils/scanCodes.ts` — `SCAN_ACTION_PREFIX`/`ScanActionCommand`/`ACTION_SHEET_CODES` (§10b.1)
- `apps/web/src/services/order.ts` — `getByProductionId(code)`
- `apps/web/src/constants/paths.ts` — `PATHS.ORDERS_SCAN_ERROR`
- `apps/web/src/constants/routerConfig.ts` — lazy route
- `apps/web/src/components/sidebar/Sidebar.tsx` — entry "Quét mã lỗi" trong group con Orders

---

## 12. Lịch sử thay đổi

- **2026-09-17** — **Bảng mã hành động `ACT-*` + in tem/label từ popup** (§10b): prefix `ACT-` trong `parseScanCode`, hook `useScanPrint` gắn vào cả 2 dialog (nút + mã quét in tem khách 4×6cm / label giao hàng 4×6"), sheet A4 `ActionCodeSheetPrint` in dán trạm, cơ chế "quét OK trong hộp thoại in = bấm In" nhờ Enter cuối mã của máy quét.
- **2026-07-21** — Quét 2 bước: dialog bắt keystroke máy quét (buffer + reset 600ms) → `OK` = hoàn thành, `E-<code>` = báo lỗi theo config (`resolveErrorScan`), `N-…` = thay đơn đang chờ. Beep WebAudio 3 loại. Xem `StageErrorCatalog.md`.
- **2026-07-21 (update)** — **Xác nhận 2 lần quét lỗi**: quét `E-` lần 1 chỉ CHỌN lỗi (validate thuộc danh mục công đoạn người quét; `FulfillmentScanActionDialog.onScanError` → handoff `OrderErrorScanDialog` `initialCode`); quét lần 2 CÙNG MÃ hoặc Enter tay mới ghi nhận + đẩy về; quét mã khác = đổi lựa chọn; burst-detector cắt mã máy quét gõ nhầm vào textarea note. Bỏ prop `onErrorSaved`.

- **2026-06-27** — Initial implementation. Page + modal + BE endpoint + permission. Reuse `setProductionError` + `fulfillment-transition` (rework-back). Pattern A (autoFocus + onPressEnter + auto-refocus).
- **2026-06-27 (update)** — Thêm **mode toggle** Barcode/Nhập tay (segmented control) + persist trong `localStorage`. Mode barcode: auto-strip tiền tố `N-` qua helper `normalizeCode()`. Live preview chip "Sẽ tra cứu: …" + warning amber khi mode=barcode nhưng thiếu tiền tố. Placeholder + hint + icon đổi theo mode.

---

## Bổ sung: Báo lỗi đơn đã qua công đoạn / đã hoàn thành

- **Công nhân Fulfillment quét 1 đơn KHÔNG phải công đoạn mình** (đã sang stage sau / đã hoàn thành): `FulfillmentScanActionDialog` giờ hiện nút **"Báo lỗi đơn này"** cả khi không phải task của họ → mở `OrderErrorScanDialog`.
- `OrderErrorScanDialog`:
  - Đơn **đã hoàn thành fulfillment** (`fulfillmentCompletedAt`, `currentFulfillmentStage=null`) → vẫn chọn được công đoạn đích (furthest=Pack → In..May xuất); báo về sẽ **mở lại đơn + làm lại từ công đoạn đã chọn**.
  - Gộp về **1 lần** `setProductionError({code, source, note, target})` — bỏ lệnh `fulfillment.transition` riêng (né stage-guard). `target` = FulfillmentStage → BE `buildFulfillmentReworkBack` (làm lại toàn chuỗi); `designer`/`tool-check` vẫn source-driven.
