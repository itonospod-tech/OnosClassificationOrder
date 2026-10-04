import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { CustomerCatalogFacet, CustomerCatalogItem, CustomerCatalogPrintArea, CustomerCatalogVariation, GetCustomerCatalogDto, GetCustomerCatalogFacetsResDto, GetCustomerCatalogItemResDto, GetCustomerCatalogResDto, ProductLine, ProductPrintAreaItem } from 'shared';
import { PRODUCT_LINES, PRODUCT_PRINT_AREA_LABEL_MAP, ProductConfigStatus, toFullSizeImageUrl } from 'shared';

import { CollectionEntity } from '@/modules/collection/collection.entity';
import { ProductTagEntity } from '@/modules/product-tag/product-tag.entity';
import type { CustomerDocument } from '@/modules/customer/customer.entity';
import { ProductCategoryEntity } from '@/modules/product-category/product-category.entity';
import { ProductConfigEntity } from '@/modules/product-config/product-config.entity';
import { applyPromotionDiscount, promotionMatches, PromotionService } from '@/modules/promotion/promotion.service';
import { customerMessage } from '@/shared/i18n/customer-messages';

const CATALOG_ROW_SELECT =
  'fullName shortName productCategoryId printMethod productLine printArea printDocument printTemplate mockup images usImportTaxPerUnit sizeChartUrl description itemSpecifics variations';

type ActivePromotion = Awaited<ReturnType<PromotionService['getActiveInDateRange']>>[number];

/**
 * Catalog cho Customer Portal — CHỈ tham khảo (xem sản phẩm + giá tham khảo
 * đã áp discount theo tier của khách), KHÔNG dùng để tính tổng tiền đơn hàng.
 * Ẩn tuyệt đối `cost`/`nonShipCost` (giá vốn nội bộ).
 */
@Injectable()
export class CustomerCatalogService {
  constructor(
    @InjectModel(ProductConfigEntity.name) private readonly productConfigModel: Model<ProductConfigEntity>,
    @InjectModel(ProductCategoryEntity.name) private readonly productCategoryModel: Model<ProductCategoryEntity>,
    @InjectModel(CollectionEntity.name) private readonly collectionModel: Model<CollectionEntity>,
    @InjectModel(ProductTagEntity.name) private readonly productTagModel: Model<ProductTagEntity>,
    private readonly promotionService: PromotionService,
  ) {}

  /**
   * Cổng hiển thị catalog khách hàng: **chỉ dựa vào `status`** — Active, hoặc
   * `null`/thiếu field để tương thích ngược data cũ (`$in: [x, null]` của
   * MongoDB khớp cả document không có field).
   *
   * KHÔNG lọc theo `variations` nữa. Trước đây filter có thêm
   * `variations: { $exists: true, $ne: [] }` để ngầm hiểu "phải có biến thể mới
   * có giá mà hiện" — thực tế dữ liệu gần như không sản phẩm nào nhập biến thể
   * (2/151 doc có field, cả 2 đều là mảng rỗng) nên catalog LUÔN trống. Biến thể
   * chỉ là dữ liệu giá/SKU tùy chọn: sản phẩm chưa có biến thể vẫn xem được
   * (giá hiển thị "—") và vẫn đặt đơn được — `PlaceCustomerOrderItemZod` chỉ bắt
   * buộc `type`, còn `color`/`size` là optional.
   */
  private static readonly VISIBLE_FILTER = { status: { $in: [ProductConfigStatus.Active, null] } };

  /** Map 1 dòng `ProductConfig` (đã `.lean()` + populate `productCategory`) → `CustomerCatalogItem`, áp discount theo tier. */
  private mapRow(
    row: Record<string, unknown> & { _id: unknown; productCategory?: { name?: string } },
    activePromotions: ActivePromotion[],
    tier: number | null,
  ): CustomerCatalogItem {
    const productConfigId = String(row._id);
    const productCategoryId = row.productCategoryId as string | undefined;
    const rowVariations = (row.variations || []) as Array<{
      sku: string;
      attributes?: CustomerCatalogVariation['attributes'];
      status?: string;
      retailPrice?: number;
      nonShipCost?: number;
      tiktokPrice?: number;
      weight?: number;
      width?: number;
      height?: number;
      length?: number;
      packageGram?: number;
    }>;

    const variations: CustomerCatalogVariation[] = rowVariations
      .filter((v) => v.status !== '0')
      .map((v) => {
        const matched = activePromotions
          .filter((p) => promotionMatches(p, { productConfigId, productCategoryId, tier, quantity: 1 }))
          .map((p) => ({
            promotion: p,
            price: v.retailPrice != null ? applyPromotionDiscount(v.retailPrice, p) : undefined,
          }))
          .filter((x): x is { promotion: ActivePromotion; price: number } => x.price != null)
          .sort((a, b) => a.price - b.price);
        const best = matched[0];
        return {
          sku: v.sku,
          attributes: v.attributes,
          retailPrice: v.retailPrice,
          discountedPrice: best?.price,
          appliedPromotionName: best?.promotion.name,
          // `nonShipCost` = GIÁ BÁN nonship hệ cũ (cột "SHIP COD" public trang cũ) — xem CustomerCatalogVariationZod.
          shipCodPrice: v.nonShipCost,
          tiktokPrice: v.tiktokPrice,
          weight: v.weight,
          width: v.width,
          height: v.height,
          length: v.length,
          packageGram: v.packageGram,
        };
      });

    // Chịu được cả 2 dạng data: object giàu (mới) lẫn bare string key (cũ,
    // trước khi backfill onModuleInit chạy) — KHÔNG trả additionPrice/isEmbroidery.
    const printArea: CustomerCatalogPrintArea[] = ((row.printArea || []) as Array<ProductPrintAreaItem | string>).map(
      (p) => {
        const item: ProductPrintAreaItem = typeof p === 'string' ? { key: p as ProductPrintAreaItem['key'] } : p;
        return {
          key: item.key,
          label: PRODUCT_PRINT_AREA_LABEL_MAP[item.key],
          templateUrl: item.templateUrl,
          widthPx: item.widthPx,
          heightPx: item.heightPx,
          isRequired: item.isRequired,
        };
      },
    );

    // Mockup crawl từ onospod lưu bản thumbnail `-100x100`, trong khi ô ảnh
    // catalog rộng ~300px → phóng lên là nhòe. Trả THÊM bản full-size thay vì
    // đè lên `mockup`: ảnh gốc có thể đã bị xóa dù thumbnail còn, nên FE cần
    // giữ được bậc dự phòng rơi ngược về `mockup` trước khi tới ảnh mặc định.
    const mockup = row.mockup as string | undefined;

    return {
      _id: productConfigId,
      fullName: row.fullName as string,
      shortName: (row.shortName as string | undefined) ?? '',
      productCategory: row.productCategory?.name,
      printMethod: row.printMethod as string | undefined,
      productLine: row.productLine as ProductLine | undefined,
      printArea,
      printDocument: row.printDocument as string | undefined,
      printTemplate: row.printTemplate as string | undefined,
      images: row.images as string[] | undefined,
      usImportTaxPerUnit: row.usImportTaxPerUnit as number | undefined,
      mockup,
      mockupLarge: toFullSizeImageUrl(mockup),
      sizeChartUrl: row.sizeChartUrl as string | undefined,
      description: row.description as string | undefined,
      shortDescription: row.shortDescription as string | undefined,
      templateDescription: row.templateDescription as string | undefined,
      itemSpecifics: row.itemSpecifics as CustomerCatalogItem['itemSpecifics'],
      variations,
    };
  }

  async getCatalog(customer: CustomerDocument, dto: GetCustomerCatalogDto): Promise<GetCustomerCatalogResDto> {
    return this.listCatalog(dto, customer.tier ?? null);
  }

  /**
   * Catalog cho trang public `/catalog` (KHÔNG đăng nhập) — xem `PublicCatalogController`.
   *
   * Dùng chung đúng truy vấn/mapping với catalog khách đã đăng nhập, chỉ khác 2 điểm:
   * `tier = null` và KHÔNG áp promotion → chỉ ra `retailPrice` (giá niêm yết),
   * `discountedPrice`/`appliedPromotionName` để trống. Giá theo tier là quyền lợi
   * riêng của khách đã có tài khoản, không lộ ra ngoài.
   */
  async getPublicCatalog(dto: GetCustomerCatalogDto): Promise<GetCustomerCatalogResDto> {
    return this.listCatalog(dto, null, { applyPromotions: false });
  }

  /** 1 sản phẩm cho trang chi tiết public `/catalog/:id` — cùng quy tắc giá với `getPublicCatalog()`. */
  async getPublicCatalogItem(id: string): Promise<GetCustomerCatalogItemResDto> {
    return this.findCatalogItem(id, null, { applyPromotions: false });
  }

  private async listCatalog(
    dto: GetCustomerCatalogDto,
    tier: number | null,
    { applyPromotions = true }: { applyPromotions?: boolean } = {},
  ): Promise<GetCustomerCatalogResDto> {
    const { page, limit, search, productCategoryId, collectionId, productTagId, productLine } = dto;
    const filter: Record<string, unknown> = { ...CustomerCatalogService.VISIBLE_FILTER };
    if (search) filter.fullName = { $regex: search, $options: 'i' };
    if (productCategoryId) filter.productCategoryId = productCategoryId;
    if (collectionId) filter.collectionIds = collectionId;
    if (productTagId) filter.productTagIds = productTagId;
    if (productLine) filter.productLine = productLine;

    const [rows, total, activePromotions] = await Promise.all([
      this.productConfigModel
        .find(filter)
        .select(CATALOG_ROW_SELECT)
        .populate<{ productCategory?: { name: string } }>({ path: 'productCategory', select: 'name' })
        .sort({ fullName: 1 })
        .skip(limit * (page - 1))
        .limit(limit)
        .lean(),
      this.productConfigModel.countDocuments(filter),
      applyPromotions ? this.promotionService.getActiveInDateRange() : Promise.resolve([]),
    ]);

    const data = rows.map((row) => this.mapRow(row, activePromotions, tier));

    return { success: true, data, total };
  }

  /** 1 sản phẩm cho trang chi tiết `/customer/catalog/:id` — cùng cổng hiển thị `status` như danh sách. */
  async getCatalogItem(customer: CustomerDocument, id: string): Promise<GetCustomerCatalogItemResDto> {
    return this.findCatalogItem(id, customer.tier ?? null);
  }

  private async findCatalogItem(
    id: string,
    tier: number | null,
    { applyPromotions = true }: { applyPromotions?: boolean } = {},
  ): Promise<GetCustomerCatalogItemResDto> {
    const [row, activePromotions] = await Promise.all([
      this.productConfigModel
        .findOne({ _id: id, ...CustomerCatalogService.VISIBLE_FILTER })
        // Field nặng (HTML dài) + collectionIds chỉ trả ở API chi tiết, KHÔNG cho list.
        .select(`${CATALOG_ROW_SELECT} collectionIds shortDescription templateDescription`)
        .populate<{ productCategory?: { name: string } }>({ path: 'productCategory', select: 'name' })
        .lean(),
      applyPromotions ? this.promotionService.getActiveInDateRange() : Promise.resolve([]),
    ]);
    if (!row) throw new NotFoundException(customerMessage('productNotFound'));

    const collectionIds = row.collectionIds || [];
    const collections =
      collectionIds.length > 0
        ? await this.collectionModel
            .find({ _id: { $in: collectionIds }, isActive: true })
            .select('name sortOrder')
            .sort({ sortOrder: 1, name: 1 })
            .lean()
        : [];

    const data = this.mapRow(row, activePromotions, tier);
    data.collections = collections.map((c) => c.name);
    return { success: true, data };
  }

  /**
   * Bộ lọc duyệt catalog: danh mục + collection đang active kèm số sản phẩm
   * khách thấy được (cùng cổng hiển thị `status` như danh sách) — chỉ trả mục count > 0.
   */
  async getFacets(): Promise<GetCustomerCatalogFacetsResDto> {
    const visible: Record<string, unknown> = { ...CustomerCatalogService.VISIBLE_FILTER };
    const [categoryCounts, collectionCounts, tagCounts, lineCounts] = await Promise.all([
      this.productConfigModel.aggregate<{ _id: string; count: number }>([
        { $match: { ...visible, productCategoryId: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$productCategoryId', count: { $sum: 1 } } },
      ]),
      this.productConfigModel.aggregate<{ _id: string; count: number }>([
        { $match: visible },
        { $unwind: '$collectionIds' },
        { $group: { _id: '$collectionIds', count: { $sum: 1 } } },
      ]),
      this.productConfigModel.aggregate<{ _id: string; count: number }>([
        { $match: visible },
        { $unwind: '$productTagIds' },
        { $group: { _id: '$productTagIds', count: { $sum: 1 } } },
      ]),
      // PRD-8 — facet dòng sản phẩm (chỉ dòng có ≥1 sản phẩm hiển thị).
      this.productConfigModel.aggregate<{ _id: string; count: number }>([
        { $match: { ...visible, productLine: { $in: PRODUCT_LINES } } },
        { $group: { _id: '$productLine', count: { $sum: 1 } } },
      ]),
    ]);

    const categoryCountMap = new Map(categoryCounts.map((c) => [String(c._id), c.count]));
    const collectionCountMap = new Map(collectionCounts.map((c) => [String(c._id), c.count]));
    const tagCountMap = new Map(tagCounts.map((c) => [String(c._id), c.count]));

    const [categories, collections, tags] = await Promise.all([
      categoryCountMap.size > 0
        ? this.productCategoryModel
            .find({ _id: { $in: [...categoryCountMap.keys()] }, isActive: true })
            .select('name')
            .sort({ name: 1 })
            .lean()
        : Promise.resolve([]),
      collectionCountMap.size > 0
        ? this.collectionModel
            .find({ _id: { $in: [...collectionCountMap.keys()] }, isActive: true })
            .select('name image sortOrder')
            .sort({ sortOrder: 1, name: 1 })
            .lean()
        : Promise.resolve([]),
      tagCountMap.size > 0
        ? this.productTagModel
            .find({ _id: { $in: [...tagCountMap.keys()] }, isActive: true })
            .select('name image sortOrder')
            .sort({ sortOrder: 1, name: 1 })
            .lean()
        : Promise.resolve([]),
    ]);

    const toFacet = (row: { _id: unknown; name: string; image?: string }, count: number): CustomerCatalogFacet => ({
      _id: String(row._id),
      name: row.name,
      image: row.image,
      count,
    });

    return {
      success: true,
      data: {
        categories: categories.map((c) => toFacet(c, categoryCountMap.get(String(c._id)) ?? 0)),
        collections: collections.map((c) => toFacet(c, collectionCountMap.get(String(c._id)) ?? 0)),
        tags: tags.map((c) => toFacet(c, tagCountMap.get(String(c._id)) ?? 0)),
        productLines: PRODUCT_LINES.map((code) => ({ code, count: lineCounts.find((r) => r._id === code)?.count ?? 0 })).filter((r) => r.count > 0),
      },
    };
  }
}
