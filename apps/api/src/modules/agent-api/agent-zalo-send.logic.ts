import { ZaloGroupKind } from 'shared';

/**
 * Luật chặn cho đường GỬI Zalo của agent — hàm THUẦN, không đụng DB.
 *
 * Vì sao tách ra và vì sao có test riêng: mọi endpoint khác của Agent API là
 * CHỈ ĐỌC (BR-3) — sai thì cùng lắm trả nhầm số. Đường này nhắn ra ngoài, tới
 * người thật, và **không rút lại được**. Nó là chốt chặn duy nhất giữa một
 * agent và khách hàng của công ty, nên luật phải nằm ở chỗ đọc được và kiểm
 * được, không rải trong service.
 */

/**
 * Nhóm agent được phép gửi.
 *
 * `internal` (nội bộ công ty) và `operation` (nhóm vận hành, có cả người ngoài
 * như forwarder/nhà cung cấp nhưng là quan hệ công việc). CẤM tuyệt đối
 * `seller` — nhóm khách hàng; cấm `unreviewed` — chưa ai phân loại thì không
 * thể biết bên kia là ai; và cấm `private` — nhóm riêng tư của nhân viên.
 *
 * Đây là danh sách TRẮNG nên nhãn mới sinh ra sau này tự bị loại. Viết dạng đen
 * (chặn `seller`, cho phần còn lại) thì mỗi nhãn mới là một lỗ hổng im lặng.
 */
export const NHOM_DUOC_GUI: readonly string[] = [ZaloGroupKind.Internal, ZaloGroupKind.Operation];

/**
 * Vai được phép nhận tin nhắn RIÊNG từ agent.
 *
 * Danh sách TRẮNG, và cố ý ngắn. Nhóm còn có `kind` do người vận hành xét làm
 * chốt; DM thì không có gì tương đương — chốt duy nhất là danh tính người nhận.
 * Đo 12/09 trên prod: trong 61 người đang có hội thoại riêng với các nick công
 * ty, chỉ **7** đã được xét (4 chủ tịch + 3 nhân viên); 53 người còn lại chưa ai
 * xác nhận là ai. Cho phép theo kiểu "chưa thấy cấm thì gửi" nghĩa là agent nhắn
 * riêng cho 53 người mà không ai biết họ là khách hay người lạ.
 *
 * `ai-support` KHÔNG có trong danh sách: nhắn riêng cho một nick AI khác chỉ tạo
 * ra hai con máy nói chuyện với nhau.
 */
export const VAI_DUOC_DM: readonly string[] = ['chairman', 'staff'];

export const LY_DO_CHAN = {
  khongThayNhom: 'Không tìm thấy nhóm Zalo với mã này.',
  nhomKhach: 'CẤM gửi vào nhóm khách hàng — đường này chỉ dành cho nhóm nội bộ và nhóm vận hành.',
  chuaXet: 'Nhóm chưa được phân loại — phải xét ở màn Nối nhóm Zalo trước khi agent gửi được.',
  khongCoHoiThoai: 'Nhóm chưa có hội thoại nào để gửi (chưa nick nào của công ty ở trong nhóm).',
  hoiThoaiLac: 'conversationId không thuộc nhóm này.',
  rong: 'Nội dung rỗng.',
  khongThayHoiThoai: 'Không tìm thấy hội thoại với mã này.',
  khongPhaiDm: 'Đây là hội thoại NHÓM — gửi nhóm phải truyền groupGlobalId để đi qua chốt phân loại nhóm.',
  dmKhach: 'CẤM nhắn riêng cho khách hàng.',
  dmChuaXet: 'Chưa xác định người này là ai — phải xét ở màn Danh tính trước khi agent nhắn riêng.',
  thieuDich: 'Phải cho biết gửi đi đâu: groupGlobalId (nhóm) hoặc conversationId (nhắn riêng).',
} as const;

export interface NhomDeGui {
  kind?: string;
  conversationIds?: string[];
  title?: string;
}

export type KetQuaChon = { ok: true; ungVien: string[] } | { ok: false; lyDo: string };

/**
 * Quyết định được gửi vào những hội thoại nào, hoặc từ chối kèm lý do đọc được.
 *
 * Trả về **danh sách** chứ không một id: một nhóm có nhiều nick công ty ở trong,
 * mỗi nick một hội thoại, và nick có thể mất kết nối bất cứ lúc nào (bị Zalo đá,
 * chờ quét lại QR). Chọn cứng hội thoại đầu thì nhóm chết chỉ vì nick đầu đang
 * rớt, trong khi nick thứ hai vẫn gửi được — đã gặp thật ở lần chạy đầu trên
 * prod, engine trả `account_not_connected`. Bên gọi thử lần lượt.
 *
 * `conversationId` do agent truyền vẫn phải THUỘC nhóm đã duyệt — nếu không thì
 * chốt phân loại nhóm vô nghĩa: chỉ cần biết một id hội thoại bất kỳ là nhắn
 * được vào nhóm khách.
 */
export function chonHoiThoai(nhom: NhomDeGui | null, conversationId?: string): KetQuaChon {
  if (!nhom) return { ok: false, lyDo: LY_DO_CHAN.khongThayNhom };
  if (nhom.kind === ZaloGroupKind.Seller) return { ok: false, lyDo: LY_DO_CHAN.nhomKhach };
  if (!NHOM_DUOC_GUI.includes(String(nhom.kind))) return { ok: false, lyDo: LY_DO_CHAN.chuaXet };

  const ds = nhom.conversationIds ?? [];
  if (ds.length === 0) return { ok: false, lyDo: LY_DO_CHAN.khongCoHoiThoai };

  // Agent chỉ định thì tôn trọng: nó có thể đang muốn gửi bằng đúng nick nào đó.
  if (conversationId) {
    return ds.includes(conversationId) ? { ok: true, ungVien: [conversationId] } : { ok: false, lyDo: LY_DO_CHAN.hoiThoaiLac };
  }

  return { ok: true, ungVien: [...ds] };
}

/**
 * Người này có được nhận tin riêng từ agent không.
 *
 * MẶC ĐỊNH CẤM: vai không nằm trong danh sách trắng thì chặn, kể cả `unknown`.
 * `unknown` nghĩa là *chưa ai xét*, không phải *đã xét và thấy an toàn* — đối xử
 * với hai thứ đó như nhau là bỏ luôn ý nghĩa của việc xét.
 */
export function kiemNguoiNhanDm(vai: string | undefined): { ok: true } | { ok: false; lyDo: string } {
  if (vai && VAI_DUOC_DM.includes(vai)) return { ok: true };
  if (vai === 'customer') return { ok: false, lyDo: LY_DO_CHAN.dmKhach };

  return { ok: false, lyDo: LY_DO_CHAN.dmChuaXet };
}

/** Cắt và kiểm nội dung trước khi gửi. */
export function kiemNoiDung(content: string | undefined, tranKyTu = 4000): { ok: true; content: string } | { ok: false; lyDo: string } {
  const c = (content ?? '').trim();
  if (!c) return { ok: false, lyDo: LY_DO_CHAN.rong };

  // Cắt thay vì từ chối: tin quá dài thường là agent dán nhầm cả báo cáo, cắt
  // vẫn gửi được phần đầu còn hơn im lặng không gửi gì.
  return { ok: true, content: c.length > tranKyTu ? `${c.slice(0, tranKyTu - 1)}…` : c };
}

/**
 * Bảng mã Zalo mà engine chuyển tiếp nguyên trong `{"error":"zalo_tu_choi","code":N}`.
 *
 * Engine không tài liệu hoá bảng này, nên nó được bồi dần từ lỗi gặp thật. Ghi ra
 * đây để agent nhận câu đọc được thay vì `503 Engine Zalo từ chối (502)` — một
 * thông báo không nói được gì thì người nhận chỉ có thể thử lại, mà thử lại là
 * đúng thứ không giúp gì cho mọi mã dưới đây.
 */
export const MA_ZALO: Record<number, { nghia: string; thuNickKhac: boolean }> = {
  // Gặp 13–14/09: nick vẫn `connected` nhưng ĐÃ RỜI nhóm, nên với nó nhóm không
  // tồn tại. Nick khác trong cùng nhóm vẫn gửi được → thử tiếp.
  161: { nghia: 'Nick này không còn ở trong nhóm', thuNickKhac: true },
};

/** Mã Zalo trong thân lỗi engine, `null` nếu không phải lỗi dạng đó. */
export function maZalo(thanLoi: string): number | null {
  const m = thanLoi.match(/"code"\s*:\s*(\d+)/);

  return m ? Number(m[1]) : null;
}

/**
 * Có nên thử NICK KHÁC trong cùng nhóm không.
 *
 * Chỉ `true` cho lỗi xảy ra TRƯỚC khi tin được gửi — nếu không thì thử tiếp có
 * nguy cơ nhắn hai lần. Hai nhóm lỗi hiện biết:
 *
 * - `account_not_connected`: nick rớt phiên (bị đá, chờ quét lại QR).
 * - Zalo mã 161: nick đã rời nhóm; Zalo từ chối trước khi nhận nội dung.
 *
 * Mã lạ thì KHÔNG thử tiếp: chưa biết nó xảy ra trước hay sau khi gửi, và đoán
 * sai theo hướng "cứ thử" là gửi trùng cho người thật.
 */
export function thuNickKhac(thanLoi: string): boolean {
  if (thanLoi.includes('account_not_connected')) return true;
  const ma = maZalo(thanLoi);

  return ma !== null && MA_ZALO[ma]?.thuNickKhac === true;
}

/** Câu giải thích cho agent, kèm nghĩa của mã nếu đã biết. */
export function dienGiaiLoiEngine(thanLoi: string, httpStatus: number): string {
  const ma = maZalo(thanLoi);
  const biet = ma !== null ? MA_ZALO[ma] : undefined;
  if (biet) return `Zalo từ chối (mã ${ma}): ${biet.nghia}.`;
  if (ma !== null) return `Zalo từ chối (mã ${ma}) — mã chưa có trong bảng, xem log để bổ sung.`;

  return `Engine Zalo từ chối (${httpStatus}).`;
}
