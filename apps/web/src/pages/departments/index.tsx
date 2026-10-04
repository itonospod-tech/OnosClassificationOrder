import React from 'react';
import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';

export default function Departments() {
  const { t } = useTranslation('auth');
  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Building2 size={20} />}
        title={t('departments.title')}
        description={t('departments.subtitle')}
      />

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border border-slate-100 dark:border-slate-700/60 text-center">
        <p className="text-slate-500 dark:text-slate-400">{t('departments.comingSoon')}</p>
      </div>
    </div>
  );
}
