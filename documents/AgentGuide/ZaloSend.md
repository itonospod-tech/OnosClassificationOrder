# Gửi tin nhắn vào nhóm Zalo

> Đây là **thao tác GHI duy nhất** của bạn. Mọi lệnh gọi khác trong bộ API này chỉ đọc:
> gọi sai thì cùng lắm ra số sai. Còn lệnh này nhắn tới **người thật**, và
> **không rút lại được**. Đọc hết trang này trước khi gọi lần đầu.

## 1. Gọi thế nào

```
POST /api/v1/agent/zalo/send
X-Agent-Api-Key: <khoá>
Content-Type: application/json

{
  "groupGlobalId": "NS4BG60A5DB3027AAU6F5L8O60UVTMG0",
  "content": "Đơn N-12345-67890 đã quá hạn công đoạn Ép 2 ngày.",
  "conversationId": "tuỳ chọn"
}
```

Trả về:

```json
{
  "success": true,
  "data": {
    "conversationId": "…",
    "groupTitle": "CSKH ONOS",
    "sentAt": "2026-09-12T03:11:22.000Z"
  }
}
```

`groupGlobalId` lấy từ `GET /v1/agent/seller-support`, hoặc đọc thẳng bảng
`zalo_group_links`. **Không cần** truyền `conversationId`: mỗi nick công ty ở
trong nhóm có một hội thoại riêng, gửi bằng nick nào cũng vào đúng nhóm đó, nên
bỏ trống là hệ thống **thử lần lượt từng nick** cho tới khi có nick gửi được —
nick Zalo rớt kết nối (bị đá, chờ quét lại QR) là chuyện thường, bỏ trống thì bạn
được hưởng phần thử lại đó. Nếu truyền thì id đó **phải thuộc chính nhóm ấy** —
truyền id lạc sẽ bị từ chối, vì nếu không thì chỉ cần biết một id hội thoại bất
kỳ là nhắn được vào nhóm khách, và toàn bộ chốt chặn dưới đây thành vô nghĩa.

## 1b. Nhắn riêng (DM)

Bỏ `groupGlobalId`, đưa `conversationId` của hội thoại 1-1:

```json
{ "conversationId": "284fc13b-…", "content": "Báo cáo hôm nay: …" }
```

Trả về có thêm **người nhận**, để bạn đối chiếu mình vừa nhắn cho ai:

```json
{ "success": true, "data": {
  "conversationId": "284fc13b-…",
  "recipient": { "displayName": "Thuy Thanh", "role": "staff" },
  "sentAt": "2026-09-12T04:23:15.599Z" } }
```

**Chỉ nhắn riêng được cho `chairman` và `staff`.** Không phải chỉ cấm khách:
**người chưa ai xét cũng bị cấm**. `unknown` nghĩa là *chưa ai kiểm*, không phải
*đã kiểm và thấy an toàn* — và hiện 53 trong 61 người có hội thoại riêng với nick
công ty đang ở diện đó. Muốn mở cho ai thì nhờ vận hành xét người đó ở màn *Danh
tính* trước.

Nick trợ lý AI khác cũng bị cấm: hai con máy nhắn nhau thì không có ai dừng lại.

Đưa id hội thoại NHÓM vào đường này sẽ bị từ chối — gửi nhóm phải đi qua
`groupGlobalId` để còn qua chốt phân loại nhóm.

## 1c. Chọn nick gửi (`accountName`)

Mỗi nhóm có nhiều nick công ty. **Nick là danh tính người trong nhóm nhìn thấy**,
nên gửi đúng nội dung dưới sai nick là phát ngôn nhân danh bộ phận khác.

```json
{ "groupGlobalId": "...", "accountName": "Onos Ai", "content": "..." }
```

Đáp án luôn có `sentAsNick` — nick đã THỰC SỰ gửi, cả nhóm lẫn DM:

```json
{ "success": true, "data": { "conversationId": "...", "groupTitle": "...",
  "sentAsNick": "Onos Ai", "sentAt": "..." } }
```

| Trường hợp | Hành vi |
|---|---|
| Có `accountName` | Gửi ĐÚNG nick đó. Nick gửi không được → lỗi nêu tên nick, **KHÔNG tự đổi nick khác** |
| Có `accountName` + `allowFallback: true` | Thử nick đó trước, hỏng thì mới lùi sang nick khác |
| Không có `accountName` | Giữ hành vi cũ: thử lần lượt tới khi có nick gửi được |

Nick không ở trong nhóm thì bị từ chối **trước khi gửi**, kèm danh sách nick đang
có: `Nhóm này không có nick "X". Nick đang ở trong nhóm: Cfo, Onos, Onos Ai.`

⚠️ **Không ghim nick thì đừng đoán tin đã ra dưới danh tính nào** — thứ tự nick
không theo quy tắc nào cả. Cứ đọc `sentAsNick`.

## 2. Nhóm nào được gửi

| `kind` | Gửi được? | Là nhóm gì |
|---|---|---|
| `internal` | ✅ | Nhóm nội bộ, chỉ người trong công ty |
| `operation` | ✅ | Nhóm vận hành — có người ngoài (forwarder, nhà cung cấp) nhưng là quan hệ công việc |
| `seller` | ⛔ **CẤM** | Nhóm khách hàng |
| `unreviewed` | ⛔ | Chưa ai phân loại → chưa biết bên kia là ai |

**Vì sao cấm nhóm khách.** Không phải vì nội dung bạn viết dở. Mà vì một câu do
máy gửi thẳng vào nhóm khách là công ty đang nói với khách — sai một con số,
hứa nhầm một mốc giao, hay chỉ đơn giản là nhắn lúc 2 giờ sáng, thì người chịu
là sale đang giữ khách đó, và họ không có cách nào biết trước để chặn. Nhóm nội
bộ thì khác: người nhận là đồng nghiệp, thấy sai là sửa được ngay tại chỗ.

Muốn báo gì cho khách thì **nhắn vào nhóm vận hành để người phụ trách chuyển đi**,
đừng tìm đường vòng. Nhóm `unreviewed` cũng đừng thử: cứ nhờ vận hành phân loại
ở màn *Nối nhóm Zalo* trước, sau đó gửi bình thường.

## 3. Lỗi trả về

Tất cả là `400` kèm `message` tiếng Việt đọc thẳng được:

| Thông báo | Nghĩa là |
|---|---|
| `Không tìm thấy nhóm Zalo với mã này.` | Sai `groupGlobalId` |
| `CẤM gửi vào nhóm khách hàng — …` | Nhóm `seller` |
| `Nhóm chưa được phân loại — …` | Nhóm `unreviewed` |
| `Nhóm chưa có hội thoại nào để gửi …` | Chưa nick nào của công ty ở trong nhóm |
| `Mọi nick … đều đang mất kết nối Zalo.` | Có nick trong nhóm nhưng nick nào cũng rớt — báo người vận hành quét lại QR |
| `conversationId không thuộc nhóm này.` | Id lạc |
| `Nội dung rỗng.` | `content` trống hoặc chỉ có khoảng trắng |

### Lỗi phía Zalo (503)

Hệ thống **tự thử lần lượt các nick** của công ty trong nhóm, nên bạn chỉ thấy
503 khi **không nick nào** gửi được. Câu lỗi nói rõ đã thử mấy nick.

| Câu lỗi | Nghĩa |
|---|---|
| `Zalo từ chối (mã 161): Nick này không còn ở trong nhóm.` | Mọi nick công ty đã rời nhóm — báo vận hành mời lại một nick vào nhóm |
| `Zalo từ chối (mã N) — mã chưa có trong bảng` | Mã Zalo chưa gặp bao giờ; báo lại để bọn mình bổ sung |
| `Engine Zalo từ chối (5xx)` | Trục trặc phía engine, thử lại sau |

Đừng đổi sang nhóm khác để lách — nếu nhóm đích không gửi được thì tin đó phải do
người xử lý, không phải gửi nhầm chỗ.

Nội dung từ 4.000 tới 8.000 ký tự bị **cắt** còn 4.000 chứ không bị từ chối; dài
hơn 8.000 thì bị `422` ngay ở tầng kiểm tham số. Đừng dựa vào phần cắt đó: dán
nguyên một báo cáo vào nhóm chat thì người ta cũng không đọc. Viết ngắn, nêu số và
mã đơn, để chi tiết ở đường dẫn.

## 4. Hạn mức và nhật ký

- **10 tin/phút.** Vượt thì `429`. Hạn mức này không phải để bạn chạy sát; nó là
  van an toàn phòng khi vòng lặp của bạn kẹt.
- **Mọi lượt gửi đều được ghi vết** vào `agentApiLogs`, kèm nhóm và phần đầu nội
  dung — **kể cả lượt bị chặn**. Nhắn ra ngoài mà không có vết thì sau này không
  ai truy được ai đã nói gì.

## 5. Trước khi bấm gửi

Ba câu tự hỏi, đều là những lần đã hỏng ở nơi khác:

1. **Số này có chắc không?** Đọc lại từ API, đừng nhắc theo trí nhớ của lượt trước.
2. **Có ai đang cần đọc câu này không?** Nhóm vận hành đọc mọi tin; tin thừa làm
   người ta bắt đầu bỏ qua cả tin cần.
3. **Có phải việc gấp không?** Không gấp thì gộp vào một tin tổng hợp,
   đừng bắn từng đơn một.

Xem thêm [WhatYouCannotSee.md](WhatYouCannotSee.md) — **những gì đọc được không có
nghĩa là nói được.** Giá vốn, tiền, tên nhân viên: đọc được, nhưng cấm nói ra,
và điều đó áp dụng cho cả tin nhắn gửi qua đường này.
