import { BadRequestException } from '@nestjs/common';

import { missingToolResultNote } from './design-review-result.guard';
import { OrderService } from './order.service';

describe('missingToolResultNote', () => {
  it('refuses a non-empty toolResult with the note absent', () => {
    expect(missingToolResultNote({ toolResult: 'has-tool' })).toBe(true);
    expect(missingToolResultNote({ toolResult: 'no-tool', toolResultNote: undefined })).toBe(true);
  });
  it('allows both fields', () => {
    expect(missingToolResultNote({ toolResult: 'has-tool', toolResultNote: 'ok' })).toBe(false);
  });
  it('allows clearing toolResult without a note (the way back into the queue)', () => {
    expect(missingToolResultNote({ toolResult: null })).toBe(false);
    expect(missingToolResultNote({ toolResult: '' })).toBe(false);
  });
  it('allows an explicit null note (intent stated; omission is the bug)', () => {
    expect(missingToolResultNote({ toolResult: 'has-tool', toolResultNote: null })).toBe(false);
  });
});

describe('setDesignReviewResult — refuses before any write', () => {
  const build = () => {
    const writes: unknown[] = [];
    const warn = jest.fn();
    const svc = Object.create(OrderService.prototype) as OrderService;
    const anySvc = svc as unknown as Record<string, unknown>;
    anySvc['logger'] = { warn };
    anySvc['orderModel'] = {
      db: {},
      findOne: () => ({ lean: async () => ({ _id: 'o1', factoryId: 'f1' }) }),
    };
    anySvc['updateField'] = async (...a: unknown[]) => {
      writes.push(a);
      return { success: true, data: {} };
    };

    return { svc, writes, warn };
  };

  it('400, zero writes and a warn log carrying productionId + payload', async () => {
    const { svc, writes, warn } = build();

    await expect(svc.setDesignReviewResult('P-1', { toolResult: 'has-tool' })).rejects.toBeInstanceOf(BadRequestException);

    expect(writes).toHaveLength(0);
    const logged = JSON.parse(warn.mock.calls[0][0].message);
    expect(logged).toMatchObject({ productionId: 'P-1', payload: { toolResult: 'has-tool' } });
  });

  it('writes both fields as before when both are sent', async () => {
    const { svc, writes } = build();
    await svc.setDesignReviewResult('P-1', { toolResult: 'has-tool', toolResultNote: 'ok' });
    expect(writes.map((w) => (w as [string, { field: string }])[1].field)).toEqual(['toolResult', 'toolResultNote']);
  });

  it('clearing toolResult with no note still goes through', async () => {
    const { svc, writes } = build();
    await svc.setDesignReviewResult('P-1', { toolResult: null });
    expect(writes).toHaveLength(1);
  });
});
