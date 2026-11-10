import type { AgentTableSpec } from './field-policy';
import { plain } from './field-policy';

/**
 * `orderLogs` — dòng thời gian đơn đã đi qua những chặng nào, lúc nào.
 *
 * `API-17` mở vế "AI xử lý": sáu trường danh tính (`userId`, `userName`,
 * `userEmail`, `roleCode`, `impersonatorId`, `impersonatorName`) **nay đọc
 * được** theo quyết định của người dùng. Chỉ còn `ip` và `userAgent` bị che —
 * chúng thuộc BỐN trường bí mật kỹ thuật BA chốt ở AC-03, và là dấu vết phiên
 * làm việc chứ không phải thông tin nghiệp vụ.
 *
 * `before`/`after` NAY LÀ TRƯỜNG BÌNH THƯỜNG (`API-19`). Lý do cũ để lọc chúng
 * qua một danh sách trắng tên trường là "giá trị cũ/mới của trường tiền sẽ lọt
 * ra" — nay tiền cũng mở, nên cái cổng ấy không còn chặn gì và đã bị gỡ cùng
 * `order-log-value-policy.ts`. Lịch sử thay đổi của MỌI trường đọc được nguyên
 * văn, kể cả giá trị dạng khối.
 */
export const orderLogsRegistry: AgentTableSpec = {
  key: 'orderLogs',
  description:
    'Nhật ký thao tác trên đơn — giải thích đơn đã đi qua những chặng nào, lúc nào, ai làm. ' +
    'Kèm giá trị cũ/mới nguyên văn của trường bị đổi.',
  entityName: 'OrderLogEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date', 'Thời điểm thao tác'),
    orderId: plain('objectId', 'Trỏ tới orders._id — nối với bảng orders để biết đơn nào'),
    action: plain('enum', 'Loại thao tác: import, update, hold, unhold, ...'),
    field: plain('string', 'Tên trường bị đổi trong thao tác này'),
    before: plain('object', 'Giá trị TRƯỚC khi đổi — nguyên văn, kiểu tuỳ trường (`API-19`)'),
    after: plain('object', 'Giá trị SAU khi đổi — nguyên văn, kiểu tuỳ trường (`API-19`)'),
    undoOf: plain('object', "Chỉ trên dòng action 'restore' của hoàn tác sửa hàng loạt: sự cố đã tua { group, actor, from, to } (Orders.md §27)"),

    // ── `API-17` mở đọc danh tính người thao tác; `API-19` mở nốt lọc/nhóm —
    // nhóm theo `userId` là ra sản lượng theo từng người.
    userId: plain('string', 'Người thực hiện thao tác'),
    userName: plain('string', 'Tên người thực hiện'),
    userEmail: plain('string', 'Email người thực hiện'),
    roleCode: plain('string', 'Vai trò của người thực hiện'),
    impersonatorId: plain('string', 'Người đăng nhập thay, nếu có'),
    impersonatorName: plain('string', 'Tên người đăng nhập thay, nếu có'),
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  deliberatelyExcluded: [
    // Hai trong BỐN tên bị chặn còn lại sau `API-19` — dấu vết phiên làm việc,
    // không phải thông tin nghiệp vụ.
    'ip',
    'userAgent',
  ],
};
