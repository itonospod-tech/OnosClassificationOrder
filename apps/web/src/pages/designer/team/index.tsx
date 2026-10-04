import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { KeyRound, Palette, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { DesignerTeamMember } from 'shared';
import { Status } from 'shared';
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
import { cn } from '@/utils/cn';

import { type DialogMode, TeamMemberDialog } from './TeamMemberDialog';

interface DialogState {
  open: boolean;
  mode: DialogMode;
  member: DesignerTeamMember | null;
}

const EMPTY_DIALOG: DialogState = { open: false, mode: 'create', member: null };

type StatusFilter = 'active' | 'inactive' | 'all';

function buildStatusFilters(t: TFunction<'designerTaskWorkflow'>): { key: StatusFilter; label: string }[] {
  return [
    { key: 'active', label: t('team.statusFilters.active') },
    { key: 'inactive', label: t('team.statusFilters.inactive') },
    { key: 'all', label: t('team.statusFilters.all') },
  ];
}

export default function DesignerTeamPage() {
  const { t } = useTranslation(['designerTaskWorkflow', 'common']);
  const statusFilters = useMemo(() => buildStatusFilters(t), [t]);
  const [items, setItems] = useState<DesignerTeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  // Mặc định chỉ hiện designer đang bật. Chọn "Đã tắt" để xem + thống kê người
  // đã tắt (số task đang làm/đã xong vẫn hiện trên từng dòng).
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [dialog, setDialog] = useState<DialogState>(EMPTY_DIALOG);
  const [confirmDelete, setConfirmDelete] = useState<DesignerTeamMember | null>(null);
  const [resetTarget, setResetTarget] = useState<DesignerTeamMember | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetting, setResetting] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const res = await RepositoryRemote.designer.listTeam();
      setItems((res.data?.data || []) as DesignerTeamMember[]);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const totals = useMemo(() => {
    const active = items.filter((i) => i.status === Status.Active).length;
    const inactive = items.length - active;
    // Task active toàn team CHỈ tính người đang bật (đúng "thống kê chỉ active").
    const totalActiveTasks = items
      .filter((i) => i.status === Status.Active)
      .reduce((s, i) => s + (i.activeTaskCount ?? 0), 0);
    return { active, inactive, totalActiveTasks };
  }, [items]);

  // Lọc client-side theo trạng thái (fetch luôn tải tất cả để thẻ thống kê chính xác).
  const displayed = useMemo(() => {
    if (statusFilter === 'active') return items.filter((i) => i.status === Status.Active);
    if (statusFilter === 'inactive') return items.filter((i) => i.status !== Status.Active);
    return items;
  }, [items, statusFilter]);

  const openCreate = () => setDialog({ open: true, mode: 'create', member: null });
  const openEdit = (m: DesignerTeamMember) => setDialog({ open: true, mode: 'edit', member: m });

  const handleToggle = async (m: DesignerTeamMember) => {
    try {
      await RepositoryRemote.designer.updateMember(m._id, {
        status: m.status === Status.Active ? Status.Inactive : Status.Active,
      });
      toast.success(t('team.toggled'));
      fetchAll();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await RepositoryRemote.designer.removeMember(confirmDelete._id);
      toast.success(t('team.deleted'));
      setConfirmDelete(null);
      fetchAll();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    if (resetPwd.length < 8) {
      toast.error(t('team.passwordTooShort'));
      return;
    }
    try {
      setResetting(true);
      await RepositoryRemote.designer.resetPassword(resetTarget._id, { password: resetPwd });
      toast.success(t('team.resetDone', { name: resetTarget.fullName }));
      setResetTarget(null);
      setResetPwd('');
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Palette size={20} />}
        title={t('team.title')}
        description={t('team.subtitle')}
      />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('team.stats.active')} value={totals.active} accent="text-emerald-600" />
        <StatCard label={t('team.stats.inactive')} value={totals.inactive} accent="text-zinc-500" />
        <StatCard label={t('team.stats.totalActiveTasks')} value={totals.totalActiveTasks} accent="text-indigo-600" />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground">{t('team.memberCount', { count: displayed.length })}</p>
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              {statusFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    statusFilter === f.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              {t('team.reload')}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} /> {t('team.addMember')}
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
            empty={
              items.length === 0 ? (
                <>
                  {t('team.emptyNoMembersPrefix')} <strong>{t('team.emptyNoMembersAction')}</strong>{' '}
                  {t('team.emptyNoMembersSuffix')}
                </>
              ) : (
                <>{t('team.emptyFiltered')}</>
              )
            }
            columns={[
              {
                key: 'fullName',
                header: t('team.table.fullName'),
                mobile: 'title',
                cell: (it) => (
                  <span className={cn('font-medium', it.status !== Status.Active && 'opacity-60')}>{it.fullName}</span>
                ),
              },
              {
                key: 'email',
                header: t('team.table.email'),
                mobile: 'subtitle',
                cell: (it) => (
                  <span className={cn('break-words text-muted-foreground', it.status !== Status.Active && 'opacity-60')}>
                    {it.email}
                  </span>
                ),
              },
              {
                key: 'active',
                header: t('team.table.active'),
                className: 'w-24 text-center',
                cell: (it) =>
                  (it.activeTaskCount ?? 0) > 0 ? (
                    <Badge variant="default" className="bg-indigo-500 hover:bg-indigo-500">
                      {it.activeTaskCount}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">0</span>
                  ),
              },
              {
                key: 'done',
                header: t('team.table.done'),
                className: 'w-24 text-center',
                cell: (it) => <span className="text-xs text-muted-foreground">{it.completedTaskCount}</span>,
              },
              {
                key: 'hireDate',
                header: t('team.table.hireDate'),
                className: 'w-32',
                cell: (it) => (
                  <span className="text-xs text-muted-foreground">
                    {it.hireDate ? new Date(it.hireDate).toLocaleDateString('vi-VN') : '—'}
                  </span>
                ),
              },
              {
                key: 'status',
                header: t('team.table.status'),
                className: 'w-28',
                cell: (it) => (
                  <div className="flex items-center gap-2">
                    <Switch checked={it.status === Status.Active} onCheckedChange={() => handleToggle(it)} />
                    <span className="text-xs text-muted-foreground">
                      {it.status === Status.Active ? t('team.statusOn') : t('team.statusOff')}
                    </span>
                  </div>
                ),
              },
              {
                key: 'actions',
                header: '',
                className: 'w-40 text-right',
                cell: (it) => (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setResetTarget(it)}
                      title={t('team.resetPasswordTitle')}
                    >
                      <KeyRound size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(it)} title={t('common:actions.edit')}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(it)}
                      title={t('common:actions.delete')}
                      disabled={(it.activeTaskCount ?? 0) > 0}
                    >
                      <Trash2
                        size={14}
                        className={(it.activeTaskCount ?? 0) > 0 ? 'text-muted-foreground' : 'text-destructive'}
                      />
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>

      <TeamMemberDialog
        open={dialog.open}
        mode={dialog.mode}
        member={dialog.member}
        onClose={() => setDialog(EMPTY_DIALOG)}
        onSaved={fetchAll}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('team.deleteDialog.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('team.deleteDialog.prefix')} <span className="font-medium text-foreground">{confirmDelete?.fullName}</span>{' '}
            ({confirmDelete?.email}){t('team.deleteDialog.suffix')}
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

      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && (setResetTarget(null), setResetPwd(''))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('team.resetDialog.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('team.resetDialog.prefix')} <span className="font-medium text-foreground">{resetTarget?.fullName}</span>
            {t('team.resetDialog.suffix')}
          </p>
          <div className="space-y-2">
            <Label>{t('team.resetDialog.newPasswordLabel')}</Label>
            <Input
              type="text"
              className="font-mono"
              value={resetPwd}
              onChange={(e) => setResetPwd(e.target.value)}
              placeholder={t('team.resetDialog.newPasswordPlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResetTarget(null);
                setResetPwd('');
              }}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleResetPassword} disabled={resetting}>
              {resetting && <Spinner size={14} className="mr-2" />}
              {t('team.resetDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}
