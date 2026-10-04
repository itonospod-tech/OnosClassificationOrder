import { CustomerOrderService } from './customer-order.service';

/**
 * Đơn đẩy từ Customer Portal phải mang theo `orderAt` + `inProductionAt`.
 *
 * `inProductionAt` là trục thời gian của gần hết hệ thống: bảng "Danh sách
 * đơn" mặc định lọc đúng hôm nay TRÊN chính nó (`Orders.md §7`), Dashboard /
 * Lifecycle / báo cáo Telegram đều bucket theo nó. Đơn portal không đi qua
 * sheet import nên nếu `pushToProduction` không tự điền, trường sẽ trống —
 * và một trường không tồn tại thì KHÔNG khoảng ngày nào khớp, nên đơn vào
 * sản xuất thật nhưng vô hình với xưởng. Đã xảy ra một lần với
 * `QY-02284-48568`; bộ ca này chặn nó quay lại.
 *
 * `orderAt` (lúc khách đặt) tách khỏi `inProductionAt` (lúc vào sản xuất)
 * đúng bằng quãng đơn nằm ở vùng nháp Pending — gộp làm một là mất luôn
 * quãng chờ đó khỏi mọi báo cáo.
 */
type ImportRow = { productionId?: string; orderAt?: string; inProductionAt?: string };

/** Chỉ khai phần hình dạng cần đụng tới — khỏi vướng `private` của class. */
interface PushSurface {
  pushToProduction(customer: unknown, dto: { ids: string[] }): Promise<unknown>;
  [k: string]: unknown;
}

const PLACED_AT = new Date('2026-08-24T02:54:31.335Z');

const staging = (createdAt?: Date) => ({
  _id: 'S1',
  orderId: 'EXT-1',
  status: 'pending',
  pushedAt: null,
  createdAt,
  shippingAddress: { firstName: 'Chí', address1: 'Đông Văn', city: 'Hà Nội' },
  items: [{ productionId: 'QY-02284-48568', type: 'CAMO SHIRT', size: 'S', quantity: 1 }],
});

/**
 * `createdAt` đi trong object chứ không phải tham số rời: tham số rời có giá
 * trị mặc định thì truyền thẳng `undefined` vào vẫn rơi về mặc định, nên ca
 * "staging cũ không có createdAt" sẽ lặng lẽ chạy sai kịch bản.
 */
const buildService = (opts: { createdAt?: Date } = { createdAt: PLACED_AT }) => {
  const createdAt = opts.createdAt;
  const importCalls: Array<{ rows: ImportRow[] }> = [];
  const stagingUpdates: Array<{ $set: Record<string, unknown> }> = [];
  const svc = Object.create(CustomerOrderService.prototype) as PushSurface;

  svc.systemConfigService = { get: () => Promise.resolve(false) };
  svc.loadPushTargets = () => Promise.resolve([{ id: 'S1', doc: staging(createdAt) }]);
  svc.buildPricingContext = () => Promise.resolve({});
  svc.promotionService = { getActiveInDateRange: () => Promise.resolve([]) };
  svc.quoteStagingOrder = () => ({ quotes: [{ type: 'CAMO SHIRT', size: 'S' }], orderTotal: 0 });
  svc.assertArtworkComplete = () => undefined;
  svc.claimPush = () => Promise.resolve(true);
  svc.orderService = {
    importOrders: (payload: { rows: ImportRow[] }) => {
      importCalls.push(payload);
      return Promise.resolve(undefined);
    },
  };
  svc.customerPaymentModel = { create: () => Promise.resolve({ _id: 'P1' }) };
  svc.productionCostModel = { bulkWrite: () => Promise.resolve({}) };
  svc.customerOrderModel = {
    updateOne: (_f: unknown, update: { $set: Record<string, unknown> }) => {
      stagingUpdates.push(update);
      return Promise.resolve({ modifiedCount: 1 });
    },
  };
  svc.customerOrderEventService = { emit: () => undefined };
  svc.designStorageService = {
    touchUsageForUrls: () => Promise.resolve(undefined),
    enqueueUrlIngest: () => Promise.resolve(undefined),
  };

  return { svc, importCalls, stagingUpdates };
};

const customer = { _id: 'C1', userSku: 'TIKTOKSHOPUS', userEmail: 'a@b.com', fullName: 'A', tier: null };

describe('đẩy sản xuất từ portal — mốc thời gian của đơn', () => {
  it('mỗi dòng gửi sang importOrders đều mang `inProductionAt` đọc được', async () => {
    const { svc, importCalls } = buildService();
    const before = Date.now();
    await svc.pushToProduction(customer, { ids: ['S1'] });
    const after = Date.now();

    const rows = importCalls[0].rows;
    expect(rows).toHaveLength(1);
    // ĐIỀU KIỆN CỐT LÕI — mất dòng này là đơn portal lại tàng hình.
    expect(rows[0].inProductionAt).toBeDefined();
    const t = new Date(rows[0].inProductionAt as string).getTime();
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('cùng một mốc cho `inProductionAt` của đơn và `pushedAt` của staging', async () => {
    const { svc, importCalls, stagingUpdates } = buildService();
    await svc.pushToProduction(customer, { ids: ['S1'] });

    // Hai con số tả cùng một sự kiện. Để chúng trôi khỏi nhau là mở đường cho
    // câu hỏi "đơn vào sản xuất lúc nào" có hai đáp án lệch nhau.
    const pushedAt = stagingUpdates[0].$set.pushedAt as Date;
    expect(pushedAt).toBeInstanceOf(Date);
    expect(importCalls[0].rows[0].inProductionAt).toBe(pushedAt.toISOString());
  });

  it('`orderAt` = lúc khách đặt, KHÔNG phải lúc đẩy', async () => {
    const { svc, importCalls } = buildService();
    await svc.pushToProduction(customer, { ids: ['S1'] });

    const row = importCalls[0].rows[0];
    expect(row.orderAt).toBe(PLACED_AT.toISOString());
    // Lấy nhầm mốc đẩy cho cả hai là xoá sạch quãng đơn nằm chờ ở Pending.
    expect(row.orderAt).not.toBe(row.inProductionAt);
  });

  it('staging doc cũ không có `createdAt` thì `orderAt` lùi về mốc đẩy', async () => {
    const { svc, importCalls } = buildService({});
    await svc.pushToProduction(customer, { ids: ['S1'] });

    const row = importCalls[0].rows[0];
    // Sai lệch một quãng đã không còn đo được, vẫn hơn để trống rồi thủng sort.
    expect(row.orderAt).toBe(row.inProductionAt);
  });
});
