import React, { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, CheckCircle2, FileText, Link2, Loader2, Upload, XCircle } from 'lucide-react';
import type {
  CuttingFileBreakdownRow,
  CuttingFileConflict,
  CuttingFileInvalid,
  CuttingFileMatched,
  CuttingFileNotFound,
} from 'shared';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { StatCards } from '@/components/common/StatCards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { handleAxiosError } from '@/utils';

interface ImportCuttingFilesTabProps {
  onApplied: () => void;
}

interface PreviewState {
  matched: CuttingFileMatched[];
  notFound: CuttingFileNotFound[];
  invalid: CuttingFileInvalid[];
  conflicts: CuttingFileConflict[];
  summary: {
    totalLinks: number;
    matched: number;
    withExistingFile: number;
    notFound: number;
    invalid: number;
    conflicts: number;
    byFactory: CuttingFileBreakdownRow[];
    byMachineType: CuttingFileBreakdownRow[];
  };
}

function buildInvalidReasonLabel(t: TFunction<'orders'>): Record<CuttingFileInvalid['reason'], string> {
  return {
    'invalid-url': t('cuttingFilesTab.invalidReasonLabel.invalidUrl'),
    'fetch-failed': t('cuttingFilesTab.invalidReasonLabel.fetchFailed'),
    'parse-failed': t('cuttingFilesTab.invalidReasonLabel.parseFailed'),
    'no-production-id': t('cuttingFilesTab.invalidReasonLabel.noProductionId'),
  };
}

export function ImportCuttingFilesTab({ onApplied }: ImportCuttingFilesTabProps) {
  const { t } = useTranslation('orders');
  const INVALID_REASON_LABEL = useMemo(() => buildInvalidReasonLabel(t), [t]);
  const [text, setText] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  const links = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [text],
  );

  // Khi xlsx upload: lấy cột A (index 0) của mọi row, bỏ rỗng. Không header.
  const handleFile = async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    try {
      if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) {
          toast.error(t('cuttingFilesTab.emptyFile'));
          return;
        }
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
          header: 1,
          blankrows: false,
        });
        const colA = rows.map((r) => (Array.isArray(r) && r[0] != null ? String(r[0]).trim() : '')).filter(Boolean);
        setText(colA.join('\n'));
      } else {
        setText(await file.text());
      }
    } catch (err) {
      toast.error(t('cuttingFilesTab.fileReadError'));

      console.error(err);
    }
  };

  const handlePreview = async () => {
    if (links.length === 0) {
      toast.error(t('cuttingFilesTab.pasteAtLeastOne'));
      return;
    }
    if (links.length > 2000) {
      toast.error(t('cuttingFilesTab.maxLinks'));
      return;
    }
    try {
      setPreviewing(true);
      const resp = await RepositoryRemote.order.previewCuttingFiles({ links });
      setPreview(resp.data.data as PreviewState);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!preview) return;
    // Filter ra mapping eligible: matched + (nếu chưa overwrite) bỏ row đã có
    // file cũ. BE cũng tự skip nhưng filter trước cho FE đếm chính xác.
    const mappings = preview.matched
      .filter((m) => (overwrite ? true : !m.existingCuttingFileUrl))
      .map((m) => ({
        orderId: m.orderId,
        cuttingFileUrl: m.link,
        cuttingFileName: m.fileName,
      }));
    if (mappings.length === 0) {
      toast.error(t('cuttingFilesTab.noOrdersToMap'));
      return;
    }
    try {
      setApplying(true);
      const resp = await RepositoryRemote.order.applyCuttingFiles({ mappings, overwrite });
      const data = resp.data.data as { updated: number; skipped: number };
      if (data.updated === 0) {
        toast.error(t('cuttingFilesTab.updateZero', { skipped: data.skipped }));
      } else if (data.updated < mappings.length) {
        toast.warning(t('cuttingFilesTab.updatePartial', { updated: data.updated, total: mappings.length, skipped: data.skipped }));
      } else {
        toast.success(t('cuttingFilesTab.updateSuccess', { updated: data.updated, skipped: data.skipped }));
      }
      setPreview(null);
      setText('');
      setOverwrite(false);
      onApplied();
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setApplying(false);
    }
  };

  const eligibleMatchCount = preview
    ? overwrite
      ? preview.matched.length
      : preview.matched.length - preview.summary.withExistingFile
    : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('cuttingFilesTab.title')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              <Trans
                i18nKey="cuttingFilesTab.description"
                ns="orders"
                components={{
                  code1: <code className="px-1 rounded bg-muted text-foreground" />,
                  code2: <code className="px-1 rounded bg-muted" />,
                }}
              />
            </p>
          </div>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.tsv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
            <span className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md border border-input bg-background shadow-sm hover:bg-accent">
              <FileText size={14} />
              {t('cuttingFilesTab.chooseFile')}
            </span>
          </label>
        </div>

        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (preview) setPreview(null);
          }}
          rows={10}
          className="font-mono text-xs"
          placeholder={t('cuttingFilesTab.placeholder')}
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Link2 size={12} />
            {links.length > 0 ? (
              <>
                <Badge variant="secondary">{links.length}</Badge> {t('cuttingFilesTab.linksReady')}
              </>
            ) : (
              t('cuttingFilesTab.noLinks')
            )}
          </p>
          <Button onClick={handlePreview} disabled={previewing || links.length === 0}>
            {previewing ? <Spinner size={14} className="text-primary-foreground" /> : <Upload size={14} />}
            {t('cuttingFilesTab.checkBtn', { count: links.length })}
          </Button>
        </div>
      </div>

      {preview && (
        <>
          <StatCards
            cols={5}
            items={[
              { key: 'total', label: t('cuttingFilesTab.statTotalLinks'), value: preview.summary.totalLinks, icon: <Link2 size={12} /> },
              {
                key: 'matched',
                label: t('cuttingFilesTab.statMatched'),
                value: preview.summary.matched,
                icon: <CheckCircle2 size={12} />,
                tone: 'success',
              },
              {
                key: 'existing',
                label: t('cuttingFilesTab.statExistingFile'),
                value: preview.summary.withExistingFile,
                icon: <AlertTriangle size={12} />,
                tone: 'warning',
              },
              {
                key: 'notFound',
                label: t('cuttingFilesTab.statNotFound'),
                value: preview.summary.notFound,
                icon: <XCircle size={12} />,
                tone: 'warning',
              },
              {
                key: 'invalid',
                label: t('cuttingFilesTab.statInvalidLink'),
                value: preview.summary.invalid + preview.summary.conflicts,
                icon: <XCircle size={12} />,
                tone: 'danger',
              },
            ]}
          />

          {(preview.summary.byFactory.length > 0 || preview.summary.byMachineType.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <BreakdownCard title={t('cuttingFilesTab.breakdownFactory')} rows={preview.summary.byFactory} />
              <BreakdownCard title={t('cuttingFilesTab.breakdownMachine')} rows={preview.summary.byMachineType} />
            </div>
          )}

          {preview.conflicts.length > 0 && (
            <Section title={t('cuttingFilesTab.conflictTitle', { count: preview.conflicts.length })} tone="danger">
              <ul className="text-xs space-y-1.5">
                {preview.conflicts.map((c) => (
                  <li key={c.productionId} className="space-y-1">
                    <span className="font-mono font-semibold text-foreground">{c.productionId}</span>{' '}
                    <span className="text-muted-foreground">
                      {t('cuttingFilesTab.linkCountSuffix', { count: c.links.length })}
                    </span>
                    <ul className="ml-3 space-y-0.5">
                      {c.links.map((l) => (
                        <li key={l} className="font-mono text-[10px] text-muted-foreground break-all">
                          · {l}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {preview.invalid.length > 0 && (
            <Section title={t('cuttingFilesTab.invalidTitle', { count: preview.invalid.length })} tone="warning">
              <ul className="text-xs space-y-1">
                {preview.invalid.map((iv, idx) => (
                  <li key={`${iv.link}-${idx}`}>
                    <span className="text-rose-700 dark:text-rose-300">{INVALID_REASON_LABEL[iv.reason]}</span>
                    {iv.fileName && <span className="text-muted-foreground"> — {iv.fileName}</span>}
                    <div className="font-mono text-[10px] text-muted-foreground break-all">{iv.link}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {preview.notFound.length > 0 && (
            <Section title={t('cuttingFilesTab.notFoundTitle', { count: preview.notFound.length })} tone="warning">
              <ul className="text-xs space-y-1">
                {preview.notFound.map((nf) => (
                  <li key={nf.link}>
                    <span className="font-mono font-semibold text-foreground">{nf.productionId}</span>{' '}
                    <span className="text-muted-foreground">— {nf.fileName}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {preview.matched.length > 0 && (
            <Section title={t('cuttingFilesTab.readyTitle', { count: preview.matched.length })} tone="success" defaultOpen>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left p-2">{t('cuttingFilesTab.colProductionId')}</th>
                      <th className="text-left p-2">{t('cuttingFilesTab.colFactory')}</th>
                      <th className="text-left p-2">{t('cuttingFilesTab.colMachine')}</th>
                      <th className="text-left p-2">{t('cuttingFilesTab.colNewFile')}</th>
                      <th className="text-left p-2">{t('cuttingFilesTab.colOldFile')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.matched.map((m) => (
                      <tr key={m.orderId} className="border-t border-border/40">
                        <td className="p-2 font-mono font-semibold">{m.productionId}</td>
                        <td className="p-2">{m.factoryName || '—'}</td>
                        <td className="p-2">{m.machineTypeName || '—'}</td>
                        <td className="p-2 text-muted-foreground line-clamp-1 max-w-[280px]">{m.fileName}</td>
                        <td className="p-2">
                          {m.existingCuttingFileUrl ? (
                            <Badge variant="warning">{m.existingCuttingFileName || t('cuttingFilesTab.hasOldFile')}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              {t('cuttingFilesTab.overwriteLabel', { count: preview.summary.withExistingFile })}
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                <Trans
                  i18nKey="cuttingFilesTab.willMap"
                  ns="orders"
                  values={{ count: eligibleMatchCount }}
                  components={{ strong: <strong className="text-foreground" /> }}
                />
              </span>
              <Button onClick={handleApply} disabled={applying || eligibleMatchCount === 0}>
                {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {t('cuttingFilesTab.mappingBtn', { count: eligibleMatchCount })}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: CuttingFileBreakdownRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="text-xs font-semibold text-foreground mb-2">{title}</h4>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id ?? '__none'} className="flex items-center justify-between text-xs">
            <span className="text-foreground">{r.name}</span>
            <Badge variant="secondary">{r.count}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({
  title,
  tone,
  children,
  defaultOpen = false,
}: {
  title: string;
  tone: 'success' | 'warning' | 'danger';
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation('orders');
  const [open, setOpen] = useState(defaultOpen);
  const toneCls = {
    success: 'border-emerald-300 dark:border-emerald-700/50',
    warning: 'border-amber-300 dark:border-amber-700/50',
    danger: 'border-rose-300 dark:border-rose-700/50',
  }[tone];
  return (
    <div className={`rounded-lg border bg-card ${toneCls}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 text-left text-sm font-semibold flex items-center justify-between"
      >
        <span className="text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{open ? t('cuttingFilesTab.hide') : t('cuttingFilesTab.show')}</span>
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}
