import type { Schema } from 'mongoose';

import { CollectionSchema } from '../collection/collection.entity';
import { CustomerSchema } from '../customer/customer.entity';
import { CustomerNotificationSchema } from '../customer-notification/customer-notification.entity';
import { FactorySchema } from '../factory/factory.entity';
import { InventoryItemSchema } from '../inventory/inventory-item.entity';
import { InventoryReceiptSchema } from '../inventory/inventory-receipt.entity';
import { InventoryTransactionSchema } from '../inventory/inventory-transaction.entity';
import { MachineTypeSchema } from '../machine-type/machine-type.entity';
import { OrderSchema } from '../order/order.entity';
import { OrderLogSchema } from '../order-log/order-log.entity';
import { ProductCategorySchema } from '../product-category/product-category.entity';
import { ProductConfigSchema } from '../product-config/product-config.entity';
import { PromotionSchema } from '../promotion/promotion.entity';
import { WorkshopConfigSchema } from '../workshop-config/workshop-config.entity';
import { AGENT_TABLE_REGISTRY } from './registry';

/**
 * Bất biến I4 của bộ API agent (`API-1`, thiết kế §7.4).
 *
 * Mọi đường dẫn có thật trên schema phải hoặc có mô tả trong `fields`, hoặc nằm
 * trong `deliberatelyExcluded`. Thêm một field mới vào `OrderEntity` mà không
 * quyết định gì về nó thì test này ĐỎ.
 *
 * ⚠️ **Ý NGHĨA ĐÃ ĐỔI Ở `API-19`.** Trước đây đây là chốt an toàn: field mới
 * lọt vào danh sách trắng theo mặc định là rò dữ liệu. Nay field mới **đọc được
 * ngay** dù không khai ở đâu cả, nên test này không còn giữ dữ liệu — nó giữ
 * **chất lượng từ điển**: field mới phải có người viết ghi chú nghiệp vụ cho
 * nó, nếu không agent sẽ đọc được một trường mà không hiểu nó là gì và đoán bừa
 * khi trả lời khách. Đỏ ở đây nghĩa là "còn thiếu mô tả", không phải "đang rò".
 */
const SCHEMAS: Record<string, Schema> = {
  orders: OrderSchema,
  orderLogs: OrderLogSchema,
  customers: CustomerSchema,
  productConfigs: ProductConfigSchema,
  productCategories: ProductCategorySchema,
  collections: CollectionSchema,
  promotions: PromotionSchema,
  factories: FactorySchema,
  machineTypes: MachineTypeSchema,
  workshopConfigs: WorkshopConfigSchema,
  customer_notifications: CustomerNotificationSchema,
  inventory_items: InventoryItemSchema,
  inventory_transactions: InventoryTransactionSchema,
  inventory_receipts: InventoryReceiptSchema,
};

/** Gốc của một đường dẫn: `variations.retailPrice` → `variations`. */
const root = (p: string): string => p.split('.')[0];

describe('I4 — registry phải phủ hết đường dẫn thật của schema', () => {
  it.each(Object.keys(SCHEMAS))('%s: không field nào của schema bị bỏ quên', (table) => {
    const spec = AGENT_TABLE_REGISTRY[table];
    const schema = SCHEMAS[table];

    const decided = new Set<string>([
      ...Object.keys(spec.fields).map(root),
      ...spec.deliberatelyExcluded.map(root),
    ]);

    const forgotten = Object.keys(schema.paths)
      .filter((p) => p !== '__v')
      .map(root)
      .filter((p) => !decided.has(p));

    // Thông điệp cố ý liệt kê tên field: người làm task sau đọc là biết ngay
    // phải quyết định gì, thay vì phải đi dò xem test đỏ vì cái gì.
    expect({ table, forgotten: [...new Set(forgotten)] }).toEqual({ table, forgotten: [] });
  });

  it.each(Object.keys(SCHEMAS))('%s: mọi field trong registry đều CÓ THẬT trên schema', (table) => {
    const spec = AGENT_TABLE_REGISTRY[table];
    const schema = SCHEMAS[table];
    const real = new Set(Object.keys(schema.paths).map(root));

    const ghosts = Object.keys(spec.fields)
      .map(root)
      .filter((p) => !real.has(p));

    // Bắt lỗi gõ sai tên trường: field ma không bao giờ trả về dữ liệu, và
    // trông y hệt "dữ liệu rỗng" khi nhìn từ phía agent.
    expect({ table, ghosts: [...new Set(ghosts)] }).toEqual({ table, ghosts: [] });
  });
});
