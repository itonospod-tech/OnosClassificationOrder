import type { TFunction } from 'i18next';
import type { FulfillmentStage, StageErrorReworkTarget, WorkshopConfig } from 'shared';
import { FULFILLMENT_STAGE_ORDER, FULFILLMENT_STAGES } from 'shared';

import { getStageLabel } from '@/utils/fulfillmentStageLabel';

/**
 * Format mã quét trong luồng "quét 2 bước" (xem StageErrorCatalog.md + ScanError.md):
 *   - Đơn hàng:  `N-<productionId>` (barcode in trên đơn — có sẵn)
 *   - Hoàn thành: `OK` (1 mã chung — hệ thống biết công đoạn qua profile)
 *   - Lỗi:       `E-<code>` (barcode Code128 in từ danh mục lỗi công đoạn, code dạng `se-<stage>-<n>`)
 *   - Hành động: `ACT-<lệnh>` (bảng mã dán tại trạm — điều khiển popup đơn đang mở
 *     hoàn toàn bằng máy quét: đóng popup / in tem khách / in label / báo lỗi)
 * Máy quét HID gõ payload + Enter vào element đang focus → parse theo tiền tố.
 */
export const SCAN_ORDER_PREFIX = 'N-';
export const SCAN_ERROR_PREFIX = 'E-';
export const SCAN_OK_CODE = 'OK';
export const SCAN_ACTION_PREFIX = 'ACT-';

/**
 * Lệnh điều khiển popup qua barcode `ACT-*`. `print-design` đã đặt chỗ trong
 * thiết kế (lấy file in tại trạm) nhưng CHƯA triển khai — chưa in ra sheet.
 */
export type ScanActionCommand = 'cancel' | 'print-tem' | 'print-label' | 'report-error' | 'stock-out';

const ACTION_COMMAND_BY_CODE: Record<string, ScanActionCommand> = {
  CANCEL: 'cancel',
  'PRINT-TEM': 'print-tem',
  'PRINT-LABEL': 'print-label',
  ERROR: 'report-error',
  // Trừ tồn kho theo đơn đang mở (Inventory-FactoryStock plan): quét lần 1 mở
  // khối xác nhận, quét `OK` chốt trừ; đơn đã trừ thì quét lặp = trừ rework.
  'STOCK-OUT': 'stock-out',
};

export type ScanAction =
  | { kind: 'order'; code: string }
  | { kind: 'ok' }
  | { kind: 'error'; code: string }
  | { kind: 'action'; command: ScanActionCommand }
  | { kind: 'unknown'; raw: string };

export function parseScanCode(raw: string): ScanAction {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (upper === SCAN_OK_CODE) return { kind: 'ok' };
  if (upper.startsWith(SCAN_ACTION_PREFIX)) {
    const command = ACTION_COMMAND_BY_CODE[upper.slice(SCAN_ACTION_PREFIX.length).trim()];
    if (command) return { kind: 'action', command };
    return { kind: 'unknown', raw: trimmed };
  }
  if (upper.startsWith(SCAN_ERROR_PREFIX)) {
    // Code lỗi lưu lowercase (`se-print-1`) — máy quét có thể xuất hoa/thường.
    return { kind: 'error', code: trimmed.slice(SCAN_ERROR_PREFIX.length).trim().toLowerCase() };
  }
  if (upper.startsWith(SCAN_ORDER_PREFIX)) {
    return { kind: 'order', code: trimmed.slice(SCAN_ORDER_PREFIX.length).trim() };
  }
  return { kind: 'unknown', raw: trimmed };
}

/**
 * Danh sách mã cho SHEET "bảng mã hành động" in dán tại trạm (kèm mã `OK` sẵn
 * có). `labelKey` trỏ vào namespace `scanError` → `actionSheet.codes.<key>.*`.
 */
export const ACTION_SHEET_CODES: { payload: string; labelKey: string }[] = [
  { payload: SCAN_OK_CODE, labelKey: 'ok' },
  { payload: `${SCAN_ACTION_PREFIX}CANCEL`, labelKey: 'cancel' },
  { payload: `${SCAN_ACTION_PREFIX}PRINT-TEM`, labelKey: 'printTem' },
  { payload: `${SCAN_ACTION_PREFIX}PRINT-LABEL`, labelKey: 'printLabel' },
  { payload: `${SCAN_ACTION_PREFIX}STOCK-OUT`, labelKey: 'stockOut' },
  { payload: `${SCAN_ACTION_PREFIX}ERROR`, labelKey: 'reportError' },
];

/** Payload in vào barcode (Code128) cho 1 lỗi trong danh mục. */
export function errorScanPayload(cfg: Pick<WorkshopConfig, 'code'>): string {
  return `${SCAN_ERROR_PREFIX}${cfg.code}`;
}

export type ErrorScanResolution =
  | {
      ok: true;
      /** Param `target` cho `setProductionError` — undefined = chỉ mark lỗi. */
      apiTarget?: 'designer' | 'tool-check' | FulfillmentStage;
      source: 'designer' | 'factory' | 'tool-check';
      targetLabel: string;
    }
  | { ok: false; reason: string };

/**
 * Từ config lỗi đã quét → suy đích đẩy về + nguồn lỗi (dùng chung 2 dialog quét).
 * `reworkTarget` (stage error) ưu tiên; lỗi chung fallback theo `errorSource`
 * ('factory' → chỉ mark lỗi). Target stage phải đứng TRƯỚC `furthest` (vị trí
 * xa nhất đơn từng tới; undefined = chưa vào fulfillment).
 */
export function resolveErrorScan(
  cfg: WorkshopConfig,
  furthest: FulfillmentStage | undefined,
  t: TFunction<'scanError'>,
): ErrorScanResolution {
  const target: StageErrorReworkTarget | undefined =
    (cfg.reworkTarget as StageErrorReworkTarget | undefined) ??
    (cfg.errorSource === 'tool-check' || cfg.errorSource === 'designer' ? cfg.errorSource : undefined);

  if (target === 'tool-check') {
    return { ok: true, apiTarget: 'tool-check', source: 'tool-check', targetLabel: t('resolve.toToolCheck') };
  }
  if (target === 'designer') {
    if (!furthest) return { ok: false, reason: t('resolve.notInFulfillmentForDesigner') };
    return { ok: true, apiTarget: 'designer', source: 'designer', targetLabel: t('resolve.toDesigner') };
  }
  if (target && FULFILLMENT_STAGES.includes(target)) {
    if (!furthest || FULFILLMENT_STAGE_ORDER[target] >= FULFILLMENT_STAGE_ORDER[furthest]) {
      return {
        ok: false,
        reason: t('resolve.cannotPushBack', {
          target: getStageLabel(t, target),
          current: furthest ? getStageLabel(t, furthest) : t('resolve.beforeFulfillment'),
        }),
      };
    }
    return {
      ok: true,
      apiTarget: target,
      source: 'factory',
      targetLabel: t('resolve.toStage', { stage: getStageLabel(t, target) }),
    };
  }
  return { ok: true, source: 'factory', targetLabel: t('resolve.markOnly') };
}

// ─── Beep feedback (WebAudio — không cần file asset, công nhân không cần nhìn màn hình) ───

let audioCtx: AudioContext | null = null;

function tone(freq: number, startMs: number, durMs: number, type: OscillatorType = 'sine') {
  if (!audioCtx) audioCtx = new AudioContext();
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + startMs / 1000;
  const t1 = t0 + durMs / 1000;
  gain.gain.setValueAtTime(0.25, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t1);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1);
}

/** 1 tone ngắn — đã bắt được đơn, chờ quét mã hành động (OK / lỗi). */
export function beepScan() {
  try {
    tone(880, 0, 100);
  } catch {
    // AudioContext bị chặn → bỏ qua.
  }
}

/** 2 tone đi lên — thao tác thành công. */
export function beepSuccess() {
  try {
    tone(880, 0, 120);
    tone(1320, 130, 160);
  } catch {
    // AudioContext bị chặn (chưa có user gesture) → bỏ qua, đã có toast.
  }
}

/** Buzz trầm — thao tác thất bại / mã không hợp lệ. */
export function beepError() {
  try {
    tone(220, 0, 220, 'square');
    tone(180, 240, 260, 'square');
  } catch {
    // AudioContext bị chặn → bỏ qua.
  }
}
