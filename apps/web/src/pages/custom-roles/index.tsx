import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldHalf } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';

export default function CustomRoles() {
  const { t } = useTranslation('auth');
  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ShieldHalf size={20} />}
        title={t('customRoles.title')}
        description={t('customRoles.subtitle')}
      />

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border border-slate-100 dark:border-slate-700/60 text-center">
        <p className="text-slate-500 dark:text-slate-400">{t('customRoles.comingSoon')}</p>
      </div>
    </div>
  );
}
