/**
 * Cuộn cho chấm số `n` lọt vào tầm nhìn — cả trong khung ảnh cuộn ngang (điện
 * thoại) lẫn theo chiều dọc của trang/hộp phóng to. Tách file riêng khỏi
 * `AnnotatedShot.tsx` để file component chỉ export component (fast refresh).
 */
export function scrollMarkerIntoView(container: HTMLElement | null, n: number) {
  const marker = container?.querySelector<HTMLElement>(`[data-callout="${n}"]`);
  if (!marker) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  marker.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
}
