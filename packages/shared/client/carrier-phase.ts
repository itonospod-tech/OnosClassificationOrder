/**
 * Carrier phase of a shipment — the legacy OnosPod `shipment_status` ladder
 * (Processing → Picked Up → Processed → In Transit → Out For Delivery → Delivery Attempt →
 * Delivered | Failed | Exception | Other), derived from the RAW carrier text we store
 * (`shipments.lastTrackingStatus`, ShippingLabelPatterns.md §3).
 *
 * Derived at READ time on purpose, never stored: as of 2026-10 nobody has seen the texts VNP
 * returns once parcels really move (VnpShipping.md, tracking cron), so these rules are a
 * best guess on USPS/VNP wording. When real texts show up, fix the rules here and every past
 * shipment re-classifies — no migration.
 *
 * ONE ordered rule list feeds both the classifier (FE badge) and the Mongo filter (BE list):
 * the first matching rule wins, and the filter for a phase is "matches this rule AND none
 * before it", so a list filtered by phase X shows exactly the rows badged X.
 *
 * Nest-free (`client/` rule): only plain data and functions here.
 */

export const CARRIER_PHASES = [
  'processing',
  'picked_up',
  'processed',
  'in_transit',
  'out_for_delivery',
  'delivery_attempt',
  'delivered',
  'failed',
  'exception',
  'other',
] as const;
export type CarrierPhase = (typeof CARRIER_PHASES)[number];

/** Purchase statuses that mean "a live label exists", the only ones with a carrier phase. */
export const CARRIER_PHASE_PURCHASE_STATUSES = ['created', 'in_transit', 'delivered'] as const;

/** Provider whose labels the customer bought elsewhere: we never poll them, so no text ≠ "processing". */
const UNTRACKED_PROVIDER = 'customer';

/**
 * Ordered rules, first match wins. Negative wordings come first: "not delivered" must not
 * read as delivered, "Out for Delivery" / "Delivery Attempt" must not read as delivered.
 */
export const CARRIER_PHASE_RULES: ReadonlyArray<{ phase: CarrierPhase; pattern: string }> = [
  { phase: 'failed', pattern: 'return(ed)? to sender|undeliverable|not delivered|delivery failed|\\blost\\b|hoàn hàng|giao (hàng )?thất bại' },
  { phase: 'exception', pattern: 'exception|alert|customs|held|on hold|delay|insufficient address|incorrect address|damaged|ngoại lệ|chậm trễ' },
  { phase: 'delivery_attempt', pattern: 'attempt|notice left|no access|unable to deliver|available for pickup|giao không thành công' },
  { phase: 'out_for_delivery', pattern: 'out for delivery|đang giao' },
  { phase: 'delivered', pattern: 'delivered|đã giao' },
  { phase: 'picked_up', pattern: 'picked up|accepted|acceptance|đã lấy hàng|đã nhận hàng' },
  // in_transit before processed: "In Transit to Next Facility" names a facility but is in transit.
  { phase: 'in_transit', pattern: 'transit|en route|on its way|moving through|đang vận chuyển' },
  { phase: 'processed', pattern: 'processed|arrived|departed|facility|sorting|đã đến|đã rời' },
  { phase: 'processing', pattern: 'pre-?shipment|pre[ -]?transit|label created|shipping label|awaiting|no tracking|not found|không có thông tin' },
];

const COMPILED = CARRIER_PHASE_RULES.map((r) => ({ phase: r.phase, re: new RegExp(r.pattern, 'i') }));

/**
 * Phase of one shipment, or `undefined` when the record is not a live label (purchasing,
 * cancelling, cancelled, failed): those have no carrier side to speak of.
 */
export function carrierPhaseOf(s: { status?: string; provider?: string; lastTrackingStatus?: string | null }): CarrierPhase | undefined {
  if (!s.status || !(CARRIER_PHASE_PURCHASE_STATUSES as readonly string[]).includes(s.status)) return undefined;
  const text = s.lastTrackingStatus?.trim();
  if (!text) return s.provider === UNTRACKED_PROVIDER ? 'other' : 'processing';
  return COMPILED.find((r) => r.re.test(text))?.phase ?? 'other';
}

type MongoCond = Record<string, unknown>;
const textMatches = (pattern: string): MongoCond => ({ lastTrackingStatus: { $regex: pattern, $options: 'i' } });
const NO_TEXT: MongoCond = { lastTrackingStatus: { $in: [null, ''] } };

/**
 * Mongo condition selecting exactly the shipments `carrierPhaseOf` puts in `phase`.
 * Mirrors the classifier rule by rule — change one, the spec on both catches the drift.
 */
export function carrierPhaseFilter(phase: CarrierPhase): MongoCond {
  const live: MongoCond = { status: { $in: [...CARRIER_PHASE_PURCHASE_STATUSES] } };
  const idx = CARRIER_PHASE_RULES.findIndex((r) => r.phase === phase);
  const earlier = (idx < 0 ? CARRIER_PHASE_RULES : CARRIER_PHASE_RULES.slice(0, idx)).map((r) => textMatches(r.pattern));
  const notEarlier = earlier.length ? { $nor: earlier } : {};
  const ruled = idx >= 0 ? [{ ...textMatches(CARRIER_PHASE_RULES[idx].pattern), ...notEarlier }] : [];
  if (phase === 'processing') {
    return { $and: [live, { $or: [{ ...NO_TEXT, provider: { $ne: UNTRACKED_PROVIDER } }, ...ruled] }] };
  }
  if (phase === 'other') {
    // Text present but matching no rule, or an untracked customer label with no text.
    return {
      $and: [live, { $or: [{ lastTrackingStatus: { $nin: [null, ''] }, ...notEarlier }, { ...NO_TEXT, provider: UNTRACKED_PROVIDER }] }],
    };
  }
  return { $and: [live, ...ruled] };
}
