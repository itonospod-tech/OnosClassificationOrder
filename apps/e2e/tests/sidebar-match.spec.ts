/**
 * Pure unit cases for the sidebar "is this link the current page" rule (`isLinkActive`). No browser, no
 * seed: the rule decides which entry lights up and which group auto-opens, and the Fulfillment regression
 * after PR #77 (the account's factory injected into the compared location left every link WITHOUT a
 * factoryId — Shipments, Wallet, Products… — unlit) is cheaper to pin here than through a login.
 */
import { expect, test } from '@playwright/test';

import { isLinkActive } from '../../web/src/components/sidebar/navMatch';

const SHIPMENTS = '/adm/shipments';
const WORKSHOP = '/ffm/orders/workshop';
const HOME = '/ffm/dashboard';

test.describe('sidebar isLinkActive', () => {
  test('link without factoryId matches a location that only adds the injected factoryId (Fulfillment)', () => {
    expect(isLinkActive(SHIPMENTS, SHIPMENTS, '?factoryId=TN')).toBe(true);
    expect(isLinkActive(SHIPMENTS, SHIPMENTS, '')).toBe(true);
    // Wallet transactions: a non-scope param on the link still has to be on the URL.
    expect(isLinkActive('/adm/wallet-transactions?range=7d', '/adm/wallet-transactions', '?range=7d&factoryId=TN')).toBe(true);
    expect(isLinkActive('/adm/wallet-transactions?range=7d', '/adm/wallet-transactions', '?factoryId=TN')).toBe(false);
    // matchPrefix entries (Settings) too.
    expect(isLinkActive('/adm/settings', '/adm/settings/vnp-shipping', '?factoryId=TN', true)).toBe(true);
  });

  test('factory-scoped link must match the location factory', () => {
    expect(isLinkActive(`${WORKSHOP}?factoryId=TN`, WORKSHOP, '?factoryId=TN')).toBe(true);
    expect(isLinkActive(`${WORKSHOP}?factoryId=TN`, WORKSHOP, '?factoryId=ML')).toBe(false);
    expect(isLinkActive(`${WORKSHOP}?factoryId=TN`, WORKSHOP, '')).toBe(false);
  });

  test('two sibling links for different factories never both light up', () => {
    const search = '?factoryId=ML';
    const lit = ['TN', 'ML'].filter((f) => isLinkActive(`${WORKSHOP}?factoryId=${f}`, WORKSHOP, search));
    expect(lit).toEqual(['ML']);
  });

  test('productLine / view stay matched both ways ("All orders" vs a line)', () => {
    const all = `${WORKSHOP}?factoryId=TN`;
    const line3d = `${WORKSHOP}?productLine=3d&factoryId=TN`;
    expect(isLinkActive(all, WORKSHOP, '?productLine=3d&factoryId=TN')).toBe(false);
    expect(isLinkActive(line3d, WORKSHOP, '?productLine=3d&factoryId=TN')).toBe(true);
    expect(isLinkActive(all, WORKSHOP, '?factoryId=TN')).toBe(true);
    expect(isLinkActive(line3d, WORKSHOP, '?factoryId=TN')).toBe(false);
    expect(isLinkActive(SHIPMENTS, SHIPMENTS, '?view=x')).toBe(false);
  });

  test('looseScope link ignores scope params on both sides (Tool 3D/2D toggle)', () => {
    const tool = `${HOME}?tab=tool-check&factoryId=TN`;
    expect(isLinkActive(tool, HOME, '?tab=tool-check&productLine=2d&factoryId=TN', false, true)).toBe(true);
    expect(isLinkActive(tool, HOME, '?tab=tool-check', false, true)).toBe(true);
    expect(isLinkActive(tool, HOME, '?tab=stats&factoryId=TN', false, true)).toBe(false);
  });

  test('dashboard tabs stay distinct', () => {
    expect(isLinkActive(`${HOME}?tab=factory&factoryId=TN`, HOME, '?tab=stats&factoryId=TN')).toBe(false);
    expect(isLinkActive(`${HOME}?tab=stats&factoryId=TN`, HOME, '?tab=stats&factoryId=TN')).toBe(true);
  });

  test('path must match', () => {
    expect(isLinkActive(SHIPMENTS, '/adm/shipments-x', '?factoryId=TN')).toBe(false);
    expect(isLinkActive('/adm/settings', '/adm/settingsx', '', true)).toBe(false);
  });
});
