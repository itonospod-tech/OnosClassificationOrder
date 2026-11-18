import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CheckCircle2, RefreshCw, UserRound } from 'lucide-react';
import type { FulfillmentTransitionDto, ProductionOrderRow, UrgentOrder } from 'shared';
import {
  factoryAllowsToolCheckRework,
  FULFILLMENT_STAGES,
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
import { FulfillmentTaskCard } from '@/pages/fulfillment/my-tasks/FulfillmentTaskCard';
import { PackWeightDialog } from '@/pages/fulfillment/my-tasks/PackWeightDialog';
import { ReworkBackDialog } from '@/pages/fulfillment/my-tasks/ReworkBackDialog';

import { FulfillmentScanActionDialog } from '../scan-error/FulfillmentScanActionDialog';
import { OrderErrorScanDialog } from '../scan-error/OrderErrorScanDialog';

type UrgentRow = ProductionOrderRow &
  Pick<UrgentOrder, 'holderName'> & { factory?: { name?: string; shortName?: string } };

/**
 * Bảng chia theo HÀNG CÔNG ĐOẠN (Orders.md §17.6): hàng "Thiết kế" (chưa vào xưởng) + 6 hàng
 * fulfillment theo thứ tự chuyền, mỗi hàng 3 ô Chờ · Đang làm · Làm lại. Mỗi đơn nằm đúng 1 ô
 * = chỗ đơn đang đứng, nên đơn ở hàng Ép trở xuống tức là đã In xong — không còn lẫn đơn chờ In
 * với đơn đã in đang chờ khâu sau như bản 5 ô cũ.
 */
type RowKey = 'design' | FulfillmentStage;
type CellKey = 'waiting' | 'in-progress' | 'rework';
const ROW_ORDER: RowKey[] = ['design', ...FULFILLMENT_STAGES];
const CELLS: CellKey[] = ['waiting', 'in-progress', 'rework'];

const REFRESH_MS = 60_000;

type Place = { row: RowKey; cell: CellKey } | 'done';

/**
 * Chỗ đơn đang đứng. Đang mang lỗi thiết kế/tool (designer `rework` hoặc `toolResultNote='error'`)
 * → hàng Thiết kế ô Làm lại (đứng TRƯỚC mọi công đoạn, như `upstreamClauses` của kanban);
 * có công đoạn hiện tại → hàng công đoạn đó theo status; còn lại chưa vào xưởng.
 */
function placeOf(o: UrgentRow): Place {
  if (o.fulfillmentCompletedAt) return 'done';
  if (o.designerStatus === 'rework' || o.toolResultNote === 'error') return { row: 'design', cell: 'rework' };
  const stage = o.currentFulfillmentStage as FulfillmentStage | undefined;
  if (stage) {
    const status = o.fulfillmentStages?.[stage]?.status;
    if (status === FulfillmentStageStatus.Rework) return { row: stage, cell: 'rework' };
    if (status === FulfillmentStageStatus.InProgress) return { row: stage, cell: 'in-progress' };
    return { row: stage, cell: 'waiting' };
  }
  return { row: 'design', cell: o.designerStatus === 'in-progress' ? 'in-progress' : 'waiting' };
}

/** Mức ưu tiên cao trước, rồi vào sản xuất lâu nhất trước (thiếu `inProductionAt` → `createdAt`). */
function compareUrgent(a: UrgentRow, b: UrgentRow): number {
  const p = (b.priority ?? 0) - (a.priority ?? 0);
  if (p !== 0) return p;
  const at = (o: UrgentRow) => new Date(String(o.inProductionAt || o.createdAt || 0)).getTime();
  return at(a) - at(b);
}

/** Nhãn ô ghi rõ tên khâu: "Chờ In", "Đang Ép"... — May xuất ra đang chờ = hàng đang ở bên may. */
function cellLabel(t: TFunction<'orderLog'>, row: RowKey, cell: CellKey): string {
  if (row === 'design') return t(`urgentPage.designCells.${cell}`);
  if (row === FulfillmentStage.SewOut && cell === 'waiting') return t('urgentPage.sewOutWaiting');
  const stage = getStageLabel(t, row);
  if (cell === 'waiting') return t('urgentPage.cells.waiting', { stage });
  if (cell === 'in-progress') return t('urgentPage.cells.inProgress', { stage });
  return t('urgentPage.cells.rework', { stage });
}

const CELL_ACCENT: Record<CellKey, string> = {
  waiting: 'border-zinc-200 dark:border-zinc-700',
  'in-progress': 'border-indigo-300 dark:border-indigo-700',
  rework: 'border-rose-300 dark:border-rose-700',
};

/**
 * Bảng "Đơn Làm ngay": chỉ đơn mức 4, chia theo hàng công đoạn × 3 ô (xem `placeOf`). Hàng trống
 * thu gọn còn 1 dòng; công nhân thấy hàng công đoạn của mình ĐẦU TIÊN và tô nổi. Thẻ dùng lại
 * `FulfillmentTaskCard` với `myStage` = công đoạn của hàng (giờ/hạn đúng khâu đó); thao tác đi qua
 * đúng endpoint/dialog của kanban Task Fulfillment (`POST /fulfillment/:id/transition`, popup quét)
 * nên quyền do BE quyết — công nhân chỉ có nút ở đơn đang đứng đúng công đoạn + xưởng của mình,
 * người khác bấm thẻ chỉ mở chi tiết đơn.
 */
export function UrgentOrdersBoard() {
  const { t } = useTranslation('orderLog');
  const { t: tf } = useTranslation(['fulfillmentWorkflow', 'common']);
  const urgencyMeta = useMemo(() => buildUrgencyMeta(t), [t]);

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

  const { grid, done } = useMemo(() => {
    const g = Object.fromEntries(
      ROW_ORDER.map((r) => [r, { waiting: [], 'in-progress': [], rework: [] } as Record<CellKey, UrgentRow[]>]),
    ) as Record<RowKey, Record<CellKey, UrgentRow[]>>;
    const d: UrgentRow[] = [];
    for (const o of rows) {
      const place = placeOf(o);
      if (place === 'done') d.push(o);
      else g[place.row][place.cell].push(o);
    }
    for (const r of ROW_ORDER) for (const c of CELLS) g[r][c].sort(compareUrgent);
    // Đã xong: mới đóng hàng nhất lên đầu.
    d.sort((a, b) => String(b.fulfillmentCompletedAt ?? '').localeCompare(String(a.fulfillmentCompletedAt ?? '')));
    return { grid: g, done: d };
  }, [rows]);

  // Công nhân: hàng công đoạn của mình lên đầu, các hàng khác giữ thứ tự chuyền.
  const rowOrder = useMemo(
    () => (myStage ? [myStage, ...ROW_ORDER.filter((r) => r !== myStage)] : ROW_ORDER),
    [myStage],
  );

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

  /** `row` = hàng chứa thẻ ('done' = khu Đã xong) — quyết định giờ/hạn của khâu nào hiện trên thẻ. */
  const renderCard = (o: UrgentRow, row: RowKey | 'done', cell: CellKey | 'done') => {
    const mine = isMyTask(o);
    const urg = urgencyMeta[urgencyOf(o.inProductionAt ? String(o.inProductionAt) : undefined)];
    // Đã xong → mốc Đóng hàng (khâu Đóng hàng chưa ghi xong thì ẩn, tránh báo quá hạn);
    // chưa vào xưởng → không có công đoạn nên ẩn giờ/hạn.
    const cardStage = row === 'done' ? FulfillmentStage.Pack : row === 'design' ? FulfillmentStage.Print : row;
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
          myStage={cardStage}
          colKey={cell}
          disableDrag
          hideStageTime={
            row === 'design' || (row === 'done' && o.fulfillmentStages?.pack?.status !== FulfillmentStageStatus.Done)
          }
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

  const renderRow = (row: RowKey) => {
    const cells = grid[row];
    const total = CELLS.reduce((n, c) => n + cells[c].length, 0);
    const isMine = row === myStage;
    const title = row === 'design' ? t('urgentPage.designRow') : getStageLabel(t, row);
    // Hàng trống thu gọn còn header (trừ hàng của chính công nhân — luôn mở để thấy "Chờ 0 · Đang 0").
    const collapsed = total === 0 && !isMine;
    return (
      <section
        key={row}
        className={cn(
          'rounded-lg border bg-muted/20',
          isMine ? 'border-primary ring-1 ring-primary/40' : 'border-border',
        )}
      >
        <header className={cn('flex items-center gap-2 px-3 py-2', !collapsed && 'border-b border-border/60')}>
          <h3 className={cn('text-sm font-semibold', collapsed ? 'text-muted-foreground' : 'text-foreground')}>
            {title}
          </h3>
          {isMine && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              {t('urgentPage.myStage')}
            </span>
          )}
          {!collapsed &&
            CELLS.map((c) => (
              <span key={c} className="hidden md:inline text-[11px] text-muted-foreground">
                · {cellLabel(t, row, c)} <span className="font-mono text-foreground">{cells[c].length}</span>
              </span>
            ))}
          <span
            className={cn(
              'ml-auto font-mono text-xs rounded-full px-2 py-0.5 border border-border',
              collapsed ? 'text-muted-foreground' : 'bg-background',
            )}
          >
            {total}
          </span>
        </header>
        {!collapsed && (
          <div className="grid grid-cols-1 md:grid-cols-3 items-start gap-2 p-2">
            {CELLS.map((c) => (
              <div key={c} className={cn('rounded-md border-2 bg-background/60 flex flex-col min-h-0', CELL_ACCENT[c])}>
                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border/60">
                  <span className="text-xs font-semibold text-foreground">{cellLabel(t, row, c)}</span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">{cells[c].length}</span>
                </div>
                <div className="max-h-[360px] overflow-y-auto p-1.5 space-y-1.5">
                  {cells[c].length === 0 ? (
                    <div className="py-3 text-center text-[11px] text-muted-foreground">—</div>
                  ) : (
                    cells[c].map((o) => renderCard(o, row, c))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('urgentPage.total', { count: rows.length - done.length })}
          </span>
          {loading && rows.length === 0 && <Spinner size={13} />}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner size={13} /> : <RefreshCw size={13} />} {t('urgentPage.reload')}
          </Button>
        </div>

        <div className="space-y-2">{rowOrder.map(renderRow)}</div>

        <section className="rounded-lg border-2 border-emerald-300 dark:border-emerald-700 bg-muted/20">
          <header
            className="flex items-center gap-2 px-3 py-2 border-b border-border/60"
            title={t('urgentPage.doneHint')}
          >
            <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-semibold text-foreground">{t('urgentPage.done')}</h3>
            <span className="ml-auto font-mono text-xs rounded-full bg-background px-2 py-0.5 border border-border">
              {done.length}
            </span>
          </header>
          <div className="max-h-[360px] overflow-y-auto p-2">
            {done.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground">{t('urgentPage.empty')}</div>
            ) : (
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {done.map((o) => renderCard(o, 'done', 'done'))}
              </div>
            )}
          </div>
        </section>

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
