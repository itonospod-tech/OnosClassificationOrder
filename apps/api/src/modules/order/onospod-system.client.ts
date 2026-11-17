/**
 * Gọi GraphQL `qc.onospod.com` bằng tài khoản OnosPod CHUNG của hệ thống
 * (Orders.md §9f). Phần thuần — không phụ thuộc Nest — để test được luật
 * thử lại mà không cần mạng; `OnospodSystemSession` (cuối file) ghép nó với
 * axios + nơi lưu token.
 *
 * Token OnosPod là JWT KHÔNG có `exp`, chứa nguyên email + mật khẩu → không
 * hết hạn theo thời gian, chỉ hỏng khi tài khoản đổi mật khẩu. Server từ chối
 * token ở bước dựng context, TRƯỚC khi chạy query/mutation, với lỗi
 * `Context creation failed: ...` (HTTP 500 — "Invalid authorization header",
 * "Your account had been banned..."; verify gọi thật 17/11/2026). Chỉ lỗi đó
 * mới được tự đăng nhập lại + gửi lại: OnosPod chưa làm gì nên gửi lại không
 * tạo issue trùng. Lỗi mạng / hết giờ / lỗi GraphQL khác KHÔNG gửi lại — có
 * thể OnosPod đã nhận rồi.
 */
import axios from 'axios';

/** Tiền tố lỗi khi OnosPod không nhận token (xảy ra trước khi chạy lệnh). */
export const ONOSPOD_AUTH_ERROR_PREFIX = 'Context creation failed';

/** Token bị OnosPod từ chối — an toàn để đăng nhập lại và gửi lại. */
export class OnospodAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnospodAuthError';
  }
}

/** OnosPod trả lỗi GraphQL thường (đã chạy tới resolver) — KHÔNG gửi lại. */
export class OnospodGraphqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnospodGraphqlError';
  }
}

/**
 * Không biết OnosPod đã nhận hay chưa (mạng đứt, hết giờ, HTTP lạ không kèm
 * lỗi GraphQL) — KHÔNG gửi lại tự động.
 */
export class OnospodNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnospodNetworkError';
  }
}

type GraphqlBody = { data?: Record<string, unknown> | null; errors?: Array<{ message?: string }> };

/**
 * Đổi body GraphQL thành data hoặc lỗi đúng loại. Tách riêng để test: lỗi
 * token có thể đi kèm HTTP 500 nên phải đọc `errors` trước, rồi mới xét mã HTTP.
 */
export function readGraphqlBody(status: number, body: unknown): Record<string, unknown> {
  const parsed = (body && typeof body === 'object' ? body : {}) as GraphqlBody;
  const messages = (parsed.errors ?? []).map((e) => e?.message ?? '').filter(Boolean);
  if (messages.length > 0) {
    if (messages.some((m) => m.startsWith(ONOSPOD_AUTH_ERROR_PREFIX))) {
      throw new OnospodAuthError(messages.join('; '));
    }
    throw new OnospodGraphqlError(messages.join('; '));
  }
  if (status < 200 || status >= 300 || !parsed.data) {
    throw new OnospodNetworkError(`OnosPod trả HTTP ${status} không kèm dữ liệu`);
  }
  return parsed.data;
}

export type TokenStore = {
  /** Token đang lưu, chưa có thì null. */
  load(): Promise<string | null>;
  write(token: string): Promise<void>;
};

/**
 * Chạy `run` với token đang lưu; OnosPod từ chối token → đăng nhập lại ĐÚNG
 * MỘT lần, lưu token mới, chạy lại. Chưa có token thì đăng nhập trước. Lỗi lần
 * hai (kể cả lỗi token) ném thẳng ra, không thử tiếp.
 * `relogin` phải tự gộp các lượt gọi đồng thời (xem `OnospodSystemSession`).
 */
export async function runWithRelogin<T>(
  store: TokenStore,
  relogin: () => Promise<string>,
  run: (token: string) => Promise<T>,
): Promise<T> {
  const saved = await store.load();
  const token = saved || (await relogin());
  try {
    return await run(token);
  } catch (err) {
    if (!(err instanceof OnospodAuthError) || !saved) throw err;
    return run(await relogin());
  }
}

export type OnospodSystemAccount = { loginUrl: string; qcApiUrl: string; email: string; password: string };

// Gateway OnosPod chặn 403 nếu thiếu `origin` (xem onospod-qc.client.ts).
const QC_HEADERS = { Origin: 'https://qc.onospod.com', Referer: 'https://qc.onospod.com/' };
const TIMEOUT_MS = 30_000;

/**
 * Phiên đăng nhập tài khoản hệ thống: token lấy từ `store` (DB), hỏng thì tự
 * đăng nhập lại. Nhiều request cùng gặp token hỏng chỉ đăng nhập MỘT lần
 * (`pendingLogin`). Không bao giờ ghi token/mật khẩu ra log hay message lỗi.
 */
export class OnospodSystemSession {
  private pendingLogin: Promise<string> | null = null;

  constructor(
    private readonly account: OnospodSystemAccount,
    private readonly store: TokenStore,
  ) {}

  /** Chạy 1 lệnh GraphQL trên qc.onospod.com, tự đăng nhập lại khi token hỏng. */
  async graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    return runWithRelogin(
      this.store,
      () => this.relogin(),
      (token) => this.post(token, query, variables),
    );
  }

  private relogin(): Promise<string> {
    this.pendingLogin ??= this.login().finally(() => {
      this.pendingLogin = null;
    });
    return this.pendingLogin;
  }

  private async login(): Promise<string> {
    let res;
    try {
      res = await axios.post(
        this.account.loginUrl,
        { email: this.account.email, password: this.account.password },
        { headers: { Origin: 'https://app.onospod.com' }, timeout: TIMEOUT_MS, validateStatus: () => true },
      );
    } catch (err) {
      throw new OnospodNetworkError(
        `Đăng nhập OnosPod thất bại: ${axios.isAxiosError(err) ? err.message : 'lỗi mạng'}`,
      );
    }
    const token = (res.data as { data?: { token?: unknown } } | undefined)?.data?.token;
    if (typeof token !== 'string' || !token) {
      throw new OnospodAuthError(
        `Đăng nhập OnosPod bằng tài khoản hệ thống thất bại (HTTP ${res.status}) — kiểm tra ONOSPOD_SYSTEM_EMAIL/PASSWORD`,
      );
    }
    await this.store.write(token);
    return token;
  }

  private async post(token: string, query: string, variables: Record<string, unknown>) {
    let res;
    try {
      res = await axios.post(
        this.account.qcApiUrl,
        { query, variables },
        {
          headers: { ...QC_HEADERS, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: TIMEOUT_MS,
          validateStatus: () => true,
        },
      );
    } catch (err) {
      throw new OnospodNetworkError(`Gọi OnosPod thất bại: ${axios.isAxiosError(err) ? err.message : 'lỗi mạng'}`);
    }
    return readGraphqlBody(res.status, res.data);
  }
}
