import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';

import { RepositoryRemote } from '@/services';

import { ChangePasswordForm } from '@/components/account/ChangePasswordForm';
import { Button } from '@/components/ui/button';

import { homePathForRole } from '@/utils/homePath';

import logoUrl from '@/assets/images/logo.png';

/**
 * Trang BẮT BUỘC đổi mật khẩu (`/change-password`, Auth.md §6.1) cho tài khoản
 * `forcePassChange=true` (admin vừa reset mật khẩu).
 *
 * Cố ý nằm NGOÀI `MainLayout`: Sidebar (`/designer/sidebar-counts`) và
 * OverdueAlertBanner (`/designer/overdue-alert`) tự gọi API ngay khi mount, mà
 * BE trả 405 cho mọi route ngoài `PathAccess` → interceptor chuyển trang → mount
 * lại → 405… thành vòng tải lại vô tận (màn hình trắng, 31/10/2026). Trang này
 * chỉ gọi `POST /users/change-password` + `GET /auth/me`, cả hai đều được phép.
 */
export default function ChangePassword() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const clearToken = useAuthStore((s) => s.clearToken);

  // Profile trong storage có thể cũ (cờ đã hạ ở BE, hoặc ngược lại) → hỏi lại BE
  // một lần; không còn bị bắt đổi thì trả về trang làm việc. `/auth/me` không bị 405.
  useEffect(() => {
    let cancelled = false;
    RepositoryRemote.auth
      .getMe()
      .then((res) => {
        const me = res?.data?.data;
        if (cancelled || !me) return;
        setProfile(me);
        if (!me.forcePassChange) navigate(homePathForRole(me.role?.name), { replace: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [navigate, setProfile]);

  const handleSuccess = async () => {
    // Lấy lại profile để `forcePassChange` về false — nếu không, MainLayout sẽ
    // đẩy ngược về đây. Lỗi mạng thì tự hạ cờ ở client: BE đã đổi xong.
    try {
      const res = await RepositoryRemote.auth.getMe();
      if (res?.data?.data) setProfile(res.data.data);
      else if (profile) setProfile({ ...profile, forcePassChange: false });
    } catch {
      if (profile) setProfile({ ...profile, forcePassChange: false });
    }
    navigate(homePathForRole(useAuthStore.getState().profile?.role?.name), { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[440px]">
        <div className="text-center mb-8">
          <img src={logoUrl} alt="Logo" className="h-10 w-auto object-contain mx-auto mb-5" />
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary text-primary-foreground mb-4">
            <KeyRound size={20} strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('forceChangePassword.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">{t('forceChangePassword.subtitle')}</p>
          {profile?.email && (
            <p className="text-sm text-muted-foreground mt-3">
              {t('forceChangePassword.signedInAs')}{' '}
              <span className="font-medium text-foreground break-all">{profile.email}</span>
            </p>
          )}
        </div>

        <div className="bg-card rounded-2xl border border-border p-7 shadow-sm">
          <ChangePasswordForm fullWidthSubmit onSuccess={handleSuccess} />
        </div>

        <div className="text-center mt-6">
          <Button variant="ghost" size="sm" onClick={clearToken}>
            <LogOut size={14} className="mr-1.5" />
            {t('forceChangePassword.logout')}
          </Button>
        </div>
      </div>
    </div>
  );
}
