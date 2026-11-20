import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CUSTOMER_ASSIGNMENT_CONFIG_KEY,
  CUSTOMER_PRIORITY_CONFIG_KEY,
  CustomerAssignmentConfig,
  customerMatchKey,
  CustomerPriorityConfig,
  OrderPriority,
  SaveCustomerAssignmentConfigDto,
  SaveCustomerPriorityConfigDto,
} from 'shared';

import { CustomerRepository } from '../customer/customer.repository';
import { SystemConfigService } from '../system-config/system-config.service';

const EMPTY_CONFIG: CustomerAssignmentConfig = { enabled: false, factories: [] };
const EMPTY_PRIORITY_CONFIG: CustomerPriorityConfig = { enabled: false, levels: [] };

@Injectable()
export class CustomerAssignmentService {
  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly customerRepository: CustomerRepository,
  ) {}

  async getConfig(): Promise<CustomerAssignmentConfig> {
    const cfg = await this.systemConfigService.get<CustomerAssignmentConfig>(
      CUSTOMER_ASSIGNMENT_CONFIG_KEY,
      EMPTY_CONFIG,
    );
    return cfg ?? EMPTY_CONFIG;
  }

  /**
   * Lưu cấu hình. Bất biến **1 khách chỉ thuộc 1 xưởng** — nếu 1 customerId xuất
   * hiện ở ≥ 2 xưởng (hoặc lặp trong cùng xưởng) thì từ chối (BadRequest).
   */
  async saveConfig(dto: SaveCustomerAssignmentConfigDto): Promise<CustomerAssignmentConfig> {
    const seen = new Set<string>();
    for (const f of dto.factories) {
      const localSeen = new Set<string>();
      for (const id of f.customerIds) {
        const cid = String(id);
        if (localSeen.has(cid)) {
          throw new BadRequestException('Khách hàng bị lặp trong cùng một xưởng — mỗi khách chỉ khai báo một lần.');
        }
        localSeen.add(cid);
        if (seen.has(cid)) {
          throw new BadRequestException(
            'Khách hàng đã được cấu hình ở một xưởng khác — mỗi khách chỉ thuộc một xưởng.',
          );
        }
        seen.add(cid);
      }
    }

    const value: CustomerAssignmentConfig = {
      enabled: dto.enabled,
      factories: dto.factories.filter((f) => f.customerIds.length > 0),
      updatedAt: new Date().toISOString(),
    };
    await this.systemConfigService.set(
      CUSTOMER_ASSIGNMENT_CONFIG_KEY,
      value,
      'Cấu hình ưu tiên gán xưởng theo khách hàng',
    );
    return value;
  }

  /**
   * Dựng map dùng cho `importOrders`: khóa `customerMatchKey(userSku, userEmail)`
   * → `factoryId` ép. Trả `enabled=false` (map rỗng) khi config tắt → import giữ
   * nguyên luồng product config.
   */
  async getImportOverride(): Promise<{ enabled: boolean; map: Map<string, string> }> {
    const cfg = await this.getConfig();
    const map = new Map<string, string>();
    if (!cfg.enabled || cfg.factories.length === 0) {
      return { enabled: false, map };
    }
    const idToFactory = new Map<string, string>();
    for (const f of cfg.factories) {
      for (const cid of f.customerIds) idToFactory.set(String(cid), String(f.factoryId));
    }
    if (idToFactory.size === 0) return { enabled: false, map };

    const customers = await this.customerRepository.findMatchRowsByIds(Array.from(idToFactory.keys()));
    for (const c of customers) {
      const factoryId = idToFactory.get(String(c._id));
      if (factoryId) map.set(customerMatchKey(c.userSku, c.userEmail), factoryId);
    }
    return { enabled: map.size > 0, map };
  }

  async getPriorityConfig(): Promise<CustomerPriorityConfig> {
    const cfg = await this.systemConfigService.get<CustomerPriorityConfig>(
      CUSTOMER_PRIORITY_CONFIG_KEY,
      EMPTY_PRIORITY_CONFIG,
    );
    return cfg ?? EMPTY_PRIORITY_CONFIG;
  }

  /**
   * Lưu cấu hình ưu tiên đơn theo khách. Bất biến **1 khách chỉ thuộc 1 mức
   * ưu tiên** — 1 customerId ở ≥ 2 mức (hoặc lặp trong cùng mức) → BadRequest.
   */
  async savePriorityConfig(dto: SaveCustomerPriorityConfigDto): Promise<CustomerPriorityConfig> {
    const seen = new Set<string>();
    for (const level of dto.levels) {
      const localSeen = new Set<string>();
      for (const id of level.customerIds) {
        const cid = String(id);
        if (localSeen.has(cid)) {
          throw new BadRequestException(
            'Khách hàng bị lặp trong cùng một mức ưu tiên — mỗi khách chỉ khai báo một lần.',
          );
        }
        localSeen.add(cid);
        if (seen.has(cid)) {
          throw new BadRequestException(
            'Khách hàng đã được cấu hình ở một mức ưu tiên khác — mỗi khách chỉ thuộc một mức.',
          );
        }
        seen.add(cid);
      }
    }

    const value: CustomerPriorityConfig = {
      enabled: dto.enabled,
      levels: dto.levels.filter((l) => l.customerIds.length > 0),
      updatedAt: new Date().toISOString(),
    };
    await this.systemConfigService.set(CUSTOMER_PRIORITY_CONFIG_KEY, value, 'Cấu hình ưu tiên đơn theo khách hàng');
    return value;
  }

  /**
   * Map dùng cho `importOrders`: `customerMatchKey(userSku, userEmail)` →
   * `OrderPriority` auto-gán cho đơn CHƯA có priority. Trả `enabled=false`
   * (map rỗng) khi config tắt.
   */
  async getPriorityImportOverride(): Promise<{ enabled: boolean; map: Map<string, OrderPriority> }> {
    const cfg = await this.getPriorityConfig();
    const map = new Map<string, OrderPriority>();
    if (!cfg.enabled || cfg.levels.length === 0) {
      return { enabled: false, map };
    }
    const idToPriority = new Map<string, OrderPriority>();
    for (const level of cfg.levels) {
      for (const cid of level.customerIds) idToPriority.set(String(cid), level.priority);
    }
    if (idToPriority.size === 0) return { enabled: false, map };

    const customers = await this.customerRepository.findMatchRowsByIds(Array.from(idToPriority.keys()));
    for (const c of customers) {
      const priority = idToPriority.get(String(c._id));
      if (priority) map.set(customerMatchKey(c.userSku, c.userEmail), priority);
    }
    return { enabled: map.size > 0, map };
  }

  /**
   * Danh sách khách ưu tiên (kèm mức) cho báo cáo Telegram — sort mức cao →
   * thấp rồi userSku A→Z. KHÔNG check `enabled`: công tắc chỉ điều khiển
   * auto-gán priority lúc import; báo cáo luôn hiện khách đã kéo vào cột.
   */
  async getPriorityCustomers(): Promise<Array<{ priority: OrderPriority; userSku: string; userEmail: string }>> {
    const cfg = await this.getPriorityConfig();
    if (cfg.levels.length === 0) return [];

    const idToPriority = new Map<string, OrderPriority>();
    for (const level of cfg.levels) {
      for (const cid of level.customerIds) idToPriority.set(String(cid), level.priority);
    }
    if (idToPriority.size === 0) return [];

    const customers = await this.customerRepository.findMatchRowsByIds(Array.from(idToPriority.keys()));

    return customers
      .map((c) => ({
        priority: idToPriority.get(String(c._id)) as OrderPriority,
        userSku: c.userSku,
        userEmail: c.userEmail,
      }))
      .filter((c) => !!c.priority)
      .sort((a, b) => b.priority - a.priority || a.userSku.localeCompare(b.userSku));
  }
}
