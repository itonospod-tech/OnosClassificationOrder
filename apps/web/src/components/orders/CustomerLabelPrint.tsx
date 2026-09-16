import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { QRCodeSVG } from 'qrcode.react';

import { PATHS } from '@/constants/paths';

import { buildDesignLabels, DESIGN_KEY_ORDER } from '@/components/orders/cells/DesignThumbsCell';
import type { WorkshopOrderRow } from '@/components/orders/workshopTableConfig';

/** Id cố định — bộ CSS `@media print` bên dưới nhận diện nhãn qua đúng id này. */
const LABEL_ID = 'customer-label-print';

/** Class của 1 con tem — bộ CSS in bên dưới ngắt trang theo đúng class này. */
const PAGE_CLASS = 'customer-label-page';

/**
 * ⚠️ **HIỆN KHÔNG CÓ NƠI GỌI** — chốt 16/09/2026: tem nhỏ chuyển sang mẫu tem
 * hệ cũ (barcode `N-<productionId>`, khổ 60×40mm) ở `BarcodeLabelPrint`. File
 * này giữ nguyên để bật lại bằng đúng một dòng nếu quay lại tem QR; trang tra
 * cứu công khai `/track/:productionId` vẫn chạy bình thường, chỉ là mã không
 * còn được in dưới dạng QR lên tem.
 *
 * Nhãn dán cho khách, khổ **40×60mm** (4×6cm, dọc) — khổ tem decal rời phổ
 * biến ở xưởng, KHÔNG phải 4×6 inch. In được **1 hoặc nhiều** đơn trong cùng
 * một lệnh in (mỗi đơn 1 con tem = 1 trang).
 *
 * Cách in: portal thẳng ra `document.body` rồi để `@media print` giấu mọi
 * anh chị em cùng cấp. Không dùng `visibility: hidden` như sheet barcode ở
 * `pages/orders/stage-errors` — chiều cao thân trang vẫn còn nguyên nên máy
 * in đẩy thêm vài tem trắng, chấp nhận được với giấy A4 nhưng tem rời thì
 * tem trắng là tem hỏng. `display: none` cắt hẳn cả chiều cao, và portal ra
 * body là để `body > *:not(#id)` chạm được tới nhãn (nếu để trong cây React
 * thì nhãn nằm sâu trong `#root`, không phải con trực tiếp của body).
 *
 * `@page size` chỉ tồn tại trong lúc nhãn được mount → không đụng tới các
 * lệnh in khác của ứng dụng.
 */
const PRINT_CSS = `
@media print {
  @page { size: 40mm 60mm; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#${LABEL_ID}) { display: none !important; }
  #${LABEL_ID} { display: block !important; }
  /* Mỗi tem chiếm đúng 1 trang. Tem cao đúng 60mm = chiều cao trang nên về lý
     thuyết tự sang trang, nhưng chỉ cần lệch 1 pixel do làm tròn là cả lô bị
     trôi dần và tem thứ N in đè 2 trang — ngắt trang tường minh cho chắc.
     Tem CUỐI cố ý không ngắt: ngắt sau tem cuối là máy đẩy thêm 1 tem trắng,
     tức 1 con tem hỏng. */
  .${PAGE_CLASS} { break-after: page; page-break-after: always; }
  .${PAGE_CLASS}:last-child { break-after: auto; page-break-after: auto; }
}
`;

/**
 * Các vị trí in đơn THỰC SỰ có file design, theo đúng thứ tự của cột thumb ở
 * bảng đơn (`DESIGN_KEY_ORDER`). Key lạ (BE thêm vị trí mới chưa kịp khai báo)
 * vẫn được liệt kê ở cuối bằng chính tên key — mất nhãn tiếng Việt còn hơn tem
 * giấu mất một vị trí phải in.
 */
function printPositions(order: WorkshopOrderRow, labels: Record<string, string>): string[] {
  const designs = (order.designs ?? {}) as Record<string, string | undefined>;
  const filled = Object.keys(designs).filter((k) => designs[k]?.trim());
  const known = DESIGN_KEY_ORDER.filter((k) => filled.includes(k)) as string[];
  const unknown = filled.filter((k) => !known.includes(k));
  return [...known, ...unknown].map((k) => labels[k] || k);
}

interface Props {
  /**
   * Đơn cần in — 1 phần tử (menu "..." từng dòng) hoặc N phần tử (nút "In nhãn
   * khách" ở thanh bulk). Thứ tự trong mảng CHÍNH LÀ thứ tự tem chui ra khỏi
   * máy in, nên caller phải truyền đúng thứ tự người dùng đang thấy trên bảng.
   */
  orders: WorkshopOrderRow[];
  /** Gọi khi hộp thoại in đã đóng (in xong hoặc hủy) — caller unmount nhãn. */
  onDone: () => void;
}

/**
 * Mount → in ngay → báo caller gỡ xuống. Không có bước xem trước: người dùng
 * bấm "In nhãn khách" là muốn cầm được cái tem, hộp thoại in của trình duyệt
 * đã là bước xác nhận rồi.
 */
export function CustomerLabelPrint({ orders, onDone }: Props) {
  const { t } = useTranslation('orders');
  const labels = useMemo(() => buildDesignLabels(t), [t]);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone();
    };
    // Không có đơn nào thì không mở hộp thoại in — vẫn báo caller gỡ xuống để
    // nút bấm không kẹt ở trạng thái "đang in".
    if (orders.length === 0) {
      finish();
      return;
    }
    window.addEventListener('afterprint', finish);
    // Đợi qua 2 khung hình để QR (SVG) và web font kịp lên màn trước khi chụp
    // nội dung in — in ngay trong cùng khung hình dễ ra tem trống QR.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print();
        // Chrome/Safari chặn luồng cho tới khi đóng hộp thoại nên tới đây là
        // xong; Firefox thì không, nên vẫn phải chờ `afterprint` — hẹn giờ chỉ
        // là lưới an toàn cho trình duyệt không bắn sự kiện đó.
        window.setTimeout(finish, 1000);
      }),
    );
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone, orders.length]);

  return createPortal(
    <>
      <style>{PRINT_CSS}</style>
      <div id={LABEL_ID} className="hidden">
        {orders.map((o) => (
          <Label key={o._id} order={o} labels={labels} t={t} />
        ))}
      </div>
    </>,
    document.body,
  );
}

/** Thân 1 con tem. Tách riêng để lô N tem tái dùng đúng layout đã đo ở §16.6. */
function Label({
  order,
  labels,
  t,
}: {
  order: WorkshopOrderRow;
  labels: Record<string, string>;
  t: TFunction<'orders'>;
}) {
  const trackUrl = `${window.location.origin}${PATHS.TRACK}/${order.productionId}`;
  const productName = order.productConfig?.fullName || order.type;
  const variant = [order.size, order.color].filter(Boolean).join(' · ');
  const positions = printPositions(order, labels);

  const orderId = order.orderId?.trim() || undefined;
  const externalId = order.externalId?.trim() || undefined;
  // Nhiều nguồn đơn nhét CÙNG một mã vào cả hai cột (sheet nội bộ điền
  // `orderId` = chính mã sàn). In hai dòng y hệt nhau chỉ tốn 3.09mm lòng tem
  // để nói đúng một thứ — giữ lại dòng "Mã sàn" vì đó là mã người mua cuối tra
  // được ở sàn. So sánh trim + không phân biệt hoa thường; CỐ Ý không gọt tiền
  // tố kiểu '#': hai mã khác nhau thật mà bị coi là một thì tem mất mã, tệ hơn
  // nhiều so với in thừa một dòng.
  const sameCode = !!orderId && !!externalId && orderId.toLowerCase() === externalId.toLowerCase();
  const trackingNumber = order.tracking?.number?.trim() || undefined;
  const trackingCaption = order.tracking?.carrier?.trim() || t('customerLabel.trackingCaption');

  /**
   * Khối vận đơn cao 5.51mm (nhãn 5pt + số 7.5pt), gấp đôi dòng mã thường —
   * ngân sách 56mm ở `Orders.md §16.6` không có sẵn chỗ đó, phải lấy từ chỗ
   * khác. Lấy ở **dòng thứ hai của "Biến thể" và "Vị trí in"**: trên tem dán
   * kiện gửi khách thì đó là hai thứ ít quan trọng nhất, và `line-clamp` để
   * lại dấu "…" báo là đã cắt — khác hẳn kiểu `overflow-hidden` cắt cụt lặng
   * lẽ mà cả layout này đang phòng. Tem KHÔNG có vận đơn giữ nguyên 2 dòng.
   */
  const tight = !!trackingNumber;
  const clamp = tight ? 'line-clamp-1' : 'line-clamp-2';

  return (
    <div
      className={`${PAGE_CLASS} flex flex-col items-center bg-white text-black overflow-hidden`}
      style={{ width: '40mm', height: '60mm', padding: '2mm' }}
    >
      {/* 72px = 19.05mm. Cỡ này KHÔNG chọn cho đẹp mà là biến điều chỉnh của
          ngân sách chiều cao 56mm lòng tem ở ca xấu nhất (tên sản phẩm + biến
          thể + vị trí in đều tràn 2 dòng) — xem bảng đo ở `Orders.md §16.6`.
          Thêm dòng mới / phóng to chữ thì phải trừ lại ở đây. QR ~48 ký tự /
          ECC M ra 33 module, tức 0.58mm/module — vẫn trên ngưỡng ~0.5mm mà
          camera điện thoại đọc được, nhưng đã hết chỗ để nhỏ thêm. */}
      <QRCodeSVG value={trackUrl} size={72} level="M" marginSize={0} />
      <div style={{ fontSize: '5pt', marginTop: '0.6mm' }} className="text-center leading-tight">
        {t('customerLabel.scanHint')}
      </div>

      <div style={{ height: '0.4mm' }} className="w-full my-[0.9mm] bg-black" />

      <div
        style={{ fontSize: '11pt' }}
        className="w-full text-center font-mono font-bold leading-none tracking-tight"
      >
        {order.productionId}
      </div>
      {/* Hai mã phụ, cùng thứ tự với cột Production ID ở danh sách đơn: mã
          đơn trước, mã sàn dưới. Mỗi mã tự biến mất khi đơn không có —
          `externalId` rỗng ở phần lớn đơn nội bộ, `orderId` rỗng ở đơn khách
          tự lên qua Customer Portal, nên tem nào cũng còn ít nhất `productionId`.
          Hai mã trùng nhau thì chỉ in "Mã sàn" (xem `sameCode` ở trên).
          `break-all` chứ KHÔNG `truncate`: mã bị cắt cụt trên tem là mã sai,
          thà xuống dòng. */}
      {!sameCode && <CodeLine caption={t('customerLabel.orderIdCaption')} value={orderId} />}
      <CodeLine caption={t('customerLabel.externalIdCaption')} value={externalId} />
      {trackingNumber && <TrackingBlock caption={trackingCaption} value={trackingNumber} />}

      {productName && (
        <div style={{ fontSize: '8pt' }} className="w-full text-center leading-tight line-clamp-2 mt-[0.8mm]">
          {productName}
        </div>
      )}
      {variant && (
        <div
          style={{ fontSize: '8pt' }}
          className={`w-full text-center font-semibold leading-tight ${clamp}`}
        >
          {variant}
        </div>
      )}
      {positions.length > 0 && (
        <div
          style={{ fontSize: '7pt' }}
          className={`w-full text-center leading-tight ${clamp} mt-[0.5mm]`}
        >
          <span className="uppercase opacity-70">{t('customerLabel.positionsCaption')} </span>
          {positions.join(' · ')}
        </div>
      )}
    </div>
  );
}

/**
 * 1 dòng "nhãn — mã" trên tem; không có giá trị thì bỏ hẳn dòng.
 *
 * 6pt — cố ý NHỎ hơn khối vận đơn bên dưới. Mã đơn/mã sàn là mã tra cứu nội
 * bộ giữa mình với người bán; thứ người cầm kiện hàng cần đọc nhanh là mã vận
 * đơn. Hạ 7→6pt cũng chính là chỗ trả lại một phần chiều cao cho khối đó.
 */
function CodeLine({ caption, value, sizePt = 6 }: { caption: string; value?: string; sizePt?: number }) {
  if (!value) return null;
  return (
    <div style={{ fontSize: `${sizePt}pt` }} className="w-full text-center leading-tight break-all">
      <span className="uppercase opacity-70">{caption} </span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

/**
 * Khối vận đơn khách tự cấp (ORD-26) — phần người cầm kiện hàng đọc nhiều
 * nhất sau QR, nên tách hẳn thành 2 dòng thay vì nhét chung một dòng như hai
 * mã phụ: nhãn nhỏ ở trên, dãy số to đậm ở dưới.
 *
 * Nhãn là **tên hãng** khi có ("USPS") — vừa tự giải thích dãy số, vừa ngắn
 * hơn chữ "Vận đơn"; không có hãng mới rơi về nhãn chung.
 *
 * **7.5pt là TRẦN VẬT LÝ, không phải lựa chọn thẩm mỹ.** Mã USPS 22 chữ số ở
 * font mono (~0.6em/ký tự) chiếm 22 × 0.6 × 7.5pt = 34.9mm, `tracking-tighter`
 * kéo về ~32mm — vẫn trong 36mm lòng tem. To hơn nữa là xuống dòng, mà xuống
 * dòng thì ăn thêm 3.3mm không có trong ngân sách. Muốn số to hơn thì phải bỏ
 * bớt dòng khác trước, chứ không nới cỡ chữ ở đây được.
 */
function TrackingBlock({ caption, value }: { caption: string; value: string }) {
  return (
    <div className="w-full text-center mt-[0.5mm]">
      <div style={{ fontSize: '5pt' }} className="uppercase leading-none opacity-70">
        {caption}
      </div>
      {/* `break-all` chứ KHÔNG `truncate`: mã vận đơn cắt cụt là mã sai. */}
      <div
        style={{ fontSize: '7.5pt' }}
        className="w-full font-mono font-bold leading-tight tracking-tighter break-all"
      >
        {value}
      </div>
    </div>
  );
}
