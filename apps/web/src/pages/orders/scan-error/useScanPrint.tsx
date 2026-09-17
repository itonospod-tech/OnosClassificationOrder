import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProductionOrderRow, ShippingLabel } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { CustomerLabelPrint } from '@/components/orders/CustomerLabelPrint';
import { hasShippingAddress, ShippingLabelPrint } from '@/components/orders/ShippingLabelPrint';
import type { WorkshopOrderRow } from '@/components/orders/workshopTableConfig';

import { handleAxiosError } from '@/utils';
import { beepError, beepScan } from '@/utils/scanCodes';

type ScannedOrder = ProductionOrderRow & {
  factory?: { name?: string; shortName?: string };
  machineType?: { name?: string; shortName?: string };
};

/**
 * In tem khách (40×60mm QR) + label giao hàng (4×6 inch) NGAY TỪ popup quét —
 * dùng chung cho cả 2 dialog (`FulfillmentScanActionDialog` + `OrderErrorScanDialog`).
 *
 * Kích hoạt bằng nút bấm hoặc mã quét `ACT-PRINT-TEM` / `ACT-PRINT-LABEL`.
 * Cả 2 component in đều theo vòng đời mount → `window.print()` (hộp thoại in
 * mở) → unmount; máy quét luôn gửi kèm phím Enter cuối mã nên trong hộp thoại
 * in **quét mã OK = bấm nút In** — không cần JS xử lý gì thêm, muốn hủy thì
 * bấm ESC bàn phím (mọi mã quét đều kết thúc bằng Enter nên không có "mã hủy"
 * dùng được ở bước này).
 */
export function useScanPrint(order: ScannedOrder) {
  const { t } = useTranslation('scanError');
  const [temOrders, setTemOrders] = useState<WorkshopOrderRow[] | null>(null);
  const [shipLabels, setShipLabels] = useState<ShippingLabel[] | null>(null);
  const [loadingLabel, setLoadingLabel] = useState(false);

  const printTem = useCallback(() => {
    beepScan();
    // `getByProductionId` trả full document nên row có đủ field tem cần
    // (designs/orderId/externalId/tracking...) — chỉ khác kiểu khai báo.
    setTemOrders([order as unknown as WorkshopOrderRow]);
  }, [order]);

  const printLabel = useCallback(async () => {
    if (loadingLabel) return;
    try {
      setLoadingLabel(true);
      const res = await RepositoryRemote.order.getShippingLabels({ ids: [order._id] });
      const label = ((res.data?.data || []) as ShippingLabel[])[0];
      if (!label) {
        beepError();
        toast.warning(t('printActions.labelNotFound'));
        return;
      }
      if (!hasShippingAddress(label)) {
        beepError();
        toast.warning(t('printActions.labelNoAddress', { productionId: label.productionId }));
        return;
      }
      beepScan();
      setShipLabels([label]);
    } catch (err) {
      beepError();
      handleAxiosError(err);
    } finally {
      setLoadingLabel(false);
    }
  }, [loadingLabel, order._id, t]);

  const elements = (
    <>
      {temOrders && <CustomerLabelPrint orders={temOrders} onDone={() => setTemOrders(null)} />}
      {shipLabels && <ShippingLabelPrint labels={shipLabels} onDone={() => setShipLabels(null)} />}
    </>
  );

  return { printTem, printLabel, loadingLabel, elements };
}
