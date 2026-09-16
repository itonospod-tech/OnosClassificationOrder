/**
 * Đồng bộ giữ đơn theo OnosPod — phần QUYẾT ĐỊNH (hàm thuần, không DB, không
 * mạng). Service `OnospodHoldSyncService` lo fetch + ghi; mọi luật nghiệp vụ
 * nằm ở đây để test được đầy đủ. Xem Orders.md §9d.
 *
 * Luật (USER chốt):
 *  1. Chỉ GIỮ đơn chưa hoàn thành fulfillment, chưa hủy (đơn xóa mềm không
 *     được nạp vào). Đơn đã xong/hủy mà OnosPod đang giữ → chỉ gắn cờ.
 *  2. Chỉ tự NHẢ đơn do đồng bộ giữ (`holdSource='onospod'`). Đơn nhân viên giữ
 *     (kể cả đơn giữ cũ thiếu `holdSource`) giữ nguyên, chỉ gắn/gỡ cờ.
 *  3. Nhân viên đã mở giữ một đợt (`onospodHoldDismissedAt`) → không giữ lại
 *     tới khi OnosPod có đợt giữ MỚI HƠN mốc đó.
 *  4. An toàn: nghi ngờ dữ liệu hoặc vượt trần nhả → bỏ CẢ lượt (không ghi gì).
 */

export const HOLD_SOURCE_ONOSPOD = 'onospod';

/** Cửa sổ quét: item có `mrp_created_at` trong N ngày gần nhất. */
export const ONOSPOD_HOLD_SYNC_WINDOW_DAYS = 60;

/**
 * Đơn giữ-do-đồng-bộ chỉ được nhả khi `inProductionAt` nằm TRONG cửa sổ quét,
 * lùi thêm biên này vào trong. `inProductionAt` của đơn OnosPod = `mrp_created_at`
 * nhưng qua format giờ VN lúc import có thể lệch vài giờ — biên 1 ngày đủ an toàn.
 * Đơn cũ hơn vắng khỏi tập On Hold có thể chỉ vì trôi ra ngoài cửa sổ, không
 * phải vì OnosPod đã nhả → giữ nguyên.
 */
export const ONOSPOD_HOLD_SYNC_WINDOW_MARGIN_MS = 24 * 60 * 60 * 1000;

/** Trần nhả mỗi lượt: vượt → bỏ cả lượt + cảnh báo. */
export const ONOSPOD_HOLD_SYNC_MAX_UNHOLD = 20;
/** Trần tỉ lệ nhả so với số đơn đang giữ-do-đồng-bộ (chỉ xét khi số nhả ≥ ngưỡng dưới). */
export const ONOSPOD_HOLD_SYNC_MAX_UNHOLD_RATIO = 0.5;
export const ONOSPOD_HOLD_SYNC_RATIO_MIN_COUNT = 5;

export type OnospodHoldItem = {
  productionId: string;
  /** Thời điểm đợt giữ bên OnosPod. */
  onHoldAt: Date;
};

export type HoldSyncOrderState = {
  orderId: string;
  productionId: string;
  heldAt?: Date | null;
  holdSource?: string | null;
  cancelledAt?: Date | null;
  fulfillmentCompletedAt?: Date | null;
  inProductionAt?: Date | null;
  onospodHold?: { onHoldAt?: Date | null; seenAt?: Date | null } | null;
  onospodHoldDismissedAt?: Date | null;
};

export type HoldSyncFlag = { onHoldAt: Date; seenAt: Date };

export type HoldSyncAction = {
  orderId: string;
  productionId: string;
};

export type HoldSyncFlagAction = HoldSyncAction & {
  flag: HoldSyncFlag;
  why: 'completed' | 'cancelled' | 'held_manual' | 'dismissed' | 'refresh';
};

export type HoldSyncPlan = {
  aborted: boolean;
  reason?: string;
  /** Giữ: set heldAt + holdReason + holdSource='onospod' + cờ. */
  toHold: Array<HoldSyncAction & { flag: HoldSyncFlag }>;
  /** Nhả: unset heldAt/holdReason/holdSource + cờ. */
  toUnhold: HoldSyncAction[];
  /** Chỉ ghi cờ `onospodHold` (không đổi trạng thái giữ). */
  flagOnly: HoldSyncFlagAction[];
  /** OnosPod đã nhả, đơn không do đồng bộ giữ → gỡ cờ. */
  clearFlag: HoldSyncAction[];
  dismissedSkip: HoldSyncAction[];
  outOfWindow: HoldSyncAction[];
  /** productionId OnosPod đang giữ nhưng không có đơn bên mình. */
  notFound: string[];
  unchanged: number;
  /** Số đơn đang giữ-do-đồng-bộ lúc lập kế hoạch (mẫu số trần tỉ lệ). */
  syncedHeldCount: number;
};

export type HoldSyncPlanInput = {
  items: OnospodHoldItem[];
  orders: HoldSyncOrderState[];
  now: Date;
  windowStart: Date;
  limits?: { maxUnhold?: number; maxUnholdRatio?: number; ratioMinCount?: number };
};

const ms = (d?: Date | null): number | null => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null);

/**
 * Gộp item trùng productionId (dữ liệu live, phân trang có thể lặp) — giữ đợt
 * giữ MỚI NHẤT.
 */
export function indexOnospodHoldItems(items: OnospodHoldItem[]): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const it of items) {
    const pid = it.productionId?.trim();
    if (!pid || ms(it.onHoldAt) === null) continue;
    const prev = map.get(pid);
    if (!prev || it.onHoldAt.getTime() > prev.getTime()) map.set(pid, it.onHoldAt);
  }
  return map;
}

export function planOnospodHoldSync(input: HoldSyncPlanInput): HoldSyncPlan {
  const maxUnhold = input.limits?.maxUnhold ?? ONOSPOD_HOLD_SYNC_MAX_UNHOLD;
  const maxRatio = input.limits?.maxUnholdRatio ?? ONOSPOD_HOLD_SYNC_MAX_UNHOLD_RATIO;
  const ratioMin = input.limits?.ratioMinCount ?? ONOSPOD_HOLD_SYNC_RATIO_MIN_COUNT;

  const onHold = indexOnospodHoldItems(input.items);
  const plan: HoldSyncPlan = {
    aborted: false,
    toHold: [],
    toUnhold: [],
    flagOnly: [],
    clearFlag: [],
    dismissedSkip: [],
    outOfWindow: [],
    notFound: [],
    unchanged: 0,
    syncedHeldCount: 0,
  };

  const seenPids = new Set<string>();
  const unholdCutoff = input.windowStart.getTime() + ONOSPOD_HOLD_SYNC_WINDOW_MARGIN_MS;

  for (const o of input.orders) {
    seenPids.add(o.productionId);
    const ref: HoldSyncAction = { orderId: o.orderId, productionId: o.productionId };
    const isHeld = !!o.heldAt;
    const syncedHeld = isHeld && o.holdSource === HOLD_SOURCE_ONOSPOD;
    if (syncedHeld) plan.syncedHeldCount++;

    const flagAt = ms(o.onospodHold?.onHoldAt);
    const onHoldAt = onHold.get(o.productionId);

    if (onHoldAt) {
      // Đợt giữ trùng cờ đang có → giữ nguyên `seenAt`; đợt mới → thấy lần đầu lúc này.
      const sameEpisode = flagAt !== null && flagAt === onHoldAt.getTime();
      const flag: HoldSyncFlag = {
        onHoldAt,
        seenAt: sameEpisode && o.onospodHold?.seenAt ? o.onospodHold.seenAt : input.now,
      };

      if (isHeld) {
        // Đã giữ (do đồng bộ hoặc nhân viên) → không đổi lý do/nguồn, chỉ làm mới cờ.
        if (sameEpisode) plan.unchanged++;
        else plan.flagOnly.push({ ...ref, flag, why: syncedHeld ? 'refresh' : 'held_manual' });
        continue;
      }

      const dismissedAt = ms(o.onospodHoldDismissedAt);
      const dismissed = dismissedAt !== null && onHoldAt.getTime() <= dismissedAt;
      const why: HoldSyncFlagAction['why'] | null = o.cancelledAt
        ? 'cancelled'
        : o.fulfillmentCompletedAt
          ? 'completed'
          : dismissed
            ? 'dismissed'
            : null;

      if (why === null) {
        plan.toHold.push({ ...ref, flag });
        continue;
      }
      if (why === 'dismissed') plan.dismissedSkip.push(ref);
      if (sameEpisode) plan.unchanged++;
      else plan.flagOnly.push({ ...ref, flag, why });
      continue;
    }

    // OnosPod KHÔNG còn giữ item này (trong cửa sổ quét).
    if (syncedHeld) {
      const inProd = ms(o.inProductionAt);
      if (inProd === null || inProd < unholdCutoff) {
        plan.outOfWindow.push(ref);
        continue;
      }
      plan.toUnhold.push(ref);
      continue;
    }
    if (flagAt !== null) {
      plan.clearFlag.push(ref);
      continue;
    }
    plan.unchanged++;
  }

  for (const pid of onHold.keys()) {
    if (!seenPids.has(pid)) plan.notFound.push(pid);
  }

  // ─── An toàn ──────────────────────────────────────────────────────────
  if (onHold.size === 0 && plan.syncedHeldCount > 0) {
    return abort(
      plan,
      `OnosPod trả 0 item On Hold trong khi đang có ${plan.syncedHeldCount} đơn giữ theo OnosPod — nghi ngờ dữ liệu, không nhả`,
    );
  }
  if (plan.toUnhold.length > maxUnhold) {
    return abort(plan, `Số đơn cần nhả (${plan.toUnhold.length}) vượt trần ${maxUnhold} — không nhả`);
  }
  if (plan.toUnhold.length >= ratioMin && plan.toUnhold.length > plan.syncedHeldCount * maxRatio) {
    return abort(
      plan,
      `Số đơn cần nhả (${plan.toUnhold.length}/${plan.syncedHeldCount}) vượt ${Math.round(maxRatio * 100)}% số đơn giữ theo OnosPod — không nhả`,
    );
  }

  return plan;
}

function abort(plan: HoldSyncPlan, reason: string): HoldSyncPlan {
  return { ...plan, aborted: true, reason };
}

/**
 * Nhân viên mở giữ THỦ CÔNG (1 đơn `unholdOrder` / hàng loạt `bulkSetHold`)
 * có báo khách (`order.unheld` — chuông portal + webhook) hay không.
 *
 * USER chốt: đơn giữ THEO OnosPod (`holdSource='onospod'`) KHÔNG báo — khách
 * chưa từng được báo đơn bị giữ (đồng bộ giữ không báo, §9d.5) nên báo "tiếp
 * tục sản xuất" là vô nghĩa. Đơn giữ tay (`manual` hoặc thiếu nguồn) báo như cũ.
 * Truyền trạng thái NGAY TRƯỚC lúc nhả (sau khi nhả `holdSource` đã bị `$unset`).
 */
export function shouldNotifyCustomerOnManualUnhold(before: {
  heldAt?: Date | string | null;
  holdSource?: string | null;
}): boolean {
  return !!before.heldAt && before.holdSource !== HOLD_SOURCE_ONOSPOD;
}

/**
 * Thời điểm đợt giữ từ 1 item MRP: log `On Hold` MỚI NHẤT → `mrp_updated_at`
 * → `mrp_created_at`. Trả null nếu không có mốc hợp lệ nào.
 */
export function resolveOnHoldAt(item: {
  mrp_log?: Array<{ mrp_status?: string | null; created_at?: string | null } | null> | null;
  mrp_updated_at?: string | null;
  mrp_created_at?: string | null;
}): Date | null {
  let best: number | null = null;
  for (const log of item.mrp_log || []) {
    if (log?.mrp_status !== 'On Hold' || !log.created_at) continue;
    const t = new Date(log.created_at).getTime();
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  if (best !== null) return new Date(best);
  for (const s of [item.mrp_updated_at, item.mrp_created_at]) {
    if (!s) continue;
    const t = new Date(s).getTime();
    if (!Number.isNaN(t)) return new Date(t);
  }
  return null;
}
