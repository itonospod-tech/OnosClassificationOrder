import { Injectable, OnModuleInit } from '@nestjs/common';

import { AgentApiRepository } from './agent-api.repository';

export type AgentAuditRecord = {
  capability: 'list_tables' | 'read_rows' | 'query' | 'docs_catalog' | 'docs_get' | 'seller_support' | 'ceo_overview' | 'ceo_report' | 'ceo_report_chart' | 'customer_report' | 'zalo_send' | 'zalo_read' | 'zalo_inbox';
  table?: string;
  docSlug?: string;
  queryDigest?: unknown;
  returned?: number;
  durationMs: number;
  outcome: 'ok' | 'denied' | 'error' | 'timeout';
  errorCode?: string;
};

/** Giữ nhật ký 90 ngày — cửa đọc dữ liệu kinh doanh cần vết, nhưng không cần vết vĩnh viễn. */
const TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Nhật ký mọi lời gọi tới bộ API agent (`API-1`, BR-7, AC-14).
 *
 * Bản ghi KHÔNG chứa dữ liệu BR-4: `queryDigest` đã được
 * `AgentQueryService.digest()` thay giá trị của mọi điều kiện lọc trên trường
 * `read:false` bằng `<redacted>` trước khi tới đây.
 */
@Injectable()
export class AgentAuditService implements OnModuleInit {
  constructor(private readonly repository: AgentApiRepository) {}

  /**
   * Tạo index TTL lúc khởi động. Repo không có hệ thống migration dạng file
   * nên đây là khuôn mẫu sẵn có; `createIndex` là thao tác idempotent.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.repository.ensureLogTtlIndex(TTL_SECONDS);
    } catch (error) {
      console.error('[agent-api] không tạo được index TTL cho agentApiLogs:', error);
    }
  }

  /**
   * Ghi vết. Fire-and-forget có `catch`: lỗi ghi nhật ký không được làm hỏng
   * lời gọi đọc mà bên kia đang chờ kết quả.
   */
  write(record: AgentAuditRecord): void {
    void this.repository
      .insertLog({ at: new Date(), returned: 0, ...record })
      .catch((error) => console.error('[agent-api] ghi nhật ký thất bại:', error));
  }
}
