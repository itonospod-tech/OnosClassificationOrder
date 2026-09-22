# Plan: Quản lý tồn kho theo xưởng (Inventory) — nhập tay · quét trừ · đối soát

> Chốt với user 21/09/2026. Làm cho DTF Mê Linh trước nhưng thiết kế đa xưởng ngay từ đầu
> (mọi record khóa `factoryId`, dùng `FactoryScopeSwitch` sẵn có).
> Nguyên tắc xương sống: **sổ cái append-only** mượn nguyên khuôn ví seller
> (`customer-wallet`): mỗi biến động 1 record `balanceBefore → balanceAfter`,
> idempotency bằng unique index tầng DB, cache số tồn trên item.

## 0. Quyết định thiết kế đã chốt

| # | Quyết định | Lý do |
|---|-----------|-------|
| 1 | Tồn kho = sổ cái giao dịch, KHÔNG phải 1 con số sửa tay | Truy được từng biến động về đơn nào/ai/lúc nào; mirror `customer_wallet_transactions` |
| 2 | Xuất kho mặc định = quét XÁC NHẬN từng đơn tại trạm quét (`ACT-STOCK-OUT` + `OK`) | Thủ kho giữ chốt kiểm soát; hai tay không rời máy quét (khớp ScanError.md §10b) |
| 3 | Toggle theo xưởng `autoStockOut` — tự trừ sau khi in label giao hàng, mặc định TẮT | User yêu cầu tường minh; làm y khuôn `skipToolCheck`/`autoCompletePack` |
| 4 | KHÔNG có mã quét "trừ cả ngày" — thay bằng nút **Đối soát ngày** có preview | Trừ gộp mù mất kiểm soát; đối soát idempotent thì an toàn (đơn trừ rồi tự bị bỏ qua) |
| 5 | Cho phép tồn ÂM + cảnh báo đỏ, không chặn | Hàng về trước giấy tờ sau — không được chặn chuyền sản xuất |
| 6 | Đơn rework được trừ LẦN 2 với lý do tường minh (`requestId` khác) | Hao hụt rework tự có trong thống kê |
| 7 | Mọi đường trừ (quét tay / auto sau label / đối soát) đi qua ĐÚNG 1 hàm service | Trộn chế độ không bao giờ trừ trùng |
| 8 | Phiếu nhập/xuất = "bìa kẹp" gom transaction + số phiếu, KHÔNG workflow duyệt | Đủ cho đối soát kế toán; phase sau mới thêm lô/hạn/giá vốn nếu cần |

## 1. Mã kho (SKU) suy từ đơn thế nào

Hàm thuần `resolveInventorySku(order, productConfig)` (đặt cạnh `resolveBarcodeSkuBase`
ở `apps/api/src/modules/order/barcode-label.ts` hoặc file mới `inventory.logic.ts`):

1. Có `variations[].sku` mà norm kết thúc bằng `size` của đơn → dùng **nguyên variation SKU**
   (vd `CAMOSHIRT-XL`) — phôi áo phân biệt theo size nên phải giữ đuôi size, KHÁC tem
   (tem gọt đuôi).
2. Không khớp → `resolveBarcodeSkuBase(skus) + '-' + size` (nếu có size).
3. Không có config/variation → fallback `type` + size, đánh dấu `resolvedBy: 'fallback'`.

Quét gặp SKU chưa có trong kho → **tự tạo item** (`autoCreated: true`, tồn đi từ 0 → âm)
kèm cảnh báo, để thủ kho rà lại đặt tên/đơn vị sau. Không chặn chuyền.

## 2. Schema — 3 collection mới (`apps/api/src/modules/inventory/`)

### `inventory_items` — danh mục + cache tồn
```
factoryId   string  required, index          — kho của xưởng nào
sku         string  required                 — unique cùng factoryId (compound unique index)
name        string                           — tên hiển thị (mặc định = sku, thủ kho sửa)
unit        string  default 'cái'
quantity    number  required default 0       — CACHE, mọi thay đổi qua applyTransaction()
autoCreated boolean default false            — sinh tự động lúc quét, cần rà
status      'active'|'inactive'
```

### `inventory_transactions` — sổ cái APPEND-ONLY (mirror customer_wallet_transactions)
```
factoryId     string  required, index
itemId        string  required, ref inventory_items
sku           string  required               — snapshot, sổ cái không join lại
kind          'in' | 'out' | 'adjust'
qty           number  required               — dương = cộng tồn, âm = trừ tồn
balanceBefore number  required
balanceAfter  number  required
note          string?
byUserId / byUserName                        — snapshot người thao tác
refs: {
  requestId?     string    — idempotency key (unique index bên dưới)
  productionId?  string    — đơn nào (kind='out')
  orderId?       string    — OrderEntity._id
  receiptId?     string    — thuộc phiếu nào
  source?        'scan' | 'auto-label' | 'reconcile' | 'manual' | 'rework'
}
```
Index:
- `{ factoryId: 1, createdAt: -1 }`
- `{ itemId: 1, kind: 1, 'refs.requestId': 1 }` **unique partial** (`refs.requestId $exists`)
  — chặn trừ đúp tầng DB, y hệt ví.
- `refs.requestId` cho lượt xuất theo đơn = `` `${productionId}#1` `` (lần đầu),
  `` `#2`, `#3`… `` cho rework — đếm attempt từ số transaction `out` hiện có của productionId.

### `inventory_receipts` — phiếu nhập/xuất
```
code       string  unique  — `NK-<factoryShortName>-<yymmdd>-<seq>` / `XK-...`
                             (tái dùng khuôn đánh số `BG-` của packing.logic.ts)
type       'in' | 'out'
factoryId  string required
lines      [{ sku, name, qty, note? }]   — snapshot để in phiếu
byUserId / byUserName
note       string?
```
Phiếu xuất KHÔNG tạo trước: các transaction `out` do quét trong ngày/phiên được gom
lười (lazy) — phase 1 chỉ cần phiếu NHẬP là bắt buộc; phiếu XUẤT sinh từ nút
"Chốt phiếu xuất hôm nay" (gom mọi txn out chưa có receiptId của xưởng + ngày).

## 3. Service — 1 hàm biến động duy nhất

`InventoryService.applyTransaction(input)` — mirror `CustomerWalletService.applyTransaction()`:
Mongo transaction (replica set sẵn có): đọc item (tạo nếu chưa có) → ghi txn record với
`balanceBefore/After` → `$inc` cache `quantity` — CÙNG session. Bắt E11000 trên
`refs.requestId` → trả về txn đã tồn tại với cờ `duplicated: true` (không ném lỗi,
để đường auto/đối soát gọi lặp vô hại).

Các hàm nghiệp vụ (đều delegate applyTransaction):
- `createReceiptIn(dto)` — 1 phiếu nhập N dòng → N txn `in` + 1 receipt.
- `adjust(dto)` — kiểm kê: nhập số ĐẾM THỰC TẾ, service tự tính delta → txn `adjust`.
- `scanOutPreview(productionId)` — resolve SKU + qty + tồn hiện tại + số lần đã trừ
  + cờ `autoStockOut` của xưởng (FE cần biết để hiện đúng nhãn).
- `scanOut({ productionId, reason: 'normal'|'rework', source, skuOverride? })` —
  lookup order → resolve SKU (hoặc dùng override thủ kho chọn) → requestId theo attempt
  → applyTransaction `out` với `qty = -order.quantity`.
- `reconcilePreview({ factoryId, date })` — đơn của xưởng có `fulfillmentStages.print.completedAt`
  trong ngày (giờ VN, dùng khuôn bucket sẵn có), KHÔNG `cancelledAt`, chưa có txn `out`
  (`refs.productionId` not in) → danh sách {productionId, sku, qty}.
- `reconcileApply({ factoryId, date })` — chạy scanOut(source:'reconcile') từng đơn;
  idempotency lo phần còn lại. Trả {applied, skipped}.
- `listItems / updateItem / listTransactions / listReceipts / closeOutReceipt`.

## 4. Endpoints (`inventory.controller.ts`)

| Method + path | Auth | Ghi chú |
|---|---|---|
| `GET /inventory/items` | `@Auth([])` + perm page | filter factoryId/search/negativeOnly |
| `PATCH /inventory/items/:id` | Admin/SuperAdmin/Fulfillment | sửa name/unit/status |
| `POST /inventory/receipts/in` | như trên | phiếu nhập nhiều dòng |
| `GET /inventory/receipts` + `/:id` | `@Auth([])` | |
| `POST /inventory/adjust` | Admin/SuperAdmin | kiểm kê điều chỉnh |
| `GET /inventory/scan-out/preview/:productionId` | `@Auth([])` | trạm quét gọi |
| `POST /inventory/scan-out` | `@Auth([])` | body {productionId, reason, source, skuOverride?} |
| `GET /inventory/transactions` | `@Auth([])` | filter kind/sku/date/productionId — trang thống kê |
| `GET /inventory/reconcile/preview` | Admin/SuperAdmin | ?factoryId&date |
| `POST /inventory/reconcile/apply` | Admin/SuperAdmin | |

Role chi tiết chốt lúc code theo khuôn `@Auth(roles, [PermissionCode.xxx])` hiện hành;
worker Fulfillment phải gọi được scan-out (trạm quét dùng tài khoản công nhân).

## 5. Cờ xưởng `autoStockOut` + đường tự động

- `FactoryEntity.autoStockOut: boolean` default false + Zod ở `factory.dto.ts`.
- Cache: thêm vào `apps/api/src/utils/merged-flow-factory.ts` (cùng load 1 query,
  getter `getFactoryAutoStockOutSync`) — nhưng lưu ý cờ này chủ yếu do **FE** dùng
  (quyết định có gọi scan-out sau in label không) → trả qua
  `scanOutPreview.autoStockOut` là đủ, KHÔNG cần nhét vào `factories/options`.
- FE `useScanPrint.tsx`: sau khi `printLabel` dựng `ShippingLabelPrint` (lệnh in đã gửi),
  trong `onDone` nếu `autoStockOut` bật → gọi `POST /inventory/scan-out`
  (`source:'auto-label'`, silent toast). In lại lần 2 vô hại nhờ idempotency.
  Ghi chú thẳng trong code: "đóng hộp thoại in ≠ chắc chắn in thành công — chấp nhận,
  vì có đối soát ngày bắt sót và quét tay trừ bù/ghi chú được".
- Switch trong dialog sửa xưởng `FactoryTab.tsx`, cạnh switch `skipToolCheck`.

## 6. Trạm quét — mã `ACT-STOCK-OUT`

`apps/web/src/utils/scanCodes.ts`:
- `ScanActionCommand` thêm `'stock-out'`; `ACTION_COMMAND_BY_CODE['STOCK-OUT']`.
- `ACTION_SHEET_CODES` thêm `{ payload: 'ACT-STOCK-OUT', labelKey: 'stockOut' }`
  → sheet A4 dán trạm tự có mã mới (in lại sheet).

2 dialog quét (`FulfillmentScanActionDialog.tsx` + `OrderErrorScanDialog.tsx`):
- Nhận command `stock-out` → gọi preview → hiện khối xác nhận: SKU · số lượng trừ ·
  tồn hiện tại (đỏ nếu sẽ âm) · số lần đã trừ.
- Quét `OK` (hoặc bấm nút) → `scanOut(reason:'normal')` → `beepSuccess`.
- Đơn ĐÃ trừ rồi → hiện "đã trừ lần N lúc ...; quét ACT-STOCK-OUT lần nữa để trừ
  RE WORK" → quét lặp = `scanOut(reason:'rework')`.
- Thêm nút bấm thường "Trừ kho" cạnh nút In label (cho người không dùng bảng mã).

## 7. FE trang kho — `apps/web/src/pages/inventory/`

Route `/ffm/inventory` (PATHS.INVENTORY), theo `useFactoryScope` (`?factoryId=` trên URL),
entry Sidebar cụm sản xuất, quyền mới `page.inventory` (preset: Fulfillment + Manager;
Admin/SuperAdmin tự có).

- `index.tsx` — 3 tab:
  - **Tồn kho**: bảng items (search, cột tồn — âm = badge đỏ, badge `autoCreated`),
    nút "Nhập kho" + "Kiểm kê" + "Đối soát ngày".
  - **Giao dịch**: bảng transactions (filter kind/SKU/khoảng ngày/productionId;
    dòng `out` bấm productionId → mở `OrderDetailDialog` sẵn có).
  - **Phiếu**: list receipts + xem chi tiết (in A5 để sau, phase 1 chỉ xem).
- `ReceiptInDialog.tsx` — form nhập nhiều dòng (chọn SKU sẵn có hoặc gõ SKU mới).
- `AdjustDialog.tsx` — nhập số đếm thực tế từng SKU.
- `ReconcileDialog.tsx` — chọn ngày → preview bảng đơn chưa trừ → "Trừ tất cả".
- Service `apps/web/src/services/inventory.ts` + đăng ký `services/index.ts`.
- i18n namespace `inventory` (vi + en) — theo I18n.md, không hardcode string;
  thêm key `actionSheet.codes.stockOut.*` vào `scanError.json`.

## 8. Shared DTOs — `packages/shared/dtos/inventory.dto.ts`

Zod + `createZodDto` đủ bộ: `InventoryItemZod`, `InventoryTxnZod` (kind enum),
`InventoryReceiptZod`, `CreateReceiptInDto`, `AdjustInventoryDto`, `ScanOutDto`/
`ScanOutPreviewResDto` (kèm `autoStockOut`, `deductedTimes`), `ReconcilePreviewResDto`,
list query DTOs. Export ở `dtos/index`.

## 9. Việc bắt buộc kèm theo (không quên — test/registry sẽ bắt)

1. **Agent API registry**: mô tả 3 collection mới trong `apps/api/src/modules/agent-api/registry/`
   — `registry-schema.spec.ts` fail nếu thiếu field nào.
2. **Doc**: tạo `documents/FunctionDescription/Inventory.md` (skill `write-feature-doc`)
   + thêm dòng mapping vào `CLAUDE.md` + cập nhật `ScanError.md` §10b (mã ACT mới)
   + `Products.md`/`FulfillmentWorkflow.md` note cờ `autoStockOut` trên Factory.
3. **Không dùng `@Cron` mới** phase 1 (đối soát là nút bấm tay) — né bẫy
   Common_Pitfalls.md §11 (2 Nest context). Nếu sau này thêm cron cuối ngày:
   nhớ `laTienTrinhChayCron` dòng đầu.
4. **Tests** (Jest, `apps/api`):
   - `inventory.logic.spec.ts` — resolveInventorySku các ca (khớp size / fallback base+size / fallback type).
   - `inventory-idempotency.spec.ts` — applyTransaction: E11000 → duplicated:true, không đổi tồn.
   - `reconcile-filter.spec.ts` — hàm thuần build filter đối soát (loại cancelled, loại đã trừ).
5. **Verify**: `pnpm build-types` + `pnpm lint` + `cd apps/api && pnpm test` + E2E script
   scratchpad (nhập 10 → quét trừ 1 → trừ lặp bị chặn → rework trừ lần 2 → đối soát skip).

## 10. Trình tự implement (mỗi bước build-types xanh rồi mới sang bước sau)

1. Shared: `inventory.dto.ts` + perm `page.inventory` + i18n keys khung.
2. BE entities + `inventory.logic.ts` (+ spec) — hàm thuần trước.
3. BE `applyTransaction` + service nghiệp vụ + controller + module (đăng ký `app.module.ts`).
4. Agent registry cho 3 collection.
5. `FactoryEntity.autoStockOut` + dto + cache getter + switch `FactoryTab.tsx`.
6. FE trang `/ffm/inventory` (3 tab + 3 dialog) + service + sidebar/route/paths.
7. Trạm quét: scanCodes + 2 dialog + `useScanPrint` auto-hook + sheet A4.
8. Tests còn lại + E2E scratchpad chạy sống trên DB local.
9. Docs (Inventory.md + CLAUDE.md mapping + ScanError/FulfillmentWorkflow notes).
10. Lint + build-types + full test → commit.

## Phase sau (KHÔNG làm đợt này)

- Cron đối soát tự động cuối ngày + cảnh báo Telegram tồn âm/tồn thấp.
- Phiếu xuất in A5, quản lý theo lô/hạn, giá vốn nhập.
- Nhập kho bằng file Excel; RFID kiểm kê (nếu mua kit thì đổ vào `adjust`).
- Tự trừ theo công đoạn In-complete (hook `resolveTransition`) cho xưởng muốn bỏ quét.
