import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CheckCircle2, Clock, Eye, PlayCircle, RefreshCw, RotateCw, UserRound } from 'lucide-react';
import type { FulfillmentTransitionDto, ProductionOrderRow, UrgentOrder } from 'shared';
import {
  factoryAllowsToolCheckRework,
  FulfillmentStage,
  FulfillmentStageStatus,
  FulfillmentTransitionAction,
  RoleType,
} from 'shared';
import { toast } from 'sonner';

import { useAuthStore } from '@/store/authStore';
import { useFactoryOptionsStore } from '@/store/factoryOptionsStore';

import { RepositoryRemote } from '@/services';

import { ImagePreviewDialog } from '@/components/common/ImagePreviewDialog';
import { Spinner } from '@/components/common/Spinner';
import { OrderDetailDialog } from '@/components/orders/OrderDetailDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';
import { buildUrgencyMeta, formatDuration, urgencyOf } from '@/utils/errorLogUrgency';
import { getStageLabel } from '@/utils/fulfillmentStageLabel';

import { useFactoryScope } from '@/hooks/useFactoryScope';
import { FulfillmentTaskCard, type FulfillmentTaskCardProps } from '@/pages/fulfillment/my-tasks/FulfillmentTaskCard';
import { PackWeightDialog } from '@/pages/fulfillment/my-tasks/PackWeightDialog';
import { ReworkBackDialog } from '@/pages/fulfillment/my-tasks/ReworkBackDialog';

import { FulfillmentScanActionDialog } from '../scan-error/FulfillmentScanActionDialog';
import { OrderErrorScanDialog } from '../scan-error/OrderErrorScanDialog';

type UrgentRow = ProductionOrderRow &
  Pick<UrgentOrder, 'holderName'> & { factory?: { name?: string; shortName?: string } };

/** 5 ô = 5 cột kanban công nhân (Task Fulfillment). Hàng trên 2 ô, hàng dưới 3 ô. */
type BoxKey = 'waiting' | 'in-progress' | 'rework' | 'done' | 'watching';
const TOP_BOXES: BoxKey[] = ['waiting', 'in-progress'];
const BOTTOM_BOXES: BoxKey[] = ['rework', 'done', 'watching'];

const REFRESH_MS = 60_000;

/**
 * Ô của đơn theo VỊ TRÍ đơn (giống nhau với mọi người xem — Orders.md §17.6):
 *  - `done`: đóng hàng xong tuần này (BE chỉ trả đơn xong từ 0h VN thứ Hai).
 *  - `rework`: đang mang lỗi — designer làm lại, công đoạn hiện tại `rework`, hoặc lỗi chưa soát lại.
 *  - `in-progress`: công đoạn hiện tại đang làm, hoặc designer đang làm.
 *  - `waiting`: đã vào xưởng, đang chờ ở công đoạn hiện tại.
 *  - `watching`: chưa vào xưởng (soát tool / chờ thiết kế / chờ vào In).
 */
function boxOf(o: UrgentRow): BoxKey {
  if (o.fulfillmentCompletedAt) return 'done';
  const stage = o.currentFulfillmentStage as FulfillmentStage | undefined;
  const status = stage ? o.fulfillmentStages?.[stage]?.status : undefined;
  if (
    o.designerStatus === 'rework' ||
    status === FulfillmentStageStatus.Rework ||
    (!!o.productionError && o.toolResultNote === 'error')
  ) {
    return 'rework';
  }
  if (stage) return status === FulfillmentStageStatus.InProgress ? 'in-progress' : 'waiting';
  if (o.designerStatus === 'in-progress') return 'in-progress';
  return 'watching';
}

/** Mức ưu tiên cao trước, rồi vào sản xuất lâu nhất trước (thiếu `inProductionAt` → `createdAt`). */
function compareUrgent(a: UrgentRow, b: UrgentRow): number {
  const p = (b.priority ?? 0) - (a.priority ?? 0);
  if (p !== 0) return p;
  const at = (o: UrgentRow) => new Date(String(o.inProductionAt || o.createdAt || 0)).getTime();
  return at(a) - at(b);
}

/** Nơi đơn đang đứng — cùng nhãn với "Nhật ký bù lỗi" (`orderLog.stage.*`) + nhãn công đoạn. */
function positionLabel(o: UrgentRow, t: TFunction<'orderLog'>): string {
  if (o.fulfillmentCompletedAt) return t('urgentPage.position.completed');
  if (o.currentFulfillmentStage) return getStageLabel(t, o.currentFulfillmentStage);
  if (!o.toolResultNote) return t('stage.toolCheck');
  if (o.designerStatus === 'done') return t('urgentPage.position.printQueue');
  return t('stage.designer');
}

function buildBoxMeta(
  t: TFunction<'orderLog'>,
): Record<BoxKey, { label: string; hint: string; icon: React.ElementType; accent: string }> {
  return {
    waiting: {
      label: t('urgentPage.boxes.waiting'),
      hint: t('urgentPage.boxHints.waiting'),
      icon: Clock,
      accent: 'border-zinc-300 dark:border-zinc-700',
    },
    'in-progress': {
      label: t('urgentPage.boxes.inProgress'),
      hint: t('urgentPage.boxHints.inProgress'),
      icon: PlayCircle,
      accent: 'border-indigo-300 dark:border-indigo-700',
    },
    rework: {
      label: t('urgentPage.boxes.rework'),
      hint: t('urgentPage.boxHints.rework'),
      icon: RotateCw,
      accent: 'border-rose-300 dark:border-rose-700',
    },
    done: {
      label: t('urgentPage.boxes.done'),
      hint: t('urgentPage.boxHints.done'),
      icon: CheckCircle2,
      accent: 'border-emerald-300 dark:border-emerald-700',
    },
    watching: {
      label: t('urgentPage.boxes.watching'),
      hint: t('urgentPage.boxHints.watching'),
      icon: Eye,
      accent: 'border-sky-300 dark:border-sky-700',
    },
  };
}

/**
 * Bảng "Đơn Làm ngay": 5 ô kanban (trên 2 · dưới 3), chỉ đơn mức 4. Thẻ dùng lại
 * `FulfillmentTaskCard`; thao tác đi qua đúng endpoint/dialog của kanban Task Fulfillment
 * (`POST /fulfillment/:id/transition`, popup quét) nên quyền do BE quyết — công nhân chỉ có nút ở
 * đơn đang đứng đúng công đoạn + xưởng của mình, người khác bấm thẻ chỉ mở chi tiết đơn.
 */
export function UrgentOrdersBoard() {
  const { t } = useTranslation('orderLog');
  const { t: tf } = useTranslation(['fulfillmentWorkflow', 'common']);
  const urgencyMeta = useMemo(() => buildUrgencyMeta(t), [t]);
  const boxMeta = useMemo(() => buildBoxMeta(t), [t]);

  const profile = useAuthStore((s) => s.profile);
  const roleName = profile?.role?.name as string | undefined;
  const isWorker = roleName === RoleType.Fulfillment;
  const myStage = isWorker ? (profile?.fulfillmentStage as FulfillmentStage | undefined) : undefined;
  const myFactoryId = profile?.factoryId ? String(profile.factoryId) : '';
  const factoryScope = useFactoryScope();

  const factoryOptions = useFactoryOptionsStore((s) => s.factories);
  const loadFactoryOptions = useFactoryOptionsStore((s) => s.load);
  useEffect(() => {
    void loadFactoryOptions();
  }, [loadFactoryOptions]);
  const allowToolCheck = factoryAllowsToolCheckRework(factoryOptions, profile?.factoryId);

  const [rows, setRows] = useState<UrgentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string; original?: string } | null>(null);
  const [detail, setDetail] = useState<{ id: string; productionId: string } | null>(null);
  const [scanned, setScanned] = useState<UrgentRow | null>(null);
  const [scanErrorMode, setScanErrorMode] = useState(false);
  const [reworkOrder, setReworkOrder] = useState<UrgentRow | null>(null);
  const [packOrder, setPackOrder] = useState<UrgentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await RepositoryRemote.order.getUrgentOrders(
        factoryScope ? `?factoryId=${encodeURIComponent(factoryScope)}` : '',
      );
      setRows((res.data?.data ?? []) as UrgentRow[]);
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setLoading(false);
    }
  }, [factoryScope]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const boxes = useMemo(() => {
    const out: Record<BoxKey, UrgentRow[]> = { waiting: [], 'in-progress': [], rework: [], done: [], watching: [] };
    for (const o of rows) out[boxOf(o)].push(o);
    for (const k of Object.keys(out) as BoxKey[]) out[k].sort(compareUrgent);
    return out;
  }, [rows]);

  /** Công nhân thao tác được ngay trên thẻ — đúng điều kiện BE `transition` (công đoạn + xưởng mình, không giữ). */
  const isMyTask = (o: UrgentRow) =>
    !!myStage &&
    !o.heldAt &&
    !o.fulfillmentCompletedAt &&
    o.currentFulfillmentStage === myStage &&
    String(o.factoryId ?? '') === myFactoryId;

  // Cùng hàm gọi như kanban Task Fulfillment (`callTransition`).
  const callTransition = async (
    o: UrgentRow,
    action: FulfillmentTransitionAction,
    body?: Pick<FulfillmentTransitionDto, 'target' | 'reason' | 'weightGram' | 'dimensions'>,
  ) => {
    if (!myStage) return;
    try {
      await RepositoryRemote.fulfillment.transition(o._id, {
        stage: myStage,
        action,
        ...body,
      } as FulfillmentTransitionDto);
      toast.success(t('actions.updated'));
    } catch (err) {
      handleAxiosError(err);
    } finally {
      void load();
    }
  };

  const copyProductionId = async (o: UrgentRow) => {
    try {
      await navigator.clipboard.writeText(o.productionId);
      setCopiedId(o._id);
    } catch {
      toast.error(tf('toast.copyError'));
    }
  };

  // Bấm thẻ: công nhân → popup thao tác như khi quét mã trên kanban (đọc lại đơn mới nhất);
  // người khác → chi tiết đơn (như bấm mã đơn trên kanban).
  const openCard = async (o: UrgentRow) => {
    if (!myStage) {
      setDetail({ id: o._id, productionId: o.productionId });
      return;
    }
    try {
      const res = await RepositoryRemote.order.getByProductionId(o.productionId);
      const data = res.data?.data as UrgentRow | undefined;
      if (!data?._id) return;
      setScanErrorMode(false);
      setScanned(data);
    } catch (err) {
      handleAxiosError(err);
    }
  };

  const renderCard = (o: UrgentRow, box: BoxKey) => {
    const mine = isMyTask(o);
    const urg = urgencyMeta[urgencyOf(o.inProductionAt ? String(o.inProductionAt) : undefined)];
    const stage = (o.currentFulfillmentStage as FulfillmentStage | undefined) ?? FulfillmentStage.Print;
    // 'watching' của thẻ vẽ dòng "đang ở công đoạn…" theo nghĩa kanban (chờ quay lại) — ở đây nơi
    // đứng đã nằm trong dòng phụ nên dùng 'done' (chỉ hiển thị, không nút).
    const colKey: FulfillmentTaskCardProps['colKey'] = box === 'watching' ? 'done' : box;
    const factoryName = o.factory?.shortName || o.factory?.name;
    return (
      <div
        key={o._id}
        role="button"
        tabIndex={0}
        onClick={() => void openCard(o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void openCard(o);
        }}
        className={cn('cursor-pointer rounded-md', mine && 'ring-2 ring-primary/50')}
      >
        <FulfillmentTaskCard
          order={o}
          myStage={stage}
          colKey={colKey}
          disableDrag
          isCopied={copiedId === o._id}
          onCopyProductionId={() => void copyProductionId(o)}
          onPreview={(url, title, original) => setPreview({ url, title, original })}
          onClickProductionId={() => setDetail({ id: o._id, productionId: o.productionId })}
          onStart={mine ? () => void callTransition(o, FulfillmentTransitionAction.Start) : undefined}
          onComplete={
            mine
              ? () =>
                  myStage === FulfillmentStage.Pack
                    ? setPackOrder(o)
                    : void callTransition(o, FulfillmentTransitionAction.Complete)
              : undefined
          }
          onReportError={mine ? () => setReworkOrder(o) : undefined}
          extra={
            <div className="flex flex-wrap items-center gap-1 text-[10px]">
              <Badge className={cn('font-mono text-[10px] px-1.5 py-0', urg.cls)}>{urg.label}</Badge>
              <span className="font-mono text-muted-foreground" title={t('urgentPage.ageHint')}>
                {formatDuration(o.inProductionAt ? String(o.inProductionAt) : undefined)}
              </span>
              {factoryName && (
                <span className="font-mono px-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                  {factoryName}
                </span>
              )}
              <span className="px-1 rounded bg-muted text-foreground">{positionLabel(o, t)}</span>
              {o.holderName && (
                <span
                  className="inline-flex items-center gap-0.5 text-muted-foreground truncate max-w-[9rem]"
                  title={t('urgentPage.holder')}
                >
                  <UserRound size={10} /> {o.holderName}
                </span>
              )}
            </div>
          }
        />
      </div>
    );
  };

  const renderBox = (key: BoxKey, cardsPerRow: 1 | 2) => {
    const meta = boxMeta[key];
    const Icon = meta.icon;
    const list = boxes[key];
    return (
      <section key={key} className={cn('rounded-lg border-2 bg-muted/30 flex flex-col min-h-0', meta.accent)}>
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border/60" title={meta.hint}>
          <Icon size={15} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
          <span className="ml-auto font-mono text-xs rounded-full bg-background px-2 py-0.5 border border-border">
            {list.length}
          </span>
        </header>
        <div className="h-[420px] max-md:h-[60vh] overflow-y-auto p-2">
          {list.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              {loading ? <Spinner size={16} /> : t('urgentPage.empty')}
            </div>
          ) : (
            <div className={cn('grid gap-2', cardsPerRow === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
              {list.map((o) => renderCard(o, key))}
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('urgentPage.total', { count: rows.length - boxes.done.length })}
          </span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner size={13} /> : <RefreshCw size={13} />} {t('urgentPage.reload')}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{TOP_BOXES.map((k) => renderBox(k, 2))}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{BOTTOM_BOXES.map((k) => renderBox(k, 1))}</div>

        <ImagePreviewDialog
          open={!!preview}
          onOpenChange={(o) => !o && setPreview(null)}
          url={preview?.url}
          originalUrl={preview?.original}
          title={preview?.title}
        />

        <OrderDetailDialog
          open={!!detail}
          onOpenChange={(o) => !o && setDetail(null)}
          orderId={detail?.id ?? null}
          productionId={detail?.productionId}
        />

        <PackWeightDialog
          open={!!packOrder}
          productionId={packOrder?.productionId}
          onCancel={() => setPackOrder(null)}
          onConfirm={(value) => {
            const o = packOrder;
            setPackOrder(null);
            if (o) void callTransition(o, FulfillmentTransitionAction.Complete, value);
          }}
        />

        {reworkOrder && myStage && (
          <ReworkBackDialog
            order={reworkOrder}
            myStage={myStage}
            allowToolCheck={allowToolCheck}
            onClose={() => setReworkOrder(null)}
            onSubmit={async (target, reason) => {
              await callTransition(reworkOrder, FulfillmentTransitionAction.ReworkBack, { target, reason });
              setReworkOrder(null);
            }}
          />
        )}

        {scanned &&
          myStage &&
          (scanErrorMode ? (
            <OrderErrorScanDialog order={scanned} onClose={() => setScanned(null)} onSaved={() => void load()} />
          ) : (
            <FulfillmentScanActionDialog
              order={scanned}
              myStage={myStage}
              myFactoryId={profile?.factoryId}
              onClose={() => setScanned(null)}
              onCompleted={() => void load()}
              onReportError={() => setScanErrorMode(true)}
            />
          ))}
      </div>
    </TooltipProvider>
  );
}
