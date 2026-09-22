import type { AgentTableSpec } from './field-policy';
import { plain } from './field-policy';

/**
 * Tồn kho theo xưởng (Inventory-FactoryStock plan) — 3 bảng: danh mục + cache
 * tồn, sổ cái giao dịch append-only, phiếu nhập/xuất. Dùng trả lời "phôi X còn
 * bao nhiêu", "đơn Y đã trừ kho chưa, lúc nào", "hôm nay xuất những gì".
 */
export const inventoryItemsRegistry: AgentTableSpec = {
  key: 'inventory_items',
  description:
    'Danh mục hàng tồn kho theo xưởng (phôi áo, vật tư). quantity là CACHE tồn hiện tại — ' +
    'có thể ÂM (hàng về trước giấy tờ sau). Nguồn sự thật chi tiết là inventory_transactions.',
  entityName: 'InventoryItemEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Xoá mềm — record thường không có'),
    factoryId: plain('objectId', 'Kho của xưởng nào — nối sang factories._id'),
    sku: plain('string', 'SKU kho, thường là variation SKU đầy đủ giữ đuôi size (CAMOSHIRT-XL)'),
    name: plain('string', 'Tên hiển thị thủ kho đặt'),
    unit: plain('string', 'Đơn vị tính (cái, cuộn...)'),
    quantity: plain('number', 'Tồn hiện tại (cache) — âm = đã xuất quá số nhập, cần nhập bù giấy tờ'),
    autoCreated: plain('bool', 'true = sinh tự động lúc quét gặp SKU lạ, thủ kho chưa rà tên/đơn vị'),
    status: plain('string', 'active / inactive'),
  },
  deliberatelyExcluded: [],
};

export const inventoryTransactionsRegistry: AgentTableSpec = {
  key: 'inventory_transactions',
  description:
    'Sổ cái tồn kho APPEND-ONLY — mỗi biến động 1 record balanceBefore→balanceAfter. ' +
    'kind: in (nhập) / out (xuất theo đơn, refs.productionId cho biết đơn nào) / adjust (kiểm kê). ' +
    'Đơn rework trừ lần 2+ có refs.rework=true.',
  entityName: 'InventoryTransactionEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Xoá mềm — record thường không có'),
    factoryId: plain('objectId', 'Xưởng — nối sang factories._id'),
    itemId: plain('objectId', 'Nối sang inventory_items._id'),
    sku: plain('string', 'Snapshot SKU lúc giao dịch'),
    kind: plain('enum', 'in = nhập kho / out = xuất theo đơn / adjust = kiểm kê điều chỉnh'),
    qty: plain('number', 'Dương = cộng tồn, âm = trừ tồn'),
    balanceBefore: plain('number', 'Tồn trước giao dịch'),
    balanceAfter: plain('number', 'Tồn sau giao dịch'),
    note: plain('string'),
    byUserId: plain('objectId', 'Nhân viên thao tác. Tên nhân viên KHÔNG nói cho khách'),
    byUserName: plain('string', 'Snapshot tên nhân viên. KHÔNG nói cho khách'),
    refs: plain(
      'object',
      'Tham chiếu: productionId (đơn bị trừ), orderId, receiptId (thuộc phiếu nào), ' +
        'requestId (khóa idempotency <productionId>#<lần>), source (scan/auto-label/reconcile/manual), rework',
    ),
  },
  deliberatelyExcluded: [],
};

export const inventoryReceiptsRegistry: AgentTableSpec = {
  key: 'inventory_receipts',
  description:
    'Phiếu nhập/xuất kho — bìa kẹp gom nhiều dòng giao dịch, số phiếu NK-/XK-<xưởng>-<ngày>-<seq>. ' +
    'Chi tiết biến động thật nằm ở inventory_transactions (refs.receiptId).',
  entityName: 'InventoryReceiptEntity',
  defaultSort: '_id',
  fields: {
    _id: plain('objectId'),
    createdAt: plain('date'),
    updatedAt: plain('date'),
    deletedAt: plain('date', 'Xoá mềm — record thường không có'),
    code: plain('string', 'Số phiếu, ví dụ NK-MLDTF-210926-01'),
    type: plain('enum', 'in = phiếu nhập / out = phiếu xuất'),
    factoryId: plain('objectId', 'Xưởng — nối sang factories._id'),
    lines: plain('object', 'Snapshot các dòng {sku, name, qty, note} để render phiếu'),
    byUserId: plain('objectId', 'Nhân viên lập phiếu. KHÔNG nói cho khách'),
    byUserName: plain('string', 'Snapshot tên nhân viên. KHÔNG nói cho khách'),
    note: plain('string'),
  },
  deliberatelyExcluded: [],
};
