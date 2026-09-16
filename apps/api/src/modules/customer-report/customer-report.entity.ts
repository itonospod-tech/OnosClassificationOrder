import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';

/**
 * Báo cáo khách hàng cho một kỳ (`customer_reports`) — song song `ceo_reports`.
 * Mỗi lần sinh là MỘT bản ghi mới (giữ lịch sử); bản dùng = mới nhất theo `periodKey`.
 */
@DatabaseEntity({ collection: 'customer_reports' })
export class CustomerReportEntity extends DatabaseEntityAbstract {
  /** `${from}_${to}` — tra KHỚP CHÍNH XÁC, giống `ceo-report`. */
  @Prop({ required: true, index: true })
  periodKey: string;

  @Prop({ required: true }) from: string;
  @Prop({ required: true }) to: string;
  @Prop({ required: true }) kind: string;
  @Prop({ required: true }) summary: string;
  @Prop({ type: Object, required: true }) metrics: Record<string, unknown>;
  @Prop({ type: [Object], default: [] }) topCustomers: unknown[];
  @Prop({ type: [Object], default: [] }) surging: unknown[];
  @Prop({ type: [Object], default: [] }) declining: unknown[];
  @Prop({ type: [Object], default: [] }) newCustomers: unknown[];
  @Prop({ type: [Object], default: [] }) customerIssues: unknown[];
  @Prop({ type: [String], default: [] }) conclusions: string[];
  @Prop({ type: [String], default: [] }) actionItems: string[];
  @Prop({ type: [Object], default: [] }) findings: unknown[];
  @Prop({ required: true, index: true }) generatedAt: Date;
  @Prop({ required: true }) trigger: string;
}

export const CustomerReportSchema = SchemaFactory.createForClass(CustomerReportEntity);
export type CustomerReportDocument = HydratedDocument<CustomerReportEntity>;
