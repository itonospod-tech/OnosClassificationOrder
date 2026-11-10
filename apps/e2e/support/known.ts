import { test } from '@playwright/test';

import { KNOWN_BUG } from './env';

/**
 * Marks the current test as an EXPECTED failure: a bug that is known and deliberately not fixed in this
 * release. When the bug gets fixed the test starts passing and Playwright reports it ("expected to fail"),
 * which is the signal to delete this call.
 *
 * Call it RIGHT BEFORE the bug's own assertion, never at the top of the test (Playwright allows
 * `test.fail()` mid-test). A failure thrown before the call — setup, navigation, or a neighbouring
 * assertion that guards something else (e.g. "another designer's order is blocked") — then stays a real
 * failure instead of being swallowed as "expected to fail". Assertions that are not about the bug belong
 * in a normal test.
 *
 * `E2E_STRICT_KNOWN=1` runs these tests as normal ones, to read the exact failure each one hits.
 */
export function knownBug(note: string = KNOWN_BUG): void {
  test.fail(process.env.E2E_STRICT_KNOWN !== '1', note);
}
