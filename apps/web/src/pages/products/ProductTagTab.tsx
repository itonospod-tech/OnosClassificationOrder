import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageIcon, Plus } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';

import { handleAxiosError } from '@/utils';

import { useProductWriteAccess } from '@/hooks/useProductWriteAccess';

interface ProductTagRow {
  _id: string;
  name: string;
  shortName: string;
  image?: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

interface FormState {
  open: boolean;
  mode: 'create' | 'edit';
  data: {
    _id?: string;
    name: string;
    shortName: string;
    image: string;
    description: string;
    sortOrder: string;
    isActive: boolean;
  };
}

const DEFAULT_FORM: FormState = {
  open: false,
  mode: 'create',
  data: { name: '', shortName: '', image: '', description: '', sortOrder: '0', isActive: true },
};

/** CRUD product tags — same pattern as `CollectionTab` (table + dialog). */
export function ProductTagTab() {
  const { t } = useTranslation(['products', 'common']);
  // AUTH-6 - vai chi doc (Support) xem duoc, khong tao/sua duoc.
  const { canManageProducts } = useProductWriteAccess();
  const [items, setItems] = useState<ProductTagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await RepositoryRemote.productTag.getProductTags('?page=1&limit=200');
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

  const openCreate = () => setForm({ ...DEFAULT_FORM, open: true });

  const openEdit = (item: ProductTagRow) =>
    setForm({
      open: true,
      mode: 'edit',
      data: {
        _id: item._id,
        name: item.name,
        shortName: item.shortName,
        image: item.image || '',
        description: item.description || '',
        sortOrder: String(item.sortOrder ?? 0),
        isActive: item.isActive,
      },
    });

  const handleSubmit = async () => {
    const { mode, data } = form;
    if (!data.name.trim() || !data.shortName.trim()) {
      toast.error(t('productTagTab.form.nameRequired'));
      return;
    }

    const payload = {
      name: data.name,
      shortName: data.shortName,
      image: data.image.trim() || undefined,
      description: data.description.trim() || undefined,
      sortOrder: data.sortOrder ? Number(data.sortOrder) : 0,
      isActive: data.isActive,
    };
    try {
      setSaving(true);
      if (mode === 'create') {
        await RepositoryRemote.productTag.createProductTag(payload);
        toast.success(t('productTagTab.form.createSuccess'));
      } else if (data._id) {
        await RepositoryRemote.productTag.updateProductTag(data._id, payload);
        toast.success(t('productTagTab.form.updateSuccess'));
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
            <h3 className="text-sm font-semibold text-foreground">{t('productTagTab.title')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('productTagTab.description')}</p>
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
          <ResponsiveList<ProductTagRow>
            rows={items}
            rowKey={(it) => it._id}
            onRowClick={canManageProducts ? openEdit : undefined}
            empty={t('productTagTab.table.empty')}
            columns={[
              {
                key: 'image',
                header: t('productTagTab.table.image'),
                className: 'w-16',
                mobile: 'hidden',
                cell: (it) =>
                  it.image ? (
                    <img src={it.image} alt={it.name} className="h-10 w-10 rounded border border-border object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-border text-muted-foreground">
                      <ImageIcon size={14} />
                    </div>
                  ),
              },
              {
                key: 'name',
                header: t('productTagTab.table.name'),
                mobile: 'title',
                cell: (it) => (
                  <div>
                    <span className="font-medium">{it.name}</span>
                    {it.description && (
                      <div className="max-w-[280px] truncate text-xs text-muted-foreground">{it.description}</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'shortName',
                header: t('productTagTab.table.shortName'),
                mobile: 'subtitle',
                cell: (it) => <Badge variant="outline">{it.shortName}</Badge>,
              },
              {
                key: 'sortOrder',
                header: t('productTagTab.table.sortOrder'),
                mobile: 'hidden',
                cell: (it) => <span className="tabular-nums">{it.sortOrder}</span>,
              },
              {
                key: 'status',
                header: t('productTagTab.table.status'),
                mobile: 'trailing',
                cell: (it) =>
                  it.isActive ? (
                    <Badge variant="success">{t('productTagTab.table.active')}</Badge>
                  ) : (
                    <Badge variant="secondary">{t('productTagTab.table.inactive')}</Badge>
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
              {form.mode === 'create' ? t('productTagTab.dialog.createTitle') : t('productTagTab.dialog.editTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('productTagTab.form.name')}</Label>
              <Input
                value={form.data.name}
                onChange={(e) => setForm({ ...form, data: { ...form.data, name: e.target.value } })}
                placeholder={t('productTagTab.form.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('productTagTab.form.shortName')}</Label>
              <Input
                value={form.data.shortName}
                onChange={(e) => setForm({ ...form, data: { ...form.data, shortName: e.target.value.toUpperCase() } })}
                placeholder={t('productTagTab.form.shortNamePlaceholder')}
                maxLength={30}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('productTagTab.form.image')}</Label>
              <Input
                value={form.data.image}
                onChange={(e) => setForm({ ...form, data: { ...form.data, image: e.target.value } })}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('productTagTab.form.description')}</Label>
              <Textarea
                value={form.data.description}
                onChange={(e) => setForm({ ...form, data: { ...form.data, description: e.target.value } })}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t('productTagTab.form.sortOrder')}</Label>
                <Input
                  type="number"
                  value={form.data.sortOrder}
                  onChange={(e) => setForm({ ...form, data: { ...form.data, sortOrder: e.target.value } })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3 self-end">
                <Label>{t('productTagTab.form.active')}</Label>
                <Switch
                  checked={form.data.isActive}
                  onCheckedChange={(v) => setForm({ ...form, data: { ...form.data, isActive: v } })}
                />
              </div>
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
