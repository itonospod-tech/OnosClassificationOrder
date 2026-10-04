import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type { WalletTxnKind } from 'shared';
import { WALLET_TXN_KINDS } from 'shared';

/** Tham chiếu nghiệp vụ của 1 giao dịch — label buy gắn đủ 3 id để đối soát. */
export interface WalletTxnRefs {
  /** Idempotency key lượt mua label (unique cùng customerId+kind — index dưới). */
  requestId?: string;
  shipmentId?: string;
  orderIds?: string[];
  stagingOrderId?: string;
}

/**
 * Sổ cái ví seller — APPEND-ONLY, không update/delete record. Mỗi record lưu
 * `balanceBefore → balanceAfter` (yêu cầu hiển thị tường minh cho seller).
 * MỌI biến động tiền đi qua `CustomerWalletService.applyTransaction()` (ghi sổ
 * + cập nhật cache `CustomerEntity.walletBalance` trong CÙNG transaction Mongo).
 * Plan: `documents/Plans/SellerWallet-LabelPurchase.md`.
 */
@DatabaseEntity({ collection: 'customer_wallet_transactions' })
export class CustomerWalletTransactionEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, ref: 'CustomerEntity', index: true })
  customerId: string;

  @Prop({ type: String, enum: WALLET_TXN_KINDS, required: true })
  kind: WalletTxnKind;

  /** Dương = cộng ví, âm = trừ ví (USD). */
  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  balanceBefore: number;

  @Prop({ required: true })
  balanceAfter: number;

  @Prop({ trim: true })
  note?: string;

  /** user._id nhân viên thao tác (topup/adjust/hoàn tay). */
  @Prop({ ref: 'UserEntity' })
  byUserId?: string;

  /** Snapshot tên nhân viên lúc thao tác — sổ cái không join lại user. */
  @Prop({ trim: true })
  byUserName?: string;

  @Prop({ type: Object })
  refs?: WalletTxnRefs;
}

export const CustomerWalletTransactionSchema = SchemaFactory.createForClass(CustomerWalletTransactionEntity);
CustomerWalletTransactionSchema.index({ customerId: 1, createdAt: -1 });
// All-sellers ledger (staff Billing › Transactions): newest first across every seller, optionally by kind.
CustomerWalletTransactionSchema.index({ createdAt: -1 });
CustomerWalletTransactionSchema.index({ kind: 1, createdAt: -1 });
// Idempotency tầng DB: cùng khách + cùng loại + cùng requestId chỉ ghi được 1
// lần — chặn trừ tiền đúp khi FE retry. (kind nằm trong khoá để cặp
// `label` + `label_refund` của CÙNG lượt mua không đụng nhau.)
CustomerWalletTransactionSchema.index(
  { customerId: 1, kind: 1, 'refs.requestId': 1 },
  { unique: true, partialFilterExpression: { 'refs.requestId': { $exists: true } } },
);

export type CustomerWalletTransactionDocument = HydratedDocument<CustomerWalletTransactionEntity>;
