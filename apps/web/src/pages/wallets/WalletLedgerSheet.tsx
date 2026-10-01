import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { AdminWalletRow, CustomerWalletTxn, WalletTxnKind } from 'shared';
import { WALLET_TXN_KINDS } from 'shared';

import { RepositoryRemote } from '@/services';

import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { formatUsd, isOverLimit } from './walletFormat';

interface WalletLedgerSheetProps {
  customerId: string | null;
  /** The list row, when the seller is on the current page — gives the name and live balance. */
  row: AdminWalletRow | null;
  kind: string | null;
  onKindChange: (kind: string | null) => void;
  onClose: () => void;
}

const isKind = (value: string | null): value is WalletTxnKind =>
  !!value && (WALLET_TXN_KINDS as readonly string[]).includes(value);

export default function WalletLedgerSheet({ customerId, row, kind, onKindChange, onClose }: WalletLedgerSheetProps) {
  const { t } = useTranslation('wallets');
  const [txns, setTxns] = useState<CustomerWalletTxn[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const activeKind = isKind(kind) ? kind : undefined;

  useEffect(() => {
    setPage(1);
  }, [customerId, activeKind]);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await RepositoryRemote.customerWallet.listTransactions(customerId, {
          kind: activeKind,
          page,
          limit: pageSize,
        });
        if (cancelled) return;
        setTxns((res.data?.data || []) as CustomerWalletTxn[]);
        setTotal((res.data?.total as number) || 0);
      } catch (err) {
        if (!cancelled) handleAxiosError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, activeKind, page, pageSize]);

  const name = row ? row.fullName || row.userSku : customerId ?? '';

  return (
    <Sheet open={!!customerId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{t('ledger.title', { name })}</SheetTitle>
          {row && <p className="text-xs text-slate-500">{[row.userSku, row.userEmail].filter(Boolean).join(' · ')}</p>}
        </SheetHeader>

        {row && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label={t('ledger.balance')} value={formatUsd(row.balance)} danger={row.balance < 0} />
            <Stat label={t('ledger.creditLimit')} value={formatUsd(row.creditLimit)} />
            <Stat
              label={t('ledger.available')}
              value={formatUsd(row.balance + row.creditLimit)}
              danger={isOverLimit(row.balance, row.creditLimit)}
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5">
          {[undefined, ...WALLET_TXN_KINDS].map((k) => (
            <button
              key={k ?? 'all'}
              type="button"
              onClick={() => onKindChange(k ?? null)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                activeKind === k
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {k ? t(`kinds.${k}`) : t('ledger.kindAll')}
            </button>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ledger.columns.time')}</TableHead>
                <TableHead>{t('ledger.columns.kind')}</TableHead>
                <TableHead className="text-right">{t('ledger.columns.amount')}</TableHead>
                <TableHead className="text-right">{t('ledger.columns.balance')}</TableHead>
                <TableHead>{t('ledger.columns.note')}</TableHead>
                <TableHead>{t('ledger.columns.by')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txns.map((txn) => (
                <TableRow key={txn._id}>
                  <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                    {txn.createdAt ? dayjs(txn.createdAt).format('DD/MM/YYYY HH:mm') : ''}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{t(`kinds.${txn.kind}`)}</TableCell>
                  <TableCell
                    className={cn(
                      'whitespace-nowrap text-right font-semibold tabular-nums',
                      txn.amount < 0 ? 'text-red-600' : 'text-emerald-600',
                    )}
                  >
                    {txn.amount > 0 ? '+' : ''}
                    {formatUsd(txn.amount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                    {formatUsd(txn.balanceBefore)} → {formatUsd(txn.balanceAfter)}
                  </TableCell>
                  <TableCell className="max-w-[220px] break-words text-xs text-slate-600 dark:text-slate-300">
                    {txn.note}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                    {txn.byUserName || t('ledger.system')}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && txns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    {t('ledger.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {loading && txns.length === 0 && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
        </div>

        <div className="mt-3">
          <PaginationBar
            position="bottom"
            page={page}
            pageSize={pageSize}
            total={total}
            loading={loading}
            onChange={(p, s) => {
              setPage(p);
              setPageSize(s);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          danger ? 'text-red-600' : 'text-slate-800 dark:text-slate-100',
        )}
      >
        {value}
      </div>
    </div>
  );
}
