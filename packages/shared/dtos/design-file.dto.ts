import { createZodDto } from '@anatine/zod-nestjs';
import { extendApi } from '@anatine/zod-openapi';
import { BaseEntityZod, ResZod } from '@shared/types';
import { z } from 'zod';

import { DESIGN_CDN_VARIANTS, designCdnUrl, type DesignCdnVariant,designFileKey, designVariantUrl, extractDesignSha, Sha256Zod } from '../client';

/**
 * Design file storage (R2 + worker xử lý riêng) — xem plan
 * `documents/Plans/DesignStorage-R2-ProcessingWorker.md`.
 *
 * 1 file VẬT LÝ = 1 record `design_files`, khóa dedup = sha256 NỘI DUNG file
 * (không phải Drive ID/URL — cùng design upload 2 lần dưới 2 tên vẫn lưu 1 lần).
 * R2 key layout (URL ghép từ config `R2_PUBLIC_BASE`, KHÔNG lưu URL tuyệt đối):
 *
 *   designs/<sha256>/original       — file gốc giữ nguyên format (file in)
 *   designs/<sha256>/preview.webp   — 500×500 (drawer/dialog)
 *   designs/<sha256>/thumb.webp     — 100×100 (listing/kanban)
 *   uploads/tmp/<uuid>              — vùng chờ upload trực tiếp, worker dọn
 *
 * Vòng đời: thumb+preview giữ VĨNH VIỄN; original không dùng (lastUsedAt)
 * 60 ngày → hạ Infrequent Access; nằm IA 12 tháng → xóa thật.
 */

export const DESIGN_FILE_STATUSES = ['processing', 'ready', 'archived', 'deleted', 'failed'] as const;
export const DesignFileStatusZod = z.enum(DESIGN_FILE_STATUSES);
export type DesignFileStatus = z.infer<typeof DesignFileStatusZod>;

// Nest-free, dời sang `client/design-cdn.ts` (apps/seller ghép URL CDN sau upload).
export { DESIGN_CDN_VARIANTS, designCdnUrl, type DesignCdnVariant,designFileKey, designVariantUrl, extractDesignSha, Sha256Zod };

//
export const DesignFileZod = BaseEntityZod.extend({
  sha256: Sha256Zod,
  status: DesignFileStatusZod,
  /** Tên file thật khách đặt (hiển thị). */
  fileName: z.string().max(300).optional(),
  size: z.number().int().nonnegative().default(0),
  mime: z.string().max(100).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  /** false = file không phải ảnh raster (PSD/AI/PDF…) — không có thumb/preview. */
  hasPreview: z.boolean().default(false),
  lastUsedAt: z.union([z.string(), z.date()]).optional(),
  usageCount: z.number().int().default(0),
  errorMessage: z.string().optional(),
});
export type DesignFile = z.infer<typeof DesignFileZod>;

//
export const PresignDesignUploadZod = z.object({
  /** sha256 nội dung file — FE tính bằng WebCrypto TRƯỚC khi upload (dedup 0 giây). */
  sha256: Sha256Zod,
  size: z.number().int().positive(),
  mime: z.string().max(100),
  fileName: z.string().max(300).optional(),
});
export class PresignDesignUploadDto extends createZodDto(extendApi(PresignDesignUploadZod)) {}

export const PresignDesignUploadResZod = ResZod.extend({
  data: z.object({
    /** `exists` = dedup hit, khỏi upload — dùng luôn `file`. `upload` = PUT lên `uploadUrl`. */
    mode: z.enum(['exists', 'upload']),
    file: DesignFileZod,
    /** Base URL CDN (R2_PUBLIC_BASE) — FE ghép link qua `designCdnUrl()`. */
    publicBase: z.string(),
    uploadUrl: z.string().optional(),
    tmpKey: z.string().optional(),
  }),
});
export class PresignDesignUploadResDto extends createZodDto(extendApi(PresignDesignUploadResZod)) {}

//
export const ConfirmDesignUploadZod = z.object({
  tmpKey: z.string().min(1).max(200),
  sha256: Sha256Zod,
  fileName: z.string().max(300).optional(),
});
export class ConfirmDesignUploadDto extends createZodDto(extendApi(ConfirmDesignUploadZod)) {}

export const ConfirmDesignUploadResZod = ResZod.extend({ data: DesignFileZod });
export class ConfirmDesignUploadResDto extends createZodDto(extendApi(ConfirmDesignUploadResZod)) {}

//
export const GetDesignFileResZod = ResZod.extend({ data: DesignFileZod });
export class GetDesignFileResDto extends createZodDto(extendApi(GetDesignFileResZod)) {}

//
/**
 * Định dạng ảnh nhận được cho design/mockup. PNG là dạng chuẩn của đơn DTF
 * (nền trong suốt). Danh sách này là NGUỒN DUY NHẤT: BE trả ra ở
 * `GET /customer/designs/upload-config`, FE dùng cho `accept` của hộp thoại
 * chọn file và cho bước kiểm trước khi băm.
 */
export const DESIGN_UPLOAD_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/tiff', 'image/webp'] as const;

/** Đuôi file tương ứng — dùng khi trình duyệt để trống `File.type` (hay gặp với `.tif`). */
export const DESIGN_UPLOAD_ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp'] as const;

/**
 * Cấu hình ô tải file, đọc lúc FE mở form. Có endpoint riêng để FE KHÔNG chép
 * cứng giới hạn — đổi `DESIGN_MAX_UPLOAD_MB` ở server là FE đổi theo.
 */
export const GetDesignUploadConfigResZod = ResZod.extend({
  data: z.object({
    /** false = server chưa cấu hình kho R2 → ô chỉ nhận URL dán vào. */
    uploadEnabled: z.boolean(),
    maxUploadMb: z.number().int().positive(),
    allowedMimeTypes: z.array(z.string()),
    allowedExtensions: z.array(z.string()),
  }),
});
export class GetDesignUploadConfigResDto extends createZodDto(extendApi(GetDesignUploadConfigResZod)) {}
export type DesignUploadConfig = z.infer<typeof GetDesignUploadConfigResZod>['data'];

// ---------------------------------------------------------------------------
// RabbitMQ job contract (API publish ↔ design-worker consume)
// ---------------------------------------------------------------------------

/** Routing key + queue suffix — full name = `${RABBITMQ_MAIN_EXCHANGE}.${DESIGN_PROCESSING_QUEUE}`. */
export const DESIGN_PROCESSING_QUEUE = 'design.process';

/** Upload trực tiếp từ portal — object đã nằm ở `uploads/tmp/`, worker verify sha + resize. */
export interface DesignIngestTmpObjectJob {
  kind: 'tmp-object';
  tmpKey: string;
  /** sha FE claim — worker TỰ TÍNH LẠI, sha thật là nguồn chân lý. */
  sha256: string;
  fileName?: string;
  customerId?: string;
  userEmail?: string;
  retry?: number;
}

/** Ingest từ URL ngoài (Drive…) lúc Push to production — worker tải về, xử lý, thay URL. */
export interface DesignIngestUrlJob {
  kind: 'url';
  url: string;
  /** Key trong `designs` object (front, back, sleeve…); với target='tracking-label' chỉ mang tính log. */
  designKey: string;
  /**
   * Đích thay URL sau khi ingest: 'design' (mặc định — `designs.{key}` ở cả
   * OrderEntity lẫn staging) hoặc 'tracking-label' (label vận chuyển khách cấp
   * — CHỈ thay `items[].tracking.labelUrl` ở staging, OrderEntity chưa có field
   * tracking cho tới Phase 2).
   */
  target?: 'design' | 'tracking-label';
  /** Đơn sản xuất cần thay `designs.{designKey}` → CDN URL khi xong. */
  productionId: string;
  /** Staging doc `customer_orders` cần thay `items[].designs.{designKey}` tương ứng. */
  stagingId?: string;
  customerId?: string;
  userEmail?: string;
  retry?: number;
}

export type DesignIngestJob = DesignIngestTmpObjectJob | DesignIngestUrlJob;
