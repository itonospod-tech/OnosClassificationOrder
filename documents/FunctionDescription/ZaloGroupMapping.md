# Nối nhóm Zalo ↔ khách hàng (Zalo Group Mapping) — Function Description

> **File FE:** `apps/web/src/pages/zalo-groups/index.tsx`, `ZaloGroupEditDialog.tsx`, `SuggestionsDialog.tsx`
> **File BE:** `apps/api/src/modules/zalo-group/` — `zalo-group.service.ts`, `zalo-summary.service.ts`, `zalo-group.controller.ts`, `zalo-group-link.entity.ts`, `zalo-group-summary.entity.ts`
> **Script:** `apps/api/scripts/sync-zalo-groups.mjs`, `apps/api/scripts/summarize-zalo-groups.mjs`
> **Route:** `/adm/zalo-groups`
> **API:** `GET /v1/zalo-groups`, `GET /v1/zalo-groups/coverage`, `GET /v1/zalo-groups/suggestions`, `POST /v1/zalo-groups/sync`, `PATCH /v1/zalo-groups/:id`



## Gộp về một engine — `onosceo` đã dừng hẳn (11/09/2026)

Trước đây chạy SONG SONG hai engine Zalo, và hai script đồng bộ đọc engine ở `onosceo`. Các nick đã được quét lại trên engine prod ở `onosnew`, nên phiên bên cũ thành `qr_pending` — máy cũ ngừng thu tin mới nhưng **vẫn giữ toàn bộ lịch sử**.

### Vì sao không tắt thẳng được

Đo trước khi chuyển: `onosceo` có **179 nhóm / 29.784 tin từ 18/08**, `onosnew` chỉ có **153 nhóm / 16.385 tin từ 07/09**. Engine chỉ biết tới một nhóm sau khi kéo được nhóm đó về, mà `Onos Ai` — nick phủ rộng nhất — mới kéo 37/178 nhóm. Tắt lúc đó là mất **62 nhóm** (42 trong số đó còn dùng trong 14 ngày) và 20 ngày lịch sử.

### Cách chuyển

Chép theo **KHOÁ TỰ NHIÊN, không theo id**: hội thoại nhận dạng bằng `(zalo_account_id, external_thread_id)`, tin nhắn bằng `(conversation_id, zalo_msg_id)`. Mỗi engine tự cấp id riêng cho cùng một nhóm, nên chép theo id là nhân đôi 117 nhóm có ở cả hai bên. Nhóm đã có thì chỉ nhét tin cũ vào hội thoại sẵn có; nhóm chưa có thì chèn mới và **giữ nguyên id cũ** (đã kiểm: 0 id đụng nhau) để liên kết trả lời/cảm xúc còn nguyên.

Ba chỗ phải xử lý riêng:

| Vấn đề | Cách làm |
|---|---|
| `zalo_account_id` khác nhau giữa hai engine | ánh xạ qua `zalo_uid` |
| `replied_by_user_id` trỏ sang `engine_users` của máy cũ (2 người vs 27) | bỏ trống — chỉ là nhãn "ai trả lời từ CRM" |
| Nick `Onos` chỉ có ở máy cũ, `owner_user_id` cũng chỉ có ở máy cũ | chép kèm, gán chủ sở hữu đang dùng, **xoá `session_data` + đặt `qr_pending`** để engine không thử đăng nhập bằng phiên của máy khác |

**Bẫy đã mắc:** bản chạy đầu thiếu `COMMIT` sau `BEGIN`. psql huỷ sạch lúc thoát mà **KHÔNG báo lỗi** — màn hình vẫn in đủ số liệu như thành công. Chỉ phát hiện khi đo lại thấy số nhóm không đổi. Script SQL nào mở `BEGIN` thủ công thì phải kiểm có `COMMIT` trước khi tin vào kết quả in ra.

### Kết quả

| | Trước | Sau |
|---|---|---|
| Nhóm (`group_global_id`) | 153 | **215** |
| Tin nhắn | 16.387 | **46.171** |
| Lịch sử từ | 07/09 | **18/08** |

8 nick đang chạy giữ nguyên `connected` + còn phiên. Engine cũ (`zalo-onos-zalo-engine-1`, DB, Redis trên `onosceo`) **đã dừng**, volume giữ nguyên làm kho tra cứu — bật lại được nếu cần đối chiếu.

### Công cụ đo

`apps/api/scripts/check-zalo-engine-parity.mjs` — so hai engine, in thẳng `✅ TẮT ĐƯỢC` hay `⛔ CHƯA`, kèm danh sách nhóm còn thiếu. Muốn chạy lại phải bật container bên `onosceo` lên trước.

Hai script đồng bộ nay mặc định đọc **`onosnew`** (`--ssh/--container/--db` để trỏ nơi khác).

### Nhãn hội thoại của engine — chuyển nốt 12/09/2026

Đợt chuyển 11/09 mang hội thoại và tin nhắn, nhưng **bỏ sót nhãn**: engine mới có
0 nhãn trong khi máy cũ giữ 14 định nghĩa và 142 lượt gắn do ops làm tay. Đã chép
đủ **142/142**.

Bảy nhãn thật (mỗi nick một bộ, nên 14 dòng): `KHACH` · `NOIBO` · `NOIBO_HEP` ·
`NCC` · `KYTHUAT` · `CHUA` · `CHUTICH`.

Cách chép: bật **CHỈ container DB** của máy cũ — bật cả engine là nó khôi phục
phiên Zalo và đá hết nick đang chạy trên máy mới. Ánh xạ nick qua `zalo_uid` và
hội thoại qua `(zalo_uid, external_thread_id)`; id nội bộ hai engine khác nhau
nên không dùng được. Giữ nguyên UUID của nhãn + `ON CONFLICT DO NOTHING` để chạy
lại không sinh trùng (đã kiểm: chạy hai lần vẫn 142).

**Nhãn cũ là dữ liệu ops đã xét, nên nó soi ra chỗ lệch với `kind` hiện tại.** Đối
chiếu 114 nhóm có nhãn: 22 nhóm có nhãn mà `kind` vẫn là `unreviewed`.

Người dùng chốt áp luôn rồi tự xem lại, nên **13 nhóm đã được gắn** (12 → `seller`
kèm khách, 1 → `operation`); `unreviewed` giảm 92 → 79. Việc này đi NGƯỢC ghi chú
cố ý ở `getSuggestions()` ("chỉ đoán, không tự gắn — gắn tự động là sớm muộn cũng
quy nhầm doanh thu sang khách khác, mà sai kiểu đó rất khó phát hiện"), nên mọi
nhóm bị đụng đều mang dấu vết trong `note`:

```
zalo_group_links.note bắt đầu bằng "Phân loại chép từ nhãn engine Zalo cũ 12/09/2026"
```

Không có dấu vết thì "để tôi xem lại" là bất khả thi — không ai nhớ nổi 13 nhóm nào.

**Bản đồ nhãn → `kind`:** `KHACH`→seller · `NOIBO`/`NOIBO_HEP`/`CHUTICH`→internal ·
`NCC`/`KYTHUAT`→operation. `CHUA` cố ý KHÔNG có mặt: bên cũ nó nghĩa là *chưa xét*,
nên không mang thông tin để áp.

**9 nhóm để lại cho người xét**, vì tự động sẽ đoán bừa: 2 nhóm nhãn `CHUA`; 6 nhóm
nhãn `KHACH` nhưng tên không theo khuôn mã seller (`BOD - Mr Khang Ecomlite`,
`OnosEx/ Zeno boss`…) — mà `kind=seller` bị chặn nếu thiếu `customerId`; và 1 nhóm
mã `THANHDOT06` **gần giống** `THANHDONAL06/07` đang có. Chốt chống nhầm: mã chung
7 ký tự đầu với khách sẵn có thì không tạo khách mới — tạo khách thứ hai cho cùng
một seller làm hỏng mọi báo cáo nối nhóm ↔ đơn.

12 khách mới sinh ra từ đây mang `source='zalo-group'`, `userEmail` để trống (khớp
đơn qua `userSku`). Đã kiểm sau khi chạy: 0 nhóm `seller` thiếu khách, 0 nhóm khác
`seller` mà có khách.

**Không bật AppModule để làm việc này.** Context đầy đủ trên prod kéo theo mailer,
RabbitMQ và **đăng ký lại repeatable job của BullMQ** — quá xâm lấn cho một lần sửa
dữ liệu. Script chỉ dùng hàm thuần `khopTenNhom` từ bản build, còn bất biến thì chép
tay từ `updateLink()` sau khi đối chiếu từng dòng.

## Nối nhóm ↔ khách: gợi ý theo khuôn tên + tạo khách ngay tại màn nối (11/09/2026)

Mục tiêu: biến trang này thành **source of truth** cho quan hệ nhóm Zalo ↔ khách, thay vì chỉ nối được tới những khách do đơn hàng sinh ra.

### Vì sao đổi

Đo trên prod 11/09/2026, trong **52 nhóm chưa xét**, luật cũ (`title.includes(userSku)`) chỉ gợi ý được **7**. Soi phần trượt thì thấy **hai nguyên nhân khác hẳn nhau**:

1. **Luật khớp quá thô** — tên nhóm có khuôn `OnosPod/ 2025/ TUYEN/ KL/ TOPUP` và mã hay dính đuôi loại tài khoản (`VUDANDEBIT`, `SIMPLEHUBDEBIT`, `XHAODEBIT`). So chuỗi con bỏ sót cả hai.
2. **Không có gì để khớp vào** — 19 nhóm trỏ tới seller THẬT (`TRINITY`, `VUDAN`, `SIMPLEHUB`, `ANHDUC06`…) nhưng **0 đơn hàng**, mà bảng `customers` sinh ra TỪ đơn hàng nên những seller đó không tồn tại. Không thuật toán nào cứu được; những nhóm này trước đây biến khỏi danh sách gợi ý mà không ai biết vì sao.

### Cách làm

`apps/api/src/modules/zalo-group/zalo-title.logic.ts` (hàm thuần + `zalo-title.logic.spec.ts`, test dùng **tên nhóm nguyên văn từ prod**):

- `macUngVien(title)` — tách theo `/`, rồi theo khoảng trắng và ngoặc; bỏ năm, bỏ từ chung (`ONOSPOD`, `VIP`, `KL`, `DEBIT`…); cắt đuôi loại tài khoản nhưng **giữ cả bản đầy đủ**, mã dài đứng trước.
- `theoKhuonSeller(title)` — có tiền tố `onospod`/`onosex` và ≥ 3 đoạn `/`. **Chỉ nhóm theo khuôn này mới được đề nghị tạo khách mới**; nhóm nội bộ đặt tên tự do ("Nhóm vải siêm - A Soi Mê Linh") vẫn moi ra được vài từ trông như mã, đề nghị tạo khách từ đó là đẩy rác vào bảng khách mà rác ở đó rất khó dọn.
- **Bỏ dấu TRƯỚC khi lọc ký tự.** Làm ngược lại thì "Nhóm" thành `NHM`, "Việt" thành `VIT` — mã rác trông y như mã thật (lỗi đã mắc ở bản đầu).

`ZaloGroupSuggestionZod` thêm `action: 'link' | 'create'`; `customerId` thành tuỳ chọn (chỉ có với `link`).

`UpdateZaloGroupLinkZod` thêm **`newCustomerSku`** — tạo khách mang mã đó rồi ghép trong CÙNG một lần gọi. Mã đã tồn tại thì ghép vào khách đó, **không tạo trùng**. Loại trừ lẫn nhau với `customerId`. Chốt "nhóm khách phải có khách" ở `updateLink` cũng tính `newCustomerSku`, nếu không thì thao tác thường gặp nhất của ops (đặt loại "nhóm khách" + tạo khách mới trong một lần bấm) bị chính chốt đó từ chối.

**Kết quả đo lại trên 52 nhóm đó:** 2 ghép khách sẵn có + 17 đề nghị tạo khách = **19 nhóm xử lý được**, 26 nhóm còn lại không đề nghị gì (đúng — chúng là nhóm vận hành/nội bộ).

### Bẫy đã vá: khách tạo từ nhóm bị nhân đôi

Khách tạo ở đây chưa biết email nên mang `userEmail: ''`. Nhưng unique index của `customers` là cặp **(userSku, userEmail)**, và `CustomerService.sync()` upsert theo đúng cặp đó — nên khi seller bắt đầu đặt đơn với email thật, sync sẽ tạo **bản ghi thứ hai** cho cùng một seller và mọi báo cáo theo khách đếm đôi.

`sync()` nay **nhận lại chỗ giữ sẵn** trước khi upsert: mã nào đang có bản ghi email rỗng thì điền email vào bản ghi đó (mỗi mã nhận một email; mã có nhiều email thì phần upsert tạo nốt như cũ). Cùng khuôn "claim" mà khách tự đăng ký đang dùng. Kiểm trên dev 11/09/2026: tạo khách từ nhóm → cắm một đơn mang email thật → chạy sync → vẫn **đúng 1 bản ghi**, và nó mang email mới.

### Giao diện cho ops

- **Hộp gợi ý**: dòng `create` có nhãn "sẽ tạo khách mới" để người duyệt phân biệt với dòng ghép thường; tick sẵn như cũ, vẫn phải bấm nút.
- **Hộp sửa nhóm**: khi chọn loại "nhóm khách", dưới ô chọn khách có thêm ô gõ mã khách mới (tự viết hoa, khoá lại khi đã chọn khách sẵn có).
- Đánh dấu "không phải nhóm khách" thì dùng ô phân loại sẵn có — chuyển sang `operation`/`internal` là nhóm rời khỏi hàng chờ.

## 1. Overview

Nối mỗi **nhóm Zalo** với **khách hàng (seller)** trong OnosFactory, để về sau
làm được báo cáo và nhắc việc dựa trên cả hai vế: nhóm đang tồn đọng gì × khách
đó đang có bao nhiêu đơn kẹt ở chặng nào.

Dữ liệu Zalo **không nằm trong hệ thống này**. Nó sống ở máy `onosceo`: engine
`ghcr.io/zero-126/zalo-engine` + Postgres riêng (database `zalo`, schema `ceo`
cho trợ lý Chủ tịch). OnosFactory chỉ giữ phần mình sở hữu — nhóm đó thuộc về
ai, ai chịu trách nhiệm, có được đưa vào phân tích không.

Trước đây mối nối này nằm ở bảng `ceo.khach` trên `onosceo` (4 dòng, khoá theo
`hoi_thoai_id`). Cả 4 mã trong đó đều khớp `userSku` bên OnosFactory, nên dữ
liệu cũ nhập lại được.

**Quy mô đo ngày 29/08/2026:** 157 dòng hội thoại nhóm trên `onosceo` = **147
nhóm thật**; OnosFactory có **132 khách**, **134 `userSku`** xuất hiện trong đơn.

## 2. Luồng hoạt động

1. Chạy `scripts/sync-zalo-groups.mjs` — đọc Postgres của engine qua SSH, **gộp
   dòng hội thoại theo `group_global_id`**, rồi POST vào `/zalo-groups/sync`.
2. Nhóm mới vào với `kind = 'unreviewed'`.
3. Người vận hành mở danh sách, dùng `/zalo-groups/suggestions` để lấy các cặp
   nhóm ↔ khách hệ thống đoán được, **duyệt từng cặp** rồi `PATCH` để gắn.
4. Nhóm không thuộc khách nào thì vẫn phải xét: đặt `kind` thành `operation`
   (nhóm vận hành) hoặc `internal` (riêng tư) — có vậy danh sách chờ mới cạn.
5. `/zalo-groups/coverage` trả bảng phủ sóng để biết còn bao nhiêu chưa xong.

### Vì sao khoá theo `groupGlobalId` chứ không phải id hội thoại

Engine lưu **một bản ghi hội thoại cho mỗi nick công ty** có mặt trong nhóm.
Nhóm "Phát triển hệ thống AI" có 2 nick nên hiện thành 2 dòng. Khoá theo hội
thoại nghĩa là người vận hành phải gắn cùng một nhóm nhiều lần, và sót một lần
là phân tích hụt dữ liệu của nick đó. `external_thread_id` cũng không dùng làm
khoá được — mỗi nick một mã khác nhau.

Đây là bài học lấy nguyên từ `thghub` (migration `20260824_zalo_group_seller_map`,
bên đó 212 dòng = 85 nhóm thật).

## 3. API / Schema

| Method | Path | Mô tả |
|---|---|---|
| GET | `/v1/zalo-groups?kind&customerId&unlinked&search&page&limit&sort&order` | Danh sách nhóm. `unlinked=true` → chỉ nhóm chưa gắn khách |
| GET | `/v1/zalo-groups/coverage` | Bảng phủ sóng: tổng nhóm, đếm theo phân loại, khách đã/chưa có nhóm |
| GET | `/v1/zalo-groups/suggestions` | Gợi ý ghép nhóm ↔ khách theo tên nhóm. Cap 200, điểm ≥ 0.5 |
| POST | `/v1/zalo-groups/sync` | Nạp nhóm từ engine. **Không** đụng `kind`/`customerId`/`ownerUserId` đã gắn |
| PATCH | `/v1/zalo-groups/:id` | Gắn/gỡ khách, đổi phân loại, chỉ định người phụ trách |
| GET | `/v1/zalo-groups/summaries?mucDo&conViec&search` | Bảng tóm tắt tình hình, gấp lên đầu |
| GET | `/v1/zalo-groups/summary-queue` | Nhóm chờ tóm tắt + mốc tin cần lấy từ (cho script) |
| POST | `/v1/zalo-groups/summarize` | Tóm tắt một nhóm từ đoạn hội thoại được đẩy sang |
| PATCH | `/v1/zalo-groups/summaries/:groupGlobalId/task` | Tick / bỏ tick một việc |

Entity `zalo_group_links` (`apps/api/src/modules/zalo-group/zalo-group-link.entity.ts`):

```ts
{
  groupGlobalId: string;      // UNIQUE + index — khoá thật của nhóm bên engine
  title?: string;             // ảnh chụp tên nhóm lúc đồng bộ
  kind: ZaloGroupKind;        // unreviewed | seller | operation | internal
  customerId?: string;        // ref CustomerEntity — RỖNG được, và rỗng có nghĩa
  userSku?: string;           // ảnh chụp lúc gắn — đơn nối với khách qua userSku
  ownerUserId?: string;       // người chịu trách nhiệm, do quản lý chỉ định
  conversationIds: string[];  // các dòng hội thoại gộp về nhóm này
  memberNicks: string[];      // nick công ty đang trong nhóm — đọc từ Zalo
  lastMessageAt?: Date;
  note?: string;
  linkedByUserId?: string; linkedAt?: Date; syncedAt?: Date;
}
```

Index: `groupGlobalId` (unique), `kind`, `customerId`, `userSku`, `ownerUserId`,
`lastMessageAt`, và index ghép `{ kind: 1, lastMessageAt: -1 }` cho danh sách chờ gắn.

`ZaloGroupKind` (`packages/shared/enums/zalo-group-kind.ts`) — 4 giá trị, kèm
`ZALO_GROUP_ANALYZABLE_KINDS` là danh sách DUY NHẤT được phép đọc nội dung chat.

## 4. UI Components

Trang `/adm/zalo-groups`, namespace i18n `zaloGroups`, quyền `page.zalo_groups`.

**`index.tsx`** — 5 ô phủ sóng trên đầu (tổng nhóm · chưa xét · đã gắn · khách có
nhóm · khách chưa có nhóm; ô cảnh báo tô hổ phách khi > 0), bộ lọc (tìm theo tên,
chọn phân loại, nút bật/tắt "chỉ nhóm chưa gắn"), rồi bảng nhóm. Mỗi dòng hiện
tên nhóm + số hội thoại + nick trong nhóm, badge phân loại, mã khách, mốc tin cuối.

**`SuggestionsDialog.tsx`** — duyệt gợi ý hàng loạt. Mọi dòng **tick sẵn** vì
phần lớn đạt 0.95; người duyệt chỉ bỏ tick dòng đáng ngờ thay vì phải tick hàng
chục dòng đúng — nhưng vẫn phải bấm nút, không có gì tự gắn. Một dòng hỏng không
làm dừng cả lô.

**`ZaloGroupEditDialog.tsx`** — gắn tay một nhóm. Đổi phân loại khỏi "nhóm khách"
thì tự gỡ khách đang chọn: BE sẽ từ chối nếu để lẫn, báo lỗi ở FE thì người dùng
phải sửa hai lần. Danh sách khách lọc phía client (132 khách thì tải một lượt rẻ
hơn gọi API mỗi lần gõ).

## 5. Backend logic

**`syncGroups()`** — upsert theo `groupGlobalId`. `$set` chỉ ghi phần đọc từ
Zalo (tiêu đề, nick, mốc tin); `kind` nằm trong `$setOnInsert` nên **chạy lại
đồng bộ không kéo nhóm đã xét về lại 'chưa xét'**. Không có chốt này thì không
ai dám chạy đồng bộ lần hai.

**`updateLink()`** — hai ràng buộc chéo trường, đặt ở service vì chúng liên quan
đồng thời `kind` và `customerId`:

- `kind='seller'` mà không có khách → chặn. Nhóm nằm trong diện phân tích doanh
  thu nhưng không quy được về ai là bản ghi vô nghĩa.
- `kind≠'seller'` mà vẫn có khách → chặn, buộc gỡ khách trước.

Lúc gắn, `userSku` được **chụp lại** từ khách. Đơn hàng nối với khách qua
`userSku`/`userEmail` chứ không qua `customerId`, nên thiếu trường này thì mọi
báo cáo nối nhóm ↔ đơn phải tra thêm một vòng sang `customers`.

**`getSuggestions()`** — so tên nhóm (đã bỏ dấu, thường hoá) với `userSku` và
`fullName` của khách. Điểm: khớp `userSku` ≥ 6 ký tự → 0.95; `userSku` ngắn hơn
→ 0.6 (mã 3-4 ký tự dễ trùng ngẫu nhiên trong câu tiếng Việt); khớp `fullName`
≥ 5 ký tự → 0.7.

**Cố ý chỉ gợi ý, không tự gắn.** Tên nhóm do người đặt tay nên đủ kiểu; gắn tự
động sớm muộn cũng quy nhầm doanh thu sang khách khác, mà sai kiểu đó rất khó
phát hiện về sau.

Một khách có thể có **nhiều nhóm** (nhóm BOD + nhóm TOPUP) — unique index đặt
trên `groupGlobalId`, không đặt trên `customerId`.

## 5b. Tóm tắt tình hình nhóm

Bảng `zalo_group_summaries`, một bản ghi hiện hành cho mỗi nhóm.

**Mô hình:** gọi qua `@anthropic-ai/claude-agent-sdk` (`query()` spawn CLI `claude`
ở `CLAUDE_CLI_PATH`; xác thực bằng phiên Claude Code `~/.claude`, KHÔNG có
`ANTHROPIC_API_KEY`). Model là ALIAS qua `ZALO_SUMMARY_MODEL` (production: `sonnet`),
`maxTurns: 3`, `allowedTools: []`. Trần thời gian `ZALO_SUMMARY_TIMEOUT_SEC`
(production 150): quá hạn thì **hủy thật** bằng `AbortController` và
`Query.close()` giết tiến trình CLI con (đo trên dev bằng cgroup của unit: sau
dòng log hủy không còn tiến trình `claude` nào). Kết quả ép khuôn bằng
`outputFormat: json_schema` (`SUMMARY_JSON_SCHEMA`), đọc `structured_output` từ
message `result`; bản CLI nào bỏ qua thì `tachJson()` tách JSON khỏi văn bản
(quét ngoặc có nhận biết chuỗi — không dùng regex tham). Lỗi cấu hình (thiếu
CLI, chưa đăng nhập) trả 503 kèm câu chỉ rõ phải làm gì.

Tám chốt (bốn đầu lấy từ `thghub`, bốn sau thêm 03/09/2026 sau khi đối chiếu 111
bản tóm tắt với tin gốc):

1. **Cuốn chiếu, không phải "N tin gần nhất".** Mỗi lượt nhận bản tóm tắt lần
   trước + tin MỚI kể từ `denMocTin`. Đo trên 191 nhóm bên thghub: cửa sổ "60 tin
   gần nhất" cho nhóm bận chỉ thấy 1,6 ngày lịch sử còn nhóm im thấy 16,2 ngày —
   nhóm càng bận càng mù, mà đó đúng là nhóm dễ có việc treo.
2. **Đọc lại từ đầu mỗi 7 ngày** (`docDayDuLuc`, đổi bằng `ZALO_SUMMARY_REREAD_DAYS`).
   Tóm tắt cuốn chiếu có bệnh trôi dần — một kết luận sai được chép lại mãi.
3. **Việc cần làm ra checklist, không phải văn xuôi.** thghub chạy thử 6 nhóm:
   văn xuôi 3–4 dòng đọc thì hiểu nhưng không làm theo được.
4. **Ô `nghiNgo`** — việc đã tick xong mà mô hình không thấy bằng chứng. Thiếu ô
   này thì việc tick khống bị `gopChecklist` nuốt mất, tệ hơn cả không có nút tick.

5. **Sàn `mucDo` từ dữ liệu đơn** (`apDungSanMucDo`): đơn NHẮC TRONG CHAT đang
   bị giữ/lỗi → ít nhất `gap`; chỉ đơn toàn khách bị giữ/lỗi → ít nhất
   `can-chu-y`; không bao giờ hạ. Không sàn `gap` theo số toàn khách, kẻo một
   khách lớn có một đơn giữ cũ làm mọi nhóm của họ đỏ mãi. Nâng mức thì ghi log.
6. **Bỏ đọc lại khi không có tin có nội dung** (`quyetDinhHangDoi` + script + chốt
   trong `summarize()`): `lastMessageAt` đếm cả tin không nội dung, `denMocTin`
   chỉ tin có nội dung — không có tin nào sau `denMocTin` thì không gọi mô hình
   và KHÔNG đụng `docDayDuLuc`. `--group` gửi `epDocLai: true` để bỏ chốt khi kiểm thử.
7. **Kéo đúng 400 tin MỚI NHẤT** (`summarize-zalo-groups.mjs` `keoTin`): ba lớp
   khử trùng → `ORDER BY luc DESC LIMIT 400` → xếp xuôi. `DISTINCT ON` ép sắp theo
   `zalo_msg_id`, đặt `LIMIT` cùng lớp là lấy 400 tin CŨ nhất (đã gặp: tóm tắt
   dừng ở 25/08 trong khi chat tới 01/09).
8. **JSON hỏng / hết lượt → 422, KHÔNG thử lại** (processor coi
   `UnprocessableEntityException` là `UnrecoverableError`): gọi lại y nguyên cũng
   hỏng y nguyên, mỗi lần một lượt trả tiền. Nhóm tự vào hàng đợi ca sau vì
   `denMocTin` không tiến.

`gopChecklist()` giữ id/tick/mốc của việc **giống** qua các lượt — khớp mờ
(`doGiongViec`: bỏ dấu, Dice trên tập từ, ngưỡng 0,6; hai việc cùng nhắc mã đơn
mà khác mã thì KHÔNG BAO GIỜ gộp; mỗi việc cũ ghép đúng một việc mới). Bản cũ
khớp y nguyên chữ nên mô hình đổi một từ là mất tick. Mỗi việc có `id` ổn định
(uuid). Chống mất tick trong lúc mô hình chạy 40–150 giây: `summarize()` ĐỌC LẠI
checklist SAU khi mô hình trả lời rồi ghi có điều kiện theo `checklistRev`
(`toggleTask` `$inc`), tối đa 3 vòng. Rủi ro chấp nhận: hai việc na ná ("Gửi mẫu
A"/"Gửi mẫu B") có thể gộp nhầm — lưới an toàn là ô `nghiNgo`, và gộp nhầm rẻ hơn
nhiều so với mất 100% tick như trước.

### Đợt điều chỉnh chất lượng nội dung (03/09/2026)

Đối chiếu 111 bản tóm tắt production với tin gốc trên engine (`onosceo`), sửa
theo bằng chứng đo được — chi tiết từng lỗi ở commit của nhánh
`feat/zalo-summary-quality`:

- **Đính kèm → chữ** (`moTaDinhKem`): 20% tin là JSON thô `{"title":"x.pdf","href":…}`.
  Đổi thành `[TỆP: tên]`, `[ẢNH]`, `[VIDEO]`, `[LIÊN KẾT: tiêu đề]`, `[STICKER]`,
  không in URL; lời nhắc nói rõ dòng đó là BẰNG CHỨNG đã gửi. Ca thật: PDF gửi
  31/08 17:50 mà bản cũ kết luận "chưa gửi".
- **Nhóm vận hành = nhân viên + ĐỐI TÁC, không có khách** (`loiNhacHeThong(kind)`,
  `ZALO_PARTNER_CHAT_LABEL`): lời nhắc mở/kết theo `link.kind`; người ngoài công ty
  trong nhóm `operation` dán nhãn ĐỐI TÁC; bản tóm tắt lưu `kind` để UI đổi nhãn ô
  thành "Bên yêu cầu"/"Người xử lý". Không thêm loại danh tính `partner`: cái sai là
  hàm của NHÓM, không phải của người.
- **Heuristic danh tính nhìn loại nhóm** (`doanPhanLoai(groupCount, laTaiKhoanCongTy, loaiNhomDuyNhat)`):
  người ở đúng 1 nhóm chỉ đoán "khách" khi nhóm đó là `seller`; snapshot sync mang
  `groupGlobalIds`. Đo trên dev: gợi ý "khách" cho người 1 nhóm giảm 194 → 94.
  Dòng đã xác nhận không bị viết lại.
- **`coTinMoi`** (tính lúc gọi, không lưu): `lastMessageAt` của nhóm > `denMocTin`
  của tóm tắt → bảng tóm tắt, bảng nhóm (`tomTat.coTinMoi`), và
  `GET /v1/agent/seller-support` đều mang cờ; UI hiện huy hiệu vàng "Có tin mới lúc
  …, chưa tóm tắt". Tươi tới lần `sync-zalo-groups` gần nhất.
  **`lastMessageAt` phải đếm cùng bộ lọc với bộ tóm tắt** (bỏ tin đã THU HỒI và tin
  rỗng): cột `last_message_at` của engine đếm cả hai, nên nhóm mà tin mới nhất là tin
  thu hồi bị kẹt vĩnh viễn — hàng đợi lần nào cũng gọi, kéo về 0 dòng rồi bỏ qua, huy
  hiệu thì sáng mãi. Đo 04/09: 2/111 nhóm đang kẹt đúng kiểu đó, sửa xong sạch cả hai. Khác `tomTatTre`
  (đo tuổi bản tóm tắt) — hai cờ đo hai thứ.
- **Khối đơn của khách là BỐI CẢNH, không phải tồn đọng của nhóm**: khách có nhiều
  nhóm thì mọi nhóm nhận cùng khối; tiêu đề khối nói rõ và lời nhắc cấm chép vào
  `tonDong`/`checklist` trừ khi chat nhóm đó nhắc tới. Không dedupe trong code vì
  không có căn cứ chọn "nhóm chính".
- **Mã chép nguyên văn**: lời nhắc cấm viết tắt/"sửa chính tả"/ghép mã; tra thêm
  `externalId`; sau mỗi bản, mã trong đầu ra mà không có trong NGUỒN
  (`maKhongCoTrongNguon`) ghi `warn` `[zalo-summary] mã không có trong chat: …` —
  KHÔNG tự sửa. **Nguồn phải gồm đủ ba phần** mô hình được đọc: tin nhắn, khối dữ
  liệu đơn, VÀ bản tóm tắt lần trước (lượt cuốn chiếu chỉ gửi tin MỚI, mã cũ nằm ở
  bản trước); mã là khúc con của mã có thật (`AS-02077` ⊂ `AS-02077-17505`) coi là
  cắt cụt, không báo. Đo trên dev 03/09: bản thiếu hai luật này kêu 28 lần/67 bản
  mà 20/27 mã kiểm lại là kêu oan; sau khi sửa còn 0/5.
- **Sàn `mucDo` ghi log cả khi không nâng** (`bằng chứng đơn (nhắc: …, khách: …)`):
  im lặng thì không phân biệt được "không có bằng chứng" với "hàm đếm hỏng".
- **Kiểm thử**: hàm thuần ở `zalo-summary.logic.ts` / `zalo-identity.logic.ts`
  (+ `.spec.ts`, 54 ca) — `NODE_ENV=test npx jest src/modules/zalo-group`. Kiểm
  một nhóm đích danh không chờ cron: `node scripts/summarize-zalo-groups.mjs --yes
  --group <groupGlobalId> --api … --token …` (ép đọc lại toàn bộ + `epDocLai`).

**Chốt riêng tư kiểm HAI lần:** ở hàng đợi (`getQueue`) và ở chính
`summarize()`. Endpoint gọi trực tiếp được, mà đọc nhầm nhóm `internal` là đọc
đời tư nhân viên.

**Bỏ qua nhóm im > 14 ngày** (`ZALO_SUMMARY_IDLE_DAYS`) — không tốn tiền gọi mô
hình cho nhóm chẳng có gì thay đổi.

## 6. Performance notes

- Đồng bộ 147 nhóm: 157 dòng Postgres → 147 lệnh `updateOne` upsert. Đo trên
  dev 29/08: đọc + gộp + đẩy xong dưới 3 giây.
- `getSuggestions()`: 1 lượt đọc nhóm chưa xét + 1 lượt đọc khách, ghép trong bộ
  nhớ — 147 nhóm × 132 khách = 19.404 phép so chuỗi, trả về trong ~1 giây. Khi
  số nhóm lên vài nghìn thì phải chuyển sang lọc trước bằng index text.
- `getCoverage()`: 5 truy vấn chạy song song (`aggregate` + 3 `countDocuments` +
  1 `distinct`), không cache vì gọi theo nhu cầu.

## 7. Permissions

| Nhóm quyền | Role | Được làm gì |
|---|---|---|
| `ZALO_GROUP_VIEW_ROLES` | SuperAdmin, Admin, Manager, SupportManager, Support | Xem danh sách + bảng phủ sóng |
| `ZALO_GROUP_EDIT_ROLES` | SuperAdmin, Admin, Manager | Đồng bộ, xem gợi ý, gắn/gỡ nhóm |

Quyền sửa hẹp hơn quyền xem có chủ ý: gắn sai là quy nhầm doanh thu sang khách khác.

**Chốt riêng tư:** nhóm `kind='internal'` là nhóm cá nhân của nhân viên (nhóm
gia đình, nhóm lớp, tổ dân phố) lẫn trong dữ liệu Zalo. Mọi bước đọc nội dung
chat ở các phase sau **bắt buộc** lọc qua `ZALO_GROUP_ANALYZABLE_KINDS` — đưa
nhóm internal vào mô hình là đọc đời tư nhân viên.

## 8. Lộ trình

| Phase | Nội dung | Trạng thái |
|---|---|---|
| P1 | Mô hình dữ liệu + đồng bộ + gợi ý + API gắn nhóm | ✅ xong |
| P1b | Màn hình gắn nhóm `/adm/zalo-groups` + duyệt gợi ý hàng loạt | ✅ xong |
| P2 | Tóm tắt cuốn chiếu nội dung nhóm + màn hình Tình hình | ✅ chạy production 4 lần/ngày (7h·12h·17h·20h VN) |
| P3 | Báo cáo cho Chủ tịch — cắm vào `ScheduledReportsModule` | chưa làm |
| P4 | Nhắc việc hai chiều: checklist → nhắn ngược vào nhóm Zalo | chưa làm |

**Việc chặn P2:** OnosFactory chưa gọi được engine Zalo. Máy `onoshub` có
tailscale (`100.124.188.28`) nhưng ở tailnet khác `onosceo` (`100.78.72.36`), và
engine chỉ nghe `127.0.0.1:4000`. Đến khi hai máy chung tailnet thì mọi đường
đọc chat đều phải đi vòng qua SSH như `sync-zalo-groups.mjs` đang làm.

## Một lệnh gọi cho AI agent — `GET /v1/agent/seller-support`

> **BE:** `apps/api/src/modules/agent-api/agent-seller-support.service.ts`
> **Tuyến:** `apps/api/src/modules/agent-api/agent-api.controller.ts` → `getSellerSupport()`
> **DTO:** `packages/shared/dtos/agent-api.dto.ts` (`AgentSellerSupportQueryZod` / `AgentSellerSupportItem`)
> **Xác thực:** header `X-Agent-Api-Key` (không JWT), cùng hạn mức với các tuyến agent khác.

### Vì sao có

Agent trả lời khách / báo cáo chủ tịch cần 4 nguồn cùng lúc: tóm tắt nhóm Zalo,
phân loại nhóm, số liệu đơn của khách đó, và sản phẩm họ hay đặt. Trước đó agent
phải tự ghép 4 bảng — bốn vòng gọi cho một câu hỏi, và mỗi chỗ ghép sai là một
câu trả lời sai gửi tới khách. Tuyến này gộp lại thành một lệnh.

### Tham số

| Tham số | Ý nghĩa |
| --- | --- |
| `mucDo` | Lọc `gap` / `can-chu-y` / `binh-thuong` |
| `userSku` | Lọc một khách |
| `limit` | Mặc định 50, trần 200 |
| `kemSanPham=false` | Bỏ phần sản phẩm cho nhẹ |

### Trả về mỗi nhóm

- `tomTat` — nội dung do mô hình soạn, kèm **`tomTatLuc`**: agent PHẢI xem mốc này
  trước khi tin, vì tóm tắt có thể cũ nhiều ngày nếu lịch chạy hỏng (mà hỏng thì
  im lặng, không báo lỗi).
- `donHang` — số liệu đọc **sống** lúc gọi: `tongDon` / `dangLam` / `dangLoi` /
  `dangGiu` / `tonLauNhatNgay`. Khác với con số trong `tomTat` vốn là ảnh chụp
  lúc mô hình chạy.
- `sanPhamHay` — 5 sản phẩm khách đặt nhiều nhất 30 ngày.

### Hai bẫy đã dẫm phải

**Chốt riêng tư nằm ở khâu ghi, không ở tài liệu.** Nguồn là
`zalo_group_summaries`, mà bảng đó chỉ chứa nhóm `seller`/`operation` — tóm tắt
bị XOÁ khi nhóm chuyển sang `internal`. Nên nhóm cá nhân nhân viên không bao giờ
lọt ra tuyến này, kể cả khi người gọi quên lọc.

**`$ifNull` là bắt buộc trong phép gộp.** Nhiều đơn KHÔNG CÓ trường `heldAt` /
`productionError` / `fulfillmentCompletedAt` chứ không phải bằng `null`. Trong
biểu thức gộp của MongoDB, trường thiếu không bằng `null`, nên `$eq` sai ở mọi
dòng còn `$ne` đúng ở mọi dòng. Bản đầu báo 4.496 đơn "đang giữ" trong khi thực
tế là 0.

## Gán người phụ trách + nối danh tính (chuẩn bị cho agent nhắn vào nhóm)

> **FE:** `apps/web/src/pages/zalo-groups/index.tsx` (cột "Người phụ trách") ·
> `apps/web/src/pages/zalo-groups/IdentitiesPanel.tsx` (cột "Tài khoản hệ thống")
> **BE:** không đổi — `ownerUserId` và `userId` đã có sẵn trong entity lẫn DTO từ đầu,
> chỉ chưa có chỗ nhập.

### Vì sao cần

Agent đọc được vấn đề trong nhóm vận hành, nhưng muốn **báo cáo và tag đúng người**
thì phải trả lời được hai câu: nhóm này ai phụ trách, và nick Zalo kia là nhân viên nào.
Trước task này cả hai đều trống — 0/53 nhóm có người phụ trách, 0/251 danh tính nối
với tài khoản.

Bằng chứng cho thấy thiếu bước này thì gửi tin vô nghĩa: nhóm `VNP/ONOS vận hành ship`
đã có "Trợ Lý AI" báo 2 việc quá hạn từ 22/08, **treo 9 ngày không ai xác nhận** —
vì tin gửi chung chung, không tag ai cụ thể.

### Thiết kế

Chọn **ngay trên danh sách**, không qua hộp thoại. Gán 53 nhóm mà phải mở 53 lần
hộp thoại thì thực tế không ai làm hết.

Lưu **ngay khi chọn**, không có nút Lưu; cập nhật màn hình trước rồi mới gọi API,
hỏng thì trả lại giá trị cũ. Ô chọn chặn nổi bọt sự kiện để bấm vào không mở luôn
ngăn chi tiết bên phải.

Cột "Tài khoản hệ thống" chỉ hiện ô chọn với danh tính `staff` / `ai-support` —
khách nối qua `customerId` ở chỗ khác, hiện ô ở đó chỉ gây nhầm.

### Còn thiếu để agent nhắn được vào nhóm

Engine Zalo bên `onosceo` **đã có sẵn đường gửi**: `POST /api/public/messages/send`
(xác thực `X-Api-Key`, đã gửi 977 tin từ 2 tài khoản công ty). Hệ thống Onos chưa
gọi sang. Nối được nhưng nên chạy chế độ **soạn sẵn — người duyệt — mới gửi**:
agent tự nhắn vào nhóm vận hành mà sai một lần thì sau đó không ai đọc tin nó nữa.

### Hai sửa đổi từ phản hồi của dev tích hợp (31/08)

**Ngừng gửi `stackTrace` ra thân phản hồi.** Trước đó MỌI endpoint công khai trả
về đường dẫn `/root/.vibedev/repos/onos/...` cùng cấu trúc mã cho bất kỳ ai gọi —
kể cả khi chỉ gõ sai khoá API. Nguyên nhân: hai filter ở `packages/core/filters/`
gắn điều kiện vào `isDevelopment`, mà **production của hệ thống này chạy với
`NODE_ENV=development`** (env chỉ dùng để chọn file cấu hình, không phản ánh môi
trường thật). Lỗi này đã tồn tại trên production thật từ trước, không phải mới.

Sửa: thêm `ApiConfigService.exposeStackTrace` — công tắc TƯỜNG MINH `EXPOSE_STACK_TRACE=true`,
mặc định tắt, truyền vào cả `CustomExceptionFilter`, `UnprocessableEntityFilter`
và `AgentExceptionFilter`. Vết lỗi vẫn ghi ra log máy chủ như cũ. **Không đổi chữ
ký hàm trong `packages/core`** — chỉ đổi giá trị truyền vào ở `main-nest.ts`.

**Thêm `tomTat.tomTatTre`** (`AGENT_TOM_TAT_HAN_GIO = 24` giờ). Có `tomTatLuc` rồi
vẫn cần cờ này: so mốc là thứ client dễ quên nhất, mà quên thì agent trả lời khách
bằng dữ liệu cũ với giọng chắc chắn. Tính ở máy chủ thì mọi client được bảo vệ như
nhau. Đề xuất của dev tích hợp — họ đã dính đúng lỗi đó ở hệ báo cáo bên mình.

## Gắn phân loại suy từ KHUÔN TÊN nhóm (15/09/2026)

Chủ tịch đổi tên nhóm hàng loạt theo khuôn (`OnosPod/`, `OnosEx/`, `BOD -`,
`NCC/`, `OnosNB/`, `Vải/`, `Khẩn cấp:`), nên tên nhóm giờ mã hoá luôn phân loại.

**Luật không do người viết script đặt.** Script đọc các nhóm ops ĐÃ xét, tính mỗi
tiền tố dẫn tới `kind` nào, và chỉ áp khi tiền tố đó có **≥3 nhóm mẫu** và **≥80%
áp đảo**. Tự gõ bảng "OnosPod = khách" là nhét phán đoán của người viết script vào
dữ liệu vận hành; học từ quyết định của ops thì sai ở đâu cũng truy ngược được, và
luật tự cập nhật khi ops xét thêm.

Sáu tiền tố đủ điều kiện: `ONOSPOD` (43 mẫu, 95% seller) · `ONOSNB` (14, 93%
operation) · `ONOSEX` (10, 100% seller) · `BOD` (8, 88% seller) · `VẢI` (5, 100%
operation) · `VNP` (3, 100% operation) · `ONOSPOD PN` (3, 100% seller). Các tiền tố
còn lại rơi vào *ít mẫu* hoặc *lẫn lộn* → để người xét.

**Kết quả: 23 nhóm** (22 → `seller` kèm khách, 1 → `operation`); chưa xét 92 → 69;
7 khách mới `source='zalo-group'`. Bất biến sau khi chạy: 0 nhóm `seller` thiếu
khách, 0 nhóm khác `seller` mà có khách. Dấu vết: `note` bắt đầu bằng
`Phân loại suy từ khuôn tên nhóm 15/09/2026`.

Chốt chống nhầm mã (trùng 7 ký tự đầu với khách sẵn có) bắt đúng ba ca đáng ngờ và
để lại cho người xét: `THANHDOT06` cạnh `THANHDONAL06/07`, `VUTHANH` cạnh
`VUTHANHV4`, `ANHDUC06` cạnh `ANHDUC06V4` — tạo khách thứ hai cho cùng một seller
là hỏng mọi báo cáo nối nhóm ↔ đơn.

**Đường gửi của agent không bị ảnh hưởng.** 22 nhóm chuyển sang `seller` vốn đang
là `unreviewed` — cả hai đều nằm ngoài danh sách trắng gửi, nên không mất quyền
nhắn nào; nhóm duy nhất sang `operation` thì được thêm. Đã kiểm sau khi chạy: gửi
nhóm nội bộ ✅, đọc nhóm vận hành ✅, gửi nhóm khách vẫn bị chặn ✅.

## Tách `internal` khỏi `private` — tóm tắt giờ phủ cả nhóm nội bộ (13/09/2026)

Bên tiêu thụ xin phủ tóm tắt cho `kind=internal` (agent tài chính/nội bộ cần
nhóm như *Kế Toán Onos Group*). Làm được, nhưng yêu cầu đó bỏ sót một mảnh: nhãn
`internal` CHÍNH LÀ chốt riêng tư, nên cho nó vào diện phân tích là **mất luôn
cái nhãn để nói "đừng đọc nhóm này"**.

Mà tài liệu và thực tế đang nói hai chuyện khác nhau. Enum viết `Internal` =
"nhóm riêng tư / không liên quan công việc (nhóm gia đình, nhóm lớp, nhóm tổ dân
phố)". Đo trên prod: **10/10 nhóm mang nhãn này là việc công ty** — Kế Toán Onos
Group, Report Ceo, Tín Dụng Onos - Vietinbank, Thanh toán IT, Phát triển hệ
thống… Không một nhóm gia đình/lớp/tổ dân phố nào. Người vận hành đã dùng nhãn
theo nghĩa "nội bộ công ty" từ đầu.

Nên tách hẳn:

| `kind` | Nghĩa | Phân tích / tóm tắt | Agent đọc & nhắn |
|---|---|---|---|
| `seller` | Nhóm khách (phải có `customerId`) | ✅ | ⛔ (chốt riêng ở agent) |
| `operation` | Nhóm vận hành, có đối tác ngoài | ✅ | ✅ |
| `internal` | **Nội bộ CÔNG TY** | ✅ (mới) | ✅ |
| `private` | **Riêng tư của nhân viên** (MỚI) | ⛔ bao giờ cũng vậy | ⛔ |
| `unreviewed` | Chưa ai xét | ⛔ | ⛔ |

`ZALO_GROUP_ANALYZABLE_KINDS` thêm `Internal`, nên `getQueue()` và
`assertDuocDocChat()` phủ nhóm nội bộ mà không phải sửa chỗ nào khác — đó là lợi
ích của việc mọi chốt đọc chat đi qua đúng một hằng số.

**Không nhóm nào bị dời sang `private`** vì hiện chưa có nhóm riêng tư nào bị gắn
nhãn; nhãn sinh ra để dùng cho lần tới, khi một nhóm gia đình lọt vào danh sách
chờ xét. Badge màu đỏ, khác hẳn `internal` màu ngọc — hai nhãn cùng màu là mời
người xét bấm nhầm đúng chỗ không được nhầm.

Chốt gửi/nghe của agent (`NHOM_DUOC_GUI`, `nhomDuocNghe`) là danh sách **TRẮNG**,
nên `private` tự bị loại, và mọi nhãn sinh ra sau này cũng vậy. Viết dạng đen
(chặn `seller`, cho phần còn lại) thì mỗi nhãn mới là một lỗ hổng im lặng.

## Tóm tắt nhóm giờ có LỊCH — 4 tiếng một lượt (13/09/2026)

Trước đây **không có lịch nào**. Bộ tóm tắt do người chạy tay bằng
`scripts/summarize-zalo-groups.mjs`, và dấu vết nói đúng điều đó: 56 bản ngày
09/09, 18 bản 08/09, 3 bản 10/09, rồi dừng. Bên tiêu thụ (agent) thấy `tomTatLuc`
đứng yên 3 ngày và đoán "cron hỏng sau đợt gộp engine" — không có cron nào để hỏng.

**Vì sao script phải ở ngoài, và vì sao giờ không cần nữa.** Engine Zalo từng nằm
trên máy khác (`onosceo`) nên API không gọi tới được; script đứng giữa: ssh sang
đọc Postgres của engine rồi POST vào `/zalo-groups/summarize` kèm **JWT admin**.
Ràng buộc đó mất khi engine dời về cùng máy (11–12/09), nên vòng lặp vào trong
được — và cái giá mà thiết kế cũ sắp phải trả, **một token admin nằm trên đĩa cho
cron dùng**, không phải trả nữa.

| | |
|---|---|
| Cron | `zalo-summary-sweep`, `0 */4 * * *` giờ VN (6 lượt/ngày) |
| Trần mỗi lượt | `ZALO_SUMMARY_SWEEP_LIMIT`, mặc định **30 nhóm** — mỗi nhóm là MỘT lần gọi mô hình |
| Chọn nhóm | `getQueue()` sẵn có: chốt riêng tư (chỉ `seller`/`operation`), bỏ nhóm im > `ZALO_SUMMARY_IDLE_DAYS` (14), bỏ nhóm đã tóm tắt tới đúng tin cuối |
| Đọc lại từ đầu | mỗi `ZALO_SUMMARY_REREAD_DAYS` (7) — cắt bệnh trôi dần của tóm tắt cuốn chiếu |

Lượt quét chỉ **kéo tin + xếp hàng**; worker BullMQ sẵn có làm phần gọi mô hình,
nên một nhóm hỏng không làm dừng cả lượt.

⚠️ **Engine chặn `limit` ≤ 200 mỗi lời gọi đọc tin**, và xin quá thì nó trả `400
invalid_query` chứ KHÔNG cắt bớt. Lượt quét đầu tiên (12:00 ngày 13/09) xin 400
tin/hội thoại nên trượt sạch 30 nhóm trong một giây — và trượt theo kiểu khó thấy
nhất: lỗi bị bắt ở tầng dưới (`ZaloEngineService`), nên log của lượt quét chỉ hiện
"đã xếp hàng 0/30", đọc y như "không nhóm nào có gì mới". `tinCuaHoiThoai()` giờ tự
chia trang; trang 1 là tin MỚI NHẤT (đã kiểm: 2.323 tin → 400 tin, 400 khác nhau,
không trùng giữa hai trang).

### Lỗi cùng đợt: đọc tin nhóm bị nhân bản

`GET /v1/agent/zalo/groups/:id/messages` trả **mỗi tin một lần cho mỗi nick công
ty** trong nhóm: nhóm 2 nick trả 30 tin cho 15 câu thật; nhóm 7 nick thì 7 lần.
Đúng cái bẫy `Architecture/Common_Pitfalls.md §12`, lần này ở endpoint agent đang
đọc hằng ngày.

Phần gộp + khử trùng theo `zaloMsgId` đã dời vào **`modules/zalo-engine/`**
(`ZaloEngineService`) làm cửa đọc engine duy nhất, dùng chung cho bộ API agent và
bộ tóm tắt. Để mỗi bên tự khử trùng thì sớm muộn một bên sửa một bên không, mà lỗi
đó không hiện thành lỗi — nó hiện thành "mỗi câu đọc được bảy lần".

## Loại danh tính `chairman` + uid Zalo phụ thuộc nick đang nhìn (12/09/2026)

`ZaloIdentityKind` thêm `Chairman`. Không phải để đẹp bảng: Chủ tịch nhắn trong
nhóm là **một điều kiện kích hoạt agent** (`AgentApi.md` §3.4), nên nó phải diễn
đạt được ở tầng dữ liệu chứ không nằm ở hằng số trong mã. Luật gợi ý
(`zalo-identity.logic.ts`) **không bao giờ tự đoán** loại này — đây là phán đoán
của người, đánh dấu ở màn *Danh tính*.

**Phải đánh dấu ĐỦ mọi dòng của ông, không phải một dòng.** Đo trên prod 12/09:

| Người | Số uid | Vì sao |
|---|---|---|
| Chủ tịch ("Onos") | **8** | mỗi nick công ty thấy ông dưới một uid riêng |
| "Hoàng Anh" | 8 | như trên |
| nick trợ lý "Onos Ai" | 7 | khi bị người khác @ |

uid Zalo **phụ thuộc nick đang nhìn**. Bảng `zalo_identities` vì thế có nhiều
dòng cho cùng một người, và đó là đúng — khoá theo `zaloUid` vẫn là lựa chọn
đúng (xem ghi chú đầu `zalo-identity-kind.ts`), chỉ là một người chiếm nhiều khoá.
Thiếu một dòng thì trong nhóm mà nick đó trực, agent im lặng **không có triệu
chứng gì**.

Thêm một hệ quả đã suýt ship hỏng: `zalo_accounts.zalo_uid` (uid nick tự nhìn
mình) **KHÁC** uid người khác thấy nó, nên so `mentions[].uid` với bảng account
luôn trượt. Chi tiết + cách phòng: `Architecture/Common_Pitfalls.md §12`.

Công cụ: `apps/api/scripts/setup-zalo-inbound.mjs --chairman <uid,uid,...>
--agent-nick <uid,...> --sync-identities` (ghi cả blob cấu hình lẫn bảng danh
tính, để hai nguồn không lệch nhau).

## Vận hành trên production (từ 02/09/2026)

Hai máy, chia việc theo mạng — không gộp được vì **production không SSH sang
`onosceo`** (nguồn tin nhắn Zalo), chỉ máy hub sang được.

| Việc | Chạy ở | Lịch | Ghi chú |
| --- | --- | --- | --- |
| Kéo đơn OnosPod + phục hồi đơn giữ | production (`crontab` root) | `*/30`, `17 * * * *` | gọi `localhost:3007`, cần `ONOSPOD_*_TOKEN` |
| Đồng bộ nhóm → danh tính → xếp hàng tóm tắt | **hub** `/root/onos-jobs/zalo-daily.sh` | `0 7 * * *` giờ VN | đăng nhập `api.onosfactory.com`, log `/var/log/onos-zalo-daily.log` |
| Worker tóm tắt (BullMQ + Claude) | production, trong tiến trình API | theo hàng đợi | cần `CLAUDE_CLI_PATH`, `ZALO_SUMMARY_MODEL=sonnet`, `ZALO_SUMMARY_TIMEOUT_SEC=150`, và `~/.claude/.credentials.json` |

Ba bước của lịch hub **phải theo thứ tự**: đồng bộ nhóm cập nhật `lastMessageAt`;
không có nó thì hàng đợi tóm tắt luôn rỗng và báo "không có gì" — hỏng im lặng.

**Hai chỗ đã dẫm phải khi dựng:**

- `CLAUDE_CLI_PATH` phải là đường dẫn **ổn định** dưới
  `~/.local/share/fnm/node-versions/<v>/installation/...`. `command -v claude`
  trong shell trả về `/run/user/0/fnm_multishells/...` — thư mục tạm theo phiên,
  PM2 sinh worker sẽ không thấy. File đích tên `claude.exe` nhưng là ELF thật,
  không cần `node` trong PATH.
- Phiên Claude chép từ hub là **phiên đăng nhập, sẽ hết hạn**. Hết hạn thì worker
  hỏng im lặng; cờ `tomTatTre` trên endpoint agent là lưới an toàn duy nhất.
  Đường dài nên thay bằng `ANTHROPIC_API_KEY`.

`EXPOSE_STACK_TRACE` để trống trên production (mặc định tắt).

