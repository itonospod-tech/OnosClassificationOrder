import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderX } from 'lucide-react';
import { AGENT_ERROR_CODES, type AgentDoc, type AgentDocSummary } from 'shared';

import { agentUrl, callAgent } from '@/services/agentApi';

import { CopyButton } from '@/components/common/CopyButton';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';

import { cn } from '@/utils/cn';

interface Props {
  basePath: string;
  authHeader: string;
  /** Chua lay khoa thi lay ho — nguoi xem KHONG phai bam "Hien khoa" truoc. */
  ensureKey: () => Promise<string>;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message?: string }
  | { status: 'ok'; items: AgentDocSummary[] };

/**
 * Phan C — Tai lieu (AC-06, AC-11, AC-15).
 *
 * Goi LAZY: chi tai danh muc khi nguoi xem mo tab nay lan dau. Han muc 60
 * lan/phut la tai nguyen dung chung voi agent that, khong tieu vao viec mo
 * trang.
 *
 * Markdown hien THO trong khoi monospace, khong render HTML — repo khong co
 * thu vien render markdown va AC-06 chi doi "xem duoc noi dung markdown".
 */
export function DocsTab({ basePath, authHeader, ensureKey }: Props) {
  const { t } = useTranslation('agentApi');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [selected, setSelected] = useState<AgentDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const loadCatalog = async () => {
    setState({ status: 'loading' });
    const key = await ensureKey();
    const res = await callAgent({
      method: 'GET',
      url: agentUrl(basePath, '/docs'),
      apiKey: key,
      authHeader,
    });

    if (res.ok) {
      try {
        const parsed = JSON.parse(res.bodyText) as { data?: AgentDocSummary[] };
        setState({ status: 'ok', items: parsed.data || [] });
      } catch {
        setState({ status: 'error' });
      }
      return;
    }
    if (res.errorCode === AGENT_ERROR_CODES.docsUnavailable) {
      setState({ status: 'unavailable' });
      return;
    }
    setState({ status: 'error', message: res.errorMessage });
  };

  useEffect(() => {
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDoc = async (slug: string) => {
    setLoadingDoc(true);
    setSelected(null);
    const key = await ensureKey();
    const res = await callAgent({
      method: 'GET',
      url: agentUrl(basePath, `/docs/${encodeURIComponent(slug)}`),
      apiKey: key,
      authHeader,
    });
    if (res.ok) {
      try {
        const parsed = JSON.parse(res.bodyText) as { data?: AgentDoc };
        if (parsed.data) setSelected(parsed.data);
      } catch {
        /* giu selected = null, khung phai hien loi chung */
      }
    }
    setLoadingDoc(false);
  };

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-10 text-slate-500 dark:text-slate-400">
        <Spinner size={18} />
        {t('common.loading')}
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-6 space-y-3">
        <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
          <FolderX size={18} className="mt-0.5 shrink-0" />
          {t('docs.unavailable')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void loadCatalog()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-6 space-y-3 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">{state.message || t('docs.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void loadCatalog()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const sections = Array.from(new Set(state.items.map((d) => d.section)));

  return (
    <div className="flex flex-col xl:flex-row items-start gap-4">
      <aside className="w-full xl:w-80 shrink-0 space-y-3">
        <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {t('docs.listTitle', { n: state.items.length })}
        </p>
        {state.items.length === 0 ? (
          <p className="px-2 text-sm text-slate-500 dark:text-slate-400">{t('docs.empty')}</p>
        ) : (
          sections.map((section) => (
            <div key={section} className="space-y-1">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{section}</p>
              {state.items
                .filter((d) => d.section === section)
                .map((d) => (
                  <button
                    key={d.slug}
                    type="button"
                    onClick={() => void openDoc(d.slug)}
                    className={cn(
                      'w-full rounded-lg px-3 py-2 text-left transition-colors',
                      selected?.slug === d.slug
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200',
                    )}
                  >
                    <span className="block text-sm font-medium">{d.title}</span>
                    <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400">{d.slug}</span>
                    <span className="block text-[11px] text-slate-400">
                      {t('docs.lines', { n: d.lines })} · {d.sizeKb} KB
                    </span>
                  </button>
                ))}
            </div>
          ))
        )}
      </aside>

      <section className="min-w-0 flex-1 rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-5">
        {loadingDoc ? (
          <div className="flex items-center justify-center gap-3 py-10 text-slate-500 dark:text-slate-400">
            <Spinner size={18} />
            {t('common.loading')}
          </div>
        ) : selected ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{selected.title}</h3>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{selected.slug}</p>
              </div>
              <CopyButton value={selected.markdown} label={selected.slug} />
            </div>
            <pre className="max-h-[60vh] overflow-auto rounded-xl bg-slate-50 dark:bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
              {selected.markdown}
            </pre>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">{t('docs.pickOne')}</p>
        )}
      </section>
    </div>
  );
}
