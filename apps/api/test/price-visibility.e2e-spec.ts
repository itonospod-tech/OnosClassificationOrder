import { Injectable } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PRICE_FIELD_KEYS, RoleType } from 'shared';
import request from 'supertest';

import { OnospodHoldSyncService } from '../src/modules/order/onospod-hold-sync.service';
import { OnospodImportService } from '../src/modules/order/onospod-import.service';
import { OrderController } from '../src/modules/order/order.controller';
import { OrderService } from '../src/modules/order/order.service';
import { ShippingLabelPdfService } from '../src/modules/order/shipping-label-pdf.service';
import { RedisCacheService } from '../src/modules/redis-cache/redis-cache.service';
import { RoleService } from '../src/modules/role/role.service';
import { RateLimiterService } from '../src/shared/services/rate-limiter.service';

/**
 * Price never reaches Designer / Fulfillment OVER HTTP (Orders.md §26). The unit specs prove
 * `stripPriceFields` and that routes carry the interceptor; this one proves the assembled Nest
 * pipeline does it: real OrderController, real @Auth (AuthGuard → RateLimiter → Permissions →
 * Roles), real interceptors, Fastify like production, the controller's own `{ success, data }`.
 *
 * Isolation: only the data service and the infrastructure (Redis session, rate limiter) are stubs,
 * so nothing touches a database, Redis or any shared server. The JWT is signed with a secret that
 * exists only in this file and checked by a test `jwt` strategy; no real account, no password.
 */
const SECRET = 'price-visibility-e2e-only';

/**
 * Known bug (expected to fail). `STRICT_KNOWN=1` runs it as a normal test, to read the exact failure it hits
 * and check it fails for the right reason. Flip to `it` once the bug is fixed.
 */
const itKnown = process.env.STRICT_KNOWN ? it : it.failing;
const SESSION = 's1';

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }

  validate(payload: { sub: string; role: RoleType }) {
    return { _id: payload.sub, role: { name: payload.role }, factoryId: 'F1' };
  }
}

/** What the real service returns: per-order cost, nested groups, dashboard money totals. */
const orders = {
  success: true,
  data: [
    { _id: 'O1', productionId: 'P1', baseCost: 5.09, shipCost: 1.2, size: 'M', productConfig: { fullName: 'Tee' } },
    { _id: 'O2', productionId: 'P2', baseCost: 7, history: [{ group: { minCost: 1, maxCost: 9 } }] },
  ],
  total: 2,
};
const dashboard = {
  success: true,
  data: {
    totals: { totalOrders: 2, totalProductionCost: 12.09, totalShippingCost: 1.2, totalCost: 13.29 },
    byType: [{ type: 'Tee', count: 2, productionCost: 12.09, shippingCost: 1.2, minCost: 5.09, maxCost: 7 }],
  },
};

/** One order (detail dialog) and its history; the log rows are the shape the re-import writes (order.service.ts). */
const detail = { success: true, data: { _id: 'O1', productionId: 'P1', baseCost: 5.09, shipCost: 1.2, size: 'M', productConfig: { fullName: 'Tee' } } };
const logs = {
  success: true,
  data: [
    { _id: 'L1', orderId: 'O1', action: 'update', field: 'baseCost', before: 5.09, after: 6 },
    { _id: 'L2', orderId: 'O1', action: 'update', field: 'shipCost', before: 1.2, after: 2 },
    { _id: 'L3', orderId: 'O1', action: 'update', field: 'size', before: 'M', after: 'L' },
  ],
  total: 3,
};
/** Log rows that still carry a price VALUE (bug 6: the key is 'before'/'after', the price is in 'field'). */
const priceLogValues = (body: { data?: Array<Record<string, unknown>> }) =>
  (body.data ?? []).filter((r) => PRICE_FIELD_KEYS.includes(String(r.field)) && (r.before !== undefined || r.after !== undefined));

/** Every key at every depth, same walk as public-track.spec.ts. */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}
const priceKeys = (body: unknown) => allKeys(body).filter((k) => PRICE_FIELD_KEYS.includes(k));

describe('price visibility over HTTP (e2e)', () => {
  let app: NestFastifyApplication;
  let jwt: JwtService;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [OrderController],
      providers: [
        TestJwtStrategy,
        {
          provide: OrderService,
          useValue: {
            getOrders: () => Promise.resolve(orders),
            getDashboard: () => Promise.resolve(dashboard),
            getOrderById: () => Promise.resolve(detail),
            getLogs: () => Promise.resolve(logs),
          },
        },
        { provide: OnospodImportService, useValue: {} },
        { provide: OnospodHoldSyncService, useValue: {} },
        { provide: ShippingLabelPdfService, useValue: {} },
        { provide: 'winston', useValue: { info: () => undefined, warn: () => undefined, error: () => undefined } },
        { provide: RoleService, useValue: {} },
        { provide: RateLimiterService, useValue: { consumeToken: () => Promise.resolve({ remainingPoints: 100 }), consumeUserId: () => Promise.resolve({ remainingPoints: 100 }) } },
        // RolesGuard checks the token against the Redis session: the session holds exactly the issued token.
        { provide: RedisCacheService, useValue: { getHash: (key: string) => Promise.resolve(tokens.get(key)) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    jwt = moduleRef.get(JwtService);
  });
  afterAll(() => app?.close());

  const tokenFor = (role: RoleType) => {
    const sub = `user-${role}`;
    const t = jwt.sign({ sub, role, sessionId: SESSION });
    tokens.set(`token:${SESSION}:${sub}`, t);
    return t;
  };
  const get = (path: string, role: RoleType) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(role)}`);

  describe.each(['/api/v1/orders', '/api/v1/orders/dashboard', '/api/v1/orders/O1'])('%s', (path) => {
    it.each([RoleType.Fulfillment, RoleType.Designer, RoleType.DesignerLeader])('%s: no price key at any depth', async (role) => {
      const res = await get(path, role).expect(200);
      expect(res.body.success).toBe(true);
      expect(priceKeys(res.body)).toEqual([]);
      expect(allKeys(res.body).length).toBeGreaterThan(5); // the rest of the payload is still there
    });

    it('control: Admin, same request, still gets them', async () => {
      const res = await get(path, RoleType.Admin).expect(200);
      expect(priceKeys(res.body).length).toBeGreaterThan(0);
    });
  });

  describe('/api/v1/orders/O1/logs (PR #77 report, bug 6 — pre-existing)', () => {
    // known bug present on main, not fixed in release 07/11 — flip to it() when fixed
    itKnown.each([RoleType.Designer, RoleType.DesignerLeader, RoleType.Fulfillment])('%s: no before/after of a price field', async (role) => {
      const res = await get('/api/v1/orders/O1/logs', role).expect(200);
      expect(priceLogValues(res.body)).toEqual([]);
    });

    it('Designer: the non-price history is still there', async () => {
      const res = await get('/api/v1/orders/O1/logs', RoleType.Designer).expect(200);
      expect(res.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'size', before: 'M', after: 'L' })]));
    });

    it('control: Admin, same request, still gets the price history', async () => {
      const res = await get('/api/v1/orders/O1/logs', RoleType.Admin).expect(200);
      expect(priceLogValues(res.body)).toHaveLength(2);
    });
  });

  it('control: without a token the route is refused (the guards really run)', async () => {
    await request(app.getHttpServer()).get('/api/v1/orders').expect(401);
  });
});
