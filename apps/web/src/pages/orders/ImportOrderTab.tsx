import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { CloudDownload, FileCheck2, FilePlus2, FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

import { RepositoryRemote } from '@/services';

import { DateRangePicker } from '@/components/common/DateRangePicker';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { parseOrderRows, parseReworkOrderRows } from './parseOrders';

type ImportMode = 'new' | 'rework';

interface ImportOrderTabProps {
  onImported: () => void;
}

interface NewImportResult {
  imported: number;
  updated: number;
  mapped: number;
  unmapped: number;
  skipped: { row: number; reason: string }[];
}

interface ReworkImportResult {
  updated: number;
  notFound: number;
  cancelled: number;
  assigneeMatched: number;
  skipped: { row: number; reason: string }[];
}

export function ImportOrderTab({ onImported }: ImportOrderTabProps) {
  const { t } = useTranslation('orders');
  const [mode, setMode] = useState<ImportMode>('new');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [onosPodLoading, setOnosPodLoading] = useState(false);
  const [onosPodFrom, setOnosPodFrom] = useState('');
  const [onosPodTo, setOnosPodTo] = useState('');
  const [lastNewResult, setLastNewResult] = useState<NewImportResult | null>(null);
  const [lastReworkResult, setLastReworkResult] = useState<ReworkImportResult | null>(null);

  const parsedCount = useMemo(() => {
    return mode === 'new' ? parseOrderRows(text).length : parseReworkOrderRows(text).length;
  }, [text, mode]);

  const handleFile = async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    try {
      if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) {
          toast.error(t('importTab.emptyFile'));
          return;
        }
        const tsv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], {
          FS: '\t',
          dateNF: 'yyyy-mm-dd HH:mm:ss',
        });
        setText(tsv);
      } else {
        setText(await file.text());
      }
    } catch (err) {
      toast.error(t('importTab.fileReadError'));

      console.error(err);
    }
  };

  const handleImport = async () => {
    if (mode === 'new') {
      const rows = parseOrderRows(text);
      if (rows.length === 0) {
        toast.error(t('importTab.noRowsNew'));
        return;
      }
      try {
        setLoading(true);
        const resp = await RepositoryRemote.order.importOrders({ rows });
        const result = resp.data.data as NewImportResult;
        setLastNewResult(result);
        setLastReworkResult(null);
        toast.success(
          t('importTab.importSuccess', {
            imported: result.imported,
            updated: result.updated,
            mapped: result.mapped,
            total: result.mapped + result.unmapped,
          }),
        );
        onImported();
        setText('');
      } catch (error) {
        handleAxiosError(error);
      } finally {
        setLoading(false);
      }
    } else {
      const rows = parseReworkOrderRows(text);
      if (rows.length === 0) {
        toast.error(t('importTab.noRowsRework'));
        return;
      }
      try {
        setLoading(true);
        const resp = await RepositoryRemote.order.importRework({ rows });
        const result = resp.data.data as ReworkImportResult;
        setLastReworkResult(result);
        setLastNewResult(null);
        toast.success(
          t('importTab.reworkSuccess', {
            updated: result.updated,
            notFound: result.notFound,
            cancelled: result.cancelled,
            assigneeMatched: result.assigneeMatched,
          }),
        );
        onImported();
        setText('');
      } catch (error) {
        handleAxiosError(error);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleImportFromOnosPod = async () => {
    try {
      setOnosPodLoading(true);
      const payload =
        onosPodFrom && onosPodTo
          ? { start: dayjs(onosPodFrom).startOf('day').toISOString(), end: dayjs(onosPodTo).endOf('day').toISOString() }
          : {};
      const resp = await RepositoryRemote.order.importFromOnosPod(payload);
      const result = resp.data.data as NewImportResult & {
        totalFetched: number;
        shippingAttached?: number;
        byManufacture: { id: string; name: string; sku: string; fetched: number; error?: string }[];
      };
      setLastNewResult(result);
      setLastReworkResult(null);
      const manufactureSummary = result.byManufacture
        .map((m) => `${m.sku}${m.error ? t('importTab.errorSuffix') : ''}: ${m.fetched}`)
        .join(', ');
      toast.success(
        t('importTab.onosPodSuccess', {
          totalFetched: result.totalFetched,
          count: result.byManufacture.length,
          summary: manufactureSummary,
          imported: result.imported,
          updated: result.updated,
          mapped: result.mapped,
          total: result.mapped + result.unmapped,
          shippingAttached: result.shippingAttached ?? 0,
        }),
      );
      const failedManufactures = result.byManufacture.filter((m) => m.error);
      if (failedManufactures.length > 0) {
        toast.error(
          t('importTab.onosPodFailed', {
            count: failedManufactures.length,
            list: failedManufactures.map((m) => `${m.sku} — ${m.error}`).join('; '),
          }),
        );
      }
      onImported();
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setOnosPodLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('importTab.pasteTitle')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mode === 'new' ? t('importTab.pasteHintNew') : t('importTab.pasteHintRework')}
            </p>
            {mode === 'new' && !onosPodFrom && !onosPodTo && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{t('importTab.onosPodDateRangeHint')}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {mode === 'new' && (
              <>
                <DateRangePicker
                  from={onosPodFrom}
                  to={onosPodTo}
                  onChange={(f, t2) => {
                    setOnosPodFrom(f);
                    setOnosPodTo(t2);
                  }}
                  placeholder={t('importTab.onosPodDateRangePlaceholder')}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={onosPodLoading}
                  onClick={handleImportFromOnosPod}
                >
                  {onosPodLoading ? <Spinner size={14} /> : <CloudDownload size={14} />}
                  {t('importTab.fetchOnosPod')}
                </Button>
              </>
            )}
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <span className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md border border-input bg-background shadow-sm hover:bg-accent">
                <FileText size={14} />
                {t('importTab.chooseFile')}
              </span>
            </label>
          </div>
        </div>

        {/* Mode picker */}
        <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => {
              setMode('new');
              setText('');
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              mode === 'new'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FilePlus2 size={13} /> {t('importTab.modeNew')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('rework');
              setText('');
            }}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              mode === 'rework'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FileCheck2 size={13} /> {t('importTab.modeRework')}
          </button>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          className="font-mono text-xs"
          placeholder={mode === 'new' ? t('importTab.placeholderNew') : t('importTab.placeholderRework')}
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {parsedCount > 0 ? (
              <>
                <Badge variant="secondary">{parsedCount}</Badge>{' '}
                {mode === 'new' ? t('importTab.rowsReadyNew') : t('importTab.rowsReadyRework')}
              </>
            ) : (
              t('importTab.noRowsHint')
            )}
          </p>
          <Button onClick={handleImport} disabled={loading || parsedCount === 0}>
            {loading ? <Spinner size={14} className="text-primary-foreground" /> : <Upload size={14} />}
            {mode === 'new' ? t('importTab.importBtn') : t('importTab.reworkBtn')} {parsedCount > 0 ? `(${parsedCount})` : ''}
          </Button>
        </div>
      </div>

      {lastNewResult && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t('importTab.lastResultNewTitle')}</h3>
          <div className="grid grid-cols-4 gap-3">
            <Stat label={t('importTab.statImported')} value={lastNewResult.imported} accent="success" t={t} />
            <Stat label={t('importTab.statUpdated')} value={lastNewResult.updated} accent="secondary" t={t} />
            <Stat label={t('importTab.statMapped')} value={lastNewResult.mapped} accent="success" t={t} />
            <Stat label={t('importTab.statUnmapped')} value={lastNewResult.unmapped} accent="warning" t={t} />
          </div>
          <SkippedList items={lastNewResult.skipped} t={t} />
        </div>
      )}

      {lastReworkResult && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t('importTab.lastResultReworkTitle')}</h3>
          <div className="grid grid-cols-4 gap-3">
            <Stat label={t('importTab.statUpdated')} value={lastReworkResult.updated} accent="success" t={t} />
            <Stat label={t('importTab.statNotFound')} value={lastReworkResult.notFound} accent="warning" t={t} />
            <Stat label={t('importTab.statCancelled')} value={lastReworkResult.cancelled} accent="warning" t={t} />
            <Stat label={t('importTab.statAssigned')} value={lastReworkResult.assigneeMatched} accent="secondary" t={t} />
          </div>
          <SkippedList items={lastReworkResult.skipped} t={t} />
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  t,
}: {
  label: string;
  value: number;
  accent: 'success' | 'warning' | 'secondary';
  t: (key: string) => string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-xl font-bold text-foreground mt-1">{value}</p>
      <Badge variant={accent} className="mt-1">
        {accent === 'success' ? t('importTab.statOk') : accent === 'warning' ? t('importTab.statCheck') : t('importTab.statInfo')}
      </Badge>
    </div>
  );
}

function SkippedList({ items, t }: { items: { row: number; reason: string }[]; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-foreground mb-2">{t('importTab.skippedRows', { count: items.length })}</p>
      <ul className="space-y-1 text-xs text-muted-foreground max-h-40 overflow-auto">
        {items.map((s) => (
          <li key={s.row}>{t('importTab.rowItem', { row: s.row, reason: s.reason })}</li>
        ))}
      </ul>
    </div>
  );
}
