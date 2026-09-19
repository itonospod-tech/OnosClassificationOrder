import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { PriceZod, PRINT_AREA_MAX_WIDTH_CM, ProductPrintAreaKeyZod } from '@shared/constants';
import { PRODUCT_LINE_SOURCES, PRODUCT_LINES, ProductConfigStatus, Status } from '@shared/enums';
import { BaseEntityZod, PageQueryZod, PageResZod, ResZod } from '@shared/types';
import { z } from 'zod';

import { designAcceptKeys } from '../client';
import { IDZod } from '../constants/common-zod';
import { getObjectValues } from '../utils/getObjectValues';

/** 1 dòng "item specifics" — thuộc tính tự do (VD: "Chất liệu" / "Cotton 100%"). */
export const ProductItemSpecificZod = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
});
export type ProductItemSpecific = z.infer<typeof ProductItemSpecificZod>;

/**
 * 1 vị trí in của sản phẩm — object giàu MIRROR `print_areas[]` hệ cũ
 * (`print`→`templateUrl`, `width`/`height`→`widthPx`/`heightPx`,
 * `is_required`→`isRequired`, `addition_price`→`additionPrice`,
 * `is_embroidery`→`isEmbroidery`). `key` vẫn CỐ ĐỊNH trong
 * `PRODUCT_PRINT_AREAS` (`packages/shared/constants/product-print-area.ts`,
 * map 1-1 với `DesignFields`/order.designs) — KHÔNG cho tự gõ key/label,
 * nhãn hiển thị resolve từ constant.
 */
/**
 * PRD-7 — kích thước in THẬT của một vị trí in ở MỘT size sản phẩm, đơn vị **cm**.
 *
 * Cộng THÊM vào `widthPx`/`heightPx` chứ không thay thế: hai trường px kia mirror
 * `print_areas[].width/height` hệ cũ và đang mang dữ liệu import OnosPod. Ở đây
 * dùng cm vì xưởng và giấy DTF đều nói bằng cm; quy đổi cm → px theo DPI là việc
 * của tool dựng file (ORD-6), KHÔNG phải của cấu hình này.
 *
 * `size` là chuỗi lấy từ thuộc tính "Size" của `variations[]` — KHÔNG cho gõ tự do
 * ở giao diện, để sau này ghép với size của đơn không bị lệch chính tả.
 */
export const ProductPrintAreaSizeDimensionZod = z
  .object({
    size: z.string().min(1).max(60).trim(),
    /** Chiều rộng (cm). */
    widthCm: z.coerce.number().positive(),
    /** Chiều dài (cm). */
    lengthCm: z.coerce.number().positive(),
  })
  /**
   * HF-1 — CHỈ MỘT trong hai chiều được vượt `PRINT_AREA_MAX_WIDTH_CM`, không phải
   * cả hai.
   *
   * Vùng in thật của giấy DTF rộng 58cm nhưng dài vô hạn (giấy cuộn), nên một khối
   * 70×40 vẫn in được — quay ngang là vừa. Trước đây trần đặt cứng trên `widthCm`,
   * tức chặn luôn cả những vùng in in được thật, chỉ vì người nhập gõ số lớn vào
   * ô "rộng" thay vì ô "dài".
   *
   * Nhưng CẢ HAI chiều cùng vượt 58 thì quay kiểu gì cũng không lọt qua bề ngang
   * giấy — ca đó vẫn phải chặn.
   */
  .refine((d) => Math.min(d.widthCm, d.lengthCm) <= PRINT_AREA_MAX_WIDTH_CM, {
    message: `Chỉ một trong hai chiều được vượt ${PRINT_AREA_MAX_WIDTH_CM} cm (chiều kia phải lọt bề ngang giấy để quay ngang được)`,
    path: ['widthCm'],
  });
export type ProductPrintAreaSizeDimension = z.infer<typeof ProductPrintAreaSizeDimensionZod>;

export const ProductPrintAreaItemZod = z.object({
  key: ProductPrintAreaKeyZod,
  /** URL template thiết kế cho vị trí này ("print" hệ cũ — Drive link...). */
  templateUrl: z.string().max(1000).optional(),
  /** Kích thước file in chuẩn theo pixel ("width"/"height" hệ cũ). */
  widthPx: z.coerce.number().min(0).optional(),
  heightPx: z.coerce.number().min(0).optional(),
  /**
   * Bắt buộc khách nộp design cho vị trí này ("is_required" hệ cũ). Data cũ
   * dạng bare key được backfill `isRequired: true` — consumer coi
   * `isRequired !== false` là bắt buộc (giữ behavior cũ: mọi vị trí đều bắt buộc).
   */
  isRequired: z.boolean().optional(),
  /** Phụ phí in vị trí này ("addition_price" hệ cũ) — mới lưu, CHƯA wire vào tính giá. */
  additionPrice: PriceZod.optional(),
  /** Vị trí thêu ("is_embroidery" hệ cũ). */
  isEmbroidery: z.boolean().optional(),
  /**
   * PRD-7 — kích thước in theo TỪNG size, mỗi size tối đa 1 dòng. Trống/thiếu =
   * vị trí này chưa cấu hình kích thước (KHÔNG chặn lưu sản phẩm).
   */
  sizeDimensions: ProductPrintAreaSizeDimensionZod.array()
    .max(50)
    .optional()
    .refine((items) => !items || new Set(items.map((i) => i.size.toLowerCase())).size === items.length, {
      message: 'Duplicated size in print area dimensions',
    }),
});
export type ProductPrintAreaItem = z.infer<typeof ProductPrintAreaItemZod>;

/** Danh sách vị trí in của 1 sản phẩm — key không trùng lặp. */
export const ProductPrintAreaZod = ProductPrintAreaItemZod.array()
  .max(30)
  .refine((items) => new Set(items.map((i) => i.key)).size === items.length, { message: 'Vị trí in bị trùng lặp' });
export type ProductPrintArea = z.infer<typeof ProductPrintAreaZod>;

/**
 * Các vị trí in mà 1 design là ĐỦ cho item của sản phẩm này — luật design của
 * Customer Portal (nới 27/08): KHÔNG đòi đủ mọi vị trí bắt buộc, chỉ cần 1
 * design ở MẶT TRƯỚC hoặc MẶT SAU; sản phẩm không có front/back trong cấu hình
 * → cần 1 design ở bất kỳ vị trí bắt buộc nào; không có vị trí bắt buộc nào
 * (hoặc `isRequired: false` hết) → rỗng, không đòi design (chỉ đòi mockup).
 *
 * NGUỒN LUẬT DUY NHẤT — dùng chung: BE `assertArtworkComplete` (gate đặt đơn
 * ORD-22 + push ORD-25) + `resolveImportSkus`, FE form đặt đơn `new.tsx`
 * (`canAddToCart`) + cảnh báo preview import. Sửa luật thì sửa Ở ĐÂY.
 */
// Nest-free, dời sang `client/print-area.ts` (luật dùng chung web + seller + BE).
export { designAcceptKeys };

/**
 * Biến thể sản phẩm (VD: màu/size cụ thể, nhưng KHÔNG định nghĩa cứng field
 * nào — admin tự đặt tên thuộc tính qua `attributes` key-value) — SKU riêng,
 * giá vốn (cost/nonShipCost) dùng nội bộ, `retailPrice` là giá niêm yết hiển
 * thị cho khách (chưa áp discount). `weight/width/height/length` override
 * đóng gói mặc định của sản phẩm khi biến thể này có kích thước/khối lượng
 * khác.
 */
export const ProductVariationZod = z.object({
  sku: z.string().min(1).max(100).trim().toUpperCase(),
  /** Thuộc tính biến thể tự do dạng key-value (VD: "Màu" → "Đỏ", "Size" → "M"). */
  attributes: ProductItemSpecificZod.array().max(20).optional(),
  /** Giá vốn sản xuất. */
  cost: PriceZod.optional(),
  /** Giá vốn KHÔNG gồm phí ship. */
  nonShipCost: PriceZod.optional(),
  /** Giá bán niêm yết cho khách ("EXP US $" hệ cũ — trước khi áp chương trình giảm giá). */
  retailPrice: PriceZod.optional(),
  /** Giá bán sỉ ("Wholesale" hệ cũ). */
  wholesalePrice: PriceZod.optional(),
  /** Giá bán kênh TikTok ("TT US $" hệ cũ). */
  tiktokPrice: PriceZod.optional(),
  /** Phí ship Express US ("EXP US" hệ cũ — hệ cũ auto từ onosexpress, hiện nhập tay). */
  expUsShipCost: PriceZod.optional(),
  /** Phí ship TikTok US ("TIKTOK US" hệ cũ — nhập tay). */
  tiktokShipCost: PriceZod.optional(),
  weight: z.coerce.number().min(0).optional(),
  width: z.coerce.number().min(0).optional(),
  height: z.coerce.number().min(0).optional(),
  length: z.coerce.number().min(0).optional(),
  /**
   * Khối lượng ĐÓNG GÓI hiển thị "PACKAGE: {n}gram" trang sản phẩm hệ cũ —
   * số nhập tay bên WP (KHÔNG suy được từ `weight`, vd weight 90 → package
   * 110), crawl 1 lần qua `POST /product-configs/crawl-page-info`.
   */
  packageGram: z.coerce.number().min(0).optional(),
  status: z.enum(getObjectValues(Status)).default(Status.Active),
});
export type ProductVariation = z.infer<typeof ProductVariationZod>;

export const ProductConfigZod = BaseEntityZod.extend({
  fullName: z.string().min(1).max(300),
  /** Mã ngắn chạy tool duyệt thiết kế (ORD-3) — trống = không có mã, Design Review API trả `productCode: null`. */
  shortName: z.string().max(60),
  /**
   * Mã chạy tool duyệt thiết kế (PRD-2) — trường RIÊNG, KHÔNG dùng `shortName`
   * nữa. Trống = sản phẩm không có mã, Design Review API trả `productCode: null`.
   * Chỉ người dùng sửa tay trên trang chi tiết sản phẩm mới đổi được, trừ lần
   * migration một-lần đổ từ `PRODUCT_TYPE_CODE_MAP`.
   */
  designReviewCode: z.string().max(60).optional(),
  /**
   * PRD-6 — URL file template DÙNG ĐỂ CHẠY TOOL của sản phẩm. Trường RIÊNG, cố ý
   * KHÔNG dùng lại họ `printTemplate`/`printDocument`/`printArea[].templateUrl`:
   * ba trường đó mang dữ liệu migrate hệ cũ + import OnosPod, ghi đè là hỏng dữ
   * liệu thật mà không có lỗi nào báo ra. Trống = sản phẩm chưa gắn file template
   * ⇒ mã chạy tool ở danh sách hiện chữ thường, KHÔNG thành liên kết.
   * Chỉ nhận http:// hoặc https://; hệ thống KHÔNG kiểm tra URL sống hay chết.
   */
  designReviewTemplateUrl: z
    .string()
    .max(1000)
    .optional()
    .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), {
      message: 'Tool template URL must start with http:// or https://',
    }),
  /** Mã SKU riêng của sản phẩm (KHÔNG phải SKU biến thể) — unique toàn hệ thống nếu có. */
  sku: z.string().max(100).optional(),
  /** Slug SEO/URL (parity hệ cũ) — chưa dùng để routing, chỉ lưu. */
  slug: z.string().max(300).optional(),
  /** Active = hiện catalog khách hàng, Inactive = ẩn catalog nhưng vẫn hiện quản trị, Hidden = ẩn cả 2 (KHÔNG xóa). */
  status: z.enum(getObjectValues(ProductConfigStatus)).default(ProductConfigStatus.Active),
  /** Machine number/identifier (e.g. "94", "27"). Empty → product has no tool. */
  machineNumber: z.string().max(60).optional(),
  /** Optional từ 2026-07 — sản phẩm tạo nhanh từ kanban Settings (kéo từ cột "Chưa xác định xưởng") chưa có loại máy, bổ sung sau ở trang Products. */
  machineTypeId: IDZod.optional(),
  /**
   * Optional — sản phẩm có thể tạo mà chưa gán xưởng, bổ sung sau ở trang
   * Products. Đơn import khớp sản phẩm chưa có `factoryId` sẽ tự rơi vào
   * "Không xác định xưởng" (xem `Orders.md §19`), CÙNG cách xử lý với đơn
   * chưa map product config.
   */
  factoryId: IDZod.optional(),
  /** workshop_config code (category=fabric_type). Default fabric used at import. */
  fabricType: z.string().max(60).optional(),
  /** workshop_config code (category=tool_result). Default tool status at import. */
  toolResult: z.string().max(60).optional(),
  /** Ảnh/URL mockup sản phẩm (ảnh CHÍNH — index 0 của gallery) — hiển thị cột đầu bảng config. */
  mockup: z.string().max(1000).optional(),
  /** Gallery ảnh bổ sung (ngoài `mockup`) — URL hoặc ảnh upload local-disk. */
  images: z.array(z.string().max(1000)).max(20).optional(),
  /** ref CollectionEntity — 1 sản phẩm thuộc nhiều collection (multi-select). */
  collectionIds: IDZod.array().max(20).optional(),
  /** Cấp độ sản phẩm 1..10 (PRODUCT_LEVELS) — hiển thị badge màu. */
  level: z.number().int().min(1).max(10).optional(),
  /** Hướng dẫn / ghi chú sản xuất (HTML từ rich text editor). */
  guide: z.string().max(20000).optional(),

  // ─── Thông tin chi tiết sản phẩm (catalog cho khách hàng) ───────
  /** ref ProductCategoryEntity — module riêng, xem `product-category.dto.ts`. */
  productCategoryId: IDZod.optional(),
  /** workshop_config code (category=print_method). */
  printMethod: z.string().max(60).optional(),
  /** PRD-8 — DÒNG SẢN PHẨM seller nhìn (3d/2d/wood/embroidery/led/canvas), xem `enums/product-line.ts`. */
  productLine: z.enum(PRODUCT_LINES).optional(),
  /** PRD-8 — nguồn gán `productLine` (manual/collection/factory/machineType/printMethod/default); `default` = máy đoán không có tín hiệu. */
  productLineSource: z.enum(PRODUCT_LINE_SOURCES).optional(),
  /** Danh sách vị trí in — object giàu theo key CỐ ĐỊNH (xem `ProductPrintAreaItemZod`). */
  printArea: ProductPrintAreaZod.optional(),
  /** URL trang tài liệu hướng dẫn design/template ("print_document" hệ cũ). */
  printDocument: z.string().max(1000).optional(),
  /** URL template thiết kế CHUNG của sản phẩm ("print_template" hệ cũ) — template riêng từng vị trí xem `printArea[].templateUrl`. */
  printTemplate: z.string().max(1000).optional(),
  /** Ảnh/URL bảng size. */
  sizeChartUrl: z.string().max(1000).optional(),
  /** Mô tả sản phẩm (HTML) — hiển thị cho khách hàng ở Customer Portal ("Item description" hệ cũ). */
  description: z.string().max(20000).optional(),
  /** Mô tả ngắn (HTML) — "Short description" hệ cũ. */
  shortDescription: z.string().max(20000).optional(),
  /** Mô tả template/file in (HTML) — "Template description" hệ cũ. */
  templateDescription: z.string().max(20000).optional(),
  /**
   * "IMPORT US TAX: ${n}/unit" trang sản phẩm hệ cũ — GIÁ TRỊ CỐ ĐỊNH nhập
   * tay bên WP theo sản phẩm (đối chiếu thật: KHÔNG suy được từ % `tax_groups`
   * GraphQL — 3 sản phẩm giá khác nhau cùng $0.40), crawl 1 lần qua
   * `POST /product-configs/crawl-page-info`.
   */
  usImportTaxPerUnit: PriceZod.optional(),
  /** "Shipping time" hệ cũ — Max Production time (ngày). */
  maxProductionTime: z.coerce.number().min(0).optional(),
  /** "Shipping time" hệ cũ — Max shipping time (ngày). */
  maxShippingTime: z.coerce.number().min(0).optional(),
  /** "Hide product for seller" hệ cũ — mới lưu, CHƯA wire vào logic nào. */
  hideForSeller: z.boolean().optional(),
  /** "Enable design check" hệ cũ — mới lưu, CHƯA wire vào logic nào. */
  enableDesignCheck: z.boolean().optional(),
  /** "Enable affiliate commission" hệ cũ — mới lưu, CHƯA wire vào logic nào. */
  enableAffiliate: z.boolean().optional(),
  /** Thông số kỹ thuật dạng key-value tự do (chất liệu, kiểu dáng...). */
  itemSpecifics: ProductItemSpecificZod.array().max(50).optional(),
  /** Đóng gói mặc định (áp dụng khi biến thể không override). */
  weight: z.coerce.number().min(0).optional(),
  width: z.coerce.number().min(0).optional(),
  height: z.coerce.number().min(0).optional(),
  length: z.coerce.number().min(0).optional(),
  /** Danh sách biến thể (màu/size) — SKU riêng từng biến thể. */
  variations: ProductVariationZod.array().max(200).optional(),
});
export type ProductConfig = z.infer<typeof ProductConfigZod>;

//
/**
 * Giá trị `fabricType` nghĩa "CHƯA đặt loại vải" khi lọc (PRD-1) — 53/194 sản
 * phẩm đang bỏ trống trường này, không có lựa chọn riêng thì không ai tìm ra
 * chúng. Cùng quy ước với bộ lọc tier khách (`tier='none'`). KHÔNG trùng mã vải
 * thật nào trong `workshop_configs` (category `fabric_type`).
 */
export const PRODUCT_FABRIC_TYPE_NONE = 'none';

export const GetProductConfigsZod = PageQueryZod.extend({
  factoryId: IDZod.optional(),
  machineTypeId: IDZod.optional(),
  /**
   * PRD-1 — lọc riêng theo TÊN sản phẩm (chứa chuỗi, không phân biệt hoa thường).
   * Khác `search` sẵn có: `search` gộp fullName/shortName/sku bằng `$or`, còn
   * `fullName`/`shortName` là hai điều kiện AND với nhau. Đường cũ giữ nguyên.
   */
  fullName: z.string().trim().optional(),
  /** PRD-1 — lọc riêng theo TÊN VIẾT TẮT (chứa chuỗi, không phân biệt hoa thường). */
  shortName: z.string().trim().optional(),
  /**
   * PRD-5 — lọc riêng theo MÃ CHẠY TOOL duyệt thiết kế (chứa chuỗi, không phân biệt
   * hoa thường), cùng khuôn với `shortName`. Sản phẩm chưa đặt mã không lọt vào kết
   * quả khi tham số này có giá trị; KHÔNG gộp vào `$or` của `search`.
   */
  designReviewCode: z.string().trim().optional(),
  /** PRD-1 — mã loại vải (`workshop_configs` category `fabric_type`), hoặc `none` = chưa đặt loại vải. */
  fabricType: z.string().trim().optional(),
  /** Không truyền ⇒ mặc định loại `Hidden` khỏi danh sách (vẫn thấy Active + Inactive). Truyền cụ thể để xem đúng 1 trạng thái (VD: `hidden` để xem sản phẩm đã ẩn). */
  status: z.enum(getObjectValues(ProductConfigStatus)).optional(),
  /** PRD-8 — lọc theo dòng sản phẩm; `none` = chưa gắn dòng. */
  productLine: z.enum([...PRODUCT_LINES, 'none']).optional(),
  /** PRD-8 — lọc theo nguồn gán (vd `default` = máy đoán, cần admin gắn lại). */
  productLineSource: z.enum(PRODUCT_LINE_SOURCES).optional(),
});
export class GetProductConfigsDto extends createZodDto(extendApi(GetProductConfigsZod)) {}

export const GetProductConfigsResZod = PageResZod.extend({ data: ProductConfigZod.array() });
export class GetProductConfigsResDto extends createZodDto(extendApi(GetProductConfigsResZod)) {}

//
export const GetProductConfigResZod = ResZod.extend({ data: ProductConfigZod });
export class GetProductConfigResDto extends createZodDto(extendApi(GetProductConfigResZod)) {}

//
export const CreateProductConfigZod = z.object({
  fullName: ProductConfigZod.shape.fullName,
  /** Không truyền / trống → shortName để trống (KHÔNG auto-sinh từ fullName — ORD-3). */
  shortName: ProductConfigZod.shape.shortName.optional(),
  /** Mã chạy tool duyệt thiết kế (PRD-2) — tách hẳn khỏi `shortName`. */
  designReviewCode: ProductConfigZod.shape.designReviewCode,
  /** PRD-6 — URL file template chạy tool. */
  designReviewTemplateUrl: ProductConfigZod.shape.designReviewTemplateUrl,
  sku: ProductConfigZod.shape.sku,
  slug: ProductConfigZod.shape.slug,
  status: ProductConfigZod.shape.status,
  machineNumber: ProductConfigZod.shape.machineNumber,
  machineTypeId: ProductConfigZod.shape.machineTypeId,
  factoryId: ProductConfigZod.shape.factoryId,
  fabricType: ProductConfigZod.shape.fabricType,
  toolResult: ProductConfigZod.shape.toolResult,
  mockup: ProductConfigZod.shape.mockup,
  images: ProductConfigZod.shape.images,
  collectionIds: ProductConfigZod.shape.collectionIds,
  level: ProductConfigZod.shape.level,
  guide: ProductConfigZod.shape.guide,
  productCategoryId: ProductConfigZod.shape.productCategoryId,
  printMethod: ProductConfigZod.shape.printMethod,
  productLine: ProductConfigZod.shape.productLine,
  printArea: ProductConfigZod.shape.printArea,
  printDocument: ProductConfigZod.shape.printDocument,
  printTemplate: ProductConfigZod.shape.printTemplate,
  sizeChartUrl: ProductConfigZod.shape.sizeChartUrl,
  description: ProductConfigZod.shape.description,
  shortDescription: ProductConfigZod.shape.shortDescription,
  templateDescription: ProductConfigZod.shape.templateDescription,
  maxProductionTime: ProductConfigZod.shape.maxProductionTime,
  maxShippingTime: ProductConfigZod.shape.maxShippingTime,
  hideForSeller: ProductConfigZod.shape.hideForSeller,
  enableDesignCheck: ProductConfigZod.shape.enableDesignCheck,
  enableAffiliate: ProductConfigZod.shape.enableAffiliate,
  itemSpecifics: ProductConfigZod.shape.itemSpecifics,
  weight: ProductConfigZod.shape.weight,
  width: ProductConfigZod.shape.width,
  height: ProductConfigZod.shape.height,
  length: ProductConfigZod.shape.length,
  variations: ProductConfigZod.shape.variations,
});
export class CreateProductConfigDto extends createZodDto(extendApi(CreateProductConfigZod)) {}

export const CreateProductConfigResZod = ResZod.extend({ data: ProductConfigZod });
export class CreateProductConfigResDto extends createZodDto(extendApi(CreateProductConfigResZod)) {}

//
export const UpdateProductConfigZod = z.object({
  fullName: ProductConfigZod.shape.fullName.optional(),
  shortName: ProductConfigZod.shape.shortName.optional(),
  /** Mã chạy tool duyệt thiết kế (PRD-2) — sửa tay ở trang chi tiết, có hiệu lực ngay. */
  designReviewCode: ProductConfigZod.shape.designReviewCode,
  /** PRD-6 — URL file template chạy tool; chuỗi rỗng = gỡ liên kết ở danh sách. */
  designReviewTemplateUrl: ProductConfigZod.shape.designReviewTemplateUrl,
  sku: ProductConfigZod.shape.sku,
  slug: ProductConfigZod.shape.slug,
  status: ProductConfigZod.shape.status.optional(),
  machineNumber: ProductConfigZod.shape.machineNumber,
  machineTypeId: ProductConfigZod.shape.machineTypeId.optional(),
  factoryId: ProductConfigZod.shape.factoryId.optional(),
  fabricType: ProductConfigZod.shape.fabricType,
  toolResult: ProductConfigZod.shape.toolResult,
  mockup: ProductConfigZod.shape.mockup,
  images: ProductConfigZod.shape.images,
  collectionIds: ProductConfigZod.shape.collectionIds,
  level: ProductConfigZod.shape.level,
  guide: ProductConfigZod.shape.guide,
  productCategoryId: ProductConfigZod.shape.productCategoryId,
  printMethod: ProductConfigZod.shape.printMethod,
  productLine: ProductConfigZod.shape.productLine,
  printArea: ProductConfigZod.shape.printArea,
  printDocument: ProductConfigZod.shape.printDocument,
  printTemplate: ProductConfigZod.shape.printTemplate,
  sizeChartUrl: ProductConfigZod.shape.sizeChartUrl,
  description: ProductConfigZod.shape.description,
  shortDescription: ProductConfigZod.shape.shortDescription,
  templateDescription: ProductConfigZod.shape.templateDescription,
  maxProductionTime: ProductConfigZod.shape.maxProductionTime,
  maxShippingTime: ProductConfigZod.shape.maxShippingTime,
  hideForSeller: ProductConfigZod.shape.hideForSeller,
  enableDesignCheck: ProductConfigZod.shape.enableDesignCheck,
  enableAffiliate: ProductConfigZod.shape.enableAffiliate,
  itemSpecifics: ProductConfigZod.shape.itemSpecifics,
  weight: ProductConfigZod.shape.weight,
  width: ProductConfigZod.shape.width,
  height: ProductConfigZod.shape.height,
  length: ProductConfigZod.shape.length,
  variations: ProductConfigZod.shape.variations,
});
export class UpdateProductConfigDto extends createZodDto(extendApi(UpdateProductConfigZod)) {}

export const UpdateProductConfigResZod = ResZod.extend({ data: ProductConfigZod });
export class UpdateProductConfigResDto extends createZodDto(extendApi(UpdateProductConfigResZod)) {}

//
export const ImportProductConfigRowZod = z.object({
  fullName: z.string().min(1),
  /** Trống → giữ nguyên shortName hiện có (update) / để trống (tạo mới) — KHÔNG auto-sinh (ORD-3). */
  shortName: z.string().optional(),
  /** Machine number ("94", "27"). Empty → product has no tool. */
  machineNumber: z.string().optional(),
  /** Factory name ("MÊ LINH", "MÊ LINH"…) — matched server-side, "Xưởng " prefix tolerant. */
  factoryLabel: z.string().min(1),
  /** Vietnamese label ("POLY 2 DA", "MÈ 64"…) — resolved server-side via workshop_config. */
  fabricLabel: z.string().optional(),
  /** Vietnamese label ("Có Tool" / "Không có Tool"). Empty → defaults derived from machineNumber. */
  toolResultLabel: z.string().optional(),
  /** Department / printer type ("IN và CẮT LASER") — matched against MachineType.name. */
  departmentLabel: z.string().min(1),
});
export type ImportProductConfigRow = z.infer<typeof ImportProductConfigRowZod>;

export const ImportProductConfigZod = z.object({
  rows: ImportProductConfigRowZod.array().min(1),
});
export class ImportProductConfigDto extends createZodDto(extendApi(ImportProductConfigZod)) {}

export const ImportProductConfigResZod = ResZod.extend({
  data: z.object({
    imported: z.number(),
    updated: z.number(),
    skipped: z.array(z.object({ row: z.number(), reason: z.string() })),
  }),
});
export class ImportProductConfigResDto extends createZodDto(extendApi(ImportProductConfigResZod)) {}

//
/**
 * Import SẢN PHẨM HOÀN CHỈNH từ file xlsx (`POST /product-configs/import-full`)
 * — khác `POST /import` (chỉ config tối thiểu 6 cột): mỗi phần tử = 1 sản phẩm
 * đủ catalog (danh mục, collection, ảnh, mô tả, thông số, đóng gói, thời gian
 * SX/ship) + `variations[]` (FE group biến thể trải nhiều dòng theo Tên SP).
 * Các label Xưởng/Phòng/Danh mục/Collection resolve phía server: Xưởng không
 * khớp → skip sản phẩm; Phòng/Danh mục/Collection không khớp → warning + bỏ
 * field. Upsert theo `fullName` (exact, trim): chỉ field CÓ trong payload mới
 * ghi đè; variations merge theo SKU (không xóa biến thể cũ ngoài file). Tạo
 * MỚI mặc định `toolResult = 'none'` (file full không có cột Máy/Tool — cấu
 * hình tool bổ sung qua file SKU cũ hoặc trang chi tiết).
 */
export const ImportFullProductZod = z.object({
  fullName: ProductConfigZod.shape.fullName,
  /** Trống → shortName để trống (KHÔNG auto-sinh từ fullName — ORD-3; max 60, BE uppercase). */
  shortName: z.string().max(60).optional(),
  /** Nhãn xưởng ("TNW", "Xưởng gỗ Thái Nguyên"...) — resolve qua `factoryService.findByLabel`. */
  factoryLabel: z.string().max(120).optional(),
  /** Nhãn Loại máy/Phòng — resolve qua `machineTypeService.findByLabel`. */
  departmentLabel: z.string().max(120).optional(),
  /** Tên/viết tắt Danh mục sản phẩm — resolve exact case-insensitive. */
  categoryLabel: z.string().max(120).optional(),
  /** Tên/viết tắt Collection (nhiều) — resolve exact case-insensitive từng cái. */
  collectionLabels: z.string().max(120).array().max(20).optional(),
  printMethod: ProductConfigZod.shape.printMethod,
  productLine: ProductConfigZod.shape.productLine,
  mockup: ProductConfigZod.shape.mockup,
  images: ProductConfigZod.shape.images,
  sizeChartUrl: ProductConfigZod.shape.sizeChartUrl,
  description: ProductConfigZod.shape.description,
  shortDescription: ProductConfigZod.shape.shortDescription,
  itemSpecifics: ProductConfigZod.shape.itemSpecifics,
  maxProductionTime: ProductConfigZod.shape.maxProductionTime,
  maxShippingTime: ProductConfigZod.shape.maxShippingTime,
  weight: ProductConfigZod.shape.weight,
  width: ProductConfigZod.shape.width,
  height: ProductConfigZod.shape.height,
  length: ProductConfigZod.shape.length,
  variations: ProductConfigZod.shape.variations,
});
export type ImportFullProduct = z.infer<typeof ImportFullProductZod>;

export const ImportFullProductsZod = z.object({
  products: ImportFullProductZod.array().min(1).max(500),
});
export class ImportFullProductsDto extends createZodDto(extendApi(ImportFullProductsZod)) {}

export const ImportFullProductsResZod = ResZod.extend({
  data: z.object({
    imported: z.number(),
    updated: z.number(),
    /** Sản phẩm bị bỏ qua hoàn toàn (Xưởng không khớp, SKU trùng sản phẩm khác...). */
    skipped: z.array(z.object({ product: z.string(), reason: z.string() })),
    /** Sản phẩm vẫn import nhưng có field bị bỏ (Phòng/Danh mục/Collection không khớp). */
    warnings: z.array(z.object({ product: z.string(), reason: z.string() })),
  }),
});
export class ImportFullProductsResDto extends createZodDto(extendApi(ImportFullProductsResZod)) {}

//
/**
 * Upload ảnh mockup/bảng size — lưu **local disk** trên server API (KHÔNG qua
 * S3/Backblaze, khác hẳn `/v1/upload/image`). Lý do tách riêng: pipeline S3
 * hiện có (`apps/api/src/modules/upload/`) cần `AWS_S3_*`/`BACKBLAZE_*`
 * credentials — môi trường dev/1 số môi trường chưa cấu hình gây 500. Ảnh
 * sản phẩm dùng nội bộ nên chấp nhận lưu đĩa server, phục vụ qua
 * `ServeStaticModule` sẵn có (`rootPath: ./src/assets`).
 */
export const UploadProductImageZod = z.object({
  type: z.enum(['mockup', 'size-chart']),
});
export class UploadProductImageDto extends createZodDto(extendApi(UploadProductImageZod)) {}

export const UploadProductImageResZod = ResZod.extend({ data: z.object({ url: z.string() }) });
export class UploadProductImageResDto extends createZodDto(extendApi(UploadProductImageResZod)) {}

// ─── Import sản phẩm từ OnosPod (GraphQL productPreset) ───

/**
 * Import theo lô (FE gọi lặp từng trang tới khi `nextPage` null): mỗi call
 * fetch 1 trang `productPreset` từ api.onospod.com (page/limit qua header
 * `x-page`/`x-per-page`, tổng ở response header `x-total`) rồi upsert
 * FILL-ONLY vào Product Config — xem `OnospodProductImportService`.
 */
export const ImportFromOnospodZod = z.object({
  page: z.coerce.number().int().positive().default(1),
  /**
   * Nên gọi 1 LẦN DUY NHẤT với limit lớn (500) — phân trang bên OnosPod KHÔNG
   * ổn định (thứ tự trượt giữa các lần gọi → trùng + LỌT sản phẩm, verify
   * 2026-08-05: 9 trang × 20 chỉ thu 167 dòng có trùng lặp, thiếu PAOPPOLO).
   */
  limit: z.coerce.number().int().positive().max(500).default(500),
});
export class ImportFromOnospodDto extends createZodDto(extendApi(ImportFromOnospodZod)) {}

export const OnospodImportErrorZod = z.object({
  sku: z.string(),
  name: z.string(),
  reason: z.string(),
});
export type OnospodImportError = z.infer<typeof OnospodImportErrorZod>;

export const ImportFromOnospodResZod = ResZod.extend({
  data: z.object({
    /** Tổng sản phẩm bên OnosPod (header `x-total`). */
    total: z.number(),
    /** Số sản phẩm xử lý trong trang này. */
    processed: z.number(),
    /** Tạo mới (chưa tồn tại theo sku/fullName). */
    created: z.number(),
    /** Đã tồn tại + có ít nhất 1 field trống được fill. */
    filled: z.number(),
    /** Đã tồn tại, không có gì để fill. */
    skipped: z.number(),
    errors: OnospodImportErrorZod.array(),
    /** Trang kế tiếp — null = đã hết. */
    nextPage: z.number().nullable(),
    /**
     * Bước cuối (khi `nextPage` null): số sản phẩm KHÔNG có biến thể (kể cả
     * không có bên OnosPod) được tự tạo 1 biến thể mặc định (chưa có giá) để
     * hiện được trong catalog khách — giá nhập sau ở trang chi tiết sản phẩm.
     */
    defaultVariationsCreated: z.number().optional(),
  }),
});
export class ImportFromOnospodResDto extends createZodDto(extendApi(ImportFromOnospodResZod)) {}

// ─── Kanban Settings — sync sản phẩm chưa có config từ đơn gần đây ───

/** Quét đơn `days` ngày gần nhất (mặc định 14) tìm `type` chưa có trong Product Config. */
export const GetUnmatchedOrderTypesZod = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});
export class GetUnmatchedOrderTypesDto extends createZodDto(extendApi(GetUnmatchedOrderTypesZod)) {}

/** 1 loại sản phẩm xuất hiện trên đơn nhưng CHƯA có Product Config — kèm số đơn trong khoảng quét. */
export const UnmatchedOrderTypeZod = z.object({
  type: z.string(),
  orderCount: z.number(),
});
export type UnmatchedOrderType = z.infer<typeof UnmatchedOrderTypeZod>;

export const GetUnmatchedOrderTypesResZod = ResZod.extend({ data: UnmatchedOrderTypeZod.array() });
export class GetUnmatchedOrderTypesResDto extends createZodDto(extendApi(GetUnmatchedOrderTypesResZod)) {}

// ─── Crawl ảnh mockup từ onospod.com cho sản phẩm chưa có ảnh ───

/**
 * Xử lý theo lô (FE gọi lặp): mỗi call quét tối đa `limit` sản phẩm thiếu
 * mockup có `_id > cursor` (sort `_id` tăng dần). Cursor tiến đơn điệu nên
 * sản phẩm đã thử-nhưng-không-khớp KHÔNG bị quét lại vòng sau — tránh loop
 * vô hạn. FE truyền lại `nextCursor` từ response đến khi `done=true`.
 */
export const CrawlProductMockupsZod = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: IDZod.optional(),
});
export class CrawlProductMockupsDto extends createZodDto(extendApi(CrawlProductMockupsZod)) {}

/**
 * Kết quả crawl CHI TIẾT từng sản phẩm trong lô:
 * - `created`  — sản phẩm chưa có ảnh, đã tìm được và gán mới.
 * - `updated`  — sản phẩm đã có ảnh, bị ghi đè (hiện crawl chỉ quét sản phẩm thiếu ảnh nên hiếm gặp).
 * - `no-match` — search CÓ kết quả nhưng không cái nào trùng tên (xem `foundTitles` để biết site trả gì).
 * - `no-results` — search không trả kết quả nào (sản phẩm không tồn tại trên onospod).
 * - `error`    — request lỗi/timeout (xem `message`).
 */
export const CrawlMockupResultItemZod = z.object({
  productConfigId: IDZod,
  fullName: z.string(),
  status: z.enum(['created', 'updated', 'no-match', 'no-results', 'error']),
  imageUrl: z.string().optional(),
  /** Tên sản phẩm trên onospod đã khớp (có thể khớp sau khi bỏ mã `[...]`/tiền tố — xem `note`). */
  matchedTitle: z.string().optional(),
  /** Tối đa 3 tên gần nhất site trả về khi `no-match` — để người dùng biết vì sao không khớp. */
  foundTitles: z.string().array().optional(),
  /** Ghi chú thêm (vd "khớp sau khi bỏ mã [PANT]") hoặc thông điệp lỗi. */
  note: z.string().optional(),
});
export type CrawlMockupResultItem = z.infer<typeof CrawlMockupResultItemZod>;

export const CrawlProductMockupsResZod = ResZod.extend({
  data: z.object({
    /** Số sản phẩm đã quét trong lô này. */
    processed: z.number(),
    /** Số sản phẩm tìm được ảnh trùng tên và đã gán mockup. */
    updated: z.number(),
    /** Số sản phẩm thiếu mockup còn lại SAU cursor (chưa quét). */
    remaining: z.number(),
    nextCursor: IDZod.optional(),
    done: z.boolean(),
    /** Chi tiết từng sản phẩm trong lô — lấy được hay không, vì sao. */
    results: CrawlMockupResultItemZod.array(),
  }),
});
export class CrawlProductMockupsResDto extends createZodDto(extendApi(CrawlProductMockupsResZod)) {}

// ─── Customer Portal — Catalog (chỉ field an toàn cho khách hàng) ───
// KHÔNG bao giờ trả `cost` (giá vốn `base_price` nội bộ) ra Customer Portal.
// `nonShipCost` là giá bán nonship public trên trang sản phẩm hệ cũ — được trả
// dưới tên `shipCodPrice` (xem CustomerCatalogVariationZod bên dưới).

export const CustomerCatalogVariationZod = z.object({
  sku: ProductVariationZod.shape.sku,
  attributes: ProductVariationZod.shape.attributes,
  /** Cột "SHIP Express US" bảng biến thể hệ cũ (`sale_price`) — giá bán chuẩn, promotion áp lên giá này. */
  retailPrice: ProductVariationZod.shape.retailPrice,
  /** Giá sau khi áp chương trình giảm giá tốt nhất theo tier của khách (nếu có). */
  discountedPrice: PriceZod.optional(),
  appliedPromotionName: z.string().optional(),
  /**
   * Cột "SHIP COD" bảng biến thể hệ cũ — map từ `nonShipCost` (`nonship_price`):
   * đây là GIÁ BÁN nonship public trên trang sản phẩm cũ, KHÔNG phải giá vốn.
   * Giá vốn thật (`cost`/`base_price`) vẫn tuyệt đối KHÔNG trả ra Customer Portal.
   */
  shipCodPrice: PriceZod.optional(),
  /** Cột "Ship by TikTok" bảng biến thể hệ cũ (`tiktok_final_price`). */
  tiktokPrice: PriceZod.optional(),
  /** Cân nặng gram + kích thước đóng gói cm — cột "WEIGHT" hiển thị `{weight}g ({height}cm x {length}cm x {width}cm)`. */
  weight: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  length: z.number().optional(),
  /** Khối lượng đóng gói — dòng "PACKAGE: {n}gram (...)" panel phải (crawl từ trang hệ cũ, xem `ProductVariationZod.packageGram`). */
  packageGram: z.number().optional(),
});
export type CustomerCatalogVariation = z.infer<typeof CustomerCatalogVariationZod>;

/**
 * Vị trí in đã resolve nhãn hiển thị — trả cho API khách hàng thay vì bare
 * key. Kèm template/kích thước px/isRequired để khách chuẩn bị file design
 * đúng chuẩn (KHÔNG trả `additionPrice`/`isEmbroidery` — thông tin nội bộ).
 */
export const CustomerCatalogPrintAreaZod = z.object({
  key: ProductPrintAreaKeyZod,
  label: z.string(),
  templateUrl: z.string().optional(),
  widthPx: z.number().optional(),
  heightPx: z.number().optional(),
  /** `false` = vị trí tùy chọn, khách được bỏ trống design; mặc định coi là bắt buộc. */
  isRequired: z.boolean().optional(),
});
export type CustomerCatalogPrintArea = z.infer<typeof CustomerCatalogPrintAreaZod>;

export const CustomerCatalogItemZod = z.object({
  _id: IDZod,
  fullName: z.string(),
  shortName: z.string(),
  /** Tên danh mục đã resolve từ `productCategoryId` (ProductCategory module) — KHÔNG phải id. */
  productCategory: z.string().optional(),
  printMethod: z.string().optional(),
  /** Dòng sản phẩm — tab/lọc ở Seller Portal. */
  productLine: z.enum(PRODUCT_LINES).optional(),
  printArea: CustomerCatalogPrintAreaZod.array().optional(),
  /** URL trang tài liệu hướng dẫn design ("print_document" hệ cũ). */
  printDocument: z.string().optional(),
  /** URL template thiết kế chung ("print_template" hệ cũ). */
  printTemplate: z.string().optional(),
  mockup: z.string().optional(),
  /** Gallery ảnh bổ sung — trang chi tiết hiện TẤT CẢ: mockup + images + sizeChart. */
  images: z.string().array().optional(),
  /** Dòng "IMPORT US TAX: ${n}/unit" panel phải (crawl từ trang hệ cũ, xem `ProductConfigZod.usImportTaxPerUnit`). */
  usImportTaxPerUnit: PriceZod.optional(),
  /** URL mockup ĐÚNG như đang lưu — với ảnh crawl từ onospod là bản thumbnail `-100x100`. Bậc dự phòng của `mockupLarge`. */
  /**
   * URL ảnh mockup full-size dẫn xuất từ `mockup` bằng `toFullSizeImageUrl()`
   * — ô ảnh catalog rộng ~300px nên bản `-100x100` bị phóng lên nhòe.
   *
   * KHÔNG đảm bảo ảnh tồn tại: ảnh gốc có thể đã bị xóa khỏi onospod trong khi
   * thumbnail vẫn còn. Nơi hiển thị PHẢI dự phòng `mockupLarge` → `mockup` →
   * ảnh mặc định, KHÔNG để ô ảnh vỡ (`Catalog.md` §6).
   */
  mockupLarge: z.string().optional(),
  sizeChartUrl: z.string().optional(),
  description: z.string().optional(),
  /** Bullet tóm tắt (HTML `short_description` hệ cũ) — chỉ trả ở API chi tiết, hiện trong tab "Chi tiết sản phẩm". */
  shortDescription: z.string().optional(),
  /** Nội dung tab "Mockup & Template" (HTML `template_description` hệ cũ: yêu cầu file in, hướng dẫn đặt design...) — chỉ trả ở API chi tiết. */
  templateDescription: z.string().optional(),
  itemSpecifics: ProductItemSpecificZod.array().optional(),
  variations: CustomerCatalogVariationZod.array(),
  /** Tên các collection sản phẩm thuộc về (resolve từ `collectionIds`) — chỉ trả ở API chi tiết. */
  collections: z.string().array().optional(),
});
export type CustomerCatalogItem = z.infer<typeof CustomerCatalogItemZod>;

export const GetCustomerCatalogZod = PageQueryZod.extend({
  productCategoryId: IDZod.optional(),
  collectionId: IDZod.optional(),
  productLine: z.enum(PRODUCT_LINES).optional(),
});
export class GetCustomerCatalogDto extends createZodDto(extendApi(GetCustomerCatalogZod)) {}

export const GetCustomerCatalogResZod = PageResZod.extend({ data: CustomerCatalogItemZod.array() });
export class GetCustomerCatalogResDto extends createZodDto(extendApi(GetCustomerCatalogResZod)) {}

/** 1 sản phẩm — dùng cho trang chi tiết `/customer/catalog/:id` (gallery + chọn biến thể + "Đặt đơn mới"). */
export const GetCustomerCatalogItemResZod = ResZod.extend({ data: CustomerCatalogItemZod });
export class GetCustomerCatalogItemResDto extends createZodDto(extendApi(GetCustomerCatalogItemResZod)) {}

/**
 * Crawl "Import US Tax" + "Package gram" từ trang sản phẩm public hệ cũ
 * (`onospod.com/product/{slug}/` — 2 giá trị này CHỈ có trên trang WP, không
 * có trong GraphQL) — theo lô cursor như crawl-mockups, FE gọi lặp đến `done`.
 * Chỉ quét sản phẩm có `slug` và còn thiếu ít nhất 1 trong 2 giá trị.
 */
export const CrawlPageInfoZod = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: IDZod.optional(),
});
export class CrawlPageInfoDto extends createZodDto(extendApi(CrawlPageInfoZod)) {}

export const CrawlPageInfoResultItemZod = z.object({
  productConfigId: IDZod,
  fullName: z.string(),
  status: z.enum(['updated', 'no-data', 'error']),
  usImportTaxPerUnit: PriceZod.optional(),
  /** Số biến thể đã gán được packageGram (match theo giá trị thuộc tính trên điều kiện hiển thị của trang cũ). */
  packageGramMatched: z.number().optional(),
  message: z.string().optional(),
});
export type CrawlPageInfoResultItem = z.infer<typeof CrawlPageInfoResultItemZod>;

export const CrawlPageInfoResZod = ResZod.extend({
  data: z.object({
    processed: z.number(),
    updated: z.number(),
    /** Số sản phẩm còn thiếu data SAU cursor (chưa quét). */
    remaining: z.number(),
    nextCursor: IDZod.optional(),
    done: z.boolean(),
    results: CrawlPageInfoResultItemZod.array(),
  }),
});
export class CrawlPageInfoResDto extends createZodDto(extendApi(CrawlPageInfoResZod)) {}

/** 1 mục lọc (danh mục hoặc collection) kèm số sản phẩm khách thấy được — chỉ trả mục đang active và count > 0. */
export const CustomerCatalogFacetZod = z.object({
  _id: IDZod,
  name: z.string(),
  /** Ảnh đại diện (chỉ collection có). */
  image: z.string().optional(),
  count: z.number(),
});
export type CustomerCatalogFacet = z.infer<typeof CustomerCatalogFacetZod>;

/** Bộ lọc duyệt catalog `/customer/catalog` — categories (pill bar) + collections (hàng card). */
export const GetCustomerCatalogFacetsResZod = ResZod.extend({
  data: z.object({
    categories: CustomerCatalogFacetZod.array(),
    collections: CustomerCatalogFacetZod.array(),
    /** Số sản phẩm theo dòng (chỉ dòng có ≥1 sản phẩm). */
    productLines: z.object({ code: z.enum(PRODUCT_LINES), count: z.number() }).array(),
  }),
});
export class GetCustomerCatalogFacetsResDto extends createZodDto(extendApi(GetCustomerCatalogFacetsResZod)) {}
