import { readFileSync } from 'fs';
import { join } from 'path';
import { PRODUCT_LINES } from 'shared';

/**
 * Every product line needs a label in each dictionary that renders it. A missing key does not fail
 * the build: the UI just prints the raw key (`productLines.dropship`), so a new line added to
 * PRODUCT_LINES with no label only shows up in front of a seller or a staff member.
 */
const repoRoot = join(__dirname, '../../../../..');
const readJson = (relative: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(repoRoot, relative), 'utf8'));

const FILES = (['vi', 'en'] as const).flatMap((lang) => [
  { file: `apps/web/src/i18n/locales/${lang}/customerPortal.json`, path: ['productLines'] },
  { file: `apps/seller/src/i18n/locales/${lang}/customerPortal.json`, path: ['productLines'] },
  { file: `apps/web/src/i18n/locales/${lang}/products.json`, path: ['productLines'] },
  { file: `apps/web/src/i18n/locales/${lang}/layout.json`, path: ['sidebar', 'nav', 'lines'] },
]);

describe('product line labels', () => {
  it.each(FILES)('$file labels every line', ({ file, path }) => {
    const labels = path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], readJson(file)) as
      | Record<string, unknown>
      | undefined;
    expect(labels).toBeDefined();
    const missing = PRODUCT_LINES.filter((line) => !labels?.[line]);
    expect(missing).toEqual([]);
  });
});
