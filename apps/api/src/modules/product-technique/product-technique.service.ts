import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { CreateProductTechniqueDto, GetProductTechniquesDto, GetProductTechniquesResDto, UpdateProductTechniqueDto } from 'shared';

import { ProductTechniqueRepository } from './product-technique.repository';
import { LEGACY_PRODUCT_TECHNIQUES } from './product-technique.seed';

@Injectable()
export class ProductTechniqueService implements OnModuleInit {
  private readonly logger = new Logger(ProductTechniqueService.name);

  constructor(private readonly productTechniqueRepository: ProductTechniqueRepository) {}

  /**
   * Seeds the legacy techniques that do not exist yet (matched by shortName, so re-runs and a tag
   * renamed in the UI never duplicate). Failures are logged, never thrown: boot must not depend on it.
   */
  async onModuleInit(): Promise<void> {
    try {
      let created = 0;
      for (const [i, tag] of LEGACY_PRODUCT_TECHNIQUES.entries()) {
        const shortName = tag.slug.toUpperCase();
        if (await this.productTechniqueRepository.findOne({ shortName })) continue;
        try {
          await this.productTechniqueRepository.create({ name: tag.name, shortName, sortOrder: i, isActive: true });
          created++;
        } catch (err) {
          // Two Nest contexts boot in one process: the loser of the unique-index race is fine.
          if ((err as { code?: number }).code !== 11000) throw err;
        }
      }
      if (created > 0) this.logger.log(`seeded ${created} legacy product techniques`);
    } catch (err) {
      this.logger.error(`legacy product technique seed failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getProductTechniques(dto: GetProductTechniquesDto): Promise<GetProductTechniquesResDto> {
    const { page, limit, sort, order, search, isActive } = dto;
    const filter: Record<string, unknown> = {};
    if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { shortName: { $regex: search, $options: 'i' } }];
    if (typeof isActive === 'boolean') filter.isActive = isActive;

    const { data, total } = await this.productTechniqueRepository.findAllAndCount(filter, {
      paging: { skip: limit * (page - 1), limit },
      sort: sort ? { [sort]: order === 'asc' ? 1 : -1 } : { sortOrder: 1, createdAt: -1 },
    });

    return { success: true, data, total };
  }

  async getProductTechnique(id: string) {
    const productTechnique = await this.productTechniqueRepository.findOneById(id);
    if (!productTechnique) throw new NotFoundException('Product technique not found');
    return productTechnique;
  }

  /** Match an import label to `name` or `shortName` — exact, case-insensitive. */
  async findByLabel(label: string) {
    const cleaned = label.trim();
    if (!cleaned) return null;
    const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.productTechniqueRepository.findOne({
      $or: [{ name: { $regex: `^${escaped}$`, $options: 'i' } }, { shortName: cleaned.toUpperCase() }],
    });
  }

  async createProductTechnique(dto: CreateProductTechniqueDto) {
    const existing = await this.productTechniqueRepository.findOne({ shortName: dto.shortName.toUpperCase() });
    if (existing) throw new BadRequestException('Product technique shortName already exists');
    return this.productTechniqueRepository.create({
      ...dto,
      shortName: dto.shortName.toUpperCase(),
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
  }

  async updateProductTechnique(id: string, dto: UpdateProductTechniqueDto) {
    const productTechnique = await this.productTechniqueRepository.findOneAndUpdate(
      { _id: id },
      { ...dto, ...(dto.shortName ? { shortName: dto.shortName.toUpperCase() } : {}) },
    );
    if (!productTechnique) throw new NotFoundException('Product technique not found');
    return productTechnique;
  }
}
