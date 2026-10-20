import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TelegramService } from 'core';
import { Model } from 'mongoose';
import type { OnospodFactorySyncResult } from 'shared';
import { Logger } from 'winston';

import { ApiConfigService } from '@/shared/services';

import { FactoryRepository } from '../factory/factory.repository';
import { SystemConfigService } from '../system-config/system-config.service';
import type { FactorySyncChange, FactorySyncSkip } from './onospod-factory-sync.plan';
import {
  parseOnospodFactoryMap,
  parseOnospodFactorySyncMode,
  planOnospodFactorySync,
} from './onospod-factory-sync.plan';
import { OnospodProductImportService } from './onospod-product-import.service';
import { ProductConfigEntity } from './product-config.entity';

/** Kết quả lượt gần nhất (cả tự động lẫn chạy tay) — xem qua `GET .../onospod-factory-sync/last-run`. */
export const ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY = 'onospod_factory_sync_last_run';
/** Lượt tự động cách nhau ít nhất chừng này (import đơn chạy dày hơn nhiều). */
const AUTO_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Lượt tự động định đổi quá số sản phẩm này = bất thường (app bị sửa hàng loạt,
 * bảng quy đổi sai...) → dừng, không ghi, báo Telegram. Chạy tay không bị chặn.
 */
const AUTO_MAX_CHANGES = 10;
/** App trả ít hơn chừng này sản phẩm = nghi lỗi phía OnosPod (thật ~223) → dừng. */
const MIN_APP_PRODUCTS = 100;
/** Cùng một cảnh báo không gửi lại trong khoảng này. */
const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;
const TELEGRAM_MAX_LINES = 30;

const SKIP_LABEL: Record<FactorySyncSkip['reason'], string> = {
  'no-manufacture': 'app chưa gán xưởng',
  'unmapped-manufacture': 'xưởng app chưa có trong bảng quy đổi',
  'factory-missing': 'bảng quy đổi trỏ tới xưởng fac không tồn tại',
  'not-on-fac': 'không có trên fac',
  'fac-only-factory': 'fac đang để xưởng app không có (giữ nguyên)',
  conflict: 'nhiều sản phẩm app khác xưởng cùng khớp 1 sản phẩm fac',
};

/**
 * Đồng bộ XƯỞNG sản phẩm theo app OnosPod (Products.md §2.7a): app đổi xưởng
 * → `ProductConfig.factoryId` đổi theo → đơn import SAU đó vào xưởng mới. Đơn
 * đã nhập giữ nguyên xưởng.
 *
 * Kích hoạt: đầu mỗi lượt import đơn từ OnosPod (`OnospodImportService`, giãn
 * tối thiểu 15 phút, theo env `ONOSPOD_FACTORY_SYNC_MODE`) + nút/endpoint chạy
 * tay cho Admin (mặc định chỉ báo cáo).
 */
@Injectable()
export class OnospodFactorySyncService {
  private inFlight: Promise<OnospodFactorySyncResult> | null = null;
  private lastAutoAt = 0;
  private lastAlert: { text: string; at: number } | null = null;

  constructor(
    private readonly apiConfigService: ApiConfigService,
    private readonly onospodProductImportService: OnospodProductImportService,
    private readonly factoryRepository: FactoryRepository,
    private readonly systemConfigService: SystemConfigService,
    private readonly telegramService: TelegramService,
    @InjectModel(ProductConfigEntity.name)
    private readonly productConfigModel: Model<ProductConfigEntity>,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  /**
   * Gọi từ import đơn. Trả `undefined` khi tắt hoặc chưa tới lượt. Không bao
   * giờ ném — lỗi đồng bộ xưởng không được làm hỏng import đơn.
   */
  async runIfDue(): Promise<OnospodFactorySyncResult | undefined> {
    const mode = parseOnospodFactorySyncMode(this.apiConfigService.onospodFactorySync.mode);
    if (mode === 'off' || Date.now() - this.lastAutoAt < AUTO_INTERVAL_MS) return undefined;
    this.lastAutoAt = Date.now();
    try {
      return await this.sync({ dryRun: mode === 'dry-run', trigger: 'auto' });
    } catch (err) {
      this.logger.error({ message: `[onospod-factory-sync] ${err instanceof Error ? err.message : String(err)}` });
      return undefined;
    }
  }

  /** Lượt gọi chồng nhau trong cùng tiến trình → lượt sau nhận chung kết quả lượt đang chạy. */
  sync(opts: { dryRun: boolean; trigger: 'auto' | 'manual'; userId?: string }): Promise<OnospodFactorySyncResult> {
    if (!this.inFlight) {
      this.inFlight = this.run(opts).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  async getLastRun(): Promise<OnospodFactorySyncResult | null> {
    return this.systemConfigService.get<OnospodFactorySyncResult>(ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY);
  }

  private async run(opts: { dryRun: boolean; trigger: 'auto' | 'manual'; userId?: string }): Promise<OnospodFactorySyncResult> {
    const result: OnospodFactorySyncResult = {
      status: 'ok',
      dryRun: opts.dryRun,
      trigger: opts.trigger,
      ranAt: new Date().toISOString(),
      appProducts: 0,
      unchanged: 0,
      changes: [],
      applied: 0,
      skipped: [],
    };
    const finish = async (r: OnospodFactorySyncResult) => {
      this.logger.info({
        message: JSON.stringify({
          action: 'onospodFactorySync',
          userId: opts.userId,
          status: r.status,
          reason: r.reason,
          dryRun: r.dryRun,
          trigger: r.trigger,
          applied: r.applied,
          changes: r.changes.map((c) => `${c.productConfigId}:${c.fromFactory ?? '-'}→${c.toFactory}`),
        }),
      });
      await this.systemConfigService.set(ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY, r, 'Kết quả lượt đồng bộ xưởng theo OnosPod gần nhất');
      if (r.trigger === 'auto') await this.notify(r);
      return r;
    };
    const aborted = (reason: string) => finish({ ...result, status: 'aborted', reason });

    let appProducts, manufactures;
    try {
      [appProducts, manufactures] = await Promise.all([
        this.onospodProductImportService.fetchFactorySyncProducts(),
        this.onospodProductImportService.fetchManufactures(),
      ]);
    } catch (err) {
      return aborted(`Gọi OnosPod thất bại: ${err instanceof Error ? err.message : String(err)}`);
    }
    result.appProducts = appProducts.length;
    if (appProducts.length < MIN_APP_PRODUCTS) {
      return aborted(`OnosPod chỉ trả ${appProducts.length} sản phẩm (< ${MIN_APP_PRODUCTS}) — nghi dữ liệu thiếu`);
    }
    if (manufactures.length === 0) return aborted('OnosPod không trả danh sách xưởng');

    const [facDocs, factoryDocs] = await Promise.all([
      this.productConfigModel
        .find({ deletedAt: { $exists: false } })
        .select('fullName sku variations.sku factoryId')
        .lean(),
      this.factoryRepository.findAll({}),
    ]);

    const plan = planOnospodFactorySync({
      appProducts,
      manufactures,
      facProducts: facDocs.map((p) => ({
        _id: String(p._id),
        fullName: p.fullName,
        sku: p.sku,
        variationSkus: (p.variations ?? []).map((v) => v.sku).filter((s): s is string => !!s),
        factoryId: p.factoryId ? String(p.factoryId) : undefined,
      })),
      factories: factoryDocs.map((f) => ({ _id: String(f._id), shortName: f.shortName })),
      factoryMap: parseOnospodFactoryMap(this.apiConfigService.onospodFactorySync.factoryMap),
    });
    result.changes = plan.changes;
    result.skipped = plan.skipped;
    result.unchanged = plan.unchanged;

    if (opts.dryRun || plan.changes.length === 0) return finish(result);
    if (opts.trigger === 'auto' && plan.changes.length > AUTO_MAX_CHANGES) {
      return aborted(
        `Định đổi ${plan.changes.length} sản phẩm (> ${AUTO_MAX_CHANGES}/lượt tự động) — kiểm tra app/bảng quy đổi rồi chạy tay`,
      );
    }

    for (const c of plan.changes) {
      // Ghi có điều kiện: chỉ đổi khi xưởng vẫn đúng như lúc lập kế hoạch (không đè thao tác tay vừa xảy ra).
      const res = await this.productConfigModel.updateOne(
        { _id: c.productConfigId, factoryId: c.fromFactoryId ?? null },
        { $set: { factoryId: c.toFactoryId } },
      );
      result.applied += res.modifiedCount;
    }
    return finish(result);
  }

  /**
   * Telegram cho lượt tự động: có ghi thật, có kế hoạch đổi (dry-run) hoặc bị
   * dừng. Lượt không có gì để đổi thì im lặng. Cùng nội dung không gửi lại trong 6 giờ.
   */
  private async notify(r: OnospodFactorySyncResult): Promise<void> {
    if (r.status === 'ok' && r.changes.length === 0) return;
    const line = (c: FactorySyncChange) => `• ${c.fullName}: ${c.fromFactory ?? '(trống)'} → ${c.toFactory}`;
    let text: string;
    if (r.status === 'aborted') {
      text = `⚠️ Đồng bộ xưởng theo OnosPod bị dừng, chưa ghi gì.\nLý do: ${r.reason}`;
    } else {
      const head = r.dryRun
        ? `🔎 Đồng bộ xưởng theo OnosPod (chế độ chỉ báo cáo, CHƯA ghi): ${r.changes.length} sản phẩm sẽ đổi xưởng`
        : `🏭 Đã đồng bộ xưởng theo OnosPod: ${r.applied}/${r.changes.length} sản phẩm đổi xưởng (áp cho đơn nhập từ giờ)`;
      const lines = r.changes.slice(0, TELEGRAM_MAX_LINES).map(line);
      if (r.changes.length > TELEGRAM_MAX_LINES) lines.push(`… và ${r.changes.length - TELEGRAM_MAX_LINES} sản phẩm khác`);
      text = [head, ...lines].join('\n');
    }
    const kept = r.skipped.filter((s) => s.reason === 'fac-only-factory' || s.reason === 'conflict');
    if (kept.length) {
      text += `\n\nKhông đồng bộ (${kept.length}):\n` + kept.map((s) => `• ${s.fullName}: ${SKIP_LABEL[s.reason]}`).join('\n');
    }

    const now = Date.now();
    if (this.lastAlert && this.lastAlert.text === text && now - this.lastAlert.at < ALERT_THROTTLE_MS) return;
    this.lastAlert = { text, at: now };

    const c = this.apiConfigService.telegram;
    const channels = (c.notificationChannelId || c.channelId || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!c.notificationEnabled || channels.length === 0) {
      this.logger.warn({ message: `[onospod-factory-sync] ${text}` });
      return;
    }
    await Promise.allSettled(
      channels.map((id) => this.telegramService.sendMessageToChannel(id, text, { disableWebPagePreview: true })),
    );
  }
}
