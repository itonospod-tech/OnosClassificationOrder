import React, { useEffect } from 'react';
import ReactBarcode from 'react-barcode';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import { QRCodeSVG } from 'qrcode.react';
import type { ShippingLabel } from 'shared';

import { PATHS } from '@/constants/paths';

/** Id cố định — bộ CSS `@media print` bên dưới nhận diện nhãn qua đúng id này. */
const LABEL_ID = 'shipping-label-print';

/** Class của 1 con tem — bộ CSS in bên dưới ngắt trang theo đúng class này. */
const PAGE_CLASS = 'shipping-label-page';

/**
 * Label giao hàng khổ **4×6 INCH** (Orders.md §16.8) — kiểu label carrier
 * "DO NOT SHIP" dán túi/kiện, KHÁC tem khách 4×6cm (`CustomerLabelPrint`) và
 * tem barcode xưởng 75×50mm (`BarcodeLabelPrint`). In được 1 hoặc N đơn, mỗi
 * đơn 1 trang. Dữ liệu BE trả sẵn qua `POST /orders/shipping-labels` — caller
 * PHẢI lọc đơn thiếu `shippingAddress` ra trước và tự cảnh báo (in tem giao
 * hàng không địa chỉ là tem rác).
 *
 * Cơ chế in giống hệt 2 tem kia: portal ra `document.body` + `display:none`
 * mọi anh chị em lúc in. Xem comment `CustomerLabelPrint` cho lý do từng lựa
 * chọn. Khác duy nhất: tem này có ẢNH mockup từ CDN — phải CHỜ ảnh tải xong
 * (có trần thời gian) trước khi mở hộp thoại in, không thì tem ra ô ảnh trống.
 */
const PRINT_CSS = `
@media print {
  @page { size: 4in 6in; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#${LABEL_ID}) { display: none !important; }
  #${LABEL_ID} { display: block !important; }
  .${PAGE_CLASS} { break-after: page; page-break-after: always; }
  .${PAGE_CLASS}:last-child { break-after: auto; page-break-after: auto; }
}
`;

/** Trần chờ ảnh mockup (ms) — CDN chậm/hỏng thì vẫn in, ô ảnh để trống. */
const IMAGE_WAIT_MS = 2500;

/**
 * Đơn có đủ địa chỉ để in label giao hàng chưa — tối thiểu phải có số nhà/
 * đường + (thành phố hoặc zip). Caller (menu "..." + thanh bulk) dùng CÙNG
 * hàm này để tách đơn thiếu địa chỉ ra cảnh báo thay vì in tem trống.
 */
export function hasShippingAddress(label: ShippingLabel): boolean {
  const a = label.shippingAddress;
  return !!(a?.address1?.trim() && (a.city?.trim() || a.postcode?.trim()));
}

interface Props {
  /** Label cần in — thứ tự mảng CHÍNH LÀ thứ tự tem chui ra máy in. */
  labels: ShippingLabel[];
  /** Gọi khi hộp thoại in đã đóng (in xong hoặc hủy) — caller unmount nhãn. */
  onDone: () => void;
}

/** Mount → chờ ảnh → in → báo caller gỡ xuống (cùng vòng đời 2 tem hiện có). */
export function ShippingLabelPrint({ labels, onDone }: Props) {
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone();
    };
    if (labels.length === 0) {
      finish();
      return;
    }
    window.addEventListener('afterprint', finish);
    let timer: number | undefined;
    // Chờ MỌI ảnh mockup trong nhãn tải xong (hoặc lỗi, hoặc chạm trần
    // IMAGE_WAIT_MS) rồi mới window.print() — ảnh CDN chưa về mà chụp nội
    // dung in là tem ra ô trống dù màn hình sau đó hiện đủ.
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(`#${LABEL_ID} img`));
    const allLoaded = Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    );
    const capped = Promise.race([allLoaded, new Promise<void>((r) => window.setTimeout(r, IMAGE_WAIT_MS))]);
    void capped.then(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.print();
          timer = window.setTimeout(finish, 1000);
        }),
      );
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone, labels.length]);

  return createPortal(
    <>
      <style>{PRINT_CSS}</style>
      <div id={LABEL_ID} className="hidden">
        {labels.map((l) => (
          <Label key={l._id} label={l} />
        ))}
      </div>
    </>,
    document.body,
  );
}

/** 288 g → "0 lb 10.2 oz (288 g)". Không có cân → null, bỏ hẳn dòng. */
function formatWeight(gram?: number): string | null {
  if (!gram || gram <= 0) return null;
  const lb = Math.floor(gram / 453.592);
  const oz = (gram % 453.592) / 28.3495;
  return `${lb} lb ${oz.toFixed(1)} oz (${Math.round(gram)} g)`;
}

/**
 * Thân 1 con tem, dựng theo mẫu label OnosPod cũ mà kho đã quen mắt (ảnh mẫu
 * ở Orders.md §16.8): khối "G" + xưởng gửi + POSTAGE PAID → banner DO NOT
 * SHIP → QR + người nhận → TRACKING # barcode → ảnh sản phẩm + SKU/seller.
 *
 * Chữ trên MẶT TEM cố ý là tiếng Anh cố định (DO NOT SHIP, POSTAGE PAID,
 * TRACKING #, Seller/Size/Color...) — label dán kiện quốc tế theo khuôn
 * carrier, KHÔNG đổi theo toggle ngôn ngữ UI (cùng tiền lệ trang Careers).
 *
 * Barcode = `productionId` TRẦN, không prefix `N-` (chốt nghiệp vụ theo ảnh
 * mẫu — mã dưới vạch in LIỀN, không giãn cách). Muốn quét ở trạm xưởng thì
 * dùng tem barcode 75×50mm, không phải tem này.
 */
function Label({ label }: { label: ShippingLabel }) {
  const trackUrl = `${window.location.origin}${PATHS.TRACK}/${label.productionId}`;
  const a = label.shippingAddress;
  const name = [a?.firstName, a?.lastName].filter(Boolean).join(' ').toUpperCase();
  const cityLine = [a?.city, a?.state, a?.postcode].filter(Boolean).join(' ').toUpperCase();
  const weight = formatWeight(label.weightGram);
  const today = dayjs().format('MM/DD/YYYY');
  const skuLine = [label.sku, label.quantity ? `× ${label.quantity}` : ''].filter(Boolean).join(' ');
  const attrs = [
    label.userSku ? `Seller: ${label.userSku}` : '',
    label.size ? `Size: ${label.size}` : '',
    label.color ? `Color: ${label.color}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={`${PAGE_CLASS} flex flex-col bg-white text-black overflow-hidden`}
      style={{ width: '4in', height: '6in', padding: '0.16in', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <div className="flex items-start" style={{ gap: '10px' }}>
        <div
          className="flex items-center justify-center font-extrabold shrink-0"
          style={{ border: '3px solid #000', width: '0.58in', height: '0.58in', fontSize: '31pt' }}
        >
          G
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold leading-tight" style={{ fontSize: '13pt' }}>
            {label.factoryName || 'OnosFactory'}
          </div>
          <div style={{ fontSize: '7pt', lineHeight: 1.3 }}>
            <div>OnosFactory</div>
            <div>DO NOT SHIP</div>
            <div>{today}</div>
            {weight && <div>{weight}</div>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span
            className="inline-block font-bold"
            style={{ border: '2px solid #000', fontSize: '7.5pt', padding: '3px 8px', letterSpacing: '.4px' }}
          >
            POSTAGE PAID
          </span>
        </div>
      </div>

      <div style={{ borderTop: '2.5px solid #000', marginTop: '7px' }} />
      <div className="flex justify-between items-baseline" style={{ padding: '4px 0 2px' }}>
        <b style={{ fontSize: '17pt', letterSpacing: '.5px' }}>DO NOT SHIP</b>
        <span style={{ fontSize: '7.5pt' }}>Created {today}</span>
      </div>
      <div style={{ fontSize: '8pt', lineHeight: 1.3, padding: '1px 0 6px' }}>
        {label.factoryName || 'OnosFactory'} · Việt Nam
      </div>

      <div className="flex items-start" style={{ gap: '12px', padding: '3px 0 8px' }}>
        {/* QR trỏ trang tra cứu công khai — CÙNG convention tem khách 4×6cm. */}
        <ShippingQr value={trackUrl} />
        <div className="font-bold min-w-0" style={{ fontSize: '10.5pt', lineHeight: 1.35 }}>
          {name && <div>{name}</div>}
          {a?.company && <div>{a.company.toUpperCase()}</div>}
          {a?.address1 && <div>{a.address1.toUpperCase()}</div>}
          {a?.address2 && <div>{a.address2.toUpperCase()}</div>}
          {cityLine && <div>{cityLine}</div>}
          {a?.country && a.country.toUpperCase() !== 'US' && <div>{a.country.toUpperCase()}</div>}
          {a?.phone && (
            <div className="font-normal" style={{ fontSize: '9pt' }}>
              {a.phone}
            </div>
          )}
        </div>
      </div>

      <div
        className="text-center font-extrabold"
        style={{ borderTop: '2.5px solid #000', borderBottom: '1px solid #000', fontSize: '10pt', letterSpacing: '1px', padding: '2px 0' }}
      >
        TRACKING&nbsp;#
      </div>
      {/* width={1.6}: productionId 14 ký tự → Code128 189 module ≈ 3.15in —
          lọt lòng tem 3.68in kèm quiet zone. KHÔNG kéo giãn SVG bằng CSS
          (JsBarcode xuất svg không viewBox — cùng cảnh báo BarcodeLabelPrint). */}
      <div className="flex justify-center" style={{ padding: '8px 0 3px' }}>
        <ReactBarcode value={label.productionId} format="CODE128" width={1.6} height={62} displayValue={false} margin={0} />
      </div>
      <div className="text-center font-bold" style={{ fontSize: '12.5pt', letterSpacing: '1.5px' }}>
        {label.productionId}
      </div>

      <div className="flex items-start" style={{ borderTop: '1px solid #000', marginTop: '7px', paddingTop: '6px', gap: '10px' }}>
        {label.mockupUrl && (
          <img
            src={label.mockupUrl}
            alt=""
            className="shrink-0 object-contain"
            style={{ width: '0.85in', height: '0.85in', border: '1px solid #000' }}
          />
        )}
        <div className="min-w-0" style={{ fontSize: '8.5pt', lineHeight: 1.5 }}>
          {skuLine && (
            <div className="font-bold break-all" style={{ fontSize: '9pt' }}>
              {skuLine}
            </div>
          )}
          {attrs && <div>{attrs}</div>}
          {label.orderId && <div>Merchant ID: {label.orderId}</div>}
        </div>
      </div>
    </div>
  );
}

/** QR 88px ≈ 23mm — dư ngưỡng camera điện thoại đọc được. */
function ShippingQr({ value }: { value: string }) {
  return <QRCodeSVG value={value} size={88} level="M" marginSize={0} />;
}
