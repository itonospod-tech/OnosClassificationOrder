import React from 'react';

import BackToTop from '@/components/public/BackToTop';
import PublicFooter from '@/components/public/PublicFooter';
import PublicHeader from '@/components/public/PublicHeader';
import { useHashScroll } from '@/components/public/useHashScroll';

import Benefits from './sections/Benefits';
import Capabilities from './sections/Capabilities';
import FinalCta from './sections/FinalCta';
import Hero from './sections/Hero';
import HowItWorks from './sections/HowItWorks';
import LeadershipTeam from './sections/LeadershipTeam';
import ProblemSolution from './sections/ProblemSolution';
import Showcase from './sections/Showcase';
import Trust from './sections/Trust';

/**
 * Trang chủ public (`/`) — cửa vào chung cho nhân viên Onos và khách hàng.
 *
 * UX hướng tới KHÁCH HÀNG ĐẶT ĐƠN: CTA chính xuyên suốt là "Đặt đơn ngay"
 * (`CUSTOMER_REGISTER`), lối vào cho nhân viên chỉ là link phụ. Nội dung nói về
 * việc đặt và theo dõi đơn, không mô tả hệ thống sản xuất nội bộ.
 *
 * Nhận diện (tím #6f26c2, font tiêu đề Lexend Deca, CTA dạng viên thuốc, nét
 * gạch chân vẽ tay, band tối) kế thừa từ trang thương hiệu onosglobal.com.
 */
function Landing() {
  // Link `/#how`… từ header/footer của trang public khác tải lại SPA → trình duyệt không tự cuộn được (Landing.md §2.1).
  useHashScroll();

  return (
    <div className="flex min-h-screen flex-col bg-white text-[#0f110f] antialiased">
      <PublicHeader />

      <main className="flex-1">
        <Hero />
        <Capabilities />
        <ProblemSolution />
        <HowItWorks />
        <Showcase />
        <Benefits />
        <Trust />
        <LeadershipTeam />
        <FinalCta />
      </main>

      <PublicFooter />
      <BackToTop />
    </div>
  );
}

export default Landing;
