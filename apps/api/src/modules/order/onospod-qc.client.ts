import { BadRequestException } from '@nestjs/common';
import axios from 'axios';

/**
 * Client GraphQL `qc.onospod.com` (`paginateMrpProduct`) dùng chung cho
 * `OnospodImportService` (import đơn To Do/Ready) và `OnospodHoldSyncService`
 * (đồng bộ giữ đơn, Orders.md §9d). CHỈ query đọc — không có mutation nào ở đây.
 */
export type OnospodQcConfig = { apiUrl: string; bearerToken: string };

export type MrpPaginate = {
  total_items?: number | null;
  current_page?: number | null;
  total_pages?: number | null;
};

export type MrpPageRequest = {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
};

/**
 * Gọi 1 trang `paginateMrpProduct`. Ném `BadRequestException` khi lỗi mạng/HTTP,
 * lỗi GraphQL, hoặc response thiếu `paginateMrpProduct` — message giữ nguyên như
 * bản cũ trong `OnospodImportService.fetchPage()`.
 */
export async function fetchMrpProductPage<T>(
  config: OnospodQcConfig,
  request: MrpPageRequest,
  page: number,
): Promise<{ items: T[]; paginate: MrpPaginate }> {
  let res;
  try {
    res = await axios.post(
      config.apiUrl,
      { operationName: request.operationName, variables: request.variables, query: request.query },
      {
        headers: {
          Authorization: `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
          // Gateway OnosPod (qc.onospod.com lẫn api.onospod.com) chặn 403 nếu
          // THIẾU header `origin` — verify bằng test gọi thật 2026-07-23, xem
          // comment `ONOSPOD_ORIGIN` ở `onospod-order-lookup.service.ts`.
          // KHÔNG liên quan token/password dù message dễ gây nhầm.
          Origin: 'https://qc.onospod.com',
          Referer: 'https://qc.onospod.com/',
        },
        timeout: 30_000,
      },
    );
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const message = axios.isAxiosError(err) ? err.message : 'Unknown error';
    throw new BadRequestException(`Gọi OnosPod (page ${page}) thất bại: ${message}${status ? ` (HTTP ${status})` : ''}`);
  }

  const gqlErrors = res.data?.errors;
  if (Array.isArray(gqlErrors) && gqlErrors.length > 0) {
    throw new BadRequestException(`OnosPod trả lỗi: ${gqlErrors.map((e: { message?: string }) => e.message).join('; ')}`);
  }

  const result = res.data?.data?.paginateMrpProduct;
  if (!result) {
    throw new BadRequestException(`OnosPod không trả dữ liệu (page ${page}).`);
  }

  return { items: (result.items || []) as T[], paginate: result.paginate || {} };
}
