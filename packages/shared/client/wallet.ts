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
