import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { DailyBySellerRow } from 'shared';
import { DAILY_BY_SELLER_MAX_DAYS } from 'shared';
import * as XLSX from 'xlsx';

import { RepositoryRemote } from '@/services';

import { DateRangePicker } from '@/components/common/DateRangePicker';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';

import { handleAxiosError } from '@/utils';

import { downloadWorkbook } from './exportOrders';

export interface DailyBySellerReportProps {
  /** Factory selected on the "By factory" view; empty = every production factory. */
  factoryId?: string;
}

const iso = (d: dayjs.Dayjs) => d.format('YYYY-MM-DD');

/**
 * Legacy "Production Report › Daily report" (Dashboard.md): per seller and VN day, items finished
 * and packages handed over. A collapsible block of the "By factory" view, closed by default so the
 * view's main table keeps the first screen; it only loads when opened. Default range: last 7 days
 * (legacy `tab=last7day`). A Fulfillment worker only ever gets their own factory (server side).
 */
export function DailyBySellerReport({ factoryId }: DailyBySellerReportProps) {
  const { t } = useTranslation('dashboard');
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => iso(dayjs().subtract(6, 'day')));
  const [to, setTo] = useState(() => iso(dayjs()));
  const [rows, setRows] = useState<DailyBySellerRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !from || !to) return;
    let cancelled = false;
    const p = new URLSearchParams({ from, to });
    if (factoryId) p.set('factoryId', factoryId);
    setLoading(true);
    RepositoryRemote.order
      .getDailyBySeller('?' + p.toString())
      .then((res) => !cancelled && setRows((res.data as { data: DailyBySellerRow[] }).data ?? []))
      .catch(handleAxiosError)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, from, to, factoryId]);

  // Seller × day matrix, busiest seller first.
  const { days, sellers, dayTotals } = useMemo(() => {
    const dayList: string[] = [];
    for (let d = dayjs(from); !d.isAfter(dayjs(to), 'day'); d = d.add(1, 'day')) dayList.push(iso(d));
    const bySeller = new Map<string, { userSku: string; cells: Map<string, DailyBySellerRow>; items: number; packages: number }>();
    const totals = new Map<string, { items: number; packages: number }>();
    for (const r of rows ?? []) {
      const s = bySeller.get(r.userSku) ?? { userSku: r.userSku, cells: new Map(), items: 0, packages: 0 };
      s.cells.set(r.date, r);
      s.items += r.items;
      s.packages += r.packages;
      bySeller.set(r.userSku, s);
      const dt = totals.get(r.date) ?? { items: 0, packages: 0 };
      dt.items += r.items;
      dt.packages += r.packages;
      totals.set(r.date, dt);
    }
    return { days: dayList, sellers: [...bySeller.values()].sort((a, b) => b.items - a.items || a.userSku.localeCompare(b.userSku)), dayTotals: totals };
  }, [rows, from, to]);

  const tooLong = dayjs(to).diff(dayjs(from), 'day') + 1 > DAILY_BY_SELLER_MAX_DAYS;

  const exportXlsx = () => {
    const header = [t('dailyBySeller.seller'), ...days.map((d) => dayjs(d).format('DD/MM')), t('dailyBySeller.total'), t('dailyBySeller.packages')];
    const body = sellers.map((s) => [s.userSku || '—', ...days.map((d) => s.cells.get(d)?.items ?? 0), s.items, s.packages]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daily');
    downloadWorkbook(`bao-cao-ngay-theo-seller-${from}_${to}.xlsx`, wb);
  };

  const cell = 'border-b border-border px-2 py-1.5 text-right tabular-nums';
  return (
    <section className="rounded-lg border border-border bg-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left touch:min-h-11" aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="font-semibold">{t('dailyBySeller.title')}</span>
        <span className="text-xs text-muted-foreground max-md:hidden">{t('dailyBySeller.subtitle')}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker from={from} to={to} clearable={false} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
            {loading && <Spinner size={14} />}
            <Button variant="outline" size="sm" className="ml-auto" onClick={exportXlsx} disabled={!sellers.length}>
              <Download size={14} /> {t('dailyBySeller.export')}
            </Button>
          </div>
          {tooLong ? (
            <p className="text-sm text-tone-warning">{t('dailyBySeller.tooLong', { max: DAILY_BY_SELLER_MAX_DAYS })}</p>
          ) : !sellers.length ? (
            !loading && <p className="py-6 text-center text-sm text-muted-foreground">{t('dailyBySeller.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="sticky left-0 border-b border-border bg-card px-2 py-1.5 text-left">{t('dailyBySeller.seller')}</th>
                    {days.map((d) => (
                      <th key={d} className="border-b border-border px-2 py-1.5 text-right">{dayjs(d).format('DD/MM')}</th>
                    ))}
                    <th className="border-b border-border px-2 py-1.5 text-right">{t('dailyBySeller.total')}</th>
                    <th className="border-b border-border px-2 py-1.5 text-right">{t('dailyBySeller.packages')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="font-semibold">
                    <td className="sticky left-0 border-b border-border bg-card px-2 py-1.5">{t('dailyBySeller.allSellers')}</td>
                    {days.map((d) => (
                      <td key={d} className={cell}>{dayTotals.get(d)?.items || '·'}</td>
                    ))}
                    <td className={cell}>{sellers.reduce((a, s) => a + s.items, 0)}</td>
                    <td className={cell}>{sellers.reduce((a, s) => a + s.packages, 0)}</td>
                  </tr>
                  {sellers.map((s) => (
                    <tr key={s.userSku || '—'}>
                      <td className="sticky left-0 border-b border-border bg-card px-2 py-1.5 font-medium">{s.userSku || '—'}</td>
                      {days.map((d) => (
                        <td key={d} className={cell}>{s.cells.get(d)?.items || '·'}</td>
                      ))}
                      <td className={`${cell} font-semibold`}>{s.items}</td>
                      <td className={cell}>{s.packages || '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
