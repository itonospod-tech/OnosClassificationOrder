import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, PlayCircle } from 'lucide-react';
import type { FulfillmentTransitionDto, ProductionOrder } from 'shared';
import { FulfillmentStage, FulfillmentStageStatus, FulfillmentTransitionAction } from 'shared';
import { toast } from 'sonner';

import { useAuthStore } from '@/store/authStore';

import { RepositoryRemote } from '@/services';

import { PipelineDailyOverview } from '@/components/common/PipelineDailyOverview';
import { BulkEditToolbar } from '@/components/orders/BulkEditToolbar';
import { OrderRowActionsMenu } from '@/components/orders/OrderRowActionsMenu';
import type { WorkshopOrderRow } from '@/components/orders/workshopTableConfig';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';

import { PrintOrderTable } from './PrintOrderTable';
import { ReworkBackDialog } from './ReworkBackDialog';

type BulkAction = 'start' | 'complete';

const printStatusOf = (row: WorkshopOrderRow): string | undefined => row.fulfillmentStages?.print?.status;

/**
 * Trang "Task của tôi" cho user In (Fulfillment stage=print). Bảng phẳng
 * `PrintOrderTable` + cột action đẩy In→Ép + thanh bulk = `BulkEditToolbar`
 * đầy đủ (Bulk update Máy/Trạng thái in theo quyền, in tem, label...) nhét
 * thêm 2 nút chuyển trạng thái (Bắt đầu / Hoàn thành) qua `extraActions`,
 * popup xác nhận khi chọn lẫn trạng thái.
 * Xem documents/Plans/PrintStage-AdminTableView.md.
 */
export default function PrintWorkshopView() {
  const { t } = useTranslation(['fulfillmentWorkflow', 'common']);
  const profile = useAuthStore((s) => s.profile);
  const myFactoryId = profile?.factoryId;
  const [reloadToken, setReloadToken] = useState(0);
  const [reworkOrder, setReworkOrder] = useState<WorkshopOrderRow | null>(null);
  // Ngày đang lọc từ bảng "Tổng quan theo ngày". Bảng In phân trang server →
  // narrow qua date (dayOverride) thay vì lọc client-side.
  const [dayFilter, setDayFilter] = useState('');
  const toggleDay = (day: string) => setDayFilter((cur) => (cur === day ? '' : day));
  // Popup xác nhận bulk khi chọn lẫn trạng thái.
  const [confirm, setConfirm] = useState<{
    action: BulkAction;
    rows: WorkshopOrderRow[];
    skipped: number;
    clear: () => void;
  } | null>(null);

  const refresh = () => setReloadToken((t) => t + 1);

  // Đơn In thao tác được — CHỈ 2 điều kiện: (1) đúng xưởng user + (2)
  // `toolResultNote='ok'`. KHÔNG cần stage `print` đã khởi tạo: đơn designer
  // done qua path không hook (chưa có `currentFulfillmentStage`/`fulfillmentStages`)
  // vẫn hiện nút → BE self-heal khởi tạo stage khi bấm Bắt đầu.
  const canPrint = (row: WorkshopOrderRow) =>
    row.toolResultNote === 'ok' && !!myFactoryId && String(row.factoryId ?? '') === String(myFactoryId);

  // Tick được: mọi đơn `canPrint` — GỒM CẢ đơn đã in xong, để bulk update
  // Máy/Trạng thái in cho chúng qua BulkEditToolbar. Nút Bắt đầu/Hoàn thành
  // trên thanh bulk tự lọc lại theo trạng thái nên đơn done không bị đụng.
  const isRowSelectable = (row: WorkshopOrderRow) => canPrint(row);

  const doTransition = async (
    orderId: string,
    action: FulfillmentTransitionAction,
    body?: Pick<FulfillmentTransitionDto, 'target' | 'reason'>,
  ) => {
    try {
      await RepositoryRemote.fulfillment.transition(orderId, {
        stage: FulfillmentStage.Print,
        action,
        ...body,
      } as FulfillmentTransitionDto);
      toast.success(t('toast.updated'));
      refresh();
    } catch (err) {
      handleAxiosError(err);
      refresh();
    }
  };

  // Bulk: loop transition song song, gộp kết quả → 1 toast.
  const runBulk = async (rows: WorkshopOrderRow[], action: BulkAction, clear: () => void) => {
    const txAction = action === 'start' ? FulfillmentTransitionAction.Start : FulfillmentTransitionAction.Complete;
    const verb = action === 'start' ? t('verbs.start') : t('verbs.complete');
    const results = await Promise.allSettled(
      rows.map((r) =>
        RepositoryRemote.fulfillment.transition(r._id, {
          stage: FulfillmentStage.Print,
          action: txAction,
        } as FulfillmentTransitionDto),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (fail === 0) toast.success(t('toast.bulkDone', { verb, count: ok }));
    else toast.warning(t('toast.bulkPartial', { verb, ok, total: results.length, fail }));
    clear();
    refresh();
  };

  // Click 1 nút bulk: nếu chọn lẫn trạng thái (có đơn ở trạng thái khác) →
  // popup xác nhận; ngược lại chạy thẳng.
  const onBulkClick = (action: BulkAction, eligible: WorkshopOrderRow[], others: number, clear: () => void) => {
    if (others > 0) setConfirm({ action, rows: eligible, skipped: others, clear });
    else void runBulk(eligible, action, clear);
  };

  const renderRowAction = (row: WorkshopOrderRow) => {
    const status = printStatusOf(row);
    const ok = canPrint(row);
    let stageButtons: React.ReactNode = null;
    // 'ok' + đúng xưởng + chưa đang làm/đã xong (gồm cả stage chưa init →
    // status undefined) → "Bắt đầu". "Báo lỗi" chỉ khi stage đã init (status có
    // giá trị) vì rework-back cần stage tồn tại.
    if (ok && status !== FulfillmentStageStatus.InProgress && status !== FulfillmentStageStatus.Done) {
      stageButtons = (
        <>
          <Button
            size="sm"
            className="whitespace-nowrap"
            onClick={() => void doTransition(row._id, FulfillmentTransitionAction.Start)}
          >
            {t('actions.start')}
          </Button>
          {status && (
            <Button size="sm" variant="destructive" className="whitespace-nowrap" onClick={() => setReworkOrder(row)}>
              {t('actions.reportError')}
            </Button>
          )}
        </>
      );
    } else if (ok && status === FulfillmentStageStatus.InProgress) {
      stageButtons = (
        <>
          <Button
            size="sm"
            className="whitespace-nowrap"
            onClick={() => void doTransition(row._id, FulfillmentTransitionAction.Complete)}
          >
            {t('actions.complete')}
          </Button>
          <Button size="sm" variant="destructive" className="whitespace-nowrap" onClick={() => setReworkOrder(row)}>
            {t('actions.reportError')}
          </Button>
        </>
      );
    }
    return (
      <div className="flex items-center gap-1">
        {stageButtons}
        <OrderRowActionsMenu order={row} onChanged={refresh} />
      </div>
    );
  };

  // Thanh bulk = BulkEditToolbar đầy đủ (Bulk update Máy/Trạng thái in... theo
  // quyền + in tem/label/export) + 2 nút chuyển trạng thái công đoạn nhét qua
  // `extraActions`. Chỉ đơn đúng trạng thái mới vào startable/completable —
  // đơn đã in xong tick để bulk update thì 2 nút này tự bỏ qua.
  const renderBulkBar = (selectedRows: WorkshopOrderRow[], clear: () => void) => {
    const startable = selectedRows.filter((r) => {
      const s = printStatusOf(r);
      return s === undefined || s === FulfillmentStageStatus.Waiting || s === FulfillmentStageStatus.Rework;
    });
    const completable = selectedRows.filter((r) => printStatusOf(r) === FulfillmentStageStatus.InProgress);
    return (
      <BulkEditToolbar
        selectedIds={selectedRows.map((r) => r._id)}
        onClear={clear}
        onApplied={() => {
          clear();
          refresh();
        }}
        extraActions={
          <>
            {startable.length > 0 && (
              <Button size="sm" onClick={() => onBulkClick('start', startable, completable.length, clear)}>
                <PlayCircle size={14} /> {t('actions.start')} ({startable.length})
              </Button>
            )}
            {completable.length > 0 && (
              <Button size="sm" onClick={() => onBulkClick('complete', completable, startable.length, clear)}>
                <CheckCircle2 size={14} /> {t('actions.complete')} ({completable.length})
              </Button>
            )}
          </>
        }
      />
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <PipelineDailyOverview
          stage={FulfillmentStage.Print}
          reloadToken={reloadToken}
          dayFilter={dayFilter}
          onPickDay={toggleDay}
        />
        <PrintOrderTable
          extraRowAction={renderRowAction}
          extraActionLabel={t('printWorkshop.extraActionLabel')}
          reloadToken={reloadToken}
          isRowSelectable={isRowSelectable}
          renderBulkBar={renderBulkBar}
          dayOverride={dayFilter || null}
        />
      </div>

      {reworkOrder && (
        <ReworkBackDialog
          order={reworkOrder as unknown as ProductionOrder}
          myStage={FulfillmentStage.Print}
          onClose={() => setReworkOrder(null)}
          onSubmit={async (target, reason) => {
            await doTransition(reworkOrder._id, FulfillmentTransitionAction.ReworkBack, {
              target,
              reason,
            });
            setReworkOrder(null);
          }}
        />
      )}

      {/* Popup xác nhận khi chọn lẫn trạng thái */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('printWorkshop.confirmDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('printWorkshop.confirmDialog.bodyPrefix')} <strong>{confirm?.rows.length}</strong>{' '}
              {t('printWorkshop.confirmDialog.bodyMid')}{' '}
              <strong>{confirm?.action === 'start' ? t('actions.start') : t('actions.complete')}</strong>
              {confirm && confirm.skipped > 0
                ? ` ${t('printWorkshop.confirmDialog.skippedNote', { count: confirm.skipped })}`
                : ''}
              {t('printWorkshop.confirmDialog.continue')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (confirm) void runBulk(confirm.rows, confirm.action, confirm.clear);
                setConfirm(null);
              }}
            >
              {t('common:actions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
