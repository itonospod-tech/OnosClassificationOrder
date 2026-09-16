import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { generateHash, validateHash } from 'core';
import { createHash, randomBytes } from 'crypto';
import { Model } from 'mongoose';
import type {
  ChangeCustomerPasswordDto,
  CreateCustomerApiKeyDto,
  CreateCustomerApiKeyResDto,
  CreateCustomerDto,
  Customer,
  CustomerAdminRow,
  CustomerApiKey,
  CustomerAssignmentConfig,
  CustomerLoginDto,
  CustomerPriorityConfig,
  CustomerRegisterDto,
  DesignerAssignmentConfig,
  GetCustomersDto,
  GetCustomersResDto,
  ImportCustomerTiersDto,
  ImportCustomerTiersResDto,
  ListCustomerApiKeysResDto,
  ResetCustomerPasswordDto,
  RevokeCustomerApiKeyResDto,
  SyncCustomersResDto,
  UpdateCustomerDto,
  UpdateCustomerMeDto,
  UpdateCustomerStatusDto,
  UpdateCustomerTierDto,
} from 'shared';
import {
  CUSTOMER_API_KEY_MAX_ACTIVE,
  CUSTOMER_API_KEY_PREFIX,
  CUSTOMER_ASSIGNMENT_CONFIG_KEY,
  CUSTOMER_PRIORITY_CONFIG_KEY,
  customerMatchKey,
  DESIGNER_ASSIGNMENT_CONFIG_KEY,
  Status,
} from 'shared';

import { diacriticInsensitiveRegex } from '@/utils';

import { OrderEntity } from '../order/order.entity';
import { SystemConfigService } from '../system-config/system-config.service';
import type { CustomerDocument } from './customer.entity';
import { CustomerEntity } from './customer.entity';

/** Không bao giờ trả `password` (hash) ra ngoài API — kể cả cho chính khách hàng đó. */
export function toSafeCustomer(doc: CustomerDocument): Customer {
  const obj = doc.toObject() as Record<string, unknown>;
  delete obj.password;
  // ORD-4 — apiKeys chứa `hash` (sha256 của key plain): lộ hash là cho phép
  // đối chiếu offline. Danh sách key có endpoint riêng đã lọc field an toàn.
  delete obj.apiKeys;
  // AUTH-1 — `passwordSource === 'system'` là tín hiệu "tài khoản này đang dùng
  // mật khẩu mặc định do mạo danh đặt". Để lọt ra API thì bất kỳ ai đọc được
  // danh sách khách đều lọc ra ngay tập tài khoản đăng nhập được. `toObject()`
  // trả MỌI path trong schema nên phải xoá tường minh, thêm field mới vào
  // CustomerEntity cũng phải cân nhắc đúng chỗ này.
  delete obj.passwordSource;
  return obj as unknown as Customer;
}

@Injectable()
export class CustomerService {
  constructor(
    @InjectModel(CustomerEntity.name) private readonly customerModel: Model<CustomerEntity>,
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  /**
   * `page` có mặt → chế độ trang quản trị: phân trang + filter + enrich
   * (orderCount/lastOrderAt/xưởng gán/designer gán). Không có `page` → hành vi
   * cũ trả toàn bộ (kanban gán xưởng/ưu tiên). Cả 2 mặc định LOẠI khách xóa
   * mềm; `deleted=true` → chỉ khách đã xóa (tab Đã xóa).
   */
  async list(dto: GetCustomersDto): Promise<GetCustomersResDto> {
    const filter: Record<string, unknown> = {
      deletedAt: dto.deleted ? { $ne: null } : null,
    };
    if (dto.search?.trim()) {
      // AUTH-4 — khớp BỎ DẤU (xem `diacriticInsensitiveRegex`); lớp ký tự là
      // tập cha của chữ gõ vào nên chuỗi có dấu vẫn ra đúng như trước.
      const rx = { $regex: diacriticInsensitiveRegex(dto.search.trim()), $options: 'i' };
      filter.$or = [{ userSku: rx }, { userEmail: rx }, { fullName: rx }, { phone: rx }];
    }
    if (dto.tier !== undefined && dto.tier !== '') {
      const tier = dto.tier === 'none' ? null : Number(dto.tier);
      if (tier === null || Number.isFinite(tier)) filter.tier = tier;
    }
    if (dto.status) filter.status = dto.status;
    if (dto.source) filter.source = dto.source;
    if (dto.hasAccount) {
      filter.password = dto.hasAccount === 'true' ? { $ne: '' } : '';
    }

    if (!dto.page) {
      const data = await this.customerModel.find(filter).select('-password').sort({ userSku: 1 }).lean().exec();
      return { success: true, data: data as unknown as Customer[], total: data.length };
    }

    const limit = dto.limit ?? 20;
    const [total, docs] = await Promise.all([
      this.customerModel.countDocuments(filter),
      this.customerModel
        .find(filter)
        .sort({ userSku: 1, userEmail: 1 })
        .skip((dto.page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    const rows = await this.enrichAdminRows(docs as unknown as (Customer & { password?: string })[]);
    return { success: true, data: rows, total };
  }

  /** Enrich row trang quản trị — chỉ tính cho đúng trang hiện tại (≤ limit khách). */
  private async enrichAdminRows(docs: (Customer & { password?: string })[]): Promise<CustomerAdminRow[]> {
    // Khách TỰ ĐĂNG KÝ ở Customer Portal có `userSku` RỖNG (form đăng ký không
    // có ô SKU) — lọc theo mình `userSku` là bỏ sót toàn bộ đơn của họ, cột
    // "Số đơn"/"Đơn gần nhất" luôn ra 0/—. Nên match thêm theo email; khóa gộp
    // vẫn là cặp (userSku, userEmail) nên đơn của khách khác trùng email không
    // lẫn sang hàng này. Giữ dạng `$in` (index-friendly) với cả nguyên văn lẫn
    // bản lowercase thay vì `$expr` `$toLower` quét cả collection.
    const skus = [...new Set(docs.map((d) => d.userSku).filter(Boolean))];
    const emails = [
      ...new Set(
        docs.flatMap((d) => {
          const e = (d.userEmail || '').trim();
          return e ? [e, e.toLowerCase()] : [];
        }),
      ),
    ];
    const matchClauses: Record<string, unknown>[] = [];
    if (skus.length) matchClauses.push({ userSku: { $in: skus } });
    if (emails.length) matchClauses.push({ userEmail: { $in: emails } });
    const orderAgg = matchClauses.length
      ? await this.orderModel.aggregate<{
          _id: { userSku: string; userEmail: string };
          count: number;
          lastAt: Date | null;
        }>([
          { $match: matchClauses.length === 1 ? matchClauses[0] : { $or: matchClauses } },
          {
            $group: {
              _id: { userSku: '$userSku', userEmail: { $toLower: { $ifNull: ['$userEmail', ''] } } },
              count: { $sum: 1 },
              lastAt: { $max: { $ifNull: ['$inProductionAt', '$createdAt'] } },
            },
          },
        ])
      : [];
    const orderByKey = new Map(
      orderAgg.map((o) => [customerMatchKey(o._id.userSku, o._id.userEmail), { count: o.count, lastAt: o.lastAt }]),
    );

    const [assignCfg, designerCfg] = await Promise.all([
      this.systemConfigService.get<CustomerAssignmentConfig>(CUSTOMER_ASSIGNMENT_CONFIG_KEY, null),
      this.systemConfigService.get<DesignerAssignmentConfig>(DESIGNER_ASSIGNMENT_CONFIG_KEY, null),
    ]);
    const factoryByCustomer = new Map<string, string>();
    for (const f of assignCfg?.factories ?? []) {
      for (const cid of f.customerIds) factoryByCustomer.set(String(cid), String(f.factoryId));
    }
    const designerByCustomer = new Map<string, string>();
    for (const alloc of designerCfg?.customers ?? []) {
      for (const cid of alloc.customerIds) designerByCustomer.set(String(cid), String(alloc.designerId));
    }

    return docs.map((d) => {
      const { password, ...safe } = d;
      const order = orderByKey.get(customerMatchKey(d.userSku, d.userEmail));
      return {
        ...(safe as Customer),
        orderCount: order?.count ?? 0,
        lastOrderAt: order?.lastAt ?? null,
        assignedFactoryId: factoryByCustomer.get(String(d._id)) ?? null,
        assignedDesignerId: designerByCustomer.get(String(d._id)) ?? null,
        hasAccount: Boolean(password),
      };
    });
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const userSku = dto.userSku.trim();
    const userEmail = (dto.userEmail || '').trim().toLowerCase();
    if (!userSku) throw new BadRequestException('User SKU không được để trống');
    const existing = await this.customerModel.findOne({ userSku, userEmail });
    if (existing?.deletedAt) {
      throw new BadRequestException('Khách hàng (SKU + email) đã bị xóa — dùng chức năng Khôi phục thay vì tạo mới');
    }
    if (existing) throw new BadRequestException('Khách hàng (SKU + email) đã tồn tại');
    // Không có password → record chưa đăng nhập được cho tới khi khách tự đăng
    // ký (claim) theo (userSku, userEmail). Có password → dùng được ngay.
    const created = await this.customerModel.create({
      userSku,
      userEmail,
      source: 'manual',
      password: dto.password ? generateHash(dto.password) : '',
      fullName: dto.fullName?.trim() || '',
      phone: dto.phone?.trim() || '',
      tier: dto.tier ?? null,
    });
    return toSafeCustomer(created);
  }

  /** Sửa thông tin khách — `userSku`/`userEmail` là khóa định danh, KHÓA HẲN không sửa. */
  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const patch: Record<string, unknown> = {};
    if (dto.fullName !== undefined) patch.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) patch.phone = dto.phone.trim();
    if (dto.tier !== undefined) patch.tier = dto.tier;
    if (Object.keys(patch).length === 0) throw new BadRequestException('Không có thay đổi nào');

    const updated = await this.customerModel
      .findOneAndUpdate({ _id: id, deletedAt: null }, { $set: patch }, { new: true })
      .select('-password')
      .lean();
    if (!updated) throw new NotFoundException('Không tìm thấy khách hàng');
    return updated as unknown as Customer;
  }

  /**
   * Reset mật khẩu — 2 chế độ: có `dto.password` → Admin tự đặt; không có →
   * generate random, trả plain ĐÚNG 1 LẦN (không lưu, không log).
   */
  async resetPassword(id: string, dto: ResetCustomerPasswordDto): Promise<{ generatedPassword?: string }> {
    const generated = dto.password ? undefined : randomBytes(9).toString('base64url').slice(0, 12);
    const updated = await this.customerModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { password: generateHash(dto.password ?? generated!) } },
    );
    if (!updated) throw new NotFoundException('Không tìm thấy khách hàng');
    return { generatedPassword: generated };
  }

  async updateStatus(id: string, dto: UpdateCustomerStatusDto): Promise<Customer> {
    const updated = await this.customerModel
      .findOneAndUpdate({ _id: id, deletedAt: null }, { $set: { status: dto.status } }, { new: true })
      .select('-password')
      .lean();
    if (!updated) throw new NotFoundException('Không tìm thấy khách hàng');
    return updated as unknown as Customer;
  }

  /**
   * Xóa mềm — set `deletedAt` + tự gỡ customerId khỏi 3 config blob (gán xưởng /
   * ưu tiên đơn / auto-gán designer). Trả danh sách config key đã gỡ để FE báo.
   * Đơn hàng lịch sử GIỮ NGUYÊN (orders khớp qua cặp key, không FK).
   */
  async softDelete(id: string): Promise<{ removedFromConfigs: string[] }> {
    const deleted = await this.customerModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
    );
    if (!deleted) throw new NotFoundException('Không tìm thấy khách hàng');

    const cid = String(id);
    const removedFromConfigs: string[] = [];

    const assignCfg = await this.systemConfigService.get<CustomerAssignmentConfig>(
      CUSTOMER_ASSIGNMENT_CONFIG_KEY,
      null,
    );
    if (assignCfg?.factories.some((f) => f.customerIds.some((c) => String(c) === cid))) {
      assignCfg.factories = assignCfg.factories
        .map((f) => ({ ...f, customerIds: f.customerIds.filter((c) => String(c) !== cid) }))
        .filter((f) => f.customerIds.length > 0);
      await this.systemConfigService.set(CUSTOMER_ASSIGNMENT_CONFIG_KEY, assignCfg);
      removedFromConfigs.push(CUSTOMER_ASSIGNMENT_CONFIG_KEY);
    }

    const priorityCfg = await this.systemConfigService.get<CustomerPriorityConfig>(CUSTOMER_PRIORITY_CONFIG_KEY, null);
    if (priorityCfg?.levels.some((l) => l.customerIds.some((c) => String(c) === cid))) {
      priorityCfg.levels = priorityCfg.levels
        .map((l) => ({ ...l, customerIds: l.customerIds.filter((c) => String(c) !== cid) }))
        .filter((l) => l.customerIds.length > 0);
      await this.systemConfigService.set(CUSTOMER_PRIORITY_CONFIG_KEY, priorityCfg);
      removedFromConfigs.push(CUSTOMER_PRIORITY_CONFIG_KEY);
    }

    const designerCfg = await this.systemConfigService.get<DesignerAssignmentConfig>(
      DESIGNER_ASSIGNMENT_CONFIG_KEY,
      null,
    );
    if (designerCfg?.customers?.some((a) => a.customerIds.some((c) => String(c) === cid))) {
      designerCfg.customers = designerCfg.customers
        .map((a) => ({ ...a, customerIds: a.customerIds.filter((c) => String(c) !== cid) }))
        .filter((a) => a.customerIds.length > 0);
      await this.systemConfigService.set(DESIGNER_ASSIGNMENT_CONFIG_KEY, designerCfg);
      removedFromConfigs.push(DESIGNER_ASSIGNMENT_CONFIG_KEY);
    }

    return { removedFromConfigs };
  }

  /** Khôi phục khách xóa mềm. Config gán xưởng/designer KHÔNG tự gán lại — Admin kéo lại ở kanban. */
  async restore(id: string): Promise<Customer> {
    const restored = await this.customerModel
      .findOneAndUpdate({ _id: id, deletedAt: { $ne: null } }, { $unset: { deletedAt: 1 } }, { new: true })
      .select('-password')
      .lean();
    if (!restored) throw new NotFoundException('Không tìm thấy khách hàng đã xóa');
    return restored as unknown as Customer;
  }

  /**
   * Quét toàn bộ `orders`, gom **distinct cặp (userSku, userEmail)** rồi upsert
   * vào `customers`. Chỉ thêm mới — KHÔNG xóa khách cũ / khách nhập tay.
   */
  async sync(): Promise<SyncCustomersResDto> {
    const pairs = await this.orderModel.aggregate<{ _id: { userSku: string; userEmail: string } }>([
      { $match: { userSku: { $nin: [null, ''] } } },
      {
        $group: {
          _id: {
            userSku: '$userSku',
            userEmail: { $toLower: { $ifNull: ['$userEmail', ''] } },
          },
        },
      },
    ]);

    // Nhận lại "chỗ giữ sẵn" tạo từ nhóm Zalo trước khi upsert.
    //
    // Khách tạo ở màn nối nhóm chưa biết email nên mang `userEmail: ''`. Đơn về
    // sau lại mang email thật, mà unique index là cặp (userSku, userEmail) —
    // upsert thẳng sẽ đẻ ra bản ghi THỨ HAI cho cùng một seller, và từ đó mọi
    // báo cáo theo khách đếm đôi. Nên điền email vào bản ghi trống trước, đúng
    // khuôn "claim" mà khách tự đăng ký đang dùng.
    const coEmail = pairs.filter((p) => (p._id.userEmail || '').trim());
    if (coEmail.length > 0) {
      const skus = [...new Set(coEmail.map((p) => p._id.userSku))];
      const choTrong = await this.customerModel.find({ userSku: { $in: skus }, userEmail: '' }).select('userSku').lean();
      const dangCho = new Set(choTrong.map((c) => String((c as { userSku?: string }).userSku)));
      if (dangCho.size > 0) {
        // Mỗi mã chỉ nhận MỘT email — mã có nhiều email thì để phần upsert bên
        // dưới tạo các bản ghi còn lại như trước, không đoán cái nào là chính.
        const nhan = new Map<string, string>();
        for (const p of coEmail) {
          if (dangCho.has(p._id.userSku) && !nhan.has(p._id.userSku)) nhan.set(p._id.userSku, p._id.userEmail);
        }
        if (nhan.size > 0) {
          await this.customerModel.bulkWrite(
            [...nhan].map(([userSku, userEmail]) => ({
              updateOne: { filter: { userSku, userEmail: '' }, update: { $set: { userEmail } } },
            })),
            { ordered: false },
          );
        }
      }
    }

    let created = 0;
    if (pairs.length > 0) {
      const res = await this.customerModel.bulkWrite(
        pairs.map((p) => ({
          updateOne: {
            filter: { userSku: p._id.userSku, userEmail: p._id.userEmail || '' },
            update: {
              $setOnInsert: {
                userSku: p._id.userSku,
                userEmail: p._id.userEmail || '',
                source: 'sync',
                // Record mới tạo qua sync KHÔNG có mật khẩu — chỉ là "chỗ giữ
                // sẵn" cho khách, chưa đăng nhập được cho tới khi tự đăng ký.
                password: '',
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      created = res.upsertedCount ?? 0;
    }

    const total = await this.customerModel.countDocuments({ deletedAt: null });
    return {
      success: true,
      data: { scanned: pairs.length, created, existing: pairs.length - created, total },
    };
  }

  async updateTier(id: string, dto: UpdateCustomerTierDto): Promise<Customer> {
    const updated = await this.customerModel
      .findOneAndUpdate({ _id: id, deletedAt: null }, { $set: { tier: dto.tier } }, { new: true })
      .select('-password')
      .lean();
    if (!updated) throw new NotFoundException('Không tìm thấy khách hàng');
    return updated as unknown as Customer;
  }

  /**
   * Import tier hàng loạt từ file `TÊN TÀI KHOẢN | VIP n`. Khớp theo **userSku**
   * không phân biệt hoa/thường; 1 SKU trùng nhiều dòng khách (nhiều email) →
   * gán tier cho TẤT CẢ. SKU không có trong `customers` → bỏ qua (`skippedSkus`),
   * KHÔNG tự tạo khách mới. Trùng SKU trong file → dòng sau thắng.
   */
  async importTiers(dto: ImportCustomerTiersDto): Promise<ImportCustomerTiersResDto> {
    const wanted = new Map<string, { sku: string; tier: number }>();
    for (const r of dto.rows) {
      const sku = r.userSku.trim();
      if (sku) wanted.set(sku.toLowerCase(), { sku, tier: r.tier });
    }
    if (!wanted.size) throw new BadRequestException('File không có dòng hợp lệ');

    // Map lower(userSku) → các giá trị userSku thật trong DB (match không phân biệt hoa/thường).
    const existing = await this.customerModel.find({ deletedAt: null }, { userSku: 1 }).lean();
    const skusByLower = new Map<string, Set<string>>();
    for (const c of existing) {
      const raw = String((c as unknown as { userSku: string }).userSku);
      const key = raw.trim().toLowerCase();
      if (!skusByLower.has(key)) skusByLower.set(key, new Set());
      skusByLower.get(key)!.add(raw);
    }

    const skippedSkus: string[] = [];
    const ops: { updateMany: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];
    let matchedSkus = 0;
    for (const { sku, tier } of wanted.values()) {
      const actual = skusByLower.get(sku.toLowerCase());
      if (!actual?.size) {
        skippedSkus.push(sku);
        continue;
      }
      matchedSkus += 1;
      ops.push({
        updateMany: {
          filter: { userSku: { $in: Array.from(actual) } },
          update: { $set: { tier } },
        },
      });
    }

    let updatedCustomers = 0;
    if (ops.length) {
      const res = await this.customerModel.bulkWrite(ops, { ordered: false });
      updatedCustomers = res.modifiedCount ?? 0;
    }
    return { success: true, data: { matchedSkus, updatedCustomers, skippedSkus } };
  }
  /**
   * Đăng ký Customer Portal. Nếu đã có record (sync/thêm tay) khớp đúng
   * (userSku, userEmail) và CHƯA đăng ký → "nhận" (claim) lại record đó thay vì
   * tạo trùng. Nếu record đã có password của CHÍNH KHÁCH → từ chối đăng ký lại.
   *
   * AUTH-1 AC-14/BR-15 — "chưa đăng ký" KHÔNG còn đồng nghĩa với `password=''`:
   * mạo danh (BR-8) đặt mật khẩu mặc định cho tài khoản chưa có, và trước đây
   * chính điều đó khoá chính chủ khỏi luồng này vĩnh viễn (103/105 khách có
   * password rỗng nên gần như toàn bộ tệp khách dính). Nay phân biệt bằng
   * `passwordSource`:
   *   'system'            → mật khẩu do hệ thống đặt, VẪN cho chính chủ claim đè
   *   'self' / thiếu field → khách tự đặt, từ chối như cũ
   *
   * TUYỆT ĐỐI KHÔNG nhận biết bằng cách so giá trị mật khẩu với chuỗi mặc định:
   * khách hoàn toàn có thể TỰ CHỌN đúng chuỗi đó, và khi ấy tài khoản của họ sẽ
   * bị coi là chưa claim → người khác đăng ký đè lên được. Vá một lỗ hổng bằng
   * cách mở một lỗ hổng nặng hơn.
   */
  async register(dto: CustomerRegisterDto): Promise<Customer> {
    const userEmail = dto.userEmail.trim().toLowerCase();
    const userSku = (dto.userSku || '').trim();
    const passwordHash = generateHash(dto.password);

    const existing = await this.customerModel.findOne({ userSku, userEmail });
    if (existing) {
      // Khách xóa mềm không cho đăng ký lại (sync không hồi sinh — xem Customers.md).
      if (existing.deletedAt) {
        throw new ConflictException('Tài khoản này không khả dụng, vui lòng liên hệ hỗ trợ');
      }
      const claimable = !existing.password || existing.passwordSource === 'system';
      if (!claimable) {
        throw new ConflictException('Email này đã được đăng ký');
      }
      const claimed = await this.customerModel.findOneAndUpdate(
        { _id: existing._id },
        {
          password: passwordHash,
          // Đánh dấu 'self' là BẮT BUỘC: thiếu bước này thì tài khoản ở trạng
          // thái claim-được vĩnh viễn, ai cũng đăng ký đè lên được.
          passwordSource: 'self',
          fullName: dto.fullName?.trim() || existing.fullName,
          phone: dto.phone?.trim() || existing.phone,
          status: Status.Active,
        },
        { new: true },
      );
      return toSafeCustomer(claimed!);
    }

    const created = await this.customerModel.create({
      userSku,
      userEmail,
      source: 'register',
      password: passwordHash,
      passwordSource: 'self',
      fullName: dto.fullName?.trim() || '',
      phone: dto.phone?.trim() || '',
      status: Status.Active,
    });
    return toSafeCustomer(created);
  }

  /** Xác thực đăng nhập Customer Portal — khớp email (case-insensitive) + password đã set. */
  async validateLogin(dto: CustomerLoginDto): Promise<CustomerDocument> {
    const userEmail = dto.userEmail.trim().toLowerCase();
    const candidates = await this.customerModel.find({ userEmail, password: { $ne: '' }, deletedAt: null });

    for (const candidate of candidates) {
      if (await validateHash(dto.password, candidate.password)) {
        if (candidate.status === Status.Inactive) {
          throw new UnauthorizedException('Tài khoản đã bị khoá, vui lòng liên hệ hỗ trợ');
        }
        return candidate;
      }
    }

    throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
  }

  async getById(id: string): Promise<CustomerDocument | null> {
    return this.customerModel.findById(id);
  }

  /** Khách tự sửa hồ sơ (trang "Tài khoản của tôi" — Customer Portal). */
  async updateMe(id: string, dto: UpdateCustomerMeDto): Promise<Customer> {
    const patch: Record<string, unknown> = {};
    if (dto.fullName !== undefined) patch.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) patch.phone = dto.phone.trim();
    if (Object.keys(patch).length === 0) throw new BadRequestException('Không có thay đổi nào');

    const updated = await this.customerModel
      .findOneAndUpdate({ _id: id, deletedAt: null }, { $set: patch }, { new: true })
      .select('-password')
      .lean();
    if (!updated) throw new NotFoundException('Không tìm thấy tài khoản');
    return updated as unknown as Customer;
  }

  /** Khách tự đổi mật khẩu — bắt buộc nhập đúng mật khẩu hiện tại. */
  async changePassword(id: string, dto: ChangeCustomerPasswordDto): Promise<void> {
    const customer = await this.customerModel.findOne({ _id: id, deletedAt: null });
    if (!customer?.password) throw new NotFoundException('Không tìm thấy tài khoản');
    if (!(await validateHash(dto.currentPassword, customer.password))) {
      throw new BadRequestException('Mật khẩu hiện tại không chính xác');
    }
    await this.customerModel.updateOne({ _id: id }, { $set: { password: generateHash(dto.newPassword) } });
  }

  // ─── API keys — Public Order API (ORD-4, plan §7) ─────────────────────────

  private toSafeApiKey(k: NonNullable<CustomerEntity['apiKeys']>[number]): CustomerApiKey {
    return {
      _id: String(k._id),
      label: k.label,
      prefix: k.prefix,
      createdAt: k.createdAt ?? undefined,
      lastUsedAt: k.lastUsedAt ?? undefined,
      revokedAt: k.revokedAt ?? undefined,
    };
  }

  /** Tạo key mới — key plain `onos_live_<32hex>` trả đúng MỘT lần, DB chỉ giữ sha256. */
  async createApiKey(customerId: string, dto: CreateCustomerApiKeyDto): Promise<CreateCustomerApiKeyResDto> {
    const customer = await this.customerModel.findOne({ _id: customerId, deletedAt: null });
    if (!customer) throw new NotFoundException('Không tìm thấy tài khoản');
    const active = (customer.apiKeys ?? []).filter((k) => !k.revokedAt);
    if (active.length >= CUSTOMER_API_KEY_MAX_ACTIVE) {
      throw new BadRequestException(
        `Tối đa ${CUSTOMER_API_KEY_MAX_ACTIVE} API key hoạt động — thu hồi bớt key cũ trước.`,
      );
    }

    const plain = `${CUSTOMER_API_KEY_PREFIX}${randomBytes(16).toString('hex')}`;
    const entry = {
      label: dto.label.trim(),
      // prefix hiển thị: "onos_live_ab12…" — đủ nhận diện, không đủ đoán key.
      prefix: `${plain.slice(0, CUSTOMER_API_KEY_PREFIX.length + 4)}…`,
      hash: createHash('sha256').update(plain).digest('hex'),
      createdAt: new Date(),
    };
    const updated = await this.customerModel.findOneAndUpdate(
      { _id: customerId },
      { $push: { apiKeys: entry } },
      { new: true },
    );
    const saved = (updated?.apiKeys ?? []).find((k) => k.hash === entry.hash);
    if (!saved) throw new BadRequestException('Tạo key thất bại');
    return { success: true, data: { key: plain, apiKey: this.toSafeApiKey(saved) } };
  }

  /** Danh sách key HOẠT ĐỘNG của khách — không bao giờ trả hash/key plain. */
  async listApiKeys(customerId: string): Promise<ListCustomerApiKeysResDto> {
    const customer = await this.customerModel.findOne({ _id: customerId, deletedAt: null }).lean();
    if (!customer) throw new NotFoundException('Không tìm thấy tài khoản');
    const data = (customer.apiKeys ?? []).filter((k) => !k.revokedAt).map((k) => this.toSafeApiKey(k));
    return { success: true, data };
  }

  /** Thu hồi key (set revokedAt — giữ record đối chiếu). Key thu hồi vô hiệu NGAY. */
  async revokeApiKey(customerId: string, keyId: string): Promise<RevokeCustomerApiKeyResDto> {
    const res = await this.customerModel.updateOne(
      { _id: customerId, 'apiKeys._id': keyId, 'apiKeys.revokedAt': null },
      { $set: { 'apiKeys.$.revokedAt': new Date() } },
    );
    if (res.matchedCount === 0) throw new NotFoundException('Không tìm thấy key');
    return { success: true, data: { revoked: true } };
  }

  /**
   * Tra khách theo hash API key — dùng bởi `ApiKeyGuard`. Chỉ nhận key CHƯA thu
   * hồi của khách CHƯA xóa mềm + đang Active; sai/thu hồi/khóa → null (guard trả
   * 401 chung chung, không tiết lộ key/khách nào tồn tại).
   */
  async findByApiKeyHash(hash: string): Promise<CustomerDocument | null> {
    return this.customerModel.findOne({
      deletedAt: null,
      status: Status.Active,
      apiKeys: { $elemMatch: { hash, revokedAt: null } },
    });
  }

  /** Cập nhật lastUsedAt của key — fire-and-forget từ guard, không chặn request. */
  async touchApiKeyUsage(customerId: string, hash: string): Promise<void> {
    await this.customerModel
      .updateOne({ _id: customerId, 'apiKeys.hash': hash }, { $set: { 'apiKeys.$.lastUsedAt': new Date() } })
      .catch(() => undefined);
  }
}
