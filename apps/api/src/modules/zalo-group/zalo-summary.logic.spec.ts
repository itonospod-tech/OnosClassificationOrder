import { FULFILLMENT_STAGE_LABELS, FulfillmentStage, ZaloSummaryLevel } from 'shared';

import {
  apDungSanMucDo,
  chuanHoa,
  dinhDangLuc,
  doGiongViec,
  gopChecklist,
  maKhongCoTrongNguon,
  moTaDinhKem,
  moTaDon,
  nhanChang,
  phanLoaiHangDoi,
  quyetDinhHangDoi,
  SUMMARY_JSON_SCHEMA,
  tachJson,
} from './zalo-summary.logic';

/**
 * Test NỀN cho các hàm thuần của tóm tắt Zalo — viết TRƯỚC khi đổi hành vi, để
 * mọi thay đổi sau đó đo được là "vẫn giữ" hay "cố ý đổi".
 *
 * Mốc thời gian luôn cố định: đây là nơi từng suýt báo nhầm lỗi múi giờ vì so
 * một giá trị UTC với giờ máy.
 */
const NOW = new Date('2026-09-03T02:00:00.000Z'); // 09:00 VN

const ngayTruoc = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('dinhDangLuc — DD/MM HH:MM theo giờ Việt Nam, không phụ thuộc TZ máy', () => {
  it('cộng đúng +7 giờ', () => {
    expect(dinhDangLuc(new Date('2026-08-31T09:33:00.000Z'))).toBe('31/08 16:33');
  });

  it('qua ngày khi giờ UTC muộn', () => {
    expect(dinhDangLuc(new Date('2026-08-31T17:30:00.000Z'))).toBe('01/09 00:30');
  });
});

describe('nhanChang — nhãn công đoạn', () => {
  it('không có công đoạn → nói rõ chưa vào xưởng', () => {
    expect(nhanChang(undefined)).toBe('chưa vào công đoạn xưởng');
  });

  it('công đoạn hợp lệ → nhãn tiếng Việt', () => {
    expect(nhanChang(FulfillmentStage.Print)).toBe(FULFILLMENT_STAGE_LABELS[FulfillmentStage.Print]);
  });

  it('công đoạn lạ → trả nguyên chuỗi, không nổ', () => {
    expect(nhanChang('bogus')).toBe('bogus');
  });
});

describe('moTaDon — thứ tự hủy → giữ → xong → công đoạn', () => {
  it('hủy thắng giữ', () => {
    expect(moTaDon({ cancelledAt: ngayTruoc(1), heldAt: ngayTruoc(2) }, NOW)).toBe('ĐÃ HỦY');
  });

  // ĐỔI CÓ CHỦ Ý 16/09/2026: mốc tuyệt đối thay cho tuổi tương đối. Bản tóm tắt
  // sống nhiều ngày trong bảng, "đã 3 ngày" viết hôm nay đọc tuần sau vẫn là
  // "3 ngày" — đã gây báo cáo sai thật (xem `moTaDon`).
  it('đang giữ: mốc giữ + lý do, KHÔNG phải số ngày', () => {
    const r = moTaDon({ heldAt: ngayTruoc(3), holdReason: 'thiếu file' }, NOW);
    expect(r).toBe('ĐANG BỊ GIỮ từ 31/08 09:00 (lý do: thiếu file)');
    expect(r).not.toMatch(/\d+ ngày/);
  });

  it('đã xong sản xuất: ghi mốc xong', () => {
    expect(moTaDon({ fulfillmentCompletedAt: ngayTruoc(2) }, NOW)).toBe('đã xong sản xuất lúc 01/09 09:00');
  });

  it('mô tả KHÔNG đổi theo thời điểm đọc — cùng đơn, đọc sau 30 ngày vẫn ra một chuỗi', () => {
    const don = { heldAt: ngayTruoc(3), holdReason: 'thiếu file' };
    const sau30Ngay = new Date(NOW.getTime() + 30 * 86_400_000);
    expect(moTaDon(don, sau30Ngay)).toBe(moTaDon(don, NOW));
  });

  it('đang chạy có lỗi: công đoạn + lỗi + ghi chú + mốc vào sản xuất', () => {
    expect(
      moTaDon(
        {
          currentFulfillmentStage: FulfillmentStage.Print,
          productionError: 'lệch màu',
          productionErrorNote: 'in lại',
          inProductionAt: ngayTruoc(5),
        },
        NOW,
      ),
    ).toBe(`${FULFILLMENT_STAGE_LABELS[FulfillmentStage.Print]}, ĐANG CÓ LỖI: lệch màu — in lại, vào sản xuất lúc 29/08 09:00`);
  });
});

describe('chuanHoa — lưới cuối cho JSON của mô hình', () => {
  it('rỗng → chuỗi rỗng, mảng rỗng, mức bình thường', () => {
    expect(chuanHoa({})).toEqual({
      tieuDe: '',
      khachQuanTam: '',
      salePhanHoi: '',
      tonDong: '',
      checklist: [],
      nghiNgo: [],
      mucDo: ZaloSummaryLevel.BinhThuong,
    });
  });

  it('mức độ sai hoa thường → về bình thường; checklist lọc phần tử không phải chuỗi/rỗng, KHÔNG trim', () => {
    const r = chuanHoa({ mucDo: 'GAP', checklist: ['a', '', 3, ' b '] });

    expect(r.mucDo).toBe(ZaloSummaryLevel.BinhThuong);
    expect(r.checklist).toEqual(['a', ' b ']);
  });

  it('mức độ hợp lệ giữ nguyên', () => {
    expect(chuanHoa({ mucDo: 'gap' }).mucDo).toBe(ZaloSummaryLevel.Gap);
  });
});

describe('doGiongViec — độ giống hai câu việc', () => {
  it('không dấu vs có dấu, hoa thường → 1', () => {
    expect(doGiongViec('Gui bao gia cho anh Nam', 'GỬI BÁO GIÁ CHO ANH NAM')).toBe(1);
  });

  it('đổi chữ cùng mã đơn → cao (≈0,77)', () => {
    expect(doGiongViec('Giục xưởng đơn JP-88300-76764 đang kẹt', 'Giục đơn JP-88300-76764')).toBeGreaterThan(0.6);
  });

  it('cùng nhắc mã đơn mà KHÁC mã → 0 tuyệt đối', () => {
    expect(doGiongViec('Giục đơn JP-88300-76764', 'Giục đơn JP-88300-76765')).toBe(0);
  });

  it('việc không liên quan → thấp', () => {
    expect(doGiongViec('Gửi báo giá cho anh Nam', 'Lắp camera kho')).toBeLessThan(0.3);
  });
});

describe('gopChecklist — giữ tick của việc GIỐNG (khớp mờ), id ổn định', () => {
  const T0 = '2026-09-01T00:00:00.000Z';
  const T1 = '2026-09-02T00:00:00.000Z';
  let dem = 0;
  const taoId = () => `id-${(dem += 1)}`;
  beforeEach(() => {
    dem = 0;
  });

  it('trùng y nguyên → giữ id + tick + mốc cũ', () => {
    const r = gopChecklist(['Gửi báo giá cho anh Nam'], [{ id: 'cu-1', viec: ' gửi báo giá cho anh nam ', xong: true, taoLuc: T0, xongLuc: T1 }], NOW, taoId);

    expect(r).toEqual([{ id: 'cu-1', viec: 'Gửi báo giá cho anh Nam', xong: true, taoLuc: T0, xongLuc: T1 }]);
  });

  it('việc mới → id mới, chưa tick, taoLuc = bây giờ', () => {
    expect(gopChecklist(['Chốt mẫu vải'], [], NOW, taoId)).toEqual([
      { id: 'id-1', viec: 'Chốt mẫu vải', xong: false, taoLuc: NOW.toISOString(), xongLuc: null },
    ]);
  });

  it('đổi chữ nhỏ → VẪN giữ tick (lỗi cũ đã sửa)', () => {
    const r = gopChecklist(['Gửi lại báo giá cho anh Nam'], [{ id: 'cu-1', viec: 'Gửi báo giá cho anh Nam', xong: true, taoLuc: T0, xongLuc: T1 }], NOW, taoId);

    expect(r[0]).toMatchObject({ id: 'cu-1', xong: true, xongLuc: T1 });
  });

  it('khác mã đơn không bao giờ gộp, dù câu chữ giống hệt', () => {
    const r = gopChecklist(['Giục đơn JP-88300-76765'], [{ id: 'cu-1', viec: 'Giục đơn JP-88300-76764', xong: true, taoLuc: T0, xongLuc: T1 }], NOW, taoId);

    expect(r[0]).toMatchObject({ id: 'id-1', xong: false });
  });

  it('một việc cũ chỉ ghép một việc mới — điểm cao thắng', () => {
    const cu = [{ id: 'cu-1', viec: 'Gửi báo giá cho anh Nam', xong: true, taoLuc: T0, xongLuc: T1 }];
    const r = gopChecklist(['Gửi báo giá cho anh Nam và chị Hoa', 'Gửi báo giá cho anh Nam'], cu, NOW, taoId);

    expect(r[1]).toMatchObject({ id: 'cu-1', xong: true });
    expect(r[0]).toMatchObject({ id: 'id-1', xong: false });
  });

  it('id cũ không có (dữ liệu trước đợt này) → cấp id mới nhưng vẫn giữ tick', () => {
    const r = gopChecklist(['Chốt mẫu vải'], [{ viec: 'Chốt mẫu vải', xong: true, taoLuc: T0, xongLuc: T1 }], NOW, taoId);

    expect(r[0]).toMatchObject({ id: 'id-1', xong: true, taoLuc: T0 });
  });
});

describe('moTaDinhKem — tin đính kèm dạng JSON thô → một dòng chữ, không in URL', () => {
  it('tệp PDF có tên (ca lỗi đã gặp: báo cáo được gửi mà tóm tắt nói "chưa gửi")', () => {
    const raw =
      '{"title":"2026年-墨水海运运输危险性鉴定书.pdf","description":"","href":"https://fg41.dlfl.vn/b29ad01d4be3ebbdb2f2/abc.pdf?x=1"}';

    expect(moTaDinhKem(raw)).toBe('[TỆP: 2026年-墨水海运运输危险性鉴定书.pdf]');
  });

  it('ảnh Zalo (title rỗng, href photo-*)', () => {
    expect(moTaDinhKem('{"title":"","description":"","href":"https://photo-stal-29.zdn.vn/gr/jpg/590994b1/2aOboQ"}')).toBe(
      '[ẢNH]',
    );
  });

  it('sticker (không href, có catId/type)', () => {
    expect(moTaDinhKem('{"id":98936,"catId":61900,"type":3}')).toBe('[STICKER]');
  });

  it('liên kết có tiêu đề + mô tả (mô tả cắt 120 ký tự)', () => {
    const r = moTaDinhKem(`{"title":"Bảng giá 2D US","description":"${'x'.repeat(200)}","href":"https://docs.google.com/spreadsheets/d/abc"}`);

    expect(r.startsWith('[LIÊN KẾT: Bảng giá 2D US] — ')).toBe(true);
    expect(r.length).toBe('[LIÊN KẾT: Bảng giá 2D US] — '.length + 120);
    expect(r).not.toContain('https://');
  });

  it('video theo đuôi', () => {
    expect(moTaDinhKem('{"title":"","href":"https://video-stal-48.dlmd.me/gr/2cd6/clip.mp4"}')).toBe('[VIDEO]');
  });

  it('chữ thường giữ nguyên, kể cả khi bắt đầu bằng { nhưng không phải JSON', () => {
    expect(moTaDinhKem('@Đặng Nam hệ thống lỗi k vào đc em ơi')).toBe('@Đặng Nam hệ thống lỗi k vào đc em ơi');
    expect(moTaDinhKem('{không phải json}')).toBe('{không phải json}');
    expect(moTaDinhKem('[1,2]')).toBe('[1,2]');
  });
});

describe('maKhongCoTrongNguon — mã trong đầu ra không có trong chat/khối đơn (chỉ để log)', () => {
  const kq = (o: Partial<Parameters<typeof maKhongCoTrongNguon>[0]>) => ({
    tieuDe: '', khachQuanTam: '', salePhanHoi: '', tonDong: '', checklist: [], nghiNgo: [], mucDo: 'binh-thuong', ...o,
  });

  it('mã chép sai (ca thật: FBCRTOPTIM thay cho FBCROPTOPVNECK) → báo', () => {
    expect(maKhongCoTrongNguon(kq({ tonDong: 'tool FBCRTOPTIM chưa xong' }), 'file FBCROPTOPVNECK ok')).toEqual(['FBCRTOPTIM']);
  });

  it('mã có trong nguồn (kể cả trong khối đơn, khác hoa thường) → không báo', () => {
    expect(maKhongCoTrongNguon(kq({ checklist: ['Giục đơn JP-88300-76764'] }), 'đơn jp-88300-76764: ĐANG BỊ GIỮ')).toEqual([]);
  });

  it('mã CẮT CỤT của mã có thật → không báo (ồn mà không chỉ ra chuyện bịa)', () => {
    expect(maKhongCoTrongNguon(kq({ tonDong: 'đơn AS-02077 đang kẹt' }), 'đơn AS-02077-17505: ĐANG BỊ GIỮ')).toEqual([]);
  });

  it('mã lấy từ BẢN TÓM TẮT LẦN TRƯỚC (có trong nguồn) → không báo', () => {
    expect(maKhongCoTrongNguon(kq({ tonDong: 'vẫn chờ JP-88300-76764' }), 'tin mới không nhắc mã\nTồn đọng trước: JP-88300-76764 kẹt')).toEqual([]);
  });

  it('từ tiếng Việt viết hoa có dấu và từ ngắn không bị coi là mã', () => {
    expect(maKhongCoTrongNguon(kq({ tonDong: 'ĐANG CHỜ MSDS và ISF' }), 'không có gì')).toEqual([]);
  });
});

describe('tachJson — tách JSON kết quả khỏi văn bản tự do', () => {
  const KQ = '{"tieuDe":"A","mucDo":"gap","checklist":[]}';

  it('cả chuỗi là JSON', () => {
    expect(tachJson(KQ)).toEqual({ tieuDe: 'A', mucDo: 'gap', checklist: [] });
  });

  it('có chữ quanh khối ```json', () => {
    expect(tachJson(`Đây là kết quả:\n\`\`\`json\n${KQ}\n\`\`\`\nHết.`)?.mucDo).toBe('gap');
  });

  it('hai object liên tiếp → lấy đúng object có mucDo/tieuDe', () => {
    expect(tachJson(`{"ghiChu":"x"} rồi ${KQ}`)?.tieuDe).toBe('A');
  });

  it('dấu } nằm trong chuỗi không làm hỏng việc đếm ngoặc', () => {
    const o = tachJson('Kết quả {"tieuDe":"a } b","mucDo":"gap","tonDong":"x \\" y"} xong');

    expect(o?.tieuDe).toBe('a } b');
  });

  it('không có JSON → null; JSON hỏng → null', () => {
    expect(tachJson('không có gì cả')).toBeNull();
    expect(tachJson('{"tieuDe": "A", "mucDo": ')).toBeNull();
  });

  it('schema: 7 khoá bắt buộc, không cho khoá lạ, checklist tối đa 5', () => {
    expect(SUMMARY_JSON_SCHEMA.required).toHaveLength(7);
    expect(SUMMARY_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(SUMMARY_JSON_SCHEMA.properties.checklist.maxItems).toBe(5);
  });
});

describe('apDungSanMucDo — sàn mức độ từ dữ liệu đơn, không bao giờ hạ', () => {
  it('đơn nhắc trong chat bị giữ/lỗi → gap, kể cả mô hình nói bình thường', () => {
    expect(apDungSanMucDo(ZaloSummaryLevel.BinhThuong, { donNhacBiGiuHoacLoi: 1, donKhachBiGiuHoacLoi: 3 })).toEqual({
      mucDo: ZaloSummaryLevel.Gap,
      nangTu: ZaloSummaryLevel.BinhThuong,
    });
  });

  it('chỉ đơn toàn khách bị giữ/lỗi → can-chu-y', () => {
    expect(apDungSanMucDo(ZaloSummaryLevel.BinhThuong, { donNhacBiGiuHoacLoi: 0, donKhachBiGiuHoacLoi: 2 }).mucDo).toBe(
      ZaloSummaryLevel.CanChuY,
    );
  });

  it('mô hình đã gap, bằng chứng chỉ đủ can-chu-y → GIỮ gap (không hạ)', () => {
    expect(apDungSanMucDo(ZaloSummaryLevel.Gap, { donNhacBiGiuHoacLoi: 0, donKhachBiGiuHoacLoi: 2 })).toEqual({ mucDo: ZaloSummaryLevel.Gap });
  });

  it('không có bằng chứng → giữ nguyên, không có nangTu', () => {
    expect(apDungSanMucDo(ZaloSummaryLevel.CanChuY, { donNhacBiGiuHoacLoi: 0, donKhachBiGiuHoacLoi: 0 })).toEqual({ mucDo: ZaloSummaryLevel.CanChuY });
  });

  it('mô hình can-chu-y + đơn nhắc bị giữ → nâng lên gap, ghi lại mức cũ', () => {
    expect(apDungSanMucDo(ZaloSummaryLevel.CanChuY, { donNhacBiGiuHoacLoi: 2, donKhachBiGiuHoacLoi: 2 }).nangTu).toBe(ZaloSummaryLevel.CanChuY);
  });
});

describe('phanLoaiHangDoi — nói ra LÝ DO bỏ qua thay vì trả null câm', () => {
  const base = { now: NOW.getTime(), ngayDocLai: 7, ngayBoQua: 14 };

  it('chưa có tin nào', () => {
    expect(phanLoaiHangDoi({ ...base }).lyDoBoQua).toBe('chua-co-tin');
  });

  it('nhóm im quá ngưỡng', () => {
    expect(phanLoaiHangDoi({ ...base, lastMessageAt: ngayTruoc(15) }).lyDoBoQua).toBe('nhom-im-lau');
  });

  it('đã tóm tắt tới tin cuối — cũ nhưng ĐÚNG, không phải bỏ sót', () => {
    const r = phanLoaiHangDoi({ ...base, lastMessageAt: ngayTruoc(1), denMocTin: ngayTruoc(1) });
    expect(r.xepHang).toBeNull();
    expect(r.lyDoBoQua).toBe('khong-co-tin-moi');
  });

  it('có tin mới → xếp hàng, không có lý do bỏ qua', () => {
    const r = phanLoaiHangDoi({ ...base, lastMessageAt: ngayTruoc(1), denMocTin: ngayTruoc(2), docDayDuLuc: ngayTruoc(2) });
    expect(r.xepHang).not.toBeNull();
    expect(r.lyDoBoQua).toBeNull();
  });
});

describe('quyetDinhHangDoi — nhóm nào vào hàng đợi, đọc kiểu gì', () => {
  const now = NOW.getTime();
  const base = { now, ngayDocLai: 7, ngayBoQua: 14 };

  it('im hơn 14 ngày → không xếp', () => {
    expect(quyetDinhHangDoi({ ...base, lastMessageAt: ngayTruoc(15) })).toBeNull();
  });

  it('đã tóm tắt tới đúng tin cuối → không xếp', () => {
    expect(quyetDinhHangDoi({ ...base, lastMessageAt: ngayTruoc(1), denMocTin: ngayTruoc(1) })).toBeNull();
  });

  it('chưa có tóm tắt → đọc đủ từ đầu', () => {
    expect(quyetDinhHangDoi({ ...base, lastMessageAt: ngayTruoc(1) })).toEqual({ tuMoc: null, docLaiTuDau: true, denMocTin: null });
  });

  it('đọc đủ đã 8 ngày + có tin mới → đọc lại từ đầu, vẫn mang denMocTin để script so', () => {
    const r = quyetDinhHangDoi({ ...base, lastMessageAt: ngayTruoc(1), denMocTin: ngayTruoc(2), docDayDuLuc: ngayTruoc(8) });

    expect(r).toEqual({ tuMoc: null, docLaiTuDau: true, denMocTin: ngayTruoc(2) });
  });

  it('đọc đủ mới 2 ngày + có tin mới → tăng dần từ denMocTin', () => {
    const r = quyetDinhHangDoi({ ...base, lastMessageAt: ngayTruoc(1), denMocTin: ngayTruoc(2), docDayDuLuc: ngayTruoc(2) });

    expect(r).toEqual({ tuMoc: ngayTruoc(2), docLaiTuDau: false, denMocTin: ngayTruoc(2) });
  });
});
