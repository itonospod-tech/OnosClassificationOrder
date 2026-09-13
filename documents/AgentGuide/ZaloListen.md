# Nghe tin nhắn trong nhóm Zalo

> Cặp với [ZaloSend.md](ZaloSend.md): trang này nói cách bạn **biết có việc**;
> trang kia nói cách bạn **trả lời**. Cùng một chốt chặn loại nhóm cho cả hai.

## 1. Bạn được đánh thức khi nào

Chỉ hai trường hợp, và đó là cố ý:

| Lý do | Nghĩa là |
|---|---|
| `chairman` | Chủ tịch vừa nhắn trong một nhóm nội bộ/vận hành |
| `mention` | Ai đó vừa @ đúng một nick trợ lý AI |

**Vì sao hẹp đến thế.** Nhóm nội bộ và vận hành chạy **855 tin thật mỗi ngày**.
Đánh thức bạn trên mỗi tin là 18–28 triệu token/ngày — hệ cũ đã đo và không trả
nổi. Lọc như trên còn **156 lượt/ngày**. Nếu bạn thấy mình cần phản ứng với thứ
khác nữa, đó là việc bàn lại bộ lọc, không phải việc tự đi poll cả nhóm.

Tin không lọt hai điều kiện trên **không mất đi** — nó vẫn nằm trong nhóm, và
bạn đọc được bất cứ lúc nào bằng §3.

## 2. Nhận sự kiện

### Cách A — webhook đẩy về (nên dùng)

Bạn đăng ký một URL; mỗi lượt kích hoạt hệ thống POST tới đó:

```json
{
  "triggerId": "LMV4Q9C3T4N8WKVA",
  "reason": "chairman",
  "receivedAt": "2026-09-12T04:56:07.252Z",
  "message": { ...xem §3... }
}
```

Header `x-signature` = `HMAC-SHA256(bí_mật_của_bạn, nguyên_văn_thân)` dạng hex.
**Kiểm chữ ký trước khi đọc thân** — nếu không thì ai biết URL cũng đánh thức
được bạn.

### Cách B — tự lấy về

```
GET /api/v1/agent/zalo/inbox?cursor=<triggerId cuối đã xử lý>&limit=50
```

Cùng một kho với đường đẩy, không phải nguồn thứ hai. Dùng nó khi máy bạn vừa
sập dậy, hoặc để đối chiếu xem có lượt nào đẩy trượt không. Lưu `nextCursor` lại
sau mỗi lượt.

Sự kiện giữ **14 ngày**. Quá đó thì một tin nhắn nhóm cũng không còn hành động
được nữa.

## 3. Đọc tin của một nhóm

```
GET /api/v1/agent/zalo/groups/{groupGlobalId}/messages?limit=50&since=<ISO>
```

Đây là thứ dùng cho cả ba việc: xét "có phải việc của mình không" sau khi bị đánh
thức, đọc thêm ngữ cảnh trước khi trả lời, và khi agent cấp trên giao "vào nhóm X
xem tình hình".

Mỗi tin:

```json
{
  "messageId": "...", "zaloMsgId": "...",
  "groupGlobalId": "...", "groupTitle": "Report Ceo", "kind": "internal",
  "conversationId": "...", "sentAt": "2026-09-12T04:04:28.360Z",
  "content": "Tốt báo cáo", "contentType": "text",
  "attachments": [], "replyToId": null,
  "sender": { "zaloUid": "...", "displayName": "Onos", "role": "chairman" },
  "mentions": [{ "uid": "...", "name": "", "laNickAgent": true }]
}
```

`role` một trong: `chairman` · `staff` · `ai-support` · `customer` · `unknown`.

⚠️ **`ai-support` là nick trợ lý — có thể là chính bạn.** Kiểm trước khi trả lời,
không thì hai trợ lý nói chuyện với nhau trong nhóm cho tới khi có người tắt.

⚠️ **`unknown` đang chiếm 615/823 người.** Nó nghĩa là *chưa ai xét*, KHÔNG phải
*người ngoài*. Đừng suy ra điều gì từ nó, và đừng nói năng như thể đã biết người
đó là ai.

## 3b. Đọc hội thoại riêng

```
GET /api/v1/agent/zalo/dm/{conversationId}/messages?limit=50&since=<ISO>
```

Cùng hình dạng tin như trên, `kind` trả `"dm"` và `groupGlobalId` rỗng — hai ngữ
cảnh khác nhau, đừng trộn.

Cùng chốt với đường nhắn riêng: **chỉ `chairman`/`staff`**, người chưa xét cũng bị
cấm. Đọc trộm tin riêng của người chưa ai xác định là ai còn khó biện minh hơn
nhắn nhầm cho họ — nhắn nhầm thì người ta thấy, đọc thì không.

## 4. Nhóm nào đọc được

Đúng bộ luật của [ZaloSend.md](ZaloSend.md): **chỉ `internal` và `operation`**.
Nhóm khách hàng (`seller`) và nhóm chưa phân loại (`unreviewed`) trả `400`.

Đọc lén nhóm khách còn nặng hơn gửi nhầm: gửi nhầm thì người ta thấy và mắng,
còn đọc thì không ai biết. Đừng tìm đường vòng.

## 5. Một điều về uid, để bạn khỏi kết luận sai

**uid Zalo phụ thuộc nick đang nhìn.** Cùng một người mang uid khác nhau tuỳ theo
nick nào của công ty thấy họ — đo trên dữ liệu thật: một người có tới 8 uid.

Nghĩa là: **đừng dùng `sender.zaloUid` làm danh tính người**. Hai tin có uid khác
nhau vẫn có thể là cùng một người; cùng một người trong hai nhóm sẽ cho bạn hai
uid. Hãy dùng `sender.role` và `displayName`, còn khi thật sự cần nối người thì
hỏi hệ thống, đừng tự ghép.

Cũng vì lý do đó, một câu nói thật được lưu thành nhiều bản (mỗi nick một bản).
Hệ thống đã gộp trước khi đánh thức bạn, nên **một câu = một lượt**.

## 6. Trước khi trả lời

Xem [ZaloSend.md](ZaloSend.md) §5 và [WhatYouCannotSee.md](WhatYouCannotSee.md).
Nhắc lại điều quan trọng nhất: **đọc được không có nghĩa là nói được.**

## 7. Độ tươi của tóm tắt nhóm

`zalo_group_summaries` được làm mới **4 tiếng một lượt** (6 lượt/ngày, giờ VN),
mỗi lượt tối đa 30 nhóm. `tomTatLuc` là mốc lần tóm tắt gần nhất của nhóm đó.

Một nhóm CÓ THỂ cũ hơn 4 tiếng, và đó là bình thường, vì ba lý do cố ý: nhóm im
quá 14 ngày thì không tóm tắt lại; nhóm đã tóm tắt tới đúng tin cuối thì không
chạy lại; và khi nhiều nhóm cùng tới hạn thì chúng xếp hàng qua vài lượt.

Nên khi trình bày, đừng nói "nhóm này không có gì mới" chỉ vì `tomTatLuc` cũ —
hãy đọc tin thật bằng §3 nếu cần biết chuyện vừa xảy ra.
