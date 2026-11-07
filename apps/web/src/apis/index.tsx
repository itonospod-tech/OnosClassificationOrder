import axios, { HttpStatusCode } from 'axios';
import { IMPERSONATION_EXPIRED_CODE } from 'shared';
import { toast } from 'sonner';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';
import { useCustomerAuthStore } from '@/store/customerAuthStore';
import { useLanguageStore } from '@/store/languageStore';
import { useSidebarBadgeStore } from '@/store/sidebarBadgeStore';

import { exitImpersonation, goToImpersonateHome } from '@/utils/impersonation';

import i18n from '@/i18n';

import { CONFIG } from '../constants';

const PUBLIC_ROUTE_KEYWORDS = ['catalog', 'product', 'products', 'categories', 'providers'];

// Endpoint `/customer/...` thuộc Customer Portal — dùng token RIÊNG
// (customerAuthStore), tách biệt hoàn toàn khỏi token nhân viên (authStore).
const isCustomerRoute = (url: string) => url.includes('/customer/');

const apiAxios = axios.create({
  baseURL: CONFIG.API_URL,
  headers: { 'Content-Type': 'application/json' },
});

apiAxios.interceptors.request.use(
  (config) => {
    const url = config.url || '';

    if (isCustomerRoute(url)) {
      const token = useCustomerAuthStore.getState().getToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      // Ngôn ngữ khách đang chọn → BE trả thông báo lỗi đúng thứ tiếng
      // (ORD-29). CHỈ gắn cho tuyến Customer Portal: API nội bộ giữ
      // nguyên tiếng Việt cho nhân viên, và không gửi header thì BE mặc
      // định tiếng Việt nên mọi thứ đang chạy không đổi hành vi.
      config.headers['Accept-Language'] = useLanguageStore.getState().language === 'en' ? 'en' : 'vi';
      return config;
    }

    const isPublicRoute = PUBLIC_ROUTE_KEYWORDS.some((kw) => url.includes(kw));
    const token = useAuthStore.getState().getToken(isPublicRoute);

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// Mutation nhân viên chạm tới orders/designer/fulfillment → số badge sidebar
// có thể đổi (hoàn thành task, gán designer, báo lỗi, soát tool...). Bump
// store để Sidebar debounce-refetch ngay thay vì đợi chu kỳ polling 60s.
const BADGE_AFFECTING_PATH = /\/(orders|designer|fulfillment)(\/|\?|$)/;
const isBadgeAffectingMutation = (method?: string, url?: string) =>
  !!method &&
  !!url &&
  ['post', 'patch', 'put', 'delete'].includes(method.toLowerCase()) &&
  !isCustomerRoute(url) &&
  BADGE_AFFECTING_PATH.test(url);

apiAxios.interceptors.response.use(
  (response) => {
    if (isBadgeAffectingMutation(response.config?.method, response.config?.url)) {
      useSidebarBadgeStore.getState().requestRefresh();
    }
    return response;
  },
  (error) => {
    const requestUrl = (error?.config?.url as string | undefined) || '';

    // ── AUTH-1 AC-09: phiên MẠO DANH hết hạn / đã kết thúc ───────────────────
    // PHẢI đứng TRƯỚC mọi nhánh 401 bên dưới. Backend trả mã riêng thay vì 401
    // trơn chính vì `clearToken()` dưới kia chạy `resetSession()` +
    // `sessionPersist.clearAll()` rồi chuyển hẳn sang trang đăng nhập — tức hết
    // hạn phiên mạo danh sẽ XOÁ SẠCH phiên thật của SuperAdmin và đá họ ra
    // ngoài, trượt AC-09 và vi phạm BR-14 ngay trên chính người đi mạo danh.
    // Thay vào đó: tự gọi `stop` để lấy lại token SuperAdmin rồi đưa về màn hình
    // Mạo danh. `exitImpersonation()` tự chống gọi trùng khi nhiều request cùng
    // hỏng, và chỉ khi NÓ hỏng nốt mới rơi về `clearToken` như cũ.
    if (error?.response?.data?.message === IMPERSONATION_EXPIRED_CODE) {
      error.__silent = true;
      void exitImpersonation().then((ok) => {
        if (ok) {
          toast.info(i18n.t('impersonate.expired', { ns: 'auth' }));
          goToImpersonateHome();
        } else {
          useAuthStore.getState().clearToken();
        }
      });
      return Promise.reject(error);
    }

    if (isCustomerRoute(requestUrl)) {
      if (error?.response?.status === HttpStatusCode.Unauthorized && !requestUrl.includes('/customer/auth/login')) {
        useCustomerAuthStore.getState().clearToken();
      }
      return Promise.reject(error);
    }

    if (error?.response?.status === HttpStatusCode.Unauthorized) {
      useAuthStore.getState().clearToken();
    }

    // 405 = tài khoản đang bị bắt đổi mật khẩu (`forcePassChange`, RolesGuard).
    // Sang trang đổi mật khẩu RIÊNG (ngoài MainLayout) và CHỈ khi chưa đứng ở đó —
    // trước đây đẩy về `/adm/account` nằm trong MainLayout, Sidebar/banner ở đó lại
    // ăn 405 → tải lại trang vô tận (màn hình trắng, Auth.md §6.1).
    if (error?.response?.status === 405) {
      if (window.location.pathname !== PATHS.CHANGE_PASSWORD) {
        window.location.href = PATHS.CHANGE_PASSWORD;
      }
      return Promise.reject(new Error('You need to change password'));
    }

    // Token còn hạn nhưng user đã bị xoá/không tồn tại (JwtStrategy.validate
    // ném UserNotFoundException) — đẩy logout thay vì chỉ hiện raw i18n key.
    // Loại trừ chính request /auth/login: backend dùng chung message này cho
    // cả sai mật khẩu/user inactive khi đăng nhập — không phải phiên bị mất,
    // để trang login tự hiện lỗi thay vì bị logout/redirect ngay trên chính nó.
    const isLoginRequest = (error?.config?.url as string | undefined)?.includes('/auth/login');
    if (!isLoginRequest && error?.response?.data?.message === 'error.userNotFound') {
      toast.error(i18n.t('session.accountNotFound', { ns: 'auth' }));
      useAuthStore.getState().clearToken();
      error.__silent = true;
    }

    return Promise.reject(error);
  },
);

export const callApi = (endPoint: string, method: string, body?: any, type?: string) => {
  return apiAxios({
    method,
    url: endPoint,
    data: body,
    headers: type === 'upload' ? { 'Content-Type': 'multipart/form-data' } : undefined,
  });
};

export const callBlobApi = (endPoint: string, url: string, fileName: string) => {
  const isPublicRoute =
    endPoint.includes('catalog') ||
    endPoint.includes('product') ||
    endPoint.includes('products') ||
    endPoint.includes('categories');
  endPoint.includes('providers');

  const token = useAuthStore.getState().getToken(isPublicRoute);

  return axios({
    url,
    method: 'GET',
    responseType: 'blob',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).then((response) => {
    const url = window.URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  });
};
