import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Tailwind classes that name a colour the theme does not define generate NO css, silently: text loses its
 * colour, a border vanishes, a chip renders white-on-transparent. Nothing fails — not the type-check, not
 * the lint, not the build — so the only thing that stops it is a test.
 *
 * It already happened: `apps/web` theme tokens like `primary` carry only `DEFAULT` and `foreground` (see
 * tailwind.config.js), yet nine places used `text-primary-600`, `bg-primary-50`, `border-primary-500`…
 * from the old numbered palette. This scans the sources and fails on any such class.
 *
 * It lives in apps/api only because that is the one package with a test runner; it reads the other apps'
 * files, as `wallet-kinds-i18n.spec.ts` does.
 */
const repoRoot = join(__dirname, '../../../..');
const ROOTS = ['apps/web/src', 'apps/seller/src'];
const EXTENSIONS = /\.(tsx?|jsx?|mjs|css|html)$/;

// Utility prefixes that take a colour, and the theme colour families that have NO numbered scale.
const PROPS = 'text|bg|border|ring|ring-offset|outline|divide|accent|caret|fill|stroke|from|via|to|decoration|shadow|placeholder';
const FAMILIES = 'primary|secondary|destructive|muted|accent|popover|card';
const NUMBERED_SCALE_ON_FLAT_COLOUR = new RegExp(`(?<![\\w-])(?:${PROPS})-(?:${FAMILIES})-\\d{2,3}(?![\\w-])`, 'g');

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXTENSIONS.test(name)) yield path;
  }
}

describe('theme colour classes', () => {
  it('the detector catches the real mistakes and leaves valid classes alone', () => {
    const bad = [
      'text-primary-600',
      'dark:bg-primary-500/15',
      'hover:border-primary-400',
      'ring-secondary-500',
      'accent-primary-600',
      'bg-muted-100',
    ];
    const good = [
      'text-primary',
      'bg-primary/10',
      'text-primary-foreground',
      'border-primary/60',
      'text-muted-foreground',
      'bg-card',
      'text-brand-600',
      'accent-primary',
    ];
    for (const cls of bad) expect({ cls, hit: cls.match(NUMBERED_SCALE_ON_FLAT_COLOUR) !== null }).toEqual({ cls, hit: true });
    for (const cls of good) expect({ cls, hit: cls.match(NUMBERED_SCALE_ON_FLAT_COLOUR) !== null }).toEqual({ cls, hit: false });
  });

  it('no source uses a numbered shade of a colour that has none', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(repoRoot, root))) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          for (const hit of line.match(NUMBERED_SCALE_ON_FLAT_COLOUR) ?? []) {
            offenders.push(`${file.slice(repoRoot.length + 1)}:${i + 1}  ${hit}`);
          }
        });
      }
    }
    // Replace with the token (`text-primary`, `bg-primary/10`, `text-primary-foreground`): it follows light/dark by itself.
    expect(offenders).toEqual([]);
  });
});
