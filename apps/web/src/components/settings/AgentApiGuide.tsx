import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';

import { RepositoryRemote } from '@/services';
import { apiOrigin } from '@/services/agentApi';

import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { DocsTab } from './agent-api/DocsTab';
import { StartTab } from './agent-api/StartTab';
import { TablesTab } from './agent-api/TablesTab';
import { TryTab } from './agent-api/TryTab';
import type { AgentAdminOverview, OverviewState } from './agent-api/types';

/**
 * Trang huong dan Agent API (`API-3`) — muc `/adm/settings/agent-api`, CHI
 * SuperAdmin/Admin. Xem `documents/FunctionDescription/AgentApiGuide.md`.
 *
 * Bon phan A/B/C/D theo thiet ke `.devtasks/ui/API-3.md`. Trang CHI DOC: khong
 * co thao tac nao ghi du lieu nghiep vu (BR-1).
 *
 * Nap du lieu co chu dich (SRS §4, han muc 60 lan/phut dung chung voi agent
 * that): mount chi goi `overview`; danh muc tai lieu doi den khi mo tab C;
 * khoa doi den khi nguoi xem bam hien HOAC bam Chay.
 *
 * KHOA API chi nam trong state cua component nay — khong localStorage, khong
 * sessionStorage, khong URL, khong console (BR-3, AC-10).
 */
export default function AgentApiGuide() {
  const { t } = useTranslation('agentApi');
  const [state, setState] = useState<OverviewState>({ status: 'loading' });
  const [tab, setTab] = useState('start');
  const [presetTable, setPresetTable] = useState<string | undefined>();
  const [apiKey, setApiKey] = useState<string | undefined>();

  /** Giu khoa ngoai React state de `ensureKey` khong phu thuoc lan render. */
  const keyRef = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await RepositoryRemote.agentApi.overview();
      setState({ status: 'ok', data: res.data?.data as AgentAdminOverview });
    } catch {
      // Khong toast: khoi loi ngay tren trang co nut Thu lai, ro hon mot toast troi qua.
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Lay khoa khi CAN DUNG (goi thu, tai danh muc tai lieu) — khac han voi
   * "hien khoa" cho nguoi xem. Hai viec nay doc lap: chay duoc mot loi goi
   * KHONG lam khoa hien ra man hinh (AC-10).
   */
  const ensureKey = useCallback(async (): Promise<string> => {
    if (keyRef.current !== undefined) return keyRef.current;
    try {
      const res = await RepositoryRemote.agentApi.revealKey();
      const value = (res.data?.data?.key || '') as string;
      keyRef.current = value;
      setApiKey(value);
      return value;
    } catch {
      keyRef.current = '';
      return '';
    }
  }, []);

  const handleKeyLoaded = useCallback((value: string) => {
    keyRef.current = value;
    setApiKey(value);
  }, []);

  const handleTryTable = useCallback((table: string) => {
    setPresetTable(table);
    setTab('try');
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-12 text-slate-500 dark:text-slate-400">
        <Spinner size={20} />
        {t('common.loading')}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-2xl border border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-10 text-center space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('common.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  const overview = state.data;
  const baseUrl = `${apiOrigin()}${overview.basePath}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Bot size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('title')}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
          </div>
        </div>
        <Badge variant={overview.keyConfigured ? 'success' : 'warning'}>
          {overview.keyConfigured ? t('status.active') : t('status.notConfigured')}
        </Badge>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="start">{t('tabs.start')}</TabsTrigger>
          <TabsTrigger value="tables">{t('tabs.tables')}</TabsTrigger>
          <TabsTrigger value="docs">{t('tabs.docs')}</TabsTrigger>
          <TabsTrigger value="try">{t('tabs.try')}</TabsTrigger>
        </TabsList>

        <TabsContent value="start" className="mt-4">
          <StartTab overview={overview} baseUrl={baseUrl} apiKey={apiKey} onKeyLoaded={handleKeyLoaded} />
        </TabsContent>

        <TabsContent value="tables" className="mt-4">
          <TablesTab overview={overview} onTryTable={handleTryTable} />
        </TabsContent>

        {/* Lazy that su: chi mount (va goi API) khi tab dang mo. */}
        <TabsContent value="docs" className="mt-4">
          {tab === 'docs' ? (
            <DocsTab basePath={overview.basePath} authHeader={overview.authHeader} ensureKey={ensureKey} />
          ) : null}
        </TabsContent>

        <TabsContent value="try" className="mt-4">
          {tab === 'try' ? <TryTab overview={overview} presetTable={presetTable} ensureKey={ensureKey} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
