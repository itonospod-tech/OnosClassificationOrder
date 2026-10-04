'use client';

/**
 * Trang Ví seller (`/portal/wallet` — plan SellerWallet-LabelPurchase §6):
 * số dư + hạn mức, sổ cái MỖI record hiện `balanceBefore → balanceAfter`
 * (yêu cầu tường minh của user), bảng giá vận đơn công khai. Nạp tiền phase 1
 * là chuyển khoản ngoài hệ thống → admin cộng ở hub, nên ở đây chỉ có hint.
 */

import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Wallet } from 'lucide-react';
import type { CustomerWallet, CustomerWalletTxn, SellerShipPriceTable, WalletTxnKind } from 'shared';
import { WALLET_TXN_KINDS } from 'shared/client';
import { OrdersPagination } from '@/components/orders/orders-pagination';
import { Badge } from '@/components/shared/badge';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { useApi } from '@/hooks/use-api';
import type { ApiRes } from '@/lib/customer-orders';
import { fmtUSD } from '@/lib/utils';

const LIMIT = 20;

const KIND_COLORS: Record<WalletTxnKind, string> = {
  topup: '#48a05c',
  label: '#c40c68',
  label_refund: '#7f9a2b',
  order: '#6b7280',
  adjust: '#c9a400',
  import_tax: '#8a5cc2',
  active: '#2f7fc1',
  refund: '#3b9a8f',
};

export function KindBadge({ kind }: { kind: WalletTxnKind }) {
  const { t } = useTranslation('seller');
  const color = KIND_COLORS[kind] ?? '#6b7280';
  return <Badge bg={color + '18'} color={color}>{t(`wallet.kinds.${kind}`)}</Badge>;
}

/** Số tiền có dấu — dương xanh, âm đỏ; sổ cái phải đọc được bằng mắt thường. */
export function SignedAmount({ v }: { v: number }) {
  return (
    <span className={`tabular-nums font-semibold ${v >= 0 ? 'text-success' : 'text-error'}`}>
      {v >= 0 ? '+' : '−'}{fmtUSD(Math.abs(v))}
    </span>
  );
}

export function WalletView() {
  const { t } = useTranslation(['seller', 'hub']);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<WalletTxnKind | ''>('');
  const [showPrices, setShowPrices] = useState(false);

  const { data: walletRes } = useApi<ApiRes<CustomerWallet>>('/api/v1/customer/wallet');
  const txnUrl = `/api/v1/customer/wallet/transactions?page=${page}&limit=${LIMIT}${kind ? `&kind=${kind}` : ''}`;
  const { data: txnRes, loading } = useApi<ApiRes<CustomerWalletTxn[]> & { total?: number }>(txnUrl);
  const { data: priceRes } = useApi<ApiRes<SellerShipPriceTable | null>>(
    showPrices ? '/api/v1/customer/shipping/price-table' : null,
  );

  const wallet = walletRes?.data;
  const txns = txnRes?.data ?? [];
  const total = txnRes?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const priceRows = priceRes?.data?.rows ?? [];

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader title={t('seller:wallet.title')} subtitle={t('seller:wallet.subtitle')} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-card border border-border1 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-wider">
            <Wallet size={12} /> {t('seller:wallet.balance')}
          </div>
          <p className={`mt-1 text-xl font-bold tabular-nums ${(wallet?.balance ?? 0) < 0 ? 'text-error' : 'text-text-primary'}`}>
            {wallet ? fmtUSD(wallet.balance) : '—'}
          </p>
        </div>
        <div className="bg-card border border-border1 rounded-xl p-4">
          <div className="text-[10px] text-text-muted font-semibold uppercase tracking-wider">{t('seller:wallet.creditLimit')}</div>
          <p className="mt-1 text-xl font-bold tabular-nums text-text-primary">{wallet ? fmtUSD(wallet.creditLimit) : '—'}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowPrices((v) => !v)}
          className="bg-card border border-border1 rounded-xl p-4 text-left hover:border-accent transition-colors"
        >
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted font-semibold uppercase tracking-wider">
            <Truck size={12} /> {t('seller:wallet.priceTable')}
          </div>
          <p className="mt-1 text-[11px] text-accent font-semibold">{showPrices ? '▲' : '▼'}</p>
        </button>
      </div>

      {showPrices && (
        <div className="bg-card border border-border1 rounded-xl p-4">
          {priceRows.length === 0 ? (
            <p className="text-xs text-text-muted">{t('seller:wallet.priceTableEmpty')}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-1">
              {priceRows.map((r) => (
                <div key={r.weightGram} className="flex justify-between text-[11px] border-b border-border2 py-0.5">
                  <span className="text-text-muted">{t('seller:wallet.priceRow', { gram: r.weightGram })}</span>
                  <span className="tabular-nums font-medium">{fmtUSD(r.price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-text-muted bg-surface-muted border border-border2 rounded-lg px-3 py-2">{t('seller:wallet.topupHint')}</p>

      <div className="bg-card border border-border1 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border1">
          <h2 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{t('seller:wallet.history')}</h2>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as WalletTxnKind | '');
              setPage(1);
            }}
            className="px-2 py-1 rounded-md border border-border1 bg-card text-[11px] outline-none"
          >
            <option value="">{t('seller:wallet.kindAll')}</option>
            {WALLET_TXN_KINDS.map((k) => (
              <option key={k} value={k}>{t(`seller:wallet.kinds.${k}`)}</option>
            ))}
          </select>
        </div>

        {loading && txns.length === 0 ? (
          <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
        ) : txns.length === 0 ? (
          <EmptyState title={t('seller:wallet.empty')} />
        ) : (
          <>
            {/* Bảng desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-text-muted border-b border-border1">
                    <th className="px-4 py-2 font-semibold">{t('seller:wallet.columns.when')}</th>
                    <th className="px-3 py-2 font-semibold">{t('seller:wallet.columns.kind')}</th>
                    <th className="px-3 py-2 font-semibold text-right">{t('seller:wallet.columns.amount')}</th>
                    <th className="px-3 py-2 font-semibold text-right">{t('seller:wallet.columns.before')}</th>
                    <th className="px-3 py-2 font-semibold text-right">{t('seller:wallet.columns.after')}</th>
                    <th className="px-4 py-2 font-semibold">{t('seller:wallet.columns.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((txn) => (
                    <tr key={txn._id} className="border-t border-border2">
                      <td className="px-4 py-2 whitespace-nowrap text-text-muted">{txn.createdAt ? dayjs(txn.createdAt).format('DD/MM/YYYY HH:mm') : '—'}</td>
                      <td className="px-3 py-2"><KindBadge kind={txn.kind} /></td>
                      <td className="px-3 py-2 text-right"><SignedAmount v={txn.amount} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtUSD(txn.balanceBefore)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-text-primary">{fmtUSD(txn.balanceAfter)}</td>
                      <td className="px-4 py-2 text-text-muted max-w-[240px] truncate" title={txn.note}>{txn.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Thẻ mobile — quy tắc responsive của app */}
            <div className="md:hidden divide-y divide-border2">
              {txns.map((txn) => (
                <div key={txn._id} className="px-4 py-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <KindBadge kind={txn.kind} />
                    <SignedAmount v={txn.amount} />
                  </div>
                  <p className="text-[10px] text-text-muted">
                    {txn.createdAt ? dayjs(txn.createdAt).format('DD/MM/YYYY HH:mm') : '—'} · {fmtUSD(txn.balanceBefore)} → <span className="font-semibold text-text-primary">{fmtUSD(txn.balanceAfter)}</span>
                  </p>
                  {txn.note && <p className="text-[10px] text-text-muted">{txn.note}</p>}
                </div>
              ))}
            </div>

            <OrdersPagination page={page} limit={LIMIT} pages={pages} total={total} onChange={(next) => next.page && setPage(next.page)} />
          </>
        )}
      </div>
    </div>
  );
}
