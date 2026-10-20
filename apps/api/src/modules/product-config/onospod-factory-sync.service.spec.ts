import { BadRequestException, ConflictException } from '@nestjs/common';

import type { FactorySyncAppProduct } from './onospod-factory-sync.plan';
import {
  ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY,
  ONOSPOD_FACTORY_SYNC_LOCK_KEY,
  OnospodFactorySyncService,
} from './onospod-factory-sync.service';

// App ≥ 100 sản phẩm (dưới ngưỡng = nghi OnosPod lỗi) → 100 sản phẩm độn chưa gán xưởng + các sản phẩm thật của từng case.
const filler: FactorySyncAppProduct[] = Array.from({ length: 100 }, (_, i) => ({ _id: `fill-${i}`, name: `Filler ${i}`, variationSkus: [] }));
const manufactures = [
  { _id: 'm-ml', sku: 'ML', name: 'Mê Linh' },
  { _id: 'm-tn', sku: 'TN', name: 'Thái Nguyên' },
];
const factories = [
  { _id: 'f-ml', shortName: 'ML' },
  { _id: 'f-tn', shortName: 'TN' },
];

interface FacDoc {
  _id: string;
  fullName: string;
  sku?: string;
  variations: { sku: string }[];
  factoryId?: string;
}

/** n sản phẩm app ở TN, bên fac đang ML → kế hoạch n thay đổi ML→TN. */
const mismatch = (n: number) => ({
  app: Array.from({ length: n }, (_, i) => ({ _id: `a${i}`, name: `P${i}`, sku: `P${i}`, variationSkus: [], manufactureId: 'm-tn' })),
  fac: Array.from({ length: n }, (_, i): FacDoc => ({ _id: `c${i}`, fullName: `P${i}`, sku: `P${i}`, variations: [], factoryId: 'f-ml' })),
});

type LockDoc = { value?: { lockedAt: Date | null; lockId?: string | null } };

function setup(opts: { mode: string; n?: number; lockDoc?: LockDoc }) {
  const data = mismatch(opts.n ?? 3);
  const env = { mode: opts.mode, factoryMap: '' };
  const store = new Map<string, unknown>();
  const lockDoc: LockDoc = opts.lockDoc ?? {};
  let fetchGate: Promise<void> = Promise.resolve();

  const importService = {
    fetchFactorySyncProducts: jest.fn(async () => {
      await fetchGate;
      return [...filler, ...data.app];
    }),
    fetchManufactures: jest.fn(() => Promise.resolve(manufactures)),
  };
  const updateOne = jest.fn((filter: { _id: string; factoryId: unknown }, update: { $set: { factoryId: string } }) => {
    const doc = data.fac.find((d) => d._id === filter._id);
    if (!doc || doc.factoryId !== filter.factoryId) return Promise.resolve({ modifiedCount: 0 });
    doc.factoryId = update.$set.factoryId;
    return Promise.resolve({ modifiedCount: 1 });
  });
  // Khoá `system_configs` tối giản, mô phỏng đúng điều kiện filter của Mongo:
  // chiếm = có `$or` (lockedAt null | < staleBefore); nhả = filter theo `value.lockId`.
  const configs = {
    updateOne: jest.fn(
      (
        filter: { $or?: Record<string, { $lt?: Date } | null>[]; 'value.lockId'?: string },
        update: { $set: Record<string, unknown> },
      ) => {
        if (!lockDoc.value) return Promise.resolve({ modifiedCount: 0 });
        const at = lockDoc.value.lockedAt;
        const staleBefore = filter.$or?.[1]?.['value.lockedAt']?.$lt;
        if (filter.$or && at && !(staleBefore && at < staleBefore)) return Promise.resolve({ modifiedCount: 0 });
        if ('value.lockId' in filter && lockDoc.value.lockId !== filter['value.lockId']) return Promise.resolve({ modifiedCount: 0 });
        lockDoc.value.lockedAt = (update.$set['value.lockedAt'] as Date | null) ?? null;
        lockDoc.value.lockId = (update.$set['value.lockId'] as string | null) ?? null;
        return Promise.resolve({ modifiedCount: 1 });
      },
    ),
    findOne: jest.fn(() => Promise.resolve(lockDoc.value ? { _id: 'lock' } : null)),
    // `key` unique (đã xác minh index `key_1` unique trên prod 20/10/2026) → đã có document thì E11000.
    insertOne: jest.fn((doc: { value: unknown }) => {
      if (lockDoc.value) return Promise.reject(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
      lockDoc.value = { lockedAt: new Date(), lockId: (doc.value as { lockId: string }).lockId };
      return Promise.resolve();
    }),
  };
  const productConfigModel = {
    find: () => ({ select: () => ({ lean: () => Promise.resolve(data.fac) }) }),
    updateOne,
    db: { collection: (name: string) => (name === 'system_configs' ? configs : null) },
  };
  const systemConfigService = {
    get: jest.fn((key: string) => Promise.resolve(store.has(key) ? store.get(key) : null)),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, JSON.parse(JSON.stringify(value)));
      return Promise.resolve();
    }),
  };
  const apiConfigService = {
    get onospodFactorySync() {
      return env;
    },
    telegram: { notificationEnabled: false },
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const service = new OnospodFactorySyncService(
    apiConfigService as never,
    importService as never,
    { findAll: () => Promise.resolve(factories) } as never,
    systemConfigService as never,
    {} as never,
    productConfigModel as never,
    logger as never,
  );
  return {
    service,
    data,
    env,
    store,
    lockDoc,
    importService,
    updateOne,
    systemConfigService,
    hold: () => {
      let open!: () => void;
      fetchGate = new Promise<void>((r) => (open = r));
      return () => open();
    },
  };
}

describe('OnospodFactorySyncService — env off / dry-run', () => {
  it('off: lượt tự động không gọi OnosPod, không ghi gì', async () => {
    const t = setup({ mode: 'off' });
    await expect(t.service.runIfDue()).resolves.toBeUndefined();
    expect(t.importService.fetchFactorySyncProducts).not.toHaveBeenCalled();
    expect(t.updateOne).not.toHaveBeenCalled();
    expect(t.systemConfigService.set).not.toHaveBeenCalled();
  });

  it('dry-run: lập kế hoạch + lưu last-run nhưng KHÔNG ghi factoryId', async () => {
    const t = setup({ mode: 'dry-run' });
    const r = await t.service.runIfDue();
    expect(r).toEqual(expect.objectContaining({ status: 'ok', dryRun: true, applied: 0 }));
    expect(r?.changes).toHaveLength(3);
    expect(t.updateOne).not.toHaveBeenCalled();
    expect(t.store.get(ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY)).toEqual(expect.objectContaining({ dryRun: true }));
    expect(t.lockDoc.value?.lockedAt).toBeNull();
  });

  it('auto on: >10 thay đổi → aborted, không ghi (giữ trần cũ)', async () => {
    const t = setup({ mode: 'on', n: 11 });
    const r = await t.service.runIfDue();
    expect(r).toEqual(expect.objectContaining({ status: 'aborted', applied: 0 }));
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('auto on: ≤10 thay đổi → ghi thẳng (không cần xem trước)', async () => {
    const t = setup({ mode: 'on', n: 2 });
    const r = await t.service.runIfDue();
    expect(r).toEqual(expect.objectContaining({ status: 'ok', applied: 2, failed: 0 }));
    expect(t.data.fac.map((d) => d.factoryId)).toEqual(['f-tn', 'f-tn']);
  });
});

describe('OnospodFactorySyncService — xem trước → áp dụng', () => {
  it('xem trước chạy được ở mọi chế độ, trả planToken, không ghi factoryId', async () => {
    const t = setup({ mode: 'off' });
    const r = await t.service.preview('u1');
    expect(r.planToken).toMatch(/^[0-9a-f]{64}$/);
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it.each(['off', 'dry-run'])('env %s: từ chối áp dụng tay', async (mode) => {
    const t = setup({ mode });
    const { planToken } = await t.service.preview('u1');
    await expect(t.service.apply(planToken, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('thiếu / sai mã → từ chối, không gọi OnosPod, không ghi', async () => {
    const t = setup({ mode: 'on' });
    await expect(t.service.apply(undefined, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.service.apply('deadbeef', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.importService.fetchFactorySyncProducts).not.toHaveBeenCalled();
    await t.service.preview('u1');
    await expect(t.service.apply('deadbeef', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('mã quá 30 phút → từ chối', async () => {
    const t = setup({ mode: 'on' });
    const { planToken } = await t.service.preview('u1');
    const rec = t.store.get('onospod_factory_sync_preview') as { createdAt: string };
    rec.createdAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await expect(t.service.apply(planToken, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.updateOne).not.toHaveBeenCalled();
  });

  it('dữ liệu fac đổi sau khi xem trước → Conflict, không ghi, khoá được nhả', async () => {
    const t = setup({ mode: 'on' });
    const { planToken } = await t.service.preview('u1');
    t.data.fac[0].factoryId = 'f-tn'; // ai đó vừa sửa tay → kế hoạch còn 2 dòng
    await expect(t.service.apply(planToken, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(t.updateOne).not.toHaveBeenCalled();
    expect(t.lockDoc.value?.lockedAt).toBeNull();
  });

  it('dữ liệu app (OnosPod) đổi sau khi xem trước → Conflict, không ghi — mã băm phủ cả nguồn Pod', async () => {
    // (a) app đổi xưởng 1 sản phẩm về đúng xưởng fac → dòng đó biến mất khỏi kế hoạch.
    const a = setup({ mode: 'on' });
    const ta = (await a.service.preview('u1')).planToken;
    a.data.app[0].manufactureId = 'm-ml';
    await expect(a.service.apply(ta, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(a.updateOne).not.toHaveBeenCalled();

    // (b) app đổi xưởng ĐÍCH (TN → ML) của sản phẩm fac đang trống → cùng config nhưng xưởng mới khác.
    const b = setup({ mode: 'on' });
    delete b.data.fac[0].factoryId;
    const tb = (await b.service.preview('u1')).planToken;
    b.data.app[0].manufactureId = 'm-ml';
    await expect(b.service.apply(tb, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(b.updateOne).not.toHaveBeenCalled();

    // (c) app thêm sản phẩm lệch xưởng mới → kế hoạch thêm dòng.
    const c = setup({ mode: 'on' });
    const tc = (await c.service.preview('u1')).planToken;
    c.data.app.push({ _id: 'aX', name: 'PX', sku: 'PX', variationSkus: [], manufactureId: 'm-tn' });
    c.data.fac.push({ _id: 'cX', fullName: 'PX', sku: 'PX', variations: [], factoryId: 'f-ml' });
    await expect(c.service.apply(tc, 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(c.updateOne).not.toHaveBeenCalled();
    // Xem trước lại thì áp dụng được.
    const fresh = (await c.service.preview('u1')).planToken;
    await expect(c.service.apply(fresh, 'u1')).resolves.toEqual(expect.objectContaining({ applied: 4 }));
  });

  it('áp dụng đúng kế hoạch đã xem trước; mã chỉ dùng 1 lần', async () => {
    const t = setup({ mode: 'on', n: 12 }); // chạy tay không bị trần 10
    const { planToken } = await t.service.preview('u1');
    const r = await t.service.apply(planToken, 'u1');
    expect(r).toEqual(expect.objectContaining({ status: 'ok', dryRun: false, applied: 12, applySkipped: 0, failed: 0 }));
    expect(r.changes.every((c) => c.outcome === 'applied')).toBe(true);
    await expect(t.service.apply(planToken, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OnospodFactorySyncService — ghi một phần / lỗi lưu báo cáo', () => {
  it('1 dòng lỗi giữa chừng → vẫn ghi các dòng còn lại, status partial, last-run lưu đủ applied/skipped/failed', async () => {
    const t = setup({ mode: 'on', n: 4 });
    const real = t.updateOne.getMockImplementation()!;
    t.updateOne.mockImplementation(async (filter, update) => {
      if (filter._id === 'c1') throw new Error('write conflict');
      if (filter._id === 'c2') return Promise.resolve({ modifiedCount: 0 }); // vừa bị đổi tay
      return real(filter, update);
    });
    const { planToken } = await t.service.preview('u1');
    const r = await t.service.apply(planToken, 'u1');
    expect(r).toEqual(expect.objectContaining({ status: 'partial', applied: 2, applySkipped: 1, failed: 1 }));
    expect(r.changes.map((c) => [c.productConfigId, c.outcome])).toEqual([
      ['c0', 'applied'],
      ['c1', 'failed'],
      ['c2', 'skipped'],
      ['c3', 'applied'],
    ]);
    expect(r.changes[1].error).toBe('write conflict');
    expect(t.store.get(ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY)).toEqual(
      expect.objectContaining({ status: 'partial', applied: 2, applySkipped: 1, failed: 1 }),
    );

    // Không retry bằng mã cũ — phải xem trước lại; kế hoạch mới chỉ còn các dòng chưa ghi được.
    t.updateOne.mockImplementation(real);
    await expect(t.service.apply(planToken, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    const again = await t.service.preview('u1');
    expect(again.planToken).not.toBe(planToken);
    expect(again.changes.map((c) => c.productConfigId)).toEqual(['c1', 'c2']);
    await expect(t.service.apply(again.planToken, 'u1')).resolves.toEqual(expect.objectContaining({ status: 'ok', applied: 2 }));
  });

  it('lưu last-run lỗi → vẫn trả kết quả đã ghi (không giả như chưa chạy)', async () => {
    const t = setup({ mode: 'on', n: 2 });
    t.systemConfigService.set.mockImplementation((key: string, value: unknown) => {
      if (key === ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY) return Promise.reject(new Error('redis down'));
      t.store.set(key, JSON.parse(JSON.stringify(value)));
      return Promise.resolve();
    });
    const r = await t.service.runIfDue();
    expect(r).toEqual(expect.objectContaining({ status: 'ok', applied: 2 }));
  });
});

describe('OnospodFactorySyncService — chạy chồng nhau', () => {
  it('đang có lượt tự động ghi → xem trước tay bị Conflict (không nhập chung kết quả), lượt tự động khác bỏ qua', async () => {
    const t = setup({ mode: 'on', n: 2 });
    const open = t.hold();
    const auto = t.service.runIfDue();
    await new Promise((r) => setImmediate(r));
    expect(t.lockDoc.value?.lockedAt).toBeInstanceOf(Date);

    await expect(t.service.preview('u1')).rejects.toBeInstanceOf(ConflictException);
    // Process khác (service khác, chung khoá DB) → lượt tự động bỏ qua, chạy tay bị Conflict.
    const other = setup({ mode: 'on', lockDoc: t.lockDoc });
    await expect(other.service.runIfDue()).resolves.toBeUndefined();
    await expect(other.service.preview('u2')).rejects.toBeInstanceOf(ConflictException);
    expect(other.importService.fetchFactorySyncProducts).not.toHaveBeenCalled();
    expect(t.importService.fetchFactorySyncProducts).toHaveBeenCalledTimes(1);

    open();
    await expect(auto).resolves.toEqual(expect.objectContaining({ trigger: 'auto', applied: 2 }));
    expect(t.lockDoc.value?.lockedAt).toBeNull();
    // Nhả khoá rồi thì chạy tay được.
    await expect(t.service.preview('u1')).resolves.toEqual(expect.objectContaining({ trigger: 'manual', dryRun: true }));
  });

  it.each([
    ['chưa có document khoá (2 bên cùng insert, unique key chặn 1)', undefined],
    ['document khoá đã nhả (2 bên cùng updateOne có điều kiện)', null],
  ])('2 process chiếm khoá cùng lúc — %s → đúng 1 bên chạy', async (_label, lockedAt) => {
    const lockDoc: LockDoc = lockedAt === undefined ? {} : { value: { lockedAt } };
    const a = setup({ mode: 'on', lockDoc });
    const b = setup({ mode: 'on', lockDoc });
    const results = await Promise.allSettled([a.service.preview('u1'), b.service.preview('u2')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(a.importService.fetchFactorySyncProducts.mock.calls.length + b.importService.fetchFactorySyncProducts.mock.calls.length).toBe(1);
    expect(lockDoc.value?.lockedAt).toBeNull();
  });

  it('A treo quá 10 phút, B chiếm khoá mồ côi, A sống lại nhả khoá → KHÔNG nhả nhầm khoá của B', async () => {
    const lockDoc: LockDoc = {};
    const a = setup({ mode: 'on', lockDoc });
    const b = setup({ mode: 'on', lockDoc });
    const c = setup({ mode: 'on', lockDoc });

    const openA = a.hold();
    const runA = a.service.preview('uA');
    await new Promise((r) => setImmediate(r));
    const lockA = lockDoc.value?.lockId;
    expect(lockA).toEqual(expect.any(String));

    lockDoc.value!.lockedAt = new Date(Date.now() - 11 * 60 * 1000); // A đã giữ > 10 phút
    const openB = b.hold();
    const runB = b.service.preview('uB');
    await new Promise((r) => setImmediate(r));
    const lockB = lockDoc.value?.lockId;
    expect(lockB).toEqual(expect.any(String));
    expect(lockB).not.toBe(lockA);

    openA();
    await runA; // A xong → finally nhả khoá theo lockId A
    expect(lockDoc.value).toEqual(expect.objectContaining({ lockId: lockB, lockedAt: expect.any(Date) }));
    await expect(c.service.preview('uC')).rejects.toBeInstanceOf(ConflictException); // B vẫn đang giữ

    openB();
    await runB;
    expect(lockDoc.value).toEqual(expect.objectContaining({ lockId: null, lockedAt: null }));
    await expect(c.service.preview('uC')).resolves.toEqual(expect.objectContaining({ status: 'ok' }));
  });

  it('khoá còn mới (process khác đang chạy) → Conflict; mồ côi quá 10 phút → chiếm lại được', async () => {
    const fresh = setup({ mode: 'on', lockDoc: { value: { lockedAt: new Date(Date.now() - 60 * 1000) } } });
    await expect(fresh.service.preview('u1')).rejects.toBeInstanceOf(ConflictException);

    const t = setup({ mode: 'on', lockDoc: { value: { lockedAt: new Date(Date.now() - 11 * 60 * 1000) } } });
    await expect(t.service.preview('u1')).resolves.toEqual(expect.objectContaining({ status: 'ok' }));
    expect(t.lockDoc.value?.lockedAt).toBeNull();
    expect(ONOSPOD_FACTORY_SYNC_LOCK_KEY).toBe('onospod_factory_sync_lock');
  });
});
