import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import type { IFile } from 'core';
import { Model } from 'mongoose';
import type { OnospodIssue } from 'shared';
import { Logger } from 'winston';

import { ApiConfigService } from '@/shared/services';

import type { AuditContext } from '../order-log/order-log.service';
import { OrderLogService } from '../order-log/order-log.service';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  OnospodAuthError,
  OnospodGraphqlError,
  OnospodNetworkError,
  OnospodSystemSession,
} from './onospod-system.client';
import { OrderEntity } from './order.entity';

/** Key `system_configs` giữ token tài khoản OnosPod hệ thống (chứa mật khẩu — không có API đọc key này). */
export const ONOSPOD_SYSTEM_TOKEN_CONFIG_KEY = 'onospod_system_token';

/** Mã issue OnosPod dùng — 873/873 issue thật tới 17/11/2026 đều là DESIGN. */
export const ONOSPOD_ISSUE_CODE = 'DESIGN';

/** `signedUpload.type` cho file đính kèm issue — ra đúng thư mục `fulfillment/files/` như issue gửi tay. */
const ONOSPOD_UPLOAD_TYPE = 'design';

export const ONOSPOD_ISSUE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

const FIND_PRODUCTION_QUERY = `query ($increment_id: String) {
  paginateMrpProduct(increment_id: $increment_id, page: 1, perpage: 5) { items { _id increment_id order_id } }
}`;
const SIGNED_UPLOAD_MUTATION = `mutation ($type: String!, $filename: String!, $mimetype: String, $size: Int) {
  signedUpload(type: $type, filename: $filename, mimetype: $mimetype, size: $size) { _id url }
}`;
const CONFIRM_UPLOAD_MUTATION = `mutation ($id: String!) { updatePreSignedFile(_id: $id) { _id url } }`;
const ISSUE_FIELDS = '_id code status description created_at files { _id url } production { increment_id }';
const CREATE_ISSUE_MUTATION = `mutation ($production_id: ID, $order_id: ID, $description: String, $code: String, $files: [InputFile!]) {
  createOrderIssues(production_id: $production_id, order_id: $order_id, description: $description, code: $code, files: $files) { ${ISSUE_FIELDS} }
}`;
const LIST_ISSUES_QUERY = `query ($production_id: ID) {
  paginateIssues(production_id: $production_id, page: 1, page_size: 50) { items { ${ISSUE_FIELDS} } }
}`;

type RawIssue = {
  _id?: string;
  code?: string;
  status?: string;
  description?: string;
  created_at?: string | null;
  files?: Array<{ url?: string | null }> | null;
};

export function toOnospodIssue(raw: RawIssue): OnospodIssue {
  return {
    id: String(raw._id ?? ''),
    code: raw.code ?? '',
    status: raw.status ?? '',
    description: raw.description ?? '',
    createdAt: raw.created_at ?? null,
    fileUrls: (raw.files ?? []).map((f) => f?.url ?? '').filter(Boolean),
  };
}

/**
 * Nút "Báo khách" (Orders.md §9f): gửi issue lỗi file sang OnosPod bằng tài
 * khoản hệ thống — kết quả y như bấm "Send Issue" ở qc.onospod.com, seller
 * thấy ở mục "Issue Orders". Người bấm thật ghi ở `orderLogs` (OnosPod chỉ
 * thấy tài khoản hệ thống).
 */
@Injectable()
export class OnospodIssueService {
  private session: OnospodSystemSession | null = null;

  constructor(
    private readonly apiConfigService: ApiConfigService,
    private readonly systemConfigService: SystemConfigService,
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    private readonly orderLogService: OrderLogService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  async listIssues(orderId: string): Promise<OnospodIssue[]> {
    const order = await this.loadOrder(orderId);
    const production = await this.findProduction(order.productionId);
    const data = await this.call(LIST_ISSUES_QUERY, { production_id: production.id });
    const items = (data.paginateIssues as { items?: RawIssue[] } | undefined)?.items ?? [];
    return items.map(toOnospodIssue);
  }

  async createIssue(orderId: string, description: string, file: IFile | undefined, ctx: AuditContext) {
    const order = await this.loadOrder(orderId);
    if (order.cancelledAt) throw new BadRequestException('Đơn đã hủy — không báo khách.');
    if (file) this.assertImage(file);

    const production = await this.findProduction(order.productionId);
    const uploaded = file ? await this.uploadImage(file) : null;

    let data: Record<string, unknown>;
    try {
      data = await this.getSession().graphql(CREATE_ISSUE_MUTATION, {
        // Cùng cặp id mà nút "Send Issue" gửi (issue thật 17/11: production_id =
        // `_id` MrpProduct, order_id = `order_id` của chính MrpProduct đó).
        production_id: production.id,
        order_id: production.orderId,
        description,
        code: ONOSPOD_ISSUE_CODE,
        files: uploaded ? [uploaded] : undefined,
      });
    } catch (err) {
      if (err instanceof OnospodNetworkError) {
        // Không biết OnosPod đã tạo issue chưa → KHÔNG tự gửi lại; FE nạp lại
        // danh sách issue của đơn để người bấm tự xem trước khi gửi lần nữa.
        throw new BadRequestException(
          'Không chắc OnosPod đã nhận báo lỗi (mạng/hết giờ) — xem lại danh sách báo lỗi của đơn trước khi gửi lại.',
        );
      }
      throw this.toHttpError(err);
    }

    const issue = toOnospodIssue((data.createOrderIssues ?? {}) as RawIssue);
    void this.orderLogService.write({
      orderId,
      action: 'report_issue',
      field: 'onospodIssue',
      before: null,
      after: { issueId: issue.id, description, fileUrl: uploaded?.url ?? null },
      ctx,
    });
    this.logger.info({
      message: JSON.stringify({
        event: 'onospod_issue_created',
        orderId,
        productionId: order.productionId,
        issueId: issue.id,
      }),
    });
    return issue;
  }

  private async loadOrder(orderId: string) {
    const order = await this.orderModel
      .findById(orderId, { productionId: 1, cancelledAt: 1 })
      .lean<{ productionId?: string; cancelledAt?: Date | null }>();
    if (!order) throw new NotFoundException('Order not found');
    if (!order.productionId) throw new BadRequestException('Đơn không có mã sản xuất OnosPod.');
    return order as { productionId: string; cancelledAt?: Date | null };
  }

  /** Dòng sản xuất (MrpProduct) bên OnosPod theo `productionId` (= `increment_id`): `_id` + `order_id` đơn mẹ. */
  private async findProduction(productionId: string): Promise<{ id: string; orderId?: string }> {
    const data = await this.call(FIND_PRODUCTION_QUERY, { increment_id: productionId });
    const items = (
      data.paginateMrpProduct as
        | { items?: Array<{ _id?: string; increment_id?: string; order_id?: string | null }> }
        | undefined
    )?.items;
    const hit = (items ?? []).find((i) => i.increment_id === productionId);
    if (!hit?._id) throw new BadRequestException(`Không tìm thấy đơn ${productionId} bên OnosPod.`);
    return { id: hit._id, orderId: hit.order_id || undefined };
  }

  /** Tải ảnh lên kho OnosPod (presigned PUT) → `{ _id, url }` dạng cdn.onospod.com như issue gửi tay. */
  private async uploadImage(file: IFile): Promise<{ _id: string; url: string }> {
    const signed = (
      await this.call(SIGNED_UPLOAD_MUTATION, {
        type: ONOSPOD_UPLOAD_TYPE,
        filename: file.originalname || 'issue.png',
        mimetype: file.mimetype,
        size: file.size,
      })
    ).signedUpload as { _id?: string; url?: string } | undefined;
    if (!signed?._id || !signed.url) throw new BadRequestException('OnosPod không cấp được link tải ảnh.');
    try {
      await axios.put(signed.url, file.buffer, { headers: { 'Content-Type': file.mimetype }, timeout: 60_000 });
    } catch (err) {
      throw new BadRequestException(
        `Tải ảnh lên OnosPod thất bại: ${axios.isAxiosError(err) ? err.message : 'lỗi mạng'}`,
      );
    }
    const confirmed = (await this.call(CONFIRM_UPLOAD_MUTATION, { id: signed._id })).updatePreSignedFile as
      | { _id?: string; url?: string }
      | undefined;
    if (!confirmed?._id || !confirmed.url) throw new BadRequestException('OnosPod không xác nhận được ảnh đã tải.');
    return { _id: confirmed._id, url: confirmed.url };
  }

  private assertImage(file: IFile) {
    if (!IMAGE_MIME.test(file.mimetype || '')) throw new BadRequestException('Chỉ nhận ảnh PNG/JPG/WEBP/GIF.');
    if (file.size > ONOSPOD_ISSUE_IMAGE_MAX_BYTES) throw new BadRequestException('Ảnh quá 10 MB.');
  }

  /** Lệnh đọc / bước chuẩn bị: mọi lỗi đổi sang 400 có message tiếng Việt. */
  private async call(query: string, variables: Record<string, unknown>) {
    try {
      return await this.getSession().graphql(query, variables);
    } catch (err) {
      throw this.toHttpError(err);
    }
  }

  private toHttpError(err: unknown) {
    if (err instanceof BadRequestException || err instanceof NotFoundException) return err;
    if (err instanceof OnospodAuthError) {
      return new BadRequestException('OnosPod không nhận tài khoản hệ thống — kiểm tra ONOSPOD_SYSTEM_EMAIL/PASSWORD.');
    }
    if (err instanceof OnospodGraphqlError || err instanceof OnospodNetworkError) {
      return new BadRequestException(`OnosPod trả lỗi: ${err.message}`);
    }
    return err;
  }

  private getSession(): OnospodSystemSession {
    if (this.session) return this.session;
    const account = this.apiConfigService.onospodSystemAccount;
    if (!account) {
      throw new BadRequestException(
        'Chưa cấu hình tài khoản OnosPod hệ thống (ONOSPOD_SYSTEM_EMAIL/ONOSPOD_SYSTEM_PASSWORD).',
      );
    }
    this.session = new OnospodSystemSession(account, {
      load: () => this.systemConfigService.get<string>(ONOSPOD_SYSTEM_TOKEN_CONFIG_KEY),
      write: (token) =>
        this.systemConfigService.set(ONOSPOD_SYSTEM_TOKEN_CONFIG_KEY, token, 'Token OnosPod tài khoản hệ thống'),
    });
    return this.session;
  }
}
