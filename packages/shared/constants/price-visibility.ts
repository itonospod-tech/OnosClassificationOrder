import { RoleType } from '@shared/enums/role-type';

/**
 * Roles that must never receive cost or price data (Orders.md §26). Enforced on the SERVER by
 * `PriceVisibilityInterceptor` on every authenticated route; the web app reads the same list to
 * hide price UI, so there is one source. Adding a role here is a policy change for the owner.
 *
 * History: Designer + Fulfillment (what the web app already hid, 2026-10-05); DesignerLeader added
 * by the owner's decision the same day.
 */
export const PRICE_HIDDEN_ROLES: readonly RoleType[] = [RoleType.Designer, RoleType.DesignerLeader, RoleType.Fulfillment];

/**
 * Keys removed at any depth of a response for those roles: production cost and every money
 * aggregate built from it (order rows, dashboard totals, per-group min/max).
 */
export const PRICE_FIELD_KEYS: readonly string[] = [
  'baseCost',
  'shipCost',
  'productionCost',
  'shippingCost',
  'totalCost',
  'totalProductionCost',
  'totalShippingCost',
  'minCost',
  'maxCost',
];

export const isPriceHiddenRole = (role?: string | null): boolean => !!role && (PRICE_HIDDEN_ROLES as readonly string[]).includes(role);
