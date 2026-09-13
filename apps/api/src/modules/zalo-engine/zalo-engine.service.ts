import { createHmac } from 'node:crypto';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { ApiConfigService } from '@/shared/services/api-config.service';

/** Engine từ chối token quá cũ; 15 giây là dư cho một lời gọi nội bộ. */
const HAN_GIAY = 15;

/** Tin THÔ do engine trả. Chỉ khai phần đang dùng — engine trả 24 trường. */
export interface TinThoEngine {
  id: string;
  conversationId?: string;
  zaloMsgId?: string;
  senderType?: string;
  senderUid?: string;
  senderName?: string;
  content?: string;
  contentType?: string;
  attachments?: unknown[];
  replyToId?: string | null;
  mentions?: Array<{ uid?: string; name?: string }>;
  isDeleted?: boolean;
  sentAt: string;
}

/**
 * Cửa duy nhất đọc engine Zalo từ phía NestJS.
 *
 * Vì sao là một module riêng chứ không nằm trong module nào đang cần: hai chỗ
 * cần đọc engine — bộ API cho agent và bộ tóm tắt nhóm — và cả hai đều phải
 * KHỬ TRÙNG theo `zaloMsgId`. Để mỗi bên tự làm thì sớm muộn một bên sửa, một
 * bên không; mà lỗi đó không hiện ra thành lỗi, nó hiện ra thành "mỗi câu đọc
 * được bảy lần".
 *
 * Xác thực: `x-service-token` = `{ts}.{HMAC-SHA256(ts, ZALO_ENGINE_SECRET)}`
 * cộng bốn header danh tính — đúng cơ chế proxy của nhà cung cấp đang dùng.
 */
@Injectable()
export class ZaloEngineService {
  private readonly logger = new Logger(ZaloEngineService.name);

  constructor(private readonly config: ApiConfigService) {}

  get daCauHinh(): boolean {
    const { url, secret } = this.config.zaloEngine;

    return !!url && !!secret;
  }

  async goi<T>(duong: string): Promise<T> {
    const { url, secret } = this.config.zaloEngine;
    if (!url || !secret) throw new ServiceUnavailableException('Chưa cấu hình engine Zalo.');

    const ts = String(Date.now());
    let res: Response;
    try {
      res = await fetch(`${url}${duong}`, {
        headers: {
          'content-type': 'application/json',
          'x-service-token': `${ts}.${createHmac('sha256', secret).update(ts).digest('base64url')}`,
          'x-user-id': 'agent-api',
          'x-user-name': 'Agent',
          'x-user-role': 'owner',
          'x-user-scopes': '[]',
        },
        signal: AbortSignal.timeout(HAN_GIAY * 1000),
      });
    } catch (e) {
      throw new ServiceUnavailableException(`Không gọi được engine Zalo: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      this.logger.error(`[zalo-engine] ${res.status} ở ${duong}: ${raw.slice(0, 300)}`);
      throw new ServiceUnavailableException(`Engine Zalo từ chối (${res.status}).`);
    }

    return (await res.json()) as T;
  }

  /** Một hội thoại theo id. Lấy đích danh vì `GET /conversations` bị lọc theo quyền người gọi. */
  async hoiThoai(conversationId: string): Promise<Record<string, unknown>> {
    const j = await this.goi<Record<string, unknown>>(`/api/zalo-multi/conversations/${encodeURIComponent(conversationId)}`);

    return (j.data as Record<string, unknown>) ?? j;
  }

  async tinCuaHoiThoai(conversationId: string, limit: number): Promise<TinThoEngine[]> {
    const j = await this.goi<{ data?: TinThoEngine[] }>(
      `/api/zalo-multi/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`,
    );

    return j.data ?? [];
  }

  /**
   * Tin của một NHÓM: gộp mọi hội thoại của nhóm, KHỬ TRÙNG, sắp mới trước.
   *
   * Engine lưu MỘT bản ghi cho MỖI nick công ty có mặt trong nhóm, nên một câu
   * nói thật ra 2–7 dòng với 2–7 `id` khác nhau nhưng CÙNG `zaloMsgId`. Không
   * khử trùng thì bên đọc thấy mỗi câu nhiều lần — đã gặp thật: nhóm 2 nick trả
   * 30 tin cho 15 câu.
   *
   * Hội thoại hỏng thì bỏ qua chứ không làm hỏng cả lượt: `conversationIds` có
   * thể cũ (nick đã bị gỡ khỏi nhóm mà bản ghi còn), và một nick chết không được
   * làm câm cả nhóm.
   */
  async tinCuaNhom(conversationIds: string[], limit: number, since?: string): Promise<TinThoEngine[]> {
    const mocSince = since ? new Date(since).getTime() : 0;
    const theoZaloMsgId = new Map<string, TinThoEngine>();

    for (const id of conversationIds) {
      let ds: TinThoEngine[];
      try {
        ds = await this.tinCuaHoiThoai(id, limit);
      } catch (e) {
        this.logger.warn(`[zalo-engine] bỏ qua hội thoại ${id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      for (const m of ds) {
        if (m.isDeleted) continue;
        if (mocSince && new Date(m.sentAt).getTime() <= mocSince) continue;
        // Thiếu `zaloMsgId` (tin cũ/tin hệ thống) thì lùi về id bản ghi: thà giữ
        // trùng còn hơn mất tin.
        const khoa = m.zaloMsgId ? `z:${m.zaloMsgId}` : `r:${m.id}`;
        if (!theoZaloMsgId.has(khoa)) theoZaloMsgId.set(khoa, { ...m, conversationId: m.conversationId ?? id });
      }
    }

    return [...theoZaloMsgId.values()].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()).slice(0, limit);
  }
}
