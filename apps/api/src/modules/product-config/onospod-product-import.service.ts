import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model } from 'mongoose';
import type {
  ImportFromOnospodDto,
  ImportFromOnospodResDto,
  OnospodImportError,
  ProductConfig,
  ProductItemSpecific,
  ProductPrintAreaItem,
  ProductVariation,
} from 'shared';
import { myNanoid, PRODUCT_PRINT_AREA_KEYS, ProductConfigStatus, Status } from 'shared';

import { ApiConfigService } from '@/shared/services';

import { CollectionRepository } from '../collection/collection.repository';
import { ProductCategoryRepository } from '../product-category/product-category.repository';
import { ProductTagRepository } from '../product-tag/product-tag.repository';
import { ProductTechniqueRepository } from '../product-technique/product-technique.repository';
import { ProductConfigEntity } from './product-config.entity';
import { productLineForNew } from './product-line-migration';

// Gateway OnosPod chặn 403 nếu THIẾU header `origin` — xem chú thích cùng tên
// ở `order/onospod-order-lookup.service.ts` (verify bằng test gọi thật).
const ONOSPOD_ORIGIN = 'https://app.onospod.com';

/**
 * Query `productPreset` — CHỈ giữ field có đích đến trong `ProductConfig`
 * (bỏ vip/tax_groups/platform_specifics/shipping_preset... chưa có chỗ chứa).
 * Filter provider/collection ĐỂ RỖNG = lấy TẤT CẢ sản phẩm (verify bằng gọi
 * thật 2026-08-05: collection "3D" = 144, provider Private = 169, bỏ hết
 * filter = 178). Phân trang qua HEADER `x-page`/`x-per-page`, tổng ở response
 * header `x-total` — KHÔNG phải biến trong query.
 */
const productPresetQuery = (collection: string) => `query { productPreset (_id:"",identity:"",name:"",provider:"",category:"All",category_id:[],collection:"${collection}") {
  _id,sku,slug,identity,name,image,images_thumbnail,description,short_description,template_description,
  attribute_specifics {
    sku,nonship_price,tiktok_final_price,wholesale_price,sale_price,base_price,
    name_value { name,type,value },
    weight,package_width,package_height,package_length,
    shipping_methods { shipping_method,cost }
  },
  specifics { key,value },
  category,size_chart,print_document,
  print_areas { key,print,width,height,addition_price,is_required,is_embroidery },
  print_template,weight,package_width,package_height,package_length,
  collection,visible,skip_design_check,skip_affiliate,product_tag_ids,product_technique_ids
}}`;

interface OnospodProduct {
  _id?: string;
  sku?: string | null;
  slug?: string | null;
  identity?: string | null;
  name?: string | null;
  image?: string | null;
  images_thumbnail?: (string | null)[] | null;
  description?: string | null;
  short_description?: string | null;
  template_description?: string | null;
  attribute_specifics?:
    | {
        sku?: string | null;
        nonship_price?: number | null;
        tiktok_final_price?: number | null;
        wholesale_price?: number | null;
        sale_price?: number | null;
        base_price?: number | null;
        name_value?: { name?: string | null; type?: string | null; value?: string | null }[] | null;
        weight?: number | null;
        package_width?: number | null;
        package_height?: number | null;
        package_length?: number | null;
        shipping_methods?: { shipping_method?: string | null; cost?: number | null }[] | null;
      }[]
    | null;
  specifics?: { key?: string | null; value?: string | null }[] | null;
  category?: string | null;
  size_chart?: string | null;
  print_document?: string | null;
  print_areas?:
    | {
        key?: string | null;
        print?: string | null;
        width?: number | null;
        height?: number | null;
        addition_price?: number | null;
        is_required?: boolean | null;
        is_embroidery?: boolean | null;
      }[]
    | null;
  print_template?: string | null;
  weight?: number | null;
  package_width?: number | null;
  package_height?: number | null;
  package_length?: number | null;
  collection?: string | null;
  visible?: boolean | null;
  skip_design_check?: boolean | null;
  skip_affiliate?: boolean | null;
  /** Legacy tag ids — resolve through `productTags` (id → slug), see `fetchLegacyTagSlugs`. */
  product_tag_ids?: string[] | null;
  /** Legacy technique ids — resolved through `productTechniques` (id → slug). */
  product_technique_ids?: string[] | null;
}

/** Field mapped từ OnosPod — SUBSET của ProductConfig, dùng cho cả create lẫn fill. */
type MappedProduct = Partial<
  Pick<
    ProductConfig,
    | 'fullName'
    | 'sku'
    | 'slug'
    | 'status'
    | 'mockup'
    | 'images'
    | 'sizeChartUrl'
    | 'description'
    | 'shortDescription'
    | 'templateDescription'
    | 'printArea'
    | 'printDocument'
    | 'printTemplate'
    | 'itemSpecifics'
    | 'weight'
    | 'width'
    | 'height'
    | 'length'
    | 'variations'
    | 'collectionIds'
    | 'productTagIds'
    | 'productTechniqueIds'
    | 'productCategoryId'
    | 'enableDesignCheck'
    | 'enableAffiliate'
  >
>;

/**
 * Các field ĐƯỢC PHÉP fill khi sản phẩm đã tồn tại — CHỈ fill ô đang trống,
 * KHÔNG BAO GIỜ đè giá trị đã có. TUYỆT ĐỐI KHÔNG có nhóm field sản xuất
 * (factoryId/machineTypeId/machineNumber/fabricType/toolResult/level/guide/
 * status/fullName/shortName) — xưởng hiện tại là CHUẨN, xưởng bên cũ sai
 * (quyết định 2026-08-05).
 */
const FILLABLE_FIELDS: (keyof MappedProduct)[] = [
  'sku',
  'slug',
  'mockup',
  'images',
  'sizeChartUrl',
  'description',
  'shortDescription',
  'templateDescription',
  'printArea',
  'printDocument',
  'printTemplate',
  'itemSpecifics',
  'weight',
  'width',
  'height',
  'length',
  'variations',
  'collectionIds',
  'productTagIds',
  'productTechniqueIds',
  'productCategoryId',
  'enableDesignCheck',
  'enableAffiliate',
];

function cleanStr(v: string | null | undefined): string | undefined {
  const s = (v ?? '').trim();
  return s || undefined;
}

function cleanNum(v: number | null | undefined): number | undefined {
  return v == null || v <= 0 ? undefined : v;
}

/** "Trống" = null/undefined/chuỗi rỗng/mảng rỗng — tiêu chí quyết định fill. */
function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sinh mã ngắn từ sku (fallback identity/name), bỏ dấu + uppercase — dùng cho
 * shortName của Collection/ProductCategory tạo kèm và SKU biến thể mặc định.
 * KHÔNG còn dùng cho `ProductConfig.shortName` — import để trống, người dùng
 * tự đặt tên viết tắt. Mã chạy tool nằm ở `designReviewCode` (PRD-2).
 */
function deriveShortName(p: OnospodProduct): string {
  const base = cleanStr(p.sku) ?? cleanStr(p.identity) ?? cleanStr(p.name) ?? 'ONOSPOD';
  const normalized = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  return (normalized || 'ONOSPOD').slice(0, 60);
}

@Injectable()
export class OnospodProductImportService {
  constructor(
    private readonly apiConfigService: ApiConfigService,
    private readonly collectionRepository: CollectionRepository,
    private readonly productCategoryRepository: ProductCategoryRepository,
    private readonly productTagRepository: ProductTagRepository,
    private readonly productTechniqueRepository: ProductTechniqueRepository,
    @InjectModel(ProductConfigEntity.name)
    private readonly productConfigModel: Model<ProductConfigEntity>,
  ) {}

  /** POST one GraphQL query to the legacy API (page/limit travel in headers, not variables). */
  private async gql<T>(query: string, page: number, limit: number) {
    const cfg = this.apiConfigService.onospodApiConfig;
    if (!cfg) {
      throw new BadRequestException(
        'Chưa cấu hình ONOSPOD_API_URL / ONOSPOD_API_BEARER_TOKEN / ONOSPOD_API_SUPER_TOKEN',
      );
    }
    return axios.post<{ data?: T }>(
      cfg.apiUrl,
      { query },
      {
        timeout: 60_000,
        headers: {
          accept: 'application/json, text/plain, */*',
          authorization: `Bearer ${cfg.bearerToken}`,
          'content-type': 'application/json;charset=UTF-8',
          origin: ONOSPOD_ORIGIN,
          referer: `${ONOSPOD_ORIGIN}/`,
          'x-onos-super-token': cfg.superToken,
          'x-page': String(page),
          'x-per-page': String(limit),
          'x-requested-with': 'XMLHttpRequest',
        },
      },
    );
  }

  /** Fetch 1 trang productPreset — trả rows + tổng (header `x-total`). */
  private async fetchPage(page: number, limit: number, collection = ''): Promise<{ rows: OnospodProduct[]; total: number }> {
    const res = await this.gql<{ productPreset?: OnospodProduct[] }>(productPresetQuery(collection), page, limit);
    const rows = res.data?.data?.productPreset ?? [];
    const total = Number(res.headers['x-total'] ?? rows.length) || rows.length;
    return { rows, total };
  }

  /** Legacy tag id → slug. The query is paginated by headers, so ask for a page far larger than the ~18 tags. */
  private async fetchLegacyTagSlugs(): Promise<Map<string, string>> {
    const res = await this.gql<{ productTags?: { _id?: string; slug?: string }[] }>(
      'query { productTags { _id,slug } }',
      1,
      500,
    );
    const map = new Map<string, string>();
    for (const t of res.data?.data?.productTags ?? []) if (t._id && t.slug) map.set(t._id, t.slug);
    return map;
  }

  /** Legacy tag ids → our ProductTag ids, matched by slug = shortName. Unknown tags are skipped, never created. */
  private async resolveTagIds(legacyIds: string[] | null | undefined): Promise<string[] | undefined> {
    const ids: string[] = [];
    for (const legacyId of legacyIds ?? []) {
      const slug = this.legacyTagSlugs.get(legacyId);
      if (!slug) continue;
      const tag = await this.productTagRepository.findOne({ shortName: slug.toUpperCase() });
      if (tag && !ids.includes(String(tag._id))) ids.push(String(tag._id));
    }
    return ids.length ? ids : undefined;
  }

  /** Legacy technique id → slug (same pagination caveat as tags). */
  private async fetchLegacyTechniqueSlugs(): Promise<Map<string, string>> {
    const res = await this.gql<{ productTechniques?: { _id?: string; slug?: string }[] }>(
      'query { productTechniques { _id,slug } }',
      1,
      500,
    );
    const map = new Map<string, string>();
    for (const t of res.data?.data?.productTechniques ?? []) if (t._id && t.slug) map.set(t._id, t.slug);
    return map;
  }

  /** Legacy technique ids → our ProductTechnique ids, matched by slug = shortName. Unknown ones are skipped. */
  private async resolveTechniqueIds(legacyIds: string[] | null | undefined): Promise<string[] | undefined> {
    const ids: string[] = [];
    for (const legacyId of legacyIds ?? []) {
      const slug = this.legacyTechniqueSlugs.get(legacyId);
      if (!slug) continue;
      const technique = await this.productTechniqueRepository.findOne({ shortName: slug.toUpperCase() });
      if (technique && !ids.includes(String(technique._id))) ids.push(String(technique._id));
    }
    return ids.length ? ids : undefined;
  }

  private legacyTagSlugs = new Map<string, string>();
  private legacyTechniqueSlugs = new Map<string, string>();

  /** Cache theo lifetime service — collection/category tra theo TÊN (case-insensitive), thiếu thì tạo. */
  private readonly collectionIdCache = new Map<string, string>();
  private readonly categoryIdCache = new Map<string, string>();

  /**
   * Tạo với shortName derive từ tên; đụng unique index `shortName` (danh mục
   * KHÁC TÊN nhưng trùng shortName derive — vd danh mục nội bộ tên tiếng Việt
   * đã chiếm "APPAREL") → retry 1 lần với suffix random, GIỮ danh mục là 1
   * entry riêng thay vì gộp nhầm vào danh mục khác tên.
   */
  private async createWithUniqueShortName(
    repo: { create: (data: { name: string; shortName: string }) => Promise<{ _id: string }> },
    name: string,
    maxLen: number,
  ): Promise<string> {
    const shortName = deriveShortName({ name }).slice(0, maxLen);
    try {
      return (await repo.create({ name, shortName }))._id;
    } catch (err) {
      if (!OnospodProductImportService.isDuplicateKeyError(err)) throw err;
      const suffix = `-${myNanoid(4).toUpperCase()}`;
      return (await repo.create({ name, shortName: shortName.slice(0, maxLen - suffix.length) + suffix }))._id;
    }
  }

  private async resolveCollectionId(name: string): Promise<string> {
    const key = name.toLowerCase();
    const cached = this.collectionIdCache.get(key);
    if (cached) return cached;
    const existing = await this.collectionRepository.findOne({
      name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    });
    const id = existing?._id ?? (await this.createWithUniqueShortName(this.collectionRepository, name, 30));
    this.collectionIdCache.set(key, id);
    return id;
  }

  private async resolveCategoryId(name: string): Promise<string> {
    const key = name.toLowerCase();
    const cached = this.categoryIdCache.get(key);
    if (cached) return cached;
    const existing = await this.productCategoryRepository.findOne({
      name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    });
    const id = existing?._id ?? (await this.createWithUniqueShortName(this.productCategoryRepository, name, 20));
    this.categoryIdCache.set(key, id);
    return id;
  }

  /** Map 1 doc OnosPod → subset ProductConfig (rule transform xem `Products.md §2.7`). */
  private async mapProduct(p: OnospodProduct): Promise<MappedProduct> {
    const printArea: ProductPrintAreaItem[] = (p.print_areas ?? [])
      .filter(
        (a): a is NonNullable<typeof a> => !!a && (PRODUCT_PRINT_AREA_KEYS as readonly string[]).includes(a.key ?? ''),
      )
      .map((a) => ({
        key: a.key as ProductPrintAreaItem['key'],
        templateUrl: cleanStr(a.print),
        widthPx: cleanNum(a.width),
        heightPx: cleanNum(a.height),
        // Hệ cũ mặc định bắt buộc — chỉ ghi nhận false tường minh.
        isRequired: a.is_required !== false,
        additionPrice: cleanNum(a.addition_price),
        isEmbroidery: a.is_embroidery === true ? true : undefined,
      }));

    const variations: ProductVariation[] = (p.attribute_specifics ?? [])
      .map((v): ProductVariation | null => {
        const sku = cleanStr(v.sku)?.toUpperCase();
        if (!sku) return null;
        // Data thật có `name` rỗng, chỉ có `type` ("Size") — fallback name || type.
        const attributes: ProductItemSpecific[] = (v.name_value ?? [])
          .map((nv) => ({ label: cleanStr(nv.name) ?? cleanStr(nv.type) ?? '', value: cleanStr(nv.value) ?? '' }))
          .filter((a) => a.label && a.value);
        const ship = (method: string) => cleanNum(v.shipping_methods?.find((m) => m.shipping_method === method)?.cost);
        return {
          sku,
          attributes: attributes.length ? attributes : undefined,
          cost: cleanNum(v.base_price),
          nonShipCost: cleanNum(v.nonship_price),
          retailPrice: cleanNum(v.sale_price),
          wholesalePrice: cleanNum(v.wholesale_price),
          tiktokPrice: cleanNum(v.tiktok_final_price),
          expUsShipCost: ship('EXPRESS_US'),
          tiktokShipCost: ship('SBTT'),
          weight: cleanNum(v.weight),
          width: cleanNum(v.package_width),
          height: cleanNum(v.package_height),
          length: cleanNum(v.package_length),
          status: Status.Active,
        };
      })
      .filter((v): v is ProductVariation => v !== null);

    const itemSpecifics: ProductItemSpecific[] = (p.specifics ?? [])
      .map((s) => ({ label: cleanStr(s.key) ?? '', value: cleanStr(s.value) ?? '' }))
      .filter((s) => s.label && s.value);

    const images = (p.images_thumbnail ?? []).map((u) => cleanStr(u)).filter((u): u is string => !!u);

    const collectionName = cleanStr(p.collection);
    const categoryName = cleanStr(p.category);

    return {
      fullName: cleanStr(p.name),
      // KHÔNG derive shortName cho ProductConfig — sản phẩm import mới để trống,
      // người dùng tự đặt. Mã chạy tool là trường riêng `designReviewCode` (PRD-2).
      sku: cleanStr(p.sku)?.toUpperCase(),
      slug: cleanStr(p.slug),
      status: p.visible === false ? ProductConfigStatus.Inactive : ProductConfigStatus.Active,
      mockup: cleanStr(p.image),
      images: images.length ? images : undefined,
      sizeChartUrl: cleanStr(p.size_chart),
      description: cleanStr(p.description),
      shortDescription: cleanStr(p.short_description),
      templateDescription: cleanStr(p.template_description),
      printArea: printArea.length ? printArea : undefined,
      printDocument: cleanStr(p.print_document),
      printTemplate: cleanStr(p.print_template),
      itemSpecifics: itemSpecifics.length ? itemSpecifics : undefined,
      weight: cleanNum(p.weight),
      width: cleanNum(p.package_width),
      height: cleanNum(p.package_height),
      length: cleanNum(p.package_length),
      variations: variations.length ? variations : undefined,
      productTagIds: await this.resolveTagIds(p.product_tag_ids),
      productTechniqueIds: await this.resolveTechniqueIds(p.product_technique_ids),
      collectionIds: collectionName ? [await this.resolveCollectionId(collectionName)] : undefined,
      productCategoryId: categoryName ? await this.resolveCategoryId(categoryName) : undefined,
      enableDesignCheck: p.skip_design_check == null ? undefined : !p.skip_design_check,
      enableAffiliate: p.skip_affiliate == null ? undefined : !p.skip_affiliate,
    };
  }

  /** E11000 từ unique index sku / variations.sku. */
  private static isDuplicateKeyError(err: unknown): boolean {
    return !!err && typeof err === 'object' && (err as { code?: number }).code === 11000;
  }

  /**
   * Import 1 trang từ OnosPod — upsert FILL-ONLY:
   * - Khớp sản phẩm hiện có theo `sku` (uppercase) trước, rồi `fullName`
   *   (exact, case-insensitive).
   * - Đã tồn tại → CHỈ set field đang trống (`FILLABLE_FIELDS`), giữ nguyên
   *   toàn bộ field sản xuất + mọi giá trị đã cấu hình tay.
   * - Chưa tồn tại → tạo mới (KHÔNG factory/machineType → tự rơi vào cột
   *   "Chưa xác định xưởng" ở kanban Settings để gán tay sau).
   * - Trùng SKU biến thể với sản phẩm khác (unique toàn hệ thống) → retry 1
   *   lần không kèm `variations`, ghi nhận lỗi để xử lý tay.
   */
  async importFromOnospod(dto: ImportFromOnospodDto): Promise<ImportFromOnospodResDto> {
    const { rows: rawRows, total } = await this.fetchPage(dto.page, dto.limit, dto.collection);
    const errors: OnospodImportError[] = [];
    try {
      this.legacyTagSlugs = await this.fetchLegacyTagSlugs();
    } catch (err) {
      // Tags are secondary: import the products without them rather than failing the whole run.
      this.legacyTagSlugs = new Map();
      errors.push({ sku: '', name: '', reason: `Không lấy được danh sách tag hệ cũ: ${err instanceof Error ? err.message : String(err)}` });
    }
    try {
      this.legacyTechniqueSlugs = await this.fetchLegacyTechniqueSlugs();
    } catch (err) {
      this.legacyTechniqueSlugs = new Map();
      errors.push({ sku: '', name: '', reason: `Không lấy được danh sách technique hệ cũ: ${err instanceof Error ? err.message : String(err)}` });
    }
    // Dedupe theo _id — phân trang OnosPod không ổn định (thứ tự trượt giữa
    // các lần gọi), cùng 1 trang lớn vẫn dedupe phòng hờ. Khuyến nghị FE gọi
    // 1 LẦN limit 500 thay vì nhiều trang nhỏ (xem `ImportFromOnospodZod`).
    const seenIds = new Set<string>();
    const rows = rawRows.filter((r) => {
      const id = r._id ?? JSON.stringify(r.sku ?? r.name);
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    let created = 0;
    let filled = 0;
    let skipped = 0;

    for (const p of rows) {
      const name = cleanStr(p.name);
      const skuRaw = cleanStr(p.sku)?.toUpperCase();
      try {
        if (!name) {
          errors.push({ sku: skuRaw ?? '', name: '', reason: 'Thiếu tên sản phẩm' });
          continue;
        }

        const mapped = await this.mapProduct(p);
        const existing =
          (skuRaw ? await this.productConfigModel.findOne({ sku: skuRaw }).lean() : null) ??
          (await this.productConfigModel
            .findOne({ fullName: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } })
            .lean());

        if (!existing) {
          try {
            await this.productConfigModel.create({ ...mapped, ...productLineForNew(p.collection) });
          } catch (err) {
            if (!OnospodProductImportService.isDuplicateKeyError(err)) throw err;
            // SKU (sản phẩm hoặc biến thể) đụng unique index của sản phẩm khác
            // → vẫn tạo phần còn lại, bỏ 2 field đụng độ.
            await this.productConfigModel.create({
              ...mapped,
              ...productLineForNew(p.collection),
              sku: undefined,
              variations: undefined,
            });
            errors.push({
              sku: skuRaw ?? '',
              name,
              reason: 'Trùng SKU với sản phẩm khác — đã tạo KHÔNG kèm sku/biến thể',
            });
          }
          created++;
          continue;
        }

        const set: Record<string, unknown> = {};
        for (const field of FILLABLE_FIELDS) {
          const next = mapped[field];
          if (next === undefined) continue;
          if (!isEmptyValue((existing as Record<string, unknown>)[field])) continue;
          set[field] = next;
        }

        if (Object.keys(set).length === 0) {
          skipped++;
          continue;
        }

        try {
          await this.productConfigModel.updateOne({ _id: existing._id }, { $set: set });
        } catch (err) {
          if (!OnospodProductImportService.isDuplicateKeyError(err) || !('variations' in set)) throw err;
          delete set.variations;
          errors.push({
            sku: skuRaw ?? '',
            name,
            reason: 'Trùng SKU biến thể với sản phẩm khác — đã fill các field còn lại',
          });
          if (Object.keys(set).length > 0)
            await this.productConfigModel.updateOne({ _id: existing._id }, { $set: set });
        }
        filled++;
      } catch (err) {
        errors.push({ sku: skuRaw ?? '', name: name ?? '', reason: err instanceof Error ? err.message : String(err) });
      }
    }

    // `x-total` bên OnosPod có thể LỚN HƠN số dòng thật trả về (178 vs 167 —
    // nghi gồm cả record đã xóa mềm) → trang trả về ÍT hơn limit cũng coi là hết.
    const nextPage = dto.page * dto.limit >= total || rawRows.length < dto.limit ? null : dto.page + 1;

    // Bước cuối: sản phẩm còn trống biến thể (kể cả KHÔNG có bên OnosPod, vd
    // "Embroidered Sweatshirt") → tạo 1 biến thể mặc định để hiện được trong
    // catalog khách + có chỗ lưu giá (admin nhập `retailPrice` ở trang chi tiết).
    const defaultVariationsCreated = nextPage === null ? await this.ensureDefaultVariations(errors) : undefined;

    return {
      success: true,
      data: { total, processed: rows.length, created, filled, skipped, errors, nextPage, defaultVariationsCreated },
    };
  }

  /**
   * Tạo 1 biến thể mặc định (`{SKU|shortName}-DEFAULT`, không attributes, CHƯA
   * có giá) cho mọi Product Config đang trống `variations` — điều kiện tối
   * thiểu để sản phẩm hiện trong catalog khách (`variations` non-empty).
   * Idempotent: sản phẩm đã có biến thể (kể cả default tạo từ lần trước) bị
   * bỏ qua. Đụng unique `variations.sku` → retry 1 lần với suffix random.
   */
  private async ensureDefaultVariations(errors: OnospodImportError[]): Promise<number> {
    const missing = await this.productConfigModel
      .find({ $or: [{ variations: { $exists: false } }, { variations: { $size: 0 } }] })
      .select('fullName shortName sku')
      .lean();

    let createdCount = 0;
    for (const p of missing) {
      // Chuẩn hóa qua deriveShortName — shortName nhập tay có thể chứa dấu/
      // khoảng trắng ("SWEATSHIRT THÊU"), SKU quy ước không dấu + A-Z0-9.
      const base = deriveShortName({ sku: p.sku, identity: p.shortName, name: p.fullName });
      const makeVariation = (sku: string): ProductVariation => ({ sku, status: Status.Active });
      try {
        await this.productConfigModel.updateOne(
          { _id: p._id },
          { $set: { variations: [makeVariation(`${base}-DEFAULT`)] } },
        );
        createdCount++;
      } catch (err) {
        if (!OnospodProductImportService.isDuplicateKeyError(err)) throw err;
        try {
          await this.productConfigModel.updateOne(
            { _id: p._id },
            { $set: { variations: [makeVariation(`${base}-DEFAULT-${myNanoid(4).toUpperCase()}`)] } },
          );
          createdCount++;
        } catch (err2) {
          errors.push({
            sku: p.sku ?? '',
            name: p.fullName,
            reason: `Không tạo được biến thể mặc định: ${err2 instanceof Error ? err2.message : String(err2)}`,
          });
        }
      }
    }
    return createdCount;
  }
}
