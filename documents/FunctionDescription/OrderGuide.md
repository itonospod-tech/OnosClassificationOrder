# Hướng dẫn lên đơn công khai (Order Guide) — Function Description

> **File FE:** `apps/web/src/pages/guide/order/` (`index.tsx`, `GuideStepBlock.tsx`, `AnnotatedShot.tsx`, `CalloutList.tsx`, `ShotLightbox.tsx`, `scrollMarker.ts`, `guideSteps.ts`, `guideTypes.ts`, `badgeLayout.ts`, `guideShots.generated.ts` — TỰ SINH), ảnh `apps/web/public/guide/order/*.webp` + `manifest.json`, i18n `apps/web/src/i18n/locales/{vi,en}/orderGuide.json`
> **File BE:** không có — trang tĩnh 100%, KHÔNG gọi API nào
> **Script sinh ảnh:** `apps/seller/scripts/capture-order-guide.mjs`
> **Route:** `/guide/ordering` (`PATHS.ORDER_GUIDE`, khai thẳng trong `apps/web/src/App.tsx`, lazy + Suspense, ngoài `PrivateRoute`) — **cố ý KHÔNG phải `/guide/order`**, xem §6.1
> **API:** không có

---

## 1. Overview

Trang public hướng dẫn **khách hàng lên đơn trên Seller Portal (`apps/seller`) theo từng bước**, mỗi bước có
ảnh chụp màn hình THẬT, viền mảnh quanh đúng phần tử được chú thích + huy hiệu số đặt NGOÀI viền, và danh sách chú thích cùng số.

- Người đọc: khách chưa đăng nhập hoặc khách mới — cùng nhóm với [`Landing.md`](Landing.md), [`Catalog.md`](Catalog.md), [`PublicOrderTracking.md`](PublicOrderTracking.md).
- CTA chính "Đặt đơn ngay" → `CUSTOMER_REGISTER`, phụ "Đăng nhập" → `CUSTOMER_LOGIN` (giống `HowItWorks.tsx`).
- Lối vào: link chữ "Xem hướng dẫn chi tiết" ở section `HowItWorks` trang chủ + link "Hướng dẫn lên đơn" ở cột "Đặt đơn" của `PublicFooter`.
- Dịch đủ vi/en. Ảnh là giao diện **tiếng Việt** → bản en giữ nguyên chữ nút/nhãn tiếng Việt trong ngoặc kép kèm nghĩa, và có dòng ghi chú điều đó ở hero (`orderGuide.hero.uiNote`).
- Không gate auth, không đọc store nào ngoài `languageStore` (qua `PublicHeader`), không có `<title>` riêng (các trang public khác cũng không có cơ chế này).

---

## 2. Luồng hoạt động

### 2.1 Bố cục trang (`pages/guide/order/index.tsx`)

```
PublicHeader (sticky h-16 / lg:h-20)
├── Hero — tiêu đề + mô tả + CTA + ghi chú ảnh + 3 thẻ nhảy tới 3 luồng
├── Thanh chuyển luồng (sticky top-16 / lg:top-20, mục sáng tính theo vị trí cuộn — §4.3)
├── #flow-form    Luồng 1 — Tạo đơn trên form (7 bước)
├── #flow-push    Luồng 2 — Đẩy sản xuất và theo dõi (5 bước)
├── #flow-import  Luồng 3 — Import đơn từ file CSV (5 bước)
├── #faq          Hỏi đáp (5 câu, <details>)
└── CTA cuối (band ink-900) + email hỗ trợ (dùng lại `landing.footer.contact.email`)
PublicFooter + BackToTop
```

Mỗi bước có neo `#<flow>-<stepId>` (vd `#form-files`) để dán link thẳng tới 1 bước.

### 2.2 Ba luồng và các bước

| Luồng | Bước (`id` i18n) | Ảnh | Ô lưu ý |
| --- | --- | --- | --- |
| form | `login` Đăng nhập cổng seller | `form-01-login.webp` 448×512 | |
| form | `chooseLine` Chọn dòng sản phẩm | `form-02-choose-line.webp` 1440×900 | |
| form | `pickProduct` Chọn sản phẩm | `form-03-pick-product.webp` 1440×1120 | |
| form | `variant` Chọn màu, cỡ, số lượng | `form-04-variant.webp` 800×448 | |
| form | `files` Thêm mockup + file thiết kế | `form-05-files.webp` 800×460 | ✅ cần ≥ 1 file thiết kế |
| form | `address` Địa chỉ giao hàng + gửi đơn | `form-06-cart-address.webp` 380×740 | |
| form | `pending` Đơn nằm ở tab "Chờ đẩy SX" | `form-07-pending.webp` 1440×900 | ✅ chưa vào sản xuất |
| push | `select` Chọn đơn cần sản xuất | `push-01-select.webp` 1440×900 | |
| push | `confirm` Kiểm giá chốt + xác nhận | `push-02-dialog.webp` 736×462 | |
| push | `status` Đơn rời tab chờ | `push-03-status.webp` 1440×900 | |
| push | `detail` Chi tiết + tiến trình + sửa mockup/địa chỉ (5 chú thích) | `push-04-detail.webp` 1440×1080 | |
| push | `track` Người mua tự tra cứu (+ nút mở trang tra cứu, §4.6) | `push-05-track.webp` 1440×900 | |
| import | `open` Mở trang import + file mẫu | `import-01-open.webp` 882×291 | |
| import | `lookupSku` Tra SKU từng biến thể | `import-02-lookup-sku.webp` 780×788 | |
| import | `previewErrors` Sửa ô lỗi | `import-03-preview-errors.webp` 886×274 | |
| import | `previewValid` Kiểm lại rồi import | `import-04-preview-valid.webp` 886×256 | |
| import | `result` Kết quả + đẩy sản xuất | `import-05-result.webp` 882×140 | ✅ đơn import cũng vào "Chờ đẩy SX" |

Kích thước ảnh do script quyết định (§6.2): nguyên màn 1440×900; `form-03` cao 1120 để lưới thẻ sản phẩm không
phải cuộn (ở 900 hàng trên cùng bị cắt nửa); `push-04` cao 1080 để thấy khối Địa chỉ giao hàng mà mô tả nhắc tới;
4 ảnh import (trừ `lookupSku`) chụp ở viewport 1100 để dải ngang hẹp lại → chữ đọc được khi hiển thị.

---

## 3. API / Schema

Không có API. Dữ liệu tĩnh, 3 lớp:

| File | Ai viết | Nội dung |
| --- | --- | --- |
| `public/guide/order/manifest.json` | script | Để NGƯỜI soát: mỗi bước `flow/step/file/width/height/screen/shows` + `callouts[]` (bên dưới) kèm `label/detail` tiếng Việt lấy từ UI thật |
| `guideShots.generated.ts` | script (**KHÔNG sửa tay**) | Hình học cho trang: `GUIDE_SHOTS['<tên ảnh>'] = { file, width, height, callouts[], ink }` — `satisfies Record<string, GuideShot>` |
| `guideSteps.ts` | tay | Thứ tự luồng/bước, khoá i18n `id`, cờ `note` — `step('files', 'form-05-files', true)`; tên ảnh gõ sai → type-check báo lỗi |

```ts
// guideTypes.ts
interface GuideBox { x: number; y: number; w: number; h: number }          // % ảnh
interface GuideCallout { n: number; xPct: number; yPct: number; boxPct: GuideBox }
interface GuideInkGrid { cell: number; cols: number; rows: number; data: string }
interface GuideShot { file: string; width: number; height: number; callouts: GuideCallout[]; ink: GuideInkGrid }
interface GuideStep extends GuideShot { id: string; note?: boolean }
```

Format callout trong manifest (và trong file sinh ra): `{ n, xPct, yPct, boxPct: { x, y, w, h }, label, detail }`.
- `boxPct` = khung bao phần tử theo % vùng clip, lấy từ `boundingBox()` thật, **cộng lề 5px ảnh** (`BOX_PAD`)
  và cắt trong vùng clip. Chú thích có `also: [locator]` trong script thì khung gộp cả phần tử đó (vd nhãn
  "EMAIL" + ô nhập) để huy hiệu không đè lên nhãn.
- `xPct/yPct` = tâm phần tử — giữ cho tương thích, trang KHÔNG dùng để vẽ nữa.
- `ink` (chỉ ở file TS, không ở manifest): lưới 12px ảnh, 1 bit/ô bật khi ô có chữ đang hiện / ảnh / icon / ô nhập
  lúc chụp; base64 bit-packed LSB trước. Dùng duy nhất để đặt huy hiệu vào chỗ trống (§4.3). ~24KB cho 17 ảnh.
- **Đã bỏ `dx/dy` px** (dời chấm thủ công) — không co giãn theo ảnh nên chấm trôi ở `push-03` (TEST-01).
- **Chữ KHÔNG lấy từ manifest** (manifest chỉ tiếng Việt và chứa mã đơn/giá mẫu). Chữ ở i18n `orderGuide`:
  `flows.<flow>.steps.<id>.{title, body, alt, note?, callouts.<n>.{label, detail}}`.

**Vì sao script sinh TS thay vì trang import/fetch manifest:** file trong `public/` không import được vào bundle
(Vite chặn), còn fetch lúc chạy thì phải chờ mạng mới biết kích thước ảnh → nhảy bố cục và thêm một đường lỗi
cho trang tĩnh. Trước đây chép tay số từ manifest sang `guideSteps.ts` → dễ lệch; nay script ghi thẳng
`guideShots.generated.ts` cùng lúc với ảnh nên ảnh và toạ độ luôn cùng một lần chụp.

---

## 4. UI Components

### 4.1 File

| File | Vai trò |
| --- | --- |
| `index.tsx` | Trang: hero, thanh chuyển luồng dính (tính theo vị trí cuộn + khoá khi bấm + tự cuộn ngang tới mục sáng, §4.3), 3 section luồng, FAQ, CTA cuối. `FAQ_KEYS` là danh sách câu hỏi. `TRACK_LINK` quyết định nút tra cứu (§4.6). |
| `GuideStepBlock.tsx` | 1 bước: số bước + tiêu đề + mô tả + ô lưu ý + ảnh + danh sách chú thích + hộp phóng to. Hook nội bộ `useCalloutHighlight` (1 bản cho trong bài, 1 bản cho hộp phóng to) giữ chú thích đang sáng dùng chung cho huy hiệu/viền ↔ chú thích (§4.3); `zoomFrom` = huy hiệu đã mở hộp; `returnFocusRef` cho hộp phóng to. |
| `AnnotatedShot.tsx` | Khung ảnh kiểu cửa sổ trình duyệt nhẹ, `<img width height>` thật, VIỀN (`boxPct`) + HUY HIỆU (`layoutBadges`, `left/top: calc(% + px)`, `data-slot`) + đường dẫn SVG (`data-callout-leader`), nút "Phóng to". Đo bề rộng ảnh đang vẽ bằng `ResizeObserver` — CHỈ để tính cỡ huy hiệu. Biến thể `inline` / `zoom`. |
| `badgeLayout.ts` | `isWideShot`, `shotMinWidth`, `badgeDiameter(scale)`, `badgeOffsetPx`, `layoutBadges(step)` (không nhận bề rộng, cache theo ảnh) — hàm thuần, không React. |
| `CalloutList.tsx` | `<ol>` chú thích; mỗi mục là `<button>` (rê chuột/focus → sáng viền + huy hiệu; click → cuộn huy hiệu vào tầm nhìn). Bố cục `stack` (cạnh ảnh hẹp) hoặc `grid` (dưới ảnh rộng). Export type `HighlightSource` (`hover`/`focus`/`pin`) — tham số thứ 2 của mọi `onActiveChange`. |
| `ShotLightbox.tsx` | Hộp phóng to Radix Dialog dùng thẳng `@radix-ui/react-dialog` (bản `components/ui/dialog` có nút "Close" chữ cứng + khung `max-w-lg`). Esc đóng, khoá focus, `onCloseAutoFocus` trả focus về phần tử đã mở; `onOpenAutoFocus` cuộn tới huy hiệu đã mở hộp (`revealOnOpen`, §4.3). Viền/huy hiệu và chú thích đồng bộ y như ngoài bài. |
| `scrollMarker.ts` | `scrollMarkerIntoView(container, n)` — tách file để component file chỉ export component (fast refresh). |
| `guideSteps.ts` / `guideTypes.ts` / `guideShots.generated.ts` | Dữ liệu §3. |

### 4.2 Bố cục theo hình dạng ảnh

| Loại ảnh | Điều kiện | Desktop (`lg`) | Dưới `lg` |
| --- | --- | --- | --- |
| Rộng (nguyên màn) hoặc dải ngang dẹt | `width >= 1000` **hoặc** `width / height >= 1.9` | Chữ ở trên, ảnh chiếm cả bề ngang nội dung, chú thích lưới 2–4 cột bên dưới | chữ → ảnh → chú thích |
| Hẹp (hộp thoại, form dọc) | còn lại | 2 cột: chữ + chú thích trái, ảnh phải rộng `min(width, 36rem)` | chữ → ảnh → chú thích |

Ảnh **không bao giờ phóng quá kích thước gốc** (khung `max-width: min(<width+2>px, 100%)`).

### 4.3 Viền, huy hiệu, tương tác & accessibility

**Viền + huy hiệu (thay chấm tròn đè giữa phần tử — TEST-01 bug 2/3):**
- Viền: `<span>` tuyệt đối `left/top/width/height` = `boxPct` (%), `border-2` bo góc, KHÔNG tô nền → chữ trong
  phần tử vẫn đọc được. Mặc định `brand-600/60`; đang sáng → đậm + quầng `box-shadow`.
- Huy hiệu số: `<button>` tròn, **dính vào viền của chính nó**. Bản cũ (né mực, không ràng buộc gần, tính theo bề
  rộng đang vẽ) làm huy hiệu trôi xa viền 1–2 hàng, che chữ, và lệch giữa trong bài với hộp phóng to (TEST-02 B2a–B2d).
- **Cỡ:** `badgeDiameter(scale)` = 20px khi ảnh vẽ ≤ ½ cỡ gốc, tăng tuyến tính tới 26px ở cỡ gốc (`scale` = bề rộng
  lớp ảnh đo bằng `ResizeObserver` / bề rộng gốc). Vùng bấm nới thêm 4px mỗi phía bằng `before:-inset-1` → ≥ 28px.
- **Vị trí KHÔNG phụ thuộc bề rộng:** `layoutBadges(step)` chạy 1 lần/ảnh (cache theo `file`) và trả mỗi chú thích
  một `BadgePlacement { slot, ax, ay, kx, ky, gx, gy, leader? }`. Trang vẽ tâm huy hiệu bằng
  `left: calc(ax% + (kx·d/2 + gx·2)px)` (tương tự `top`) — `ax/ay` là toạ độ trên viền (% ảnh), phần px co giãn theo
  cỡ huy hiệu thật → **cùng góc/cạnh ở mọi bề rộng, trong bài lẫn hộp phóng to**. `data-slot` ghi tên slot để kiểm.
- **Vì sao tính 1 lần là đủ:** hình học tính ở cỡ vẽ NHỎ NHẤT của ảnh (`shotMinWidth`). Cỡ huy hiệu quy ra px ảnh
  `(d/2 + 2)/scale = 6 + 9/scale` chỉ GIẢM khi ảnh vẽ to hơn, và huy hiệu neo vào viền → hình vuông của nó ở cỡ lớn
  nằm trọn trong hình vuông ở cỡ nhỏ nhất. Hợp lệ (không chạm viền/huy hiệu khác, trong ảnh) ở cỡ nhỏ nhất thì hợp lệ ở mọi cỡ.
- **Thuật toán (theo thứ tự ưu tiên của BA):**
  1. **Dính viền** — ứng viên ngoài viền, chạm cạnh với khe 2px (bằng vòng trắng `ring-2`): trên/dưới/trái/phải ×
     đầu/cuối/giữa/¼/¾ (`top-start`, `right-center`…). Viền sát mép ảnh có thêm `edge0/edge1` (huy hiệu sát mép ảnh,
     chỉ nhận khi ở cỡ gốc vẫn phủ qua viền ≥ 3px). Không bao giờ đặt xa hơn khe này (trừ đường dẫn, bước 3).
  2. **Luật cứng** — nằm trong ảnh; không chạm viền chú thích khác; không chạm huy hiệu/đường dẫn đã đặt. Ứng viên
     **đè lên chính đường viền** (`corner-tl…br`, `on-top-start…`, tâm nằm trên viền) chỉ hợp lệ khi phần lọt vào
     trong viền KHÔNG có mực → không bao giờ che chữ/biểu tượng của chính phần tử.
  3. **Ít che nhất** — điểm = % mực dưới hình vuông 0,8·d (mực TRONG viền của chính nó không tính) × 100 + ưu tiên nhỏ
     (trên → dưới → trái/phải → đè viền +8). % mực đo ở **cả cỡ nhỏ nhất và cỡ gốc**, lấy mức tệ hơn: ở cỡ gốc huy
     hiệu sát viền hơn nên có thể đè nhãn ngay trên viền mà ở cỡ nhỏ nhất thì không (`push-05` #2 từng đè chữ "MÃ" của
     "MÃ SẢN XUẤT" khi phóng to). Kiểm "không có mực trong viền" của slot đè viền dùng viền **co 6px**, vì ô mực 12px
     của phần tử BÊN CẠNH tràn vài px vào trong viền. Chỗ dính viền tốt nhất vẫn che > 12% → tìm **đường dẫn ngắn** (`leader`):
     chỗ trống (≤ 2% mực) trong bán kính 3 đường kính, đoạn thẳng từ điểm gần nhất trên viền không cắt viền/huy hiệu
     khác; dùng nếu điểm thấp hơn. Vẽ bằng `<svg viewBox="0 0 100 100" preserveAspectRatio="none">` + `vector-effect="non-scaling-stroke"`.
  4. Chú thích có ít ứng viên hợp lệ nhất được đặt trước. Dự phòng cuối (chưa gặp ở 17 ảnh): dính viền, chấp nhận chạm ít nhất.
- **Lưới mực** (`ink`) 12px nên thô: ô chữ bị làm tròn lên ô, % che đo được thường cao hơn phần chữ bị che thật.

**Tương tác:**
- Hover/focus huy hiệu ↔ mục chú thích sáng tương ứng (cả viền), cả hai chiều, ở MỌI khổ và cả trong hộp phóng to; dùng được hoàn toàn bằng bàn phím (Tab qua huy hiệu và mục chú thích — huy hiệu nhận đúng class sáng `scale-110 ring-4 ring-brand-300`, viền nhận quầng).
- **Chuột và focus giữ state RIÊNG** (`useCalloutHighlight` trong `GuideStepBlock.tsx`, TEST-04 BUG-1): state `{ hover, focus, pin, last }`,
  chú thích sáng = giá trị của nguồn vừa đổi gần nhất, nguồn đó rỗng thì lùi về hover → focus → pin. Bản cũ dùng chung 1
  state nên một `mouseleave` bất kỳ xoá luôn chú thích đang focus bằng Tab.
  - Chuột sáng bằng **`mousemove`**, tắt bằng `mouseleave`. KHÔNG dùng `mouseenter`: nội dung cuộn dưới con trỏ đứng yên
    (Tab làm hộp phóng to cuộn, hộp tự cuộn tới huy hiệu) chỉ bắn `mouseover/mouseenter`, không bắn `mousemove` (đã đo trên
    Chrome) → trước đây nó cướp chỗ của mục đang focus.
  - `pin` = bấm mục chú thích / mở hộp phóng to từ huy hiệu n (hộp mở ra sáng n). Rê chuột hoặc focus VÀO một chú thích
    thì bỏ ghim; `mouseleave`/`blur` không bỏ ghim. Mỗi lần mở hộp, state của hộp được làm mới (đóng hộp không bắn `mouseleave`).
  - `mousemove` không đổi gì thì trả lại đúng object state cũ → không render lại.
- Huy hiệu là `<button>` có `aria-label` "Chú thích n: <nhãn>"; click → mở ảnh phóng to đang sáng đúng chú thích đó và
  **cuộn tới huy hiệu đó** (TEST-04 BUG-3): `ShotLightbox` `onOpenAutoFocus` → 1 frame sau đặt TỨC THÌ `scrollLeft` của
  `[data-shot-scroller]` và `scrollTop` của `[data-zoom-body]` để huy hiệu nằm giữa khung — chỉ khi nó đang lọt ra ngoài
  (lề 12px). Tự đặt scroll thay vì `scrollIntoView` để không đụng trang phía sau. Mở bằng ảnh hoặc nút "Phóng to" → đầu ảnh như cũ.
- Bấm ảnh → phóng to (ảnh bọc `<button tabIndex=-1>` để khỏi thừa điểm Tab; đường bàn phím là nút "Phóng to" trên thanh cửa sổ).
- **Trả focus khi đóng hộp phóng to** (Esc / ×): hộp mở bằng state, không qua `Dialog.Trigger`, nên Radix trả focus
  về BODY → `ShotLightbox` `onCloseAutoFocus` trả về: huy hiệu (nếu mở từ huy hiệu), nút "Phóng to" (nếu mở từ nút
  đó HOẶC từ click ảnh — ảnh là `aria-hidden` nên không nhận focus).
- **Thanh chuyển luồng dính:** mục sáng = section cuối cùng có mép trên đã qua 40% chiều cao màn (tính theo vị trí
  cuộn, rAF). Bấm mục (hoặc thẻ luồng ở hero) → sáng NGAY mục đó và khoá tính theo cuộn cho tới khi hết sự kiện
  cuộn 200ms (tối đa 800ms nếu không cuộn) rồi tính lại. Bản IntersectionObserver cũ không bắn khi nhảy neo → mục
  sáng kẹt ở mục cũ (TEST-01 bug 5).
- **Thanh luồng tự cuộn ngang tới mục sáng** (TEST-04 BUG-2, 360/390 không đủ chỗ cho 4 mục): mỗi khi `activeNav` đổi (do
  cuộn hoặc do bấm), effect ở `index.tsx` đặt `scrollLeft` của khung thanh (`navScrollerRef`, mục có `data-nav-id`) để mục
  sáng lọt hết vào khung, cách mép 16px (= `px-4`); `smooth`, `auto` khi `prefers-reduced-motion`. Chỉ cuộn khung thanh —
  KHÔNG `scrollIntoView` (phần tử trong thanh `sticky` có thể kéo trang cuộn dọc). Thanh không tràn thì không làm gì.
- Ảnh phóng to: rộng `max(min(W, 100%), clamp(0px, (W − 100vw) × 9999, min(W, 960px)))` (W = bề rộng gốc):
  - ảnh gốc **rộng hơn màn hình** → tối thiểu `min(W, 960)`, cuộn/vuốt ngang trong khung như cũ;
  - ảnh gốc **hẹp hơn hoặc bằng màn hình** → thu vừa khung, không cuộn ngang, huy hiệu nằm trọn (TEST-04 BUG-5: `form-06`
    380px ở 390 từng nằm trong khung 340px, huy hiệu 1 bị cắt). Ở 390: ảnh 348px, mọi huy hiệu trong khung.
  - Hệ quả theo đúng quy tắc: ở **360** `form-06` (380 > 360) vẫn giữ 380px và cuộn (huy hiệu 1 ở x 343–369 trong khung 318);
    ở **768** `push-02` (736 ≤ 768) nay thu vừa khung 670px thay vì cuộn.
  - Thuần CSS (`clamp` với hệ số lớn làm công tắc theo `100vw`) → tự đổi khi xoay/kéo cửa sổ, không cần JS đo màn.
  - Desktop không đổi: 1280/1440 ảnh rộng vẫn gần full khung.
- `alt` mô tả từng ảnh qua i18n; ảnh đầu tiên `loading="eager"`, còn lại `lazy` + `decoding="async"`.
- FAQ dùng `<details>/<summary>` gốc (bàn phím sẵn). Mọi chuyển động có nhánh `motion-reduce:`.

### 4.4 Responsive (390px)

- **Body không bao giờ cuộn ngang (360–430px, mọi bước).** Bố cục dưới `lg` là lưới `grid-cols-1`
  (= `minmax(0,1fr)`) + `min-w-0` ở mọi con, `figure`/khung ảnh `min-w-0 max-w-full`. Bề rộng tối thiểu của ảnh
  CHỈ đặt ở lớp trong, cuộn trong khung `overflow-x-auto`. (Lỗi cũ TEST-01 bug 1: lưới 1 cột mặc định `auto` bị
  `min-width` của ảnh cỡ vừa kéo giãn thành 642px → tiêu đề/mô tả tràn tới x=658.)
- Bề rộng tối thiểu của ảnh (`shotMinWidth`): ảnh rộng/dẹt `min(width, 600)`; ảnh hẹp > 560px → 560 (vừa cột ảnh
  desktop); ảnh hẹp ≤ 560px → co tới 326. Nhỏ hơn cột → vuốt ngang TRONG khung, có dòng gợi ý "Vuốt ngang…" dưới `sm`.
- Huy hiệu 20px trên điện thoại (ảnh vẽ ≤ ½ cỡ gốc), vùng bấm 28px (`before:-inset-1`). Thanh chuyển luồng cuộn ngang được, không xuống dòng, và tự cuộn tới mục sáng (§4.3).
- **Thanh chuyển luồng chỉ dính trong khối bao `nav + 3 luồng + FAQ`** (một `<div>` trong `<main>`). Để thẳng trong
  `<main>` thì ở cuối trang nó bị đẩy xuống đáy `<main>` → dải trắng ~58px nằm giữa CTA tối và footer (TEST-02, 390px;
  tái hiện khi mép footer cách đỉnh màn ~100px). Thêm section mới sau FAQ thì đặt NGOÀI khối này.
- **Nút "lên đầu trang" (`BackToTop`, `fixed right-6` 44px) không che huy hiệu:** danh sách bước có `pr-16` từ 720px
  tới dưới 1280px (khi cột nội dung chưa cách mép màn đủ 68px). Ở 757px: nút x 689–733, khung ảnh phải nhất 676.
  Dưới 720px không chừa lề (mất quá nhiều bề ngang) — nút có thể đè tạm một huy hiệu sát mép phải khi cuộn qua.

### 4.6 Nút "Mở trang tra cứu đơn" (bước `push.track`)

Link tra cứu seller chép ở trang chi tiết đơn là `window.location.origin + /track/<mã>` — tức **trang `/track` của
chính Seller Portal** (`apps/seller/src/components/orders/order-detail-view.tsx`), và ảnh `push-05-track` chụp
đúng trang đó. Để ẢNH và NÚT là một trang:
- có `VITE_SELLER_URL` → nút là `<a href="${VITE_SELLER_URL}/track">` (cùng biến `App.tsx` dùng để chuyển `/customer/*` sang seller);
- không có (dev chưa cấu hình) → fallback `PATHS.TRACK` của apps/web (giao diện khác, cùng dữ liệu `PublicOrderTracking.md`).

### 4.5 Nội dung FAQ — chỉ điều đã kiểm trong code

| Câu | Căn cứ |
| --- | --- |
| Gửi đơn rồi sao chưa sản xuất | Đơn form/import vào staging `Pending`, phải push (`CustomerOrderIntake.md`) |
| Nút "Thêm vào đơn hàng" chưa bấm được | DEV-01 quan sát: vị trí in ghi "không bắt buộc" nhưng nút đòi ≥ 1 file design |
| Hủy / sửa đơn | Nút "Hủy" trên dòng Pending (`apps/seller/src/components/orders/order-row.tsx`); sau push chỉ sửa mockup/design/địa chỉ ở trang chi tiết (`customerMessage('orderPushedEditLimited')`, `order-detail-view.tsx` PATCH) |
| Người mua theo dõi | `/track/<mã>` public, không giá (`PublicOrderTracking.md`) |
| Import trùng | Trùng `(order_id, identifier)` → `duplicated`; > 500 dòng → `importTooManyLines` (`customer-order.service.ts` `importOrdersCsv`) |

---

## 5. Backend logic

Không có.

---

## 6. Ảnh chụp: cách sinh và cách cập nhật

### 6.1 Route KHÔNG được trùng thư mục ảnh

Ảnh nằm ở `apps/web/public/guide/order/`. Nếu route cũng là `/guide/order` thì:
- Vite dev (4.4.9) coi request là file public → trả **500** "This file is in /public…" (đã tái hiện 11/09/2026);
- nginx prod `try_files $uri $uri/ /index.html` (`documents/Plans/Deployment-Ubuntu-VPS.md`) khớp **thư mục** trước `index.html`.

→ Route là `/guide/ordering`. Đừng đổi route về trùng tên thư mục ảnh; muốn URL `/guide/order` thì phải chuyển
thư mục ảnh (và `OUT` mặc định trong script) sang tên khác trước.

### 6.2 Script chụp

`apps/seller/scripts/capture-order-guide.mjs` đi đúng 3 luồng như khách thật bằng Playwright, chụp đè theo tên
file cố định, rồi ghi **cùng lúc** `manifest.json` (có `boxPct`, §3) và `apps/web/src/pages/guide/order/guideShots.generated.ts`
(hình học + lưới mực). Script tự:
- đổi CHỮ hiển thị trước mỗi ảnh: ô URL asset nội bộ → link Drive mẫu; mọi text/ô nhập chứa email hoặc phần tên
  của tài khoản demo → `demo@example.com` / `demo` (`maskAccount`) — ảnh đăng nhập hiện `demo@example.com`, rồi điền
  lại email thật trước khi bấm Đăng nhập;
- đổi viewport theo bước (§2.2: `PICK_VIEWPORT` 1440×1120, `IMPORT_VIEWPORT` 1100×900, `DETAIL_VIEWPORT` 1440×1080);
- thử lại khi đăng nhập / push-preview trượt vì nodemon API khởi động lại.

**Đang chạy script thì KHÔNG sửa file `.ts` nào trong workspace** — nodemon API theo dõi cả workspace, tự build lại
và làm đăng nhập/push của script lỗi giữa chừng.

```bash
# Cần: API :3007 + Seller Portal :3017 đang chạy, DB LOCAL (script TẠO đơn và PUSH thật — KHÔNG BAO GIỜ chạy vào production)
PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core/index.mjs \
  node apps/seller/scripts/capture-order-guide.mjs
```

| Env | Mặc định | Ghi chú |
| --- | --- | --- |
| `PLAYWRIGHT_PATH` | `playwright-core` | Playwright có sẵn ngoài workspace |
| `GUIDE_BASE` | `http://127.0.0.1:3017` | Seller Portal |
| `GUIDE_SELLER_EMAIL` / `GUIDE_SELLER_PASSWORD` | `seller-smoke@onos.test` / (xem script) | tài khoản demo |
| `GUIDE_LINE` | `2d` | dòng có sản phẩm ở DB local |
| `GUIDE_PRODUCT` | `Heavy Cotton™ T-Shirt - 5000` | chuỗi con tên sản phẩm |
| `GUIDE_OUT` | `apps/web/public/guide/order` | |
| `GUIDE_TS_OUT` | `apps/web/src/pages/guide/order/guideShots.generated.ts` | file hình học trang import |
| `GUIDE_ASSET_PORT` / `GUIDE_CHANNEL` / `GUIDE_QUALITY` | `3099` / `chrome` / `0.82` | |

Dữ liệu trong ảnh là dữ liệu giả do script tạo (John Smith, 123 Demo Street, link Drive `demo-…`, design/mockup SVG "SAMPLE").

### 6.3 Quy trình khi UI Seller Portal đổi

1. Chạy script (§6.2); mở lại MỌI ảnh soát (không trắng, không kẹt spinner, không toast lỗi, không lộ email/tên tài khoản test). Selector trong script bám chữ tiếng Việt — đổi i18n seller thì sửa selector trước.
2. KHÔNG chép số tay: `guideShots.generated.ts` đã được ghi lại. Đổi tên/thêm/bớt ảnh → sửa `step(...)` trong `guideSteps.ts` (type-check chỉ ra chỗ lệch).
3. Thêm/bớt chú thích hoặc bước → thêm/bớt khoá tương ứng ở **CẢ** `vi` và `en` `orderGuide.json`.
4. Mở từng ảnh mới, đối chiếu `title/body/label/detail` với chữ trên ảnh (nhãn nút, tên tab). Bản en: tên nút tiếng Việt trong ngoặc kép + nghĩa.
5. Kiểm lại các khẳng định hành vi ở §4.5 và §7 (nếu seller đổi luật, FAQ phải đổi theo).
6. Kiểm kỹ thuật §6.4, rồi `pnpm build-types` + ESLint trong `apps/web`.

### 6.4 Kiểm tra kỹ thuật bố cục (Playwright, không nằm trong repo)

Mở `/guide/ordering` ở 360×780, 390×844, 430×932, 757×900, 1440×900 và đo:
- `documentElement.scrollWidth <= clientWidth`; tiêu đề/mô tả mỗi bước không vượt `clientWidth`;
- mỗi `[data-callout]` (huy hiệu) nằm trong `[data-shot-image]`, không giao huy hiệu khác, không giao `[data-callout-box]` của chú thích khác;
- 757 / 1440: mép trái `BackToTop` ≥ mép phải khung ảnh (`[data-shot-scroller]`);
- 390: bấm mục thanh luồng → `aria-current="location"` ngay và sau 1,2s; mở hộp phóng to bằng nút / huy hiệu / click ảnh → đóng bằng Esc / × → `document.activeElement` là đúng nút/huy hiệu;
- footer: ở trang này href neo là `/#how…`, ở trang chủ là `#how…`.

**Kiểm bàn phím / màn hẹp (sau TEST-04, 11/09/2026)** — 360×780 và 390×844:
- (a) Tab qua từng mục chú thích của `push-confirm`, `form-files`, `import-result`, `push-detail` (trong bài) và `push-confirm`
  (hộp phóng to) → đúng 1 huy hiệu sáng (`scale-110 ring-brand-300`) + viền có quầng; chuột rê mục 1 → Tab sang 2 → rời
  chuột → 2 vẫn sáng; rê mục 3 → sáng 3, rời → về 2;
- (b) cuộn tới `flow-import`/`faq`/`flow-push`/`flow-form` → mục `aria-current` nằm trọn trong khung thanh, `scrollY` đứng yên;
  bấm "Import" → sáng ngay + lọt khung;
- (c) cuộn ảnh rộng trong bài hết sang phải, bấm huy hiệu phía phải (`form-chooseLine` #3, `push-confirm` #4, `import-result` #2,
  `push-detail` #5, `form-pickProduct` #3) → trong hộp huy hiệu đó nằm trong khung ngang + dọc và đang sáng; Esc trả focus
  về huy hiệu; mở bằng nút "Phóng to" → `scrollLeft`/`scrollTop` 0;
- (d) 390: hộp `form-address` `scrollWidth <= clientWidth`, mọi huy hiệu trong khung;
- (e) không tràn ngang.

**Kiểm huy hiệu (sau TEST-02 B2, 11/09/2026)** — 17 ảnh × 360/390/757/1280/1440 × {trong bài, hộp phóng to}, đo DOM
thật + lưới mực của ảnh:
- (a) khoảng cách huy hiệu ↔ viền của chính nó ≤ 4px, hoặc có `[data-callout-leader]`;
- (b) không giao `[data-callout-box]` của chú thích khác; (c) không giao huy hiệu khác; nằm trong `[data-shot-image]`;
- (d) % mực dưới HÌNH TRÒN huy hiệu (bỏ phần trong viền chính nó) — FAIL nếu > 25%, in danh sách mọi huy hiệu có che;
- (e) `data-slot` + phía so với viền (trên trục vuông góc cạnh bám, dung sai 1,5px) giống nhau giữa trong bài và phóng to.

Kết quả: 60 huy hiệu × 10 cấu hình — (a)(b)(c)(e) 0 lỗi, không tràn ngang; (d) còn **1 ngoại lệ đã soát bằng mắt**.
Slot đặc biệt: đường dẫn `push-03` #2, `import-05` #2; đè viền `form-05` #3 (`corner-tr`), `form-06` #1 (`corner-tr`),
`form-06` #4 (`on-left-start`), `import-02` #3 (`on-bottom-start`); sát mép ảnh `import-05` #1 (`bottom-edge0`).
Huy hiệu còn che mực đáng kể (lưới 12px, % thô hơn thực tế):

| Ảnh / huy hiệu | Slot | Che (đo) | Soát bằng mắt |
| --- | --- | --- | --- |
| `form-06` #1 "Địa chỉ" | `corner-tr` | 47% — **FAIL (d)** | Đè góc trên-phải viền, phần ngoài viền nằm trên đuôi TRỐNG của ô "Smith". Lưới mực đánh dấu CẢ hình chữ nhật ô nhập là mực nên % bị thổi phồng; không che chữ nào. Hai lựa chọn khác đều tệ hơn: dính cạnh trên/dưới che ô nhập/nhãn bên cạnh, đường dẫn thì cắt ngang ô "John" |
| `import-05` #1 "2 tạo mới" | `bottom-edge0` | 23% ở 360/390, 4–16% từ 757 | Chip ở góc trên-trái ảnh 882×140, không có chỗ trống trong 3 đường kính; ở điện thoại huy hiệu chạm mép chữ "D" đầu dòng "DEMO-…-A". **Ngoại lệ đã biết, BA chấp nhận (TEST-04 BUG-4, Cosmetic): huy hiệu che chữ "D" của mã đơn ở Import bước 5, khổ 360/390 — KHÔNG sửa** |
| `import-02` #3 | `on-bottom-start` | 13–24% | Viền dòng SKU đầu chồng viền tiêu đề cột; huy hiệu đè viền dưới, chạm chữ "U" của dòng SKU kế tiếp |
| `form-07` #2 | `top-end` | 3–11% | |

Bảng các huy hiệu dùng đường dẫn/đè viền đổi khi chụp lại ảnh — chạy lại script kiểm, đừng chép tay.

---

## 7. Permissions & giới hạn nội dung

**Public tuyệt đối** — route ngoài `PrivateRoute`, không permission code.

Theo [`Landing.md`](Landing.md) §8, chữ trên trang **không** chứa dữ liệu vận hành thật:

| Không đưa vào chữ | Dùng thay |
| --- | --- |
| Mã đơn/mã sản xuất cụ thể (kể cả mã mẫu trong ảnh) | "Mã sản xuất", `/track/<mã sản xuất>` |
| Số tiền, giá, chính sách giá/thời gian sản xuất | "đơn giá và thành tiền", "tổng cộng", "giá chốt tại thời điểm push" (chữ có sẵn trên UI) |
| Tên nhân viên, tên khách thật | không xuất hiện |
| Danh sách tên các chặng sản xuất | "chặng sản xuất đang làm" |
| Một tên trạng thái cụ thể sau khi push | "trạng thái đơn được cập nhật" — nhãn đang lệch giữa danh sách/`/track` và trang chi tiết |

Sự thật hành vi bắt buộc giữ đúng: dòng 2D cần ≥ 1 file design dù vị trí in ghi "không bắt buộc"; đơn từ form/import
vào "Chờ đẩy SX" và chỉ vào sản xuất sau khi tick + push.

---

## 8. Performance notes

| Hạng mục | Chi tiết |
| --- | --- |
| Route loading | `lazy` + `Suspense` như `/catalog`, `/track` — không làm nặng bundle trang chủ |
| Dependency mới | **0** (`@radix-ui/react-dialog`, `lucide-react`, `react-i18next` đã có) |
| Ảnh | 17 file `.webp` (script giới hạn ≤ 350KB/ảnh), `width/height` thật → không nhảy bố cục; chỉ ảnh đầu `eager` |
| JS | 1 listener `scroll` passive + rAF cho thanh luồng (gỡ khi unmount); 1 `ResizeObserver`/ảnh, `layoutBadges` chỉ chạy lại khi bề rộng đổi qua bội 16px (useMemo); hộp phóng to chỉ mount nội dung khi mở |
| Dữ liệu | `guideShots.generated.ts` ~24KB (lưới mực base64) nằm trong chunk lazy của route, không vào bundle trang chủ |
