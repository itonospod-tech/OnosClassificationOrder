import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { ClipboardCheck, PackagePlus, RefreshCw, Scale } from 'lucide-react';
import type { InventoryItem, InventoryReceipt, InventoryTxn } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { PageHeader } from '@/components/common/PageHeader';
import { ResponsiveList } from '@/components/common/ResponsiveList';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useFactoryScope } from '@/hooks/useFactoryScope';
import { usePermission } from '@/hooks/usePermission';

import { AdjustDialog } from './AdjustDialog';
import { ReceiptInDialog } from './ReceiptInDialog';
import { ReconcileDialog } from './ReconcileDialog';

const TXN_KIND_BADGE: Record<string, 'default' | 'destructive' | 'secondary'> = {
  in: 'default',
  out: 'destructive',
  adjust: 'secondary',
};

/**
 * Tồn kho theo xưởng (`/ffm/inventory`, Inventory-FactoryStock plan) — 3 tab:
 * Tồn kho (danh mục + số tồn, âm = đỏ) · Giao dịch (sổ cái, dòng xuất trỏ về
 * đơn) · Phiếu. Trừ kho KHÔNG làm ở đây mà ở trạm quét (`ACT-STOCK-OUT`);
 * trang này nhập phiếu + kiểm kê + đối soát ngày (Admin).
 */
export default function InventoryPage() {
  const { t } = useTranslation(['inventory', 'common']);
  const factoryId = useFactoryScope();
  const { isAdmin } = usePermission();

  const [tab, setTab] = useState('items');

  // ---- Tab Tồn kho ----
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [negativeOnly, setNegativeOnly] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', unit: '', reviewed: false });

  // ---- Tab Giao dịch ----
  const [txns, setTxns] = useState<InventoryTxn[]>([]);
  const [txnsTotal, setTxnsTotal] = useState(0);
  const [txnsLoading, setTxnsLoading] = useState(false);
  const [txnKind, setTxnKind] = useState('');
  const [txnSku, setTxnSku] = useState('');
  const [txnProduction, setTxnProduction] = useState('');

  // ---- Tab Phiếu ----
  const [receipts, setReceipts] = useState<InventoryReceipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptDetail, setReceiptDetail] = useState<InventoryReceipt | null>(null);

  const [dialog, setDialog] = useState<'receiptIn' | 'adjust' | 'reconcile' | null>(null);

  const loadItems = useCallback(async () => {
    if (!factoryId) return;
    try {
      setItemsLoading(true);
      const res = await RepositoryRemote.inventory.listItems({
        factoryId,
        search: search.trim() || undefined,
        negativeOnly: negativeOnly || undefined,
        limit: 200,
      });
      setItems((res.data?.data || []) as InventoryItem[]);
      setItemsTotal(res.data?.total ?? 0);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setItemsLoading(false);
    }
  }, [factoryId, search, negativeOnly]);

  const loadTxns = useCallback(async () => {
    if (!factoryId) return;
    try {
      setTxnsLoading(true);
      const res = await RepositoryRemote.inventory.listTransactions({
        factoryId,
        kind: txnKind || undefined,
        sku: txnSku.trim() || undefined,
        productionId: txnProduction.trim() || undefined,
        limit: 100,
      });
      setTxns((res.data?.data || []) as InventoryTxn[]);
      setTxnsTotal(res.data?.total ?? 0);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setTxnsLoading(false);
    }
  }, [factoryId, txnKind, txnSku, txnProduction]);

  const loadReceipts = useCallback(async () => {
    if (!factoryId) return;
    try {
      setReceiptsLoading(true);
      const res = await RepositoryRemote.inventory.listReceipts({ factoryId, limit: 50 });
      setReceipts((res.data?.data || []) as InventoryReceipt[]);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setReceiptsLoading(false);
    }
  }, [factoryId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);
  useEffect(() => {
    if (tab === 'txns') void loadTxns();
  }, [tab, loadTxns]);
  useEffect(() => {
    if (tab === 'receipts') void loadReceipts();
  }, [tab, loadReceipts]);

  const refreshAll = () => {
    void loadItems();
    if (tab === 'txns') void loadTxns();
    if (tab === 'receipts') void loadReceipts();
  };

  const openEditItem = (item: InventoryItem) => {
    setEditItem(item);
    setEditDraft({ name: item.name || '', unit: item.unit || '', reviewed: false });
  };

  const saveEditItem = async () => {
    if (!editItem) return;
    try {
      await RepositoryRemote.inventory.updateItem(editItem._id, {
        name: editDraft.name.trim() || undefined,
        unit: editDraft.unit.trim() || undefined,
        ...(editDraft.reviewed ? { autoCreated: false } : {}),
      });
      toast.success(t('items.updated'));
      setEditItem(null);
      void loadItems();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const closeOut = async () => {
    if (!factoryId) return;
    if (!window.confirm(t('closeOut.confirm'))) return;
    try {
      const res = await RepositoryRemote.inventory.closeOutReceipt({
        factoryId,
        date: dayjs().format('YYYY-MM-DD'),
      });
      const receipt = res.data?.data as InventoryReceipt | null;
      if (!receipt) toast.info(t('closeOut.empty'));
      else toast.success(t('closeOut.done', { code: receipt.code }));
      if (tab === 'receipts') void loadReceipts();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  if (!factoryId) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('title')} />
        <p className="text-sm text-muted-foreground">{t('needFactory')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw size={14} className="mr-1" />
            {t('actions.refresh')}
          </Button>
          <Button size="sm" onClick={() => setDialog('receiptIn')}>
            <PackagePlus size={14} className="mr-1" />
            {t('actions.receiptIn')}
          </Button>
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog('adjust')}>
                <Scale size={14} className="mr-1" />
                {t('actions.adjust')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog('reconcile')}>
                <ClipboardCheck size={14} className="mr-1" />
                {t('actions.reconcile')}
              </Button>
              <Button variant="outline" size="sm" onClick={closeOut}>
                {t('actions.closeOut')}
              </Button>
            </>
          )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="items">
            {t('tabs.items')} ({itemsTotal})
          </TabsTrigger>
          <TabsTrigger value="txns">{t('tabs.txns')}</TabsTrigger>
          <TabsTrigger value="receipts">{t('tabs.receipts')}</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="w-64"
              placeholder={t('items.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={negativeOnly} onCheckedChange={setNegativeOnly} />
              {t('items.negativeOnly')}
            </label>
            {itemsLoading && <Spinner size={16} />}
          </div>
          {items.length === 0 && !itemsLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('items.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <ResponsiveList
                className="p-3 md:p-0"
                rows={items}
                rowKey={(item) => item._id}
                onRowClick={openEditItem}
                columns={[
                  { key: 'sku', header: t('items.sku'), mobile: 'subtitle', cell: (item) => <span className="font-mono text-xs">{item.sku}</span> },
                  { key: 'name', header: t('items.name'), mobile: 'title', cell: (item) => item.name },
                  { key: 'unit', header: t('items.unit'), cell: (item) => <span className="text-muted-foreground">{item.unit}</span> },
                  {
                    key: 'quantity',
                    header: t('items.quantity'),
                    mobile: 'trailing',
                    className: 'text-right',
                    cell: (item) => (
                      <span className={cn('font-semibold tabular-nums', item.quantity < 0 && 'text-tone-danger')}>{item.quantity}</span>
                    ),
                  },
                  {
                    key: 'auto',
                    header: '',
                    mobile: 'trailing',
                    cell: (item) =>
                      item.autoCreated && (
                        <Badge variant="outline" className="border-tone-warning text-tone-warning" title={t('items.autoCreatedHint')}>
                          {t('items.autoCreatedBadge')}
                        </Badge>
                      ),
                  },
                ]}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="txns" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={txnKind}
              onChange={(e) => setTxnKind(e.target.value)}
            >
              <option value="">{t('txns.filterAll')}</option>
              <option value="in">{t('txns.kindIn')}</option>
              <option value="out">{t('txns.kindOut')}</option>
              <option value="adjust">{t('txns.kindAdjust')}</option>
            </select>
            <Input
              className="w-44"
              placeholder={t('txns.filterSku')}
              value={txnSku}
              onChange={(e) => setTxnSku(e.target.value)}
            />
            <Input
              className="w-44"
              placeholder={t('txns.filterProduction')}
              value={txnProduction}
              onChange={(e) => setTxnProduction(e.target.value)}
            />
            {txnsLoading && <Spinner size={16} />}
            <span className="text-xs text-muted-foreground">{txnsTotal}</span>
          </div>
          {txns.length === 0 && !txnsLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('txns.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <ResponsiveList
                className="p-3 md:p-0"
                rows={txns}
                rowKey={(txn) => txn._id}
                columns={[
                  {
                    key: 'time',
                    header: t('txns.time'),
                    className: 'whitespace-nowrap',
                    cell: (txn) => (
                      <span className="text-xs text-muted-foreground">
                        {txn.createdAt ? dayjs(txn.createdAt).format('DD/MM HH:mm') : '—'}
                      </span>
                    ),
                  },
                  {
                    key: 'kind',
                    header: t('txns.kind'),
                    mobile: 'subtitle',
                    cell: (txn) => (
                      <>
                        <Badge variant={TXN_KIND_BADGE[txn.kind] || 'secondary'}>
                          {t(`txns.kind${txn.kind === 'in' ? 'In' : txn.kind === 'out' ? 'Out' : 'Adjust'}`)}
                        </Badge>
                        {txn.refs?.rework && (
                          <Badge variant="outline" className="ml-1 border-tone-warning text-tone-warning">
                            {t('txns.reworkBadge')}
                          </Badge>
                        )}
                      </>
                    ),
                  },
                  { key: 'sku', header: t('txns.sku'), mobile: 'title', cell: (txn) => <span className="font-mono text-xs">{txn.sku}</span> },
                  {
                    key: 'qty',
                    header: t('txns.qty'),
                    mobile: 'trailing',
                    className: 'text-right',
                    cell: (txn) => (
                      <span className={cn('font-semibold tabular-nums', txn.qty < 0 ? 'text-tone-danger' : 'text-tone-success')}>
                        {txn.qty > 0 ? `+${txn.qty}` : txn.qty}
                      </span>
                    ),
                  },
                  {
                    key: 'balance',
                    header: t('txns.balance'),
                    className: 'text-right',
                    cell: (txn) => (
                      <span
                        className="tabular-nums text-muted-foreground"
                        title={t('txns.balanceTitle', { before: txn.balanceBefore, after: txn.balanceAfter })}
                      >
                        {txn.balanceAfter}
                      </span>
                    ),
                  },
                  {
                    key: 'production',
                    header: t('txns.production'),
                    cell: (txn) => (
                      <span className="font-mono text-xs">
                        {txn.refs?.productionId || '—'}
                        {txn.refs?.source && (
                          <span className="ml-1 text-[10px] text-muted-foreground">{t(`txns.source.${txn.refs.source}`)}</span>
                        )}
                      </span>
                    ),
                  },
                  { key: 'by', header: t('txns.by'), cell: (txn) => <span className="text-xs">{txn.byUserName || '—'}</span> },
                  {
                    key: 'note',
                    header: t('txns.note'),
                    mobile: 'field',
                    className: 'max-w-[200px]',
                    cell: (txn) => <span className="block truncate text-xs text-muted-foreground">{txn.note || ''}</span>,
                  },
                ]}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="receipts" className="space-y-3">
          {receiptsLoading && <Spinner size={16} />}
          {receipts.length === 0 && !receiptsLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('receipts.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <ResponsiveList
                className="p-3 md:p-0"
                rows={receipts}
                rowKey={(receipt) => receipt._id}
                onRowClick={setReceiptDetail}
                columns={[
                  {
                    key: 'code',
                    header: t('receipts.code'),
                    mobile: 'title',
                    cell: (receipt) => <span className="font-mono text-xs">{receipt.code}</span>,
                  },
                  {
                    key: 'type',
                    header: t('receipts.type'),
                    mobile: 'subtitle',
                    cell: (receipt) => (
                      <>
                        <Badge variant={receipt.type === 'in' ? 'default' : 'destructive'}>
                          {receipt.type === 'in' ? t('receipts.typeIn') : t('receipts.typeOut')}
                        </Badge>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t('receipts.lineCount', { count: receipt.lines.length })}
                        </span>
                      </>
                    ),
                  },
                  {
                    key: 'totalQty',
                    header: t('receipts.totalQty'),
                    mobile: 'trailing',
                    cell: (receipt) => <span className="tabular-nums">{receipt.lines.reduce((sum, l) => sum + l.qty, 0)}</span>,
                  },
                  { key: 'by', header: t('receipts.by'), cell: (receipt) => <span className="text-xs">{receipt.byUserName || '—'}</span> },
                  {
                    key: 'time',
                    header: t('receipts.time'),
                    cell: (receipt) => (
                      <span className="text-xs text-muted-foreground">
                        {receipt.createdAt ? dayjs(receipt.createdAt).format('DD/MM/YYYY HH:mm') : '—'}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ReceiptInDialog
        open={dialog === 'receiptIn'}
        factoryId={factoryId}
        onClose={() => setDialog(null)}
        onSaved={refreshAll}
      />
      <AdjustDialog
        open={dialog === 'adjust'}
        factoryId={factoryId}
        items={items}
        onClose={() => setDialog(null)}
        onSaved={refreshAll}
      />
      <ReconcileDialog
        open={dialog === 'reconcile'}
        factoryId={factoryId}
        onClose={() => setDialog(null)}
        onApplied={refreshAll}
      />

      {/* Sửa item */}
      <Dialog open={!!editItem} onOpenChange={(v) => !v && setEditItem(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('items.editTitle')} — <span className="font-mono">{editItem?.sku}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('items.name')}</Label>
              <Input value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>{t('items.unit')}</Label>
              <Input value={editDraft.unit} onChange={(e) => setEditDraft({ ...editDraft, unit: e.target.value })} />
            </div>
            {editItem?.autoCreated && (
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={editDraft.reviewed}
                  onCheckedChange={(v) => setEditDraft({ ...editDraft, reviewed: v })}
                />
                {t('items.markReviewed')}
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={saveEditItem}>{t('common:actions.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chi tiết phiếu */}
      <Dialog open={!!receiptDetail} onOpenChange={(v) => !v && setReceiptDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('receipts.detailTitle', { code: receiptDetail?.code })}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('items.sku')}</TableHead>
                  <TableHead>{t('items.name')}</TableHead>
                  <TableHead className="text-right">{t('txns.qty')}</TableHead>
                  <TableHead>{t('receipts.note')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(receiptDetail?.lines || []).map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                    <TableCell>{line.name || ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{line.note || ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
