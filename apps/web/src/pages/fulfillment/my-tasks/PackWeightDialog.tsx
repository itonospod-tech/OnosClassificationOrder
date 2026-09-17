import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface PackWeightValue {
  weightGram?: number;
  dimensions?: { width?: number; height?: number; length?: number };
}

interface Props {
  open: boolean;
  /** Mã sản xuất của đơn đang đóng — để công nhân biết mình đang cân kiện nào. */
  productionId?: string;
  onCancel: () => void;
  /** Bấm "Bỏ qua" cũng gọi hàm này với object rỗng — đơn vẫn phải đóng xong. */
  onConfirm: (value: PackWeightValue) => void;
}

/**
 * Hỏi cân + số đo thực tế NGAY khi công nhân hoàn thành công đoạn Đóng hàng.
 *
 * **Tuỳ chọn, không chặn chuyền** (chốt nghiệp vụ 17/09/2026): trạm chưa có cân
 * điện tử vẫn phải đóng được hàng, nên nút "Bỏ qua" đóng đơn như thường và kiện
 * bị đánh dấu thiếu cân ở màn Bàn giao. Bắt buộc nhập là ngày triển khai đầu
 * tiên cả chuyền đứng.
 *
 * Số đo để trống hoàn toàn được — cân quy đổi chỉ tính khi có đủ ba chiều
 * (`canTinhCuoc`), thiếu một chiều thì coi như chưa đo chứ không tính bừa.
 */
export function PackWeightDialog({ open, productionId, onCancel, onConfirm }: Props) {
  const { t } = useTranslation('fulfillmentWorkflow');
  const [weight, setWeight] = useState('');
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [l, setL] = useState('');

  const so = (v: string): number | undefined => {
    const n = Number(v.trim());

    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const submit = () => {
    const dims = { width: so(w), height: so(h), length: so(l) };
    onConfirm({
      weightGram: so(weight),
      dimensions: dims.width || dims.height || dims.length ? dims : undefined,
    });
    setWeight('');
    setW('');
    setH('');
    setL('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('packWeight.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {productionId && <p className="text-sm text-muted-foreground font-mono">{productionId}</p>}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pack-weight">{t('packWeight.weight')}</Label>
            <Input
              id="pack-weight"
              inputMode="numeric"
              autoFocus
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={t('packWeight.weightPlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('packWeight.dimensions')}</Label>
            <div className="flex items-center gap-2">
              <Input inputMode="numeric" value={l} onChange={(e) => setL(e.target.value)} placeholder={t('packWeight.length')} />
              <span className="text-muted-foreground">×</span>
              <Input inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} placeholder={t('packWeight.width')} />
              <span className="text-muted-foreground">×</span>
              <Input inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} placeholder={t('packWeight.height')} />
            </div>
            <p className="text-xs text-muted-foreground">{t('packWeight.hint')}</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onConfirm({})}>
            {t('packWeight.skip')}
          </Button>
          <Button onClick={submit}>{t('packWeight.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
