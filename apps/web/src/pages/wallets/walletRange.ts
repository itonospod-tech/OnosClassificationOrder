export const WALLET_RANGES = ['today', 'yesterday', '7d', 'month', 'lastMonth', 'all'] as const;
export type WalletRange = (typeof WALLET_RANGES)[number];

/** What the page shows when the URL carries neither a `range` nor an explicit `from`/`to`. */
export const DEFAULT_WALLET_RANGE: WalletRange = '7d';

export const isWalletRange = (value: string | null): value is WalletRange =>
  !!value && (WALLET_RANGES as readonly string[]).includes(value);

// The API reads days as Vietnam time (UTC+7), so "today" must be Vietnam's today whatever the browser's zone is.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const toYmd = (date: Date) => date.toISOString().slice(0, 10);
const shiftDays = (ymd: string, days: number) => toYmd(new Date(new Date(`${ymd}T00:00:00Z`).getTime() + days * 86_400_000));

/** Inclusive `from`/`to` (YYYY-MM-DD, Vietnam time) for a preset; both undefined for `all`. */
export function resolveWalletRange(range: WalletRange, now: Date = new Date()): { from?: string; to?: string } {
  const today = toYmd(new Date(now.getTime() + VN_OFFSET_MS));
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = shiftDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case '7d':
      return { from: shiftDays(today, -6), to: today };
    case 'month':
      return { from: monthStart, to: today };
    case 'lastMonth':
      return { from: `${shiftDays(monthStart, -1).slice(0, 7)}-01`, to: shiftDays(monthStart, -1) };
    case 'all':
      return {};
  }
}
