import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getModelToken, InjectConnection } from '@nestjs/mongoose';
import type { Connection, Model, PipelineStage } from 'mongoose';

import { AgentApiLogEntity } from './agent-audit.entity';
import { AGENT_DENY_FIELD_NAMES } from './registry';

type Row = Record<string, unknown>;

/**
 * Tầng truy cập dữ liệu DUY NHẤT của bộ API agent (`API-1`, mở hết ở `API-19`).
 *
 * Trước `API-19` lớp này tra **model** theo `entityName` — nên nó chỉ với tới
 * được 11 bảng đã bind vào module. Nay bề mặt là **mọi collection**, kể cả
 * collection thêm vào sau này và collection không có entity nào khai báo, nên
 * nó đọc thẳng qua `Connection`. Đổi được an toàn vì toàn repo dùng `_id` kiểu
 * **chuỗi** (`DatabaseEntityAbstract` sinh nanoid), không phải `ObjectId`: mất
 * lớp ép kiểu của mongoose không làm hỏng việc tra theo id hay phân trang theo
 * con trỏ. Ngày nào có collection dùng `ObjectId` thì lọc theo `_id` trên
 * collection đó sẽ không khớp — đó là giới hạn đã biết, ghi ở `AgentApi.md`.
 *
 * Lớp này **chỉ phơi ra thao tác ĐỌC cộng một thao tác ghi nhật ký**: không
 * service nào của module chạm được `insertOne`/`updateOne`/`deleteOne`, nên
 * BR-3 (chỉ đọc) được giữ bằng chính hình dạng của lớp, không phải bằng kỷ
 * luật của người viết. Đây là điều KHÔNG đổi ở `API-19`.
 *
 * Mọi lời gọi đều mang `maxTimeMS` và `readPreference: 'secondaryPreferred'`
 * — tải đọc của agent rơi vào secondary, không vào primary đang phục vụ sản
 * xuất (BR-6, AC-15).
 */
@Injectable()
export class AgentApiRepository {
  constructor(
    private readonly moduleRef: ModuleRef,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * `$project` loại trừ bốn tên bị chặn, áp ở CẤP MỘT cho mọi truy vấn không
   * xin trường cụ thể. Nhánh lồng sâu do `stripDeniedDeep()` quét tiếp — hai
   * lớp vì lớp này rẻ (không đọc lên khỏi DB) còn lớp kia mới phủ hết.
   */
  private static readonly DENY_PROJECTION: Record<string, 0> = Object.fromEntries(
    AGENT_DENY_FIELD_NAMES.map((name) => [name, 0 as const]),
  );

  private model(entityName: string): Model<unknown> {
    return this.moduleRef.get<Model<unknown>>(getModelToken(entityName), { strict: false });
  }

  /** Tên mọi collection đang có, bỏ nhóm `system.*` của chính MongoDB. */
  async listCollections(): Promise<string[]> {
    const infos = await this.connection.db.listCollections({}, { nameOnly: true }).toArray();
    return infos
      .map((info) => info.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();
  }

  async find(args: {
    collection: string;
    filter: Record<string, unknown>;
    projection: Record<string, 1>;
    sort: Record<string, 1 | -1>;
    skip: number;
    limit: number;
    maxTimeMS: number;
  }): Promise<Row[]> {
    // Xin trường cụ thể → chiếu đúng thứ đã xin (tên bị chặn đã bị từ chối từ
    // tầng trên). Không xin gì → lấy nguyên bản ghi TRỪ bốn tên bị chặn.
    const projection = Object.keys(args.projection).length
      ? args.projection
      : AgentApiRepository.DENY_PROJECTION;

    return (await this.connection
      .collection(args.collection)
      .find(args.filter, {
        projection,
        sort: args.sort,
        skip: args.skip,
        limit: args.limit,
        maxTimeMS: args.maxTimeMS,
        readPreference: 'secondaryPreferred',
      })
      .toArray()) as Row[];
  }

  /**
   * Đếm số dòng khớp bộ lọc — chỉ gọi khi bên gọi xin `select.withTotal`.
   *
   * Cùng `maxTimeMS` và cùng `secondaryPreferred` với `find()`: một phép đếm
   * trên bảng lớn vẫn là một lần quét, không được phép chạy lâu hơn hay đè lên
   * primary chỉ vì nó "chỉ đếm".
   */
  async count(args: { collection: string; filter: Record<string, unknown>; maxTimeMS: number }): Promise<number> {
    return this.connection.collection(args.collection).countDocuments(args.filter, {
      maxTimeMS: args.maxTimeMS,
      readPreference: 'secondaryPreferred',
    });
  }

  async aggregate(args: { collection: string; pipeline: PipelineStage[]; maxTimeMS: number }): Promise<Row[]> {
    return (await this.connection
      .collection(args.collection)
      .aggregate(args.pipeline as unknown as Record<string, unknown>[], {
        maxTimeMS: args.maxTimeMS,
        readPreference: 'secondaryPreferred',
      })
      .toArray()) as Row[];
  }

  async insertLog(doc: Record<string, unknown>): Promise<void> {
    await this.model(AgentApiLogEntity.name).create(doc);
  }

  async ensureLogTtlIndex(expireAfterSeconds: number): Promise<void> {
    await this.model(AgentApiLogEntity.name).collection.createIndex({ at: 1 }, { expireAfterSeconds });
  }
}
