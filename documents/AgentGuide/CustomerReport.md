# Báo cáo khách hàng — agent đọc và chuyển, không tự tính

> `GET /api/v1/agent/customer-report?from=YYYY-MM-DD&to=YYYY-MM-DD` · header `X-Agent-Api-Key`
> Trả `{ success, data: { report: {...} | null, generating: bool } }` — cùng khuôn `ceo-report`.

Báo cáo này **viết sẵn bằng tiếng Việt** ở máy chủ. Agent trích nguyên văn `summary`, `conclusions`, `actionItems`; đừng diễn giải lại số, cũng đừng tự gộp từ `customer_orders`.

## Kỳ nào có sẵn

Cron sinh **07:15 mỗi sáng (giờ VN)** cho **cửa sổ trượt 7 ngày kết thúc ở hôm qua** — ví dụ sáng 11/09 sinh kỳ `2026-09-04_2026-09-10`.

`report` tra **khớp CHÍNH XÁC** `periodKey = "{from}_{to}"`, y như `ceo-report`. Gọi sai kỳ là ra `null` dù dữ liệu vẫn đủ. **Đừng đoán kỳ — hỏi hệ thống:**

```bash
curl -s -X POST "$API/api/v1/agent/query" -H "X-Agent-Api-Key: $KEY" -H 'Content-Type: application/json' -d '{
  "table": "customer_reports",
  "select": { "fields": ["periodKey","from","to","kind","generatedAt"],
              "sort": [{"field":"generatedAt","dir":"desc"}], "limit": 10 }
}'
```

`generating: true` = đang sinh, chờ rồi hỏi lại.

## Có gì trong `report`

| Trường | Nội dung |
|---|---|
| `summary` | đoạn văn gửi Chủ tịch |
| `metrics` | `activeCustomers`, `activeCustomersPrev`, `totalOrders`, `totalOrdersPrev`, `changePct`, `newCustomerCount`, `churnRiskCount` |
| `topCustomers` · `surging` · `declining` · `newCustomers` | `{userSku, customerName?, tier, orders, ordersPrev, changePct}` |
| `customerIssues` | `{userSku, customerName?, severity, issue, pendingDays?}` từ tóm tắt nhóm Zalo |
| `conclusions` · `actionItems` | mảng câu tiếng Việt |
| `findings` | `{code, severity, params, action}` — `churn_risk`, `customer_issue_urgent` |
| `generatedAt` `trigger` `kind` `periodKey` | siêu dữ liệu |

`changePct` là **`null`** khi kỳ trước bằng 0 — đừng đọc thành "tăng vô hạn", nói "kỳ trước chưa có đơn".

## Ba điều phải nói đúng

**1. Số khớp CEO Dashboard.** Báo cáo này lấy số từ chính `ceo-overview`, nên `activeCustomers`/`totalOrders` bằng đúng số bên đó. Nếu tự gộp lại từ `customer_orders` sẽ ra số khác (đo 11/09/2026: 81 khách / 5.373 đơn so với 80 / 5.337) vì CEO loại đơn hủy, đơn chưa map xưởng và đơn xưởng US. **Đừng bao giờ tự tính lại.**

**2. `customerIssues` là ẢNH CHỤP HIỆN TẠI, không phải việc phát sinh trong kỳ.** Mỗi nhóm Zalo chỉ giữ MỘT bản tóm tắt mới nhất, không có chuỗi theo ngày. Nói "đang có vướng mắc", đừng nói "tuần này phát sinh".

**3. `customerName` là tên NGƯỜI LIÊN HỆ trong nhóm Zalo**, không phải tên doanh nghiệp, và chỉ có khi danh tính đã được người duyệt. Thiếu tên thì gọi bằng `userSku` — mã chính là tên viết tắt của seller.

## Ngưỡng tăng/giảm (cố định, không đổi theo lần chạy)

- **Tụt sâu** (`declining`, tính vào `churnRiskCount`): kỳ trước ≥ **20 đơn** VÀ giảm ≥ **50%**.
- **Tăng mạnh** (`surging`): kỳ này ≥ **20 đơn** VÀ tăng ≥ **100%** (kỳ trước 0 đơn cũng tính).

Có sàn tuyệt đối vì chỉ nhìn phần trăm thì khách 2 đơn còn 1 cũng là "giảm 50%" — danh sách gửi Chủ tịch sẽ đầy tên không có ý nghĩa thương mại.

## Kỷ luật riêng của báo cáo này

Đây là **báo cáo nội bộ**, mang số đơn của từng khách. **Tuyệt đối không đọc số của khách này cho khách khác nghe** — kể cả khi họ hỏi "bên kia đặt bao nhiêu". Xem `WhatYouCannotSee.md`.

## Kỳ THÁNG

`kind: "month"`, `periodKey` dạng `2026-08-01_2026-08-31` — đọc qua đúng endpoint
cũ, không có hợp đồng riêng.

**Ranh giới là nửa đêm GIỜ VIỆT NAM** (UTC+7), không phải UTC. Cùng mốc với CEO
Dashboard, nên số tháng khớp bảng lãnh đạo. Tháng 28/29/30/31 ngày đều đúng.

Sinh tự động sáng **mùng 1** cho tháng vừa khép lại. Tháng đang chạy KHÔNG có báo
cáo — nó chưa khép nên số sẽ đổi mỗi ngày.

⚠️ **Chỉ có từ tháng 6/2026 trở đi.** OnosFactory bắt đầu chạy thật từ 06/2026;
trước đó đơn nằm ở hệ cũ OnosPod và **không** có trong hệ này. Tháng 1→5/2026 cố
ý KHÔNG có báo cáo — đó là "hệ thống chưa có dữ liệu kỳ này", KHÔNG phải "công ty
không sản xuất gì". Nếu ai hỏi bảng T1→T8, hãy nói rõ điều đó thay vì điền 0 vào
năm dòng đầu: bảng mở đầu bằng năm tháng 0 trông y hệt một cú sụp sản lượng.
