import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, Crown, Search, User, UserCog } from 'lucide-react';
import type { ZaloIdentity } from 'shared';
import { ZALO_IDENTITY_KINDS, ZaloIdentityKind } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { LoadingOverlay } from '@/components/common/LoadingOverlay';
import { PaginationBar } from '@/components/common/PaginationBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

const PAGE_SIZE = 30;

const KIND_ICON: Record<string, typeof User> = {
  [ZaloIdentityKind.AiSupport]: Bot,
  [ZaloIdentityKind.Chairman]: Crown,
  [ZaloIdentityKind.Staff]: UserCog,
  [ZaloIdentityKind.Customer]: User,
  [ZaloIdentityKind.Unknown]: Search,
};

type Row = ZaloIdentity & { _id: string };

/**
 * Duyệt "ai là ai" trong các nhóm Zalo.
 *
 * Cột "Số nhóm" là BẰNG CHỨNG, không phải trang trí: người trực nhiều nhóm là
 * nhân viên, khách chỉ ở nhóm của mình. Có nó thì người duyệt quyết được trong
 * một cái liếc, không phải tin lời máy.
 */
export default function IdentitiesPanel() {
  const { t } = useTranslation(['zaloGroups', 'common']);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<string>('');
  /** Nhân viên cho ô nối tài khoản — tải một lần, không đổi theo bộ lọc. */
  const [nhanVien, setNhanVien] = useState<{ _id: string; fullName?: string; email: string }[]>([]);
  const [chuaXacNhan, setChuaXacNhan] = useState(true);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', String(PAGE_SIZE));
    if (search.trim()) p.set('search', search.trim());
    if (kind) p.set('kind', kind);
    if (chuaXacNhan) p.set('chuaXacNhan', 'true');

    return `?${p.toString()}`;
  }, [page, search, kind, chuaXacNhan]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, c] = await Promise.all([
        RepositoryRemote.zaloGroup.getIdentities(query),
        RepositoryRemote.zaloGroup.getIdentityCounts(),
      ]);
      setRows(list.data?.data ?? []);
      setTotal(list.data?.total ?? 0);
      setCounts(c.data?.data ?? {});
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await RepositoryRemote.users.getUsers('?page=1&limit=200');
        setNhanVien(res.data?.data ?? []);
      } catch (error) {
        handleAxiosError(error);
      }
    })();
  }, []);

  const setKindFor = async (r: Row, next: ZaloIdentityKind) => {
    setRows((rs) => rs.map((x) => (x._id === r._id ? { ...x, kind: next, confirmedAt: new Date() } : x)));
    try {
      await RepositoryRemote.zaloGroup.updateIdentity(r.zaloUid, { kind: next });
      void load();
    } catch (error) {
      handleAxiosError(error);
      void load();
    }
  };

  /**
   * Nối nick Zalo với tài khoản nhân viên. Lưu ngay khi chọn, không có nút Lưu —
   * nối 22 người liên tiếp mà mỗi lần bấm thêm một nút thì thao tác nặng gấp đôi.
   * KHÔNG gọi `load()` sau khi lưu: nạp lại cả bảng làm mất chỗ đang cuộn.
   */
  const noiTaiKhoan = async (r: Row, userId: string) => {
    const cu = r.userId ?? '';
    setRows((rs) => rs.map((x) => (x._id === r._id ? { ...x, userId: userId || undefined } : x)));
    try {
      await RepositoryRemote.zaloGroup.updateIdentity(r.zaloUid, { kind: r.kind, userId: userId || null });
    } catch (error) {
      setRows((rs) => rs.map((x) => (x._id === r._id ? { ...x, userId: cu || undefined } : x)));
      handleAxiosError(error);
    }
  };

  const applyAll = async () => {
    try {
      const res = await RepositoryRemote.zaloGroup.applyIdentitySuggestions();
      toast.success(t('identity.applied', { count: res.data?.data?.applied ?? 0 }));
      void load();
    } catch (error) {
      handleAxiosError(error);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-slate-200 dark:bg-slate-700 sm:grid-cols-4">
        <Stat label={t('identity.kind.ai-support')} value={counts[ZaloIdentityKind.AiSupport] ?? 0} />
        <Stat label={t('identity.kind.staff')} value={counts[ZaloIdentityKind.Staff] ?? 0} />
        <Stat label={t('identity.kind.customer')} value={counts[ZaloIdentityKind.Customer] ?? 0} />
        <Stat label={t('identity.pending')} value={counts.chuaXacNhan ?? 0} warn />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="w-56 pl-8"
            placeholder={t('identity.searchName')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="h-9 rounded-md border border-slate-200 bg-transparent px-2 text-sm dark:border-slate-700"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('identity.allKinds')}</option>
          {ZALO_IDENTITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`identity.kind.${k}`)}
            </option>
          ))}
        </select>
        <Button
          variant={chuaXacNhan ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setChuaXacNhan((v) => !v);
            setPage(1);
          }}
        >
          {t('identity.pendingOnly')}
        </Button>
        {(counts.chuaXacNhan ?? 0) > 0 && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={applyAll}>
            <Check className="mr-1.5 h-4 w-4" />
            {t('identity.applyAll')}
          </Button>
        )}
      </div>

      <LoadingOverlay active={loading} className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('identity.person')}</TableHead>
              <TableHead className="w-24 text-right">{t('identity.groupCount')}</TableHead>
              <TableHead className="w-24 text-right">{t('identity.msgCount')}</TableHead>
              <TableHead>{t('identity.classify')}</TableHead>
              <TableHead className="w-52">{t('identity.linkedUser')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                  {t('identity.empty')}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const Icon = KIND_ICON[r.kind] ?? Search;

              return (
                <TableRow key={r._id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.displayName || r.zaloUid}</div>
                        {!r.confirmedAt && r.suggestedKind && r.suggestedKind !== ZaloIdentityKind.Unknown && (
                          <div className="text-xs text-slate-400">
                            {t('identity.suggested', { kind: t(`identity.kind.${r.suggestedKind}`) })}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{r.groupCount}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-500">{r.messageCount}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {ZALO_IDENTITY_KINDS.filter((k) => k !== ZaloIdentityKind.Unknown).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => void setKindFor(r, k)}
                          className={cn(
                            'rounded border px-2 py-0.5 text-xs transition-colors',
                            r.kind === k
                              ? 'border-primary-500 bg-primary-500 text-white'
                              : 'border-slate-200 hover:border-primary-400 dark:border-slate-700',
                          )}
                        >
                          {t(`identity.kind.${k}`)}
                        </button>
                      ))}
                    </div>
                  </TableCell>
                  {/* Nối nick Zalo với tài khoản hệ thống. Chỉ có ý nghĩa với
                      NHÂN VIÊN — biết nick nào là ai thì agent mới tag đúng người
                      trong nhóm vận hành. Khách thì nối qua `customerId` ở nơi khác. */}
                  <TableCell>
                    {r.kind === ZaloIdentityKind.Staff || r.kind === ZaloIdentityKind.AiSupport ? (
                      <select
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                        value={r.userId ?? ''}
                        onChange={(e) => void noiTaiKhoan(r, e.target.value)}
                      >
                        <option value="">{t('identity.noLinkedUser')}</option>
                        {nhanVien.map((u) => (
                          <option key={u._id} value={u._id}>
                            {u.fullName || u.email}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">{t('identity.staffOnly')}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </LoadingOverlay>

      <PaginationBar
        position="bottom"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        loading={loading}
        onChange={(p) => setPage(p)}
      />
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-white p-3 dark:bg-slate-900">
      <div
        className={cn(
          'text-2xl font-semibold tabular-nums',
          warn && value > 0 && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
