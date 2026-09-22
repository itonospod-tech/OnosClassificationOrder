import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { ResZod } from '@shared/types';
import { z } from 'zod';

import { IDZod } from '..';

/**
 * Tồn kho theo xưởng (Inventory) — nhập tay · quét trừ theo đơn · đối soát ngày.
 * Sổ cái append-only `inventory_transactions` (mirror khuôn ví seller:
 * `balanceBefore → balanceAfter`, idempotency unique `refs.requestId`),
 * cache tồn trên `inventory_items.quantity`.
 * Plan: `documents/Plans/Inventory-FactoryStock.md`.
 */
export const INVENTORY_TXN_KINDS = ['in', 'out', 'adjust'] as const;
export type InventoryTxnKind = (typeof INVENTORY_TXN_KINDS)[number];
export const InventoryTxnKindZod = z.enum(INVENTORY_TXN_KINDS);

/** Nguồn phát sinh 1 transaction xuất — thống kê tách được quét tay/auto/đối soát. */
export const INVENTORY_OUT_SOURCES = ['scan', 'auto-label', 'reconcile', 'manual'] as const;
export type InventoryOutSource = (typeof INVENTORY_OUT_SOURCES)[number];
export const InventoryOutSourceZod = z.enum(INVENTORY_OUT_SOURCES);

export const InventoryItemZod = z.object({
  _id: IDZod,
  factoryId: IDZod,
  sku: z.string(),
  name: z.string().optional(),
  unit: z.string().optional(),
  /** CACHE — mọi biến động qua InventoryService.applyTransaction(). Có thể ÂM. */
  quantity: z.number(),
  /** Sinh tự động lúc quét gặp SKU lạ — thủ kho cần rà lại tên/đơn vị. */
  autoCreated: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type InventoryItem = z.infer<typeof InventoryItemZod>;

export const InventoryTxnZod = z.object({
  _id: IDZod,
  factoryId: IDZod,
  itemId: IDZod,
  /** Snapshot — sổ cái không join lại item. */
  sku: z.string(),
  kind: InventoryTxnKindZod,
  /** Dương = cộng tồn, âm = trừ tồn. */
  qty: z.number(),
  balanceBefore: z.number(),
  balanceAfter: z.number(),
  note: z.string().optional(),
  byUserId: z.string().optional(),
  byUserName: z.string().optional(),
  refs: z
    .object({
      requestId: z.string().optional(),
      productionId: z.string().optional(),
      orderId: z.string().optional(),
      receiptId: z.string().optional(),
      source: InventoryOutSourceZod.optional(),
      /** true = lượt trừ lần 2+ cho đơn làm lại (rework). */
      rework: z.boolean().optional(),
    })
    .optional(),
  createdAt: z.coerce.date().optional(),
});
export type InventoryTxn = z.infer<typeof InventoryTxnZod>;

export const InventoryReceiptZod = z.object({
  _id: IDZod,
  /** `NK-<factoryShortName>-<yymmdd>-<seq>` (in) / `XK-...` (out). */
  code: z.string(),
  type: InventoryTxnKindZod.exclude(['adjust']),
  factoryId: IDZod,
  lines: z
    .object({ sku: z.string(), name: z.string().optional(), qty: z.number(), note: z.string().optional() })
    .array(),
  byUserId: z.string().optional(),
  byUserName: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.coerce.date().optional(),
});
export type InventoryReceipt = z.infer<typeof InventoryReceiptZod>;

// ---------------------------------------------------------------------------
// List queries
// ---------------------------------------------------------------------------

export const GetInventoryItemsZod = z.object({
  factoryId: IDZod,
  search: z.string().optional(),
  /** true = chỉ SKU tồn âm (cảnh báo). */
  negativeOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export class GetInventoryItemsDto extends createZodDto(extendApi(GetInventoryItemsZod)) {}

export const GetInventoryItemsResZod = ResZod.extend({ data: InventoryItemZod.array(), total: z.number() });
export class GetInventoryItemsResDto extends createZodDto(extendApi(GetInventoryItemsResZod)) {}

export const UpdateInventoryItemZod = z.object({
  name: z.string().max(200).optional(),
  unit: z.string().max(50).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  /** Thủ kho đã rà xong item sinh tự động. */
  autoCreated: z.boolean().optional(),
});
export class UpdateInventoryItemDto extends createZodDto(extendApi(UpdateInventoryItemZod)) {}

export const GetInventoryTxnsZod = z.object({
  factoryId: IDZod,
  kind: InventoryTxnKindZod.optional(),
  sku: z.string().optional(),
  productionId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export class GetInventoryTxnsDto extends createZodDto(extendApi(GetInventoryTxnsZod)) {}

export const GetInventoryTxnsResZod = ResZod.extend({ data: InventoryTxnZod.array(), total: z.number() });
export class GetInventoryTxnsResDto extends createZodDto(extendApi(GetInventoryTxnsResZod)) {}

export const GetInventoryReceiptsZod = z.object({
  factoryId: IDZod,
  type: InventoryTxnKindZod.exclude(['adjust']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export class GetInventoryReceiptsDto extends createZodDto(extendApi(GetInventoryReceiptsZod)) {}

export const GetInventoryReceiptsResZod = ResZod.extend({
  data: InventoryReceiptZod.array(),
  total: z.number(),
});
export class GetInventoryReceiptsResDto extends createZodDto(extendApi(GetInventoryReceiptsResZod)) {}

// ---------------------------------------------------------------------------
// Nhập kho / kiểm kê
// ---------------------------------------------------------------------------

export const CreateReceiptInZod = z.object({
  factoryId: IDZod,
  lines: z
    .object({
      sku: z.string().min(1).max(100),
      name: z.string().max(200).optional(),
      qty: z.number().int().positive().max(1_000_000),
      note: z.string().max(500).optional(),
    })
    .array()
    .min(1)
    .max(200),
  note: z.string().max(500).optional(),
});
export class CreateReceiptInDto extends createZodDto(extendApi(CreateReceiptInZod)) {}

export const CreateReceiptInResZod = ResZod.extend({ data: InventoryReceiptZod });
export class CreateReceiptInResDto extends createZodDto(extendApi(CreateReceiptInResZod)) {}

/** Kiểm kê: nhập số ĐẾM THỰC TẾ — service tự tính delta thành txn `adjust`. */
export const AdjustInventoryZod = z.object({
  factoryId: IDZod,
  lines: z
    .object({
      sku: z.string().min(1).max(100),
      /** Số đếm thực tế trên kệ. */
      counted: z.number().int().min(0).max(10_000_000),
      note: z.string().max(500).optional(),
    })
    .array()
    .min(1)
    .max(200),
  note: z.string().max(500).optional(),
});
export class AdjustInventoryDto extends createZodDto(extendApi(AdjustInventoryZod)) {}

export const AdjustInventoryResZod = ResZod.extend({
  data: z.object({ applied: z.number(), unchanged: z.number() }),
});
export class AdjustInventoryResDto extends createZodDto(extendApi(AdjustInventoryResZod)) {}

// ---------------------------------------------------------------------------
// Quét xuất kho theo đơn
// ---------------------------------------------------------------------------

export const ScanOutPreviewZod = z.object({
  productionId: z.string(),
  orderId: IDZod,
  factoryId: IDZod.nullish(),
  /** SKU kho suy từ đơn (variation khớp size → base+size → type+size). */
  sku: z.string().nullish(),
  /** 'variation' | 'base-size' | 'fallback' — fallback = thủ kho nên soát lại. */
  resolvedBy: z.enum(['variation', 'base-size', 'fallback']).nullish(),
  qty: z.number(),
  /** Tồn hiện tại của SKU (null = item chưa tồn tại, sẽ tự tạo khi trừ). */
  currentQuantity: z.number().nullish(),
  /** Số lần đơn này ĐÃ bị trừ (0 = chưa; ≥1 → lượt tiếp theo là rework). */
  deductedTimes: z.number(),
  lastDeductedAt: z.coerce.date().nullish(),
  /** Cờ xưởng: FE tự trừ sau khi in label giao hàng. */
  autoStockOut: z.boolean(),
});
export type ScanOutPreview = z.infer<typeof ScanOutPreviewZod>;

export const GetScanOutPreviewResZod = ResZod.extend({ data: ScanOutPreviewZod });
export class GetScanOutPreviewResDto extends createZodDto(extendApi(GetScanOutPreviewResZod)) {}

export const ScanOutZod = z.object({
  productionId: z.string().min(1),
  /** 'rework' = chủ đích trừ lần 2+ cho đơn làm lại. */
  reason: z.enum(['normal', 'rework']).default('normal'),
  source: InventoryOutSourceZod.default('scan'),
  /** Thủ kho chọn tay khi resolver không suy được / suy sai. */
  skuOverride: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});
export class ScanOutDto extends createZodDto(extendApi(ScanOutZod)) {}

export const ScanOutResZod = ResZod.extend({
  data: z.object({
    txn: InventoryTxnZod,
    /** true = requestId đã tồn tại, KHÔNG trừ thêm (gọi lặp vô hại). */
    duplicated: z.boolean(),
  }),
});
export class ScanOutResDto extends createZodDto(extendApi(ScanOutResZod)) {}

// ---------------------------------------------------------------------------
// Đối soát ngày (Admin) — trừ bù các đơn In-xong trong ngày chưa có txn out
// ---------------------------------------------------------------------------

export const ReconcileInventoryZod = z.object({
  factoryId: IDZod,
  /** Ngày theo giờ VN, dạng YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export class ReconcileInventoryDto extends createZodDto(extendApi(ReconcileInventoryZod)) {}

export const ReconcileRowZod = z.object({
  productionId: z.string(),
  orderId: IDZod,
  sku: z.string().nullish(),
  qty: z.number(),
  printCompletedAt: z.coerce.date().nullish(),
});
export type ReconcileRow = z.infer<typeof ReconcileRowZod>;

export const ReconcilePreviewResZod = ResZod.extend({ data: ReconcileRowZod.array() });
export class ReconcilePreviewResDto extends createZodDto(extendApi(ReconcilePreviewResZod)) {}

export const ReconcileApplyResZod = ResZod.extend({
  data: z.object({ applied: z.number(), skipped: z.number() }),
});
export class ReconcileApplyResDto extends createZodDto(extendApi(ReconcileApplyResZod)) {}
