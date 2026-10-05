import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, Search, UserCog } from 'lucide-react';
import { RoleType } from 'shared';

import { PATHS } from '@/constants/paths';

import { useAuthStore } from '@/store/authStore';

import { PageHeader } from '@/components/common/PageHeader';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';
import type { ImpersonationCandidate } from '@/utils/impersonationStart';
import { startImpersonation } from '@/utils/impersonationStart';

import { useImpersonationSearch } from '@/hooks/useImpersonationSearch';
import { usePermission } from '@/hooks/usePermission';

/**
 * Màn hình **Mạo danh tài khoản** — CHỈ SuperAdmin (AUTH-1 `BR-1`).
 *
 * Gộp CẢ HAI nguồn tài khoản vào một ô tìm kiếm: nhân viên (`GET /users`) và
 * khách hàng Customer Portal (`GET /customers`). Trước đây tài khoản khách chỉ
 * tới được qua một dialog nằm trong trang cấu hình gán xưởng — không ai đoán ra,
 * và mâu thuẫn trực tiếp với chữ "nhanh" trong chính yêu cầu gốc.
 *
 * KHÔNG cần endpoint mới: cả hai endpoint đã có sẵn tham số `search`.
 */
function ImpersonatePage() {
  const { t } = useTranslation('auth');
  const { roleName } = usePermission();
  const impersonatedBy = useAuthStore((s) => s.profile?.impersonatedBy);

  const [keyword, setKeyword] = useState('');
  const [target, setTarget] = useState<ImpersonationCandidate | null>(null);
  const [starting, setStarting] = useState(false);
  const { debounced, loading, users, customers, results } = useImpersonationSearch(keyword);

  const isSuperAdmin = roleName === RoleType.SuperAdmin;

  const doStart = async () => {
    if (!target) return;
    try {
      setStarting(true);
      await startImpersonation(target);
    } catch (err) {
      handleAxiosError(err);
      setStarting(false);
    }
  };

  // Đang mạo danh thì không mở phiên mạo danh nữa (`BR-6`/`AC-08`). Thực tế
  // profile lúc đó là của người bị mạo danh nên `isSuperAdmin` đã false; nhánh
  // này chỉ để thông báo rõ thay vì im lặng chuyển hướng.
  if (impersonatedBy) return <Navigate to={PATHS.HOME} replace />;
  if (!isSuperAdmin) return <Navigate to={PATHS.HOME} replace />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={<UserCog size={20} />} title={t('impersonate.title')} description={t('impersonate.subtitle')} />

      <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <p>{t('impersonate.warning')}</p>
      </div>

      <div className="relative mt-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t('impersonate.searchPlaceholder')}
          className="pl-9"
          autoFocus
        />
      </div>

      <div className="mt-4">
        {!debounced.trim() ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('impersonate.searchHint')}</p>
        ) : loading ? (
          <div className="flex justify-center py-10">
            <Spinner size={22} />
          </div>
        ) : (
          <>
            {users === null && <p className="mb-2 text-xs text-destructive">{t('impersonate.usersFailed')}</p>}
            {customers === null && <p className="mb-2 text-xs text-destructive">{t('impersonate.customersFailed')}</p>}
            {results.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t('impersonate.empty', { keyword: debounced.trim() })}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {results.map((c) => (
                  <li
                    key={`${c.targetType}-${c.id}`}
                    className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {c.targetType === 'user' ? t('impersonate.badgeStaff') : t('impersonate.badgeCustomer')}
                        </Badge>
                        <span className="truncate text-sm font-medium">{c.title}</span>
                        {/* Vai trò (AUTH-5) — hiện thô, không dịch nhãn; khách hàng
                            không có vai trò nội bộ nên bỏ trống. */}
                        {c.role && (
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {c.role}
                          </Badge>
                        )}
                        {/* Tài khoản đã vô hiệu hoá VẪN mạo danh được (`BR-2`/`AC-03`)
                            — badge chỉ để người dùng biết mình đang vào cái gì. */}
                        {c.inactive && (
                          <Badge variant="destructive" className="text-[10px]">
                            {t('impersonate.badgeInactive')}
                          </Badge>
                        )}
                      </div>
                      {c.subtitle && <p className="truncate text-xs text-muted-foreground">{c.subtitle}</p>}
                    </div>
                    <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setTarget(c)}>
                      {t('impersonate.action')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && !starting && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('impersonate.confirmTitle', { name: target?.title ?? '' })}</DialogTitle>
            <DialogDescription>{t('impersonate.confirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={starting} onClick={() => setTarget(null)}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button disabled={starting} onClick={() => void doStart()}>
              {t('impersonate.action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ImpersonatePage;
