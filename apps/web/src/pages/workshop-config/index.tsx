import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Building2 } from 'lucide-react';
import { WORKSHOP_CONFIG_MODE, WorkshopConfigCategory } from 'shared';

import { PageHeader } from '@/components/common/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { CategoryEditor } from './CategoryEditor';

const buildTabs = (
  t: TFunction<'workshopConfig'>,
): { key: WorkshopConfigCategory; label: string; description: string }[] => [
  {
    key: WorkshopConfigCategory.PrintStatus,
    label: t('page.tabs.printStatus.label'),
    description: t('page.tabs.printStatus.description'),
  },
  {
    key: WorkshopConfigCategory.PrintStatusNote,
    label: t('page.tabs.printStatusNote.label'),
    description: t('page.tabs.printStatusNote.description'),
  },
  {
    key: WorkshopConfigCategory.ToolResult,
    label: t('page.tabs.toolResult.label'),
    description: t('page.tabs.toolResult.description'),
  },
  {
    key: WorkshopConfigCategory.ToolResultNote,
    label: t('page.tabs.toolResultNote.label'),
    description: t('page.tabs.toolResultNote.description'),
  },
  {
    key: WorkshopConfigCategory.ErrorFileType,
    label: t('page.tabs.errorFileType.label'),
    description: t('page.tabs.errorFileType.description'),
  },
  {
    key: WorkshopConfigCategory.AssigneeNote,
    label: t('page.tabs.assigneeNote.label'),
    description: t('page.tabs.assigneeNote.description'),
  },
  {
    key: WorkshopConfigCategory.FabricType,
    label: t('page.tabs.fabricType.label'),
    description: t('page.tabs.fabricType.description'),
  },
  {
    key: WorkshopConfigCategory.Machine,
    label: t('page.tabs.machine.label'),
    description: t('page.tabs.machine.description'),
  },
  {
    key: WorkshopConfigCategory.ProductionError,
    label: t('page.tabs.productionError.label'),
    description: t('page.tabs.productionError.description'),
  },
  {
    key: WorkshopConfigCategory.PrintMethod,
    label: t('page.tabs.printMethod.label'),
    description: t('page.tabs.printMethod.description'),
  },
];

export default function WorkshopConfigPage() {
  const { t } = useTranslation('workshopConfig');
  const TABS = useMemo(() => buildTabs(t), [t]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Building2 size={20} />}
        title={t('page.title')}
        description={t('page.subtitle')}
      />

      <Tabs defaultValue={TABS[0].key} className="w-full">
        <TabsList className="flex-wrap h-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className="space-y-3">
            <p className="text-xs text-muted-foreground">{tab.description}</p>
            <CategoryEditor category={tab.key} mode={WORKSHOP_CONFIG_MODE[tab.key]} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
