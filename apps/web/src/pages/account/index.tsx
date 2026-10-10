import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, KeyRound, User } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthStore } from '@/store/authStore';

import { RepositoryRemote } from '@/services';

import { PageHeader } from '@/components/common/PageHeader';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { handleAxiosError } from '@/utils';

type PwField = 'oldPassword' | 'newPassword' | 'newConfirmPassword';

interface PwForm {
  oldPassword: string;
  newPassword: string;
  newConfirmPassword: string;
}

const EMPTY_PW_FORM: PwForm = {
  oldPassword: '',
  newPassword: '',
  newConfirmPassword: '',
};

export default function Account() {
  const { t } = useTranslation(['auth', 'common']);
  const { profile } = useAuthStore();

  const [pwForm, setPwForm] = useState<PwForm>(EMPTY_PW_FORM);
  const [show, setShow] = useState<Record<PwField, boolean>>({
    oldPassword: false,
    newPassword: false,
    newConfirmPassword: false,
  });
  const [saving, setSaving] = useState(false);

  const toggleShow = (k: PwField) => setShow((prev) => ({ ...prev, [k]: !prev[k] }));

  const handleChangePassword = async () => {
    const { oldPassword, newPassword, newConfirmPassword } = pwForm;
    if (!oldPassword || !newPassword || !newConfirmPassword) {
      toast.error(t('account.errors.fillAllFields', { ns: 'auth' }));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t('account.errors.passwordTooShort', { ns: 'auth' }));
      return;
    }
    if (newPassword !== newConfirmPassword) {
      toast.error(t('account.errors.passwordMismatch', { ns: 'auth' }));
      return;
    }
    if (oldPassword === newPassword) {
      toast.error(t('account.errors.samePassword', { ns: 'auth' }));
      return;
    }
    try {
      setSaving(true);
      await RepositoryRemote.users.changePassword({
        oldPassword,
        newPassword,
        newConfirmPassword,
      });
      toast.success(t('account.changeSuccess', { ns: 'auth' }));
      setPwForm(EMPTY_PW_FORM);
      setShow({ oldPassword: false, newPassword: false, newConfirmPassword: false });
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

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

        <div className="space-y-3 max-w-md">
          <PasswordInput
            label={t('account.currentPassword', { ns: 'auth' })}
            value={pwForm.oldPassword}
            onChange={(v) => setPwForm({ ...pwForm, oldPassword: v })}
            show={show.oldPassword}
            onToggle={() => toggleShow('oldPassword')}
            autoComplete="current-password"
            showLabel={t('account.showPassword', { ns: 'auth' })}
            hideLabel={t('account.hidePassword', { ns: 'auth' })}
          />
          <PasswordInput
            label={t('account.newPassword', { ns: 'auth' })}
            value={pwForm.newPassword}
            onChange={(v) => setPwForm({ ...pwForm, newPassword: v })}
            show={show.newPassword}
            onToggle={() => toggleShow('newPassword')}
            placeholder={t('account.newPasswordPlaceholder', { ns: 'auth' })}
            autoComplete="new-password"
            showLabel={t('account.showPassword', { ns: 'auth' })}
            hideLabel={t('account.hidePassword', { ns: 'auth' })}
          />
          <PasswordInput
            label={t('account.confirmNewPassword', { ns: 'auth' })}
            value={pwForm.newConfirmPassword}
            onChange={(v) => setPwForm({ ...pwForm, newConfirmPassword: v })}
            show={show.newConfirmPassword}
            onToggle={() => toggleShow('newConfirmPassword')}
            placeholder={t('account.confirmNewPasswordPlaceholder', { ns: 'auth' })}
            autoComplete="new-password"
            showLabel={t('account.showPassword', { ns: 'auth' })}
            hideLabel={t('account.hidePassword', { ns: 'auth' })}
          />

          <div className="pt-2 flex items-center gap-3">
            <Button onClick={handleChangePassword} disabled={saving}>
              {saving && <Spinner size={14} className="mr-2" />}
              {t('account.changePassword', { ns: 'auth' })}
            </Button>
            {(pwForm.oldPassword || pwForm.newPassword || pwForm.newConfirmPassword) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setPwForm(EMPTY_PW_FORM);
                  setShow({ oldPassword: false, newPassword: false, newConfirmPassword: false });
                }}
                disabled={saving}
              >
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
  autoComplete?: string;
  showLabel: string;
  hideLabel: string;
}

function PasswordInput({
  label,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  autoComplete,
  showLabel,
  hideLabel,
}: PasswordInputProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="pr-9"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggle}
          aria-label={show ? hideLabel : showLabel}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
