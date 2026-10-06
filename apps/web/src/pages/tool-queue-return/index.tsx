import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import type { ToolQueueBlockKey, ToolQueueReturnPreview, ToolQueueReturnRow, ToolQueueReturnRunResult } from 'shared';
import { TOOL_QUEUE_RETURN_BATCH_MAX } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { StatCards } from '@/components/common/StatCards';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

import { exportReturnList } from './exportReturnList';

type Summary = {
  total: number;
  returnable: number;
  blocked: Array<{ reason: ToolQueueBlockKey; count: number }>;
  byFactory: Array<{ factoryId: string; shortName?: string; returnable: number }>;
  byToolResult: Array<{ toolResult: string; returnable: number }>;
};
type Queue = { waiting: number; lastToolWriteAt: string | null; stalled: boolean };
type Group = { key: string; count: number; returnable: number };
type View = 'orders' | 'type';
type Filters = { factoryId: string; toolResult: string; type: string; returnable: boolean };
const NO_FILTERS: Filters = { factoryId: '', toolResult: '', type: '', returnable: true };
const PAGE_SIZE = 50;
const fmt = (d?: Date | string | null) => (d ? dayjs(d).format('DD/MM/YYYY') : '');

/**
 * Return orders to the tool-check queue (ToolCheckWorkflow.md §2.4), SuperAdmin only. Same shape as
 * `/adm/stale-orders`: list (every candidate with its verdict) → preview (the server re-checks every
 * order; exports the list by factory) → run. Nothing is selected by default and a run is capped at
 * TOOL_QUEUE_RETURN_BATCH_MAX. The overload warning is on the page and again in the preview.
 */
export default function ToolQueueReturnPage() {
  const { t } = useTranslation('toolQueueReturn');
  const { roleName } = usePermission();

  const [view, setView] = useState<View>('orders');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ToolQueueReturnRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  // id → productionId: selection survives paging and filter changes.
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [previewOpen, setPreviewOpen] = useState(false);

  const query = useCallback(
    (extra: Record<string, string | number | undefined>) => {
      const p = new URLSearchParams();
      if (filters.factoryId) p.set('factoryId', filters.factoryId);
      if (filters.toolResult) p.set('toolResult', filters.toolResult);
      if (filters.type) p.set('type', filters.type);
      if (filters.returnable) p.set('returnable', 'true');
      for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));

      return '?' + p.toString();
    },
    [filters],
  );

  useEffect(() => {
    if (roleName !== 'SuperAdmin') return;
    let cancelled = false;
    setLoading(true);
    const extra = view === 'orders' ? { page, limit: PAGE_SIZE } : { page: 1, limit: PAGE_SIZE, groupBy: 'type' };
    RepositoryRemote.order
      .getToolQueueReturn(query(extra))
      .then((res) => {
        if (cancelled) return;
        const body = res.data as { data: ToolQueueReturnRow[]; groups?: Group[]; total: number; summary: Summary; queue: Queue };
        setRows(body.data ?? []);
        setGroups(body.groups ?? []);
        setTotal(body.total ?? 0);
        setSummary(body.summary);
        setQueue(body.queue);
      })
      .catch(handleAxiosError)
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [roleName, view, page, query, reload]);

  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const toggle = (r: ToolQueueReturnRow) => {
    if (!r.returnable) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r._id)) next.delete(r._id);
      else if (next.size >= TOOL_QUEUE_RETURN_BATCH_MAX) toast.warning(t('selection.capReached', { max: TOOL_QUEUE_RETURN_BATCH_MAX }));
      else next.set(r._id, r.productionId);

      return next;
    });
  };

  /** Adds the group's returnable orders, oldest first, up to the per-run cap. Never "select all". */
  const selectGroup = async (g: Group) => {
    const room = TOOL_QUEUE_RETURN_BATCH_MAX - selected.size;
    if (room <= 0) return toast.warning(t('selection.capReached', { max: TOOL_QUEUE_RETURN_BATCH_MAX }));
    try {
      const res = await RepositoryRemote.order.getToolQueueReturn(query({ type: g.key, page: 1, limit: TOOL_QUEUE_RETURN_BATCH_MAX }));
      const take = ((res.data as { data: ToolQueueReturnRow[] }).data ?? []).filter((r) => r.returnable && !selected.has(r._id)).slice(0, room);
      setSelected((prev) => new Map([...prev, ...take.map((r) => [r._id, r.productionId] as [string, string])]));
      toast.info(t('selection.groupAdded', { added: take.length, inGroup: g.returnable }));
    } catch (err) {
      handleAxiosError(err);
    }
  };

  if (roleName !== 'SuperAdmin') {
    return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">{t('noPermission')}</div>;
  }

  const hasFilters = filters.factoryId || filters.toolResult || filters.type || !filters.returnable;
  const blockedTotal = (summary?.blocked ?? []).reduce((n, b) => n + b.count, 0);

  return (
    <div className="space-y-4 pb-24">
      <PageHeader icon={<RotateCcw size={20} />} title={t('title')} description={t('description')} />

      {queue && (
        <div
          role={queue.stalled ? 'alert' : 'status'}
          className={cn(
            'rounded-lg border-2 p-3 text-sm',
            queue.stalled ? 'border-tone-danger bg-tone-danger/10 font-medium text-tone-danger' : 'border-border bg-card',
          )}
        >
          <div>
            {t('queue.waiting', { count: queue.waiting })} ·{' '}
            {queue.lastToolWriteAt
              ? t('queue.last', { ago: dayjs(queue.lastToolWriteAt).fromNow(), at: dayjs(queue.lastToolWriteAt).format('DD/MM HH:mm') })
              : t('queue.never')}
          </div>
          {queue.stalled && <div className="mt-1">{t('queue.stalled')}</div>}
        </div>
      )}

      <div role="alert" className="flex items-start gap-3 rounded-lg border-2 border-tone-warning bg-tone-warning/10 p-3 text-sm font-medium text-tone-warning">
        <AlertTriangle size={20} className="mt-0.5 shrink-0" />
        <span>{t('warning')}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t('onlyClears')}</p>

      {summary && (
        <StatCards
          cols={3}
          items={[
            { key: 'total', label: t('summary.total'), value: summary.total.toLocaleString() },
            { key: 'returnable', label: t('summary.returnable'), value: summary.returnable.toLocaleString(), tone: 'success' },
            { key: 'blocked', label: t('summary.blocked'), value: blockedTotal.toLocaleString(), tone: blockedTotal ? 'warning' : 'neutral' },
          ]}
        />
      )}
      {summary && summary.blocked.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3 text-xs">
          <div className="mb-1 font-semibold">{t('blockedTitle')}</div>
          <ul className="space-y-0.5">
            {summary.blocked.map((b) => (
              <li key={b.reason} className="flex justify-between gap-2">
                <span>{t(`block.${b.reason}`)}</span>
                <span className="font-mono tabular-nums">{b.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm touch:min-h-11"
          value={filters.factoryId}
          onChange={(e) => setFilter('factoryId', e.target.value)}
          aria-label={t('filters.factory')}
        >
          <option value="">{t('filters.allFactories')}</option>
          {(summary?.byFactory ?? []).map((f) => (
            <option key={f.factoryId} value={f.factoryId}>
              {(f.shortName || f.factoryId || '—') + ` (${f.returnable})`}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm touch:min-h-11"
          value={filters.toolResult}
          onChange={(e) => setFilter('toolResult', e.target.value)}
          aria-label={t('filters.toolResult')}
        >
          <option value="">{t('filters.allToolResults')}</option>
          {(summary?.byToolResult ?? []).map((x) => (
            <option key={x.toolResult} value={x.toolResult}>
              {`${x.toolResult} (${x.returnable})`}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm touch:min-h-11">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={filters.returnable} onChange={(e) => setFilter('returnable', e.target.checked)} />
          {t('filters.onlyReturnable')}
        </label>
        {filters.type && (
          <Button variant="outline" size="sm" onClick={() => setFilter('type', '')} className="max-w-full">
            <span className="truncate">{filters.type}</span> ×
          </Button>
        )}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
            {t('filters.clear')}
          </Button>
        )}
        <div className="ml-auto flex gap-1 max-md:ml-0 max-md:w-full">
          {(['orders', 'type'] as View[]).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? 'default' : 'outline'}
              className="max-md:flex-1"
              onClick={() => {
                setView(v);
                setPage(1);
              }}
            >
              {t(v === 'orders' ? 'view.orders' : 'view.byProduct')}
            </Button>
          ))}
        </div>
      </div>

      {loading && rows.length === 0 && groups.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : view === 'orders' ? (
        rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <PaginationBar position="top" page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onChange={(p) => setPage(p)} />
            <ul className={cn('space-y-2', loading && 'opacity-60')}>
              {rows.map((r) => (
                <ReturnRow key={r._id} row={r} checked={selected.has(r._id)} onToggle={() => toggle(r)} />
              ))}
            </ul>
            <PaginationBar position="bottom" page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onChange={(p) => setPage(p)} />
          </>
        )
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.key || '—'} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="break-words font-medium">{g.key || '—'}</div>
                <div className="text-xs text-muted-foreground">
                  {t('group.orders', { count: g.count })} · {t('group.returnable', { count: g.returnable })}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFilter('type', g.key);
                  setView('orders');
                }}
              >
                {t('group.open')}
              </Button>
              <Button size="sm" variant="outline" disabled={!g.returnable} onClick={() => void selectGroup(g)}>
                {t('group.select')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 shadow-lg backdrop-blur max-md:pb-[calc(env(safe-area-inset-bottom)+4.5rem)]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{t('selection.count', { count: selected.size, max: TOOL_QUEUE_RETURN_BATCH_MAX })}</span>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
              {t('selection.clear')}
            </Button>
            <Button size="sm" className="ml-auto" onClick={() => setPreviewOpen(true)}>
              {t('selection.preview')}
            </Button>
          </div>
        </div>
      )}

      {previewOpen && (
        <PreviewDialog
          ids={[...selected.keys()]}
          onClose={() => setPreviewOpen(false)}
          onDone={(res) => {
            setPreviewOpen(false);
            setSelected(new Map());
            setReload((n) => n + 1);
            toast.success(t('result.done', { count: res.done, runId: res.runId }));
            if (res.skipped.length) {
              toast.warning(t('result.skipped', { count: res.skipped.length, list: res.skipped.slice(0, 5).map((s) => `${s.productionId ?? s.id} (${t(`block.${s.reason}`, { defaultValue: s.reason })})`).join(', ') }));
            }
          }}
        />
      )}
    </div>
  );
}

function ReturnRow({ row: r, checked, onToggle }: { row: ToolQueueReturnRow; checked: boolean; onToggle: () => void }) {
  const { t } = useTranslation('toolQueueReturn');

  return (
    <li className={cn('rounded-lg border bg-card p-3', checked ? 'border-primary ring-1 ring-primary/40' : 'border-border')}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))] touch:h-6 touch:w-6"
          checked={checked}
          disabled={!r.returnable}
          onChange={onToggle}
          aria-label={r.productionId}
          title={r.blockReason ? t(`block.${r.blockReason}`) : undefined}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-sm font-semibold">{r.productionId}</span>
            <span className="text-xs text-muted-foreground">{r.factoryShortName}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium">{r.toolResult}</span>
            <span className="text-xs text-muted-foreground">{fmt(r.inProductionAt)}</span>
          </div>
          <div className="break-words text-xs text-muted-foreground">{r.type}</div>
          {r.blockReason && <div className="text-xs font-medium text-tone-warning">{t(`block.${r.blockReason}`)}</div>}
        </div>
      </div>
    </li>
  );
}

function PreviewDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (res: ToolQueueReturnRunResult) => void }) {
  const { t } = useTranslation('toolQueueReturn');
  const [preview, setPreview] = useState<ToolQueueReturnPreview | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    RepositoryRemote.order
      .previewToolQueueReturn(ids)
      .then((res) => setPreview((res.data as { data: ToolQueueReturnPreview }).data))
      .catch((err) => {
        handleAxiosError(err);
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = preview?.returnable ?? 0;
  const canRun = !!preview && n > 0 && reason.trim().length >= 10 && typed.trim() === String(n) && !running;
  const eligibleIds = useMemo(() => (preview?.rows ?? []).filter((r) => r.returnable).map((r) => r._id), [preview]);

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    try {
      const res = await RepositoryRemote.order.runToolQueueReturn(eligibleIds, reason.trim());
      onDone((res.data as { data: ToolQueueReturnRunResult }).data);
    } catch (err) {
      handleAxiosError(err);
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('preview.title', { count: n })}</DialogTitle>
        </DialogHeader>
        {!preview ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner size={16} /> {t('preview.loading')}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="rounded-md border border-tone-warning/40 bg-tone-warning/10 p-2 font-medium text-tone-warning">{t('warning')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Breakdown title={t('preview.byFactory')} items={preview.byFactory.map((x) => [x.shortName || '—', x.count])} />
              <Breakdown title={t('preview.byToolResult')} items={preview.byToolResult.map((x) => [x.toolResult, x.count])} />
            </div>
            {preview.skipped.length > 0 && (
              <p className="text-tone-warning">
                {t('preview.skipped', { count: preview.skipped.length })}{' '}
                {preview.skipped.slice(0, 8).map((s) => `${s.productionId ?? s.id} (${t(`block.${s.reason}`, { defaultValue: s.reason })})`).join(', ')}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
              <Button size="sm" variant="outline" onClick={() => exportReturnList(preview.rows, (k, o) => t(k, o))}>
                <Download size={14} className="mr-1.5" /> {t('preview.export')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('preview.exportHint')}</span>
            </div>
            <label className="block space-y-1">
              <span className="font-medium">{t('preview.reason')}</span>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('preview.reasonPlaceholder')} rows={2} maxLength={500} />
            </label>
            <label className="block space-y-1">
              <span className="font-medium">{t('preview.confirm', { count: n })}</span>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" className="w-32" />
            </label>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={running}>
            {t('preview.cancel')}
          </Button>
          <Button onClick={() => void run()} disabled={!canRun}>
            {running ? (
              <>
                <Spinner size={14} className="mr-1.5" /> {t('preview.running')}
              </>
            ) : (
              t('preview.run', { count: n })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Breakdown({ title, items }: { title: string; items: Array<[string, number]> }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="space-y-0.5 text-xs">
        {items.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-2">
            <span className="truncate">{k}</span>
            <span className="font-mono tabular-nums">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
