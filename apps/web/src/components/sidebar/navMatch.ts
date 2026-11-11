/**
 * Pure "is this menu link the page I am on" rule of the sidebar, kept free of React and path aliases so it
 * can be unit-tested on its own (apps/e2e/tests/sidebar-match.spec.ts).
 */

/**
 * Scope params of a menu link: entries sharing a path differ only by these — "All orders" vs a product
 * line, one factory vs another. They are also the params stripped from the "click again to clear filters"
 * signal (`resetPathOf` in Sidebar.tsx), since pages register with the bare path, and the params a
 * `looseScope` entry ignores.
 */
export const SCOPE_PARAMS = ['factoryId', 'productLine', 'view'];

/**
 * Scope params matched BOTH WAYS (every other param only needs link ⊆ URL): the entry WITHOUT the param is
 * the "all" entry next to the ones that have it ("All orders" vs "3D"), so a one-way check would light both.
 *
 * `factoryId` is NOT one of them. No menu entry means "all factories" next to per-factory siblings — the
 * menu carries ONE factory on every production link, and the links that do not carry it (Shipments,
 * Wallet, Products…) are pages without a factory scope. A factory-locked account (Fulfillment) also gets
 * its factory injected into the compared location (`useNavLocation`), so matching `factoryId` both ways
 * left those pages unlit for it. One way is enough: a link with a factory must match the URL's factory
 * (the subset check), a link without one ignores it.
 */
const BOTH_WAYS_PARAMS = ['productLine', 'view'];

export function isLinkActive(
  linkPath: string,
  currentPath: string,
  currentSearch: string,
  matchPrefix = false,
  looseScope = false,
): boolean {
  // linkPath may include `?...` for children
  const [pathPart, queryPart] = linkPath.split('?');
  const pathMatches = matchPrefix
    ? currentPath === pathPart || currentPath.startsWith(`${pathPart}/`)
    : pathPart === currentPath;
  if (!pathMatches) return false;
  const linkParams = new URLSearchParams(queryPart || '');
  const currentParams = new URLSearchParams(currentSearch);
  if (!looseScope && BOTH_WAYS_PARAMS.some((p) => (linkParams.get(p) || '') !== (currentParams.get(p) || ''))) {
    return false;
  }
  // Every param of the link (factoryId included) must be on the URL with the same value.
  for (const [k, v] of linkParams.entries()) {
    if (looseScope && SCOPE_PARAMS.includes(k)) continue;
    if (currentParams.get(k) !== v) return false;
  }
  return true;
}
