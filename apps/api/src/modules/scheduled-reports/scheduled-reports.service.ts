import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import { TelegramService } from 'core';
import { Logger } from 'winston';

import { ApiConfigService } from '@/shared/services';

import { TelegramNotificationService } from '../telegram-notification/telegram-notification.service';
import { DailyOrdersAggregator } from './aggregators/daily-orders-aggregator';
import type { ReportKind } from './types';
import { laTienTrinhChayCron } from '@/utils/cron-guard';

const TZ = 'Asia/Ho_Chi_Minh';

export type RunReportResult = {
  /** Báo cáo đã aggregate + gửi thành công. */
  ok: boolean;
  /** Có request khác đang chạy — bị từ chối, chờ xong rồi gọi lại. */
  busy?: boolean;
};

/**
 * Báo cáo Telegram duy nhất "Đơn 3 ngày liền kề" (thay 3 báo cáo
 * designer/factory/error cũ, 2026-08). Cron vẫn 3 lần/ngày; ngoài ra trigger
 * được từ nút web Dashboard + nút inline trên chính message Telegram (webhook).
 */
@Injectable()
export class ScheduledReportsService implements OnModuleInit {
  /**
   * Khóa in-flight: group ít người nên KHÔNG rate-limit — chỉ chặn chạy chồng:
   * đang có 1 request chạy thì mọi trigger khác (nút Telegram/web/cron) bị trả
   * `busy`, chờ xong bấm lại. In-memory là đủ vì PM2 chạy single instance
   * (xem TelegramNotification.md §8 — scale cluster cần Redis lock).
   */
  private running = false;

  constructor(
    private readonly dailyOrdersAgg: DailyOrdersAggregator,
    private readonly telegram: TelegramNotificationService,
    private readonly telegramService: TelegramService,
    private readonly config: ApiConfigService,
    private readonly adapterHost: HttpAdapterHost,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  /** Đăng ký webhook nhận callback nút bấm — chỉ khi đủ cả 2 env URL + secret. */
  async onModuleInit(): Promise<void> {
    const { webhookUrl, webhookSecret } = this.config.telegram;
    if (!webhookUrl || !webhookSecret) return;
    const ok = await this.telegramService.setWebhook(webhookUrl, webhookSecret);
    this.logger.info({ message: `[scheduled-reports] setWebhook ${webhookUrl}: ${ok ? 'OK' : 'FAILED'}` });
  }

  get isRunning(): boolean {
    return this.running;
  }

  @Cron('30 11 * * *', { name: 'scheduled-reports-noon', timeZone: TZ })
  async noonReport(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;
    await this.runScheduled();
  }

  @Cron('0 17 * * *', { name: 'scheduled-reports-evening', timeZone: TZ })
  async eveningReport(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;
    await this.runScheduled();
  }

  /** Mỗi lịch gửi 2 message: Tổng quan SLA (kèm bảng xưởng) rồi báo cáo Designer. */
  private async runScheduled(): Promise<void> {
    if (!this.config.scheduledReports.enabled) {
      this.logger.info({ message: '[scheduled-reports] skipped (disabled)' });

      return;
    }
    await this.run('daily');
    await this.run('designer');
  }

  async run(kind: ReportKind = 'daily', factoryId?: string): Promise<RunReportResult> {
    if (this.running) return { ok: false, busy: true };
    this.running = true;
    try {
      const now = new Date();
      const data = await this.dailyOrdersAgg.aggregate(now, factoryId);
      const payload = { data, generatedAt: now, isProduction: this.config.isProduction };
      if (kind === 'designer') {
        await this.telegram.notifyDesignerViewReport(payload);
      } else if (kind === 'detail') {
        await this.telegram.notifyDetailReport(payload);
      } else if (kind === 'tool-check') {
        await this.telegram.notifyToolCheckReport(payload);
      } else {
        // daily — kèm factoryId = phễu lọc theo 1 xưởng (resolve tên để hiện header).
        const factoryName = factoryId ? data.factories.find((f) => f.id === factoryId)?.name : undefined;
        await this.telegram.notifyDailyOrdersReport(payload, factoryName);
      }

      return { ok: true };
    } catch (error) {
      this.logger.info({
        message: `[scheduled-reports][WARN] ${kind} report failed`,
        error: error instanceof Error ? error.message : String(error),
      });

      return { ok: false };
    } finally {
      this.running = false;
    }
  }
}
