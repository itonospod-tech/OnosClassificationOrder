import type {
  BulkFulfillmentTransitionDto,
  CompletePackBacklogDto,
  FulfillmentStage,
  FulfillmentTaskTab,
  FulfillmentTransitionDto,
  HandoverPackagesDto,
} from 'shared';

import { callApi } from '../apis';
import { CONFIG } from '../constants';

/**
 * Kiện đã đóng gói (GAP-25/26/27). Mặc định BE trả kiện CHƯA bàn giao — đúng
 * việc cần làm khi xe hãng tới.
 */
const getPackages = (params?: { factoryId?: string; daBanGiao?: boolean; limit?: number }) => {
  const q = new URLSearchParams();
  if (params?.factoryId) q.set('factoryId', params.factoryId);
  if (params?.daBanGiao) q.set('daBanGiao', 'true');
  if (params?.limit) q.set('limit', String(params.limit));

  return callApi(
    `/${CONFIG.API_VERSION}/shipping-vnp/packages${q.toString() ? `?${q}` : ''}`,
    'get',
  );
};

/** Bàn giao lô kiện: cấp 1 mã phiếu cho cả lô + đóng dấu giờ xuất kho. */
const handoverPackages = (data: HandoverPackagesDto) => {
  return callApi(`/${CONFIG.API_VERSION}/shipping-vnp/packages/handover`, 'post', data);
};

const transition = (orderId: string, data: FulfillmentTransitionDto) => {
  return callApi(
    `/${CONFIG.API_VERSION}/orders/${orderId}/fulfillment-transition`,
    'post',
    data,
  );
};

/** Bulk N đơn trong 1 request — BE loop transition từng đơn (giữ đủ hook). */
const bulkTransition = (data: BulkFulfillmentTransitionDto) => {
  return callApi(`/${CONFIG.API_VERSION}/fulfillment/bulk-transition`, 'post', data);
};

/**
 * Hoàn thành toàn bộ đơn tồn ở Đóng hàng của 1 xưởng — nút đi kèm toggle
 * `autoCompletePack` (FactoryTab). CHỈ Admin/SuperAdmin.
 */
const completePackBacklog = (data: CompletePackBacklogDto) => {
  return callApi(`/${CONFIG.API_VERSION}/fulfillment/complete-pack-backlog`, 'post', data);
};

const myTasks = (
  query: {
    tab?: FulfillmentTaskTab;
    stage?: FulfillmentStage;
    factoryId?: string;
    page?: number;
    size?: number;
    /**
     * Date range filter trên `inProductionAt` (YYYY-MM-DD VN local). BE default
     * 7 ngày khi cả 2 đều undefined; empty string = explicit clear → all-time
     * (match scope với `OrderFactoryTab`).
     */
    createdFrom?: string;
    createdTo?: string;
  } = {},
) => {
  const qs = new URLSearchParams();
  if (query.tab) qs.set('tab', query.tab);
  if (query.stage) qs.set('stage', query.stage);
  if (query.factoryId) qs.set('factoryId', query.factoryId);
  if (query.page) qs.set('page', String(query.page));
  if (query.size) qs.set('size', String(query.size));
  // Truyền cả khi empty string — BE phân biệt undefined (default 7d) vs
  // '' (explicit clear → all-time).
  if (query.createdFrom !== undefined) qs.set('createdFrom', query.createdFrom);
  if (query.createdTo !== undefined) qs.set('createdTo', query.createdTo);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/fulfillment/my-tasks${suffix}`, 'get');
};

const dailyOverview = (
  query: { days?: 7 | 14 | 30; from?: string; to?: string; stage?: FulfillmentStage } = {},
) => {
  const qs = new URLSearchParams();
  qs.set('days', String(query.days || 7));
  if (query.from) qs.set('from', query.from);
  if (query.to) qs.set('to', query.to);
  if (query.stage) qs.set('stage', query.stage);
  return callApi(`/${CONFIG.API_VERSION}/fulfillment/daily-overview?${qs.toString()}`, 'get');
};

export const fulfillment = {
  getPackages,
  handoverPackages,
  transition,
  bulkTransition,
  completePackBacklog,
  myTasks,
  dailyOverview,
};
