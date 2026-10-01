import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { TFunction } from 'i18next';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Factory,
  Flame,
  Hourglass,
  Inbox,
  LogIn,
  LogOut,
  Package,
  PackageCheck,
  Palette,
  Printer,
  RotateCw,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { RepositoryRemote } from '@/services';

import { OrderFilterBar } from '@/components/orders/OrderFilterBar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useFactoryScope } from '@/hooks/useFactoryScope';
import { usePermission } from '@/hooks/usePermission';

import { useAuthStore } from '../../store/authStore';

interface LifecycleStageRow {
  stage: string;
  label: string;
  backlog: number;
  waitingToStart: number;
  inProgress: number;
  rework: number;
  error: number;
  doneInRange: number;
  passedTotal: number;
  avgWorkMs: number;
}

interface LifecycleOverview {
  stages: LifecycleStageRow[];
  totals: {
    totalActive: number;
    completedInRange: number;
    avgTotalCycleMs: number;
    bottleneckStage: string | null;
  };
  completionTimeline: Array<{ date: string; completed: number }>;
  factories: Array<{ factoryId: string; factoryName: string }>;
  filter: { factoryId?: string; from?: string; to?: string };
}

/** Icon + nhãn ngắn cho mỗi chặng (dùng trong phễu + biểu đồ). */
function buildStageMeta(t: TFunction<'orderLifecycle'>): Record<string, { icon: React.ElementType; short: string }> {
  return {
    'tool-check': { icon: ClipboardCheck, short: t('lifecycleTab.stages.toolCheck') },
    designer: { icon: Palette, short: t('lifecycleTab.stages.designer') },
    print: { icon: Printer, short: t('lifecycleTab.stages.print') },
    press: { icon: Flame, short: t('lifecycleTab.stages.press') },
    'qc-post-press': { icon: ShieldCheck, short: t('lifecycleTab.stages.qcPostPress') },
    'sew-in': { icon: LogIn, short: t('lifecycleTab.stages.sewIn') },
    'sew-out': { icon: LogOut, short: t('lifecycleTab.stages.sewOut') },
    pack: { icon: Package, short: t('lifecycleTab.stages.pack') },
  };
}

// Đường ray (rail) indigo liền mạch nối các công đoạn trong phễu.
const RAIL_H = 'relative h-[3px] w-full rounded-full bg-indigo-400/70 dark:bg-indigo-500/50';
const RAIL_V = 'relative w-[3px] h-full rounded-full bg-indigo-400/70 dark:bg-indigo-500/50';
const RAIL_TIP = 'absolute text-indigo-500 dark:text-indigo-400';

const SEGMENT_COLORS = {
  backlog: '#94a3b8', // slate-400 — đang chứa
  inProgress: '#6366f1', // indigo-500 — đang làm
  rework: '#f59e0b', // amber-500
  error: '#f43f5e', // rose-500
};

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** ms → chuỗi ngắn gọn (phút / giờ / ngày). 0 hoặc âm → "—". */
function formatDuration(t: TFunction<'orderLifecycle'>, ms: number): string {
  if (!ms || ms <= 0) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return t('lifecycleTab.duration.minutes', { count: totalMin });
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr > 0 ? t('lifecycleTab.duration.daysHours', { days: d, hours: hr }) : t('lifecycleTab.duration.days', { count: d });
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: 'default' | 'amber' | 'emerald';
  loading?: boolean;
}

function KpiCard({ label, value, sub, icon, tone = 'default', loading }: KpiCardProps) {
  if (loading) return <div className="rounded-xl bg-muted/40 animate-pulse h-[78px]" />;
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3 transition-colors',
        tone === 'amber'
          ? 'border-amber-300/60 bg-amber-50/50 dark:bg-amber-500/5'
          : tone === 'emerald'
            ? 'border-emerald-300/60 bg-emerald-50/50 dark:bg-emerald-500/5'
            : 'border-border bg-card hover:bg-muted/20',
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <span className="opacity-70 shrink-0">{icon}</span>
        <span className="text-[11px] font-medium truncate">{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground leading-none">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground truncate mt-1">{sub}</p>}
    </div>
  );
}

type FunnelNode = { kind: 'stage'; row: LifecycleStageRow; step: number } | { kind: 'done'; completed: number };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Sắp các node của 1 hàng vào `cols` slot theo kiểu rắn bò (boustrophedon):
 * hàng chẵn trái→phải, hàng lẻ lấp từ phải→trái để node đầu hàng lẻ nằm ngay
 * dưới node cuối hàng chẵn (nối liền mạch). Slot trống = null (spacer căn cột).
 */
function buildSlots(row: FunnelNode[], rowIndex: number, cols: number): (FunnelNode | null)[] {
  const slots: (FunnelNode | null)[] = new Array(cols).fill(null);
  if (rowIndex % 2 === 0) row.forEach((n, k) => (slots[k] = n));
  else row.forEach((n, k) => (slots[cols - 1 - k] = n));
  return slots;
}

/** Cột xảy ra "rẽ xuống" sau 1 hàng (để vẽ mũi tên ChevronDown nối hàng kế). */
function turnColumn(rowLen: number, rowIndex: number, cols: number): number {
  return rowIndex % 2 === 0 ? rowLen - 1 : cols - rowLen;
}

/** 1 chỉ số trong node — kèm tooltip giải thích đây là trường gì. */
function Metric({
  icon,
  label,
  value,
  desc,
  valueClass,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  desc: string;
  valueClass?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-2 py-1.5 cursor-help hover:bg-muted/70 transition-colors">
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 truncate">
            {icon}
            {label}
          </span>
          <span className={cn('text-sm font-semibold tabular-nums leading-none', valueClass)}>{value}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[230px]">{desc}</TooltipContent>
    </Tooltip>
  );
}

const dash = (n: number) => (n === 0 ? '–' : formatNumber(n));

/** Node lớn trong phễu — đầy đủ chỉ số + tooltip mỗi trường. */
function FunnelNodeCard({
  node,
  isBottleneck,
  stageMeta,
}: {
  node: FunnelNode;
  isBottleneck: boolean;
  stageMeta: Record<string, { icon: React.ElementType; short: string }>;
}) {
  const { t } = useTranslation('orderLifecycle');
  if (node.kind === 'done') {
    return (
      <div className="flex-1 min-w-0 rounded-lg border border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-500/10 p-3 flex flex-col">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            ✓
          </span>
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">{t('lifecycleTab.funnel.done')}</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help mt-auto">
              <div className="text-[28px] leading-none font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                {formatNumber(node.completed)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{t('lifecycleTab.funnel.doneSub')}</div>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[230px]">{t('lifecycleTab.funnel.doneTooltip')}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  const s = node.row;
  const meta = stageMeta[s.stage];
  const Icon = meta?.icon ?? Clock;
  const isTool = s.stage === 'tool-check';

  return (
    <div
      className={cn(
        'flex-1 min-w-0 rounded-lg border p-3 flex flex-col transition-colors',
        isBottleneck
          ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-500/10 ring-1 ring-amber-300'
          : 'border-border bg-background hover:bg-muted/30',
      )}
    >
      {/* Header: step + icon + tên */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0 tabular-nums">
          {node.step}
        </span>
        <Icon size={15} className={cn('shrink-0', isBottleneck ? 'text-amber-600' : 'text-primary')} />
        <span className="text-xs font-semibold text-foreground truncate">{s.label}</span>
        {isBottleneck && (
          <span className="ml-auto text-[8px] uppercase tracking-wide font-bold text-amber-600 bg-amber-100 dark:bg-amber-500/15 px-1 py-0.5 rounded shrink-0">
            {t('lifecycleTab.funnel.bottleneckTag')}
          </span>
        )}
      </div>

      {/* Backlog — số lớn */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help mb-2">
            <div className="text-[26px] leading-none font-bold tabular-nums text-foreground">
              {formatNumber(s.backlog)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{t('lifecycleTab.funnel.waitingLabel')}</div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-[230px]">
          {isTool
            ? t('lifecycleTab.funnel.waitingTooltipTool')
            : t('lifecycleTab.funnel.waitingTooltipStage', { label: s.label })}
        </TooltipContent>
      </Tooltip>

      {/* 2×3 chỉ số */}
      <div className="grid grid-cols-2 gap-1.5">
        <Metric
          icon={<Inbox size={9} />}
          label={t('lifecycleTab.metrics.waitingToStart')}
          value={isTool ? '–' : dash(s.waitingToStart)}
          valueClass="text-sky-700 dark:text-sky-300"
          desc={
            isTool
              ? t('lifecycleTab.metrics.waitingToStartDescTool')
              : s.stage === 'designer'
                ? t('lifecycleTab.metrics.waitingToStartDescDesigner')
                : t('lifecycleTab.metrics.waitingToStartDescStage', { label: s.label })
          }
        />
        <Metric
          icon={<Activity size={9} />}
          label={t('lifecycleTab.metrics.inProgress')}
          value={isTool ? '–' : dash(s.inProgress)}
          valueClass="text-indigo-700 dark:text-indigo-300"
          desc={
            isTool
              ? t('lifecycleTab.metrics.inProgressDescTool')
              : t('lifecycleTab.metrics.inProgressDescStage', { label: s.label })
          }
        />
        <Metric
          icon={<RotateCw size={9} />}
          label={t('lifecycleTab.metrics.rework')}
          value={dash(s.rework)}
          valueClass="text-amber-700 dark:text-amber-300"
          desc={
            isTool
              ? t('lifecycleTab.metrics.reworkDescTool')
              : t('lifecycleTab.metrics.reworkDescStage', { label: s.label })
          }
        />
        <Metric
          icon={<AlertTriangle size={9} />}
          label={t('lifecycleTab.metrics.error')}
          value={dash(s.error)}
          valueClass="text-rose-700 dark:text-rose-300"
          desc={
            isTool
              ? t('lifecycleTab.metrics.errorDescTool')
              : t('lifecycleTab.metrics.errorDescStage', { label: s.label })
          }
        />
        <Metric
          icon={<PackageCheck size={9} />}
          label={t('lifecycleTab.metrics.doneInRange')}
          value={dash(s.doneInRange)}
          valueClass="text-emerald-700 dark:text-emerald-300"
          desc={t('lifecycleTab.metrics.doneInRangeDesc', { label: s.label })}
        />
        <Metric
          icon={<Hourglass size={9} />}
          label={t('lifecycleTab.metrics.avgTime')}
          value={formatDuration(t, s.avgWorkMs)}
          desc={
            isTool
              ? t('lifecycleTab.metrics.avgTimeDescTool')
              : t('lifecycleTab.metrics.avgTimeDescStage', { label: s.label })
          }
        />
      </div>

      {/* Footer: đã qua / đã soát */}
      <div className="mt-1.5">
        <Metric
          icon={<CheckCircle2 size={9} />}
          label={isTool ? t('lifecycleTab.metrics.passedTotalTool') : t('lifecycleTab.metrics.passedTotalStage')}
          value={formatNumber(s.passedTotal)}
          desc={
            isTool
              ? t('lifecycleTab.metrics.passedTotalDescTool')
              : t('lifecycleTab.metrics.passedTotalDescStage', { label: s.label })
          }
        />
      </div>
    </div>
  );
}

/**
 * Tab "Vòng đời đơn" — phễu 9 chặng từ Soát tool → Đóng hàng + bảng chi tiết +
 * 2 biểu đồ (stacked bar tồn đọng theo chặng, line đơn hoàn thành/ngày). Data
 * từ `GET /v1/orders/lifecycle-overview`. Xem `OrderLifecycle.md`.
 */
export default function LifecycleTab() {
  const { t } = useTranslation('orderLifecycle');
  const stageMeta = useMemo(() => buildStageMeta(t), [t]);
  const { profile } = useAuthStore();
  const { roleName } = usePermission();
  // User gắn 1 xưởng (Fulfillment) → khóa vào xưởng đó. Role quản lý chọn mọi xưởng.
  const isOverrideRole = ['SuperAdmin', 'Admin', 'Manager', 'SupportManager', 'Support'].includes(roleName ?? '');
  const lockedFactoryId = !isOverrideRole ? profile?.factoryId : undefined;

  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LifecycleOverview | null>(null);
  // Mặc định 7 ngày gần nhất. Bộ lọc ngày = NGÀY VÀO SẢN XUẤT (inProductionAt):
  // giới hạn tập đơn → snapshot cho biết đơn của (các) ngày đó đang ở công đoạn nào.
  const [startDate, setStartDate] = useState<string>(() => searchParams.get('lfrom') || daysAgoISO(6));
  const [endDate, setEndDate] = useState<string>(() => searchParams.get('lto') || todayISO());
  // `lfactory` = select xưởng của chính tab. Chưa chọn thì rơi về `factoryId` —
  // param chung của "cụm menu theo xưởng" ở sidebar.
  // Header factory scope goes through `useFactoryScope` (Orders.md §25) — reading `?factoryId=`
  // directly would skip the Fulfillment lock and send whatever factory a shared link carries.
  const factoryScopeParam = useFactoryScope() || '';
  const [selectedFactory, setSelectedFactory] = useState<string>(
    () => searchParams.get('lfactory') || factoryScopeParam,
  );

  const effectiveFactory = lockedFactoryId ?? selectedFactory;

  // Đổi cụm xưởng ở sidebar chỉ đổi `factoryId` trên URL; select của tab đã seed
  // từ lần mount đầu nên phải kéo theo, nếu không bấm menu sẽ như không có gì xảy ra.
  useEffect(() => {
    setSelectedFactory((prev) => (prev === factoryScopeParam ? prev : factoryScopeParam));
  }, [factoryScopeParam]);

  // Số cột phễu (rắn bò) — responsive để khối luôn vuông gọn, không cuộn ngang.
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setCols(w >= 1280 ? 4 : w >= 920 ? 3 : w >= 560 ? 2 : 1);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        startDate ? sp.set('lfrom', startDate) : sp.delete('lfrom');
        endDate ? sp.set('lto', endDate) : sp.delete('lto');
        selectedFactory ? sp.set('lfactory', selectedFactory) : sp.delete('lfactory');
        return sp;
      },
      { replace: true },
    );
  }, [startDate, endDate, selectedFactory, setSearchParams]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.set('from', startDate);
      if (endDate) params.set('to', endDate);
      if (effectiveFactory) params.set('factoryId', effectiveFactory);
      const resp = await RepositoryRemote.order.getLifecycleOverview(`?${params.toString()}`);
      setData(resp.data.data);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, effectiveFactory]);

  const stages = data?.stages ?? [];
  const totals = data?.totals;
  const lockedFactoryName = lockedFactoryId
    ? data?.factories.find((f) => f.factoryId === lockedFactoryId)?.factoryName
    : undefined;

  const barData = useMemo(
    () =>
      stages.map((s) => ({
        name: stageMeta[s.stage]?.short ?? s.label,
        backlog: s.backlog,
        inProgress: s.inProgress,
        rework: s.rework,
        error: s.error,
      })),
    [stages, stageMeta],
  );

  const lineData = data?.completionTimeline ?? [];
  const isRefetching = loading && !!data;

  // Node phễu theo kiểu rắn bò — 9 chặng + node "Hoàn thành", chia theo `cols`.
  const funnelRows = useMemo(() => {
    const nodes: FunnelNode[] = [
      ...stages.map((s, i) => ({ kind: 'stage' as const, row: s, step: i + 1 })),
      { kind: 'done' as const, completed: totals?.completedInRange ?? 0 },
    ];
    return chunk(nodes, cols);
  }, [stages, totals, cols]);

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto relative">
      <div
        className={cn(
          'absolute top-0 left-0 right-0 h-0.5 overflow-hidden rounded-full bg-primary/10 pointer-events-none transition-opacity duration-200',
          loading ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="h-full w-1/4 bg-primary rounded-full animate-indeterminate-bar" />
      </div>

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('lifecycleTab.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('lifecycleTab.subtitle')}</p>
        </div>
      </div>

      <OrderFilterBar
        createdFrom={startDate}
        createdTo={endDate}
        onDateRangeChange={(f, t2) => {
          setStartDate(f);
          setEndDate(t2);
        }}
        onReload={fetchData}
        loading={loading}
        facets={
          // Xưởng do tài khoản khóa, hoặc do cụm menu xưởng ở sidebar quyết →
          // bỏ select xưởng trong nội dung, tránh 2 chỗ đổi xưởng chọi nhau.
          lockedFactoryId || factoryScopeParam
            ? []
            : [
                {
                  key: 'factory',
                  label: t('lifecycleTab.factoryFacetLabel'),
                  value: selectedFactory,
                  onChange: setSelectedFactory,
                  options: [
                    { value: '', label: t('lifecycleTab.allFactories') },
                    ...(data?.factories ?? []).map((f) => ({ value: f.factoryId, label: f.factoryName })),
                  ],
                },
              ]
        }
        topActionsRight={
          lockedFactoryId ? (
            <span className="inline-flex items-center gap-1.5 text-xs bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 px-2.5 py-1.5 rounded-md">
              <Factory size={12} />
              <span className="font-medium">{lockedFactoryName || t('lifecycleTab.myFactory')}</span>
            </span>
          ) : undefined
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={t('lifecycleTab.kpi.inProgress.label')}
          value={totals ? formatNumber(totals.totalActive) : '—'}
          sub={t('lifecycleTab.kpi.inProgress.sub')}
          icon={<Activity size={13} />}
          loading={loading && !data}
        />
        <KpiCard
          label={t('lifecycleTab.kpi.completed.label')}
          value={totals ? formatNumber(totals.completedInRange) : '—'}
          sub={t('lifecycleTab.kpi.completed.sub', { from: startDate, to: endDate })}
          icon={<PackageCheck size={13} />}
          tone="emerald"
          loading={loading && !data}
        />
        <KpiCard
          label={t('lifecycleTab.kpi.cycleTime.label')}
          value={totals ? formatDuration(t, totals.avgTotalCycleMs) : '—'}
          sub={t('lifecycleTab.kpi.cycleTime.sub')}
          icon={<Timer size={13} />}
          loading={loading && !data}
        />
        <KpiCard
          label={t('lifecycleTab.kpi.bottleneck.label')}
          value={
            totals?.bottleneckStage
              ? stageMeta[totals.bottleneckStage]?.short ??
                stages.find((s) => s.stage === totals.bottleneckStage)?.label ??
                '—'
              : '—'
          }
          sub={
            totals?.bottleneckStage
              ? t('lifecycleTab.kpi.bottleneck.subWaiting', {
                  count: formatNumber(stages.find((s) => s.stage === totals.bottleneckStage)?.backlog ?? 0),
                })
              : t('lifecycleTab.kpi.bottleneck.subNone')
          }
          icon={<AlertTriangle size={13} />}
          tone={totals?.bottleneckStage ? 'amber' : 'default'}
          loading={loading && !data}
        />
      </div>

      {/* Phễu các chặng — bố cục rắn bò (boustrophedon) để thấy hết không cuộn */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground mb-1">{t('lifecycleTab.funnel.title')}</h2>
        {/* <p className="text-xs text-muted-foreground mb-4">
          Đơn vào sản xuất trong khoảng ngày đã lọc, hiện đang nằm ở công đoạn nào. Đi theo số thứ tự (rắn bò); di chuột vào số để xem chú thích.
        </p> */}
        {loading && !data ? (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-[210px] rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : (
          <TooltipProvider delayDuration={120}>
            {/* Bố cục rắn bò + đường ray (rail) indigo liền mạch nối các công đoạn */}
            <div className="space-y-0">
              {funnelRows.map((row, r) => {
                const slots = buildSlots(row, r, cols);
                const goRight = r % 2 === 0;
                const tCol = turnColumn(row.length, r, cols);
                return (
                  <React.Fragment key={r}>
                    {/* Hàng node — gap-0, ray nằm trong ô nối để chạm sát cạnh node */}
                    <div className="flex items-stretch gap-0">
                      {slots.map((node, c) => (
                        <React.Fragment key={c}>
                          {node ? (
                            <FunnelNodeCard
                              node={node}
                              isBottleneck={
                                node.kind === 'stage' &&
                                totals?.bottleneckStage === node.row.stage &&
                                node.row.backlog > 0
                              }
                              stageMeta={stageMeta}
                            />
                          ) : (
                            <div className="flex-1 min-w-0" />
                          )}
                          {c < cols - 1 && (
                            <div className="w-8 shrink-0 flex items-center">
                              {slots[c] && slots[c + 1] ? (
                                <div className={RAIL_H}>
                                  {goRight ? (
                                    <ChevronRight
                                      size={14}
                                      strokeWidth={3}
                                      className={cn(RAIL_TIP, 'top-1/2 -translate-y-1/2 -right-1')}
                                    />
                                  ) : (
                                    <ChevronLeft
                                      size={14}
                                      strokeWidth={3}
                                      className={cn(RAIL_TIP, 'top-1/2 -translate-y-1/2 -left-1')}
                                    />
                                  )}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                    {/* Ray rẽ xuống nối sang hàng kế — căn đúng cột node bên trên */}
                    {r < funnelRows.length - 1 && (
                      <div className="flex items-stretch gap-0 h-7">
                        {Array.from({ length: cols }).map((_, c) => (
                          <React.Fragment key={c}>
                            <div className="flex-1 min-w-0 flex justify-center">
                              {c === tCol ? (
                                <div className={RAIL_V}>
                                  <ChevronDown
                                    size={14}
                                    strokeWidth={3}
                                    className={cn(RAIL_TIP, '-bottom-1 left-1/2 -translate-x-1/2')}
                                  />
                                </div>
                              ) : null}
                            </div>
                            {c < cols - 1 && <div className="w-8 shrink-0" />}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </TooltipProvider>
        )}
      </div>

      {/* Bảng chi tiết */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{t('lifecycleTab.detailTable.title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('lifecycleTab.detailTable.subtitle')}</p>
        </div>
        <div className="overflow-x-auto border-t border-border">
          {loading && !data ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-6 rounded bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/40 text-[11px] tracking-wide font-medium text-muted-foreground">
                  <th className="sticky left-0 bg-muted/40 text-left px-4 py-2.5 min-w-[180px] border-b border-border">
                    {t('lifecycleTab.detailTable.columns.stage')}
                  </th>
                  <th className="text-right px-3 py-2.5 border-b border-border">
                    {t('lifecycleTab.detailTable.columns.backlog')}
                  </th>
                  <th className="text-right px-3 py-2.5 border-b border-border">
                    {t('lifecycleTab.detailTable.columns.waitingToStart')}
                  </th>
                  <th className="text-right px-3 py-2.5 border-b border-border">
                    {t('lifecycleTab.detailTable.columns.inProgress')}
                  </th>
                  <th className="text-right px-3 py-2.5 border-b border-border">
                    {t('lifecycleTab.detailTable.columns.rework')}
                  </th>
                  <th className="text-right px-3 py-2.5 border-b border-border">
                    {t('lifecycleTab.detailTable.columns.error')}
                  </th>
                  <th className="text-right px-3 py-2.5 border-b border-border">
                    {t('lifecycleTab.detailTable.columns.doneInRange')}
                  </th>
                  <th className="text-right px-3 py-2.5 border-b border-border">
                    {t('lifecycleTab.detailTable.columns.passedTotal')}
                  </th>
                  <th className="text-right px-3 py-2.5 border-b border-border">
                    {t('lifecycleTab.detailTable.columns.avgTime')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stages.map((s) => {
                  const meta = stageMeta[s.stage];
                  const Icon = meta?.icon ?? Clock;
                  const isBottleneck = totals?.bottleneckStage === s.stage && s.backlog > 0;
                  const cell = (v: number, cls?: string) => (
                    <td
                      className={cn('text-right px-3 py-2.5 tabular-nums', v === 0 ? 'text-muted-foreground/40' : cls)}
                    >
                      {v === 0 ? '–' : formatNumber(v)}
                    </td>
                  );
                  return (
                    <tr
                      key={s.stage}
                      className={cn(
                        'hover:bg-muted/30 transition-colors',
                        isBottleneck && 'bg-amber-50/40 dark:bg-amber-500/5',
                      )}
                    >
                      <td className="sticky left-0 bg-card px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Icon size={15} className="text-primary shrink-0" />
                          <span className="font-medium text-foreground">{s.label}</span>
                          {isBottleneck && (
                            <span className="text-[9px] uppercase tracking-wide font-semibold text-amber-600 bg-amber-100 dark:bg-amber-500/15 px-1.5 py-0.5 rounded">
                              {t('lifecycleTab.funnel.bottleneckTag')}
                            </span>
                          )}
                        </div>
                      </td>
                      {cell(s.backlog, 'font-semibold text-foreground')}
                      {cell(s.waitingToStart, 'text-sky-700 dark:text-sky-300')}
                      {cell(s.inProgress, 'text-indigo-700 dark:text-indigo-300')}
                      {cell(s.rework, 'text-amber-700 dark:text-amber-300')}
                      {cell(s.error, 'text-rose-700 dark:text-rose-300')}
                      {cell(s.doneInRange, 'text-emerald-700 dark:text-emerald-300')}
                      {cell(s.passedTotal, 'text-muted-foreground')}
                      <td className="text-right px-3 py-2.5 tabular-nums text-muted-foreground">
                        {formatDuration(t, s.avgWorkMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Biểu đồ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground mb-1">{t('lifecycleTab.charts.backlogTitle')}</h2>
          <p className="text-xs text-muted-foreground mb-4">{t('lifecycleTab.charts.backlogSubtitle')}</p>
          {loading && !data ? (
            <div className="h-[300px] rounded bg-muted/40 animate-pulse" />
          ) : barData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">
              {t('lifecycleTab.charts.noData')}
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={56} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RechartsTooltip content={<BarTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
                  <Bar
                    dataKey="backlog"
                    name={t('lifecycleTab.charts.legend.backlog')}
                    stackId="a"
                    fill={SEGMENT_COLORS.backlog}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="inProgress"
                    name={t('lifecycleTab.charts.legend.inProgress')}
                    stackId="a"
                    fill={SEGMENT_COLORS.inProgress}
                  />
                  <Bar
                    dataKey="rework"
                    name={t('lifecycleTab.charts.legend.rework')}
                    stackId="a"
                    fill={SEGMENT_COLORS.rework}
                  />
                  <Bar
                    dataKey="error"
                    name={t('lifecycleTab.charts.legend.error')}
                    stackId="a"
                    fill={SEGMENT_COLORS.error}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-3 justify-center">
            {[
              [t('lifecycleTab.charts.legend.backlog'), SEGMENT_COLORS.backlog],
              [t('lifecycleTab.charts.legend.inProgress'), SEGMENT_COLORS.inProgress],
              [t('lifecycleTab.charts.legend.rework'), SEGMENT_COLORS.rework],
              [t('lifecycleTab.charts.legend.error'), SEGMENT_COLORS.error],
            ].map(([label, color]) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground mb-1">{t('lifecycleTab.charts.completedTitle')}</h2>
          <p className="text-xs text-muted-foreground mb-4">{t('lifecycleTab.charts.completedSubtitle')}</p>
          {loading && !data ? (
            <div className="h-[300px] rounded bg-muted/40 animate-pulse" />
          ) : lineData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">
              {t('lifecycleTab.charts.noCompleted')}
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineData} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RechartsTooltip content={<LineTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="completed"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#6366f1' }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className={cn('h-px transition-opacity', isRefetching ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BarTooltip({ active, payload, label }: any) {
  const { t } = useTranslation('orderLifecycle');
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum: number, p: { value?: number }) => sum + (p.value || 0), 0);
  return (
    <div className="bg-popover border border-border rounded-md shadow-md p-2.5 text-xs min-w-[140px]">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} className="flex items-center justify-between gap-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
            {p.name}
          </span>
          <span className="tabular-nums font-medium text-foreground">{p.value}</span>
        </p>
      ))}
      <p className="flex items-center justify-between gap-3 mt-1.5 pt-1.5 border-t border-border text-foreground font-medium">
        <span>{t('lifecycleTab.charts.tooltipTotal')}</span>
        <span className="tabular-nums">{total}</span>
      </p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LineTooltip({ active, payload, label }: any) {
  const { t } = useTranslation('orderLifecycle');
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-md shadow-md p-2.5 text-xs">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="text-muted-foreground tabular-nums">
        {t('lifecycleTab.charts.tooltipCompletedSuffix', { count: payload[0].value })}
      </p>
    </div>
  );
}
