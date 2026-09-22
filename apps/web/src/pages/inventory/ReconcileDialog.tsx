import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { ReconcileRow } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { handleAxiosError } from '@/utils';

/**
 * Đối soát ngày: đơn In-xong trong ngày chưa có transaction trừ kho → preview
 * rồi trừ cả loạt. Idempotent — đơn đã trừ tự bị bỏ qua nên bấm lặp vô hại.
 */
export function ReconcileDialog({
  open,
  factoryId,
  onClose,
  onApplied,
}: {
  open: boolean;
  factoryId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { t } = useTranslation(['inventory', 'common']);
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [rows, setRows] = useState<ReconcileRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const preview = async () => {
    try {
      setLoading(true);
      const res = await RepositoryRemote.inventory.reconcilePreview({ factoryId, date });
      setRows((res.data?.data || []) as ReconcileRow[]);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setRows(null);
      void preview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date, factoryId]);

  const apply = async () => {
    const count = rows?.length ?? 0;
    if (count === 0) return;
    if (!window.confirm(t('reconcile.confirm', { count, date }))) return;
    try {
      setApplying(true);
      const res = await RepositoryRemote.inventory.reconcileApply({ factoryId, date });
      const data = res.data?.data as { applied: number; skipped: number };
      toast.success(t('reconcile.applied', data));
      onApplied();
      void preview();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('reconcile.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('reconcile.hint')}</p>
        <div className="flex items-center gap-2">
          <span className="text-sm">{t('reconcile.date')}</span>
          <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} />
          {loading && <Spinner size={16} />}
        </div>
        <div className="max-h-[45vh] overflow-y-auto">
          {rows && rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('reconcile.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reconcile.production')}</TableHead>
                  <TableHead>{t('reconcile.sku')}</TableHead>
                  <TableHead className="text-right">{t('reconcile.qty')}</TableHead>
                  <TableHead>{t('reconcile.printDoneAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows || []).map((row) => (
                  <TableRow key={row.productionId}>
                    <TableCell className="font-mono text-xs">{row.productionId}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.sku || <Badge variant="destructive">{t('reconcile.noSku')}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{row.qty}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.printCompletedAt ? dayjs(row.printCompletedAt).format('DD/MM HH:mm') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={apply} disabled={applying || !rows || rows.length === 0}>
            {applying && <Spinner size={14} className="mr-2" />}
            {t('reconcile.apply', { count: rows?.length ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
