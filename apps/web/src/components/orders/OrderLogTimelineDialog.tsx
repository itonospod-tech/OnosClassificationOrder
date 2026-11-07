import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowRight, History, RefreshCw } from 'lucide-react';
import type { FulfillmentStage, ProductionOrderLog, ProductionOrderLogAction } from 'shared';
import { WorkshopConfigCategory } from 'shared';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { getStageLabel } from '@/utils/fulfillmentStageLabel';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId?: string;
  productionId?: string;
}

function buildActionBadge(
  t: TFunction<'orderLog'>,
): Record<
  ProductionOrderLogAction,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline' }
> {
  return {
    create: { label: t('actionBadge.create'), variant: 'success' },
    update: { label: t('actionBadge.update'), variant: 'default' },
    bulk_update: { label: t('actionBadge.bulkUpdate'), variant: 'default' },
    import: { label: t('actionBadge.import'), variant: 'outline' },
    delete: { label: t('actionBadge.delete'), variant: 'destructive' },
    transfer: { label: t('actionBadge.transfer'), variant: 'warning' },
    cancel: { label: t('actionBadge.cancel'), variant: 'destructive' },
    update_design: { label: t('actionBadge.updateDesign'), variant: 'default' },
    hold: { label: t('actionBadge.hold'), variant: 'warning' },
    unhold: { label: t('actionBadge.unhold'), variant: 'success' },
    force_complete: { label: t('actionBadge.forceComplete'), variant: 'warning' },
    restore: { label: t('actionBadge.restore'), variant: 'success' },
    rework_back: { label: t('actionBadge.reworkBack'), variant: 'warning' },
  };
}

// Import log ghi `after` = object tóm tắt (productionId/type/isMapped/_subAction).
// `_subAction` = đơn được tạo mới hay cập nhật trong lần import.
function buildImportSubaction(t: TFunction<'orderLog'>): Record<string, { label: string; variant: 'default' | 'success' }> {
  return {
    create: { label: t('importSubaction.create'), variant: 'success' },
    update: { label: t('importSubaction.update'), variant: 'default' },
  };
}

function buildFieldLabel(t: TFunction<'orderLog'>): Record<string, string> {
  return {
    printStatus: t('fieldLabel.printStatus'),
    printStatusNote: t('fieldLabel.printStatusNote'),
    toolResult: t('fieldLabel.toolResult'),
    toolResultNote: t('fieldLabel.toolResultNote'),
    errorFile: t('fieldLabel.errorFile'),
    errorFileNote: t('fieldLabel.errorFileNote'),
    assignee: t('fieldLabel.assignee'),
    assigneeNote: t('fieldLabel.assigneeNote'),
    designerStatus: t('fieldLabel.designerStatus'),
    fabricType: t('fieldLabel.fabricType'),
    machineNumber: t('fieldLabel.machineNumber'),
    productionError: t('fieldLabel.productionError'),
    productionErrorNote: t('fieldLabel.productionErrorNote'),
    productionErrorSource: t('fieldLabel.productionErrorSource'),
    cancelledAt: t('fieldLabel.cancelledAt'),
    heldAt: t('fieldLabel.heldAt'),
    designs: t('fieldLabel.designs'),
    designsOriginal: t('fieldLabel.designsOriginal'),
    mockupUrl: t('fieldLabel.mockupUrl'),
    // Field bị re-import (importOrders) ghi đè — xem OrderLog.md §4.
    factoryId: t('fieldLabel.factoryId'),
    machineTypeId: t('fieldLabel.machineTypeId'),
    type: t('fieldLabel.type'),
    color: t('fieldLabel.color'),
    size: t('fieldLabel.size'),
    quantity: t('fieldLabel.quantity'),
    status: t('fieldLabel.status'),
  };
}

// Field nào resolve code→name (+ color) qua workshop_config store.
const FIELD_CATEGORY: Record<string, WorkshopConfigCategory> = {
  printStatus: WorkshopConfigCategory.PrintStatus,
  printStatusNote: WorkshopConfigCategory.PrintStatusNote,
  toolResult: WorkshopConfigCategory.ToolResult,
  toolResultNote: WorkshopConfigCategory.ToolResultNote,
  errorFile: WorkshopConfigCategory.ErrorFileType,
  assigneeNote: WorkshopConfigCategory.AssigneeNote,
  fabricType: WorkshopConfigCategory.FabricType,
  machineNumber: WorkshopConfigCategory.Machine,
  productionError: WorkshopConfigCategory.ProductionError,
};

// designerStatus là enum → nhãn + màu tiếng Việt (không phải workshop_config).
function buildDesignerStatusLabels(t: TFunction<'orderLog'>): Record<string, string> {
  return {
    unassigned: t('designerStatusLabels.unassigned'),
    assigned: t('designerStatusLabels.assigned'),
    'in-progress': t('designerStatusLabels.inProgress'),
    done: t('designerStatusLabels.done'),
    rejected: t('designerStatusLabels.rejected'),
    rework: t('designerStatusLabels.rework'),
  };
}
const DESIGNER_STATUS_COLOR: Record<string, string> = {
  unassigned: '#a1a1aa',
  assigned: '#71717a',
  'in-progress': '#6366f1',
  done: '#10b981',
  rejected: '#f43f5e',
  rework: '#f59e0b',
};
const SOURCE_COLOR: Record<string, string> = { designer: '#8b5cf6', factory: '#0ea5e9' };

// Trạng thái công đoạn fulfillment (waiting/in-progress/done/rework) → nhãn + màu.
function buildFulfillmentStatusLabels(t: TFunction<'orderLog'>): Record<string, string> {
  return {
    waiting: t('fulfillmentStatusLabels.waiting'),
    'in-progress': t('fulfillmentStatusLabels.inProgress'),
    done: t('fulfillmentStatusLabels.done'),
    rework: t('fulfillmentStatusLabels.rework'),
  };
}
const FULFILLMENT_STATUS_COLOR: Record<string, string> = {
  waiting: '#a1a1aa',
  'in-progress': '#6366f1',
  done: '#10b981',
  rework: '#f59e0b',
};
// Field key dạng `fulfillmentStages.<stage>.status` (log của Task Fulfillment).
const FULFILLMENT_STAGE_STATUS_RE = /^fulfillmentStages\.(.+)\.status$/;

/** Nhãn cho field key (gồm key động của fulfillment stage). */
function fieldLabelFor(field: string, t: TFunction<'orderLog'>): string {
  const m = field.match(FULFILLMENT_STAGE_STATUS_RE);
  if (m) {
    const stage = m[1] as FulfillmentStage;
    return t('fieldLabel.fulfillmentStage', { stage: getStageLabel(t, stage) });
  }
  if (field === 'currentFulfillmentStage') return t('fieldLabel.currentFulfillmentStage');
  return buildFieldLabel(t)[field] || field;
}

/** Style tint từ hex `#rrggbb` — chữ = color, nền = color 12% (8-digit hex). */
function tintStyle(color?: string): React.CSSProperties | undefined {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return undefined;
  return { color, backgroundColor: `${color}1f` };
}

/** Nhãn đẹp cho key snapshot của update_design (`mockupUrl`, `designs.front`, …). */
function designFieldLabel(key: string, t: TFunction<'orderLog'>): string {
  if (key === 'mockupUrl') return t('fieldLabel.mockupUrl');
  return key.replace(/^designs\./, '');
}

/** Ghép before/after (object keyed theo field) thành list URL cũ→mới. */
function designChangeEntries(before: unknown, after: unknown): { key: string; before: string; after: string }[] {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  return keys.map((key) => ({
    key,
    before: b[key] == null ? '' : String(b[key]),
    after: a[key] == null ? '' : String(a[key]),
  }));
}

function formatDate(d: Date | string | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('vi-VN', { hour12: false });
}

type Display = { text: string; color?: string };

/** Pill trạng thái — có màu (tint) nếu resolve được, `strike` cho giá trị cũ. */
function StatusPill({ text, color, strike }: { text: string; color?: string; strike?: boolean }) {
  const tint = strike ? undefined : tintStyle(color);
  return (
    <span
      style={tint}
      className={cn(
        'px-1.5 py-0.5 rounded text-[13px]',
        strike && 'bg-muted/60 text-muted-foreground line-through decoration-muted-foreground/40',
        !strike && !tint && 'bg-emerald-50 text-emerald-700 font-medium dark:bg-emerald-500/10 dark:text-emerald-300',
        !strike && tint && 'font-medium',
      )}
    >
      {text || '—'}
    </span>
  );
}

function DiffRow({ before, after }: { before: Display; after: Display }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <StatusPill text={before.text} color={before.color} strike />
      <ArrowRight size={13} className="text-muted-foreground shrink-0" />
      <StatusPill text={after.text} color={after.color} />
    </div>
  );
}

export function OrderLogTimelineDialog({ open, onOpenChange, orderId, productionId }: Props) {
  const { t } = useTranslation('orderLog');
  const [logs, setLogs] = useState<ProductionOrderLog[]>([]);
  const [loading, setLoading] = useState(false);

  // Store để resolve code → name + color (workshop_config). Assignee đã được BE
  // resolve sang tên sẵn trong response nên FE không cần user store.
  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);
  const resolve = useWorkshopConfigStore((s) => s.resolve);

  const actionBadge = useMemo(() => buildActionBadge(t), [t]);
  const importSubaction = useMemo(() => buildImportSubaction(t), [t]);
  const designerStatusLabels = useMemo(() => buildDesignerStatusLabels(t), [t]);
  const fulfillmentStatusLabels = useMemo(() => buildFulfillmentStatusLabels(t), [t]);

  const fetchLogs = async () => {
    if (!orderId) return;
    try {
      setLoading(true);
      const res = await RepositoryRemote.order.getLogs(orderId, '?page=1&limit=200&order=desc');
      setLogs(res.data?.data || []);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && orderId) {
      fetchLogs();
      if (!configLoaded) loadConfig();
    } else if (!open) {
      setLogs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  // Resolve 1 giá trị field → { tên hiển thị, màu } (KHÔNG hiện code cho user).
  const resolveDisplay = (field: string | undefined, value: unknown): Display => {
    if (value === null || value === undefined || value === '') return { text: '—' };
    if (Array.isArray(value)) {
      const parts = value.map((v) => resolveDisplay(field, v).text).filter((s) => s && s !== '—');
      return { text: parts.length ? parts.join(', ') : '—' };
    }
    if (typeof value === 'object') return { text: JSON.stringify(value) };
    const raw = String(value);
    if (!field) return { text: raw };
    if (field === 'designerStatus') {
      return { text: designerStatusLabels[raw] || raw, color: DESIGNER_STATUS_COLOR[raw] };
    }
    if (field === 'productionErrorSource') {
      const text =
        raw === 'designer' ? t('sourceLabel.designer') : raw === 'factory' ? t('sourceLabel.factory') : raw;
      return { text, color: SOURCE_COLOR[raw] };
    }
    if (field === 'currentFulfillmentStage') {
      return { text: getStageLabel(t, raw as FulfillmentStage) };
    }
    if (FULFILLMENT_STAGE_STATUS_RE.test(field)) {
      return { text: fulfillmentStatusLabels[raw] || raw, color: FULFILLMENT_STATUS_COLOR[raw] };
    }
    const cat = FIELD_CATEGORY[field];
    if (cat) {
      const cfg = resolve(cat, raw);
      return { text: cfg?.name || raw, color: cfg?.color || undefined };
    }
    return { text: raw };
  };

  // Import: `after` là object tóm tắt → render dễ đọc (không dump JSON).
  const renderImportPayload = (after: unknown): React.ReactNode => {
    if (after == null) return null;
    if (typeof after !== 'object') {
      return <div className="text-xs text-muted-foreground">{String(after)}</div>;
    }
    const o = after as Record<string, unknown>;
    const sub = typeof o._subAction === 'string' ? importSubaction[o._subAction] : undefined;
    const pid = o.productionId != null ? String(o.productionId) : undefined;
    const type = o.type != null ? String(o.type) : undefined;
    const isMapped = typeof o.isMapped === 'boolean' ? (o.isMapped as boolean) : undefined;
    // Các key khác (nếu có) — hiển thị "label: name" để không giấu thông tin.
    const rest = Object.entries(o).filter(
      ([k]) => !k.startsWith('_') && !['productionId', 'type', 'isMapped'].includes(k),
    );
    return (
      <div className="space-y-1 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {sub && <Badge variant={sub.variant}>{sub.label}</Badge>}
          {pid && <span className="font-mono text-foreground">{pid}</span>}
          {type && <span className="text-muted-foreground">· {type}</span>}
          {isMapped !== undefined && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px] font-medium',
                isMapped
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
              )}
            >
              {isMapped ? t('importPayload.mapped') : t('importPayload.unmapped')}
            </span>
          )}
        </div>
        {rest.map(([k, v]) => (
          <div key={k} className="text-muted-foreground">
            {fieldLabelFor(k, t)}: <span className="text-foreground">{resolveDisplay(k, v).text}</span>
          </div>
        ))}
      </div>
    );
  };

  const headerLabel = useMemo(() => {
    if (productionId) return t('timeline.titleWithId', { productionId });
    return t('timeline.title');
  }, [productionId, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History size={18} className="text-muted-foreground" />
            {headerLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('timeline.recordCount', { count: logs.length })}</span>
          <Button variant="ghost" size="sm" onClick={fetchLogs} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {t('timeline.reload')}
          </Button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto -mx-1 px-1">
          {loading && logs.length === 0 && (
            <div className="flex items-center justify-center py-10">
              <Spinner size={20} className="text-muted-foreground" />
            </div>
          )}

          {!loading && logs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-10">{t('timeline.empty')}</p>
          )}

          {logs.length > 0 && (
            <div className="space-y-2">
              {logs.map((log) => {
                const meta = actionBadge[log.action as ProductionOrderLogAction] || actionBadge.update;
                const fieldLabel = log.field ? fieldLabelFor(log.field, t) : null;
                const isFieldUpdate = !!log.field && (log.action === 'update' || log.action === 'bulk_update');
                return (
                  <div key={log._id} className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-1.5">
                    {/* Header: action + field + thời gian */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {fieldLabel && (
                          <span className="text-sm font-semibold text-foreground truncate">{fieldLabel}</span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                        {formatDate(log.createdAt)}
                      </span>
                    </div>

                    {/* Field update: diff cũ → mới (đã resolve name + màu) */}
                    {isFieldUpdate && (
                      <DiffRow
                        before={resolveDisplay(log.field, log.before)}
                        after={resolveDisplay(log.field, log.after)}
                      />
                    )}

                    {/* Đổi design: before/after là object keyed theo field
                        (mockupUrl / designs.front / ...) → render từng URL cũ→mới. */}
                    {log.action === 'update_design' && (
                      <div className="space-y-2">
                        {designChangeEntries(log.before, log.after).map(({ key, before, after }) => (
                          <div key={key} className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">{designFieldLabel(key, t)}</span>
                            <div className="text-[11px] font-mono break-all leading-relaxed">
                              <span className="text-destructive line-through">{before || '—'}</span>
                              <span className="mx-1 text-muted-foreground">→</span>
                              <span className="text-emerald-600 dark:text-emerald-400">{after || '—'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Hủy đơn: after = lý do. */}
                    {log.action === 'cancel' && (
                      <div className="text-[13px] rounded bg-rose-50 dark:bg-rose-500/10 px-2 py-1">
                        <span className="text-muted-foreground">{t('timeline.reasonLabel')} </span>
                        <span className="text-foreground">{resolveDisplay(undefined, log.after).text}</span>
                      </div>
                    )}

                    {/* Đẩy về làm lại: field = công đoạn đích, before = công đoạn báo lỗi, after = lý do. */}
                    {log.action === 'rework_back' && (
                      <div className="text-[13px] rounded bg-amber-50 dark:bg-amber-500/10 px-2 py-1 space-y-0.5">
                        <div className="text-muted-foreground">
                          {t('timeline.reworkBackRoute', {
                            from: getStageLabel(t, String(log.before ?? '')),
                            to:
                              log.field === 'designer'
                                ? t('timeline.reworkBackDesigner')
                                : getStageLabel(t, String(log.field ?? '')),
                          })}
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t('timeline.reasonLabel')} </span>
                          <span className="text-foreground">{resolveDisplay(undefined, log.after).text}</span>
                        </div>
                      </div>
                    )}

                    {log.action === 'import' && log.after != null && renderImportPayload(log.after)}

                    {/* Meta: người thực hiện · role · ip */}
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
                      <span className="font-medium text-foreground/70">
                        {log.userName || log.userEmail || t('timeline.systemUser')}
                      </span>
                      {log.roleCode && <span>· {log.roleCode}</span>}
                      {log.ip && <span>· {log.ip}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
