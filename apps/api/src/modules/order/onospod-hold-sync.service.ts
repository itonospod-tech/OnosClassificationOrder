import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TelegramService } from 'core';
import { Model } from 'mongoose';
import type { OnospodHoldSyncResult } from 'shared';
import { HOLD_REASON_ONOSPOD, HoldSource } from 'shared';
import { Logger } from 'winston';

import { ApiConfigService } from '@/shared/services';

import type { AuditContext } from '../order-log/order-log.service';
import { OrderLogService } from '../order-log/order-log.service';
import type { HoldSyncOrderState, OnospodHoldItem } from './onospod-hold-sync.plan';
import { ONOSPOD_HOLD_SYNC_WINDOW_DAYS, planOnospodHoldSync, resolveOnHoldAt } from './onospod-hold-sync.plan';
import type { OnospodQcConfig } from './onospod-qc.client';
import { fetchMrpProductPage } from './onospod-qc.client';
import { OrderEntity } from './order.entity';
import { OrderService } from './order.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Mỗi trang 200 item — hiện tổng On Hold ~40 item/365 ngày nên 1 trang là đủ. */
const PAGE_SIZE = 200;
/** Quá số trang này = dữ liệu bất thường → bỏ cả lượt (không nhả nhầm vì thiếu trang). */
const MAX_PAGES = 10;
/** userAgent ghi vào order log để phân biệt thao tác hệ thống với thao tác người. */
export const ONOSPOD_HOLD_SYNC_USER_AGENT = 'onospod-hold-sync';
/** Không gửi lại cùng một cảnh báo Telegram trong khoảng này (cron chạy 10 phút/lần). */
const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;

// Query đọc tối giản — chỉ các field quyết định giữ/nhả.
const ON_HOLD_QUERY = `query PaginateMrpProductOnHold(
  $page_size: Int
  $page: Int
  $status: String
  $start: String
  $end: String
) {
  paginateMrpProduct(page: $page, perpage: $page_size, mrp_status: $status, start: $start, end: $end) {
    items {
      increment_id
      mrp_status
      mrp_created_at
      mrp_updated_at
      mrp_log {
        mrp_status
        created_at
      }
    }
    paginate {
      total_items
      current_page
      total_pages
    }
  }
}`;

type MrpOnHoldItem = {
  increment_id?: string | null;
  mrp_status?: string | null;
  mrp_created_at?: string | null;
  mrp_updated_at?: string | null;
  mrp_log?: Array<{ mrp_status?: string | null; created_at?: string | null } | null> | null;
};

type OrderLean = {
  _id: unknown;
  productionId: string;
  heldAt?: Date | null;
  holdSource?: string | null;
  cancelledAt?: Date | null;
  fulfillmentCompletedAt?: Date | null;
  inProductionAt?: Date | null;
  onospodHold?: { onHoldAt?: Date | null; seenAt?: Date | null } | null;
  onospodHoldDismissedAt?: Date | null;
};

/**
 * Đồng bộ trạng thái GIỮ đơn theo OnosPod (Orders.md §9d): item MRP bên
 * `qc.onospod.com` có `mrp_status = "On Hold"` → giữ đơn cùng `productionId`
 * (= `increment_id`) bên mình; OnosPod nhả → nhả đơn DO ĐỒNG BỘ giữ.
 *
 * Luật quyết định nằm ở hàm thuần `planOnospodHoldSync()`; service chỉ fetch →
 * lập kế hoạch → ghi có điều kiện. KHÔNG bắn sự kiện khách
 * (`emitCustomerOrderEvent`), KHÔNG reset tool / hủy gán designer / đổi công đoạn.
 *
 * Kích hoạt: cron ngoài `GET /orders/onospod-hold-sync/cron` + cuối mỗi lượt
 * `importFromOnosPod`. Không dùng `@Cron` nội bộ.
 */
@Injectable()
export class OnospodHoldSyncService {
  private inFlight: Promise<OnospodHoldSyncResult> | null = null;
  private lastAlert: { text: string; at: number } | null = null;

  constructor(
    private readonly apiConfigService: ApiConfigService,
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    private readonly orderLogService: OrderLogService,
    private readonly orderService: OrderService,
    private readonly telegramService: TelegramService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  /**
   * Hai lượt gọi chồng nhau trong cùng tiến trình (cron + nút import) → lượt sau
   * nhận chung kết quả lượt đang chạy. Khác tiến trình thì các lệnh ghi có điều
   * kiện vẫn chặn ghi trùng / log trùng.
   */
  sync(opts: { ip?: string; trigger: 'cron' | 'import' }): Promise<OnospodHoldSyncResult> {
    if (!this.inFlight) {
      this.inFlight = this.run(opts).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async run(opts: { ip?: string; trigger: 'cron' | 'import' }): Promise<OnospodHoldSyncResult> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - ONOSPOD_HOLD_SYNC_WINDOW_DAYS * DAY_MS);
    const result: OnospodHoldSyncResult = {
      status: 'ok',
      window: { start: windowStart.toISOString(), end: now.toISOString() },
      fetched: 0,
      held: [],
      unheld: [],
      flagged: [],
      flagCleared: [],
      dismissedSkipped: [],
      outOfWindowKept: [],
      notFound: 0,
      unchanged: 0,
    };
    const aborted = (reason: string): OnospodHoldSyncResult => {
      this.logger.error({
        message: JSON.stringify({ action: 'onospodHoldSync', trigger: opts.trigger, status: 'aborted', reason }),
      });
      return { ...result, status: 'aborted', reason };
    };

    const config = this.apiConfigService.onospodQcConfig;
    if (!config) {
      return aborted('OnosPod QC chưa được cấu hình (thiếu ONOSPOD_QC_API_URL / ONOSPOD_QC_BEARER_TOKEN)');
    }

    let items: OnospodHoldItem[];
    try {
      items = await this.fetchOnHoldItems(config, windowStart, now);
    } catch (err) {
      return aborted(`Lấy danh sách On Hold từ OnosPod thất bại: ${err instanceof Error ? err.message : String(err)}`);
    }
    result.fetched = items.length;

    try {
      const productionIds = [...new Set(items.map((i) => i.productionId))];
      const docs = (await this.orderModel
        .find({
          deletedAt: { $exists: false },
          $or: [
            { productionId: { $in: productionIds } },
            { holdSource: HoldSource.Onospod, heldAt: { $exists: true } },
            { 'onospodHold.onHoldAt': { $exists: true } },
          ],
        })
        .select(
          'productionId heldAt holdSource cancelledAt fulfillmentCompletedAt inProductionAt onospodHold onospodHoldDismissedAt',
        )
        .lean()) as unknown as OrderLean[];

      const orders: HoldSyncOrderState[] = docs.map((d) => ({
        orderId: String(d._id),
        productionId: d.productionId,
        heldAt: d.heldAt,
        holdSource: d.holdSource,
        cancelledAt: d.cancelledAt,
        fulfillmentCompletedAt: d.fulfillmentCompletedAt,
        inProductionAt: d.inProductionAt,
        onospodHold: d.onospodHold,
        onospodHoldDismissedAt: d.onospodHoldDismissedAt,
      }));

      const plan = planOnospodHoldSync({ items, orders, now, windowStart });
      result.notFound = plan.notFound.length;
      result.unchanged = plan.unchanged;
      result.dismissedSkipped = plan.dismissedSkip.map((a) => a.productionId);
      result.outOfWindowKept = plan.outOfWindow.map((a) => a.productionId);

      if (plan.aborted) {
        void this.alert(
          `⚠️ Đồng bộ giữ đơn OnosPod đã DỪNG, không ghi gì.\nLý do: ${plan.reason}\n` +
            `On Hold nhận: ${items.length} · Đơn đang giữ theo OnosPod: ${plan.syncedHeldCount} · Cần nhả: ${plan.toUnhold.length}`,
        );
        return aborted(plan.reason ?? 'Kế hoạch đồng bộ bị dừng');
      }

      const ctx: AuditContext = { ip: opts.ip, userAgent: ONOSPOD_HOLD_SYNC_USER_AGENT };

      for (const a of plan.toHold) {
        await this.safeWrite(a.productionId, async () => {
          // Ghi CÓ ĐIỀU KIỆN: nhân viên vừa giữ / đơn vừa hủy / vừa xong giữa lúc
          // lập kế hoạch và lúc ghi → không khớp, không ghi, không log.
          const res = await this.orderModel.updateOne(
            {
              _id: a.orderId,
              heldAt: { $exists: false },
              cancelledAt: { $exists: false },
              fulfillmentCompletedAt: null,
              deletedAt: { $exists: false },
            },
            {
              $set: {
                heldAt: now,
                holdReason: HOLD_REASON_ONOSPOD,
                holdSource: HoldSource.Onospod,
                onospodHold: a.flag,
              },
            },
          );
          if (res.modifiedCount !== 1) return;
          result.held.push(a.productionId);
          void this.orderLogService.write({
            orderId: a.orderId,
            action: 'hold',
            field: 'heldAt',
            before: null,
            after: HOLD_REASON_ONOSPOD,
            ctx,
          });
        });
      }

      for (const a of plan.toUnhold) {
        await this.safeWrite(a.productionId, async () => {
          const res = await this.orderModel.updateOne(
            { _id: a.orderId, heldAt: { $exists: true }, holdSource: HoldSource.Onospod },
            { $unset: { heldAt: 1, holdReason: 1, holdSource: 1, onospodHold: 1 } },
          );
          if (res.modifiedCount !== 1) return;
          result.unheld.push(a.productionId);
          void this.orderLogService.write({
            orderId: a.orderId,
            action: 'unhold',
            field: 'heldAt',
            before: HOLD_REASON_ONOSPOD,
            after: null,
            ctx,
          });
        });
      }

      for (const a of plan.flagOnly) {
        await this.safeWrite(a.productionId, async () => {
          const res = await this.orderModel.updateOne({ _id: a.orderId }, { $set: { onospodHold: a.flag } });
          if (res.modifiedCount === 1) result.flagged.push(a.productionId);
        });
      }

      for (const a of plan.clearFlag) {
        await this.safeWrite(a.productionId, async () => {
          const res = await this.orderModel.updateOne(
            { _id: a.orderId, holdSource: { $ne: HoldSource.Onospod } },
            { $unset: { onospodHold: 1 } },
          );
          if (res.modifiedCount === 1) result.flagCleared.push(a.productionId);
        });
      }

      const changed = result.held.length + result.unheld.length + result.flagged.length + result.flagCleared.length;
      if (changed > 0) void this.orderService.invalidateListCache();

      this.logger.info({
        message: JSON.stringify({
          action: 'onospodHoldSync',
          trigger: opts.trigger,
          fetched: result.fetched,
          held: result.held,
          unheld: result.unheld,
          flagged: result.flagged.length,
          flagCleared: result.flagCleared.length,
          dismissedSkipped: result.dismissedSkipped.length,
          outOfWindowKept: result.outOfWindowKept.length,
          notFound: result.notFound,
        }),
      });
      return result;
    } catch (err) {
      return aborted(`Lỗi hệ thống khi đồng bộ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Lấy TOÀN BỘ item On Hold trong cửa sổ. Thiếu trang / tổng không khớp / item
   * sai trạng thái / thiếu mốc → NÉM, để lượt đồng bộ bị bỏ thay vì nhả nhầm đơn
   * vì danh sách thiếu.
   */
  private async fetchOnHoldItems(config: OnospodQcConfig, start: Date, end: Date): Promise<OnospodHoldItem[]> {
    const raw: MrpOnHoldItem[] = [];
    let totalItems: number | null = null;
    let totalPages = 1;
    let page = 1;

    do {
      const res = await fetchMrpProductPage<MrpOnHoldItem>(
        config,
        {
          operationName: 'PaginateMrpProductOnHold',
          query: ON_HOLD_QUERY,
          variables: {
            page_size: PAGE_SIZE,
            page,
            status: 'On Hold',
            start: start.toISOString(),
            end: end.toISOString(),
          },
        },
        page,
      );
      if (page === 1) {
        if (typeof res.paginate.total_items !== 'number') {
          throw new Error('Response thiếu paginate.total_items');
        }
        totalItems = res.paginate.total_items;
        totalPages = res.paginate.total_pages || 1;
        if (totalPages > MAX_PAGES) throw new Error(`Số trang ${totalPages} vượt trần ${MAX_PAGES}`);
      }
      raw.push(...res.items);
      page++;
    } while (page <= totalPages);

    if (raw.length !== totalItems) {
      throw new Error(`Lấy thiếu item: nhận ${raw.length}/${totalItems}`);
    }

    return raw.map((it) => {
      const productionId = it.increment_id?.trim();
      if (!productionId) throw new Error('Item On Hold thiếu increment_id');
      if (it.mrp_status !== 'On Hold') {
        throw new Error(`Item ${productionId} có trạng thái "${it.mrp_status}" — bộ lọc On Hold không áp dụng`);
      }
      const onHoldAt = resolveOnHoldAt(it);
      if (!onHoldAt) throw new Error(`Item ${productionId} không có mốc thời gian giữ`);
      return { productionId, onHoldAt };
    });
  }

  private async safeWrite(productionId: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error({
        message: JSON.stringify({
          action: 'onospodHoldSync.write',
          productionId,
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  }

  /** Cảnh báo Telegram khi dừng lượt vì nghi ngờ/vượt trần. Không có kênh → chỉ log. */
  private async alert(text: string): Promise<void> {
    const now = Date.now();
    if (this.lastAlert && this.lastAlert.text === text && now - this.lastAlert.at < ALERT_THROTTLE_MS) return;
    this.lastAlert = { text, at: now };

    const c = this.apiConfigService.telegram;
    const channels = (c.notificationChannelId || c.channelId || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!c.notificationEnabled || channels.length === 0) {
      this.logger.error({ message: `[onospod-hold-sync] ${text}` });
      return;
    }
    await Promise.allSettled(
      channels.map((id) => this.telegramService.sendMessageToChannel(id, text, { disableWebPagePreview: true })),
    );
  }
}
