# Order Log — Function Description

> **File BE:** `apps/api/src/modules/order-log/` (`entity`, `repository`, `service`, `module`)
> **File FE:** `apps/web/src/components/orders/OrderLogTimelineDialog.tsx`
> **Shared:** `packages/shared/dtos/order-log.dto.ts`
> **API:** `GET /v1/orders/:id/logs`
> **Trigger:** mọi mutation trên Order module (Phase 3)

---

## 1. Overview

Audit trail cho mọi thay đổi trên `OrderEntity`. Mỗi log record bao gồm:
- ai (userId + snapshot fullName/email/roleCode)
- khi nào (createdAt từ BaseEntity)
- hành động (`create | update | delete | import | bulk_update`)
- thay đổi gì (field + before/after)
- nơi xuất phát (ip + userAgent)
  - Thao tác HỆ THỐNG không có user: đồng bộ giữ đơn theo OnosPod ghi `hold`/`unhold` mỗi đơn 1 dòng, `userAgent = 'onospod-hold-sync'`, `before`/`after` = `'Giữ theo OnosPod'` (Orders.md §9d). Cron §9c cũng ghi không user (ip/userAgent của lời gọi cron).

Mục tiêu: forensic — không xóa, không TTL (volume xưởng nhỏ, cần dữ liệu lịch sử dài hạn).

---

## 2. Schema `OrderLogEntity`

```ts
@DatabaseEntity({ collection: 'orderLogs' })
{
  orderId: string;          // ref OrderEntity, index
  userId?: string;          // ref UserEntity, index
  userName?: string;        // snapshot fullName
  userEmail?: string;       // snapshot email
  roleCode?: string;        // snapshot role.name (vd 'Designer'), index
  // `ORDER_LOG_ACTIONS` (shared) — index
  action: 'create' | 'update' | 'delete' | 'import' | 'bulk_update'
        | 'transfer' | 'cancel' | 'update_design' | 'hold' | 'unhold' | 'force_complete';
  field?: string;           // field name khi update/bulk_update, index
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  // createdAt từ BaseEntity
}
// Compound index: { orderId: 1, createdAt: -1 } — phục vụ timeline query
```

> User info được **snapshot** (copy giá trị tại thời điểm thay đổi) thay vì chỉ lưu `userId`, để timeline vẫn đọc được sau khi user bị đổi tên / xóa.

---

## 3. Service `OrderLogService`

| Method | Mục đích |
|--------|----------|
| `write({ orderId, action, field?, before?, after?, ctx? })` | Ghi 1 row. Try-catch nuốt lỗi (logging không bao giờ block user action). |
| `writeMany(rows)` | Bulk insert (import / bulk_update). |
| `listByOrder(orderId, dto)` | Query logs theo orderId + filter `action` / `field` + paginate, sort `createdAt desc`. |

`AuditContext` truyền vào `write` từ controller:
```ts
type AuditContext = {
  user?: UserDocument;     // @AuthUser()
  ip?: string;             // @ClientIp()
  userAgent?: string;      // @UserAgent()
}
```

---

## 4. Mọi điểm gọi `write` / `writeMany`

| Mutation | Action | Body log |
|----------|--------|----------|
| `OrderService.deleteOrder(id, ctx)` | `delete` | không có field/before/after |
| `OrderService.updateField(id, dto, role, ctx)` | `update` | `{ field, before: orderCũ[field], after: newValue }` |
| `OrderService.bulkUpdateField(dto, role, ctx)` | `bulk_update` | 1 row per matched order, mỗi row có `before/after` riêng |
| `OrderService.forceCompleteOrder(id, role, ctx)` | `force_complete` | `field='fulfillmentCompletedAt'`, `before` = chặng đơn đang đứng, `after = { completedAt, start, steps[] }` — SuperAdmin ép đơn về đã hoàn thành sản xuất, xem `Orders.md §23` |
| `OrderService.importOrders(dto, ctx)` | `import` | 1 row summary per inserted/updated order: `after = { productionId, type, isMapped, _subAction: 'create'|'update' }`. **Re-import đơn đã tồn tại**: thêm 1 row riêng cho MỖI field bị ghi đè giá trị khác so với trước (`field` + `before` + `after` — cùng shape `updateField()` nên FE render diff bình thường). So sánh ổn định qua `stableStringifyForDiff()` (key-sort trước khi stringify, tránh false-positive do thứ tự key object như `designs` khác nhau). Field bị đổi thường gặp: `factoryId`/`machineTypeId`/`type`/`color`/`size`/`designs`/`designsOriginal`/`mockupUrl` — các field này KHÔNG được bảo vệ khỏi ghi đè khi re-import (khác `toolResult`/`fabricType`/`machineNumber` — insert-only), log lại để truy vết thay vì chặn. Xem `Orders.md` phần OnosPod import. |

Trong mọi case, log push **fire-and-forget** (`void`) để không chặn response.

---

## 5. Endpoint

`GET /v1/orders/:id/logs?page=1&limit=200&action=&field=&sort=createdAt&order=desc`

| Quyền | Role |
|-------|------|
| Xem log | **Mọi user đã đăng nhập** (`@Auth([])` — RolesGuard pass khi roles rỗng). Trước đây giới hạn SuperAdmin/Admin/Manager/Support; đã mở cho tất cả role vì lịch sử đơn cần cho cả Designer/Fulfillment tra cứu. |

Response: `{ success, data: ProductionOrderLog[], total }`

---

## 6. Frontend `OrderLogTimelineDialog`

### 6.1 Props
```ts
{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId?: string;       // _id của order
  productionId?: string;  // hiển thị trong tiêu đề
}
```

### 6.2 UI
- shadcn `Dialog` max-w-2xl.
- Header: icon `History` + `Lịch sử thay đổi — {productionId}`.
- Subhead: số bản ghi + nút "Tải lại".
- Body: **danh sách card** (`space-y-2`, mỗi entry 1 card border) — thay timeline trục dọc cũ cho gọn/dễ nhìn.
- Mỗi entry:
  - Badge action (`Tạo` / `Cập nhật` / `Bulk` / `Import` / `Xóa` / `Hủy đơn` / `Đổi design`).
  - Tên field (label tiếng Việt qua helper `fieldLabelFor(field)`): tra map `FIELD_LABEL` (`designerStatus`→"TT Designer", `productionError`→"Lỗi xưởng", `machineNumber`→"Máy", `fabricType`, `productionErrorSource`…) **+ key động của Task Fulfillment**: `fulfillmentStages.<stage>.status` → **"Công đoạn {tên stage VI}"** (`FULFILLMENT_STAGE_LABELS`, vd `qc-post-press`→"QC sau ép"), `currentFulfillmentStage` → "Công đoạn hiện tại". Fallback = raw key.
  - Diff `before → after` render qua `<DiffRow>` + `<StatusPill>`: pill cũ xám gạch ngang + icon `ArrowRight` + pill mới **tô màu theo trạng thái**.
  - **Value hiển thị NAME + MÀU, không phải code** (`resolveDisplay(field, value) → { text, color }`):
    - `designerStatus` → nhãn VI (`DESIGNER_STATUS_LABELS`) + màu (`DESIGNER_STATUS_COLOR`: done=emerald, rework=amber, in-progress=indigo, rejected=rose…).
    - Field workshop_config (`printStatus`, `toolResultNote`, `machineNumber`, `productionError`, `errorFile`…) → `useWorkshopConfigStore.resolve(category, code)` lấy **`.name` + `.color`** (map `FIELD_CATEGORY`). `errorFile` là mảng → resolve từng phần tử, join `, `.
    - `productionErrorSource` → "Do designer" (violet) / "Do xưởng" (sky).
    - **Trạng thái công đoạn fulfillment** (`fulfillmentStages.<stage>.status`) → nhãn VI (`FULFILLMENT_STATUS_LABELS`: waiting→"Chờ làm", in-progress→"Đang làm", done→"Đã xong", rework→"Cần làm lại") + màu (`FULFILLMENT_STATUS_COLOR`). `currentFulfillmentStage` (code stage) → tên VI qua `FULFILLMENT_STAGE_LABELS`.
    - Màu áp qua `tintStyle(hex)`: chữ = hex, nền = hex + 12% alpha (8-digit hex inline style).
    - **`assignee` (userId) → tên được resolve ở BACKEND** (`OrderService.getLogs` batch `userModel.find` → thay `before/after` = `fullName`) nên đúng cho MỌI viewer, không phụ thuộc quyền xem designer team. FE không còn dùng designer team store ở dialog này.
  - **Import** (`action='import'`): `after` là object tóm tắt → render qua `renderImportPayload()` (KHÔNG dump JSON): badge **Tạo mới/Cập nhật** (`_subAction` create/update), `productionId` (mono), `type`, chip **Đã map / Chưa map sản phẩm** (`isMapped`); key lạ khác hiện "label: name".
  - Footer: `userName · roleCode · ip`.
  - Timestamp định dạng `vi-VN`.
- Auto-fetch khi `open=true` + `loadConfig()` / `fetchTeam()` (nếu store chưa load) để resolve name; clear logs khi đóng.

### 6.3 Cách gọi
Trong `ListOrderTab.tsx`, mỗi row có nút icon `History`:
```tsx
<Hint content="Lịch sử thay đổi">
  <Button variant="ghost" size="icon" onClick={() => onHistory(it._id, it.productionId)}>
    <History size={14} />
  </Button>
</Hint>
```
Khi user click → `openHistory(id, productionId)` set state → dialog mở → fetch.

---

## 7. Performance notes

- Endpoint dùng compound index `(orderId, createdAt: -1)` — query timeline 1 đơn rất nhanh kể cả khi orderLogs collection lớn.
- Audit write fire-and-forget → không tăng latency API mutation.
- Bulk update / import dùng `writeMany` (1 `insertMany`) thay vì N round-trips.

---

## 8. Liên hệ

| Module | Mối quan hệ |
|--------|-------------|
| Order | OrderService inject `OrderLogService` qua `OrderLogModule`. Mọi mutation phải gọi log. |
| Auth | `@AuthUser()`, `@ClientIp()`, `@UserAgent()` cung cấp `AuditContext`. |
| RBAC (Phase 0) | Sẽ thay role-array trong controller bằng permission `order.log.view`. |
| OrderTableWorkshop (Phase 4) | Sẽ tái dùng `OrderLogTimelineDialog` — cùng signature. |

---

## Ghi vết phiên mạo danh (`AUTH-1`)

`ProductionOrderLogEntity` có thêm `impersonatorId` + `impersonatorName`: khi thay đổi
phát sinh trong **phiên mạo danh** của SuperAdmin, `userId`/`userName` vẫn là **người bị
mạo danh** (danh tính hiệu lực trong phiên), 2 field mới cho biết **ai thực sự ngồi gõ**.
Rỗng ở phiên thường.

Đọc từ `params.ctx.user.impersonatedBy` trong `OrderLogService.write()` — **một điểm chạm
duy nhất**, vì mọi đường ghi log đơn hàng đều đi qua đúng hàm đó. Chi tiết cơ chế:
[`Auth.md §10`](Auth.md).
