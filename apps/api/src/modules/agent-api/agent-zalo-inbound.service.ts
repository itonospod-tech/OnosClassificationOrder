import { createHmac } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AgentZaloMessage, AgentZaloTrigger } from 'shared';

import { type TinThoEngine, ZaloEngineService } from '../zalo-engine/zalo-engine.service';
import { chuKyKhop, khoaChongTrung, type LyDoKichHoat, lyDoKichHoat, nhomDuocNghe } from './agent-zalo-inbound.logic';
import { AgentZaloReadService, type NhomDaTra } from './agent-zalo-read.service';
import { AgentZaloTriggerEntity } from './agent-zalo-trigger.entity';

/** Engine giao lại khi lỗi, nên mọi thứ ở đây phải chịu được giao trùng. */
const HAN_CHUYEN_TIEP_GIAY = 10;

interface ThanGiaoTu {
  event?: string;
  deliveryId?: string;
  payload?: { messageId?: string; conversationId?: string; senderUid?: string; content?: string; contentType?: string; sentAt?: string };
}

/**
 * NGHE tin Zalo: nhận webhook của engine, lọc, lưu, rồi chuyển tiếp cho agent.
 *
 * Vì sao bắc qua mình thay vì để engine đẩy thẳng tới máy agent — đây là điểm
 * thiết kế quan trọng nhất của cả tính năng:
 *
 * - **Engine không biết `kind`.** Nó đẩy MỌI nhóm. Đăng ký thẳng nghĩa là nội
 *   dung nhóm khách hàng và nhóm cá nhân nhân viên rời khỏi hệ thống — phá đúng
 *   cái chốt riêng tư mà `kind=internal` sinh ra để giữ.
 * - **Chi phí.** 1.888 tin/ngày ở nhóm nội bộ/vận hành. Lọc ở đây còn 165/ngày.
 *   Bộ lọc cần bảng nhóm và bảng danh tính — cả hai nằm ở Mongo bên mình.
 * - **Không mất sự kiện.** Lưu trước rồi mới đẩy: bên nhận sập thì họ poll lại
 *   từ con trỏ, thay vì mất im lặng một câu hỏi của Chủ tịch.
 */
@Injectable()
export class AgentZaloInboundService {
  private readonly logger = new Logger(AgentZaloInboundService.name);

  constructor(
    @InjectModel(AgentZaloTriggerEntity.name) private readonly triggerModel: Model<AgentZaloTriggerEntity>,
    private readonly read: AgentZaloReadService,
    private readonly engine: ZaloEngineService,
  ) {}

  /**
   * Xử lý một lượt giao của engine.
   *
   * KHÔNG ném khi tin bị loại: engine coi lỗi là giao hỏng rồi thử lại mãi, mà
   * "tin này không đáng quan tâm" là kết quả đúng chứ không phải lỗi.
   */
  async nhanGiao(than: ThanGiaoTu, chuKy: string | undefined, thanTho: string): Promise<{ ketQua: string; reason?: LyDoKichHoat }> {
    const cauHinh = await this.read.layCauHinh();

    // Bí mật chưa khai thì TỪ CHỐI hết, chứ không mở toang: đường này nhận dữ
    // liệu từ ngoài vào rồi phát tiếp đi, không thể để ai gọi cũng được.
    if (!cauHinh.engineWebhookSecret) throw new UnauthorizedException('Chưa cấu hình bí mật webhook.');
    if (!chuKyKhop(chuKy, createHmac('sha256', cauHinh.engineWebhookSecret).update(thanTho).digest('hex'))) {
      throw new UnauthorizedException('Chữ ký webhook không khớp.');
    }

    if (than.event !== 'message.received') return { ketQua: 'bo-qua-su-kien' };
    const p = than.payload ?? {};
    if (!p.messageId || !p.conversationId) return { ketQua: 'thieu-truong' };

    // Bước rẻ nhất trước: tra nhóm từ hội thoại. Nhóm khách/chưa xét bị chặn ở
    // đây, KHÔNG tốn một lời gọi engine nào — đó là phần lớn lưu lượng.
    const nhom = (await this.triggerModel.db
      .collection('zalo_group_links')
      .findOne({ conversationIds: p.conversationId }, { projection: { kind: 1, title: 1, groupGlobalId: 1, conversationIds: 1 } })) as NhomDaTra | null;

    if (!nhom) return { ketQua: 'khong-map-duoc-nhom' };
    if (!nhomDuocNghe(nhom.kind)) return { ketQua: 'nhom-khong-nghe' };

    const { chuTich, nickAgent } = await this.read.tapUidKichHoat();

    // Chủ tịch nhắn thì biết ngay từ payload, khỏi gọi engine. Chỉ khi CẦN xét
    // mention mới phải đọc lại tin — engine không gửi mentions trong payload.
    let mentions: Array<{ uid?: string; name?: string }> = [];
    let tinTho: TinThoEngine | undefined;
    const laChuTich = !!p.senderUid && chuTich.has(p.senderUid);

    if (!laChuTich) {
      tinTho = await this.docLaiTin(p.conversationId, p.messageId);
      mentions = (tinTho?.mentions as Array<{ uid?: string }>) ?? [];
    }

    const reason = lyDoKichHoat({ senderUid: p.senderUid, mentions }, chuTich, nickAgent);
    if (!reason) return { ketQua: 'khong-dang-danh-thuc' };

    // Đọc lại trượt thì vẫn dựng được tin từ payload — thiếu mentions nhưng đủ
    // nội dung để agent làm việc, hơn là bỏ mất một câu của Chủ tịch.
    const tho: TinThoEngine = tinTho ??
      (await this.docLaiTin(p.conversationId, p.messageId)) ?? {
        id: p.messageId,
        conversationId: p.conversationId,
        senderUid: p.senderUid,
        content: p.content,
        contentType: p.contentType,
        sentAt: p.sentAt ?? new Date().toISOString(),
        mentions: [],
      };

    const [message] = await this.read.ganVai([tho], nhom);
    await this.luuVaChuyenTiep(message, reason, khoaChongTrung(nhom.groupGlobalId, tho.zaloMsgId, tho.id));

    return { ketQua: 'da-nhan', reason };
  }

  private async docLaiTin(conversationId: string, messageId: string): Promise<TinThoEngine | undefined> {
    try {
      const ds = await this.engine.tinCuaHoiThoai(conversationId, 20);

      return ds.find((m) => String(m.id) === messageId);
    } catch (e) {
      this.logger.warn(`[agent-zalo-inbound] không đọc lại được tin ${messageId}: ${e instanceof Error ? e.message : String(e)}`);

      return undefined;
    }
  }

  /**
   * Lưu TRƯỚC rồi mới đẩy, và giao trùng thì bỏ qua im lặng.
   *
   * Thứ tự này quan trọng: đẩy trước mà lưu hỏng thì bên nhận có sự kiện còn
   * mình không, poll lại sẽ thiếu. Lưu trước thì tệ nhất là đẩy trượt, và poll
   * vẫn lấy được.
   */
  private async luuVaChuyenTiep(message: AgentZaloMessage, reason: LyDoKichHoat, khoa: string): Promise<void> {
    let doc;
    try {
      doc = await this.triggerModel.create({
        reason,
        groupGlobalId: message.groupGlobalId,
        messageId: message.messageId,
        khoaChongTrung: khoa,
        message,
        receivedAt: new Date(),
      });
    } catch (e) {
      // E11000 = tin này đã xử lý rồi. Hai đường dẫn tới đây và cả hai đều bình
      // thường: engine giao lại sau lỗi, HOẶC cùng một câu nói được engine lưu
      // thành nhiều bản (mỗi nick công ty một bản) nên giao nhiều lần.
      if ((e as { code?: number }).code === 11000) return;
      throw e;
    }

    const cauHinh = await this.read.layCauHinh();
    const ds = (cauHinh.subscribers ?? []).filter((s) => s.url && s.enabled !== false);
    if (ds.length === 0) return;

    const goi: AgentZaloTrigger = {
      triggerId: String(doc._id),
      reason,
      receivedAt: doc.receivedAt.toISOString(),
      message,
    };
    const than = JSON.stringify(goi);
    const loi: string[] = [];

    for (const s of ds) {
      try {
        const h: Record<string, string> = { 'content-type': 'application/json' };
        if (s.secret) h['x-signature'] = createHmac('sha256', s.secret).update(than).digest('hex');
        const r = await fetch(s.url, { method: 'POST', headers: h, body: than, signal: AbortSignal.timeout(HAN_CHUYEN_TIEP_GIAY * 1000) });
        if (!r.ok) loi.push(`${s.url} → ${r.status}`);
      } catch (e) {
        loi.push(`${s.url} → ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Đẩy trượt KHÔNG ném ngược lên engine: sự kiện đã nằm trong kho, bên nhận
    // poll lại là có. Ném ra sẽ khiến engine giao lại mãi một tin đã xử lý xong.
    await this.triggerModel.updateOne(
      { _id: doc._id },
      loi.length > 0 ? { $set: { forwarded: false, forwardError: loi.join('; ').slice(0, 400) } } : { $set: { forwarded: true } },
    );
    if (loi.length > 0) this.logger.warn(`[agent-zalo-inbound] chuyển tiếp trượt: ${loi.join('; ').slice(0, 300)}`);
  }

  /** Hộp thư — đường lui (B) khi bên nhận sập, đọc cùng kho với đường đẩy. */
  async hopThu(cursor?: string, since?: string, limit = 50): Promise<{ data: AgentZaloTrigger[]; total: number; nextCursor?: string }> {
    const dk: Record<string, unknown> = {};
    if (cursor) dk._id = { $gt: cursor };
    if (since) dk.receivedAt = { $gt: new Date(since) };

    const ds = await this.triggerModel.find(dk).sort({ _id: 1 }).limit(limit).lean();
    const data = ds.map((d) => ({
      triggerId: String(d._id),
      reason: d.reason as LyDoKichHoat,
      receivedAt: new Date(d.receivedAt).toISOString(),
      message: d.message as unknown as AgentZaloMessage,
    }));

    return { data, total: data.length, nextCursor: data.length > 0 ? data[data.length - 1].triggerId : undefined };
  }
}
