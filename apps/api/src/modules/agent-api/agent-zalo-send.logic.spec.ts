import { ZaloGroupKind } from 'shared';

import { chonHoiThoai, chonTheoNick, dienGiaiLoiEngine, kiemNguoiNhanDm, kiemNoiDung, LY_DO_CHAN, maZalo, thuNickKhac } from './agent-zalo-send.logic';

/**
 * Đây là chốt chặn duy nhất giữa một agent và khách hàng của công ty. Mọi
 * endpoint khác của Agent API chỉ đọc — sai thì trả nhầm số; đường này nhắn ra
 * ngoài tới người thật và không rút lại được.
 */
describe('chonHoiThoai — ai được nhận tin từ agent', () => {
  const ds = ['c1', 'c2'];

  it('CẤM nhóm khách, dù có truyền đúng conversationId', () => {
    const r = chonHoiThoai({ kind: ZaloGroupKind.Seller, conversationIds: ds }, 'c1');
    expect(r).toEqual({ ok: false, lyDo: LY_DO_CHAN.nhomKhach });
  });

  it('CẤM nhóm chưa phân loại — chưa ai biết bên kia là ai', () => {
    expect(chonHoiThoai({ kind: ZaloGroupKind.Unreviewed, conversationIds: ds }).ok).toBe(false);
    expect(chonHoiThoai({ kind: undefined, conversationIds: ds }).ok).toBe(false);
  });

  it('cho nhóm nội bộ và nhóm vận hành', () => {
    // Trả CẢ danh sách: nick đầu có thể đang rớt kết nối, bên gọi thử tiếp nick sau.
    expect(chonHoiThoai({ kind: ZaloGroupKind.Internal, conversationIds: ds })).toEqual({ ok: true, ungVien: ['c1', 'c2'] });
    expect(chonHoiThoai({ kind: ZaloGroupKind.Operation, conversationIds: ds })).toEqual({ ok: true, ungVien: ['c1', 'c2'] });
  });

  it('conversationId phải THUỘC nhóm đã duyệt', () => {
    // Không có luật này thì chốt phân loại vô nghĩa: biết một id bất kỳ là
    // nhắn được vào nhóm khách.
    const r = chonHoiThoai({ kind: ZaloGroupKind.Internal, conversationIds: ds }, 'id-cua-nhom-khac');
    expect(r).toEqual({ ok: false, lyDo: LY_DO_CHAN.hoiThoaiLac });

    // Chỉ định hợp lệ thì KHÔNG mở rộng sang nick khác — agent đang cố ý chọn nick.
    expect(chonHoiThoai({ kind: ZaloGroupKind.Internal, conversationIds: ds }, 'c2')).toEqual({ ok: true, ungVien: ['c2'] });
  });

  it('nhóm không tồn tại hoặc chưa có hội thoại → từ chối kèm lý do rõ', () => {
    expect(chonHoiThoai(null)).toEqual({ ok: false, lyDo: LY_DO_CHAN.khongThayNhom });
    expect(chonHoiThoai({ kind: ZaloGroupKind.Internal, conversationIds: [] })).toEqual({
      ok: false,
      lyDo: LY_DO_CHAN.khongCoHoiThoai,
    });
  });
});

describe('kiemNoiDung', () => {
  it('từ chối tin rỗng', () => {
    expect(kiemNoiDung('   ').ok).toBe(false);
    expect(kiemNoiDung(undefined).ok).toBe(false);
  });

  it('cắt tin quá dài thay vì bỏ gửi', () => {
    const r = kiemNoiDung('x'.repeat(5000));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content.length).toBe(4000);
      expect(r.content.endsWith('…')).toBe(true);
    }
  });

  it('giữ nguyên tin bình thường, bỏ khoảng trắng thừa', () => {
    expect(kiemNoiDung('  chào nhóm  ')).toEqual({ ok: true, content: 'chào nhóm' });
  });
});

describe('thuNickKhac — khi nào được thử nick khác trong nhóm', () => {
  const ma161 = '{"error":"zalo_tu_choi","code":161,"details":"Zalo từ chối (mã 161): Nhóm này không tồn tại."}';

  it('nick rớt phiên → thử tiếp', () => {
    expect(thuNickKhac('{"error":"account_not_connected"}')).toBe(true);
  });

  it('Zalo mã 161 (nick đã rời nhóm) → thử tiếp', () => {
    // Ca thật 13–14/09: nhóm "OnosNB/ CSKH Nội Bộ" có 4 nick, nick ĐẦU danh sách
    // đã rời nhóm từ 07/09 nên trả 161, còn 2 nick khác vẫn nhắn trong nhóm hằng
    // ngày. Dừng ở nick đầu là nhóm câm suốt hai ngày.
    expect(thuNickKhac(ma161)).toBe(true);
  });

  it('mã LẠ thì KHÔNG thử tiếp — chưa biết lỗi xảy ra trước hay sau khi gửi', () => {
    expect(thuNickKhac('{"error":"zalo_tu_choi","code":999}')).toBe(false);
    expect(thuNickKhac('{"error":"internal_error"}')).toBe(false);
    expect(thuNickKhac('')).toBe(false);
  });
});

describe('maZalo / dienGiaiLoiEngine', () => {
  it('rút được mã và dịch mã đã biết', () => {
    expect(maZalo('{"error":"zalo_tu_choi","code":161}')).toBe(161);
    expect(dienGiaiLoiEngine('{"code":161}', 502)).toContain('không còn ở trong nhóm');
  });

  it('mã lạ thì nói rõ là lạ, KHÔNG giả vờ hiểu', () => {
    expect(dienGiaiLoiEngine('{"code":777}', 502)).toContain('chưa có trong bảng');
  });

  it('không phải lỗi Zalo thì trả mã HTTP', () => {
    expect(dienGiaiLoiEngine('{"error":"boom"}', 500)).toContain('500');
  });
});

describe('kiemNguoiNhanDm — ai được nhận tin RIÊNG từ agent', () => {
  it('cho chủ tịch và nhân viên', () => {
    expect(kiemNguoiNhanDm('chairman').ok).toBe(true);
    expect(kiemNguoiNhanDm('staff').ok).toBe(true);
  });

  it('CẤM khách hàng', () => {
    expect(kiemNguoiNhanDm('customer')).toEqual({ ok: false, lyDo: LY_DO_CHAN.dmKhach });
  });

  it('CẤM cả người chưa xét — "chưa ai xét" khác "đã xét và thấy an toàn"', () => {
    // 53/61 người đang có hội thoại riêng rơi vào diện này (đo prod 12/09).
    // Mặc định cho phép ở đây là agent nhắn riêng cho 53 người không rõ là ai.
    expect(kiemNguoiNhanDm('unknown').ok).toBe(false);
    expect(kiemNguoiNhanDm(undefined).ok).toBe(false);
  });

  it('CẤM nick AI khác — hai con máy nói chuyện với nhau thì không ai dừng', () => {
    expect(kiemNguoiNhanDm('ai-support').ok).toBe(false);
  });
});

describe('chonTheoNick — gửi đúng danh tính bộ phận', () => {
  const ds = [
    { conversationId: 'c-cfo', nick: 'Cfo' },
    { conversationId: 'c-ai', nick: 'Onos Ai' },
    { conversationId: 'c-sup', nick: 'Onos Sup' },
  ];

  it('chọn đúng hội thoại của nick được chỉ định', () => {
    expect(chonTheoNick(ds, 'Onos Ai')).toEqual({ ok: true, conversationId: 'c-ai', nick: 'Onos Ai' });
  });

  it('bỏ qua hoa thường và khoảng trắng thừa', () => {
    expect(chonTheoNick(ds, '  onos sup ')).toEqual({ ok: true, conversationId: 'c-sup', nick: 'Onos Sup' });
  });

  it('KHÔNG có nick đó thì báo lỗi kèm danh sách nick trong nhóm', () => {
    // Bên gọi cần phân biệt "gõ sai tên" với "nick không ở trong nhóm này".
    const r = chonTheoNick(ds, 'Onos Design');
    expect(r.ok).toBe(false);
    expect((r as { lyDo: string }).lyDo).toContain('Cfo, Onos Ai, Onos Sup');
  });

  it('không đọc được nick nào thì nói thẳng', () => {
    const r = chonTheoNick([{ conversationId: 'c1' }], 'Onos Ai');
    expect(r.ok).toBe(false);
    expect((r as { lyDo: string }).lyDo).toContain('không đọc được nick nào');
  });
});
