import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DatabaseRepositoryAbstract } from 'core';
import { Model, Types } from 'mongoose';

import type { CustomerDocument } from './customer.entity';
import { CustomerEntity } from './customer.entity';

export type CustomerMatchRow = { _id: string; userSku: string; userEmail: string };

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

@Injectable()
export class CustomerRepository extends DatabaseRepositoryAbstract<CustomerEntity, CustomerDocument> {
  constructor(@InjectModel(CustomerEntity.name) private readonly customerModel: Model<CustomerEntity>) {
    super(customerModel);
  }

  /**
   * Tra khách (chưa xoá) theo danh sách id lưu trong các config blob (gán xưởng /
   * ưu tiên / designer). Khách tạo qua `customers/sync` (bulkWrite upsert) có
   * `_id` kiểu ObjectId trong DB, còn schema khai `_id: String` → query qua
   * Mongoose ép về chuỗi và không bao giờ khớp. Đi thẳng collection, khớp cả
   * dạng chuỗi lẫn ObjectId; `_id` trả về luôn là chuỗi (đúng dạng config lưu).
   */
  async findMatchRowsByIds(ids: string[]): Promise<CustomerMatchRow[]> {
    const strIds = Array.from(new Set(ids.map(String)));
    if (strIds.length === 0) return [];
    const objIds = strIds.filter((id) => OBJECT_ID_HEX.test(id)).map((id) => new Types.ObjectId(id));
    const docs = await this.customerModel.collection
      .find({ _id: { $in: [...strIds, ...objIds] }, deletedAt: { $exists: false } } as never, {
        projection: { userSku: 1, userEmail: 1 },
      })
      .toArray();
    return docs.map((d) => ({
      _id: String(d._id),
      userSku: (d.userSku as string) ?? '',
      userEmail: (d.userEmail as string) ?? '',
    }));
  }
}
