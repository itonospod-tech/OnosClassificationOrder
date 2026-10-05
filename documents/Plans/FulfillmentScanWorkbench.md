# Bàn quét cho công nhân xưởng — TẠM DỪNG (01/10/2026)

> Anh Tuấn chốt ưu tiên clone hệ cũ trước; phần này gác lại, KHÔNG bỏ. Quay lại thì
> code luôn theo hợp đồng §3, không phải bàn lại.

## 1. Số đo làm nền (DB dev = bản sao production, 30 ngày 07/08–07/09/2026)

| Công đoạn | Bắt đầu→Xong < 5 giây | Từng đơn một (1 log/giây) | Hàng loạt (≥5 cùng giây) | Thiết bị | TB đơn/người/ngày |
|---|---:|---:|---:|---|---:|
| In | 29% | 22% | 75% | Windows 100% | 398 |
| Ép | 99% | 100% | 0% | Windows 100% | 455 |
| QC sau ép | 99% | 100% | 0% | Windows 100% | 466 |
| May vào | 94% | 82% | 18% | Windows 100% | 781 |
| May ra | 99% | 99% | 0% | Windows 100% | 807 |
| Đóng hàng | 99% | 44% | 56% | Mac 48% · Windows 52% | 1.128 |

- Ngoài công đoạn In không ai dùng trạng thái "Đang làm"; kanban + kéo thả phục vụ đúng bước đó.
- Ép/QC/May ra làm từng đơn một bằng máy quét USB trên Windows; 0 thao tác từ điện thoại.
- Đóng hàng dùng hàng loạt nhiều, gần nửa từ Mac → nhiều khả năng quản lý dọn tồn; giữ đường hàng loạt mạnh.
- Công nhân In dùng trang khác (`PrintWorkshopView`) — giữ nguyên.

## 2. Quyết định đã chốt (onos-49)

- Bỏ "Bắt đầu" và kéo thả; hành động chính "Xong" (start+complete).
- KHÔNG làm cho điện thoại; màn rộng + máy quét HID.
- MỘT component quét dùng chung, hai trang nhúng: trạm `/orders/scan-error` (máy dùng chung, bảng `ACT-*` dán tường) và `/ffm/fulfillment/my-tasks` (trang của chính người đó).
- Giữ hành vi 2 bước (quét đơn → `OK`) ở cả hai trang; "quét là xong ngay" chưa ai quyết.

## 3. Hợp đồng component (a1 ↔ a4, đã chốt)

`apps/web/src/components/scan/ScanWorkbench.tsx` — `a4` sở hữu.

```ts
type ScanOutcome =
  | { kind: 'done'; order: ScannedOrder; stage: FulfillmentStage }
  | { kind: 'error-reported'; order: ScannedOrder; code: string }
  | { kind: 'held' | 'wrong-stage' | 'far'; order: ScannedOrder }
  | { kind: 'not-found'; code: string }
  | { kind: 'failed'; code: string; message: string };

interface ScanWorkbenchProps {
  context: 'station' | 'personal'; // 'personal' ẩn nút in bảng mã + chữ hướng dẫn tường
  paused?: boolean;                // host mở dialog → nhả focus, bỏ qua bộ đệm phím HID
  onOutcome?: (o: ScanOutcome) => void; // 1 lần / kết quả cuối, không theo từng phím
  recentLimit?: number;            // dải "vừa quét", mặc định 20
  className?: string;
}
```

- Stage + xưởng lấy từ `authStore` bên trong; `myStage` vắng (Admin/Manager xem my-tasks) thì xử lý như trạm.
- `ACT-PRINT-TEM` / `ACT-PRINT-LABEL` / `ACT-STOCK-OUT` / `ACT-CANCEL` / `ACT-ERROR` chạy ở cả hai context.
- `held` / `wrong-stage` / `far` suy từ cùng các kiểm tra trong `FulfillmentScanActionDialog`, không thêm logic BE.
- Không có prop `confirm` cho tới khi có quyết định "quét là xong ngay".

## 4. Phần của my-tasks (a1)

- Cột trái: `ScanWorkbench context="personal"`.
- Cột phải: "Cần chú ý" luôn hiện (Làm lại ghim đỏ · Đang giữ · Chờ quay lại) + bảng gọn ảo hoá các đơn còn lại (thay kanban) + tick nhiều / "Xong" hàng loạt.
- Cập nhật hàng tại chỗ theo `onOutcome`, refetch có debounce — KHÔNG tải lại cả 6 tab sau mỗi lần quét (vấn đề hiệu năng, xem `FulfillmentWorkflow.md` mục API `GET /v1/fulfillment/my-tasks`).
