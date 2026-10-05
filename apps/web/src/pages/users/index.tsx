import React, { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Eye, EyeOff, Pencil, Plus, RefreshCw, Trash2, Users as UsersIcon } from 'lucide-react';
import type { Role } from 'shared';
import { FULFILLMENT_STAGES, Status } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { PageHeader } from '@/components/common/PageHeader';
import { ResponsiveList } from '@/components/common/ResponsiveList';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { handleAxiosError } from '@/utils';
import { getStageLabel } from '@/utils/fulfillmentStageLabel';

interface UserRow {
  _id: string;
  fullName: string;
  email: string;
  roleId?: string;
  status?: string;
  role?: Role;
  factoryId?: string;
  fulfillmentStage?: string;
}

interface FormState {
  open: boolean;
  mode: 'create' | 'edit';
  id?: string;
  fullName: string;
  email: string;
  password: string;
  roleId: string;
  factoryId: string;
  fulfillmentStage: string;
}

interface FactoryRow {
  _id: string;
  name: string;
  shortName?: string;
}

const EMPTY_FORM: FormState = {
  open: false,
  mode: 'create',
  fullName: '',
  email: '',
  password: '',
  roleId: '',
  factoryId: '',
  fulfillmentStage: '',
};

// Auto-derive từ shared enum để khi thêm/đổi stage 1 chỗ — UI tự cập nhật.
function buildFulfillmentStageOptions(t: TFunction): { value: string; label: string }[] {
  return FULFILLMENT_STAGES.map((s) => ({
    value: s,
    label: getStageLabel(t, s),
  }));
}

export default function UsersPage() {
  const { t } = useTranslation(['auth', 'common']);
  const fulfillmentStageOptions = useMemo(() => buildFulfillmentStageOptions(t), [t]);
  const [items, setItems] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [factories, setFactories] = useState<FactoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Server total, to tell the user when the 200-row page does not cover everyone.
  const [serverTotal, setServerTotal] = useState(0);
  // Default view = active staff: deactivated accounts are noise for daily HR work (MenuRestructure-CEO.md §8.1).
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [roleFilter, setRoleFilter] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const roleMap = useMemo(() => Object.fromEntries(roles.map((r) => [r._id, r])), [roles]);
  const factoryMap = useMemo(() => Object.fromEntries(factories.map((f) => [f._id, f])), [factories]);
  /** True nếu role được chọn trong form là Fulfillment → bắt buộc nhập factoryId. */
  const isFulfillmentRole = useMemo(() => {
    const r = roleMap[form.roleId];
    return r?.name === 'Fulfillment';
  }, [roleMap, form.roleId]);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [uRes, rRes, fRes] = await Promise.all([
        RepositoryRemote.users.getUsers('?page=1&limit=200'),
        RepositoryRemote.roles.getRoles('?page=1&limit=50'),
        RepositoryRemote.factory.getFactories('?page=1&limit=200'),
      ]);
      setItems((uRes.data?.data || []) as UserRow[]);
      setServerTotal(Number(uRes.data?.total ?? 0));
      setRoles((rRes.data?.data || []) as Role[]);
      setFactories((fRes.data?.data || []) as FactoryRow[]);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const counts = useMemo(() => {
    const active = items.filter((i) => i.status === Status.Active).length;
    return { active, inactive: items.length - active, all: items.length };
  }, [items]);

  const displayed = useMemo(
    () =>
      items.filter((i) => {
        if (statusFilter === 'active' && i.status !== Status.Active) return false;
        if (statusFilter === 'inactive' && i.status === Status.Active) return false;
        return !roleFilter || i.roleId === roleFilter;
      }),
    [items, statusFilter, roleFilter],
  );

  const openCreate = () => {
    setShowPassword(false);
    setForm({ ...EMPTY_FORM, open: true, mode: 'create', roleId: roles[0]?._id || '' });
  };

  const openEdit = (it: UserRow) => {
    setShowPassword(false);
    setForm({
      open: true,
      mode: 'edit',
      id: it._id,
      fullName: it.fullName,
      email: it.email,
      password: '',
      roleId: it.roleId || '',
      factoryId: it.factoryId || '',
      fulfillmentStage: it.fulfillmentStage || '',
    });
  };

  const handleSubmit = async () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.roleId) {
      toast.error(t('users.validation.requiredFields'));
      return;
    }
    if (form.mode === 'create' && form.password.length < 8) {
      toast.error(t('users.validation.passwordMin'));
      return;
    }
    // Edit mode: password optional. Nếu nhập → validate min 8 ký tự, sau khi
    // update user thành công sẽ gọi /reset-password riêng.
    if (form.mode === 'edit' && form.password && form.password.length < 8) {
      toast.error(t('users.validation.passwordMinEdit'));
      return;
    }
    if (isFulfillmentRole && !form.factoryId) {
      toast.error(t('users.validation.factoryRequired'));
      return;
    }
    if (isFulfillmentRole && !form.fulfillmentStage) {
      toast.error(t('users.validation.stageRequired'));
      return;
    }
    try {
      setSaving(true);
      if (form.mode === 'create') {
        await RepositoryRemote.users.createUser({
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          roleId: form.roleId,
          otherPermissionIds: [],
          factoryId: form.factoryId || undefined,
          fulfillmentStage: form.fulfillmentStage || undefined,
        } as any);
        toast.success(t('users.toasts.created'));
      } else if (form.id) {
        await RepositoryRemote.users.adminUpdateUser(form.id, {
          fullName: form.fullName,
          email: form.email,
          roleId: form.roleId,
          factoryId: form.factoryId || undefined,
          fulfillmentStage: form.fulfillmentStage || undefined,
        } as any);
        // Optional reset password — chỉ gọi khi user nhập password mới.
        if (form.password) {
          await RepositoryRemote.users.resetPassword({ password: form.password }, form.id);
          toast.success(t('users.toasts.updatedWithPassword'));
        } else {
          toast.success(t('users.toasts.updated'));
        }
      }
      setForm(EMPTY_FORM);
      fetchAll();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await RepositoryRemote.users.adminDeleteUser(confirmDelete._id!);
      toast.success(t('users.toasts.deleted'));
      setConfirmDelete(null);
      fetchAll();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const handleToggle = async (it: UserRow) => {
    try {
      await RepositoryRemote.users.toggleActive(it._id!);
      toast.success(t('users.toasts.statusToggled'));
      fetchAll();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<UsersIcon size={20} />}
        title={t('users.title')}
        description={t('users.subtitle')}
      />

      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-border">
          <p className="text-xs text-muted-foreground">{t('users.userCount', { count: displayed.length })}</p>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            {(['active', 'inactive', 'all'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  statusFilter === k
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`users.statusFilters.${k}`)} ({counts[k]})
              </button>
            ))}
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label={t('users.table.role')}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">{t('users.allRoles')}</option>
            {roles.map((r) => (
              <option key={r._id} value={r._id}>
                {r.name}
              </option>
            ))}
          </select>
          {serverTotal > items.length && (
            <span className="text-xs text-amber-600">
              {t('users.truncated', { shown: items.length, total: serverTotal })}
            </span>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              {t('users.reload')}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} /> {t('users.addUser')}
            </Button>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} className="text-muted-foreground" />
          </div>
        ) : (
          <ResponsiveList
            className="max-md:p-3"
            rows={displayed}
            rowKey={(it) => it._id}
            empty={t('users.noUsers')}
            columns={[
              {
                key: 'fullName',
                header: t('users.table.fullName'),
                mobile: 'title',
                cell: (it) => <span className="font-medium">{it.fullName}</span>,
              },
              {
                key: 'email',
                header: t('users.table.email'),
                mobile: 'subtitle',
                cell: (it) => <span className="break-words text-muted-foreground">{it.email}</span>,
              },
              {
                key: 'role',
                header: t('users.table.role'),
                cell: (it) => {
                  const role = it.role || roleMap[it.roleId || ''];
                  const factory = it.factoryId ? factoryMap[it.factoryId] : undefined;
                  return (
                    <div className="flex flex-wrap items-center gap-1">
                      {role ? (
                        <Badge variant="outline">{role.name}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                      {factory && role?.name === 'Fulfillment' && (
                        <Badge variant="secondary" className="text-[10px]">
                          {factory.shortName || factory.name}
                        </Badge>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'status',
                header: t('users.table.status'),
                className: 'w-28',
                cell: (it) => (
                  <div className="flex items-center gap-2">
                    <Switch checked={it.status === Status.Active} onCheckedChange={() => handleToggle(it)} />
                    <span className="text-xs text-muted-foreground">
                      {it.status === Status.Active ? t('users.statusOn') : t('users.statusOff')}
                    </span>
                  </div>
                ),
              },
              {
                key: 'actions',
                header: '',
                className: 'w-32 text-right',
                cell: (it) => (
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" aria-label={t('users.editTitle')} onClick={() => openEdit(it)}>
                      <Pencil size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(it)}>
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>

      <Dialog open={form.open} onOpenChange={(open) => !open && setForm(EMPTY_FORM)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.mode === 'create' ? t('users.createTitle') : t('users.editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('users.fullNameLabel')}</Label>
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder={t('users.fullNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('users.emailLabel')}</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder={t('users.emailPlaceholder')}
                type="email"
              />
            </div>
            <div className="space-y-2">
              <Label>{form.mode === 'create' ? t('users.passwordLabel') : t('users.resetPasswordLabel')}</Label>
              <div className="relative">
                <Input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={
                    form.mode === 'create' ? t('users.passwordPlaceholderCreate') : t('users.passwordPlaceholderEdit')
                  }
                  className="pr-9"
                  autoComplete={form.mode === 'create' ? 'new-password' : 'off'}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? t('users.hidePassword') : t('users.showPassword')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {form.mode === 'edit' && form.password && (
                <p className="text-[11px] text-amber-600">{t('users.passwordOverwriteNote')}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('users.roleLabel')}</Label>
              <select
                value={form.roleId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    roleId: e.target.value,
                    // Khi đổi role ≠ Fulfillment thì clear factoryId tránh data thừa.
                    factoryId: roleMap[e.target.value]?.name === 'Fulfillment' ? form.factoryId : '',
                  })
                }
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {roles.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            {isFulfillmentRole && (
              <>
                <div className="space-y-2">
                  <Label>{t('users.factoryLabel')}</Label>
                  <select
                    value={form.factoryId}
                    onChange={(e) => setForm({ ...form, factoryId: e.target.value })}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">{t('users.selectFactory')}</option>
                    {factories.map((f) => (
                      <option key={f._id} value={f._id}>
                        {f.name}
                        {f.shortName ? ` (${f.shortName})` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">{t('users.factoryNote')}</p>
                </div>
                <div className="space-y-2">
                  <Label>{t('users.stageLabel')}</Label>
                  <select
                    value={form.fulfillmentStage}
                    onChange={(e) => setForm({ ...form, fulfillmentStage: e.target.value })}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">{t('users.selectStage')}</option>
                    {fulfillmentStageOptions.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">{t('users.stageNote')}</p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(EMPTY_FORM)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Spinner size={14} className="mr-2" />}
              {t('actions.save', { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.deleteTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <Trans
              i18nKey="users.deleteConfirm"
              ns="auth"
              values={{ name: confirmDelete?.fullName, email: confirmDelete?.email }}
              components={{ b: <span className="font-medium text-foreground" /> }}
            />
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('actions.delete', { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
