import { Types } from 'mongoose';
import {
  CustomerAssignmentConfigZod,
  customerMatchKey,
  CustomerPriorityConfigZod,
  DesignerCustomerAllocZod,
  OrderPriority,
} from 'shared';

import { CustomerRepository } from '../customer/customer.repository';
import { OrderService } from '../order/order.service';
import { CustomerAssignmentService } from './customer-assignment.service';

/**
 * Khách tạo qua `customers/sync` có `_id` ObjectId (24 hex) — FFMTEEZ trên prod.
 * Phủ đủ đường đi của mã khách dạng này qua 3 cấu hình theo khách: lưu cấu hình
 * (DTO) → tra khách → dựng map import / báo cáo / auto-gán designer mức 1.
 */
const OID_HEX = '6aee9c64d506256f5c5d57cb';
const STR_ID = 'VOV00HY8Z5BIHFX0';
const ML = '80HF1JV8P6CLEBUQ';
const DESIGNER = '06LL3JEABD5GT8S7';

function fakeCustomerModel(docs: Array<Record<string, unknown>>) {
  const sameId = (a: unknown, b: unknown) =>
    a instanceof Types.ObjectId || b instanceof Types.ObjectId
      ? a instanceof Types.ObjectId && b instanceof Types.ObjectId && a.equals(b)
      : a === b;
  return {
    collection: {
      find: (filter: { _id: { $in: unknown[] } }) => ({
        toArray: () =>
          Promise.resolve(docs.filter((d) => filter._id.$in.some((id) => sameId(id, d._id)) && !('deletedAt' in d))),
      }),
    },
  };
}

const CUSTOMERS = [
  { _id: new Types.ObjectId(OID_HEX), userSku: 'FFMTEEZ', userEmail: 'ffm.teez@gmail.com' },
  { _id: STR_ID, userSku: 'SHOPA', userEmail: 'a@x.com' },
];

function serviceWith(configs: Record<string, unknown>) {
  const repo = new CustomerRepository(fakeCustomerModel(CUSTOMERS) as never);
  const systemConfig = { get: jest.fn((key: string) => Promise.resolve(configs[key] ?? null)) };
  return new CustomerAssignmentService(systemConfig as never, repo);
}

describe('Lưu cấu hình với mã khách ObjectId (24 ký tự)', () => {
  it('ép xưởng theo khách', () => {
    const r = CustomerAssignmentConfigZod.safeParse({
      enabled: true,
      factories: [{ factoryId: ML, customerIds: [OID_HEX, STR_ID] }],
    });
    expect(r.success).toBe(true);
  });

  it('ưu tiên theo khách', () => {
    const r = CustomerPriorityConfigZod.safeParse({
      enabled: true,
      levels: [{ priority: OrderPriority.High, customerIds: [OID_HEX] }],
    });
    expect(r.success).toBe(true);
  });

  it('vẫn chặn mã khách rỗng', () => {
    const r = CustomerAssignmentConfigZod.safeParse({
      enabled: true,
      factories: [{ factoryId: ML, customerIds: ['  '] }],
    });
    expect(r.success).toBe(false);
  });

  it('gán designer theo khách', () => {
    const r = DesignerCustomerAllocZod.safeParse({ designerId: DESIGNER, customerIds: [OID_HEX] });
    expect(r.success).toBe(true);
  });
});

describe('Dựng map từ cấu hình chứa khách ObjectId', () => {
  it('ép xưởng: cả khách ObjectId lẫn khách mã chuỗi', async () => {
    const svc = serviceWith({
      customer_assignment_config: { enabled: true, factories: [{ factoryId: ML, customerIds: [OID_HEX, STR_ID] }] },
    });
    const o = await svc.getImportOverride();
    expect(o.map.get(customerMatchKey('FFMTEEZ', 'ffm.teez@gmail.com'))).toBe(ML);
    expect(o.map.get(customerMatchKey('SHOPA', 'a@x.com'))).toBe(ML);
  });

  it('ép xưởng: config tắt → không ép', async () => {
    const svc = serviceWith({
      customer_assignment_config: { enabled: false, factories: [{ factoryId: ML, customerIds: [OID_HEX] }] },
    });
    expect((await svc.getImportOverride()).enabled).toBe(false);
  });

  it('ưu tiên lúc import', async () => {
    const svc = serviceWith({
      customer_priority_config: { enabled: true, levels: [{ priority: 3, customerIds: [OID_HEX] }] },
    });
    const o = await svc.getPriorityImportOverride();
    expect(o.enabled).toBe(true);
    expect(o.map.get(customerMatchKey('FFMTEEZ', 'ffm.teez@gmail.com'))).toBe(3);
  });

  it('danh sách khách ưu tiên cho báo cáo Telegram', async () => {
    const svc = serviceWith({
      customer_priority_config: { enabled: true, levels: [{ priority: 3, customerIds: [OID_HEX] }] },
    });
    expect(await svc.getPriorityCustomers()).toEqual([
      { priority: 3, userSku: 'FFMTEEZ', userEmail: 'ffm.teez@gmail.com' },
    ]);
  });
});

describe('Khớp đơn import với khách (customerMatchKey)', () => {
  const key = customerMatchKey('FFMTEEZ', 'ffm.teez@gmail.com');
  it('email khác hoa thường / thừa khoảng trắng vẫn khớp', () => {
    expect(customerMatchKey(' FFMTEEZ ', ' FFM.Teez@Gmail.com ')).toBe(key);
  });
  it('đơn thiếu email thì KHÔNG khớp khách có email', () => {
    expect(customerMatchKey('FFMTEEZ', '')).not.toBe(key);
  });
});

describe('Auto-gán designer mức 1 với khách ObjectId', () => {
  it('đơn của khách ObjectId được gán thẳng designer chỉ định', async () => {
    const svc = Object.create(OrderService.prototype) as OrderService;
    const lean = <T>(v: T) => ({ lean: () => Promise.resolve(v) });
    Object.assign(svc, {
      systemConfigService: {
        get: () =>
          Promise.resolve({
            customers: [{ designerId: DESIGNER, customerIds: [OID_HEX] }],
            products: [],
            factories: [],
          }),
      },
      customerRepository: new CustomerRepository(fakeCustomerModel(CUSTOMERS) as never),
      orderModel: {
        db: { collection: () => ({ findOne: () => Promise.resolve(null) }) },
        find: () =>
          lean([
            {
              _id: 'ORDER00000000001',
              factoryId: 'ANYFACTORY000001',
              userSku: 'FFMTEEZ',
              userEmail: 'ffm.teez@gmail.com',
            },
          ]),
        aggregate: () => Promise.resolve([]),
      },
      roleRepository: { findOne: () => Promise.resolve({ _id: 'ROLE_DESIGNER' }) },
      userModel: { find: () => lean([{ _id: DESIGNER }]) },
    });
    const plan = await (
      svc as unknown as { computeAutoAssignPlan(ids: string[]): Promise<Map<string, string[]>> }
    ).computeAutoAssignPlan(['ORDER00000000001']);
    expect(plan.get(DESIGNER)).toEqual(['ORDER00000000001']);
  });
});
