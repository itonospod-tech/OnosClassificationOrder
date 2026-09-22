import {
  collectionsRegistry,
  customerNotificationsRegistry,
  factoriesRegistry,
  machineTypesRegistry,
  productCategoriesRegistry,
  promotionsRegistry,
  workshopConfigsRegistry,
} from './catalog.registry';
import { customersRegistry } from './customers.registry';
import type { AgentTableSpec } from './field-policy';
import {
  inventoryItemsRegistry,
  inventoryReceiptsRegistry,
  inventoryTransactionsRegistry,
} from './inventory.registry';
import { orderLogsRegistry } from './order-logs.registry';
import { ordersRegistry } from './orders.registry';
import { productConfigsRegistry } from './product-configs.registry';

/**
 * TỪ ĐIỂN mô tả của bộ API agent — **không còn là cổng** (`API-19`).
 *
 * Tới `API-18` đây là danh sách trắng: bảng không có khoá ở đây là không tồn
 * tại đối với bộ API. `API-19` bỏ hẳn vai trò đó theo quyết định của người
 * dùng — agent nay đọc được **mọi collection** trong cơ sở dữ liệu, kể cả
 * collection thêm vào sau này và collection không ai mô tả.
 *
 * Mười một bảng dưới đây vẫn giữ nguyên giá trị, nhưng là giá trị KHÁC: chúng
 * là những bảng có **ghi chú nghiệp vụ** — mô tả bảng dùng để trả lời loại câu
 * hỏi gì, và nghĩa của từng trường. Bảng ngoài danh sách này đọc được nhưng
 * agent phải tự suy cấu trúc từ dữ liệu.
 */
export const AGENT_TABLE_REGISTRY: Record<string, AgentTableSpec> = {
  orders: ordersRegistry,
  orderLogs: orderLogsRegistry,
  customers: customersRegistry,
  productConfigs: productConfigsRegistry,
  productCategories: productCategoriesRegistry,
  collections: collectionsRegistry,
  promotions: promotionsRegistry,
  factories: factoriesRegistry,
  machineTypes: machineTypesRegistry,
  workshopConfigs: workshopConfigsRegistry,
  customer_notifications: customerNotificationsRegistry,
  inventory_items: inventoryItemsRegistry,
  inventory_transactions: inventoryTransactionsRegistry,
  inventory_receipts: inventoryReceiptsRegistry,
};

/** Bảng CÓ MÔ TẢ. Không phải "bảng đọc được" — sau `API-19` mọi bảng đều đọc được. */
export const AGENT_DOCUMENTED_TABLE_KEYS = Object.keys(AGENT_TABLE_REGISTRY);

/**
 * CHỐT CHẶN DUY NHẤT còn lại của bộ API (`API-19`).
 *
 * Người dùng chốt mở hết, trừ những tên này. Chúng không phải dữ liệu nghiệp vụ:
 *  - `password` / `passwordSource` — bí mật xác thực. Hash mật khẩu lọt ra là
 *    cho phép dò ngược ngoại tuyến toàn bộ tài khoản khách, và `passwordSource`
 *    chỉ điểm tài khoản nào đang dùng mật khẩu mặc định.
 *  - `ip` / `userAgent` — dấu vết phiên làm việc của nhân viên.
 *  - `apiKeys` / `secret` (ORD-4) — bí mật xác thực của Public Order API:
 *    `customers.apiKeys[].hash` là sha256 của API key khách (cùng loại rủi ro
 *    với hash mật khẩu), `customer_webhooks.secret` là khoá ký HMAC — ai có nó
 *    thì giả mạo được webhook gửi cho khách. Phải nằm ở ĐÂY chứ không chỉ ở
 *    `deliberatelyExcluded` của registry: sau `API-19` mọi collection đều đọc
 *    được kể cả collection không ai mô tả, và registry chỉ là từ điển mô tả
 *    chứ không chặn ở tầng truy vấn.
 *
 * Khác mọi lần trước, danh sách này KHÔNG còn là "lưới an toàn thứ hai" đứng
 * sau một danh sách trắng: nó là **cơ chế chặn duy nhất**, nên nó chạy ở tầng
 * truy vấn chứ không chỉ ở unit test. So khớp bằng **tên lá ở mọi độ sâu**, nên
 * `password` phủ cả `a.b.password`, ở mọi collection kể cả collection không ai
 * mô tả.
 */
export const AGENT_DENY_FIELD_NAMES = ['password', 'passwordSource', 'ip', 'userAgent', 'apiKeys', 'secret'];

const DENIED = new Set(AGENT_DENY_FIELD_NAMES);

/**
 * Một đường dẫn có chạm tên bị chặn không — xét TỪNG đoạn, không chỉ đoạn cuối:
 * `password.hash` phải chặn y như `password`, nếu không thì xin trường con là
 * lấy được đúng thứ vừa cấm.
 */
export const isDeniedFieldPath = (path: string): boolean =>
  path.split('.').some((segment) => DENIED.has(segment));

/**
 * Object THƯỜNG — không phải instance của một lớp nào.
 *
 * Phân biệt này là bắt buộc, không phải cẩn thận thừa: hàm quét bên dưới **dựng
 * lại** object, nên đi vào một `ObjectId`/`Buffer`/`Decimal128` sẽ biến nó thành
 * một object thường mất hết dữ liệu. Repo dùng `_id` chuỗi nên `orders` không
 * sao, nhưng `API-19` mở cả những collection không ai khai — ở đó `ObjectId` là
 * chuyện bình thường.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Xoá mọi khoá bị chặn ở MỌI độ sâu — lưới cuối cho bảng không ai mô tả. */
export const stripDeniedDeep = <T>(value: T, depth = 0): T => {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((item) => stripDeniedDeep(item, depth + 1)) as unknown as T;
  // `Date`, `ObjectId`, `Buffer`… rơi vào đây và ra nguyên vẹn.
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (DENIED.has(key)) continue;
    out[key] = stripDeniedDeep(child, depth + 1);
  }
  return out as unknown as T;
};

export * from './field-policy';
