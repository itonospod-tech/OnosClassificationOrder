import { Injectable } from '@nestjs/common';
import type { AgentRowsPayload, AgentTableSummary } from 'shared';

import { ApiConfigService } from '@/shared/services/api-config.service';

import { AgentApiRepository } from './agent-api.repository';
import { invalidQuery } from './agent-errors';
import { AgentQueryService } from './agent-query.service';
import { buildOpenTableMeta, buildTableMeta } from './agent-table-meta';
import { pickProjected } from './pick-projected';
import type { AgentTableSpec } from './registry';
import { AGENT_TABLE_REGISTRY } from './registry';

/**
 * Năng lực A của bộ API agent (`API-1`): liệt kê bảng và đọc dữ liệu thô theo
 * lô có giới hạn (AC-02, AC-03).
 */
@Injectable()
export class AgentReadService {
  constructor(
    private readonly queries: AgentQueryService,
    private readonly repository: AgentApiRepository,
    private readonly config: ApiConfigService,
  ) {}

  /**
   * MỌI collection đang có, không chỉ 11 bảng có mô tả (`API-19`).
   *
   * Bảng có mô tả trả về đầy đủ ghi chú nghiệp vụ; bảng còn lại trả về khung
   * rỗng kèm lời nhắc đọc thử vài bản ghi để biết cấu trúc. Hợp nhất hai nguồn
   * bằng `Set` để bảng có mô tả nhưng chưa có bản ghi nào vẫn hiện ra — nếu
   * không, agent sẽ tưởng bảng đó không tồn tại chỉ vì nó đang rỗng.
   *
   * Dùng chung hàm dựng với bề mặt quản trị (`API-18`) — hai nơi mô tả cùng một
   * trường theo hai kiểu khác nhau là thứ AC-03 cấm.
   */
  async listTables(): Promise<AgentTableSummary[]> {
    const names = await this.repository.listCollections();
    const all = [...new Set([...names, ...Object.keys(AGENT_TABLE_REGISTRY)])].sort();
    return all.map((name) => {
      const documented = AGENT_TABLE_REGISTRY[name];
      return documented ? buildTableMeta(documented) : buildOpenTableMeta(name);
    });
  }

  /**
   * Đọc thô, phân trang THEO CON TRỎ trên `_id` tăng dần. Không dùng `skip`:
   * bảng `orders` lớn, `skip` sâu vừa chậm vừa vi phạm BR-6.
   *
   * Không xin `fields` thì trả **nguyên bản ghi** (`API-19`) trừ bốn tên bị
   * chặn — đây là cách duy nhất đọc được trường của collection chưa ai mô tả.
   *
   * Hết dữ liệu thì `items` rỗng và KHÔNG có `nextCursor` — phân biệt được với
   * trường hợp bị từ chối (403), đúng luồng ngoại lệ của SRS mục 6.
   */
  async readRows(
    table: string,
    limit?: number,
    cursor?: string,
    fields?: string[],
    filterJson?: string,
  ): Promise<AgentRowsPayload> {
    const spec = this.queries.spec(table);
    const timeoutMs = this.config.agentApi.readTimeoutMs;
    const limitApplied = this.queries.clampLimit(limit);
    const projection = this.queries.buildProjection(spec, fields);

    // Lọc theo dữ liệu (`API-6`) dùng LẠI đúng cơ chế của `POST /query` — hai
    // đường lọc với hai bộ luật là cách chắc chắn để một ngày chúng lệch nhau,
    // và đường lỏng hơn sẽ thành lỗ hổng.
    const dataFilter = this.parseFilter(spec, filterJson);
    const cursorFilter = cursor ? { _id: { $gt: cursor } } : undefined;

    // `$and` chứ không trộn khoá: điều kiện của bên gọi có thể chạm `_id`, và
    // trộn nông sẽ để nó ĐÈ con trỏ phân trang — trang sau lặp lại trang trước.
    const filter = cursorFilter
      ? Object.keys(dataFilter).length
        ? { $and: [dataFilter, cursorFilter] }
        : cursorFilter
      : dataFilter;

    const raw = await this.queries.run(
      () =>
        this.repository.find({
          collection: spec.key,
          filter,
          projection,
          sort: { _id: 1 },
          skip: 0,
          // Dư một dòng: `nextCursor` cũ suy từ "lô đầy tới trần" nên lô cuối
          // vừa khít trần vẫn trả con trỏ, bên gọi phải gọi thêm một lượt rỗng
          // mới biết là hết.
          limit: limitApplied + 1,
          maxTimeMS: timeoutMs,
        }),
      timeoutMs,
    );

    const hasMore = raw.length > limitApplied;
    const trang = hasMore ? raw.slice(0, limitApplied) : raw;
    const rows = Object.keys(projection).length ? trang.map((r) => pickProjected(r, projection)) : trang;
    const items = this.queries.maskRows(spec, rows);

    // Con trỏ chỉ có khi thật sự còn dòng phía sau.
    const last = trang.at(-1);
    const nextCursor = hasMore && last?._id ? String(last._id) : undefined;

    return { items, nextCursor, meta: { table: spec.key, returned: items.length, limitApplied, hasMore } };
  }

  /**
   * `filter` tới đây dưới dạng chuỗi JSON vì GET không có thân yêu cầu, rồi đi
   * qua **đúng cùng một bộ dịch** với `POST /query` (`API-8`). Hai đường lọc với
   * hai bộ luật là cách chắc chắn để một ngày chúng lệch nhau, và đường lỏng hơn
   * thành lỗ hổng.
   *
   * KHÔNG còn gọi `assertNoOperatorKeys` ở đây: từ `API-8`, `$` trong `filter`
   * là cú pháp hợp lệ. Việc kiểm do danh sách trắng toán tử trong
   * `mongo-filter.ts` đảm nhiệm — chặt hơn hẳn phép quét `$`, vì nó còn kiểm cả
   * chính sách trường. Trường `filter: 'none'` vẫn không lọc được,
   * `filter: 'eq'` vẫn chỉ so bằng.
   */
  private parseFilter(spec: AgentTableSpec, filterJson?: string): Record<string, unknown> {
    if (!filterJson) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(filterJson);
    } catch {
      throw invalidQuery('Query parameter `filter` must be valid JSON.');
    }

    return this.queries.buildFilter(spec, parsed);
  }
}
