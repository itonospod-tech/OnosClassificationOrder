import type { WalletTxnKind } from 'shared';

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

export const customerWallet = { listWallets, listTransactions };
