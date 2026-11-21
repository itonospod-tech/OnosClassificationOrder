import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import type { FulfillmentStage } from 'shared';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

interface StageErrorRow {
  code: string;
  name: string;
  cells: number[];
  total: number;
}
interface StageErrorData {
  days: string[];
  rows: StageErrorRow[];
  columnTotals: number[];
  grandTotal: number;
}

/** DD/MM ngắn cho header cột ngày. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/**
 * Ô "Thống kê lỗi công đoạn" trong trang task fulfillment — click để xổ bảng lỗi
 * theo NGÀY (`inProductionAt`, VN tz): hàng = mã lỗi, cột = ngày. BE khóa stage +
 * xưởng theo user (role Fulfillment). Lazy-fetch khi mở lần đầu / đổi khoảng ngày.
 */
export function StageErrorPanel({
  stage,
  factoryId,
  from,
  to,
  reloadToken,
}: {
  stage: FulfillmentStage;
  /** Admin/Manager xem thay 1 xưởng; worker bị BE khoá vào xưởng của mình. */
  factoryId?: string;
  from?: string;
  to?: string;
  reloadToken?: number;
}) {
  const { t } = useTranslation('fulfillmentWorkflow');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StageErrorData | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await RepositoryRemote.designer.stageErrorDaily({ stage, factoryId, from, to });
      setData((res.data?.data ?? null) as StageErrorData | null);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  }, [stage, factoryId, from, to]);

  useEffect(() => {
    if (open) void fetchData();
  }, [open, fetchData, reloadToken]);

  return (
    <div className="rounded-md border border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-2.5 text-xs font-medium text-rose-700 dark:text-rose-300"
      >
        <span className="inline-flex items-center gap-1.5">
          <TriangleAlert size={14} />
          {t('stageErrorPanel.title')}
          {data && data.grandTotal > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-rose-200/70 dark:bg-rose-500/20 font-semibold">
              {data.grandTotal}
            </span>
          )}
        </span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {open && (
        <div className="p-2.5 pt-0">
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Spinner size={14} /> {t('stageErrorPanel.loading')}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="py-4 text-xs text-muted-foreground">{t('stageErrorPanel.empty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-medium p-1.5 sticky left-0 bg-rose-50/40 dark:bg-rose-950/10">
                      {t('stageErrorPanel.colErrorCode')}
                    </th>
                    {data.days.map((d) => (
                      <th key={d} className="p-1.5 text-center font-medium whitespace-nowrap">
                        {shortDay(d)}
                      </th>
                    ))}
                    <th className="p-1.5 text-center font-semibold">{t('stageErrorPanel.colTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.code} className="border-t border-rose-100 dark:border-rose-900/30">
                      <td
                        className="p-1.5 font-medium sticky left-0 bg-rose-50/40 dark:bg-rose-950/10 max-w-[160px] truncate"
                        title={r.name}
                      >
                        {r.name}
                      </td>
                      {r.cells.map((v, i) => (
                        <td
                          key={i}
                          className={cn(
                            'p-1.5 text-center tabular-nums',
                            v > 0 ? 'text-rose-700 dark:text-rose-300 font-medium' : 'text-muted-foreground/40',
                          )}
                        >
                          {v || '·'}
                        </td>
                      ))}
                      <td className="p-1.5 text-center font-semibold tabular-nums">{r.total}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-rose-200 dark:border-rose-900/50 font-semibold">
                    <td className="p-1.5 sticky left-0 bg-rose-50/40 dark:bg-rose-950/10">
                      {t('stageErrorPanel.colTotal')}
                    </td>
                    {data.columnTotals.map((v, i) => (
                      <td key={i} className="p-1.5 text-center tabular-nums">
                        {v || '·'}
                      </td>
                    ))}
                    <td className="p-1.5 text-center tabular-nums">{data.grandTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
