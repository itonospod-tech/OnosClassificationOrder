import type { AdjustWalletDto, TopupWalletDto, UpdateCreditLimitDto, WalletTxnKind } from 'shared';

import { callApi } from '../apis';
import { CONFIG } from '../constants';

/** Seller wallets, staff side (`/adm/wallets`) — read-only for now, backed by `admin/customer-wallets*`. */

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') q.set(key, String(value));
  }
  const s = q.toString();

  return s ? `?${s}` : '';
};

const listWallets = (params: { search?: string; activeOnly?: boolean; page?: number; limit?: number }) => {
  return callApi(`/${CONFIG.API_VERSION}/admin/customer-wallets${qs(params)}`, 'get');
};

const listTransactions = (customerId: string, params: { kind?: WalletTxnKind; page?: number; limit?: number }) => {
  return callApi(
    `/${CONFIG.API_VERSION}/admin/customer-wallets/${encodeURIComponent(customerId)}/transactions${qs(params)}`,
    'get',
  );
};

/** Ledger across ALL sellers; `from`/`to` are YYYY-MM-DD days in Vietnam time. */
const listAllTransactions = (params: {
  search?: string;
  customerId?: string;
  kind?: WalletTxnKind;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) => {
  return callApi(`/${CONFIG.API_VERSION}/admin/customer-wallets/transactions${qs(params)}`, 'get');
};

/** One seller's wallet, read fresh — what the money dialogs decide from, never a list row that may be stale. */
const getWallet = (customerId: string) => {
  return callApi(`/${CONFIG.API_VERSION}/admin/customer-wallets/${encodeURIComponent(customerId)}`, 'get');
};

const listCreditLimitHistory = (customerId: string, params: { page?: number; limit?: number } = {}) => {
  return callApi(
    `/${CONFIG.API_VERSION}/admin/customer-wallets/${encodeURIComponent(customerId)}/credit-limit-history${qs(params)}`,
    'get',
  );
};

// Money-moving calls. `requestId` is the idempotency key the dialog keeps stable across retries.
const topup = (customerId: string, body: TopupWalletDto) => {
  return callApi(`/${CONFIG.API_VERSION}/admin/customer-wallets/${encodeURIComponent(customerId)}/topup`, 'post', body);
};

const adjust = (customerId: string, body: AdjustWalletDto) => {
  return callApi(`/${CONFIG.API_VERSION}/admin/customer-wallets/${encodeURIComponent(customerId)}/adjust`, 'post', body);
};

const setCreditLimit = (customerId: string, body: UpdateCreditLimitDto) => {
  return callApi(
    `/${CONFIG.API_VERSION}/admin/customer-wallets/${encodeURIComponent(customerId)}/credit-limit`,
    'patch',
    body,
  );
};

export const customerWallet = {
  listWallets,
  listTransactions,
  listAllTransactions,
  getWallet,
  listCreditLimitHistory,
  topup,
  adjust,
  setCreditLimit,
};
