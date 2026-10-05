import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';
import type { WalletTxnKind } from 'shared';
import { WALLET_TXN_KINDS } from 'shared';

/** Tham chiếu nghiệp vụ của 1 giao dịch — label buy gắn đủ 3 id để đối soát. */
export interface WalletTxnRefs {
  /** Idempotency key lượt mua label (unique cùng customerId+kind — index dưới). */
  requestId?: string;
  /** Top-up only. Normalised (see `normalizeExternalTxnId`); unique across all top-ups. */
  externalTxnId?: string;
  /** Top-up only. http(s) link to the proof of payment. */
  attachmentUrl?: string;
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
// Money-safety indexes. They are created EXPLICITLY at boot (`CustomerWalletService.ensureIndexes`)
// as well as declared here: autoIndex builds in the background and swallows errors, and a missing
// index would silently re-open a double-credit/double-charge hole.
//
// Idempotency at the DB level: the same seller + kind + requestId can be written once, so a retry
// from the client cannot charge twice. (`kind` is part of the key so the `label` + `label_refund`
// pair of ONE purchase do not collide.) No custom name on purpose: it must keep the default name
// of the index autoIndex has already built in existing databases.
export const WALLET_TXN_REQUEST_ID_INDEX = {
  keys: { customerId: 1, kind: 1, 'refs.requestId': 1 },
  options: { unique: true, partialFilterExpression: { 'refs.requestId': { $exists: true } } },
} as const;
CustomerWalletTransactionSchema.index(WALLET_TXN_REQUEST_ID_INDEX.keys, WALLET_TXN_REQUEST_ID_INDEX.options);

// A bank/payment reference can be credited ONCE, whichever seller or staff member enters it. Catches
// what requestId cannot: two staff members, two tabs, two different requestIds for the same bank line.
export const WALLET_TXN_EXTERNAL_TXN_ID_INDEX = {
  keys: { 'refs.externalTxnId': 1 },
  options: {
    name: 'topup_externalTxnId_unique',
    unique: true,
    partialFilterExpression: { kind: 'topup', 'refs.externalTxnId': { $type: 'string' } },
  },
} as const;
CustomerWalletTransactionSchema.index(
  WALLET_TXN_EXTERNAL_TXN_ID_INDEX.keys,
  WALLET_TXN_EXTERNAL_TXN_ID_INDEX.options,
);

export type CustomerWalletTransactionDocument = HydratedDocument<CustomerWalletTransactionEntity>;
