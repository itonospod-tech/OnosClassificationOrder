'use client';

import dayjs from 'dayjs';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { FileText, Image as ImageIcon, PauseCircle, Truck, Wrench } from 'lucide-react';
import { CustomerOrderStatus } from 'shared/enums';
import type { AdminCustomerStagingOrder } from 'shared';
import { InternalStatus } from '@/components/hub/internal-status';
import { canBuyLabelRow } from '@/components/orders/order-row';
import { ViewAsButton } from '@/components/hub/view-as-button';
import { ProductLineBadge, StatusBadge } from '@/components/shared/badge';
import { SafeImage } from '@/components/shared/safe-image';
import { orderDisplayCode } from '@/lib/customer-orders';
import { driveThumbnailUrl } from '@/lib/label-preview';
import { fmtUSD } from '@/lib/utils';

interface OrderCardProps {
  order: Omit<AdminCustomerStagingOrder, 'customerId'> & { customerId?: string };
  adminMode?: boolean;
  /** Khu `/hub/orders` chỉ đọc: ẩn nút mạo danh. */
  showViewAs?: boolean;
  selected: boolean;
  onToggle: () => void;
  onPushOne: () => void;
  onCancel: () => void;
  /** Có callback + đơn đủ điều kiện → nút "Mua vận đơn" (chỉ portal seller). */
  onBuyLabel?: () => void;
}

/** Bản THẺ của `OrderRow` cho màn hình < md — cùng dữ liệu, không cuộn ngang. */
export function OrderCard({ order, adminMode = false, showViewAs = true, selected, onToggle, onPushOne, onCancel, onBuyLabel }: OrderCardProps) {
  const { t } = useTranslation(['customerPortal', 'seller', 'hub', 'track']);
  const isPending = order.status === CustomerOrderStatus.Pending;
  const code = orderDisplayCode(order);
  const first = order.items[0];
  const extra = order.items.length - 1;
  const thumb = first?.mockupUrl ? (driveThumbnailUrl(first.mockupUrl, 100) ?? first.mockupUrl) : null;
  const detailHref = !adminMode && first?.productionId ? `/portal/orders/${encodeURIComponent(first.productionId)}` : null;
  const tracked = order.items.find((i) => i.tracking?.number)?.tracking;
  const stage = first?.currentStageKey ? t(`track:progress.stages.${first.currentStageKey}`, { defaultValue: first.currentStageLabel ?? '' }) : first?.currentStageLabel;
  return (
    <div className={`bg-card border border-border1 rounded-xl p-3 space-y-2 ${order.status === CustomerOrderStatus.Cancelled ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        {!adminMode && isPending && <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1 accent-[var(--color-accent)]" />}
        <div className="min-w-0 flex-1">
          {detailHref ? (
            <Link href={detailHref} prefetch={false} className="font-mono text-sm font-bold text-accent">#{code}</Link>
          ) : (
            <span className="font-mono text-sm font-bold text-text-primary">#{code}</span>
          )}
          <p className="text-[10px] text-text-muted">
            {adminMode && order.customer?.userSku ? `${order.customer.userSku} · ` : ''}
            {t(`customerPortal:orders.source.${order.source}`)} · {dayjs(order.pushedAt ?? order.createdAt).format('DD/MM/YYYY HH:mm')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusBadge status={order.status} />
          {(order.held || order.rework) && (
            <span className="inline-flex gap-2 text-[10px] font-semibold">
              {order.held && <span className="inline-flex items-center gap-0.5 text-warning"><PauseCircle size={10} />{t('customerPortal:orders.badgeHold')}</span>}
              {order.rework && <span className="inline-flex items-center gap-0.5 text-warning"><Wrench size={10} />{t('customerPortal:orders.badgeRework')}</span>}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-start gap-2.5">
        <SafeImage src={thumb} alt="" className="w-12 h-12 rounded-md object-cover border border-border1 bg-surface-muted shrink-0" fallback={<div className="w-12 h-12 rounded-md border border-dashed border-border1 flex items-center justify-center text-text-muted shrink-0"><ImageIcon size={13} /></div>} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-text-primary truncate">{first?.type || first?.sku || '—'}</p>
          <p className="text-[10px] text-text-muted font-mono truncate">{[first?.sku, [first?.color, first?.size].filter(Boolean).join('/')].filter(Boolean).join(' · ')}{first?.quantity ? ` · ×${first.quantity}` : ''}</p>
          {extra > 0 && <p className="text-[10px] text-accent">{t('customerPortal:orders.moreItems', { count: extra })}</p>}
          {adminMode && order.note && <p className="text-[10px] text-text-secondary line-clamp-2 break-words">{order.note}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {(order.productLines ?? []).map((l) => <ProductLineBadge key={l} line={l} />)}
            {stage && !isPending && <span className="text-[10px] text-text-muted">{stage}</span>}
          </div>
        </div>
        {order.totalAmount != null && <span className="text-xs font-bold tabular-nums text-text-primary shrink-0">{fmtUSD(order.totalAmount)}</span>}
      </div>
      {adminMode && first?.internal && <div className="pt-1 border-t border-border2"><InternalStatus s={first.internal} compact /></div>}
      {tracked?.number && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border2 text-[11px]">
          {tracked.url ? (
            <a href={tracked.url} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline truncate">
              {tracked.number}
            </a>
          ) : (
            <span className="font-mono text-text-primary truncate">{tracked.number}</span>
          )}
          {tracked.labelUrl && (
            <a href={tracked.labelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 shrink-0 text-[10px] font-semibold text-accent hover:underline">
              <FileText size={10} /> {t('seller:buyLabel.labelLink')} ↗
            </a>
          )}
        </div>
      )}
      {((adminMode && showViewAs) || (!adminMode && isPending) || (!adminMode && !!onBuyLabel && canBuyLabelRow(order, tracked))) && (
        <div className="flex justify-end gap-1.5 pt-1 border-t border-border2">
          {adminMode && order.customerId && <ViewAsButton customerId={order.customerId} target={first?.productionId ? `/portal/orders/${encodeURIComponent(first.productionId)}` : '/portal/orders'} />}
          {!adminMode && onBuyLabel && canBuyLabelRow(order, tracked) && (
            <button type="button" onClick={onBuyLabel} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border1 text-[11px] font-semibold hover:border-accent hover:text-accent">
              <Truck size={11} /> {t('seller:buyLabel.button')}
            </button>
          )}
          {!adminMode && isPending && (
            <>
              <button type="button" onClick={onCancel} className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-error hover:bg-error-bg">{t('seller:detail.cancel')}</button>
              <button type="button" onClick={onPushOne} className="px-2.5 py-1.5 rounded-md text-[11px] font-bold bg-cta text-cta-foreground">{t('customerPortal:orders.pushOne')}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
