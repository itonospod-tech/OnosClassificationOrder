import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Loader2, X } from 'lucide-react';
import type { OnospodIssue } from 'shared';
import { ONOSPOD_ISSUE_DESCRIPTION_MAX } from 'shared';
import { toast } from 'sonner';

import { RepositoryRemote } from '@/services';

import type { WorkshopOrderRow } from '@/components/orders/workshopTableConfig';
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
import { Textarea } from '@/components/ui/textarea';

import { handleAxiosError } from '@/utils';

interface Props {
  order: WorkshopOrderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Khớp giới hạn BE (`ONOSPOD_ISSUE_IMAGE_MAX_BYTES` ở onospod-issue.service.ts). */
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif)$/i;

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'secondary'> = {
  OPEN: 'warning',
  NEED_TO_CHECK: 'success',
};

/**
 * "Báo khách" (Orders.md §9f, CHỈ Admin) — gửi issue lỗi file sang OnosPod
 * y như nút "Send Issue" ở qc.onospod.com: ghi chú + 1 ảnh khoanh lỗi (dán
 * Ctrl+V hoặc chọn file). Hiện kèm các issue đã gửi cho đơn để tránh báo trùng;
 * gửi lỗi mạng thì nạp lại danh sách để người bấm tự xem trước khi gửi lại.
 */
export function ReportIssueDialog({ order, open, onOpenChange }: Props) {
  const { t, i18n } = useTranslation('orders');
  const [note, setNote] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [issues, setIssues] = useState<OnospodIssue[] | null>(null);
  const [issuesError, setIssuesError] = useState(false);

  const loadIssues = useCallback(async () => {
    if (!order) return;
    setIssues(null);
    setIssuesError(false);
    try {
      const res = await RepositoryRemote.order.getOnospodIssues(order._id);
      setIssues((res.data?.data as OnospodIssue[]) ?? []);
    } catch {
      setIssuesError(true);
    }
  }, [order]);

  useEffect(() => {
    if (open) void loadIssues();
  }, [open, loadIssues]);

  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const pickImage = (file: File | null | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.test(file.type)) {
      toast.error(t('dialogs.reportIssue.imageInvalid'));
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error(t('dialogs.reportIssue.imageTooLarge'));
      return;
    }
    setImage(file);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.items)
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    if (file) {
      e.preventDefault();
      pickImage(file);
    }
  };

  const reset = () => {
    setNote('');
    setImage(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const submit = async () => {
    if (!order || !note.trim()) return;
    const form = new FormData();
    form.append('description', note.trim());
    if (image) form.append('file', image, image.name || 'issue.png');
    try {
      setSending(true);
      await RepositoryRemote.order.createOnospodIssue(order._id, form);
      toast.success(t('dialogs.reportIssue.success'));
      close();
    } catch (err) {
      handleAxiosError(err);
      void loadIssues();
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="sm:max-w-lg" onPaste={onPaste}>
        <DialogHeader>
          <DialogTitle>{t('dialogs.reportIssue.title')}</DialogTitle>
          <DialogDescription>
            {order ? (
              <span className="text-xs">
                <span className="font-mono font-semibold text-foreground">{order.productionId}</span>
                {order.type ? ` · ${order.type}` : ''}
                {order.size ? ` · ${order.size}` : ''}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <p className="text-[11px] text-muted-foreground">{t('dialogs.reportIssue.hint')}</p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{t('dialogs.reportIssue.noteLabel')}</label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, ONOSPOD_ISSUE_DESCRIPTION_MAX))}
            placeholder={t('dialogs.reportIssue.notePlaceholder')}
            rows={3}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">{t('dialogs.reportIssue.imageLabel')}</label>
          {preview ? (
            <div className="relative inline-block">
              <img src={preview} alt="" className="max-h-48 rounded border border-border" />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-1 top-1 h-6 w-6"
                aria-label={t('dialogs.reportIssue.removeImage')}
                onClick={() => setImage(null)}
              >
                <X size={14} />
              </Button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border px-3 py-4 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground">
              <ImagePlus size={16} />
              <span>{t('dialogs.reportIssue.chooseImage')}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  pickImage(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          <p className="text-[10px] text-muted-foreground">{t('dialogs.reportIssue.imageHint')}</p>
        </div>

        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-xs font-medium text-foreground">{t('dialogs.reportIssue.existingTitle')}</p>
          {issuesError ? (
            <p className="text-[11px] text-rose-600">{t('dialogs.reportIssue.existingError')}</p>
          ) : issues === null ? (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> {t('dialogs.reportIssue.existingLoading')}
            </p>
          ) : issues.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t('dialogs.reportIssue.existingEmpty')}</p>
          ) : (
            <ul className="max-h-40 space-y-1.5 overflow-y-auto">
              {issues.map((issue) => (
                <li key={issue.id} className="flex items-start gap-2 text-[11px]">
                  <Badge variant={STATUS_VARIANT[issue.status] ?? 'secondary'} className="shrink-0 text-[10px]">
                    {t(`dialogs.reportIssue.status.${issue.status}`, { defaultValue: issue.status })}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words text-foreground">{issue.description}</span>
                  {issue.createdAt ? (
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(issue.createdAt).toLocaleString(i18n.language, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={sending}>
            {t('common:actions.close')}
          </Button>
          <Button onClick={submit} disabled={sending || !note.trim()}>
            {sending ? t('dialogs.reportIssue.sending') : t('dialogs.reportIssue.submitBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
