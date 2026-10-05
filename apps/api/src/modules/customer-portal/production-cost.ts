import { round2 } from '@/modules/customer-wallet/wallet-guard';

export interface ProductionCostInput {
  productionId?: string;
  stagingOrderId: string;
  productConfigId?: string;
  variationSku?: string;
  /** `variations[].cost` of the variation the item resolved to. */
  unitCost?: number;
  quantity?: number;
}

export interface ProductionCostRow {
  productionId: string;
  customerId: string;
  stagingOrderId: string;
  productConfigId?: string;
  variationSku?: string;
  unitCost?: number;
  quantity: number;
  amount: number;
  pushedAt: Date;
}

const isUsableCost = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Turns pushed items into ledger rows. Pure on purpose: the money rules live
 * here where a spec can pin them, not inside the push flow.
 * Items without a `productionId` are skipped (nothing to key the row on); items
 * without a usable cost are KEPT with `amount: 0` and no `unitCost`, so missing
 * cost data shows up in the ledger instead of silently shrinking it.
 */
export function buildProductionCostRows(
  customerId: string,
  pushedAt: Date,
  inputs: ProductionCostInput[],
): ProductionCostRow[] {
  const rows: ProductionCostRow[] = [];
  for (const input of inputs) {
    if (!input.productionId) continue;
    const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
    const hasCost = isUsableCost(input.unitCost);
    rows.push({
      productionId: input.productionId,
      customerId,
      stagingOrderId: input.stagingOrderId,
      productConfigId: input.productConfigId,
      variationSku: input.variationSku,
      unitCost: hasCost ? input.unitCost : undefined,
      quantity,
      amount: hasCost ? round2((input.unitCost as number) * quantity) : 0,
      pushedAt,
    });
  }
  return rows;
}
