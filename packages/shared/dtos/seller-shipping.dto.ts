import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ResZod } from '@shared/types';
import { z } from 'zod';

import {
  computeChargeableWeightGram,
  computeDimWeightGram,
  DIM_WEIGHT_DIVISOR,
  parseSellerShipPriceCsv,
  resolveSellerShipPrice,
  SELLER_SHIP_ERROR_CODES,
  type SellerShipErrorCode,
  type SellerShipPriceResult,
  type SellerShipPriceRow,
  SellerShipPriceRowZod,
  type SellerShipPriceTable,
  SellerShipPriceTableZod,
} from '../client';

/**
 * Seller tự mua label VNP (`customer/shipping/*`) — quote/buy + bảng giá.
 * Hàm tính cước + schema bảng giá nest-free ở `client/seller-shipping.ts`
 * (re-export bên dưới). Plan: `documents/Plans/SellerWallet-LabelPurchase.md`.
 */
export {
  computeChargeableWeightGram,
  computeDimWeightGram,
  DIM_WEIGHT_DIVISOR,
  parseSellerShipPriceCsv,
  resolveSellerShipPrice,
  SELLER_SHIP_ERROR_CODES,
  type SellerShipErrorCode,
  type SellerShipPriceResult,
  type SellerShipPriceRow,
  SellerShipPriceRowZod,
  type SellerShipPriceTable,
  SellerShipPriceTableZod,
};

/** Key blob `system_configs` giữ bảng giá seller. */
export const SELLER_SHIPPING_PRICE_CONFIG_KEY = 'seller_shipping_price_config';

export const SellerShipErrorCodeZod = z.enum(SELLER_SHIP_ERROR_CODES);

// ---------------------------------------------------------------------------
// Bảng giá
// ---------------------------------------------------------------------------

export const GetSellerShipPriceTableResZod = ResZod.extend({
  data: SellerShipPriceTableZod.nullable(),
});
export class GetSellerShipPriceTableResDto extends createZodDto(extendApi(GetSellerShipPriceTableResZod)) {}

/** Admin import bảng giá — FE parse CSV bằng `parseSellerShipPriceCsv` rồi gửi rows. */
export const ImportSellerShipPriceTableZod = z.object({
  rows: SellerShipPriceRowZod.array().min(1).max(500),
});
export class ImportSellerShipPriceTableDto extends createZodDto(extendApi(ImportSellerShipPriceTableZod)) {}

export const ImportSellerShipPriceTableResZod = ResZod.extend({
  data: z.object({ rowCount: z.number(), maxWeightGram: z.number() }),
});
export class ImportSellerShipPriceTableResDto extends createZodDto(extendApi(ImportSellerShipPriceTableResZod)) {}

/** Công tắc tổng bật/tắt seller tự mua label (giữ nguyên bảng giá). */
export const ToggleSellerShipZod = z.object({ enabled: z.boolean() });
export class ToggleSellerShipDto extends createZodDto(extendApi(ToggleSellerShipZod)) {}

// ---------------------------------------------------------------------------
// Quote + Buy (`customer/shipping/orders/:stagingId/...`)
// ---------------------------------------------------------------------------

export const GetSellerShipQuoteZod = z.object({
  /** Cân seller tự điền (gram) — bỏ trống thì dùng cân prefill từ biến thể. */
  weightGram: z.coerce.number().positive().optional(),
});
export class GetSellerShipQuoteDto extends createZodDto(extendApi(GetSellerShipQuoteZod)) {}

export const SellerShipQuoteZod = z.object({
  eligible: z.boolean(),
  /** Có khi eligible=false hoặc cân/bảng giá lỗi. */
  errorCode: SellerShipErrorCodeZod.optional(),
  /** Cân prefill từ biến thể (Σ weight×qty) — seller sửa được. */
  prefillGram: z.number(),
  /** Cân thật dùng để tính (seller điền hoặc prefill). */
  actualGram: z.number(),
  /** Cân quy đổi Σ(dài×rộng×cao×qty)/6 từ kích thước biến thể (KHÓA, seller không sửa). */
  dimGram: z.number(),
  chargeableGram: z.number(),
  /** Mốc bảng giá áp dụng + giá (USD) — chỉ có khi tính được. */
  tierGram: z.number().optional(),
  price: z.number().optional(),
  walletBalance: z.number(),
  creditLimit: z.number(),
});
export type SellerShipQuote = z.infer<typeof SellerShipQuoteZod>;

export const GetSellerShipQuoteResZod = ResZod.extend({ data: SellerShipQuoteZod });
export class GetSellerShipQuoteResDto extends createZodDto(extendApi(GetSellerShipQuoteResZod)) {}

export const BuySellerLabelZod = z.object({
  weightGram: z.number().positive(),
  /** Idempotency — FE sinh 1 lần cho mỗi lượt bấm mua; retry mạng gửi LẠI cùng id. */
  requestId: z.string().min(8).max(100),
});
export class BuySellerLabelDto extends createZodDto(extendApi(BuySellerLabelZod)) {}

export const BuySellerLabelResZod = ResZod.extend({
  data: z.object({
    trackingCode: z.string().optional(),
    labelUrl: z.string().optional(),
    price: z.number(),
    balanceAfter: z.number(),
  }),
});
export class BuySellerLabelResDto extends createZodDto(extendApi(BuySellerLabelResZod)) {}
