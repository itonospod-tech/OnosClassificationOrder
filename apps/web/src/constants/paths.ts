export const PATHS = {
  // Trang chủ domain chính — public, không gate auth.
  LANDING: '/',

  // ---- Root router /ffm — các trang mang tính sản xuất ----
  HOME: '/ffm/dashboard',
  // `/ffm/orders` (bare) chỉ còn là redirect legacy — mọi trang thật nằm ở route
  // con riêng, điều hướng qua aside menu (KHÔNG dùng `?tab=` nữa).
  ORDERS: '/ffm/orders',
  ORDERS_WORKSHOP: '/ffm/orders/workshop',
  ORDERS_CLASSIC: '/ffm/orders/classic',
  ORDERS_ERROR_LOG: '/ffm/orders/error-log',
  ORDERS_IMPORT: '/ffm/orders/import',
  ORDERS_CUTTING_FILES: '/ffm/orders/cutting-files',
  ORDERS_SCAN_ERROR: '/ffm/orders/scan-error',
  ORDERS_STAGE_ERRORS: '/ffm/orders/stage-errors',
  ORDERS_UNMAPPED: '/ffm/orders/unmapped',
  SHIPMENTS: '/adm/shipments',
  WORKSHOP_CONFIG: '/ffm/workshop-config',

  // Designer Task Workflow (Phase 2+)
  DESIGNER_TEAM: '/ffm/designer/team',
  MY_TASKS: '/ffm/my-tasks',
  DESIGNER_STATS: '/ffm/designer/stats',

  // Fulfillment 5-stage Workflow
  FULFILLMENT_MY_TASKS: '/ffm/fulfillment/my-tasks',
  FULFILLMENT_TEAM: '/ffm/fulfillment/team',
  FULFILLMENT_STATS: '/ffm/fulfillment/stats',

  // Hướng dẫn quy trình DTF theo vai — trang NỘI BỘ (DtfRoleGuide.md). Ảnh ở thư mục public `/guide/dtf/`;
  // route cố ý nằm dưới `/ffm` nên không trùng thư mục ảnh (bẫy trùng tên: OrderGuide.md §6.1).
  DTF_GUIDE: '/ffm/guide/dtf',

  // ---- Root router /adm — các trang dùng chung / quản trị ----
  // `/adm/settings` (bare) redirect về mục đầu tiên user có quyền — mỗi mục
  // cài đặt là 1 route con `:section` (menu trái trong trang, lazy-mount).
  SETTINGS: '/adm/settings',
  SETTINGS_SECTION: '/adm/settings/:section',
  ACCOUNT: '/adm/account',
  PRODUCTS: '/adm/products',
  PRODUCT_DETAIL: '/adm/products/:id',
  PROMOTIONS: '/adm/promotions',
  CUSTOMERS: '/adm/customers',
  ZALO_GROUPS: '/adm/zalo-groups',
  ZALO_CHAT: '/adm/zalo',
  ZALO_CHAT_SETTINGS: '/adm/zalo/settings',
  TELEGRAM: '/adm/telegram',
  USERS: '/adm/users',
  DEPARTMENTS: '/adm/departments',
  ROLES: '/adm/roles',
  CUSTOM_ROLES: '/adm/custom-roles',
  NOTIFICATIONS: '/adm/notifications',
  /** Mạo danh tài khoản khác — CHỈ SuperAdmin (AUTH-1). */
  IMPERSONATE: '/adm/impersonate',
  /** CEO Dashboard — bảng điều hành cho lãnh đạo, CHỈ SuperAdmin/Admin (CeoDashboard.md). */
  CEO_DASHBOARD: '/adm/ceo',

  LOGIN: '/adm/login',
  REGISTER: '/adm/register',
  FORGOT_PASSWORD: '/adm/forgot-password',

  // ---- Root router /customer — Customer Portal (khách hàng tự đặt đơn) ----
  CUSTOMER_LOGIN: '/customer/login',
  CUSTOMER_REGISTER: '/customer/register',
  CUSTOMER_DASHBOARD: '/customer/dashboard',
  CUSTOMER_ORDERS: '/customer/orders',
  CUSTOMER_ORDER_NEW: '/customer/orders/new',
  CUSTOMER_ORDER_IMPORT: '/customer/orders/import',
  CUSTOMER_ORDER_DETAIL: '/customer/orders/:productionId',
  CUSTOMER_CATALOG: '/customer/catalog',
  CUSTOMER_CATALOG_DETAIL: '/customer/catalog/:id',
  CUSTOMER_ACCOUNT: '/customer/account',
  /** API & Webhook — Public Order API self-service (ORD-4). */
  CUSTOMER_API: '/customer/api',
  /** Tài liệu tích hợp Public Order API + Webhook — mở từ nút trên trang API. */
  CUSTOMER_API_DOCS: '/customer/api/docs',

  // ---- Public marketing routes (không gate auth, không dùng MainLayout/Sidebar) ----
  COMPANY_CAREERS: '/company/careers',
  // Catalog công khai — khách CHƯA đăng nhập xem hàng trước khi đăng ký đặt đơn.
  // Khác `CUSTOMER_CATALOG` (/customer/catalog) vốn nằm sau đăng nhập và có giá theo tier.
  CATALOG: '/catalog',
  CATALOG_DETAIL: '/catalog/:id',
  // Tra cứu đơn công khai — dán thẳng mã sản xuất vào URL (`/track/RA-05217-56631`).
  // Ai có mã đều xem được, kể cả người mua cuối của khách; dữ liệu trả về là
  // danh sách trắng hẹp — xem `public-track.service.ts`.
  TRACK: '/track',
  TRACK_DETAIL: '/track/:productionId',
  // Hướng dẫn khách lên đơn từng bước, ảnh chụp thật Seller Portal — xem OrderGuide.md.
  // KHÔNG dùng '/guide/order': trùng thư mục ảnh public/guide/order/ → Vite dev trả 500 và
  // nginx try_files khớp thư mục trước index.html (OrderGuide.md §6.1).
  ORDER_GUIDE: '/guide/ordering',

  ERROR_403: '/forbidden',
  ERROR_404: '/error/404',
  ANY: '*',
} as const;
