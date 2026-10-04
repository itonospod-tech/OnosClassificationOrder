/**
 * Entry NEST-FREE của `shared` cho app chạy trong trình duyệt (`apps/seller` import
 * `shared/client`): schema Zod + hàm thuần dùng chung FE/BE mà không kéo
 * `@anatine/zod-nestjs`/`@nestjs/*` vào bundle. Các file `dtos/*.dto.ts` re-export
 * lại từ đây nên BE và `apps/web` (import `shared`) không phải đổi gì.
 *
 * Quy tắc: file trong `client/` CHỈ được import `zod` và file khác trong `client/`.
 */
export * from './carrier-phase';
export * from './customer-import';
export * from './design-cdn';
export * from './design-fields';
export * from './print-area';
export * from './seller-shipping';
export * from './shipping';
export * from './wallet';
