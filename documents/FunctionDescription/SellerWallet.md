# Seller Wallet + Seller tự mua label — Function Description

> **File FE (seller):** `apps/seller/src/components/wallet/wallet-view.tsx`, `apps/seller/src/components/orders/buy-label-dialog.tsx`, `apps/seller/src/components/hub/hub-wallets-view.tsx`
> **File BE:** `apps/api/src/modules/customer-wallet/`, `apps/api/src/modules/seller-shipping/`
> **Route:** `/portal/wallet` (seller) · `/hub/wallets` (admin) · nút "Mua vận đơn" ở `/portal/orders*`
> **API:** `customer/wallet*` · `customer/shipping/*` · `admin/customer-wallets*` · `admin/seller-shipping/*`
> **Plan gốc (đầy đủ quyết định với user 09/09/2026):** `documents/Plans/SellerWallet-LabelPurchase.md`

## 1. Overview

Seller tự mua label VNP cho đơn của mình, trả bằng **ví seller (USD)** — vì giá VNP thật KHÔNG phải giá seller trả. Hai sổ tách bạch:

- **Ví seller** = sổ cái append-only `customer_wallet_transactions` + cache `CustomerEntity.walletBalance`. Ví TỔNG đa mục đích: hôm nay trừ tiền label; `kind='order'` chừa sẵn cho lúc bật thu tiền đơn hàng (hiện push vẫn ghi `customer_payments` `waived` như cũ); mở rộng thêm loại chi phí = thêm kind.
- **Ví công ty** = ví VNP sẵn có (`shipments.shippingCost`/`balanceAfter`) — KHÔNG xây sổ mới. Margin label = `sellerPrice − shippingCost`, xem cột "Thu seller" ở `/adm/shipments`.

Giá bán seller theo **bảng mốc cân** (`Data/shipping_cost.csv`, 71 mốc 50g→10.000g, USD) lưu `system_configs` key `seller_shipping_price_config` — admin upload lại được ở `/hub/wallets`; **mỗi lượt mua snapshot giá** vào `shipments.sellerPrice` nên đổi bảng không sửa lịch sử.

## 2. Luồng hoạt động

### 2.1 Mua label (seller, `BuyLabelDialog`)

1. Nút "Mua vận đơn" hiện ở bảng đơn portal (cột tracking của `order-row.tsx` + thẻ mobile `order-card.tsx`) khi mirror client `canBuyLabelRow()` pass: **CHỈ đơn cod/tiktok** (mọi item), đã push, chưa giữ/hủy, chưa có tracking. Server luôn kiểm lại bằng `checkSellerLabelEligibility()` (`seller-label-eligibility.ts` — hàm thuần + spec). Đơn ĐÃ có tracking thì cột này hiển thị mã tracking (link `tracking.url` nếu có) + **link "Label ↗"** mở PDF `tracking.labelUrl` — cả bảng lẫn thẻ mobile, cả portal seller lẫn `/hub/orders` (cùng component; key i18n `seller:buyLabel.labelLink`).
2. Quote: cân prefill = Σ(weight biến thể × qty); cân quy đổi = Σ(dài×rộng×cao×qty)/6 cm→gram (cộng theo THỂ TÍCH cả nhóm item; **kích thước KHÓA theo biến thể, seller chỉ sửa cân nặng**). Cân tính cước = **max(cân điền, cân quy đổi)**, làm tròn **LÊN** mốc kế; **>10.000g chặn mua** (`over_max_weight`).
3. Xác nhận → `POST customer/shipping/orders/:stagingId/label` với `requestId` sinh 1 lần/lượt mở dialog. Thứ tự tiền theo `ShippingLabelPatterns.md`:
   - **Trừ ví TRƯỚC** (`applyTransaction kind='label'`, fail-closed theo `balance + creditLimit`).
   - Gọi `ShippingVnpService.createShipment()` NGUYÊN BẢN (giữ chỗ `purchasing`, unique index `groupKey`/`purchaseKey`, đối soát `balanceAfter` ví công ty; `service='Standard'`, `shippingType='GDE'` — seller không chọn).
   - Thành công → stamp `sellerPrice`/`sellerCustomerId`/`sellerWalletTxnId` lên record `shipments`.
   - VNP lỗi → **hoàn tự động** `kind='label_refund'` cùng `requestId`; hoàn lỗi nữa thì log `seller-shipping.refund-failed` để admin xử tay.
4. Idempotency 2 tầng: unique index sổ ví `(customerId, kind, refs.requestId)` (kind trong khóa để cặp label/label_refund không đụng nhau) + `purchaseKey` sẵn có bên shipments — bấm đúp/retry KHÔNG trừ tiền 2 lần, trả lại nhãn cũ.

### 2.2 Lỗi phía seller — dịch về mã an toàn

BE ném `BadRequestException` với **message = đúng 1 mã** trong `SELLER_SHIP_ERROR_CODES` (`shared/client/seller-shipping.ts`): `missing_weight` / `over_max_weight` / `not_eligible` / `already_has_label` / `insufficient_funds` / `service_unavailable`. MỌI lỗi nội bộ (VNP sập, hết ví công ty, sai config, địa chỉ lỗi) gom về `service_unavailable` — chi tiết thật CHỈ vào Winston log + record `shipments`. FE map i18n `seller:buyLabel.errors.*`, mã lạ rơi về `service_unavailable`. Sai chủ đơn trả cùng `not_eligible` (không lộ đơn tồn tại). Filter global (`CustomExceptionFilter`) chỉ trả `message` nên không rò field khác.

### 2.3 Ví seller

- MỌI biến động tiền qua đúng 1 hàm `CustomerWalletService.applyTransaction()` — transaction Mongo (replica set) gói [pre-check requestId → kiểm `checkWalletGuard(balance, creditLimit, amount)` → insert record sổ có `balanceBefore`/`balanceAfter` → `$set walletBalance`]. Race trùng requestId → E11000 → trả record thắng cuộc. Cộng tiền (topup/hoàn) LUÔN cho kể cả ví đang âm.
- **Nạp phase 1 = TAY**: seller chuyển khoản ngoài hệ thống → admin bấm Nạp ở `/hub/wallets` (note bắt buộc, ghi kèm `byUserId`/`byUserName`). Cổng thanh toán tự động = phase sau.
- **Hạn mức nợ** `CustomerEntity.creditLimit` (mặc định 0) — số dư xuống được tới `−creditLimit`, admin đặt từng seller.
- **Hủy label**: seller KHÔNG tự hủy — admin hủy theo luồng fail-closed sẵn có (`VnpShipping.md` §4) rồi tự quyết hoàn ví bằng nút Điều chỉnh (chính sách hoàn VNP chưa rõ).

## 3. API / Schema

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `customer/wallet` | Số dư + hạn mức (`@Auth([Customer])`) |
| GET | `customer/wallet/transactions` | Sổ cái phân trang, filter `kind` |
| GET | `customer/shipping/price-table` | Bảng giá công khai (ẨN `enabled`) |
| GET | `customer/shipping/orders/:stagingId/quote` | Báo giá (`weightGram?`) — trả 200 kèm `eligible`/`errorCode` |
| POST | `customer/shipping/orders/:stagingId/label` | Mua (`weightGram`, `requestId` bắt buộc) |
| GET | `admin/customer-wallets` | List ví seller (`@Auth([Admin])`, search/activeOnly/paging) |
| GET | `admin/customer-wallets/:customerId/transactions` | Sổ cái 1 seller |
| POST | `admin/customer-wallets/:customerId/topup` \| `/adjust` | Nạp (+) / điều chỉnh (±) — note bắt buộc |
| PATCH | `admin/customer-wallets/:customerId/credit-limit` | Đặt hạn mức |
| GET/POST | `admin/seller-shipping/price-table{,/import}` | Xem/thay bảng giá (mốc tăng dần) |
| POST | `admin/seller-shipping/toggle` | Công tắc tổng seller mua label |

Shared (`packages/shared`): hàm thuần + hằng ở **`client/seller-shipping.ts`** (`computeChargeableWeightGram`/`computeDimWeightGram`/`resolveSellerShipPrice`/`parseSellerShipPriceCsv`/`SELLER_SHIP_ERROR_CODES`/`SellerShipPriceTableZod`) + **`client/wallet.ts`** (`WALLET_TXN_KINDS`) — nest-free cho `apps/seller`; DTO ở `dtos/customer-wallet.dto.ts` + `dtos/seller-shipping.dto.ts` (re-export client). `CustomerZod` thêm `walletBalance`/`creditLimit`.

```typescript
// customer_wallet_transactions — APPEND-ONLY
{ customerId, kind: 'topup'|'label'|'label_refund'|'order'|'adjust',
  amount,                 // + cộng / − trừ (USD, round2)
  balanceBefore, balanceAfter,   // BẮT BUỘC mỗi record — seller xem được cả 2
  note?, byUserId?, byUserName?,
  refs?: { requestId?, shipmentId?, orderIds?, stagingOrderId? } }
// unique partial: (customerId, kind, refs.requestId)
```

## 4. UI Components

- **`/portal/wallet`** (`wallet-view.tsx`, nav "Ví của tôi" 💰): 3 card (số dư — đỏ khi âm / hạn mức / bảng giá toggle), hint nạp tay, bảng sổ cái **có cột Trước → Sau** (desktop table + thẻ mobile), filter kind, phân trang. `KindBadge`/`SignedAmount` export cho hub dùng chung.
- **`BuyLabelDialog`** (`buy-label-dialog.tsx`): input cân (commit khi blur/Enter/nút "Tính giá" — không spam quote), breakdown cân điền/quy đổi/tính cước/mốc/giá/ví/còn lại, disable khi thiếu tiền, màn kết quả tracking + link label. Parent render CÓ ĐIỀU KIỆN (`orders-list-view.tsx` `buyTarget`) để mỗi lượt mở mount mới → `requestId` mới.
- **`/hub/wallets`** (`hub-wallets-view.tsx`, nav "Ví seller"): strip `MoneySummary` 4 card trên đầu — Ví VNP công ty (đọc sống `shipping-vnp/wallet`) · Thu seller (tiền vào, Σ `sellerPrice` + số label) · Chi VNP (tiền ra, `totals.cost` mọi label) · Lãi label seller (`sellerRevenue − sellerCost`), số lấy từ `GET shipping-vnp/shipments/stats` qua proxy hub (`@Auth` Admin nên token staff gọi được); card bảng giá (upload CSV parse client bằng `parseSellerShipPriceCsv` + công tắc + số mốc/ngày cập nhật) + bảng ví (search, activeOnly, 4 nút Nạp/Điều chỉnh/Hạn mức/Sổ cái) + `WalletActionDialog`/`LedgerDialog`; i18n `hub.json` `wallets.summary.*`.
- **`/adm/wallets`** (apps/web, `pages/wallets/` — trang Ví phía NHÂN VIÊN, MenuRestructure-CEO.md §8.2 #7, thay link tạm sang `/hub/wallets`): CHỈ ĐỌC ở đợt này — bảng ví (search, checkbox "Chỉ ví có tiền hoặc đã có giao dịch", số dư đỏ khi âm + nhãn "Vượt hạn mức" khi `balance < −creditLimit`) + bấm hàng mở `WalletLedgerSheet` (3 ô Số dư/Hạn mức/Còn được dùng = `balance + creditLimit`, lọc theo loại, cột Trước → Sau). Bộ lọc nằm TRÊN URL (`?activeOnly=true&search=&customer=<id>&kind=`) để link menu mang sẵn bộ lọc mặc định (§8.1) và link sổ cái gửi được cho người khác. **Không bao giờ gửi `activeOnly=false`** — `z.coerce.boolean` đọc chuỗi `"false"` thành `true`. Gọi lại 2 endpoint admin sẵn có qua `services/customerWallet.ts`, KHÔNG thêm endpoint. Nạp/điều chỉnh/hạn mức vẫn chỉ ở `/hub/wallets` — dời đợt sau, cần dialog xác nhận rõ. i18n namespace `wallets`. Gate FE `usePermission().isAdmin` (mẫu `/adm/shipments`).
- `/adm/shipments` (apps/web): cột "Thu seller" (`sellerPrice`) + 2 card dashboard **"Thu seller (tiền vào)"** (Σ `sellerPrice` + số label) và **"Lãi label seller"** (`sellerRevenue − sellerCost`) — số tính ở BE `getShipmentStats()` (`totals.sellerRevenue`/`sellerCost`/`sellerLabelCount`, chỉ đếm shipment có `sellerPrice` chưa hủy); "tiền ra" tổng = card "Tổng chi phí" sẵn có, ví VNP tổng = ô "Ví VNP" trên header trang.
- i18n: `apps/seller/src/i18n/locales/{vi,en}/seller.json` (`wallet.*`, `buyLabel.*` incl. `labelLink`, `nav.wallet`) + `hub.json` (`wallets.*`, `nav.wallets`) — namespace app-own, sửa trực tiếp; `apps/web` `shipments.json` (`table.sellerPrice`, `stats.sellerRevenue`, `stats.sellerMargin`).

## 5. Backend logic

- `customer-wallet/`: entity + `wallet-guard.ts` (hàm thuần `checkWalletGuard`/`round2` + spec) + service (`applyTransaction`/`getWallet`/`listTransactions`/`listWallets`/`updateCreditLimit`) + 2 controller. `walletBalance` TUYỆT ĐỐI không `$set` ngoài `applyTransaction`.
- `seller-shipping/`: `seller-label-eligibility.ts` (hàm thuần + spec) + service (`quote`/`buy`/`getPriceTable`/`importPriceTable`/`toggle`) + 2 controller. Module chỉ bind model (không import CustomerPortalModule/OrderModule). Feature bật khi: có bảng giá + `enabled !== false` + có `vnpEglobalConfig`.
- `shipping-vnp/shipment.entity.ts` thêm `sellerPrice`/`sellerCustomerId` (index)/`sellerWalletTxnId`; `toShipmentRecord()` trả 2 field đầu.
- Test: `NODE_ENV=test npx jest src/modules/customer-wallet src/modules/seller-shipping` (guard ví, eligibility, mốc giá/biên 10kg, parse CSV).

## 6. Performance notes

- Quote 3 query nhỏ (staging by id, orders by productionId `$in`, config có Redis cache 1h) — không aggregation.
- Sổ cái đọc theo index `{customerId, createdAt: -1}`; list ví hub 1 find + 1 aggregate lastTxn theo lô id trang hiện tại.
- Transaction Mongo chỉ bọc 3 thao tác nhỏ; `withTransaction` tự retry write-conflict khi 2 giao dịch cùng seller chạy song song.

## 7. Permissions

- Seller: `@Auth([RoleType.Customer])`, prefix `customer/` (RolesGuard chặn vai Customer ngoài prefix này — lý do KHÔNG nới `shipping-vnp/*`).
- Admin: `@Auth([RoleType.Admin])` (SuperAdmin kế thừa), prefix `admin/...` cố ý không chứa `/customer/`.
- KHÔNG dùng permission-catalog (portal seller không dùng hệ permission nội bộ).

## 8. Phase sau (đã chốt dời — memory `seller-wallet-label`)

Cổng thanh toán nạp tự động · seller tự hủy + hoàn tự động (chờ chính sách VNP) · bật gate `kind='order'` trừ tiền đơn khi push · giá theo tier VIP (`tierPrices` trong config) · ngưỡng cảnh báo ví VNP công ty thấp → tự tắt nút mua + báo Telegram.
