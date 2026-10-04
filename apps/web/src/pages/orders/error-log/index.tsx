import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { RoleType } from 'shared';

import { PageHeader } from '@/components/common/PageHeader';

import { usePermission } from '@/hooks/usePermission';

import { ErrorLogTab } from '../ErrorLogTab';

export default function OrdersErrorLogPage() {
  const { t } = useTranslation('orderLog');
  const { roleName } = usePermission();
  // Support tạm ẩn tab "Nhật ký bù lỗi" — lỗi soát-tool không còn hiển thị ở đây.
  const visible = roleName !== RoleType.Support;

  if (!visible) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        {t('page.noPermission')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={<AlertTriangle size={20} />} title={t('page.title')} description={t('page.pageSubtitle')} />

      <ErrorLogTab />
    </div>
  );
}
