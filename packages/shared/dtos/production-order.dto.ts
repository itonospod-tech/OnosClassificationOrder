import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { DesignerStatus, DesignerTransitionAction, FulfillmentStage, FulfillmentStageStatus, FulfillmentTransitionAction, ORDER_PRIORITIES, OrderPriority, PRODUCT_LINES } from '@shared/enums';
import { BaseEntityZod, PageQueryZod, PageResZod, ResZod } from '@shared/types';
import { z } from 'zod';

import {
  DesignFieldsZod,
  hasProductionOrderTracking,
  normalizeProductionOrderTracking,
  ProductionOrderShippingAddressZod,
  ProductionOrderTrackingZod,
  type DesignFields,
  type ProductionOrderShippingAddress,
  type ProductionOrderTracking,
} from '../client';
import { BooleanFlagZod, IDZod } from '../constants/common-zod';
import { HOLD_SOURCES } from '../constants/hold-reason';
import { VnpShipmentInfoZod } from './vnp-shipping.dto';

export const DesignerStatusZod = z.nativeEnum(DesignerStatus);
export const DesignerTransitionActionZod = z.nativeEnum(DesignerTransitionAction);

export const FulfillmentStageZod = z.nativeEnum(FulfillmentStage);
export const FulfillmentStageStatusZod = z.nativeEnum(FulfillmentStageStatus);
export const FulfillmentTransitionActionZod = z.nativeEnum(FulfillmentTransitionAction);

export const OrderPriorityZod = z.nativeEnum(OrderPriority);

/** State per 1 stage (Print/Press/QC/Sew/Pack). */
export const FulfillmentStageStateZod = z.object({
  status: FulfillmentStageStatusZod.default(FulfillmentStageStatus.Waiting),
  /** = user._id của worker đảm nhiệm (resolved từ factory+stage tại thời điểm assign). */
  assignee: z.string().optional(),
  assignedAt: z.date().optional(),
  /**
   * Thời điểm stage **nhận task** (vào trạng thái `waiting`). Set khi:
   *   - Auto-advance từ stage trước complete.
   *   - Designer.complete entry → set cho `print`.
   *   - Entry B (manual `toolResultNote='ok'`) → set cho `print`.
   * KHÔNG set khi rework-back của reporter (reporter chỉ đẩy đi rồi chờ — không
   * coi như nhận task mới); dùng `reworkAt` cho case quay lại.
   * FE hiển thị "Nhận task lúc..." trong card tab "Đang chờ".
   */
  waitingAt: z.date().optional(),
  /** Start của cycle hiện tại — reset mỗi lần start/restart. */
  startedAt: z.date().optional(),
  /** Start của LẦN ĐẦU — immutable. Dùng tính response time. */
  firstStartedAt: z.date().optional(),
  completedAt: z.date().optional(),
  reworkAt: z.date().optional(),
  /** Số lần stage này bị stage sau đẩy về (hoặc nằm trên đường đẩy về). */
  reworkCount: z.number().int().nonnegative().default(0),
  reworkReason: z.string().max(500).optional(),
  /** Stage đã trigger rework-back đẩy về stage này (vd QC đẩy về In). */
  reworkFromStage: FulfillmentStageZod.optional(),
  /** Cumulative thời gian làm thực (ms) — $inc khi complete. */
  workMs: z.number().int().nonnegative().default(0),
});
export type FulfillmentStageState = z.infer<typeof FulfillmentStageStateZod>;

export const FulfillmentStagesZod = z.object({
  print: FulfillmentStageStateZod.optional(),
  press: FulfillmentStageStateZod.optional(),
  'qc-post-press': FulfillmentStageStateZod.optional(),
  'sew-in': FulfillmentStageStateZod.optional(),
  'sew-out': FulfillmentStageStateZod.optional(),
  pack: FulfillmentStageStateZod.optional(),
});
export type FulfillmentStages = z.infer<typeof FulfillmentStagesZod>;

/** 1 dòng lịch sử di chuyển. Push mỗi lần transition. */
export const FulfillmentTimelineEntryZod = z.object({
  stage: FulfillmentStageZod,
  action: FulfillmentTransitionActionZod,
  fromStatus: FulfillmentStageStatusZod,
  toStatus: FulfillmentStageStatusZod,
  byUserId: IDZod,
  byUserName: z.string().optional(),
  at: z.date(),
  /** Khi action=rework-back: target = designer | <stage>. */
  reworkTarget: z.string().optional(),
  reason: z.string().max(500).optional(),
});
export type FulfillmentTimelineEntry = z.infer<typeof FulfillmentTimelineEntryZod>;

// Nest-free, dời sang `client/design-fields.ts` (apps/seller dùng runtime qua `shared/client`).
export { DesignFieldsZod, type DesignFields };

/**
 * Địa chỉ ship — mirror field `shipping` trả về từ OnosPod (order API).
 * Dùng để "lấy ngược" địa chỉ khi đơn đang GIỮ chờ khách cập nhật, xem
 * `OrderService.getHeldOrdersForRecovery` + `OnospodOrderLookupService`.
 */
// Nest-free, dời sang `client/shipping.ts`.
export { ProductionOrderShippingAddressZod, type ProductionOrderShippingAddress };

/**
 * Vận đơn KHÁCH TỰ CẤP (label mua sẵn bên ngoài — SBTT/hệ cũ/API riêng của
 * khách): số tracking + hãng + link tra cứu + file label để xưởng in dán.
 *
 * Đây là shape DÙNG CHUNG cho cả staging đơn khách (`CustomerOrderTrackingZod`
 * chỉ là alias của schema này) lẫn `OrderEntity.tracking` — một định nghĩa duy
 * nhất để CSV khách / CSV admin / Public Order API không trôi lệch nhau.
 *
 * KHÁC `vnpShipment`: đó là label DO HỆ THỐNG mua qua VNP eGlobal. Cả hai cùng
 * đổ về collection `shipments` (module `shipping-vnp`) qua `provider` khác nhau
 * — xem `documents/FunctionDescription/VnpShipping.md §2a`.
 */
// Nest-free, dời sang `client/shipping.ts` (+ `hasProductionOrderTracking`/`normalizeProductionOrderTracking`).
export { ProductionOrderTrackingZod, type ProductionOrderTracking, hasProductionOrderTracking, normalizeProductionOrderTracking };

/** Trạng thái pipeline R2 cho từng vị trí design (Phase 6 Design-R2-Pipeline). */
export const DesignStatusZod = z.enum(['pending', 'ready', 'failed']);
export type DesignStatus = z.infer<typeof DesignStatusZod>;
export const DesignsStatusFieldsZod = z.object({
  front: DesignStatusZod.optional(),
  back: DesignStatusZod.optional(),
  sleeve: DesignStatusZod.optional(),
  hood: DesignStatusZod.optional(),
  folder: DesignStatusZod.optional(),
  placket: DesignStatusZod.optional(),
  chestLeft: DesignStatusZod.optional(),
  chestRight: DesignStatusZod.optional(),
  left: DesignStatusZod.optional(),
  right: DesignStatusZod.optional(),
  sleeveLeft: DesignStatusZod.optional(),
  sleeveRight: DesignStatusZod.optional(),
  leftUpperSleeve: DesignStatusZod.optional(),
  rightUpperSleeve: DesignStatusZod.optional(),
  leftCuff: DesignStatusZod.optional(),
  rightCuff: DesignStatusZod.optional(),
  frontEmbroidery: DesignStatusZod.optional(),
  backEmbroidery: DesignStatusZod.optional(),
});
export type DesignsStatusFields = z.infer<typeof DesignsStatusFieldsZod>;

/** 1 lần designer báo "không làm được" và bàn giao đơn sang người khác. */
export const DesignerRejectionZod = z.object({
  /** user._id của designer báo không làm được (người bàn giao). */
  fromUserId: z.string(),
  /** user._id của designer nhận thay. */
  toUserId: z.string(),
  /** Lý do (tùy chọn, max 500). */
  reason: z.string().optional(),
  at: z.date(),
});
export type DesignerRejection = z.infer<typeof DesignerRejectionZod>;

export const ProductionOrderZod = BaseEntityZod.extend({
  productionId: z.string().min(1),
  userSku: z.string().optional(),
  userEmail: z.string().optional(),
  type: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  mockupUrl: z.string().optional(),
  mockupOriginalUrl: z.string().optional(),
  /**
   * Drive URL của file cutting (.pdf) — cũng là file in (design đã duyệt).
   * KHÔNG set lúc import đơn — populate qua flow riêng
   * `POST /orders/cutting-files/apply` (filename gốc dạng 2 chữ cái + "-" +
   * 5 số + "-" + 5 số, vd `BH-96341-30608-*.pdf`, `ML-12345-67890-*.pdf` →
   * parse productionId match đơn) HOẶC qua `POST /orders/design-review/result`
   * (tool ngoài soát design, set thẳng free text — Orders.md §18.7).
   */
  cuttingFileUrl: z.string().optional(),
  /** Tên file cache lúc map (FE hiện ở dialog detail mà không re-fetch Drive). */
  cuttingFileName: z.string().optional(),
  /**
   * Drive URL của file in tạm (.pdf hoặc file design) — dùng khi đơn đang bị
   * lỗi (`toolResultNote='error'`), KHÁC `cuttingFileUrl` (file chính thức đã
   * duyệt). Set qua `POST /orders/design-review/result` (Orders.md §18.7).
   */
  tempFileUrl: z.string().optional(),
  printMethod: z.string().optional(),
  /** PRD-8 — dòng sản phẩm (3d/2d/wood/embroidery/led/canvas), trục Seller Portal. */
  productLine: z.enum(PRODUCT_LINES).optional(),
  weight: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  length: z.number().optional(),
  quantity: z.number().default(1),
  baseCost: z.number().optional(),
  shipCost: z.number().optional(),
  designs: DesignFieldsZod.optional(),
  designsOriginal: DesignFieldsZod.optional(),
  designsStatus: DesignsStatusFieldsZod.optional(),
  status: z.string().optional(),
  /** Đơn bị hủy (soft) — set qua POST /orders/:id/cancel (Admin) hoặc import "hủy đơn". */
  cancelledAt: z.date().optional(),
  cancelReason: z.string().optional(),
  /**
   * Đơn đang bị GIỮ (hold) — tạm dừng mọi thao tác cho tới khi mở lại. Set qua
   * POST /orders/:id/hold, clear qua /unhold (hoặc bulk-hold). Khác `cancelledAt`
   * ở chỗ REVERSIBLE — mở lại để tiếp tục hoàn thành đơn.
   */
  heldAt: z.date().optional(),
  holdReason: z.string().optional(),
  /**
   * Nguồn lượt giữ hiện tại (Orders.md §9d): `manual` (nhân viên) | `onospod`
   * (đồng bộ tự giữ). Thiếu trường trên đơn đang giữ = `manual`. Bị `$unset`
   * cùng `heldAt` khi mở giữ. Chỉ đơn `onospod` được đồng bộ tự nhả.
   */
  holdSource: z.enum(HOLD_SOURCES).optional(),
  /**
   * Cờ "OnosPod đang giữ" — có khi item MRP bên OnosPod đang `On Hold`, BẤT KỂ
   * đơn bên mình có bị giữ hay không (đơn đã xong / nhân viên đã bỏ qua vẫn
   * mang cờ để FE hiện nhãn). `onHoldAt` = thời điểm đợt giữ bên OnosPod
   * (log `On Hold` mới nhất), `seenAt` = lần đầu đồng bộ thấy đợt này.
   */
  onospodHold: z.object({ onHoldAt: z.date(), seenAt: z.date() }).nullable().optional(),
  /**
   * Nhân viên đã mở giữ đơn trong khi OnosPod vẫn giữ → lưu `onHoldAt` của đợt
   * bị bỏ qua. Đồng bộ KHÔNG giữ lại cho tới khi OnosPod có đợt giữ MỚI HƠN mốc này.
   */
  onospodHoldDismissedAt: z.date().optional(),
  /**
   * Snapshot địa chỉ ship lấy từ OnosPod — chỉ dùng cho cron "lấy ngược địa
   * chỉ" (đơn giữ lý do `HOLD_REASON_WAITING_ADDRESS`). Lần đầu = snapshot mốc
   * so sánh (KHÔNG tự mở giữ), lần sau khác snapshot → mở giữ + cập nhật.
   */
  shippingAddress: ProductionOrderShippingAddressZod.optional(),
  /**
   * Vận đơn VNP eGlobal đã tạo cho đơn này (nếu có) — set qua module
   * `shipping-vnp` (nút "Vận đơn VNP" ở bảng đơn hàng, giai đoạn test).
   */
  vnpShipment: VnpShipmentInfoZod.optional(),
  /**
   * Vận đơn KHÁCH TỰ CẤP đi kèm lúc lên đơn (CSV khách / CSV admin / Public
   * Order API). Snapshot mỏng để render list — nguồn sự thật là record trong
   * collection `shipments` (provider `customer`).
   */
  tracking: ProductionOrderTrackingZod.optional(),
  orderId: z.string().optional(),
  externalId: z.string().optional(),
  referent: z.string().optional(),
  orderAt: z.date().optional(),
  inProductionAt: z.date().optional(),

  // Mapping
  isMapped: z.boolean().default(false),
  productConfigId: IDZod.optional(),
  factoryId: IDZod.optional(),
  machineTypeId: IDZod.optional(),
  /**
   * Factory the order was originally mapped to at import time. Compared with
   * `factoryId` to detect transfers (e.g. ML→TN). Set once, never changes.
   */
  originalFactoryId: IDZod.optional(),

  // Workshop fields (Phase 2) — values are workshop_config codes
  /**
   * Mức ưu tiên (1=thấp, 2=ưu tiên, 3=cao) — số càng cao càng ưu tiên. Không
   * set = đơn thường (không hiện badge/estimate, không ưu tiên sort). Sửa qua
   * `updateField`/`bulkUpdateField` (field `priority`) như mọi field workshop khác.
   */
  priority: OrderPriorityZod.optional(),
  printStatus: z.string().optional(),
  printStatusNote: z.string().optional(),
  toolResult: z.string().optional(),
  toolResultNote: z.string().optional(),
  /**
   * Thời điểm đơn LẦN ĐẦU được soát tool (toolResultNote chuyển từ rỗng →
   * có giá trị, qua updateField / bulkUpdateField / importRework). Dùng cho
   * dashboard Vòng đời đơn (chặng "Soát tool") để tính throughput + thời gian
   * TB từ lúc vào sản xuất đến lúc soát xong. Legacy rows backfill bằng
   * `updatedAt` trong `OrderService.onModuleInit`.
   */
  toolCheckedAt: z.date().optional(),
  /**
   * Multi-select workshop_config codes (category=error_file_type). Lưu dạng
   * array — 1 đơn có thể có nhiều lỗi cần sửa. Legacy data dạng string được
   * auto-migrate (xem `OrderModule.onModuleInit`).
   */
  errorFile: z.array(z.string()).optional(),
  errorFileNote: z.string().optional(),
  /** = user._id của sub-designer được gán. Set qua bulk-assign-designer
   *  hoặc field update assignee. Designer-Task-Workflow Phase 6 đổi từ
   *  workshop_config code → userId thuần. */
  assignee: z.string().optional(),
  assigneeNote: z.string().optional(),
  /** workshop_config code (category=fabric_type). Auto-filled at import from product config. */
  fabricType: z.string().optional(),
  /** workshop_config code (category=machine). Auto-filled at import from product config. */
  machineNumber: z.string().optional(),

  // ─── Production error (Phase 8) ────────────────────────────────
  // Xưởng báo lỗi sau khi đã in / chuẩn bị in: chọn lý do lỗi (code thuộc
  // category=production_error) + mô tả tự do. Đơn được coi là "có lỗi" khi
  // `productionError` được set (mọi nơi check: $exists + $ne ''/null).
  productionError: z.string().optional(),
  productionErrorNote: z.string().optional(),
  /**
   * Phân loại nguồn lỗi cho dashboard stats. Auto-fill từ
   * workshop_config.errorSource khi user set productionError. User có thể
   * override khi cần (vd. "Lỗi khác" — ambiguous code).
   */
  productionErrorSource: z.enum(['designer', 'factory', 'tool-check']).optional(),
  /**
   * Đếm số lần xưởng đã set productionError trên đơn này. $inc mỗi lần
   * updateField('productionError', non-null) hoặc setProductionError. Dùng để
   * hiển thị "Lỗi ×N" trên cell toolResultNote khi xưởng báo lỗi lần thứ N.
   */
  productionErrorCount: z.number().int().nonnegative().default(0),
  /**
   * Thời điểm đơn lần ĐẦU vào trạng thái lỗi trong cycle hiện tại. Set khi
   * `productionError` chuyển null → value (và field chưa có giá trị). Clear
   * khi `toolResultNote='ok'` hoặc `productionError` được clear (đơn rời tab
   * "Nhật ký bù lỗi"). Dùng để sort + tính mức độ khẩn.
   */
  productionFirstErrorAt: z.date().optional(),
  /** Admin đánh dấu hoàn thành lỗi tồn đọng → ẩn khỏi tab "Cần xử lý". */
  errorResolvedAt: z.date().optional(),

  // Derived: toolResultNote === 'ok'
  readyForFulfill: z.boolean().default(false),

  // ─── Designer task workflow (Phase 1 Designer-Task-Workflow) ─────
  /** State machine; default 'unassigned' khi import; set bởi transition endpoint. */
  designerStatus: DesignerStatusZod.default(DesignerStatus.Unassigned),
  /** Khi leader assign lần đầu — reset khi reassign sang sub khác. */
  designerAssignedAt: z.date().optional(),
  /**
   * Start time của CYCLE hiện tại. Reset mỗi lần `start`/`restart` (per-cycle).
   * Dùng để tính work delta khi `complete` (now - startedAt) → cộng vào
   * `designerWorkMs`.
   */
  designerStartedAt: z.date().optional(),
  /**
   * Start time của LẦN ĐẦU — set 1 lần khi `start` lần đầu, immutable.
   * Dùng để tính avgResponseMin chính xác (firstStartedAt - assignedAt).
   */
  designerFirstStartedAt: z.date().optional(),
  /** Khi sub bấm "Hoàn thành" — overwrite mỗi lần done (rework xong vẫn update). */
  designerCompletedAt: z.date().optional(),
  /** Khi sub bấm "Trả lại". Set kèm `designerRejectedReason`. */
  designerRejectedAt: z.date().optional(),
  /** Khi xưởng set productionError có errorSource='designer'. */
  designerReworkAt: z.date().optional(),
  /** Free-text reason sub-designer nhập khi reject (max 500). */
  designerRejectedReason: z.string().optional(),
  /** Số lần đơn này bị xưởng báo lỗi designer → rework. */
  designerReworkCount: z.number().int().nonnegative().default(0),
  /**
   * Cumulative thời gian designer LÀM thật (ms) — tổng các cycle (lần đầu +
   * rework). $inc khi `complete`. Dùng trực tiếp cho avgWorkMin stats.
   */
  designerWorkMs: z.number().int().nonnegative().default(0),
  /**
   * Lịch sử "báo không làm được → bàn giao": mỗi lần 1 designer báo không làm
   * được, đơn được gán thẳng sang designer khác (không còn state `rejected`).
   * Append-only — là NGUỒN thống kê "Không làm được" theo từng người (query
   * `designerRejections.fromUserId`), vì `assignee` hiện tại đã là người nhận.
   */
  designerRejections: DesignerRejectionZod.array().optional(),

  // ─── Fulfillment 5-stage workflow ───────────────────────────────
  /**
   * Stage hiện tại đơn đang nằm. null = chưa vào fulfillment (designer chưa
   * done) HOẶC đã hoàn tất hết 5 stage (xem `fulfillmentCompletedAt`).
   * Auto set = `print` khi `designerStatus = done`.
   */
  currentFulfillmentStage: FulfillmentStageZod.optional(),
  /** Set khi stage `pack` complete — đơn coi như xong. */
  fulfillmentCompletedAt: z.date().optional(),
  /** Per-stage state. Init lazy: stage chỉ có entry khi đã được kích hoạt. */
  fulfillmentStages: FulfillmentStagesZod.optional(),
  /** History toàn bộ transition — append-only. UI render timeline. */
  fulfillmentTimeline: FulfillmentTimelineEntryZod.array().default([]),
});
export type ProductionOrder = z.infer<typeof ProductionOrderZod>;

/** Row đã lưu DB — `_id` luôn có (BaseEntityZod để `_id` optional cho payload tạo mới). */
export type ProductionOrderRow = ProductionOrder & { _id: string };

// Whitelist of fields that can be updated inline via PATCH /:id/field.
// Keep in sync with `FIELD_EDIT_PERMS` and `FIELD_CONFIG_CATEGORY` in BE service.
export const ORDER_WORKSHOP_FIELDS = [
  'printStatus',
  'printStatusNote',
  'toolResult',
  'toolResultNote',
  'errorFile',
  'errorFileNote',
  'assignee',
  'assigneeNote',
  'fabricType',
  'machineNumber',
  'productionError',
  'productionErrorNote',
  'productionErrorSource',
  'priority',
] as const;
export type OrderWorkshopField = (typeof ORDER_WORKSHOP_FIELDS)[number];
export const OrderWorkshopFieldZod = z.enum(ORDER_WORKSHOP_FIELDS);

//
/** Giá trị hợp lệ của `workshopStage` — 8 chặng vòng đời (`LIFECYCLE_STAGE_KEYS`) + `done`. */
export const WORKSHOP_STAGE_FILTER_KEYS = [
  'tool-check',
  'designer',
  'print',
  'press',
  'qc-post-press',
  'sew-in',
  'sew-out',
  'pack',
  'done',
] as const;
export type WorkshopStageFilterKey = (typeof WORKSHOP_STAGE_FILTER_KEYS)[number];

export const GetProductionOrdersZod = PageQueryZod.extend({
  /**
   * `true` → chỉ đơn ĐÃ map product config; `false` → chỉ đơn CHƯA map. Bỏ qua
   * khi không truyền. `getOrders` kiểm `typeof dto.isMapped === 'boolean'` nên
   * đây là cờ BA TRẠNG THÁI: `false` mang nghĩa riêng, không phải "tắt".
   *
   * Trước ORD-24 dùng `z.coerce.boolean()`, mà `z.coerce.boolean('false')` ra
   * `true` — nên nút "Chưa mapping" ở `ListOrderTab` (chỗ DUY NHẤT trong cả FE
   * gửi chuỗi `'false'`) trả về ĐÚNG ĐIỀU NGƯỢC LẠI: đơn đã map. Tab đó đang
   * tắt nên chưa ai gặp; bật lại mà chưa sửa là lỗi hiện ra ngay.
   */
  isMapped: BooleanFlagZod,
  factoryId: IDZod.optional(),
  machineTypeId: IDZod.optional(),
  status: z.string().optional(),

  /**
   * Bulk lookup — comma-separated list of productionId. Khi có, lọc đúng các mã
   * này (exact, case-insensitive) qua `$in` regex. Dùng cho modal "Tìm bulk
   * productionId" (mỗi mã 1 dòng ở FE → join bằng dấu phẩy).
   */
  productionIds: z.string().optional(),

  /**
   * Comma-separated list of order `_id` — export/thao tác theo đúng các đơn
   * người dùng đã tick chọn (BulkEditToolbar "Xuất Excel"). Lọc `_id $in`.
   */
  ids: z.string().optional(),

  // Workshop filters — comma-separated list of workshop_config codes
  printStatus: z.string().optional(),
  /**
   * CSV mã note kq Tool. Token: `__none__` = chưa soát (note rỗng) · `__any__`
   * = đã soát (note bất kỳ) · `__error__` = đã soát & ≠ 'ok' (đang lỗi). 2 token
   * sau dùng cho drill dải "Tổng quan theo ngày" tab Soát tool.
   */
  toolResultNote: z.string().optional(),
  /** CSV user._id. Token: `__none__` = chưa gán · `__any__` = đã gán (bất kỳ ai). */
  assignee: z.string().optional(),
  errorFile: z.string().optional(),
  /**
   * Lọc theo TÊN loại sản phẩm, khớp CHÍNH XÁC. Nhận 2 dạng:
   *   `?type=A&type=B`  → mảng, mỗi phần tử là 1 tên (KHUYẾN NGHỊ)
   *   `?type=A`         → chuỗi, ĐÚNG MỘT tên, lấy nguyên văn
   *
   * KHÔNG tách bằng dấu phẩy — khác các facet CSV còn lại (`userSku`,
   * `fabricType`, `errorFile`…). Đây là NGOẠI LỆ CÓ CHỦ Ý: những facet kia mang
   * mã/id nên dấu phẩy không bao giờ nằm trong giá trị, còn `type` mang tên sản
   * phẩm tự do nhập từ file import nên dấu phẩy là ký tự dữ liệu hợp lệ. Tách nó
   * ra sẽ lọc SAI ÂM THẦM (không báo lỗi) với tên kiểu `"Tee, Long Sleeve"`.
   * Đừng "dọn cho nhất quán" bằng cách trả lại `.split(',')`.
   *
   * Token `__none__` = đơn CHƯA XÁC ĐỊNH loại sản phẩm (field thiếu/null/rỗng) —
   * mirror `toolResult`/`toolResultNote`/`assignee`. Cần token này vì Workshop
   * gom nhóm bằng `$ifNull` nên vẫn hiện nhóm "đơn không tên"; thiếu nó thì hai
   * trang lệch ngay khi có 1 đơn thiếu `type`.
   */
  type: z.union([z.string(), z.string().array()]).optional(),
  /** Exact match (CSV) — lọc theo SKU khách (bảng phẳng trang "In"). */
  userSku: z.string().optional(),
  /** Exact match (case-insensitive) — cặp với userSku cho drill-down "Đơn hàng của khách" (/adm/customers). */
  userEmail: z.string().optional(),
  /** Comma-separated workshop_config codes for fabric_type. */
  fabricType: z.string().optional(),
  /** Comma-separated workshop_config codes for tool_result. */
  toolResult: z.string().optional(),
  /** Comma-separated workshop_config codes for production_error. */
  productionError: z.string().optional(),
  /** Comma-separated workshop_config codes for machine (numéro máy). */
  machineNumber: z.string().optional(),
  /** Lọc theo mức ưu tiên (`order.priority`) — '1'|'2'|'3'. Drill tab Soát tool.
   *  `__any__` = đơn CÓ đặt ưu tiên (bất kỳ mức) — pill "Ưu tiên" trang Đơn hàng theo xưởng. */
  priority: z.enum(['1', '2', '3', '__any__']).optional(),
  /**
   * Designer state filter — CSV của DesignerStatus value. Hỗ trợ token đặc
   * biệt `__none__` để lọc đơn chưa có designerStatus (data legacy).
   */
  designerStatus: z.string().optional(),
  /** `true` → chỉ lấy đơn chưa map xưởng (factoryId null / không có). */
  unmapped: BooleanFlagZod,
  /**
   * Truthy → GIỮ đơn xưởng US (xưởng ngoài luồng sản xuất) trong kết quả, thay
   * vì loại mặc định. Đơn chưa map xưởng VẪN bị loại, đơn đã hủy VẪN bị loại —
   * cờ này chỉ mở đúng một nhóm.
   *
   * Chỉ trang **Danh sách đơn classic** (`/orders/classic`) gửi cờ này. Cố ý
   * làm cờ theo TỪNG REQUEST chứ không nới ở hàm dùng chung: `GET /orders` còn
   * phục vụ drill-down từ dashboard, mà số ở đó phải khớp số dashboard — nới
   * chung là lệch số mà không báo lỗi. Xem `Orders.md §21.3` (ORD-19).
   *
   * Phân giải bằng `BooleanFlagZod` chứ KHÔNG phải `z.coerce.boolean()`: cái
   * sau coi mọi chuỗi khác rỗng là bật, nên `includeExcludedFactory=false` —
   * cách tự nhiên nhất để nói "đừng gộp" — lại GỘP đơn xưởng US vào danh sách
   * mà không báo lỗi gì (ORD-21). Giá trị lạ → tắt, tức giữ mặc định an toàn.
   */
  includeExcludedFactory: BooleanFlagZod,
  /**
   * `true` → chỉ lấy đơn có lỗi xưởng (productionError set, khác null/empty).
   * `false` **không được hỗ trợ** — muốn xem đơn không lỗi thì đừng gửi cờ
   * (xem comment tại `getOrders`). Comment cũ ghi "Falsy → chỉ lấy đơn không có
   * lỗi" là SAI, mã chưa bao giờ làm vậy — sửa lại ở ORD-23.
   */
  hasError: BooleanFlagZod,

  /**
   * CSV `productionErrorSource` ('designer'|'factory'|'tool-check') — lọc theo
   * nguồn lỗi hiện tại. Drill hàng "Lỗi công đoạn" bảng Tổng quan N ngày.
   */
  errorSource: z.string().optional(),
  /**
   * Lịch sử soát lỗi tool (`toolCheckErrorNotes` — bền vững, xem
   * ToolCheckWorkflow.md). '1' → đơn TỪNG bị soát ra lỗi (array non-empty);
   * '0' → chưa từng (array rỗng/missing). Drill hàng "Soát lỗi" + nhóm
   * "Đẩy lại · từng lỗi/từng ok" bảng Tổng quan N ngày.
   */
  toolCheckedError: z.enum(['1', '0']).optional(),
  /**
   * CSV mã lỗi soát tool — lọc theo MÃ MỚI NHẤT của đơn (phần tử cuối
   * `toolCheckErrorNotes`, khớp breakdown `toolErrorByNote`). Drill dòng mã lỗi
   * trong tooltip hàng "Soát lỗi" bảng Tổng quan N ngày.
   */
  toolErrorNote: z.string().optional(),
  /**
   * Truthy → đơn thuộc pool cần/qua designer: `toolCheckErrorNotes` non-empty
   * HOẶC `designerStatus ∈ [assigned, in-progress, rework, done]`. Kết hợp
   * `assignee=__none__` cho drill hàng "Chưa gán designer" Tổng quan N ngày.
   */
  needDesigner: BooleanFlagZod,
  /**
   * userId → đơn có sự kiện bàn giao "Không làm được" ĐI từ user này
   * (`designerRejections.fromUserId`). Drill hàng "Không làm được" panel
   * thống kê 7 ngày (StatusBarCharts). Số đếm ma trận là số LẦN — 1 đơn bàn
   * giao nhiều lần vẫn chỉ 1 dòng trong danh sách.
   */
  rejectedBy: z.string().optional(),
  /** userId → đơn có sự kiện NHẬN bàn giao (`designerRejections.toUserId`). */
  receivedBy: z.string().optional(),
  /**
   * Truthy → đơn "tồn" theo lăng kính designer (hàng Tổng tồn Tổng quan N ngày):
   * chưa soát (note rỗng) ∨ đã gán & chưa xong (status assigned/in-progress/
   * rework) ∨ đang lỗi & chưa gán (pool cần designer). Union — mirror aggregation.
   */
  designBacklog: BooleanFlagZod,

  /**
   * `true` → chỉ lấy đơn đang GIỮ (heldAt set). `false` → chỉ lấy đơn KHÔNG
   * giữ. Bỏ qua khi không truyền hoặc truyền rỗng (mặc định hiện cả đơn giữ
   * lẫn không giữ — đơn giữ chỉ bị tô xám + khóa, không ẩn khỏi list).
   *
   * Đây là cờ BA TRẠNG THÁI thật: `false` mang nghĩa riêng chứ không phải
   * "tắt". Trước ORD-23, `held=false` bị hiểu thành `true` nên trả về đúng điều
   * ngược lại, còn `held=` (rỗng) bị hiểu thành `false` nên lọc mất đơn đang
   * giữ thay vì không lọc gì. Giao diện chỉ gửi `'true'` nên chưa ai gặp.
   */
  held: BooleanFlagZod,

  /**
   * Lọc theo LÝ DO giữ đơn — exact match `holdReason` (field chỉ tồn tại khi
   * đơn đang giữ, bị `$unset` cùng `heldAt` lúc mở giữ — nên tự nó đã ngụ ý
   * "đang giữ", không cần kết hợp thêm `held=true`). Không truyền → KHÔNG lọc
   * theo lý do (mặc định, giữ nguyên hành vi cũ). Giá trị thường là 1 trong
   * `HOLD_REASON_PRESETS` (FE) nhưng field là free-text nên chấp nhận bất kỳ
   * chuỗi nào khách/nhân viên đã nhập lúc giữ đơn.
   */
  holdReason: z.string().optional(),

  /**
   * Toggle "Đã hủy". Truthy → CHỈ lấy đơn đã hủy (`cancelledAt` set). Bỏ qua khi
   * không truyền (list mặc định vẫn hiện đơn hủy tô xám). Đơn hủy LUÔN bị loại
   * khỏi mọi facet count (dropdown filter) trừ khi toggle này bật.
   */
  cancelled: BooleanFlagZod,

  /**
   * Factory transfer filter. Values:
   *   "transferred-in:<factoryId>"  — orders whose current factory is `id`
   *                                   but originalFactoryId is different
   *                                   (i.e. received from another factory).
   *   "transferred-out:<factoryId>" — orders originally at `id` but now
   *                                   running at another factory.
   *   "transferred"                 — any inter-factory transfer.
   *   "pure"                        — originalFactoryId == factoryId (no transfer).
   */
  transferStatus: z.string().optional(),
  /** Comma-separated factoryIds — filter by ORIGINAL factory. */
  originalFactoryId: z.string().optional(),

  /**
   * Print pipeline stage. Mutually exclusive with each other. Used by
   * Dashboard Tab C per-factory drill-down (Đang in / Chưa in / Đã in xong).
   *   "printed"      — printStatus ∈ PRINTED_MACHINE_CODES (đã in xong)
   *   "printing"     — printStatus tồn tại nhưng không phải done code (đang in)
   *   "not-printed"  — printStatus null/empty (chưa in)
   */
  printStage: z.enum(['printed', 'printing', 'not-printed']).optional(),

  /**
   * Lọc theo trạng thái stage Fulfillment (dùng cho bảng trang "In" admin-view
   * — xem FulfillmentWorkflow.md §4.5). Stage suy từ `user.fulfillmentStage`
   * (mặc định print). `watching` cần userId (= assignee context) để elemMatch
   * timeline rework-back của chính user.
   *   waiting / in-progress / rework — currentFulfillmentStage = stage & status tương ứng.
   *   done                            — stage đã completedAt + đã rời stage, KHÔNG dính lỗi (reworkCount=0).
   *   fixed                           — stage đã completedAt + đã rời stage, TỪNG bị đẩy về (reworkCount>0) = "Đã sửa".
   *   watching                        — user đã rework-back, đang chờ quay lại.
   */
  fulfillmentStatus: z.enum(['waiting', 'in-progress', 'rework', 'done', 'fixed', 'watching']).optional(),
  /**
   * Lọc theo CHẶNG HIỆN TẠI của đơn — ô phễu trang "Đơn hàng theo xưởng" (Orders.md §10.2b).
   * Chặng suy ra trong Mongo bằng ĐÚNG luật `computeCurrentStage()` (customer-order.service.ts)
   * / `getOrderStatusInfo()` (FE) — xem `OrderService.workshopStageExpr()`. `done` = đã đóng hàng.
   */
  workshopStage: z.enum(WORKSHOP_STAGE_FILTER_KEYS).optional(),

  // Date range on `orderAt` — thời gian khách lên đơn (yyyy-mm-dd). Tên giữ
  // là `createdFrom/createdTo` để URL/bookmark cũ không vỡ. Designer/Fulfillment
  // có 7-day window server-side mặc định; truyền 2 field này sẽ override.
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
});
export class GetProductionOrdersDto extends createZodDto(extendApi(GetProductionOrdersZod)) {}

export const GetProductionOrdersResZod = PageResZod.extend({ data: ProductionOrderZod.array() });
export class GetProductionOrdersResDto extends createZodDto(extendApi(GetProductionOrdersResZod)) {}

// Grouped-by-type response — same filter shape as GetProductionOrdersZod, but
// pagination unit is "product type" instead of "row". This avoids splitting
// a single product across pages, which would mis-represent the duplicate-count
// aggregation done on the client.
export const ProductionOrderGroupZod = z.object({
  /** Empty string when the order has no type. */
  type: z.string(),
  /** Number of orders in this group (matching the filter). */
  totalOrders: z.number(),
  /** Sum of `quantity` across orders in this group. */
  totalQuantity: z.number(),
  /** Full list of orders for this type — workshop scans them all. */
  orders: ProductionOrderZod.array(),
});
export type ProductionOrderGroup = z.infer<typeof ProductionOrderGroupZod>;

export const GetGroupedProductionOrdersResZod = PageResZod.extend({
  data: ProductionOrderGroupZod.array(),
});
export class GetGroupedProductionOrdersResDto extends createZodDto(extendApi(GetGroupedProductionOrdersResZod)) {}

// Đếm số đơn theo 5 trạng thái stage Fulfillment (bảng trang "In" admin-view).
export const FulfillmentStatusCountsResZod = ResZod.extend({
  data: z.object({
    all: z.number(),
    waiting: z.number(),
    inProgress: z.number(),
    rework: z.number(),
    done: z.number(),
    fixed: z.number(),
    watching: z.number(),
  }),
});
export class FulfillmentStatusCountsResDto extends createZodDto(extendApi(FulfillmentStatusCountsResZod)) {}

//
export const ImportProductionOrderRowZod = z.object({
  productionId: z.string().min(1),
  userSku: z.string().optional(),
  userEmail: z.string().optional(),
  type: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  mockupUrl: z.string().optional(),
  printMethod: z.string().optional(),
  /** PRD-8 — dòng sản phẩm; import ưu tiên `ProductConfig.productLine` khi map được. */
  productLine: z.enum(PRODUCT_LINES).optional(),
  weight: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  length: z.number().optional(),
  quantity: z.number().optional(),
  baseCost: z.number().optional(),
  shipCost: z.number().optional(),
  designs: DesignFieldsZod.optional(),
  status: z.string().optional(),
  orderId: z.string().optional(),
  externalId: z.string().optional(),
  referent: z.string().optional(),
  orderAt: z.string().optional(),
  inProductionAt: z.string().optional(),
  shippingAddress: ProductionOrderShippingAddressZod.optional(),
  /**
   * Vận đơn khách tự cấp (cột `tracking_number`/`tracking_carrier`/
   * `tracking_url`/`shipping_label` của sheet import, hoặc `items[].tracking`
   * khi push đơn portal/API). `importOrders` lưu snapshot lên đơn RỒI ghi
   * record vào collection `shipments`.
   */
  tracking: ProductionOrderTrackingZod.optional(),
});
export type ImportProductionOrderRow = z.infer<typeof ImportProductionOrderRowZod>;

export const ImportProductionOrdersZod = z.object({
  rows: ImportProductionOrderRowZod.array().min(1),
});
export class ImportProductionOrdersDto extends createZodDto(extendApi(ImportProductionOrdersZod)) {}

export const ImportProductionOrdersResZod = ResZod.extend({
  data: z.object({
    imported: z.number(),
    updated: z.number(),
    mapped: z.number(),
    unmapped: z.number(),
    skipped: z.array(z.object({ row: z.number(), reason: z.string() })),
  }),
});
export class ImportProductionOrdersResDto extends createZodDto(extendApi(ImportProductionOrdersResZod)) {}

//
// Import file soát (rework) — update các field QC vào đơn hiện có
// theo `productionId`. Không tạo đơn mới, chỉ UPDATE.
//
export const ImportReworkOrderRowZod = z.object({
  productionId: z.string().min(1),
  toolResultNote: z.string().optional(), // sheet không dấu (vd "loi", "ok")
  errorFile: z.string().optional(), // sheet không dấu (vd "Vien co")
  errorFileNote: z.string().optional(), // free text; "hủy đơn" → cancel
  assignee: z.string().optional(), // fullName người thực hiện
});
export type ImportReworkOrderRow = z.infer<typeof ImportReworkOrderRowZod>;

export const ImportReworkOrdersZod = z.object({
  rows: ImportReworkOrderRowZod.array().min(1),
});
export class ImportReworkOrdersDto extends createZodDto(extendApi(ImportReworkOrdersZod)) {}

export const ImportReworkOrdersResZod = ResZod.extend({
  data: z.object({
    updated: z.number(), // số đơn cập nhật thành công
    notFound: z.number(), // productionId không tồn tại trong DB
    cancelled: z.number(), // số đơn bị mark cancel
    assigneeMatched: z.number(), // số row gán assignee thành công
    skipped: z.array(z.object({ row: z.number(), reason: z.string() })),
  }),
});
export class ImportReworkOrdersResDto extends createZodDto(extendApi(ImportReworkOrdersResZod)) {}

//
// Import tự động từ OnosPod QC (qc.onospod.com) — query trực tiếp
// paginateMrpProduct (status "To Do") rồi map + tái dùng pipeline
// importOrders() sẵn có. Xem OnospodImportService.
//
export const ImportFromOnosPodZod = z.object({
  // Bỏ trống cả 2 → tự tính theo giờ gọi (giờ VN): trước 12h trưa → từ 12h
  // trưa HÔM TRƯỚC; từ 12h trưa trở đi → từ 00h00 HÔM NAY. Chỉ truyền start
  // → end = thời điểm gọi. offset:true để nhận cả "+07:00" lẫn "Z".
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
});
export class ImportFromOnosPodDto extends createZodDto(extendApi(ImportFromOnosPodZod)) {}

// ─── Đồng bộ giữ đơn theo OnosPod (Orders.md §9d) ──────────────────────────
// Kết quả 1 lượt đồng bộ. `status='aborted'` = KHÔNG ghi gì cả (lỗi fetch,
// thiếu config, nghi ngờ dữ liệu, vượt trần nhả) — `reason` nói lý do.
export const OnospodHoldSyncResultZod = z.object({
  status: z.enum(['ok', 'aborted']),
  reason: z.string().optional(),
  window: z.object({ start: z.string(), end: z.string() }),
  /** Số item `On Hold` nhận từ OnosPod trong cửa sổ quét. */
  fetched: z.number().int().nonnegative(),
  held: z.array(z.string()),
  unheld: z.array(z.string()),
  /** Chỉ gắn/cập nhật cờ `onospodHold` (đơn đã xong/hủy, đơn nhân viên đang giữ, đợt bị bỏ qua). */
  flagged: z.array(z.string()),
  flagCleared: z.array(z.string()),
  /** OnosPod vẫn giữ nhưng nhân viên đã mở giữ đợt này → không giữ lại. */
  dismissedSkipped: z.array(z.string()),
  /** Đơn giữ-do-đồng-bộ vắng khỏi tập On Hold nhưng nằm ngoài cửa sổ quét → không nhả. */
  outOfWindowKept: z.array(z.string()),
  /** productionId OnosPod đang giữ nhưng không có đơn bên mình. */
  notFound: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});
export type OnospodHoldSyncResult = z.infer<typeof OnospodHoldSyncResultZod>;

export const ImportFromOnosPodResZod = ResZod.extend({
  data: z.object({
    imported: z.number(),
    updated: z.number(),
    mapped: z.number(),
    unmapped: z.number(),
    skipped: z.array(z.object({ row: z.number(), reason: z.string() })),
    totalFetched: z.number(),
    // Số productionId trùng lặp trong batch tổng hợp (đã dedupe trước khi
    // import) — vd cùng đơn xuất hiện ở 2 trang do data dịch chuyển lúc phân
    // trang, hoặc trùng giữa 2 manufacture.
    duplicatesInBatch: z.number(),
    period: z.object({ start: z.string(), end: z.string() }),
    // Số row được gắn `shippingAddress` từ lượt gọi thứ hai `orders(ids)`
    // bên api.onospod.com (địa chỉ giao của khách, mức ORDER — xem Orders.md
    // §3.6). 0 hoặc thấp bất thường = OnosPod order API lỗi/thiếu config
    // ONOSPOD_API_* (import vẫn chạy, chỉ thiếu địa chỉ — xem log
    // `onospodShippingBatch`).
    shippingAttached: z.number().optional(),
    // Pull từ TẤT CẢ manufacture của account trong 1 lượt phân trang duy
    // nhất (không truyền `manufacture_id`) — group lại từ field `manufacture`
    // có sẵn trên mỗi item, KHÔNG loop gọi riêng từng manufacture nữa nên
    // `error` giờ luôn rỗng (call fail = throw luôn, xem OnospodImportService).
    byManufacture: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sku: z.string(),
        fetched: z.number(),
        error: z.string().optional(),
      }),
    ),
    // Lượt đồng bộ giữ đơn chạy ngay sau import (Orders.md §9d). Vắng khi đồng
    // bộ ném lỗi bất ngờ — lỗi đó KHÔNG làm hỏng kết quả import.
    holdSync: OnospodHoldSyncResultZod.optional(),
  }),
});
export class ImportFromOnosPodResDto extends createZodDto(extendApi(ImportFromOnosPodResZod)) {}

//
// Dashboard
//
export const GetOrderDashboardZod = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  searchType: z.string().optional(),
  searchUser: z.string().optional(),
  /**
   * Lọc TƯỜNG MINH theo xưởng (cụm menu xưởng ở sidebar truyền `?factoryId=`).
   * Khớp `factoryId` HOẶC `originalFactoryId` để đơn đã chuyển đi vẫn thuộc
   * xưởng gốc. Lọc tường minh nên **có hiệu lực cả với xưởng ngoài luồng sản
   * xuất (US)** — xem `Orders.md §21`. Role Fulfillment bị khóa xưởng của họ,
   * tham số này bị bỏ qua.
   */
  factoryId: IDZod.optional(),
});
export class GetOrderDashboardDto extends createZodDto(extendApi(GetOrderDashboardZod)) {}

export const UserBreakdownZod = z.object({
  userSku: z.string().optional(),
  userEmail: z.string().optional(),
  orderCount: z.number(),
  totalQuantity: z.number(),
  totalProductionCost: z.number(),
  totalShippingCost: z.number(),
  totalCost: z.number(),
});
export type UserBreakdown = z.infer<typeof UserBreakdownZod>;

export const MockupSummaryZod = z.object({
  url: z.string(),
  originalUrl: z.string().optional(),
  count: z.number(),
});
export type MockupSummary = z.infer<typeof MockupSummaryZod>;

export const SizeSummaryZod = z.object({
  size: z.string(),
  count: z.number(),
});
export type SizeSummary = z.infer<typeof SizeSummaryZod>;

export const TypeSummaryZod = z.object({
  type: z.string(),
  quantity: z.number(),
  minCost: z.number(),
  maxCost: z.number(),
  productionCost: z.number(),
  shippingCost: z.number(),
  totalCost: z.number(),
  uniqueMockupCount: z.number(),
  duplicateMockupCount: z.number(),
  sizes: SizeSummaryZod.array(),
  mockups: MockupSummaryZod.array(),
  duplicateMockups: MockupSummaryZod.array(),
});
export type TypeSummary = z.infer<typeof TypeSummaryZod>;

export const MachineTypeBreakdownZod = z.object({
  machineTypeId: z.string().optional(),
  machineTypeName: z.string(),
  machineTypeShortName: z.string().optional(),
  quantity: z.number(),
  percentage: z.number(),
});
export type MachineTypeBreakdown = z.infer<typeof MachineTypeBreakdownZod>;

export const FactoryBreakdownZod = z.object({
  factoryId: z.string().optional(),
  factoryName: z.string(),
  factoryShortName: z.string().optional(),
  quantity: z.number(),
  percentage: z.number(),
  byMachineType: MachineTypeBreakdownZod.array(),
});
export type FactoryBreakdown = z.infer<typeof FactoryBreakdownZod>;

/**
 * Option xưởng cho MỌI dropdown lọc/chọn xưởng. Nguồn là bảng `factories`
 * (xưởng đang bật) chứ KHÔNG suy từ đơn — xưởng chưa có đơn nào trong kỳ vẫn
 * phải chọn được (nếu không thì không ai chuyển đơn sang xưởng mới mở được).
 */
export const FactoryOptionZod = z.object({
  factoryId: z.string(),
  factoryName: z.string(),
  factoryShortName: z.string().optional(),
});
export type FactoryOption = z.infer<typeof FactoryOptionZod>;

/**
 * Phục vụ bảng pivot "Số lượng theo size mỗi sản phẩm" có lọc theo xưởng.
 * Mỗi row = 1 cặp (factory, type) kèm phân bổ size. FE gom dropdown xưởng từ
 * distinct factoryId, và pivot type × size theo xưởng đang chọn.
 */
export const SizeMatrixRowZod = z.object({
  factoryId: z.string().optional(),
  factoryName: z.string(),
  type: z.string(),
  sizes: SizeSummaryZod.array(),
});
export type SizeMatrixRow = z.infer<typeof SizeMatrixRowZod>;

export const OrderDashboardZod = z.object({
  totals: z.object({
    totalOrders: z.number(),
    totalQuantity: z.number(),
    totalProductionCost: z.number(),
    totalShippingCost: z.number(),
    totalCost: z.number(),
    /** Số đơn HỦY (cancelledAt set) trong cùng scope xưởng + khoảng inProductionAt.
     * Không nằm trong totalOrders (đã loại đơn hủy khỏi mọi số liệu). */
    cancelledOrders: z.number(),
    /** Số đơn đang GIỮ (heldAt set) trong cùng scope xưởng + khoảng inProductionAt.
     * VẪN nằm trong totalOrders (đơn giữ chỉ tạm dừng, không loại khỏi số liệu). */
    heldOrders: z.number(),
  }),
  byType: TypeSummaryZod.array(),
  byFactory: FactoryBreakdownZod.array(),
  sizeMatrix: SizeMatrixRowZod.array(),
  /** Dropdown xưởng của bảng size matrix — ĐỦ xưởng đang bật, kể cả xưởng 0 đơn. */
  factoryOptions: FactoryOptionZod.array(),
  byUser: UserBreakdownZod.array(),
  filter: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    searchType: z.string().optional(),
    searchUser: z.string().optional(),
  }),
});
export type OrderDashboard = z.infer<typeof OrderDashboardZod>;

export const GetOrderDashboardResZod = ResZod.extend({ data: OrderDashboardZod });
export class GetOrderDashboardResDto extends createZodDto(extendApi(GetOrderDashboardResZod)) {}

//
// Phase 2 — Inline / Bulk update workshop field
//
/**
 * `value` accept:
 *  - `string`         — select code đơn (vd printStatus, toolResult) hoặc
 *                       free-text errorFileNote.
 *  - `string[]`       — multi-select field (hiện chỉ `errorFile`). BE tự
 *                       validate từng item.
 *  - `null` / empty   — clear value.
 */
export const UpdateOrderFieldZod = z.object({
  field: OrderWorkshopFieldZod,
  value: z.union([z.string(), z.array(z.string())]).nullable(),
});
export class UpdateOrderFieldDto extends createZodDto(extendApi(UpdateOrderFieldZod)) {}

export const UpdateOrderFieldResZod = ResZod.extend({ data: ProductionOrderZod });
export class UpdateOrderFieldResDto extends createZodDto(extendApi(UpdateOrderFieldResZod)) {}

export const BulkUpdateOrderFieldZod = z.object({
  ids: IDZod.array().min(1),
  field: OrderWorkshopFieldZod,
  value: z.union([z.string(), z.array(z.string())]).nullable(),
});
export class BulkUpdateOrderFieldDto extends createZodDto(extendApi(BulkUpdateOrderFieldZod)) {}

export const BulkUpdateOrderFieldResZod = ResZod.extend({
  data: z.object({
    matched: z.number(),
    modified: z.number(),
  }),
});
export class BulkUpdateOrderFieldResDto extends createZodDto(extendApi(BulkUpdateOrderFieldResZod)) {}

//
// Bulk assign designer — wrapper riêng cho assignee với pre-flight stats +
// detailed skipped report. Reuse được bulk-field nhưng UX gọn hơn nhiều khi
// gắn cho 1 designer cụ thể.
//
export const BulkAssignDesignerPreviewZod = z.object({
  ids: IDZod.array().min(1),
});
export class BulkAssignDesignerPreviewDto extends createZodDto(extendApi(BulkAssignDesignerPreviewZod)) {}

export const BulkAssignDesignerPreviewResZod = ResZod.extend({
  data: z.object({
    total: z.number(),
    /** Đếm theo designerStatus hiện tại của các đơn được chọn. */
    byStatus: z.object({
      unassigned: z.number(),
      assigned: z.number(),
      inProgress: z.number(),
      done: z.number(),
      rejected: z.number(),
      rework: z.number(),
    }),
    /** Đơn đã được gán cho designer khác (assignee != null). */
    alreadyAssigned: z
      .object({
        userId: z.string(),
        fullName: z.string().optional(),
        count: z.number(),
      })
      .array(),
    /** Số đơn sẽ bị skip do status (đang in-progress/done). */
    blockedCount: z.number(),
    /** Số đơn 'cần làm lại' đang có người ôm (assignee != null) — KHÔNG gán cho
     * người khác được, chỉ gán đơn rework chưa có ai ôm. */
    reworkHeldCount: z.number(),
    /** Số đơn có `toolResultNote='ok'` — KHÔNG cho gán designer (đã soát ok). */
    okCount: z.number(),
    /** Số đơn CHƯA soát (`toolResultNote` rỗng) — gán được nhưng cần confirm. */
    noToolCount: z.number(),
    /** Số đơn hợp lệ để assign (reassignable status VÀ toolResultNote != 'ok') — gồm cả chưa soát. */
    eligibleCount: z.number(),
    /** Subset của eligible nhưng ĐÃ soát (toolResultNote non-empty != 'ok') — dùng cho nút "Chỉ gán đơn đã soát". */
    eligibleWithToolCount: z.number(),
  }),
});
export class BulkAssignDesignerPreviewResDto extends createZodDto(extendApi(BulkAssignDesignerPreviewResZod)) {}

export const BulkAssignDesignerZod = z.object({
  ids: IDZod.array().min(1),
  /** Target user (sub-designer) — = user._id. */
  userId: IDZod,
  /** Nếu false (default) → từ chối khi có đơn đã assign cho người khác (an
   * toàn). FE confirm rồi đặt true để override. */
  reassignOthers: z.boolean().default(false),
  /** Nếu true → bỏ qua đơn CHƯA soát (`toolResultNote` rỗng). Tương ứng nút
   * "Chỉ gán đơn đã soát" ở dialog. Default false = gán tất cả. */
  skipUnreviewed: z.boolean().default(false),
});
export class BulkAssignDesignerDto extends createZodDto(extendApi(BulkAssignDesignerZod)) {}

export const BulkAssignDesignerResZod = ResZod.extend({
  data: z.object({
    matched: z.number(),
    modified: z.number(),
    /** ID + lý do của những đơn không assign được. */
    skipped: z
      .object({
        orderId: z.string(),
        productionId: z.string(),
        reason: z.string(),
      })
      .array(),
  }),
});
export class BulkAssignDesignerResDto extends createZodDto(extendApi(BulkAssignDesignerResZod)) {}

// ─── Tự động gán designer theo config (nút ở bảng "Cần gán designer") ─
// Preview chạy cùng routing 3 mức với autoAssignAfterImport nhưng KHÔNG ghi;
// xác nhận → apply ĐÚNG plan đã xem (đơn đổi trạng thái giữa chừng bị skip).
export const AutoAssignPreviewZod = z.object({
  orderIds: z.string().array().min(1).max(3000),
});
export class AutoAssignPreviewDto extends createZodDto(extendApi(AutoAssignPreviewZod)) {}

export const AutoAssignPlanRowZod = z.object({
  userId: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  count: z.number().int().nonnegative(),
  /** FE gửi lại y nguyên khi xác nhận — đảm bảo gán đúng cái đã xem. */
  orderIds: z.string().array(),
});
export type AutoAssignPlanRow = z.infer<typeof AutoAssignPlanRowZod>;
export const AutoAssignPreviewResZod = ResZod.extend({
  data: z.object({
    plan: AutoAssignPlanRowZod.array(),
    /** Đơn không gán được (ngoài cấu hình / không đủ điều kiện). */
    unassignedCount: z.number().int().nonnegative(),
    totalRequested: z.number().int().nonnegative(),
  }),
});
export class AutoAssignPreviewResDto extends createZodDto(extendApi(AutoAssignPreviewResZod)) {}

export const AutoAssignApplyZod = z.object({
  assignments: z.object({ userId: z.string(), orderIds: z.string().array() }).array().min(1),
});
export class AutoAssignApplyDto extends createZodDto(extendApi(AutoAssignApplyZod)) {}
export const AutoAssignApplyResZod = ResZod.extend({
  data: z.object({
    assigned: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});
export class AutoAssignApplyResDto extends createZodDto(extendApi(AutoAssignApplyResZod)) {}

/** Designer tự nhận (self-claim) N đơn từ pool "cần gán" về chính mình. */
export const ClaimDesignerTasksZod = z.object({
  ids: IDZod.array().min(1),
});
export class ClaimDesignerTasksDto extends createZodDto(extendApi(ClaimDesignerTasksZod)) {}

//
// Set production error atomic — wrapper riêng cho việc set 3 field cùng lúc
// (productionError + productionErrorSource + productionErrorNote). Cần thiết
// khi user chọn code "Lỗi khác" → bắt buộc nhập source + note.
//
export const SetProductionErrorZod = z.object({
  /** Workshop_config code; null = clear hẳn lỗi. */
  code: z.string().nullable(),
  /** Required khi code='other' (BE validate). Auto-fill từ config nếu vắng. */
  source: z.enum(['designer', 'factory', 'tool-check']).optional(),
  /** Required khi code='other' (BE validate). */
  note: z.string().max(500).optional(),
  /**
   * Đẩy đơn về công đoạn khi báo lỗi (báo lỗi toàn cục qua quét). Cho phép báo
   * lỗi đơn ĐÃ đi qua công đoạn mình / đã hoàn thành fulfillment.
   *  - 'designer' / 'tool-check': theo luồng source-driven (đã xử lý qua `source`).
   *  - 1 FulfillmentStage: đẩy về stage đó + làm lại toàn chuỗi tới vị trí xa nhất.
   */
  target: z.union([z.literal('designer'), z.literal('tool-check'), FulfillmentStageZod]).optional(),
});
export class SetProductionErrorDto extends createZodDto(extendApi(SetProductionErrorZod)) {}

export const SetProductionErrorResZod = ResZod.extend({ data: ProductionOrderZod });
export class SetProductionErrorResDto extends createZodDto(extendApi(SetProductionErrorResZod)) {}

//
// Scan barcode lookup — workshop quét máy USB → tìm đơn theo productionId
// exact match (case-insensitive). Trả về đủ field cho dialog gán lỗi:
// info đơn + factory + machineType + fulfillmentStages hiện tại.
//
export const GetOrderByProductionIdResZod = ResZod.extend({ data: ProductionOrderZod });
export class GetOrderByProductionIdResDto extends createZodDto(extendApi(GetOrderByProductionIdResZod)) {}

//
// Design review — public API cho tool ngoài duyệt thiết kế. Trả về 1 đơn ở
// "bước đầu tiên" (chưa soát tool + chưa gán designer) mỗi lần gọi, ưu tiên
// cao trước, cùng mức thì đơn nhập trước lấy trước. Xem Orders.md §18.
//
export const DesignReviewAttributesZod = z.object({
  size: z.string().optional(),
  color: z.string().optional(),
});
export type DesignReviewAttributes = z.infer<typeof DesignReviewAttributesZod>;

// Filter optional theo khoảng ngày `inProductionAt` (VN tz) — cùng semantics
// với `createdFrom`/`createdTo` ở danh sách đơn (Orders.md §7.0b), chỉ khác
// tên field (`from`/`to`) vì đây là public API riêng cho tool ngoài.
export const GetNextDesignReviewOrderZod = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  /**
   * Ép lấy ĐÚNG 1 đơn theo `productionId`, BỎ QUA mọi filter hàng đợi
   * (`toolResult` rỗng / `designerStatus` unassigned...) — trả về đơn ở BẤT
   * KỲ trạng thái nào miễn khớp mã, KHÔNG claim lease. Dùng khi tool ngoài
   * cần soát lại/ép xử lý đúng 1 đơn cụ thể thay vì lấy theo hàng đợi.
   */
  pid: z.string().optional(),
});
export class GetNextDesignReviewOrderDto extends createZodDto(extendApi(GetNextDesignReviewOrderZod)) {}

/**
 * ORD-6 — 1 vị trí in của đơn, kèm kích thước in THẬT (cm) ứng với size của
 * CHÍNH đơn đó (nguồn `ProductConfig.printArea[].sizeDimensions`, PRD-7).
 *
 * Danh sách là HỢP của: vị trí in đã cấu hình ở sản phẩm + vị trí có mặt trong
 * `designs` của đơn. Vị trí có design mà sản phẩm chưa cấu hình vẫn được liệt kê
 * với `configured: false` để tool biết là "có file nhưng chưa có cấu hình" thay
 * vì im lặng bỏ qua.
 *
 * `widthCm`/`lengthCm` = null khi size của đơn KHÔNG khớp size nào trong cấu
 * hình, hoặc vị trí chưa nhập kích thước. TUYỆT ĐỐI không lấy tạm size khác /
 * số mặc định — tool phải dừng và báo lỗi thay vì in sai kích thước lên giấy.
 */
export const DesignReviewPrintAreaZod = z.object({
  /** Trùng key trong `designs` (`DesignFields`) — dùng để ghép 1-1 với file design. */
  key: z.string(),
  /** Nhãn tiếng Việt của vị trí in (từ `PRODUCT_PRINT_AREA_LABEL_MAP`) — để in nhãn/hiển thị. */
  label: z.string(),
  /** false = vị trí này có design nhưng sản phẩm CHƯA cấu hình nó. */
  configured: z.boolean(),
  /** Chiều rộng in (cm) theo size của đơn. null = chưa xác định được, xem doc ở trên. */
  widthCm: z.number().nullable(),
  /** Chiều dài in (cm) theo size của đơn. null = chưa xác định được. */
  lengthCm: z.number().nullable(),
});
export type DesignReviewPrintArea = z.infer<typeof DesignReviewPrintAreaZod>;

export const DesignReviewOrderZod = z.object({
  /** Mã đơn nội bộ — khóa duy nhất, luôn có, dùng để gọi lại các API khác (vd cập nhật toolResultNote). */
  productionId: z.string(),
  /** Mã đơn marketplace/sàn (import từ sheet) — có thể rỗng với 1 số đơn. */
  orderId: z.string().optional(),
  /** Mã loại sản phẩm map từ `type` (bảng mapping cố định). null nếu `type` không khớp bảng. */
  productCode: z.string().nullable(),
  attributes: DesignReviewAttributesZod,
  designs: DesignFieldsZod,
  /** Ảnh mockup sản phẩm — tham chiếu trực quan khi soát design (KHÔNG phải file design gốc). */
  mockupUrl: z.string().optional(),
  /** Ngày đơn chuyển sang sản xuất (đơn vào production) — null nếu đơn chưa có mốc này. */
  inProductionAt: z.coerce.date().nullable().optional(),
  /**
   * ORD-6 — đơn này có in DTF không. Suy từ cấu hình sản phẩm
   * (`ProductConfig.printMethod === 'dtf'`), CỘNG quy ước cũ `productCode === 'TIFF'`
   * để tool bản đang chạy ở xưởng không gãy. Không tra được sản phẩm → false.
   */
  isDtf: z.boolean(),
  /** ORD-6 — vị trí in + kích thước theo size của đơn. Rỗng khi sản phẩm chưa cấu hình vị trí nào. */
  printAreas: DesignReviewPrintAreaZod.array(),
  /**
   * ORD-6 — SKU biến thể khớp size + màu của đơn. null khi không tra được sản
   * phẩm, không có biến thể nào khớp, hoặc khớp NHIỀU biến thể (không đoán).
   */
  variantSku: z.string().nullable(),
});
export type DesignReviewOrder = z.infer<typeof DesignReviewOrderZod>;

export const GetNextDesignReviewOrderResZod = z.object({
  success: z.literal(true),
  /** null khi không còn đơn nào ở bước đầu tiên. */
  data: DesignReviewOrderZod.nullable(),
  /** Tổng số đơn còn cần xử lý (bao gồm cả đơn trong `data`) — không tính claim/lease. */
  remaining: z.number().int().nonnegative(),
});
export class GetNextDesignReviewOrderResDto extends createZodDto(extendApi(GetNextDesignReviewOrderResZod)) {}

// Lookup TRỰC TIẾP 1 đơn theo `productionId` — bổ sung cho `/design-review/next`
// (lấy đơn TIẾP THEO trong hàng đợi). Dùng khi tool ngoài cần soát lại/tra cứu
// đúng 1 đơn cụ thể thay vì lấy theo thứ tự hàng đợi. KHÔNG áp filter hàng đợi
// (`toolResult` rỗng / `designerStatus` unassigned) — trả về đơn ở BẤT KỲ
// trạng thái nào, kể cả đã soát/đã gán, miễn khớp `productionId`.
export const GetDesignReviewOrderByIdResZod = z.object({
  success: z.literal(true),
  /** null nếu không tìm thấy đơn khớp `productionId`. */
  data: DesignReviewOrderZod.nullable(),
});
export class GetDesignReviewOrderByIdResDto extends createZodDto(extendApi(GetDesignReviewOrderByIdResZod)) {}

// Design review — danh mục "File lỗi" (workshop_config category=error_file_type,
// chỉ code active) để tool ngoài hiển thị lựa chọn khi Note kq Tool 1 = 'error',
// rồi truyền lại `code` qua field `errorFile` ở `/design-review/result`. JSON
// tự định nghĩa riêng cho luồng public này (chỉ `code`/`name`, KHÁC
// `WorkshopConfigZod` đầy đủ dùng nội bộ).
export const DesignReviewErrorFileOptionZod = z.object({
  code: z.string(),
  name: z.string(),
});
export type DesignReviewErrorFileOption = z.infer<typeof DesignReviewErrorFileOptionZod>;

export const GetDesignReviewErrorFileOptionsResZod = z.object({
  success: z.literal(true),
  data: DesignReviewErrorFileOptionZod.array(),
});
export class GetDesignReviewErrorFileOptionsResDto extends createZodDto(
  extendApi(GetDesignReviewErrorFileOptionsResZod),
) {}

// Design review — lưu Kết quả Tool (workshop_config category=tool_result, vd
// 'has-tool'/'no-tool'). `null` = xoá giá trị hiện có. KHÔNG có `toolResultNote`
// ("Note kq Tool 1") — field đó chỉ nhân viên sửa tay, ngoài luồng automation.
// Định danh bằng `productionId` — khóa duy nhất, luôn có (khác `orderId` = mã
// đơn marketplace gốc, KHÔNG unique vì 1 đơn có thể nhiều line item).
export const SetDesignReviewResultZod = z.object({
  productionId: z.string().min(1),
  toolResult: z.string().nullable(),
  /**
   * Optional — "Note kq Tool 1". Không truyền → giữ nguyên (hành vi cũ,
   * KHÔNG đụng field này). Truyền (kể cả `null` để xoá) → ghi đè + chạy CÙNG
   * side-effect hook với xưởng đánh tay ở Danh sách đơn (vd 'ok' → auto
   * rework-back/vào fulfillment).
   */
  toolResultNote: z.string().nullable().optional(),
  /**
   * Optional — mã "File lỗi" (workshop_config category=error_file_type), lấy
   * từ `GET /design-review/error-file-options`. Dùng khi `toolResultNote`
   * (request này hoặc giá trị đã lưu trước đó) = 'error' để ghi luôn nguyên
   * nhân lỗi file — tool tự quyết định có truyền hay không, BE không ép buộc
   * theo `toolResultNote`. Không truyền field này (bỏ hẳn key khỏi JSON) →
   * giữ nguyên hành vi cũ, KHÔNG đụng field. Truyền (kể cả `null`/`[]` để
   * xoá) → ghi đè.
   */
  errorFile: z.string().array().nullable().optional(),
  /**
   * Optional — "Ghi chú" (`errorFileNote`, free text, KHÔNG qua workshop_config
   * — cùng cột "Kết quả Tool / File lỗi" ở Danh sách đơn). Cùng cơ chế optional
   * như `errorFile`. Không truyền field này → giữ nguyên hành vi cũ, KHÔNG
   * đụng field. Truyền (kể cả `null`/`''` để xoá) → ghi đè. KHÔNG có
   * side-effect hook.
   */
  errorFileNote: z.string().nullable().optional(),
  /**
   * Optional — Drive URL của file cutting/file in (design đã duyệt, dùng ở
   * stage "In" của fulfillment — cùng field `cuttingFileUrl` được set ở
   * `applyCuttingFiles()`). Free text (KHÔNG qua workshop_config, không
   * validate format). Cùng cơ chế optional như `errorFileNote`. Không truyền
   * field này → giữ nguyên hành vi cũ, KHÔNG đụng field. Truyền (kể cả
   * `null`/`''` để xoá) → ghi đè. KHÔNG có side-effect hook.
   */
  cuttingFileUrl: z.string().nullable().optional(),
  /**
   * Optional — Drive URL của file in tạm (.pdf hoặc file design), dùng khi
   * đơn đang bị lỗi (`toolResultNote='error'`) để tool lưu tạm tham khảo
   * trong lúc chờ xử lý — KHÁC `cuttingFileUrl` (file chính thức đã duyệt).
   * Free text (KHÔNG qua workshop_config, không validate format). Cùng cơ
   * chế optional như `errorFileNote`. Không truyền field này → giữ nguyên
   * hành vi cũ, KHÔNG đụng field. Truyền (kể cả `null`/`''` để xoá) → ghi
   * đè. KHÔNG có side-effect hook.
   */
  tempFileUrl: z.string().nullable().optional(),
});
export class SetDesignReviewResultDto extends createZodDto(extendApi(SetDesignReviewResultZod)) {}

export const SetDesignReviewResultResZod = ResZod.extend({ data: ProductionOrderZod });
export class SetDesignReviewResultResDto extends createZodDto(extendApi(SetDesignReviewResultResZod)) {}

//
// Import summary — aggregates orders of a single day across all imports.
// Workshop uses this to spot duplicate (type, size, fabric) combinations
// so the same blank batch can be printed together.
//
export const ImportSummaryGroupZod = z.object({
  type: z.string(),
  size: z.string(),
  fabricType: z.string(),
  /** Resolved fabric label (Cotton Jersey, G5000…) for FE display. */
  fabricName: z.string().optional(),
  /** Sum of order.quantity in this combination. */
  totalQuantity: z.number(),
  /** Number of distinct orders (rows). */
  orderCount: z.number(),
  /** Sample production IDs (max 5) so the workshop can pull them up. */
  sampleProductionIds: z.string().array(),
});
export type ImportSummaryGroup = z.infer<typeof ImportSummaryGroupZod>;

export const ImportSummaryZod = z.object({
  date: z.string(),
  totalOrders: z.number(),
  totalQuantity: z.number(),
  groups: ImportSummaryGroupZod.array(),
});
export type ImportSummary = z.infer<typeof ImportSummaryZod>;

export const GetImportSummaryZod = z.object({
  /** yyyy-mm-dd; defaults to today on the server. */
  date: z.string().optional(),
});
export class GetImportSummaryDto extends createZodDto(extendApi(GetImportSummaryZod)) {}

export const GetImportSummaryResZod = ResZod.extend({ data: ImportSummaryZod });
export class GetImportSummaryResDto extends createZodDto(extendApi(GetImportSummaryResZod)) {}

//
// Factory transfer — move orders between factories without losing their origin.
//
export const TransferOrderZod = z.object({
  targetFactoryId: IDZod,
  /** Free-text reason logged with the audit entry. */
  reason: z.string().max(200).optional(),
});
export class TransferOrderDto extends createZodDto(extendApi(TransferOrderZod)) {}

export const BulkTransferOrderZod = z.object({
  ids: IDZod.array().min(1),
  targetFactoryId: IDZod,
  reason: z.string().max(200).optional(),
});
export class BulkTransferOrderDto extends createZodDto(extendApi(BulkTransferOrderZod)) {}

// ─── Cancel + Đổi design (Admin) ────────────────────────────────────
// Hủy đơn: soft cancel (set cancelledAt), CHỈ khi chưa bắt đầu in — xem
// `canCancelOrder` ở order.service.ts. Đổi design: đổi URL mockup + các vị trí
// design ĐANG CÓ (lưu raw; URL cũ giữ trong OrderLog).

export const CancelOrderZod = z.object({
  reason: z.string().min(1).max(200),
});
export class CancelOrderDto extends createZodDto(extendApi(CancelOrderZod)) {}
export const CancelOrderResZod = ResZod.extend({ data: ProductionOrderZod });
export class CancelOrderResDto extends createZodDto(extendApi(CancelOrderResZod)) {}

/**
 * "Chuyển hoàn thành" — SuperAdmin ép 1 đơn về trạng thái đã hoàn thành sản
 * xuất, các khâu chưa xong được điền mốc chia đều từ lúc đơn vào sản xuất tới
 * lúc bấm (`Orders.md §23`). Không có body: mọi thứ suy ra từ chính đơn.
 */
export const ForceCompleteOrderResZod = ResZod.extend({ data: ProductionOrderZod });
export class ForceCompleteOrderResDto extends createZodDto(extendApi(ForceCompleteOrderResZod)) {}

// ─── Giữ đơn (hold / unhold) ────────────────────────────────────────
// Hold: tạm dừng đơn — set heldAt + holdReason, khóa mọi thao tác cho tới khi
// mở lại (unhold). REVERSIBLE (khác cancel). Bulk: hold/unhold nhiều đơn 1 lần.
export const HoldOrderZod = z.object({
  reason: z.string().max(200).optional(),
});
export class HoldOrderDto extends createZodDto(extendApi(HoldOrderZod)) {}
export const HoldOrderResZod = ResZod.extend({ data: ProductionOrderZod });
export class HoldOrderResDto extends createZodDto(extendApi(HoldOrderResZod)) {}

export const BulkHoldOrderZod = z.object({
  ids: z.array(IDZod).min(1),
  /** true = giữ đơn; false = mở giữ. */
  hold: z.boolean(),
  reason: z.string().max(200).optional(),
});
export class BulkHoldOrderDto extends createZodDto(extendApi(BulkHoldOrderZod)) {}
export const BulkHoldOrderResZod = ResZod.extend({
  data: z.object({ matched: z.number(), modified: z.number() }),
});
export class BulkHoldOrderResDto extends createZodDto(extendApi(BulkHoldOrderResZod)) {}

export const UpdateOrderDesignZod = z.object({
  mockupUrl: z.string().max(2000).optional(),
  /** Chỉ các vị trí gửi lên được ghi đè (partial). */
  designs: DesignFieldsZod.partial().optional(),
});
export class UpdateOrderDesignDto extends createZodDto(extendApi(UpdateOrderDesignZod)) {}
export const UpdateOrderDesignResZod = ResZod.extend({ data: ProductionOrderZod });
export class UpdateOrderDesignResDto extends createZodDto(extendApi(UpdateOrderDesignResZod)) {}

/**
 * In tem barcode xưởng (Orders.md §16.7) — `POST /orders/barcode-labels`.
 * BE trả SẴN mọi giá trị hiện trên tem (kể cả SKU resolve từ Product Config và
 * chỉ số item i/n của orderId) để FE chỉ việc render + in; KHÔNG phình payload
 * `getOrders` bằng cách populate variations vào mọi danh sách đơn.
 * Trần 500 khớp `MAX_LABELS_PER_PRINT` của thanh bulk.
 */
export const GetBarcodeLabelsZod = z.object({
  ids: z.array(IDZod).min(1).max(500),
});
export class GetBarcodeLabelsDto extends createZodDto(extendApi(GetBarcodeLabelsZod)) {}
export const BarcodeLabelZod = z.object({
  _id: z.string(),
  productionId: z.string(),
  userSku: z.string().optional(),
  orderId: z.string().optional(),
  inProductionAt: z.coerce.date().optional(),
  /** SKU sản phẩm đã BỎ đuôi biến thể (vd `AOP-CUS-SHAPE-TIE` từ variation
   *  `AOP-CUS-SHAPE-TIE-10.6X62.2`) — resolve server-side từ Product Config. */
  sku: z.string().optional(),
  /** Biến thể của đơn: size + color gộp lại. */
  variant: z.string().optional(),
  /** Item thứ mấy / tổng item CÒN SỐNG (không hủy) của cùng (orderId, userEmail)
   *  trên TOÀN hệ thống — không phải trong lô đang in. Đơn không có orderId → 1/1. */
  itemIndex: z.number(),
  itemTotal: z.number(),
});
export type BarcodeLabel = z.infer<typeof BarcodeLabelZod>;
export const GetBarcodeLabelsResZod = ResZod.extend({ data: z.array(BarcodeLabelZod) });
export class GetBarcodeLabelsResDto extends createZodDto(extendApi(GetBarcodeLabelsResZod)) {}

/**
 * Label giao hàng 4×6 INCH kiểu carrier (Orders.md §16.8) — "DO NOT SHIP",
 * barcode Code128 = `productionId` trần (KHÔNG prefix `N-`), địa chỉ người
 * nhận từ `shippingAddress`, ảnh mockup + seller/size/color. In được ở MỌI
 * công đoạn, MỌI role. BE resolve sẵn SKU biến thể + cân nặng — FE chỉ render.
 */
export const GetShippingLabelsZod = z.object({
  ids: z.array(IDZod).min(1).max(500),
});
export class GetShippingLabelsDto extends createZodDto(extendApi(GetShippingLabelsZod)) {}
export const ShippingLabelZod = z.object({
  _id: z.string(),
  productionId: z.string(),
  /** Mã seller (in dòng "Seller:"). */
  userSku: z.string().optional(),
  /** Merchant ID trên label. */
  orderId: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  quantity: z.number().optional(),
  mockupUrl: z.string().optional(),
  /** Tên xưởng gửi — resolve từ `factoryId`. */
  factoryName: z.string().optional(),
  /** SKU biến thể ĐẦY ĐỦ khớp size (vd `PAOPPOLO-SAME-DESIGN-3XL`) — KHÁC
   *  `BarcodeLabel.sku` (đã gọt đuôi size). Không khớp → SKU cấp sản phẩm. */
  sku: z.string().optional(),
  /** Cân nặng GRAM: `order.weight` ?? biến thể khớp size ?? default sản phẩm. */
  weightGram: z.number().optional(),
  shippingAddress: ProductionOrderShippingAddressZod.optional(),
});
export type ShippingLabel = z.infer<typeof ShippingLabelZod>;
export const GetShippingLabelsResZod = ResZod.extend({ data: z.array(ShippingLabelZod) });
export class GetShippingLabelsResDto extends createZodDto(extendApi(GetShippingLabelsResZod)) {}

/**
 * Xuất 1 file PDF gộp label THẬT của carrier (USPS…) cho N đơn tick chọn
 * (Orders.md §16.9) — KHÔNG phải bản nội bộ "DO NOT SHIP" ở trên. Mỗi label
 * 1 trang, thứ tự trang = thứ tự tick; nguồn = file đã mua qua VNP
 * (`vnpShipment.labelUrl`) hoặc khách tự cấp ORD-26 (`tracking.labelUrl`).
 * Trần 200/lượt — mỗi label phải TẢI VỀ từ CDN/Drive, nặng hơn hẳn 500 của in tem.
 */
export const ExportShippingLabelsZod = z.object({
  ids: z.array(IDZod).min(1).max(200),
});
export class ExportShippingLabelsDto extends createZodDto(extendApi(ExportShippingLabelsZod)) {}
export const LabelSkipReasonZod = z.enum(['not-found', 'no-label', 'fetch-failed', 'unsupported-format']);
export const ExportShippingLabelsResDataZod = z.object({
  /** null = không đơn nào có label dùng được (xem `skipped`). */
  pdfBase64: z.string().nullable(),
  pageCount: z.number(),
  /** Số label đã vào file (1 label PDF nhiều trang vẫn đếm 1). */
  labelCount: z.number(),
  /** productionId các item CHUNG KIỆN với item đứng trước — đã gộp trang, không phải lỗi. */
  merged: z.array(z.string()),
  skipped: z.array(z.object({ productionId: z.string(), reason: LabelSkipReasonZod })),
});
export type ExportShippingLabelsRes = z.infer<typeof ExportShippingLabelsResDataZod>;
export const ExportShippingLabelsResZod = ResZod.extend({ data: ExportShippingLabelsResDataZod });
export class ExportShippingLabelsResDto extends createZodDto(extendApi(ExportShippingLabelsResZod)) {}

export const TransferOrderResZod = ResZod.extend({
  data: z.object({ matched: z.number(), modified: z.number() }),
});
export class TransferOrderResDto extends createZodDto(extendApi(TransferOrderResZod)) {}

/**
 * Initial-assign factory (+ optional setup fields) cho 1 hoặc nhiều đơn chưa
 * map xưởng (`factoryId` null). Khác bulk-transfer ở chỗ: chỉ áp dụng cho đơn
 * UNMAPPED, set luôn `originalFactoryId = factoryId` (đơn coi là "thuần" gốc
 * tại xưởng này), và gộp set 4 trường tuỳ chọn (loại vải/phòng/máy/tool) trong
 * 1 update + 1 log entry/đơn.
 *
 * Đơn đã có factory thì dùng `bulk-transfer` (route riêng) — endpoint này sẽ
 * skip đơn đã mapped trong `matched` count.
 */
export const BulkAssignOrderZod = z.object({
  ids: IDZod.array().min(1),
  factoryId: IDZod,
  fabricType: z.string().optional(),
  machineTypeId: IDZod.optional(),
  machineNumber: z.string().optional(),
  toolResult: z.string().optional(),
  reason: z.string().max(200).optional(),
});
export class BulkAssignOrderDto extends createZodDto(extendApi(BulkAssignOrderZod)) {}

export const BulkAssignOrderResZod = ResZod.extend({
  data: z.object({ matched: z.number(), modified: z.number() }),
});
export class BulkAssignOrderResDto extends createZodDto(extendApi(BulkAssignOrderResZod)) {}

/**
 * Nút "Tự động gán xưởng" ở trang Không xác định xưởng (Orders.md §19): re-map
 * TOÀN BỘ đơn unmapped theo Product Config hiện tại (khớp `type` ↔ `fullName`
 * exact case-insensitive, gán đủ bộ như lúc import). `scanned` = tổng đơn
 * unmapped lúc quét, `matchedTypes` = số loại sản phẩm khớp config có xưởng,
 * `assigned` = số đơn đã gán.
 */
export const RemapUnmappedOrdersResZod = ResZod.extend({
  data: z.object({ scanned: z.number(), matchedTypes: z.number(), assigned: z.number() }),
});
export class RemapUnmappedOrdersResDto extends createZodDto(extendApi(RemapUnmappedOrdersResZod)) {}

//
// Factory overview — used by the new "Đơn hàng theo xưởng" dashboard tab.
//

/** Option list shown in the factory tab filter selects + Summary breakdowns. */
export const FactoryFilterOptionZod = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number(),
});
export type FactoryFilterOption = z.infer<typeof FactoryFilterOptionZod>;

export const FactoryOverviewCellZod = z.object({
  factoryId: z.string(),
  factoryName: z.string(),
  factoryShortName: z.string().optional(),
  /** Total orders CURRENTLY producing here. */
  total: z.number(),
  /** Pure orders (no transfer) currently here. */
  pure: z.number(),
  /** Orders received from other factories (transferred in). */
  transferredIn: z.number(),
  /** Orders that ORIGINATED here but are now elsewhere (transferred out). */
  transferredOut: z.number(),
  /** Distinct `type` values currently here. */
  productCount: z.number(),
  /** Distinct `fabricType` values currently here. */
  fabricCount: z.number(),
  /** Distinct `machineTypeId` values currently here — semantically "Phòng" / loại máy in. */
  machineCount: z.number(),
  /** Distinct `machineNumber` values currently here — số máy thực (94, 27, 56…). */
  actualMachineCount: z.number(),
  /** Orders here whose `toolResult` resolves to a "has tool" code. */
  withToolCount: z.number(),
  /** Đã in xong — printStatus là 1 trong PRINTED_MACHINE_CODES. */
  printedCount: z.number(),
  /** Đang in — printStatus tồn tại nhưng không phải done code. */
  printingCount: z.number(),
  /** Chưa in — printStatus null/empty. */
  notPrintedCount: z.number(),
  /** Lỗi xưởng — productionError tồn tại và khác empty. Disjoint với 3 print stage. */
  errorCount: z.number(),
  /** Design đã được gán designer (designerStatus ≠ unassigned/null). được gán + chưa gán = total. */
  designAssignedCount: z.number(),
  /** Design chưa gán designer (designerStatus unassigned/null). */
  designUnassignedCount: z.number(),
  /** Design đã xong (designerStatus = done). đã xong + chưa xong = total. */
  designDoneCount: z.number(),
  /** Design chưa xong (designerStatus ≠ done). */
  designNotDoneCount: z.number(),
  /** Top-N per-dimension breakdowns used by the Summary sub-tab. */
  breakdowns: z.object({
    products: FactoryFilterOptionZod.array(),
    fabrics: FactoryFilterOptionZod.array(),
    sizes: FactoryFilterOptionZod.array(),
    toolResults: FactoryFilterOptionZod.array(),
  }),
});
export type FactoryOverviewCell = z.infer<typeof FactoryOverviewCellZod>;

export const FactoryFlowZod = z.object({
  fromFactoryId: z.string(),
  fromName: z.string(),
  fromShortName: z.string().optional(),
  toFactoryId: z.string(),
  toName: z.string(),
  toShortName: z.string().optional(),
  count: z.number(),
  totalQuantity: z.number(),
});
export type FactoryFlow = z.infer<typeof FactoryFlowZod>;

export const FactoryOverviewZod = z.object({
  factories: FactoryOverviewCellZod.array(),
  /** Danh sách xưởng ĐẦY ĐỦ (bảng `factories`, đang bật) cho các select — thẻ
   *  `factories` ở trên chỉ có xưởng đang giữ đơn nên không dùng làm option. */
  factoryOptions: FactoryOptionZod.array(),
  flows: FactoryFlowZod.array(),
  totals: z.object({
    total: z.number(),
    transferred: z.number(),
    pure: z.number(),
  }),
  /** Distinct values within the date range — used to populate filter selects. */
  availableFilters: z.object({
    products: FactoryFilterOptionZod.array(),
    fabrics: FactoryFilterOptionZod.array(),
    toolResults: FactoryFilterOptionZod.array(),
    /** machineTypeId — semantically "Phòng" (loại máy in). */
    machineTypes: FactoryFilterOptionZod.array(),
    /** workshop_config.machine codes — số máy thực. */
    machines: FactoryFilterOptionZod.array(),
    /** workshop_config.tool_result_note codes — cột "Note kq Tool". */
    toolResultNotes: FactoryFilterOptionZod.array(),
    /** userSku (khách sở hữu đơn) — top theo số đơn trong kỳ. */
    users: FactoryFilterOptionZod.array(),
  }),
});
export type FactoryOverview = z.infer<typeof FactoryOverviewZod>;

export const GetFactoryOverviewZod = z.object({
  // Date range on `orderAt` — tên giữ để URL không phá. Xem comment ở
  // GetProductionOrdersZod.
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  /**
   * When set, scopes the filter dropdowns (`availableFilters`) to orders
   * currently at this factory. The 3 factory cards + flow matrix stay
   * unscoped so the global view is preserved.
   */
  factoryId: z.string().optional(),
  /**
   * Optional — further scope `availableFilters` by print pipeline stage so
   * dropdowns only show products/fabrics/etc that exist in that stage at
   * the selected factory. Same enum as `printStage` on list endpoint.
   */
  printStage: z.enum(['printed', 'printing', 'not-printed']).optional(),
  /**
   * Optional — scope `availableFilters` chỉ về đơn có lỗi xưởng (Phase 8).
   * Mutually exclusive với printStage trên FE (chip "Lỗi xưởng" thay vị trí
   * "Đang in"). `true` → `productionError $exists & != ''`.
   *
   * Dùng `BooleanFlagZod` giống bản khai ở `GetProductionOrdersZod` — CÙNG TÊN
   * CỜ thì phải CÙNG HÀNH VI. Để một bản phân giải đúng và một bản còn bẫy
   * `false → true` là mời lỗi quay lại dưới vỏ bọc khó ngờ nhất: cùng một
   * tham số, hai endpoint, hai kết quả (ORD-23).
   */
  hasError: BooleanFlagZod,
  /**
   * Optional — scope tất cả `availableFilters` về đơn chưa map xưởng. Mutually
   * exclusive với `factoryId`/`printStage`/`hasError` trên FE (chip "Chưa xác
   * định xưởng" thay cho chip xưởng).
   *
   * `BooleanFlagZod` — cùng lý do như `hasError` ngay trên (ORD-23).
   */
  unmapped: BooleanFlagZod,
  /**
   * Faceted select filters — used to narrow OTHER `availableFilters` so the
   * dropdown counts reflect the current cross-filter scope. Each facet excludes
   * its own field when computing its options (so user can switch values).
   */
  type: z.string().optional(),
  fabricType: z.string().optional(),
  toolResult: z.string().optional(),
  /** workshop_config codes (category=tool_result_note) — cột "Note kq Tool". */
  toolResultNote: z.string().optional(),
  /** userSku (khách sở hữu đơn) — CSV. Lọc bảng đơn + thu hẹp dropdown. */
  userSku: z.string().optional(),
  machineTypeId: z.string().optional(),
  machineNumber: z.string().optional(),
});
export class GetFactoryOverviewDto extends createZodDto(extendApi(GetFactoryOverviewZod)) {}

export const GetFactoryOverviewResZod = ResZod.extend({ data: FactoryOverviewZod });
export class GetFactoryOverviewResDto extends createZodDto(extendApi(GetFactoryOverviewResZod)) {}

/**
 * Faceted filter options cho workshop table view. BE compute count theo
 * cross-facet (loại trừ chính facet đó khỏi filter để user thấy được tất cả
 * lựa chọn của facet đó nhưng các facet khác đã narrow theo selection).
 *
 * Khai báo cuối file vì phụ thuộc `FactoryFilterOptionZod` (định nghĩa ở mục
 * Factory overview). Tsup bundle theo thứ tự source — đặt trước sẽ sinh
 * `Cannot read properties of undefined (reading 'array')` lúc require.
 */
export const WorkshopAvailableFiltersResZod = ResZod.extend({
  data: z.object({
    printStatus: FactoryFilterOptionZod.array(),
    toolResultNote: FactoryFilterOptionZod.array(),
    /** label = user.fullName (đã resolve); value = user._id; token `__none__` cho đơn chưa gán. */
    assignee: FactoryFilterOptionZod.array(),
    productionError: FactoryFilterOptionZod.array(),
    fabricType: FactoryFilterOptionZod.array(),
    machineNumber: FactoryFilterOptionZod.array(),
    toolResult: FactoryFilterOptionZod.array(),
    errorFile: FactoryFilterOptionZod.array(),
    /** Designer state — value = DesignerStatus, label hiển thị tiếng Việt. */
    designerStatus: FactoryFilterOptionZod.array(),
    /** Tên sản phẩm (type) — value = label = type. Dùng cho bảng phẳng trang "In". */
    type: FactoryFilterOptionZod.array().optional(),
    /** SKU khách (userSku) — value = label = userSku. Dùng cho bảng phẳng trang "In". */
    userSku: FactoryFilterOptionZod.array().optional(),
    /** Số đơn đang GIỮ (heldAt set) trong scope filter hiện tại — cho toggle "Đang giữ" workshop. */
    heldCount: z.number().optional(),
    /** Số đơn ĐÃ HỦY (cancelledAt set) trong scope filter hiện tại — cho toggle "Đã hủy" workshop. */
    cancelledCount: z.number().optional(),
    /** Số đơn theo CHẶNG hiện tại (khóa `WORKSHOP_STAGE_FILTER_KEYS`), bỏ qua chính filter `workshopStage` — ô phễu. */
    stageCounts: z.record(z.number()).optional(),
    /** Số đơn theo xưởng, bỏ qua chính filter `factoryId` — nút chọn xưởng trên thanh công cụ. */
    factoryCounts: z
      .array(z.object({ factoryId: z.string(), shortName: z.string().optional(), name: z.string().optional(), count: z.number() }))
      .optional(),
    /** Số đếm cho dải pill trạng thái — mỗi số bỏ qua chính filter mà pill đó bật. */
    pillCounts: z
      .object({
        /** errorFile có ít nhất 1 mã. */
        errorFile: z.number(),
        /** toolResult đã soát và KHÔNG thuộc nhóm "Có tool" (mirror `useIsNoTool`). */
        noTool: z.number(),
        /** toolResult còn trống (chưa soát). */
        unreviewed: z.number(),
        /** priority có đặt (1..3). */
        priority: z.number(),
        /** designerStatus ∈ assigned / in-progress / rework — nút "Tồn thiết kế". */
        designBacklog: z.number(),
      })
      .optional(),
    /**
     * Thống kê theo LOẠI SẢN PHẨM cho rail bên trái (bản 3, Orders.md §10.2c): số đơn, tổng số
     * lượng, số đơn theo chặng (khóa `WORKSHOP_STAGE_FILTER_KEYS`). Bỏ qua chính filter `type`
     * (cross-facet) — chọn 1 loại vẫn thấy đủ danh sách loại. `type` rỗng = đơn chưa có tên loại.
     */
    typeStats: z
      .array(z.object({ type: z.string(), orders: z.number(), qty: z.number(), stages: z.record(z.number()) }))
      .optional(),
    /** Tổng đơn + số loại sản phẩm khớp TOÀN BỘ filter hiện tại (dòng tổng dưới phễu). */
    totalOrders: z.number().optional(),
    totalTypes: z.number().optional(),
  }),
});
export class WorkshopAvailableFiltersResDto extends createZodDto(extendApi(WorkshopAvailableFiltersResZod)) {}
export type WorkshopAvailableFilters = z.infer<typeof WorkshopAvailableFiltersResZod>['data'];

/**
 * Body của `POST /v1/orders/:id/designer-transition`. Server validate action
 * hợp lệ với state hiện tại + owner constraint (sub-designer chỉ transition
 * task có `assignee === user.assigneeCode`). Side effects (auto set toolResultNote,
 * increment reworkCount, log…) handle ở `DesignerTaskService`.
 */
export const DesignerTransitionZod = z.object({
  action: DesignerTransitionActionZod,
  /** Lý do (tùy chọn) khi action='reject'. */
  reason: z.string().max(500).optional(),
  /**
   * BẮT BUỘC khi action='reject' — user._id của designer nhận thay. Đơn được
   * gán thẳng sang người này (designerStatus='assigned'), không còn state
   * `rejected`. Server validate là sub-designer đang Active, khác chính mình.
   */
  targetUserId: IDZod.optional(),
});
export class DesignerTransitionDto extends createZodDto(extendApi(DesignerTransitionZod)) {}

export const DesignerTransitionResZod = ResZod.extend({ data: ProductionOrderZod });
export class DesignerTransitionResDto extends createZodDto(extendApi(DesignerTransitionResZod)) {}

//
// Error log tab — danh sách đơn đang ở trạng thái lỗi xưởng (productionError
// set, toolResultNote chưa 'ok'), sort theo productionFirstErrorAt ASC để đơn
// nằm lâu nhất hiển thị đầu tiên. Mức độ khẩn cấp tính client-side từ
// productionFirstErrorAt theo ngưỡng 24h/48h/72h.
//

export const ERROR_LOG_URGENCY_LEVELS = ['new', 'attention', 'urgent', 'critical'] as const;
export type ErrorLogUrgency = (typeof ERROR_LOG_URGENCY_LEVELS)[number];
export const ErrorLogUrgencyZod = z.enum(ERROR_LOG_URGENCY_LEVELS);

export const ERROR_LOG_TABS = ['todo', 'done'] as const;
export type ErrorLogTab = (typeof ERROR_LOG_TABS)[number];

export const GetErrorLogZod = PageQueryZod.extend({
  /**
   * Tab theo góc nhìn CHẶNG của người xem:
   *  - `todo` (mặc định): lỗi chặng mình cần xử lý / đang chờ đơn quay lại.
   *  - `done`: lỗi chặng mình đã xử lý xong (giới hạn 14 ngày gần nhất).
   */
  tab: z.enum(ERROR_LOG_TABS).optional(),
  /** Comma-separated user._id của designer được gán đơn (`__none__` cho đơn chưa gán). */
  assignee: z.string().optional(),
  /** Comma-separated workshop_config codes (fabric_type). */
  fabricType: z.string().optional(),
  /** Comma-separated workshop_config codes (tool_result). */
  toolResult: z.string().optional(),
  /** Comma-separated workshop_config codes (production_error). */
  productionError: z.string().optional(),
  /** Comma-separated 'designer' | 'factory'. */
  productionErrorSource: z.string().optional(),
  /** Comma-separated factoryIds. */
  factoryId: z.string().optional(),
  /** Comma-separated urgency level. */
  urgency: z.string().optional(),
  /** Date range theo `inProductionAt` (VN tz) — đồng bộ với các bảng order
   *  khác đã dùng `inProductionAt` thay cho `orderAt`. */
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
});
export class GetErrorLogDto extends createZodDto(extendApi(GetErrorLogZod)) {}

export const GetErrorLogResZod = PageResZod.extend({
  data: ProductionOrderZod.array(),
  /** Tổng theo mức độ khẩn (bỏ qua pagination). */
  byUrgency: z.object({
    new: z.number(),
    attention: z.number(),
    urgent: z.number(),
    critical: z.number(),
  }),
});
export class GetErrorLogResDto extends createZodDto(extendApi(GetErrorLogResZod)) {}

// Admin/Manager đánh dấu hoàn thành lỗi hàng loạt.
export const BulkResolveErrorZod = z.object({ ids: IDZod.array().min(1) });
export class BulkResolveErrorDto extends createZodDto(extendApi(BulkResolveErrorZod)) {}

export const BulkResolveErrorResZod = ResZod.extend({ data: z.object({ modified: z.number() }) });
export class BulkResolveErrorResDto extends createZodDto(extendApi(BulkResolveErrorResZod)) {}

//
// ─── Fulfillment workflow ─────────────────────────────────────────
//

/**
 * Body của `POST /v1/orders/:id/fulfillment-transition`.
 *
 * State machine theo `(stage, action, currentStatus)`:
 *   start        : waiting/rework → in-progress (assignee = current user, BE check)
 *   complete     : in-progress    → done        (cộng workMs, auto-advance stage tiếp)
 *   rework-back  : in-progress    → waiting     (reporter giữ assignee)
 *                                target stage   → rework, các stage trung gian → rework
 *                                currentFulfillmentStage = target
 *                                target='designer' → reuse designer rework flow
 *
 * Validate ở BE: action='rework-back' yêu cầu `target` + `reason`. Target nếu
 * là FulfillmentStage thì phải có index < current stage; nếu là 'designer'
 * thì set productionErrorSource='designer'.
 */
export const FulfillmentTransitionZod = z.object({
  stage: FulfillmentStageZod,
  action: FulfillmentTransitionActionZod,
  /** Required khi action='rework-back': 'designer' hoặc FulfillmentStage trước stage hiện tại. */
  target: z.union([z.literal('designer'), FulfillmentStageZod]).optional(),
  /** Required khi action='rework-back'. */
  reason: z.string().max(500).optional(),
  /**
   * Cân THỰC TẾ của kiện, gram — chỉ dùng khi hoàn thành công đoạn Đóng hàng.
   * TUỲ CHỌN theo chốt nghiệp vụ 17/09/2026: trạm chưa có cân điện tử vẫn phải
   * đóng được hàng, kiện thiếu cân bị đánh dấu ở báo cáo chứ không chặn chuyền.
   */
  weightGram: z.coerce.number().min(0).max(100_000).optional(),
  /** Số đo thực tế (cm) đi kèm cân — dùng để tính cân quy đổi khi đối soát cước. */
  dimensions: z
    .object({
      width: z.coerce.number().min(0).max(500).optional(),
      height: z.coerce.number().min(0).max(500).optional(),
      length: z.coerce.number().min(0).max(500).optional(),
    })
    .optional(),
});
export class FulfillmentTransitionDto extends createZodDto(extendApi(FulfillmentTransitionZod)) {}

export const FulfillmentTransitionResZod = ResZod.extend({ data: ProductionOrderZod });
export class FulfillmentTransitionResDto extends createZodDto(extendApi(FulfillmentTransitionResZod)) {}

/**
 * POST `/v1/fulfillment/bulk-transition` — bulk N đơn trong 1 request (chọn cả
 * cột ở kanban). BE loop `transition()` TỪNG đơn để giữ đủ business hook
 * (timeline, auto-advance luồng rút gọn, stock-out, webhook) — không updateMany
 * mù. `start-complete` = start rồi complete từng đơn (start fail — vd đơn vừa
 * được start chỗ khác — vẫn thử complete, kết quả do complete quyết định).
 */
export const BulkFulfillmentTransitionZod = z.object({
  stage: FulfillmentStageZod,
  action: z.enum(['start', 'complete', 'start-complete']),
  orderIds: z.array(IDZod).min(1).max(1000),
});
export class BulkFulfillmentTransitionDto extends createZodDto(extendApi(BulkFulfillmentTransitionZod)) {}

export const BulkFulfillmentTransitionResZod = ResZod.extend({
  data: z.object({
    ok: z.number(),
    fail: z.number(),
    /** Đơn lỗi kèm message (vd sai trạng thái, đơn đang giữ) — FE hiện toast warning. */
    failures: z.array(z.object({ orderId: z.string(), message: z.string() })),
  }),
});
export class BulkFulfillmentTransitionResDto extends createZodDto(extendApi(BulkFulfillmentTransitionResZod)) {}

/**
 * POST `/v1/fulfillment/complete-pack-backlog` — nút "Hoàn thành đơn tồn" đi
 * kèm toggle `FactoryEntity.autoCompletePack` (toggle chỉ áp đơn MỚI chảy tới
 * Đóng hàng; đơn tồn cũ dọn 1 lần bằng nút này). CHỈ Admin/SuperAdmin.
 */
export const CompletePackBacklogZod = z.object({ factoryId: IDZod });
export class CompletePackBacklogDto extends createZodDto(extendApi(CompletePackBacklogZod)) {}

export const CompletePackBacklogResZod = ResZod.extend({
  data: z.object({
    /** Số đơn đang tồn ở Đóng hàng lúc bấm. */
    total: z.number(),
    ok: z.number(),
    fail: z.number(),
    failures: z.array(z.object({ orderId: z.string(), message: z.string() })),
  }),
});
export class CompletePackBacklogResDto extends createZodDto(extendApi(CompletePackBacklogResZod)) {}

/**
 * GET `/v1/fulfillment/my-tasks?tab=waiting|in-progress|rework|watching`.
 * Stage + factory tự suy từ user đang login (BE filter). User Manager/Admin
 * có thể override qua query `stage`/`factoryId`.
 */
export const FULFILLMENT_TASK_TABS = [
  'waiting',
  'in-progress',
  'rework',
  'done',
  /** Đã hoàn thành stage này NHƯNG từng bị đẩy về (reworkCount>0) = "Đã sửa". Tách khỏi `done`. */
  'fixed',
  'watching',
  /**
   * Đơn đã `readyForFulfill=true` nhưng chưa được gán vào Designer
   * (designerStatus = unassigned, currentFulfillmentStage chưa set). CHỈ visible
   * cho admin/manager — workers fulfillment không thấy tab này. Admin gán đơn
   * vào Designer cụ thể → đơn theo flow chuẩn (designer.complete → Print stage).
   */
  'unassigned',
] as const;
export type FulfillmentTaskTab = (typeof FULFILLMENT_TASK_TABS)[number];
export const FulfillmentTaskTabZod = z.enum(FULFILLMENT_TASK_TABS);

export const GetFulfillmentMyTasksZod = PageQueryZod.extend({
  tab: FulfillmentTaskTabZod.default('waiting'),
  /** Page size — kanban load full queue per cột (default 50, tối đa 5000). */
  size: z.coerce.number().optional(),
  /** Override (Manager/Admin). User Fulfillment không cần set. */
  stage: FulfillmentStageZod.optional(),
  factoryId: IDZod.optional(),
  /**
   * Date range filter trên `inProductionAt` (YYYY-MM-DD, VN local). Match
   * semantic của `GetProductionOrdersZod.createdFrom/To` để 2 page (My Tasks
   * + Factory Tab) cùng scope. BE default = 7 ngày khi cả 2 đều empty;
   * empty string truyền lên = user clear → all-time.
   */
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
});
export class GetFulfillmentMyTasksDto extends createZodDto(extendApi(GetFulfillmentMyTasksZod)) {}

// ─── Fulfillment daily overview (bảng tổng quan theo ngày per-stage) ─────────
export const GetFulfillmentDailyOverviewZod = z.object({
  days: z.enum(['7', '14', '30']).default('7'),
  /** Khoảng tùy biến (YYYY-MM-DD, VN) — nếu truyền cả 2 thì dùng thay `days`. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** Override stage (Manager/Admin). Worker suy từ `user.fulfillmentStage`. */
  stage: FulfillmentStageZod.optional(),
});
export class GetFulfillmentDailyOverviewDto extends createZodDto(extendApi(GetFulfillmentDailyOverviewZod)) {}

/**
 * Metric 1 stage fulfillment trong 1 ngày (phân loại theo
 * `fulfillmentStages.<stage>.status` HIỆN TẠI):
 *   arrived   = mọi đơn cohort đã TỪNG tới stage này (done + remaining + rework)
 *   done      = status 'done'
 *   remaining = status waiting/in-progress
 *   rework    = status 'rework' (stage sau đẩy về, lỗi cần sửa)
 *   fixed     = status 'done' MÀ reworkCount>0 (đã hoàn thành sau khi sửa lỗi)
 */
export const FulfillmentStageMetricZod = z.object({
  arrived: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  rework: z.number().int().nonnegative(),
  fixed: z.number().int().nonnegative(),
});
export type FulfillmentStageMetric = z.infer<typeof FulfillmentStageMetricZod>;

/**
 * 1 ngày trong bảng tổng quan Fulfillment (full luồng). Gom theo `inProductionAt`
 * (VN), lọc theo xưởng của user. Mỗi ngày bung ra tất cả khâu:
 *   total          = tổng đơn có inProductionAt ngày đó
 *   toolReviewed   = đã soát (toolResultNote ∉ {null,''})
 *   toolUnreviewed = chưa soát (toolResultNote ∈ {null,''})
 *   toolOk         = toolResultNote === 'ok'
 *   designerReceived = designerStatus ≠ 'unassigned' (đã được giao)
 *   designerDone     = designerStatus === 'done'
 *   designerRework   = designerStatus === 'rework' (lỗi designer cần sửa)
 *   stages         = { <stage>: FulfillmentStageMetric } cho cả 6 stage
 */
export const FulfillmentDailyRowZod = z.object({
  day: z.string(),
  total: z.number().int().nonnegative(),
  toolReviewed: z.number().int().nonnegative(),
  toolUnreviewed: z.number().int().nonnegative(),
  toolOk: z.number().int().nonnegative(),
  designerReceived: z.number().int().nonnegative(),
  designerDone: z.number().int().nonnegative(),
  designerRework: z.number().int().nonnegative(),
  /** designerStatus === 'done' MÀ designerReworkCount>0 = "Đã sửa". */
  designerFixed: z.number().int().nonnegative(),
  stages: z.record(z.string(), FulfillmentStageMetricZod),
});
export type FulfillmentDailyRow = z.infer<typeof FulfillmentDailyRowZod>;

export const FulfillmentDailyColumnTotalsZod = z.object({
  total: z.number().int().nonnegative(),
  toolReviewed: z.number().int().nonnegative(),
  toolUnreviewed: z.number().int().nonnegative(),
  toolOk: z.number().int().nonnegative(),
  designerReceived: z.number().int().nonnegative(),
  designerDone: z.number().int().nonnegative(),
  designerRework: z.number().int().nonnegative(),
  /** designerStatus === 'done' MÀ designerReworkCount>0 = "Đã sửa". */
  designerFixed: z.number().int().nonnegative(),
  stages: z.record(z.string(), FulfillmentStageMetricZod),
});
export type FulfillmentDailyColumnTotals = z.infer<typeof FulfillmentDailyColumnTotalsZod>;

export const FulfillmentDailyOverviewResZod = ResZod.extend({
  data: z.object({
    /** Cột ngày (mới→cũ; FE reverse để cũ→mới). */
    days: FulfillmentDailyRowZod.array(),
    columnTotals: FulfillmentDailyColumnTotalsZod,
    rangeDays: z.number().int().nonnegative(),
  }),
});
export class FulfillmentDailyOverviewResDto extends createZodDto(extendApi(FulfillmentDailyOverviewResZod)) {}

export const GetFulfillmentMyTasksResZod = PageResZod.extend({
  data: ProductionOrderZod.array(),
  /** Tab counters (6 tab) — bỏ qua pagination. `unassigned` = 0 với worker
   *  fulfillment (chỉ admin/manager thấy). */
  tabCounts: z.object({
    waiting: z.number(),
    inProgress: z.number(),
    rework: z.number(),
    done: z.number(),
    fixed: z.number(),
    watching: z.number(),
    unassigned: z.number(),
  }),
});
export class GetFulfillmentMyTasksResDto extends createZodDto(extendApi(GetFulfillmentMyTasksResZod)) {}

/**
 * Admin team queue (`GET /v1/fulfillment/team/queue?factoryId=`).
 * Trả về 5 column × N order mỗi column (cap 100 / column).
 */
export const FulfillmentQueueColumnZod = z.object({
  stage: FulfillmentStageZod,
  /** = users{factoryId, fulfillmentStage}._id (1 user duy nhất hoặc null nếu chưa gán). */
  workerId: z.string().optional(),
  workerName: z.string().optional(),
  /** Counts mỗi status. */
  counts: z.object({
    waiting: z.number(),
    inProgress: z.number(),
    rework: z.number(),
    done: z.number(),
  }),
  /** Top 100 orders theo orderAt DESC. */
  orders: ProductionOrderZod.array(),
});
export type FulfillmentQueueColumn = z.infer<typeof FulfillmentQueueColumnZod>;

export const GetFulfillmentQueueZod = z.object({
  factoryId: IDZod,
});
export class GetFulfillmentQueueDto extends createZodDto(extendApi(GetFulfillmentQueueZod)) {}

export const GetFulfillmentQueueResZod = ResZod.extend({
  data: z.object({
    factoryId: z.string(),
    factoryName: z.string().optional(),
    columns: FulfillmentQueueColumnZod.array(),
  }),
});
export class GetFulfillmentQueueResDto extends createZodDto(extendApi(GetFulfillmentQueueResZod)) {}

/** Stats — throughput per period (morning/noon/evening hoặc daily/weekly). */
export const FulfillmentStageStatRowZod = z.object({
  stage: FulfillmentStageZod,
  received: z.number(),
  inProgress: z.number(),
  done: z.number(),
  reworkOut: z.number(),
  reworkIn: z.number(),
  avgWorkMs: z.number(),
  backlog: z.number(),
});
export type FulfillmentStageStatRow = z.infer<typeof FulfillmentStageStatRowZod>;

export const GetFulfillmentStatsZod = z.object({
  factoryId: IDZod.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export class GetFulfillmentStatsDto extends createZodDto(extendApi(GetFulfillmentStatsZod)) {}

export const GetFulfillmentStatsResZod = ResZod.extend({
  data: z.object({
    perStage: FulfillmentStageStatRowZod.array(),
    /** Avg cycle time (ms) toàn flow: designerCompletedAt → fulfillmentCompletedAt. */
    avgTotalCycleMs: z.number(),
    /** Đơn pack.done trong range. */
    completedCount: z.number(),
  }),
});
export class GetFulfillmentStatsResDto extends createZodDto(extendApi(GetFulfillmentStatsResZod)) {}

// ─── Lifecycle Overview (dashboard Vòng đời đơn) ──────────────────
// Phễu 8 chặng: Soát tool → Thiết kế → In → Ép → QC sau ép → May nhận →
// May xuất → Đóng hàng. Mỗi chặng đo snapshot (đang chứa/đang làm/
// rework/lỗi) + throughput theo kỳ (hoàn thành + thời gian TB). Xem
// `documents/FunctionDescription/OrderLifecycle.md`.

/** Khóa chặng — 'tool-check' + 'designer' + 6 FulfillmentStage. */
export const LIFECYCLE_STAGE_KEYS = [
  'tool-check',
  'designer',
  'print',
  'press',
  'qc-post-press',
  'sew-in',
  'sew-out',
  'pack',
] as const;
export type LifecycleStageKey = (typeof LIFECYCLE_STAGE_KEYS)[number];

/**
 * Hạn dự kiến cho từng bước = thời điểm đơn VÀO bước đó + số giờ ở đây, theo
 * (mức ưu tiên, bước). Trước mắt đặt đồng loạt 4 tiếng cho mọi bước/mức —
 * tinh chỉnh sau bằng cách sửa trực tiếp map này (không cần đổi code gọi).
 */
export const DEFAULT_STAGE_ESTIMATE_HOURS = 4;
export const ORDER_PRIORITY_STAGE_ESTIMATE_HOURS: Record<
  OrderPriority,
  Record<LifecycleStageKey, number>
> = Object.fromEntries(
  ORDER_PRIORITIES.map((p) => [
    p,
    Object.fromEntries(LIFECYCLE_STAGE_KEYS.map((k) => [k, DEFAULT_STAGE_ESTIMATE_HOURS])),
  ]),
) as Record<OrderPriority, Record<LifecycleStageKey, number>>;

export const LifecycleStageRowZod = z.object({
  stage: z.string(),
  label: z.string(),
  /** Đang chờ tại chặng này (snapshot). Tool-check = số đơn chưa soát. */
  backlog: z.number(),
  /**
   * Đã tới công đoạn nhưng worker CHƯA bấm Bắt đầu (chờ nhận task).
   * Designer = `assigned` (đã giao, sub chưa nhận); Fulfillment = `waiting`
   * (= backlog); Tool-check = 0 (không có khái niệm nhận task).
   */
  waitingToStart: z.number(),
  /** Đang làm (snapshot). Tool-check không có → 0. */
  inProgress: z.number(),
  /** Đang rework (snapshot). */
  rework: z.number(),
  /** Đang lỗi tại chặng (snapshot). */
  error: z.number(),
  /** Đã hoàn thành chặng trong kỳ (throughput theo date range). */
  doneInRange: z.number(),
  /** Tổng đơn đã từng qua chặng này (cumulative snapshot). Tool-check = đã soát. */
  passedTotal: z.number(),
  /** Thời gian hoàn thành TB (ms) của các đơn done trong kỳ. 0 nếu N/A. */
  avgWorkMs: z.number(),
});
export type LifecycleStageRow = z.infer<typeof LifecycleStageRowZod>;

export const LifecycleTimelineBucketZod = z.object({
  date: z.string(), // YYYY-MM-DD (VN tz)
  completed: z.number(),
});
export type LifecycleTimelineBucket = z.infer<typeof LifecycleTimelineBucketZod>;

export const LifecycleOverviewZod = z.object({
  stages: LifecycleStageRowZod.array(),
  totals: z.object({
    /** Tổng đơn trong tập đã lọc (theo ngày vào SX + xưởng). */
    totalOrders: z.number(),
    /** Đơn còn trong pipeline (chưa pack done, chưa hủy). */
    totalActive: z.number(),
    /** Đơn TRONG COHORT (inProductionAt ∈ kỳ) đã đóng hàng xong — không lọc
     * thêm theo ngày hoàn thành. Bất biến: totalOrders = totalActive + số này. */
    completedInRange: z.number(),
    /** Cycle time TB toàn flow (ms): designerFirstStartedAt/createdAt → fulfillmentCompletedAt. */
    avgTotalCycleMs: z.number(),
    /** Chặng tắc nghẽn (backlog lớn nhất) — null nếu pipeline rỗng. */
    bottleneckStage: z.string().nullable(),
    /** Số đơn HỦY (cancelledAt set) trong cùng window inProductionAt + xưởng.
     * Đã loại khỏi funnel; đây là số thống kê riêng. */
    cancelledInRange: z.number(),
  }),
  /** Line chart: số đơn hoàn thành toàn flow mỗi ngày trong kỳ. */
  completionTimeline: LifecycleTimelineBucketZod.array(),
  /** Options cho dropdown lọc xưởng — ĐỦ xưởng đang bật (trừ xưởng ngoài luồng
   *  sản xuất), gộp thêm xưởng đang giữ đơn dù đã tắt. */
  factories: z.object({ factoryId: z.string(), factoryName: z.string() }).array(),
  /** Options cho combobox lọc khách (khách có đơn trong scope, nhiều đơn nhất trước, cap 300). */
  customers: z.object({ userSku: z.string(), userEmail: z.string(), count: z.number() }).array(),
  filter: z.object({ factoryId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }),
});
export type LifecycleOverview = z.infer<typeof LifecycleOverviewZod>;

export const GetLifecycleOverviewZod = z.object({
  factoryId: IDZod.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  /** Dòng sản phẩm (PRD-8) — tab dịch vụ ở Seller Hub Operations. */
  productLine: z.enum(PRODUCT_LINES).optional(),
  /** Lọc theo khách hàng (chọn từ `LifecycleOverviewZod.customers`) — khớp CHÍNH XÁC
   * `userSku` (+ `userEmail` nếu gửi kèm), case-insensitive. */
  userSku: z.string().optional(),
  userEmail: z.string().optional(),
});
export class GetLifecycleOverviewDto extends createZodDto(extendApi(GetLifecycleOverviewZod)) {}

export const GetLifecycleOverviewResZod = ResZod.extend({ data: LifecycleOverviewZod });
export class GetLifecycleOverviewResDto extends createZodDto(extendApi(GetLifecycleOverviewResZod)) {}

// ─── Cancelled orders drill-down (danh sách đơn hủy cho Dashboard) ──
// Bấm số "Đơn đã hủy" ở tab Stats / LifecycleStrip → mở modal list.
// Scope = cùng xưởng + khoảng `inProductionAt` như dashboard đang lọc.

export const GetCancelledOrdersZod = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  factoryId: IDZod.optional(),
  /** Lọc theo khách hàng — cùng ngữ nghĩa `GetLifecycleOverviewZod.userSku`/`userEmail`. */
  userSku: z.string().optional(),
  userEmail: z.string().optional(),
});
export class GetCancelledOrdersDto extends createZodDto(extendApi(GetCancelledOrdersZod)) {}

export const CancelledOrderRowZod = z.object({
  _id: z.string(),
  productionId: z.string(),
  type: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  userSku: z.string().optional(),
  cancelReason: z.string().optional(),
  cancelledAt: z.date().optional(),
  inProductionAt: z.date().optional(),
  /** Chặng fulfillment lúc bị hủy (null nếu chưa vào fulfillment). */
  currentFulfillmentStage: z.string().nullable().optional(),
  designerStatus: z.string().optional(),
});
export type CancelledOrderRow = z.infer<typeof CancelledOrderRowZod>;

export const GetCancelledOrdersResZod = ResZod.extend({
  data: CancelledOrderRowZod.array(),
  total: z.number(),
});
export class GetCancelledOrdersResDto extends createZodDto(extendApi(GetCancelledOrdersResZod)) {}

// ─── Lifecycle Track (tra cứu vòng đời 1 đơn theo productionId) ────
// Strip gọn trên đầu Dashboard: nhập productionId → hành trình đơn đó đã qua
// chặng nào / đang ở đâu. 8 chặng theo `LIFECYCLE_STAGE_KEYS`.

/** Trạng thái 1 chặng trong hành trình 1 đơn. */
export const LifecycleTrackStatusZod = z.enum(['done', 'current', 'pending', 'error', 'rework']);
export type LifecycleTrackStatus = z.infer<typeof LifecycleTrackStatusZod>;

export const LifecycleTrackStageZod = z.object({
  key: z.string(), // LifecycleStageKey
  label: z.string(),
  status: LifecycleTrackStatusZod,
  /** Mốc thời gian gắn với trạng thái (done→completedAt, current→startedAt/waitingAt). */
  at: z.date().optional(),
});
export type LifecycleTrackStage = z.infer<typeof LifecycleTrackStageZod>;

export const LifecycleTrackZod = z.object({
  productionId: z.string(),
  userSku: z.string().optional(),
  type: z.string().optional(),
  inProductionAt: z.date().optional(),
  fulfillmentCompletedAt: z.date().optional(),
  /** Khóa chặng đơn đang ở (null nếu đã hoàn thành toàn bộ flow). */
  currentStageKey: z.string().nullable(),
  /** Đã hoàn thành toàn bộ 8 chặng (pack done). */
  completed: z.boolean(),
  stages: LifecycleTrackStageZod.array(), // 8 phần tử theo LIFECYCLE_STAGE_KEYS
});
export type LifecycleTrack = z.infer<typeof LifecycleTrackZod>;

export const GetLifecycleTrackResZod = ResZod.extend({ data: LifecycleTrackZod });
export class GetLifecycleTrackResDto extends createZodDto(extendApi(GetLifecycleTrackResZod)) {}

// ─── Cutting File mapping (post-import flow) ──────────────────────
// User dán list Drive link → BE fetch tên file (public Drive page) → parse
// productionId từ filename (`BH-XXXXX-XXXXX-*`) → match đơn → trả về preview
// chi tiết. Bước 2 (Apply) chấp nhận overwrite flag để ghi đè đơn đã có file
// cũ. Xem `documents/FunctionDescription/Orders.md §Cutting File Mapping`.

// Pattern productionId trong filename: 2 chữ cái + "-" + 5 chữ số + "-" + 5 chữ số.
// 2 chữ cái KHÔNG cố định "BH" — có thể là bất kỳ A-Z (ML, TN, BH...).
// Ví dụ: `BH-96341-30608-M-BR-KL.pdf`, `ML-12345-67890-...`.
const CUTTING_FILE_PRODUCTION_ID_REGEX = /^([A-Z]{2}-\d{5}-\d{5})/i;
export function parseProductionIdFromCuttingFilename(filename: string): string | null {
  const id = filename.match(CUTTING_FILE_PRODUCTION_ID_REGEX)?.[1];
  return id ? id.toUpperCase() : null;
}

export const CuttingFileMatchedZod = z.object({
  link: z.string(),
  fileId: z.string(),
  fileName: z.string(),
  productionId: z.string(),
  orderId: IDZod,
  factoryId: IDZod.optional(),
  factoryName: z.string().optional(),
  machineTypeId: IDZod.optional(),
  machineTypeName: z.string().optional(),
  /** URL hiện tại nếu đơn đã có file cũ (để FE hiện cảnh báo + ghi đè). */
  existingCuttingFileUrl: z.string().optional(),
  existingCuttingFileName: z.string().optional(),
});
export type CuttingFileMatched = z.infer<typeof CuttingFileMatchedZod>;

export const CuttingFileNotFoundZod = z.object({
  link: z.string(),
  fileId: z.string(),
  fileName: z.string(),
  productionId: z.string(),
});
export type CuttingFileNotFound = z.infer<typeof CuttingFileNotFoundZod>;

export const CuttingFileInvalidZod = z.object({
  link: z.string(),
  /** Vì sao invalid: 'invalid-url' | 'fetch-failed' | 'parse-failed' | 'no-production-id'. */
  reason: z.enum(['invalid-url', 'fetch-failed', 'parse-failed', 'no-production-id']),
  fileName: z.string().optional(),
});
export type CuttingFileInvalid = z.infer<typeof CuttingFileInvalidZod>;

export const CuttingFileConflictZod = z.object({
  productionId: z.string(),
  links: z.string().array(),
});
export type CuttingFileConflict = z.infer<typeof CuttingFileConflictZod>;

export const CuttingFileBreakdownRowZod = z.object({
  /** factoryId nếu nhóm theo xưởng, machineTypeId nếu nhóm theo máy. */
  id: z.string().nullable(),
  name: z.string(),
  count: z.number(),
});
export type CuttingFileBreakdownRow = z.infer<typeof CuttingFileBreakdownRowZod>;

export const PreviewCuttingFilesZod = z.object({
  links: z.string().array().min(1).max(2000),
});
export class PreviewCuttingFilesDto extends createZodDto(extendApi(PreviewCuttingFilesZod)) {}

export const PreviewCuttingFilesResZod = ResZod.extend({
  data: z.object({
    matched: CuttingFileMatchedZod.array(),
    notFound: CuttingFileNotFoundZod.array(),
    invalid: CuttingFileInvalidZod.array(),
    /** Cùng 1 productionId xuất hiện ở > 1 link — user phải tự xóa bớt. */
    conflicts: CuttingFileConflictZod.array(),
    summary: z.object({
      totalLinks: z.number(),
      matched: z.number(),
      withExistingFile: z.number(),
      notFound: z.number(),
      invalid: z.number(),
      conflicts: z.number(),
      byFactory: CuttingFileBreakdownRowZod.array(),
      byMachineType: CuttingFileBreakdownRowZod.array(),
    }),
  }),
});
export class PreviewCuttingFilesResDto extends createZodDto(extendApi(PreviewCuttingFilesResZod)) {}

export const ApplyCuttingFileItemZod = z.object({
  orderId: IDZod,
  cuttingFileUrl: z.string().min(1),
  cuttingFileName: z.string().min(1),
});

export const ApplyCuttingFilesZod = z.object({
  mappings: ApplyCuttingFileItemZod.array().min(1).max(2000),
  /** Cho phép ghi đè khi đơn đã có `cuttingFileUrl` cũ — default false. */
  overwrite: z.boolean().default(false),
});
export class ApplyCuttingFilesDto extends createZodDto(extendApi(ApplyCuttingFilesZod)) {}

export const ApplyCuttingFilesResZod = ResZod.extend({
  data: z.object({
    updated: z.number(),
    skipped: z.number(),
    skippedOrderIds: z.string().array(),
  }),
});
export class ApplyCuttingFilesResDto extends createZodDto(extendApi(ApplyCuttingFilesResZod)) {}

// ─── Tool-check overview (Dashboard tab Soát tool — Support/Admin) ─────
// Danh sách đơn support cần xử lý (2 nhóm) + thống kê soát/lỗi theo sản phẩm
// và khách hàng (userSku). Xem `documents/FunctionDescription/ToolCheckWorkflow.md`.

export const GetToolCheckOverviewZod = z.object({
  days: z.enum(['7', '14', '30']).default('7'),
  /** Khoảng tùy biến (YYYY-MM-DD, VN) — nếu truyền cả 2 thì dùng thay `days`. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** Lọc theo sản phẩm (`order.type`). */
  type: z.string().optional(),
  /** Lọc theo khách hàng (`order.userSku`). */
  customer: z.string().optional(),
  /** Lọc theo máy (`order.machineNumber`). */
  machineNumber: z.string().optional(),
  /** Lọc theo mức ưu tiên (`order.priority`) — '1'|'2'|'3'. */
  priority: z.enum(['1', '2', '3']).optional(),
});
export class GetToolCheckOverviewDto extends createZodDto(extendApi(GetToolCheckOverviewZod)) {}

/** 1 đơn trong danh sách Soát tool — Support edit trực tiếp Note kq Tool /
 *  File sửa lỗi / Ghi chú file lỗi (mirror bảng đơn theo xưởng). */
export const ToolCheckOrderZod = z.object({
  _id: z.string(),
  productionId: z.string(),
  userSku: z.string().optional(),
  type: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  mockupUrl: z.string().optional(),
  mockupOriginalUrl: z.string().optional(),
  toolResultNote: z.string().optional(),
  errorFile: z.string().array().optional(),
  errorFileNote: z.string().optional(),
  productionError: z.string().optional(),
  productionErrorNote: z.string().optional(),
  productionErrorCount: z.number().int().nonnegative().optional(),
  machineNumber: z.string().optional(),
  inProductionAt: z.string().optional(),
  /** Mức ưu tiên (xem `order-priority.ts`) — hiện badge + dùng để filter/sort. */
  priority: OrderPriorityZod.optional(),
});
export type ToolCheckOrder = z.infer<typeof ToolCheckOrderZod>;

/**
 * 1 ngày trong dải "tổng quan theo ngày" của tab Soát tool. Bất biến:
 * `total = unreviewed + reviewed`; `reviewed ≈ reviewedError + reviewedOk`
 * (soát lỗi/ok là KẾT QUẢ SOÁT lịch sử — lệch chỉ khi đơn từng lỗi bị xóa
 * trắng note, hiếm).
 */
export const ToolCheckDayRowZod = z.object({
  day: z.string(),
  /** Tổng đơn vào SX ngày đó (sau filter tab). */
  total: z.number().int().nonnegative(),
  /** Đơn chưa soát (toolResultNote rỗng) vào SX ngày đó. */
  unreviewed: z.number().int().nonnegative(),
  /** Đơn đã soát (toolResultNote có nội dung). */
  reviewed: z.number().int().nonnegative(),
  /** TỪNG bị soát ra lỗi (`toolCheckErrorNotes` non-empty) — LỊCH SỬ, không giảm khi đơn đã sửa xong. */
  reviewedError: z.number().int().nonnegative(),
  /**
   * Breakdown `reviewedError` theo MÃ LỖI MỚI NHẤT của đơn (phần tử cuối
   * `toolCheckErrorNotes`) — mỗi đơn đúng 1 dòng nên tổng = reviewedError.
   * FE dựng các dòng con "Soát lỗi / Không có file PDF / Không có tool..."
   * + tooltip breakdown dưới hàng "Note không ok".
   */
  errorByNote: z.object({ code: z.string(), count: z.number().int().nonnegative() }).array(),
  /** Đã soát & CHƯA TỪNG lỗi = soát ok ngay (gồm cả đơn ok bị In trả về treo note='error'). */
  reviewedOk: z.number().int().nonnegative(),
  /** Đơn In trả về (source=tool-check + note=error) vào SX ngày đó. */
  rework: z.number().int().nonnegative(),
});
export type ToolCheckDayRow = z.infer<typeof ToolCheckDayRowZod>;

/** 1 option cho dropdown filter (Sản phẩm / Khách / Máy) — value + số đơn. */
export const ToolCheckFacetZod = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});
export type ToolCheckFacet = z.infer<typeof ToolCheckFacetZod>;

/** Lỗi theo sản phẩm (join productConfig để lấy mockup/level). */
/**
 * 1 dòng lịch sử lỗi Soát tool: mỗi (đơn × mã lỗi) mà đơn TỪNG bị đánh lỗi
 * `errorSource='tool-check'` (kể cả đã sửa). FE tự group + cross-filter thành 3
 * cột Khách → Sản phẩm → Loại lỗi (đếm ĐƠN riêng biệt, dedup theo `orderId`).
 */
export const ToolCheckErrorRowZod = z.object({
  orderId: z.string(),
  productionId: z.string().optional(),
  userSku: z.string().optional(),
  userEmail: z.string().optional(),
  type: z.string().optional(),
  fullName: z.string().optional(),
  mockup: z.string().optional(),
  level: z.number().int().optional(),
  code: z.string(),
  codeLabel: z.string().optional(),
  /** Ghi chú file lỗi (errorFileNote) — hiển thị ở panel chi tiết loại lỗi. */
  note: z.string().optional(),
  /** File sửa lỗi (errorFile — mảng mã error_file_type) — panel chi tiết loại lỗi. */
  errorFile: z.string().array().optional(),
  /** Ảnh mockup thật + size/màu của đơn — panel chi tiết loại lỗi. */
  mockupUrl: z.string().optional(),
  mockupOriginalUrl: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
});
export type ToolCheckErrorRow = z.infer<typeof ToolCheckErrorRowZod>;

export const ToolCheckOverviewResZod = ResZod.extend({
  data: z.object({
    /** Số đơn đã soát (toolCheckedAt ∈ kỳ). */
    checkedCount: z.number().int().nonnegative(),
    /** Số đơn đang cần làm lại (In trả về, source=tool-check, note=error). */
    errorCount: z.number().int().nonnegative(),
    /** Đơn In trả về "do soát tool" (ưu tiên). */
    reworkList: ToolCheckOrderZod.array(),
    /** Đơn chưa soát (toolResultNote rỗng) — backlog. */
    unreviewedList: ToolCheckOrderZod.array(),
    /**
     * Lịch sử lỗi Soát tool (kể cả đơn đã sửa) — flat rows để FE dựng 3 cột
     * Khách → Sản phẩm → Loại lỗi (cross-filter, đếm đơn riêng biệt).
     */
    errorHistory: ToolCheckErrorRowZod.array(),
    /** Dải theo ngày (mới→cũ; FE reverse để cũ→mới). */
    days: ToolCheckDayRowZod.array(),
    /** Tổng cột cho dải ngày (cùng shape metric với `ToolCheckDayRowZod`). */
    columnTotals: z.object({
      total: z.number().int().nonnegative(),
      unreviewed: z.number().int().nonnegative(),
      reviewed: z.number().int().nonnegative(),
      reviewedError: z.number().int().nonnegative(),
      reviewedOk: z.number().int().nonnegative(),
      rework: z.number().int().nonnegative(),
    }),
    /** Options cho 3 dropdown filter (phạm vi Support trong kỳ, không cross-narrow). */
    facets: z.object({
      type: ToolCheckFacetZod.array(),
      customer: ToolCheckFacetZod.array(),
      machineNumber: ToolCheckFacetZod.array(),
      priority: ToolCheckFacetZod.array(),
    }),
    rangeDays: z.number().int().positive(),
  }),
});
export class ToolCheckOverviewResDto extends createZodDto(extendApi(ToolCheckOverviewResZod)) {}

// ─── Customer Portal — đặt đơn / xem đơn của chính khách hàng ─────
// Đặt đơn CHỈ gồm thông tin cơ bản (KHÔNG có factory/machine/toolResult/
// designer/fulfillment...) — các field sản xuất được default giống hệt
// luồng import nội bộ (`OrderService.importOrders`), xem `CustomerOrderService`.
//
// 1 lần "Đặt đơn" = NHIỀU sản phẩm (`items[]`, mỗi item → 1 `OrderEntity` row
// riêng, giống hệt logic 1-sản-phẩm cũ) nhưng CHỈ 1 địa chỉ ship dùng chung
// cho mọi item (`shippingAddress`) — snapshot vào field `shippingAddress` có
// sẵn trên `OrderEntity` (trước đây chỉ set qua luồng khôi phục OnosPod, xem
// Orders.md §9c).
export const PlaceCustomerOrderItemZod = z.object({
  type: z.string().min(1),
  color: z.string().max(200).optional(),
  size: z.string().max(200).optional(),
  mockupUrl: z.string().max(2000).optional(),
  printMethod: z.string().max(200).optional(),
  weight: z.number().nonnegative().optional(),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  length: z.number().nonnegative().optional(),
  quantity: z.number().int().positive().default(1),
  designs: DesignFieldsZod.optional(),
});
export type PlaceCustomerOrderItem = z.infer<typeof PlaceCustomerOrderItemZod>;

/** Bắt buộc tối thiểu: tên người nhận + SĐT + địa chỉ + thành phố. */
export const PlaceCustomerOrderShippingAddressZod = ProductionOrderShippingAddressZod.extend({
  firstName: z.string().min(1).max(200),
  phone: z.string().min(1).max(50),
  address1: z.string().min(1).max(500),
  city: z.string().min(1).max(200),
});
export type PlaceCustomerOrderShippingAddress = z.infer<typeof PlaceCustomerOrderShippingAddressZod>;

export const PlaceCustomerOrderZod = z.object({
  items: PlaceCustomerOrderItemZod.array().min(1).max(50),
  shippingAddress: PlaceCustomerOrderShippingAddressZod,
  /** Ghi chú chung — áp dụng cho MỌI item trong lần đặt đơn này. */
  referent: z.string().max(500).optional(),
});
export class PlaceCustomerOrderDto extends createZodDto(extendApi(PlaceCustomerOrderZod)) {}

/** Thông tin đơn hàng thu gọn — CHỈ field cơ bản, ẩn toàn bộ field sản xuất nội bộ. */
export const CustomerOrderSummaryZod = z.object({
  _id: IDZod,
  productionId: z.string(),
  type: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  quantity: z.number().optional(),
  mockupUrl: z.string().optional(),
  productLine: z.enum(PRODUCT_LINES).optional(),
  status: z.string().optional(),
  orderAt: z.coerce.date().optional(),
  cancelledAt: z.coerce.date().optional(),
  cancelReason: z.string().optional(),
  createdAt: z.coerce.date().optional(),
  /** Ngày vào sản xuất — mốc mở đầu timeline sản xuất, hiển thị ở listing. */
  inProductionAt: z.coerce.date().optional(),
  /** Nhãn chặng sản xuất hiện tại (vd "Đang in", "Đóng hàng"...) — rút gọn từ
   *  LifecycleTrack cho listing; xem `track.tsx` (GET .../track) để có timeline đầy đủ từng chặng. */
  currentStageLabel: z.string().optional(),
  /** Key chặng (`LIFECYCLE_STAGE_KEYS`) — FE dịch nhãn theo ngôn ngữ (Seller Portal). */
  currentStageKey: z.string().optional(),
  /** Mốc thời gian vào chặng hiện tại. */
  currentStageAt: z.coerce.date().optional(),
  /** Đơn đã hoàn thành toàn bộ luồng (đóng hàng xong). */
  completed: z.boolean().optional(),
  /** Link thiết kế theo từng vị trí in — khách XEM/SỬA ở trang chi tiết (`track.tsx`), key khớp `printArea[].key` của sản phẩm. */
  designs: DesignFieldsZod.optional(),
  /** `ProductConfig._id` — trang chi tiết dùng để gọi `GET /customer/catalog/:id` lấy `printArea[]`, biết cần hiện ô sửa design nào. */
  productConfigId: IDZod.optional(),
  /** Địa chỉ ship hiện tại — khách XEM/SỬA ở trang chi tiết. */
  shippingAddress: ProductionOrderShippingAddressZod.optional(),
});
export type CustomerOrderSummary = z.infer<typeof CustomerOrderSummaryZod>;

export const PlaceCustomerOrderResZod = ResZod.extend({ data: CustomerOrderSummaryZod.array() });
export class PlaceCustomerOrderResDto extends createZodDto(extendApi(PlaceCustomerOrderResZod)) {}

/**
 * Khách tự sửa 1 đơn ĐÃ đặt — mockup/design/địa chỉ ship (KHÔNG sửa được
 * type/color/size/quantity, chỉ đổi được qua support nội bộ). Ít nhất 1 field.
 */
export const UpdateCustomerOrderZod = z
  .object({
    mockupUrl: z.string().max(2000).optional(),
    designs: DesignFieldsZod.optional(),
    shippingAddress: PlaceCustomerOrderShippingAddressZod.optional(),
  })
  .refine((v) => v.mockupUrl !== undefined || v.designs !== undefined || v.shippingAddress !== undefined, {
    message: 'Cần ít nhất 1 field để cập nhật',
  });
export class UpdateCustomerOrderDto extends createZodDto(extendApi(UpdateCustomerOrderZod)) {}

export const UpdateCustomerOrderResZod = ResZod.extend({ data: CustomerOrderSummaryZod });
export class UpdateCustomerOrderResDto extends createZodDto(extendApi(UpdateCustomerOrderResZod)) {}

export const GetCustomerOrdersZod = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  /** Tìm theo mã đơn (`productionId`) — match chứa, không phân biệt hoa thường. */
  search: z.string().max(100).optional(),
  /** Lọc theo sản phẩm — match CHÍNH XÁC field `type` (lấy option từ GET /customer/orders/product-types). */
  type: z.string().max(200).optional(),
});
export class GetCustomerOrdersDto extends createZodDto(extendApi(GetCustomerOrdersZod)) {}

/** Danh sách sản phẩm (distinct `type`) khách đã từng đặt — option cho filter listing. */
export const GetCustomerOrderProductTypesResZod = ResZod.extend({ data: z.string().array() });
export class GetCustomerOrderProductTypesResDto extends createZodDto(extendApi(GetCustomerOrderProductTypesResZod)) {}

/** Dashboard Customer Portal — tổng quan đơn của chính khách đang đăng nhập. */
export const CustomerDashboardZod = z.object({
  totals: z.object({
    total: z.number(),
    /** Đơn đang trong luồng sản xuất (chưa hoàn thành, chưa hủy). */
    processing: z.number(),
    /** Đơn đã đóng hàng xong (`fulfillmentCompletedAt`). */
    completed: z.number(),
    cancelled: z.number(),
  }),
  /** 5 đơn mới nhất — hiển thị bảng "Đơn gần đây". */
  recentOrders: CustomerOrderSummaryZod.array(),
});
export type CustomerDashboard = z.infer<typeof CustomerDashboardZod>;
export const GetCustomerDashboardResZod = ResZod.extend({ data: CustomerDashboardZod });
export class GetCustomerDashboardResDto extends createZodDto(extendApi(GetCustomerDashboardResZod)) {}

export const GetCustomerOrdersResZod = ResZod.extend({
  data: CustomerOrderSummaryZod.array(),
  total: z.number().optional(),
});
export class GetCustomerOrdersResDto extends createZodDto(extendApi(GetCustomerOrdersResZod)) {}

export const GetCustomerOrderTrackResZod = ResZod.extend({
  data: z.object({
    order: CustomerOrderSummaryZod,
    track: LifecycleTrackZod,
  }),
});
export class GetCustomerOrderTrackResDto extends createZodDto(extendApi(GetCustomerOrderTrackResZod)) {}

// ─── Recover held orders from OnosPod (design/địa chỉ chờ khách cập nhật) ──
// Public cron endpoint — xem `Orders.md §9c` + `OnospodOrderLookupService`.
export const RecoverHeldOrdersSkipZod = z.object({
  productionId: z.string(),
  reason: z.string(),
});

export const RecoverHeldOrdersResZod = ResZod.extend({
  data: z.object({
    checkedDesign: z.number().int().nonnegative(),
    checkedAddress: z.number().int().nonnegative(),
    designUpdated: z.number().int().nonnegative(),
    addressPrimed: z.number().int().nonnegative(),
    addressUpdated: z.number().int().nonnegative(),
    unheld: z.number().int().nonnegative(),
    skipped: RecoverHeldOrdersSkipZod.array(),
  }),
});
export class RecoverHeldOrdersResDto extends createZodDto(extendApi(RecoverHeldOrdersResZod)) {}

// ─── Đồng bộ giữ đơn theo OnosPod (Orders.md §9d) ──────────────────────────
// Schema kết quả `OnospodHoldSyncResultZod` khai báo cạnh `ImportFromOnosPodResZod`
// (dùng chung cho trường `holdSync` của kết quả import).
export const SyncOnospodHoldResZod = ResZod.extend({ data: OnospodHoldSyncResultZod });
export class SyncOnospodHoldResDto extends createZodDto(extendApi(SyncOnospodHoldResZod)) {}

// ─── Kiểm tra design mới thủ công (nút action menu Danh sách đơn, 1 đơn) ──
// Dùng chung logic với recoverHeldOrders() nhưng áp dụng cho MỌI đơn (không
// cần đang giữ) — xem OrderService.checkOrderDesignFromOnospod, Orders.md §9c.
export const CheckOrderDesignResZod = ResZod.extend({
  data: z.object({
    updated: z.boolean(),
    /** Lý do KHÔNG cập nhật (design chưa đổi, không tra được OnosPod, đơn đã hủy...). */
    reason: z.string().optional(),
    /** Field design đã đổi (chỉ có khi `updated=true`). */
    changed: DesignFieldsZod.partial().optional(),
    /** Đơn SAU khi cập nhật (chỉ có khi `updated=true`) — FE patch local row. */
    order: ProductionOrderZod.optional(),
  }),
});
export class CheckOrderDesignResDto extends createZodDto(extendApi(CheckOrderDesignResZod)) {}

// ─── Đồng bộ lại design theo mã khách hàng (userSku, thủ công) ──────
// Tìm TOÀN BỘ đơn cùng userSku, tra OnosPod theo từng đơn — CHỈ ghi
// designs/designsOriginal, KHÔNG đụng toolResult/heldAt (khác
// checkOrderDesignFromOnospod) — xem OrderService.syncDesignByCustomer.
export const SyncDesignByCustomerZod = z.object({
  userSku: z.string(),
});
export class SyncDesignByCustomerDto extends createZodDto(extendApi(SyncDesignByCustomerZod)) {}

export const SyncDesignByCustomerSkipZod = z.object({
  productionId: z.string(),
  reason: z.string(),
});

export const SyncDesignByCustomerResZod = ResZod.extend({
  data: z.object({
    total: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: SyncDesignByCustomerSkipZod.array(),
  }),
});
export class SyncDesignByCustomerResDto extends createZodDto(extendApi(SyncDesignByCustomerResZod)) {}

// ─── Kiểm tra design mới hàng loạt (nút bulk toolbar, các đơn ĐANG TICK CHỌN) ──
// Nhận danh sách `ids` (đơn đang chọn ở Danh sách đơn) — CÙNG logic
// `checkOrderDesignFromOnospod` (reset toolResult/toolResultNote +
// forceUnhold) áp cho TỪNG đơn trong danh sách, khác `syncDesignByCustomer`
// (theo userSku, KHÔNG reset tool/heldAt) — xem OrderService.bulkCheckOrderDesignFromOnospod.
export const BulkCheckOrderDesignZod = z.object({
  ids: z.string().array().min(1),
});
export class BulkCheckOrderDesignDto extends createZodDto(extendApi(BulkCheckOrderDesignZod)) {}

export const BulkCheckOrderDesignSkipZod = z.object({
  productionId: z.string(),
  reason: z.string(),
});

export const BulkCheckOrderDesignResZod = ResZod.extend({
  data: z.object({
    total: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    skipped: BulkCheckOrderDesignSkipZod.array(),
  }),
});
export class BulkCheckOrderDesignResDto extends createZodDto(extendApi(BulkCheckOrderDesignResZod)) {}

// ─── Action "Đã soát xong" (tab Soát tool, list "Cần làm lại") ──────
// Support xác nhận đã soát xong 1 đơn hold (source=tool-check + note=error) và
// đơn CẦN THIẾT KẾ (khác nhánh đổi Note kq Tool → 'ok' = file ổn, về In):
//   - Đơn có designer từng làm → designerStatus='rework' (về kanban "Cần làm lại").
//   - Chưa có designer → auto-gán theo cấu hình xưởng (luồng import); không có
//     cấu hình → nằm backlog "Cần gán" (designer tự nhận / leader phân).
export const ToolCheckDoneOutcomeZod = z.enum(['designer-rework', 'auto-assigned', 'backlog']);
export type ToolCheckDoneOutcome = z.infer<typeof ToolCheckDoneOutcomeZod>;

export const ToolCheckDoneResZod = ResZod.extend({
  data: z.object({
    outcome: ToolCheckDoneOutcomeZod,
    /** Tên designer nhận đơn (outcome='designer-rework' | 'auto-assigned'). */
    assigneeName: z.string().optional(),
  }),
});
export class ToolCheckDoneResDto extends createZodDto(extendApi(ToolCheckDoneResZod)) {}
