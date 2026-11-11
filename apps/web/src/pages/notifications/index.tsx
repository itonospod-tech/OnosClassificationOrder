import React from 'react';
import { Bell } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';

export default function Notifications() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Bell size={20} />}
        title="Notifications"
        description="Your recent activity"
      />

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 border border-slate-100 dark:border-slate-700/60 text-center">
        <p className="text-slate-500 dark:text-slate-400">No notifications yet.</p>
      </div>
    </div>
  );
}
