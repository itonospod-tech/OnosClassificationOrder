import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock,
  Flame,
  Layers,
  ListChecks,
  LogIn,
  LogOut,
  Package,
  PackageCheck,
  Palette,
  PlayCircle,
  Printer,
  RotateCw,
  Search,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-react';
import type { LifecycleOverview, LifecycleTrack } from 'shared';

import { useAuthStore } from '@/store/authStore';

import { RepositoryRemote } from '@/services';

import { DateRangePicker } from '@/components/common/DateRangePicker';
import { BulkProductionIdDialog } from '@/components/orders/BulkProductionIdDialog';
import { CancelledOrdersDialog } from '@/components/orders/CancelledOrdersDialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useFactoryScope } from '@/hooks/useFactoryScope';
import { usePermission } from '@/hooks/usePermission';

/** Nhãn ngắn cho từng chặng — hiện trên đầu mỗi box. */
function buildStageShort(t: TFunction<'orderLifecycle'>): Record<string, string> {
  return {
    'tool-check': t('strip.stages.toolCheck'),
    designer: t('strip.stages.designer'),
    print: t('strip.stages.print'),
    press: t('strip.stages.press'),
    'qc-post-press': t('strip.stages.qcPostPress'),
    'sew-in': t('strip.stages.sewIn'),
    'sew-out': t('strip.stages.sewOut'),
    pack: t('strip.stages.pack'),
  };
}

/** Icon riêng cho từng chặng — hiện trong box cho dễ phân biệt. */
const STAGE_ICON: Record<string, React.ElementType> = {
  'tool-check': ClipboardCheck,
  designer: Palette,
  print: Printer,
  press: Flame,
  'qc-post-press': ShieldCheck,
  'sew-in': LogIn,
  'sew-out': LogOut,
  pack: Package,
  done: PackageCheck,
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const fmt = (n: number) => (n === 0 ? '–' : n.toLocaleString('en-US'));

function buildTrackStyle(
  t: TFunction<'orderLifecycle'>,
): Record<string, { chip: string; icon: React.ElementType; color: string; text: string }> {
  return {
    done: {
      chip: 'border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-500/10',
      icon: CheckCircle2,
      color: 'text-emerald-600 dark:text-emerald-400',
      text: t('strip.trackStatus.done'),
    },
    current: {
      chip: 'border-indigo-400 bg-indigo-50/70 dark:bg-indigo-500/10 ring-1 ring-indigo-300',
      icon: PlayCircle,
      color: 'text-indigo-600 dark:text-indigo-400',
      text: t('strip.trackStatus.current'),
    },
    error: {
      chip: 'border-rose-400 bg-rose-50/70 dark:bg-rose-500/10 ring-1 ring-rose-300',
      icon: AlertTriangle,
      color: 'text-rose-600 dark:text-rose-400',
      text: t('strip.trackStatus.error'),
    },
    rework: {
      chip: 'border-amber-400 bg-amber-50/70 dark:bg-amber-500/10 ring-1 ring-amber-300',
      icon: RotateCw,
      color: 'text-amber-600 dark:text-amber-400',
      text: t('strip.trackStatus.rework'),
    },
    pending: {
      chip: 'border-border bg-muted/30',
      icon: Circle,
      color: 'text-muted-foreground/40',
      text: t('strip.trackStatus.pending'),
    },
  };
}

/** 1 dòng chi tiết trong tooltip. */
function Row({ icon, label, value, cls }: { icon?: React.ReactNode; label: string; value: number; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground flex items-center gap-1">
        {icon && <span className={cls}>{icon}</span>}
        {label}
      </span>
      <span className={cn('font-semibold tabular-nums', cls)}>{value.toLocaleString('en-US')}</span>
    </div>
  );
}

/**
 * Strip "Vòng đời đơn" — hiện trên đầu Dashboard cho MỌI tài khoản.
 * Mỗi box CHỈ hiện số; hover vào box → tooltip giải thích chi tiết.
 *   • Mặc định: card "Tổng đơn tất cả" + 9 chặng (Soát tool → … → Đóng); mỗi
 *     chặng hiện Tổng (đang ở chặng) + Chờ / Làm / Lại / Xong (theo màu).
 *   • Nhập productionId → hành trình riêng của đơn đó (✓ / ● / ○ / ✕ / ↻).
 * Data: `GET /orders/lifecycle-overview` + `GET /orders/lifecycle-track/:code`.
 * Fulfillment tự khóa theo xưởng ở BE. Xem `OrderLifecycle.md`.
 */
export default function LifecycleStrip() {
  const { t } = useTranslation('orderLifecycle');
  const STAGE_SHORT = useMemo(() => buildStageShort(t), [t]);
  const TRACK_STYLE = useMemo(() => buildTrackStyle(t), [t]);
  const [from, setFrom] = useState<string>(() => daysAgoISO(6));
  const [to, setTo] = useState<string>(() => todayISO());
  const [pid, setPid] = useState('');
  const [debouncedPid, setDebouncedPid] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [cancelledOpen, setCancelledOpen] = useState(false);

  // Lọc xưởng + khách hàng (chỉ chế độ tổng quan; track theo productionId bỏ qua).
  // Mirror khóa xưởng của LifecycleTab: role quản lý chọn mọi xưởng, còn lại
  // (Fulfillment) BE tự khóa theo xưởng mình → ẩn select.
  const { profile } = useAuthStore();
  const { roleName } = usePermission();
  const isOverrideRole = ['SuperAdmin', 'Admin', 'Manager', 'SupportManager', 'Support'].includes(roleName ?? '');
  const lockedFactoryId = !isOverrideRole ? profile?.factoryId : undefined;
  // Mặc định theo "cụm menu theo xưởng" ở sidebar (`?factoryId=`) — strip nằm
  // trên mọi tab Dashboard nên phải cùng phạm vi với tab đang xem.
  const factoryScope = useFactoryScope();
  const [factoryId, setFactoryId] = useState(() => factoryScope || '');
  const effectiveFactory = lockedFactoryId ?? factoryId;
  // Đổi cụm xưởng ở sidebar → kéo theo select của strip (state đã seed lúc mount).
  useEffect(() => {
    setFactoryId((prev) => (prev === (factoryScope || '') ? prev : factoryScope || ''));
  }, [factoryScope]);
  // Combobox khách: chọn từ danh sách `customers` của response overview (facet
  // BE, scope theo xưởng/ngày đang lọc) → lọc CHÍNH XÁC theo cặp SKU+email.
  const [custQuery, setCustQuery] = useState('');
  const [custOpen, setCustOpen] = useState(false);
  const [selCust, setSelCust] = useState<{ userSku: string; userEmail: string } | null>(null);
  // Options xưởng/khách cache từ lần fetch KHÔNG lọc chiều tương ứng (facet BE
  // chạy sau $match nên khi đang lọc danh sách sẽ co lại).
  const [factoryOpts, setFactoryOpts] = useState<Array<{ factoryId: string; factoryName: string }>>([]);
  const [customerOpts, setCustomerOpts] = useState<Array<{ userSku: string; userEmail: string; count: number }>>([]);

  const [agg, setAgg] = useState<LifecycleOverview | null>(null);
  const [track, setTrack] = useState<LifecycleTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  const isTrack = debouncedPid.trim().length > 0;

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedPid(pid), 400);
    return () => window.clearTimeout(id);
  }, [pid]);

  useEffect(() => {
    if (isTrack) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        if (effectiveFactory) params.set('factoryId', effectiveFactory);
        if (selCust) {
          params.set('userSku', selCust.userSku);
          if (selCust.userEmail) params.set('userEmail', selCust.userEmail);
        }
        const resp = await RepositoryRemote.order.getLifecycleOverview(`?${params.toString()}`);
        if (!cancelled) {
          setAgg(resp.data.data);
          // Cache options từ response KHÔNG lọc chiều tương ứng.
          if (!effectiveFactory && !selCust) setFactoryOpts(resp.data.data?.factories ?? []);
          if (!selCust) setCustomerOpts(resp.data.data?.customers ?? []);
        }
      } catch (error) {
        if (!cancelled) handleAxiosError(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, isTrack, effectiveFactory, selCust]);

  // Lọc client-side danh sách khách theo text gõ vào combobox.
  const filteredCust = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    const list = q
      ? customerOpts.filter((c) => c.userSku.toLowerCase().includes(q) || c.userEmail.toLowerCase().includes(q))
      : customerOpts;
    return list.slice(0, 50);
  }, [customerOpts, custQuery]);

  useEffect(() => {
    const code = debouncedPid.trim();
    if (!code) {
      setTrack(null);
      setTrackError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setTrackError(null);
        const resp = await RepositoryRemote.order.getLifecycleTrack(code);
        if (!cancelled) setTrack(resp.data.data);
      } catch {
        if (!cancelled) {
          setTrack(null);
          setTrackError(t('strip.trackNotFound'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedPid, t]);

  const bottleneck = agg?.totals.bottleneckStage;
  const totals = agg?.totals;

  const aggStages = useMemo(
    () =>
      (agg?.stages ?? []).map((s) => ({
        key: s.stage,
        label: STAGE_SHORT[s.stage] ?? s.label,
        total: s.backlog + s.inProgress + s.rework,
        waiting: s.backlog,
        inProgress: s.inProgress,
        rework: s.rework,
        done: s.passedTotal,
      })),
    [agg, STAGE_SHORT],
  );

  const trackStages = useMemo(() => {
    if (!track) return [];
    const list = track.stages.map((s) => ({ key: s.key, label: STAGE_SHORT[s.key] ?? s.label, status: s.status }));
    list.push({ key: 'done', label: t('strip.stages.done'), status: track.completed ? 'done' : 'pending' });
    return list;
  }, [track, STAGE_SHORT, t]);

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 space-y-2.5">
      {/* Hàng điều khiển — tách riêng */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Workflow size={15} className="text-indigo-600" />
          {t('strip.title')}
        </div>
        <div className="relative w-[200px]">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={pid}
            onChange={(e) => setPid(e.target.value)}
            placeholder={t('strip.searchPlaceholder')}
            className="w-full h-7 pl-7 pr-6 rounded-md border border-border bg-background text-xs outline-none focus:ring-1 focus:ring-indigo-300"
          />
          {pid && (
            <button
              type="button"
              onClick={() => setPid('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          title={t('strip.bulkLookupTitle')}
          className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-border bg-background text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ListChecks size={13} /> {t('strip.bulkLookup')}
        </button>
        {!isTrack && (
          <DateRangePicker
            from={from}
            to={to}
            placeholder={t('strip.dateRangePlaceholder')}
            onChange={(f, t2) => {
              setFrom(f);
              setTo(t2);
            }}
          />
        )}
        {/* Xưởng do cụm menu sidebar quyết → ẩn select, tránh 2 chỗ đổi xưởng. */}
        {!isTrack && !lockedFactoryId && !factoryScope && (
          <select
            value={factoryId}
            onChange={(e) => setFactoryId(e.target.value)}
            className={cn(
              'h-7 px-2 rounded-md border bg-background text-xs outline-none focus:ring-1 focus:ring-indigo-300',
              factoryId ? 'border-indigo-400 text-foreground' : 'border-border text-muted-foreground',
            )}
          >
            <option value="">{t('strip.factoryAll')}</option>
            {factoryOpts.map((f) => (
              <option key={f.factoryId} value={f.factoryId}>
                {f.factoryName}
              </option>
            ))}
          </select>
        )}
        {!isTrack && (
          <div className="relative w-[190px]">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={selCust ? selCust.userSku : custQuery}
              onChange={(e) => {
                setSelCust(null);
                setCustQuery(e.target.value);
                setCustOpen(true);
              }}
              onFocus={() => setCustOpen(true)}
              onBlur={() => setCustOpen(false)}
              placeholder={t('strip.customerPlaceholder')}
              className={cn(
                'w-full h-7 pl-7 pr-6 rounded-md border bg-background text-xs outline-none focus:ring-1 focus:ring-indigo-300',
                selCust ? 'border-indigo-400' : 'border-border',
              )}
            />
            {(selCust || custQuery) && (
              <button
                type="button"
                onClick={() => {
                  setSelCust(null);
                  setCustQuery('');
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
            {/* Dropdown danh sách khách — mousedown preventDefault để không blur input trước khi click chọn */}
            {custOpen && (
              <div
                onMouseDown={(e) => e.preventDefault()}
                className="absolute left-0 top-full mt-1 w-[280px] max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md py-1 z-30"
              >
                {filteredCust.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">{t('strip.customerNoMatch')}</p>
                ) : (
                  filteredCust.map((c) => {
                    const isSelected = selCust?.userSku === c.userSku && selCust?.userEmail === c.userEmail;
                    return (
                      <button
                        key={`${c.userSku}|${c.userEmail}`}
                        type="button"
                        onClick={() => {
                          setSelCust({ userSku: c.userSku, userEmail: c.userEmail });
                          setCustQuery('');
                          setCustOpen(false);
                        }}
                        className={cn(
                          'w-full px-2 py-1.5 text-left hover:bg-accent flex items-center gap-2',
                          isSelected && 'bg-accent/60',
                        )}
                      >
                        <span className="text-xs font-medium text-foreground truncate">{c.userSku}</span>
                        {c.userEmail && (
                          <span className="text-[10px] text-muted-foreground truncate flex-1">{c.userEmail}</span>
                        )}
                        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                          {c.count.toLocaleString('en-US')}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
        {!isTrack && (
          <button
            type="button"
            onClick={() => setCancelledOpen(true)}
            title={t('strip.cancelledTitle')}
            className={cn(
              'h-7 px-2 inline-flex items-center gap-1 rounded-md border text-xs transition-colors',
              (totals?.cancelledInRange ?? 0) > 0
                ? 'border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100/70 dark:hover:bg-rose-950/40'
                : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            <Ban size={13} /> {t('strip.cancelled')}:{' '}
            <span className="font-semibold tabular-nums">
              {(totals?.cancelledInRange ?? 0).toLocaleString('en-US')}
            </span>
          </button>
        )}
        {isTrack && track && !trackError && (
          <span className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="font-semibold text-foreground">{track.productionId}</span>
            {track.userSku && <span>· {track.userSku}</span>}
            {track.type && <span>· {track.type}</span>}
            <span>
              ·{' '}
              {track.completed
                ? t('strip.completedAll')
                : t('strip.currentlyAt', {
                    stage: STAGE_SHORT[track.currentStageKey ?? ''] ?? track.currentStageKey ?? '—',
                  })}
            </span>
          </span>
        )}
      </div>

      {/* Hàng phễu — box chỉ hiện số, hover xem chi tiết. Luôn 1 dòng, không cuộn ngang */}
      {trackError ? (
        <div className="text-xs text-rose-600 px-1 py-2">{trackError}</div>
      ) : (
        <TooltipProvider delayDuration={100}>
          {/* Phones: 8 stages cannot share 390px, so the row scrolls on its own instead of widening the page. */}
          <div className={cn('flex items-stretch gap-1.5 transition-opacity max-md:overflow-x-auto max-md:pb-1', loading && 'opacity-60')}>
            {/* Card Tổng đơn tất cả */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-[104px] shrink-0 rounded-lg border border-indigo-300/60 bg-indigo-50/50 dark:bg-indigo-500/10 px-2.5 py-2.5 flex flex-col items-center justify-center gap-1.5 cursor-help">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 leading-none">
                    <Layers size={12} className="text-indigo-600" /> {t('strip.totalOrders')}
                  </span>
                  <span className="text-2xl font-bold tabular-nums leading-none text-indigo-700 dark:text-indigo-300">
                    {isTrack ? (track?.completed ? '✓' : '●') : fmt(totals?.totalOrders ?? 0)}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="min-w-[170px]">
                <div className="font-semibold mb-1">{t('strip.totalOrdersTooltip')}</div>
                {isTrack ? (
                  <div className="text-muted-foreground">
                    {track?.completed ? t('strip.completedFull') : t('strip.inProgressFull')}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    <Row label={t('strip.totalOrdersInRange')} value={totals?.totalOrders ?? 0} />
                    <Row label={t('strip.active')} value={totals?.totalActive ?? 0} />
                    <Row
                      label={t('strip.completed')}
                      value={totals?.completedInRange ?? 0}
                      cls="text-emerald-600 dark:text-emerald-400"
                    />
                  </div>
                )}
              </TooltipContent>
            </Tooltip>

            <ChevronRight size={14} className="shrink-0 self-center text-muted-foreground/40" />

            {isTrack ? (
              trackStages.map((n, i) => {
                const st = TRACK_STYLE[n.status] ?? TRACK_STYLE.pending;
                const StageIcon = STAGE_ICON[n.key] ?? Circle;
                const StatusIcon = st.icon;
                return (
                  <React.Fragment key={n.key}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'flex-1 min-w-0 rounded-lg border px-2 py-2.5 flex flex-col items-center justify-center gap-1.5 cursor-help',
                            st.chip,
                          )}
                        >
                          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground truncate max-w-full leading-none">
                            <StageIcon size={12} className="shrink-0" /> {n.label}
                          </span>
                          <StatusIcon size={24} className={st.color} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="font-semibold">{n.label}</div>
                        <div className="text-muted-foreground">{st.text}</div>
                      </TooltipContent>
                    </Tooltip>
                    {i < trackStages.length - 1 && (
                      <ChevronRight size={15} className="shrink-0 self-center text-muted-foreground/40" />
                    )}
                  </React.Fragment>
                );
              })
            ) : (
              <>
                {aggStages.map((n) => {
                  const isBottleneck = !!bottleneck && n.key === bottleneck && n.waiting > 0;
                  const StageIcon = STAGE_ICON[n.key] ?? Circle;
                  return (
                    <React.Fragment key={n.key}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              'flex-1 min-w-0 rounded-lg border px-2 py-2 flex flex-col items-center gap-1 cursor-help h-[120px] w-[200px] max-md:min-w-[84px]',
                              isBottleneck
                                ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-500/10 ring-1 ring-amber-300'
                                : 'border-border bg-background',
                            )}
                          >
                            {/* Tên chặng + icon */}
                            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground truncate max-w-full leading-none">
                              <StageIcon
                                size={12}
                                className={cn('shrink-0', isBottleneck ? 'text-amber-600' : 'text-primary')}
                              />{' '}
                              {n.label}
                            </span>
                            {/* Tổng */}
                            <span className="text-xl font-bold tabular-nums leading-none text-foreground">
                              {fmt(n.total)}
                            </span>
                            {/* 4 trạng thái 2×2 dưới tổng: chờ (TL) · làm (TR) · lại (BL) · xong (BR) */}
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 w-full h-full px-1 leading-none">
                              <span
                                className={cn(
                                  'flex items-center gap-1 justify-start text-[11px] font-semibold tabular-nums',
                                  n.waiting === 0 ? 'text-muted-foreground/40' : 'text-slate-600 dark:text-slate-300',
                                )}
                              >
                                {fmt(n.waiting)}
                              </span>
                              <span
                                className={cn(
                                  'flex items-center gap-1 justify-end text-[11px] font-semibold tabular-nums',
                                  n.inProgress === 0
                                    ? 'text-muted-foreground/40'
                                    : 'text-indigo-600 dark:text-indigo-300',
                                )}
                              >
                                {fmt(n.inProgress)}
                              </span>
                              <span
                                className={cn(
                                  'flex items-center gap-1 justify-start text-[11px] font-semibold tabular-nums',
                                  n.rework === 0 ? 'text-muted-foreground/40' : 'text-amber-600 dark:text-amber-300',
                                )}
                              >
                                {fmt(n.rework)}
                              </span>
                              <span
                                className={cn(
                                  'flex items-center gap-1 justify-end text-[11px] font-semibold tabular-nums',
                                  n.done === 0 ? 'text-muted-foreground/40' : 'text-emerald-600 dark:text-emerald-400',
                                )}
                              >
                                {fmt(n.done)}
                              </span>
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="min-w-[180px]">
                          <div className="font-semibold mb-1">
                            {n.label}
                            {isBottleneck && (
                              <span className="ml-1.5 text-[10px] uppercase text-amber-600">
                                {t('strip.bottleneckTag')}
                              </span>
                            )}
                          </div>
                          <Row label={t('strip.totalOrdersAtStage')} value={n.total} cls="text-foreground" />
                          <Row
                            icon={<Clock size={11} />}
                            label={t('strip.waiting')}
                            value={n.waiting}
                            cls="text-slate-600 dark:text-slate-300"
                          />
                          <Row
                            icon={<Activity size={11} />}
                            label={t('strip.inProgress')}
                            value={n.inProgress}
                            cls="text-indigo-600 dark:text-indigo-300"
                          />
                          <Row
                            icon={<RotateCw size={11} />}
                            label={t('strip.needRework')}
                            value={n.rework}
                            cls="text-amber-600 dark:text-amber-300"
                          />
                          <Row
                            icon={<CheckCircle2 size={11} />}
                            label={t('strip.doneOver')}
                            value={n.done}
                            cls="text-emerald-600 dark:text-emerald-400"
                          />
                        </TooltipContent>
                      </Tooltip>
                      <ChevronRight size={15} className="shrink-0 self-center text-muted-foreground/40" />
                    </React.Fragment>
                  );
                })}
                {/* Box Hoàn thành — sau Đóng hàng */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex-1 min-w-0 rounded-lg border border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-500/10 px-2 py-2.5 flex flex-col items-center justify-center gap-1.5 cursor-help">
                      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground truncate max-w-full leading-none">
                        <PackageCheck size={12} className="shrink-0 text-emerald-600" /> {t('strip.stages.done')}
                      </span>
                      <span className="text-2xl font-bold tabular-nums leading-none text-emerald-700 dark:text-emerald-300">
                        {fmt(totals?.completedInRange ?? 0)}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="min-w-[170px]">
                    <div className="font-semibold mb-1">{t('strip.completedTitle')}</div>
                    <Row
                      label={t('strip.completedDesc')}
                      value={totals?.completedInRange ?? 0}
                      cls="text-emerald-600 dark:text-emerald-400"
                    />
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>
        </TooltipProvider>
      )}

      <BulkProductionIdDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        mode="lookup"
        onPick={(code) => {
          setPid(code);
          setDebouncedPid(code);
        }}
      />

      <CancelledOrdersDialog
        open={cancelledOpen}
        onClose={() => setCancelledOpen(false)}
        from={from}
        to={to}
        factoryId={effectiveFactory || undefined}
        userSku={selCust?.userSku}
        userEmail={selCust?.userEmail || undefined}
      />
    </div>
  );
}
