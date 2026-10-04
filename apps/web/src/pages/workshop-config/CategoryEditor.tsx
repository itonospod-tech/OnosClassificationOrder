import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  CreateWorkshopConfigDto,
  WorkshopConfig,
  WorkshopConfigCategory,
  WorkshopConfigDisplayMode,
} from 'shared';
import { toast } from 'sonner';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

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

import { useIsMobile } from '@/hooks/useMediaQuery';

import { ColorPicker } from './ColorPicker';
import { IconPicker, LucideIcon } from './IconPicker';

interface FormState {
  open: boolean;
  mode: 'create' | 'edit';
  id?: string;
  code: string;
  name: string;
  color?: string;
  icon?: string;
  isActive: boolean;
  /** Required khi category=production_error. */
  errorSource?: 'designer' | 'factory' | 'tool-check';
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

interface Props {
  category: WorkshopConfigCategory;
  mode: WorkshopConfigDisplayMode;
}

export function CategoryEditor({ category, mode }: Props) {
  const { t } = useTranslation(['workshopConfig', 'common']);
  const isMobile = useIsMobile();
  const { byCategory, load, loaded, loading, upsertItem, removeItem } = useWorkshopConfigStore();
  const items = byCategory[category] || [];

  // Chỉ category `production_error` cần errorSource (designer/factory) để
  // dashboard stats phân loại lỗi.
  const needsErrorSource = (category as string) === 'production_error';

  const [form, setForm] = useState<FormState>({ open: false, mode: 'create', code: '', name: '', isActive: true });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WorkshopConfig | null>(null);

  useEffect(() => {
    if (!loaded && !loading) load();
  }, [loaded, loading, load]);

  const openCreate = () =>
    setForm({
      open: true,
      mode: 'create',
      code: '',
      name: '',
      color: mode === 'color' ? '#3B82F6' : undefined,
      icon: mode === 'icon' ? 'User' : undefined,
      isActive: true,
      errorSource: needsErrorSource ? 'factory' : undefined,
    });

  const openEdit = (item: WorkshopConfig) =>
    setForm({
      open: true,
      mode: 'edit',
      id: item._id,
      code: item.code,
      name: item.name,
      color: item.color,
      icon: item.icon,
      isActive: item.isActive,
      errorSource: (item as { errorSource?: 'designer' | 'factory' | 'tool-check' }).errorSource,
    });

  const handleNameChange = (name: string) => {
    if (form.mode === 'create') {
      setForm({ ...form, name, code: form.code || slugify(name) });
    } else {
      setForm({ ...form, name });
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error(t('categoryEditor.form.nameCodeRequired'));
      return;
    }
    if (mode === 'color' && !form.color) {
      toast.error(t('categoryEditor.form.colorRequired'));
      return;
    }
    if (mode === 'icon' && !form.icon) {
      toast.error(t('categoryEditor.form.iconRequired'));
      return;
    }
    if (needsErrorSource && !form.errorSource) {
      toast.error(t('categoryEditor.form.errorSourceRequired'));
      return;
    }
    try {
      setSaving(true);
      if (form.mode === 'create') {
        const payload: CreateWorkshopConfigDto = {
          category,
          code: form.code,
          name: form.name,
          color: mode === 'color' ? form.color : undefined,
          icon: mode === 'icon' ? form.icon : undefined,
          isActive: form.isActive,
          errorSource: needsErrorSource ? form.errorSource : undefined,
        };
        const res = await RepositoryRemote.workshopConfig.create(payload);
        upsertItem(res.data.data);
        toast.success(t('categoryEditor.form.addSuccess'));
      } else if (form.id) {
        const res = await RepositoryRemote.workshopConfig.update(form.id, {
          code: form.code,
          name: form.name,
          color: mode === 'color' ? form.color : undefined,
          icon: mode === 'icon' ? form.icon : undefined,
          isActive: form.isActive,
          errorSource: needsErrorSource ? form.errorSource : undefined,
        });
        upsertItem(res.data.data);
        toast.success(t('categoryEditor.form.updateSuccess'));
      }
      setForm({ ...form, open: false });
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await RepositoryRemote.workshopConfig.remove(confirmDelete._id!);
      removeItem(confirmDelete._id!);
      toast.success(t('categoryEditor.deleteSuccess'));
      setConfirmDelete(null);
    } catch (error) {
      handleAxiosError(error);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <p className="text-xs text-muted-foreground">
          {t('categoryEditor.itemCount', { count: items.length })}{' '}
          <span className="font-medium text-foreground">
            {mode === 'color' ? t('categoryEditor.displayMode.color') : t('categoryEditor.displayMode.icon')}
          </span>
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus size={14} /> {t('common:actions.add')}
        </Button>
      </div>
      {/* Table on wide screens, cards on phones. The rows hold no inline inputs (edit is a dialog), so cards are safe. */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} className="text-muted-foreground" />
        </div>
      ) : (
        <ResponsiveList
          className="p-3 md:p-0"
          rows={items}
          rowKey={(it) => it._id!}
          empty={t('categoryEditor.table.empty')}
          columns={[
            {
              key: 'display',
              header: t('categoryEditor.table.display'),
              mobile: 'hidden',
              className: 'w-36',
              cell: (it) => <DisplayChip item={it} mode={mode} />,
            },
            {
              key: 'name',
              header: t('categoryEditor.table.name'),
              mobile: 'title',
              cell: (it) => (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                  {/* The phone card has no display column, so the colour/icon rides in front of the name. */}
                  {isMobile && <DisplayChip item={it} mode={mode} compact />}
                  <span className="break-words">{it.name}</span>
                  {needsErrorSource && (
                    <ErrorSourceBadge
                      source={(it as { errorSource?: 'designer' | 'factory' | 'tool-check' }).errorSource}
                    />
                  )}
                </span>
              ),
            },
            {
              key: 'code',
              header: t('categoryEditor.table.code'),
              mobile: 'subtitle',
              cell: (it) => <span className="break-all font-mono text-xs text-muted-foreground">{it.code}</span>,
            },
            {
              key: 'status',
              header: t('categoryEditor.table.status'),
              mobile: 'trailing',
              className: 'w-24',
              cell: (it) =>
                it.isActive ? (
                  <Badge variant="success">{t('categoryEditor.table.on')}</Badge>
                ) : (
                  <Badge variant="secondary">{t('categoryEditor.table.off')}</Badge>
                ),
            },
            {
              key: 'actions',
              header: '',
              mobile: 'trailing',
              className: 'w-28 text-right',
              cell: (it) => (
                <span className="inline-flex items-center">
                  {/* 44px touch targets on a finger, compact on a mouse. */}
                  <Button variant="ghost" size="sm" className="touch:h-11 touch:w-11" onClick={() => openEdit(it)}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" className="touch:h-11 touch:w-11" onClick={() => setConfirmDelete(it)}>
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </span>
              ),
            },
          ]}
        />
      )}

      <Dialog open={form.open} onOpenChange={(open) => setForm({ ...form, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.mode === 'create' ? t('categoryEditor.dialog.createTitle') : t('categoryEditor.dialog.editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('categoryEditor.form.displayName')}</Label>
              <Input
                value={form.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={t('categoryEditor.form.displayNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {t('categoryEditor.form.code')} <span className="text-muted-foreground">{t('categoryEditor.form.codeHint')}</span>
              </Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: slugify(e.target.value) })}
                placeholder={t('categoryEditor.form.codePlaceholder')}
                className="font-mono"
              />
            </div>
            {mode === 'color' ? (
              <div className="space-y-2">
                <Label>{t('categoryEditor.form.color')}</Label>
                <ColorPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{t('categoryEditor.form.icon')}</Label>
                <IconPicker value={form.icon} onChange={(i) => setForm({ ...form, icon: i })} />
              </div>
            )}
            {needsErrorSource && (
              <div className="space-y-2">
                <Label>{t('categoryEditor.errorSource.label')}</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, errorSource: 'designer' })}
                    className={`flex-1 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
                      form.errorSource === 'designer'
                        ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300'
                        : 'border-border bg-background text-muted-foreground hover:border-violet-300'
                    }`}
                  >
                    {t('categoryEditor.errorSource.designer')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, errorSource: 'factory' })}
                    className={`flex-1 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
                      form.errorSource === 'factory'
                        ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
                        : 'border-border bg-background text-muted-foreground hover:border-sky-300'
                    }`}
                  >
                    {t('categoryEditor.errorSource.factory')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, errorSource: 'tool-check' })}
                    className={`flex-1 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
                      form.errorSource === 'tool-check'
                        ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                        : 'border-border bg-background text-muted-foreground hover:border-amber-300'
                    }`}
                  >
                    {t('categoryEditor.errorSource.toolCheck')}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">{t('categoryEditor.errorSource.hint')}</p>
              </div>
            )}
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label>{t('categoryEditor.form.active')}</Label>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm({ ...form, open: false })}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Spinner size={14} className="mr-2" />}
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('categoryEditor.deleteDialog.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('categoryEditor.deleteDialog.message', { name: confirmDelete?.name })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The colour badge / icon of a row. `compact` is the phone card: a swatch, since the name is printed right beside it. */
function DisplayChip({ item, mode, compact = false }: { item: WorkshopConfig; mode: Props['mode']; compact?: boolean }) {
  if (mode === 'color') {
    return compact ? (
      <span
        aria-hidden
        className="inline-block h-3 w-3 shrink-0 rounded-full border"
        style={{ backgroundColor: item.color, borderColor: item.color }}
      />
    ) : (
      <Badge className="whitespace-nowrap font-normal border" style={{ backgroundColor: item.color, color: '#fff', borderColor: item.color }}>
        {item.name}
      </Badge>
    );
  }
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-muted">
      <LucideIcon name={item.icon} size={16} />
    </span>
  );
}

function ErrorSourceBadge({ source }: { source?: 'designer' | 'factory' | 'tool-check' }) {
  const { t } = useTranslation('workshopConfig');
  if (!source) {
    return (
      <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-500/20">
        {t('categoryEditor.errorSourceBadge.unassigned')}
      </span>
    );
  }
  if (source === 'designer') {
    return (
      <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
        {t('categoryEditor.errorSourceBadge.designer')}
      </span>
    );
  }
  if (source === 'tool-check') {
    return (
      <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
        {t('categoryEditor.errorSourceBadge.toolCheck')}
      </span>
    );
  }
  return (
    <span className="ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
      {t('categoryEditor.errorSourceBadge.factory')}
    </span>
  );
}
