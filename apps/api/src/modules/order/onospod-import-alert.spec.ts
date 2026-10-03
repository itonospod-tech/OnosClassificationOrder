import type { ImportFromOnosPodResDto } from 'shared';

import { OnospodImportService } from './onospod-import.service';

/**
 * The alert path only: `runImport` is stubbed, so this says nothing about the
 * import itself. What it pins down is that one flaky run stays quiet, the
 * second consecutive failure shouts, and a success clears the count.
 */
describe('OnospodImportService — cảnh báo khi import hỏng liên tiếp', () => {
  const buildService = () => {
    const alert = jest.fn().mockResolvedValue(undefined);
    const service = new OnospodImportService(
      {} as never,
      {} as never,
      {} as never,
      { alert } as never,
    );
    return { service, alert };
  };

  const fail = async (service: OnospodImportService) => {
    await expect(service.importFromOnosPod({})).rejects.toThrow('banned');
  };

  it('im lặng ở lượt hỏng đầu, báo ở lượt thứ hai', async () => {
    const { service, alert } = buildService();
    jest.spyOn(service as never as { runImport: () => Promise<never> }, 'runImport')
      .mockRejectedValue(new Error('banned'));

    await fail(service);
    expect(alert).not.toHaveBeenCalled();

    await fail(service);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toContain('banned');
  });

  it('một lượt thành công đặt lại bộ đếm', async () => {
    const { service, alert } = buildService();
    const run = jest.spyOn(service as never as { runImport: () => Promise<unknown> }, 'runImport');

    run.mockRejectedValue(new Error('banned'));
    await fail(service);

    run.mockResolvedValue({ imported: 0 } as unknown as ImportFromOnosPodResDto);
    await service.importFromOnosPod({});

    run.mockRejectedValue(new Error('banned'));
    await fail(service);
    expect(alert).not.toHaveBeenCalled();
  });
});
