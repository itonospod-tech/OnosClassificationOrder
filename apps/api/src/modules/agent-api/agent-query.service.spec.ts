import { AgentQueryService } from './agent-query.service';
import { AGENT_TABLE_REGISTRY } from './registry';

/**
 * Lớp truy vấn sau `API-19` — **mở hết trừ bốn tên**.
 *
 * File này từng là ma trận probe 6 hướng chứng minh danh sách trắng kín. Nay nó
 * chứng minh điều ngược lại ở năm hướng đầu (chọn · lọc · sắp xếp · nhóm ·
 * tổng hợp đều mở, kể cả trên bảng không ai mô tả) và giữ nguyên độ chặt ở
 * hướng thứ sáu: bốn tên bí mật kỹ thuật phải hỏng ở MỌI vị trí.
 *
 * Vì sao vẫn giữ ma trận thay vì test một vị trí: chốt chặn nằm ở `policy()`,
 * và mỗi vị trí gọi nó qua một đường khác nhau (`buildProjection`,
 * `buildFilter`, `buildSort`, `aggregate`). Bỏ sót một đường là mở một cửa.
 */
const service = new AgentQueryService(
  // Không lời gọi nào trong các ca dưới đây chạm tới DB — mọi thứ được quyết ở
  // tầng kiểm, trước khi có pipeline nào được gửi đi.
  { find: jest.fn(), aggregate: jest.fn(), insertLog: jest.fn(), ensureLogTtlIndex: jest.fn() } as never,
  { agentApi: { maxLimit: 200, readTimeoutMs: 3000, queryTimeoutMs: 8000 } } as never,
);

const orders = AGENT_TABLE_REGISTRY.orders;
const products = AGENT_TABLE_REGISTRY.productConfigs;
const logs = AGENT_TABLE_REGISTRY.orderLogs;
const customers = AGENT_TABLE_REGISTRY.customers;

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (error) {
    return String((error as { response?: { code?: string } })?.response?.code ?? 'UNKNOWN');
  }
};

describe('API-19 — mọi collection đều đọc được', () => {
  it.each(['users', 'userLogs', 'system_configs', 'roles', 'permissions', 'customRoles', 'departments'])(
    'bảng %s trước đây bị cấm, nay mở',
    (table) => {
      expect(codeOf(() => service.spec(table))).toBe('NO_ERROR');
      expect(service.spec(table).key).toBe(table);
    },
  );

  it('bảng không có mô tả nhận spec MỞ, không phải lỗi', () => {
    const spec = service.spec('zz_qa_probe');
    expect(spec.fields).toEqual({});
    expect(spec.defaultSort).toBe('_id');
    // Mô tả phải nói rõ là "chưa ai mô tả", không phải "không có gì" — agent
    // đọc mô tả rỗng sẽ bỏ qua bảng.
    expect(spec.description).toContain('chưa có mô tả');
  });

  it('bảng có mô tả vẫn giữ nguyên ghi chú nghiệp vụ của nó', () => {
    expect(service.spec('orders').fields.productionId.note).toBeDefined();
  });

  /**
   * `TABLE_NOT_ALLOWED` nay chỉ còn nghĩa "tên collection không hợp lệ". Giữ ca
   * này vì tên bảng là thứ DUY NHẤT của bên gọi đi thẳng vào một lời gọi
   * MongoDB mà không qua bộ dịch nào.
   */
  it.each(['', '$cmd', 'a'.repeat(200), 'ten co dau cach'])(
    'tên collection không hợp lệ (%s) → TABLE_NOT_ALLOWED',
    (table) => {
      expect(codeOf(() => service.spec(table))).toBe('TABLE_NOT_ALLOWED');
    },
  );
});

describe('AC-06 — chặn ghi và chạy mã tuỳ ý (KHÔNG đổi ở API-19)', () => {
  it.each([
    ['$where', { table: 'orders', filter: { $where: '1==1' } }],
    ['$function', { table: 'orders', $function: { body: 'x' } }],
    ['$merge', { table: 'orders', $merge: 'other' }],
    ['$out', { table: 'orders', $out: 'stolen' }],
    ['$accumulator lồng sâu', { table: 'orders', select: { fields: [{ $accumulator: {} }] } }],
    ['khoá chứa dấu chấm', { table: 'orders', 'a.b': 1 }],
  ])('%s → INVALID_QUERY', (_name, payload) => {
    expect(codeOf(() => service.assertNoOperatorKeys(payload))).toBe('INVALID_QUERY');
  });

  it('payload sạch đi qua được', () => {
    expect(codeOf(() => service.assertNoOperatorKeys({ table: 'orders', select: { limit: 10 } }))).toBe(
      'NO_ERROR',
    );
  });
});

/**
 * Bốn tên bị chặn — chốt DUY NHẤT còn lại, nên đây là phần nặng nhất của file.
 */
describe('API-19 — bốn bí mật kỹ thuật hỏng ở MỌI vị trí', () => {
  const cases: [string, ReturnType<typeof service.spec>, string][] = [
    ['customers.password', customers, 'password'],
    ['customers.passwordSource', customers, 'passwordSource'],
    ['orderLogs.ip', logs, 'ip'],
    ['orderLogs.userAgent', logs, 'userAgent'],
  ];

  it.each(cases)('%s không đọc được', (_label, spec, field) => {
    expect(codeOf(() => service.buildProjection(spec, [field]))).toBe('FIELD_NOT_ALLOWED');
  });

  it.each(cases)('%s không lọc được', (_label, spec, field) => {
    expect(codeOf(() => service.buildFilter(spec, { [field]: 'x' }))).toBe('FIELD_NOT_ALLOWED');
  });

  it.each(cases)('%s không sắp xếp được', (_label, spec, field) => {
    expect(codeOf(() => service.buildSort(spec, [{ field, dir: 'desc' }]))).toBe('FIELD_NOT_ALLOWED');
  });

  it('không lấy được qua đường dẫn con — xin `password.hash` hỏng y như xin `password`', () => {
    expect(codeOf(() => service.buildProjection(customers, ['password.hash']))).toBe('FIELD_NOT_ALLOWED');
    expect(codeOf(() => service.buildFilter(customers, { 'password.hash': 'x' }))).toBe('FIELD_NOT_ALLOWED');
  });

  it('chặn cả ở bảng KHÔNG có mô tả — nếu không thì `users.password` là cửa sau', () => {
    const users = service.spec('users');
    expect(codeOf(() => service.buildProjection(users, ['password']))).toBe('FIELD_NOT_ALLOWED');
    expect(codeOf(() => service.buildFilter(users, { password: { $startsWith: '$2b$' } }))).toBe(
      'FIELD_NOT_ALLOWED',
    );
    expect(codeOf(() => service.buildSort(users, [{ field: 'password', dir: 'asc' }]))).toBe(
      'FIELD_NOT_ALLOWED',
    );
  });

  it('không xin gì thì cũng không lọt ra — lưới quét sâu ở đầu ra', () => {
    const [row] = service.maskRows(customers, [
      { _id: 'x', userSku: 'ABC', password: 'hash', meta: { passwordSource: 'system' } },
    ]);
    expect(row).toEqual({ _id: 'x', userSku: 'ABC', meta: {} });
  });
});

describe('API-19 — thứ trước đây bị chặn nay chạy được', () => {
  it('nhóm theo người được giao việc: ĐÚNG ca người dùng báo hỏng', () => {
    expect(codeOf(() => service.buildSort(orders, [{ field: 'assignee', dir: 'desc' }]))).toBe('NO_ERROR');
    expect(service.buildFilter(orders, { assignee: 'U123' })).toEqual({ assignee: 'U123' });
  });

  it.each([
    'variations.cost',
    'variations.nonShipCost',
    'variations.wholesalePrice',
    'variations.tiktokPrice',
    'variations.expUsShipCost',
    'variations.tiktokShipCost',
  ])('giá vốn %s nay đọc/lọc/sắp xếp được', (field) => {
    expect(service.buildProjection(products, [field])[field]).toBe(1);
    expect(codeOf(() => service.buildFilter(products, { [field]: { $gt: 10 } }))).toBe('NO_ERROR');
    expect(codeOf(() => service.buildSort(products, [{ field, dir: 'desc' }]))).toBe('NO_ERROR');
  });

  it.each(['baseCost', 'shipCost'])('tiền của đơn (%s) nay mở', (field) => {
    expect(service.buildProjection(orders, [field])[field]).toBe(1);
    expect(codeOf(() => service.buildFilter(orders, { [field]: { $gt: 10 } }))).toBe('NO_ERROR');
  });

  it('email khách nay dò được theo phần đầu và sắp xếp được', () => {
    expect(codeOf(() => service.buildFilter(orders, { userEmail: { $startsWith: 'a' } }))).toBe('NO_ERROR');
    expect(codeOf(() => service.buildSort(orders, [{ field: 'userEmail', dir: 'asc' }]))).toBe('NO_ERROR');
  });

  it('khối địa chỉ giao lọc được tới từng nhánh con', () => {
    for (const field of ['shippingAddress', 'shippingAddress.country', 'shippingAddress.email']) {
      expect(codeOf(() => service.buildFilter(orders, { [field]: 'VN' }))).toBe('NO_ERROR');
    }
  });

  it('văn bản gõ tay nay lọc và nhóm được', () => {
    expect(codeOf(() => service.buildFilter(orders, { toolResultNote: { $startsWith: 'a' } }))).toBe(
      'NO_ERROR',
    );
    expect(codeOf(() => service.buildSort(orders, [{ field: 'holdReason', dir: 'asc' }]))).toBe('NO_ERROR');
  });

  it('trường chưa ai mô tả trên bảng CÓ mô tả cũng dùng được ngay', () => {
    // Trường mới thêm vào entity mà chưa kịp mô tả không được biến thành lỗi:
    // đó chính là kiểu "im lặng chặn" mà `API-19` dẹp.
    expect(codeOf(() => service.buildFilter(orders, { truongMoiChuaMoTa: 1 }))).toBe('NO_ERROR');
    expect(service.buildProjection(orders, ['truongMoiChuaMoTa'])).toEqual({ truongMoiChuaMoTa: 1 });
  });
});

describe('API-19 — projection mặc định là NGUYÊN bản ghi', () => {
  it('không xin trường nào → không $project thu hẹp', () => {
    // Chiếu theo danh sách khai sẵn sẽ nuốt mất mọi trường chưa kịp mô tả, kể
    // cả trên bảng không ai mô tả (nơi danh sách đó rỗng hoàn toàn).
    expect(service.buildProjection(orders)).toEqual({});
    expect(service.buildProjection(service.spec('zz_qa_probe'))).toEqual({});
  });

  it('có xin thì chiếu đúng thứ đã xin', () => {
    expect(service.buildProjection(products, ['variations.retailPrice'])).toEqual({
      'variations.retailPrice': 1,
    });
  });
});

describe('AC-07 — lọc, sắp xếp, tổng hợp hợp lệ vẫn chạy được', () => {
  it('dựng được điều kiện lồng and/or', () => {
    const filter = service.buildFilter(orders, {
      $and: [{ userSku: 'ABC' }, { $or: [{ designerStatus: 'done' }, { quantity: { $gte: 5 } }] }],
    });
    expect(filter).toEqual({
      $and: [{ userSku: 'ABC' }, { $or: [{ designerStatus: 'done' }, { quantity: { $gte: 5 } }] }],
    });
  });

  it('chuỗi ISO trên trường ngày được đổi thành Date, không so sánh chuỗi', () => {
    const filter = service.buildFilter(orders, {
      inProductionAt: { $gte: '2026-08-01', $lte: '2026-08-18' },
    }) as { inProductionAt: { $gte: unknown; $lte: unknown } };
    expect(filter.inProductionAt.$gte).toBeInstanceOf(Date);
    expect(filter.inProductionAt.$lte).toBeInstanceOf(Date);
  });

  it('ngày sai định dạng trên trường CÓ MÔ TẢ bị từ chối, không lọc ra rỗng âm thầm', () => {
    expect(codeOf(() => service.buildFilter(orders, { inProductionAt: { $gt: 'hôm qua' } }))).toBe(
      'INVALID_QUERY',
    );
  });

  /**
   * Trường không có mô tả thì không biết kiểu, nên ép ngày chuyển sang phỏng
   * đoán theo mẫu. Hai ca dưới đây khoá đúng ranh giới của phép đoán đó.
   */
  it('trường chưa mô tả: chuỗi ISO đầy đủ thành Date, chuỗi ngày trần giữ nguyên', () => {
    const probe = service.spec('zz_qa_probe');
    const withTime = service.buildFilter(probe, { at: { $gte: '2026-08-01T00:00:00Z' } }) as {
      at: { $gte: unknown };
    };
    const bareDate = service.buildFilter(probe, { at: { $gte: '2026-08-01' } }) as { at: { $gte: unknown } };

    expect(withTime.at.$gte).toBeInstanceOf(Date);
    // Đổi bừa sẽ làm hỏng việc lọc trên trường vốn lưu chuỗi.
    expect(bareDate.at.$gte).toBe('2026-08-01');
  });

  it('startsWith escape ký tự đặc biệt — giá trị không trở thành cú pháp regex', () => {
    const filter = service.buildFilter(orders, {
      productionId: { $startsWith: 'XQ.(1' },
    }) as { productionId: { $regex: string } };
    expect(filter.productionId.$regex).toBe('^XQ\\.\\(1');
  });
});

describe('AC-03 — trần lô (KHÔNG đổi ở API-19)', () => {
  it('không truyền limit → mặc định 50', () => {
    expect(service.clampLimit(undefined)).toBe(50);
  });

  it('limit cực lớn bị KẸP xuống trần, không báo lỗi', () => {
    expect(service.clampLimit(100_000)).toBe(200);
  });

  it('limit hợp lệ giữ nguyên', () => {
    expect(service.clampLimit(25)).toBe(25);
  });
});

describe('AC-14 — nhật ký gọi API ghi nguyên câu hỏi', () => {
  it('giá trị lọc ghi nguyên văn — không còn trường nào phải lược', () => {
    expect(service.digest(orders, { userEmail: 'khach@example.com' })).toEqual({
      userEmail: 'khach@example.com',
    });
  });

  it('cây điều kiện lồng nhau giữ nguyên hình dạng', () => {
    const node = { $and: [{ userEmail: 'khach@example.com' }, { quantity: { $gt: 1 } }] };
    expect(service.digest(orders, node)).toEqual(node);
  });
});

describe('văn bản tự do trả về NGUYÊN VĂN (API-11)', () => {
  it('không còn che email/điện thoại trong ghi chú', () => {
    const raw = 'liên hệ khach@example.com hoặc 0912345678';
    const [row] = service.maskRows(orders, [{ toolResultNote: raw }]);

    expect(row.toolResultNote).toBe(raw);
  });
});

/**
 * `meta.hasMore` — trần lô bị kẹp IM LẶNG, nên bên gọi phải có cách biết mình
 * đang cầm dữ liệu cắt dở.
 *
 * Ca 3 là lý do không suy từ `returned === limitApplied`: lô cuối vừa khít trần
 * trông y hệt lô bị cắt. Đo bằng cách xin dư một dòng thì hai trường hợp đó
 * tách ra được. Bối cảnh: 16/09/2026 một đợt đọc bị cắt ở dòng 200 đã bị hiểu
 * thành thiếu dữ liệu thật, mất nửa ngày điều tra một vấn đề không tồn tại.
 */
describe('selectRows — hasMore và total', () => {
  const dungService = (rows: unknown[], count = 0) => {
    const find = jest.fn().mockResolvedValue(rows);
    const đếm = jest.fn().mockResolvedValue(count);
    const svc = new AgentQueryService(
      { find, count: đếm, aggregate: jest.fn(), insertLog: jest.fn(), ensureLogTtlIndex: jest.fn() } as never,
      { agentApi: { maxLimit: 200, readTimeoutMs: 3000, queryTimeoutMs: 8000 } } as never,
    );

    return { svc, find, đếm };
  };
  const dong = (n: number) => Array.from({ length: n }, (_, i) => ({ _id: String(i) }));

  it('xin DƯ một dòng so với trần', async () => {
    const { svc, find } = dungService(dong(3));
    await svc.selectRows(orders, {}, { kind: 'rows', limit: 50 });
    expect(find.mock.calls[0][0].limit).toBe(51);
  });

  it('còn dòng phía sau → hasMore, và cắt lại đúng trần', async () => {
    const { svc } = dungService(dong(201));
    const r = await svc.selectRows(orders, {}, { kind: 'rows', limit: 500 });
    expect(r.limitApplied).toBe(200);
    expect(r.items).toHaveLength(200);
    expect(r.hasMore).toBe(true);
  });

  it('lô vừa khít trần nhưng hết dữ liệu → KHÔNG hasMore', async () => {
    const { svc } = dungService(dong(200));
    const r = await svc.selectRows(orders, {}, { kind: 'rows', limit: 200 });
    expect(r.items).toHaveLength(200);
    expect(r.hasMore).toBe(false);
  });

  it('không xin total thì không đếm', async () => {
    const { svc, đếm } = dungService(dong(3));
    const r = await svc.selectRows(orders, {}, { kind: 'rows', limit: 50 });
    expect(đếm).not.toHaveBeenCalled();
    expect(r.total).toBeUndefined();
  });

  it('xin withTotal thì trả tổng', async () => {
    const { svc, đếm } = dungService(dong(3), 4213);
    const r = await svc.selectRows(orders, {}, { kind: 'rows', limit: 50, withTotal: true });
    expect(đếm).toHaveBeenCalledTimes(1);
    expect(r.total).toBe(4213);
  });
});
