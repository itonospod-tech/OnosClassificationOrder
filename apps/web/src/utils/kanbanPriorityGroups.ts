import type { OrderPriority } from 'shared';

/**
 * Key nhóm ghim theo mức ưu tiên — có ký tự điều khiển đầu để không bao giờ trùng tên loại
 * sản phẩm thật (key cũng là key collapse của nhóm).
 */
const PRIORITY_GROUP_PREFIX = '\u0001priority:';

interface GroupableCard {
  type?: string | null;
  size?: string | null;
  priority?: number | null;
}

/** Mức ưu tiên của nhóm ghim, `null` nếu là nhóm loại sản phẩm thường. */
export function priorityGroupLevel(key: string): OrderPriority | null {
  if (!key.startsWith(PRIORITY_GROUP_PREFIX)) return null;
  return Number(key.slice(PRIORITY_GROUP_PREFIX.length)) as OrderPriority;
}

/**
 * Gom thẻ kanban: thẻ có ưu tiên (priority ≥ 1) vào nhóm GHIM ĐẦU CỘT theo mức (cao → thấp),
 * trong nhóm xếp theo loại sản phẩm rồi size; thẻ thường gom theo loại sản phẩm A→Z, trong nhóm
 * theo size như cũ. Trước đây mọi thẻ chỉ gom theo loại A→Z nên thứ tự ưu tiên BE trả về bị mất
 * (Orders.md §17.5). `Array.sort` ổn định → cùng khoá vẫn giữ thứ tự BE.
 */
export function groupCardsPinPriority<T extends GroupableCard>(
  cards: T[],
  noTypeLabel: string,
  sizeRank: (size?: string) => number,
): [string, T[]][] {
  const bySize = (a: T, b: T) => sizeRank(a.size ?? undefined) - sizeRank(b.size ?? undefined);
  const pinned = new Map<number, T[]>();
  const byType = new Map<string, T[]>();
  for (const c of cards) {
    const p = Number(c.priority) || 0;
    if (p > 0) pinned.set(p, [...(pinned.get(p) || []), c]);
    else {
      const k = c.type || noTypeLabel;
      byType.set(k, [...(byType.get(k) || []), c]);
    }
  }
  for (const arr of pinned.values()) {
    arr.sort((a, b) => (a.type || noTypeLabel).localeCompare(b.type || noTypeLabel) || bySize(a, b));
  }
  for (const arr of byType.values()) arr.sort(bySize);
  return [
    ...[...pinned.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([p, rows]): [string, T[]] => [`${PRIORITY_GROUP_PREFIX}${p}`, rows]),
    ...[...byType.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  ];
}
