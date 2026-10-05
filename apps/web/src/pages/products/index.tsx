import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useProductWriteAccess } from '@/hooks/useProductWriteAccess';

import { CollectionTab } from './CollectionTab';
import { FactoryTab } from './FactoryTab';
import { ProductCategoryTab } from './ProductCategoryTab';
import { ProductConfigActions } from './ProductConfigActions';
import { ProductConfigTab } from './ProductConfigTab';
import { ProductTagTab } from './ProductTagTab';
import { ProductTechniqueTab } from './ProductTechniqueTab';

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
      <PageHeader
        icon={<Package size={20} />}
        title={t('page.title')}
        description={t('page.subtitle')}
        actions={tab === 'config' && canWriteProducts ? <ProductConfigActions onChanged={() => setConfigRefreshKey((k) => k + 1)} /> : undefined}
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="config">{t('page.tabs.config')}</TabsTrigger>
          <TabsTrigger value="category">{t('page.tabs.category')}</TabsTrigger>
          <TabsTrigger value="collection">{t('page.tabs.collection')}</TabsTrigger>
          <TabsTrigger value="tag">{t('page.tabs.tag')}</TabsTrigger>
          <TabsTrigger value="technique">{t('page.tabs.technique')}</TabsTrigger>
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
        <TabsContent value="technique">
          <ProductTechniqueTab />
        </TabsContent>
        <TabsContent value="factory">
          <FactoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
