import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Flag, RefreshCw, Save } from 'lucide-react';
import type { Customer, CustomerPriorityConfig as Config } from 'shared';
import { ORDER_PRIORITIES } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { useConfirm } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/common/Spinner';
import { buildPriorityMeta } from '@/components/orders/cells/PrioritySelectCell';
import CustomerFactoryKanban from '@/components/settings/CustomerFactoryKanban';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

import { handleAxiosError } from '@/utils';

type AllocState = Record<string, string[]>; // String(priority) → customerIds[]

/** Snapshot ổn định (sort ids, bỏ mức rỗng) để so sánh dirty — thứ tự trong cột không có ý nghĩa. */
function snapshot(enabled: boolean, alloc: AllocState): string {
  const norm = Object.fromEntries(
    Object.entries(alloc)
      .map(([p, ids]) => [p, [...ids].sort()] as const)
      .filter(([, ids]) => ids.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({ enabled, alloc: norm });
}

export default function CustomerPriorityConfig() {
  const { t } = useTranslation(['customerPriority', 'common']);
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirm();
  // Label + màu 3 mức lấy từ dictionary priority sẵn có (namespace `orders`).
  const { t: tOrders } = useTranslation('orders');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [alloc, setAlloc] = useState<AllocState>({});
  const [enabled, setEnabled] = useState(false);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const priorityMeta = useMemo(() => buildPriorityMeta(tOrders), [tOrders]);
  const columns = useMemo(
    () =>
      ORDER_PRIORITIES.map((p) => ({
        id: String(p),
        title: priorityMeta[p].label,
        icon: <Flag size={15} style={{ color: priorityMeta[p].dot }} />,
      })),
    [priorityMeta],
  );

  const loadCustomers = async () => {
    const res = await RepositoryRemote.customer.list();
    setCustomers((res.data?.data || []) as Customer[]);
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const cfgRes = await RepositoryRemote.customerAssignment.getPriorityConfig();
        await loadCustomers();
        const cfg = (cfgRes.data?.data || { enabled: false, levels: [] }) as Config;
        setEnabled(!!cfg.enabled);
        const next: AllocState = {};
        for (const level of cfg.levels || []) {
          next[String(level.priority)] = (level.customerIds || []).map(String);
        }
        setAlloc(next);
        setBaseline(snapshot(!!cfg.enabled, next));
      } catch (err) {
        // Load hỏng (403/network) → chốt baseline theo state hiện tại, nếu không
        // trang lập tức tự bật cờ "• Chưa lưu" và chặn rời trang dù chưa thao tác gì.
        setBaseline(snapshot(false, {}));
        handleAxiosError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty = useMemo(() => !loading && snapshot(enabled, alloc) !== baseline, [loading, enabled, alloc, baseline]);

  // Kéo thả kanban: gỡ khách khỏi mọi cột rồi thêm vào cột đích (null = "Chưa gán")
  // → tự đảm bảo 1 khách 1 mức ưu tiên.
  const moveCustomer = (customerId: string, targetPriority: string | null) => {
    setAlloc((prev) => {
      const next: AllocState = {};
      for (const [p, ids] of Object.entries(prev)) next[p] = ids.filter((id) => id !== customerId);
      if (targetPriority) next[targetPriority] = [...(next[targetPriority] || []), customerId];
      return next;
    });
  };

  // Guard thoát khi có thay đổi chưa lưu — cùng pattern CustomerAssignmentConfig.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClickCapture = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;
      // Dialog hệ thống là async → chặn điều hướng NGAY (đồng bộ), hỏi xong
      // mới tự đi tiếp. `window.confirm` cũ chặn cả tab nên không cần bước này.
      e.preventDefault();
      e.stopPropagation();
      void confirm({ title: t('leaveConfirm'), destructive: true }).then((ok) => {
        if (ok) navigate(href);
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [dirty, t, confirm, navigate]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      const res = await RepositoryRemote.customer.sync();
      const d = res.data?.data as { created: number; total: number };
      await loadCustomers();
      toast.success(t('toasts.syncSuccess', { created: d?.created ?? 0, total: d?.total ?? 0 }));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    const payload: Config = {
      enabled,
      levels: ORDER_PRIORITIES.map((p) => ({ priority: p, customerIds: alloc[String(p)] || [] })).filter(
        (l) => l.customerIds.length > 0,
      ),
    };
    try {
      setSaving(true);
      await RepositoryRemote.customerAssignment.savePriorityConfig(payload);
      setBaseline(snapshot(enabled, alloc));
      toast.success(t('toasts.saveSuccess'));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size={20} className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-rose-100 dark:bg-rose-500/15 flex items-center justify-center">
            <Flag size={18} className="text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('title')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">
              ● {t('unsavedBadge')}
            </span>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size={13} className="mr-1.5" /> : <Save size={14} />}
            {t('actions.save', { ns: 'common' })}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {enabled ? t('enabledOn') : t('enabledOff')}
          </span>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
          {syncing ? <Spinner size={13} className="mr-1.5" /> : <RefreshCw size={14} />}
          {t('syncCustomers')}
        </Button>
        <span className="text-xs text-slate-400">{t('customerCount', { count: customers.length })}</span>
      </div>

      <CustomerFactoryKanban columns={columns} customers={customers} alloc={alloc} onMove={moveCustomer} />
    </div>
  );
}
