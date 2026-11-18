import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import { PATHS } from '@/constants/paths';

// Route con cũ dạng `/orders?tab=xxx` đã bỏ — mọi trang thật giờ có path
// riêng, điều hướng qua aside menu. File này CHỈ còn nhiệm vụ redirect
// bookmark/link cũ sang route mới tương ứng, giữ nguyên mọi query param khác
// (vd `wfrom`/`wto` của Danh sách đơn) để không vỡ link đã lưu.
const TAB_TO_PATH: Record<string, string> = {
  list: PATHS.ORDERS_WORKSHOP, // tab "list" đã tạm tắt từ trước, alias sang Workshop (default cũ)
  workshop: PATHS.ORDERS_WORKSHOP,
  'error-log': PATHS.ORDERS_ERROR_LOG,
  urgent: PATHS.ORDERS_URGENT,
  import: PATHS.ORDERS_IMPORT,
  'cutting-files': PATHS.ORDERS_CUTTING_FILES,
};

export default function OrdersRedirect() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const target = (tab && TAB_TO_PATH[tab]) || PATHS.ORDERS_WORKSHOP;

  const rest = new URLSearchParams(searchParams);
  rest.delete('tab');
  const search = rest.toString();

  return <Navigate to={`${target}${search ? `?${search}` : ''}`} replace />;
}
