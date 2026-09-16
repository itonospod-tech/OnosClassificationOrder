import i18n from '@/i18n';

/**
 * Bản sao i18n CHỈ dùng cho component ảnh của TASK-01 (`pages/guide/order/{AnnotatedShot,CalloutList,ShotLightbox}`).
 *
 * Các component đó gọi cứng `useTranslation('orderGuide')`, nên thanh trên khung ảnh ghi "Cổng seller". Không được sửa
 * file TASK-01 → tạo bản sao với KHO RESOURCE TÁCH RIÊNG (`forkResourceStore`, ghi vào đây không đụng trang
 * `/guide/ordering`), ghi đè đúng 1 khoá `orderGuide.shot.frameLabel` bằng `dtfGuide.shotFrameLabel`, rồi bọc component
 * ảnh bằng `<I18nextProvider i18n={dtfShotI18n}>` (`DtfStepBlock`). Mọi chữ khác (Phóng to, Đóng…) giữ của `orderGuide`.
 *
 * Ngôn ngữ bản sao đi theo bản chính (nút đổi ngôn ngữ ở header gọi `i18n.changeLanguage`). Xem DtfRoleGuide.md §4.3.
 */
export const dtfShotI18n = i18n.cloneInstance({ forkResourceStore: true });

for (const lng of Object.keys(i18n.options.resources ?? {})) {
  dtfShotI18n.addResource(lng, 'orderGuide', 'shot.frameLabel', i18n.t('shotFrameLabel', { lng, ns: 'dtfGuide' }));
}

const followMainLanguage = (lng: string) => {
  if (lng && dtfShotI18n.language !== lng) void dtfShotI18n.changeLanguage(lng);
};

followMainLanguage(i18n.language);
i18n.on('languageChanged', followMainLanguage);
