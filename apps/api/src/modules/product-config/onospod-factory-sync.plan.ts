/**
 * Đồng bộ XƯỞNG sản phẩm theo app OnosPod (Products.md §2.7a) — hàm thuần,
 * không I/O. Service fetch dữ liệu hai bên → `planOnospodFactorySync()` lập kế
 * hoạch → service ghi có điều kiện.
 *
 * Quyết định 16/10/2026 (chị quản lý chốt): app OnosPod là hệ thống tổng, fac
 * đồng bộ XƯỞNG theo app. Thay cho quyết định 05/08/2026 "xưởng fac là chuẩn"
 * — chỉ riêng field `factoryId`, các field sản xuất khác vẫn không đụng.
 */
import { createHash } from 'crypto';

/** Chế độ đồng bộ tự động (env `ONOSPOD_FACTORY_SYNC_MODE`): tắt / chỉ báo cáo / ghi thật. */
export type OnospodFactorySyncMode = 'off' | 'dry-run' | 'on';

export function parseOnospodFactorySyncMode(raw: string | undefined): OnospodFactorySyncMode {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'dry-run' ? v : 'off';
}

/**
 * Mã manufacture app (`manufactures.sku`) → `shortName` xưởng fac. Đọc thật
 * 20/10/2026: ML "Mê Linh", TN "Thái Nguyên", TN-DECOR "Thái Nguyên Decor",
 * GRABINK "Grabink", 2DUS "Houston" — chị quản lý chốt 20/10/2026 Grabink và
 * Houston đều là xưởng US. App không có DTF TN (`MLDTF`) → sản phẩm fac để
 * DTF TN được giữ nguyên (`fac-only-factory`).
 */
export const DEFAULT_ONOSPOD_FACTORY_MAP = 'ML=ML,TN=TN,TN-DECOR=TNW,GRABINK=US,2DUS=US';

/** `"ML=ML,TN-DECOR=TNW"` → Map(manufactureSku → factoryShortName), cả hai vế uppercase. Cặp hỏng bị bỏ. */
export function parseOnospodFactoryMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (raw?.trim() || DEFAULT_ONOSPOD_FACTORY_MAP).split(',')) {
    const [from, to] = pair.split('=').map((s) => s?.trim().toUpperCase());
    if (from && to) map.set(from, to);
  }
  return map;
}

/** Sản phẩm bên app (`productPreset`) — chỉ field cần để khớp + biết xưởng. */
export interface FactorySyncAppProduct {
  _id: string;
  name: string;
  sku?: string;
  variationSkus: string[];
  manufactureId?: string;
}

export interface FactorySyncManufacture {
  _id: string;
  sku?: string;
  name?: string;
}

/** Product Config bên fac. */
export interface FactorySyncFacProduct {
  _id: string;
  fullName: string;
  sku?: string;
  variationSkus: string[];
  factoryId?: string;
}

export interface FactorySyncFactory {
  _id: string;
  shortName: string;
}

export interface FactorySyncChange {
  productConfigId: string;
  fullName: string;
  fromFactoryId?: string;
  fromFactory?: string;
  toFactoryId: string;
  toFactory: string;
  /** Tên + SKU sản phẩm bên app (có thể nhiều bản trùng, vd bản "VD") — để người đọc báo cáo đối chiếu. */
  appProducts: string[];
  manufacture: string;
  /** Chỉ có sau lượt ghi: `skipped` = xưởng vừa bị đổi tay nên ghi có điều kiện không khớp. */
  outcome?: 'applied' | 'skipped' | 'failed';
  error?: string;
}

export type FactorySyncSkipReason =
  /** App chưa gán xưởng cho sản phẩm. */
  | 'no-manufacture'
  /** Xưởng app chưa có trong bảng quy đổi (xưởng mới thêm trên app). */
  | 'unmapped-manufacture'
  /** Bảng quy đổi trỏ tới shortName không có bên fac. */
  | 'factory-missing'
  /** Không khớp được Product Config nào bên fac. */
  | 'not-on-fac'
  /** Fac đang để xưởng mà app không có (vd DTF TN) — giữ nguyên, không kéo về xưởng app. */
  | 'fac-only-factory'
  /** Nhiều sản phẩm app khớp cùng 1 config nhưng khác xưởng — không biết theo bản nào. */
  | 'conflict'
  /** 1 sản phẩm app khớp NHIỀU Product Config (trùng SKU/tên/SKU biến thể) — không đoán, bỏ qua. */
  | 'ambiguous';

export interface FactorySyncSkip {
  reason: FactorySyncSkipReason;
  appProduct?: string;
  productConfigId?: string;
  fullName?: string;
  detail?: string;
}

export interface FactorySyncPlan {
  changes: FactorySyncChange[];
  skipped: FactorySyncSkip[];
  /** Số Product Config đã đúng xưởng app. */
  unchanged: number;
}

const norm = (s: string | undefined) => (s ?? '').trim().toUpperCase();
const appLabel = (p: FactorySyncAppProduct) => (p.sku ? `${p.name} (${p.sku})` : p.name);

/**
 * Khớp sản phẩm app → Product Config theo thứ tự: SKU sản phẩm → tên (không
 * phân biệt hoa thường, giống `importFromOnospod`) → SKU biến thể (bản "VD"
 * trên app có SKU riêng nhưng dùng chung biến thể với bản chính).
 */
export function planOnospodFactorySync(input: {
  appProducts: FactorySyncAppProduct[];
  manufactures: FactorySyncManufacture[];
  facProducts: FactorySyncFacProduct[];
  factories: FactorySyncFactory[];
  factoryMap: Map<string, string>;
}): FactorySyncPlan {
  const { appProducts, manufactures, facProducts, factories, factoryMap } = input;

  const factoryByShort = new Map(factories.map((f) => [norm(f.shortName), f]));
  const factoryById = new Map(factories.map((f) => [f._id, f]));
  const manufactureById = new Map(manufactures.map((m) => [m._id, m]));
  // Xưởng fac nằm trong vế phải bảng quy đổi = app quản lý được. Xưởng ngoài tập này (DTF TN...) là "chỉ fac có".
  const syncableFactoryIds = new Set(
    [...factoryMap.values()].map((s) => factoryByShort.get(s)?._id).filter((id): id is string => !!id),
  );

  // Key → MỌI config mang key đó (không `set()` đè): trùng thì báo `ambiguous` thay vì lấy bừa bản cuối.
  const facBySku = new Map<string, FactorySyncFacProduct[]>();
  const facByName = new Map<string, FactorySyncFacProduct[]>();
  const facByVariationSku = new Map<string, FactorySyncFacProduct[]>();
  const index = (m: Map<string, FactorySyncFacProduct[]>, key: string, p: FactorySyncFacProduct) => {
    if (!key) return;
    const list = m.get(key) ?? [];
    if (!list.includes(p)) list.push(p);
    m.set(key, list);
  };
  for (const p of facProducts) {
    if (p.sku) index(facBySku, norm(p.sku), p);
    index(facByName, norm(p.fullName), p);
    for (const v of p.variationSkus) index(facByVariationSku, norm(v), p);
  }
  /** Bước đầu tiên có kết quả quyết định: đúng 1 config → khớp; >1 → mơ hồ, KHÔNG rơi xuống bước sau. */
  const findFac = (a: FactorySyncAppProduct): FactorySyncFacProduct | FactorySyncFacProduct[] | undefined => {
    const steps = [
      a.sku ? facBySku.get(norm(a.sku)) ?? [] : [],
      facByName.get(norm(a.name)) ?? [],
      [...new Set(a.variationSkus.flatMap((v) => facByVariationSku.get(norm(v)) ?? []))],
    ];
    const hit = steps.find((s) => s.length > 0);
    if (!hit) return undefined;
    return hit.length === 1 ? hit[0] : hit;
  };

  const skipped: FactorySyncSkip[] = [];
  // configId → các xưởng đích mà app muốn (gom để bắt xung đột giữa bản chính và bản "VD").
  const targets = new Map<
    string,
    { fac: FactorySyncFacProduct; wants: { factory: FactorySyncFactory; app: string; manufacture: string }[] }
  >();

  for (const a of appProducts) {
    const label = appLabel(a);
    if (!a.manufactureId) {
      skipped.push({ reason: 'no-manufacture', appProduct: label });
      continue;
    }
    const manu = manufactureById.get(a.manufactureId);
    const manuName = manu?.name || manu?.sku || a.manufactureId;
    const shortName = manu ? factoryMap.get(norm(manu.sku)) : undefined;
    if (!shortName) {
      skipped.push({ reason: 'unmapped-manufacture', appProduct: label, detail: manuName });
      continue;
    }
    const factory = factoryByShort.get(shortName);
    if (!factory) {
      skipped.push({ reason: 'factory-missing', appProduct: label, detail: `${manuName} → ${shortName}` });
      continue;
    }
    const fac = findFac(a);
    if (!fac) {
      skipped.push({ reason: 'not-on-fac', appProduct: label, detail: manuName });
      continue;
    }
    if (Array.isArray(fac)) {
      skipped.push({ reason: 'ambiguous', appProduct: label, detail: fac.map((p) => p.fullName).join(' · ') });
      continue;
    }
    const entry = targets.get(fac._id) ?? { fac, wants: [] };
    entry.wants.push({ factory, app: label, manufacture: manuName });
    targets.set(fac._id, entry);
  }

  const changes: FactorySyncChange[] = [];
  let unchanged = 0;
  for (const { fac, wants } of targets.values()) {
    const distinct = new Set(wants.map((w) => w.factory._id));
    if (distinct.size > 1) {
      skipped.push({
        reason: 'conflict',
        productConfigId: fac._id,
        fullName: fac.fullName,
        detail: wants.map((w) => `${w.app}: ${w.manufacture}`).join(' · '),
      });
      continue;
    }
    const want = wants[0];
    if (fac.factoryId === want.factory._id) {
      unchanged++;
      continue;
    }
    // RỦI RO (Products.md §2.7a): bảo vệ này SUY RA từ bảng quy đổi chứ không phải
    // khoá tường minh — thêm xưởng vào vế phải bảng (vd `...=MLDTF`) là mọi config
    // đang để xưởng đó hết được bảo vệ; còn config cố ý để xưởng CÓ trong bảng
    // (vd Pajama để TN trong khi app ML) thì không bao giờ được bảo vệ.
    // TODO(business): ghim xưởng từng Product Config (field `factorySyncPinned`) nếu cần ngoại lệ lâu dài.
    if (fac.factoryId && !syncableFactoryIds.has(fac.factoryId)) {
      skipped.push({
        reason: 'fac-only-factory',
        productConfigId: fac._id,
        fullName: fac.fullName,
        detail: `fac ${factoryById.get(fac.factoryId)?.shortName ?? fac.factoryId} · app ${want.manufacture}`,
      });
      continue;
    }
    changes.push({
      productConfigId: fac._id,
      fullName: fac.fullName,
      fromFactoryId: fac.factoryId,
      fromFactory: fac.factoryId ? factoryById.get(fac.factoryId)?.shortName ?? fac.factoryId : undefined,
      toFactoryId: want.factory._id,
      toFactory: want.factory.shortName,
      appProducts: wants.map((w) => w.app),
      manufacture: want.manufacture,
    });
  }

  return { changes, skipped, unchanged };
}

/**
 * Dấu vân tay của kế hoạch — CHỈ phần sẽ ghi (config, xưởng cũ → mới) + bảng
 * quy đổi. Xem trước và áp dụng phải ra cùng mã; dữ liệu app/fac đổi giữa hai
 * lần làm kế hoạch khác đi → mã khác → từ chối áp dụng.
 */
export function hashFactorySyncPlan(
  changes: Pick<FactorySyncChange, 'productConfigId' | 'fromFactoryId' | 'toFactoryId'>[],
  factoryMap: Map<string, string>,
): string {
  const body = [
    ...changes.map((c) => `${c.productConfigId}:${c.fromFactoryId ?? ''}>${c.toFactoryId}`).sort(),
    '|',
    ...[...factoryMap].map(([k, v]) => `${k}=${v}`).sort(),
  ].join(';');
  return createHash('sha256').update(body).digest('hex');
}
