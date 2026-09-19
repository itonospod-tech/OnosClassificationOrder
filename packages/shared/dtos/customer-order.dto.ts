import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { CustomerOrderStatus, PRODUCT_LINES } from '@shared/enums';
import { PageResZod, ResZod } from '@shared/types';
import { z } from 'zod';

import { IDZod } from '..';
import {
  CUSTOMER_SHIP_METHODS,
  type CustomerImportOrder,
  type CustomerImportOrderItem,
  CustomerImportOrderItemZod,
  CustomerImportOrderZod,
  type CustomerImportShippingAddress,
  CustomerImportShippingAddressZod,
  type CustomerShipMethod,
  CustomerShipMethodZod,
  DEFAULT_CUSTOMER_SHIP_METHOD,
  parseCustomerShipMethod,
} from '../client';
import type {
  ProductionOrderTracking} from './production-order.dto';
import {
  CustomerOrderSummaryZod,
  DesignFieldsZod,
  LifecycleTrackStageZod,
  LifecycleTrackZod,
  ProductionOrderShippingAddressZod,
  ProductionOrderTrackingZod,
  WORKSHOP_STAGE_FILTER_KEYS,
} from './production-order.dto';

/**
 * Staging đơn khách hàng `customer_orders` — 1 document = 1 ĐƠN nhiều item +
 * 1 địa chỉ ship chung (khớp mô hình template fulfill OnosPod cũ: nhiều dòng
 * cùng cặp `(order_id, identifier)` = 1 đơn). Đơn Pending KHÔNG BAO GIỜ là
 * `OrderEntity` — chỉ khi Push to production mỗi item mới nổ ra 1 đơn sản
 * xuất qua `importOrders()`. Xem `documents/Plans/CustomerOrderIntake-CSV-API.md`.
 */

/** Key system_configs: số ngày sau Fulfilled thì đơn khách coi là Completed. */
export const CUSTOMER_ORDER_COMPLETED_DAYS_KEY = 'customer_order_completed_days';
export const CUSTOMER_ORDER_COMPLETED_DAYS_DEFAULT = 14;
/** Key system_configs: công tắc payment gate (đợt này OFF — push tự do, ledger vẫn ghi `waived`). */
export const CUSTOMER_PAYMENT_GATE_KEY = 'customer_payment_gate_enabled';

// ---------------------------------------------------------------------------
// Ship method — giữ ĐỦ 4 giá trị hệ cũ (plan §13.2)
// ---------------------------------------------------------------------------

// Nest-free, dời sang `client/customer-import.ts`.
export { CUSTOMER_SHIP_METHODS, type CustomerShipMethod,CustomerShipMethodZod, DEFAULT_CUSTOMER_SHIP_METHOD, parseCustomerShipMethod };

/**
 * Idempotency mức ĐƠN (plan §13.4): chuẩn hóa cặp `(order_id, identifier)`
 * của template cũ thành 1 key duy nhất — unique theo `(customerId, orderKey)`.
 * Đơn tạo qua form portal không có order_id → caller tự sinh key riêng.
 */
export function customerOrderKey(orderId: string, identifier?: string): string {
  return `${(orderId || '').trim().toLowerCase()}|${(identifier || '').trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Payment ledger `customer_payments` — ghi NGAY TỪ PHASE 1 kể cả gate OFF
// (mỗi lần push 1 record `waived` + amount để đối soát doanh thu, plan §12.1).
// ---------------------------------------------------------------------------

export const CUSTOMER_PAYMENT_STATUSES = ['awaiting', 'paid', 'waived', 'cancelled'] as const;
export type CustomerPaymentStatus = (typeof CUSTOMER_PAYMENT_STATUSES)[number];
export const CUSTOMER_PAYMENT_METHODS = ['manual', 'waived', 'wallet'] as const;
export type CustomerPaymentMethod = (typeof CUSTOMER_PAYMENT_METHODS)[number];

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * Tracking/label KHÁCH TỰ CẤP (SBTT/hệ cũ) — ALIAS của `ProductionOrderTrackingZod`
 * (`production-order.dto.ts`), KHÔNG định nghĩa lại shape: cùng một vận đơn đi
 * từ staging → `OrderEntity.tracking` → record `shipments`, hai định nghĩa song
 * song là mầm lệch field. Từ ORD-26 tracking KHÔNG còn dừng ở mức lưu-hiển-thị:
 * push/import ghi tiếp vào module vận đơn (`shipping-vnp`, provider `customer`).
 */
export const CustomerOrderTrackingZod = ProductionOrderTrackingZod;
export type CustomerOrderTracking = ProductionOrderTracking;

/** Giá 1 item — tính tham khảo lúc tạo, CHỐT LẠI + đóng băng lúc push. */
export const CustomerOrderPriceSnapshotZod = z.object({
  shipMethod: CustomerShipMethodZod,
  /** Giá niêm yết theo variation + ship method (chưa giảm). */
  unitPrice: z.number().nonnegative(),
  /** Giá sau khi áp Promotion theo tier (nếu có). */
  discountedPrice: z.number().nonnegative().optional(),
  promotionName: z.string().optional(),
  /** (discountedPrice ?? unitPrice) × quantity. */
  lineTotal: z.number().nonnegative(),
});
export type CustomerOrderPriceSnapshot = z.infer<typeof CustomerOrderPriceSnapshotZod>;

/**
 * Item input — dùng cho sửa đơn pending + placeOrder (form). CSV dùng
 * `CustomerImportOrderItemZod` chặt hơn (SKU bắt buộc). Ít nhất 1 trong
 * `sku`/`type` phải có: form chọn theo `type` (tên sản phẩm), CSV theo `sku`.
 */
export const CustomerStagingItemInputZod = z
  .object({
    /**
     * Echo-back khi SỬA đơn pending — giữ nguyên mã đã cấp lúc tạo (BE chỉ
     * nhận mã ĐANG thuộc chính đơn đó, mã lạ bị bỏ qua và cấp mã mới).
     */
    productionId: z.string().max(30).optional(),
    sku: z.string().max(200).optional(),
    type: z.string().max(300).optional(),
    merchantSku: z.string().max(200).optional(),
    color: z.string().max(200).optional(),
    size: z.string().max(200).optional(),
    quantity: z.coerce.number().int().positive().default(1),
    shipMethod: CustomerShipMethodZod.default(DEFAULT_CUSTOMER_SHIP_METHOD),
    activeService: z.boolean().optional(),
    mockupUrl: z.string().max(2000).optional(),
    printMethod: z.string().max(200).optional(),
    weight: z.number().nonnegative().optional(),
    width: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional(),
    length: z.number().nonnegative().optional(),
    designs: DesignFieldsZod.optional(),
    tracking: CustomerOrderTrackingZod.optional(),
  })
  .refine((i) => !!i.sku?.trim() || !!i.type?.trim(), { message: 'Item phải có sku hoặc type' });
export type CustomerStagingItemInput = z.infer<typeof CustomerStagingItemInputZod>;

// ---------------------------------------------------------------------------
// Staging order — response shape (listing + chi tiết)
// ---------------------------------------------------------------------------

export const CUSTOMER_ORDER_SOURCES = ['form', 'csv', 'api', 'sync'] as const;
export type CustomerOrderSource = (typeof CUSTOMER_ORDER_SOURCES)[number];

export const CustomerStagingItemZod = z.object({
  sku: z.string().optional(),
  merchantSku: z.string().optional(),
  productConfigId: z.string().optional(),
  type: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  quantity: z.number(),
  shipMethod: CustomerShipMethodZod.optional(),
  activeService: z.boolean().optional(),
  mockupUrl: z.string().optional(),
  printMethod: z.string().optional(),
  /** Dòng sản phẩm — stamp từ ProductConfig lúc tạo/import; đơn cũ derive từ OrderEntity. */
  productLine: z.enum(PRODUCT_LINES).optional(),
  designs: DesignFieldsZod.optional(),
  tracking: CustomerOrderTrackingZod.optional(),
  priceSnapshot: CustomerOrderPriceSnapshotZod.optional(),
  /**
   * Cấp NGAY lúc tạo/import (format `XX-#####-#####`) — đi xuyên suốt từ
   * portal đến xưởng; sau push chính là `OrderEntity.productionId`.
   */
  productionId: z.string().optional(),
  // ---- derive at read-time từ OrderEntity (chỉ có sau push) ----
  status: z.nativeEnum(CustomerOrderStatus).optional(),
  /** Key chặng (`LIFECYCLE_STAGE_KEYS`) — FE dịch nhãn theo ngôn ngữ người xem (`track.progress.stages.*`). */
  currentStageKey: z.string().optional(),
  currentStageLabel: z.string().optional(),
  currentStageAt: z.coerce.date().optional(),
  held: z.boolean().optional(),
  holdReason: z.string().optional(),
  /** Badge "Đang sửa lỗi" — vẫn In Production, KHÔNG tụt về Processing (plan §1.1b). */
  rework: z.boolean().optional(),
  cancelledAt: z.coerce.date().optional(),
});
export type CustomerStagingItem = z.infer<typeof CustomerStagingItemZod>;

export const CustomerStagingOrderZod = z.object({
  _id: IDZod,
  orderKey: z.string(),
  orderId: z.string().optional(),
  identifier: z.string().optional(),
  orderName: z.string().optional(),
  source: z.enum(CUSTOMER_ORDER_SOURCES),
  /** Trạng thái mức ĐƠN = item CHẬM NHẤT (least-advanced) trong các item chưa hủy. */
  status: z.nativeEnum(CustomerOrderStatus),
  /** Badge mức đơn — true nếu ≥1 item đang held/rework. */
  held: z.boolean().optional(),
  rework: z.boolean().optional(),
  note: z.string().optional(),
  shippingAddress: ProductionOrderShippingAddressZod.optional(),
  items: CustomerStagingItemZod.array(),
  /** Các dòng sản phẩm có trong đơn (distinct từ items) — badge/lọc ở Seller Portal. */
  productLines: z.enum(PRODUCT_LINES).array().optional(),
  totalQuantity: z.number(),
  /** Tổng snapshot hiện có (tham khảo với pending — "giá chốt khi push"). */
  totalAmount: z.number().optional(),
  pushedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date().optional(),
  cancelledAt: z.coerce.date().optional(),
  cancelReason: z.string().optional(),
});
export type CustomerStagingOrder = z.infer<typeof CustomerStagingOrderZod>;

// ---------------------------------------------------------------------------
// List + counts
// ---------------------------------------------------------------------------

export const GetCustomerStagingOrdersZod = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Bỏ trống = tab All. */
  status: z.nativeEnum(CustomerOrderStatus).optional(),
  /** Filter chip "On Hold" (không phải tab). */
  held: z.coerce.boolean().optional(),
  /** Search theo orderId / orderName / productionId của item. */
  search: z.string().optional(),
  /** Tab dòng sản phẩm (Seller Portal) — đơn có ÍT NHẤT 1 item thuộc dòng. */
  productLine: z.enum(PRODUCT_LINES).optional(),
});
export class GetCustomerStagingOrdersDto extends createZodDto(extendApi(GetCustomerStagingOrdersZod)) {}

export const GetCustomerStagingOrdersResZod = PageResZod.extend({ data: CustomerStagingOrderZod.array() });
export class GetCustomerStagingOrdersResDto extends createZodDto(extendApi(GetCustomerStagingOrdersResZod)) {}

export const CustomerOrderCountsZod = z.object({
  all: z.number(),
  pending: z.number(),
  processing: z.number(),
  inProduction: z.number(),
  fulfilled: z.number(),
  completed: z.number(),
  refunded: z.number(),
  cancelled: z.number(),
  /** Badge counts (chồng lên các tab, không phải tab). */
  held: z.number(),
  rework: z.number(),
  /** Số đơn theo dòng sản phẩm (đơn có ≥1 item thuộc dòng; một đơn có thể đếm ở nhiều dòng). */
  byProductLine: z.record(z.enum(PRODUCT_LINES), z.number()).optional(),
});
export type CustomerOrderCounts = z.infer<typeof CustomerOrderCountsZod>;
/** `productLine` → mọi số đếm chỉ tính đơn có ≥1 item thuộc dòng (trang dịch vụ Seller Portal). */
export const GetCustomerOrderCountsZod = z.object({ productLine: z.enum(PRODUCT_LINES).optional() });
export class GetCustomerOrderCountsDto extends createZodDto(extendApi(GetCustomerOrderCountsZod)) {}

export const GetCustomerOrderCountsResZod = ResZod.extend({ data: CustomerOrderCountsZod });
export class GetCustomerOrderCountsResDto extends createZodDto(extendApi(GetCustomerOrderCountsResZod)) {}

// ---------------------------------------------------------------------------
// CSV import (template cũ — FE parse + group theo (order_id, identifier) rồi gửi lên)
// ---------------------------------------------------------------------------

/**
 * Địa chỉ import CSV — required theo đúng ghi chú template cũ: name, country,
 * address_1, city, state, postcode bắt buộc; telephone/email/company tùy chọn.
 */
// Nest-free, dời sang `client/customer-import.ts` — NGUỒN RULE DUY NHẤT cho FE (web + seller) và BE.
export {
  type CustomerImportOrder,
  type CustomerImportOrderItem,
  CustomerImportOrderItemZod,
  CustomerImportOrderZod,
  type CustomerImportShippingAddress,
  CustomerImportShippingAddressZod,
};

/** Cap tổng ~500 dòng/lần — validate thêm ở service (tổng items mọi đơn). */
export const ImportCustomerOrdersZod = z.object({
  orders: CustomerImportOrderZod.array().min(1).max(500),
});
export class ImportCustomerOrdersDto extends createZodDto(extendApi(ImportCustomerOrdersZod)) {}

/**
 * Đối chiếu SKU với catalog NGAY Ở PREVIEW import — trả thông tin sản phẩm hệ
 * thống (tên/ảnh/màu-size/giá tham khảo) để khách check trước khi submit; SKU
 * không tồn tại → FE chặn submit (cùng rule BE fail cả đơn lúc import).
 */
export const ResolveImportSkusZod = z.object({
  items: z
    .object({
      sku: z.string().min(1).max(200),
      shipMethod: CustomerShipMethodZod.default(DEFAULT_CUSTOMER_SHIP_METHOD),
      quantity: z.coerce.number().int().positive().default(1),
    })
    .array()
    .min(1)
    .max(500),
});
export class ResolveImportSkusDto extends createZodDto(extendApi(ResolveImportSkusZod)) {}

export const ResolvedImportSkuZod = z.object({
  sku: z.string(),
  /** SKU có match `variations[].sku` trong catalog không. */
  found: z.boolean(),
  productConfigId: IDZod.optional(),
  /** Tên sản phẩm hệ thống (ProductConfig.fullName). */
  type: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  /** Ảnh mockup sản phẩm (ProductConfig.mockup — cùng nguồn catalog). */
  imageUrl: z.string().optional(),
  /** Giá tham khảo theo ship method + Promotion tier — cùng công thức lúc import/push. */
  priceSnapshot: CustomerOrderPriceSnapshotZod.optional(),
  error: z.string().optional(),
  /**
   * Các vị trí in mà 1 design là ĐỦ (luật "1 trong front/back" — mirror
   * `designAcceptKeys` BE). FE cảnh báo vàng ở preview import khi dòng chưa
   * có design nào thuộc danh sách này; rỗng/undefined = không đòi design.
   */
  designAcceptKeys: z.string().array().optional(),
});
export type ResolvedImportSku = z.infer<typeof ResolvedImportSkuZod>;
export const ResolveImportSkusResZod = ResZod.extend({ data: ResolvedImportSkuZod.array() });
export class ResolveImportSkusResDto extends createZodDto(extendApi(ResolveImportSkusResZod)) {}

export const CustomerImportResultRowZod = z.object({
  orderId: z.string(),
  identifier: z.string().optional(),
  orderKey: z.string(),
  status: z.enum(['created', 'duplicated', 'failed']),
  error: z.string().optional(),
  /** Lỗi theo từng item (index trong items[] của đơn đó). */
  itemErrors: z.object({ index: z.number(), error: z.string() }).array().optional(),
});
export type CustomerImportResultRow = z.infer<typeof CustomerImportResultRowZod>;

export const ImportCustomerOrdersResZod = ResZod.extend({
  data: z.object({
    created: z.number(),
    duplicated: z.number(),
    failed: z.number(),
    results: CustomerImportResultRowZod.array(),
  }),
});
export class ImportCustomerOrdersResDto extends createZodDto(extendApi(ImportCustomerOrdersResZod)) {}

// ---------------------------------------------------------------------------
// Sửa / hủy đơn pending
// ---------------------------------------------------------------------------

/**
 * Sửa đơn PENDING — tự do (chưa chốt gì): thông tin đơn, địa chỉ, thay cả
 * `items[]`. Địa chỉ ở đây nhận schema lỏng — validate đủ field lúc push.
 * Đơn ĐÃ PUSH sửa qua `PATCH /customer/orders/:productionId` sẵn có
 * (chỉ mockup/designs/address, chặn theo chặng).
 */
export const UpdateCustomerStagingOrderZod = z
  .object({
    orderName: z.string().max(300).optional(),
    note: z.string().max(1000).optional(),
    shippingAddress: ProductionOrderShippingAddressZod.optional(),
    items: CustomerStagingItemInputZod.array().min(1).max(100).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Cần ít nhất 1 field để sửa' });
export class UpdateCustomerStagingOrderDto extends createZodDto(extendApi(UpdateCustomerStagingOrderZod)) {}

export const CancelCustomerStagingOrderZod = z.object({ reason: z.string().max(500).optional() });
export class CancelCustomerStagingOrderDto extends createZodDto(extendApi(CancelCustomerStagingOrderZod)) {}

export const CustomerStagingOrderResZod = ResZod.extend({ data: CustomerStagingOrderZod });
export class CustomerStagingOrderResDto extends createZodDto(extendApi(CustomerStagingOrderResZod)) {}

// ---------------------------------------------------------------------------
// Push to production (chốt giá + payment gate)
// ---------------------------------------------------------------------------

export const PushCustomerOrdersZod = z.object({
  /** _id các staging order PENDING — push NGUYÊN ĐƠN, không lẻ item. */
  ids: IDZod.array().min(1).max(50),
});
export class PushCustomerOrdersDto extends createZodDto(extendApi(PushCustomerOrdersZod)) {}

/** Bảng giá chốt hiển thị trong dialog xác nhận push — tính server, KHÔNG commit. */
export const CustomerPushQuoteItemZod = z.object({
  sku: z.string().optional(),
  type: z.string().optional(),
  size: z.string().optional(),
  quantity: z.number(),
  priceSnapshot: CustomerOrderPriceSnapshotZod.optional(),
  error: z.string().optional(),
});
export const CustomerPushQuoteOrderZod = z.object({
  stagingId: IDZod,
  orderId: z.string().optional(),
  orderName: z.string().optional(),
  items: CustomerPushQuoteItemZod.array(),
  orderTotal: z.number(),
  /** Đơn không đủ điều kiện push (SKU biến mất, thiếu địa chỉ...) — lý do chung. */
  error: z.string().optional(),
});
export type CustomerPushQuoteOrder = z.infer<typeof CustomerPushQuoteOrderZod>;

export const PreviewPushCustomerOrdersResZod = ResZod.extend({
  data: z.object({
    orders: CustomerPushQuoteOrderZod.array(),
    totalAmount: z.number(),
    paymentGateEnabled: z.boolean(),
  }),
});
export class PreviewPushCustomerOrdersResDto extends createZodDto(extendApi(PreviewPushCustomerOrdersResZod)) {}

export const PushCustomerOrdersResZod = ResZod.extend({
  data: z.object({
    results: z
      .object({
        stagingId: IDZod,
        orderId: z.string().optional(),
        status: z.enum(['pushed', 'failed']),
        error: z.string().optional(),
        productionIds: z.string().array().optional(),
      })
      .array(),
    totalAmount: z.number(),
  }),
});
export class PushCustomerOrdersResDto extends createZodDto(extendApi(PushCustomerOrdersResZod)) {}

// ---------------------------------------------------------------------------
// Public Order API (ORD-4) — xác thực bằng API key (`X-Api-Key`), KHÔNG JWT.
// Đơn tạo qua API đi ĐÚNG luồng staging: Pending → push → importOrders().
// ---------------------------------------------------------------------------

/** Cap tạo đơn theo lô qua Public API (plan §8): ≤100 đơn/lần gọi. */
export const OPEN_API_MAX_ORDERS_PER_CALL = 100;

/**
 * 1 đơn tạo qua Public API — `externalRef` là mã tham chiếu của KHÁCH
 * (idempotency: gọi lại cùng mã → `duplicated`, không tạo trùng; map vào
 * `orderKey`/`orderId` staging). Items dùng CHUNG shape với CSV import —
 * SKU bắt buộc match `variations[].sku`.
 */
export const OpenApiCreateOrderZod = z.object({
  externalRef: z.string().min(1).max(200),
  orderName: z.string().max(300).optional(),
  note: z.string().max(1000).optional(),
  shippingAddress: CustomerImportShippingAddressZod,
  items: CustomerImportOrderItemZod.array().min(1).max(100),
});
export type OpenApiCreateOrder = z.infer<typeof OpenApiCreateOrderZod>;

export const OpenApiCreateOrdersZod = z.object({
  orders: OpenApiCreateOrderZod.array().min(1).max(OPEN_API_MAX_ORDERS_PER_CALL),
});
export class OpenApiCreateOrdersDto extends createZodDto(extendApi(OpenApiCreateOrdersZod)) {}
// Response tái dùng shape kết quả từng đơn của CSV import (`created|duplicated|failed`).

/** Push qua Public API — theo `externalRefs` (mã của khách) hoặc `ids` (staging id). Ít nhất 1 trong 2. */
export const OpenApiPushOrdersZod = z
  .object({
    externalRefs: z.string().min(1).max(200).array().max(OPEN_API_MAX_ORDERS_PER_CALL).optional(),
    ids: IDZod.array().max(OPEN_API_MAX_ORDERS_PER_CALL).optional(),
  })
  .refine((v) => (v.externalRefs?.length ?? 0) + (v.ids?.length ?? 0) > 0, {
    message: 'Cần ít nhất 1 externalRef hoặc id',
  });
export class OpenApiPushOrdersDto extends createZodDto(extendApi(OpenApiPushOrdersZod)) {}

/**
 * Tra 1 đơn theo `:ref` = externalRef HOẶC productionId của 1 item.
 * `order` = đúng shape listing portal (derive 8 trạng thái + badge held/rework);
 * `items[].timeline` có qua endpoint track riêng của portal — ở đây trả kèm
 * `track` cho productionId được hỏi (nếu `:ref` là productionId đã push).
 */
export const OpenApiGetOrderResZod = ResZod.extend({
  data: z.object({
    order: CustomerStagingOrderZod,
    /** Chỉ có khi `:ref` là productionId của 1 item đã push — mirror trang track portal. */
    track: z.object({ order: CustomerOrderSummaryZod, track: LifecycleTrackZod }).optional(),
  }),
});
export class OpenApiGetOrderResDto extends createZodDto(extendApi(OpenApiGetOrderResZod)) {}

// ---------------------------------------------------------------------------
// Tra cứu đơn CÔNG KHAI (`/track/:productionId`) — KHÔNG đăng nhập, KHÔNG API key
// ---------------------------------------------------------------------------

/**
 * Dữ liệu 1 đơn cho trang tra cứu công khai. Ai có mã đơn đều xem được, nên
 * shape này là **danh sách trắng tường minh**: chỉ những gì khách (và người
 * mua cuối của khách) vốn được biết.
 *
 * CỐ Ý KHÔNG có: giá/`priceSnapshot`, tên nhân viên (designer/công nhân),
 * nguyên văn `holdReason`/`cancelReason`/ghi chú lỗi nội bộ, xưởng sản xuất,
 * và địa chỉ ship đầy đủ (chỉ còn city/state/country).
 * Thêm field mới vào đây phải soi lại đúng 1 câu hỏi: *người lạ cầm mã đơn có
 * được phép biết thứ này không?*
 *
 * File thiết kế (`designs`) CÓ trong danh sách này theo yêu cầu vận hành: người
 * cầm mã đơn cần đối chiếu đúng file đang đi vào sản xuất. Đây là quyết định
 * đánh đổi có chủ đích — mã đơn trở thành thứ đủ để xem file thiết kế của đơn,
 * nên đừng phát tán mã đơn như một định danh vô hại.
 */
/**
 * 1 vị trí in của đơn trên trang tra cứu công khai — nhãn đã resolve sẵn
 * (`PRODUCT_PRINT_AREA_LABEL_MAP`) + link file thiết kế khách đã nộp.
 *
 * `url` là ĐƯỜNG DẪN THÔ như đang lưu trên đơn (Drive `open?id=…`, CDN
 * design…): trang tra cứu tự đổi sang link ảnh xem được bằng `driveThumbUrl`/
 * `driveViewUrl` — cùng bộ hàm mà các bảng nội bộ đang dùng, thay vì dựng thêm
 * một bản chuyển link thứ hai ở máy chủ rồi để hai bản trôi khỏi nhau.
 */
export const PublicOrderTrackDesignZod = z.object({
  /** Key vị trí in — trùng field trong `DesignFields` (`front`/`back`/…). */
  key: z.string(),
  label: z.string(),
  /** Trống = sản phẩm có vị trí in này nhưng đơn chưa có file. */
  url: z.string().optional(),
  widthPx: z.number().optional(),
  heightPx: z.number().optional(),
  /** `false` = vị trí tùy chọn; thiếu = coi như bắt buộc (giữ nghĩa dữ liệu cũ). */
  isRequired: z.boolean().optional(),
});
export type PublicOrderTrackDesign = z.infer<typeof PublicOrderTrackDesignZod>;

export const PublicOrderTrackZod = z.object({
  /** Mã sản xuất — định danh chính, chính là `:productionId` trên URL. */
  productionId: z.string(),
  /** Mã đơn của sàn/hệ cũ (`OrderEntity.externalId`, nhãn UI "Platform ID"). */
  externalId: z.string().optional(),
  /** Mã đơn do khách tự đặt (`orderId` staging / sheet import). */
  orderId: z.string().optional(),
  /** Mã phân biệt đơn con cùng `orderId` (template fulfill cũ). */
  identifier: z.string().optional(),
  orderName: z.string().optional(),

  status: z.nativeEnum(CustomerOrderStatus),
  /** Đơn đang bị giữ — lý do quy về nhóm an toàn, không phô ghi chú nội bộ. */
  onHold: z.boolean(),
  holdKind: z.enum(['waiting-design', 'waiting-address', 'other']).optional(),
  /** Đơn đang phải làm lại (badge chồng, không phải trạng thái). */
  rework: z.boolean(),
  /** Đơn đã đẩy vào sản xuất chưa — chưa đẩy thì `stages` rỗng. */
  pushed: z.boolean(),
  completed: z.boolean(),
  /** Key chặng hiện tại (`LIFECYCLE_STAGE_KEYS`) — FE dịch nhãn theo ngôn ngữ người xem. */
  currentStageKey: z.string().optional(),
  /** Nhãn chặng hiện tại theo ngôn ngữ khách (vd "Đang thiết kế") — đường lui khi FE chưa dịch key. */
  currentStageLabel: z.string().optional(),
  currentStageAt: z.coerce.date().optional(),

  product: z.object({
    type: z.string().optional(),
    color: z.string().optional(),
    size: z.string().optional(),
    quantity: z.number().optional(),
    sku: z.string().optional(),
    merchantSku: z.string().optional(),
    printMethod: z.string().optional(),
    productLine: z.enum(PRODUCT_LINES).optional(),
    /** Ảnh mockup — thứ khách vốn thấy ở portal/catalog, KHÔNG phải file in. */
    mockupUrl: z.string().optional(),
  }),

  dates: z.object({
    orderAt: z.coerce.date().optional(),
    pushedAt: z.coerce.date().optional(),
    inProductionAt: z.coerce.date().optional(),
    fulfillmentCompletedAt: z.coerce.date().optional(),
    cancelledAt: z.coerce.date().optional(),
  }),

  /** Vận đơn khách tự cấp — số/hãng/link tra cứu, KHÔNG kèm `labelUrl`. */
  tracking: z
    .object({
      number: z.string().optional(),
      carrier: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),

  /** Điểm đến rút gọn — cố ý KHÔNG có tên người nhận / địa chỉ đường / phone. */
  destination: z
    .object({
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),

  /**
   * Vị trí in của sản phẩm + file thiết kế tương ứng của đơn. Theo thứ tự
   * `printArea` đã cấu hình; vị trí đơn có file mà sản phẩm không khai vẫn
   * được liệt kê ở cuối (đừng giấu file đang thực sự đi vào sản xuất).
   */
  designs: PublicOrderTrackDesignZod.array(),

  /** 8 chặng vòng đời — rỗng khi đơn chưa đẩy sản xuất. */
  stages: LifecycleTrackStageZod.array(),

  /** Các item còn lại cùng đơn — để người tra thấy đủ đơn, mỗi dòng 1 mã. */
  siblings: z
    .object({
      productionId: z.string(),
      type: z.string().optional(),
      color: z.string().optional(),
      size: z.string().optional(),
      quantity: z.number().optional(),
      status: z.nativeEnum(CustomerOrderStatus),
      currentStageKey: z.string().optional(),
      currentStageLabel: z.string().optional(),
    })
    .array(),
});
export type PublicOrderTrack = z.infer<typeof PublicOrderTrackZod>;

export const GetPublicOrderTrackResZod = ResZod.extend({ data: PublicOrderTrackZod });
export class GetPublicOrderTrackResDto extends createZodDto(extendApi(GetPublicOrderTrackResZod)) {}

// ---------------------------------------------------------------------------
// Khu quản trị trong Seller Portal (`/hub`, SellerPortal.md §9) — nhân viên
// Admin/SuperAdmin đọc đơn staging của MỌI khách. Chỉ đọc; thao tác vẫn qua
// mạo danh (xem với tư cách seller).
// ---------------------------------------------------------------------------

/** Trạng thái NỘI BỘ của đơn sản xuất — chỉ admin (`/hub/orders`), KHÔNG bao giờ trả cho khách. */
export const AdminInternalStatusZod = z.object({
  /** Khóa chặng hiện tại (`WORKSHOP_STAGE_FILTER_KEYS`), `done` khi đã đóng hàng. */
  stage: z.string().optional(),
  factoryShortName: z.string().optional(),
  factoryName: z.string().optional(),
  /**
   * Đơn thuộc xưởng NGOÀI luồng sản xuất VN (`excluded-factory.ts`, hiện là
   * xưởng US). Đơn như vậy cố ý bị loại khỏi mọi danh sách/thống kê của app
   * xưởng, nên ops tìm ở đó sẽ không thấy — hub phải nói rõ thay vì để im.
   */
  outOfProduction: z.boolean().optional(),
  designerName: z.string().optional(),
  designerStatus: z.string().optional(),
  priority: z.number().optional(),
  productionError: z.string().optional(),
  productionErrorSource: z.string().optional(),
  productionErrorNote: z.string().optional(),
  toolResult: z.string().optional(),
  toolResultNote: z.string().optional(),
  toolCheckErrorNotes: z.string().array().optional(),
  errorFileNote: z.string().optional(),
  printStatusNote: z.string().optional(),
  designerRejectedReason: z.string().optional(),
  holdReason: z.string().optional(),
  /**
   * `_id` của đơn sản xuất — hub cần để gọi luồng mua vận đơn
   * (`POST shipping-vnp/orders/:orderId/shipment` nhận `_id`, không nhận mã sản xuất).
   */
  orderRefId: z.string().optional(),
  /** Cân nặng gram + kích thước đóng gói cm — cột vận đơn dựng payload mua từ đây. */
  weight: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  length: z.number().optional(),
  /** Vận đơn hiện có của đơn (khách tự cấp hoặc VNP đã mua). */
  shipment: z
    .object({
      trackingCode: z.string().optional(),
      carrier: z.string().optional(),
      labelUrl: z.string().optional(),
      shipmentId: z.string().optional(),
      status: z.string().optional(),
      cancelledAt: z.coerce.date().optional(),
      /** `customer` = khách tự cấp, `vnp` = mình mua qua VNP. */
      provider: z.string().optional(),
    })
    .optional(),
  /** Nhật ký gần nhất của đơn (`orderLogs`). */
  lastLog: z
    .object({ action: z.string(), field: z.string().optional(), userName: z.string().optional(), at: z.coerce.date().optional(), after: z.unknown().optional() })
    .optional(),
});
export type AdminInternalStatus = z.infer<typeof AdminInternalStatusZod>;

export const AdminCustomerStagingItemZod = CustomerStagingItemZod.extend({ internal: AdminInternalStatusZod.optional() });
export type AdminCustomerStagingItem = z.infer<typeof AdminCustomerStagingItemZod>;

export const AdminCustomerStagingOrderZod = CustomerStagingOrderZod.extend({
  items: AdminCustomerStagingItemZod.array(),
  customerId: IDZod,
  /** Khách sở hữu đơn — `$lookup customers`, để hiện cột Seller. */
  customer: z
    .object({
      userSku: z.string().optional(),
      userEmail: z.string().optional(),
      fullName: z.string().optional(),
      tier: z.number().nullish(),
    })
    .optional(),
});
export type AdminCustomerStagingOrder = z.infer<typeof AdminCustomerStagingOrderZod>;

/** Khoảng ngày (YYYY-MM-DD, giờ VN) theo mốc `pushedAt ?? createdAt` — cùng mốc sắp xếp listing. */
export const AdminOrderDateRangeZod = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const GetAdminCustomerOrdersZod = GetCustomerStagingOrdersZod.merge(AdminOrderDateRangeZod).extend({
  /** Lọc theo 1 seller; bỏ trống = mọi seller. */
  customerId: IDZod.optional(),
  /** Chặng sản xuất hiện tại (`WORKSHOP_STAGE_FILTER_KEYS`) — đơn có ≥1 item đang ở chặng này (Operations `/hub/operations`). */
  stage: z.enum(WORKSHOP_STAGE_FILTER_KEYS).optional(),
});
export class GetAdminCustomerOrdersDto extends createZodDto(extendApi(GetAdminCustomerOrdersZod)) {}

export const GetAdminCustomerOrdersResZod = PageResZod.extend({ data: AdminCustomerStagingOrderZod.array() });
export class GetAdminCustomerOrdersResDto extends createZodDto(extendApi(GetAdminCustomerOrdersResZod)) {}

export const GetAdminCustomerOrderCountsZod = AdminOrderDateRangeZod.extend({ customerId: IDZod.optional(), productLine: z.enum(PRODUCT_LINES).optional() });
export class GetAdminCustomerOrderCountsDto extends createZodDto(extendApi(GetAdminCustomerOrderCountsZod)) {}

export const AdminSellerStatZod = z.object({
  customerId: IDZod,
  userSku: z.string().optional(),
  userEmail: z.string().optional(),
  fullName: z.string().optional(),
  tier: z.number().nullish(),
  orders: z.number(),
  pending: z.number(),
  inProduction: z.number(),
  held: z.number(),
  lastOrderAt: z.coerce.date().optional(),
});
export type AdminSellerStat = z.infer<typeof AdminSellerStatZod>;

export const AdminCustomerOrderStatsZod = z.object({
  /** Đếm toàn hệ (cùng công thức `counts` của khách). */
  counts: CustomerOrderCountsZod,
  /** Số seller có ít nhất 1 đơn staging. */
  sellers: z.number(),
  /** Top seller theo số đơn. */
  topSellers: AdminSellerStatZod.array(),
  /** Đơn mới nhất toàn hệ. */
  recent: AdminCustomerStagingOrderZod.array(),
});
export type AdminCustomerOrderStats = z.infer<typeof AdminCustomerOrderStatsZod>;
export const GetAdminCustomerOrderStatsResZod = ResZod.extend({ data: AdminCustomerOrderStatsZod });
export class GetAdminCustomerOrderStatsResDto extends createZodDto(extendApi(GetAdminCustomerOrderStatsResZod)) {}

/* ── Admin đặt đơn / đẩy đơn THAY seller ở khu `/hub` ────────────────────────
 * Ops bên hub cần lên đơn hộ seller (khuôn `mode="staff"` của wizard thghub:
 * thêm đúng một bước "chọn seller", phần còn lại y hệt màn seller tự đặt).
 * Không nhân bản nghiệp vụ: controller nạp khách theo `customerId` rồi gọi
 * CHÍNH `placeOrder` / `pushToProduction` mà seller dùng.
 */
export const AdminPlaceOrderForZod = z.object({ customerId: IDZod });
export class AdminPlaceOrderForDto extends createZodDto(extendApi(AdminPlaceOrderForZod)) {}

