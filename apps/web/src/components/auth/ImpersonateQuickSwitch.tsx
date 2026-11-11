import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, UserCog } from 'lucide-react';
import { RoleType } from 'shared';

import { useAuthStore } from '@/store/authStore';

import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { handleAxiosError } from '@/utils';
import type { ImpersonationCandidate } from '@/utils/impersonationStart';
import { startImpersonation } from '@/utils/impersonationStart';

import { useImpersonationSearch } from '@/hooks/useImpersonationSearch';
import { usePermission } from '@/hooks/usePermission';

/**
 * Nút truy cập nhanh **Mạo danh tài khoản** trên thanh nav nhân viên (AUTH-2) —
 * đặt cạnh nút đổi ngôn ngữ. Chỉ là LỐI VÀO: tìm kiếm và luồng bắt đầu mạo danh
 * dùng chung `useImpersonationSearch` + `startImpersonation` với trang
 * `/impersonate` (AUTH-1), không tự dựng lại đường ghi token.
 *
 * **Chỉ SuperAdmin thấy.** `allow()` cho cả Admin lẫn SuperAdmin đi qua nên
 * KHÔNG thu hẹp được bằng `perm` — phải so thẳng `roleName` như mục sidebar
 * (`onlyForRoles`). Ẩn ở giao diện KHÔNG phải hàng rào: backend vẫn là chỗ chặn
 * thật, kể cả khi có người gọi thẳng endpoint.
 *
 * Đang mạo danh nhân viên thì `profile` là người BỊ mạo danh (vai bất kỳ) —
 * control vẫn hiện để đọc đúng "đang truy cập bằng tài khoản nào" và để tới
 * được dải thoát; chọn tiếp tài khoản khác sẽ bị backend chặn (mạo danh lồng
 * nhau) và FE chỉ hiển thị lỗi đó.
 */
export function ImpersonateQuickSwitch() {
  const { t } = useTranslation('auth');
  const { roleName } = usePermission();
  const profile = useAuthStore((s) => s.profile);

  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [startingId, setStartingId] = useState<string | null>(null);
  const { debounced, loading, users, customers, results } = useImpersonationSearch(keyword);

  const impersonating = !!profile?.impersonatedBy;
  const isSuperAdmin = roleName === RoleType.SuperAdmin;
  if (!isSuperAdmin && !impersonating) return null;

  const displayName = profile?.fullName || profile?.email || '';
  const displayEmail = profile?.email || '';

  const handlePick = async (c: ImpersonationCandidate) => {
    try {
      setStartingId(`${c.targetType}-${c.id}`);
      await startImpersonation(c);
    } catch (err) {
      handleAxiosError(err);
      setStartingId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // Tên + email dài thì cắt bớt, KHÔNG để vỡ thanh nav; màn hẹp rút về
          // đúng biểu tượng.
          className="w-auto shrink-0 gap-1.5 px-2 touch:w-auto"
          title={t('impersonate.quickSwitch.tooltip', { name: displayName, email: displayEmail })}
          aria-label={t('impersonate.quickSwitch.tooltip', { name: displayName, email: displayEmail })}
        >
          <UserCog size={16} className={impersonating ? 'text-amber-500' : undefined} />
          {/* Name and email only while impersonating: the account block next to it already shows the signed-in
              user, so for a SuperAdmin who is not impersonating anyone this is just the icon (with its tooltip). */}
          {impersonating && (
            <span className="hidden w-[168px] shrink-0 flex-col text-left leading-tight lg:flex">
              <span className="truncate text-xs font-medium text-foreground">{displayName}</span>
              <span className="truncate text-[11px] text-muted-foreground">{displayEmail}</span>
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="border-b border-border px-3 py-2.5">
          <p className="text-xs font-semibold text-foreground">{t('impersonate.quickSwitch.title')}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('impersonate.quickSwitch.current', { name: displayName, email: displayEmail })}
          </p>
        </div>

        <div className="p-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('impersonate.searchPlaceholder')}
              className="h-9 pl-8"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto px-2 pb-2">
          {!debounced.trim() ? (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t('impersonate.searchHint')}</p>
          ) : loading ? (
            <div className="flex justify-center py-6">
              <Spinner size={18} />
            </div>
          ) : (
            <>
              {users === null && <p className="px-1 pb-1 text-[11px] text-destructive">{t('impersonate.usersFailed')}</p>}
              {customers === null && (
                <p className="px-1 pb-1 text-[11px] text-destructive">{t('impersonate.customersFailed')}</p>
              )}
              {results.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  {t('impersonate.empty', { keyword: debounced.trim() })}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {results.map((c) => {
                    const key = `${c.targetType}-${c.id}`;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          disabled={!!startingId}
                          onClick={() => void handlePick(c)}
                          className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-60"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* Hai loại tài khoản đăng nhập bằng hai hệ token khác
                                  nhau — nhãn phải nằm ngay trên từng dòng. */}
                              <Badge variant="outline" className="text-[10px]">
                                {c.targetType === 'user'
                                  ? t('impersonate.badgeStaff')
                                  : t('impersonate.badgeCustomer')}
                              </Badge>
                              <span className="truncate text-xs font-medium">{c.title}</span>
                              {/* Vai trò (AUTH-5) — badge riêng, KHÔNG nhét vào dòng phụ
                                  vì email dài sẽ cắt mất nó trong popup hẹp. */}
                              {c.role && (
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {c.role}
                                </Badge>
                              )}
                              {c.inactive && (
                                <Badge variant="destructive" className="text-[10px]">
                                  {t('impersonate.badgeInactive')}
                                </Badge>
                              )}
                            </div>
                            {c.subtitle && <p className="truncate text-[11px] text-muted-foreground">{c.subtitle}</p>}
                          </div>
                          {startingId === key && <Spinner size={14} className="mt-0.5 shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
