import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { ReceiptText, RefreshCw, Search } from 'lucide-react';
import type { AdminWalletTxnRow, WalletTxnKind } from 'shared';
import { WALLET_TXN_KINDS } from 'shared';

import { PATHS } from '@/constants/paths';

import { RepositoryRemote } from '@/services';

import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

import { formatUsd } from './walletFormat';
import { DEFAULT_WALLET_RANGE, isWalletRange, resolveWalletRange, WALLET_RANGES } from './walletRange';

const MAX_ORDERS_SHOWN = 2;

const isKind = (value: string | null): value is WalletTxnKind =>
  !!value && (WALLET_TXN_KINDS as readonly string[]).includes(value);

/**
 * Staff ledger across all sellers (legacy Billing › Transactions). Every filter lives on the URL so a menu link can
 * carry a meaningful default (MenuRestructure-CEO.md §8.1) and a filtered view can be shared:
 * `?range=today|yesterday|7d|month|lastMonth|all`, or explicit `?from=&to=` (YYYY-MM-DD), plus `kind`, `search`,
 * `customer`. No param at all means the last 7 days — never "all time" on a table that only grows.
 */
export default function WalletTransactionsPage() {
  const { isAdmin } = usePermission();
  if (!isAdmin) return <Navigate to={PATHS.HOME} replace />;

  return <WalletTransactionsContent />;
}

function WalletTransactionsContent() {
  const { t } = useTranslation('wallets');
  const [params, setParams] = useSearchParams();

  const explicitFrom = params.get('from') ?? '';
  const explicitTo = params.get('to') ?? '';
  const isCustomRange = !!(explicitFrom || explicitTo);
  const rangeParam = params.get('range');
  const range = isWalletRange(rangeParam) ? rangeParam : DEFAULT_WALLET_RANGE;
  const kind = isKind(params.get('kind')) ? (params.get('kind') as WalletTxnKind) : undefined;
  const search = params.get('search') ?? '';
  const customerId = params.get('customer') ?? undefined;

  // Presets resolve against "now" once per render of the param change, which is all a list view needs.
  const { from, to } = useMemo(
    () => (isCustomRange ? { from: explicitFrom || undefined, to: explicitTo || undefined } : resolveWalletRange(range)),
    [isCustomRange, explicitFrom, explicitTo, range],
  );

  const [rows, setRows] = useState<AdminWalletTxnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const [reloadTick, setReloadTick] = useState(0);

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    setPage(1);
  }, [from, to, kind, search, customerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await RepositoryRemote.customerWallet.listAllTransactions({
          search: search.trim() || undefined,
          customerId,
          kind,
          from,
          to,
          page,
          limit: pageSize,
        });
        if (cancelled) return;
        setRows((res.data?.data || []) as AdminWalletTxnRow[]);
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
  }, [search, customerId, kind, from, to, page, pageSize, reloadTick]);

  const pickRange = (next: (typeof WALLET_RANGES)[number]) => updateParams({ range: next, from: null, to: null });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800 dark:text-slate-100">
            <ReceiptText size={20} /> {t('txns.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t('txns.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={PATHS.WALLETS}>{t('nav.wallets')}</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setReloadTick((n) => n + 1)} disabled={loading}>
            <RefreshCw size={16} className={cn('mr-1.5', loading && 'animate-spin')} />
            {t('refresh')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {WALLET_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => pickRange(r)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              !isCustomRange && range === r
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {t(`txns.range.${r}`)}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-500">
          {t('txns.from')}
          <Input
            type="date"
            value={explicitFrom}
            max={explicitTo || undefined}
            onChange={(e) => updateParams({ from: e.target.value || null, range: null })}
            className="h-8 w-36"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          {t('txns.to')}
          <Input
            type="date"
            value={explicitTo}
            min={explicitFrom || undefined}
            onChange={(e) => updateParams({ to: e.target.value || null, range: null })}
            className="h-8 w-36"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form
          className="relative w-full max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            updateParams({ search: searchInput.trim() || null });
          }}
        >
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => updateParams({ search: searchInput.trim() || null })}
            placeholder={t('txns.searchPlaceholder')}
            className="pl-8"
          />
        </form>
        <div className="flex flex-wrap gap-1.5">
          {[undefined, ...WALLET_TXN_KINDS].map((k) => (
            <button
              key={k ?? 'all'}
              type="button"
              onClick={() => updateParams({ kind: k ?? null })}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                kind === k
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {k ? t(`kinds.${k}`) : t('txns.allKinds')}
            </button>
          ))}
        </div>
      </div>

      <PaginationBar
        position="top"
        page={page}
        pageSize={pageSize}
        total={total}
        loading={loading}
        onChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
      />

      <div className="relative overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('txns.columns.time')}</TableHead>
              <TableHead>{t('txns.columns.seller')}</TableHead>
              <TableHead>{t('txns.columns.kind')}</TableHead>
              <TableHead className="text-right">{t('txns.columns.amount')}</TableHead>
              <TableHead className="text-right">{t('txns.columns.balance')}</TableHead>
              <TableHead>{t('txns.columns.orders')}</TableHead>
              <TableHead>{t('txns.columns.note')}</TableHead>
              <TableHead>{t('txns.columns.by')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row._id}>
                <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                  {row.createdAt ? dayjs(row.createdAt).format('DD/MM/YYYY HH:mm') : ''}
                </TableCell>
                <TableCell>
                  <Link
                    to={`${PATHS.WALLETS}?customer=${encodeURIComponent(row.customerId)}`}
                    className="font-medium text-slate-800 hover:underline dark:text-slate-100"
                  >
                    {row.fullName || row.userSku}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {row.userSku}
                    {row.userEmail ? ` · ${row.userEmail}` : ''}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{t(`kinds.${row.kind}`)}</TableCell>
                <TableCell
                  className={cn(
                    'whitespace-nowrap text-right font-semibold tabular-nums',
                    row.amount < 0 ? 'text-red-600' : 'text-emerald-600',
                  )}
                >
                  {row.amount > 0 ? '+' : ''}
                  {formatUsd(row.amount)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {formatUsd(row.balanceBefore)} → {formatUsd(row.balanceAfter)}
                </TableCell>
                <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                  {row.productionIds.slice(0, MAX_ORDERS_SHOWN).map((id) => (
                    <div key={id} className="font-mono">
                      {id}
                    </div>
                  ))}
                  {row.productionIds.length > MAX_ORDERS_SHOWN && (
                    <div className="text-slate-400">
                      {t('txns.moreOrders', { count: row.productionIds.length - MAX_ORDERS_SHOWN })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-[240px] break-words text-xs text-slate-600 dark:text-slate-300">
                  {row.note}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                  {row.byUserName || t('ledger.system')}
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-500">
                  {t('txns.empty')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {loading && rows.length === 0 && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
      </div>

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
  );
}
