import React, { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

import logoUrl from '@/assets/images/logo.png';

import { PATHS } from '../../constants/paths';
import { RepositoryRemote } from '../../services';
import { useAuthStore } from '../../store/authStore';
import { AUTH_IDENTITY_KEY, getRememberedIdentity, setRememberedIdentity } from '../../store/sessionPersist';
import { handleAxiosError } from '../../utils';
import { homePathForRole } from '../../utils/homePath';

function buildLoginSchema(t: TFunction<'auth'>) {
  return z.object({
    email: z.string().min(1, t('login.validation.emailRequired')).email(t('login.validation.emailInvalid')),
    password: z.string().min(1, t('login.validation.passwordRequired')),
    rememberMe: z.boolean().default(false),
  });
}

type LoginFormValues = z.infer<ReturnType<typeof buildLoginSchema>>;

function Login() {
  const navigate = useNavigate();
  const { t } = useTranslation('auth');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { setProfile, setToken, setTokenExpiredAt } = useAuthStore();

  const loginSchema = useMemo(() => buildLoginSchema(t), [t]);
  // Lần trước tick "Ghi nhớ đăng nhập" → prefill email + tick sẵn checkbox
  // (chỉ email, không bao giờ lưu mật khẩu).
  const rememberedEmail = useMemo(() => getRememberedIdentity(AUTH_IDENTITY_KEY), []);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: rememberedEmail, password: '', rememberMe: !!rememberedEmail },
  });

  const onSubmit = async (values: LoginFormValues) => {
    try {
      setLoading(true);
      const resp = await RepositoryRemote.auth.login({ ...values, recaptchaToken: '' });
      const loginInfo = resp?.data;

      if (loginInfo) {
        // TTL thật từ BE (dài hơn nếu rememberMe) — không hardcode 24h nữa.
        const expirationTime = Date.now() + (loginInfo.expiresIn ?? 24 * 60 * 60) * 1000;
        setToken(loginInfo.accessToken, values.rememberMe);
        setTokenExpiredAt(expirationTime);
        setProfile(loginInfo.user);
        setRememberedIdentity(AUTH_IDENTITY_KEY, values.rememberMe ? values.email : null);

        // Pull fresh profile (with role.permissionCodes populated) — login
        // response itself doesn't always include permission data.
        let mustChangePassword = false;
        try {
          const meRes = await RepositoryRemote.auth.getMe();
          if (meRes?.data?.data) {
            setProfile(meRes.data.data);
            mustChangePassword = !!meRes.data.data.forcePassChange;
          }
        } catch {
          /* fall back to login payload */
        }

        // Admin vừa reset mật khẩu → vào thẳng trang đổi mật khẩu (Auth.md §6.1).
        // Sub-designer login → vào thẳng /my-tasks (Kanban Phase 4). Các role
        // khác dùng dashboard chung.
        const roleName = (loginInfo.user as { role?: { name?: string } })?.role?.name;
        navigate(mustChangePassword ? PATHS.CHANGE_PASSWORD : homePathForRole(roleName));
        toast.success(t('login.welcomeBack'));
      }
    } catch (error) {
      // Backend dùng chung 1 i18n key (error.userNotFound) cho mọi lý do đăng
      // nhập thất bại (sai email/mật khẩu, tài khoản bị khoá) — hiện message
      // thân thiện thay vì raw key cho người dùng dễ hiểu.
      const rawMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      if (rawMessage === 'error.userNotFound') {
        toast.error(t('login.invalidCredentials'));
      } else {
        handleAxiosError(error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[440px]">
        <div className="text-center mb-8">
          <img src={logoUrl} alt="Logo" className="h-10 w-auto object-contain mx-auto mb-5" />
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('login.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">{t('login.subtitle')}</p>
        </div>

        <div className="bg-card rounded-2xl border border-border p-7 shadow-sm">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('login.email')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder={t('login.emailPlaceholder')} className="pl-9 h-10" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('login.password')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder={t('login.passwordPlaceholder')}
                          className="pl-9 pr-10 h-10"
                          {...field}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rememberMe"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      {t('login.rememberMe')}
                    </label>
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={loading} className="w-full h-10">
                {loading && <Spinner size={14} className="text-primary-foreground" />}
                {t('login.continue')}
              </Button>
            </form>
          </Form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">{t('login.footer')}</p>
      </div>
    </div>
  );
}

export default Login;
