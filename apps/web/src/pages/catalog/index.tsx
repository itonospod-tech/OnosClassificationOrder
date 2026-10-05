import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import type { CustomerCatalogFacet, CustomerCatalogItem } from 'shared';

import { PATHS } from '@/constants/paths';

import { RepositoryRemote } from '@/services';

import { PaginationBar } from '@/components/common/PaginationBar';
import { Spinner } from '@/components/common/Spinner';
import BackToTop from '@/components/public/BackToTop';
import PillLink from '@/components/public/PillLink';
import PublicFooter from '@/components/public/PublicFooter';
import PublicHeader from '@/components/public/PublicHeader';
import PublicProductCard from '@/components/public/PublicProductCard';
import Reveal from '@/components/public/Reveal';
import SectionHeading from '@/components/public/SectionHeading';
import { Button } from '@/components/ui/button';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

/**
 * Bội số của 3 để lưới 3 cột không bị hụt ô ở hàng cuối. Bộ này cũng được
 * truyền thẳng vào `PaginationBar` — nếu để mặc định [10,20,50,100] thì
 * `<select>` không có option nào khớp `pageSize` và trình duyệt hiển thị nhầm
 * option đầu tiên ("10/page") dù đang lấy 24 sản phẩm.
 */
const PAGE_SIZE_OPTIONS = [12, 24, 48];
const DEFAULT_PAGE_SIZE = 24;

/**
 * Chip lọc nhanh — thực chất là phím tắt cho ô tìm kiếm, KHÔNG phải thuộc tính
 * của sản phẩm. Dữ liệu thật gần như chỉ có `fullName`, nên đây là cách duy nhất
 * cho khách thu hẹp 151 sản phẩm mà không bịa ra danh mục không tồn tại.
 *
 * Từ khoá để nguyên tiếng Anh vì phải khớp với tên sản phẩm trong DB (vốn là
 * tiếng Anh); mỗi từ đã được đối chiếu là có kết quả thật.
 */
const QUICK_FILTERS = [
  'All-Over Print',
  'Jersey',
  'Shirt',
  'Polo',
  'Hoodie',
  'Shorts',
  'Pajama',
  'Hawaiian',
  'Baseball',
  'Embroidered',
];

/**
 * Catalog CÔNG KHAI (`/catalog`) — không gate auth, gọi `GET /v1/public/catalog`.
 *
 * Khác `pages/customer/catalog/` (sau đăng nhập): ở đây chỉ có giá niêm yết,
 * không có giá ưu đãi theo tier, và CTA dẫn tới đăng ký thay vì form đặt đơn.
 */
function PublicCatalog() {
  const { t } = useTranslation('catalog');
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const search = searchParams.get('q') ?? '';
  const requestedSize = Number(searchParams.get('size'));
  const pageSize = PAGE_SIZE_OPTIONS.includes(requestedSize) ? requestedSize : DEFAULT_PAGE_SIZE;

  const [searchInput, setSearchInput] = useState(search);
  const [items, setItems] = useState<CustomerCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tags, setTags] = useState<CustomerCatalogFacet[]>([]);
  const [techniques, setTechniques] = useState<CustomerCatalogFacet[]>([]);
  const tagId = searchParams.get('tag') ?? '';
  const techniqueId = searchParams.get('technique') ?? '';

  // Giữ tham chiếu để đổi 1 tham số mà không mất tham số còn lại trên URL.
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParamsRef.current);
      Object.entries(patch).forEach(([key, value]) => {
        if (value) next.set(key, value);
        else next.delete(key);
      });
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  const fetchCatalog = useCallback(async () => {
    try {
      setLoading(true);
      setFailed(false);
      const query = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (search) query.set('search', search);
      if (tagId) query.set('productTagId', tagId);
      if (techniqueId) query.set('productTechniqueId', techniqueId);
      const res = await RepositoryRemote.publicCatalog.getCatalog(`?${query.toString()}`);
      setItems(res?.data?.data ?? []);
      setTotal(res?.data?.total ?? 0);
    } catch (error) {
      setItems([]);
      setTotal(0);
      setFailed(true);
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  }, [page, search, pageSize, tagId, techniqueId]);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // Tag chips are optional decoration: a failed facets call just hides them.
  useEffect(() => {
    RepositoryRemote.publicCatalog
      .getFacets()
      .then((res) => {
        setTags(res?.data?.data?.tags ?? []);
        setTechniques(res?.data?.data?.techniques ?? []);
      })
      .catch(() => {
        setTags([]);
        setTechniques([]);
      });
  }, []);

  // Gõ xong mới gọi API (debounce) và luôn quay về trang 1 khi đổi từ khoá.
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => setParam({ q: searchInput || null, page: null }), 400);
    return () => clearTimeout(timer);
  }, [searchInput, search, setParam]);

  const detailPath = useCallback((id: string) => PATHS.CATALOG_DETAIL.replace(':id', id), []);

  const chipClass = (active: boolean) =>
    cn(
      'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
      active
        ? 'border-brand-600 bg-brand-600 text-white'
        : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700',
    );

  return (
    <div className="flex min-h-screen flex-col bg-white text-[#0f110f] antialiased">
      <PublicHeader />

      <main className="flex-1">
        <section className="border-b border-slate-100 bg-slate-50/70">
          <div className="mx-auto max-w-6xl px-4 py-14 lg:py-16">
            <SectionHeading
              eyebrow={t('meta.eyebrow')}
              lead={t('meta.titleLead')}
              accent={t('meta.titleAccent')}
              subtitle={t('meta.subtitle')}
            />

            <Reveal delay={120}>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1 sm:max-w-md">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder={t('search.placeholder')}
                    aria-label={t('search.placeholder')}
                    className="h-12 w-full rounded-full border border-slate-200 bg-white pl-10 pr-10 text-sm text-[#0f110f] outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                  {searchInput && (
                    <button
                      type="button"
                      onClick={() => setSearchInput('')}
                      aria-label={t('search.clear')}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-[#0f110f]"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                {!loading && !failed && <p className="text-sm text-slate-500">{t('result.count', { count: total })}</p>}
              </div>
            </Reveal>

            <Reveal delay={180}>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-400">
                  {t('filters.label')}
                </span>

                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  aria-pressed={!search}
                  className={chipClass(!search)}
                >
                  {t('filters.all')}
                </button>

                {QUICK_FILTERS.map((keyword) => (
                  <button
                    key={keyword}
                    type="button"
                    onClick={() => setSearchInput(keyword)}
                    aria-pressed={search === keyword}
                    className={chipClass(search === keyword)}
                  >
                    {keyword}
                  </button>
                ))}
              </div>
              {techniques.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-400">
                    {t('filters.techniques')}
                  </span>
                  {techniques.map((tech) => (
                    <button
                      key={tech._id}
                      type="button"
                      onClick={() => setParam({ technique: techniqueId === tech._id ? null : tech._id, page: null })}
                      aria-pressed={techniqueId === tech._id}
                      className={chipClass(techniqueId === tech._id)}
                    >
                      {tech.name}
                    </button>
                  ))}
                </div>
              )}
              {tags.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-400">
                    {t('filters.tags')}
                  </span>
                  {tags.map((tag) => (
                    <button
                      key={tag._id}
                      type="button"
                      onClick={() => setParam({ tag: tagId === tag._id ? null : tag._id, page: null })}
                      aria-pressed={tagId === tag._id}
                      className={chipClass(tagId === tag._id)}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </Reveal>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 lg:py-16">
          {loading ? (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          ) : failed ? (
            <div className="py-20 text-center">
              <p className="text-sm text-slate-600">{t('result.error')}</p>
              <Button variant="outline" className="mt-4" onClick={fetchCatalog}>
                {t('result.retry')}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-20 text-center">
              <p className="font-display text-lg font-medium text-[#0f110f]">{t('result.empty')}</p>
              <p className="mt-2 text-sm text-slate-500">{t('result.emptyHint')}</p>
            </div>
          ) : (
            <>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item, index) => (
                  <Reveal key={item._id} delay={(index % 3) * 70}>
                    <li className="h-full">
                      <PublicProductCard item={item} to={detailPath(item._id)} className="h-full" />
                    </li>
                  </Reveal>
                ))}
              </ul>

              <div className="mt-10">
                <PaginationBar
                  position="top"
                  page={page}
                  pageSize={pageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  total={total}
                  loading={loading}
                  onChange={(nextPage, nextSize) => {
                    setParam({
                      page: nextPage > 1 ? String(nextPage) : null,
                      size: nextSize === DEFAULT_PAGE_SIZE ? null : String(nextSize),
                    });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </div>
            </>
          )}
        </section>

        <section className="bg-ink-900">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center">
            <Reveal>
              <h2 className="font-display text-2xl font-medium text-white lg:text-3xl">{t('cta.title')}</h2>
              <p className="mx-auto mt-4 max-w-xl text-sm text-white/65">{t('cta.subtitle')}</p>
              <div className="mt-7 flex justify-center">
                <PillLink to={PATHS.CUSTOMER_REGISTER}>{t('cta.action')}</PillLink>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <PublicFooter />
      <BackToTop />
    </div>
  );
}

export default PublicCatalog;
