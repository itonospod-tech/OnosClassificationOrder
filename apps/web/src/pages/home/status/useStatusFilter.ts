import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useFactoryScope } from '@/hooks/useFactoryScope';

export type StatusFilterCategory =
  | 'printStatus'
  | 'printStatusNote'
  | 'toolResult'
  | 'toolResultNote'
  | 'errorFile'
  | 'productionError'
  | 'assignee'
  | 'assigneeNote';

export type StatusFilter = {
  printStatus: string[];
  printStatusNote: string[];
  toolResult: string[];
  toolResultNote: string[];
  errorFile: string[];
  productionError: string[];
  assignee: string[];
  assigneeNote: string[];
  factoryId?: string;
  machineTypeId?: string;
  readyForFulfill?: boolean;
  /** Toggle nhanh "đơn lỗi cần xử lý" — set hasError=true. */
  hasError?: boolean;
  createdFrom?: string;
  createdTo?: string;
  search?: string;
};

const CSV_KEYS: StatusFilterCategory[] = [
  'printStatus',
  'printStatusNote',
  'toolResult',
  'toolResultNote',
  'errorFile',
  'productionError',
  'assignee',
  'assigneeNote',
];

function todayISO() {
  // Use local date components — `Date.toISOString()` converts to UTC, which
  // returns yesterday's date in UTC+ timezones during morning hours.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Status-tab filter state. ALL filters (workshop codes, factory, date range,
 * search...) round-trip through the URL so F5 / deep links / tab switches
 * preserve them. Default date = today — strip khỏi URL khi user không sửa.
 */
export function useStatusFilter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const factoryScope = useFactoryScope();

  // Dates đọc URL → fallback today. Sync ngược lên URL ở useEffect bên dưới.
  const [createdFrom, setCreatedFrom] = useState<string>(
    () => searchParams.get('createdFrom') || todayISO(),
  );
  const [createdTo, setCreatedTo] = useState<string>(
    () => searchParams.get('createdTo') || todayISO(),
  );

  // Sync date → URL. Luôn ghi (kể cả today) để URL reflect state user thấy.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        createdFrom ? sp.set('createdFrom', createdFrom) : sp.delete('createdFrom');
        createdTo ? sp.set('createdTo', createdTo) : sp.delete('createdTo');
        return sp;
      },
      { replace: true },
    );
  }, [createdFrom, createdTo, setSearchParams]);

  const filter: StatusFilter = useMemo(() => {
    const f: StatusFilter = {
      printStatus: [],
      printStatusNote: [],
      toolResult: [],
      toolResultNote: [],
      errorFile: [],
      productionError: [],
      assignee: [],
      assigneeNote: [],
    };
    for (const k of CSV_KEYS) {
      const raw = searchParams.get(k);
      if (raw) f[k] = raw.split(',').filter(Boolean);
    }
    // Through `useFactoryScope` (Orders.md §25) so a Fulfillment account stays on its own factory.
    const factoryId = factoryScope;
    const machineTypeId = searchParams.get('machineTypeId');
    const ready = searchParams.get('readyForFulfill');
    const hasError = searchParams.get('hasError');
    const search = searchParams.get('search') || undefined;
    if (factoryId) f.factoryId = factoryId;
    if (machineTypeId) f.machineTypeId = machineTypeId;
    if (ready === 'true') f.readyForFulfill = true;
    else if (ready === 'false') f.readyForFulfill = false;
    if (hasError === 'true') f.hasError = true;
    f.createdFrom = createdFrom;
    f.createdTo = createdTo;
    f.search = search;
    return f;
  }, [searchParams, createdFrom, createdTo, factoryScope]);

  const writeParams = useCallback(
    (mutator: (sp: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          mutator(sp);
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const toggle = useCallback(
    (category: StatusFilterCategory, code: string) => {
      writeParams((sp) => {
        const raw = sp.get(category);
        const arr = raw ? raw.split(',').filter(Boolean) : [];
        const idx = arr.indexOf(code);
        if (idx === -1) arr.push(code);
        else arr.splice(idx, 1);
        if (arr.length === 0) sp.delete(category);
        else sp.set(category, arr.join(','));
      });
    },
    [writeParams],
  );

  const setScalar = useCallback(
    (key: 'factoryId' | 'machineTypeId' | 'createdFrom' | 'createdTo' | 'search', value: string | undefined) => {
      // Dates: local state. Others: URL.
      if (key === 'createdFrom') {
        setCreatedFrom(value || todayISO());
        return;
      }
      if (key === 'createdTo') {
        setCreatedTo(value || todayISO());
        return;
      }
      writeParams((sp) => {
        if (value === undefined || value === '') sp.delete(key);
        else sp.set(key, value);
      });
    },
    [writeParams],
  );

  const setReady = useCallback(
    (value: boolean | undefined) => {
      writeParams((sp) => {
        if (value === undefined) sp.delete('readyForFulfill');
        else sp.set('readyForFulfill', String(value));
      });
    },
    [writeParams],
  );

  const setHasError = useCallback(
    (value: boolean | undefined) => {
      writeParams((sp) => {
        if (value === true) sp.set('hasError', 'true');
        else sp.delete('hasError');
      });
    },
    [writeParams],
  );

  const clearAll = useCallback(() => {
    writeParams((sp) => {
      for (const k of CSV_KEYS) sp.delete(k);
      sp.delete('factoryId');
      sp.delete('machineTypeId');
      sp.delete('readyForFulfill');
      sp.delete('hasError');
      sp.delete('search');
    });
    setCreatedFrom(todayISO());
    setCreatedTo(todayISO());
  }, [writeParams]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const k of CSV_KEYS) {
      if (filter[k].length > 0) params.set(k, filter[k].join(','));
    }
    if (filter.factoryId) params.set('factoryId', filter.factoryId);
    if (filter.machineTypeId) params.set('machineTypeId', filter.machineTypeId);
    if (typeof filter.readyForFulfill === 'boolean')
      params.set('readyForFulfill', String(filter.readyForFulfill));
    if (filter.hasError) params.set('hasError', 'true');
    if (filter.createdFrom) params.set('createdFrom', filter.createdFrom);
    if (filter.createdTo) params.set('createdTo', filter.createdTo);
    if (filter.search) params.set('search', filter.search);
    const s = params.toString();
    return s ? '?' + s : '';
  }, [filter]);

  const isActive = useMemo(
    () =>
      CSV_KEYS.some((k) => filter[k].length > 0) ||
      !!filter.factoryId ||
      !!filter.machineTypeId ||
      typeof filter.readyForFulfill === 'boolean' ||
      filter.hasError === true ||
      !!filter.search,
    [filter],
  );

  return { filter, queryString, isActive, toggle, setScalar, setReady, setHasError, clearAll };
}
