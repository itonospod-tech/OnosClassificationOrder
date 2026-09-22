import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { handleAxiosError } from '@/utils';

interface Line {
  sku: string;
  name: string;
  qty: string;
  note: string;
}

const EMPTY_LINE: Line = { sku: '', name: '', qty: '', note: '' };

/** Phiếu nhập kho nhiều dòng — SKU lạ được tạo item mới với tên đã điền. */
export function ReceiptInDialog({
  open,
  factoryId,
  onClose,
  onSaved,
}: {
  open: boolean;
  factoryId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['inventory', 'common']);
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  const setLine = (idx: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const submit = async () => {
    const parsed = lines
      .filter((l) => l.sku.trim() || l.qty.trim())
      .map((l) => ({
        sku: l.sku.trim().toUpperCase(),
        name: l.name.trim() || undefined,
        qty: Number(l.qty),
        note: l.note.trim() || undefined,
      }));
    if (parsed.length === 0 || parsed.some((l) => !l.sku || !Number.isInteger(l.qty) || l.qty <= 0)) {
      toast.error(t('receiptIn.invalid'));
      return;
    }
    try {
      setSaving(true);
      const res = await RepositoryRemote.inventory.createReceiptIn({ factoryId, lines: parsed });
      toast.success(t('receiptIn.created', { code: res.data?.data?.code }));
      setLines([{ ...EMPTY_LINE }]);
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('receiptIn.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('receiptIn.hint')}</p>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {lines.map((line, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                className="w-44 font-mono"
                placeholder={t('receiptIn.skuPlaceholder')}
                value={line.sku}
                onChange={(e) => setLine(idx, { sku: e.target.value })}
              />
              <Input
                className="flex-1"
                placeholder={t('receiptIn.name')}
                value={line.name}
                onChange={(e) => setLine(idx, { name: e.target.value })}
              />
              <Input
                className="w-24"
                type="number"
                min={1}
                placeholder={t('receiptIn.qty')}
                value={line.qty}
                onChange={(e) => setLine(idx, { qty: e.target.value })}
              />
              <Input
                className="w-36"
                placeholder={t('receiptIn.note')}
                value={line.note}
                onChange={(e) => setLine(idx, { note: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                disabled={lines.length === 1}
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}>
          <Plus size={14} className="mr-1" />
          {t('receiptIn.addLine')}
        </Button>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Spinner size={14} className="mr-2" />}
            {t('receiptIn.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
