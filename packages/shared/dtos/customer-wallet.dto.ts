import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ResZod } from '@shared/types';
import { z } from 'zod';

import { IDZod } from '..';
import {
  normalizeExternalTxnId,
  previewWalletOperation,
  requiresStatementCheck,
  WALLET_BIG_AMOUNT_USD,
  WALLET_TXN_KINDS,
  type WalletOperationMode,
  type WalletOperationPreview,
  type WalletTxnKind,
} from '../client';

/**
 * Ví seller (USD) — ví TỔNG đa mục đích: hôm nay trừ tiền mua label, sau này
 * trừ tiền đơn hàng (`kind='order'` chừa sẵn — phase này push vẫn ghi
 * `customer_payments` `waived`, KHÔNG đụng ví) + các chi phí mở rộng.
 * Sổ cái append-only `customer_wallet_transactions`, MỖI record lưu
 * `balanceBefore → balanceAfter` (yêu cầu hiển thị tường minh cho seller).
 * Cho nợ có hạn mức: `creditLimit` từng seller (mặc định 0), số dư được
 * xuống tới `-creditLimit`.
 * Plan: `documents/Plans/SellerWallet-LabelPurchase.md`.
 */
// Hằng runtime nest-free — dời sang `client/wallet.ts` (apps/seller cần render badge/filter).
export { WALLET_TXN_KINDS, type WalletTxnKind };
export { normalizeExternalTxnId, previewWalletOperation, requiresStatementCheck, WALLET_BIG_AMOUNT_USD };
export type { WalletOperationMode, WalletOperationPreview };
export const WalletTxnKindZod = z.enum(WALLET_TXN_KINDS);

export const CustomerWalletTxnZod = z.object({
  _id: IDZod,
  customerId: IDZod,
  kind: WalletTxnKindZod,
  /** Dương = cộng ví, âm = trừ ví (USD). */
  amount: z.number(),
  balanceBefore: z.number(),
  balanceAfter: z.number(),
  note: z.string().optional(),
  /** user._id nhân viên thao tác (topup/adjust/hoàn tay). */
  byUserId: z.string().optional(),
  byUserName: z.string().optional(),
  /** Tham chiếu nghiệp vụ — label: shipmentId + requestId + orderIds. */
  refs: z
    .object({
      requestId: z.string().optional(),
      shipmentId: z.string().optional(),
      orderIds: z.string().array().optional(),
      stagingOrderId: z.string().optional(),
      /** Top-up: the bank/payment reference the money arrived under (normalised: trimmed, upper-case, no spaces). */
      externalTxnId: z.string().optional(),
      /** Top-up: link to the proof of payment (http/https only). */
      attachmentUrl: z.string().optional(),
    })
    .optional(),
  createdAt: z.coerce.date().optional(),
});
export type CustomerWalletTxn = z.infer<typeof CustomerWalletTxnZod>;

// ---------------------------------------------------------------------------
// Seller (`customer/wallet*`)
// ---------------------------------------------------------------------------

export const CustomerWalletZod = z.object({
  balance: z.number(),
  creditLimit: z.number(),
  currency: z.literal('USD'),
});
export type CustomerWallet = z.infer<typeof CustomerWalletZod>;

export const GetCustomerWalletResZod = ResZod.extend({ data: CustomerWalletZod });
export class GetCustomerWalletResDto extends createZodDto(extendApi(GetCustomerWalletResZod)) {}

export const GetCustomerWalletTxnsZod = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  kind: WalletTxnKindZod.optional(),
});
export class GetCustomerWalletTxnsDto extends createZodDto(extendApi(GetCustomerWalletTxnsZod)) {}

export const GetCustomerWalletTxnsResZod = ResZod.extend({
  data: CustomerWalletTxnZod.array(),
  total: z.number(),
});
export class GetCustomerWalletTxnsResDto extends createZodDto(extendApi(GetCustomerWalletTxnsResZod)) {}

// ---------------------------------------------------------------------------
// Admin (`admin/customer-wallets*` — hub, @Auth([Admin]))
// ---------------------------------------------------------------------------

export const GetAdminWalletsZod = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** true = chỉ seller có số dư ≠ 0 hoặc đã từng có giao dịch. */
  activeOnly: z.coerce.boolean().optional(),
});
export class GetAdminWalletsDto extends createZodDto(extendApi(GetAdminWalletsZod)) {}

export const AdminWalletRowZod = z.object({
  customerId: IDZod,
  userSku: z.string(),
  userEmail: z.string(),
  fullName: z.string().optional(),
  tier: z.number().nullish(),
  balance: z.number(),
  creditLimit: z.number(),
  lastTxnAt: z.coerce.date().nullish(),
});
export type AdminWalletRow = z.infer<typeof AdminWalletRowZod>;

/** One seller's wallet row — same shape as a row of the list, fetched fresh (never from a stale page). */
export const GetAdminWalletResZod = ResZod.extend({ data: AdminWalletRowZod });
export class GetAdminWalletResDto extends createZodDto(extendApi(GetAdminWalletResZod)) {}

export const GetAdminWalletsResZod = ResZod.extend({ data: AdminWalletRowZod.array(), total: z.number() });
export class GetAdminWalletsResDto extends createZodDto(extendApi(GetAdminWalletsResZod)) {}

/** All sellers' ledger — staff Billing › Transactions (`GET admin/customer-wallets/transactions`). */
const YmdZod = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const GetAdminWalletTxnsZod = z.object({
  customerId: z.string().optional(),
  /** Matches seller userSku / userEmail / fullName. */
  search: z.string().optional(),
  kind: WalletTxnKindZod.optional(),
  /** Inclusive day range, interpreted in Vietnam time (UTC+7). */
  from: YmdZod.optional(),
  to: YmdZod.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export class GetAdminWalletTxnsDto extends createZodDto(extendApi(GetAdminWalletTxnsZod)) {}

export const AdminWalletTxnRowZod = CustomerWalletTxnZod.extend({
  userSku: z.string(),
  userEmail: z.string(),
  fullName: z.string().optional(),
  /** productionIds of the orders in `refs.orderIds` (those hold order _ids, which mean nothing to staff). */
  productionIds: z.string().array(),
});
export type AdminWalletTxnRow = z.infer<typeof AdminWalletTxnRowZod>;

export const GetAdminWalletTxnsResZod = ResZod.extend({ data: AdminWalletTxnRowZod.array(), total: z.number() });
export class GetAdminWalletTxnsResDto extends createZodDto(extendApi(GetAdminWalletTxnsResZod)) {}

/**
 * Idempotency key of ONE staff money operation. The client generates it once when the dialog opens and
 * resends the same value on every retry, so a double click or a retry after a timeout cannot apply twice.
 */
export const WalletRequestIdZod = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'requestId may only contain letters, digits, "-" and "_"');

/** Nạp ví tay — phase 1 seller chuyển khoản ngoài hệ thống, admin cộng + ghi chú. */
export const TopupWalletZod = z.object({
  requestId: WalletRequestIdZod,
  amount: z.number().positive().max(1_000_000),
  note: z.string().min(1).max(500),
  /** Bank / payment reference. A reference can be credited only once across all sellers. */
  externalTxnId: z.string().trim().min(1).max(100).optional(),
  /** Proof of payment. Link only for now; uploading a file is a later phase. */
  attachmentUrl: z
    .string()
    .trim()
    .max(2000)
    .url()
    // `url()` accepts javascript:/data: — this value is rendered as a link, so allow web links only.
    .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed')
    .optional(),
});
export class TopupWalletDto extends createZodDto(extendApi(TopupWalletZod)) {}

/** Điều chỉnh tay (+/−) — hoàn tiền hủy label, sửa sai sót... Bắt buộc note. */
export const AdjustWalletZod = z.object({
  requestId: WalletRequestIdZod,
  amount: z
    .number()
    .max(1_000_000)
    .min(-1_000_000)
    .refine((v) => v !== 0, 'amount phải khác 0'),
  note: z.string().min(1).max(500),
});
export class AdjustWalletDto extends createZodDto(extendApi(AdjustWalletZod)) {}

export const UpdateCreditLimitZod = z.object({
  creditLimit: z.number().min(0).max(1_000_000),
  /** Why the limit changes. Optional here so older callers keep working; the staff dialog requires it. */
  note: z.string().trim().max(500).optional(),
});
export class UpdateCreditLimitDto extends createZodDto(extendApi(UpdateCreditLimitZod)) {}

/** One row of the credit-limit audit trail (`customer_credit_limit_changes`). */
export const CreditLimitChangeZod = z.object({
  _id: IDZod,
  customerId: IDZod,
  from: z.number(),
  to: z.number(),
  note: z.string().optional(),
  byUserId: z.string().optional(),
  byUserName: z.string().optional(),
  createdAt: z.coerce.date().optional(),
});
export type CreditLimitChange = z.infer<typeof CreditLimitChangeZod>;

export const GetCreditLimitHistoryZod = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export class GetCreditLimitHistoryDto extends createZodDto(extendApi(GetCreditLimitHistoryZod)) {}

export const GetCreditLimitHistoryResZod = ResZod.extend({ data: CreditLimitChangeZod.array(), total: z.number() });
export class GetCreditLimitHistoryResDto extends createZodDto(extendApi(GetCreditLimitHistoryResZod)) {}

export const WalletMutationResZod = ResZod.extend({
  data: z.object({
    balance: z.number(),
    creditLimit: z.number(),
    txn: CustomerWalletTxnZod.optional(),
    /** True when the same `requestId` had already been applied: nothing was written this time. */
    replayed: z.boolean().optional(),
  }),
});
export class WalletMutationResDto extends createZodDto(extendApi(WalletMutationResZod)) {}
