import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { AgentZaloMessage } from 'shared';
import { AGENT_ZALO_INBOUND_CONFIG_KEY } from 'shared';

import { SystemConfigService } from '../system-config/system-config.service';
import { type TinThoEngine, ZaloEngineService } from '../zalo-engine/zalo-engine.service';
import { nhomDuocNghe, suyVai } from './agent-zalo-inbound.logic';
import { kiemNguoiNhanDm, LY_DO_CHAN } from './agent-zalo-send.logic';

const HAN_GIAY = 15;

/** Hình dạng blob `system_configs` — khai ở đây vì chỉ hai service này đọc nó. */
export interface CauHinhNgheZalo {
  /**
   * TẬP uid của Chủ tịch — điều kiện kích hoạt (a). Nhiều uid vì uid Zalo phụ
   * thuộc nick đang nhìn (xem `agent-zalo-inbound.logic.ts`). Đây là đường ghi
   * đè bằng tay, dùng chung với `zalo_identities.kind='chairman'`.
   */
  chairmanZaloUids?: string[];
  /**
   * TẬP uid của các nick TRỢ LÝ AI, nhìn từ phía người khác — điều kiện (b).
   *
   * Cùng lý do nhiều uid như trên. Không suy ra được từ `zalo_accounts`: uid ở
   * bảng đó là uid nick tự nhìn mình, còn `mentions[].uid` là uid người khác
   * thấy — hai không gian khác nhau.
   */
  agentNickZaloUids?: string[];
  /** Bên nhận webhook đã lọc. Nhiều bên vì có thể có agent điều phối lẫn agent nghiệp vụ. */
  subscribers?: Array<{ url: string; secret?: string; enabled?: boolean; description?: string }>;
  /** Bí mật mình đã đăng ký với engine, dùng để xác thực chiều engine → mình. */
  engineWebhookSecret?: string;
}

export interface NhomDaTra {
  groupGlobalId: string;
  kind?: string;
  title?: string;
  conversationIds?: string[];
}

/**
 * ĐỌC tin Zalo cho agent.
 *
 * Engine đã có sẵn đường đọc (`GET /conversations/:id/messages`) — lớp này không
 * dựng lại cái đó, nó thêm ba thứ engine không biết:
 *
 * 1. **Chốt nhóm.** Engine không có khái niệm `kind`; chặn nhóm khách phải ở đây.
 * 2. **Ghép nhóm → nhiều hội thoại.** Một nhóm có nhiều nick công ty, mỗi nick một
 *    hội thoại; agent chỉ biết `groupGlobalId`.
 * 3. **Vai người gửi.** `senderType` của engine chỉ có `contact`/`self`.
 */
@Injectable()
export class AgentZaloReadService {
  private readonly logger = new Logger(AgentZaloReadService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly systemConfig: SystemConfigService,
    private readonly engine: ZaloEngineService,
  ) {}

  async layCauHinh(): Promise<CauHinhNgheZalo> {
    return (await this.systemConfig.get<CauHinhNgheZalo>(AGENT_ZALO_INBOUND_CONFIG_KEY)) ?? {};
  }

  /** Tra nhóm theo `groupGlobalId`, đã áp chốt loại nhóm. */
  async nhomDuocPhep(groupGlobalId: string): Promise<NhomDaTra> {
    const nhom = (await this.connection
      .collection('zalo_group_links')
      .findOne({ groupGlobalId }, { projection: { kind: 1, conversationIds: 1, title: 1, groupGlobalId: 1 } })) as NhomDaTra | null;

    if (!nhom) throw new BadRequestException(LY_DO_CHAN.khongThayNhom);
    if (!nhomDuocNghe(nhom.kind)) {
      throw new BadRequestException(
        nhom.kind === 'seller'
          ? 'CẤM đọc nhóm khách hàng — đường này chỉ dành cho nhóm nội bộ và nhóm vận hành.'
          : LY_DO_CHAN.chuaXet,
      );
    }

    return nhom;
  }

  /**
   * Tập uid cho hai điều kiện kích hoạt, lấy từ `zalo_identities` — bảng người
   * vận hành đã xét.
   *
   * KHÔNG lấy từ `GET /accounts` của engine: uid ở đó là uid nick TỰ NHÌN MÌNH,
   * còn `mentions[].uid` là uid phía người khác thấy. Hai không gian khác nhau,
   * so với nhau thì luôn trượt và trượt im lặng — đã đo: không một uid nào trong
   * 12 uid bị tag nhiều nhất khớp bảng account.
   */
  async tapUidKichHoat(): Promise<{ chuTich: Set<string>; nickAgent: Set<string> }> {
    const cauHinh = await this.layCauHinh();
    const ds = await this.connection
      .collection('zalo_identities')
      .find({ kind: { $in: ['chairman', 'ai-support'] } }, { projection: { zaloUid: 1, kind: 1 } })
      .toArray();

    const chuTich = new Set<string>(cauHinh.chairmanZaloUids ?? []);
    const nickAgent = new Set<string>(cauHinh.agentNickZaloUids ?? []);
    for (const d of ds) {
      if (d.kind === 'chairman') chuTich.add(String(d.zaloUid));
      else nickAgent.add(String(d.zaloUid));
    }

    return { chuTich, nickAgent };
  }

  /** Bảng uid → `kind` từ `zalo_identities`, để suy vai người gửi. */
  async kindTheoUid(uids: string[]): Promise<Map<string, string>> {
    if (uids.length === 0) return new Map();
    const ds = await this.connection
      .collection('zalo_identities')
      .find({ zaloUid: { $in: uids } }, { projection: { zaloUid: 1, kind: 1 } })
      .toArray();

    return new Map(ds.map((d) => [String(d.zaloUid), String(d.kind)]));
  }

  /**
   * Tra một hội thoại RIÊNG (1-1) và xác định người bên kia là ai.
   *
   * Danh tính lấy từ `zalo_identities` — bảng người vận hành đã xét — cộng tập
   * uid Chủ tịch khai trong cấu hình. Hội thoại 1-1 bên engine mang
   * `threadType='user'`, và uid của người đó nằm ở bản ghi contact, đúng không
   * gian uid mà bảng danh tính dùng.
   *
   * Hội thoại NHÓM bị từ chối ở đây chứ không âm thầm cho qua: nhóm có chốt
   * riêng theo `kind`, và cho đi vòng qua đường DM là vô hiệu hoá nó.
   */
  async nguoiNhanDm(conversationId: string): Promise<{ conversationId: string; zaloUid: string; displayName?: string; role: string }> {
    // Lấy ĐÍCH DANH chứ không duyệt danh sách: `GET /conversations` bị engine lọc
    // theo quyền người gọi và trả rỗng cho `agent-api`, còn lấy theo id thì không.
    let c: Record<string, unknown>;
    try {
      c = await this.engine.hoiThoai(conversationId);
    } catch {
      throw new BadRequestException(LY_DO_CHAN.khongThayHoiThoai);
    }
    if (!c?.id) throw new BadRequestException(LY_DO_CHAN.khongThayHoiThoai);
    if (String(c.threadType ?? '') !== 'user') throw new BadRequestException(LY_DO_CHAN.khongPhaiDm);

    const contact = (c.contact ?? {}) as { fullName?: string; zaloUid?: string };
    const uid = String(contact.zaloUid ?? c.externalThreadId ?? '');
    if (!uid) throw new BadRequestException(LY_DO_CHAN.khongThayHoiThoai);

    const { chuTich } = await this.tapUidKichHoat();
    const kinds = await this.kindTheoUid([uid]);

    return {
      conversationId,
      zaloUid: uid,
      // Hội thoại 1-1 để trống `title`; tên người nằm ở bản ghi contact.
      displayName: contact.fullName || (c.title as string) || undefined,
      role: suyVai(uid, chuTich, kinds),
    };
  }

  /** Tin của MỘT hội thoại riêng, sau khi đã qua chốt người nhận. */
  async tinCuaDm(conversationId: string, limit = 50, since?: string): Promise<AgentZaloMessage[]> {
    const nguoi = await this.nguoiNhanDm(conversationId);
    const chan = kiemNguoiNhanDm(nguoi.role);
    if (!chan.ok) throw new BadRequestException(chan.lyDo);

    // Hội thoại riêng chỉ có một bản ghi cho mỗi tin, nhưng dùng cùng đường đọc
    // để `since` và việc bỏ tin đã xoá cư xử giống nhau ở cả hai ngữ cảnh.
    const tho = await this.engine.tinCuaNhom([conversationId], limit, since);

    // Hội thoại riêng không thuộc nhóm nào, nên `kind` báo thẳng là `dm` thay vì
    // mượn một giá trị của nhóm — agent phải phân biệt được hai ngữ cảnh.
    return this.ganVai(tho, { groupGlobalId: '', kind: 'dm', title: nguoi.displayName });
  }


  /**
   * Tin của một nhóm, gộp từ MỌI hội thoại của nhóm đó và sắp theo thời gian.
   *
   * Hội thoại hỏng thì bỏ qua chứ không làm hỏng cả lượt đọc: `conversationIds`
   * có thể cũ — nick bị gỡ khỏi nhóm mà bản ghi còn, Zalo trả "Nhóm này không
   * tồn tại". Đã gặp thật. Một nick chết không được làm câm cả nhóm.
   */
  async tinCuaNhom(groupGlobalId: string, limit = 50, since?: string): Promise<AgentZaloMessage[]> {
    const nhom = await this.nhomDuocPhep(groupGlobalId);
    const hoiThoai = nhom.conversationIds ?? [];
    if (hoiThoai.length === 0) return [];

    // Gộp + khử trùng nằm ở `ZaloEngineService`: một câu nói được engine lưu một
    // bản cho MỖI nick trong nhóm, không khử thì agent đọc mỗi câu nhiều lần.
    const tho = await this.engine.tinCuaNhom(hoiThoai, limit, since);

    return this.ganVai(tho, nhom);
  }

  /** Gắn vai người gửi + đánh dấu mention nào trúng nick công ty. */
  async ganVai(tho: TinThoEngine[], nhom: NhomDaTra): Promise<AgentZaloMessage[]> {
    const { chuTich, nickAgent } = await this.tapUidKichHoat();

    const uids = new Set<string>();
    for (const m of tho) {
      if (m.senderUid) uids.add(String(m.senderUid));
      for (const mt of m.mentions ?? []) if (mt?.uid) uids.add(String(mt.uid));
    }
    const kinds = await this.kindTheoUid([...uids]);

    return tho.map((m) => ({
      messageId: String(m.id),
      zaloMsgId: m.zaloMsgId ? String(m.zaloMsgId) : undefined,
      groupGlobalId: nhom.groupGlobalId,
      groupTitle: nhom.title,
      kind: String(nhom.kind),
      conversationId: String(m.conversationId),
      sentAt: new Date(m.sentAt).toISOString(),
      content: m.content ?? undefined,
      contentType: String(m.contentType ?? 'text'),
      attachments: Array.isArray(m.attachments) && m.attachments.length > 0 ? m.attachments : undefined,
      replyToId: m.replyToId ?? undefined,
      sender: {
        zaloUid: m.senderUid ? String(m.senderUid) : undefined,
        displayName: m.senderName ?? undefined,
        role: suyVai(m.senderUid ? String(m.senderUid) : undefined, chuTich, kinds),
      },
      mentions: (m.mentions ?? []).map((mt) => ({
        uid: mt?.uid ? String(mt.uid) : undefined,
        name: mt?.name || undefined,
        laNickAgent: !!mt?.uid && nickAgent.has(String(mt.uid)),
      })),
    }));
  }
}
