import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { CreateProductTagDto, GetProductTagsDto, GetProductTagsResDto, UpdateProductTagDto } from 'shared';

import { ProductTagRepository } from './product-tag.repository';
import { LEGACY_PRODUCT_TAGS } from './product-tag.seed';

@Injectable()
export class ProductTagService implements OnModuleInit {
  private readonly logger = new Logger(ProductTagService.name);

  constructor(private readonly productTagRepository: ProductTagRepository) {}

  /**
   * Seeds the legacy tags that do not exist yet (matched by shortName, so re-runs and a tag
   * renamed in the UI never duplicate). Failures are logged, never thrown: boot must not depend on it.
   */
  async onModuleInit(): Promise<void> {
    try {
      let created = 0;
      for (const [i, tag] of LEGACY_PRODUCT_TAGS.entries()) {
        const shortName = tag.slug.toUpperCase();
        if (await this.productTagRepository.findOne({ shortName })) continue;
        try {
          await this.productTagRepository.create({ name: tag.name, shortName, sortOrder: i, isActive: true });
          created++;
        } catch (err) {
          // Two Nest contexts boot in one process: the loser of the unique-index race is fine.
          if ((err as { code?: number }).code !== 11000) throw err;
        }
      }
      if (created > 0) this.logger.log(`seeded ${created} legacy product tags`);
    } catch (err) {
      this.logger.error(`legacy product tag seed failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getProductTags(dto: GetProductTagsDto): Promise<GetProductTagsResDto> {
    const { page, limit, sort, order, search, isActive } = dto;
    const filter: Record<string, unknown> = {};
    if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { shortName: { $regex: search, $options: 'i' } }];
    if (typeof isActive === 'boolean') filter.isActive = isActive;

    const { data, total } = await this.productTagRepository.findAllAndCount(filter, {
      paging: { skip: limit * (page - 1), limit },
      sort: sort ? { [sort]: order === 'asc' ? 1 : -1 } : { sortOrder: 1, createdAt: -1 },
    });

    return { success: true, data, total };
  }

  async getProductTag(id: string) {
    const productTag = await this.productTagRepository.findOneById(id);
    if (!productTag) throw new NotFoundException('Product tag not found');
    return productTag;
  }

  /** Match an import label to `name` or `shortName` — exact, case-insensitive. */
  async findByLabel(label: string) {
    const cleaned = label.trim();
    if (!cleaned) return null;
    const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.productTagRepository.findOne({
      $or: [{ name: { $regex: `^${escaped}$`, $options: 'i' } }, { shortName: cleaned.toUpperCase() }],
    });
  }

  async createProductTag(dto: CreateProductTagDto) {
    const existing = await this.productTagRepository.findOne({ shortName: dto.shortName.toUpperCase() });
    if (existing) throw new BadRequestException('Product tag shortName already exists');
    return this.productTagRepository.create({
      ...dto,
      shortName: dto.shortName.toUpperCase(),
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
  }

  async updateProductTag(id: string, dto: UpdateProductTagDto) {
    const productTag = await this.productTagRepository.findOneAndUpdate(
      { _id: id },
      { ...dto, ...(dto.shortName ? { shortName: dto.shortName.toUpperCase() } : {}) },
    );
    if (!productTag) throw new NotFoundException('Product tag not found');
    return productTag;
  }
}
