import type { AgentTableSpec } from './field-policy';
import { freeText, numeric, plain } from './field-policy';

/**
 * Sáu bảng danh mục nhỏ cộng bảng thông báo khách. Gom chung một file vì mỗi
 * bảng chỉ vài trường; thiết kế `.devtasks/design/API-1.md` §2 phác "1 file mỗi
 * bảng" nhưng tách 3 dòng thành 6 file không làm rõ thêm điều gì.
 *
 * Ba bảng `factories` / `machineTypes` / `productCategories` / `collections`
 * không có trường nhạy cảm nào — chúng chỉ là bảng tra nghĩa cho id nằm trên
 * đơn và trên sản phẩm.
 */

export const productCategoriesRegistry: AgentTableSpec = {
  key: 'productCategories',
  description: 'Danh mục nhóm sản phẩm. Tra nghĩa cho productConfigs.productCategoryId.',
  entityName: 'ProductCategoryEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    name: plain('string'),
    shortName: plain('string'),
    isActive: plain('bool'),
    parentId: plain('objectId', 'Danh mục cha, nếu có'),

    // ── `API-17` mở đọc
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  deliberatelyExcluded: [],
};

export const collectionsRegistry: AgentTableSpec = {
  key: 'collections',
  description: 'Bộ sưu tập sản phẩm. Tra nghĩa cho productConfigs.collectionIds.',
  entityName: 'CollectionEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    name: plain('string'),
    shortName: plain('string'),
    description: freeText(),
    image: plain('string'),
    sortOrder: numeric(),
    isActive: plain('bool'),

    // ── `API-17` mở đọc
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  deliberatelyExcluded: [],
};

export const promotionsRegistry: AgentTableSpec = {
  key: 'promotions',
  description:
    'Chương trình giảm giá theo hạng khách. Trả lời khách có đang được ưu đãi nào, ' +
    'mức giảm bao nhiêu, áp cho sản phẩm hay danh mục nào, hiệu lực tới bao giờ.',
  entityName: 'PromotionEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    name: plain('string'),
    code: plain('string'),
    description: freeText(),
    discountType: plain('enum', 'Kiểu giảm: theo phần trăm hay số tiền'),
    discountValue: numeric(),
    scope: plain('enum', 'Phạm vi áp: toàn bộ, theo danh mục, hay theo sản phẩm'),
    scopeCategoryId: plain('objectId'),
    scopeProductConfigIds: plain('objectId'),
    applicableTiers: plain('number', 'Các hạng khách được áp'),
    minQuantity: numeric(),
    startDate: plain('date'),
    endDate: plain('date'),
    status: plain('enum'),

    // ── `API-17` mở đọc
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  deliberatelyExcluded: [],
};

export const factoriesRegistry: AgentTableSpec = {
  key: 'factories',
  description:
    'Xưởng sản xuất. Tra nghĩa cho orders.factoryId. Xưởng có shortName = "US" nằm NGOÀI ' +
    'luồng sản xuất và bị loại khỏi mọi thống kê.',
  entityName: 'FactoryEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    name: plain('string'),
    shortName: plain('string'),
    isActive: plain('bool'),
    flowType: plain(
      'enum',
      'Luồng fulfillment của xưởng: standard (đủ 6 công đoạn) / merged (gộp Ép vào In, May ra vào May vào) / no-sew (QC xong bỏ qua 2 công đoạn may) / press-complete (DTF — Ép xong thì QC + May + Đóng hàng đều tự xong, đơn hoàn thành ngay)',
    ),
    autoCompletePack: plain(
      'bool',
      'Bật = đơn chảy tới công đoạn Đóng hàng tự hoàn thành luôn (kết thúc fulfillment không cần xác nhận tay). Độc lập với flowType, chỉ áp đơn mới',
    ),
    skipToolCheck: plain(
      'bool',
      'Bật = bỏ qua soát tool: đơn MỚI import/push vào xưởng được stamp toolResultNote=ok + toolCheckedAt ngay lúc tạo và vào thẳng công đoạn In (xưởng DTF). Chỉ áp đơn tạo mới',
    ),

    // ── `API-17` mở đọc
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  deliberatelyExcluded: [],
};

export const machineTypesRegistry: AgentTableSpec = {
  key: 'machineTypes',
  description: 'Loại máy sản xuất. Tra nghĩa cho orders.machineTypeId.',
  entityName: 'MachineTypeEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    name: plain('string'),
    shortName: plain('string'),
    isActive: plain('bool'),

    // ── `API-17` mở đọc
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  deliberatelyExcluded: [],
};

export const workshopConfigsRegistry: AgentTableSpec = {
  key: 'workshopConfigs',
  description:
    'Danh mục cấu hình xưởng — BẢNG TRA NGHĨA quan trọng nhất. Dịch các mã trên đơn ' +
    '(toolResult, productionError, errorFile, fabricType, machineNumber) thành tên đọc được. ' +
    'Lọc theo category để lấy đúng nhóm mã.',
  entityName: 'WorkshopConfigEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    category: plain('enum', 'Nhóm mã: production_error, error_file_type, fabric_type, machine, ...'),
    code: plain('string', 'Mã lưu trên đơn'),
    name: plain('string', 'Tên đọc được của mã'),
    order: numeric(),
    isActive: plain('bool'),
    errorSource: plain('enum', 'Nguồn lỗi: designer | factory | tool-check'),
    stage: plain('enum', 'Công đoạn xưởng gắn với mã lỗi này'),

    // ── `API-17` mở đọc
    color: plain('string', 'Màu hiển thị của mã trên giao diện nội bộ'),
    icon: plain('string'),
    reworkTarget: plain('string', 'Chặng mà đơn bị đẩy về khi gặp mã lỗi này'),
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  deliberatelyExcluded: [],
};

/**
 * `customer_notifications` — thông báo hệ thống đã chủ động gửi cho khách.
 *
 * `title`/`body` đọc được: đó là nội dung chính khách đã nhận, không phải ghi
 * chú nội bộ. Vẫn đi qua bộ che theo mẫu như mọi văn bản tự do khác.
 *
 * `createdByUserId`/`createdByName` là mã và TÊN NHÂN VIÊN đã gửi — BA bổ sung
 * đích danh vào nhóm che ở BR-4a §4 ngày 2026-08-18.
 */
export const customerNotificationsRegistry: AgentTableSpec = {
  key: 'customer_notifications',
  description: 'Thông báo đã gửi cho khách. Trả lời "hệ thống đã báo gì cho tôi, lúc nào".',
  entityName: 'CustomerNotificationEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date', 'Thời điểm gửi'),
    title: freeText('Tiêu đề thông báo khách đã nhận'),
    body: freeText('Nội dung thông báo khách đã nhận'),
    customerId: plain('objectId', 'Trỏ tới customers._id; rỗng = gửi cho TẤT CẢ khách'),

    // ── ORD-5: thông báo HỆ THỐNG tự sinh theo trạng thái đơn
    event: plain(
      'string',
      'Loại sự kiện đơn sinh ra thông báo (order.pushed / order.production_completed / ' +
        'order.held / order.unheld / order.item_cancelled). Rỗng = thông báo nhân viên soạn tay',
    ),
    eventData: plain('object', 'Dữ liệu render thông báo hệ thống: orderCode, productionId, holdKind, stagingId'),

    // ── `API-17` mở đọc: danh tính nhân viên đã gửi
    createdByUserId: plain('string', 'Rỗng với thông báo hệ thống tự sinh'),
    createdByName: plain('string', 'Tên nhân viên đã gửi thông báo; rỗng với thông báo hệ thống'),
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  deliberatelyExcluded: [],
};
