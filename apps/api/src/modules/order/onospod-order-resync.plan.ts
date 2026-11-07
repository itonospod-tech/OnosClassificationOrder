/**
 * Đồng bộ lại đơn ĐANG MỞ theo app OnosPod — phần QUYẾT ĐỊNH (hàm thuần, không
 * DB, không mạng). Service `OnospodOrderResyncService` lo fetch + ghi. Xem
 * Orders.md §9e.
 *
 * Vì sao cần: lượt import chỉ kéo đơn trong khoảng ngày vào sản xuất (§3.6),
 * qua ngày thì app đổi design / map lại SKU mà fac không thấy (29/10/2026: 2 đơn
 * decor Wooden Ornament Garland đổi design + 5in→4in phải sửa tay).
 *
 * Luật (USER chốt 29–30/10/2026):
 *  1. Chỉ xét item thuộc manufacture trong danh sách (mặc định decor `TN-DECOR`).
 *  2. Đơn hủy / đã xong fulfillment → bỏ qua.
 *  3. Đổi hẳn sản phẩm (`type` khác) → CHỈ BÁO, không ghi (kéo theo xưởng,
 *     cấu hình, designer — xử lý tay như hiện nay).
 *  4. Design khác: đơn CHƯA vào In và không đang giữ → cập nhật (cùng logic nút
 *     "Kiểm tra design mới": ghi design + xoá kết quả soát tool). Đã vào In /
 *     đang giữ → CHỈ BÁO.
 *  5. Size khác (= app map lại SKU): đơn chưa vào In → cập nhật size + giá vốn
 *     theo app (như lượt import vẫn làm). Đã vào In → CHỈ BÁO.
 *  6. An toàn: số đơn cần ghi vượt trần → bỏ CẢ lượt (không ghi gì).
 */
import type { DesignFields } from 'shared';

/** Mặc định chỉ chạy cho xưởng decor (mã manufacture bên app). */
export const DEFAULT_ONOSPOD_ORDER_RESYNC_MANUFACTURES = ['TN-DECOR'];
/** Cửa sổ quét: item vào sản xuất trong N ngày gần nhất. */
export const ONOSPOD_ORDER_RESYNC_WINDOW_DAYS = 14;
/** Trần số đơn GHI mỗi lượt — vượt là nghi dữ liệu, bỏ cả lượt. */
export const ONOSPOD_ORDER_RESYNC_MAX_WRITES = 30;

export type ResyncAppItem = {
  productionId: string;
  /** `manufacture.sku` bên app (vd `TN-DECOR`). */
  manufactureSku?: string;
  /** Tên loại sản phẩm (= `orders.type`). */
  type?: string;
  /** `meta_data` "Size" (= `orders.size`). */
  size?: string;
  /** `meta_data` "Sku" — chỉ để hiển thị trong báo cáo. */
  sku?: string;
  baseCost?: number;
  designs: Partial<DesignFields>;
};

export type ResyncOrderState = {
  orderId: string;
  productionId: string;
  type?: string | null;
  size?: string | null;
  baseCost?: number | null;
  designs?: Partial<DesignFields> | null;
  designsOriginal?: Partial<DesignFields> | null;
  heldAt?: Date | null;
  cancelledAt?: Date | null;
  fulfillmentCompletedAt?: Date | null;
  /** Công đoạn In đã bắt đầu / xong (`fulfillmentStages.print.{firstStartedAt,startedAt,completedAt}`). */
  printStarted: boolean;
};

export type ResyncRef = { orderId: string; productionId: string };

export type ResyncDesignUpdate = ResyncRef & { changedKeys: string[] };

export type ResyncSizeUpdate = ResyncRef & {
  before: string | null;
  after: string;
  baseCostBefore: number | null;
  /** `undefined` = app không có giá → giữ giá cũ. */
  baseCostAfter?: number;
  sku?: string;
};

export type ResyncNoticeReason =
  | 'product-changed'
  | 'design-after-print'
  | 'design-held'
  | 'size-after-print';

export type ResyncNotice = ResyncRef & { reason: ResyncNoticeReason; detail: string };

export type ResyncPlan = {
  aborted: boolean;
  reason?: string;
  designUpdates: ResyncDesignUpdate[];
  sizeUpdates: ResyncSizeUpdate[];
  notices: ResyncNotice[];
  /** Item trong phạm vi nhưng fac không có đơn (chưa import / mã khác). */
  notFound: string[];
  /** Item trong phạm vi, có đơn, không lệch gì. */
  unchanged: number;
  /** Item trong phạm vi (sau lọc manufacture, đã gộp trùng). */
  considered: number;
};

export type ResyncPlanInput = {
  items: ResyncAppItem[];
  orders: ResyncOrderState[];
  manufactures: string[];
  maxWrites?: number;
};

const norm = (s?: string | null): string => (s ?? '').trim();
const sameText = (a?: string | null, b?: string | null): boolean => norm(a).toLowerCase() === norm(b).toLowerCase();

/**
 * Vị trí design app có mà baseline của đơn khác — CÙNG cách so của
 * `applyDesignFromOnospod()` (baseline = `designsOriginal ?? designs`, chỉ xét
 * vị trí app trả về; app không có vị trí đó thì không coi là lệch).
 */
export function diffDesignKeys(
  app: Partial<DesignFields>,
  order: Pick<ResyncOrderState, 'designs' | 'designsOriginal'>,
): string[] {
  const baseline = (order.designsOriginal ?? order.designs ?? {}) as Record<string, string | undefined>;
  const keys: string[] = [];
  for (const [key, value] of Object.entries(app)) {
    if (!value) continue;
    if (baseline[key] !== value) keys.push(key);
  }
  return keys;
}

export function planOnospodOrderResync(input: ResyncPlanInput): ResyncPlan {
  const maxWrites = input.maxWrites ?? ONOSPOD_ORDER_RESYNC_MAX_WRITES;
  const scope = new Set(input.manufactures.map((m) => norm(m).toUpperCase()).filter(Boolean));
  const plan: ResyncPlan = {
    aborted: false,
    designUpdates: [],
    sizeUpdates: [],
    notices: [],
    notFound: [],
    unchanged: 0,
    considered: 0,
  };

  // Gộp trùng productionId (phân trang live có thể lặp) — giữ bản xuất hiện sau cùng.
  const items = new Map<string, ResyncAppItem>();
  for (const it of input.items) {
    const pid = norm(it.productionId);
    if (!pid || !scope.has(norm(it.manufactureSku).toUpperCase())) continue;
    items.set(pid, it);
  }
  plan.considered = items.size;

  const orders = new Map<string, ResyncOrderState>();
  for (const o of input.orders) orders.set(o.productionId, o);

  for (const [pid, it] of items) {
    const o = orders.get(pid);
    if (!o) {
      plan.notFound.push(pid);
      continue;
    }
    if (o.cancelledAt || o.fulfillmentCompletedAt) continue;
    const ref: ResyncRef = { orderId: o.orderId, productionId: pid };

    if (norm(it.type) && !sameText(it.type, o.type)) {
      plan.notices.push({ ...ref, reason: 'product-changed', detail: `${norm(o.type) || '—'} → ${norm(it.type)}` });
      continue;
    }

    let touched = false;

    const changedKeys = diffDesignKeys(it.designs, o);
    if (changedKeys.length > 0) {
      touched = true;
      if (o.heldAt) {
        plan.notices.push({ ...ref, reason: 'design-held', detail: changedKeys.join(', ') });
      } else if (o.printStarted) {
        plan.notices.push({ ...ref, reason: 'design-after-print', detail: changedKeys.join(', ') });
      } else {
        plan.designUpdates.push({ ...ref, changedKeys });
      }
    }

    if (norm(it.size) && !sameText(it.size, o.size)) {
      touched = true;
      const detail = `${norm(o.size) || '—'} → ${norm(it.size)}`;
      if (o.printStarted) {
        plan.notices.push({ ...ref, reason: 'size-after-print', detail });
      } else {
        plan.sizeUpdates.push({
          ...ref,
          before: o.size ?? null,
          after: norm(it.size),
          baseCostBefore: o.baseCost ?? null,
          baseCostAfter: it.baseCost,
          sku: it.sku,
        });
      }
    }

    if (!touched) plan.unchanged++;
  }

  const writes = new Set([...plan.designUpdates, ...plan.sizeUpdates].map((u) => u.orderId)).size;
  if (writes > maxWrites) {
    return { ...plan, aborted: true, reason: `Số đơn cần ghi (${writes}) vượt trần ${maxWrites} — không ghi gì` };
  }
  return plan;
}

const NOTICE_LABEL: Record<ResyncNoticeReason, string> = {
  'product-changed': 'đổi sản phẩm',
  'design-after-print': 'đổi design, đơn đã vào In',
  'design-held': 'đổi design, đơn đang giữ',
  'size-after-print': 'đổi size, đơn đã vào In',
};

/** Tin Telegram cho 1 lượt (null = không có gì để báo). */
export function formatResyncReport(plan: ResyncPlan, opts: { dryRun: boolean; maxLines?: number }): string | null {
  const max = opts.maxLines ?? 15;
  if (plan.aborted) {
    return `⚠️ Đồng bộ đơn theo OnosPod đã DỪNG, không ghi gì.\nLý do: ${plan.reason}`;
  }
  const total = plan.designUpdates.length + plan.sizeUpdates.length + plan.notices.length;
  if (total === 0) return null;

  const verb = opts.dryRun ? 'SẼ cập nhật (dry-run, chưa ghi)' : 'Đã cập nhật';
  const lines: string[] = [`🔄 Đồng bộ đơn theo OnosPod — ${opts.dryRun ? 'DRY-RUN' : 'ĐÃ GHI'}`];
  const list = <T>(title: string, rows: T[], fmt: (r: T) => string) => {
    if (rows.length === 0) return;
    lines.push('', `${title} (${rows.length}):`);
    rows.slice(0, max).forEach((r) => lines.push(`• ${fmt(r)}`));
    if (rows.length > max) lines.push(`… và ${rows.length - max} đơn nữa`);
  };
  list(`${verb} design`, plan.designUpdates, (u) => `${u.productionId}: ${u.changedKeys.join(', ')}`);
  list(`${verb} size`, plan.sizeUpdates, (u) => `${u.productionId}: ${u.before ?? '—'} → ${u.after}${u.sku ? ` (${u.sku})` : ''}`);
  list('Cần người xử lý', plan.notices, (n) => `${n.productionId}: ${NOTICE_LABEL[n.reason]} (${n.detail})`);
  return lines.join('\n');
}
