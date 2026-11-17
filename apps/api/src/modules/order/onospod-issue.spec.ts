import { BadRequestException } from '@nestjs/common';
import axios from 'axios';

import { ONOSPOD_ISSUE_CODE, OnospodIssueService } from './onospod-issue.service';

/**
 * Nút "Báo khách" (Orders.md §9f). Mỗi lần gửi thành công là một issue thật
 * tới seller, nên: đơn hủy không gửi, lỗi mạng lúc tạo issue KHÔNG gửi lại
 * và không ghi log "đã báo", ảnh đi qua kho OnosPod (presigned) chứ không gửi
 * link ngoài.
 */
jest.mock('axios');
// jest.mock has replaced axios with mocks; these references only read them to assert calls.
// eslint-disable-next-line @typescript-eslint/unbound-method
const post = axios.post as jest.Mock;
// eslint-disable-next-line @typescript-eslint/unbound-method
const put = axios.put as jest.Mock;

const ORDER = { _id: 'o1', productionId: 'TR-97920-96372', cancelledAt: null };

const make = (order: Record<string, unknown> | null = ORDER) => {
  const write = jest.fn();
  const svc = new OnospodIssueService(
    {
      onospodSystemAccount: { loginUrl: 'https://login', qcApiUrl: 'https://qc', email: 'sys@x', password: 'pw' },
    } as never,
    { get: jest.fn().mockResolvedValue('token'), set: jest.fn() } as never,
    { findById: () => ({ lean: () => Promise.resolve(order) }) } as never,
    { write } as never,
    { info: jest.fn() } as never,
  );
  return { svc, write };
};

type Gql = { query: string; variables: Record<string, unknown> };
const ok = (data: Record<string, unknown>) => Promise.resolve({ status: 200, data: { data } });

/** OnosPod giả: trả đúng từng lệnh theo nội dung query. */
const fakeOnospod = (onCreate: (vars: Record<string, unknown>) => Promise<unknown>) =>
  post.mockImplementation((_url: string, body: Gql) => {
    if (body.query.includes('paginateMrpProduct')) {
      return ok({
        paginateMrpProduct: { items: [{ _id: 'mrp-1', increment_id: ORDER.productionId, order_id: 'pod-order-1' }] },
      });
    }
    if (body.query.includes('signedUpload')) return ok({ signedUpload: { _id: 'f1', url: 'https://s3/presigned' } });
    if (body.query.includes('updatePreSignedFile')) {
      return ok({ updatePreSignedFile: { _id: 'f1', url: 'https://cdn.onospod.com/fulfillment/files/x.png' } });
    }
    if (body.query.includes('createOrderIssues')) return onCreate(body.variables);
    throw new Error(`unexpected query ${body.query}`);
  });

const createCalls = () => post.mock.calls.filter(([, body]: [string, Gql]) => body.query.includes('createOrderIssues'));

const image = {
  originalname: 'loi.png',
  mimetype: 'image/png',
  size: 10,
  buffer: Buffer.from('x'),
  encoding: '7bit',
  fieldname: 'file',
};

describe('OnospodIssueService.createIssue', () => {
  beforeEach(() => {
    post.mockReset();
    put.mockReset().mockResolvedValue({ status: 200 });
  });

  it('refuses a cancelled order without calling OnosPod', async () => {
    const { svc } = make({ ...ORDER, cancelledAt: new Date() });
    await expect(svc.createIssue('o1', 'lỗi', undefined, {})).rejects.toThrow(BadRequestException);
    expect(post).not.toHaveBeenCalled();
  });

  it('uploads the image to OnosPod storage, creates a DESIGN issue and logs who reported it', async () => {
    fakeOnospod(() =>
      ok({
        createOrderIssues: {
          _id: 'iss-1',
          code: 'DESIGN',
          status: 'OPEN',
          description: 'lỗi thân trước',
          files: [{ url: 'https://cdn.onospod.com/fulfillment/files/x.png' }],
        },
      }),
    );
    const { svc, write } = make();
    const ctx = { user: { _id: 'u1', fullName: 'Admin', email: 'a@x' } } as never;

    const issue = await svc.createIssue('o1', 'lỗi thân trước', image, ctx);

    expect(put).toHaveBeenCalledWith('https://s3/presigned', image.buffer, expect.anything());
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0][1].variables).toMatchObject({
      production_id: 'mrp-1',
      order_id: 'pod-order-1',
      description: 'lỗi thân trước',
      code: ONOSPOD_ISSUE_CODE,
      files: [{ _id: 'f1', url: 'https://cdn.onospod.com/fulfillment/files/x.png' }],
    });
    expect(issue).toMatchObject({ id: 'iss-1', status: 'OPEN' });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o1',
        action: 'report_issue',
        after: expect.objectContaining({ issueId: 'iss-1' }) as unknown,
        ctx,
      }),
    );
  });

  it('does not resend nor log when creating the issue times out', async () => {
    fakeOnospod(() => Promise.reject(new Error('timeout of 30000ms exceeded')));
    const { svc, write } = make();

    await expect(svc.createIssue('o1', 'lỗi', undefined, {})).rejects.toThrow(/Không chắc OnosPod đã nhận/);
    expect(createCalls()).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a non-image attachment before calling OnosPod', async () => {
    const { svc } = make();
    await expect(svc.createIssue('o1', 'lỗi', { ...image, mimetype: 'application/pdf' }, {})).rejects.toThrow(
      BadRequestException,
    );
    expect(post).not.toHaveBeenCalled();
  });
});
