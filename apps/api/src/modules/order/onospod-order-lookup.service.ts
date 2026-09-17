import { Inject, Injectable } from '@nestjs/common';
import axios from 'axios';
import type { DesignFields, ProductionOrderShippingAddress } from 'shared';
import { Logger } from 'winston';

import { ApiConfigService } from '@/shared/services';

// Gateway OnosPod chặn 403 nếu THIẾU header `origin` (verify bằng test gọi
// thật 2026-07-23: cùng token, có `origin` → 200, thiếu `origin` (kể cả có
// `referer`) → 403 "Forbidden"). KHÔNG phải lỗi token/password — token vẫn
// hợp lệ, gateway chỉ chặn request "không giống" gọi từ app.onospod.com.
const ONOSPOD_ORIGIN = 'https://app.onospod.com';

// Đồng bộ field với query thật của FE admin OnosPod (app.onospod.com) — chỉ
// giữ field cần cho design + shipping + key match (productions.increment_id),
// bỏ toàn bộ field billing/tracking/... không dùng tới.
const ORDER_LOOKUP_QUERY = `query OrderLookup($search: String!) {
  orders(
    search: $search
    _id: ""
    id: ""
    ids: []
    identity: ""
    status: "All"
    tracking_status: ""
    platform: ""
    store_id: ""
    product_id: ""
    product_name: ""
    buyer: ""
    start: ""
    end: ""
    auth_id: ""
    manufacture_id: ""
    ignoreReturn: true
  ) {
    _id
    line_items {
      order_line_item_id
      productions { increment_id }
      print {
        design_front { src }
        design_back { src }
        design_sleeve { src }
        design_hood { src }
        design_placket { src }
        design_left { src }
        design_right { src }
        design_chest_left { src }
        design_chest_right { src }
        design_sleeve_left { src }
        design_sleeve_right { src }
        design_upper_sleeve_left { src }
        design_upper_sleeve_right { src }
        design_left_cuff { src }
        design_right_cuff { src }
      }
    }
    shipping {
      first_name
      last_name
      company
      address_1
      address_2
      city
      state
      postcode
      country
      email
      phone
    }
  }
}`;

// `design_*` = file design KHÁCH ĐÃ UP, đã qua xử lý (asset thật hosted trên
// `cdn.onospod.com`) — KHÔNG phải field trần `front`/`back`/... (chỉ là link
// Drive gốc lúc khách paste, có thể chưa qua xử lý/hết hạn quyền xem).
type OnospodDesignKey =
  | 'design_front'
  | 'design_back'
  | 'design_sleeve'
  | 'design_hood'
  | 'design_placket'
  | 'design_left'
  | 'design_right'
  | 'design_chest_left'
  | 'design_chest_right'
  | 'design_sleeve_left'
  | 'design_sleeve_right'
  | 'design_upper_sleeve_left'
  | 'design_upper_sleeve_right'
  | 'design_left_cuff'
  | 'design_right_cuff';

type OnospodPrint = Partial<Record<OnospodDesignKey, { src?: string | null } | null>>;

type OnospodOrder = {
  _id: string;
  line_items: Array<{
    order_line_item_id: string;
    productions: Array<{ increment_id: string }> | null;
    print: OnospodPrint | null;
  }> | null;
  shipping: {
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    address_1?: string | null;
    address_2?: string | null;
    city?: string | null;
    state?: string | null;
    postcode?: string | null;
    country?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
};

// camelCase (DesignFields) -> field `design_*` (OnosPod) — chỉ vị trí có
// tương ứng trực tiếp. `folder`/`frontEmbroidery`/`backEmbroidery` không có
// field `design_*` tương đương bên OnosPod nên KHÔNG map (giữ nguyên giá trị
// hiện có, không đụng tới).
const DESIGN_FIELD_MAP: Partial<Record<keyof DesignFields, OnospodDesignKey>> = {
  front: 'design_front',
  back: 'design_back',
  sleeve: 'design_sleeve',
  hood: 'design_hood',
  placket: 'design_placket',
  left: 'design_left',
  right: 'design_right',
  chestLeft: 'design_chest_left',
  chestRight: 'design_chest_right',
  sleeveLeft: 'design_sleeve_left',
  sleeveRight: 'design_sleeve_right',
  leftUpperSleeve: 'design_upper_sleeve_left',
  rightUpperSleeve: 'design_upper_sleeve_right',
  leftCuff: 'design_left_cuff',
  rightCuff: 'design_right_cuff',
};

type OnospodShipping = NonNullable<OnospodOrder['shipping']>;

// snake_case (OnosPod `order.shipping`) → camelCase snapshot nội bộ. Trả
// undefined khi object rỗng/toàn field trống — caller khỏi ghi snapshot rỗng.
function toShippingAddress(shipping: OnospodShipping | null | undefined): ProductionOrderShippingAddress | undefined {
  if (!shipping) return undefined;
  const mapped: ProductionOrderShippingAddress = {
    firstName: shipping.first_name || undefined,
    lastName: shipping.last_name || undefined,
    company: shipping.company || undefined,
    address1: shipping.address_1 || undefined,
    address2: shipping.address_2 || undefined,
    city: shipping.city || undefined,
    state: shipping.state || undefined,
    postcode: shipping.postcode || undefined,
    country: shipping.country || undefined,
    email: shipping.email || undefined,
    phone: shipping.phone || undefined,
  };
  return Object.values(mapped).some(Boolean) ? mapped : undefined;
}

// Query theo LÔ `ids` (Mongo `_id` của order — MRP item mang sẵn ở field
// `order_id`) — chỉ lấy `_id` + `shipping` cho import hàng ngày. Type biến
// `[String]` + phân trang qua header `x-page`/`x-per-page` (per-page phải ≥
// số ids gửi lên, không thì gateway cắt bớt kết quả) — verify bằng test gọi
// thật 2026-09-16: 3 ids gửi → 3 order về đủ shipping; search rỗng KHÔNG kèm
// header phân trang → 502 (query toàn bộ orders quá nặng).
const ORDER_SHIPPING_BATCH_QUERY = `query OrderShippingByIds($ids: [String]) {
  orders(
    search: ""
    _id: ""
    id: ""
    ids: $ids
    identity: ""
    status: "All"
    tracking_status: ""
    platform: ""
    store_id: ""
    product_id: ""
    product_name: ""
    buyer: ""
    start: ""
    end: ""
    auth_id: ""
    manufacture_id: ""
    ignoreReturn: true
  ) {
    _id
    shipping {
      first_name
      last_name
      company
      address_1
      address_2
      city
      state
      postcode
      country
      email
      phone
    }
  }
}`;

// Kích thước lô mỗi request `OrderShippingByIds` — cân giữa số request (batch
// 1 ngày ~vài trăm order) và độ nặng mỗi query phía gateway OnosPod.
const SHIPPING_BATCH_SIZE = 50;

/** Mongo ObjectId dạng hex 24 ký tự — lọc trước khi nhúng vào query theo lô. */
export function isValidObjectIdHex(id: string | undefined | null): id is string {
  return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);
}

export type OnospodLookupResult = {
  /** true nếu tìm thấy ĐÚNG 1 line_item khớp `productionId`. */
  matched: boolean;
  /** true nếu >1 line_item cùng khớp `productionId` — dữ liệu bất thường, KHÔNG áp dụng, cần review tay. */
  ambiguous: boolean;
  design?: Partial<DesignFields>;
  shipping?: ProductionOrderShippingAddress;
};

@Injectable()
export class OnospodOrderLookupService {
  constructor(
    private readonly apiConfigService: ApiConfigService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  /**
   * Tìm design + địa chỉ ship của 1 đơn qua OnosPod order API (api.onospod.com)
   * — match line_item bằng `line_items[].productions[].increment_id ===
   * productionId`. `increment_id` ở `productions` CHÍNH LÀ `productionId` nội
   * bộ — KHÔNG phải `line_items[].product_id` (khác định dạng hoàn toàn, đã
   * verify bằng test gọi thật 2026-07-22 — xem `Orders.md §9c`).
   *
   * `orderNumber` = `order.orderId` (mã đơn OnosPod dạng "NF-xxxxx-xxxxx") —
   * dùng làm search term để tìm đúng order cha trước khi soi từng line_item
   * (1 order OnosPod có thể có nhiều line_items ứng với nhiều size/màu, mỗi
   * line_item lại có thể có nhiều `productions` — bản re-print/rework).
   */
  async lookupByProductionId(orderNumber: string, productionId: string): Promise<OnospodLookupResult | null> {
    const config = this.apiConfigService.onospodApiConfig;
    if (!config) return null;

    let res;
    try {
      res = await axios.post(
        config.apiUrl,
        { operationName: 'OrderLookup', variables: { search: orderNumber }, query: ORDER_LOOKUP_QUERY },
        {
          headers: {
            Authorization: `Bearer ${config.bearerToken}`,
            'x-onos-super-token': config.superToken,
            'Content-Type': 'application/json',
            // Gateway OnosPod yêu cầu origin khớp app.onospod.com — thiếu là 403,
            // KHÔNG liên quan token/password. Xem comment `ONOSPOD_ORIGIN` trên.
            Origin: ONOSPOD_ORIGIN,
            Referer: `${ONOSPOD_ORIGIN}/`,
          },
          timeout: 20_000,
        },
      );
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const message = axios.isAxiosError(err) ? err.message : 'Unknown error';
      this.logger.error({
        message: JSON.stringify({ action: 'onospodOrderLookup', orderNumber, productionId, status, error: message }),
      });
      return null;
    }

    const gqlErrors = res.data?.errors;
    if (Array.isArray(gqlErrors) && gqlErrors.length > 0) {
      this.logger.error({
        message: JSON.stringify({ action: 'onospodOrderLookup', orderNumber, productionId, gqlErrors }),
      });
      return null;
    }

    const orders = res.data?.data?.orders as OnospodOrder[] | undefined;
    if (!orders || orders.length === 0) return { matched: false, ambiguous: false };

    const matches: Array<{ order: OnospodOrder; lineItem: NonNullable<OnospodOrder['line_items']>[number] }> = [];
    for (const order of orders) {
      for (const lineItem of order.line_items || []) {
        const hit = (lineItem.productions || []).some((p) => p.increment_id === productionId);
        if (hit) matches.push({ order, lineItem });
      }
    }

    if (matches.length === 0) return { matched: false, ambiguous: false };
    if (matches.length > 1) return { matched: false, ambiguous: true };

    const { order, lineItem } = matches[0];

    const design: Partial<DesignFields> = {};
    if (lineItem.print) {
      for (const [ourKey, onospodKey] of Object.entries(DESIGN_FIELD_MAP) as Array<
        [keyof DesignFields, OnospodDesignKey]
      >) {
        const src = lineItem.print[onospodKey]?.src;
        if (src) design[ourKey] = src;
      }
    }

    return { matched: true, ambiguous: false, design, shipping: toShippingAddress(order.shipping) };
  }

  /**
   * Lấy địa chỉ ship theo LÔ Mongo `_id` của order OnosPod (MRP item mang sẵn
   * ở `order_id`) — dùng cho import đơn hàng ngày (`OnospodImportService`):
   * gắn `shippingAddress` vào row trước khi `importOrders()`.
   *
   * KHÔNG BAO GIỜ throw — đây là bước LÀM GIÀU dữ liệu, lỗi ở đây (OnosPod
   * down, token hết hạn, thiếu config) không được làm hỏng lượt import chính.
   * Lô nào fail chỉ log + bỏ qua, các lô còn lại vẫn xử lý tiếp; kết quả là
   * map `orderId (_id)` → địa chỉ, thiếu key = không lấy được.
   */
  async lookupShippingByOrderIds(orderIds: string[]): Promise<Map<string, ProductionOrderShippingAddress>> {
    const result = new Map<string, ProductionOrderShippingAddress>();
    const config = this.apiConfigService.onospodApiConfig;
    if (!config) return result;

    const ids = Array.from(new Set(orderIds.filter((id) => isValidObjectIdHex(id))));

    for (let i = 0; i < ids.length; i += SHIPPING_BATCH_SIZE) {
      const chunk = ids.slice(i, i + SHIPPING_BATCH_SIZE);
      try {
        const res = await axios.post(
          config.apiUrl,
          { operationName: 'OrderShippingByIds', variables: { ids: chunk }, query: ORDER_SHIPPING_BATCH_QUERY },
          {
            headers: {
              Authorization: `Bearer ${config.bearerToken}`,
              'x-onos-super-token': config.superToken,
              'Content-Type': 'application/json',
              Origin: ONOSPOD_ORIGIN,
              Referer: `${ONOSPOD_ORIGIN}/`,
              // Phân trang của OnosPod nằm ở HEADER — per-page phải ≥ số ids
              // trong lô, không thì kết quả bị cắt bớt (xem comment query).
              'x-page': '1',
              'x-per-page': String(chunk.length),
            },
            timeout: 20_000,
          },
        );

        const gqlErrors = res.data?.errors;
        if (Array.isArray(gqlErrors) && gqlErrors.length > 0) {
          this.logger.error({
            message: JSON.stringify({ action: 'onospodShippingBatch', chunkStart: i, chunkSize: chunk.length, gqlErrors }),
          });
          continue;
        }

        const orders = (res.data?.data?.orders as Pick<OnospodOrder, '_id' | 'shipping'>[] | undefined) || [];
        for (const order of orders) {
          const shipping = toShippingAddress(order.shipping);
          if (order._id && shipping) result.set(order._id, shipping);
        }
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const message = axios.isAxiosError(err) ? err.message : 'Unknown error';
        this.logger.error({
          message: JSON.stringify({ action: 'onospodShippingBatch', chunkStart: i, chunkSize: chunk.length, status, error: message }),
        });
      }
    }

    return result;
  }
}
