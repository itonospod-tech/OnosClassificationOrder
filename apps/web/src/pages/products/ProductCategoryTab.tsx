import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { ResponsiveList } from '@/components/common/ResponsiveList';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { handleAxiosError } from '@/utils';
import { sortCategoryTree } from '@/utils/categoryTree';

import { useProductWriteAccess } from '@/hooks/useProductWriteAccess';

interface ProductCategoryRow {
  _id: string;
  name: string;
  shortName: string;
  isActive: boolean;
  parentId?: string;
}

interface FormState {
  open: boolean;
  mode: 'create' | 'edit';
  data: { _id?: string; name: string; shortName: string; isActive: boolean; parentId: string };
}

const DEFAULT_FORM: FormState = {
  open: false,
  mode: 'create',
  data: { name: '', shortName: '', isActive: true, parentId: '' },
};

export function ProductCategoryTab() {
  const { t } = useTranslation(['products', 'common']);
  // AUTH-6 - vai chi doc (Support) xem duoc, khong tao/sua duoc.
  const { canManageProducts } = useProductWriteAccess();
  const [items, setItems] = useState<ProductCategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await RepositoryRemote.productCategory.getProductCategories('?page=1&limit=200');
      setItems(res.data?.data || []);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreate = () =>
    setForm({ open: true, mode: 'create', data: { name: '', shortName: '', isActive: true, parentId: '' } });

  const openEdit = (item: ProductCategoryRow) =>
    setForm({
      open: true,
      mode: 'edit',
      data: {
        _id: item._id,
        name: item.name,
        shortName: item.shortName,
        isActive: item.isActive,
        parentId: item.parentId || '',
      },
    });

  const handleSubmit = async () => {
    const { mode, data } = form;
    if (!data.name.trim() || !data.shortName.trim()) {
      toast.error(t('categoryTab.form.nameRequired'));
      return;
    }

    const payload = {
      name: data.name,
      shortName: data.shortName,
      isActive: data.isActive,
      parentId: data.parentId || undefined,
    };
    try {
      setSaving(true);
      if (mode === 'create') {
        await RepositoryRemote.productCategory.createProductCategory(payload);
        toast.success(t('categoryTab.form.createSuccess'));
      } else if (data._id) {
        await RepositoryRemote.productCategory.updateProductCategory(data._id, payload);
        toast.success(t('categoryTab.form.updateSuccess'));
      }
      setForm(DEFAULT_FORM);
      fetchData();
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('categoryTab.title')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('categoryTab.description')}</p>
          </div>
          {canManageProducts && (
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} />
              {t('common:actions.add')}
            </Button>
          )}
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} className="text-muted-foreground" />
          </div>
        ) : (
          <ResponsiveList
            rows={sortCategoryTree(items)}
            rowKey={(it) => it._id}
            onRowClick={canManageProducts ? openEdit : undefined}
            empty={t('categoryTab.table.empty')}
            columns={[
              {
                key: 'name',
                header: t('categoryTab.table.name'),
                mobile: 'title',
                cell: (it) => (
                  <span style={{ paddingLeft: it.depth * 20 }} className="inline-flex items-center gap-1.5 font-medium">
                    {it.depth > 0 && <span className="text-muted-foreground">└</span>}
                    {it.name}
                  </span>
                ),
              },
              {
                key: 'shortName',
                header: t('categoryTab.table.shortName'),
                mobile: 'subtitle',
                cell: (it) => <Badge variant="outline">{it.shortName}</Badge>,
              },
              {
                key: 'status',
                header: t('categoryTab.table.status'),
                mobile: 'trailing',
                cell: (it) =>
                  it.isActive ? (
                    <Badge variant="success">{t('categoryTab.table.active')}</Badge>
                  ) : (
                    <Badge variant="secondary">{t('categoryTab.table.inactive')}</Badge>
                  ),
              },
              {
                key: 'actions',
                header: '',
                className: 'w-20',
                mobile: 'hidden',
                cell: (it) =>
                  canManageProducts && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(it);
                      }}
                    >
                      {t('common:actions.edit')}
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </div>

      <Dialog open={form.open} onOpenChange={(open) => !open && setForm(DEFAULT_FORM)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form.mode === 'create' ? t('categoryTab.dialog.createTitle') : t('categoryTab.dialog.editTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('categoryTab.form.name')}</Label>
              <Input
                value={form.data.name}
                onChange={(e) => setForm({ ...form, data: { ...form.data, name: e.target.value } })}
                placeholder={t('categoryTab.form.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('categoryTab.form.shortName')}</Label>
              <Input
                value={form.data.shortName}
                onChange={(e) => setForm({ ...form, data: { ...form.data, shortName: e.target.value.toUpperCase() } })}
                placeholder={t('categoryTab.form.shortNamePlaceholder')}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('categoryTab.form.parent')}</Label>
              <select
                value={form.data.parentId}
                onChange={(e) => setForm({ ...form, data: { ...form.data, parentId: e.target.value } })}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t('categoryTab.form.noParent')}</option>
                {sortCategoryTree(items)
                  .filter((it) => it._id !== form.data._id)
                  .map((it) => (
                    <option key={it._id} value={it._id}>
                      {'—'.repeat(it.depth)} {it.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label>{t('categoryTab.form.active')}</Label>
              <Switch
                checked={form.data.isActive}
                onCheckedChange={(v) => setForm({ ...form, data: { ...form.data, isActive: v } })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(DEFAULT_FORM)} disabled={saving}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Spinner size={14} className="mr-2" />}
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
