import axios from 'axios';

import {
  OnospodAuthError,
  OnospodGraphqlError,
  OnospodNetworkError,
  OnospodSystemSession,
  readGraphqlBody,
  runWithRelogin,
} from './onospod-system.client';

/**
 * Tài khoản OnosPod hệ thống cho nút "Báo khách" (Orders.md §9f). Điều phải
 * giữ: CHỈ lỗi token (OnosPod từ chối trước khi chạy lệnh) mới được đăng nhập
 * lại + gửi lại, và chỉ một lần — gửi lại sau lỗi mạng có thể tạo issue trùng
 * cho khách.
 */
jest.mock('axios');
// jest.mock has replaced axios.post with a mock; this reference only reads it to assert calls.
// eslint-disable-next-line @typescript-eslint/unbound-method
const post = axios.post as jest.Mock;

const AUTH_BODY = {
  errors: [{ message: 'Context creation failed: Your account had been banned. You cannot create/update order' }],
};

describe('readGraphqlBody', () => {
  it('returns data on success', () => {
    expect(readGraphqlBody(200, { data: { ok: 1 } })).toEqual({ ok: 1 });
  });

  it('maps the context-creation rejection to an auth error even with HTTP 500', () => {
    expect(() => readGraphqlBody(500, AUTH_BODY)).toThrow(OnospodAuthError);
    expect(() =>
      readGraphqlBody(500, { errors: [{ message: 'Context creation failed: Invalid authorization header' }] }),
    ).toThrow(OnospodAuthError);
  });

  it('keeps other GraphQL errors as non-retryable', () => {
    expect(() => readGraphqlBody(200, { errors: [{ message: 'Production not found' }] })).toThrow(OnospodGraphqlError);
  });

  it('treats an HTTP failure without GraphQL errors as unknown outcome', () => {
    expect(() => readGraphqlBody(502, '<html>Bad gateway</html>')).toThrow(OnospodNetworkError);
    expect(() => readGraphqlBody(200, {})).toThrow(OnospodNetworkError);
  });
});

describe('runWithRelogin', () => {
  const store = (token: string | null) => ({ load: jest.fn().mockResolvedValue(token), write: jest.fn() });

  it('uses the saved token without logging in', async () => {
    const relogin = jest.fn();
    const run = jest.fn().mockResolvedValue('ok');
    await expect(runWithRelogin(store('t1'), relogin, run)).resolves.toBe('ok');
    expect(relogin).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith('t1');
  });

  it('logs in first when no token is saved', async () => {
    const relogin = jest.fn().mockResolvedValue('fresh');
    const run = jest.fn().mockResolvedValue('ok');
    await runWithRelogin(store(null), relogin, run);
    expect(run).toHaveBeenCalledWith('fresh');
  });

  it('re-logs in once and retries after an auth error', async () => {
    const relogin = jest.fn().mockResolvedValue('t2');
    const run = jest.fn().mockRejectedValueOnce(new OnospodAuthError('x')).mockResolvedValueOnce('ok');
    await expect(runWithRelogin(store('t1'), relogin, run)).resolves.toBe('ok');
    expect(relogin).toHaveBeenCalledTimes(1);
    expect(run.mock.calls).toEqual([['t1'], ['t2']]);
  });

  it('does not retry a second time when the fresh token is rejected too', async () => {
    const relogin = jest.fn().mockResolvedValue('t2');
    const run = jest.fn().mockRejectedValue(new OnospodAuthError('x'));
    await expect(runWithRelogin(store('t1'), relogin, run)).rejects.toThrow(OnospodAuthError);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the token was just obtained', async () => {
    const relogin = jest.fn().mockResolvedValue('fresh');
    const run = jest.fn().mockRejectedValue(new OnospodAuthError('x'));
    await expect(runWithRelogin(store(null), relogin, run)).rejects.toThrow(OnospodAuthError);
    expect(relogin).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['network error', new OnospodNetworkError('timeout')],
    ['GraphQL error', new OnospodGraphqlError('bad')],
  ])('never retries a %s (the issue may already exist)', async (_label, err) => {
    const relogin = jest.fn();
    const run = jest.fn().mockRejectedValue(err);
    await expect(runWithRelogin(store('t1'), relogin, run)).rejects.toBe(err);
    expect(relogin).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('OnospodSystemSession', () => {
  const account = { loginUrl: 'https://login', qcApiUrl: 'https://qc', email: 'sys@x', password: 'pw' };

  beforeEach(() => post.mockReset());

  it('refreshes a rejected token, saves it and resends', async () => {
    const write = jest.fn();
    post.mockImplementation((url: string, _body: unknown, opts: { headers: Record<string, string> }) => {
      if (url === 'https://login') return Promise.resolve({ status: 200, data: { data: { token: 'new' } } });
      return Promise.resolve(
        opts.headers.Authorization === 'Bearer new'
          ? { status: 200, data: { data: { ok: true } } }
          : { status: 500, data: AUTH_BODY },
      );
    });
    const session = new OnospodSystemSession(account, { load: () => Promise.resolve('old'), write });
    await expect(session.graphql('query', {})).resolves.toEqual({ ok: true });
    expect(write).toHaveBeenCalledWith('new');
  });

  it('logs in only once for concurrent requests that hit a bad token', async () => {
    let logins = 0;
    post.mockImplementation((url: string, _body: unknown, opts: { headers: Record<string, string> }) => {
      if (url === 'https://login') {
        logins += 1;
        return new Promise((r) => setTimeout(() => r({ status: 200, data: { data: { token: 'new' } } }), 5));
      }
      return Promise.resolve(
        opts.headers.Authorization === 'Bearer new'
          ? { status: 200, data: { data: { ok: true } } }
          : { status: 500, data: AUTH_BODY },
      );
    });
    const session = new OnospodSystemSession(account, { load: () => Promise.resolve('old'), write: jest.fn() });
    await Promise.all([session.graphql('a', {}), session.graphql('b', {}), session.graphql('c', {})]);
    expect(logins).toBe(1);
  });

  it('reports a failed login without leaking the password', async () => {
    post.mockResolvedValue({ status: 401, data: { message: 'wrong' } });
    const session = new OnospodSystemSession(account, { load: () => Promise.resolve(null), write: jest.fn() });
    const err = await session.graphql('q', {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(OnospodAuthError);
    expect((err as Error).message).not.toContain('pw');
  });
});
