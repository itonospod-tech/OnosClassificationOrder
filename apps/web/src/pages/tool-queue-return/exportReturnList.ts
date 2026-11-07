import dayjs from 'dayjs';
import type { ToolQueueReturnRow } from 'shared';
import * as XLSX from 'xlsx';

type Tr = (key: string, opts?: Record<string, unknown>) => string;

/** Excel sheet names: max 31 chars, none of `: \ / ? * [ ]`, and unique inside the workbook. */
function sheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[:\\/?*[\]]/g, ' ').trim() || '—').slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());

  return name;
}

/**
 * The list of orders a run would take, one sheet per factory (so each factory sees only its own
 * orders), plus one sheet with the orders that would NOT be returned and why. Same download helper as
 * the other exports (`XLSX.writeFile`), no extra library.
 */
export function buildReturnWorkbook(rows: ToolQueueReturnRow[], t: Tr): XLSX.WorkBook {
  const header = [t('col.order'), t('col.product'), t('col.factory'), t('col.toolResult'), t('col.inProductionAt')];
  const line = (r: ToolQueueReturnRow) => [
    r.productionId,
    r.type ?? '',
    r.factoryShortName ?? '',
    r.toolResult,
    r.inProductionAt ? dayjs(r.inProductionAt).format('DD/MM/YYYY') : '',
  ];
  const widths = [{ wch: 20 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const byFactory = new Map<string, ToolQueueReturnRow[]>();
  for (const r of rows.filter((x) => x.returnable)) {
    const k = r.factoryShortName || r.factoryId || '—';
    byFactory.set(k, [...(byFactory.get(k) ?? []), r]);
  }
  for (const [factory, list] of [...byFactory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ws = XLSX.utils.aoa_to_sheet([header, ...list.map(line)]);
    ws['!cols'] = widths;
    XLSX.utils.book_append_sheet(wb, ws, sheetName(factory, used));
  }

  const blocked = rows.filter((x) => !x.returnable);
  if (blocked.length > 0) {
    const ws = XLSX.utils.aoa_to_sheet([
      [...header, t('col.reason')],
      ...blocked.map((r) => [...line(r), r.blockReason ? t(`block.${r.blockReason}`) : '']),
    ]);
    ws['!cols'] = [...widths, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName(t('export.sheetBlocked'), used));
  }

  return wb;
}

export function exportReturnList(rows: ToolQueueReturnRow[], t: Tr) {
  XLSX.writeFile(buildReturnWorkbook(rows, t), `${t('export.file')}-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`, { bookType: 'xlsx' });
}
