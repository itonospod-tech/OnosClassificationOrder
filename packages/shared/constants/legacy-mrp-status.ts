import type { LifecycleStageKey } from '../dtos/production-order.dto';

/**
 * The six MRP statuses of the legacy OnosPod system, in its own order. `To Do` and `Ready` are
 * "queue" states before any work; the rest name the station the item is at.
 */
export const LEGACY_MRP_STATUSES = ['To Do', 'Ready', 'In Cutting', 'In Print', 'In Sewing', 'Packing'] as const;
export type LegacyMrpStatus = (typeof LEGACY_MRP_STATUSES)[number];

/**
 * Display-only hint: which legacy MRP status an item at a lifecycle stage would show. The two
 * models are NOT 1-1 (there is no cutting stage here; tool check and design sit before production;
 * factory `flowType` auto-completes some stages), so this never drives logic.
 *
 * `waiting` is used while the stage has not started, `active` once it has.
 *
 * Only the sewing and packing rows are corroborated by a real legacy timeline
 * (Ready → In Sewing → Packing). `To Do` vs `Ready`, and the QC-after-press row, are best guesses
 * and still need confirming with the workshop.
 */
export const LEGACY_MRP_STATUS_BY_STAGE: Record<LifecycleStageKey, { waiting: LegacyMrpStatus; active: LegacyMrpStatus }> =
  {
    'tool-check': { waiting: 'To Do', active: 'To Do' },
    designer: { waiting: 'To Do', active: 'To Do' },
    print: { waiting: 'Ready', active: 'In Print' },
    press: { waiting: 'In Print', active: 'In Print' },
    'qc-post-press': { waiting: 'In Print', active: 'In Print' },
    'sew-in': { waiting: 'In Sewing', active: 'In Sewing' },
    'sew-out': { waiting: 'In Sewing', active: 'In Sewing' },
    pack: { waiting: 'Packing', active: 'Packing' },
  };
