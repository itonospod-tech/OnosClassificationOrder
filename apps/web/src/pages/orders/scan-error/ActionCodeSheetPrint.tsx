import React, { useEffect } from 'react';
import ReactBarcode from 'react-barcode';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ACTION_SHEET_CODES } from '@/utils/scanCodes';

/** Id cố định — CSS `@media print` nhận diện sheet qua đúng id này. */
const SHEET_ID = 'scan-action-sheet-print';

/**
 * Sheet A4 in bộ mã hành động (`OK` / `ACT-*`) dán cạnh trạm quét — công nhân
 * điều khiển popup đơn 100% bằng máy quét, không đụng chuột/bàn phím.
 *
 * Dùng khuôn portal + `display:none` siblings của `CustomerLabelPrint` (KHÔNG
 * dùng visibility-trick luôn-mount như sheet ở `pages/orders/stage-errors`):
 * trang quét còn in tem khách + label giao hàng từ chính nó, một style
 * `body * { visibility: hidden }` thường trực sẽ nuốt trắng các bản in kia.
 * Sheet chỉ tồn tại trong lúc in rồi tự gỡ → các lệnh in không giẫm nhau.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#${SHEET_ID}) { display: none !important; }
  #${SHEET_ID} { display: block !important; }
}
`;

interface Props {
  /** Gọi khi hộp thoại in đã đóng (in xong hoặc hủy) — caller unmount sheet. */
  onDone: () => void;
}

export function ActionCodeSheetPrint({ onDone }: Props) {
  const { t } = useTranslation('scanError');

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone();
    };
    window.addEventListener('afterprint', finish);
    // Chờ 2 khung hình cho barcode SVG kịp render trước khi chụp nội dung in.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print();
        // Chrome/Safari chặn luồng tới khi đóng hộp thoại; Firefox cần `afterprint`
        // — hẹn giờ là lưới an toàn cho trình duyệt không bắn sự kiện đó.
        window.setTimeout(finish, 1000);
      }),
    );
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone]);

  const sheet = (
    <div id={SHEET_ID} className="hidden bg-white text-black">
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{t('actionSheet.title')}</h2>
      <p style={{ fontSize: 11, marginBottom: 12 }}>{t('actionSheet.desc')}</p>
      {/* 2 cột — barcode 1D cần bề ngang rộng để module đủ lớn cho máy quét. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {ACTION_SHEET_CODES.map(({ payload, labelKey }) => (
          <div
            key={payload}
            style={{
              border: '2px solid #000',
              borderRadius: 8,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              breakInside: 'avoid',
            }}
          >
            <ReactBarcode value={payload} format="CODE128" width={2} height={70} displayValue={false} margin={0} />
            <div style={{ fontSize: 15, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>
              {t(`actionSheet.codes.${labelKey}.title`)}
            </div>
            <div style={{ fontSize: 10, textAlign: 'center' }}>
              {t(`actionSheet.codes.${labelKey}.desc`)} · <span style={{ fontFamily: 'monospace' }}>{payload}</span>
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 10, marginTop: 12 }}>{t('actionSheet.printDialogHint')}</p>
    </div>
  );

  return createPortal(
    <>
      <style>{PRINT_CSS}</style>
      {sheet}
    </>,
    document.body,
  );
}
