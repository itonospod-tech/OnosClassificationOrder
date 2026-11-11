import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  CreateVnpFromAddressDto,
  CreateVnpShipmentDto,
  GetVnpShipmentsDto,
  ProductionOrderShippingAddress,
  SaveVnpShippingMapDto,
  VnpShipmentInfo,
  VnpShipmentRecord,
  VnpShipmentStats,
  VnpShippingConfig,
  VnpShippingStatus,
} from 'shared';
import { carrierPhaseFilter, SHIPMENT_PROVIDER_VNP, VNP_SHIPMENT_COUNTED_STATUSES, VNP_SHIPPING_CONFIG_KEY } from 'shared';
import { Logger } from 'winston';

import { genCode } from '@/utils/gen-code';

import { ApiConfigService } from '../../shared/services/api-config.service';
import { OrderEntity } from '../order/order.entity';
import { resolveShippingLabelInfo } from '../order/shipping-label';
import { SystemConfigService } from '../system-config/system-config.service';
import { buildCarrierPatch, extractStatusText, hasCarrierError, hasCarrierSignal, isCancelledStatusText } from './carrier-status';
import { digString, interpretVnpLookup, RECONCILE_BATCH, RECONCILE_MIN_AGE_MS } from './purchase-reconcile';
import { ShipmentDocument, ShipmentEntity } from './shipment.entity';
import { ShippingPackageEntity } from './shipping-package.entity';
import { VnpEglobalClient } from './vnp-eglobal.client';

/**
 * Điều phối luồng vận đơn VNP eGlobal cho 1 đơn sản xuất (giai đoạn TEST —
 * kích hoạt tay qua nút "Vận đơn VNP" ở bảng đơn hàng, chưa auto-hook vào
 * công đoạn Đóng hàng).
 *
 * Spec VNP không khai response body → mọi hàm trả kèm `raw` nguyên văn và
 * dùng `digString()` dò các tên field phổ biến để nhặt id/tracking/label.
 */

// digString dời sang ./purchase-reconcile (dùng chung với cron đối soát).

/** Response VNP kiểu chuẩn thấy ở endpoint public: {code, message, result...}. */
function looksOk(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return true; // không đoán được → coi như ok, FE soi raw
  const rec = raw as Record<string, unknown>;
  if (typeof rec.code === 'number' && rec.code >= 400) return false;
  if (typeof rec.status === 'number' && rec.status >= 400) return false;
  if (rec.error) return false;
  return true;
}

/**
 * Carrier sau VNP validate phone: bắt đầu khác 0, 8-15 chữ số. Chuẩn hóa về
 * digits-only; không đạt → fallback số placeholder (label vẫn in được, phone
 * người nhận không in trên label USPS).
 */
function normalizeVnpPhone(phone?: string): string {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return '9999999999';
}

/** Tên bang Mỹ → mã 2 ký tự — khách portal hay gõ tên đầy đủ ("North Carolina"). */
const US_STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR', guam: 'GU',
};

/** Chuẩn hóa state US về mã 2 ký tự; đã là mã thì uppercase, lạ thì giữ nguyên. */
function normalizeUsState(state?: string): string {
  const trimmed = (state ?? '').trim();
  if (!trimmed) return '';
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return US_STATE_CODES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Mã bang/lãnh thổ US hợp lệ — dùng pre-check trước khi mua label vì carrier
 * validate mã bang trên RECORD VNP (district→state), còn USPS checkAddress tự
 * SỬA state theo zip nên không bao giờ báo lỗi state cho mình.
 */
const VALID_US_STATE_SET = new Set([...Object.values(US_STATE_CODES), 'VI', 'AS', 'MP']);

/** Nhánh verifications trong response USPS checkAddress (shape thật, soi staging 24/08). */
interface UspsVerification {
  success?: boolean;
  errors?: { code?: string; message?: string }[];
}

// classifyTrackingStatus + STATUS_KEYS + buildCarrierPatch dời sang
// ./carrier-status (trạng thái HÃNG tách khỏi trạng thái MUA — §3).

const SHIPMENT_ID_KEYS = ['shipment_id', 'shipmentId', 'id', 'uuid'];
const TRACKING_KEYS = ['tracking_id', 'trackingId', 'tracking_code', 'trackingCode', 'tracking_number', 'trackingNumber'];
const LABEL_KEYS = ['image_url', 'label_url', 'labelUrl', 'label', 'label_pdf', 'labelPdf', 'label_link', 'pdf_url', 'pdfUrl'];
const ADDRESS_ID_KEYS = ['address_id', 'addressId', 'id', 'uuid'];

@Injectable()
export class ShippingVnpService implements OnModuleInit {
  constructor(
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    @InjectModel(ShippingPackageEntity.name) private readonly packageModel: Model<ShippingPackageEntity>,
    @InjectModel(ShipmentEntity.name) private readonly shipmentModel: Model<ShipmentEntity>,
    private readonly client: VnpEglobalClient,
    private readonly apiConfigService: ApiConfigService,
    private readonly systemConfigService: SystemConfigService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  /**
   * Ép build index của bảng `shipments` lúc boot + LOG RÕ khi hỏng — 2 unique
   * partial index là chốt chống mua trùng (ShippingLabelPatterns.md §2), thiếu
   * âm thầm là mất lớp bảo vệ DB mà không ai biết (mongoose autoIndex build
   * nền và nuốt lỗi — đã dính ở local 2026-09-05: boot xong không có index,
   * không một dòng log).
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.shipmentModel.createIndexes();
      await this.packageModel.createIndexes();
    } catch (err) {
      this.logger.error({
        message: JSON.stringify({ action: 'vnpShipmentIndexBuildFail', error: (err as Error).message?.slice(0, 1000) }),
      });
    }
  }

  // ── Cấu hình địa chỉ gửi theo xưởng (blob system_configs, sống theo môi
  // trường — production tự cấu hình qua UI Settings, không restore từ local).

  async getShippingConfig(): Promise<VnpShippingConfig> {
    // Đọc THẲNG Mongo, bỏ qua cache Redis của SystemConfigService — config
    // này nhỏ + đọc thưa, còn cache từng gây stale khi sửa DB tay/backfill
    // (cache TTL 1h giữ bản cũ dù Mongo đã đổi). `set()` vẫn dùng service.
    const doc = await this.orderModel.db
      .collection('system_configs')
      .findOne<{ value?: VnpShippingConfig }>({ key: VNP_SHIPPING_CONFIG_KEY });
    const cfg = doc?.value;
    return { addresses: cfg?.addresses ?? [], factoryMap: cfg?.factoryMap ?? {}, defaultAddressId: cfg?.defaultAddressId };
  }

  /** Danh sách địa chỉ đã lưu bên VNP (hub US có sẵn nằm ở đây) — raw. */
  async listRemoteAddresses(): Promise<{ raw: unknown }> {
    return { raw: await this.client.getShippingAddresses() };
  }

  /** Thêm địa chỉ ĐÃ TỒN TẠI bên VNP vào config bằng id (không tạo mới). */
  async importFromAddress(dto: { vnpAddressId: string; label: string; note?: string }): Promise<VnpShippingConfig> {
    const config = await this.getShippingConfig();
    config.addresses = [
      ...config.addresses.filter((a) => a.vnpAddressId !== dto.vnpAddressId),
      {
        vnpAddressId: dto.vnpAddressId,
        label: dto.label,
        name: dto.note || '(địa chỉ có sẵn trên VNP)',
        phoneNumber: '-',
        street1: dto.note || '-',
        ward: '-',
        district: '-',
        city: '-',
        country: 'US',
        createdAt: new Date(),
      },
    ];
    if (!config.defaultAddressId) config.defaultAddressId = dto.vnpAddressId;
    await this.systemConfigService.set(VNP_SHIPPING_CONFIG_KEY, config);
    this.logger.info({ message: JSON.stringify({ action: 'vnpImportFromAddress', vnpAddressId: dto.vnpAddressId }) });
    return config;
  }

  /** Tạo địa chỉ gửi (ShippingFrom) bên VNP rồi lưu snapshot + id vào blob. */
  async createFromAddress(dto: CreateVnpFromAddressDto): Promise<{ config: VnpShippingConfig; raw: unknown }> {
    // US: `district` PHẢI là mã bang — VNP map district→state phía carrier
    // (xác nhận với Nexo 24/08 + khớp curl mẫu tài liệu district:"TX"); field
    // `state` gửi lên bị BỎ QUA khi tạo shipment, `ward` là placeholder.
    const isUs = (dto.country || 'VN').toUpperCase() === 'US';
    const usState = normalizeUsState(dto.state);
    const raw = await this.client.createAddress({
      name: dto.name,
      phone_number: normalizeVnpPhone(dto.phoneNumber),
      city: dto.city,
      district: isUs && usState ? usState : dto.district,
      ward: isUs && usState ? usState : dto.ward,
      zip_code: dto.zipCode || undefined,
      country: dto.country || 'VN',
      street1: dto.street1,
      street2: dto.street2 || undefined,
      state: dto.state || undefined,
      address: [dto.street1, dto.street2, dto.ward, dto.district, dto.city].filter(Boolean).join(', '),
      is_default: false,
      type_of_address: 'ShippingFrom',
    });
    const vnpAddressId = digString(raw, ADDRESS_ID_KEYS);
    if (!looksOk(raw) || !vnpAddressId) {
      throw new BadRequestException(
        'VNP createAddress (ShippingFrom) không trả address id — response: ' + JSON.stringify(raw).slice(0, 6000),
      );
    }
    const config = await this.getShippingConfig();
    config.addresses = [
      ...config.addresses.filter((a) => a.vnpAddressId !== vnpAddressId),
      {
        vnpAddressId,
        label: dto.label,
        name: dto.name,
        phoneNumber: dto.phoneNumber,
        street1: dto.street1,
        street2: dto.street2,
        ward: dto.ward,
        district: dto.district,
        city: dto.city,
        state: dto.state,
        zipCode: dto.zipCode,
        country: dto.country || 'VN',
        createdAt: new Date(),
      },
    ];
    // Địa chỉ đầu tiên tự thành mặc định — đỡ 1 bước cấu hình.
    if (!config.defaultAddressId) config.defaultAddressId = vnpAddressId;
    await this.systemConfigService.set(VNP_SHIPPING_CONFIG_KEY, config);
    this.logger.info({ message: JSON.stringify({ action: 'vnpCreateFromAddress', vnpAddressId, label: dto.label }) });
    return { config, raw };
  }

  /** Lưu mapping xưởng → địa chỉ + mặc định. Validate id có trong addresses. */
  async saveShippingMap(dto: SaveVnpShippingMapDto): Promise<VnpShippingConfig> {
    const config = await this.getShippingConfig();
    const known = new Set(config.addresses.map((a) => a.vnpAddressId));
    for (const [factoryId, addrId] of Object.entries(dto.factoryMap)) {
      if (addrId && !known.has(addrId)) {
        throw new BadRequestException(`Địa chỉ ${addrId} (xưởng ${factoryId}) không tồn tại trong danh sách.`);
      }
    }
    if (dto.defaultAddressId && !known.has(dto.defaultAddressId)) {
      throw new BadRequestException('Địa chỉ mặc định không tồn tại trong danh sách.');
    }
    // Bỏ entry rỗng (FE gửi '' khi bỏ gán).
    config.factoryMap = Object.fromEntries(Object.entries(dto.factoryMap).filter(([, v]) => !!v));
    config.defaultAddressId = dto.defaultAddressId || undefined;
    await this.systemConfigService.set(VNP_SHIPPING_CONFIG_KEY, config);
    return config;
  }

  /** Gỡ địa chỉ khỏi blob (không xóa bên VNP) + dọn mapping trỏ vào nó. */
  async deleteFromAddress(vnpAddressId: string): Promise<VnpShippingConfig> {
    const config = await this.getShippingConfig();
    config.addresses = config.addresses.filter((a) => a.vnpAddressId !== vnpAddressId);
    config.factoryMap = Object.fromEntries(Object.entries(config.factoryMap).filter(([, v]) => v !== vnpAddressId));
    if (config.defaultAddressId === vnpAddressId) config.defaultAddressId = undefined;
    await this.systemConfigService.set(VNP_SHIPPING_CONFIG_KEY, config);
    return config;
  }

  /**
   * Resolve địa chỉ gửi cho 1 đơn: xưởng của đơn → mapping; chưa gán →
   * defaultAddressId; cuối cùng env VNP_EGLOBAL_FROM_ADDRESS_ID (fallback).
   */
  private async resolveFromAddressId(order: OrderEntity): Promise<string> {
    const config = await this.getShippingConfig();
    const byFactory = order.factoryId ? config.factoryMap[String(order.factoryId)] : undefined;
    const resolved = byFactory ?? config.defaultAddressId ?? this.apiConfigService.vnpEglobalConfig?.fromAddressId;
    if (!resolved) {
      throw new BadRequestException(
        'Chưa cấu hình địa chỉ gửi hàng (ShippingFrom) — vào Cài đặt → Vận chuyển VNP tạo địa chỉ kho và gán xưởng.',
      );
    }
    return resolved;
  }

  getStatus(): VnpShippingStatus {
    const config = this.apiConfigService.vnpEglobalConfig;
    const missing = this.apiConfigService.vnpEglobalMissingEnv;
    return {
      configured: !!config && missing.length === 0,
      missing,
      apiUrl: config?.apiUrl,
      shippingUnitId: config?.shippingUnitId || undefined,
    };
  }

  private async loadOrder(orderId: string) {
    const order = await this.orderModel.findOne({ _id: orderId });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Nhóm item cùng đơn seller: phía mình mỗi item là 1 OrderEntity với
   * `productionId` riêng, nhưng seller đặt 1 đơn (`orderId`) nhiều item và
   * **1 đơn chỉ mua 1 label** → vận đơn tạo THEO NHÓM `orderId`, mỗi item
   * = 1 entry `package_details`. Đơn không có `orderId` → nhóm 1 mình nó.
   * Loại item đã hủy (`cancelledAt`) khỏi nhóm.
   */
  private async loadGroup(order: Awaited<ReturnType<ShippingVnpService['loadOrder']>>) {
    if (!order.orderId?.trim()) return [order];
    const siblings = await this.orderModel
      .find({ orderId: order.orderId.trim(), cancelledAt: null })
      .sort({ productionId: 1 });
    return siblings.length > 0 ? siblings : [order];
  }

  /** Số dư ví VNP — dò field balance trong response (spec không khai). */
  async getWallet(): Promise<{ balance?: string; raw: unknown }> {
    const raw = await this.client.availableBalance();
    return { balance: digString(raw, ['balance', 'available_balance', 'availableBalance', 'amount']), raw };
  }

  /** Nhóm item cùng orderId — FE hiện trước khi tạo label chung. */
  async getGroup(orderId: string): Promise<{
    orderId?: string;
    items: Array<{
      id: string;
      productionId: string;
      type?: string;
      quantity?: number;
      weight?: number;
      hasActiveShipment: boolean;
    }>;
  }> {
    const order = await this.loadOrder(orderId);
    const group = await this.loadGroup(order);
    return {
      orderId: order.orderId?.trim() || undefined,
      items: group.map((o) => ({
        id: String(o._id),
        productionId: o.productionId,
        type: o.type || undefined,
        quantity: o.quantity ?? undefined,
        weight: o.weight ?? undefined,
        hasActiveShipment: !!o.vnpShipment?.shipmentId && !o.vnpShipment.cancelledAt,
      })),
    };
  }

  private requireAddress(order: OrderEntity): ProductionOrderShippingAddress {
    const addr = order.shippingAddress;
    if (!addr || (!addr.address1 && !addr.city)) {
      throw new BadRequestException(
        'Đơn chưa có địa chỉ nhận hàng (shippingAddress) — không thể tạo vận đơn. ' +
          'Đơn khách portal luôn có; đơn import OnosPod dùng "Kiểm tra design mới" để kéo địa chỉ về trước.',
      );
    }
    return addr;
  }

  private async saveShipmentInfo(orderId: string, patch: Partial<VnpShipmentInfo>): Promise<VnpShipmentInfo> {
    const $set = Object.fromEntries(
      Object.entries(patch)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [`vnpShipment.${k}`, v]),
    );
    const updated = await this.orderModel.findOneAndUpdate({ _id: orderId }, { $set }, { new: true });
    return updated?.vnpShipment ?? (patch as VnpShipmentInfo);
  }

  /** Lưu cùng 1 patch vận đơn cho CẢ nhóm item cùng orderId (1 đơn 1 label). */
  private async saveShipmentInfoMany(orderIds: string[], patch: Partial<VnpShipmentInfo>): Promise<void> {
    const $set = Object.fromEntries(
      Object.entries(patch)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [`vnpShipment.${k}`, v]),
    );
    await this.orderModel.updateMany({ _id: { $in: orderIds } }, { $set });
  }

  /**
   * Bước 1 — kiểm tra địa chỉ nhận trước khi mua label. 2 lớp:
   * (a) pre-check LOCAL các gate mà createShipment chắc chắn chặn nhưng USPS
   *     bỏ qua/tự sửa: country phải US, state phải là mã bang hợp lệ;
   * (b) USPS checkAddress — parse CHÍNH XÁC `result.verifications.{zip4,delivery}`
   *     (delivery bắt cả số nhà không tồn tại: `E.ADDRESS.NOT_FOUND`); lưu ý
   *     `code` ngoài cùng LUÔN 200 kể cả khi địa chỉ sai — không dùng looksOk.
   */
  async checkAddress(orderId: string): Promise<{ valid: boolean; message?: string; raw: unknown }> {
    const order = await this.loadOrder(orderId);
    const addr = this.requireAddress(order);

    const problems: string[] = [];
    const notes: string[] = [];
    const country = (addr.country || 'US').trim().toUpperCase();
    const stateCode = normalizeUsState(addr.state);
    if (country !== 'US') {
      problems.push(`country="${addr.country}" — shipping unit hiện chỉ nhận địa chỉ US (DOMESTIC)`);
    } else if (!VALID_US_STATE_SET.has(stateCode)) {
      problems.push(`state="${addr.state ?? ''}" không phải mã bang US hợp lệ — tạo vận đơn sẽ dính "State field is invalid"`);
    }
    if (!addr.address1?.trim()) problems.push('Thiếu địa chỉ đường (address1)');
    if (!addr.city?.trim()) problems.push('Thiếu city');
    if (!addr.postcode?.trim()) problems.push('Thiếu zip (postcode)');

    const raw = await this.client.checkAddressUsps({
      street1: addr.address1 || '',
      street2: addr.address2 || undefined,
      city: addr.city || '',
      state: addr.state || '',
      zip: addr.postcode || '',
      country: addr.country || 'US',
    });

    const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const result = (rec.result && typeof rec.result === 'object' ? rec.result : {}) as Record<string, unknown>;
    const verifications = result.verifications as { zip4?: UspsVerification; delivery?: UspsVerification } | undefined;
    let uspsOk: boolean;
    if (verifications?.delivery || verifications?.zip4) {
      uspsOk = verifications.delivery?.success !== false && verifications.zip4?.success !== false;
      for (const v of [verifications.zip4, verifications.delivery]) {
        for (const e of v?.errors ?? []) {
          const msg = e?.message || e?.code;
          if (msg && !notes.includes(`USPS: ${msg}`)) notes.push(`USPS: ${msg}`);
        }
      }
      // USPS tự sửa state theo zip (gõ "ZZ" vẫn trả về "NC") — lệch với dữ
      // liệu đơn nghĩa là label sẽ in state sai → bắt sửa dữ liệu trước.
      const uspsState = typeof result.state === 'string' ? result.state.toUpperCase() : '';
      if (uspsOk && uspsState && stateCode && uspsState !== stateCode) {
        problems.push(`USPS trả state="${uspsState}" khác dữ liệu đơn ("${stateCode}") — sửa state của đơn trước khi mua label`);
      }
      const uspsZip = typeof result.zip === 'string' ? result.zip : '';
      if (uspsOk && uspsZip && uspsZip !== (addr.postcode || '')) notes.push(`USPS chuẩn hóa zip: ${uspsZip}`);
    } else {
      // Không thấy verifications (VNP đổi shape?) — rơi về heuristic cũ.
      uspsOk = looksOk(raw);
      notes.push('Không đọc được verifications từ response — kết quả theo heuristic, cần soi raw');
    }

    const valid = problems.length === 0 && uspsOk;
    const message = [...problems, ...notes].join(' • ') || digString(raw, ['message', 'error']);
    await this.saveShipmentInfo(orderId, { addressValid: valid, addressCheckedAt: new Date() });
    this.logger.info({
      message: JSON.stringify({ action: 'vnpCheckAddress', orderId, productionId: order.productionId, valid, problems }),
    });
    return { valid, message, raw };
  }

  /**
   * Trả kết quả LƯỢT MUA TRƯỚC cho lời gọi lặp cùng `requestId` (§2 — không
   * tạo nhãn thứ hai, không ném lỗi khi nhãn đã có). Record còn đang xử lý dở
   * (`purchasing`/`cancelling`) thì chưa có nhãn để trả → lỗi mềm bảo chờ.
   */
  private replayPurchase(
    prev: ShipmentDocument,
    groupProductionIds: string[],
  ): { shipment: VnpShipmentInfo; groupProductionIds: string[]; raw: unknown; rawAddress?: unknown } {
    if (prev.status === 'purchasing' || prev.status === 'cancelling') {
      throw new BadRequestException(
        `Lượt mua với requestId này đang xử lý dở (record ${String(prev._id)}, status=${prev.status}) — ` +
          'chờ cron đối soát chốt xong rồi thử lại.',
      );
    }
    this.logger.info({
      message: JSON.stringify({ action: 'vnpCreateShipmentReplay', recordId: String(prev._id), status: prev.status }),
    });
    return {
      shipment: {
        shipmentId: prev.vnpShipmentId,
        trackingCode: prev.trackingCode,
        labelUrl: prev.labelUrl,
        service: prev.service as VnpShipmentInfo['service'],
        shippingType: prev.shippingType as VnpShipmentInfo['shippingType'],
        toAddressId: prev.toAddressId,
        createdAt: prev.createdAt,
      },
      groupProductionIds,
      raw: { reused: true, recordId: String(prev._id), status: prev.status },
    };
  }

  /**
   * Bước 2 — tạo vận đơn: createAddress(ShippingTo) → createShipment.
   * Gộp theo `orderId` seller (1 đơn nhiều item = 1 label): mỗi item của nhóm
   * thành 1 entry `package_details`, `rep1` = productionId từng item (unique
   * bên VNP → chống trùng), `rep2` = orderId. Kết quả lưu lên CẢ nhóm.
   */
  async createShipment(
    orderId: string,
    dto: CreateVnpShipmentDto,
    createdBy?: { userId?: string; userName?: string },
  ): Promise<{ shipment: VnpShipmentInfo; groupProductionIds: string[]; raw: unknown; rawAddress?: unknown }> {
    const order = await this.loadOrder(orderId);
    const addr = this.requireAddress(order);
    if (!order.productionId) throw new BadRequestException('Đơn thiếu productionId.');
    const group = await this.loadGroup(order);
    const groupIds = group.map((o) => String(o._id));
    const groupProductionIds = group.map((o) => o.productionId);
    // Chủ thể nhóm mua cho unique index chống trùng (§2).
    const groupKey = order.orderId?.trim() || `order:${String(order._id)}`;

    // Idempotency (§2): cùng requestId đã mua rồi → trả đúng nhãn lượt trước,
    // không tạo nhãn thứ hai, không ném lỗi (đường sống cho job retry).
    if (dto.requestId) {
      const prev = await this.shipmentModel.findOne({
        provider: SHIPMENT_PROVIDER_VNP,
        purchaseKey: dto.requestId,
        status: { $in: ['purchasing', 'created', 'in_transit', 'delivered', 'cancelling'] },
      });
      if (prev) return this.replayPurchase(prev, groupProductionIds);
    }
    const withShipment = group.find((o) => o.vnpShipment?.shipmentId && !o.vnpShipment.cancelledAt);
    if (withShipment) {
      throw new BadRequestException(
        `Đơn seller này đã có vận đơn VNP (${withShipment.vnpShipment?.shipmentId} — item ${withShipment.productionId}). ` +
          '1 đơn chỉ mua 1 label; hủy vận đơn cũ trước khi tạo lại.',
      );
    }
    // Chống mua CHỒNG: còn record giữ chỗ `purchasing` cho nhóm này (lượt trước
    // đang chạy hoặc chết giữa chừng, chưa đối soát) → chặn tạo lượt mới.
    const groupPackIds = await this.packageModel.find({ productionOrderIds: { $in: groupIds } }).distinct('_id');
    if (groupPackIds.length > 0) {
      const pending = await this.shipmentModel.findOne({
        packageId: { $in: groupPackIds },
        provider: SHIPMENT_PROVIDER_VNP,
        status: 'purchasing',
      });
      if (pending) {
        throw new BadRequestException(
          `Đơn này đang có lượt mua label dở dang (record ${String(pending._id)}). ` +
            'Cron tracking sẽ tự đối soát với VNP để chốt hoặc đánh lỗi record đó — chờ rồi thử lại.',
        );
      }
    }
    const config = this.apiConfigService.vnpEglobalConfig;
    if (!config?.shippingUnitId) {
      throw new BadRequestException('Thiếu env VNP_EGLOBAL_SHIPPING_UNIT_ID (Nexo cấp theo môi trường).');
    }
    // Địa chỉ gửi theo XƯỞNG của đơn (nhiều xưởng dùng chung 1 địa chỉ được).
    const fromAddressId = await this.resolveFromAddressId(order);

    // Địa chỉ nhận US — convention VNP (xác nhận qua test cô lập 24/08 + curl
    // mẫu tài liệu của họ district:"TX"): `district` = mã bang, đó là field
    // carrier đọc làm STATE; field `state` gửi lên bị BỎ QUA lúc createShipment,
    // `ward` là placeholder tùy ý. Thiếu district=mã bang → "State field is
    // invalid" dù address lưu state đúng.
    // Phone carrier đòi bắt đầu khác 0, 8-15 số → chuẩn hóa.
    const name = [addr.firstName, addr.lastName].filter(Boolean).join(' ').trim() || 'Receiver';
    const stateCode = normalizeUsState(addr.state);
    const rawAddress = await this.client.createAddress({
      name,
      phone_number: normalizeVnpPhone(addr.phone),
      city: addr.city || '',
      district: stateCode || addr.city || '-',
      ward: stateCode || '-',
      zip_code: addr.postcode || undefined,
      country: addr.country || 'US',
      street1: addr.address1 || '',
      street2: addr.address2 || undefined,
      address: [addr.address1, addr.address2, addr.city, addr.state, addr.country].filter(Boolean).join(', '),
      is_default: false,
      type_of_address: 'ShippingTo',
      email: addr.email || undefined,
      state: stateCode || undefined,
    });
    const toAddressId = digString(rawAddress, ADDRESS_ID_KEYS);
    if (!looksOk(rawAddress) || !toAddressId) {
      throw new BadRequestException(
        'VNP createAddress không trả address id — response: ' + JSON.stringify(rawAddress).slice(0, 4000),
      );
    }

    // ① GIỮ CHỖ (ShippingLabelPatterns.md §1): tạo pack + record `purchasing`
    // TRƯỚC khi gọi VNP — tiến trình chết sau lời gọi thì record kẹt này là
    // bằng chứng có thể tồn tại label mồ côi, cron `reconcilePurchasing()` sẽ
    // tra VNP (getByRef1 theo rep1=productionId) để chốt nốt hoặc đánh failed.
    const pack = await this.packageModel.create({
      code: `PK-${genCode(10)}`,
      factoryId: order.factoryId || undefined,
      orderCodes: order.orderId?.trim() ? [order.orderId.trim()] : [],
      productionOrderIds: groupIds,
      productionIds: groupProductionIds,
      createdAt: new Date(),
    });
    let shipmentRecord: ShipmentDocument;
    try {
      shipmentRecord = (await this.shipmentModel.create({
        packageId: pack._id,
        provider: 'vnp-eglobal',
        service: dto.service,
        shippingType: dto.shippingType,
        fromAddressId,
        toAddressId,
        groupKey,
        ...(dto.requestId ? { purchaseKey: dto.requestId } : {}),
        status: 'purchasing',
        createdByUserId: createdBy?.userId,
        createdByUserName: createdBy?.userName,
        createdAt: new Date(),
      })) as ShipmentDocument;
    } catch (err) {
      // Cuộc đua thắng ở tầng DB (§2): E11000 nghĩa là một lượt mua khác vừa
      // giữ chỗ trước — quy về nhánh "trả nhãn cũ / báo đang xử lý", không
      // được rơi xuống gọi hãng tạo nhãn thứ hai.
      const e = err as { code?: number; keyPattern?: Record<string, unknown> };
      if (e.code !== 11000) throw err;
      if (e.keyPattern?.purchaseKey && dto.requestId) {
        const prev = await this.shipmentModel.findOne({ provider: SHIPMENT_PROVIDER_VNP, purchaseKey: dto.requestId });
        if (prev) return this.replayPurchase(prev as ShipmentDocument, groupProductionIds);
      }
      throw new BadRequestException(
        'Một lượt mua label khác cho đơn này vừa được ghi nhận (unique index chặn trùng) — ' +
          'mở lại dialog / xem "Lịch sử vận đơn" để lấy kết quả lượt đó.',
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    // ② Gọi hãng. 1 entry package_details / item trong nhóm — weight riêng
    // từng item, fallback dto.weightGram cho item thiếu weight.
    let raw: unknown;
    try {
      raw = await this.client.createShipment({
      shipping_from_id: fromAddressId,
      shipping_to_id: toAddressId,
      package_details: group.map((o) => ({
        type_product: 'Item',
        packages: String(dto.packages ?? 1),
        weight_per_package: String(o.weight && o.weight > 0 ? o.weight : dto.weightGram),
        product_id: String(o.productConfigId ?? o.type ?? o.productionId),
        weight_unit: 'gram',
        length: dto.lengthCm ?? (o.length && o.length > 0 ? o.length : 1),
        wide: dto.wideCm ?? (o.width && o.width > 0 ? o.width : 1),
        height: dto.heightCm ?? (o.height && o.height > 0 ? o.height : 1),
        dimentions_unit: 'cm',
        rep1: o.productionId,
        rep2: o.orderId || undefined,
        quantity: o.quantity ?? 1,
        package_type: dto.packageType || undefined,
      })),
        shipping_unit_id: config.shippingUnitId,
        service: dto.service,
        ship_date: today,
        ready_time: today,
        last_time_available: today,
        confirmation: true,
        shipping_type: dto.shippingType,
        ...(dto.service === 'Uniuni' ? { disable_fallback: true } : {}),
      });
    } catch (err) {
      // KHÔNG hỏi được hãng (network/5xx — client đã gộp thành exception):
      // trạng thái label CHƯA BIẾT → GIỮ record `purchasing` cho cron đối soát,
      // tuyệt đối không đánh failed (có thể label đã tạo, tiền đã trừ).
      this.logger.warn({
        message: JSON.stringify({
          action: 'vnpCreateShipmentUnknown',
          recordId: String(shipmentRecord._id),
          orderId,
          error: (err as Error).message?.slice(0, 500),
        }),
      });
      throw new BadRequestException(
        'Không xác định được kết quả mua label (VNP không trả lời). Hệ thống sẽ tự đối soát ở cron tracking — ' +
          'KHÔNG bấm mua lại ngay. ' +
          (err as Error).message?.slice(0, 2000),
      );
    }
    if (!looksOk(raw)) {
      // Hãng TRẢ LỜI RÕ là lỗi → label không được tạo, không mất tiền: chốt
      // failed (có điều kiện — cron có thể đã đụng record này).
      const failReason = JSON.stringify(raw).slice(0, 1000);
      await this.shipmentModel.updateOne(
        { _id: shipmentRecord._id, status: 'purchasing' },
        { $set: { status: 'failed', failReason } },
      );
      throw new BadRequestException('VNP createShipment lỗi — response: ' + JSON.stringify(raw).slice(0, 6000));
    }

    // Format thật (xác nhận 24/08): { code:200, result:[{ id, shipping_cost,
    // shipmentResults:{ id, tracking_code, image_url (LABEL PDF) } }] }.
    const rec = ((raw as Record<string, unknown> | null)?.result as Array<Record<string, unknown>> | undefined)?.[0];
    const shipmentResults = rec?.shipmentResults as Record<string, unknown> | undefined;
    const info: Partial<VnpShipmentInfo> = {
      shipmentId: (typeof rec?.id === 'string' ? rec.id : undefined) ?? digString(raw, SHIPMENT_ID_KEYS),
      trackingCode:
        (typeof shipmentResults?.tracking_code === 'string' ? shipmentResults.tracking_code : undefined) ??
        digString(raw, TRACKING_KEYS),
      labelUrl:
        (typeof shipmentResults?.image_url === 'string' ? shipmentResults.image_url : undefined) ??
        digString(raw, LABEL_KEYS),
      service: dto.service,
      shippingType: dto.shippingType,
      toAddressId,
      createdAt: new Date(),
    };
    // ③ GHI NGAY mã định danh bên hãng vào record — TÁCH khỏi bước chốt ④:
    // nếu bước chốt hỏng thì mã vẫn còn, cron đối soát tra thẳng theo id thay
    // vì mò getByRef1. Record vẫn đang `purchasing`.
    await this.shipmentModel.updateOne(
      { _id: shipmentRecord._id },
      {
        $set: {
          ...(info.shipmentId ? { vnpShipmentId: info.shipmentId } : {}),
          ...(info.trackingCode ? { trackingCode: info.trackingCode } : {}),
          ...(info.labelUrl ? { labelUrl: info.labelUrl } : {}),
          ...(typeof rec?.shipping_cost === 'string' || typeof rec?.shipping_cost === 'number'
            ? { shippingCost: String(rec.shipping_cost) }
            : {}),
        },
      },
    );

    // ④ Chốt sang `created` bằng CẬP NHẬT CÓ ĐIỀU KIỆN — cron đối soát cũng
    // ghi vào đúng record này, chỉ 1 bên được thắng cuộc đua.
    const finalized = await this.shipmentModel.updateOne(
      { _id: shipmentRecord._id, status: 'purchasing' },
      { $set: { status: 'created' } },
    );
    if (finalized.modifiedCount === 0) {
      this.logger.warn({
        message: JSON.stringify({
          action: 'vnpCreateShipmentFinalizeRace',
          recordId: String(shipmentRecord._id),
          note: 'record đã bị chốt bởi nơi khác (cron đối soát?) — không chốt đè',
        }),
      });
    }
    // ── Từ đây trở xuống là VÙNG KHÔNG ĐƯỢC NÉM (ShippingLabelPatterns.md §5):
    // label đã chốt, tiền đã tiêu — mọi việc phụ hỏng chỉ warn rồi đi tiếp.
    // Đối soát ví: chụp số dư NGAY SAU khi mua — lỗi thì bỏ qua, tuyệt đối
    // không làm fail luồng mua (label đã tạo xong bên VNP rồi).
    try {
      const balanceAfter = digString(await this.client.availableBalance(), [
        'balance',
        'available_balance',
        'availableBalance',
        'amount',
      ]);
      if (balanceAfter) {
        await this.shipmentModel.updateOne({ _id: shipmentRecord._id }, { $set: { balanceAfter } });
      }
    } catch {
      // ignore — chỉ mất 1 điểm đối soát
    }

    // Snapshot mỏng lên CẢ nhóm orders (1 orderId 1 label — item nào mở dialog
    // cũng thấy, list render không phải join). Xóa cancelledAt cũ nếu tạo lại.
    // Việc phụ — hỏng thì warn, record shipments (nguồn sự thật) đã chốt xong.
    try {
      await this.saveShipmentInfoMany(groupIds, info);
      await this.orderModel.updateMany({ _id: { $in: groupIds } }, { $unset: { 'vnpShipment.cancelledAt': 1 } });
    } catch (err) {
      this.logger.warn({
        message: JSON.stringify({
          action: 'vnpCreateShipmentSnapshotFail',
          recordId: String(shipmentRecord._id),
          error: (err as Error).message?.slice(0, 500),
        }),
      });
    }
    const shipment = (await this.orderModel.findOne({ _id: orderId }))?.vnpShipment ?? (info as VnpShipmentInfo);
    this.logger.info({
      message: JSON.stringify({
        action: 'vnpCreateShipment',
        orderId,
        sellerOrderId: order.orderId,
        groupProductionIds,
        shipmentId: shipment.shipmentId,
        trackingCode: shipment.trackingCode,
        hasLabel: !!shipment.labelUrl,
      }),
    });
    return { shipment, groupProductionIds, raw, rawAddress };
  }

  /** Bước 3 — tra tracking (ưu tiên trackingCode, fallback shipmentId). */
  async getTracking(orderId: string): Promise<{ shipment?: VnpShipmentInfo; raw: unknown }> {
    const order = await this.loadOrder(orderId);
    const code = order.vnpShipment?.trackingCode || order.vnpShipment?.shipmentId;
    if (!code) throw new BadRequestException('Đơn chưa có vận đơn VNP — tạo vận đơn trước.');
    const raw = await this.client.getTracking(code);
    const now = new Date();
    // Trạng thái HÃNG dựng ở helper thuần (§3) — cần trạng thái trước đó của
    // record active để giữ luật "scannedAt set 1 lần" + chỉ ghi event khi đổi.
    const activeRecord = await this.shipmentModel.findOne({
      vnpShipmentId: order.vnpShipment?.shipmentId,
      status: { $in: ['created', 'in_transit'] },
    });
    const patch = buildCarrierPatch(
      activeRecord ?? { lastTrackingStatus: order.vnpShipment?.lastTrackingStatus, scannedAt: undefined, status: 'created' },
      raw,
      now,
    );
    // Cập nhật snapshot cho MỌI item cùng shipmentId (nhóm 1 đơn 1 label).
    await this.orderModel.updateMany(
      { 'vnpShipment.shipmentId': order.vnpShipment?.shipmentId },
      {
        $set: {
          ...(patch.statusText ? { 'vnpShipment.lastTrackingStatus': patch.statusText } : {}),
          'vnpShipment.lastTrackingAt': now,
          ...(patch.set.scannedAt ? { 'vnpShipment.scannedAt': now } : {}),
        },
      },
    );
    // Sync record shipments (nguồn sự thật) + ghi event khi trạng thái ĐỔI.
    await this.shipmentModel.updateMany(
      { vnpShipmentId: order.vnpShipment?.shipmentId, status: { $in: ['created', 'in_transit'] } },
      {
        $set: patch.set,
        ...(patch.changed ? { $push: { trackingEvents: { status: patch.statusText, at: now } } } : {}),
      },
    );
    const shipment = (await this.orderModel.findOne({ _id: orderId }))?.vnpShipment ?? undefined;
    return { shipment, raw };
  }

  /** Chi tiết shipment (GET /shipment/{id}) — soi response tìm label sau khi tạo. */
  async getShipmentDetail(orderId: string): Promise<{ raw: unknown }> {
    const order = await this.loadOrder(orderId);
    const shipmentId = order.vnpShipment?.shipmentId;
    if (!shipmentId) throw new BadRequestException('Đơn chưa có vận đơn VNP.');
    const raw = await this.client.getShipment(shipmentId);
    // Nhặt bù label/tracking nếu createShipment không trả mà get detail có —
    // lưu cho MỌI item cùng shipmentId (nhóm 1 đơn 1 label).
    const labelUrl = digString(raw, LABEL_KEYS);
    const trackingCode = digString(raw, TRACKING_KEYS);
    if (labelUrl || trackingCode) {
      const $set = {
        ...(labelUrl ? { labelUrl } : {}),
        ...(trackingCode && !order.vnpShipment?.trackingCode ? { trackingCode } : {}),
      };
      await this.orderModel.updateMany(
        { 'vnpShipment.shipmentId': shipmentId },
        {
          $set: {
            ...(labelUrl ? { 'vnpShipment.labelUrl': labelUrl } : {}),
            ...(trackingCode && !order.vnpShipment?.trackingCode ? { 'vnpShipment.trackingCode': trackingCode } : {}),
          },
        },
      );
      await this.shipmentModel.updateMany({ vnpShipmentId: shipmentId }, { $set });
    }
    return { raw };
  }

  /**
   * Bước 4 — hủy vận đơn, FAIL-CLOSED theo chiều tiền (ShippingLabelPatterns.md
   * §4): ① kiểm label đã vào mạng lưới chưa (scannedAt local + hỏi hãng) — đã
   * quét / KHÔNG hỏi được → TỪ CHỐI; ② chuyển `cancelling`; ③ gọi hãng hủy;
   * ④ chỉ khi hãng xác nhận mới chốt `cancelled`. Lệnh hủy gửi đi mà không có
   * trả lời → record kẹt `cancelling`, cron `reconcileCancelling()` dọn.
   */
  async cancelShipment(orderId: string): Promise<{ shipment: VnpShipmentInfo; raw: unknown }> {
    const order = await this.loadOrder(orderId);
    const shipmentId = order.vnpShipment?.shipmentId;
    if (!shipmentId) throw new BadRequestException('Đơn chưa có vận đơn VNP.');
    const record = await this.shipmentModel
      .findOne({ vnpShipmentId: shipmentId, status: { $in: ['created', 'in_transit', 'cancelling'] } })
      .sort({ createdAt: -1 });

    // ① Chốt local: đã từng ghi nhận label vào mạng lưới → từ chối thẳng,
    // không cần hỏi hãng (hủy nhầm label đang giao = hàng cứ đi, mình mất dấu).
    const knownScan = record?.scannedAt ?? order.vnpShipment?.scannedAt;
    if (knownScan) {
      throw new BadRequestException(
        `Label đã vào mạng lưới vận chuyển (quét lần đầu ${new Date(knownScan).toISOString()}) — TỪ CHỐI hủy. ` +
          'Hàng có thể đang trên đường giao; hủy lúc này chỉ làm mất dấu kiện.',
      );
    }

    // ① Hỏi hãng hành trình hiện tại — FAIL-CLOSED: không có mã để hỏi hoặc
    // không hỏi được đều TỪ CHỐI (ngược chiều các chốt khác trong hệ, cùng
    // tinh thần: nghi ngờ thì chọn hướng không mất tiền/mất hàng).
    const trackingCode = record?.trackingCode || order.vnpShipment?.trackingCode;
    if (!trackingCode) {
      throw new BadRequestException(
        'Không có tracking code để kiểm tra label đã đi chưa — TỪ CHỐI hủy (fail-closed). ' +
          'Bấm "Chi tiết shipment" để nhặt bù tracking rồi thử lại.',
      );
    }
    let trackRaw: unknown;
    try {
      trackRaw = await this.client.publicTrack(trackingCode);
    } catch (err) {
      throw new BadRequestException(
        'Không hỏi được hành trình label (mạng/VNP lỗi) — TỪ CHỐI hủy (fail-closed), thử lại sau. ' +
          (err as Error).message?.slice(0, 1000),
      );
    }
    if (hasCarrierError(trackRaw)) {
      // Nguồn tracking trả LỖI (vd cạn quota) — không kết luận được label đã đi
      // chưa → cùng nhánh fail-closed với lỗi mạng.
      throw new BadRequestException(
        'Nguồn tracking trả lỗi — không xác định được label đã đi chưa, TỪ CHỐI hủy (fail-closed). Thử lại sau. ' +
          JSON.stringify(trackRaw).slice(0, 1000),
      );
    }
    if (hasCarrierSignal(trackRaw)) {
      // Hãng báo đã có hành trình — ghi luôn scannedAt làm bằng chứng (đỡ phải
      // hỏi lại lần sau) rồi từ chối.
      const now = new Date();
      const patch = buildCarrierPatch(record ?? { lastTrackingStatus: undefined, scannedAt: undefined, status: 'created' }, trackRaw, now);
      if (record) await this.shipmentModel.updateOne({ _id: record._id }, { $set: patch.set });
      await this.orderModel.updateMany(
        { 'vnpShipment.shipmentId': shipmentId },
        {
          $set: {
            'vnpShipment.scannedAt': now,
            ...(patch.statusText ? { 'vnpShipment.lastTrackingStatus': patch.statusText } : {}),
            'vnpShipment.lastTrackingAt': now,
          },
        },
      );
      throw new BadRequestException(
        `Hãng báo label ĐÃ vào mạng lưới ("${patch.statusText ?? ''}") — TỪ CHỐI hủy.`,
      );
    }

    // ② Trạng thái trung gian "đang hủy" — từ đây tới khi hãng xác nhận là
    // vùng CHƯA BIẾT: không hoàn tiền, không coi kiện là xong, không mua mới.
    const cancelRequestedAt = new Date();
    if (record) {
      await this.shipmentModel.updateOne(
        { _id: record._id, status: { $in: ['created', 'in_transit', 'cancelling'] } },
        { $set: { status: 'cancelling', cancelRequestedAt } },
      );
    }

    // ③ Gọi hãng hủy. Không nhận được trả lời → GIỮ `cancelling` cho cron dọn.
    let raw: unknown;
    try {
      raw = await this.client.cancelShipment(shipmentId);
    } catch (err) {
      throw new BadRequestException(
        'Đã gửi lệnh hủy nhưng KHÔNG nhận được trả lời từ VNP — record chuyển "Đang hủy", cron sẽ tự đối soát. ' +
          'KHÔNG mua label mới cho đơn này cho tới khi record chốt xong. ' +
          (err as Error).message?.slice(0, 1000),
      );
    }
    if (!looksOk(raw)) {
      // Hãng TRẢ LỜI RÕ là không hủy được → label còn sống, trả record về
      // trạng thái mở cũ để không kẹt "cancelling" oan.
      if (record) {
        await this.shipmentModel.updateOne(
          { _id: record._id, status: 'cancelling' },
          { $set: { status: record.status === 'in_transit' ? 'in_transit' : 'created' }, $unset: { cancelRequestedAt: 1 } },
        );
      }
      throw new BadRequestException('VNP cancelShipment lỗi — response: ' + JSON.stringify(raw).slice(0, 6000));
    }

    // ④ Hãng xác nhận (code 200 — shape response cancel thật CHƯA đo, khi đo
    // được thì siết thêm điều kiện xác nhận) → chốt `cancelled`, ghi sổ cả nhóm.
    const cancelledAt = new Date();
    await this.orderModel.updateMany(
      { 'vnpShipment.shipmentId': shipmentId },
      { $set: { 'vnpShipment.cancelledAt': cancelledAt } },
    );
    // Record shipments GIỮ NGUYÊN, chỉ chuyển trạng thái — lịch sử còn mãi.
    await this.shipmentModel.updateMany(
      { vnpShipmentId: shipmentId, status: { $in: ['created', 'in_transit', 'cancelling'] } },
      { $set: { status: 'cancelled', cancelledAt } },
    );
    const shipment = (await this.orderModel.findOne({ _id: orderId }))?.vnpShipment ?? ({} as VnpShipmentInfo);
    this.logger.info({
      message: JSON.stringify({ action: 'vnpCancelShipment', orderId, productionId: order.productionId, shipmentId }),
    });
    return { shipment, raw };
  }

  // ── Lịch sử vận đơn (bảng shipments + shipping_packages) ─────────────────

  private toShipmentRecord(doc: ShipmentDocument): VnpShipmentRecord {
    const pack = doc.package;
    return {
      _id: String(doc._id),
      packageId: doc.packageId,
      provider: doc.provider,
      vnpShipmentId: doc.vnpShipmentId,
      trackingCode: doc.trackingCode,
      labelUrl: doc.labelUrl,
      carrier: doc.carrier,
      trackingUrl: doc.trackingUrl,
      service: doc.service,
      shippingType: doc.shippingType,
      fromAddressId: doc.fromAddressId,
      toAddressId: doc.toAddressId,
      shippingCost: doc.shippingCost,
      balanceAfter: doc.balanceAfter,
      status: doc.status,
      failReason: doc.failReason,
      cancelRequestedAt: doc.cancelRequestedAt,
      cancelledAt: doc.cancelledAt,
      lastTrackingStatus: doc.lastTrackingStatus,
      lastTrackingAt: doc.lastTrackingAt,
      scannedAt: doc.scannedAt,
      carrierNote: doc.carrierNote,
      trackingEvents: doc.trackingEvents ?? [],
      createdByUserId: doc.createdByUserId,
      createdByUserName: doc.createdByUserName,
      sellerPrice: doc.sellerPrice,
      sellerCustomerId: doc.sellerCustomerId,
      createdAt: doc.createdAt,
      package: pack
        ? {
            _id: String(pack._id),
            code: pack.code,
            factoryId: pack.factoryId,
            orderCodes: pack.orderCodes ?? [],
            productionOrderIds: pack.productionOrderIds ?? [],
            productionIds: pack.productionIds ?? [],
            parentPackageId: pack.parentPackageId,
            createdAt: pack.createdAt,
          }
        : undefined,
    };
  }

  /** Danh sách vận đơn toàn hệ thống — search khớp tracking/mã kiện/mã đơn. */
  async listShipments(dto: GetVnpShipmentsDto): Promise<{ data: VnpShipmentRecord[]; total: number }> {
    // Every condition is ANDed: the search `$or` and the carrier-phase `$or`/`$nor` must never
    // overwrite each other (same trap as the order filters, Orders.md §25).
    const conds: Record<string, unknown>[] = [];
    const search = dto.search?.trim();
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      // Kiện khớp theo mã kiện / productionId / orderId seller → OR với field shipment.
      const packIds = await this.packageModel
        .find({ $or: [{ code: rx }, { productionIds: rx }, { orderCodes: rx }] })
        .distinct('_id');
      conds.push({ $or: [{ trackingCode: rx }, { vnpShipmentId: rx }, { packageId: { $in: packIds } }] });
    }
    if (dto.status) conds.push({ status: dto.status });
    if (dto.carrierPhase) conds.push(carrierPhaseFilter(dto.carrierPhase));
    if (dto.from || dto.to) {
      const createdAt: Record<string, Date> = {};
      if (dto.from) createdAt.$gte = new Date(`${dto.from}T00:00:00+07:00`);
      if (dto.to) createdAt.$lte = new Date(`${dto.to}T23:59:59.999+07:00`);
      conds.push({ createdAt });
    }
    const filter = conds.length ? { $and: conds } : {};
    const [docs, total] = await Promise.all([
      this.shipmentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((dto.page - 1) * dto.size)
        .limit(dto.size)
        .populate('package'),
      this.shipmentModel.countDocuments(filter),
    ]);
    const records = (docs as ShipmentDocument[]).map((d) => this.toShipmentRecord(d));
    return { data: await this.withItemsAndShipTo(records, docs as ShipmentDocument[]), total };
  }

  /**
   * List columns ITEM(S) + SHIPPING ADDRESS (legacy Shipments screen): one batched read of the
   * page's production orders, never one query per row.
   */
  private async withItemsAndShipTo(records: VnpShipmentRecord[], docs: ShipmentDocument[]): Promise<VnpShipmentRecord[]> {
    const idsByRecord = docs.map((d) => d.package?.productionOrderIds ?? []);
    const allIds = [...new Set(idsByRecord.flat())];
    if (allIds.length === 0) return records;
    const orders = await this.orderModel
      .find({ _id: { $in: allIds } }, { productionId: 1, type: 1, size: 1, color: 1, mockupUrl: 1, shippingAddress: 1, productConfigId: 1 })
      .lean();
    const byId = new Map(orders.map((o) => [String(o._id), o]));
    // Variant SKU per item, same function as the label (Orders.md §23a), one read for the page.
    const pcIds = [...new Set(orders.map((o) => (o.productConfigId ? String(o.productConfigId) : '')).filter(Boolean))];
    const configs = pcIds.length
      ? await this.orderModel.db
          .collection('productConfigs')
          .find<{ _id: unknown; variations?: { sku?: string }[] }>({ _id: { $in: pcIds } } as never, { projection: { 'variations.sku': 1 } })
          .toArray()
      : [];
    const varsByPc = new Map(configs.map((c) => [String(c._id), c.variations ?? []]));
    const variantSkuOf = (o: { productConfigId?: unknown; size?: string }) =>
      o.productConfigId ? resolveShippingLabelInfo(varsByPc.get(String(o.productConfigId)) ?? [], o.size, undefined, undefined).sku : undefined;
    return records.map((r, i) => {
      const own = idsByRecord[i].map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
      if (own.length === 0) return r;
      return {
        ...r,
        items: own.map((o) => ({
          productionId: o.productionId,
          type: o.type,
          size: o.size,
          color: o.color,
          mockupUrl: o.mockupUrl,
          variantSku: variantSkuOf(o),
        })),
        shipTo: own.find((o) => o.shippingAddress)?.shippingAddress,
      };
    });
  }

  /** Lịch sử vận đơn của 1 đơn sản xuất — mọi record của các kiện chứa nó. */
  async getOrderShipments(orderId: string): Promise<VnpShipmentRecord[]> {
    const order = await this.loadOrder(orderId);
    const packIds = await this.packageModel.find({ productionOrderIds: String(order._id) }).distinct('_id');
    if (packIds.length === 0) return [];
    const docs = await this.shipmentModel
      .find({ packageId: { $in: packIds } })
      .sort({ createdAt: -1 })
      .populate('package');
    return (docs as ShipmentDocument[]).map((d) => this.toShipmentRecord(d));
  }

  // ── Cron đối soát record kẹt `purchasing` (ShippingLabelPatterns.md §1 ⑤) ──

  /**
   * Dọn record giữ chỗ kẹt `purchasing` quá RECONCILE_MIN_AGE_MS: hỏi VNP theo
   * mã đã ghi ở bước ③ (`getShipment`) hoặc rep1=productionId (`getByRef1`),
   * phân loại theo §8 — found → chốt nốt `created` + sync snapshot; hãng nói
   * không có → `failed` (GIỮ record + failReason làm dấu vết tiền); không hỏi
   * được → ĐỂ NGUYÊN, lượt sau thử lại. TUYỆT ĐỐI không xóa record kẹt.
   */
  async reconcilePurchasing(): Promise<{ scanned: number; finalized: number; failed: number; unknown: number }> {
    const cutoff = new Date(Date.now() - RECONCILE_MIN_AGE_MS);
    const stuck = (await this.shipmentModel
      .find({ provider: SHIPMENT_PROVIDER_VNP, status: 'purchasing', createdAt: { $lt: cutoff } })
      .sort({ createdAt: 1 })
      .limit(RECONCILE_BATCH)
      .populate('package')) as ShipmentDocument[];
    let finalized = 0;
    let failed = 0;
    let unknown = 0;
    for (const doc of stuck) {
      const rep1 = doc.package?.productionIds?.[0];
      const url = doc.vnpShipmentId
        ? `/shipment/${encodeURIComponent(doc.vnpShipmentId)}`
        : rep1
          ? `/shipment/getByRef1/${encodeURIComponent(rep1)}`
          : null;
      if (!url) {
        // Không có mã nào để tra (pack luôn có productionIds — ca này gần như
        // không xảy ra, nhưng để record kẹt vĩnh viễn thì tệ hơn).
        await this.shipmentModel.updateOne(
          { _id: doc._id, status: 'purchasing' },
          { $set: { status: 'failed', failReason: 'Không có mã nào để đối soát với VNP' } },
        );
        failed += 1;
        continue;
      }
      const probe = await this.client.probe(url);
      const outcome = interpretVnpLookup(probe.http, probe.body);
      if (outcome.kind === 'found') {
        // rep1 có thể tra ngược ra label của LƯỢT MUA TRƯỚC (đã có record giữ)
        // → lượt này không tạo label mới, đánh failed thay vì nhận vơ.
        const ownedElsewhere = outcome.shipmentId
          ? await this.shipmentModel.exists({ _id: { $ne: doc._id }, vnpShipmentId: outcome.shipmentId })
          : null;
        if (ownedElsewhere) {
          await this.shipmentModel.updateOne(
            { _id: doc._id, status: 'purchasing' },
            {
              $set: {
                status: 'failed',
                failReason: `Shipment ${outcome.shipmentId} thuộc lượt mua trước — lượt này không tạo label mới`,
              },
            },
          );
          failed += 1;
        } else {
          // Chốt có điều kiện — người bấm mua (bước ④) có thể vừa chốt xong.
          const res = await this.shipmentModel.updateOne(
            { _id: doc._id, status: 'purchasing' },
            {
              $set: {
                status: 'created',
                ...(outcome.shipmentId ? { vnpShipmentId: outcome.shipmentId } : {}),
                ...(outcome.trackingCode ? { trackingCode: outcome.trackingCode } : {}),
                ...(outcome.labelUrl ? { labelUrl: outcome.labelUrl } : {}),
              },
            },
          );
          if (res.modifiedCount > 0) {
            finalized += 1;
            // Sync snapshot orders — việc phụ (§5), hỏng chỉ warn.
            try {
              const groupIds = doc.package?.productionOrderIds ?? [];
              if (groupIds.length > 0) {
                await this.saveShipmentInfoMany(groupIds, {
                  shipmentId: outcome.shipmentId ?? doc.vnpShipmentId,
                  trackingCode: outcome.trackingCode ?? doc.trackingCode,
                  labelUrl: outcome.labelUrl ?? doc.labelUrl,
                  // Entity lưu string rộng, snapshot dùng union hẹp — record do
                  // chính createShipment ghi từ DTO nên giá trị luôn hợp lệ.
                  service: doc.service as VnpShipmentInfo['service'],
                  shippingType: doc.shippingType as VnpShipmentInfo['shippingType'],
                  toAddressId: doc.toAddressId,
                  createdAt: doc.createdAt,
                });
                await this.orderModel.updateMany(
                  { _id: { $in: groupIds } },
                  { $unset: { 'vnpShipment.cancelledAt': 1 } },
                );
              }
            } catch (err) {
              this.logger.warn({
                message: JSON.stringify({
                  action: 'vnpReconcileSnapshotFail',
                  recordId: String(doc._id),
                  error: (err as Error).message?.slice(0, 500),
                }),
              });
            }
          }
        }
      } else if (outcome.kind === 'not_found') {
        await this.shipmentModel.updateOne(
          { _id: doc._id, status: 'purchasing' },
          { $set: { status: 'failed', failReason: outcome.reason.slice(0, 1000) } },
        );
        failed += 1;
      } else {
        unknown += 1;
        this.logger.warn({
          message: JSON.stringify({ action: 'vnpReconcileUnknown', recordId: String(doc._id), reason: outcome.reason }),
        });
      }
      // Giãn nhịp như cron tracking — mỗi record là 1 call ra VNP.
      await new Promise((r) => setTimeout(r, 800));
    }
    if (stuck.length > 0) {
      this.logger.info({
        message: JSON.stringify({ action: 'vnpReconcilePurchasing', scanned: stuck.length, finalized, failed, unknown }),
      });
    }
    return { scanned: stuck.length, finalized, failed, unknown };
  }

  /**
   * Dọn record kẹt `cancelling` (§4 — lệnh hủy gửi đi mà không nhận được trả
   * lời): hỏi hãng để chốt 1 trong 3 hướng — hãng nói label KHÔNG CÒN (404 /
   * text trạng thái dạng cancelled) → chốt `cancelled`; label hóa ra ĐANG ĐI
   * (tracking có tín hiệu) → hủy bất thành, trả về `in_transit` + scannedAt +
   * carrierNote cho ops; còn lại → GIỮ NGUYÊN chờ lượt sau / ops xử tay.
   * TUYỆT ĐỐI không tự mở đường hoàn tiền ở đây — chỉ ghi sổ.
   */
  async reconcileCancelling(): Promise<{ scanned: number; cancelled: number; revived: number; unknown: number }> {
    const cutoff = new Date(Date.now() - RECONCILE_MIN_AGE_MS);
    const stuck = (await this.shipmentModel
      .find({ provider: SHIPMENT_PROVIDER_VNP, status: 'cancelling', cancelRequestedAt: { $lt: cutoff } })
      .sort({ cancelRequestedAt: 1 })
      .limit(RECONCILE_BATCH)) as ShipmentDocument[];
    let cancelled = 0;
    let revived = 0;
    let unknown = 0;
    for (const doc of stuck) {
      const unknownBefore = unknown;
      const probe = doc.vnpShipmentId
        ? await this.client.probe(`/shipment/${encodeURIComponent(doc.vnpShipmentId)}`)
        : null;
      const outcome = probe ? interpretVnpLookup(probe.http, probe.body) : null;
      const statusText = probe ? extractStatusText(probe.body) : undefined;
      if (outcome?.kind === 'not_found' || isCancelledStatusText(statusText)) {
        // Hãng xác nhận label không còn → chốt sổ.
        const cancelledAt = new Date();
        await this.shipmentModel.updateOne(
          { _id: doc._id, status: 'cancelling' },
          { $set: { status: 'cancelled', cancelledAt } },
        );
        if (doc.vnpShipmentId) {
          await this.orderModel.updateMany(
            { 'vnpShipment.shipmentId': doc.vnpShipmentId },
            { $set: { 'vnpShipment.cancelledAt': cancelledAt } },
          );
        }
        cancelled += 1;
      } else if (doc.trackingCode) {
        // Chưa kết luận được từ shipment detail — soi hành trình: có tín hiệu
        // scan nghĩa là label SỐNG và đang đi (lệnh hủy bất thành).
        try {
          const trackRaw = await this.client.publicTrack(doc.trackingCode);
          if (hasCarrierSignal(trackRaw)) {
            const now = new Date();
            const patch = buildCarrierPatch(doc, trackRaw, now);
            await this.shipmentModel.updateOne(
              { _id: doc._id, status: 'cancelling' },
              {
                $set: {
                  ...patch.set,
                  status: patch.newStatus ?? 'in_transit',
                  carrierNote: 'Hủy bất thành — label đã vào mạng lưới, hàng đang chạy',
                },
                $unset: { cancelRequestedAt: 1 },
              },
            );
            revived += 1;
          } else {
            unknown += 1;
          }
        } catch {
          unknown += 1; // không hỏi được — không kết luận
        }
      } else {
        unknown += 1;
      }
      if (unknown > unknownBefore) {
        // Record NÀY vẫn kẹt — log để ops soi.
        this.logger.warn({
          message: JSON.stringify({ action: 'vnpReconcileCancellingStuck', recordId: String(doc._id) }),
        });
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    if (stuck.length > 0) {
      this.logger.info({
        message: JSON.stringify({ action: 'vnpReconcileCancelling', scanned: stuck.length, cancelled, revived, unknown }),
      });
    }
    return { scanned: stuck.length, cancelled, revived, unknown };
  }

  // ── Cron poll tracking (2 lần/ngày — VNP KHÔNG có webhook cho partner) ────

  private trackingCronRunning = false;

  /**
   * Poll trạng thái các shipment đang "mở" (`created`/`in_transit`, tạo trong
   * 30 ngày — quá 30 ngày coi như label chết, dừng poll). Nguồn:
   * `tracking/public/track` (VietNamLogistics, không token, KHÔNG ăn quota
   * USPS). Chỉ ghi `trackingEvents` khi status text ĐỔI; text chứa "delivered"
   * → chuyển `status='delivered'` (hết poll). Khóa in-flight chống gọi chồng.
   */
  async pollTrackingCron(): Promise<{
    checked: number;
    updated: number;
    delivered: number;
    failed: number;
    skipped?: boolean;
    reconcile?: { scanned: number; finalized: number; failed: number; unknown: number };
    reconcileCancelling?: { scanned: number; cancelled: number; revived: number; unknown: number };
  }> {
    if (this.trackingCronRunning) return { checked: 0, updated: 0, delivered: 0, failed: 0, skipped: true };
    this.trackingCronRunning = true;
    try {
      // Dọn record kẹt `purchasing` + `cancelling` TRƯỚC khi poll tracking
      // (chung khóa in-flight + chung lịch crontab — không thêm mảnh vận hành).
      const reconcile = await this.reconcilePurchasing().catch((err) => {
        this.logger.warn({
          message: JSON.stringify({ action: 'vnpReconcileCronFail', error: (err as Error).message?.slice(0, 500) }),
        });
        return { scanned: 0, finalized: 0, failed: 0, unknown: 0 };
      });
      const reconcileCancelling = await this.reconcileCancelling().catch((err) => {
        this.logger.warn({
          message: JSON.stringify({ action: 'vnpReconcileCancellingCronFail', error: (err as Error).message?.slice(0, 500) }),
        });
        return { scanned: 0, cancelled: 0, revived: 0, unknown: 0 };
      });
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const open = await this.shipmentModel
        .find({
          // CHỈ label VNP hệ thống mua — label khách tự cấp (`provider='customer'`,
          // ORD-26) mua bên ngoài, tra qua VNP vô nghĩa.
          provider: SHIPMENT_PROVIDER_VNP,
          status: { $in: ['created', 'in_transit'] },
          createdAt: { $gte: since },
          trackingCode: { $exists: true, $nin: [null, ''] },
        })
        .sort({ createdAt: 1 })
        .limit(200);
      let updated = 0;
      let delivered = 0;
      let failed = 0;
      for (const doc of open) {
        try {
          const raw = await this.client.publicTrack(doc.trackingCode as string);
          const now = new Date();
          // Trạng thái HÃNG tách khỏi trạng thái MUA (§3): patch dựng ở helper
          // thuần — gồm cả scannedAt (set 1 lần) + carrierNote cho ops.
          const patch = buildCarrierPatch(doc, raw, now);
          await this.shipmentModel.updateOne(
            { _id: doc._id },
            {
              $set: patch.set,
              ...(patch.changed ? { $push: { trackingEvents: { status: patch.statusText, at: now } } } : {}),
            },
          );
          if (patch.changed) updated += 1;
          // Sync snapshot trên orders khi text đổi HOẶC vừa ghi nhận scan đầu
          // (record cũ có thể trùng text nhưng chưa từng có scannedAt).
          if (patch.changed || patch.set.scannedAt) {
            if (doc.vnpShipmentId) {
              await this.orderModel.updateMany(
                { 'vnpShipment.shipmentId': doc.vnpShipmentId },
                {
                  $set: {
                    'vnpShipment.lastTrackingStatus': patch.statusText,
                    'vnpShipment.lastTrackingAt': now,
                    ...(patch.set.scannedAt ? { 'vnpShipment.scannedAt': now } : {}),
                  },
                },
              );
            }
          }
          if (patch.newStatus === 'delivered' && doc.status !== 'delivered') delivered += 1;
        } catch {
          failed += 1;
        }
        // Giãn nhịp giữa các call — tránh dồn tải/quota phía VNP.
        await new Promise((r) => setTimeout(r, 800));
      }
      this.logger.info({
        message: JSON.stringify({ action: 'vnpTrackingCron', checked: open.length, updated, delivered, failed }),
      });
      return { checked: open.length, updated, delivered, failed, reconcile, reconcileCancelling };
    } finally {
      this.trackingCronRunning = false;
    }
  }

  // ── Dashboard chi phí label (trang /adm/shipments) ────────────────────────

  /**
   * Cost = tổng `shippingCost` các record CHƯA HỦY (policy hoàn tiền khi hủy
   * của VNP chưa rõ — record hủy đếm riêng, không cộng cost). Bucket tháng
   * theo giờ VN.
   */
  async getShipmentStats(dto: { from?: string; to?: string }): Promise<VnpShipmentStats> {
    const match: Record<string, unknown> = {};
    if (dto.from || dto.to) {
      match.createdAt = {
        ...(dto.from ? { $gte: new Date(`${dto.from}T00:00:00+07:00`) } : {}),
        ...(dto.to ? { $lte: new Date(`${dto.to}T23:59:59.999+07:00`) } : {}),
      };
    }
    const costExpr = { $convert: { input: '$shippingCost', to: 'double', onError: 0, onNull: 0 } };
    // Chỉ tính cost/bucket cho label THẬT đã mua: loại `purchasing` (chưa chắc
    // mua xong), `failed` (không mất tiền) bên cạnh `cancelled` như trước.
    const counted = { $match: { status: { $in: [...VNP_SHIPMENT_COUNTED_STATUSES] } } };
    // Label seller tự mua = có `sellerPrice` (chỉ stamp sau khi mua thành công);
    // "tiền vào" = seller trả mình, "tiền ra" của riêng nhóm đó = chi VNP tương ứng.
    const isSellerLabel = { $and: [{ $ne: ['$status', 'cancelled'] }, { $gt: ['$sellerPrice', 0] }] };
    const [facet] = await this.shipmentModel.aggregate<{
      totals: {
        count: number;
        cost: number;
        active: number;
        delivered: number;
        cancelled: number;
        sellerRevenue: number;
        sellerCost: number;
        sellerLabelCount: number;
      }[];
      byMonth: { key: string; count: number; cost: number }[];
      byFactory: { key: string; count: number; cost: number; factoryName?: string }[];
      byService: { key: string; count: number; cost: number }[];
    }>([
      { $match: match },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                cost: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, costExpr, 0] } },
                active: { $sum: { $cond: [{ $in: ['$status', ['created', 'in_transit']] }, 1, 0] } },
                delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
                cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                sellerRevenue: { $sum: { $cond: [isSellerLabel, { $ifNull: ['$sellerPrice', 0] }, 0] } },
                sellerCost: { $sum: { $cond: [isSellerLabel, costExpr, 0] } },
                sellerLabelCount: { $sum: { $cond: [isSellerLabel, 1, 0] } },
              },
            },
            { $project: { _id: 0 } },
          ],
          byMonth: [
            counted,
            {
              $group: {
                _id: { $dateToString: { date: '$createdAt', format: '%Y-%m', timezone: '+07:00' } },
                count: { $sum: 1 },
                cost: { $sum: costExpr },
              },
            },
            { $sort: { _id: -1 } },
            { $limit: 12 },
            { $project: { _id: 0, key: '$_id', count: 1, cost: 1 } },
          ],
          byFactory: [
            counted,
            { $lookup: { from: 'shipping_packages', localField: 'packageId', foreignField: '_id', as: 'pack' } },
            { $addFields: { factoryId: { $ifNull: [{ $arrayElemAt: ['$pack.factoryId', 0] }, ''] } } },
            { $group: { _id: '$factoryId', count: { $sum: 1 }, cost: { $sum: costExpr } } },
            { $lookup: { from: 'factories', localField: '_id', foreignField: '_id', as: 'factory' } },
            {
              $project: {
                _id: 0,
                key: '$_id',
                count: 1,
                cost: 1,
                factoryName: { $arrayElemAt: ['$factory.shortName', 0] },
              },
            },
            { $sort: { cost: -1 } },
          ],
          byService: [
            counted,
            { $group: { _id: { $ifNull: ['$service', ''] }, count: { $sum: 1 }, cost: { $sum: costExpr } } },
            { $project: { _id: 0, key: '$_id', count: 1, cost: 1 } },
            { $sort: { cost: -1 } },
          ],
        },
      },
    ]);
    return {
      totals: facet?.totals?.[0] ?? {
        count: 0,
        cost: 0,
        active: 0,
        delivered: 0,
        cancelled: 0,
        sellerRevenue: 0,
        sellerCost: 0,
        sellerLabelCount: 0,
      },
      byMonth: facet?.byMonth ?? [],
      byFactory: facet?.byFactory ?? [],
      byService: facet?.byService ?? [],
    };
  }
}
