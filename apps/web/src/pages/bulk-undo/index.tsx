import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { AlertOctagon, Download, History } from 'lucide-react';
import type { BulkUndoGroup, BulkUndoResult, BulkUndoRow } from 'shared';
import { BULK_UNDO_BATCH_MAX, BULK_UNDO_GROUPS } from 'shared';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

import { RepositoryRemote } from '@/services';

import { PageHeader } from '@/components/common/PageHeader';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { usePermission } from '@/hooks/usePermission';

import { downloadWorkbook } from '../home/exportOrders';

/**
 * Undo a mistaken bulk edit (Orders.md §27), SuperAdmin only, no sidebar entry. Every preview and
 * every run recomputes from the live database: people keep fixing these orders by hand, and an
 * order someone touched after the incident is always left alone and reported. One group per batch,
 * at most BULK_UNDO_BATCH_MAX orders per run; preview again for the next batch.
 */
export default function BulkUndoPage() {
  const { t } = useTranslation('bulkUndo');
  const { roleName } = usePermission();
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [group, setGroup] = useState<BulkUndoGroup>('designer');
  const [preview, setPreview] = useState<BulkUndoResult | null>(null);
  const [result, setResult] = useState<BulkUndoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');

  if (roleName !== 'SuperAdmin') {
    return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">{t('noPermission')}</div>;
  }

  // datetime-local is the viewer's local time (VN for the team); the API takes instants.
  const scope = () => ({ actor: actor.trim(), from: new Date(from).toISOString(), to: new Date(to).toISOString(), group });
  const scopeValid = actor.trim() && from && to && new Date(from) < new Date(to);
  const batch = (preview?.rows ?? []).filter((r) => r.status === 'restore').slice(0, BULK_UNDO_BATCH_MAX);

  const runPreview = async () => {
    setLoading(true);
    setResult(null);
    setTyped('');
    try {
      const res = await RepositoryRemote.order.previewBulkUndo(scope());
      setPreview((res.data as { data: BulkUndoResult }).data);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  const run = async () => {
    setLoading(true);
    try {
      const res = await RepositoryRemote.order.runBulkUndo({ ...scope(), ids: batch.map((r) => r.orderId), reason: reason.trim() });
      const data = (res.data as { data: BulkUndoResult }).data;
      setResult(data);
      setPreview(null);
      setTyped('');
      toast.success(t('result.done', { restored: data.restorable, skipped: data.skipped }));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (v: unknown, field: string, names: Record<string, string>): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'assignee' && typeof v === 'string') return names[v] ? `${names[v]} (${v})` : v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dayjs(v).format('DD/MM/YYYY HH:mm:ss');
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  };

  /** Before/after file: production id · field · value now · value restored · restored or skipped (why). */
  const exportFile = (data: BulkUndoResult, kind: 'preview' | 'result') => {
    const head = [t('file.productionId'), t('file.field'), t('file.current'), t('file.restore'), t('file.status'), t('file.reason')];
    const body = data.rows.flatMap((r) =>
      (r.changes.length ? r.changes : [{ field: '', current: null, restore: null }]).map((c) => [
        r.productionId,
        c.field,
        fmt(c.current, c.field, data.userNames),
        fmt(c.restore, c.field, data.userNames),
        t(`status.${r.status}`),
        r.reason ? t(`skip.${r.reason}`) : '',
      ]),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), group);
    downloadWorkbook(`hoan-tac-${group}-${kind}-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`, wb);
  };

  const shown = result ?? preview;
  return (
    <div className="space-y-4">
      <PageHeader icon={<History size={20} />} title={t('title')} description={t('description')} />
      <div role="alert" className="flex items-start gap-3 rounded-lg border-2 border-tone-danger bg-tone-danger/10 p-3 text-sm font-medium text-tone-danger">
        <AlertOctagon size={20} className="mt-0.5 shrink-0" />
        <span>{t('warning', { max: BULK_UNDO_BATCH_MAX })}</span>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('form.actor')}</span>
          <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder={t('form.actorPlaceholder')} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('form.from')}</span>
          <Input type="datetime-local" step="1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('form.to')}</span>
          <Input type="datetime-local" step="1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('form.group')}</span>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm touch:min-h-11" value={group} onChange={(e) => { setGroup(e.target.value as BulkUndoGroup); setPreview(null); setResult(null); }}>
            {BULK_UNDO_GROUPS.map((g) => (
              <option key={g} value={g}>{t(`group.${g}`)}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">{t(`groupHelp.${group}`)}</p>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button onClick={() => void runPreview()} disabled={!scopeValid || loading}>
            {loading && !preview ? <Spinner size={14} className="mr-1.5" /> : null}
            {t('form.preview')}
          </Button>
        </div>
      </div>

      {shown && (
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold">{t(result ? 'summary.result' : 'summary.preview', { affected: shown.affected, restorable: shown.restorable, skipped: shown.skipped })}</span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => exportFile(shown, result ? 'result' : 'preview')}>
              <Download size={14} /> {t('file.export')}
            </Button>
          </div>
          <SkipSummary rows={shown.rows} />
          <div className="max-h-[50dvh] overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1.5">{t('file.productionId')}</th>
                  <th className="px-2 py-1.5">{t('file.field')}</th>
                  <th className="px-2 py-1.5">{t('file.current')}</th>
                  <th className="px-2 py-1.5">{t('file.restore')}</th>
                  <th className="px-2 py-1.5">{t('file.status')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((r) =>
                  (r.changes.length ? r.changes : [{ field: '—', current: null, restore: null }]).map((c, i) => (
                    <tr key={`${r.orderId}-${c.field}`} className={cn('border-t border-border', r.status === 'skip' && 'text-muted-foreground')}>
                      <td className="px-2 py-1 font-mono">{i === 0 ? r.productionId : ''}</td>
                      <td className="px-2 py-1 font-mono">{c.field}</td>
                      <td className="px-2 py-1">{fmt(c.current, c.field, shown.userNames)}</td>
                      <td className="px-2 py-1 font-medium">{fmt(c.restore, c.field, shown.userNames)}</td>
                      <td className="px-2 py-1">{i === 0 ? (r.reason ? t(`skip.${r.reason}`) : t(`status.${r.status}`)) : ''}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>

          {preview && batch.length > 0 && (
            <div className="space-y-2 rounded-md border border-tone-danger/40 bg-tone-danger/5 p-3">
              <p className="text-sm font-semibold text-tone-danger">{t('run.title', { count: batch.length, total: preview.restorable })}</p>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('run.reasonPlaceholder')} rows={2} maxLength={500} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{t('run.confirm', { count: batch.length })}</span>
                <Input className="w-24" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} />
                <Button variant="destructive" disabled={loading || reason.trim().length < 10 || typed.trim() !== String(batch.length)} onClick={() => void run()}>
                  {loading ? <Spinner size={14} className="mr-1.5" /> : null}
                  {t('run.button', { count: batch.length })}
                </Button>
              </div>
            </div>
          )}
          {result && (
            <Button variant="outline" onClick={() => void runPreview()} disabled={loading}>
              {t('run.next')}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

function SkipSummary({ rows }: { rows: BulkUndoRow[] }) {
  const { t } = useTranslation('bulkUndo');
  const counts = new Map<string, number>();
  for (const r of rows) if (r.reason) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  if (!counts.size) return null;
  return (
    <p className="text-xs text-tone-warning">
      {t('skip.title')}: {[...counts.entries()].map(([k, n]) => `${t(`skip.${k}`)} (${n})`).join(' · ')}
    </p>
  );
}
