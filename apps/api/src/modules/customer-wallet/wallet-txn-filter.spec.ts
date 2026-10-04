import { buildAdminTxnFilter } from './wallet-txn-filter';

describe('all-sellers ledger filter', () => {
  it('no filters means every transaction', () => {
    expect(buildAdminTxnFilter({})).toEqual({});
  });

  it('day bounds are Vietnam-time days, not UTC days', () => {
    const filter = buildAdminTxnFilter({ from: '2026-10-01', to: '2026-10-01' }) as {
      createdAt: { $gte: Date; $lte: Date };
    };
    // 2026-10-01 00:00 in UTC+7 is 17:00 the evening before in UTC.
    expect(filter.createdAt.$gte.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(filter.createdAt.$lte.toISOString()).toBe('2026-10-01T16:59:59.999Z');
  });

  it('accepts an open-ended range', () => {
    expect(buildAdminTxnFilter({ from: '2026-10-01' })).toEqual({
      createdAt: { $gte: new Date('2026-09-30T17:00:00.000Z') },
    });
    expect(buildAdminTxnFilter({ to: '2026-10-01' })).toEqual({
      createdAt: { $lte: new Date('2026-10-01T16:59:59.999Z') },
    });
  });

  it('passes kind and customerId straight through', () => {
    expect(buildAdminTxnFilter({ kind: 'topup', customerId: 'C1' })).toEqual({ kind: 'topup', customerId: 'C1' });
  });

  it('a search that matches no seller can match nothing', () => {
    expect(buildAdminTxnFilter({}, [])).toBeNull();
  });

  it('a search narrows to the matching sellers', () => {
    expect(buildAdminTxnFilter({}, ['C1', 'C2'])).toEqual({ customerId: { $in: ['C1', 'C2'] } });
  });

  it('customerId and search must agree, otherwise nothing matches', () => {
    expect(buildAdminTxnFilter({ customerId: 'C1' }, ['C1', 'C2'])).toEqual({ customerId: 'C1' });
    expect(buildAdminTxnFilter({ customerId: 'C9' }, ['C1', 'C2'])).toBeNull();
  });
});
