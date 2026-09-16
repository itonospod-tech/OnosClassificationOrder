# CEO Dashboard — Function Description

> **File FE:** `apps/web/src/pages/ceo/index.tsx` (page, chặn vai) · `apps/web/src/pages/ceo/OverviewBoard.tsx` (bảng "Tổng quan điều hành") · `apps/web/src/services/ceo.ts`
> **File BE:** `apps/api/src/modules/ceo-dashboard/{ceo-dashboard.module,ceo-dashboard.controller,ceo-dashboard.service}.ts` · util dùng chung `apps/api/src/utils/workshop-stage.ts`
> **Route:** `/adm/ceo` (`PATHS.CEO_DASHBOARD`), sidebar nhóm "Điều hành" → "CEO Dashboard"
> **API:** `GET /v1/ceo/overview?from&to` · `GET /v1/ceo/report?from&to` · `POST /v1/ceo/report/generate` — `@Auth([SuperAdmin, Admin])`; agent: `GET /v1/agent/ceo-overview`, `GET /v1/agent/ceo-report`; DTO `packages/shared/dtos/ceo-dashboard.dto.ts`
> **Kế hoạch gốc:** `documents/Plans/CeoDashboard-Overview.md`

## 1. Overview

Bảng điều hành cho lãnh đạo (07/09/2026), tách khỏi Dashboard vận hành. Trả lời 5 câu hỏi buổi sáng của CEO — **làm được bao nhiêu · giao đúng hẹn không · chỗ nào hỏng · khách nào nuôi/rời · còn dư hay quá tải** — cộng khối **Nhân sự** và **tiền** (giá trị đơn theo `baseCost`, USD). Trên cùng là **Kết luận chính + Việc cần làm** sinh **theo luật** từ số liệu (không gọi mô hình), đổi theo kỳ ngày/tuần/tháng. **Mọi số là tổng hợp máy chủ trong MỘT phản hồi** → cũng là "sự thật chung" để Agent báo cáo cùng số (Agent sẽ được hướng dẫn đọc endpoint này).

Chỉ SuperAdmin/Admin: sidebar khóa theo vai (`onlyForRoles`), route không gắn mã quyền, trang tự chặn vai khác.

## 2. Luồng hoạt động

1. Vào trang → `usePageHeader` đưa tiêu đề lên header; kỳ mặc định **7 ngày gần nhất** (preset Hôm nay / 7 ngày / 30 ngày, mũi tên dịch cả kỳ). Kỳ so sánh = kỳ liền trước cùng độ dài.
2. FE gọi **một** request `GET /ceo/overview?from&to` → BE chạy ~20 aggregation song song trên `orders` (+ `users`, `factories`, `customers` qua connection), cache bộ nhớ 5 phút theo `(from,to)`.
3. Trình bày từ trên xuống: **Kết luận chính** (icon theo mức critical/warning/good/info) | **Việc cần làm** (đánh số, khử trùng theo mã việc) → **6 KPI** (Đơn vào · Đơn ra · Giá trị đơn · Đúng hẹn N2 · Tỉ lệ lỗi · Tồn trong xưởng, mỗi KPI có ↑↓% so kỳ trước) → **Vận hành theo ngày** (ComposedChart: cột vào/ra, đường lỗi, vùng tô kỳ đang xem, phủ cả kỳ trước) → **Đúng hẹn** (3 thanh N0/N1/N2 với vạch chỉ tiêu, cột %N2 theo ngày vào SX, 5 đơn quá hạn cũ nhất) | **Chất lượng** (donut theo nguồn lỗi, top loại hay lỗi) → **Khách hàng** (khách có đơn, khách mới, top 10 chiếm %, tăng/giảm mạnh, bảng top 10 kèm tier VIP + giữ/lỗi) → **Năng lực** (đường tồn cuối ngày 30 ngày, tồn theo chặng, bảng xưởng vào/ra/tồn/ra-ngày/xả hết/N2/lỗi, cảnh báo đơn treo) → **Nhân sự** (designer xong/tồn/làm lại; công nhân theo công đoạn) → dòng nguồn số.
4. Số bấm được → `/ffm/orders/workshop` với đúng URL param (`wfrom/wto`, `wstage`, `wheld`, `wcancel`, `werrfile`, `wusersku`, `wtype`, `factoryId`).

## 3. API / Schema

> 07/09/2026 — `GET /ceo/overview` nhận thêm `productLine?` (PRD-8, 6 giá trị) cho tab dịch vụ ở Seller Hub Operations (`SellerPortal.md` §9.1): `base` match của mọi khối đơn thêm `{ productLine }`, cache key `from|to|productLine`. Trang CEO `/adm/ceo` và Agent API không truyền → hành vi cũ.

`CeoOverviewZod` (`packages/shared/dtos/ceo-dashboard.dto.ts`), rút gọn:

```ts
{
  period: { from, to, days, prevFrom, prevTo, generatedAt, cached },
  production: { in, out, prevIn, prevOut, daily: {day,in,out,revenue,errors}[] /* kỳ trước + kỳ này */, byFactory: {factoryId,shortName,name,in,out,backlog,revenue,errored,n2Pct,outPerDay,daysToClear}[] },
  revenue: { total, prev, ship, avgPerOrder, prevAvgPerOrder, currency:'USD', basis:'baseCost' },
  sla: { targets, mature, within:{n,count,pct}[3], prevN2Pct, dailyN2, overdue:{ total, byFactory, sample[5] } },
  quality: { errored, ratePct, prevRatePct, bySource, topTypes },
  customers: { active, prevActive, newCount, top10SharePct, top[10], rising[5], dropping[5] },
  capacity: { backlog, prevBacklog, avgAgeDays, staleOpen, staleDays, byStage, history[30] },
  people: { designers[], workers[] },
  findings: { code, severity, params, action? }[]   // tối đa 8, sắp critical → info
}
```

**Định nghĩa số (khớp bộ lọc chuẩn Orders.md §19/§21: loại đơn hủy, chưa map xưởng, xưởng US):**
- `in` = đơn có `inProductionAt` trong kỳ; `out` = đơn có `fulfillmentCompletedAt` trong kỳ (không cần vào SX trong kỳ).
- Tiền = Σ `baseCost` (+ `shipCost` riêng) của đơn vào SX trong kỳ — **giá trị đơn theo base cost**, không phải doanh thu kế toán (giá chốt phía khách chưa đủ dữ liệu).
- SLA: cohort đơn vào SX trong kỳ; N_k = đã đóng hàng và `$dateDiff` ngày lịch VN (đóng − vào) ≤ k; **N2 chỉ tính trên đơn "đủ tuổi"** (vào SX ≥ 2 ngày trước) để không phạt đơn mới vào; chỉ tiêu `SLA_TARGETS` (N0≥30 · N1≥80 · N2=100, `scheduled-reports/build-period.ts`).
- Quá hạn = đơn còn mở, vào SX trước (hôm nay VN − 2 ngày) **và trong `staleDays`=45 ngày**.
- Lỗi = `productionErrorCount > 0` hoặc `productionError` khác rỗng; nguồn theo `productionErrorSource`.
- Tồn (`backlog`) = đơn còn mở vào SX trong 45 ngày; lịch sử tồn tính trong bộ nhớ từ (inProductionAt, fulfillmentCompletedAt) của ~75 ngày đơn. **`staleOpen`** = đơn còn mở vào SX quá 45 ngày — trên prod hiện ~hàng nghìn đơn cũ chưa từng đóng trên hệ thống (dữ liệu trước luồng fulfillment) → tách riêng, hiện cảnh báo "nợ dữ liệu", KHÔNG tính vào tồn/quá hạn.
- Chặng tồn dùng `workshopStageSwitchExpr()` (`utils/workshop-stage.ts`) — cùng luật cột Trạng thái (Orders.md §24) và phễu trang xưởng.

**Luật theo độ dài kỳ (07/09/2026, sửa sau khi soát báo cáo ngày Chủ nhật 06/09):**
- **Kỳ so sánh chính luôn là kỳ liền trước** (`compareMode='previous'`): kỳ 1 ngày = **hôm qua** (đọc *tiến độ*). Kỳ 1 ngày có thêm **`production.reference`** = cùng thứ tuần trước (D−7) + trung bình 7 ngày liền trước (D−7..D−1) để đọc *nhịp* (KPI vào/ra hiện thêm hai số này); `daily` của kỳ 1 ngày phủ 7 ngày trước + hôm nay. Luật đơn ra theo ngày (`output_down_day`/`output_up_day`) chỉ kêu khi lệch cùng chiều so với **cả hôm qua lẫn TB 7 ngày (≥20%)** và không phải cuối tuần; `in_exceeds_out` chỉ với kỳ ≥ 7 ngày. (Bản trước so cùng thứ tuần trước — đổi 07/09 theo yêu cầu: cùng thứ tuần trước bỏ sót tiến độ ngày-qua-ngày.)
- **SLA của kỳ 1 ngày đánh giá lô vào ngày D−2** (`sla.cohortFrom/cohortTo`, đã đủ tuổi N2; `prevN2Pct` = lô D−3) — tránh khối trống vì lô hôm nay chưa đủ tuổi; `dailyN2` và `byFactory.n2Pct` cũng theo lô này. Kỳ dài: lô = chính kỳ, lọc đủ tuổi bên trong.
- Luật **khách tăng/giảm, tập trung top 10, giá trị đơn ±%** chỉ chạy khi kỳ **≥ 7 ngày** (khách đẩy đơn theo lô; một ngày là nhiễu).
- Thêm 2 kết luận thông tin: `weekend_day` (kỳ 1 ngày rơi vào T7/CN — `period.weekday`), `sla_pending` (chưa có lô đủ tuổi).
- Lời nhắc mô hình (`ceo-report.service.ts` → "QUY TẮC THEO KỲ") nêu cùng luật: báo cáo ngày không kết luận công suất/khách/giá trị từ dao động một ngày, việc cần làm tập trung vào quá hạn, tồn theo chặng, designer.

**Kết luận theo luật (`buildFindings`)** — mã → câu i18n `ceoDashboard:findings.<code>`, việc → `actions.<action>`: `sla_n2_below`/`sla_n2_ok` (cần ≥10 đơn đủ tuổi), `overdue_orders`, `output_up/down` (|Δ|≥10%), `in_exceeds_out` (vào − ra > 25% vào), `backlog_rising` (≥15%), `factory_slow_clear` (xả hết ≥3 ngày), `error_rate_high` (≥5% hoặc +2 điểm) / `error_rate_down`, `customers_dropping` (kỳ trước ≥5, giảm ≥50%) / `customers_rising` (≥3, tăng ≥50%), `vip_issues` (tier ≥3 có giữ/lỗi), `customer_concentration` (top10 ≥70%), `designer_overload` (tồn ≥30), `revenue_up/down` (|Δ|≥10%). Kỳ 1 ngày: `output_down_day`/`output_up_day` (xấu/tốt ở cả hai phía, ≥20% so TB 7 ngày), `weekend_day`, `sla_pending`. Đổi ngưỡng: sửa tại `buildFindings`, FE không cần đổi.

## 3b. Nhận định của hệ thống + Agent (07/09/2026)

**Sinh nhận định** (`ceo-report.service.ts`, collection `ceo_reports`): lấy `CeoOverview` → rút gọn → Agent SDK (`@anthropic-ai/claude-agent-sdk`, cùng phiên Claude Code + `CLAUDE_CLI_PATH` như tóm tắt Zalo; model `CEO_REPORT_MODEL` → `ZALO_SUMMARY_MODEL` → `opus`; timeout `CEO_REPORT_TIMEOUT_SEC` → 150 s) với lời nhắc tiếng Việt cố định + `outputFormat json_schema` {tomTat, ketLuan[≤6], viecCanLam[≤5], ruiRo[≤3], diemSang[≤3]} (dự phòng `tachJson`) → lưu kèm `soLieu` (in/out/revenue/n2Pct/errorRatePct/backlog/overdue), `findings`, `model`, `trigger`. Mỗi lần sinh là một bản ghi mới; hiển thị bản mới nhất theo `periodKey`. Khóa trong bộ nhớ chống chạy trùng cùng kỳ (409).

**Lịch tự động** (`@Cron`, giờ VN, tắt bằng `CEO_REPORT_CRON_ENABLED=false`, tự tắt ở NODE_ENV=test): 07:00 hằng ngày → hôm qua; 07:10 thứ Hai → thứ Hai→Chủ nhật tuần trước; 07:20 mùng 1 → tháng trước. Cron chạy trong chính tiến trình API (mỗi môi trường tự sinh cho DB của mình). Nút **"Cập nhật nhận định"** trên dashboard (`POST /ceo/report/generate`, Admin/SuperAdmin, chờ tới 150 s, FE timeout 180 s) sinh cho kỳ đang xem.

**Agent ngoài chỉ ĐỌC** (giữ nguyên nguyên tắc Agent API chỉ đọc): `GET /agent/ceo-overview?from&to` và `GET /agent/ceo-report?from&to` (khoá agent, audit `capability = ceo_overview | ceo_report`), hướng dẫn ở `documents/AgentGuide/CeoDashboard.md`. Không có endpoint cho agent ghi nhận định — nhận định do hệ thống tự sinh để hai bên cùng một bản.

**Kiểm chứng số (07/09/2026, dev = bản sao prod):** endpoint và truy vấn Mongo độc lập khớp 100% cho ngày 06/09 (vào 174, ra 412, giá trị 1.023,14, lỗi 0) và tuần 31/08–06/09 (vào 4.446, ra 4.394, giá trị 26.213,21, lỗi 142 = 3,2%, N0 291 · N1 1.713 · N2 2.631/4.272 = 61,6%, quá hạn 998, tồn 1.617); "đơn vào" khớp `workshop-filters` của trang xưởng.

## 4. UI Components

| Thành phần | File | Ghi chú |
|---|---|---|
| `CeoDashboardPage` | `pages/ceo/index.tsx` | header title, chặn vai |
| `OverviewBoard` | `pages/ceo/OverviewBoard.tsx` | toàn bộ bảng; component nội bộ `Kpi`, `Delta`, `Section` |
| recharts 2.7 | `ComposedChart`/`AreaChart`/`PieChart` | màu hex `HEX`/`SOURCE_HEX` khớp `stageColors.ts` (recharts không nhận class Tailwind) |
| `STAGE_COLORS` | `pages/orders/workshop/stageColors.ts` | chip chặng, thanh tồn theo chặng |
| Khối "Nhận định của hệ thống" | trong `OverviewBoard.tsx` | `RepositoryRemote.ceoDashboard.getReport/generateReport`; i18n `report.*` |

i18n namespace `ceoDashboard` (`src/i18n/locales/{vi,en}/ceoDashboard.json`): `period.*`, `findings.*` (câu theo mã), `actions.*`, `source.*`, `kpi.*`, `ops.*`, `sla.*`, `quality.*`, `customers.*`, `capacity.*`, `people.*`, `sourceNote`.

## 5. Backend logic

`CeoDashboardService.getOverview(from,to)`: validate (to ≥ from, ≤ 92 ngày) → `Promise.all` ~20 pipeline (facet theo ngày; cohort kỳ này/kỳ trước; theo xưởng; lỗi theo nguồn/loại; quá hạn; khách kỳ này/kỳ trước + tier; tồn theo chặng/tuổi; docs lịch sử tồn; designer xong/tồn/làm lại; công nhân theo công đoạn qua `$objectToArray fulfillmentStages`; tên xưởng; đơn treo) → ghép JS → `buildFindings` → cache. Không ghi gì. Không có module nào khác gọi.

## 6. Performance notes

Dev (bản sao prod ~50k đơn): 7 ngày **716 ms** lần đầu, **13 ms** khi đệm; 30 ngày ~800 ms. Nặng nhất là lịch sử tồn (lean ~75 ngày đơn vào bộ nhớ). Nếu prod chậm hơn 2 s: (1) cron snapshot tồn cuối ngày vào collection riêng (kế hoạch §"Cần thêm"), (2) đổi cache bộ nhớ sang Redis để nhiều instance dùng chung.

## 7. Permissions

SuperAdmin / Admin. Endpoint `@Auth([SuperAdmin, Admin])`; sidebar `onlyForRoles`; trang tự chặn vai khác.

## Ảnh báo cáo cho agent (10/09/2026)

`GET /api/v1/agent/ceo-report/chart.png?from&to` trả PNG 1000×720 dựng **tại máy chủ**, để agent gửi thẳng Telegram/Zalo mà không phải vẽ gì.

- **Dựng bằng SVG viết tay** (`apps/api/src/modules/ceo-dashboard/ceo-chart.ts`, hàm thuần + `ceo-chart.spec.ts`) rồi `sharp` đổi sang PNG. Không kéo puppeteer/canvas: prod không có trình duyệt, và ảnh này chỉ có cột kép, cột ngang, thanh tiến độ. PNG chứ không SVG vì **Telegram/Zalo không nhận SVG**.
- **Font `DejaVu Sans`** — đã kiểm trên chính máy prod (gói `fonts-dejavu-core` có sẵn, `libfontconfig1` có, chỉ thiếu CLI `fc-list` nên đừng dùng lệnh đó để kết luận là máy không có font). Thiếu font thì chữ thành ô vuông mà KHÔNG báo lỗi → đổi font phải render thử trên prod.
- **KHÔNG lưu ảnh vào Mongo**: `POST /agent/query` mở hết mọi bảng (API-19) nên nhị phân trong document sẽ lọt ra và phồng phản hồi. Dựng lại chỉ mất vài chục mili giây và `getOverview` đã cache 5 phút.
- Nhận **mọi** khoảng ngày (khác `ceo-report` phải khớp đúng `periodKey`); chưa có nhận định thì ảnh chỉ gồm số liệu và ghi rõ điều đó.

