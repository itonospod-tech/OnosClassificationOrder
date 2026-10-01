import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Clock,
  FileSearch,
  Image as ImageIcon,
  PackageSearch,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import type { OrderPriority, ToolCheckDayRow, ToolCheckErrorRow, ToolCheckFacet, ToolCheckOrder } from 'shared';
import { ORDER_PRIORITY_LABELS, PRODUCT_LEVEL_MAP, WorkshopConfigCategory } from 'shared';
import { toast } from 'sonner';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { CopyButton } from '@/components/common/CopyButton';
import { DateRangePicker } from '@/components/common/DateRangePicker';
import { Hint } from '@/components/common/Hint';
import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
// Bảng pipeline TOÀN nhà máy TẠM ẨN (2026-07, không cần nữa) — bật lại: bỏ
// comment import này + khối <PipelineDailyOverview/> bên dưới (cùng ghi chú).
// import { PipelineDailyOverview } from '@/components/common/PipelineDailyOverview';
import { SelectFilter } from '@/components/common/SelectFilter';
import { Spinner } from '@/components/common/Spinner';
import { ColorBadgeSelectCell } from '@/components/orders/cells/ColorBadgeSelectCell';
import { ImageThumbCell } from '@/components/orders/cells/ImageThumbCell';
import { MultiIconSelectCell } from '@/components/orders/cells/MultiIconSelectCell';
import { PriorityBadge } from '@/components/orders/cells/PrioritySelectCell';
import { ProductionErrorSelectCell } from '@/components/orders/cells/ProductionErrorSelectCell';
import { TextEditCell } from '@/components/orders/cells/TextEditCell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { DATE_PRESETS } from '@/utils/dateRangePresets';
import { smallThumb } from '@/utils/driveThumb';
import { formatCountdown, getStageDeadline } from '@/utils/priorityEstimate';

import { useNow } from '@/hooks/useNow';
import { usePermission } from '@/hooks/usePermission';

import { DesignerDrillPanel, type DrillTarget } from './DesignerDrillPanel';

interface Overview {
  checkedCount: number;
  errorCount: number;
  reworkList: ToolCheckOrder[];
  unreviewedList: ToolCheckOrder[];
  errorHistory: ToolCheckErrorRow[];
  days: ToolCheckDayRow[];
  columnTotals: {
    total: number;
    unreviewed: number;
    reviewed: number;
    reviewedError: number;
    reviewedOk: number;
    rework: number;
  };
  facets: {
    type: ToolCheckFacet[];
    customer: ToolCheckFacet[];
    machineNumber: ToolCheckFacet[];
    priority: ToolCheckFacet[];
  };
  rangeDays: number;
}

type ListTab = 'rework' | 'unreviewed';

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** ISO → ngày VN (YYYY-MM-DD) để lọc client-side theo cột ngày. */
function vnDay(iso?: string): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function fmtDayHead(day: string): { wd: string; dm: string } {
  const d = new Date(`${day}T12:00:00+07:00`);
  return {
    wd: WEEKDAYS[d.getDay()] ?? '',
    dm: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
  };
}

const toOpts = (f: ToolCheckFacet[] = []) => f.map((o) => ({ value: o.value, label: o.value, count: o.count }));
/** Facet `priority` trả value dạng '1'|'2'|'3' — map sang label tiếng Việt (dropdown "Ưu tiên"). */
const toPriorityOpts = (f: ToolCheckFacet[] = []) =>
  f.map((o) => ({
    value: o.value,
    label: ORDER_PRIORITY_LABELS[Number(o.value) as OrderPriority] || o.value,
    count: o.count,
  }));

/** Key định danh khách = userSku + userEmail (1 khách = cặp này). */
const custKey = (r: { userSku?: string; userEmail?: string }) => `${r.userSku ?? ''}|||${r.userEmail ?? ''}`;

export default function ToolCheckTab() {
  const { t } = useTranslation('toolCheckWorkflow');
  const { canEditField } = usePermission();
  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);
  const resolveConfig = useWorkshopConfigStore((s) => s.resolve);
  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  // Model từ/đến (thay cho `days` cũ) — mặc định 7 ngày gần nhất (khớp default cũ).
  const last7 = DATE_PRESETS.find((p) => p.key === 'last-7d')!.range();
  const [dateFrom, setDateFrom] = useState(() => last7.from);
  const [dateTo, setDateTo] = useState(() => last7.to);

  const [filterType, setFilterType] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterMachine, setFilterMachine] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  // Product line from the "Tool" menu (Tool 3D / Tool 2D–DTF, `?productLine=`) — a scope set by
  // the menu, read straight from the URL. Switching line keeps this tab mounted, so the facet
  // picks of the previous line (a product type that does not exist in the new one) are cleared.
  const [searchParams] = useSearchParams();
  const productLine = searchParams.get('productLine') || '';
  const prevProductLine = useRef(productLine);
  useEffect(() => {
    if (prevProductLine.current === productLine) return;
    prevProductLine.current = productLine;
    setFilterType('');
    setFilterCustomer('');
    setFilterMachine('');
    setFilterPriority('');
  }, [productLine]);
  // Ngày đang lọc (YYYY-MM-DD VN) — click 1 cột trong dải ngày; chỉ lọc DANH
  // SÁCH client-side, KPI/dải/thống kê giữ nguyên cả kỳ.
  const [dayFilter, setDayFilter] = useState('');
  // Drill-down: bấm 1 CON SỐ trong dải "Tổng quan theo ngày" → panel danh sách
  // đơn inline (có filter Designer/Khách) — mirror DesignerDailyOverview.
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  // Cross-filter nội bộ 3 ô thống kê lỗi (client-side, không refetch):
  // selCust = key `userSku|||userEmail`, selType = mã sản phẩm (`type`).
  const [selCust, setSelCust] = useState('');
  const [selType, setSelType] = useState('');
  // Loại lỗi (mã note) đang mở panel chi tiết (đơn + note lỗi).
  const [selCode, setSelCode] = useState('');
  // Mở rộng / ẩn bớt: 3 cột thống kê + bảng chi tiết loại lỗi.
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  // Modal "Xem theo từng khách hàng" (full-screen) + tập khách đang mở rộng.
  const [customerView, setCustomerView] = useState(false);
  const [expandedCust, setExpandedCust] = useState<Set<string>>(new Set());
  // Dialog chi tiết đơn lỗi của 1 khách (mở từ nút "Xem chi tiết") + lọc sản phẩm.
  const [custDetail, setCustDetail] = useState<{ key: string; userSku?: string; userEmail?: string } | null>(null);
  const [custDetailProduct, setCustDetailProduct] = useState('');
  const toggleCust = (k: string) =>
    setExpandedCust((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [listTab, setListTab] = useState<ListTab>('rework');
  // Đơn đang gọi action "Đã soát xong" (disable nút, tránh double-click).
  const [doneBusy, setDoneBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url?: string; originalUrl?: string; title?: string } | null>(null);
  const seqRef = useRef(0);
  const now = useNow(30_000);

  const fetchData = () => {
    const seq = ++seqRef.current;
    (async () => {
      try {
        setLoading(true);
        const res = await RepositoryRemote.designer.toolCheckOverview({
          from: dateFrom,
          to: dateTo,
          ...(filterType ? { type: filterType } : {}),
          ...(filterCustomer ? { customer: filterCustomer } : {}),
          ...(filterMachine ? { machineNumber: filterMachine } : {}),
          ...(filterPriority ? { priority: filterPriority } : {}),
          ...(productLine ? { productLine } : {}),
        });
        if (seq !== seqRef.current) return;
        setData((res.data?.data || null) as Overview | null);
      } catch (err) {
        if (seq === seqRef.current) handleAxiosError(err);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    })();
  };

  useEffect(() => {
    // Đổi kỳ/filter → bỏ ngày đang chọn + cross-filter thống kê + đóng drill
    // (query drill chụp filter cũ, giữ mở sẽ lệch với dải mới).
    setDayFilter('');
    setSelCust('');
    setSelType('');
    setSelCode('');
    setDrill(null);
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, filterType, filterCustomer, filterMachine, filterPriority, productLine]);

  // Patch 1 đơn trong cả 2 list (optimistic) sau khi edit cell.
  const patchRow = (id: string, partial: Partial<ToolCheckOrder>) =>
    setData((prev) =>
      prev
        ? {
            ...prev,
            reworkList: prev.reworkList.map((o) => (o._id === id ? { ...o, ...partial } : o)),
            unreviewedList: prev.unreviewedList.map((o) => (o._id === id ? { ...o, ...partial } : o)),
          }
        : prev,
    );

  // Action "Đã soát xong" (list "Cần làm lại") — đơn CẦN THIẾT KẾ: BE gỡ marker
  // hold rồi đẩy về designer cũ (rework) / auto-gán theo cấu hình xưởng /
  // backlog "Cần gán". Khác đường đổi Note kq Tool → 'ok' (= file ổn, về In).
  const markDone = async (o: ToolCheckOrder) => {
    try {
      setDoneBusy(o._id);
      const res = await RepositoryRemote.order.markToolCheckDone(o._id);
      const d = (res.data?.data || {}) as { outcome?: string; assigneeName?: string };
      if (d.outcome === 'designer-rework') {
        toast.success(
          t('list.markDoneToastRework', { id: o.productionId, name: d.assigneeName ? ` ${d.assigneeName}` : '' }),
        );
      } else if (d.outcome === 'auto-assigned') {
        toast.success(
          t('list.markDoneToastAuto', { id: o.productionId, name: d.assigneeName ? ` ${d.assigneeName}` : '' }),
        );
      } else {
        toast.info(t('list.markDoneToastNone', { id: o.productionId }));
      }
      fetchData();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setDoneBusy(null);
    }
  };

  // Full kỳ (cho KPI). Danh sách hiển thị lọc thêm theo ngày đang chọn.
  const reworkAll = data?.reworkList || [];
  const unreviewedAll = data?.unreviewedList || [];
  const applyDay = (list: ToolCheckOrder[]) =>
    dayFilter ? list.filter((o) => vnDay(o.inProductionAt) === dayFilter) : list;
  const reworkList = applyDay(reworkAll);
  const unreviewedList = applyDay(unreviewedAll);
  const activeList = listTab === 'rework' ? reworkList : unreviewedList;

  const toggleDay = (day: string) => setDayFilter((cur) => (cur === day ? '' : day));

  const canEditNote = canEditField('toolResultNote');
  const canEditErrFile = canEditField('errorFile');
  const canEditErrNote = canEditField('errorFileNote');
  const canEditProdErr = canEditField('productionError');

  // Render 1 dòng đơn — GIAO DIỆN MIRROR dòng "Danh sách đơn" (`ListOrderTab`):
  // mã đơn mono + CopyButton + ngày SX bên dưới → mockup 48px bg-checker →
  // sản phẩm đậm + dòng phụ size/màu → SKU khách. Các cell edit (Note kq Tool /
  // File sửa lỗi / Ghi chú file lỗi / Lỗi xưởng) giữ nguyên; đổi Note kq Tool /
  // Lỗi xưởng có thể đổi list → refetch.
  const renderRow = (o: ToolCheckOrder) => {
    const showCount = o.toolResultNote === 'error' && (o.productionErrorCount || 0) >= 2;
    const variantBits = [o.size, o.color].filter(Boolean);
    const mockupThumbSrc = smallThumb(o.mockupUrl, 200);
    return (
      <TableRow key={o._id}>
        {/* Mã đơn + ngày vào SX (VN) bên dưới */}
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <CopyButton value={o.productionId} label="Production ID" />
              <Hint content="Production ID">
                <span className="font-mono text-xs font-semibold text-foreground cursor-help">{o.productionId}</span>
              </Hint>
            </div>
            {o.inProductionAt && (
              <Hint content={`${t('list.columns.productionDate')}: ${vnDay(o.inProductionAt)}`}>
                <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1 cursor-help">
                  <span className="opacity-60">🏭</span>
                  {(() => {
                    const h = fmtDayHead(vnDay(o.inProductionAt));
                    return `${h.wd} ${h.dm}`;
                  })()}
                </span>
              </Hint>
            )}
          </div>
        </TableCell>

        {/* Mockup */}
        <TableCell>
          {o.mockupUrl ? (
            <Hint content={t('list.clickToViewFullImage')}>
              <button
                type="button"
                onClick={() =>
                  setPreview({
                    url: o.mockupUrl,
                    title: t('list.mockupTitle', { id: o.productionId }),
                    originalUrl: o.mockupOriginalUrl,
                  })
                }
                className="bg-transparent border-none p-0 cursor-pointer"
              >
                <img
                  src={mockupThumbSrc}
                  alt="mockup"
                  className="w-12 h-12 object-contain rounded border border-border bg-checker bg-checker-sm hover:ring-2 hover:ring-ring transition-all"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </button>
            </Hint>
          ) : (
            <div className="w-12 h-12 rounded border border-border bg-muted flex items-center justify-center text-muted-foreground">
              <ImageIcon size={16} />
            </div>
          )}
        </TableCell>

        {/* Sản phẩm + size/màu */}
        <TableCell className="max-w-[300px]">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 min-w-0">
              {o.type && <CopyButton value={o.type} label={t('list.columns.product')} />}
              <Hint content={o.type || t('list.columns.product')}>
                <span className="text-sm font-semibold text-foreground truncate cursor-help min-w-0">
                  {o.type || '—'}
                </span>
              </Hint>
            </div>
            {variantBits.length > 0 && (
              <Hint content={t('list.columns.sizeColor')}>
                <span className="text-[11px] text-muted-foreground cursor-help">{variantBits.join(' / ')}</span>
              </Hint>
            )}
          </div>
        </TableCell>

        {/* Khách (SKU) */}
        <TableCell>
          {o.userSku ? (
            <div className="flex items-center gap-1">
              <CopyButton value={o.userSku} label="SKU" iconSize={10} />
              <Hint content={t('list.columns.customer')}>
                <span className="text-xs font-medium cursor-help">{o.userSku}</span>
              </Hint>
            </div>
          ) : (
            <span className="text-xs font-medium">—</span>
          )}
        </TableCell>

        {/* Note kq Tool 1 — edit → 'ok' đẩy đơn về In (đổi list → refetch). */}
        <TableCell>
          <span className="inline-flex items-center gap-1.5">
            <ColorBadgeSelectCell
              orderId={o._id}
              field="toolResultNote"
              category={WorkshopConfigCategory.ToolResultNote}
              value={o.toolResultNote}
              canEdit={canEditNote}
              onUpdated={(v) => {
                patchRow(o._id, { toolResultNote: v ?? undefined });
                fetchData();
              }}
            />
            {showCount && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                title={t('list.errorReportedTimes', { count: o.productionErrorCount })}
              >
                ×{o.productionErrorCount}
              </span>
            )}
          </span>
        </TableCell>
        {/* File sửa lỗi */}
        <TableCell>
          <MultiIconSelectCell
            orderId={o._id}
            field="errorFile"
            category={WorkshopConfigCategory.ErrorFileType}
            value={o.errorFile}
            canEdit={canEditErrFile}
            maxVisible={2}
            onUpdated={(v) => patchRow(o._id, { errorFile: v ?? undefined })}
          />
        </TableCell>
        {/* Ghi chú file lỗi */}
        <TableCell className="min-w-[150px]">
          <TextEditCell
            orderId={o._id}
            field="errorFileNote"
            value={o.errorFileNote}
            canEdit={canEditErrNote}
            onUpdated={(v) => patchRow(o._id, { errorFileNote: v ?? undefined })}
            tooltipLabel={t('list.columns.errorFileNote')}
          />
        </TableCell>
        {/* Lỗi xưởng */}
        <TableCell>
          <ProductionErrorSelectCell
            orderId={o._id}
            category={WorkshopConfigCategory.ProductionError}
            value={o.productionError}
            errorNoteValue={o.productionErrorNote}
            canEdit={canEditProdErr}
            onUpdated={(code) => {
              patchRow(o._id, { productionError: code ?? undefined });
              fetchData();
            }}
          />
        </TableCell>
        {/* Ưu tiên + hạn dự kiến (mốc vào bước = `inProductionAt`, cả 2 list
          đều đang chờ bước "tool-check"). */}
        <TableCell>
          {(() => {
            const deadline = getStageDeadline(o.priority, 'tool-check', o.inProductionAt);
            const countdown = deadline ? formatCountdown(deadline, now, t) : undefined;
            return (
              <div className="flex flex-col gap-1 items-start">
                <PriorityBadge priority={o.priority} />
                {deadline && countdown && (
                  <span
                    className={cn(
                      'text-[10px] inline-flex items-center gap-1 whitespace-nowrap',
                      countdown.overdue ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
                    )}
                  >
                    <Clock size={10} /> {countdown.text}
                  </span>
                )}
              </div>
            );
          })()}
        </TableCell>
        {/* Action "Đã soát xong" — chỉ list "Cần làm lại" (đơn hold In trả về);
          pin cố định BÊN PHẢI như cột thao tác của Danh sách đơn. */}
        {listTab === 'rework' && (
          <TableCell className="sticky right-0 z-10 bg-card shadow-[-1px_0_0_0_var(--border)]">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[11px] whitespace-nowrap border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-500/40 dark:hover:bg-emerald-500/10"
              disabled={!canEditNote || doneBusy === o._id}
              onClick={() => markDone(o)}
            >
              <ClipboardCheck size={13} />
              {t('list.markDoneButton')}
            </Button>
          </TableCell>
        )}
      </TableRow>
    );
  };

  const kpis = useMemo(
    () => [
      { key: 'checked', label: t('kpi.checked'), value: data?.checkedCount ?? 0, cls: 'text-foreground' },
      {
        key: 'rework',
        label: t('kpi.rework'),
        value: reworkAll.length,
        cls: 'text-amber-600 dark:text-amber-400',
      },
      {
        key: 'unreviewed',
        label: t('kpi.unreviewed'),
        value: unreviewedAll.length,
        cls: 'text-slate-600 dark:text-slate-400',
      },
      {
        key: 'error',
        label: t('kpi.error'),
        value: data?.errorCount ?? 0,
        cls: 'text-rose-600 dark:text-rose-400',
      },
    ],
    [data, reworkAll.length, unreviewedAll.length, t],
  );

  const days = useMemo(() => [...(data?.days || [])].reverse(), [data]);

  // ── Hàng "Note không ok" (lịch sử soát lỗi) tách dòng con theo MÃ MỚI NHẤT
  // của đơn (`errorByNote` từ BE). Dòng con ĐỘNG: mọi mã có đơn trong kỳ, 3 mã
  // chính (Lỗi / Không có file PDF / Không có tool) ghim lên đầu, mã admin
  // thêm sau tự xuất hiện; label tra từ workshop_config tool_result_note. ──
  const noteLabel = (code: string) => resolveConfig(WorkshopConfigCategory.ToolResultNote, code)?.name || code;
  const noteTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) for (const n of d.errorByNote) m.set(n.code, (m.get(n.code) || 0) + n.count);
    return m;
  }, [days]);
  const noteCodes = useMemo(() => {
    const rest = [...noteTotals.keys()].filter((c) => !PINNED_NOTE_CODES.includes(c));
    rest.sort((a, b) => (noteTotals.get(b) || 0) - (noteTotals.get(a) || 0));
    return [...PINNED_NOTE_CODES.filter((c) => noteTotals.has(c)), ...rest];
  }, [noteTotals]);
  const pickNote = (d: ToolCheckDayRow, code: string) => d.errorByNote.find((n) => n.code === code)?.count ?? 0;

  // ── Drill dải "Tổng quan theo ngày" — query cho GET /orders/overview-list
  // (mirror openMetric của DesignerDailyOverview; createdFrom/To lọc theo
  // inProductionAt VN, cùng trục với cột ngày). Mang theo 4 filter tab.
  type StripMetric = 'total' | 'unreviewed' | 'reviewed' | 'reviewedError' | 'reviewedOk' | 'rework';
  const STRIP_METRIC_LABEL: Record<StripMetric, string> = {
    total: t('dailyStrip.metrics.total'),
    unreviewed: t('dailyStrip.metrics.unreviewed'),
    reviewed: t('dailyStrip.metrics.reviewed'),
    reviewedError: t('dailyStrip.metrics.noteNotOk'),
    reviewedOk: t('dailyStrip.metrics.reviewedOk'),
    rework: t('dailyStrip.metrics.rework'),
  };
  const openStripDrill = (metric: StripMetric, fromDay?: string, toDay?: string, dayLabel?: string) => {
    const sp = new URLSearchParams();
    if (fromDay) sp.set('createdFrom', fromDay);
    if (toDay) sp.set('createdTo', toDay);
    if (filterType) sp.set('type', filterType);
    if (filterCustomer) sp.set('userSku', filterCustomer);
    if (filterMachine) sp.set('machineNumber', filterMachine);
    if (filterPriority) sp.set('priority', filterPriority);
    sp.set('sort', 'grouped');
    if (metric === 'unreviewed') sp.set('toolResultNote', '__none__');
    else if (metric === 'reviewed') sp.set('toolResultNote', '__any__');
    else if (metric === 'reviewedError') {
      // Lịch sử "từng soát ra lỗi" (không teo khi đơn sửa xong) — khớp aggregation.
      sp.set('toolCheckedError', '1');
    } else if (metric === 'reviewedOk') {
      // Đã soát & chưa từng lỗi = soát ok ngay.
      sp.set('toolCheckedError', '0');
      sp.set('toolResultNote', '__any__');
    } else if (metric === 'rework') {
      // "Cần làm lại" = In trả về do soát tool (source=tool-check + note='error').
      sp.set('errorSource', 'tool-check');
      sp.set('toolResultNote', 'error');
    }
    setDrill({
      title: (
        <>
          {t('header.title')} · {STRIP_METRIC_LABEL[metric]}
          {dayLabel ? ` · ${dayLabel}` : ` · ${t('dailyStrip.dayLabelAll')}`}
        </>
      ),
      query: sp.toString(),
    });
  };

  // Drill 1 mã lỗi soát tool (dòng con / dòng tooltip breakdown) — lọc theo MÃ
  // MỚI NHẤT của đơn (`toolErrorNote`, khớp aggregation errorByNote).
  const openNoteDrill = (code: string, fromDay?: string, toDay?: string, dayLabel?: string) => {
    const sp = new URLSearchParams();
    if (fromDay) sp.set('createdFrom', fromDay);
    if (toDay) sp.set('createdTo', toDay);
    if (filterType) sp.set('type', filterType);
    if (filterCustomer) sp.set('userSku', filterCustomer);
    if (filterMachine) sp.set('machineNumber', filterMachine);
    if (filterPriority) sp.set('priority', filterPriority);
    sp.set('sort', 'grouped');
    sp.set('toolErrorNote', code);
    setDrill({
      title: (
        <>
          {t('header.title')} · {t('dailyStrip.metrics.noteNotOk')} · {noteLabel(code)}
          {dayLabel ? ` · ${dayLabel}` : ` · ${t('dailyStrip.dayLabelAll')}`}
        </>
      ),
      query: sp.toString(),
    });
  };

  // Tooltip breakdown cho hàng "Note không ok" (per-ngày + cột Tổng) — từng
  // dòng bấm được để drill đúng mã lỗi đó.
  const noteBreakdownFor = (d: ToolCheckDayRow): BreakdownLine[] =>
    d.errorByNote.map((n) => ({
      label: noteLabel(n.code),
      count: n.count,
      onClick: () => openNoteDrill(n.code, d.day, d.day, fmtDayHead(d.day).dm),
    }));
  const noteTotalBreakdown: BreakdownLine[] = noteCodes.map((code) => ({
    label: noteLabel(code),
    count: noteTotals.get(code) || 0,
    onClick: () => openNoteDrill(code, dateFrom, dateTo),
  }));

  // 3 ô thống kê lỗi Soát tool (lịch sử, kể cả đơn đã sửa). Đếm ĐƠN riêng biệt
  // (dedup theo orderId). Cross-filter: chọn Khách → lọc Sản phẩm + Loại lỗi;
  // chọn Sản phẩm → lọc Khách + Loại lỗi.
  const stats = useMemo(() => {
    const rows = data?.errorHistory ?? [];
    const byCust = (r: ToolCheckErrorRow) => !selCust || custKey(r) === selCust;
    const byType = (r: ToolCheckErrorRow) => !selType || (r.type ?? '') === selType;

    const custMap = new Map<string, { userSku?: string; userEmail?: string; orders: Set<string> }>();
    const prodMap = new Map<
      string,
      { type?: string; fullName?: string; mockup?: string; level?: number; orders: Set<string> }
    >();
    const errMap = new Map<string, { code: string; label?: string; orders: Set<string> }>();

    for (const r of rows) {
      if (byType(r)) {
        const k = custKey(r);
        let g = custMap.get(k);
        if (!g) custMap.set(k, (g = { userSku: r.userSku, userEmail: r.userEmail, orders: new Set() }));
        g.orders.add(r.orderId);
      }
      if (byCust(r)) {
        const k = r.type ?? '';
        let g = prodMap.get(k);
        if (!g)
          prodMap.set(
            k,
            (g = { type: r.type, fullName: r.fullName, mockup: r.mockup, level: r.level, orders: new Set() }),
          );
        g.orders.add(r.orderId);
      }
      if (byCust(r) && byType(r)) {
        const k = r.code || '';
        let g = errMap.get(k);
        if (!g) errMap.set(k, (g = { code: r.code, label: r.codeLabel, orders: new Set() }));
        g.orders.add(r.orderId);
      }
    }

    return {
      byCustomer: [...custMap.entries()]
        .map(([key, g]) => ({ key, userSku: g.userSku, userEmail: g.userEmail, count: g.orders.size }))
        .sort((a, b) => b.count - a.count),
      byProduct: [...prodMap.entries()]
        .map(([key, g]) => ({
          key,
          type: g.type,
          fullName: g.fullName,
          mockup: g.mockup,
          level: g.level,
          count: g.orders.size,
        }))
        .sort((a, b) => b.count - a.count),
      byError: [...errMap.values()]
        .map((g) => ({ code: g.code, label: g.label, count: g.orders.size }))
        .sort((a, b) => b.count - a.count),
    };
  }, [data?.errorHistory, selCust, selType]);

  // Panel chi tiết 1 loại lỗi (selCode): các ĐƠN dính note đó (dedup theo
  // orderId) + sản phẩm + note lỗi, tôn trọng cross-filter khách/sản phẩm.
  const codeDetail = useMemo(() => {
    type DetailItem = {
      orderId: string;
      productionId?: string;
      product: string;
      note?: string;
      errorFile?: string[];
      mockup?: string;
      level?: number;
      mockupUrl?: string;
      mockupOriginalUrl?: string;
      size?: string;
      color?: string;
    };
    if (!selCode) return { label: '', items: [] as DetailItem[] };
    const rows = data?.errorHistory ?? [];
    const seen = new Set<string>();
    let label = selCode;
    const items: DetailItem[] = [];
    for (const r of rows) {
      if ((r.code || '') !== selCode) continue;
      if (selCust && custKey(r) !== selCust) continue;
      if (selType && (r.type ?? '') !== selType) continue;
      if (r.codeLabel) label = r.codeLabel;
      if (seen.has(r.orderId)) continue;
      seen.add(r.orderId);
      items.push({
        orderId: r.orderId,
        productionId: r.productionId,
        product: r.fullName || r.type || t('errorStats.unknown'),
        note: r.note,
        errorFile: r.errorFile,
        mockup: r.mockup,
        level: r.level ?? undefined,
        mockupUrl: r.mockupUrl,
        mockupOriginalUrl: r.mockupOriginalUrl,
        size: r.size,
        color: r.color,
      });
    }

    // Sắp xếp: nhóm sản phẩm giống tên đứng cạnh nhau (nhóm nhiều đơn lên đầu);
    // trong mỗi sản phẩm, nhóm File lỗi giống nhau đứng cạnh nhau (nhiều lên đầu).
    const efKeyOf = (it: DetailItem) => (it.errorFile && it.errorFile.length ? [...it.errorFile].sort().join('|') : '');
    const prodCount = new Map<string, number>();
    const efCountByProd = new Map<string, Map<string, number>>();
    for (const it of items) {
      prodCount.set(it.product, (prodCount.get(it.product) ?? 0) + 1);
      const m = efCountByProd.get(it.product) ?? new Map<string, number>();
      const ek = efKeyOf(it);
      m.set(ek, (m.get(ek) ?? 0) + 1);
      efCountByProd.set(it.product, m);
    }
    items.sort((a, b) => {
      const pc = (prodCount.get(b.product) ?? 0) - (prodCount.get(a.product) ?? 0);
      if (pc) return pc;
      const pn = a.product.localeCompare(b.product);
      if (pn) return pn;
      const ak = efKeyOf(a);
      const bk = efKeyOf(b);
      const ec = (efCountByProd.get(b.product)?.get(bk) ?? 0) - (efCountByProd.get(a.product)?.get(ak) ?? 0);
      if (ec) return ec;
      return ak.localeCompare(bk);
    });

    return { label: label || t('errorStats.unknown'), items };
  }, [data?.errorHistory, selCode, selCust, selType, t]);

  // Chế độ "xem theo từng khách hàng": mỗi khách → sản phẩm lỗi + loại lỗi
  // (đếm đơn riêng biệt), sort nhiều→ít. KHÔNG áp cross-filter (hiện mọi khách).
  const perCustomer = useMemo(() => {
    const rows = data?.errorHistory ?? [];
    type Grp = {
      key: string;
      userSku?: string;
      userEmail?: string;
      orders: Set<string>;
      products: Map<string, { product: string; mockup?: string; level?: number; orders: Set<string> }>;
      codes: Map<string, { code: string; label?: string; orders: Set<string> }>;
    };
    const map = new Map<string, Grp>();
    for (const r of rows) {
      const k = custKey(r);
      let g = map.get(k);
      if (!g) {
        g = {
          key: k,
          userSku: r.userSku,
          userEmail: r.userEmail,
          orders: new Set(),
          products: new Map(),
          codes: new Map(),
        };
        map.set(k, g);
      }
      g.orders.add(r.orderId);
      const pk = r.type ?? '';
      let p = g.products.get(pk);
      if (!p) {
        p = {
          product: r.fullName || r.type || t('errorStats.unknown'),
          mockup: r.mockup,
          level: r.level ?? undefined,
          orders: new Set(),
        };
        g.products.set(pk, p);
      }
      p.orders.add(r.orderId);
      const ck = r.code || '';
      let c = g.codes.get(ck);
      if (!c) {
        c = { code: r.code, label: r.codeLabel, orders: new Set() };
        g.codes.set(ck, c);
      }
      c.orders.add(r.orderId);
    }
    return [...map.values()]
      .map((g) => ({
        key: g.key,
        userSku: g.userSku,
        userEmail: g.userEmail,
        count: g.orders.size,
        products: [...g.products.values()]
          .map((p) => ({ product: p.product, mockup: p.mockup, level: p.level, count: p.orders.size }))
          .sort((a, b) => b.count - a.count),
        codes: [...g.codes.values()]
          .map((c) => ({ code: c.code, label: c.label, count: c.orders.size }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count);
  }, [data?.errorHistory, t]);

  // Chi tiết đơn lỗi của 1 khách: dedup theo orderId, gộp loại lỗi; lọc theo sản
  // phẩm. Sort: sản phẩm giống nhau cạnh nhau (nhóm nhiều→ít) → theo loại lỗi
  // (nhiều→ít) → theo file lỗi.
  const custDetailData = useMemo(() => {
    if (!custDetail) return null;
    type ODItem = {
      orderId: string;
      productionId?: string;
      typeKey: string;
      product: string;
      mockup?: string;
      level?: number;
      mockupUrl?: string;
      mockupOriginalUrl?: string;
      size?: string;
      color?: string;
      errorFile?: string[];
      note?: string;
      codes: Map<string, string | undefined>;
    };
    const rows = (data?.errorHistory ?? []).filter((r) => custKey(r) === custDetail.key);
    const orderMap = new Map<string, ODItem>();
    const productOrders = new Map<string, { label: string; orders: Set<string> }>();
    for (const r of rows) {
      const pk = r.type ?? '';
      const label = r.fullName || r.type || t('errorStats.unknown');
      let po = productOrders.get(pk);
      if (!po) productOrders.set(pk, (po = { label, orders: new Set() }));
      po.orders.add(r.orderId);
      let it = orderMap.get(r.orderId);
      if (!it) {
        it = {
          orderId: r.orderId,
          productionId: r.productionId,
          typeKey: pk,
          product: label,
          mockup: r.mockup,
          level: r.level ?? undefined,
          mockupUrl: r.mockupUrl,
          mockupOriginalUrl: r.mockupOriginalUrl,
          size: r.size,
          color: r.color,
          errorFile: r.errorFile,
          note: r.note,
          codes: new Map(),
        };
        orderMap.set(r.orderId, it);
      }
      it.codes.set(r.code || '', r.codeLabel);
    }
    const allOrders = [...orderMap.values()];
    const productOptions = [...productOrders.entries()]
      .map(([value, g]) => ({ value, label: g.label, count: g.orders.size }))
      .sort((a, b) => b.count - a.count);

    const orders = custDetailProduct ? allOrders.filter((o) => o.typeKey === custDetailProduct) : allOrders;

    // Đếm để sort (trên tập đã lọc).
    const codeKeyOf = (o: ODItem) => [...o.codes.keys()].sort().join('|');
    const efKeyOf = (o: ODItem) => (o.errorFile && o.errorFile.length ? [...o.errorFile].sort().join('|') : '');
    const prodCount = new Map<string, number>();
    const codeCountByProd = new Map<string, Map<string, number>>();
    for (const o of orders) {
      prodCount.set(o.typeKey, (prodCount.get(o.typeKey) ?? 0) + 1);
      const m = codeCountByProd.get(o.typeKey) ?? new Map<string, number>();
      const ck = codeKeyOf(o);
      m.set(ck, (m.get(ck) ?? 0) + 1);
      codeCountByProd.set(o.typeKey, m);
    }
    orders.sort((a, b) => {
      const pc = (prodCount.get(b.typeKey) ?? 0) - (prodCount.get(a.typeKey) ?? 0);
      if (pc) return pc;
      const pn = a.product.localeCompare(b.product);
      if (pn) return pn;
      const ak = codeKeyOf(a);
      const bk = codeKeyOf(b);
      const cc = (codeCountByProd.get(b.typeKey)?.get(bk) ?? 0) - (codeCountByProd.get(a.typeKey)?.get(ak) ?? 0);
      if (cc) return cc;
      const ck = ak.localeCompare(bk);
      if (ck) return ck;
      return efKeyOf(a).localeCompare(efKeyOf(b));
    });

    return {
      userSku: custDetail.userSku,
      userEmail: custDetail.userEmail,
      totalOrders: allOrders.length,
      totalProducts: productOrders.size,
      productOptions,
      orders,
    };
  }, [custDetail, custDetailProduct, data?.errorHistory, t]);

  const allCustExpanded = perCustomer.length > 0 && perCustomer.every((c) => expandedCust.has(c.key));

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        {/* Filter bar (thời gian) */}
        <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-2 flex-wrap">
          <FileSearch size={16} className="text-indigo-600" />
          <span className="text-sm font-semibold">{t('header.title')}</span>
          <span className="hidden md:inline text-[11px] text-muted-foreground">— {t('header.subtitle')}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchData} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          <DateRangePicker
            variant="inline"
            from={dateFrom}
            to={dateTo}
            onChange={(f, t2) => {
              setDateFrom(f);
              setDateTo(t2);
            }}
          />
          {/* Hàng filter: Sản phẩm / Khách / Máy / Ưu tiên — options từ facet BE (cả kỳ). */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <SelectFilter
              label={t('filters.product')}
              value={filterType}
              onChange={setFilterType}
              options={toOpts(data?.facets.type)}
            />
            <SelectFilter
              label={t('filters.customer')}
              value={filterCustomer}
              onChange={setFilterCustomer}
              options={toOpts(data?.facets.customer)}
            />
            <SelectFilter
              label={t('filters.machine')}
              value={filterMachine}
              onChange={setFilterMachine}
              options={toOpts(data?.facets.machineNumber)}
            />
            <SelectFilter
              label={t('filters.priority')}
              value={filterPriority}
              onChange={setFilterPriority}
              options={toPriorityOpts(data?.facets.priority)}
            />
          </div>
        </div>

        {/* Dải tổng quan theo ngày (ăn theo filter tab) — Tổng đơn / Chưa soát /
          Đã soát / Soát lỗi / Soát OK / Cần làm lại. Click NỀN Ô hoặc header 1
          ngày → lọc danh sách bên dưới (client-side); click CON SỐ → panel
          drill danh sách đơn (filter Designer/Khách). */}
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold">{t('dailyStrip.title')}</span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground">— {t('dailyStrip.subtitle')}</span>
            {dayFilter && (
              <button
                type="button"
                onClick={() => setDayFilter('')}
                className="ml-auto inline-flex items-center gap-1 text-[11px] rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2 py-0.5"
              >
                {t('dailyStrip.filtering', { date: fmtDayHead(dayFilter).dm })}
                <X size={11} />
              </button>
            )}
          </div>
          {days.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">{t('dailyStrip.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] tabular-nums border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 bg-card text-left font-medium px-3 py-2 border-b border-border min-w-[110px]">
                      {t('dailyStrip.metricColumn')}
                    </th>
                    {days.map((d) => {
                      const { wd, dm } = fmtDayHead(d.day);
                      const active = dayFilter === d.day;
                      return (
                        <th
                          key={d.day}
                          onClick={() => toggleDay(d.day)}
                          className={`font-medium px-1.5 py-1.5 border-b border-l border-border text-center min-w-[58px] cursor-pointer transition-colors ${
                            active ? 'bg-indigo-100 dark:bg-indigo-500/25' : 'bg-card hover:bg-muted/60'
                          }`}
                        >
                          <div className="text-[11px] text-muted-foreground leading-tight">{wd}</div>
                          <div className="leading-tight font-semibold">{dm}</div>
                        </th>
                      );
                    })}
                    <th className="bg-muted/30 font-semibold px-2 py-1.5 border-b border-l border-border text-center min-w-[58px]">
                      {t('dailyStrip.totalColumn')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      {
                        metric: 'total',
                        label: t('dailyStrip.metrics.total'),
                        cls: 'text-foreground',
                        pick: (d: ToolCheckDayRow) => d.total,
                      },
                      {
                        metric: 'unreviewed',
                        label: t('dailyStrip.metrics.unreviewed'),
                        cls: 'text-amber-600',
                        pick: (d: ToolCheckDayRow) => d.unreviewed,
                      },
                      {
                        metric: 'reviewed',
                        label: t('dailyStrip.metrics.reviewed'),
                        cls: 'text-slate-600 dark:text-slate-300',
                        pick: (d: ToolCheckDayRow) => d.reviewed,
                      },
                    ] as const
                  ).map((row) => (
                    <DayMetricRow
                      key={row.metric}
                      label={row.label}
                      cls={row.cls}
                      days={days}
                      dayFilter={dayFilter}
                      pick={row.pick}
                      total={data?.columnTotals[row.metric] ?? 0}
                      onPick={toggleDay}
                      onDrill={(day) => openStripDrill(row.metric, day, day, fmtDayHead(day).dm)}
                      onDrillTotal={() => openStripDrill(row.metric, dateFrom, dateTo)}
                    />
                  ))}
                  {/* Hàng "Note không ok" (= "Soát lỗi" cũ, lịch sử) — hover con
                    số hiện breakdown theo mã (bấm từng dòng để drill). */}
                  <DayMetricRow
                    label={t('dailyStrip.metrics.noteNotOk')}
                    cls="text-red-600 dark:text-red-400"
                    days={days}
                    dayFilter={dayFilter}
                    pick={(d) => d.reviewedError}
                    total={data?.columnTotals.reviewedError ?? 0}
                    onPick={toggleDay}
                    onDrill={(day) => openStripDrill('reviewedError', day, day, fmtDayHead(day).dm)}
                    onDrillTotal={() => openStripDrill('reviewedError', dateFrom, dateTo)}
                    breakdownFor={noteBreakdownFor}
                    totalBreakdown={noteTotalBreakdown}
                  />
                  {/* Dòng con động theo mã note ≠ ok — dòng "Soát lỗi" (error)
                    tô nền theo % so với tổng đơn: <8% xanh · 8–15% vàng · ≥15% đỏ. */}
                  {noteCodes.map((code) => (
                    <DayMetricRow
                      key={`note-${code}`}
                      indent
                      label={noteLabel(code)}
                      labelHint={code === 'error' ? t('dailyStrip.errorPctHint') : undefined}
                      cls="text-red-600/90 dark:text-red-400/90"
                      days={days}
                      dayFilter={dayFilter}
                      pick={(d) => pickNote(d, code)}
                      total={noteTotals.get(code) || 0}
                      onPick={toggleDay}
                      onDrill={(day) => openNoteDrill(code, day, day, fmtDayHead(day).dm)}
                      onDrillTotal={() => openNoteDrill(code, dateFrom, dateTo)}
                      cellBg={code === 'error' ? (d, v) => pctBg(v, d.total) : undefined}
                      totalBg={
                        code === 'error'
                          ? pctBg(noteTotals.get('error') || 0, data?.columnTotals.total || 0)
                          : undefined
                      }
                      pctBase={code === 'error' ? (d) => d.total : undefined}
                      totalPctBase={code === 'error' ? data?.columnTotals.total || 0 : undefined}
                    />
                  ))}
                  {(
                    [
                      {
                        metric: 'reviewedOk',
                        label: t('dailyStrip.metrics.reviewedOk'),
                        cls: 'text-emerald-600 dark:text-emerald-400',
                        pick: (d: ToolCheckDayRow) => d.reviewedOk,
                      },
                      {
                        metric: 'rework',
                        label: t('dailyStrip.metrics.rework'),
                        cls: 'text-orange-600 dark:text-orange-400',
                        pick: (d: ToolCheckDayRow) => d.rework,
                      },
                    ] as const
                  ).map((row) => (
                    <DayMetricRow
                      key={row.metric}
                      label={row.label}
                      cls={row.cls}
                      days={days}
                      dayFilter={dayFilter}
                      pick={row.pick}
                      total={data?.columnTotals[row.metric] ?? 0}
                      onPick={toggleDay}
                      onDrill={(day) => openStripDrill(row.metric, day, day, fmtDayHead(day).dm)}
                      onDrillTotal={() => openStripDrill(row.metric, dateFrom, dateTo)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bảng pipeline TOÀN nhà máy TẠM ẨN (2026-07, không cần nữa) — bật
          lại: bỏ comment khối này + import PipelineDailyOverview ở đầu file.
        <PipelineDailyOverview
          lane="tool"
          from={dateFrom}
          to={dateTo}
          dayFilter={dayFilter || undefined}
          onPickDay={toggleDay}
          caption={t('pipelineCaption')}
        /> */}

        {/* Panel drill-down inline — bấm con số trên dải → danh sách đơn gom
          nhóm sản phẩm + filter Designer/Khách (dùng chung DesignerDailyOverview). */}
        <DesignerDrillPanel target={drill} onClose={() => setDrill(null)} />

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <div key={k.key} className="rounded-lg border border-border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.label}</div>
              <div className={`text-2xl font-bold tabular-nums ${k.cls}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Danh sách: 2 nhóm (làm cái nào trước) */}
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
            <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setListTab('rework')}
                className={`px-3 py-1.5 font-medium ${
                  listTab === 'rework'
                    ? 'bg-amber-500 text-white'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {t('list.reworkTab', { count: reworkList.length })}
              </button>
              <button
                type="button"
                onClick={() => setListTab('unreviewed')}
                className={`px-3 py-1.5 font-medium ${
                  listTab === 'unreviewed'
                    ? 'bg-slate-600 text-white'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {t('list.unreviewedTab', { count: unreviewedList.length })}
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {listTab === 'rework' ? t('list.reworkHint') : t('list.unreviewedHint')}
            </span>
          </div>

          {loading && !data ? (
            <div className="py-10 text-center">
              <Spinner size={20} className="text-muted-foreground" />
            </div>
          ) : activeList.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">
              {listTab === 'rework' ? t('list.noReworkOrders') : t('list.noUnreviewedOrders')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[140px]">{t('list.columns.orderCode')}</TableHead>
                  <TableHead className="w-16">{t('list.columns.mockup')}</TableHead>
                  <TableHead className="min-w-[200px]">{t('list.columns.product')}</TableHead>
                  <TableHead>{t('list.columns.customer')}</TableHead>
                  <TableHead>{t('list.columns.toolNote')}</TableHead>
                  <TableHead>{t('list.columns.errorFile')}</TableHead>
                  <TableHead>{t('list.columns.errorFileNote')}</TableHead>
                  <TableHead>{t('list.columns.factoryError')}</TableHead>
                  <TableHead>{t('list.columns.priority')}</TableHead>
                  {listTab === 'rework' && <TableHead className="w-24 sticky right-0 z-20 bg-card" />}
                </TableRow>
              </TableHeader>
              <TableBody>{activeList.map(renderRow)}</TableBody>
            </Table>
          )}
        </div>

        {/* Thống kê lịch sử lỗi Soát tool (kể cả đơn đã sửa) — đếm ĐƠN riêng biệt.
          3 cột Khách → Sản phẩm → Loại lỗi, click Khách/Sản phẩm để lọc chéo. */}
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-wrap">
            <AlertTriangle size={15} className="text-amber-500" />
            <span className="text-sm font-semibold">{t('errorStats.title')}</span>
            <span className="hidden md:inline text-[11px] text-muted-foreground">— {t('errorStats.subtitle')}</span>
            <div className="ml-auto flex items-center gap-2">
              {(selCust || selType) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelCust('');
                    setSelType('');
                  }}
                  className="inline-flex items-center gap-1 text-[11px] rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2 py-0.5"
                >
                  {t('errorStats.clearCrossFilter')}
                  <X size={11} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setCustomerView(true)}
                className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2 py-1 hover:bg-muted transition-colors"
              >
                <Users size={13} />
                {t('errorStats.viewByCustomer')}
              </button>
              <button
                type="button"
                onClick={() => setStatsExpanded((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2 py-1 hover:bg-muted transition-colors"
              >
                {statsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {statsExpanded ? t('errorStats.collapse') : t('errorStats.expand')}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
            {/* Cột 1 — Khách hàng */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} className="text-indigo-600" />
                <h3 className="text-sm font-semibold">{t('errorStats.byCustomer')}</h3>
                {selCust && (
                  <button
                    type="button"
                    onClick={() => setSelCust('')}
                    className="ml-auto inline-flex items-center gap-1 text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                  >
                    <X size={10} /> {t('errorStats.deselect')}
                  </button>
                )}
              </div>
              {stats.byCustomer.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">{t('errorStats.noData')}</p>
              ) : (
                <div className={cn('space-y-0.5', statsExpanded ? '' : 'max-h-72 overflow-y-auto')}>
                  {stats.byCustomer.map((c) => {
                    const active = selCust === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setSelCust((cur) => (cur === c.key ? '' : c.key))}
                        className={`w-full flex items-center gap-2 text-[13px] rounded px-2 py-1 text-left transition-colors ${
                          active ? 'bg-indigo-100 dark:bg-indigo-500/20' : 'hover:bg-muted/60'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium" title={c.userSku || t('errorStats.unknown')}>
                            {c.userSku || t('errorStats.unknown')}
                          </div>
                          {c.userEmail && (
                            <div className="truncate text-[11px] text-muted-foreground" title={c.userEmail}>
                              {c.userEmail}
                            </div>
                          )}
                        </div>
                        <span className="text-muted-foreground tabular-nums shrink-0">{c.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cột 2 — Sản phẩm */}
            <div className="lg:border-l lg:border-border lg:pl-4">
              <div className="flex items-center gap-2 mb-3">
                <PackageSearch size={16} className="text-indigo-600" />
                <h3 className="text-sm font-semibold">{t('errorStats.byProduct')}</h3>
                {selType && (
                  <button
                    type="button"
                    onClick={() => setSelType('')}
                    className="ml-auto inline-flex items-center gap-1 text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                  >
                    <X size={10} /> {t('errorStats.deselect')}
                  </button>
                )}
              </div>
              {stats.byProduct.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">{t('errorStats.noData')}</p>
              ) : (
                <div className={cn('space-y-0.5', statsExpanded ? '' : 'max-h-72 overflow-y-auto')}>
                  {stats.byProduct.map((p) => {
                    const active = selType === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setSelType((cur) => (cur === p.key ? '' : p.key))}
                        className={`w-full flex items-center gap-2 text-[13px] rounded px-2 py-1 text-left transition-colors ${
                          active ? 'bg-indigo-100 dark:bg-indigo-500/20' : 'hover:bg-muted/60'
                        }`}
                      >
                        {p.mockup ? (
                          <img
                            src={p.mockup}
                            alt=""
                            className="w-7 h-7 rounded object-cover border border-border shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded border border-dashed border-border shrink-0" />
                        )}
                        {p.level != null && (
                          <Badge
                            className="font-normal border shrink-0 text-[10px]"
                            style={{
                              backgroundColor: PRODUCT_LEVEL_MAP[p.level]?.color,
                              color: '#fff',
                              borderColor: PRODUCT_LEVEL_MAP[p.level]?.color,
                            }}
                          >
                            {t('level', { level: p.level })}
                          </Badge>
                        )}
                        <span
                          className="flex-1 min-w-0 truncate"
                          title={p.fullName || p.type || t('errorStats.unknown')}
                        >
                          {p.fullName || p.type || t('errorStats.unknown')}
                        </span>
                        <span className="text-muted-foreground tabular-nums shrink-0">{p.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cột 3 — Loại lỗi (click để mở chi tiết đơn + note lỗi) */}
            <div className="lg:border-l lg:border-border lg:pl-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-amber-500" />
                <h3 className="text-sm font-semibold">{t('errorStats.byError')}</h3>
                <span className="hidden xl:inline text-[10px] text-muted-foreground">
                  — {t('errorStats.byErrorHint')}
                </span>
              </div>
              {stats.byError.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">{t('errorStats.noData')}</p>
              ) : (
                <div className={cn('space-y-0.5', statsExpanded ? '' : 'max-h-72 overflow-y-auto')}>
                  {stats.byError.map((e) => {
                    const active = selCode === (e.code || '');
                    return (
                      <button
                        key={e.code || '(unknown)'}
                        type="button"
                        onClick={() => setSelCode((cur) => (cur === (e.code || '') ? '' : e.code || ''))}
                        className={`w-full flex items-center gap-2 text-[13px] rounded px-2 py-1 text-left transition-colors ${
                          active ? 'bg-amber-100 dark:bg-amber-500/20' : 'hover:bg-muted/60'
                        }`}
                      >
                        <Badge
                          variant="outline"
                          className="font-normal text-amber-700 border-amber-300 dark:text-amber-300 truncate"
                        >
                          {e.label || e.code || t('errorStats.unknown')}
                        </Badge>
                        <span className="ml-auto text-muted-foreground tabular-nums shrink-0">{e.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Panel chi tiết 1 loại lỗi: đơn + sản phẩm + note lỗi */}
          {selCode && (
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[13px] font-semibold">{t('errorStats.detail.title')}</span>
                <Badge variant="outline" className="font-normal text-amber-700 border-amber-300 dark:text-amber-300">
                  {codeDetail.label}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {t('errorStats.detail.orderCount', { count: codeDetail.items.length })}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailExpanded((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2 py-1 hover:bg-muted transition-colors"
                  >
                    {detailExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {detailExpanded ? t('errorStats.collapse') : t('errorStats.expand')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelCode('')}
                    className="inline-flex items-center gap-1 text-[11px] rounded bg-muted px-2 py-0.5 text-muted-foreground"
                  >
                    <X size={11} /> {t('errorStats.detail.close')}
                  </button>
                </div>
              </div>
              {codeDetail.items.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">{t('errorStats.detail.noMatching')}</p>
              ) : (
                <div className={cn('overflow-x-auto', detailExpanded ? '' : 'max-h-80 overflow-y-auto')}>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-[11px] uppercase text-muted-foreground whitespace-nowrap">
                        <th className="w-12 px-1 py-1.5">{t('errorStats.detail.columns.image')}</th>
                        <th className="px-2 py-1.5">{t('errorStats.detail.columns.orderCode')}</th>
                        <th className="px-2 py-1.5">{t('errorStats.detail.columns.product')}</th>
                        <th className="px-2 py-1.5">{t('errorStats.detail.columns.sizeColor')}</th>
                        <th className="px-2 py-1.5">{t('errorStats.detail.columns.errorFile')}</th>
                        <th className="px-2 py-1.5">{t('errorStats.detail.columns.errorNote')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codeDetail.items.map((it) => (
                        <tr key={it.orderId} className="border-t border-border/40 hover:bg-muted/30 align-top">
                          <td className="w-12 px-1 py-1.5">
                            <ImageThumbCell
                              url={it.mockupUrl}
                              originalUrl={it.mockupOriginalUrl}
                              title={t('list.mockupTitle', { id: it.productionId || '' })}
                              onOpen={(url, title, originalUrl) => setPreview({ url, title, originalUrl })}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <span className="font-medium whitespace-nowrap">{it.productionId || '—'}</span>
                              {it.productionId && (
                                <CopyButton value={it.productionId} label="Production ID" iconSize={11} />
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-2">
                              {it.mockup ? (
                                <img
                                  src={it.mockup}
                                  alt=""
                                  className="w-6 h-6 rounded object-cover border border-border shrink-0"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded border border-dashed border-border shrink-0" />
                              )}
                              {it.level != null && (
                                <Badge
                                  className="font-normal border shrink-0 text-[10px]"
                                  style={{
                                    backgroundColor: PRODUCT_LEVEL_MAP[it.level]?.color,
                                    color: '#fff',
                                    borderColor: PRODUCT_LEVEL_MAP[it.level]?.color,
                                  }}
                                >
                                  {t('level', { level: it.level })}
                                </Badge>
                              )}
                              <span className="min-w-0 truncate" title={it.product}>
                                {it.product}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                            {it.size || '—'}
                            {it.color ? ` / ${it.color}` : ''}
                          </td>
                          <td className="px-2 py-1.5">
                            {it.errorFile && it.errorFile.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {it.errorFile.map((code) => {
                                  const cfg = resolveConfig(WorkshopConfigCategory.ErrorFileType, code);
                                  return (
                                    <Badge
                                      key={code}
                                      variant="outline"
                                      className="font-normal text-[11px] truncate"
                                      style={cfg?.color ? { color: cfg.color, borderColor: cfg.color } : undefined}
                                    >
                                      {cfg?.name || code}
                                    </Badge>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground whitespace-pre-wrap max-w-[360px]">
                            {it.note || <span className="text-muted-foreground/50">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <ImagePreviewDialog
          open={preview !== null}
          onOpenChange={(v) => !v && setPreview(null)}
          url={preview?.url}
          originalUrl={preview?.originalUrl}
          title={preview?.title}
        />

        {/* Modal full-screen: xem lỗi Soát tool theo TỪNG khách hàng */}
        <Dialog open={customerView} onOpenChange={setCustomerView}>
          <DialogContent className="max-w-none w-[92vw] md:w-[60vw] h-screen p-0 gap-0 flex flex-col sm:rounded-none">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
              <Users size={16} className="text-indigo-600" />
              <DialogTitle className="text-base">{t('customerModal.title')}</DialogTitle>
              <span className="hidden sm:inline text-[12px] text-muted-foreground">
                {t('customerModal.subtitle', { count: perCustomer.length })}
              </span>
              {perCustomer.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedCust(allCustExpanded ? new Set() : new Set(perCustomer.map((c) => c.key)))}
                  className="ml-auto mr-8 inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2 py-1 hover:bg-muted transition-colors"
                >
                  {allCustExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {allCustExpanded ? t('customerModal.collapseAll') : t('customerModal.expandAll')}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {perCustomer.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-16">{t('errorStats.noData')}</p>
              ) : (
                perCustomer.map((c) => {
                  const exp = expandedCust.has(c.key);
                  return (
                    <div key={c.key} className="rounded-lg border border-border bg-card p-3 pr-5">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-bold text-[17px]">{c.userSku || t('errorStats.unknown')}</span>
                        {c.userEmail && <span className="text-[12px] text-muted-foreground">{c.userEmail}</span>}
                        <div className="ml-auto flex items-center gap-3">
                          <span className="inline-flex items-baseline gap-1 rounded-md bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40 px-2.5 py-1">
                            <span className="text-lg font-extrabold tabular-nums leading-none">{c.count}</span>
                            <span className="text-[11px] font-medium">{t('customerModal.errorOrders')}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setCustDetailProduct('');
                              setCustDetail({ key: c.key, userSku: c.userSku, userEmail: c.userEmail });
                            }}
                            className="inline-flex items-center gap-1 text-[11px] rounded-md border border-indigo-300 text-indigo-700 dark:text-indigo-300 dark:border-indigo-500/40 px-2 py-1 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                          >
                            <FileSearch size={13} /> {t('customerModal.viewDetail')}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCust(c.key)}
                            className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2 py-1 hover:bg-muted transition-colors"
                          >
                            {exp ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            {exp ? t('errorStats.collapse') : t('errorStats.expand')}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-2">
                        {/* Sản phẩm lỗi */}
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                            <PackageSearch size={12} /> {t('customerModal.errorProducts')}
                            <span className="text-[14px] font-extrabold tabular-nums text-indigo-600 dark:text-indigo-400 normal-case">
                              {c.products.length}
                            </span>
                          </div>
                          <div className={cn('space-y-0.5 max-w-xl', exp ? '' : 'max-h-28 overflow-y-auto')}>
                            {c.products.map((p, i) => (
                              <div key={`${p.product}-${i}`} className="flex items-center gap-2 text-[13px]">
                                {p.mockup ? (
                                  <img
                                    src={p.mockup}
                                    alt=""
                                    className="w-6 h-6 rounded object-cover border border-border shrink-0"
                                  />
                                ) : (
                                  <div className="w-6 h-6 rounded border border-dashed border-border shrink-0" />
                                )}
                                {p.level != null && (
                                  <Badge
                                    className="font-normal border shrink-0 text-[10px]"
                                    style={{
                                      backgroundColor: PRODUCT_LEVEL_MAP[p.level]?.color,
                                      color: '#fff',
                                      borderColor: PRODUCT_LEVEL_MAP[p.level]?.color,
                                    }}
                                  >
                                    {t('level', { level: p.level })}
                                  </Badge>
                                )}
                                <span className="flex-1 min-w-0 truncate" title={p.product}>
                                  {p.product}
                                </span>
                                <span className="shrink-0 tabular-nums text-[15px] font-extrabold text-indigo-600 dark:text-indigo-400">
                                  {p.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Loại lỗi */}
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                            <AlertTriangle size={12} className="text-amber-500" /> {t('customerModal.errorTypes')}
                            <span className="text-[14px] font-extrabold tabular-nums text-amber-600 dark:text-amber-400 normal-case">
                              {c.codes.length}
                            </span>
                          </div>
                          <div className={cn('space-y-1 max-w-xl', exp ? '' : 'max-h-28 overflow-y-auto')}>
                            {c.codes.map((e, i) => (
                              <div key={`${e.code}-${i}`} className="flex items-center gap-2 text-[13px]">
                                <Badge
                                  variant="outline"
                                  className="font-normal text-amber-700 border-amber-300 dark:text-amber-300 truncate"
                                >
                                  {e.label || e.code || t('errorStats.unknown')}
                                </Badge>
                                <span className="ml-auto shrink-0 tabular-nums text-[15px] font-extrabold text-amber-600 dark:text-amber-400">
                                  {e.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Dialog chi tiết đơn lỗi của 1 khách hàng */}
        <Dialog open={custDetail !== null} onOpenChange={(v) => !v && setCustDetail(null)}>
          <DialogContent className="max-w-none w-[92vw] md:w-[72vw] h-screen p-0 gap-0 flex flex-col sm:rounded-none">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0 flex-wrap">
              <Users size={16} className="text-indigo-600" />
              <DialogTitle className="text-base">{custDetailData?.userSku || t('errorStats.unknown')}</DialogTitle>
              {custDetailData?.userEmail && (
                <span className="text-[12px] text-muted-foreground">{custDetailData.userEmail}</span>
              )}
              <span className="inline-flex items-baseline gap-1 rounded-md bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40 px-2.5 py-1">
                <span className="text-lg font-extrabold tabular-nums leading-none">
                  {custDetailData?.totalOrders ?? 0}
                </span>
                <span className="text-[11px] font-medium">{t('customerModal.errorOrders')}</span>
              </span>
              <span className="inline-flex items-baseline gap-1 rounded-md bg-indigo-100 text-indigo-700 border border-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/40 px-2.5 py-1">
                <span className="text-lg font-extrabold tabular-nums leading-none">
                  {custDetailData?.totalProducts ?? 0}
                </span>
                <span className="text-[11px] font-medium">{t('custDetailModal.errorProducts')}</span>
              </span>
              <div className="ml-auto mr-8 w-56">
                <SelectFilter
                  label={t('custDetailModal.filterProduct')}
                  value={custDetailProduct}
                  onChange={setCustDetailProduct}
                  options={(custDetailData?.productOptions ?? []).map((p) => ({
                    value: p.value,
                    label: p.label,
                    count: p.count,
                  }))}
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {!custDetailData || custDetailData.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-16">{t('errorStats.detail.noMatching')}</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-[11px] uppercase text-muted-foreground whitespace-nowrap">
                      <th className="w-12 px-1 py-1.5">{t('errorStats.detail.columns.image')}</th>
                      <th className="px-2 py-1.5">{t('errorStats.detail.columns.orderCode')}</th>
                      <th className="px-2 py-1.5">{t('errorStats.detail.columns.product')}</th>
                      <th className="px-2 py-1.5">{t('errorStats.detail.columns.sizeColor')}</th>
                      <th className="px-2 py-1.5">{t('errorStats.detail.columns.errorType')}</th>
                      <th className="px-2 py-1.5">{t('errorStats.detail.columns.errorFile')}</th>
                      <th className="px-2 py-1.5">{t('errorStats.detail.columns.errorNote')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {custDetailData.orders.map((it) => (
                      <tr key={it.orderId} className="border-t border-border/40 hover:bg-muted/30 align-top">
                        <td className="w-12 px-1 py-1.5">
                          <ImageThumbCell
                            url={it.mockupUrl}
                            originalUrl={it.mockupOriginalUrl}
                            title={t('list.mockupTitle', { id: it.productionId || '' })}
                            onOpen={(url, title, originalUrl) => setPreview({ url, title, originalUrl })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <span className="font-medium whitespace-nowrap">{it.productionId || '—'}</span>
                            {it.productionId && (
                              <CopyButton value={it.productionId} label="Production ID" iconSize={11} />
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            {it.mockup ? (
                              <img
                                src={it.mockup}
                                alt=""
                                className="w-6 h-6 rounded object-cover border border-border shrink-0"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded border border-dashed border-border shrink-0" />
                            )}
                            {it.level != null && (
                              <Badge
                                className="font-normal border shrink-0 text-[10px]"
                                style={{
                                  backgroundColor: PRODUCT_LEVEL_MAP[it.level]?.color,
                                  color: '#fff',
                                  borderColor: PRODUCT_LEVEL_MAP[it.level]?.color,
                                }}
                              >
                                {t('level', { level: it.level })}
                              </Badge>
                            )}
                            <span className="min-w-0 truncate" title={it.product}>
                              {it.product}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                          {it.size || '—'}
                          {it.color ? ` / ${it.color}` : ''}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {[...it.codes.entries()].map(([code, label]) => (
                              <Badge
                                key={code || '(unknown)'}
                                variant="outline"
                                className="font-normal text-amber-700 border-amber-300 dark:text-amber-300 truncate"
                              >
                                {label || code || t('errorStats.unknown')}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          {it.errorFile && it.errorFile.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {it.errorFile.map((code) => {
                                const cfg = resolveConfig(WorkshopConfigCategory.ErrorFileType, code);
                                return (
                                  <Badge
                                    key={code}
                                    variant="outline"
                                    className="font-normal text-[11px] truncate"
                                    style={cfg?.color ? { color: cfg.color, borderColor: cfg.color } : undefined}
                                  >
                                    {cfg?.name || code}
                                  </Badge>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground whitespace-pre-wrap max-w-[320px]">
                          {it.note || <span className="text-muted-foreground/50">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

/** 3 mã note chính ghim đầu danh sách dòng con "Note không ok". */
const PINNED_NOTE_CODES = ['error', 'no-pdf', 'no-tool'];

/** Nền màu theo % so với tổng đơn (dòng con "Soát lỗi"): <8% xanh · 8–15% vàng · ≥15% đỏ. */
function pctBg(count: number, total: number): string {
  if (!count || !total) return '';
  const p = (count / total) * 100;
  if (p < 8) return 'bg-emerald-100 dark:bg-emerald-500/20';
  if (p < 15) return 'bg-amber-100 dark:bg-amber-500/25';
  return 'bg-red-100 dark:bg-red-500/30';
}

/** 1 dòng trong tooltip breakdown ô số (mirror BreakdownNumCell của DesignerDailyOverview). */
interface BreakdownLine {
  label: string;
  count: number;
  onClick?: () => void;
}

function BreakdownContent({ lines }: { lines: BreakdownLine[] }) {
  return (
    <div className="text-left space-y-0.5 -mx-1">
      {lines.map((l) =>
        l.onClick && l.count > 0 ? (
          <button
            key={l.label}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              l.onClick?.();
            }}
            className="flex justify-between gap-3 w-full rounded px-1 hover:bg-primary/15 cursor-pointer text-left"
          >
            <span>{l.label}</span>
            <span className="tabular-nums font-semibold">{l.count}</span>
          </button>
        ) : (
          <div key={l.label} className="flex justify-between gap-3 px-1">
            <span>{l.label}</span>
            <span className="tabular-nums font-semibold">{l.count}</span>
          </div>
        ),
      )}
    </div>
  );
}

function DayMetricRow({
  label,
  cls,
  days,
  dayFilter,
  pick,
  total,
  onPick,
  onDrill,
  onDrillTotal,
  indent,
  labelHint,
  breakdownFor,
  totalBreakdown,
  cellBg,
  totalBg,
  pctBase,
  totalPctBase,
}: {
  label: string;
  cls: string;
  days: ToolCheckDayRow[];
  dayFilter: string;
  pick: (d: ToolCheckDayRow) => number;
  total: number;
  onPick: (day: string) => void;
  /** Bấm CON SỐ 1 ngày → mở panel danh sách đơn (nền ô vẫn toggle lọc ngày). */
  onDrill?: (day: string) => void;
  /** Bấm con số cột "Tổng" → drill cả kỳ. */
  onDrillTotal?: () => void;
  /** Dòng con (thụt đầu dòng, chữ nhỏ hơn). */
  indent?: boolean;
  /** Tooltip giải thích trên label (vd chú giải màu % của dòng "Soát lỗi"). */
  labelHint?: string;
  /** Hover con số 1 ngày → tooltip breakdown (từng dòng bấm được để drill). */
  breakdownFor?: (d: ToolCheckDayRow) => BreakdownLine[];
  /** Hover con số cột "Tổng" → tooltip breakdown cả kỳ. */
  totalBreakdown?: BreakdownLine[];
  /** Nền màu từng ô ngày (vd theo % lỗi/tổng đơn). */
  cellBg?: (d: ToolCheckDayRow, v: number) => string;
  /** Nền màu ô cột "Tổng". */
  totalBg?: string;
  /** Mẫu số tính % hiển thị cạnh con số từng ngày (dòng "Lỗi": tổng đơn ngày đó). */
  pctBase?: (d: ToolCheckDayRow) => number;
  /** Mẫu số tính % cho ô cột "Tổng". */
  totalPctBase?: number;
}) {
  const withBreakdown = (node: React.ReactNode, lines?: BreakdownLine[]) =>
    lines && lines.length > 0 ? (
      <Hint forceRich content={<BreakdownContent lines={lines} />}>
        {node as React.ReactElement}
      </Hint>
    ) : (
      node
    );
  // Dòng chính: số to + đậm; dòng con (indent): giữ cỡ hiện tại, KHÔNG bold.
  // `relative` để % neo absolute bên phải con số — số vẫn căn giữa THẲNG HÀNG
  // với các dòng khác, % chỉ đứng cạnh chứ không đẩy lệch số.
  const numCls = `relative ${indent ? 'font-normal' : 'font-semibold text-[17px]'}`;
  const pctText = (v: number, base?: number) => {
    if (!v || !base) return null;
    return (
      <span className="absolute left-full top-1/2 -translate-y-1/2 ml-0.5 text-[10px] opacity-70 tabular-nums whitespace-nowrap">
        ({Math.round((v / base) * 100)}%)
      </span>
    );
  };
  const labelNode = (
    <span className={indent ? 'inline-flex items-center' : undefined}>
      {indent && <span className="text-muted-foreground/50 mr-1">└</span>}
      {label}
    </span>
  );
  return (
    <tr className="group">
      <td
        className={`sticky left-0 z-10 bg-card px-3 py-1.5 border-b border-border/60 ${
          indent ? 'pl-6 font-normal text-[12px]' : 'font-medium'
        } ${cls}`}
      >
        {labelHint ? (
          <Hint forceRich content={labelHint}>
            <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
              {labelNode}
            </span>
          </Hint>
        ) : (
          labelNode
        )}
      </td>
      {days.map((d) => {
        const v = pick(d);
        const active = dayFilter === d.day;
        const bg = cellBg?.(d, v) || '';
        return (
          <td
            key={d.day}
            onClick={() => onPick(d.day)}
            className={`border-b border-l border-border/60 text-center px-1 py-1.5 cursor-pointer transition-colors ${
              active ? 'bg-indigo-100 dark:bg-indigo-500/25' : bg || 'hover:bg-muted/50'
            }`}
          >
            {v === 0 ? (
              <span className="text-muted-foreground/30">·</span>
            ) : onDrill ? (
              withBreakdown(
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDrill(d.day);
                  }}
                  className={`${numCls} rounded px-1 -mx-1 hover:bg-primary/15 cursor-pointer tabular-nums ${cls}`}
                >
                  {v}
                  {pctText(v, pctBase?.(d))}
                </button>,
                breakdownFor?.(d),
              )
            ) : (
              <span className={`${numCls} ${cls}`}>
                {v}
                {pctText(v, pctBase?.(d))}
              </span>
            )}
          </td>
        );
      })}
      <td className={`border-b border-l border-border text-center px-2 py-1.5 ${totalBg || 'bg-muted/30'} ${cls}`}>
        {total === 0 ? (
          <span className="text-muted-foreground/40">·</span>
        ) : onDrillTotal ? (
          withBreakdown(
            <button
              type="button"
              onClick={onDrillTotal}
              className={`${numCls} rounded px-1 -mx-1 hover:bg-primary/15 cursor-pointer tabular-nums ${cls}`}
            >
              {total}
              {pctText(total, totalPctBase)}
            </button>,
            totalBreakdown,
          )
        ) : (
          <span className={`${numCls} ${cls}`}>
            {total}
            {pctText(total, totalPctBase)}
          </span>
        )}
      </td>
    </tr>
  );
}
