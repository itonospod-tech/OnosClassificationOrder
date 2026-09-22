import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import type { CreateWorkshopConfigDto, WorkshopConfig } from 'shared';
import { FactoryFlowType, WorkshopConfigCategory } from 'shared';
import { toast } from 'sonner';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { useConfirm } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { handleAxiosError } from '@/utils';

import { useProductWriteAccess } from '@/hooks/useProductWriteAccess';
import { IconPicker, LucideIcon } from '@/pages/workshop-config/IconPicker';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

interface FabricFormState {
  open: boolean;
  mode: 'create' | 'edit';
  id?: string;
  code: string;
  name: string;
  icon: string;
  isActive: boolean;
}

const FABRIC_FORM_DEFAULT: FabricFormState = {
  open: false,
  mode: 'create',
  code: '',
  name: '',
  icon: 'Shirt',
  isActive: true,
};

interface ListItem {
  _id: string;
  name: string;
  shortName: string;
  isActive: boolean;
  /** Chỉ factory có — xưởng cũ trong DB có thể thiếu field (coi như 'standard'). */
  flowType?: FactoryFlowType;
  /** Chỉ factory — toggle "tự hoàn thành Đóng hàng" (đơn chảy tới pack tự xong). */
  autoCompletePack?: boolean;
  /** Chỉ factory — bỏ qua soát tool: đơn mới vào thẳng cột In (xưởng DTF). */
  skipToolCheck?: boolean;
  /** Chỉ factory — trạm quét tự trừ tồn kho sau khi in label giao hàng. */
  autoStockOut?: boolean;
}

interface FormState {
  open: boolean;
  mode: 'create' | 'edit';
  type: 'factory' | 'machineType';
  data: {
    _id?: string;
    name: string;
    shortName: string;
    isActive: boolean;
    flowType: FactoryFlowType;
    autoCompletePack: boolean;
    skipToolCheck: boolean;
    autoStockOut: boolean;
  };
}

const DEFAULT_FORM: FormState = {
  open: false,
  mode: 'create',
  type: 'factory',
  data: {
    name: '',
    shortName: '',
    isActive: true,
    flowType: FactoryFlowType.Standard,
    autoCompletePack: false,
    skipToolCheck: false,
    autoStockOut: false,
  },
};

export function FactoryTab() {
  const { t } = useTranslation(['products', 'common']);
  const { confirm, confirmDialog } = useConfirm();
  // AUTH-6 - vai chi doc (Support) xem duoc, khong tao/sua/xoa duoc.
  const { canManageProducts } = useProductWriteAccess();
  const [factories, setFactories] = useState<ListItem[]>([]);
  const [machineTypes, setMachineTypes] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const fabricItems = useWorkshopConfigStore((s) => s.byCategory[WorkshopConfigCategory.FabricType] || []);
  const fabricLoaded = useWorkshopConfigStore((s) => s.loaded);
  const fabricLoading = useWorkshopConfigStore((s) => s.loading);
  const loadFabrics = useWorkshopConfigStore((s) => s.load);
  const upsertFabric = useWorkshopConfigStore((s) => s.upsertItem);
  const removeFabric = useWorkshopConfigStore((s) => s.removeItem);
  const [fabricForm, setFabricForm] = useState<FabricFormState>(FABRIC_FORM_DEFAULT);
  const [fabricSaving, setFabricSaving] = useState(false);
  const [fabricConfirmDelete, setFabricConfirmDelete] = useState<WorkshopConfig | null>(null);

  useEffect(() => {
    if (!fabricLoaded && !fabricLoading) loadFabrics();
  }, [fabricLoaded, fabricLoading, loadFabrics]);

  const openFabricCreate = () => setFabricForm({ ...FABRIC_FORM_DEFAULT, open: true });
  const openFabricEdit = (item: WorkshopConfig) =>
    setFabricForm({
      open: true,
      mode: 'edit',
      id: item._id,
      code: item.code,
      name: item.name,
      icon: item.icon || 'Shirt',
      isActive: item.isActive,
    });

  const handleFabricNameChange = (name: string) => {
    if (fabricForm.mode === 'create') {
      setFabricForm({ ...fabricForm, name, code: fabricForm.code || slugify(name) });
    } else {
      setFabricForm({ ...fabricForm, name });
    }
  };

  const handleFabricSubmit = async () => {
    if (!fabricForm.name.trim() || !fabricForm.code.trim()) {
      toast.error(t('factoryTab.fabric.form.nameCodeRequired'));
      return;
    }
    try {
      setFabricSaving(true);
      if (fabricForm.mode === 'create') {
        const payload: CreateWorkshopConfigDto = {
          category: WorkshopConfigCategory.FabricType,
          code: fabricForm.code,
          name: fabricForm.name,
          icon: fabricForm.icon,
          isActive: fabricForm.isActive,
        };
        const res = await RepositoryRemote.workshopConfig.create(payload);
        upsertFabric(res.data.data);
        toast.success(t('factoryTab.fabric.addSuccess'));
      } else if (fabricForm.id) {
        const res = await RepositoryRemote.workshopConfig.update(fabricForm.id, {
          code: fabricForm.code,
          name: fabricForm.name,
          icon: fabricForm.icon,
          isActive: fabricForm.isActive,
        });
        upsertFabric(res.data.data);
        toast.success(t('common:status.success'));
      }
      setFabricForm(FABRIC_FORM_DEFAULT);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setFabricSaving(false);
    }
  };

  const handleFabricDelete = async () => {
    if (!fabricConfirmDelete) return;
    try {
      await RepositoryRemote.workshopConfig.remove(fabricConfirmDelete._id!);
      removeFabric(fabricConfirmDelete._id!);
      toast.success(t('factoryTab.fabric.deleteSuccess'));
      setFabricConfirmDelete(null);
    } catch (error) {
      handleAxiosError(error);
    }
  };

  const handleFabricReset = async () => {
    if (!(await confirm({ title: t('factoryTab.fabric.reset.confirm'), destructive: true }))) return;
    try {
      const res = await RepositoryRemote.workshopConfig.resetCategory(WorkshopConfigCategory.FabricType);
      const { removed, inserted } = res.data.data;
      toast.success(t('factoryTab.fabric.reset.success', { removed, inserted }));
      await loadFabrics(true);
    } catch (error) {
      handleAxiosError(error);
    }
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [fResp, mResp] = await Promise.all([
        RepositoryRemote.factory.getFactories('?page=1&limit=100'),
        RepositoryRemote.machineType.getMachineTypes('?page=1&limit=100'),
      ]);
      setFactories(fResp.data.data || []);
      setMachineTypes(mResp.data.data || []);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const openCreate = (type: 'factory' | 'machineType') =>
    setForm({
      open: true,
      mode: 'create',
      type,
      data: {
        name: '',
        shortName: '',
        isActive: true,
        flowType: FactoryFlowType.Standard,
        autoCompletePack: false,
        skipToolCheck: false,
        autoStockOut: false,
      },
    });

  const openEdit = (type: 'factory' | 'machineType', item: ListItem) =>
    setForm({
      open: true,
      mode: 'edit',
      type,
      data: {
        _id: item._id,
        name: item.name,
        shortName: item.shortName,
        isActive: item.isActive,
        flowType: item.flowType ?? FactoryFlowType.Standard,
        autoCompletePack: item.autoCompletePack ?? false,
        skipToolCheck: item.skipToolCheck ?? false,
        autoStockOut: item.autoStockOut ?? false,
      },
    });

  // Nút "Hoàn thành đơn tồn" — dọn 1 lần mọi đơn đang chờ ở Đóng hàng của
  // xưởng (toggle autoCompletePack chỉ áp đơn MỚI chảy tới, không đụng đơn tồn).
  const [packBacklogBusy, setPackBacklogBusy] = useState(false);
  const handleCompletePackBacklog = async () => {
    const { _id, name } = form.data;
    if (!_id) return;
    if (!(await confirm({ title: t('factoryTab.form.autoPack.sweepConfirm', { name }) }))) return;
    try {
      setPackBacklogBusy(true);
      const res = await RepositoryRemote.fulfillment.completePackBacklog({ factoryId: _id });
      const data = res.data?.data as { total: number; ok: number; fail: number };
      if (data.total === 0) toast.info(t('factoryTab.form.autoPack.sweepEmpty'));
      else if (data.fail > 0) toast.warning(t('factoryTab.form.autoPack.sweepPartial', { ok: data.ok, fail: data.fail }));
      else toast.success(t('factoryTab.form.autoPack.sweepDone', { ok: data.ok }));
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setPackBacklogBusy(false);
    }
  };

  const handleSubmit = async () => {
    const { mode, type, data } = form;
    if (!data.name.trim() || !data.shortName.trim()) {
      toast.error(t('factoryTab.form.nameShortNameRequired'));
      return;
    }

    try {
      if (mode === 'create') {
        if (type === 'factory') {
          await RepositoryRemote.factory.createFactory({
            name: data.name,
            shortName: data.shortName,
            isActive: data.isActive,
            flowType: data.flowType,
            autoCompletePack: data.autoCompletePack,
            skipToolCheck: data.skipToolCheck,
            autoStockOut: data.autoStockOut,
          });
        } else {
          await RepositoryRemote.machineType.createMachineType({
            name: data.name,
            shortName: data.shortName,
            isActive: data.isActive,
          });
        }
        toast.success(t('factoryTab.form.createSuccess'));
      } else if (data._id) {
        if (type === 'factory') {
          await RepositoryRemote.factory.updateFactory(data._id, {
            name: data.name,
            shortName: data.shortName,
            isActive: data.isActive,
            flowType: data.flowType,
            autoCompletePack: data.autoCompletePack,
            skipToolCheck: data.skipToolCheck,
            autoStockOut: data.autoStockOut,
          });
        } else {
          await RepositoryRemote.machineType.updateMachineType(data._id, {
            name: data.name,
            shortName: data.shortName,
            isActive: data.isActive,
          });
        }
        toast.success(t('factoryTab.form.updateSuccess'));
      }
      setForm(DEFAULT_FORM);
      fetchAll();
    } catch (error) {
      handleAxiosError(error);
    }
  };

  const renderTable = (items: ListItem[], type: 'factory' | 'machineType', title: string, description: string) => (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {canManageProducts && (
          <Button size="sm" onClick={() => openCreate(type)}>
            <Plus size={14} />
            {t('common:actions.add')}
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('factoryTab.table.name')}</TableHead>
            <TableHead>{t('factoryTab.table.shortName')}</TableHead>
            <TableHead>{t('factoryTab.table.status')}</TableHead>
            <TableHead className="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8">
                <Spinner size={20} className="text-muted-foreground" />
              </TableCell>
            </TableRow>
          )}
          {!loading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                {t('common:status.noData')}
              </TableCell>
            </TableRow>
          )}
          {!loading &&
            items.map((it) => (
              <TableRow key={it._id}>
                <TableCell className="font-medium">
                  {it.name}
                  {type === 'factory' && it.flowType && it.flowType !== FactoryFlowType.Standard && (
                    <Badge variant="secondary" className="ml-2">
                      {it.flowType === FactoryFlowType.Merged
                        ? t('factoryTab.table.flowBadge.merged')
                        : it.flowType === FactoryFlowType.PressComplete
                          ? t('factoryTab.table.flowBadge.pressComplete')
                          : t('factoryTab.table.flowBadge.noSew')}
                    </Badge>
                  )}
                  {type === 'factory' && it.autoCompletePack && (
                    <Badge variant="outline" className="ml-2 border-emerald-400 text-emerald-600 dark:text-emerald-400">
                      {t('factoryTab.table.autoPackBadge')}
                    </Badge>
                  )}
                  {type === 'factory' && it.skipToolCheck && (
                    <Badge variant="outline" className="ml-2 border-sky-400 text-sky-600 dark:text-sky-400">
                      {t('factoryTab.table.skipToolCheckBadge')}
                    </Badge>
                  )}
                  {type === 'factory' && it.autoStockOut && (
                    <Badge variant="outline" className="ml-2 border-amber-400 text-amber-600 dark:text-amber-400">
                      {t('factoryTab.table.autoStockOutBadge')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{it.shortName}</Badge>
                </TableCell>
                <TableCell>
                  {it.isActive ? (
                    <Badge variant="success">{t('factoryTab.table.active')}</Badge>
                  ) : (
                    <Badge variant="secondary">{t('factoryTab.table.inactive')}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {canManageProducts && (
                    <Button variant="ghost" size="sm" onClick={() => openEdit(type, it)}>
                      {t('common:actions.edit')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      {confirmDialog}
      {renderTable(factories, 'factory', t('factoryTab.factory.title'), t('factoryTab.factory.description'))}
      {renderTable(machineTypes, 'machineType', t('factoryTab.machineType.title'), t('factoryTab.machineType.description'))}

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('factoryTab.fabric.title')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('factoryTab.fabric.description')}</p>
          </div>
          {canManageProducts && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleFabricReset}
                title={t('factoryTab.fabric.reset.title')}
              >
                <RotateCw size={14} />
                {t('factoryTab.fabric.reset.button')}
              </Button>
              <Button size="sm" onClick={openFabricCreate}>
                <Plus size={14} />
                {t('common:actions.add')}
              </Button>
            </div>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t('factoryTab.fabric.table.icon')}</TableHead>
              <TableHead>{t('factoryTab.table.name')}</TableHead>
              <TableHead>{t('factoryTab.fabric.table.code')}</TableHead>
              <TableHead className="w-24">{t('factoryTab.table.status')}</TableHead>
              <TableHead className="w-28 text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fabricLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <Spinner size={20} className="text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!fabricLoading && fabricItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                  {t('factoryTab.fabric.table.empty')}
                </TableCell>
              </TableRow>
            )}
            {!fabricLoading &&
              fabricItems.map((it) => (
                <TableRow key={it._id}>
                  <TableCell>
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-muted">
                      <LucideIcon name={it.icon} size={16} />
                    </span>
                  </TableCell>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{it.code}</TableCell>
                  <TableCell>
                    {it.isActive ? (
                      <Badge variant="success">{t('factoryTab.fabric.table.on')}</Badge>
                    ) : (
                      <Badge variant="secondary">{t('factoryTab.table.inactive')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canManageProducts && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openFabricEdit(it)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setFabricConfirmDelete(it)}>
                          <Trash2 size={14} className="text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={fabricForm.open} onOpenChange={(open) => !open && setFabricForm(FABRIC_FORM_DEFAULT)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {fabricForm.mode === 'create' ? t('factoryTab.fabric.dialog.createTitle') : t('factoryTab.fabric.dialog.editTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('factoryTab.fabric.form.displayName')}</Label>
              <Input
                value={fabricForm.name}
                onChange={(e) => handleFabricNameChange(e.target.value)}
                placeholder={t('factoryTab.fabric.form.displayNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {t('factoryTab.fabric.form.code')} <span className="text-muted-foreground">{t('factoryTab.fabric.form.codeHint')}</span>
              </Label>
              <Input
                value={fabricForm.code}
                onChange={(e) => setFabricForm({ ...fabricForm, code: slugify(e.target.value) })}
                placeholder={t('factoryTab.fabric.form.codePlaceholder')}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('factoryTab.fabric.form.icon')}</Label>
              <IconPicker value={fabricForm.icon} onChange={(i) => setFabricForm({ ...fabricForm, icon: i })} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label>{t('factoryTab.form.active')}</Label>
              <Switch
                checked={fabricForm.isActive}
                onCheckedChange={(v) => setFabricForm({ ...fabricForm, isActive: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFabricForm(FABRIC_FORM_DEFAULT)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleFabricSubmit} disabled={fabricSaving}>
              {fabricSaving && <Spinner size={14} className="mr-2" />}
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fabricConfirmDelete} onOpenChange={(open) => !open && setFabricConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('factoryTab.fabric.deleteDialog.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('factoryTab.fabric.deleteDialog.message', { name: fabricConfirmDelete?.name })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFabricConfirmDelete(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleFabricDelete}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={form.open} onOpenChange={(open) => !open && setForm(DEFAULT_FORM)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form.mode === 'create' ? t('common:actions.add') : t('common:actions.edit')}{' '}
              {form.type === 'factory' ? t('factoryTab.dialog.factoryNoun') : t('factoryTab.dialog.machineTypeNoun')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('factoryTab.table.name')}</Label>
              <Input
                value={form.data.name}
                onChange={(e) => setForm({ ...form, data: { ...form.data, name: e.target.value } })}
                placeholder={form.type === 'factory' ? t('factoryTab.dialog.factoryNamePlaceholder') : t('factoryTab.dialog.machineTypeNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('factoryTab.table.shortName')}</Label>
              <Input
                value={form.data.shortName}
                onChange={(e) => setForm({ ...form, data: { ...form.data, shortName: e.target.value.toUpperCase() } })}
                placeholder={form.type === 'factory' ? t('factoryTab.dialog.factoryShortNamePlaceholder') : t('factoryTab.dialog.machineTypeShortNamePlaceholder')}
                maxLength={20}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label>{t('factoryTab.form.active')}</Label>
              <Switch
                checked={form.data.isActive}
                onCheckedChange={(v) => setForm({ ...form, data: { ...form.data, isActive: v } })}
              />
            </div>
            {form.type === 'factory' && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <Label>{t('factoryTab.form.flowType')}</Label>
                <select
                  value={form.data.flowType}
                  onChange={(e) =>
                    setForm({ ...form, data: { ...form.data, flowType: e.target.value as FactoryFlowType } })
                  }
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value={FactoryFlowType.Standard}>{t('factoryTab.form.flowOptions.standard')}</option>
                  <option value={FactoryFlowType.Merged}>{t('factoryTab.form.flowOptions.merged')}</option>
                  <option value={FactoryFlowType.NoSew}>{t('factoryTab.form.flowOptions.noSew')}</option>
                  <option value={FactoryFlowType.PressComplete}>{t('factoryTab.form.flowOptions.pressComplete')}</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {form.data.flowType === FactoryFlowType.Merged && t('factoryTab.form.flowHint.merged')}
                  {form.data.flowType === FactoryFlowType.NoSew && t('factoryTab.form.flowHint.noSew')}
                  {form.data.flowType === FactoryFlowType.PressComplete && t('factoryTab.form.flowHint.pressComplete')}
                  {form.data.flowType === FactoryFlowType.Standard && t('factoryTab.form.flowHint.standard')}
                </p>
              </div>
            )}
            {form.type === 'factory' && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label>{t('factoryTab.form.autoPack.label')}</Label>
                  <Switch
                    checked={form.data.autoCompletePack}
                    onCheckedChange={(v) => setForm({ ...form, data: { ...form.data, autoCompletePack: v } })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t('factoryTab.form.autoPack.hint')}</p>
                {form.mode === 'edit' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={packBacklogBusy}
                    onClick={handleCompletePackBacklog}
                  >
                    {packBacklogBusy && <Spinner size={14} className="mr-2" />}
                    {t('factoryTab.form.autoPack.sweepBtn')}
                  </Button>
                )}
              </div>
            )}
            {form.type === 'factory' && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label>{t('factoryTab.form.skipToolCheck.label')}</Label>
                  <Switch
                    checked={form.data.skipToolCheck}
                    onCheckedChange={(v) => setForm({ ...form, data: { ...form.data, skipToolCheck: v } })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t('factoryTab.form.skipToolCheck.hint')}</p>
              </div>
            )}
            {form.type === 'factory' && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label>{t('factoryTab.form.autoStockOut.label')}</Label>
                  <Switch
                    checked={form.data.autoStockOut}
                    onCheckedChange={(v) => setForm({ ...form, data: { ...form.data, autoStockOut: v } })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t('factoryTab.form.autoStockOut.hint')}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(DEFAULT_FORM)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleSubmit}>{t('common:actions.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
