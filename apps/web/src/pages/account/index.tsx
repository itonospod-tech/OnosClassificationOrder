import React from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, User } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';

import { ChangePasswordForm } from '@/components/account/ChangePasswordForm';
import { PageHeader } from '@/components/common/PageHeader';

export default function Account() {
  const { t } = useTranslation(['auth', 'common']);
  const { profile } = useAuthStore();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<User size={20} />}
        title={t('account.title', { ns: 'auth' })}
        description={t('account.subtitle', { ns: 'auth' })}
      />

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700/60">
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              {t('account.fullName', { ns: 'auth' })}
            </p>
            <p className="text-base text-slate-800 dark:text-slate-100 mt-1">{profile?.fullName || '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              {t('account.email', { ns: 'auth' })}
            </p>
            <p className="text-base text-slate-800 dark:text-slate-100 mt-1">{profile?.email || '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              {t('account.role', { ns: 'auth' })}
            </p>
            <p className="text-base text-slate-800 dark:text-slate-100 mt-1">{profile?.role?.name || '—'}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-100 dark:border-slate-700/60">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound size={18} className="text-indigo-600" />
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {t('account.changePassword', { ns: 'auth' })}
          </h2>
        </div>

        <ChangePasswordForm className="max-w-md" />
      </div>
    </div>
  );
}
