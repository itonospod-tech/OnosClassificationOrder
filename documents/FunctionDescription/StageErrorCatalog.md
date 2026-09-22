# Stage Error Catalog — Danh mục lỗi theo công đoạn + Quét 2 bước (Barcode)

> **File FE:** `apps/web/src/pages/orders/stage-errors/index.tsx` (trang danh mục + in barcode) + `apps/web/src/utils/scanCodes.ts` (parse mã / beep / resolve đích) + `apps/web/src/pages/orders/scan-error/{index,FulfillmentScanActionDialog,OrderErrorScanDialog}.tsx` (luồng quét 2 bước)
> **File BE:** `apps/api/src/modules/workshop-config/` (entity + service + controller — endpoints `stage-errors`)
> **Route:** `/ffm/orders/stage-errors`
> **API:** `GET|POST /v1/workshop-config/stage-errors`, `PATCH /v1/workshop-config/stage-errors/:id`

## 1. Overview

Mục tiêu: công nhân fulfillment thao tác **100% bằng máy quét, không chạm máy tính**:

1. Quét barcode **đơn** (`N-<productionId>`) → hệ thống hiện đơn đang chờ hành động.
2. Quét tiếp **mã hành động** (in sẵn trên bảng barcode dán tại trạm):
   - Mã **`OK`** → tự `start` + `complete` công đoạn của mình → đơn sang công đoạn sau.
   - Mã **lỗi `E-<code>`** → tự `setProductionError` với mã lỗi + **đích đẩy về cấu hình sẵn** — không chọn gì thêm.

Mỗi công đoạn có **danh mục lỗi riêng** do chính công nhân công đoạn đó tự thêm. Mỗi lỗi khai báo **đích đẩy về** (= nguồn lỗi): Soát tool / Designer / 1 stage đứng TRƯỚC công đoạn sở hữu. Thêm lỗi xong → **barcode Code128** sinh ngay (client-side, lib `react-barcode` — đã đổi từ QR sang barcode 1D vì nhiều máy quét ở xưởng không đọc được QR; **payload `E-<code>` giữ nguyên** nên luồng quét + BE không đổi gì) → nút "In" ra **tem decal 60×40mm** (cùng khổ tem nhỏ dán sản phẩm — in luôn trên máy in tem ở trạm), mỗi lỗi 1 tem.

## 2. Luồng hoạt động

### 2.1 Quản lý danh mục (`/ffm/orders/stage-errors`, perm `page.stage_errors`)

- Công nhân Fulfillment: **khóa vào công đoạn của mình** (`profile.fulfillmentStage`); Admin/Manager: chọn 1 trong 6 stage.
- Thêm lỗi: nhập tên + chọn đích đẩy về (chip: Soát tool / Designer / các stage trước). Code BE **tự sinh** `se-<stage>-<n>`.
- **Đã thêm là KHÔNG SỬA được** (tên/đích cố định — barcode đã in + đơn đã gán sẽ đổi nghĩa nếu sửa): chỉ cho **ẩn/hiện** (`isActive`). Muốn "sửa" → ẩn lỗi cũ + thêm lỗi mới. **KHÔNG xóa cứng** — lỗi đã từng gán vào đơn phải giữ để thống kê cũ resolve được tên.
- **Chọn lỗi (checkbox từng row + chọn tất cả)** rồi thao tác bằng 2 nút (disabled khi chưa chọn):
  - **"In (n)"**: `window.print()` ra **tem decal 60×40mm mỗi lỗi 1 tem** (đổi 22/09/2026, thay sheet A4 2 cột cũ): tem đầu luôn là `OK`, mỗi tem = tên lỗi (bold, clamp 2 dòng) + barcode Code128 + dòng "Đẩy về X · E-code". Khối in `#stage-error-label-print` render qua `createPortal(document.body)` + CSS `display:none` mọi anh chị em lúc in — mirror cơ chế `BarcodeLabelPrint` (KHÔNG dùng visibility-trick vì phần tử ẩn vẫn chiếm chỗ → lòi tem trắng trên giấy decal); `@page { size: 60mm 40mm }`, `break-after: page` từng tem. Module barcode 0.9px cho payload lỗi (~15 ký tự, cùng lý luận khổ 60×40 của tem sản phẩm), riêng `OK` ngắn nên nới 2px.
  - **"Xuất PDF (n)"**: **trang ĐẦU luôn là nhãn "✔ HOÀN THÀNH"** (`SCAN_OK_CODE`, canvas ẩn trong wrapper `#bar-canvas-ok`, `drawOkLabel()` — mirror card OK đứng đầu sheet in), sau đó mỗi lỗi đã chọn = **1 trang A8 (52×74mm)** — nhãn vẽ trên canvas qua helper chung `drawA8Label(barWrapId, title, subtitle, code)` (viền + barcode kéo giãn 880×480px lấy từ canvas ẩn `react-barcode renderer="canvas"` bọc trong `div#bar-canvas-<id>` vì lib không nhận prop `id` + tiêu đề bold wrap ≤3 dòng + phụ đề + code mono) rồi `addImage` nguyên trang vào `jsPDF` (né vấn đề font tiếng Việt của jsPDF; lib import lazy). File `barcode-loi-<stage>.pdf`.

### 2.2 Quét 2 bước (`/ffm/orders/scan-error`)

- Input chính parse thêm tiền tố qua `parseScanCode()`: quét `OK`/`E-…` khi **chưa** có đơn → beep lỗi + toast "Hãy quét mã ĐƠN trước".
- Đơn tìm thấy → beep 1 tiếng (`beepScan`) + mở dialog như cũ. **Dialog mở vẫn bắt được máy quét**: buffer keystroke ở `onKeyDown` của DialogContent (bỏ qua khi focus trong input/textarea; ký tự in được `preventDefault` để không kích hoạt button; buffer reset nếu ngắt > 600ms — phân biệt máy quét gõ nhanh với người gõ tay).
- **Luồng XÁC NHẬN 2 LẦN QUÉT** (chống chọn nhầm — mọi đường ghi nhận lỗi qua quét đều cần 2 mã GIỐNG NHAU liên tiếp hoặc Enter xác nhận):
  - Trong `FulfillmentScanActionDialog` (công nhân có stage): quét `OK` (hoặc Enter tay) → hoàn thành như cũ (`start`+`complete`). Quét `E-<code>` lần 1 → **validate mã thuộc danh mục CÔNG ĐOẠN CỦA USER** (`myStageErrors`, sai → beep + "không thuộc công đoạn X") → **KHÔNG submit**, gọi `onScanError(code)` → page chuyển sang `OrderErrorScanDialog` với `initialCode` chọn sẵn. Quét `N-…` → thay đơn.
  - Trong `OrderErrorScanDialog`: lỗi đang chọn (`code`) + quét `E-` → **cùng mã → ghi nhận** (`submitError`); **khác mã (hợp lệ trong danh mục công đoạn ngữ cảnh) → đổi lựa chọn** + beep 1 tiếng + toast nhắc; mã ngoài danh mục → từ chối. **Enter tay** (buffer rỗng, không đứng trên button) → ghi nhận lỗi đang chọn. Giữa 2 lần quét user có "1 nhịp" gõ mô tả lỗi vào textarea.
  - **Burst-detector textarea note**: máy quét gõ mã vào note khi con trỏ đang trong ô mô tả → chuỗi ≥4 ký tự toàn gap <100ms kết thúc Enter + parse ra tiền tố hợp lệ → tự cắt khỏi note + xử lý như mã quét (Enter gõ tay thường = xuống dòng bình thường).
- `OrderErrorScanDialog` (admin/support hoặc chế độ Báo lỗi): **form chỉ hiển thị danh mục lỗi của công đoạn ngữ cảnh** (stage của user, fallback stage hiện tại của đơn); chưa có lỗi → link sang `/ffm/orders/stage-errors`. Chọn lỗi → nguồn + đích đẩy về **tự suy từ config, read-only** (box amber kèm hướng dẫn xác nhận; đích không hợp lệ → box đỏ + disable submit). `OK` bị từ chối (chỉ dành cho công nhân stage); Cmd/Ctrl+Enter submit tay giữ nguyên.
- Mọi kết quả có **beep WebAudio** (không cần file asset): `beepScan` 1 tone = bắt đơn, `beepSuccess` 2 tone lên = xong, `beepError` buzz trầm = thất bại/mã sai.

### 2.3 Resolve đích đẩy về (`resolveErrorScan` — `utils/scanCodes.ts`)

```
reworkTarget của config (stage error) ưu tiên; lỗi chung fallback errorSource:
  'tool-check' → target tool-check (support-hold, luôn hợp lệ)
  'designer'   → target designer (cần đơn đã vào fulfillment)
  stage        → cần đứng TRƯỚC furthest (currentStage ?? Pack nếu đã hoàn thành), sai → beep + toast, KHÔNG submit
  'factory'/không có → chỉ mark lỗi (không đẩy về)
```

## 3. API / Schema

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| `GET` | `/v1/workshop-config/stage-errors?stage=` | mọi user đăng nhập | List lỗi 1 công đoạn (gồm cả `isActive=false` để toggle) |
| `POST` | `/v1/workshop-config/stage-errors` | SuperAdmin/Admin/Manager/Fulfillment | Tạo lỗi. Fulfillment bị **ép `stage = user.fulfillmentStage`** (bỏ qua dto.stage); role khác bắt buộc truyền `stage`. Code tự sinh `se-<stage>-<n>` (đếm cả soft-deleted, retry 1 lần nếu race). Chặn trùng tên (case-insensitive) trong cùng stage. |
| `PATCH` | `/v1/workshop-config/stage-errors/:id` | như POST | **CHỈ nhận `{ isActive }`** (ẩn/hiện) — BE không cho sửa name/reworkTarget nữa. Fulfillment chỉ thao tác lỗi công đoạn mình. Chỉ row có `stage` mới thao tác được qua endpoint này. |

Row nằm trong collection `workshopConfigs` **category `production_error`** → tái dùng nguyên: validate code ở `setProductionError` (order.service.ts), resolve tên lỗi ở mọi dashboard/bảng đơn, thống kê Nhật ký bù lỗi.

```ts
// packages/shared/dtos/workshop-config.dto.ts
WorkshopConfigZod += {
  stage?: FulfillmentStage;               // công đoạn SỞ HỮU lỗi (rỗng = lỗi chung cũ)
  reworkTarget?: 'tool-check' | 'designer' | FulfillmentStage; // đích đẩy về khi quét
}
// StageErrorReworkTargetZod + Get/Create/UpdateStageError DTOs
// errorSource được BE TỰ SUY từ reworkTarget: tool-check→tool-check, designer→designer, stage→factory
```

Format mã quét (`utils/scanCodes.ts`): đơn `N-…` (có sẵn) · hoàn thành `OK` (1 mã chung — hệ thống biết công đoạn qua profile; user không có stage quét OK bị từ chối) · lỗi `E-<code>` (case-insensitive khi parse).

## 4. UI Components

- **`pages/orders/stage-errors/index.tsx`**: header + nút In tem lỗi; chọn stage (khóa với công nhân); form thêm (Input tên + `TargetChip` + nút "Thêm & tạo Barcode"); list row = barcode cao 40px + tên + code mono + badge "Đẩy về X" + ẩn-hiện; khối in tem `#stage-error-label-print` (portal ra body, 60×40mm/tem, tem OK đầu).
- **`pages/orders/scan-error/ScanGuide.tsx`**: `GuideStep` (số bước + icon + title `text-lg` + desc `text-base`, 4 tone màu) + `GuideZone` (khung VÙNG viền đậm 2px + tiêu đề UPPERCASE + slot `action` góc phải) — hướng dẫn quét CHỮ TO **chia vùng** trong CẢ 2 modal: `FulfillmentScanActionDialog` task-của-mình = vùng "✔ Hoàn thành" (quét OK) + vùng "⚠ Báo lỗi — quét 2 lần" (2 bước + **link "Thêm lỗi ở đây"** → `/ffm/orders/stage-errors`); đơn-xa = vùng "Báo lỗi đơn này" (+link) + vùng "Quét tiếp". `OrderErrorScanDialog` = 1 vùng "Cách báo lỗi — quét 2 lần" (3 bước + link thêm lỗi) đầu cột phải.
- **Sidebar**: entry "Danh mục lỗi công đoạn" (icon `Barcode`) trong group Quản lý đơn, perm `page.stage_errors`.
- Sau mỗi mutation: refetch list + `useWorkshopConfigStore.load(true)` để luồng quét resolve được mã mới ngay.

## 5. Backend logic

`workshop-config.service.ts`:
- `resolveOwnerStage()` — Fulfillment ép stage từ profile (thiếu → 403); role khác cần dto.stage.
- `assertValidReworkTarget()` — target stage phải `FULFILLMENT_STAGE_ORDER[target] < ORDER[ownerStage]`.
- `deriveErrorSource()` — suy errorSource từ reworkTarget (giữ nguyên hook chain `setProductionError` cũ, KHÔNG sửa order.service).
- `listStageErrors` / `createStageError` / `updateStageError` (chi tiết ở §3).

Luồng quét KHÔNG thêm endpoint order nào — tái dùng `POST /orders/:id/set-production-error` (với `target`) + `POST /orders/:id/fulfillment-transition` (start/complete).

## 6. Performance notes

- Barcode render client-side (SVG Code128, `react-barcode`/JsBarcode) — 0 request; danh mục ~vài chục row/stage, 1 query indexed `{category, stage}`.
- Quét lỗi = đúng 1 request `setProductionError` (trước đây: mở dialog + 3-4 click + submit).

## 7. Permissions

| Role | Trang danh mục | Thêm/sửa lỗi | Quét OK | Quét lỗi |
|---|:---:|:---:|:---:|:---:|
| Fulfillment (có stage) | ✅ (stage mình) | ✅ (stage mình) | ✅ | ✅ |
| Admin / SuperAdmin / Manager | ✅ (6 stage) | ✅ | ❌ (không có stage) | ✅ |
| Support / Designer | ❌ | ❌ | ❌ | — |

## 8. Edge cases

| Case | Hành vi |
|---|---|
| Quét `OK`/`E-` khi chưa quét đơn | Beep lỗi + toast "Hãy quét mã ĐƠN trước". |
| Quét `E-` mã không tồn tại / đã ẩn / KHÔNG thuộc công đoạn của người quét | Beep lỗi + toast "không thuộc công đoạn X — kiểm tra bảng mã lỗi của trạm". Store chỉ chứa lỗi active. |
| Quét `E-` lần 1 rồi quét mã khác | Đổi lựa chọn sang lỗi mới (reset nhịp xác nhận) — chọn nhầm sửa được. |
| Quét `E-` lần 2 CÙNG mã / Enter tay | Ghi nhận lỗi + đẩy về (chỉ lúc này mới gọi API). |
| Máy quét gõ mã vào textarea note đang focus | Burst-detector cắt chuỗi khỏi note + xử lý như mã quét. |
| Quét lỗi `other` | Từ chối (bắt buộc note → không hands-free). |
| Quét lỗi có target ≥ vị trí đơn (nhầm bảng trạm khác) | Beep lỗi + toast "Không đẩy về X được — đơn đang ở Y", không submit. |
| Đơn đã hủy / đang giữ (hold) | BE `setProductionError` reject → beep lỗi + message. |
| Quét `N-` đơn mới khi dialog đang mở | Thay đơn đang chờ, tra cứu luôn. |
| Người gõ tay trong dialog | Buffer reset sau 600ms ngắt → Enter tay (buffer rỗng) giữ hành vi cũ (Hoàn thành / Đóng). Focus trong input/textarea → không bắt. |
| 2 công đoạn thêm lỗi trùng tên | Cho phép (khác stage); trùng tên TRONG 1 stage → 400. |
| AudioContext bị chặn (chưa có user gesture) | Beep bỏ qua im lặng — đã có toast. |

## 9. Lịch sử thay đổi

- **2026-07-21** — Initial: entity + DTOs (`stage`/`reworkTarget`), 3 endpoint stage-errors, trang `/ffm/orders/stage-errors` + in QR, luồng quét 2 bước (OK / E- / N- trong dialog), beep WebAudio, perm `page.stage_errors` (preset Fulfillment).
- **2026-07-21 (update)** — `OrderErrorScanDialog` viết lại: mã lỗi chỉ theo danh mục công đoạn ngữ cảnh + link thêm lỗi khi rỗng; nguồn/đích read-only theo config (bỏ chọn tay); bỏ lỗi `other` khỏi luồng quét; note luôn optional.
- **2026-07-21 (update 2)** — Luồng **xác nhận 2 lần quét**: quét lỗi lần 1 = chọn (validate thuộc công đoạn người quét, handoff `onScanError` → `initialCode`), lần 2 cùng mã / Enter = ghi nhận, mã khác = đổi lựa chọn; dừng 1 nhịp nhập mô tả giữa 2 lần; burst-detector cho textarea note; `FulfillmentScanActionDialog` bỏ submit lỗi trực tiếp (bỏ prop `onErrorSaved`, thêm `onScanError`).
- **2026-09-22** — **Nút In: sheet A4 → tem decal 60×40mm mỗi lỗi 1 tem** (in thẳng máy in tem ở trạm, cùng khổ tem nhỏ dán sản phẩm): khối in portal `#stage-error-label-print` mirror cơ chế `BarcodeLabelPrint` (`@page 60mm 40mm` + `break-after: page`, display:none thay visibility-trick để không lòi tem trắng); xóa 2 key i18n `printSheetTitle`/`printSheetDesc`. Nút "Xuất PDF" A8 giữ nguyên.
- **2026-07-25** — **QR → Barcode Code128** (nhiều máy quét ở xưởng chỉ đọc 1D): render bằng `react-barcode` (đã có sẵn dep, thay `qrcode.react` — dep cũ vẫn còn trong package.json nhưng không còn chỗ dùng); payload `E-<code>`/`OK` **không đổi** nên `parseScanCode`, luồng quét 2 bước và BE giữ nguyên 100%. Sheet in đổi grid 3→2 cột, id `#stage-qr-sheet`→`#stage-barcode-sheet`; PDF `qr-loi-*`→`barcode-loi-*`, nhãn A8 vẽ barcode kéo giãn thay QR vuông; rename `errorQrPayload`→`errorScanPayload` (`utils/scanCodes.ts`); icon `QrCode`→`Barcode` (Sidebar + 2 dialog quét + header trang danh mục); text UI "QR lỗi"→"mã lỗi".
