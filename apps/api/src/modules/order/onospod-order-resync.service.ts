import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Logger } from 'winston';

import { ApiConfigService } from '@/shared/services';

import type { AuditContext } from '../order-log/order-log.service';
import { OrderLogService } from '../order-log/order-log.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { OnospodHoldSyncService } from './onospod-hold-sync.service';
import type { ResyncAppItem, ResyncOrderState, ResyncPlan } from './onospod-order-resync.plan';
import {
  DEFAULT_ONOSPOD_ORDER_RESYNC_MANUFACTURES,
  formatResyncReport,
  planOnospodOrderResync,
} from './onospod-order-resync.plan';
import { OrderEntity } from './order.entity';
import { OrderService } from './order.service';

/** userAgent ghi vào order log để phân biệt thao tác hệ thống với thao tác người. */
export const ONOSPOD_ORDER_RESYNC_USER_AGENT = 'onospod-order-resync';
export const ONOSPOD_ORDER_RESYNC_LAST_RUN_KEY = 'onospod_order_resync_last_run';
/** Tối đa 1 lượt / 20 phút dù import chạy dày hơn. */
const AUTO_INTERVAL_MS = 20 * 60 * 1000;

export type OnospodOrderResyncResult = {
  status: 'ok' | 'aborted' | 'error';
  mode: 'dry-run' | 'on';
  ranAt: string;
  manufactures: string[];
  fetched: number;
  considered: number;
  notFound: number;
  unchanged: number;
  designUpdates: ResyncPlan['designUpdates'];
  sizeUpdates: ResyncPlan['sizeUpdates'];
  notices: ResyncPlan['notices'];
  /** Chỉ chế độ `on`: productionId đã ghi thật. */
  appliedDesign: string[];
  appliedSize: string[];
  reason?: string;
};

type OrderLean = {
  _id: unknown;
  productionId: string;
  type?: string | null;
  size?: string | null;
  baseCost?: number | null;
  designs?: ResyncOrderState['designs'];
  designsOriginal?: ResyncOrderState['designsOriginal'];
  heldAt?: Date | null;
  cancelledAt?: Date | null;
  fulfillmentCompletedAt?: Date | null;
  fulfillmentStages?: { print?: { firstStartedAt?: Date; startedAt?: Date; completedAt?: Date } | null } | null;
};

/**
 * Đồng bộ lại đơn ĐANG MỞ theo app OnosPod (Orders.md §9e): app đổi design /
 * map lại SKU sau khi đơn đã import → fac cập nhật theo. Luật ở hàm thuần
 * `planOnospodOrderResync()`; service chỉ fetch → lập kế hoạch → ghi có điều kiện.
 *
 * Chạy cuối mỗi lượt `importFromOnosPod` (cron ngoài 30 phút/lần), giãn tối thiểu
 * 20 phút. Chế độ theo env `ONOSPOD_ORDER_RESYNC_MODE`: `off` (mặc định) không
 * làm gì · `dry-run` chỉ lập kế hoạch + lưu `system_configs` + báo Telegram ·
 * `on` ghi thật. KHÔNG BAO GIỜ ném — lỗi chỉ log, không làm hỏng lượt import.
 */
@Injectable()
export class OnospodOrderResyncService {
  private lastAutoAt = 0;
  private inFlight: Promise<OnospodOrderResyncResult | undefined> | null = null;

  constructor(
    private readonly apiConfigService: ApiConfigService,
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    private readonly orderLogService: OrderLogService,
    private readonly orderService: OrderService,
    private readonly onospodHoldSyncService: OnospodHoldSyncService,
    private readonly systemConfigService: SystemConfigService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  /**
   * `fetchItems` do `OnospodImportService` truyền vào (dùng lại đúng query +
   * cách map của lượt import, không nhân đôi GraphQL ở đây).
   */
  runIfDue(fetchItems: () => Promise<ResyncAppItem[]>, ctx?: AuditContext): Promise<OnospodOrderResyncResult | undefined> {
    const { mode } = this.apiConfigService.onospodOrderResync;
    if (mode !== 'dry-run' && mode !== 'on') return Promise.resolve(undefined);
    if (this.inFlight) return this.inFlight;
    if (Date.now() - this.lastAutoAt < AUTO_INTERVAL_MS) return Promise.resolve(undefined);

    this.inFlight = this.run(fetchItems, mode, ctx)
      .then((r) => {
        // Lỗi gọi app → không đặt mốc, lượt import sau thử lại ngay.
        if (r.status !== 'error') this.lastAutoAt = Date.now();
        return r;
      })
      .catch((err: unknown) => {
        this.logger.error({
          message: JSON.stringify({ action: 'onospodOrderResync', error: err instanceof Error ? err.message : String(err) }),
        });
        return undefined;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  getLastRun(): Promise<OnospodOrderResyncResult | null> {
    return this.systemConfigService.get<OnospodOrderResyncResult>(ONOSPOD_ORDER_RESYNC_LAST_RUN_KEY);
  }

  private async run(
    fetchItems: () => Promise<ResyncAppItem[]>,
    mode: 'dry-run' | 'on',
    ctx?: AuditContext,
  ): Promise<OnospodOrderResyncResult> {
    const manufactures = this.parseManufactures(this.apiConfigService.onospodOrderResync.manufactures);
    const result: OnospodOrderResyncResult = {
      status: 'ok',
      mode,
      ranAt: new Date().toISOString(),
      manufactures,
      fetched: 0,
      considered: 0,
      notFound: 0,
      unchanged: 0,
      designUpdates: [],
      sizeUpdates: [],
      notices: [],
      appliedDesign: [],
      appliedSize: [],
    };

    let items: ResyncAppItem[];
    try {
      items = await fetchItems();
    } catch (err) {
      result.status = 'error';
      result.reason = `Lấy đơn từ OnosPod thất bại: ${err instanceof Error ? err.message : String(err)}`;
      this.logResult(result);
      return result;
    }
    result.fetched = items.length;

    const scope = new Set(manufactures);
    const productionIds = [
      ...new Set(items.filter((i) => scope.has((i.manufactureSku || '').trim().toUpperCase())).map((i) => i.productionId)),
    ];
    const docs = productionIds.length
      ? ((await this.orderModel
          .find({ productionId: { $in: productionIds }, deletedAt: { $exists: false } })
          .select(
            'productionId type size baseCost designs designsOriginal heldAt cancelledAt fulfillmentCompletedAt fulfillmentStages.print',
          )
          .lean()) as unknown as OrderLean[])
      : [];

    const orders: ResyncOrderState[] = docs.map((d) => {
      const p = d.fulfillmentStages?.print;
      return {
        orderId: String(d._id),
        productionId: d.productionId,
        type: d.type,
        size: d.size,
        baseCost: d.baseCost,
        designs: d.designs,
        designsOriginal: d.designsOriginal,
        heldAt: d.heldAt,
        cancelledAt: d.cancelledAt,
        fulfillmentCompletedAt: d.fulfillmentCompletedAt,
        printStarted: !!(p?.firstStartedAt || p?.startedAt || p?.completedAt),
      };
    });

    const plan = planOnospodOrderResync({ items, orders, manufactures });
    result.considered = plan.considered;
    result.notFound = plan.notFound.length;
    result.unchanged = plan.unchanged;
    result.designUpdates = plan.designUpdates;
    result.sizeUpdates = plan.sizeUpdates;
    result.notices = plan.notices;

    if (plan.aborted) {
      result.status = 'aborted';
      result.reason = plan.reason;
    } else if (mode === 'on') {
      await this.apply(plan, result, { ip: ctx?.ip, userAgent: ONOSPOD_ORDER_RESYNC_USER_AGENT });
    }

    await this.systemConfigService.set(
      ONOSPOD_ORDER_RESYNC_LAST_RUN_KEY,
      result,
      'Kết quả lượt đồng bộ đơn theo OnosPod gần nhất (design/size)',
    );
    const report = formatResyncReport(plan, { dryRun: mode !== 'on' });
    if (report) void this.onospodHoldSyncService.alert(report);
    this.logResult(result);
    return result;
  }

  private async apply(plan: ResyncPlan, result: OnospodOrderResyncResult, ctx: AuditContext): Promise<void> {
    for (const u of plan.designUpdates) {
      await this.safeWrite(u.productionId, async () => {
        const updated = await this.orderService.resyncDesignFromOnospod(u.orderId, ctx);
        if (updated) result.appliedDesign.push(u.productionId);
      });
    }

    for (const u of plan.sizeUpdates) {
      await this.safeWrite(u.productionId, async () => {
        // Ghi CÓ ĐIỀU KIỆN: size đổi / đơn vừa vào In / vừa hủy giữa lúc lập kế
        // hoạch và lúc ghi → không khớp, không ghi, không log.
        const $set: Record<string, unknown> = { size: u.after };
        if (typeof u.baseCostAfter === 'number') $set.baseCost = u.baseCostAfter;
        const res = await this.orderModel.updateOne(
          {
            _id: u.orderId,
            size: u.before,
            cancelledAt: { $exists: false },
            fulfillmentCompletedAt: null,
            'fulfillmentStages.print.firstStartedAt': { $exists: false },
            'fulfillmentStages.print.startedAt': { $exists: false },
            'fulfillmentStages.print.completedAt': { $exists: false },
          },
          { $set },
        );
        if (res.modifiedCount !== 1) return;
        result.appliedSize.push(u.productionId);
        void this.orderLogService.write({
          orderId: u.orderId,
          action: 'update',
          field: 'size',
          before: { size: u.before, baseCost: u.baseCostBefore },
          after: { size: u.after, baseCost: typeof u.baseCostAfter === 'number' ? u.baseCostAfter : u.baseCostBefore },
          ctx,
        });
      });
    }

    if (result.appliedDesign.length + result.appliedSize.length > 0) void this.orderService.invalidateListCache();
  }

  private parseManufactures(raw: string): string[] {
    const list = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return list.length ? list : DEFAULT_ONOSPOD_ORDER_RESYNC_MANUFACTURES;
  }

  private async safeWrite(productionId: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error({
        message: JSON.stringify({
          action: 'onospodOrderResync.write',
          productionId,
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  }

  private logResult(r: OnospodOrderResyncResult): void {
    this.logger.info({
      message: JSON.stringify({
        action: 'onospodOrderResync',
        status: r.status,
        mode: r.mode,
        fetched: r.fetched,
        considered: r.considered,
        designUpdates: r.designUpdates.map((u) => u.productionId),
        sizeUpdates: r.sizeUpdates.map((u) => u.productionId),
        notices: r.notices.length,
        appliedDesign: r.appliedDesign,
        appliedSize: r.appliedSize,
        reason: r.reason,
      }),
    });
  }
}
