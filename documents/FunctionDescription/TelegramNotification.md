# Telegram Notification & Scheduled Reports — Function Description

> **File BE:**
>  - `apps/api/src/modules/telegram-notification/` — gửi tin + format 3 view báo cáo (+ `REPORT_CALLBACKS`)
>  - `apps/api/src/modules/scheduled-reports/` — cron 2 lần/ngày (11:30 + 17:00, mỗi lần 2 message SLA + Designer) + aggregate + webhook nút bấm Telegram
>  - `apps/api/src/utils/designer-flow.ts` — `designerFlowConds()` (TÁCH từ `DesignerStatsService`, dùng chung Dashboard + sidebar + báo cáo)
>  - `packages/core/services/telegram.service.ts` — HTTP client bot (`sendMessage` + `answerCallbackQuery` + `setWebhook`)
>  - `apps/api/src/shared/services/api-config.service.ts` → `config.telegram` (+ `webhookUrl`/`webhookSecret`) + `config.scheduledReports`
>
> **File FE:**
> - `apps/web/src/pages/home/SendTelegramReportButton.tsx` — nút Dashboard header (Admin) mở **popover 3 lựa chọn**: Tổng quan / Theo designer / Theo xưởng → gửi view tương ứng vào Telegram
> - `apps/web/src/services/reports.ts` → `runNow(view)` (`?view=daily|designer|factory`)
>
> **API:** `POST /api/v1/reports/run-now` (Admin) + `POST /api/v1/telegram/webhook` (public — Telegram gọi vào, verify secret token)

---

## 1. Overview

### 1.1 Phase 1 — Notification theo sự kiện (ĐÃ GỠ 2026-08-17)
Import summary khi `POST /v1/orders/import` — **đã gỡ theo yêu cầu user** (xóa hook `sendImportSummaryNotification` + `notifyImportSummary` + `format/import-summary.formatter.ts` + type/channel key `importSummary`; OrderModule không còn import TelegramNotificationModule).

### 1.2 Phase 3 — Báo cáo "Đơn 3 ngày liền kề" + 3 view (2026-08, thay 3 báo cáo cũ)

**1 lần aggregate** (`DailyOrdersAggregator`) cấp dữ liệu cho **3 view**, mỗi view 1 nút trên message Telegram:

| Nút | callback_data | Nội dung |
|---|---|---|
| 🔄 Cập nhật | `rpt:daily` | **View chính (cron gửi view này) = SLA-only**: bảng SLA 7 ngày làm việc + bảng 🚨 tồn sau hạn N2 + bảng 🏭 tồn theo xưởng (%). Phễu + khách ưu tiên KHÔNG còn ở đây (2026-08-17, dời sang 📋 Chi tiết) |
| 📋 Chi tiết | `rpt:detail` | Phễu vòng đời `REPORT_DAY_COUNT` ngày + section ⭐ Khách ưu tiên (`formatDetailReport` — nguyên trạng view chính CŨ) |
| 👤 Designer | `rpt:designer` | Tách theo ngày, mỗi designer 1 dòng (mirror bảng "Tất cả designer theo ngày") + dòng 🚨 lỗi chưa gán |
| 🔍 Soát tool | `rpt:tool` | Bảng soát tool xoay ngang (Tổng/Chưa soát/Đã soát/Note ko ok/Soát OK/Cần làm lại × N ngày) — mirror "Tổng quan theo ngày" tab Soát tool |
| 🏭 <tên xưởng> | `rpt:fac:<factoryId>` | **1 nút / xưởng SX** (động, loại US) → phễu + section SLA cùng LỌC theo xưởng đó (bỏ khách ưu tiên + bỏ bảng tồn theo xưởng) |

> `REPORT_DAY_COUNT = 4` ngày. Nút xưởng dựng động từ `data.factories` (`listProductionFactories`). Nút cũ "🏭 Xưởng" gộp (per-day factory summary) đã bỏ.

**Định nghĩa số (đã chốt với user 2026-08-01):**
- Cửa sổ: `REPORT_DAY_COUNT = 3` ngày liền kề (hôm kia/hôm qua/hôm nay), bucket `inProductionAt` giờ VN.
- **Scope MIRROR bảng "Tổng quan N ngày" Dashboard (`getDailyOverview`)**: loại đơn hủy (`cancelledAt`) + **đơn chưa map xưởng** + xưởng US (`productionFactoryClause`).
- `stockOut` — đơn xong công đoạn Đóng hàng (`fulfillmentCompletedAt` có giá trị).
- 4 trạng thái thiết kế = đơn **đã gán designer** theo `designerStatus`: cần làm (assigned) / làm lại (rework) / đang làm (in-progress) / đã xong (done) — khớp ma trận `getTeamDailyBreakdown`.
- **Tồn thiết kế** = `designerFlowConds().backlogCond` (chưa soát ∪ đã gán chưa xong ∪ đang lỗi chưa gán) — KHÔNG còn đếm `designerStatus ≠ done` trên mọi đơn (bug cũ: đơn soát-ok đi thẳng xưởng bị đếm oan).
- Công thức lấy từ `utils/designer-flow.ts` — **1 nguồn duy nhất** với Dashboard/sidebar; sửa ở đó là mọi nơi khớp nhau.
- **Section khách ưu tiên**: khách đã kéo vào cột ở `/adm/settings/customer-priority` (bất kể công tắc bật/tắt — công tắc chỉ điều khiển auto-gán lúc import); mỗi khách 1 block, **chỉ in ngày có đơn**, số = 0 thì ẩn (trừ `tồn` luôn hiện).

### 1.3 Khóa in-flight
Không rate-limit — chỉ chặn chạy chồng: `ScheduledReportsService.running` (in-memory, PM2 single instance). Đang chạy → mọi trigger khác nhận `busy` / toast "⏳ chờ xong rồi bấm lại".

---

## 2. Luồng hoạt động

```
Trigger:
  - Cron 11:30/17:00 VN (check SCHEDULED_REPORTS_ENABLED) → run('daily') RỒI run('designer') — 2 message/lịch
  - Nút web Dashboard (popover 3 view) → POST /reports/run-now?view=… → run(view)
  - Nút Telegram → webhook → REPORT_CALLBACKS[cq.data] → run(kind)

run(kind):
  if running → { ok:false, busy:true }
  data = DailyOrdersAggregator.aggregate(now, factoryId?)   // 1 aggregation $facet 4 nhánh
  kind='daily' (+factoryId?) → notifyDailyOrdersReport(payload, factoryName?)
  kind='designer'            → notifyDesignerViewReport(payload)
  kind='tool-check'          → notifyToolCheckReport(payload)
  // keyboard động: [🔄 Cập nhật][👤 Designer][🔍 Soát tool] + hàng [🏭 <xưởng>] mỗi xưởng
```

Webhook (`TelegramWebhookController`, boot tự `setWebhook` khi đủ env): 1) secret sai → 401; 2) không phải callback_query → bỏ qua; 3) chat_id ∉ allowlist channel báo cáo / data lạ → answer rỗng; 4) đang chạy → toast chờ; 5) OK → toast "📤 Đang gửi..." + `void run(kind)` (trả 200 ngay).

---

## 3. API / Schema

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/v1/reports/run-now` | SuperAdmin / Admin | Gửi ngay 1 view — query `view=daily\|designer\|factory` (default `daily`). Trả `{ ok, busy? }`. |
| POST | `/v1/telegram/webhook` | public | Callback nút bấm — verify `X-Telegram-Bot-Api-Secret-Token`. |

Env (như cũ + webhook):
```env
TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID / TELEGRAM_NOTIFICATION_CHANNEL_ID (CSV được)
TELEGRAM_SCAN_NOTIFICATION_CHANNEL_ID / TELEGRAM_NOTIFICATION_ENABLED / SCHEDULED_REPORTS_ENABLED
TELEGRAM_WEBHOOK_URL=https://<api-domain>/api/v1/telegram/webhook   # HTTPS public đầy đủ
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
```

Types (`scheduled-reports/types.ts`):
```ts
ReportKind = 'daily' | 'designer' | 'tool-check'   // xưởng = daily + factoryId
run(kind, factoryId?)   // rpt:fac:<id> → run('daily', id)
ReportDayStats = { label, total, stockOut, needAction, rework, inProgress, done, backlog, unassignedNeed }
PriorityCustomerReportRow = { priority, userSku, userEmail, days: ReportDayStats[] }
DesignerReportDay = { label, rows: { fullName, needAction, rework, inProgress, done }[], unassignedNeed }
FactoryReportRow = { name, total, stockOut, backlog }
DailyOrdersReportData = { days, priorityRows, designerDays, toolCheckDays, factories }
ToolCheckReportDay = { label, total, unreviewed, reviewed, noteNotOk, reviewedOk, rework }
ReportFactory = { id, name }   // dựng nút xưởng
ReportDayStats += { soat, design, inPressQc, sew, pack, completedWithin2d }   // phễu vòng đời (partition)
SlaCohortRow = { label, ageDays, total, doneN0..doneN3, doneLate(≥N4), notDone, stuck{Soat,Design,InPressQc,Sew,Pack} }   // section SLA sản xuất
DailyOrdersReportData += { slaDays: SlaCohortRow[] }
FactoryReportDay = { label, rows: { name, total, stockOut, backlog }[] }
```

---

## 4. Backend modules

- `telegram-notification/`: service (3 `notify*Report` cùng `REPORT_KEYBOARD` 3 nút + `reportChannelIds()`), `types.ts` (`REPORT_CALLBACKS` map), `format/daily-orders-report.formatter.ts` (3 hàm `formatDailyOrdersReport` / `formatDesignerViewReport` / `formatFactoryViewReport`) + `_helpers.ts`.
- `scheduled-reports/`: service (`run(kind)` + lock + onModuleInit setWebhook + 2 @Cron 11:30/17:00 — `runScheduled()` gửi tuần tự daily→designer), `scheduled-reports.controller.ts`, `telegram-webhook.controller.ts`, `build-period.ts` (`REPORT_DAY_COUNT` + `SLA_DAY_COUNT`/`SLA_TARGETS` + `buildReportDayWindows(now, count?)` + `formatVnDateTime`), `aggregators/daily-orders-aggregator.ts` (+ `aggregateSla()` — aggregate riêng $facet 2 nhánh days/factories, cửa sổ 7 ngày).
- Aggregator: 1 aggregation `$facet` 4 nhánh (`days` / `customers` (pre-filter `userSku $in` khách ưu tiên, join JS qua `customerMatchKey`) / `designers` (match assignee set + s4, group (day, assignee), resolve fullName qua `userModel`) / `factories` (group **(day, factoryId)** → per-day, resolve tên qua `FactoryRepository`)). Module imports: OrderEntity + UserEntity mongoose, CustomerAssignmentModule (`getPriorityCustomers()`), FactoryModule, TelegramNotificationModule.
- `DesignerStatsService.designerFlowConds()` giờ là delegate mỏng → `utils/designer-flow.ts`.

---

## 5. Message format (3 view — bảng canh cột + viết tắt)

Số liệu render trong **bảng monospace** (helper `table()` → ` ```code``` ` block, cột đầu canh trái, các cột số canh phải → số thẳng hàng dọc, dễ soi nhất). Bảng hẹp được **giãn đều khoảng cách cột tới `TABLE_TARGET_WIDTH = 34` ký tự** — mọi bảng bằng nhau, chiếm trọn bề ngang điện thoại; KHÔNG tăng target vì dòng dài hơn ~35 ký tự sẽ bị Telegram mobile wrap. Telegram **cuộn ngang** trong code block nếu rộng — KHÔNG vỡ dòng như text thường (bài học Phase 2.1). Tiêu đề cột **viết tắt**, giải nghĩa ở dòng legend cuối message. Ô tên (designer/xưởng) qua `fit(s, n)` (cắt gọn + bỏ `` ` ``/newline khỏi phá block). **Số 0 → `-`** (helper `cellStr` trong `table()`) cho đỡ nhiễu mắt.

> **Giới hạn Telegram (đã chốt với user):** tô màu chữ (vàng/xanh) và in đậm **KHÔNG** render trong code block (bảng monospace phẳng), và Telegram vốn không hỗ trợ màu chữ tuỳ ý. User đã chọn **giữ bảng canh cột** thay vì đổi sang kiểu thẻ emoji-màu (mất canh cột) — chấp nhận không màu/đậm, đổi lại số thẳng hàng.

View chính — bảng `Ngày · Đơn · XK · Lỗi · Xong · ĐL · LL · CL · Tồn`, đứng trước Xong. **Lỗi = "soát lỗi + đẩy về" = `poolCond`** (đơn từng soát ra lỗi `toolCheckErrorNotes` ∨ đã vào flow designer `s4`) — KHỚP CHÍNH XÁC hàng "Tổng lỗi" (`totalError` = `toolError + wasOkPushed`) của bảng Tổng quan Dashboard (2 nửa rời nhau, tổng = poolCond). Mỗi khách ưu tiên 1 bảng nhỏ cùng cột. **Nhãn 🟢 PROD / 🧪 DEV** ở đầu mỗi message (phân biệt báo cáo từ production hay dev):
View **Tổng quan = phễu vòng đời đơn** (snapshot **tồn ở mỗi chặng**, mỗi đơn ở đúng 1 chặng → `Tổng = Soát + TK + IÉQ + May + Đóng + Xong`): `Tổng · Soát(chưa soát tool) · TK(đã soát, chờ thiết kế) · IÉQ(in+ép+QC ép) · May(vào+ra) · Đóng · Xong(hoàn thành) · %2n(% xong ≤2 ngày)`. Suy chặng từ: `fulfillmentCompletedAt` set = Xong; `currentFulfillmentStage` ∈ print/press/qc-post-press = IÉQ, sew-in/out = May, pack = Đóng; còn lại (cfs null, chưa xong): `toolResultNote` rỗng = Soát, có giá trị = TK. `%2n = completedWithin2d / total` (xong ≤48h kể từ `inProductionAt`). Section khách ưu tiên **bỏ tiêu đề "⭐ KHÁCH ƯU TIÊN"** + **bỏ dòng trống** (chấm 🔴🟠🔵 + tên đủ nhận biết), cùng cột phễu:
Bảng **xoay ngang** (`funnelTable` + `FUNNEL_ROWS`): **chặng = HÀNG, ngày = CỘT** → chỉ 4 cột (Chặng + 3 ngày), vừa 1 dòng trên điện thoại (KHÔNG wrap). Nhãn hàng đầy đủ nên **bỏ legend**. Tồn 6 chặng (Soát→Hoàn thành) cộng lại = Tổng:
```
🧪 DEV
📊 BÁO CÁO ĐƠN · 4 NGÀY · 🕐 01/08 11:37
| Chặng      30/07 31/07 01/08 |
| Tổng         557   566   133 |
| Soát           -    30    60 |
| Thiết kế       -    19    30 |
| In/Ép/QC       -     8    10 |
| May vào/ra     -    20     3 |
| Đóng hàng      -    10     - |
| Hoàn thành   557   479    30 |
| % ≤2 ngày    92%   61%   22% |
🔴 TIKTOKSHOPUS
| Chặng      30/07 |
| Tổng         125 |
| ...              |
| Hoàn thành   125 |
| % ≤2 ngày    88% |
🔴 THGPARTNER — (không có đơn)

Đơn=tổng·XK=xuất kho·Lỗi=tổng lỗi TK·Xong=TK xong·ĐL=đang làm·LL=làm lại·CL=cần làm·Tồn=TK tồn
[🔄 Cập nhật] [👤 Designer] [🏭 Xưởng]
```
**Section "⏱ SLA SẢN XUẤT"** (ngay dưới bảng phễu, cả view Tổng quan LẪN view xưởng) — cohort theo ngày vào SX, cửa sổ **7 ngày liền kề — TÍNH CẢ Chủ nhật** (khách lên đơn cả CN; từng làm bản bỏ CN rồi user đảo lại — xem changelog 3.7.1; cửa sổ RỘNG hơn phễu 4 ngày → aggregate riêng `aggregateSla()`), trả lời "hàng của N ngày trước đã kết thúc chu kỳ chưa": mỗi lô 1 dòng `Ngày · Tổng · N0 · N1 · N2 · N3+ · Còn` — % **TỪNG MỐC RỜI NHAU** theo **NGÀY LỊCH VN** (`lag = vnDay(fulfillmentCompletedAt) − vnDay(inProductionAt)`, KHÁC `%≤2 ngày` của phễu vốn tính 48h tròn), `N3+` gộp xong-từ-N3-trở-đi → **các cột cộng ngang = 100%** (bài học: bản đầu dùng % CỘNG DỒN ≤N1/≤N2, user cộng ngang ra >100% không hiểu — ĐÃ BỎ). Mốc lô chưa sống tới → `—`, mốc đã qua nhưng 0 đơn → `-`. Bề ngang giữ ~33 ký tự — **Telegram mobile VẪN wrap trong code block nếu rộng hơn** (bản gap-2-space + ô `476 (62%)` từng bị bẻ dòng — ĐÃ BỎ, `table()` giữ nguyên gap 1 space). Chỉ tiêu `SLA_TARGETS` (build-period.ts, nghĩa CỘNG DỒN: N0≥30 · N1≥80 · **N2=100 cam kết chu kỳ**) chỉ nêu ở tiêu đề, KHÔNG gắn cờ vào ô. Dưới bảng: bảng **"🚨 TỒN SAU HẠN N2"** — dòng đếm `🔴 quá hạn X lô · ⚠️ hạn hôm nay Y lô`, mỗi lô đến hạn (`NAY`, ageDays=2)/quá hạn (`QUÁ`, ageDays≥3) 1 dòng, cột = chặng đang kẹt (`TK`=Soát+Thiết kế gộp cho hẹp · `IÉQ` · `May` · `Đóng`) + legend, kết section 1 dòng trống. Sau đó (CHỈ view tổng, không lọc xưởng): bảng **"🏭 TỒN SAU HẠN N2 THEO XƯỞNG"** — MA TRẬN NGÀY × XƯỞNG (`slaFactories` — group `(day, factoryId)` trên đơn chưa xong của các lô đã đến hạn, mỗi lô 1 dòng + 2 dòng chốt `Tổng`/`%` tỷ trọng, sort tổng giảm dần, tên xưởng `fit(7)`). Đơn giữ (hold) TÍNH GỘP — cam kết áp mọi đơn (chốt với user):
```
⏱ SLA SẢN XUẤT · 7 NGÀY (chỉ tiêu cộng dồn N0≥30·N1≥80·N2≥100)
| Ngày  Tổng N0  N1  N2 N3+  Còn |
| 12/08  726  - 26%  8%   -  66% |
| 15/08  618  -   -  4%   —  96% |
| 17/08  239  -   —   —   — 100% |
🚨 TỒN SAU HẠN N2 — 🔴 quá hạn 4 lô · ⚠️ hạn hôm nay 1 lô · kẹt ở:
| Ngày  Hạn Còn TK IÉQ May Đóng |
| 12/08 QUÁ 478  -   4 428   46 |
| 15/08 NAY 592  7 128 408   49 |
TK=soát tool+thiết kế · IÉQ=In/Ép/QC · NAY=hạn N2 là hôm nay
```
View designer — mỗi ngày 1 bảng `Designer · Lỗi · Xong · ĐL · LL · CL` + **dòng Tổng** (cộng mọi designer trong ngày). Tên `fit` 12 ký tự; **Lỗi** per-designer = số đơn của họ TỪNG bị soát tool ra lỗi `toolErrHasCond` (KHÔNG dùng poolCond vì nhánh này đã lọc s4 → poolCond luôn = tổng đơn):
```
👤 BÁO CÁO DESIGNER · 4 NGÀY · 🕐 01/08 11:37
📅 30/07 · 🚨 chưa gán 3
| Designer      Lỗi Xong ĐL LL CL |
| Nguyễn Văn A     1   40  -  -  - |
| Trần B           -   25  -  2  - |
| Tổng            1   65  -  2  - |
📅 31/07
...
```
View **xưởng** (nút `🏭 <tên>`) = **cùng phễu Tổng quan nhưng LỌC theo 1 xưởng** (`run('daily', factoryId)` → `formatDailyOrdersReport(payload, factoryName)`): header `🏭 XƯỞNG <tên> · N NGÀY`, bảng phễu xoay ngang y hệt view Tổng quan, **bỏ section khách ưu tiên**.

View **soát tool** (nút `🔍 Soát tool`) — xoay ngang, chỉ số soát tool theo ngày (mirror bảng "Tổng quan theo ngày" tab Soát tool):
```
🔍 BÁO CÁO SOÁT TOOL · 4 NGÀY · 🕐 01/08 11:37
| Chỉ số      29/07 30/07 31/07 01/08 |
| Tổng đơn      557   566   540   133 |
| Chưa soát       -     -    10    90 |
| Đã soát       557   566   530    43 |
| Note ko ok     40    30    25     5 |
| Soát OK       517   536   505    38 |
| Cần làm lại     3     2     1     - |
```
> (dấu `|` ở ví dụ chỉ minh họa mép bảng — thực tế là code block monospace, không có viền.)

Số 0 hiện `-` (đỡ nhiễu); ngày khách không có đơn được lọc bỏ trước khi dựng bảng. `clamp` 4096 vẫn áp — priority customers thường ít nên không chạm ngưỡng.

## 6. Performance & security

1 aggregation `$facet` 4 nhánh cho cả 3 view (window 3 ngày nhỏ) + 2 query resolve tên (users/factories). Webhook 3 lớp: secret token → allowlist chat_id → khóa in-flight; endpoint chỉ trả `{ok:true}`, báo cáo luôn gửi vào channel env. Optional: nginx giới hạn path webhook theo dải IP Telegram `149.154.160.0/20`, `91.108.4.0/22`.

## 7. Permissions

SuperAdmin/Admin: nút web + `/reports/run-now`. Member channel báo cáo: 3 nút Telegram (chặn theo chat_id). Cron: system, check `SCHEDULED_REPORTS_ENABLED` (nút web/Telegram KHÔNG bị flag này chặn).

## 8. Edge cases

| Tình huống | Hành vi |
|---|---|
| `TELEGRAM_NOTIFICATION_ENABLED=false` | Mọi noti skip |
| Thiếu env webhook | Không setWebhook; nút hiện nhưng bấm không phản hồi; endpoint luôn 401 |
| 2 người bấm nút gần nhau | Người sau: toast "⏳ Báo cáo đang chạy — chờ xong rồi bấm lại nhé" |
| Chưa kéo khách vào cột ưu tiên | Không có section ⭐ (công tắc bật/tắt KHÔNG ảnh hưởng) |
| Designer đã tắt/xóa | Dòng "Khác (đã tắt)" trong view designer |
| PM2 cluster | Cần Redis lock (chưa cần — single instance) |

## 9. Verify số liệu

| Số | So với UI |
|---|---|
| total / tồn / 4 trạng thái thiết kế | Dashboard tab Designer — bảng "Tổng quan N ngày" + ma trận "Tất cả designer theo ngày" (cùng `designerFlowConds()` + cùng scope) |
| stockOut | Đơn có `fulfillmentCompletedAt`, lọc theo ngày `inProductionAt` |

## 10. Lịch sử thay đổi

> 2026-10-05 — view chính (SLA) thêm 1 dòng **"Hold Support"**: số đơn đang nằm ở Support (marker `productionErrorSource='tool-check' AND toolResultNote='error'`) MỌI tuổi + tuổi đơn già nhất (mốc = timeline `reworkTarget:'tool-check'` mới nhất → `productionFirstErrorAt` → `updatedAt`). Im lặng khi 0 đơn; `🛠` thường, `⚠️ … (quá 24h)` chỉ khi già nhất >24 giờ. Cột "Cần làm lại" theo ngày của view Soát tool chỉ thấy cohort 7 ngày nên bỏ sót hold cũ — dòng này vá lỗ đó. Code: `scheduled-reports/support-hold.ts` + `aggregateSupportHold()`. Là người canh luật dừng của `documents/Plans/ToolCheck-Redesign.md`.

| Phase | Ngày | Việc làm |
|---|---|---|
| Phase 1 | 2026-06-19 | TelegramService + import summary noti |
| Phase 2 | 2026-06-22 → 24 | 3 báo cáo designer/factory/error + cron (ĐÃ GỠ) |
| Phase 3 | 2026-08-01 | Bỏ 3 báo cáo cũ → báo cáo "Đơn 3 ngày liền kề"; webhook nút bấm + khóa in-flight; core thêm answerCallbackQuery/setWebhook/replyMarkup |
| Phase 3.1 | 2026-08-01 | **Fix số sai** (tồn thiết kế đếm oan đơn không qua designer; scope lệch Dashboard) → MIRROR `designerFlowConds()` (tách ra `utils/designer-flow.ts`) + scope `getDailyOverview`; redesign section khách ưu tiên (ẩn số 0, bỏ ngày trống); thêm 2 view mới **👤 Theo designer** (tách từng ngày) + **🏭 Theo xưởng** (tổng · stock out · TK tồn) — hàng 3 nút trên mọi message |
| Phase 3.2 | 2026-08-01 | Thử icon-driven (`chip()`/`joinChips()`) — user vẫn thấy rối |
| Phase 3.3 | 2026-08-01 | **Chuyển sang bảng canh cột monospace + viết tắt** (helper `table()` → ` ```code``` `, cột số canh phải thẳng hàng; tiêu đề tắt Đơn/XK/Xong/ĐL/LL/CL/Tồn + legend giải nghĩa; `fit()` cắt tên designer/xưởng). View chính + khách ưu tiên đủ 7 chỉ số/ngày; designer 4 trạng thái; xưởng Đơn/XK/Tồn + Tổng |
| Phase 3.3.1 | 2026-08-01 | Tinh chỉnh sau ảnh thực tế: `RIGHT_PAD` 3 space đuôi bảng để nút `</>` của Telegram không đè tiêu đề cột "Tồn"; bỏ chữ "· Ưu tiên nhất" ở header khách (tránh xuống dòng thừa) → chỉ còn chấm màu 🔴🟠🔵 |
| Phase 3.3.2 | 2026-08-01 | Thêm cột **Lỗi** (Σ `designerReworkCount`) trước cột Xong ở view Designer (aggregator `designerStatusFields.errorCount` + `DesignerDayRow.errorCount`); bỏ dòng chú thích chấm màu ở section khách ưu tiên |
| Phase 3.3.3 | 2026-08-01 | Thêm cột **Lỗi** trước Xong ở **bảng tổng + khách ưu tiên** (`metricFields.errorCount` + `ReportDayStats.errorCount` + `DAY_HEADER`); **số 0 → `-`** (`cellStr` trong `table()`). Màu vàng/xanh + in đậm: user chốt **không làm** vì Telegram code block không render màu/đậm — giữ bảng canh cột |
| Phase 3.3.4 | 2026-08-01 | **Sửa định nghĩa "Lỗi"** khớp Dashboard: bảng tổng + khách = `poolCond` (soát lỗi + đẩy về = `toolError + wasOkPushed`, đúng hàng "Tổng lỗi" `getDailyOverview`); view designer = `toolErrHasCond` (soát lỗi per-designer). Thêm **nhãn 🟢 PROD / 🧪 DEV** đầu mọi message (`DailyOrdersReportNotification.isProduction` từ `config.isProduction`) |
| Phase 3.3.5 | 2026-08-01 | Bỏ dòng "⭐ KHÁCH ƯU TIÊN" + bỏ dòng trống giữa các bảng (compact, gộp `title · 🕐 time`); **nút web → popover 3 view** (Tổng quan/Designer/Xưởng, `runNow(view)` + `run-now?view=`), controller nhận `@Query('view')` → `run(kind)` |
| Phase 3.3.6 | 2026-08-01 | View designer: **dòng Tổng/ngày** (cộng mọi designer). View xưởng: đổi từ 1 bảng cộng dồn → **per-day 3 ngày** (aggregator group `(day, factoryId)` + `buildFactoryDays`, `FactoryReportDay`), mỗi ngày kèm dòng Tổng |
| Phase 3.4 | 2026-08-01 | **Redesign view Tổng quan → phễu vòng đời đơn** (snapshot đơn đang ở chặng nào): cột `Tổng·TK·IÉQ·May·Đóng·Xong·%2n` thay bộ cột design-metric cũ; `metricFields` + `ReportDayStats` thêm `design/inPressQc/sew/pack/completedWithin2d` (suy từ `currentFulfillmentStage`+`fulfillmentCompletedAt`, `%2n` = xong ≤48h kể từ `inProductionAt`). Áp cả bảng khách ưu tiên. Designer/xưởng view giữ nguyên |
| Phase 3.4.1 | 2026-08-01 | Phễu = **tồn ở mỗi chặng, tổng partition = Tổng đơn**; **tách cột Soát** (chưa soát tool: `toolResultNote` rỗng) khỏi TK (đã soát, chờ thiết kế) — thêm `MetricShape.soat`/`ReportDayStats.soat` |
| Phase 3.4.2 | 2026-08-01 | **Gộp cột %2n vào Xong** thành ô "số (%)" (vd `479 (61%)`, helper `xongCell`) — bỏ 1 cột cho đỡ rộng/xuống dòng trên mobile |
| Phase 3.4.3 | 2026-08-01 | Bảng vẫn wrap trên mobile → **xoay ngang phễu** (`funnelTable`/`FUNNEL_ROWS`): chặng=hàng, ngày=cột (4 cột, vừa 1 dòng); nhãn hàng đầy đủ Tổng/Soát/Thiết kế/In/Ép/QC/May vào ra/Đóng hàng/Hoàn thành/% ≤2 ngày → **bỏ legend**; %2n về lại 1 hàng riêng |
| Phase 3.5 | 2026-08-01 | **4 ngày** (`REPORT_DAY_COUNT=4`). **Nút xưởng động**: bỏ view "factory summary" cũ → mỗi xưởng SX (loại US) 1 nút `🏭 <tên>` (`rpt:fac:<id>`) = phễu Tổng quan lọc theo xưởng (`aggregate(now, factoryId)` + `formatDailyOrdersReport(payload, factoryName)`, bỏ section khách). **Nút "🔍 Soát tool"** (`rpt:tool`) = báo cáo soát tool xoay ngang (facet `toolCheck` + `formatToolCheckReport`, mirror bảng "Tổng quan theo ngày" tab Soát tool). `ReportKind`='daily'\|'designer'\|'tool-check'; `run(kind, factoryId?)`; keyboard động `buildReportKeyboard(factories)`; web popover thêm Soát tool + 1 mục/xưởng (`runNow(view, factoryId?)`) |
| Phase 3.6 | 2026-08-17 | **Section "⏱ SLA SẢN XUẤT"** trong view Tổng quan + view xưởng: cohort 7 ngày SX (`SLA_DAY_COUNT`, aggregate riêng `aggregateSla()`), % cộng dồn stock out theo NGÀY LỊCH VN mốc N0/≤N1/≤N2 + cột Còn; chỉ tiêu `SLA_TARGETS` N0≥30·N1≥80·N2=100 (hụt → `!`, quá hạn N2 → `X`); dòng cảnh báo ⚠️(đến hạn hôm nay)/🔴(quá hạn) kèm breakdown kẹt ở chặng nào; đơn hold tính gộp. `SlaCohortRow` + `DailyOrdersReportData.slaDays` |
| Phase 3.6.1 | 2026-08-17 | Redesign section SLA theo feedback screenshot thật: thêm cột **≤N3** (`doneN3`, `doneLate` thành ≥N4); cột `Còn` kèm **%** trên tổng lô; `table()` thêm tham số `gap` — bảng SLA dùng 2 space cho thoáng/rộng hết màn hình; phần cảnh báo đổi từ prose (bị wrap) → bảng **"🚨 TỒN SAU HẠN N2"** (`Ngày·Hạn(NAY/QUÁ)·Còn·Soát·TK·IÉQ·May·Đóng`) + dòng đếm 🔴/⚠️ + legend + dòng trống ngăn section khách ưu tiên |
| Phase 3.6.2 | 2026-08-17 | Fix 2 lỗi bản 3.6.1 theo screenshot điện thoại: (1) bảng gap-2 + ô `476 (62%)` quá rộng → **Telegram mobile wrap** → bỏ `gap` (table() về nguyên bản), Còn chỉ còn `%`, bề ngang ~33 ký tự; (2) % cộng dồn ≤N1/≤N2 khiến user cộng ngang >100% → đổi sang **% từng mốc rời nhau** `N0+N1+N2+N3+ +Còn = 100%` (cột `N3+` = doneN3+doneLate), bỏ cờ `!`/`X` trong ô (chỉ tiêu chỉ nêu ở tiêu đề); bảng tồn gộp Soát+TK thành cột `TK` cho hẹp |
| Phase 3.7 | 2026-08-17 | **View chính → SLA-only**: SLA + 🚨 tồn sau hạn N2 + bảng mới **🏭 tồn theo xưởng %** (`slaFactories` facet); phễu + khách ưu tiên dời sang **nút mới 📋 Chi tiết** (`rpt:detail`/`ReportKind='detail'`/`formatDetailReport`/`notifyDetailReport` + web popover mục "Chi tiết"); nút xưởng giữ phễu+SLA lọc xưởng. Kèm bản bỏ Chủ nhật khỏi chu kỳ N (7 ngày làm việc + lag trừ CN) |
| Phase 3.7.1 | 2026-08-17 | **Đảo quyết định bỏ CN** — user chốt TÍNH CẢ Chủ nhật (khách lên đơn cả CN): revert về 7 ngày liền kề + lag ngày lịch thuần (`buildSlaWorkingDayWindows`/`sundaysUpTo` ĐÃ XÓA); giữ nguyên view SLA-only + nút Chi tiết + bảng tồn theo xưởng |
| Phase 3.7.2 | 2026-08-17 | **(1) Giãn bảng full-width**: `table()` thêm `TABLE_TARGET_WIDTH=34` — bảng hẹp giãn đều gap (xoay vòng) cho mọi bảng bằng nhau chiếm trọn màn điện thoại (không vượt 34 → không wrap). **(2) Bảng xưởng → ma trận NGÀY × XƯỞNG**: facet factories group `(day, factoryId)`, `slaFactories` đổi shape `{name,total,byDay[]}` — mỗi lô đến hạn 1 dòng tồn từng xưởng + dòng Tổng + dòng % tỷ trọng (thấy Mê Linh tồn bao nhiêu ở từng lô ngày) |
| Phase 3.8 | 2026-08-17 | **Gỡ import summary noti** (hook trong `importOrders` + `notifyImportSummary` + formatter + channel key — Phase 1 kết thúc); **đổi lịch cron 3 lần/ngày → 2 lần 11:30 + 17:00 VN**, mỗi lịch gửi 2 message: Tổng quan SLA (kèm bảng xưởng) rồi Designer (`runScheduled()` chạy tuần tự `run('daily')` → `run('designer')`); bỏ dòng đếm 🔴/⚠️ lô trên header bảng tồn (user tự gọn) |

---

## Tài liệu liên quan

- [CustomerFactoryAssignment.md](./CustomerFactoryAssignment.md) §8 — cấu hình khách ưu tiên
- [Dashboard.md](./Dashboard.md) — bảng Tổng quan N ngày + ma trận designer (nguồn công thức)
- [Orders.md](./Orders.md) §17/§19/§21 — ưu tiên đơn / loại đơn chưa map / loại xưởng US
- [FulfillmentWorkflow.md](./FulfillmentWorkflow.md) — `fulfillmentCompletedAt` (mốc Stock out)
