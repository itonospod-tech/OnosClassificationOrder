# Inventory (Tồn kho theo xưởng) — Function Description

> **File FE:** `apps/web/src/pages/inventory/` (`index.tsx` + `ReceiptInDialog.tsx` + `AdjustDialog.tsx` + `ReconcileDialog.tsx`), `apps/web/src/pages/orders/scan-error/useScanStockOut.tsx`, `apps/web/src/services/inventory.ts`
> **File BE:** `apps/api/src/modules/inventory/` (entities + `inventory.logic.ts` + `inventory.service.ts` + `inventory.controller.ts`)
> **Route:** `/ffm/inventory` (+ trạm quét `/ffm/orders/scan-error` mã `ACT-STOCK-OUT`)
> **API:** `/v1/inventory/*`
> **Plan gốc:** `documents/Plans/Inventory-FactoryStock.md`

## 1. Overview

Quản lý tồn kho vật tư/phôi **theo từng xưởng** (làm cho DTF Mê Linh trước, mọi xưởng dùng được):

- **Nhập kho** bằng phiếu nhập tay nhiều dòng (`NK-<xưởng>-<ngày VN>-<seq>`).
- **Xuất kho** bằng quét tem đơn tại trạm quét: quét tem nhỏ `N-<productionId>` mở popup → quét `ACT-STOCK-OUT` hiện SKU + số trừ → quét `OK` chốt. SKU suy TỰ ĐỘNG từ đơn.
- **Toggle theo xưởng `FactoryEntity.autoStockOut`** (mặc định TẮT): bật → tự trừ sau khi in label giao hàng tại trạm quét, không cần quét xác nhận.
- **Đối soát ngày** (Admin): trừ bù các đơn In-xong trong ngày chưa trừ, có preview.
- **Kiểm kê** (Admin): nhập số đếm thực tế, hệ tự tính chênh lệch.
- **Thống kê**: sổ cái mọi giao dịch, dòng xuất trỏ về `productionId`.

Kiến trúc xương sống: **sổ cái append-only** mirror nguyên khuôn ví seller (`customer-wallet`): mỗi biến động 1 record `balanceBefore → balanceAfter`, idempotency bằng unique index tầng DB, cache tồn trên item. Tồn **được phép ÂM** (hàng về trước giấy tờ sau) — cảnh báo đỏ, không chặn chuyền sản xuất.

## 2. Luồng hoạt động

### 2.1 Suy SKU kho từ đơn (`resolveInventorySku` — `inventory.logic.ts`)

1. `ProductConfig.variations[].sku` có SKU norm-kết-thúc bằng `size` của đơn → dùng **nguyên variation SKU** (`CAMOSHIRT-XL`) — KHÁC tem barcode (tem gọt đuôi size, kho phải giữ vì phôi phân biệt theo size). `resolvedBy='variation'`.
2. Không khớp size → `resolveBarcodeSkuBase() + '-' + size` — `resolvedBy='base-size'`.
3. Không có config/variations → `type + '-' + size` — `resolvedBy='fallback'` (thủ kho nên soát).
4. Quét gặp SKU chưa có trong kho → **tự tạo item** `autoCreated=true` (badge vàng ở trang kho, tồn đi từ 0 xuống âm), không chặn.

### 2.2 Ba đường trừ kho — chung 1 hàm, không bao giờ trừ đúp

Cả 3 đường đều gọi `InventoryService.scanOut()` → `applyTransaction()` với
`refs.requestId = <productionId>#<attempt>` (unique index `(itemId, kind, refs.requestId)`):

| Đường | Kích hoạt | `refs.source` |
|---|---|---|
| Quét tay | `ACT-STOCK-OUT` + `OK` tại popup trạm quét (cả 2 dialog) | `scan` |
| Tự động | Xưởng bật `autoStockOut` → `useScanPrint.onLabelPrinted` sau khi hộp thoại in label đóng | `auto-label` |
| Đối soát | Nút "Đối soát ngày" (Admin) — preview đơn In-xong-trong-ngày chưa trừ → apply | `reconcile` |

- `reason='normal'` mà đơn ĐÃ trừ → trả lượt cũ `duplicated:true`, không trừ thêm (đường auto/đối soát gọi lặp vô hại).
- `reason='rework'` → attempt +1, `refs.rework=true` — trừ CHỦ ĐÍCH lần 2+ cho đơn làm lại (hao hụt rework tự có trong thống kê). Ở trạm quét: đơn đã trừ thì khối xác nhận cảnh báo đỏ, chốt lần nữa = rework.
- Đường auto KHÔNG bao giờ tự trừ rework (`deductedTimes > 0` → bỏ qua), lỗi im lặng — đối soát ngày bắt sót.

### 2.3 Phiếu

- Phiếu NHẬP: tạo cùng lúc với N txn `in`, mỗi dòng requestId `<receiptId>#<idx>` (POST retry không cộng đúp).
- Phiếu XUẤT: **lười** — nút "Chốt phiếu xuất hôm nay" (Admin) gom mọi txn `out` chưa có `refs.receiptId` trong ngày VN thành 1 phiếu `XK-...` rồi gắn ngược `receiptId`. Chốt lại lần 2 → null.
- Kiểm kê (`adjust`): nhập số ĐẾM THỰC TẾ, delta tính TRONG transaction (`setTo`); đếm đúng số hệ thống → không ghi sổ.

## 3. API / Schema

### 3.1 Collections

```ts
// inventory_items — unique (factoryId, sku); quantity = CACHE, có thể âm
{ factoryId, sku /*UPPERCASE*/, name, unit, quantity, autoCreated, status }

// inventory_transactions — APPEND-ONLY; unique partial (itemId, kind, refs.requestId)
{ factoryId, itemId, sku /*snapshot*/, kind: 'in'|'out'|'adjust', qty /*signed*/,
  balanceBefore, balanceAfter, note, byUserId, byUserName,
  refs?: { requestId, productionId, orderId, receiptId, source: 'scan'|'auto-label'|'reconcile'|'manual', rework } }

// inventory_receipts — bìa kẹp; code unique `NK-MLDTF-210926-01` / `XK-...`
{ code, type: 'in'|'out', factoryId, lines: [{sku, name, qty, note}], byUserId, byUserName, note }
```

DTO Zod: `packages/shared/dtos/inventory.dto.ts`. `FactoryZod.autoStockOut` ở `factory.dto.ts`.

### 3.2 Endpoints (`inventory.controller.ts`)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/inventory/items` | `@Auth([])` | Tồn kho 1 xưởng (search / negativeOnly / phân trang) |
| PATCH | `/inventory/items/:id` | `@Auth([])` | Sửa name/unit/status + gỡ cờ autoCreated |
| POST | `/inventory/receipts/in` | `@Auth([])` | Phiếu nhập nhiều dòng |
| GET | `/inventory/receipts` + `/:id` | `@Auth([])` | List / chi tiết phiếu |
| POST | `/inventory/receipts/close-out` | Admin | Chốt phiếu xuất ngày (gom txn out chưa có phiếu) |
| POST | `/inventory/adjust` | Admin | Kiểm kê chốt tồn về số đếm |
| GET | `/inventory/scan-out/preview/:productionId` | `@Auth([])` | SKU + qty + tồn + `deductedTimes` + cờ `autoStockOut` |
| POST | `/inventory/scan-out` | `@Auth([])` | Trừ theo đơn `{productionId, reason: normal\|rework, source, skuOverride?}` |
| GET | `/inventory/transactions` | `@Auth([])` | Sổ cái (filter kind/sku/productionId/from/to) |
| GET | `/inventory/reconcile/preview` | Admin | Đơn In-xong trong ngày (VN) chưa trừ, loại đơn hủy |
| POST | `/inventory/reconcile/apply` | Admin | Trừ bù cả loạt — idempotent |

`@Auth([])` vì trạm quét chạy bằng tài khoản công nhân Fulfillment. Module chỉ bind model Order/ProductConfig/Factory (không import module — khuôn `CustomerWalletModule`).

## 4. UI Components

- **`pages/inventory/index.tsx`** (`/ffm/inventory`, theo `useFactoryScope` — chưa chọn xưởng thì nhắc chọn ở header): 3 tab **Tồn kho** (bảng items, tồn âm chữ đỏ, badge "Tự tạo từ quét", click row mở dialog sửa) · **Giao dịch** (sổ cái, filter loại/SKU/mã đơn, badge Làm lại + nguồn) · **Phiếu** (click mở chi tiết dòng). Nút hàng đầu: Nhập kho (mọi người) + Kiểm kê / Đối soát ngày / Chốt phiếu xuất (Admin — `usePermission().isAdmin`).
- **`ReceiptInDialog`** — form nhiều dòng SKU/tên/SL/ghi chú.
- **`AdjustDialog`** — số đếm thực tế, hiện "Hệ thống: N" cạnh ô nhập.
- **`ReconcileDialog`** — chọn ngày → bảng preview (đơn không suy được SKU badge đỏ) → "Trừ tất cả".
- **Trạm quét** (`useScanStockOut.tsx` dùng chung 2 dialog): khối xác nhận vàng inline hiện SKU/số trừ/tồn/số lần đã trừ; nút "Trừ kho" cạnh nút in; wiring: `ACT-STOCK-OUT` mở/chốt, `OK`/Enter chốt (ưu tiên trước hoàn-thành-công-đoạn khi khối đang mở), `ACT-CANCEL` chỉ đóng khối. Sheet A4 (`ActionCodeSheetPrint`) tự có mã mới qua `ACTION_SHEET_CODES` — **in lại sheet dán trạm**.
- **`FactoryTab.tsx`**: switch "Tự trừ tồn kho sau in label" + badge "Tự trừ kho" trên bảng xưởng.
- i18n: namespace `inventory` (trang kho) + khối `stockOut.*`/`actionSheet.codes.stockOut` trong `scanError`.

## 5. Backend logic

- **`applyTransaction()`** (`inventory.service.ts`) — MỌI biến động: transaction Mongo `[upsert item → pre-check requestId → insert txn before/after → $set quantity]`; race E11000 → trả record thắng cuộc `duplicated:true`. Mirror `CustomerWalletService.applyTransaction()`.
- **Hàm thuần** `inventory.logic.ts` (+ `inventory.logic.spec.ts` 13 tests): `resolveInventorySku`, `buildScanOutRequestId`, `buildReceiptCode` (ngày giờ VN, cùng luật `ngayVN` packing), `vnDayRange`, `buildReconcileOrderFilter` (loại `cancelledAt`, mốc `fulfillmentStages.print.completedAt`).
- Số phiếu: đếm phiếu trong ngày + retry khi đụng unique code (2 người tạo cùng lúc).
- **Agent API**: 3 collection mô tả ở `registry/inventory.registry.ts` (byUserName gắn kỷ luật "KHÔNG nói cho khách"); schemas thêm vào `registry-schema.spec.ts` + `registry.spec.ts` (giờ 14 bảng có mô tả).
- KHÔNG có `@Cron` (né bẫy 2 Nest context — Common_Pitfalls.md §11); đối soát là nút bấm tay.

## 6. Performance notes

- List/preview đều giới hạn (`items` max 200/trang, reconcile scan orders limit 2000, chỉ `select` field cần).
- Sổ cái index `(factoryId, createdAt)` + partial index `refs.productionId` cho câu "đơn này trừ chưa".
- E2E sống 19/19 PASS trên DB local (nhập 10 → trừ → trùng bị chặn → rework → kiểm kê 20 → đối soát → toggle autoStockOut → chốt phiếu XK). Lưu ý dev: sửa `packages/shared` phải build lại (`pnpm --filter shared build`) không thì ZodValidationPipe gọt field mới khỏi request.

## 7. Permissions

- Quyền trang mới **`page.inventory`** (`permission-catalog.ts`) — preset **Fulfillment** có sẵn; Manager/Admin/SuperAdmin tự có. Entry sidebar nhóm "Công việc" (icon Boxes).
- Endpoint ghi nhạy cảm (kiểm kê / đối soát / chốt phiếu xuất) khóa `@Auth([RoleType.Admin])`; nút tương ứng trên FE ẩn với non-admin.
- `FactoryEntity.autoStockOut` sửa qua dialog xưởng (trang Products — quyền như các cờ xưởng khác).
