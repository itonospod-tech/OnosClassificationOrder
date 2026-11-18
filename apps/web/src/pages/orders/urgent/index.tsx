import React from 'react';
import { useTranslation } from 'react-i18next';
import { Siren } from 'lucide-react';
import { RoleType } from 'shared';

import { FactoryScopeChip } from '@/components/common/FactoryScopeChip';
import { PageHeader } from '@/components/common/PageHeader';

import { usePermission } from '@/hooks/usePermission';

import { UrgentOrdersBoard } from './UrgentOrdersBoard';

/** "Đơn Làm ngay" (Orders.md §17.6) — cùng phạm vi hiển thị với "Nhật ký bù lỗi" (ẩn với Support). */
export default function OrdersUrgentPage() {
  const { t } = useTranslation('orderLog');
  const { roleName } = usePermission();

  if (roleName === RoleType.Support) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        {t('page.noPermission')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Siren size={20} className="text-rose-600" />}
        title={t('urgentPage.title')}
        description={t('urgentPage.subtitle')}
        actions={<FactoryScopeChip />}
      />

      <UrgentOrdersBoard />
    </div>
  );
}
