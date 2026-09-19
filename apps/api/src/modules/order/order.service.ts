import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, PipelineStage } from 'mongoose';
import type {
  ApplyCuttingFilesDto,
  ApplyCuttingFilesResDto,
  BarcodeLabel,
  BreakdownBucket,
  BulkAssignDesignerDto,
  BulkAssignDesignerPreviewDto,
  BulkAssignDesignerPreviewResDto,
  BulkAssignDesignerResDto,
  BulkAssignOrderDto,
  BulkAssignOrderResDto,
  BulkCheckOrderDesignResDto,
  BulkHoldOrderDto,
  BulkHoldOrderResDto,
  BulkTransferOrderDto,
  BulkUpdateOrderFieldDto,
  BulkUpdateOrderFieldResDto,
  CancelledOrderRow,
  CancelOrderDto,
  CheckOrderDesignResDto,
  CuttingFileBreakdownRow,
  CuttingFileConflict,
  CuttingFileInvalid,
  CuttingFileMatched,
  CuttingFileNotFound,
  DesignerAssignmentConfig,
  DesignerBacklogResDto,
  DesignerBreakdownResDto,
  DesignerStatusCounts,
  DesignFields,
  DesignReviewOrder,
  FactoryBreakdown,
  FactoryBucket,
  FactoryFlow,
  FactoryOption,
  FactoryOverviewCell,
  ForceCompleteOrderResDto,
  FulfillmentTimelineEntry,
  GetCancelledOrdersDto,
  GetCancelledOrdersResDto,
  GetDesignReviewErrorFileOptionsResDto,
  GetErrorLogDto,
  GetErrorLogResDto,
  GetFactoryOverviewDto,
  GetFactoryOverviewResDto,
  GetGroupedProductionOrdersResDto,
  GetImportSummaryDto,
  GetImportSummaryResDto,
  GetLifecycleOverviewDto,
  GetLifecycleOverviewResDto,
  GetOrderDashboardDto,
  GetOrderDashboardResDto,
  GetOrderStatusOverviewDto,
  GetOrderStatusOverviewResDto,
  GetProductionOrdersDto,
  GetProductionOrdersResDto,
  HoldOrderDto,
  HoldOrderResDto,
  ImportProductionOrdersDto,
  ImportProductionOrdersResDto,
  ImportReworkOrdersDto,
  ImportReworkOrdersResDto,
  ImportSummaryGroup,
  LifecycleStageRow,
  MachineBucket,
  MachineKpi,
  MachineTypeBreakdown,
  MockupSummary,
  OrderStatusOverview,
  OrderWorkshopField,
  PreviewCuttingFilesDto,
  PreviewCuttingFilesResDto,
  ProductionOrderShippingAddress,
  ProductLine,
  RecoverHeldOrdersResDto,
  SetProductionErrorDto,
  SetProductionErrorResDto,
  ShippingLabel,
  SizeMatrixRow,
  SizeSummary,
  SyncDesignByCustomerResDto,
  ToolCheckDoneResDto,
  TransferOrderDto,
  TransferOrderResDto,
  TypeSummary,
  UpdateOrderDesignDto,
  UpdateOrderFieldDto,
  UpdateOrderFieldResDto,
  UserBreakdown,
} from 'shared';
import type {
  CustomerWebhookEvent,
  DesignReviewPrintArea,
  GetOrderLogsDto,
  LifecycleTrack,
  LifecycleTrackStage,
  LifecycleTrackStatus,
  ProductPrintArea,
  ProductVariation,
} from 'shared';
import type { WorkshopStageFilterKey } from 'shared';
import {
  customerMatchKey,
  DESIGNER_ACTIVE_STATUSES,
  DESIGNER_ASSIGNMENT_CONFIG_KEY,
  DESIGNER_REASSIGNABLE_STATUSES,
  DesignerStatus,
  FULFILLMENT_STAGE_LABELS,
  FULFILLMENT_STAGE_ORDER,
  FULFILLMENT_STAGES,
  FulfillmentStage,
  FulfillmentStageStatus,
  FulfillmentTransitionAction,
  HOLD_REASON_WAITING_ADDRESS,
  HOLD_REASON_WAITING_DESIGN,
  HoldSource,
  isVariationColorLabel,
  LIFECYCLE_STAGE_KEYS,
  normalizeProductionOrderTracking,
  normalizeVariationText,
  parseProductionIdFromCuttingFilename,
  PRODUCT_PRINT_AREA_LABEL_MAP,
  redirectAutoTarget,
  resolveVariationSizeLabel,
  RoleType,
  Status,
  WorkshopConfigCategory,
} from 'shared';
import { Logger } from 'winston';

import { workshopStageSwitchExpr } from '@/utils/workshop-stage';

import { getExcludedFactoryIdSync, loadExcludedFactoryId, productionFactoryClause } from '../../utils/excluded-factory';
import {
  getFactoryAutoPackSync,
  getFactoryFlowTypeSync,
  getFactorySkipToolCheckSync,
  loadFactoryFlowTypes,
} from '../../utils/merged-flow-factory';
import { CustomerRepository } from '../customer/customer.repository';
import { CustomerAssignmentService } from '../customer-assignment/customer-assignment.service';
import { CustomerOrderEventService } from '../customer-event/customer-order-event.service';
import { DESIGN_PREVIEW_QUEUE, DESIGN_THUMB_QUEUE, DesignImageJobData } from '../design-image/design-image.processor';
import { DesignImageService } from '../design-image/design-image.service';
import { FactoryRepository } from '../factory/factory.repository';
import { MachineTypeRepository } from '../machine-type/machine-type.repository';
import { OrderLogRepository } from '../order-log/order-log.repository';
import type { AuditContext } from '../order-log/order-log.service';
import { OrderLogService } from '../order-log/order-log.service';
import { ProductConfigRepository } from '../product-config/product-config.repository';
import { RedisCacheService } from '../redis-cache/redis-cache.service';
import { RoleRepository } from '../role/role.repository';
import type { ExternalTrackingInput } from '../shipping-vnp/shipment-ingest.service';
import { ShipmentIngestService } from '../shipping-vnp/shipment-ingest.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { UserEntity } from '../user/user.entity';
import { WorkshopConfigRepository } from '../workshop-config/workshop-config.repository';
import { resolveBarcodeSkuBase } from './barcode-label';
import { DriveFileNameService } from './drive-file-name.service';
import { planForceComplete } from './force-complete-plan';
import { shouldNotifyCustomerOnManualUnhold } from './onospod-hold-sync.plan';
import { OnospodOrderLookupService } from './onospod-order-lookup.service';
import { OrderDocument, OrderEntity } from './order.entity';
import { OrderRepository } from './order.repository';
import { parseTypeFilter, TYPE_NONE_TOKEN } from './parse-type-filter';
import { resolveShippingLabelInfo } from './shipping-label';

const FIELD_CONFIG_CATEGORY: Record<OrderWorkshopField, WorkshopConfigCategory | null> = {
  printStatus: WorkshopConfigCategory.PrintStatus,
  printStatusNote: WorkshopConfigCategory.PrintStatusNote,
  toolResult: WorkshopConfigCategory.ToolResult,
  toolResultNote: WorkshopConfigCategory.ToolResultNote,
  errorFile: WorkshopConfigCategory.ErrorFileType,
  errorFileNote: null, // free text
  // assignee đã chuyển sang lưu user._id (không qua workshop_config). Validate
  // qua `assertAssigneeUserValid` thay vì `assertValueAllowed`.
  assignee: null,
  assigneeNote: WorkshopConfigCategory.AssigneeNote,
  fabricType: WorkshopConfigCategory.FabricType,
  machineNumber: WorkshopConfigCategory.Machine,
  productionError: WorkshopConfigCategory.ProductionError,
  productionErrorNote: null, // free text
  // Fixed enum ('designer'|'factory'|'tool-check') — không qua workshop_config.
  productionErrorSource: null,
  // Không phải workshop_config — validate riêng qua nhánh `priority` trong
  // updateField/bulkUpdateField (chỉ nhận '1'|'2'|'3'|null).
  priority: null,
};

const ADMIN_ROLES: RoleType[] = [RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager];

const FIELD_EDIT_ROLES: Record<OrderWorkshopField, RoleType[]> = {
  printStatus: [...ADMIN_ROLES, RoleType.Fulfillment],
  printStatusNote: [...ADMIN_ROLES, RoleType.Fulfillment],
  // Support cần edit 5 field này (kết quả tool / note / errorFile / note / máy)
  // permanently — KHÔNG bị reset mỗi lần deploy. Hard-code ở đây = source of
  // truth (fallback ưu tiên cao hơn permission-catalog vì map này luôn được
  // check khi `assertCanEditField`). Xem comment §2 ở method dưới.
  toolResult: [...ADMIN_ROLES, RoleType.Support, RoleType.DesignerLeader, RoleType.Designer],
  // Phase 3 Designer-Task-Workflow: `toolResultNote` không cho sub-designer sửa
  // tay nữa — derive auto khi designer transition 'complete' (state machine set
  // 'ok'). Leader/Admin/Support vẫn override được nếu cần.
  toolResultNote: [...ADMIN_ROLES, RoleType.Support, RoleType.DesignerLeader],
  errorFile: [...ADMIN_ROLES, RoleType.Support, RoleType.DesignerLeader, RoleType.Designer],
  errorFileNote: [...ADMIN_ROLES, RoleType.Support, RoleType.DesignerLeader, RoleType.Designer],
  // Phase 3: chỉ Leader/Admin assign task. Sub-designer transition qua endpoint
  // riêng `POST /orders/:id/designer-transition`.
  assignee: [...ADMIN_ROLES, RoleType.DesignerLeader],
  assigneeNote: [...ADMIN_ROLES, RoleType.DesignerLeader, RoleType.Designer],
  // Fabric is admin-managed (it's a product attribute, not a workshop status).
  fabricType: ADMIN_ROLES,
  // Máy: xưởng (Leader/Designer/Fulfillment/Support) tự đổi máy nếu phải chuyển
  // máy in, không cần đợi admin sửa ProductConfig + backfill lại.
  machineNumber: [...ADMIN_ROLES, RoleType.Support, RoleType.DesignerLeader, RoleType.Designer, RoleType.Fulfillment],
  // Fulfillment (xưởng) là người báo lỗi sản xuất → cần quyền edit.
  productionError: [...ADMIN_ROLES, RoleType.Fulfillment],
  productionErrorNote: [...ADMIN_ROLES, RoleType.Fulfillment],
  productionErrorSource: [...ADMIN_ROLES, RoleType.DesignerLeader, RoleType.Fulfillment],
  // Ưu tiên là quyết định điều phối — chỉ admin-tier + leader gán.
  priority: [...ADMIN_ROLES, RoleType.DesignerLeader],
};

const READY_FOR_FULFILL_CODE = 'ok';
/**
 * Mã `toolResultNote` = "Lỗi" (workshop_config category tool_result_note, seed
 * mặc định) — DUY NHẤT mã kích hoạt auto-gán designer theo xưởng. Các mã khác
 * != 'ok' (vd 'no-tool' "Không có tool", 'no-pdf' "Không có file PDF") KHÔNG
 * tự gán — không phải lỗi thiết kế cần designer sửa, chỉ là đơn chưa đủ điều
 * kiện soát (thiếu tool/PDF), auto-gán sẽ giao nhầm việc cho designer.
 */
const TOOL_CHECK_ERROR_CODE = 'error';

/**
 * Lease window cho `getNextDesignReviewOrder()` — client xử lý xong 1 đơn mất
 * ~1-2 phút (theo khảo sát thực tế); đặt gấp ~1.5x để chừa buffer cho mạng
 * chậm mà vẫn nhả lại nhanh nếu client crash giữa chừng. Tinh chỉnh sau bằng
 * cách sửa trực tiếp hằng số này, không cần đổi code gọi.
 */
const DESIGN_REVIEW_CLAIM_LEASE_MS = 3 * 60 * 1000;

/**
 * Patch để đẩy đơn vào fulfillment stage Print — entry point thứ 2 ngoài
 * `DesignerTaskService.transition(complete)`.
 *
 * Trigger: `toolResultNote` chuyển sang 'ok' (qua updateField / bulkUpdateField /
 * importRework) MÀ đơn chưa từng vào fulfillment (`!currentFulfillmentStage`).
 *
 * Caller phải tự check `!before.currentFulfillmentStage` trước khi spread vào
 * $set — nếu apply lên đơn đang chạy giữa flow sẽ ghi đè state hiện tại.
 * Đồng bộ với hook ở `DesignerTaskService.transition()` ~line 83.
 * Xem `documents/FunctionDescription/FulfillmentWorkflow.md` §2.1b.
 *
 * Là factory function (không phải const) vì `waitingAt = new Date()` cần
 * evaluate mỗi lần gọi — const với `as const` sẽ freeze timestamp ở module load.
 */
function buildFulfillmentEntrySet(): Record<string, unknown> {
  return {
    currentFulfillmentStage: FulfillmentStage.Print,
    'fulfillmentStages.print': {
      status: FulfillmentStageStatus.Waiting,
      reworkCount: 0,
      workMs: 0,
      waitingAt: new Date(),
    },
  };
}

/** Field workshop có schema array thay vì string đơn. */
const MULTI_VALUE_FIELDS: OrderWorkshopField[] = ['errorFile'];


/**
 * Normalize giá trị PATCH cho field workshop trước khi $set vào DB.
 *
 * - Multi-value fields (`errorFile`): coerce về `string[]` hoặc null. String
 *   đơn → wrap thành 1-element array (back-compat client cũ). Array rỗng / null
 *   / chuỗi rỗng → null (clear).
 * - Single-value fields: array vào → lấy phần tử đầu hoặc null. String rỗng →
 *   null. Khác giữ nguyên.
 */
function normalizeFieldValue(
  field: OrderWorkshopField,
  value: string | string[] | null | undefined,
): string | string[] | null {
  if (MULTI_VALUE_FIELDS.includes(field)) {
    if (value == null) return null;
    const arr = Array.isArray(value) ? value : [value];
    // Defensive flatten + filter: phòng client gửi nested array (vd
    // `[['vien-co']]`) hoặc element non-string. Mặc dù Zod schema đã chặn,
    // vẫn giữ guard để service không bao giờ ghi shape rác xuống DB.
    const cleaned = (arr as unknown[])
      .flat(2) // 2 levels là đủ cho mọi trường hợp realistic
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim());
    return cleaned.length > 0 ? cleaned : null;
  }
  if (Array.isArray(value)) return value[0]?.trim() || null;
  if (value === '' || value == null) return null;
  return value;
}

/**
 * Mã printStatus đại diện cho đơn đã in xong qua máy đó. Workshop set
 * printStatus = "machine-N" để đánh dấu đơn vừa in xong qua máy N. Bất kỳ
 * code nào khác (vd. "in-progress", "queued") coi như đang in.
 *
 * Dùng chung giữa `getStatusOverview()`, `getFactoryOverview()`, và filter
 * `printStage` của list orders để 3 chỗ luôn nhất quán.
 */
const PRINTED_MACHINE_CODES = ['machine-1', 'machine-2', 'machine-3', 'machine-4', 'machine-94'];

const ORDER_LIST_CACHE_PREFIX = 'orders:list:';
const ORDER_LIST_CACHE_TTL_SECONDS = 60;

// So sánh snapshot địa chỉ ship lúc `recoverHeldOrders()` — xem method đó.
const ADDRESS_FIELDS: Array<keyof ProductionOrderShippingAddress> = [
  'firstName',
  'lastName',
  'company',
  'address1',
  'address2',
  'city',
  'state',
  'postcode',
  'country',
  'email',
  'phone',
];

/**
 * ORD-6 — mã `printMethod` (danh mục `workshop_config` category `print_method`)
 * được coi là in DTF. Danh mục thật hiện có: dtg · dtf · sublimation · embroidery.
 */
const DTF_PRINT_METHOD_CODE = 'dtf';

/**
 * ORD-6 — quy ước CŨ của tool: mã chạy tool đúng chữ `TIFF` nghĩa là đơn in DTF.
 * GIỮ LẠI vì tool bản đang chạy ở xưởng dựa vào nó; nay chỉ là đường phụ, đường
 * chính là `printMethod` của sản phẩm.
 */
const LEGACY_DTF_PRODUCT_CODE = 'TIFF';

/** Phần cấu hình sản phẩm mà design review cần đọc — xem `OrderService.toDesignReviewOrder`. */
type DesignReviewProductDoc = {
  designReviewCode?: string;
  printMethod?: string;
  printArea?: ProductPrintArea;
  variations?: ProductVariation[];
};

/** Field cần cho `getNextDesignReviewOrder`/`getDesignReviewOrderByProductionId` — xem `OrderService.toDesignReviewOrder`. */
type DesignReviewSourceDoc = {
  productionId: string;
  orderId?: string;
  type?: string;
  color?: string;
  size?: string;
  designs?: DesignFields;
  mockupUrl?: string;
  inProductionAt?: Date;
};

/**
 * Parse `yyyy-mm-dd` (hoặc full ISO) thành UTC Date tương ứng với VN local
 * midnight / end-of-day. JS `new Date("2026-06-22")` parse là UTC midnight =
 * 07:00 sáng VN — sai cho user input là "ngày 22-06 theo giờ VN".
 */
function vnDayStart(yyyymmdd: string): Date {
  return new Date(yyyymmdd.slice(0, 10) + 'T00:00:00+07:00');
}
function vnDayEnd(yyyymmdd: string): Date {
  return new Date(yyyymmdd.slice(0, 10) + 'T23:59:59.999+07:00');
}
function vnTodayString(): string {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return vnNow.toISOString().slice(0, 10);
}
function vnTodayStart(): Date {
  return vnDayStart(vnTodayString());
}

/**
 * Parse string ngày-giờ từ sheet import. Interpret là **VN local time** nếu
 * không có tz info — vì khách lên đơn theo giờ VN. Giữ đầy đủ HH:mm:ss.
 *
 *  "2026-06-22 00:30:48"        → 2026-06-21T17:30:48Z (VN local)
 *  "2026-06-22T00:30:48"        → 2026-06-21T17:30:48Z
 *  "2026-06-22"                 → 2026-06-21T17:00:00Z (00:00 VN)
 *  "2026-06-22T00:30:48Z"       → 2026-06-22T00:30:48Z (đã có tz, parse thẳng)
 */
/** Bỏ dấu tiếng Việt + lowercase + collapse whitespace. Dùng cho match
 * workshop_config name và user fullName từ sheet (sheet không có dấu). */
function normalizeVN(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function parseImportDate(raw?: string): Date | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) {
    const [, y, mo, d, h = '00', mi = '00', se = '00', tz] = iso;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${tz ?? '+07:00'}`);
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? undefined : fallback;
}

/**
 * So sánh ổn định (key sort trước khi stringify) cho diff field lúc re-import
 * (`importOrders()`) — tránh false-positive "đổi" chỉ vì thứ tự key trong
 * object (vd `designs`) khác nhau giữa 2 lần import dù giá trị thật giống hệt.
 */
function stableStringifyForDiff(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(stableStringifyForDiff).join(',')}]`;
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringifyForDiff(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

@Injectable()
export class OrderService implements OnModuleInit {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly productConfigRepository: ProductConfigRepository,
    private readonly workshopConfigRepository: WorkshopConfigRepository,
    private readonly orderLogService: OrderLogService,
    private readonly orderLogRepository: OrderLogRepository,
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderDocument>,
    @Inject('winston') private readonly logger: Logger,
    private readonly redisCacheService: RedisCacheService,
    private readonly factoryRepository: FactoryRepository,
    private readonly machineTypeRepository: MachineTypeRepository,
    private readonly designImageService: DesignImageService,
    @InjectQueue(DESIGN_THUMB_QUEUE) private readonly designThumbQueue: Queue<DesignImageJobData>,
    @InjectQueue(DESIGN_PREVIEW_QUEUE) private readonly designPreviewQueue: Queue<DesignImageJobData>,
    @InjectModel(UserEntity.name) private readonly userModel: Model<UserEntity>,
    private readonly roleRepository: RoleRepository,
    private readonly driveFileNameService: DriveFileNameService,
    private readonly systemConfigService: SystemConfigService,
    private readonly customerAssignmentService: CustomerAssignmentService,
    private readonly customerRepository: CustomerRepository,
    private readonly onospodOrderLookupService: OnospodOrderLookupService,
    private readonly customerOrderEventService: CustomerOrderEventService,
    private readonly shipmentIngestService: ShipmentIngestService,
  ) {}

  /**
   * Bắn sự kiện hướng ra khách khi đơn đổi trạng thái — webhook cho khách API
   * (ORD-4) + thông báo chuông portal (ORD-5), qua nguồn sự kiện DUY NHẤT.
   * Fire-and-forget hoàn toàn: service tự nuốt lỗi và chạy nền, KHÔNG chặn hay
   * làm chậm luồng nghiệp vụ. Đơn không thuộc khách nào → no-op.
   *
   * `holdReason` truyền NGUYÊN VĂN nội bộ; `CustomerOrderEventService` tự quy
   * về nhóm an toàn trước khi hiện cho khách (không phô ghi chú nội bộ).
   */
  private emitCustomerOrderEvent(
    event: CustomerWebhookEvent,
    orders: Array<{ productionId?: string; userSku?: string; userEmail?: string }>,
    opts?: { extra?: Record<string, string | null | undefined>; holdReason?: string },
  ): void {
    this.customerOrderEventService.emit(
      event,
      orders.map((o) => ({
        productionId: o.productionId,
        userSku: o.userSku,
        userEmail: o.userEmail,
        extra: opts?.extra,
        holdReason: opts?.holdReason,
      })),
    );
  }

  /** Validate giá trị assignee là userId hợp lệ (user role=Designer, ĐANG BẬT). */
  private async assertAssigneeUserValid(userId: string | null): Promise<void> {
    if (!userId) return;
    const designerRole = await this.roleRepository.findOne({ name: RoleType.Designer });
    const u = await this.userModel.findOne({ _id: userId, roleId: designerRole?._id }, { _id: 1, status: 1 }).lean();
    if (!u) {
      throw new BadRequestException(
        `User ${userId} không phải sub-designer hợp lệ (không tìm thấy hoặc không phải role Designer).`,
      );
    }
    // Không cho gán đơn MỚI cho designer đã tắt (chỉ chặn khi GÁN — đơn cũ đang
    // gán cho họ vẫn giữ nguyên để không mất lịch sử).
    if ((u as unknown as { status?: string }).status !== Status.Active) {
      throw new BadRequestException(
        `Không gán được: sub-designer này đã bị tắt. Bật lại account hoặc chọn người khác.`,
      );
    }
  }

  /**
   * One-shot backfill — every order has an `originalFactoryId` so the factory
   * transfer dashboard can tell "still here" vs "received from elsewhere".
   * Legacy rows imported before this field existed copy their current
   * `factoryId` into the new column (treats them as "pure", never transferred).
   */
  async onModuleInit() {
    // Load _id xưởng US (ngoài luồng sản xuất) TRƯỚC mọi backfill/traffic —
    // các builder filter đọc sync từ cache này (xem utils/excluded-factory.ts).
    await loadExcludedFactoryId(this.orderModel.db).catch(() => undefined);
    // Cache xưởng luồng rút gọn (flowType='merged') — transition/rework đọc sync.
    await loadFactoryFlowTypes(this.orderModel.db).catch(() => undefined);

    const result = await this.orderModel.updateMany(
      { originalFactoryId: { $exists: false }, factoryId: { $exists: true, $ne: null } },
      [{ $set: { originalFactoryId: '$factoryId' } }],
    );
    if (result.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(`[order-backfill] originalFactoryId set on ${result.modifiedCount} legacy rows`);
    }

    // Backfill productionFirstErrorAt cho đơn legacy đang lỗi mà chưa có
    // timestamp. Heuristic: dùng updatedAt làm best-effort start time (đơn
    // đang lỗi → updatedAt gần đây nhất là lần xưởng đánh lỗi/cập nhật).
    // Idempotent — chỉ set khi field chưa tồn tại.
    const firstErrorRes = await this.orderModel.updateMany(
      {
        productionError: { $exists: true, $nin: [null, ''] },
        productionFirstErrorAt: { $in: [null, undefined] },
        $or: [{ toolResultNote: { $ne: 'ok' } }, { toolResultNote: { $exists: false } }],
      },
      [{ $set: { productionFirstErrorAt: '$updatedAt' } }],
    );
    if (firstErrorRes.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(`[order-backfill] productionFirstErrorAt set on ${firstErrorRes.modifiedCount} legacy error rows`);
    }

    // Cleanup ngược: đơn ĐÃ 'ok' (lỗi đã xử lý xong) nhưng còn dính
    // productionFirstErrorAt → kẹt lại trong tab "Nhật ký bù lỗi". Xảy ra với đơn
    // designer fix rework xong qua state-machine `transition(complete)` TRƯỚC KHI
    // path này clear productionFirstErrorAt (bug đã sửa). Idempotent.
    const clearFirstErrorRes = await this.orderModel.updateMany(
      { toolResultNote: 'ok', productionFirstErrorAt: { $exists: true, $ne: null } },
      { $set: { productionFirstErrorAt: null } },
    );
    if (clearFirstErrorRes.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[order-backfill] productionFirstErrorAt cleared on ${clearFirstErrorRes.modifiedCount} resolved (ok) rows`,
      );
    }

    // Backfill `toolCheckErrorNotes` (lịch sử lỗi do người soát tool đánh Note kq
    // Tool ≠ ok) từ OrderLog. Idempotent: chỉ chạy khi CHƯA đơn nào có field (lần
    // deploy đầu); về sau hook trong updateField tự bồi. $set chỉ với đơn chưa có.
    const tcnBackfilled = await this.orderModel.exists({ 'toolCheckErrorNotes.0': { $exists: true } });
    if (!tcnBackfilled) {
      const tcnRows = await this.orderLogRepository.aggregateToolCheckErrorNotes();
      const tcnOps = tcnRows
        .filter((r) => r.orderId && Array.isArray(r.notes) && r.notes.length)
        .map((r) => ({
          updateOne: {
            filter: { _id: r.orderId, toolCheckErrorNotes: { $exists: false } },
            update: { $set: { toolCheckErrorNotes: r.notes } },
          },
        }));
      if (tcnOps.length) {
        const tcnRes = await this.orderModel.bulkWrite(tcnOps, { ordered: false });
        // eslint-disable-next-line no-console
        console.log(`[order-backfill] toolCheckErrorNotes seeded on ${tcnRes.modifiedCount} orders`);
      }
    }

    // Migrate `errorFile` từ string đơn → array. Idempotent: chỉ chạy với row
    // có $type='string'. Sau migrate: errorFile luôn là array (hoặc null).
    const errorFileMigrateRes = await this.orderModel.updateMany({ errorFile: { $type: 'string' } }, [
      { $set: { errorFile: ['$errorFile'] } },
    ]);
    if (errorFileMigrateRes.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(`[order-backfill] errorFile migrated to array on ${errorFileMigrateRes.modifiedCount} legacy rows`);
    }

    // Flatten `errorFile` lồng 2 lớp (legacy `[['collar']]` → `['collar']`) ghi
    // trước khi có guard `normalizeFieldValue().flat(2)`. Nested array làm hỏng cả
    // facet ($unwind 1 lần trả về mảng con) lẫn filter ($in không khớp phần tử
    // mảng). Idempotent: `$elemMatch $type=array` chỉ match doc còn lồng; sau khi
    // flatten không phần tử nào là array nên lần boot sau không match lại.
    const errorFileFlattenRes = await this.orderModel.updateMany({ errorFile: { $elemMatch: { $type: 'array' } } }, [
      {
        $set: {
          errorFile: {
            $reduce: {
              input: '$errorFile',
              initialValue: [],
              in: {
                $concatArrays: ['$$value', { $cond: [{ $isArray: '$$this' }, '$$this', ['$$this']] }],
              },
            },
          },
        },
      },
    ]);
    if (errorFileFlattenRes.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[order-backfill] errorFile nested arrays flattened on ${errorFileFlattenRes.modifiedCount} legacy rows`,
      );
    }

    // Backfill toolCheckedAt cho đơn đã soát (toolResultNote có giá trị) nhưng
    // chưa có timestamp — best-effort dùng updatedAt. Dashboard Vòng đời chặng
    // "Soát tool" cần field này để tính throughput + thời gian TB. Idempotent.
    const toolCheckedBackfill = await this.orderModel.updateMany(
      {
        toolResultNote: { $exists: true, $nin: [null, ''] },
        toolCheckedAt: { $in: [null, undefined] },
      },
      [{ $set: { toolCheckedAt: '$updatedAt' } }],
    );
    if (toolCheckedBackfill.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(`[order-backfill] toolCheckedAt set on ${toolCheckedBackfill.modifiedCount} legacy soát-tool rows`);
    }

    // Cleanup orphan ngược: đơn đã vào pipeline (currentFulfillmentStage=print)
    // nhưng readyForFulfill=false VÀ worker chưa từng start (no firstStartedAt
    // tại Print) → clear stage. Nguyên nhân lịch sử: trước fix updateField, khi
    // admin/support set toolResultNote khỏi 'ok' thì readyForFulfill=false nhưng
    // stage không reset → FactoryOverview không đếm, my-tasks lại đếm → lệch.
    // Idempotent.
    const orphanReverseRes = await this.orderModel.updateMany(
      {
        readyForFulfill: false,
        currentFulfillmentStage: FulfillmentStage.Print,
        $or: [
          { 'fulfillmentStages.print.firstStartedAt': { $exists: false } },
          { 'fulfillmentStages.print.firstStartedAt': null },
        ],
      },
      { $set: { currentFulfillmentStage: null, fulfillmentStages: {} } },
    );
    if (orphanReverseRes.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[order-backfill] cleared stage on ${orphanReverseRes.modifiedCount} orphan-reverse orders (ready=false + stage=print + chưa start)`,
      );
    }

    // Backfill orphan thuận: đơn ready=true (toolResultNote='ok') nhưng
    // currentFulfillmentStage=null → init Print stage. Nguyên nhân lịch sử:
    // (a) đơn import / bulk-set ok trước khi hook buildFulfillmentEntrySet
    // tồn tại; (b) designer complete legacy không trigger hook.
    // → FactoryOverview đếm, my-tasks worker không đếm → worker miss đơn.
    // Aggregation pipeline để $ifNull dùng $$NOW khi inProductionAt null.
    // Idempotent — chỉ áp khi stage chưa init.
    // QUAN TRỌNG: pack complete CỐ Ý set currentFulfillmentStage=null +
    // fulfillmentCompletedAt (fulfillment-task.service transition) — nên phải
    // loại đơn đã hoàn thành + đơn đang giữ, nếu không mỗi lần restart sẽ kéo
    // ngược TOÀN BỘ đơn đã đóng hàng xong về print/waiting → xưởng làm lại oan.
    const orphanForwardRes = await this.orderModel.updateMany(
      {
        readyForFulfill: true,
        currentFulfillmentStage: { $in: [null, undefined] },
        fulfillmentCompletedAt: { $in: [null, undefined] },
        heldAt: { $in: [null, undefined] },
        cancelledAt: { $exists: false },
        deletedAt: { $exists: false },
        // Đơn xưởng US (ngoài luồng sản xuất) KHÔNG được init stage — nếu không
        // mỗi lần restart lại kéo toàn bộ đơn US ready=ok vào print/waiting.
        factoryId: productionFactoryClause(this.orderModel.db),
      },
      [
        {
          $set: {
            currentFulfillmentStage: FulfillmentStage.Print,
            'fulfillmentStages.print': {
              status: FulfillmentStageStatus.Waiting,
              reworkCount: 0,
              workMs: 0,
              waitingAt: { $ifNull: ['$inProductionAt', '$$NOW'] },
            },
          },
        },
      ],
    );
    if (orphanForwardRes.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[order-backfill] init Print stage cho ${orphanForwardRes.modifiedCount} orphan-forward orders (ready=true + stage=null)`,
      );
    }

    // Bỏ stage 'qc-sorting' (QC phân hàng kiểm) khỏi pipeline → dời đơn tồn
    // TIẾN về 'sew-in' (May nhận vào), status=waiting. Idempotent: sau lần đầu
    // không còn đơn nào ở qc-sorting nên match=0. ('qc-post-sew' chưa có đơn
    // nào nên không cần migrate — chỉ xoá khỏi enum/schema.)
    const dropQcSortingRes = await this.orderModel.updateMany({ currentFulfillmentStage: 'qc-sorting' }, [
      {
        $set: {
          currentFulfillmentStage: FulfillmentStage.SewIn,
          'fulfillmentStages.sew-in.status': FulfillmentStageStatus.Waiting,
          'fulfillmentStages.sew-in.waitingAt': '$$NOW',
          'fulfillmentStages.sew-in.reworkCount': {
            $ifNull: ['$fulfillmentStages.sew-in.reworkCount', 0],
          },
          'fulfillmentStages.sew-in.workMs': {
            $ifNull: ['$fulfillmentStages.sew-in.workMs', 0],
          },
        },
      },
    ]);
    if (dropQcSortingRes.modifiedCount > 0) {
      // eslint-disable-next-line no-console
      console.log(`[order-backfill] migrate ${dropQcSortingRes.modifiedCount} orders qc-sorting → sew-in (waiting)`);
    }
  }

  /**
   * Per-role visibility filter, applied on top of any client-side query filters.
   *
   *  - Admin / Manager / Support → no restriction (date range optional)
   *  - Designer                  → defaults to last 7 days, override via createdFrom/createdTo
   *  - Fulfillment               → defaults to last 7 days + readyForFulfill, can override date
   *
   * `readyForFulfill` is ALWAYS enforced for Fulfillment regardless of query.
   *
   * Date range semantics: the DTO fields `createdFrom`/`createdTo` are kept for
   * URL/bookmark stability but actually filter on `inProductionAt` (thời gian
   * đơn vào sản xuất theo sheet import) — đây là thời gian liên quan production,
   * không phải Mongo insert time hay marketplace order time. Áp đồng nhất với
   * sort key (xem `Orders.md` §7.0b).
   */
  /**
   * User "In" (role=Fulfillment, stage=print): xem MỌI trạng thái đơn (bỏ
   * `readyForFulfill` + window 7 ngày) NHƯNG vẫn scope theo xưởng của mình
   * (factoryId). Khác user admin (admin thấy mọi xưởng).
   * Xem documents/Plans/PrintStage-AdminTableView.md.
   */
  private isPrintAdminView(roleName?: RoleType, fulfillmentStage?: string): boolean {
    return roleName === RoleType.Fulfillment && fulfillmentStage === FulfillmentStage.Print;
  }

  /**
   * Áp filter theo trạng thái stage Fulfillment vào `filter` (mutate). Mirror
   * `FulfillmentTaskService.applyTabFilter` nhưng KHÔNG ép scope factory/ready
   * (bảng trang "In" là admin-view). `watching` cần `userId` để elemMatch
   * timeline rework-back của chính user. Dùng $and để không clobber $or sẵn có.
   */
  /**
   * Các clause "đơn đang ở phía TRƯỚC (upstream) fulfillment-stage `stg`".
   * ⚠️ Mirror với `FulfillmentTaskService.upstreamClauses` (kanban worker). Đơn
   * upstream khi: tool-check hold / designer rework / đang ở stage fulfillment trước.
   */
  private upstreamOfStageClauses(stg: string): Record<string, unknown>[] {
    const fi = FULFILLMENT_STAGE_ORDER[stg as FulfillmentStage] ?? 0;
    return [
      { productionErrorSource: 'tool-check', toolResultNote: 'error' },
      { designerStatus: 'rework' },
      { currentFulfillmentStage: { $in: FULFILLMENT_STAGES.slice(0, fi) } },
    ];
  }

  /**
   * Filter tab Nhật ký lỗi theo GÓC NHÌN CHẶNG của người xem (positional):
   *  - `todo` = chặng mình còn việc trong chu kỳ lỗi: đơn ĐANG ở chặng mình,
   *    HOẶC đơn đang ở chặng TRƯỚC (upstream) mà chặng mình đã từng làm / là
   *    người báo lỗi → "đang chờ quay lại".
   *  - `done` = chặng mình đã làm lại xong, đơn đã đi qua (downstream).
   *
   * Chặng viewer suy từ role: Fulfillment→`fulfillmentStage` (+ khóa xưởng mình),
   * Support→soát-tool, Designer(Leader)→designer, còn lại (Admin/Manager)→toàn
   * cục. Mirror positional của `applyFulfillmentStatusFilter`.
   */
  private applyErrorLogViewFilter(
    filter: Record<string, unknown>,
    tab: 'todo' | 'done',
    roleName: RoleType | undefined,
    fulfillmentStage: string | undefined,
    fulfillmentFactoryId: string | undefined,
    assigneeUserId: string | undefined,
  ): void {
    const pushAnd = (clause: Record<string, unknown>) => {
      const and = (filter.$and as unknown[] | undefined) ?? [];
      and.push(clause);
      filter.$and = and;
    };

    // ─── Fulfillment (in→đóng): positional theo stage + khóa xưởng ───
    if (
      roleName === RoleType.Fulfillment &&
      fulfillmentStage &&
      FULFILLMENT_STAGES.includes(fulfillmentStage as FulfillmentStage)
    ) {
      const stg = fulfillmentStage;
      pushAnd({
        $or: fulfillmentFactoryId
          ? [{ factoryId: fulfillmentFactoryId }, { originalFactoryId: fulfillmentFactoryId }]
          : [{ factoryId: '__no_factory__' }],
      });
      if (tab === 'todo') {
        pushAnd({
          $or: [
            { currentFulfillmentStage: stg },
            {
              $and: [
                {
                  $or: [
                    { [`fulfillmentStages.${stg}.completedAt`]: { $exists: true, $ne: null } },
                    { fulfillmentTimeline: { $elemMatch: { stage: stg, action: 'rework-back' } } },
                  ],
                },
                { $or: this.upstreamOfStageClauses(stg) },
              ],
            },
          ],
        });
      } else {
        pushAnd({ [`fulfillmentStages.${stg}.completedAt`]: { $exists: true, $ne: null } });
        pushAnd({ $nor: [...this.upstreamOfStageClauses(stg), { currentFulfillmentStage: stg }] });
      }
      return;
    }

    // ─── Support: tab tạm ẩn (soát-tool không còn hiển thị ở đây) ───
    if (roleName === RoleType.Support) {
      pushAnd({ _id: '__support_hidden__' });
      return;
    }

    // ─── Designer / DesignerLeader: đơn bị đẩy lỗi NGƯỢC từ fulfillment về
    // thiết kế để làm lại (task của mình). Base filter đã yêu cầu đơn đã vào
    // fulfillment + loại tool-check. ───
    if (roleName === RoleType.Designer || roleName === RoleType.DesignerLeader) {
      pushAnd({ assignee: assigneeUserId ?? '__no_user__' });
      if (tab === 'todo') {
        // Đơn đang nằm ở chặng thiết kế chờ designer sửa.
        pushAnd({ designerStatus: { $in: [DesignerStatus.Rework, DesignerStatus.InProgress] } });
      } else {
        // Đã sửa xong (đã đẩy lại vào fulfillment) — chỉ đơn TỪNG bị rework về designer.
        pushAnd({ designerStatus: DesignerStatus.Done });
        pushAnd({ fulfillmentTimeline: { $elemMatch: { reworkTarget: 'designer' } } });
      }
      return;
    }

    // ─── Admin/Manager/khác: TOÀN CỤC (read-only) — thấy MỌI đơn lỗi mọi xưởng,
    // positional theo CHẶNG BÁO LỖI (entry `rework-back` CUỐI trong
    // `fulfillmentTimeline`, field `stage` = chặng người báo):
    //  - todo = chặng báo lỗi CHƯA làm lại xong — đơn chưa đi QUA lại chặng đó
    //    (vị trí hiện tại <= chặng báo lỗi; đang làm lại ở designer = trước mọi chặng).
    //  - done = đã đi qua lại chặng báo lỗi / đã đóng hàng xong / đã resolve tay.
    // Đơn lỗi KHÔNG có entry rework-back (báo lỗi không đẩy lùi) → fallback
    // định nghĩa cũ: todo tới khi đóng hàng xong (`fulfillmentCompletedAt`).
    const stageList: string[] = [...FULFILLMENT_STAGES];
    const todoExpr = {
      $let: {
        vars: {
          rw: {
            $filter: {
              input: { $ifNull: ['$fulfillmentTimeline', []] },
              as: 't',
              cond: { $eq: ['$$t.action', FulfillmentTransitionAction.ReworkBack] },
            },
          },
          // Vị trí hiện tại của đơn: 999 = đã đóng hàng xong · -1 = đang làm
          // lại ở designer · else index `currentFulfillmentStage` trong chuỗi.
          curIdx: {
            $cond: [
              { $gt: ['$fulfillmentCompletedAt', null] },
              999,
              {
                $cond: [
                  { $in: ['$designerStatus', [DesignerStatus.Rework, DesignerStatus.InProgress]] },
                  -1,
                  { $indexOfArray: [stageList, '$currentFulfillmentStage'] },
                ],
              },
            ],
          },
        },
        in: {
          $cond: [
            { $eq: [{ $size: '$$rw' }, 0] },
            { $lt: ['$$curIdx', 999] },
            {
              $let: {
                vars: { lastRw: { $arrayElemAt: ['$$rw', -1] } },
                in: { $lte: ['$$curIdx', { $indexOfArray: [stageList, '$$lastRw.stage'] }] },
              },
            },
          ],
        },
      },
    };
    if (tab === 'todo') {
      pushAnd({ $expr: todoExpr });
    } else {
      pushAnd({
        $or: [{ $expr: { $not: [todoExpr] } }, { errorResolvedAt: { $exists: true, $ne: null } }],
      });
    }
  }

  /**
   * Admin/Manager "Đánh dấu hoàn thành lỗi" cho đơn tồn đọng → set
   * `errorResolvedAt` + clear `productionFirstErrorAt`. Đơn rời tab "Cần xử lý"
   * (mọi role); hiện ở tab "Đã xong" của Admin trong 14 ngày. Đảo ngược tự động
   * khi đơn bị báo lỗi mới (`setProductionError` clear `errorResolvedAt`).
   */
  async resolveError(id: string, ctx?: AuditContext): Promise<{ success: boolean }> {
    const order = await this.orderModel.findById(id).lean();
    if (!order) throw new NotFoundException('Order not found');
    const now = new Date();
    await this.orderModel.updateOne({ _id: id }, { $set: { errorResolvedAt: now, productionFirstErrorAt: null } });
    void this.orderLogService.write({
      orderId: id,
      action: 'update',
      field: 'errorResolvedAt',
      before: null,
      after: now,
      ctx,
    });
    return { success: true };
  }

  /** Đánh dấu hoàn thành lỗi HÀNG LOẠT (Admin/Manager) — xem `resolveError`. */
  async bulkResolveError(ids: string[], ctx?: AuditContext): Promise<{ modified: number }> {
    if (!ids?.length) return { modified: 0 };
    const now = new Date();
    const res = await this.orderModel.updateMany(
      { _id: { $in: ids } },
      { $set: { errorResolvedAt: now, productionFirstErrorAt: null } },
    );
    void this.orderLogService.writeMany(
      ids.map((orderId) => ({
        orderId,
        action: 'update' as const,
        field: 'errorResolvedAt',
        before: null,
        after: now,
        ctx,
      })),
    );
    return { modified: res.modifiedCount ?? 0 };
  }

  private applyFulfillmentStatusFilter(
    filter: Record<string, unknown>,
    status: 'waiting' | 'in-progress' | 'rework' | 'done' | 'fixed' | 'watching',
    stage?: string,
    userId?: string,
  ): void {
    const stg = stage || FulfillmentStage.Print;
    const pushAnd = (clause: Record<string, unknown>) => {
      const and = (filter.$and as unknown[] | undefined) ?? [];
      and.push(clause);
      filter.$and = and;
    };
    switch (status) {
      case 'waiting':
        filter.currentFulfillmentStage = stg;
        filter[`fulfillmentStages.${stg}.status`] = FulfillmentStageStatus.Waiting;
        filter.designerStatus = { $ne: 'rework' };
        // Đơn đang chờ Support soát lại (In báo lỗi tool-check) KHÔNG hiện ở
        // "Đang chờ" active — chỉ ở "Đang chờ quay lại" (watching).
        pushAnd({
          $nor: [{ productionErrorSource: 'tool-check', toolResultNote: 'error' }],
        });
        break;
      case 'in-progress':
        filter.currentFulfillmentStage = stg;
        filter[`fulfillmentStages.${stg}.status`] = FulfillmentStageStatus.InProgress;
        break;
      case 'rework':
        filter.currentFulfillmentStage = stg;
        filter[`fulfillmentStages.${stg}.status`] = FulfillmentStageStatus.Rework;
        break;
      case 'done':
        // "Đã xong" (positional) = hoàn thành, reworkCount=0, đơn đang ở phía SAU
        // (downstream: KHÔNG upstream & không đang ở stage này). Đơn bị đẩy lùi
        // phía trên → tab "Đang chờ quay lại". Mirror `applyTabFilter`.
        filter[`fulfillmentStages.${stg}.completedAt`] = { $exists: true, $ne: null };
        filter[`fulfillmentStages.${stg}.reworkCount`] = { $in: [0, null] };
        pushAnd({ $nor: [...this.upstreamOfStageClauses(stg), { currentFulfillmentStage: stg }] });
        break;
      case 'fixed':
        // "Đã sửa" = hoàn thành SAU KHI từng bị đẩy về (reworkCount>0), đơn downstream.
        filter[`fulfillmentStages.${stg}.completedAt`] = { $exists: true, $ne: null };
        filter[`fulfillmentStages.${stg}.reworkCount`] = { $gt: 0 };
        pushAnd({ $nor: [...this.upstreamOfStageClauses(stg), { currentFulfillmentStage: stg }] });
        break;
      case 'watching': {
        // "Đang chờ quay lại" (positional) = ĐÃ làm stage này (completedAt) HOẶC
        // chính mình báo lỗi (reporter timeline), VÀ đơn đang ở phía TRƯỚC mình
        // (upstream). Stage-scoped (KHÔNG lọc byUserId). Mirror `applyTabFilter`.
        void userId;
        pushAnd({
          $or: [
            { [`fulfillmentStages.${stg}.completedAt`]: { $exists: true, $ne: null } },
            { fulfillmentTimeline: { $elemMatch: { stage: stg, action: 'rework-back' } } },
          ],
        });
        pushAnd({ $or: this.upstreamOfStageClauses(stg) });
        break;
      }
    }
  }

  /**
   * Khi worker báo "Lỗi xưởng" loại = designer trên đơn ĐANG ở trong pipeline
   * fulfillment (qua cell `productionError` hoặc scan) → mirror "rework-back về
   * designer" của `FulfillmentTaskService` để đơn vào tab "Đang chờ quay lại"
   * (watching) của chính worker:
   *   - reporter stage → waiting (reworkCount++), giữ assignee/workMs hiện có.
   *   - push `fulfillmentTimeline` entry (action=rework-back, target=designer,
   *     byUserId=worker) — điều kiện match của tab watching.
   * Sau khi designer complete, hook trong `DesignerTaskService.transition()` set
   * reporter stage = rework → đơn chuyển sang tab "Cần làm lại" của worker.
   *
   * Trả về `null` khi đơn chưa vào fulfillment (`!currentFulfillmentStage`) hoặc
   * thiếu user context → caller bỏ qua phần fulfillment, chỉ flip designerStatus.
   */
  /**
   * Có nên đẩy đơn về designer (rework) khi worker báo lỗi loại designer không?
   * Fire khi designer ở done/unassigned/rejected. KHÔNG fire khi đang rework
   * (tránh báo trùng) hoặc đang in-progress/assigned (designer đang làm dở).
   */
  private canReworkBackToDesigner(current: DesignerStatus): boolean {
    return (
      current !== DesignerStatus.Rework && current !== DesignerStatus.InProgress && current !== DesignerStatus.Assigned
    );
  }

  /**
   * Đơn có được GÁN designer (bulk/single) theo trạng thái + người ôm không?
   *  - unassigned/assigned/rejected → được (assigned cho người khác → cần
   *    `reassignOthers` để ghi đè).
   *  - rework → CHỈ khi **chưa có ai ôm** (`assignee` rỗng). Có người ôm → KHÔNG
   *    (đơn đang được làm lại bởi người đó), kể cả khi bật ghi đè.
   *  - in-progress/done → không.
   */
  private canAssignDesignerByStatus(status: DesignerStatus, hasAssignee: boolean): boolean {
    if (DESIGNER_REASSIGNABLE_STATUSES.includes(status)) return true;
    if (status === DesignerStatus.Rework && !hasAssignee) return true;
    return false;
  }

  /**
   * Đơn có được đẩy về Support (soát tool) khi worker báo lỗi loại `tool-check`
   * không? Skip khi đơn đang chờ support soát lại (marker
   * `productionErrorSource='tool-check' AND toolResultNote='error'`) để tránh
   * báo trùng. Ngoài ra luôn fire.
   */
  private canReworkBackToSupport(before: unknown): boolean {
    const b = before as { productionErrorSource?: string; toolResultNote?: string };
    return !(b.productionErrorSource === 'tool-check' && b.toolResultNote === 'error');
  }

  private buildDesignerReworkBackFromError(
    before: unknown,
    reason: string | null,
    ctx?: AuditContext,
    target: 'designer' | 'tool-check' = 'designer',
  ): { set: Record<string, unknown>; timelineEntry: FulfillmentTimelineEntry } | null {
    const b = before as {
      currentFulfillmentStage?: string | null;
      fulfillmentStages?: Record<string, { status?: string; reworkCount?: number } | undefined>;
    };
    const userId = ctx?.user?._id ? String(ctx.user._id) : undefined;
    if (!userId) return null;
    const existingStage = b.currentFulfillmentStage;
    // Đơn chưa vào pipeline (`currentFulfillmentStage` null) → đưa vào stage Print
    // (đầu pipeline) để worker In watch được; đơn đã ở stage X → reporter = X.
    const stage = (existingStage || FulfillmentStage.Print) as FulfillmentStage;
    const stageState = b.fulfillmentStages?.[stage] ?? {};
    const fromStatus = (stageState.status as FulfillmentStageStatus) ?? FulfillmentStageStatus.Waiting;
    const set: Record<string, unknown> = {};
    if (!existingStage) {
      // Chưa vào pipeline → khởi tạo In waiting. Sau khi target (designer/Support)
      // xong → đơn re-flow từ In.
      set.currentFulfillmentStage = FulfillmentStage.Print;
      set['fulfillmentStages.print'] = {
        status: FulfillmentStageStatus.Waiting,
        reworkCount: 0,
        workMs: 0,
        waitingAt: new Date(),
      };
    } else {
      // Đã trong pipeline → RESET về In để CHẠY LẠI TOÀN CHUỖI (In → … → reporter).
      // GIỮ `completedAt` các stage (lịch sử) — positional watching lo hiển thị
      // "Đang chờ quay lại"; auto-advance sẽ reworkCount++ khi đơn quay về từng
      // stage. KHÔNG đụng status stage reporter (đơn đã rời đó).
      set.currentFulfillmentStage = FulfillmentStage.Print;
    }
    const timelineEntry: FulfillmentTimelineEntry = {
      stage,
      action: FulfillmentTransitionAction.ReworkBack,
      fromStatus,
      toStatus: FulfillmentStageStatus.Waiting,
      byUserId: userId,
      byUserName: ctx?.user?.fullName,
      at: new Date(),
      reworkTarget: target,
      reason: reason ? reason.slice(0, 500) : undefined,
    };
    return { set, timelineEntry };
  }

  /**
   * Báo lỗi toàn cục + đẩy đơn về 1 công đoạn fulfillment TRƯỚC (kể cả khi đơn đã
   * đi qua công đoạn người báo, hoặc đã hoàn thành fulfillment). Generalize
   * `buildDesignerReworkBackFromError` cho target là FulfillmentStage.
   *
   * Nguyên tắc (quyết định #4 — làm lại toàn chuỗi):
   *  - `furthest` = vị trí xa nhất đơn từng tới = currentFulfillmentStage, hoặc
   *    Pack nếu đã completed (`fulfillmentCompletedAt`), hoặc Print nếu chưa vào.
   *  - target PHẢI < furthest (chỉ lùi). target + mọi stage giữa (target, furthest]
   *    → `rework` + reworkCount++ + reworkFromStage=reporterStage.
   *  - `currentFulfillmentStage = target`; clear `fulfillmentCompletedAt` nếu reopen.
   *  - reporterStage cho timeline = user.fulfillmentStage ?? furthest → tab
   *    "Đang chờ quay lại" của công đoạn đó (Phase 2 — stage-scoped) thấy đơn.
   *
   * Trả `null` khi thiếu user context hoặc target không hợp lệ (>= furthest).
   */
  private buildFulfillmentReworkBack(
    before: unknown,
    target: FulfillmentStage,
    reason: string | null,
    ctx?: AuditContext,
  ): { set: Record<string, unknown>; timelineEntry: FulfillmentTimelineEntry } | null {
    const b = before as {
      factoryId?: string | null;
      currentFulfillmentStage?: string | null;
      fulfillmentCompletedAt?: Date | null;
      fulfillmentStages?: Record<string, { status?: string; reworkCount?: number } | undefined>;
    };
    const userId = ctx?.user?._id ? String(ctx.user._id) : undefined;
    if (!userId) return null;

    // Xưởng luồng rút gọn: đích là AUTO-STAGE (merged: Ép/May ra — no-sew:
    // May vào/May ra) → redirect lùi về công đoạn thường gần nhất phía trước —
    // đơn không bao giờ dừng ở auto-stage nên lùi về đó sẽ kẹt (không có
    // worker giữ stage).
    target = redirectAutoTarget(
      getFactoryFlowTypeSync(this.orderModel.db, b.factoryId),
      target,
      getFactoryAutoPackSync(this.orderModel.db, b.factoryId),
    );

    const current = (b.currentFulfillmentStage || undefined) as FulfillmentStage | undefined;
    const furthest: FulfillmentStage =
      current ?? (b.fulfillmentCompletedAt ? FulfillmentStage.Pack : FulfillmentStage.Print);
    const targetIdx = FULFILLMENT_STAGE_ORDER[target];
    const furthestIdx = FULFILLMENT_STAGE_ORDER[furthest];
    // Chỉ lùi. Nếu đơn chưa vào pipeline (furthest=Print) và target=Print → không
    // có gì để lùi → bỏ qua (caller vẫn set productionError bình thường).
    if (targetIdx >= furthestIdx) return null;

    const now = new Date();
    const set: Record<string, unknown> = {
      currentFulfillmentStage: target,
      readyForFulfill: false,
    };
    // Reopen đơn đã hoàn thành.
    if (b.fulfillmentCompletedAt) set.fulfillmentCompletedAt = null;

    // CHỈ target → rework (đơn về đó ngay). Các stage giữa (target, furthest] GIỮ
    // nguyên `done`/`completedAt` (lịch sử) — positional watching cho chúng vào
    // "Đang chờ quay lại" khi đơn upstream; auto-advance reworkCount++ khi đơn
    // thực sự quay về từng stage → "chạy lại toàn chuỗi" mà không double-count.
    const prevTarget = b.fulfillmentStages?.[target] ?? {};
    set[`fulfillmentStages.${target}.status`] = FulfillmentStageStatus.Rework;
    set[`fulfillmentStages.${target}.reworkAt`] = now;
    set[`fulfillmentStages.${target}.reworkFromStage`] = furthest;
    set[`fulfillmentStages.${target}.reworkReason`] = reason ? reason.slice(0, 500) : undefined;
    set[`fulfillmentStages.${target}.reworkCount`] = (prevTarget.reworkCount ?? 0) + 1;

    // reporterStage = công đoạn user đang giữ (nếu có) để watch; nếu không (admin
    // /support quét) → dùng furthest (điểm bị chặn xa nhất) để có stage watch.
    const reporterStage =
      (ctx?.user as { fulfillmentStage?: FulfillmentStage } | undefined)?.fulfillmentStage ?? furthest;
    const timelineEntry: FulfillmentTimelineEntry = {
      stage: reporterStage,
      action: FulfillmentTransitionAction.ReworkBack,
      fromStatus: FulfillmentStageStatus.Done,
      toStatus: FulfillmentStageStatus.Rework,
      byUserId: userId,
      byUserName: ctx?.user?.fullName,
      at: now,
      reworkTarget: target,
      reason: reason ? reason.slice(0, 500) : undefined,
    };
    return { set, timelineEntry };
  }

  /**
   * Đếm số đơn theo 5 trạng thái stage Fulfillment (bảng trang "In"). Dùng
   * cùng base filter với bảng (admin-view khi print) nhưng KHÔNG kèm
   * `fulfillmentStatus` để đếm đủ cả 5.
   */
  async getFulfillmentStatusCounts(
    dto: GetProductionOrdersDto,
    roleName?: RoleType,
    assigneeCode?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<{
    success: true;
    data: {
      all: number;
      waiting: number;
      inProgress: number;
      rework: number;
      done: number;
      fixed: number;
      watching: number;
    };
  }> {
    const baseDto = { ...dto, fulfillmentStatus: undefined } as GetProductionOrdersDto;
    const base = this.buildOrderListFilter(baseDto, roleName, assigneeCode, fulfillmentFactoryId, fulfillmentStage);
    const statuses = ['waiting', 'in-progress', 'rework', 'done', 'fixed', 'watching'] as const;
    const [all, waiting, inProgress, rework, done, fixed, watching] = await Promise.all([
      // "Tất cả" = tổng đơn theo filter hiện tại (không kèm fulfillmentStatus).
      this.orderModel.countDocuments(base),
      ...statuses.map((s) => {
        // Clone nông + clone riêng `$and` (nếu có) để pushAnd không mutate base.
        // KHÔNG tạo `$and: []` rỗng — Mongo cấm `$and` mảng rỗng (lỗi với các
        // status không thêm $and như waiting/in-progress/rework).
        const f: Record<string, unknown> = { ...base };
        if (Array.isArray(base.$and)) f.$and = [...(base.$and as unknown[])];
        this.applyFulfillmentStatusFilter(f, s, fulfillmentStage, assigneeCode);
        return this.orderModel.countDocuments(f);
      }),
    ]);
    return {
      success: true,
      data: { all, waiting, inProgress, rework, done, fixed, watching },
    };
  }

  private buildVisibilityFilter(
    roleName?: RoleType,
    dto?: GetProductionOrdersDto,
    /** = user._id của Designer (sub) — dùng để filter task của mình. */
    assigneeUserId?: string,
    /** = user.factoryId của Fulfillment — scope đơn ở factory này hoặc transfer từ factory này. */
    fulfillmentFactoryId?: string,
    /** = user.fulfillmentStage — stage=print được mở admin-like. */
    fulfillmentStage?: string,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    // Date math theo VN tz: window = [VN today − 6 ngày 00:00, VN today 23:59].
    const todayStart = vnTodayStart();
    const endOfToday = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const startOfWindow = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);

    const hasDateOverride = !!(dto?.createdFrom || dto?.createdTo);
    const buildRange = () => {
      const range: Record<string, Date> = {};
      if (dto?.createdFrom) range.$gte = vnDayStart(dto.createdFrom);
      if (dto?.createdTo) range.$lte = vnDayEnd(dto.createdTo);
      return range;
    };

    if (roleName === RoleType.Designer) {
      // Sub-designer chỉ thấy task của mình (assignee = user._id).
      filter.assignee = assigneeUserId || '__no_user__';
      if (hasDateOverride) filter.inProductionAt = buildRange();
    } else if (roleName === RoleType.Fulfillment) {
      if (this.isPrintAdminView(roleName, fulfillmentStage)) {
        // User In: thấy MỌI trạng thái (kể cả lỗi / chưa ok), bỏ window 7 ngày
        // (chỉ áp date khi user chủ động truyền) — NHƯNG vẫn CHỈ trong xưởng
        // mình. Dùng equality `factoryId` (đơn đang ở xưởng mình); KHÔNG gồm
        // `originalFactoryId` vì đơn đã transfer đi nơi khác do xưởng kia in.
        if (hasDateOverride) filter.inProductionAt = buildRange();
        filter.factoryId = fulfillmentFactoryId || '__no_factory__';
      } else {
        filter.inProductionAt = hasDateOverride ? buildRange() : { $gte: startOfWindow, $lte: endOfToday };
        filter.readyForFulfill = true;
        // Per-factory scope: thấy đơn đang ở xưởng mình HOẶC đơn đã transfer từ
        // xưởng mình đi nơi khác (origin = mình). Nếu user chưa gán factoryId →
        // trả empty thay vì rò rỉ data.
        if (fulfillmentFactoryId) {
          filter.$or = [{ factoryId: fulfillmentFactoryId }, { originalFactoryId: fulfillmentFactoryId }];
        } else {
          filter.factoryId = '__no_factory__';
        }
      }
    } else if (hasDateOverride) {
      filter.inProductionAt = buildRange();
    }

    // Đơn chưa map xưởng (factoryId null/missing) VÀ đơn xưởng US (ngoài luồng
    // sản xuất) bị loại khỏi MỌI view mặc định — unmapped xem qua trang "Không
    // xác định xưởng" (dto.unmapped=true), đơn US chỉ xem ở tab Đơn hàng theo
    // xưởng, khi lọc tường minh factoryId, hoặc khi caller xin tường minh qua
    // `dto.includeExcludedFactory` (ORD-19 — chỉ trang Danh sách đơn classic
    // gửi cờ này; đơn chưa map xưởng vẫn bị loại). Xem Orders.md §21.
    // Designer/Fulfillment branch ở trên đã tự loại trừ null qua equality/$or
    // factoryId cụ thể nên không cần áp lại ở đây (tránh set field 2 lần).
    if (dto?.unmapped !== true && filter.factoryId === undefined && !filter.$or) {
      filter.factoryId =
        dto?.includeExcludedFactory === true
          ? { $exists: true, $ne: null }
          : productionFactoryClause(this.orderModel.db);
    }

    return filter;
  }

  /**
   * Gate edit cho 1 field workshop. Logic (theo thứ tự ưu tiên):
   *   1. SuperAdmin / Admin → bypass (legacy + safety net khi role chưa re-seed
   *      permissionCodes).
   *   2. Nếu user có code `order.field.<field>.edit` trong `permissionCodes`
   *      → cho phép. **Đây là source of truth** — match với FE `usePermission`
   *      và UI permission catalog. Admin enable code trên role qua UI thì
   *      role đó edit được luôn (vd. Support enable edit toolResultNote).
   *   3. Fallback: hard-coded `FIELD_EDIT_ROLES` map (giữ để khỏi vỡ role chưa
   *      có permissionCodes — sẽ remove khi mọi role đã seed đủ codes).
   */
  private assertCanEditField(field: OrderWorkshopField, roleName?: RoleType, permissionCodes?: string[]): void {
    if (roleName === RoleType.SuperAdmin || roleName === RoleType.Admin) return;

    const requiredCode = `order.field.${field}.edit`;
    if (permissionCodes && permissionCodes.includes(requiredCode)) return;

    const allowed = FIELD_EDIT_ROLES[field];
    if (roleName && allowed.includes(roleName)) return;

    throw new ForbiddenException(
      `Role '${roleName ?? 'unknown'}' không có quyền edit field "${field}" — cần permission '${requiredCode}'.`,
    );
  }

  private async assertValueAllowed(field: OrderWorkshopField, value: string | string[] | null): Promise<void> {
    if (value === null || value === '') return;
    const category = FIELD_CONFIG_CATEGORY[field];
    if (!category) return; // free text field, no validation
    const codes = Array.isArray(value) ? value.filter(Boolean) : [value];
    if (codes.length === 0) return;
    // Một query lấy tất cả codes hợp lệ → compare set để báo code thiếu.
    const found = await this.workshopConfigRepository.findAll({
      category,
      code: { $in: codes },
      isActive: true,
    });
    const foundCodes = new Set(found.map((f) => f.code));
    const missing = codes.filter((c) => !foundCodes.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(`Invalid value(s) "${missing.join(', ')}" for field "${field}"`);
    }
  }

  /** `priority` không qua workshop_config — chỉ nhận '1'|'2'|'3' hoặc null (bỏ chọn). */
  private assertPriorityValueValid(value: string | string[] | null): void {
    const v = Array.isArray(value) ? value[0] ?? null : value;
    if (v !== null && v !== '' && !['1', '2', '3'].includes(v)) {
      throw new BadRequestException(`Invalid priority value "${v}"`);
    }
  }

  private buildListCacheKey(dto: GetProductionOrdersDto, roleName?: RoleType): string {
    const norm = {
      page: dto.page,
      limit: dto.limit,
      sort: dto.sort,
      order: dto.order,
      search: dto.search,
      isMapped: dto.isMapped,
      factoryId: dto.factoryId,
      machineTypeId: dto.machineTypeId,
      status: dto.status,
      printStatus: dto.printStatus,
      toolResultNote: dto.toolResultNote,
      assignee: dto.assignee,
      errorFile: dto.errorFile,
      productionError: dto.productionError,
      hasError: dto.hasError,
      createdFrom: dto.createdFrom,
      createdTo: dto.createdTo,
      role: roleName ?? '',
    };
    return ORDER_LIST_CACHE_PREFIX + Buffer.from(JSON.stringify(norm)).toString('base64');
  }

  // Public để `OnospodHoldSyncService` (ghi thẳng Mongo) xóa cache danh sách sau khi đổi trạng thái giữ.
  async invalidateListCache(): Promise<void> {
    try {
      const keys = await this.redisCacheService.findKeysByPrefix(ORDER_LIST_CACHE_PREFIX);
      if (keys.length === 0) return;
      await Promise.all(keys.map((k) => this.redisCacheService.deleteKey(k)));
      // eslint-disable-next-line no-console
      console.log(`[cache] invalidated ${keys.length} order list keys`);
    } catch (error) {
      console.warn('[cache] invalidate failed:', error);
    }
  }

  /**
   * Biểu thức aggregation trả KHÓA CHẶNG hiện tại của đơn (`WORKSHOP_STAGE_FILTER_KEYS`)
   * — MIRROR `computeCurrentStage()` (customer-order.service.ts) và `getOrderStatusInfo()`
   * (FE `orderStatusLabel.ts`): đã đóng hàng → `done`; có `currentFulfillmentStage` →
   * chính chặng đó; `designerStatus` khác unassigned → `done` thì `print`, còn lại
   * `designer`; chưa có `toolResultNote` → `tool-check`, có → `designer`. Đổi luật ở
   * đây phải đổi cả hai nơi kia. Dùng cho filter `workshopStage` + đếm ô phễu.
   */
  private workshopStageExpr(): Record<string, unknown> {
    // Thân biểu thức ở `utils/workshop-stage.ts` — dùng chung với CEO Dashboard.
    return workshopStageSwitchExpr();
  }

  /**
   * Điều kiện truy vấn THƯỜNG cho 1 chặng — CÙNG luật với `workshopStageExpr()` ở trên
   * (biểu thức chỉ dùng được trong aggregate). Hai hàm phải cho cùng kết quả: tổng khi
   * lọc `workshopStage=X` phải bằng đúng số ô X của phễu. Đổi một hàm thì đổi cả hai.
   */
  private workshopStageMatch(stage: WorkshopStageFilterKey): Record<string, unknown> {
    const notCompleted = { fulfillmentCompletedAt: { $in: [null] } }; // missing hoặc null
    const noStage = { currentFulfillmentStage: { $in: [null, ''] } };
    const unassigned = { designerStatus: { $in: [null, '', DesignerStatus.Unassigned] } };
    switch (stage) {
      case 'done':
        return { fulfillmentCompletedAt: { $exists: true, $ne: null } };
      case 'print':
        // Đang ở chặng In, HOẶC designer đã xong nhưng chưa vào công đoạn nào.
        return {
          ...notCompleted,
          $or: [
            { currentFulfillmentStage: 'print' },
            { ...noStage, designerStatus: DesignerStatus.Done },
          ],
        };
      case 'designer':
        return {
          ...notCompleted,
          ...noStage,
          $or: [
            { designerStatus: { $nin: [null, '', DesignerStatus.Unassigned, DesignerStatus.Done] } },
            { ...unassigned, toolResultNote: { $nin: [null, ''] } },
          ],
        };
      case 'tool-check':
        return { ...notCompleted, ...noStage, ...unassigned, toolResultNote: { $in: [null, ''] } };
      default:
        return { ...notCompleted, currentFulfillmentStage: stage };
    }
  }

  /** Compose the Mongo filter for getOrders + getOrdersGroupedByType. */
  private buildOrderListFilter(
    dto: GetProductionOrdersDto,
    roleName?: RoleType,
    assigneeCode?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
    // ToolResult codes "Có tool" (name ^Có) — chỉ cần khi dto.designerStatus dùng
    // token tách tool `__unassigned_(no)tool__`. Caller resolve async rồi truyền.
    toolHasCodes?: string[],
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = this.buildVisibilityFilter(
      roleName,
      dto,
      assigneeCode,
      fulfillmentFactoryId,
      fulfillmentStage,
    );
    if (dto.search) {
      const searchOr = buildSearchOr(dto.search);
      if (searchOr.length) filter.$or = searchOr;
    }
    if (dto.productionIds) {
      const ids = dto.productionIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length) {
        // Exact, case-insensitive per mã — mirror getByProductionId/lifecycle-track.
        filter.productionId = {
          $in: ids.map((id) => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')),
        };
      }
    }
    if (dto.ids) {
      const ids = dto.ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length) filter._id = { $in: ids };
    }
    if (typeof dto.isMapped === 'boolean') filter.isMapped = dto.isMapped;
    // Toggle "Đang giữ" (workshop): held=true → chỉ đơn giữ; held=false → chỉ
    // đơn không giữ. Không truyền → hiện cả 2 (đơn giữ chỉ tô xám, không ẩn).
    if (typeof dto.held === 'boolean') filter.heldAt = { $exists: dto.held };
    // Lọc theo lý do giữ — exact match, field chỉ tồn tại khi đang giữ (unset
    // cùng heldAt lúc mở giữ) nên tự ngụ ý held=true, không cần kết hợp thêm.
    if (dto.holdReason) filter.holdReason = dto.holdReason;
    // Toggle "Đã hủy": true → CHỈ đơn đã hủy; mặc định (không bật) → LOẠI đơn đã
    // hủy khỏi list + mọi facet. Đơn hủy chỉ xem qua toggle "Đã hủy" (hoặc dialog
    // "Đơn đã hủy" riêng). Áp cho mọi caller của buildOrderListFilter.
    filter.cancelledAt = { $exists: dto.cancelled === true };
    if (dto.factoryId) filter.factoryId = dto.factoryId;
    if (dto.machineTypeId) filter.machineTypeId = dto.machineTypeId;
    if (dto.status) filter.status = dto.status;
    if (dto.printStatus) filter.printStatus = { $in: dto.printStatus.split(',').filter(Boolean) };
    if (dto.toolResultNote) {
      // Token đặc biệt __none__ ↔ "Chưa soát" (chưa có note kq tool nào set).
      // Bao gồm field missing, null, hoặc empty string. Mirror logic assignee.
      // __any__ = đã soát (note bất kỳ) · __error__ = đã soát & ≠ 'ok' — drill
      // hàng "Đã soát"/"Soát lỗi" dải Tổng quan theo ngày tab Soát tool
      // ($nin [null] tự loại cả field missing).
      const codes = dto.toolResultNote.split(',').filter(Boolean);
      const hasNone = codes.includes('__none__');
      const real = codes.filter((c) => c !== '__none__');
      if (codes.includes('__any__')) {
        filter.toolResultNote = { $nin: [null, ''] };
      } else if (codes.includes('__error__')) {
        filter.toolResultNote = { $nin: [null, '', 'ok'] };
      } else if (hasNone && real.length === 0) {
        filter.toolResultNote = { $in: [null, ''] };
      } else if (hasNone) {
        filter.$or = [
          ...(Array.isArray(filter.$or) ? (filter.$or as unknown[]) : []),
          { toolResultNote: { $in: [null, ''] } },
          { toolResultNote: { $in: real } },
        ];
      } else {
        filter.toolResultNote = { $in: real };
      }
    }
    if (dto.errorFile) {
      // Token __any__ = đơn có ÍT NHẤT 1 mã file lỗi — pill "Lỗi file" trang xưởng.
      const codes = dto.errorFile.split(',').filter(Boolean);
      if (codes.includes('__any__')) filter['errorFile.0'] = { $exists: true };
      else filter.errorFile = { $in: codes };
    }
    // Factory tab filters — exact product name / fabric code / tool code.
    if (dto.type) {
      const { names, hasNone } = parseTypeFilter(dto.type);
      // Token __none__ = đơn chưa xác định loại sản phẩm — mirror toolResult/
      // toolResultNote/assignee. Workshop gom nhóm bằng $ifNull nên VẪN hiện
      // nhóm "đơn không tên"; thiếu nhánh này thì 2 trang lệch ngay khi có 1 đơn
      // thiếu `type` (xem .devtasks/design/ORD-1.md D2).
      if (hasNone && names.length === 0) {
        filter.type = { $in: [null, ''] };
      } else if (hasNone) {
        filter.$or = [
          ...(Array.isArray(filter.$or) ? (filter.$or as unknown[]) : []),
          { type: { $in: [null, ''] } },
          { type: { $in: names } },
        ];
      } else if (names.length > 0) {
        filter.type = { $in: names };
      }
    }
    if (dto.userSku) filter.userSku = { $in: dto.userSku.split(',').filter(Boolean) };
    // Exact-pair với userSku — drill-down "Đơn hàng của khách" ở /adm/customers
    // (email so khớp không phân biệt hoa/thường, khớp customerMatchKey).
    if (dto.userEmail?.trim()) {
      filter.userEmail = { $regex: `^${escapeRegex(dto.userEmail.trim())}$`, $options: 'i' };
    }
    if (dto.fabricType) filter.fabricType = { $in: dto.fabricType.split(',').filter(Boolean) };
    if (dto.toolResult) {
      // Token đặc biệt __none__ ↔ "Chưa xác định" (chưa soát toolResult) — mirror
      // logic toolResultNote/assignee ở trên.
      const codes = dto.toolResult.split(',').filter(Boolean);
      const hasNone = codes.includes('__none__');
      const real = codes.filter((c) => c !== '__none__');
      if (hasNone && real.length === 0) {
        filter.toolResult = { $in: [null, ''] };
      } else if (hasNone) {
        filter.$or = [
          ...(Array.isArray(filter.$or) ? (filter.$or as unknown[]) : []),
          { toolResult: { $in: [null, ''] } },
          { toolResult: { $in: real } },
        ];
      } else {
        filter.toolResult = { $in: real };
      }
    }
    if (dto.machineNumber) {
      filter.machineNumber = { $in: dto.machineNumber.split(',').filter(Boolean) };
    }
    if (dto.priority === '__any__') filter.priority = { $exists: true, $nin: [null, 0] };
    else if (dto.priority) filter.priority = Number(dto.priority);
    if (dto.designerStatus) {
      const codes = dto.designerStatus.split(',').filter(Boolean);
      // Token tách "Chưa gán" theo tool (dropdown TT Designer + click KPI panel):
      //  __unassigned_notool__ / __unassigned_tool__ = chưa gán & toolResultNote≠'ok'
      //  & toolResult KHÔNG/CÓ thuộc nhóm "Có tool" (name ^Có = `toolHasCodes`).
      //  "Không tool" gồm cả đơn CHƯA soát toolResult ($nin match null/empty/missing).
      const hasNoTool = codes.includes('__unassigned_notool__');
      const hasWithTool = codes.includes('__unassigned_tool__');
      const rest = codes.filter((c) => c !== '__unassigned_notool__' && c !== '__unassigned_tool__');
      // Token đặc biệt __none__ ↔ chưa có field (data legacy)
      const hasNone = rest.includes('__none__');
      const real = rest.filter((c) => c !== '__none__');

      if (hasNoTool || hasWithTool) {
        const tc = toolHasCodes ?? [];
        filter.$and = [
          ...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []),
          { $or: [{ designerStatus: 'unassigned' }, { designerStatus: { $exists: false } }] },
          { toolResultNote: { $ne: 'ok' } },
          hasWithTool ? { toolResult: { $in: tc } } : { toolResult: { $nin: tc } },
        ];
      }

      if (real.length > 0 || hasNone) {
        if (hasNone && real.length === 0) {
          filter.designerStatus = { $exists: false };
        } else if (hasNone) {
          filter.$or = [
            ...(Array.isArray(filter.$or) ? (filter.$or as unknown[]) : []),
            { designerStatus: { $exists: false } },
            { designerStatus: { $in: real } },
          ];
        } else {
          filter.designerStatus = { $in: real };
        }
        // "Chưa gán" (unassigned/__none__) đơn thuần cũng loại đơn đã soát OK —
        // đồng bộ KPI panel `getDesignerBreakdown`. Chỉ áp khi CHỈ nhắm unassigned
        // (không lẫn status khác, tránh loại nhầm đơn 'ok' đã gán). $and push để
        // không đè filter toolResultNote/$or khác.
        const onlyUnassigned = (hasNone || real.includes('unassigned')) && real.every((c) => c === 'unassigned');
        if (onlyUnassigned) {
          filter.$and = [
            ...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []),
            { toolResultNote: { $ne: 'ok' } },
          ];
        }
      }
    }
    if (dto.assignee) {
      // Token __none__ = đơn chưa gán; __any__ = đơn ĐÃ gán (bất kỳ ai — drill
      // hàng "Đã gán designer" Tổng quan N ngày, mirror match ma trận team).
      const codes = dto.assignee.split(',').filter(Boolean);
      const hasNone = codes.includes('__none__');
      const hasAny = codes.includes('__any__');
      const real = codes.filter((c) => c !== '__none__' && c !== '__any__');
      if (hasAny) {
        filter.assignee = { $exists: true, $nin: [null, ''] };
      } else if (hasNone && real.length === 0) {
        filter.assignee = { $in: [null, ''] };
      } else if (hasNone) {
        filter.$or = [
          ...(Array.isArray(filter.$or) ? (filter.$or as unknown[]) : []),
          { assignee: { $in: [null, ''] } },
          { assignee: { $in: real } },
        ];
      } else {
        filter.assignee = { $in: real };
      }
    }
    if (dto.unmapped === true) {
      // Đơn chưa map xưởng — factoryId null hoặc không tồn tại.
      const unmappedClause = [{ factoryId: { $exists: false } }, { factoryId: null }];
      if (filter.$or) {
        // Đã có $or từ filter khác (vd printStage=not-printed) — chuyển sang $and
        // để cả hai điều kiện cùng phải đúng.
        filter.$and = [{ $or: filter.$or }, { $or: unmappedClause }];
        delete filter.$or;
      } else {
        filter.$or = unmappedClause;
      }
    }
    if (dto.productionError) {
      filter.productionError = { $in: dto.productionError.split(',').filter(Boolean) };
    } else if (dto.hasError === true) {
      // hasError=true → đơn có lỗi xưởng (productionError set khác empty).
      // hasError=false không được hỗ trợ: dùng "không lọc" để xem đơn không
      // lỗi (tránh đụng `$or` với filter search/printStage).
      filter.productionError = { $exists: true, $nin: [null, ''] };
    }
    if (dto.errorSource) {
      filter.productionErrorSource = { $in: dto.errorSource.split(',').filter(Boolean) };
    }
    if (dto.toolCheckedError) {
      // Lịch sử soát ra lỗi BỀN VỮNG: `toolCheckErrorNotes` ghi khi người soát
      // đánh note ≠ 'ok' (updateField/bulk/importRework/markToolCheckDone), giữ
      // nguyên kể cả đơn đã sửa về 'ok'. '1' = từng lỗi, '0' = chưa từng.
      filter['toolCheckErrorNotes.0'] = { $exists: dto.toolCheckedError === '1' };
    }
    if (dto.rejectedBy) {
      // Sự kiện bàn giao "Không làm được" đi từ user (đếm LẦN ở ma trận/panel;
      // danh sách đơn distinct nên có thể ít hơn con số).
      filter['designerRejections.fromUserId'] = dto.rejectedBy;
    }
    if (dto.workshopStage) {
      // Ô phễu trang xưởng: chặng suy trong Mongo bằng cùng luật với cột "Trạng thái".
      // Dạng truy vấn thường (không `$expr`): Mongoose 7 không cast được `$switch`
      // trong `$expr` ở find/countDocuments, và truy vấn thường còn dùng được index.
      filter.$and = [
        ...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []),
        this.workshopStageMatch(dto.workshopStage),
      ];
    }
    if (dto.receivedBy) {
      filter['designerRejections.toUserId'] = dto.receivedBy;
    }
    if (dto.needDesigner === true) {
      // Pool cần/qua designer — mirror hàng "Chưa gán designer" Tổng quan N ngày.
      filter.$and = [
        ...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []),
        {
          $or: [
            { 'toolCheckErrorNotes.0': { $exists: true } },
            {
              designerStatus: {
                $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework, DesignerStatus.Done],
              },
            },
          ],
        },
      ];
    }
    if (dto.designBacklog === true) {
      // Hàng "Tổng tồn" Tổng quan N ngày — union 3 nhóm (mirror aggregation
      // getDailyOverview.backlog): chưa soát ∨ đã gán chưa xong ∨ đang lỗi chưa gán.
      filter.$and = [
        ...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []),
        {
          $or: [
            { toolResultNote: { $in: [null, ''] } },
            {
              assignee: { $exists: true, $nin: [null, ''] },
              designerStatus: { $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework] },
            },
            {
              $and: [
                {
                  $or: [
                    { 'toolCheckErrorNotes.0': { $exists: true } },
                    {
                      designerStatus: {
                        $in: [
                          DesignerStatus.Assigned,
                          DesignerStatus.InProgress,
                          DesignerStatus.Rework,
                          DesignerStatus.Done,
                        ],
                      },
                    },
                  ],
                },
                { assignee: { $in: [null, ''] } },
                { toolResultNote: { $nin: [null, '', 'ok'] } },
              ],
            },
          ],
        },
      ];
    }
    if (dto.toolErrorNote) {
      const codes = dto.toolErrorNote.split(',').filter(Boolean);
      if (codes.length) {
        // Mã lỗi soát tool MỚI NHẤT của đơn (phần tử cuối `toolCheckErrorNotes`)
        // — khớp breakdown `toolErrorByNote` của Tổng quan N ngày. $expr đặt trong
        // $and để không đè $expr của transferStatus.
        filter.$and = [
          ...(Array.isArray(filter.$and) ? (filter.$and as unknown[]) : []),
          {
            $expr: {
              $in: [{ $ifNull: [{ $arrayElemAt: [{ $ifNull: ['$toolCheckErrorNotes', []] }, -1] }, ''] }, codes],
            },
          },
        ];
      }
    }

    // Transfer filters — let the factory tab slice orders by direction.
    if (dto.originalFactoryId) {
      filter.originalFactoryId = { $in: dto.originalFactoryId.split(',').filter(Boolean) };
    }
    if (dto.transferStatus) {
      // Supported tokens:
      //   "transferred"             → originalFactoryId !== factoryId
      //   "pure"                    → originalFactoryId == factoryId
      //   "transferred-in:<fid>"    → factoryId=fid AND originalFactoryId != fid
      //   "transferred-out:<fid>"   → originalFactoryId=fid AND factoryId != fid
      const tok = dto.transferStatus.trim();
      if (tok === 'transferred') {
        filter.$expr = { $ne: ['$originalFactoryId', '$factoryId'] };
      } else if (tok === 'pure') {
        filter.$expr = { $eq: ['$originalFactoryId', '$factoryId'] };
      } else if (tok.startsWith('transferred-in:')) {
        const fid = tok.slice('transferred-in:'.length);
        filter.factoryId = fid;
        filter.$expr = { $ne: ['$originalFactoryId', '$factoryId'] };
      } else if (tok.startsWith('transferred-out:')) {
        const fid = tok.slice('transferred-out:'.length);
        filter.originalFactoryId = fid;
        filter.$expr = { $ne: ['$originalFactoryId', '$factoryId'] };
      }
    }
    if (dto.printStage) {
      // Mã printStatus được set bằng tên máy in khi đơn đã in xong — bất kỳ
      // mã nào không thuộc danh sách này coi như "đang in" (đã pick lên máy
      // chưa done). Null/empty = chưa in.
      if (dto.printStage === 'printed') {
        filter.printStatus = { $in: PRINTED_MACHINE_CODES };
      } else if (dto.printStage === 'printing') {
        filter.printStatus = { $exists: true, $nin: [null, '', ...PRINTED_MACHINE_CODES] };
      } else if (dto.printStage === 'not-printed') {
        filter.$or = [{ printStatus: { $exists: false } }, { printStatus: { $in: [null, ''] } }];
      }
    }
    return filter;
  }

  /**
   * ToolResult codes coi là "Có tool" (name bắt đầu "Có", regex `^Có`). Dùng cho
   * token tách "Chưa gán · có/không tool" (buildOrderListFilter + facet counts).
   * Collection workshop_config nhỏ → query rẻ; chỉ gọi khi cần (token active hoặc
   * tính facet designerStatus).
   */
  private async resolveToolHasCodes(): Promise<string[]> {
    const cfgs = await this.workshopConfigRepository.findAll({
      category: WorkshopConfigCategory.ToolResult,
      name: { $regex: '^Có', $options: 'i' },
    });
    return cfgs.map((d) => d.code);
  }

  /** True nếu dto.designerStatus dùng token tách tool (cần resolve toolHasCodes). */
  private needsToolHasCodes(dto: GetProductionOrdersDto): boolean {
    return !!dto.designerStatus && dto.designerStatus.includes('__unassigned_');
  }

  async getOrders(
    dto: GetProductionOrdersDto,
    roleName?: RoleType,
    assigneeCode?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<GetProductionOrdersResDto> {
    // [cache disabled] Re-enable by uncommenting the block below + the cache
    // write at the end of this method.
    // const cacheKey = this.buildListCacheKey(dto, roleName);
    // const t0 = Date.now();
    // try {
    //   const cached = await this.redisCacheService.getKey(cacheKey);
    //   if (cached) return JSON.parse(cached);
    // } catch { /* fall through */ }
    void roleName; // keep the var read so we can re-enable the cache key later

    const { page, limit, sort, order } = dto;
    const toolHasCodes = this.needsToolHasCodes(dto) ? await this.resolveToolHasCodes() : undefined;
    const filter = this.buildOrderListFilter(
      dto,
      roleName,
      assigneeCode,
      fulfillmentFactoryId,
      fulfillmentStage,
      toolHasCodes,
    );
    if (dto.fulfillmentStatus) {
      this.applyFulfillmentStatusFilter(filter, dto.fulfillmentStatus, fulfillmentStage, assigneeCode);
    }

    const populate = [
      { path: 'factory', select: ['name', 'shortName'] },
      { path: 'machineType', select: ['name', 'shortName'] },
      // mockup/level cho panel drill-down Dashboard Designer gom nhóm theo sản phẩm.
      { path: 'productConfig', select: ['fullName', 'shortName', 'mockup', 'level'] },
    ];

    let data: unknown[];
    let total: number;

    if (sort === 'grouped') {
      // Sort theo ƯU TIÊN SIZE (S→M→L→XL→2XL→3XL→4XL→5XL, size khác → cuối) ở
      // DB để phân trang chuẩn xuyên trang. `.sort()` thường chỉ so sánh chuỗi
      // ('2XL' < 'L') nên cần aggregation tính `__sizeRank` qua $switch.
      // Lấy _id đã sort + paginate, rồi populate qua repository (re-order theo _id).
      const idRows = await this.orderModel
        .aggregate<{ _id: unknown }>([
          { $match: filter },
          { $addFields: { __sz: { $toLower: { $trim: { input: { $ifNull: ['$size', ''] } } } } } },
          {
            $addFields: {
              __sizeRank: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$__sz', 'xs'] }, then: 0 },
                    { case: { $eq: ['$__sz', 's'] }, then: 1 },
                    { case: { $eq: ['$__sz', 'm'] }, then: 2 },
                    { case: { $eq: ['$__sz', 'l'] }, then: 3 },
                    { case: { $eq: ['$__sz', 'xl'] }, then: 4 },
                    { case: { $in: ['$__sz', ['2xl', 'xxl']] }, then: 5 },
                    { case: { $in: ['$__sz', ['3xl', 'xxxl']] }, then: 6 },
                    { case: { $in: ['$__sz', ['4xl', 'xxxxl']] }, then: 7 },
                    { case: { $in: ['$__sz', ['5xl', 'xxxxxl']] }, then: 8 },
                    { case: { $eq: ['$__sz', '6xl'] }, then: 9 },
                    { case: { $eq: ['$__sz', '7xl'] }, then: 10 },
                    { case: { $eq: ['$__sz', '8xl'] }, then: 11 },
                  ],
                  default: 99,
                },
              },
            },
          },
          { $sort: { priority: -1, type: 1, __sizeRank: 1, fabricType: 1, inProductionAt: -1 } },
          { $skip: limit * (page - 1) },
          { $limit: limit },
          { $project: { _id: 1 } },
        ])
        // Sort theo field tính toán (__sizeRank) không dùng được index → Mongo
        // sort in-memory (giới hạn 100MB). allowDiskUse tránh lỗi "Sort exceeded
        // memory limit" / spike RAM khi tập match lớn (admin / ngày nhiều đơn).
        .allowDiskUse(true);
      const ids = idRows.map((r) => r._id);
      const [docs, count] = await Promise.all([
        this.orderRepository.findAll({ _id: { $in: ids } }, { populate }),
        this.orderModel.countDocuments(filter),
      ]);
      // Aggregation mất thứ tự sau $in → re-order theo `ids`.
      const byId = new Map((docs as Array<{ _id: unknown }>).map((d) => [String(d._id), d]));
      data = ids.map((id) => byId.get(String(id))).filter(Boolean) as unknown[];
      total = count;
    } else {
      const res = await this.orderRepository.findAllAndCount(filter, {
        paging: { skip: limit * (page - 1), limit },
        sort: { priority: -1, [sort || 'inProductionAt']: order === 'asc' ? 1 : -1 },
        populate,
      });
      data = res.data as unknown[];
      total = res.total;
    }

    const result = { success: true as const, data: data as never, total };

    // [cache disabled]
    // void this.redisCacheService
    //   .setKey(cacheKey, JSON.stringify(result), ORDER_LIST_CACHE_TTL_SECONDS)
    //   .catch(() => undefined);

    return result;
  }

  /**
   * Lookup đơn theo danh sách `_id` — trả full workshop fields (populate factory/
   * machineType/productConfig) để FE render bảng đơn đầy đủ giống `getOrders`,
   * NHƯNG **không áp visibility scoping theo role**. Dùng cho drill-down "Xem chi
   * tiết" ở dashboard: hiển thị đúng tập đơn đã biết id (vd. nhóm "Cần gán" gồm
   * đơn CHƯA gán → scoping theo assignee của getOrders sẽ ẩn hết với role Designer).
   * Sort giống bảng gộp (type → size → fabric); phân trang qua skip/limit.
   */
  async getOrdersByIds(ids: string[], page = 1, limit = 20): Promise<GetProductionOrdersResDto> {
    const clean = ids.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) return { success: true as const, data: [] as never, total: 0 };
    const filter = { _id: { $in: clean }, cancelledAt: { $exists: false } };
    const res = await this.orderRepository.findAllAndCount(filter, {
      paging: { skip: limit * (page - 1), limit },
      sort: { priority: -1, type: 1, size: 1, fabricType: 1, inProductionAt: -1 },
      populate: [
        { path: 'factory', select: ['name', 'shortName'] },
        { path: 'machineType', select: ['name', 'shortName'] },
        { path: 'productConfig', select: ['fullName', 'shortName'] },
      ],
    });
    return { success: true as const, data: res.data as never, total: res.total };
  }

  /**
   * Dữ liệu tem barcode xưởng (Orders.md §16.7) — trả theo ĐÚNG thứ tự `ids`
   * caller gửi (= thứ tự tem chui ra máy in). Đơn hủy bị loại lặng lẽ như mọi
   * list dùng chung; caller so độ dài kết quả với số id để báo "in thiếu tem".
   *
   * Mọi giá trị trên tem được resolve TẠI ĐÂY thay vì để FE tự ghép:
   * - `sku`: từ variation SKU của Product Config + size đơn (`resolveBarcodeSkuBase`)
   *   — `OrderEntity` không lưu SKU, và populate variations vào `getOrders`
   *   thì phình payload mọi danh sách đơn chỉ để phục vụ lúc in.
   * - `itemIndex/itemTotal`: vị trí item trong TOÀN BỘ item còn sống của cùng
   *   (orderId, userEmail) trên hệ thống — người dùng chọn 1/2 item để in thì
   *   tem vẫn phải ghi (1/2), số này để xưởng gom đủ kiện. Ghép cả `userEmail`
   *   vì `orderId` chỉ unique theo nguồn đơn, hai khách khác nhau có thể trùng.
   *   Thứ tự item cố định theo `productionId` để in lại tem không đổi số.
   */
  async getBarcodeLabels(ids: string[]): Promise<BarcodeLabel[]> {
    const clean = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
    if (clean.length === 0) return [];
    type Row = {
      _id: unknown;
      productionId?: string;
      userSku?: string;
      userEmail?: string;
      orderId?: string;
      inProductionAt?: Date;
      size?: string;
      color?: string;
      productConfigId?: unknown;
    };
    const select = ['productionId', 'userSku', 'userEmail', 'orderId', 'inProductionAt', 'size', 'color', 'productConfigId'];
    const orders = await this.orderRepository.findAll<Row>(
      { _id: { $in: clean }, cancelledAt: { $exists: false } },
      { select },
    );

    const orderIds = [...new Set(orders.map((o) => o.orderId?.trim()).filter(Boolean))] as string[];
    const siblings = orderIds.length
      ? await this.orderRepository.findAll<Row>(
          { orderId: { $in: orderIds }, cancelledAt: { $exists: false } },
          { select: ['productionId', 'orderId', 'userEmail'] },
        )
      : [];
    const groups = new Map<string, Row[]>();
    for (const s of siblings) {
      const key = `${s.orderId?.trim() || ''}|${(s.userEmail || '').toLowerCase()}`;
      const list = groups.get(key);
      if (list) list.push(s);
      else groups.set(key, [s]);
    }
    const posOf = new Map<string, { index: number; total: number }>();
    for (const rows of groups.values()) {
      rows.sort((a, b) => (a.productionId || '').localeCompare(b.productionId || ''));
      rows.forEach((r, i) => posOf.set(String(r._id), { index: i + 1, total: rows.length }));
    }

    const pcIds = [...new Set(orders.map((o) => o.productConfigId && String(o.productConfigId)).filter(Boolean))] as string[];
    const configs = pcIds.length
      ? await this.productConfigRepository.findAll<{ _id: unknown; variations?: { sku?: string }[] }>(
          { _id: { $in: pcIds } },
          { select: ['variations.sku'] },
        )
      : [];
    const skusByPc = new Map(configs.map((c) => [String(c._id), (c.variations || []).map((v) => v.sku || '')]));

    const byId = new Map(orders.map((o) => [String(o._id), o]));
    const out: BarcodeLabel[] = [];
    for (const id of clean) {
      const o = byId.get(id);
      if (!o?.productionId) continue;
      const pos = posOf.get(String(o._id));
      const variationSkus = o.productConfigId ? skusByPc.get(String(o.productConfigId)) || [] : [];
      out.push({
        _id: String(o._id),
        productionId: o.productionId,
        userSku: o.userSku || undefined,
        orderId: o.orderId?.trim() || undefined,
        inProductionAt: o.inProductionAt || undefined,
        sku: resolveBarcodeSkuBase(variationSkus, o.size),
        variant: [o.size, o.color].filter(Boolean).join(' ') || undefined,
        itemIndex: pos?.index ?? 1,
        itemTotal: pos?.total ?? 1,
      });
    }
    return out;
  }

  /**
   * Dữ liệu LABEL GIAO HÀNG 4×6 inch (Orders.md §16.8) — nút "In label giao
   * hàng" ở menu "..." từng dòng + thanh bulk. Cùng khung với `getBarcodeLabels`:
   * kết quả theo ĐÚNG thứ tự `ids`, đơn hủy/không tồn tại bị loại lặng lẽ
   * (caller so độ dài để báo in thiếu). KHÔNG loại đơn thiếu `shippingAddress`
   * ở đây — trả về đủ để FE tách riêng và cảnh báo "thiếu địa chỉ" theo
   * productionId thay vì in tem trống.
   *
   * Resolve server-side (OrderEntity không lưu SKU/cân biến thể/tên xưởng):
   * - `sku`/`weightGram`: `resolveShippingLabelInfo()` — biến thể khớp size
   *   (SKU ĐẦY ĐỦ, khác tem barcode xưởng đã gọt đuôi), cân ưu tiên
   *   `order.weight` → biến thể → default sản phẩm.
   * - `factoryName`: đọc thẳng bảng `factories` theo `factoryId`.
   */
  async getShippingLabels(ids: string[]): Promise<ShippingLabel[]> {
    const clean = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
    if (clean.length === 0) return [];
    type Row = {
      _id: unknown;
      productionId?: string;
      userSku?: string;
      orderId?: string;
      size?: string;
      color?: string;
      quantity?: number;
      weight?: number;
      mockupUrl?: string;
      shippingAddress?: Record<string, string | undefined>;
      factoryId?: unknown;
      productConfigId?: unknown;
    };
    const orders = await this.orderRepository.findAll<Row>(
      { _id: { $in: clean }, cancelledAt: { $exists: false } },
      {
        select: [
          'productionId',
          'userSku',
          'orderId',
          'size',
          'color',
          'quantity',
          'weight',
          'mockupUrl',
          'shippingAddress',
          'factoryId',
          'productConfigId',
        ],
      },
    );

    const factoryIds = [...new Set(orders.map((o) => o.factoryId && String(o.factoryId)).filter(Boolean))] as string[];
    const factories = factoryIds.length
      ? await this.factoryRepository.findAll<{ _id: unknown; name?: string }>(
          { _id: { $in: factoryIds } },
          { select: ['name'] },
        )
      : [];
    const factoryNameById = new Map(factories.map((f) => [String(f._id), f.name || undefined]));

    const pcIds = [...new Set(orders.map((o) => o.productConfigId && String(o.productConfigId)).filter(Boolean))] as string[];
    const configs = pcIds.length
      ? await this.productConfigRepository.findAll<{
          _id: unknown;
          weight?: number;
          variations?: { sku?: string; weight?: number }[];
        }>({ _id: { $in: pcIds } }, { select: ['weight', 'variations.sku', 'variations.weight'] })
      : [];
    const configById = new Map(configs.map((c) => [String(c._id), c]));

    const byId = new Map(orders.map((o) => [String(o._id), o]));
    const out: ShippingLabel[] = [];
    for (const id of clean) {
      const o = byId.get(id);
      if (!o?.productionId) continue;
      const config = o.productConfigId ? configById.get(String(o.productConfigId)) : undefined;
      const { sku, weightGram } = resolveShippingLabelInfo(
        config?.variations || [],
        o.size,
        o.weight,
        config?.weight,
      );
      out.push({
        _id: String(o._id),
        productionId: o.productionId,
        userSku: o.userSku || undefined,
        orderId: o.orderId?.trim() || undefined,
        size: o.size || undefined,
        color: o.color || undefined,
        quantity: o.quantity ?? 1,
        mockupUrl: o.mockupUrl || undefined,
        factoryName: o.factoryId ? factoryNameById.get(String(o.factoryId)) : undefined,
        sku,
        weightGram,
        shippingAddress: o.shippingAddress as ShippingLabel['shippingAddress'],
      });
    }
    return out;
  }

  /**
   * Export EVERY order matching the current filter (no pagination). Used by
   * the "Đơn hàng theo xưởng" tab to dump the visible scope to a spreadsheet.
   * Populates factory / machineType / productConfig so FE can render names
   * without an extra lookup. Caller is responsible for capping payload — the
   * filter (date range + factory + product/fabric/tool/machine) should keep
   * this bounded to a few thousand rows in practice.
   */
  async exportOrders(
    dto: GetProductionOrdersDto,
    roleName?: RoleType,
    assigneeCode?: string,
    fulfillmentFactoryId?: string,
  ): Promise<{ success: true; data: unknown[]; total: number }> {
    const toolHasCodes = this.needsToolHasCodes(dto) ? await this.resolveToolHasCodes() : undefined;
    const filter = this.buildOrderListFilter(
      dto,
      roleName,
      assigneeCode,
      fulfillmentFactoryId,
      undefined,
      toolHasCodes,
    );
    const data = await this.orderRepository.findAll(filter, {
      sort: { priority: -1, type: 1, size: 1, fabricType: 1, inProductionAt: -1 },
      populate: [
        { path: 'factory', select: ['name', 'shortName'] },
        { path: 'machineType', select: ['name', 'shortName'] },
        { path: 'productConfig', select: ['fullName', 'shortName'] },
      ],
    });
    return { success: true, data: data as unknown[], total: data.length };
  }

  /**
   * Same filters as getOrders, but paginates by **product type** instead of
   * by row. Each page returns N product groups with ALL their orders — this
   * way client-side aggregation (×N duplicate badges, "heaviest combo"
   * highlight) is always correct, never split across pages.
   *
   * Groups are sorted by `totalOrders` desc so the busiest products surface
   * first. Pagination `total` = number of distinct product types matching
   * the filter.
   */
  async getOrdersGroupedByType(
    dto: GetProductionOrdersDto,
    roleName?: RoleType,
    assigneeCode?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<GetGroupedProductionOrdersResDto> {
    const { page, limit } = dto;
    const toolHasCodes = this.needsToolHasCodes(dto) ? await this.resolveToolHasCodes() : undefined;
    const filter = this.buildOrderListFilter(
      dto,
      roleName,
      assigneeCode,
      fulfillmentFactoryId,
      fulfillmentStage,
      toolHasCodes,
    );
    if (dto.fulfillmentStatus) {
      this.applyFulfillmentStatusFilter(filter, dto.fulfillmentStatus, fulfillmentStage, assigneeCode);
    }

    // 1) Count distinct types matching the filter (for pagination total).
    const totalAgg = await this.orderModel.aggregate([
      { $match: filter },
      { $group: { _id: { $ifNull: ['$type', ''] } } },
      { $count: 'n' },
    ]);
    const totalTypes: number = totalAgg[0]?.n || 0;

    // 2) Aggregate per-type counts, sort by orderCount desc, paginate by type.
    const typeAgg: Array<{ _id: string; totalOrders: number; totalQuantity: number }> = await this.orderModel.aggregate(
      [
        { $match: filter },
        {
          $group: {
            _id: { $ifNull: ['$type', ''] },
            totalOrders: { $sum: 1 },
            totalQuantity: { $sum: { $ifNull: ['$quantity', 1] } },
          },
        },
        // Tiebreak by type name asc so the ordering is stable across reloads.
        { $sort: { totalOrders: -1, _id: 1 } },
        { $skip: limit * (page - 1) },
        { $limit: limit },
      ],
    );

    if (typeAgg.length === 0) {
      return { success: true, data: [], total: totalTypes };
    }

    // 3) Fetch every order belonging to the selected types in one query.
    // We translate empty-string type → match {type: null OR undefined}.
    const concreteTypes = typeAgg.map((t) => t._id).filter(Boolean);
    const hasUnnamed = typeAgg.some((t) => !t._id);
    const typeFilter: Record<string, unknown>[] = [];
    if (concreteTypes.length > 0) typeFilter.push({ type: { $in: concreteTypes } });
    if (hasUnnamed) typeFilter.push({ type: { $in: [null, ''] } });

    // BUG FIX: `{ ...filter, $or: typeFilter }` overwrite filter.$or (search
    // clause / unmapped clause) → lộ toàn bộ đơn của type ra dù search chỉ
    // match 1 đơn. Phải merge qua $and để giữ cả 2 điều kiện.
    const ordersFilter: Record<string, unknown> = { ...filter };
    const andClauses: unknown[] = [];
    if (Array.isArray(ordersFilter.$and)) andClauses.push(...(ordersFilter.$and as unknown[]));
    if (ordersFilter.$or) andClauses.push({ $or: ordersFilter.$or });
    andClauses.push({ $or: typeFilter });
    delete ordersFilter.$or;
    ordersFilter.$and = andClauses;

    const orders = await this.orderRepository.findAll(ordersFilter, {
      sort: { priority: -1, type: 1, size: 1, fabricType: 1, inProductionAt: -1 },
      populate: [
        { path: 'factory', select: ['name', 'shortName'] },
        { path: 'machineType', select: ['name', 'shortName'] },
      ],
    });

    // 4) Re-attach orders to their groups in the (count-desc) order.
    const byType = new Map<string, unknown[]>();
    for (const o of orders as unknown as Array<{ type?: string }>) {
      const k = o.type || '';
      const bucket = byType.get(k) || [];
      bucket.push(o);
      byType.set(k, bucket);
    }

    const data = typeAgg.map((t) => ({
      type: t._id,
      totalOrders: t.totalOrders,
      totalQuantity: t.totalQuantity,
      orders: (byType.get(t._id) || []) as never,
    }));

    return { success: true, data, total: totalTypes };
  }

  /**
   * Aggregate orders into a dashboard view:
   *   - totals (orders / qty / production / shipping / total cost)
   *   - per-type breakdown with size + mockup statistics
   *
   * Cost calculation uses `quantity` as multiplier:
   *   productionCost = sum(baseCost * quantity)
   *   shippingCost   = sum(shipCost * quantity)
   *
   * Mockups are bucketed by URL string — `count > 1` means duplicate (same
   * mockup image used across multiple orders).
   */
  /**
   * Options xưởng cho MỌI dropdown lọc/chọn xưởng của Dashboard.
   *
   * Đọc THẲNG bảng `factories` (xưởng đang bật) thay vì suy từ đơn: dropdown
   * dựng bằng `$group` trên orders chỉ có xưởng ĐANG giữ đơn trong kỳ, nên
   * xưởng mới mở / xưởng vừa hết đơn biến mất khỏi select và không ai chuyển
   * đơn sang đó được.
   *
   * GIỮ CẢ xưởng ngoài luồng sản xuất (US — `excluded-factory.ts`): đơn xưởng
   * đó bị loại khỏi thống kê MẶC ĐỊNH, nhưng lọc tường minh `factoryId` thì
   * vẫn xem được (Orders.md §21) — nên nó phải có mặt trong select.
   */
  private async listFactoryOptions(): Promise<FactoryOption[]> {
    const docs = await (
      this.orderModel.db.collection('factories') as unknown as {
        find: (q: Record<string, unknown>) => {
          toArray: () => Promise<Array<{ _id: unknown; name: string; shortName?: string }>>;
        };
      }
    )
      .find({ isActive: true, deletedAt: { $exists: false } })
      .toArray();
    return docs
      .map((f) => ({ factoryId: String(f._id), factoryName: f.name, factoryShortName: f.shortName }))
      .sort((a, b) => a.factoryName.localeCompare(b.factoryName));
  }

  /**
   * HỢP danh sách xưởng đầy đủ (`listFactoryOptions`) với xưởng suy ra từ đơn
   * trong kỳ. Xưởng đã tắt nhưng vẫn còn đơn phải giữ lại, nếu không thì đơn
   * của nó không lọc ra được ở bất kỳ đâu.
   */
  private mergeFactoryOptions(
    options: FactoryOption[],
    fromOrders: Array<{ factoryId: unknown; factoryName: string }>,
  ): Array<{ factoryId: string; factoryName: string }> {
    const map = new Map<string, string>(options.map((f) => [f.factoryId, f.factoryName]));
    for (const f of fromOrders) {
      const id = String(f.factoryId);
      if (!map.has(id)) map.set(id, f.factoryName);
    }
    return [...map.entries()]
      .map(([factoryId, factoryName]) => ({ factoryId, factoryName }))
      .sort((a, b) => a.factoryName.localeCompare(b.factoryName));
  }

  async getDashboard(
    dto: GetOrderDashboardDto,
    roleName?: RoleType,
    fulfillmentStage?: string,
    fulfillmentFactoryId?: string,
  ): Promise<GetOrderDashboardResDto> {
    // [cache disabled]
    // const cacheKey = `orders:dashboard:${Buffer.from(JSON.stringify(dto)).toString('base64')}`;
    // try {
    //   const cached = await this.redisCacheService.getKey(cacheKey);
    //   if (cached) return JSON.parse(cached);
    // } catch { /* fall through */ }

    const match: Record<string, unknown> = {};
    // Gom các điều kiện $or (factory scope non-print + searchUser) vào $and để
    // không ghi đè nhau (object chỉ có 1 key `$or`).
    const andClauses: Record<string, unknown>[] = [];

    // Fulfillment scope theo XƯỞNG. User In (print): thấy mọi trạng thái (bỏ
    // readyForFulfill) nhưng chỉ xưởng mình (factoryId). Stage khác: đơn đã Ok +
    // (factoryId hoặc originalFactoryId). → tài khoản nào chỉ thấy đơn xưởng đó.
    if (roleName === RoleType.Fulfillment) {
      const printView = this.isPrintAdminView(roleName, fulfillmentStage);
      if (!printView) match.readyForFulfill = true;
      if (!fulfillmentFactoryId) {
        match.factoryId = '__no_factory__';
      } else if (printView) {
        match.factoryId = fulfillmentFactoryId;
      } else {
        andClauses.push({
          $or: [{ factoryId: fulfillmentFactoryId }, { originalFactoryId: fulfillmentFactoryId }],
        });
      }
    } else if (dto.factoryId) {
      // Lọc TƯỜNG MINH 1 xưởng (cụm menu xưởng ở sidebar). Ghi đè bộ loại trừ
      // mặc định — kể cả xưởng US vẫn xem được số liệu (Orders.md §21).
      andClauses.push({ $or: [{ factoryId: dto.factoryId }, { originalFactoryId: dto.factoryId }] });
    } else {
      // Đơn chưa map xưởng + đơn xưởng US (ngoài luồng sản xuất) bị loại khỏi
      // mọi số liệu Dashboard. Fulfillment ở trên đã tự loại trừ sẵn.
      match.factoryId = productionFactoryClause(this.orderModel.db);
    }
    if (dto.startDate || dto.endDate) {
      const range: Record<string, Date> = {};
      if (dto.startDate) range.$gte = vnDayStart(dto.startDate);
      if (dto.endDate) range.$lte = vnDayEnd(dto.endDate);
      // Filter by `inProductionAt` (VN tz) — thời gian đơn vào sản xuất.
      match.inProductionAt = range;
    }

    if (dto.searchType?.trim()) {
      match.type = { $regex: escapeRegex(dto.searchType.trim()), $options: 'i' };
    }

    if (dto.searchUser?.trim()) {
      const s = escapeRegex(dto.searchUser.trim());
      andClauses.push({
        $or: [{ userSku: { $regex: s, $options: 'i' } }, { userEmail: { $regex: s, $options: 'i' } }],
      });
    }

    if (andClauses.length > 0) match.$and = andClauses;

    // Đơn hủy: LOẠI khỏi MỌI số liệu dashboard (`cancelledAt` không tồn tại) và
    // đếm RIÊNG (`cancelledOrders`) trong cùng scope xưởng + khoảng inProductionAt.
    match.cancelledAt = { $exists: false };
    const cancelledOrders = await this.orderModel.countDocuments({
      ...match,
      cancelledAt: { $exists: true },
    });
    // Đơn đang GIỮ: VẪN nằm trong totalOrders (chỉ tạm dừng) nhưng đếm riêng để
    // dashboard hiện "Đơn đang giữ". Cùng scope xưởng + khoảng inProductionAt.
    const heldOrders = await this.orderModel.countDocuments({
      ...match,
      heldAt: { $exists: true },
    });

    const totalsAgg = await this.orderModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalQuantity: { $sum: { $ifNull: ['$quantity', 1] } },
          totalProductionCost: {
            $sum: { $multiply: [{ $ifNull: ['$baseCost', 0] }, { $ifNull: ['$quantity', 1] }] },
          },
          totalShippingCost: {
            $sum: { $multiply: [{ $ifNull: ['$shipCost', 0] }, { $ifNull: ['$quantity', 1] }] },
          },
        },
      },
    ]);

    const totals = totalsAgg[0]
      ? {
          totalOrders: totalsAgg[0].totalOrders || 0,
          totalQuantity: totalsAgg[0].totalQuantity || 0,
          totalProductionCost: round2(totalsAgg[0].totalProductionCost),
          totalShippingCost: round2(totalsAgg[0].totalShippingCost),
          totalCost: round2((totalsAgg[0].totalProductionCost || 0) + (totalsAgg[0].totalShippingCost || 0)),
          cancelledOrders,
          heldOrders,
        }
      : {
          totalOrders: 0,
          totalQuantity: 0,
          totalProductionCost: 0,
          totalShippingCost: 0,
          totalCost: 0,
          cancelledOrders,
          heldOrders,
        };

    // Per-type aggregation: group, collect raw rows to post-process size/mockup
    const byTypeAgg = await this.orderModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$type', 'Không xác định'] },
          quantity: { $sum: { $ifNull: ['$quantity', 1] } },
          orderCount: { $sum: 1 },
          minCost: { $min: '$baseCost' },
          maxCost: { $max: '$baseCost' },
          productionCost: {
            $sum: { $multiply: [{ $ifNull: ['$baseCost', 0] }, { $ifNull: ['$quantity', 1] }] },
          },
          shippingCost: {
            $sum: { $multiply: [{ $ifNull: ['$shipCost', 0] }, { $ifNull: ['$quantity', 1] }] },
          },
          // Push minimal fields needed for post-processing
          rows: {
            $push: {
              size: '$size',
              quantity: { $ifNull: ['$quantity', 1] },
              mockupUrl: '$mockupUrl',
              mockupOriginalUrl: '$mockupOriginalUrl',
            },
          },
        },
      },
      { $sort: { quantity: -1 } },
    ]);

    const byType: TypeSummary[] = byTypeAgg.map((t) => {
      const sizeMap = new Map<string, number>();
      const mockupMap = new Map<string, MockupSummary>();

      for (const r of t.rows) {
        const qty = r.quantity || 1;
        const size = (r.size || '').trim() || '—';
        sizeMap.set(size, (sizeMap.get(size) || 0) + qty);

        if (r.mockupUrl) {
          const key = r.mockupUrl;
          const existing = mockupMap.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            mockupMap.set(key, {
              url: key,
              originalUrl: r.mockupOriginalUrl,
              count: 1,
            });
          }
        }
      }

      const sizes: SizeSummary[] = Array.from(sizeMap.entries())
        .map(([size, count]) => ({ size, count }))
        .sort((a, b) => compareSize(a.size, b.size));

      const mockups: MockupSummary[] = Array.from(mockupMap.values()).sort((a, b) => b.count - a.count);
      const duplicateMockups = mockups.filter((m) => m.count > 1);

      return {
        type: t._id || 'Không xác định',
        quantity: t.quantity || 0,
        minCost: round2(t.minCost || 0),
        maxCost: round2(t.maxCost || 0),
        productionCost: round2(t.productionCost),
        shippingCost: round2(t.shippingCost),
        totalCost: round2((t.productionCost || 0) + (t.shippingCost || 0)),
        uniqueMockupCount: mockups.length,
        duplicateMockupCount: duplicateMockups.length,
        sizes,
        mockups,
        duplicateMockups,
      };
    });

    // Factory breakdown with nested machine-type breakdown
    const byFactoryAgg = await this.orderModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { factoryId: '$factoryId', machineTypeId: '$machineTypeId' },
          quantity: { $sum: { $ifNull: ['$quantity', 1] } },
        },
      },
      {
        $lookup: {
          from: 'factories',
          localField: '_id.factoryId',
          foreignField: '_id',
          as: 'factory',
        },
      },
      {
        $lookup: {
          from: 'machineTypes',
          localField: '_id.machineTypeId',
          foreignField: '_id',
          as: 'machineType',
        },
      },
      {
        $project: {
          factoryId: '$_id.factoryId',
          machineTypeId: '$_id.machineTypeId',
          factoryName: { $arrayElemAt: ['$factory.name', 0] },
          factoryShortName: { $arrayElemAt: ['$factory.shortName', 0] },
          machineTypeName: { $arrayElemAt: ['$machineType.name', 0] },
          machineTypeShortName: { $arrayElemAt: ['$machineType.shortName', 0] },
          quantity: 1,
        },
      },
    ]);

    // Group flat (factory, machineType) tuples into nested structure
    const factoryMap = new Map<
      string,
      {
        factoryId?: string;
        factoryName: string;
        factoryShortName?: string;
        quantity: number;
        machineMap: Map<string, MachineTypeBreakdown>;
      }
    >();

    let totalFactoryQty = 0;
    for (const row of byFactoryAgg) {
      const fKey = (row.factoryId as string) || '__unmapped__';
      const fName = (row.factoryName as string) || 'Chưa xác định';
      const fShort = (row.factoryShortName as string) || undefined;

      let f = factoryMap.get(fKey);
      if (!f) {
        f = {
          factoryId: row.factoryId,
          factoryName: fName,
          factoryShortName: fShort,
          quantity: 0,
          machineMap: new Map(),
        };
        factoryMap.set(fKey, f);
      }
      f.quantity += row.quantity;
      totalFactoryQty += row.quantity;

      const mKey = (row.machineTypeId as string) || '__unmapped__';
      const mName = (row.machineTypeName as string) || 'Chưa xác định';
      const mShort = (row.machineTypeShortName as string) || undefined;

      const existingM = f.machineMap.get(mKey);
      if (existingM) {
        existingM.quantity += row.quantity;
      } else {
        f.machineMap.set(mKey, {
          machineTypeId: row.machineTypeId,
          machineTypeName: mName,
          machineTypeShortName: mShort,
          quantity: row.quantity,
          percentage: 0, // computed below
        });
      }
    }

    const byFactory: FactoryBreakdown[] = Array.from(factoryMap.values())
      .map((f) => {
        const machineList = Array.from(f.machineMap.values());
        const machineTotal = machineList.reduce((s, m) => s + m.quantity, 0);
        machineList.forEach((m) => {
          m.percentage = machineTotal > 0 ? round2((m.quantity / machineTotal) * 100) : 0;
        });
        machineList.sort((a, b) => b.quantity - a.quantity);

        return {
          factoryId: f.factoryId,
          factoryName: f.factoryName,
          factoryShortName: f.factoryShortName,
          quantity: f.quantity,
          percentage: totalFactoryQty > 0 ? round2((f.quantity / totalFactoryQty) * 100) : 0,
          byMachineType: machineList,
        };
      })
      .sort((a, b) => b.quantity - a.quantity);

    // Size matrix — quantity per (factory, type, size). FE pivot type × size,
    // lọc theo xưởng. Group nhỏ gọn (chỉ sum quantity) + lookup tên xưởng.
    const sizeMatrixAgg = await this.orderModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            factoryId: '$factoryId',
            type: { $ifNull: ['$type', 'Không xác định'] },
            size: { $ifNull: ['$size', '—'] },
          },
          count: { $sum: { $ifNull: ['$quantity', 1] } },
        },
      },
      {
        $lookup: {
          from: 'factories',
          localField: '_id.factoryId',
          foreignField: '_id',
          as: 'factory',
        },
      },
      {
        $project: {
          factoryId: '$_id.factoryId',
          factoryName: { $arrayElemAt: ['$factory.name', 0] },
          type: '$_id.type',
          size: '$_id.size',
          count: 1,
        },
      },
    ]);

    // Gom (factory, type) → sizes[]. Key gộp cả factory + type.
    const sizeMatrixMap = new Map<
      string,
      { factoryId?: string; factoryName: string; type: string; sizeMap: Map<string, number> }
    >();
    for (const row of sizeMatrixAgg) {
      const factoryId = (row.factoryId as string) || undefined;
      const factoryName = (row.factoryName as string) || 'Chưa xác định';
      const type = (row.type as string) || 'Không xác định';
      const size = ((row.size as string) || '').trim() || '—';
      const key = `${factoryId ?? '__unmapped__'}::${type}`;
      let entry = sizeMatrixMap.get(key);
      if (!entry) {
        entry = { factoryId, factoryName, type, sizeMap: new Map() };
        sizeMatrixMap.set(key, entry);
      }
      entry.sizeMap.set(size, (entry.sizeMap.get(size) || 0) + (row.count || 0));
    }

    const sizeMatrix: SizeMatrixRow[] = Array.from(sizeMatrixMap.values()).map((e) => ({
      factoryId: e.factoryId,
      factoryName: e.factoryName,
      type: e.type,
      sizes: Array.from(e.sizeMap.entries())
        .map(([size, count]) => ({ size, count }))
        .sort((a, b) => compareSize(a.size, b.size)),
    }));

    // User breakdown — grouped by userEmail (primary identifier), falling back
    // to userSku when email is missing. Sorted by orderCount desc.
    const byUserAgg = await this.orderModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$userEmail', '$userSku'] },
          userSku: { $first: '$userSku' },
          userEmail: { $first: '$userEmail' },
          orderCount: { $sum: 1 },
          totalQuantity: { $sum: { $ifNull: ['$quantity', 1] } },
          totalProductionCost: {
            $sum: { $multiply: [{ $ifNull: ['$baseCost', 0] }, { $ifNull: ['$quantity', 1] }] },
          },
          totalShippingCost: {
            $sum: { $multiply: [{ $ifNull: ['$shipCost', 0] }, { $ifNull: ['$quantity', 1] }] },
          },
        },
      },
      { $sort: { orderCount: -1 } },
    ]);

    const byUser: UserBreakdown[] = byUserAgg
      .filter((u) => u._id) // skip orders with neither email nor sku
      .map((u) => ({
        userSku: u.userSku || undefined,
        userEmail: u.userEmail || undefined,
        orderCount: u.orderCount,
        totalQuantity: u.totalQuantity,
        totalProductionCost: round2(u.totalProductionCost),
        totalShippingCost: round2(u.totalShippingCost),
        totalCost: round2((u.totalProductionCost || 0) + (u.totalShippingCost || 0)),
      }));

    const result: GetOrderDashboardResDto = {
      success: true,
      data: {
        totals,
        byType,
        byFactory,
        sizeMatrix,
        // Dropdown xưởng của bảng size matrix — ĐỦ xưởng đang bật, không phụ
        // thuộc kỳ lọc (xưởng 0 đơn vẫn chọn được, ra bảng rỗng).
        factoryOptions: await this.listFactoryOptions(),
        byUser,
        filter: {
          startDate: dto.startDate,
          endDate: dto.endDate,
          searchType: dto.searchType,
          searchUser: dto.searchUser,
        },
      },
    };

    // [cache disabled]
    // void this.redisCacheService.setKey(cacheKey, JSON.stringify(result), 60).catch(() => undefined);

    return result;
  }

  /**
   * Status dashboard overview — runs all 10 group aggregations in a single
   * $facet so we hit the DB once. Returns:
   *  - totals: 6 KPI numbers + per-machine printed/pending mini KPIs
   *  - breakdown: counts per code (incl. null bucket) for every workshop field
   *    + factory + machineType + readyForFulfill
   *
   * Names + colors/icons are resolved against the WorkshopConfig collection
   * after aggregation (the orderModel only stores codes).
   */
  async getStatusOverview(
    dto: GetOrderStatusOverviewDto,
    roleName?: RoleType,
    assigneeCode?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<GetOrderStatusOverviewResDto> {
    // Build base match — same filters as list, including visibility rule.
    const baseMatch = this.buildVisibilityFilter(
      roleName,
      { createdFrom: dto.createdFrom, createdTo: dto.createdTo } as GetProductionOrdersDto,
      assigneeCode,
      fulfillmentFactoryId,
      fulfillmentStage,
    );
    // Loại đơn hủy khỏi các bucket trạng thái (bảng đơn chính vẫn giữ đơn hủy vì
    // dùng chung `buildVisibilityFilter` → chỉ loại tại consumer dashboard này).
    baseMatch.cancelledAt = { $exists: false };

    if (dto.printStatus) baseMatch.printStatus = { $in: dto.printStatus.split(',').filter(Boolean) };
    if (dto.printStatusNote) baseMatch.printStatusNote = { $in: dto.printStatusNote.split(',').filter(Boolean) };
    if (dto.toolResult) baseMatch.toolResult = { $in: dto.toolResult.split(',').filter(Boolean) };
    if (dto.toolResultNote) baseMatch.toolResultNote = { $in: dto.toolResultNote.split(',').filter(Boolean) };
    if (dto.errorFile) baseMatch.errorFile = { $in: dto.errorFile.split(',').filter(Boolean) };
    if (dto.assignee) baseMatch.assignee = { $in: dto.assignee.split(',').filter(Boolean) };
    if (dto.assigneeNote) baseMatch.assigneeNote = { $in: dto.assigneeNote.split(',').filter(Boolean) };
    if (dto.productionError) {
      baseMatch.productionError = { $in: dto.productionError.split(',').filter(Boolean) };
    } else if (dto.hasError === true) {
      baseMatch.productionError = { $exists: true, $nin: [null, ''] };
    }
    if (dto.factoryId) baseMatch.factoryId = dto.factoryId;
    if (dto.machineTypeId) baseMatch.machineTypeId = dto.machineTypeId;
    if (typeof dto.readyForFulfill === 'boolean') baseMatch.readyForFulfill = dto.readyForFulfill;
    if (dto.search) {
      const searchOr = buildSearchOr(dto.search);
      if (searchOr.length) baseMatch.$or = searchOr;
    }

    const startOfToday = vnTodayStart();

    const groupByField = (field: string) => [
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $project: { _id: 0, code: '$_id', count: 1 } },
      { $sort: { count: -1 as const } },
    ];
    /**
     * Group by 1 array field (vd `errorFile: ['vien-co','lech-mau']`).
     * `$unwind` mỗi đơn ra N rows (1 per code), rồi $group đếm — kết quả mỗi
     * code có count = số đơn có code đó trong array. preserveNullAndEmptyArrays
     * để legacy đơn null/missing vẫn vào nhóm `null` bucket.
     */
    const groupByArrayField = (field: string) => [
      { $unwind: { path: `$${field}`, preserveNullAndEmptyArrays: true } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $project: { _id: 0, code: '$_id', count: 1 } },
      { $sort: { count: -1 as const } },
    ];

    const [agg] = await this.orderModel.aggregate([
      { $match: baseMatch },
      {
        $facet: {
          total: [{ $count: 'n' }],
          today: [{ $match: { inProductionAt: { $gte: startOfToday } } }, { $count: 'n' }],
          pendingToolOk: [
            { $match: { $or: [{ toolResultNote: { $exists: false } }, { toolResultNote: { $ne: 'ok' } }] } },
            { $count: 'n' },
          ],
          ready: [{ $match: { readyForFulfill: true } }, { $count: 'n' }],
          done: [{ $match: { printStatus: { $in: PRINTED_MACHINE_CODES } } }, { $count: 'n' }],
          errors: [
            {
              $match: {
                $or: [
                  { toolResultNote: 'error' },
                  // errorFile array: tồn tại + có ít nhất 1 phần tử (không rỗng).
                  { errorFile: { $exists: true, $ne: null, $not: { $size: 0 } } },
                  { productionError: { $exists: true, $nin: [null, ''] } },
                ],
              },
            },
            { $count: 'n' },
          ],
          printStatus: groupByField('printStatus'),
          printStatusNote: groupByField('printStatusNote'),
          toolResult: groupByField('toolResult'),
          toolResultNote: groupByField('toolResultNote'),
          errorFile: groupByArrayField('errorFile'),
          productionError: groupByField('productionError'),
          assignee: groupByField('assignee'),
          assigneeNote: groupByField('assigneeNote'),
          factory: groupByField('factoryId'),
          machineType: groupByField('machineTypeId'),
          readyBreakdown: [
            { $group: { _id: { $ifNull: ['$readyForFulfill', false] }, count: { $sum: 1 } } },
            { $project: { _id: 0, key: '$_id', count: 1 } },
          ],
        },
      },
    ]);

    // Resolve workshop_config codes → name + color/icon. One bulk fetch.
    const allConfigs = await this.workshopConfigRepository.findAll({}, { sort: { category: 1, order: 1 } });
    const configMap = new Map<string, { name: string; color?: string; icon?: string }>();
    for (const cfg of allConfigs as unknown as Array<{
      category: string;
      code: string;
      name: string;
      color?: string;
      icon?: string;
    }>) {
      configMap.set(`${cfg.category}|${cfg.code}`, { name: cfg.name, color: cfg.color, icon: cfg.icon });
    }
    const resolve = (category: WorkshopConfigCategory, code: string | null): BreakdownBucket => {
      if (!code) return { code: null, name: 'Chưa phân loại', count: 0 };
      const meta = configMap.get(`${category}|${code}`);
      return {
        code,
        name: meta?.name || code,
        count: 0,
        color: meta?.color,
        icon: meta?.icon,
      };
    };
    const mapBreakdown = (category: WorkshopConfigCategory, rows: Array<{ code: string | null; count: number }>) =>
      rows.map((r) => ({ ...resolve(category, r.code), count: r.count }));

    // Resolve factory + machineType names
    const factoryIds = (agg.factory as Array<{ code: string | null; count: number }>)
      .map((r) => r.code)
      .filter((c): c is string => !!c);
    const factories = factoryIds.length
      ? await (
          this.orderModel.db.collection('factories') as unknown as {
            find: (q: Record<string, unknown>) => { toArray: () => Promise<Array<{ _id: unknown; name: string }>> };
          }
        )
          .find({ _id: { $in: factoryIds } })
          .toArray()
      : [];
    const factoryMap = new Map<string, string>(factories.map((f) => [String(f._id), f.name]));

    const machineIds = (agg.machineType as Array<{ code: string | null; count: number }>)
      .map((r) => r.code)
      .filter((c): c is string => !!c);
    const machineTypes = machineIds.length
      ? await (
          this.orderModel.db.collection('machineTypes') as unknown as {
            find: (q: Record<string, unknown>) => { toArray: () => Promise<Array<{ _id: unknown; name: string }>> };
          }
        )
          .find({ _id: { $in: machineIds } })
          .toArray()
      : [];
    const machineMap = new Map<string, string>(machineTypes.map((m) => [String(m._id), m.name]));

    const factoryBreakdown: FactoryBucket[] = (agg.factory as Array<{ code: string | null; count: number }>).map(
      (r) => ({
        factoryId: r.code,
        name: r.code ? factoryMap.get(r.code) || r.code : 'Chưa xác định',
        count: r.count,
      }),
    );
    // Chip lọc xưởng phải liệt kê ĐỦ xưởng đang bật kể cả xưởng 0 đơn trong kỳ
    // (và cả khi đang chọn 1 xưởng — để bấm sang xưởng khác được). Xưởng đang
    // giữ đơn đã có sẵn ở trên nên chỉ bù phần còn thiếu, count = 0. Xưởng US
    // count = 0 ở view mặc định là ĐÚNG — bấm vào chip mới lọc tường minh ra đơn.
    const seenFactoryIds = new Set(factoryBreakdown.map((f) => f.factoryId));
    for (const opt of await this.listFactoryOptions()) {
      if (!seenFactoryIds.has(opt.factoryId)) {
        factoryBreakdown.push({ factoryId: opt.factoryId, name: opt.factoryName, count: 0 });
      }
    }

    const machineBreakdown: MachineBucket[] = (agg.machineType as Array<{ code: string | null; count: number }>).map(
      (r) => ({
        machineTypeId: r.code,
        name: r.code ? machineMap.get(r.code) || r.code : 'Chưa xác định',
        count: r.count,
      }),
    );

    // Per-machine printed/pending KPI for Fulfill role
    const byMachine: MachineKpi[] = PRINTED_MACHINE_CODES.map((code) => {
      const meta = configMap.get(`print_status|${code}`);
      const printed =
        (agg.printStatus as Array<{ code: string | null; count: number }>).find((r) => r.code === code)?.count || 0;
      return {
        machineCode: code,
        machineName: meta?.name || code,
        printed,
        pending: 0,
      };
    });

    const totals: OrderStatusOverview['totals'] = {
      total: agg.total[0]?.n || 0,
      today: agg.today[0]?.n || 0,
      pendingToolOk: agg.pendingToolOk[0]?.n || 0,
      readyForFulfill: agg.ready[0]?.n || 0,
      done: agg.done[0]?.n || 0,
      errors: agg.errors[0]?.n || 0,
      byMachine,
    };

    const breakdown: OrderStatusOverview['breakdown'] = {
      printStatus: mapBreakdown(WorkshopConfigCategory.PrintStatus, agg.printStatus),
      printStatusNote: mapBreakdown(WorkshopConfigCategory.PrintStatusNote, agg.printStatusNote),
      toolResult: mapBreakdown(WorkshopConfigCategory.ToolResult, agg.toolResult),
      toolResultNote: mapBreakdown(WorkshopConfigCategory.ToolResultNote, agg.toolResultNote),
      errorFile: mapBreakdown(WorkshopConfigCategory.ErrorFileType, agg.errorFile),
      productionError: mapBreakdown(WorkshopConfigCategory.ProductionError, agg.productionError),
      // Category `assignee` không còn trong WorkshopConfigCategory (assignee
      // giờ là userId, WorkshopConfig auto-cleanup category này) — giữ nguyên
      // hành vi cũ: không resolve qua configMap, name = raw code.
      assignee: (agg.assignee as Array<{ code: string | null; count: number }>).map((r) =>
        r.code
          ? { code: r.code, name: r.code, count: r.count }
          : { code: null, name: 'Chưa phân loại', count: r.count },
      ),
      assigneeNote: mapBreakdown(WorkshopConfigCategory.AssigneeNote, agg.assigneeNote),
      factory: factoryBreakdown,
      machineType: machineBreakdown,
      readyForFulfill: (agg.readyBreakdown as Array<{ key: boolean; count: number }>).map((r) => ({
        key: !!r.key,
        count: r.count,
      })),
    };

    return {
      success: true,
      data: { totals, breakdown, filter: dto },
    };
  }

  /**
   * Aggregate every order created on a given day (across all imports) into
   * (type, size, fabricType) groups. Workshop scans these to print the same
   * blank batch together. Sorted by `orderCount` desc → most duplicated combo
   * first; ties broken by type, size, fabric for stable rendering.
   */
  async getImportSummary(dto: GetImportSummaryDto): Promise<GetImportSummaryResDto> {
    const target = dto.date ? dto.date.slice(0, 10) : vnTodayString();
    const dayStart = vnDayStart(target);
    const dayEnd = vnDayEnd(target);

    const rows = await this.orderModel.aggregate([
      { $match: { inProductionAt: { $gte: dayStart, $lte: dayEnd } } },
      {
        $group: {
          _id: {
            type: { $ifNull: ['$type', ''] },
            size: { $ifNull: ['$size', ''] },
            fabricType: { $ifNull: ['$fabricType', ''] },
          },
          totalQuantity: { $sum: { $ifNull: ['$quantity', 1] } },
          orderCount: { $sum: 1 },
          sampleProductionIds: { $push: '$productionId' },
        },
      },
      {
        $project: {
          _id: 0,
          type: '$_id.type',
          size: '$_id.size',
          fabricType: '$_id.fabricType',
          totalQuantity: 1,
          orderCount: 1,
          // Cap sample list at 5 to keep payload small.
          sampleProductionIds: { $slice: ['$sampleProductionIds', 5] },
        },
      },
      // Primary sort by (type, size, fabric) so rows with same product name
      // cluster together; tiebreak by orderCount desc so heaviest combos
      // float to the top within a (type,size,fabric) bucket.
      { $sort: { type: 1, size: 1, fabricType: 1, orderCount: -1 } },
    ]);

    // Resolve fabric codes → labels in one batch lookup.
    const fabricCodes = Array.from(new Set(rows.map((r: { fabricType: string }) => r.fabricType).filter(Boolean)));
    const fabricMap = new Map<string, string>();
    if (fabricCodes.length > 0) {
      const docs = await this.workshopConfigRepository.findAll({
        category: WorkshopConfigCategory.FabricType,
        code: { $in: fabricCodes },
      });
      for (const d of docs) fabricMap.set(d.code, d.name);
    }

    const groups: ImportSummaryGroup[] = rows.map(
      (r: {
        type: string;
        size: string;
        fabricType: string;
        totalQuantity: number;
        orderCount: number;
        sampleProductionIds: string[];
      }) => ({
        type: r.type,
        size: r.size,
        fabricType: r.fabricType,
        fabricName: r.fabricType ? fabricMap.get(r.fabricType) : undefined,
        totalQuantity: r.totalQuantity,
        orderCount: r.orderCount,
        sampleProductionIds: r.sampleProductionIds,
      }),
    );

    const totalOrders = groups.reduce((s, g) => s + g.orderCount, 0);
    const totalQuantity = groups.reduce((s, g) => s + g.totalQuantity, 0);

    return {
      success: true,
      data: {
        date: dayStart.toISOString().slice(0, 10),
        totalOrders,
        totalQuantity,
        groups,
      },
    };
  }

  /**
   * Move a single order to a different factory. Only `factoryId` mutates; the
   * `originalFactoryId` stays pinned to where it was first imported so the
   * dashboard can show "received from ML" vs "originally here".
   */
  async transferOrder(id: string, dto: TransferOrderDto, ctx?: AuditContext): Promise<TransferOrderResDto> {
    const order = await this.orderRepository.findOne({ _id: id });
    if (!order) throw new NotFoundException('Order not found');
    if (order.factoryId === dto.targetFactoryId) {
      return { success: true, data: { matched: 1, modified: 0 } };
    }
    const before = { factoryId: order.factoryId };
    await this.orderRepository.findOneAndUpdate({ _id: id }, { factoryId: dto.targetFactoryId });
    void this.orderLogService.write({
      orderId: id,
      action: 'transfer',
      before,
      after: { factoryId: dto.targetFactoryId, reason: dto.reason },
      ctx,
    });
    void this.invalidateListCache();
    return { success: true, data: { matched: 1, modified: 1 } };
  }

  async bulkTransferOrders(dto: BulkTransferOrderDto, ctx?: AuditContext): Promise<TransferOrderResDto> {
    // Skip rows already at target so we don't write no-op logs.
    const eligible = await this.orderModel
      .find({ _id: { $in: dto.ids }, factoryId: { $ne: dto.targetFactoryId } })
      .select({ _id: 1, factoryId: 1 })
      .lean();
    const eligibleIds = eligible.map((o) => String(o._id));
    if (eligibleIds.length === 0) {
      return { success: true, data: { matched: dto.ids.length, modified: 0 } };
    }
    const res = await this.orderModel.updateMany(
      { _id: { $in: eligibleIds } },
      { $set: { factoryId: dto.targetFactoryId } },
    );
    void this.orderLogService.writeMany(
      eligible.map((o) => ({
        orderId: String(o._id),
        action: 'transfer' as const,
        before: { factoryId: o.factoryId },
        after: { factoryId: dto.targetFactoryId, reason: dto.reason },
        ctx,
      })),
    );
    void this.invalidateListCache();
    return {
      success: true,
      data: { matched: dto.ids.length, modified: res.modifiedCount || 0 },
    };
  }

  /**
   * Initial-assign factory cho đơn UNMAPPED. Khác `bulkTransferOrders` ở 3 điểm:
   *  1. Chỉ áp dụng cho đơn `factoryId` null (đơn đã mapped sẽ bị skip — đếm
   *     vào `matched` nhưng không vào `modified`).
   *  2. Set luôn `originalFactoryId = factoryId` để đơn coi là "thuần" gốc tại
   *     xưởng này, không hiển thị badge "← Gốc: …" trên FE.
   *  3. Gộp set 4 trường tuỳ chọn (fabricType/machineTypeId/machineNumber/
   *     toolResult) trong 1 update + 1 log entry/đơn.
   *
   *  Validate: factory + machineType qua repository, fabric/machine/tool qua
   *  workshop_config (cùng pattern với assertValueAllowed).
   */
  async bulkAssignOrders(dto: BulkAssignOrderDto, ctx?: AuditContext): Promise<BulkAssignOrderResDto> {
    const factory = await this.factoryRepository.findOne({ _id: dto.factoryId });
    if (!factory) throw new BadRequestException('Factory not found');

    if (dto.machineTypeId) {
      const mt = await this.machineTypeRepository.findOne({ _id: dto.machineTypeId });
      if (!mt) throw new BadRequestException('Machine type not found');
    }
    if (dto.fabricType) await this.assertValueAllowed('fabricType', dto.fabricType);
    if (dto.machineNumber) await this.assertValueAllowed('machineNumber', dto.machineNumber);
    if (dto.toolResult) await this.assertValueAllowed('toolResult', dto.toolResult);

    // Skip đơn đã mapped — feature này chỉ cho unmapped. `bulkTransferOrders`
    // mới handle đổi xưởng cho đơn đã có.
    const eligible = await this.orderModel
      .find({
        _id: { $in: dto.ids },
        $or: [{ factoryId: { $exists: false } }, { factoryId: null }],
      })
      .select({ _id: 1, fabricType: 1, machineTypeId: 1, machineNumber: 1, toolResult: 1 })
      .lean();
    const eligibleIds = eligible.map((o) => String(o._id));
    if (eligibleIds.length === 0) {
      return { success: true, data: { matched: dto.ids.length, modified: 0 } };
    }

    const $set: Record<string, unknown> = {
      factoryId: dto.factoryId,
      originalFactoryId: dto.factoryId,
    };
    if (dto.fabricType) $set.fabricType = dto.fabricType;
    if (dto.machineTypeId) $set.machineTypeId = dto.machineTypeId;
    if (dto.machineNumber) $set.machineNumber = dto.machineNumber;
    if (dto.toolResult) $set.toolResult = dto.toolResult;

    const res = await this.orderModel.updateMany({ _id: { $in: eligibleIds } }, { $set });

    void this.orderLogService.writeMany(
      eligible.map((o) => {
        const before: Record<string, unknown> = { factoryId: null };
        const after: Record<string, unknown> = { factoryId: dto.factoryId };
        if (dto.fabricType) {
          before.fabricType = o.fabricType ?? null;
          after.fabricType = dto.fabricType;
        }
        if (dto.machineTypeId) {
          before.machineTypeId = o.machineTypeId ?? null;
          after.machineTypeId = dto.machineTypeId;
        }
        if (dto.machineNumber) {
          before.machineNumber = o.machineNumber ?? null;
          after.machineNumber = dto.machineNumber;
        }
        if (dto.toolResult) {
          before.toolResult = o.toolResult ?? null;
          after.toolResult = dto.toolResult;
        }
        if (dto.reason) after.reason = dto.reason;
        return {
          orderId: String(o._id),
          action: 'bulk_update' as const,
          before,
          after,
          ctx,
        };
      }),
    );
    void this.invalidateListCache();
    return {
      success: true,
      data: { matched: dto.ids.length, modified: res.modifiedCount || 0 },
    };
  }

  /**
   * Nút "Tự động gán xưởng" ở trang Không xác định xưởng (Orders.md §19): re-map
   * TOÀN BỘ đơn unmapped theo Product Config HIỆN TẠI — dành cho đơn import lúc
   * config chưa có, sau đó admin đã tạo/bổ sung config (vd kéo từ cột "Chưa xác
   * định xưởng" ở kanban Settings). Mapping y hệt `importOrders`: khớp `type` ↔
   * `fullName` (exact, case-insensitive) → set đủ bộ isMapped/productConfigId/
   * factoryId/originalFactoryId/machineTypeId; riêng fabricType/machineNumber
   * chỉ điền khi đơn đang trống (tôn trọng chỉnh tay của xưởng — cùng tinh thần
   * insert-only của import).
   */
  async remapUnmappedOrders(ctx?: AuditContext): Promise<{ scanned: number; matchedTypes: number; assigned: number }> {
    const unmappedFilter = {
      $or: [{ factoryId: { $exists: false } }, { factoryId: null }],
      deletedAt: { $exists: false },
    };
    const [scanned, rawTypes, configs] = await Promise.all([
      this.orderModel.countDocuments(unmappedFilter),
      this.orderModel.distinct('type', { ...unmappedFilter, type: { $nin: [null, ''] } }),
      this.productConfigRepository.findAll({}),
    ]);

    const byName = new Map<string, (typeof configs)[number]>();
    for (const pc of configs) byName.set(pc.fullName.trim().toLowerCase(), pc);

    const matchedTypes = new Set<string>();
    let assigned = 0;
    for (const rawType of rawTypes as string[]) {
      const key = String(rawType).trim().toLowerCase();
      const pc = byName.get(key);
      if (!pc?.factoryId) continue;

      // Match equality theo đúng giá trị raw từ distinct (nhiều biến thể hoa
      // thường của cùng 1 type được xử lý ở từng vòng lặp riêng).
      const eligible = await this.orderModel
        .find({ ...unmappedFilter, type: rawType })
        .select({ _id: 1 })
        .lean();
      if (eligible.length === 0) continue;
      matchedTypes.add(key);
      const ids = eligible.map((o) => String(o._id));

      const $set: Record<string, unknown> = {
        isMapped: true,
        productConfigId: String(pc._id),
        factoryId: pc.factoryId,
        originalFactoryId: pc.factoryId,
      };
      if (pc.machineTypeId) $set.machineTypeId = pc.machineTypeId;
      await this.orderModel.updateMany({ _id: { $in: ids } }, { $set });
      if (pc.fabricType) {
        await this.orderModel.updateMany(
          { _id: { $in: ids }, $or: [{ fabricType: { $exists: false } }, { fabricType: null }, { fabricType: '' }] },
          { $set: { fabricType: pc.fabricType } },
        );
      }
      if (pc.machineNumber) {
        await this.orderModel.updateMany(
          {
            _id: { $in: ids },
            $or: [{ machineNumber: { $exists: false } }, { machineNumber: null }, { machineNumber: '' }],
          },
          { $set: { machineNumber: pc.machineNumber } },
        );
      }

      void this.orderLogService.writeMany(
        ids.map((orderId) => ({
          orderId,
          action: 'bulk_update' as const,
          before: { factoryId: null },
          after: {
            factoryId: pc.factoryId,
            ...(pc.machineTypeId ? { machineTypeId: pc.machineTypeId } : {}),
            reason: 'Tự động gán xưởng theo Product Config',
          },
          ctx,
        })),
      );
      assigned += ids.length;
    }

    if (assigned > 0) void this.invalidateListCache();
    return { scanned, matchedTypes: matchedTypes.size, assigned };
  }

  /**
   * Dashboard "Vòng đời đơn" — phễu 9 chặng (Soát tool → Thiết kế → 7 stage
   * Fulfillment). Mỗi chặng: snapshot (đang chứa / đang làm / rework / lỗi) +
   * throughput theo kỳ (hoàn thành + thời gian TB). Một aggregate $facet duy
   * nhất gom tất cả. Xem `documents/FunctionDescription/OrderLifecycle.md`.
   *
   * Phạm vi xưởng: user Fulfillment bị khóa vào xưởng của họ; role khác lọc tự
   * do qua `dto.factoryId`. Snapshot KHÔNG lọc ngày (trạng thái hiện tại);
   * throughput/thời gian lọc theo `from`/`to`.
   */
  async getLifecycleOverview(
    dto: GetLifecycleOverviewDto,
    roleName?: RoleType,
    userFactoryId?: string,
  ): Promise<GetLifecycleOverviewResDto> {
    const isFactoryBound = roleName === RoleType.Fulfillment;
    const scopedFactoryId = isFactoryBound ? userFactoryId : dto.factoryId;

    const from = dto.from ? vnDayStart(dto.from) : undefined;
    const to = dto.to ? vnDayEnd(dto.to) : undefined;

    const match: Record<string, unknown> = {
      deletedAt: { $exists: false },
      cancelledAt: { $exists: false },
    };
    // Lọc theo NGÀY VÀO SẢN XUẤT của đơn (`inProductionAt`) — để "đơn vào ngày
    // đó hiện đang tồn ở công đoạn nào". Áp cho TOÀN BỘ dataset (cả snapshot) chứ
    // không chỉ throughput, đồng bộ với getDashboard/getFactoryOverview.
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      match.inProductionAt = range;
    }
    if (isFactoryBound) {
      if (!userFactoryId) {
        match.factoryId = '__no_factory__';
      } else {
        match.$or = [{ factoryId: userFactoryId }, { originalFactoryId: userFactoryId }];
      }
    } else if (dto.factoryId) {
      match.$or = [{ factoryId: dto.factoryId }, { originalFactoryId: dto.factoryId }];
    } else {
      // Đơn chưa map xưởng + đơn xưởng US (ngoài luồng sản xuất) bị loại khỏi
      // Dashboard vòng đời.
      match.factoryId = productionFactoryClause(this.orderModel.db);
    }

    // Lọc theo khách hàng (chọn từ combobox strip — options do facet `customers`
    // bên dưới trả về) — khớp CHÍNH XÁC userSku (+ userEmail nếu có),
    // case-insensitive. Dùng $and để không đè $or scope xưởng ở trên.
    // PRD-8 — tab dịch vụ (Seller Hub Operations): chỉ đơn thuộc dòng sản phẩm này.
    if (dto.productLine) {
      const and = (match.$and as unknown[] | undefined) ?? [];
      and.push({ productLine: dto.productLine });
      match.$and = and;
    }
    if (dto.userSku?.trim()) {
      const and = (match.$and as unknown[] | undefined) ?? [];
      and.push({ userSku: { $regex: `^${escapeRegex(dto.userSku.trim())}$`, $options: 'i' } });
      if (dto.userEmail?.trim()) {
        and.push({ userEmail: { $regex: `^${escapeRegex(dto.userEmail.trim())}$`, $options: 'i' } });
      }
      match.$and = and;
    }

    // Đếm RIÊNG đơn hủy trong cùng window inProductionAt + xưởng (funnel đã loại
    // đơn hủy) → thống kê "Đơn đã hủy" trên strip/dashboard vòng đời.
    const cancelledInRange = await this.orderModel.countDocuments({
      ...match,
      cancelledAt: { $exists: true },
    });

    // Expression: `field` (mốc hoàn thành) nằm trong khoảng ngày — dùng cho các
    // chỉ số throughput (doneInRange / avgWorkMs / timeline) trong NHÓM đơn đã
    // lọc theo inProductionAt. Missing → false.
    const inRange = (field: string) => {
      const f = { $ifNull: [field, null] };
      const conds: Record<string, unknown>[] = [{ $ne: [f, null] }];
      if (from) conds.push({ $gte: [f, from] });
      if (to) conds.push({ $lte: [f, to] });
      return { $and: conds };
    };

    // Status của stage hiện tại — key động → lọc entry khớp currentFulfillmentStage
    // (tránh field-path có dấu gạch như `qc-post-press`).
    const curStatusExpr = {
      $let: {
        vars: {
          cur: {
            $arrayElemAt: [
              {
                $filter: {
                  input: { $objectToArray: { $ifNull: ['$fulfillmentStages', {}] } },
                  cond: { $eq: ['$$this.k', '$currentFulfillmentStage'] },
                },
              },
              0,
            ],
          },
        },
        in: '$$cur.v.status',
      },
    };

    const emptyTool = { $in: [{ $ifNull: ['$toolResultNote', ''] }, ['', null]] };
    // Marker đơn bị đẩy về Support soát lại — CÙNG định nghĩa với "cần làm lại"
    // ở tab Soát tool (getToolCheckOverview.reworkMatch).
    const toolReworkMarker = {
      $and: [{ $eq: ['$productionErrorSource', 'tool-check'] }, { $eq: ['$toolResultNote', 'error'] }],
    };
    // "Đang cần designer nhưng CHƯA gán" — mirror `unassignedNeedCond` của
    // getDailyOverview (bảng "Chưa gán designer"): thuộc pool cần/qua designer
    // (từng soát ra lỗi ∨ đã vào flow) & chưa gán & ĐANG lỗi (note ≠ ''/'ok').
    // Tự loại đơn "In trả về chờ Soát tool" (note='error' do máy set, không có
    // marker toolCheckErrorNotes → không thuộc pool).
    const noteExpr = { $ifNull: ['$toolResultNote', ''] };
    const curErrorCond = { $and: [{ $ne: [noteExpr, ''] }, { $ne: [noteExpr, 'ok'] }] };
    const toolErrHasCond = { $gt: [{ $size: { $ifNull: ['$toolCheckErrorNotes', []] } }, 0] };
    const designerStatusExpr = { $ifNull: ['$designerStatus', DesignerStatus.Unassigned] };
    const s4Cond = {
      $in: [
        designerStatusExpr,
        [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework, DesignerStatus.Done],
      ],
    };
    const assignedCond = { $and: [{ $ne: [{ $ifNull: ['$assignee', ''] }, ''] }, s4Cond] };
    const unassignedNeedCond = {
      $and: [{ $or: [toolErrHasCond, s4Cond] }, { $not: [assignedCond] }, curErrorCond],
    };

    const [agg] = await this.orderModel.aggregate([
      { $match: match },
      {
        $facet: {
          tool: [
            {
              $group: {
                _id: null,
                backlog: { $sum: { $cond: [emptyTool, 1, 0] } },
                error: { $sum: { $cond: [{ $eq: ['$toolResultNote', 'error'] }, 1, 0] } },
                rework: { $sum: { $cond: [toolReworkMarker, 1, 0] } },
                // Đã qua = đã soát và KHÔNG đang bị đẩy về soát lại (marker).
                passed: { $sum: { $cond: [{ $or: [emptyTool, toolReworkMarker] }, 0, 1] } },
                doneInRange: { $sum: { $cond: [inRange('$toolCheckedAt'), 1, 0] } },
                workSum: {
                  $sum: {
                    $cond: [
                      inRange('$toolCheckedAt'),
                      { $subtract: ['$toolCheckedAt', { $ifNull: ['$inProductionAt', '$createdAt'] }] },
                      0,
                    ],
                  },
                },
                workCnt: { $sum: { $cond: [inRange('$toolCheckedAt'), 1, 0] } },
              },
            },
          ],
          designer: [
            {
              $group: {
                _id: null,
                // "Đang chờ" = đơn lỗi ĐÃ gán chờ làm (status=assigned) + đơn
                // đang cần designer CHƯA gán (unassignedNeedCond) — KHÔNG đếm
                // mọi đơn unassigned (default của đơn thường không cần design).
                backlog: {
                  $sum: {
                    $cond: [
                      { $or: [{ $eq: [designerStatusExpr, DesignerStatus.Assigned] }, unassignedNeedCond] },
                      1,
                      0,
                    ],
                  },
                },
                assigned: {
                  $sum: { $cond: [{ $eq: ['$designerStatus', DesignerStatus.Assigned] }, 1, 0] },
                },
                inProgress: {
                  $sum: { $cond: [{ $eq: ['$designerStatus', DesignerStatus.InProgress] }, 1, 0] },
                },
                rework: { $sum: { $cond: [{ $eq: ['$designerStatus', DesignerStatus.Rework] }, 1, 0] } },
                error: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$productionErrorSource', 'designer'] },
                          { $ne: [{ $ifNull: ['$productionError', ''] }, ''] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                passed: {
                  $sum: { $cond: [{ $ne: [{ $ifNull: ['$designerCompletedAt', null] }, null] }, 1, 0] },
                },
                doneInRange: { $sum: { $cond: [inRange('$designerCompletedAt'), 1, 0] } },
                workSum: {
                  $sum: { $cond: [inRange('$designerCompletedAt'), { $ifNull: ['$designerWorkMs', 0] }, 0] },
                },
                workCnt: { $sum: { $cond: [inRange('$designerCompletedAt'), 1, 0] } },
              },
            },
          ],
          fulfillmentSnapshot: [
            { $match: { currentFulfillmentStage: { $in: FULFILLMENT_STAGES } } },
            {
              $group: {
                _id: '$currentFulfillmentStage',
                backlog: { $sum: { $cond: [{ $eq: [curStatusExpr, FulfillmentStageStatus.Waiting] }, 1, 0] } },
                inProgress: {
                  $sum: { $cond: [{ $eq: [curStatusExpr, FulfillmentStageStatus.InProgress] }, 1, 0] },
                },
                rework: { $sum: { $cond: [{ $eq: [curStatusExpr, FulfillmentStageStatus.Rework] }, 1, 0] } },
                error: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$productionError', ''] }, ''] }, 1, 0] } },
              },
            },
          ],
          fulfillmentByStage: [
            { $project: { stages: { $objectToArray: { $ifNull: ['$fulfillmentStages', {}] } } } },
            { $unwind: '$stages' },
            {
              $group: {
                _id: '$stages.k',
                passed: { $sum: { $cond: [{ $eq: ['$stages.v.status', FulfillmentStageStatus.Done] }, 1, 0] } },
                doneInRange: { $sum: { $cond: [inRange('$stages.v.completedAt'), 1, 0] } },
                workSum: {
                  $sum: { $cond: [inRange('$stages.v.completedAt'), { $ifNull: ['$stages.v.workMs', 0] }, 0] },
                },
                workCnt: { $sum: { $cond: [inRange('$stages.v.completedAt'), 1, 0] } },
              },
            },
          ],
          totalAll: [{ $count: 'n' }],
          totalActive: [{ $match: { fulfillmentCompletedAt: { $in: [null, undefined] } } }, { $count: 'n' }],
          // "Hoàn thành" = đơn TRONG COHORT (inProductionAt ∈ kỳ) đã đóng hàng
          // xong — KHÔNG lọc thêm theo ngày hoàn thành (thuần trục inProductionAt
          // → bất biến totalOrders = totalActive + completedInRange).
          totalCycle: [
            { $match: { fulfillmentCompletedAt: { $exists: true, $ne: null } } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                avgMs: {
                  $avg: {
                    $subtract: [
                      '$fulfillmentCompletedAt',
                      {
                        $ifNull: ['$designerFirstStartedAt', { $ifNull: ['$designerCompletedAt', '$createdAt'] }],
                      },
                    ],
                  },
                },
              },
            },
          ],
          completionTimeline: [
            // Cohort-based: ngày hoàn thành của đơn trong kỳ có thể rơi ngoài
            // window inProductionAt — chart hiện đúng ngày đó.
            { $match: { fulfillmentCompletedAt: { $exists: true, $ne: null } } },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$fulfillmentCompletedAt',
                    timezone: '+07:00',
                  },
                },
                completed: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          factories: [
            { $match: { factoryId: { $exists: true, $nin: [null, ''] } } },
            { $group: { _id: '$factoryId' } },
            { $lookup: { from: 'factories', localField: '_id', foreignField: '_id', as: 'f' } },
            {
              $project: {
                _id: 0,
                factoryId: '$_id',
                factoryName: { $ifNull: [{ $arrayElemAt: ['$f.name', 0] }, 'Chưa map'] },
              },
            },
            { $sort: { factoryName: 1 } },
          ],
          // Danh sách khách trong scope đang lọc (options cho combobox strip) —
          // group theo cặp (userSku,userEmail) như `customerMatchKey`, nhiều đơn
          // nhất trước, cap 300.
          customers: [
            { $match: { userSku: { $exists: true, $nin: [null, ''] } } },
            {
              $group: {
                _id: { sku: '$userSku', email: { $ifNull: ['$userEmail', ''] } },
                n: { $sum: 1 },
              },
            },
            { $sort: { n: -1 } },
            { $limit: 300 },
            { $project: { _id: 0, userSku: '$_id.sku', userEmail: '$_id.email', count: '$n' } },
          ],
        },
      },
    ]);

    const avg = (sum: number, cnt: number) => (cnt > 0 ? Math.round(sum / cnt) : 0);
    const toolRow = agg.tool[0] || {};
    const designerRow = agg.designer[0] || {};
    const fSnap = new Map<string, Record<string, number>>(
      (agg.fulfillmentSnapshot as Array<Record<string, number> & { _id: string }>).map((r) => [r._id, r]),
    );
    const fStage = new Map<string, Record<string, number>>(
      (agg.fulfillmentByStage as Array<Record<string, number> & { _id: string }>).map((r) => [r._id, r]),
    );

    const stages: LifecycleStageRow[] = [
      {
        stage: 'tool-check',
        label: 'Soát tool',
        backlog: toolRow.backlog || 0,
        waitingToStart: 0,
        inProgress: 0,
        rework: toolRow.rework || 0,
        error: toolRow.error || 0,
        doneInRange: toolRow.doneInRange || 0,
        passedTotal: toolRow.passed || 0,
        avgWorkMs: avg(toolRow.workSum || 0, toolRow.workCnt || 0),
      },
      {
        stage: 'designer',
        label: 'Thiết kế',
        backlog: designerRow.backlog || 0,
        waitingToStart: designerRow.assigned || 0,
        inProgress: designerRow.inProgress || 0,
        rework: designerRow.rework || 0,
        error: designerRow.error || 0,
        doneInRange: designerRow.doneInRange || 0,
        passedTotal: designerRow.passed || 0,
        avgWorkMs: avg(designerRow.workSum || 0, designerRow.workCnt || 0),
      },
      ...FULFILLMENT_STAGES.map((s): LifecycleStageRow => {
        const snap = fSnap.get(s) || {};
        const tp = fStage.get(s) || {};
        return {
          stage: s,
          label: FULFILLMENT_STAGE_LABELS[s],
          backlog: snap.backlog || 0,
          waitingToStart: snap.backlog || 0,
          inProgress: snap.inProgress || 0,
          rework: snap.rework || 0,
          error: snap.error || 0,
          doneInRange: tp.doneInRange || 0,
          passedTotal: tp.passed || 0,
          avgWorkMs: avg(tp.workSum || 0, tp.workCnt || 0),
        };
      }),
    ];

    // Bottleneck = chặng có backlog (đang chứa) lớn nhất.
    let bottleneckStage: string | null = null;
    let maxBacklog = 0;
    for (const r of stages) {
      if (r.backlog > maxBacklog) {
        maxBacklog = r.backlog;
        bottleneckStage = r.stage;
      }
    }

    const factoryOptions = await this.listFactoryOptions();
    const cycleRow = agg.totalCycle[0];
    const completionTimeline = (agg.completionTimeline as Array<{ _id: string; completed: number }>).map((r) => ({
      date: r._id,
      completed: r.completed,
    }));

    return {
      success: true,
      data: {
        stages,
        totals: {
          totalOrders: agg.totalAll[0]?.n || 0,
          totalActive: agg.totalActive[0]?.n || 0,
          completedInRange: cycleRow?.count || 0,
          avgTotalCycleMs: cycleRow?.avgMs ? Math.round(cycleRow.avgMs) : 0,
          bottleneckStage,
          cancelledInRange,
        },
        completionTimeline,
        // Options xưởng = ĐỦ xưởng đang bật (bảng `factories`, GIỮ cả xưởng US)
        // HỢP với xưởng đang giữ đơn trong kỳ. Chỉ lấy từ `agg.factories` thì
        // xưởng chưa có đơn nào biến mất khỏi select; chỉ lấy từ bảng
        // `factories` thì đơn của xưởng vừa bị tắt lại không lọc ra được.
        factories: this.mergeFactoryOptions(
          factoryOptions,
          agg.factories as Array<{ factoryId: unknown; factoryName: string }>,
        ),
        customers: (agg.customers as Array<{ userSku: string; userEmail: string; count: number }>) ?? [],
        filter: { factoryId: scopedFactoryId, from: dto.from, to: dto.to },
      },
    };
  }

  /**
   * Danh sách đơn HỦY (drill-down khi bấm số "Đơn đã hủy" trên Dashboard /
   * LifecycleStrip). Scope = cùng xưởng + khoảng `inProductionAt` như dashboard.
   * Cap 500 dòng (log nếu vượt). Sort theo ngày hủy mới nhất.
   */
  async getCancelledOrders(
    dto: GetCancelledOrdersDto,
    roleName?: RoleType,
    fulfillmentFactoryId?: string,
  ): Promise<GetCancelledOrdersResDto> {
    const from = dto.from ? vnDayStart(dto.from) : undefined;
    const to = dto.to ? vnDayEnd(dto.to) : undefined;

    const match: Record<string, unknown> = {
      deletedAt: { $exists: false },
      cancelledAt: { $exists: true },
    };
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      match.inProductionAt = range;
    }
    const isFactoryBound = roleName === RoleType.Fulfillment;
    const scopedFactoryId = isFactoryBound ? fulfillmentFactoryId : dto.factoryId;
    if (isFactoryBound && !fulfillmentFactoryId) {
      match.factoryId = '__no_factory__';
    } else if (scopedFactoryId) {
      match.$or = [{ factoryId: scopedFactoryId }, { originalFactoryId: scopedFactoryId }];
    } else {
      // Đơn chưa map xưởng + đơn xưởng US (ngoài luồng sản xuất) bị loại khỏi
      // drill-down "Đơn đã hủy".
      match.factoryId = productionFactoryClause(this.orderModel.db);
    }
    // Lọc theo khách hàng — cùng ngữ nghĩa `getLifecycleOverview` (exact pair).
    if (dto.userSku?.trim()) {
      const and = (match.$and as unknown[] | undefined) ?? [];
      and.push({ userSku: { $regex: `^${escapeRegex(dto.userSku.trim())}$`, $options: 'i' } });
      if (dto.userEmail?.trim()) {
        and.push({ userEmail: { $regex: `^${escapeRegex(dto.userEmail.trim())}$`, $options: 'i' } });
      }
      match.$and = and;
    }

    type Lean = {
      _id: unknown;
      productionId?: string;
      type?: string;
      size?: string;
      color?: string;
      userSku?: string;
      cancelReason?: string;
      cancelledAt?: Date;
      inProductionAt?: Date;
      currentFulfillmentStage?: string | null;
      designerStatus?: string;
    };

    const CAP = 500;
    const [rowsRaw, total] = await Promise.all([
      this.orderModel
        .find(match, {
          productionId: 1,
          type: 1,
          size: 1,
          color: 1,
          userSku: 1,
          cancelReason: 1,
          cancelledAt: 1,
          inProductionAt: 1,
          currentFulfillmentStage: 1,
          designerStatus: 1,
        })
        .sort({ cancelledAt: -1 })
        .limit(CAP)
        .lean(),
      this.orderModel.countDocuments(match),
    ]);

    if (total > CAP) {
      this.logger.warn(
        `[getCancelledOrders] cắt danh sách: total=${total} > cap=${CAP} (chỉ trả ${CAP} dòng mới nhất).`,
      );
    }

    const data: CancelledOrderRow[] = (rowsRaw as unknown as Lean[]).map((o) => ({
      _id: String(o._id),
      productionId: String(o.productionId || ''),
      type: o.type,
      size: o.size,
      color: o.color,
      userSku: o.userSku,
      cancelReason: o.cancelReason,
      cancelledAt: o.cancelledAt,
      inProductionAt: o.inProductionAt,
      currentFulfillmentStage: o.currentFulfillmentStage ?? null,
      designerStatus: o.designerStatus,
    }));

    return { success: true, data, total };
  }

  /**
   * Dashboard payload for the "Đơn hàng theo xưởng" tab.
   *  - `factories[i]` = totals at factory i + how many transferred in/out
   *  - `flows[]` = origin→current pairs with non-trivial count
   *  - `totals` = grand total + transferred + pure
   */
  async getFactoryOverview(
    dto: GetFactoryOverviewDto,
    roleName?: RoleType,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<GetFactoryOverviewResDto> {
    const match: Record<string, unknown> = {};
    // Fulfillment scope theo xưởng. User In (stage=print): thấy mọi trạng thái
    // (bỏ readyForFulfill) nhưng CHỈ xưởng mình (factoryId). Stage khác: chỉ đơn
    // đã Ok + (factoryId hoặc originalFactoryId).
    if (roleName === RoleType.Fulfillment) {
      const printView = this.isPrintAdminView(roleName, fulfillmentStage);
      if (!printView) match.readyForFulfill = true;
      if (!fulfillmentFactoryId) {
        match.factoryId = '__no_factory__';
      } else if (printView) {
        match.factoryId = fulfillmentFactoryId;
      } else {
        match.$or = [{ factoryId: fulfillmentFactoryId }, { originalFactoryId: fulfillmentFactoryId }];
      }
    }
    if (dto.createdFrom || dto.createdTo) {
      const range: Record<string, Date> = {};
      if (dto.createdFrom) range.$gte = vnDayStart(dto.createdFrom);
      if (dto.createdTo) range.$lte = vnDayEnd(dto.createdTo);
      // Filter theo `inProductionAt` VN tz (xem comment ở `buildVisibilityFilter`).
      match.inProductionAt = range;
    }
    // Loại đơn hủy khỏi mọi số liệu xưởng (matchMapped kế thừa qua spread).
    match.cancelledAt = { $exists: false };
    // `matchMapped` đếm/aggregate đơn đã map xưởng — Cards/flow/stats đều
    // cần `factoryId` để classify. Đơn chưa map xưởng không còn hiện ở tab
    // này — xem qua trang "Không xác định xưởng" riêng.
    // QUAN TRỌNG: nếu `match` đã scope cứng `factoryId` (user In = xưởng mình)
    // thì GIỮ NGUYÊN, KHÔNG ghi đè bằng `{ $exists }` (sẽ lộ mọi xưởng).
    const matchMapped: Record<string, unknown> = { ...match };
    if (matchMapped.factoryId === undefined) {
      matchMapped.factoryId = { $exists: true, $ne: null };
    }
    matchMapped.originalFactoryId = { $exists: true, $ne: null };

    // Faceted filters (select dropdowns). Áp dụng cho CẢ thẻ xưởng (flow/stats/
    // breakdown/unmapped) → mỗi xưởng chỉ đếm đơn khớp filter (vd. lọc khách
    // hàng → mỗi thẻ chỉ tính đơn của khách đó). `availableFilters` vẫn
    // cross-facet riêng qua `buildFacetMatch` (loại trừ chính field đó).
    const facetFilters: Record<string, unknown> = {};
    if (dto.type) facetFilters.type = { $in: dto.type.split(',').filter(Boolean) };
    if (dto.fabricType) facetFilters.fabricType = { $in: dto.fabricType.split(',').filter(Boolean) };
    if (dto.toolResult) facetFilters.toolResult = { $in: dto.toolResult.split(',').filter(Boolean) };
    if (dto.toolResultNote) {
      facetFilters.toolResultNote = { $in: dto.toolResultNote.split(',').filter(Boolean) };
    }
    if (dto.userSku) facetFilters.userSku = { $in: dto.userSku.split(',').filter(Boolean) };
    if (dto.machineTypeId) facetFilters.machineTypeId = dto.machineTypeId;
    if (dto.machineNumber) {
      facetFilters.machineNumber = { $in: dto.machineNumber.split(',').filter(Boolean) };
    }
    // Match cho thẻ xưởng = mapped + các facet đang chọn.
    const cardMatch: Record<string, unknown> = { ...matchMapped, ...facetFilters };

    type FlowRow = { _id: { from: string; to: string }; count: number; totalQuantity: number };
    const flowRows = await this.orderModel.aggregate<FlowRow>([
      { $match: cardMatch },
      {
        $group: {
          _id: { from: '$originalFactoryId', to: '$factoryId' },
          count: { $sum: 1 },
          totalQuantity: { $sum: { $ifNull: ['$quantity', 1] } },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // One bulk fetch for factory names — both endpoints of every flow.
    const factoryIds = Array.from(new Set(flowRows.flatMap((f) => [f._id.from, f._id.to]).filter(Boolean)));
    const factoryDocs = factoryIds.length
      ? await (
          this.orderModel.db.collection('factories') as unknown as {
            find: (q: Record<string, unknown>) => {
              toArray: () => Promise<Array<{ _id: unknown; name: string; shortName?: string }>>;
            };
          }
        )
          .find({ _id: { $in: factoryIds } })
          .toArray()
      : [];
    const fmap = new Map<string, { name: string; shortName?: string }>();
    for (const f of factoryDocs) {
      fmap.set(String(f._id), { name: f.name, shortName: f.shortName });
    }

    // Build per-factory totals from flowRows.
    const cellMap = new Map<string, FactoryOverviewCell>();
    const ensureCell = (fid: string): FactoryOverviewCell => {
      let cell = cellMap.get(fid);
      if (!cell) {
        const meta = fmap.get(fid) || { name: 'Unknown', shortName: undefined };
        cell = {
          factoryId: fid,
          factoryName: meta.name,
          factoryShortName: meta.shortName,
          total: 0,
          pure: 0,
          transferredIn: 0,
          transferredOut: 0,
          productCount: 0,
          fabricCount: 0,
          machineCount: 0,
          actualMachineCount: 0,
          withToolCount: 0,
          printedCount: 0,
          printingCount: 0,
          notPrintedCount: 0,
          errorCount: 0,
          designAssignedCount: 0,
          designUnassignedCount: 0,
          designDoneCount: 0,
          designNotDoneCount: 0,
          breakdowns: { products: [], fabrics: [], sizes: [], toolResults: [] },
        };
        cellMap.set(fid, cell);
      }
      return cell;
    };

    let grandTotal = 0;
    let transferred = 0;
    let pure = 0;
    for (const r of flowRows) {
      grandTotal += r.count;
      const from = r._id.from;
      const to = r._id.to;
      const isPure = from === to;
      if (isPure) {
        pure += r.count;
        const cell = ensureCell(to);
        cell.total += r.count;
        cell.pure += r.count;
      } else {
        transferred += r.count;
        const cellTo = ensureCell(to);
        cellTo.total += r.count;
        cellTo.transferredIn += r.count;
        const cellFrom = ensureCell(from);
        cellFrom.transferredOut += r.count;
      }
    }

    const flows: FactoryFlow[] = flowRows
      .filter((r) => r._id.from !== r._id.to)
      .map((r) => {
        const fmeta = fmap.get(r._id.from) || { name: '?', shortName: undefined };
        const tmeta = fmap.get(r._id.to) || { name: '?', shortName: undefined };
        return {
          fromFactoryId: r._id.from,
          fromName: fmeta.name,
          fromShortName: fmeta.shortName,
          toFactoryId: r._id.to,
          toName: tmeta.name,
          toShortName: tmeta.shortName,
          count: r.count,
          totalQuantity: r.totalQuantity,
        };
      });

    // ─── Per-factory stats: distinct products/fabrics + with-tool counts ───
    // Tool codes whose `name` starts with "Có" mean the product has a tool.
    // We resolve once and keep the IDs for an aggregation match.
    const toolHasCodes = (
      await this.workshopConfigRepository.findAll({
        category: WorkshopConfigCategory.ToolResult,
        name: { $regex: '^Có', $options: 'i' },
      })
    ).map((d) => d.code);

    type StatRow = {
      _id: string;
      productCount: number;
      fabricCount: number;
      machineCount: number;
      actualMachineCount: number;
      withToolCount: number;
      printedCount: number;
      printingCount: number;
      notPrintedCount: number;
      errorCount: number;
      designAssignedCount: number;
      designUnassignedCount: number;
      designDoneCount: number;
      designNotDoneCount: number;
    };
    const statRows = await this.orderModel.aggregate<StatRow>([
      { $match: cardMatch },
      {
        $group: {
          _id: '$factoryId',
          types: { $addToSet: '$type' },
          fabrics: { $addToSet: '$fabricType' },
          // `machines` (legacy name) đếm machineTypeId → đây là "Phòng" / loại
          // máy in. `actualMachines` đếm machineNumber → số máy thực (94/27/56).
          machines: { $addToSet: '$machineTypeId' },
          actualMachines: { $addToSet: '$machineNumber' },
          withToolCount: {
            $sum: { $cond: [{ $in: ['$toolResult', toolHasCodes] }, 1, 0] },
          },
          // 3 print stage — disjoint, cộng lại = total
          printedCount: {
            $sum: { $cond: [{ $in: ['$printStatus', PRINTED_MACHINE_CODES] }, 1, 0] },
          },
          printingCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ['$printStatus', ''] }, ''] },
                    { $not: [{ $in: ['$printStatus', PRINTED_MACHINE_CODES] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          notPrintedCount: {
            $sum: { $cond: [{ $eq: [{ $ifNull: ['$printStatus', ''] }, ''] }, 1, 0] },
          },
          // Lỗi xưởng — đếm độc lập với 3 print stage (một đơn có thể vừa
          // chưa in vừa được báo lỗi, hoặc đã in xong nhưng phát hiện lỗi).
          errorCount: {
            $sum: { $cond: [{ $ne: [{ $ifNull: ['$productionError', ''] }, ''] }, 1, 0] },
          },
          // Design theo designerStatus: 2 cặp disjoint (mỗi cặp cộng lại = total).
          designUnassignedCount: {
            $sum: {
              $cond: [{ $eq: [{ $ifNull: ['$designerStatus', 'unassigned'] }, 'unassigned'] }, 1, 0],
            },
          },
          designAssignedCount: {
            $sum: {
              $cond: [{ $ne: [{ $ifNull: ['$designerStatus', 'unassigned'] }, 'unassigned'] }, 1, 0],
            },
          },
          designDoneCount: {
            $sum: { $cond: [{ $eq: ['$designerStatus', 'done'] }, 1, 0] },
          },
          designNotDoneCount: {
            $sum: {
              $cond: [{ $ne: [{ $ifNull: ['$designerStatus', 'unassigned'] }, 'done'] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          productCount: {
            $size: {
              $filter: { input: '$types', as: 't', cond: { $and: [{ $ne: ['$$t', null] }, { $ne: ['$$t', ''] }] } },
            },
          },
          fabricCount: {
            $size: {
              $filter: { input: '$fabrics', as: 'f', cond: { $and: [{ $ne: ['$$f', null] }, { $ne: ['$$f', ''] }] } },
            },
          },
          machineCount: {
            $size: {
              $filter: { input: '$machines', as: 'm', cond: { $and: [{ $ne: ['$$m', null] }, { $ne: ['$$m', ''] }] } },
            },
          },
          actualMachineCount: {
            $size: {
              $filter: {
                input: '$actualMachines',
                as: 'a',
                cond: { $and: [{ $ne: ['$$a', null] }, { $ne: ['$$a', ''] }] },
              },
            },
          },
          withToolCount: 1,
          printedCount: 1,
          printingCount: 1,
          notPrintedCount: 1,
          errorCount: 1,
          designAssignedCount: 1,
          designUnassignedCount: 1,
          designDoneCount: 1,
          designNotDoneCount: 1,
        },
      },
    ]);
    for (const s of statRows) {
      const cell = cellMap.get(s._id);
      if (!cell) continue;
      cell.productCount = s.productCount;
      cell.fabricCount = s.fabricCount;
      cell.machineCount = s.machineCount;
      cell.actualMachineCount = s.actualMachineCount;
      cell.withToolCount = s.withToolCount;
      cell.printedCount = s.printedCount;
      cell.printingCount = s.printingCount;
      cell.notPrintedCount = s.notPrintedCount;
      cell.errorCount = s.errorCount;
      cell.designAssignedCount = s.designAssignedCount;
      cell.designUnassignedCount = s.designUnassignedCount;
      cell.designDoneCount = s.designDoneCount;
      cell.designNotDoneCount = s.designNotDoneCount;
    }

    // ─── Per-factory dimension breakdowns (Summary sub-tab) ─────────────
    // Group by (factoryId, field) and count, then bucket into per-factory
    // top-N lists. We pull these 4 aggregations in parallel.
    type BreakdownRow = { _id: { factory: string; v: string }; count: number };
    const breakdownPipeline = (field: string, filterOut: { $ne?: unknown } = {}) => [
      { $match: { ...cardMatch, [field]: { $exists: true, $ne: null, $nin: [''], ...filterOut } } },
      { $group: { _id: { factory: '$factoryId', v: `$${field}` }, count: { $sum: 1 } } },
      { $sort: { count: -1 as const } },
    ];
    const [productBd, fabricBd, sizeBd, toolBd] = await Promise.all([
      this.orderModel.aggregate<BreakdownRow>(breakdownPipeline('type')),
      this.orderModel.aggregate<BreakdownRow>(breakdownPipeline('fabricType')),
      this.orderModel.aggregate<BreakdownRow>(breakdownPipeline('size')),
      this.orderModel.aggregate<BreakdownRow>(breakdownPipeline('toolResult')),
    ]);
    // Resolve fabric + tool codes → names. Product type + size are raw strings.
    const fabricMetaMap = new Map<string, string>(
      (await this.workshopConfigRepository.findAll({ category: WorkshopConfigCategory.FabricType })).map((d) => [
        d.code,
        d.name,
      ]),
    );
    const toolMetaMap = new Map<string, string>(
      (await this.workshopConfigRepository.findAll({ category: WorkshopConfigCategory.ToolResult })).map((d) => [
        d.code,
        d.name,
      ]),
    );
    const pushBd = (
      rows: BreakdownRow[],
      key: 'products' | 'fabrics' | 'sizes' | 'toolResults',
      label: (v: string) => string,
      limit = 20,
    ) => {
      const perFactory = new Map<string, BreakdownRow[]>();
      for (const r of rows) {
        const arr = perFactory.get(r._id.factory) || [];
        arr.push(r);
        perFactory.set(r._id.factory, arr);
      }
      for (const [fid, list] of perFactory) {
        const cell = cellMap.get(fid);
        if (!cell) continue;
        cell.breakdowns[key] = list.slice(0, limit).map((r) => ({
          value: r._id.v,
          label: label(r._id.v),
          count: r.count,
        }));
      }
    };
    pushBd(productBd, 'products', (v) => v);
    pushBd(fabricBd, 'fabrics', (v) => fabricMetaMap.get(v) || v);
    pushBd(sizeBd, 'sizes', (v) => v);
    pushBd(toolBd, 'toolResults', (v) => toolMetaMap.get(v) || v);

    // ─── Filter selects: distinct values across the date range ──────────
    // Cross-facet scope: each dropdown counts options applying ALL active
    // filters EXCEPT its own field, so the user can switch values within that
    // facet while other facets reflect the narrowed subset. Cards + flow
    // totals stay unscoped (global view).
    const scopeMatch: Record<string, unknown> =
      dto.unmapped === true
        ? {
            ...match,
            $or: [{ factoryId: { $exists: false } }, { factoryId: null }],
          }
        : { ...matchMapped };
    if (dto.factoryId && dto.unmapped !== true) scopeMatch.factoryId = dto.factoryId;
    if (dto.printStage === 'printed') {
      scopeMatch.printStatus = { $in: PRINTED_MACHINE_CODES };
    } else if (dto.printStage === 'printing') {
      scopeMatch.printStatus = { $exists: true, $nin: [null, '', ...PRINTED_MACHINE_CODES] };
    } else if (dto.printStage === 'not-printed') {
      const printNotClause = [{ printStatus: { $exists: false } }, { printStatus: { $in: [null, ''] } }];
      if (scopeMatch.$or) {
        scopeMatch.$and = [{ $or: scopeMatch.$or }, { $or: printNotClause }];
        delete scopeMatch.$or;
      } else {
        scopeMatch.$or = printNotClause;
      }
    }
    if (dto.hasError === true) {
      scopeMatch.productionError = { $exists: true, $nin: [null, ''] };
    }

    // `facetFilters` đã build ở trên (dùng chung cho thẻ xưởng). availableFilters
    // cross-facet: mỗi dropdown loại trừ chính field của nó.
    const buildFacetMatch = (excludeKey: keyof typeof facetFilters) => {
      const out: Record<string, unknown> = { ...scopeMatch };
      for (const [k, v] of Object.entries(facetFilters)) {
        if (k === excludeKey) continue;
        out[k] = v;
      }
      return out;
    };

    type OptionRow = { _id: string; count: number };
    const [typeRows, fabricRows, toolRows, machineRows, actualMachineRows, toolNoteRows, userRows] = await Promise.all([
      this.orderModel.aggregate<OptionRow>([
        { $match: { ...buildFacetMatch('type'), type: { $exists: true, $ne: null, $nin: [''] } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.orderModel.aggregate<OptionRow>([
        {
          $match: {
            ...buildFacetMatch('fabricType'),
            fabricType: { $exists: true, $ne: null, $nin: [''] },
          },
        },
        { $group: { _id: '$fabricType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.orderModel.aggregate<OptionRow>([
        {
          $match: {
            ...buildFacetMatch('toolResult'),
            toolResult: { $exists: true, $ne: null, $nin: [''] },
          },
        },
        { $group: { _id: '$toolResult', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.orderModel.aggregate<OptionRow>([
        {
          $match: {
            ...buildFacetMatch('machineTypeId'),
            machineTypeId: { $exists: true, $ne: null, $nin: [''] },
          },
        },
        { $group: { _id: '$machineTypeId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.orderModel.aggregate<OptionRow>([
        {
          $match: {
            ...buildFacetMatch('machineNumber'),
            machineNumber: { $exists: true, $ne: null, $nin: [''] },
          },
        },
        { $group: { _id: '$machineNumber', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.orderModel.aggregate<OptionRow>([
        {
          $match: {
            ...buildFacetMatch('toolResultNote'),
            toolResultNote: { $exists: true, $ne: null, $nin: [''] },
          },
        },
        { $group: { _id: '$toolResultNote', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.orderModel.aggregate<OptionRow>([
        {
          $match: {
            ...buildFacetMatch('userSku'),
            userSku: { $exists: true, $ne: null, $nin: [''] },
          },
        },
        { $group: { _id: '$userSku', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        // Giới hạn để payload không phình khi có quá nhiều khách.
        { $limit: 300 },
      ]),
    ]);

    // Resolve machineTypeId → name via the machineTypes collection.
    const machineIds = machineRows.map((r) => r._id);
    const machineDocs = machineIds.length
      ? await (
          this.orderModel.db.collection('machineTypes') as unknown as {
            find: (q: Record<string, unknown>) => {
              toArray: () => Promise<Array<{ _id: unknown; name: string; shortName?: string }>>;
            };
          }
        )
          .find({ _id: { $in: machineIds } })
          .toArray()
      : [];
    const machineNameMap = new Map<string, string>();
    for (const m of machineDocs) {
      machineNameMap.set(String(m._id), m.shortName ? `${m.shortName} · ${m.name}` : m.name);
    }

    // Resolve fabric/tool codes → human-readable names.
    const fabricNameMap = new Map<string, string>(
      (
        await this.workshopConfigRepository.findAll({
          category: WorkshopConfigCategory.FabricType,
        })
      ).map((d) => [d.code, d.name]),
    );
    const toolNameMap = new Map<string, string>(
      (
        await this.workshopConfigRepository.findAll({
          category: WorkshopConfigCategory.ToolResult,
        })
      ).map((d) => [d.code, d.name]),
    );
    // Resolve machineNumber workshop_config codes → human-readable numbers.
    const actualMachineNameMap = new Map<string, string>(
      (
        await this.workshopConfigRepository.findAll({
          category: WorkshopConfigCategory.Machine,
        })
      ).map((d) => [d.code, d.name]),
    );
    // Resolve toolResultNote codes → human-readable ("ok" → "OK", ...).
    const toolNoteNameMap = new Map<string, string>(
      (
        await this.workshopConfigRepository.findAll({
          category: WorkshopConfigCategory.ToolResultNote,
        })
      ).map((d) => [d.code, d.name]),
    );

    return {
      success: true,
      data: {
        factories: Array.from(cellMap.values()).sort((a, b) => b.total - a.total),
        // Thẻ `factories` ở trên chỉ có xưởng ĐANG giữ đơn — select "Chuyển
        // xưởng" phải dùng danh sách đầy đủ này, nếu không thì không chuyển
        // được sang xưởng chưa có đơn nào.
        factoryOptions: await this.listFactoryOptions(),
        flows,
        totals: { total: grandTotal, transferred, pure },
        availableFilters: {
          products: typeRows.map((r) => ({ value: r._id, label: r._id, count: r.count })),
          fabrics: fabricRows.map((r) => ({
            value: r._id,
            label: fabricNameMap.get(r._id) || r._id,
            count: r.count,
          })),
          toolResults: toolRows.map((r) => ({
            value: r._id,
            label: toolNameMap.get(r._id) || r._id,
            count: r.count,
          })),
          machineTypes: machineRows.map((r) => ({
            value: r._id,
            label: machineNameMap.get(r._id) || r._id,
            count: r.count,
          })),
          machines: actualMachineRows.map((r) => ({
            value: r._id,
            label: actualMachineNameMap.get(r._id) || r._id,
            count: r.count,
          })),
          toolResultNotes: toolNoteRows.map((r) => ({
            value: r._id,
            label: toolNoteNameMap.get(r._id) || r._id,
            count: r.count,
          })),
          users: userRows.map((r) => ({ value: r._id, label: r._id, count: r.count })),
        },
      },
    };
  }

  /**
   * Aggregate workshop facet counts using cross-facet pattern: for each facet
   * (printStatus / toolResultNote / assignee / productionError / fabricType /
   * machineNumber / toolResult / errorFile) aggregate over `buildOrderListFilter`
   * minus the facet's own CSV filter, so user thấy được tất cả options của
   * facet đó nhưng count đã narrow theo các facet khác đang active.
   */
  async getWorkshopAvailableFilters(
    dto: GetProductionOrdersDto,
    roleName?: RoleType,
    assigneeCode?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<{
    success: true;
    data: {
      printStatus: Array<{ value: string; label: string; count: number }>;
      toolResultNote: Array<{ value: string; label: string; count: number }>;
      assignee: Array<{ value: string; label: string; count: number }>;
      productionError: Array<{ value: string; label: string; count: number }>;
      fabricType: Array<{ value: string; label: string; count: number }>;
      machineNumber: Array<{ value: string; label: string; count: number }>;
      toolResult: Array<{ value: string; label: string; count: number }>;
      errorFile: Array<{ value: string; label: string; count: number }>;
      designerStatus: Array<{ value: string; label: string; count: number }>;
      type: Array<{ value: string; label: string; count: number }>;
      userSku: Array<{ value: string; label: string; count: number }>;
      heldCount: number;
      cancelledCount: number;
      stageCounts: Record<string, number>;
      factoryCounts: Array<{ factoryId: string; shortName?: string; name?: string; count: number }>;
      pillCounts: { errorFile: number; noTool: number; unreviewed: number; priority: number; designBacklog: number };
      typeStats: Array<{ type: string; orders: number; qty: number; stages: Record<string, number> }>;
      totalOrders: number;
      totalTypes: number;
    };
  }> {
    type FacetKey =
      | 'printStatus'
      | 'toolResultNote'
      | 'assignee'
      | 'productionError'
      | 'fabricType'
      | 'machineNumber'
      | 'toolResult'
      | 'errorFile'
      | 'designerStatus'
      | 'type'
      | 'userSku';

    const FACET_KEYS: FacetKey[] = [
      'printStatus',
      'toolResultNote',
      'assignee',
      'productionError',
      'fabricType',
      'machineNumber',
      'toolResult',
      'errorFile',
      'designerStatus',
      'type',
      'userSku',
    ];

    type OptionRow = { _id: string; count: number };
    // Field array (errorFile) cần $unwind trước $group để mỗi code thành 1 row
    // (đếm theo số đơn có code đó trong array, không phải đếm chuỗi).
    const ARRAY_FACET_FIELDS = new Set<FacetKey>(['errorFile']);
    // Resolve 1 lần: cần cho (a) facet khác khi dto.designerStatus dùng token tách
    // tool, (b) tính 2 count "Chưa gán · có/không tool".
    const toolHasCodes = await this.resolveToolHasCodes();
    // Đơn đã hủy KHÔNG tham gia bất kỳ facet count nào (theo yêu cầu) — trừ khi
    // user bật toggle "Đã hủy" (dto.cancelled=true) để xem riêng phân bố đơn hủy.
    const excludeCancelled: Record<string, unknown> = dto.cancelled === true ? {} : { cancelledAt: { $exists: false } };
    const aggregateFacet = async (excludeKey: FacetKey, field: FacetKey) => {
      const sanitizedDto = { ...dto, [excludeKey]: undefined } as GetProductionOrdersDto;
      const baseFilter = this.buildOrderListFilter(
        sanitizedDto,
        roleName,
        assigneeCode,
        fulfillmentFactoryId,
        fulfillmentStage,
        toolHasCodes,
      );
      // Facet narrow theo trạng thái stage đang chọn (bảng phẳng trang "In").
      if (dto.fulfillmentStatus) {
        this.applyFulfillmentStatusFilter(baseFilter, dto.fulfillmentStatus, fulfillmentStage, assigneeCode);
      }
      const facetMatch = {
        ...baseFilter,
        ...excludeCancelled,
        [field]: { $exists: true, $ne: null, $nin: [''] },
      };
      const pipeline: PipelineStage[] = [{ $match: facetMatch }];
      if (ARRAY_FACET_FIELDS.has(field)) {
        pipeline.push({ $unwind: { path: `$${field}`, preserveNullAndEmptyArrays: false } });
      }
      pipeline.push({ $group: { _id: `$${field}`, count: { $sum: 1 } } });
      pipeline.push({ $sort: { count: -1 } });
      return this.orderModel.aggregate<OptionRow>(pipeline);
    };

    const [
      printStatusRows,
      toolResultNoteRows,
      assigneeRows,
      productionErrorRows,
      fabricTypeRows,
      machineNumberRows,
      toolResultRows,
      errorFileRows,
      designerStatusRows,
      typeRows,
      userSkuRows,
    ] = await Promise.all(FACET_KEYS.map((k) => aggregateFacet(k, k)));

    // Count "Chưa soát" cho toolResultNote: đơn chưa được gán bất kỳ trạng thái
    // soát nào (field missing / null / empty string). Áp baseFilter đã strip
    // toolResultNote filter (cùng pattern faceted với aggregateFacet).
    const toolResultNoteNoneCount = await (async () => {
      const sanitizedDto = { ...dto, toolResultNote: undefined } as GetProductionOrdersDto;
      const baseFilter = this.buildOrderListFilter(sanitizedDto, roleName, assigneeCode);
      const noneClauses = [{ toolResultNote: { $exists: false } }, { toolResultNote: null }, { toolResultNote: '' }];
      let noneMatch: Record<string, unknown>;
      if (Array.isArray(baseFilter.$or)) {
        // Đã có $or từ filter khác — chuyển sang $and để giữ semantics AND.
        const { $or: existingOr, ...rest } = baseFilter as Record<string, unknown> & {
          $or: unknown[];
        };
        noneMatch = { ...rest, ...excludeCancelled, $and: [{ $or: existingOr }, { $or: noneClauses }] };
      } else {
        noneMatch = { ...baseFilter, ...excludeCancelled, $or: noneClauses };
      }
      return this.orderModel.countDocuments(noneMatch);
    })();

    // Count "Chưa xác định" cho toolResult: đơn chưa soát tool (field missing /
    // null / empty string) — mirror toolResultNoteNoneCount ở trên.
    const toolResultNoneCount = await (async () => {
      const sanitizedDto = { ...dto, toolResult: undefined } as GetProductionOrdersDto;
      const baseFilter = this.buildOrderListFilter(sanitizedDto, roleName, assigneeCode);
      const noneClauses = [{ toolResult: { $exists: false } }, { toolResult: null }, { toolResult: '' }];
      let noneMatch: Record<string, unknown>;
      if (Array.isArray(baseFilter.$or)) {
        const { $or: existingOr, ...rest } = baseFilter as Record<string, unknown> & {
          $or: unknown[];
        };
        noneMatch = { ...rest, ...excludeCancelled, $and: [{ $or: existingOr }, { $or: noneClauses }] };
      } else {
        noneMatch = { ...baseFilter, ...excludeCancelled, $or: noneClauses };
      }
      return this.orderModel.countDocuments(noneMatch);
    })();

    // Count "chưa xác định loại sản phẩm" cho facet type — mirror 2 khối trên.
    // Cần vì aggregateFacet loại thẳng giá trị rỗng ($nin ['']) nên đơn thiếu
    // `type` không bao giờ sinh ra option, trong khi Workshop gom nhóm bằng
    // $ifNull nên VẪN hiện nhóm "đơn không tên" → 2 trang lệch (ORD-1 AC-05/AC-08).
    const typeNoneCount = await (async () => {
      const sanitizedDto = { ...dto, type: undefined } as GetProductionOrdersDto;
      const baseFilter = this.buildOrderListFilter(sanitizedDto, roleName, assigneeCode);
      const noneClauses = [{ type: { $exists: false } }, { type: null }, { type: '' }];
      let noneMatch: Record<string, unknown>;
      if (Array.isArray(baseFilter.$or)) {
        const { $or: existingOr, ...rest } = baseFilter as Record<string, unknown> & {
          $or: unknown[];
        };
        noneMatch = { ...rest, ...excludeCancelled, $and: [{ $or: existingOr }, { $or: noneClauses }] };
      } else {
        noneMatch = { ...baseFilter, ...excludeCancelled, $or: noneClauses };
      }
      return this.orderModel.countDocuments(noneMatch);
    })();

    const nameMap = async (category: WorkshopConfigCategory) =>
      new Map<string, string>((await this.workshopConfigRepository.findAll({ category })).map((d) => [d.code, d.name]));
    const [
      printStatusMap,
      toolResultNoteMap,
      productionErrorMap,
      fabricTypeMap,
      machineNumberMap,
      toolResultMap,
      errorFileMap,
    ] = await Promise.all([
      nameMap(WorkshopConfigCategory.PrintStatus),
      nameMap(WorkshopConfigCategory.ToolResultNote),
      nameMap(WorkshopConfigCategory.ProductionError),
      nameMap(WorkshopConfigCategory.FabricType),
      nameMap(WorkshopConfigCategory.Machine),
      nameMap(WorkshopConfigCategory.ToolResult),
      nameMap(WorkshopConfigCategory.ErrorFileType),
    ]);

    // Resolve assignee userId → fullName cho label friendly (chỉ những userId
    // có trong facet rows). Userid không tìm thấy → fallback last 4 chars.
    const assigneeUserIds = assigneeRows.map((r) => r._id).filter(Boolean);
    const assigneeUsers = assigneeUserIds.length
      ? await this.userModel.find({ _id: { $in: assigneeUserIds } }, { _id: 1, fullName: 1 }).lean()
      : [];
    const assigneeMap = new Map<string, string>(assigneeUsers.map((u) => [String(u._id), u.fullName]));

    // Designer status — i18n labels VN.
    const DESIGNER_STATUS_LABELS: Record<string, string> = {
      unassigned: 'Chưa gán',
      assigned: 'Cần làm',
      'in-progress': 'Đang làm',
      done: 'Đã xong',
      rejected: 'Không làm được',
      rework: 'Cần làm lại',
    };

    const toOption = (m: Map<string, string>) => (r: OptionRow) => ({
      value: r._id,
      label: m.get(r._id) || r._id,
      count: r.count,
    });

    // 2 count tách "Chưa gán" theo tool (thay option `unassigned` đơn trong dropdown
    // TT Designer). Population = designerStatus unassigned/missing & toolResultNote≠'ok'
    // (KHỚP KPI panel "Chưa gán"), chia theo toolResult "Có tool" (name ^Có).
    // "Không tool" = phần còn lại, GỒM cả đơn chưa soát toolResult. Strip
    // designerStatus khỏi filter (cross-narrow như facet designerStatus).
    const unassignedSplit = await (async () => {
      const sanitizedDto = { ...dto, designerStatus: undefined } as GetProductionOrdersDto;
      const base = this.buildOrderListFilter(
        sanitizedDto,
        roleName,
        assigneeCode,
        fulfillmentFactoryId,
        fulfillmentStage,
        toolHasCodes,
      );
      if (dto.fulfillmentStatus) {
        this.applyFulfillmentStatusFilter(base, dto.fulfillmentStatus, fulfillmentStage, assigneeCode);
      }
      const match = {
        ...base,
        ...excludeCancelled,
        $and: [
          ...(Array.isArray(base.$and) ? (base.$and as Record<string, unknown>[]) : []),
          { $or: [{ designerStatus: 'unassigned' }, { designerStatus: { $exists: false } }] },
          { toolResultNote: { $ne: 'ok' } },
        ],
      };
      const agg = await this.orderModel.aggregate<{ withTool: number; total: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            withTool: { $sum: { $cond: [{ $in: ['$toolResult', toolHasCodes] }, 1, 0] } },
            total: { $sum: 1 },
          },
        },
      ]);
      const withTool = agg[0]?.withTool ?? 0;
      const total = agg[0]?.total ?? 0;
      return { withTool, noTool: total - withTool };
    })();

    // Count đơn đang GIỮ trong scope filter hiện tại (strip `held` để đếm tổng
    // đơn giữ bất kể toggle đang bật/tắt) → hiện trên nút toggle "Đang giữ".
    const heldCount = await (async () => {
      const base = this.buildOrderListFilter(
        { ...dto, held: undefined } as GetProductionOrdersDto,
        roleName,
        assigneeCode,
        fulfillmentFactoryId,
        fulfillmentStage,
        toolHasCodes,
      );
      if (dto.fulfillmentStatus) {
        this.applyFulfillmentStatusFilter(base, dto.fulfillmentStatus, fulfillmentStage, assigneeCode);
      }
      return this.orderModel.countDocuments({
        ...base,
        ...excludeCancelled,
        heldAt: { $exists: true },
      });
    })();

    // Count đơn ĐÃ HỦY trong scope filter hiện tại (strip `cancelled` toggle để
    // đếm tổng bất kể toggle bật/tắt) → hiện trên nút toggle "Đã hủy".
    const cancelledCount = await (async () => {
      const base = this.buildOrderListFilter(
        { ...dto, cancelled: undefined } as GetProductionOrdersDto,
        roleName,
        assigneeCode,
        fulfillmentFactoryId,
        fulfillmentStage,
        toolHasCodes,
      );
      if (dto.fulfillmentStatus) {
        this.applyFulfillmentStatusFilter(base, dto.fulfillmentStatus, fulfillmentStage, assigneeCode);
      }
      return this.orderModel.countDocuments({ ...base, cancelledAt: { $exists: true } });
    })();

    // ── Phễu chặng + nút xưởng + pill trạng thái (trang Đơn hàng theo xưởng, Orders.md §10.2b) ──
    // Cùng khuôn cross-facet: mỗi số bỏ qua CHÍNH filter mà ô/pill đó bật, giữ mọi filter khác.
    const baseWithout = (strip: Partial<GetProductionOrdersDto>): Record<string, unknown> => {
      const base = this.buildOrderListFilter(
        { ...dto, ...strip } as GetProductionOrdersDto,
        roleName,
        assigneeCode,
        fulfillmentFactoryId,
        fulfillmentStage,
        toolHasCodes,
      );
      if (dto.fulfillmentStatus) {
        this.applyFulfillmentStatusFilter(base, dto.fulfillmentStatus, fulfillmentStage, assigneeCode);
      }
      return { ...base, ...excludeCancelled };
    };
    const countWith = (strip: Partial<GetProductionOrdersDto>, extra: Record<string, unknown>) => {
      const base = baseWithout(strip);
      const and = [...(Array.isArray(base.$and) ? (base.$and as Record<string, unknown>[]) : []), extra];
      return this.orderModel.countDocuments({ ...base, $and: and });
    };
    const [stageRows, factoryRows, totalRows, pillErrorFile, pillNoTool, pillPriority, pillDesignBacklog, typeRowsStat] =
      await Promise.all([
        this.orderModel.aggregate<{ _id: string; count: number }>([
          { $match: baseWithout({ workshopStage: undefined }) },
          { $group: { _id: this.workshopStageExpr(), count: { $sum: 1 } } },
        ]),
        this.orderModel.aggregate<{ _id: string; count: number }>([
          // Đưa điều kiện "có xưởng" vào $and — KHÔNG spread đè `factoryId` của base
          // (base chứa mệnh đề loại xưởng US ngoài luồng, đè lên là US lọt vào nút xưởng).
          {
            $match: (() => {
              const b = baseWithout({ factoryId: undefined });
              const and = Array.isArray(b.$and) ? (b.$and as Record<string, unknown>[]) : [];
              return { ...b, $and: [...and, { factoryId: { $exists: true, $ne: null } }] };
            })(),
          },
          { $group: { _id: '$factoryId', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        this.orderModel.aggregate<{ _id: null; orders: number; types: number }>([
          { $match: baseWithout({}) },
          { $group: { _id: { $ifNull: ['$type', ''] }, n: { $sum: 1 } } },
          { $group: { _id: null, orders: { $sum: '$n' }, types: { $sum: 1 } } },
        ]),
        countWith({ errorFile: undefined }, { 'errorFile.0': { $exists: true } }),
        // "Thiếu tool" = đã soát toolResult và KHÔNG thuộc nhóm "Có tool" (mirror `useIsNoTool` FE).
        countWith({ toolResult: undefined }, { toolResult: { $nin: [null, '', ...toolHasCodes] } }),
        countWith({ priority: undefined }, { priority: { $exists: true, $nin: [null, 0] } }),
        countWith(
          { designerStatus: undefined },
          { designerStatus: { $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework] } },
        ),
        // Rail loại sản phẩm (bản 3): đơn + số lượng + chặng theo từng loại, bỏ qua chính filter `type`.
        this.orderModel.aggregate<{ _id: string; orders: number; qty: number; stages: Record<string, number> }>([
          { $match: baseWithout({ type: undefined }) },
          {
            $group: {
              _id: { type: { $ifNull: ['$type', ''] }, stage: this.workshopStageExpr() },
              n: { $sum: 1 },
              qty: { $sum: { $ifNull: ['$quantity', 1] } },
            },
          },
          {
            $group: {
              _id: '$_id.type',
              orders: { $sum: '$n' },
              qty: { $sum: '$qty' },
              stages: { $push: { k: '$_id.stage', v: '$n' } },
            },
          },
          { $addFields: { stages: { $arrayToObject: '$stages' } } },
          { $sort: { orders: -1, _id: 1 } },
        ]),
      ]);
    const factoryIds = factoryRows.map((r) => String(r._id));
    const factoryDocs = factoryIds.length
      ? await this.factoryRepository.findAll({ _id: { $in: factoryIds } } as Record<string, unknown>)
      : [];
    const factoryById = new Map(
      (factoryDocs as Array<{ _id: unknown; name?: string; shortName?: string }>).map((f) => [String(f._id), f]),
    );
    const stageCounts = Object.fromEntries(stageRows.map((r) => [r._id, r.count]));
    const factoryCounts = factoryRows.map((r) => ({
      factoryId: String(r._id),
      shortName: factoryById.get(String(r._id))?.shortName,
      name: factoryById.get(String(r._id))?.name,
      count: r.count,
    }));
    const typeStats = typeRowsStat.map((r) => ({ type: r._id, orders: r.orders, qty: r.qty, stages: r.stages }));
    const pillCounts = {
      errorFile: pillErrorFile,
      noTool: pillNoTool,
      unreviewed: toolResultNoneCount,
      priority: pillPriority,
      designBacklog: pillDesignBacklog,
    };

    return {
      success: true,
      data: {
        heldCount,
        cancelledCount,
        stageCounts,
        factoryCounts,
        pillCounts,
        typeStats,
        totalOrders: totalRows[0]?.orders ?? 0,
        totalTypes: totalRows[0]?.types ?? 0,
        printStatus: printStatusRows.map(toOption(printStatusMap)),
        toolResultNote: [
          // Prepend "Chưa soát" option. Token __none__ — FE injects nothing nữa.
          // Skip nếu count=0 để facet không lủng lẳng option rỗng.
          ...(toolResultNoteNoneCount > 0
            ? [{ value: '__none__', label: 'Chưa soát', count: toolResultNoteNoneCount }]
            : []),
          ...toolResultNoteRows.map(toOption(toolResultNoteMap)),
        ],
        assignee: assigneeRows.map((r) => ({
          value: r._id,
          label: assigneeMap.get(r._id) || `#${String(r._id).slice(-4)}`,
          count: r.count,
        })),
        productionError: productionErrorRows.map(toOption(productionErrorMap)),
        fabricType: fabricTypeRows.map(toOption(fabricTypeMap)),
        machineNumber: machineNumberRows.map(toOption(machineNumberMap)),
        toolResult: [
          // Prepend "Chưa xác định" option — mirror toolResultNote. Skip nếu
          // count=0 để facet không lủng lẳng option rỗng.
          ...(toolResultNoneCount > 0
            ? [{ value: '__none__', label: 'Chưa xác định', count: toolResultNoneCount }]
            : []),
          ...toolResultRows.map(toOption(toolResultMap)),
        ],
        errorFile: errorFileRows.map(toOption(errorFileMap)),
        // Option `unassigned` đơn được THAY bằng 2 option tách tool (N+M = KPI
        // "Chưa gán"). Nếu cả 2 = 0 (mọi đơn chưa gán đều 'ok') → không hiện.
        designerStatus: designerStatusRows.flatMap((r) => {
          if (r._id === 'unassigned') {
            return [
              ...(unassignedSplit.noTool > 0
                ? [
                    {
                      value: '__unassigned_notool__',
                      label: 'Chưa gán · không tool',
                      count: unassignedSplit.noTool,
                    },
                  ]
                : []),
              ...(unassignedSplit.withTool > 0
                ? [
                    {
                      value: '__unassigned_tool__',
                      label: 'Chưa gán · có tool',
                      count: unassignedSplit.withTool,
                    },
                  ]
                : []),
            ];
          }
          return [{ value: r._id, label: DESIGNER_STATUS_LABELS[r._id] || r._id, count: r.count }];
        }),
        // Tên sản phẩm + SKU khách — label = chính value (không có name map).
        type: [
          ...typeRows.map((r) => ({ value: r._id, label: r._id, count: r.count })),
          // Option "chưa xác định" đặt CUỐI (khác toolResult/toolResultNote đặt
          // đầu): danh sách này sắp theo count giảm dần và là tên sản phẩm thật,
          // nhét token vào đầu sẽ đẩy sản phẩm nhiều đơn nhất xuống dòng 2.
          // Bỏ hẳn khi count=0 để facet không lủng lẳng option rỗng.
          // `label` để rỗng — FE tự đặt nhãn (`orders:tableWorkshop.noTypeName`),
          // vì mọi label khác của facet này là tên sản phẩm nguyên văn từ DB.
          ...(typeNoneCount > 0 ? [{ value: TYPE_NONE_TOKEN, label: '', count: typeNoneCount }] : []),
        ],
        userSku: userSkuRows.map((r) => ({ value: r._id, label: r._id, count: r.count })),
      },
    };
  }

  /**
   * Re-derive `fabricType`, `toolResult`, AND `machineNumber` from product
   * config for orders that don't have these set yet. Non-destructive: existing
   * values are kept, we only fill blanks.
   *
   * Called manually from `/products` after admin edits fabric/tool/machine
   * defaults, to backfill the rows already in the DB without forcing a
   * re-import. Particularly important for `machineNumber` since it was added
   * after the initial release — every legacy order needs to be filled.
   */
  async backfillOrderFabric(): Promise<{ scanned: number; updated: number }> {
    type Row = { _id: unknown; setFabric?: string; setTool?: string; setMachineNumber?: string };
    const rows = await this.orderModel.aggregate<Row>([
      {
        $match: {
          productConfigId: { $exists: true, $ne: null },
          $or: [
            { fabricType: { $exists: false } },
            { fabricType: null },
            { fabricType: '' },
            { toolResult: { $exists: false } },
            { toolResult: null },
            { toolResult: '' },
            { machineNumber: { $exists: false } },
            { machineNumber: null },
            { machineNumber: '' },
          ],
        },
      },
      {
        $lookup: {
          from: 'productConfigs',
          localField: 'productConfigId',
          foreignField: '_id',
          as: 'pc',
        },
      },
      { $unwind: '$pc' },
      {
        $project: {
          _id: 1,
          // Only emit if the order field is blank AND product has a value.
          setFabric: {
            $cond: [
              {
                $and: [
                  {
                    $or: [
                      { $eq: ['$fabricType', null] },
                      { $eq: ['$fabricType', ''] },
                      { $eq: [{ $type: '$fabricType' }, 'missing'] },
                    ],
                  },
                  { $ne: [{ $ifNull: ['$pc.fabricType', ''] }, ''] },
                ],
              },
              '$pc.fabricType',
              null,
            ],
          },
          setTool: {
            $cond: [
              {
                $and: [
                  {
                    $or: [
                      { $eq: ['$toolResult', null] },
                      { $eq: ['$toolResult', ''] },
                      { $eq: [{ $type: '$toolResult' }, 'missing'] },
                    ],
                  },
                  { $ne: [{ $ifNull: ['$pc.toolResult', ''] }, ''] },
                ],
              },
              '$pc.toolResult',
              null,
            ],
          },
          setMachineNumber: {
            $cond: [
              {
                $and: [
                  {
                    $or: [
                      { $eq: ['$machineNumber', null] },
                      { $eq: ['$machineNumber', ''] },
                      { $eq: [{ $type: '$machineNumber' }, 'missing'] },
                    ],
                  },
                  { $ne: [{ $ifNull: ['$pc.machineNumber', ''] }, ''] },
                ],
              },
              '$pc.machineNumber',
              null,
            ],
          },
        },
      },
      {
        $match: {
          $or: [{ setFabric: { $ne: null } }, { setTool: { $ne: null } }, { setMachineNumber: { $ne: null } }],
        },
      },
    ]);

    let updated = 0;
    for (const r of rows) {
      const patch: Record<string, unknown> = {};
      if (r.setFabric) patch.fabricType = r.setFabric;
      if (r.setTool) patch.toolResult = r.setTool;
      if (r.setMachineNumber) patch.machineNumber = r.setMachineNumber;
      if (Object.keys(patch).length === 0) continue;
      await this.orderModel.updateOne({ _id: r._id }, { $set: patch });
      updated++;
    }
    void this.invalidateListCache();
    return { scanned: rows.length, updated };
  }

  async deleteOrder(id: string, ctx?: AuditContext) {
    const o = await this.orderRepository.findOne({ _id: id });
    if (!o) throw new NotFoundException('Order not found');
    const result = await this.orderRepository.softDelete({ _id: id });
    void this.orderLogService.write({ orderId: id, action: 'delete', ctx });
    void this.invalidateListCache();
    return result;
  }

  // ─── Cancel + Đổi design (Admin only) ─────────────────────────────
  // Enforce backend: chỉ SuperAdmin/Admin (KHÔNG gồm Manager). Controller đã
  // `@Auth([SuperAdmin, Admin])` nhưng vẫn check lại trong service cho chắc.

  private assertOrderAdmin(roleName?: RoleType): void {
    if (roleName !== RoleType.SuperAdmin && roleName !== RoleType.Admin) {
      throw new ForbiddenException('Chỉ Admin được thực hiện thao tác này.');
    }
  }

  /**
   * Đơn có được HỦY không. Admin được hủy đơn ở **BẤT KỲ trạng thái nào** (theo
   * yêu cầu vận hành: đơn có thể bị hủy dù đã in/ép/may…) — chỉ chặn đơn ĐÃ hủy
   * sẵn (không hủy 2 lần). Cancel là action Admin-only (`assertOrderAdmin`).
   * Mirror ở FE `apps/web/src/utils/orderActions.ts` — sửa 1 nơi phải sửa cả 2.
   */
  private canCancelOrder(order: {
    cancelledAt?: Date | null;
    designerStatus?: string;
    currentFulfillmentStage?: string | null;
    fulfillmentStages?: Record<string, { status?: string } | undefined>;
  }): { ok: boolean; reason?: string } {
    if (order.cancelledAt) return { ok: false, reason: 'Đơn đã hủy.' };
    return { ok: true };
  }

  async cancelOrder(id: string, dto: CancelOrderDto, roleName?: RoleType, ctx?: AuditContext): Promise<OrderDocument> {
    this.assertOrderAdmin(roleName);
    const order = await this.orderModel.findById(id).lean();
    if (!order) throw new NotFoundException('Order not found');
    const check = this.canCancelOrder(order as unknown as Parameters<OrderService['canCancelOrder']>[0]);
    if (!check.ok) throw new BadRequestException(check.reason);

    const now = new Date();
    const updated = await this.orderModel.findByIdAndUpdate(
      id,
      { $set: { cancelledAt: now, cancelReason: dto.reason } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Order not found');
    void this.orderLogService.write({
      orderId: id,
      action: 'cancel',
      field: 'cancelledAt',
      before: null,
      after: dto.reason,
      ctx,
    });
    this.emitCustomerOrderEvent('order.cancelled', [updated], { extra: { cancelReason: dto.reason ?? '' } });
    void this.invalidateListCache();
    return updated;
  }

  // ─── Giữ đơn (hold / unhold) — ORDER_WRITE_ROLES ──────────────────
  /**
   * Guard dùng chung: chặn MỌI thao tác lên đơn đang bị giữ (heldAt set). Gọi ở
   * đầu updateField / setProductionError / transition designer + fulfillment.
   * Đơn giữ = tạm dừng — phải mở lại (unhold) trước khi thao tác tiếp.
   */
  private assertNotHeld(order: { heldAt?: Date | null }): void {
    if (order?.heldAt) {
      throw new BadRequestException('Đơn đang bị giữ — mở lại (bỏ giữ) trước khi thao tác tiếp.');
    }
  }

  /**
   * Guard dùng chung: chặn sửa đơn ĐÃ HỦY. Hủy là trạng thái CUỐI — đơn đã ra
   * khỏi mọi công đoạn (xem `CancelledOrders-ExcludeFromStages`). Không chặn ở
   * `updateField` thì 1 lần bấm ô "Note kq Tool" = 'ok' sẽ chạy hook entry và
   * ĐẨY ĐƠN ĐÃ HỦY VÀO SẢN XUẤT lại (readyForFulfill + stage In waiting).
   */
  private assertNotCancelled(order: { cancelledAt?: Date | null }): void {
    if (order?.cancelledAt) {
      throw new BadRequestException('Đơn đã hủy — không thao tác được.');
    }
  }

  /** Set heldAt + holdReason cho 1 đơn. Chặn giữ 2 lần. */
  async holdOrder(id: string, dto: HoldOrderDto, _roleName?: RoleType, ctx?: AuditContext): Promise<HoldOrderResDto> {
    const before = await this.orderModel.findById(id).lean();
    if (!before) throw new NotFoundException('Order not found');
    if ((before as unknown as { heldAt?: Date | null }).heldAt) {
      throw new BadRequestException('Đơn đang được giữ rồi.');
    }
    if ((before as unknown as { cancelledAt?: Date | null }).cancelledAt) {
      throw new BadRequestException('Đơn đã hủy — không thể giữ.');
    }
    // `holdSource='manual'` — đồng bộ OnosPod (§9d) KHÔNG bao giờ tự nhả đơn nhân viên giữ.
    const set: Record<string, unknown> = {
      heldAt: new Date(),
      holdReason: dto.reason ?? '',
      holdSource: HoldSource.Manual,
    };
    // Giữ đơn vì CHỜ KHÁCH SỬA DESIGN → design cũ coi như không còn giá trị,
    // reset `toolResult` (Kết quả Tool — field quyết định hàng đợi "chưa soát"
    // của `getNextDesignReviewOrder`) + `toolResultNote` (Note kq Tool — field
    // các luồng soát tool nội bộ khác đọc để biết đã soát hay chưa) về rỗng để
    // đơn tự vào lại hàng đợi soát tool ngay khi mở giữ, thay vì giữ nguyên
    // kết quả/note soát trên design cũ. KHÔNG đụng `toolCheckErrorNotes`
    // (lịch sử bền vững, không phải trạng thái hiện tại). Đồng thời HỦY GÁN
    // DESIGNER hiện tại (`assignee`/`designerStatus` về `unassigned`) — design
    // cũ đang làm/đã làm không còn giá trị, đơn cần được gán lại từ đầu khi mở
    // giữ (qua auto-assign hoặc leader gán tay), thay vì giữ nguyên người cũ.
    if (dto.reason === HOLD_REASON_WAITING_DESIGN) {
      set.toolResult = '';
      set.toolResultNote = '';
      set.assignee = null;
      set.designerStatus = DesignerStatus.Unassigned;
      set.designerAssignedAt = null;
      set.designerStartedAt = null;
      set.designerCompletedAt = null;
      set.designerRejectedAt = null;
      set.designerRejectedReason = null;
    }
    const updated = await this.orderModel.findByIdAndUpdate(id, { $set: set }, { new: true });
    if (!updated) throw new NotFoundException('Order not found');
    void this.orderLogService.write({
      orderId: id,
      action: 'hold',
      field: 'heldAt',
      before: null,
      after: dto.reason ?? '',
      ctx,
    });
    this.emitCustomerOrderEvent('order.held', [updated], {
      extra: { holdReason: dto.reason ?? '' },
      holdReason: dto.reason ?? '',
    });
    void this.invalidateListCache();
    return { success: true, data: updated } as unknown as HoldOrderResDto;
  }

  /** Clear heldAt + holdReason (mở lại đơn). */
  async unholdOrder(id: string, _roleName?: RoleType, ctx?: AuditContext): Promise<HoldOrderResDto> {
    const before = await this.orderModel.findById(id).lean();
    if (!before) throw new NotFoundException('Order not found');
    if (!(before as unknown as { heldAt?: Date | null }).heldAt) {
      throw new BadRequestException('Đơn không ở trạng thái giữ.');
    }
    // OnosPod vẫn đang giữ đơn này (có cờ) mà nhân viên mở giữ → ghi mốc bỏ qua
    // đợt đó, để đồng bộ KHÔNG giữ lại cho tới khi OnosPod có đợt giữ mới (§9d).
    const flagAt = (before as unknown as { onospodHold?: { onHoldAt?: Date | null } | null }).onospodHold?.onHoldAt;
    const updated = await this.orderModel.findByIdAndUpdate(
      id,
      {
        $unset: { heldAt: 1, holdReason: 1, holdSource: 1 },
        ...(flagAt ? { $set: { onospodHoldDismissedAt: flagAt } } : {}),
      },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Order not found');
    void this.orderLogService.write({
      orderId: id,
      action: 'unhold',
      field: 'heldAt',
      before: (before as unknown as { holdReason?: string }).holdReason ?? '',
      after: null,
      ctx,
    });
    // Đơn giữ THEO OnosPod: khách chưa từng được báo giữ → mở giữ cũng không báo (§9d.5).
    if (shouldNotifyCustomerOnManualUnhold(before as unknown as { heldAt?: Date | null; holdSource?: string | null })) {
      this.emitCustomerOrderEvent('order.unheld', [updated]);
    }
    void this.invalidateListCache();
    return { success: true, data: updated } as unknown as HoldOrderResDto;
  }

  // ─── Chuyển hoàn thành (SuperAdmin) — Orders.md §23 ────────────────
  /**
   * Ép 1 đơn về trạng thái **đã hoàn thành sản xuất**, và điền mốc thời gian
   * cho các khâu chưa xong bằng cách CHIA ĐỀU khoảng
   * `[đơn vào sản xuất → lúc bấm]` theo đúng luồng của xưởng đang giữ đơn
   * (`planForceComplete`).
   *
   * Đây là cửa sửa dữ liệu, không phải một bước của quy trình: dùng cho đơn đã
   * xong ngoài đời nhưng xưởng quên bấm, để nó thôi treo trên Dashboard /
   * Lifecycle / banner quá hạn. Vì vậy nó ghi thẳng vào đơn thay vì đi qua
   * `FulfillmentTaskService.transition()` — transition đòi đúng người giữ công
   * đoạn, đúng thứ tự `waiting → in-progress → done`, tức phải giả lập hàng
   * chục lượt bấm mới đi hết 6 công đoạn.
   *
   * Đổi lại, ba thứ được giữ đúng như một đơn chảy thật:
   *  - `fulfillmentTimeline` có đủ dòng cho từng công đoạn được điền, ghi rõ
   *    ai bấm và lý do — nhìn vào lịch sử là biết đơn này được ép, không phải
   *    xưởng làm.
   *  - `workMs` KHÔNG bịa: công đoạn ép xong giữ nguyên 0, vì không có ai làm
   *    thật. Số giờ làm việc của xưởng không được phép phình lên vì một lần
   *    sửa dữ liệu.
   *  - Mốc thật đã có trên đơn không bị ghi đè (xem `planForceComplete`).
   *
   * Đơn cũng được kéo qua nốt hai chặng trước fulfillment (soát tool +
   * thiết kế) nếu còn dở: đơn "hoàn thành sản xuất" mà vẫn nằm trong hàng đợi
   * soát tool / backlog cần gán designer là trạng thái tự mâu thuẫn, và chính
   * mấy hàng đợi đó là thứ người dùng muốn dọn khi bấm nút này.
   */
  async forceCompleteOrder(id: string, roleName?: RoleType, ctx?: AuditContext): Promise<ForceCompleteOrderResDto> {
    if (roleName !== RoleType.SuperAdmin) {
      throw new ForbiddenException('Chỉ SuperAdmin được chuyển đơn sang hoàn thành.');
    }
    const order = await this.orderModel.findById(id).lean();
    if (!order) throw new NotFoundException('Order not found');

    const o = order as unknown as {
      cancelledAt?: Date | null;
      heldAt?: Date | null;
      fulfillmentCompletedAt?: Date | null;
      currentFulfillmentStage?: FulfillmentStage | null;
      factoryId?: string;
      inProductionAt?: Date;
      orderAt?: Date;
      createdAt?: Date;
      toolCheckedAt?: Date;
      toolResultNote?: string;
      designerStatus?: DesignerStatus;
      designerAssignedAt?: Date;
      designerStartedAt?: Date;
      designerFirstStartedAt?: Date;
      designerCompletedAt?: Date;
      fulfillmentStages?: Record<string, { status?: FulfillmentStageStatus; completedAt?: Date } | undefined>;
    };

    if (o.cancelledAt) throw new BadRequestException('Đơn đã hủy — không thể chuyển hoàn thành.');
    // Đơn giữ = đang tạm dừng có chủ đích; mở giữ trước rồi mới chốt hoàn thành.
    this.assertNotHeld(o);
    if (o.fulfillmentCompletedAt) throw new BadRequestException('Đơn đã hoàn thành sản xuất rồi.');

    const now = new Date();
    const plan = planForceComplete({
      now,
      inProductionAt: o.inProductionAt,
      orderAt: o.orderAt,
      createdAt: o.createdAt,
      flowType: getFactoryFlowTypeSync(this.orderModel.db, o.factoryId),
      autoPack: getFactoryAutoPackSync(this.orderModel.db, o.factoryId),
      toolCheckedAt: o.toolCheckedAt,
      toolResultNote: o.toolResultNote,
      designerStatus: o.designerStatus,
      designerCompletedAt: o.designerCompletedAt,
      fulfillmentStages: o.fulfillmentStages,
    });

    const set: Record<string, unknown> = {};
    const timeline: FulfillmentTimelineEntry[] = [];
    const byUserId = ctx?.user?._id ? String(ctx.user._id) : '';
    const byUserName = ctx?.user?.fullName;

    for (const step of plan.steps) {
      if (step.key === 'tool-check') {
        if (!o.toolCheckedAt) set.toolCheckedAt = step.to;
        // 'ok' là giá trị quy ước "soát xong, không lỗi" mà cả hệ thống đọc.
        // KHÔNG đụng `toolResult` — field đó giữ mã cấu hình xưởng, bịa vào là
        // dựng ra một mã không tồn tại trong `workshop_config`.
        if (!(o.toolResultNote ?? '').trim()) set.toolResultNote = 'ok';
        continue;
      }
      if (step.key === 'designer') {
        set.designerStatus = DesignerStatus.Done;
        set.designerAssignedAt = o.designerAssignedAt ?? step.from;
        set.designerStartedAt = o.designerStartedAt ?? step.from;
        set.designerFirstStartedAt = o.designerFirstStartedAt ?? step.from;
        set.designerCompletedAt = step.to;
        continue;
      }

      const stage = step.key as FulfillmentStage;
      const state = o.fulfillmentStages?.[stage];
      set[`fulfillmentStages.${stage}.status`] = FulfillmentStageStatus.Done;
      set[`fulfillmentStages.${stage}.waitingAt`] =
        (state as { waitingAt?: Date } | undefined)?.waitingAt ?? step.from;
      set[`fulfillmentStages.${stage}.startedAt`] =
        (state as { startedAt?: Date } | undefined)?.startedAt ?? step.from;
      set[`fulfillmentStages.${stage}.firstStartedAt`] =
        (state as { firstStartedAt?: Date } | undefined)?.firstStartedAt ?? step.from;
      set[`fulfillmentStages.${stage}.completedAt`] = step.to;
      if (!state) {
        // Công đoạn chưa từng được kích hoạt → khai đủ counter mặc định, đừng
        // để `undefined` lọt vào chỗ code khác cộng dồn.
        set[`fulfillmentStages.${stage}.reworkCount`] = 0;
        set[`fulfillmentStages.${stage}.workMs`] = 0;
      }
      timeline.push({
        stage,
        action: FulfillmentTransitionAction.Complete,
        fromStatus: state?.status ?? FulfillmentStageStatus.Waiting,
        toStatus: FulfillmentStageStatus.Done,
        byUserId,
        byUserName,
        at: step.to,
        reason: step.auto ? 'Chuyển hoàn thành (luồng rút gọn)' : 'Chuyển hoàn thành',
      });
    }

    set.currentFulfillmentStage = null;
    set.fulfillmentCompletedAt = now;

    const updated = await this.orderModel.findByIdAndUpdate(
      id,
      { $set: set, ...(timeline.length > 0 ? { $push: { fulfillmentTimeline: { $each: timeline } } } : {}) },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Order not found');

    void this.orderLogService.write({
      orderId: id,
      action: 'force_complete',
      field: 'fulfillmentCompletedAt',
      // `before` = đơn đang đứng ở đâu lúc bị ép; `after` = các khâu đã điền,
      // đủ để dựng lại chính xác thao tác này khi cần đối chiếu.
      before: o.currentFulfillmentStage ?? o.designerStatus ?? null,
      after: {
        completedAt: now,
        start: plan.start,
        steps: plan.steps.map((s) => ({ key: s.key, from: s.from, to: s.to, auto: s.auto })),
      },
      ctx,
    });
    // Cùng sự kiện với lúc xưởng bấm xong thật — webhook khách (ORD-4) + chuông
    // portal (ORD-5) không được phân biệt đơn xong thật với đơn được chốt tay.
    this.emitCustomerOrderEvent('order.production_completed', [updated]);
    void this.invalidateListCache();
    return { success: true, data: updated } as unknown as ForceCompleteOrderResDto;
  }

  /**
   * Bulk giữ / mở giữ nhiều đơn. `hold=true` chỉ set cho đơn CHƯA giữ và CHƯA
   * hủy; `hold=false` chỉ clear cho đơn ĐANG giữ. `modified` = số đơn thực đổi.
   */
  async bulkSetHold(dto: BulkHoldOrderDto, _roleName?: RoleType, ctx?: AuditContext): Promise<BulkHoldOrderResDto> {
    const baseFilter = {
      _id: { $in: dto.ids },
      deletedAt: { $exists: false },
    } as Record<string, unknown>;
    let result: { matchedCount: number; modifiedCount: number };
    // Mở giữ hàng loạt: _id các đơn ĐƯỢC báo khách, chốt từ trạng thái TRƯỚC khi
    // nhả (sau `$unset` không còn `holdSource`). Đơn giữ theo OnosPod bị loại (§9d.5).
    let unholdNotifyIds: Set<string> | null = null;
    if (dto.hold) {
      const set: Record<string, unknown> = {
        heldAt: new Date(),
        holdReason: dto.reason ?? '',
        holdSource: HoldSource.Manual,
      };
      // Cùng logic với `holdOrder()` — chờ khách sửa design → reset toolResult +
      // toolResultNote + hủy gán designer hiện tại.
      if (dto.reason === HOLD_REASON_WAITING_DESIGN) {
        set.toolResult = '';
        set.toolResultNote = '';
        set.assignee = null;
        set.designerStatus = DesignerStatus.Unassigned;
        set.designerAssignedAt = null;
        set.designerStartedAt = null;
        set.designerCompletedAt = null;
        set.designerRejectedAt = null;
        set.designerRejectedReason = null;
      }
      result = await this.orderModel.updateMany(
        { ...baseFilter, heldAt: { $exists: false }, cancelledAt: { $exists: false } },
        { $set: set },
      );
    } else {
      // Đơn OnosPod đang giữ (có cờ) → ghi mốc bỏ qua đợt đó TRƯỚC khi mở giữ,
      // để đồng bộ KHÔNG giữ lại (Orders.md §9d). Mỗi đơn mốc riêng nên không
      // gộp được vào updateMany bên dưới.
      const heldBefore = await this.orderModel
        .find({ ...baseFilter, heldAt: { $exists: true } })
        .select('heldAt holdSource onospodHold')
        .lean();
      unholdNotifyIds = new Set(heldBefore.filter((o) => shouldNotifyCustomerOnManualUnhold(o)).map((o) => String(o._id)));
      const flagged = heldBefore.filter((o) => !!o.onospodHold?.onHoldAt);
      if (flagged.length > 0) {
        await this.orderModel.bulkWrite(
          flagged.map((o) => ({
            updateOne: {
              filter: { _id: o._id, heldAt: { $exists: true } },
              update: { $set: { onospodHoldDismissedAt: o.onospodHold?.onHoldAt } },
            },
          })),
        );
      }
      result = await this.orderModel.updateMany(
        { ...baseFilter, heldAt: { $exists: true } },
        { $unset: { heldAt: 1, holdReason: 1, holdSource: 1 } },
      );
    }
    void this.orderLogService.write({
      orderId: dto.ids.join(','),
      action: dto.hold ? 'hold' : 'unhold',
      field: 'heldAt',
      before: dto.hold ? null : 'bulk',
      after: dto.hold ? dto.reason ?? '' : null,
      ctx,
    });
    // Đường BULK cũng phải bắn sự kiện như hold/unhold lẻ (ORD-5) — thiếu ở
    // đây là khách mất thông báo khi nội bộ thao tác hàng loạt. Đọc lại đúng
    // các đơn VỪA đổi (updateMany không trả document) để lấy productionId.
    if (result.modifiedCount > 0) {
      void this.orderModel
        .find({ _id: { $in: dto.ids } })
        .select('productionId userSku userEmail heldAt')
        .lean()
        .then((rows) => {
          const changed = rows.filter((r) =>
            dto.hold ? !!r.heldAt : !r.heldAt && !!unholdNotifyIds?.has(String(r._id)),
          );
          if (changed.length === 0) return;
          this.emitCustomerOrderEvent(
            dto.hold ? 'order.held' : 'order.unheld',
            changed as Array<{ productionId?: string; userSku?: string; userEmail?: string }>,
            dto.hold ? { extra: { holdReason: dto.reason ?? '' }, holdReason: dto.reason ?? '' } : undefined,
          );
        })
        .catch(() => undefined);
    }
    void this.invalidateListCache();
    return {
      success: true,
      data: { matched: result.matchedCount, modified: result.modifiedCount },
    };
  }

  /**
   * Dùng chung bởi `recoverHeldOrders()` (cron, chỉ đơn đang giữ lý do chờ
   * design) VÀ `checkOrderDesignFromOnospod()` (nút thủ công "Kiểm tra design
   * mới" — MỌI đơn, không cần đang giữ). Tra OnosPod theo `orderId`, so sánh
   * design mới với baseline (`designsOriginal ?? designs`), nếu khác → ghi đè
   * `designs`/`designsOriginal` + **reset `toolResult`/`toolResultNote` về
   * rỗng** (design cũ đã soát coi như không còn giá trị — CÙNG cơ chế
   * `holdOrder()` làm khi giữ đơn lý do "Đợi khách sửa design", để đơn tự rơi
   * lại hàng đợi `getNextDesignReviewOrder()`) + log `update_design`. Set
   * thẳng, KHÔNG qua `updateField()` nên KHÔNG có side-effect hook — áp dụng
   * BẤT KỂ đơn đang ở công đoạn nào (kể cả đã vào Fulfillment In/Ép/May).
   * Mở giữ (`$unset heldAt/holdReason` + log `unhold`) khi: đơn ĐANG giữ ĐÚNG
   * lý do "Đợi khách sửa design" (`holdReason=HOLD_REASON_WAITING_DESIGN`,
   * luôn đúng) HOẶC `opts.forceUnhold=true` (nút thủ công — mở giữ đơn đang
   * giữ BẤT KỂ lý do gì, xem `opts` doc). Đơn không giữ → chỉ cập nhật design
   * + reset tool, KHÔNG đụng `heldAt`.
   */
  private async applyDesignFromOnospod(
    order: {
      _id: unknown;
      productionId: string;
      orderId?: string;
      designs?: DesignFields;
      designsOriginal?: DesignFields;
      heldAt?: Date | null;
      holdReason?: string | null;
      onospodHold?: { onHoldAt?: Date | null } | null;
      toolResult?: string | null;
      toolResultNote?: string | null;
    },
    ctx?: AuditContext,
    opts?: {
      /**
       * Nút thủ công "Kiểm tra design mới" — mở giữ khi phát hiện design mới
       * BẤT KỂ `holdReason` là gì (nhân viên đã chủ động bấm kiểm tra ĐÚNG
       * đơn này nên coi việc tìm thấy design mới là đủ điều kiện mở giữ, dù
       * lý do giữ ban đầu không CHÍNH XÁC = `HOLD_REASON_WAITING_DESIGN`).
       * Cron `recoverHeldOrders()` KHÔNG truyền cờ này — giữ nguyên hành vi
       * cũ (chỉ mở giữ khi khớp CHÍNH XÁC lý do, vì cron chạy tự động không
       * người giám sát).
       */
      forceUnhold?: boolean;
      /**
       * `syncDesignByCustomer()` (nút thủ công đồng bộ design theo mã khách
       * hàng) — CHỈ ghi `designs`/`designsOriginal`, KHÔNG reset
       * `toolResult`/`toolResultNote` và KHÔNG đụng `heldAt`/`holdReason`
       * (yêu cầu rõ: chỉ cập nhật design, không cập nhật gì khác).
       */
      skipSideEffects?: boolean;
    },
  ): Promise<{
    updated: boolean;
    reason?: string;
    changed?: Partial<DesignFields>;
    updatedOrder?: OrderDocument | null;
  }> {
    const productionId = order.productionId;
    const orderNumber = order.orderId;
    if (!orderNumber) {
      return { updated: false, reason: 'Thiếu orderId (mã đơn OnosPod) — không tra được' };
    }

    const lookup = await this.onospodOrderLookupService.lookupByProductionId(orderNumber, productionId);
    if (!lookup) {
      return { updated: false, reason: 'OnosPod chưa cấu hình hoặc gọi API thất bại' };
    }
    if (lookup.ambiguous) {
      return { updated: false, reason: 'Nhiều line_item cùng khớp productionId — cần review tay' };
    }
    if (!lookup.matched || !lookup.design || Object.keys(lookup.design).length === 0) {
      return { updated: false, reason: 'Không tìm thấy design tương ứng trên OnosPod' };
    }

    const baseline = order.designsOriginal ?? order.designs ?? {};
    const changed: Partial<DesignFields> = {};
    for (const [key, value] of Object.entries(lookup.design) as Array<[keyof DesignFields, string]>) {
      if ((baseline as Record<string, string | undefined>)[key] !== value) changed[key] = value;
    }
    if (Object.keys(changed).length === 0) {
      return { updated: false, reason: 'Design chưa thay đổi — vẫn giống hiện tại' };
    }

    const set: Record<string, unknown> = {};
    const beforeSnapshot: Record<string, unknown> = {};
    const afterSnapshot: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changed)) {
      set[`designs.${key}`] = value;
      set[`designsOriginal.${key}`] = value;
      beforeSnapshot[`designs.${key}`] = (baseline as Record<string, string | undefined>)[key];
      afterSnapshot[`designs.${key}`] = value;
    }
    // Design đổi → design cũ (đã soát tool trên đó, nếu có) coi như không còn
    // giá trị. Reset `toolResult`/`toolResultNote` về rỗng để đơn tự rơi lại
    // hàng đợi `getNextDesignReviewOrder()` (tool soát lại design mới) — CÙNG
    // cơ chế `holdOrder()` đã làm khi giữ đơn lý do "Đợi khách sửa design".
    // Set thẳng (KHÔNG qua `updateField()`) nên KHÔNG chạy side-effect hook
    // (không đụng `currentFulfillmentStage`/`fulfillmentStages`) — áp dụng
    // BẤT KỂ đơn đang ở công đoạn nào trong Fulfillment. Bỏ qua toàn bộ nếu
    // `opts.skipSideEffects` (chỉ cập nhật design, không đụng gì khác).
    if (!opts?.skipSideEffects) {
      set.toolResult = '';
      set.toolResultNote = '';
      beforeSnapshot.toolResult = order.toolResult ?? '';
      afterSnapshot.toolResult = '';
      beforeSnapshot.toolResultNote = order.toolResultNote ?? '';
      afterSnapshot.toolResultNote = '';
    }

    const shouldUnhold =
      !opts?.skipSideEffects &&
      !!order.heldAt &&
      (order.holdReason === HOLD_REASON_WAITING_DESIGN || !!opts?.forceUnhold);
    // Mở giữ (kể cả `forceUnhold` của nút "Kiểm tra design mới") một đơn OnosPod
    // vẫn đang giữ → ghi mốc bỏ qua đợt đó, đồng bộ không giữ lại (Orders.md §9d).
    if (shouldUnhold && order.onospodHold?.onHoldAt) set.onospodHoldDismissedAt = order.onospodHold.onHoldAt;
    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      order._id,
      shouldUnhold ? { $set: set, $unset: { heldAt: 1, holdReason: 1, holdSource: 1 } } : { $set: set },
      { new: true },
    );
    // Log riêng design đã đổi field nào (before/after) — CÙNG convention với
    // updateOrderDesign() (action='update_design'), KHÁC log 'unhold' bên dưới
    // (chỉ ghi nhận việc mở giữ, không có chi tiết design).
    void this.orderLogService.write({
      orderId: String(order._id),
      action: 'update_design',
      field: 'designs',
      before: beforeSnapshot,
      after: afterSnapshot,
      ctx,
    });
    if (shouldUnhold) {
      void this.orderLogService.write({
        orderId: String(order._id),
        action: 'unhold',
        field: 'heldAt',
        before: order.holdReason ?? HOLD_REASON_WAITING_DESIGN,
        after: null,
        ctx,
      });
    }

    return { updated: true, changed, updatedOrder };
  }

  /**
   * Cron công khai — quét đơn đang GIỮ lý do "chờ khách cập nhật" (design hoặc
   * địa chỉ), gọi OnosPod kiểm tra khách đã cập nhật chưa, nếu có → cập nhật +
   * tự MỞ GIỮ. Xem `Orders.md §9c` + `OnospodOrderLookupService`.
   *
   * - Design: so sánh trực tiếp từ lần đầu — `designs`/`designsOriginal` hiện
   *   có đã là baseline hợp lệ (populate từ lúc import). Logic thực (lookup +
   *   so sánh + ghi) nằm ở `applyDesignFromOnospod()` (dùng chung với nút thủ
   *   công `checkOrderDesignFromOnospod()`).
   * - Địa chỉ: `shippingAddress` là field MỚI chưa có baseline → lần check đầu
   *   chỉ SNAPSHOT (không tự mở giữ); từ lần thứ 2 mới thực sự so sánh + mở
   *   giữ khi khác snapshot đã lưu.
   */
  async recoverHeldOrders(ctx?: AuditContext): Promise<RecoverHeldOrdersResDto> {
    const skipped: Array<{ productionId: string; reason: string }> = [];
    let checkedDesign = 0;
    let checkedAddress = 0;
    let designUpdated = 0;
    let addressPrimed = 0;
    let addressUpdated = 0;
    let unheld = 0;

    const [designOrders, addressOrders] = await Promise.all([
      this.orderModel
        .find({ heldAt: { $exists: true }, cancelledAt: { $exists: false }, holdReason: HOLD_REASON_WAITING_DESIGN })
        .lean(),
      this.orderModel
        .find({ heldAt: { $exists: true }, cancelledAt: { $exists: false }, holdReason: HOLD_REASON_WAITING_ADDRESS })
        .lean(),
    ]);

    for (const order of designOrders) {
      checkedDesign++;
      const res = await this.applyDesignFromOnospod(order, ctx);
      if (res.updated) {
        designUpdated++;
        unheld++;
      } else {
        skipped.push({ productionId: order.productionId, reason: res.reason! });
      }
    }

    for (const order of addressOrders) {
      checkedAddress++;
      const productionId = order.productionId;
      const orderNumber = order.orderId;
      if (!orderNumber) {
        skipped.push({ productionId, reason: 'Thiếu orderId (mã đơn OnosPod) — không tra được' });
        continue;
      }

      const lookup = await this.onospodOrderLookupService.lookupByProductionId(orderNumber, productionId);
      if (!lookup) {
        skipped.push({ productionId, reason: 'OnosPod chưa cấu hình hoặc gọi API thất bại' });
        continue;
      }
      if (lookup.ambiguous) {
        skipped.push({ productionId, reason: 'Nhiều line_item cùng khớp productionId — cần review tay' });
        continue;
      }
      if (!lookup.matched || !lookup.shipping) {
        skipped.push({ productionId, reason: 'Không tìm thấy địa chỉ ship tương ứng trên OnosPod' });
        continue;
      }

      const stored = order.shippingAddress;
      if (!stored) {
        // Lần đầu — chưa có baseline để so sánh, chỉ snapshot, KHÔNG tự mở giữ.
        await this.orderModel.findByIdAndUpdate(order._id, { $set: { shippingAddress: lookup.shipping } });
        addressPrimed++;
        skipped.push({ productionId, reason: 'Lần đầu kiểm tra — đã lưu snapshot địa chỉ, chờ lần sau so sánh' });
        continue;
      }

      const isSame = ADDRESS_FIELDS.every((f) => (stored[f] || '') === (lookup.shipping![f] || ''));
      if (isSame) {
        skipped.push({ productionId, reason: 'Địa chỉ chưa thay đổi — vẫn đang chờ khách' });
        continue;
      }

      await this.orderModel.findByIdAndUpdate(order._id, {
        $set: {
          shippingAddress: lookup.shipping,
          // Cùng luật mở giữ ở `unholdOrder` — OnosPod đang giữ thì bỏ qua đợt đó (§9d).
          ...(order.onospodHold?.onHoldAt ? { onospodHoldDismissedAt: order.onospodHold.onHoldAt } : {}),
        },
        $unset: { heldAt: 1, holdReason: 1, holdSource: 1 },
      });
      void this.orderLogService.write({
        orderId: String(order._id),
        action: 'unhold',
        field: 'heldAt',
        before: HOLD_REASON_WAITING_ADDRESS,
        after: null,
        ctx,
      });
      addressUpdated++;
      unheld++;
    }

    if (designUpdated > 0 || addressUpdated > 0) void this.invalidateListCache();

    return {
      success: true,
      data: { checkedDesign, checkedAddress, designUpdated, addressPrimed, addressUpdated, unheld, skipped },
    };
  }

  /**
   * Nút thủ công "Kiểm tra design mới" (Danh sách đơn, action menu từng
   * hàng) — Admin/Manager/Support/DesignerLeader/Fulfillment bấm để ép tra
   * OnosPod cho 1 ĐƠN BẤT KỲ (không cần đang giữ, KHÁC `recoverHeldOrders()`
   * chỉ quét đơn hold). Dùng chung logic `applyDesignFromOnospod()`, truyền
   * `{forceUnhold: true}` — đơn ĐANG GIỮ (bất kể lý do gì, không riêng "Đợi
   * khách sửa design") mà tìm thấy design mới → TỰ MỞ GIỮ luôn (nhân viên đã
   * chủ động bấm kiểm tra đúng đơn này, coi tìm thấy design mới là đủ điều
   * kiện mở giữ). Đơn đã hủy → skip (không kiểm tra).
   */
  async checkOrderDesignFromOnospod(id: string, ctx?: AuditContext): Promise<CheckOrderDesignResDto> {
    const order = await this.orderModel.findById(id).lean();
    if (!order) throw new NotFoundException('Order not found');
    if (order.cancelledAt) {
      return { success: true, data: { updated: false, reason: 'Đơn đã hủy — không kiểm tra design.' } };
    }

    const res = await this.applyDesignFromOnospod(order, ctx, { forceUnhold: true });
    if (res.updated) void this.invalidateListCache();
    return {
      success: true,
      data: { updated: res.updated, reason: res.reason, changed: res.changed, order: res.updatedOrder ?? undefined },
    };
  }

  /**
   * Nút thủ công "Đồng bộ design theo mã khách hàng" — truyền `userSku`, tìm
   * TOÀN BỘ đơn của khách (kể cả đơn đã hủy → skip, không kiểm tra), tra lại
   * OnosPod cho từng đơn qua `applyDesignFromOnospod({skipSideEffects: true})`
   * — CHỈ ghi `designs`/`designsOriginal`, KHÔNG reset `toolResult`/
   * `toolResultNote`, KHÔNG đụng `heldAt`/`holdReason` (khác
   * `checkOrderDesignFromOnospod` — yêu cầu rõ: chỉ cập nhật design).
   */
  async syncDesignByCustomer(userSku: string, ctx?: AuditContext): Promise<SyncDesignByCustomerResDto> {
    const orders = await this.orderModel.find({ userSku }).lean();

    const skipped: Array<{ productionId: string; reason: string }> = [];
    let updated = 0;
    for (const order of orders) {
      if (order.cancelledAt) {
        skipped.push({ productionId: order.productionId, reason: 'Đơn đã hủy — không đồng bộ.' });
        continue;
      }
      const res = await this.applyDesignFromOnospod(order, ctx, { skipSideEffects: true });
      if (res.updated) updated++;
      else skipped.push({ productionId: order.productionId, reason: res.reason! });
    }

    if (updated > 0) void this.invalidateListCache();
    return { success: true, data: { total: orders.length, updated, skipped } };
  }

  /**
   * Nút "Kiểm tra design mới" bản HÀNG LOẠT (bulk toolbar, Danh sách đơn) —
   * áp cho TỪNG đơn trong danh sách `ids` đang tick chọn. CÙNG logic/cơ chế
   * `checkOrderDesignFromOnospod()` (reset `toolResult`/`toolResultNote` +
   * `forceUnhold: true` — mở giữ bất kể lý do gì nếu đơn đang giữ), KHÁC
   * `syncDesignByCustomer()` (theo `userSku`, KHÔNG reset tool/heldAt). Đơn
   * đã hủy → skip.
   */
  async bulkCheckOrderDesignFromOnospod(ids: string[], ctx?: AuditContext): Promise<BulkCheckOrderDesignResDto> {
    const orders = await this.orderModel.find({ _id: { $in: ids } }).lean();

    const skipped: Array<{ productionId: string; reason: string }> = [];
    let updated = 0;
    for (const order of orders) {
      if (order.cancelledAt) {
        skipped.push({ productionId: order.productionId, reason: 'Đơn đã hủy — không kiểm tra design.' });
        continue;
      }
      // Cô lập lỗi TỪNG đơn — 1 đơn gặp lỗi bất ngờ (khác lỗi gọi OnosPod, cái
      // đó `applyDesignFromOnospod()` đã tự bắt và trả `reason`) không được
      // làm crash cả batch, mất kết quả các đơn đã xử lý xong trước đó.
      try {
        const res = await this.applyDesignFromOnospod(order, ctx, { forceUnhold: true });
        if (res.updated) updated++;
        else skipped.push({ productionId: order.productionId, reason: res.reason! });
      } catch (err) {
        this.logger.error({
          message: JSON.stringify({
            action: 'bulkCheckOrderDesignFromOnospod',
            productionId: order.productionId,
            error: err instanceof Error ? err.message : String(err),
          }),
        });
        skipped.push({ productionId: order.productionId, reason: 'Lỗi hệ thống khi xử lý đơn này — thử lại sau.' });
      }
    }

    if (updated > 0) void this.invalidateListCache();
    return { success: true, data: { total: orders.length, updated, skipped } };
  }

  /**
   * Action "Đã soát xong" (tab Soát tool, list "Cần làm lại") — Support xác nhận
   * đã soát xong 1 đơn In trả về (marker `productionErrorSource='tool-check'` +
   * `toolResultNote='error'`) và đơn CẦN THIẾT KẾ. Khác đường đổi Note kq Tool
   * → 'ok' (= file ổn → chạy lại từ In):
   *   - Đơn có designer từng làm xong → `designerStatus='rework'` → kanban
   *     designer "Cần làm lại".
   *   - Đơn đang có designer ôm (assigned/in-progress/rework) → không đụng
   *     designer state, chỉ gỡ marker (đơn vẫn thuộc designer đó).
   *   - Chưa có designer → `autoAssignAfterImport` (chia theo cấu hình xưởng,
   *     luồng import); không có cấu hình / không map xưởng → giữ nguyên
   *     note='error' + unassigned → nằm backlog "Cần gán" (designer tự nhận
   *     hoặc leader phân).
   * GIỮ `toolResultNote='error'` (điều kiện lọt backlog/auto-assign) — chỉ gỡ
   * marker `productionErrorSource` để đơn rời list "Cần làm lại" + tab watching
   * của In (positional watching theo designerStatus tiếp quản).
   */
  async markToolCheckDone(id: string, ctx?: AuditContext): Promise<ToolCheckDoneResDto> {
    const before = await this.orderModel.findById(id).lean();
    if (!before) throw new NotFoundException('Order not found');
    const b = before as unknown as {
      heldAt?: Date | null;
      cancelledAt?: Date | null;
      productionErrorSource?: string;
      toolResultNote?: string;
      assignee?: string;
      designerStatus?: DesignerStatus;
      designerCompletedAt?: Date;
    };
    this.assertNotHeld(b);
    if (b.cancelledAt) throw new BadRequestException('Đơn đã hủy — không thao tác được.');
    if (!(b.productionErrorSource === 'tool-check' && b.toolResultNote === 'error')) {
      throw new BadRequestException('Đơn không ở trạng thái "In trả về" (chờ soát lại).');
    }

    const set: Record<string, unknown> = {
      productionErrorSource: null,
      // Re-flow từ In sau khi designer xong (Entry A) — đồng bộ nhánh 'ok' hold.
      currentFulfillmentStage: FulfillmentStage.Print,
      readyForFulfill: false,
    };
    const hasAssignee = !!b.assignee;
    const needRework = hasAssignee && (b.designerStatus === DesignerStatus.Done || !!b.designerCompletedAt);
    if (needRework) {
      set.designerStatus = DesignerStatus.Rework;
      set.designerReworkAt = new Date();
    }
    // "Đã soát xong" = xác nhận đơn có lỗi thật sau soát lại → ghi lịch sử soát
    // lỗi bền vững (mã 'error' — In trả về) cho thống kê "Soát lỗi" Tổng quan.
    await this.orderModel.updateOne({ _id: id }, { $set: set, $addToSet: { toolCheckErrorNotes: 'error' } });
    void this.orderLogService.write({
      orderId: id,
      action: 'update',
      field: 'productionErrorSource',
      before: 'tool-check',
      after: null,
      ctx,
    });
    if (needRework) {
      void this.orderLogService.write({
        orderId: id,
        action: 'update',
        field: 'designerStatus',
        before: b.designerStatus ?? null,
        after: DesignerStatus.Rework,
        ctx,
      });
    }
    void this.invalidateListCache();

    const resolveName = async (userId?: string): Promise<string | undefined> => {
      if (!userId) return undefined;
      const u = await this.userModel.findById(userId, { fullName: 1 }).lean();
      return (u as unknown as { fullName?: string } | null)?.fullName;
    };

    if (hasAssignee) {
      return { success: true, data: { outcome: 'designer-rework', assigneeName: await resolveName(b.assignee) } };
    }

    // Chưa có designer → auto-gán như luồng import (await để trả kết quả thật).
    await this.autoAssignAfterImport([id], ctx);
    const after = await this.orderModel.findById(id, { assignee: 1 }).lean();
    const newAssignee = (after as unknown as { assignee?: string } | null)?.assignee;
    if (newAssignee) {
      return { success: true, data: { outcome: 'auto-assigned', assigneeName: await resolveName(newAssignee) } };
    }
    return { success: true, data: { outcome: 'backlog' } };
  }

  /**
   * Đổi URL mockup + các vị trí design ĐANG CÓ (client chỉ gửi field muốn đổi).
   * Lưu raw URL (không qua R2). URL cũ được ghi vào OrderLog (before/after) để tra lại.
   */
  async updateOrderDesign(
    id: string,
    dto: UpdateOrderDesignDto,
    roleName?: RoleType,
    ctx?: AuditContext,
  ): Promise<OrderDocument> {
    this.assertOrderAdmin(roleName);
    const before = await this.orderModel.findById(id).lean();
    if (!before) throw new NotFoundException('Order not found');

    const set: Record<string, unknown> = {};
    const beforeSnapshot: Record<string, unknown> = {};
    const afterSnapshot: Record<string, unknown> = {};

    if (dto.mockupUrl != null) {
      beforeSnapshot.mockupUrl = (before as { mockupOriginalUrl?: string }).mockupOriginalUrl;
      set.mockupUrl = dto.mockupUrl;
      set.mockupOriginalUrl = dto.mockupUrl;
      afterSnapshot.mockupUrl = dto.mockupUrl;
    }
    if (dto.designs) {
      const prevDesigns =
        (before as { designsOriginal?: DesignFields; designs?: DesignFields }).designsOriginal ??
        (before as { designs?: DesignFields }).designs ??
        {};
      for (const [k, v] of Object.entries(dto.designs)) {
        if (v == null) continue;
        beforeSnapshot[`designs.${k}`] = (prevDesigns as Record<string, string>)[k];
        set[`designs.${k}`] = v;
        set[`designsOriginal.${k}`] = v;
        afterSnapshot[`designs.${k}`] = v;
      }
    }

    if (Object.keys(set).length === 0) {
      throw new BadRequestException('Không có thay đổi design nào để lưu.');
    }

    const updated = await this.orderModel.findByIdAndUpdate(id, { $set: set }, { new: true });
    if (!updated) throw new NotFoundException('Order not found');
    void this.orderLogService.write({
      orderId: id,
      action: 'update_design',
      field: 'designs',
      before: beforeSnapshot,
      after: afterSnapshot,
      ctx,
    });
    void this.invalidateListCache();
    return updated;
  }

  /**
   * Inline update one workshop field on one order.
   *
   * Flow:
   *   1. Check role can edit this field
   *   2. Validate value against workshop_config (skip for free text)
   *   3. Build $set patch + recompute readyForFulfill if toolResultNote changed
   *   4. findOneAndUpdate, return new doc
   *   5. Invalidate list cache
   *
   * Audit log (OrderLog) push will be added in Phase 3.
   */
  async updateField(
    id: string,
    dto: UpdateOrderFieldDto,
    roleName?: RoleType,
    ctx?: AuditContext,
    permissionCodes?: string[],
  ): Promise<UpdateOrderFieldResDto> {
    this.assertCanEditField(dto.field, roleName, permissionCodes);
    if (dto.field === 'assignee') {
      // assignee là single-select — array bất hợp lệ.
      const v = Array.isArray(dto.value) ? dto.value[0] ?? null : dto.value;
      await this.assertAssigneeUserValid(v ?? null);
    } else if (dto.field === 'priority') {
      this.assertPriorityValueValid(dto.value);
    } else {
      await this.assertValueAllowed(dto.field, dto.value);
    }

    const before = await this.orderRepository.findOneById(id);
    if (!before) throw new NotFoundException('Order not found');
    // Đơn đang giữ → khóa mọi chỉnh sửa field (mở lại trước khi thao tác).
    this.assertNotHeld(before as unknown as { heldAt?: Date | null });
    // Đơn đã hủy → khóa hẳn (không có đường mở lại như hold).
    this.assertNotCancelled(before as unknown as { cancelledAt?: Date | null });

    const normalized = normalizeFieldValue(dto.field, dto.value);
    const patch: Record<string, unknown> = { [dto.field]: normalized };
    if (dto.field === 'priority') patch.priority = normalized ? Number(normalized) : null;

    if (dto.field === 'toolResultNote') {
      patch.readyForFulfill = normalized === READY_FOR_FULFILL_CODE;
      // Khi xưởng đánh 'ok' → đơn hết lỗi → rời tab "Nhật ký bù lỗi".
      if (normalized === READY_FOR_FULFILL_CODE) {
        patch.productionFirstErrorAt = null;
        const b = before as unknown as {
          currentFulfillmentStage?: string | null;
          fulfillmentCompletedAt?: Date | null;
          productionErrorSource?: string;
          toolResultNote?: string;
          assignee?: string;
          designerStatus?: DesignerStatus;
          designerCompletedAt?: Date;
        };
        // Support soát XONG đơn bị đẩy về tool-check (marker source+note='error').
        // → CHẠY LẠI TOÀN CHUỖI từ In. Nếu đơn có designer từng làm → về Thiết kế
        // "Cần làm lại" trước (designer complete → hook Entry A flip In→rework);
        // nếu không → về In "Cần làm lại" luôn.
        const wasToolCheckHold = b.productionErrorSource === 'tool-check' && b.toolResultNote === 'error';
        if (wasToolCheckHold) {
          patch.productionErrorSource = null; // gỡ marker
          const hasDesigner = !!b.assignee && (b.designerStatus === DesignerStatus.Done || !!b.designerCompletedAt);
          patch.currentFulfillmentStage = FulfillmentStage.Print;
          if (hasDesigner) {
            patch.designerStatus = DesignerStatus.Rework;
            patch.designerReworkAt = new Date();
            // Chưa ready cho fulfillment tới khi designer làm lại xong (Entry A
            // set readyForFulfill=true + flip In→rework khi designer complete).
            patch.readyForFulfill = false;
          } else {
            patch['fulfillmentStages.print.status'] = FulfillmentStageStatus.Rework;
            patch['fulfillmentStages.print.reworkAt'] = new Date();
          }
        } else {
          // Entry point fulfillment thứ 2 — manual set 'ok' (admin/leader bypass
          // designer state machine). Chỉ áp khi đơn chưa từng vào fulfillment để
          // tránh ghi đè state đang chạy. Đơn ĐÃ HOÀN THÀNH (pack done →
          // currentFulfillmentStage=null + fulfillmentCompletedAt) cũng có stage
          // null — không được re-init, tránh kéo đơn xong về print/waiting.
          // Đơn xưởng US (ngoài luồng sản xuất) không vào fulfillment.
          const usFactoryId = getExcludedFactoryIdSync(this.orderModel.db);
          const isExcludedFactory = !!usFactoryId && (b as { factoryId?: string }).factoryId === usFactoryId;
          if (!b.currentFulfillmentStage && !b.fulfillmentCompletedAt && !isExcludedFactory) {
            Object.assign(patch, buildFulfillmentEntrySet());
          }
        }
      } else {
        // Toggle KHỎI 'ok' (vd về 'no-pdf', 'error', null) → đơn không còn
        // ready. Nếu đơn đang ở print/waiting và worker chưa bao giờ start
        // (firstStartedAt missing toàn bộ stages) → clear stage để tránh
        // orphan ngược (FactoryOverview không đếm nhưng my-tasks lại đếm).
        // Đơn đã được worker chạm vào → giữ stage, worker tiếp tục xử lý.
        const beforeStages =
          (before as unknown as { fulfillmentStages?: Record<string, { firstStartedAt?: Date }> }).fulfillmentStages ||
          {};
        const anyStageStarted = Object.values(beforeStages).some((s) => !!s?.firstStartedAt);
        const beforeStage = (before as unknown as { currentFulfillmentStage?: string | null }).currentFulfillmentStage;
        if (beforeStage && !anyStageStarted) {
          patch.currentFulfillmentStage = null;
          patch.fulfillmentStages = {};
        }
      }
    }

    // ─── Designer-Task-Workflow Phase 3 hooks ──────────────────────
    // 1) assignee → auto-set designerStatus + timestamps, block reassign khi
    //    đang in-progress/done/rework.
    if (dto.field === 'assignee') {
      const currentDesignerStatus =
        (before as unknown as { designerStatus?: DesignerStatus }).designerStatus || DesignerStatus.Unassigned;
      // Đơn đã soát 'ok' (Note kq Tool 1) → không cho gán designer (chỉ chặn khi
      // GÁN, vẫn cho bỏ chọn). Mirror rule của bulk "Gán design".
      if (normalized && (before as unknown as { toolResultNote?: string }).toolResultNote === READY_FOR_FULFILL_CODE) {
        throw new BadRequestException(`Đơn đã 'ok' (Note kq Tool 1) — không cần gán designer.`);
      }
      const beforeAssignee = (before as unknown as { assignee?: string }).assignee;
      // Đơn cần làm lại đang có người ôm → không gán cho người khác (chỉ chặn
      // khi GÁN). Rework chưa ai ôm vẫn gán được (mirror bulk "Gán design").
      if (normalized && currentDesignerStatus === DesignerStatus.Rework && beforeAssignee) {
        throw new ConflictException(
          `Đơn cần làm lại đang có người ôm — không gán cho người khác. Chỉ gán được đơn chưa có ai ôm.`,
        );
      }
      // Chỉ chặn theo trạng thái khi GÁN (normalized có giá trị) — BỎ GÁN
      // (normalized=null/'') luôn cho phép, kể cả đang in-progress/done/rework,
      // vì đây là thao tác sửa sai của leader/admin, không phải reassign.
      if (normalized && !this.canAssignDesignerByStatus(currentDesignerStatus, !!beforeAssignee)) {
        throw new ConflictException(
          `Không reassign được — task đang '${currentDesignerStatus}'. Yêu cầu designer hoàn thành hoặc reset trước.`,
        );
      }
      if (normalized) {
        patch.designerStatus = DesignerStatus.Assigned;
        patch.designerAssignedAt = new Date();
        // Clear reject reason khi assign lại (kể cả cùng người), tránh để rác
        // từ vòng reject trước.
        patch.designerRejectedReason = null;
        patch.designerRejectedAt = null;
      } else {
        // Clear assignee → trở về unassigned + xoá tất cả timestamps designer.
        patch.designerStatus = DesignerStatus.Unassigned;
        patch.designerAssignedAt = null;
        patch.designerStartedAt = null;
        patch.designerCompletedAt = null;
        patch.designerRejectedAt = null;
        patch.designerReworkAt = null;
        patch.designerRejectedReason = null;
        patch.designerReworkCount = 0;
      }
    }

    // 2) productionError → auto-fill productionErrorSource từ config (user
    //    override sau qua updateField('productionErrorSource')). Đồng thời:
    //    - Set toolResultNote='error' để xưởng nhìn thấy ngay (đếm số lần
    //      qua productionErrorCount để cell hiển thị "Lỗi ×N")
    //    - readyForFulfill GIỮ NGUYÊN (= true) để fulfillment vẫn thấy đơn
    //      lỗi trong list mặc định, không cần switch filter
    //    - Nếu source='designer' VÀ task đang done → auto rework.
    let autoReworkApplied = false;
    let incProductionErrorCount = false;
    let reworkBackTimelineEntry: FulfillmentTimelineEntry | null = null;
    if (dto.field === 'productionError') {
      if (normalized) {
        const cfg = await this.workshopConfigRepository.findOne({
          category: WorkshopConfigCategory.ProductionError,
          code: normalized,
        });
        const errorSource = (cfg as unknown as { errorSource?: string } | null)?.errorSource;
        if (errorSource === 'designer' || errorSource === 'factory' || errorSource === 'tool-check') {
          patch.productionErrorSource = errorSource;
        }
        // Set toolResultNote='error' + bump counter — signal cho fulfillment.
        patch.toolResultNote = 'error';
        patch.readyForFulfill = false;
        incProductionErrorCount = true;
        // Set productionFirstErrorAt CHỈ khi field chưa có giá trị (vào lỗi
        // lần đầu của cycle hiện tại). Các lần báo lỗi tiếp theo trong cùng
        // cycle KHÔNG reset — cycle mới chỉ sau khi đơn rời log (toolResultNote='ok'
        // hoặc productionError=null) → field bị clear → lần lỗi kế tiếp set lại.
        const beforeFirstErrorAt = (before as unknown as { productionFirstErrorAt?: Date }).productionFirstErrorAt;
        if (!beforeFirstErrorAt) patch.productionFirstErrorAt = new Date();
        const currentDesignerStatus =
          (before as unknown as { designerStatus?: DesignerStatus }).designerStatus || DesignerStatus.Unassigned;
        // Báo lỗi designer → designerStatus='rework' + rework-back về designer
        // (đơn vào/giữ stage pipeline → tab "Đang chờ quay lại"; xong → "Cần làm lại").
        // Bỏ qua khi designer đang rework (tránh báo trùng) hoặc đang in-progress/
        // assigned (designer đang làm dở, không giật). Done/Unassigned/Rejected → fire.
        if (errorSource === 'designer' && this.canReworkBackToDesigner(currentDesignerStatus)) {
          patch.designerStatus = DesignerStatus.Rework;
          patch.designerReworkAt = new Date();
          autoReworkApplied = true;
          const rb = this.buildDesignerReworkBackFromError(
            before,
            (before as unknown as { productionErrorNote?: string }).productionErrorNote ?? null,
            ctx,
          );
          if (rb) {
            Object.assign(patch, rb.set);
            reworkBackTimelineEntry = rb.timelineEntry;
          }
        }
        // Báo lỗi loại 'tool-check' (vd "Thiếu file để in") → đẩy về Support:
        // KHÔNG đụng designerStatus; giữ marker (source=tool-check + note=error)
        // → đơn nằm tab "Đang chờ quay lại" của In; support đổi note='ok' → về
        // active In. Đồng thời tạo/giữ stage pipeline để In watch được.
        if (errorSource === 'tool-check' && this.canReworkBackToSupport(before)) {
          const rb = this.buildDesignerReworkBackFromError(
            before,
            (before as unknown as { productionErrorNote?: string }).productionErrorNote ?? null,
            ctx,
            'tool-check',
          );
          if (rb) {
            Object.assign(patch, rb.set);
            reworkBackTimelineEntry = rb.timelineEntry;
          }
        }
      } else {
        // Clear productionError → cũng clear source. Counter giữ nguyên
        // (lịch sử) — toolResultNote giữ nguyên để designer chủ động chỉnh.
        // Đơn rời nhật ký bù lỗi → clear productionFirstErrorAt.
        patch.productionErrorSource = null;
        patch.productionFirstErrorAt = null;
      }
    }

    // 3) productionErrorSource user manually set → cũng có thể trigger rework
    //    nếu user đổi từ 'factory' → 'designer' và task đang done.
    if (dto.field === 'productionErrorSource' && normalized === 'designer') {
      const currentDesignerStatus =
        (before as unknown as { designerStatus?: DesignerStatus }).designerStatus || DesignerStatus.Unassigned;
      if (this.canReworkBackToDesigner(currentDesignerStatus)) {
        patch.designerStatus = DesignerStatus.Rework;
        patch.designerReworkAt = new Date();
        autoReworkApplied = true;
        const rb = this.buildDesignerReworkBackFromError(
          before,
          (before as unknown as { productionErrorNote?: string }).productionErrorNote ?? null,
          ctx,
        );
        if (rb) {
          Object.assign(patch, rb.set);
          reworkBackTimelineEntry = rb.timelineEntry;
        }
      }
    }

    // 3b) productionErrorSource user đổi tay sang 'tool-check' → đẩy về Support.
    if (dto.field === 'productionErrorSource' && normalized === 'tool-check') {
      if (this.canReworkBackToSupport(before)) {
        patch.toolResultNote = 'error';
        patch.readyForFulfill = false;
        const rb = this.buildDesignerReworkBackFromError(
          before,
          (before as unknown as { productionErrorNote?: string }).productionErrorNote ?? null,
          ctx,
          'tool-check',
        );
        if (rb) {
          Object.assign(patch, rb.set);
          reworkBackTimelineEntry = rb.timelineEntry;
        }
      }
    }

    // Mốc soát tool — set lần đầu khi toolResultNote chuyển rỗng → có giá trị
    // (qua field 'toolResultNote' hoặc nhánh productionError set 'error').
    // Dùng cho dashboard Vòng đời chặng "Soát tool".
    if (
      typeof patch.toolResultNote === 'string' &&
      patch.toolResultNote.trim() &&
      !(before as unknown as { toolCheckedAt?: Date }).toolCheckedAt
    ) {
      patch.toolCheckedAt = new Date();
    }

    // Tách $inc / $set vì autoReworkApplied cần $inc.
    const mongoUpdate: Record<string, unknown> = { $set: patch };
    const incOps: Record<string, number> = {};
    if (autoReworkApplied) incOps.designerReworkCount = 1;
    if (incProductionErrorCount) incOps.productionErrorCount = 1;
    if (Object.keys(incOps).length > 0) mongoUpdate.$inc = incOps;
    if (reworkBackTimelineEntry) {
      mongoUpdate.$push = { fulfillmentTimeline: reworkBackTimelineEntry };
    }
    // Người soát tool đánh Note kq Tool ≠ ok (và ≠ rỗng) → ghi BỀN VỮNG mã note
    // vào `toolCheckErrorNotes` (dedup) để thống kê lịch sử lỗi Soát tool kể cả
    // sau khi đơn được sửa về 'ok'. Chỉ nhánh field='toolResultNote' (thao tác
    // trực tiếp của người soát) — KHÔNG tính side-effect 'error' do In báo.
    if (
      dto.field === 'toolResultNote' &&
      typeof normalized === 'string' &&
      normalized.trim() &&
      normalized !== READY_FOR_FULFILL_CODE
    ) {
      mongoUpdate.$addToSet = { toolCheckErrorNotes: normalized };
    }

    const updated = await this.orderModel.findOneAndUpdate({ _id: id }, mongoUpdate, { new: true });
    if (!updated) throw new NotFoundException('Order not found');

    void this.orderLogService.write({
      orderId: id,
      action: 'update',
      field: dto.field,
      before: (before as unknown as Record<string, unknown>)[dto.field] ?? null,
      after: normalized,
      ctx,
    });

    if (autoReworkApplied) {
      void this.orderLogService.write({
        orderId: id,
        action: 'update',
        field: 'designerStatus',
        before: DesignerStatus.Done,
        after: DesignerStatus.Rework,
        ctx,
      });
      // Lỗi designer trên đơn CHƯA ai ôm (soát 'ok' từ đầu → chưa từng có
      // designer) → auto-gán theo cấu hình xưởng; engine tự lọc đơn đã có assignee.
      void this.autoAssignAfterImport([id], ctx);
    }

    void this.invalidateListCache();

    // Soát tool xong VÀ ĐÚNG lỗi thiết kế (toolResultNote === 'error') → auto-gán
    // designer theo cấu hình xưởng. Các mã khác != 'ok' (vd 'no-tool', 'no-pdf')
    // KHÔNG tự gán — không phải việc của designer. Engine tự xác minh đủ điều
    // kiện (chưa gán, có xưởng, xưởng có cấu hình). Bulk toolResultNote +
    // setDesignReviewResult() (tool ngoài soát) đều delegate qua đây nên cũng phủ.
    if (dto.field === 'toolResultNote' && normalized === TOOL_CHECK_ERROR_CODE) {
      void this.autoAssignAfterImport([id], ctx);
    }

    return { success: true, data: updated };
  }

  /**
   * Bulk-apply one workshop field across many orders. Same permission + value
   * validation as `updateField`. Uses a single `updateMany` so cache invalidates
   * once and DB does a single write batch.
   */
  async bulkUpdateField(
    dto: BulkUpdateOrderFieldDto,
    roleName?: RoleType,
    ctx?: AuditContext,
    permissionCodes?: string[],
  ): Promise<BulkUpdateOrderFieldResDto> {
    this.assertCanEditField(dto.field, roleName, permissionCodes);

    // Các field có SIDE-EFFECT per-đơn (phụ thuộc state từng đơn) → `updateMany`
    // uniform không tái hiện được → **delegate loop `updateField`** để bulk hành
    // xử GIỐNG HỆT sửa tay từng cell:
    //   - `toolResultNote`      : readyForFulfill + entry fulfillment + clear stage
    //                             + toolCheckedAt + productionFirstErrorAt.
    //   - `productionError`     : auto-fill productionErrorSource từ config +
    //                             toolResultNote='error' + $inc count + rework-back
    //                             designer/tool-check + timeline.
    //   - `productionErrorSource`: rework-back designer/tool-check.
    // (assignee có dialog "Gán design" riêng + skip-semantics → giữ path updateMany.)
    // Đơn lỗi/không hợp lệ (vd bị chặn) bị skip, không fail cả batch — mirror single.
    const SIDE_EFFECT_FIELDS = ['toolResultNote', 'productionError', 'productionErrorSource'];
    if (SIDE_EFFECT_FIELDS.includes(dto.field)) {
      const value = Array.isArray(dto.value) ? dto.value[0] ?? null : dto.value;
      let matched = 0;
      let modified = 0;
      for (const id of dto.ids) {
        try {
          await this.updateField(id, { field: dto.field, value }, roleName, ctx, permissionCodes);
          matched += 1;
          modified += 1;
        } catch {
          // skip — 1 đơn lỗi không fail cả batch.
        }
      }
      void this.invalidateListCache();
      return { success: true, data: { matched, modified } };
    }

    if (dto.field === 'assignee') {
      const v = Array.isArray(dto.value) ? dto.value[0] ?? null : dto.value;
      await this.assertAssigneeUserValid(v ?? null);
    } else if (dto.field === 'priority') {
      this.assertPriorityValueValid(dto.value);
    } else {
      await this.assertValueAllowed(dto.field, dto.value);
    }

    const normalized = normalizeFieldValue(dto.field, dto.value);
    const patch: Record<string, unknown> = { [dto.field]: normalized };
    if (dto.field === 'priority') patch.priority = normalized ? Number(normalized) : null;
    // (Side-effect fields toolResultNote/productionError/productionErrorSource đã
    //  return sớm ở trên qua delegate updateField — nhánh dưới chỉ còn assignee +
    //  các field thuần config không side-effect.)

    // Bulk assignee → mirror updateField: chỉ GÁN cho order ở trạng thái
    // reassignable (in-progress/done/rework-có-người-ôm sẽ KHÔNG match filter,
    // matchedCount thấp hơn ids.length để FE biết phần nào bị bỏ). BỎ GÁN
    // (normalized=null) KHÔNG lọc theo trạng thái — luôn cho phép, kể cả đơn
    // đang in-progress/done/rework (thao tác sửa sai của leader/admin).
    let extraMatchFilter: Record<string, unknown> | null = null;
    if (dto.field === 'assignee') {
      if (normalized) {
        patch.designerStatus = 'assigned';
        patch.designerAssignedAt = new Date();
        patch.designerRejectedReason = null;
        patch.designerRejectedAt = null;
        // Đơn đã soát 'ok' → không cho GÁN designer (vẫn cho bỏ chọn). Loại khỏi
        // matchFilter → không update + matchedCount thấp hơn để FE biết bị bỏ.
        extraMatchFilter = {
          $or: [
            { designerStatus: { $exists: false } },
            { designerStatus: { $in: DESIGNER_REASSIGNABLE_STATUSES } },
            // Cần làm lại CHƯA có ai ôm → cũng gán được (assignee rỗng/missing).
            { designerStatus: DesignerStatus.Rework, assignee: { $in: [null, ''] } },
          ],
          toolResultNote: { $ne: READY_FOR_FULFILL_CODE },
        };
      } else {
        patch.designerStatus = 'unassigned';
        patch.designerAssignedAt = null;
        patch.designerStartedAt = null;
        patch.designerCompletedAt = null;
        patch.designerRejectedAt = null;
        patch.designerReworkAt = null;
        patch.designerRejectedReason = null;
        patch.designerReworkCount = 0;
      }
    }

    // Snapshot before-values for the audit log. Cheap because we only need the
    // field being changed plus _id.
    const beforeDocs = await this.orderModel
      .find({ _id: { $in: dto.ids }, deletedAt: { $exists: false } }, { _id: 1, [dto.field]: 1 })
      .lean();

    const matchFilter: Record<string, unknown> = {
      _id: { $in: dto.ids },
      deletedAt: { $exists: false },
      // Đơn đang giữ → loại khỏi bulk update (matchedCount thấp hơn để FE biết bị bỏ).
      heldAt: { $exists: false },
      // Đơn đã hủy → loại luôn, mirror guard của `updateField`.
      cancelledAt: { $exists: false },
    };
    if (extraMatchFilter) Object.assign(matchFilter, extraMatchFilter);
    const result = await this.orderModel.updateMany(matchFilter, { $set: patch });

    void this.orderLogService.writeMany(
      beforeDocs.map((doc) => ({
        orderId: (doc._id as unknown as { toString(): string }).toString(),
        action: 'bulk_update' as const,
        field: dto.field,
        before: (doc as unknown as Record<string, unknown>)[dto.field] ?? null,
        after: normalized,
        ctx,
      })),
    );

    void this.invalidateListCache();

    return {
      success: true,
      data: {
        matched: result.matchedCount,
        modified: result.modifiedCount,
      },
    };
  }

  /**
   * Chia N phần cho các designer theo trọng số `weights` (tự do, không cần
   * cộng 100), CÂN BẰNG theo tải thực tế `loads` (số đơn chưa xong mỗi
   * designer đang giữ). Từng đơn gán cho người có tải quy đổi
   * `(load + đã chia trong lô + 1) / weight` thấp nhất → soát lẻ từng đơn
   * (N=1) vẫn ra đúng tỉ lệ về lâu dài, và tự bù trừ khi 1 người đang bị dồn
   * đơn từ nguồn khác (gán tay). Σw = 0 → coi mọi trọng số = 1 (chia đều theo
   * tải); trọng số 0/âm khi có người khác > 0 → người đó không nhận đơn.
   */
  private allocateByLoad(n: number, weights: number[], loads: number[]): number[] {
    const k = weights.length;
    const alloc: number[] = new Array(k).fill(0);
    if (k === 0 || n <= 0) return alloc;
    let effective = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
    if (effective.reduce((a, b) => a + b, 0) <= 0) effective = new Array(k).fill(1);
    for (let u = 0; u < n; u++) {
      let pick = -1;
      let best = Infinity;
      for (let i = 0; i < k; i++) {
        if (effective[i] <= 0) continue;
        const score = ((loads[i] > 0 ? loads[i] : 0) + alloc[i] + 1) / effective[i];
        if (score < best) {
          best = score;
          pick = i;
        }
      }
      if (pick < 0) break;
      alloc[pick] += 1;
    }
    return alloc;
  }

  /**
   * Auto-gán đơn cho designer theo cấu hình `designer_assignment_config`.
   * Được gọi từ: `importRework` + `updateField('toolResultNote')` (bulk delegate
   * qua updateField nên cũng phủ) + `markToolCheckDone` + các đường BÁO LỖI
   * DESIGNER trên đơn chưa ai ôm (`setProductionError`, `updateField`
   * productionError/productionErrorSource, rework-back từ kanban Fulfillment —
   * public để `FulfillmentTaskService` gọi). Fire-and-forget.
   *
   * Ứng viên (tự xác minh lại trên DB, không tin state truyền vào) — chung:
   * có `factoryId` (đã map, không phải xưởng US), `assignee` rỗng, không
   * hủy/giữ/xóa. Theo trạng thái:
   *   - `unassigned` + `toolResultNote` CÓ giá trị & != 'ok' (sau soát tool).
   *   - `rework` chưa ai ôm — xưởng báo lỗi designer trên đơn CHƯA TỪNG có
   *     designer (soát 'ok' đi thẳng fulfillment). Không điều kiện toolResultNote
   *     (đường rework-back từ kanban không set 'error'). Gán xong GIỮ status
   *     `rework` → task vào thẳng cột "Cần làm lại" của designer.
   *
   * Chọn designer theo **chuỗi ưu tiên 3 mức**:
   *   1. **Khách hàng** — đơn khớp `customerMatchKey(userSku, userEmail)` với
   *      khách đã gán designer → gán thẳng designer đó, BẤT KỂ xưởng.
   *   2. **Sản phẩm** — `productConfigId` của đơn nằm trong cấu hình → gán thẳng,
   *      BẤT KỂ xưởng.
   *   3. **Xưởng** — chia cho designer của xưởng, cân bằng tải thực tế theo trọng
   *      số (`allocateByLoad`) — đơn về người có (đơn chưa xong)/weight thấp nhất;
   *      đơn vừa gán thẳng ở mức 1/2 được cộng vào tải trước khi chia.
   * Designer chỉ định ở mức 1/2 không hợp lệ (tắt/đổi role) → rơi xuống mức sau.
   */
  async autoAssignAfterImport(orderIds: string[], ctx?: AuditContext): Promise<void> {
    try {
      const plan = await this.computeAutoAssignPlan(orderIds);
      if (!plan.size) return;

      const now = new Date();
      const logRows: Array<{
        orderId: string;
        action: 'update';
        field: string;
        before: unknown;
        after: unknown;
        ctx?: AuditContext;
      }> = [];
      for (const [designerId, orderList] of plan) {
        await this.assignDesignerSlice(designerId, orderList, now);
        for (const oid of orderList) {
          logRows.push({ orderId: oid, action: 'update', field: 'assignee', before: null, after: designerId, ctx });
        }
      }
      if (logRows.length) {
        void this.orderLogService.writeMany(logRows);
        void this.invalidateListCache();
      }
    } catch (err) {
      this.logger.info({
        message: JSON.stringify({ scope: 'autoAssignAfterImport', error: String(err) }),
      });
    }
  }

  /** Điều kiện đơn còn đủ tư cách auto-gán — dùng chung `computeAutoAssignPlan`
   *  (tính plan) + `applyAutoAssignPlan` (chống race giữa preview và xác nhận). */
  private buildAutoAssignEligibleFilter(ids: string[]): Record<string, unknown> {
    const excludedFactoryId = getExcludedFactoryIdSync(this.orderModel.db);
    return {
      _id: { $in: ids },
      assignee: { $in: [null, ''] },
      factoryId: excludedFactoryId
        ? { $exists: true, $nin: [null, '', excludedFactoryId] }
        : { $exists: true, $nin: [null, ''] },
      cancelledAt: null,
      heldAt: null,
      deletedAt: { $exists: false },
      $or: [
        {
          designerStatus: DesignerStatus.Unassigned,
          toolResultNote: { $nin: [null, '', READY_FOR_FULFILL_CODE] },
        },
        { designerStatus: DesignerStatus.Rework },
      ],
    };
  }

  /** 2 lệnh ghi gán 1 slice đơn cho 1 designer: unassigned → assigned; rework
   *  chưa ai ôm → chỉ gán người, GIỮ `designerStatus='rework'` để task vào thẳng
   *  cột "Cần làm lại" (guard assignee rỗng chống race với gán tay/self-claim). */
  private async assignDesignerSlice(designerId: string, slice: string[], now: Date): Promise<void> {
    await this.orderModel.updateMany(
      { _id: { $in: slice }, designerStatus: DesignerStatus.Unassigned },
      {
        $set: {
          assignee: designerId,
          designerStatus: DesignerStatus.Assigned,
          designerAssignedAt: now,
          designerRejectedReason: null,
          designerRejectedAt: null,
        },
      },
    );
    await this.orderModel.updateMany(
      { _id: { $in: slice }, designerStatus: DesignerStatus.Rework, assignee: { $in: [null, ''] } },
      { $set: { assignee: designerId, designerAssignedAt: now } },
    );
  }

  /**
   * Tính plan auto-gán (KHÔNG ghi DB) — routing 3 mức khách → sản phẩm → xưởng
   * như docstring `autoAssignAfterImport`. Trả Map designerId → orderIds; rỗng
   * khi chưa có config / không đơn nào đủ điều kiện. Dùng bởi cả
   * `autoAssignAfterImport` (ghi ngay) lẫn `previewAutoAssign` (nút "Tự động
   * gán" có xác nhận ở bảng "Cần gán designer").
   */
  private async computeAutoAssignPlan(orderIds: string[]): Promise<Map<string, string[]>> {
    const empty = new Map<string, string[]>();
    const ids = Array.from(new Set(orderIds.map((x) => String(x)).filter(Boolean)));
    if (!ids.length) return empty;

    const config = await this.systemConfigService.get<DesignerAssignmentConfig>(DESIGNER_ASSIGNMENT_CONFIG_KEY, null);
    if (!config) return empty;

    const byFactory = new Map<string, { designerId: string; weight: number }[]>();
    for (const f of config.factories || []) {
      if (f?.factoryId && f.designers?.length) {
        byFactory.set(
          String(f.factoryId),
          f.designers.map((d) => ({ designerId: String(d.designerId), weight: d.weight })),
        );
      }
    }
    // Xưởng US (ngoài luồng sản xuất) không auto-gán designer, kể cả khi Admin
    // lỡ cấu hình designer cho nó.
    const excludedFactoryId = getExcludedFactoryIdSync(this.orderModel.db);
    if (excludedFactoryId) byFactory.delete(excludedFactoryId);

    // Ưu tiên 1/2 — map id → designer chỉ định (config cũ chưa có field → rỗng).
    const designerByCustomerId = new Map<string, string>();
    for (const c of config.customers || []) {
      for (const cid of c.customerIds || []) designerByCustomerId.set(String(cid), String(c.designerId));
    }
    // Mapping sản phẩm có hạn (`productExpiries`, từ nút "Ghi nhớ cấu hình") —
    // quá hạn thì bỏ qua tại chỗ (lazy expiry), đơn rơi xuống mức 3.
    const productExpiries = config.productExpiries || {};
    const nowMs = Date.now();
    const designerByProductConfigId = new Map<string, string>();
    for (const p of config.products || []) {
      for (const pid of p.productConfigIds || []) {
        const expTs = productExpiries[String(pid)] ? Date.parse(productExpiries[String(pid)]) : NaN;
        if (Number.isFinite(expTs) && expTs <= nowMs) continue;
        designerByProductConfigId.set(String(pid), String(p.designerId));
      }
    }
    if (!byFactory.size && !designerByCustomerId.size && !designerByProductConfigId.size) return empty;

    // Ưu tiên 1: khớp đơn ↔ khách qua customerMatchKey(userSku, userEmail) —
    // cùng khóa so khớp với tính năng gán xưởng theo khách.
    const designerByCustomerKey = new Map<string, string>();
    if (designerByCustomerId.size) {
      const customers = await this.customerRepository.findAll({
        _id: { $in: Array.from(designerByCustomerId.keys()) },
      });
      for (const c of customers) {
        const did = designerByCustomerId.get(String(c._id));
        if (did) designerByCustomerKey.set(customerMatchKey(c.userSku, c.userEmail), did);
      }
    }

    // Xác minh trạng thái thực trên DB (authoritative). Mức 1/2 gán thẳng BẤT
    // KỂ xưởng nên không giới hạn factoryId theo cấu hình mức 3 — chỉ cần đơn
    // đã map xưởng và không phải xưởng US.
    const eligible = await this.orderModel
      .find(this.buildAutoAssignEligibleFilter(ids), {
        _id: 1,
        factoryId: 1,
        userSku: 1,
        userEmail: 1,
        productConfigId: 1,
      })
      .lean();
    if (!eligible.length) return empty;

    // Chỉ giữ designer đang Active + đúng role Designer (cả 3 mức).
    const allDesignerIds = Array.from(
      new Set([
        ...(config.factories || []).flatMap((f) => (f.designers || []).map((d) => String(d.designerId))),
        ...designerByCustomerId.values(),
        ...designerByProductConfigId.values(),
      ]),
    );
    const designerRole = await this.roleRepository.findOne({ name: RoleType.Designer });
    const activeUsers = await this.userModel
      .find({ _id: { $in: allDesignerIds }, roleId: designerRole?._id, status: Status.Active }, { _id: 1 })
      .lean();
    const validIds = new Set(activeUsers.map((u) => String(u._id)));

    // Tải thực tế: số đơn CHƯA XONG mỗi designer đang giữ (kể cả gán tay,
    // mọi xưởng) — để cân bằng khi chia, đặc biệt khi soát lẻ từng đơn (N=1).
    const loadRows = await this.orderModel.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          assignee: { $in: Array.from(validIds) },
          designerStatus: { $in: DESIGNER_ACTIVE_STATUSES },
          cancelledAt: null,
          deletedAt: { $exists: false },
        },
      },
      { $group: { _id: '$assignee', count: { $sum: 1 } } },
    ]);
    const loadByDesigner = new Map(loadRows.map((r) => [String(r._id), r.count]));

    // Route từng đơn theo chuỗi ưu tiên: khách → sản phẩm → xưởng. Designer
    // chỉ định không hợp lệ (tắt/đổi role) → thử mức tiếp theo.
    const directGroups = new Map<string, string[]>(); // designerId → orderIds (mức 1/2)
    const factoryGroups = new Map<string, string[]>(); // factoryId → orderIds (mức 3)
    for (const o of eligible) {
      const doc = o as unknown as {
        _id: unknown;
        factoryId?: string;
        userSku?: string;
        userEmail?: string;
        productConfigId?: string;
      };
      const byCustomer = designerByCustomerKey.get(customerMatchKey(doc.userSku, doc.userEmail));
      const byProduct = doc.productConfigId ? designerByProductConfigId.get(String(doc.productConfigId)) : undefined;
      const direct =
        (byCustomer && validIds.has(byCustomer) && byCustomer) ||
        (byProduct && validIds.has(byProduct) && byProduct) ||
        '';
      if (direct) {
        if (!directGroups.has(direct)) directGroups.set(direct, []);
        directGroups.get(direct)!.push(String(doc._id));
        continue;
      }
      const fid = String(doc.factoryId);
      if (!byFactory.has(fid)) continue;
      if (!factoryGroups.has(fid)) factoryGroups.set(fid, []);
      factoryGroups.get(fid)!.push(String(doc._id));
    }

    // Gộp plan: mức 1/2 gán thẳng (cộng vào tải để mức 3 chia ngay sau vẫn
    // cân), mức 3 chia theo xưởng cân bằng tải thực tế theo trọng số.
    const plan = new Map<string, string[]>();
    const push = (designerId: string, slice: string[]) => {
      if (!slice.length) return;
      plan.set(designerId, [...(plan.get(designerId) || []), ...slice]);
    };
    for (const [designerId, orderList] of directGroups) {
      push(designerId, orderList);
      loadByDesigner.set(designerId, (loadByDesigner.get(designerId) || 0) + orderList.length);
    }
    for (const [fid, orderList] of factoryGroups) {
      const designers = (byFactory.get(fid) || []).filter((d) => validIds.has(d.designerId));
      if (!designers.length) continue;
      const alloc = this.allocateByLoad(
        orderList.length,
        designers.map((d) => d.weight),
        designers.map((d) => loadByDesigner.get(d.designerId) || 0),
      );
      let cursor = 0;
      for (let i = 0; i < designers.length; i++) {
        const count = alloc[i];
        if (count <= 0) continue;
        push(designers[i].designerId, orderList.slice(cursor, cursor + count));
        cursor += count;
      }
    }
    return plan;
  }

  /**
   * Preview nút "Tự động gán theo config" ở bảng "Cần gán designer" — chạy
   * cùng routing với autoAssignAfterImport nhưng KHÔNG ghi, trả về mỗi designer
   * nhận bao nhiêu đơn (kèm orderIds để FE gửi lại y nguyên khi xác nhận) +
   * số đơn không gán được (ngoài cấu hình / không đủ điều kiện).
   */
  async previewAutoAssign(orderIds: string[]): Promise<{
    plan: Array<{ userId: string; fullName: string; email?: string; count: number; orderIds: string[] }>;
    unassignedCount: number;
    totalRequested: number;
  }> {
    const ids = Array.from(new Set(orderIds.map((x) => String(x)).filter(Boolean)));
    const planMap = await this.computeAutoAssignPlan(ids);
    const rows: Array<{ userId: string; fullName: string; email?: string; count: number; orderIds: string[] }> = [];
    if (planMap.size) {
      const users = await this.userModel
        .find({ _id: { $in: Array.from(planMap.keys()) } }, { fullName: 1, email: 1 })
        .lean();
      const nameMap = new Map(users.map((u) => [String(u._id), u as { fullName?: string; email?: string }]));
      for (const [userId, list] of planMap) {
        const info = nameMap.get(userId);
        rows.push({
          userId,
          fullName: info?.fullName || `#${userId.slice(-4)}`,
          email: info?.email,
          count: list.length,
          orderIds: list,
        });
      }
      rows.sort((a, b) => b.count - a.count || a.fullName.localeCompare(b.fullName));
    }
    const assigned = rows.reduce((s, r) => s + r.count, 0);
    return { plan: rows, unassignedCount: ids.length - assigned, totalRequested: ids.length };
  }

  /**
   * Áp ĐÚNG plan người dùng đã xem ở preview (không tính lại). Đơn đổi trạng
   * thái giữa lúc preview và xác nhận (đã có người ôm / hủy / giữ) → BỎ QUA và
   * đếm vào `skipped`; designer bị tắt/đổi role giữa chừng → skip cả slice.
   */
  async applyAutoAssignPlan(
    assignments: Array<{ userId: string; orderIds: string[] }>,
    ctx?: AuditContext,
  ): Promise<{ assigned: number; skipped: number }> {
    const designerRole = await this.roleRepository.findOne({ name: RoleType.Designer });
    const activeUsers = await this.userModel
      .find(
        { _id: { $in: assignments.map((a) => String(a.userId)) }, roleId: designerRole?._id, status: Status.Active },
        { _id: 1 },
      )
      .lean();
    const validIds = new Set(activeUsers.map((u) => String(u._id)));

    const now = new Date();
    const logRows: Array<{
      orderId: string;
      action: 'update';
      field: string;
      before: unknown;
      after: unknown;
      ctx?: AuditContext;
    }> = [];
    let assigned = 0;
    let skipped = 0;
    for (const a of assignments) {
      const ids = Array.from(new Set((a.orderIds || []).map((x) => String(x)).filter(Boolean)));
      if (!ids.length) continue;
      const userId = String(a.userId);
      if (!validIds.has(userId)) {
        skipped += ids.length;
        continue;
      }
      const eligible = await this.orderModel.find(this.buildAutoAssignEligibleFilter(ids), { _id: 1 }).lean();
      const eligibleIds = eligible.map((e) => String(e._id));
      skipped += ids.length - eligibleIds.length;
      if (!eligibleIds.length) continue;
      await this.assignDesignerSlice(userId, eligibleIds, now);
      assigned += eligibleIds.length;
      for (const oid of eligibleIds) {
        logRows.push({ orderId: oid, action: 'update', field: 'assignee', before: null, after: userId, ctx });
      }
    }
    if (logRows.length) {
      void this.orderLogService.writeMany(logRows);
      void this.invalidateListCache();
    }
    return { assigned, skipped };
  }

  /**
   * Single-order fetch cho detail dialog. Designer (sub) chỉ get được task
   * có `assignee = user._id`. Roles khác (Admin/Leader/...) bypass.
   */
  async getOrderById(id: string, roleName?: RoleType, userId?: string): Promise<{ success: true; data: unknown }> {
    const doc = await this.orderModel
      .findById(id)
      .populate('factory', 'name shortName')
      .populate('machineType', 'name shortName')
      .populate('productConfig', 'fullName shortName')
      .lean();
    if (!doc) throw new NotFoundException('Order not found');

    if (roleName === RoleType.Designer) {
      if (!userId || (doc as { assignee?: string }).assignee !== userId) {
        throw new ForbiddenException('Task không thuộc bạn.');
      }
    }
    return { success: true, data: doc };
  }

  /**
   * Quét barcode (máy USB HID) → tìm đơn theo `productionId` exact match
   * case-insensitive. Workshop dùng để mở dialog gán lỗi cho công đoạn trước.
   *
   * Visibility:
   *   - Designer (sub): chỉ thấy đơn `assignee = user._id`.
   *   - Fulfillment: chỉ thấy đơn `factoryId = user.factoryId` HOẶC
   *     `originalFactoryId = user.factoryId`.
   *   - Roles khác: full access.
   *
   * Throws:
   *   - 404 nếu code rỗng / không tìm thấy / không thuộc scope của role.
   */
  async getByProductionId(
    code: string,
    roleName?: RoleType,
    userId?: string,
    fulfillmentFactoryId?: string,
  ): Promise<{ success: true; data: unknown }> {
    const trimmed = (code ?? '').trim();
    if (!trimmed) throw new NotFoundException('Production ID rỗng.');

    // Exact match case-insensitive — anchor `^...$` để không match phần.
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doc = await this.orderModel
      .findOne({ productionId: { $regex: `^${escaped}$`, $options: 'i' } })
      .populate('factory', 'name shortName')
      .populate('machineType', 'name shortName')
      .populate('productConfig', 'fullName shortName')
      .lean();
    if (!doc) throw new NotFoundException('Không tìm thấy đơn với mã này.');

    if (roleName === RoleType.Designer) {
      if (!userId || (doc as { assignee?: string }).assignee !== userId) {
        throw new NotFoundException('Đơn không thuộc phạm vi của bạn.');
      }
    } else if (roleName === RoleType.Fulfillment) {
      const factoryId = (doc as { factoryId?: string }).factoryId;
      const originalFactoryId = (doc as { originalFactoryId?: string }).originalFactoryId;
      if (!fulfillmentFactoryId || (factoryId !== fulfillmentFactoryId && originalFactoryId !== fulfillmentFactoryId)) {
        throw new NotFoundException('Đơn không thuộc xưởng của bạn.');
      }
    }
    return { success: true, data: doc };
  }

  /**
   * Public API cho tool ngoài duyệt thiết kế (không qua JWT — xem
   * `@Auth([], [], { public: true })` ở controller), nhiều client gọi song
   * song để xử lý design. Trả về đúng 1 đơn đang ở "bước đầu tiên" của tiến
   * trình: CHƯA có Kết quả Tool (`toolResult` rỗng) VÀ CHƯA gán designer
   * (`designerStatus='unassigned'`) — loại đơn đã hủy/đang giữ VÀ đơn đang
   * trong lease claim của client khác. Sort `priority desc` rồi
   * `inProductionAt asc` (đơn nhập trước lấy trước cùng mức ưu tiên), fallback
   * `createdAt asc` cho đơn thiếu `inProductionAt`.
   *
   * LƯU Ý: dùng `toolResult` ("Kết quả Tool" — has-tool/no-tool), KHÔNG phải
   * `toolResultNote` ("Note kq Tool 1") — field đó giờ CHỈ nhân viên sửa tay,
   * ngoài luồng automation này.
   *
   * Chống trùng: `findOneAndUpdate` claim `designReviewClaimedAt = now` NGAY
   * trong cùng 1 lệnh atomic (filter + update chạy atomic per-document ở
   * Mongo) — 2 client gọi cùng lúc không bao giờ nhận trùng đơn dù không có
   * lock/Redis riêng. Hết lease (`DESIGN_REVIEW_CLAIM_LEASE_MS`) mà đơn vẫn
   * chưa có `toolResult` (client crash giữa chừng) → tự nhả lại, không cần
   * endpoint release. Tool gọi lại `POST /design-review/result` để đơn rời
   * hẳn khỏi hàng đợi này. Xem Orders.md §18.
   *
   * `remaining` = tổng số đơn còn cần xử lý (đúng điều kiện "bước đầu tiên" —
   * KHÔNG xét claim/lease, vì đơn đang bị claim tạm thời vẫn chưa xong việc)
   * — bao gồm cả đơn vừa trả về trong `data` (chỉ hết tính khi `toolResult`
   * được set qua `POST /design-review/result`). Count riêng — chạy song song
   * với `findOneAndUpdate` (`Promise.all`), không ảnh hưởng tính atomic của
   * claim.
   *
   * `dto.from`/`dto.to` (YYYY-MM-DD, optional) lọc theo `inProductionAt` (VN
   * tz) — cùng semantics `createdFrom`/`createdTo` ở danh sách đơn (Orders.md
   * §7.0b). Không truyền → không giới hạn ngày (hành vi cũ).
   */
  /**
   * Cấu hình sản phẩm của đơn, tra theo `order.type`. ORD-6 dùng chung một lần
   * đọc này cho `productCode` + cờ DTF + vị trí in + biến thể (trước đó chỉ đọc
   * mỗi `designReviewCode`).
   *
   * `productCode` cho tool duyệt thiết kế — đọc từ `ProductConfig.designReviewCode`
   * (PRD-2, trường RIÊNG; trước đó ORD-3 mượn `shortName` nên tên viết tắt của
   * người dùng bị coi là khoá kỹ thuật). Quy tắc khớp GIỮ NGUYÊN như map cũ:
   * `order.type` ↔ `fullName` exact, trim + case-insensitive. Không khớp sản
   * phẩm nào / mã trống → null (tool xử lý như "không khớp map" trước đây).
   *
   * Tên field `productCode` trong response KHÔNG đổi — tool ngoài đang đọc.
   */
  private async resolveDesignReviewProduct(type?: string | null): Promise<DesignReviewProductDoc | null> {
    const trimmed = type?.trim();
    if (!trimmed) return null;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (
      (await this.productConfigRepository.findOne<DesignReviewProductDoc>({
        fullName: { $regex: `^${escaped}$`, $options: 'i' },
      })) ?? null
    );
  }

  /** Map raw order doc (field cần cho design review) → `DesignReviewOrder`. Dùng chung bởi `getNextDesignReviewOrder`/`getDesignReviewOrderByProductionId`. */
  private async toDesignReviewOrder(doc: DesignReviewSourceDoc): Promise<DesignReviewOrder> {
    const product = await this.resolveDesignReviewProduct(doc.type);
    const productCode = product?.designReviewCode?.trim() || null;
    return {
      productionId: doc.productionId,
      orderId: doc.orderId,
      productCode,
      attributes: { size: doc.size, color: doc.color },
      designs: doc.designs ?? {},
      mockupUrl: doc.mockupUrl,
      inProductionAt: doc.inProductionAt ?? null,
      // ORD-6 — cấu hình sản phẩm là nguồn CHÍNH; quy ước cũ mã = TIFF giữ lại để
      // tool bản đang chạy ở xưởng (và các sản phẩm đang mang mã đó) không gãy.
      isDtf:
        product?.printMethod?.trim().toLowerCase() === DTF_PRINT_METHOD_CODE ||
        productCode?.toUpperCase() === LEGACY_DTF_PRODUCT_CODE,
      printAreas: OrderService.buildDesignReviewPrintAreas(product?.printArea, doc.designs, doc.size),
      variantSku: OrderService.resolveDesignReviewVariantSku(product?.variations, doc.size, doc.color),
    };
  }

  /**
   * ORD-6 — vị trí in + kích thước (cm) ứng với size của CHÍNH đơn này.
   *
   * Danh sách = HỢP của vị trí đã cấu hình ở sản phẩm và vị trí có mặt trong
   * `designs` của đơn, để tool thấy được cả ca "có file nhưng sản phẩm chưa cấu
   * hình vị trí đó". Ghép size: trim + không phân biệt hoa thường. KHÔNG khớp ⇒
   * kích thước null — tuyệt đối không lấy tạm size khác hay số mặc định, vì in
   * sai kích thước lên giấy tệ hơn nhiều so với việc tool dừng lại và báo lỗi.
   */
  private static buildDesignReviewPrintAreas(
    printArea: ProductPrintArea | undefined,
    designs: DesignFields | undefined,
    orderSize?: string,
  ): DesignReviewPrintArea[] {
    const norm = (v?: string | null): string => (v ?? '').trim().toLowerCase();
    const wantedSize = norm(orderSize);
    const configured = new Map((printArea ?? []).map((a) => [a.key as string, a]));
    const designKeys = Object.entries(designs ?? {})
      .filter(([, url]) => !!url)
      .map(([key]) => key);

    return [...new Set([...configured.keys(), ...designKeys])].map((key) => {
      const area = configured.get(key);
      const match = wantedSize ? (area?.sizeDimensions ?? []).find((d) => norm(d.size) === wantedSize) : undefined;
      return {
        key,
        label: PRODUCT_PRINT_AREA_LABEL_MAP[key as keyof typeof PRODUCT_PRINT_AREA_LABEL_MAP] ?? key,
        configured: !!area,
        widthCm: match?.widthCm ?? null,
        lengthCm: match?.lengthCm ?? null,
      };
    });
  }

  /**
   * ORD-6 — SKU biến thể khớp size + màu của đơn. Chỉ trả khi khớp DUY NHẤT một
   * biến thể; khớp nhiều hoặc không khớp → null. Đoán bừa ở đây nghĩa là dán
   * nhầm nhãn nhận diện lên kiện hàng.
   */
  private static resolveDesignReviewVariantSku(
    variations: ProductVariation[] | undefined,
    size?: string,
    color?: string,
  ): string | null {
    // Nhận diện nhãn size/màu đi qua `packages/shared/constants/variation-attribute.ts`
    // — CÙNG chỗ với bảng nhập kích thước ở trang sản phẩm (PRD-7). Chép luật ra
    // đây là cách chắc chắn nhất để hai bên lệch nhau mà không ai biết.
    const wantedSize = normalizeVariationText(size);
    const wantedColor = normalizeVariationText(color);
    if (!wantedSize && !wantedColor) return null;
    const sizeLabel = resolveVariationSizeLabel(variations);

    const hits = (variations ?? []).filter((v) => {
      const attrs = v.attributes ?? [];
      if (wantedSize) {
        const ok = attrs.some(
          (a) => normalizeVariationText(a.label) === sizeLabel && normalizeVariationText(a.value) === wantedSize,
        );
        if (!ok) return false;
      }
      if (wantedColor) {
        const ok = attrs.some((a) => isVariationColorLabel(a.label) && normalizeVariationText(a.value) === wantedColor);
        if (!ok) return false;
      }
      return true;
    });
    return hits.length === 1 ? (hits[0].sku ?? null) : null;
  }

  private static readonly DESIGN_REVIEW_PROJECTION = {
    productionId: 1,
    orderId: 1,
    type: 1,
    color: 1,
    size: 1,
    designs: 1,
    mockupUrl: 1,
    inProductionAt: 1,
  } as const;

  async getNextDesignReviewOrder(dto?: { from?: string; to?: string; pid?: string }): Promise<{
    success: true;
    data: DesignReviewOrder | null;
    remaining: number;
  }> {
    const excludedFactoryId = getExcludedFactoryIdSync(this.orderModel.db);
    const baseFilter: Record<string, unknown> = {
      deletedAt: { $exists: false },
      cancelledAt: { $exists: false },
      heldAt: { $exists: false },
      toolResult: { $in: [null, ''] },
      designerStatus: DesignerStatus.Unassigned,
      // Đơn xưởng US (ngoài luồng sản xuất) KHÔNG vào hàng đợi soát tool —
      // $ne vẫn cho đơn chưa map xưởng (factoryId null) vào queue như cũ.
      ...(excludedFactoryId ? { factoryId: { $ne: excludedFactoryId } } : {}),
    };
    if (dto?.from || dto?.to) {
      const range: Record<string, Date> = {};
      if (dto.from) range.$gte = vnDayStart(dto.from);
      if (dto.to) range.$lte = vnDayEnd(dto.to);
      baseFilter.inProductionAt = range;
    }

    // `pid` — ép lấy ĐÚNG 1 đơn theo productionId, BỎ QUA filter hàng đợi ở
    // trên (toolResult/designerStatus...), KHÔNG claim lease. Vẫn trả kèm
    // `remaining` của hàng đợi bình thường để tool không mất context.
    const pid = dto?.pid?.trim();
    if (pid) {
      const [byId, remaining] = await Promise.all([
        this.getDesignReviewOrderByProductionId(pid),
        this.orderModel.countDocuments(baseFilter),
      ]);
      return { success: true, data: byId.data, remaining };
    }

    const now = new Date();
    const leaseExpiresBefore = new Date(now.getTime() - DESIGN_REVIEW_CLAIM_LEASE_MS);

    const [doc, remaining] = await Promise.all([
      this.orderModel
        .findOneAndUpdate(
          {
            ...baseFilter,
            $or: [
              { designReviewClaimedAt: { $exists: false } },
              { designReviewClaimedAt: { $lt: leaseExpiresBefore } },
            ],
          },
          { $set: { designReviewClaimedAt: now } },
          {
            sort: { priority: -1, inProductionAt: 1, createdAt: 1 },
            projection: OrderService.DESIGN_REVIEW_PROJECTION,
            new: true,
          },
        )
        .lean(),
      this.orderModel.countDocuments(baseFilter),
    ]);

    if (!doc) return { success: true, data: null, remaining };

    return {
      success: true,
      data: await this.toDesignReviewOrder(doc as unknown as DesignReviewSourceDoc),
      remaining,
    };
  }

  /**
   * Lookup TRỰC TIẾP 1 đơn theo `productionId` cho tool soát design ngoài —
   * bổ sung cho `getNextDesignReviewOrder()` (lấy đơn TIẾP THEO theo hàng đợi).
   * KHÔNG áp filter hàng đợi (toolResult rỗng / designerStatus unassigned) —
   * trả về đơn ở BẤT KỲ trạng thái nào miễn khớp `productionId` (kể cả đã
   * soát/đã gán), phục vụ tra cứu/soát lại 1 đơn cụ thể. KHÔNG claim lease
   * (không set `designReviewClaimedAt`) vì đây là lookup, không phải lấy việc.
   */
  async getDesignReviewOrderByProductionId(productionId: string): Promise<{
    success: true;
    data: DesignReviewOrder | null;
  }> {
    const trimmed = (productionId ?? '').trim();
    if (!trimmed) return { success: true, data: null };

    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doc = await this.orderModel
      .findOne({ productionId: { $regex: `^${escaped}$`, $options: 'i' } }, OrderService.DESIGN_REVIEW_PROJECTION)
      .lean();

    if (!doc) return { success: true, data: null };

    return {
      success: true,
      data: await this.toDesignReviewOrder(doc as unknown as DesignReviewSourceDoc),
    };
  }

  /**
   * Public API cho tool ngoài lấy danh mục "File lỗi" (workshop_config
   * category=error_file_type, chỉ code active, sort theo `order`) để hiển thị
   * lựa chọn khi Note kq Tool 1 = 'error', rồi truyền `code` lại qua field
   * `errorFile` ở `setDesignReviewResult()`. Chỉ trả `code`/`name` — JSON tự
   * định nghĩa riêng cho luồng public này (KHÁC `WorkshopConfigZod` đầy đủ
   * dùng nội bộ, tránh lộ `color`/`icon`/`errorSource`... không cần thiết).
   */
  async getDesignReviewErrorFileOptions(): Promise<GetDesignReviewErrorFileOptionsResDto> {
    const rows = await this.workshopConfigRepository.findAll<{ code: string; name: string }>(
      { category: WorkshopConfigCategory.ErrorFileType, isActive: true },
      { sort: { order: 1 }, select: { code: 1, name: 1 } },
    );
    return { success: true, data: rows.map((r) => ({ code: r.code, name: r.name })) };
  }

  /**
   * Public API cho tool ngoài lưu Kết quả Tool (`toolResult`) sau khi xử lý
   * đơn lấy từ `getNextDesignReviewOrder()` — tương đương thao tác tay ở cột
   * "Kết quả Tool" (Danh sách đơn). Optional `toolResultNote` ("Note kq Tool
   * 1") — chỉ ghi khi tool truyền lên (KHÁC `undefined`, kể cả `null` để xoá);
   * không truyền → giữ hành vi cũ, KHÔNG đụng field này. Optional `errorFile`
   * ("File lỗi", code lấy từ `getDesignReviewErrorFileOptions()`) và
   * `errorFileNote` ("Ghi chú", free text) — cùng cơ chế optional như
   * `toolResultNote`, dùng khi `toolResultNote='error'` để ghi luôn nguyên
   * nhân + ghi chú lỗi file (BE không ép buộc theo `toolResultNote`, tool tự
   * quyết định truyền hay không). Optional `cuttingFileUrl` — Drive URL của
   * file cutting/"File in" (design đã duyệt), free text, KHÔNG qua
   * `updateField()`/`workshop_config` (không phải `OrderWorkshopField`, chỉ
   * set thẳng qua `findOneAndUpdate` giống `applyCuttingFiles()`) — cùng
   * cơ chế optional (`!== undefined`), KHÔNG có side-effect hook. Optional
   * `tempFileUrl` — Drive URL của file in tạm (.pdf hoặc file design) dùng
   * khi đơn đang bị lỗi (`toolResultNote='error'`), CÙNG cơ chế set thẳng
   * như `cuttingFileUrl` (gộp chung 1 lần `findOneAndUpdate` nếu cả 2 cùng
   * truyền), KHÁC `cuttingFileUrl` (file chính thức đã duyệt).
   *
   * Tra theo `productionId` — khóa duy nhất, luôn có (khác `orderId` = mã đơn
   * marketplace gốc, KHÔNG unique vì 1 đơn có thể nhiều line item).
   *
   * Tái dùng NGUYÊN VẸN `updateField()` — gọi TUẦN TỰ tối đa 4 lần:
   * `toolResult` trước (KHÔNG có side-effect hook), rồi `toolResultNote` nếu
   * có (CÓ side-effect hook — auto rework-back/fulfillment entry set + auto-gán
   * designer theo cấu hình xưởng nếu giá trị khác rỗng/'ok', xem nhánh
   * `dto.field === 'toolResultNote'` trong `updateField()`) — CÙNG cơ chế
   * 'ok' xưởng đánh tay ở Danh sách đơn/import rework, KHÔNG còn
   * `skipAutoAssign` riêng cho path này nữa (trước đây tool ngoài soát xong
   * KHÔNG tự gán designer, đơn nằm chờ Leader/Admin gán tay ở backlog "Cần
   * gán" — đã bỏ, xem `DesignerAutoAssign.md`), rồi `errorFile` nếu có, rồi
   * `errorFileNote` nếu có (2 field cuối KHÔNG có side-effect hook, chỉ field
   * đơn thuần), rồi `cuttingFileUrl`/`tempFileUrl` nếu có (gộp 1 lần set thẳng,
   * KHÔNG qua `assertCanEditField`/`assertValueAllowed`). Trả về kết quả của lần gọi/
   * update CUỐI CÙNG. Permission gate (`assertCanEditField`) bypass bằng role
   * giả `RoleType.SuperAdmin` (an toàn vì bên trong `updateField`, `roleName`
   * CHỈ đọc ở đúng chỗ đó, không ảnh hưởng nhánh business logic nào khác).
   * `assertValueAllowed` (value phải khớp code `workshop_config` category
   * tương ứng đang active — `errorFileNote` free text nên bỏ qua bước này) và
   * `assertNotHeld` vẫn chạy bình thường ở mỗi lần gọi `updateField()`.
   */
  async setDesignReviewResult(
    productionId: string,
    input: {
      toolResult: string | null;
      toolResultNote?: string | null;
      errorFile?: string[] | null;
      errorFileNote?: string | null;
      cuttingFileUrl?: string | null;
      tempFileUrl?: string | null;
    },
    ctx?: AuditContext,
  ): Promise<UpdateOrderFieldResDto> {
    const trimmed = (productionId ?? '').trim();
    if (!trimmed) throw new NotFoundException('Production ID rỗng.');

    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const order = await this.orderModel
      .findOne({ productionId: { $regex: `^${escaped}$`, $options: 'i' } }, { _id: 1 })
      .lean();
    if (!order) throw new NotFoundException('Không tìm thấy đơn với mã này.');
    const id = String((order as { _id: string })._id);

    let result = await this.updateField(id, { field: 'toolResult', value: input.toolResult }, RoleType.SuperAdmin, ctx);

    if (input.toolResultNote !== undefined) {
      result = await this.updateField(
        id,
        { field: 'toolResultNote', value: input.toolResultNote },
        RoleType.SuperAdmin,
        ctx,
      );
    }

    if (input.errorFile !== undefined) {
      result = await this.updateField(id, { field: 'errorFile', value: input.errorFile }, RoleType.SuperAdmin, ctx);
    }

    if (input.errorFileNote !== undefined) {
      result = await this.updateField(
        id,
        { field: 'errorFileNote', value: input.errorFileNote },
        RoleType.SuperAdmin,
        ctx,
      );
    }

    // cuttingFileUrl/tempFileUrl KHÔNG phải OrderWorkshopField — set thẳng qua
    // findOneAndUpdate giống applyCuttingFiles(), bỏ qua assertCanEditField/
    // assertValueAllowed (free text, không phải workshop_config code). Gộp
    // chung 1 lần update nếu cả 2 field cùng truyền.
    const directSet: Record<string, string | null> = {};
    if (input.cuttingFileUrl !== undefined) directSet.cuttingFileUrl = input.cuttingFileUrl || null;
    if (input.tempFileUrl !== undefined) directSet.tempFileUrl = input.tempFileUrl || null;
    if (Object.keys(directSet).length > 0) {
      const updated = await this.orderModel.findOneAndUpdate({ _id: id }, { $set: directSet }, { new: true });
      if (!updated) throw new NotFoundException('Order not found');
      result = { success: true, data: updated };
    }

    return result;
  }

  /**
   * Tra cứu VÒNG ĐỜI của 1 đơn theo productionId — cho strip gọn trên đầu
   * Dashboard. Trả về 9 chặng (Soát tool → Thiết kế → 7 fulfillment) với trạng
   * thái done/current/pending/error/rework của TỪNG chặng dựa trên các mốc đã có
   * trên đơn (toolResultNote/toolCheckedAt, designerStatus, currentFulfillmentStage
   * + fulfillmentStages, fulfillmentCompletedAt). Fulfillment khóa theo xưởng.
   */
  async getLifecycleTrack(
    code: string,
    roleName?: RoleType,
    fulfillmentFactoryId?: string,
  ): Promise<{ success: true; data: LifecycleTrack }> {
    const trimmed = (code ?? '').trim();
    if (!trimmed) throw new NotFoundException('Production ID rỗng.');

    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doc = await this.orderModel
      .findOne({ productionId: { $regex: `^${escaped}$`, $options: 'i' } })
      .select(
        'productionId userSku type toolResultNote toolCheckedAt designerStatus designerAssignedAt ' +
          'designerFirstStartedAt designerCompletedAt currentFulfillmentStage fulfillmentStages ' +
          'fulfillmentCompletedAt inProductionAt factoryId originalFactoryId',
      )
      .lean();
    if (!doc) throw new NotFoundException('Không tìm thấy đơn với mã này.');

    if (roleName === RoleType.Fulfillment) {
      const factoryId = (doc as { factoryId?: string }).factoryId;
      const originalFactoryId = (doc as { originalFactoryId?: string }).originalFactoryId;
      if (!fulfillmentFactoryId || (factoryId !== fulfillmentFactoryId && originalFactoryId !== fulfillmentFactoryId)) {
        throw new NotFoundException('Đơn không thuộc xưởng của bạn.');
      }
    }

    const d = doc as {
      productionId: string;
      userSku?: string;
      type?: string;
      toolResultNote?: string;
      toolCheckedAt?: Date;
      designerStatus?: DesignerStatus;
      designerAssignedAt?: Date;
      designerFirstStartedAt?: Date;
      designerCompletedAt?: Date;
      currentFulfillmentStage?: FulfillmentStage;
      fulfillmentStages?: Record<
        string,
        { status?: FulfillmentStageStatus; waitingAt?: Date; startedAt?: Date; completedAt?: Date }
      >;
      fulfillmentCompletedAt?: Date;
      inProductionAt?: Date;
    };

    const LABELS: Record<string, string> = {
      'tool-check': 'Soát tool',
      designer: 'Thiết kế',
      ...FULFILLMENT_STAGE_LABELS,
    };

    const toolEmpty = !d.toolResultNote;
    const toolError = d.toolResultNote === 'error';
    const completed = !!d.fulfillmentCompletedAt;

    // Chặng đơn đang đứng (0..8). Ưu tiên lỗi soát tool (support-hold) → về chặng 0.
    let currentIndex: number;
    if (completed)
      currentIndex = LIFECYCLE_STAGE_KEYS.length; // vượt chặng cuối → tất cả done
    else if (toolError) currentIndex = 0;
    else if (d.currentFulfillmentStage) currentIndex = 2 + FULFILLMENT_STAGE_ORDER[d.currentFulfillmentStage];
    else if (d.designerStatus && d.designerStatus !== DesignerStatus.Unassigned)
      currentIndex = d.designerStatus === DesignerStatus.Done ? 2 : 1;
    else if (toolEmpty) currentIndex = 0;
    else currentIndex = 1;

    const atFor = (key: string): Date | undefined => {
      if (key === 'tool-check') return d.toolCheckedAt;
      if (key === 'designer') return d.designerCompletedAt ?? d.designerFirstStartedAt ?? d.designerAssignedAt;
      const st = d.fulfillmentStages?.[key];
      return st?.completedAt ?? st?.startedAt ?? st?.waitingAt;
    };

    const stages: LifecycleTrackStage[] = LIFECYCLE_STAGE_KEYS.map((key, idx) => {
      let status: LifecycleTrackStatus;
      if (idx < currentIndex) status = 'done';
      else if (idx > currentIndex) status = 'pending';
      else {
        // Chặng hiện tại — overlay lỗi/rework từ state thực tế.
        status = 'current';
        if (key === 'tool-check' && toolError) status = 'error';
        else if (key === 'designer' && d.designerStatus === DesignerStatus.Rework) status = 'rework';
        else if (idx >= 2) {
          const st = d.fulfillmentStages?.[key];
          if (st?.status === FulfillmentStageStatus.Rework) status = 'rework';
        }
      }
      return { key, label: LABELS[key] ?? key, status, at: atFor(key) };
    });

    return {
      success: true,
      data: {
        productionId: d.productionId,
        userSku: d.userSku,
        type: d.type,
        inProductionAt: d.inProductionAt,
        fulfillmentCompletedAt: d.fulfillmentCompletedAt,
        currentStageKey: completed ? null : LIFECYCLE_STAGE_KEYS[currentIndex] ?? null,
        completed,
        stages,
      },
    };
  }

  /**
   * FE polling cho đơn đang xử lý design (R2 pipeline). Trả về subset field
   * mà status có thể thay đổi để FE patch row trong table mà không refetch full.
   */
  async checkPendingDesigns(
    ids: string[],
  ): Promise<Array<{ _id: string; designs?: Record<string, string>; designsStatus?: Record<string, string> }>> {
    if (!ids?.length) return [];
    const cleanIds = ids.filter((id) => /^[a-f0-9]{24}$/i.test(id)).slice(0, 200);
    if (!cleanIds.length) return [];
    const docs = await this.orderModel
      .find({ _id: { $in: cleanIds } }, { _id: 1, designs: 1, designsStatus: 1 })
      .lean();
    return docs.map((d) => ({
      _id: String(d._id),
      designs: d.designs as Record<string, string> | undefined,
      designsStatus: d.designsStatus as Record<string, string> | undefined,
    }));
  }

  async getLogs(orderId: string, dto: GetOrderLogsDto) {
    const result = await this.orderLogService.listByOrder(orderId, dto);

    // Log `assignee` lưu raw userId → resolve sang fullName để FE hiển thị tên
    // (chạy server-side nên đúng cho MỌI viewer, kể cả role không có quyền xem
    // danh sách designer team). Chỉ áp cho field=assignee.
    const ids = new Set<string>();
    for (const log of result.data as Array<Record<string, unknown>>) {
      if (log.field !== 'assignee') continue;
      if (typeof log.before === 'string' && log.before) ids.add(log.before);
      if (typeof log.after === 'string' && log.after) ids.add(log.after);
    }
    if (ids.size > 0) {
      const users = await this.userModel.find({ _id: { $in: Array.from(ids) } }, { _id: 1, fullName: 1 }).lean();
      const nameById = new Map(users.map((u) => [String(u._id), u.fullName]));
      for (const log of result.data as Array<Record<string, unknown>>) {
        if (log.field !== 'assignee') continue;
        if (typeof log.before === 'string' && nameById.has(log.before)) {
          log.before = nameById.get(log.before);
        }
        if (typeof log.after === 'string' && nameById.has(log.after)) {
          log.after = nameById.get(log.after);
        }
      }
    }

    return result;
  }

  /**
   * Trả về:
   *   - `designsOriginal` = URL raw user paste (luôn giữ).
   *   - `designs` = chỉ rỗng khi R2 active (worker BullMQ ghi sau khi xong);
   *                khi R2 chưa active → bằng URL gốc (no transform).
   *   - `designsStatus` = `'pending'` cho mọi field có URL khi R2 active.
   *   - `designJobs[]` = list job cần enqueue (caller gọi addBulk).
   */
  private processDesigns(input?: DesignFields): {
    designs?: DesignFields;
    designsOriginal?: DesignFields;
    designsStatus?: Record<string, 'pending'>;
    designJobs: Array<{ designKey: string; sourceUrl: string }>;
  } {
    if (!input) return { designJobs: [] };
    const original: DesignFields = {};
    const designsStatus: Record<string, 'pending'> = {};
    const designJobs: Array<{ designKey: string; sourceUrl: string }> = [];
    // [R2-disabled] tạm thời tắt pipeline R2 vì chậm trên VPS prod.
    // Restore: `const r2Enabled = this.designImageService.isEnabled();`
    const r2Enabled = false;
    let hasAny = false;
    for (const [k, v] of Object.entries(input)) {
      if (!v || typeof v !== 'string' || !v.trim()) continue;
      const raw = v.trim();
      original[k as keyof DesignFields] = raw;
      hasAny = true;
      if (r2Enabled) {
        designsStatus[k] = 'pending';
        designJobs.push({ designKey: k, sourceUrl: raw });
      }
    }
    if (!hasAny) return { designJobs: [] };
    // [R2-disabled] không log warn nữa khi tắt chủ động.
    return {
      designs: r2Enabled ? undefined : { ...original },
      designsOriginal: original,
      designsStatus: r2Enabled ? designsStatus : undefined,
      designJobs,
    };
  }

  async importOrders(dto: ImportProductionOrdersDto, ctx?: AuditContext): Promise<ImportProductionOrdersResDto> {
    const skipped: Array<{ row: number; reason: string }> = [];
    let imported = 0;
    let updated = 0;
    let mapped = 0;
    let unmapped = 0;
    const logRows: Array<
      | { orderId: string; action: 'create' | 'update'; after: Record<string, unknown> }
      | { orderId: string; field: string; before: unknown; after: unknown }
    > = [];
    /**
     * Dedup theo `${designKey}::${sourceUrl}` → 2 đơn cùng design URL chỉ enqueue 1 job.
     * Worker sẽ updateMany cho cả 2 sau khi xử lý xong.
     */
    const designJobMap = new Map<string, { designKey: string; sourceUrl: string; orderIds: Set<string> }>();
    /**
     * Vận đơn KHÁCH TỰ CẤP đi kèm dòng import (CSV admin / CSV khách / Public
     * Order API đều đổ về đây) — gom lại, ghi vào module vận đơn SAU vòng lặp
     * để một lỗi ghi vận đơn không làm hỏng việc tạo đơn.
     */
    const trackingEntries: ExternalTrackingInput[] = [];

    // Ưu tiên gán xưởng theo khách hàng (nếu config bật): map (userSku,userEmail)
    // → factoryId ép, override factory của product config. Đọc 1 lần trước loop.
    const customerOverride = await this.customerAssignmentService.getImportOverride();
    // Ưu tiên đơn theo khách hàng (nếu config bật): map (userSku,userEmail) →
    // OrderPriority auto-gán — CHỈ khi đơn chưa có priority (không đè chỉnh tay).
    const priorityOverride = await this.customerAssignmentService.getPriorityImportOverride();

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        if (!row.productionId?.trim()) {
          skipped.push({ row: i + 1, reason: 'Missing Production ID' });
          continue;
        }

        // Map by Type → ProductConfig.fullName (case-insensitive exact match)
        let isMapped = false;
        let productConfigId: string | undefined;
        let factoryId: string | undefined;
        let machineTypeId: string | undefined;
        let fabricType: string | undefined;
        let machineNumber: string | undefined;
        // PRD-8 — dòng sản phẩm: ưu tiên config đã map, không thì theo dòng khách gửi (staging đã stamp).
        let productLine: ProductLine | undefined = row.productLine;

        if (row.type?.trim()) {
          const pc = await this.productConfigRepository.findOne({
            fullName: { $regex: '^' + escapeRegex(row.type.trim()) + '$', $options: 'i' },
          });
          if (pc) {
            isMapped = true;
            productConfigId = pc._id;
            factoryId = pc.factoryId;
            machineTypeId = pc.machineTypeId;
            if (pc.productLine) productLine = pc.productLine;
            fabricType = pc.fabricType || undefined;
            // KHÔNG copy `toolResult` từ product config nữa — để trống lúc
            // import (API onospod lẫn CSV) để tool tự động soát có thể chạy
            // và tự set kết quả, thay vì bị default che mất đơn chưa soát.
            machineNumber = pc.machineNumber || undefined;
            mapped++;
          } else {
            unmapped++;
          }
        } else {
          unmapped++;
        }

        // Ưu tiên khách hàng: khớp cặp (userSku, userEmail) → ép factory, bỏ qua
        // factory của product config. Áp cả đơn chưa map product. Chỉ ép factoryId,
        // các field khác (machineType/fabric/toolResult/machineNumber) giữ nguyên.
        if (customerOverride.enabled) {
          const forced = customerOverride.map.get(customerMatchKey(row.userSku, row.userEmail));
          if (forced) factoryId = forced;
        }

        const forcedPriority = priorityOverride.enabled
          ? priorityOverride.map.get(customerMatchKey(row.userSku, row.userEmail))
          : undefined;

        const { designJobs, ...designData } = this.processDesigns(row.designs);
        const rowTracking = normalizeProductionOrderTracking(row.tracking);
        const parsedInProductionAt = parseImportDate(row.inProductionAt);

        const data = {
          productionId: row.productionId.trim(),
          userSku: row.userSku?.trim(),
          userEmail: row.userEmail?.trim(),
          type: row.type?.trim(),
          color: row.color?.trim(),
          size: row.size?.trim(),
          ...(() => {
            if (!row.mockupUrl) return {};
            const raw = row.mockupUrl.trim();
            return { mockupUrl: raw, mockupOriginalUrl: raw };
          })(),
          printMethod: row.printMethod?.trim(),
          productLine,
          weight: row.weight,
          width: row.width,
          height: row.height,
          length: row.length,
          quantity: row.quantity ?? 1,
          baseCost: row.baseCost,
          shipCost: row.shipCost,
          ...designData,
          status: row.status?.trim(),
          orderId: row.orderId?.trim(),
          externalId: row.externalId?.trim(),
          referent: row.referent?.trim(),
          orderAt: parseImportDate(row.orderAt),
          // Cột "In production at" để trống → KHÔNG set ở `$set` (re-import
          // không được xoá mốc thật), mốc mặc định đi qua `$setOnInsert` dưới.
          ...(parsedInProductionAt ? { inProductionAt: parsedInProductionAt } : {}),
          ...(row.shippingAddress ? { shippingAddress: row.shippingAddress } : {}),
          // Vận đơn khách tự cấp: CHỈ ghi khi dòng import thật sự có giá trị —
          // file lần sau không có cột tracking thì đừng xoá vận đơn đã nhận.
          ...(rowTracking ? { tracking: rowTracking } : {}),
          isMapped,
          productConfigId,
          factoryId,
          machineTypeId,
        };
        // Insert-only fields: fabric + machineNumber are *defaults* derived from
        // product config. If the workshop already overrode them on a previous
        // run, re-import shouldn't blow those edits away. `originalFactoryId`
        // is pinned for the same reason. `toolResult` KHÔNG nằm trong danh sách
        // này nữa — luôn để trống lúc tạo đơn mới, chờ tool tự động soát set.
        const insertOnly: Record<string, unknown> = { originalFactoryId: factoryId };
        // Xưởng "bỏ qua soát tool" (`FactoryEntity.skipToolCheck` — DTF Mê Linh,
        // FulfillmentWorkflow.md §2.2d): đơn MỚI coi như đã soát 'ok' ngay lúc
        // tạo → vào thẳng cột In chờ, không qua Support, không auto-gán designer
        // (ứng viên auto-gán loại đơn 'ok'). CHỈ nằm trong $setOnInsert nên
        // re-import KHÔNG reset đơn đang chạy giữa flow; xưởng US (ngoài luồng
        // sản xuất) không bao giờ được stamp dù có bật nhầm cờ.
        if (
          factoryId &&
          factoryId !== getExcludedFactoryIdSync(this.orderModel.db) &&
          getFactorySkipToolCheckSync(this.orderModel.db, factoryId)
        ) {
          Object.assign(insertOnly, {
            toolResultNote: READY_FOR_FULFILL_CODE,
            toolCheckedAt: new Date(),
            readyForFulfill: true,
            ...buildFulfillmentEntrySet(),
          });
        }
        // Đơn MỚI mà file không có "In production at" → mặc định = lúc import.
        // Thiếu mốc này đơn thành TÀNG HÌNH: mọi màn hình đơn lọc theo
        // `inProductionAt` nên đơn không lọt qua bất kỳ khoảng ngày nào —
        // không ai soát tool, không gán được designer, không vào fulfillment.
        // Cùng nguyên tắc với `pushToProduction` của Customer Portal.
        if (!parsedInProductionAt) insertOnly.inProductionAt = new Date();
        if (fabricType) insertOnly.fabricType = fabricType;
        if (machineNumber) insertOnly.machineNumber = machineNumber;

        // Atomic upsert by productionId — includes soft-deleted records.
        // Fetch `before` snapshot (chỉ các key mà `data` sẽ ghi đè) TRƯỚC
        // upsert — dùng để diff field lúc re-import (đơn đã tồn tại), ghi
        // order log khi phát hiện field bị ghi đè giá trị khác (vd `factoryId`
        // sau khi đã transfer tay, hoặc `designs` sau khi designer sửa tay —
        // xem comment ở khối map product config phía trên, KHÔNG bảo vệ các
        // field này khỏi bị re-import ghi đè, chỉ log lại để truy vết).
        const beforeDoc = await this.orderModel
          .findOne(
            { productionId: data.productionId },
            // `priority: 1` thêm ngoài keys của `data` — cần biết đơn cũ đã có
            // priority chưa để quyết định auto-gán bên dưới. `heldAt: 1` — đơn
            // đang giữ không bị ghi đè design; `holdReason: 1` — guard snapshot
            // địa chỉ của đơn giữ chờ sửa địa chỉ (cả hai xem ngay dưới).
            { ...Object.fromEntries(Object.keys(data).map((k) => [k, 1])), priority: 1, heldAt: 1, holdReason: 1 },
          )
          .lean();
        const existed = !!beforeDoc;
        // Đơn ĐANG GIỮ (mọi nguồn: nhân viên / đồng bộ OnosPod) → import lại KHÔNG
        // ghi đè `designs`/`designsOriginal`/`designsStatus` và không tạo design
        // job. `designsOriginal` là mốc so sánh của cron lấy ngược design (§9c) —
        // ghi đè là cron mất dấu khách đã sửa design. Các trường khác cập nhật như cũ.
        const heldBefore = !!(beforeDoc as { heldAt?: Date | null } | null)?.heldAt;
        if (heldBefore) {
          const d = data as Record<string, unknown>;
          delete d.designs;
          delete d.designsOriginal;
          delete d.designsStatus;
        }
        // Đơn đang GIỮ chờ khách sửa địa chỉ + đã có snapshot → KHÔNG cho
        // re-import (OnosPod hàng ngày) đè snapshot bằng địa chỉ hiện tại:
        // snapshot cũ chính là baseline để cron `recoverHeldOrders()` (§9c)
        // so với OnosPod phát hiện "khách ĐÃ đổi" → cập nhật + MỞ GIỮ. Đè ở
        // đây = baseline luôn bằng hiện tại, tín hiệu đổi bị nuốt, đơn giữ
        // vĩnh viễn. Đơn không giữ (hoặc giữ lý do khác) vẫn nhận địa chỉ
        // mới bình thường.
        if (
          (data as Record<string, unknown>).shippingAddress &&
          beforeDoc?.heldAt &&
          beforeDoc.holdReason === HOLD_REASON_WAITING_ADDRESS &&
          beforeDoc.shippingAddress
        ) {
          delete (data as Record<string, unknown>).shippingAddress;
        }
        // Ưu tiên đơn theo khách: chỉ gán khi đơn CHƯA có priority (đơn mới,
        // hoặc đơn cũ import lại mà chưa ai set) — thêm vào `data` TRƯỚC upsert
        // nên diff log bên dưới tự ghi lại thay đổi này.
        if (forcedPriority && beforeDoc?.priority == null) {
          (data as Record<string, unknown>).priority = forcedPriority;
        }
        const upserted = await this.orderModel.findOneAndUpdate(
          { productionId: data.productionId },
          { $set: data, $setOnInsert: { createdAt: new Date(), ...insertOnly } },
          { upsert: true, new: true },
        );
        if (existed) {
          updated++;
        } else {
          imported++;
        }
        if (upserted?._id) {
          const orderIdStr = String(upserted._id);
          if (rowTracking) {
            trackingEntries.push({
              orderId: orderIdStr,
              productionId: data.productionId,
              sellerOrderId: data.orderId,
              factoryId,
              tracking: rowTracking,
            });
          }
          // Gom design job sau khi đã có orderId thật. Dedup theo
          // (designKey, sourceUrl) — 2 đơn cùng URL chỉ tạo 1 job, worker
          // updateMany cho cả 2. Đơn đang giữ → không tạo job (design không ghi).
          for (const job of heldBefore ? [] : designJobs) {
            const key = `${job.designKey}::${job.sourceUrl}`;
            let entry = designJobMap.get(key);
            if (!entry) {
              entry = { designKey: job.designKey, sourceUrl: job.sourceUrl, orderIds: new Set() };
              designJobMap.set(key, entry);
            }
            entry.orderIds.add(orderIdStr);
          }
          if (existed && beforeDoc) {
            const b = beforeDoc as unknown as Record<string, unknown>;
            const a = data as unknown as Record<string, unknown>;
            for (const key of Object.keys(data)) {
              if (key === 'productionId') continue;
              const beforeVal = b[key] ?? null;
              const afterVal = a[key] ?? null;
              if (stableStringifyForDiff(beforeVal) !== stableStringifyForDiff(afterVal)) {
                logRows.push({ orderId: orderIdStr, field: key, before: beforeVal, after: afterVal });
              }
            }
          }
          logRows.push({
            orderId: orderIdStr,
            action: existed ? 'update' : 'create',
            after: { productionId: data.productionId, type: data.type, isMapped },
          });
        }
      } catch (error) {
        skipped.push({
          row: i + 1,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    void this.orderLogService.writeMany(
      logRows.map((r) =>
        'field' in r
          ? // Diff field bị re-import ghi đè giá trị khác (đơn đã tồn tại) —
            // cùng shape với updateField() nên FE timeline render được diff
            // before → after bình thường (fieldLabelFor/resolveDisplay).
            { orderId: r.orderId, action: 'import' as const, field: r.field, before: r.before, after: r.after, ctx }
          : {
              orderId: r.orderId,
              action: 'import' as const,
              // record the actual create/update inside the after payload so the
              // timeline shows whether this import inserted or updated a row.
              after: { ...r.after, _subAction: r.action },
              ctx,
            },
      ),
    );

    void this.invalidateListCache();

    // Enqueue design image jobs: thumb (ưu tiên cao) + preview (lần lượt, sau).
    // Fire-and-forget — không block import response. Khi R2 chưa active,
    // designJobMap luôn rỗng.
    if (designJobMap.size > 0) {
      const thumbJobs = Array.from(designJobMap.values()).map((entry) => ({
        name: `thumb-${entry.designKey}`,
        data: {
          sourceUrl: entry.sourceUrl,
          orderIds: Array.from(entry.orderIds),
          designKey: entry.designKey,
        } satisfies DesignImageJobData,
      }));
      const previewJobs = Array.from(designJobMap.values()).map((entry) => ({
        name: `preview-${entry.designKey}`,
        data: {
          sourceUrl: entry.sourceUrl,
          orderIds: Array.from(entry.orderIds),
          designKey: entry.designKey,
        } satisfies DesignImageJobData,
      }));
      void this.designThumbQueue.addBulk(thumbJobs).catch((err) => {
        console.error(`[design-thumb] addBulk failed (${thumbJobs.length} jobs):`, err);
      });
      void this.designPreviewQueue.addBulk(previewJobs).catch((err) => {
        console.error(`[design-preview] addBulk failed (${previewJobs.length} jobs):`, err);
      });
    }

    // Vận đơn khách tự cấp → module vận đơn (`shipping_packages` + `shipments`,
    // provider `customer`). Ghi SAU khi đơn đã vào DB để record trỏ được vào
    // `OrderEntity._id`, và bọc try/catch: đơn đã import xong rồi, hỏng khâu
    // ghi vận đơn không được phép biến cả lô import thành lỗi.
    if (trackingEntries.length > 0) {
      try {
        await this.shipmentIngestService.recordExternalTracking(trackingEntries, {
          userId: ctx?.user?._id ? String(ctx.user._id) : undefined,
          userName: ctx?.user?.fullName,
        });
      } catch (error) {
        this.logger.error({
          message: JSON.stringify({
            action: 'importOrders.recordExternalTracking',
            count: trackingEntries.length,
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      }
    }

    return { success: true, data: { imported, updated, mapped, unmapped, skipped } };
  }

  /**
   * Import file soát — UPDATE đơn hiện có theo `productionId`. Không tạo mới.
   *
   * Fields được update (chỉ khi cell có giá trị, ô trống giữ DB cũ):
   *  - `toolResultNote`  ← match workshop_config name (bỏ dấu lowercase)
   *  - `errorFile`       ← match workshop_config name (bỏ dấu lowercase)
   *  - `errorFileNote`   ← free text; nếu chứa "hủy đơn" → set cancelledAt + cancelReason
   *  - `assignee`        ← lookup User by fullName normalize → user._id;
   *                        đồng thời set designerStatus='assigned' + designerAssignedAt.
   *
   * Workshop_config / User không match → skip field đó, log warning, các field
   * khác trong row vẫn update bình thường (không reject cả row).
   */
  async importRework(dto: ImportReworkOrdersDto, ctx?: AuditContext): Promise<ImportReworkOrdersResDto> {
    const skipped: Array<{ row: number; reason: string }> = [];
    let updated = 0;
    let notFound = 0;
    let cancelled = 0;
    let assigneeMatched = 0;
    // Đơn vừa được set toolResultNote != 'ok' (soát tool xong) mà KHÔNG gán tay
    // trong sheet → ứng viên auto-gán designer theo cấu hình xưởng.
    const autoAssignCandidates: string[] = [];

    // Preload workshop_config + users để lookup nhanh.
    const [toolResultNoteCfgs, errorFileCfgs, allUsers] = await Promise.all([
      this.workshopConfigRepository.findAll({
        category: WorkshopConfigCategory.ToolResultNote,
        isActive: true,
      }),
      this.workshopConfigRepository.findAll({
        category: WorkshopConfigCategory.ErrorFileType,
        isActive: true,
      }),
      this.userModel.find({}, { fullName: 1 }).lean(),
    ]);
    const toolResultNoteMap = new Map(toolResultNoteCfgs.map((c) => [normalizeVN(c.name), c.code]));
    const errorFileMap = new Map(errorFileCfgs.map((c) => [normalizeVN(c.name), c.code]));
    const userByName = new Map(allUsers.map((u) => [normalizeVN(u.fullName || ''), String(u._id)]));

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      const rowNum = i + 1;
      const productionId = row.productionId?.trim();
      if (!productionId) {
        skipped.push({ row: rowNum, reason: 'Missing Production ID' });
        continue;
      }

      const order = await this.orderModel.findOne({ productionId }).lean();
      if (!order) {
        notFound += 1;
        skipped.push({ row: rowNum, reason: `Production ID không tồn tại: ${productionId}` });
        continue;
      }

      const $set: Record<string, unknown> = {};
      const warnings: string[] = [];

      // 1. toolResultNote
      if (row.toolResultNote?.trim()) {
        const key = normalizeVN(row.toolResultNote);
        const code = toolResultNoteMap.get(key);
        if (code) {
          $set.toolResultNote = code;
          // Mốc soát tool — set lần đầu (đơn chưa có toolCheckedAt).
          if (!order.toolCheckedAt) $set.toolCheckedAt = new Date();
          // Entry point fulfillment thứ 2 (import variant) — match `updateField`
          // semantics: code='ok' + đơn chưa vào fulfillment → đẩy vào stage Print.
          // Cũng set readyForFulfill/productionFirstErrorAt cho khớp.
          if (code === READY_FOR_FULFILL_CODE) {
            $set.readyForFulfill = true;
            $set.productionFirstErrorAt = null;
            // Loại đơn đã hoàn thành (stage=null NHƯNG fulfillmentCompletedAt có)
            // — re-init sẽ kéo đơn xong về print/waiting. Đơn xưởng US (ngoài
            // luồng sản xuất) không vào fulfillment.
            const usFactoryId = getExcludedFactoryIdSync(this.orderModel.db);
            const isExcludedFactory = !!usFactoryId && order.factoryId === usFactoryId;
            if (!order.currentFulfillmentStage && !order.fulfillmentCompletedAt && !isExcludedFactory) {
              Object.assign($set, buildFulfillmentEntrySet());
            }
          }
        } else {
          warnings.push(`Note_kq_Tool="${row.toolResultNote}" không match workshop_config`);
        }
      }

      // 2. errorFile — sheet hiện chỉ có 1 giá trị/cell, wrap thành array để
      // khớp schema mới (multi-select). Future: nếu sheet cho phép multi thì
      // split CSV ở đây.
      if (row.errorFile?.trim()) {
        const key = normalizeVN(row.errorFile);
        const code = errorFileMap.get(key);
        if (code) $set.errorFile = [code];
        else warnings.push(`File_sua_loi="${row.errorFile}" không match workshop_config`);
      }

      // 3. errorFileNote + cancel detection
      if (row.errorFileNote?.trim()) {
        const noteRaw = row.errorFileNote.trim();
        $set.errorFileNote = noteRaw;
        if (normalizeVN(noteRaw).includes('huy don')) {
          $set.cancelledAt = new Date();
          $set.cancelReason = noteRaw;
          cancelled += 1;
        }
      }

      // 4. assignee (gán designer)
      if (row.assignee?.trim()) {
        const key = normalizeVN(row.assignee);
        const userId = userByName.get(key);
        if (userId) {
          $set.assignee = userId;
          $set.designerStatus = DesignerStatus.Assigned;
          $set.designerAssignedAt = new Date();
          assigneeMatched += 1;
        } else {
          warnings.push(`Nguoi_thuc_hien="${row.assignee}" không match user trong DB`);
        }
      }

      if (Object.keys($set).length === 0) {
        skipped.push({
          row: rowNum,
          reason: warnings.length ? warnings.join('; ') : 'Không có field hợp lệ để update',
        });
        continue;
      }

      const reworkUpdate: Record<string, unknown> = { $set };
      // Import kq soát đánh note lỗi (≠ ok) → ghi lịch sử soát lỗi bền vững —
      // mirror nhánh field='toolResultNote' của `updateField` (trước đây path
      // import bị bỏ sót → thống kê "Soát lỗi" thiếu đơn soát qua file).
      if (
        typeof $set.toolResultNote === 'string' &&
        $set.toolResultNote.trim() &&
        $set.toolResultNote !== READY_FOR_FULFILL_CODE
      ) {
        reworkUpdate.$addToSet = { toolCheckErrorNotes: $set.toolResultNote };
      }
      await this.orderModel.updateOne({ _id: order._id }, reworkUpdate);
      updated += 1;

      // Ứng viên auto-gán: soát tool xong ĐÚNG lỗi thiết kế (toolResultNote ===
      // 'error' — các mã khác != 'ok' như 'no-tool'/'no-pdf' KHÔNG tính), KHÔNG
      // gán tay trong sheet, đơn đã có xưởng & chưa ai ôm. Engine xác minh lại trên DB.
      if (
        $set.toolResultNote === TOOL_CHECK_ERROR_CODE &&
        !$set.assignee &&
        order.factoryId &&
        (!order.designerStatus || order.designerStatus === DesignerStatus.Unassigned) &&
        !order.assignee
      ) {
        autoAssignCandidates.push(String(order._id));
      }

      if (warnings.length) {
        // Logger config dùng custom level "activity" trên prod → .warn không exist.
        // Dùng .info (luôn tồn tại) + prefix [WARN] để filter log dễ.
        this.logger.info({
          message: `[import-rework][WARN] row ${rowNum} (${productionId}): ${warnings.join('; ')}`,
        });
      }

      // Audit log — dùng action 'bulk_update' vì 1 row có thể đụng nhiều field.
      void this.orderLogService.write({
        orderId: String(order._id),
        action: 'bulk_update',
        field: 'import_rework',
        before: {
          toolResultNote: order.toolResultNote,
          errorFile: order.errorFile,
          errorFileNote: order.errorFileNote,
          assignee: order.assignee,
          cancelledAt: order.cancelledAt,
        },
        after: $set,
        ctx,
      });
    }

    void this.invalidateListCache();

    // Auto-gán designer theo cấu hình xưởng cho đơn vừa soát tool xong (fire-and-forget).
    void this.autoAssignAfterImport(autoAssignCandidates, ctx);

    this.logger.info({
      message: `[import-rework] done: updated=${updated} notFound=${notFound} cancelled=${cancelled} assigneeMatched=${assigneeMatched} skipped=${skipped.length}`,
    });

    return {
      success: true,
      data: { updated, notFound, cancelled, assigneeMatched, skipped },
    };
  }

  /**
   * Pre-flight check cho bulk assign designer — không update DB, trả stats
   * để FE confirm. Đếm theo `designerStatus` hiện tại và group đơn đã gán
   * cho ai.
   */
  async bulkAssignDesignerPreview(dto: BulkAssignDesignerPreviewDto): Promise<BulkAssignDesignerPreviewResDto> {
    const docs = await this.orderModel
      .find({ _id: { $in: dto.ids } }, { _id: 1, productionId: 1, assignee: 1, designerStatus: 1, toolResultNote: 1 })
      .lean();

    const byStatus = {
      unassigned: 0,
      assigned: 0,
      inProgress: 0,
      done: 0,
      rejected: 0,
      rework: 0,
    };
    const assigneeCounts = new Map<string, number>();
    let blocked = 0;
    let okCount = 0;
    let noToolCount = 0;
    let reworkHeldCount = 0;
    let eligible = 0;
    let eligibleWithTool = 0;

    for (const o of docs) {
      const status =
        ((o as { designerStatus?: DesignerStatus }).designerStatus as DesignerStatus) || DesignerStatus.Unassigned;
      const note = (o as { toolResultNote?: string }).toolResultNote;
      const assigneeVal = (o as { assignee?: string }).assignee;
      const hasAssignee = !!assigneeVal;
      const isOk = note === READY_FOR_FULFILL_CODE;
      const isUnreviewed = note == null || note === ''; // chưa soát
      const isReworkHeld = status === DesignerStatus.Rework && hasAssignee;
      if (isOk) okCount++;
      if (isUnreviewed) noToolCount++;
      if (isReworkHeld) reworkHeldCount++;
      switch (status) {
        case DesignerStatus.Unassigned:
          byStatus.unassigned++;
          break;
        case DesignerStatus.Assigned:
          byStatus.assigned++;
          break;
        case DesignerStatus.InProgress:
          byStatus.inProgress++;
          break;
        case DesignerStatus.Done:
          byStatus.done++;
          break;
        case DesignerStatus.Rejected:
          byStatus.rejected++;
          break;
        case DesignerStatus.Rework:
          byStatus.rework++;
          break;
      }
      // Phân loại:
      //  - canAssign (status cho phép) VÀ chưa 'ok' → eligible.
      //  - rework đang có người ôm → reworkHeldCount (đếm riêng, banner riêng).
      //  - còn lại không gán được (in-progress/done) → blocked.
      const canAssign = this.canAssignDesignerByStatus(status, hasAssignee);
      if (canAssign && !isOk) {
        eligible++;
        if (!isUnreviewed) eligibleWithTool++;
        // Conflict/override chỉ tính trên đơn eligible đang gán cho người khác
        // (rework-held KHÔNG eligible nên không vào đây).
        if (assigneeVal) assigneeCounts.set(assigneeVal, (assigneeCounts.get(assigneeVal) || 0) + 1);
      } else if (!isReworkHeld) {
        blocked++; // in-progress/done (rework-held đã đếm riêng)
      }
    }

    // Resolve fullName từ users collection.
    const userIds = [...assigneeCounts.keys()];
    const nameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await this.userModel.find({ _id: { $in: userIds } }, { _id: 1, fullName: 1 }).lean();
      for (const u of users) {
        nameMap.set(String(u._id), u.fullName);
      }
    }

    const alreadyAssigned = [...assigneeCounts.entries()]
      .map(([userId, count]) => ({
        userId,
        fullName: nameMap.get(userId),
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      success: true,
      data: {
        total: docs.length,
        byStatus,
        alreadyAssigned,
        blockedCount: blocked,
        reworkHeldCount,
        okCount,
        noToolCount,
        eligibleCount: eligible,
        eligibleWithToolCount: eligibleWithTool,
      },
    };
  }

  /**
   * Apply bulk assign designer. Skip orders đang in-progress/done/rework +
   * trả về detail list để FE thông báo. Khi `reassignOthers=false`, BE thêm
   * skip cho đơn đã assign cho người khác (FE confirm rồi gửi true).
   */
  async bulkAssignDesigner(
    dto: BulkAssignDesignerDto,
    roleName?: RoleType,
    ctx?: AuditContext,
    permissionCodes?: string[],
  ): Promise<BulkAssignDesignerResDto> {
    this.assertCanEditField('assignee', roleName, permissionCodes);
    await this.assertAssigneeUserValid(dto.userId);

    const docs = await this.orderModel
      .find(
        { _id: { $in: dto.ids }, deletedAt: { $exists: false } },
        { _id: 1, productionId: 1, assignee: 1, designerStatus: 1, toolResultNote: 1 },
      )
      .lean();

    const skipped: { orderId: string; productionId: string; reason: string }[] = [];
    const eligibleIds: string[] = [];

    for (const o of docs) {
      const orderId = String(o._id);
      const productionId = String((o as { productionId?: string }).productionId || orderId);
      const status =
        ((o as { designerStatus?: DesignerStatus }).designerStatus as DesignerStatus) || DesignerStatus.Unassigned;
      const currentAssignee = (o as { assignee?: string }).assignee;

      const note = (o as { toolResultNote?: string }).toolResultNote;
      // Đơn đã soát 'ok' (Note kq Tool 1) → KHÔNG gán designer nữa.
      if (note === READY_FOR_FULFILL_CODE) {
        skipped.push({
          orderId,
          productionId,
          reason: `Note kq Tool 1 đã 'ok' — không cần gán designer.`,
        });
        continue;
      }
      // Nút "Chỉ gán đơn đã soát" → bỏ qua đơn chưa soát (note rỗng).
      if (dto.skipUnreviewed && (note == null || note === '')) {
        skipped.push({
          orderId,
          productionId,
          reason: `Đơn chưa soát (Note kq Tool 1 trống) — đã chọn chỉ gán đơn đã soát.`,
        });
        continue;
      }
      // Đơn cần làm lại ĐANG có người ôm → KHÔNG gán cho người khác (kể cả ghi
      // đè). Chỉ gán được đơn rework chưa có ai ôm.
      if (status === DesignerStatus.Rework && currentAssignee) {
        skipped.push({
          orderId,
          productionId,
          reason: `Cần làm lại đang có người ôm — chỉ gán được đơn chưa có ai ôm.`,
        });
        continue;
      }
      if (!this.canAssignDesignerByStatus(status, !!currentAssignee)) {
        skipped.push({
          orderId,
          productionId,
          reason: `Đang '${status}' — không thể reassign. Yêu cầu designer hoàn thành trước.`,
        });
        continue;
      }
      if (currentAssignee && currentAssignee !== dto.userId && !dto.reassignOthers) {
        skipped.push({
          orderId,
          productionId,
          reason: `Đã gán cho designer khác — bật "Ghi đè" nếu muốn assign lại.`,
        });
        continue;
      }
      eligibleIds.push(orderId);
    }

    let modified = 0;
    if (eligibleIds.length > 0) {
      const patch: Record<string, unknown> = {
        assignee: dto.userId,
        designerStatus: DesignerStatus.Assigned,
        designerAssignedAt: new Date(),
        designerRejectedReason: null,
        designerRejectedAt: null,
      };
      const result = await this.orderModel.updateMany({ _id: { $in: eligibleIds } }, { $set: patch });
      modified = result.modifiedCount || 0;

      void this.orderLogService.writeMany(
        eligibleIds.map((orderId) => ({
          orderId,
          action: 'bulk_update' as const,
          field: 'assignee',
          before: null,
          after: dto.userId,
          ctx,
        })),
      );

      void this.invalidateListCache();
    }

    return {
      success: true,
      data: {
        matched: docs.length,
        modified,
        skipped,
      },
    };
  }

  /**
   * Designer TỰ NHẬN (self-claim) N đơn từ pool "cần gán" về CHÍNH MÌNH.
   *
   * Khác `bulkAssignDesigner`:
   *  - `assignee` luôn = người gọi (`ctx.user`), không nhận userId từ ngoài.
   *  - Chỉ nhận đơn "chưa ai ôm" — tức đang ở pool: designerStatus ∈
   *    {unassigned, rejected} hoặc (rework & chưa có ai ôm). KHÔNG bao giờ cướp
   *    đơn người khác đang làm (assigned/in-progress) hay đã xong.
   *    (Đơn `rejected` vẫn còn `assignee` cũ của người đã trả lại — vẫn tính là
   *    chưa ai ôm nên nhận được, ghi đè assignee sang người nhận.)
   *  - Không cần quyền edit field 'assignee' (đây là quyền tự thân của designer,
   *    chặn ở controller theo role Designer/Leader).
   *
   * Ghi `orderLog` (field 'assignee', ctx.user = người nhận + thời điểm) để biết
   * AI nhận, NHẬN LÚC NÀO.
   */
  async claimDesignerTasks(ids: string[], ctx: AuditContext): Promise<BulkAssignDesignerResDto> {
    const userId = String(ctx.user?._id || '');

    const docs = await this.orderModel
      .find(
        { _id: { $in: ids }, deletedAt: { $exists: false } },
        { _id: 1, productionId: 1, assignee: 1, designerStatus: 1, toolResultNote: 1 },
      )
      .lean();

    const skipped: { orderId: string; productionId: string; reason: string }[] = [];
    const eligibleIds: string[] = [];

    for (const o of docs) {
      const orderId = String(o._id);
      const productionId = String((o as { productionId?: string }).productionId || orderId);
      const status =
        ((o as { designerStatus?: DesignerStatus }).designerStatus as DesignerStatus) || DesignerStatus.Unassigned;
      const currentAssignee = (o as { assignee?: string }).assignee;
      const note = (o as { toolResultNote?: string }).toolResultNote;

      if (note === READY_FOR_FULFILL_CODE) {
        skipped.push({
          orderId,
          productionId,
          reason: `Note kq Tool 1 đã 'ok' — không cần designer.`,
        });
        continue;
      }
      // Pool "chưa ai ôm" = unassigned / rejected (người cũ đã trả lại) / rework
      // chưa có ai ôm. Các trạng thái còn lại (assigned/in-progress/done, rework
      // đang có người ôm) → đang có người làm hoặc đã xong, không nhận được.
      const claimable =
        status === DesignerStatus.Unassigned ||
        status === DesignerStatus.Rejected ||
        (status === DesignerStatus.Rework && !currentAssignee);
      if (!claimable) {
        skipped.push({
          orderId,
          productionId,
          reason:
            status === DesignerStatus.Rework
              ? `Đơn làm lại đang có người ôm — không nhận được.`
              : `Đơn đang có người làm hoặc đã xong — không nhận được.`,
        });
        continue;
      }
      eligibleIds.push(orderId);
    }

    let modified = 0;
    if (eligibleIds.length > 0) {
      const patch: Record<string, unknown> = {
        assignee: userId,
        designerStatus: DesignerStatus.Assigned,
        designerAssignedAt: new Date(),
        designerRejectedReason: null,
        designerRejectedAt: null,
      };
      // Guard race: chỉ nhận đơn còn ở pool status. Nếu người khác vừa nhận
      // trước (status → assigned), filter không khớp → không cướp.
      const result = await this.orderModel.updateMany(
        {
          _id: { $in: eligibleIds },
          designerStatus: {
            $in: [DesignerStatus.Unassigned, DesignerStatus.Rejected, DesignerStatus.Rework],
          },
        },
        { $set: patch },
      );
      modified = result.modifiedCount || 0;

      void this.orderLogService.writeMany(
        eligibleIds.map((orderId) => ({
          orderId,
          action: 'bulk_update' as const,
          field: 'assignee',
          before: null,
          after: userId,
          ctx,
        })),
      );

      void this.invalidateListCache();
    }

    return {
      success: true,
      data: {
        matched: docs.length,
        modified,
        skipped,
      },
    };
  }

  /**
   * Designer breakdown summary cho trang /orders (Admin/Leader). Trả về:
   *   - `scoped`: KPI count theo filter hiện tại
   *   - `overall`: KPI count toàn bộ (ignore filter) — dùng làm baseline
   *   - `perDesigner`: matrix mỗi user × 6 status (chỉ trong scope filter)
   *
   * Sub-designer KHÔNG được gọi endpoint này (auth ở controller).
   */
  async getDesignerBreakdown(
    dto: GetProductionOrdersDto,
    roleName?: RoleType,
    fulfillmentFactoryId?: string,
  ): Promise<DesignerBreakdownResDto> {
    // Scoped match — áp đầy đủ filter của list.
    const scopedFilter = this.buildOrderListFilter(dto, roleName, undefined, fulfillmentFactoryId);
    // Overall match — bỏ tất cả workshop filter, giữ visibility (date) cho nhất quán.
    const overallFilter = this.buildVisibilityFilter(
      roleName,
      { createdFrom: dto.createdFrom, createdTo: dto.createdTo } as GetProductionOrdersDto,
      undefined,
      fulfillmentFactoryId,
    );
    // Loại đơn hủy khỏi ma trận KPI per-designer (cả scoped + overall).
    scopedFilter.cancelledAt = { $exists: false };
    overallFilter.cancelledAt = { $exists: false };

    // "Chưa gán" panel = "Chưa gán KHÔNG tool": chỉ đếm đơn chưa gán & note≠'ok'
    // & toolResult KHÔNG "Có tool" (name ^Có). Đơn 'ok' hoặc "có tool" chưa gán →
    // bỏ khỏi bucket (rớt cả unassigned + total). Cần toolHasCodes để phân loại.
    const toolHasCodes = await this.resolveToolHasCodes();

    const countByStatus = async (match: Record<string, unknown>): Promise<DesignerStatusCounts> => {
      const agg = await this.orderModel.aggregate<{ _id: string | null; count: number }>([
        { $match: match },
        {
          $group: {
            // Đơn CHƯA GÁN (designerStatus unassigned/null), tách 3 nhánh theo tool:
            //  - note='ok' → `__skip_unassigned__` (BỎ QUA hẳn, đơn 'ok' không cần designer).
            //  - "có tool" (toolResult ∈ toolHasCodes) → `__unassigned_withtool__` (N):
            //    chỉ cộng vào `unassignedAll`, KHÔNG vào `unassigned`/`total`.
            //  - còn lại (không tool) → `unassigned` (M): vào cả unassigned + unassignedAll + total.
            // Đơn ĐÃ gán (status khác unassigned) KHÔNG bị ảnh hưởng.
            _id: {
              $let: {
                vars: { ds: { $ifNull: ['$designerStatus', 'unassigned'] } },
                in: {
                  $cond: [
                    { $ne: ['$$ds', 'unassigned'] },
                    '$$ds',
                    {
                      $cond: [
                        { $eq: ['$toolResultNote', 'ok'] },
                        '__skip_unassigned__',
                        {
                          $cond: [{ $in: ['$toolResult', toolHasCodes] }, '__unassigned_withtool__', 'unassigned'],
                        },
                      ],
                    },
                  ],
                },
              },
            },
            count: { $sum: 1 },
          },
        },
      ]);
      const out: DesignerStatusCounts = {
        unassigned: 0,
        unassignedAll: 0,
        assigned: 0,
        inProgress: 0,
        done: 0,
        rejected: 0,
        rework: 0,
        total: 0,
      };
      for (const r of agg) {
        const k = r._id || 'unassigned';
        if (k === '__skip_unassigned__') continue; // đơn 'ok' chưa gán — bỏ hẳn
        if (k === '__unassigned_withtool__') {
          out.unassignedAll += r.count; // N: chỉ vào tổng chưa gán
          continue;
        }
        switch (k) {
          case 'unassigned':
            out.unassigned += r.count; // M: không tool
            out.unassignedAll += r.count; // M cũng vào tổng chưa gán
            break;
          case 'assigned':
            out.assigned += r.count;
            break;
          case 'in-progress':
            out.inProgress += r.count;
            break;
          case 'done':
            out.done += r.count;
            break;
          case 'rejected':
            out.rejected += r.count;
            break;
          case 'rework':
            out.rework += r.count;
            break;
        }
        out.total += r.count;
      }
      return out;
    };

    const [scoped, overall] = await Promise.all([countByStatus(scopedFilter), countByStatus(overallFilter)]);

    // Per-designer matrix — group (assignee, designerStatus) trong scope filter.
    const matrixAgg = await this.orderModel.aggregate<{
      _id: { uid: string | null; status: string | null };
      count: number;
    }>([
      { $match: scopedFilter },
      {
        $group: {
          _id: {
            uid: { $ifNull: ['$assignee', null] },
            // Cùng logic countByStatus 3 nhánh: unassigned → ok=`__skip_unassigned__`
            // (bỏ), có-tool=`__unassigned_withtool__` (chỉ unassignedAll), không-tool
            // =`unassigned` (M). Nhất quán KPI.
            status: {
              $let: {
                vars: { ds: { $ifNull: ['$designerStatus', 'unassigned'] } },
                in: {
                  $cond: [
                    { $ne: ['$$ds', 'unassigned'] },
                    '$$ds',
                    {
                      $cond: [
                        { $eq: ['$toolResultNote', 'ok'] },
                        '__skip_unassigned__',
                        {
                          $cond: [{ $in: ['$toolResult', toolHasCodes] }, '__unassigned_withtool__', 'unassigned'],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Auto-include designer users (role=Designer) chưa có task nào → row count 0.
    // CHỈ designer ĐANG BẬT (status active) — thống kê loại người đã tắt (kể cả
    // lịch sử). Xem người đã tắt qua bộ lọc "Đã tắt" ở trang Team Designer.
    const designerRole = await this.roleRepository.findOne({ name: RoleType.Designer });
    const teamUsers = designerRole
      ? await this.userModel
          .find({ roleId: designerRole._id, status: Status.Active }, { _id: 1, fullName: 1, email: 1 })
          .lean()
      : [];
    const activeIds = new Set(teamUsers.map((u) => String(u._id)));

    const userIds = new Set<string>();
    let hasUnassigned = false;
    for (const r of matrixAgg) {
      // Matrix chỉ hiện "không tool" (M); ok + có-tool chưa gán không lên matrix.
      if (r._id.status === '__skip_unassigned__' || r._id.status === '__unassigned_withtool__') continue;
      // Loại đơn của designer đã tắt khỏi matrix (chỉ thống kê người active).
      if (r._id.uid) {
        if (activeIds.has(r._id.uid)) userIds.add(r._id.uid);
      } else hasUnassigned = true;
    }
    for (const u of teamUsers) userIds.add(String(u._id));

    const userMap = new Map<string, { fullName: string; email?: string }>();
    for (const u of teamUsers) userMap.set(String(u._id), { fullName: u.fullName, email: u.email });

    const blankCounts = (): DesignerStatusCounts => ({
      unassigned: 0,
      unassignedAll: 0,
      assigned: 0,
      inProgress: 0,
      done: 0,
      rejected: 0,
      rework: 0,
      total: 0,
    });

    const rows = new Map<string, { userId: string; fullName: string; email?: string; counts: DesignerStatusCounts }>();
    for (const uid of userIds) {
      const u = userMap.get(uid);
      rows.set(uid, {
        userId: uid,
        fullName: u?.fullName || `#${uid.slice(-4)}`,
        email: u?.email,
        counts: blankCounts(),
      });
    }
    if (hasUnassigned) {
      rows.set('__unassigned__', {
        userId: '__unassigned__',
        fullName: 'Chưa gán',
        counts: blankCounts(),
      });
    }

    for (const r of matrixAgg) {
      const s = r._id.status || 'unassigned';
      if (s === '__skip_unassigned__' || s === '__unassigned_withtool__') continue; // matrix chỉ M
      const key = r._id.uid || '__unassigned__';
      const row = rows.get(key);
      if (!row) continue;
      row.counts.total += r.count;
      switch (s) {
        case 'unassigned':
          row.counts.unassigned += r.count;
          break;
        case 'assigned':
          row.counts.assigned += r.count;
          break;
        case 'in-progress':
          row.counts.inProgress += r.count;
          break;
        case 'done':
          row.counts.done += r.count;
          break;
        case 'rejected':
          row.counts.rejected += r.count;
          break;
        case 'rework':
          row.counts.rework += r.count;
          break;
      }
    }

    const perDesigner = [...rows.values()].sort((a, b) => b.counts.total - a.counts.total);

    return {
      success: true,
      data: { scoped, overall, perDesigner },
    };
  }

  /**
   * Backlog tồn đọng theo Designer × Ngày vào sản xuất (`inProductionAt`).
   * Đơn CHƯA `done` (gồm unassigned + rejected), MỌI ngày (không filter date —
   * backlog cần thấy đơn cũ). Trả cây designer → days[] với counts per status.
   * FE modal hiện counts; click ngày → drill bảng (assignee + date) để xem task.
   */
  async getDesignerBacklog(roleName?: RoleType, fulfillmentFactoryId?: string): Promise<DesignerBacklogResDto> {
    const base = this.buildVisibilityFilter(roleName, {} as GetProductionOrdersDto, undefined, fulfillmentFactoryId);
    const match: Record<string, unknown> = {
      ...base,
      cancelledAt: { $exists: false },
      // $nin cũng match doc thiếu field (= unassigned). "Không làm được"
      // (Rejected) KHÔNG tính là tồn — nằm ở backlog "Cần gán" để leader gán lại.
      designerStatus: { $nin: [DesignerStatus.Done, DesignerStatus.Rejected] },
    };

    const agg = await this.orderModel.aggregate<{
      _id: { assignee: string; day: string; status: string };
      count: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: {
            assignee: { $ifNull: ['$assignee', '__unassigned__'] },
            day: {
              $cond: [
                { $ifNull: ['$inProductionAt', false] },
                { $dateToString: { format: '%Y-%m-%d', date: '$inProductionAt', timezone: '+07:00' } },
                '__nodate__',
              ],
            },
            status: { $ifNull: ['$designerStatus', DesignerStatus.Unassigned] },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    type DayAcc = {
      day: string;
      total: number;
      byStatus: { unassigned: number; assigned: number; inProgress: number; rework: number };
    };
    type RowAcc = { userId: string; total: number; days: Map<string, DayAcc> };
    const rows = new Map<string, RowAcc>();
    let grandTotal = 0;

    const statusKey: Record<string, keyof DayAcc['byStatus']> = {
      unassigned: 'unassigned',
      assigned: 'assigned',
      'in-progress': 'inProgress',
      rework: 'rework',
    };

    for (const r of agg) {
      const key = statusKey[r._id.status];
      if (!key) continue; // bỏ qua status lạ / done (đã loại ở match)
      const userId = r._id.assignee;
      let row = rows.get(userId);
      if (!row) {
        row = { userId, total: 0, days: new Map() };
        rows.set(userId, row);
      }
      let day = row.days.get(r._id.day);
      if (!day) {
        day = { day: r._id.day, total: 0, byStatus: { unassigned: 0, assigned: 0, inProgress: 0, rework: 0 } };
        row.days.set(r._id.day, day);
      }
      day.byStatus[key] += r.count;
      day.total += r.count;
      row.total += r.count;
      grandTotal += r.count;
    }

    // Resolve fullName.
    const userIds = [...rows.keys()].filter((id) => id !== '__unassigned__');
    const nameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await this.userModel.find({ _id: { $in: userIds } }, { _id: 1, fullName: 1 }).lean();
      for (const u of users) nameMap.set(String(u._id), u.fullName);
    }

    const today = vnTodayString();
    const ageOf = (day: string): number => {
      if (day === '__nodate__') return -1;
      const ms = vnDayStart(today).getTime() - vnDayStart(day).getTime();
      return Math.max(0, Math.round(ms / 86_400_000));
    };

    let globalOldest: string | null = null;
    const designers = [...rows.values()].map((row) => {
      const days = [...row.days.values()]
        .map((d) => ({ day: d.day, ageDays: ageOf(d.day), total: d.total, byStatus: d.byStatus }))
        // Cũ nhất (age lớn) lên đầu; __nodate__ (age -1) đẩy cuối.
        .sort((a, b) => b.ageDays - a.ageDays);
      const realDays = days.filter((d) => d.day !== '__nodate__');
      const oldestDay = realDays.length > 0 ? realDays[0].day : null;
      const oldestAgeDays = oldestDay ? realDays[0].ageDays : -1;
      if (oldestDay && (!globalOldest || oldestDay < globalOldest)) globalOldest = oldestDay;
      return {
        userId: row.userId,
        fullName: row.userId === '__unassigned__' ? 'Chưa gán' : nameMap.get(row.userId) || `#${row.userId.slice(-4)}`,
        total: row.total,
        oldestDay,
        oldestAgeDays,
        days,
      };
    });

    // Sort designer: total desc, "(Chưa gán)" đẩy cuối.
    designers.sort((a, b) => {
      if (a.userId === '__unassigned__') return 1;
      if (b.userId === '__unassigned__') return -1;
      return b.total - a.total;
    });

    return {
      success: true,
      data: { total: grandTotal, oldestDay: globalOldest, designers },
    };
  }

  /**
   * Atomic set 3 field productionError + productionErrorSource + productionErrorNote.
   * Cần thiết khi user chọn code "Lỗi khác" → bắt buộc source + note để stats
   * phân loại chính xác và xưởng ghi rõ chi tiết. Auto-fill source từ config
   * nếu user không truyền (cho code có flag rõ).
   */
  async setProductionError(
    id: string,
    dto: SetProductionErrorDto,
    roleName?: RoleType,
    ctx?: AuditContext,
    permissionCodes?: string[],
  ): Promise<SetProductionErrorResDto> {
    this.assertCanEditField('productionError', roleName, permissionCodes);
    const before = await this.orderRepository.findOneById(id);
    if (!before) throw new NotFoundException('Order not found');

    // Đơn đã hủy: KHÔNG cho báo lỗi / đẩy về công đoạn trước — cancel là trạng
    // thái cuối, đơn đã ra khỏi mọi công đoạn (xem CancelledOrders-ExcludeFromStages).
    if ((before as unknown as { cancelledAt?: Date | null }).cancelledAt) {
      throw new BadRequestException('Đơn đã hủy — không thể báo lỗi / đẩy về công đoạn trước.');
    }
    // Đơn đang giữ → khóa báo lỗi / đẩy về công đoạn trước.
    this.assertNotHeld(before as unknown as { heldAt?: Date | null });

    let finalSource: 'designer' | 'factory' | 'tool-check' | undefined = dto.source;
    if (dto.code) {
      // Validate code tồn tại
      const cfg = await this.workshopConfigRepository.findOne({
        category: WorkshopConfigCategory.ProductionError,
        code: dto.code,
      });
      if (!cfg) throw new BadRequestException(`Invalid productionError code: ${dto.code}`);
      const cfgSource = (cfg as unknown as { errorSource?: 'designer' | 'factory' | 'tool-check' } | null)?.errorSource;

      // 'other' code → bắt buộc user pick source + note (BE defense).
      if (dto.code === 'other') {
        if (!finalSource) {
          throw new BadRequestException('Code "Lỗi khác" bắt buộc chọn lỗi do designer hay do xưởng.');
        }
        if (!dto.note || !dto.note.trim()) {
          throw new BadRequestException('Code "Lỗi khác" bắt buộc nhập mô tả lỗi.');
        }
      } else {
        // Auto-fill source từ config nếu user không pass.
        if (!finalSource && cfgSource) finalSource = cfgSource;
      }
    } else {
      // Clear hẳn lỗi.
      finalSource = undefined;
    }

    const patch: Record<string, unknown> = {
      productionError: dto.code,
      productionErrorSource: finalSource ?? null,
      productionErrorNote: dto.note ?? null,
    };

    // Khi set code mới (non-null) → toolResultNote='error' cho xưởng nhìn thấy
    // ngay + bump counter. Clear (code=null) → giữ nguyên toolResultNote.
    let incProductionErrorCount = false;
    if (dto.code) {
      patch.toolResultNote = 'error';
      patch.readyForFulfill = false;
      incProductionErrorCount = true;
      // Lỗi MỚI → gỡ dấu "đã hoàn thành lỗi" của Admin để đơn hiện lại ở Cần xử lý.
      patch.errorResolvedAt = null;
      const beforeFirstErrorAt = (before as unknown as { productionFirstErrorAt?: Date }).productionFirstErrorAt;
      if (!beforeFirstErrorAt) patch.productionFirstErrorAt = new Date();
    } else {
      // Clear lỗi → đơn rời nhật ký bù lỗi.
      patch.productionFirstErrorAt = null;
    }

    // Auto-rework nếu source='designer' và task đang done.
    let autoReworkApplied = false;
    let reworkBackTimelineEntry: FulfillmentTimelineEntry | null = null;
    if (finalSource === 'designer') {
      const currentDesignerStatus =
        (before as unknown as { designerStatus?: DesignerStatus }).designerStatus || DesignerStatus.Unassigned;
      if (this.canReworkBackToDesigner(currentDesignerStatus)) {
        patch.designerStatus = DesignerStatus.Rework;
        patch.designerReworkAt = new Date();
        autoReworkApplied = true;
        const rb = this.buildDesignerReworkBackFromError(before, dto.note ?? null, ctx);
        if (rb) {
          Object.assign(patch, rb.set);
          reworkBackTimelineEntry = rb.timelineEntry;
        }
      }
    }
    // Lỗi loại 'tool-check' → đẩy về Support (không đụng designerStatus).
    if (finalSource === 'tool-check' && this.canReworkBackToSupport(before)) {
      const rb = this.buildDesignerReworkBackFromError(before, dto.note ?? null, ctx, 'tool-check');
      if (rb) {
        Object.assign(patch, rb.set);
        reworkBackTimelineEntry = rb.timelineEntry;
      }
    }

    // Báo lỗi toàn cục: đẩy đơn về 1 công đoạn fulfillment TRƯỚC (kể cả đơn đã đi
    // qua công đoạn người báo / đã hoàn thành). Chỉ fire khi target là 1 stage
    // hợp lệ và chưa dựng rework-back từ nhánh designer/tool-check ở trên.
    if (
      dto.code &&
      !reworkBackTimelineEntry &&
      dto.target &&
      FULFILLMENT_STAGES.includes(dto.target as FulfillmentStage)
    ) {
      const rb = this.buildFulfillmentReworkBack(before, dto.target as FulfillmentStage, dto.note ?? null, ctx);
      if (rb) {
        Object.assign(patch, rb.set);
        reworkBackTimelineEntry = rb.timelineEntry;
      }
    }

    const mongoUpdate: Record<string, unknown> = { $set: patch };
    const incOps: Record<string, number> = {};
    if (autoReworkApplied) incOps.designerReworkCount = 1;
    if (incProductionErrorCount) incOps.productionErrorCount = 1;
    if (Object.keys(incOps).length > 0) mongoUpdate.$inc = incOps;
    if (reworkBackTimelineEntry) {
      mongoUpdate.$push = { fulfillmentTimeline: reworkBackTimelineEntry };
    }

    const updated = await this.orderModel.findOneAndUpdate({ _id: id }, mongoUpdate, { new: true });
    if (!updated) throw new NotFoundException('Order not found');

    void this.orderLogService.writeMany([
      {
        orderId: id,
        action: 'update',
        field: 'productionError',
        before: (before as unknown as Record<string, unknown>).productionError ?? null,
        after: dto.code,
        ctx,
      },
      {
        orderId: id,
        action: 'update',
        field: 'productionErrorSource',
        before: (before as unknown as Record<string, unknown>).productionErrorSource ?? null,
        after: finalSource ?? null,
        ctx,
      },
      {
        orderId: id,
        action: 'update',
        field: 'productionErrorNote',
        before: (before as unknown as Record<string, unknown>).productionErrorNote ?? null,
        after: dto.note ?? null,
        ctx,
      },
    ]);

    // Lỗi designer trên đơn CHƯA ai ôm (soát 'ok' từ đầu → chưa từng có designer)
    // → auto-gán theo cấu hình xưởng; engine tự lọc đơn đã có assignee.
    if (autoReworkApplied) void this.autoAssignAfterImport([id], ctx);

    void this.invalidateListCache();
    return { success: true, data: updated };
  }

  /**
   * Filter chung tab "Nhật ký bù lỗi" (base + góc nhìn chặng viewer + tab).
   * Dùng bởi CẢ `getErrorLog` (trang) lẫn `countErrorLogTodo` (badge sidebar)
   * để 2 con số luôn khớp nhau.
   */
  private buildErrorLogBaseFilter(
    tab: 'todo' | 'done',
    roleName?: RoleType,
    assigneeUserId?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    // "Đơn lỗi" = từng bị báo lỗi (productionError set), hiển thị mọi thời gian;
    // loại đơn đã hủy / đã xóa. KHÔNG ràng buộc productionFirstErrorAt nữa (đơn
    // đã qua bước sửa của designer vẫn còn lỗi ở các chặng sau).
    filter.productionError = { $exists: true, $nin: [null, ''] };
    filter.deletedAt = { $exists: false };
    filter.cancelledAt = { $exists: false };
    // CHỈ đơn ĐÃ vào fulfillment (in→ép→…→đóng gói): `currentFulfillmentStage` set.
    // Loại đơn còn ở soát-tool / thiết kế trước fulfillment. Riêng tab "Đã xong":
    // đơn đóng hàng xong bị set stage=null (+ `fulfillmentCompletedAt`) — vẫn
    // phải hiện, nếu không đơn hoàn tất biến mất khỏi CẢ 2 tab.
    if (tab === 'todo') {
      filter.currentFulfillmentStage = { $exists: true, $ne: null };
    } else {
      filter.$and = [
        {
          $or: [
            { currentFulfillmentStage: { $exists: true, $ne: null } },
            { fulfillmentCompletedAt: { $exists: true, $ne: null } },
          ],
        },
      ];
    }
    // Bỏ hẳn lỗi nguồn soát-tool khỏi tab này.
    filter.productionErrorSource = { $ne: 'tool-check' };
    // Đơn chưa map xưởng + đơn xưởng US (ngoài luồng sản xuất) bị loại khỏi
    // Nhật ký bù lỗi.
    filter.factoryId = productionFactoryClause(this.orderModel.db);

    // Tab theo góc nhìn chặng của viewer (Cần xử lý / Đã xong) + khóa xưởng cho
    // Fulfillment. Designer lọc theo assignee (task của mình); các role khác FE
    // gate nút thao tác.
    this.applyErrorLogViewFilter(filter, tab, roleName, fulfillmentStage, fulfillmentFactoryId, assigneeUserId);

    // Tab "Cần xử lý": ẩn đơn Admin đã "Đánh dấu hoàn thành lỗi" (mọi role).
    // `{errorResolvedAt: null}` khớp cả field thiếu lẫn null.
    if (tab === 'todo') {
      filter.errorResolvedAt = null;
    } else {
      // Tab "Đã xong": chỉ 14 ngày gần nhất (theo updatedAt).
      filter.updatedAt = { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) };
    }
    return filter;
  }

  /**
   * Badge sidebar "Nhật ký bù lỗi" — số đơn tab "Cần xử lý" theo đúng góc nhìn
   * chặng của người xem (Fulfillment: stage + xưởng mình; Designer: đơn mình ôm;
   * Admin/Manager: toàn cục).
   */
  async countErrorLogTodo(
    roleName?: RoleType,
    assigneeUserId?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<number> {
    const filter = this.buildErrorLogBaseFilter(
      'todo',
      roleName,
      assigneeUserId,
      fulfillmentFactoryId,
      fulfillmentStage,
    );
    return this.orderModel.countDocuments(filter);
  }

  /**
   * Cùng con số như `countErrorLogTodo` nhưng TÁCH THEO XƯỞNG — badge cho cụm
   * menu riêng của từng xưởng ở sidebar (`Orders.md §25`). Dùng CHUNG
   * `buildErrorLogBaseFilter` với badge tổng + trang Nhật ký bù lỗi để 3 con số
   * không bao giờ lệch nhau; một lần `$group` thay vì mỗi xưởng một lượt đếm.
   */
  async countErrorLogTodoByFactory(
    roleName?: RoleType,
    assigneeUserId?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<Record<string, number>> {
    const filter = this.buildErrorLogBaseFilter(
      'todo',
      roleName,
      assigneeUserId,
      fulfillmentFactoryId,
      fulfillmentStage,
    );
    const rows = await this.orderModel.aggregate<{ _id: string | null; n: number }>([
      { $match: { ...filter, factoryId: { $exists: true, $ne: null } } },
      { $group: { _id: '$factoryId', n: { $sum: 1 } } },
    ]);
    const out: Record<string, number> = {};
    for (const r of rows) if (r._id) out[String(r._id)] = r.n;
    return out;
  }

  /**
   * Tab "Nhật ký bù lỗi" — danh sách đơn đang ở trạng thái lỗi xưởng
   * (productionError set, toolResultNote chưa 'ok'). Sort theo
   * `productionFirstErrorAt` ASC để đơn nằm lâu nhất hiện đầu tiên.
   *
   * Visibility: cùng quy tắc như list orders.
   *   - Designer chỉ thấy đơn assignee = userId
   *   - Fulfillment chỉ thấy đơn factory của mình
   *   - Admin/Manager/DesignerLeader thấy hết
   *
   * `byUrgency` tính trên TOÀN bộ scope (bỏ qua pagination) để FE hiện badge
   * count theo mức độ khẩn.
   */
  async getErrorLog(
    dto: GetErrorLogDto,
    roleName?: RoleType,
    assigneeUserId?: string,
    fulfillmentFactoryId?: string,
    fulfillmentStage?: string,
  ): Promise<GetErrorLogResDto> {
    const tab: 'todo' | 'done' = dto.tab === 'done' ? 'done' : 'todo';
    const filter = this.buildErrorLogBaseFilter(tab, roleName, assigneeUserId, fulfillmentFactoryId, fulfillmentStage);

    if (dto.search) {
      const searchOr = buildSearchOr(dto.search);
      if (searchOr.length) {
        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
          delete filter.$or;
        } else {
          filter.$or = searchOr;
        }
      }
    }

    if (dto.assignee) {
      const codes = dto.assignee.split(',').filter(Boolean);
      const hasNone = codes.includes('__none__');
      const real = codes.filter((c) => c !== '__none__');
      if (hasNone && real.length === 0) {
        filter.assignee = { $in: [null, ''] };
      } else if (hasNone) {
        const assigneeOr = [{ assignee: { $in: [null, ''] } }, { assignee: { $in: real } }];
        if (filter.$and) {
          (filter.$and as Array<unknown>).push({ $or: assigneeOr });
        } else if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: assigneeOr }];
          delete filter.$or;
        } else {
          filter.$or = assigneeOr;
        }
      } else {
        filter.assignee = { $in: real };
      }
    }
    if (dto.fabricType) {
      filter.fabricType = { $in: dto.fabricType.split(',').filter(Boolean) };
    }
    if (dto.toolResult) {
      filter.toolResult = { $in: dto.toolResult.split(',').filter(Boolean) };
    }
    if (dto.productionError) {
      filter.productionError = {
        $in: dto.productionError.split(',').filter(Boolean),
      };
    }
    if (dto.productionErrorSource) {
      const sources = dto.productionErrorSource.split(',').filter((s) => s === 'designer' || s === 'factory');
      if (sources.length) filter.productionErrorSource = { $in: sources };
    }
    if (dto.factoryId && roleName !== RoleType.Fulfillment) {
      filter.factoryId = { $in: dto.factoryId.split(',').filter(Boolean) };
    }

    // Date range filter theo `inProductionAt` (VN tz) — đồng bộ với
    // OrderTableWorkshop / OrderFactoryTab (xem comment ở `buildVisibilityFilter`).
    if (dto.createdFrom || dto.createdTo) {
      const range: Record<string, Date> = {};
      if (dto.createdFrom) range.$gte = vnDayStart(dto.createdFrom);
      if (dto.createdTo) range.$lte = vnDayEnd(dto.createdTo);
      filter.inProductionAt = range;
    }

    // Urgency filter — tuổi đơn tính theo `inProductionAt` (ngày VÀO SẢN XUẤT),
    // KHÔNG phải ngày báo lỗi (`productionFirstErrorAt`). Snapshot `countFilter`
    // TRƯỚC khi thêm clause urgency để badge luôn hiện đủ 4 mức (sticky filter).
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;

    const countFilter: Record<string, unknown> = { ...filter };
    if (Array.isArray(countFilter.$and)) countFilter.$and = [...(countFilter.$and as unknown[])];

    // Ngưỡng khẩn cấp theo GIỜ kể từ `inProductionAt`:
    // Mới <2h · Cần làm 2–4h · Gấp 4–6h · Khẩn cấp >6h.
    if (dto.urgency) {
      const levels = dto.urgency.split(',').filter(Boolean);
      const ranges: Array<{ $gt?: Date; $lte?: Date }> = [];
      for (const lvl of levels) {
        if (lvl === 'new') {
          ranges.push({ $gt: new Date(now - 2 * HOUR) });
        } else if (lvl === 'attention') {
          ranges.push({ $gt: new Date(now - 4 * HOUR), $lte: new Date(now - 2 * HOUR) });
        } else if (lvl === 'urgent') {
          ranges.push({ $gt: new Date(now - 6 * HOUR), $lte: new Date(now - 4 * HOUR) });
        } else if (lvl === 'critical') {
          ranges.push({ $lte: new Date(now - 6 * HOUR) });
        }
      }
      if (ranges.length) {
        // Đưa vào clause riêng ($and/$or) — KHÔNG merge vào `filter.inProductionAt`
        // để tránh đè range của date filter (cùng field).
        const urgencyOr = ranges.map((r) => ({ inProductionAt: r }));
        if (Array.isArray(filter.$and)) {
          (filter.$and as Array<unknown>).push({ $or: urgencyOr });
        } else if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: urgencyOr }];
          delete filter.$or;
        } else {
          filter.$or = urgencyOr;
        }
      }
    }

    const { page, limit } = dto;
    const skip = limit * ((page || 1) - 1);

    // Cần xử lý: đơn VÀO SẢN XUẤT lâu nhất trước (khớp thang mức độ khẩn §14.2;
    // `priority: -1` prefix bên dưới đưa đơn ưu tiên lên đầu). Đã xong: mới xử
    // lý xong lên đầu.
    const sort: Record<string, 1 | -1> = tab === 'done' ? { updatedAt: -1 } : { inProductionAt: 1 };

    const [pageRes, urgencyAgg] = await Promise.all([
      this.orderRepository.findAllAndCount(filter, {
        paging: { skip, limit },
        sort: { priority: -1, ...sort },
        populate: [
          { path: 'factory', select: ['name', 'shortName'] },
          { path: 'machineType', select: ['name', 'shortName'] },
        ],
      }),
      this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: countFilter },
        {
          $project: {
            ageMs: { $subtract: [new Date(), '$inProductionAt'] },
          },
        },
        {
          $project: {
            bucket: {
              $switch: {
                branches: [
                  { case: { $lt: ['$ageMs', 2 * HOUR] }, then: 'new' },
                  { case: { $lt: ['$ageMs', 4 * HOUR] }, then: 'attention' },
                  { case: { $lt: ['$ageMs', 6 * HOUR] }, then: 'urgent' },
                ],
                default: 'critical',
              },
            },
          },
        },
        { $group: { _id: '$bucket', count: { $sum: 1 } } },
      ]),
    ]);

    const byUrgency = { new: 0, attention: 0, urgent: 0, critical: 0 };
    for (const row of urgencyAgg) {
      if (row._id === 'new' || row._id === 'attention' || row._id === 'urgent' || row._id === 'critical') {
        byUrgency[row._id] = row.count;
      }
    }

    return { success: true, data: pageRes.data, total: pageRes.total, byUrgency };
  }

  /**
   * Backfill `designerStatus` + 5 timestamps cho order cũ. Idempotent —
   * chỉ áp khi order chưa có `designerStatus` (Mongoose default cũng là
   * `unassigned` nhưng default đó áp khi load, không lưu vào doc cũ).
   *
   * Heuristic suy luận:
   *   - assignee không có → 'unassigned'
   *   - có productionError với errorSource='designer' → 'rework'
   *   - toolResultNote === 'ok'                       → 'done'
   *   - còn lại                                       → 'assigned'
   *
   * Timestamps:
   *   - designerAssignedAt = log đầu tiên field='assignee' (sau '' → có code)
   *   - designerCompletedAt = log cuối field='toolResultNote' (chuyển sang 'ok')
   *   - designerReworkAt = log cuối field='productionError' (set khác empty)
   *   - designerStartedAt = midpoint (assignedAt + completedAt)/2 nếu thiếu
   *
   * Trả về `{ scanned, updated, skipped }`.
   */
  async backfillDesignerStatus(): Promise<{
    scanned: number;
    updated: number;
    skipped: number;
  }> {
    // 1) Build map errorCode → errorSource từ workshop_config.
    const errorConfigs = await this.workshopConfigRepository.findAll({
      category: WorkshopConfigCategory.ProductionError,
    });
    const errorSourceMap = new Map<string, string | undefined>();
    for (const cfg of errorConfigs as Array<{ code: string; errorSource?: string }>) {
      errorSourceMap.set(cfg.code, cfg.errorSource);
    }

    // 2) Quét order — chỉ những đơn chưa có `designerStatus` (đảm bảo idempotent).
    const orders = await this.orderModel.find({ designerStatus: { $exists: false } }).lean();

    let updated = 0;
    let skipped = 0;

    for (const o of orders) {
      const orderId = String(o._id);
      const assignee = (o as { assignee?: string }).assignee;
      const toolResultNote = (o as { toolResultNote?: string }).toolResultNote;
      const productionError = (o as { productionError?: string }).productionError;

      let nextStatus: DesignerStatus = DesignerStatus.Unassigned;
      if (!assignee) {
        nextStatus = DesignerStatus.Unassigned;
      } else if (productionError && errorSourceMap.get(productionError) === 'designer') {
        nextStatus = DesignerStatus.Rework;
      } else if (toolResultNote === READY_FOR_FULFILL_CODE) {
        nextStatus = DesignerStatus.Done;
      } else {
        nextStatus = DesignerStatus.Assigned;
      }

      const patch: Record<string, unknown> = { designerStatus: nextStatus };

      // Look up logs once per order (N+1 — OK cho one-shot backfill).
      const logs = await this.orderLogRepository.findAll({ orderId }, { sort: { createdAt: 1 } });

      const assignLog = logs.find((l) => l.field === 'assignee' && !!l.after);
      const completeLog = [...logs]
        .reverse()
        .find((l) => l.field === 'toolResultNote' && l.after === READY_FOR_FULFILL_CODE);
      const reworkLog = [...logs].reverse().find((l) => l.field === 'productionError' && !!l.after);

      const createdAt = (o as { createdAt?: Date }).createdAt;
      const updatedAt = (o as { updatedAt?: Date }).updatedAt;

      if (nextStatus !== DesignerStatus.Unassigned) {
        patch.designerAssignedAt = (assignLog as { createdAt?: Date } | undefined)?.createdAt ?? createdAt;
      }
      if (nextStatus === DesignerStatus.Done || nextStatus === DesignerStatus.Rework) {
        patch.designerCompletedAt = (completeLog as { createdAt?: Date } | undefined)?.createdAt ?? updatedAt;
        const assignedAt = patch.designerAssignedAt as Date | undefined;
        const completedAt = patch.designerCompletedAt as Date | undefined;
        if (assignedAt && completedAt && completedAt.getTime() > assignedAt.getTime()) {
          patch.designerStartedAt = new Date(assignedAt.getTime() + (completedAt.getTime() - assignedAt.getTime()) / 2);
        } else {
          patch.designerStartedAt = assignedAt;
        }
      }
      if (nextStatus === DesignerStatus.Rework) {
        patch.designerReworkAt = (reworkLog as { createdAt?: Date } | undefined)?.createdAt ?? updatedAt;
        patch.designerReworkCount = 1;
      }

      try {
        await this.orderModel.updateOne({ _id: orderId }, { $set: patch });
        updated++;
      } catch (err) {
        skipped++;
        this.logger.info({
          message: `[backfill-designer][WARN] ${orderId} failed: ${(err as Error).message}`,
        });
      }
    }

    void this.invalidateListCache();
    return { scanned: orders.length, updated, skipped };
  }

  // ─── Cutting File Mapping (post-import flow) ────────────────────
  // Workflow: user paste list Drive link → BE fetch tên file (public Drive
  // page) → parse productionId từ filename (`BH-XXXXX-XXXXX-*`) → search đơn
  // hiện có → trả preview. Bước 2 apply ghi `cuttingFileUrl` + ghi audit log
  // (action='bulk_update' với field='cuttingFileUrl' để giữ enum cũ).

  async previewCuttingFiles(dto: PreviewCuttingFilesDto): Promise<PreviewCuttingFilesResDto> {
    const links = Array.from(new Set((dto.links ?? []).map((l) => l.trim()).filter(Boolean)));
    if (links.length === 0) {
      throw new BadRequestException('Cần ít nhất 1 link');
    }

    // Bước 1: fetch tên file concurrent (cap 5) — tránh Drive rate-limit.
    const CONCURRENCY = 5;
    type FetchOutcome =
      | { link: string; status: 'ok'; fileId: string; fileName: string; productionId: string }
      | { link: string; status: 'no-production-id'; fileId: string; fileName: string }
      | { link: string; status: 'invalid-url' }
      | { link: string; status: 'fetch-failed'; fileId: string }
      | { link: string; status: 'parse-failed'; fileId: string };
    const outcomes: FetchOutcome[] = new Array(links.length) as FetchOutcome[];

    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, links.length) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= links.length) break;
        const link = links[idx];
        const res = await this.driveFileNameService.fetchFileName(link);
        if (res === null) {
          outcomes[idx] = { link, status: 'invalid-url' };
          continue;
        }
        if ('error' in res) {
          outcomes[idx] = { link, status: res.error, fileId: res.fileId };
          continue;
        }
        const productionId = parseProductionIdFromCuttingFilename(res.fileName);
        if (!productionId) {
          outcomes[idx] = { link, status: 'no-production-id', fileId: res.fileId, fileName: res.fileName };
          continue;
        }
        outcomes[idx] = { link, status: 'ok', fileId: res.fileId, fileName: res.fileName, productionId };
      }
    });
    await Promise.all(workers);

    // Bước 2: split outcomes thành buckets + detect conflicts.
    const okOutcomes = outcomes.filter((o): o is Extract<FetchOutcome, { status: 'ok' }> => o.status === 'ok');
    const invalid: CuttingFileInvalid[] = outcomes
      .filter((o): o is Exclude<FetchOutcome, { status: 'ok' }> => o.status !== 'ok')
      .map((o) => {
        if (o.status === 'no-production-id') {
          return { link: o.link, reason: 'no-production-id' as const, fileName: o.fileName };
        }
        return { link: o.link, reason: o.status };
      });

    // Detect conflict: cùng productionId xuất hiện > 1 link → user phải xoá bớt.
    const byProductionId = new Map<string, typeof okOutcomes>();
    for (const o of okOutcomes) {
      const list = byProductionId.get(o.productionId) ?? [];
      list.push(o);
      byProductionId.set(o.productionId, list);
    }
    const conflicts: CuttingFileConflict[] = [];
    const uniqueOutcomes: typeof okOutcomes = [];
    for (const [productionId, list] of byProductionId.entries()) {
      if (list.length > 1) {
        conflicts.push({ productionId, links: list.map((l) => l.link) });
      } else {
        uniqueOutcomes.push(list[0]);
      }
    }

    // Bước 3: lookup orders theo productionId (case-insensitive exact via $in).
    const productionIds = uniqueOutcomes.map((o) => o.productionId);
    const orders = productionIds.length
      ? await this.orderModel
          .find(
            { productionId: { $in: productionIds }, deletedAt: { $exists: false } },
            {
              _id: 1,
              productionId: 1,
              factoryId: 1,
              machineTypeId: 1,
              cuttingFileUrl: 1,
              cuttingFileName: 1,
            },
          )
          .lean()
      : [];

    // Lookup factory + machine names (1 query mỗi loại).
    const factoryIds = Array.from(new Set(orders.map((o) => o.factoryId).filter((x): x is string => !!x)));
    const machineIds = Array.from(new Set(orders.map((o) => o.machineTypeId).filter((x): x is string => !!x)));
    const [factoriesRaw, machinesRaw] = await Promise.all([
      factoryIds.length
        ? this.factoryRepository.findAll({ _id: { $in: factoryIds } } as Record<string, unknown>)
        : Promise.resolve([] as Array<{ _id: unknown; name?: string; shortName?: string }>),
      machineIds.length
        ? this.machineTypeRepository.findAll({ _id: { $in: machineIds } } as Record<string, unknown>)
        : Promise.resolve([] as Array<{ _id: unknown; name?: string; shortName?: string }>),
    ]);
    const factoryNameById = new Map(factoriesRaw.map((f) => [String(f._id), f.shortName || f.name || '—']));
    const machineNameById = new Map(machinesRaw.map((m) => [String(m._id), m.shortName || m.name || '—']));

    const ordersByProductionId = new Map(orders.map((o) => [o.productionId, o]));
    const matched: CuttingFileMatched[] = [];
    const notFound: CuttingFileNotFound[] = [];
    for (const o of uniqueOutcomes) {
      const order = ordersByProductionId.get(o.productionId);
      if (!order) {
        notFound.push({
          link: o.link,
          fileId: o.fileId,
          fileName: o.fileName,
          productionId: o.productionId,
        });
        continue;
      }
      matched.push({
        link: o.link,
        fileId: o.fileId,
        fileName: o.fileName,
        productionId: o.productionId,
        orderId: String(order._id),
        factoryId: order.factoryId,
        factoryName: order.factoryId ? factoryNameById.get(order.factoryId) : undefined,
        machineTypeId: order.machineTypeId,
        machineTypeName: order.machineTypeId ? machineNameById.get(order.machineTypeId) : undefined,
        existingCuttingFileUrl: order.cuttingFileUrl,
        existingCuttingFileName: order.cuttingFileName,
      });
    }

    // Breakdown counts.
    const byFactoryMap = new Map<string, number>();
    const byMachineMap = new Map<string, number>();
    for (const m of matched) {
      const fk = m.factoryId ?? '__none';
      byFactoryMap.set(fk, (byFactoryMap.get(fk) ?? 0) + 1);
      const mk = m.machineTypeId ?? '__none';
      byMachineMap.set(mk, (byMachineMap.get(mk) ?? 0) + 1);
    }
    const byFactory: CuttingFileBreakdownRow[] = Array.from(byFactoryMap.entries()).map(([id, count]) => ({
      id: id === '__none' ? null : id,
      name: id === '__none' ? 'Chưa gán xưởng' : factoryNameById.get(id) ?? '—',
      count,
    }));
    const byMachineType: CuttingFileBreakdownRow[] = Array.from(byMachineMap.entries()).map(([id, count]) => ({
      id: id === '__none' ? null : id,
      name: id === '__none' ? 'Chưa gán máy' : machineNameById.get(id) ?? '—',
      count,
    }));
    byFactory.sort((a, b) => b.count - a.count);
    byMachineType.sort((a, b) => b.count - a.count);

    return {
      success: true,
      data: {
        matched,
        notFound,
        invalid,
        conflicts,
        summary: {
          totalLinks: links.length,
          matched: matched.length,
          withExistingFile: matched.filter((m) => !!m.existingCuttingFileUrl).length,
          notFound: notFound.length,
          invalid: invalid.length,
          conflicts: conflicts.length,
          byFactory,
          byMachineType,
        },
      },
    };
  }

  async applyCuttingFiles(dto: ApplyCuttingFilesDto, ctx?: AuditContext): Promise<ApplyCuttingFilesResDto> {
    if (!dto.mappings?.length) {
      throw new BadRequestException('Danh sách mapping rỗng');
    }

    // Guard: nếu schema chưa biết về cuttingFileUrl/Name (vd entity chưa rebuild,
    // hoặc hot-reload chưa pickup), Mongoose strict mode sẽ silently strip $set
    // → bulkWrite "thành công" nhưng DB không có gì. Throw rõ ràng thay vì im lặng.
    if (!this.orderModel.schema.path('cuttingFileUrl') || !this.orderModel.schema.path('cuttingFileName')) {
      throw new BadRequestException('Schema chưa có cuttingFileUrl/cuttingFileName — restart BE để pickup entity mới.');
    }

    // Load current rows để: (1) bỏ qua đơn không tồn tại; (2) check overwrite
    // rule; (3) ghi audit before/after chính xác.
    const orderIds = dto.mappings.map((m) => m.orderId);
    const current = await this.orderModel
      .find(
        { _id: { $in: orderIds }, deletedAt: { $exists: false } },
        { _id: 1, cuttingFileUrl: 1, cuttingFileName: 1 },
      )
      .lean();
    const currentById = new Map(current.map((c) => [String(c._id), c]));

    const toUpdate: Array<{
      orderId: string;
      before: { cuttingFileUrl?: string; cuttingFileName?: string };
      after: { cuttingFileUrl: string; cuttingFileName: string };
    }> = [];
    const skippedOrderIds: string[] = [];

    for (const m of dto.mappings) {
      const cur = currentById.get(m.orderId);
      if (!cur) {
        skippedOrderIds.push(m.orderId);
        continue;
      }
      if (cur.cuttingFileUrl && !dto.overwrite) {
        skippedOrderIds.push(m.orderId);
        continue;
      }
      // No-op nếu URL giống nhau — không ghi audit cho việc set lại cùng giá trị.
      if (cur.cuttingFileUrl === m.cuttingFileUrl && cur.cuttingFileName === m.cuttingFileName) {
        skippedOrderIds.push(m.orderId);
        continue;
      }
      toUpdate.push({
        orderId: m.orderId,
        before: { cuttingFileUrl: cur.cuttingFileUrl, cuttingFileName: cur.cuttingFileName },
        after: { cuttingFileUrl: m.cuttingFileUrl, cuttingFileName: m.cuttingFileName },
      });
    }

    if (toUpdate.length === 0) {
      return { success: true, data: { updated: 0, skipped: skippedOrderIds.length, skippedOrderIds } };
    }

    // Bulk write — mỗi đơn 1 op vì cuttingFileUrl khác nhau.
    const writeRes = await this.orderModel.bulkWrite(
      toUpdate.map((t) => ({
        updateOne: {
          filter: { _id: t.orderId },
          update: { $set: t.after },
        },
      })),
      { ordered: false },
    );

    // Defensive: nếu modifiedCount < số op, log để debug. Lý do phổ biến:
    //   - filter `_id` không match (vd orderId không tồn tại trong DB)
    //   - $set giá trị giống hệt (Mongo skip update)
    const modified =
      (writeRes as { modifiedCount?: number; nModified?: number }).modifiedCount ??
      (writeRes as { nModified?: number }).nModified ??
      0;
    if (modified !== toUpdate.length) {
      this.logger.warn({
        message: JSON.stringify({
          event: 'applyCuttingFiles.partialWrite',
          expected: toUpdate.length,
          modified,
          orderIds: toUpdate.map((t) => t.orderId),
        }),
      });
    }

    void this.orderLogService.writeMany(
      toUpdate.map((t) => ({
        orderId: t.orderId,
        action: 'bulk_update' as const,
        field: 'cuttingFileUrl',
        before: t.before,
        after: { ...t.after, event: 'production-file-mapped' },
        ctx,
      })),
    );
    void this.invalidateListCache();

    return {
      success: true,
      data: { updated: modified, skipped: skippedOrderIds.length, skippedOrderIds },
    };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build `$or` cho ô search đa mã — mirror `BulkProductionIdDialog`: tách theo
 * xuống dòng / dấu phẩy / khoảng trắng thành nhiều token. Mỗi token match
 * contains (case-insensitive) trên 5 field `productionId` / `userSku` /
 * `userEmail` / `orderId` / `type`. Đơn khớp nếu BẤT KỲ token nào khớp BẤT KỲ
 * field nào → cho phép dán 1 danh sách mã và tìm tất cả cùng lúc.
 * Trả `[]` khi search rỗng/chỉ khoảng trắng (caller không set `$or`).
 */
function buildSearchOr(search: string): Array<Record<string, unknown>> {
  const tokens = search
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const fields = ['productionId', 'userSku', 'userEmail', 'orderId', 'type'];
  return tokens.flatMap((tok) => {
    const rx = { $regex: escapeRegex(tok), $options: 'i' };
    return fields.map((f) => ({ [f]: rx }));
  });
}

function round2(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Clothing size sort priority. Lower = comes first.
 *
 * Handles:
 *   - Standard codes (XS, S, M, L, XL)
 *   - Multi-X variants (XXL, XXXL, 4XL, 5XL, ...)
 *   - Common aliases (2XL = XXL, 3XL = XXXL)
 *   - Unknown/numeric sizes are sorted after the standard ones, alphabetically.
 */
function sizeRank(raw: string): number {
  const s = (raw || '').trim().toUpperCase();
  if (!s || s === '—') return 1000;

  const table: Record<string, number> = {
    XS: 0,
    S: 1,
    M: 2,
    L: 3,
    XL: 4,
    XXL: 5,
    '2XL': 5,
    XXXL: 6,
    '3XL': 6,
    XXXXL: 7,
    '4XL': 7,
    XXXXXL: 8,
    '5XL': 8,
    '6XL': 9,
    '7XL': 10,
    '8XL': 11,
  };
  return table[s] ?? 500;
}

function compareSize(a: string, b: string): number {
  const ra = sizeRank(a);
  const rb = sizeRank(b);
  if (ra !== rb) return ra - rb;
  // Same rank or both unknown — fall back to natural string compare
  return a.localeCompare(b, undefined, { numeric: true });
}
