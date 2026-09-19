import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ResZod } from '@shared/types';
import { z } from 'zod';

/**
 * VNP eGlobal Shipment API — DTO cho luồng tạo vận đơn/label từ đơn sản xuất.
 *
 * Nguồn spec: `Data/Tai_lieu_API_VNP_eGlobal_dev.pdf` + OpenAPI sống
 * `https://vnp-eglobal.itel.dev/api/v3/api-docs`. Spec bên đó KHÔNG khai báo
 * response body (toàn `object` trống) nên mọi Res DTO ở đây giữ field `raw`
 * (JSON nguyên văn từ VNP) để phục vụ giai đoạn test/khảo sát — đặc biệt để
 * tìm xem label nằm ở đâu trong response.
 */

/** Enum service đúng theo `ShipmentRequest.service` trong OpenAPI VNP. */
export const VNP_SHIPPING_SERVICES = [
  'Standard',
  'Express',
  'Uniuni',
  'Letter',
  'FirstFlat',
  'FirstClass',
  'UpsGround',
] as const;
export const VnpShippingServiceZod = z.enum(VNP_SHIPPING_SERVICES);
export type VnpShippingService = z.infer<typeof VnpShippingServiceZod>;

/** Enum shipping_type đúng theo `ShipmentRequest.shipping_type`. */
export const VNP_SHIPPING_TYPES = ['GDE', 'DOMESTIC'] as const;
export const VnpShippingTypeZod = z.enum(VNP_SHIPPING_TYPES);
export type VnpShippingType = z.infer<typeof VnpShippingTypeZod>;

/**
 * Subdoc lưu trên OrderEntity sau khi tạo vận đơn — chỉ giữ phần cốt lõi để
 * hiển thị/tra cứu; raw response KHÔNG lưu vào đơn (trả 1 lần qua API test).
 */
export const VnpShipmentInfoZod = z.object({
  /** ID shipment VNP trả về sau createShipment. */
  shipmentId: z.string().optional(),
  /** Mã tracking (nếu VNP trả riêng; nhiều hệ dùng luôn shipmentId). */
  trackingCode: z.string().optional(),
  /** URL file label (PDF/PNG) nếu response có — mục tiêu chính của đợt test. */
  labelUrl: z.string().optional(),
  service: VnpShippingServiceZod.optional(),
  shippingType: VnpShippingTypeZod.optional(),
  /** ID địa chỉ ShippingTo đã tạo bên VNP cho đơn này. */
  toAddressId: z.string().optional(),
  /** Kết quả checkAddress gần nhất. */
  addressValid: z.boolean().optional(),
  addressCheckedAt: z.date().optional(),
  createdAt: z.date().optional(),
  cancelledAt: z.date().optional(),
  /** Trạng thái tracking gần nhất (text VNP trả về). */
  lastTrackingStatus: z.string().optional(),
  lastTrackingAt: z.date().optional(),
  /**
   * Lần ĐẦU hãng báo hiệu label đã vào mạng lưới (ShippingLabelPatterns.md §3)
   * — chốt an toàn của luồng hủy: đã quét thì KHÔNG hủy. Set 1 lần, không clear.
   */
  scannedAt: z.date().optional(),
});
export type VnpShipmentInfo = z.infer<typeof VnpShipmentInfoZod>;

// ─── Cấu hình địa chỉ gửi (ShippingFrom) theo xưởng ─────────────────────────
//
// Lưu blob `system_configs` key VNP_SHIPPING_CONFIG_KEY — cấu hình SỐNG THEO
// MÔI TRƯỜNG (local/production tự tạo địa chỉ + gán xưởng qua UI Settings,
// KHÔNG restore data từ local lên production). Đơn từ xưởng nào ship từ địa
// chỉ gán cho xưởng đó; nhiều xưởng dùng chung 1 địa chỉ được (2D Thái Nguyên
// + Gỗ Thái Nguyên → cùng địa chỉ Thái Nguyên). Không gán → defaultAddressId
// → env VNP_EGLOBAL_FROM_ADDRESS_ID (fallback cuối, tùy chọn).

export const VNP_SHIPPING_CONFIG_KEY = 'vnp_shipping_config';

/** 1 địa chỉ gửi đã tạo bên VNP — snapshot để hiển thị, id là của VNP. */
export const VnpFromAddressZod = z.object({
  /** ID địa chỉ bên VNP (response createAddress). */
  vnpAddressId: z.string(),
  /** Nhãn gợi nhớ nội bộ, vd "Kho Thái Nguyên". */
  label: z.string(),
  name: z.string(),
  phoneNumber: z.string(),
  street1: z.string(),
  street2: z.string().optional(),
  ward: z.string(),
  district: z.string(),
  city: z.string(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string(),
  createdAt: z.union([z.date(), z.string()]).optional(),
});
export type VnpFromAddress = z.infer<typeof VnpFromAddressZod>;

export const VnpShippingConfigZod = z.object({
  addresses: z.array(VnpFromAddressZod).default([]),
  /** factoryId → vnpAddressId. */
  factoryMap: z.record(z.string()).default({}),
  /** Địa chỉ gửi mặc định cho xưởng chưa gán / đơn chưa map xưởng. */
  defaultAddressId: z.string().optional(),
});
export type VnpShippingConfig = z.infer<typeof VnpShippingConfigZod>;

export class GetVnpShippingConfigResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpShippingConfigZod })),
) {}

/** Tạo địa chỉ gửi mới: BE gọi VNP createAddress(ShippingFrom) rồi lưu blob. */
export const CreateVnpFromAddressZod = z.object({
  label: z.string().min(1),
  name: z.string().min(1),
  phoneNumber: z.string().min(1),
  street1: z.string().min(1),
  street2: z.string().optional(),
  ward: z.string().min(1),
  district: z.string().min(1),
  city: z.string().min(1),
  /** Bang (US) — bắt buộc với địa chỉ Mỹ, vd "CA". */
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().default('VN'),
});
export class CreateVnpFromAddressDto extends createZodDto(extendApi(CreateVnpFromAddressZod)) {}
export class CreateVnpFromAddressResDto extends createZodDto(
  extendApi(ResZod.extend({ data: z.object({ config: VnpShippingConfigZod, raw: z.unknown() }) })),
) {}

/**
 * Thêm địa chỉ ĐÃ TỒN TẠI bên VNP vào config bằng id (không tạo mới) — dùng
 * khi shipping unit yêu cầu from = hub US có sẵn của VNP (Carson/Jamaica/...).
 */
export const ImportVnpFromAddressZod = z.object({
  vnpAddressId: z.string().min(1),
  label: z.string().min(1),
  /** Mô tả hiển thị (địa chỉ hub) — chỉ để nhìn, không gửi VNP. */
  note: z.string().optional(),
});
export class ImportVnpFromAddressDto extends createZodDto(extendApi(ImportVnpFromAddressZod)) {}

export class GetVnpRemoteAddressesResDto extends createZodDto(
  extendApi(ResZod.extend({ data: z.object({ raw: z.unknown() }) })),
) {}

/** Lưu mapping xưởng → địa chỉ + địa chỉ mặc định (không đụng addresses). */
export const SaveVnpShippingMapZod = z.object({
  factoryMap: z.record(z.string()),
  defaultAddressId: z.string().optional(),
});
export class SaveVnpShippingMapDto extends createZodDto(extendApi(SaveVnpShippingMapZod)) {}
export class SaveVnpShippingMapResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpShippingConfigZod })),
) {}

export class DeleteVnpFromAddressResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpShippingConfigZod })),
) {}

// ─── Trạng thái cấu hình (FE hiện cảnh báo khi thiếu env) ────────────────────

export const VnpShippingStatusZod = z.object({
  configured: z.boolean(),
  /** Thiếu env nào (tên biến) — không bao giờ trả giá trị secret. */
  missing: z.array(z.string()),
  apiUrl: z.string().optional(),
  shippingUnitId: z.string().optional(),
});
export type VnpShippingStatus = z.infer<typeof VnpShippingStatusZod>;
export class GetVnpShippingStatusResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpShippingStatusZod })),
) {}

// ─── Ví (wallet) — VNP đòi số dư tối thiểu $50 mới cho tạo vận đơn ──────────

export class GetVnpWalletResDto extends createZodDto(
  extendApi(ResZod.extend({ data: z.object({ balance: z.string().optional(), raw: z.unknown() }) })),
) {}

// ─── Check address ───────────────────────────────────────────────────────────

export const VnpCheckAddressResZod = z.object({
  valid: z.boolean(),
  /** Thông điệp/lý do từ VNP (nếu có). */
  message: z.string().optional(),
  raw: z.unknown(),
});
export class CheckVnpAddressResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpCheckAddressResZod })),
) {}

// ─── Create shipment ─────────────────────────────────────────────────────────

export const CreateVnpShipmentZod = z.object({
  service: VnpShippingServiceZod.default('Standard'),
  shippingType: VnpShippingTypeZod.default('GDE'),
  /**
   * Khoá idempotency do BÊN GỌI cấp (ShippingLabelPatterns.md §2) — unique
   * index bên BE: gọi lại cùng khoá trả về đúng nhãn của lượt trước, không
   * tạo nhãn thứ hai, không ném lỗi. FE sinh uuid mỗi intent mua; job auto
   * (khi hook Đóng hàng) BẮT BUỘC gửi để retry an toàn.
   */
  requestId: z.string().min(8).max(100).optional(),
  /**
   * Cân nặng fallback mỗi item (gram) — chỉ áp cho item trong nhóm THIẾU
   * `order.weight`. Vận đơn gộp theo `orderId` (1 đơn seller = 1 label),
   * mỗi item của nhóm thành 1 entry `package_details` với weight riêng.
   */
  weightGram: z.number().positive(),
  lengthCm: z.number().positive().optional(),
  wideCm: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  /** package_type — chỉ cần cho service FirstClass (UspsCard/UspsLetter/UspsFlat). */
  packageType: z.string().optional(),
  /** Số kiện — mặc định 1. */
  packages: z.number().int().positive().default(1),
});
export class CreateVnpShipmentDto extends createZodDto(extendApi(CreateVnpShipmentZod)) {}

/** 1 item trong nhóm cùng `orderId` — hiện ở dialog trước khi tạo label chung. */
export const VnpShipmentGroupItemZod = z.object({
  id: z.string(),
  productionId: z.string(),
  type: z.string().optional(),
  quantity: z.number().optional(),
  weight: z.number().optional(),
  /** Item đã có vận đơn active (chưa hủy) — cả nhóm bị chặn tạo thêm. */
  hasActiveShipment: z.boolean(),
});
export const VnpShipmentGroupZod = z.object({
  /** orderId seller — rỗng nếu đơn không có orderId (nhóm = 1 mình nó). */
  orderId: z.string().optional(),
  items: z.array(VnpShipmentGroupItemZod),
});
export class GetVnpShipmentGroupResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpShipmentGroupZod })),
) {}

export const CreateVnpShipmentResZod = z.object({
  shipment: VnpShipmentInfoZod,
  /** productionId của TẤT CẢ item cùng orderId đã gắn chung vận đơn này. */
  groupProductionIds: z.array(z.string()),
  /** Response nguyên văn của createShipment — soi label URL ở giai đoạn test. */
  raw: z.unknown(),
  /** Response nguyên văn của createAddress (ShippingTo). */
  rawAddress: z.unknown().optional(),
});
export class CreateVnpShipmentResDto extends createZodDto(
  extendApi(ResZod.extend({ data: CreateVnpShipmentResZod })),
) {}

// ─── Packages + Shipments (bảng riêng — lịch sử vận đơn) ─────────────────────
//
// Model: 1 đơn sản xuất (OrderEntity) = 1 item của khách; 1 đơn khách
// (`orderId` seller) nhiều item; label luôn dán lên 1 KIỆN vật lý = 1 pack →
// shipment TRỎ VÀO PACK (không trỏ đơn khách — để sau này gộp nhiều đơn cùng
// địa chỉ vào 1 pack / thùng master đi hub qua `parentPackageId` không phải
// đổi schema). Hiện tại pack tự sinh ngầm lúc Admin mua label, 1 pack = 1 đơn
// khách. Mỗi lần mua label = 1 record shipment MỚI (không ghi đè) — hủy set
// `cancelledAt`, mua lại tạo record mới → lịch sử tự có. `order.vnpShipment`
// trên orders chỉ còn là SNAPSHOT mỏng để render list không phải join.

/**
 * `provider` của record `shipments`:
 * - `vnp-eglobal` — label HỆ THỐNG mua qua VNP eGlobal (module này).
 * - `customer` — label KHÁCH TỰ CẤP đi kèm lúc lên đơn (CSV khách / CSV admin
 *   / Public Order API), hệ thống chỉ nhận + in dán, không mua, không hủy được.
 */
export const SHIPMENT_PROVIDER_VNP = 'vnp-eglobal';
export const SHIPMENT_PROVIDER_CUSTOMER = 'customer';

/**
 * `purchasing` = bản ghi GIỮ CHỖ, tạo TRƯỚC khi gọi VNP mua label
 * (ShippingLabelPatterns.md §1): tiến trình chết giữa chừng thì record kẹt
 * `purchasing` là bằng chứng có thể tồn tại label mồ côi — cron đối soát chốt
 * nốt thành `created` hoặc đánh `failed`, KHÔNG BAO GIỜ xóa record kẹt.
 * `failed` = xác nhận lượt mua KHÔNG tạo được label (không mất tiền).
 * `cancelling` = đã gọi lệnh hủy nhưng hãng CHƯA xác nhận label chết
 * (ShippingLabelPatterns.md §4 — trạng thái "chưa biết": không hoàn tiền,
 * không coi kiện là xong; để dành cho luồng hủy fail-closed, chưa dùng).
 * `in_transit`/`delivered` do cron poll tracking suy từ text trạng thái
 * (classify conservative — shape response khi hàng chạy thật CHƯA biết, label
 * test chưa từng được scan; chỉ nhận diện chuỗi chắc chắn như "delivered").
 * Trạng thái HÃNG chi tiết nằm ở field riêng (`lastTrackingStatus` = text thô
 * ≡ carrierStatus của khuôn §3, `lastTrackingAt` ≡ carrierSyncedAt,
 * `scannedAt`, `carrierNote`) — 2 giá trị `in_transit`/`delivered` trong
 * status chỉ là phase tổng hợp cho FE/stats, chốt an toàn KHÔNG đọc từ đây.
 */
export const VNP_SHIPMENT_RECORD_STATUSES = [
  'purchasing',
  'created',
  'in_transit',
  'delivered',
  'cancelling',
  'cancelled',
  'failed',
] as const;
export const VnpShipmentRecordStatusZod = z.enum(VNP_SHIPMENT_RECORD_STATUSES);
export type VnpShipmentRecordStatus = z.infer<typeof VnpShipmentRecordStatusZod>;

/**
 * Status được tính vào dashboard chi phí + coi là "label thật đang tồn tại":
 * loại `purchasing` (chưa chắc mua xong), `failed` (không mua được, không mất
 * tiền), `cancelled` (đếm riêng, không cộng cost).
 */
export const VNP_SHIPMENT_COUNTED_STATUSES = ['created', 'in_transit', 'delivered'] as const;

/** 1 sự kiện tracking (ghi khi status text ĐỔI so với lần poll trước). */
export const VnpTrackingEventZod = z.object({
  status: z.string().optional(),
  at: z.union([z.date(), z.string()]),
});
export type VnpTrackingEvent = z.infer<typeof VnpTrackingEventZod>;

/** 1 kiện hàng vật lý (collection `shipping_packages`). */
export const VnpShippingPackageZod = z.object({
  _id: z.string(),
  /** Mã kiện hiển thị, dạng `PK-XXXXXXXXXX`. */
  code: z.string(),
  factoryId: z.string().optional(),
  /** orderId seller trong kiện — hiện luôn 1 phần tử (hoặc rỗng nếu đơn không có orderId). */
  orderCodes: z.array(z.string()),
  /** OrderEntity._id các item trong kiện. */
  productionOrderIds: z.array(z.string()),
  /** productionId hiển thị của các item. */
  productionIds: z.array(z.string()),
  /** Kiện cha (thùng master gom nhiều kiện đi hub) — để dành, CHƯA dùng. */
  parentPackageId: z.string().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
});
export type VnpShippingPackage = z.infer<typeof VnpShippingPackageZod>;

/** 1 lần mua label (collection `shipments`) — immutable trừ trạng thái/tracking. */
export const VnpShipmentRecordZod = z.object({
  _id: z.string(),
  packageId: z.string(),
  /** Nhà cung cấp label — 'vnp-eglobal'; sau này thêm khi tự đi ship. */
  provider: z.string(),
  /** ID shipment bên VNP (uuid). */
  vnpShipmentId: z.string().optional(),
  trackingCode: z.string().optional(),
  labelUrl: z.string().optional(),
  /** Hãng vận chuyển khách khai — chỉ record provider `customer`. */
  carrier: z.string().optional(),
  /** Link tra cứu khách gửi kèm — chỉ record provider `customer`. */
  trackingUrl: z.string().optional(),
  service: z.string().optional(),
  shippingType: z.string().optional(),
  fromAddressId: z.string().optional(),
  toAddressId: z.string().optional(),
  /** shipping_cost VNP trả lúc tạo (string nguyên văn). */
  shippingCost: z.string().optional(),
  /** Số dư ví NGAY SAU khi mua label này — đối soát chi phí với biến động ví. */
  balanceAfter: z.string().optional(),
  status: VnpShipmentRecordStatusZod,
  /** Lý do khi `status='failed'` — cron đối soát/nhánh lỗi ghi để ops đọc. */
  failReason: z.string().optional(),
  /** Mốc gọi lệnh hủy (vào `cancelling`) — cron dọn record kẹt lọc theo tuổi này. */
  cancelRequestedAt: z.union([z.date(), z.string()]).optional(),
  cancelledAt: z.union([z.date(), z.string()]).optional(),
  /** Text trạng thái THÔ của hãng (≡ carrierStatus khuôn §3). */
  lastTrackingStatus: z.string().optional(),
  /** Lần sync tracking gần nhất (≡ carrierSyncedAt khuôn §3 — chỉ mục cron). */
  lastTrackingAt: z.union([z.date(), z.string()]).optional(),
  /** Lần ĐẦU hãng báo label đã vào mạng lưới — chốt an toàn luồng hủy (§3/§4). */
  scannedAt: z.union([z.date(), z.string()]).optional(),
  /** Ghi chú/lý do từ hãng (vd nghi địa chỉ sai) — ops đọc để cứu đơn. */
  carrierNote: z.string().optional(),
  /** Timeline sự kiện tracking (cron poll + bấm tay). */
  trackingEvents: z.array(VnpTrackingEventZod).optional(),
  createdByUserId: z.string().optional(),
  createdByUserName: z.string().optional(),
  /** Label do SELLER tự mua qua portal — giá bảng seller đã trừ ví (USD, snapshot). Margin = sellerPrice − shippingCost. */
  sellerPrice: z.number().optional(),
  sellerCustomerId: z.string().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  /** Kiện chứa (join khi list/history). */
  package: VnpShippingPackageZod.optional(),
});
export type VnpShipmentRecord = z.infer<typeof VnpShipmentRecordZod>;

/** Danh sách vận đơn (lịch sử toàn hệ thống, Admin check). */
export const GetVnpShipmentsZod = z.object({
  page: z.coerce.number().int().positive().default(1),
  size: z.coerce.number().int().positive().max(100).default(20),
  /** Khớp trackingCode / vnpShipmentId / mã kiện / productionId / orderId seller. */
  search: z.string().optional(),
  status: VnpShipmentRecordStatusZod.optional(),
});
export class GetVnpShipmentsDto extends createZodDto(extendApi(GetVnpShipmentsZod)) {}
export class GetVnpShipmentsResDto extends createZodDto(
  extendApi(ResZod.extend({ data: z.array(VnpShipmentRecordZod), total: z.number() })),
) {}

/** Lịch sử vận đơn của 1 đơn sản xuất (mọi record của các kiện chứa nó). */
export class GetVnpOrderShipmentsResDto extends createZodDto(
  extendApi(ResZod.extend({ data: z.array(VnpShipmentRecordZod) })),
) {}

/**
 * Dashboard chi phí label (trang /adm/shipments). Cost = tổng `shippingCost`
 * các record CHƯA HỦY (chưa rõ policy hoàn tiền của VNP khi hủy — record hủy
 * đếm riêng, không cộng vào cost). from/to = YYYY-MM-DD giờ VN trên createdAt.
 */
export const GetVnpShipmentStatsZod = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
export class GetVnpShipmentStatsDto extends createZodDto(extendApi(GetVnpShipmentStatsZod)) {}

const StatsBucketZod = z.object({ key: z.string(), count: z.number(), cost: z.number() });
export const VnpShipmentStatsZod = z.object({
  totals: z.object({
    count: z.number(),
    cost: z.number(),
    active: z.number(),
    delivered: z.number(),
    cancelled: z.number(),
    /** Tiền VÀO — Σ `sellerPrice` các label seller tự mua (chưa hủy). */
    sellerRevenue: z.number(),
    /** Chi VNP của RIÊNG các label seller mua — margin seller = sellerRevenue − sellerCost. */
    sellerCost: z.number(),
    sellerLabelCount: z.number(),
  }),
  /** key = YYYY-MM (giờ VN), mới nhất trước. */
  byMonth: z.array(StatsBucketZod),
  /** key = factoryId, kèm tên xưởng resolve sẵn. */
  byFactory: z.array(StatsBucketZod.extend({ factoryName: z.string().optional() })),
  /** key = service (Standard/Express/...). */
  byService: z.array(StatsBucketZod),
});
export type VnpShipmentStats = z.infer<typeof VnpShipmentStatsZod>;
export class GetVnpShipmentStatsResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpShipmentStatsZod })),
) {}

/**
 * Kết quả 1 lần chạy cron poll tracking (2 lần/ngày, xem VnpShipping.md §2a).
 * `reconcile` = kết quả dọn record kẹt `purchasing` chạy đầu lượt cron
 * (ShippingLabelPatterns.md §1 bước ⑤): finalized = chốt nốt thành created
 * (label có thật bên VNP), failed = xác nhận không có label, unknown = không
 * hỏi được VNP (để nguyên, lượt sau thử lại).
 */
export const VnpTrackingCronResZod = z.object({
  checked: z.number(),
  updated: z.number(),
  delivered: z.number(),
  failed: z.number(),
  skipped: z.boolean().optional(),
  reconcile: z
    .object({ scanned: z.number(), finalized: z.number(), failed: z.number(), unknown: z.number() })
    .optional(),
  /**
   * Kết quả dọn record kẹt `cancelling` (§4): cancelled = hãng xác nhận label
   * chết → chốt sổ; revived = label hóa ra ĐANG ĐI (hủy bất thành) → trả về
   * in_transit + scannedAt; unknown = chưa kết luận được, giữ nguyên chờ ops.
   */
  reconcileCancelling: z
    .object({ scanned: z.number(), cancelled: z.number(), revived: z.number(), unknown: z.number() })
    .optional(),
});
export class RunVnpTrackingCronResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpTrackingCronResZod })),
) {}

// ─── Tracking / get shipment / cancel ────────────────────────────────────────

export const VnpTrackingResZod = z.object({
  shipment: VnpShipmentInfoZod.optional(),
  raw: z.unknown(),
});
export class GetVnpTrackingResDto extends createZodDto(
  extendApi(ResZod.extend({ data: VnpTrackingResZod })),
) {}

export class GetVnpShipmentResDto extends createZodDto(
  extendApi(ResZod.extend({ data: z.object({ raw: z.unknown() }) })),
) {}

export class CancelVnpShipmentResDto extends createZodDto(
  extendApi(ResZod.extend({ data: z.object({ shipment: VnpShipmentInfoZod, raw: z.unknown() }) })),
) {}

// ─── Kiện hàng ở công đoạn Đóng hàng (GAP-25/26/27) ─────────────────────────

/**
 * Một kiện trong màn Bàn giao. Chốt nghiệp vụ 17/09/2026: **1 kiện = 1 đơn
 * seller**, sinh lúc công nhân hoàn thành công đoạn Đóng hàng.
 */
export const PackingPackageZod = z.object({
  _id: z.string(),
  code: z.string(),
  orderId: z.string().optional(),
  factoryId: z.string().optional(),
  productionIds: z.string().array().default([]),
  /** Cân thực tế do trạm nhập (gram) — thiếu nghĩa là kiện chưa được cân. */
  weightGram: z.number().optional(),
  dimensions: z.object({ width: z.number().optional(), height: z.number().optional(), length: z.number().optional() }).optional(),
  packedAt: z.coerce.date().optional(),
  packedByUserName: z.string().optional(),
  handoverAt: z.coerce.date().optional(),
  handoverCode: z.string().optional(),
  handoverCarrier: z.string().optional(),
});
export type PackingPackage = z.infer<typeof PackingPackageZod>;

export const GetPackingPackagesZod = z.object({
  factoryId: z.string().optional(),
  /** Mặc định `false` = kiện chưa bàn giao (việc cần làm hôm nay). */
  daBanGiao: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export class GetPackingPackagesDto extends createZodDto(extendApi(GetPackingPackagesZod)) {}

export const GetPackingPackagesResZod = ResZod.extend({ data: PackingPackageZod.array() });
export class GetPackingPackagesResDto extends createZodDto(extendApi(GetPackingPackagesResZod)) {}

export const HandoverPackagesZod = z.object({
  ids: z.string().array().min(1).max(500),
  /** Hãng nhận hàng — nhập tự do, chưa ràng buộc danh mục. */
  carrier: z.string().max(100).optional(),
});
export class HandoverPackagesDto extends createZodDto(extendApi(HandoverPackagesZod)) {}

export const HandoverPackagesResZod = ResZod.extend({
  data: z.object({
    /** Mã phiếu cấp cho CẢ lô: `BG-<xưởng>-<ngày VN>-<số>`. */
    handoverCode: z.string(),
    count: z.number(),
    /** Kiện bị bỏ qua vì đã bàn giao ở chuyến trước — không đóng dấu đè. */
    skipped: z.number(),
  }),
});
export class HandoverPackagesResDto extends createZodDto(extendApi(HandoverPackagesResZod)) {}
