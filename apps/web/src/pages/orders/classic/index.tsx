import React from 'react';
import { useTranslation } from 'react-i18next';
import { Rows3 } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';

import { usePermission } from '@/hooks/usePermission';

import { OrderTableClassic } from '../OrderTableClassic';

export default function OrdersClassicPage() {
  const { t } = useTranslation('orders');
  const { canViewWorkshopTable } = usePermission();

  if (!canViewWorkshopTable()) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        {t('workshopPage.noPermission')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={<Rows3 size={20} />} title={t('classicPage.title')} description={t('classicPage.subtitle')} />

      <OrderTableClassic />
    </div>
  );
}
