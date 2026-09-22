import React, { useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Barcode,
  Boxes,
  CheckCircle2,
  Factory,
  Layers,
  MessageSquareWarning,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Tag,
} from 'lucide-react';
import type { FulfillmentStage as FulfillmentStageT, ProductionOrderRow, WorkshopConfig } from 'shared';
import { FulfillmentStage, WorkshopConfigCategory } from 'shared';
import { toast } from 'sonner';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';
import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { getStageLabel } from '@/utils/fulfillmentStageLabel';
import { isCancelled } from '@/utils/orderActions';
import { beepError, beepScan, beepSuccess, parseScanCode, resolveErrorScan } from '@/utils/scanCodes';

import { GuideStep, GuideZone } from './ScanGuide';
import { useScanPrint } from './useScanPrint';
import { useScanStockOut } from './useScanStockOut';

const MAX_NOTE = 500;

type ScannedOrder = ProductionOrderRow & {
  factory?: { name?: string; shortName?: string };
  machineType?: { name?: string; shortName?: string };
};

interface Props {
  order: ScannedOrder;
  onClose: () => void;
  /** Gọi sau khi gán lỗi (và rework-back nếu có) thành công. Page sẽ append vào lịch sử + re-focus input. */
  onSaved: (summary: { errorName: string; targetLabel: string }) => void;
  /** Quét barcode ĐƠN khác (`N-…`) khi dialog đang mở → page tra cứu đơn mới. */
  onScanOrder?: (code: string) => void;
  /** Mã lỗi đã quét lần 1 (handoff từ dialog công đoạn) → pre-select, chờ quét lần 2 xác nhận. */
  initialCode?: string;
}

/**
 * Modal gán lỗi qua màn quét. Danh sách mã lỗi CHỈ lấy từ danh mục lỗi của
 * CÔNG ĐOẠN người báo (Stage Error Catalog — `stage` của user, fallback công
 * đoạn hiện tại của đơn cho user không có stage). Chọn lỗi → nguồn + đích đẩy
 * về TỰ THEO CONFIG (không chỉnh tay). Chưa có lỗi nào → link sang trang
 * `/orders/stage-errors` để thêm. Xem StageErrorCatalog.md.
 */
export function OrderErrorScanDialog({ order, onClose, onSaved, onScanOrder, initialCode }: Props) {
  const { t } = useTranslation('scanError');
  const SOURCE_LABELS: Record<string, string> = {
    'tool-check': t('orderErrorDialog.sourceLabels.toolCheck'),
    designer: t('orderErrorDialog.sourceLabels.designer'),
    factory: t('orderErrorDialog.sourceLabels.factory'),
  };
  const errorOptions = useWorkshopConfigStore(
    (s) => s.byCategory[WorkshopConfigCategory.ProductionError] || [],
  ) as WorkshopConfig[];

  const profile = useAuthStore((s) => s.profile);
  const myStage = profile?.fulfillmentStage as FulfillmentStageT | undefined;

  const currentStage = order.currentFulfillmentStage as FulfillmentStageT | undefined;
  const isCompleted = !currentStage && !!order.fulfillmentCompletedAt;
  // Vị trí xa nhất đơn từng tới → validate đích đẩy về theo config lỗi.
  const furthest = currentStage ?? (isCompleted ? FulfillmentStage.Pack : undefined);

  // Công đoạn ngữ cảnh = stage của user (công nhân); user không có stage
  // (admin/support) → công đoạn hiện tại của đơn.
  const contextStage = myStage ?? currentStage;
  const stageErrors = useMemo(
    () => errorOptions.filter((o) => o.stage === contextStage).sort((a, b) => a.order - b.order),
    [errorOptions, contextStage],
  );

  const [code, setCode] = useState<string>(initialCode ?? '');
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState(false);

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

  const selectedCfg = useMemo(() => stageErrors.find((o) => o.code === code), [stageErrors, code]);
  // Nguồn + đích đẩy về suy từ config — hiển thị read-only, không cho chọn tay.
  const resolution = useMemo(
    () => (selectedCfg ? resolveErrorScan(selectedCfg, furthest, t) : undefined),
    [selectedCfg, furthest, t],
  );

  // Đơn đã hủy → chặn báo lỗi / đẩy về công đoạn trước (mirror guard BE).
  const orderCancelled = isCancelled(order);

  const canSubmit = !!selectedCfg && !!resolution?.ok && !orderCancelled && !saving;

  const submitError = async (cfg: WorkshopConfig) => {
    const resolved = resolveErrorScan(cfg, furthest, t);
    if (!resolved.ok) {
      beepError();
      toast.error(resolved.reason);
      return;
    }
    setSaving(true);
    try {
      // 1 lần setProductionError (BE atomic): gán lỗi + đẩy về theo config.
      await RepositoryRemote.order.setProductionError(order._id, {
        code: cfg.code,
        source: resolved.source,
        note: note.trim() || undefined,
        target: resolved.apiTarget,
      });
      beepSuccess();
      toast.success(t('orderErrorDialog.assignedSuccess', { name: cfg.name, target: resolved.targetLabel }));
      onSaved({ errorName: cfg.name, targetLabel: resolved.targetLabel });
      onClose();
    } catch (err) {
      beepError();
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => {
    if (!canSubmit || !selectedCfg) return;
    void submitError(selectedCfg);
  };

  /**
   * Quét mã lỗi (`E-<code>`) khi dialog mở — luồng XÁC NHẬN 2 LẦN:
   *  - Mã phải thuộc danh mục CÔNG ĐOẠN ngữ cảnh (bảng mã lỗi của trạm) — sai → từ chối.
   *  - Lần 1 (mã khác mã đang chọn) → chỉ CHỌN lỗi, dừng 1 nhịp cho nhập mô tả.
   *  - Lần 2 CÙNG MÃ (hoặc Enter tay) → mới ghi nhận + đẩy về. Quét mã khác → đổi lựa chọn.
   */
  const handleErrorScan = (codeScanned: string) => {
    if (saving) return;
    if (orderCancelled) {
      beepError();
      toast.error(t('orderErrorDialog.orderCancelled'));
      return;
    }
    const cfg = stageErrors.find((o) => o.code.toLowerCase() === codeScanned);
    if (!cfg) {
      beepError();
      toast.error(
        contextStage
          ? t('orderErrorDialog.errorNotInStage', { stage: getStageLabel(t, contextStage) })
          : t('orderErrorDialog.noStageContext'),
      );
      return;
    }
    if (code === cfg.code) {
      void submitError(cfg);
      return;
    }
    setCode(cfg.code);
    beepScan();
    toast(t('orderErrorDialog.selectedError', { name: cfg.name }));
  };

  /** Route 1 mã đã quét về đúng hành động. Trả false nếu mã không hợp lệ. */
  const dispatchScan = (raw: string): boolean => {
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
      } else {
        // report-error: đã đứng sẵn ở màn báo lỗi → nhắc quét thẳng mã lỗi E-…
        beepScan();
        toast(t('orderErrorDialog.alreadyInErrorMode'));
      }
      return true;
    }
    if (action.kind === 'error') {
      handleErrorScan(action.code);
      return true;
    }
    if (action.kind === 'order') {
      if (onScanOrder) onScanOrder(action.code);
      else {
        beepError();
        toast.error(t('orderErrorDialog.closeDialogFirst'));
      }
      return true;
    }
    if (action.kind === 'ok') {
      // Khối trừ kho đang mở → OK chốt trừ; ngoài ra OK không có nghĩa ở màn này.
      if (stockOutOpen) {
        void confirmStockOut();
        return true;
      }
      beepError();
      toast.error(t('orderErrorDialog.okOnlyForWorker'));
      return true;
    }
    return false;
  };

  // Buffer bắt keystroke máy quét khi dialog mở. Textarea note có burst-detector
  // riêng: máy quét "gõ" mã vào note khi đang focus → nhận diện chuỗi ≥4 ký tự
  // toàn gap <100ms kết thúc Enter → cắt khỏi note + xử lý như mã quét.
  const scanBufRef = useRef('');
  const lastKeyAtRef = useRef(0);
  const taBufRef = useRef('');
  const taLastAtRef = useRef(0);
  const taAllFastRef = useRef(true);

  const handleScanKeyDown = (e: React.KeyboardEvent): boolean => {
    const el = e.target as HTMLElement;
    const now = Date.now();

    if (el.tagName === 'TEXTAREA') {
      const gap = now - taLastAtRef.current;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (gap > 300) {
          taBufRef.current = '';
          taAllFastRef.current = true;
        } else if (taBufRef.current.length > 0) {
          taAllFastRef.current = taAllFastRef.current && gap < 100;
        }
        taBufRef.current += e.key;
        taLastAtRef.current = now;
        return false; // vẫn cho ký tự vào note — chỉ cắt khi xác định là mã quét
      }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        const burst = taBufRef.current;
        taBufRef.current = '';
        taLastAtRef.current = now;
        if (burst.length >= 4 && taAllFastRef.current && gap < 100 && parseScanCode(burst).kind !== 'unknown') {
          e.preventDefault();
          setNote((prev) => (prev.endsWith(burst) ? prev.slice(0, prev.length - burst.length) : prev));
          dispatchScan(burst.trim());
          return true;
        }
        return false; // Enter thường trong textarea = xuống dòng
      }
      return false;
    }
    if (el.tagName === 'INPUT') return false;

    if (now - lastKeyAtRef.current > 600) scanBufRef.current = '';
    lastKeyAtRef.current = now;
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      scanBufRef.current += e.key;
      e.preventDefault();
      return true;
    }
    if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return false;
    const raw = scanBufRef.current.trim();
    scanBufRef.current = '';
    if (!raw) {
      // Enter TAY (buffer rỗng, không đứng trên button) → ghi nhận lỗi đang chọn.
      if (el.tagName !== 'BUTTON' && canSubmit) {
        e.preventDefault();
        handleSubmit();
        return true;
      }
      return false;
    }
    e.preventDefault();
    if (!dispatchScan(raw)) {
      beepError();
      toast.error(t('orderErrorDialog.invalidCode', { code: raw }));
    }
    return true;
  };

  const factoryLabel =
    order.factory?.shortName || order.factory?.name || (order.factoryId ? '—' : t('orderErrorDialog.notMapped'));
  const machineLabel = order.machineType?.shortName || order.machineType?.name || '';
  const stageLabel = currentStage ? getStageLabel(t, currentStage) : t('orderErrorDialog.notInFulfillment');

  // Lỗi đã ghi sẵn trên đơn (từ lần quét/gán trước) — hiển thị nổi bật để người
  // quét biết đơn này đang lỗi gì mà xử lý.
  const existingErrorName = order.productionError
    ? errorOptions.find((o) => o.code === order.productionError)?.name || order.productionError
    : '';

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      {/* Modal gần full màn hình — mockup chiếm 1 nửa trái, form chữ to bên phải. */}
      <DialogContent
        className="max-w-[96vw] w-[96vw] h-[94vh] max-h-[94vh] flex flex-col overflow-hidden gap-4"
        onKeyDown={(e) => {
          // Máy quét (N-/E-/OK) xử lý trước — nếu đã nuốt event thì thôi.
          if (handleScanKeyDown(e)) return;
          // Cho phép Cmd/Ctrl+Enter submit nhanh khi đã đủ điều kiện
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-2xl">
            <MessageSquareWarning size={24} className="text-rose-500" />
            {t('orderErrorDialog.dialogTitle', { productionId: order.productionId })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid gap-6 md:grid-cols-2">
          {/* Trái: mockup chiếm 1 nửa, cao hết modal + thông tin đơn chữ to */}
          <div className="min-w-0 min-h-0 flex flex-col gap-3">
            {order.mockupUrl ? (
              <a
                href={order.mockupOriginalUrl || order.mockupUrl}
                target="_blank"
                rel="noreferrer"
                title={t('orderErrorDialog.clickToOpenOriginal')}
                className="block flex-1 min-h-0 rounded-xl border border-border overflow-hidden bg-checker"
              >
                <img
                  src={order.mockupUrl}
                  alt={order.productionId}
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </a>
            ) : (
              <div className="flex-1 min-h-0 rounded-xl border border-dashed border-border bg-muted/40 flex items-center justify-center text-lg text-muted-foreground">
                {t('orderErrorDialog.noMockup')}
              </div>
            )}
            <div className="shrink-0 rounded-md border bg-muted/30 p-4 space-y-1.5">
              <div className="font-semibold text-2xl truncate">{order.type || t('orderErrorDialog.unknownType')}</div>
              <div className="text-muted-foreground text-lg truncate">
                {[order.color, order.size, order.quantity ? `qty ${order.quantity}` : null].filter(Boolean).join(' · ')}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-1.5 pt-1 text-lg">
                <InfoRow icon={<Factory size={18} />} label={t('orderErrorDialog.labelFactory')}>
                  {factoryLabel}
                  {machineLabel && <span className="text-muted-foreground"> · {machineLabel}</span>}
                </InfoRow>
                <InfoRow icon={<Layers size={18} />} label={t('orderErrorDialog.labelStage')}>
                  {stageLabel}
                  {order.designerReworkCount && order.designerReworkCount > 0 ? (
                    <span className="ml-1 text-amber-600 dark:text-amber-400">
                      {t('orderErrorDialog.reworkCount', { count: order.designerReworkCount })}
                    </span>
                  ) : null}
                </InfoRow>
              </div>
            </div>
          </div>

          {/* Phải: hướng dẫn + banner + form gán lỗi — cuộn dọc khi tràn */}
          <div className="min-w-0 min-h-0 overflow-y-auto space-y-4 pr-1">
            {/* Hướng dẫn 3 bước CHỮ TO — bọc vùng viền đậm + link thêm lỗi */}
            <GuideZone
              label={t('orderErrorDialog.zoneHowToReport')}
              tone="rose"
              action={
                <Link
                  to={PATHS.ORDERS_STAGE_ERRORS}
                  className="inline-flex items-center gap-1 text-base font-semibold text-rose-600 dark:text-rose-400 underline underline-offset-2 hover:text-rose-700 dark:hover:text-rose-300"
                >
                  <Plus size={16} /> {t('addErrorLink')}
                </Link>
              }
            >
              <div className="grid gap-2.5 sm:grid-cols-3">
                <GuideStep
                  step={1}
                  tone="rose"
                  icon={<Barcode size={20} />}
                  title={t('orderErrorDialog.step1Title')}
                  desc={t('orderErrorDialog.step1Desc')}
                />
                <GuideStep
                  step={2}
                  tone="slate"
                  icon={<Pencil size={20} />}
                  title={t('orderErrorDialog.step2Title')}
                  desc={t('orderErrorDialog.step2Desc')}
                />
                <GuideStep
                  step={3}
                  tone="emerald"
                  icon={<CheckCircle2 size={20} />}
                  title={t('orderErrorDialog.step3Title')}
                  desc={t('orderErrorDialog.step3Desc')}
                />
              </div>
            </GuideZone>

        {/* Đơn đã hủy → chặn mọi thao tác báo lỗi / đẩy về công đoạn trước. */}
        {orderCancelled && (
          <div className="rounded-md border border-rose-400 bg-rose-100 p-3.5 flex items-start gap-2.5 dark:border-rose-500/50 dark:bg-rose-500/15">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0 flex-1 text-base text-rose-800 dark:text-rose-200">
              <p className="font-semibold">{t('orderErrorDialog.cancelledTitle')}</p>
              <p className="mt-0.5">{t('orderErrorDialog.cancelledDesc')}</p>
            </div>
          </div>
        )}

        {/* Lỗi + mô tả đã ghi trên đơn — nổi bật (đỏ) để người quét thấy ngay. */}
        {(order.productionErrorNote || existingErrorName) && (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3.5 flex items-start gap-2.5 dark:border-rose-500/40 dark:bg-rose-500/10">
            <MessageSquareWarning size={20} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5 flex-wrap">
                {t('orderErrorDialog.existingErrorTitle')}
                {existingErrorName && (
                  <span className="px-1.5 py-0.5 rounded bg-rose-200/70 font-normal dark:bg-rose-500/20">
                    {existingErrorName}
                  </span>
                )}
                {order.productionErrorSource && (
                  <span className="px-1.5 py-0.5 rounded bg-rose-200/70 font-normal dark:bg-rose-500/20">
                    {SOURCE_LABELS[order.productionErrorSource] ?? order.productionErrorSource}
                  </span>
                )}
                {order.productionErrorCount && order.productionErrorCount > 1 ? (
                  <span className="px-1.5 py-0.5 rounded bg-rose-200/70 font-mono dark:bg-rose-500/20">
                    {t('orderErrorDialog.countSuffix', { count: order.productionErrorCount })}
                  </span>
                ) : null}
              </p>
              {order.productionErrorNote && (
                <p
                  className="mt-1 text-base text-rose-900 dark:text-rose-100 line-clamp-2 break-words cursor-help"
                  title={order.productionErrorNote}
                >
                  {order.productionErrorNote}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
          {/* Mã lỗi — CHỈ list của công đoạn ngữ cảnh (Stage Error Catalog) */}
          <div className="space-y-2.5">
            <Label className="text-lg">
              {t('orderErrorDialog.codeLabel')}{' '}
              {contextStage && (
                <span className="text-muted-foreground font-normal">
                  {t('orderErrorDialog.codeStageSuffix', { stage: getStageLabel(t, contextStage) })}
                </span>
              )}{' '}
              <span className="text-destructive">*</span>
            </Label>
            {stageErrors.length === 0 ? (
              <div className="rounded-md border border-dashed border-amber-300/60 bg-amber-50/40 dark:bg-amber-500/5 p-3.5 text-base text-amber-700 dark:text-amber-300 space-y-2">
                <p className="flex items-start gap-2">
                  <Barcode size={18} className="mt-0.5 shrink-0" />
                  <span>
                    {contextStage
                      ? t('orderErrorDialog.noErrorsInStage', { stage: getStageLabel(t, contextStage) })
                      : t('orderErrorDialog.noStageNoErrors')}
                  </span>
                </p>
                {contextStage && (
                  <Link
                    to={PATHS.ORDERS_STAGE_ERRORS}
                    className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200"
                  >
                    <Plus size={16} /> {t('orderErrorDialog.addErrorForStage')}
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stageErrors.map((opt) => {
                  const active = code === opt.code;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => setCode(opt.code)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md border text-lg font-medium transition-colors',
                        active
                          ? 'bg-rose-500 border-rose-500 text-white'
                          : 'bg-background border-border hover:border-rose-300',
                      )}
                    >
                      {opt.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Nguồn + đích đẩy về — TỰ THEO CONFIG, read-only (không chọn tay) */}
          {selectedCfg && resolution && (
            <div
              className={cn(
                'rounded-md border p-4 text-lg flex items-start gap-2.5',
                resolution.ok
                  ? 'border-amber-300/60 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5 text-amber-700 dark:text-amber-300'
                  : 'border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300',
              )}
            >
              <RotateCcw size={22} className="mt-1 shrink-0" />
              {resolution.ok ? (
                <span>
                  <strong>{SOURCE_LABELS[resolution.source]}</strong> · <strong>{resolution.targetLabel}</strong>
                  <span className="block mt-0.5 font-normal opacity-80">
                    <Trans i18nKey="orderErrorDialog.resolutionHint" ns="scanError" components={{ strong: <strong /> }} />
                  </span>
                </span>
              ) : (
                <span>{resolution.reason}</span>
              )}
            </div>
          )}

          {/* Note */}
          <div className="space-y-2">
            <Label className="text-lg">{t('orderErrorDialog.noteLabel')}</Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
              placeholder={t('orderErrorDialog.notePlaceholder')}
              className="text-lg"
            />
            <div className="text-right text-xs text-muted-foreground">
              {note.length}/{MAX_NOTE}
            </div>
          </div>
        </div>
          </div>
        </div>

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
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-14 px-7 text-lg">
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="h-14 px-8 text-lg">
            {saving && <Spinner size={20} className="mr-2" />}
            {t('orderErrorDialog.assignAndContinueBtn')}
          </Button>
        </DialogFooter>
        {printElements}
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium truncate">{children}</span>
    </div>
  );
}
