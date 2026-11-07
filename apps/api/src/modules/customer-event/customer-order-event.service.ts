import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { CustomerHoldKind, CustomerWebhookEvent } from 'shared';
import { HOLD_REASON_WAITING_ADDRESS, HOLD_REASON_WAITING_DESIGN } from 'shared';

import { CustomerNotificationService } from '@/modules/customer-notification/customer-notification.service';
// A plain function import, NOT a provider: the module comment explains why this service only imports leaf
// modules, and the cache file explains why it is file-scoped.
import { clearAdminOrderCache } from '@/modules/customer-portal/admin-order-cache';
import { CustomerOrderEntity } from '@/modules/customer-portal/customer-order.entity';
import type { WebhookOrderRef } from '@/modules/customer-webhook/customer-webhook.service';
import { CustomerWebhookService } from '@/modules/customer-webhook/customer-webhook.service';
import { OrderEntity } from '@/modules/order/order.entity';

/** 1 đơn sản xuất vừa đổi trạng thái — caller bóc từ OrderEntity/staging item. */
export interface CustomerOrderEventRef extends WebhookOrderRef {
  /** Lý do giữ NGUYÊN VĂN (nội bộ) — service tự quy về nhóm an toàn trước khi hiện cho khách. */
  holdReason?: string;
}

/**
 * NGUỒN SỰ KIỆN DUY NHẤT cho mọi thứ hướng ra khách khi đơn đổi trạng thái.
 *
 * Mọi call site (push ở customer-portal, hold/unhold/cancel ở order.service,
 * hoàn thành fulfillment ở fulfillment-task.service) chỉ gọi `emit()` — service
 * fan-out sang HAI kênh:
 *  - **Webhook** cho khách API (ORD-4) — bắn theo TỪNG ITEM (`productionId`),
 *    vì hệ thống của khách đối chiếu theo mã item.
 *  - **Thông báo chuông portal** (ORD-5) — gộp về MỨC ĐƠN để khách không bị
 *    dội: 1 lần push = 1 thông báo; "sản xuất xong" chỉ khi MỌI item xong;
 *    "tạm giữ" chỉ ở lần đầu đơn có item bị giữ; "chạy tiếp" khi hết item giữ.
 *    Riêng hủy báo theo item vì khách cần biết đích danh item nào (SRS BR).
 *
 * Toàn bộ fire-and-forget: `emit()` trả về ngay, lỗi nuốt tại chỗ kèm log.
 * Thao tác nghiệp vụ gốc KHÔNG bao giờ hỏng vì thông báo/webhook lỗi.
 */
@Injectable()
export class CustomerOrderEventService {
  constructor(
    private readonly customerWebhookService: CustomerWebhookService,
    private readonly customerNotificationService: CustomerNotificationService,
    @InjectModel(CustomerOrderEntity.name)
    private readonly customerOrderModel: Model<CustomerOrderEntity>,
    @InjectModel(OrderEntity.name)
    private readonly orderModel: Model<OrderEntity>,
  ) {}

  emit(event: CustomerWebhookEvent, orders: CustomerOrderEventRef[]): void {
    const valid = orders.filter((o) => o.productionId);
    if (valid.length === 0) return;

    // Every event that reaches here moves at least one order between the staff tabs (pushed → In Production,
    // production_completed → Fulfilled, held/unheld → the Held filter, cancelled → Cancelled). Those numbers are
    // cached 60 s, and before 10/10/2026 nothing cleared the cache on these writes, so the tab counts could
    // disagree with the list the operator was looking at for up to a minute. This is the one place all of them
    // pass through. Cheap (a Map.clear) and safe to call more than once.
    clearAdminOrderCache();

    // Kênh 1 — webhook cho khách API (service tự nuốt lỗi + chạy nền).
    this.customerWebhookService.emitForOrders(event, valid);

    // Kênh 2 — thông báo chuông portal, gộp mức đơn.
    void this.notify(event, valid).catch((err) => {
      console.warn(`[customer-event] noti ${event} lỗi: ${(err as Error).message}`);
    });
  }

  /** Nhóm lý do giữ an toàn để hiện cho khách — không phô nguyên văn ghi chú nội bộ. */
  private holdKindOf(reason?: string): CustomerHoldKind {
    if (reason === HOLD_REASON_WAITING_DESIGN) return 'waiting-design';
    if (reason === HOLD_REASON_WAITING_ADDRESS) return 'waiting-address';
    return 'other';
  }

  private async notify(event: CustomerWebhookEvent, refs: CustomerOrderEventRef[]): Promise<void> {
    const productionIds = refs.map((r) => r.productionId).filter((p): p is string => !!p);
    // CHỈ đơn có staging row mới sinh thông báo — đơn Luồng A (sync hệ cũ) chưa
    // lazy-sync thì không đủ dữ liệu mức đơn, thà im lặng còn hơn báo sai (SRS rủi ro).
    const stagingDocs = await this.customerOrderModel
      .find({ 'items.productionId': { $in: productionIds }, pushedAt: { $ne: null } })
      .select('customerId items pushedAt')
      .lean();
    if (stagingDocs.length === 0) return;

    for (const doc of stagingDocs) {
      const items = (doc.items ?? []) as Array<{ productionId?: string }>;
      const stagingId = String(doc._id);
      const customerId = String(doc.customerId);
      const orderCode = items.find((i) => i.productionId)?.productionId;
      const touched = items
        .map((i) => i.productionId)
        .filter((pid): pid is string => !!pid && productionIds.includes(pid));
      if (touched.length === 0) continue;

      if (event === 'order.pushed') {
        // Push nguyên đơn → đúng 1 thông báo dù đơn có bao nhiêu item.
        await this.customerNotificationService.createSystemNotification({
          customerId,
          event: 'order.pushed',
          data: { orderCode, stagingId },
        });
        continue;
      }

      if (event === 'order.cancelled') {
        // Hủy báo THEO ITEM — khách cần biết đích danh item nào (SRS BR).
        for (const productionId of touched) {
          await this.customerNotificationService.createSystemNotification({
            customerId,
            event: 'order.item_cancelled',
            data: { orderCode, productionId, stagingId },
          });
        }
        continue;
      }

      // 3 sự kiện còn lại cần trạng thái HIỆN TẠI của mọi item trong đơn.
      const allPids = items.map((i) => i.productionId).filter((p): p is string => !!p);
      const prodRows = await this.orderModel
        .find({ productionId: { $in: allPids } })
        .select('productionId heldAt cancelledAt fulfillmentCompletedAt')
        .lean<Array<{ productionId: string; heldAt?: Date; cancelledAt?: Date; fulfillmentCompletedAt?: Date }>>();
      const active = prodRows.filter((p) => !p.cancelledAt);
      if (active.length === 0) continue;

      if (event === 'order.production_completed') {
        // Chỉ báo khi MỌI item chưa hủy đều đã đóng hàng xong.
        if (!active.every((p) => p.fulfillmentCompletedAt)) continue;
        await this.customerNotificationService.createSystemNotification({
          customerId,
          event: 'order.production_completed',
          data: { orderCode, stagingId },
        });
        continue;
      }

      const heldCount = active.filter((p) => p.heldAt).length;
      if (event === 'order.held') {
        // Chỉ lần ĐẦU đơn có item bị giữ (0 → ≥1); giữ thêm item nữa không báo lại.
        if (heldCount !== 1) continue;
        await this.customerNotificationService.createSystemNotification({
          customerId,
          event: 'order.held',
          data: { orderCode, stagingId, holdKind: this.holdKindOf(refs.find((r) => r.holdReason)?.holdReason) },
        });
        continue;
      }

      if (event === 'order.unheld') {
        // Chỉ khi đơn hết sạch item bị giữ.
        if (heldCount > 0) continue;
        await this.customerNotificationService.createSystemNotification({
          customerId,
          event: 'order.unheld',
          data: { orderCode, stagingId },
        });
      }
    }
  }
}
