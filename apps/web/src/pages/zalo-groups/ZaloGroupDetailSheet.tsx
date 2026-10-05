import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { AlertTriangle, CircleAlert, CircleCheck, MessageSquare, Pencil, RefreshCw } from 'lucide-react';
import type { ZaloGroupLink, ZaloGroupSummary } from 'shared';
import { ZaloSummaryLevel } from 'shared';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { KIND_BADGE_CLASS } from './index';

const LEVEL_ICON: Record<string, { Icon: typeof AlertTriangle; cls: string }> = {
  [ZaloSummaryLevel.Gap]: { Icon: AlertTriangle, cls: 'text-rose-600 dark:text-rose-400' },
  [ZaloSummaryLevel.CanChuY]: { Icon: CircleAlert, cls: 'text-amber-600 dark:text-amber-400' },
  [ZaloSummaryLevel.BinhThuong]: { Icon: CircleCheck, cls: 'text-emerald-600 dark:text-emerald-400' },
};

interface Props {
  group: ZaloGroupLink & { _id: string };
  onClose: () => void;
  /** Mở hộp thoại gắn nhóm — việc thiết lập, tách khỏi việc theo dõi hằng ngày. */
  onEdit: () => void;
  /** Có thay đổi gì cần bảng ngoài vẽ lại không. */
  onChanged: () => void;
}

/**
 * Ngăn kéo chi tiết một nhóm: toàn bộ tình hình + danh sách việc tick được.
 *
 * Tách khỏi bảng vì bảng chỉ đủ chỗ cho một dòng tiêu đề; còn người trực nhóm
 * cần đọc đủ bốn ô (khách hỏi gì · đã đáp gì · còn treo gì · làm gì tiếp) rồi
 * tick ngay tại chỗ, không phải nhớ rồi đi tìm màn hình khác.
 */
export default function ZaloGroupDetailSheet({ group, onClose, onEdit, onChanged }: Props) {
  const { t } = useTranslation(['zaloGroups', 'common']);

  const [tomTat, setTomTat] = useState<ZaloGroupSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Lấy đúng bản tóm tắt của nhóm này qua bộ lọc tìm kiếm — rẻ hơn thêm
      // một endpoint chỉ để tra một bản ghi.
      const res = await RepositoryRemote.zaloGroup.getSummaries(
        `?page=1&limit=1&search=${encodeURIComponent(group.title ?? '')}`,
      );
      const rows: ZaloGroupSummary[] = res.data?.data ?? [];
      setTomTat(rows.find((r) => r.groupGlobalId === group.groupGlobalId) ?? null);
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setLoading(false);
    }
  }, [group.title, group.groupGlobalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (index: number, xong: boolean) => {
    if (!tomTat) return;
    // Đổi trên màn hình trước rồi mới gọi API: tick vào ô mà phải chờ mạng mới
    // thấy đổi thì người dùng bấm hai lần.
    setTomTat({
      ...tomTat,
      checklist: tomTat.checklist.map((c, i) => (i === index ? { ...c, xong } : c)),
    });
    try {
      await RepositoryRemote.zaloGroup.toggleTask(group.groupGlobalId, { index, xong });
      onChanged();
    } catch (error) {
      handleAxiosError(error);
      void load();
    }
  };

  const level = tomTat ? (LEVEL_ICON[tomTat.mucDo] ?? LEVEL_ICON[ZaloSummaryLevel.BinhThuong]) : null;
  const conLai = tomTat?.checklist.filter((c) => !c.xong).length ?? 0;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="pr-8 text-left">
            <div className="flex items-start gap-2">
              <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0">{group.title || t('table.noTitle')}</span>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* ── Thông tin nhóm ── */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={cn('font-normal', KIND_BADGE_CLASS[group.kind])}>{t(`kind.${group.kind}`)}</Badge>
            {group.userSku ? (
              <span className="font-mono text-xs">{group.userSku}</span>
            ) : (
              <span className="text-xs text-slate-400">{t('table.noCustomer')}</span>
            )}
            <Button variant="outline" size="sm" className="ml-auto" onClick={onEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {t('edit.title')}
            </Button>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
            <Meta label={t('table.conversations', { count: group.conversationIds?.length ?? 0 })} value="" />
            <Meta
              label={t('table.lastMessage')}
              value={group.lastMessageAt ? dayjs(group.lastMessageAt).format('DD/MM/YYYY HH:mm') : '—'}
            />
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t('table.nicks')}</dt>
              <dd className="mt-0.5">{group.memberNicks?.join(', ') || '—'}</dd>
            </div>
          </dl>

          {/* ── Tình hình ── */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !tomTat ? (
            <div className="rounded-lg border py-8 text-center text-sm text-slate-500">{t('summary.empty')}</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                {level && <level.Icon className={cn('mt-0.5 h-5 w-5 shrink-0', level.cls)} />}
                <div className="min-w-0">
                  <div className="font-medium">{tomTat.tieuDe || '—'}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {t(`summary.level.${tomTat.mucDo}`)}
                    {tomTat.tomTatLuc && <> · {dayjs(tomTat.tomTatLuc).format('DD/MM HH:mm')}</>}
                    {tomTat.soTin > 0 && <> · {t('summary.msgCount', { count: tomTat.soTin })}</>}
                  </div>
                  {/* Tính phía client: nhóm đã có `lastMessageAt`, tóm tắt có `denMocTin`. */}
                  {group.lastMessageAt &&
                    (!tomTat.denMocTin || dayjs(group.lastMessageAt).isAfter(dayjs(tomTat.denMocTin))) && (
                      <div className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        {t('summary.newSince', { at: dayjs(group.lastMessageAt).format('DD/MM HH:mm') })}
                      </div>
                    )}
                </div>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>

              <Block label={t(group.kind === 'operation' ? 'summary.requesterWants' : 'summary.customerWants')} value={tomTat.khachQuanTam} />
              <Block label={t(group.kind === 'operation' ? 'summary.handlerReplied' : 'summary.staffReplied')} value={tomTat.salePhanHoi} />
              <Block label={t('summary.pending')} value={tomTat.tonDong} highlight />

              {/* ── Danh sách việc, tick được ngay ── */}
              {tomTat.checklist.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {t('summary.todo')}
                    {conLai > 0 && <span className="ml-1 text-amber-600">({conLai})</span>}
                  </div>
                  <ul className="space-y-2">
                    {tomTat.checklist.map((c, i) => (
                      <li key={i}>
                        {/* The whole card is the label: a thumb can hit the text, not only a 16px box. */}
                        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 touch:min-h-[44px] touch:p-3">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer touch:h-5 touch:w-5"
                            aria-label={c.viec}
                            checked={c.xong}
                            onChange={(e) => void toggle(i, e.target.checked)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className={cn('text-sm', c.xong && 'text-slate-400 line-through')}>{c.viec}</div>
                            {c.xong && c.xongLuc && (
                              <div className="mt-0.5 text-xs text-slate-400">
                                {t('summary.doneAt', { at: dayjs(c.xongLuc).format('DD/MM HH:mm') })}
                              </div>
                            )}
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {tomTat.nghiNgo.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                  <div className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    {t('summary.doubt')}
                  </div>
                  <ul className="mt-1.5 space-y-1 text-sm text-amber-700 dark:text-amber-400">
                    {tomTat.nghiNgo.map((n, i) => (
                      <li key={i}>· {n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Block({ label, value, highlight }: { label: string; value?: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <p
        className={cn(
          'mt-0.5 text-sm leading-relaxed',
          highlight && value ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-300',
        )}
      >
        {value?.trim() || '—'}
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      {value && <dd className="mt-0.5">{value}</dd>}
    </div>
  );
}
