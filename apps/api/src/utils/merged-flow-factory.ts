import type { Connection } from 'mongoose';
import { FactoryFlowType } from 'shared';

/**
 * Cache process-wide cấu hình fulfillment theo xưởng cần cho các điểm quyết
 * định transition/rework (code sync hoặc hot-path — đọc sync từ cache, TTL
 * hết hạn thì tự refresh nền, pattern y hệt `excluded-factory.ts`):
 *
 *  - `flowType` của các xưởng chạy LUỒNG RÚT GỌN (`merged` xưởng gỗ — In+Ép,
 *    May vào+May ra; `no-sew` Mê Linh — QC xong bỏ qua 2 công đoạn may).
 *  - `autoCompletePack` — toggle ĐỘC LẬP với flowType: đơn chảy tới công đoạn
 *    ĐÓNG HÀNG tự hoàn thành luôn (xem FulfillmentWorkflow.md §2.2b).
 *  - `skipToolCheck` — bỏ qua soát tool (xưởng DTF Mê Linh): `importOrders`
 *    stamp đơn MỚI của xưởng này 'ok' + vào thẳng cột In (FulfillmentWorkflow.md
 *    §2.2d).
 *
 * Await `loadFactoryFlowTypes` ở `OrderService.onModuleInit` để cache sẵn
 * sàng trước khi nhận traffic (FulfillmentModule phụ thuộc OrderModule nên
 * init sau). Admin đổi cấu hình giữa chừng → áp dụng chậm nhất sau TTL.
 */
const TTL_MS = 60_000;
let cache: { flows: Map<string, FactoryFlowType>; autoPack: Set<string>; skipToolCheck: Set<string>; at: number } = {
  flows: new Map(),
  autoPack: new Set(),
  skipToolCheck: new Set(),
  at: 0,
};
let refreshing = false;

export async function loadFactoryFlowTypes(db: Connection): Promise<Map<string, FactoryFlowType>> {
  const docs = await db
    .collection('factories')
    .find({
      $or: [
        { flowType: { $exists: true, $ne: FactoryFlowType.Standard } },
        { autoCompletePack: true },
        { skipToolCheck: true },
      ],
      deletedAt: { $exists: false },
    })
    .project({ _id: 1, flowType: 1, autoCompletePack: 1, skipToolCheck: 1 })
    .toArray();
  cache = {
    flows: new Map(
      docs
        .filter((d) => d.flowType && d.flowType !== FactoryFlowType.Standard)
        .map((d) => [String(d._id), d.flowType as FactoryFlowType]),
    ),
    autoPack: new Set(docs.filter((d) => d.autoCompletePack === true).map((d) => String(d._id))),
    skipToolCheck: new Set(docs.filter((d) => d.skipToolCheck === true).map((d) => String(d._id))),
    at: Date.now(),
  };
  return cache.flows;
}

function refreshIfStale(db: Connection): void {
  if (Date.now() - cache.at > TTL_MS && !refreshing) {
    refreshing = true;
    void loadFactoryFlowTypes(db)
      .catch(() => undefined)
      .finally(() => {
        refreshing = false;
      });
  }
}

/** Đọc sync từ cache — quá TTL thì refresh nền, request hiện tại dùng giá trị cũ. */
export function getFactoryFlowTypeSync(db: Connection, factoryId: string | null | undefined): FactoryFlowType {
  refreshIfStale(db);
  if (factoryId == null) return FactoryFlowType.Standard;
  return cache.flows.get(String(factoryId)) ?? FactoryFlowType.Standard;
}

/** Xưởng có bật "tự hoàn thành Đóng hàng" không — đọc sync, cùng cache/TTL. */
export function getFactoryAutoPackSync(db: Connection, factoryId: string | null | undefined): boolean {
  refreshIfStale(db);
  if (factoryId == null) return false;
  return cache.autoPack.has(String(factoryId));
}

/** Xưởng có bật "bỏ qua soát tool" không — đọc sync, cùng cache/TTL. */
export function getFactorySkipToolCheckSync(db: Connection, factoryId: string | null | undefined): boolean {
  refreshIfStale(db);
  if (factoryId == null) return false;
  return cache.skipToolCheck.has(String(factoryId));
}

/**
 * DANH SÁCH xưởng bật "bỏ qua soát tool" — cho hàng đợi soát tool tự động
 * (`getNextDesignReviewOrder`) loại trừ cả loạt bằng `$nin` (stamp 'ok' lúc
 * import chỉ áp đơn MỚI, đơn cũ của xưởng vẫn `toolResult` rỗng nên phải chặn
 * ở tầng query). Cùng cache/TTL với các getter trên.
 */
export function listSkipToolCheckFactoryIdsSync(db: Connection): string[] {
  refreshIfStale(db);
  return [...cache.skipToolCheck];
}
