import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Thời gian tối đa (ms) tiếp tục căn lại khi bố cục phía trên còn đổi (font, ảnh tải xong). */
const SETTLE_MS = 2000;
/** Sau sự kiện `load` căn thêm chừng này (ms) — ảnh/font vừa xong có thể đổi chiều cao phía trên. */
const LOAD_GRACE_MS = 600;
/** Trần tuyệt đối của cả quá trình căn (ms). */
const MAX_SETTLE_MS = 10000;
/** Lệch dưới ngưỡng này (px) coi như đã đúng chỗ. */
const TOLERANCE_PX = 2;
const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Cuộn tới phần tử `#id` trong URL sau khi trang đã render — dùng ở trang có neo được link từ trang khác
 * (trang chủ: `/#how` ở header/footer các trang public).
 *
 * Vì sao cần: link `/#how` từ trang khác tải lại cả SPA; trình duyệt tìm `#how` lúc HTML vừa tải, khi React
 * chưa vẽ section nào → không cuộn (TEST-02 B4). Hook đọc `location.hash` rồi `scrollTo` theo vị trí phần tử
 * trừ `scroll-margin-top` (tức `scroll-mt-*` của section), và CĂN LẠI trong `SETTLE_MS` nếu phần phía trên
 * còn đổi cao (font tiêu đề, ảnh). Dừng ngay khi người dùng tự cuộn/chạm/bấm phím để không giành cuộn.
 *
 * - Không có hash → không làm gì (trang không nhảy).
 * - Bấm `#how` ngay trên trang: trình duyệt đã tự nhảy, hook thấy đã đúng chỗ nên không cuộn thêm.
 * - Back/Forward về URL có hash → cuộn lại tới mục đó (mỗi mục lịch sử có `key` riêng).
 */
export function useHashScroll() {
  const { hash, key } = useLocation();

  useEffect(() => {
    if (hash.length < 2) return undefined;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return undefined;
    }

    let frame = 0;
    let stopped = false;
    let lastTarget: number | null = null;
    const startedAt = performance.now();
    let deadline = startedAt + SETTLE_MS;
    // Trang còn đang tải (ảnh/font) → căn tiếp tới sau `load` một chút, tối đa `MAX_SETTLE_MS`.
    const onLoad = () => {
      deadline = Math.max(deadline, performance.now() + LOAD_GRACE_MS);
    };

    const stop = () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('load', onLoad);
      USER_EVENTS.forEach((type) => window.removeEventListener(type, stop));
    };

    const align = () => {
      const el = document.getElementById(id);
      if (!el) return;
      // Người dùng đã tự cuộn khỏi chỗ đã căn → thôi.
      if (lastTarget !== null && Math.abs(window.scrollY - lastTarget) > TOLERANCE_PX) {
        stop();
        return;
      }
      const margin = parseFloat(window.getComputedStyle(el).scrollMarginTop) || 0;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const target = Math.round(
        Math.min(Math.max(el.getBoundingClientRect().top + window.scrollY - margin, 0), Math.max(maxScroll, 0)),
      );
      if (Math.abs(window.scrollY - target) > TOLERANCE_PX) window.scrollTo({ top: target, behavior: 'auto' });
      lastTarget = Math.round(window.scrollY);
    };

    const tick = () => {
      if (stopped) return;
      align();
      const now = performance.now();
      if (now < deadline && now - startedAt < MAX_SETTLE_MS) frame = window.requestAnimationFrame(tick);
      else stop();
    };

    if (document.readyState !== 'complete') window.addEventListener('load', onLoad);
    USER_EVENTS.forEach((type) => window.addEventListener(type, stop, { passive: true }));
    frame = window.requestAnimationFrame(tick);
    return stop;
  }, [hash, key]);
}
