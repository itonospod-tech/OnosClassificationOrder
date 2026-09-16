# Hướng dẫn quy trình DTF theo vai — Function Description

> **File FE:** `apps/web/src/pages/guide/dtf/` (`index.tsx`, `DtfFlowDiagram.tsx`, `DtfRoleSection.tsx`, `DtfStepBlock.tsx`, `dtfGuideRoles.ts`, `dtfShotI18n.ts`, `dtfShots.generated.ts`)
> **File BE:** không có (chỉ thêm mã quyền `page.guide_dtf` ở `packages/shared/constants/permission-catalog.ts`)
> **Route:** `/ffm/guide/dtf` (`PATHS.DTF_GUIDE`), tham số `?role=<vai>`
> **API:** không gọi API — trang 100% tĩnh
> **Ảnh:** `apps/web/public/guide/dtf/<vai>/<bước>.webp` + `manifest.json` (kịch bản: `documents/Plans/DtfRoleGuide-Storyboard.md`)

## 1. Overview

Trang NỘI BỘ (sau đăng nhập, trong `MainLayout`) hướng dẫn từng vai trong xưởng DTF làm gì, nhận việc từ ai, giao cho ai —
mỗi bước là 1 ảnh chụp THẬT giao diện `apps/web` trên dữ liệu demo, có viền + huy hiệu số + danh sách chú thích + phóng to.

8 vai (thứ tự = thanh chọn vai = thư mục ảnh): `support` (Support soát tool, 6 bước) · `designer-leader` (5) · `designer` (8) ·
`fulfillment-print` (In, 7) · `fulfillment-press` (Ép, 6) · `fulfillment-qc-post-press` (QC sau ép, 5) · `fulfillment-pack`
(Đóng hàng, 5) · `admin` (Quản lý xưởng theo quyền Admin, 10). Tổng 52 bước.

USER chốt (Storyboard §2.1): trang nội bộ ở `/ffm`; ảnh thật trên dữ liệu demo; đủ 8 vai; QC sau ép + Đóng hàng vẫn hướng dẫn
đủ (trang KHÔNG nêu xưởng thật đã có người giữ hay chưa — §2.5); phần Quản lý viết theo quyền Admin; danh mục lỗi trong ảnh là lỗi demo.

## 2. Luồng hoạt động

### 2.1 Bố cục trang (`pages/guide/dtf/index.tsx`)

1. Tiêu đề + mô tả + ô ghi chú "ảnh là dữ liệu demo / giao diện tiếng Việt".
2. **Sơ đồ luồng liên vai** (`DtfFlowDiagram.tsx`) — HTML + SVG inline, lưới 8 cột × 2 hàng trong khung `overflow-x-auto`
   (`min-w-[70rem]`): Đơn vào SX → Support —Ok→ In → Ép → QC sau ép ⇢ May nhận vào + May xuất ra (tự xong, nét đứt) ⇢ Đóng hàng →
   Hoàn thành; nhánh Support ↓ "Lỗi / Không có file PDF" → Designer Leader → Designer ↑ "Hoàn thành (Note → ok)" → In; ô Quản lý
   (Admin). Ô là vai → nút bấm mở vai đó + cuộn tới phần vai. Dưới sơ đồ: khối **"Khi báo lỗi — đơn bị đẩy về"** (5 dòng nét đứt:
   In→Support, In→Designer, Ép→In/Designer, QC→Ép/In/Designer (+ Soát tool theo danh mục), Đóng hàng→công đoạn trước) + 2 dòng
   xuyên suốt (Giữ đơn, Quét mã).
3. **Thanh chọn vai** dính đầu vùng cuộn (`sticky -top-4 md:-top-6 -mx-4 md:-mx-6` — bù padding của `<main>`, vì khung app
   cố định chỉ `<main>` cuộn). 8 nút tròn, cuộn ngang trên điện thoại (nút đang chọn tự lọt khung). Nút của vai tài khoản có
   nhãn "Vai của bạn".
4. **Phần vai** (`DtfRoleSection.tsx`, `key={vai}`): tên + mục tiêu + số bước · cảnh báo đầu vai (QC sau ép, Đóng hàng, Admin) ·
   3 ô "Màn hình làm việc / Nhận việc từ / Giao cho" (vai liên quan có nút "Xem vai …") · mục lục bước (vai ≥ 6 bước —
   `TOC_MIN_STEPS`) · các bước (`DtfStepBlock.tsx`) · khối "Khi có lỗi / làm lại" · khối "Lưu ý".

### 2.2 Chọn vai mặc định (`userDtfRole()` trong `dtfGuideRoles.ts`)

URL có `?role=` hợp lệ → mở vai đó (gửi link cho nhau được). Không có / sai → vai theo tài khoản (`authStore.profile`):

| `role.name` | Vai mở |
| --- | --- |
| `Support`, `SupportManager` | `support` |
| `DesignerLeader` | `designer-leader` |
| `Designer` | `designer` |
| `Fulfillment` | theo `fulfillmentStage`: `print` / `press` / `qc-post-press` / `pack` → vai công nhân tương ứng; `sew-in`/`sew-out`/không có → vai đầu |
| `Admin`, `SuperAdmin`, `Manager` | `admin` |
| còn lại | vai đầu (`support`), không có nhãn "Vai của bạn" |

Chọn vai = `setSearchParams(role, { replace: true })` (giữ nguyên `?factoryId=` của bộ chọn xưởng).

### 2.3 Chuyển vai, cuộn, focus

- Nút trên thanh chọn: chỉ cuộn tới đầu phần vai khi đầu phần đang khuất phía trên thanh (đứng ở đầu trang thì không nhảy).
- Ô sơ đồ / dòng "đẩy về": luôn cuộn tới đầu phần vai.
- Nút "Xem vai …" nằm TRONG phần vai cũ (bị gỡ khi đổi vai) → focus chuyển về tiêu đề vai mới (`tabIndex=-1`), không rơi về BODY.
- Cuộn/focus chạy trong `useEffect` sau khi phần vai mới render (`pendingRef`).
- Hộp phóng to là modal (Radix) nên không đổi vai được khi đang mở; đóng bằng Esc trả focus về nút đã mở (logic của `ShotLightbox`):
  mở từ huy hiệu → về huy hiệu đó; mở từ ảnh hoặc nút "Phóng to" → về nút "Phóng to". Mở từ huy hiệu thì hộp tự cuộn khung ảnh tới
  huy hiệu đó (`revealOnOpen`, TASK-01 BUG-3). `DtfStepBlock.handleZoomOpenChange` thêm lớp phòng hờ (DEV-14, TEST-07 BUG-2): nếu
  sau khi Radix trả focus mà focus vẫn ở BODY thì tìm lại huy hiệu theo số chú thích trong bước và focus nó — đúng chỗ rồi thì không làm gì.
- Bấm lại menu "Hướng dẫn DTF" đang active (`useSidebarResetSignal(PATHS.DTF_GUIDE)`, Orders.md §20) → bỏ `?role=` + lên đầu trang.

### 2.4 Nội dung — các điểm "đi vòng" đang được hướng dẫn

Chỉ viết hành vi hiện tại (kiểm code + ảnh ngày 11/09/2026), KHÔNG hứa tính năng chưa có. Các bất thường trong Storyboard §7 được
hướng dẫn đi vòng — khi code sửa thì PHẢI sửa chữ tương ứng:

| Bất thường | Chỗ hướng dẫn (khoá i18n `dtfGuide`) |
| --- | --- |
| A1 — Admin/Manager không làm thay công nhân trên Task Fulfillment → công đoạn không có người thì đơn dừng (chữ hướng dẫn KIỂM khi triển khai, không nêu hiện trạng — §2.5) | `roles.admin.alert`, `roles.admin.notes.noOverride`, `roles.admin.errors.noWorker`, `roles.fulfillment-qc-post-press.alert`, `roles.fulfillment-pack.alert` (bước Admin 09–10) |
| A2 — Bảng In hiện "Bắt đầu" cho đơn đang giữ, bấm bị từ chối | `roles.fulfillment-print.errors.held` |
| A3 — Dialog báo lỗi ở Đóng hàng (xưởng `no-sew`) hiện và chọn sẵn chip "May xuất ra"; BE tự lùi về QC sau ép nên chữ nói rõ hệ quả, không bảo "phải đổi chip" (§2.6) | `roles.fulfillment-pack.steps.03-report-error.note`, `errors.changeChip` |
| A4 — Tiêu đề phụ kanban in mã xưởng thô | `roles.fulfillment-press.notes.rawFactory` |
| A5 — Quét `E-…` trong ô Tìm của kanban không ghi lỗi | `roles.fulfillment-press.steps.02-scan-dialog.note`, `roles.fulfillment-qc-post-press.notes.scanPageOnly` |
| A6 — Soát tool / tab Designer / Task của tôi / Nhật ký bù lỗi bỏ qua bộ chọn xưởng | `notes.allFactories` (support, designer, admin), `roles.admin.steps.05-error-log.note` |
| A11 — Khối "Cần gán designer" lẫn đơn không cần designer | `roles.designer-leader.notes.mixedBacklog` |
| A12 — Chi tiết đơn của Designer hiện mã thô "error" | `roles.designer.steps.03-task-detail.note` |
| A16 — Đơn QC báo lỗi bằng quét mất nút trên bảng In | `roles.fulfillment-print.steps.06-rework-watching.note`, `errors.reworkNoButton` |
| A17 — Ô "Lỗi xưởng" ở bảng In liệt kê lỗi mọi công đoạn | `roles.fulfillment-print.steps.05-error-cell.note` |
| A18 — Màn quét còn chữ "QR" | `notes.qrWording` (In, Ép, Đóng hàng) |
| Công nhân đăng nhập về Dashboard, không về Task | `notes.openMenu` (4 vai công nhân) |

Chữ trên trang dùng nhãn chung ("Mã sản xuất", "Xưởng đang chọn", "Lỗi đang chọn") thay cho mã đơn demo cụ thể trong nhãn chú thích
của manifest.

### 2.5 Cần kiểm khi triển khai (không ghi hiện trạng lên trang)

Trang KHÔNG nêu số liệu thời điểm: số trong Storyboard §1 lấy từ bản sao DB local, không kiểm được trên production. Thay vào đó:
`roles.admin.alert` hướng dẫn Admin kiểm, `roles.fulfillment-qc-post-press.alert` / `roles.fulfillment-pack.alert` hướng dẫn công nhân
nhờ Admin kiểm tài khoản đã gán đúng xưởng + công đoạn. Khi đưa một xưởng DTF thật vào chạy, kiểm (Agent API production theo
`documents/Architecture/CheckProductionData.md`, hoặc trang Người dùng):

1. Mỗi công đoạn thường In / Ép / QC sau ép / Đóng hàng của xưởng có đúng 1 user Fulfillment đang bật (`users.factoryId` +
   `fulfillmentStage`). Đóng hàng không cần người khi xưởng bật `autoCompletePack`.
2. Xưởng có `flowType = no-sew` — mọi chữ "May nhận vào + May xuất ra tự xong" viết theo luồng này.
3. Cấu hình tự động gán designer (Quản trị › Cài đặt › Tự động gán designer, `/adm/settings/designer-assign`, DesignerAutoAssign.md)
   có phủ khách hàng / sản phẩm / xưởng của đơn DTF không — không phủ thì đơn soát lỗi nằm ở "Cần gán designer" chờ Leader.
4. Xưởng có bật `autoCompletePack` ("Tự hoàn thành Đóng hàng", tab Xưởng) không — quyết định công nhân Đóng hàng có phải xác nhận tay.

**DEV-12 (11/09/2026) đã đổi 2 câu hiện trạng cuối cùng thành hướng dẫn có điều kiện** (cùng cách DEV-11 sửa các khoá `alert`):
`roles.designer-leader.notes.noAutoAssign` (trước: "Xưởng DTF hiện chưa cấu hình tự động gán designer…" → sau: "Nếu đơn không khớp
cấu hình tự động gán designer … Admin cấu hình ở Quản trị › Cài đặt › Tự động gán designer…") và
`roles.fulfillment-pack.steps.01-kanban.body` (trước: "Xưởng DTF chưa bật Tự hoàn thành Đóng hàng…" → sau: "Nếu xưởng bật … đơn mới
tự hoàn thành, không chờ bạn xác nhận; nếu không bật, bạn xác nhận tay…"). Tên menu kiểm theo `pages/settings/index.tsx`
(`settings.nav.designerAssign`) + nhóm sidebar `sidebar.groups.admin`; nhãn công tắc theo `products.json` (`autoPack.label`).
Soát lại cả 2 file: không còn tên xưởng thật, số người, ngày cụ thể hay cấu hình bật/tắt khẳng định. Còn lại CHỈ các câu "xưởng DTF
bỏ may" — đó là tiền đề cả trang viết theo (`flowType = no-sew`, mục 2), không phải số liệu thời điểm. Các câu "đang hiện mã thô…"
(A4, A12) mô tả hành vi CODE, sửa theo §2.4 khi code đổi.

### 2.6 Căn cứ code của 2 điểm nội dung (DEV-11, kiểm 11/09/2026)

- **Báo lỗi ở Đóng hàng, xưởng `no-sew`.** Chip = Designer + mọi công đoạn đứng trước Đóng hàng, không lọc `flowType`; chip mặc
  định = công đoạn liền trước = "May xuất ra" (`pages/fulfillment/my-tasks/ReworkBackDialog.tsx:32-34`). Nút "Đẩy về xử lý" gửi
  `rework-back` + `target` (`my-tasks/index.tsx:1085-1086`) → `transition` đọc `flowType`/`autoPack` của xưởng
  (`fulfillment-task.service.ts:195-210`) → `resolveTransition` gọi `redirectAutoTarget` (`:571`): `no-sew` có auto-stage May nhận
  vào + May xuất ra (`packages/shared/enums/factory-flow.ts:36`), vòng lùi qua auto-stage (`factory-flow.ts:57-65`) → đích thật là
  **QC sau ép** (trạng thái `rework`, `reworkFromStage = pack`, `:585-591`). Đường quét / gán lỗi lùi y hệt
  (`order.service.ts:1156-1160`, `buildFulfillmentReworkBack`). → Chữ: chọn "May xuất ra" / "May nhận vào" = về QC sau ép.
  Khoá: `roles.fulfillment-pack.steps.03-report-error.{note,callouts.1,callouts.2}`, `errors.changeChip`, `flow.back.items.pack`.
- **Giữ / Mở giữ.** `POST /orders/:id/hold`, `POST /orders/:id/unhold`, `PATCH /orders/bulk-hold` gác `ORDER_WRITE_ROLES` =
  SuperAdmin, Admin, Manager, Support, DesignerLeader, Fulfillment (`apps/api/src/modules/order/order.controller.ts:108-115`,
  `:502-542`); service không kiểm thêm vai (`order.service.ts:5005` `holdOrder`, `:5055` `unholdOrder` — tham số `_roleName` bỏ qua).
  FE mirror `HOLD_ALLOWED_ROLES`/`canUserHold` (`apps/web/src/utils/orderActions.ts:25-35`) → menu "…"
  (`components/orders/OrderRowActionsMenu.tsx:65-67`), có ở Danh sách đơn và NGAY trên bảng In (`PrintWorkshopView.tsx:162`).
  → **Support mở giữ được; Designer không giữ / mở giữ được.** Khoá: `flow.crosscut.hold`, `roles.support.errors.waitCustomer`,
  `roles.fulfillment-print.errors.held`, `roles.admin.steps.04-hold-unhold.body`.

## 3. API / Schema

Không có API. Dữ liệu tĩnh:

```ts
// dtfShots.generated.ts — TỰ SINH (emit-ts.mjs), khoá = '<vai>/<bước>'
DTF_SHOTS: { [key]: { file: '<vai>/<bước>.webp'; width; height; callouts: { n; xPct; yPct; boxPct: { x; y; w; h } }[]; ink: { cell; cols; rows; data } } }

// dtfGuideRoles.ts
DTF_ROLE_IDS = ['support', 'designer-leader', 'designer', 'fulfillment-print', 'fulfillment-press',
                'fulfillment-qc-post-press', 'fulfillment-pack', 'admin'] as const;   // = giá trị ?role=
DtfRole { id; icon; steps: GuideStep[]; from/to: DtfFlowNodeId[]; errorKeys; noteKeys; alert? }
```

i18n namespace `dtfGuide` (`apps/web/src/i18n/locales/{vi,en}/dtfGuide.json`, 692 khoá mỗi file):
`title/subtitle/demoNote/uiNote/shotFrameLabel` · `flow.{nodes,edges,back,crosscut}` · `picker.*` · `section.*` ·
`roles.<vai>.{name,short,goal,alert?,entry,from,to,errors.*,notes.*}` · `roles.<vai>.steps.<bước>.{title,body,note?,alt,callouts.<n>.{label,detail}}`.
Ô lưu ý của bước hiện khi có khoá `note` (`i18n.exists`). Bản `en` giữ nhãn UI tiếng Việt trong ngoặc kép kèm nghĩa (ảnh là giao diện tiếng Việt).
Nhãn sidebar ở `layout.sidebar.guideDtf`; nhãn quyền ở `auth.permissions["page.guide_dtf"]`.

## 4. UI Components

### 4.1 File

| File | Vai trò |
| --- | --- |
| `pages/guide/dtf/index.tsx` | Trang: header, sơ đồ, thanh chọn vai (sticky), chọn vai mặc định, `?role=`, cuộn/focus, reset sidebar |
| `pages/guide/dtf/DtfFlowDiagram.tsx` | Sơ đồ luồng liên vai + khối đẩy về + dòng xuyên suốt |
| `pages/guide/dtf/DtfRoleSection.tsx` | Một vai: header, cảnh báo, nhận/giao, mục lục, các bước, lỗi, lưu ý |
| `pages/guide/dtf/DtfStepBlock.tsx` | Một bước: chữ (UI kit nội bộ) + ảnh/chú thích/phóng to (component TASK-01) |
| `pages/guide/dtf/dtfGuideRoles.ts` | Danh sách vai + bước (khoá ảnh có type), `userDtfRole()`, id neo |
| `pages/guide/dtf/dtfShotI18n.ts` | Bản sao i18n ghi đè nhãn khung ảnh (§4.3) |
| `pages/guide/dtf/dtfScroll.ts` | Cuộn tới phần vai / bước bằng cách tự tính vị trí trong khung cuộn gần nhất (`<main>`), chừa chiều cao thanh chọn vai. KHÔNG dùng `scrollIntoView({block:'start'})`: khi `<main>` hết chỗ cuộn (vd bước cuối), trình duyệt cuộn luôn khung `h-screen overflow-hidden` của `MainLayout` → header trôi, đáy trắng |
| `pages/guide/dtf/dtfShots.generated.ts` | Hình học + lưới mực — TỰ SINH |
| `scripts/dtf-guide/emit-ts.mjs` | Sinh file trên từ `out/guideShots.generated.json`, kiểm chéo manifest |

### 4.2 Tái dùng component TASK-01 (KHÔNG sửa)

`DtfStepBlock` import thẳng `pages/guide/order/{AnnotatedShot,CalloutList,ShotLightbox,badgeLayout,scrollMarker,guideTypes}` —
thuật toán đặt huy hiệu dính viền, lưới mực, lightbox, đồng bộ hover/focus giữ nguyên (OrderGuide.md §4.2–§4.4). Không dùng
`GuideStepBlock` vì nó gắn cứng khoá i18n `orderGuide.flows.*` và kiểu chữ trang public; `useCalloutHighlight` (không export)
được CHÉP vào `DtfStepBlock` — sửa luật sáng chú thích thì sửa CẢ HAI nơi.

### 4.3 Hai chỗ đi vòng vì không sửa được file TASK-01

1. **Đường dẫn ảnh:** `AnnotatedShot` ghép `src = ${BASE_URL}guide/order/ + step.file`. `dtfGuideRoles.ts` nối tiền tố
   `DTF_FILE_PREFIX = '../dtf/'` → `/guide/order/../dtf/support/01-login.webp`, trình duyệt chuẩn hoá thành `/guide/dtf/…`
   (đã kiểm Vite dev trả 200). Nếu TASK-01 thêm tham số thư mục ảnh thì bỏ tiền tố này.
2. **Nhãn khung ảnh:** các component TASK-01 gọi cứng `useTranslation('orderGuide')` → thanh trên khung ảnh ghi "Cổng seller".
   `dtfShotI18n.ts` tạo `i18n.cloneInstance({ forkResourceStore: true })` (kho resource tách riêng, không ảnh hưởng `/guide/ordering`),
   ghi đè đúng `orderGuide.shot.frameLabel` = `dtfGuide.shotFrameLabel` ("Hệ thống xưởng" / "Workshop system"), bọc bước bằng
   `<I18nextProvider i18n={dtfShotI18n}>`; bản sao nghe `languageChanged` của bản chính. Các chữ khác ("Phóng to", "Đóng ảnh phóng to"…)
   dùng nguyên của `orderGuide`.

### 4.4 Style & responsive

UI kit nội bộ (token `bg-card`/`border-border`/`text-muted-foreground`/`bg-primary`, `dark:`), không dùng primitive public/landing.
Component ảnh TASK-01 giữ màu thương hiệu tím và nền trắng của chúng. Body và `<main>` không cuộn ngang ở 390; sơ đồ và thanh
chọn vai cuộn ngang trong khung riêng; ảnh rộng cuộn trong khung ảnh (`shotMinWidth`).

## 5. Backend logic

Không có. Quyền trang: `page.guide_dtf` thêm vào `PERMISSION_CATALOG` + preset `Support`, `DesignerLeader`, `Designer`,
`Fulfillment`; `Manager` tự có (mọi mã trừ `ADMIN_ONLY_PAGE_CODES` — KHÔNG thêm mã này vào danh sách đó); `Admin`/`SuperAdmin`
= mọi mã. `RoleService.onModuleInit` (`apps/api/src/modules/role/role.service.ts`) đồng bộ `permissionCodes` của system role về
preset MỖI lần API khởi động → sau khi build lại `shared` + API khởi động lại, tài khoản đăng nhập lại (hoặc `getMe` ở `MainLayout`)
là có quyền. Role tự tạo (`isSystem=false`) phải tự tick quyền ở trang Vai trò.

## 6. Ảnh chụp: cách sinh và cách cập nhật

### 6.1 Route KHÁC thư mục ảnh

Ảnh ở `public/guide/dtf/`, route `/ffm/guide/dtf` → không trùng (bẫy trùng tên thư mục public: OrderGuide.md §6.1).
Không đổi route thành `/guide/dtf`.

### 6.2 Bảo mật

File trong `public/` **tải được không cần đăng nhập** (ai biết URL `/guide/dtf/<vai>/<bước>.webp` đều xem được) — trang được gác
quyền nhưng ảnh thì không. Vì vậy ảnh CHỈ chứa dữ liệu demo đã che (Storyboard §4.1: `capture.mjs` chặn response, chỉ giữ đơn
`DEMO-DTF-*`, xưởng `DEMO-DTF`, tài khoản `demo.*@example.com`, lỗi DEMO; ẩn khối số toàn nhà máy; trường `masked` của từng ảnh
trong manifest ghi rõ đã che gì). Chụp lại → mở TỪNG ảnh soát không còn tên người / email / SKU / mã đơn / tên xưởng thật.

### 6.3 Quy trình chụp lại (DB LOCAL, không bao giờ chạy vào production)

```bash
# 0. Thông tin đăng nhập ở apps/web/scripts/dtf-guide/.env.local (gitignore): DTF_ADMIN_EMAIL, DTF_ADMIN_PASSWORD, DTF_DEMO_PASSWORD
# 1. Dữ liệu demo — chạy TRONG NGÀY chụp (bảng In chỉ hiện đơn vào SX hôm nay)
node apps/web/scripts/dtf-guide/seed-demo.mjs --stages print,press,qc-post-press,pack
# 2. Chụp (cần API :3007 + Web :5173). Một lệnh một lúc — các lượt ghi đè manifest của nhau
PLAYWRIGHT_PATH=/path/to/playwright-core/index.mjs node apps/web/scripts/dtf-guide/capture.mjs --roles support,designer-leader,designer
PLAYWRIGHT_PATH=/path/to/playwright-core/index.mjs node apps/web/scripts/dtf-guide/capture.mjs --roles print,press,qc-post-press,pack,admin
# 2b. Chụp lại VÀI ảnh: vai chạy đủ kịch bản nhưng chỉ ghi ảnh liệt kê — ảnh khác của vai giữ nguyên byte (manifest gộp theo ảnh).
#     KHÔNG dùng cho fulfillment-pack (bước 05 tiêu hao đơn).
PLAYWRIGHT_PATH=/path/to/playwright-core/index.mjs node apps/web/scripts/dtf-guide/capture.mjs --shots designer/02-task-card,designer-leader/01-assign-backlog
# 3. SAU khi chụp xong: sinh file hình học được commit (kiểm chéo manifest, lệch thì không ghi)
node apps/web/scripts/dtf-guide/emit-ts.mjs
```

- `capture.mjs` KHÔNG ghi `.ts` (nodemon API theo dõi `apps/**/*.ts`) — ghi `scripts/dtf-guide/out/guideShots.generated.json`
  (thư mục `out/` bị gitignore). `emit-ts.mjs` chuyển thành `src/pages/guide/dtf/dtfShots.generated.ts`. Chạy `emit-ts` khi
  không có lượt chụp đang chạy (ghi `.ts` làm API khởi động lại).
- **Đơn DEMO-DTF-29 đã bị tiêu hao** bởi ảnh `fulfillment-pack/05-scan-done` (quét N- rồi OK thật → hoàn thành sản xuất). Lượt chụp
  sau tự bỏ qua ảnh đó và giữ ảnh cũ; muốn chụp lại thì đổi mã đơn tiêu hao trong `seed-demo.mjs` + `capturePack()` (Storyboard §6.2).
- Env của `emit-ts.mjs`: `DTF_MANIFEST`, `DTF_SHOTS_OUT`, `DTF_TS_OUT`.
- **Ảnh nhỏ / phần tử sát mép:** `shot({ pad })` nhận `{ top, right, bottom, left }` — chừa lề ở phía TRỐNG để huy hiệu số đứng ngoài
  viền (thuật toán đặt huy hiệu của TASK-01 không sửa ở đây). Đang dùng: `designer/02-task-card` (trái 36 / phải 44),
  `designer-leader/01-assign-backlog` (trái 44). Lề không được lộ mép khối bên cạnh (vd lề dưới 48 ở ảnh Leader lộ tiêu đề khối
  "Tất cả designer theo ngày") — mở ảnh soát bằng mắt. Muốn thử lề mới mà không đụng ảnh thật: đặt `DTF_OUT` + `DTF_SHOTS_OUT`
  vào thư mục tạm.
- Dashboard tab Designer phải mở kèm `?factoryId=<xưởng demo>`: dải "Vòng đời đơn" gọi `lifecycle-overview` theo phạm vi URL,
  thiếu thì `shot()` từ chối chụp.

### 6.4 Khi UI đổi

1. Chụp lại (§6.3), soát từng ảnh (§6.2).
2. Đổi tên / thêm / bớt ảnh → sửa `shot('<vai>/<bước>')` trong `dtfGuideRoles.ts` (type-check chỉ ra khoá sai).
3. Thêm / bớt chú thích hoặc bước → sửa khoá `roles.<vai>.steps.<bước>` ở CẢ `vi` và `en` `dtfGuide.json` (số khoá 2 file phải bằng nhau).
4. Mở từng ảnh mới, đối chiếu `title/body/label/detail` với chữ trên ảnh; nhãn nút trích đúng chữ UI.
5. Khi một bất thường ở §2.4 được sửa trong code → sửa/bỏ khoá hướng dẫn đi vòng tương ứng.
6. Kiểm kỹ thuật §6.5 + `pnpm build-types` + ESLint.

### 6.5 Kiểm kỹ thuật (Playwright, không nằm trong repo)

Với `demo.admin` / `demo.qc` / `demo.designer.a` ở 1440×900 và 390×844: vai mặc định đúng (§2.2) + nhãn "Vai của bạn"; sidebar
có entry; đi qua 8 vai, cuộn từng bước → 52/52 ảnh `complete && naturalWidth > 0`, không request `/guide/` lỗi;
`documentElement` và `<main>` đều `scrollWidth <= clientWidth`; huy hiệu (Admin, trong bài + hộp phóng to): cách viền ≤ 4px hoặc có
đường dẫn, không nằm trong viền khác, không giao nhau, nằm trong ảnh; `?role=fulfillment-pack` mở đúng vai, `?role` sai về vai
mặc định; bấm ô sơ đồ cuộn tới vai; thanh chọn vai dính sát mép trên `<main>`; mục lục không để thanh che tiêu đề bước, và
nhảy tới bước CUỐI không làm trôi khung app (mọi phần tử ngoài `<main>` giữ `scrollTop = 0`); sơ đồ không cuộn ngang ở 1440;
Esc đóng hộp phóng to trả focus; nút "Xem vai" đưa focus về tiêu đề vai mới; đổi ngôn ngữ ở header → thanh khung ảnh đổi theo;
tài khoản bị bỏ `page.guide_dtf` (giả lập bằng chặn response `auth/me`) thấy màn không có quyền và không có entry sidebar.

Kết quả 11/09/2026 (DEV-10): 175 huy hiệu × {1440, 390} — (a) 0, (c) 0, ngoài ảnh 0; còn 2 ảnh lỗi: `designer/02-task-card`
(#4 "KLĐ" nằm trong viền #1, che ~92% mực) và `designer-leader/01-assign-backlog` (#2 đè mockup, che 87–100%).

**DEV-11 đã sửa (11/09/2026):** chụp lại ĐÚNG 2 ảnh bằng `--shots` với lề rộng ở phía trống (§6.3), 50 ảnh khác trùng byte.
`02-task-card` 193×231 → 249×231 và **bớt 4 → 3 chú thích**: bỏ chú thích riêng nhãn "Lỗi" (Note kq Tool) — kẹp giữa mockup, mã sản
xuất và "KLĐ", huy hiệu của nó chỉ còn chỗ đè lên chính chữ "Lỗi"; nghĩa nhãn gộp vào chú thích #1 (#1 đường dẫn, #2 `left-end`,
#3 "KLĐ" `right-start`). Lưu ý: bộ kiểm (a)–(d) KHÔNG bắt được huy hiệu che chữ của CHÍNH phần tử nó chỉ — phải soát ảnh bằng mắt;
`01-assign-backlog` 1184×144 → 1212×144 (#2 `left-start`, che ≤3%). Kiểm lại ở 1440 + 390 (trong bài + phóng to): 174 huy hiệu, 17 đường
dẫn — (a) 0, (b) 0, (c) 0, ngoài ảnh 0, che > 25% 0; 52/52 ảnh, 0 lỗi console, không tràn ngang; `/guide/ordering` 17/17 ảnh.
Ảnh thẻ mới hiện "SX: 16:57 11-09" (seed đã chạy lại sau lượt chụp cũ — chỉ đổi giờ, cùng nội dung).

### 6.6 Ngoại lệ đã biết (BA chấp nhận, KHÔNG sửa)

Huy hiệu lệch / che nhưng không che chữ của CHÍNH phần tử được giải thích (TEST-07, BA chấp nhận 12/09/2026). Chụp lại hoặc đổi
thuật toán đặt huy hiệu thì soát lại danh sách này:

| Ảnh | Chú thích | Ghi chú |
| --- | --- | --- |
| `support/04` | #3 | |
| `designer-leader/05` | #1 | đường dẫn dài |
| `fulfillment-print/05` | #2 | |
| `fulfillment-press/01` | #3–4 | |
| `fulfillment-pack/05` | #3 | |
| `admin/01` | #1 | |
| `admin/06` | #1 | |
| `designer/03` | — | thứ tự sự kiện trong "Timeline designer" của dữ liệu demo không theo trình tự thật |

### 6.7 Căn cứ nội dung kanban Designer (DEV-14, kiểm 12/09/2026)

- Kanban Designer CÓ cột "Đã sửa" nhưng tự ẩn khi rỗng (cùng luật với "Cần làm lại", "Đang chờ quay lại") —
  `pages/designer/my-tasks/index.tsx` (`COL_ORDER`, lọc `visibleCols`). Ảnh bước 1/4/5 chụp lúc chưa có đơn đã sửa nên chỉ thấy
  thẻ số "Đã sửa" = 0.
- BE tách cột: "Đã xong" = `designerStatus=done` + `designerReworkCount` 0/thiếu; "Đã sửa" = done + `designerReworkCount > 0`
  (`designer-task.service.ts` `getMyTasks`). Thẻ số "Đã sửa" = `fixedInPeriod` = đơn hoàn thành (`designerCompletedAt`) trong kỳ
  đang chọn mà từng bị làm lại; thẻ "Đã xong" = hoàn thành trong kỳ − "Đã sửa" (`getMyStats`). → Làm lại xong bấm Hoàn thành thì đơn
  vào cột "Đã sửa". Khoá: `roles.designer.steps.01-my-tasks.body`, `roles.designer.steps.06-rework-card.{body,callouts.2}`.
- Kanban Fulfillment (Ép, QC sau ép, Đóng hàng) luôn hiện cột "Đã sửa" (chỉ ẩn "Làm lại" / "Đang chờ quay lại" khi rỗng —
  `pages/fulfillment/my-tasks/index.tsx`), nên các câu "làm xong vào Đã sửa" của vai Ép giữ nguyên.
- `designer-leader/02-select-orders`: nút ghi "(2)" vì đã tick 2 đơn; ảnh chỉ thấy 1 ô tick, ô còn lại nằm dưới khung ảnh — chữ
  bước 2 (`body`, `alt`, `callouts.1`) nói rõ điều này.

## 7. Permissions

| Vai | Vào trang | Ghi chú |
| --- | --- | --- |
| Support, DesignerLeader, Designer, Fulfillment | Có (preset) | |
| Manager | Có | nhận mọi mã trừ `ADMIN_ONLY_PAGE_CODES` |
| Admin, SuperAdmin | Có | mọi mã + nhánh `isAdmin` ở `usePermission` |
| Role khác / role tự tạo chưa tick | Không | `RequirePagePermission` hiện màn "Bạn không có quyền truy cập trang này"; sidebar ẩn entry |

Gác route: `RequirePagePermission` tra mã từ cây menu (`buildPagePermissionMap`) — entry sidebar `perm: 'page.guide_dtf'` là nguồn
duy nhất, không khai bảng thứ hai. Ảnh trong `public/` không được gác (§6.2).

## 8. Performance notes

- Trang lazy-load (`routerConfig.ts`); chỉ render các bước của 1 vai tại một thời điểm (tối đa 10 ảnh), ảnh `loading="lazy"` trừ bước đầu.
- 52 ảnh WebP ≤ 350 KB mỗi ảnh (giới hạn của `capture.mjs`); lưới mực nằm trong chunk JS của trang (`dtfShots.generated.ts` ~97 KB nguồn).
- `dtfShotI18n` sao chép kho resource 1 lần khi chunk trang được tải.
