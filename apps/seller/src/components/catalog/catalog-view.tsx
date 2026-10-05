'use client';

/**
 * `/portal/catalog` — danh mục sản phẩm cho seller (SellerPortal.md §2.10).
 *
 * Vì sao có trang này (phản hồi vận hành 08/09/2026): trước đó seller chỉ thấy
 * sản phẩm khi bấm "Đặt đơn mới" TRONG một dịch vụ, nên (1) không có chỗ duyệt
 * toàn bộ danh mục, (2) mở từ trang 3D thì chỉ thấy sản phẩm 3D, (3) **không
 * tra được SKU để điền file CSV import** — đây là thứ chặn seller lên đơn 2D/Gỗ.
 * Trang này mở theo dòng sản phẩm + danh mục + collection, và mỗi sản phẩm tải
 * được danh sách SKU.
 *
 * Mirror `apps/web/src/pages/customer/catalog/index.tsx` (Catalog dành cho khách
 * đã đăng nhập — giá đã áp khuyến mãi theo tier, tuyệt đối không có giá vốn).
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import type { CustomerCatalogFacet, CustomerCatalogItem } from 'shared';
import { CatalogProductCard } from '@/components/orders/catalog-product-card';
import { OrdersPagination } from '@/components/orders/orders-pagination';
import { ProductLineTabs, type ProductLineTabKey } from '@/components/orders/product-line-tabs';
import { Button } from '@/components/shared/button';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { useApi } from '@/hooks/use-api';
import { useUrlState } from '@/hooks/use-url-state';
import type { ApiRes } from '@/lib/customer-orders';
import { useDebounced } from '@/lib/use-debounced';
import { isProductLine } from '@/lib/product-lines';
import { downloadSkuCsv } from './sku-csv';

interface FacetsRes {
  categories: CustomerCatalogFacet[];
  collections: CustomerCatalogFacet[];
  tags: CustomerCatalogFacet[];
  techniques: CustomerCatalogFacet[];
  productLines: Array<{ code: string; count: number }>;
}

const PILL = 'px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap transition-colors';
const PILL_ON = 'bg-accent border-accent text-white';
const PILL_OFF = 'bg-card border-border1 text-text-secondary hover:border-accent/60 hover:text-text-primary';

export function CatalogView() {
  const { t } = useTranslation(['seller', 'customerPortal']);
  const [state, setState] = useUrlState({ line: '', category: '', collection: '', tag: '', technique: '', q: '', page: '1', limit: '24' });
  const line: ProductLineTabKey = isProductLine(state.line) ? state.line : 'all';
  const page = Math.max(1, Number(state.page) || 1);
  const limit = Math.max(1, Number(state.limit) || 24);
  const [searchInput, setSearchInput] = useState(state.q);
  const search = useDebounced(searchInput.trim(), 350);
  useEffect(() => {
    if (search !== state.q) setState({ q: search, page: '1' });
  }, [search, state.q, setState]);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (line !== 'all') p.set('productLine', line);
    if (state.category) p.set('productCategoryId', state.category);
    if (state.collection) p.set('collectionId', state.collection);
    if (state.tag) p.set('productTagId', state.tag);
    if (state.technique) p.set('productTechniqueId', state.technique);
    if (state.q) p.set('search', state.q);
    return p.toString();
  }, [page, limit, line, state.category, state.collection, state.tag, state.technique, state.q]);

  const { data: res, loading } = useApi<ApiRes<CustomerCatalogItem[]>>(`/api/v1/customer/catalog?${query}`);
  const { data: facetsRes } = useApi<ApiRes<FacetsRes>>('/api/v1/customer/catalog/facets');
  const items = res?.data ?? [];
  const total = res?.total ?? 0;
  const facets = facetsRes?.data;
  const lineCounts = useMemo(() => {
    const byLine = Object.fromEntries((facets?.productLines ?? []).map((x) => [x.code, x.count]));
    const all = (facets?.productLines ?? []).reduce((s, x) => s + x.count, 0);
    return { all, ...byLine } as Partial<Record<ProductLineTabKey, number>>;
  }, [facets]);

  // Tải SKU của ĐÚNG bộ lọc đang xem (không chỉ trang hiện tại) — seller dán thẳng vào file CSV import.
  const exportSkus = async () => {
    setExporting(true);
    try {
      await downloadSkuCsv(query, t('catalog.skuFileName', { ns: 'seller' }));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title={t('catalog.title', { ns: 'seller' })}
        subtitle={t('catalog.subtitle', { ns: 'seller' })}
        compact
        actions={
          <Button variant="outline" size="sm" onClick={exportSkus} disabled={exporting || total === 0}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {t('catalog.exportSku', { ns: 'seller' })}
          </Button>
        }
      />

      <ProductLineTabs
        active={line}
        counts={lineCounts}
        onChange={(next) => setState({ line: next === 'all' ? '' : next, category: '', collection: '', page: '1' })}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder={t('catalog.searchPlaceholder', { ns: 'seller' })}
          className="w-full sm:w-64"
        />
        {(facets?.categories ?? []).length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <button type="button" onClick={() => setState({ category: '', page: '1' })} className={`${PILL} ${!state.category ? PILL_ON : PILL_OFF}`}>
              {t('catalog.allCategories', { ns: 'seller' })}
            </button>
            {(facets?.categories ?? []).map((c) => (
              <button key={c._id} type="button" onClick={() => setState({ category: c._id, page: '1' })} className={`${PILL} ${state.category === c._id ? PILL_ON : PILL_OFF}`}>
                {c.name} <span className="opacity-70">{c.count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto text-[10px] text-text-muted tabular-nums whitespace-nowrap">
          {t('catalog.totalProducts', { ns: 'seller', count: total })}
        </div>
      </div>

      {(facets?.collections ?? []).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-text-muted mr-1">{t('catalog.collections', { ns: 'seller' })}</span>
          <button type="button" onClick={() => setState({ collection: '', page: '1' })} className={`${PILL} ${!state.collection ? PILL_ON : PILL_OFF}`}>
            {t('catalog.allCollections', { ns: 'seller' })}
          </button>
          {(facets?.collections ?? []).map((c) => (
            <button key={c._id} type="button" onClick={() => setState({ collection: c._id, page: '1' })} className={`${PILL} ${state.collection === c._id ? PILL_ON : PILL_OFF}`}>
              {c.name} <span className="opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {(facets?.tags ?? []).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-text-muted mr-1">{t('catalog.tags', { ns: 'seller' })}</span>
          <button type="button" onClick={() => setState({ tag: '', page: '1' })} className={`${PILL} ${!state.tag ? PILL_ON : PILL_OFF}`}>
            {t('catalog.allTags', { ns: 'seller' })}
          </button>
          {(facets?.tags ?? []).map((c) => (
            <button key={c._id} type="button" onClick={() => setState({ tag: c._id, page: '1' })} className={`${PILL} ${state.tag === c._id ? PILL_ON : PILL_OFF}`}>
              {c.name} <span className="opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {(facets?.techniques ?? []).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-text-muted mr-1">{t('catalog.techniques', { ns: 'seller' })}</span>
          <button type="button" onClick={() => setState({ technique: '', page: '1' })} className={`${PILL} ${!state.technique ? PILL_ON : PILL_OFF}`}>
            {t('catalog.allTechniques', { ns: 'seller' })}
          </button>
          {(facets?.techniques ?? []).map((c) => (
            <button key={c._id} type="button" onClick={() => setState({ technique: c._id, page: '1' })} className={`${PILL} ${state.technique === c._id ? PILL_ON : PILL_OFF}`}>
              {c.name} <span className="opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 size={18} className="animate-spin text-accent" /></div>
      ) : items.length === 0 ? (
        <EmptyState title={t('catalog.emptyTitle', { ns: 'seller' })} description={t('catalog.emptyDesc', { ns: 'seller' })} />
      ) : (
        <>
          <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 ${loading ? 'opacity-60' : ''}`}>
            {items.map((item) => (
              <CatalogCardLink key={item._id} item={item} />
            ))}
          </div>
          {total > limit && (
            <div className="bg-card border border-border1 rounded-xl">
              <OrdersPagination
                page={page}
                limit={limit}
                pages={Math.max(1, Math.ceil(total / limit))}
                total={total}
                onChange={(n) => setState({ ...(n.page ? { page: String(n.page) } : {}), ...(n.limit ? { limit: String(n.limit), page: '1' } : {}) })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Card catalog dùng chung với màn đặt đơn, bọc Link sang trang chi tiết (nơi có bảng SKU). */
function CatalogCardLink({ item }: { item: CustomerCatalogItem }) {
  return (
    <Link href={`/portal/catalog/${item._id}`} prefetch={false} className="contents">
      <CatalogProductCard item={item} onSelect={() => undefined} />
    </Link>
  );
}
