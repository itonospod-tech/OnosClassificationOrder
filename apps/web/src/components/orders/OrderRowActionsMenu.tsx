import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, CheckCircle2, MoreHorizontal, PauseCircle, Pencil, PlayCircle, Printer, RefreshCw, Truck } from 'lucide-react';
import type { BarcodeLabel } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import type { WorkshopOrderRow } from '@/components/orders/workshopTableConfig';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { handleAxiosError } from '@/utils';
import {
  canCancelOrder,
  canForceComplete,
  canForceCompleteOrder,
  canUserHold,
  isCancelled,
  isHeld,
} from '@/utils/orderActions';

import { usePermission } from '@/hooks/usePermission';

import { BarcodeLabelPrint } from './BarcodeLabelPrint';
import { CancelOrderDialog } from './CancelOrderDialog';
import { EditOrderDesignDialog } from './EditOrderDesignDialog';
import { ForceCompleteDialog } from './ForceCompleteDialog';
import { HoldOrderDialog } from './HoldOrderDialog';
import { VnpShipmentDialog } from './VnpShipmentDialog';

interface Props {
  order: WorkshopOrderRow;
  /** Order đã cập nhật từ BE → caller patch local (giữ trạng thái group đang mở). */
  onChanged: (updated: WorkshopOrderRow) => void;
}

/**
 * Menu "..." cuối mỗi hàng order. Admin: Đổi design · Hủy đơn. ORDER_WRITE_ROLES
 * (Admin/Manager/Support/Leader/Fulfillment): Giữ đơn · Mở giữ · Kiểm tra design
 * mới (ép tra OnosPod cho đơn NÀY, không cần đang giữ — dùng chung logic cron
 * `recover-held-from-onospod`, Orders.md §9c). Đơn đã hủy → disable design/hủy/
 * kiểm tra design. Đơn đang giữ → chỉ còn "Mở giữ" (mọi action khác khóa, TRỪ
 * "Kiểm tra design mới" — vẫn bấm được để tự mở giữ nếu design đã cập nhật).
 * SuperAdmin có thêm "Chuyển hoàn thành" (ép đơn về đã hoàn thành sản xuất —
 * `Orders.md §23`), hẹp hơn cả Admin vì đó là cửa sửa dữ liệu.
 */
export function OrderRowActionsMenu({ order, onChanged }: Props) {
  const { t } = useTranslation('orders');
  const { isAdmin, roleName } = usePermission();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [vnpOpen, setVnpOpen] = useState(false);
  const [unholding, setUnholding] = useState(false);
  const [checkingDesign, setCheckingDesign] = useState(false);
  const [forceCompleteOpen, setForceCompleteOpen] = useState(false);
  // Tem nhỏ 60×40mm chỉ tồn tại trong lúc in rồi tự gỡ — xem BarcodeLabelPrint.
  // Dữ liệu tem lấy từ BE (SKU sản phẩm + chỉ số i/n của orderId resolve
  // server-side), không dựng từ row đang hiển thị.
  const [smallLabels, setSmallLabels] = useState<BarcodeLabel[] | null>(null);
  const [loadingLabel, setLoadingLabel] = useState(false);

  const printSmallLabel = async () => {
    try {
      setLoadingLabel(true);
      const res = await RepositoryRemote.order.getBarcodeLabels({ ids: [order._id] });
      const rows = (res.data?.data || []) as BarcodeLabel[];
      if (rows.length === 0) return toast.warning(t('rowActionsMenu.noLabel'));
      setSmallLabels(rows);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoadingLabel(false);
    }
  };

  const canHold = canUserHold(roleName);
  const canComplete = canForceComplete(roleName);
  if (!isAdmin && !canHold && !canComplete) return null;

  const cancelled = isCancelled(order);
  const held = isHeld(order);
  const cancelCheck = canCancelOrder(order, t);
  // Đơn ĐANG GIỮ vẫn hủy được — CỐ Ý không đưa `held` vào đây (ORD-2). Máy chủ
  // chưa bao giờ chặn hủy vì trạng thái giữ (`Orders.md` §9b liệt kê đúng các
  // nhánh bị chặn, cancel không nằm trong đó); disable ở giao diện là luật do
  // chính FE tự đặt ra, chặt hơn máy chủ mà không yêu cầu nào quy định.
  // Nghiệp vụ: đơn giữ thường đang chờ khách xác nhận, khách bảo hủy thì hủy
  // luôn — bắt bỏ giữ rồi mới hủy vừa thêm một thao tác, vừa mở ra khoảng thời
  // gian đơn có thể lọt lại vào luồng sản xuất.
  const cancelDisabled = cancelled || !cancelCheck.ok;
  const forceCompleteCheck = canForceCompleteOrder(order, t);

  const doUnhold = async () => {
    try {
      setUnholding(true);
      const res = await RepositoryRemote.order.unholdOrder(order._id);
      toast.success(t('rowActionsMenu.unheld'));
      onChanged((res.data?.data as WorkshopOrderRow) ?? order);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setUnholding(false);
    }
  };

  const doCheckDesign = async () => {
    try {
      setCheckingDesign(true);
      const res = await RepositoryRemote.order.checkDesignFromOnospod(order._id);
      const data = res.data?.data as { updated: boolean; reason?: string; order?: WorkshopOrderRow } | undefined;
      if (data?.updated) {
        toast.success(t('rowActionsMenu.checkDesignUpdated'));
        onChanged(data.order ?? order);
      } else {
        toast.info(data?.reason ?? t('rowActionsMenu.checkDesignUpdated'));
      }
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setCheckingDesign(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('rowActionsMenu.ariaLabel')}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {/* In tem nhỏ — thao tác CHỈ ĐỌC, không đổi gì trên đơn, nên không
              khoá theo đơn đã hủy / đang giữ như các mục bên dưới: xưởng vẫn cần
              dán tem lên kiện hàng của đơn giữ để tìm lại nó. */}
          <DropdownMenuItem
            disabled={loadingLabel}
            onSelect={(e) => {
              e.preventDefault();
              void printSmallLabel();
            }}
          >
            <Printer size={14} className="mr-2" /> {t('rowActionsMenu.printSmallLabel')}
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem disabled={cancelled || held} onSelect={() => setDesignOpen(true)}>
              <Pencil size={14} className="mr-2" /> {t('rowActionsMenu.changeDesign')}
            </DropdownMenuItem>
          )}
          {canHold && (
            <DropdownMenuItem
              disabled={cancelled || checkingDesign}
              title={cancelled ? t('rowActionsMenu.alreadyCancelled') : undefined}
              onSelect={(e) => {
                e.preventDefault();
                void doCheckDesign();
              }}
            >
              <RefreshCw size={14} className="mr-2" /> {t('rowActionsMenu.checkDesign')}
            </DropdownMenuItem>
          )}
          {canHold &&
            (held ? (
              <DropdownMenuItem
                disabled={unholding}
                className="text-emerald-600 focus:text-emerald-600"
                onSelect={(e) => {
                  e.preventDefault();
                  void doUnhold();
                }}
              >
                <PlayCircle size={14} className="mr-2" /> {t('rowActionsMenu.unhold')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={cancelled}
                className="text-amber-600 focus:text-amber-600"
                title={cancelled ? t('rowActionsMenu.alreadyCancelled') : undefined}
                onSelect={() => setHoldOpen(true)}
              >
                <PauseCircle size={14} className="mr-2" /> {t('rowActionsMenu.hold')}
              </DropdownMenuItem>
            ))}
          {canComplete && (
            <DropdownMenuItem
              disabled={!forceCompleteCheck.ok}
              className="text-emerald-600 focus:text-emerald-600"
              title={forceCompleteCheck.reason}
              onSelect={() => setForceCompleteOpen(true)}
            >
              <CheckCircle2 size={14} className="mr-2" /> {t('rowActionsMenu.forceComplete')}
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem disabled={cancelled} onSelect={() => setVnpOpen(true)}>
              <Truck size={14} className="mr-2" /> {t('rowActionsMenu.vnpShipment')}
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem
              disabled={cancelDisabled}
              className="text-rose-600 focus:text-rose-600"
              title={cancelled ? t('rowActionsMenu.alreadyCancelled') : cancelCheck.reason}
              onSelect={() => setCancelOpen(true)}
            >
              <Ban size={14} className="mr-2" /> {t('rowActionsMenu.cancelOrder')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {smallLabels && <BarcodeLabelPrint labels={smallLabels} size="60x40" onDone={() => setSmallLabels(null)} />}
      <CancelOrderDialog order={order} open={cancelOpen} onOpenChange={setCancelOpen} onDone={onChanged} />
      <HoldOrderDialog order={order} open={holdOpen} onOpenChange={setHoldOpen} onDone={onChanged} />
      <EditOrderDesignDialog order={order} open={designOpen} onOpenChange={setDesignOpen} onDone={onChanged} />
      <VnpShipmentDialog order={order} open={vnpOpen} onOpenChange={setVnpOpen} onDone={onChanged} />
      <ForceCompleteDialog
        order={order}
        open={forceCompleteOpen}
        onOpenChange={setForceCompleteOpen}
        onDone={onChanged}
      />
    </>
  );
}
