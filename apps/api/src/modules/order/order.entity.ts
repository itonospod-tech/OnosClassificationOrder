import { Prop, raw, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type {
  DesignFields,
  FulfillmentStages,
  FulfillmentTimelineEntry,
  ProductionOrderShippingAddress,
  ProductionOrderTracking,
  VnpShipmentInfo,
} from 'shared';
import type { ProductLine } from 'shared';
import {
  DESIGNER_STATUSES,
  DesignerStatus,
  FULFILLMENT_STAGE_STATUSES,
  FULFILLMENT_STAGES,
  FulfillmentStage,
  FulfillmentStageStatus,
  ORDER_PRIORITIES,
  OrderPriority,
} from 'shared';
import { PRODUCT_LINES } from 'shared';

import type { FactoryDocument } from '../factory/factory.entity';
import type { MachineTypeDocument } from '../machine-type/machine-type.entity';
import type { ProductConfigDocument } from '../product-config/product-config.entity';

@DatabaseEntity({ collection: 'orders' })
export class OrderEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, unique: true, index: true })
  productionId: string;

  @Prop()
  userSku?: string;

  @Prop()
  userEmail?: string;

  @Prop({ index: true })
  type?: string;

  @Prop()
  color?: string;

  @Prop()
  size?: string;

  @Prop()
  mockupUrl?: string;

  @Prop()
  mockupOriginalUrl?: string;

  /**
   * Drive URL của file cutting (.pdf) — cũng là file in (design đã duyệt),
   * dùng ở stage "In" của fulfillment. Set qua flow import riêng
   * `POST /orders/cutting-files/apply` (match theo productionId parse từ
   * filename — pattern 2 chữ cái + "-" + 5 số + "-" + 5 số, vd
   * `BH-96341-30608-*.pdf`, `ML-12345-67890-*.pdf`) HOẶC qua
   * `POST /orders/design-review/result` (public API tool ngoài soát design —
   * xem `OrderService.setDesignReviewResult`, Orders.md §18.7).
   */
  @Prop()
  cuttingFileUrl?: string;

  /** Tên file cache (parse 1 lần lúc map) để FE hiển thị mà không phải re-fetch Drive. */
  @Prop()
  cuttingFileName?: string;

  /**
   * Drive URL của file in tạm (.pdf hoặc file design) — dùng khi đơn đang bị
   * lỗi (`toolResultNote='error'`), tool ngoài lưu tạm để tham khảo trong lúc
   * chờ xử lý, KHÁC `cuttingFileUrl` (file chính thức đã duyệt). Set qua
   * `POST /orders/design-review/result` — xem `OrderService.setDesignReviewResult`,
   * Orders.md §18.7.
   */
  @Prop()
  tempFileUrl?: string;

  @Prop()
  printMethod?: string;

  /** PRD-8 — dòng sản phẩm, stamp lúc import từ ProductConfig (Seller Portal lọc/đếm). */
  @Prop({ type: String, enum: PRODUCT_LINES, index: true })
  productLine?: ProductLine;

  @Prop()
  weight?: number;

  @Prop()
  width?: number;

  @Prop()
  height?: number;

  @Prop()
  length?: number;

  @Prop({ default: 1 })
  quantity: number;

  @Prop()
  baseCost?: number;

  @Prop()
  shipCost?: number;

  @Prop({
    _id: false,
    type: raw({
      front: String,
      back: String,
      sleeve: String,
      hood: String,
      folder: String,
      placket: String,
      chestLeft: String,
      chestRight: String,
      left: String,
      right: String,
      sleeveLeft: String,
      sleeveRight: String,
      leftUpperSleeve: String,
      rightUpperSleeve: String,
      leftCuff: String,
      rightCuff: String,
      frontEmbroidery: String,
      backEmbroidery: String,
    }),
  })
  designs?: DesignFields;

  @Prop({
    _id: false,
    type: raw({
      front: String,
      back: String,
      sleeve: String,
      hood: String,
      folder: String,
      placket: String,
      chestLeft: String,
      chestRight: String,
      left: String,
      right: String,
      sleeveLeft: String,
      sleeveRight: String,
      leftUpperSleeve: String,
      rightUpperSleeve: String,
      leftCuff: String,
      rightCuff: String,
      frontEmbroidery: String,
      backEmbroidery: String,
    }),
  })
  designsOriginal?: DesignFields;

  /**
   * Trạng thái xử lý R2 cho từng vị trí design. Set khi import → worker cập
   * nhật. Value: `'pending' | 'ready' | 'failed'`. Không có status → coi như
   * legacy data (URL trong `designs.{k}` là URL gốc / Teehub cũ).
   */
  @Prop({
    _id: false,
    type: raw({
      front: String,
      back: String,
      sleeve: String,
      hood: String,
      folder: String,
      placket: String,
      chestLeft: String,
      chestRight: String,
      left: String,
      right: String,
      sleeveLeft: String,
      sleeveRight: String,
      leftUpperSleeve: String,
      rightUpperSleeve: String,
      leftCuff: String,
      rightCuff: String,
      frontEmbroidery: String,
      backEmbroidery: String,
    }),
  })
  designsStatus?: Record<keyof DesignFields, 'pending' | 'ready' | 'failed' | undefined>;

  @Prop()
  status?: string;

  // Import file soát hook: errorFileNote chứa "hủy đơn" → set 2 field này
  // thay cho việc lạm dụng `status` free-text.
  @Prop({ index: true })
  cancelledAt?: Date;

  @Prop()
  cancelReason?: string;

  /**
   * Đơn đang bị GIỮ (hold) — set qua POST /orders/:id/hold. Khi set: mọi thao
   * tác (updateField, transition designer/fulfillment, báo lỗi...) bị chặn ở BE
   * + FE tô xám cả dòng. REVERSIBLE — clear qua /unhold để tiếp tục. Index để
   * count "Đơn đang giữ" ở dashboard + toggle filter workshop.
   */
  @Prop({ index: true })
  heldAt?: Date;

  @Prop()
  holdReason?: string;

  /**
   * Nguồn lượt giữ hiện tại — `manual` (nhân viên) | `onospod` (đồng bộ tự giữ,
   * Orders.md §9d). Đơn đang giữ thiếu trường này = `manual` (đơn giữ cũ).
   * `$unset` cùng `heldAt` khi mở giữ. Chỉ `onospod` được đồng bộ tự nhả.
   * Index sparse: đồng bộ quét `{ holdSource: 'onospod' }` mỗi lượt.
   */
  @Prop({ type: String, index: true, sparse: true })
  holdSource?: 'manual' | 'onospod';

  /**
   * Cờ "OnosPod đang giữ" — item MRP bên OnosPod đang `On Hold`, bất kể đơn
   * bên mình có giữ hay không. `onHoldAt` = thời điểm đợt giữ bên OnosPod,
   * `seenAt` = lần đầu đồng bộ thấy đợt này. Index sparse ở `OrderSchema.index`.
   */
  @Prop({ _id: false, type: raw({ onHoldAt: Date, seenAt: Date }) })
  onospodHold?: { onHoldAt: Date; seenAt: Date } | null;

  /** `onHoldAt` của đợt giữ OnosPod mà nhân viên đã mở giữ — không giữ lại đợt đó. */
  @Prop()
  onospodHoldDismissedAt?: Date;

  /**
   * Snapshot địa chỉ ship lấy từ OnosPod — CHỈ dùng cho cron "lấy ngược địa chỉ"
   * khi đơn giữ lý do `HOLD_REASON_WAITING_ADDRESS` (xem
   * `OrderService.getHeldOrdersForRecovery` + `OnospodOrderLookupService`).
   * Lần check đầu = snapshot mốc so sánh (KHÔNG tự mở giữ); lần sau khác
   * snapshot → mở giữ + cập nhật.
   */
  @Prop({
    _id: false,
    type: raw({
      firstName: String,
      lastName: String,
      company: String,
      address1: String,
      address2: String,
      city: String,
      state: String,
      postcode: String,
      country: String,
      email: String,
      phone: String,
    }),
  })
  shippingAddress?: ProductionOrderShippingAddress;

  /**
   * Vận đơn VNP eGlobal đã tạo cho đơn (module `shipping-vnp`, giai đoạn test
   * — nút "Vận đơn VNP" ở bảng đơn hàng). `rep1` bên VNP = `productionId`.
   */
  @Prop({
    _id: false,
    type: raw({
      shipmentId: String,
      trackingCode: String,
      labelUrl: String,
      service: String,
      shippingType: String,
      toAddressId: String,
      addressValid: Boolean,
      addressCheckedAt: Date,
      createdAt: Date,
      cancelledAt: Date,
      lastTrackingStatus: String,
      lastTrackingAt: Date,
    }),
  })
  vnpShipment?: VnpShipmentInfo;

  /**
   * Vận đơn KHÁCH TỰ CẤP đi kèm lúc lên đơn (CSV khách / CSV admin / Public
   * Order API) — label mua sẵn bên ngoài, hệ thống chỉ nhận và in dán.
   *
   * Snapshot mỏng để list/dialog render không phải join; NGUỒN SỰ THẬT là
   * record `shipments` (provider `customer`) do `ShipmentIngestService` ghi —
   * cùng bảng với label VNP hệ thống tự mua, xem `VnpShipping.md §2a`.
   */
  @Prop({
    _id: false,
    type: raw({
      number: { type: String, index: true },
      carrier: String,
      url: String,
      labelUrl: String,
    }),
  })
  tracking?: ProductionOrderTracking;

  @Prop({ index: true })
  orderId?: string;

  @Prop({ index: true })
  externalId?: string;

  @Prop()
  referent?: string;

  @Prop()
  orderAt?: Date;

  /**
   * Thời gian đơn vào sản xuất theo sheet import. Đây là **sort key chính**
   * cho list/grouped/kanban/My Tasks (thay cho Mongo `createdAt`) → cần index
   * để tránh full collection scan khi dataset > 100k.
   */
  @Prop({ index: true })
  inProductionAt?: Date;

  @Prop({ default: false, index: true })
  isMapped: boolean;

  @Prop({ ref: 'ProductConfigEntity', index: true })
  productConfigId?: string;

  @Prop({ ref: 'FactoryEntity', index: true })
  factoryId?: string;

  /**
   * Original factory at import time. `factoryId` mutates on transfer, this one
   * doesn't — drives the "transferred from ML to TN" classification in the
   * factory dashboard. Backfilled to equal `factoryId` for legacy rows.
   */
  @Prop({ ref: 'FactoryEntity', index: true })
  originalFactoryId?: string;

  @Prop({ ref: 'MachineTypeEntity', index: true })
  machineTypeId?: string;

  /**
   * Mức ưu tiên (1=thấp, 2=ưu tiên, 3=cao) — số càng cao càng ưu tiên. Không
   * set = đơn thường, không hiện badge/estimate, không đẩy lên đầu list.
   * Sửa qua updateField/bulkUpdateField (field `priority`) như mọi field
   * workshop khác. Index vì đây là sort key chính ở mọi danh sách đơn.
   */
  @Prop({ type: Number, enum: ORDER_PRIORITIES, index: true })
  priority?: OrderPriority;

  // ─── Workshop fields (Phase 2) ─────────────────────────────────
  // All values are workshop_config codes (string slugs). Editor cell maps
  // code → { name, color, icon } via the WorkshopConfig store on FE.

  @Prop({ index: true })
  printStatus?: string;

  @Prop()
  printStatusNote?: string;

  @Prop()
  toolResult?: string;

  @Prop({ index: true })
  toolResultNote?: string;

  /**
   * BỀN VỮNG: tập mã `toolResultNote` ≠ ok (≠ rỗng) mà người soát tool ĐÃ từng
   * đánh trên đơn (dedup, $addToSet). KHÔNG bị xoá khi đơn sửa về 'ok' → dùng
   * thống kê lịch sử "lỗi do người soát tool tạo ra" (ToolCheckTab §2.3) + hàng
   * "Soát lỗi" Tổng quan N ngày (Dashboard Designer). Set ở updateField
   * ('toolResultNote') + importRework + markToolCheckDone ('error') + backfill
   * từ OrderLog trong onModuleInit.
   */
  @Prop({ type: [String], default: undefined, index: true })
  toolCheckErrorNotes?: string[];

  /**
   * Thời điểm đơn lần đầu được soát tool (toolResultNote rỗng → có giá trị).
   * Set ở updateField/bulkUpdateField/importRework. Dùng cho dashboard Vòng đời
   * (chặng "Soát tool"). Legacy rows backfill = updatedAt trong onModuleInit.
   */
  @Prop({ index: true })
  toolCheckedAt?: Date;

  /**
   * Lease claim cho `GET /orders/design-review/next` (tool ngoài duyệt thiết
   * kế, nhiều client gọi song song). Set atomically trong `findOneAndUpdate`
   * khi 1 client lấy đơn — đơn đang trong lease (`now - designReviewClaimedAt
   * < DESIGN_REVIEW_CLAIM_LEASE_MS`) bị loại khỏi query để tránh 2 client
   * nhận trùng đơn. Hết lease mà chưa có `toolResultNote` (client crash giữa
   * chừng) → đơn tự nhả lại cho client khác, KHÔNG cần endpoint release riêng.
   */
  @Prop({ index: true })
  designReviewClaimedAt?: Date;

  /**
   * Multi-select array of workshop_config codes (category=error_file_type).
   * Legacy data có thể vẫn là string đơn — `OrderModule.onModuleInit` chạy
   * migration 1 lần convert sang array. Query filter dùng `$in: codes` vẫn
   * hoạt động với array (Mongo $in match nếu 1 phần tử array khớp). Aggregation
   * breakdown cần `$unwind` trước `$group`.
   */
  @Prop({ type: [String], default: undefined, index: true })
  errorFile?: string[];

  @Prop()
  errorFileNote?: string;

  @Prop({ index: true })
  assignee?: string;

  @Prop()
  assigneeNote?: string;

  /** workshop_config code (category=fabric_type). Auto-filled from product config at import. */
  @Prop({ index: true })
  fabricType?: string;

  /** workshop_config code (category=machine). Auto-filled from product config at import. */
  @Prop({ index: true })
  machineNumber?: string;

  // ─── Production error (Phase 8) ─────────────────────────────────
  // Xưởng báo lỗi đơn hàng (sai size, in lệch, máy hỏng...). Khi
  // `productionError` được set tức là đơn đang ở trạng thái lỗi xưởng;
  // dashboard + filter dùng `{ $exists: true, $ne: null, $ne: '' }`
  // để liệt kê.
  @Prop({ index: true })
  productionError?: string;

  @Prop()
  productionErrorNote?: string;

  /**
   * Phân loại nguồn lỗi cho dashboard stats (Phase Fulfillment per-factory).
   * Auto-fill từ workshop_config.errorSource khi user set productionError;
   * cho phép override.
   */
  @Prop({ type: String, enum: ['designer', 'factory'], index: true })
  productionErrorSource?: 'designer' | 'factory';

  /** Đếm số lần xưởng đã set productionError. Display "Lỗi ×N" trên cell. */
  @Prop({ required: true, default: 0 })
  productionErrorCount: number;

  /**
   * Thời điểm đơn LẦN ĐẦU bị xưởng đánh productionError trong cycle hiện tại.
   * Set khi `productionError` chuyển từ null → value (và field chưa có giá trị).
   * Clear (= unset) khi đơn rời nhật ký bù lỗi: `toolResultNote === 'ok'`
   * hoặc `productionError` được clear. Dùng cho tab Nhật ký bù lỗi để sort
   * theo thời gian lỗi cũ nhất + tính mức độ khẩn (24h/48h/72h).
   */
  @Prop({ index: true })
  productionFirstErrorAt?: Date;

  /**
   * Admin/Manager "Đánh dấu hoàn thành lỗi" — đơn lỗi tồn đọng không còn hiển
   * thị ở tab "Cần xử lý" (loại khỏi mọi role). Clear (= null) khi đơn bị báo
   * lỗi MỚI (`setProductionError` set code) để nó xuất hiện lại. Đơn resolved
   * hiện ở tab "Đã xong" của Admin (trong 14 ngày).
   */
  @Prop({ index: true })
  errorResolvedAt?: Date;

  // Derived: true when toolResultNote === 'ok' (Designer marks an order ready
  // for the Fulfillment role to pick up). Service recomputes this on every
  // toolResultNote update and on import.
  @Prop({ required: true, default: false, index: true })
  readyForFulfill: boolean;

  // ─── Designer task workflow (Phase 1 Designer-Task-Workflow) ─────
  /**
   * State machine — default 'unassigned'. Mọi transition đi qua endpoint
   * `POST /orders/:id/designer-transition` (state machine + auto side effects).
   * Reassign chỉ cho khi status ∈ {unassigned, assigned, rejected}.
   */
  @Prop({
    type: String,
    enum: DESIGNER_STATUSES,
    default: DesignerStatus.Unassigned,
    required: true,
    index: true,
  })
  designerStatus: DesignerStatus;

  @Prop() designerAssignedAt?: Date;
  /** Start time của cycle hiện tại — reset mỗi lần start/restart. */
  @Prop() designerStartedAt?: Date;
  /** Start time của lần đầu — set 1 lần (immutable). Dùng cho response time. */
  @Prop() designerFirstStartedAt?: Date;
  @Prop() designerCompletedAt?: Date;
  @Prop() designerRejectedAt?: Date;
  @Prop() designerReworkAt?: Date;

  @Prop({ trim: true })
  designerRejectedReason?: string;

  @Prop({ required: true, default: 0 })
  designerReworkCount: number;

  /** Cumulative work time (ms) — $inc khi complete. */
  @Prop({ required: true, default: 0 })
  designerWorkMs: number;

  /**
   * Lịch sử "báo không làm được → bàn giao". Mỗi lần 1 designer báo không làm
   * được, đơn gán thẳng sang designer khác (không còn state `rejected`).
   * Append-only — NGUỒN thống kê "Không làm được" theo người (`fromUserId`).
   */
  @Prop({
    type: [
      {
        fromUserId: { type: String },
        toUserId: { type: String },
        reason: { type: String },
        at: { type: Date },
      },
    ],
    default: undefined,
  })
  designerRejections?: { fromUserId: string; toUserId: string; reason?: string; at: Date }[];

  // ─── Fulfillment 8-stage workflow ───────────────────────────────
  /**
   * Stage hiện tại của đơn. null = chưa vào fulfillment HOẶC đã pack done.
   * Filter chính cho `getOrders` của user Fulfillment (cùng với `factoryId`).
   * Auto set = `print` khi `designerStatus` chuyển sang `done` (hook trong
   * setDesignerStatus complete).
   */
  @Prop({ type: String, enum: FULFILLMENT_STAGES, index: true })
  currentFulfillmentStage?: FulfillmentStage;

  /** Set khi stage `pack.complete`. Đơn coi như xong toàn bộ flow fulfillment. */
  @Prop({ index: true })
  fulfillmentCompletedAt?: Date;

  /**
   * Per-stage state. Lazy init: stage chỉ có entry khi đã được kích hoạt lần
   * đầu (đơn tới stage đó). Khi rework-back vẫn giữ entry, cộng dồn workMs.
   */
  @Prop({
    _id: false,
    type: raw({
      print: { type: Object },
      press: { type: Object },
      'qc-post-press': { type: Object },
      'sew-in': { type: Object },
      'sew-out': { type: Object },
      pack: { type: Object },
    }),
  })
  fulfillmentStages?: FulfillmentStages;

  /**
   * Append-only timeline ghi nhận mọi transition (start/complete/rework-back)
   * để FE render lịch sử di chuyển. Push trong cùng update với state change.
   */
  @Prop({
    type: [
      raw({
        stage: { type: String, enum: FULFILLMENT_STAGES },
        action: String,
        fromStatus: { type: String, enum: FULFILLMENT_STAGE_STATUSES },
        toStatus: { type: String, enum: FULFILLMENT_STAGE_STATUSES },
        byUserId: String,
        byUserName: String,
        at: Date,
        reworkTarget: String,
        reason: String,
      }),
    ],
    default: [],
  })
  fulfillmentTimeline: FulfillmentTimelineEntry[];
}

/**
 * Helper builder cho tạo state object lúc init stage. Dùng ở
 * FulfillmentTaskService — nhưng định nghĩa ở entity để giữ shape thống nhất.
 */
export function makeEmptyStageState(): FulfillmentStages[keyof FulfillmentStages] {
  return {
    status: FulfillmentStageStatus.Waiting,
    reworkCount: 0,
    workMs: 0,
  };
}

export const OrderSchema = SchemaFactory.createForClass(OrderEntity);

// Thống kê "Không làm được" theo từng người bàn giao.
OrderSchema.index({ 'designerRejections.fromUserId': 1 });

// Đồng bộ giữ đơn theo OnosPod (Orders.md §9d) — mỗi lượt nạp đơn đang mang cờ.
OrderSchema.index({ 'onospodHold.onHoldAt': 1 }, { sparse: true });

OrderSchema.virtual('factory', {
  ref: 'FactoryEntity',
  localField: 'factoryId',
  foreignField: '_id',
  justOne: true,
});

OrderSchema.virtual('originalFactory', {
  ref: 'FactoryEntity',
  localField: 'originalFactoryId',
  foreignField: '_id',
  justOne: true,
});

OrderSchema.virtual('machineType', {
  ref: 'MachineTypeEntity',
  localField: 'machineTypeId',
  foreignField: '_id',
  justOne: true,
});

OrderSchema.virtual('productConfig', {
  ref: 'ProductConfigEntity',
  localField: 'productConfigId',
  foreignField: '_id',
  justOne: true,
});

export type OrderDocument = HydratedDocument<OrderEntity> & {
  factory?: FactoryDocument;
  machineType?: MachineTypeDocument;
  productConfig?: ProductConfigDocument;
};
