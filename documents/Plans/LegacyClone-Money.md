# Clone hệ cũ — vùng Tiền (Billing + Affiliates)

> Khảo sát `app.onospod.com` ngày 01/10/2026, **chỉ đọc**: chỉ mở trang, đọc, lọc; không bấm nút nào
> đụng tiền (Charge, Retry fetch ship cost, Download, Edit, tick chọn hàng). Một phần của
> [`LegacyClone-Spec.md`](LegacyClone-Spec.md) §4, vùng `tool`.
> Ảnh chụp có email/số tiền khách thật nên KHÔNG đưa vào repo.

## 1. Hai điểm SỬA khảo sát cũ (`OnosPodLegacy-BusinessFlows.md`)

| Khảo sát 07/09 nói | Màn hình thật nói | Bằng chứng |
|---|---|---|
| Kỳ hoá đơn **10 ngày** (01–10, 11–21, 22–cuối) | Kỳ **theo tuần**: 01–07 · 08–14 · 15–21 · 22–cuối tháng | Hoá đơn đã trả của một seller tháng 07: bốn kỳ `07-01→07-07`, `07-08→07-14`, `07-15→07-21`, `07-22→07-31` |
| Base cost (Production Transaction) ghi **lúc kiện quét xong** | Ghi **lúc thanh toán đơn**, cùng phút với giao dịch Payment của seller | Đơn `UP-85289-65893`: item `FP-00206-83179` vẫn `To Do` / In Production, nhưng "Payment production FP-00206-83179" $12,09 đã `Paid` từ 33 phút trước, cùng lúc "Payment order" −$18,19 |

## 2. Bảng khoảng trống

| Màn hình hệ cũ (link menu = bộ lọc mặc định) | Hệ cũ có gì | Hệ mới có gì | Kết luận | Việc phải làm | Công sức |
|---|---|---|---|---|---|
| **Topup** `/billing/topup` | Form nhân viên nạp tay cho **bất kỳ tài khoản nào**: Account · Amount · **External transaction ID** · **Attachment** (ảnh chứng từ) · Note · nút Charge. Gợi ý nội dung CK "ONOSGROUP topup, ngay dd-mm-yyyy". 9.114 lượt topup tổng | `POST admin/customer-wallets/:id/topup` (amount + note) — UI chỉ ở `/hub/wallets` | **BỔ SUNG** | Thêm `externalTxnId` + `attachmentUrl` vào DTO/`refs`; dialog nạp ở `/adm/wallets` có bước xác nhận hai lần + chặn bấm đúp | S–M |
| **Transactions** `/billing/history/all?status=All` | **Một sổ cho mọi seller**, 1.022.705 dòng. Tab trạng thái Pending/Paid/Error/Cancelled kèm số; lọc Type (Top-up · Payment · Refund · Active · Commission · Commission Refund), Account, nút ngày Today…Last Month. Cột: ID · Ex.ID · Status · Pay date + Order date · Type · Amount · Note · FFM Order ID · Merchant Order ID · Order Reference · Invoice | `customer_wallet_transactions` (5 kind: topup/label/label_refund/order/adjust), luôn đã ghi (không có trạng thái); `/adm/wallets` chỉ xem **từng seller** | **BỔ SUNG** (danh sách) + **XÂY MỚI** (nguồn tiền) | (a) Endpoint + trang danh sách giao dịch **toàn bộ seller** lọc kind/ngày/seller, cột nối sang đơn (`refs.orderIds` đã có). (b) Các khoản hệ mới **chưa bao giờ trừ**: tiền đơn (Payment), **Import Tax** theo item, **Active** = phí kích hoạt tracking $0,70/tracking (34.540 dòng), **Refund** đơn (18.272 dòng). (b) là động cơ tính tiền — phần lớn nhất | (a) M · (b) L |
| **Production Transactions** `/billing/production-history/all?status=All` | **Sổ riêng**, 932.447 dòng, mỗi dòng = 1 item sản xuất ("PRODUCTION ID: #…"), Amount = **base cost**, ghi lúc thanh toán (§1). Tab trạng thái như trên; Type chỉ Top-up/Payment/Refund. Không có cột đơn/merchant | Không có. Base cost nằm ở `ProductConfig.variations[].cost`, không snapshot theo item | **XÂY MỚI** | Sổ chi phí sản xuất riêng (không chung sổ ví seller), snapshot base cost theo item lúc đẩy sản xuất | M |
| **Invoice** `/billing/invoice?status=Pending` | 1 hoá đơn / seller / **kỳ tuần**, **tự sinh** (không có nút tạo ở đâu; có cả hoá đơn $0). Mỗi dòng: Amount (tiền seller đã trả) · Total product cost (số item) · Total estimate ship cost · Total actual ship cost · Total cost · link Transactions · nút Retry fetch ship cost · Download Actual Shipping Cost. 5.907 tổng (Pending 2.688 · Paid 3.215 · Cancelled 4); kỳ Paid mới nhất là tháng 07 | Không có (GAP-18) | **XÂY MỚI** | Cron chốt kỳ tuần, gom sổ ví + sổ sản xuất theo seller, xuất xlsx, trạng thái Pending→Paid do người bấm | M–L |
| **Production Invoice** `/billing/production-invoice?status=Pending` | 1 hoá đơn / **seller** (KHÔNG phải theo xưởng) / kỳ tuần, Amount = Σ base cost. 5.829 tổng: Pending 5.750 · **Paid 12** · Cancelled 67 | Không có (GAP-19) | **XÂY MỚI, ưu tiên thấp** | Sau khi có sổ sản xuất thì chỉ là một phép gom. Hỏi trước có ai dùng không: gần như không hoá đơn nào từng được chốt | S |
| **Affiliates** `/affiliates?tab=thismonth` | Nhóm giới thiệu: mã · tài khoản · SKU · số người phụ thuộc · lợi nhuận/đơn vị theo SBTT/COD/ONOSEXPRESS. Link giới thiệu hiện `…/referral/undefined` (hỏng). 20 nhóm, **0 đơn, $0** cả tháng này lẫn tháng trước; giao dịch loại **Commission: 0 dòng từ trước tới nay** | Không có | **KHÔNG LÀM** (chờ CEO xác nhận bỏ) | — | 0 |

## 3. Năm câu hỏi

1. **"Giao dịch" khác "Giao dịch sản xuất"?** **Hai sổ riêng**, không phải hai góc nhìn. Mã giao dịch khác nhau,
   tổng số dòng khác nhau (1.022.705 so với 932.447), đối tượng khác nhau: sổ thứ nhất là tiền ra vào ví seller
   (Payment, Import Tax, Active, Topup, Refund); sổ thứ hai là chi phí base cost theo từng item. Sổ hệ mới
   (`customer_wallet_transactions`) khớp với sổ thứ nhất; sổ thứ hai phải là một collection khác.
   *Suy luận chưa kiểm:* sổ sản xuất không làm đổi số dư ví seller (số tiền hiện dương, không có cột số dư).
2. **Hoá đơn sinh thế nào?** **Tự chạy**: không có nút tạo ở đâu, seller nào cũng có hoá đơn mỗi kỳ, kể cả hoá
   đơn $0. Kỳ **theo tuần** (xem §1). Gồm tiền seller trả, tổng base cost, phí ship ước tính và thực tế,
   kèm file tải về. "Paid" chậm hàng tháng (kỳ Paid mới nhất là tháng 07), nên nhiều khả năng do người bấm.
   **Phí ship thực tế bằng $0 ở mọi hoá đơn đã xem** → đường lấy phí ship thật về coi như đã chết.
3. **Base cost ghi lúc nào?** **Lúc thanh toán đơn**, không phải lúc đóng kiện (§1).
4. **Affiliates?** Chương trình giới thiệu, có cấu hình hoa hồng theo phương thức ship, nhưng **không được dùng**:
   0 giao dịch hoa hồng từ trước tới nay, 0 đơn qua nhóm giới thiệu trong hai tháng gần nhất, link giới thiệu hỏng.
5. **Số dư âm?** `-$807.48` trên header là ví **của chính tài khoản đang đăng nhập** (tài khoản CEO cũng là
   một user có ví). Danh sách Users có cột BALANCE gắn nhãn CREDIT/DEBIT. Theo khảo sát cũ: CREDIT = trả trước,
   đơn bị treo "Insufficient account balance"; DEBIT = trả theo kỳ, có `debit_limit`, số dư âm rất sâu.
   *Hôm nay chưa kiểm lại được chỗ chặn trên màn hình.* Hệ mới đã có `creditLimit` khớp mô hình này
   (CREDIT = `creditLimit` 0), nhưng **chưa có chỗ nào trừ tiền đơn**, nên chưa có chỗ nào để chặn.

## 4. Thứ tự đề xuất

1. **Động cơ tính tiền đơn** (Payment + Import Tax + Active + Refund) trừ vào sổ ví sẵn có qua
   `applyTransaction()`, chặn đẩy sản xuất khi vượt `creditLimit`. Đây là nút thắt thật; mọi thứ khác dựa vào nó.
2. **Sổ base cost theo item** lúc đẩy sản xuất.
3. **Danh sách giao dịch toàn bộ seller** ở `/adm`.
4. **Hoá đơn kỳ tuần** (gom 1 + 2).
5. Topup có chứng từ + Production Invoice, khi có người cần.
6. Affiliates: không làm, trừ khi CEO nói khác.

## 5. Đối chiếu với hệ mới (04/10/2026) và thứ tự làm

### 5.1 Hệ mới đã có / còn thiếu, theo từng màn

| Màn hệ cũ | Hệ mới đã có | Thiếu HẲN (cần backend mới) | Chỉ thiếu cột / bộ lọc / nút |
|---|---|---|---|
| Topup | `POST admin/customer-wallets/:id/topup` (amount + note), UI chỉ ở `/hub/wallets` | — | Ô "mã giao dịch ngoài" + ảnh chứng từ trong `refs`; dialog nạp ở `/adm/wallets` (hai bước xác nhận, chặn bấm đúp) |
| Transactions | Sổ cái `customer_wallet_transactions` + `GET admin/customer-wallets/:id/transactions` (một seller) + sheet sổ cái ở `/adm/wallets` | Endpoint danh sách giao dịch **mọi seller**; các loại tiền hệ mới chưa bao giờ ghi: `import_tax`, `active` (phí kích hoạt tracking), `refund` đơn | Lọc theo ngày/seller; cột mã đơn (`refs.orderIds` đã có); không có tab trạng thái vì sổ ví chỉ ghi giao dịch đã chốt |
| Production Transactions | Không có | Sổ chi phí sản xuất theo item | — |
| Invoice | Không có (GAP-18) | Bảng hoá đơn kỳ tuần + cron chốt kỳ + xuất xlsx | — |
| Production Invoice | Không có (GAP-19) | Gom sổ sản xuất theo seller/kỳ | — |
| Affiliates | Không có | — | Không làm (0 hoa hồng từ trước tới nay) |

### 5.2 Hai bẫy đọc từ code, phải biết trước khi làm

1. **`OrderEntity.baseCost` KHÔNG phải base cost của hệ cũ.** Nó mang giá seller thấy lúc đẩy sản xuất (`customer-order.service.ts` ~2192: `discountedPrice ?? unitPrice`; đường import OnosPod cũng gán `item.price`), và CEO Dashboard cộng nó làm "giá trị đơn". Base cost của hệ cũ (Production Transaction) là giá vốn biến thể (`variations[].cost` ≙ `base_price`). Sổ sản xuất phải snapshot `variations[].cost` vào một trường/collection mới, **không dùng lại `baseCost`**.
2. **Mỗi lần đẩy sản xuất, hệ mới đã ghi một dòng `customer_payments` trạng thái `waived` kèm tổng tiền.** Đây là dữ liệu có sẵn để so với giao dịch Payment hệ cũ của cùng seller trước khi bật tính tiền thật, không cần viết thêm code thu thập.

### 5.3 Thứ tự làm

Hai sự thật cần nhớ khi làm bất kỳ mục nào: **kỳ hoá đơn theo TUẦN (01–07, 08–14, 15–21, 22–hết tháng)** và **base cost ghi lúc THANH TOÁN đơn, không phải lúc đóng kiện**.

Luật chung: luồng push GIỮ `waived` cho tới khi chủ dự án duyệt. Mọi mục dưới đây hoặc chỉ đọc, hoặc chạy ở chế độ bóng (ghi nhận, không đụng số dư ví).

| # | Việc | Vì sao ở vị trí này | Công sức | Cần duyệt gì |
|---|---|---|---|---|
| 1 | **Sổ chi phí sản xuất chế độ bóng**: snapshot `variations[].cost` theo item lúc đẩy sản xuất vào collection riêng, không đụng ví | Hoá đơn và đối soát đều cần dữ liệu này; càng ghi sớm càng có nhiều kỳ để so với hệ cũ. Không rủi ro tiền vì không trừ ai | M | Chỉ cần xác nhận dùng `cost` (không phải `nonShipCost`) |
| 2 | **Danh sách giao dịch mọi seller** ở `/adm` (chỉ đọc, lọc loại/ngày/seller, cột mã đơn) | Cho nhân viên đúng màn Billing › Transactions; chỉ đọc nên an toàn, tái dùng khuôn `/adm/wallets` | M | Không |
| 3 | **Động cơ tính tiền đơn có cờ** (đã trình `onos-49`: dùng `quoteItem`, `applyTransaction` kind `order`, cờ toàn hệ thống + cờ từng seller, mặc định tắt, test không trừ hai lần) | Đây là nút thắt chặn chuyển seller, nhưng đang chờ ba quyết định (công thức giá, nghĩa `nonShipCost`, seller thử) | L | **Chủ dự án**: ba câu đã hỏi |
| 4 | **Hoá đơn kỳ tuần chế độ bóng**: cron chốt kỳ, gom sổ ví + sổ sản xuất theo seller, xuất xlsx, chỉ để đối chiếu với hoá đơn hệ cũ | Chỉ có nghĩa khi #1 và #3 đã chạy; chạy bóng ≥ 1 kỳ để so số | M–L | Không (bóng) |
| 5 | Thêm loại tiền `import_tax`, `active`, `refund` đơn | Phụ thuộc #3; thêm giá trị vào `WALLET_TXN_KINDS` (`packages/shared/client/wallet.ts`) kéo theo nhãn/badge ở `apps/seller` | M | Công thức thuế/phí |
| 6 | Dialog nạp / điều chỉnh / hạn mức ở `/adm/wallets`, kèm mã giao dịch ngoài + chứng từ | Nạp tay đang làm được ở `/hub/wallets` nên không chặn vận hành; đụng tiền thật nên làm riêng, chậm, có người kiểm | M | Phiên làm riêng (`onos-49` đã chốt) |
| 7 | Production Invoice | Gần như không dùng ở hệ cũ (12/5.829 đã trả) | S | Hỏi có ai dùng trước |
| — | ~~Affiliates~~ | **Gạch khỏi phạm vi**: hệ cũ có 0 giao dịch hoa hồng từ trước tới nay, 0 đơn qua nhóm giới thiệu trong hai tháng gần nhất, link giới thiệu hỏng (`/referral/undefined`) | 0 | Đã duyệt (onos-80, 04/10/2026) |

**Làm được ngay không cần duyệt thêm: #1 (sau khi xác nhận `cost`) và #2.**

### 5.4 Tiến độ

- **#1 sổ chi phí sản xuất chế độ bóng — XONG** (04/10/2026): `production_cost_entries`, xem `CustomerOrderIntake.md` §3.3b. Giá vốn = `variations[].cost` (xác nhận bằng số prod: cost 5,60 < nonShipCost 6,30 < retailPrice 14,51; 2.224/2.250 biến thể có nonShipCost cao hơn cost).
- **#2 danh sách giao dịch mọi seller — XONG** (04/10/2026): `GET admin/customer-wallets/transactions` + trang `/adm/wallets/transactions`, xem `SellerWallet.md` §3/§4. Mục menu ĐÃ có: `Sidebar.tsx:594-596` trỏ `PATHS.WALLET_TRANSACTIONS?range=7d`.
- **#5 thêm loại tiền `import_tax`/`active`/`refund` — XONG phần khai báo** (04/10/2026): chỉ thêm vào `WALLET_TXN_KINDS` + nhãn + màu, CHƯA có dòng nào được ghi (việc ghi thuộc #3).
- **#6 dialog nạp / điều chỉnh / hạn mức ở `/adm/wallets` — XONG** (04/10/2026; soát QC + vá 10/10/2026): hai bước, đọc lại ví thật (`getWallet` ở bước xem lại; server vẫn là nguồn sự thật qua `checkWalletGuard` trong transaction), link chứng từ, dấu vết đổi hạn mức; xem `SellerWallet.md` §4/§5.1/§5.2.
  - **Chống ghi đôi: 3 lớp.** (1) FE: một `requestId` mỗi lượt mở dialog + khoá nút; (2) API: `requestId` bắt buộc, `strictReplay` trả 409 nếu số tiền khác; (3) DB: unique `(customerId, kind, refs.requestId)` và unique `externalTxnId` cho nạp tiền. Thông báo `externalTxnConflict` chỉ là thông điệp lỗi, KHÔNG phải lớp chặn — trước 10/10/2026 tài liệu này đếm nó thành "lớp thứ tư".
  - **Lỗ hổng ghi đôi — ĐÃ VÁ 10/10/2026.** FE từng xoay `requestId` mỗi khi nội dung đổi, mà dấu vân tay gồm cả `note`/`externalTxnId`/`attachmentUrl`: sửa ghi chú sau một lần thử mất mạng ⇒ khoá mới ⇒ ghi tiền lần hai (`adjust` không có `externalTxnId` nên unique index cũng không bắt được). Nay dấu vân tay **chỉ gồm chế độ + số tiền** (`WalletActionDialog.tsx`), nên sửa ghi chú rồi thử lại là một RETRY đúng nghĩa. Thao tác khác thật sự = số tiền khác, hoặc mở lại dialog (mount mới sinh khoá mới).
  - **Ô tích ≥ $1.000 — nay chặn ở SERVER**, không chỉ ở giao diện. `TopupWalletZod`/`AdjustWalletZod` đòi `largeAmountAck=true` đúng từ ngưỡng `WALLET_BIG_AMOUNT_USD` (cả hai chiều với `adjust`); hạn mức nợ đòi `largeIncreaseAck=true` và CHỈ khi TĂNG (hạ hạn mức là chiều an toàn, không làm chậm) — chặn trong `CustomerWalletService.updateCreditLimit` vì chỉ service biết hạn mức cũ. Test: `wallet-big-amount-ack.spec.ts`.
  - **Vẫn chưa ai thử với backend + đăng nhập thật.** Việc còn lại là một lượt thử tay, không phải đường dẫn code.
- #3 động cơ tính tiền — CHƯA bắt đầu: chờ chủ dự án duyệt bật tính tiền thật và trả lời ba câu về giá.

## 6. Cách đối soát tiền đơn: `customer_payments` (waived) so với giao dịch Payment hệ cũ

> **CHƯA CHẠY.** Mục này chỉ mô tả cách làm, để người có quyền đọc cả hai đầu chạy. **Phải xong, với kết quả đạt, trước khi bất kỳ ai bật động cơ tính tiền (#3).** Chạy xong thì ghi kết quả vào cuối mục này (ngày, seller, số đơn, số lệch), không ghi đè mô tả.

### 6.1 Hai đầu đo và đơn vị so sánh

Hai bên KHÔNG đo cùng một thứ nếu lấy thẳng số tổng:

| | Hệ mới | Hệ cũ |
|---|---|---|
| Nơi lấy | `customer_payments` (dòng `status='waived'`, mỗi lần đẩy một dòng, `amount` = tổng giá chốt cả lô) — chi tiết từng item ở `customer_orders.items[].priceSnapshot.lineTotal`, nối bằng `customer_orders.paymentId = customer_payments._id` | Màn **Transactions** (`/billing/history/all`), lọc Type = Payment, Account = seller, nút ngày; mỗi dòng "Payment order <mã đơn hệ cũ>" kèm Merchant Order ID |
| Gồm gì | Giá item × số lượng (`nonShipCost` cho cod/tiktok, `retailPrice` cho còn lại, trừ khuyến mãi theo hạng). **Không** có phí ship, **không** có thuế | Payment = subtotal **+ ship nếu seller trả trước** (khảo sát §8); thuế nhập là dòng Import Tax riêng; phí kích hoạt là dòng Active riêng |
| Kỳ | Theo `pushedAt` | Theo ngày thanh toán ("Pay date") |

Vì vậy **chỉ so phần tiền hàng (subtotal)**, không so Payment tổng của đơn có ship. **Vòng 1 chỉ lấy đơn COD**: hệ cũ ghi ship = 0 và thuế = 0 cho COD (khảo sát §8) nên Payment == subtotal, so thẳng được. Đơn SBTT/ONOSEXPRESS/EXPRESS_US để vòng sau, khi đã tách được subtotal khỏi ship.

### 6.2 Bước 0 — việc người chạy phải xác nhận trước (mình CHƯA kiểm)

1. Màn chi tiết đơn hệ cũ có hiện **subtotal** và **giá bán từng item** (`Sale_cost`) tách khỏi ship/thuế không? Nếu không, vòng 1 chỉ dùng đơn COD và lấy Payment làm subtotal.
2. Giờ trên màn hệ cũ ("Pay date", "Order date") là múi giờ nào? Giả định tạm là giờ VN (UTC+7). Nếu không phải, đơn sát mép kỳ tuần sẽ rơi sai tuần.
3. `identity` của seller bên hệ cũ có trùng `customers.userSku` (không phân biệt hoa thường) không. Khảo sát §3 nói có (ví dụ `TIENHC`); kiểm lại trên seller được chọn, vì màn Transactions hiện dạng "HUYDUC / HUYDUC399" (hai mã).
4. Seller chọn đối soát **có đơn ở cả hai hệ** không (Chế độ A) hay chỉ có ở hệ cũ (Chế độ B).

### 6.3 Hai chế độ

**Chế độ A — đơn có ở cả hai hệ (seller đẩy song song):**
- Khoá ghép: `(seller, mã đơn ngoài)`. Mã đơn ngoài = `customer_orders.orderId` (hệ mới) ↔ **Merchant Order ID** (hệ cũ). Chuẩn hoá cả hai: bỏ khoảng trắng, so không phân biệt hoa thường.
- **KHÔNG ghép bằng `productionId`**: mã `XX-#####-#####` mỗi hệ tự cấp, không bao giờ trùng nhau cho cùng một đơn.
- Trường lấy: hệ mới `items[].priceSnapshot.lineTotal` cộng theo đơn; hệ cũ subtotal của đơn (hoặc Payment nếu COD).

**Chế độ B — đơn chỉ có ở hệ cũ (thực tế trước khi chuyển seller):** tính lại giá. Với mỗi đơn hệ cũ được chọn:
1. Lấy từ hệ cũ: seller, tên sản phẩm + size (+ màu), số lượng, phương thức ship, hạng VIP, subtotal.
2. Tra `productConfigs` hệ mới theo tên sản phẩm (`fullName`, không phân biệt hoa thường), chọn biến thể theo size/màu.
3. Tính giá hệ mới đúng như `quoteItem`: cod/tiktok → `nonShipCost ?? retailPrice`; còn lại → `retailPrice ?? nonShipCost`; rồi áp khuyến mãi có hiệu lực của đúng hạng seller; nhân số lượng, làm tròn cent.
4. So với subtotal hệ cũ.

### 6.4 Cách lấy số bên hệ mới

Agent API (chỉ đọc), `POST /api/v1/agent/query`. `limit` tối đa 200, có `offset` (≤ 10.000) và `withTotal`; lô thiếu thì tăng `offset`, đừng đoán từ kích thước trang.

```json
{ "table": "customer_payments",
  "filter": { "$and": [ { "status": "waived" }, { "customerId": "<_id seller>" },
                        { "createdAt": { "$gte": "<đầu kỳ, UTC>", "$lt": "<hết kỳ, UTC>" } } ] },
  "select": { "fields": ["_id", "orderIds", "amount", "createdAt"],
              "sort": [{ "field": "createdAt", "dir": "asc" }], "limit": 200, "withTotal": true } }
```
```json
{ "table": "customer_orders",
  "filter": { "paymentId": { "$in": ["<_id các dòng trên>"] } },
  "select": { "fields": ["orderId", "paymentId", "pushedAt", "items"], "limit": 200, "withTotal": true } }
```
`_id` seller lấy ở `customers` theo `userSku`. Đầu/cuối kỳ tuần đổi từ ngày VN sang UTC (trừ 7 giờ): kỳ 22–30/09 là `2026-09-21T17:00:00Z` tới `2026-09-30T17:00:00Z` (loại trừ).

### 6.5 Thế nào là sai

So **từng đơn**, rồi mới cộng theo seller/tuần. Cộng tuần che được lỗi bù trừ nhau, nên tổng khớp KHÔNG thay cho khớp từng đơn.

| Kết quả một đơn | Phân loại | Ý nghĩa |
|---|---|---|
| `abs(mới − cũ) ≤ 0,01` | Khớp | Chênh một cent là làm tròn |
| `mới − cũ > 0,01` | **Thu thừa — CHẶN** | Bật tính tiền sẽ trừ seller nhiều hơn hệ cũ |
| `cũ − mới > 0,01` | Thu thiếu | Không chặn nhưng phải giải thích được (mất tiền) |
| Không tra được sản phẩm/biến thể/giá hệ mới | Không đo được | Đếm riêng, không tính vào khớp; mỗi ca là một lỗi dữ liệu sản phẩm cần sửa |

Đọc chênh theo seller để tìm nguyên nhân gốc:
- Chênh **không đổi trên mỗi item** (ví dụ +0,50 hoặc +0,60) ở mọi đơn của seller → hệ cũ cộng markup riêng cho seller (khảo sát §8: đối tác VIP0 +0,50/+0,60; một số seller +0; VIP3/4 theo giá bán lẻ trừ chiết khấu) mà hệ mới chưa có chỗ lưu. Đây là khoảng trống cấu hình, **không** sửa bằng cách chỉnh giá sản phẩm.
- Chênh **thay đổi theo sản phẩm** → giá biến thể hai hệ khác nhau (dữ liệu import từ hệ cũ lệch).
- Chênh chỉ ở đơn **sát mép kỳ** → múi giờ/giờ cắt (Bước 0 mục 2), không phải lỗi giá.

### 6.6 Điều kiện đạt (để được đề nghị bật #3 cho một seller thử)

- Cỡ mẫu tối thiểu: **30 đơn COD của seller đó, trải ít nhất 3 sản phẩm khác nhau**, và gồm đủ một kỳ tuần.
- **0 đơn "Thu thừa"**, và mọi đơn "Thu thiếu" đều đã có lời giải thích.
- Số đơn "Không đo được" bằng 0 trên các sản phẩm của seller đó.
- Kết quả (bảng từng đơn: mã đơn ngoài, giá mới, giá cũ, chênh, phân loại) lưu cạnh mục này để người duyệt đọc.

### 6.7 Chưa đối soát được hôm nay

- **Tiền vận chuyển** (`shipments.sellerPrice`, margin): production hiện có 58 vận đơn, tất cả `provider='customer'`, chưa mua nhãn VNP thật nào (đo 04/10/2026) → không có số thật nào để so với phí ship hệ cũ. Khi có nhãn VNP thật đầu tiên thì so `sellerPrice` với phí ship hệ cũ cùng bậc cân (hệ cũ: bậc EXPRESS_US theo cân; SBTT cộng 0,70 kích hoạt).
- **Thuế nhập khẩu, phí kích hoạt tracking, hoàn tiền đơn**: hệ mới chưa tính (#5 mới khai báo loại, chưa có dòng nào).
- **Sổ chi phí sản xuất** (`production_cost_entries`) so với Production Transactions hệ cũ: chỉ làm được khi sổ đã tích luỹ ít nhất một kỳ tuần sau lúc deploy; không backfill.
