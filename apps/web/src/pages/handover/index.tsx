import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Printer, RefreshCw, Truck } from 'lucide-react';
import type { PackingPackage } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';

import { useFactoryScope } from '@/hooks/useFactoryScope';

import { HandoverSheetPrint } from './HandoverSheetPrint';

/**
 * Màn **Bàn giao** — lấp GAP-27 của tài liệu chuyển đổi.
 *
 * Việc thật ngoài kho: xe hãng tới, kho gom các kiện đã đóng chưa ai chở đi,
 * tick chọn, in một tờ phiếu cho tài xế ký. Lúc in là lúc hệ đóng dấu giờ xuất
 * kho — hai việc đó phải là MỘT thao tác, tách ra thì sẽ có phiếu in rồi mà
 * kiện vẫn nằm trong danh sách chờ.
 *
 * Kiện thiếu cân KHÔNG bị chặn bàn giao (cân là tuỳ chọn ở trạm đóng gói) mà
 * chỉ hiện dấu cảnh báo — chặn ở đây là giữ hàng lại vì sổ sách, xe thì đang đợi.
 */
export default function HandoverPage() {
  const { t } = useTranslation(['fulfillmentWorkflow', 'common']);
  const factoryId = useFactoryScope();

  const [rows, setRows] = useState<PackingPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [carrier, setCarrier] = useState('');
  const [sheet, setSheet] = useState<{ code: string; packages: PackingPackage[] } | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const res = await RepositoryRemote.fulfillment.getPackages({ factoryId: factoryId || undefined });
      setRows((res.data?.data || []) as PackingPackage[]);
      setSelected(new Set());
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId]);

  const thieuCan = useMemo(() => rows.filter((r) => !r.weightGram).length, [rows]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const banGiao = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const chon = rows.filter((r) => selected.has(r._id));
    try {
      const res = await RepositoryRemote.fulfillment.handoverPackages({ ids, carrier: carrier.trim() || undefined });
      const data = res.data?.data;
      if (!data) return;
      if (data.skipped > 0) toast.warning(t('handover.skipped', { count: data.skipped }));
      toast.success(t('handover.done', { code: data.handoverCode, count: data.count }));
      // In NGAY sau khi đóng dấu: phiếu phải mang đúng mã vừa cấp.
      setSheet({ code: data.handoverCode, packages: chon });
      void load();
    } catch (err) {
      handleAxiosError(err);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{t('handover.title')}</h1>
        <span className="text-sm text-muted-foreground">
          {t('handover.summary', { total: rows.length, missing: thieuCan })}
        </span>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner size={13} className="text-muted-foreground" /> : <RefreshCw size={14} />}
          {t('common:actions.refresh')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-56"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
          placeholder={t('handover.carrierPlaceholder')}
        />
        <Button onClick={() => void banGiao()} disabled={selected.size === 0}>
          <Truck size={14} /> {t('handover.submit', { count: selected.size })}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-10 p-2"></th>
              {['code', 'orderId', 'productionIds', 'weight', 'packedAt', 'packedBy'].map((k) => (
                <th key={k} className="p-2 text-left font-medium">
                  {t(`handover.col.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {t('handover.empty')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r._id} className="border-t hover:bg-muted/30">
                <td className="p-2">
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer align-middle"
                    checked={selected.has(r._id)}
                    onChange={() => toggle(r._id)}
                  />
                </td>
                <td className="p-2 font-mono">{r.code}</td>
                <td className="p-2 font-mono">{r.orderId || '—'}</td>
                <td className="p-2 font-mono text-xs">{(r.productionIds || []).join(', ')}</td>
                <td className="p-2">
                  {r.weightGram ? (
                    `${r.weightGram} g`
                  ) : (
                    <span className="text-amber-600">{t('handover.noWeight')}</span>
                  )}
                </td>
                <td className="p-2">{r.packedAt ? dayjs(r.packedAt).format('DD/MM HH:mm') : '—'}</td>
                <td className="p-2">{r.packedByUserName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sheet && (
        <HandoverSheetPrint
          handoverCode={sheet.code}
          carrier={carrier.trim() || undefined}
          packages={sheet.packages}
          onDone={() => setSheet(null)}
        />
      )}

      <p className="text-xs text-muted-foreground">
        <Printer size={12} className="mr-1 inline" />
        {t('handover.hint')}
      </p>
    </div>
  );
}
