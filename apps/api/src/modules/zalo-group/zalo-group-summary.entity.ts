import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type { ZaloSummaryLevel, ZaloSummaryTask } from 'shared';
import { ZALO_GROUP_KINDS, ZALO_SUMMARY_LEVELS, ZaloGroupKind, ZaloSummaryLevel as Level } from 'shared';

/**
 * Tóm tắt tình hình một nhóm Zalo do mô hình sinh.
 *
 * Mục tiêu là theo dõi CHẤT LƯỢNG XỬ LÝ của đội ngũ, không phải lưu lại nội
 * dung chat — nên mọi ô đều là kết luận ngắn, không chứa trích đoạn hội thoại.
 *
 * 🔴 CHỈ tóm tắt nhóm đã phân loại `seller` hoặc `operation`
 * (`ZALO_GROUP_ANALYZABLE_KINDS`). Dữ liệu Zalo lẫn nhóm riêng tư của nhân
 * viên; đưa chúng vào mô hình là đọc đời tư. Chốt này nằm ở service, và bảng
 * này chỉ có bản ghi cho nhóm đã qua chốt đó.
 */
@DatabaseEntity({ collection: 'zalo_group_summaries' })
export class ZaloGroupSummaryEntity extends DatabaseEntityAbstract {
  /** Một nhóm có đúng một bản tóm tắt hiện hành — cập nhật đè, không đẻ dòng mới. */
  @Prop({ required: true, unique: true, index: true, trim: true })
  groupGlobalId: string;

  @Prop({ ref: 'CustomerEntity', index: true })
  customerId?: string;

  @Prop({ trim: true, index: true })
  userSku?: string;

  @Prop({ trim: true })
  title?: string;

  /** Một dòng để liếc bảng là hiểu, khỏi phải mở chi tiết. */
  @Prop({ trim: true })
  tieuDe?: string;

  @Prop({ trim: true })
  khachQuanTam?: string;

  @Prop({ trim: true })
  salePhanHoi?: string;

  @Prop({ trim: true })
  tonDong?: string;

  /**
   * Việc cần làm ở dạng danh sách. `xong` do NGƯỜI tick — mô hình không được
   * tự đặt; lượt tóm tắt sau giữ lại trạng thái tick của việc trùng nội dung.
   */
  @Prop({
    type: [{ id: String, viec: String, xong: Boolean, taoLuc: String, xongLuc: String }],
    default: [],
  })
  checklist: ZaloSummaryTask[];

  /**
   * Số lần `checklist` đổi (tick hoặc tóm tắt). Lượt tóm tắt ghi có điều kiện
   * theo số này: người tick trong lúc mô hình chạy 40–150 giây thì không bị
   * lượt tóm tắt ghi đè mất tick.
   */
  @Prop({ default: 0 })
  checklistRev: number;

  /**
   * Việc đã tick xong nhưng mô hình không thấy bằng chứng trong hội thoại.
   * Thiếu ô này thì việc tick khống bị nuốt mất — tệ hơn cả không có nút tick.
   */
  @Prop({ type: [String], default: [] })
  nghiNgo: string[];

  @Prop({ type: String, enum: ZALO_SUMMARY_LEVELS, default: Level.BinhThuong, index: true })
  mucDo: ZaloSummaryLevel;

  /**
   * Loại nhóm LÚC TÓM TẮT — UI đổi nhãn ô theo nó ("Bên yêu cầu"/"Người xử lý"
   * cho nhóm vận hành). Optional: bản cũ chưa có thì dùng nhãn khách.
   */
  @Prop({ type: String, enum: ZALO_GROUP_KINDS })
  kind?: ZaloGroupKind;

  /** Mốc tin nhắn cuối đã tóm tắt — biết bản này còn mới không, và lượt sau lấy từ đâu. */
  @Prop({ index: true })
  denMocTin?: Date;

  @Prop({ default: 0 })
  soTin: number;

  /**
   * Lần gần nhất đọc lại TỪ ĐẦU. Tóm tắt cuốn chiếu có bệnh trôi dần — một kết
   * luận sai được chép lại mãi qua từng lượt — nên định kỳ phải cắt đứt bằng
   * một lượt đọc thẳng tin nhắn.
   */
  @Prop()
  docDayDuLuc?: Date;

  @Prop({ trim: true })
  model?: string;

  @Prop({ index: true })
  tomTatLuc?: Date;

  /**
   * Lần summarizer XÉT nhóm này gần nhất — ghi mỗi lượt quét kể cả khi không
   * sinh bản tóm tắt mới. Tách khỏi `tomTatLuc` để người đọc phân biệt được
   * "hệ không chạy" với "hệ có chạy nhưng cố ý bỏ qua".
   */
  @Prop({ index: true })
  lanChayCuoi?: Date;

  /**
   * Vì sao lượt quét gần nhất KHÔNG tóm tắt lại nhóm này (`null` = có tóm tắt).
   * `chua-co-tin` · `nhom-im-lau` · `khong-co-tin-moi` — xem `phanLoaiHangDoi`.
   */
  @Prop({ trim: true })
  lyDoBoQua?: string;
}

export const ZaloGroupSummarySchema = SchemaFactory.createForClass(ZaloGroupSummaryEntity);

// Bảng theo dõi: nhóm gấp lên đầu, trong cùng mức thì nhóm mới tóm tắt trước.
ZaloGroupSummarySchema.index({ mucDo: 1, tomTatLuc: -1 });

export type ZaloGroupSummaryDocument = HydratedDocument<ZaloGroupSummaryEntity>;
