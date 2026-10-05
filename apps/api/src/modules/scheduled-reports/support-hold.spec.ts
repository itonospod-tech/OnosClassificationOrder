import { supportHoldLine } from './support-hold';

describe('supportHoldLine', () => {
  it('is silent when nothing is held', () => {
    expect(supportHoldLine(null)).toBeNull();
    expect(supportHoldLine({ count: 0, oldestHours: 0 })).toBeNull();
  });

  it('shows a plain line, no warning, up to and including 24h', () => {
    expect(supportHoldLine({ count: 2, oldestHours: 5.4 })).toBe('🛠 Hold Support: 2 đơn · già nhất 5h');
    expect(supportHoldLine({ count: 1, oldestHours: 24 })).not.toContain('⚠️');
  });

  it('warns only above 24h and switches to days from 48h', () => {
    expect(supportHoldLine({ count: 1, oldestHours: 24.6 })).toBe('⚠️ Hold Support: 1 đơn · già nhất 25h (quá 24h)');
    expect(supportHoldLine({ count: 3, oldestHours: 72 })).toContain('già nhất 3 ngày');
  });
});
