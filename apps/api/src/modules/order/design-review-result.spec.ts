import { BadRequestException } from '@nestjs/common';

import { missingToolResultNote } from './design-review-result.guard';
import { OrderService } from './order.service';

describe('missingToolResultNote', () => {
  it('allows a non-empty toolResult with the note absent (the automated run; the note comes later from "Soát design")', () => {
    expect(missingToolResultNote({ toolResult: 'has-tool' })).toBeNull();
    expect(missingToolResultNote({ toolResult: 'no-tool', toolResultNote: undefined })).toBeNull();
  });
  it('refuses an explicit null note and a blank note', () => {
    expect(missingToolResultNote({ toolResult: 'has-tool', toolResultNote: null })).toBe('null');
    expect(missingToolResultNote({ toolResult: 'has-tool', toolResultNote: '  ' })).toBe('blank');
  });
  it('allows both fields', () => {
    expect(missingToolResultNote({ toolResult: 'has-tool', toolResultNote: 'ok' })).toBeNull();
  });
  it('allows clearing toolResult without a note (the way back into the queue)', () => {
    expect(missingToolResultNote({ toolResult: null })).toBeNull();
    expect(missingToolResultNote({ toolResult: '' })).toBeNull();
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

  it('the automated run (toolResult only, note omitted) writes toolResult and nothing else, no warn', async () => {
    const { svc, writes, warn } = build();

    await svc.setDesignReviewResult('P-1', { toolResult: 'has-tool' });

    expect(writes.map((w) => (w as [string, { field: string }])[1].field)).toEqual(['toolResult']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a blank note is refused: 400, zero writes and a warn log carrying productionId + payload', async () => {
    const { svc, writes, warn } = build();

    await expect(svc.setDesignReviewResult('P-1', { toolResult: 'has-tool', toolResultNote: ' ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(writes).toHaveLength(0);
    const logged = JSON.parse(warn.mock.calls[0][0].message);
    expect(logged).toMatchObject({ designReviewRejected: 'toolResultNote-blank', productionId: 'P-1', payload: { toolResult: 'has-tool' } });
  });

  it('an explicit null note is refused too, with a message naming that case, and nothing is written', async () => {
    const { svc, writes, warn } = build();

    await expect(svc.setDesignReviewResult('P-1', { toolResult: 'has-tool', toolResultNote: null })).rejects.toThrow(/sent as null/);

    expect(writes).toHaveLength(0);
    expect(JSON.parse(warn.mock.calls[0][0].message)).toMatchObject({ designReviewRejected: 'toolResultNote-null', payload: { toolResultNote: null } });
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
