import React from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_ERROR_CODES } from 'shared';

import { CopyButton } from '@/components/common/CopyButton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { ApiKeyBox } from './ApiKeyBox';
import type { AgentAdminOverview } from './types';
import { CAPABILITIES, ERROR_HTTP } from './types';

interface Props {
  overview: AgentAdminOverview;
  baseUrl: string;
  apiKey?: string;
  onKeyLoaded: (key: string) => void;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
    <span className="w-44 shrink-0 text-sm text-slate-500 dark:text-slate-400">{label}</span>
    <span className="flex min-w-0 items-center gap-2 text-sm text-slate-800 dark:text-slate-100">{children}</span>
  </div>
);

/**
 * Phan A — Bat dau (AC-03, AC-09, AC-10).
 *
 * Tam ma loi lay tu `AGENT_ERROR_CODES` cua `packages/shared`, KHONG chep cung
 * vao FE: do la nguon song, them mot ma o shared la bang nay tu dai ra.
 */
export function StartTab({ overview, baseUrl, apiKey, onKeyLoaded }: Props) {
  const { t } = useTranslation('agentApi');

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-5 space-y-3">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('start.authTitle')}</h3>

        <Row label={t('start.authIntro')}>
          <code className="rounded bg-slate-100 dark:bg-slate-900 px-2 py-1 font-mono text-xs">
            {overview.authHeader}: &lt;key&gt;
          </code>
          <CopyButton value={overview.authHeader} label={overview.authHeader} />
        </Row>
        <Row label={t('start.baseUrl')}>
          <code className="min-w-0 truncate rounded bg-slate-100 dark:bg-slate-900 px-2 py-1 font-mono text-xs">{baseUrl}</code>
          <CopyButton value={baseUrl} label={t('start.baseUrl')} />
        </Row>
        <Row label={t('start.rateLimit')}>{t('start.rateLimitValue', { n: overview.limits.rateLimitPerMin })}</Row>
        <Row label={t('start.maxLimit')}>{overview.limits.maxLimit}</Row>
        <Row label={t('start.readTimeout')}>{overview.limits.readTimeoutMs} ms</Row>
        <Row label={t('start.queryTimeout')}>{overview.limits.queryTimeoutMs} ms</Row>

        <ApiKeyBox
          keyConfigured={overview.keyConfigured}
          keyEnvName={overview.keyEnvName}
          apiKey={apiKey}
          onKeyLoaded={onKeyLoaded}
        />
      </section>

      <section className="rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-5 space-y-3">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('start.capabilitiesTitle')}</h3>
        <div className="space-y-2">
          {CAPABILITIES.map((c) => (
            <div key={c.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="w-12 shrink-0 font-mono text-xs font-semibold text-primary">{c.method}</span>
              <code className="font-mono text-xs text-slate-700 dark:text-slate-200">
                {overview.basePath}
                {c.pattern}
              </code>
              <span className="text-sm text-slate-500 dark:text-slate-400">{t(`capabilities.${c.key}`)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-5 space-y-3">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('start.errorsTitle')}</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-52">{t('start.errorsCode')}</TableHead>
                <TableHead className="w-20">{t('start.errorsHttp')}</TableHead>
                <TableHead>{t('start.errorsMeaning')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.values(AGENT_ERROR_CODES).map((code) => (
                <TableRow key={code}>
                  <TableCell className="font-mono text-xs font-semibold">{code}</TableCell>
                  <TableCell className="text-xs">{ERROR_HTTP[code] ?? '—'}</TableCell>
                  <TableCell className="text-sm text-slate-600 dark:text-slate-300">{t(`errors.${code}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
