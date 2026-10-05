import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';

/**
 * Production cost ledger — one row per pushed order item, recording what the
 * item costs OUR factory to make (`ProductConfig.variations[].cost`, the legacy
 * "base_price"). Legacy equivalent: "Production Transactions" (money plan §2).
 *
 * SHADOW MODE: rows are only recorded. Nothing reads them to move a wallet
 * balance, and pushing an order still ends in a `waived` payment. They exist so
 * weekly invoices can later be built and compared with the legacy system.
 *
 * DO NOT reuse `OrderEntity.baseCost` for this, and do not rename either. Despite
 * its name, `baseCost` holds the price the SELLER pays at push time
 * (`priceSnapshot.discountedPrice ?? unitPrice`), and the CEO Dashboard sums it
 * as revenue (`basis: 'baseCost'`). The legacy "base cost" is the opposite side
 * of the ledger: our production cost. Mixing the two would corrupt both.
 *
 * Also never use `nonShipCost` here: it is the seller-facing non-ship SELLING
 * price (measured on prod: nonShipCost > cost on 2,224 of 2,250 variations).
 *
 * Plan: `documents/Plans/LegacyClone-Money.md` §5.
 */
@DatabaseEntity({ collection: 'production_cost_entries' })
export class ProductionCostEntryEntity extends DatabaseEntityAbstract {
  /** One entry per order item; the unique index below makes recording idempotent. */
  @Prop({ required: true })
  productionId: string;

  @Prop({ required: true, ref: 'CustomerEntity', index: true })
  customerId: string;

  /** `customer_orders._id` the item was pushed from. */
  @Prop({ required: true })
  stagingOrderId: string;

  @Prop()
  productConfigId?: string;

  @Prop()
  variationSku?: string;

  /** Cost of one unit (USD). ABSENT when the variation has no `cost` filled in — that gap is data worth seeing. */
  @Prop()
  unitCost?: number;

  @Prop({ required: true, default: 1 })
  quantity: number;

  /** `unitCost × quantity`, rounded to cents; 0 when `unitCost` is missing. */
  @Prop({ required: true, default: 0 })
  amount: number;

  /** Moment the item was pushed to production (same instant as `inProductionAt`). */
  @Prop({ required: true, type: Date, index: true })
  pushedAt: Date;
}

export const ProductionCostEntrySchema = SchemaFactory.createForClass(ProductionCostEntryEntity);
// This unique index IS the idempotency guarantee (a retried push must never double-count),
// so CustomerOrderService.onModuleInit creates it explicitly: autoIndex builds in the
// background and swallows errors, and a missing index would fail silently
// (ShippingLabelPatterns.md §2 — duplicate protection belongs in the DB, not the app).
export const PRODUCTION_COST_PRODUCTION_ID_INDEX = {
  keys: { productionId: 1 },
  name: 'productionId_unique',
} as const;
ProductionCostEntrySchema.index(PRODUCTION_COST_PRODUCTION_ID_INDEX.keys, {
  name: PRODUCTION_COST_PRODUCTION_ID_INDEX.name,
  unique: true,
});

export type ProductionCostEntryDocument = HydratedDocument<ProductionCostEntryEntity>;
