import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ResZod } from '@shared/types';
import { z } from 'zod';

import { IDZod } from '..';
import { WALLET_TXN_KINDS, type WalletTxnKind } from '../client';

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

export const GetAdminWalletsResZod = ResZod.extend({ data: AdminWalletRowZod.array(), total: z.number() });
export class GetAdminWalletsResDto extends createZodDto(extendApi(GetAdminWalletsResZod)) {}

/** Nạp ví tay — phase 1 seller chuyển khoản ngoài hệ thống, admin cộng + ghi chú. */
export const TopupWalletZod = z.object({
  amount: z.number().positive().max(1_000_000),
  note: z.string().min(1).max(500),
});
export class TopupWalletDto extends createZodDto(extendApi(TopupWalletZod)) {}

/** Điều chỉnh tay (+/−) — hoàn tiền hủy label, sửa sai sót... Bắt buộc note. */
export const AdjustWalletZod = z.object({
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
});
export class UpdateCreditLimitDto extends createZodDto(extendApi(UpdateCreditLimitZod)) {}

export const WalletMutationResZod = ResZod.extend({
  data: z.object({ balance: z.number(), creditLimit: z.number(), txn: CustomerWalletTxnZod.optional() }),
});
export class WalletMutationResDto extends createZodDto(extendApi(WalletMutationResZod)) {}
