import type { AdjustInventoryDto, CreateReceiptInDto, ReconcileInventoryDto, ScanOutDto } from 'shared';

import { callApi } from '../apis';
import { CONFIG } from '../constants';

/** Tồn kho theo xưởng (Inventory-FactoryStock plan) — trang `/ffm/inventory` + trạm quét. */

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') q.set(key, String(value));
  }
  const s = q.toString();

  return s ? `?${s}` : '';
};

const listItems = (params: {
  factoryId: string;
  search?: string;
  negativeOnly?: boolean;
  page?: number;
  limit?: number;
}) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/items${qs(params)}`, 'get');
};

const updateItem = (id: string, data: { name?: string; unit?: string; status?: string; autoCreated?: boolean }) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/items/${id}`, 'patch', data);
};

const createReceiptIn = (data: CreateReceiptInDto) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/receipts/in`, 'post', data);
};

const listReceipts = (params: { factoryId: string; type?: string; page?: number; limit?: number }) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/receipts${qs(params)}`, 'get');
};

const getReceipt = (id: string) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/receipts/${id}`, 'get');
};

const closeOutReceipt = (data: ReconcileInventoryDto) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/receipts/close-out`, 'post', data);
};

const adjust = (data: AdjustInventoryDto) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/adjust`, 'post', data);
};

const scanOutPreview = (productionId: string) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/scan-out/preview/${encodeURIComponent(productionId)}`, 'get');
};

const scanOut = (data: ScanOutDto) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/scan-out`, 'post', data);
};

const listTransactions = (params: {
  factoryId: string;
  kind?: string;
  sku?: string;
  productionId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/transactions${qs(params)}`, 'get');
};

const reconcilePreview = (params: { factoryId: string; date: string }) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/reconcile/preview${qs(params)}`, 'get');
};

const reconcileApply = (data: ReconcileInventoryDto) => {
  return callApi(`/${CONFIG.API_VERSION}/inventory/reconcile/apply`, 'post', data);
};

export const inventory = {
  listItems,
  updateItem,
  createReceiptIn,
  listReceipts,
  getReceipt,
  closeOutReceipt,
  adjust,
  scanOutPreview,
  scanOut,
  listTransactions,
  reconcilePreview,
  reconcileApply,
};
