# Từ điển dữ liệu cho AI agent

> Bảng nào dùng để trả lời câu hỏi gì, trường nào nghĩa là gì, và tra thế nào.
>
> Bốn file đi kèm, đọc đủ cả năm thì mới trả lời khách được:
>
> - [`ImportantNotes.md`](ImportantNotes.md) — **không có nó thì mọi con số bạn đếm ra đều có nguy cơ sai**
> - [`ValueSemantics.md`](ValueSemantics.md) — mỗi giá trị nghĩa là gì **với khách**, và nói câu nào
> - [`HowToFilter.md`](HowToFilter.md) — **cách viết điều kiện lọc**, kèm ví dụ chạy được cho câu hỏi thật
> - [`WhatYouCannotSee.md`](WhatYouCannotSee.md) — bốn trường không đọc được, và thứ đọc được nhưng **không nói được**

---

## 0. Cách gọi

Ba năng lực, dưới `/api/v1/agent`, đều cần header `X-Agent-Api-Key`:

| Gọi gì | Dùng khi |
|---|---|
| `GET /agent/tables` | Xem có những bảng nào và **chính sách từng trường**. Trả về **MỌI collection**; bảng có `fields: []` là bảng chưa ai mô tả — vẫn đọc được đầy đủ, chỉ cần đọc thử `?limit=1` để biết cấu trúc |
| `GET /agent/tables/:table/rows?limit=&cursor=` | Đọc thô, phân trang theo con trỏ |
| `POST /agent/query` | Lọc, sắp xếp, đếm, nhóm, tổng hợp — **dùng cái này là chính** |
| `GET /agent/docs` · `GET /agent/docs/:slug` | Danh mục tài liệu và nội dung từng file |

Hình dạng của `POST /agent/query`:

```jsonc
{
  "table": "orders",
  "filter": { "userSku": "ABC" },
  "select":    { "fields": ["productionId", "currentFulfillmentStage"], "sort": [{ "field": "inProductionAt", "dir": "desc" }], "limit": 20 },
  "aggregate": { "groupBy": ["currentFulfillmentStage"], "metrics": [{ "op": "count", "as": "n" }] }
}
```

`select` và `aggregate` **loại trừ nhau**. Metric: `count · sum · avg · min · max`.

Điều kiện lọc dùng **cú pháp MongoDB** — cách viết đầy đủ, danh sách toán tử và các lỗi thường gặp ở
[`HowToFilter.md`](HowToFilter.md). Đọc file đó trước khi viết lời gọi đầu tiên.

Không truyền `fields` thì trả **nguyên bản ghi** — đó là cách duy nhất xem được trường của bảng chưa ai mô tả.

Lô mặc định 50 dòng, trần 200 — xin nhiều hơn thì bị kẹp xuống trần và `meta.limitApplied` cho biết mức thực tế.

**Luôn đọc `meta.hasMore` trước khi kết luận.** Trần lô bị kẹp im lặng: gửi `limit: 500` vẫn trả 200 dòng, `success: true`, không lỗi. `hasMore: true` nghĩa là dữ liệu đang cắt dở — phải lấy tiếp (`select.offset`, hoặc `cursor` ở `read_rows`) rồi mới kết luận. Suy từ `returned === limitApplied` là sai ở lô cuối vừa khít trần: `hasMore` đo bằng cách đọc dư một dòng nên nói đúng cả trường hợp đó.

Cần tổng số dòng khớp bộ lọc thì xin `select.withTotal: true` → `meta.total`. Mặc định TẮT vì mỗi lần đếm là một lần quét thêm; phần lớn trường hợp `hasMore` đã đủ.

> Đây không phải tình huống giả định: 16/09/2026 một đợt đọc `zalo_group_links` bị cắt ở dòng 200, 22 nhóm nằm ngoài trang đầu bị hiểu thành "không có link", và kết luận sai suýt được đẩy sang đội khác. Mất nửa ngày điều tra một vấn đề không tồn tại.

**Bề mặt dữ liệu hiện tại: mọi bảng, mọi trường, lọc/sắp xếp/nhóm được hết.** Đúng sáu tên bị chặn ở
mọi bảng: `password`, `passwordSource`, `ip`, `userAgent`, `apiKeys`, `secret`. Mười một bảng dưới đây là những bảng **có
mô tả nghiệp vụ** — đọc chúng để hiểu nghiệp vụ; các bảng khác đọc được nhưng bạn phải tự suy cấu trúc.

⚠️ **Đọc được không có nghĩa là nói được.** Tiền nội bộ, tên nhân viên, bảng cấu hình nội bộ đều đọc
được nhưng **không** đọc cho khách. Đọc [`WhatYouCannotSee.md`](WhatYouCannotSee.md) §1b **trước khi**
dùng bất kỳ trường nào mới mở.

**Hạn mức: 600 lời gọi mỗi phút.** Vượt thì nhận HTTP 429 và phải chờ hết phút đó. Con số này đủ rộng
cho một cuộc trò chuyện bình thường; nếu bạn chạm trần thì gần như chắc chắn là đang gọi lặp vô ích —
hãy xem lại vòng lặp của mình thay vì thử lại ngay.

---

## 1. `orders` — đơn sản xuất

**Bảng chính.** Gần như mọi câu hỏi "đơn của tôi thế nào" đều bắt đầu ở đây.

| Trường | Nghĩa |
|---|---|
| `productionId` | Mã đơn khách dùng để tra — **khoá tra chính** |
| `userSku` | Mã tài khoản khách; nối sang `customers.userSku` |
| `userEmail` | Email khách — đọc/lọc/nhóm được đầy đủ |
| `type` | Tên sản phẩm dạng chữ, khớp `productConfigs.fullName` |
| `color`, `size`, `quantity`, `printMethod` | Thuộc tính đơn |
| `status` | Trạng thái từ hệ thống nguồn — **không** phải trạng thái sản xuất |
| `designerStatus` | `unassigned` · `assigned` · `in-progress` · `done` · `rejected` · `rework` — nghĩa từng giá trị ở [`ValueSemantics.md`](ValueSemantics.md) §2 |
| `currentFulfillmentStage` | Công đoạn xưởng hiện tại; **rỗng có hai nghĩa** — xem `ImportantNotes.md` §3 |
| `fulfillmentCompletedAt` | Có giá trị = đã xong Đóng hàng |
| `cancelledAt` / `cancelReason` | Có giá trị = **đã hủy**, bị loại khỏi mọi thống kê |
| `heldAt` / `holdReason` | Có giá trị = **đang bị giữ**, không chạy tiếp |
| `factoryId` | Xưởng; **rỗng = chưa gán xưởng**, bị loại mặc định |
| `inProductionAt` | Ngày vào sản xuất — trục thời gian của hầu hết thống kê |
| `toolResult`, `productionError`, `errorFile` | **Mã**, tra nghĩa ở `workshopConfigs` |
| `*Note` | Ghi chú gõ tay — đọc **nguyên văn** và nay lọc được. Xem [`WhatYouCannotSee.md`](WhatYouCannotSee.md) §2 trước khi đọc lại cho khách |
| `priority` | Mức ưu tiên |
| `assignee` | Người được giao thiết kế (`users._id`) — nhóm theo nó là ra **sản lượng theo từng designer**. KHÔNG nói tên người cho khách |
| `designerAssignedAt` · `designerStartedAt` · `designerCompletedAt` · `designerReworkAt` | Mốc thời gian khâu thiết kế |
| `shippingAddress` | Khối địa chỉ giao, trả nguyên khối |
| `fulfillmentStages` · `fulfillmentTimeline` | Chi tiết từng công đoạn xưởng và nhật ký chuyển chặng |
| `baseCost` · `shipCost` | **Tiền nội bộ.** Đọc được, **không bao giờ** nói cho khách |

**Không có ở đây:** địa chỉ giao, tiền, tên người xử lý. Xem `ImportantNotes.md` §2.

### Ví dụ

**"Đơn XQ-91783-27005 của tôi đang ở đâu?"**

```jsonc
{ "table": "orders",
  "filter": { "productionId": "XQ-91783-27005" },
  "select": { "fields": ["productionId","status","designerStatus","currentFulfillmentStage",
                         "fulfillmentCompletedAt","heldAt","holdReason","cancelledAt","factoryId"] } }
```

Đọc kết quả theo thứ tự: `cancelledAt` có giá trị → đơn đã hủy. `heldAt` có giá trị → đang bị giữ, nói lý do. `fulfillmentCompletedAt` có giá trị → đã xong. Còn lại → nói công đoạn hiện tại.

**"Tôi còn bao nhiêu đơn chưa xong?"**

```jsonc
{ "table": "orders",
  "filter": { "$and": [
    { "userSku": "ABC" },
    { "cancelledAt": { "$exists": false } },
    { "factoryId": { "$exists": true } },
    { "fulfillmentCompletedAt": { "$exists": false } } ] },
  "aggregate": { "groupBy": ["currentFulfillmentStage"], "metrics": [{ "op": "count", "as": "n" }] } }
```

---

## 2. `orderLogs` — nhật ký thao tác trên đơn

Dùng để kể lại **đơn đã đi qua những chặng nào, lúc nào, ai làm**.

| Trường | Nghĩa |
|---|---|
| `orderId` | Trỏ tới `orders._id` |
| `action` | Loại thao tác: `import`, `update`, `hold`, `unhold`, ... |
| `field` | Tên trường bị đổi |
| `before` / `after` | Giá trị cũ/mới — **nguyên văn**, mọi trường, kể cả giá trị dạng khối |
| `userId` / `userName` / `roleCode` | Người thực hiện thao tác. Nhóm theo `userId` là ra sản lượng theo người. KHÔNG nói tên cho khách |
| `impersonatorId` / `impersonatorName` | Người đăng nhập thay, nếu có |

**"Đơn tôi có bị làm lại lần nào không?"**

```jsonc
{ "table": "orderLogs",
  "filter": { "$and": [ { "orderId": "<orders._id>" },
                        { "field": { "$in": ["productionError","toolResult","printStatus"] } } ] },
  "select": { "sort": [{ "field": "createdAt", "dir": "asc" }], "limit": 50 } }
```

---

## 3. `customers` — tài khoản khách

`userSku`, `fullName`, `userEmail`, `phone`, `tier`, `status` đều đọc và lọc được đầy đủ. Chỉ `password`
và `passwordSource` bị chặn.

**"Tôi là ai trong hệ thống?"** — có email từ cuộc trò chuyện:

```jsonc
{ "table": "customers",
  "filter": { "userEmail": "khach@example.com" },
  "select": { "fields": ["_id","userSku","fullName","tier","status"] } }
```

Lấy `userSku` rồi dùng nó để tra đơn ở bảng `orders`.

---

## 4. `productConfigs` — sản phẩm và biến thể

| Trường | Nghĩa |
|---|---|
| `fullName` | Tên sản phẩm, khớp `orders.type` |
| `printArea` | Danh sách mã vị trí in |
| `printDocument` | URL tài liệu hướng dẫn design/template của sản phẩm |
| `printTemplate` | URL template thiết kế chung của sản phẩm |
| `maxProductionTime` / `maxShippingTime` | Cam kết sản xuất / giao (ngày) |
| `usImportTaxPerUnit` | Thuế nhập khẩu US mỗi đơn vị (USD) — con số **công bố với khách** trên trang catalog, không phải giá vốn |
| `variations.sku` / `variations.attributes` | Biến thể |
| `variations.retailPrice` | **Giá niêm yết — con số duy nhất được nói cho khách** |
| `variations.cost` · `wholesalePrice` · `nonShipCost` · `tiktokPrice` · `expUsShipCost` · `tiktokShipCost` | **Giá nội bộ.** Đọc và tổng hợp được, **TUYỆT ĐỐI KHÔNG** nói cho khách |

**"Sản phẩm Hoodie có những size nào, giá bao nhiêu?"**

```jsonc
{ "table": "productConfigs",
  "filter": { "fullName": { "$startsWith": "Hoodie" } },
  "select": { "fields": ["fullName","variations.sku","variations.attributes","variations.retailPrice"] } }
```

---

## 5. `workshopConfigs` — bảng tra nghĩa các mã

**Bảng quan trọng thứ hai sau `orders`.** Mọi mã trên đơn đều dịch ở đây.

| Trường | Nghĩa |
|---|---|
| `category` | Nhóm mã: `production_error`, `error_file_type`, `fabric_type`, `machine`, ... |
| `code` | Mã lưu trên đơn |
| `name` | Tên đọc được |
| `errorSource` | Nguồn lỗi: `designer` · `factory` · `tool-check` |
| `stage` | Công đoạn gắn với mã lỗi |

**"Đơn tôi lỗi gì?"** — lấy `orders.productionError` rồi tra:

```jsonc
{ "table": "workshopConfigs",
  "filter": { "category": "production_error", "code": "<mã lấy từ đơn>" },
  "select": { "fields": ["code","name","errorSource","stage"] } }
```

---

## 6. `factories` và `machineTypes` — xưởng và loại máy

Ba trường: `name`, `shortName`, `isActive`. Dùng để dịch `orders.factoryId` sang tên xưởng.

**Luôn cần trước khi thống kê:** lấy `_id` của xưởng `shortName = "US"` để loại ra (xem `ImportantNotes.md` §1.3).

```jsonc
{ "table": "factories", "select": { "fields": ["_id","name","shortName","isActive"] } }
```

---

## 7. `promotions` — chương trình giảm giá

`name`, `code`, `discountType`, `discountValue`, `scope`, `applicableTiers`, `minQuantity`, `startDate`, `endDate`, `status`.

**"Tôi có ưu đãi nào không?"** — lấy `tier` của khách ở `customers` rồi:

```jsonc
{ "table": "promotions",
  "filter": { "status": "Active", "applicableTiers": { "$in": [2] } },
  "select": { "fields": ["name","discountType","discountValue","scope","startDate","endDate"] } }
```

Đây là **giá tham khảo**. Chương trình khuyến mãi chưa được tích hợp vào bước thanh toán, nên đừng cam kết số tiền cuối cùng với khách.

---

## 8. `productCategories` và `collections` — nhóm và bộ sưu tập sản phẩm

Bảng tra nghĩa cho `productConfigs.productCategoryId` và `productConfigs.collectionIds`. Trường: `name`, `shortName`, `isActive` (và `parentId` với danh mục, `description`/`sortOrder` với bộ sưu tập).

---

## 9. `customer_notifications` — thông báo đã gửi cho khách

`title`, `body`, `customerId` (rỗng = gửi cho tất cả khách), `createdAt`. Không kèm tên nhân viên đã gửi.

**"Hệ thống có báo gì cho tôi không?"**

```jsonc
{ "table": "customer_notifications",
  "filter": { "$or": [ { "customerId": "<customers._id>" },
                       { "customerId": { "$exists": false } } ] },
  "select": { "sort": [{ "field": "createdAt", "dir": "desc" }], "limit": 10 } }
```

---

## 9b. Sản lượng theo từng người, và các bảng chưa có mô tả

**"Mỗi designer làm bao nhiêu đơn, đang làm tới đâu?"** — nhóm theo `assignee`, nhớ ba điều kiện loại
trừ ngầm của [`ImportantNotes.md`](ImportantNotes.md) §1:

```jsonc
{ "table": "orders",
  "filter": { "$and": [ { "cancelledAt": { "$exists": false } },
                        { "factoryId":  { "$exists": true  } },
                        { "factoryId":  { "$nin": ["<_id xưởng US>"] } },
                        { "inProductionAt": { "$gte": "2026-08-01T00:00:00Z" } } ] },
  "aggregate": { "groupBy": ["assignee", "designerStatus"],
                 "metrics": [{ "op": "count", "as": "n" }],
                 "sort": [{ "field": "n", "dir": "desc" }] } }
```

`assignee` là `users._id`. Muốn ra **tên** thì đọc bảng `users` (bảng chưa có mô tả, nhưng đọc được):

```jsonc
{ "table": "users", "filter": { "_id": { "$in": ["<id1>", "<id2>"] } },
  "select": { "fields": ["_id", "fullName", "roleCode"], "limit": 50 } }
```

**Không có bucket theo ngày.** `groupBy` nhóm theo giá trị thô, nên nhóm theo một trường ngày sẽ ra mỗi
mốc mili giây một nhóm. Muốn chuỗi theo ngày thì gọi nhiều lần, mỗi ngày một khoảng `$gte`/`$lt`.

**Bảng chưa có mô tả** (`users`, `system_configs`, các bảng cấu hình…) đọc được như mọi bảng khác,
nhưng `GET /agent/tables` trả `fields: []` cho chúng. Cách khám phá: `GET /agent/tables/<tên>/rows?limit=1`
rồi nhìn khoá của bản ghi. Con số lấy từ những bảng này là dữ liệu **vận hành nội bộ** — dùng để hiểu
hệ thống, không phải để đọc cho khách.

---

## 10. Sơ đồ nối bảng

```
customers.userSku ──────────► orders.userSku
orders.factoryId ───────────► factories._id
orders.machineTypeId ───────► machineTypes._id
orders.productConfigId ─────► productConfigs._id
orders.type ────────────────► productConfigs.fullName      (nối theo TÊN)
orders.productionError ─────► workshopConfigs.code         (category='production_error')
orders.toolResult ──────────► workshopConfigs.code
orders.errorFile ───────────► workshopConfigs.code
orders._id ─────────────────► orderLogs.orderId
productConfigs.productCategoryId ► productCategories._id
productConfigs.collectionIds ──► collections._id
customers._id ──────────────► customer_notifications.customerId
```

API **không tự nối bảng** — bạn gọi lần lượt rồi ghép ở phía mình. Mỗi lời gọi chỉ chạm một bảng.

Ngoài mười một bảng trên, mọi collection khác cũng đọc được (ví dụ `users` để đổi `assignee` thành tên
người) — xem §9b.
