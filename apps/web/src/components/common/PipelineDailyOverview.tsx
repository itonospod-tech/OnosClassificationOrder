import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CalendarRange, ChevronDown, X } from 'lucide-react';
import type { FulfillmentDailyColumnTotals, FulfillmentDailyRow, FulfillmentStage } from 'shared';
import { FULFILLMENT_STAGES } from 'shared';

import { RepositoryRemote } from '@/services';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { getStageLabel } from '@/utils/fulfillmentStageLabel';

import { useIsMobile } from '@/hooks/useMediaQuery';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

const EMERALD = 'text-emerald-600 dark:text-emerald-400';
const AMBER = 'text-amber-600 dark:text-amber-400';
const RED = 'text-red-600 dark:text-red-400';
const INDIGO = 'text-indigo-600 dark:text-indigo-400';
const TEAL = 'text-teal-600 dark:text-teal-400';
const MUTED = 'text-muted-foreground';

/** Nguồn số liệu 1 cột — dùng chung cho 1 ngày và cột "Tổng" (cùng shape). */
type Metrics = Omit<FulfillmentDailyRow, 'day'>;

interface Data {
  days: FulfillmentDailyRow[];
  columnTotals: FulfillmentDailyColumnTotals;
  rangeDays: number;
}

const EMPTY_TOTALS: FulfillmentDailyColumnTotals = {
  total: 0,
  toolReviewed: 0,
  toolUnreviewed: 0,
  toolOk: 0,
  designerReceived: 0,
  designerDone: 0,
  designerRework: 0,
  designerFixed: 0,
  stages: {},
};

const EMPTY: Data = { days: [], columnTotals: EMPTY_TOTALS, rangeDays: 0 };

function fmtHead(day: string): { wd: string; dm: string } {
  const d = new Date(`${day}T12:00:00+07:00`);
  return {
    wd: WEEKDAYS[d.getDay()] ?? '',
    dm: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
  };
}

// ─── Row descriptors ────────────────────────────────────────────────────────
type Tone = 'neutral' | 'highlight' | 'dim' | 'danger';

interface RowDesc {
  key: string;
  label: string;
  /** Hàng con (thụt lề) trong khối stage/lane của user. */
  indent?: boolean;
  /** Hàng tiêu đề khối lane user — chỉ nhãn, không số. */
  header?: boolean;
  tone: Tone;
  /** 1 số / ô (căn trái). */
  single?: (m: Metrics) => number;
  singleCls?: string;
  /** 2 số / ô: [đã làm, còn lại] — slash căn giữa. */
  dual?: (m: Metrics) => [number, number];
  dualCls?: [string, string];
  /** Hàng công đoạn/lane: hiện `0` khi giá trị = 0 (thay vì dấu `·`). */
  showZero?: boolean;
  /** Tooltip mô tả chi tiết ô (`day` = 'dd/MM' hoặc 'cả kỳ'). */
  tip: (m: Metrics, day: string) => string;
}

/** Lane highlight (loại trừ lẫn nhau với `stage`). */
export type OverviewLane = 'tool' | 'designer';

interface Props {
  /**
   * Stage fulfillment của user (highlight + bung 4 hàng). Undefined → không
   * highlight stage nào. Dùng ở trang Task Fulfillment.
   */
  stage?: FulfillmentStage;
  /**
   * Lane highlight: `'designer'` (trang Designer my-tasks) hoặc `'tool'` (tab Soát
   * tool). Bung hàng tương ứng thành header + 4 hàng con. Loại trừ với `stage`.
   */
  lane?: OverviewLane;
  /** Khoảng ngày (YYYY-MM-DD VN). Rỗng cả 2 → BE default 7 ngày. */
  from?: string;
  to?: string;
  /** Bump để refetch sau transition/refresh. */
  reloadToken?: number;
  /** Ngày đang lọc (YYYY-MM-DD) — highlight cột. */
  dayFilter?: string;
  /** Click 1 ngày (header/ô) → toggle lọc danh sách bên dưới. */
  onPickDay?: (day: string) => void;
  /** Ghi chú phụ trong header (vd nhắc phạm vi toàn cục). Thay caption mặc định. */
  caption?: React.ReactNode;
}

function buildRows(
  t: TFunction<'dashboard'>,
  stage: FulfillmentStage | undefined,
  lane: OverviewLane | undefined,
): RowDesc[] {
  const list: RowDesc[] = [
    {
      key: 'total',
      label: t('pipelineOverview.labels.total'),
      tone: 'neutral',
      single: (m) => m.total,
      singleCls: 'text-foreground',
      tip: (m, d) => t('pipelineOverview.tips.total', { day: d, count: m.total }),
    },
  ];

  // ─── Lane "Soát tool" ───────────────────────────────────────────────
  if (lane === 'tool') {
    list.push({
      key: 'tool-h',
      label: t('pipelineOverview.labels.toolCheck'),
      header: true,
      tone: 'highlight',
      tip: (_m, d) => t('pipelineOverview.tips.yourStage', { day: d, label: t('pipelineOverview.labels.toolCheck') }),
    });
    list.push({
      key: 'tool-unreviewed',
      label: t('pipelineOverview.labels.unreviewed'),
      indent: true,
      tone: 'highlight',
      showZero: true,
      single: (m) => m.toolUnreviewed,
      singleCls: AMBER,
      tip: (m, d) => t('pipelineOverview.tips.toolUnreviewed', { day: d, count: m.toolUnreviewed }),
    });
    list.push({
      key: 'tool-reviewed',
      label: t('pipelineOverview.labels.reviewed'),
      indent: true,
      tone: 'highlight',
      showZero: true,
      single: (m) => m.toolReviewed,
      singleCls: 'text-foreground',
      tip: (m, d) => t('pipelineOverview.tips.toolReviewed', { day: d, count: m.toolReviewed }),
    });
    list.push({
      key: 'tool-error',
      label: t('pipelineOverview.labels.error'),
      indent: true,
      tone: 'danger',
      showZero: true,
      single: (m) => Math.max(0, m.toolReviewed - m.toolOk),
      singleCls: RED,
      tip: (m, d) => t('pipelineOverview.tips.toolError', { day: d, count: Math.max(0, m.toolReviewed - m.toolOk) }),
    });
    list.push({
      key: 'tool-ok',
      label: t('pipelineOverview.labels.ok'),
      indent: true,
      tone: 'highlight',
      showZero: true,
      single: (m) => m.toolOk,
      singleCls: EMERALD,
      tip: (m, d) => t('pipelineOverview.tips.toolOk', { day: d, count: m.toolOk }),
    });
  } else {
    list.push({
      key: 'tool',
      label: t('pipelineOverview.labels.toolCheck'),
      tone: 'neutral',
      dual: (m) => [m.toolReviewed, m.toolUnreviewed],
      dualCls: [EMERALD, AMBER],
      tip: (m, d) => t('pipelineOverview.tips.toolDual', { day: d, done: m.toolReviewed, left: m.toolUnreviewed }),
    });
  }

  // ─── Lane "Designer" ────────────────────────────────────────────────
  if (lane === 'designer') {
    list.push({
      key: 'designer-h',
      label: t('pipelineOverview.labels.designer'),
      header: true,
      tone: 'highlight',
      tip: (_m, d) => t('pipelineOverview.tips.yourStage', { day: d, label: t('pipelineOverview.labels.designer') }),
    });
    list.push({
      key: 'designer-received',
      label: t('pipelineOverview.labels.received'),
      indent: true,
      tone: 'highlight',
      showZero: true,
      single: (m) => m.designerReceived,
      singleCls: 'text-foreground',
      tip: (m, d) => t('pipelineOverview.tips.designerReceived', { day: d, count: m.designerReceived }),
    });
    list.push({
      key: 'designer-done',
      label: t('pipelineOverview.labels.done'),
      indent: true,
      tone: 'highlight',
      showZero: true,
      single: (m) => Math.max(0, m.designerDone - m.designerFixed),
      singleCls: EMERALD,
      tip: (m, d) =>
        t('pipelineOverview.tips.designerDone', {
          day: d,
          count: Math.max(0, m.designerDone - m.designerFixed),
          fixed: m.designerFixed,
        }),
    });
    list.push({
      key: 'designer-fixed',
      label: t('pipelineOverview.labels.fixed'),
      indent: true,
      tone: 'highlight',
      showZero: true,
      single: (m) => m.designerFixed,
      singleCls: TEAL,
      tip: (m, d) => t('pipelineOverview.tips.designerFixed', { day: d, count: m.designerFixed }),
    });
    list.push({
      key: 'designer-remaining',
      label: t('pipelineOverview.labels.remaining'),
      indent: true,
      tone: 'highlight',
      showZero: true,
      single: (m) => Math.max(0, m.designerReceived - m.designerDone - m.designerRework),
      singleCls: INDIGO,
      tip: (m, d) =>
        t('pipelineOverview.tips.designerRemaining', {
          day: d,
          count: Math.max(0, m.designerReceived - m.designerDone - m.designerRework),
        }),
    });
    list.push({
      key: 'designer-rework',
      label: t('pipelineOverview.labels.rework'),
      indent: true,
      tone: 'danger',
      showZero: true,
      single: (m) => m.designerRework,
      singleCls: RED,
      tip: (m, d) => t('pipelineOverview.tips.designerRework', { day: d, count: m.designerRework }),
    });
  } else {
    list.push({
      key: 'designer',
      label: t('pipelineOverview.labels.designer'),
      tone: 'neutral',
      dual: (m) => [m.designerDone, Math.max(0, m.designerReceived - m.designerDone)],
      dualCls: [EMERALD, INDIGO],
      tip: (m, d) =>
        t('pipelineOverview.tips.designerDual', {
          day: d,
          done: m.designerDone,
          left: Math.max(0, m.designerReceived - m.designerDone),
          received: m.designerReceived,
        }),
    });
  }

  // ─── 6 stage fulfillment ────────────────────────────────────────────
  for (const st of FULFILLMENT_STAGES) {
    const label = getStageLabel(t, st);
    if (st === stage) {
      list.push({
        key: `${st}-h`,
        label,
        header: true,
        tone: 'highlight',
        tip: (_m, d) => t('pipelineOverview.tips.yourStage', { day: d, label }),
      });
      list.push({
        key: `${st}-arrived`,
        label: t('pipelineOverview.labels.arrived'),
        indent: true,
        tone: 'highlight',
        showZero: true,
        single: (m) => m.stages[st]?.arrived ?? 0,
        singleCls: 'text-foreground',
        tip: (m, d) => t('pipelineOverview.tips.stageArrived', { day: d, label, count: m.stages[st]?.arrived ?? 0 }),
      });
      list.push({
        key: `${st}-done`,
        label: t('pipelineOverview.labels.done'),
        indent: true,
        tone: 'highlight',
        showZero: true,
        single: (m) => Math.max(0, (m.stages[st]?.done ?? 0) - (m.stages[st]?.fixed ?? 0)),
        singleCls: EMERALD,
        tip: (m, d) =>
          t('pipelineOverview.tips.stageDone', {
            day: d,
            label,
            count: Math.max(0, (m.stages[st]?.done ?? 0) - (m.stages[st]?.fixed ?? 0)),
            fixed: m.stages[st]?.fixed ?? 0,
          }),
      });
      list.push({
        key: `${st}-fixed`,
        label: t('pipelineOverview.labels.fixed'),
        indent: true,
        tone: 'highlight',
        showZero: true,
        single: (m) => m.stages[st]?.fixed ?? 0,
        singleCls: TEAL,
        tip: (m, d) => t('pipelineOverview.tips.stageFixed', { day: d, label, count: m.stages[st]?.fixed ?? 0 }),
      });
      list.push({
        key: `${st}-remaining`,
        label: t('pipelineOverview.labels.remaining'),
        indent: true,
        tone: 'highlight',
        showZero: true,
        single: (m) => m.stages[st]?.remaining ?? 0,
        singleCls: INDIGO,
        tip: (m, d) =>
          t('pipelineOverview.tips.stageRemaining', { day: d, label, count: m.stages[st]?.remaining ?? 0 }),
      });
      list.push({
        key: `${st}-rework`,
        label: t('pipelineOverview.labels.rework'),
        indent: true,
        tone: 'danger',
        showZero: true,
        single: (m) => m.stages[st]?.rework ?? 0,
        singleCls: RED,
        tip: (m, d) => t('pipelineOverview.tips.stageRework', { day: d, label, count: m.stages[st]?.rework ?? 0 }),
      });
    } else {
      list.push({
        key: st,
        label,
        tone: 'dim',
        showZero: true,
        dual: (m) => [m.stages[st]?.done ?? 0, Math.max(0, (m.stages[st]?.arrived ?? 0) - (m.stages[st]?.done ?? 0))],
        dualCls: [EMERALD, INDIGO],
        tip: (m, d) => {
          const s = m.stages[st];
          const left = Math.max(0, (s?.arrived ?? 0) - (s?.done ?? 0));
          return t('pipelineOverview.tips.stageDual', {
            day: d,
            label,
            done: s?.done ?? 0,
            left,
            arrived: s?.arrived ?? 0,
          });
        },
      });
    }
  }
  return list;
}

/**
 * Bảng tổng quan theo ngày FULL luồng (Task Fulfillment / Designer / Soát tool),
 * gom theo `inProductionAt` (VN) — funnel TOÀN CỤC (không scope assignee). Mỗi
 * ngày 1 cột; hàng: Tổng đơn → Soát tool (đã/chưa) → Designer (đã làm/còn lại) →
 * 6 stage (đã xong/còn lại). Lane/stage của user bung 4 hàng con; hàng "Lỗi" tô
 * đỏ. Mỗi ô có tooltip. Ô 2 số chia đều 2 bên (slash giữa); hàng bung hiện `0`.
 */
export function PipelineDailyOverview({ stage, lane, from, to, reloadToken, dayFilter, onPickDay, caption }: Props) {
  const { t } = useTranslation('dashboard');
  const [data, setData] = useState<Data>(EMPTY);
  const [loading, setLoading] = useState(false);
  // Phones: the matrix is wider than the screen and pushed the worker's real task list below the
  // fold, so it starts folded to a one-line summary and opens on tap. Wide screens: always open.
  const isMobile = useIsMobile();
  const [openOnMobile, setOpenOnMobile] = useState(false);
  const expanded = !isMobile || openOnMobile;
  const seqRef = useRef(0);
  // Tooltip tự vẽ (hiện NGAY khi di chuột, không dùng title mặc định của trình duyệt).
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const showTip = (text: string, e: React.MouseEvent) => setTip({ text, x: e.clientX, y: e.clientY });
  const hideTip = () => setTip(null);

  useEffect(() => {
    const seq = ++seqRef.current;
    (async () => {
      try {
        setLoading(true);
        const res = await RepositoryRemote.fulfillment.dailyOverview({
          ...(stage ? { stage } : {}),
          ...(from && to ? { from, to } : {}),
        });
        if (seq !== seqRef.current) return;
        const raw = (res.data?.data as Data) || EMPTY;
        // BE trả mới→cũ → reverse để hiển thị cũ→mới (trái→phải).
        setData({ ...raw, days: [...raw.days].reverse() });
      } catch (err) {
        if (seq === seqRef.current) handleAxiosError(err);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    })();
  }, [stage, from, to, reloadToken]);

  const { days, columnTotals } = data;

  const rows = useMemo<RowDesc[]>(() => buildRows(t, stage, lane), [t, stage, lane]);

  const renderCell = (row: RowDesc, m: Metrics) => {
    if (row.header) return null;
    // 0: hàng bung (`showZero`) hiện "0" (muted); các hàng khác hiện "·".
    const num = (v: number, cls: string) => {
      if (v !== 0) return <span className={cls}>{v}</span>;
      return row.showZero ? (
        <span className="text-muted-foreground/50">0</span>
      ) : (
        <span className="text-muted-foreground/30">·</span>
      );
    };
    if (row.single) {
      return <div className="text-left font-semibold">{num(row.single(m), row.singleCls ?? '')}</div>;
    }
    const [a, b] = row.dual!(m);
    const [clsA, clsB] = row.dualCls ?? [EMERALD, MUTED];
    // Chia 2 bên đều nhau: giá trị trái sát trái, phải sát phải, slash căn giữa.
    return (
      <div className="grid grid-cols-[1fr_auto_1fr] items-center font-semibold">
        <span className="text-left">{num(a, clsA)}</span>
        <span className="text-muted-foreground/40 px-1">/</span>
        <span className="text-right">{num(b, clsB)}</span>
      </div>
    );
  };

  const rowBgCls = (tone: Tone) =>
    tone === 'highlight'
      ? 'bg-indigo-50/60 dark:bg-indigo-500/10'
      : tone === 'danger'
        ? 'bg-red-50/70 dark:bg-red-500/10'
        : tone === 'dim'
          ? 'opacity-70'
          : '';

  const labelCls = (row: RowDesc) => {
    if (row.tone === 'highlight') return 'text-indigo-700 dark:text-indigo-300 font-semibold';
    if (row.tone === 'danger') return `${RED} font-semibold`;
    if (row.tone === 'dim') return 'text-muted-foreground';
    return 'font-medium text-foreground';
  };

  const labelBgCls = (tone: Tone) =>
    tone === 'highlight'
      ? 'bg-indigo-50 dark:bg-indigo-500/10'
      : tone === 'danger'
        ? 'bg-red-50 dark:bg-red-500/10'
        : 'bg-card';

  // Folded summary: the rows the user's own stage/lane highlights (arrived / done / remaining / to
  // redo), totalled over the whole period — what a worker wants to know before opening the matrix.
  const summary = useMemo(
    () =>
      rows
        .filter((r) => r.indent && (r.tone === 'highlight' || r.tone === 'danger'))
        .map((r) => {
          if (r.single)
            return { key: r.key, label: r.label, value: String(r.single(columnTotals)), danger: r.tone === 'danger' };
          if (r.dual) {
            const [a, b] = r.dual(columnTotals);
            return { key: r.key, label: r.label, value: `${a}/${b}`, danger: r.tone === 'danger' };
          }
          return null;
        })
        .filter((x): x is { key: string; label: string; value: string; danger: boolean } => !!x),
    [rows, columnTotals],
  );

  return (
    <div className="rounded-md border border-border bg-card">
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2',
          expanded && 'border-b border-border',
          isMobile && 'min-h-11 cursor-pointer',
        )}
        {...(isMobile
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': expanded,
              onClick: () => setOpenOnMobile((v) => !v),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenOnMobile((v) => !v);
                }
              },
            }
          : {})}
      >
        <CalendarRange size={15} className="text-indigo-600" />
        <span className="text-sm font-semibold">{t('pipelineOverview.title')}</span>
        <span className="hidden md:inline text-[11px] text-muted-foreground">
          {caption ?? (
            <>
              — {t('pipelineOverview.captionPrefix')} · {t('pipelineOverview.captionCellFormat')} ={' '}
              <b className="text-emerald-600">{t('pipelineOverview.labels.done')}</b>/
              <b className="text-indigo-600">{t('pipelineOverview.labels.remaining')}</b> ·{' '}
              {t('pipelineOverview.captionSuffix')}
            </>
          )}
        </span>
        {isMobile && (
          <ChevronDown
            size={16}
            className={cn('ml-auto shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          />
        )}
        {dayFilter && onPickDay && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPickDay(dayFilter);
            }}
            className="ml-auto inline-flex items-center gap-1 text-[11px] rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2 py-0.5"
          >
            {t('pipelineOverview.filtering', { date: fmtHead(dayFilter).dm })}
            <X size={11} />
          </button>
        )}
      </div>

      {isMobile && !expanded && summary.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          {summary.map((x) => (
            <span
              key={x.key}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs',
                x.danger ? 'bg-tone-danger/10 text-tone-danger' : 'bg-muted text-muted-foreground',
              )}
            >
              {x.label}
              <b className={cn('tabular-nums', x.danger ? 'text-tone-danger' : 'text-foreground')}>{x.value}</b>
            </span>
          ))}
        </div>
      )}

      {!expanded ? null : !loading && days.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">{t('pipelineOverview.noOrdersInRange')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-card text-left font-medium px-3 py-2 border-b border-border min-w-[120px]">
                  {t('pipelineOverview.metricColumn')}
                </th>
                {days.map((d) => {
                  const { wd, dm } = fmtHead(d.day);
                  const active = dayFilter === d.day;
                  return (
                    <th
                      key={d.day}
                      onClick={() => onPickDay?.(d.day)}
                      className={`font-medium px-1.5 py-1.5 border-b border-l border-border text-center min-w-[62px] transition-colors ${
                        onPickDay ? 'cursor-pointer' : ''
                      } ${active ? 'bg-indigo-100 dark:bg-indigo-500/25' : 'bg-card hover:bg-muted/60'}`}
                    >
                      <div className="text-[11px] text-muted-foreground leading-tight">{wd}</div>
                      <div className="leading-tight font-semibold">{dm}</div>
                    </th>
                  );
                })}
                <th className="bg-muted/30 font-semibold px-2 py-1.5 border-b border-l border-border text-center min-w-[62px]">
                  {t('pipelineOverview.totalColumn')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={rowBgCls(row.tone)}>
                  <td
                    className={`sticky left-0 z-10 ${labelBgCls(row.tone)} px-3 py-1.5 border-b border-border/60 ${
                      row.indent ? 'pl-6' : ''
                    } ${labelCls(row)}`}
                  >
                    {row.indent && <span className="text-muted-foreground/50 mr-1">·</span>}
                    {row.label}
                  </td>
                  {days.map((d) => {
                    const active = dayFilter === d.day;
                    return (
                      <td
                        key={d.day}
                        onClick={() => onPickDay?.(d.day)}
                        onMouseEnter={(e) => showTip(row.tip(d, fmtHead(d.day).dm), e)}
                        onMouseMove={(e) => showTip(row.tip(d, fmtHead(d.day).dm), e)}
                        onMouseLeave={hideTip}
                        className={`border-b border-l border-border/60 px-1 py-1.5 transition-colors ${
                          onPickDay ? 'cursor-pointer' : ''
                        } ${active ? 'bg-indigo-100/70 dark:bg-indigo-500/20' : 'hover:bg-muted/50'}`}
                      >
                        {renderCell(row, d)}
                      </td>
                    );
                  })}
                  <td
                    className="bg-muted/30 border-b border-l border-border px-2 py-1.5"
                    onMouseEnter={(e) => showTip(row.tip(columnTotals, t('pipelineOverview.totalPeriod')), e)}
                    onMouseMove={(e) => showTip(row.tip(columnTotals, t('pipelineOverview.totalPeriod')), e)}
                    onMouseLeave={hideTip}
                  >
                    {renderCell(row, columnTotals)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tip && (
        <div
          className="fixed z-50 pointer-events-none max-w-xs rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-lg"
          style={{
            left: tip.x > window.innerWidth * 0.6 ? tip.x - 12 : tip.x + 12,
            top: tip.y + 16,
            transform: tip.x > window.innerWidth * 0.6 ? 'translateX(-100%)' : undefined,
          }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
