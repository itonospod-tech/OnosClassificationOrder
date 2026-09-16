import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ZaloGroupLink } from 'shared';
import { ZALO_GROUP_KINDS, ZaloGroupKind } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { handleAxiosError } from '@/utils';

interface CustomerLite {
  _id: string;
  userSku?: string;
  fullName?: string;
}

interface UserLite {
  _id: string;
  fullName?: string;
}

interface Props {
  group: ZaloGroupLink & { _id: string };
  onClose: () => void;
  onSaved: () => void;
}

export default function ZaloGroupEditDialog({ group, onClose, onSaved }: Props) {
  const { t } = useTranslation(['zaloGroups', 'common']);

  const [kind, setKind] = useState<ZaloGroupKind>(group.kind);
  const [customerId, setCustomerId] = useState<string>(group.customerId ?? '');
  // Mã khách gõ tay khi seller chưa có trong bảng khách. Xem `newCustomerSku`
  // ở BE: bảng khách sinh ra TỪ đơn hàng nên seller chưa đặt đơn thì chưa tồn
  // tại, và trước đây ops phải sang trang khác tạo rồi quay lại.
  const [newSku, setNewSku] = useState('');
  const [ownerUserId, setOwnerUserId] = useState<string>(group.ownerUserId ?? '');
  const [note, setNote] = useState<string>(group.note ?? '');
  const [saving, setSaving] = useState(false);

  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [c, u] = await Promise.all([
          RepositoryRemote.customer.list('?page=1&limit=500'),
          RepositoryRemote.users.getUsers('?page=1&limit=200'),
        ]);
        setCustomers(c.data?.data ?? []);
        setUsers(u.data?.data ?? []);
      } catch (error) {
        handleAxiosError(error);
      }
    })();
  }, []);

  /** Lọc phía client: 132 khách thì tải một lượt rẻ hơn gọi API mỗi lần gõ. */
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 100);

    return customers
      .filter((c) => `${c.userSku ?? ''} ${c.fullName ?? ''}`.toLowerCase().includes(q))
      .slice(0, 100);
  }, [customers, customerSearch]);

  // Đổi sang phân loại khác 'nhóm khách' thì gỡ luôn khách đang chọn — BE sẽ
  // từ chối nếu để lẫn, báo lỗi ở đây thì người dùng phải sửa hai lần.
  const handleKindChange = (next: ZaloGroupKind) => {
    setKind(next);
    if (next !== ZaloGroupKind.Seller) {
      setCustomerId('');
      setNewSku('');
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const sku = newSku.trim();
      await RepositoryRemote.zaloGroup.updateLink(group._id, {
        kind,
        // Hai đường loại trừ nhau — BE từ chối nếu gửi cả hai.
        ...(kind === ZaloGroupKind.Seller && sku ? { newCustomerSku: sku } : { customerId: customerId || null }),
        ownerUserId: ownerUserId || null,
        note: note.trim() || null,
      });
      toast.success(t('edit.saved', { title: group.title || t('table.noTitle') }));
      onSaved();
    } catch (error) {
      handleAxiosError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{group.title || t('table.noTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t('edit.kind')}</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-transparent px-2 text-sm dark:border-slate-700"
              value={kind}
              onChange={(e) => handleKindChange(e.target.value as ZaloGroupKind)}
            >
              {ZALO_GROUP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </select>
          </div>

          {kind === ZaloGroupKind.Seller && (
            <div>
              <Label>{t('edit.customer')}</Label>
              <Input
                className="mt-1"
                placeholder={t('edit.selectCustomer')}
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
              />
              <select
                className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-transparent px-2 text-sm dark:border-slate-700"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                size={1}
              >
                <option value="">{t('edit.clear')}</option>
                {filteredCustomers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.userSku || '(không mã)'} {c.fullName ? `— ${c.fullName}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">{t('edit.customerHint')}</p>

              <div className="mt-3 rounded-md border border-dashed border-slate-300 p-2 dark:border-slate-700">
                <Label className="text-xs">{t('edit.newCustomer')}</Label>
                <Input
                  className="mt-1 font-mono"
                  placeholder={t('edit.newCustomerPlaceholder')}
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value.toUpperCase())}
                  disabled={!!customerId}
                />
                <p className="mt-1 text-xs text-slate-500">{t('edit.newCustomerHint')}</p>
              </div>
            </div>
          )}

          <div>
            <Label>{t('edit.owner')}</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-transparent px-2 text-sm dark:border-slate-700"
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
            >
              <option value="">{t('edit.selectOwner')}</option>
              {users.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.fullName}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">{t('edit.ownerHint')}</p>
          </div>

          <div>
            <Label>{t('edit.note')}</Label>
            <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common:cancel', { defaultValue: 'Hủy' })}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {t('edit.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
