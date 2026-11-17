import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileWarning,
  MessageSquareWarning,
  Package,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { DesignerStatus, WorkshopConfigCategory } from 'shared';

import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { CopyButton } from '@/components/common/CopyButton';
import { Spinner } from '@/components/common/Spinner';
import { ReportIssueDialog } from '@/components/orders/ReportIssueDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { handleAxiosError } from '@/utils';
import { driveThumbUrl, driveViewUrl } from '@/utils/driveThumb';
import { canReportIssue } from '@/utils/orderActions';

import { usePermission } from '@/hooks/usePermission';

interface Props {
  orderId: string | null;
  onClose: () => void;
}

type OrderDetail = {
  _id: string;
  productionId: string;
  orderId?: string;
  type?: string;
  size?: string;
  color?: string;
  mockupUrl?: string;
  mockupOriginalUrl?: string;
  designs?: Record<string, string>;
  designsOriginal?: Record<string, string>;
  designsStatus?: Record<string, 'pending' | 'ready' | 'failed' | undefined>;
  factory?: { name?: string; shortName?: string };
  machineType?: { name?: string; shortName?: string };
  productConfig?: { fullName?: string; shortName?: string };
  fabricType?: string;
  machineNumber?: string;
  toolResult?: string;
  toolResultNote?: string;
  productionError?: string;
  productionErrorNote?: string;
  errorFile?: string[];
  errorFileNote?: string;
  designerStatus?: DesignerStatus;
  designerAssignedAt?: string;
  designerStartedAt?: string;
  designerCompletedAt?: string;
  designerRejectedAt?: string;
  designerReworkAt?: string;
  designerRejectedReason?: string;
  designerReworkCount?: number;
  createdAt?: string;
  orderAt?: string;
  inProductionAt?: string;
};

function buildStatusMeta(t: TFunction<'designerTaskWorkflow'>): Record<DesignerStatus, { label: string; cls: string }> {
  return {
    [DesignerStatus.Unassigned]: { label: t('taskDetail.status.unassigned'), cls: 'bg-zinc-200 text-zinc-700' },
    [DesignerStatus.Assigned]: { label: t('taskDetail.status.assigned'), cls: 'bg-zinc-300 text-zinc-800' },
    [DesignerStatus.InProgress]: { label: t('taskDetail.status.inProgress'), cls: 'bg-indigo-200 text-indigo-800' },
    [DesignerStatus.Done]: { label: t('taskDetail.status.done'), cls: 'bg-emerald-200 text-emerald-800' },
    [DesignerStatus.Rejected]: { label: t('taskDetail.status.rejected'), cls: 'bg-rose-200 text-rose-800' },
    [DesignerStatus.Rework]: { label: t('taskDetail.status.rework'), cls: 'bg-amber-200 text-amber-800' },
  };
}

function fmt(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('vi-VN', { hour12: false });
}

export function TaskDetailDialog({ orderId, onClose }: Props) {
  const { t } = useTranslation(['designerTaskWorkflow', 'common', 'orders']);
  const statusMeta = useMemo(() => buildStatusMeta(t), [t]);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { roleName } = usePermission();

  // Click ảnh → mở tab mới (Drive viewer) thay vì preview trong app → không tải
  // full file (mấy chục MB) qua server mình.
  const openInNewTab = (url?: string) => {
    const target = driveViewUrl(url);
    if (target) window.open(target, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    if (!orderId) {
      setDetail(null);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        const res = await RepositoryRemote.designer.getOrderById(orderId);
        setDetail((res.data?.data || null) as OrderDetail | null);
      } catch (err) {
        handleAxiosError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  // Resolve mã "File sửa lỗi" (errorFile[], category error_file_type) → name.
  const errorFileItems = useWorkshopConfigStore((s) => s.byCategory[WorkshopConfigCategory.ErrorFileType] || []);
  const errorFileLabels = (detail?.errorFile || [])
    .filter(Boolean)
    .map((code) => errorFileItems.find((i) => i.code === code)?.name || code);
  // Resolve mã lỗi xưởng (productionError, category production_error) → tên
  // (mã dạng `se-qc-post-press-3` người dùng không hiểu được).
  const productionErrorItems = useWorkshopConfigStore(
    (s) => s.byCategory[WorkshopConfigCategory.ProductionError] || [],
  );
  const productionErrorLabel = detail?.productionError
    ? productionErrorItems.find((i) => i.code === detail.productionError)?.name || detail.productionError
    : '';

  const designs = detail?.designsOriginal || detail?.designs || {};
  const designKeys = Object.keys(designs).filter((k) => designs[k]);
  const status = detail?.designerStatus ? statusMeta[detail.designerStatus] : statusMeta[DesignerStatus.Unassigned];

  return (
    <>
      <Dialog open={!!orderId} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <Package size={16} />
              <span className="font-mono text-sm">{detail?.productionId || '...'}</span>
              {detail && (
                <Badge variant="outline" className={`text-[10px] ${status.cls}`}>
                  {status.label}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {loading || !detail ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size={24} />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Basic info */}
              <div className="grid grid-cols-3 gap-3 text-xs">
                <Field label={t('taskDetail.fields.type')} value={detail.type} />
                <Field label={t('taskDetail.fields.sizeColor')} value={`${detail.size || '—'} / ${detail.color || '—'}`} />
                <Field label={t('taskDetail.fields.orderId')} value={detail.orderId} mono copyable />
                <Field label={t('taskDetail.fields.fabricType')} value={detail.fabricType} />
                <Field label={t('taskDetail.fields.machine')} value={detail.machineNumber} />
                <Field label={t('taskDetail.fields.tool')} value={detail.toolResult} />
                <Field label={t('taskDetail.fields.toolNote')} value={detail.toolResultNote} />
                <Field label={t('taskDetail.fields.factory')} value={detail.factory?.name} />
                <Field label={t('taskDetail.fields.room')} value={detail.machineType?.name} />
              </div>

              {/* Mockup */}
              {detail.mockupUrl && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1.5">{t('taskDetail.mockup')}</p>
                  <button
                    type="button"
                    onClick={() => openInNewTab(detail.mockupOriginalUrl || detail.mockupUrl)}
                    title={t('taskDetail.openOriginal')}
                    className="block w-32 h-32 rounded border border-border overflow-hidden hover:ring-2 hover:ring-primary/40 bg-checker"
                  >
                    <img
                      src={driveThumbUrl(detail.mockupOriginalUrl || detail.mockupUrl, 400)}
                      alt=""
                      className="w-full h-full object-contain"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                </div>
              )}

              {/* Designs — hiển thị LINK ảnh (không render ảnh cho đỡ tải file
                  lớn). Left-click mở tab mới; CHUỘT PHẢI → "Lưu liên kết/ảnh"
                  để tải về máy (trình duyệt tự tải, không qua server mình).
                  [Nút "Tải về" tạm ẩn vì ảnh khác-origin bị CORS chặn auto-download.] */}
              {designKeys.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1.5">
                    {t('taskDetail.designsHeading', { count: designKeys.length })}
                  </p>
                  <p className="text-[11px] text-muted-foreground mb-1.5">{t('taskDetail.designsHint')}</p>
                  <div className="space-y-1">
                    {designKeys.map((k) => {
                      const original = (detail.designsOriginal || {})[k];
                      const raw = original || (detail.designs || {})[k];
                      return (
                        <div
                          key={k}
                          className="flex items-center gap-2 text-xs rounded border border-border px-2 py-1.5"
                        >
                          <span className="font-medium text-foreground w-14 shrink-0">{k}</span>
                          {raw ? (
                            <>
                              <a
                                href={raw}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={t('taskDetail.designLinkTitle')}
                                className="inline-flex items-center gap-1 min-w-0 text-primary hover:underline"
                              >
                                <ExternalLink size={12} className="shrink-0" />
                                <span className="truncate">{raw}</span>
                              </a>
                              <span className="ml-auto shrink-0">
                                <CopyButton value={raw} label={t('taskDetail.designLinkLabel')} iconSize={11} />
                              </span>
                            </>
                          ) : (
                            <span className="ml-auto text-muted-foreground">—</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Designer timeline */}
              <div>
                <p className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1">
                  <Calendar size={12} /> {t('taskDetail.timelineTitle')}
                </p>
                <div className="space-y-1 text-xs">
                  {detail.orderAt && (
                    <Timeline
                      icon={<Clock size={11} className="text-indigo-500" />}
                      label={t('taskDetail.timeline.ordered')}
                      value={fmt(detail.orderAt)}
                    />
                  )}
                  {detail.inProductionAt && (
                    <Timeline
                      icon={<Clock size={11} className="text-sky-500" />}
                      label={t('taskDetail.timeline.inProduction')}
                      value={fmt(detail.inProductionAt)}
                    />
                  )}
                  <Timeline
                    icon={<Clock size={11} />}
                    label={t('taskDetail.timeline.assigned')}
                    value={fmt(detail.designerAssignedAt)}
                  />
                  <Timeline
                    icon={<Clock size={11} />}
                    label={t('taskDetail.timeline.started')}
                    value={fmt(detail.designerStartedAt)}
                  />
                  <Timeline
                    icon={<CheckCircle2 size={11} className="text-emerald-600" />}
                    label={t('taskDetail.timeline.completed')}
                    value={fmt(detail.designerCompletedAt)}
                  />
                  {detail.designerReworkAt && (
                    <Timeline
                      icon={<RotateCcw size={11} className="text-amber-600" />}
                      label={`${t('taskDetail.timeline.rework')} ${detail.designerReworkCount ? `×${detail.designerReworkCount}` : ''}`}
                      value={fmt(detail.designerReworkAt)}
                    />
                  )}
                  {detail.designerRejectedAt && (
                    <Timeline
                      icon={<XCircle size={11} className="text-rose-600" />}
                      label={t('taskDetail.timeline.rejected')}
                      value={fmt(detail.designerRejectedAt)}
                    />
                  )}
                </div>
              </div>

              {detail.productionError && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-2.5">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1">
                    <ShieldAlert size={12} /> {t('taskDetail.productionErrorLabel', { label: productionErrorLabel })}
                  </p>
                  {detail.productionErrorNote && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">{detail.productionErrorNote}</p>
                  )}
                </div>
              )}

              {(errorFileLabels.length > 0 || detail.errorFileNote) && (
                <div className="rounded-md border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 p-2.5">
                  <p className="text-xs font-medium text-violet-800 dark:text-violet-200 flex items-center gap-1">
                    <FileWarning size={12} /> {t('taskDetail.errorFileTitle')}
                  </p>
                  {errorFileLabels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {errorFileLabels.map((label, i) => (
                        <span
                          key={`${label}-${i}`}
                          className="rounded border border-violet-300 bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                  {detail.errorFileNote && (
                    <p className="text-[11px] text-violet-700 dark:text-violet-300 mt-1.5">
                      <span className="font-medium">{t('taskDetail.errorFileNoteLabel')} </span>
                      {detail.errorFileNote}
                    </p>
                  )}
                </div>
              )}

              {detail.designerRejectedReason && (
                <div className="rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-900/20 p-2.5">
                  <p className="text-xs font-medium text-rose-800 dark:text-rose-200">
                    {t('taskDetail.rejectedReasonTitle')}
                  </p>
                  <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">{detail.designerRejectedReason}</p>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {/* Báo khách lỗi file qua OnosPod (Orders.md §9f) — BE chặn cùng role. */}
            {detail && canReportIssue(roleName) && (
              <Button variant="outline" onClick={() => setReportOpen(true)}>
                <MessageSquareWarning size={14} className="mr-2" /> {t('orders:rowActionsMenu.reportIssue')}
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              {t('common:actions.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ReportIssueDialog order={detail} open={reportOpen} onOpenChange={setReportOpen} />
    </>
  );
}

function Field({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</p>
      <div className="flex items-center gap-1">
        <p className={`text-foreground ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
        {copyable && value && <CopyButton value={value} label={label} iconSize={10} />}
      </div>
    </div>
  );
}

function Timeline({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 py-1">
      <span className="shrink-0">{icon}</span>
      <span className="text-muted-foreground flex-1">{label}</span>
      <span className="text-foreground font-mono">{value}</span>
    </div>
  );
}
