import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FileDown } from 'lucide-react';

import { PATHS } from '@/constants/paths';

import { PageHeader } from '@/components/common/PageHeader';

import { usePermission } from '@/hooks/usePermission';

import { ImportOrderTab } from '../ImportOrderTab';

export default function OrdersImportPage() {
  const { t } = useTranslation('orders');
  const { has, canViewWorkshopTable } = usePermission();
  const navigate = useNavigate();
  const canImport = has('order.import');

  if (!canImport) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        {t('importPage.noPermission')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={<FileDown size={20} />} title={t('importPage.title')} description={t('importPage.subtitle')} />

      <ImportOrderTab
        onImported={() => {
          navigate(canViewWorkshopTable() ? PATHS.ORDERS_WORKSHOP : PATHS.ORDERS_ERROR_LOG);
        }}
      />
    </div>
  );
}
