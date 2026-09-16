# Landing Page (trang chủ public) — Function Description

> **File FE:** `apps/web/src/pages/landing/` (`index.tsx` + `sections/` + `mockups/` + `components/AppFrame.tsx`), primitive dùng chung ở `apps/web/src/components/public/`, i18n `apps/web/src/i18n/locales/{vi,en}/landing.json`, `apps/web/tailwind.config.js` (token `brand.*`/`ink.*`/`fontFamily.display`/keyframe `marquee`), `apps/web/index.html` (nạp font `Lexend Deca`)
> **File BE:** không có — trang tĩnh 100%, KHÔNG gọi API nào
> **Route:** `/` (`PATHS.LANDING`, khai báo trực tiếp trong `apps/web/src/App.tsx`, KHÔNG qua `PrivateRoute`/`routerConfig`)
> **API:** không có

---

## 1. Overview

Trang chủ public tại `/`. **UX hướng tới khách hàng đặt đơn**, không phải hướng
tới người vận hành sản xuất:

- Hành động chính xuyên suốt trang là **"Đặt đơn ngay"** (`CUSTOMER_REGISTER`) —
  xuất hiện ở header, hero, section "Cách đặt đơn" và CTA đóng trang.
- Hành động phụ là **đăng nhập khách hàng** (`CUSTOMER_LOGIN`).
- **Lối vào cho nhân viên cố ý bị hạ xuống** một dòng chữ nhỏ ở CTA cuối +
  1 link trong footer + 1 link trong menu mobile. Không có nút nhân viên nào
  cạnh tranh với CTA chính.

Nội dung nói về việc **đặt và theo dõi đơn**; phần sản xuất chỉ còn 1 row
"hậu trường" để trấn an, không mô tả hệ thống nội bộ (xem §8).

**Không gate auth, không gọi API, không đọc store nào ngoài `languageStore`.**

### 1.1 Nhận diện thị giác (kế thừa từ onosglobal.com)

Token đo trực tiếp từ trang thương hiệu Onos rồi đưa vào `tailwind.config.js`:

| Thành phần           | Giá trị                                                      | Token Tailwind                  |
| -------------------- | ------------------------------------------------------------ | ------------------------------- |
| Màu nhấn thương hiệu | `#6f26c2` (tím)                                              | `brand.600` (scale 50→950)      |
| Nền band tối         | `#2b2739`                                                    | `ink.800` / `ink.900`           |
| Màu tiêu đề          | `#0f110f`                                                    | dùng trực tiếp `text-[#0f110f]` |
| Font tiêu đề         | `Lexend Deca` weight 500                                     | `font-display`                  |
| Font nội dung        | `Inter` (giữ nguyên của app)                                 | `font-sans`                     |
| CTA                  | pill bo tròn hoàn toàn, 12px/700, tracking `.1em`, UPPERCASE | `components/public/PillLink.tsx` |
| Chi tiết đặc trưng   | nét gạch chân vẽ tay dưới cụm từ nhấn của tiêu đề            | `components/public/Swoosh.tsx`  |

> **Vì sao body dùng Inter thay vì DM Sans như site gốc:** DM Sans không có
> subset Vietnamese trên Google Fonts → dấu tiếng Việt (`ệ`, `ộ`, `ạ`…) bị
> fallback lệch font. `Lexend Deca` có subset Vietnamese nên vẫn dùng cho tiêu đề.

`Lexend Deca` gộp vào **đúng 1 request** Google Fonts có sẵn trong `index.html`
(cùng Inter). File `.woff2` chỉ tải khi có text thật sự dùng `font-display` →
các trang `/adm`, `/ffm`, `/customer` không phát sinh chi phí.

---

## 2. Luồng hoạt động

Không có luồng dữ liệu. Thứ tự section trong `pages/landing/index.tsx`:

```
PublicHeader (sticky, dùng chung với /catalog)
├── Hero            — lời hứa + CTA "Đặt đơn ngay" + ảnh minh hoạ trang tiến trình đơn
├── Capabilities    — 4 lý do đặt đơn ở Onos, KHÔNG con số (band tối)
├── ProblemSolution — 4 nỗi đau của KHÁCH khi đặt gia công     (#why)
├── HowItWorks      — 4 bước đặt đơn + CTA lặp lại + link "Xem hướng dẫn chi tiết" (#how)
├── Showcase        — 3 row: catalog → theo dõi → hậu trường   (#workflow)
├── Benefits        — 6 kết quả khách nhận được                (#benefits)
├── Trust           — dải chữ chạy + 3 chỉ báo yên tâm         (#quality)
├── LeadershipTeam  — 6 lãnh đạo Onos Group                    (#team)
└── FinalCta        — CTA đặt đơn + email hỗ trợ + link nhân viên/tuyển dụng
PublicFooter + BackToTop
```

### 2.1 Điều hướng ra ngoài trang

| Đích                        | PATHS                   | Xuất hiện ở                                    |
| --------------------------- | ----------------------- | ---------------------------------------------- |
| Khách hàng đăng ký/đặt đơn  | `CUSTOMER_REGISTER`     | header, hero, HowItWorks, FinalCta, footer      |
| Cổng khách hàng (đăng nhập) | `CUSTOMER_LOGIN`        | header, HowItWorks, FinalCta, footer            |
| Catalog công khai           | `CATALOG`               | header (mục "Sản phẩm")                         |
| Hướng dẫn lên đơn (ảnh chụp thật từng bước) | `ORDER_GUIDE` (`/guide/ordering`) | link chữ "Xem hướng dẫn chi tiết" cạnh 2 CTA ở `HowItWorks` + footer (cột "Đặt đơn") — xem [`OrderGuide.md`](OrderGuide.md) |
| Tra cứu đơn công khai       | `TRACK`                 | footer (cột "Đặt đơn") — xem `PublicOrderTracking.md` |
| Đăng nhập nhân viên         | `LOGIN` (`/adm/login`)  | CTA cuối (chữ nhỏ), footer, menu mobile         |
| Tuyển dụng                  | `COMPANY_CAREERS`       | CTA cuối, footer                                |
| Email hỗ trợ                | `support@onosfactory.com` | CTA cuối + footer (`mailto:`)                 |

Anchor nội bộ: `#why`, `#how`, `#workflow`, `#benefits`, `#quality`, `#team` —
mọi section đích đều có `scroll-mt-24` để không bị header sticky che.

**Neo trong header VÀ footer dùng chung cơ chế `hashHref`:** đứng ở trang chủ thì giữ `#how`, đứng ở trang
public khác (`/guide/ordering`, `/track`, `/catalog`…) thì thành `/#how` để quay về trang chủ rồi mới cuộn.
Footer từng để cứng `#how`/`#why`/`#benefits`/`#team` nên bấm ở trang khác không có tác dụng (TEST-01, 11/09/2026) —
thêm link neo mới ở `PublicHeader`/`PublicFooter` thì đi qua `hashHref`, đừng viết `href="#..."` trần.

**Cuộn tới neo khi đến từ trang khác — `useHashScroll()` (`components/public/useHashScroll.ts`, gọi ở `Landing`):**
link `/#how` là `<a>` thường → trình duyệt TẢI LẠI cả SPA và tìm `#how` ngay khi HTML vừa về, lúc React chưa vẽ
section nào → không cuộn, `scrollY` kẹt 0 (TEST-02 B4, 11/09/2026 — header và footer cùng lỗi). Hook đọc
`location.hash` sau khi render rồi `scrollTo` tới `top phần tử + scrollY − scroll-margin-top` (tức `scroll-mt-24`
của section), và **căn lại mỗi frame** trong 2s (kéo dài tới 600ms sau sự kiện `load`, trần 10s) vì font tiêu đề/ảnh
tải xong làm đổi chiều cao phía trên. `Reveal` chỉ đổi `opacity`/`transform` nên không làm lệch vị trí.
- **Dừng ngay** khi người dùng `wheel`/`touchstart`/`keydown`/`pointerdown` hoặc tự cuộn khỏi chỗ đã căn → không giành cuộn.
- **Không có hash → không làm gì** (mở `/` luôn ở đầu trang).
- **Bấm neo ngay trên trang chủ:** trình duyệt tự nhảy như cũ; React Router nhận `popstate` → hook thấy đã đúng chỗ, không cuộn thêm.
- **Back/Forward:** mỗi mục lịch sử có `location.key` riêng → quay về URL có hash thì cuộn lại tới mục đó; Back về trang không hash (vd `/guide/ordering`) do trình duyệt xử lý như tải trang thường.
- Trang public mới có neo được link từ trang khác → gọi `useHashScroll()` ở component trang đó.

Đã kiểm (Playwright, 1280px): từ `/guide/ordering` và `/track` bấm footer `#how`/`#team` và header `#how`/`#quality`
→ `scrollY` khớp vị trí mục (±0px sau khi ổn định); trên `/` bấm `#how`/`#benefits` vẫn đúng; `/` không hash → 0;
Back → `/guide/ordering`, Forward → `/#how` đúng vị trí; 390px mở thẳng `/#team` lệch 22px (trong ngưỡng ±40).

### 2.2 Đổi ngôn ngữ

Header có nút `Languages` gọi `useLanguageStore().toggleLanguage()` — dùng chung
store với toàn app (persist `onosfactory-language`). Landing **dịch đủ 2 ngôn ngữ**
(khác trang Tuyển dụng luôn tiếng Anh, xem [`Careers.md`](Careers.md)).

---

## 3. API / Schema

Không có. State duy nhất là 3 state UI cục bộ:

| State      | File                              | Mục đích                                          |
| ---------- | --------------------------------- | ------------------------------------------------- |
| `scrolled` | `components/public/PublicHeader.tsx` | Thêm `shadow` + `backdrop-blur` khi `scrollY > 8` |
| `menuOpen` | `components/public/PublicHeader.tsx` | Mở/đóng menu dọc ở breakpoint `< lg`             |
| `visible`  | `components/public/BackToTop.tsx`    | Hiện nút lên đầu trang khi `scrollY > 600`       |

---

## 4. UI Components

### 4.1 Primitive dùng chung — `apps/web/src/components/public/`

> Đặt ở `components/public/` chứ không nằm trong `pages/landing/` vì **cả
> `/` lẫn `/catalog` đều dùng** (xem [`Catalog.md`](Catalog.md)). Thêm trang
> public mới thì tái dùng đúng bộ này, đừng chép lại.

| File                   | Vai trò                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useInView.ts`         | Hook `IntersectionObserver` bắn `inView` **1 lần** rồi `disconnect()`. 2 nhánh thoát sớm: (a) không có `IntersectionObserver`; (b) element đã trong viewport lúc mount → hiện luôn, không chờ callback (trình duyệt hoãn callback khi tab chưa được vẽ sẽ làm nội dung kẹt `opacity: 0`). |
| `Reveal.tsx`           | Fade + trượt lên 1rem khi cuộn tới. Prop `delay` để stagger item trong lưới.                                                                                          |
| `Swoosh.tsx`           | Nét gạch chân SVG dưới cụm từ nhấn; tự "vẽ" bằng `stroke-dashoffset` + `pathLength={1}`.                                                                             |
| `SectionHeading.tsx`   | Eyebrow tím → tiêu đề `font-display` kèm `Swoosh` → mô tả. Prop `align` + `tone`.                                                                                    |
| `PillLink.tsx`         | CTA viên thuốc, 4 variant `solid`/`outline`/`onDark`/`outlineDark`. `to` → `Link`, `href` → `<a>`. Có `whitespace-nowrap` để nhãn dài không vỡ 2 dòng.               |
| `PublicHeader.tsx`     | Header sticky dùng chung. `NAV_ITEMS` có `to` (route) hoặc `hash` (neo); khi **không ở trang chủ**, mục neo tự đổi thành `/#...` để quay về landing rồi cuộn.        |
| `PublicFooter.tsx`     | Footer `ink-900`: brand + địa điểm + email hỗ trợ + 3 cột link + copyright.                                                                                          |
| `BackToTop.tsx`        | Nút tròn tím `fixed bottom-6 right-6`.                                                                                                                               |
| `useHashScroll.ts`     | Hook cuộn tới `#id` trong URL sau khi trang render + căn lại khi bố cục phía trên còn đổi; dừng khi người dùng tự cuộn. Dùng ở `Landing` — xem §2.1.                  |
| `PublicProductCard.tsx` + `catalogPrice.ts` | Thẻ sản phẩm + helper giá — chỉ dùng ở `/catalog`, xem [`Catalog.md`](Catalog.md).                                              |

### 4.2 Ảnh minh hoạ giao diện — `pages/landing/mockups/`

Dựng **hoàn toàn bằng CSS/JSX**, không ảnh chụp, không dependency mới:

| File                   | Mirror màn hình thật                | Dùng ở                        |
| ---------------------- | ----------------------------------- | ----------------------------- |
| `CustomerTracking.tsx` | `pages/customer/orders/track.tsx`   | Hero + Showcase row "theo dõi" |
| `CatalogGrid.tsx`      | `pages/customer/catalog/`           | Showcase row "chọn hàng"       |
| `LifecycleFunnel.tsx`  | `pages/home/LifecycleStrip.tsx`     | Showcase row "hậu trường"      |

> **Nhãn trong mockup CỐ Ý tổng quát** — xem §8. Không dùng tên 8 chặng / 6 công
> đoạn thật, không dùng định dạng `productionId` thật (`N-104xx` → `#1042`),
> `CatalogGrid` không hiện giá.

### 4.3 Responsive

| Breakpoint     | Hành vi                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `< sm` (390px) | 1 cột; CTA full-width xếp dọc; ẩn 2 badge nổi hero; menu hamburger                  |
| `sm` – `< lg`  | Grid 2 cột; badge "báo ngay" hiện lại                                               |
| `lg` (≥1024px) | Hero 2 cột `1.05fr_1fr`; nav ngang (`gap-5`, `xl:gap-7`); team 6 cột; showcase so le |

Container thống nhất `max-w-6xl` (1152px) — vừa màn 1366×768 phổ thông, **không**
tràn ngang ở mọi breakpoint đã kiểm (`scrollWidth === clientWidth` tại 1366/1280/768/390).

### 4.4 Animation

Không dùng `framer-motion` — chỉ CSS transition + `IntersectionObserver`.
**Mọi hiệu ứng đều có nhánh `motion-reduce:`.** Dải chữ chạy ở `Trust` dùng
keyframe `marquee` (`tailwind.config.js`), lặp nội dung 2 lần để cuộn liền mạch.

### 4.5 Accessibility

Semantic `<header>/<main>/<section>/<article>/<footer>`, danh sách lợi ích `<ul>`,
4 bước đặt đơn `<ol>`, năng lực `<dl>/<dt>/<dd>`. Hình trang trí đều
`aria-hidden`; dải chữ chạy có bản `sr-only`. Nút icon-only có `aria-label` từ
i18n, hamburger có `aria-expanded`. Mọi CTA có `focus-visible:ring-2`.

---

## 5. Dữ liệu đội ngũ (Leadership Team)

Tên + chức danh lấy từ `onosglobal.com`; ảnh tải về `apps/web/src/assets/images/team/`.
**Chỉ 4/6 người có ảnh chân dung xác thực**:

| Người               | Ảnh trong repo       | Ghi chú                                                                                     |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| Claude Vlandis      | `claude-vlandis.jpg` | ảnh thật                                                                                     |
| Thuy Nguyen         | `thuy-nguyen.jpg`    | ảnh thật                                                                                     |
| Jacob Shapira       | `jacob-shapira.jpg`  | ảnh thật                                                                                     |
| Soi Le              | `soi-le.jpg`         | ảnh thật                                                                                     |
| Ricardo Bialystocki | — (vòng chữ `RB`)    | ảnh trên site cũ là `team-1.jpg`, tên file chung, chưa xác minh                              |
| Ricardo Castillo    | — (vòng chữ `RC`)    | ảnh trên site cũ là `h2-team01.jpg` — **ảnh mẫu của theme WordPress**, không phải người này  |

**Quy tắc bất di bất dịch:** không lấp chỗ trống bằng ảnh mẫu theme hay ảnh
stock. Gắn mặt người lạ vào tên người thật trên trang public là sai. Có ảnh thật
thì thêm vào `assets/images/team/` rồi trỏ `photo` trong `MEMBERS`
(`sections/LeadershipTeam.tsx`) — vòng chữ cái tự biến mất.

Trang cũ còn liệt kê **Tien Ha — Operations Manager**; người này **đã được yêu
cầu bỏ** khỏi trang chủ mới, đừng thêm lại.

---

## 6. Backend logic

Không có.

---

## 7. Performance notes

| Hạng mục       | Chi tiết                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Route loading  | `Landing` **import tĩnh** trong `App.tsx` (không `lazy`) — trang chủ là điểm vào đầu tiên, tránh thêm 1 round-trip tải chunk.   |
| Dependency mới | **0**. Chỉ `react-router-dom`, `react-i18next`, `lucide-react`, Tailwind — đều đã có.                                            |
| Font           | `Lexend Deca` gộp vào request Google Fonts sẵn có (không thêm request).                                                          |
| Ảnh            | `logo.png` (dùng chung) + 4 ảnh chân dung (`loading="lazy"` + `decoding="async"`). 0 ảnh stock; mọi visual khác là CSS/JSX.      |
| JS animation   | 0 thư viện. `IntersectionObserver` `disconnect()` ngay sau lần bắn đầu; 2 listener `scroll` đều `{ passive: true }` + cleanup.   |
| Build          | `npm run build` pass; cảnh báo chunk >1024kB là **có sẵn từ trước**, không phát sinh từ trang này.                               |

---

## 8. Permissions & giới hạn nội dung

**Public tuyệt đối.** Route `/` khai báo ngoài `PrivateRoute` trong `App.tsx`,
không đọc `authStore`/`customerAuthStore`, không có permission code.

Trang này hiển thị cho **người chưa đăng nhập và cả người ngoài công ty**. Danh
sách những thứ **đã cố ý loại bỏ / tổng quát hoá**, đừng đưa ngược lại:

| Không đưa lên trang chủ                                    | Trang chủ dùng thay thế                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tên 8 chặng vòng đời / 6 công đoạn xưởng thật               | Nhãn chung: Tiếp nhận · Thiết kế · Sản xuất · Kiểm tra · Hoàn thiện · Đóng gói |
| Số cấu hình (8 chặng, 6 công đoạn, 3 mức gán, 3 nguồn lỗi)  | 4 phát biểu định tính, không con số (`capabilities`)                          |
| Định dạng `productionId` thật (`N-104xx`)                   | Mã tham chiếu chung `#1042`                                                   |
| Mã lỗi thật dán ngoài xưởng, tên lỗi cụ thể                 | không xuất hiện (mockup quét mã đã bị bỏ)                                     |
| Giá bán, tên khách hàng, sản lượng, tên/số lượng xưởng      | không xuất hiện                                                               |

Mỗi mockup đều có dòng chú thích "Ảnh minh hoạ giao diện"
(`landing.showcase.caption` / `landing.hero.panelCaption`).
