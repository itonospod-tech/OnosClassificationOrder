# Lô sản xuất — đề xuất mô hình (CHƯA code)

> Khoảng trống tìm ra khi đối chiếu `OnosPodLegacy-BusinessFlows.md` §3.4/§5 với hệ mới.
> Tài liệu này là ĐỀ XUẤT để anh Tuấn / onos-49 quyết, không phải lệnh code.

## 1. Hệ cũ làm gì (từ tài liệu, chưa xem màn hình thật)

- Mỗi ngày Mê Linh / Thái Nguyên gom item thành ~2 lô có tên (`BA-2609-227`, tên tự đặt như "7-9 thai nguyen"). 66 + 63 lô trong khảo sát.
- Lô có barcode riêng (in được), trạng thái `Producting | On Hold | Cancelled | Completed | Ready | Error | Reproduction`, người phụ trách, loại sản phẩm, tiến độ đếm theo 4 công đoạn (ví dụ 0/49/76).
- Tạo bằng `makeMrpBatchProduct(product_ids, params)`; production mang `batch_id`; timeline item ghi "Moved to batch #…".
- Production hệ cũ có `batch_id` — query import `onospod-import.service.ts:86` ĐÃ kéo trường này nhưng không lưu (grep `batchId` trong `apps/api` = 0 chỗ dùng).

## 1b. Quan sát màn hình thật (onos-49, 01/10/2026, chỉ cấu trúc — Batch Items Thái Nguyên, `status=Producting`)

- Cột: Name · Batch ID · Status · Note · Action (4 nút chỉ có icon, chưa đọc được nhãn). Lọc: ô Batch ID, perpage, select tháng, nút ngày All Time/Today/Yesterday/Last 7 Days.
- **42 lô đang `Producting` cùng lúc ở MỘT xưởng** → lô KHÔNG phải thực thể trong ngày; sống nhiều ngày. Con số "~2 lô/ngày" của tài liệu cũ chỉ là tốc độ TẠO, không phải số lô mở.
- Mã thật là `BV-2610-676`, không phải `BA-…` như tài liệu cũ. **Không chép cứng khuôn mã**; tiền tố/phần giữa chưa rõ nghĩa (không khớp ngày tạo nếu đọc là yymm). Mã lô của hệ mới tự định, cần quyết có giữ dạng cũ để quen tay không.
- Dòng mẫu: "Created At: 4 hours ago" cạnh "Delay 4 hours". Hai số trùng nhau gợi ý "Delay" = **tuổi lô** (now − createdAt) chứ chưa chắc là hạn hẹn. Cần xác nhận: có mốc hẹn riêng không? Đừng thiết kế SLA lô khi chưa chắc.
- Tên lô do người đặt ("1-10 thai nguyen" = ngày-tháng + xưởng).

## 2. Chưa biết — quyết định BỔ SUNG hay XÂY MỚI

Cần xác nhận với xưởng / màn hình thật, không suy được từ tài liệu:

1. Xưởng có in phiếu cắt/may theo lô ("Download Print") không, hay lô chỉ để đếm tiến độ?
2. Lô có dùng làm đơn vị giao việc (giao cả lô cho 1 người) không?
3. Một đơn có thể vào nhiều lô không (tách item)? Item rework có chuyển lô không?
4. Số lô đang `Producting` cùng lúc / lô có sống qua nhiều ngày không?

5. (Từ §1b) "Delay" là tuổi lô hay hạn hẹn? 4 nút icon trên mỗi dòng làm gì (nghi: sửa, in barcode, xuất, xóa)? Ready vs Reproduction khác nhau thế nào?

**Điều kiện chuyển mức:** mặc định mức nhẹ (§3). Chuyển sang mức đầy đủ (§4) nếu BẤT KỲ điều nào đúng: xưởng in phiếu cắt/may theo lô; giao việc theo lô; "Delay" là hạn hẹn thật cần cảnh báo/ghi nhận. Chỉ báo "lô cũ chưa xong" (tuổi lô) thì mức nhẹ làm được bằng trường suy ra, không cần đổi mô hình.

Câu 1, 2, 3, 5 chỉ người ở xưởng trả lời được (không tra từ ngoài, và đụng lô thật là đụng dữ liệu production).

## 3. Mức nhẹ — BỔ SUNG (đề xuất mặc định)

Lô là **nhãn gom nhóm + tiến độ suy ra**, KHÔNG phải một bước của luồng.

- Collection mới `production_batches`: `code` (`BA-yymm-n`, cấp tuần tự theo xưởng/tháng), `name`, `factoryId`, `createdAt`, `createdBy`, `heldAt?`/`cancelledAt?` (2 trạng thái duy nhất đặt tay).
- `OrderEntity.batchId?: ObjectId` + index `{ batchId: 1 }`. Một đơn thuộc tối đa 1 lô. Đơn đã nằm trong lô mà bị rework vẫn ở lại lô.
- Chỉ đơn `readyForFulfill` và cùng xưởng mới được thêm vào lô. Thêm/gỡ ghi `order_log` (`batch_add`/`batch_remove`).
- **Tiến độ và trạng thái là SUY RA khi đọc** (aggregation trên `fulfillmentStages` của các đơn trong lô), không lưu:
  - `Producting` = còn đơn chưa xong; `Completed` = mọi đơn `fulfillmentCompletedAt`; chỉ `On Hold`/`Cancelled` đặt tay.
  - `Ready`/`Error`/`Reproduction` của hệ cũ: `Error`/`Reproduction` suy ra từ có đơn đang `rework`; `Ready` bỏ (chưa rõ nghĩa — xem §2).
- **Vòng đời nhiều ngày:** lô mở nhiều ngày (42 lô cùng lúc/xưởng) nên danh sách lô mặc định lọc theo trạng thái + khoảng ngày như hệ cũ (All Time/Today/Yesterday/Last 7 Days), cần index `{ factoryId: 1, createdAt: -1 }`. Aggregation tiến độ chạy theo TỪNG lô trong trang đang xem (không quét cả 42 lô mỗi lần) — dùng `$lookup`/`$group` theo `batchId` giới hạn bởi trang. Tuổi lô = `now − createdAt` suy ra khi đọc.
- Barcode lô Code128 `B-<code>` (cùng khuôn `N-`/`E-` ở `scanCodes.ts`); in bằng `BarcodeLabelPrint` khổ sẵn có.
- Màn hình: tab "Lô" trong trang xưởng: tạo lô từ các đơn đã tick (khuôn `BulkEditToolbar`), danh sách lô + thanh tiến độ theo công đoạn, in tem lô.

### Vì sao KHÔNG đụng `resolveTransition` / `flowType`

Lô không phải một công đoạn nên không có cạnh trong đồ thị chuyển trạng thái. Hậu quả:

- `merged` / `no-sew` / `press-complete`: auto-stage đã ghi `status='done'` đủ timestamp, nên đếm tiến độ theo `fulfillmentStages.<stage>.status` vẫn đúng. Không có code lô nào chạy trong vòng `while` auto-stage.
- Ở xưởng DTF (`press-complete`) tiến độ lô thực chất chỉ 2 chặng thật (In, Ép); 4 chặng còn lại hiện Done tức thì. Tiến độ phải **bỏ các chặng nằm trong `FACTORY_FLOW_AUTO_STAGES` của xưởng** khi hiển thị, nếu không "0/49/76" sẽ luôn 100% giả ở 4 cột. Dùng `isAutoStage(flow, stage, autoPack)` sẵn có.
- Rework-back về công đoạn trước hay về designer không đổi `batchId`. Đơn bị đẩy về designer vẫn nằm trong lô (lô "Producting" đến khi xong) — cần kiểm xem xưởng có muốn tự gỡ khỏi lô không (§2 câu 3).
- Hold/cancel đơn (`heldAt`/`cancelledAt`) không đổi lô; tiến độ lô loại đơn hủy ra khỏi mẫu số (cùng bộ lọc chuẩn: hủy / chưa map xưởng / xưởng US).

## 4. Mức đầy đủ — XÂY MỚI (chỉ khi §2 câu 1–2 là CÓ)

Thêm trên mức nhẹ:

- Phiếu in theo lô ("Download Print"): tái dùng `cuttingFileUrl` + gom file in theo lô (cần quyết dạng: 1 PDF gộp / zip).
- Giao việc theo lô: `assignee` ở cấp lô → ảnh hưởng `getMyTasks` của công nhân và quy tắc "1 user / (xưởng, công đoạn)". Đây mới là phần đụng vào thứ đang chạy; chỉ làm sau khi có số liệu thật.
- Trạng thái lưu thật + guard chuyển trạng thái.

## 5. Phạm vi / công sức (ước, mức nhẹ)

- BE: entity + repository + service (create/add/remove/list/progress aggregation/hold/cancel) + endpoints + `order_log` action + DTO shared. Cỡ 2–3 ngày kèm test aggregation.
- FE: tab Lô + dialog tạo/thêm + tem barcode lô + quét `B-<code>` ở trạm quét (xem `ScanError.md`, cần quyết quét lô làm gì: chỉ mở lô?). Cỡ 2–3 ngày.
- Migration: đơn cũ không có `batchId`, không backfill. Import hệ cũ có thể ghi `onospodBatchId` (chuỗi) để đối chiếu lô cũ — tuỳ chọn, `batch_id` đã được query sẵn.

## 6. Rủi ro / việc kiểm trước khi code

- `OrderEntity.batchId` thêm field → nhớ `Common_Pitfalls.md` (projection) và agent registry `orders.registry.ts`.
- Cron/Telegram báo cáo không phụ thuộc lô; không cần sửa.
- Chưa xác nhận bằng màn hình thật: số lô đang chạy, ý nghĩa `Ready`/`Reproduction`, "Download Print". Cần đọc `/manufactures/<id>/mrp_batch` (chỉ cấu trúc, không cần dữ liệu thật).
