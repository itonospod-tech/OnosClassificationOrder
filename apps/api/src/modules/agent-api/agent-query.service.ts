import { Injectable } from '@nestjs/common';
import type { PipelineStage } from 'mongoose';
import type { AgentAggregate, AgentSelect, AgentSort } from 'shared';
import { AGENT_FILTER_MAX_DEPTH } from 'shared';

import { ApiConfigService } from '@/shared/services/api-config.service';

import { AgentApiRepository } from './agent-api.repository';
import { fieldNotAllowed, invalidQuery, isMongoTimeout, queryTimeout, tableNotAllowed } from './agent-errors';
import { buildMongoFilter } from './mongo-filter';
import { pickProjected } from './pick-projected';
import type { AgentFieldPolicy, AgentTableSpec } from './registry';
import { AGENT_TABLE_REGISTRY, isDeniedFieldPath, OPEN_POLICY, stripDeniedDeep } from './registry';

type Row = Record<string, unknown>;

/**
 * Lõi của bộ API agent (`API-1`, mở hết ở `API-19`): tra bảng, dựng pipeline.
 *
 * ⚠️ **ĐỌC TRƯỚC KHI SỬA.** Tới `API-18`, file này thi hành một danh sách
 * trắng: bảng ngoài registry không tồn tại, trường ngoài registry không tồn
 * tại, `$project` luôn dựng từ registry. `API-19` gỡ toàn bộ vế đó theo quyết
 * định của người dùng — **mọi collection, mọi trường đều đọc và lọc được**.
 *
 * Ba thứ còn giữ, đừng gỡ nhầm khi dọn dẹp:
 *  1. `AGENT_DENY_FIELD_NAMES` — bốn tên bí mật kỹ thuật. Kiểm ở `policy()` nên
 *     mọi đường (đọc, lọc, sắp xếp, nhóm, tổng hợp) đều đi qua một chốt.
 *  2. Giá trị của bên gọi chỉ nằm ở VỊ TRÍ GIÁ TRỊ, không bao giờ ở vị trí tên
 *     trường hay toán tử (`mongo-filter.ts` dựng lại từ đầu, không truyền tiếp).
 *  3. Chỉ đọc, có trần lô, có `maxTimeMS`, đọc trên secondary.
 */
@Injectable()
export class AgentQueryService {
  constructor(
    private readonly repository: AgentApiRepository,
    private readonly config: ApiConfigService,
  ) {}

  // ─── Tra bang / truong ────────────────────────────────────────────────

  /**
   * Bảng nào cũng đọc được (`API-19`) — kể cả bảng không ai mô tả. Bảng có mô
   * tả thì dùng `spec` của nó (để còn ghi chú nghiệp vụ và kiểu dữ liệu); bảng
   * còn lại nhận một spec MỞ, không trường nào khai sẵn.
   *
   * `TABLE_NOT_ALLOWED` nay chỉ còn dùng cho tên collection **không hợp lệ**:
   * tên rỗng, quá dài, hay chứa ký tự ngoài bộ MongoDB cho phép. Đây không phải
   * chính sách dữ liệu mà là chặn một chuỗi lạ đi thẳng vào tên collection.
   */
  spec(table: string): AgentTableSpec {
    const found = AGENT_TABLE_REGISTRY[table];
    if (found) return found;
    if (!AgentQueryService.SAFE_COLLECTION_NAME.test(table)) throw tableNotAllowed(table);
    return AgentQueryService.openSpec(table);
  }

  /** Tên collection hợp lệ của MongoDB, thu hẹp thêm cho chắc: không `$`, không rỗng. */
  private static readonly SAFE_COLLECTION_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;

  static openSpec(table: string): AgentTableSpec {
    return {
      key: table,
      description:
        'Bảng chưa có mô tả nghiệp vụ. Đọc được đầy đủ; lấy vài bản ghi bằng ' +
        'GET /agent/tables/{table}/rows?limit=1 để biết nó có những trường nào.',
      entityName: '',
      defaultSort: '_id',
      fields: {},
      deliberatelyExcluded: [],
    };
  }

  /**
   * Chốt chặn DUY NHẤT còn lại (`API-19`), và là chốt chung cho mọi đường:
   * đọc, lọc, sắp xếp, nhóm, tổng hợp đều gọi qua đây.
   *
   * Trường không có mô tả KHÔNG còn bị từ chối — nó nhận `OPEN_POLICY`. Đây là
   * chỗ đảo chiều so với `API-1`: trước là "không khai thì không tồn tại", nay
   * là "không khai thì vẫn dùng được, chỉ không có ghi chú".
   */
  private policy(spec: AgentTableSpec, field: string): AgentFieldPolicy {
    if (isDeniedFieldPath(field)) {
      throw fieldNotAllowed(
        field,
        'is an authentication secret or a session trace and is never exposed by this API.',
      );
    }
    return spec.fields[field] ?? OPEN_POLICY;
  }

  /** Các trường CÓ MÔ TẢ — nay chỉ dùng để gợi ý, không phải để giới hạn. */
  readableFields(spec: AgentTableSpec): string[] {
    return Object.keys(spec.fields);
  }

  /**
   * `$project` của server.
   *
   * KHÔNG xin gì → trả về `{}` nghĩa là **lấy nguyên bản ghi**: sau `API-19`,
   * chiếu theo danh sách khai sẵn sẽ âm thầm nuốt mất mọi trường chưa kịp mô
   * tả — đúng loại lỗi im lặng mà `pick-projected.ts` đã vấp một lần.
   *
   * Có xin → chỉ kiểm tên bị chặn, rồi chiếu đúng thứ đã xin.
   */
  buildProjection(spec: AgentTableSpec, requested?: string[]): Record<string, 1> {
    if (requested !== undefined && requested.length === 0) {
      // Khai `fields` mà không còn tên nào (vd `fields=` hoặc toàn dấu phẩy) là
      // LỖI, không phải "lấy hết": bản trước im lặng chiếu vào tên rỗng rồi trả
      // object rỗng, bên gọi tưởng bảng không có dữ liệu.
      throw invalidQuery('Query parameter `fields` is empty — list at least one field name, or omit the parameter.');
    }
    if (!requested?.length) return {};
    for (const f of requested) {
      if (isDeniedFieldPath(f)) {
        throw fieldNotAllowed(
          f,
          'is an authentication secret or a session trace and is never exposed by this API.',
        );
      }
    }
    return Object.fromEntries(requested.map((f) => [f, 1 as const]));
  }

  // ─── Chan ghi va chay ma ──────────────────────────────────────────────

  /**
   * Lớp chặn THỨ NHẤT của AC-06, chạy trước cả Zod: bất kỳ KHOÁ nào của object
   * bắt đầu bằng `$` hoặc chứa dấu chấm đều bị từ chối. Chặn `$where`,
   * `$function`, `$accumulator`, `$merge`, `$out`, và cả injection toán tử qua
   * giá trị lồng nhau.
   */
  assertNoOperatorKeys(payload: unknown, depth = 0): void {
    if (depth > 12) throw invalidQuery('Payload lồng quá sâu.');
    if (Array.isArray(payload)) {
      payload.forEach((v) => this.assertNoOperatorKeys(v, depth + 1));
      return;
    }
    if (typeof payload !== 'object' || payload === null) return;
    for (const [key, value] of Object.entries(payload)) {
      if (key.startsWith('$') || key.includes('.')) {
        throw invalidQuery(
          `Key '${key}' is not allowed. This API accepts only its own query language, not raw database operators.`,
        );
      }
      this.assertNoOperatorKeys(value, depth + 1);
    }
  }

  /**
   * Như trên, nhưng bỏ qua nhánh `filter` — nơi `$` là cú pháp hợp lệ kể từ
   * `API-8`.
   *
   * Đây là hàm RIÊNG chứ không phải một cờ trên hàm cũ, và đó là chủ ý
   * (`.devtasks/design/API-8.md` §8): một hàm mang cờ "cho phép `$`" sẽ có ngày
   * bị gọi với cờ bật ở chỗ không nên, mà không gì trong kiểu dữ liệu ngăn được.
   * Hai hàm riêng thì không gọi nhầm.
   *
   * `filter` được kiểm bằng danh sách trắng toán tử ở `mongo-filter.ts`, chặt
   * hơn hẳn phép quét `$` này — nên bỏ qua ở đây không phải là bỏ trống.
   */
  assertNoOperatorKeysOutsideFilter(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      this.assertNoOperatorKeys(payload);
      return;
    }
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'filter') continue;
      if (key.startsWith('$') || key.includes('.')) {
        throw invalidQuery(
          `Key '${key}' is not allowed. This API accepts only its own query language, not raw database operators.`,
        );
      }
      this.assertNoOperatorKeys(value);
    }
  }

  // ─── Dieu kien loc ────────────────────────────────────────────────────

  /**
   * Chuỗi ISO trên trường ngày phải thành `Date`, nếu không so sánh khoảng sẽ
   * sai âm thầm.
   *
   * Trường KHÔNG có mô tả (`type: 'any'`, mọi collection ngoài từ điển) thì
   * không biết kiểu, nên phỏng đoán theo mẫu: chuỗi có `T` và múi giờ mới đổi
   * sang `Date`. Chuỗi ngày trần `2026-08-19` giữ nguyên là chuỗi — đổi bừa sẽ
   * làm hỏng việc lọc trên trường vốn lưu chuỗi.
   */
  private coerce(p: AgentFieldPolicy, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const looksLikeDate = p.type === 'date' || (p.type === 'any' && AgentQueryService.ISO_DATETIME.test(value));
    if (!looksLikeDate) return value;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      if (p.type === 'any') return value;
      throw invalidQuery(`Value '${value}' is not a valid date.`);
    }
    return d;
  }

  private static readonly ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

  /**
   * Điều kiện lọc, **cú pháp MongoDB** (`API-8` thay hẳn DSL cây cũ).
   *
   * Cả `POST /query` lẫn `GET /tables/:table/rows` đều đi qua đây — một bộ luật
   * duy nhất. Hai đường lọc với hai bộ luật là cách chắc chắn để một ngày chúng
   * lệch nhau, và đường lỏng hơn thành lỗ hổng.
   *
   * Cú pháp cũ bị từ chối kèm thông điệp nêu rõ, không im lặng trả kết quả sai.
   */
  buildFilter(spec: AgentTableSpec, node?: unknown): Record<string, unknown> {
    return buildMongoFilter(
      spec,
      node,
      AGENT_FILTER_MAX_DEPTH,
      (s, field) => this.policy(s, field),
      (policy, value) => this.coerce(policy, value),
    );
  }

  // ─── Sap xep ──────────────────────────────────────────────────────────

  buildSort(spec: AgentTableSpec, sort: AgentSort[] | undefined, allowed?: Set<string>): Record<string, 1 | -1> {
    if (!sort?.length) return {};
    const out: Record<string, 1 | -1> = {};
    for (const s of sort) {
      // Trong nhánh tổng hợp, tên cột kết quả (metric / khoá nhóm) là hợp lệ.
      if (allowed?.has(s.field)) {
        out[s.field] = s.dir === 'desc' ? -1 : 1;
        continue;
      }
      // `policy()` chỉ còn chặn bốn tên bí mật; mọi trường khác sắp xếp được.
      this.policy(spec, s.field);
      out[s.field] = s.dir === 'desc' ? -1 : 1;
    }
    return out;
  }

  // ─── Che du lieu dau ra ───────────────────────────────────────────────

  /**
   * Lưới CUỐI cho bốn tên bị chặn (`API-19`).
   *
   * Vì sao vẫn cần dù `policy()` đã chặn ở đầu vào: khi bên gọi không xin
   * trường nào, truy vấn lấy **nguyên bản ghi**, nên một `password` nằm sẵn
   * trong tài liệu sẽ đi ra mà không ai phải hỏi xin nó. Tầng kho dữ liệu đã
   * loại bốn tên đó ở cấp một bằng `$project` loại trừ; hàm này quét tiếp mọi
   * độ sâu, cho cả nhánh lồng của collection không ai mô tả.
   *
   * KHÔNG còn che email/điện thoại trong văn bản tự do (`API-11`), không còn
   * lọc `before`/`after` của nhật ký qua danh sách trắng (`API-19`) — mọi thứ
   * khác ra nguyên văn.
   */
  maskRows(spec: AgentTableSpec, rows: Row[]): Row[] {
    return rows.map((row) => stripDeniedDeep(row));
  }

  // ─── Chay truy van ────────────────────────────────────────────────────

  clampLimit(requested: number | undefined, fallback = 50): number {
    const max = this.config.agentApi.maxLimit;
    if (!requested || requested < 1) return Math.min(fallback, max);
    return Math.min(requested, max);
  }

  /**
   * Bọc mọi lời gọi DB. `maxTimeMS` phải có ở MỌI `find()`/`aggregate()` của
   * module — sót một chỗ là AC-15 hổng đúng ở chỗ đó.
   */
  async run<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isMongoTimeout(error)) throw queryTimeout(timeoutMs);
      throw error;
    }
  }

  async selectRows(
    spec: AgentTableSpec,
    filter: Record<string, unknown>,
    select: AgentSelect | undefined,
  ): Promise<{ items: Row[]; limitApplied: number; hasMore: boolean; total?: number }> {
    const limit = this.clampLimit(select?.limit);
    const timeoutMs = this.config.agentApi.queryTimeoutMs;
    const projection = this.buildProjection(spec, select?.fields);
    const sort = this.buildSort(spec, select?.sort);
    const offset = select?.offset ?? 0;
    if (offset > 10_000) throw invalidQuery('Offset above 10000 is not supported. Narrow the filter instead.');

    const raw = await this.run(
      () =>
        this.repository.find({
          collection: spec.key,
          filter,
          projection,
          sort: Object.keys(sort).length ? sort : { [spec.defaultSort]: 1 },
          skip: offset,
          // Xin DƯ MỘT dòng để biết chắc còn trang sau hay không. Suy từ
          // `returned === limit` thì sai đúng ở lô cuối vừa khít trần, và bên
          // gọi không có cách nào phân biệt "hết dữ liệu" với "bị cắt".
          limit: limit + 1,
          maxTimeMS: timeoutMs,
        }),
      timeoutMs,
    );

    const hasMore = raw.length > limit;
    const trang = hasMore ? raw.slice(0, limit) : raw;

    // Không xin trường nào thì trả nguyên bản ghi — `pickProjected` chỉ dùng khi
    // có `$project` thu hẹp, vì nó cắt đúng theo danh sách đã xin.
    const rows = Object.keys(projection).length ? trang.map((r) => pickProjected(r, projection)) : trang;

    // Đếm tổng CHỈ khi được xin: mỗi lần đếm là một lần quét thêm, và phần lớn
    // lời gọi chỉ cần biết mình có đang cầm dữ liệu cắt dở hay không.
    const total = select?.withTotal
      ? await this.run(() => this.repository.count({ collection: spec.key, filter, maxTimeMS: timeoutMs }), timeoutMs)
      : undefined;

    return { items: this.maskRows(spec, rows), limitApplied: limit, hasMore, total };
  }

  async aggregate(
    spec: AgentTableSpec,
    filter: Record<string, unknown>,
    agg: AgentAggregate,
  ): Promise<{ items: Row[]; limitApplied: number; hasMore: boolean }> {
    const timeoutMs = this.config.agentApi.queryTimeoutMs;
    const limit = Math.min(agg.limit ?? 200, 1000);

    // Nhóm theo trường nào cũng được sau `API-19` — kể cả `assignee` hay
    // `userId`, tức sản lượng theo từng người. `policy()` chỉ chặn bốn tên bí mật.
    const groupBy = agg.groupBy ?? [];
    for (const g of groupBy) this.policy(spec, g);

    const groupId =
      groupBy.length === 0 ? null : Object.fromEntries(groupBy.map((g) => [g.replace(/\./g, '__'), `$${g}`]));

    const groupStage: Record<string, unknown> = { _id: groupId };
    for (const m of agg.metrics) {
      if (m.op === 'count') {
        groupStage[m.as] = { $sum: 1 };
        continue;
      }
      if (!m.field) throw invalidQuery(`Metric '${m.op}' requires a field.`);
      // Tổng hợp trên trường chữ không còn bị chặn: `$sum` trả 0, `$avg` trả
      // null. Người dùng chốt không chặn, nên con số vô nghĩa là kết quả đúng
      // theo chính sách — agent tự nhìn kiểu dữ liệu ở `GET /agent/tables`.
      this.policy(spec, m.field);
      groupStage[m.as] = { [`$${m.op}`]: `$${m.field}` };
    }

    const resultKeys = new Set<string>([
      ...agg.metrics.map((m) => m.as),
      ...groupBy.map((g) => g.replace(/\./g, '__')),
    ]);
    const sort = this.buildSort(spec, agg.sort, resultKeys);

    // `variations.retailPrice` nằm trong MẢNG subdoc, nên `$group` nhận cả mảng
    // thay vì từng giá trị: `$sum` ra 0, `$avg` ra null, `$min`/`$max` trả về
    // chính cái mảng, và nhóm theo `variations.sku` gom theo BẢN GHI chứ không
    // theo sku. Tất cả đều HTTP 200 nên bên gọi không biết câu trả lời đã sai
    // (`QA-3`). Trải mảng ra trước khi nhóm là điều kiện để phép tính có nghĩa.
    //
    // Chỉ thêm `$unwind` khi thật sự có đường dẫn lồng: truy vấn trên trường
    // phẳng giữ nguyên pipeline cũ, từng bước một.
    const unwindRoots = new Set<string>();
    for (const path of [...groupBy, ...agg.metrics.map((m) => m.field ?? '')]) {
      if (path.includes('.')) unwindRoots.add(path.split('.')[0]);
    }

    const pipeline: PipelineStage[] = [{ $match: filter }];
    for (const root of unwindRoots) {
      // Không `preserveNullAndEmptyArrays`: bản ghi không có biến thể nào thì
      // không có giá nào để cộng — giữ lại chỉ tạo ra nhóm rỗng giả.
      pipeline.push({ $unwind: `$${root}` });
    }
    pipeline.push({ $group: groupStage as PipelineStage.Group['$group'] });
    // Trải khoá nhóm ra cấp trên cho dễ đọc; tên đã được chuẩn hoá ở `groupId`.
    if (groupBy.length) {
      const projectStage: Record<string, unknown> = { _id: 0 };
      for (const g of groupBy) {
        const alias = g.replace(/\./g, '__');
        projectStage[alias] = `$_id.${alias}`;
      }
      for (const m of agg.metrics) projectStage[m.as] = 1;
      pipeline.push({ $project: projectStage });
    } else {
      const projectStage: Record<string, unknown> = { _id: 0 };
      for (const m of agg.metrics) projectStage[m.as] = 1;
      pipeline.push({ $project: projectStage });
    }
    if (Object.keys(sort).length) pipeline.push({ $sort: sort });
    // Dư một nhóm, cùng lý do với `selectRows`: bên gọi phải phân biệt được
    // "hết nhóm" với "bị trần cắt".
    pipeline.push({ $limit: limit + 1 });

    const raw = await this.run(
      () => this.repository.aggregate({ collection: spec.key, pipeline, maxTimeMS: timeoutMs }),
      timeoutMs,
    );
    const hasMore = raw.length > limit;
    const items = hasMore ? raw.slice(0, limit) : raw;

    return { items: items.map((row) => stripDeniedDeep(row)), limitApplied: limit, hasMore };
  }

  /**
   * Bản điều kiện lọc để ghi nhật ký (BR-7, AC-14).
   *
   * Sau `API-19` KHÔNG còn trường nào bị lược: không còn trường "không đọc
   * được" để phải giấu giá trị, và bốn tên bị chặn thì không lọc được nên
   * không bao giờ tới đây. Nhật ký ghi đúng câu hỏi agent đã hỏi.
   */
  digest(_spec: AgentTableSpec, node?: unknown): unknown {
    if (node === undefined || node === null) return undefined;
    return node;
  }
}
