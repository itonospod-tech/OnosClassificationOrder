import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  GetZaloGroupLinksDto,
  SyncZaloGroupsDto,
  UpdateZaloGroupLinkDto,
  ZaloGroupSuggestion,
} from 'shared';
import { ZALO_GROUP_ANALYZABLE_KINDS, ZaloGroupKind } from 'shared';

import { CustomerEntity } from '../customer/customer.entity';
import { ZaloGroupRepository } from './zalo-group.repository';
import type { ZaloGroupLinkDocument } from './zalo-group-link.entity';
import { ZaloGroupLinkEntity } from './zalo-group-link.entity';
import { ZaloGroupSummaryEntity } from './zalo-group-summary.entity';
import { khopTenNhom } from './zalo-title.logic';

/** Điểm cắt của gợi ý — dưới ngưỡng này thì đoán bừa hại hơn là không đoán. */
const SUGGESTION_MIN_SCORE = 0.5;
/** Trần số gợi ý trả về một lượt: đây là danh sách để người DUYỆT, không phải để cuộn. */
const SUGGESTION_LIMIT = 200;

@Injectable()
export class ZaloGroupService {
  constructor(
    private readonly zaloGroupRepository: ZaloGroupRepository,
    @InjectModel(ZaloGroupLinkEntity.name) private readonly zaloGroupLinkModel: Model<ZaloGroupLinkEntity>,
    @InjectModel(CustomerEntity.name) private readonly customerModel: Model<CustomerEntity>,
    @InjectModel(ZaloGroupSummaryEntity.name)
    private readonly summaryModel: Model<ZaloGroupSummaryEntity>,
  ) {}

  /**
   * Nạp nhóm từ engine Zalo (`onosceo`) vào OnosFactory.
   *
   * Người gọi đã gộp dòng hội thoại theo `groupGlobalId` trước khi gửi sang —
   * xem `ZaloGroupSnapshot`. Ở đây chỉ upsert theo khoá đó.
   *
   * Đồng bộ KHÔNG bao giờ đụng tới `kind`/`customerId`/`ownerUserId`: đó là
   * công người vận hành bỏ ra, chạy lại đồng bộ mà xoá mất thì không ai dám
   * chạy lần hai. Chỉ ghi đè phần đọc từ Zalo (tiêu đề, nick, mốc tin).
   */
  async syncGroups(dto: SyncZaloGroupsDto): Promise<{ created: number; updated: number; rawConversations: number }> {
    let created = 0;
    let updated = 0;
    let rawConversations = 0;

    for (const g of dto.groups) {
      rawConversations += g.conversationIds?.length ?? 0;

      const res = await this.zaloGroupLinkModel.updateOne(
        { groupGlobalId: g.groupGlobalId },
        {
          $set: {
            title: g.title,
            conversationIds: g.conversationIds ?? [],
            memberNicks: g.memberNicks ?? [],
            ...(g.lastMessageAt ? { lastMessageAt: g.lastMessageAt } : {}),
            syncedAt: new Date(),
          },
          // Chỉ đặt lúc TẠO MỚI. Nhóm đã được xét rồi thì lần đồng bộ sau không
          // được kéo ngược về 'chưa xét'.
          $setOnInsert: { kind: ZaloGroupKind.Unreviewed },
        },
        { upsert: true },
      );

      if (res.upsertedCount > 0) created += 1;
      else if (res.matchedCount > 0) updated += 1;
    }

    return { created, updated, rawConversations };
  }

  async getGroups(dto: GetZaloGroupLinksDto): Promise<{ data: ZaloGroupLinkDocument[]; total: number }> {
    const filter: Record<string, unknown> = {};

    if (dto.kind) filter.kind = dto.kind;
    if (dto.customerId) filter.customerId = dto.customerId;
    if (typeof dto.unlinked === 'boolean') {
      filter.customerId = dto.unlinked ? { $in: [null, ''] } : { $nin: [null, ''] };
    }
    if (dto.search?.trim()) {
      filter.title = { $regex: escapeRegex(dto.search.trim()), $options: 'i' };
    }

    const { page, limit, sort, order } = dto;

    const { data, total } = await this.zaloGroupRepository.findAllAndCount<ZaloGroupLinkDocument>(filter, {
      paging: { skip: limit * (page - 1), limit },
      // Mặc định xếp nhóm có tin mới nhất lên đầu — đó là nhóm đang chạy, cần
      // gắn trước; nhóm chết nằm cuối cũng không ai vội.
      sort: { [sort || 'lastMessageAt']: order === 'asc' ? 1 : -1 },
    });

    // Đính tóm tắt vào từng dòng: một truy vấn cho cả trang, không phải mỗi
    // dòng một lượt. Người vận hành nhìn bảng nhóm là thấy ngay nhóm nào đang
    // có việc, khỏi phải nhớ sang màn hình khác tra.
    const ids = data.map((d) => String((d as unknown as { groupGlobalId: string }).groupGlobalId));
    const summaries = await this.summaryModel
      .find({ groupGlobalId: { $in: ids } })
      .select('groupGlobalId tieuDe mucDo checklist tomTatLuc denMocTin')
      .lean();
    const byGroup = new Map(summaries.map((s) => [String(s.groupGlobalId), s]));

    const rows = data.map((d) => {
      const doc = d as unknown as { groupGlobalId: string; toObject?: () => unknown };
      const s = byGroup.get(String(doc.groupGlobalId));
      const plain = typeof doc.toObject === 'function' ? doc.toObject() : d;
      const lastMessageAt = (plain as { lastMessageAt?: Date }).lastMessageAt;

      return {
        ...(plain as Record<string, unknown>),
        ...(s
          ? {
              tomTat: {
                tieuDe: s.tieuDe,
                mucDo: s.mucDo,
                viecConLai: (s.checklist ?? []).filter((c) => !c.xong).length,
                tomTatLuc: s.tomTatLuc,
                denMocTin: s.denMocTin,
                // Có tin sau mốc đã tóm tắt — người đọc biết bản này "biết tới đâu".
                coTinMoi: !!lastMessageAt && (!s.denMocTin || lastMessageAt > s.denMocTin),
              },
            }
          : {}),
      };
    });

    return { data: rows as unknown as ZaloGroupLinkDocument[], total };
  }

  /**
   * Gắn / gỡ / đổi phân loại một nhóm.
   *
   * Ràng buộc nghiệp vụ đặt ở đây chứ không ở DTO vì nó liên quan hai trường:
   * `kind='seller'` mà không có khách thì bản ghi vô nghĩa — nhóm nằm trong
   * diện phân tích doanh thu nhưng không quy được về ai.
   */
  async updateLink(id: string, dto: UpdateZaloGroupLinkDto, userId: string): Promise<ZaloGroupLinkDocument> {
    const before = await this.zaloGroupRepository.findOneById<ZaloGroupLinkDocument>(id);
    if (!before) throw new NotFoundException('Không tìm thấy nhóm Zalo.');

    const nextKind = dto.kind ?? before.kind;
    // `newCustomerSku` cũng dẫn tới có khách — nếu không tính vào đây thì thao
    // tác thường gặp nhất của ops (đặt "nhóm khách" + tạo khách mới trong CÙNG
    // một lần bấm) bị chính chốt này từ chối.
    const nextCustomerId = dto.newCustomerSku ? 'se-tao-moi' : dto.customerId === undefined ? before.customerId : dto.customerId;

    if (nextKind === ZaloGroupKind.Seller && !nextCustomerId) {
      throw new BadRequestException("Nhóm khách phải gắn với một khách hàng — chọn khách hoặc đổi sang phân loại khác.");
    }
    if (nextKind !== ZaloGroupKind.Seller && nextCustomerId) {
      throw new BadRequestException('Chỉ nhóm khách mới gắn được khách hàng — gỡ khách trước khi đổi phân loại.');
    }

    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};

    if (dto.kind !== undefined) set.kind = dto.kind;
    if (dto.note !== undefined) {
      if (dto.note === null) unset.note = '';
      else set.note = dto.note;
    }
    if (dto.ownerUserId !== undefined) {
      if (dto.ownerUserId === null) unset.ownerUserId = '';
      else set.ownerUserId = dto.ownerUserId;
    }

    // Tạo khách ngay tại màn nối nhóm.
    //
    // Vì sao cần: `customers` sinh ra TỪ đơn hàng, nên seller có nhóm Zalo mà
    // chưa từng đặt đơn thì không tồn tại như một khách — 19/52 nhóm chưa xét
    // trên prod rơi vào diện này (đo 11/09/2026). Không có đường tạo tại đây
    // thì người vận hành phải sang trang khác tạo tay rồi quay lại, và thực tế
    // là họ bỏ luôn, nên nhóm nằm đó mãi.
    //
    // Mã đã có thì GHÉP vào khách đó chứ không tạo trùng — `userSku` là khoá
    // người ta nhìn, tạo trùng là hỏng mọi báo cáo nối nhóm ↔ đơn.
    if (dto.newCustomerSku) {
      if (dto.customerId) throw new BadRequestException('Chỉ được chọn khách sẵn có HOẶC tạo khách mới, không cả hai.');
      const sku = dto.newCustomerSku.trim().toUpperCase();
      const existing = await this.customerModel.findOne({ userSku: sku }).select('_id').lean();
      const customerId = existing
        ? String((existing as { _id: unknown })._id)
        : String(
            (
              await this.customerModel.create({
                userSku: sku,
                // Khách tạo từ nhóm Zalo chưa có email; để trống thay vì bịa,
                // và `customerMatchKey` vẫn khớp đơn qua `userSku`.
                userEmail: '',
                source: 'zalo-group',
              })
            )._id,
          );
      set.customerId = customerId;
      set.userSku = sku;
      set.linkedAt = new Date();
      set.linkedByUserId = userId;
    } else if (dto.customerId !== undefined) {
      if (dto.customerId === null) {
        unset.customerId = '';
        unset.userSku = '';
        unset.linkedAt = '';
        unset.linkedByUserId = '';
      } else {
        const customer = await this.customerModel.findById(dto.customerId).select('userSku').lean();
        if (!customer) throw new NotFoundException('Không tìm thấy khách hàng.');
        set.customerId = dto.customerId;
        // Chụp `userSku` ngay lúc gắn — báo cáo nối nhóm ↔ đơn đi qua trường này.
        set.userSku = (customer as { userSku?: string }).userSku ?? '';
        set.linkedAt = new Date();
        set.linkedByUserId = userId;
      }
    }

    const updated = await this.zaloGroupLinkModel.findOneAndUpdate(
      { _id: id },
      {
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Không tìm thấy nhóm Zalo.');

    // Nhóm vừa RỜI diện được phân tích (chuyển sang nội bộ/riêng tư) → xoá bản
    // tóm tắt cũ. Đánh dấu một nhóm là riêng tư mà nội dung đã rút ra vẫn nằm
    // trên màn hình thì cái nhãn đó vô nghĩa — người vận hành tưởng đã che,
    // thực tế vẫn phơi. Chốt ở tầng dữ liệu, không phải chỉ lọc lúc hiển thị.
    const daRoiDienPhanTich =
      ZALO_GROUP_ANALYZABLE_KINDS.includes(before.kind) && !ZALO_GROUP_ANALYZABLE_KINDS.includes(nextKind);
    if (daRoiDienPhanTich) {
      await this.summaryModel.deleteOne({ groupGlobalId: updated.groupGlobalId });
    }

    return updated;
  }

  /**
   * Đoán nhóm nào thuộc khách nào bằng cách soi TÊN NHÓM.
   *
   * Cố ý chỉ đoán, không tự gắn. Tên nhóm Zalo do người đặt tay nên đủ kiểu
   * ("OnosPod/ 2026/ GIANG/ KL/ TOPUP", "BOD - Lenful/VIP"); gắn tự động là
   * sớm muộn cũng quy nhầm doanh thu sang khách khác, mà sai kiểu đó rất khó
   * phát hiện. Người duyệt nhanh hơn nhiều so với người đi dò 147 nhóm.
   */
  async getSuggestions(): Promise<ZaloGroupSuggestion[]> {
    const [groups, customers] = await Promise.all([
      this.zaloGroupLinkModel
        .find({ kind: ZaloGroupKind.Unreviewed, customerId: { $in: [null, ''] } })
        .select('groupGlobalId title')
        .lean(),
      this.customerModel.find({ userSku: { $nin: [null, ''] } }).select('userSku fullName').lean(),
    ]);

    const bySku = new Map<string, { id: string; name: string }>();
    for (const c of customers) {
      const sku = String((c as { userSku?: string }).userSku ?? '').trim();
      if (sku) bySku.set(sku.toUpperCase(), { id: String((c as { _id: unknown })._id), name: String((c as { fullName?: string }).fullName ?? '').trim() });
    }
    const skus = new Set(bySku.keys());

    const out: ZaloGroupSuggestion[] = [];
    for (const g of groups) {
      const title = String((g as { title?: string }).title ?? '');
      if (!title.trim()) continue;
      const groupGlobalId = String((g as { groupGlobalId: string }).groupGlobalId);
      const { matched, unknownSku } = khopTenNhom(title, skus);

      if (matched) {
        const c = bySku.get(matched.sku);
        if (!c) continue;
        out.push({
          groupGlobalId,
          title,
          action: 'link',
          customerId: c.id,
          userSku: matched.sku,
          customerName: c.name || undefined,
          score: matched.score,
          reason: matched.reason,
        });
      } else if (unknownSku) {
        // Seller có thật nhưng chưa từng đặt đơn nên chưa có bản ghi khách.
        // Trước đây những nhóm này rơi ra khỏi danh sách gợi ý mà không ai biết.
        out.push({
          groupGlobalId,
          title,
          action: 'create',
          userSku: unknownSku,
          score: 0.8,
          reason: `Tên nhóm mang mã "${unknownSku}" nhưng chưa có khách nào — duyệt là tạo khách rồi ghép`,
        });
      }
    }

    return out.sort((a, b) => b.score - a.score).slice(0, SUGGESTION_LIMIT);
  }

  /** Bảng phủ sóng: còn bao nhiêu nhóm chưa xét, bao nhiêu khách chưa có nhóm. */
  async getCoverage(): Promise<{
    totalGroups: number;
    byKind: Record<string, number>;
    linkedGroups: number;
    customersWithGroup: number;
    customersWithoutGroup: number;
    totalCustomers: number;
  }> {
    const [byKindRaw, totalGroups, linkedGroups, linkedCustomerIds, totalCustomers] = await Promise.all([
      this.zaloGroupLinkModel.aggregate<{ _id: string; n: number }>([
        { $match: { deletedAt: { $exists: false } } },
        { $group: { _id: '$kind', n: { $sum: 1 } } },
      ]),
      this.zaloGroupLinkModel.countDocuments({ deletedAt: { $exists: false } }),
      this.zaloGroupLinkModel.countDocuments({ kind: ZaloGroupKind.Seller, customerId: { $nin: [null, ''] } }),
      this.zaloGroupLinkModel.distinct('customerId', { customerId: { $nin: [null, ''] } }),
      this.customerModel.countDocuments({ deletedAt: { $exists: false } }),
    ]);

    const byKind: Record<string, number> = {};
    for (const row of byKindRaw) byKind[row._id] = row.n;

    const customersWithGroup = linkedCustomerIds.length;

    return {
      totalGroups,
      byKind,
      linkedGroups,
      customersWithGroup,
      customersWithoutGroup: Math.max(0, totalCustomers - customersWithGroup),
      totalCustomers,
    };
  }
}

/** Bỏ dấu + thường hoá để so tên nhóm với mã/tên khách. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
