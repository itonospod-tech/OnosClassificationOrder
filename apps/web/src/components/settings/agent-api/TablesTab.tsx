import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, EyeOff, Play, Shield, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { cn } from '@/utils/cn';

import type { AgentAdminOverview, AgentAdminTable } from './types';

interface Props {
  overview: AgentAdminOverview;
  onTryTable: (table: string) => void;
}

const Yes = () => <Check size={15} className="text-emerald-600 dark:text-emerald-400" />;
const No = () => <X size={15} className="text-slate-300 dark:text-slate-600" />;

/**
 * Phan B — Bang du lieu (AC-04, AC-05, AC-16).
 *
 * Moi thu render o day den TU `overview.tables` do BE dung tu registry. Khong
 * co danh sach bang/truong nao duoc chep cung trong file nay — them mot truong
 * vao registry la no tu hien ra (BR-4, AC-05).
 */
export function TablesTab({ overview, onTryTable }: Props) {
  const { t } = useTranslation('agentApi');
  const tables = overview.tables;
  const [selectedKey, setSelectedKey] = useState<string>(tables[0]?.key || '');

  if (!tables.length) {
    return (
      <div className="rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-8 text-center text-slate-500 dark:text-slate-400">
        {t('tables.empty')}
      </div>
    );
  }

  const selected: AgentAdminTable = tables.find((tb) => tb.key === selectedKey) || tables[0];
  const readableCount = (tb: AgentAdminTable) => tb.fields.filter((f) => f.read).length;

  return (
    <div className="flex flex-col xl:flex-row items-start gap-4">
      <aside className="w-full xl:w-72 shrink-0 space-y-1">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {t('tables.listTitle', { n: tables.length })}
        </p>
        {tables.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setSelectedKey(tb.key)}
            className={cn(
              'w-full rounded-lg px-3 py-2 text-left transition-colors',
              tb.key === selected.key
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200',
            )}
          >
            <span className="block font-mono text-sm font-medium">{tb.key}</span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              {t('tables.fieldCount', { readable: readableCount(tb), total: tb.fields.length })}
            </span>
          </button>
        ))}
      </aside>

      <section className="min-w-0 flex-1 space-y-4">
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-mono text-base font-semibold text-slate-800 dark:text-slate-100">{selected.key}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{selected.description}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onTryTable(selected.key)}>
              <Play size={14} />
              <span className="ml-1.5">{t('tables.tryThis')}</span>
            </Button>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {t('tables.defaultSort')}: <code className="font-mono">{selected.defaultSort}</code>
            </span>
            <span>
              {t('tables.entityName')}: <code className="font-mono">{selected.entityName}</code>
            </span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">{t('tables.colField')}</TableHead>
                  <TableHead className="w-28">{t('tables.colType')}</TableHead>
                  <TableHead className="w-24">{t('tables.colRead')}</TableHead>
                  <TableHead className="w-32">{t('tables.colFilter')}</TableHead>
                  <TableHead className="w-24">{t('tables.colSort')}</TableHead>
                  <TableHead className="w-24">{t('tables.colGroup')}</TableHead>
                  <TableHead className="min-w-[220px]">{t('tables.colNote')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selected.fields.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono text-xs">{f.name}</TableCell>
                    <TableCell className="text-xs">{t(`types.${f.type}`, { defaultValue: f.type })}</TableCell>
                    <TableCell>{f.read ? <Yes /> : <No />}</TableCell>
                    <TableCell className="text-xs">{t(`filterLevel.${f.filter}`, { defaultValue: f.filter })}</TableCell>
                    <TableCell>{f.sortable ? <Yes /> : <No />}</TableCell>
                    <TableCell>{f.groupable ? <Yes /> : <No />}</TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {f.freeText ? (
                          <Badge variant="warning" className="gap-1">
                            <Shield size={11} />
                            {t('tables.masked')}
                          </Badge>
                        ) : null}
                        {!f.read ? <Badge variant="secondary">{t('tables.readOnlyFilter')}</Badge> : null}
                        {f.aggregatable ? <Badge variant="secondary">{t('tables.aggregatable')}</Badge> : null}
                        {f.note ? <span>{f.note}</span> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* AC-16 — CHI ten truong, khong bao gio kem gia tri. */}
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-5 space-y-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <EyeOff size={15} className="text-slate-400" />
            {t('tables.excludedTitle', { n: selected.excludedFields.length })}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('tables.excludedHint')}</p>
          {selected.excludedFields.length ? (
            <div className="flex flex-wrap gap-1.5">
              {selected.excludedFields.map((name) => (
                <code
                  key={name}
                  className="rounded-md bg-slate-100 dark:bg-slate-900 px-2 py-1 font-mono text-xs text-slate-600 dark:text-slate-300"
                >
                  {name}
                </code>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('tables.excludedEmpty')}</p>
          )}
        </div>
      </section>
    </div>
  );
}
