import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';

import { RepositoryRemote } from '@/services';

import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { CancelledBadge } from '@/components/orders/CancelledBadge';
import { HeldBadge } from '@/components/orders/HeldBadge';
import { OrderLogTimelineDialog } from '@/components/orders/OrderLogTimelineDialog';
import { OrderRowActionsMenu } from '@/components/orders/OrderRowActionsMenu';
import {
  buildColGroups,
  GroupCellContent,
  WORKSHOP_COLS,
  type WorkshopOrderRow,
  type WorkshopRenderCtx,
} from '@/components/orders/workshopTableConfig';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { isCancelled, isHeld } from '@/utils/orderActions';

import { NO_TOOL_ROW_CLASS, useIsNoTool } from '@/hooks/useIsNoTool';
import { usePermission } from '@/hooks/usePermission';

const DEFAULT_PAGE_SIZE = 20;

interface Props {
  /** Query string built by useStatusFilter, e.g. "?printStatus=ok&..." */
  queryString: string;
}

export function OrdersMiniTable({ queryString }: Props) {
  const { t } = useTranslation('dashboard');
  const { t: tOrders } = useTranslation('orders');
  const { canViewField, canEditField, roleName } = usePermission();
  const [rows, setRows] = useState<WorkshopOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [preview, setPreview] = useState<{ url: string; originalUrl?: string; title: string } | null>(null);
  const [history, setHistory] = useState<{ id: string; productionId: string } | null>(null);

  const fetchData = async () => {
    const sep = queryString ? '&' : '?';
    // sort=grouped → BE clusters rows by (type, size, fabric, createdAt).
    // Intra-cluster frequency sort is applied client-side below.
    const q = `${queryString}${sep}page=${page}&limit=${pageSize}&sort=grouped`;
    try {
      setLoading(true);
      const res = await RepositoryRemote.order.getOrders(q);
      setRows((res.data?.data || []) as WorkshopOrderRow[]);
      setTotal(res.data?.total || 0);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [queryString, pageSize]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString, page, pageSize]);

  const patchRow = (id: string, p: Partial<WorkshopOrderRow>) =>
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...p } : r)));

  const openPreview = (url: string, title: string, originalUrl?: string) => setPreview({ url, originalUrl, title });

  const visibleCols = useMemo(() => WORKSHOP_COLS.filter((c) => !c.perm || canViewField(c.key)), [canViewField]);
  // Gom cột theo chủ đề nghiệp vụ (giống OrderTableWorkshop) để giảm scroll
  // ngang — xem `buildColGroups`/`GroupCellContent` trong workshopTableConfig.tsx.
  const colGroups = useMemo(() => buildColGroups(visibleCols, roleName), [visibleCols, roleName]);

  const ctx: WorkshopRenderCtx = { canEditField, patchRow, openPreview, t: tOrders };
  const isNoTool = useIsNoTool();

  // Re-sort rows on the current page: same product clustered (preserved from
  // BE order), inside each cluster rows ordered by combo (size+fabric+mockup)
  // duplicate count desc → workshop sees heaviest combos first.
  const sortedRows = useMemo(() => {
    const comboKey = (r: WorkshopOrderRow) =>
      `${r.type || ''}|${r.size || ''}|${r.fabricType || ''}|${r.mockupOriginalUrl || r.mockupUrl || ''}`;
    const comboCount = new Map<string, number>();
    for (const r of rows) comboCount.set(comboKey(r), (comboCount.get(comboKey(r)) || 0) + 1);

    const buckets = new Map<string, WorkshopOrderRow[]>();
    const typeOrder: string[] = [];
    for (const r of rows) {
      const typeKey = r.type || t('statusFilter.noName');
      if (!buckets.has(typeKey)) {
        buckets.set(typeKey, []);
        typeOrder.push(typeKey);
      }
      buckets.get(typeKey)!.push(r);
    }
    for (const [, list] of buckets) {
      list.sort((a, b) => {
        const ca = comboCount.get(comboKey(a)) || 1;
        const cb = comboCount.get(comboKey(b)) || 1;
        if (cb !== ca) return cb - ca;
        return comboKey(a).localeCompare(comboKey(b));
      });
    }
    return typeOrder.flatMap((typeName) => buckets.get(typeName)!);
  }, [rows, t]);

  const isRefetching = loading && rows.length > 0;

  const paginationProps = {
    page,
    pageSize,
    total,
    loading: loading && rows.length === 0,
    onChange: (p: number, ps: number) => {
      setPage(p);
      setPageSize(ps);
    },
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        <PaginationBar position="top" {...paginationProps} />
        <div className="rounded-lg border border-border bg-card overflow-hidden relative">
          {/* Indeterminate progress strip at top while loading */}
          <div
            className={cn(
              'absolute top-0 left-0 right-0 h-0.5 overflow-hidden bg-primary/10 pointer-events-none transition-opacity duration-200 z-10',
              loading ? 'opacity-100' : 'opacity-0',
            )}
          >
            <div className="h-full w-1/4 bg-primary animate-indeterminate-bar" />
          </div>

          <div className="border-b border-border px-3 py-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              {t('statusFilter.orderList', { count: total })}
              {isRefetching && <Spinner size={11} className="text-muted-foreground" />}
            </h3>
          </div>
          <div className={cn('overflow-x-auto transition-opacity duration-300', isRefetching && 'opacity-60')}>
            <Table>
              <TableHeader>
                <TableRow>
                  {colGroups.map((g) => (
                    <TableHead key={g.key} className="whitespace-nowrap text-xs" style={{ minWidth: g.width }}>
                      {g.title}
                    </TableHead>
                  ))}
                  <TableHead className="w-20 sticky right-0 z-20 bg-card"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colGroups.length + 1} className="text-center py-8">
                      <Spinner size={18} className="text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={colGroups.length + 1}
                      className="text-center py-8 text-sm text-muted-foreground"
                    >
                      {t('statusFilter.noMatchingOrders')}
                    </TableCell>
                  </TableRow>
                )}
                {sortedRows.map((row) => {
                  const renderedByKey = new Map(visibleCols.map((c) => [c.key, c.render(row, ctx)]));
                  const dim = isCancelled(row) || isHeld(row);
                  return (
                    <TableRow
                      key={row._id}
                      className={cn(isNoTool(row.toolResult) && NO_TOOL_ROW_CLASS, dim && 'opacity-60')}
                    >
                      {colGroups.map((g, gi) => (
                        <TableCell key={g.key} className="py-2 align-top">
                          {gi === 0 && dim && (
                            <div className="mb-1">
                              {isCancelled(row) ? (
                                <CancelledBadge reason={row.cancelReason} />
                              ) : (
                                <HeldBadge reason={row.holdReason} source={row.holdSource} />
                              )}
                            </div>
                          )}
                          <GroupCellContent group={g} renderedByKey={renderedByKey} />
                        </TableCell>
                      ))}
                      {/* Thao tác — pin cố định BÊN PHẢI */}
                      <TableCell className="py-2 sticky right-0 z-10 bg-card shadow-[-1px_0_0_0_var(--border)]">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('statusFilter.history')}
                            onClick={() => setHistory({ id: row._id, productionId: row.productionId })}
                          >
                            <History size={13} className="text-muted-foreground" />
                          </Button>
                          <OrderRowActionsMenu order={row} onChanged={() => fetchData()} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <PaginationBar position="bottom" {...paginationProps} />
        </div>

        <ImagePreviewDialog
          open={!!preview}
          onOpenChange={(o) => !o && setPreview(null)}
          url={preview?.url}
          originalUrl={preview?.originalUrl}
          title={preview?.title}
        />
        <OrderLogTimelineDialog
          open={!!history}
          onOpenChange={(o) => !o && setHistory(null)}
          orderId={history?.id}
          productionId={history?.productionId}
        />
      </div>
    </TooltipProvider>
  );
}
