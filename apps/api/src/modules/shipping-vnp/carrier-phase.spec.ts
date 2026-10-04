import { CARRIER_PHASES, carrierPhaseFilter, carrierPhaseOf } from 'shared';

/**
 * Carrier phase ladder (legacy `shipment_status`): the classifier badges a row, the Mongo
 * filter lists rows by phase. They are built from the same rule list and MUST agree: a list
 * filtered by X shows exactly the rows badged X, and every live label lands in one phase.
 *
 * The filter is checked with a tiny evaluator covering only the operators it uses, so a new
 * operator in `carrierPhaseFilter` fails loudly here instead of silently matching nothing.
 */
type Doc = { status: string; provider: string; lastTrackingStatus?: string | null };

function evalCond(doc: Record<string, unknown>, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([key, value]) => {
    if (key === '$and') return (value as Record<string, unknown>[]).every((c) => evalCond(doc, c));
    if (key === '$or') return (value as Record<string, unknown>[]).some((c) => evalCond(doc, c));
    if (key === '$nor') return !(value as Record<string, unknown>[]).some((c) => evalCond(doc, c));
    const field = doc[key] ?? null;
    if (value === null || typeof value !== 'object') return field === value;
    return Object.entries(value as Record<string, unknown>).every(([op, arg]) => {
      switch (op) {
        case '$in':
          return (arg as unknown[]).includes(field);
        case '$nin':
          return !(arg as unknown[]).includes(field);
        case '$ne':
          return field !== arg;
        case '$regex':
          return typeof field === 'string' && new RegExp(arg as string, (value as { $options?: string }).$options).test(field);
        case '$options':
          return true;
        default:
          throw new Error(`evaluator does not know ${op}`);
      }
    });
  });
}

const TEXTS = [
  undefined,
  '',
  'Pre-Shipment Info Sent to USPS',
  'Shipping Label Created, USPS Awaiting Item',
  'No tracking information',
  'Accepted at USPS Origin Facility',
  'Picked Up',
  'Arrived at USPS Regional Facility',
  'Departed USPS Facility',
  'Processed through Facility',
  'In Transit to Next Facility',
  'In-Transit',
  'Out for Delivery',
  'Delivery Attempted - No Access to Delivery Location',
  'Notice Left (No Authorized Recipient Available)',
  'Delivered, In/At Mailbox',
  'Delivered to Agent',
  'Not Delivered',
  'Return to Sender',
  'Undeliverable as Addressed',
  'Alert: Insufficient Address',
  'Held at Customs',
  'Đang vận chuyển',
  'Đã giao hàng thành công',
  'Something the rules never heard of',
];
const STATUSES = ['purchasing', 'created', 'in_transit', 'delivered', 'cancelling', 'cancelled', 'failed'];
const DOCS: Doc[] = STATUSES.flatMap((status) =>
  ['vnp-eglobal', 'customer'].flatMap((provider) => TEXTS.map((t) => ({ status, provider, lastTrackingStatus: t }))),
);

describe('carrierPhaseOf', () => {
  it.each([
    ['Pre-Shipment Info Sent to USPS', 'processing'],
    ['Accepted at USPS Origin Facility', 'picked_up'],
    ['Arrived at USPS Regional Facility', 'processed'],
    ['In Transit to Next Facility', 'in_transit'],
    ['Out for Delivery', 'out_for_delivery'],
    ['Delivery Attempted - No Access to Delivery Location', 'delivery_attempt'],
    ['Delivered, In/At Mailbox', 'delivered'],
    ['Not Delivered', 'failed'],
    ['Return to Sender', 'failed'],
    ['Alert: Insufficient Address', 'exception'],
    ['Something the rules never heard of', 'other'],
  ])('%s → %s', (text, phase) => {
    expect(carrierPhaseOf({ status: 'in_transit', provider: 'vnp-eglobal', lastTrackingStatus: text })).toBe(phase);
  });

  it('no carrier text: our label is still processing, an untracked customer label is "other"', () => {
    expect(carrierPhaseOf({ status: 'created', provider: 'vnp-eglobal', lastTrackingStatus: '' })).toBe('processing');
    expect(carrierPhaseOf({ status: 'created', provider: 'customer' })).toBe('other');
  });

  it('labels that are not live (purchasing, cancelled, failed…) have no carrier phase', () => {
    for (const status of ['purchasing', 'cancelling', 'cancelled', 'failed']) {
      expect(carrierPhaseOf({ status, provider: 'vnp-eglobal', lastTrackingStatus: 'Delivered' })).toBeUndefined();
    }
  });
});

describe('carrierPhaseFilter ≡ carrierPhaseOf', () => {
  it.each(CARRIER_PHASES)('filter "%s" selects exactly the rows classified "%s"', (phase) => {
    const viaFilter = DOCS.filter((d) => evalCond(d as unknown as Record<string, unknown>, carrierPhaseFilter(phase)));
    const viaClassifier = DOCS.filter((d) => carrierPhaseOf(d) === phase);
    expect(viaFilter).toEqual(viaClassifier);
  });

  it('every live label falls in exactly one phase; non-live labels in none', () => {
    for (const d of DOCS) {
      const hits = CARRIER_PHASES.filter((p) => evalCond(d as unknown as Record<string, unknown>, carrierPhaseFilter(p)));
      expect(hits).toHaveLength(carrierPhaseOf(d) ? 1 : 0);
    }
  });
});
