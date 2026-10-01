import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, Factory } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';
import { useFactoryOptionsStore } from '@/store/factoryOptionsStore';
import { useSidebarBadgeStore } from '@/store/sidebarBadgeStore';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { cn } from '@/utils/cn';

import { useFactoryScope } from '@/hooks/useFactoryScope';

/**
 * Bộ chọn XƯỞNG toàn cục trên header (07/09/2026) — thay 5 cụm menu riêng từng xưởng
 * ở sidebar (Orders.md §25). Chọn xưởng = ghi `?factoryId=` lên URL hiện tại
 * (`useFactoryScope` vẫn là nơi duy nhất đọc), link cụm sản xuất ở sidebar mang theo
 * param nên đổi trang không mất phạm vi. Chỉ hiện ở namespace sản xuất `/ffm/*`.
 * Badge trên từng xưởng = số tồn riêng xưởng đó (`counts.byFactory`, trước đây treo
 * trên cụm menu xưởng). Tài khoản Fulfillment bị khóa xưởng → chip tĩnh, không menu.
 * Xưởng US (ngoài luồng) vẫn có trong danh sách — đây là lối duy nhất xem đơn US.
 */
export function FactoryScopeSwitch() {
  const { t } = useTranslation('layout');
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const scope = useFactoryScope();
  const profile = useAuthStore((s) => s.profile);
  const factories = useFactoryOptionsStore((s) => s.factories);
  const load = useFactoryOptionsStore((s) => s.load);
  const counts = useSidebarBadgeStore((s) => s.counts);

  const onProduction = location.pathname.startsWith('/ffm');
  useEffect(() => {
    if (onProduction && profile?._id) void load();
  }, [onProduction, profile?._id, load]);
  if (!onProduction || !profile) return null;

  // Fulfillment is the only role the BE locks to one factory (`buildVisibilityFilter`) —
  // Designers are scoped by assignee, not by factory, and keep the picker. Lock on the ROLE,
  // not on `factoryId` being set: a Fulfillment account not yet assigned to a factory must not
  // get a picker inviting it to browse every factory (it sees nothing until assigned).
  const isLocked = profile.role?.name === 'Fulfillment';
  const locked = isLocked ? profile.factoryId || undefined : undefined;
  const currentId = scope || '';
  const current = factories.find((f) => f._id === currentId);
  const label = (f?: { shortName?: string; name: string }) =>
    f ? (f.shortName ? `${f.shortName} · ${f.name}` : f.name) : t('header.factoryScope.all');

  const pick = (id: string) => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        id ? sp.set('factoryId', id) : sp.delete('factoryId');
        // Đổi phạm vi thì về trang 1 của mọi bảng đang phân trang theo URL.
        for (const k of ['wpage', 'cpage', 'page']) sp.delete(k);
        return sp;
      },
      { replace: true },
    );
  };

  const badges = (c?: { errorLogTodo: number; toolCheckRework: number; toolCheckUnreviewed: number } | null) => {
    if (!c) return null;
    const tool = (c.toolCheckRework || 0) + (c.toolCheckUnreviewed || 0);
    return (
      <span className="ml-auto flex items-center gap-1 pl-3">
        {c.errorLogTodo > 0 && (
          <span title={t('header.factoryScope.badgeError')} className="min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
            {c.errorLogTodo}
          </span>
        )}
        {tool > 0 && (
          <span title={t('header.factoryScope.badgeTool')} className="min-w-[18px] rounded-full bg-amber-400 px-1 text-center text-[10px] font-semibold leading-[18px] text-amber-950">
            {tool}
          </span>
        )}
      </span>
    );
  };

  if (isLocked) {
    // Never fall back to "All factories" here: that label would claim a scope the account
    // does not have (e.g. while the factory list is still loading).
    const lockedLabel = current ? label(current) : locked ? '…' : t('header.factoryScope.noFactory');
    return (
      <span
        title={t('header.factoryScope.lockedTitle')}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 text-xs font-medium text-foreground"
      >
        <Factory size={14} className="text-muted-foreground" />
        {lockedLabel}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" title={t('header.factoryScope.title')}>
          <Factory size={14} className="text-muted-foreground" />
          <span className="text-muted-foreground">{t('header.factoryScope.label')}:</span>
          <span className={cn('max-w-[220px] truncate font-medium', currentId && 'text-indigo-700 dark:text-indigo-300')}>{label(current)}</span>
          <ChevronDown size={12} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('header.factoryScope.label')}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => pick('')} className="gap-2">
          <Check size={14} className={cn('shrink-0', currentId ? 'opacity-0' : 'opacity-100')} />
          <span className="flex-1 truncate">{t('header.factoryScope.all')}</span>
          {badges(
            counts
              ? {
                  errorLogTodo: counts.errorLogTodo || 0,
                  toolCheckRework: counts.toolCheckRework || 0,
                  toolCheckUnreviewed: counts.toolCheckUnreviewed || 0,
                }
              : null,
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {factories.map((f) => (
          <DropdownMenuItem key={f._id} onClick={() => pick(f._id)} className="gap-2">
            <Check size={14} className={cn('shrink-0', currentId === f._id ? 'opacity-100' : 'opacity-0')} />
            <span className="flex-1 truncate">{label(f)}</span>
            {badges(counts?.byFactory?.[f._id])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
