import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle2, History, Keyboard, Loader2, Printer, ScanLine, Trash2, XCircle } from 'lucide-react';
import type { FulfillmentStage, ProductionOrderRow } from 'shared';
import { toast } from 'sonner';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';
import { useWorkshopConfigStore } from '@/store/workshopConfigStore';

import { RepositoryRemote } from '@/services';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { cn } from '@/utils/cn';
import { beepError, beepScan, parseScanCode } from '@/utils/scanCodes';

import { usePermission } from '@/hooks/usePermission';

import { ActionCodeSheetPrint } from './ActionCodeSheetPrint';
import { FulfillmentScanActionDialog } from './FulfillmentScanActionDialog';
import { OrderErrorScanDialog } from './OrderErrorScanDialog';

const MAX_HISTORY = 10;
const MODE_STORAGE_KEY = 'scan-error-mode';
const BARCODE_PREFIX = 'N-';

type ScanMode = 'barcode' | 'normal';

/**
 * Bóc prefix `N-` khi mode=barcode. Máy quét USB output dạng "N-PROD1234<Enter>"
 * nhưng DB lưu `productionId` không có prefix → phải strip mới match.
 * Mode=normal giữ nguyên (user gõ trực tiếp Production ID).
 */
function normalizeCode(raw: string, mode: ScanMode): string {
  const trimmed = raw.trim();
  if (mode !== 'barcode') return trimmed;
  // Bắt cả prefix viết HOA lẫn thường ("N-" và "n-") — máy quét có thể xuất
  // chữ thường tuỳ cấu hình. So sánh case-insensitive rồi mới strip.
  if (trimmed.slice(0, BARCODE_PREFIX.length).toUpperCase() === BARCODE_PREFIX) {
    return trimmed.slice(BARCODE_PREFIX.length).trim();
  }
  return trimmed;
}

type ScannedOrder = ProductionOrderRow & {
  factory?: { name?: string; shortName?: string };
  machineType?: { name?: string; shortName?: string };
};

interface HistoryEntry {
  id: string;
  productionId: string;
  at: Date;
  /** `success` = đã gán lỗi; `completed` = đã hoàn thành công đoạn (2 thao tác
   *  khác hẳn nhau — trước đây cùng gắn nhãn "Đã gán lỗi"). */
  status: 'success' | 'completed' | 'not-found' | 'error';
  message?: string;
}

export default function OrdersScanErrorPage() {
  const { has, isAdmin } = usePermission();

  if (!isAdmin && !has('page.scan_error')) {
    return <Navigate to={PATHS.ORDERS} replace />;
  }

  return <ScanErrorPageContent />;
}

function ScanErrorPageContent() {
  const { t } = useTranslation('scanError');
  // User Fulfillment → có fulfillmentStage → bật chế độ "Hoàn thành công đoạn".
  // User không có stage (admin/support…) → giữ luồng gán lỗi như cũ.
  const profile = useAuthStore((s) => s.profile);
  const myStage = profile?.fulfillmentStage as FulfillmentStage | undefined;
  const myFactoryId = profile?.factoryId;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<ScannedOrder | null>(null);
  // Khi user Fulfillment bấm "Báo lỗi" trong dialog công đoạn → chuyển sang
  // dialog gán lỗi cho cùng đơn đó.
  const [errorMode, setErrorMode] = useState(false);
  // Mã lỗi quét LẦN 1 từ dialog công đoạn → pre-select trong dialog gán lỗi,
  // chờ quét lần 2 cùng mã (hoặc Enter) để xác nhận.
  const [preselectedCode, setPreselectedCode] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Sheet bảng mã hành động — mount lúc in rồi tự gỡ (xem ActionCodeSheetPrint).
  const [printingActionSheet, setPrintingActionSheet] = useState(false);
  const [mode, setMode] = useState<ScanMode>(() => {
    if (typeof window === 'undefined') return 'barcode';
    const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
    return saved === 'normal' ? 'normal' : 'barcode';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    }
  }, [mode]);

  const loadConfig = useWorkshopConfigStore((s) => s.load);
  const configLoaded = useWorkshopConfigStore((s) => s.loaded);

  useEffect(() => {
    if (!configLoaded) loadConfig();
  }, [configLoaded, loadConfig]);

  // Auto-focus input mỗi khi modal đóng.
  useEffect(() => {
    if (!order) {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [order]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
  }, []);

  const handleLookup = useCallback(
    async (raw: string) => {
      const code = normalizeCode(raw, mode);
      if (!code) return;
      if (loading) return;
      // Quét nhầm mã hành động (OK / E-… / ACT-…) khi CHƯA có đơn đang chờ → nhắc quét đơn trước.
      const action = parseScanCode(code);
      if (action.kind === 'ok' || action.kind === 'error' || action.kind === 'action') {
        beepError();
        toast.error(t('page.scanOrderFirst'));
        setValue('');
        return;
      }
      setLoading(true);
      try {
        const res = await RepositoryRemote.order.getByProductionId(code);
        const data = res.data?.data as ScannedOrder | undefined;
        if (!data?._id) {
          beepError();
          toast.error(t('page.notFound'));
          pushHistory({
            id: `${Date.now()}`,
            productionId: code,
            at: new Date(),
            status: 'not-found',
          });
          setValue('');
          return;
        }
        beepScan();
        setOrder(data);
        setValue('');
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const msg = axios.isAxiosError(err)
          ? (err.response?.data as { message?: string })?.message || err.message
          : (err as Error).message;
        beepError();
        if (status === 404) {
          toast.error(msg || t('page.notFound'));
        } else {
          toast.error(msg || t('page.lookupError'));
        }
        pushHistory({
          id: `${Date.now()}`,
          productionId: code,
          at: new Date(),
          status: status === 404 ? 'not-found' : 'error',
          message: msg,
        });
        setValue('');
      } finally {
        setLoading(false);
      }
    },
    [loading, mode, pushHistory, t],
  );

  const onSaved = useCallback(
    (summary: { errorName: string; targetLabel: string }) => {
      if (!order) return;
      pushHistory({
        id: `${Date.now()}`,
        productionId: order.productionId,
        at: new Date(),
        status: 'success',
        message: `${summary.errorName} · ${summary.targetLabel}`,
      });
    },
    [order, pushHistory],
  );

  const onCompleted = useCallback(
    (summary: { stageLabel: string }) => {
      if (!order) return;
      pushHistory({
        id: `${Date.now()}`,
        productionId: order.productionId,
        at: new Date(),
        status: 'completed',
        message: t('page.completedMsg', { stage: summary.stageLabel }),
      });
    },
    [order, pushHistory, t],
  );

  const onClose = useCallback(() => {
    setOrder(null);
    setErrorMode(false);
    setPreselectedCode(null);
    // re-focus input handled by useEffect khi order = null
  }, []);

  // Quét barcode ĐƠN khác khi dialog đang mở → đóng dialog + tra cứu đơn mới luôn.
  const onScanOrder = useCallback(
    (code: string) => {
      setOrder(null);
      setErrorMode(false);
      setPreselectedCode(null);
      void handleLookup(code);
    },
    [handleLookup],
  );

  // Quét mã lỗi lần 1 (đã validate thuộc công đoạn user ở dialog công đoạn) →
  // chuyển sang dialog gán lỗi với mã chọn sẵn.
  const onScanError = useCallback((code: string) => {
    beepScan();
    setPreselectedCode(code);
    setErrorMode(true);
  }, []);

  const stats = useMemo(() => {
    return {
      total: history.length,
      success: history.filter((h) => h.status === 'success' || h.status === 'completed').length,
      notFound: history.filter((h) => h.status === 'not-found').length,
      error: history.filter((h) => h.status === 'error').length,
    };
  }, [history]);

  return (
    <div className="container mx-auto py-6 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-300">
          <ScanLine size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold">{myStage ? t('page.titleStage') : t('page.titleGeneric')}</h1>
          <p className="text-sm text-muted-foreground">{myStage ? t('page.descStage') : t('page.descGeneric')}</p>
        </div>
        {/* In bảng mã hành động (OK / ACT-*) dán tại trạm — điều khiển popup bằng máy quét. */}
        <Button variant="outline" onClick={() => setPrintingActionSheet(true)} disabled={printingActionSheet}>
          <Printer size={15} className="mr-1.5" />
          {t('actionSheet.printBtn')}
        </Button>
      </div>

      {/* Scan box */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('page.modeLabel')}</span>
          <div className="inline-flex rounded-md border bg-muted/50 p-0.5">
            <ModeButton
              active={mode === 'barcode'}
              onClick={() => setMode('barcode')}
              icon={<ScanLine size={13} />}
              label={t('page.modeBarcode')}
              hint={t('page.modeBarcodeHint', { prefix: BARCODE_PREFIX })}
            />
            <ModeButton
              active={mode === 'normal'}
              onClick={() => setMode('normal')}
              icon={<Keyboard size={13} />}
              label={t('page.modeManual')}
              hint={t('page.modeManualHint')}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            {mode === 'barcode' ? (
              <ScanLine
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            ) : (
              <Keyboard
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            )}
            <Input
              ref={inputRef}
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleLookup(value);
                }
              }}
              placeholder={
                mode === 'barcode' ? t('page.placeholderBarcode', { prefix: BARCODE_PREFIX }) : t('page.placeholderManual')
              }
              className="pl-9 pr-3 h-11 text-sm font-mono"
              disabled={loading || !!order}
            />
            {loading && (
              <Loader2
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin"
              />
            )}
          </div>
          <Button onClick={() => handleLookup(value)} disabled={!value.trim() || loading || !!order}>
            {t('page.lookupBtn')}
          </Button>
        </div>

        {/* Preview chuỗi đã normalize — chỉ hiện khi user gõ/quét và mã sau strip
            khác mã đang nhập (cho biết hệ thống sẽ search bằng cái gì). */}
        {value.trim() &&
          (() => {
            const normalized = normalizeCode(value, mode);
            const changed = normalized !== value.trim();
            if (!changed && mode !== 'barcode') return null;
            return (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{t('page.willLookup')}</span>
                <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-foreground">
                  {normalized || t('page.empty')}
                </code>
                {changed && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {t('page.prefixStripped', { prefix: BARCODE_PREFIX })}
                  </span>
                )}
                {mode === 'barcode' && !changed && value.trim() && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {t('page.prefixMissingWarning', { prefix: BARCODE_PREFIX })}
                  </span>
                )}
              </div>
            );
          })()}

        <p className="text-[11px] text-muted-foreground">
          {mode === 'barcode' ? t('page.tipBarcode', { prefix: BARCODE_PREFIX }) : t('page.tipManual')}
        </p>
      </div>

      {/* Recent history */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2 text-sm font-medium">
            <History size={14} />
            {t('page.historyTitle')}
            <span className="text-muted-foreground font-normal">
              ({history.length}/{MAX_HISTORY})
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Stat label={t('page.statSuccess')} value={stats.success} color="emerald" />
            <Stat label={t('page.statNotFound')} value={stats.notFound} color="amber" />
            <Stat label={t('page.statError')} value={stats.error} color="rose" />
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setHistory([])}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Trash2 size={12} /> {t('page.clearBtn')}
              </button>
            )}
          </div>
        </div>
        {history.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{t('page.emptyHistory')}</div>
        ) : (
          <ul className="divide-y">
            {history.map((h) => (
              <HistoryRow key={h.id} entry={h} />
            ))}
          </ul>
        )}
      </div>

      {order &&
        (myStage && !errorMode ? (
          <FulfillmentScanActionDialog
            order={order}
            myStage={myStage}
            myFactoryId={myFactoryId}
            onClose={onClose}
            onCompleted={onCompleted}
            onReportError={() => setErrorMode(true)}
            onScanError={onScanError}
            onScanOrder={onScanOrder}
          />
        ) : (
          <OrderErrorScanDialog
            order={order}
            onClose={onClose}
            onSaved={onSaved}
            onScanOrder={onScanOrder}
            initialCode={preselectedCode ?? undefined}
          />
        ))}

      {printingActionSheet && <ActionCodeSheetPrint onDone={() => setPrintingActionSheet(false)} />}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm border border-border'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: 'emerald' | 'amber' | 'rose' }) {
  const cls = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
  }[color];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`font-semibold ${cls}`}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const { t, i18n } = useTranslation('scanError');
  const icon = {
    success: <CheckCircle2 size={14} className="text-emerald-500" />,
    completed: <CheckCircle2 size={14} className="text-emerald-500" />,
    'not-found': <XCircle size={14} className="text-amber-500" />,
    error: <XCircle size={14} className="text-rose-500" />,
  }[entry.status];

  const statusText = {
    success: t('page.historyStatusSuccess'),
    completed: t('page.historyStatusCompleted'),
    'not-found': t('page.historyStatusNotFound'),
    error: t('page.historyStatusError'),
  }[entry.status];

  return (
    <li className="flex items-start gap-2 p-2.5 text-xs">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{entry.productionId}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{statusText}</span>
        </div>
        {entry.message && <div className="text-muted-foreground truncate mt-0.5">{entry.message}</div>}
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {entry.at.toLocaleTimeString(i18n.language === 'en' ? 'en-US' : 'vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </li>
  );
}
