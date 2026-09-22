import React, { useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import {
  Barcode,
  Boxes,
  CheckCircle2,
  Clock,
  ExternalLink,
  Factory,
  ImageIcon,
  Layers,
  MessageSquareWarning,
  Package,
  Palette,
  PlayCircle,
  Plus,
  Printer,
  RotateCw,
  Ruler,
  ScanLine,
  ShieldAlert,
  Tag,
  Wrench,
} from 'lucide-react';
import type {   FulfillmentStage,ProductionOrderRow, WorkshopConfig } from 'shared';
import {
  FulfillmentStageStatus,
  FulfillmentTransitionAction,
  WorkshopConfigCategory,
} from 'shared';
import { toast } from 'sonner';

import { PATHS } from '@/constants/paths';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { getStageLabel } from '@/utils/fulfillmentStageLabel';
import { beepError, beepSuccess, parseScanCode } from '@/utils/scanCodes';

import { GuideStep, GuideZone } from './ScanGuide';
import { useScanPrint } from './useScanPrint';
import { useScanStockOut } from './useScanStockOut';

/** Link sang trang danh mục lỗi công đoạn — đặt ở góc vùng "Báo lỗi". */
function AddErrorLink() {
  const { t } = useTranslation('scanError');
  return (
    <Link
      to={PATHS.ORDERS_STAGE_ERRORS}
      className="inline-flex items-center gap-1 text-base font-semibold text-rose-600 dark:text-rose-400 underline underline-offset-2 hover:text-rose-700 dark:hover:text-rose-300"
    >
      <Plus size={16} /> {t('addErrorLink')}
    </Link>
  );
}

type ScannedOrder = ProductionOrderRow & {
  factory?: { name?: string; shortName?: string };
  machineType?: { name?: string; shortName?: string };
};

interface Props {
  order: ScannedOrder;
  /** Stage user Fulfillment đang phụ trách. */
  myStage: FulfillmentStage;
  /** factoryId của user — đơn phải cùng xưởng mới thao tác được (khớp BE guard). */
  myFactoryId?: string;
  onClose: () => void;
  /** Sau khi hoàn thành công đoạn → page append lịch sử + re-focus input. */
  onCompleted: (summary: { stageLabel: string }) => void;
  /** User bấm "Báo lỗi" → page chuyển sang dialog gán lỗi. */
  onReportError: () => void;
  /**
   * Quét mã lỗi (`E-<code>`) hợp lệ (thuộc công đoạn của user) → page chuyển
   * sang modal gán lỗi với mã đã chọn sẵn, chờ quét lần 2 xác nhận.
   */
  onScanError?: (code: string) => void;
  /** Quét barcode ĐƠN khác (`N-…`) khi dialog đang mở → page tra cứu đơn mới. */
  onScanOrder?: (code: string) => void;
}

function buildStatusMeta(t: TFunction<'scanError'>): Record<string, { label: string; icon: React.ElementType; cls: string }> {
  return {
    [FulfillmentStageStatus.Waiting]: {
      label: t('fulfillmentDialog.statusWaiting'),
      icon: Clock,
      cls: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300',
    },
    [FulfillmentStageStatus.InProgress]: {
      label: t('fulfillmentDialog.statusInProgress'),
      icon: PlayCircle,
      cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    },
    [FulfillmentStageStatus.Rework]: {
      label: t('fulfillmentDialog.statusRework'),
      icon: RotateCw,
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    },
    [FulfillmentStageStatus.Done]: {
      label: t('fulfillmentDialog.statusDone'),
      icon: CheckCircle2,
      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    },
  };
}

// Nhãn cho từng vị trí design → hiển thị link mở file thiết kế.
function buildDesignLabels(t: TFunction<'scanError'>): Record<string, string> {
  return {
    front: t('fulfillmentDialog.designLabels.front'),
    back: t('fulfillmentDialog.designLabels.back'),
    sleeve: t('fulfillmentDialog.designLabels.sleeve'),
    hood: t('fulfillmentDialog.designLabels.hood'),
    folder: t('fulfillmentDialog.designLabels.folder'),
    placket: t('fulfillmentDialog.designLabels.placket'),
    chestLeft: t('fulfillmentDialog.designLabels.chestLeft'),
    chestRight: t('fulfillmentDialog.designLabels.chestRight'),
    left: t('fulfillmentDialog.designLabels.left'),
    right: t('fulfillmentDialog.designLabels.right'),
    sleeveLeft: t('fulfillmentDialog.designLabels.sleeveLeft'),
    sleeveRight: t('fulfillmentDialog.designLabels.sleeveRight'),
    leftUpperSleeve: t('fulfillmentDialog.designLabels.leftUpperSleeve'),
    rightUpperSleeve: t('fulfillmentDialog.designLabels.rightUpperSleeve'),
    leftCuff: t('fulfillmentDialog.designLabels.leftCuff'),
    rightCuff: t('fulfillmentDialog.designLabels.rightCuff'),
    frontEmbroidery: t('fulfillmentDialog.designLabels.frontEmbroidery'),
    backEmbroidery: t('fulfillmentDialog.designLabels.backEmbroidery'),
  };
}

/**
 * Dialog cho công nhân Fulfillment khi quét 1 đơn:
 *  - Nếu đơn đang ở ĐÚNG công đoạn của user (cùng stage + cùng xưởng) → cho
 *    "Hoàn thành" (Enter). Đơn đang chờ/làm lại sẽ tự `start` rồi `complete`
 *    trong 1 lần (mô tả ở UI). Kèm nút "Báo lỗi".
 *  - Nếu KHÔNG phải task của user → chỉ hiển thị chi tiết + banner cảnh báo,
 *    chặn mọi thao tác; Enter = đóng để quét tiếp.
 *
 * Layout to/rộng: mockup lớn bên trái, thông tin (sản phẩm/size/màu/xưởng/công
 * đoạn/tool/link design) chữ lớn bên phải.
 */
export function FulfillmentScanActionDialog({
  order,
  myStage,
  myFactoryId,
  onClose,
  onCompleted,
  onReportError,
  onScanError,
  onScanOrder,
}: Props) {
  const { t } = useTranslation('scanError');
  const currentStage = order.currentFulfillmentStage as FulfillmentStage | undefined;
  const stageStatus = (order.fulfillmentStages?.[myStage]?.status ?? undefined) as FulfillmentStageStatus | undefined;

  const sameFactory = String(order.factoryId ?? '') === String(myFactoryId ?? '');
  const sameStage = currentStage === myStage;
  // Task của user = đơn đang ở stage này + cùng xưởng + status thao tác được.
  const workable =
    stageStatus === FulfillmentStageStatus.Waiting ||
    stageStatus === FulfillmentStageStatus.InProgress ||
    stageStatus === FulfillmentStageStatus.Rework;
  const isMyTask = sameStage && sameFactory && workable;

  // Lý do khi không phải task — để hiển thị banner rõ ràng.
  const blockReason = useMemo(() => {
    if (isMyTask) return null;
    if (!sameFactory) return t('fulfillmentDialog.blockDifferentFactory');
    if (stageStatus === FulfillmentStageStatus.Done) return t('fulfillmentDialog.blockAlreadyDone');
    if (!currentStage) return t('fulfillmentDialog.blockNotInFulfillment');
    if (!sameStage) return t('fulfillmentDialog.blockWrongStage', { stage: getStageLabel(t, currentStage) });
    return t('fulfillmentDialog.blockNotOperable');
  }, [isMyTask, currentStage, sameStage, sameFactory, stageStatus, t]);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Trừ tồn kho theo đơn (`ACT-STOCK-OUT` + OK chốt; auto sau in label nếu xưởng bật).
  const {
    stockOutOpen,
    stockOutBusy,
    openStockOut,
    confirmStockOut,
    closeStockOut,
    autoAfterLabel,
    stockOutElement,
  } = useScanStockOut(order);

  // In tem khách / label giao hàng ngay từ popup — nút bấm hoặc mã `ACT-PRINT-*`.
  const {
    printTem,
    printLabel,
    loadingLabel,
    elements: printElements,
  } = useScanPrint(order, { onLabelPrinted: () => void autoAfterLabel() });

  const myStageLabel = getStageLabel(t, myStage);

  // Danh mục lỗi CỦA CÔNG ĐOẠN user (Stage Error Catalog) — validate mã `E-<code>`
  // trước khi handoff sang modal gán lỗi (luồng xác nhận 2 lần quét).
  const errorConfigs = useWorkshopConfigStore(
    (s) => s.byCategory[WorkshopConfigCategory.ProductionError] || [],
  ) as WorkshopConfig[];
  const myStageErrors = useMemo(() => errorConfigs.filter((o) => o.stage === myStage), [errorConfigs, myStage]);

  const doComplete = async () => {
    if (!isMyTask || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Đang chờ/làm lại → start trước, rồi complete (1 lần quét = xong).
      if (stageStatus === FulfillmentStageStatus.Waiting || stageStatus === FulfillmentStageStatus.Rework) {
        await RepositoryRemote.fulfillment.transition(order._id, {
          stage: myStage,
          action: FulfillmentTransitionAction.Start,
        });
      }
      await RepositoryRemote.fulfillment.transition(order._id, {
        stage: myStage,
        action: FulfillmentTransitionAction.Complete,
      });
      beepSuccess();
      toast.success(t('fulfillmentDialog.completedToast', { stage: myStageLabel, productionId: order.productionId }));
      onCompleted({ stageLabel: myStageLabel });
      onClose();
    } catch (err) {
      beepError();
      handleAxiosError(err);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /**
   * Quét mã lỗi lần 1 → KHÔNG ghi nhận ngay. Validate mã thuộc danh mục công
   * đoạn của user → handoff sang modal gán lỗi (mã đã chọn sẵn); ở đó quét lần
   * 2 CÙNG MÃ (hoặc Enter) mới ghi nhận + đẩy về — chọn nhầm còn đổi được.
   */
  const doErrorScan = (codeScanned: string) => {
    if (savingRef.current) return;
    const cfg = myStageErrors.find((o) => o.code.toLowerCase() === codeScanned);
    if (!cfg) {
      beepError();
      toast.error(t('fulfillmentDialog.errorNotInStage', { stage: myStageLabel }));
      return;
    }
    if (onScanError) onScanError(cfg.code);
    else {
      beepError();
      toast.error(t('fulfillmentDialog.reportOnlyOnScanPage'));
    }
  };

  // Buffer bắt keystroke của máy quét khi dialog mở (máy quét gõ nhanh + kết
  // thúc Enter). Enter tay (buffer rỗng) giữ hành vi cũ: Hoàn thành / Đóng.
  const scanBufRef = useRef('');
  const lastKeyAtRef = useRef(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    const now = Date.now();
    if (now - lastKeyAtRef.current > 600) scanBufRef.current = '';
    lastKeyAtRef.current = now;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      scanBufRef.current += e.key;
      e.preventDefault(); // tránh space/ký tự kích hoạt button đang focus
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (saving) return;
    const raw = scanBufRef.current.trim();
    scanBufRef.current = '';
    if (!raw) {
      if (stockOutOpen) void confirmStockOut(); // Enter tay khi khối trừ kho mở = chốt
      else if (isMyTask) void doComplete();
      else onClose(); // không phải task → Enter để quét tiếp
      return;
    }
    const action = parseScanCode(raw);
    // Mã hành động `ACT-*` (bảng mã dán trạm) — điều khiển popup không cần chuột.
    if (action.kind === 'action') {
      if (action.command === 'cancel') {
        // Khối trừ kho đang mở → CANCEL chỉ đóng khối, không đóng popup.
        if (stockOutOpen) closeStockOut();
        else onClose();
      } else if (action.command === 'print-tem') printTem();
      else if (action.command === 'print-label') void printLabel();
      else if (action.command === 'stock-out') {
        // Lần 1 mở khối xác nhận; đang mở → quét lặp = chốt trừ.
        if (stockOutOpen) void confirmStockOut();
        else void openStockOut();
      } else onReportError(); // report-error → chuyển sang dialog gán lỗi
      return;
    }
    if (action.kind === 'ok') {
      // Khối trừ kho đang mở → OK chốt trừ, KHÔNG hoàn thành công đoạn.
      if (stockOutOpen) {
        void confirmStockOut();
        return;
      }
      if (isMyTask) void doComplete();
      else {
        beepError();
        toast.error(blockReason ?? t('fulfillmentDialog.notYourTask'));
      }
      return;
    }
    if (action.kind === 'error') {
      doErrorScan(action.code);
      return;
    }
    if (action.kind === 'order') {
      // Quét LẠI đúng mã đơn đang mở = xác nhận hoàn thành (như quét OK) —
      // công nhân không cần mã OK riêng, quét cùng 1 barcode 2 lần là xong.
      if (action.code.toLowerCase() === (order.productionId || '').toLowerCase()) {
        if (isMyTask) void doComplete();
        else {
          beepError();
          toast.error(blockReason ?? t('fulfillmentDialog.notYourTask'));
        }
        return;
      }
      if (onScanOrder) onScanOrder(action.code);
      else {
        beepError();
        toast.error(t('fulfillmentDialog.closeDialogFirst'));
      }
      return;
    }
    beepError();
    toast.error(t('fulfillmentDialog.invalidCode', { code: raw }));
  };

  const STATUS_META = useMemo(() => buildStatusMeta(t), [t]);
  const DESIGN_LABELS = useMemo(() => buildDesignLabels(t), [t]);

  const statusMeta = stageStatus ? STATUS_META[stageStatus] : undefined;
  const factoryLabel =
    order.factory?.shortName || order.factory?.name || (order.factoryId ? '—' : t('fulfillmentDialog.notMapped'));
  const machineLabel = order.machineType?.shortName || order.machineType?.name || '';

  const mockupUrl = order.mockupOriginalUrl || order.mockupUrl;

  // Trạng thái soát tool: 'ok' = đã ok, có note khác = lỗi, rỗng = chưa soát.
  const toolNote = (order.toolResultNote ?? '').trim();
  const toolMeta = useMemo(() => {
    if (!toolNote) return { label: t('fulfillmentDialog.toolNotChecked'), cls: 'text-muted-foreground', ok: false };
    if (toolNote.toLowerCase() === 'ok')
      return { label: t('fulfillmentDialog.toolOk'), cls: 'text-emerald-600 dark:text-emerald-400', ok: true };
    return { label: toolNote, cls: 'text-rose-600 dark:text-rose-400', ok: false };
  }, [toolNote, t]);

  // Gom link design (các vị trí có URL) + file cutting.
  const designLinks = useMemo(() => {
    const d = (order.designs ?? {}) as Record<string, string | undefined>;
    const links = Object.entries(d)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .map(([k, v]) => ({ key: k, label: DESIGN_LABELS[k] ?? k, url: v as string }));
    if (order.cuttingFileUrl) {
      links.push({
        key: 'cutting',
        label: order.cuttingFileName || t('fulfillmentDialog.cuttingFileLabel'),
        url: order.cuttingFileUrl,
      });
    }
    return links;
  }, [order.designs, order.cuttingFileUrl, order.cuttingFileName, DESIGN_LABELS, t]);

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      {/* Modal gần full màn hình — công nhân đứng xa vẫn đọc được: mockup chiếm
          1 nửa trái cao hết modal, cột phải chữ to (text-lg trở lên). */}
      <DialogContent
        className="max-w-[96vw] w-[96vw] h-[94vh] max-h-[94vh] flex flex-col overflow-hidden gap-4"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-2xl">
            <Layers size={26} className="text-primary" />
            {t('fulfillmentDialog.dialogTitle', { stage: myStageLabel })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid gap-6 md:grid-cols-2">
          {/* Mockup — chiếm 1 nửa, cao hết modal + nút mở ảnh gốc to */}
          <div className="min-w-0 min-h-0 flex flex-col gap-3">
            {mockupUrl ? (
              <>
                <a
                  href={mockupUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={t('fulfillmentDialog.clickToOpenOriginal')}
                  className="group relative block flex-1 min-h-0 rounded-xl border border-border overflow-hidden bg-checker"
                >
                  <img
                    src={order.mockupUrl || mockupUrl}
                    alt={order.productionId}
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </a>
                <Button asChild variant="outline" className="h-14 text-lg shrink-0">
                  <a href={mockupUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={22} className="mr-2" />
                    {t('fulfillmentDialog.openOriginal')}
                  </a>
                </Button>
              </>
            ) : (
              <div className="flex-1 min-h-0 rounded-xl border border-dashed border-border bg-muted/40 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <ImageIcon size={64} />
                <span className="text-lg">{t('fulfillmentDialog.noMockup')}</span>
              </div>
            )}
          </div>

          {/* Thông tin — chữ lớn, cuộn dọc khi tràn */}
          <div className="min-w-0 min-h-0 overflow-y-auto space-y-5 pr-1">
            {/* Tên sản phẩm + productionId + trạng thái */}
            <div className="space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-3xl font-bold leading-tight text-foreground">
                  {order.type || t('fulfillmentDialog.unknownProductType')}
                </h2>
                {statusMeta && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-base font-semibold shrink-0',
                      statusMeta.cls,
                    )}
                  >
                    <statusMeta.icon size={18} />
                    {statusMeta.label}
                  </span>
                )}
              </div>
              <div className="font-mono text-2xl font-semibold text-primary">{order.productionId}</div>
              {order.userSku && <div className="text-lg text-muted-foreground truncate">📧 {order.userSku}</div>}
            </div>

            {/* Size / Màu / SL — badge lớn */}
            <div className="grid grid-cols-3 gap-3">
              <BigField icon={<Ruler size={18} />} label={t('fulfillmentDialog.fieldSize')} value={order.size || '—'} />
              <BigField icon={<Palette size={18} />} label={t('fulfillmentDialog.fieldColor')} value={order.color || '—'} />
              <BigField
                icon={<Package size={18} />}
                label={t('fulfillmentDialog.fieldQuantity')}
                value={String(order.quantity ?? 1)}
              />
            </div>

            {/* Xưởng / Công đoạn / Tool */}
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-lg">
              <DetailRow icon={<Factory size={20} />} label={t('fulfillmentDialog.detailFactory')}>
                <span className="font-medium">{factoryLabel}</span>
                {machineLabel && <span className="text-muted-foreground"> · {machineLabel}</span>}
              </DetailRow>
              <DetailRow icon={<Layers size={20} />} label={t('fulfillmentDialog.detailCurrentStage')}>
                <span className="font-medium">
                  {currentStage ? getStageLabel(t, currentStage) : t('fulfillmentDialog.notInFulfillment')}
                </span>
              </DetailRow>
              <DetailRow icon={<Wrench size={20} />} label={t('fulfillmentDialog.detailToolResult')}>
                <span className={cn('font-semibold', toolMeta.cls)}>{toolMeta.label}</span>
              </DetailRow>
            </div>

            {/* Link design */}
            <div className="space-y-2">
              <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {t('fulfillmentDialog.designLinksTitle', { count: designLinks.length })}
              </div>
              {designLinks.length === 0 ? (
                <p className="text-base text-muted-foreground italic">{t('fulfillmentDialog.noDesignLinks')}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {designLinks.map((l) => (
                    <a
                      key={l.key}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2.5 text-base font-medium text-foreground hover:border-primary hover:text-primary transition-colors"
                    >
                      <ExternalLink size={16} />
                      {l.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Banner trạng thái + hướng dẫn quét 3 bước CHỮ TO — công nhân đứng xa đọc được */}
        {isMyTask ? (
          <div className="shrink-0 space-y-3">
            <div className="rounded-md border border-emerald-300/50 bg-emerald-50/50 dark:bg-emerald-500/5 p-3 text-lg font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2.5">
              <CheckCircle2 size={22} className="shrink-0" />
              {stageStatus === FulfillmentStageStatus.InProgress ? (
                <span>
                  <Trans i18nKey="fulfillmentDialog.bannerInProgress" ns="scanError" components={{ strong: <strong /> }} />
                </span>
              ) : (
                <span>
                  <Trans
                    i18nKey="fulfillmentDialog.bannerStatus"
                    ns="scanError"
                    values={{ status: statusMeta?.label ?? '—' }}
                    components={{ strong: <strong /> }}
                  />
                </span>
              )}
            </div>
            {/* Chia 2 VÙNG: Hoàn thành (trái) · Báo lỗi 2 bước + link thêm lỗi (phải) */}
            <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
              <GuideZone label={t('fulfillmentDialog.zoneComplete')} tone="emerald">
                <GuideStep
                  step={1}
                  tone="emerald"
                  icon={<CheckCircle2 size={20} />}
                  title={t('fulfillmentDialog.completeStepTitle')}
                  desc={t('fulfillmentDialog.completeStepDesc')}
                />
              </GuideZone>
              <GuideZone label={t('fulfillmentDialog.zoneReportError')} tone="rose" action={<AddErrorLink />}>
                <div className="grid gap-2.5 md:grid-cols-2">
                  <GuideStep
                    step={1}
                    tone="rose"
                    icon={<Barcode size={20} />}
                    title={t('fulfillmentDialog.errorStep1Title')}
                    desc={t('fulfillmentDialog.errorStep1Desc')}
                  />
                  <GuideStep
                    step={2}
                    tone="amber"
                    icon={<RotateCw size={20} />}
                    title={t('fulfillmentDialog.errorStep2Title')}
                    desc={t('fulfillmentDialog.errorStep2Desc')}
                  />
                </div>
              </GuideZone>
            </div>
          </div>
        ) : (
          <div className="shrink-0 space-y-3">
            <div className="rounded-md border border-rose-300/50 bg-rose-50/50 dark:bg-rose-500/5 p-3 text-lg font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-2.5">
              <ShieldAlert size={22} className="shrink-0" />
              <span>{t('fulfillmentDialog.notYourTaskBanner', { reason: blockReason })}</span>
            </div>
            {/* Chia 2 VÙNG: Báo lỗi đơn xa 2 bước + link thêm lỗi (trái) · Quét tiếp (phải) */}
            <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
              <GuideZone label={t('fulfillmentDialog.zoneReportThisOrder')} tone="rose" action={<AddErrorLink />}>
                <div className="grid gap-2.5 md:grid-cols-2">
                  <GuideStep
                    step={1}
                    tone="rose"
                    icon={<Barcode size={20} />}
                    title={t('fulfillmentDialog.errorStep1Title')}
                    desc={t('fulfillmentDialog.farErrorStep1Desc')}
                  />
                  <GuideStep
                    step={2}
                    tone="amber"
                    icon={<RotateCw size={20} />}
                    title={t('fulfillmentDialog.errorStep2Title')}
                    desc={t('fulfillmentDialog.farErrorStep2Desc')}
                  />
                </div>
              </GuideZone>
              <GuideZone label={t('fulfillmentDialog.zoneContinueScan')} tone="slate">
                <GuideStep
                  step={1}
                  tone="slate"
                  icon={<ScanLine size={20} />}
                  title={t('fulfillmentDialog.continueScanTitle')}
                  desc={t('fulfillmentDialog.continueScanDesc')}
                />
              </GuideZone>
            </div>
          </div>
        )}

        {stockOutElement}
        <DialogFooter className="gap-3 shrink-0">
          <Button variant="outline" onClick={printTem} disabled={saving} className="h-14 px-5 text-lg">
            <Printer size={20} className="mr-2" />
            {t('printActions.printTemBtn')}
          </Button>
          <Button
            variant="outline"
            onClick={() => void printLabel()}
            disabled={saving || loadingLabel}
            className="h-14 px-5 text-lg"
          >
            <Tag size={20} className="mr-2" />
            {t('printActions.printLabelBtn')}
          </Button>
          <Button
            variant="outline"
            onClick={() => void (stockOutOpen ? confirmStockOut() : openStockOut())}
            disabled={saving || stockOutBusy}
            className="h-14 px-5 text-lg"
          >
            <Boxes size={20} className="mr-2" />
            {t('stockOut.btn')}
          </Button>
          {isMyTask ? (
            <>
              <Button variant="outline" onClick={onReportError} disabled={saving} className="h-14 px-6 text-lg">
                <MessageSquareWarning size={20} className="mr-2 text-rose-500" />
                {t('fulfillmentDialog.reportErrorBtn')}
              </Button>
              <Button onClick={() => void doComplete()} disabled={saving} autoFocus className="h-14 px-8 text-lg">
                {saving ? <Spinner size={20} className="mr-2" /> : <CheckCircle2 size={22} className="mr-2" />}
                {t('fulfillmentDialog.completeBtn')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onReportError} disabled={saving} className="h-14 px-6 text-lg">
                <MessageSquareWarning size={20} className="mr-2 text-rose-500" />
                {t('fulfillmentDialog.reportThisOrderBtn')}
              </Button>
              <Button onClick={onClose} autoFocus className="h-14 px-8 text-lg">
                {t('fulfillmentDialog.closeContinueBtn')}
              </Button>
            </>
          )}
        </DialogFooter>
        {printElements}
      </DialogContent>
    </Dialog>
  );
}

/** Ô số liệu lớn (size / màu / số lượng). */
function BigField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-center">
      <div className="flex items-center justify-center gap-1.5 text-sm uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold text-foreground truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}
