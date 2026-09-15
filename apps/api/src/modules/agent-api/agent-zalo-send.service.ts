import { createHmac } from 'node:crypto';

import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

import { ApiConfigService } from '@/shared/services/api-config.service';

import { AgentZaloReadService } from './agent-zalo-read.service';
import { chonHoiThoai, dienGiaiLoiEngine, kiemNguoiNhanDm, kiemNoiDung, type NhomDeGui, thuNickKhac } from './agent-zalo-send.logic';

/** Engine từ chối token quá cũ; 15 giây là dư cho một lời gọi nội bộ. */
const HAN_GIAY = 15;

/**
 * Đường GỬI Zalo cho agent — ngoại lệ DUY NHẤT của luật chỉ-đọc (BR-3).
 *
 * Vì sao đặt ở đây thay vì nhờ engine của nhà cung cấp mở thêm: engine đã gửi
 * được từ lâu (`POST /conversations/:id/messages`), và app này vốn gọi engine
 * mỗi ngày cho màn chat. Thứ còn thiếu chỉ là một lớp mỏng có CHỐT CHẶN —
 * agent không có phiên người dùng nên không đi qua proxy của màn chat được.
 *
 * Vì sao KHÔNG dùng `AgentApiRepository`: lớp đó cố ý chỉ phơi `find`/`aggregate`
 * để giữ BR-3 bằng hình dạng, không bằng kỷ luật. Đường ghi này tách hẳn ra
 * chỗ khác để phần đọc vẫn đúng bất biến đó.
 *
 * Xác thực với engine: `x-service-token` = `{ts}.{HMAC-SHA256(ts, secret)}` cộng
 * bốn header danh tính — đúng cơ chế proxy của nhà cung cấp đang dùng.
 */
@Injectable()
export class AgentZaloSendService {
  private readonly logger = new Logger(AgentZaloSendService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ApiConfigService,
    private readonly read: AgentZaloReadService,
  ) {}

  async guiTinNhom(groupGlobalId: string, content: string, conversationId?: string): Promise<{ conversationId: string; groupTitle?: string; sentAt: string }> {
    const { url, secret } = this.config.zaloEngine;
    if (!url || !secret) throw new ServiceUnavailableException('Chưa cấu hình engine Zalo.');

    const noiDung = kiemNoiDung(content);
    if (!noiDung.ok) throw new BadRequestException(noiDung.lyDo);

    const nhom = (await this.connection
      .collection('zalo_group_links')
      .findOne({ groupGlobalId }, { projection: { kind: 1, conversationIds: 1, title: 1 } })) as NhomDeGui | null;

    const chon = chonHoiThoai(nhom, conversationId);
    if (!chon.ok) throw new BadRequestException(chon.lyDo);

    // Thử lần lượt các nick trong nhóm. Nick Zalo rớt kết nối là chuyện thường
    // (bị đá, chờ quét lại QR) và nhóm nào cũng có vài nick — dừng ở nick đầu
    // thì nhóm coi như câm dù vẫn còn đường gửi.
    let loiCuoi = '';
    for (const hoiThoai of chon.ungVien) {
      const ts = String(Date.now());
      const sig = createHmac('sha256', secret).update(ts).digest('base64url');

      let res: Response;
      try {
        res = await fetch(`${url}/api/zalo-multi/conversations/${encodeURIComponent(hoiThoai)}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-service-token': `${ts}.${sig}`,
            // Engine đòi ngữ cảnh người dùng; agent gửi NHÂN DANH HỆ THỐNG nên
            // ghi rõ là `agent` để nhật ký bên engine không lẫn với người thật.
            'x-user-id': 'agent-api',
            'x-user-name': 'Agent',
            'x-user-role': 'owner',
            'x-user-scopes': '[]',
          },
          body: JSON.stringify({ content: noiDung.content }),
          signal: AbortSignal.timeout(HAN_GIAY * 1000),
        });
      } catch (e) {
        throw new ServiceUnavailableException(`Không gọi được engine Zalo: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (res.ok) return { conversationId: hoiThoai, groupTitle: nhom?.title, sentAt: new Date().toISOString() };

      // Nguyên văn lỗi engine chỉ vào log; agent nhận câu chung để không lộ
      // đường dẫn/nội bộ ra ngoài.
      const raw = await res.text().catch(() => '');
      this.logger.error(`[agent-zalo-send] engine trả ${res.status} ở hội thoại ${hoiThoai}: ${raw.slice(0, 300)}`);
      loiCuoi = dienGiaiLoiEngine(raw, res.status);

      // Chỉ đi tiếp khi lỗi xảy ra TRƯỚC lúc gửi. Lỗi khác có thể là tin đã đi
      // rồi mới hỏng, thử nick tiếp theo sẽ thành nhắn hai lần.
      if (!thuNickKhac(raw)) throw new ServiceUnavailableException(loiCuoi);
    }

    // Hết nick mà chưa gửi được: nói RÕ là đã thử mấy nick, vì lỗi của nick cuối
    // một mình nó gây hiểu nhầm là chỉ có một đường và đường đó hỏng.
    throw new ServiceUnavailableException(
      chon.ungVien.length > 1
        ? `Đã thử ${chon.ungVien.length} nick của công ty trong nhóm, không nick nào gửi được. Lỗi cuối: ${loiCuoi || 'không rõ'}`
        : loiCuoi || 'Engine Zalo từ chối.',
    );
  }
  /**
   * Gửi tin NHẮN RIÊNG.
   *
   * Chốt chặn khác hẳn đường nhóm và phải khác: nhóm có `kind` do người vận hành
   * xét, DM thì không có gì tương đương — thứ duy nhất đứng giữa agent và một
   * người lạ là bảng danh tính. Vì thế MẶC ĐỊNH CẤM: chỉ `chairman`/`staff` mới
   * nhận được, còn `unknown` bị chặn y như `customer`. Đo 12/09: 53/61 người
   * đang có hội thoại riêng với nick công ty chưa ai xét là ai.
   *
   * Không thử nhiều nick như đường nhóm: hội thoại riêng chỉ có đúng một nick
   * công ty ở đầu bên này, không có đường lui nào để thử.
   */
  async guiTinRieng(conversationId: string, content: string): Promise<{ conversationId: string; recipient: { displayName?: string; role: string }; sentAt: string }> {
    const { url, secret } = this.config.zaloEngine;
    if (!url || !secret) throw new ServiceUnavailableException('Chưa cấu hình engine Zalo.');

    const noiDung = kiemNoiDung(content);
    if (!noiDung.ok) throw new BadRequestException(noiDung.lyDo);

    const nguoi = await this.read.nguoiNhanDm(conversationId);
    const chan = kiemNguoiNhanDm(nguoi.role);
    if (!chan.ok) throw new BadRequestException(chan.lyDo);

    const ts = String(Date.now());
    const sig = createHmac('sha256', secret).update(ts).digest('base64url');

    let res: Response;
    try {
      res = await fetch(`${url}/api/zalo-multi/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': `${ts}.${sig}`,
          'x-user-id': 'agent-api',
          'x-user-name': 'Agent',
          'x-user-role': 'owner',
          'x-user-scopes': '[]',
        },
        body: JSON.stringify({ content: noiDung.content }),
        signal: AbortSignal.timeout(HAN_GIAY * 1000),
      });
    } catch (e) {
      throw new ServiceUnavailableException(`Không gọi được engine Zalo: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      this.logger.error(`[agent-zalo-send] DM ${conversationId} — engine trả ${res.status}: ${raw.slice(0, 300)}`);
      throw new ServiceUnavailableException(dienGiaiLoiEngine(raw, res.status));
    }

    // Trả lại NGƯỜI NHẬN để agent đối chiếu mình vừa nhắn cho ai — uid không dùng
    // để định danh được (phụ thuộc nick đang nhìn), nên vai + tên là thứ duy nhất
    // agent kiểm lại được.
    return { conversationId, recipient: { displayName: nguoi.displayName, role: nguoi.role }, sentAt: new Date().toISOString() };
  }

}
