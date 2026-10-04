'use client';

/**
 * `/hub/wallets` — xem ví seller + bảng giá label (SellerWallet plan §7).
 * Phần này CHỈ ĐỌC với tiền seller: danh sách ví, số dư, hạn mức, drill "Sổ cái" (cùng bảng
 * before → after mà seller thấy ở portal). Nạp / điều chỉnh / đổi hạn mức KHÔNG còn ở đây:
 * một thao tác đụng tiền chỉ nên có MỘT đường vào, và đường đó là `/adm/wallets` (hộp thoại hai bước,
 * đọc lại số dư, ô tích từ $1.000, chống ghi đôi). Hai đường thì mọi lớp bảo vệ phải làm hai lần và
 * sẽ có lúc quên một bên (SellerWallet.md §5.1).
 * Bảng giá: upload CSV `WEIGHT,PRICE` (parse client bằng
 * `parseSellerShipPriceCsv` shared — cùng luật BE) + công tắc tổng.
 */

import dayjs from 'dayjs';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenText, ExternalLink, Power, Upload } from 'lucide-react';
import type { AdminWalletRow, CustomerWalletTxn, SellerShipPriceTable, VnpShipmentStats } from 'shared';
import { parseSellerShipPriceCsv } from 'shared/client';
import { OrdersPagination } from '@/components/orders/orders-pagination';
import { KindBadge, SignedAmount } from '@/components/wallet/wallet-view';
import { Button } from '@/components/shared/button';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { useToast } from '@/components/shared/toast';
import { apiFetch, useApi } from '@/hooks/use-api';
import type { ApiRes } from '@/lib/customer-orders';
import { fmtUSD } from '@/lib/utils';

const LIMIT = 20;

/** Where the staff app lives; money actions are done there. Unset (local dev without it) → no link, nothing breaks. */
const ADMIN_URL = (process.env.NEXT_PUBLIC_ADMIN_URL ?? '').replace(/\/+$/, '');
const adminWalletUrl = (customerId?: string) =>
  `${ADMIN_URL}/adm/wallets${customerId ? `?customer=${encodeURIComponent(customerId)}` : ''}`;

function sellerName(w: AdminWalletRow): string {
  return w.userSku || w.fullName || w.userEmail || w.customerId.slice(-6);
}

export function HubWalletsView() {
  const { t } = useTranslation(['hub', 'seller']);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [ledgerRow, setLedgerRow] = useState<AdminWalletRow | null>(null);

  const listUrl = `/api/hub/v1/admin/customer-wallets?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ''}${activeOnly ? '&activeOnly=true' : ''}`;
  const { data: listRes, loading } = useApi<ApiRes<AdminWalletRow[]> & { total?: number }>(listUrl);
  const rows = listRes?.data ?? [];
  const total = listRes?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-4">
      <PageHeader title={t('hub:wallets.title')} subtitle={t('hub:wallets.subtitle')} />

      {ADMIN_URL && (
        <a
          href={adminWalletUrl()}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border1 bg-card px-3 py-1.5 text-[12px] font-semibold text-text-primary hover:bg-card-hover"
        >
          <ExternalLink size={12} /> {t('hub:wallets.moneyActionsLink')}
        </a>
      )}

      <MoneySummary />

      <PriceTableCard />

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t('hub:sellers.search')} className="sm:max-w-xs" />
        <label className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
          <input type="checkbox" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setPage(1); }} className="accent-[var(--color-accent)]" />
          {t('hub:wallets.activeOnly')}
        </label>
      </div>

      <div className="bg-card border border-border1 rounded-xl overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('hub:wallets.empty')} />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wider text-text-muted border-b border-border1">
                    <th className="px-4 py-2 font-semibold">{t('hub:wallets.columns.seller')}</th>
                    <th className="px-3 py-2 font-semibold text-right">{t('hub:wallets.columns.balance')}</th>
                    <th className="px-3 py-2 font-semibold text-right">{t('hub:wallets.columns.creditLimit')}</th>
                    <th className="px-3 py-2 font-semibold">{t('hub:wallets.columns.lastTxn')}</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.customerId} className="border-t border-border2 hover:bg-card-hover">
                      <td className="px-4 py-2">
                        <p className="font-semibold text-text-primary">{w.userSku || '—'}{w.tier != null ? ` · VIP ${w.tier}` : ''}</p>
                        <p className="text-[10px] text-text-muted truncate max-w-[200px]">{w.fullName || w.userEmail}</p>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${w.balance < 0 ? 'text-error' : 'text-text-primary'}`}>{fmtUSD(w.balance)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtUSD(w.creditLimit)}</td>
                      <td className="px-3 py-2 text-text-muted whitespace-nowrap">{w.lastTxnAt ? dayjs(w.lastTxnAt).format('DD/MM/YYYY HH:mm') : '—'}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <span className="inline-flex gap-1">
                          {ADMIN_URL && (
                            <a href={adminWalletUrl(w.customerId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border1 px-2.5 py-1 text-[11px] font-semibold text-text-primary hover:bg-card-hover">
                              <ExternalLink size={12} /> {t('hub:wallets.manageInAdmin')}
                            </a>
                          )}
                          <Button variant="outline" size="sm" onClick={() => setLedgerRow(w)}><BookOpenText size={12} /> {t('hub:wallets.ledger')}</Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-border2">
              {rows.map((w) => (
                <div key={w.customerId} className="px-4 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text-primary truncate">{w.userSku || w.fullName || w.userEmail}</p>
                      <p className="text-[10px] text-text-muted">{w.lastTxnAt ? dayjs(w.lastTxnAt).format('DD/MM HH:mm') : '—'}</p>
                    </div>
                    <span className={`tabular-nums text-sm font-bold ${w.balance < 0 ? 'text-error' : 'text-text-primary'}`}>{fmtUSD(w.balance)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ADMIN_URL && (
                      <a href={adminWalletUrl(w.customerId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-border1 px-2.5 py-1 text-[11px] font-semibold text-text-primary hover:bg-card-hover">
                        {t('hub:wallets.manageInAdmin')}
                      </a>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setLedgerRow(w)}>{t('hub:wallets.ledger')}</Button>
                  </div>
                </div>
              ))}
            </div>

            <OrdersPagination page={page} limit={LIMIT} pages={pages} total={total} onChange={(next) => next.page && setPage(next.page)} />
          </>
        )}
      </div>

      {ledgerRow && <LedgerDialog row={ledgerRow} onClose={() => setLedgerRow(null)} />}
    </div>
  );
}

/**
 * Tổng quan tiền label — "vào" = Σ sellerPrice seller trả mình, "ra" = Σ chi VNP
 * (mọi label, kể cả admin mua), lãi = vào − chi VNP của riêng nhóm seller mua.
 * Số tính ở BE `getShipmentStats()`; ví VNP đọc sống từ hãng.
 */
function MoneySummary() {
  const { t } = useTranslation('hub');
  const { data: statsRes } = useApi<ApiRes<VnpShipmentStats>>('/api/hub/v1/shipping-vnp/shipments/stats');
  const { data: walletRes } = useApi<ApiRes<{ balance?: string | null }>>('/api/hub/v1/shipping-vnp/wallet');
  const totals = statsRes?.data?.totals;
  const cards: { key: string; value: string; tone?: 'in' | 'out' }[] = [
    { key: 'vnpWallet', value: walletRes?.data?.balance != null ? fmtUSD(Number(walletRes.data.balance)) : '…' },
    {
      key: 'revenue',
      value: totals ? `${fmtUSD(totals.sellerRevenue ?? 0)} (${totals.sellerLabelCount ?? 0})` : '…',
      tone: 'in',
    },
    { key: 'cost', value: totals ? fmtUSD(totals.cost ?? 0) : '…', tone: 'out' },
    { key: 'margin', value: totals ? fmtUSD((totals.sellerRevenue ?? 0) - (totals.sellerCost ?? 0)) : '…' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.key} className="bg-card border border-border1 rounded-xl px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">{t(`wallets.summary.${c.key}`)}</p>
          <p className={`text-base font-bold tabular-nums ${c.tone === 'in' ? 'text-success' : c.tone === 'out' ? 'text-error' : 'text-text-primary'}`}>
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Bảng giá label + công tắc tổng — card trên đầu trang. */
function PriceTableCard() {
  const { t } = useTranslation('hub');
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data, refetch } = useApi<ApiRes<SellerShipPriceTable | null>>('/api/hub/v1/admin/seller-shipping/price-table');
  const table = data?.data ?? null;
  const enabled = table?.enabled ?? true;

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const rows = parseSellerShipPriceCsv(await file.text());
      const res = await apiFetch<ApiRes<{ rowCount: number; maxWeightGram: number }>>(
        '/api/hub/v1/admin/seller-shipping/price-table/import',
        { method: 'POST', body: JSON.stringify({ rows }) },
      );
      toast('success', t('wallets.uploadDone', { count: res.data.rowCount, max: res.data.maxWeightGram }));
      refetch();
    } catch (e) {
      toast('error', t('wallets.uploadError', { message: (e as Error).message }));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggle = async () => {
    if (!table) return;
    setBusy(true);
    try {
      await apiFetch('/api/hub/v1/admin/seller-shipping/toggle', { method: 'POST', body: JSON.stringify({ enabled: !enabled }) });
      refetch();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card border border-border1 rounded-xl p-4 space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{t('wallets.priceTable')}</h2>
          {table ? (
            <p className="text-xs text-text-primary">
              {t('wallets.priceTableCount', { count: table.rows.length, max: table.rows[table.rows.length - 1]?.weightGram ?? 0 })}
              {table.updatedAt && <span className="text-text-muted"> · {t('wallets.priceTableUpdated', { when: dayjs(table.updatedAt).format('DD/MM/YYYY HH:mm') })}</span>}
            </p>
          ) : (
            <p className="text-xs text-warning font-semibold">{t('wallets.priceTableEmpty')}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {table && (
            <Button variant="outline" size="sm" onClick={toggle} disabled={busy}>
              <Power size={12} className={enabled ? 'text-success' : 'text-error'} />
              {t('wallets.enabled')}: {enabled ? t('wallets.toggleOn') : t('wallets.toggleOff')}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} loading={busy}>
            <Upload size={12} /> {t('wallets.upload')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </div>
      </div>
      <p className="text-[10px] text-text-muted">{t('wallets.priceTableHint')}</p>
    </div>
  );
}

function LedgerDialog({ row, onClose }: { row: AdminWalletRow; onClose: () => void }) {
  const { t } = useTranslation(['hub', 'seller']);
  const [page, setPage] = useState(1);
  const url = `/api/hub/v1/admin/customer-wallets/${row.customerId}/transactions?page=${page}&limit=${LIMIT}`;
  const { data, loading } = useApi<ApiRes<CustomerWalletTxn[]> & { total?: number }>(url);
  const txns = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'var(--color-overlay)' }} onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-card rounded-xl border border-border1 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border1">
          <h2 className="text-sm font-bold text-text-primary">{t('hub:wallets.ledgerTitle', { name: sellerName(row) })}</h2>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading && txns.length === 0 ? (
            <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : txns.length === 0 ? (
            <EmptyState title={t('seller:wallet.empty')} />
          ) : (
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
                    <td className="px-4 py-2 text-text-muted max-w-[220px] truncate" title={txn.note}>
                      {txn.note || '—'}
                      {txn.byUserName && <span className="text-[9px]"> · {txn.byUserName}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > LIMIT && <OrdersPagination page={page} limit={LIMIT} pages={pages} total={total} onChange={(next) => next.page && setPage(next.page)} />}
      </div>
    </div>
  );
}
