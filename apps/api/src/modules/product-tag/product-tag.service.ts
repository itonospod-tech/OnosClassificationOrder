import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateProductTagDto, GetProductTagsDto, GetProductTagsResDto, UpdateProductTagDto } from 'shared';

import { ProductTagRepository } from './product-tag.repository';

@Injectable()
export class ProductTagService {
  constructor(private readonly productTagRepository: ProductTagRepository) {}

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
