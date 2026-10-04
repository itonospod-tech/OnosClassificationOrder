import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Scissors } from 'lucide-react';

import { PATHS } from '@/constants/paths';

import { PageHeader } from '@/components/common/PageHeader';

import { usePermission } from '@/hooks/usePermission';

import { ImportCuttingFilesTab } from '../ImportCuttingFilesTab';

export default function OrdersCuttingFilesPage() {
  const { t } = useTranslation('orders');
  const { has, canViewWorkshopTable } = usePermission();
  const navigate = useNavigate();
  const canImport = has('order.import');

  if (!canImport) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        {t('cuttingFilesPage.noPermission')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={<Scissors size={20} />} title={t('cuttingFilesPage.title')} description={t('cuttingFilesPage.subtitle')} />

      <ImportCuttingFilesTab
        onApplied={() => {
          navigate(canViewWorkshopTable() ? PATHS.ORDERS_WORKSHOP : PATHS.ORDERS_ERROR_LOG);
        }}
      />
    </div>
  );
}
