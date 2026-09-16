import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger } from 'winston';

@Injectable()
export class TestJob {
  constructor(@Inject('winston') private readonly logger: Logger) {}

  // KHÔNG cần chốt `laTienTrinhChayCron` như các cron khác: lịch này là
  // "31 tháng 2" — ngày không tồn tại, nên nó không bao giờ nổ. Giữ nguyên làm
  // ví dụ khai báo cron.
  @Cron('0 0 5 31 2 *', {
    name: 'TEST-CRON',
  })
  doTest() {
    this.logger.info('Test Cron Job');
  }
}
