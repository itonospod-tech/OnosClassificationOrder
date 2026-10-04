import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useProductWriteAccess } from '@/hooks/useProductWriteAccess';

import { CollectionTab } from './CollectionTab';
import { ProductTagTab } from './ProductTagTab';
import { FactoryTab } from './FactoryTab';
import { ProductCategoryTab } from './ProductCategoryTab';
import { ProductConfigActions } from './ProductConfigActions';
import { ProductConfigTab } from './ProductConfigTab';

export default function Products() {
  const { t } = useTranslation('products');
  const [tab, setTab] = useState('config');
  /**
   * Khu hành động của tab "Cấu hình sản phẩm" nằm NGOÀI tab (cạnh tiêu đề, PRD-1)
   * nên phải báo ngược vào tab khi import/crawl đổi dữ liệu — tab tải lại danh sách.
   */
  const [configRefreshKey, setConfigRefreshKey] = useState(0);
  // AUTH-6 - 7 nut cong cu deu la thao tac GHI (import, crawl, backfill, xoa...),
  // an het voi vai chi doc thay vi de bam roi an 403.
  const { canWriteProducts } = useProductWriteAccess();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
            <Package size={20} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('page.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('page.subtitle')}</p>
          </div>
        </div>
        {tab === 'config' && canWriteProducts && (
          <ProductConfigActions onChanged={() => setConfigRefreshKey((k) => k + 1)} />
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="config">{t('page.tabs.config')}</TabsTrigger>
          <TabsTrigger value="category">{t('page.tabs.category')}</TabsTrigger>
          <TabsTrigger value="collection">{t('page.tabs.collection')}</TabsTrigger>
          <TabsTrigger value="tag">{t('page.tabs.tag')}</TabsTrigger>
          <TabsTrigger value="factory">{t('page.tabs.factory')}</TabsTrigger>
        </TabsList>
        <TabsContent value="config">
          <ProductConfigTab refreshKey={configRefreshKey} />
        </TabsContent>
        <TabsContent value="category">
          <ProductCategoryTab />
        </TabsContent>
        <TabsContent value="collection">
          <CollectionTab />
        </TabsContent>
        <TabsContent value="tag">
          <ProductTagTab />
        </TabsContent>
        <TabsContent value="factory">
          <FactoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
