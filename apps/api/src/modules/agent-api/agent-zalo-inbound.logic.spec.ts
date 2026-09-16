import { ZaloGroupKind } from 'shared';

import { chuKyKhop, khoaChongTrung, lyDoKichHoat, nhomDuocNghe, suyVai, VAI } from './agent-zalo-inbound.logic';

/**
 * Hai thứ được canh ở đây. Một: nội dung nhóm khách hàng KHÔNG được rời hệ thống.
 * Hai: agent không bị đánh thức trên mọi tin — hệ cũ đã trả giá 18–28 triệu
 * token/ngày để biết điều đó.
 */
describe('nhomDuocNghe — nhóm nào được đẩy tin ra ngoài', () => {
  it('CHỈ nhóm nội bộ và nhóm vận hành', () => {
    expect(nhomDuocNghe(ZaloGroupKind.Internal)).toBe(true);
    expect(nhomDuocNghe(ZaloGroupKind.Operation)).toBe(true);
  });

  it('CẤM nhóm khách và nhóm chưa phân loại — engine đẩy hết, chốt nằm ở đây', () => {
    expect(nhomDuocNghe(ZaloGroupKind.Seller)).toBe(false);
    expect(nhomDuocNghe(ZaloGroupKind.Unreviewed)).toBe(false);
    expect(nhomDuocNghe(undefined)).toBe(false);
  });
});

describe('suyVai', () => {
  const kinds = new Map([
    ['u-staff', 'staff'],
    ['u-ai', 'ai-support'],
    ['u-khach', 'customer'],
  ]);

  const ct = new Set(['u-ct1', 'u-ct2']);

  it('ghi đè tay xét TRƯỚC bảng danh tính', () => {
    // Ông nhắn từ Zalo cá nhân nên rất dễ đang nằm ở `customer`/`unknown`.
    expect(suyVai('u-ct1', ct, new Map([['u-ct1', 'customer']]))).toBe(VAI.chairman);
  });

  it('NHIỀU uid cùng là Chủ tịch — uid Zalo phụ thuộc nick đang nhìn', () => {
    // "Hoàng Anh" mang 8 uid trên dữ liệu thật; giữ một uid là sai kiến trúc.
    expect(suyVai('u-ct2', ct, kinds)).toBe(VAI.chairman);
  });

  it('kind chairman trong bảng danh tính cũng tính', () => {
    expect(suyVai('u-x', new Set(), new Map([['u-x', 'chairman']]))).toBe(VAI.chairman);
  });

  it('giữ riêng ai-support để agent không đối thoại với chính nó', () => {
    expect(suyVai('u-ai', ct, kinds)).toBe(VAI.aiSupport);
    expect(suyVai('u-staff', ct, kinds)).toBe(VAI.staff);
    expect(suyVai('u-khach', ct, kinds)).toBe(VAI.customer);
  });

  it('chưa phân loại thì nói thẳng là chưa biết', () => {
    expect(suyVai('u-la', ct, kinds)).toBe(VAI.unknown);
    expect(suyVai(undefined, ct, kinds)).toBe(VAI.unknown);
  });
});

describe('lyDoKichHoat — chỗ cắt 1.888 tin/ngày xuống còn trăm', () => {
  const nick = new Set(['nick-ai', 'nick-sup']);
  const ct = new Set(['u-ct1', 'u-ct2']);

  it('Chủ tịch nói là nổ, ở BẤT KỲ uid nào của ông', () => {
    expect(lyDoKichHoat({ senderUid: 'u-ct1' }, ct, nick)).toBe('chairman');
    expect(lyDoKichHoat({ senderUid: 'u-ct2' }, ct, nick)).toBe('chairman');
  });

  it('tag trúng nick trợ lý là nổ', () => {
    expect(lyDoKichHoat({ senderUid: 'x', mentions: [{ uid: 'nick-sup' }] }, ct, nick)).toBe('mention');
  });

  it('tag người ngoài thì KHÔNG', () => {
    expect(lyDoKichHoat({ senderUid: 'x', mentions: [{ uid: 'nguoi-la' }] }, ct, nick)).toBeNull();
  });

  it('tin thường không đánh thức ai', () => {
    expect(lyDoKichHoat({ senderUid: 'x' }, ct, nick)).toBeNull();
    expect(lyDoKichHoat({ senderUid: 'x', mentions: [] }, ct, nick)).toBeNull();
  });

  it('chưa khai uid nào thì im, KHÔNG nổ bừa', () => {
    expect(lyDoKichHoat({ senderUid: 'u-ct1' }, new Set(), new Set())).toBeNull();
  });
});

describe('khoaChongTrung — một câu nói, 2–7 bản ghi', () => {
  it('cùng một tin ở nhiều nick cho CÙNG một khoá', () => {
    // Engine lưu một bản cho mỗi nick trong nhóm; id bản ghi khác nhau nhưng
    // zaloMsgId thì không. Khoá theo id bản ghi là đánh thức agent 7 lần.
    expect(khoaChongTrung('G1', 'zmsg-9', 'rec-a')).toBe(khoaChongTrung('G1', 'zmsg-9', 'rec-b'));
  });

  it('khác nhóm thì khác khoá', () => {
    expect(khoaChongTrung('G1', 'zmsg-9', 'rec-a')).not.toBe(khoaChongTrung('G2', 'zmsg-9', 'rec-a'));
  });

  it('thiếu zaloMsgId thì lùi về id bản ghi — thà trùng còn hơn mất', () => {
    expect(khoaChongTrung('G1', undefined, 'rec-a')).toBe('rec:rec-a');
  });
});

describe('chuKyKhop', () => {
  it('khớp đúng, lệch là trượt', () => {
    expect(chuKyKhop('abc123', 'abc123')).toBe(true);
    expect(chuKyKhop('abc124', 'abc123')).toBe(false);
    expect(chuKyKhop(undefined, 'abc123')).toBe(false);
    expect(chuKyKhop('abc', 'abc123')).toBe(false);
  });
});
