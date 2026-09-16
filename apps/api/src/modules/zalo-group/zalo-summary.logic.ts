import { randomUUID } from 'node:crypto';

import type { ZaloSummaryTask } from 'shared';
import { FULFILLMENT_STAGE_LABELS, ZaloSummaryLevel } from 'shared';

/**
 * Các hàm THUẦN của tóm tắt nhóm Zalo — tách khỏi `ZaloSummaryService` để
 * kiểm thử được mà không cần Mongo/BullMQ/SDK.
 *
 * Quy ước: hàm ở đây không đọc env, không gọi mạng, không dùng `Date.now()`
 * ngầm — mốc thời gian luôn được truyền vào, để test chạy ổn định.
 */

/** Hình dạng JSON mà mô hình phải trả về. */
export interface KetQua {
  tieuDe: string;
  khachQuanTam: string;
  salePhanHoi: string;
  tonDong: string;
  checklist: string[];
  nghiNgo: string[];
  mucDo: string;
}

const chuanHoaViec = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ');

const MA_DON = /\b[a-z]{1,3}-\d{4,6}-\d{4,6}\b/g;

/**
 * Độ giống 0..1 giữa hai câu việc. Lỗi cần bắt là ĐỔI CHỮ ("Gửi lại báo giá"
 * vs "Gửi báo giá"), không phải gõ sai — nên Dice trên tập từ là đủ, không cần
 * thư viện. Hai việc cùng nhắc mã đơn mà KHÁC mã → 0 tuyệt đối: hai đơn là hai việc.
 */
export function doGiongViec(a: string, b: string): number {
  const ca = chuanHoaViec(a);
  const cb = chuanHoaViec(b);
  const maA = new Set(ca.match(MA_DON) ?? []);
  const maB = new Set(cb.match(MA_DON) ?? []);
  if (maA.size > 0 && maB.size > 0 && ![...maA].some((m) => maB.has(m))) return 0;

  const ta = ca.split(/\s+/).filter((t) => t.length >= 2);
  const tb = cb.split(/\s+/).filter((t) => t.length >= 2);
  if (ta.join(' ') === tb.join(' ')) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;

  const A = new Set(ta);
  const B = new Set(tb);
  let chung = 0;
  for (const t of A) if (B.has(t)) chung += 1;

  return (2 * chung) / (A.size + B.size);
}

/** Từ ngưỡng này trở lên coi là cùng một việc. 0,6: "Gửi lại báo giá cho anh Nam" ~ "Gửi báo giá cho anh Nam" ≈ 0,9. */
const NGUONG_GIONG = 0.6;

/**
 * Gộp danh sách việc mới với danh sách cũ, GIỮ id/tick/mốc của việc "giống"
 * (khớp mờ, tham lam theo điểm giảm dần, mỗi việc cũ chỉ ghép một việc mới).
 * Bản cũ khớp y nguyên chữ nên mô hình đổi một từ là mất tick — nút tick vô nghĩa.
 *
 * `taoId` tiêm được để test ổn định.
 */
export function gopChecklist(
  moi: string[],
  cu: ZaloSummaryTask[],
  bayGio: Date,
  taoId: () => string = randomUUID,
): ZaloSummaryTask[] {
  const cap: { i: number; j: number; diem: number }[] = [];
  moi.forEach((v, i) =>
    cu.forEach((c, j) => {
      const diem = doGiongViec(v, c.viec);
      if (diem >= NGUONG_GIONG) cap.push({ i, j, diem });
    }),
  );
  cap.sort((x, y) => y.diem - x.diem);

  const ghep = new Map<number, number>();
  const daDung = new Set<number>();
  for (const { i, j } of cap) {
    if (ghep.has(i) || daDung.has(j)) continue;
    ghep.set(i, j);
    daDung.add(j);
  }

  return moi.map((viec, i) => {
    const j = ghep.get(i);
    const truoc = j === undefined ? undefined : cu[j];

    return {
      id: truoc?.id ?? taoId(),
      viec,
      xong: truoc?.xong ?? false,
      taoLuc: truoc?.taoLuc ?? bayGio.toISOString(),
      xongLuc: truoc?.xongLuc ?? null,
    };
  });
}

/** Ép kết quả về đúng kiểu — structured output đã ràng buộc, đây là lưới cuối. */
export function chuanHoa(o: unknown): KetQua {
  const r = (o ?? {}) as Record<string, unknown>;
  const chuoi = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const mangChuoi = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  const mucDo = chuoi(r.mucDo);

  return {
    tieuDe: chuoi(r.tieuDe),
    khachQuanTam: chuoi(r.khachQuanTam),
    salePhanHoi: chuoi(r.salePhanHoi),
    tonDong: chuoi(r.tonDong),
    checklist: mangChuoi(r.checklist),
    nghiNgo: mangChuoi(r.nghiNgo),
    mucDo: ([ZaloSummaryLevel.BinhThuong, ZaloSummaryLevel.CanChuY, ZaloSummaryLevel.Gap] as string[]).includes(
      mucDo,
    )
      ? mucDo
      : ZaloSummaryLevel.BinhThuong,
  };
}

/**
 * `DD/MM HH:MM` theo giờ Việt Nam — khuôn mà lời nhắc yêu cầu mô hình trích lại.
 * Cộng cứng +7h rồi đọc bằng `getUTC*`: KHÔNG phụ thuộc múi giờ của máy chạy
 * worker, nên máy đặt UTC hay +07 đều ra cùng một kết quả.
 */
export function dinhDangLuc(d: Date): string {
  const vn = new Date(d.getTime() + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');

  return `${p(vn.getUTCDate())}/${p(vn.getUTCMonth() + 1)} ${p(vn.getUTCHours())}:${p(vn.getUTCMinutes())}`;
}

/** Nhãn công đoạn tiếng Việt; đơn chưa vào xưởng thì nói rõ đang ở đâu. */
export function nhanChang(stage?: string): string {
  if (!stage) return 'chưa vào công đoạn xưởng';

  return FULFILLMENT_STAGE_LABELS[stage as keyof typeof FULFILLMENT_STAGE_LABELS] ?? stage;
}

/**
 * Một dòng mô tả trạng thái đơn cho mô hình đọc.
 *
 * Thứ tự kiểm QUAN TRỌNG và giống `OrderJourney.md §2`: hủy → giữ → xong →
 * công đoạn. Đơn bị giữ vẫn còn nguyên công đoạn cũ trong dữ liệu, đọc sai thứ
 * tự là báo nhầm "đang chạy" cho một đơn đứng im.
 *
 * `bayGio` mặc định là lúc gọi — giữ nguyên hành vi cũ; test truyền mốc cố định.
 */
export function moTaDon(d: Record<string, unknown>, _bayGio: Date = new Date()): string {
  // MỐC TUYỆT ĐỐI, KHÔNG PHẢI TUỔI TƯƠNG ĐỐI. Bản tóm tắt được lưu lại và đọc
  // nhiều ngày sau, nên "đã 3 ngày" viết hôm nay sẽ vẫn đọc là "3 ngày" vào
  // tuần sau — người đọc không có cách nào biết câu đó viết lúc nào. Chuyện này
  // đã xảy ra thật: nhóm tóm tắt ngày 29/08 ghi "treo 3 ngày", đọc ngày 16/09
  // ai cũng tưởng mới treo, thực tế 21 ngày (báo cáo đội agent 16/09/2026).
  // Ghi ngày cụ thể thì câu chữ đúng mãi mãi, ai đọc cũng tự trừ ra tuổi thật.
  // `_bayGio` giữ lại cho tương thích chữ ký — không còn dùng để tính tuổi.
  if (d.cancelledAt) return 'ĐÃ HỦY';
  if (d.heldAt) {
    return `ĐANG BỊ GIỮ từ ${dinhDangLuc(new Date(d.heldAt as Date))}${d.holdReason ? ` (lý do: ${String(d.holdReason)})` : ''}`;
  }
  if (d.fulfillmentCompletedAt) {
    return `đã xong sản xuất lúc ${dinhDangLuc(new Date(d.fulfillmentCompletedAt as Date))}`;
  }

  const phan: string[] = [nhanChang(d.currentFulfillmentStage as string | undefined)];
  if (d.productionError) {
    phan.push(`ĐANG CÓ LỖI: ${String(d.productionError)}${d.productionErrorNote ? ` — ${String(d.productionErrorNote)}` : ''}`);
  }
  if (d.inProductionAt) {
    phan.push(`vào sản xuất lúc ${dinhDangLuc(new Date(d.inProductionAt as Date))}`);
  }

  return phan.join(', ');
}

const DUOI_ANH = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp']);
const DUOI_VIDEO = new Set(['mp4', 'mov', 'm4v', 'avi']);
const DUOI_TEP = new Set([
  'pdf', 'xlsx', 'xls', 'docx', 'doc', 'csv', 'zip', 'rar', '7z', 'ai', 'psd', 'cdr', 'eps', 'svg', 'txt', 'pptx',
]);

const duoiCua = (s: string): string => {
  const m = /\.([a-z0-9]{1,5})$/i.exec(s.split('?')[0].split('#')[0]);

  return m ? m[1].toLowerCase() : '';
};

const tenTepTu = (href: string): string => {
  try {
    const p = new URL(href).pathname;

    return decodeURIComponent(p.slice(p.lastIndexOf('/') + 1));
  } catch {
    return '';
  }
};

const hostCua = (href: string): string => {
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
};

/**
 * Đổi tin ĐÍNH KÈM (engine lưu dạng JSON thô) thành một dòng chữ mô hình đọc được.
 *
 * Vì sao: 20% tin trong 30 ngày là `{"title":"x.pdf","href":...}` (tệp),
 * `{"title":"","href":"...photo..."}` (ảnh) hay `{"id":..,"catId":..,"type":3}`
 * (sticker). Để nguyên thì mô hình phải tự đoán từ JSON — và đã đoán sai: một
 * PDF báo cáo được gửi lúc 31/08 17:50 mà tóm tắt kết luận "hẹn gửi nhưng chưa
 * xác nhận đã gửi". Dòng `[TỆP: tên]` là bằng chứng ĐÃ GỬI, prompt sẽ nói rõ.
 *
 * KHÔNG in URL: tốn token, không mang tín hiệu. Tin không phải JSON giữ nguyên.
 */
export function moTaDinhKem(noiDung: string): string {
  const t = noiDung.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return noiDung;

  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(t);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return noiDung;
    o = parsed as Record<string, unknown>;
  } catch {
    return noiDung;
  }

  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const desc = typeof o.description === 'string' ? o.description.trim() : '';
  const href = typeof o.href === 'string' ? o.href : '';
  const ext = duoiCua(title) || (href ? duoiCua(tenTepTu(href)) : '');

  if (!href) {
    const laSticker = 'catId' in o || o.type === 3 || ('id' in o && Object.keys(o).length <= 3);

    return laSticker ? '[STICKER]' : '[ĐÍNH KÈM]';
  }

  if (DUOI_ANH.has(ext) || /photo-|\/photo\//i.test(href)) return `[ẢNH]${title ? ` ${title}` : ''}`;
  if (DUOI_VIDEO.has(ext)) return `[VIDEO]${title ? ` ${title}` : ''}`;
  if (DUOI_TEP.has(ext)) return `[TỆP: ${title || tenTepTu(href)}]${desc ? ` — ${desc}` : ''}`;

  return `[LIÊN KẾT: ${title || hostCua(href) || 'không rõ'}]${desc ? ` — ${desc.slice(0, 120)}` : ''}`;
}

/**
 * Mã (đơn, SKU, vận đơn…) xuất hiện trong ĐẦU RA của mô hình mà KHÔNG có trong
 * nguồn. Chỉ để ghi log — không tự sửa, vì thay bằng mã gần giống có thể sai nặng
 * hơn (đã gặp: FBCRTOPTIM thay cho FBCROPTOPVNECK).
 * Mẫu: chữ hoa ASCII đầu, ≥6 ký tự hoa/số/gạch — từ tiếng Việt có dấu không khớp.
 *
 * `nguon` PHẢI gồm đủ ba thứ mô hình được đọc: tin nhắn, khối dữ liệu đơn, VÀ
 * bản tóm tắt lần trước (lượt cuốn chiếu chỉ gửi tin MỚI, mã cũ nằm ở bản trước).
 * Thiếu phần thứ ba thì 20/27 cảnh báo là kêu oan — đo trên dev 03/09.
 *
 * Mã là KHÚC ĐẦU/khúc con của một mã có thật (`AS-02077` ⊂ `AS-02077-17505`) coi
 * như cắt cụt, KHÔNG báo: nó ồn mà không chỉ ra được chuyện bịa mã.
 */
export function maKhongCoTrongNguon(ketQua: KetQua, nguon: string): string[] {
  const MAU = /\b[A-Z][A-Z0-9-]{5,}\b/g;
  const dauRa = [ketQua.tieuDe, ketQua.khachQuanTam, ketQua.salePhanHoi, ketQua.tonDong, ...ketQua.checklist, ...ketQua.nghiNgo].join(
    '\n',
  );
  const trongNguon = [...new Set((nguon.toUpperCase().match(MAU) ?? []).map((m) => m.replace(/-+$/, '')))];
  const boNguon = new Set(trongNguon);
  const la = new Set<string>();
  for (const m of dauRa.match(MAU) ?? []) {
    const ma = m.replace(/-+$/, '');
    if (boNguon.has(ma)) continue;
    if (trongNguon.some((x) => x.includes(ma))) continue;
    la.add(ma);
  }

  return [...la];
}

/**
 * Schema ép mô hình trả đúng khuôn (`outputFormat: json_schema` của Agent SDK).
 * Trùng với khối JSON mô tả trong lời nhắc; `chuanHoa` vẫn là lưới cuối.
 */
export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tieuDe', 'khachQuanTam', 'salePhanHoi', 'tonDong', 'checklist', 'nghiNgo', 'mucDo'],
  properties: {
    tieuDe: { type: 'string' },
    khachQuanTam: { type: 'string' },
    salePhanHoi: { type: 'string' },
    tonDong: { type: 'string' },
    checklist: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    nghiNgo: { type: 'array', items: { type: 'string' } },
    mucDo: { type: 'string', enum: [ZaloSummaryLevel.BinhThuong, ZaloSummaryLevel.CanChuY, ZaloSummaryLevel.Gap] },
  },
} as const;

const laKetQua = (o: unknown): o is Record<string, unknown> =>
  !!o && typeof o === 'object' && !Array.isArray(o) && ('mucDo' in o || 'tieuDe' in o);

/**
 * Tách khối JSON kết quả khỏi văn bản tự do của mô hình — đường lui khi SDK
 * không trả `structured_output`.
 *
 * Ba lớp: (1) cả chuỗi là JSON; (2) khối ```json; (3) quét từng dấu `{`, đếm
 * ngoặc CÓ NHẬN BIẾT CHUỖI, lấy object cân bằng đầu tiên parse được và có khoá
 * `mucDo`/`tieuDe`. Regex tham `/\{[\s\S]*\}/` của bản cũ vồ từ `{` đầu tới `}`
 * cuối — hai object liên tiếp hay một `}` trong chuỗi là hỏng cả lượt.
 */
export function tachJson(vanBan: string): Record<string, unknown> | null {
  const thu = (chuoi: string): Record<string, unknown> | null => {
    try {
      const o: unknown = JSON.parse(chuoi);

      return laKetQua(o) ? o : null;
    } catch {
      return null;
    }
  };

  const ca = thu(vanBan.trim());
  if (ca) return ca;

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(vanBan);
  if (fence) {
    const o = thu(fence[1].trim());
    if (o) return o;
  }

  for (let bat = vanBan.indexOf('{'); bat !== -1; bat = vanBan.indexOf('{', bat + 1)) {
    let sau = 0;
    let trongChuoi = false;
    for (let i = bat; i < vanBan.length; i += 1) {
      const c = vanBan[i];
      if (trongChuoi) {
        if (c === '\\') i += 1;
        else if (c === '"') trongChuoi = false;
        continue;
      }
      if (c === '"') trongChuoi = true;
      else if (c === '{') sau += 1;
      else if (c === '}') {
        sau -= 1;
        if (sau === 0) {
          const o = thu(vanBan.slice(bat, i + 1));
          if (o) return o;
          break;
        }
      }
    }
  }

  return null;
}

/** Bằng chứng cứng từ dữ liệu đơn, đếm ở `layDuLieuDon`. */
export interface BangChungDon {
  /** Đơn ĐƯỢC NHẮC trong chat đang bị giữ hoặc có lỗi (chưa hủy, chưa xong). */
  donNhacBiGiuHoacLoi: number;
  /** Đơn của KHÁCH (toàn bộ) đang bị giữ hoặc có lỗi. */
  donKhachBiGiuHoacLoi: number;
}

const THU_TU_MUC: string[] = [ZaloSummaryLevel.BinhThuong, ZaloSummaryLevel.CanChuY, ZaloSummaryLevel.Gap];

/**
 * Sàn `mucDo` từ bằng chứng cứng: đơn nhắc trong chat bị giữ/lỗi → ít nhất
 * `gap`; chỉ đơn toàn khách bị giữ/lỗi → ít nhất `can-chu-y`. KHÔNG BAO GIỜ hạ.
 *
 * Vì sao không sàn `gap` theo số toàn khách: một khách lớn có một đơn giữ cũ
 * sẽ làm mọi nhóm của họ `gap` mãi — đúng cái nhãn mất tác dụng.
 */
export function apDungSanMucDo(mucDoMoHinh: string, bangChung: BangChungDon): { mucDo: string; nangTu?: string } {
  const san =
    bangChung.donNhacBiGiuHoacLoi > 0
      ? ZaloSummaryLevel.Gap
      : bangChung.donKhachBiGiuHoacLoi > 0
        ? ZaloSummaryLevel.CanChuY
        : ZaloSummaryLevel.BinhThuong;
  if (THU_TU_MUC.indexOf(san) > THU_TU_MUC.indexOf(mucDoMoHinh)) return { mucDo: san, nangTu: mucDoMoHinh };

  return { mucDo: mucDoMoHinh };
}

/**
 * Quyết định một nhóm có vào hàng đợi không, và đọc kiểu gì — tách khỏi
 * `getQueue` để kiểm thử được. `null` = không xếp.
 */
export type LyDoBoQuaTomTat = 'chua-co-tin' | 'nhom-im-lau' | 'khong-co-tin-moi';

export interface PhanLoaiHangDoi {
  /** `null` = không xếp lượt này. */
  xepHang: { tuMoc: Date | null; docLaiTuDau: boolean; denMocTin: Date | null } | null;
  /** Chỉ có khi `xepHang === null` — vì sao nhóm này không được tóm tắt lại. */
  lyDoBoQua: LyDoBoQuaTomTat | null;
}

/**
 * Cùng bộ luật với `quyetDinhHangDoi`, nhưng NÓI RA lý do bỏ qua thay vì trả
 * `null` câm.
 *
 * Vì sao cần: bên ngoài nhìn vào bảng tóm tắt chỉ thấy "bản này cũ 18 ngày" mà
 * không biết cũ vì cố ý (nhóm im, không có tin mới) hay vì summarizer bỏ sót.
 * Đội agent đã phải đoán và đoán sai theo hướng "hệ chạy không đều" (báo cáo
 * 16/09/2026). Lý do được ghi thẳng vào bản ghi để công cụ bên kia tự lọc.
 */
export function phanLoaiHangDoi(x: {
  lastMessageAt?: Date | null;
  denMocTin?: Date | null;
  docDayDuLuc?: Date | null;
  now: number;
  ngayDocLai: number;
  ngayBoQua: number;
}): PhanLoaiHangDoi {
  // Nhóm chưa có tin, hoặc im quá lâu → bỏ qua, khỏi tốn tiền gọi mô hình.
  if (!x.lastMessageAt) return { xepHang: null, lyDoBoQua: 'chua-co-tin' };
  if (x.lastMessageAt.getTime() < x.now - x.ngayBoQua * 86_400_000) {
    return { xepHang: null, lyDoBoQua: 'nhom-im-lau' };
  }
  // Đã tóm tắt tới đúng tin cuối rồi thì không có gì mới để đọc.
  if (x.denMocTin && x.denMocTin.getTime() >= x.lastMessageAt.getTime()) {
    return { xepHang: null, lyDoBoQua: 'khong-co-tin-moi' };
  }

  const docLai = !x.docDayDuLuc || x.now - x.docDayDuLuc.getTime() > x.ngayDocLai * 86_400_000;

  return {
    xepHang: {
      // Đọc lại từ đầu thì bỏ mốc, lấy toàn bộ.
      tuMoc: docLai ? null : (x.denMocTin ?? null),
      docLaiTuDau: docLai,
      denMocTin: x.denMocTin ?? null,
    },
    lyDoBoQua: null,
  };
}

/** Bản rút gọn của `phanLoaiHangDoi` — giữ cho chỗ gọi chỉ cần biết có xếp hay không. */
export function quyetDinhHangDoi(x: {
  lastMessageAt?: Date | null;
  denMocTin?: Date | null;
  docDayDuLuc?: Date | null;
  now: number;
  ngayDocLai: number;
  ngayBoQua: number;
}): { tuMoc: Date | null; docLaiTuDau: boolean; denMocTin: Date | null } | null {
  return phanLoaiHangDoi(x).xepHang;
}
