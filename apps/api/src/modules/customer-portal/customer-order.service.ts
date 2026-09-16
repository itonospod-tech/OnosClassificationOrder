import type { OnModuleInit } from '@nestjs/common';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import type {
  AdminCustomerStagingOrder,
  CancelCustomerStagingOrderDto,
  CustomerImportResultRow,
  CustomerOrderCounts,
  CustomerOrderPriceSnapshot,
  CustomerPushQuoteOrder,
  CustomerShipMethod,
  CustomerStagingItem,
  CustomerStagingItemInput,
  CustomerStagingOrder,
  CustomerStagingOrderResDto,
  GetAdminCustomerOrderCountsDto,
  GetAdminCustomerOrdersDto,
  GetAdminCustomerOrdersResDto,
  GetAdminCustomerOrderStatsResDto,
  GetCustomerDashboardResDto,
  GetCustomerOrderCountsDto,
  GetCustomerOrderCountsResDto,
  GetCustomerOrderProductTypesResDto,
  GetCustomerOrderTrackResDto,
  GetCustomerStagingOrdersDto,
  GetCustomerStagingOrdersResDto,
  ImportCustomerOrdersDto,
  ImportCustomerOrdersResDto,
  ImportProductionOrderRow,
  OpenApiGetOrderResDto,
  PlaceCustomerOrderDto,
  PreviewPushCustomerOrdersResDto,
  ProductionOrderShippingAddress,
  ProductionOrderTracking,
  ProductLine,
  ProductPrintArea,
  PushCustomerOrdersDto,
  PushCustomerOrdersResDto,
  ResolveImportSkusDto,
  ResolveImportSkusResDto,
  UpdateCustomerOrderDto,
  UpdateCustomerOrderResDto,
  UpdateCustomerStagingOrderDto,
} from 'shared';
import {
  CUSTOMER_ORDER_COMPLETED_DAYS_DEFAULT,
  CUSTOMER_ORDER_COMPLETED_DAYS_KEY,
  CUSTOMER_ORDER_STATUS_PROGRESS,
  CUSTOMER_PAYMENT_GATE_KEY,
  customerOrderKey,
  CustomerOrderStatus,
  DEFAULT_CUSTOMER_SHIP_METHOD,
  designAcceptKeys,
  DesignerStatus,
  extractDesignSha,
  FULFILLMENT_STAGE_LABELS,
  FULFILLMENT_STAGE_ORDER,
  FulfillmentStage,
  hasProductionOrderTracking,
  LIFECYCLE_STAGE_KEYS,
  normalizeProductionOrderTracking,
  PRODUCT_LINES,
  PRODUCT_PRINT_AREA_LABEL_MAP,
  RoleType,
} from 'shared';

import type { CustomerDocument } from '@/modules/customer/customer.entity';
import { CustomerOrderEventService } from '@/modules/customer-event/customer-order-event.service';
import { DesignStorageService } from '@/modules/design-storage/design-storage.service';
import { OrderEntity } from '@/modules/order/order.entity';
import { OrderService } from '@/modules/order/order.service';
import { ProductConfigEntity } from '@/modules/product-config/product-config.entity';
import { applyPromotionDiscount, promotionMatches, PromotionService } from '@/modules/promotion/promotion.service';
import { SystemConfigService } from '@/modules/system-config/system-config.service';
import { customerMessage } from '@/shared/i18n/customer-messages';
import { workshopStageSwitchExpr } from '@/utils/workshop-stage';

import type { CustomerOrderItem } from './customer-order.entity';
import { CustomerOrderEntity } from './customer-order.entity';
import { CustomerPaymentEntity } from './customer-payment.entity';
import { EXCLUDED_PRODUCTION_FACTORY_SHORT_NAME } from '@/utils/excluded-factory';
import { laTienTrinhChayCron } from '@/utils/cron-guard';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Random `productionId` — CÙNG pattern với mã đơn thật từ hệ thống chính (2
 * chữ cái + "-" + 5 số + "-" + 5 số, xem `CUTTING_FILE_PRODUCTION_ID_REGEX`
 * trong `production-order.dto.ts`) để đơn khách tự đặt tương thích với mọi
 * logic parse/regex sẵn có theo pattern này (vd matching cutting file).
 */
const PRODUCTION_ID_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Chỗ giữ khi đẩy đơn (`pushingAt`) quá hạn này thì coi như hết hiệu lực —
 * tiến trình chết giữa chừng không khoá đơn vĩnh viễn. Đặt rộng hơn nhiều lần
 * thời gian một lượt push thật (importOrders cho vài chục item tính bằng
 * giây), để lượt đang chạy chậm không bị lượt khác cướp chỗ. Xem ORD-20.
 */
const PUSH_CLAIM_STALE_MS = 5 * 60_000;
function randomDigits5(): string {
  return String(Math.floor(Math.random() * 100000)).padStart(5, '0');
}
function randomProductionId(): string {
  const letters = Array.from({ length: 2 }, () => PRODUCTION_ID_LETTERS[Math.floor(Math.random() * 26)]).join('');
  return `${letters}-${randomDigits5()}-${randomDigits5()}`;
}

/** Nhãn chặng hiện tại — hiển thị khách hàng, KHÔNG dùng thuật ngữ nội bộ (vd 'sew-in'). */
export const CUSTOMER_STAGE_LABELS: Record<string, string> = {
  'tool-check': 'Đang xử lý',
  designer: 'Đang thiết kế',
  ...FULFILLMENT_STAGE_LABELS,
};

/** Field OrderEntity cần cho derive trạng thái khách — dùng CHUNG cho $lookup pipeline lẫn find(). */
export const PROD_DERIVE_FIELDS =
  'productionId cancelledAt fulfillmentCompletedAt currentFulfillmentStage heldAt holdReason ' +
  'designerStatus productionErrorSource toolResultNote toolCheckedAt ' +
  'designerAssignedAt designerFirstStartedAt designerCompletedAt fulfillmentStages inProductionAt productLine ' +
  // Vận đơn: `tracking` (khách tự cấp HOẶC hãng ngoài ghi vào) + `vnpShipment`
  // (snapshot lúc Admin mua label VNP). Thiếu hai trường này thì seller mua
  // label xong vẫn KHÔNG thấy mã vận đơn ở portal — chỉ nội bộ thấy.
  'tracking vnpShipment ' +
  // Trường NỘI BỘ — chỉ `toAdminStagingOrder` (khu /hub) đọc; `toStagingOrder` cho khách không bao giờ chép ra.
  'factoryId assignee priority productionError productionErrorNote productionErrorSource toolResult toolResultNote ' +
  'toolCheckErrorNotes errorFileNote printStatusNote designerRejectedReason weight width height length';

export interface ProdDeriveFields {
  productionId?: string;
  cancelledAt?: Date;
  fulfillmentCompletedAt?: Date;
  currentFulfillmentStage?: FulfillmentStage;
  heldAt?: Date;
  holdReason?: string;
  designerStatus?: DesignerStatus;
  productionErrorSource?: string;
  toolResultNote?: string;
  toolCheckedAt?: Date;
  designerAssignedAt?: Date;
  designerFirstStartedAt?: Date;
  designerCompletedAt?: Date;
  fulfillmentStages?: Record<string, { waitingAt?: Date; startedAt?: Date; completedAt?: Date }>;
  inProductionAt?: Date;
  /** PRD-8 — để derive dòng sản phẩm cho item cũ chưa stamp. */
  productLine?: ProductLine;
}

/**
 * Chặng hiện tại rút gọn cho khách hàng — MIRROR nhánh tính `currentIndex` ở
 * `OrderService.getLifecycleTrack()` (order.service.ts). Cố tình KHÔNG tái
 * dùng thẳng `getLifecycleTrack` (query riêng theo từng đơn) để tránh N+1 khi
 * hiển thị listing nhiều đơn cùng lúc. Đổi logic chặng ở 1 nơi thì nhớ đổi
 * luôn nơi kia.
 */
export function computeCurrentStage(d: ProdDeriveFields): {
  /** Key chặng (`LIFECYCLE_STAGE_KEYS`) — để FE dịch nhãn theo ngôn ngữ người xem. */
  key?: string;
  label?: string;
  at?: Date;
  completed: boolean;
} {
  const completed = !!d.fulfillmentCompletedAt;
  if (completed) return { label: undefined, at: d.fulfillmentCompletedAt, completed };

  const toolEmpty = !d.toolResultNote;
  let currentIndex: number;
  if (d.currentFulfillmentStage) currentIndex = 2 + FULFILLMENT_STAGE_ORDER[d.currentFulfillmentStage];
  else if (d.designerStatus && d.designerStatus !== DesignerStatus.Unassigned)
    currentIndex = d.designerStatus === DesignerStatus.Done ? 2 : 1;
  else if (toolEmpty) currentIndex = 0;
  else currentIndex = 1;

  const key = LIFECYCLE_STAGE_KEYS[currentIndex] ?? LIFECYCLE_STAGE_KEYS[LIFECYCLE_STAGE_KEYS.length - 1];
  const at =
    key === 'tool-check'
      ? d.toolCheckedAt
      : key === 'designer'
        ? d.designerCompletedAt ?? d.designerFirstStartedAt ?? d.designerAssignedAt
        : d.fulfillmentStages?.[key]?.startedAt ?? d.fulfillmentStages?.[key]?.waitingAt;

  return { key, label: CUSTOMER_STAGE_LABELS[key] ?? key, at, completed };
}

/**
 * Badge "Đang sửa lỗi" (Rework) — plan §1.1b: `designerStatus='rework'` HOẶC
 * (`productionErrorSource='tool-check'` && `toolResultNote` có giá trị != 'ok').
 * MIRROR với biểu thức aggregation trong `buildDerivePipeline()` — đổi 1 nơi
 * nhớ đổi nơi kia.
 */
export function isReworkBadge(p: ProdDeriveFields): boolean {
  if (p.designerStatus === DesignerStatus.Rework) return true;
  const note = (p.toolResultNote || '').trim().toLowerCase();
  return p.productionErrorSource === 'tool-check' && note !== '' && note !== 'ok';
}

/**
 * Trạng thái khách của 1 item đã push — plan §1: Processing = chưa từng vào
 * In; In Production = `currentFulfillmentStage` set; Fulfilled = đóng hàng
 * xong; Completed = Fulfilled + N ngày (cutoff tính sẵn từ system_configs).
 * MIRROR với `buildDerivePipeline()`.
 */
export function deriveItemStatus(p: ProdDeriveFields, completedCutoff: Date): CustomerOrderStatus {
  if (p.cancelledAt) return CustomerOrderStatus.Cancelled;
  if (p.fulfillmentCompletedAt)
    return p.fulfillmentCompletedAt <= completedCutoff ? CustomerOrderStatus.Completed : CustomerOrderStatus.Fulfilled;
  if (p.currentFulfillmentStage) return CustomerOrderStatus.InProduction;
  return CustomerOrderStatus.Processing;
}

/** Config + variation resolve được từ SKU / type — context chốt giá dùng chung import/preview/push. */
interface PricingConfig {
  _id: string;
  fullName: string;
  productCategoryId?: string;
  /** active/inactive/hidden — khác 'active' là NGỪNG BÁN, chặn import + push. */
  status?: string;
  /** Ảnh mockup sản phẩm — trả về preview import cho khách đối chiếu. */
  mockup?: string;
  /** Vị trí in của sản phẩm — dùng để đòi design ở vị trí BẮT BUỘC (ORD-22). */
  printArea?: ProductPrintArea;
  /** PRD-8 — dòng sản phẩm, stamp lên item lúc tạo/import. */
  productLine?: ProductLine;
  variations: Array<{
    sku: string;
    attributes?: Array<{ label: string; value: string }>;
    status?: string;
    retailPrice?: number;
    nonShipCost?: number;
    /** Cân nặng gram + kích thước đóng gói cm — đi theo đơn tới xưởng và tới bước mua vận đơn. */
    weight?: number;
    width?: number;
    height?: number;
    length?: number;
    /** Cước ship niêm yết theo phương thức (cột hệ cũ "SHIP Express US" / "Ship by TikTok"). */
    expUsShipCost?: number;
    tiktokShipCost?: number;
  }>;
}
interface PricingContext {
  bySku: Map<string, { config: PricingConfig; variation: PricingConfig['variations'][number] }>;
  byType: Map<string, PricingConfig>;
  /** Tra ngược theo `QuoteResult.productConfigId` — cần cho bước kiểm design (ORD-22). */
  byId: Map<string, PricingConfig>;
}
type ActivePromotion = Awaited<ReturnType<PromotionService['getActiveInDateRange']>>[number];

interface QuoteResult {
  productConfigId?: string;
  type?: string;
  size?: string;
  color?: string;
  snapshot?: CustomerOrderPriceSnapshot;
  error?: string;
  /** Sản phẩm ngừng bán (status != active) — push phân biệt để fail RIÊNG đơn với message rõ. */
  inactive?: boolean;
  /** PRD-8 — dòng sản phẩm của config đã resolve. */
  productLine?: ProductLine;
  /**
   * Cân nặng (gram) + kích thước đóng gói (cm) của biến thể đã chốt.
   *
   * Vì sao phải mang theo (08/09/2026): đơn đẩy sang xưởng trước đây để TRỐNG
   * bốn trường này dù biến thể khai đủ, nên (1) mua vận đơn phải gõ tay cân
   * nặng và kích thước rơi về mặc định 1×1×1 cm → sai cước, (2) bảng đơn xưởng
   * không có số để đóng gói. Đường import nội bộ (`parseOrders.ts` cột 8–11)
   * luôn có bốn trường này — hai đường phải cấp cùng một bộ dữ liệu.
   */
  weight?: number;
  width?: number;
  height?: number;
  length?: number;
  /** Cước ship của biến thể theo `shipMethod` (`expUsShipCost`/`tiktokShipCost`). */
  shipCost?: number;
}

/** Lấy value thuộc tính variation theo tên label (size/color) — attributes tự do key-value. */
function attrValue(
  attributes: Array<{ label: string; value: string }> | undefined,
  pattern: RegExp,
): string | undefined {
  return attributes?.find((a) => pattern.test(a.label))?.value;
}
const SIZE_LABEL = /size|kích/i;
const COLOR_LABEL = /color|colour|màu/i;

interface AdminRefMaps {
  factories: Map<string, { name?: string; shortName?: string }>;
  users: Map<string, string>;
  logs: Map<string, { action: string; field?: string; userName?: string; at?: Date; after?: unknown }>;
}

@Injectable()
export class CustomerOrderService implements OnModuleInit {
  constructor(
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    @InjectModel(CustomerOrderEntity.name) private readonly customerOrderModel: Model<CustomerOrderEntity>,
    @InjectModel(CustomerPaymentEntity.name) private readonly customerPaymentModel: Model<CustomerPaymentEntity>,
    @InjectModel(ProductConfigEntity.name) private readonly productConfigModel: Model<ProductConfigEntity>,
    private readonly orderService: OrderService,
    private readonly promotionService: PromotionService,
    private readonly systemConfigService: SystemConfigService,
    private readonly designStorageService: DesignStorageService,
    private readonly customerOrderEventService: CustomerOrderEventService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  // -------------------------------------------------------------------------
  // Backfill Luồng A (plan §12.5): đơn khách cũ trong `orders` → staging row
  // `pushedAt=createdAt`, KHÔNG tạo payment record (đơn hệ cũ không có giá
  // chốt — ledger chỉ ghi từ các lần push mới). Chạy 1 lần theo marker; đơn
  // sync về SAU đó được lazy-sync per-customer mỗi lần khách mở listing.
  // -------------------------------------------------------------------------

  async onModuleInit() {
    this.warmAdminCache();
    const MARKER = 'customer_orders_backfill_v1';
    try {
      const done = await this.systemConfigService.get<string>(MARKER);
      if (done) return;
      const customers = await this.customerOrderModel.db
        .collection('customers')
        .find({ deletedAt: null, $or: [{ userSku: { $ne: '' } }, { userEmail: { $ne: '' } }] })
        .project({ _id: 1, userSku: 1, userEmail: 1 })
        .toArray();
      let total = 0;
      for (const c of customers) {
        total += await this.syncLegacyOrdersForCustomer({
          _id: c._id,
          userSku: (c.userSku as string) || '',
          userEmail: (c.userEmail as string) || '',
        });
      }
      await this.systemConfigService.set(MARKER, new Date().toISOString(), 'Backfill staging customer_orders Luồng A');
      if (total > 0) console.log(`[customer-orders-backfill] created ${total} staging rows for legacy orders`);
    } catch (err) {
      console.error('[customer-orders-backfill] failed:', (err as Error).message);
    }
  }

  /**
   * Tạo staging row cho các đơn `OrderEntity` của khách CHƯA có trong staging
   * (đơn Luồng A sync từ hệ cũ) — idempotent nhờ unique (customerId, orderKey)
   * + insertMany ordered:false nuốt lỗi trùng. 1 đơn cũ = 1 staging doc 1 item.
   */
  private async syncLegacyOrdersForCustomer(
    customer: {
      _id: unknown;
      userSku: string;
      userEmail: string;
    },
    /** Chỉ xét đơn `createdAt ≥ since` (đồng bộ tăng dần) — bỏ trống = toàn bộ lịch sử của khách. */
    since?: Date,
  ): Promise<number> {
    if (!customer.userSku && !customer.userEmail) return 0;
    const customerId = String(customer._id);
    const stagedPids = (
      await this.customerOrderModel.distinct('items.productionId', { customerId })
    ).filter((p): p is string => !!p);
    const missing = await this.orderModel
      .find({
        userSku: customer.userSku,
        // Bảng `customers` lưu email chữ thường (CustomerService.sync) còn đơn import giữ nguyên chữ hoa/thường.
        userEmail: customer.userEmail ? { $regex: `^${escapeRegex(customer.userEmail)}$`, $options: 'i' } : customer.userEmail,
        deletedAt: { $exists: false },
        ...(since ? { createdAt: { $gte: since } } : {}),
        ...(stagedPids.length > 0 ? { productionId: { $nin: stagedPids } } : {}),
      })
      .select('productionId orderId type color size quantity mockupUrl printMethod productLine designs shippingAddress productConfigId createdAt')
      .lean();
    if (missing.length === 0) return 0;

    const docs = missing.map((o) => ({
      customerId,
      userSku: customer.userSku,
      userEmail: customer.userEmail,
      orderKey: `legacy-${(o.productionId || '').toLowerCase()}`,
      orderId: o.orderId || o.productionId,
      source: 'sync' as const,
      status: 'pending' as const,
      shippingAddress: o.shippingAddress,
      items: [
        {
          type: o.type,
          color: o.color,
          size: o.size,
          quantity: o.quantity ?? 1,
          mockupUrl: o.mockupUrl,
          printMethod: o.printMethod,
          productLine: o.productLine,
          designs: o.designs,
          productConfigId: o.productConfigId ? String(o.productConfigId) : undefined,
          productionId: o.productionId,
        },
      ],
      pushedAt: o.createdAt ?? new Date(),
    }));
    try {
      const res = await this.customerOrderModel.insertMany(docs, { ordered: false });
      return res.length;
    } catch (err) {
      // BulkWriteError vì trùng orderKey (đã staged bởi request song song) — phần không trùng vẫn được insert.
      const inserted = (err as { insertedDocs?: unknown[] }).insertedDocs?.length ?? 0;
      return inserted;
    }
  }

  private static readonly LEGACY_SYNC_WATERMARK_KEY = 'customer_orders_sync_watermark';
  private static readonly LEGACY_SYNC_LOCK_KEY = 'customer_orders_sync_lock';
  /** Khoá chạy coi như mồ côi sau 15 phút (process chết giữa chừng) → lần sau chiếm lại. */
  private static readonly LEGACY_SYNC_LOCK_STALE_MS = 15 * 60_000;
  /** Admin đọc chỉ chờ đồng bộ tối đa chừng này; lâu hơn thì trả dữ liệu hiện có, đồng bộ tiếp ở nền. */
  private static readonly LEGACY_SYNC_WAIT_MS = 3_000;
  private legacySyncInflight: Promise<number> | null = null;
  private legacySyncAt = 0;

  /**
   * Đồng bộ đơn Luồng A (import nội bộ ở xưởng) vào staging `customer_orders` cho MỌI khách — 07/09/2026.
   * Trước đây staging chỉ được bồi khi CHÍNH khách đó mở portal hoặc 1 lần backfill lúc boot, nên hub
   * `/hub/orders` lọc "hôm nay" trống dù xưởng nhận ~200 đơn/ngày.
   *
   * Nguồn tươi: cron 5 phút + gọi trước mọi lần admin đọc (throttle 60 s; request đang chạy dùng chung promise,
   * và admin chỉ chờ tối đa `LEGACY_SYNC_WAIT_MS` — xem `awaitLegacySync`). Cách chạy:
   * - tăng dần: quét `orders.createdAt ≥ watermark − 15'` (createdAt luôn là giờ ghi DB — import `$setOnInsert`
   *   `new Date()`, không backdate) → chồng lấn an toàn, idempotent nhờ unique `(customerId, orderKey)`;
   * - `full=true` (cron 03:30 hằng ngày + lần đầu chưa có mốc): quét toàn bộ lịch sử → bắt mọi thứ lọt lưới
   *   (khách khôi phục sau xoá mềm, lần chạy hỏng, mốc bị chỉnh tay…);
   * - khoá phân tán bằng document `system_configs` (claim atomic, mồ côi 15') → cron/warm-up/nhiều process
   *   không chạy chồng nhau (07/09 trên prod đã thấy 2 lần chạy song song cùng mốc — vô hại vì idempotent
   *   nhưng tốn gấp đôi);
   * - mốc đọc/ghi THẲNG collection (không qua SystemConfigService: get() cache Redis 1 giờ nên chỉnh tay trong
   *   Mongo không tác dụng; set() = findOne+create nên chạy sát nhau văng E11000);
   * - từng khách bọc try/catch: 1 khách lỗi không chặn khách khác; có lỗi thì KHÔNG đẩy mốc (lần sau quét lại);
   * - bỏ đơn `deletedAt` (xoá mềm) và đơn không có `userSku` (không biết của seller nào);
   * - cặp (userSku, email chữ thường) chưa có trong `customers` → tạo chỗ giữ như `CustomerService.sync`;
   *   khách đã xoá mềm → bỏ qua;
   * - có dòng mới → xoá cache admin (counts/stats) để tab và số liệu đổi ngay.
   */
  @Cron('*/5 * * * *', { name: 'customer-orders-legacy-sync' })
  syncLegacyOrdersIncremental(): Promise<number> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return Promise.resolve(0);

    return this.runLegacySync({ full: false, force: false });
  }

  @Cron('30 3 * * *', { name: 'customer-orders-legacy-sync-full', timeZone: 'Asia/Ho_Chi_Minh' })
  syncLegacyOrdersFull(): Promise<number> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return Promise.resolve(0);

    return this.runLegacySync({ full: true, force: true });
  }

  /** Admin đọc: đảm bảo đã đồng bộ (hoặc đang đồng bộ) nhưng không bao giờ chờ quá `LEGACY_SYNC_WAIT_MS`. */
  private async awaitLegacySync(): Promise<void> {
    const run = this.runLegacySync({ full: false, force: false });
    await Promise.race([run.catch(() => 0), new Promise<void>((r) => setTimeout(r, CustomerOrderService.LEGACY_SYNC_WAIT_MS).unref())]);
  }

  private runLegacySync(opts: { full: boolean; force: boolean }): Promise<number> {
    if (this.legacySyncInflight) return this.legacySyncInflight;
    if (!opts.force && Date.now() - this.legacySyncAt < 60_000) return Promise.resolve(0);
    this.legacySyncInflight = this.executeLegacySync(opts.full).finally(() => {
      this.legacySyncAt = Date.now();
      this.legacySyncInflight = null;
    });
    return this.legacySyncInflight;
  }

  private async executeLegacySync(full: boolean): Promise<number> {
    const configs = this.customerOrderModel.db.collection('system_configs');
    const now = new Date();
    // Khoá phân tán: chiếm nếu chưa có hoặc mồ côi.
    const lock = await configs.findOneAndUpdate(
      {
        key: CustomerOrderService.LEGACY_SYNC_LOCK_KEY,
        $or: [{ 'value.lockedAt': { $exists: false } }, { 'value.lockedAt': null }, { 'value.lockedAt': { $lt: new Date(now.getTime() - CustomerOrderService.LEGACY_SYNC_LOCK_STALE_MS) } }],
      },
      { $set: { 'value.lockedAt': now, 'value.pid': process.pid, updatedAt: now } },
      { returnDocument: 'after' },
    );
    const lockDoc = lock && typeof lock === 'object' && 'value' in lock && !(lock as { key?: string }).key ? (lock as { value: unknown }).value : lock;
    if (!lockDoc) {
      // Chưa có document khoá → tạo (đua với process khác thì E11000 → coi như thua, lần sau).
      try {
        await configs.insertOne({ key: CustomerOrderService.LEGACY_SYNC_LOCK_KEY, value: { lockedAt: now, pid: process.pid }, description: 'Khoá chạy đồng bộ đơn Luồng A vào staging', createdAt: now, updatedAt: now });
      } catch {
        return 0;
      }
    }
    const release = () => configs.updateOne({ key: CustomerOrderService.LEGACY_SYNC_LOCK_KEY }, { $set: { 'value.lockedAt': null, updatedAt: new Date() } }).catch(() => undefined);

    try {
      const OVERLAP_MS = 15 * 60_000;
      const wmDoc = await configs.findOne<{ value?: unknown }>({ key: CustomerOrderService.LEGACY_SYNC_WATERMARK_KEY }, { projection: { value: 1 } });
      const wm = typeof wmDoc?.value === 'string' ? new Date(wmDoc.value) : null;
      const runFull = full || !wm || Number.isNaN(wm.getTime());
      const since = runFull ? undefined : new Date(wm.getTime() - OVERLAP_MS);

      const groups = await this.orderModel.aggregate<{ _id: { userSku: string; userEmail: string }; maxAt: Date }>([
        { $match: { ...(since ? { createdAt: { $gte: since } } : {}), userSku: { $nin: [null, ''] }, deletedAt: { $exists: false } } },
        { $group: { _id: { userSku: '$userSku', userEmail: { $toLower: { $trim: { input: { $ifNull: ['$userEmail', ''] } } } } }, maxAt: { $max: '$createdAt' } } },
      ]);
      const customers = this.customerOrderModel.db.collection('customers');
      let total = 0;
      let failed = 0;
      let maxAt = since ?? new Date(0);
      for (const g of groups) {
        try {
          const filter = { userSku: g._id.userSku, userEmail: g._id.userEmail || '' };
          const res = await customers.findOneAndUpdate(
            filter,
            { $setOnInsert: { ...filter, source: 'sync', password: '', createdAt: new Date(), updatedAt: new Date() } },
            { upsert: true, returnDocument: 'after', projection: { _id: 1, userSku: 1, userEmail: 1, deletedAt: 1 } },
          );
          const c = (res && typeof res === 'object' && 'value' in res && !(res as { _id?: unknown })._id ? (res as { value: unknown }).value : res) as
            | { _id: unknown; userSku?: string; userEmail?: string; deletedAt?: Date | null }
            | null;
          if (!c || c.deletedAt) continue;
          total += await this.syncLegacyOrdersForCustomer({ _id: c._id, userSku: c.userSku || '', userEmail: c.userEmail || '' }, since);
          if (g.maxAt > maxAt) maxAt = g.maxAt;
        } catch (err) {
          failed++;
          console.error(`[customer-orders-sync] khách ${g._id.userSku}/${g._id.userEmail} lỗi: ${(err as Error).message}`);
        }
      }
      // Đẩy mốc chỉ khi không khách nào lỗi; quét toàn bộ mà không có đơn thì giữ mốc cũ.
      if (failed === 0 && groups.length > 0) {
        await configs.updateOne(
          { key: CustomerOrderService.LEGACY_SYNC_WATERMARK_KEY },
          {
            $set: { value: maxAt.toISOString(), description: 'Mốc createdAt đơn Luồng A đã đồng bộ vào staging customer_orders', updatedAt: new Date() },
            $setOnInsert: { key: CustomerOrderService.LEGACY_SYNC_WATERMARK_KEY, createdAt: new Date() },
          },
          { upsert: true },
        );
      }
      if (total > 0) this.adminCache.clear();
      if (total > 0 || failed > 0 || runFull) {
        console.log(`[customer-orders-sync] ${runFull ? 'FULL' : 'incremental'} +${total} staging rows · ${groups.length} khách · lỗi ${failed}${since ? ` · từ ${since.toISOString()}` : ''}`);
      }
      return total;
    } catch (err) {
      console.error('[customer-orders-sync] failed:', (err as Error).message);
      return 0;
    } finally {
      await release();
    }
  }

  // -------------------------------------------------------------------------
  // Helpers chung
  // -------------------------------------------------------------------------

  /**
   * Sinh `productionId` random KHÔNG đụng đơn đã có — cấp NGAY lúc tạo/import
   * staging (mã đi xuyên suốt portal → xưởng) nên phải check cả `orders` lẫn
   * item staging trong `customer_orders`. Retry vài lần cho chắc (không gian
   * mã ~6.7 nghìn tỷ, va chạm cực hiếm).
   */
  private async generateUniqueProductionId(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomProductionId();
      const [inOrders, inStaging] = await Promise.all([
        this.orderModel.exists({ productionId: candidate }),
        this.customerOrderModel.exists({ 'items.productionId': candidate }),
      ]);
      if (!inOrders && !inStaging) return candidate;
    }
    throw new Error('Không thể sinh mã đơn hàng, vui lòng thử lại');
  }

  /** Cấp mã cho mọi item chưa có `productionId` (tạo form / import CSV / thêm item khi sửa pending). */
  private async assignProductionIds(items: CustomerOrderItem[]): Promise<CustomerOrderItem[]> {
    for (const item of items) {
      if (!item.productionId) item.productionId = await this.generateUniqueProductionId();
    }
    return items;
  }

  /** Cutoff Completed = now − N ngày (N từ system_configs, plan §12.3). */
  private async getCompletedCutoff(): Promise<Date> {
    const days =
      (await this.systemConfigService.get<number>(CUSTOMER_ORDER_COMPLETED_DAYS_KEY)) ??
      CUSTOMER_ORDER_COMPLETED_DAYS_DEFAULT;
    return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
  }

  /**
   * Pipeline aggregation dùng CHUNG listing + counts: $lookup orders theo
   * `items[].productionId` + $addFields `statusDerived`/`heldAny`/`reworkAny`.
   * MIRROR logic JS `deriveItemStatus`/`isReworkBadge`/`deriveOrderStatus` —
   * đổi 1 nơi nhớ đổi nơi kia.
   */
  /** `customerId = null` → không scope theo khách (khu quản trị `/hub` đọc MỌI seller — chỉ Admin gọi). */
  private buildDerivePipeline(customerId: string | null, completedCutoff: Date): Record<string, unknown>[] {
    const progressExpr = {
      $switch: {
        branches: [
          {
            case: { $ne: [{ $ifNull: ['$$p.fulfillmentCompletedAt', null] }, null] },
            then: { $cond: [{ $lte: ['$$p.fulfillmentCompletedAt', completedCutoff] }, 4, 3] },
          },
          { case: { $ne: [{ $ifNull: ['$$p.currentFulfillmentStage', null] }, null] }, then: 2 },
        ],
        default: 1,
      },
    };
    const reworkCond = {
      $or: [
        { $eq: ['$$p.designerStatus', DesignerStatus.Rework] },
        {
          $and: [
            { $eq: ['$$p.productionErrorSource', 'tool-check'] },
            { $not: [{ $in: [{ $toLower: { $trim: { input: { $ifNull: ['$$p.toolResultNote', ''] } } } }, ['', 'ok']] }] },
          ],
        },
      ],
    };
    return [
      ...(customerId ? [{ $match: { customerId } }] : []),
      {
        // Nối bằng localField/foreignField để DÙNG ĐƯỢC index `productionId_1`.
        // Bản cũ lọc bằng `$expr: { $in: ['$productionId', '$$pids'] }` — `$expr`
        // KHÔNG dùng được index, nên mỗi document staging phải quét TOÀN BỘ
        // `orders`: khách 3.478 đơn × 40.065 đơn sản xuất ≈ 139 triệu lượt quét,
        // listing 71 giây. Dạng này đo lại còn 0,5 giây, kết quả khớp từng đơn.
        //
        // `productionId: { $ne: null }` là chốt chặn, KHÔNG phải trang trí: hai
        // dạng nối chỉ lệch nhau ở chỗ dạng mới còn khớp cả đơn có
        // `productionId` null/thiếu (khi `items` rỗng hoặc item thiếu
        // `productionId`). Entity khai `required: true, unique: true` nên đơn
        // như vậy không tồn tại, chốt này giữ cho tương lai. Xem ORD-18.
        $lookup: {
          from: 'orders',
          localField: 'items.productionId',
          foreignField: 'productionId',
          pipeline: [
            { $match: { productionId: { $ne: null } } },
            {
              $project: Object.fromEntries(PROD_DERIVE_FIELDS.split(' ').map((f) => [f, 1])),
            },
          ],
          as: 'prodOrders',
        },
      },
      {
        $addFields: {
          activeProd: {
            $filter: {
              input: '$prodOrders',
              as: 'p',
              cond: { $eq: [{ $ifNull: ['$$p.cancelledAt', null] }, null] },
            },
          },
        },
      },
      {
        $addFields: {
          statusDerived: {
            $switch: {
              branches: [
                { case: { $eq: ['$status', 'cancelled'] }, then: CustomerOrderStatus.Cancelled },
                {
                  case: { $ne: [{ $ifNull: ['$refundedAt', null] }, null] },
                  then: CustomerOrderStatus.Refunded,
                },
                { case: { $eq: [{ $ifNull: ['$pushedAt', null] }, null] }, then: CustomerOrderStatus.Pending },
                { case: { $eq: [{ $size: '$activeProd' }, 0] }, then: CustomerOrderStatus.Cancelled },
              ],
              default: {
                $let: {
                  vars: { minP: { $min: { $map: { input: '$activeProd', as: 'p', in: progressExpr } } } },
                  in: {
                    $switch: {
                      branches: [
                        { case: { $eq: ['$$minP', 1] }, then: CustomerOrderStatus.Processing },
                        { case: { $eq: ['$$minP', 2] }, then: CustomerOrderStatus.InProduction },
                        { case: { $eq: ['$$minP', 3] }, then: CustomerOrderStatus.Fulfilled },
                      ],
                      default: CustomerOrderStatus.Completed,
                    },
                  },
                },
              },
            },
          },
          heldAny: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: '$activeProd',
                    as: 'p',
                    cond: { $ne: [{ $ifNull: ['$$p.heldAt', null] }, null] },
                  },
                },
              },
              0,
            ],
          },
          reworkAny: {
            $gt: [{ $size: { $filter: { input: '$activeProd', as: 'p', cond: reworkCond } } }, 0],
          },
          sortAt: { $ifNull: ['$pushedAt', '$createdAt'] },
        },
      },
    ];
  }

  /**
   * Vận đơn hiển thị cho seller: ưu tiên mã KHÁCH TỰ CẤP lưu trên item, sau đó
   * tới vận đơn ghi trên đơn sản xuất, cuối cùng là snapshot VNP lúc mua label.
   *
   * Cố ý CÓ `labelUrl`: đây là đơn của chính seller, hệ cũ cũng cho họ tải label
   * ("Download Shipping Label"). Trang tra cứu CÔNG KHAI thì vẫn giấu — luật đó
   * nằm ở `public-track.service.ts`, không đụng tới đây.
   */
  private static trackingChoSeller(
    itemTracking?: ProductionOrderTracking,
    prod?: ProdDeriveFields,
  ): ProductionOrderTracking | undefined {
    if (hasProductionOrderTracking(itemTracking)) return itemTracking;
    const onOrder = (prod as { tracking?: ProductionOrderTracking } | undefined)?.tracking;
    if (hasProductionOrderTracking(onOrder)) return onOrder;
    const vnp = (prod as { vnpShipment?: { trackingCode?: string; labelUrl?: string; cancelledAt?: Date } } | undefined)?.vnpShipment;
    if (!vnp || vnp.cancelledAt) return undefined;
    const merged = { number: vnp.trackingCode, labelUrl: vnp.labelUrl };

    return hasProductionOrderTracking(merged) ? normalizeProductionOrderTracking(merged) : undefined;
  }

  /**
   * Vận đơn cho khu quản trị `/hub/orders`: gộp mã KHÁCH TỰ CẤP trên đơn với
   * snapshot VNP lúc mua label. Khác `trackingChoSeller` ở chỗ có kèm `provider`
   * và `shipmentId` để ops biết cái nào mình mua, cái nào khách tự dán.
   */
  private static shipmentChoHub(prod: Record<string, unknown>): {
    trackingCode?: string;
    carrier?: string;
    labelUrl?: string;
    shipmentId?: string;
    status?: string;
    cancelledAt?: Date;
    provider?: string;
  } | undefined {
    const vnp = prod.vnpShipment as
      | { shipmentId?: string; trackingCode?: string; labelUrl?: string; lastTrackingStatus?: string; cancelledAt?: Date }
      | undefined;
    if (vnp?.shipmentId && !vnp.cancelledAt) {
      return {
        trackingCode: vnp.trackingCode,
        labelUrl: vnp.labelUrl,
        shipmentId: vnp.shipmentId,
        status: vnp.lastTrackingStatus,
        provider: 'vnp',
      };
    }
    const own = prod.tracking as ProductionOrderTracking | undefined;
    if (hasProductionOrderTracking(own)) {
      return { trackingCode: own?.number, carrier: own?.carrier, labelUrl: own?.labelUrl, provider: 'customer' };
    }

    return undefined;
  }

  /** Map staging doc (+ prod orders đã join) → response `CustomerStagingOrder`. */
  private toStagingOrder(
    doc: Record<string, unknown>,
    prodByPid: Map<string, ProdDeriveFields>,
    completedCutoff: Date,
  ): CustomerStagingOrder {
    const rawItems = (doc.items || []) as CustomerOrderItem[];
    const pushed = !!doc.pushedAt;
    const items: CustomerStagingItem[] = rawItems.map((it) => {
      const base: CustomerStagingItem = {
        sku: it.sku,
        merchantSku: it.merchantSku,
        productConfigId: it.productConfigId,
        type: it.type,
        color: it.color,
        size: it.size,
        quantity: it.quantity ?? 1,
        shipMethod: it.shipMethod,
        activeService: it.activeService,
        mockupUrl: it.mockupUrl,
        printMethod: it.printMethod,
        productLine: it.productLine,
        designs: it.designs,
        tracking: CustomerOrderService.trackingChoSeller(it.tracking, prodByPid.get(it.productionId ?? '')),
        priceSnapshot: it.priceSnapshot,
        productionId: it.productionId,
      };
      if (!pushed || !it.productionId) return base;
      const p = prodByPid.get(it.productionId);
      // Đơn nội bộ đã bị xóa (deleteOrder) → coi như hủy.
      if (!p) return { ...base, status: CustomerOrderStatus.Cancelled };
      // Item cũ chưa stamp dòng → lấy từ đơn sản xuất (migration đã điền).
      if (!base.productLine && p.productLine) base.productLine = p.productLine;
      const stage = computeCurrentStage(p);
      return {
        ...base,
        status: deriveItemStatus(p, completedCutoff),
        currentStageKey: p.cancelledAt ? undefined : stage.key,
        currentStageLabel: p.cancelledAt ? undefined : stage.label,
        currentStageAt: p.cancelledAt ? undefined : stage.at,
        held: !!p.heldAt,
        holdReason: p.holdReason,
        rework: isReworkBadge(p),
        cancelledAt: p.cancelledAt,
      };
    });

    // Trạng thái mức ĐƠN = item CHẬM NHẤT trong các item chưa hủy (plan §2).
    let status: CustomerOrderStatus;
    if (doc.status === 'cancelled') status = CustomerOrderStatus.Cancelled;
    else if (doc.refundedAt) status = CustomerOrderStatus.Refunded;
    else if (!pushed) status = CustomerOrderStatus.Pending;
    else {
      const active = items.filter((i) => i.status && i.status !== CustomerOrderStatus.Cancelled);
      if (active.length === 0) status = CustomerOrderStatus.Cancelled;
      else {
        let min = Number.POSITIVE_INFINITY;
        let minStatus = CustomerOrderStatus.Processing;
        for (const i of active) {
          const p = CUSTOMER_ORDER_STATUS_PROGRESS[i.status as CustomerOrderStatus] ?? 1;
          if (p < min) {
            min = p;
            minStatus = i.status as CustomerOrderStatus;
          }
        }
        status = minStatus;
      }
    }

    const totalAmount = items.reduce((s, i) => s + (i.priceSnapshot?.lineTotal ?? 0), 0);
    return {
      _id: String(doc._id),
      orderKey: doc.orderKey as string,
      orderId: doc.orderId as string | undefined,
      identifier: doc.identifier as string | undefined,
      orderName: doc.orderName as string | undefined,
      source: (doc.source as CustomerStagingOrder['source']) ?? 'form',
      productLines: [...new Set(items.map((i) => i.productLine).filter((x): x is ProductLine => !!x))],
      status,
      held: items.some((i) => i.held),
      rework: items.some((i) => i.rework),
      note: doc.note as string | undefined,
      shippingAddress: doc.shippingAddress as ProductionOrderShippingAddress | undefined,
      items,
      totalQuantity: items.reduce((s, i) => s + (i.quantity ?? 1), 0),
      totalAmount: totalAmount > 0 ? Math.round(totalAmount * 100) / 100 : undefined,
      pushedAt: (doc.pushedAt as Date | null) ?? undefined,
      createdAt: doc.createdAt as Date | undefined,
      cancelledAt: (doc.cancelledAt as Date | null) ?? undefined,
      cancelReason: doc.cancelReason as string | undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Chốt giá (plan §13.2) — dùng chung import (giá tham khảo) + preview + push
  // -------------------------------------------------------------------------

  /** Load ProductConfig theo SKU (variations) + theo type (fullName) cho 1 batch items. */
  private async buildPricingContext(
    items: Array<{ sku?: string; type?: string }>,
  ): Promise<PricingContext> {
    const skus = [...new Set(items.map((i) => i.sku?.trim().toUpperCase()).filter((s): s is string => !!s))];
    const types = [...new Set(items.map((i) => i.type?.trim()).filter((t): t is string => !!t))];
    const or: Record<string, unknown>[] = [];
    if (skus.length > 0) or.push({ 'variations.sku': { $in: skus } });
    if (types.length > 0)
      or.push({ fullName: { $in: types.map((t) => new RegExp(`^${escapeRegex(t)}$`, 'i')) } });
    const bySku = new Map<string, { config: PricingConfig; variation: PricingConfig['variations'][number] }>();
    const byType = new Map<string, PricingConfig>();
    const byId = new Map<string, PricingConfig>();
    if (or.length === 0) return { bySku, byType, byId };

    const configs = (await this.productConfigModel
      .find({ $or: or })
      .select('fullName productCategoryId status variations mockup printArea productLine')
      .lean()) as unknown as Array<PricingConfig & { _id: unknown }>;
    for (const c of configs) {
      const config: PricingConfig = {
        _id: String(c._id),
        fullName: c.fullName,
        productCategoryId: c.productCategoryId ? String(c.productCategoryId) : undefined,
        status: c.status,
        mockup: c.mockup,
        printArea: c.printArea,
        productLine: c.productLine,
        variations: c.variations || [],
      };
      byType.set(config.fullName.trim().toLowerCase(), config);
      byId.set(config._id, config);
      for (const v of config.variations) {
        if (v.sku) bySku.set(v.sku.trim().toUpperCase(), { config, variation: v });
      }
    }
    return { bySku, byType, byId };
  }

  /** Chọn variation theo size/color khi item không có SKU (đơn form) — chỉ nhận khi match không mơ hồ. */
  private pickVariation(
    config: PricingConfig,
    size?: string,
    color?: string,
  ): PricingConfig['variations'][number] | undefined {
    const active = config.variations.filter((v) => v.status !== '0');
    if (active.length === 1) return active[0];
    const eq = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
    let candidates = active;
    if (size) candidates = candidates.filter((v) => eq(attrValue(v.attributes, SIZE_LABEL), size));
    if (color) candidates = candidates.filter((v) => eq(attrValue(v.attributes, COLOR_LABEL), color));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  /**
   * Chốt giá 1 item: `cod`/`tiktok` (không dùng ship US của xưởng) →
   * `nonShipCost` fallback `retailPrice`; `express_us`/`economy_us` →
   * `retailPrice` fallback `nonShipCost`; sau đó áp Promotion theo tier
   * (tái dùng promotionMatches/applyPromotionDiscount như customer-catalog).
   */
  private quoteItem(
    item: { sku?: string; type?: string; size?: string; color?: string; quantity?: number; shipMethod?: CustomerShipMethod },
    ctx: PricingContext,
    activePromotions: ActivePromotion[],
    tier: number | null,
  ): QuoteResult {
    let config: PricingConfig | undefined;
    let variation: PricingConfig['variations'][number] | undefined;
    if (item.sku?.trim()) {
      const hit = ctx.bySku.get(item.sku.trim().toUpperCase());
      if (!hit) return { error: `SKU "${item.sku.trim()}" không tồn tại trong catalog` };
      config = hit.config;
      variation = hit.variation;
    } else if (item.type?.trim()) {
      config = ctx.byType.get(item.type.trim().toLowerCase());
      if (!config) return { error: `Sản phẩm "${item.type.trim()}" không có trong catalog` };
      variation = this.pickVariation(config, item.size, item.color);
    } else {
      return { error: 'Item thiếu cả sku lẫn type' };
    }

    // Sản phẩm ngừng bán (inactive/hidden) — SKU vẫn nằm trong DB để giữ liên
    // kết dữ liệu cũ, nhưng khách KHÔNG được đặt mới: import fail cả đơn,
    // preview báo đỏ, push fail riêng đơn. KHÔNG trả productConfigId để mọi
    // gate hiện có (found=false / itemErrors) tự chặn.
    if (config.status && config.status !== 'active') {
      return { type: config.fullName, inactive: true, error: `Sản phẩm "${config.fullName}" đã ngừng bán — liên hệ hỗ trợ` };
    }

    const resolved: QuoteResult = {
      productConfigId: config._id,
      productLine: config.productLine,
      type: config.fullName,
      size: attrValue(variation?.attributes, SIZE_LABEL) ?? item.size,
      color: attrValue(variation?.attributes, COLOR_LABEL) ?? item.color,
    };
    if (!variation) return { ...resolved, error: 'Không xác định được biến thể (size/màu) để chốt giá' };

    const shipMethod = item.shipMethod ?? DEFAULT_CUSTOMER_SHIP_METHOD;
    const unitPrice =
      shipMethod === 'cod' || shipMethod === 'tiktok'
        ? variation.nonShipCost ?? variation.retailPrice
        : variation.retailPrice ?? variation.nonShipCost;
    if (unitPrice == null) return { ...resolved, error: 'Biến thể chưa có giá bán' };

    const quantity = item.quantity ?? 1;
    const matched = activePromotions
      .filter((p) =>
        promotionMatches(p, { productConfigId: config._id, productCategoryId: config.productCategoryId, tier, quantity }),
      )
      .map((p) => ({ promotion: p, price: applyPromotionDiscount(unitPrice, p) }))
      .sort((a, b) => a.price - b.price);
    const best = matched[0];
    const effective = best ? best.price : unitPrice;
    return {
      ...resolved,
      weight: variation.weight,
      width: variation.width,
      height: variation.height,
      length: variation.length,
      shipCost: shipMethod === 'cod' || shipMethod === 'tiktok' ? variation.tiktokShipCost : variation.expUsShipCost,
      snapshot: {
        shipMethod,
        unitPrice,
        discountedPrice: best?.price,
        promotionName: best?.promotion.name,
        lineTotal: Math.round(effective * quantity * 100) / 100,
      },
    };
  }

  /**
   * Gom mọi URL design của list items — feed cho `touchUsageForUrls` (tự lọc
   * URL thuộc CDN design, còn lại bỏ qua). Xem DesignStorage plan.
   */
  private collectDesignUrls(items: Array<{ designs?: Record<string, string | undefined> }>): string[] {
    return items.flatMap((it) => Object.values(it.designs ?? {})).filter((u): u is string => !!u);
  }

  // -------------------------------------------------------------------------
  // Đặt đơn form → staging PENDING (plan §2 — KHÔNG gọi importOrders nữa)
  // -------------------------------------------------------------------------

  /**
   * Đòi mockup + design ở MỌI vị trí in bắt buộc, ngay tại máy chủ (ORD-22).
   *
   * Giao diện `new.tsx` đã chặn, nhưng giao diện không phải hàng rào: chỉ cần
   * một lần sửa điều kiện chặn ở đó là đơn rỗng lọt vào. Và hậu quả không dừng
   * ở staging — đơn đi tiếp sang sản xuất rồi TỚI TẬN XƯỞNG mới lộ ra là không
   * có gì để in, lúc đó đã chiếm mã đơn và đã vào hàng đợi soát tool.
   *
   * Luật lấy ĐÚNG như giao diện: `isRequired !== false` (vị trí không set cờ
   * coi như bắt buộc). Hai bên lệch nhau còn tệ hơn không kiểm — khách bị chặn
   * ở một nơi và lọt ở nơi khác thì không ai giải thích được.
   */
  private assertArtworkComplete(
    // Kiểu cấu trúc tối thiểu — dùng CHUNG cho item lúc đặt đơn (ORD-22) và
    // item staging lúc đẩy sản xuất (ORD-25). Một luật, một hàm.
    items: Array<{ type?: string; mockupUrl?: string; designs?: Record<string, string | undefined> }>,
    quotes: QuoteResult[],
    ctx: PricingContext,
  ): void {
    items.forEach((item, i) => {
      const label = quotes[i]?.type ?? item.type ?? `#${i + 1}`;
      if (!item.mockupUrl?.trim()) {
        throw new BadRequestException(customerMessage('missingMockup', label));
      }
      const configId = quotes[i]?.productConfigId;
      const areas = configId ? ctx.byId.get(configId)?.printArea : undefined;
      // Luật design (nới 27/08): chỉ cần 1 design ở MẶT TRƯỚC hoặc MẶT SAU là
      // đủ — không còn đòi đủ mọi vị trí bắt buộc. Sản phẩm không có front/back
      // → cần 1 design ở bất kỳ vị trí bắt buộc nào; không có vị trí bắt buộc
      // nào → chỉ đòi mockup. `designAcceptKeys` là nguồn luật duy nhất (dùng
      // chung với cảnh báo preview import).
      const acceptKeys = designAcceptKeys(areas);
      if (acceptKeys.length > 0 && !acceptKeys.some((k) => !!item.designs?.[k]?.trim())) {
        // Nhãn tiếng Việt lấy từ bản đồ dùng chung với FE, khỏi lệch chữ. Kèm
        // key gốc trong ngoặc vì bản đồ nhãn CHỈ có tiếng Việt — người đọc bản
        // tiếng Anh vẫn cần biết chính xác vị trí nào.
        const names = acceptKeys
          .map((k) => `${(PRODUCT_PRINT_AREA_LABEL_MAP as Record<string, string>)[k] ?? k} (${k})`)
          .join(' hoặc ');
        throw new BadRequestException(customerMessage('missingDesign', label, names));
      }
    });
  }

  async placeOrder(customer: CustomerDocument, dto: PlaceCustomerOrderDto): Promise<CustomerStagingOrderResDto> {
    const ctx = await this.buildPricingContext(dto.items);
    const [activePromotions, cutoff] = await Promise.all([
      this.promotionService.getActiveInDateRange(),
      this.getCompletedCutoff(),
    ]);
    const tier = customer.tier ?? null;

    const quotes = dto.items.map((item) => this.quoteItem(item, ctx, activePromotions, tier));
    this.assertArtworkComplete(dto.items, quotes, ctx);

    const items: CustomerOrderItem[] = dto.items.map((item, i) => {
      const q = quotes[i];
      return {
        type: q.type ?? item.type,
        color: q.color ?? item.color,
        size: q.size ?? item.size,
        productConfigId: q.productConfigId,
        quantity: item.quantity ?? 1,
        shipMethod: DEFAULT_CUSTOMER_SHIP_METHOD,
        mockupUrl: item.mockupUrl,
        printMethod: item.printMethod,
        productLine: q.productLine,
        // Khách khai đè được, còn lại lấy theo biến thể — xưởng và bước mua vận
        // đơn luôn có số, không phải gõ tay (xem QuoteResult.weight).
        weight: item.weight ?? q.weight,
        width: item.width ?? q.width,
        height: item.height ?? q.height,
        length: item.length ?? q.length,
        designs: item.designs,
        priceSnapshot: q.snapshot,
      };
    });
    await this.assignProductionIds(items);

    const doc = await this.customerOrderModel.create({
      customerId: String(customer._id),
      userSku: customer.userSku,
      userEmail: customer.userEmail,
      orderKey: `form-${new Types.ObjectId().toString()}`,
      source: 'form',
      status: 'pending',
      shippingAddress: dto.shippingAddress,
      note: dto.referent,
      items,
    });

    // Design đã upload lên CDN → reset sliding window lastUsedAt (dedup/lifecycle).
    await this.designStorageService.touchUsageForUrls(this.collectDesignUrls(items));

    return { success: true, data: this.toStagingOrder(doc.toObject(), new Map(), cutoff) };
  }

  // -------------------------------------------------------------------------
  // Listing + counts (derive 8 status, plan §1 + §9)
  // -------------------------------------------------------------------------

  async listOrders(
    customer: CustomerDocument,
    dto: GetCustomerStagingOrdersDto,
  ): Promise<GetCustomerStagingOrdersResDto> {
    // Lazy-sync đơn Luồng A mới (sync hệ cũ sau backfill) trước khi list.
    await this.syncLegacyOrdersForCustomer({
      _id: customer._id,
      userSku: customer.userSku,
      userEmail: customer.userEmail,
    });

    const cutoff = await this.getCompletedCutoff();
    const search = dto.search?.trim()
      ? [{ $match: { $or: [{ orderId: { $regex: escapeRegex(dto.search.trim()), $options: 'i' } }, { orderName: { $regex: escapeRegex(dto.search.trim()), $options: 'i' } }, { 'items.productionId': { $regex: escapeRegex(dto.search.trim()), $options: 'i' } }, { 'items.sku': { $regex: escapeRegex(dto.search.trim()), $options: 'i' } }] } }]
      : [];
    const candidatePids = await this.loadCandidatePids({ status: dto.status, held: !!dto.held, cutoff });
    const pipeline = this.buildPagedListPipeline({
      customerId: String(customer._id),
      candidatePids,
      cutoff,
      preStages: search,
      productLine: dto.productLine,
      status: dto.status,
      held: !!dto.held,
      skip: (dto.page - 1) * dto.limit,
      limit: dto.limit,
    });

    const [res] = await this.customerOrderModel.aggregate<{
      page: Array<Record<string, unknown> & { prodOrders?: ProdDeriveFields[] }>;
      total: Array<{ n: number }>;
    }>(pipeline as never[], { allowDiskUse: true });

    const data = (res?.page ?? []).map((doc) => {
      const prodByPid = new Map<string, ProdDeriveFields>(
        (doc.prodOrders ?? []).map((p) => [p.productionId as string, p]),
      );
      return this.toStagingOrder(doc, prodByPid, cutoff);
    });
    return { success: true, data, total: res?.total?.[0]?.n ?? 0 };
  }

  async getCounts(customer: CustomerDocument, dto: GetCustomerOrderCountsDto = {}): Promise<GetCustomerOrderCountsResDto> {
    const cutoff = await this.getCompletedCutoff();
    const [pipeline, linePipeline] = this.countsPipelines(String(customer._id), cutoff, dto.productLine);
    const [rows, lineRows] = await Promise.all([
      this.customerOrderModel.aggregate<{ _id: string; count: number; held: number; rework: number }>(pipeline as never[]),
      this.customerOrderModel.aggregate<{ _id: ProductLine; count: number }>(linePipeline as never[]),
    ]);
    return { success: true, data: this.assembleCounts(rows, lineRows) };
  }

  /** Gom 2 kết quả aggregate (theo trạng thái + theo dòng) thành `CustomerOrderCounts` — dùng chung khách + `/hub`. */
  private assembleCounts(
    rows: Array<{ _id: string; count: number; held: number; rework: number }>,
    lineRows: Array<{ _id: ProductLine; count: number }>,
  ): CustomerOrderCounts {
    const counts: CustomerOrderCounts = {
      all: 0,
      pending: 0,
      processing: 0,
      inProduction: 0,
      fulfilled: 0,
      completed: 0,
      refunded: 0,
      cancelled: 0,
      held: 0,
      rework: 0,
    };
    const keyMap: Record<string, keyof CustomerOrderCounts> = {
      [CustomerOrderStatus.Pending]: 'pending',
      [CustomerOrderStatus.Processing]: 'processing',
      [CustomerOrderStatus.InProduction]: 'inProduction',
      [CustomerOrderStatus.Fulfilled]: 'fulfilled',
      [CustomerOrderStatus.Completed]: 'completed',
      [CustomerOrderStatus.Refunded]: 'refunded',
      [CustomerOrderStatus.Cancelled]: 'cancelled',
    };
    for (const r of rows) {
      counts.all += r.count;
      const k = keyMap[r._id];
      if (k) counts[k] += r.count;
      counts.held += r.held;
      counts.rework += r.rework;
    }
    counts.byProductLine = Object.fromEntries(lineRows.map((r) => [r._id, r.count])) as CustomerOrderCounts['byProductLine'];
    return counts;
  }

  /** `productLine` → chỉ đếm đơn có ≥1 item thuộc dòng (cùng điều kiện với filter listing). */
  private countsPipelines(
    customerId: string | null,
    cutoff: Date,
    productLine?: ProductLine,
    extraStages: Record<string, unknown>[] = [],
  ): [Record<string, unknown>[], Record<string, unknown>[]] {
    // Cùng luật với listing: chỉ `items.productLine` (đã stamp/backfill) — không fallback `prodOrders`, kẻo tab đếm lệch danh sách.
    const lineMatch: Record<string, unknown>[] = [...extraStages, ...(productLine ? [{ $match: { 'items.productLine': productLine } }] : [])];
    const byStatus = [
      ...this.buildDerivePipeline(customerId, cutoff),
      ...lineMatch,
      {
        $group: {
          _id: '$statusDerived',
          count: { $sum: 1 },
          held: { $sum: { $cond: ['$heldAny', 1, 0] } },
          rework: { $sum: { $cond: ['$reworkAny', 1, 0] } },
        },
      },
    ];
    const byLine = [
      ...this.buildDerivePipeline(customerId, cutoff),
      ...lineMatch,
      { $project: { lines: { $setUnion: [{ $ifNull: ['$items.productLine', []] }, []] } } },
      { $unwind: '$lines' },
      { $match: { lines: { $in: PRODUCT_LINES } } },
      { $group: { _id: '$lines', count: { $sum: 1 } } },
    ];
    return [byStatus, byLine];
  }

  // -------------------------------------------------------------------------
  // Khu quản trị `/hub` trong Seller Portal (SellerPortal.md §9) — Admin đọc
  // đơn staging của MỌI seller. CHỈ ĐỌC: mọi thao tác trên đơn khách vẫn đi
  // qua mạo danh (token khách) để giữ nguyên rào + audit sẵn có.
  // -------------------------------------------------------------------------

  /**
   * Pipeline phân trang dùng chung khách + admin. Hai đường:
   * - **Nhanh** (không lọc trạng thái/held/chặng): lọc mức document (khách, ngày, tìm, `items.productLine`),
   *   sắp xếp + cắt trang TRƯỚC, rồi mới `$lookup` đơn sản xuất cho đúng `limit` dòng → ~0,1 s thay vì 6 s
   *   (trước đây `$lookup` cho toàn bộ 38k đơn staging rồi mới cắt trang — SellerPortal.md §9.2).
   * - **Đầy đủ** (có `status`/`held`/`stage`): trạng thái dẫn xuất cần `prodOrders` → derive trên tập đã lọc
   *   mức document (vẫn nặng nhưng nhỏ hơn nhờ lọc trước).
   * `productLine` chỉ dùng `items.productLine` (đã stamp/backfill PRD-8); không còn fallback `prodOrders.productLine`.
   */
  private static readonly CANDIDATE_PIDS_CAP = 20_000;

  /**
   * "Tra ngược" từ bảng `orders` để thu hẹp tập staging TRƯỚC khi derive (đường đầy đủ phải
   * `$lookup` + tính trạng thái trên CẢ 38k document ≈ 4,6 s). Mỗi điều kiện lọc suy ra tập
   * `productionId` của đơn sản xuất có thể làm document thỏa (điều kiện CẦN, không phải đủ —
   * `$match statusDerived/heldAny/stage` sau derive vẫn chốt kết quả, nên semantics không đổi):
   * - `stage` → đơn SX chưa hủy đang ở chặng đó (`workshopStageSwitchExpr`);
   * - `status` in-production → có `currentFulfillmentStage`, chưa xong; processing → chưa vào
   *   fulfillment; fulfilled → xong sau `cutoff`; held → `heldAt` khác null.
   * Nhiều điều kiện → giao tập. Trả null khi không có điều kiện áp dụng được hoặc tập quá lớn
   * (completed/cancelled/refunded → đường đầy đủ).
   */
  private async loadCandidatePids(opts: { stage?: string; status?: CustomerOrderStatus; held: boolean; cutoff: Date }): Promise<string[] | null> {
    const col = this.customerOrderModel.db.collection('orders');
    const sets: Array<Set<string>> = [];
    const collect = async (cursor: AsyncIterable<{ productionId?: string }>) => {
      const set = new Set<string>();
      for await (const d of cursor) if (d.productionId) set.add(d.productionId);
      sets.push(set);
    };
    if (opts.stage) {
      await collect(
        col.aggregate<{ productionId?: string }>([
          { $match: { cancelledAt: null, productionId: { $ne: null } } },
          { $addFields: { stageKey: workshopStageSwitchExpr('$') } },
          { $match: { stageKey: opts.stage } },
          { $project: { _id: 0, productionId: 1 } },
        ]),
      );
    }
    const statusFilter: Record<string, unknown> | null =
      opts.status === CustomerOrderStatus.InProduction
        ? { cancelledAt: null, fulfillmentCompletedAt: null, currentFulfillmentStage: { $ne: null } }
        : opts.status === CustomerOrderStatus.Processing
          ? { cancelledAt: null, fulfillmentCompletedAt: null, currentFulfillmentStage: null }
          : opts.status === CustomerOrderStatus.Fulfilled
            ? { cancelledAt: null, fulfillmentCompletedAt: { $gt: opts.cutoff } }
            : null;
    if (statusFilter) await collect(col.find<{ productionId?: string }>(statusFilter, { projection: { _id: 0, productionId: 1 } }));
    if (opts.held) await collect(col.find<{ productionId?: string }>({ cancelledAt: null, heldAt: { $ne: null } }, { projection: { _id: 0, productionId: 1 } }));
    if (sets.length === 0) return null;
    const [first, ...rest] = sets;
    const pids = [...first].filter((id) => rest.every((s) => s.has(id)));
    return pids.length > CustomerOrderService.CANDIDATE_PIDS_CAP ? null : pids;
  }

  private buildPagedListPipeline(opts: {
    customerId: string | null;
    cutoff: Date;
    preStages: Record<string, unknown>[];
    productLine?: ProductLine;
    status?: CustomerOrderStatus;
    held: boolean;
    postDeriveStages?: Record<string, unknown>[];
    pageTail?: Record<string, unknown>[];
    /** Tập `productionId` ứng viên (từ `loadCandidatePids`) — thu hẹp Ở MỨC DOCUMENT trước khi derive. null = không thu hẹp. */
    candidatePids?: string[] | null;
    skip: number;
    limit: number;
  }): Record<string, unknown>[] {
    const docMatch: Record<string, unknown>[] = [
      ...(opts.customerId ? [{ $match: { customerId: opts.customerId } }] : []),
      ...opts.preStages,
      ...(opts.productLine ? [{ $match: { 'items.productLine': opts.productLine } }] : []),
    ];
    const sortStages = [{ $addFields: { sortAt: { $ifNull: ['$pushedAt', '$createdAt'] } } }, { $sort: { sortAt: -1, _id: -1 } }];
    const derive = this.buildDerivePipeline(null, opts.cutoff);
    // `pending` suy được ở mức document (mirror `statusDerived`: chưa hủy, chưa hoàn tiền, chưa push) → đường nhanh.
    if (opts.status === CustomerOrderStatus.Pending) {
      docMatch.push({ $match: { status: { $ne: 'cancelled' }, refundedAt: null, pushedAt: null } });
    }
    if (opts.candidatePids) docMatch.push({ $match: { 'items.productionId': { $in: opts.candidatePids } } });
    const needsDerive = (!!opts.status && opts.status !== CustomerOrderStatus.Pending) || opts.held || (opts.postDeriveStages?.length ?? 0) > 0;
    if (!needsDerive) {
      return [
        ...docMatch,
        ...sortStages,
        {
          $facet: {
            page: [{ $skip: opts.skip }, { $limit: opts.limit }, ...derive, ...(opts.pageTail ?? [])],
            total: [{ $count: 'n' }],
          },
        },
      ];
    }
    return [
      ...docMatch,
      ...derive,
      ...(opts.status ? [{ $match: { statusDerived: opts.status } }] : []),
      ...(opts.held ? [{ $match: { heldAny: true } }] : []),
      ...(opts.postDeriveStages ?? []),
      ...sortStages,
      {
        $facet: {
          page: [{ $skip: opts.skip }, { $limit: opts.limit }, ...(opts.pageTail ?? [])],
          total: [{ $count: 'n' }],
        },
      },
    ];
  }

  /** Cache ngắn (60 s) cho số đếm/thống kê khu quản trị — quét toàn bộ staging mỗi lần gọi mất ~5 s. */
  /**
   * Cache bộ nhớ cho số liệu admin (counts/stats — quét cả `customer_orders` ≈ 5 s).
   * Kiểu stale-while-revalidate: còn hạn → trả ngay; hết hạn nhưng có bản cũ → trả bản cũ + tính lại NỀN;
   * chưa có → chờ tính (1 lần, các request trùng key dùng chung promise). Admin F5 không bao giờ chờ 5 s lần 2.
   */
  private readonly adminCache = new Map<string, { at: number; value: unknown }>();
  private readonly adminInflight = new Map<string, Promise<unknown>>();
  private static readonly ADMIN_CACHE_MS = 60_000;
  private async cachedAdmin<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.adminCache.get(key);
    const fresh = !!hit && Date.now() - hit.at < CustomerOrderService.ADMIN_CACHE_MS;
    if (fresh) return hit.value as T;
    let inflight = this.adminInflight.get(key) as Promise<T> | undefined;
    if (!inflight) {
      inflight = load()
        .then((value) => {
          this.adminCache.set(key, { at: Date.now(), value });
          return value;
        })
        .finally(() => this.adminInflight.delete(key));
      this.adminInflight.set(key, inflight);
    }
    if (hit) {
      inflight.catch(() => undefined); // bản cũ vẫn trả được; lỗi tính nền chỉ ghi log ở load()
      return hit.value as T;
    }
    return inflight;
  }

  /** Làm ấm cache admin sau khi boot (trang `/hub/orders` mở lần đầu không phải chờ counts/stats ≈ 5 s). */
  private warmAdminCache() {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => {
      void this.getCountsAdmin({}).catch(() => undefined);
      void this.getStatsAdmin().catch(() => undefined);
    }, 10_000).unref();
  }

  /** `$match` khoảng ngày theo `pushedAt ?? createdAt` (giờ VN, cả ngày `dateTo`). Rỗng → []. */
  private static dateRangeStages(dateFrom?: string, dateTo?: string): Record<string, unknown>[] {
    if (!dateFrom && !dateTo) return [];
    const at: Record<string, Date> = {};
    if (dateFrom) at.$gte = new Date(`${dateFrom}T00:00:00+07:00`);
    if (dateTo) at.$lte = new Date(`${dateTo}T23:59:59.999+07:00`);
    return [{ $addFields: { sortAt: { $ifNull: ['$pushedAt', '$createdAt'] } } }, { $match: { sortAt: at } }];
  }

  /** Tra tên xưởng / designer / log mới nhất cho 1 trang kết quả — 3 truy vấn nhỏ theo tập id, không $lookup trong pipeline lớn. */
  private async loadAdminRefs(rows: Array<{ prodOrders?: ProdDeriveFields[] }>): Promise<AdminRefMaps> {
    const prods = rows.flatMap((r) => (r.prodOrders ?? []) as Array<ProdDeriveFields & Record<string, unknown>>);
    const factoryIds = [...new Set(prods.map((p) => p.factoryId).filter((x): x is string => !!x))];
    const userIds = [...new Set(prods.map((p) => p.assignee).filter((x): x is string => !!x))];
    const orderIds = [...new Set(prods.map((p) => String(p._id)))];
    const db = this.customerOrderModel.db;
    const [factories, users, logs] = await Promise.all([
      factoryIds.length ? db.collection('factories').find({ _id: { $in: factoryIds } } as never, { projection: { name: 1, shortName: 1 } }).toArray() : [],
      userIds.length ? db.collection('users').find({ _id: { $in: userIds } } as never, { projection: { fullName: 1, email: 1 } }).toArray() : [],
      orderIds.length
        ? db
            .collection('orderLogs')
            .aggregate([
              { $match: { orderId: { $in: orderIds } } },
              { $sort: { createdAt: -1 } },
              { $group: { _id: '$orderId', action: { $first: '$action' }, field: { $first: '$field' }, userName: { $first: '$userName' }, at: { $first: '$createdAt' }, after: { $first: '$after' } } },
            ])
            .toArray()
        : [],
    ]);
    return {
      factories: new Map(factories.map((f) => [String(f._id), { name: f.name as string | undefined, shortName: f.shortName as string | undefined }])),
      users: new Map(users.map((u) => [String(u._id), ((u.fullName as string | undefined) || (u.email as string | undefined)) ?? ''])),
      logs: new Map(
        logs.map((l) => [
          String(l._id),
          { action: String(l.action), field: l.field as string | undefined, userName: l.userName as string | undefined, at: l.at as Date | undefined, after: l.after },
        ]),
      ),
    };
  }

  private static readonly CUSTOMER_LOOKUP: Record<string, unknown>[] = [
    {
      $lookup: {
        from: 'customers',
        localField: 'customerId',
        foreignField: '_id',
        pipeline: [{ $project: { userSku: 1, userEmail: 1, fullName: 1, tier: 1 } }],
        as: 'customerDocs',
      },
    },
    { $addFields: { customer: { $first: '$customerDocs' } } },
    { $project: { customerDocs: 0 } },
  ];

  private toAdminStagingOrder(
    doc: Record<string, unknown> & { prodOrders?: ProdDeriveFields[]; customer?: Record<string, unknown> },
    cutoff: Date,
    refs?: AdminRefMaps,
  ): AdminCustomerStagingOrder {
    const prodByPid = new Map<string, ProdDeriveFields>((doc.prodOrders ?? []).map((p) => [p.productionId as string, p]));
    const c = doc.customer;
    const base = this.toStagingOrder(doc, prodByPid, cutoff);
    const items = base.items.map((it) => {
      const p = it.productionId ? (prodByPid.get(it.productionId) as (ProdDeriveFields & Record<string, unknown>) | undefined) : undefined;
      if (!p) return it;
      const stage = computeCurrentStage(p);
      const factory = p.factoryId ? refs?.factories.get(String(p.factoryId)) : undefined;
      const log = refs?.logs.get(String(p._id));
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
      return {
        ...it,
        internal: {
          stage: p.fulfillmentCompletedAt ? 'done' : stage.key,
          orderRefId: String(p._id),
          weight: typeof p.weight === 'number' ? p.weight : undefined,
          width: typeof p.width === 'number' ? p.width : undefined,
          height: typeof p.height === 'number' ? p.height : undefined,
          length: typeof p.length === 'number' ? p.length : undefined,
          shipment: CustomerOrderService.shipmentChoHub(p),
          factoryShortName: factory?.shortName,
          factoryName: factory?.name,
          // Xưởng ngoài luồng SX (hiện là US): app xưởng cố ý không hiện đơn này
          // ở bất kỳ danh sách nào, nên hub phải gắn nhãn — ops đẩy xong đi tìm
          // trong app xưởng không thấy là tưởng đơn bốc hơi (phản hồi 08/09/2026).
          outOfProduction: factory?.shortName === EXCLUDED_PRODUCTION_FACTORY_SHORT_NAME || undefined,
          designerName: p.assignee ? refs?.users.get(String(p.assignee)) : undefined,
          designerStatus: str(p.designerStatus),
          priority: typeof p.priority === 'number' ? p.priority : undefined,
          productionError: str(p.productionError),
          productionErrorSource: str(p.productionErrorSource),
          productionErrorNote: str(p.productionErrorNote),
          toolResult: str(p.toolResult),
          toolResultNote: str(p.toolResultNote),
          toolCheckErrorNotes: Array.isArray(p.toolCheckErrorNotes) ? (p.toolCheckErrorNotes as string[]).filter(Boolean) : undefined,
          errorFileNote: str(p.errorFileNote),
          printStatusNote: str(p.printStatusNote),
          designerRejectedReason: str(p.designerRejectedReason),
          holdReason: str(p.holdReason),
          lastLog: log,
        },
      };
    });
    return {
      ...base,
      items,
      customerId: String(doc.customerId),
      customer: c
        ? {
            userSku: c.userSku as string | undefined,
            userEmail: c.userEmail as string | undefined,
            fullName: c.fullName as string | undefined,
            tier: (c.tier as number | null | undefined) ?? null,
          }
        : undefined,
    };
  }

  async listOrdersAdmin(dto: GetAdminCustomerOrdersDto): Promise<GetAdminCustomerOrdersResDto> {
    await this.awaitLegacySync();
    const cutoff = await this.getCompletedCutoff();
    const preStages: Record<string, unknown>[] = [...CustomerOrderService.dateRangeStages(dto.dateFrom, dto.dateTo)];
    if (dto.search?.trim()) {
      const rx = { $regex: escapeRegex(dto.search.trim()), $options: 'i' };
      preStages.push({ $match: { $or: [{ orderId: rx }, { orderName: rx }, { 'items.productionId': rx }, { 'items.sku': rx }, { userSku: rx }, { userEmail: rx }] } });
    }
    const stageStage: Record<string, unknown>[] = dto.stage
      ? [
          {
            // Chặng hiện tại của từng đơn sản xuất (cùng luật `workshopStageSwitchExpr` với trang xưởng + CEO).
            $match: {
              $expr: {
                $in: [
                  dto.stage,
                  {
                    $map: {
                      input: { $filter: { input: '$prodOrders', as: 'p', cond: { $eq: [{ $ifNull: ['$$p.cancelledAt', null] }, null] } } },
                      as: 'p',
                      in: workshopStageSwitchExpr('$$p.'),
                    },
                  },
                ],
              },
            },
          },
        ]
      : [];
    const candidatePids = await this.loadCandidatePids({ stage: dto.stage, status: dto.status, held: !!dto.held, cutoff });
    const pipeline = this.buildPagedListPipeline({
      customerId: dto.customerId ?? null,
      candidatePids,
      cutoff,
      preStages,
      productLine: dto.productLine,
      status: dto.status,
      held: !!dto.held,
      postDeriveStages: stageStage,
      pageTail: CustomerOrderService.CUSTOMER_LOOKUP,
      skip: (dto.page - 1) * dto.limit,
      limit: dto.limit,
    });
    const [res] = await this.customerOrderModel.aggregate<{
      page: Array<Record<string, unknown> & { prodOrders?: ProdDeriveFields[]; customer?: Record<string, unknown> }>;
      total: Array<{ n: number }>;
    }>(pipeline as never[], { allowDiskUse: true });
    const rows = res?.page ?? [];
    const refs = await this.loadAdminRefs(rows);
    return { success: true, data: rows.map((d) => this.toAdminStagingOrder(d, cutoff, refs)), total: res?.total?.[0]?.n ?? 0 };
  }

  async getCountsAdmin(dto: GetAdminCustomerOrderCountsDto): Promise<GetCustomerOrderCountsResDto> {
    await this.awaitLegacySync();
    return this.cachedAdmin(`counts:${JSON.stringify(dto)}`, () => this.computeCountsAdmin(dto));
  }

  private async computeCountsAdmin(dto: GetAdminCustomerOrderCountsDto): Promise<GetCustomerOrderCountsResDto> {
    const cutoff = await this.getCompletedCutoff();
    const [byStatus, byLine] = this.countsPipelines(dto.customerId ?? null, cutoff, dto.productLine, CustomerOrderService.dateRangeStages(dto.dateFrom, dto.dateTo));
    const [rows, lineRows] = await Promise.all([
      this.customerOrderModel.aggregate<{ _id: string; count: number; held: number; rework: number }>(byStatus as never[]),
      this.customerOrderModel.aggregate<{ _id: ProductLine; count: number }>(byLine as never[]),
    ]);
    return { success: true, data: this.assembleCounts(rows, lineRows) };
  }

  async getStatsAdmin(): Promise<GetAdminCustomerOrderStatsResDto> {
    await this.awaitLegacySync();
    return this.cachedAdmin('stats', () => this.computeStatsAdmin());
  }

  private async computeStatsAdmin(): Promise<GetAdminCustomerOrderStatsResDto> {
    const cutoff = await this.getCompletedCutoff();
    const [byStatus, byLine] = this.countsPipelines(null, cutoff);
    const sellerPipeline = [
      ...this.buildDerivePipeline(null, cutoff),
      {
        $group: {
          _id: '$customerId',
          orders: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$statusDerived', CustomerOrderStatus.Pending] }, 1, 0] } },
          inProduction: { $sum: { $cond: [{ $eq: ['$statusDerived', CustomerOrderStatus.InProduction] }, 1, 0] } },
          held: { $sum: { $cond: ['$heldAny', 1, 0] } },
          lastOrderAt: { $max: { $ifNull: ['$pushedAt', '$createdAt'] } },
        },
      },
      {
        $facet: {
          top: [
            { $sort: { orders: -1 } },
            { $limit: 10 },
            {
              $lookup: {
                from: 'customers',
                localField: '_id',
                foreignField: '_id',
                pipeline: [{ $project: { userSku: 1, userEmail: 1, fullName: 1, tier: 1 } }],
                as: 'c',
              },
            },
            { $addFields: { c: { $first: '$c' } } },
          ],
          sellers: [{ $count: 'n' }],
        },
      },
    ];
    const recentPipeline = [
      ...this.buildDerivePipeline(null, cutoff),
      { $addFields: { sortAt: { $ifNull: ['$pushedAt', '$createdAt'] } } },
      { $sort: { sortAt: -1, _id: -1 } },
      { $limit: 8 },
      ...CustomerOrderService.CUSTOMER_LOOKUP,
    ];
    const [rows, lineRows, [sellerRes], recent] = await Promise.all([
      this.customerOrderModel.aggregate<{ _id: string; count: number; held: number; rework: number }>(byStatus as never[]),
      this.customerOrderModel.aggregate<{ _id: ProductLine; count: number }>(byLine as never[]),
      this.customerOrderModel.aggregate<{
        top: Array<{ _id: string; orders: number; pending: number; inProduction: number; held: number; lastOrderAt?: Date; c?: Record<string, unknown> }>;
        sellers: Array<{ n: number }>;
      }>(sellerPipeline as never[]),
      this.customerOrderModel.aggregate<Record<string, unknown> & { prodOrders?: ProdDeriveFields[]; customer?: Record<string, unknown> }>(recentPipeline as never[]),
    ]);
    return {
      success: true,
      data: {
        counts: this.assembleCounts(rows, lineRows),
        sellers: sellerRes?.sellers?.[0]?.n ?? 0,
        topSellers: (sellerRes?.top ?? []).map((r) => ({
          customerId: String(r._id),
          userSku: r.c?.userSku as string | undefined,
          userEmail: r.c?.userEmail as string | undefined,
          fullName: r.c?.fullName as string | undefined,
          tier: (r.c?.tier as number | null | undefined) ?? null,
          orders: r.orders,
          pending: r.pending,
          inProduction: r.inProduction,
          held: r.held,
          lastOrderAt: r.lastOrderAt,
        })),
        recent: recent.map((d) => this.toAdminStagingOrder(d, cutoff)),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Public Order API (ORD-4) — adapter mỏng trên các method sẵn có, cùng ranh
  // giới dữ liệu: mọi query đều scoped theo customerId của key.
  // -------------------------------------------------------------------------

  /**
   * Resolve staging ids từ `externalRefs` (orderKey của khách) + `ids` — CHỈ
   * đơn của CHÍNH khách. Ref không tồn tại đơn giản là không có trong kết quả
   * (push sẽ báo `failed: Không tìm thấy đơn` cho id lạ, không lộ tồn tại).
   */
  async resolveStagingIdsForApi(
    customer: CustomerDocument,
    dto: { externalRefs?: string[]; ids?: string[] },
  ): Promise<string[]> {
    const ids = [...(dto.ids ?? [])];
    if (dto.externalRefs?.length) {
      const keys = dto.externalRefs.map((r) => customerOrderKey(r, undefined));
      const docs = await this.customerOrderModel
        .find({ customerId: String(customer._id), orderKey: { $in: keys } })
        .select('_id')
        .lean();
      ids.push(...docs.map((d) => String(d._id)));
    }
    return [...new Set(ids)];
  }

  /**
   * Tra 1 đơn theo `externalRef` HOẶC `productionId` của 1 item — đúng shape
   * listing portal (derive 8 trạng thái + badge). Không thuộc khách này → 404
   * chung chung (không lộ đơn tồn tại). Nếu ref là productionId đã push → kèm
   * `track` mirror trang track portal (cùng `trackOrder`, vốn không chứa tên
   * nhân viên/giá vốn).
   */
  async getOrderByRefForApi(customer: CustomerDocument, ref: string): Promise<OpenApiGetOrderResDto> {
    await this.syncLegacyOrdersForCustomer({
      _id: customer._id,
      userSku: customer.userSku,
      userEmail: customer.userEmail,
    });
    const trimmed = (ref ?? '').trim();
    if (!trimmed) throw new NotFoundException(customerMessage('orderNotFound'));
    const cutoff = await this.getCompletedCutoff();
    const rx = { $regex: `^${escapeRegex(trimmed)}$`, $options: 'i' };
    const pipeline = [
      ...this.buildDerivePipeline(String(customer._id), cutoff),
      { $match: { $or: [{ orderKey: customerOrderKey(trimmed, undefined) }, { 'items.productionId': rx }] } },
      { $limit: 1 },
    ];
    const [doc] = await this.customerOrderModel.aggregate<
      Record<string, unknown> & { prodOrders?: ProdDeriveFields[] }
    >(pipeline as never[]);
    if (!doc) throw new NotFoundException(customerMessage('orderNotFound'));

    const prodByPid = new Map<string, ProdDeriveFields>(
      (doc.prodOrders ?? []).map((p) => [p.productionId as string, p]),
    );
    const order = this.toStagingOrder(doc, prodByPid, cutoff);

    const matchedItem = order.items.find((i) => i.productionId?.toLowerCase() === trimmed.toLowerCase());
    let track: OpenApiGetOrderResDto['data']['track'];
    if (matchedItem?.productionId && order.pushedAt) {
      try {
        track = (await this.trackOrder(customer, matchedItem.productionId)).data;
      } catch {
        track = undefined;
      }
    }
    return { success: true, data: { order, track } };
  }

  // -------------------------------------------------------------------------
  // Sửa / hủy đơn PENDING (plan §2 — sửa tự do trước push)
  // -------------------------------------------------------------------------

  private async getPendingStagingOrder(customer: CustomerDocument, id: string) {
    const doc = await this.customerOrderModel.findOne({ _id: id, customerId: String(customer._id) });
    if (!doc) throw new NotFoundException(customerMessage('orderNotFoundDot'));
    if (doc.status === 'cancelled') throw new BadRequestException(customerMessage('orderCancelled'));
    if (doc.pushedAt) throw new BadRequestException(customerMessage('orderPushedEditLimited'));
    return doc;
  }

  async updateStagingOrder(
    customer: CustomerDocument,
    id: string,
    dto: UpdateCustomerStagingOrderDto,
  ): Promise<CustomerStagingOrderResDto> {
    const doc = await this.getPendingStagingOrder(customer, id);
    const set: Record<string, unknown> = {};
    if (dto.orderName !== undefined) set.orderName = dto.orderName;
    if (dto.note !== undefined) set.note = dto.note;
    if (dto.shippingAddress) set.shippingAddress = dto.shippingAddress;
    if (dto.items) {
      const ctx = await this.buildPricingContext(dto.items);
      const [activePromotions] = await Promise.all([this.promotionService.getActiveInDateRange()]);
      const tier = customer.tier ?? null;
      // Chỉ nhận echo-back productionId ĐANG thuộc chính đơn này — mã lạ bỏ qua, item mới cấp mã mới.
      const ownPids = new Set(
        ((doc.items || [])).map((i) => i.productionId).filter(Boolean),
      );
      const newItems = dto.items.map((item: CustomerStagingItemInput): CustomerOrderItem => {
        const q = this.quoteItem(item, ctx, activePromotions, tier);
        // ownPids.delete → mỗi mã chỉ dùng lại được 1 lần (echo trùng → item sau cấp mã mới).
        const keepPid = !!item.productionId && ownPids.delete(item.productionId);
        return {
          productionId: keepPid ? item.productionId : undefined,
          sku: item.sku?.trim() ? item.sku.trim().toUpperCase() : undefined,
          merchantSku: item.merchantSku,
          productConfigId: q.productConfigId,
          type: q.type ?? item.type,
          color: q.color ?? item.color,
          size: q.size ?? item.size,
          quantity: item.quantity ?? 1,
          shipMethod: item.shipMethod ?? DEFAULT_CUSTOMER_SHIP_METHOD,
          activeService: item.activeService,
          mockupUrl: item.mockupUrl,
          printMethod: item.printMethod,
          productLine: q.productLine,
          weight: item.weight ?? q.weight,
          width: item.width ?? q.width,
          height: item.height ?? q.height,
          length: item.length ?? q.length,
          designs: item.designs,
          tracking: item.tracking,
          priceSnapshot: q.snapshot,
        };
      });
      set.items = await this.assignProductionIds(newItems);
    }
    await this.customerOrderModel.updateOne({ _id: doc._id }, { $set: set });
    if (set.items) {
      await this.designStorageService.touchUsageForUrls(this.collectDesignUrls(set.items as CustomerOrderItem[]));
    }
    const updated = await this.customerOrderModel.findById(doc._id).lean();
    const cutoff = await this.getCompletedCutoff();
    return { success: true, data: this.toStagingOrder(updated as Record<string, unknown>, new Map(), cutoff) };
  }

  async cancelStagingOrder(
    customer: CustomerDocument,
    id: string,
    dto: CancelCustomerStagingOrderDto,
  ): Promise<CustomerStagingOrderResDto> {
    const doc = await this.getPendingStagingOrder(customer, id);
    await this.customerOrderModel.updateOne(
      { _id: doc._id },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelReason: dto.reason } },
    );
    const updated = await this.customerOrderModel.findById(doc._id).lean();
    const cutoff = await this.getCompletedCutoff();
    return { success: true, data: this.toStagingOrder(updated as Record<string, unknown>, new Map(), cutoff) };
  }

  // -------------------------------------------------------------------------
  // CSV import theo template cũ (plan §6) — nhận orders[] ĐÃ group từ FE
  // -------------------------------------------------------------------------

  /**
   * Đối chiếu SKU với catalog cho bảng preview import — trả tên/ảnh/màu-size +
   * giá tham khảo TÍNH CÙNG CÔNG THỨC với import/push (`quoteItem`: ship
   * method + Promotion theo tier). SKU không match → `found=false`, FE chặn
   * submit (BE lúc import cũng fail cả đơn — rule khớp 2 đầu).
   */
  async resolveImportSkus(customer: CustomerDocument, dto: ResolveImportSkusDto): Promise<ResolveImportSkusResDto> {
    const ctx = await this.buildPricingContext(dto.items);
    const activePromotions = await this.promotionService.getActiveInDateRange();
    const tier = customer.tier ?? null;

    const data = dto.items.map((item) => {
      const hit = ctx.bySku.get(item.sku.trim().toUpperCase());
      const q = this.quoteItem(item, ctx, activePromotions, tier);
      return {
        sku: item.sku,
        found: !!q.productConfigId,
        productConfigId: q.productConfigId,
        type: q.type,
        color: q.color,
        size: q.size,
        imageUrl: hit?.config.mockup,
        priceSnapshot: q.snapshot,
        error: q.error,
        // FE cảnh báo sớm "thiếu design" ngay ở preview import — cùng luật
        // với gate push (`designAcceptKeys`): rỗng = không đòi design.
        designAcceptKeys: q.productConfigId ? designAcceptKeys(hit?.config.printArea) : undefined,
      };
    });
    return { success: true, data };
  }

  async importOrdersCsv(
    customer: CustomerDocument,
    dto: ImportCustomerOrdersDto,
    // 'api' khi gọi qua Public Order API (ORD-4) — cùng luồng staging, chỉ khác nguồn.
    source: 'csv' | 'api' = 'csv',
  ): Promise<ImportCustomerOrdersResDto> {
    const totalLines = dto.orders.reduce((s, o) => s + o.items.length, 0);
    if (totalLines > 500) throw new BadRequestException(customerMessage('importTooManyLines'));

    const allItems = dto.orders.flatMap((o) => o.items);
    const ctx = await this.buildPricingContext(allItems);
    const activePromotions = await this.promotionService.getActiveInDateRange();
    const tier = customer.tier ?? null;
    const customerId = String(customer._id);

    const results: CustomerImportResultRow[] = [];
    const seenKeys = new Set<string>();
    let created = 0;
    let duplicated = 0;
    let failed = 0;

    for (const order of dto.orders) {
      const orderKey = customerOrderKey(order.orderId, order.identifier);
      const base = { orderId: order.orderId, identifier: order.identifier, orderKey };
      if (seenKeys.has(orderKey)) {
        duplicated++;
        results.push({ ...base, status: 'duplicated', error: 'Trùng (order_id, identifier) trong cùng file' });
        continue;
      }
      seenKeys.add(orderKey);

      // SKU BẮT BUỘC match (plan §13.1) — đơn có ≥1 dòng lỗi → CẢ ĐƠN không import.
      const itemErrors: Array<{ index: number; error: string }> = [];
      const items: CustomerOrderItem[] = [];
      for (let i = 0; i < order.items.length; i++) {
        const item = order.items[i];
        const q = this.quoteItem(item, ctx, activePromotions, tier);
        if (!q.productConfigId) {
          itemErrors.push({ index: i, error: q.error ?? 'SKU không hợp lệ' });
          continue;
        }
        items.push({
          sku: item.sku.trim().toUpperCase(),
          merchantSku: item.merchantSku,
          productConfigId: q.productConfigId,
          type: q.type,
          color: q.color ?? item.rawColor,
          size: q.size ?? item.rawSize,
          quantity: item.quantity ?? 1,
          shipMethod: item.shipMethod ?? DEFAULT_CUSTOMER_SHIP_METHOD,
          activeService: item.activeService,
          mockupUrl: item.mockupUrl,
          designs: item.designs,
          tracking: item.tracking,
          productLine: q.productLine,
          // Cân nặng + kích thước theo biến thể (file CSV của khách không có 4 cột này).
          weight: q.weight,
          width: q.width,
          height: q.height,
          length: q.length,
          priceSnapshot: q.snapshot,
        });
      }
      if (itemErrors.length > 0) {
        failed++;
        results.push({ ...base, status: 'failed', error: 'Đơn có dòng lỗi — cả đơn không được import', itemErrors });
        continue;
      }
      await this.assignProductionIds(items);

      try {
        await this.customerOrderModel.create({
          customerId,
          userSku: customer.userSku,
          userEmail: customer.userEmail,
          orderKey,
          orderId: order.orderId,
          identifier: order.identifier,
          orderName: order.orderName,
          note: order.note,
          source,
          status: 'pending',
          shippingAddress: order.shippingAddress,
          items,
        });
        created++;
        results.push({ ...base, status: 'created' });
        await this.designStorageService.touchUsageForUrls(this.collectDesignUrls(items));
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          duplicated++;
          results.push({ ...base, status: 'duplicated', error: 'Đơn đã tồn tại — sửa/xóa trên portal rồi import lại' });
        } else {
          failed++;
          results.push({ ...base, status: 'failed', error: (err as Error).message });
        }
      }
    }

    return { success: true, data: { created, duplicated, failed, results } };
  }

  // -------------------------------------------------------------------------
  // Push to production (plan §3): chốt giá → payment waived → importOrders
  // -------------------------------------------------------------------------

  /** Load + validate các staging orders được tick — dùng chung preview/push. */
  private async loadPushTargets(customer: CustomerDocument, ids: string[]) {
    const docs = await this.customerOrderModel
      .find({ _id: { $in: ids }, customerId: String(customer._id) })
      .lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    return ids.map((id) => ({ id, doc: byId.get(id) }));
  }

  /**
   * Giành chỗ đẩy 1 đơn staging bằng MỘT lệnh ghi có điều kiện (ORD-20).
   * Trả `true` nếu lượt này giành được, `false` nếu đơn đã đẩy hoặc lượt khác
   * đang đẩy.
   *
   * Điều kiện nằm ở LỆNH GHI chứ không phải ở bước đọc: cả luồng push là đọc →
   * chốt giá → `importOrders()` → ghi `pushedAt`, và chỗ hở nằm ở khoảng giữa
   * đọc và ghi. Hai lượt song song đều đọc thấy `pushedAt` rỗng nên cùng chạy
   * tới `importOrders()`; lượt sau đụng unique index `productionId` và ném lỗi
   * trùng khoá — hậu quả nặng thì unique index đã chặn, nhưng khách nhận về
   * một lỗi tầng dưới khó hiểu và người đọc log tưởng hỏng khâu cấp mã.
   *
   * Chỗ giữ quá hạn thì coi như hết hiệu lực, để tiến trình chết giữa chừng
   * không khoá đơn vĩnh viễn.
   */
  private async claimPush(stagingId: string, customerId: string): Promise<boolean> {
    const now = Date.now();
    const res = await this.customerOrderModel.updateOne(
      {
        _id: stagingId,
        customerId,
        pushedAt: null,
        $or: [{ pushingAt: null }, { pushingAt: { $exists: false } }, { pushingAt: { $lt: new Date(now - PUSH_CLAIM_STALE_MS) } }],
      },
      { $set: { pushingAt: new Date(now) } },
    );
    return res.modifiedCount > 0;
  }

  /** Nhả chỗ giữ khi lượt đẩy hỏng — đơn quay lại trạng thái đẩy được. */
  private async releasePushClaims(stagingIds: string[]): Promise<void> {
    if (stagingIds.length === 0) return;
    await this.customerOrderModel.updateMany(
      { _id: { $in: stagingIds }, pushedAt: null },
      { $set: { pushingAt: null } },
    );
  }

  /** Lý do đơn không giành được chỗ — đọc lại để nói đúng chuyện gì đang xảy ra. */
  private async describeLostClaim(stagingId: string): Promise<string> {
    const doc = await this.customerOrderModel.findById(stagingId).select('pushedAt').lean();
    return doc?.pushedAt ? 'Đơn đã đẩy sản xuất trước đó' : 'Đơn đang được đẩy sản xuất — chờ một lát rồi tải lại trang';
  }

  private validatePushable(doc: Record<string, unknown> | undefined): string | undefined {
    if (!doc) return 'Không tìm thấy đơn';
    if (doc.status === 'cancelled') return 'Đơn đã hủy';
    if (doc.pushedAt) return 'Đơn đã đẩy sản xuất trước đó';
    const items = (doc.items || []) as CustomerOrderItem[];
    if (items.length === 0) return 'Đơn không có item nào';
    const addr = doc.shippingAddress as ProductionOrderShippingAddress | undefined;
    if (!addr?.firstName?.trim() || !addr?.address1?.trim() || !addr?.city?.trim())
      return 'Thiếu thông tin địa chỉ nhận hàng (tên/địa chỉ/thành phố)';
    return undefined;
  }

  /** Quote toàn bộ items của 1 staging order — trả kèm tổng tiền. */
  private quoteStagingOrder(
    doc: Record<string, unknown>,
    ctx: PricingContext,
    activePromotions: ActivePromotion[],
    tier: number | null,
  ): { quotes: QuoteResult[]; orderTotal: number } {
    const items = (doc.items || []) as CustomerOrderItem[];
    const quotes = items.map((it) => this.quoteItem(it, ctx, activePromotions, tier));
    const orderTotal = quotes.reduce((s, q) => s + (q.snapshot?.lineTotal ?? 0), 0);
    return { quotes, orderTotal: Math.round(orderTotal * 100) / 100 };
  }

  async previewPush(customer: CustomerDocument, dto: PushCustomerOrdersDto): Promise<PreviewPushCustomerOrdersResDto> {
    const targets = await this.loadPushTargets(customer, dto.ids);
    const allItems = targets.flatMap((t) => ((t.doc?.items || []) as CustomerOrderItem[]).map((i) => i));
    const ctx = await this.buildPricingContext(allItems);
    const activePromotions = await this.promotionService.getActiveInDateRange();
    const tier = customer.tier ?? null;
    const paymentGateEnabled = !!(await this.systemConfigService.get<boolean>(CUSTOMER_PAYMENT_GATE_KEY));

    let totalAmount = 0;
    const orders: CustomerPushQuoteOrder[] = targets.map(({ id, doc }) => {
      const error = this.validatePushable(doc);
      if (error || !doc) return { stagingId: id, orderId: doc?.orderId, items: [], orderTotal: 0, error };
      const items = (doc.items || []) as CustomerOrderItem[];
      const { quotes, orderTotal } = this.quoteStagingOrder(doc, ctx, activePromotions, tier);
      totalAmount += orderTotal;
      return {
        stagingId: id,
        orderId: doc.orderId,
        orderName: doc.orderName,
        orderTotal,
        items: items.map((it, i) => ({
          sku: it.sku,
          type: quotes[i].type ?? it.type,
          size: quotes[i].size ?? it.size,
          quantity: it.quantity ?? 1,
          priceSnapshot: quotes[i].snapshot,
          error: quotes[i].error,
        })),
      };
    });

    return {
      success: true,
      data: { orders, totalAmount: Math.round(totalAmount * 100) / 100, paymentGateEnabled },
    };
  }

  async pushToProduction(customer: CustomerDocument, dto: PushCustomerOrdersDto): Promise<PushCustomerOrdersResDto> {
    const paymentGateEnabled = !!(await this.systemConfigService.get<boolean>(CUSTOMER_PAYMENT_GATE_KEY));
    // Plan §12.1: đợt này gate OFF — chưa build luồng Admin confirm nên gate ON chặn hẳn.
    if (paymentGateEnabled)
      throw new BadRequestException(customerMessage('paymentGateNotReady'));

    const targets = await this.loadPushTargets(customer, dto.ids);
    const allItems = targets.flatMap((t) => ((t.doc?.items || []) as CustomerOrderItem[]).map((i) => i));
    const ctx = await this.buildPricingContext(allItems);
    const activePromotions = await this.promotionService.getActiveInDateRange();
    const tier = customer.tier ?? null;

    const results: PushCustomerOrdersResDto['data']['results'] = [];
    const importRows: ImportProductionOrderRow[] = [];
    const pendingUpdates: Array<{ stagingId: string; items: CustomerOrderItem[]; orderTotal: number }> = [];
    let totalAmount = 0;
    /**
     * Mốc "đơn vào sản xuất" của cả lô đẩy này.
     *
     * Đơn portal không đi qua sheet import nên không có sẵn cột ngày như đơn
     * nội bộ, mà `inProductionAt` lại là TRỤC THỜI GIAN của gần hết hệ thống:
     * bảng "Danh sách đơn" mặc định lọc đúng hôm nay trên chính trường này
     * (`Orders.md §7`), Dashboard/Lifecycle/báo cáo Telegram đều bucket theo
     * nó. Bỏ trống thì đơn đẩy vào sản xuất xong vẫn vô hình với xưởng —
     * không khoảng ngày nào khớp một trường không tồn tại.
     *
     * Một mốc duy nhất cho cả `OrderEntity.inProductionAt` lẫn
     * `customer_orders.pushedAt` bên dưới: hai con số đó tả cùng một sự kiện,
     * gọi `new Date()` hai lần chỉ đẻ ra chênh lệch vài mili giây để người
     * đọc số sau này phải đi giải thích.
     */
    const pushedAt = new Date();

    for (const { id, doc } of targets) {
      const error = this.validatePushable(doc);
      if (error || !doc) {
        results.push({ stagingId: id, orderId: doc?.orderId, status: 'failed', error });
        continue;
      }
      const items = (doc.items || []) as CustomerOrderItem[];
      const { quotes, orderTotal } = this.quoteStagingOrder(doc, ctx, activePromotions, tier);

      // Sản phẩm NGỪNG BÁN sau khi đơn đã vào staging — chặn ở cửa push với
      // message rõ thay vì lẳng lặng đẩy đi với giá snapshot cũ. Fail RIÊNG
      // đơn này, lô vẫn đẩy tiếp.
      const inactiveQuote = quotes.find((q) => q.inactive);
      if (inactiveQuote) {
        results.push({
          stagingId: id,
          orderId: doc.orderId,
          status: 'failed',
          error: `Đơn ${doc.orderId ?? id}: ${inactiveQuote.error}`,
        });
        continue;
      }

      // CỬA CUỐI CÙNG cho luật "phải có mockup + design ở vị trí in bắt buộc"
      // (ORD-25). ORD-22 chặn ở `placeOrder`, nhưng đó chỉ là MỘT đường vào:
      // Public Order API đi `importOrdersCsv`, và `updateStagingOrder` cho phép
      // gỡ design ra khỏi đơn đã tạo. Đơn Pending là vùng nháp nên được phép
      // thiếu — chỗ KHÔNG được phép thiếu là lúc đơn rời vùng nháp để vào sản
      // xuất. Chặn ở đây phủ mọi đường vào, kể cả đường sinh ra sau này.
      //
      // Kiểm TRƯỚC khi giành chỗ: đơn hỏng thì đừng chiếm chỗ rồi phải nhả.
      // Dùng lại đúng hàm của ORD-22 — hai luật giống nhau đặt hai nơi là mầm
      // của lỗi lệch. Bắt lỗi để hỏng RIÊNG đơn này, lô vẫn đẩy tiếp.
      try {
        this.assertArtworkComplete(items, quotes, ctx);
      } catch (e) {
        const reason = e instanceof BadRequestException ? e.message : 'Đơn thiếu file thiết kế';
        results.push({
          stagingId: id,
          orderId: doc.orderId,
          status: 'failed',
          error: `Đơn ${doc.orderId ?? id}: ${reason}`,
        });
        continue;
      }

      // Giành chỗ TRƯỚC khi dựng row import — lượt song song thứ hai dừng ở đây
      // và nhận thông báo rõ ràng, thay vì chạy tiếp tới importOrders rồi vỡ ở
      // unique index. Một đơn hỏng chỉ hỏng riêng nó, lô vẫn đẩy tiếp (ORD-20).
      if (!(await this.claimPush(id, String(customer._id)))) {
        results.push({ stagingId: id, orderId: doc.orderId, status: 'failed', error: await this.describeLostClaim(id) });
        continue;
      }
      const addr = doc.shippingAddress as ProductionOrderShippingAddress | undefined;

      const updatedItems: CustomerOrderItem[] = [];
      const productionIds: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const q = quotes[i];
        // Mã đã cấp NGAY lúc tạo/import — push GIỮ NGUYÊN (khách theo dõi 1 mã
        // xuyên suốt). Fallback sinh mới cho staging doc cũ tạo trước cơ chế này.
        const productionId = it.productionId ?? (await this.generateUniqueProductionId());
        productionIds.push(productionId);
        updatedItems.push({
          ...it,
          productConfigId: q.productConfigId ?? it.productConfigId,
          type: q.type ?? it.type,
          size: q.size ?? it.size,
          color: q.color ?? it.color,
          priceSnapshot: q.snapshot ?? it.priceSnapshot,
          productionId,
        });
        importRows.push({
          productionId,
          userSku: customer.userSku,
          userEmail: customer.userEmail,
          // type = fullName của config resolve từ SKU → importOrders map đúng
          // config (match `fullName` case-insensitive, plan §6.1).
          type: q.type ?? it.type,
          color: q.color ?? it.color,
          size: q.size ?? it.size,
          mockupUrl: it.mockupUrl,
          printMethod: it.printMethod,
          productLine: q.productLine ?? it.productLine,
          // Đơn cũ nằm sẵn ở staging trước 08/09/2026 chưa có bốn trường này →
          // lùi về biến thể lúc đẩy, khỏi phải backfill.
          weight: it.weight ?? q.weight,
          width: it.width ?? q.width,
          height: it.height ?? q.height,
          length: it.length ?? q.length,
          quantity: it.quantity ?? 1,
          // Tiền theo đơn — đường import nội bộ có sẵn (cột 13/14 của file), đường
          // seller trước đây bỏ trống nên đơn portal đóng góp 0 vào doanh thu
          // CEO Dashboard (`$baseCost`) và không có cước ship để đối soát.
          baseCost: it.priceSnapshot?.discountedPrice ?? it.priceSnapshot?.unitPrice ?? q.snapshot?.discountedPrice ?? q.snapshot?.unitPrice,
          shipCost: q.shipCost,
          designs: it.designs,
          // Vận đơn khách tự cấp đi kèm item (CSV template cột
          // `tracking_*`/`shipping_label`, hoặc `items[].tracking` qua Public
          // Order API) — `importOrders` lưu lên đơn RỒI ghi record vào module
          // vận đơn. Trước ORD-26 field này chết ở staging, xưởng không thấy.
          tracking: it.tracking,
          orderId: (doc.orderId) ?? undefined,
          referent: (doc.note) ?? undefined,
          // Hai mốc thời gian của đơn, `importOrders` đọc cả hai qua
          // `parseImportDate` (nhận ISO có tz):
          //   orderAt        = lúc KHÁCH đặt  → staging `createdAt`
          //   inProductionAt = lúc VÀO SX     → mốc đẩy của cả lô
          // Chúng khác nhau đúng bằng quãng đơn nằm ở vùng nháp Pending, có
          // thể là vài phút mà cũng có thể là vài ngày — gộp làm một là mất
          // luôn quãng chờ đó khỏi mọi báo cáo. Staging doc quá cũ không có
          // `createdAt` thì lùi về mốc đẩy: sai lệch một quãng đã không còn
          // đo được, vẫn hơn để trống rồi thủng sort `orderAt: -1` ở kanban
          // Fulfillment.
          orderAt: (doc.createdAt ?? pushedAt).toISOString(),
          inProductionAt: pushedAt.toISOString(),
          shippingAddress: addr,
        });
      }
      totalAmount += orderTotal;
      pendingUpdates.push({ stagingId: id, items: updatedItems, orderTotal });
      results.push({
        stagingId: id,
        orderId: doc.orderId,
        status: 'pushed',
        productionIds,
      });
    }

    if (importRows.length === 0) return { success: true, data: { results, totalAmount: 0 } };

    // 1 lệnh importOrders duy nhất cho mọi item của mọi đơn — pipeline sẵn có
    // (map config, ép xưởng theo khách, auto-gán designer, Telegram noti).
    // Hỏng ở đây thì NHẢ hết chỗ giữ: đơn phải quay lại trạng thái đẩy được,
    // không được kẹt nửa vời (ORD-20).
    let payment: { _id: unknown };
    try {
      await this.orderService.importOrders(
        { rows: importRows },
        {
          user: {
            _id: customer._id,
            fullName: customer.fullName,
            email: customer.userEmail,
            role: { name: RoleType.Customer },
          },
        },
      );

      // Ledger: gate OFF vẫn ghi 1 record `waived` + tổng amount (plan §12.1).
      payment = await this.customerPaymentModel.create({
        customerId: String(customer._id),
        orderIds: pendingUpdates.map((u) => u.stagingId),
        amount: Math.round(totalAmount * 100) / 100,
        status: 'waived',
        method: 'waived',
      });
    } catch (e) {
      await this.releasePushClaims(pendingUpdates.map((u) => u.stagingId));
      throw e;
    }

    await Promise.all(
      pendingUpdates.map((u) =>
        this.customerOrderModel.updateOne(
          // `pushedAt: null` là lưới an toàn cuối: tới đây lượt này đang giữ chỗ
          // nên không ai chen được, nhưng ghi có điều kiện thì rẻ mà chắc.
          { _id: u.stagingId, pushedAt: null },
          { $set: { items: u.items, pushedAt, paymentId: String(payment._id), pushingAt: null } },
        ),
      ),
    );

    // Webhook `order.pushed` cho khách API (ORD-4) — fire-and-forget, không chặn response.
    this.customerOrderEventService.emit(
      'order.pushed',
      pendingUpdates.flatMap((u) =>
        u.items
          .filter((it) => it.productionId)
          .map((it) => ({
            productionId: it.productionId,
            customerId: String(customer._id),
            extra: { externalRef: (targets.find((t) => t.id === u.stagingId)?.doc?.orderId as string) ?? null },
          })),
      ),
    );

    // Design storage hook (plan DesignStorage-R2-ProcessingWorker §C4): design đã
    // là CDN URL → touch lastUsedAt; design còn là URL ngoài (Drive…) → đẩy job
    // cho design-worker tải về R2 + thay URL ở CẢ OrderEntity lẫn staging item.
    // Push KHÔNG chờ worker — đơn vào sản xuất ngay với URL gốc.
    const cdnUrls: string[] = [];
    for (const u of pendingUpdates) {
      for (const it of u.items) {
        if (!it.productionId) continue;
        for (const [designKey, url] of Object.entries(it.designs ?? {})) {
          if (!url) continue;
          if (extractDesignSha(url)) {
            cdnUrls.push(url);
          } else if (/^https?:\/\//i.test(url)) {
            await this.designStorageService.enqueueUrlIngest({
              kind: 'url',
              url,
              designKey,
              productionId: it.productionId,
              stagingId: u.stagingId,
              customerId: String(customer._id),
              userEmail: customer.userEmail,
            });
          }
        }
        // Label khách cấp cũng lưu về R2 cho chắc (link ngoài có thể chết) —
        // worker chỉ thay staging tracking.labelUrl (target='tracking-label').
        const labelUrl = it.tracking?.labelUrl;
        if (labelUrl) {
          if (extractDesignSha(labelUrl)) {
            cdnUrls.push(labelUrl);
          } else if (/^https?:\/\//i.test(labelUrl)) {
            await this.designStorageService.enqueueUrlIngest({
              kind: 'url',
              url: labelUrl,
              designKey: 'labelUrl',
              target: 'tracking-label',
              productionId: it.productionId,
              stagingId: u.stagingId,
              customerId: String(customer._id),
              userEmail: customer.userEmail,
            });
          }
        }
      }
    }
    await this.designStorageService.touchUsageForUrls(cdnUrls);

    return { success: true, data: { results, totalAmount: Math.round(totalAmount * 100) / 100 } };
  }

  // -------------------------------------------------------------------------
  // Các API sẵn có giữ nguyên hành vi (đơn ĐÃ PUSH — OrderEntity)
  // -------------------------------------------------------------------------

  /** Distinct `type` các đơn của khách — option cho filter "Sản phẩm" ở listing. */
  async listProductTypes(customer: CustomerDocument): Promise<GetCustomerOrderProductTypesResDto> {
    const types = await this.orderModel.distinct('type', {
      userSku: customer.userSku,
      userEmail: customer.userEmail,
    });
    const cleaned = types
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      .sort((a, b) => a.localeCompare(b, 'vi'));
    return { success: true, data: cleaned };
  }

  /**
   * Dashboard portal — đếm theo staging (gồm cả Pending) + 5 đơn mới nhất.
   * `processing` = phần còn lại sau khi trừ pending/hủy/hoàn thành.
   */
  async getDashboard(customer: CustomerDocument): Promise<GetCustomerDashboardResDto> {
    const countsRes = await this.getCounts(customer);
    const c = countsRes.data;
    const listRes = await this.listOrders(customer, { page: 1, limit: 5 } as GetCustomerStagingOrdersDto);
    const recentOrders = listRes.data.flatMap((o) =>
      o.items.map((i) => ({
        _id: o._id,
        productionId: i.productionId ?? '',
        type: i.type,
        color: i.color,
        size: i.size,
        quantity: i.quantity,
        mockupUrl: i.mockupUrl,
        createdAt: o.createdAt,
        currentStageKey: i.currentStageKey,
        currentStageLabel: i.currentStageLabel,
        currentStageAt: i.currentStageAt,
        completed: i.status === CustomerOrderStatus.Completed || i.status === CustomerOrderStatus.Fulfilled,
        cancelledAt: i.cancelledAt ?? o.cancelledAt,
        designs: i.designs,
        productConfigId: i.productConfigId,
        shippingAddress: o.shippingAddress,
      })),
    );
    return {
      success: true,
      data: {
        totals: {
          total: c.all,
          processing: Math.max(0, c.all - c.pending - c.cancelled - c.completed - c.fulfilled - c.refunded),
          completed: c.completed + c.fulfilled,
          cancelled: c.cancelled,
        },
        recentOrders: recentOrders.slice(0, 5),
      },
    };
  }

  /**
   * Khách tự sửa mockup/design/địa chỉ ship của 1 đơn ĐÃ PUSH (KHÔNG sửa được
   * type/color/size/quantity — đổi số lượng/biến thể phải qua support nội
   * bộ). Chặn sửa đơn đã hủy. `designs` merge với giá trị cũ.
   */
  async updateOrder(
    customer: CustomerDocument,
    productionId: string,
    dto: UpdateCustomerOrderDto,
  ): Promise<UpdateCustomerOrderResDto> {
    const trimmed = (productionId ?? '').trim();
    if (!trimmed) throw new NotFoundException(customerMessage('productionIdEmpty'));

    const order = await this.orderModel.findOne({
      productionId: trimmed,
      userSku: customer.userSku,
      userEmail: customer.userEmail,
    });
    if (!order) throw new NotFoundException(customerMessage('orderNotFoundByCode'));
    if (order.cancelledAt) throw new BadRequestException(customerMessage('orderCancelledCannotEdit'));

    const set: Record<string, unknown> = {};
    if (dto.mockupUrl !== undefined) {
      set.mockupUrl = dto.mockupUrl;
      set.mockupOriginalUrl = dto.mockupUrl;
    }
    if (dto.designs) {
      const merged = { ...order.designs, ...dto.designs };
      set.designs = merged;
      set.designsOriginal = merged;
      await this.designStorageService.touchUsageForUrls(Object.values(dto.designs));
    }
    if (dto.shippingAddress) set.shippingAddress = dto.shippingAddress;

    await this.orderModel.updateOne({ _id: order._id }, { $set: set });

    // Đồng bộ lại staging item để listing hiển thị đúng (mockup/designs/address).
    const stagingSet: Record<string, unknown> = {};
    if (set.mockupUrl !== undefined) stagingSet['items.$.mockupUrl'] = set.mockupUrl;
    if (set.designs !== undefined) stagingSet['items.$.designs'] = set.designs;
    if (Object.keys(stagingSet).length > 0 || dto.shippingAddress) {
      await this.customerOrderModel.updateOne(
        { customerId: String(customer._id), 'items.productionId': trimmed },
        {
          $set: {
            ...stagingSet,
            ...(dto.shippingAddress ? { shippingAddress: dto.shippingAddress } : {}),
          },
        },
      );
    }

    const updated = await this.orderModel.findById(order._id).select('productionId').lean();
    if (!updated) throw new NotFoundException(customerMessage('orderNotFoundByCode'));
    return this.trackSummaryRes(customer, trimmed);
  }

  /** Response gọn sau update — tái dùng track (đơn lẻ nên không lo N+1). */
  private async trackSummaryRes(customer: CustomerDocument, productionId: string): Promise<UpdateCustomerOrderResDto> {
    const order = await this.orderModel
      .findOne({ productionId, userSku: customer.userSku, userEmail: customer.userEmail })
      .select(
        'productionId type color size quantity mockupUrl status orderAt cancelledAt cancelReason createdAt designs productConfigId shippingAddress inProductionAt ' +
          PROD_DERIVE_FIELDS,
      )
      .lean();
    if (!order) throw new NotFoundException(customerMessage('orderNotFoundByCode'));
    const stage = computeCurrentStage(order as ProdDeriveFields);
    return {
      success: true,
      data: {
        _id: String(order._id),
        productionId: order.productionId,
        type: order.type,
        color: order.color,
        size: order.size,
        quantity: order.quantity,
        mockupUrl: order.mockupUrl,
        status: order.status,
        orderAt: order.orderAt,
        cancelledAt: order.cancelledAt ?? undefined,
        cancelReason: order.cancelReason,
        createdAt: (order as { createdAt?: Date }).createdAt,
        inProductionAt: order.inProductionAt,
        currentStageKey: order.cancelledAt ? undefined : stage.key,
        currentStageLabel: order.cancelledAt ? undefined : stage.label,
        currentStageAt: order.cancelledAt ? undefined : stage.at,
        completed: stage.completed,
        designs: order.designs,
        productConfigId: order.productConfigId ? String(order.productConfigId) : undefined,
        shippingAddress: order.shippingAddress,
      },
    };
  }

  /** Xem tiến trình 1 đơn — chỉ cho phép xem đơn thuộc chính khách hàng đó. */
  async trackOrder(customer: CustomerDocument, productionId: string): Promise<GetCustomerOrderTrackResDto> {
    const trimmed = (productionId ?? '').trim();
    if (!trimmed) throw new NotFoundException(customerMessage('productionIdEmpty'));

    const summary = await this.trackSummaryRes(customer, trimmed);
    const track = await this.orderService.getLifecycleTrack(trimmed);

    return { success: true, data: { order: summary.data, track: track.data } };
  }
}
