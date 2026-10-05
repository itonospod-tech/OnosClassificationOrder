import 'reflect-metadata';

import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { lastValueFrom, of } from 'rxjs';
import { PRICE_FIELD_KEYS, PRICE_HIDDEN_ROLES, RoleType } from 'shared';

import { DesignerStatsController } from '../modules/designer/designer-stats.controller';
import { FulfillmentTaskController } from '../modules/fulfillment/fulfillment-task.controller';
import { OrderController } from '../modules/order/order.controller';
import { PriceVisibilityInterceptor, stripPriceFields } from './price-visibility.interceptor';

/**
 * Cost / price never reaches PRICE_HIDDEN_ROLES (Orders.md §26). The leak this closes: price was
 * hidden only by one line of browser code while every order list returned `baseCost`.
 */
const body = {
  success: true,
  data: [
    { productionId: 'P1', baseCost: 5.09, shipCost: 0, size: 'M', nested: { group: { minCost: 1, maxCost: 9 } } },
    { productionId: 'P2', toJSON: () => ({ productionId: 'P2', baseCost: 7 }) }, // mongoose-like document
  ],
  totals: { totalOrders: 2, totalProductionCost: 12.09, totalShippingCost: 0, totalCost: 12.09 },
};
const run = async (role: string | undefined) => {
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: role ? { role: { name: role } } : undefined }) }) };
  return lastValueFrom(new PriceVisibilityInterceptor().intercept(ctx as never, { handle: () => of(body) }) as never);
};
const keysDeep = (v: unknown): string[] =>
  v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]) : [];

describe('PriceVisibilityInterceptor', () => {
  it.each(PRICE_HIDDEN_ROLES)('%s gets no price key at any depth', async (role) => {
    const out = await run(role);
    expect(keysDeep(out).filter((k) => PRICE_FIELD_KEYS.includes(k))).toEqual([]);
    expect(out).toMatchObject({ data: [{ productionId: 'P1', size: 'M' }, { productionId: 'P2' }], totals: { totalOrders: 2 } });
  });

  it.each([RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.Support, RoleType.DesignerLeader])(
    '%s gets the response untouched',
    async (role) => {
      expect(await run(role)).toBe(body);
    },
  );

  it('the hidden set is exactly what the web app hid before (no policy change)', () => {
    expect([...PRICE_HIDDEN_ROLES].sort()).toEqual([RoleType.Designer, RoleType.Fulfillment].sort());
  });

  it('binary bodies pass through', () => {
    const buf = Buffer.from('x');
    expect(stripPriceFields(buf)).toBe(buf);
  });
});

/** Wired through @Auth, so every route of these controllers carries it (routes added later too). */
describe.each([
  ['OrderController', OrderController],
  ['FulfillmentTaskController', FulfillmentTaskController],
  ['DesignerStatsController', DesignerStatsController],
])('%s routes', (_name, ctrl) => {
  it('every @Auth route has the interceptor', () => {
    const proto = (ctrl as unknown as { prototype: Record<string, unknown> }).prototype;
    const routes = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor' && Reflect.getMetadata('path', proto[m] as object) !== undefined);
    expect(routes.length).toBeGreaterThan(3);
    const authed = routes.filter((m) => (Reflect.getMetadata('__guards__', proto[m] as object) ?? []).length > 0);
    for (const m of authed) {
      const ics = (Reflect.getMetadata(INTERCEPTORS_METADATA, proto[m] as object) ?? []) as unknown[];
      expect({ route: m, has: ics.includes(PriceVisibilityInterceptor) }).toEqual({ route: m, has: true });
    }
  });
});

it('never mutates the input (it may be a cached object other roles read)', () => {
  const cached = { data: [{ baseCost: 1, at: new Date(0) }] };
  const out = stripPriceFields(cached) as { data: Array<Record<string, unknown>> };
  expect(cached.data[0].baseCost).toBe(1);
  expect(out.data[0]).toEqual({ at: new Date(0) });
});
