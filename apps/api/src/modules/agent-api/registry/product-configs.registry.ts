import type { AgentTableSpec } from './field-policy';
import { freeText, numeric, plain } from './field-policy';

/**
 * `productConfigs` — trả lời về sản phẩm, biến thể, cấu hình sản xuất.
 *
 * GIÁ: `API-19` mở nốt sáu trường giá nội bộ của biến thể (`cost`,
 * `nonShipCost`, `wholesalePrice`, `tiktokPrice`, `expUsShipCost`,
 * `tiktokShipCost`) — trước đây chúng là nhóm bị che kỹ nhất của bảng này.
 * Agent nay đọc được cả giá vốn lẫn biên lợi nhuận, nên **tự nó phải biết
 * không đọc mấy con số đó cho khách nghe**; API không còn chặn hộ nữa.
 *
 * `variations` là mảng subdoc nên được chiếu theo từng trường con
 * (`variations.sku`, ...) — mongo `$project` giữ nguyên hình mảng.
 */
export const productConfigsRegistry: AgentTableSpec = {
  key: 'productConfigs',
  description:
    'Cấu hình sản phẩm và biến thể. Trả lời sản phẩm có những biến thể nào, giá niêm yết bao nhiêu, ' +
    'in được ở những vị trí nào, thời gian sản xuất và giao dự kiến, giá bán và giá vốn.',
  entityName: 'ProductConfigEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    fullName: plain('string', 'Tên đầy đủ sản phẩm — khớp orders.type'),
    shortName: plain('string', 'Tên viết tắt do người dùng đặt (KHÔNG phải mã chạy tool duyệt thiết kế)'),
    designReviewCode: plain('string', 'Mã chạy tool duyệt thiết kế — trống = sản phẩm không có mã'),
    designReviewTemplateUrl: plain(
      'string',
      'PRD-6 — URL file template dùng để chạy tool (nội bộ). Trống = sản phẩm chưa gắn file. KHÁC printTemplate/printDocument (dữ liệu hệ cũ + OnosPod)',
    ),
    sku: plain('string'),
    slug: plain('string'),
    status: plain('enum'),
    printMethod: plain('string'),
    productLine: plain('enum', 'PRD-8 — dòng sản phẩm seller nhìn: 3d / 2d (DTG+DTF) / wood / embroidery / led / canvas'),
    productLineSource: plain('enum', 'Nguồn gán productLine: manual / collection / factory / machineType / printMethod / default'),
    printArea: plain('string', 'Danh sách mã vị trí in của sản phẩm'),
    printDocument: plain('string', 'URL tài liệu hướng dẫn design/template của sản phẩm'),
    printTemplate: plain('string', 'URL template thiết kế chung của sản phẩm'),
    productCategoryId: plain('objectId', 'Trỏ tới productCategories'),
    collectionIds: plain('objectId', 'Trỏ tới collections'),
    productTagIds: plain('objectId', 'Trỏ tới productTags'),
    productTechniqueIds: plain('objectId', 'Trỏ tới productTechniques'),
    factoryId: plain('objectId'),
    machineTypeId: plain('objectId'),
    fabricType: plain('string'),
    maxProductionTime: numeric('Thời gian sản xuất tối đa cam kết (ngày)'),
    maxShippingTime: numeric('Thời gian giao tối đa cam kết (ngày)'),
    sizeChartUrl: plain('string'),
    usImportTaxPerUnit: numeric(
      'Thuế nhập khẩu US trên mỗi đơn vị (USD) — con số CÔNG BỐ với khách ở Customer Portal Catalog, không phải giá vốn',
    ),
    mockup: plain('string'),
    description: freeText('Mô tả sản phẩm'),
    shortDescription: freeText(),
    'variations.sku': plain('string', 'SKU biến thể, unique toàn hệ thống'),
    'variations.attributes': plain('string', 'Thuộc tính biến thể dạng nhãn - giá trị'),
    'variations.retailPrice': numeric('Giá niêm yết — con số công bố với khách'),
    'variations.cost': numeric('GIÁ VỐN biến thể — nội bộ, không đọc cho khách'),
    'variations.nonShipCost': numeric('Giá bán nonship hệ cũ'),
    'variations.wholesalePrice': numeric('Giá sỉ — nội bộ'),
    'variations.tiktokPrice': numeric('Giá kênh TikTok'),
    'variations.expUsShipCost': numeric('Phí ship express US — nội bộ'),
    'variations.tiktokShipCost': numeric('Phí ship kênh TikTok — nội bộ'),
    'variations.status': plain('enum'),

    // ── `API-17` mở đọc; `API-19` mở nốt lọc/sắp xếp/nhóm.
    'variations.weight': plain('number'),
    'variations.width': plain('number'),
    'variations.height': plain('number'),
    'variations.length': plain('number'),
    machineNumber: plain('string', 'Mã máy mặc định, tra nghĩa ở workshopConfigs'),
    toolResult: plain('string', 'Mã kết quả soát tool mặc định, tra nghĩa ở workshopConfigs'),
    images: plain('string', 'Danh sách ảnh sản phẩm'),
    level: plain('number', 'Mức độ khó của sản phẩm, dùng điều độ nội bộ'),
    guide: plain('string', 'Hướng dẫn sản xuất'),
    templateDescription: plain('string'),
    itemSpecifics: plain('object', 'Thông số kỹ thuật công bố của sản phẩm'),
    hideForSeller: plain('bool'),
    enableDesignCheck: plain('bool'),
    enableAffiliate: plain('bool'),
    weight: plain('number'),
    width: plain('number'),
    height: plain('number'),
    length: plain('number'),
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Bản ghi bị xoá mềm. Mở ĐỌC KHÔNG đổi bộ lọc mặc định của truy vấn'),
  },
  // `API-19`: không còn trường nào của bảng này bị loại trừ.
  deliberatelyExcluded: [],
};
