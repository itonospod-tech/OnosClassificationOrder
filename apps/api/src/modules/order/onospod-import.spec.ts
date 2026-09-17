import type { ProductionOrderShippingAddress } from 'shared';

import { mapItemToRow } from './onospod-import.service';
import { isValidObjectIdHex } from './onospod-order-lookup.service';

const ORDER_ID = '6aaa05f1e2d3c4b5a6978811';

const baseItem = {
  order_id: ORDER_ID,
  increment_id: 'EH-49336-76798',
  increment_order_id: 'NF-33230-29523',
  quantity: 1,
  price: '5.5',
  product_type: { name: 'Baseball Jersey' },
  mrp_status: 'To Do',
  auth: { identity_label: 'DESI', email: 'desi@example.com' },
  print: null,
};

const address: ProductionOrderShippingAddress = {
  firstName: 'John',
  address1: '1 Main St',
  city: 'Palm Coast',
  state: 'FL',
  postcode: '32137',
  country: 'US',
};

describe('mapItemToRow — shippingAddress từ map order_id → địa chỉ (Orders.md §3.6)', () => {
  it('gắn địa chỉ khi map có entry cho order_id của item', () => {
    const row = mapItemToRow(baseItem, new Map([[ORDER_ID, address]]));
    expect(row.shippingAddress).toEqual(address);
    // các field cũ không bị ảnh hưởng
    expect(row.productionId).toBe('EH-49336-76798');
    expect(row.userSku).toBe('DESI');
  });

  it('để trống khi map không có entry (OnosPod không trả shipping cho order này)', () => {
    const row = mapItemToRow(baseItem, new Map([['ffffffffffffffffffffffff', address]]));
    expect(row.shippingAddress).toBeUndefined();
  });

  it('để trống khi không truyền map (đường gọi cũ) hoặc item thiếu order_id', () => {
    expect(mapItemToRow(baseItem).shippingAddress).toBeUndefined();
    const noOrderId = { ...baseItem, order_id: undefined };
    expect(mapItemToRow(noOrderId, new Map([[ORDER_ID, address]])).shippingAddress).toBeUndefined();
  });
});

describe('isValidObjectIdHex — lọc id trước khi nhúng vào query theo lô', () => {
  it('nhận Mongo ObjectId hex 24 ký tự (cả hoa lẫn thường)', () => {
    expect(isValidObjectIdHex(ORDER_ID)).toBe(true);
    expect(isValidObjectIdHex('6AAA05F1E2D3C4B5A6978811')).toBe(true);
  });

  it('từ chối productionId, chuỗi rỗng, undefined và chuỗi chứa ký tự lạ', () => {
    expect(isValidObjectIdHex('EH-49336-76798')).toBe(false);
    expect(isValidObjectIdHex('')).toBe(false);
    expect(isValidObjectIdHex(undefined)).toBe(false);
    expect(isValidObjectIdHex('6aaa05f1e2d3c4b5a697881"')).toBe(false);
    expect(isValidObjectIdHex('6aaa05f1e2d3c4b5a69788')).toBe(false); // 22 ký tự
  });
});
