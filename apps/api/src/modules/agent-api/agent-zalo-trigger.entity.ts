import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';

/**
 * Sự kiện Zalo đã LỌC, chờ agent xử lý.
 *
 * Vì sao lưu lại thay vì đẩy webhook rồi quên: bên nhận có lúc sập, và sự kiện
 * "Chủ tịch vừa hỏi trong nhóm" mà rơi mất thì không có cách nào biết là đã rơi.
 * Lưu lại cho phép vừa đẩy vừa cho poll lại từ con trỏ — đúng hai lựa chọn (A)
 * và (B) mà bên agent hỏi, bằng một kho duy nhất chứ không hai đường dữ liệu.
 *
 * Giữ 14 ngày: quá mốc đó thì một tin nhắn nhóm không còn hành động được nữa,
 * và đây là bản sao nội dung chat — giữ càng lâu càng nhiều thứ phải canh.
 */
@DatabaseEntity({ collection: 'agentZaloTriggers' })
export class AgentZaloTriggerEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, index: true })
  reason: string;

  @Prop({ required: true, index: true })
  groupGlobalId: string;

  /** Id bản ghi phía engine — chỉ để tra ngược, KHÔNG phải khoá chống trùng. */
  @Prop({ required: true, index: true })
  messageId: string;

  /**
   * Khoá chống trùng THẬT: `<groupGlobalId>:<zaloMsgId>`.
   *
   * Không khoá theo `messageId` được: engine lưu một bản cho mỗi nick công ty
   * trong nhóm, nên một câu nói thật ra 2–7 bản ghi với 2–7 id khác nhau (đo 7
   * ngày: 26.034 dòng = 12.189 tin thật). Khoá sai ở đây nghĩa là agent bị gọi
   * dậy nhiều lần cho cùng một câu — và mỗi lần nó sẽ trả lời lại.
   */
  @Prop({ required: true, unique: true })
  khoaChongTrung: string;

  @Prop({ type: Object, required: true })
  message: Record<string, unknown>;

  @Prop({ default: false })
  forwarded: boolean;

  @Prop()
  forwardError?: string;

  @Prop({ required: true, default: () => new Date() })
  receivedAt: Date;
}

export const AgentZaloTriggerSchema = SchemaFactory.createForClass(AgentZaloTriggerEntity);
AgentZaloTriggerSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

export type AgentZaloTriggerDocument = HydratedDocument<AgentZaloTriggerEntity>;
