/**
 * Danh sách luồng + bước cho trang hướng dẫn lên đơn (`PATHS.ORDER_GUIDE` = `/guide/ordering`;
 * ảnh ở thư mục public `/guide/order/` — route cố ý KHÁC đường dẫn thư mục, xem OrderGuide.md §6.1).
 *
 * Hình học (file, kích thước, toạ độ, khung phần tử) KHÔNG viết tay ở đây: lấy từ
 * `guideShots.generated.ts`, file do `apps/seller/scripts/capture-order-guide.mjs` sinh cùng lúc
 * với ảnh + `manifest.json`. File này chỉ quyết định THỨ TỰ bước, khoá i18n và ô lưu ý — đổi tên
 * ảnh trong script mà quên sửa ở đây thì type-check báo lỗi ngay (khoá `keyof typeof GUIDE_SHOTS`).
 *
 * Chữ hiển thị KHÔNG lấy từ manifest (manifest chỉ có tiếng Việt, lại chứa mã đơn/giá mẫu) —
 * chữ nằm ở i18n `orderGuide`, khoá theo `flows.<flow>.steps.<id>.callouts.<n>`.
 */

import { GUIDE_SHOTS } from './guideShots.generated';
import type { GuideFlow, GuideStep } from './guideTypes';

export type { GuideCallout, GuideFlow, GuideFlowId, GuideStep } from './guideTypes';

export const GUIDE_IMAGE_BASE = `${import.meta.env.BASE_URL}guide/order/`;

const step = (id: string, shot: keyof typeof GUIDE_SHOTS, note = false): GuideStep => ({
  id,
  ...GUIDE_SHOTS[shot],
  ...(note ? { note } : {}),
});

export const GUIDE_FLOWS: GuideFlow[] = [
  {
    id: 'form',
    steps: [
      step('login', 'form-01-login'),
      step('chooseLine', 'form-02-choose-line'),
      step('pickProduct', 'form-03-pick-product'),
      step('variant', 'form-04-variant'),
      step('files', 'form-05-files', true),
      step('address', 'form-06-cart-address'),
      step('pending', 'form-07-pending', true),
    ],
  },
  {
    id: 'push',
    steps: [
      step('select', 'push-01-select'),
      step('confirm', 'push-02-dialog'),
      step('status', 'push-03-status'),
      step('detail', 'push-04-detail'),
      step('track', 'push-05-track'),
    ],
  },
  {
    id: 'import',
    steps: [
      step('open', 'import-01-open'),
      step('lookupSku', 'import-02-lookup-sku'),
      step('previewErrors', 'import-03-preview-errors'),
      step('previewValid', 'import-04-preview-valid'),
      step('result', 'import-05-result', true),
    ],
  },
];
