import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable, StreamableFile } from '@nestjs/common';
import { map } from 'rxjs';
import { isPriceHiddenRole, PRICE_FIELD_KEYS } from 'shared';

const PRICE_KEYS = new Set(PRICE_FIELD_KEYS);

/**
 * Removes cost / price fields from the whole response for roles in PRICE_HIDDEN_ROLES (Orders.md §26).
 *
 * Applied by `@Auth` / `@Perm`, so it covers EVERY authenticated route of every module, including
 * routes added later: the leak this closes existed because price was hidden only in one browser
 * component while a list of endpoints returned it. Other roles pay nothing: the response passes
 * through untouched.
 */
export function stripPriceFields<T>(body: T): T {
  return strip(body) as T;
}

/**
 * Copy without price keys. Never mutates: a response object may be shared with an in-memory cache
 * that other (allowed) roles read. Plain objects and arrays are copied; objects with `toJSON`
 * (Mongoose documents) are serialized first, like the response itself would be; other instances
 * (Date, ObjectId, Buffer, files) are returned as they are.
 */
function strip(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(strip);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    if (v instanceof StreamableFile || Buffer.isBuffer(v) || v instanceof Date) return v;
    const toJSON = (v as { toJSON?: () => unknown }).toJSON;
    return typeof toJSON === 'function' ? strip(toJSON.call(v)) : v;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) if (!PRICE_KEYS.has(k)) out[k] = strip((v as Record<string, unknown>)[k]);
  return out;
}

@Injectable()
export class PriceVisibilityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const role = (context.switchToHttp().getRequest()?.user as { role?: { name?: string } } | undefined)?.role?.name;
    if (!isPriceHiddenRole(role)) return next.handle();
    return next.handle().pipe(map((body: unknown) => stripPriceFields(body)));
  }
}
