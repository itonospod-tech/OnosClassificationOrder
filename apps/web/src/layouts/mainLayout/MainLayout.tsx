import React, { useEffect, useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

import { useAuthStore } from '@/store/authStore';

import { RepositoryRemote } from '@/services';

import { ImpersonationBanner } from '@/components/auth/ImpersonationBanner';

import { cn } from '@/utils/cn';

import { useIsMobile } from '@/hooks/useMediaQuery';

import Header from '../../components/header';
import { MobileTabBar, TAB_BAR_ROLES } from '../../components/sidebar/MobileTabBar';
import Sidebar from '../../components/sidebar/Sidebar';

function MainLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const isMobile = useIsMobile();
  const setProfile = useAuthStore((s) => s.setProfile);
  const roleName = useAuthStore((s) => s.profile?.role?.name);
  const showTabBar = isMobile && !!roleName && TAB_BAR_ROLES.includes(roleName);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Refresh profile on mount so persisted localStorage (from previous sessions
  // with an older payload shape) gets replaced with the latest one — including
  // role.permissionCodes which sidebar needs to filter menu items.
  useEffect(() => {
    let cancelled = false;
    RepositoryRemote.auth
      .getMe()
      .then((res) => {
        if (!cancelled && res?.data?.data) setProfile(res.data.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setProfile]);

  return (
    // Khung CỐ ĐỊNH (07/09/2026): root cao đúng màn hình và không cuộn — sidebar +
    // header đứng yên, CHỈ <main> cuộn. Trước đây `min-h-screen` để sidebar dài hơn
    // màn hình (nhiều cụm menu theo xưởng) kéo cả trang cuộn, header trôi mất.
    // `100dvh`, not `100vh`: on iOS Safari 100vh is taller than the visible area (toolbars), which
    // pushed the bottom of every page — and the tab bar — under the browser chrome.
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <div
        className={cn(
          'flex h-[100dvh] min-w-0 flex-1 flex-col overflow-hidden',
          // The fixed tab bar (3.5rem + home-indicator inset) sits OVER the bottom of this column.
          // Ending the scroll area above it — instead of padding the page bottom — keeps every
          // `sticky bottom-*` bar (bulk-action bars) above the tab bar rather than hidden under it.
          showTabBar && 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
        )}
      >
        {/* Dải cảnh báo mạo danh — trên CÙNG cột nội dung, ĐẨY header xuống chứ
            không phủ đè, để không thể cuộn trôi qua (AUTH-1 BR-7/AC-04). */}
        <ImpersonationBanner source="staff" />
        <Header
          changeCollapsed={() => (isMobile ? setMobileOpen(true) : setCollapsed(!collapsed))}
          collapsed={collapsed}
          isMobile={isMobile}
        />
        {/* The overdue alert (once a red strip here) is now a chip in the Header — see OverdueAlertBanner.md.
            It was removed by mistake on 07/09/2026 and put back on 10/09/2026: it must stay mounted somewhere
            on every page, it only changed shape. */}
        {/* `flex flex-col`: trang nào muốn CHIẾM ĐỦ chiều cao (bảng tự cuộn, chân bảng đứng yên) chỉ cần
            `flex-1 min-h-0` trên root của nó; trang thường vẫn cao theo nội dung và <main> cuộn như cũ. */}
        <main className="app-page flex flex-1 flex-col overflow-auto bg-page p-4 md:p-6">
          {/*
            KHÔNG dùng `exit` animation (trước đây có, đã bỏ) — với
            `AnimatePresence`, khai báo `exit` khiến trang CŨ tiếp tục ở lại
            React tree (chạy animation thoát) một nhịp SAU KHI route đã đổi.
            Trong lúc đó, trang cũ vẫn re-render theo `location` MỚI (global)
            — nếu nó có `useEffect` đồng bộ state cục bộ → URL qua
            `setSearchParams` (rất phổ biến ở các trang danh sách đơn, vd
            `wfrom`/`wto` mặc định "hôm nay" ở Workshop), effect đó chạy lại
            và `replaceState` đè query param của trang CŨ lên URL trang MỚI
            (vd bấm "Đơn hàng" từ Workshop → URL Classic dính `wfrom`/`wto`).
            Bỏ hẳn `exit` → trang cũ unmount NGAY trong cùng lần cập nhật route,
            không còn cửa sổ để side-effect này xảy ra. Chỉ còn animation vào
            (`initial`/`animate`) cho trang mới, không animation ra cho trang cũ.
          */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      {showTabBar && <MobileTabBar roleName={roleName} onMore={() => setMobileOpen(true)} />}
    </div>
  );
}

export default MainLayout;
