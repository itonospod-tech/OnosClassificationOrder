import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { InventoryItem } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';

interface Line {
  sku: string;
  counted: string;
}

/**
 * Kiểm kê: nhập số ĐẾM THỰC TẾ — BE tự tính delta thành txn `adjust`
 * (đếm ra đúng số hệ thống thì không ghi sổ).
 */
export function AdjustDialog({
  open,
  factoryId,
  items,
  onClose,
  onSaved,
}: {
  open: boolean;
  factoryId: string;
  /** Tồn hiện tại để hiện tham chiếu cạnh ô nhập. */
  items: InventoryItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['inventory', 'common']);
  const [lines, setLines] = useState<Line[]>([{ sku: '', counted: '' }]);
  const [saving, setSaving] = useState(false);

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const currentOf = (sku: string) =>
    items.find((it) => it.sku === sku.trim().toUpperCase())?.quantity;

  const submit = async () => {
    const parsed = lines
      .filter((l) => l.sku.trim() || l.counted.trim())
      .map((l) => ({ sku: l.sku.trim().toUpperCase(), counted: Number(l.counted) }));
    if (parsed.length === 0 || parsed.some((l) => !l.sku || !Number.isInteger(l.counted) || l.counted < 0)) {
      toast.error(t('adjustDialog.invalid'));
      return;
    }
    try {
      setSaving(true);
      const res = await RepositoryRemote.inventory.adjust({ factoryId, lines: parsed });
      const data = res.data?.data as { applied: number; unchanged: number };
      toast.success(t('adjustDialog.done', data));
      setLines([{ sku: '', counted: '' }]);
      onSaved();
      onClose();
    } catch (err) {
      handleAxiosError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('adjustDialog.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('adjustDialog.hint')}</p>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {lines.map((line, idx) => {
            const current = currentOf(line.sku);
            return (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  className="w-48 font-mono"
                  placeholder={t('adjustDialog.sku')}
                  value={line.sku}
                  onChange={(e) => setLine(idx, { sku: e.target.value })}
                />
                <Input
                  className="w-32"
                  type="number"
                  min={0}
                  placeholder={t('adjustDialog.counted')}
                  value={line.counted}
                  onChange={(e) => setLine(idx, { counted: e.target.value })}
                />
                {current !== undefined && (
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {t('adjustDialog.current', { qty: current })}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  disabled={lines.length === 1}
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            );
          })}
        </div>
        <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { sku: '', counted: '' }])}>
          <Plus size={14} className="mr-1" />
          {t('receiptIn.addLine')}
        </Button>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} className="mr-2" />}
            {t('adjustDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
