import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TelegramService } from 'core';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import type { OnospodFactorySyncResult } from 'shared';
import { Logger } from 'winston';

import { ApiConfigService } from '@/shared/services';

import { FactoryRepository } from '../factory/factory.repository';
import { SystemConfigService } from '../system-config/system-config.service';
import type { FactorySyncChange, FactorySyncSkip } from './onospod-factory-sync.plan';
import {
  hashFactorySyncPlan,
  parseOnospodFactoryMap,
  parseOnospodFactorySyncMode,
  planOnospodFactorySync,
} from './onospod-factory-sync.plan';
import { OnospodProductImportService } from './onospod-product-import.service';
import { ProductConfigEntity } from './product-config.entity';

/** Kết quả lượt gần nhất (cả tự động lẫn chạy tay) — xem qua `GET .../onospod-factory-sync/last-run`. */
export const ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY = 'onospod_factory_sync_last_run';
/** Mã kế hoạch của lần xem trước gần nhất — áp dụng tay phải gửi đúng mã này. */
export const ONOSPOD_FACTORY_SYNC_PREVIEW_KEY = 'onospod_factory_sync_preview';
/** Khoá chạy (dùng chung mọi process) — chỉ 1 lượt đồng bộ tại một thời điểm. */
export const ONOSPOD_FACTORY_SYNC_LOCK_KEY = 'onospod_factory_sync_lock';
/** Lượt tự động cách nhau ít nhất chừng này (import đơn chạy dày hơn nhiều). */
const AUTO_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Lượt tự động định đổi quá số sản phẩm này = bất thường (app bị sửa hàng loạt,
 * bảng quy đổi sai...) → dừng, không ghi, báo Telegram. Chạy tay không bị chặn.
 */
const AUTO_MAX_CHANGES = 10;
/** App trả ít hơn chừng này sản phẩm = nghi lỗi phía OnosPod (thật ~223) → dừng. */
const MIN_APP_PRODUCTS = 100;
/** Mã xem trước hết hạn sau chừng này — quá hạn phải xem trước lại. */
const PREVIEW_TTL_MS = 30 * 60 * 1000;
/** Khoá giữ quá lâu = process chết giữa chừng → coi là mồ côi, chiếm lại. */
const LOCK_STALE_MS = 10 * 60 * 1000;
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
  ambiguous: 'khớp nhiều sản phẩm fac (trùng SKU/tên) — không đoán',
};

type SyncOpts =
  | { trigger: 'auto'; dryRun: boolean }
  | { trigger: 'manual'; dryRun: true; userId?: string }
  | { trigger: 'manual'; dryRun: false; planToken: string; userId?: string };

interface PreviewRecord {
  token: string;
  createdAt: string;
  userId?: string;
}

/**
 * Đồng bộ XƯỞNG sản phẩm theo app OnosPod (Products.md §2.7a): app đổi xưởng
 * → `ProductConfig.factoryId` đổi theo → đơn import SAU đó vào xưởng mới. Đơn
 * đã nhập giữ nguyên xưởng.
 *
 * - Tự động: đầu mỗi lượt import đơn từ OnosPod, giãn ≥15 phút, theo env
 *   `ONOSPOD_FACTORY_SYNC_MODE` (`off` không làm gì; `dry-run` chỉ báo cáo; `on` ghi).
 * - Chạy tay (Admin): xem trước → nhận `planToken` → áp dụng đúng kế hoạch đó.
 *   Áp dụng tay CHỈ khi env = `on`.
 * - Mỗi thời điểm chỉ 1 lượt (khoá trong `system_configs`, chung mọi process).
 */
@Injectable()
export class OnospodFactorySyncService {
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

  private get mode() {
    return parseOnospodFactorySyncMode(this.apiConfigService.onospodFactorySync.mode);
  }

  /**
   * Gọi từ import đơn. Trả `undefined` khi tắt, chưa tới lượt hoặc đang có lượt
   * khác chạy. Không bao giờ ném — lỗi đồng bộ xưởng không được làm hỏng import đơn.
   */
  async runIfDue(): Promise<OnospodFactorySyncResult | undefined> {
    const mode = this.mode;
    if (mode === 'off' || Date.now() - this.lastAutoAt < AUTO_INTERVAL_MS) return undefined;
    this.lastAutoAt = Date.now();
    try {
      const lockId = await this.acquireLock();
      if (!lockId) {
        this.logger.info({ message: '[onospod-factory-sync] bỏ lượt tự động: đang có lượt khác chạy' });
        return undefined;
      }
      try {
        return await this.run({ trigger: 'auto', dryRun: mode === 'dry-run' });
      } finally {
        await this.releaseLock(lockId);
      }
    } catch (err) {
      this.logger.error({ message: `[onospod-factory-sync] ${err instanceof Error ? err.message : String(err)}` });
      return undefined;
    }
  }

  /** Xem trước (không ghi `factoryId`) — trả kèm `planToken` để áp dụng. */
  preview(userId?: string): Promise<OnospodFactorySyncResult> {
    return this.runManual({ trigger: 'manual', dryRun: true, userId });
  }

  /**
   * Áp dụng đúng kế hoạch đã xem trước. Từ chối nếu env khác `on`, thiếu/sai/
   * hết hạn mã, hoặc dữ liệu đã đổi khiến kế hoạch khác lúc xem trước.
   */
  async apply(planToken: string | undefined, userId?: string): Promise<OnospodFactorySyncResult> {
    if (this.mode !== 'on') {
      throw new BadRequestException(
        `Đồng bộ xưởng đang ở chế độ "${this.mode}" — chỉ áp dụng được khi ONOSPOD_FACTORY_SYNC_MODE=on`,
      );
    }
    if (!planToken) throw new BadRequestException('Thiếu planToken — chạy xem trước (dryRun:true) rồi gửi lại mã nhận được');
    const preview = await this.systemConfigService.get<PreviewRecord>(ONOSPOD_FACTORY_SYNC_PREVIEW_KEY);
    if (!preview || preview.token !== planToken || Date.now() - Date.parse(preview.createdAt) > PREVIEW_TTL_MS) {
      throw new BadRequestException('planToken không khớp lần xem trước gần nhất hoặc đã hết hạn — chạy xem trước lại');
    }
    return this.runManual({ trigger: 'manual', dryRun: false, planToken, userId });
  }

  async getLastRun(): Promise<OnospodFactorySyncResult | null> {
    return this.systemConfigService.get<OnospodFactorySyncResult>(ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY);
  }

  private async runManual(opts: SyncOpts): Promise<OnospodFactorySyncResult> {
    const lockId = await this.acquireLock();
    if (!lockId) throw new ConflictException('Đang có lượt đồng bộ xưởng khác chạy — thử lại sau ít phút');
    try {
      return await this.run(opts);
    } finally {
      await this.releaseLock(lockId);
    }
  }

  private async run(opts: SyncOpts): Promise<OnospodFactorySyncResult> {
    const result: OnospodFactorySyncResult = {
      status: 'ok',
      dryRun: opts.dryRun,
      trigger: opts.trigger,
      ranAt: new Date().toISOString(),
      appProducts: 0,
      unchanged: 0,
      changes: [],
      applied: 0,
      applySkipped: 0,
      failed: 0,
      skipped: [],
    };
    const userId = opts.trigger === 'manual' ? opts.userId : undefined;
    const aborted = (reason: string) => this.finish({ ...result, status: 'aborted', reason }, userId);

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

    const factoryMap = parseOnospodFactoryMap(this.apiConfigService.onospodFactorySync.factoryMap);
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
      factoryMap,
    });
    result.changes = plan.changes;
    result.skipped = plan.skipped;
    result.unchanged = plan.unchanged;
    const token = hashFactorySyncPlan(plan.changes, factoryMap);

    if (opts.trigger === 'manual' && opts.dryRun) {
      result.planToken = token;
      const record: PreviewRecord = { token, createdAt: result.ranAt, userId };
      await this.systemConfigService.set(ONOSPOD_FACTORY_SYNC_PREVIEW_KEY, record, 'Mã kế hoạch xem trước đồng bộ xưởng OnosPod');
      return this.finish(result, userId);
    }
    if (opts.trigger === 'manual' && !opts.dryRun && token !== opts.planToken) {
      // Không ghi gì, không đè last-run — chỉ yêu cầu xem trước lại.
      throw new ConflictException('Dữ liệu app/fac đã đổi sau lần xem trước, kế hoạch không còn như cũ — chạy xem trước lại');
    }
    if (opts.dryRun || plan.changes.length === 0) return this.finish(result, userId);
    if (opts.trigger === 'auto' && plan.changes.length > AUTO_MAX_CHANGES) {
      return aborted(
        `Định đổi ${plan.changes.length} sản phẩm (> ${AUTO_MAX_CHANGES}/lượt tự động) — kiểm tra app/bảng quy đổi rồi xem trước + áp dụng tay`,
      );
    }

    // Mã dùng 1 lần — xoá TRƯỚC khi ghi để không áp dụng lại được dù lượt này hỏng giữa chừng
    // (partial / process chết): muốn ghi nốt phải xem trước lại, kế hoạch mới chỉ còn dòng chưa ghi.
    if (opts.trigger === 'manual') {
      const used: PreviewRecord = { token: '', createdAt: result.ranAt, userId };
      await this.systemConfigService.set(ONOSPOD_FACTORY_SYNC_PREVIEW_KEY, used, 'Mã kế hoạch xem trước đồng bộ xưởng OnosPod (đã dùng)');
    }

    for (const c of plan.changes) {
      try {
        // Ghi có điều kiện: chỉ đổi khi xưởng vẫn đúng như lúc lập kế hoạch (không đè thao tác tay vừa xảy ra).
        const res = await this.productConfigModel.updateOne(
          { _id: c.productConfigId, factoryId: c.fromFactoryId ?? { $in: [null, ''] } },
          { $set: { factoryId: c.toFactoryId } },
        );
        if (res.modifiedCount > 0) {
          c.outcome = 'applied';
          result.applied++;
        } else {
          c.outcome = 'skipped';
          result.applySkipped++;
        }
      } catch (err) {
        c.outcome = 'failed';
        c.error = err instanceof Error ? err.message : String(err);
        result.failed++;
      }
    }
    if (result.failed > 0) {
      result.status = 'partial';
      result.reason = `${result.failed}/${plan.changes.length} sản phẩm ghi lỗi — đã ghi ${result.applied}, xem từng dòng`;
    }
    return this.finish(result, userId);
  }

  /**
   * Log + lưu last-run + Telegram (lượt tự động). Lỗi khi lưu/báo KHÔNG được
   * nuốt mất kết quả: vẫn trả `r` (dữ liệu có thể đã đổi) và ghi log lỗi.
   */
  private async finish(r: OnospodFactorySyncResult, userId?: string): Promise<OnospodFactorySyncResult> {
    this.logger.info({
      message: JSON.stringify({
        action: 'onospodFactorySync',
        userId,
        status: r.status,
        reason: r.reason,
        dryRun: r.dryRun,
        trigger: r.trigger,
        applied: r.applied,
        applySkipped: r.applySkipped,
        failed: r.failed,
        changes: r.changes.map((c) => `${c.productConfigId}:${c.fromFactory ?? '-'}→${c.toFactory}${c.outcome ? `:${c.outcome}` : ''}`),
      }),
    });
    try {
      await this.systemConfigService.set(ONOSPOD_FACTORY_SYNC_LAST_RUN_KEY, r, 'Kết quả lượt đồng bộ xưởng theo OnosPod gần nhất');
    } catch (err) {
      this.logger.error({ message: `[onospod-factory-sync] không lưu được last-run: ${err instanceof Error ? err.message : String(err)}` });
    }
    if (r.trigger === 'auto') {
      try {
        await this.notify(r);
      } catch (err) {
        this.logger.error({ message: `[onospod-factory-sync] không gửi được Telegram: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    return r;
  }

  /**
   * Chiếm khoá (chưa có / đã nhả / mồ côi). Thua đua → `false`. Ai thắng do 2
   * thao tác NGUYÊN TỬ quyết định: `updateOne` có điều kiện trên 1 document, hoặc
   * `insertOne` được index unique `key` chặn (E11000). `findOne` ở giữa chỉ để biết
   * có nên thử insert hay không. Thắng → trả `lockId` riêng của lượt này (dùng để nhả).
   */
  private async acquireLock(): Promise<string | null> {
    const configs = this.productConfigModel.db.collection('system_configs');
    const now = new Date();
    const lockId = randomUUID();
    const res = await configs.updateOne(
      {
        key: ONOSPOD_FACTORY_SYNC_LOCK_KEY,
        $or: [{ 'value.lockedAt': null }, { 'value.lockedAt': { $lt: new Date(now.getTime() - LOCK_STALE_MS) } }],
      },
      { $set: { 'value.lockedAt': now, 'value.lockId': lockId, 'value.pid': process.pid, updatedAt: now } },
    );
    if (res.modifiedCount > 0) return lockId;
    if (await configs.findOne({ key: ONOSPOD_FACTORY_SYNC_LOCK_KEY }, { projection: { _id: 1 } })) return null;
    try {
      // Chưa có document khoá → tạo (đua với process khác thì E11000 do `key` unique → thua).
      await configs.insertOne({
        key: ONOSPOD_FACTORY_SYNC_LOCK_KEY,
        value: { lockedAt: now, lockId, pid: process.pid },
        description: 'Khoá chạy đồng bộ xưởng theo OnosPod',
        createdAt: now,
        updatedAt: now,
      });
      return lockId;
    } catch {
      return null;
    }
  }

  /**
   * Chỉ nhả khoá CỦA MÌNH (`lockId` khớp). Lượt bị treo quá 10 phút đã bị lượt khác
   * chiếm khoá mồ côi → lúc sống lại không nhả nhầm khoá của lượt kia.
   */
  private async releaseLock(lockId: string): Promise<void> {
    await this.productConfigModel.db
      .collection('system_configs')
      .updateOne(
        { key: ONOSPOD_FACTORY_SYNC_LOCK_KEY, 'value.lockId': lockId },
        { $set: { 'value.lockedAt': null, 'value.lockId': null, updatedAt: new Date() } },
      )
      .catch((err: unknown) => {
        this.logger.error({ message: `[onospod-factory-sync] không nhả được khoá: ${err instanceof Error ? err.message : String(err)}` });
      });
  }

  /**
   * Telegram cho lượt tự động: có ghi thật, có kế hoạch đổi (dry-run) hoặc bị
   * dừng. Lượt không có gì để đổi thì im lặng. Cùng nội dung không gửi lại trong 6 giờ.
   */
  private async notify(r: OnospodFactorySyncResult): Promise<void> {
    if (r.status === 'ok' && r.changes.length === 0) return;
    const line = (c: FactorySyncChange) =>
      `• ${c.fullName}: ${c.fromFactory ?? '(trống)'} → ${c.toFactory}${c.outcome && c.outcome !== 'applied' ? ` (${c.outcome === 'failed' ? 'LỖI' : 'bỏ qua — vừa bị đổi tay'})` : ''}`;
    let text: string;
    if (r.status === 'aborted') {
      text = `⚠️ Đồng bộ xưởng theo OnosPod bị dừng, chưa ghi gì.\nLý do: ${r.reason}`;
    } else {
      const head = r.dryRun
        ? `🔎 Đồng bộ xưởng theo OnosPod (chế độ chỉ báo cáo, CHƯA ghi): ${r.changes.length} sản phẩm sẽ đổi xưởng`
        : `${r.status === 'partial' ? '⚠️' : '🏭'} Đã đồng bộ xưởng theo OnosPod: ${r.applied}/${r.changes.length} sản phẩm đổi xưởng (áp cho đơn nhập từ giờ)` +
          (r.failed ? ` · ${r.failed} lỗi` : '') +
          (r.applySkipped ? ` · ${r.applySkipped} bỏ qua` : '');
      const lines = r.changes.slice(0, TELEGRAM_MAX_LINES).map(line);
      if (r.changes.length > TELEGRAM_MAX_LINES) lines.push(`… và ${r.changes.length - TELEGRAM_MAX_LINES} sản phẩm khác`);
      text = [head, ...lines].join('\n');
    }
    const kept = r.skipped.filter((s) => s.reason === 'fac-only-factory' || s.reason === 'conflict' || s.reason === 'ambiguous');
    if (kept.length) {
      text += `\n\nKhông đồng bộ (${kept.length}):\n` + kept.map((s) => `• ${s.fullName ?? s.appProduct}: ${SKIP_LABEL[s.reason]}`).join('\n');
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
