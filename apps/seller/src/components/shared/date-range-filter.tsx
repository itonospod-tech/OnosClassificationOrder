"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface DateRange {
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null; // YYYY-MM-DD
}

/**
 * Reusable date-range filter (THG-TASK-011). Compact trigger button
 * surface; popover holds quick presets + month/year stepper + concrete
 * range inputs. Returns ISO YYYY-MM-DD strings — matches every listing
 * endpoint's `dateFrom` / `dateTo` query contract (see
 * `src/lib/validators/order.ts:listQuerySchema`).
 *
 * Controlled component — state lives in the parent so a refresh
 * through the parent's `useEffect` always sees the latest range.
 *
 * Replaces both the older `<DateRangeFilter>` (7d/30d/90d preset
 * buttons) and the inline filter bars duplicated across /orders,
 * /tasks, /attendance, /kpi.
 */

type PresetKey = "today" | "yesterday" | "last7Days" | "thisWeek" | "thisMonth" | "lastMonth" | "thisYear";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7Days", label: "Last 7 Days" },
  { key: "thisWeek", label: "This Week" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "thisYear", label: "This Year" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Exported for unit tests — computing preset ranges is the highest-risk
// pure logic in this component. UI behavior is verified manually.
// `now` is injected so tests don't depend on wall-clock time.
export function computePresetRange(key: PresetKey, now: Date = new Date()): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (key) {
    case "today": {
      const iso = toIso(today);
      return { dateFrom: iso, dateTo: iso };
    }
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const iso = toIso(y);
      return { dateFrom: iso, dateTo: iso };
    }
    case "last7Days": {
      // Today plus the 6 days before it — the legacy OnosPod "Last 7 Days" button.
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { dateFrom: toIso(start), dateTo: toIso(today) };
    }
    case "thisWeek": {
      // Monday → today. JS getDay: 0=Sun, 1=Mon … 6=Sat. We want Monday-start
      // because that's the convention used elsewhere in the app (attendance
      // sheet, KPI weekly bonus). Sunday rolls back to previous Monday.
      const dow = today.getDay() || 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - (dow - 1));
      return { dateFrom: toIso(monday), dateTo: toIso(today) };
    }
    case "thisMonth": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { dateFrom: toIso(first), dateTo: toIso(today) };
    }
    case "lastMonth": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { dateFrom: toIso(first), dateTo: toIso(last) };
    }
    case "thisYear": {
      const first = new Date(today.getFullYear(), 0, 1);
      return { dateFrom: toIso(first), dateTo: toIso(today) };
    }
  }
}

function detectActivePreset(value: DateRange): PresetKey | null {
  if (!value.dateFrom || !value.dateTo) return null;
  for (const p of PRESETS) {
    const r = computePresetRange(p.key);
    if (r.dateFrom === value.dateFrom && r.dateTo === value.dateTo) return p.key;
  }
  return null;
}

/** Nhãn khoảng tùy chọn trên pill "Tùy chọn" (chỉ khi KHÔNG trùng preset). */
function formatCustomLabel(value: DateRange): string | null {
  if (!value.dateFrom && !value.dateTo) return null;
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  if (value.dateFrom && value.dateTo) {
    return value.dateFrom === value.dateTo
      ? fmt(value.dateFrom)
      : `${fmt(value.dateFrom)} – ${fmt(value.dateTo)}`;
  }
  return value.dateFrom ? `≥ ${fmt(value.dateFrom)}` : `≤ ${fmt(value.dateTo!)}`;
}

const PILL = "px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap transition-colors";
const PILL_ON = "bg-accent border-accent text-white";
const PILL_OFF = "bg-card border-border1 text-text-secondary hover:border-accent/60 hover:text-text-primary";

/**
 * Bản 07/09/2026 (yêu cầu người dùng): quick filter HIỆN THẲNG thành dải pill
 * "Mọi thời gian · Hôm nay · Hôm qua · Tuần này · Tháng này · Tháng trước · Năm nay",
 * cuối dải là pill "Tùy chọn" mở popover chọn từ/đến (+ bước tháng). Không còn nút
 * trigger gộp — người dùng bấm 1 lần là lọc, không phải mở popover.
 */
export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const { t } = useTranslation("seller");
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ year: number; month: number }>(() => {
    const seed = value.dateFrom ? new Date(value.dateFrom) : new Date();
    return { year: seed.getFullYear(), month: seed.getMonth() };
  });
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const activePreset = useMemo(() => detectActivePreset(value), [value]);
  const isAllTime = !value.dateFrom && !value.dateTo;
  const customLabel = useMemo(() => (activePreset ? null : formatCustomLabel(value)), [value, activePreset]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const el = e.target as Node;
      if (popoverRef.current?.contains(el)) return;
      if (triggerRef.current?.contains(el)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const stepMonth = (delta: number) => {
    setAnchor((a) => {
      const d = new Date(a.year, a.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };
  const applyAnchorMonth = () => {
    const first = new Date(anchor.year, anchor.month, 1);
    const last = new Date(anchor.year, anchor.month + 1, 0);
    onChange({ dateFrom: toIso(first), dateTo: toIso(last) });
    setOpen(false);
  };
  const fromInputChange = (next: string) => {
    const v = next || null;
    if (v && value.dateTo && v > value.dateTo) onChange({ dateFrom: v, dateTo: v });
    else onChange({ dateFrom: v, dateTo: value.dateTo });
  };
  const toInputChange = (next: string) => {
    const v = next || null;
    if (v && value.dateFrom && v < value.dateFrom) onChange({ dateFrom: v, dateTo: v });
    else onChange({ dateFrom: value.dateFrom, dateTo: v });
  };
  const clear = () => {
    onChange({ dateFrom: null, dateTo: null });
    setOpen(false);
  };

  return (
    <div className="relative inline-flex flex-wrap items-center gap-1">
      <button type="button" onClick={clear} className={`${PILL} ${isAllTime ? PILL_ON : PILL_OFF}`}>
        {t("dateFilter.allTime")}
      </button>
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(computePresetRange(p.key))}
          className={`${PILL} ${activePreset === p.key ? PILL_ON : PILL_OFF}`}
        >
          {t(`dateFilter.${p.key}`)}
        </button>
      ))}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${PILL} inline-flex items-center gap-1 ${customLabel ? PILL_ON : PILL_OFF}`}
        aria-expanded={open}
      >
        <Calendar size={12} />
        {customLabel ?? t("dateFilter.custom")}
      </button>

      {open && (
        <div ref={popoverRef} className="absolute z-50 top-full mt-1.5 right-0 w-[300px] rounded-lg border border-border1 bg-card shadow-lg p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => stepMonth(-1)} className="p-1 rounded hover:bg-bg-subtle text-text-muted" aria-label={t("dateFilter.prevMonth")}>
              <ChevronLeft size={14} />
            </button>
            <button type="button" onClick={applyAnchorMonth} className="flex-1 text-center px-2 py-1 rounded hover:bg-bg-subtle text-[12px] font-semibold" title={t("dateFilter.wholeMonth")}>
              {`${pad(anchor.month + 1)}/${anchor.year}`}
            </button>
            <button type="button" onClick={() => stepMonth(1)} className="p-1 rounded hover:bg-bg-subtle text-text-muted" aria-label={t("dateFilter.nextMonth")}>
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-border1">
            <label className="flex flex-col gap-0.5">
              <span className="text-text-muted">{t("dateFilter.from")}</span>
              <input type="date" value={value.dateFrom ?? ""} onChange={(e) => fromInputChange(e.target.value)} className="px-2 py-1 rounded border border-border1 bg-card text-text-primary" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-text-muted">{t("dateFilter.to")}</span>
              <input type="date" value={value.dateTo ?? ""} onChange={(e) => toInputChange(e.target.value)} className="px-2 py-1 rounded border border-border1 bg-card text-text-primary" />
            </label>
          </div>
          <div className="flex justify-between pt-2 border-t border-border1">
            <button type="button" onClick={clear} className="text-[11px] text-text-muted hover:text-text-primary font-semibold">{t("dateFilter.clear")}</button>
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-semibold px-3 py-1 rounded bg-cta text-cta-foreground">{t("dateFilter.close")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
