# Products — Function Description

> **File FE:** `apps/web/src/pages/products/index.tsx`, `apps/web/src/pages/products/detail/index.tsx` (trang chi tiết 1-trang-dọc), `apps/web/src/pages/products/productForm/` (VariationItem/VariantsTable/BatchEditDialog/MockupImagesEditor/variantUtils), `apps/web/src/components/common/RichTextEditor.tsx`, `apps/web/src/pages/products/CollectionTab.tsx` (xem `Collections.md`)
> **File BE:** `apps/api/src/modules/product-config/`, `factory/`, `machine-type/`, `product-category/`
> **Route:** `/adm/products`, `/adm/products/:id` (chi tiết)
> **API:** `/v1/product-configs`, `/v1/product-configs/:id` (GET 1 sản phẩm), `/v1/factories`, `/v1/machine-types`, `/v1/product-categories`
> **Liên quan:** Chương trình giảm giá theo tier khách hàng — [`Promotion.md`](Promotion.md). Catalog cho Customer Portal (giá tham khảo đã áp discount) — [`CustomerPortal.md`](CustomerPortal.md) §7.

---

## 1. Overview

Module **Products** quản lý 4 entity liên quan đến cấu hình sản xuất + catalog:

- **Product Config** — map `fullName` (tên đầy đủ sản phẩm) → `factory` + `machineType` (phòng / loại máy in) + `machineNumber` (số máy) + default `fabricType` + default `toolResult` + chi tiết catalog (§2.4/§2.5)
- **Factory** — danh sách xưởng sản xuất (mặc định ML/TN/US)
- **Machine Type** — danh sách "Phòng" / loại máy in (ICL / IEN / HT…)
- **Product Category** (§4) — danh mục sản phẩm, module riêng (KHÔNG dùng workshop_config), ProductConfig tham chiếu qua `productCategoryId`

UI chia 3 tab:
- **Config tab** — CRUD product config + import từ Google Sheets + xóa toàn bộ
- **Danh mục tab** (`ProductCategoryTab.tsx`) — CRUD product category (§4), tab riêng cho dễ tìm
- **Xưởng tab** — CRUD factory / machine type (2 bảng xếp dọc, xem §3)

---

## 2. Tab `Config` (`apps/web/src/pages/products/ProductConfigTab.tsx`)

### 2.1 Tính năng
| Chức năng | Mô tả |
|-----------|-------|
| **Quyền theo vai** (AUTH-6, mở rộng 10/09/2026) | **SuperAdmin / Admin / Manager**: xem + sửa đầy đủ như trước. **Support**: được **TẠO + SỬA sản phẩm** — thấy nút "Thêm sản phẩm", vào được trang chi tiết `/adm/products/:id` để sửa (kể cả upload mockup), 6 select sửa tại chỗ dùng được, nút ✏️ mỗi dòng hiện; **KHÔNG được**: 🗑️ xóa sản phẩm, 6 nút công cụ import/crawl/backfill (ẩn), và 3 tab Danh mục/Collection/Xưởng vẫn chỉ đọc. Chặn hai lớp: giao diện qua hook `useProductWriteAccess` (2 cờ `canWriteProducts` có Support / `canManageProducts` chỉ Admin+Manager), API qua `@Auth` — xem `Auth.md` §7.2. **Vai không có `page.products`** (Designer/DesignerLeader/Fulfillment...) và **Customer** vẫn bị API từ chối như trước. |
| List | Bảng có **phân trang** (`<PaginationBar>`, mặc định `pageSize=20`, đọc `total` từ response), sort theo `createdAt` desc. Đổi bất kỳ bộ lọc nào / Xóa tất cả reset về trang 1 |
| **Khu bộ lọc** (PRD-1, mở rộng ở PRD-5) | Panel ngay trên bảng, **7 ô** nhìn thấy sẵn (grid 1→7 cột theo bề rộng), tổ hợp **AND**, lọc trên TOÀN BỘ dữ liệu qua API chứ không lọc trang hiện tại: **Tên sản phẩm** (`fullName`) · **Tên viết tắt** (`shortName`) · **Mã chạy tool** (`designReviewCode` — PRD-5, đặt ngay sau Tên viết tắt cho khớp thứ tự cột; khớp *chứa chuỗi, không phân biệt hoa thường*, debounce 400ms y hệt hai ô chữ kia; ô có chữ thì sản phẩm CHƯA đặt mã tự rớt khỏi kết quả vì `$regex` không khớp giá trị vắng mặt) · **Xưởng** (`factoryId`) · **Phòng** (`machineTypeId`) · **Loại vải** (`fabricType`) · **Trạng thái** (`status`). Ba ô chữ khớp *chứa chuỗi, không phân biệt hoa thường*, debounce 400ms (`useDebounce`) và là **ba điều kiện riêng** — gõ cả hai thì phải thỏa cả hai (khác `search` cũ vốn gộp `fullName`/`shortName`/`sku` bằng một `$or`; tham số `search` GIỮ NGUYÊN cho nơi khác gọi — PRD-5 CỐ Ý **không** thêm `designReviewCode` vào `$or` này). Loại vải lấy option từ `workshopConfigStore` (category `fabric_type`, cùng nguồn với select inline trong bảng) cộng mục **"Chưa đặt loại vải"** = `fabricType=none` (`PRODUCT_FABRIC_TYPE_NONE`) cho sản phẩm bỏ trống trường này. Có bất kỳ ô nào đang đặt → hiện nút **Xóa bộ lọc**. Bộ lọc KHÔNG lưu vào URL, không nhớ giữa các lần vào trang. |
| **Khu hành động** (PRD-1) | 7 nút công cụ **không nằm trong tab** nữa mà ở góc trên bên phải **ngang tiêu đề trang** (`ProductConfigActions.tsx`, render từ `pages/products/index.tsx` khi tab đang mở là `config`). Mỗi nút thu gọn còn **biểu tượng**, tên đầy đủ hiện khi rê chuột (Radix Tooltip + `aria-label`), xếp theo nhóm ngăn bằng vạch dọc: **Thêm sản phẩm** (nút đặc, `Plus`) │ 3 nút nạp từ file — Import từ Excel (`FileSpreadsheet`) · Tải config lên (`Upload`) · Import sản phẩm từ file (`PackagePlus`) │ 2 nút gọi OnosPod — Import từ OnosPod (`CloudDownload`) · Crawl tax & package (`Receipt`) │ Backfill vải (`RotateCw`). Tiến trình của 2 việc chạy dài hiện thành dòng chữ nhỏ ngay dưới khu nút. **Hành vi từng nút giữ nguyên**; khu hành động đổi dữ liệu xong thì tăng `refreshKey` để `ProductConfigTab` tải lại danh sách. |
| **Trạng thái** (`status`) | Badge màu + `<select>` inline mỗi dòng (Active/Inactive/Hidden — xem §2.2) đổi ngay; dropdown filter toolbar mặc định "Tất cả (trừ Đã ẩn)" (không truyền `status` — BE tự loại `hidden`), chọn cụ thể 1 trạng thái để xem đúng nhóm đó (VD: xem lại các sản phẩm Đã ẩn). Màu: Active xanh lá, Inactive vàng, Hidden xám (`STATUS_META` — export từ `ProductConfigTab.tsx`, dùng chung với trang chi tiết). |
| Inline edit | Dropdown chọn **`factoryId` (Xưởng)** + **`machineTypeId` (Phòng)** + `fabricType` + `toolResult` + `level` cho mỗi dòng, ô nhập `mockup` (URL, cột đầu) → PATCH `/v1/product-configs/:id`. Xưởng/Phòng là **ref bắt buộc** → không có option rỗng (danh sách nạp qua `getFactories`/`getMachineTypes` 1 lần khi mount). |
| **Xưởng / Phòng** (editable) | Cột **Xưởng** (`factoryId`) + **Phòng** (`machineTypeId`) sửa inline bằng `<select>` (giá trị = id, nhãn `shortName · name`) **và** ở trang chi tiết. Update lạc quan (`factoryId`+`factory` / `machineTypeId`+`machineType`), lỗi thì refetch rollback. **Chỉ ảnh hưởng import đơn về sau** — đơn đã import giữ nguyên `factoryId`/`originalFactoryId` (insertOnly + transfer), KHÔNG backfill. BE `updateProductConfig` **validate** `factoryId` (`factoryService.getFactory`) + `machineTypeId` (`machineTypeService.getMachineType`) → 404 nếu id không tồn tại. **Cả 2 field OPTIONAL** (`ProductConfigZod.factoryId`/`machineTypeId`, entity KHÔNG `required`) — trang chi tiết cho **Tạo sản phẩm** mà không chọn Xưởng/Phòng (bỏ validate chặn "Vui lòng chọn xưởng/phòng" lúc tạo mới); đơn import khớp `type` với sản phẩm chưa có `factoryId` sẽ tự rơi vào "Không xác định xưởng" (Orders.md §19), cùng cách xử lý đơn chưa map product config. Inline edit ở bảng danh sách vẫn giữ nguyên tắc "không cho về rỗng" sau khi đã gán (chỉ áp dụng cho sản phẩm ĐÃ có Xưởng/Phòng — sản phẩm tạo mới chưa gán thì dropdown vẫn hiện option rỗng). |
| **Mockup** | Cột **đầu tiên** — string URL ảnh; hiển thị thumbnail 56×56 (click mở tab mới), **read-only ở bảng danh sách** (đã bỏ hẳn ô nhập URL) — sửa/upload mockup chỉ qua trang chi tiết (§2.4a: upload file, KHÔNG còn dán URL) |
| **Mã chạy tool** (PRD-4, thành liên kết ở PRD-6) | Cột **chỉ đọc** đặt ngay SAU cột Tên viết tắt, hiển thị `designReviewCode` (badge `secondary` font-mono); trống thì hiện dấu gạch `—`. **PRD-6**: sản phẩm có **CẢ** `designReviewCode` **lẫn** `designReviewTemplateUrl` thì badge được bọc trong `<a target="_blank" rel="noreferrer">` (thêm icon `ExternalLink` 12px + `hover:underline`, tooltip `configTab.table.designReviewCodeLinkTitle`) mở file template ở **TAB MỚI** — cố ý không điều hướng trong tab hiện tại để không mất bộ lọc/trang đang xem. Thiếu một trong hai ⇒ badge thường, con trỏ không đổi, KHÔNG hiện liên kết chết. CỐ Ý không lọc, không sửa inline — sửa mã chỉ qua khu ①Sản xuất ở trang chi tiết (§2.4). Dữ liệu lấy thẳng từ response list (`GET /v1/product-configs` không `$project` nên đã trả sẵn field này), KHÔNG gọi thêm API. Nhãn i18n `products:configTab.table.designReviewCode` (VI "Mã chạy tool" / EN "Tool code"). Đây là dữ liệu NỘI BỘ — không đưa sang catalog khách/public. |
| **Level** | Select 1 trong **10 level cố định** (`PRODUCT_LEVELS` ở shared) — badge màu gradient dễ→khó (xanh lá `#22C55E` → đỏ đậm `#7F1D1D`). Lưu ngay khi chọn. Level còn xem/gán được từ Dashboard tab Designer → panel "Thời gian theo sản phẩm" (cột Level + cột Gợi ý level tự động theo percentile 60 ngày — xem `Dashboard.md`), CÙNG dữ liệu `ProductConfig.level` |
| **Trang chi tiết sản phẩm** (`apps/web/src/pages/products/detail/index.tsx`, route `/adm/products/:id`) | Nút ✏️ (`Pencil`) mỗi dòng **điều hướng** sang trang riêng (KHÔNG còn popup) qua `PATHS.PRODUCT_DETAIL.replace(':id', it._id)`. Trang tự fetch 1 sản phẩm qua `GET /v1/product-configs/:id` (populate `factory`/`machineType`/`productCategory`) + tự load danh sách Xưởng/Phòng/Danh mục sản phẩm/workshop_config. **Header** cho sửa **Tên viết tắt** (`shortName` — tên viết tắt thuần, ĐƯỢC PHÉP trống; từ PRD-2 KHÔNG còn là mã tool), **SKU sản phẩm** (`sku`, optional — KHÁC SKU biến thể), và **Trạng thái** (`status` — select màu theo `STATUS_META`, xem §2.2) cạnh tiêu đề `fullName` (fullName read-only khi sửa sản phẩm đã tồn tại; editable khi tạo mới — xem hàng "Thêm sản phẩm" ở §2.1). **Layout 1-trang-dọc full-bleed** (bỏ sidebar + 2 tab): header sticky (back + thumbnail ảnh chính + fullName + shortName/SKU/status + Cancel/Lưu) kèm **anchor nav 4 section đánh số** — ①Sản xuất (indigo) / ②Chi tiết sản phẩm (sky) / ③Biến thể & Giá (violet) / ④Vị trí in (amber). Click tab = smooth-scroll tới section (`scrollToSection`, khóa scrollspy 800ms); cuộn tay = **scrollspy** `IntersectionObserver` (rootMargin `-20% 0px -55% 0px`) tự sáng tab. Mỗi section là `SectionCard` viền trái 4px màu riêng + icon tile + mô tả. Section ① gồm gallery ảnh (§2.4a) + slug + **Mã chạy tool duyệt thiết kế** (`designReviewCode` — PRD-2, ô RIÊNG đặt ở đây chứ không cạnh ô Tên viết tắt để không ai nhầm hai thứ; sửa xong lưu là API design-review trả mã mới ngay, không cần deploy) + **URL file template chạy tool** (`designReviewTemplateUrl` — PRD-6, ô ngay DƯỚI ô mã; chỉ nhận http(s), sai định dạng thì **chặn lưu** + báo lỗi đỏ ngay tại ô (`designReviewTemplateUrlInvalid`), để trống vẫn lưu bình thường; gửi chuỗi rỗng khi xoá trắng nên gỡ được URL cũ. KHÔNG đưa vào API Design Review công khai, KHÔNG lộ ra portal/catalog khách) + level (segmented 1..10) + `machineNumber` + Xưởng/Phòng + fabricType/toolResult + 3 toggle parity hệ cũ (`hideForSeller`/`enableDesignCheck`/`enableAffiliate` — CHỈ lưu, chưa wire logic) + guide (**rich text** `RichTextEditor`); section ② gồm danh mục/print method + **Collection multi-select** (badge toggle, xem `Collections.md`) + bảng size (upload) + Shipping time (`maxProductionTime`/`maxShippingTime`) + Logistics Information (đóng gói mặc định, nhãn hệ cũ) + item specifics + 3 rich text (Short/Item/Template description); section ③ xem §2.5; section ④ = checkbox grid printArea + card cấu hình giàu từng vị trí (template/px/isRequired/phụ phí/thêu) + 2 input printDocument/printTemplate (§2.4a). Header sticky luôn hiện nút **Lưu thay đổi** (disable khi không có thay đổi) + badge "Chưa lưu" khi dirty; 1 PATCH gộp toàn bộ field khi lưu, sau đó vẫn ở lại trang (toast xác nhận). **Dirty guard**: so sánh snapshot JSON form vs baseline lúc load/sau khi lưu — có thay đổi chưa lưu thì `beforeunload` cảnh báo + chặn click `<a>` điều hướng trong app + nút back (`ArrowLeft`) tự `confirm()` trước khi quay về `/adm/products` (cùng pattern dirty-guard ở `CustomerAssignmentConfig.tsx`). |
| **Hướng dẫn** (`guide`) | Free-text ghi chú/hướng dẫn sản phẩm — **cột trong bảng tạm ẩn**; chỉ sửa qua trang chi tiết (textarea). |
| **Xóa 1 sản phẩm** | Nút 🗑️ (`Trash2`) cạnh ✏️ mỗi dòng ở bảng danh sách (`ProductConfigTab.tsx`) **và** nút "Xóa sản phẩm" ở header trang chi tiết (`detail/index.tsx`, ẩn khi đang tạo mới). `confirm()` → DELETE `/v1/product-configs/:id` (soft delete, `ProductConfigService.deleteProductConfig()`). **CHỈ xóa được nếu sản phẩm KHÔNG có đơn hàng nào tham chiếu** — BE đếm `orders` có `type` khớp CHÍNH XÁC `fullName` (case-insensitive, cùng cách `importOrders()` map ProductConfig lúc import) và `deletedAt` không tồn tại (tính cả đơn đã hủy — vẫn là lịch sử tham chiếu); có ≥1 đơn → 400 kèm số lượng đơn (`Không thể xóa — sản phẩm "X" đang có N đơn hàng.`), FE hiện toast lỗi qua `handleAxiosError`. |
| **Xóa tất cả** | Confirm → DELETE `/v1/product-configs/all` (hard-delete `deleteMany({})`) — dùng khi reset từ đầu |
| Import | Dialog paste 7 cột tab-separated → bulk upsert by `fullName` |
| **Tải config lên (file Excel)** | Nút "Tải config lên" (toolbar, cạnh Import) mở `UploadConfigFileDialog.tsx` — chọn file `.xlsx` dạng "SKU THÁI NGUYÊN-MÊ LINH" (header `Tên SP` / cột viết tắt ngay sau / `Nhà máy` / `Phòng`; chịu được cả format 7 cột có `Máy`/`Loại vải`/`Kết quả`). Parse client-side (`XLSX.read`, quét mọi sheet, dedup theo fullName; **dòng thiếu Tên viết tắt KHÔNG bị loại** — để trống, KHÔNG auto-sinh (ORD-3; BE giữ nguyên shortName hiện có khi update); chỉ loại dòng thiếu Xưởng/Phòng, đếm `invalidCount` báo trong dòng tóm tắt), fetch `GET /v1/product-configs?limit=5000` so `fullName` case-insensitive → **chỉ hiển thị sản phẩm CHƯA có config** dạng bảng checkbox (mặc định chọn hết, click dòng để toggle, select-all ở header) kèm số dòng đã có/chưa có. Submit → tái dùng `POST /v1/product-configs/import` với các dòng đã chọn (resolve xưởng/phòng/vải server-side như import paste); skipped reasons hiện `toast.warning` (tối đa 3). i18n `products:uploadConfigDialog.*`. |
| **Thêm sản phẩm** (tạo mới đơn lẻ) | Nút "Thêm sản phẩm" (toolbar, cạnh Import) → điều hướng `PATHS.PRODUCT_DETAIL.replace(':id', 'new')` = `/adm/products/new` — **tái dùng NGUYÊN route + component trang chi tiết** (không route riêng). `detail/index.tsx` tự nhận biết `id === 'new'` (`isNew`) → bỏ qua fetch, khởi tạo form rỗng (`status=Active`), hiện `<Input>` cho `fullName` ngay tại vị trí `<h1>` (bình thường read-only) — validate bắt buộc `fullName`/`factoryId`/`machineTypeId` trước khi cho lưu (`shortName` và `designReviewCode` đều ĐƯỢC PHÉP trống) (`factoryId`/`machineTypeId` optional khi PATCH sửa nhưng **bắt buộc khi tạo mới** theo `CreateProductConfigZod`). Nút Lưu đổi label "Tạo sản phẩm", luôn bấm được (không cần dirty). Lưu thành công → gọi `POST /v1/product-configs` (đã có sẵn từ trước, chỉ chưa được gọi ở UI nào) → `navigate` sang `/adm/products/:id` với id thật (`replace: true`) → effect fetch-by-id tự chạy lại, trang chuyển tự nhiên sang chế độ sửa bình thường. |

### 2.2 Schema `ProductConfigEntity`
```ts
{
  fullName: string;        // Tên đầy đủ (vd: "All-over Print Hockey Jersey"), unique key khi upsert. `createProductConfig`/`updateProductConfig` (đổi tên) chặn trùng tên bản đang sống bằng CÙNG phép khớp với `importOrders` (trim, `^…$`, không phân biệt hoa thường) → 400 `Sản phẩm "X" đã tồn tại.` (`assertFullNameFree`). CHƯA có unique index — dữ liệu cũ còn 2 nhóm trùng chờ dọn
  shortName: string;       // TÊN VIẾT TẮT do người dùng đặt — uppercase, ĐƯỢC PHÉP TRỐNG; KHÔNG auto-sinh từ fullName ở mọi đường tạo/import. Từ PRD-2 KHÔNG còn mang mã tool và KHÔNG migration/import nào ghi đè nó — chỉ người dùng sửa tay ở header trang chi tiết
  designReviewCode?: string; // Mã CHẠY TOOL duyệt thiết kế (PRD-2) — uppercase, trống = không có mã (Design Review API trả productCode null). Nguồn DUY NHẤT của productCode; migrate 1 lần từ PRODUCT_TYPE_CODE_MAP (cờ system_configs `design_review_code_migration`) — xem Orders.md §18.5. Sửa ở khu ①Sản xuất trang chi tiết
  designReviewTemplateUrl?: string; // PRD-6 — URL file template DÙNG ĐỂ CHẠY TOOL. Trường RIÊNG, TUYỆT ĐỐI không dùng lại printTemplate/printDocument/printArea[].templateUrl (ba trường đó mang dữ liệu migrate hệ cũ + import OnosPod). Optional, tối đa 1000 ký tự, chỉ nhận http(s) (zod refine ở shared + chặn tại ô nhập trang chi tiết); KHÔNG uppercase. Trống = mã chạy tool ngoài danh sách không bấm được. Sửa ở khu ①Sản xuất trang chi tiết, ngay DƯỚI ô Mã chạy tool
  sku?: string;            // Mã SKU riêng của sản phẩm (KHÁC SKU biến thể trong variations[]) — unique+sparse toàn hệ thống, sửa ở trang chi tiết (header)
  machineNumber?: string;  // Số máy in ("mã máy in", vd "94", "27"). Empty ⇒ sản phẩm không có tool — sửa ở trang chi tiết (sidebar)
  factoryId?: ObjectId;    // ref FactoryEntity (xưởng — vd Mê Linh / Thái Nguyên / US) — optional, tạo sản phẩm được mà chưa gán
  machineTypeId?: ObjectId; // ref MachineTypeEntity (phòng — loại máy in: ICL / IEN / HT) — optional, tạo sản phẩm được mà chưa gán
  fabricType?: string;     // workshop_config code (category=fabric_type) — default fabric copy vào order
  toolResult?: string;     // workshop_config code (category=tool_result) — default tool status. KHÔNG còn copy vào order lúc import nữa (xem §2.2 dưới) — chỉ còn ý nghĩa hiển thị/cấu hình.
  mockup?: string;         // URL ảnh mockup CHÍNH (index 0 gallery) — hiển thị cột đầu bảng config
  images?: string[];       // Gallery ảnh bổ sung (ngoài mockup) — tối đa 20, URL hoặc upload local-disk (§2.4a)
  slug?: string;           // Slug SEO/URL (parity hệ cũ) — chỉ lưu, chưa dùng routing
  collectionIds?: string[]; // ref CollectionEntity — 1 sản phẩm thuộc NHIỀU collection (Collections.md)
  level?: number;          // Cấp độ 1..10 (PRODUCT_LEVELS ở shared) — badge màu gradient
  guide?: string;          // Hướng dẫn sản xuất — HTML từ rich text editor (max 20000)

  status: string;                // ProductConfigStatus: active (hiện catalog+quản trị) | inactive (ẩn catalog, hiện quản trị) | hidden (ẩn cả 2, KHÔNG xóa DB) — mặc định active
  // Chi tiết sản phẩm (catalog cho khách hàng) — xem §2.4/§2.5
  productCategoryId?: ObjectId;  // ref ProductCategoryEntity (module riêng — §4), virtual populate `productCategory`
  printMethod?: string;          // workshop_config code (category=print_method)
  printArea?: {                  // Danh sách vị trí in — OBJECT GIÀU mirror print_areas[] hệ cũ (đổi từ string[] 2026-08)
    key: string;                 //   key CỐ ĐỊNH (PRODUCT_PRINT_AREA_KEYS, KHÔNG free-text), map 1-1 sang order.designs.{key}
    templateUrl?: string;        //   "print" hệ cũ — URL template thiết kế riêng vị trí này
    widthPx?: number; heightPx?: number; // "width"/"height" hệ cũ — kích thước file in chuẩn (px)
    isRequired?: boolean;        //   "is_required" hệ cũ — false = khách được bỏ trống design; KHÔNG set coi như bắt buộc (backfill data cũ → true)
    additionPrice?: number;      //   "addition_price" hệ cũ — CHỈ lưu, chưa wire tính giá
    isEmbroidery?: boolean;      //   "is_embroidery" hệ cũ
    sizeDimensions?: {           //   PRD-7 — kích thước in THẬT theo TỪNG size, đơn vị **cm**. CỘNG THÊM vào widthPx/heightPx (px, mirror hệ cũ + import OnosPod) chứ KHÔNG thay thế. Thiếu/rỗng = vị trí này chưa cấu hình, không chặn lưu
      size: string;              //     lấy từ thuộc tính "Size" của variations[] (không phân biệt hoa thường) — KHÔNG cho gõ tự do, để sau này ghép với size của đơn không lệch chính tả
      widthCm: number;           //     > 0 và <= PRINT_AREA_MAX_WIDTH_CM (58) — vùng in thật của giấy DTF khổ 60cm trừ 1cm kẹp mỗi bên
      lengthCm: number;          //     > 0, KHÔNG có trần (giấy cuộn)
    }[];
  }[];
  printDocument?: string;        // "print_document" hệ cũ — URL trang tài liệu hướng dẫn design
  printTemplate?: string;        // "print_template" hệ cũ — URL template thiết kế CHUNG (per-vị-trí xem printArea[].templateUrl)
  sizeChartUrl?: string;         // Ảnh/URL bảng size
  description?: string;          // "Item description" hệ cũ — HTML rich text, hiển thị Customer Portal (portal hiện render text thô, chưa render HTML)
  shortDescription?: string;     // "Short description" hệ cũ — HTML rich text
  templateDescription?: string;  // "Template description" hệ cũ — HTML rich text
  maxProductionTime?: number;    // "Shipping time" hệ cũ — Max Production time (ngày)
  maxShippingTime?: number;      // "Shipping time" hệ cũ — Max shipping time (ngày)
  hideForSeller?: boolean;       // "Hide product for seller" hệ cũ — CHỈ lưu, chưa wire (VD chưa filter catalog)
  enableDesignCheck?: boolean;   // "Enable design check" hệ cũ — CHỈ lưu, chưa wire
  enableAffiliate?: boolean;     // "Enable affiliate commission" hệ cũ — CHỈ lưu, chưa wire
  itemSpecifics?: { label: string; value: string }[]; // Thông số kỹ thuật tự do
  weight?: number; width?: number; height?: number; length?: number; // Đóng gói mặc định
  variations?: {
    sku: string;          // Unique TOÀN HỆ THỐNG (index unique+sparse trên `variations.sku`) — LUÔN tự sinh `{SKU sản phẩm}-{thuộc tính}`, không cho sửa tay qua UI
    attributes?: { label: string; value: string }[]; // Thuộc tính tự do (VD: "Màu"→"Đỏ", "Size"→"M") — KHÔNG định nghĩa cứng field màu/size
    cost?: number;         // "Cost" hệ cũ (base_price) — KHÔNG bao giờ trả ra Customer Portal
    nonShipCost?: number;  // "Non-Ship" hệ cũ (nonship_price) — KHÔNG trả ra Customer Portal
    retailPrice?: number;  // "EXP US $" hệ cũ (sale_price) — giá niêm yết, hiển thị Customer Portal
    wholesalePrice?: number; // "Wholesale" hệ cũ (wholesale_price) — nội bộ
    tiktokPrice?: number;    // "TT US $" hệ cũ (tiktok_final_price) — nội bộ
    expUsShipCost?: number;  // "EXP US" ship cost — hệ cũ auto từ onosexpress, hiện NHẬP TAY
    tiktokShipCost?: number; // "TIKTOK US" ship cost — nhập tay
    weight?: number; width?: number; height?: number; length?: number; // Override đóng gói
    status: string;        // Status.Active/Inactive
  }[];
}
```

> **Lưu ý:** `ProductConfigEntity` bị ràng buộc `assertSameType<ProductConfig, ProductConfigEntity>()` (2 chiều) — thêm field mới **BẮT BUỘC** sửa đồng bộ cả `packages/shared/dtos/product-config.dto.ts` (`ProductConfigZod` + Create/Update) lẫn entity, nếu không sẽ fail compile. `service.updateProductConfig` spread `...dto` nên field mới tự pass-through, không cần sửa service. 10 level cố định + màu định nghĩa ở `packages/shared/constants/product-level.ts` (`PRODUCT_LEVELS`, `PRODUCT_LEVEL_MAP`). **`sku`** (mã SKU riêng của sản phẩm, KHÁC SKU biến thể) có unique+sparse index riêng (`ProductConfigSchema.index({ sku: 1 }, ...)`) — trùng SKU sản phẩm khác → 400 "SKU sản phẩm đã tồn tại ở sản phẩm khác" (`isDuplicateProductSkuError()` trong `product-config.service.ts`, cùng pattern với `isDuplicateVariationSkuError()`); `create`/`updateProductConfig` tự uppercase+trim `sku` giống `shortName`. **`status`** (`ProductConfigStatus` — `packages/shared/enums/product-config-status.ts`) mặc định `active` qua Mongoose schema default (data cũ chưa có field này coi như `active` — filter dùng `$ne`/`$in [...,null]` để tương thích ngược); `getProductConfigs()` mặc định loại `hidden` trừ khi client truyền `status` cụ thể (`GetProductConfigsDto.status`); `CustomerCatalogService.getCatalog()` CHỈ trả `active`.

### 2.4 Chi tiết sản phẩm (catalog cho khách hàng)

Tab **"Chi tiết sản phẩm"** ở trang chi tiết (`/adm/products/:id`) — `productCategoryId` chọn từ module **Product Category riêng** (§4, xem tab riêng ở Products, đa cấp độ), `printMethod` chọn từ category `print_method` trong `workshop_config` (quản lý ở trang `/workshop-config`, xem `WorkshopConfig.md`), `description`/`shortDescription`/`templateDescription` là **rich text (HTML, react-quill)**, `itemSpecifics` là danh sách key-value tự do (thêm/xoá dòng), 4 field đóng gói mặc định (weight/width/height/length).

### 2.4a Ảnh sản phẩm (Gallery mockup + Bảng size) — lưu LOCAL DISK

**Gallery nhiều ảnh (mới):** section ① dùng `productForm/MockupImagesEditor.tsx` — danh sách ảnh, index 0 = **ảnh CHÍNH** (lưu field `mockup`), còn lại lưu `images[]` (tối đa 20). Thêm ảnh bằng **dán URL** (cho phép lại theo yêu cầu — ảnh có thể host ngoài) HOẶC **chọn nhiều file** (chỉ preview local qua `URL.createObjectURL`, badge "Chờ upload"); file thật sự upload lúc bấm Lưu qua CÙNG endpoint local-disk bên dưới (`type=mockup`), theo đúng pattern deferred của bảng size. Hover ảnh để "Đặt làm ảnh chính" (đưa lên đầu) / xóa. Bảng size vẫn 1 ảnh, upload-only (`ImageUploadField` trong `detail/index.tsx`).

`mockup` (sidebar, §2.1) và `sizeChartUrl` (tab "Chi tiết sản phẩm") đều **upload file thật** qua component `ImageUploadField` (`apps/web/src/pages/products/detail/index.tsx`):

1. Bấm vào ảnh preview (hoặc khung trống) → mở file picker → chọn ảnh → **CHỈ preview local** ngay lập tức (`URL.createObjectURL`, state `mockupFile`/`sizeChartFile` giữ `File` gốc) — **KHÔNG upload ngay**, badge amber "Ảnh mới — sẽ upload khi bấm Lưu" hiện dưới ảnh, form tự động thành `dirty`.
2. Chỉ khi bấm **Lưu thay đổi** (`handleSave`), nếu có `mockupFile`/`sizeChartFile` đang chờ → gọi `POST /v1/product-configs/upload-image` (multipart, field `type`=`'mockup'`|`'size-chart'` + `file`) TRƯỚC, lấy URL trả về rồi mới gộp vào cùng 1 PATCH `updateProductConfig` với các field khác. Lỗi upload thì dừng lại, KHÔNG PATCH (giữ nguyên `mockup`/`sizeChartUrl` cũ).

**Backend** (`product-config.service.ts` + `product-config.controller.ts`) — **lưu LOCAL DISK trên server API, KHÔNG qua S3/Backblaze** (khác hẳn `/v1/upload/image` ở module `upload/` hiện có — module đó cần `AWS_S3_*`/`BACKBLAZE_*` credentials mà môi trường dev **chưa cấu hình** (rỗng trong `.env.development`) → gây 500 nếu dùng; quyết định chuyển sang local disk sau khi xác nhận với người dùng):
- `POST /v1/product-configs/upload-image` (`uploadProductImage()`) — validate `mimetype` (chỉ jpg/png/webp) + size tối đa 8MB (`BadRequestException` nếu sai) → lưu vào `apps/api/src/assets/uploads/products/{mockup|size-chart}/{myNanoid()}.{ext}` (`fs.promises.mkdir` + `writeFile`) → trả **URL tuyệt đối** trỏ vào endpoint serve bên dưới, dựng từ chính request (`${req.protocol}://${req.headers.host}/api/v1/product-configs/uploaded-image/{folder}/{filename}`) — bắt buộc tuyệt đối vì FE/API khác origin.
- `GET /v1/product-configs/uploaded-image/:folder/:filename` (`serveProductImage()`, **public** `@Auth([], [], { public: true })` — bắt buộc vì `<img src>` không gửi kèm JWT) — đọc file qua `StreamableFile`/`createReadStream`, `resolveProductImagePath()` chặn path traversal (whitelist `folder` ∈ {mockup, size-chart} + regex filename khớp đúng format tự sinh).
  > ⚠️ **KHÔNG dùng `ServeStaticModule` sẵn có** (`rootPath: ./src/assets` ở `app.module.ts`) để serve ảnh upload — đã thử và **KHÔNG hoạt động**: `@nestjs/serve-static`'s `FastifyLoader` đăng ký `@fastify/static` với `wildcard: false`, nghĩa là nó chỉ tự động tạo route cho các file **ĐÃ TỒN TẠI lúc server khởi động** (quét thư mục 1 lần khi boot); file tạo ra lúc runtime (mọi lượt upload) không có route, request rơi vào SPA fallback (`index.html` rỗng của `serve-static` — trả về 200 OK nhưng Content-Length 0, KHÔNG phải 404) → ảnh "upload thành công nhưng không hiển thị được". Do đó bắt buộc phải có endpoint serve riêng đọc file động mỗi request thay vì dựa vào static middleware.
  > ⚠️ **Route serve BẮT BUỘC có `@Header('Cross-Origin-Resource-Policy', 'cross-origin')`** — `helmet()` (`main-nest.ts`) mặc định set `Cross-Origin-Resource-Policy: same-origin` toàn cục; vì web app (`:5173`) và API (`:3007`) khác origin, trình duyệt sẽ **chặn hiển thị ảnh khi nhúng qua `<img>`** dù mở thẳng URL trong tab mới vẫn load bình thường (CORP chỉ chặn cross-origin embed, không chặn navigation trực tiếp — dễ gây nhầm lẫn khi debug). Override riêng route này thay vì đổi config helmet toàn cục.
- Thư mục `src/assets/uploads/` đã thêm vào `.gitignore` (file upload là runtime data, không commit). Deploy (`deploy.sh`) chỉ `git reset --hard` (KHÔNG `git clean`) nên file untracked này sống sót qua deploy bình thường trên cùng server; KHÔNG có redundancy như S3 nếu server bị rebuild/di dời.
- Mỗi sản phẩm chỉ 1 ảnh mockup + 1 ảnh bảng size (upload mới ghi đè giá trị field trong form, **KHÔNG xoá file cũ** trên đĩa — chấp nhận rác tích lũy, giống hành vi cũ khi còn dùng S3).

**Frontend:** `RepositoryRemote.productConfig.uploadProductImage(formData)` (`apps/web/src/services/productConfig.ts`) gọi endpoint trên — **tách biệt hoàn toàn** với `RepositoryRemote.upload.uploadImage()` (S3, vẫn còn trong codebase cho mục đích khác, không dùng cho product mockup/size-chart nữa).

**`printArea`** (vị trí in) — mỗi phần tử là **object giàu** (`ProductPrintAreaItemZod`, mirror `print_areas[]` hệ cũ — đổi từ mảng string 2026-08) nhưng `key` vẫn **CỐ ĐỊNH** (KHÔNG free-text, KHÔNG cho tự gõ) — danh mục toàn bộ vị trí in khả dĩ định nghĩa **constant trong code** ở `packages/shared/constants/product-print-area.ts`:
- `PRODUCT_PRINT_AREAS: {key, label}[]` — derive **tự động** từ `DesignFieldsZod.shape` (`packages/shared/dtos/production-order.dto.ts`, field `order.designs`) + map nhãn tiếng Việt cố định (`PRINT_AREA_LABELS`, TypeScript ép kiểu `Record<ProductPrintAreaKey, string>` nên thêm/xoá key trong `DesignFields` mà quên cập nhật nhãn sẽ **fail compile**).
- `ProductPrintAreaItemZod` = `{key (enum cố định), templateUrl?, widthPx?, heightPx?, isRequired?, additionPrice?, isEmbroidery?, sizeDimensions?}` (`sizeDimensions` = PRD-7, `ProductPrintAreaSizeDimensionZod.array().max(50)` + `.refine()` chặn trùng `size` không phân biệt hoa thường; trần rộng lấy từ hằng dùng chung `PRINT_AREA_MAX_WIDTH_CM` ở `packages/shared/constants/product-print-area.ts` — đừng chép số 58 ra chỗ khác); `ProductConfig.printArea` = `ProductPrintAreaItemZod.array().max(30)` + `.refine()` chặn trùng `key`. Kèm 2 field cấp sản phẩm `printDocument`/`printTemplate` (URL — parity `print_document`/`print_template` hệ cũ).
- **Quy ước `isRequired`**: KHÔNG set (undefined) coi như **bắt buộc** — consumer check `isRequired !== false`. Data cũ dạng bare string key được **backfill 1 lần** ở `ProductConfigService.onModuleInit()` thành `{key, isRequired: true}` (idempotent, match `'printArea.0': {$type:'string'}`).
- **Lý do key chọn constant thay vì free-text** (`key`+`label`+`designKey` tự gõ ở bản đầu): `designKey` phải khớp CHÍNH XÁC 1 field trong `DesignFields` mới có ý nghĩa (nếu không sẽ trỏ tới field design không tồn tại) — gõ tay dễ sai chính tả và không thể phát hiện lỗi cho tới khi tích hợp API thực tế. Khoá cứng theo danh mục loại bỏ hẳn lớp lỗi này; nhãn hiển thị là hàm thuần của key (không cần lưu lặp lại theo từng sản phẩm).
- UI trang chi tiết (section ④): **checkbox grid** liệt kê toàn bộ `PRODUCT_PRINT_AREAS` (tick mới → default `isRequired: true`), bên dưới là **card cấu hình từng vị trí đã tick** (`updatePrintAreaItem`): templateUrl + widthPx/heightPx + additionPrice + checkbox "Bắt buộc design"/"Vị trí thêu"; đầu section có 2 input URL `printDocument`/`printTemplate` (i18n `detail.printAreaConfig.*`).
- **Kích thước in theo size (PRD-7)** — cuối MỖI card vị trí in, khối **thu gọn mặc định** (`openSizeDims`, tự MỞ khi vị trí đó đã có dữ liệu): 1 sản phẩm tick được cả 18 vị trí × chục size nên mở hết là trang không dùng nổi. Tiêu đề khối luôn hiện `{{filled}}/{{total}} size đã nhập` để biết vị trí nào còn thiếu mà không phải mở ra. Mỗi size 1 hàng `[Size] [Rộng (cm) · tối đa 58] [Dài (cm)]`. Danh sách size lấy từ `variations[].attributes` qua **hàm dùng chung** `collectVariationSizes` (`packages/shared/constants/variation-attribute.ts`): nhận nhãn **"Item Size"** hoặc **"Size"** (trim, không phân biệt hoa thường); sản phẩm có CẢ HAI thì **ưu tiên "Item Size" và bỏ qua nhãn còn lại, KHÔNG gộp** — gộp hai bảng size của cùng một sản phẩm sinh ra size không có thật. Giữ **thứ tự xuất hiện** chứ không sort chữ cái (S/M/L/XL sort chữ cái ra L/M/S/XL, vô nghĩa với người xưởng). Cùng file còn giữ luật nhãn **màu** (`Màu`/`Color`/`Colour`) — API Design Review (Orders.md §18.4b) gọi ĐÚNG file này để ghép SKU biến thể, hai bên nhận diện lệch nhau là nhập được kích thước mà API trả rỗng, sai im lặng. Luật chốt 2026-08-21: dữ liệu thật có **159 sản phẩm dùng "Item Size"** và chỉ 9 dùng "Size". Chưa có size nào → 1 dòng chỉ đường sang khu ③ thay vì bảng rỗng. Chữ thô từng ô giữ ở state riêng `sizeDimDraft` (KHÔNG dùng `<input type="number">`) để ô gõ bậy `abc`/`-5` vẫn hiện nguyên chữ và báo lỗi được; chỉ cặp rộng+dài HỢP LỆ mới vào `printArea.sizeDimensions`. `handleSave` soát HẾT ô trong một lượt (số ≤ 0, rộng > 58, nửa cặp thiếu chiều kia) → viền đỏ + dòng lỗi tại từng ô, tự mở khối của vị trí có lỗi, toast đếm số ô sai, **chặn lưu**. Bỏ tick 1 vị trí in → `togglePrintArea` gỡ cả item nên kích thước của riêng vị trí đó đi theo, vị trí khác không ảnh hưởng. Ghi chú thiết kế: `.devtasks/design/PRD-7/ui-note.md`.
- API catalog khách hàng (`CustomerCatalogService.mapRow()`) resolve mỗi item thành `{key, label, templateUrl, widthPx, heightPx, isRequired}` qua `PRODUCT_PRINT_AREA_LABEL_MAP` (xem `CustomerCatalogPrintAreaZod` — KHÔNG trả `additionPrice`/`isEmbroidery`), chịu được cả data bare-string chưa backfill; response thêm `printDocument`/`printTemplate`. Customer Portal dùng: `orders/new.tsx` chỉ bắt buộc design vị trí `isRequired !== false` (vị trí optional hiện "(không bắt buộc)", bỏ trống không gửi key rỗng vào `order.designs`) + hint link template/kích thước px dưới mỗi ô design (cả `track.tsx`); trang chi tiết catalog hiện kích thước px cạnh nhãn vị trí + 2 link "Tải template thiết kế"/"Tài liệu hướng dẫn design".

### 2.4b Dòng sản phẩm `productLine` (PRD-8, 07/09/2026)

Trục phân loại **seller nhìn** (menu/tab/lọc/facet của Seller Portal `apps/seller`), 6 giá trị enum `packages/shared/enums/product-line.ts`: `3d` · `2d` (gồm cả DTG lẫn DTF) · `wood` (Gỗ) · `embroidery` (Thêu) · `led` · `canvas`. **KHÁC** `printMethod` (workshop_config `print_method` dtg/dtf/sublimation/embroidery) — đó là kỹ thuật của xưởng và vẫn là nguồn logic DTF ở tool duyệt thiết kế (Orders.md §DTF); hai trường sống song song.

- ⚠️ **DTG/DTF trong dòng `2d` CHỈ nằm trong TÊN sản phẩm, không nằm trong dữ liệu** (đo production 01/10/2026: 3/15 sản phẩm dòng `2d` có `printMethod`, đều `dtf`; 12 còn lại để trống — vd "…5000 DTG PRINT" không có `printMethod`). Hệ quả: hiện KHÔNG lọc/đếm được DTG riêng với DTF; menu ghi "2D (DTG/DTF)" là đúng với `productLine=2d`. Muốn tách thì phải điền `printMethod` trước.
- Field: `ProductConfig.productLine` (enum, index) + `productLineSource` ∈ `manual | collection | factory | machineType | printMethod | default`. Admin đặt tay ở trang chi tiết (mục Phân loại, cạnh Danh mục) → BE ghi `productLineSource='manual'` (`ProductConfigService.updateProductConfig`). Tab danh sách có filter "Dòng sản phẩm" (kèm `none` = chưa gắn) + "Nguồn gán dòng" + cột "Dòng SP" (badge màu, chấm vàng khi `default`) — `apps/web/src/pages/products/ProductConfigTab.tsx`, util `apps/web/src/utils/productLine.ts`, i18n `products.json` `productLines.*` / `productLineSources.*`.
- **Backfill 1 lần** `ProductConfigService.backfillProductLines()` (gọi trong `onModuleInit` sau `migrateDesignReviewCodes`, cờ `system_configs.key='PRD-8:product_line_backfill_v1'` cùng khuôn claim/stale; xoá cờ để chạy lại). Luật suy luận — hàm thuần `product-line-migration.ts` `inferProductLine()` (+ spec): collection (`3d`→3d, `2d`→2d, `embroidery`→thêu, `handmade-wood|wood`→gỗ; nhiều collection → thêu > gỗ > 2d > 3d) → xưởng `TNW`→gỗ, `MLDTF`→2d → phòng máy `HT`→thêu → `printMethod` `embroidery|EMB`→thêu, `dtf|dtg`→2d → còn lại **3d + `source=default`**. Sau sản phẩm: `orders.productLine` (theo `productConfigId`; đơn không map theo EMB/xưởng/phòng/3d) và `customer_orders.items[].productLine` (arrayFilters theo `productConfigId`). Kết quả dev (bản sao prod 06/09): 196 sản phẩm (174 từ collection, 22 mặc định — danh sách lưu trong cờ `defaultedList`), 50.831 đơn, 37.672 staging. LED/Canvas chỉ gán tay.
- Lan tỏa: `OrderEntity.productLine` (stamp ở `importOrders`: ưu tiên config đã map, không thì dòng khách gửi), `CustomerOrderItem.productLine` (stamp ở `placeOrder`/`importOrdersCsv` từ config resolve; `pushToProduction` chuyển sang `importRows`; item cũ derive từ đơn sản xuất lúc đọc), `CustomerStagingOrder.productLines[]` (distinct), `GET /customer/orders?productLine=` (đơn có ≥1 item thuộc dòng), `GET /customer/orders/counts` → `byProductLine`, catalog `GET /customer/catalog?productLine=` + facet `productLines`, `GET /public/track/:id` → `product.productLine`. Agent registry khai field ở `product-configs.registry.ts`/`orders.registry.ts`.

### 2.5 Biến thể (`variations`)

Tab **"Biến thể"** (ở trang chi tiết, dạng bảng — xem §2.1) — mỗi sản phẩm có danh sách biến thể, mỗi biến thể có SKU riêng **unique toàn hệ thống** (Mongo unique+sparse index trên `variations.sku`; trùng SKU với sản phẩm khác → 400 "SKU biến thể đã tồn tại ở sản phẩm khác", xử lý ở `product-config.service.ts` qua `isDuplicateVariationSkuError()`). **KHÔNG định nghĩa cứng field màu/size** — `attributes` là danh sách key-value tự do (cùng shape với `itemSpecifics`: `{label, value}`), admin tự đặt tên thuộc tính (VD: "Màu"/"Đỏ", "Size"/"M", hoặc bất kỳ tên nào khác); UI KHÔNG sửa attributes trực tiếp từng dòng nữa — attributes sinh/đồng bộ qua **nhóm option** (xem đoạn "UI nhóm option" bên dưới); cột option trong bảng hiển thị read-only theo nhóm. `cost`/`nonShipCost` là giá vốn nội bộ — **tuyệt đối không trả ra Customer Portal** (xem `CustomerCatalogVariationZod` chỉ có `attributes`/`retailPrice`/`discountedPrice`). `retailPrice` là giá bán niêm yết dùng làm gốc tính discount ở module Promotion (`Promotion.md`). `status` Active/Inactive để tạm ẩn biến thể khỏi catalog khách hàng mà không cần xoá.

**SKU tự sinh (KHÔNG sửa tay qua UI):** cột SKU trong bảng biến thể ở trang chi tiết luôn hiển thị read-only — biến thể MỚI (chưa có sku lưu DB) tự tính preview theo `computeVariationSku()` = `{sku sản phẩm}-{giá trị thuộc tính 1}-{giá trị thuộc tính 2}…`, lưu đúng giá trị này khi bấm Lưu; biến thể ĐÃ CÓ sku (load từ DB) luôn hiển thị nguyên giá trị DB, KHÔNG tự tính lại dù sau đó sửa `attributes` — mục đích ép theo quy ước mặc định nhưng vẫn cho phép admin sửa trực tiếp trong database (VD: mapping SKU với hệ thống cũ) mà không bị UI ghi đè lại. **SKU luôn "không dấu"** — `removeDiacritics()` (`apps/web/src/pages/products/productForm/variantUtils.ts`, cùng file `computeVariationSku()`) normalize NFD + bỏ combining marks + map riêng `đ/Đ`→`d` (không decompose qua NFD) + uppercase + chỉ giữ `A-Z0-9` (loại khoảng trắng/ký tự đặc biệt), áp dụng cho cả SKU sản phẩm lẫn từng giá trị thuộc tính trước khi ghép. Nếu sản phẩm chưa có `sku` (top-level), UI hiện cảnh báo màu amber khuyến khích đặt SKU sản phẩm trước để tránh trùng SKU biến thể giữa các sản phẩm khác nhau.


**UI nhóm option (mirror form hệ cũ, xếp DỌC full-width):** section ③ là dãy **card nhóm variant** (`productForm/VariationItem.tsx`) 2 trạng thái — *collapsed* (nền xám: tên nhóm + chip option tròn + nút ✏️ mở lại) và *editing* (form "Variant Name" + danh sách input "Option" sửa tại chỗ/🗑 từng dòng + ô trống cuối gõ Enter/dấu phẩy hoặc dán "Red, Blue, Green" để thêm + nút "+ Add option" + nút **Done**; **Enter trong 1 ô option = tự chèn ô rỗng ngay dưới + focus vào đó** — `insertOptionAfter()` + `pendingFocus` ref). Bấm **Done** validate (tên bắt buộc, không trùng tên nhóm khác, ≥1 option, không trùng option) rồi **TỰ ĐỘNG regenerate** bảng variants (`regenerate()` ở `detail/index.tsx` — không còn nút "Tạo biến thể" riêng; xóa nhóm cũng regenerate; nhóm khác đang soạn dở thì đợi Done hết mới sinh). Link "+ Add Variant" thêm nhóm mới (mở sẵn editing, tối đa `VARIANT_GROUP_MAX=3`). Cạnh đó là nút **"✨ Tạo nhanh biến thể"** (`productForm/BulkGeneratePopover.tsx` — khôi phục popover hệ cũ): mỗi dòng 1 thuộc tính (tên + giá trị cách nhau dấu phẩy, placeholder gợi ý Size/Mẫu-Màu/Loại) + "Thêm thuộc tính" + nút "Tạo N biến thể" (N = tổ hợp nhóm hiện có × dims, disable khi chưa hợp lệ) — bấm tạo là dims thành nhóm option nối vào sau nhóm hiện có rồi regenerate (validate trùng tên/quá 3 nhóm/quá 200 tổ hợp; card soạn dở đang mở bị thay bằng dims). Dưới cùng: heading **"Danh sách biến thể"** + badge count + nút **Batch Edit ⌄** (mở `BatchEditDialog`) + bảng variants full-width. Nhóm option **KHÔNG lưu schema riêng** — suy từ `variations[].attributes` khi load (`deriveGroups()`) và ghi ngược thành `attributes` khi generate (`generateVariants()` trong `productForm/variantUtils.ts`, khóa so khớp sort theo label). **DIFF-PRESERVE**: tổ hợp đã có giữ nguyên giá/SKU, tổ hợp mới thêm dòng `sku=''` (tự sinh lúc lưu), variants "mồ côi" giữ cuối bảng tô amber để user tự quyết. Giới hạn `VARIANTS_MAX=200` khớp schema. Cột option đầu trong bảng **gom theo run** (giá trị lặp với dòng trên không in lại), header option uppercase.

**Bảng variants KHỚP CỘT hệ cũ** ("Variations & Price (9)"): `[cột option động] | SKU (read-only tự sinh) | Cost | EXP US/TIKTOK US (2 ô ship cost EXP/TT) | Non-Ship | Wholesale | EXP US $ | TT US $ | Package (Weight/W/H/L 4 ô gọn) | Bán (Switch) | 🗑`. **Batch Edit INLINE** (`productForm/BatchEditBar.tsx` — KHÔNG còn dialog): nút "Batch Edit ⌄/⌃" cạnh heading "Danh sách biến thể" toggle 1 thanh trên bảng gồm **multi-select mỗi nhóm option** (Popover checkbox, nhãn "Tất cả - {tên}" / "{n} - {tên}") + 11 ô giá/phí + select trạng thái + nút **Apply** (disable khi chưa nhập gì) + nút **Clear** (xóa cả bộ chọn lẫn ô nhập). **Chọn tới đâu bảng dưới LỌC tới đó** (`matchesSelection()` + prop `rowFilter` của `VariantsTable`, index gốc giữ nguyên để update đúng dòng); Apply ghi đè field có nhập lên các dòng khớp, ô bỏ trống giữ nguyên. **Option/nhóm rỗng bị loại hoàn toàn** (`cleanGroups()` ở `variantUtils.ts`): dòng option thêm nhưng chưa điền + nhóm đang soạn dở KHÔNG vào bảng, KHÔNG sinh tổ hợp, KHÔNG làm dòng nào bị tính mồ côi — trang truyền `effectiveGroups` (đã clean) cho bảng/batch, `groups` raw chỉ dùng cho card đang sửa. **Perf**: mỗi dòng là `VariantRow` bọc `React.memo` + update qua functional `setVariations` (`useCallback` ổn định) → gõ giá 1 ô chỉ re-render dòng đó (200 dòng × ~12 input không còn lag); ô nhập của BatchEditBar giữ state cục bộ nên gõ không re-render trang.

Cột `fabricType` cho phép admin set sẵn loại vải mặc định — khi import order khớp `type` → product, BE auto-copy vào order (chỉ insert, không ghi đè) để Workshop view group được.

Cột `toolResult` **KHÔNG còn được auto-copy vào order lúc import nữa** (API OnosPod lẫn CSV) — đơn mới luôn tạo với `toolResult` rỗng để tool tự động soát (`GET /v1/orders/design-review/next`) nhận diện đúng đơn chưa soát, xem `Orders.md §3.3`. Cột này ở Products chỉ còn ý nghĩa cấu hình/hiển thị, KHÔNG ảnh hưởng đơn mới. UI bảng config vẫn giữ dropdown chọn fabric / tool inline (không đổi UI Products).

### 2.6 Kanban gán xưởng theo sản phẩm (mục `/adm/settings/product-factory`)

`apps/web/src/components/settings/ProductFactoryKanban.tsx` — section trong trang Settings (`apps/web/src/pages/settings/index.tsx`, gate `role.manage` chung với các config khác), thay cho việc chọn `<select>` Xưởng từng dòng ở bảng Config khi cần chuyển hàng loạt.

- **Layout:** cột đầu **"Chưa xác định xưởng"** + 1 cột / factory — UI mirror `CustomerFactoryKanban.tsx` (dnd-kit, cột 70vh cuộn trong, highlight cột xưởng khi kéo qua; cột "Chưa xác định xưởng" KHÔNG droppable — chỉ là nguồn kéo đi). Card = mockup thumbnail 36×36 (fallback icon ảnh) + `fullName` + `shortName`; vị trí xưởng hiện tại = cột đang đứng. Sort A→Z theo `fullName` trong cột.
- **Cột "Chưa xác định xưởng"** chứa 2 loại card:
  - Config đã tồn tại nhưng `factoryId` rỗng / trỏ xưởng đã xóa — kéo sang xưởng = PATCH như thường.
  - **Pending type (card vàng, viền đứt):** loại sản phẩm quét từ đơn nhưng CHƯA có config — chỉ xuất hiện sau khi bấm **nút "Sync sản phẩm chưa có xưởng (14 ngày)"** → `GET /v1/product-configs/unmatched-order-types?days=14` (`ProductConfigService.getUnmatchedOrderTypes()`: aggregate đơn 14 ngày gần nhất theo `inProductionAt` fallback `createdAt`, loại đơn hủy/xóa, group `type` case-insensitive, loại các type khớp `fullName` config, sort số đơn giảm dần). Card hiển thị `type` + badge **"N đơn / 14 ngày"** để biết khối lượng. State client-side, F5 mất — bấm Sync lại.
- **Kéo pending type vào cột xưởng → TẠO NGAY Product Config tối thiểu** (`POST /v1/product-configs` với `fullName` = type, `shortName` ĐỂ TRỐNG — ORD-3 không auto-sinh, `factoryId` = cột thả) — `machineTypeId` đã nới thành **optional** trong entity + `ProductConfigZod` để cho phép việc này; toast nhắc bổ sung Loại máy ở trang Products. Lỗi tạo → trả card về cột chờ — gồm cả 400 trùng tên khi danh sách pending đã cũ (ai đó vừa tạo config cùng tên sau lần Sync; đường nghi sinh config trùng 21–22/09/2026, chưa xác minh).
- **Search:** 1 ô tìm client-side theo `fullName`/`shortName` (pending type theo `type`), lọc mọi cột (header cột hiển thị `visible/total`).
- **Lưu:** kéo thả config sang cột khác → **PATCH `/v1/product-configs/:id` `{ factoryId }` lưu NGAY** (update lạc quan + toast, lỗi thì refetch rollback) — KHÔNG có nút Lưu/dirty guard như CustomerFactoryKanban. Cùng ràng buộc §2.1: chỉ ảnh hưởng đơn import về sau; **đơn tồn unmapped gán bằng nút "Tự động gán xưởng" ở trang Không xác định xưởng** (`POST /v1/orders/remap-unmapped` — xem `Orders.md §19`).
- **Data:** load 1 lần `GET /v1/factories` + `GET /v1/product-configs?page=1&limit=2000` + `GET /v1/machine-types?limit=200` (cho Export); nếu `total > 2000` → hiện text cảnh báo amber.
- **Tooltip + preview ảnh:** hover title card → tooltip tên đầy đủ (attr `title` native — `fullName` bị `truncate`); click **thumbnail mockup** → mở `ImagePreviewDialog` (stopPropagation ở `onPointerDown` để dnd-kit không bắt drag khi bấm ảnh — bấm ảnh = preview, kéo phần còn lại của card = drag như thường).
- **Nút "Lấy ảnh từ Onospod"** (`handleCrawlMockups`): crawl ảnh mockup cho sản phẩm CHƯA có ảnh — FE gọi lặp `POST /v1/product-configs/crawl-mockups {limit:10, cursor}` đến khi `done`, hiện tiến trình inline "Đã quét x, gán ảnh y, còn lại z"; bấm lại khi đang chạy = Dừng (dừng sau lô hiện tại, `crawlStopRef`). Xong → toast tổng kết + refetch để hiện mockup mới. BE `ProductConfigService.crawlMockups()`: query config thiếu mockup sort `_id` tăng + `_id > cursor` (**cursor tiến đơn điệu → sản phẩm đã thử-nhưng-không-khớp KHÔNG bị quét lại**, tránh loop vô hạn); sleep 150ms giữa sản phẩm / 100ms giữa attempt.
  - **`searchOnospod(term)`** dùng **AJAX search JSON của theme** (nhanh + chính xác hơn hẳn parse HTML trang search cũ): `POST https://onospod.com/wp-admin/admin-ajax.php` form `action=onospod_ajax_search_products&query=<term>&security_search=<nonce>&product_cat=` → JSON `[{id, value(tên), url, img(thumbnail -100x100), price}]`; loại item "No results" (`id:-1`) + item thiếu `img`. KHÔNG cần cookie nhưng **CẦN nonce** `security_search` (thiếu → response `-1`): nonce là WP nonce có hạn nên `getOnospodSearchNonce()` tự scrape từ input `security-search` trên trang chủ, **cache module-scope 1 giờ**, response không phải array → refresh nonce 1 lần rồi retry.
  - **Mockup lưu NGUYÊN URL thumbnail `-100x100`** (nhẹ cho thẻ kanban/bảng); xem ảnh to = bỏ hậu tố `-{w}x{h}` qua `apps/web/src/utils/imageUrl.ts` (`toFullSizeImageUrl`) — áp ở `ImagePreviewDialog` kanban, link "xem ảnh" trong `CrawlLogPanel`, và anchor cột Mockup ở `ProductConfigTab`.
  - **`buildNameAttempts(name)`** thử lần lượt: tên gốc → bỏ mã `[...]` ("[PANT] X" → "X") → bỏ tiền tố code viết hoa ngắn đầu tên ("MF All-Over..." → "All-Over...", TRỪ "AOP"). Mỗi attempt so **trùng tên chính xác** (`normalizeProductName`: hoa/thường + mọi dấu gạch coi như space + gộp space — KHÔNG fuzzy) rồi fallback **cùng bộ từ đảo thứ tự** (`normalizeSortedWords` — "Set X" vs "X Set"); không khớp / lỗi → bỏ qua sản phẩm đó.
  - Response trả **chi tiết từng sản phẩm** `results: CrawlMockupResultItem[]` — `status: created|updated|no-match|no-results|error` + `imageUrl`/`matchedTitle`/`foundTitles` (top 3 tên site trả khi no-match)/`note` (vd "khớp sau khi bỏ mã [...]", message lỗi). FE tích lũy qua các lô → **`CrawlLogPanel`** dưới toolbar: chip đếm theo trạng thái + list cuộn (max-h-64) từng sản phẩm với chip màu (Gán mới emerald / Ghi đè sky / Không trùng tên amber kèm tên site trả về / Không có kết quả slate / Lỗi red), link "xem ảnh" + thumbnail; nút Đóng để ẩn.
- **Nút "Export Excel"** (`handleExport`): export toàn bộ config ra `.xlsx` client-side (`XLSX.utils.aoa_to_sheet`) **cùng dạng file "SKU THÁI NGUYÊN-MÊ LINH"**: cột A/E trống, B=`Tên SP`, C=`Tên viết tắt`, D=`Nhà máy` (tên xưởng), F=`Phòng` (tên MachineType); sort theo xưởng rồi tên; file `SKU-product-config.xlsx`.

### 2.3 Import flow (`ImportProductConfigDialog.tsx`)
```
User paste TSV vào textarea
  → parseRows() detect header bằng keyword ("Tên đầy đủ", "Phòng"…) → skip dòng đầu nếu match
  → Preview số dòng hợp lệ
  → Submit → POST /v1/product-configs/import
  → BE upsert by fullName → trả về { imported, updated, skipped[] }
  → Toast: "Imported X, updated Y, Z cảnh báo" + console.warn nếu có skip
```

Schema TSV (7 cột, tab-separated):
```
Tên đầy đủ | Tên viết tắt | Máy | Xưởng | Loại vải | Kết quả Tool | Phòng
```
- **Máy** (`machineNumber`) — vd "94", "27". Empty ⇒ default `toolResult = no-tool`. **Không khớp ⇒ auto-create** entry trong `workshop_config.machine` (code `machine-{slug}`, color xám `#6B7280`); ProductConfig lưu workshop_config code. FE resolve code → name + color qua `workshopConfigStore` để render badge.
- **Xưởng** (`factoryLabel`) — match `FactoryService.findByLabel()`: tolerant với prefix "Xưởng " và case (vd "MÊ LINH" match "Xưởng Mê Linh"). Match shortName trước, fallback regex name.
- **Loại vải** (`fabricLabel`) — match `workshop_config` (category=fabric_type) qua `name` case-insensitive. **Không khớp ⇒ auto-create** entry mới (slugified code, icon `Shirt`, isActive=true) rồi gán cho product. Sau import FE force-reload `workshopConfigStore` để dropdown thấy fabric mới.
- **Kết quả Tool** (`toolResultLabel`) — match workshop_config (category=tool_result). Empty ⇒ default `has-tool` nếu Máy có giá trị. Empty + Máy trống ⇒ default `no-tool`.
- **Phòng** (`departmentLabel`) — match `MachineTypeService.findByLabel()`: shortName trước, fallback name case-insensitive (vd "IN và CẮT LASER" match "In và cắt laser"). Không khớp ⇒ skip dòng.

### 2.7 Import TẤT CẢ sản phẩm từ OnosPod (nút "Import từ OnosPod")

> **File:** `apps/api/src/modules/product-config/onospod-product-import.service.ts` + controller `POST /product-configs/import-from-onospod` (`@Auth([Admin])`) + nút ở toolbar `ProductConfigTab.tsx` (i18n `configTab.onospodImport.*`) + DTOs `ImportFromOnospodDto/Res` (`product-config.dto.ts`).

Kéo TOÀN BỘ catalog từ hệ cũ (GraphQL `productPreset` — `api.onospod.com/graphql`, config env `ONOSPOD_API_URL`/`_BEARER_TOKEN`/`_SUPER_TOKEN` dùng chung `onospodApiConfig` với luồng recover đơn giữ Orders.md §9c; header `origin` BẮT BUỘC kẻo gateway 403):

- **1 REQUEST DUY NHẤT limit 500** (FE gửi `{page:1, limit:500}`) — phân trang bên OnosPod KHÔNG ổn định (thứ tự trượt giữa các lần gọi → trùng + LỌT sản phẩm; verify 2026-08-05: 9 trang × 20 chỉ thu 167 dòng có trùng, thiếu PAOPPOLO; header `x-total` 178 > số dòng thật 167 — nghi gồm record xóa mềm, nên trang trả ÍT hơn limit cũng coi là hết). Service vẫn dedupe theo `_id` phòng hờ; page/limit qua HEADER `x-page`/`x-per-page` (KHÔNG phải biến GraphQL). Filter provider/collection để RỖNG = lấy tất cả.
- **Biến thể mặc định cho sản phẩm không có nguồn giá** — bước cuối (khi `nextPage` null) `ensureDefaultVariations()`: mọi config còn trống `variations` (kể cả sản phẩm KHÔNG có bên OnosPod, vd "Embroidered Sweatshirt") được tạo 1 biến thể `{SKU|shortName chuẩn hóa}-DEFAULT` (không attributes, CHƯA có giá) → đủ điều kiện hiện catalog khách + đặt đơn (giá hiển thị "—"); admin nhập `retailPrice` ở trang chi tiết section ③. Idempotent; đụng unique `variations.sku` → retry suffix random; response `defaultVariationsCreated` + toast riêng ở FE.
- **Upsert FILL-ONLY** — khớp sản phẩm hiện có theo `sku` (uppercase) rồi `fullName` (exact, case-insensitive); đã tồn tại → CHỈ `$set` field đang trống (`FILLABLE_FIELDS`), **TUYỆT ĐỐI KHÔNG đụng** `factoryId`/`machineTypeId`/`machineNumber`/`fabricType`/`toolResult`/`level`/`guide`/`status`/`fullName`/`shortName` (xưởng hiện tại là CHUẨN — quyết định 2026-08-05); chưa tồn tại → tạo mới KHÔNG factory (tự rơi vào cột "Chưa xác định xưởng" §2.6).
- **Transform** — `attribute_specifics`→`variations` (đủ 7 loại giá + ship EXPRESS_US/SBTT cost + package; attributes label fallback `name || type` vì data thật `name` rỗng); `print_areas`→`printArea` object giàu (§2.4a — key ngoài `PRODUCT_PRINT_AREA_KEYS` bị bỏ); `ProductConfig.shortName` KHÔNG derive nữa — để trống (ORD-3); `collection`/`category` name → find-or-create Collection/ProductCategory (đụng unique `shortName` với entry KHÁC TÊN → retry suffix `-XXXX` random, giữ entry riêng); `visible:false`→`status:inactive`.
- **Tham số `collection` (tuỳ chọn) + dropship** — truy vấn không filter KHÔNG trả collection `dropship` (01/10/2026: 221 dòng, `x-total` 232; riêng `collection:"dropship"` trả 11). Muốn nhập dropship phải gọi tường minh `POST /product-configs/import-from-onospod {collection:"dropship"}` — nút trên UI chỉ gọi không filter. Chưa chạy: hàng mua sẵn chưa có `productLine` đích.
- **`productLine` khi TẠO MỚI** — suy từ collection OnosPod qua `productLineForNew()` (gồm `dropship→dropship`, dòng thứ 7 thêm 04/10/2026) (`product-line-migration.ts`, tái dùng `inferProductLine`): `handmade-wood→wood`, `embroidery→embroidery`, `3D→3d`, `2D→2d`; collection khác (vd `dropship`) để TRỐNG chứ không đoán 3d. Sản phẩm đã tồn tại KHÔNG bị đụng (fill-only).
- **Chống đụng SKU unique** — trùng `sku`/`variations.sku` toàn hệ thống với sản phẩm khác → tạo/fill KHÔNG kèm sku/variations + ghi vào `errors[]` response để xử lý tay.
- Idempotent — chạy lại chỉ fill tiếp field còn trống, sản phẩm đủ data rơi vào `skipped`.

### 2.8 Crawl "Import US Tax" + "Package gram" từ trang WP hệ cũ (nút "Crawl tax & package")

> **File:** `ProductConfigService.crawlPageInfo()` + controller `POST /product-configs/crawl-page-info` (`@Auth([Admin, Manager])`) + nút toolbar `ProductConfigTab.tsx` (i18n `configTab.pageInfoCrawl.*`) + DTOs `CrawlPageInfoDto/Res`.

2 giá trị hiển thị trên trang sản phẩm public hệ cũ nhưng KHÔNG có trong GraphQL `productPreset` (đối chiếu thật 2026-08-06):

- **`ProductConfig.usImportTaxPerUnit`** — "IMPORT US TAX: ${n}/unit", số NHẬP TAY theo sản phẩm bên WP (không suy được từ % `tax_groups` — 3 sản phẩm giá khác nhau cùng $0.40).
- **`variations[].packageGram`** — "PACKAGE: {n}gram", nhập tay theo size (không suy được từ `weight`: weight 90 → package 110, 47 → 60).

Crawl fetch `onospod.com/product/{slug}/` (chỉ sản phẩm CÓ `slug` còn thiếu ít nhất 1 giá trị), parse label baked trong JSON `data-form` của theme; block package có điều kiện `value_field` (vd "48x24") → match với GIÁ TRỊ thuộc tính của từng biến thể, block không điều kiện = áp mọi biến thể. Batch cursor `_id` như crawl-mockups (§2.6); slug 404 (sản phẩm đã gỡ khỏi site cũ) → `error`, cursor vẫn tiến. Kết quả chạy thật local 2026-08-06: 120/165 sản phẩm có tax, 125 có packageGram, ~40 slug 404. 2 giá trị này hiển thị ở Customer Portal detail (CustomerPortal.md §7.1 — info block + bảng Biến thể & Giá).

### 2.9 Import SẢN PHẨM HOÀN CHỈNH từ file (nút "Import sản phẩm từ file")

> **File:** FE `apps/web/src/pages/products/ImportFullProductFileDialog.tsx` (nút toolbar `ProductConfigTab.tsx`, i18n `configTab.importFullButton` + `importFullDialog.*`) → BE `POST /product-configs/import-full` (`@Auth([Admin, Manager])`, `ProductConfigService.importFullProducts()`) + DTOs `ImportFullProductZod`/`ImportFullProductsDto`/`ResDto` (`product-config.dto.ts`) + `findByLabel()` mới ở `ProductCategoryService`/`CollectionService`. Unit tests: `import-full-products.spec.ts`. File mẫu: `Data/Mau-Import-Go-TNW.xlsx` (tab "Import sản phẩm gỗ" + tab Hướng dẫn).

Khác `POST /import` (§2.1 — 6 cột config tối thiểu): nhận sản phẩm ĐỦ catalog + biến thể/giá. Format file (map theo TÊN header, không positional):

- **Biến thể trải NHIỀU DÒNG**: dòng có "Tên SP" = bắt đầu sản phẩm (điền đủ cột catalog + biến thể đầu nếu có SKU); dòng dưới trống Tên SP + có SKU = biến thể tiếp theo.
- Cột: Tên SP\* / Tên viết tắt / Xưởng\* / Phòng\* / Danh mục / Collection (nhiều, phẩy) / Print method / Mockup URL / Ảnh phụ (nhiều URL, xuống dòng hoặc `|`) / Bảng size URL / Mô tả ngắn / Mô tả / Thông số ("Nhãn: giá trị" mỗi dòng → `itemSpecifics`) / Thời gian SX + ship (ngày) / Cân nặng-Rộng-Cao-Dài (đóng gói) / SKU / Màu / Size (→ `attributes`) / Giá vốn / Giá nonship / Giá bán lẻ / Giá sỉ. (\* = bắt buộc thực dụng — Xưởng sai label → skip cả sản phẩm; Phòng/Danh mục/Collection sai → warning + bỏ field.)
- **Upsert theo `fullName`** (exact, trim): sản phẩm đã có → CẬP NHẬT, chỉ field CÓ dữ liệu trong file mới ghi đè, `variations` merge theo SKU (biến thể cũ ngoài file giữ nguyên). Tạo MỚI → mặc định `toolResult='no-tool'` (file không có cột Máy/Tool — cấu hình tool qua §2.1 hoặc trang chi tiết).
- Response `{ imported, updated, skipped[{product,reason}], warnings[{product,reason}] }`; SKU biến thể trùng sản phẩm khác (E11000) → skip + lý do.
- Dialog FE: quét mọi sheet, nhận sheet đầu tiên có header "Tên SP" KÈM cột SKU/Danh mục/Mockup (phân biệt với sheet file SKU §2.1); preview badge Tạo mới/Cập nhật; ảnh phải là URL sẵn (không bulk-upload file ảnh).

---

## 3. Tab `Xưởng` (`apps/web/src/pages/products/FactoryTab.tsx`)

### 3.1 Layout
3 bảng xếp dọc (`space-y-6`) — Xưởng / Loại máy dùng CHUNG 1 form generic (`FormState.type: 'factory' | 'machineType'`, `renderTable()` tái dùng cho cả 2), Loại vải render riêng (icon picker):
- **Xưởng** (Factory) — CRUD shortName/name/isActive
- **Loại máy** (MachineType / Phòng) — CRUD shortName/name/isActive
- **Loại vải** (Fabric — workshop_config category=fabric_type) — CRUD code/name/icon/isActive, dùng `IconPicker` và slugify tự động. Sync `workshopConfigStore`. Đây là **cùng dataset** với tab Loại vải ở trang Workshop Config, đặt ở đây để admin tiện thao tác sau khi import. Có nút **"Reset từ seed"** → `POST /v1/workshop-config/reset/fabric_type` hard-delete toàn bộ category rồi re-insert 22 fabric từ `WORKSHOP_CONFIG_SEED` (POLY 2 DA, MÈ 64, LỤA 4B, LỤA VÂN GỖ, THUN LẠNH, NỈ BÔNG, MÈ CARO, LỤA NGỌC TRAI, LƯỚI, THÔ MỘC, LỤA, CANVAS, THUN BỘT, PHI BÓNG, 60% COTTON 40% POLY, LÔNG- CHĂN, ÁO: LỤA 4B- QUẦN: MÈ CARO, VẢI MÈ MỚI, MIX VẢI + LƯỚI, MÈ CA SẤU, THÊU, GIẢ LEN).

### 3.2 Factory CRUD
| Field | Type | Validation |
|-------|------|------------|
| `name` | string | Required, trim |
| `shortName` | string | Required, uppercase, unique |
| `isActive` | boolean | Default true (switch toggle) |
| `flowType` | `'standard' \| 'merged' \| 'no-sew'` | Default `standard`. Select "Luồng sản xuất" (chỉ hiện với factory, không hiện với machineType). `merged` (xưởng gỗ) = In xong → Ép tự xong, May vào xong → May ra tự xong; `no-sew` (Mê Linh) = QC sau ép xong → May vào + May ra tự xong → chờ Đóng hàng — xem [`FulfillmentWorkflow.md`](FulfillmentWorkflow.md) §2.2b. Bảng hiện badge "Rút gọn (gỗ)" / "Bỏ may". Enum + helper: `packages/shared/enums/factory-flow.ts` (`FACTORY_FLOW_AUTO_STAGES`/`isAutoStage`/`redirectAutoTarget`). |

### 3.3 MachineType CRUD
| Field | Type | Validation |
|-------|------|------------|
| `name` | string | Required, trim |
| `shortName` | string | Required, uppercase, unique |
| `isActive` | boolean | Default true |

### 3.4 Auto-seed
Khi BE khởi động, `FactoryService.onModuleInit()` + `MachineTypeService.onModuleInit()` insert các bản ghi mặc định nếu **shortName chưa tồn tại** (per-record check, không check total). Mặc định:
- **Factory:** PT, ZK, GG
- **MachineType:** DTG, DTF, EMB, SUB

---

## 4. Tab `Danh mục` (`apps/web/src/pages/products/ProductCategoryTab.tsx`)

Tab riêng cấp ngang hàng Config/Xưởng (KHÔNG lồng trong tab Xưởng — dễ tìm hơn). CRUD 1 bảng đơn giản, cùng pattern Factory/MachineType nhưng KHÔNG dùng chung generic form (component độc lập, tự quản state).

Backend module riêng `apps/api/src/modules/product-category/` **KHÔNG dùng workshop_config** — cùng pattern hệt Factory/MachineType (entity + repository + service + controller + module, xem `factory.entity.ts` làm template). Lý do tách riêng: danh mục sản phẩm là khái niệm catalog/bán hàng (không phải cấu hình vận hành xưởng), cần tham chiếu ổn định qua `_id` từ cả `ProductConfig` (§2.4) lẫn `Promotion` (`scope='category'`, xem `Promotion.md`).

**Đa cấp độ (cây danh mục):** `parentId` tự tham chiếu (self-ref, optional — không có = danh mục gốc) cho phép lồng không giới hạn độ sâu (VD: Áo/Quần → Áo → Áo thun). API vẫn trả **FLAT list** (không nest lồng nhau trong response) — FE tự dựng cây + tính `depth` qua `apps/web/src/utils/categoryTree.ts` (`sortCategoryTree()`, depth-first, cha trước con, có guard chống vòng lặp dữ liệu lỗi). `ProductConfig.productCategoryId` (§2.4) có thể trỏ tới **BẤT KỲ cấp độ nào** trong cây (không bắt buộc node lá).

```ts
// ProductCategoryEntity
{
  name: string;         // Required, trim
  shortName: string;    // Required, uppercase, unique — index
  isActive: boolean;    // Default true
  parentId?: ObjectId;  // ref ProductCategoryEntity (self) — undefined = danh mục gốc
}
```

| Method | Path | Quyền | Mô tả |
|--------|------|-------|-------|
| GET | `/v1/product-categories` | Admin/Manager | List + phân trang + filter `isActive`/`search` (flat, chưa nest) |
| POST | `/v1/product-categories` | Admin/Manager | Tạo — trùng `shortName` → 400; `parentId` không tồn tại → 404 |
| PATCH | `/v1/product-categories/:id` | Admin/Manager | Update — validate `parentId` tồn tại (404) + **chặn vòng lặp** (`assertNoCycle()` trong `product-category.service.ts`: đi ngược chuỗi cha của `parentId` mới, gặp lại chính node đang sửa → 400 "Không thể chọn danh mục con của chính nó làm danh mục cha") + `parentId === id` → 400 ngay lập tức |

`ProductCategoryService.onModuleInit()` seed 4 mặc định nếu **shortName chưa tồn tại**: APPAREL (Áo/Quần), MUG (Ly/Cốc), HOME-DECOR (Trang trí nhà), ACCESSORY (Phụ kiện) — đều là danh mục gốc (không `parentId`).

`ProductConfigService.createProductConfig()`/`updateProductConfig()` validate `productCategoryId` tồn tại (404 nếu không, qua `ProductCategoryService.getProductCategory()`) khi client gửi giá trị — tương tự validate `factoryId`/`machineTypeId`. Validate này **không quan tâm cấp độ** — danh mục gốc hay danh mục con đều hợp lệ.

**UI:** bảng ở `ProductCategoryTab.tsx` render theo thứ tự cây (`sortCategoryTree`) + indent theo `depth` (thụt lề `depth*20px` + ký hiệu `└`); dialog thêm/sửa có select "Danh mục cha" (loại trừ chính node đang sửa, cây cũng indent bằng dấu `—` lặp theo depth). Dropdown "Danh mục sản phẩm" ở trang chi tiết sản phẩm (§2.4) dùng chung `sortCategoryTree` để hiện cây khi chọn.

> **Giới hạn đã biết:** giống các field ref optional khác trong repo (VD: `productCategoryId` ở ProductConfig), gửi PATCH với `parentId` rỗng/`undefined` sẽ KHÔNG xoá được `parentId` đã set trước đó (JSON bỏ qua key `undefined` nên field cũ giữ nguyên trong DB) — muốn đưa 1 danh mục con về lại gốc cần sửa trực tiếp trong database. Chưa cần thiết phải sửa (chưa có yêu cầu thực tế), chỉ lưu ý nếu sau này cần bổ sung.

---

## 5. Backend Modules

### 5.1 `product-config/`
| File | Mô tả |
|------|-------|
| `product-config.entity.ts` | Schema + virtual `factory`, `machineType`, `productCategory` |
| `product-config.repository.ts` | Extends `DatabaseRepositoryAbstract` |
| `product-config.service.ts` | Logic CRUD + `bulkUpsert()` |
| `product-config.controller.ts` | 7 endpoints: list / get-by-id / create / update / delete / delete-all / import |

### 5.2 `factory/`, `machine-type/` & `product-category/`
- Cùng pattern: entity + repo + service + controller (xem §4 cho `product-category/`)
- Service có method `findByShortName()` để Product Config resolve trong import flow
- `findByShortName()` được cache (Redis TTL 5 phút) vì lookup nhiều khi import

### 5.3 Cache
- Key: `factories:all`, `machineTypes:all`, `productConfigs:type:{shortName}`
- Invalidate khi create/update/delete

---

## 6. API endpoints

### 6.1 Product Config
| Method | Path | Body / Query | Mô tả |
|--------|------|--------------|-------|
| GET | `/v1/product-configs` | `?page&limit&search&fullName&shortName&fabricType&factoryId&machineTypeId&status` | List + filter. `search` = `$or` trên `fullName`/`shortName`/`sku` (đường cũ, giữ nguyên); `fullName`/`shortName` là 2 điều kiện **riêng** cộng dồn AND (PRD-1); `fabricType=none` = chưa đặt loại vải; không truyền `status` ⇒ loại `hidden` |
| GET | `/v1/product-configs/:id` | — | Lấy 1 sản phẩm (populate `factory`/`machineType`/`productCategory`) — dùng bởi trang chi tiết `/adm/products/:id` |
| POST | `/v1/product-configs` | CreateProductConfigDto | Tạo |
| PATCH | `/v1/product-configs/:id` | UpdateProductConfigDto | Update |
| DELETE | `/v1/product-configs/:id` | — | Soft delete 1 dòng — 400 nếu còn đơn hàng tham chiếu (`type` khớp `fullName`) |
| DELETE | `/v1/product-configs/all` | — | Hard delete toàn bộ (SuperAdmin/Admin) — trả về `{ removed }` |
| POST | `/v1/product-configs/import` | `{ rows: [] }` | Bulk upsert by fullName — dùng bởi cả dialog paste (§2.3) và dialog tải file (§2.1) |
| POST | `/v1/product-configs/crawl-mockups` | `{ limit?=10, cursor? }` | Crawl ảnh mockup từ onospod.com cho sản phẩm chưa có ảnh — theo lô + cursor `_id`, FE gọi lặp đến khi `done` (xem §2.6) |

### 6.2 Factory & MachineType
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/v1/factories` | List all (cache) |
| POST | `/v1/factories` | Create |
| PATCH | `/v1/factories/:id` | Update |
| DELETE | `/v1/factories/:id` | Soft delete |
| GET | `/v1/machine-types` | List all (cache) |
| POST | `/v1/machine-types` | Create |
| PATCH | `/v1/machine-types/:id` | Update |
| DELETE | `/v1/machine-types/:id` | Soft delete |

### 6.3 ProductCategory (§4)
| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/v1/product-categories` | List + phân trang |
| POST | `/v1/product-categories` | Create |
| PATCH | `/v1/product-categories/:id` | Update |

---

## 7. Quan hệ với Order module

Khi `importOrders()` chạy, mỗi order sẽ:
1. Lookup `ProductConfig` theo `type` ↔ `fullName` (trim + case-insensitive — KHÔNG dùng `shortName`)
2. Nếu match → set `productConfigId`, `factoryId`, `machineTypeId` từ config + `isMapped=true`
3. Nếu không match → `isMapped=false`, frontend hiển thị badge "Chưa map"

Tỉ lệ map tốt là tiền đề cho:
- Dashboard `byFactory` chia chính xác
- Workflow điều phối xưởng đúng

---

## 8. Permissions

| Role | Truy cập |
|------|----------|
| Admin | ✅ full CRUD |
| Manager | ✅ full CRUD |
| User thường | ❌ |


## Product Tags (Tags tab + `productTagIds`)

Flat marketing labels (legacy `/product-tag/preset`: Christmas, Bestsellers, Kids…). Differs from `ProductCategory` (structural) and `Collection` (catalog set): a product carries MANY tags.

- **BE:** `apps/api/src/modules/product-tag/` (entity collection `productTags`, unique `shortName`, `image`/`description`/`sortOrder`/`isActive`) — `GET /product-tags` (Admin/Manager/Support), `POST`/`PATCH :id` (Admin/Manager). Same shape as `collection/`.
- **ProductConfig:** `productTagIds: string[]` (ref `ProductTagEntity`), validated in `create`/`update` via `ProductTagService.getProductTag`. Not part of the OnosPod import (no tag data there yet) nor `import-full`.
- **FE:** tab "Tags" on `/adm/products` (`ProductTagTab.tsx`, i18n `productTagTab.*`), multi-select chips on the product detail page (`detail.tagsField.*`), service `services/productTag.ts`, DTOs `packages/shared/dtos/product-tag.dto.ts`.
- **Seed:** `ProductTagService.onModuleInit` creates the 18 legacy tags (`product-tag.seed.ts`, Title + Slug only; matched by shortName so it never duplicates or overrides UI edits).
- **Catalog filter:** `productTagId` on `GetCustomerCatalogDto`, applied in the shared `listCatalog` core (so logged-in `/customer/catalog` AND public `/catalog`); `getFacets()` now returns `tags` (active, count > 0); new public `GET /public/catalog/facets`. UI: pill row in `pages/customer/catalog`, `pages/catalog` (URL param `tag`) and the seller catalog view.
- **OnosPod import:** the legacy `productPreset` query exposes `product_tag_ids` (01/10/2026: 136 of 221 products carry tags, all ids resolve). The importer reads `productTags { _id slug }` once, maps legacy id → slug → our tag by shortName, and fills `productTagIds` FILL-ONLY (only when the product has none). Unknown slugs are skipped, never created. A failed tag fetch is reported in `errors[]`, products still import.
## Product Techniques (Techniques tab + `productTechniqueIds`)

Legacy `/product-technique/preset` (UV, Embroidery, Applique Embroidery, Sublimation, Laser Cut): an INDEPENDENT field from `printMethod` (123 of 221 legacy products carry one). Built exactly like Product Tags:

- **BE:** `apps/api/src/modules/product-technique/` (collection `productTechniques`, same shape/endpoints as tags under `/product-techniques`, seeded on boot from `product-technique.seed.ts`); `ProductConfig.productTechniqueIds` validated in create/update; declared in the Agent API registry `product-configs.registry.ts`.
- **Catalog:** `productTechniqueId` filter in `listCatalog`, `techniques` in `getFacets()` (also via public `GET /public/catalog/facets`); pill rows in customer, public and seller catalogs.
- **OnosPod import:** `product_technique_ids` + `productTechniques { _id slug }` → our technique by shortName, **added to `FILLABLE_FIELDS`** (fill-only: set only when the product has none). Reminder of the import's wider fill-only scope: it also fills other EMPTY fields (incl. `variations` + prices when a product has none, plus a `-DEFAULT` variation at the end) — never factory/machine/status/names/`productLine`.
- **Materials: dropped** (3 of 221 products, see `Plans/LegacyClone-Catalog.md`). If needed later, map by hand into `fabric_type`.
