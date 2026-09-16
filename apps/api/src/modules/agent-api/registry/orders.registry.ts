import type { AgentTableSpec } from './field-policy';
import { freeText, numeric, plain } from './field-policy';

/**
 * `orders` — bảng chính để trả lời "đơn của tôi đang thế nào".
 *
 * `API-19` MỞ HẾT: không còn trường nào của bảng này bị che, kể cả hai trường
 * tiền `baseCost`/`shipCost` mà `API-17` còn giữ lại. Mở đọc nay KÉO THEO mở
 * lọc/sắp xếp/nhóm — đó chính là thứ chặn câu hỏi "sản lượng theo từng
 * designer" (nhóm theo `assignee`) trước đây.
 *
 * Vì mở là mặc định, `fields` bên dưới không còn là danh sách trắng: nó là
 * **từ điển mô tả**. Trường mới thêm vào `OrderEntity` mà chưa kịp mô tả vẫn
 * đọc và lọc được ngay; bất biến I4 chỉ còn nhắc người viết bổ sung ghi chú.
 */
export const ordersRegistry: AgentTableSpec = {
  key: 'orders',
  description:
    'Đơn sản xuất. Trả lời tình trạng đơn của khách: đơn đang ở công đoạn nào, xưởng nào, ' +
    'trạng thái thiết kế, đã xong chưa, có bị lỗi hay bị giữ không. Có địa chỉ giao, người xử lý, ' +
    'nhật ký chuyển công đoạn và tiền của đơn. Mọi trường đều lọc/sắp xếp/nhóm được.',
  entityName: 'OrderEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date', 'Thời điểm bản ghi đơn được tạo trong hệ thống'),
    updatedAt: plain('date'),

    productionId: plain('string', 'Mã đơn sản xuất khách dùng để tra cứu — khoá tra chính'),
    userSku: plain('string', 'Mã tài khoản khách. Dùng để tìm mọi đơn của một khách'),
    userEmail: plain('string', 'Email khách — đọc/lọc/nhóm được đầy đủ'),

    type: plain('string', 'Tên loại sản phẩm, khớp productConfigs.fullName'),
    color: plain('string'),
    size: plain('string'),
    printMethod: plain('string'),
    productLine: plain('enum', 'PRD-8 — dòng sản phẩm (3d/2d/wood/embroidery/led/canvas), stamp từ ProductConfig lúc import'),
    quantity: numeric('Số lượng của đơn'),

    status: plain('string', 'Trạng thái đơn lấy từ hệ thống nguồn'),
    cancelledAt: plain('date', 'Khác rỗng = đơn ĐÃ HỦY, bị loại khỏi mọi công đoạn và thống kê'),
    cancelReason: freeText('Lý do hủy, người vận hành gõ tay'),
    heldAt: plain('date', 'Khác rỗng = đơn đang bị GIỮ, không chạy tiếp công đoạn nào'),
    holdReason: freeText('Lý do giữ đơn, người vận hành gõ tay. "Giữ theo OnosPod" = hệ thống tự giữ theo OnosPod'),
    holdSource: plain(
      'enum',
      'Nguồn lượt giữ: manual = nhân viên giữ, onospod = hệ thống tự giữ theo trạng thái On Hold bên OnosPod. Đơn đang giữ mà rỗng = manual',
    ),
    onospodHold: plain(
      'object',
      'Cờ "OnosPod đang giữ" {onHoldAt, seenAt} — có khi item bên OnosPod đang On Hold, kể cả khi đơn bên mình không bị giữ (đã xong / nhân viên đã mở giữ)',
    ),
    onospodHoldDismissedAt: plain(
      'date',
      'Mốc đợt giữ OnosPod mà nhân viên đã mở giữ — hệ thống không tự giữ lại đợt đó',
    ),

    orderAt: plain('date'),
    inProductionAt: plain('date', 'Ngày đơn vào sản xuất — trục thời gian của hầu hết thống kê'),
    isMapped: plain('bool'),
    productConfigId: plain('objectId', 'Trỏ tới productConfigs'),
    factoryId: plain('objectId', 'Xưởng đang sản xuất. RỖNG = đơn CHƯA GÁN XƯỞNG, bị loại mặc định'),
    originalFactoryId: plain('objectId'),
    machineTypeId: plain('objectId'),
    priority: plain('enum', 'Mức ưu tiên của đơn'),

    printStatus: plain('string'),
    printStatusNote: freeText(),
    toolResult: plain('string', 'Mã kết quả soát tool, tra nghĩa ở workshopConfigs'),
    toolResultNote: freeText('Ghi chú soát tool, người vận hành gõ tay'),
    toolCheckErrorNotes: freeText('Danh sách ghi chú lỗi lúc soát tool'),
    toolCheckedAt: plain('date'),
    errorFile: plain('string', 'Mã loại lỗi file, tra nghĩa ở workshopConfigs'),
    errorFileNote: freeText(),

    productionError: plain('string', 'Mã lỗi sản xuất, tra nghĩa ở workshopConfigs'),
    productionErrorNote: freeText(),
    productionErrorSource: plain('enum', 'Nguồn lỗi: designer | factory | tool-check'),
    productionErrorCount: numeric(),
    productionFirstErrorAt: plain('date'),
    errorResolvedAt: plain('date'),

    readyForFulfill: plain('bool'),
    designerStatus: plain('enum', 'Trạng thái thiết kế: unassigned/assigned/in-progress/done/rework'),
    designerReworkCount: numeric(),
    // Mốc thời gian của khâu thiết kế. Ghép với `assignee` bên dưới là ra sản
    // lượng theo từng designer — xem `documents/AgentGuide/DataDictionary.md`.
    designerAssignedAt: plain('date'),
    designerStartedAt: plain('date'),
    designerFirstStartedAt: plain('date'),
    designerCompletedAt: plain('date'),
    designerReworkAt: plain('date'),
    currentFulfillmentStage: plain(
      'enum',
      'Công đoạn xưởng hiện tại: print, press, qc-post-press, sew-in, sew-out, pack. Rỗng = chưa vào xưởng HOẶC đã đóng hàng xong',
    ),
    fulfillmentCompletedAt: plain('date', 'Khác rỗng = đơn đã xong công đoạn Đóng hàng'),

    // ── `API-17` mở đọc; `API-19` mở nốt lọc/sắp xếp/nhóm cho cả nhóm này.
    shippingAddress: plain('object', 'Khối địa chỉ giao — trả nguyên khối'),
    assignee: plain('string', 'Người được giao thiết kế'),
    assigneeNote: plain('string', 'Ghi chú khi giao việc, gõ tay'),
    designerRejections: plain('object', 'Lịch sử từ chối nhận việc thiết kế'),
    designerRejectedReason: plain('string', 'Lý do từ chối, gõ tay'),
    designerRejectedAt: plain('date'),
    fulfillmentStages: plain('object', 'Trạng thái chi tiết của từng công đoạn xưởng'),
    fulfillmentTimeline: plain('object', 'Nhật ký chuyển công đoạn của đơn'),
    mockupUrl: plain('string'),
    mockupOriginalUrl: plain('string'),
    cuttingFileUrl: plain('string'),
    cuttingFileName: plain('string'),
    tempFileUrl: plain('string'),
    designs: plain('object', 'Đường dẫn file thiết kế theo từng vị trí in'),
    designsOriginal: plain('object', 'Bản thiết kế gốc trước khi khách sửa'),
    designsStatus: plain('object', 'Tình trạng xử lý của từng file thiết kế'),
    weight: plain('number'),
    width: plain('number'),
    height: plain('number'),
    length: plain('number'),
    orderId: plain('string', 'Mã đơn ở hệ thống nguồn'),
    externalId: plain('string'),
    referent: plain('string'),
    fabricType: plain('string', 'Mã chất liệu, tra nghĩa ở workshopConfigs'),
    machineNumber: plain('string', 'Mã máy, tra nghĩa ở workshopConfigs'),
    designerWorkMs: plain('number', 'Thời gian thiết kế thực tế (mili giây)'),
    designReviewClaimedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Đọc được trường này KHÔNG đổi bộ lọc mặc định của truy vấn'),

    // ── `API-19` mở nốt hai trường tiền của đơn
    baseCost: numeric('Giá vốn sản xuất của đơn'),
    shipCost: numeric('Phí ship nội bộ của đơn'),

    vnpShipment: plain('object', 'Vận đơn VNP eGlobal của đơn (shipmentId/trackingCode/labelUrl), nếu đã tạo'),
    tracking: plain(
      'object',
      'Vận đơn KHÁCH TỰ CẤP đi kèm lúc lên đơn (number/carrier/url/labelUrl) — khác vnpShipment do hệ thống mua',
    ),
  },
  // `API-19`: không còn trường nào của bảng này bị loại trừ.
  deliberatelyExcluded: [],
};
