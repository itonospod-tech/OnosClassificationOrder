import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductionOrderRow } from 'shared';
import { isSystemOnlyPriority } from 'shared';

import { RepositoryRemote } from '@/services';

/** Số thẻ đầu cột "Chờ làm" lấy về để dò — BE xếp mức ưu tiên cao nhất lên đầu. */
const URGENT_PEEK = 30;
/** Quá thời gian này mà chưa dò xong thì cho hoàn thành luôn — không chặn chuyền vì mạng chậm. */
const RESOLVE_TIMEOUT_MS = 2000;

export interface UrgentWaitingCard {
  _id: string;
  productionId: string;
  type?: string;
  size?: string;
}

/**
 * Đơn mức 4 "Làm ngay" đang chờ ở CÔNG ĐOẠN + XƯỞNG của công nhân (mọi ngày vào sản xuất), trừ
 * đơn đang mở. Popup quét dùng để nhắc trước khi hoàn thành một đơn thường (Orders.md §17.5).
 * Lỗi mạng → coi như không có (fail-open).
 */
export function useUrgentWaiting(enabled: boolean, excludeId: string) {
  const [list, setList] = useState<UrgentWaitingCard[]>([]);
  const pendingRef = useRef<Promise<UrgentWaitingCard[]>>(Promise.resolve([]));

  useEffect(() => {
    if (!enabled) {
      setList([]);
      pendingRef.current = Promise.resolve([]);
      return;
    }
    let alive = true;
    const p = RepositoryRemote.fulfillment
      // createdFrom/To rỗng = mọi ngày (BE phân biệt rỗng với không truyền = 7 ngày).
      .myTasks({ tab: 'waiting', size: URGENT_PEEK, createdFrom: '', createdTo: '' })
      .then((res) =>
        ((res.data?.data ?? []) as ProductionOrderRow[])
          .filter((o) => isSystemOnlyPriority(o.priority) && o._id !== excludeId)
          .map((o) => ({ _id: o._id, productionId: o.productionId, type: o.type, size: o.size })),
      )
      .catch(() => [] as UrgentWaitingCard[]);
    pendingRef.current = p;
    void p.then((l) => {
      if (alive) setList(l);
    });
    return () => {
      alive = false;
    };
  }, [enabled, excludeId]);

  /** Kết quả dò (chờ tối đa `RESOLVE_TIMEOUT_MS` nếu công nhân quét OK ngay khi popup vừa mở). */
  const resolve = useCallback(
    () =>
      Promise.race([
        pendingRef.current,
        new Promise<UrgentWaitingCard[]>((r) => setTimeout(() => r([]), RESOLVE_TIMEOUT_MS)),
      ]),
    [],
  );

  return { list, resolve, mayHaveMore: list.length >= URGENT_PEEK - 1 };
}
