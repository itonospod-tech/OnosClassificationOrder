import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

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

const HIDDEN: Record<PwField, boolean> = {
  oldPassword: false,
  newPassword: false,
  newConfirmPassword: false,
};

interface ChangePasswordFormProps {
  /** Chạy sau khi BE đổi mật khẩu thành công (form đã được xoá trắng). */
  onSuccess?: () => void | Promise<void>;
  /** Nút submit kéo hết chiều ngang + ẩn nút Hủy — dùng ở trang bắt buộc đổi mật khẩu. */
  fullWidthSubmit?: boolean;
  className?: string;
}

/**
 * Form đổi mật khẩu dùng chung cho trang Tài khoản (`/adm/account`) và trang
 * bắt buộc đổi mật khẩu (`/change-password`, Auth.md §6.1). CHỈ gọi
 * `POST /users/change-password` — endpoint nằm trong `PathAccess` nên chạy được
 * cả khi tài khoản đang bị `forcePassChange`.
 */
export function ChangePasswordForm({ onSuccess, fullWidthSubmit, className }: ChangePasswordFormProps) {
  const { t } = useTranslation(['auth', 'common']);

  const [pwForm, setPwForm] = useState<PwForm>(EMPTY_PW_FORM);
  const [show, setShow] = useState<Record<PwField, boolean>>(HIDDEN);
  const [saving, setSaving] = useState(false);

  const toggleShow = (k: PwField) => setShow((prev) => ({ ...prev, [k]: !prev[k] }));
  const reset = () => {
    setPwForm(EMPTY_PW_FORM);
    setShow(HIDDEN);
  };

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
      reset();
      await onSuccess?.();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  const dirty = !!(pwForm.oldPassword || pwForm.newPassword || pwForm.newConfirmPassword);

  return (
    <form
      className={cn('space-y-3', className)}
      onSubmit={(e) => {
        e.preventDefault();
        void handleChangePassword();
      }}
    >
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
        <Button type="submit" disabled={saving} className={cn(fullWidthSubmit && 'w-full h-10')}>
          {saving && <Spinner size={14} className="mr-2" />}
          {t('account.changePassword', { ns: 'auth' })}
        </Button>
        {!fullWidthSubmit && dirty && (
          <Button type="button" variant="ghost" onClick={reset} disabled={saving}>
            {t('actions.cancel', { ns: 'common' })}
          </Button>
        )}
      </div>
    </form>
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
