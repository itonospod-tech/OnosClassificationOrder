/**
 * Ví seller — hằng runtime nest-free cho app browser (`apps/seller` render
 * filter/badge loại giao dịch). Schema/DTO đầy đủ ở `dtos/customer-wallet.dto.ts`
 * (re-export lại từ đây).
 */
export const WALLET_TXN_KINDS = [
  /** Admin nạp tay (seller chuyển khoản ngoài hệ thống — phase 1). */
  'topup',
  /** Trừ tiền mua label (giá bảng seller, KHÔNG phải giá VNP). */
  'label',
  /** Hoàn tự động khi VNP mua lỗi, hoặc admin hoàn tay sau khi hủy label. */
  'label_refund',
  /** Tiền đơn hàng — CHƯA dùng, chừa cho lúc bật gate thu tiền push. */
  'order',
  /** Admin điều chỉnh tay (+/−, bắt buộc ghi chú). */
  'adjust',
  // The three kinds below are DECLARED ONLY: nothing writes them yet. They mirror the legacy
  // OnosPod ledger (money plan LegacyClone-Money.md §5.3 #5) and are written by the order-charging
  // engine (#3), which is still closed. Adding a kind here also needs a label in all four i18n
  // files (`wallet-kinds-i18n.spec.ts` checks) and a colour in apps/seller `KIND_COLORS`.
  /** Import US tax + customs fee, charged per item when an order is paid. */
  'import_tax',
  /** Tracking activation fee (USPS activation, ~$0.70 per tracking in the legacy system). */
  'active',
  /** Refund of an order payment (not a label refund — that is `label_refund`). */
  'refund',
] as const;
export type WalletTxnKind = (typeof WALLET_TXN_KINDS)[number];

/**
 * A staff money operation of this size or more must be confirmed against the bank statement / supporting
 * documents (the dialog will not enable its button until the box is ticked). It slows the click down at
 * exactly the point where a typo costs the most; the API's own cap is deliberately left higher so a large,
 * legitimate top-up is still possible.
 */
export const WALLET_BIG_AMOUNT_USD = 1000;

export const requiresStatementCheck = (amount: number): boolean => Math.abs(amount) >= WALLET_BIG_AMOUNT_USD;

export type WalletOperationMode = 'topup' | 'adjust' | 'credit';

export interface WalletOperationPreview {
  balanceBefore: number;
  balanceAfter: number;
  creditLimitBefore: number;
  creditLimitAfter: number;
  /** What the seller may still spend after the operation: balance + credit limit. */
  availableAfter: number;
  /** The seller would end up below their limit (possible after LOWERING a limit under an existing debt). */
  overLimitAfter: boolean;
  /**
   * The API would refuse this: a debit that takes the balance below `-creditLimit`. Mirrors
   * `checkWalletGuard` in the API (credits are always allowed), and a spec keeps the two in step.
   */
  blocked: boolean;
}

const cents = (v: number): number => Math.round(v * 100) / 100;

/**
 * What a staff operation would do to a wallet — shown on the confirmation step so the person sees
 * "balance before → after" before anything is written. For `credit`, `amount` is the NEW limit.
 */
export function previewWalletOperation(
  wallet: { balance: number; creditLimit: number },
  mode: WalletOperationMode,
  amount: number,
): WalletOperationPreview {
  const balanceBefore = cents(wallet.balance);
  const creditLimitBefore = wallet.creditLimit;
  if (mode === 'credit') {
    return {
      balanceBefore,
      balanceAfter: balanceBefore,
      creditLimitBefore,
      creditLimitAfter: amount,
      availableAfter: cents(balanceBefore + amount),
      overLimitAfter: balanceBefore < -amount,
      blocked: false,
    };
  }
  const balanceAfter = cents(balanceBefore + amount);
  return {
    balanceBefore,
    balanceAfter,
    creditLimitBefore,
    creditLimitAfter: creditLimitBefore,
    availableAfter: cents(balanceAfter + creditLimitBefore),
    overLimitAfter: balanceAfter < -creditLimitBefore,
    blocked: amount < 0 && balanceAfter < -creditLimitBefore,
  };
}
