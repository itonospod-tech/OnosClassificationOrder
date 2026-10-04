import { LEGACY_MRP_STATUS_BY_STAGE, LEGACY_MRP_STATUSES, LIFECYCLE_STAGE_KEYS } from 'shared';

describe('LEGACY_MRP_STATUS_BY_STAGE', () => {
  it('covers every lifecycle stage and only uses known legacy statuses', () => {
    expect(Object.keys(LEGACY_MRP_STATUS_BY_STAGE).sort()).toEqual([...LIFECYCLE_STAGE_KEYS].sort());
    for (const { waiting, active } of Object.values(LEGACY_MRP_STATUS_BY_STAGE)) {
      expect(LEGACY_MRP_STATUSES).toContain(waiting);
      expect(LEGACY_MRP_STATUSES).toContain(active);
    }
  });

  it('never maps to In Cutting, which has no stage here', () => {
    const used = Object.values(LEGACY_MRP_STATUS_BY_STAGE).flatMap((v) => [v.waiting, v.active]);
    expect(used).not.toContain('In Cutting');
  });

  it('follows the order of the legacy flow as the item moves down the stages', () => {
    const rank = (s: (typeof LEGACY_MRP_STATUSES)[number]) => LEGACY_MRP_STATUSES.indexOf(s);
    const ranks = LIFECYCLE_STAGE_KEYS.map((k) => rank(LEGACY_MRP_STATUS_BY_STAGE[k].active));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
