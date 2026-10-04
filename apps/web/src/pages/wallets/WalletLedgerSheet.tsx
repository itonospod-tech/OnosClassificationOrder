import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { CircleDollarSign, Gauge, SlidersHorizontal } from 'lucide-react';
import type { AdminWalletRow, CreditLimitChange, CustomerWalletTxn, WalletOperationMode, WalletTxnKind } from 'shared';
import { WALLET_TXN_KINDS } from 'shared';

import { RepositoryRemote } from '@/services';

import { PaginationBar } from '@/components/common/PaginationBar';
import { ResponsiveList } from '@/components/common/ResponsiveList';
import { Spinner } from '@/components/common/Spinner';
import { StatCards } from '@/components/common/StatCards';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import WalletActionDialog from './WalletActionDialog';
import { formatUsd, isOverLimit } from './walletFormat';

interface WalletLedgerSheetProps {
  customerId: string | null;
  kind: string | null;
  onKindChange: (kind: string | null) => void;
  onClose: () => void;
  /** A balance or limit was written: the list behind the sheet must reload. */
  onChanged: () => void;
}

const isKind = (value: string | null): value is WalletTxnKind =>
  !!value && (WALLET_TXN_KINDS as readonly string[]).includes(value);

const HISTORY_LIMIT = 10;

/**
 * One seller's wallet: live balance, the money actions, the credit-limit trail and the ledger. The money
 * actions live HERE and not on the list rows on purpose: opening exactly one seller first is a free
 * confirmation (nobody tops up the neighbouring row by mistake), and a row on a phone is one big button, so a
 * button inside it would be both invalid HTML and easy to hit by accident.
 */
export default function WalletLedgerSheet({ customerId, kind, onKindChange, onClose, onChanged }: WalletLedgerSheetProps) {
  const { t } = useTranslation('wallets');
  const [wallet, setWallet] = useState<AdminWalletRow | null>(null);
  const [txns, setTxns] = useState<CustomerWalletTxn[]>([]);
  const [total, setTotal] = useState(0);
  const [history, setHistory] = useState<CreditLimitChange[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<WalletOperationMode | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const activeKind = isKind(kind) ? kind : undefined;

  useEffect(() => {
    setPage(1);
  }, [customerId, activeKind]);

  // Wallet and credit-limit trail are read fresh (never from the list page), so the numbers shown here
  // are the ones the money dialogs will start from.
  useEffect(() => {
    if (!customerId) {
      setWallet(null);
      setHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [walletRes, historyRes] = await Promise.all([
          RepositoryRemote.customerWallet.getWallet(customerId),
          RepositoryRemote.customerWallet.listCreditLimitHistory(customerId, { limit: HISTORY_LIMIT }),
        ]);
        if (cancelled) return;
        setWallet(walletRes.data?.data as AdminWalletRow);
        setHistory((historyRes.data?.data || []) as CreditLimitChange[]);
      } catch (err) {
        if (!cancelled) handleAxiosError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, reloadTick]);

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
  }, [customerId, activeKind, page, pageSize, reloadTick]);

  const handleChanged = useCallback(() => {
    setReloadTick((n) => n + 1);
    onChanged();
  }, [onChanged]);

  const name = wallet ? wallet.fullName || wallet.userSku : (customerId ?? '');

  return (
    <>
      <Sheet open={!!customerId} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{t('ledger.title', { name })}</SheetTitle>
            {wallet && (
              <p className="text-xs text-muted-foreground">{[wallet.userSku, wallet.userEmail].filter(Boolean).join(' · ')}</p>
            )}
          </SheetHeader>

          {wallet && (
            <div className="mt-4 space-y-3">
              <StatCards
                cols={3}
                items={[
                  { label: t('ledger.balance'), value: formatUsd(wallet.balance), tone: wallet.balance < 0 ? 'danger' : 'neutral' },
                  { label: t('ledger.creditLimit'), value: formatUsd(wallet.creditLimit) },
                  {
                    label: t('ledger.available'),
                    value: formatUsd(wallet.balance + wallet.creditLimit),
                    tone: isOverLimit(wallet.balance, wallet.creditLimit) ? 'danger' : 'neutral',
                  },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setAction('topup')}>
                  <CircleDollarSign size={16} className="mr-1.5" />
                  {t('actions.topup')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAction('adjust')}>
                  <SlidersHorizontal size={16} className="mr-1.5" />
                  {t('actions.adjust')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAction('credit')}>
                  <Gauge size={16} className="mr-1.5" />
                  {t('actions.credit')}
                </Button>
              </div>
            </div>
          )}

          <section className="mt-5">
            <h3 className="text-sm font-semibold">{t('ledger.history')}</h3>
            {history.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">{t('ledger.historyEmpty')}</p>
            ) : (
              <ol className="mt-2 space-y-2 border-l border-border pl-3">
                {history.map((change) => (
                  <li key={change._id} className="text-xs">
                    <div className="font-medium tabular-nums">
                      {t('ledger.historyChange', { from: formatUsd(change.from), to: formatUsd(change.to) })}
                    </div>
                    <div className="text-muted-foreground">
                      {change.createdAt ? dayjs(change.createdAt).format('DD/MM/YYYY HH:mm') : ''}
                      {change.byUserName ? ` · ${change.byUserName}` : ''}
                      {change.note ? ` · ${change.note}` : ''}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="mt-5 flex flex-wrap gap-1.5">
            {[undefined, ...WALLET_TXN_KINDS].map((k) => (
              <button
                key={k ?? 'all'}
                type="button"
                onClick={() => onKindChange(k ?? null)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  activeKind === k
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {k ? t(`kinds.${k}`) : t('ledger.kindAll')}
              </button>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            {loading && txns.length === 0 ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : (
              <ResponsiveList
                className="p-3 md:p-0"
                rows={txns}
                rowKey={(txn) => txn._id}
                empty={t('ledger.empty')}
                columns={[
                  {
                    key: 'kind',
                    header: t('ledger.columns.kind'),
                    mobile: 'title',
                    cell: (txn) => <span className="text-xs">{t(`kinds.${txn.kind}`)}</span>,
                  },
                  {
                    key: 'amount',
                    header: t('ledger.columns.amount'),
                    mobile: 'trailing',
                    className: 'text-right',
                    cell: (txn) => (
                      <span
                        className={cn(
                          'whitespace-nowrap font-semibold tabular-nums',
                          txn.amount < 0 ? 'text-tone-danger' : 'text-tone-success',
                        )}
                      >
                        {txn.amount > 0 ? '+' : ''}
                        {formatUsd(txn.amount)}
                      </span>
                    ),
                  },
                  {
                    key: 'balance',
                    header: t('ledger.columns.balance'),
                    className: 'text-right',
                    cell: (txn) => (
                      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {formatUsd(txn.balanceBefore)} → {formatUsd(txn.balanceAfter)}
                      </span>
                    ),
                  },
                  {
                    key: 'time',
                    header: t('ledger.columns.time'),
                    mobile: 'subtitle',
                    cell: (txn) => (
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {txn.createdAt ? dayjs(txn.createdAt).format('DD/MM/YYYY HH:mm') : ''}
                      </span>
                    ),
                  },
                  {
                    key: 'note',
                    header: t('ledger.columns.note'),
                    cell: (txn) => <span className="break-words text-xs text-muted-foreground">{txn.note}</span>,
                  },
                  {
                    key: 'by',
                    header: t('ledger.columns.by'),
                    cell: (txn) => (
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {txn.byUserName || t('ledger.system')}
                      </span>
                    ),
                  },
                ]}
              />
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

      {/* Mounted per operation: a fresh dialog means a fresh idempotency key and a clean form. */}
      {action && customerId && (
        <WalletActionDialog
          mode={action}
          seller={{ customerId, name }}
          onClose={() => setAction(null)}
          onChanged={handleChanged}
          // Reload the ledger (and the list): after a lost connection the write may or may not have landed.
          onViewLedger={() => {
            setAction(null);
            handleChanged();
          }}
        />
      )}
    </>
  );
}
