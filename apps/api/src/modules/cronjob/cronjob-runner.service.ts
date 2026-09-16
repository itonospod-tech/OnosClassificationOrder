import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronTime } from 'cron';
import { Logger } from 'winston';

import { CronjobService } from './cronjob.service';

@Injectable()
export class CronjobRunnerService implements OnModuleInit {
  constructor(
    private readonly cronjobService: CronjobService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly adapterHost: HttpAdapterHost,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  onModuleInit() {
    // `main.ts` dựng HAI Nest context từ cùng `AppModule` trong MỘT tiến trình,
    // nên hàm này chạy hai lần và mỗi cron trong DB bị đăng ký hai lần → chạy
    // đúp. `main-nest.ts` có dọn lịch ở tiến trình microservice, nhưng dọn ngay
    // sau `listen()` còn chỗ này thêm lịch SAU 2 giây — dọn xong nó mới thêm.
    // Nên phải chặn tại nguồn: không có HTTP adapter = tiến trình microservice.
    if (!this.adapterHost?.httpAdapter) {
      this.logger.info('Cronjob: bỏ qua ở tiến trình microservice (hẹn giờ là việc của tiến trình HTTP)');

      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      try {
        // this.stopCronjobs();
        await this.runActiveCronjobs();
      } catch (error) {
        this.logger.info(`Cronjob Error ${(error as Error).message}`);
      }
    }, 2000);
  }

  stopCronjobs() {
    const jobs = this.schedulerRegistry.getCronJobs();

    for (const job of jobs) {
      job[1].stop();
    }
  }

  async runActiveCronjobs() {
    const activeCronjobs = await this.cronjobService.findAllActiveCronjobs();

    for (const cronjob of activeCronjobs) {
      const jobs = this.schedulerRegistry.getCronJobs();

      for (const job of jobs) {
        if (job[0] === cronjob.code) {
          job[1].setTime(new CronTime(cronjob.duration));
          job[1].start();

          this.logger.info(`Cronjob ${job[0]} Started`);
        }
      }
    }
  }
}
