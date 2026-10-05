import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';

import { usePermission } from '@/hooks/usePermission';

import DesignerStatsTab from './DesignerStatsTab';
import GettingStartedCard from './GettingStartedCard';
import LifecycleStrip from './LifecycleStrip';
import LifecycleTab from './LifecycleTab';
import OrderFactoryTab from './OrderFactoryTab';
import OrderStatsTab from './OrderStatsTab';
// Tab "status" (Tình trạng đơn hàng) + "person-error" (Lỗi theo người) TẠM ẨN
// (2026-07, không cần nữa) — muốn bật lại: bỏ comment 2 import dưới + thêm lại
// 'status'/'person-error' vào TABS + bỏ comment khối canSeePersonError /
// isTabAllowed / render điều kiện đánh dấu cùng ghi chú này + thêm lại entry
// sidebar tương ứng (Sidebar.tsx đang comment `dash-status`/`dash-person-error`).
// import OrderStatusTab from './OrderStatusTab';
// import PersonErrorTab from './PersonErrorTab';
import { SendTelegramReportButton } from './SendTelegramReportButton';
import ToolCheckTab from './ToolCheckTab';

// KHÔNG còn thanh tab tại chỗ — chuyển tab CHỈ qua submenu sidebar (Link
// `?tab=<key>`, thay cả query string nên param của tab cũ tự biến mất).
const TABS = ['factory', 'stats', 'lifecycle', 'tool-check', 'designer'] as const;
type TabKey = (typeof TABS)[number];

export default function Home() {
  const { t } = useTranslation('dashboard');
  const [searchParams, setSearchParams] = useSearchParams();
  const { has, isAdmin } = usePermission();
  const canSeeDesigner = has('page.designer_stats');
  // Tab "Vòng đời đơn" chi tiết — mở cho mọi tài khoản (Fulfillment tự khóa xưởng ở BE).
  const canSeeLifecycle = true;
  // Tab "Soát tool" chỉ Support + Admin.
  const canSeeToolCheck = isAdmin || has('page.tool_check');
  // Tab "Lỗi theo người" TẠM ẨN — xem ghi chú ở khối import.
  // const canSeePersonError = isAdmin || has('page.designer_stats') || has('page.tool_check');
  const isTabAllowed = (t: TabKey) =>
    t === 'lifecycle'
      ? canSeeLifecycle
      : t === 'tool-check'
        ? canSeeToolCheck
        : t === 'designer'
          ? canSeeDesigner
          : true;
  const initial = (searchParams.get('tab') as TabKey) || 'factory';
  const [activeTab, setActiveTab] = useState<TabKey>(
    TABS.includes(initial) && isTabAllowed(initial) ? initial : 'stats',
  );

  useEffect(() => {
    const fromUrl = searchParams.get('tab') as TabKey;
    if (fromUrl && TABS.includes(fromUrl) && isTabAllowed(fromUrl) && fromUrl !== activeTab) {
      setActiveTab(fromUrl);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // `/dashboard` trần → gắn `?tab=<activeTab>` để submenu sidebar highlight đúng.
  useEffect(() => {
    if (!searchParams.get('tab')) {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set('tab', activeTab);
          return sp;
        },
        { replace: true },
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BarChart3 size={20} />}
        title={t('page.title')}
        description={t('page.subtitle')}
        actions={isAdmin ? <SendTelegramReportButton /> : undefined}
      />

      {/* Guides live here instead of the sidebar (MenuRestructure-CEO.md §9.1). */}
      <GettingStartedCard />

      {/* Strip vòng đời đơn — gọn, hiện trên đầu mọi tab, cho mọi tài khoản */}
      <LifecycleStrip />

      {activeTab === 'stats' && <OrderStatsTab />}
      {/* Tab "status" TẠM ẨN — xem ghi chú ở khối import.
      {activeTab === 'status' && <OrderStatusTab />} */}
      {activeTab === 'factory' && <OrderFactoryTab />}
      {canSeeLifecycle && activeTab === 'lifecycle' && <LifecycleTab />}
      {canSeeToolCheck && activeTab === 'tool-check' && <ToolCheckTab />}
      {/* Tab "person-error" TẠM ẨN — xem ghi chú ở khối import.
      {canSeePersonError && activeTab === 'person-error' && <PersonErrorTab />} */}
      {canSeeDesigner && activeTab === 'designer' && <DesignerStatsTab />}
    </div>
  );
}
