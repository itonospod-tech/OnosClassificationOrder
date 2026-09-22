import {
  AGENT_DENY_FIELD_NAMES,
  AGENT_DOCUMENTED_TABLE_KEYS,
  AGENT_TABLE_REGISTRY,
  isDeniedFieldPath,
  stripDeniedDeep,
} from './registry';

/**
 * Bất biến của từ điển sau `API-19`.
 *
 * ⚠️ **Ý NGHĨA CỦA FILE NÀY ĐÃ ĐỔI.** Tới `API-18` đây là nơi chứng minh danh
 * sách trắng kín: "không trường nhạy cảm nào lọt vào". `API-19` bỏ danh sách
 * trắng theo quyết định của người dùng, nên phần lớn bất biến cũ không còn đối
 * tượng để canh — mọi thứ đều mở, cố tình.
 *
 * Còn lại HAI nhóm, và cả hai đều thật sự bảo vệ được thứ gì đó:
 *  1. **Bốn tên bị chặn** — chốt duy nhất còn lại, nên phải canh kỹ hơn trước:
 *     không lọt vào từ điển, và hàm chặn phải bắt cả nhánh lồng.
 *  2. **Từ điển không được siết lẻ** — `mongo-filter.ts` vẫn đọc `policy.filter`,
 *     nên một dòng `filter: 'none'` lọt vào registry sẽ âm thầm khoá lại đúng
 *     thứ vừa mở, và chỉ lộ ra khi có người thật gặp lỗi.
 */

/** 11 bảng CÓ MÔ TẢ. Không phải "bảng đọc được" — sau `API-19` bảng nào cũng đọc được. */
const EXPECTED_DOCUMENTED_TABLES = [
  'orders',
  'orderLogs',
  'customers',
  'productConfigs',
  'productCategories',
  'collections',
  'promotions',
  'factories',
  'machineTypes',
  'workshopConfigs',
  'customer_notifications',
  'inventory_items',
  'inventory_transactions',
  'inventory_receipts',
];

const allFields = () =>
  Object.values(AGENT_TABLE_REGISTRY).flatMap((spec) =>
    Object.entries(spec.fields).map(([name, policy]) => ({ table: spec.key, name, policy })),
  );

describe('AGENT_TABLE_REGISTRY — từ điển mô tả', () => {
  it('11 bảng có mô tả — thêm bảng vào từ điển là quyết định có ý thức', () => {
    expect([...AGENT_DOCUMENTED_TABLE_KEYS].sort()).toEqual([...EXPECTED_DOCUMENTED_TABLES].sort());
  });

  it('khoá của registry trùng với `spec.key` — tên bảng ở API phải là tên collection thật', () => {
    for (const [key, spec] of Object.entries(AGENT_TABLE_REGISTRY)) {
      expect(spec.key).toBe(key);
    }
  });

  /**
   * Ca quan trọng nhất của `API-19`. Một `filter: 'none'` sót lại trong từ điển
   * không làm test nào khác đỏ, nhưng nó chặn thật ở `mongo-filter.ts` — đúng
   * kiểu "mở rồi mà vẫn báo lỗi" mà task này sinh ra để dẹp.
   */
  it('API-19: mọi trường có mô tả đều mở đủ quyền — không siết lẻ trường nào', () => {
    const restricted = allFields().filter(
      (f) => !f.policy.read || f.policy.filter !== 'full' || !f.policy.sortable || !f.policy.groupable,
    );
    expect(restricted.map((f) => `${f.table}.${f.name}`)).toEqual([]);
  });

  it('API-19: nhóm theo người xử lý là hợp lệ — đúng ca người dùng báo hỏng', () => {
    for (const [table, field] of [
      ['orders', 'assignee'],
      ['orderLogs', 'userId'],
      ['orderLogs', 'userName'],
    ] as const) {
      expect({ table, field, ...AGENT_TABLE_REGISTRY[table].fields[field] }).toMatchObject({
        read: true,
        groupable: true,
        sortable: true,
        filter: 'full',
      });
    }
  });

  it('API-19: tiền của đơn và giá vốn biến thể NAY ĐỌC ĐƯỢC', () => {
    const money: [string, string][] = [
      ['orders', 'baseCost'],
      ['orders', 'shipCost'],
      ['productConfigs', 'variations.cost'],
      ['productConfigs', 'variations.nonShipCost'],
      ['productConfigs', 'variations.wholesalePrice'],
      ['productConfigs', 'variations.tiktokPrice'],
      ['productConfigs', 'variations.expUsShipCost'],
      ['productConfigs', 'variations.tiktokShipCost'],
    ];
    for (const [table, field] of money) {
      expect({ table, field, read: AGENT_TABLE_REGISTRY[table].fields[field]?.read }).toEqual({
        table,
        field,
        read: true,
      });
    }
  });

  it('API-19: giá trị cũ/mới của nhật ký đọc được nguyên văn', () => {
    expect(AGENT_TABLE_REGISTRY.orderLogs.fields.before?.read).toBe(true);
    expect(AGENT_TABLE_REGISTRY.orderLogs.fields.after?.read).toBe(true);
  });

  it('BỐN bí mật kỹ thuật KHÔNG có trong từ điển', () => {
    const secrets: [string, string][] = [
      ['customers', 'password'],
      ['customers', 'passwordSource'],
      ['orderLogs', 'ip'],
      ['orderLogs', 'userAgent'],
    ];
    for (const [table, field] of secrets) {
      expect({ table, field, present: AGENT_TABLE_REGISTRY[table].fields[field] !== undefined }).toEqual({
        table,
        field,
        present: false,
      });
    }
  });

  it('không tên bị chặn nào lọt vào từ điển, kể cả ở đường dẫn lồng', () => {
    const bad = allFields().filter((f) => isDeniedFieldPath(f.name));
    expect(bad.map((f) => `${f.table}.${f.name}`)).toEqual([]);
  });

  it('fields và deliberatelyExcluded không được giao nhau', () => {
    for (const spec of Object.values(AGENT_TABLE_REGISTRY)) {
      const overlap = spec.deliberatelyExcluded.filter((f) => f in spec.fields);
      expect({ table: spec.key, overlap }).toEqual({ table: spec.key, overlap: [] });
    }
  });

  /**
   * Sau `API-19` chỉ còn bốn tên được phép nằm ở `deliberatelyExcluded` cộng
   * hai ngoại lệ ghi rõ lý do tại chỗ. Bỏ sót một trường ở đây nghĩa là nó bị
   * che mà không ai còn nhớ vì sao — đúng thứ task này dẹp.
   */
  it('API-19: ngoài bốn tên bị chặn, KHÔNG trường nào còn bị loại trừ', () => {
    const NOT_BLOCKED_BUT_EXCLUDED: Record<string, string[]> = {
      // Trường ĐỘNG, không có trên schema — không có gì để phơi.
      customers: ['impersonatedBy'],
    };
    const leftovers = Object.entries(AGENT_TABLE_REGISTRY).flatMap(([table, spec]) =>
      spec.deliberatelyExcluded
        .filter((f) => !(NOT_BLOCKED_BUT_EXCLUDED[table] ?? []).includes(f))
        .filter((f) => !isDeniedFieldPath(f))
        .map((f) => `${table}.${f}`),
    );
    expect(leftovers).toEqual([]);
  });

  it('mọi bảng có mô tả khác rỗng — AC-02 đòi mô tả loại câu hỏi bảng đó trả lời', () => {
    for (const spec of Object.values(AGENT_TABLE_REGISTRY)) {
      expect(spec.description.length).toBeGreaterThan(20);
    }
  });

  it('không mô tả bảng nào còn phủ nhận thứ nay đọc được', () => {
    const LIES = [
      /KHÔNG chứa địa chỉ giao/i,
      /KHÔNG trả email/i,
      /KHÔNG kèm danh tính/i,
      /KHÔNG kèm tên nhân viên/i,
      /KHÔNG chứa giá vốn/i,
      /trường giá DUY NHẤT/i,
    ];
    for (const [table, spec] of Object.entries(AGENT_TABLE_REGISTRY)) {
      for (const lie of LIES) {
        expect({ table, lie: lie.source, hit: lie.test(spec.description) }).toEqual({
          table,
          lie: lie.source,
          hit: false,
        });
      }
    }
  });
});

describe('AGENT_DENY_FIELD_NAMES — chốt chặn DUY NHẤT còn lại', () => {
  it('đúng sáu tên: bốn bí mật xác thực, hai dấu vết phiên', () => {
    expect([...AGENT_DENY_FIELD_NAMES].sort()).toEqual([
      'apiKeys',
      'ip',
      'password',
      'passwordSource',
      'secret',
      'userAgent',
    ]);
  });

  it('chặn theo TỪNG ĐOẠN của đường dẫn, không chỉ đoạn cuối', () => {
    expect(isDeniedFieldPath('password')).toBe(true);
    // Xin trường con của một khối bị chặn phải hỏng y như xin cả khối, nếu
    // không thì `password.hash` là cửa sau đi thẳng vào thứ vừa cấm.
    expect(isDeniedFieldPath('password.hash')).toBe(true);
    expect(isDeniedFieldPath('meta.session.ip')).toBe(true);
    // ORD-4 — bí mật của Public Order API, chặn cả khi xin trường con.
    expect(isDeniedFieldPath('apiKeys')).toBe(true);
    expect(isDeniedFieldPath('apiKeys.hash')).toBe(true);
    expect(isDeniedFieldPath('secret')).toBe(true);
    // Không bắt nhầm theo chuỗi con: `passwordChangedAt` là trường bình thường.
    expect(isDeniedFieldPath('passwordChangedAt')).toBe(false);
    expect(isDeniedFieldPath('shippingAddress')).toBe(false);
  });

  it('quét sạch mọi độ sâu của bản ghi, kể cả trong mảng', () => {
    const row = {
      _id: 'x',
      password: 'hash',
      profile: { phone: '0900', passwordSource: 'system' },
      sessions: [{ ip: '10.0.0.1', at: 'now' }],
    };
    expect(stripDeniedDeep(row)).toEqual({
      _id: 'x',
      profile: { phone: '0900' },
      sessions: [{ at: 'now' }],
    });
  });

  it('giữ nguyên `Date` — quét sâu không được biến ngày thành object rỗng', () => {
    const at = new Date('2026-08-19T00:00:00.000Z');
    expect(stripDeniedDeep({ at }).at).toBe(at);
  });

  /**
   * Hàm quét DỰNG LẠI object, nên đi vào một instance sẽ nghiền nó thành object
   * thường mất hết dữ liệu. Repo dùng `_id` chuỗi nên các bảng nghiệp vụ không
   * sao, nhưng `API-19` mở cả collection không ai khai — ở đó `ObjectId` và
   * `Buffer` là chuyện bình thường.
   */
  it('giữ nguyên instance của lớp khác (ObjectId, Buffer) — không nghiền thành object rỗng', () => {
    class FakeObjectId {
      constructor(readonly hex: string) {}
      toString() {
        return this.hex;
      }
    }
    const id = new FakeObjectId('64f0c0ffee');
    const buf = Buffer.from('abc');

    const out = stripDeniedDeep({ _id: id, blob: buf, nested: { _id: id } });

    expect(out._id).toBe(id);
    expect(out.blob).toBe(buf);
    expect(out.nested._id).toBe(id);
  });
});
