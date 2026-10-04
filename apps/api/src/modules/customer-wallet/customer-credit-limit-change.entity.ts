import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DatabaseEntity, DatabaseEntityAbstract } from 'core';
import type { HydratedDocument } from 'mongoose';

/**
 * Audit trail of credit-limit changes — APPEND-ONLY, one row per change that actually altered the value.
 *
 * Raising a seller's limit lets them spend money they have not paid in, so who/when/from/to must be
 * durable and queryable (not a rotating log line). It is a separate collection on purpose:
 *  - NOT a row in `customer_wallet_transactions`: a limit change moves no money, and a zero-amount ledger
 *    row would corrupt the ledger's meaning (every row there is `balanceBefore → balanceAfter`).
 *  - NOT an array on `customers`: `toSafeCustomer()` returns every schema path to sellers, and this trail
 *    carries staff names. A separate collection cannot leak through a customer document by default.
 */
@DatabaseEntity({ collection: 'customer_credit_limit_changes' })
export class CustomerCreditLimitChangeEntity extends DatabaseEntityAbstract {
  @Prop({ required: true, ref: 'CustomerEntity' })
  customerId: string;

  /** Limit before and after (USD). */
  @Prop({ required: true })
  from: number;

  @Prop({ required: true })
  to: number;

  @Prop({ trim: true })
  note?: string;

  @Prop({ ref: 'UserEntity' })
  byUserId?: string;

  /** Snapshot of the staff member's name at the time — the trail does not join users back. */
  @Prop({ trim: true })
  byUserName?: string;
}

export const CustomerCreditLimitChangeSchema = SchemaFactory.createForClass(CustomerCreditLimitChangeEntity);
CustomerCreditLimitChangeSchema.index({ customerId: 1, createdAt: -1 });

export type CustomerCreditLimitChangeDocument = HydratedDocument<CustomerCreditLimitChangeEntity>;
