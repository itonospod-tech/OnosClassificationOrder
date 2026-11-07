import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type {
  CreateFactoryDto,
  Factory,
  GetFactoriesDto,
  GetFactoriesResDto,
  GetFactoryOptionsResDto,
  UpdateFactoryDto,
} from 'shared';

import { FactoryRepository } from './factory.repository';

const DEFAULT_FACTORIES: Array<Pick<Factory, 'name' | 'shortName' | 'isActive'>> = [
  { name: 'Xưởng Mê Linh', shortName: 'ML', isActive: true },
  { name: 'Xưởng Thái Nguyên', shortName: 'TN', isActive: true },
  { name: 'Xưởng US', shortName: 'US', isActive: true },
];

@Injectable()
export class FactoryService implements OnModuleInit {
  constructor(private readonly factoryRepository: FactoryRepository) {}

  async onModuleInit() {
    for (const f of DEFAULT_FACTORIES) {
      const existing = await this.factoryRepository.findOne({ shortName: f.shortName });
      if (!existing) {
        await this.factoryRepository.create(f);
      }
    }
  }

  async getFactories(dto: GetFactoriesDto): Promise<GetFactoriesResDto> {
    const { page, limit, sort, order, search, isActive } = dto;
    const filter: Record<string, unknown> = {};
    if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { shortName: { $regex: search, $options: 'i' } }];
    if (typeof isActive === 'boolean') filter.isActive = isActive;

    const { data, total } = await this.factoryRepository.findAllAndCount(filter, {
      paging: { skip: limit * (page - 1), limit },
      sort: { [sort || 'createdAt']: order === 'asc' ? 1 : -1 },
    });

    return { success: true, data, total };
  }

  /**
   * Danh sách xưởng đang bật, rút gọn (id/name/shortName) — dùng cho sidebar
   * "cụm menu theo xưởng" và mọi select xưởng của tài khoản KHÔNG có quyền vào
   * `GET /factories` (Fulfillment, Designer…). Không phân trang.
   */
  async getFactoryOptions(): Promise<GetFactoryOptionsResDto> {
    const data = await this.factoryRepository.findAll({ isActive: true });
    return {
      success: true,
      data: data
        .map((f) => ({
          _id: String(f._id),
          name: f.name,
          shortName: f.shortName,
          allowToolCheckRework: f.allowToolCheckRework === true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async getFactory(id: string) {
    const factory = await this.factoryRepository.findOneById(id);
    if (!factory) throw new NotFoundException('Factory not found');
    return factory;
  }

  async findByShortName(shortName: string) {
    return this.factoryRepository.findOne({ shortName: shortName.toUpperCase() });
  }

  /**
   * Match a free-text factory label from a spreadsheet against either `name`
   * or `shortName`. Tolerates the "Xưởng " prefix and case differences so that
   * "MÊ LINH", "mê linh", and "Xưởng Mê Linh" all resolve to the same row.
   */
  async findByLabel(label: string) {
    const cleaned = label.replace(/^x[uư][oơ]ng\s+/i, '').trim();
    if (!cleaned) return null;
    const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const byShortName = await this.factoryRepository.findOne({
      shortName: cleaned.toUpperCase(),
    });
    if (byShortName) return byShortName;
    return this.factoryRepository.findOne({
      name: { $regex: '(?:^|\\s)' + escaped + '$', $options: 'i' },
    });
  }

  async createFactory(dto: CreateFactoryDto) {
    const existing = await this.factoryRepository.findOne({ shortName: dto.shortName.toUpperCase() });
    if (existing) throw new BadRequestException('Factory shortName already exists');
    return this.factoryRepository.create({ ...dto, shortName: dto.shortName.toUpperCase(), isActive: dto.isActive ?? true });
  }

  async updateFactory(id: string, dto: UpdateFactoryDto) {
    const factory = await this.factoryRepository.findOneAndUpdate(
      { _id: id },
      { ...dto, ...(dto.shortName ? { shortName: dto.shortName.toUpperCase() } : {}) },
    );
    if (!factory) throw new NotFoundException('Factory not found');
    return factory;
  }
}
