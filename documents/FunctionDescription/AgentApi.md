# Agent API — Function Description

> **File BE:** `apps/api/src/modules/agent-api/` (controller, guard, repository, 4 service, registry 5 file)
> **File FE:** không có — bên tiêu thụ là AI agent nội bộ, không phải trình duyệt
> **Shared:** `packages/shared/dtos/agent-api.dto.ts`
> **Tài liệu cho agent:** toàn bộ `documents/AgentGuide/` — và CHỈ thư mục đó (`API-13`)
> **API:** `/api/v1/agent/*`
> **Nguồn yêu cầu:** task `API-1` — SRS `.devtasks/srs/API-1.md`, thiết kế `.devtasks/design/API-1.md`. **Mở hết bề mặt ở `API-19`.**

## 1. Overview

Bộ API phục vụ một AI agent nội bộ trả lời khách hàng qua tin nhắn. Agent cần hai thứ: **hiểu nghiệp vụ** (đọc tài liệu) và **tra được dữ liệu thực** (đọc đơn của khách).

**Chỉ đọc, trừ đúng một đường.** `POST /v1/agent/zalo/send` (§3.3) là thao tác GHI duy nhất — gửi tin vào nhóm Zalo **nội bộ/vận hành**, CẤM tuyệt đối nhóm khách hàng. Nó tách hẳn khỏi `AgentApiRepository` để phần đọc vẫn giữ nguyên bất biến BR-3.

### ⚠️ `API-19` — nguyên tắc đã ĐẢO CHIỀU

Tới `API-18`, thiết kế xoay quanh *"danh sách trắng ở tầng trường, cấm là mặc định"*. Người dùng đã chốt bỏ vế đó. Nguyên tắc hiện hành:

> **Mở là mặc định. Mọi collection, mọi trường — trừ đúng sáu tên.**

| | Trước `API-19` | Sau `API-19` |
|---|---|---|
| Bảng đọc được | 11 bảng trong registry | **mọi collection** trong DB, kể cả bảng thêm sau này |
| Trường đọc được | chỉ trường khai trong registry | **mọi trường**, kể cả trường chưa ai mô tả |
| Lọc / sắp xếp / nhóm | theo `filter`/`sortable`/`groupable` từng trường | **mở hết** |
| Tiền | 8 trường bị che | đọc được (kể cả giá vốn, biên lợi nhuận) |
| Giá trị cũ/mới của nhật ký | lọc qua danh sách trắng tên trường | nguyên văn |
| Còn bị chặn | 12 tên | **6 tên**: `password`, `passwordSource`, `ip`, `userAgent`, `apiKeys`, `secret` (2 tên cuối thêm ở ORD-4) |

**Hệ quả phải biết, không phải điều bất ngờ:**

- Agent đọc được **giá vốn và biên lợi nhuận**. API không còn chặn hộ việc nói con số đó cho khách — chỗ chặn duy nhất còn lại là chính lời nhắc của agent (`documents/AgentGuide/WhatYouCannotSee.md`).
- Agent đọc được **danh tính nhân viên** ở mọi bảng, và nhóm được theo nó — đây chính là năng lực "sản lượng theo từng designer" mà `API-17` còn chặn.
- Agent **quét ngược được** từ một mảnh email/điện thoại ra khách nào, vì mức lọc mở hoàn toàn.
- Agent đọc được **mọi collection nội bộ** — `users`, `system_configs`, nhật ký nội bộ… Bốn tên bị chặn áp ở **mọi bảng, mọi độ sâu**, nên hash mật khẩu và dấu vết phiên vẫn không ra.

Ba thứ **không** đổi ở `API-19`: chỉ đọc (BR-3), danh sách trắng **toán tử** lọc, và các hạn mức tải (trần lô, `maxTimeMS`, độ sâu điều kiện, đọc trên secondary).

## 2. Luồng hoạt động

```
Agent  ──[X-Agent-Api-Key]──►  AgentApiKeyGuard          401 nếu thiếu/sai/rỗng, thân lỗi GIỐNG HỆT NHAU
                                     │
                                     ▼
                               AgentApiController         log Winston, đo thời gian
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              AgentReadService  AgentQueryService  AgentDocsService
                    │                │                │
                    └──── registry ──┘                │  danh mục dựng 1 lần lúc boot
                              │                       │
                              ▼                       ▼
                      AgentApiRepository        đọc file .md
                       (find / aggregate)
                              │
                              ▼
                     stripDeniedDeep (6 tên bị chặn, mọi độ sâu)
                              │
                              ▼
                        AgentAuditService  → collection `agentApiLogs`
```

Guard chạy **trước** mọi validate tham số. Nếu làm ngược lại, một lời gọi thiếu khoá tới bảng sai sẽ nhận 400 thay vì 401, và chính sự khác biệt đó xác nhận cho người dò biết bảng nào tồn tại.

## 3. API / Schema

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/v1/agent/tables` | Liệt kê **mọi collection** (`API-19`), kèm mô tả bảng và **chính sách đầy đủ từng trường** (`API-18`) — xem §3.1 |
| `GET` | `/v1/agent/tables/:table/rows` | Đọc thô, phân trang theo con trỏ trên `_id`. Query: `limit`, `cursor`, `fields`, `filter` (`API-6`) |
| `POST` | `/v1/agent/query` | Truy vấn có kiểm soát: lọc, sắp xếp, đếm, nhóm, tổng hợp |
| `GET` | `/v1/agent/seller-support` | Gộp sẵn một seller: tóm tắt nhóm Zalo + số đơn sống + sản phẩm hay đặt (`ZaloGroupMapping.md`) |
| `GET` | `/v1/agent/ceo-overview` | Bảng số CEO Dashboard một kỳ |
| `GET` | `/v1/agent/ceo-report` | Nhận định tiếng Việt hệ thống tự sinh cho kỳ đó |
| `GET` | `/v1/agent/ceo-report/chart.png` | Ảnh biểu đồ dựng sẵn ở server — agent **không tự vẽ** |
| `GET` | `/v1/agent/customer-report` | Báo cáo khách: tụt sâu / tăng mạnh / VIP (`AgentGuide/CustomerReport.md`) |
| **`POST`** | **`/v1/agent/zalo/send`** | **GHI — gửi tin vào nhóm Zalo nội bộ/vận hành. Xem §3.3** |
| `GET` | `/v1/agent/zalo/groups/:groupGlobalId/messages` | Đọc tin của một nhóm nội bộ/vận hành. Xem §3.4 |
| `GET` | `/v1/agent/zalo/inbox` | Sự kiện đã lọc, từ một con trỏ. Xem §3.4 |
| `GET` | `/v1/agent/zalo/dm/:conversationId/messages` | Đọc hội thoại riêng. Chốt theo VAI người kia — §3.5 |
| `GET` | `/v1/agent/docs` | Danh mục tài liệu nghiệp vụ |
| `GET` | `/v1/agent/docs/:slug` | Nội dung markdown của một tài liệu |

Tất cả yêu cầu header `X-Agent-Api-Key`, khớp env `AGENT_API_KEY`.

**`filter` trên endpoint đọc bảng** (`API-6`) là điều kiện **dạng chuỗi JSON** — `GET` không có thân
yêu cầu nên nó phải đi qua query string. Nó **dùng lại đúng** bộ dịch của `POST /query`, không có bộ
luật thứ hai: hai đường lọc với hai bộ luật là cách chắc chắn để một ngày chúng lệch nhau, và đường
lỏng hơn sẽ thành lỗ hổng. Cơ chế chính sách trường vẫn còn trong mã (`filter: 'none'` / `'eq'`) nhưng sau `API-19` **không
trường nào còn ở hai mức đó** — nó là đường lui nếu có change request siết lại, và có unit test canh.

JSON hỏng hoặc toán tử ngoài danh sách trắng trả `400 INVALID_QUERY` chứ không rơi vào 422 của tầng
validate: bảng mã lỗi là hợp đồng với agent. Sau `API-19`, `TABLE_NOT_ALLOWED` chỉ còn nghĩa **tên
collection không hợp lệ** (rỗng, quá dài, có ký tự lạ) — không còn bảng nào bị cấm vì chính sách. Điều kiện của bên gọi và con trỏ phân trang ghép bằng `$and`, không trộn
nông — điều kiện chạm `_id` mà đè mất con trỏ thì trang sau sẽ lặp lại trang trước.

### DSL truy vấn

```ts
{
  table: string;
  filter?: object;                       // cú pháp MongoDB, sâu tối đa 5 mức
  select?: { kind: 'rows'; fields?: string[]; sort?: AgentSort[]; limit?: number; offset?: number };
  aggregate?: { groupBy?: string[]; metrics: AgentMetric[]; sort?: AgentSort[]; limit?: number };
}
```

`select` và `aggregate` loại trừ nhau. Metric: `count · sum · avg · min · max`.

**Điều kiện lọc dùng cú pháp MongoDB** (`API-8` thay hẳn DSL cây `{field, op, value}` cũ — cú pháp cũ nay bị từ chối kèm thông điệp chỉ sang dạng mới, không im lặng trả kết quả sai). Ba dạng:

```jsonc
{ "status": "active" }                          // rút gọn, ngầm hiểu $eq
{ "productionId": { "$eq": "SQ-01964-03971" } } // một toán tử
{ "quantity": { "$gte": 1, "$lte": 9 } }        // nhiều toán tử trên cùng trường
```

Danh sách trắng toán tử — **ngoài bảng này là bị từ chối**:

| Nhóm | Toán tử |
|---|---|
| So sánh | `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` |
| Tập hợp | `$in` `$nin` (mảng nguyên thuỷ, không rỗng) |
| Tồn tại | `$exists` (boolean) |
| Ghép | `$and` `$or` `$nor` `$not` |
| Tiền tố | `$startsWith` — xem dưới |

Không có `$between` (MongoDB không có); khoảng giá trị viết bằng dạng nhiều toán tử. Mất cú pháp, **không** mất năng lực.

**`$startsWith` là tên không tồn tại trong MongoDB, và đó là chủ ý.** Bên gọi truyền **chuỗi thường**; server escape rồi tự neo `^`, nên không có đường nào để một mẫu biểu thức đi vào và không có ReDoS. `$regex` bị từ chối như mọi toán tử ngoài danh sách trắng. Vì sao không mượn luôn tên `$regex` cho năng lực này: một toán tử mang tên chuẩn MongoDB nhưng ngữ nghĩa khác là **bẫy im lặng** — agent quen Mongo sẽ gửi `".*abc.*"` rồi nhận kết quả rỗng mà không hiểu vì sao. Tên lạ buộc nó tra tài liệu.

**Mức lọc sau `API-19`: `full` ở mọi trường.** Bộ kiểm mức lọc vẫn chạy nhưng không còn trường nào bị siết, nên `{ "userEmail": { "$startsWith": "a" } }` nay qua được. Chỉ sáu tên bị chặn là hỏng, ở mọi dạng cú pháp và mọi độ sâu của cây điều kiện.

**Trường chưa ai mô tả cũng lọc được.** Nó nhận `OPEN_POLICY` với `type: 'any'`, nên phép ép ngày chuyển sang phỏng đoán theo mẫu: chuỗi ISO đầy đủ (`2026-08-01T00:00:00Z`) thành `Date`, chuỗi ngày trần (`2026-08-01`) giữ nguyên là chuỗi. Trường **có** mô tả `type: 'date'` vẫn ép chắc chắn như trước.

**Không nhận pipeline aggregation thô.** Lý do: tên trường đầu ra khi đó do chính bên gọi đặt (`$project { x: "$shippingAddress.email" }`), nên không có cách nào lọc đầu ra theo tên trường.

### Chính sách trường

```ts
type AgentFieldPolicy = {
  type: 'string' | 'number' | 'date' | 'bool' | 'objectId' | 'enum' | 'object' | 'any';
  //   'object' (`API-17`): trường là KHỐI, trả nguyên khối
  //   'any'    (`API-19`): CHƯA BIẾT kiểu — trường không có mô tả
  read: boolean;
  filter: 'none' | 'eq' | 'full';     // sau `API-19` luôn là 'full'; hai mức kia là đường lui
  sortable: boolean;                  // sau `API-19` luôn true
  groupable: boolean;                 // sau `API-19` luôn true
  aggregatable?: boolean;
  freeText?: boolean;                 // nhãn MÔ TẢ: nội dung là câu chữ gõ tay, không còn ràng buộc quyền
};
```

Trường **không** có trong `fields` nhận `OPEN_POLICY` (`type: 'any'`, mở đủ quyền) thay vì bị từ chối — đó là toàn bộ khác biệt của `API-19` ở tầng này.

### Collection mới — `agentApiLogs`

```ts
{ at: Date; capability: string; table?: string; docSlug?: string;
  queryDigest?: unknown; returned: number; durationMs: number;
  outcome: 'ok' | 'denied' | 'error' | 'timeout'; errorCode?: string }
```

Index `{ at: -1 }` cộng TTL 90 ngày, tạo ở `AgentAuditService.onModuleInit()`. Collection này **nằm ngoài registry** nên agent không đọc được nhật ký của chính nó.

### Mã lỗi

| HTTP | `code` | Khi nào |
|---|---|---|
| 401 | `UNAUTHORIZED` | Thiếu / sai / rỗng khoá. Thân lỗi giống hệt nhau ở cả 5 endpoint |
| 403 | `TABLE_NOT_ALLOWED` | Bảng ngoài registry. Dùng chung thân lỗi cho bảng cấm và bảng không tồn tại |
| 400 | `FIELD_NOT_ALLOWED` | Trường không đọc/lọc/nhóm/sắp xếp được |
| 400 | `WRITE_NOT_SUPPORTED` | Truy vấn mang ý ghi |
| 400 | `INVALID_QUERY` | Toán tử ngoài danh sách trắng (kể cả nhóm cấm), giá trị không phải nguyên thuỷ, cây quá sâu, JSON hỏng, hoặc **cú pháp lọc CŨ** |
| 408 | `QUERY_TIMEOUT` | Vượt `maxTimeMS` |
| 404 | `DOC_NOT_FOUND` | Slug không có; trả kèm danh mục đang có |
| 503 | `DOCS_UNAVAILABLE` | Không tìm thấy thư mục tài liệu lúc boot |

Thân lỗi: `{ statusCode, success: false, code, message }`, cộng `available` (danh sách slug đang có) ở
riêng `DOC_NOT_FOUND`, cộng `stackTrace` khi chạy môi trường dev.

**`code` tới được bên gọi là nhờ một bộ lọc RIÊNG** (`agent-exception.filter.ts`) gắn vào
`AgentApiController` — `CustomExceptionFilter` dùng chung của repo **dựng lại thân phản hồi từ đầu**
với đúng bốn khoá `statusCode/success/message/stackTrace`, nên mọi trường module ném kèm đều bị vứt
trong im lặng (`QA-2`). Sửa filter chung sẽ đổi hình dạng thân lỗi của **mọi** endpoint trong app, kể
cả Customer Portal, nên bộ lọc riêng chỉ phủ nhánh `/v1/agent/*` và giữ nguyên bốn khoá cũ — thân lỗi
là **siêu tập** của hình dạng trước, không phải hình dạng khác.

Bộ lọc riêng cũng chuyển lỗi của tầng validate (Zod ném `UnprocessableEntityException` → 422) thành
**400 `INVALID_QUERY`** kèm tên trường sai: bảng mã trên là hợp đồng với agent, mà agent không phân
biệt được "tôi gõ sai toán tử" với "máy chủ hỏng" nếu mã trả về không nằm trong bảng.


### 3.1. `GET /agent/tables` trả metadata đầy đủ (`API-18`)

Trước `API-18`, endpoint này chỉ trả `key`, `description`, `fieldCount` và `readableFields` — tức agent
chỉ biết **tên** trường. Muốn lọc thì phải thử rồi nhận `FIELD_NOT_ALLOWED` mới biết trường đó lọc được
hay không, và với `API-8` (cú pháp MongoDB) cộng `API-17` (mở gần hết trường), số lần thử-sai đó chỉ
tăng lên.

Nay mỗi bảng trả thêm `entityName`, `defaultSort`, `fields[]` (đủ sáu thuộc tính chính sách mỗi trường)
và `excludedFields[]`.

**Chỉ lộ CẤU TRÚC, không lộ dữ liệu.** Metadata nói bảng có trường gì và dùng được thế nào; nó không
chứa giá trị của bất kỳ bản ghi nào, và `excludedFields` chỉ là **tên** trường. Hàm dựng chỉ đọc hằng
số trong bộ nhớ, không chạm collection nào — nên "lộ giá trị bản ghi" không phải điều nó có thể làm.

**Một hàm dựng, hai bề mặt.** `agent-table-meta.ts` là nơi duy nhất đọc registry rồi dựng mô tả; cả bề
mặt agent lẫn `GET /agent-admin/overview` của trang quản trị đều gọi nó, và trang chỉ bỏ đi hai khoá nó
không cần. Ở tầng kiểu, `AgentAdminTableZod` được **dẫn xuất** từ `AgentTableSummaryZod` thay vì khai
lại. Hai nơi mô tả cùng một trường theo hai kiểu khác nhau là thứ `API-18` AC-03 cấm, và cách chắc chắn
nhất để điều đó không xảy ra là không có định nghĩa thứ hai để mà lệch.

Đã đối chiếu thật trên API đang chạy: **11 bảng, 142 trường, 0 chỗ lệch** giữa hai bề mặt.

> **Đây là lật một quyết định cũ, có lý do.** Ở `API-3` BA từng chốt KHÔNG mở rộng `GET /agent/tables`,
> vì khi đó việc mở rộng chỉ phục vụ một trang quản trị — đổi thứ agent nhìn thấy để tiện cho trang là
> đánh đổi sai. Nay nó phục vụ chính agent, và người dùng đã xác nhận chưa có agent thật nào gọi
> production nên không phá vỡ tương thích với ai.

### 3.3 `POST /v1/agent/zalo/send` — ngoại lệ DUY NHẤT của luật chỉ-đọc

> **File:** `agent-zalo-send.logic.ts` (luật, hàm thuần + spec) · `agent-zalo-send.service.ts` (gọi engine)
> **Tài liệu cho agent:** `documents/AgentGuide/ZaloSend.md`

Mọi endpoint khác của bộ này là chỉ đọc (BR-3) — sai thì cùng lắm trả nhầm số.
Đường này nhắn ra ngoài, tới người thật, và **không rút lại được**. Vì thế luật
chặn nằm trong một **hàm thuần có test riêng**, không rải trong service.

**Vì sao đặt ở đây thay vì nhờ nhà cung cấp engine mở thêm.** Engine Zalo đã gửi
được từ lâu (`POST /conversations/:id/messages`), và app này vốn gọi engine mỗi
ngày cho màn chat. Thứ duy nhất còn thiếu là một lớp mỏng **có chốt chặn** — agent
không có phiên người dùng nên không đi qua proxy của màn chat được. Xác thực với
engine dùng đúng cơ chế proxy đang chạy: `x-service-token` = `{ts}.{HMAC-SHA256(ts, ZALO_ENGINE_SECRET)}`
cộng bốn header danh tính, trong đó `x-user-id: 'agent-api'` để nhật ký bên engine
không lẫn agent với người thật.

**Chốt chặn** (`chonHoiThoai`):

| `zalo_group_links.kind` | Kết quả |
|---|---|
| `internal`, `operation` | Cho gửi |
| `seller` | **400 CẤM** — nhóm khách hàng |
| `unreviewed` | 400 — chưa phân loại thì chưa biết bên kia là ai |

`conversationId` do agent truyền **phải thuộc nhóm đã duyệt**; nếu không thì chỉ
cần biết một id hội thoại bất kỳ là nhắn được vào nhóm khách, và chốt phân loại
nhóm thành vô nghĩa. Bỏ trống thì **thử lần lượt mọi hội thoại của nhóm** — mỗi nick
trong nhóm có một hội thoại riêng, gửi bằng nick nào cũng vào đúng nhóm đó, mà nick
rớt kết nối là chuyện thường. Lần chạy thật đầu tiên trên prod trúng ngay ca này:
engine trả `account_not_connected` vì nick giữ hội thoại đầu đang chờ quét lại QR,
trong khi nick thứ hai của nhóm vẫn sống. Chỉ đi tiếp khi thân lỗi đúng là
`account_not_connected` (`nickRotKetNoi`) — đó là lỗi **trước** lúc gửi; thử lại mù
trên lỗi khác thì có nguy cơ tin đã đi rồi mà nhắn thêm lần nữa.

Nội dung quá `4000` ký tự bị **cắt** chứ không từ chối: tin quá dài thường là agent
dán nhầm cả báo cáo, gửi được phần đầu vẫn hơn im lặng.

**Ghim nick (`accountName`) — thêm 15/09/2026.** Với bên gọi, nick công ty là
danh tính BỘ PHẬN (`Onos Ai` = CEO, `Cfo` = tài chính, `Onos Kế Toán` = kế toán).
Vòng thử-lần-lượt vốn thêm vào để cứu "nhóm câm khi nick đầu chết" lại **âm thầm
đổi danh tính người gửi**: một tin của CEO ra dưới nick `Cfo` và người trong nhóm
đọc thành chỉ đạo của phòng tài chính.

| Tham số | Hành vi |
|---|---|
| `accountName` | Gửi đúng nick đó; nick hỏng → lỗi nêu tên nick, **tắt vòng thử** |
| `accountName` + `allowFallback` | Nick đó trước, hỏng mới lùi |
| không truyền | Giữ nguyên hành vi cũ |

Sai danh tính hại hơn không gửi được, nên mặc định của nhánh có `accountName` là
KHÔNG lùi. Nick không thuộc nhóm bị chặn trước khi gửi, kèm danh sách nick đang có
(`chonTheoNick`) — bên gọi cần phân biệt "gõ sai tên" với "nick không ở trong nhóm".

Mọi đáp án gửi trả `sentAsNick`, kể cả DM và cả khi không ghim: thứ tự
`conversationIds` không mang ý nghĩa gì, nên đó là cách duy nhất bên gọi đối chiếu
được danh tính đã ra nhóm. Nick của một hội thoại lấy từ `zaloAccount.displayName`
bên engine (`ZaloEngineService.nickCuaHoiThoai`).

**Hạn mức riêng** `AGENT_ZALO_SEND_PER_MIN = 10` (chứ không dùng chung hạn mức đọc),
và **ghi vết cả lượt bị chặn** vào `agentApiLogs` capability `zalo_send` — biết agent
định nhắn vào đâu quan trọng ngang biết nó đã nhắn gì.

Nguyên văn lỗi từ engine chỉ vào log Winston; agent nhận câu đã diễn giải
(`dienGiaiLoiEngine`) để không lộ đường dẫn nội bộ.

**Thử nick khác khi nào** (`thuNickKhac`) — chỉ với lỗi xảy ra TRƯỚC lúc gửi, vì
thử tiếp sau khi tin đã đi là nhắn hai lần cho người thật:

| Thân lỗi | Thử nick tiếp? |
|---|---|
| `account_not_connected` | ✅ nick rớt phiên |
| `zalo_tu_choi` mã **161** — *"Nhóm này không tồn tại"* | ✅ nick ĐÃ RỜI nhóm |
| mã Zalo khác / lỗi khác | ⛔ chưa biết xảy ra trước hay sau khi gửi |

Mã 161 thêm vào sau ca thật 13–14/09: nhóm *OnosNB/ CSKH Nội Bộ* từ chối mọi lượt
gửi suốt hai ngày trong khi người thật vẫn gõ tay trong đó. Nhóm có 4 nick; nick
ĐẦU danh sách đã rời nhóm từ 07/09 nên Zalo trả 161, còn hai nick khác vẫn nhắn
hằng ngày. Luật cũ chỉ đi tiếp khi `account_not_connected` nên dừng ngay ở nick
đầu — một nick chết làm câm cả nhóm, đúng thứ vòng thử-lần-lượt sinh ra để tránh.

`MA_ZALO` là bảng mã bồi dần từ lỗi gặp thật (engine không tài liệu hoá). Mã lạ trả
về kèm chữ "chưa có trong bảng" thay vì 502 trần — thông báo không nói được gì thì
bên nhận chỉ còn cách thử lại, mà thử lại là đúng thứ không giúp gì ở đây.

**Đường ghi này KHÔNG đi qua `AgentApiRepository`.** Lớp đó cố ý chỉ phơi
`find`/`aggregate` để giữ BR-3 bằng *hình dạng* chứ không bằng kỷ luật; nếu nhét
thao tác ghi vào đó thì bất biến kia mất hiệu lực cho toàn bộ phần đọc.

### 3.4 Nghe tin Zalo — `zalo/groups/:id/messages`, `zalo/inbox`, và webhook

> **File:** `agent-zalo-inbound.logic.ts` (luật, hàm thuần + spec) · `agent-zalo-read.service.ts` · `agent-zalo-inbound.service.ts` · `agent-zalo-inbound.controller.ts` · `agent-zalo-trigger.entity.ts`
> **Tài liệu cho agent:** `documents/AgentGuide/ZaloListen.md`
> **Cấu hình:** `system_configs` khoá `agent_zalo_inbound_config`, dựng bằng `apps/api/scripts/setup-zalo-inbound.mjs`

Engine Zalo **đã có sẵn** cả hai nửa: `GET /api/zalo-multi/conversations/:id/messages`
và một hệ đăng ký webhook (`GET/POST /api/zalo-multi/webhooks`, sự kiện
`message.received`…) chưa ai dùng. Lớp này không dựng lại chúng — nó thêm ba thứ
engine không biết, và **đó mới là toàn bộ giá trị của lớp này**.

**1. Engine không biết `kind`.** Nó đẩy mọi nhóm. Nếu để agent đăng ký thẳng với
engine thì nội dung nhóm khách hàng và nhóm cá nhân nhân viên rời khỏi hệ thống —
phá đúng cái chốt riêng tư mà `kind=internal` sinh ra để giữ. Nên đường đi bắt
buộc là **engine → hệ thống này → agent**, không phải engine → agent.

**2. Chi phí.** Nhóm nội bộ + vận hành: **855 tin thật/ngày**. Đánh thức agent
trên mỗi tin ≈ 18–28 triệu token/ngày (số hệ cũ đã trả giá để biết). Lọc còn
**156 lượt/ngày**: Chủ tịch gửi, hoặc tag trúng nick trợ lý.

**3. Vai người gửi.** `senderType` của engine chỉ có `contact`/`self`.

#### Hai cái bẫy trong dữ liệu Zalo — cả hai đều hỏng ÂM THẦM

**uid phụ thuộc NICK ĐANG NHÌN.** Đo 12/09 trên prod: "Hoàng Anh" mang **8 uid**,
mỗi nick công ty thấy một uid riêng; Chủ tịch mang 8. Không tồn tại "uid của một
người", chỉ có **tập uid** — nên `chairmanZaloUids`/`agentNickZaloUids` là mảng,
và đó không phải để linh hoạt mà vì một chuỗi là sai.

Hệ quả nặng hơn: `zalo_accounts.zalo_uid` là uid nick **tự nhìn mình**, còn
`mentions[].uid` là uid **người khác thấy nó**. So hai bảng đó với nhau luôn trượt —
kiểm chứng: không một uid nào trong 12 uid bị tag nhiều nhất khớp `zalo_accounts`.
Bản đầu của tính năng này so đúng như vậy, và bộ lọc tag **chết hoàn toàn** mà
không có triệu chứng nào. Nguồn đúng là `zalo_identities` (khoá theo uid phía
contact) cộng tập uid khai tường minh trong config.

**Một câu nói = nhiều bản ghi.** Engine lưu một dòng cho MỖI nick công ty có mặt
trong nhóm: 7 ngày = 26.034 dòng cho 12.189 tin thật (2,1×, cao nhất 7 bản). Khoá
chống trùng vì thế là `<groupGlobalId>:<zaloMsgId>` (`khoaChongTrung()`), KHÔNG
phải id bản ghi — khoá sai là agent bị gọi dậy 2–7 lần cho cùng một câu và trả lời
lại từng lần.

#### Luồng

```
engine ──message.received──► POST /v1/agent/zalo/inbound   (chữ ký x-webhook-signature, HMAC-SHA256 hex)
                                   │  tra conversationId → nhóm (rẻ nhất trước, chặn nhóm khách KHÔNG tốn lời gọi engine)
                                   │  Chủ tịch? → biết ngay từ payload
                                   │  không? → đọc lại tin lấy mentions (engine không gửi mentions)
                                   ▼
                             agentZaloTriggers (TTL 14 ngày, unique khoaChongTrung)
                                   │
                    ┌──────────────┴──────────────┐
              đẩy tới subscribers            GET /v1/agent/zalo/inbox
              (x-signature HMAC hex)         (cùng kho, không phải nguồn thứ hai)
```

**Lưu TRƯỚC rồi mới đẩy**, và đẩy trượt **không** ném ngược lên engine: sự kiện đã
bền, bên nhận poll lại là có; ném lỗi chỉ khiến engine giao lại mãi thứ đã xử lý
xong. Cùng lý do, tin bị loại trả `200` — "không đáng đánh thức ai" là kết quả
đúng, không phải lỗi giao.

Đường `/agent/zalo/inbound` nằm ở **controller riêng** vì `AgentApiController` gắn
`AgentApiKeyGuard` cho cả lớp, mà engine không có khoá agent. Nó cũng cần **thân
thô** để kiểm chữ ký nên được thêm vào hook `preParsing` ở `main-nest.ts` cạnh
`/api/v1/partner`.

⚠️ **Sửa blob cấu hình thẳng trong Mongo thì PHẢI xoá cache Redis.**
`SystemConfigService.get()` cache blob **1 tiếng**; đường `set()` tự dọn, còn script
ghi thẳng collection thì không. Triệu chứng khi quên: đăng ký bên nhận xong, sự
kiện vẫn vào kho bình thường nhưng **không được đẩy đi, và không có lỗi nào** —
vì lúc đọc, danh sách bên nhận vẫn rỗng. `setup-zalo-inbound.mjs` đã tự xoá
`system_config:agent_zalo_inbound_config` sau mỗi lần ghi.

`ZaloIdentityKind` thêm `Chairman`: đánh dấu Chủ tịch là việc của người vận hành ở
màn *Danh tính*, không phải hằng số trong mã — và phải đánh dấu **đủ mọi dòng** của
ông vì lý do uid ở trên.

### 3.5 Nhắn riêng (DM) — chốt chặn phải KHÁC đường nhóm

Nhóm dựa vào `kind` do người vận hành xét. Hội thoại 1-1 **không có gì tương
đương**, nên thứ duy nhất đứng giữa agent và một người lạ là bảng danh tính. Vì
thế đường DM **mặc định CẤM** (`kiemNguoiNhanDm`): chỉ `chairman`/`staff` đi qua.

`unknown` bị chặn **ngang hàng với `customer`**. Đo 12/09 trên prod: trong 61
người đang có hội thoại riêng với nick công ty, chỉ **7** đã được xét (4 chủ tịch
+ 3 nhân viên); 31 `unknown`, 22 chưa có dòng danh tính, 1 khách. Coi "chưa ai
xét" là an toàn nghĩa là mở 53 hội thoại riêng với người không rõ là ai — và bỏ
luôn ý nghĩa của việc xét. `ai-support` cũng bị chặn: hai nick AI nhắn nhau thì
không có ai dừng.

**Chế độ chọn bằng SỰ CÓ MẶT của `groupGlobalId`**, không suy từ hình dạng id:
có → đường nhóm, không → đường DM. Nếu để `conversationId` tự quyết định thì sớm
muộn một id hội thoại thuộc nhóm đi lọt vào đường DM và bỏ qua chốt nhóm; ngược
lại, đưa id nhóm vào đường DM bị từ chối thẳng (`threadType !== 'user'`).

Đáp lại đường gửi DM có `recipient {displayName, role}` — `zaloUid` không dùng
làm danh tính được (phụ thuộc nick đang nhìn, xem §3.4), nên vai + tên là thứ duy
nhất agent tự kiểm lại được.

Tra hội thoại bằng `GET /api/zalo-multi/conversations/:id` **đích danh**, không
duyệt danh sách: `GET /conversations` bị engine lọc theo quyền người gọi và trả
rỗng cho `agent-api`, còn lấy theo id thì không.

## 4. UI Components

Không có. Bộ API này không phục vụ trình duyệt và không có màn hình quản trị — khoá cấp bằng biến môi trường.

## 5. Backend logic

### 5.1 Registry — nay là TỪ ĐIỂN, không phải cổng (`API-19`)

`apps/api/src/modules/agent-api/registry/index.ts` → `AGENT_TABLE_REGISTRY`, 11 bảng **có mô tả nghiệp vụ**: `orders`, `orderLogs`, `customers`, `productConfigs`, `productCategories`, `collections`, `promotions`, `factories`, `machineTypes`, `workshopConfigs`, `customer_notifications`.

Đây **không còn là danh sách bảng đọc được**. Bảng ngoài danh sách vẫn đọc/lọc/nhóm được đầy đủ; nó chỉ không có ghi chú nghiệp vụ, và `GET /agent/tables` trả về với `fields: []` cộng lời nhắc đọc thử `?limit=1` để biết cấu trúc. Nói rõ điều đó trong mô tả là bắt buộc — một danh sách trường rỗng nhìn từ phía agent trông y hệt một bảng bị khoá.

`AgentQueryService.spec()` vẫn là cửa duy nhất: bảng có mô tả trả spec của nó, bảng còn lại trả một spec MỞ sau khi tên collection qua được mẫu ký tự hợp lệ (`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$`). Tên bảng là thứ **duy nhất** của bên gọi đi thẳng vào một lời gọi MongoDB mà không qua bộ dịch nào, nên phép kiểm đó ở lại.

### 5.2 Ba lớp chặn ghi và chạy mã

1. `AgentQueryService.assertNoOperatorKeysOutsideFilter()` — quét sâu payload **trừ nhánh `filter`**, từ chối mọi khoá bắt đầu bằng `$` hoặc chứa dấu chấm. Nhánh `filter` có bộ kiểm riêng với danh sách trắng toán tử (`mongo-filter.ts`), chặt hơn vì nó kiểm cả chính sách trường. Hai **hàm riêng** chứ không phải một hàm mang cờ: một hàm có cờ "cho phép `$`" sẽ có ngày bị gọi với cờ bật ở chỗ không nên, mà không gì trong kiểu dữ liệu ngăn được (`API-8`). Chặn `$where`, `$function`, `$accumulator`, `$merge`, `$out`.
2. Zod `.strict()` ở mọi cấp của `AgentQueryZod`.
3. `AgentApiRepository` **chỉ phơi ra** `find`, `aggregate`, `insertLog`, `ensureLogTtlIndex`. Không service nào của module chạm được `save`/`updateOne`/`deleteOne` — BR-3 được giữ bằng hình dạng của lớp, không bằng kỷ luật người viết.

### 5.3 Bốn tên bị chặn — chốt DUY NHẤT còn lại (`API-19`)

`password`, `passwordSource`, `ip`, `userAgent`, `apiKeys`, `secret`. Không phải dữ liệu nghiệp vụ: hai cái đầu là bí mật xác thực (hash mật khẩu lọt ra là cho phép dò ngược ngoại tuyến toàn bộ tài khoản khách; `passwordSource = 'system'` chỉ điểm tài khoản đang dùng mật khẩu mặc định), hai cái giữa là dấu vết phiên làm việc, hai cái cuối (ORD-4) là bí mật của Public Order API: `customers.apiKeys[].hash` là sha256 của API key khách, `customer_webhooks.secret` là khoá ký HMAC webhook — ai có nó thì giả mạo được thông báo gửi cho khách.

Vì đây là cơ chế **duy nhất**, nó không còn nằm ở unit test như một lưới an toàn thứ hai mà chạy ở **tầng truy vấn**, ba lớp chồng nhau:

1. **`AgentQueryService.policy()`** — cửa chung của mọi đường (đọc, lọc, sắp xếp, nhóm, tổng hợp). So khớp theo **từng đoạn** của đường dẫn, nên `password.hash` hỏng y như `password`; áp cho mọi bảng, kể cả bảng không ai mô tả.
2. **`$project` loại trừ ở tầng kho dữ liệu** — truy vấn không xin trường cụ thể thì lấy nguyên bản ghi TRỪ sáu tên, nên chúng không được đọc lên khỏi DB.
3. **`stripDeniedDeep()` ở đầu ra** — quét mọi độ sâu, kể cả trong mảng. Lớp 2 chỉ phủ cấp một; nhánh lồng của collection không ai mô tả phải nhờ lớp này.

**Projection mặc định nay là NGUYÊN bản ghi.** Không xin `fields` thì không có `$project` thu hẹp — chiếu theo danh sách khai sẵn sẽ âm thầm nuốt mất mọi trường chưa kịp mô tả, và với bảng ngoài từ điển thì nuốt sạch. Có xin `fields` thì chiếu đúng thứ đã xin và `pick-projected.ts` cắt lại theo đường dẫn.

**Cái mất đi, ghi để về sau không ai tưởng là bug:** mở lọc trên trường tiền nghĩa là agent đoán được giá trị bằng nhị phân (`cost > 10` rỗng, `cost > 5` có 3 → ra giá thật sau vài lời gọi). Nay điều đó không còn nghĩa gì vì chính con số cũng đọc thẳng được.

### 5.3b Trường lồng: chiếu rồi lọc lại theo từng trường con

`productConfigs` khai bốn trường con của mảng biến thể (`variations.sku`, `variations.attributes`,
`variations.retailPrice`, `variations.status`). Mongo chiếu đường dẫn có dấu chấm và trả về **hình
mảng** — `{ variations: [{ sku, retailPrice }] }` — chứ không phải một khoá tên `'variations.sku'`.

Bước lọc sau khi đọc (`pick-projected.ts`) vì thế phải đi theo đường dẫn, không đọc thẳng
`row['variations.sku']`. Sau `API-19` bước này **chỉ chạy khi bên gọi xin `fields` cụ thể** — nó cắt
kết quả đúng theo danh sách đã xin, để "xin ba trường con" không trả về nguyên khối biến thể. Không
xin gì thì trả nguyên bản ghi, không qua bước này.

`QA-1` là lúc điều này hỏng: bản đầu đọc `row[key]` với `key` có dấu chấm nên luôn nhận `undefined`
và **im lặng** vứt toàn bộ dữ liệu biến thể — không lỗi, không cảnh báo, agent chỉ thấy sản phẩm
không có biến thể nào. Hai bản sao của cùng đoạn lọc (ở `agent-query.service.ts` và
`agent-read.service.ts`) cùng mắc, nên nay chúng dùng chung một hàm.

### 5.3c Tổng hợp và nhóm trên trường lồng

`$group` chạy thẳng trên bản ghi sẽ nhận **cả mảng** `variations` thay vì từng phần tử: `$sum` ra `0`,
`$avg` ra `null`, `$min`/`$max` trả về chính cái mảng, và nhóm theo `variations.sku` gom theo **bản
ghi** chứ không theo sku. Mọi trường hợp đều HTTP 200 — bên gọi không có tín hiệu nào để biết câu trả
lời đã sai (`QA-3`).

Nên khi truy vấn tổng hợp chạm tới đường dẫn lồng, pipeline thêm `$unwind` gốc mảng **trước** `$group`.
Hai điều cố ý:

- **Chỉ thêm khi thật sự có đường dẫn lồng.** Truy vấn trên trường phẳng giữ nguyên pipeline cũ từng
  bước một, nên không bảng nào khác đổi kết quả.
- **Không `preserveNullAndEmptyArrays`.** Bản ghi không có biến thể nào thì không có giá nào để cộng;
  giữ lại chỉ tạo ra nhóm rỗng giả.

Hệ quả ngữ nghĩa cần biết khi đọc kết quả: một khi đã `$unwind`, `count` đếm theo **phần tử mảng**
(số biến thể) chứ không theo bản ghi. Đó là điều đúng cho câu hỏi "có bao nhiêu biến thể giá X", và là
điều phải nhớ khi trộn `count` với metric trên trường lồng trong cùng một truy vấn.

### 5.4 Văn bản tự do: đọc nguyên văn VÀ lọc được (`API-19`)

**Từ `API-11`, văn bản tự do KHÔNG còn bị che email/số điện thoại** — agent đọc nguyên văn. Người dùng
yêu cầu điều này vì văn bản bị cắt xén làm agent trả lời khách dựa trên một bản đã mất ngữ cảnh.

**Rủi ro đã được nêu rõ trước khi quyết, và người dùng vẫn chọn:** agent đang chăm sóc khách A có thể
đọc được email hoặc số điện thoại của khách B nằm trong ghi chú của một đơn khác, rồi vô tình nhắc tới
trong hội thoại. Đây là rò rỉ **chéo giữa các khách hàng**, không phải rò ra ngoài công ty — bộ API vẫn
nằm sau khoá và vẫn chỉ đọc. Ghi ở đây để về sau không ai coi là bug mới phát hiện; siết lại là change
request.

**`API-19` gỡ nốt vế cấm lọc.** Tới `API-18`, văn bản tự do giữ `filter: 'none'` với lý do "cho lọc là
cho quét toàn bộ dữ liệu theo một mảnh thông tin liên hệ — dò dần từng ký tự cho tới khi ra đơn của một
người cụ thể". Người dùng chốt mở, và điều đó **đúng là** năng lực quét ngược nói trên: nay tìm được
đơn nào chứa một số điện thoại. Cùng lẽ đó, `orders.userEmail` / `customers.userEmail` / `customers.phone`
bỏ mức `eq`, nên `$startsWith` trên email chạy được.

`mask-free-text.ts` **không còn nơi nào gọi** (từ `API-11`/`API-12`, và `API-19` gỡ nốt đường cuối).
File giữ lại kèm cảnh báo ở đầu vì bộ mẫu đã qua kiểm thử kỹ — đặc biệt ca mã sản xuất
`XQ-91783-27005` **không** bị che nhầm thành số điện thoại — nên khôi phục được ngay nếu có change
request siết lại. Đừng nhìn file đó rồi kết luận hệ thống đang che: nó đang không che.

### 5.5 Giá trị cũ/mới của nhật ký — nay là trường bình thường

`order-log-value-policy.ts` **đã bị xoá** ở `API-19`. `orderLogs.before`/`after` nay là hai trường
`plain('object')` như mọi trường khác, đọc nguyên văn kể cả giá trị dạng khối.

Lý do cũ để lọc chúng qua một danh sách trắng tên trường là *"giá trị cũ/mới của tám trường tiền sẽ lọt
ra"*. Sau `API-19` tiền cũng mở, nên cái cổng đó không còn chặn gì — giữ lại chỉ tạo ra một sự bất nhất
mới: lịch sử thay đổi của một trường bị lược trong khi giá trị hiện tại của chính nó đọc thẳng được.

Kèm theo, `valueOmitted` biến mất khỏi kết quả và tầng đọc thô không còn phải xin thêm `before`/`after`
ngoài `$project` — hai chỗ đặc biệt hoá cho `orderLogs` trong `agent-query.service.ts` và
`agent-read.service.ts` đều đã gỡ.

### 5.6 Bất biến có unit test — sau `API-19`

`registry.spec.ts` và `registry-schema.spec.ts`. Phần lớn bất biến cũ **đã mất đối tượng để canh** vì
mọi thứ nay mở có chủ ý; những cái còn lại đổi cả mục đích:

| Mã | Bất biến | Trạng thái |
|---|---|---|
| I1 | `sortable ⇒ read`, `groupable ⇒ read` | **GỠ** — mọi trường đều `read` |
| I2 | Danh sách bảng khớp chính xác 11 tên | **ĐỔI NGHĨA** — nay là "11 bảng **có mô tả**", không phải "11 bảng đọc được" |
| I3 | Không tên bị chặn nào lọt vào từ điển | **GIỮ, siết hơn** — đúng 6 tên, so khớp theo từng đoạn đường dẫn, cộng ca cho `stripDeniedDeep` |
| I4 | Mọi đường dẫn của schema phải có mô tả hoặc nằm ở `deliberatelyExcluded` | **GIỮ, đổi mục đích** — nay canh **chất lượng từ điển**, không canh rò dữ liệu: đỏ nghĩa là "field mới chưa ai viết ghi chú", không phải "đang rò" |
| I5 | Metric chỉ trên trường `aggregatable && read` | **GỠ** — tổng hợp trên trường chữ trả 0/null, không còn bị chặn trước |
| I6 | Văn bản tự do phải `filter: 'none'` | **GỠ** — `API-19` cho lọc |
| I6b | Văn bản tự do không nằm ở đường dẫn lồng | Đã gỡ từ `API-11` |
| I7 | Danh sách trắng `before`/`after` | **GỠ** — cơ chế đã xoá (§5.5) |
| **MỚI** | Mọi trường trong từ điển phải mở đủ quyền (`read` + `filter: 'full'` + `sortable` + `groupable`) | Ca **quan trọng nhất** của `API-19`: `mongo-filter.ts` vẫn đọc `policy.filter`, nên một dòng `filter: 'none'` sót lại sẽ âm thầm khoá đúng thứ vừa mở, và chỉ lộ ra khi có người thật gặp lỗi |
| **MỚI** | Nhóm/sắp xếp theo `orders.assignee`, `orderLogs.userId` phải chạy | Khoá đúng ca người dùng báo hỏng — sản lượng theo từng người |

Ngoài ra `agent-query.service.spec.ts` giữ ma trận probe cũ nhưng đảo chiều: năm hướng đầu phải **chạy
được** (kể cả trên bảng không ai mô tả), hướng thứ sáu — sáu tên bị chặn — phải hỏng ở **mọi** vị trí.

### 5.7 Tài liệu

`AgentDocsService` dựng danh mục **một lần lúc boot** từ `documents/AgentGuide` — và **chỉ** thư mục đó (`API-13`): `FunctionDescription` và `Architecture` viết cho người sửa mã nên thôi được phơi, `documents/Plans/` cố ý bị loại từ đầu. Cả ba thư mục vẫn nguyên trong repo, task `API-13` chỉ đổi cái được **phơi**. Mốc nhận diện gốc `documents/` lúc dò thư mục cũng là `AgentGuide` — đổi danh sách nhóm mà quên mốc này thì danh mục rỗng và cổng trả `503` cho mọi lời gọi. `:slug` chỉ tra trong danh mục đó nên bên gọi không bao giờ đưa được đường dẫn xuống `fs`.

Thứ tự tìm thư mục: env `AGENT_DOCS_DIR` → `<thư mục chạy>/agent-docs` → đi ngược lên tìm `documents/` ở gốc repo. `apps/api/scripts/copy-agent-docs.mjs` chạy sau `build`, chép tài liệu vào cả `dist/agent-docs` lẫn `dist-prod/agent-docs` — vì `start:prod` chạy `node dist-prod/main.js` và không có gì bảo đảm gốc repo nằm cạnh tiến trình.

## 6. Performance notes

| Ngưỡng | Giá trị | Env ghi đè |
|---|---|---|
| `limit` mặc định / trần | 50 / 200 (lớn hơn bị **kẹp**, không báo lỗi) | `AGENT_API_MAX_LIMIT` |
| `offset` tối đa | 10.000 | — |
| Số nhóm tối đa của `aggregate` | 1.000 | — |
| `maxTimeMS` đọc thô | 3.000 ms | `AGENT_API_READ_TIMEOUT_MS` |
| `maxTimeMS` truy vấn | 8.000 ms | `AGENT_API_QUERY_TIMEOUT_MS` |
| Tần suất | **600** lời gọi/phút (`API-9` nâng từ 60) | — (hằng số `AGENT_API_RATE_LIMIT_PER_MIN` trong `agent-api.constants.ts`) |

- Hạn mức gọi **không chỉnh được bằng biến môi trường**. `@Throttle(...)` được ước lượng lúc nạp module nên
  không đọc được cấu hình runtime; muốn hạn mức theo cấu hình thì phải chuyển sang named throttler ở
  `ThrottlerModule`, tức đổi cơ chế throttling của cả app. Đổi con số thì sửa hằng số trong
  `agent-api/agent-api.constants.ts` — đó là nơi DUY NHẤT, và trang hướng dẫn Agent API đọc đúng hằng số
  đó nên số hiển thị không lệch khỏi số chặn (`API-4`).
- `maxTimeMS` **chưa từng được dùng ở đâu khác trong repo**. Nó phải có mặt ở mọi `find()` và `aggregate()` của module; sót một chỗ là mất chốt chặn đúng ở chỗ đó.
- `readPreference: 'secondaryPreferred'` — tải đọc của agent rơi vào secondary của replica set, không vào primary đang phục vụ sản xuất.
- **Đọc thẳng qua `Connection.collection()`, không qua model mongoose** (`API-19`): bề mặt là mọi collection nên tra model theo `entityName` không còn với tới được. An toàn vì toàn repo dùng `_id` **chuỗi** (`DatabaseEntityAbstract` sinh nanoid). **Giới hạn đã biết:** collection nào dùng `ObjectId` làm `_id` thì lọc theo `_id` và phân trang theo con trỏ trên bảng đó sẽ không khớp, vì mất lớp ép kiểu của mongoose.
- Phân trang đọc thô dùng **con trỏ trên `_id`**, không dùng `skip`: bảng `orders` lớn, `skip` sâu vừa chậm vừa vi phạm giới hạn tải.

## 7. Permissions

**Không dùng permission-catalog nội bộ và không dùng JWT.** Xác thực bằng một khoá bí mật duy nhất trong biến môi trường `AGENT_API_KEY`, tách hẳn khỏi mọi tài khoản người thật; thu hồi hoặc đổi khoá không ảnh hưởng tài khoản nào.

Cụm `partnerApi` sẵn có trong `ApiConfigService` **cố ý không được tái dùng**: nó thiết kế cho ký HMAC theo đối tác và chưa module nào dùng, kéo vào đây chỉ làm bề mặt xác thực phức tạp hơn mà không thêm bảo đảm nào cho một bên gọi duy nhất.

So sánh khoá bằng `crypto.timingSafeEqual` trên bản băm SHA-256 — độ dài khác nhau không làm lộ thông tin qua thời gian. Thiếu cấu hình khoá thì mọi endpoint **đóng**, không có chế độ "mở khi thiếu cấu hình".

**Sau `API-19`, khoá này là ranh giới bảo vệ gần như duy nhất.** Trước đây ai cầm khoá cũng chỉ đọc được 11 bảng đã lọc trường; nay cầm khoá là đọc được gần như toàn bộ cơ sở dữ liệu. Hai việc vận hành đi kèm, không phải khuyến nghị suông: **đừng phơi `/v1/agent/*` ra Internet công cộng** khi không cần, và **đổi khoá** như đổi một mật khẩu quản trị chứ không như một token đọc.

## 8. Trang Swagger `/documentation` (`API-5`, `API-15`, `HF-1`, `API-16`)

Trang Swagger nằm **ngoài** global prefix `api/v1` và trước `API-5` thì mở tự do — ai biết địa chỉ là
đọc được toàn bộ bề mặt API. Nay nó cần khoá trên địa chỉ:

```
http://<host>/documentation?key=<AGENT_API_KEY>
```

| Tình huống | Hành vi |
|---|---|
| `AGENT_API_KEY` **chưa đặt** | Trang **đóng hẳn**, trả `503` kèm đúng tên biến cần đặt — và bộ API agent cũng đóng, vì cùng một biến |
| Mở không kèm `?key=` hoặc khoá sai | `401`, kèm câu nhắc mở lại kèm `?key=` |
| Khoá đúng | Trang mở, và server đặt cookie phiên `swagger_access` (8 giờ, `HttpOnly`, `Path=/documentation`, `SameSite=Strict`) |

**Vì sao cần cookie chứ không chỉ đọc query:** Swagger UI tải tiếp `swagger-ui-init.js` — file chứa
**toàn bộ** đặc tả API — và những request đó không mang lại query của trang. Cho asset đi tự do thì coi
như không khoá gì; bắt mọi request phải có `?key=` thì trang vỡ. Cookie mang **bản băm** của khoá,
không mang khoá thô.

`/documentation-json` (đặc tả thô) cũng nằm sau khoá, nhưng cookie `Path=/documentation` **không** áp
cho nó theo quy tắc so khớp đường dẫn của cookie — nên tải file này phải kèm `?key=` riêng. Đó là
hành vi mong muốn: mọi đường vào đặc tả đều đi qua khoá.

**Chưa cấu hình thì đóng, không mở** — đây là lựa chọn có chủ ý giữa hai hành vi mà yêu cầu cho phép:
mở-khi-thiếu-cấu-hình nghĩa là triển khai xong trang vẫn tự do cho tới khi ai đó nhớ ra, tức yêu cầu
khoá trang bị vô hiệu trong im lặng. Đóng kèm tên biến thì người dev biết ngay phải làm gì.

**Khoá nằm trên URL** nên đi vào lịch sử trình duyệt, log truy cập và referrer. Đó là hệ quả cố hữu của
cách mở bằng đường dẫn mà người dùng đã chọn, không phải lỗi cài đặt — đổi lại là dán link cho nhau
được.

Trang Swagger **dùng chung `AGENT_API_KEY`** với bộ API agent (`API-7`). Người dùng chọn vậy sau khi
được nêu rõ hệ quả: khoá agent hiển thị công khai trên trang quản trị của `API-3`, nên ai mở được trang
đó cũng vào được Swagger. Cả hai đều giới hạn ở SuperAdmin/Admin nên phạm vi người thấy là như nhau;
cái mất là tính tách bạch giữa hai mức nhạy cảm. Đây là **rủi ro đã chấp nhận**, không phải bug mới;
muốn tách lại thì mở change request.

`API-15` đã thu hẹp phần còn lại của rủi ro đó: người qua được khoá **không còn thấy toàn bộ bề mặt
API** nữa, chỉ thấy nhóm agent (xem §8.1).

Hệ quả vận hành: thiếu `AGENT_API_KEY` là **đóng cùng lúc** cả bộ API agent lẫn trang tài liệu.

Khoá agent trong Swagger là **ô nhập duy nhất trong hộp Authorize** (security scheme `agent-api-key`),
khai ở `DocumentBuilder.addApiKey(...)` và gắn vào controller bằng `@ApiSecurity`, thay cho `@ApiHeader`
vốn bắt nhập lại ở từng endpoint. Cùng với `persistAuthorization: true`, nhập một lần là mọi lời gọi thử
đều mang đúng khoá. Đây chỉ là phần khai báo tài liệu — cửa thật vẫn là `AgentApiKeyGuard`.

**Không còn ô `bearer` (`HF-1`).** Trước đó hộp Authorize có thêm một ô `bearer (http, Bearer)` không
dùng được vào việc gì, và đặc tả khai 5 endpoint agent là cần **cả** khoá agent lẫn JWT — sai, vì cửa
của chúng chỉ là `AgentApiKeyGuard`. Nguyên nhân ở `apps/api/src/decorators/http.decorator.ts`: `Auth()`
gắn `ApiBearerAuth()` **vô điều kiện**, nên route khai `{ public: true }` vẫn bị dán nhãn JWT. Nay nhãn
đó chỉ gắn cho route thật sự đi qua JWT, và `DocumentBuilder` không khai `addBearerAuth()` nữa.

`ApiBearerAuth` là decorator **tài liệu**, không phải guard — sửa nó không đổi quyền gọi của bất kỳ
route nào. Cửa vẫn là `AuthGuard({ public })` khai ngay cạnh nó. Dựng lại trang tài liệu cho API nội bộ
về sau thì khai bearer ở **trang đó**, đừng khai lại ở trang agent.

### 8.2. Mô tả endpoint dựng từ nguồn chung, không chép tay (`API-16`)

Yêu cầu người dùng: trang quản trị `/adm/settings/agent-api` là **chuẩn**, trang tài liệu phải nói cùng
một thứ và đạt cùng mức hướng dẫn. Điều then chốt là **"đồng bộ" không phải chép**: chép tay thì hai bản
lệch nhau ngay lần sửa đầu, và điều đó đã xảy ra ở `API-14` — trang còn dạy cú pháp lọc cũ sau khi
`API-8` đổi cú pháp.

Mô tả 5 endpoint nằm ở `apps/api/src/modules/agent-api/agent-swagger-guide.ts`, dựng từ hai nguồn:

| Phần nội dung | Nguồn | Sửa một chỗ thì |
|---|---|---|
| Danh sách bảng + mô tả từng bảng | `AGENT_TABLE_REGISTRY` — đúng nguồn trang quản trị đọc qua `GET /agent-admin/overview` | **cả hai nơi cùng đổi**, không phải sửa hai chỗ |
| Hạn mức gọi | `AGENT_API_RATE_LIMIT_PER_MIN` — đúng hằng số `@Throttle` dùng | con số trên tài liệu không thể lệch con số máy chủ áp |
| Nhãn năng lực · nghĩa 8 mã lỗi · mã HTTP · ví dụ curl | `packages/shared/constants/agent-api-guide.ts` | frontend vẫn giữ bản i18n riêng — xem đoạn dưới |

**Đã kiểm bằng cách làm thật, không suy luận:** đổi một dòng `description` trong registry rồi đọc lại cả
hai đầu ra — `swagger-ui-init.js` của trang tài liệu **và** `GET /agent-admin/overview` của trang quản
trị — cả hai cùng đổi theo.

**Phần chưa dùng chung được, và vì sao.** Nhãn năng lực và nghĩa mã lỗi hiện tồn tại hai bản: hằng số ở
`packages/shared` và key i18n trong `apps/web/src/i18n/locales/{vi,en}/agentApi.json`. Bỏ bản i18n đi
nghĩa là **đổi trang quản trị**, mà đó là thứ `API-16` §4 để ngoài phạm vi — trang là chuẩn, không phải
thứ bị sửa theo. Đặt hằng số ở `packages/shared` (chứ không ở `apps/api`) là để ngày phạm vi được mở,
frontend chỉ việc bỏ key i18n và đọc thẳng hằng số, **không phải đụng backend lần nữa**.

Trong lúc chờ, thứ giữ hai bên không lệch là `agent-guide-sync.spec.ts`:

- so **từng ký tự** nhãn năng lực và nghĩa mã lỗi với `vi/agentApi.json`;
- kiểm `en/agentApi.json` có **đúng bộ khoá** (bản dịch nên không so chuỗi);
- và phần đáng giá nhất: so bảng mã HTTP với **mã trạng thái thật** mà từng hàm trong `agent-errors.ts`
  ném ra, rồi mới so tiếp với bảng `ERROR_HTTP` của frontend. So hai bảng với nhau thì cả hai cùng sai
  vẫn xanh; neo vào hàm dựng lỗi thì không.

Test này là **test backend đọc file frontend** — trông sai, nhưng repo chỉ `apps/api` có Jest nên đó là
chỗ duy nhất đặt được. Lý do ghi ngay đầu file để nó không bị dọn nhầm.

> Vì sao phần neo-vào-lỗi-thật đáng giá: khi viết bảng mã HTTP lần đầu, DEV đoán sai **ba trên tám**
> dòng và chỉ phát hiện vì mở mã nguồn ra đọc. Ba bản chép mà không có gì đối chiếu thì sai kiểu đó chỉ
> lộ ra khi đã có người thật đọc tài liệu rồi làm theo.

### 8.1. Trang chỉ mô tả nhóm agent (`API-15`)

Đặc tả mà trang tải về **chỉ chứa 5 endpoint dưới `/api/v1/agent`**. Endpoint nội bộ — đơn hàng, khách
hàng, người dùng, phân quyền, Customer Portal, cấu hình — không có mặt trong đó.

**Chặn ở tầng sinh đặc tả, không ở tầng hiển thị.** `setup-swagger.ts` truyền
`{ include: [AgentApiModule] }` cho `SwaggerModule.createDocument`, nên bộ quét của `@nestjs/swagger`
không đi vào module nội bộ lần nào. Khác biệt này quan trọng: ẩn ở lớp hiển thị thì đường dẫn vẫn nằm
trong JSON, ai mở đặc tả thô vẫn đọc được đủ — mà người mở được chính là người ta muốn giấu.

`AgentApiAdminController` nằm **cùng module** nhưng là bề mặt quản trị nội bộ (JWT + vai), nên bị loại
riêng bằng `@ApiExcludeController()` tại chỗ khai báo nó. Không có nó thì `include` sẽ kéo theo cả
`/v1/agent-admin/*` — đúng loại endpoint yêu cầu này muốn giấu.

**Không endpoint nào đổi hành vi.** `include` chỉ tác động tới bộ sinh tài liệu, không tới bộ định
tuyến: mọi endpoint nội bộ vẫn đăng ký, vẫn chạy, vẫn cùng cơ chế xác thực. `/v1/agent-admin/*` vẫn
phục vụ trang hướng dẫn trong `/adm` bình thường dù đã biến mất khỏi tài liệu.

Số đo trước/sau, lấy từ `swagger-ui-init.js` mà trang thật tải về trên API dev:

| | Trước | Sau |
|---|---|---|
| Kích thước đặc tả | ~600 KB | **12,2 KB** |
| Số đường dẫn | toàn hệ thống | **5**, tất cả dưới `/api/v1/agent` |
| Số schema trong `components` | hàng trăm | **1** |

**Cái mất:** không còn Swagger cho API nội bộ, kể cả ở máy dev. Repo bù được phần lớn nhờ DTO Zod dùng
chung trong `packages/shared` — FE import thẳng cùng kiểu, nên Swagger không phải nguồn duy nhất biết
hình dạng request/response. Phần thật sự mất là chỗ **bấm thử endpoint nội bộ ngay trên trình duyệt**.
Nếu chỗ đó cần thiết thì hướng đã đề xuất là dựng trang thứ hai chỉ bật ngoài môi trường production —
xem note ký `implement` của `API-15`; BA duyệt trước khi làm.

## 9. Bề mặt quản trị `/v1/agent-admin/*` (`API-3`)

Trang hướng dẫn trong `/adm` đọc dữ liệu qua **bề mặt thứ hai**, tách hẳn khỏi bề mặt agent. Trang đó
được mô tả riêng ở [`AgentApiGuide.md`](AgentApiGuide.md); mục này chỉ nói phần backend.

| Endpoint | Trả về |
|---|---|
| `GET /v1/agent-admin/overview` | Bảng + từng trường kèm chính sách, tên trường **cố ý bị loại trừ**, hạn mức, `keyConfigured` |
| `GET /v1/agent-admin/key` | Giá trị khoá agent — chỉ gọi khi người xem bấm hiện |

**Controller riêng, prefix riêng — không phải cho gọn mà vì xác thực ngược nhau.**
`AgentApiController` gắn `@UseGuards(AgentApiKeyGuard)` ở **cấp class**: mọi route trong nó đòi khoá
agent. Hai endpoint trên xác thực bằng JWT + vai + quyền. Trộn hai cơ chế vào một class là cách chắc
chắn nhất để một ngày nào đó có route lọt sai cửa. Prefix `agent-admin` cũng giữ cho `/v1/agent/*`
đúng bằng 5 endpoint đã công bố với agent — người dò `/v1/agent/` không tìm thấy thêm gì.

**Phân quyền hai lớp:** `page.agent_api` ở `PermissionsGuard`, **và** `RoleType.Admin` ở `RolesGuard`.
Manager được gán mã quyền vẫn không qua lớp thứ hai. Điều này cần cả `ADMIN_ONLY_PAGE_CODES` trong
`permission-catalog.ts`: preset của Manager là "mọi mã trừ danh sách này", nên **mã admin-only mới mà
quên thêm vào danh sách thì Manager lặng lẽ có quyền** — không lỗi nào bật ra, chỉ lộ khi có người kiểm
thử phân quyền bằng tay.

**Dựng từ registry tại thời điểm gọi, không cache.** Thêm một trường vào registry là nó tự hiện trên
trang, không sửa dòng nào ở BE lẫn FE. Service này không chạm collection nghiệp vụ nào — chỉ đọc hằng
số trong bộ nhớ — nên việc trả ra *tên* các trường bị che không mở đường nào tới *giá trị* của chúng.

`allowedHeaders` trong `main-nest.ts` có thêm `X-Agent-Api-Key` để phần "Thử gọi" của trang gọi thẳng
`/v1/agent/*` từ trình duyệt. Chỉ nới header; whitelist `origin` giữ nguyên.
