import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import type { PackingPackage } from 'shared';

const SHEET_ID = 'handover-sheet-print';

/**
 * Phiếu bàn giao A4 — tờ giấy tài xế ký nhận.
 *
 * Cùng khuôn in với các con tem (portal ra `document.body` + `display:none` mọi
 * anh chị em) nhưng khổ A4 dọc, vì đây là chứng từ hai bên giữ chứ không phải
 * nhãn dán. Một phiếu = một chuyến xe = một mã `BG-…`.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(#${SHEET_ID}) { display: none !important; }
  #${SHEET_ID} { display: block !important; }
}
`;

interface Props {
  handoverCode: string;
  carrier?: string;
  packages: PackingPackage[];
  onDone: () => void;
}

export function HandoverSheetPrint({ handoverCode, carrier, packages, onDone }: Props) {
  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone();
    };
    window.addEventListener('afterprint', finish);
    const raf = requestAnimationFrame(() => {
      window.print();
      window.setTimeout(finish, 1000);
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone]);

  // Tổng cân chỉ cộng kiện ĐÃ CÂN; số kiện thiếu cân in riêng bên cạnh thay vì
  // âm thầm cộng 0 — tài xế và kho phải thấy phiếu này chưa đủ số liệu.
  const daCan = packages.filter((p) => p.weightGram && p.weightGram > 0);
  const tongCan = daCan.reduce((n, p) => n + (p.weightGram ?? 0), 0);
  const thieuCan = packages.length - daCan.length;

  return createPortal(
    <>
      <style>{PRINT_CSS}</style>
      <div id={SHEET_ID} className="hidden bg-white text-black">
        <div className="flex items-baseline justify-between border-b-2 border-black pb-2">
          <div>
            <div className="text-xl font-bold">PHIẾU BÀN GIAO HÀNG</div>
            <div className="text-sm">OnosFactory</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-mono text-base font-bold">{handoverCode}</div>
            <div>{dayjs().format('DD/MM/YYYY HH:mm')}</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            Hãng nhận: <b>{carrier || '—'}</b>
          </div>
          <div>
            Số kiện: <b>{packages.length}</b>
          </div>
          <div>
            Tổng cân: <b>{(tongCan / 1000).toFixed(2)} kg</b>
            {thieuCan > 0 && <span> ({thieuCan} kiện chưa cân)</span>}
          </div>
        </div>

        <table className="mt-3 w-full border-collapse text-xs">
          <thead>
            <tr>
              {['#', 'Mã kiện', 'Mã đơn', 'Mã sản xuất', 'Cân (g)'].map((h) => (
                <th key={h} className="border border-black px-2 py-1 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {packages.map((p, i) => (
              <tr key={p._id}>
                <td className="border border-black px-2 py-1">{i + 1}</td>
                <td className="border border-black px-2 py-1 font-mono">{p.code}</td>
                <td className="border border-black px-2 py-1 font-mono">{p.orderId || '—'}</td>
                <td className="border border-black px-2 py-1 font-mono">{(p.productionIds || []).join(', ')}</td>
                <td className="border border-black px-2 py-1 text-right">{p.weightGram || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-8 flex justify-between text-sm">
          <div className="text-center">
            <div>Người giao</div>
            <div className="mt-12">(ký, ghi rõ họ tên)</div>
          </div>
          <div className="text-center">
            <div>Người nhận</div>
            <div className="mt-12">(ký, ghi rõ họ tên)</div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
