import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { AlertTriangle, CircleAlert, CircleCheck, Search } from 'lucide-react';
import type { ZaloGroupSummaryRow } from 'shared';
import { ZaloSummaryLevel } from 'shared';

import { RepositoryRemote } from '@/services';

import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

const PAGE_SIZE = 20;

/** Mức độ → màu + icon. Gấp phải nhìn ra ngay khi liếc, không phải đọc chữ. */
const LEVEL_STYLE: Record<string, { cls: string; Icon: typeof AlertTriangle }> = {
  [ZaloSummaryLevel.Gap]: {
    cls: 'border-l-rose-500 bg-rose-50/40 dark:bg-rose-950/20',
    Icon: AlertTriangle,
  },
  [ZaloSummaryLevel.CanChuY]: {
    cls: 'border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/20',
    Icon: CircleAlert,
  },
  [ZaloSummaryLevel.BinhThuong]: {
    cls: 'border-l-slate-300 dark:border-l-slate-600',
    Icon: CircleCheck,
  },
};

type Row = ZaloGroupSummaryRow & { _id: string };

export default function SummariesPanel() {
  const { t } = useTranslation(['zaloGroups', 'common']);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [mucDo, setMucDo] = useState<string>('');
  const [conViec, setConViec] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', String(PAGE_SIZE));
    if (search.trim()) p.set('search', search.trim());
    if (mucDo) p.set('mucDo', mucDo);
    if (conViec) p.set('conViec', 'true');

    return `?${p.toString()}`;
  }, [page, search, mucDo, conViec]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await RepositoryRemote.zaloGroup.getSummaries(query);
      setRows(res.data?.data ?? []);
      setTotal(res.data?.total ?? 0);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleTask = async (row: Row, index: number, xong: boolean) => {
    // Cập nhật ngay trên màn hình rồi mới gọi API — tick vào ô mà phải chờ
    // mạng mới thấy đổi thì người dùng bấm hai lần.
    setRows((rs) =>
      rs.map((r) =>
        r._id === row._id
          ? { ...r, checklist: r.checklist.map((c, i) => (i === index ? { ...c, xong } : c)) }
          : r,
      ),
    );
    try {
      await RepositoryRemote.zaloGroup.toggleTask(row.groupGlobalId, { index, xong });
    } catch (error) {
      handleAxiosError(error);
      void load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="w-full pl-8 sm:w-64"
            placeholder={t('filter.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select
          className="h-9 rounded-md border border-slate-200 bg-transparent px-2 text-sm dark:border-slate-700"
          value={mucDo}
          onChange={(e) => {
            setMucDo(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('summary.allLevels')}</option>
          <option value={ZaloSummaryLevel.Gap}>{t('summary.level.gap')}</option>
          <option value={ZaloSummaryLevel.CanChuY}>{t('summary.level.can-chu-y')}</option>
          <option value={ZaloSummaryLevel.BinhThuong}>{t('summary.level.binh-thuong')}</option>
        </select>

        <Button
          variant={conViec ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setConViec((v) => !v);
            setPage(1);
          }}
        >
          {t('summary.pendingOnly')}
        </Button>
      </div>

      <LoadingOverlay active={loading} className="space-y-3">
        {rows.length === 0 && !loading && (
          <div className="rounded-lg border py-12 text-center text-sm text-slate-500">{t('summary.empty')}</div>
        )}

        {rows.map((r) => {
          const style = LEVEL_STYLE[r.mucDo] ?? LEVEL_STYLE[ZaloSummaryLevel.BinhThuong];
          const { Icon } = style;
          const conLai = r.checklist.filter((c) => !c.xong).length;

          return (
            <div key={r._id} className={cn('rounded-lg border border-l-4 p-4', style.cls)}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="font-medium">{r.title || t('table.noTitle')}</span>
                    {r.userSku && <span className="font-mono text-xs text-slate-500">{r.userSku}</span>}
                  </div>
                  {r.tieuDe && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{r.tieuDe}</p>}
                </div>
                <div className="whitespace-nowrap text-right text-xs text-slate-400">
                  {r.tomTatLuc ? dayjs(r.tomTatLuc).format('DD/MM HH:mm') : '—'}
                  {r.soTin > 0 && <> · {t('summary.msgCount', { count: r.soTin })}</>}
                  {r.coTinMoi && r.lastMessageAt && (
                    <div className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      {t('summary.newSince', { at: dayjs(r.lastMessageAt).format('DD/MM HH:mm') })}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Field label={t(r.kind === 'operation' ? 'summary.requesterWants' : 'summary.customerWants')} value={r.khachQuanTam} />
                <Field label={t(r.kind === 'operation' ? 'summary.handlerReplied' : 'summary.staffReplied')} value={r.salePhanHoi} />
                <Field label={t('summary.pending')} value={r.tonDong} highlight={!!r.tonDong} />
              </div>

              {r.checklist.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {t('summary.todo')} {conLai > 0 && <span className="text-amber-600">({conLai})</span>}
                  </div>
                  <ul className="space-y-1">
                    {r.checklist.map((c, i) => (
                      <li key={`${r._id}-${i}`}>
                        {/* The whole row is the label, so a thumb can hit the text, not just a 13px box. */}
                        <label className="flex cursor-pointer items-start gap-2 py-0.5 text-sm touch:py-2">
                          <input
                            type="checkbox"
                            className="mt-1 shrink-0 touch:h-5 touch:w-5"
                            aria-label={c.viec}
                            checked={c.xong}
                            onChange={(e) => void toggleTask(r, i, e.target.checked)}
                          />
                          <span className={cn(c.xong && 'text-slate-400 line-through')}>{c.viec}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {r.nghiNgo.length > 0 && (
                <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950/40">
                  <div className="font-medium text-amber-800 dark:text-amber-300">{t('summary.doubt')}</div>
                  <ul className="mt-1 list-inside list-disc text-amber-700 dark:text-amber-400">
                    {r.nghiNgo.map((n, i) => (
                      <li key={`${r._id}-d-${i}`}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </LoadingOverlay>

      <PaginationBar
        position="bottom"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        loading={loading}
        onChange={(p) => setPage(p)}
      />
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value?: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <p className={cn('mt-0.5 text-sm', highlight ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300')}>
        {value?.trim() || '—'}
      </p>
    </div>
  );
}
