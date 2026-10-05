import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { RefreshCw, Search, Wallet } from 'lucide-react';
import type { AdminWalletRow } from 'shared';

import { PATHS } from '@/constants/paths';

import { RepositoryRemote } from '@/services';

import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { ResponsiveList } from '@/components/common/ResponsiveList';
import { Spinner } from '@/components/common/Spinner';
import { TierBadge } from '@/components/common/TierBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

import { formatUsd, isOverLimit } from './walletFormat';
import WalletLedgerSheet from './WalletLedgerSheet';

/**
 * Seller wallets, staff side. Filters live on the URL so a menu link can carry a meaningful default
 * (MenuRestructure-CEO.md §8.1) — e.g. `?activeOnly=true` — and an open ledger is shareable (`?customer=`).
 */
export default function WalletsPage() {
  const { isAdmin } = usePermission();
  if (!isAdmin) return <Navigate to={PATHS.HOME} replace />;

  return <WalletsContent />;
}

function WalletsContent() {
  const { t } = useTranslation('wallets');
  const [params, setParams] = useSearchParams();
  const activeOnly = params.get('activeOnly') === 'true';
  const search = params.get('search') ?? '';
  const openCustomerId = params.get('customer');

  const [rows, setRows] = useState<AdminWalletRow[]>([]);
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
  }, [search, activeOnly]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // Never send activeOnly=false: the DTO uses z.coerce.boolean, which reads the string "false" as true.
        const res = await RepositoryRemote.customerWallet.listWallets({
          search: search.trim() || undefined,
          activeOnly: activeOnly || undefined,
          page,
          limit: pageSize,
        });
        if (cancelled) return;
        setRows((res.data?.data || []) as AdminWalletRow[]);
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
  }, [search, activeOnly, page, pageSize, reloadTick]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Wallet size={20} />}
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to={PATHS.WALLET_TRANSACTIONS}>{t('nav.transactions')}</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setReloadTick((n) => n + 1)} disabled={loading}>
              <RefreshCw size={16} className={cn('mr-1.5', loading && 'animate-spin')} />
              {t('refresh')}
            </Button>
          </>
        }
      />

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
            placeholder={t('searchPlaceholder')}
            className="pl-8"
          />
        </form>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => updateParams({ activeOnly: e.target.checked ? 'true' : null })}
            className="h-4 w-4 accent-primary"
          />
          {t('activeOnly')}
        </label>
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
        {/* Table on wide screens, tappable cards on phones (ResponsiveList). */}
        {loading && rows.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <ResponsiveList
            className="p-3 md:p-0"
            rows={rows}
            rowKey={(row) => row.customerId}
            onRowClick={(row) => updateParams({ customer: row.customerId })}
            empty={t('empty')}
            columns={[
              {
                key: 'seller',
                header: t('columns.seller'),
                mobile: 'title',
                cell: (row) => (
                  <div>
                    <div className="font-medium text-foreground">{row.fullName || row.userSku}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {row.userSku}
                      {row.userEmail ? ` · ${row.userEmail}` : ''}
                    </div>
                  </div>
                ),
              },
              { key: 'tier', header: t('columns.tier'), cell: (row) => <TierBadge tier={row.tier} /> },
              {
                key: 'balance',
                header: t('columns.balance'),
                mobile: 'trailing',
                className: 'text-right',
                cell: (row) => (
                  <div className="text-right tabular-nums">
                    <span className={cn('font-semibold', row.balance < 0 ? 'text-tone-danger' : 'text-foreground')}>
                      {formatUsd(row.balance)}
                    </span>
                    {isOverLimit(row.balance, row.creditLimit) && (
                      <div className="text-xs font-medium text-tone-danger">{t('overLimit')}</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'creditLimit',
                header: t('columns.creditLimit'),
                className: 'text-right',
                cell: (row) => <span className="tabular-nums text-muted-foreground">{formatUsd(row.creditLimit)}</span>,
              },
              {
                key: 'lastTxn',
                header: t('columns.lastTxn'),
                cell: (row) => (
                  <span className="text-sm text-muted-foreground">
                    {row.lastTxnAt ? dayjs(row.lastTxnAt).format('DD/MM/YYYY HH:mm') : t('neverUsed')}
                  </span>
                ),
              },
            ]}
          />
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

      <WalletLedgerSheet
        customerId={openCustomerId}
        kind={params.get('kind')}
        onKindChange={(kind) => updateParams({ kind })}
        onClose={() => updateParams({ customer: null, kind: null })}
        onChanged={() => setReloadTick((n) => n + 1)}
      />
    </div>
  );
}
