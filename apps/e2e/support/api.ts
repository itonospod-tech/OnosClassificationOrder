/* eslint-disable @typescript-eslint/no-explicit-any */
/** Real HTTP calls against the e2e API (never the dev API, never production). */
import { API_BASE, PASSWORD, USERS, type UserKey } from './env';

const tokens = new Map<string, string>();

export async function login(email: string, password = PASSWORD): Promise<string> {
  const r = await fetch(API_BASE + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, recaptchaToken: 'x' }),
  });
  const j: any = await r.json().catch(() => ({}));
  const tok = j?.data?.accessToken ?? j?.accessToken;
  if (!tok) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return tok;
}

/**
 * Token per account, cached per worker. Logging in again replaces the server session (single session per
 * user), which would log out a browser that is using the same account — so tests call `api` with the
 * token the browser got when they need both (see `ui.loginAs`).
 */
export async function tokenFor(user: UserKey): Promise<string> {
  const cached = tokens.get(user);
  if (cached) return cached;
  const tok = await login(USERS[user].email);
  tokens.set(user, tok);
  return tok;
}
export const rememberToken = (user: UserKey, tok: string) => tokens.set(user, tok);
export const forgetToken = (user: UserKey) => tokens.delete(user);

export interface ApiRes {
  status: number;
  body: any;
}

export async function call(tok: string, method: string, path: string, body?: unknown): Promise<ApiRes> {
  const r = await fetch(API_BASE + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok, 'accept-language': 'en' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: r.status, body: parsed };
}

export async function as(user: UserKey, method: string, path: string, body?: unknown): Promise<ApiRes> {
  return call(await tokenFor(user), method, path, body);
}

/** Like `as` but throws on a non-2xx answer — for setup steps that must succeed. */
export async function must(user: UserKey, method: string, path: string, body?: unknown): Promise<any> {
  const res = await as(user, method, path, body);
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
  return res.body;
}
