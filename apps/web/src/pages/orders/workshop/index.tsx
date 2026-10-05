import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PRODUCT_LINE_WINDOW_DAYS } from 'shared';

import { usePageHeader } from '@/hooks/usePageHeader';
import { usePermission } from '@/hooks/usePermission';

import { OrderTableWorkshop } from '../OrderTableWorkshop';

export default function OrdersWorkshopPage() {
  const { t } = useTranslation(['orders', 'products']);
  const { canViewWorkshopTable } = usePermission();
  // A product-line view (sidebar "Production" › 3D…) names its line in the header, so the
  // user can tell it apart from "All orders" — the table itself looks the same.
  const [searchParams] = useSearchParams();
  const productLine = searchParams.get('productLine');
  // Tiêu đề dời lên Header (07/09/2026) — nhường chiều cao cho phễu + bảng.
  usePageHeader(
    productLine
      ? t('workshopPage.lineTitle', { line: t(`products:productLines.${productLine}`, { defaultValue: productLine }) })
      : t('workshopPage.title'),
    productLine ? t('workshopPage.lineSubtitle', { days: PRODUCT_LINE_WINDOW_DAYS }) : t('workshopPage.subtitle'),
  );

  if (!canViewWorkshopTable()) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        {t('workshopPage.noPermission')}
      </div>
    );
  }

  return (
    // Chiếm đủ chiều cao còn lại của <main> — bảng tự cuộn, chân bảng đứng yên (Orders.md §10.2c).
    <div className="flex min-h-0 flex-1 flex-col">
      <OrderTableWorkshop />
    </div>
  );
}
