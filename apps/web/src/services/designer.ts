import type {
  CreateDesignerTeamMemberDto,
  DesignerBulkTransitionDto,
  DesignerTransitionDto,
  ResetDesignerPasswordDto,
  UpdateDesignerTeamMemberDto,
} from 'shared';

import { callApi } from '../apis';
import { CONFIG } from '../constants';

const listTeam = (status?: string) => {
  const qs = status ? `?status=${status}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/team${qs}`, 'get');
};

const createMember = (data: CreateDesignerTeamMemberDto) => {
  return callApi(`/${CONFIG.API_VERSION}/designer/team`, 'post', data);
};

const updateMember = (userId: string, data: UpdateDesignerTeamMemberDto) => {
  return callApi(`/${CONFIG.API_VERSION}/designer/team/${userId}`, 'patch', data);
};

const removeMember = (userId: string) => {
  return callApi(`/${CONFIG.API_VERSION}/designer/team/${userId}`, 'delete');
};

const resetPassword = (userId: string, data: ResetDesignerPasswordDto) => {
  return callApi(`/${CONFIG.API_VERSION}/designer/team/${userId}/reset-password`, 'post', data);
};

const migrateLeader = () => {
  return callApi(`/${CONFIG.API_VERSION}/designer/migrate-leader`, 'post');
};

// ─── Phase 3 transition + Phase 4 my-tasks/my-stats ────────────────────

const transition = (orderId: string, data: DesignerTransitionDto) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${orderId}/designer-transition`, 'post', data);
};

const myTasks = (
  params: {
    from?: string;
    to?: string;
    type?: string;
    fabricType?: string;
    machineNumber?: string;
    toolResult?: string;
    toolResultNote?: string;
    userSku?: string;
    errorFile?: string;
    search?: string;
    /** Admin xem thay task của designer khác — xem `GetMyTasksZod.viewUserId`. */
    viewUserId?: string;
  } = {},
) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/my-tasks${suffix}`, 'get');
};

const myTaskFilters = (
  params: {
    from?: string;
    to?: string;
    type?: string;
    fabricType?: string;
    machineNumber?: string;
    toolResult?: string;
    toolResultNote?: string;
    userSku?: string;
    errorFile?: string;
    /** Phải khớp `viewUserId` của myTasks, nếu không facet count lệch với kanban. */
    viewUserId?: string;
  } = {},
) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/my-task-filters${suffix}`, 'get');
};

const bulkTransition = (data: DesignerBulkTransitionDto) => {
  return callApi(`/${CONFIG.API_VERSION}/designer/bulk-transition`, 'post', data);
};

const getOrderById = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/orders/${id}`, 'get');
};

const myStats = (params: { period?: string; from?: string; to?: string; viewUserId?: string } = {}) => {
  const qs = new URLSearchParams();
  qs.set('period', params.period || 'today');
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.viewUserId) qs.set('viewUserId', params.viewUserId);
  return callApi(`/${CONFIG.API_VERSION}/designer/my-stats?${qs.toString()}`, 'get');
};

const myDailyBreakdown = (params: { days?: 7 | 14 | 30; viewUserId?: string } = {}) => {
  const qs = new URLSearchParams();
  qs.set('days', String(params.days || 7));
  if (params.viewUserId) qs.set('viewUserId', params.viewUserId);
  return callApi(`/${CONFIG.API_VERSION}/designer/my-daily-breakdown?${qs.toString()}`, 'get');
};

const backfillDesignerStatus = () => {
  return callApi(`/${CONFIG.API_VERSION}/orders/backfill-designer-status`, 'post');
};

// ─── Phase 5 stats ──────────────────────────────────────────────────────

const performance = (params: { from?: string; to?: string; userId?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.userId) qs.set('userId', params.userId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/performance${suffix}`, 'get');
};

const timeline = (userId: string, params: { from?: string; to?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/timeline/${userId}${suffix}`, 'get');
};

const teamDailyBreakdown = (
  params: { days?: 7 | 14 | 30; from?: string; to?: string; type?: string; customer?: string } = {},
) => {
  const qs = new URLSearchParams();
  qs.set('days', String(params.days || 7));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.type) qs.set('type', params.type);
  if (params.customer) qs.set('customer', params.customer);
  return callApi(`/${CONFIG.API_VERSION}/designer/team-daily-breakdown?${qs.toString()}`, 'get');
};

const performanceScores = (params: { from?: string; to?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/performance-scores${suffix}`, 'get');
};

const setDesignerLevel = (userId: string, level: string | null) => {
  return callApi(`/${CONFIG.API_VERSION}/designer/level/${userId}`, 'patch', { level });
};

const breakdownFilters = (params: { from?: string; to?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/breakdown-filters${suffix}`, 'get');
};

const productTimeOverview = (
  params: { from?: string; to?: string; type?: string; customer?: string; designerId?: string } = {},
) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.type) qs.set('type', params.type);
  if (params.customer) qs.set('customer', params.customer);
  if (params.designerId) qs.set('designerId', params.designerId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/product-time-overview${suffix}`, 'get');
};

const productTimeOrders = (params: {
  type: string;
  from?: string;
  to?: string;
  customer?: string;
  designerId?: string;
}) => {
  const qs = new URLSearchParams();
  qs.set('type', params.type);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.customer) qs.set('customer', params.customer);
  if (params.designerId) qs.set('designerId', params.designerId);
  return callApi(`/${CONFIG.API_VERSION}/designer/product-time-orders?${qs.toString()}`, 'get');
};

const dailyOverview = (
  params: { days?: 7 | 14 | 30; from?: string; to?: string; type?: string; customer?: string } = {},
) => {
  const qs = new URLSearchParams();
  qs.set('days', String(params.days || 7));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.type) qs.set('type', params.type);
  if (params.customer) qs.set('customer', params.customer);
  return callApi(`/${CONFIG.API_VERSION}/designer/daily-overview?${qs.toString()}`, 'get');
};

const assignBacklog = (
  params: { days?: 7 | 14 | 30; from?: string; to?: string; type?: string; customer?: string } = {},
) => {
  const qs = new URLSearchParams();
  qs.set('days', String(params.days || 7));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.type) qs.set('type', params.type);
  if (params.customer) qs.set('customer', params.customer);
  return callApi(`/${CONFIG.API_VERSION}/designer/assign-backlog?${qs.toString()}`, 'get');
};

const productBreakdown = (
  params: { days?: 7 | 14 | 30; from?: string; to?: string; type?: string; customer?: string } = {},
) => {
  const qs = new URLSearchParams();
  qs.set('days', String(params.days || 7));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.type) qs.set('type', params.type);
  if (params.customer) qs.set('customer', params.customer);
  return callApi(`/${CONFIG.API_VERSION}/designer/product-breakdown?${qs.toString()}`, 'get');
};

const toolCheckOverview = (
  params: {
    days?: 7 | 14 | 30;
    from?: string;
    to?: string;
    type?: string;
    customer?: string;
    machineNumber?: string;
    priority?: string;
    productLine?: string;
  } = {},
) => {
  const qs = new URLSearchParams();
  qs.set('days', String(params.days || 7));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.type) qs.set('type', params.type);
  if (params.customer) qs.set('customer', params.customer);
  if (params.machineNumber) qs.set('machineNumber', params.machineNumber);
  if (params.priority) qs.set('priority', params.priority);
  if (params.productLine) qs.set('productLine', params.productLine);
  return callApi(`/${CONFIG.API_VERSION}/designer/tool-check-overview?${qs.toString()}`, 'get');
};

const errorStats = (params: { from?: string; to?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/orders/error-stats${suffix}`, 'get');
};

const personErrorOverview = (params: { from?: string; to?: string; days?: number; factoryId?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.days) qs.set('days', String(params.days));
  if (params.factoryId) qs.set('factoryId', params.factoryId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/designer/person-error-overview${suffix}`, 'get');
};

const personErrorOrders = (params: { userId: string; from?: string; to?: string; days?: number }) => {
  const qs = new URLSearchParams();
  qs.set('userId', params.userId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.days) qs.set('days', String(params.days));
  return callApi(`/${CONFIG.API_VERSION}/designer/person-error-orders?${qs.toString()}`, 'get');
};

const stageErrorDaily = (
  params: { stage?: string; factoryId?: string; from?: string; to?: string; days?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (params.stage) qs.set('stage', params.stage);
  if (params.factoryId) qs.set('factoryId', params.factoryId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.days) qs.set('days', String(params.days));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return callApi(`/${CONFIG.API_VERSION}/fulfillment/stage-error-daily${suffix}`, 'get');
};

const sidebarCounts = () => {
  return callApi(`/${CONFIG.API_VERSION}/designer/sidebar-counts`, 'get');
};

const overdueAlert = () => {
  return callApi(`/${CONFIG.API_VERSION}/designer/overdue-alert`, 'get');
};

export const designer = {
  listTeam,
  createMember,
  updateMember,
  removeMember,
  resetPassword,
  migrateLeader,
  transition,
  myTasks,
  myTaskFilters,
  bulkTransition,
  getOrderById,
  myStats,
  myDailyBreakdown,
  backfillDesignerStatus,
  performance,
  timeline,
  teamDailyBreakdown,
  breakdownFilters,
  productTimeOverview,
  productTimeOrders,
  performanceScores,
  setDesignerLevel,
  dailyOverview,
  assignBacklog,
  productBreakdown,
  toolCheckOverview,
  errorStats,
  personErrorOverview,
  personErrorOrders,
  stageErrorDaily,
  sidebarCounts,
  overdueAlert,
};
