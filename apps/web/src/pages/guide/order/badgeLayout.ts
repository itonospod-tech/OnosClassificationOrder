import type { GuideInkGrid, GuideStep } from './guideTypes';

/** Đường kính huy hiệu số (px màn hình) co giãn theo tỉ lệ ảnh đang vẽ, trong khoảng này. */
export const BADGE_MIN_PX = 20;
export const BADGE_MAX_PX = 26;
/** Khe giữa huy hiệu và viền của CHÍNH nó (px màn hình) — đúng bằng vòng trắng `ring-2`, nên vòng chạm viền. */
export const BADGE_GAP_PX = 2;
/** Vòng trắng quanh huy hiệu (px màn hình) — tính vào vùng va chạm. */
const BADGE_RING_PX = 2;
/** Cạnh hình vuông tính "mực" bị che, theo tỉ lệ đường kính (xấp xỉ hình tròn). */
const INK_SIDE = 0.8;
/** Vị trí dính viền tốt nhất vẫn che quá tỉ lệ mực này → thử đường dẫn ngắn (leader line). */
const LEADER_COVER = 0.12;
/** Chiều dài tối đa của đường dẫn, tính theo số đường kính huy hiệu. */
const LEADER_MAX_D = 3;

/** Ảnh rộng (nguyên màn hình) hoặc dải ngang dẹt — chữ trên/dưới, ảnh chiếm cả bề ngang nội dung. */
export const isWideShot = (step: Pick<GuideStep, 'width' | 'height'>) =>
  step.width >= 1000 || step.width / step.height >= 1.9;

/**
 * Bề rộng tối thiểu ảnh được vẽ trong bài (px). Dưới mức này khung ảnh cho vuốt ngang
 * TRONG khung thay vì co tiếp (chữ trong ảnh không đọc được nữa).
 * - Ảnh rộng: ≤ 600px (vừa cột nội dung ở 640px trừ lề).
 * - Ảnh hẹp > 560px: 560px (vừa cột ảnh 36rem của bố cục 2 cột desktop).
 * - Ảnh hẹp ≤ 560px: co tới 326px (màn 360px trừ lề 16px mỗi bên + viền).
 */
export const shotMinWidth = (step: Pick<GuideStep, 'width' | 'height'>) => {
  if (isWideShot(step)) return Math.min(step.width, 600);
  return step.width > 560 ? 560 : Math.min(step.width, 326);
};

/**
 * Đường kính huy hiệu theo tỉ lệ ảnh đang vẽ (`scale` = px màn hình / px ảnh, ≤ 1): 20px khi ảnh vẽ
 * ≤ 1/2 cỡ gốc, tăng tuyến tính tới 26px ở cỡ gốc. Vùng bấm luôn rộng hơn 8px (`before:` trong
 * `AnnotatedShot`) → ≥ 28px trên điện thoại.
 *
 * Hàm này được chọn để kích thước huy hiệu tính ra px ẢNH ((d/2 + 2) / scale = 6 + 9/scale) GIẢM khi ảnh
 * vẽ to lên — nhờ vậy vị trí chọn ở cỡ nhỏ nhất vẫn hợp lệ ở mọi cỡ lớn hơn (xem `layoutBadges`).
 */
export const badgeDiameter = (scale: number) =>
  Math.min(BADGE_MAX_PX, Math.max(BADGE_MIN_PX, BADGE_MIN_PX + 12 * (scale - 0.5)));

export type BadgeSign = -1 | 0 | 1;

/**
 * Vị trí TÂM huy hiệu = điểm neo `ax/ay` (% ảnh, luôn là toạ độ của viền hoặc một điểm cố định)
 * + độ dời px màn hình `k × d/2 + g × BADGE_GAP_PX` (`badgeOffsetPx`). Neo theo % còn độ dời theo cỡ
 * huy hiệu thật → cùng một góc/cạnh của viền ở MỌI bề rộng, trong bài lẫn hộp phóng to.
 */
export interface BadgePlacement {
  /** `top-start`, `right-center`, `corner-tl`… hoặc `leader`. Giống nhau ở mọi cỡ. */
  slot: string;
  ax: number;
  ay: number;
  kx: BadgeSign;
  ky: BadgeSign;
  gx: BadgeSign;
  gy: BadgeSign;
  /** Chỉ có ở `leader`: điểm trên viền (% ảnh) nối tới tâm huy hiệu. */
  leader?: { x: number; y: number };
}

export type BadgeLayout = Record<number, BadgePlacement>;

/** Độ dời px màn hình của tâm huy hiệu so với điểm neo, trên 1 trục. */
export const badgeOffsetPx = (k: BadgeSign, g: BadgeSign, diameter: number) => (k * diameter) / 2 + g * BADGE_GAP_PX;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const intersects = (a: Rect, b: Rect) => a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01;
const contains = (r: Rect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
const around = (x: number, y: number, h: number): Rect => ({ x0: x - h, y0: y - h, x1: x + h, y1: y + h });
const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
const overlap = (a: Rect, b: Rect): Rect | null => {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
};
const area = (r: Rect | null) => (r ? (r.x1 - r.x0) * (r.y1 - r.y0) : 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const round3 = (v: number) => Math.round(v * 1000) / 1000;

const inkCache = new Map<string, Uint8Array>();
function decodeInk(ink: GuideInkGrid): Uint8Array {
  let bytes = inkCache.get(ink.data);
  if (!bytes) {
    const raw = atob(ink.data);
    bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
    inkCache.set(ink.data, bytes);
  }
  return bytes;
}

/** Diện tích (px² ảnh) ô "mực" nằm trong `r`, trừ phần nằm trong `exclude`. */
function inkArea(ink: GuideInkGrid, bytes: Uint8Array, r: Rect, exclude?: Rect) {
  const c = ink.cell;
  const cx0 = Math.max(0, Math.floor(r.x0 / c));
  const cx1 = Math.min(ink.cols - 1, Math.floor((r.x1 - 0.001) / c));
  const cy0 = Math.max(0, Math.floor(r.y0 / c));
  const cy1 = Math.min(ink.rows - 1, Math.floor((r.y1 - 0.001) / c));
  let total = 0;
  for (let y = cy0; y <= cy1; y += 1) {
    for (let x = cx0; x <= cx1; x += 1) {
      const i = y * ink.cols + x;
      if (bytes[i >> 3] & (1 << (i & 7))) {
        const hit = overlap(r, { x0: x * c, y0: y * c, x1: (x + 1) * c, y1: (y + 1) * c });
        total += area(hit) - (exclude && hit ? area(overlap(hit, exclude)) : 0);
      }
    }
  }
  return total;
}

function isInk(ink: GuideInkGrid, bytes: Uint8Array, x: number, y: number) {
  const cx = Math.floor(x / ink.cell);
  const cy = Math.floor(y / ink.cell);
  if (cx < 0 || cy < 0 || cx >= ink.cols || cy >= ink.rows) return false;
  const i = cy * ink.cols + cx;
  return (bytes[i >> 3] & (1 << (i & 7))) !== 0;
}

interface Candidate {
  p: BadgePlacement;
  rect: Rect;
  cover: number;
  cost: number;
}

const layoutCache = new Map<string, BadgeLayout>();

/**
 * Đặt huy hiệu số cho mọi chú thích của 1 ảnh. KHÔNG phụ thuộc bề rộng đang vẽ (cache theo ảnh) →
 * trong bài và hộp phóng to luôn cùng góc/cạnh.
 *
 * Hình học tính ở cỡ vẽ NHỎ NHẤT của ảnh (`shotMinWidth`), nơi huy hiệu chiếm nhiều ảnh nhất. Vì huy
 * hiệu neo vào viền và cỡ quy ra px ảnh chỉ giảm khi ảnh to lên (`badgeDiameter`), hình vuông của nó ở
 * cỡ lớn hơn nằm TRỌN trong hình vuông ở cỡ nhỏ nhất → hợp lệ ở cỡ nhỏ nhất thì hợp lệ ở mọi cỡ.
 *
 * Ràng buộc theo thứ tự ưu tiên:
 * 1. DÍNH viền của chính nó: ngoài viền, chạm cạnh (khe `BADGE_GAP_PX`) ở đầu/giữa/cuối/¼/¾ mỗi cạnh; hoặc
 *    đè lên GÓC viền khi góc đó không có mực của phần tử (`corner-*`).
 * 2. Luật cứng: nằm trong ảnh, không chạm viền chú thích khác, không chạm huy hiệu/đường dẫn đã đặt;
 *    `corner-*` không được đè mực bên trong viền của chính nó.
 * 3. Chọn chỗ che ít mực nhất (mực của phần tử chính nó không tính — nằm trong viền), rồi theo thứ tự
 *    ưu tiên trên → dưới → trái/phải. Tốt nhất vẫn che > `LEADER_COVER` → tìm chỗ trống trong bán kính
 *    `LEADER_MAX_D` đường kính và nối bằng đường dẫn ngắn (`leader`), nếu đường dẫn đó rẻ hơn.
 * Chú thích có ít lựa chọn hợp lệ nhất được đặt trước.
 */
export function layoutBadges(step: GuideStep): BadgeLayout {
  const cached = layoutCache.get(step.file);
  if (cached) return cached;

  const { width: W, height: H, ink } = step;
  const bytes = decodeInk(ink);
  const scale = Math.min(1, shotMinWidth(step) / W);
  const d = badgeDiameter(scale);
  const half = d / 2 / scale;
  const gap = BADGE_GAP_PX / scale;
  const reach = half + BADGE_RING_PX / scale;
  const inkHalf = half * INK_SIDE;
  const pct = (v: number, total: number) => round3((v / total) * 100);

  const boxes: Rect[] = step.callouts.map(({ boxPct: b }) => ({
    x0: (b.x / 100) * W,
    y0: (b.y / 100) * H,
    x1: ((b.x + b.w) / 100) * W,
    y1: ((b.y + b.h) / 100) * H,
  }));
  const placed: Rect[] = [];
  const segments: { x0: number; y0: number; x1: number; y1: number }[] = [];

  const segmentHits = (r: Rect) =>
    segments.some((sg) => {
      const n = Math.max(2, Math.ceil(Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0) / 3));
      for (let k = 0; k <= n; k += 1) {
        if (contains(r, sg.x0 + ((sg.x1 - sg.x0) * k) / n, sg.y0 + ((sg.y1 - sg.y0) * k) / n)) return true;
      }
      return false;
    });

  /** `relaxed` = bỏ luật "không chạm viền khác / huy hiệu khác", trả phạt thay vì loại (dự phòng cuối). */
  const evaluate = (i: number, p: BadgePlacement, pref: number, onBorder: boolean, relaxed = false): Candidate | null => {
    const cx = (p.ax / 100) * W + p.kx * half + p.gx * gap;
    const cy = (p.ay / 100) * H + p.ky * half + p.gy * gap;
    const rect = around(cx, cy, reach);
    if (rect.x0 < -0.01 || rect.y0 < -0.01 || rect.x1 > W + 0.01 || rect.y1 > H + 0.01) return null;
    let penalty = 0;
    const boxHits = boxes.filter((b, j) => j !== i && intersects(rect, b)).length;
    const badgeHits = placed.filter((q) => intersects(rect, q)).length + (segmentHits(rect) ? 1 : 0);
    if (boxHits || badgeHits) {
      if (!relaxed) return null;
      penalty = boxHits * 1000 + badgeHits * 10000;
    }
    // Mực đo ở CẢ 2 đầu cỡ: nhỏ nhất (huy hiệu to so với ảnh, xa viền hơn) và cỡ gốc (huy hiệu nhỏ, sát viền
    // hơn) — một chỗ có thể trống ở cỡ này nhưng đè nhãn ngay sát viền ở cỡ kia. Lấy mức che tệ hơn.
    const fullHalf = dAtFull / 2;
    const squares = [
      around(cx, cy, inkHalf),
      around(
        (p.ax / 100) * W + p.kx * fullHalf + p.gx * BADGE_GAP_PX,
        (p.ay / 100) * H + p.ky * fullHalf + p.gy * BADGE_GAP_PX,
        fullHalf * INK_SIDE,
      ),
    ];
    // Đè lên viền: phần lọt vào trong viền không được có mực. Viền đã co 6px vì ô mực 12px của phần tử BÊN
    // CẠNH có thể tràn vài px vào trong viền (mực thật của chính phần tử luôn nằm sâu hơn lề 5px của viền).
    const ownCore = grow(boxes[i], -6);
    const ownInk = onBorder
      ? squares.reduce((sum, sq) => {
          const inside = overlap(sq, ownCore);
          return sum + (inside ? inkArea(ink, bytes, inside) : 0);
        }, 0)
      : 0;
    if (ownInk > 0) {
      if (!relaxed) return null;
      penalty += 500;
    }
    const own = grow(boxes[i], 4);
    const cover = Math.max(...squares.map((sq) => inkArea(ink, bytes, sq, own) / area(sq)));
    return { p, rect, cover, cost: cover * 100 + pref + penalty };
  };

  /** Đường kính (px ảnh) khi ảnh vẽ đúng cỡ gốc — nhỏ nhất; dùng kiểm slot neo mép ảnh vẫn chạm viền. */
  const dAtFull = badgeDiameter(1);

  /** Các vị trí dọc 1 cạnh `[lo, hi]` của viền trên trục dài `total` (px ảnh). */
  const alongEdge = (lo: number, hi: number, total: number) => {
    const list: { name: string; a: number; k: BadgeSign; g: BadgeSign; pref: number }[] = [
      { name: 'start', a: lo, k: 1, g: 0, pref: 0 },
      { name: 'end', a: hi, k: -1, g: 0, pref: 0.5 },
      { name: 'center', a: (lo + hi) / 2, k: 0, g: 0, pref: 1 },
      { name: 'q1', a: lo + (hi - lo) * 0.25, k: 0, g: 0, pref: 2 },
      { name: 'q3', a: lo + (hi - lo) * 0.75, k: 0, g: 0, pref: 2 },
    ];
    // Viền sát mép ảnh (vd chip ở góc ảnh): huy hiệu sát MÉP ẢNH (chừa vòng trắng), chỉ nhận khi ở cỡ gốc
    // (huy hiệu nhỏ nhất tính theo px ảnh) nó vẫn phủ qua viền ≥ 3px → vẫn dính viền ở mọi cỡ.
    if (lo < 2 * reach && dAtFull - lo >= 3) list.push({ name: 'edge0', a: 0, k: 1, g: 1, pref: 2.5 });
    if (total - hi < 2 * reach && hi - (total - dAtFull) >= 3) {
      list.push({ name: 'edge1', a: total, k: -1, g: -1, pref: 2.5 });
    }
    return list;
  };

  const stickySlots = (i: number) => {
    const b = boxes[i];
    const out: { p: BadgePlacement; pref: number; onBorder: boolean }[] = [];
    const push = (slot: string, p: Omit<BadgePlacement, 'slot'>, pref: number, onBorder = false) =>
      out.push({ p: { slot, ...p }, pref, onBorder });
    const xs = alongEdge(b.x0, b.x1, W);
    const ys = alongEdge(b.y0, b.y1, H);

    // Ngoài viền, chạm cạnh.
    xs.forEach(({ name, a, k, g, pref }) => {
      push(`top-${name}`, { ax: pct(a, W), ay: pct(b.y0, H), kx: k, ky: -1, gx: g, gy: -1 }, pref);
      push(`bottom-${name}`, { ax: pct(a, W), ay: pct(b.y1, H), kx: k, ky: 1, gx: g, gy: 1 }, pref + 1);
    });
    ys.forEach(({ name, a, k, g, pref }) => {
      push(`left-${name}`, { ax: pct(b.x0, W), ay: pct(a, H), kx: -1, ky: k, gx: -1, gy: g }, pref + 1.5);
      push(`right-${name}`, { ax: pct(b.x1, W), ay: pct(a, H), kx: 1, ky: k, gx: 1, gy: g }, pref + 1.5);
    });

    // Đè lên chính đường viền (tâm nằm trên viền): 4 góc + đầu/giữa/cuối 4 cạnh. Chỉ hợp lệ khi phần lọt vào
    // trong viền không có mực (kiểm ở `evaluate`) — dành cho viền bị chú thích khác/mép ảnh bao kín.
    (
      [
        ['tl', b.x0, b.y0],
        ['tr', b.x1, b.y0],
        ['bl', b.x0, b.y1],
        ['br', b.x1, b.y1],
      ] as const
    ).forEach(([name, x, y], k) =>
      push(`corner-${name}`, { ax: pct(x, W), ay: pct(y, H), kx: 0, ky: 0, gx: 0, gy: 0 }, 8 + k * 0.5, true),
    );
    xs.slice(0, 3).forEach(({ name, a, k }) => {
      push(`on-top-${name}`, { ax: pct(a, W), ay: pct(b.y0, H), kx: k, ky: 0, gx: 0, gy: 0 }, 9, true);
      push(`on-bottom-${name}`, { ax: pct(a, W), ay: pct(b.y1, H), kx: k, ky: 0, gx: 0, gy: 0 }, 9.5, true);
    });
    ys.slice(0, 3).forEach(({ name, a, k }) => {
      push(`on-left-${name}`, { ax: pct(b.x0, W), ay: pct(a, H), kx: 0, ky: k, gx: 0, gy: 0 }, 9, true);
      push(`on-right-${name}`, { ax: pct(b.x1, W), ay: pct(a, H), kx: 0, ky: k, gx: 0, gy: 0 }, 9.5, true);
    });
    return out;
  };

  const bestSticky = (i: number, relaxed = false) => {
    let best: Candidate | null = null;
    stickySlots(i).forEach(({ p, pref, onBorder }) => {
      const c = evaluate(i, p, pref, onBorder, relaxed);
      if (c && (!best || c.cost < best.cost)) best = c;
    });
    return best as Candidate | null;
  };

  const bestLeader = (i: number) => {
    const b = boxes[i];
    const own = grow(b, 4);
    const maxLen = (LEADER_MAX_D * d) / scale;
    const stepPx = half / 1.5;
    let best: Candidate | null = null;
    for (let y = b.y0 - maxLen; y <= b.y1 + maxLen; y += stepPx) {
      for (let x = b.x0 - maxLen; x <= b.x1 + maxLen; x += stepPx) {
        const ex = clamp(x, b.x0, b.x1);
        const ey = clamp(y, b.y0, b.y1);
        const dist = Math.hypot(x - ex, y - ey);
        if (dist < reach + gap + half * 0.75 || dist > maxLen) continue;
        const p: BadgePlacement = {
          slot: 'leader',
          ax: pct(x, W),
          ay: pct(y, H),
          kx: 0,
          ky: 0,
          gx: 0,
          gy: 0,
          leader: { x: pct(ex, W), y: pct(ey, H) },
        };
        const c = evaluate(i, p, 0, false);
        if (!c || c.cover > 0.02) continue;
        // Đường dẫn: từ viền tới mép huy hiệu — không cắt viền khác / huy hiệu khác, càng ít mực càng tốt.
        const len = dist - reach;
        const n = Math.max(2, Math.ceil(len / 4));
        let inkHits = 0;
        let blocked = false;
        for (let k = 0; k <= n && !blocked; k += 1) {
          const t = (k / n) * (len / dist);
          const px = ex + (x - ex) * t;
          const py = ey + (y - ey) * t;
          if (boxes.some((bx, j) => j !== i && contains(bx, px, py)) || placed.some((q) => contains(q, px, py))) {
            blocked = true;
          } else if (!contains(own, px, py) && isInk(ink, bytes, px, py)) {
            inkHits += 1;
          }
        }
        if (blocked) continue;
        const cost = c.cover * 100 + (inkHits / (n + 1)) * 60 + (dist / (d / scale)) * 6;
        if (!best || cost < best.cost) best = { ...c, cost };
      }
    }
    return best as Candidate | null;
  };

  // Chú thích ít lựa chọn hợp lệ nhất đặt trước để không bị chú thích dễ tính giành mất chỗ.
  const order = step.callouts
    .map((_, i) => ({
      i,
      options: stickySlots(i).filter(({ p, pref, onBorder }) => evaluate(i, p, pref, onBorder)).length,
    }))
    .sort((a, b) => a.options - b.options || a.i - b.i)
    .map(({ i }) => i);

  const result: BadgeLayout = {};
  order.forEach((i) => {
    let pick = bestSticky(i);
    if (!pick || pick.cover > LEADER_COVER) {
      const leader = bestLeader(i);
      if (leader && (!pick || leader.cost < pick.cost)) pick = leader;
    }
    // Dự phòng cuối (chưa gặp ở 17 ảnh hiện tại): dính viền, chấp nhận chạm viền/huy hiệu khác ít nhất.
    pick = pick ?? bestSticky(i, true);
    const p: BadgePlacement = pick?.p ?? {
      slot: 'corner-tl',
      ax: pct(boxes[i].x0, W),
      ay: pct(boxes[i].y0, H),
      kx: 0,
      ky: 0,
      gx: 0,
      gy: 0,
    };
    if (pick) placed.push(pick.rect);
    if (p.leader) {
      segments.push({
        x0: (p.leader.x / 100) * W,
        y0: (p.leader.y / 100) * H,
        x1: (p.ax / 100) * W,
        y1: (p.ay / 100) * H,
      });
    }
    result[step.callouts[i].n] = p;
  });

  layoutCache.set(step.file, result);
  return result;
}
