import React from 'react';
import { useTranslation } from 'react-i18next';
import { PauseCircle, ScanLine, Undo2 } from 'lucide-react';

import { cn } from '@/utils/cn';

import type { DtfFlowNodeId, DtfRoleId } from './dtfGuideRoles';
import { isDtfRoleId } from './dtfGuideRoles';

type ConnectorDir = 'right' | 'down' | 'up';
type ConnectorTone = 'default' | 'ok' | 'error';

interface Connector {
  dir: ConnectorDir;
  dashed?: boolean;
  /** Khoá `flow.edges.<label>`. */
  label?: string;
  tone?: ConnectorTone;
}

interface FlowCell {
  node: DtfFlowNodeId;
  col: number;
  row: 1 | 2;
  span?: number;
  connectors?: Connector[];
}

/**
 * Sơ đồ luồng liên vai theo DtfRoleGuide-Storyboard.md §3. Lưới 8 cột × 2 hàng:
 * hàng 1 = luồng thuận (Đơn vào → Support → In → Ép → QC → May tự xong → Đóng hàng → Hoàn thành);
 * hàng 2 = nhánh soát lỗi (Support ↓ Leader → Designer ↑ In) + ô Quản lý.
 * Nhánh đẩy về khi báo lỗi vẽ thành danh sách `BACK_EDGES` bên dưới (nét đứt).
 */
const CELLS: FlowCell[] = [
  { node: 'import', col: 1, row: 1, connectors: [{ dir: 'right' }] },
  {
    node: 'support',
    col: 2,
    row: 1,
    connectors: [
      { dir: 'right', label: 'ok', tone: 'ok' },
      { dir: 'down', label: 'error', tone: 'error' },
    ],
  },
  { node: 'fulfillment-print', col: 3, row: 1, connectors: [{ dir: 'right' }] },
  { node: 'fulfillment-press', col: 4, row: 1, connectors: [{ dir: 'right' }] },
  { node: 'fulfillment-qc-post-press', col: 5, row: 1, connectors: [{ dir: 'right', dashed: true, label: 'auto' }] },
  { node: 'sew', col: 6, row: 1, connectors: [{ dir: 'right', dashed: true }] },
  { node: 'fulfillment-pack', col: 7, row: 1, connectors: [{ dir: 'right' }] },
  { node: 'done', col: 8, row: 1 },
  { node: 'designer-leader', col: 2, row: 2, connectors: [{ dir: 'right', label: 'assign' }] },
  { node: 'designer', col: 3, row: 2, connectors: [{ dir: 'up', label: 'designDone', tone: 'ok' }] },
  { node: 'admin', col: 5, row: 2, span: 4 },
];

/** Đẩy về khi báo lỗi — chữ ở `flow.back.items.<key>`, bấm → mở vai báo lỗi (`from`). */
const BACK_EDGES: { key: string; from: DtfRoleId }[] = [
  { key: 'printTool', from: 'fulfillment-print' },
  { key: 'printDesigner', from: 'fulfillment-print' },
  { key: 'press', from: 'fulfillment-press' },
  { key: 'qc', from: 'fulfillment-qc-post-press' },
  { key: 'pack', from: 'fulfillment-pack' },
];

const COL_START: Record<number, string> = {
  1: 'col-start-1',
  2: 'col-start-2',
  3: 'col-start-3',
  4: 'col-start-4',
  5: 'col-start-5',
  6: 'col-start-6',
  7: 'col-start-7',
  8: 'col-start-8',
};

const TONE_STROKE: Record<ConnectorTone, string> = {
  default: 'stroke-muted-foreground',
  ok: 'stroke-emerald-600',
  error: 'stroke-red-500',
};

const TONE_TEXT: Record<ConnectorTone, string> = {
  default: 'text-muted-foreground',
  ok: 'text-emerald-700 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
};

function ConnectorArrow({ connector, label }: { connector: Connector; label?: string }) {
  const { dir, dashed, tone = 'default' } = connector;
  const stroke = cn(TONE_STROKE[tone]);
  const dash = dashed ? '4 3' : undefined;

  if (dir === 'right') {
    return (
      <span aria-hidden className="pointer-events-none absolute left-full top-1/2 h-3 w-10 -translate-y-1/2">
        <svg className="h-3 w-10 overflow-visible" viewBox="0 0 40 12" preserveAspectRatio="none">
          <line x1="3" y1="6" x2="35" y2="6" strokeWidth="1.5" strokeDasharray={dash} className={stroke} />
          <path d="M31 2 L37 6 L31 10" fill="none" strokeWidth="1.5" className={stroke} />
        </svg>
        {label && (
          <span
            className={cn(
              'absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium',
              TONE_TEXT[tone],
            )}
          >
            {label}
          </span>
        )}
      </span>
    );
  }

  const up = dir === 'up';
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-1/2 h-16 w-3 -translate-x-1/2',
        up ? 'bottom-full' : 'top-full',
      )}
    >
      <svg className="h-16 w-3 overflow-visible" viewBox="0 0 12 64" preserveAspectRatio="none">
        <line x1="6" y1="3" x2="6" y2="61" strokeWidth="1.5" strokeDasharray={dash} className={stroke} />
        <path
          d={up ? 'M2 9 L6 3 L10 9' : 'M2 55 L6 61 L10 55'}
          fill="none"
          strokeWidth="1.5"
          className={stroke}
        />
      </svg>
      {label && (
        <span
          className={cn(
            'absolute left-full top-1/2 ml-1.5 w-28 -translate-y-1/2 text-[11px] font-medium leading-tight',
            TONE_TEXT[tone],
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

interface DtfFlowDiagramProps {
  activeRole: DtfRoleId;
  onSelect: (role: DtfRoleId) => void;
}

function DtfFlowDiagram({ activeRole, onSelect }: DtfFlowDiagramProps) {
  const { t } = useTranslation('dtfGuide');

  return (
    <section aria-labelledby="dtf-flow-title" className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="dtf-flow-title" className="text-base font-semibold text-foreground">
          {t('flow.title')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('flow.hint')}</p>
      </div>

      <div className="mt-4 overflow-x-auto overscroll-x-contain pb-2" role="group" aria-label={t('flow.ariaLabel')}>
        {/* Bề rộng tối thiểu vừa cột nội dung 1440px (sidebar mở); hẹp hơn thì khung cuộn ngang. Nhãn mũi tên dọc
            (`w-28`) cần khoảng cách tâm 2 cột ≥ ~120px → không hạ min-w dưới 64rem. */}
        <ol className="grid w-full min-w-[64rem] grid-cols-8 gap-x-10 gap-y-16 px-1 pb-1 pt-4">
          {CELLS.map((cell) => {
            const isRole = isDtfRoleId(cell.node);
            const isActive = cell.node === activeRole;
            const auto = cell.node === 'sew';
            const content = (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`flow.nodes.${cell.node}.who`)}
                </span>
                <span className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
                  {t(`flow.nodes.${cell.node}.title`)}
                </span>
                <span className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {t(`flow.nodes.${cell.node}.desc`)}
                </span>
              </>
            );
            return (
              <li
                key={cell.node}
                className={cn(
                  'relative min-w-0',
                  COL_START[cell.col],
                  cell.row === 1 ? 'row-start-1' : 'row-start-2',
                  cell.span === 4 && 'col-span-4',
                )}
              >
                {isRole ? (
                  <button
                    type="button"
                    onClick={() => onSelect(cell.node as DtfRoleId)}
                    aria-pressed={isActive}
                    className={cn(
                      'flex h-full w-full flex-col items-start rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive ? 'border-primary ring-2 ring-primary/25' : 'border-border',
                    )}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    className={cn(
                      'flex h-full w-full flex-col items-start rounded-lg border border-dashed px-3 py-2.5',
                      auto ? 'border-muted-foreground/50 bg-muted/30' : 'border-border bg-muted/50',
                    )}
                  >
                    {content}
                  </div>
                )}
                {cell.connectors?.map((c) => (
                  <ConnectorArrow
                    key={`${c.dir}-${c.label ?? ''}`}
                    connector={c}
                    label={c.label ? t(`flow.edges.${c.label}`) : undefined}
                  />
                ))}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-1 text-xs text-muted-foreground sm:hidden">{t('flow.scrollHint')}</p>

      <div className="mt-4 rounded-lg border border-dashed border-red-300 bg-red-50/40 p-3 dark:border-red-900/60 dark:bg-red-950/20">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Undo2 size={15} className="shrink-0 text-red-500" aria-hidden />
          {t('flow.back.title')}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('flow.back.desc')}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BACK_EDGES.map((edge) => (
            <li key={edge.key} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(edge.from)}
                className="flex h-full w-full flex-col items-start rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="break-words font-medium text-foreground">
                  {t(`flow.back.items.${edge.key}.from`)}
                  <span aria-hidden className="mx-1.5 text-red-500">
                    ⇢
                  </span>
                  <span className="sr-only"> → </span>
                  {t(`flow.back.items.${edge.key}.to`)}
                </span>
                <span className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
                  {t(`flow.back.items.${edge.key}.how`)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ul className="mt-3 grid gap-2 text-xs leading-relaxed text-muted-foreground md:grid-cols-2">
        <li className="flex gap-2">
          <PauseCircle size={15} className="mt-px shrink-0 text-amber-600" aria-hidden />
          <span className="min-w-0 break-words">{t('flow.crosscut.hold')}</span>
        </li>
        <li className="flex gap-2">
          <ScanLine size={15} className="mt-px shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 break-words">{t('flow.crosscut.scan')}</span>
        </li>
      </ul>
    </section>
  );
}

export default DtfFlowDiagram;
