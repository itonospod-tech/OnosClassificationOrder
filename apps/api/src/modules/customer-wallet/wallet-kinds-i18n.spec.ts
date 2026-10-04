import { readFileSync } from 'fs';
import { join } from 'path';
import { WALLET_TXN_KINDS } from 'shared';

/**
 * Every wallet transaction kind needs a label in all four i18n files. A missing key does not fail
 * the build: the UI just prints the raw key (`wallet.kinds.import_tax`), so adding a kind to
 * WALLET_TXN_KINDS and forgetting a label only shows up in front of a seller or a staff member.
 * (apps/seller `KIND_COLORS` is a `Record<WalletTxnKind, …>`, so a missing colour IS a compile error.)
 */
const repoRoot = join(__dirname, '../../../../..');
const readJson = (relative: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(repoRoot, relative), 'utf8'));

const FILES: Array<{ file: string; pick: (json: Record<string, unknown>) => Record<string, unknown> | undefined }> = [
  ...(['vi', 'en'] as const).map((lang) => ({
    file: `apps/seller/src/i18n/locales/${lang}/seller.json`,
    pick: (json: Record<string, unknown>) => (json.wallet as { kinds?: Record<string, unknown> } | undefined)?.kinds,
  })),
  ...(['vi', 'en'] as const).map((lang) => ({
    file: `apps/web/src/i18n/locales/${lang}/wallets.json`,
    pick: (json: Record<string, unknown>) => json.kinds as Record<string, unknown> | undefined,
  })),
];

describe('wallet transaction kinds — labels', () => {
  it.each(FILES)('$file labels every kind', ({ file, pick }) => {
    const kinds = pick(readJson(file));
    expect(kinds).toBeDefined();
    const missing = WALLET_TXN_KINDS.filter((kind) => !kinds?.[kind]);
    expect(missing).toEqual([]);
  });
});
