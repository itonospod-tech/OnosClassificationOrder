/**
 * Kiểu dữ liệu ảnh + chú thích của trang hướng dẫn lên đơn. Tách riêng để
 * `guideShots.generated.ts` (tự sinh) và `guideSteps.ts` cùng dùng mà không import vòng.
 */

export type GuideFlowId = 'form' | 'push' | 'import';

/** Khung bao phần tử theo % ảnh (đã cộng lề vài px ảnh quanh phần tử). */
export interface GuideBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideCallout {
  n: number;
  /** Tâm phần tử theo % ảnh — giữ cho tương thích; hiển thị dùng `boxPct`. */
  xPct: number;
  yPct: number;
  boxPct: GuideBox;
}

/**
 * Lưới "mực" của ảnh: 1 bit/ô `cell`×`cell` px ảnh, bật khi ô có chữ/ảnh/ô nhập đang hiện lúc chụp.
 * `data` = base64, bit-packed LSB trước, hàng trên xuống. Chỉ dùng để đặt huy hiệu vào chỗ trống.
 */
export interface GuideInkGrid {
  cell: number;
  cols: number;
  rows: number;
  data: string;
}

export interface GuideShot {
  file: string;
  width: number;
  height: number;
  callouts: GuideCallout[];
  ink: GuideInkGrid;
}

export interface GuideStep extends GuideShot {
  /** Khoá i18n: `flows.<flow>.steps.<id>`. */
  id: string;
  /** Có ô lưu ý (`flows.<flow>.steps.<id>.note`). */
  note?: boolean;
}

export interface GuideFlow {
  id: GuideFlowId;
  steps: GuideStep[];
}
