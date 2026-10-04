import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Info, Minus, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CeoFinding, CeoOverview, CeoReport } from 'shared';
import { LIFECYCLE_STAGE_KEYS } from 'shared';

import { PATHS } from '@/constants/paths';

import { RepositoryRemote } from '@/services';

import { Button } from '@/components/ui/button';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { STAGE_COLORS } from '@/pages/orders/workshop/stageColors';

const iso = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD');
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtInt = (n: number) => n.toLocaleString('en-US');
/** Màu hex cho recharts (không nhận class Tailwind). Cùng bảng với `stageColors.ts`. */
const HEX: Record<string, string> = {
  'tool-check': '#94a3b8', designer: '#38bdf8', print: '#6366f1', press: '#fbbf24', 'qc-post-press': '#a78bfa',
  'sew-in': '#34d399', 'sew-out': '#14b8a6', pack: '#84cc16', done: '#047857',
  in: '#6366f1', out: '#10b981', errors: '#f43f5e', muted: 'hsl(var(--muted-foreground))', grid: 'hsl(var(--border))',
};
const SOURCE_HEX: Record<string, string> = { designer: '#38bdf8', factory: '#f59e0b', 'tool-check': '#94a3b8', unknown: '#cbd5e1' };

type Tone = 'good' | 'bad' | 'neutral';
/** Delta % so kỳ trước; `invert` cho chỉ số càng thấp càng tốt (lỗi, tồn). */
function Delta({ cur, prev, invert = false, suffix = '%' }: { cur: number; prev: number; invert?: boolean; suffix?: string }) {
  if (!prev) return <span className="text-[11px] text-muted-foreground">—</span>;
  const d = Math.round(((cur - prev) / prev) * 100);
  const tone: Tone = d === 0 ? 'neutral' : (d > 0) !== invert ? 'good' : 'bad';
  const Icon = d === 0 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums', tone === 'good' && 'text-emerald-600', tone === 'bad' && 'text-rose-600', tone === 'neutral' && 'text-muted-foreground')}>
      <Icon size={12} />
      {Math.abs(d)}
      {suffix}
    </span>
  );
}

function Kpi({ label, hint, value, delta, sub, onClick }: { label: string; hint?: string; value: string; delta?: React.ReactNode; sub?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} title={hint} className="flex flex-col rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold leading-none tabular-nums text-foreground">{value}</span>
        {delta}
      </span>
      {sub && <span className="mt-1 text-[11px] text-muted-foreground">{sub}</span>}
    </button>
  );
}

function Section({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

const SEV: Record<CeoFinding['severity'], { icon: React.ReactNode; cls: string }> = {
  critical: { icon: <XCircle size={14} />, cls: 'text-rose-600 dark:text-rose-300' },
  warning: { icon: <AlertTriangle size={14} />, cls: 'text-amber-600 dark:text-amber-300' },
  good: { icon: <CheckCircle2 size={14} />, cls: 'text-emerald-600 dark:text-emerald-300' },
  info: { icon: <Info size={14} />, cls: 'text-sky-600 dark:text-sky-300' },
};

/**
 * Bảng "Tổng quan điều hành" của CEO Dashboard (CeoDashboard.md, Plans/CeoDashboard-Overview.md):
 * MỘT request `GET /ceo/overview?from&to` → kết luận + việc cần làm (sinh theo luật ở BE) ·
 * 6 KPI so kỳ trước · vận hành theo ngày · SLA đúng hẹn · chất lượng · khách hàng ·
 * năng lực · nhân sự. Số nào bấm được thì mở trang Đơn hàng theo xưởng đúng bộ lọc.
 */
export function OverviewBoard() {
  const { t, i18n } = useTranslation('ceoDashboard');
  const { t: tOrders } = useTranslation('orders');
  const navigate = useNavigate();
  const [from, setFrom] = useState(() => iso(dayjs().subtract(6, 'day')));
  const [to, setTo] = useState(() => iso(dayjs()));
  const [data, setData] = useState<CeoOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<CeoReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const fetchReport = useCallback(async () => {
    try {
      const res = await RepositoryRemote.ceoDashboard.getReport(from, to);
      setReport((res.data?.data?.report || null) as CeoReport | null);
      setReportBusy(!!res.data?.data?.generating);
    } catch (err) {
      handleAxiosError(err);
    }
  }, [from, to]);
  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  // Sinh nhận định chạy NỀN ở BE → thăm dò mỗi 5s tới khi có bản mới (tối đa ~4 phút).
  const generateReport = async () => {
    setReportBusy(true);
    const before = report?.generatedAt;
    try {
      await RepositoryRemote.ceoDashboard.generateReport(from, to);
      for (let i = 0; i < 48; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const res = await RepositoryRemote.ceoDashboard.getReport(from, to);
        const next = (res.data?.data?.report || null) as CeoReport | null;
        if (next && next.generatedAt !== before) {
          setReport(next);
          break;
        }
        if (!res.data?.data?.generating) break;
      }
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setReportBusy(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await RepositoryRemote.ceoDashboard.getOverview(from, to);
      setData((res.data?.data || null) as CeoOverview | null);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const days = dayjs(to).diff(dayjs(from), 'day') + 1;
  const shift = (dir: 1 | -1) => {
    setFrom(iso(dayjs(from).add(dir * days, 'day')));
    setTo(iso(dayjs(to).add(dir * days, 'day')));
  };
  const presets: Array<[string, number]> = [
    [t('period.today'), 1],
    [t('period.week'), 7],
    [t('period.month'), 30],
  ];
  const go = (extra: Record<string, string> = {}) => navigate(`${PATHS.ORDERS_WORKSHOP}?${new URLSearchParams({ wfrom: from, wto: to, ...extra }).toString()}`);
  const stageLabel = (k: string) => (k === 'done' ? t('kpi.out') : tOrders(`workshopBoard.stages.${k}`));

  const d = data;
  const n2 = d?.sla.within.find((w) => w.n === 2);
  const actions = useMemo(() => {
    const seen = new Set<string>();
    return (d?.findings || []).filter((f) => f.action && !seen.has(f.action) && seen.add(f.action));
  }, [d?.findings]);
  const dailyChart = useMemo(
    () => (d?.production.daily || []).map((r) => ({ ...r, label: dayjs(r.day).format('DD/MM'), cur: r.day >= (d?.period.from || '') })),
    [d],
  );
  const curStart = dailyChart.find((r) => r.cur)?.label;
  const curEnd = dailyChart[dailyChart.length - 1]?.label;
  const fmtDay = (s: string) => dayjs(s).format('DD/MM');

  return (
    <div className={cn('space-y-4', loading && 'opacity-70 transition-opacity')}>
      {/* Kỳ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-9 items-center gap-0.5 rounded-md border border-input bg-background px-1">
            <button type="button" onClick={() => shift(-1)} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"><ChevronLeft size={14} /></button>
            <span className="inline-flex items-center gap-1.5 px-1.5 text-xs">
              <CalendarDays size={14} className="text-muted-foreground" />
              <span className="font-medium tabular-nums">{days === 1 ? fmtDay(from) : `${fmtDay(from)} → ${dayjs(to).format('DD/MM/YYYY')}`}</span>
            </span>
            <button type="button" onClick={() => shift(1)} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"><ChevronRight size={14} /></button>
          </div>
          <div className="inline-flex h-9 items-center rounded-md border border-input bg-muted/40 p-0.5">
            {presets.map(([label, n]) => {
              const active = days === n && to === iso(dayjs());
              return (
                <button key={label} type="button" onClick={() => { setTo(iso(dayjs())); setFrom(iso(dayjs().subtract(n - 1, 'day'))); }} className={cn('h-8 rounded px-3 text-xs font-medium transition-colors', active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              );
            })}
          </div>
          {d && (
            <span className="text-[11px] text-muted-foreground">
              {d.period.days === 1
                ? t('period.compareYesterday', { from: fmtDay(d.period.prevFrom) })
                : t('period.compare', { from: fmtDay(d.period.prevFrom), to: fmtDay(d.period.prevTo) })}
            </span>
          )}
        </div>
        {d && (
          <span className="text-[11px] text-muted-foreground">
            {t('period.updated', { time: dayjs(d.period.generatedAt).format('HH:mm') })} {d.period.cached && t('period.cached')}
          </span>
        )}
      </div>

      {/* Nhận định của hệ thống (Agent SDK viết từ chính số liệu bên dưới) */}
      {d && (
        <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 dark:border-indigo-900 dark:bg-indigo-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200/70 px-4 py-2.5 dark:border-indigo-900">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-600" />
              <h2 className="text-sm font-semibold">{t('report.title')}</h2>
              {report && (
                <span className="text-[11px] text-muted-foreground">
                  {t('report.by', { model: report.model, time: dayjs(report.generatedAt).format('HH:mm DD/MM'), trigger: t(`report.trigger.${report.trigger}`, { defaultValue: report.trigger }) })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] text-muted-foreground md:inline">{t('report.hint')}</span>
              <Button variant="outline" size="sm" className="h-8 bg-background" disabled={reportBusy} onClick={generateReport}>
                <RefreshCw size={13} className={reportBusy ? 'animate-spin' : ''} />
                {reportBusy ? t('report.generating') : t('report.generate')}
              </Button>
            </div>
          </div>
          <div className="p-4">
            {!report ? (
              <p className="text-sm text-muted-foreground">{t('report.empty')}</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-foreground">{report.tomTat}</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('report.ketLuan')}</div>
                    <ul className="space-y-1.5 text-sm">{report.ketLuan.map((x, i) => <li key={i} className="flex gap-2"><span className="text-indigo-600">•</span><span>{x}</span></li>)}</ul>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('report.viecCanLam')}</div>
                    <ol className="space-y-1.5 text-sm">{report.viecCanLam.map((x, i) => <li key={i} className="flex gap-2"><span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white">{i + 1}</span><span>{x}</span></li>)}</ol>
                  </div>
                </div>
                {(report.ruiRo.length > 0 || report.diemSang.length > 0) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {report.ruiRo.length > 0 && (
                      <div>
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-rose-600">{t('report.ruiRo')}</div>
                        <ul className="space-y-1 text-sm">{report.ruiRo.map((x, i) => <li key={i} className="flex gap-2"><span className="text-rose-500">•</span><span>{x}</span></li>)}</ul>
                      </div>
                    )}
                    {report.diemSang.length > 0 && (
                      <div>
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-emerald-600">{t('report.diemSang')}</div>
                        <ul className="space-y-1 text-sm">{report.diemSang.map((x, i) => <li key={i} className="flex gap-2"><span className="text-emerald-500">•</span><span>{x}</span></li>)}</ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Kết luận + việc cần làm */}
      {d && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Section title={t('findings.title')}>
            {d.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('findings.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {d.findings.map((f, i) => (
                  <li key={`${f.code}-${i}`} className="flex items-start gap-2 text-sm">
                    <span className={cn('mt-0.5 shrink-0', SEV[f.severity].cls)}>{SEV[f.severity].icon}</span>
                    <span className="text-foreground">
                      {t(`findings.${f.code}`, {
                        ...f.params,
                        source: t(`source.${String(f.params.source || 'unknown')}`, { defaultValue: String(f.params.source || '') }),
                        weekday: t(`weekday.${String(f.params.weekday ?? '')}`, { defaultValue: String(f.params.weekday ?? '') }),
                        day: f.params.day ? dayjs(String(f.params.day)).format('DD/MM') : '',
                        cohort: f.params.cohort ? dayjs(String(f.params.cohort)).format('DD/MM') : '',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={t('findings.actionsTitle')}>
            {actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('findings.noActions')}</p>
            ) : (
              <ol className="space-y-2">
                {actions.map((f, i) => (
                  <li key={f.action} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white">{i + 1}</span>
                    <span>{t(`actions.${f.action}`, f.params)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      )}

      {/* 6 KPI */}
      {d && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label={t('kpi.in')} value={fmtInt(d.production.in)} delta={<Delta cur={d.production.in} prev={d.production.prevIn} />} sub={d.production.reference ? t('kpi.ref', { sw: d.production.reference.sameWeekday.in, avg: d.production.reference.avg7.in }) : undefined} onClick={() => go()} />
          <Kpi label={t('kpi.out')} value={fmtInt(d.production.out)} delta={<Delta cur={d.production.out} prev={d.production.prevOut} />} sub={d.production.reference ? t('kpi.ref', { sw: d.production.reference.sameWeekday.out, avg: d.production.reference.avg7.out }) : undefined} onClick={() => go({ wstage: 'done' })} />
          <Kpi label={t('kpi.revenue')} hint={t('kpi.revenueHint')} value={fmtMoney(d.revenue.total)} delta={<Delta cur={d.revenue.total} prev={d.revenue.prev} />} sub={`${t('kpi.avgOrder')} $${d.revenue.avgPerOrder.toFixed(2)}`} />
          <Kpi label={t('kpi.n2')} hint={t('kpi.n2Hint')} value={n2?.pct === null || n2?.pct === undefined ? '—' : `${n2.pct}%`} delta={n2?.pct != null && d.sla.prevN2Pct != null ? <Delta cur={n2.pct} prev={d.sla.prevN2Pct} suffix="%" /> : undefined} sub={t('sla.mature', { n: d.sla.mature })} />
          <Kpi label={t('kpi.errorRate')} value={d.quality.ratePct == null ? '—' : `${d.quality.ratePct}%`} delta={d.quality.ratePct != null && d.quality.prevRatePct ? <Delta cur={d.quality.ratePct} prev={d.quality.prevRatePct} invert /> : undefined} sub={`${d.quality.errored} ${t('types.orders', { defaultValue: 'đơn' })}`} onClick={() => go({ werrfile: '__any__' })} />
          <Kpi label={t('kpi.backlog')} hint={t('kpi.backlogHint')} value={fmtInt(d.capacity.backlog)} delta={<Delta cur={d.capacity.backlog} prev={d.capacity.prevBacklog} invert />} sub={d.capacity.avgAgeDays != null ? t('capacity.avgAge', { n: d.capacity.avgAgeDays }) : undefined} />
        </div>
      )}

      {/* Vận hành theo ngày */}
      {d && (
        <Section title={t('ops.title')} hint={t('ops.hint')}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyChart} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke={HEX.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: HEX.muted }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: HEX.muted }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="err" orientation="right" tick={{ fontSize: 11, fill: HEX.errors }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                {curStart && curEnd && <ReferenceArea x1={curStart} x2={curEnd} fill="#6366f1" fillOpacity={0.06} />}
                <Bar dataKey="in" name={t('ops.in')} fill={HEX.in} radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar dataKey="out" name={t('ops.out')} fill={HEX.out} radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Line yAxisId="err" type="monotone" dataKey="errors" name={t('ops.errors')} stroke={HEX.errors} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {d && (
        <div className="grid gap-4 xl:grid-cols-2">
          {/* SLA */}
          <Section title={t('sla.title')} hint={d.period.days === 1 ? t('sla.cohort', { from: fmtDay(d.sla.cohortFrom) }) : t('sla.hint')}>
            <div className="space-y-3">
              {d.sla.within.map((w) => {
                const target = d.sla.targets.find((x) => x.n === w.n)?.pct ?? 0;
                const ok = (w.pct ?? 0) >= target;
                return (
                  <div key={w.n}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{t('sla.within', { n: w.n })}</span>
                      <span className="tabular-nums text-muted-foreground">
                        <b className={cn(ok ? 'text-emerald-600' : 'text-rose-600')}>{w.pct == null ? '—' : `${w.pct}%`}</b> · {t('sla.target', { pct: target })}
                      </span>
                    </div>
                    <div className="relative mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className={cn('h-full rounded-full', ok ? 'bg-emerald-500' : 'bg-rose-500')} style={{ width: `${Math.min(100, w.pct ?? 0)}%` }} />
                      <span className="absolute top-0 h-full w-px bg-foreground/60" style={{ left: `${target}%` }} />
                    </div>
                  </div>
                );
              })}
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">{t('sla.dailyTitle')}</div>
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={d.sla.dailyN2.map((r) => ({ ...r, label: fmtDay(r.day), pct: r.pct ?? 0 }))} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: HEX.muted }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: HEX.muted }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => `${v}%`} />
                      <Bar dataKey="pct" name="N2" radius={[3, 3, 0, 0]} maxBarSize={22}>
                        {d.sla.dailyN2.map((r) => <Cell key={r.day} fill={(r.pct ?? 0) >= 100 ? '#10b981' : (r.pct ?? 0) >= 80 ? '#f59e0b' : '#f43f5e'} />)}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{t('sla.overdueTitle')} · <b className={cn(d.sla.overdue.total ? 'text-rose-600' : 'text-emerald-600')}>{d.sla.overdue.total}</b> {d.sla.overdue.byFactory.map((f) => `${f.shortName || '?'} ${f.count}`).join(' · ')}</span>
                </div>
                {d.sla.overdue.total === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('sla.none')}</p>
                ) : (
                  <ul className="divide-y divide-border text-xs">
                    {d.sla.overdue.sample.map((o) => (
                      <li key={o.productionId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 sm:flex-nowrap sm:justify-between sm:py-1.5">
                        {/* Phones: id and age share the first line, the rest wraps beneath (flex order); one row from sm up. */}
                        <span className="order-1 font-mono font-semibold">{o.productionId}</span>
                        <span className="order-2 ml-auto whitespace-nowrap tabular-nums text-rose-600 sm:order-5 sm:ml-0">{t('sla.age', { n: o.ageDays })}</span>
                        <span className="order-3 basis-full sm:hidden" aria-hidden />
                        <span className="order-4 text-muted-foreground sm:order-2">{o.userSku}</span>
                        <span className="order-4 text-muted-foreground sm:order-3">{o.factory}</span>
                        <span className={cn('order-4 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium sm:order-4', STAGE_COLORS[o.stage as keyof typeof STAGE_COLORS]?.chip || 'bg-muted')}>{stageLabel(o.stage)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>

          {/* Chất lượng */}
          <Section title={t('quality.title')} hint={t('quality.hint')}>
            {d.quality.errored === 0 ? (
              <p className="text-sm text-muted-foreground">{t('quality.none')}</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={d.quality.bySource} dataKey="count" nameKey="source" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
                        {d.quality.bySource.map((s) => <Cell key={s.source} fill={SOURCE_HEX[s.source] || SOURCE_HEX.unknown} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number, name: string) => [v, t(`source.${name}`, { defaultValue: name })]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-[11px] text-muted-foreground">{t('quality.bySource')}</div>
                    <ul className="space-y-1 text-xs">
                      {d.quality.bySource.map((s) => (
                        <li key={s.source} className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: SOURCE_HEX[s.source] || SOURCE_HEX.unknown }} />
                          <span className="flex-1">{t(`source.${s.source}`, { defaultValue: s.source })}</span>
                          <span className="tabular-nums"><b>{s.count}</b> · {Math.round((s.count / d.quality.errored) * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-muted-foreground">{t('quality.topTypes')}</div>
                    <ul className="space-y-1 text-xs">
                      {d.quality.topTypes.map((x) => (
                        <li key={x.type} className="flex items-center justify-between gap-2">
                          <button type="button" onClick={() => go({ wtype: x.type || '__none__', werrfile: '__any__' })} className="truncate text-left hover:text-indigo-700">{x.type || tOrders('tableWorkshop.noTypeName')}</button>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{t('quality.ofTotal', { count: x.count, total: x.total })}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>
      )}

      {/* Khách hàng */}
      {d && (
        <Section title={t('customers.title')} hint={t('customers.hint')}>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
            <span><b className="text-base tabular-nums">{d.customers.active}</b> {t('customers.active')} <Delta cur={d.customers.active} prev={d.customers.prevActive} /></span>
            <span><b className="tabular-nums">{d.customers.newCount}</b> {t('customers.new')}</span>
            {d.customers.top10SharePct != null && <span>{t('customers.share')} <b className="tabular-nums">{d.customers.top10SharePct}%</b></span>}
            {d.customers.rising.length > 0 && <span className="text-emerald-700">{t('customers.rising')}: {d.customers.rising.map((r) => `${r.userSku} ${r.prevOrders}→${r.orders}`).join(' · ')}</span>}
            {d.customers.dropping.length > 0 && <span className="text-rose-700">{t('customers.dropping')}: {d.customers.dropping.map((r) => `${r.userSku} ${r.prevOrders}→${r.orders}`).join(' · ')}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 bg-card py-1.5 pr-3 font-medium">{t('customers.cols.customer')}</th>
                  <th className="whitespace-nowrap py-1.5 pr-3 text-right font-medium">{t('customers.cols.orders')}</th>
                  <th className="whitespace-nowrap py-1.5 pr-3 text-right font-medium">{t('customers.cols.prev')}</th>
                  <th className="whitespace-nowrap py-1.5 pr-3 text-right font-medium">{t('customers.cols.revenue')}</th>
                  <th className="whitespace-nowrap py-1.5 text-right font-medium">{t('customers.cols.issues')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.customers.top.map((c) => (
                  <tr key={c.userSku} className="hover:bg-muted/40">
                    <td className="sticky left-0 whitespace-nowrap bg-card py-1.5 pr-3">
                      <button type="button" onClick={() => go({ wusersku: c.userSku })} className="font-medium hover:text-indigo-700">{c.userSku}</button>
                      {c.tier != null && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">{t('customers.vip', { tier: c.tier })}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums"><b>{c.orders}</b> <Delta cur={c.orders} prev={c.prevOrders} /></td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{c.prevOrders}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtMoney(c.revenue)}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.held + c.errored > 0 ? <span className="text-rose-600">{c.held}/{c.errored}</span> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Năng lực */}
      {d && (
        <Section title={t('capacity.title')} hint={t('capacity.hint')}>
          <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.capacity.history.map((r) => ({ ...r, label: fmtDay(r.day) }))} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="bl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke={HEX.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: HEX.muted }} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={{ fontSize: 11, fill: HEX.muted }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="backlog" name={t('kpi.backlog')} stroke="#6366f1" strokeWidth={2} fill="url(#bl)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">{t('capacity.byStage')}</div>
              <ul className="space-y-1 text-xs">
                {[...LIFECYCLE_STAGE_KEYS].map((k) => {
                  const n = d.capacity.byStage.find((s) => s.stage === k)?.count || 0;
                  const max = Math.max(1, ...d.capacity.byStage.map((s) => s.count));
                  return (
                    <li key={k} className="flex items-center gap-2">
                      <span className="w-20 truncate text-muted-foreground">{stageLabel(k)}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className={cn('block h-full', STAGE_COLORS[k].bar)} style={{ width: `${(n / max) * 100}%` }} /></span>
                      <span className="w-8 text-right tabular-nums">{n}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          {d.capacity.staleOpen > 0 && (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {t('capacity.stale', { n: d.capacity.staleOpen.toLocaleString('en-US'), days: d.capacity.staleDays })}
            </p>
          )}
          <div className="mt-4 overflow-x-auto">
            <div className="mb-1 text-[11px] text-muted-foreground">{t('capacity.factoryTitle')}</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  {(['factory', 'in', 'out', 'backlog', 'perDay', 'clear', 'n2', 'errors'] as const).map((k) => (
                    <th key={k} className={cn('whitespace-nowrap py-1.5 pr-3 font-medium', k === 'factory' ? 'sticky left-0 bg-card' : 'text-right')}>{t(`capacity.cols.${k}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.production.byFactory.map((f) => (
                  <tr key={f.factoryId} className="hover:bg-muted/40">
                    <td className="sticky left-0 whitespace-nowrap bg-card py-1.5 pr-3 font-medium"><button type="button" onClick={() => navigate(`${PATHS.ORDERS_WORKSHOP}?wfrom=${from}&wto=${to}&factoryId=${f.factoryId}`)} className="hover:text-indigo-700">{f.shortName ? `${f.shortName} · ${f.name}` : f.name}</button></td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{f.in}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{f.out}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{f.backlog}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{f.outPerDay}</td>
                    <td className={cn('py-1.5 pr-3 text-right tabular-nums', (f.daysToClear ?? 0) >= 3 && 'text-rose-600')}>{f.daysToClear == null ? t('capacity.na') : t('capacity.days', { n: f.daysToClear })}</td>
                    <td className={cn('py-1.5 pr-3 text-right tabular-nums', f.n2Pct != null && f.n2Pct < 100 && 'text-amber-600')}>{f.n2Pct == null ? t('capacity.na') : `${f.n2Pct}%`}</td>
                    <td className="py-1.5 text-right tabular-nums">{f.errored}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Nhân sự */}
      {d && (
        <Section title={t('people.title')} hint={t('people.hint')}>
          <div className="grid gap-4 xl:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">{t('people.designers')}</div>
              {d.people.designers.length === 0 ? <p className="text-xs text-muted-foreground">{t('people.none')}</p> : (
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="py-1.5 font-medium">{t('people.cols.name')}</th><th className="py-1.5 text-right font-medium">{t('people.cols.done')}</th><th className="py-1.5 text-right font-medium">{t('people.cols.backlog')}</th><th className="py-1.5 text-right font-medium">{t('people.cols.rework')}</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {d.people.designers.slice(0, 12).map((p) => (
                      <tr key={p.userId}><td className="py-1.5 font-medium">{p.name}</td><td className="py-1.5 text-right tabular-nums">{p.done}</td><td className={cn('py-1.5 text-right tabular-nums', p.backlog >= 30 && 'text-rose-600 font-semibold')}>{p.backlog}</td><td className="py-1.5 text-right tabular-nums text-muted-foreground">{p.rework}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div className="mb-1 text-[11px] text-muted-foreground">{t('people.workers')}</div>
              {d.people.workers.length === 0 ? <p className="text-xs text-muted-foreground">{t('people.none')}</p> : (
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="py-1.5 font-medium">{t('people.cols.name')}</th><th className="py-1.5 font-medium">{t('people.cols.stage')}</th><th className="py-1.5 text-right font-medium">{t('people.cols.done')}</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {d.people.workers.slice(0, 12).map((w) => (
                      <tr key={`${w.userId}-${w.stage}`}><td className="py-1.5 font-medium">{w.name}</td><td className="py-1.5"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', STAGE_COLORS[w.stage as keyof typeof STAGE_COLORS]?.chip || 'bg-muted')}>{stageLabel(w.stage)}</span></td><td className="py-1.5 text-right tabular-nums">{w.done}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </Section>
      )}

      <p className="px-1 text-[11px] text-muted-foreground">{t('sourceNote')}{i18n.language === 'vi' ? '' : ''}</p>
    </div>
  );
}
