import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  ArchiveRestore,
  Contact,
  FileUp,
  KeyRound,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import type { CustomerAdminRow } from 'shared';
import { CUSTOMER_TIERS, Status } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { useConfirm } from '@/components/common/ConfirmDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { TierBadge } from '@/components/common/TierBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import CustomerEditDialog from './CustomerEditDialog';
import CustomerOrdersDialog from './CustomerOrdersDialog';
import ImportTiersDialog from './ImportTiersDialog';
import ResetPasswordDialog from './ResetPasswordDialog';

interface FactoryLite {
  _id: string;
  name: string;
  shortName?: string;
}

interface DesignerLite {
  _id: string;
  fullName: string;
}

type AccountFilter = '' | 'registered' | 'notRegistered' | 'locked';

export default function CustomersPage() {
  const { t } = useTranslation(['customers', 'customerFactoryAssignment', 'common']);
  const { confirm, confirmDialog } = useConfirm();
  const [rows, setRows] = useState<CustomerAdminRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('');
  const [showDeleted, setShowDeleted] = useState(false);

  const [factories, setFactories] = useState<FactoryLite[]>([]);
  const [designers, setDesigners] = useState<DesignerLite[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<CustomerAdminRow | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetItem, setResetItem] = useState<CustomerAdminRow | null>(null);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersItem, setOrdersItem] = useState<CustomerAdminRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingTierId, setSavingTierId] = useState('');

  const factoryById = useMemo(() => new Map(factories.map((f) => [String(f._id), f])), [factories]);
  const designerById = useMemo(() => new Map(designers.map((d) => [String(d._id), d])), [designers]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await RepositoryRemote.customer.list({
        search: search.trim() || undefined,
        page,
        limit: pageSize,
        tier: tierFilter || undefined,
        status: accountFilter === 'locked' ? Status.Inactive : undefined,
        hasAccount: accountFilter === 'registered' ? 'true' : accountFilter === 'notRegistered' ? 'false' : undefined,
        deleted: showDeleted || undefined,
      });
      setRows((res.data?.data || []) as CustomerAdminRow[]);
      setTotal((res.data?.total as number) || 0);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, tierFilter, accountFilter, showDeleted]);

  useEffect(() => {
    (async () => {
      try {
        const [facRes, desRes] = await Promise.all([
          RepositoryRemote.factory.getFactories('?page=1&limit=200'),
          RepositoryRemote.designer.listTeam(Status.Active),
        ]);
        setFactories((facRes.data?.data || []) as FactoryLite[]);
        setDesigners((desRes.data?.data || []) as DesignerLite[]);
      } catch (err) {
        handleAxiosError(err);
      }
    })();
  }, []);

  const handleSearch = () => {
    if (page !== 1) setPage(1);
    else fetchData();
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      const res = await RepositoryRemote.customer.sync();
      const d = res.data?.data as { created: number; total: number };
      await fetchData();
      toast.success(t('toasts.syncSuccess', { created: d?.created ?? 0, total: d?.total ?? 0 }));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSyncing(false);
    }
  };

  const handleTierChange = async (c: CustomerAdminRow, value: string) => {
    const tier = value === '' ? null : Number(value);
    try {
      setSavingTierId(String(c._id));
      await RepositoryRemote.customer.updateTier(String(c._id), tier);
      await fetchData();
      toast.success(
        t('toasts.tierChangeSuccess', {
          sku: c.userSku,
          tier:
            tier === null
              ? t('tier.retail', { ns: 'customerFactoryAssignment' })
              : t('tier.vip', { tier, ns: 'customerFactoryAssignment' }),
        }),
      );
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSavingTierId('');
    }
  };

  const handleToggleLock = async (c: CustomerAdminRow) => {
    const locking = c.status !== Status.Inactive;
    try {
      await RepositoryRemote.customer.updateStatus(String(c._id), locking ? Status.Inactive : Status.Active);
      await fetchData();
      toast.success(t(locking ? 'toasts.lockSuccess' : 'toasts.unlockSuccess', { sku: c.userSku }));
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const handleDelete = async (c: CustomerAdminRow) => {
    const ok = await confirm({
      title: t('deleteConfirm.title', { sku: c.userSku }),
      message: t('deleteConfirm.message'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await RepositoryRemote.customer.softDelete(String(c._id));
      const removed = (res.data?.data?.removedFromConfigs || []) as string[];
      await fetchData();
      toast.success(t('toasts.deleteSuccess', { sku: c.userSku }));
      if (removed.length > 0) {
        toast.info(
          t('deleteConfirm.removedFrom', {
            configs: removed.map((key) => t(`configNames.${key}`, { defaultValue: key })).join(', '),
          }),
        );
      }
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const handleRestore = async (c: CustomerAdminRow) => {
    try {
      await RepositoryRemote.customer.restore(String(c._id));
      await fetchData();
      toast.success(t('toasts.restoreSuccess', { sku: c.userSku }));
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const accountChip = (c: CustomerAdminRow) => {
    if (!c.hasAccount) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-400">
          {t('account.none')}
        </span>
      );
    }
    if (c.status === Status.Inactive) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
          {t('account.locked')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        {t('account.active')}
      </span>
    );
  };

  const openCreate = () => {
    setEditItem(null);
    setEditOpen(true);
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      <PageHeader icon={<Contact size={20} />} title={t('page.title')} description={t('page.subtitle')} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('page.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => {
            setTierFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">{t('filters.tierAll')}</option>
          <option value="none">{t('filters.retail')}</option>
          {CUSTOMER_TIERS.map((v) => (
            <option key={v} value={v}>
              {t('filters.vip', { tier: v })}
            </option>
          ))}
        </select>
        <select
          value={accountFilter}
          onChange={(e) => {
            setAccountFilter(e.target.value as AccountFilter);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">{t('filters.accountAll')}</option>
          <option value="registered">{t('filters.accountRegistered')}</option>
          <option value="notRegistered">{t('filters.accountNotRegistered')}</option>
          <option value="locked">{t('filters.accountLocked')}</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setShowDeleted((v) => !v);
            setPage(1);
          }}
          className={cn(
            'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-medium transition-colors',
            showDeleted
              ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400'
              : 'border-input text-muted-foreground hover:bg-muted/50',
          )}
        >
          <Trash2 size={14} />
          {t('page.showDeleted')}
        </button>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
          {syncing ? <Spinner size={13} className="mr-1.5" /> : <RefreshCw size={14} />}
          {t('page.sync')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <FileUp size={14} /> {t('page.importTier')}
        </Button>
        <Button size="sm" onClick={openCreate}>
          <Plus size={14} /> {t('page.addButton')}
        </Button>
      </div>

      <LoadingOverlay active={loading && rows.length > 0} className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.sku')}</TableHead>
              <TableHead>{t('table.email')}</TableHead>
              <TableHead>{t('table.name')}</TableHead>
              <TableHead>{t('table.tier')}</TableHead>
              <TableHead>{t('table.account')}</TableHead>
              <TableHead>{t('table.source')}</TableHead>
              <TableHead>{t('table.factory')}</TableHead>
              <TableHead>{t('table.designer')}</TableHead>
              <TableHead className="text-right">{t('table.orders')}</TableHead>
              <TableHead>{t('table.lastOrder')}</TableHead>
              <TableHead className="w-36"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8">
                  <Spinner size={20} className="text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  {t('table.empty')}
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => {
              const id = String(c._id);
              const factory = c.assignedFactoryId ? factoryById.get(String(c.assignedFactoryId)) : undefined;
              const designer = c.assignedDesignerId ? designerById.get(String(c.assignedDesignerId)) : undefined;
              return (
                <TableRow key={id}>
                  <TableCell className="font-medium">{c.userSku || '—'}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">{c.userEmail || '—'}</TableCell>
                  <TableCell>
                    {c.fullName || '—'}
                    {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="inline-flex items-center gap-1.5">
                      <span className="relative inline-flex" title={t('actions.changeTier')}>
                        <TierBadge tier={c.tier} />
                        {!showDeleted && (
                          <select
                            value={typeof c.tier === 'number' ? `${c.tier}` : ''}
                            onChange={(ev) => handleTierChange(c, ev.target.value)}
                            disabled={savingTierId === id}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          >
                            <option value="">{t('tier.retail', { ns: 'customerFactoryAssignment' })}</option>
                            {CUSTOMER_TIERS.map((tier) => (
                              <option key={tier} value={tier}>
                                {t('tier.vip', { tier, ns: 'customerFactoryAssignment' })}
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                      {savingTierId === id && <Spinner size={12} className="text-slate-400" />}
                    </div>
                  </TableCell>
                  <TableCell>{accountChip(c)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t(`source.${c.source}`, { defaultValue: c.source })}
                  </TableCell>
                  <TableCell className="text-sm">{factory?.shortName || factory?.name || '—'}</TableCell>
                  <TableCell className="text-sm">{designer?.fullName || '—'}</TableCell>
                  <TableCell className="text-right">
                    {c.orderCount ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOrdersItem(c);
                          setOrdersOpen(true);
                        }}
                        className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline tabular-nums"
                        title={t('actions.viewOrders')}
                      >
                        <ShoppingBag size={12} />
                        {c.orderCount}
                      </button>
                    ) : (
                      <span className="text-muted-foreground tabular-nums">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {c.lastOrderAt ? dayjs(c.lastOrderAt).format('DD/MM/YYYY') : '—'}
                  </TableCell>
                  <TableCell>
                    {showDeleted ? (
                      <Button variant="ghost" size="sm" onClick={() => handleRestore(c)} title={t('actions.restore')}>
                        <ArchiveRestore size={14} className="text-emerald-600" />
                        {t('actions.restore')}
                      </Button>
                    ) : (
                      <div className="flex items-center gap-0.5 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditItem(c);
                            setEditOpen(true);
                          }}
                          title={t('actions.edit')}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setResetItem(c);
                            setResetOpen(true);
                          }}
                          title={t('actions.resetPassword')}
                        >
                          <KeyRound size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleLock(c)}
                          title={c.status === Status.Inactive ? t('actions.unlock') : t('actions.lock')}
                        >
                          {c.status === Status.Inactive ? (
                            <LockOpen size={14} className="text-emerald-600" />
                          ) : (
                            <Lock size={14} className="text-amber-600" />
                          )}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(c)} title={t('actions.delete')}>
                          <Trash2 size={14} className="text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <PaginationBar
          position="bottom"
          page={page}
          pageSize={pageSize}
          total={total}
          loading={loading}
          onChange={(p, ps) => {
            setPage(p);
            setPageSize(ps);
          }}
        />
      </LoadingOverlay>

      <CustomerEditDialog open={editOpen} onOpenChange={setEditOpen} item={editItem} onSaved={fetchData} />
      <ResetPasswordDialog open={resetOpen} onOpenChange={setResetOpen} item={resetItem} />
      <CustomerOrdersDialog open={ordersOpen} onOpenChange={setOrdersOpen} item={ordersItem} factories={factories} />
      <ImportTiersDialog open={importOpen} onOpenChange={setImportOpen} onImported={fetchData} />
    </div>
  );
}
