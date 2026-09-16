import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { RequirePagePermission } from './components/common/RequirePagePermission';
import Loading from './components/loading';
import { PATHS } from './constants/paths';
import { routerConfig } from './constants/routerConfig';
import CustomerLayout from './layouts/customerLayout/CustomerLayout';
import MainLayout from './layouts/mainLayout/MainLayout';
import NotFound from './pages/errors/NotFound';
import Landing from './pages/landing';
import ForgotPassword from './pages/login/ForgotPassword';
import Login from './pages/login/index';
import Register from './pages/register';
import { useAuthStore } from './store/authStore';
import { useCustomerAuthStore } from './store/customerAuthStore';

const CompanyCareers = lazy(() => import('./pages/company/careers'));

// Catalog công khai — cùng nhóm route public với landing/careers, KHÔNG qua PrivateRoute.
const PublicCatalog = lazy(() => import('./pages/catalog'));
const PublicCatalogDetail = lazy(() => import('./pages/catalog/detail'));

// Tra cứu đơn công khai — cùng component cho `/track` (ô nhập mã) và `/track/:productionId`.
const PublicTrack = lazy(() => import('./pages/track'));
// Hướng dẫn lên đơn công khai — cùng nhóm route public, KHÔNG qua PrivateRoute.
const PublicOrderGuide = lazy(() => import('./pages/guide/order'));

const CustomerLogin = lazy(() => import('./pages/customer/login'));
const CustomerRegister = lazy(() => import('./pages/customer/register'));
const CustomerDashboard = lazy(() => import('./pages/customer/dashboard'));
const CustomerOrders = lazy(() => import('./pages/customer/orders'));
const CustomerCatalog = lazy(() => import('./pages/customer/catalog'));
const CustomerCatalogDetail = lazy(() => import('./pages/customer/catalog/detail'));
const CustomerOrderNew = lazy(() => import('./pages/customer/orders/new'));
const CustomerOrderImport = lazy(() => import('./pages/customer/orders/import'));
const CustomerOrderTrack = lazy(() => import('./pages/customer/orders/track'));
const CustomerAccount = lazy(() => import('./pages/customer/account'));
const CustomerApi = lazy(() => import('./pages/customer/api'));
const CustomerApiDocs = lazy(() => import('./pages/customer/api/docs'));

function PrivateRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  if (!isAuthenticated) {
    return <Navigate to={PATHS.LOGIN} replace />;
  }

  return <Outlet />;
}

/**
 * Seller Portal riêng (`apps/seller`, SellerPortal.md §2.7): đặt `VITE_SELLER_URL` là các
 * route khách SAU ĐĂNG NHẬP chuyển hẳn sang app mới (giữ nguyên :productionId).
 * Rỗng → mọi thứ chạy như cũ. Catalog/API docs/track/landing vẫn ở đây tới đợt 2.
 */
const SELLER_URL = ((import.meta.env.VITE_SELLER_URL as string | undefined) ?? '').replace(/\/+$/, '');
const SELLER_ROUTE_MAP: Array<[string, string]> = [
  [PATHS.CUSTOMER_LOGIN, '/login'],
  [PATHS.CUSTOMER_DASHBOARD, '/portal'],
  [PATHS.CUSTOMER_ORDER_NEW, '/portal/orders/create'],
  [PATHS.CUSTOMER_ORDER_IMPORT, '/portal/orders/import'],
  [PATHS.CUSTOMER_ORDERS, '/portal/orders'],
  [PATHS.CUSTOMER_ACCOUNT, '/portal/account'],
];
function ExternalRedirect({ to }: { to: string }) {
  React.useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <Loading />;
}
function sellerTargetFor(pathname: string, search: string): string | null {
  if (!SELLER_URL) return null;
  const detail = pathname.match(/^\/customer\/orders\/([^/]+)$/);
  if (detail && detail[1] !== 'new' && detail[1] !== 'import') return `${SELLER_URL}/portal/orders/${detail[1]}`;
  for (const [from, to] of SELLER_ROUTE_MAP) if (pathname === from) return `${SELLER_URL}${to}${search}`;
  return null;
}
/** Bọc ngoài các route khách: có đích seller → chuyển, không thì render như cũ. */
function SellerRedirectGate() {
  const location = useLocation();
  const target = sellerTargetFor(location.pathname, location.search);
  if (target) return <ExternalRedirect to={target} />;
  return <Outlet />;
}

function CustomerPrivateRoute() {
  const isAuthenticated = useCustomerAuthStore((s) => s.isAuthenticated());

  if (!isAuthenticated) {
    return <Navigate to={PATHS.CUSTOMER_LOGIN} replace />;
  }

  return <Outlet />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path={PATHS.LANDING} element={<Landing />} />

        <Route
          path={PATHS.CATALOG}
          element={
            <Suspense fallback={<Loading />}>
              <PublicCatalog />
            </Suspense>
          }
        />
        <Route
          path={PATHS.CATALOG_DETAIL}
          element={
            <Suspense fallback={<Loading />}>
              <PublicCatalogDetail />
            </Suspense>
          }
        />

        <Route
          path={PATHS.TRACK}
          element={
            <Suspense fallback={<Loading />}>
              <PublicTrack />
            </Suspense>
          }
        />
        <Route
          path={PATHS.TRACK_DETAIL}
          element={
            <Suspense fallback={<Loading />}>
              <PublicTrack />
            </Suspense>
          }
        />

        <Route
          path={PATHS.ORDER_GUIDE}
          element={
            <Suspense fallback={<Loading />}>
              <PublicOrderGuide />
            </Suspense>
          }
        />

        <Route
          path={PATHS.COMPANY_CAREERS}
          element={
            <Suspense fallback={<Loading />}>
              <CompanyCareers />
            </Suspense>
          }
        />

        <Route element={<PrivateRoute />}>
          <Route element={<MainLayout />}>
            {/* Bare `/adm` và `/ffm` — redirect legacy về trang mặc định của mỗi root router. */}
            <Route path="/adm" element={<Navigate to={PATHS.ACCOUNT} replace />} />
            <Route path="/ffm" element={<Navigate to={PATHS.HOME} replace />} />
            {routerConfig.map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={
                  // AUTH-7 — chặn theo QUYỀN TRANG trước khi dựng, để vai không có
                  // quyền gõ thẳng URL không nhận bảng trống khó hiểu nữa.
                  <RequirePagePermission path={route.path}>
                    <Suspense fallback={<Loading />}>
                      <route.component />
                    </Suspense>
                  </RequirePagePermission>
                }
              />
            ))}
          </Route>
        </Route>
        <Route path={PATHS.LOGIN} element={<Login />} />
        <Route path={PATHS.REGISTER} element={<Register />} />
        <Route path={PATHS.FORGOT_PASSWORD} element={<ForgotPassword />} />

        <Route element={<SellerRedirectGate />}>
        <Route
          path={PATHS.CUSTOMER_LOGIN}
          element={
            <Suspense fallback={<Loading />}>
              <CustomerLogin />
            </Suspense>
          }
        />
        <Route
          path={PATHS.CUSTOMER_REGISTER}
          element={
            <Suspense fallback={<Loading />}>
              <CustomerRegister />
            </Suspense>
          }
        />
        <Route element={<CustomerPrivateRoute />}>
          <Route element={<CustomerLayout />}>
            <Route path="/customer" element={<Navigate to={PATHS.CUSTOMER_DASHBOARD} replace />} />
            <Route
              path={PATHS.CUSTOMER_DASHBOARD}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerDashboard />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_ORDERS}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerOrders />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_ORDER_NEW}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerOrderNew />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_ORDER_IMPORT}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerOrderImport />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_ORDER_DETAIL}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerOrderTrack />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_CATALOG}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerCatalog />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_CATALOG_DETAIL}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerCatalogDetail />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_ACCOUNT}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerAccount />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_API}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerApi />
                </Suspense>
              }
            />
            <Route
              path={PATHS.CUSTOMER_API_DOCS}
              element={
                <Suspense fallback={<Loading />}>
                  <CustomerApiDocs />
                </Suspense>
              }
            />
          </Route>
        </Route>
        </Route>

        <Route path={PATHS.ERROR_404} element={<NotFound />} />
        <Route path={PATHS.ANY} element={<Navigate to={PATHS.ERROR_404} />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
