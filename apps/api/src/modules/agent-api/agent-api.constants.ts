/**
 * Hạn mức gọi của bộ API agent (`API-1`) — **nguồn duy nhất** (`API-4`).
 *
 * Trước `API-4`, con số này viết cứng năm lần trong `@Throttle(...)` của
 * `agent-api.controller.ts`, còn `AGENT_API_RATE_LIMIT_PER_MIN` thì được khai
 * trong cấu hình mà **không nơi nào tiêu thụ**: người vận hành chỉnh env rồi
 * tin là hạn mức đã đổi, trong khi không đổi gì.
 *
 * Đã gỡ biến env đó thay vì nối nó vào `@Throttle`: decorator được ước lượng
 * lúc **nạp module**, nên một hằng số đọc `process.env` ở đó phụ thuộc vào thứ
 * tự `dotenv.config()` chạy trước hay sau `import` — mong manh, và hỏng theo
 * kiểu im lặng (rơi về mặc định) đúng như cái bug này. Cách đúng để hạn mức
 * theo cấu hình là named throttler ở `ThrottlerModule`, tức đổi cơ chế
 * throttling của **cả app** — vượt xa phạm vi một bug fast track.
 *
 * Đổi giá trị ở đây là đổi hạn mức thật, và trang hướng dẫn Agent API (`API-3`)
 * đọc đúng hằng số này nên con số hiển thị không bao giờ lệch khỏi con số chặn.
 *
 * `API-9` nâng 60 → 600 theo yêu cầu người dùng. Đánh đổi cần nhớ: hạn mức là
 * thứ chặn một agent bị lỗi vòng lặp, nên nâng gấp mười nghĩa là một agent gọi
 * sai tạo được tải gấp mười trước khi bị chặn. Bộ API chỉ đọc và mọi truy vấn
 * đều có `maxTimeMS`, nên rủi ro nằm ở TẢI lên MongoDB chứ không ở dữ liệu —
 * thấy tải cao bất thường thì đây là chỗ chỉnh.
 */
export const AGENT_API_RATE_LIMIT_PER_MIN = 600;

/** Cửa sổ tính hạn mức, mili giây. */
export const AGENT_API_RATE_LIMIT_TTL_MS = 60_000;

/**
 * Trần gửi Zalo mỗi phút — CHẶT hơn hạn mức đọc rất nhiều.
 *
 * Đọc nhầm thì tốn một truy vấn; gửi nhầm thì có người thật đọc được, và một
 * agent lặp vòng có thể spam cả nhóm trước khi ai kịp tắt.
 */
export const AGENT_ZALO_SEND_PER_MIN = 10;
