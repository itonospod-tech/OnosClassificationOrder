import type { HttpAdapterHost } from '@nestjs/core';

/**
 * Cron CHỈ được chạy ở tiến trình HTTP.
 *
 * Vì sao cần (đo trên prod 11/09/2026): `main.ts` gọi cả `bootstrap()` lẫn
 * `bootstrapMicroservice()` trong MỘT tiến trình, hai Nest context cùng nạp
 * `AppModule`, nên `ScheduleModule` đăng ký mọi `@Cron` hai lần và tới giờ
 * chúng nổ hai lần. Hậu quả đã thấy: báo cáo CEO sinh 2 bản cách nhau 1 giây
 * (gọi Agent SDK gấp đôi, tốn tiền thật) và báo cáo Telegram gửi 2 lần. Khoá
 * chống trùng trong bộ nhớ KHÔNG cứu được vì hai context giữ hai thực thể
 * service khác nhau.
 *
 * `main-nest.ts` có gỡ lịch ở context microservice, nhưng đó là lớp phòng xa:
 * trên prod `app.init()` của context đó TREO (log dừng ngay sau
 * `ZaloProxyService`), nên không được phụ thuộc vào nó. Chốt chặn thật nằm ở
 * đây — ngay trong thân cron, chạy bất kể bootstrap treo chỗ nào.
 *
 * Cùng dấu hiệu `ZaloProxyService` dùng: không có HTTP adapter = microservice.
 */
export function laTienTrinhChayCron(adapterHost?: HttpAdapterHost): boolean {
  return !!adapterHost?.httpAdapter;
}
