import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react';
import type { Role } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { useConfirm } from '@/components/common/ConfirmDialog';
import { PageHeader } from '@/components/common/PageHeader';
import { ResponsiveList } from '@/components/common/ResponsiveList';
import { Spinner } from '@/components/common/Spinner';
import { PermissionMatrix } from '@/components/roles/PermissionMatrix';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { handleAxiosError } from '@/utils';

export default function RolesPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { confirm, confirmDialog } = useConfirm();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [draftCodes, setDraftCodes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const res = await RepositoryRemote.roles.getRoles('?page=1&limit=50');
      setRoles((res.data?.data || []) as Role[]);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const openEditor = (role: Role) => {
    setEditing(role);
    setDraftCodes(role.permissionCodes || []);
  };

  const close = () => {
    setEditing(null);
    setDraftCodes([]);
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      setSaving(true);
      await RepositoryRemote.roles.updatePermissions(editing._id!, { codes: draftCodes });
      toast.success(t('roles.toasts.saveSuccess'));
      await fetchAll();
      close();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!editing) return;
    if (!(await confirm({ title: t('roles.resetConfirm'), destructive: true }))) return;
    try {
      const res = await RepositoryRemote.roles.resetPermissions(editing._id!);
      toast.success(t('roles.toasts.resetSuccess'));
      const fresh = res.data?.data as Role;
      setDraftCodes(fresh?.permissionCodes || []);
      await fetchAll();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      <PageHeader icon={<ShieldCheck size={20} />} title={t('roles.title')} description={t('roles.subtitle')} />

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <p className="text-xs text-muted-foreground">{t('roles.roleCount', { count: roles.length })}</p>
          <Button variant="ghost" size="sm" onClick={fetchAll} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {t('roles.reload')}
          </Button>
        </div>

        {/* Table on wide screens, tappable cards on phones (ResponsiveList). */}
        {loading && roles.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} className="text-muted-foreground" />
          </div>
        ) : (
          <ResponsiveList
            className="p-3 md:p-0"
            rows={roles}
            rowKey={(r) => r._id ?? r.name}
            onRowClick={openEditor}
            empty={t('roles.noRoles')}
            columns={[
              {
                key: 'name',
                header: t('roles.table.role'),
                cell: (r) => <span className="font-medium">{r.name}</span>,
                mobile: 'title',
              },
              {
                key: 'description',
                header: t('roles.table.description'),
                cell: (r) => <span className="text-sm text-muted-foreground">{r.description || '—'}</span>,
                mobile: 'subtitle',
              },
              {
                key: 'permissions',
                header: t('roles.table.permissions'),
                cell: (r) => <Badge variant="outline">{r.permissionCodes?.length || 0}</Badge>,
                mobile: 'trailing',
                className: 'w-24 text-center',
              },
              {
                key: 'system',
                header: t('roles.table.system'),
                cell: (r) => r.isSystem && <Badge variant="secondary">{t('roles.table.system')}</Badge>,
                mobile: 'trailing',
                className: 'w-20',
              },
              {
                // The whole row / card already opens the editor; the explicit button is for the table only.
                key: 'edit',
                header: '',
                cell: (r) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditor(r);
                    }}
                  >
                    {t('actions.edit', { ns: 'common' })}
                  </Button>
                ),
                mobile: 'hidden',
                className: 'w-20 text-right',
              },
            ]}
          />
        )}
      </div>

      <Sheet open={!!editing} onOpenChange={(open) => !open && close()}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between">
              <span>{editing?.name}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t('roles.selectedCount', { count: draftCodes.length })}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-2 text-sm">
            {editing?.description && <p className="text-muted-foreground">{editing.description}</p>}
            {editing?.isSystem && <p className="text-xs text-muted-foreground">{t('roles.systemRoleNote')}</p>}
          </div>

          <div className="mt-6">
            <PermissionMatrix value={draftCodes} onChange={setDraftCodes} />
          </div>

          <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-background border-t border-border mt-6 flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} disabled={!editing?.isSystem}>
              <RotateCcw size={13} />
              {t('roles.resetPreset')}
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={close}>
                <X size={14} /> {t('actions.cancel', { ns: 'common' })}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving && <Spinner size={13} className="mr-1.5" />}
                {t('actions.save', { ns: 'common' })}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
