import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactBarcode from 'react-barcode';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { Barcode as BarcodeIcon, Eye, EyeOff, FileDown, Plus, Printer, RotateCcw } from 'lucide-react';
import type { FulfillmentStage as FulfillmentStageT, StageErrorReworkTarget, WorkshopConfig } from 'shared';
import { FULFILLMENT_STAGE_ORDER, FULFILLMENT_STAGES, FulfillmentStage } from 'shared';
import { toast } from 'sonner';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';
import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { getStageLabel } from '@/utils/fulfillmentStageLabel';
import { errorScanPayload, SCAN_OK_CODE } from '@/utils/scanCodes';

import { usePermission } from '@/hooks/usePermission';

function targetLabel(target: StageErrorReworkTarget | undefined, t: TFunction<'stageErrorCatalog'>): string {
  if (!target) return t('targetNone');
  if (target === 'tool-check') return t('targetToolCheck');
  if (target === 'designer') return t('targetDesigner');
  return getStageLabel(t, target);
}

function targetOptionsFor(stage: FulfillmentStageT): StageErrorReworkTarget[] {
  const before = FULFILLMENT_STAGES.filter((s) => FULFILLMENT_STAGE_ORDER[s] < FULFILLMENT_STAGE_ORDER[stage]);
  return ['tool-check', 'designer', ...before];
}

// Kích thước trang nhãn A8 (52×74mm) — mỗi lỗi 1 trang trong PDF xuất ra.
const A8_MM = { w: 52, h: 74 };
const PX_PER_MM = 20; // vẽ label ở ~508dpi cho barcode nét

/** Id khối in tem lỗi — CSS in bên dưới nhận diện qua đúng id này. */
const LABEL_PRINT_ID = 'stage-error-label-print';

/**
 * Nút "In" ra tem decal **60×40mm** (CÙNG khổ tem nhỏ dán sản phẩm — máy in tem
 * ở trạm in được luôn, không cần máy A4), mỗi lỗi 1 tem + tem `OK` đầu tiên.
 * Cơ chế in mirror `BarcodeLabelPrint`: portal thẳng ra `document.body` +
 * `display: none` mọi anh chị em lúc in — tem trắng thừa là tem hỏng trên giấy
 * decal (KHÔNG dùng visibility trick: phần tử ẩn vẫn chiếm chỗ → lòi trang trắng).
 * Bề rộng module barcode cùng lý luận với khổ 60×40 của tem sản phẩm
 * (`BarcodeLabelPrint`): payload lỗi `E-se-<stage>-<n>` ≤ ~15 ký tự → 0.9px;
 * payload ngắn (`OK`) nới 2px cho vạch to dễ quét.
 */
const labelPrintCss = `
#${LABEL_PRINT_ID} { display: none; }
@media print {
  @page { size: 60mm 40mm; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#${LABEL_PRINT_ID}) { display: none !important; }
  #${LABEL_PRINT_ID} { display: block !important; }
  .se-label-page {
    width: 60mm; height: 40mm; box-sizing: border-box; padding: 2mm;
    display: flex; flex-direction: column; align-items: center; justify-content: space-between;
    overflow: hidden; background: #fff; color: #000;
    break-after: page; page-break-after: always;
  }
  .se-label-page:last-child { break-after: auto; page-break-after: auto; }
  .se-label-name {
    font-weight: 700; font-size: 9pt; line-height: 1.15; text-align: center;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .se-label-sub { font-size: 6.5pt; line-height: 1.2; text-align: center; color: #000; }
  .se-label-code { font-family: ui-monospace, monospace; }
}
`;

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export default function OrdersStageErrorsPage() {
  const { has, isAdmin } = usePermission();

  if (!isAdmin && !has('page.stage_errors')) {
    return <Navigate to={PATHS.ORDERS} replace />;
  }

  return <StageErrorsContent />;
}

function StageErrorsContent() {
  const { t } = useTranslation('stageErrorCatalog');
  // Công nhân Fulfillment → khóa vào công đoạn của mình; Admin/Manager → chọn tab.
  const profile = useAuthStore((s) => s.profile);
  const myStage = profile?.fulfillmentStage as FulfillmentStageT | undefined;

  const [stage, setStage] = useState<FulfillmentStageT>(myStage ?? FulfillmentStage.Press);
  const [rows, setRows] = useState<WorkshopConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form thêm mới
  const [name, setName] = useState('');
  const [target, setTarget] = useState<StageErrorReworkTarget | null>(null);

  // Chọn lỗi để In (tem 60×40, mỗi lỗi 1 tem) / Xuất PDF (A8 mỗi lỗi 1 trang).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const reloadStore = useWorkshopConfigStore((s) => s.load);

  const targets = useMemo(() => targetOptionsFor(stage), [stage]);

  const fetchRows = useCallback(async (s: FulfillmentStageT) => {
    setLoading(true);
    try {
      const res = await RepositoryRemote.workshopConfig.listStageErrors(s);
      setRows((res.data?.data || []) as WorkshopConfig[]);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows(stage);
    setTarget(null);
    setSelected(new Set());
  }, [stage, fetchRows]);

  const afterMutate = useCallback(() => {
    fetchRows(stage);
    // Store `production_error` dùng để resolve mã khi quét → refresh cho luồng quét.
    reloadStore(true);
  }, [fetchRows, stage, reloadStore]);

  const handleCreate = async () => {
    if (!name.trim() || !target || saving) return;
    setSaving(true);
    try {
      await RepositoryRemote.workshopConfig.createStageError({
        name: name.trim(),
        reworkTarget: target,
        stage: myStage ? undefined : stage,
      });
      toast.success(t('createSuccess'));
      setName('');
      setTarget(null);
      afterMutate();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (row: WorkshopConfig) => {
    if (saving || !row._id) return;
    setSaving(true);
    try {
      await RepositoryRemote.workshopConfig.updateStageError(row._id, { isActive: !row.isActive });
      toast.success(row.isActive ? t('hideSuccess') : t('showSuccess'));
      afterMutate();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  const selectedRows = useMemo(() => rows.filter((r) => r._id && selected.has(r._id)), [rows, selected]);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  const toggleSelect = (id?: string) => {
    if (!id) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r._id).filter(Boolean) as string[]));
  };

  /**
   * Vẽ 1 nhãn A8 (barcode Code128 + tiêu đề + phụ đề + mã) lên canvas rồi trả PNG dataURL —
   * nhét nguyên ảnh vào trang PDF để né vấn đề font tiếng Việt của jsPDF.
   * Barcode nguồn lấy từ canvas ẩn (react-barcode renderer="canvas") qua id wrapper.
   */
  const drawA8Label = (barWrapId: string, title: string, subtitle: string, code: string): string => {
    const W = A8_MM.w * PX_PER_MM;
    const H = A8_MM.h * PX_PER_MM;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    // Kéo giãn barcode full khổ ngang nhãn — giãn dọc/ngang đều không ảnh hưởng quét 1D.
    const barEl = document.getElementById(barWrapId)?.querySelector('canvas');
    const barW = W - 160;
    const barH = 480;
    const by = 150;
    if (barEl) ctx.drawImage(barEl, (W - barW) / 2, by, barW, barH);

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.font = 'bold 72px sans-serif';
    const lines = wrapCanvasText(ctx, title, W - 140).slice(0, 3);
    let ty = by + barH + 130;
    for (const line of lines) {
      ctx.fillText(line, W / 2, ty);
      ty += 86;
    }
    ctx.font = '52px sans-serif';
    ctx.fillStyle = '#333333';
    ctx.fillText(subtitle, W / 2, ty + 14);
    ctx.font = '44px monospace';
    ctx.fillStyle = '#555555';
    ctx.fillText(code, W / 2, ty + 84);
    return c.toDataURL('image/png');
  };

  const drawLabel = (row: WorkshopConfig): string =>
    drawA8Label(
      `bar-canvas-${row._id}`,
      row.name,
      t('labelPushTo', { target: targetLabel(row.reworkTarget as StageErrorReworkTarget, t) }),
      errorScanPayload(row),
    );

  // Nhãn "✔ HOÀN THÀNH" (SCAN_OK_CODE) — luôn là trang đầu PDF, giống card đầu sheet in.
  const drawOkLabel = (): string =>
    drawA8Label('bar-canvas-ok', t('okLabelTitle'), t('okLabelSubtitle'), SCAN_OK_CODE);

  const handleExportPdf = async () => {
    if (selectedRows.length === 0 || exporting) return;
    setExporting(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [A8_MM.w, A8_MM.h] });
      doc.addImage(drawOkLabel(), 'PNG', 0, 0, A8_MM.w, A8_MM.h);
      selectedRows.forEach((row) => {
        doc.addPage([A8_MM.w, A8_MM.h], 'portrait');
        doc.addImage(drawLabel(row), 'PNG', 0, 0, A8_MM.w, A8_MM.h);
      });
      doc.save(`barcode-loi-${stage}.pdf`);
      toast.success(t('exportSuccess', { count: selectedRows.length }));
    } catch (err) {
      toast.error(t('exportFailed', { message: (err as Error).message }));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="container mx-auto py-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-300">
            <BarcodeIcon size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.print()} disabled={selectedRows.length === 0}>
            <Printer size={15} className="mr-1.5" />
            {t('printBtn', { count: selectedRows.length })}
          </Button>
          <Button variant="outline" onClick={handleExportPdf} disabled={selectedRows.length === 0 || exporting}>
            {exporting ? <Spinner size={14} className="mr-1.5" /> : <FileDown size={15} className="mr-1.5" />}
            {t('exportPdfBtn', { count: selectedRows.length })}
          </Button>
        </div>
      </div>

      {/* Chọn công đoạn */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">{t('stageLabel')}</span>
        {myStage ? (
          <span className="inline-flex items-center rounded-md bg-primary/10 text-primary px-3 py-1.5 text-sm font-semibold">
            {getStageLabel(t, myStage)}
          </span>
        ) : (
          FULFILLMENT_STAGES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStage(s)}
              className={cn(
                'px-3 py-1.5 rounded-md border text-xs font-medium transition-colors',
                stage === s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground border-border hover:bg-accent',
              )}
            >
              {getStageLabel(t, s)}
            </button>
          ))
        )}
      </div>

      {/* Form thêm mới */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Plus size={15} className="text-primary" />
          {t('addForStage', { stage: getStageLabel(t, stage) })}
        </div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 120))}
          placeholder={t('namePlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
          }}
        />
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <RotateCcw size={12} /> {t('pushToLabel')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((tg) => (
              <TargetChip key={tg} active={target === tg} label={targetLabel(tg, t)} onClick={() => setTarget(tg)} />
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={!name.trim() || !target || saving}>
            {saving && <Spinner size={14} className="mr-2" />}
            {t('createBtn')}
          </Button>
        </div>
      </div>

      {/* List lỗi */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-3 border-b text-sm font-medium">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 accent-primary cursor-pointer"
              checked={allSelected}
              onChange={toggleSelectAll}
              disabled={rows.length === 0}
            />
            <span>
              {t('listTitle', { stage: getStageLabel(t, stage) })}{' '}
              <span className="text-muted-foreground font-normal">
                ({rows.length}
                {selected.size > 0 && t('selectedSuffix', { count: selected.size })})
              </span>
            </span>
          </label>
          {loading && <Spinner size={14} />}
        </div>
        {rows.length === 0 && !loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{t('empty')}</div>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row._id} className={cn('p-3 flex items-start gap-3', !row.isActive && 'opacity-50')}>
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-6 accent-primary cursor-pointer shrink-0"
                  checked={!!row._id && selected.has(row._id)}
                  onChange={() => toggleSelect(row._id)}
                />
                <div className="shrink-0 rounded-md border bg-white p-1.5">
                  <ReactBarcode value={errorScanPayload(row)} format="CODE128" width={1} height={40} displayValue={false} margin={4} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{row.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <code className="px-1 py-0.5 rounded bg-muted font-mono">{errorScanPayload(row)}</code>
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5">
                      <RotateCcw size={10} />{' '}
                      {t('pushToBadge', { target: targetLabel(row.reworkTarget as StageErrorReworkTarget, t) })}
                    </span>
                    {!row.isActive && <span className="text-rose-500">{t('hiddenBadge')}</span>}
                  </div>
                </div>
                {/* Đã thêm là KHÔNG sửa được (barcode đã in/đơn đã gán sẽ đổi nghĩa) — chỉ ẩn/hiện. */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => handleToggleActive(row)}
                  title={row.isActive ? t('hideTooltip') : t('showTooltip')}
                >
                  {row.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Canvas barcode ẩn (module 4px, cao 400px) — nguồn ảnh nét cho nhãn A8 khi xuất PDF.
          react-barcode không nhận prop id → bọc div id rồi querySelector('canvas'). */}
      <div className="hidden">
        <div id="bar-canvas-ok">
          <ReactBarcode renderer="canvas" value={SCAN_OK_CODE} format="CODE128" width={4} height={400} displayValue={false} margin={0} />
        </div>
        {rows.map((row) => (
          <div key={row._id} id={`bar-canvas-${row._id}`}>
            <ReactBarcode
              renderer="canvas"
              value={errorScanPayload(row)}
              format="CODE128"
              width={4}
              height={400}
              displayValue={false}
              margin={0}
            />
          </div>
        ))}
      </div>

      {/* In tem lỗi 60×40mm — mỗi lỗi 1 tem, tem OK đầu tiên (xem comment `labelPrintCss`). */}
      {createPortal(
        <div id={LABEL_PRINT_ID}>
          <style>{labelPrintCss}</style>
          <div className="se-label-page">
            <div className="se-label-name">{t('okLabelTitle')}</div>
            <ReactBarcode value={SCAN_OK_CODE} format="CODE128" width={2} height={48} displayValue={false} margin={0} />
            <div className="se-label-sub">
              {t('okLabelSubtitle')} · <span className="se-label-code">{SCAN_OK_CODE}</span>
            </div>
          </div>
          {selectedRows.map((row) => (
            <div key={row._id} className="se-label-page">
              <div className="se-label-name">{row.name}</div>
              <ReactBarcode value={errorScanPayload(row)} format="CODE128" width={0.9} height={48} displayValue={false} margin={0} />
              <div className="se-label-sub">
                {t('printCardPushTo', { target: targetLabel(row.reworkTarget as StageErrorReworkTarget, t) })}{' '}
                <span className="se-label-code">{errorScanPayload(row)}</span>
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function TargetChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-foreground border-border hover:bg-accent',
      )}
    >
      {label}
    </button>
  );
}
