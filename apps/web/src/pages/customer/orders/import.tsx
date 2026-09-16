import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, Download, FileUp, ImageIcon, Upload, XCircle } from 'lucide-react';
import type {
  CustomerImportOrder,
  CustomerImportResultRow,
  CustomerOrderTracking,
  DesignFields,
  ResolvedImportSku,
  ResolveImportSkusDto,
} from 'shared';
import { CustomerImportOrderZod, parseCustomerShipMethod } from 'shared';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import type { ZodIssue } from 'zod';

import { PATHS } from '@/constants/paths';

import { Spinner } from '@/components/common/Spinner';
import { formatUsd } from '@/components/customer/PushToProductionDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { RepositoryRemote } from '../../../services';
import { handleAxiosError } from '../../../utils';
import { driveThumbUrl, driveViewUrl } from '../../../utils/driveThumb';

const MAX_LINES = 500;

/**
 * Map cột `design_*` template cũ → key `DesignFields` (snake_case → camelCase,
 * bỏ prefix): design_sleeve_left → sleeveLeft. Chỉ nhận key hợp lệ.
 */
const DESIGN_KEYS = new Set([
  'front',
  'back',
  'sleeve',
  'hood',
  'folder',
  'placket',
  'chestLeft',
  'chestRight',
  'left',
  'right',
  'sleeveLeft',
  'sleeveRight',
  'leftUpperSleeve',
  'rightUpperSleeve',
  'leftCuff',
  'rightCuff',
  'frontEmbroidery',
  'backEmbroidery',
]);
function designKeyFromHeader(header: string): string | undefined {
  const raw = header.replace(/^design_/, '');
  const camel = raw.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return DESIGN_KEYS.has(camel) ? camel : undefined;
}

/** Cột template hiển thị trong bảng preview (theo thứ tự). */
const PREVIEW_COLUMNS = [
  'order_id',
  'identifier',
  'sku',
  'item',
  'quantity',
  'shipping',
  'name',
  'telephone',
  'address_1',
  'city',
  'state',
  'postcode',
  'country',
  // Vận đơn khách tự cấp — hiện ở preview để khách thấy hệ thống ĐÃ nhận
  // (từ ORD-26 mấy cột này đi thẳng vào module vận đơn lúc push, không còn là
  // dữ liệu trang trí). `tracking_url` cố ý bỏ khỏi bảng: link dài, đã có ở
  // drawer chi tiết đơn, thêm vào chỉ làm bảng khó đọc.
  'tracking_number',
  'tracking_carrier',
  'shipping_label',
] as const;
type PreviewColumn = (typeof PREVIEW_COLUMNS)[number];

/** Map path Zod của item → cột template (báo đỏ đúng ô). */
const ITEM_FIELD_TO_COLUMN: Record<string, PreviewColumn | string> = {
  sku: 'sku',
  merchantSku: 'merchant_sku',
  quantity: 'quantity',
  shipMethod: 'shipping',
  mockupUrl: 'mockup',
  rawItemName: 'item',
  rawColor: 'color',
  rawSize: 'size',
};
/** Map path Zod của shippingAddress → cột template. */
const ADDRESS_FIELD_TO_COLUMN: Record<string, PreviewColumn | string> = {
  firstName: 'name',
  lastName: 'name',
  phone: 'telephone',
  email: 'email',
  address1: 'address_1',
  address2: 'address_2',
  company: 'company',
  city: 'city',
  state: 'state',
  postcode: 'postcode',
  country: 'country',
};

interface ParsedOrder {
  orderId: string;
  identifier?: string;
  /** Số dòng gốc trong file của từng item (song song với items của đơn). */
  lines: number[];
  /** Key design có giá trị của từng dòng (song song `lines`) — cảnh báo thiếu design. */
  itemDesignKeys: string[][];
  /** Giá trị thô từng dòng theo tên cột template — hiển thị bảng preview. */
  display: Array<Record<string, string>>;
  /** Output Zod (đã coerce/default) — CHỈ có khi đơn hợp lệ, là payload gửi BE. */
  data?: CustomerImportOrder;
  /** Lỗi gắn được vào ô cụ thể: key `${line}|${column}` → message đã dịch. */
  cellErrors: Map<string, string[]>;
  /** Lỗi không map được vào ô (hiếm — path lạ). */
  orderErrors: string[];
  warnings: string[];
}

interface ParseOutput {
  orders: ParsedOrder[];
  totalLines: number;
  /** Lỗi cấp file (thiếu header bắt buộc, quá 500 dòng...). */
  fileErrors: string[];
}

function asString(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Dịch 1 Zod issue → message i18n theo ngôn ngữ hiện tại. Rule nằm TRONG
 * `CustomerImportOrderZod` (shared) — FE chỉ dịch, không tự chế rule.
 */
function issueMessage(t: TFn, issue: ZodIssue): string {
  const last = String(issue.path[issue.path.length - 1] ?? '');
  if (last === 'quantity') return t('importCsv.cellErrors.badQuantity');
  if (last === 'shipMethod') return t('importCsv.cellErrors.badShipping');
  if (issue.code === 'too_big' && 'maximum' in issue) return t('importCsv.cellErrors.tooLong', { max: issue.maximum });
  if (
    issue.code === 'too_small' ||
    (issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined')
  )
    return t('importCsv.cellErrors.required');
  return t('importCsv.cellErrors.invalid');
}

/** Gắn issue vào đúng (dòng, cột) trong bảng preview. */
function attachIssue(order: ParsedOrder, issue: ZodIssue, t: TFn) {
  const message = issueMessage(t, issue);
  const [head, second, third] = issue.path;
  let line: number | undefined;
  let column: string | undefined;
  if (head === 'items' && typeof second === 'number') {
    line = order.lines[second];
    column = ITEM_FIELD_TO_COLUMN[String(third)] ?? String(third);
  } else if (head === 'shippingAddress') {
    // Địa chỉ lấy từ dòng ĐẦU của đơn.
    line = order.lines[0];
    column = ADDRESS_FIELD_TO_COLUMN[String(second)] ?? String(second);
  } else if (head === 'orderId' || head === 'identifier' || head === 'orderName' || head === 'note') {
    line = order.lines[0];
    column = head === 'orderId' ? 'order_id' : head === 'orderName' ? 'order_name' : String(head);
  }
  if (line != null && column) {
    const key = `${line}|${column}`;
    const list = order.cellErrors.get(key) ?? [];
    list.push(message);
    order.cellErrors.set(key, list);
  } else {
    order.orderErrors.push(message);
  }
}

/**
 * Parse file theo ĐÚNG template fulfill OnosPod cũ (plan §6): trim header,
 * cắt ở dòng trống đầu tiên, group nhiều dòng cùng (order_id, identifier)
 * thành 1 đơn — rồi validate TỪNG ĐƠN bằng `CustomerImportOrderZod` (shared,
 * cùng schema `ImportCustomerOrdersDto` BE dùng qua ZodValidationPipe) để
 * rule FE/BE khớp 100%. Giá trị thô đẩy thẳng vào Zod (coerce/enum/default
 * tự xử lý), FE chỉ map issue → ô + dịch message.
 */
function parseTemplateRows(rows: unknown[][], t: TFn): ParseOutput {
  const fileErrors: string[] = [];
  if (rows.length < 2) return { orders: [], totalLines: 0, fileErrors: [t('importCsv.errors.emptyFile')] };

  const headers = (rows[0] ?? []).map((h) => asString(h).toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  for (const r of ['order_id', 'sku', 'quantity']) {
    if (col(r) === -1) fileErrors.push(t('importCsv.errors.missingColumn', { column: r }));
  }
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

  // Candidate THÔ cho Zod — không validate tay ở đây.
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
    // Cắt ở dòng trống hoàn toàn đầu tiên — dưới đó là block hướng dẫn của template.
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
    const tracking: CustomerOrderTracking = {
      number: get(row, 'tracking_number') || undefined,
      carrier: get(row, 'tracking_carrier') || undefined,
      url: get(row, 'tracking_url') || undefined,
      labelUrl: get(row, 'shipping_label') || undefined,
    };
    const hasTracking = Object.values(tracking).some(Boolean);
    const activeServiceRaw = get(row, 'active_service');
    const quantityRaw = get(row, 'quantity');
    const shippingRaw = get(row, 'shipping');

    // shipping: parse bằng hàm SHARED (alias SBTT, trống → default). Giá trị
    // lạ → giữ nguyên raw cho Zod enum bắn invalid_enum_value → báo đúng ô.
    const shipMethod = parseCustomerShipMethod(shippingRaw) ?? shippingRaw;

    const item: Record<string, unknown> = {
      sku: get(row, 'sku'),
      merchantSku: get(row, 'merchant_sku') || undefined,
      // quantity trống → undefined để Zod default(1); còn lại để coerce tự xử.
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

    // Họ/tên: template chuẩn chỉ có cột `name` (full name) → tách từ đầu tiên =
    // firstName, phần còn lại = lastName (khớp cấu trúc address hệ cũ). File
    // export từ hệ cũ có sẵn `first_name`/`last_name` → ưu tiên dùng thẳng.
    const nameRaw = get(row, 'name');
    let firstName = get(row, 'first_name');
    let lastName = get(row, 'last_name') || undefined;
    if (!firstName) {
      const spaceIdx = nameRaw.indexOf(' ');
      if (spaceIdx > 0) {
        firstName = nameRaw.slice(0, spaceIdx);
        lastName = lastName ?? nameRaw.slice(spaceIdx + 1).trim();
      } else {
        firstName = nameRaw;
      }
    }

    const address = {
      firstName,
      lastName,
      // `telephone` là tên cột template chuẩn, `phone` là alias file hệ cũ.
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
    // Cột hiển thị tổng hợp từ nguồn thực tế (name HOẶC first_name/last_name, telephone HOẶC phone).
    display.name = nameRaw || [firstName, lastName].filter(Boolean).join(' ');
    display.telephone = address.phone ?? '';

    const key = `${orderId.toLowerCase()}|${(identifier ?? '').toLowerCase()}`;
    let entry = orderMap.get(key);
    if (!entry) {
      entry = {
        raw: {
          orderId,
          identifier,
          orderName: get(row, 'order_name') || undefined,
          note: get(row, 'note') || undefined,
          shippingAddress: address,
          items: [],
        },
        parsed: {
          orderId,
          identifier,
          lines: [],
          itemDesignKeys: [],
          display: [],
          cellErrors: new Map(),
          orderErrors: [],
          warnings: [],
        },
      };
      orderMap.set(key, entry);
    } else {
      // Nhiều dòng cùng đơn — địa chỉ lấy dòng ĐẦU, lệch nhau → warning (plan §6.1).
      const prev = entry.raw.shippingAddress;
      const differs = (['firstName', 'address1', 'city', 'state', 'country', 'postcode'] as const).some(
        (k) => (prev[k] || '') !== (address[k] || ''),
      );
      if (differs) entry.parsed.warnings.push(t('importCsv.warnings.addressMismatch', { line }));
      if (!entry.raw.note && get(row, 'note')) entry.raw.note = get(row, 'note');
    }

    entry.raw.items.push(item);
    entry.parsed.lines.push(line);
    entry.parsed.itemDesignKeys.push(Object.keys(designs));
    entry.parsed.display.push(display);
  }

  if (totalLines > MAX_LINES) fileErrors.push(t('importCsv.errors.tooManyLines', { max: MAX_LINES }));

  // Validate từng đơn bằng schema shared — nguồn rule DUY NHẤT, khớp BE.
  const orders: ParsedOrder[] = [];
  for (const { raw, parsed } of orderMap.values()) {
    const result = CustomerImportOrderZod.safeParse(raw);
    if (result.success) parsed.data = result.data;
    else for (const issue of result.error.issues) attachIssue(parsed, issue, t);
    orders.push(parsed);
  }

  return { orders, totalLines, fileErrors };
}

/**
 * Ô "Sản phẩm hệ thống" — thông tin resolve từ SKU (tên/ảnh/màu-size/giá tham
 * khảo) để khách đối chiếu với file; SKU không tồn tại → đỏ + chặn submit.
 */
function SystemProductCell({
  info,
  resolving,
  hasSku,
  designKeys,
}: {
  info?: ResolvedImportSku;
  resolving: boolean;
  hasSku: boolean;
  /** Key design có giá trị của dòng này — so với `designAcceptKeys` để cảnh báo sớm. */
  designKeys?: string[];
}) {
  const { t } = useTranslation('customerPortal');
  if (!hasSku) return <td className="px-2 py-1.5 align-top border-r border-border/40 text-muted-foreground">—</td>;
  if (resolving || !info)
    return (
      <td className="px-2 py-1.5 align-top border-r border-border/40">
        <Spinner size={12} />
      </td>
    );
  if (!info.found)
    return (
      <td className="px-2 py-1.5 align-top border-r border-border/40 bg-destructive/10">
        <p className="text-destructive font-medium whitespace-normal max-w-[200px]">
          {/* Message cụ thể từ BE (vd sản phẩm ngừng bán) — không có mới rơi về "SKU không tồn tại". */}
          {info.error ?? t('importCsv.cellErrors.skuNotFound')}
        </p>
      </td>
    );
  // Cảnh báo sớm (không chặn import — vùng nháp): thiếu design sẽ bị chặn lúc
  // Đẩy sản xuất. Luật mirror BE `designAcceptKeys`: 1 design ở front HOẶC back là đủ.
  const missingDesign =
    (info.designAcceptKeys?.length ?? 0) > 0 && !info.designAcceptKeys?.some((k) => designKeys?.includes(k));
  const areaNames = (info.designAcceptKeys ?? []).map((k) => `design_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`).join(' / ');
  const snap = info.priceSnapshot;
  return (
    <td className="px-2 py-1.5 align-top border-r border-border/40">
      <div className="flex items-start gap-2 min-w-[200px] max-w-[260px]">
        {info.imageUrl ? (
          <a href={driveViewUrl(info.imageUrl)} target="_blank" rel="noreferrer" className="shrink-0">
            <img
              src={driveThumbUrl(info.imageUrl, 100)}
              alt={info.type}
              loading="lazy"
              className="w-9 h-9 rounded object-cover border border-border bg-muted"
            />
          </a>
        ) : (
          <div className="w-9 h-9 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
            <ImageIcon size={12} />
          </div>
        )}
        <div className="min-w-0">
          <p className="font-medium whitespace-normal leading-tight">{info.type}</p>
          <p className="text-[9px] text-muted-foreground">
            {[info.color, info.size].filter(Boolean).join(' / ')}
          </p>
          {snap ? (
            <p className="text-[9px] whitespace-nowrap">
              {snap.discountedPrice != null && (
                <span className="line-through text-muted-foreground mr-1">{formatUsd(snap.unitPrice)}</span>
              )}
              <span className="font-semibold">{formatUsd(snap.discountedPrice ?? snap.unitPrice)}</span>
              <span className="text-muted-foreground"> = {formatUsd(snap.lineTotal)}</span>
            </p>
          ) : (
            info.error && (
              <p className="text-[9px] text-amber-600 dark:text-amber-400 whitespace-normal">{info.error}</p>
            )
          )}
          {missingDesign && (
            <p className="text-[9px] leading-tight text-amber-600 dark:text-amber-400 whitespace-normal flex items-start gap-0.5">
              <AlertTriangle size={9} className="mt-[1px] shrink-0" />
              {t('importCsv.designWarnCell', { areas: areaNames })}
            </p>
          )}
        </div>
      </div>
    </td>
  );
}

/** 1 ô trong bảng preview — bôi đỏ + message dịch sẵn khi có lỗi. */
function PreviewCell({ value, errors }: { value: string; errors?: string[] }) {
  return (
    <td className={`px-2 py-1.5 align-top border-r border-border/40 last:border-r-0 ${errors ? 'bg-destructive/10' : ''}`}>
      <p className={`truncate max-w-[150px] ${errors ? 'text-destructive font-medium' : ''}`}>
        {value || (errors ? '∅' : '')}
      </p>
      {errors?.map((e, i) => (
        <p key={i} className="text-[9px] leading-tight text-destructive whitespace-normal max-w-[150px]">
          {e}
        </p>
      ))}
    </td>
  );
}

function CustomerOrderImport() {
  const { t } = useTranslation('customerPortal');
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseOutput | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{
    created: number;
    duplicated: number;
    failed: number;
    results: CustomerImportResultRow[];
  } | null>(null);

  const [skuInfo, setSkuInfo] = useState<Map<number, ResolvedImportSku>>(new Map());
  const [resolving, setResolving] = useState(false);

  const orders = useMemo(() => parsed?.orders ?? [], [parsed]);
  const skuErrorCount = useMemo(() => [...skuInfo.values()].filter((i) => !i.found).length, [skuInfo]);
  const errorCount = useMemo(
    () => orders.reduce((s, o) => s + o.cellErrors.size + o.orderErrors.length, 0) + skuErrorCount,
    [orders, skuErrorCount],
  );
  const hasErrors = errorCount > 0 || (parsed?.fileErrors.length ?? 0) > 0;
  // Cảnh báo thiếu design (không chặn import, sẽ bị chặn lúc push) — mirror
  // luật BE `designAcceptKeys`: cần 1 design ở front HOẶC back.
  const designWarnCount = useMemo(() => {
    let n = 0;
    for (const o of orders) {
      o.lines.forEach((line, i) => {
        const info = skuInfo.get(line);
        if (
          info?.found &&
          (info.designAcceptKeys?.length ?? 0) > 0 &&
          !info.designAcceptKeys?.some((k) => o.itemDesignKeys[i]?.includes(k))
        )
          n++;
      });
    }
    return n;
  }, [orders, skuInfo]);
  const warningCount = useMemo(
    () => orders.reduce((s, o) => s + o.warnings.length, 0) + designWarnCount,
    [orders, designWarnCount],
  );

  /**
   * Đối chiếu SKU với catalog (BE `POST /import/resolve` — cùng `quoteItem`
   * lúc import) → map theo số dòng file. SKU không tồn tại cũng CHẶN submit
   * (BE sẽ fail cả đơn y hệt).
   */
  const resolveSkus = async (output: ParseOutput) => {
    const entries: Array<{ line: number; sku: string; shipMethod: string | undefined; quantity: number }> = [];
    for (const o of output.orders) {
      o.display.forEach((d, i) => {
        const sku = (d.sku ?? '').trim();
        if (!sku) return;
        const qty = Number(d.quantity);
        entries.push({
          line: o.lines[i],
          sku,
          shipMethod: parseCustomerShipMethod(d.shipping),
          quantity: Number.isInteger(qty) && qty > 0 ? qty : 1,
        });
      });
    }
    if (entries.length === 0) return;
    try {
      setResolving(true);
      const res = await RepositoryRemote.customerOrder.resolveImportSkus({
        items: entries.map((e) => ({
          sku: e.sku,
          shipMethod: (e.shipMethod ?? 'express_us') as ResolveImportSkusDto['items'][number]['shipMethod'],
          quantity: e.quantity,
        })),
      });
      const data: ResolvedImportSku[] = res?.data?.data ?? [];
      const map = new Map<number, ResolvedImportSku>();
      entries.forEach((e, i) => {
        if (data[i]) map.set(e.line, data[i]);
      });
      setSkuInfo(map);
    } catch (error) {
      handleAxiosError(error);
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
      // raw:false → mọi cell về string hiển thị (postcode giữ dạng chuỗi, không mất số 0 đầu).
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' });
      const output = parseTemplateRows(rows, t);
      setParsed(output);
      if (output.fileErrors.length === 0) void resolveSkus(output);
    } catch {
      toast.error(t('importCsv.errors.parseFailed'));
      setParsed(null);
    }
  };

  const handleImport = async () => {
    // Chặn cứng khi còn lỗi — rule Zod shared, BE cũng sẽ chặn y hệt.
    if (hasErrors) return;
    const payload = orders.map((o) => o.data).filter((d): d is CustomerImportOrder => !!d);
    if (payload.length === 0) return;
    try {
      setImporting(true);
      const res = await RepositoryRemote.customerOrder.importOrders({ orders: payload });
      const data = res?.data?.data;
      if (data) {
        setResults(data);
        if (data.created > 0) toast.success(t('importCsv.successToast', { count: data.created }));
      }
    } catch (error) {
      handleAxiosError(error);
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            to={PATHS.CUSTOMER_ORDERS}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
          >
            <ChevronLeft size={12} />
            {t('importCsv.backToOrders')}
          </Link>
          <h1 className="text-lg font-semibold">{t('importCsv.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('importCsv.subtitle')}</p>
        </div>
        <a href="/customer-order-template.xlsx" download>
          <Button size="sm" variant="secondary">
            <Download size={14} className="mr-1.5" />
            {t('importCsv.downloadTemplate')}
          </Button>
        </a>
      </div>

      {/* Bước 1: chọn file */}
      <div className="rounded-xl border border-dashed border-border bg-card p-6 mb-4">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <div className="flex flex-col items-center gap-2 text-center">
          <FileUp size={28} className="text-muted-foreground" />
          <p className="text-sm">{fileName || t('importCsv.dropHint')}</p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <Upload size={14} className="mr-1.5" />
              {t('importCsv.chooseFile')}
            </Button>
            {parsed && (
              <Button size="sm" variant="ghost" onClick={reset}>
                {t('importCsv.reset')}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{t('importCsv.formatHint', { max: MAX_LINES })}</p>
        </div>
      </div>

      {parsed && parsed.fileErrors.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 mb-4">
          {parsed.fileErrors.map((e, i) => (
            <p key={i} className="text-xs text-destructive flex items-center gap-1">
              <XCircle size={12} />
              {e}
            </p>
          ))}
        </div>
      )}

      {/* Bước 2: preview dạng bảng tính — báo đỏ từng ô lỗi */}
      {parsed && parsed.fileErrors.length === 0 && !results && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
            <span>{t('importCsv.parsedSummary', { lines: parsed.totalLines, orders: orders.length })}</span>
            {!hasErrors ? (
              <Badge variant="success" className="text-[10px]">
                {t('importCsv.allValid')}
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px]">
                {t('importCsv.cellErrorCount', { count: errorCount })}
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600 dark:text-amber-400">
                {t('importCsv.warningCount', { count: warningCount })}
              </Badge>
            )}
            {resolving && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Spinner size={12} />
                {t('importCsv.resolving')}
              </span>
            )}
            <Button
              size="sm"
              className="ml-auto"
              onClick={handleImport}
              disabled={importing || resolving || hasErrors || orders.length === 0}
            >
              {importing ? <Spinner size={14} className="mr-1.5" /> : <Upload size={14} className="mr-1.5" />}
              {t('importCsv.importAll', { count: orders.length })}
            </Button>
          </div>
          {hasErrors && (
            <p className="mb-3 text-xs text-destructive flex items-center gap-1">
              <XCircle size={12} />
              {t('importCsv.fixErrorsToSubmit')}
            </p>
          )}

          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
                  <th className="px-2 py-1.5 font-medium whitespace-nowrap">#</th>
                  {PREVIEW_COLUMNS.map((c) => (
                    <React.Fragment key={c}>
                      <th className="px-2 py-1.5 whitespace-nowrap">
                        <p className="font-medium">{t(`importCsv.columns.${c}`)}</p>
                        <p className="font-mono text-[9px] text-muted-foreground font-normal">{c}</p>
                      </th>
                      {c === 'sku' && (
                        <th className="px-2 py-1.5 whitespace-nowrap bg-primary/5">
                          <p className="font-medium">{t('importCsv.columns.systemProduct')}</p>
                          <p className="text-[9px] text-muted-foreground font-normal">{t('importCsv.systemProductHint')}</p>
                        </th>
                      )}
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order, oi) =>
                  order.display.map((rowValues, ri) => {
                    const line = order.lines[ri];
                    const firstOfOrder = ri === 0;
                    return (
                      <tr
                        key={`${oi}-${ri}`}
                        className={`${firstOfOrder && oi > 0 ? 'border-t-2 border-border' : 'border-t border-border/40'}`}
                      >
                        <td className="px-2 py-1.5 align-top text-muted-foreground font-mono">{line}</td>
                        {PREVIEW_COLUMNS.map((c) => (
                          <React.Fragment key={c}>
                            <PreviewCell value={rowValues[c] ?? ''} errors={order.cellErrors.get(`${line}|${c}`)} />
                            {c === 'sku' && (
                              <SystemProductCell
                                info={skuInfo.get(line)}
                                resolving={resolving}
                                hasSku={!!(rowValues.sku ?? '').trim()}
                                designKeys={order.itemDesignKeys[ri]}
                              />
                            )}
                          </React.Fragment>
                        ))}
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>

          {/* Lỗi không map được vào ô + warning theo đơn */}
          <div className="mt-2 space-y-1">
            {orders.flatMap((o, i) =>
              o.orderErrors.map((e, j) => (
                <p key={`oe-${i}-${j}`} className="text-xs text-destructive flex items-center gap-1">
                  <XCircle size={11} />
                  {o.orderId ? `${o.orderId}: ` : ''}
                  {e}
                </p>
              )),
            )}
            {orders.flatMap((o, i) =>
              o.warnings.map((w, j) => (
                <p key={`w-${i}-${j}`} className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {w}
                </p>
              )),
            )}
          </div>
        </>
      )}

      {/* Bước 3: kết quả từng đơn */}
      {results && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="success" className="text-[10px]">
              {t('importCsv.resultCreated', { count: results.created })}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {t('importCsv.resultDuplicated', { count: results.duplicated })}
            </Badge>
            <Badge variant="destructive" className="text-[10px]">
              {t('importCsv.resultFailed', { count: results.failed })}
            </Badge>
            <Link to={PATHS.CUSTOMER_ORDERS} className="ml-auto">
              <Button size="sm">{t('importCsv.goToPending')}</Button>
            </Link>
          </div>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {results.results.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">
                    {r.orderId}
                    {r.identifier ? ` · ${r.identifier}` : ''}
                  </p>
                  {r.error && <p className="text-[11px] text-muted-foreground">{r.error}</p>}
                  {r.itemErrors?.map((ie, j) => (
                    <p key={j} className="text-[11px] text-destructive">
                      {t('importCsv.itemErrorLine', { index: ie.index + 1 })}: {ie.error}
                    </p>
                  ))}
                </div>
                {r.status === 'created' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    <CheckCircle2 size={13} />
                    {t('importCsv.statusCreated')}
                  </span>
                ) : r.status === 'duplicated' ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                    <AlertTriangle size={13} />
                    {t('importCsv.statusDuplicated')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-destructive whitespace-nowrap">
                    <XCircle size={13} />
                    {t('importCsv.statusFailed')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomerOrderImport;
