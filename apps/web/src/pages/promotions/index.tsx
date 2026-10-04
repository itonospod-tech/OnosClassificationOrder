import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import type { Promotion } from 'shared';
import { Status } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { useConfirm } from '@/components/common/ConfirmDialog';
import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PageHeader } from '@/components/common/PageHeader';
import { PaginationBar } from '@/components/common/PaginationBar';
import { ResponsiveList } from '@/components/common/ResponsiveList';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';

import { PromotionEditDialog } from './PromotionEditDialog';

export interface ProductConfigOption {
  _id: string;
  fullName: string;
  shortName: string;
}

export interface ProductCategoryOption {
  _id: string;
  name: string;
  shortName: string;
}

interface Stats {
  total: number;
  active: number;
  expiringSoon: number;
  byTier: Record<string, number>;
}

const buildScopeLabel = (t: (key: string) => string): Record<string, string> => ({
  all: t('scope.all'),
  category: t('scope.category'),
  product: t('scope.product'),
});

function formatDiscount(p: Promotion): string {
  return p.discountType === 'percentage' ? `${p.discountValue}%` : `${p.discountValue.toLocaleString('vi-VN')}đ`;
}

export default function PromotionsPage() {
  const { t } = useTranslation(['promotion', 'common']);
  const { confirm, confirmDialog } = useConfirm();
  const SCOPE_LABEL = buildScopeLabel(t);
  const [items, setItems] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [productOptions, setProductOptions] = useState<ProductConfigOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<ProductCategoryOption[]>([]);
  const [editItem, setEditItem] = useState<Promotion | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (search) params.set('search', search);
      const resp = await RepositoryRemote.promotion.getPromotions(`?${params.toString()}`);
      setItems(resp.data.data || []);
      setTotal(resp.data.total || 0);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const resp = await RepositoryRemote.promotion.getStats();
      setStats(resp.data.data);
    } catch (error) {
      handleAxiosError(error);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [pResp, cResp] = await Promise.all([
          RepositoryRemote.productConfig.getProductConfigs('?page=1&limit=500'),
          RepositoryRemote.productCategory.getProductCategories('?page=1&limit=200'),
        ]);
        setProductOptions((pResp.data.data || []) as ProductConfigOption[]);
        setCategoryOptions((cResp.data.data || []) as ProductCategoryOption[]);
      } catch (error) {
        handleAxiosError(error);
      }
    })();
  }, []);

  useEffect(() => {
    fetchData();
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const handleSearch = () => {
    if (page !== 1) setPage(1);
    else fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: t('page.deleteConfirm'), destructive: true }))) return;
    try {
      await RepositoryRemote.promotion.deletePromotion(id);
      toast.success(t('page.deleteSuccess'));
      fetchData();
      fetchStats();
    } catch (error) {
      handleAxiosError(error);
    }
  };

  const openCreate = () => {
    setEditItem(null);
    setDialogOpen(true);
  };
  const openEdit = (p: Promotion) => {
    setEditItem(p);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      <PageHeader icon={<Tag size={20} />} title={t('page.title')} description={t('page.subtitle')} />

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{t('page.stats.total')}</p>
            <p className="text-xl font-semibold">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{t('page.stats.active')}</p>
            <p className="text-xl font-semibold text-emerald-600">{stats.active}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{t('page.stats.expiringSoon')}</p>
            <p className="text-xl font-semibold text-amber-600">{stats.expiringSoon}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder={t('page.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="max-w-sm"
        />
        <Button onClick={openCreate}>
          <Plus size={14} />
          {t('page.createButton')}
        </Button>
      </div>

      <LoadingOverlay active={loading && items.length > 0} className="rounded-lg border border-border bg-card">
        {/* Table on wide screens, cards on phones (ResponsiveList). */}
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} className="text-muted-foreground" />
          </div>
        ) : (
          <ResponsiveList
            className="p-3 md:p-0"
            rows={items}
            rowKey={(p) => String(p._id)}
            empty={t('page.table.empty')}
            columns={[
              {
                key: 'name',
                header: t('page.table.name'),
                mobile: 'title',
                cell: (p) => (
                  <div className="font-medium">
                    {p.name}
                    {p.description && <p className="text-xs font-normal text-muted-foreground line-clamp-1">{p.description}</p>}
                  </div>
                ),
              },
              {
                key: 'code',
                header: t('page.table.code'),
                cell: (p) => (p.code ? <Badge variant="outline">{p.code}</Badge> : <span className="text-muted-foreground text-xs">—</span>),
              },
              {
                key: 'discount',
                header: t('page.table.discount'),
                mobile: 'subtitle',
                cell: (p) => <span className="font-medium text-tone-danger">{formatDiscount(p)}</span>,
              },
              { key: 'scope', header: t('page.table.scope'), cell: (p) => <span className="text-sm">{SCOPE_LABEL[p.scope]}</span> },
              {
                key: 'tier',
                header: t('page.table.tier'),
                cell: (p) => (
                  <span className="text-sm">
                    {p.applicableTiers?.length ? p.applicableTiers.map((tier) => `VIP ${tier}`).join(', ') : t('page.allTiers')}
                  </span>
                ),
              },
              {
                key: 'validity',
                header: t('page.table.validity'),
                cell: (p) => (
                  <span className="text-xs text-muted-foreground">
                    {p.startDate ? new Date(p.startDate).toLocaleDateString('vi-VN') : '—'}
                    {' → '}
                    {p.endDate ? new Date(p.endDate).toLocaleDateString('vi-VN') : '—'}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('page.table.status'),
                mobile: 'trailing',
                cell: (p) => (
                  <Badge variant={p.status === Status.Active ? 'secondary' : 'outline'}>
                    {p.status === Status.Active ? t('page.table.active') : t('page.table.inactive')}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                header: '',
                mobile: 'trailing',
                className: 'w-20',
                cell: (p) => (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title={t('common:actions.edit')}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(String(p._id))}
                      title={t('common:actions.delete')}
                    >
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
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
      </LoadingOverlay>

      <PromotionEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editItem}
        productOptions={productOptions}
        categoryOptions={categoryOptions}
        onSaved={() => {
          fetchData();
          fetchStats();
        }}
      />
    </div>
  );
}
