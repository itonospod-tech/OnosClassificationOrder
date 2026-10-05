import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Factory as FactoryIcon, Plus, Save, Trash2, Users } from 'lucide-react';
import type { Customer, DesignerAssignmentConfig as Config } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import type { DesignerAssignItem } from '@/components/settings/DesignerAssignKanban';
import DesignerAssignKanban from '@/components/settings/DesignerAssignKanban';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';

interface FactoryLite {
  _id: string;
  name: string;
  shortName?: string;
}
interface DesignerLite {
  _id: string;
  fullName: string;
}
interface ProductLite {
  _id: string;
  fullName: string;
  shortName?: string;
  mockup?: string;
}
type AllocEntry = { designerId: string; weight: number };
type AllocState = Record<string, AllocEntry[]>;
type IdAllocState = Record<string, string[]>; // designerId → itemIds

function PriorityHeading({ order, title, subtitle }: { order: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-xs font-bold flex items-center justify-center">
        {order}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}

export default function DesignerAssignmentConfig() {
  const { t } = useTranslation(['designerAutoAssign', 'common']);
  const [factories, setFactories] = useState<FactoryLite[]>([]);
  const [designers, setDesigners] = useState<DesignerLite[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [alloc, setAlloc] = useState<AllocState>({});
  const [customerAlloc, setCustomerAlloc] = useState<IdAllocState>({});
  const [productAlloc, setProductAlloc] = useState<IdAllocState>({});
  // Hạn hiệu lực mapping sản phẩm (từ nút "Ghi nhớ cấu hình" ở Dashboard):
  // productConfigId → ISO date. Kéo thả card sản phẩm = quyết định lại bằng tay
  // → xóa hạn (thành vĩnh viễn / bỏ gán).
  const [productExpiries, setProductExpiries] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);

  // Snapshot MỚI NHẤT của cả 3 cấu hình cho auto-save: cập nhật ĐỒNG BỘ ngay lúc
  // kéo thả (setState của React commit sau, chuỗi save có thể chạy trước render).
  const latestRef = useRef<{
    customers: IdAllocState;
    products: IdAllocState;
    factories: AllocState;
    productExpiries: Record<string, string>;
  }>({
    customers: {},
    products: {},
    factories: {},
    productExpiries: {},
  });
  // Chuỗi hóa các lần auto-save để nhiều lần kéo liên tiếp không đè nhau sai thứ tự.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [facRes, desRes, cfgRes, cusRes, prodRes] = await Promise.all([
          RepositoryRemote.factory.getFactories('?page=1&limit=200'),
          RepositoryRemote.designer.listTeam('1'), // Status.Active = '1'
          RepositoryRemote.designerAssignment.getConfig(),
          RepositoryRemote.customer.list(),
          RepositoryRemote.productConfig.getProductConfigs('?page=1&limit=5000'),
        ]);
        const facs = (facRes.data?.data || []) as FactoryLite[];
        const dess = (desRes.data?.data || []) as DesignerLite[];
        const cfg = (cfgRes.data?.data || { customers: [], products: [], factories: [] }) as Config;
        setFactories(facs);
        setDesigners(dess);
        setCustomers((cusRes.data?.data || []) as Customer[]);
        setProducts((prodRes.data?.data || []) as ProductLite[]);
        const next: AllocState = {};
        for (const f of cfg.factories || []) {
          next[String(f.factoryId)] = (f.designers || []).map((d) => ({
            designerId: String(d.designerId),
            weight: Number(d.weight) || 0,
          }));
        }
        setAlloc(next);
        const nextCus: IdAllocState = {};
        for (const c of cfg.customers || []) nextCus[String(c.designerId)] = (c.customerIds || []).map(String);
        setCustomerAlloc(nextCus);
        const nextProd: IdAllocState = {};
        for (const p of cfg.products || []) nextProd[String(p.designerId)] = (p.productConfigIds || []).map(String);
        setProductAlloc(nextProd);
        const nextExp = cfg.productExpiries || {};
        setProductExpiries(nextExp);
        latestRef.current = { customers: nextCus, products: nextProd, factories: next, productExpiries: nextExp };
      } catch (err) {
        handleAxiosError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const designerById = useMemo(() => new Map(designers.map((d) => [d._id, d])), [designers]);
  const factoryById = useMemo(() => new Map(factories.map((f) => [f._id, f])), [factories]);

  const customerItems = useMemo<DesignerAssignItem[]>(
    () =>
      customers.map((c) => ({
        id: String(c._id),
        title: c.userSku || c.userEmail || String(c._id),
        subtitle: c.userSku ? c.userEmail : undefined,
        tier: c.tier ?? null,
      })),
    [customers],
  );

  const productItems = useMemo<DesignerAssignItem[]>(
    () =>
      products.map((p) => ({
        id: String(p._id),
        title: p.fullName,
        subtitle: p.shortName,
        mockup: p.mockup,
        expiryLabel: productExpiries[String(p._id)]
          ? t('kanban.expiresAt', { date: dayjs(productExpiries[String(p._id)]).format('DD/MM HH:mm') })
          : undefined,
      })),
    [products, productExpiries, t],
  );

  const buildPayload = (
    cus: IdAllocState,
    prod: IdAllocState,
    fac: AllocState,
    exp: Record<string, string>,
  ): Config => ({
    customers: designers
      .map((d) => ({ designerId: d._id, customerIds: cus[d._id] || [] }))
      .filter((c) => c.customerIds.length > 0),
    products: designers
      .map((d) => ({ designerId: d._id, productConfigIds: prod[d._id] || [] }))
      .filter((p) => p.productConfigIds.length > 0),
    factories: factories
      .map((f) => ({
        factoryId: f._id,
        designers: (fac[f._id] || []).map((e) => ({
          designerId: e.designerId,
          weight: Number.isFinite(e.weight) ? e.weight : 0,
        })),
      }))
      .filter((f) => f.designers.length > 0),
    productExpiries: exp,
  });

  // Kéo thả kanban: gỡ item khỏi mọi cột, thêm vào cột đích (null = Chưa gán),
  // rồi LƯU NGAY (không cần bấm Lưu) — payload lấy từ latestRef nên nhiều lần
  // kéo liên tiếp gửi đúng snapshot mới nhất theo thứ tự.
  const moveItem = (kind: 'customers' | 'products') => {
    return (itemId: string, targetDesignerId: string | null) => {
      const cur = latestRef.current[kind];
      const next: IdAllocState = {};
      for (const [did, ids] of Object.entries(cur)) next[did] = ids.filter((id) => id !== itemId);
      if (targetDesignerId) next[targetDesignerId] = [...(next[targetDesignerId] || []), itemId];
      latestRef.current = { ...latestRef.current, [kind]: next };
      (kind === 'customers' ? setCustomerAlloc : setProductAlloc)(next);
      if (kind === 'products' && latestRef.current.productExpiries[itemId]) {
        // Kéo tay = quyết định lại → mapping trở thành vĩnh viễn (hoặc bỏ gán).
        const { [itemId]: _removed, ...restExp } = latestRef.current.productExpiries;
        latestRef.current = { ...latestRef.current, productExpiries: restExp };
        setProductExpiries(restExp);
      }
      saveChainRef.current = saveChainRef.current.then(async () => {
        try {
          setAutoSaving(true);
          const { customers: cus, products: prod, factories: fac, productExpiries: exp } = latestRef.current;
          await RepositoryRemote.designerAssignment.saveConfig(buildPayload(cus, prod, fac, exp));
        } catch (err) {
          handleAxiosError(err);
        } finally {
          setAutoSaving(false);
        }
      });
    };
  };

  // Sửa trọng số/danh sách mức 3 → đồng bộ vào snapshot để lần kéo thả kế tiếp
  // auto-save không ghi đè bằng dữ liệu cũ.
  useEffect(() => {
    latestRef.current.factories = alloc;
  }, [alloc]);

  // designerId → tên xưởng đang giữ (để chặn 1 designer ở nhiều xưởng).
  const designerFactory = useMemo(() => {
    const m = new Map<string, string>();
    for (const [factoryId, entries] of Object.entries(alloc)) {
      for (const e of entries) m.set(e.designerId, factoryId);
    }
    return m;
  }, [alloc]);

  const addDesigner = (factoryId: string, designerId: string) => {
    if (!designerId) return;
    setAlloc((prev) => {
      const cur = prev[factoryId] || [];
      if (cur.some((e) => e.designerId === designerId)) return prev;
      return { ...prev, [factoryId]: [...cur, { designerId, weight: 1 }] };
    });
  };

  const removeDesigner = (factoryId: string, designerId: string) => {
    setAlloc((prev) => ({
      ...prev,
      [factoryId]: (prev[factoryId] || []).filter((e) => e.designerId !== designerId),
    }));
  };

  const setWeight = (factoryId: string, designerId: string, weight: number) => {
    setAlloc((prev) => ({
      ...prev,
      [factoryId]: (prev[factoryId] || []).map((e) => (e.designerId === designerId ? { ...e, weight } : e)),
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await RepositoryRemote.designerAssignment.saveConfig(
        buildPayload(customerAlloc, productAlloc, alloc, productExpiries),
      );
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center">
            <Users size={18} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('title')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {autoSaving && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Spinner size={12} />
              {t('autoSaving')}
            </span>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size={13} className="mr-1.5" /> : <Save size={14} />}
            {t('actions.save', { ns: 'common' })}
          </Button>
        </div>
      </div>

      {/* Ưu tiên 1 — Khách hàng → Designer */}
      <div className="space-y-3">
        <PriorityHeading order={1} title={t('priority1.title')} subtitle={t('priority1.subtitle')} />
        {designers.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('noDesignersAvailable')}</p>
        ) : (
          <DesignerAssignKanban
            designers={designers}
            items={customerItems}
            alloc={customerAlloc}
            onMove={moveItem('customers')}
            searchPlaceholder={t('kanban.searchCustomerPlaceholder')}
          />
        )}
      </div>

      {/* Ưu tiên 2 — Sản phẩm → Designer */}
      <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-700/60">
        <PriorityHeading order={2} title={t('priority2.title')} subtitle={t('priority2.subtitle')} />
        {designers.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('noDesignersAvailable')}</p>
        ) : (
          <DesignerAssignKanban
            designers={designers}
            items={productItems}
            alloc={productAlloc}
            onMove={moveItem('products')}
            searchPlaceholder={t('kanban.searchProductPlaceholder')}
          />
        )}
      </div>

      {/* Ưu tiên 3 — Theo xưởng */}
      <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-700/60">
        <PriorityHeading order={3} title={t('priority3.title')} subtitle={t('priority3.subtitle')} />

        {factories.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{t('noFactories')}</p>}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {factories.map((f) => {
            const entries = alloc[f._id] || [];
            const totalWeight = entries.reduce((s, e) => s + (e.weight > 0 ? e.weight : 0), 0);
            // Option "thêm designer": chưa ở xưởng này. Designer đang ở xưởng khác
            // → disabled + ghi chú.
            const inThis = new Set(entries.map((e) => e.designerId));
            return (
              <div
                key={f._id}
                className="rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-4 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <FactoryIcon size={16} className="text-sky-600 dark:text-sky-400" />
                  <span className="font-medium text-slate-800 dark:text-slate-100">{f.name}</span>
                  {f.shortName && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500">
                      {f.shortName}
                    </span>
                  )}
                </div>

                {entries.length === 0 && <p className="text-xs text-slate-400">{t('noDesigners')}</p>}

                <div className="space-y-1.5">
                  {entries.map((e) => {
                    const d = designerById.get(e.designerId);
                    const pct = totalWeight > 0 ? Math.round(((e.weight > 0 ? e.weight : 0) / totalWeight) * 100) : 0;
                    return (
                      <div key={e.designerId} className="flex items-center gap-2">
                        <span className="flex-1 text-sm truncate text-slate-700 dark:text-slate-200">
                          {d?.fullName || `#${e.designerId.slice(-4)}`}
                        </span>
                        <Input
                          type="number"
                          min={0}
                          value={e.weight}
                          onChange={(ev) => setWeight(f._id, e.designerId, Number(ev.target.value))}
                          className="w-16 h-8 text-sm"
                        />
                        <span className="w-10 text-right text-xs tabular-nums text-slate-500">{pct}%</span>
                        <button
                          type="button"
                          onClick={() => removeDesigner(f._id, e.designerId)}
                          className="text-slate-400 hover:text-rose-500 transition-colors"
                          title={t('removeFromFactory')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-700/60">
                  <Plus size={14} className="text-slate-400" />
                  <select
                    value=""
                    onChange={(ev) => addDesigner(f._id, ev.target.value)}
                    className="flex-1 h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <option value="">{t('addDesignerPlaceholder')}</option>
                    {designers
                      .filter((d) => !inThis.has(d._id))
                      .map((d) => {
                        const usedIn = designerFactory.get(d._id);
                        const elsewhere = usedIn && usedIn !== f._id;
                        const facName = elsewhere
                          ? factoryById.get(usedIn!)?.shortName || factoryById.get(usedIn!)?.name
                          : '';
                        return (
                          <option key={d._id} value={d._id} disabled={!!elsewhere}>
                            {d.fullName}
                            {elsewhere ? ` ${t('usedElsewhere', { factory: facName })}` : ''}
                          </option>
                        );
                      })}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
