import type {
  ApplyCuttingFilesDto,
  AutoAssignApplyDto,
  AutoAssignPreviewDto,
  BulkAssignDesignerDto,
  BulkAssignDesignerPreviewDto,
  BulkAssignOrderDto,
  BulkHoldOrderDto,
  BulkTransferOrderDto,
  BulkUpdateOrderFieldDto,
  CancelOrderDto,
  ClaimDesignerTasksDto,
  ExportShippingLabelsDto,
  GetBarcodeLabelsDto,
  GetShippingLabelsDto,
  HoldOrderDto,
  ImportFromOnosPodDto,
  ImportProductionOrdersDto,
  ImportReworkOrdersDto,
  PreviewCuttingFilesDto,
  SetProductionErrorDto,
  TransferOrderDto,
  UpdateOrderDesignDto,
  UpdateOrderFieldDto,
} from 'shared';

import { callApi } from '../apis';
import { CONFIG } from '../constants';

const getOrders = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders${query}`, 'get');
};

const getOrdersByIds = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/by-ids${query}`, 'get');
};

// Dữ liệu tem barcode xưởng — nút "In tem barcode" ở thanh bulk (Orders.md §16.7).
const getBarcodeLabels = (data: GetBarcodeLabelsDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/barcode-labels`, 'post', data);
};

// Dữ liệu label giao hàng 4×6in — menu "..." + thanh bulk (Orders.md §16.8).
const getShippingLabels = (data: GetShippingLabelsDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/shipping-labels`, 'post', data);
};

// Xuất PDF gộp label THẬT của carrier (VNP/khách cấp) — nút "Xuất PDF label"
// ở thanh bulk (Orders.md §16.9). BE tải file label + ghép, trả base64.
const exportShippingLabelsPdf = (data: ExportShippingLabelsDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/shipping-labels/export-pdf`, 'post', data);
};

// Drill-down dashboard — KHÔNG scoping theo role (mọi role thấy cùng tập đơn).
const getOverviewList = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/overview-list${query}`, 'get');
};

const importOrders = (data: ImportProductionOrdersDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/import`, 'post', data);
};

const importRework = (data: ImportReworkOrdersDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/import-rework`, 'post', data);
};

const importFromOnosPod = (data: ImportFromOnosPodDto = {}) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/import-from-onospod`, 'post', data);
};

const deleteOrder = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}`, 'delete');
};

const getDashboard = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/dashboard${query}`, 'get');
};

const updateField = (id: string, data: UpdateOrderFieldDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/field`, 'patch', data);
};

const resolveError = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/resolve-error`, 'post');
};

const bulkResolveError = (ids: string[]) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/bulk-resolve-error`, 'post', { ids });
};

const bulkUpdateField = (data: BulkUpdateOrderFieldDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/bulk-field`, 'patch', data);
};

const getLogs = (id: string, query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/logs${query}`, 'get');
};

const getStatusOverview = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/status-overview${query}`, 'get');
};

const getImportSummary = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/import-summary${query}`, 'get');
};

const getOrdersGrouped = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/grouped${query}`, 'get');
};

const getWorkshopFilters = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/workshop-filters${query}`, 'get');
};

const getFulfillmentStatusCounts = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/fulfillment-status-counts${query}`, 'get');
};

const getFactoryOverview = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/factory-overview${query}`, 'get');
};

const getLifecycleOverview = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/lifecycle-overview${query}`, 'get');
};

const getCancelledOrders = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/cancelled-list${query}`, 'get');
};

const getLifecycleTrack = (code: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/lifecycle-track/${encodeURIComponent(code)}`, 'get');
};

const transferOrder = (id: string, data: TransferOrderDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/transfer`, 'patch', data);
};

const bulkTransferOrders = (data: BulkTransferOrderDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/bulk-transfer`, 'patch', data);
};

const bulkAssignOrders = (data: BulkAssignOrderDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/bulk-assign`, 'patch', data);
};

/** Nút "Tự động gán xưởng" trang Không xác định xưởng — re-map toàn bộ đơn unmapped theo Product Config hiện tại. */
const remapUnmappedOrders = () => {
  return callApi(`/${CONFIG.API_VERSION}/orders/remap-unmapped`, 'post');
};

const backfillFabric = () => {
  return callApi(`/${CONFIG.API_VERSION}/orders/backfill-fabric`, 'post');
};

const exportOrders = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/export${query}`, 'get');
};

const getDesignerBreakdown = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/designer-breakdown${query}`, 'get');
};

const getDesignerBacklog = () => {
  return callApi(`/${CONFIG.API_VERSION}/orders/designer-backlog`, 'get');
};

const bulkAssignDesignerPreview = (data: BulkAssignDesignerPreviewDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/bulk-assign-designer-preview`, 'post', data);
};

const bulkAssignDesigner = (data: BulkAssignDesignerDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/bulk-assign-designer`, 'post', data);
};

const claimDesignerTasks = (data: ClaimDesignerTasksDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/claim-designer-tasks`, 'post', data);
};

const autoAssignPreview = (data: AutoAssignPreviewDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/auto-assign-preview`, 'post', data);
};

const autoAssignApply = (data: AutoAssignApplyDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/auto-assign-apply`, 'post', data);
};

const setProductionError = (id: string, data: SetProductionErrorDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/set-production-error`, 'post', data);
};

const getErrorLog = (query: string = '') => {
  return callApi(`/${CONFIG.API_VERSION}/orders/error-log${query}`, 'get');
};

const getByProductionId = (code: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/by-production-id/${encodeURIComponent(code)}`, 'get');
};

const checkPendingDesigns = (ids: string[]) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/check-pending`, 'post', { ids });
};

const ensurePreview = (sourceUrl: string) => {
  return callApi(`/${CONFIG.API_VERSION}/design-image/ensure-preview`, 'post', { sourceUrl });
};

const previewCuttingFiles = (data: PreviewCuttingFilesDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/cutting-files/preview`, 'post', data);
};

const applyCuttingFiles = (data: ApplyCuttingFilesDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/cutting-files/apply`, 'post', data);
};

const cancelOrder = (id: string, data: CancelOrderDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/cancel`, 'post', data);
};

/** Chuyển hoàn thành — SuperAdmin ép đơn về đã hoàn thành sản xuất (Orders.md §23). */
const forceCompleteOrder = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/force-complete`, 'post', {});
};

const holdOrder = (id: string, data: HoldOrderDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/hold`, 'post', data);
};

const unholdOrder = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/unhold`, 'post', {});
};

const checkDesignFromOnospod = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/check-design-from-onospod`, 'post', {});
};

const bulkCheckDesignFromOnospod = (ids: string[]) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/bulk-check-design-from-onospod`, 'patch', { ids });
};

const bulkHold = (data: BulkHoldOrderDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/bulk-hold`, 'patch', data);
};

/** Soát xong đơn In trả về (tab Soát tool) — đẩy về designer / auto-gán / backlog "Cần gán". */
const markToolCheckDone = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/tool-check-done`, 'post', {});
};

const updateOrderDesign = (id: string, data: UpdateOrderDesignDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}/design`, 'patch', data);
};

export const order = {
  getOrders,
  getOrdersByIds,
  getBarcodeLabels,
  getShippingLabels,
  exportShippingLabelsPdf,
  getOverviewList,
  importOrders,
  importRework,
  importFromOnosPod,
  deleteOrder,
  getDashboard,
  updateField,
  resolveError,
  bulkResolveError,
  bulkUpdateField,
  getLogs,
  getStatusOverview,
  getImportSummary,
  getOrdersGrouped,
  getWorkshopFilters,
  getFulfillmentStatusCounts,
  getFactoryOverview,
  getLifecycleOverview,
  getCancelledOrders,
  getLifecycleTrack,
  transferOrder,
  bulkTransferOrders,
  bulkAssignOrders,
  remapUnmappedOrders,
  backfillFabric,
  exportOrders,
  getDesignerBreakdown,
  getDesignerBacklog,
  bulkAssignDesignerPreview,
  bulkAssignDesigner,
  claimDesignerTasks,
  autoAssignPreview,
  autoAssignApply,
  setProductionError,
  getErrorLog,
  getByProductionId,
  checkPendingDesigns,
  ensurePreview,
  previewCuttingFiles,
  applyCuttingFiles,
  cancelOrder,
  forceCompleteOrder,
  holdOrder,
  unholdOrder,
  checkDesignFromOnospod,
  bulkCheckDesignFromOnospod,
  bulkHold,
  markToolCheckDone,
  updateOrderDesign,
};
