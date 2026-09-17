import React, { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  CheckCircle2,
  Download,
  FileDown,
  Flag,
  PauseCircle,
  PlayCircle,
  Printer,
  RefreshCw,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import type { BarcodeLabel, ExportShippingLabelsRes, OrderWorkshopField, ShippingLabel, WorkshopConfigCategory } from 'shared';
import { ORDER_PRIORITIES, ORDER_PRIORITY_LABELS, ORDER_WORKSHOP_FIELDS } from 'shared';
import { toast } from 'sonner';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import { cn, handleAxiosError } from '@/utils';
import { canUserHold } from '@/utils/orderActions';

import { usePermission } from '@/hooks/usePermission';
import { buildDetailOnlyWorkbook, downloadWorkbook, type ExportableOrder } from '@/pages/home/exportOrders';
import { LucideIcon } from '@/pages/workshop-config/IconPicker';

import { AssignDesignerDialog } from './AssignDesignerDialog';
import { BarcodeLabelPrint, type BarcodeLabelSize } from './BarcodeLabelPrint';
import { HOLD_REASON_PRESETS } from './HoldOrderDialog';
import { hasShippingAddress, ShippingLabelPrint } from './ShippingLabelPrint';

const FIELD_TO_CATEGORY: Record<OrderWorkshopField, WorkshopConfigCategory | null> = {
  printStatus: 'print_status' as WorkshopConfigCategory,
  printStatusNote: 'print_status_note' as WorkshopConfigCategory,
  toolResult: 'tool_result' as WorkshopConfigCategory,
  toolResultNote: 'tool_result_note' as WorkshopConfigCategory,
  errorFile: 'error_file_type' as WorkshopConfigCategory,
  errorFileNote: null,
  // Assignee đã chuyển sang userId — bulk update dùng "Gán design" dialog
  // riêng, không qua workshop_config dropdown.
  assignee: null,
  assigneeNote: 'assignee_note' as WorkshopConfigCategory,
  fabricType: 'fabric_type' as WorkshopConfigCategory,
  machineNumber: 'machine' as WorkshopConfigCategory,
  productionError: 'production_error' as WorkshopConfigCategory,
  productionErrorNote: null,
  productionErrorSource: null,
  // Ưu tiên có nút + dialog bulk riêng (giống "Gán design") — không qua dropdown "Bulk update".
  priority: null,
};

function buildFieldLabel(t: TFunction<'orders'>): Record<OrderWorkshopField, string> {
  return {
    printStatus: t('bulkEdit.fieldLabels.printStatus'),
    printStatusNote: t('bulkEdit.fieldLabels.printStatusNote'),
    toolResult: t('bulkEdit.fieldLabels.toolResult'),
    toolResultNote: t('bulkEdit.fieldLabels.toolResultNote'),
    errorFile: t('bulkEdit.fieldLabels.errorFile'),
    errorFileNote: t('bulkEdit.fieldLabels.errorFileNote'),
    assignee: t('bulkEdit.fieldLabels.assignee'),
    assigneeNote: t('bulkEdit.fieldLabels.assigneeNote'),
    fabricType: t('bulkEdit.fieldLabels.fabricType'),
    machineNumber: t('bulkEdit.fieldLabels.machineNumber'),
    productionError: t('bulkEdit.fieldLabels.productionError'),
    productionErrorNote: t('bulkEdit.fieldLabels.productionErrorNote'),
    productionErrorSource: t('bulkEdit.fieldLabels.productionErrorSource'),
    priority: t('bulkEdit.fieldLabels.priority'),
  };
}

/** Bulk update dropdown SKIP assignee + priority — đã có nút/dialog riêng ("Gán design" / "Ưu tiên"). */
const BULK_UPDATE_BLACKLIST: OrderWorkshopField[] = ['assignee', 'priority'];

/**
 * Trần số tem 1 lệnh in. Mỗi tem là 1 QR + ~8 dòng chữ dựng trong DOM cùng lúc,
 * và lệnh in giữ toàn bộ chúng trong bộ nhớ cho tới khi đóng hộp thoại — quá
 * ngưỡng này trình duyệt treo hẳn, tệ hơn nhiều so với việc báo người dùng chia
 * nhỏ lô. Đặc biệt cần thiết vì "Chọn tất cả N đơn khớp bộ lọc" ở Danh sách đơn
 * classic có thể tick hàng chục nghìn đơn chỉ bằng 1 cú bấm.
 */
const MAX_LABELS_PER_PRINT = 500;
// Trần xuất PDF label carrier — mirror `ExportShippingLabelsZod.ids.max(200)`:
// mỗi label BE phải TẢI VỀ từ CDN/Drive nên nặng hơn hẳn đường in tem.
const MAX_LABELS_PER_EXPORT_PDF = 200;

interface Props {
  selectedIds: string[];
  onClear: () => void;
  onApplied: () => void;
}

export function BulkEditToolbar({ selectedIds, onClear, onApplied }: Props) {
  const { t } = useTranslation('orders');
  const { canEditField, roleName } = usePermission();
  const byCategory = useWorkshopConfigStore((s) => s.byCategory);
  const resolveWorkshop = useWorkshopConfigStore((s) => s.resolve);
  const canHold = canUserHold(roleName);

  const [open, setOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [field, setField] = useState<OrderWorkshopField | ''>('');
  const [value, setValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [freeText, setFreeText] = useState('');
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [holding, setHolding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityValue, setPriorityValue] = useState('');
  const [applyingPriority, setApplyingPriority] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [checkingDesign, setCheckingDesign] = useState(false);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [loadingBarcodes, setLoadingBarcodes] = useState(false);
  // Tem đã tải xong — set là nhãn mount + tự bung hộp thoại in, in xong
  // `onDone` trả về null để gỡ khỏi DOM (xem BarcodeLabelPrint). `size` đi kèm
  // vì hai nút dùng chung dữ liệu, chỉ khác khổ decal.
  const [barcodeLabels, setBarcodeLabels] = useState<{ rows: BarcodeLabel[]; size: BarcodeLabelSize } | null>(null);
  const [loadingShipLabels, setLoadingShipLabels] = useState(false);
  const [exportingLabelPdf, setExportingLabelPdf] = useState(false);
  // Label giao hàng 4×6 INCH (Orders.md §16.8) — cùng vòng đời mount-in-gỡ.
  const [shippingLabels, setShippingLabels] = useState<ShippingLabel[] | null>(null);

  // In tem hàng loạt — CÙNG bố cục tem hệ cũ cho cả hai khổ, chỉ khác decal:
  // 60×40mm là tem nhỏ dán sản phẩm, 75×50mm là tem dán túi PE (Orders.md
  // §16.6 / §16.7). Mỗi productionId ra 1 trang trong cùng một lệnh in.
  //
  // Dữ liệu tem lấy từ SERVER theo `ids` chứ không lấy từ row đang hiển thị:
  // tick chọn sống xuyên trang ("Chọn tất cả N đơn khớp bộ lọc" ở Danh sách đơn
  // classic) nên phần lớn đơn được chọn KHÔNG có mặt trong `items` của bảng —
  // in theo row là lặng lẽ thiếu tem. BE cũng là nơi resolve SKU sản phẩm theo
  // Product Config và chỉ số i/n của orderId, đơn hủy bị loại lặng lẽ nên vẫn
  // cần toast "in thiếu".
  const fetchLabels = async (size: BarcodeLabelSize, setLoading: (v: boolean) => void) => {
    if (selectedIds.length > MAX_LABELS_PER_PRINT) {
      return toast.error(t('bulkEdit.labelTooMany', { max: MAX_LABELS_PER_PRINT, count: selectedIds.length }));
    }
    try {
      setLoading(true);
      const res = await RepositoryRemote.order.getBarcodeLabels({ ids: selectedIds });
      const rows = (res.data?.data || []) as BarcodeLabel[];
      if (rows.length === 0) return toast.warning(t('bulkEdit.noLabel'));
      if (rows.length < selectedIds.length) {
        toast.warning(t('bulkEdit.labelPartial', { count: rows.length, total: selectedIds.length }));
      }
      setBarcodeLabels({ rows, size });
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintLabels = () => fetchLabels('60x40', setLoadingLabels);
  const handlePrintBarcodes = () => fetchLabels('75x50', setLoadingBarcodes);

  // In label giao hàng 4×6in loạt (Orders.md §16.8) — dữ liệu BE trả sẵn qua
  // `POST /orders/shipping-labels` (SKU biến thể/cân/tên xưởng/địa chỉ), cùng
  // lý do chọn-xuyên-trang như 2 nút in trên. Đơn THIẾU ĐỊA CHỈ bị tách ra
  // cảnh báo kèm productionId (đơn cũ trước ngày kéo địa chỉ từ OnosPod) —
  // chỉ in phần còn lại, không in tem trống.
  const handlePrintShippingLabels = async () => {
    if (selectedIds.length > MAX_LABELS_PER_PRINT) {
      return toast.error(t('bulkEdit.labelTooMany', { max: MAX_LABELS_PER_PRINT, count: selectedIds.length }));
    }
    try {
      setLoadingShipLabels(true);
      const res = await RepositoryRemote.order.getShippingLabels({ ids: selectedIds });
      const rows = (res.data?.data || []) as ShippingLabel[];
      if (rows.length === 0) return toast.warning(t('bulkEdit.noLabel'));
      if (rows.length < selectedIds.length) {
        toast.warning(t('bulkEdit.labelPartial', { count: rows.length, total: selectedIds.length }));
      }
      const printable = rows.filter(hasShippingAddress);
      const missing = rows.filter((r) => !hasShippingAddress(r));
      if (missing.length > 0) {
        toast.warning(
          t('bulkEdit.shippingLabelNoAddress', {
            count: missing.length,
            list: missing
              .slice(0, 5)
              .map((r) => r.productionId)
              .join(', '),
          }),
        );
      }
      if (printable.length === 0) return;
      setShippingLabels(printable);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoadingShipLabels(false);
    }
  };

  // Xuất PDF gộp label THẬT của carrier (USPS…) — Orders.md §16.9. KHÁC nút
  // "In label giao hàng" ở trên (bản nội bộ FE render): đây là file label đã
  // mua qua VNP / khách tự cấp, BE tải về ghép mỗi label 1 trang. Đơn thiếu
  // label / tải lỗi chỉ bị bỏ qua kèm cảnh báo, file vẫn ra phần còn lại.
  const handleExportLabelPdf = async () => {
    if (selectedIds.length > MAX_LABELS_PER_EXPORT_PDF) {
      return toast.error(t('bulkEdit.labelTooMany', { max: MAX_LABELS_PER_EXPORT_PDF, count: selectedIds.length }));
    }
    try {
      setExportingLabelPdf(true);
      const res = await RepositoryRemote.order.exportShippingLabelsPdf({ ids: selectedIds });
      const data = res.data?.data as ExportShippingLabelsRes | undefined;
      if (!data) return;
      if (data.skipped.length > 0) {
        toast.warning(
          t('bulkEdit.exportLabelPdfSkipped', {
            count: data.skipped.length,
            list: data.skipped
              .slice(0, 5)
              .map((s) => s.productionId)
              .join(', '),
          }),
        );
      }
      if (data.merged.length > 0) {
        toast.info(t('bulkEdit.exportLabelPdfMerged', { count: data.merged.length }));
      }
      if (!data.pdfBase64) return toast.warning(t('bulkEdit.exportLabelPdfEmpty'));
      const bin = atob(data.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      const stamp = new Date().toLocaleString('sv-SE', { hour12: false }).replace(/[: ]/g, '-');
      a.href = url;
      a.download = `shipping-labels-${stamp}-${data.labelCount}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('bulkEdit.exportLabelPdfSuccess', { count: data.labelCount, pages: data.pageCount }));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setExportingLabelPdf(false);
    }
  };

  // Export ĐÚNG các đơn đang tick chọn — gọi /orders/export với `ids` (bỏ qua
  // phân trang, đúng cả khi chọn xuyên trang vì BE lọc theo `_id`). Chỉ 1 sheet
  // "Chi tiết đơn"; tên workshop_config resolve client-side qua store.
  const handleExport = async () => {
    try {
      setExporting(true);
      const res = await RepositoryRemote.order.exportOrders('?ids=' + selectedIds.join(','));
      const data = (res.data?.data || []) as ExportableOrder[];
      if (data.length === 0) {
        toast.warning(t('bulkEdit.noExport'));
        return;
      }
      const wb = buildDetailOnlyWorkbook(data, { resolve: resolveWorkshop });
      const stamp = new Date().toLocaleString('sv-SE', { hour12: false }).replace(/[: ]/g, '-');
      downloadWorkbook(`don-hang-chon-${stamp}.xlsx`, wb);
      toast.success(t('bulkEdit.exportSuccess', { count: data.length }));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setExporting(false);
    }
  };

  const submitHold = async (hold: boolean, reason?: string) => {
    try {
      setHolding(true);
      const res = await RepositoryRemote.order.bulkHold({ ids: selectedIds, hold, reason });
      const { matched, modified } = res.data?.data || { matched: 0, modified: 0 };
      toast.success(
        hold
          ? t('bulkEdit.holdSuccess', { modified, matched })
          : t('bulkEdit.unholdSuccess', { modified, matched }),
      );
      setHoldOpen(false);
      setHoldReason('');
      onApplied();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setHolding(false);
    }
  };

  const submitPriority = async () => {
    try {
      setApplyingPriority(true);
      const res = await RepositoryRemote.order.bulkUpdateField({
        ids: selectedIds,
        field: 'priority',
        value: priorityValue || null,
      });
      const { matched, modified } = res.data?.data || { matched: 0, modified: 0 };
      toast.success(t('bulkEdit.updateSuccess', { modified, matched }));
      setPriorityOpen(false);
      setPriorityValue('');
      onApplied();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setApplyingPriority(false);
    }
  };

  // Bỏ gán design hàng loạt — tái dùng `bulkUpdateField(field='assignee', value=null)`,
  // CÙNG code path với ô "Người thực hiện" tự xoá lựa chọn ở từng dòng
  // (AssigneeSelectCell) — BE tự reset designerStatus='unassigned' + clear mốc thời gian.
  const submitUnassignDesign = async () => {
    try {
      setUnassigning(true);
      const res = await RepositoryRemote.order.bulkUpdateField({ ids: selectedIds, field: 'assignee', value: null });
      const { matched, modified } = res.data?.data || { matched: 0, modified: 0 };
      toast.success(t('bulkEdit.updateSuccess', { modified, matched }));
      onApplied();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setUnassigning(false);
    }
  };

  // Kiểm tra design mới hàng loạt — ép tra OnosPod cho từng đơn đang tick
  // chọn, CÙNG logic với nút "Kiểm tra design mới" ở action menu từng dòng
  // (reset toolResult/toolResultNote + tự mở giữ nếu đang giữ, bất kể lý do).
  const submitCheckDesign = async () => {
    try {
      setCheckingDesign(true);
      const res = await RepositoryRemote.order.bulkCheckDesignFromOnospod(selectedIds);
      const { updated, total } = res.data?.data || { updated: 0, total: 0 };
      toast.success(t('bulkEdit.checkDesignResult', { updated, total }));
      onApplied();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setCheckingDesign(false);
    }
  };

  const editableFields = useMemo(
    () => ORDER_WORKSHOP_FIELDS.filter((f) => canEditField(f) && !BULK_UPDATE_BLACKLIST.includes(f)),
    [canEditField],
  );

  const FIELD_LABEL = useMemo(() => buildFieldLabel(t), [t]);
  const category = field ? FIELD_TO_CATEGORY[field] : null;
  const options = category ? byCategory[category] : [];

  const handleConfirm = async () => {
    if (!field) return toast.error(t('bulkEdit.chooseField'));
    const sendValue = category ? value : freeText;
    try {
      setSaving(true);
      const res = await RepositoryRemote.order.bulkUpdateField({
        ids: selectedIds,
        field,
        value: sendValue || null,
      });
      const { matched, modified } = res.data?.data || { matched: 0, modified: 0 };
      toast.success(t('bulkEdit.updateSuccess', { modified, matched }));
      setOpen(false);
      setField('');
      setValue('');
      setFreeText('');
      onApplied();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  if (selectedIds.length === 0) return null;

  return (
    <>
      <div className="sticky bottom-3 z-30 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card shadow-lg px-4 py-2">
          <CheckCircle2 size={16} className="text-primary" />
          <span className="text-sm">
            <Trans
              i18nKey="bulkEdit.selectedCount"
              ns="orders"
              values={{ count: selectedIds.length }}
              components={{ strong: <span className="font-semibold" /> }}
            />
          </span>
          <Button size="sm" onClick={() => setOpen(true)} disabled={editableFields.length === 0}>
            {t('bulkEdit.bulkUpdateBtn')}
          </Button>
          {canEditField('assignee') && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setAssignOpen(true)}>
                <UserPlus size={14} /> {t('bulkEdit.assignDesignBtn')}
              </Button>
              <Button size="sm" variant="outline" onClick={submitUnassignDesign} disabled={unassigning}>
                {unassigning ? <Spinner size={13} className="text-muted-foreground" /> : <UserMinus size={14} />}
                {t('bulkEdit.unassignDesignBtn')}
              </Button>
            </>
          )}
          {canEditField('priority') && (
            <Button size="sm" variant="secondary" onClick={() => setPriorityOpen(true)}>
              <Flag size={14} /> {t('bulkEdit.priorityBtn')}
            </Button>
          )}
          {canHold && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/30"
                onClick={() => setHoldOpen(true)}
                disabled={holding}
              >
                <PauseCircle size={14} /> {t('bulkEdit.holdBtn')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-emerald-700 dark:text-emerald-300"
                onClick={() => submitHold(false)}
                disabled={holding}
              >
                <PlayCircle size={14} /> {t('bulkEdit.unholdBtn')}
              </Button>
              <Button size="sm" variant="outline" onClick={submitCheckDesign} disabled={checkingDesign}>
                {checkingDesign ? <Spinner size={13} className="text-muted-foreground" /> : <RefreshCw size={14} />}
                {t('bulkEdit.checkDesignBtn')}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrintLabels}
            disabled={loadingLabels}
            title={t('bulkEdit.printLabelTitle')}
          >
            {loadingLabels ? <Spinner size={13} className="text-muted-foreground" /> : <Printer size={13} />}
            {t('bulkEdit.printLabelBtn')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrintBarcodes}
            disabled={loadingBarcodes}
            title={t('bulkEdit.printBarcodeTitle')}
          >
            {loadingBarcodes ? <Spinner size={13} className="text-muted-foreground" /> : <Printer size={13} />}
            {t('bulkEdit.printBarcodeBtn')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrintShippingLabels}
            disabled={loadingShipLabels}
            title={t('bulkEdit.printShippingLabelTitle')}
          >
            {loadingShipLabels ? <Spinner size={13} className="text-muted-foreground" /> : <Printer size={13} />}
            {t('bulkEdit.printShippingLabelBtn')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportLabelPdf}
            disabled={exportingLabelPdf}
            title={t('bulkEdit.exportLabelPdfTitle')}
          >
            {exportingLabelPdf ? <Spinner size={13} className="text-muted-foreground" /> : <FileDown size={13} />}
            {t('bulkEdit.exportLabelPdfBtn')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting}
            title={t('bulkEdit.exportTitle')}
          >
            {exporting ? <Spinner size={13} className="text-muted-foreground" /> : <Download size={13} />}
            {t('bulkEdit.exportBtn')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            <X size={14} /> {t('common:actions.clearSelection')}
          </Button>
        </div>
      </div>

      {barcodeLabels && (
        <BarcodeLabelPrint labels={barcodeLabels.rows} size={barcodeLabels.size} onDone={() => setBarcodeLabels(null)} />
      )}

      {shippingLabels && <ShippingLabelPrint labels={shippingLabels} onDone={() => setShippingLabels(null)} />}

      <AssignDesignerDialog
        open={assignOpen}
        selectedIds={selectedIds}
        onClose={() => setAssignOpen(false)}
        onApplied={onApplied}
      />

      <Dialog
        open={priorityOpen}
        onOpenChange={(o) => (o ? setPriorityOpen(true) : (setPriorityValue(''), setPriorityOpen(false)))}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('bulkEdit.priorityDialogTitle', { count: selectedIds.length })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t('bulkEdit.priorityFieldLabel')}</label>
            <select
              value={priorityValue}
              onChange={(e) => setPriorityValue(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              autoFocus
            >
              <option value="">{t('bulkEdit.noPriorityOption')}</option>
              {ORDER_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {ORDER_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPriorityOpen(false)} disabled={applyingPriority}>
              {t('common:actions.close')}
            </Button>
            <Button onClick={submitPriority} disabled={applyingPriority}>
              {applyingPriority && <Spinner size={13} className="mr-1.5" />}
              {t('common:actions.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={holdOpen} onOpenChange={(o) => (o ? setHoldOpen(true) : (setHoldReason(''), setHoldOpen(false)))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('bulkEdit.holdDialogTitle', { count: selectedIds.length })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">{t('bulkEdit.holdReasonLabel')}</label>
            <div className="flex flex-wrap gap-1.5">
              {HOLD_REASON_PRESETS.map((preset) => {
                const active = holdReason === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setHoldReason(active ? '' : preset)}
                    className={cn(
                      'px-2.5 py-1 rounded-full border text-xs transition-colors',
                      active
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                    )}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value.slice(0, 200))}
              placeholder={t('bulkEdit.holdReasonPlaceholder')}
              rows={3}
              autoFocus
            />
            <p className="text-[11px] text-amber-600 dark:text-amber-400">{t('bulkEdit.holdWarning')}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHoldOpen(false)} disabled={holding}>
              {t('common:actions.close')}
            </Button>
            <Button onClick={() => submitHold(true, holdReason.trim() || undefined)} disabled={holding}>
              {holding && <Spinner size={13} className="mr-1.5" />}
              {t('bulkEdit.holdBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('bulkEdit.updateDialogTitle', { count: selectedIds.length })}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t('bulkEdit.fieldLabel')}</label>
              <select
                value={field}
                onChange={(e) => {
                  setField(e.target.value as OrderWorkshopField);
                  setValue('');
                  setFreeText('');
                }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('bulkEdit.chooseFieldPlaceholder')}</option>
                {editableFields.map((f) => (
                  <option key={f} value={f}>
                    {FIELD_LABEL[f]}
                  </option>
                ))}
              </select>
            </div>

            {field && category && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t('bulkEdit.newValueLabel')}</label>
                <select
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{t('bulkEdit.clearOption')}</option>
                  {options.map((it) => (
                    <option key={it._id} value={it.code}>
                      {it.name}
                    </option>
                  ))}
                </select>
                {value && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {(() => {
                      const opt = options.find((o) => o.code === value);
                      if (!opt) return null;
                      return (
                        <>
                          {opt.color ? (
                            <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: opt.color }} />
                          ) : (
                            <LucideIcon name={opt.icon} size={12} />
                          )}
                          <span>{opt.name}</span>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {field && !category && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium">{t('bulkEdit.newTextLabel')}</label>
                <input
                  type="text"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder={t('bulkEdit.notePlaceholder')}
                />
              </div>
            )}

            <p className="text-xs text-muted-foreground">{t('bulkEdit.auditNote')}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={!field || saving}>
              {saving && <Spinner size={13} className="mr-1.5" />}
              {t('common:actions.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
