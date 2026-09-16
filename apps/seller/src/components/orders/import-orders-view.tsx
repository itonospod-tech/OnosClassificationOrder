'use client';

import Link from 'next/link';
import { Fragment, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, Download, FileUp, Image as ImageIcon, Upload, XCircle } from 'lucide-react';
import type { CustomerImportOrder, CustomerImportResultRow, DesignFields, ProductionOrderTracking, ResolvedImportSku } from 'shared';
import { CustomerImportOrderZod, parseCustomerShipMethod } from 'shared/client';
import * as XLSX from 'xlsx';
import type { ZodIssue } from 'zod';
import { Button } from '@/components/shared/button';
import { PageHeader } from '@/components/shared/page-header';
import { SafeImage } from '@/components/shared/safe-image';
import { useToast } from '@/components/shared/toast';
import { apiFetch } from '@/hooks/use-api';
import type { ApiRes } from '@/lib/customer-orders';
import { driveThumbnailUrl, driveViewUrl } from '@/lib/label-preview';
import { productLineHref, type ProductLine } from '@/lib/product-lines';
import { fmtUSD } from '@/lib/utils';

/**
 * Mirror `apps/web/src/pages/customer/orders/import.tsx` (CustomerOrderIntake.md): parse template
 * fulfill OnosPod cũ (CSV/XLSX) → group (order_id, identifier) → validate từng đơn bằng
 * `CustomerImportOrderZod` (shared/client — cùng schema BE) → đối chiếu SKU → import → kết quả.
 */
const MAX_LINES = 500;

const DESIGN_KEYS = new Set([
  'front', 'back', 'sleeve', 'hood', 'folder', 'placket', 'chestLeft', 'chestRight', 'left', 'right',
  'sleeveLeft', 'sleeveRight', 'leftUpperSleeve', 'rightUpperSleeve', 'leftCuff', 'rightCuff', 'frontEmbroidery', 'backEmbroidery',
]);
function designKeyFromHeader(header: string): string | undefined {
  const camel = header.replace(/^design_/, '').replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return DESIGN_KEYS.has(camel) ? camel : undefined;
}

const PREVIEW_COLUMNS = [
  'order_id', 'identifier', 'sku', 'item', 'quantity', 'shipping', 'name', 'telephone', 'address_1', 'city', 'state', 'postcode', 'country',
  'tracking_number', 'tracking_carrier', 'shipping_label',
] as const;
type PreviewColumn = (typeof PREVIEW_COLUMNS)[number];

const ITEM_FIELD_TO_COLUMN: Record<string, PreviewColumn | string> = {
  sku: 'sku', merchantSku: 'merchant_sku', quantity: 'quantity', shipMethod: 'shipping', mockupUrl: 'mockup', rawItemName: 'item', rawColor: 'color', rawSize: 'size',
};
const ADDRESS_FIELD_TO_COLUMN: Record<string, PreviewColumn | string> = {
  firstName: 'name', lastName: 'name', phone: 'telephone', email: 'email', address1: 'address_1', address2: 'address_2', company: 'company', city: 'city', state: 'state', postcode: 'postcode', country: 'country',
};

interface ParsedOrder {
  orderId: string;
  identifier?: string;
  lines: number[];
  itemDesignKeys: string[][];
  display: Array<Record<string, string>>;
  data?: CustomerImportOrder;
  cellErrors: Map<string, string[]>;
  orderErrors: string[];
  warnings: string[];
}
interface ParseOutput {
  orders: ParsedOrder[];
  totalLines: number;
  fileErrors: string[];
}
type TFn = (key: string, opts?: Record<string, unknown>) => string;

const asString = (v: unknown) => (v == null ? '' : String(v).trim());

function issueMessage(t: TFn, issue: ZodIssue): string {
  const last = String(issue.path[issue.path.length - 1] ?? '');
  if (last === 'quantity') return t('importCsv.cellErrors.badQuantity');
  if (last === 'shipMethod') return t('importCsv.cellErrors.badShipping');
  if (issue.code === 'too_big' && 'maximum' in issue) return t('importCsv.cellErrors.tooLong', { max: issue.maximum });
  if (issue.code === 'too_small' || (issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined')) return t('importCsv.cellErrors.required');
  return t('importCsv.cellErrors.invalid');
}

function attachIssue(order: ParsedOrder, issue: ZodIssue, t: TFn) {
  const message = issueMessage(t, issue);
  const [head, second, third] = issue.path;
  let line: number | undefined;
  let column: string | undefined;
  if (head === 'items' && typeof second === 'number') {
    line = order.lines[second];
    column = ITEM_FIELD_TO_COLUMN[String(third)] ?? String(third);
  } else if (head === 'shippingAddress') {
    line = order.lines[0];
    column = ADDRESS_FIELD_TO_COLUMN[String(second)] ?? String(second);
  } else if (head === 'orderId' || head === 'identifier' || head === 'orderName' || head === 'note') {
    line = order.lines[0];
    column = head === 'orderId' ? 'order_id' : head === 'orderName' ? 'order_name' : String(head);
  }
  if (line != null && column) {
    const key = `${line}|${column}`;
    order.cellErrors.set(key, [...(order.cellErrors.get(key) ?? []), message]);
  } else order.orderErrors.push(message);
}

function parseTemplateRows(rows: unknown[][], t: TFn): ParseOutput {
  const fileErrors: string[] = [];
  if (rows.length < 2) return { orders: [], totalLines: 0, fileErrors: [t('importCsv.errors.emptyFile')] };
  const headers = (rows[0] ?? []).map((h) => asString(h).toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  for (const r of ['order_id', 'sku', 'quantity']) if (col(r) === -1) fileErrors.push(t('importCsv.errors.missingColumn', { column: r }));
  if (fileErrors.length > 0) return { orders: [], totalLines: 0, fileErrors };

  const designCols: Array<{ index: number; key: string }> = [];
  headers.forEach((h, i) => {
    if (h.startsWith('design_')) {
      const key = designKeyFromHeader(h);
      if (key) designCols.push({ index: i, key });
    }
  });
  const get = (row: unknown[], name: string) => {
    const i = col(name);
    return i === -1 ? '' : asString(row[i]);
  };

  interface RawOrder {
    orderId: string;
    identifier?: string;
    orderName?: string;
    note?: string;
    shippingAddress: Record<string, string | undefined>;
    items: Array<Record<string, unknown>>;
  }
  const orderMap = new Map<string, { raw: RawOrder; parsed: ParsedOrder }>();
  let totalLines = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => asString(c) === '')) break;
    const line = r + 1;
    totalLines++;
    const orderId = get(row, 'order_id');
    const identifier = get(row, 'identifier') || undefined;
    const designs: Record<string, string> = {};
    for (const dc of designCols) {
      const v = asString(row[dc.index]);
      if (v) designs[dc.key] = v;
    }
    const tracking: ProductionOrderTracking = {
      number: get(row, 'tracking_number') || undefined,
      carrier: get(row, 'tracking_carrier') || undefined,
      url: get(row, 'tracking_url') || undefined,
      labelUrl: get(row, 'shipping_label') || undefined,
    };
    const hasTracking = Object.values(tracking).some(Boolean);
    const activeServiceRaw = get(row, 'active_service');
    const quantityRaw = get(row, 'quantity');
    const shippingRaw = get(row, 'shipping');
    const shipMethod = parseCustomerShipMethod(shippingRaw) ?? shippingRaw;
    const item: Record<string, unknown> = {
      sku: get(row, 'sku'),
      merchantSku: get(row, 'merchant_sku') || undefined,
      quantity: quantityRaw === '' ? undefined : quantityRaw,
      shipMethod,
      activeService: activeServiceRaw === '1' ? true : activeServiceRaw === '0' ? false : undefined,
      mockupUrl: get(row, 'mockup') || undefined,
      designs: Object.keys(designs).length > 0 ? (designs as DesignFields) : undefined,
      tracking: hasTracking ? tracking : undefined,
      rawItemName: get(row, 'item') || undefined,
      rawColor: get(row, 'color') || undefined,
      rawSize: get(row, 'size') || undefined,
    };
    const nameRaw = get(row, 'name');
    let firstName = get(row, 'first_name');
    let lastName = get(row, 'last_name') || undefined;
    if (!firstName) {
      const spaceIdx = nameRaw.indexOf(' ');
      if (spaceIdx > 0) {
        firstName = nameRaw.slice(0, spaceIdx);
        lastName = lastName ?? nameRaw.slice(spaceIdx + 1).trim();
      } else firstName = nameRaw;
    }
    const address = {
      firstName,
      lastName,
      phone: get(row, 'telephone') || get(row, 'phone') || undefined,
      email: get(row, 'email') || undefined,
      country: get(row, 'country'),
      state: get(row, 'state'),
      city: get(row, 'city'),
      address1: get(row, 'address_1'),
      address2: get(row, 'address_2') || undefined,
      company: get(row, 'company') || undefined,
      postcode: get(row, 'postcode'),
    };
    const display: Record<string, string> = {};
    for (const c of PREVIEW_COLUMNS) display[c] = get(row, c);
    display.name = nameRaw || [firstName, lastName].filter(Boolean).join(' ');
    display.telephone = address.phone ?? '';

    const key = `${orderId.toLowerCase()}|${(identifier ?? '').toLowerCase()}`;
    let entry = orderMap.get(key);
    if (!entry) {
      entry = {
        raw: { orderId, identifier, orderName: get(row, 'order_name') || undefined, note: get(row, 'note') || undefined, shippingAddress: address, items: [] },
        parsed: { orderId, identifier, lines: [], itemDesignKeys: [], display: [], cellErrors: new Map(), orderErrors: [], warnings: [] },
      };
      orderMap.set(key, entry);
    } else {
      const prev = entry.raw.shippingAddress;
      const differs = (['firstName', 'address1', 'city', 'state', 'country', 'postcode'] as const).some((k) => (prev[k] || '') !== (address[k] || ''));
      if (differs) entry.parsed.warnings.push(t('importCsv.warnings.addressMismatch', { line }));
      if (!entry.raw.note && get(row, 'note')) entry.raw.note = get(row, 'note');
    }
    entry.raw.items.push(item);
    entry.parsed.lines.push(line);
    entry.parsed.itemDesignKeys.push(Object.keys(designs));
    entry.parsed.display.push(display);
  }
  if (totalLines > MAX_LINES) fileErrors.push(t('importCsv.errors.tooManyLines', { max: MAX_LINES }));

  const orders: ParsedOrder[] = [];
  for (const { raw, parsed } of orderMap.values()) {
    const result = CustomerImportOrderZod.safeParse(raw);
    if (result.success) parsed.data = result.data;
    else for (const issue of result.error.issues) attachIssue(parsed, issue, t);
    orders.push(parsed);
  }
  return { orders, totalLines, fileErrors };
}

function SystemProductCell({ info, resolving, hasSku, designKeys }: { info?: ResolvedImportSku; resolving: boolean; hasSku: boolean; designKeys?: string[] }) {
  const { t } = useTranslation('customerPortal');
  const cell = 'px-2 py-1.5 align-top border-r border-border2';
  if (!hasSku) return <td className={`${cell} text-text-muted`}>—</td>;
  if (resolving || !info) return <td className={cell}><div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" /></td>;
  if (!info.found) return <td className={`${cell} bg-error-bg`}><p className="text-error font-medium whitespace-normal max-w-[200px]">{info.error ?? t('importCsv.cellErrors.skuNotFound')}</p></td>;
  const missingDesign = (info.designAcceptKeys?.length ?? 0) > 0 && !info.designAcceptKeys?.some((k) => designKeys?.includes(k));
  const areaNames = (info.designAcceptKeys ?? []).map((k) => `design_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`).join(' / ');
  const snap = info.priceSnapshot;
  return (
    <td className={cell}>
      <div className="flex items-start gap-2 min-w-[200px] max-w-[260px]">
        {info.imageUrl ? (
          <a href={driveViewUrl(info.imageUrl)} target="_blank" rel="noreferrer" className="shrink-0">
            <SafeImage src={driveThumbnailUrl(info.imageUrl, 100) ?? info.imageUrl} alt={info.type} className="w-9 h-9 rounded object-cover border border-border1 bg-surface-muted" fallback={<div className="w-9 h-9 rounded border border-dashed border-border1" />} />
          </a>
        ) : (
          <div className="w-9 h-9 rounded border border-dashed border-border1 flex items-center justify-center text-text-muted shrink-0"><ImageIcon size={12} /></div>
        )}
        <div className="min-w-0">
          <p className="font-medium whitespace-normal leading-tight text-text-primary">{info.type}</p>
          <p className="text-[9px] text-text-muted">{[info.color, info.size].filter(Boolean).join(' / ')}</p>
          {snap ? (
            <p className="text-[9px] whitespace-nowrap tabular-nums">
              {snap.discountedPrice != null && <span className="line-through text-text-muted mr-1">{fmtUSD(snap.unitPrice)}</span>}
              <span className="font-semibold">{fmtUSD(snap.discountedPrice ?? snap.unitPrice)}</span>
              <span className="text-text-muted"> = {fmtUSD(snap.lineTotal)}</span>
            </p>
          ) : (
            info.error && <p className="text-[9px] text-warning whitespace-normal">{info.error}</p>
          )}
          {missingDesign && (
            <p className="text-[9px] leading-tight text-warning whitespace-normal flex items-start gap-0.5">
              <AlertTriangle size={9} className="mt-[1px] shrink-0" />
              {t('importCsv.designWarnCell', { areas: areaNames })}
            </p>
          )}
        </div>
      </div>
    </td>
  );
}

function PreviewCell({ value, errors }: { value: string; errors?: string[] }) {
  return (
    <td className={`px-2 py-1.5 align-top border-r border-border2 last:border-r-0 ${errors ? 'bg-error-bg' : ''}`}>
      <p className={`truncate max-w-[150px] ${errors ? 'text-error font-medium' : 'text-text-primary'}`}>{value || (errors ? '∅' : '')}</p>
      {errors?.map((e, i) => <p key={i} className="text-[9px] leading-tight text-error whitespace-normal max-w-[150px]">{e}</p>)}
    </td>
  );
}

export function ImportOrdersView({ line }: { line: ProductLine }) {
  const { t } = useTranslation(['customerPortal', 'seller']);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseOutput | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ created: number; duplicated: number; failed: number; results: CustomerImportResultRow[] } | null>(null);
  const [skuInfo, setSkuInfo] = useState<Map<number, ResolvedImportSku>>(new Map());
  const [resolving, setResolving] = useState(false);
  const tc: TFn = (k, o) => String(t(`customerPortal:${k}`, o as never));

  const orders = useMemo(() => parsed?.orders ?? [], [parsed]);
  const skuErrorCount = useMemo(() => [...skuInfo.values()].filter((i) => !i.found).length, [skuInfo]);
  const errorCount = useMemo(() => orders.reduce((s, o) => s + o.cellErrors.size + o.orderErrors.length, 0) + skuErrorCount, [orders, skuErrorCount]);
  const hasErrors = errorCount > 0 || (parsed?.fileErrors.length ?? 0) > 0;
  const designWarnCount = useMemo(() => {
    let n = 0;
    for (const o of orders) o.lines.forEach((line, i) => {
      const info = skuInfo.get(line);
      if (info?.found && (info.designAcceptKeys?.length ?? 0) > 0 && !info.designAcceptKeys?.some((k) => o.itemDesignKeys[i]?.includes(k))) n++;
    });
    return n;
  }, [orders, skuInfo]);
  const warningCount = useMemo(() => orders.reduce((s, o) => s + o.warnings.length, 0) + designWarnCount, [orders, designWarnCount]);

  const resolveSkus = async (output: ParseOutput) => {
    const entries: Array<{ line: number; sku: string; shipMethod: string | undefined; quantity: number }> = [];
    for (const o of output.orders) o.display.forEach((d, i) => {
      const sku = (d.sku ?? '').trim();
      if (!sku) return;
      const qty = Number(d.quantity);
      entries.push({ line: o.lines[i], sku, shipMethod: parseCustomerShipMethod(d.shipping), quantity: Number.isInteger(qty) && qty > 0 ? qty : 1 });
    });
    if (entries.length === 0) return;
    setResolving(true);
    try {
      const res = await apiFetch<ApiRes<ResolvedImportSku[]>>('/api/v1/customer/orders/import/resolve', {
        method: 'POST',
        body: JSON.stringify({ items: entries.map((e) => ({ sku: e.sku, shipMethod: e.shipMethod ?? 'express_us', quantity: e.quantity })) }),
      });
      const map = new Map<number, ResolvedImportSku>();
      entries.forEach((e, i) => { if (res.data[i]) map.set(e.line, res.data[i]); });
      setSkuInfo(map);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setResolving(false);
    }
  };

  const handleFile = async (file: File) => {
    try {
      setResults(null);
      setFileName(file.name);
      setSkuInfo(new Map());
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
      const output = parseTemplateRows(rows, tc);
      setParsed(output);
      if (output.fileErrors.length === 0) void resolveSkus(output);
    } catch {
      toast('error', t('customerPortal:importCsv.errors.parseFailed'));
      setParsed(null);
    }
  };

  const handleImport = async () => {
    if (hasErrors) return;
    const payload = orders.map((o) => o.data).filter((d): d is CustomerImportOrder => !!d);
    if (payload.length === 0) return;
    setImporting(true);
    try {
      const res = await apiFetch<ApiRes<NonNullable<typeof results>>>('/api/v1/customer/orders/import', { method: 'POST', body: JSON.stringify({ orders: payload }) });
      setResults(res.data);
      if (res.data.created > 0) toast('success', t('customerPortal:importCsv.successToast', { count: res.data.created }));
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setResults(null);
    setFileName('');
    setSkuInfo(new Map());
    setResolving(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const badge = (cls: string, text: string) => <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${cls}`}>{text}</span>;

  return (
    <div className="space-y-4">
      <Link href={productLineHref(line)} prefetch={false} className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
        <ArrowLeft size={13} /> {t('customerPortal:importCsv.backToOrders')}
      </Link>
      <PageHeader
        title={t('customerPortal:importCsv.title')}
        subtitle={t('customerPortal:importCsv.subtitle')}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {/* Cột `sku` là bắt buộc trong file — nhưng trước 08/09/2026 không có chỗ nào tra SKU. Link thẳng sang danh mục. */}
            <Link href={`/portal/catalog${line ? `?line=${line}` : ''}`} prefetch={false}>
              <Button variant="outline" size="sm"><BookOpen size={13} className="mr-1.5" />{t('seller:catalog.lookupSku')}</Button>
            </Link>
            <a href="/customer-order-template.xlsx" download>
              <Button variant="secondary" size="sm"><Download size={13} className="mr-1.5" />{t('customerPortal:importCsv.downloadTemplate')}</Button>
            </a>
          </div>
        }
      />

      <div className="rounded-xl border border-dashed border-border1 bg-card p-6">
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
        <div className="flex flex-col items-center gap-2 text-center">
          <FileUp size={26} className="text-text-muted" />
          <p className="text-sm text-text-primary">{fileName || t('customerPortal:importCsv.dropHint')}</p>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()}><Upload size={13} className="mr-1.5" />{t('customerPortal:importCsv.chooseFile')}</Button>
            {parsed && <Button variant="outline" size="sm" onClick={reset}>{t('customerPortal:importCsv.reset')}</Button>}
          </div>
          <p className="text-[11px] text-text-muted">{t('customerPortal:importCsv.formatHint', { max: MAX_LINES })}</p>
        </div>
      </div>

      {parsed && parsed.fileErrors.length > 0 && (
        <div className="rounded-lg border border-error/40 bg-error-bg p-3">
          {parsed.fileErrors.map((e, i) => <p key={i} className="text-xs text-error flex items-center gap-1"><XCircle size={12} />{e}</p>)}
        </div>
      )}

      {parsed && parsed.fileErrors.length === 0 && !results && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
            <span>{t('customerPortal:importCsv.parsedSummary', { lines: parsed.totalLines, orders: orders.length })}</span>
            {!hasErrors ? badge('bg-success-bg text-success', t('customerPortal:importCsv.allValid')) : badge('bg-error-bg text-error', t('customerPortal:importCsv.cellErrorCount', { count: errorCount }))}
            {warningCount > 0 && badge('bg-warning-bg text-warning', t('customerPortal:importCsv.warningCount', { count: warningCount }))}
            {resolving && <span className="inline-flex items-center gap-1 text-text-muted"><span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />{t('customerPortal:importCsv.resolving')}</span>}
            <Button variant="primary" size="sm" className="ml-auto" loading={importing} disabled={resolving || hasErrors || orders.length === 0} onClick={handleImport}>
              <Upload size={13} className="mr-1.5" />{t('customerPortal:importCsv.importAll', { count: orders.length })}
            </Button>
          </div>
          {hasErrors && <p className="text-xs text-error flex items-center gap-1"><XCircle size={12} />{t('customerPortal:importCsv.fixErrorsToSubmit')}</p>}

          <div className="rounded-xl border border-border1 bg-card overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border1 bg-surface-muted text-left">
                  <th className="px-2 py-1.5 font-medium whitespace-nowrap">#</th>
                  {PREVIEW_COLUMNS.map((c) => (
                    <Fragment key={c}>
                      <th className="px-2 py-1.5 whitespace-nowrap">
                        <p className="font-medium text-text-primary">{t(`customerPortal:importCsv.columns.${c}`)}</p>
                        <p className="font-mono text-[9px] text-text-muted font-normal">{c}</p>
                      </th>
                      {c === 'sku' && (
                        <th className="px-2 py-1.5 whitespace-nowrap bg-accent-light">
                          <p className="font-medium text-text-primary">{t('customerPortal:importCsv.columns.systemProduct')}</p>
                          <p className="text-[9px] text-text-muted font-normal">{t('customerPortal:importCsv.systemProductHint')}</p>
                        </th>
                      )}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order, oi) =>
                  order.display.map((rowValues, ri) => {
                    const line = order.lines[ri];
                    return (
                      <tr key={`${oi}-${ri}`} className={ri === 0 && oi > 0 ? 'border-t-2 border-border1' : 'border-t border-border2'}>
                        <td className="px-2 py-1.5 align-top text-text-muted font-mono">{line}</td>
                        {PREVIEW_COLUMNS.map((c) => (
                          <Fragment key={c}>
                            <PreviewCell value={rowValues[c] ?? ''} errors={order.cellErrors.get(`${line}|${c}`)} />
                            {c === 'sku' && <SystemProductCell info={skuInfo.get(line)} resolving={resolving} hasSku={!!(rowValues.sku ?? '').trim()} designKeys={order.itemDesignKeys[ri]} />}
                          </Fragment>
                        ))}
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <div className="space-y-1">
            {orders.flatMap((o, i) => o.orderErrors.map((e, j) => <p key={`oe-${i}-${j}`} className="text-xs text-error flex items-center gap-1"><XCircle size={11} />{o.orderId ? `${o.orderId}: ` : ''}{e}</p>))}
            {orders.flatMap((o, i) => o.warnings.map((w, j) => <p key={`w-${i}-${j}`} className="text-xs text-warning flex items-center gap-1"><AlertTriangle size={11} />{w}</p>))}
          </div>
        </>
      )}

      {results && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {badge('bg-success-bg text-success', t('customerPortal:importCsv.resultCreated', { count: results.created }))}
            {badge('bg-surface-muted text-text-secondary', t('customerPortal:importCsv.resultDuplicated', { count: results.duplicated }))}
            {badge('bg-error-bg text-error', t('customerPortal:importCsv.resultFailed', { count: results.failed }))}
            <Link href={`${productLineHref(line)}?status=pending`} prefetch={false} className="ml-auto"><Button variant="primary" size="sm">{t('customerPortal:importCsv.goToPending')}</Button></Link>
          </div>
          <div className="rounded-xl border border-border1 bg-card divide-y divide-border2">
            {results.results.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-primary">{r.orderId}{r.identifier ? ` · ${r.identifier}` : ''}</p>
                  {r.error && <p className="text-[11px] text-text-muted">{r.error}</p>}
                  {r.itemErrors?.map((ie, j) => <p key={j} className="text-[11px] text-error">{t('customerPortal:importCsv.itemErrorLine', { index: ie.index + 1 })}: {ie.error}</p>)}
                </div>
                {r.status === 'created' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success whitespace-nowrap"><CheckCircle2 size={13} />{t('customerPortal:importCsv.statusCreated')}</span>
                ) : r.status === 'duplicated' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted whitespace-nowrap"><AlertTriangle size={13} />{t('customerPortal:importCsv.statusDuplicated')}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-error whitespace-nowrap"><XCircle size={13} />{t('customerPortal:importCsv.statusFailed')}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
