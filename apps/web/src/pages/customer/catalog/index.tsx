import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ImageIcon, PackageSearch, Search, X } from 'lucide-react';
import type { CustomerCatalogFacet, CustomerCatalogItem } from 'shared';

import { PATHS } from '@/constants/paths';

import { RepositoryRemote } from '@/services';

import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import { CatalogProductCard } from '@/components/customer/CatalogProductCard';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useDebounce } from '@/hooks/useDebounce';

interface CatalogFacets {
  categories: CustomerCatalogFacet[];
  collections: CustomerCatalogFacet[];
  tags: CustomerCatalogFacet[];
}

function CustomerCatalog() {
  const { t } = useTranslation('customerPortal');
  const navigate = useNavigate();
  const [items, setItems] = useState<CustomerCatalogItem[]>([]);
  const [facets, setFacets] = useState<CatalogFacets>({ categories: [], collections: [], tags: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [total, setTotal] = useState(0);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    (async () => {
      try {
        const res = await RepositoryRemote.customerCatalog.getCatalogFacets();
        setFacets(res?.data?.data ?? { categories: [], collections: [], tags: [] });
      } catch (error) {
        handleAxiosError(error);
      }
    })();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (categoryId) params.set('productCategoryId', categoryId);
      if (collectionId) params.set('collectionId', collectionId);
      if (tagId) params.set('productTagId', tagId);
      const res = await RepositoryRemote.customerCatalog.getCatalog(`?${params.toString()}`);
      setItems(res?.data?.data ?? []);
      setTotal(res?.data?.total ?? 0);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, debouncedSearch, categoryId, collectionId, tagId]);

  // Đổi search/filter → luôn quay về trang 1 (bỏ qua lần render đầu, tránh ghi đè page đọc từ URL nếu có).
  const isFirstRender = React.useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setPage(1);
  }, [debouncedSearch, categoryId, collectionId, tagId]);

  const activeCollection = useMemo(
    () => facets.collections.find((c) => c._id === collectionId),
    [facets.collections, collectionId],
  );
  const activeCategory = useMemo(
    () => facets.categories.find((c) => c._id === categoryId),
    [facets.categories, categoryId],
  );
  const hasActiveFilter = Boolean(categoryId || collectionId || tagId || search);

  const clearFilters = () => {
    setSearch('');
    setCategoryId(null);
    setCollectionId(null);
    setPage(1);
  };

  return (
    <div>
      {/* ── Header: tiêu đề + search ─────────────────────── */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">{t('catalog.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('catalog.subtitle')}</p>
        </div>
        <div className="relative w-full sm:w-auto">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('catalog.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-9 pr-8 sm:w-72"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              aria-label={t('catalog.clearSearch')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Bộ sưu tập: hàng card cuộn ngang, click = lọc ── */}
      {facets.collections.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t('catalog.collectionsTitle')}
          </p>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
            {facets.collections.map((col) => {
              const active = col._id === collectionId;
              return (
                <button
                  key={col._id}
                  type="button"
                  onClick={() => setCollectionId(active ? null : col._id)}
                  className={cn(
                    'group shrink-0 w-36 text-left rounded-xl border overflow-hidden bg-card transition-all',
                    active
                      ? 'border-primary ring-1 ring-primary shadow-sm'
                      : 'border-border hover:border-primary/50 hover:shadow-sm',
                  )}
                >
                  <div className="h-20 bg-muted flex items-center justify-center overflow-hidden">
                    {col.image ? (
                      <img
                        src={col.image}
                        alt={col.name}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                        <ImageIcon size={20} className="text-primary/50" />
                      </div>
                    )}
                  </div>
                  <div className="px-2.5 py-2">
                    <p className={cn('text-xs font-medium truncate', active ? 'text-primary' : 'text-foreground')}>
                      {col.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t('catalog.resultsCount', { count: col.count })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Danh mục: pill bar cuộn ngang ────────────────── */}
      {facets.categories.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setCategoryId(null)}
            className={cn(
              'shrink-0 h-8 px-3.5 rounded-full border text-xs font-medium transition-colors',
              !categoryId
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-input text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t('catalog.allCategories')}
          </button>
          {facets.categories.map((cat) => {
            const active = cat._id === categoryId;
            return (
              <button
                key={cat._id}
                type="button"
                onClick={() => setCategoryId(active ? null : cat._id)}
                className={cn(
                  'shrink-0 h-8 px-3.5 rounded-full border text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-input text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {cat.name}
                <span className={cn('ml-1 text-[10px]', active ? 'text-primary-foreground/80' : 'opacity-60')}>
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Tags: pill bar, click = filter ── */}
      {facets.tags.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
          <span className="shrink-0 self-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mr-1">
            {t('catalog.tagsTitle')}
          </span>
          {facets.tags.map((tag) => {
            const active = tag._id === tagId;
            return (
              <button
                key={tag._id}
                type="button"
                aria-pressed={active}
                onClick={() => setTagId(active ? null : tag._id)}
                className={cn(
                  'shrink-0 h-8 px-3.5 rounded-full border text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-input text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {tag.name}
                <span className={cn('ml-1 text-[10px]', active ? 'text-primary-foreground/80' : 'opacity-60')}>
                  {tag.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Kết quả + filter đang áp ─────────────────────── */}
      {!loading && (
        <div className="flex items-center gap-2 flex-wrap mb-3 min-h-5">
          <p className="text-xs text-muted-foreground">{t('catalog.resultsCount', { count: total })}</p>
          {activeCategory && (
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
              {activeCategory.name}
              <button type="button" onClick={() => setCategoryId(null)} aria-label={t('catalog.clearFilters')}>
                <X size={11} />
              </button>
            </span>
          )}
          {activeCollection && (
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
              {activeCollection.name}
              <button type="button" onClick={() => setCollectionId(null)} aria-label={t('catalog.clearFilters')}>
                <X size={11} />
              </button>
            </span>
          )}
          {hasActiveFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] text-muted-foreground underline hover:text-foreground"
            >
              {t('catalog.clearFilters')}
            </button>
          )}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <PackageSearch size={32} className="mb-3" />
          <p className="text-sm">{t('catalog.empty')}</p>
          {hasActiveFilter && (
            <button type="button" onClick={clearFilters} className="text-xs text-primary underline mt-2">
              {t('catalog.clearFilters')}
            </button>
          )}
        </div>
      ) : (
        <LoadingOverlay active={loading} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <CatalogProductCard
              key={item._id}
              item={item}
              onSelect={() => navigate(PATHS.CUSTOMER_CATALOG_DETAIL.replace(':id', item._id))}
            />
          ))}
        </LoadingOverlay>
      )}

      {items.length > 0 && (
        <div className="mt-4">
          <PaginationBar
            position="bottom"
            page={page}
            pageSize={pageSize}
            total={total}
            loading={loading}
            onChange={(p, ps) => {
              setPage(p);
              setPageSize(ps);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default CustomerCatalog;
