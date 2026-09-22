import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import type { ScanOutPreview } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { handleAxiosError } from '@/utils';
import { beepError, beepScan, beepSuccess } from '@/utils/scanCodes';

/**
 * Trừ tồn kho theo đơn NGAY TỪ popup quét (Inventory-FactoryStock plan) —
 * dùng chung cho cả 2 dialog (`FulfillmentScanActionDialog` + `OrderErrorScanDialog`).
 *
 * Luồng 2 lần quét: `ACT-STOCK-OUT` mở khối xác nhận (SKU + số trừ + tồn hiện
 * tại) → quét `OK` (hoặc `ACT-STOCK-OUT` lần nữa) chốt trừ. Đơn ĐÃ trừ rồi thì
 * lượt chốt tiếp theo là trừ LÀM LẠI (rework) — BE gắn requestId theo attempt
 * nên gọi lặp không bao giờ trừ đúp.
 *
 * `autoAfterLabel()` là đường TỰ ĐỘNG cho xưởng bật `autoStockOut`: gọi sau khi
 * lệnh in label được gửi; chỉ trừ khi đơn CHƯA trừ lần nào (không bao giờ tự
 * trừ rework), lỗi thì im lặng — đối soát ngày sẽ bắt sót.
 */
export function useScanStockOut(order: { productionId?: string }) {
  const { t } = useTranslation('scanError');
  const [preview, setPreview] = useState<ScanOutPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const productionId = order.productionId || '';

  const openStockOut = useCallback(async () => {
    if (busyRef.current || !productionId) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await RepositoryRemote.inventory.scanOutPreview(productionId);
      const data = res.data?.data as ScanOutPreview;
      if (!data.sku) {
        beepError();
        toast.error(t('stockOut.unresolved'));
        return;
      }
      beepScan();
      setPreview(data);
    } catch (err) {
      beepError();
      handleAxiosError(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [productionId, t]);

  const confirmStockOut = useCallback(async () => {
    if (busyRef.current || !preview) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const rework = preview.deductedTimes > 0;
      const res = await RepositoryRemote.inventory.scanOut({
        productionId,
        reason: rework ? 'rework' : 'normal',
        source: 'scan',
      });
      const data = res.data?.data as { txn: { sku: string; qty: number; balanceAfter: number }; duplicated: boolean };
      if (data.duplicated) {
        toast.info(t('stockOut.duplicated'));
      } else {
        beepSuccess();
        toast.success(
          t(rework ? 'stockOut.doneRework' : 'stockOut.done', {
            qty: Math.abs(data.txn.qty),
            sku: data.txn.sku,
            after: data.txn.balanceAfter,
          }),
        );
      }
      setPreview(null);
    } catch (err) {
      beepError();
      handleAxiosError(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [preview, productionId, t]);

  const closeStockOut = useCallback(() => setPreview(null), []);

  /** Đường tự động sau in label — chỉ khi xưởng bật cờ, chỉ trừ lần đầu, lỗi im lặng. */
  const autoAfterLabel = useCallback(async () => {
    if (!productionId) return;
    try {
      const res = await RepositoryRemote.inventory.scanOutPreview(productionId);
      const data = res.data?.data as ScanOutPreview;
      if (!data.autoStockOut || !data.sku || data.deductedTimes > 0) return;
      const out = await RepositoryRemote.inventory.scanOut({
        productionId,
        reason: 'normal',
        source: 'auto-label',
      });
      const txn = (out.data?.data as { txn: { sku: string; qty: number }; duplicated: boolean }) || null;
      if (txn && !txn.duplicated) {
        toast.success(t('stockOut.autoDone', { qty: Math.abs(txn.txn.qty), sku: txn.txn.sku }));
      }
    } catch {
      // Im lặng — không chặn luồng in; đối soát ngày sẽ bắt đơn sót.
    }
  }, [productionId, t]);

  const element = preview ? (
    <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <p className="font-semibold">{t('stockOut.confirmTitle', { productionId })}</p>
      <p className="mt-1">
        {t('stockOut.sku')}: <span className="font-mono font-semibold">{preview.sku}</span> · {t('stockOut.qty')}:{' '}
        <span className="font-semibold">{preview.qty}</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {preview.currentQuantity === null || preview.currentQuantity === undefined
          ? t('stockOut.currentNew')
          : t('stockOut.current', { qty: preview.currentQuantity })}
      </p>
      {preview.deductedTimes > 0 && (
        <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {t('stockOut.alreadyDeducted', {
            times: preview.deductedTimes,
            at: preview.lastDeductedAt ? dayjs(preview.lastDeductedAt).format('DD/MM HH:mm') : '—',
            next: preview.deductedTimes + 1,
          })}
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{t('stockOut.confirmHint')}</p>
    </div>
  ) : null;

  return {
    stockOutOpen: !!preview,
    stockOutBusy: busy,
    openStockOut,
    confirmStockOut,
    closeStockOut,
    autoAfterLabel,
    stockOutElement: element,
  };
}
