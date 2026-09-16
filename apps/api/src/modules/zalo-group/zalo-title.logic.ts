/**
 * Tách mã khách ra khỏi TÊN NHÓM Zalo — hàm thuần, không đụng DB.
 *
 * Vì sao cần (đo trên prod 11/09/2026): luật cũ so chuỗi con `title.includes(sku)`
 * chỉ khớp **7/52** nhóm chưa xét. Nhìn vào phần trượt thì thấy tên nhóm có
 * khuôn rõ ràng — `OnosPod/ 2025/ TUYEN/ KL/ TOPUP` — và mã hay dính đuôi loại
 * tài khoản (`VUDANDEBIT`, `SIMPLEHUBDEBIT`, `XHAODEBIT`). So chuỗi con bỏ sót
 * cả hai chuyện đó.
 *
 * Quan trọng hơn: 45 nhóm còn lại trượt KHÔNG phải vì luật yếu, mà vì mã trong
 * tên nhóm **chưa tồn tại trong bảng khách** (`TRINITY`, `VUDAN`, `SIMPLEHUB`…
 * đều 0 đơn). Bảng `customers` sinh ra TỪ đơn hàng, nên seller có nhóm mà chưa
 * đặt đơn thì không có gì để khớp vào. Vì thế hàm này trả về **mã ứng viên**
 * chứ không phải khách — chỗ gọi tự quyết định là ghép vào khách sẵn có hay đề
 * nghị người vận hành tạo khách mới.
 */

/** Đuôi loại tài khoản hay dính liền mã: `VUDANDEBIT` → `VUDAN`. */
const ACCOUNT_SUFFIXES = ['DEBIT', 'TOPUP', 'CREDIT'];

/** Từ trong tên nhóm KHÔNG bao giờ là mã khách. */
const STOPWORDS = new Set([
  'ONOSPOD',
  'ONOSEX',
  'ONOS',
  'POD',
  'KL',
  'PN',
  'US',
  'VN',
  'VIP',
  'DEBIT',
  'TOPUP',
  'CREDIT',
  'WEB',
  'BOD',
  'LED',
  'NHOM',
  'GROUP',
  'TEAM',
  'TEST',
]);

/** Bỏ dấu tiếng Việt để so không phân biệt dấu. */
export function boDau(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

/** Cắt đuôi loại tài khoản nếu phần còn lại vẫn đủ dài để là một mã. */
function boDuoi(token: string): string {
  for (const suffix of ACCOUNT_SUFFIXES) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
  }

  return token;
}

/**
 * Mã ứng viên rút từ tên nhóm, xếp theo độ tin cậy giảm dần.
 *
 * Tách theo `/` trước vì đó là khuôn thật của tên nhóm; trong mỗi đoạn còn tách
 * tiếp theo khoảng trắng và dấu ngoặc để bắt được `BOD - Hào/ VIP (XHAODEBIT)`.
 */
export function macUngVien(title: string): string[] {
  // Bỏ dấu TRƯỚC khi lọc ký tự: lọc trước thì "Nhóm" thành "NHM", "Việt" thành
  // "VIT" — mã rác trông y như mã thật, và nó lọt vào ô đề nghị tạo khách mới.
  const raw = boDau(title ?? '').toUpperCase();
  const tokens = raw
    .split(/[/\\|()[\]{},;:]+/)
    .flatMap((seg) => seg.split(/[\s_-]+/))
    .map((t) => t.replace(/[^A-Z0-9]/g, '').trim())
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    // Năm (2024/2025/2026) và số lẻ không phải mã.
    if (/^\d+$/.test(token)) continue;
    for (const candidate of [token, boDuoi(token)]) {
      if (candidate.length < 3 || candidate.length > 24) continue;
      if (STOPWORDS.has(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }

  // Mã dài đứng trước: `SIMPLEHUBDEBIT` chắc hơn `SIMPLEHUB`, `PN` thì đã bị loại.
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Tên nhóm có theo khuôn nhóm seller không.
 *
 * Khuôn thật trên prod: `OnosPod/ 2025/ TUYEN/ KL/ TOPUP` — có tiền tố hệ thống
 * và chia đoạn bằng `/`. Đây là dấu hiệu đáng tin duy nhất để phân biệt nhóm của
 * khách với nhóm nội bộ đặt tên tự do.
 */
export function theoKhuonSeller(title: string): boolean {
  const t = boDau(title ?? '');

  return (t.includes('onospod') || t.includes('onosex')) && t.split('/').length >= 3;
}

export interface KhopMaResult {
  /** Mã khớp ĐÚNG một khách đang có. */
  matched?: { sku: string; score: number; reason: string };
  /** Mã trông như mã khách nhưng CHƯA có khách nào — gợi ý tạo mới. */
  unknownSku?: string;
}

/**
 * Ghép tên nhóm với danh sách mã khách đang có.
 *
 * `skus` phải viết HOA. Trả `matched` khi khớp; không khớp thì trả `unknownSku`
 * — mã ứng viên tin cậy nhất — để người vận hành tạo khách ngay tại màn nối.
 */
export function khopTenNhom(title: string, skus: Set<string>): KhopMaResult {
  const candidates = macUngVien(title);

  for (const c of candidates) {
    if (!skus.has(c)) continue;
    // Mã ngắn dễ trùng ngẫu nhiên trong một câu tiếng Việt nên hạ điểm; mã dài
    // khớp nguyên thì gần như chắc chắn.
    const score = c.length >= 6 ? 0.95 : c.length >= 4 ? 0.75 : 0.6;

    return { matched: { sku: c, score, reason: `Tên nhóm chứa mã khách "${c}"` } };
  }

  // Chưa khớp ai thì CHỈ đề nghị tạo khách khi tên nhóm theo đúng khuôn nhóm
  // seller (`OnosPod/ 2025/ MÃ/ …`). Nhóm nội bộ đặt tên tự do như "Nhóm vải
  // siêm - A Soi Mê Linh" vẫn moi ra được vài từ trông như mã — đề nghị tạo
  // khách từ đó là đẩy rác vào bảng khách, mà rác ở đó thì rất khó dọn.
  if (!theoKhuonSeller(title)) return {};

  const unknown = candidates.find((c) => c.length >= 4);

  return unknown ? { unknownSku: unknown } : {};
}
