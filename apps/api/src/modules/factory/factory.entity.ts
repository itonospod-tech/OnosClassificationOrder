import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { assertSameType, DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type { Factory } from 'shared';
import { FACTORY_FLOW_TYPES, FactoryFlowType } from 'shared';

@DatabaseEntity({ collection: 'factories' })
export class FactoryEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, uppercase: true, unique: true, index: true })
  shortName: string;

  @Prop({ required: true, default: true })
  isActive: boolean;

  /**
   * Luồng fulfillment của xưởng. `merged` = luồng rút gọn (xưởng gỗ): In xong
   * → Ép tự xong → QC; May vào xong → May ra tự xong → Đóng hàng. Xưởng cũ
   * trong DB thiếu field này → coi như `standard` (cache merged-flow chỉ nhặt
   * đúng giá trị 'merged').
   */
  @Prop({ type: String, required: true, default: FactoryFlowType.Standard, enum: FACTORY_FLOW_TYPES })
  flowType: FactoryFlowType;

  /**
   * Toggle ĐỘC LẬP với flowType: bật → đơn chảy tới công đoạn ĐÓNG HÀNG tự
   * hoàn thành luôn (fulfillmentCompletedAt + production_completed như đóng
   * tay). Đơn đang tồn ở Đóng hàng KHÔNG tự xong — dùng nút "Hoàn thành đơn
   * tồn". Cache sync: `merged-flow-factory.ts` (`getFactoryAutoPackSync`).
   */
  @Prop({ required: true, default: false })
  autoCompletePack: boolean;

  /**
   * Bỏ qua SOÁT TOOL (xưởng DTF Mê Linh): đơn MỚI import/push vào xưởng được
   * stamp `toolResultNote='ok'` + `toolCheckedAt` + vào thẳng cột In ngay tại
   * `importOrders` ($setOnInsert — đơn đang chạy không bị đụng). Cache sync:
   * `merged-flow-factory.ts` (`getFactorySkipToolCheckSync`).
   */
  @Prop({ required: true, default: false })
  skipToolCheck: boolean;
}

assertSameType<Factory, FactoryEntity>();
assertSameType<FactoryEntity, Factory>();

export const FactorySchema = SchemaFactory.createForClass(FactoryEntity);
export type FactoryDocument = HydratedDocument<FactoryEntity>;
