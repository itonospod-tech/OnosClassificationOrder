import { callApi } from '../apis';
import { CONFIG } from '../constants';

/**
 * Catalog công khai (`/catalog`) — KHÔNG cần đăng nhập.
 *
 * URL cố ý nằm dưới `/public/...` chứ không phải `/customer/...`: interceptor ở
 * `apis/index.tsx` gắn token khách hàng cho mọi request chứa `/customer/`, mà
 * trang này phục vụ người chưa có tài khoản.
 */
const getCatalog = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/public/catalog${query}`, 'get');
};

const getCatalogItem = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/public/catalog/${encodeURIComponent(id)}`, 'get');
};

const getFacets = () => {
  return callApi(`/${CONFIG.API_VERSION}/public/catalog/facets`, 'get');
};

export const publicCatalog = { getCatalog, getCatalogItem, getFacets };
