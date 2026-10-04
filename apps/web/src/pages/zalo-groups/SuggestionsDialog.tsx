import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ZaloGroupSuggestion } from 'shared';
import { ZaloGroupKind } from 'shared';

import { RepositoryRemote } from '@/services';

import { ResponsiveList } from '@/components/common/ResponsiveList';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { handleAxiosError } from '@/utils';
import { cn } from '@/utils/cn';

import { useIsMobile } from '@/hooks/useMediaQuery';

interface Props {
  onClose: () => void;
  onApplied: (count: number) => void;
}

/**
 * Duyệt gợi ý ghép nhóm ↔ khách.
 *
 * Mọi dòng đều được TICK SẴN vì phần lớn gợi ý đạt 0.95 (tên nhóm chứa nguyên
 * mã khách). Người duyệt chỉ cần bỏ tick vài dòng đáng ngờ thay vì phải tick
 * hàng chục dòng đúng — nhưng vẫn phải bấm nút, không có gì tự gắn.
 */
export default function SuggestionsDialog({ onClose, onApplied }: Props) {
  const { t } = useTranslation(['zaloGroups', 'common']);
  const isMobile = useIsMobile();

  const [items, setItems] = useState<ZaloGroupSuggestion[]>([]);
  const [idByGroup, setIdByGroup] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [sug, groups] = await Promise.all([
          RepositoryRemote.zaloGroup.getSuggestions(),
          // Gợi ý trả `groupGlobalId`, còn PATCH cần `_id` của bản ghi — nạp một
          // lượt để tra ngược, khỏi gọi API cho từng dòng.
          RepositoryRemote.zaloGroup.getGroups('?page=1&limit=500'),
        ]);
        const list: ZaloGroupSuggestion[] = sug.data?.data ?? [];
        const map: Record<string, string> = {};
        for (const g of groups.data?.data ?? []) map[g.groupGlobalId] = g._id;

        setItems(list);
        setIdByGroup(map);
        setChecked(Object.fromEntries(list.map((s) => [s.groupGlobalId, true])));
      } catch (error) {
        handleAxiosError(error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selected = items.filter((s) => checked[s.groupGlobalId] && idByGroup[s.groupGlobalId]);

  const applyAll = async () => {
    setApplying(true);
    let ok = 0;
    try {
      for (const s of selected) {
        try {
          await RepositoryRemote.zaloGroup.updateLink(idByGroup[s.groupGlobalId], {
            kind: ZaloGroupKind.Seller,
            // `create` = mã có thật nhưng chưa có khách nào mang mã đó; server
            // tạo khách rồi ghép trong CÙNG một lần gọi, để ops không phải sang
            // trang khác tạo tay rồi quay lại (thực tế là họ bỏ luôn).
            ...(s.action === 'create' ? { newCustomerSku: s.userSku } : { customerId: s.customerId }),
          });
          ok += 1;
        } catch (error) {
          // Một dòng hỏng không được làm dừng cả lô — báo rồi đi tiếp.
          handleAxiosError(error);
        }
      }
      onApplied(ok);
    } finally {
      setApplying(false);
    }
  };

  const allChecked = items.length > 0 && items.every((s) => checked[s.groupGlobalId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="pr-10 text-left">{t('suggestions.title')}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-slate-500 dark:text-slate-400">{t('suggestions.description')}</p>

        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">{t('suggestions.empty')}</div>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
            {/* The table's select-all checkbox lives in its header; cards have no header, so phones get it here. */}
            {isMobile && (
              <label className="flex cursor-pointer items-center gap-2 border-b p-3 text-sm touch:min-h-[44px]">
                <input
                  type="checkbox"
                  className="touch:h-5 touch:w-5"
                  checked={allChecked}
                  onChange={(e) => setChecked(Object.fromEntries(items.map((s) => [s.groupGlobalId, e.target.checked])))}
                />
                {t('suggestions.selectAll')}
              </label>
            )}
            <ResponsiveList
              className="p-3 md:p-0"
              rows={items}
              rowKey={(s) => s.groupGlobalId}
              columns={[
                {
                  key: 'select',
                  mobile: 'trailing',
                  className: 'w-10',
                  header: (
                    <input
                      type="checkbox"
                      aria-label={t('suggestions.selectAll')}
                      checked={allChecked}
                      onChange={(e) =>
                        setChecked(Object.fromEntries(items.map((s) => [s.groupGlobalId, e.target.checked])))
                      }
                    />
                  ),
                  cell: (s) => (
                    <input
                      type="checkbox"
                      className="touch:h-6 touch:w-6"
                      aria-label={s.title ?? s.groupGlobalId}
                      checked={!!checked[s.groupGlobalId]}
                      onChange={(e) => setChecked((c) => ({ ...c, [s.groupGlobalId]: e.target.checked }))}
                    />
                  ),
                },
                {
                  key: 'group',
                  header: t('table.group'),
                  mobile: 'title',
                  cell: (s) => <span className="break-words text-sm font-medium">{s.title || t('table.noTitle')}</span>,
                },
                {
                  key: 'customer',
                  header: t('table.customer'),
                  mobile: 'subtitle',
                  cell: (s) => (
                    <span className="font-mono text-sm">
                      {s.userSku}
                      {s.action === 'create' && (
                        <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                          {t('suggestions.willCreate')}
                        </span>
                      )}
                      {s.customerName && <span className="block font-sans text-xs text-slate-500">{s.customerName}</span>}
                    </span>
                  ),
                },
                {
                  key: 'confidence',
                  header: t('suggestions.confidence'),
                  mobile: 'trailing',
                  className: 'w-24',
                  cell: (s) => (
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs font-medium tabular-nums',
                        s.score >= 0.9
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
                      )}
                    >
                      {s.score.toFixed(2)}
                    </span>
                  ),
                },
                {
                  key: 'reason',
                  header: t('suggestions.reason'),
                  cell: (s) => <span className="text-xs text-slate-500">{s.reason}</span>,
                },
              ]}
            />
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={applyAll} disabled={applying || selected.length === 0}>
            {t('suggestions.applyAll')} ({selected.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
