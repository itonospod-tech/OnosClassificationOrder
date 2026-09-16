/**
 * Cuộn trong trang hướng dẫn DTF. KHÔNG dùng `scrollIntoView({ block: 'start' })`: khung app cố định (`MainLayout` —
 * root `h-screen overflow-hidden`, chỉ `<main>` cuộn). Khi `<main>` đã cuộn hết mà phần tử vẫn chưa lên được mép trên
 * (vd bước cuối của vai), trình duyệt cuộn luôn cả khung `overflow-hidden` bên ngoài → header trôi mất, đáy trang trắng.
 * Ở đây tự tính vị trí rồi cuộn đúng khung cuộn gần nhất.
 */

const smoothOrAuto = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** Khoảng chừa thêm dưới thanh chọn vai khi nhảy tới một phần. */
const GAP_BELOW_PICKER_PX = 12;

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/** Chiều cao thanh chọn vai dính (`[data-dtf-picker]`) + khoảng chừa — phần tử nhảy tới không bị thanh che. */
export function pickerOffset(): number {
  const picker = document.querySelector<HTMLElement>('[data-dtf-picker]');
  return (picker?.getBoundingClientRect().height ?? 0) + GAP_BELOW_PICKER_PX;
}

/** Đưa mép trên `el` về cách mép trên khung cuộn `offsetPx`. */
export function scrollToElement(el: HTMLElement | null, offsetPx = 0) {
  if (!el) return;
  const behavior = smoothOrAuto();
  const scroller = scrollParentOf(el);
  if (!scroller) {
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - offsetPx), behavior });
    return;
  }
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offsetPx;
  scroller.scrollTo({ top: Math.max(0, top), behavior });
}

/** Về đầu khung cuộn chứa `el`. */
export function scrollToTopOf(el: HTMLElement | null) {
  if (!el) return;
  const scroller = scrollParentOf(el);
  if (scroller) scroller.scrollTo({ top: 0, behavior: smoothOrAuto() });
  else window.scrollTo({ top: 0, behavior: smoothOrAuto() });
}
