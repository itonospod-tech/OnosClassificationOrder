import { roundCents } from 'shared';

/**
 * Luật kiểm số dư ví — hàm THUẦN tách khỏi service để test không cần DB.
 * Số dư được xuống tới `-creditLimit` (hạn mức nợ admin cấp, mặc định 0).
 */
export interface WalletGuardResult {
  ok: boolean;
  balanceBefore: number;
  balanceAfter: number;
}

export function checkWalletGuard(balance: number | undefined, creditLimit: number | undefined, amount: number): WalletGuardResult {
  const balanceBefore = round2(balance ?? 0);
  const balanceAfter = round2(balanceBefore + amount);
  // Chỉ chặn khi TRỪ tiền — cộng tiền (topup/hoàn) luôn cho, kể cả đang âm.
  const ok = amount >= 0 || balanceAfter >= -(creditLimit ?? 0);
  return { ok, balanceBefore, balanceAfter };
}

/**
 * Tiền USD làm tròn 2 chữ số — tránh rác floating point tích lũy trong sổ. CHÍNH LÀ `roundCents` của shared
 * (một nguồn duy nhất, dialog nhân viên dùng cùng hàm để so ngưỡng xác nhận sao kê).
 */
export const round2 = roundCents;
