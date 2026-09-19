import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, PipelineStage } from 'mongoose';
import { Model } from 'mongoose';
import type {
  FulfillmentDailyColumnTotals,
  FulfillmentDailyRow,
  FulfillmentStageMetric,
  FulfillmentStages,
  FulfillmentStageState,
  FulfillmentTaskTab,
  FulfillmentTimelineEntry,
  ProductionOrder,
} from 'shared';
import {
  DesignerStatus,
  FactoryFlowType,
  FULFILLMENT_STAGE_ORDER,
  FULFILLMENT_STAGES,
  FulfillmentStage,
  FulfillmentStageStatus,
  FulfillmentTransitionAction,
  isAutoStage,
  redirectAutoTarget,
  RoleType,
} from 'shared';

import { productionFactoryClause } from '../../utils/excluded-factory';
import { getFactoryAutoPackSync, getFactoryFlowTypeSync } from '../../utils/merged-flow-factory';
import { CustomerOrderEventService } from '../customer-event/customer-order-event.service';
import { OrderDocument, OrderEntity } from '../order/order.entity';
import { OrderService } from '../order/order.service';
import type { AuditContext } from '../order-log/order-log.service';
import { OrderLogService } from '../order-log/order-log.service';
import { PackingService } from '../shipping-vnp/packing.service';
import { UserDocument, UserEntity } from '../user/user.entity';

/**
 * Role được phép override transition (bỏ qua check assignee). Bình thường
 * worker chỉ transition task của (factory, stage) đúng của mình.
 */
const OVERRIDE_ROLES: RoleType[] = [RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.SupportManager];

/** Match `order.service.ts:vnDayStart/End` — local VN ngày 00:00 / 23:59. */
function vnDayStart(yyyymmdd: string): Date {
  return new Date(yyyymmdd.slice(0, 10) + 'T00:00:00+07:00');
}
function vnDayEnd(yyyymmdd: string): Date {
  return new Date(yyyymmdd.slice(0, 10) + 'T23:59:59.999+07:00');
}
function vnTodayStart(): Date {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return vnDayStart(vnNow.toISOString().slice(0, 10));
}

/**
 * Merge tab-specific filter (có thể chứa `$or`) với base (chứa `$or` factory
 * scope). Object spread sẽ ghi đè $or → mất scope factory. Gom cả 2 $or qua
 * $and để Mongo eval (factory $or) AND (tab $or). Các field khác giữ nguyên.
 */
function mergeWithFactoryOr<T>(base: FilterQuery<T>, tabFilter: FilterQuery<T>): FilterQuery<T> {
  const baseOr = base.$or;
  const tabOr = tabFilter.$or;
  const merged: FilterQuery<T> = { ...base, ...tabFilter };
  if (baseOr && tabOr) {
    delete merged.$or;
    const existingAnd = merged.$and ?? [];
    merged.$and = [...existingAnd, { $or: baseOr }, { $or: tabOr }];
  }
  return merged;
}

/**
 * Fulfillment 5-stage state machine.
 *
 * - 1 user duy nhất per `(factoryId, fulfillmentStage)` (BE enforce unique index).
 * - Đơn tới stage X → user X của factory tự thấy ở `My Tasks` (filter
 *   `currentFulfillmentStage = X` && `factoryId = user.factoryId`).
 * - Action:
 *     `start`        : waiting/rework → in-progress (cộng dồn workMs khi complete).
 *     `complete`     : in-progress    → done; auto-advance stage tiếp (hoặc set
 *                       `fulfillmentCompletedAt` nếu stage = pack).
 *     `rework-back`  : in-progress    → waiting (reporter giữ assignee).
 *                       target='designer' → reuse designer rework flow (set
 *                         productionErrorSource='designer', designerStatus='rework').
 *                       target=<stage>   → target + intermediates → rework,
 *                         currentFulfillmentStage = target.
 *
 * Race-safe: `findOneAndUpdate` với filter check status hiện tại của stage.
 * Nếu conflict → 409.
 */
@Injectable()
export class FulfillmentTaskService {
  constructor(
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    @InjectModel(UserEntity.name) private readonly userModel: Model<UserEntity>,
    private readonly orderLogService: OrderLogService,
    private readonly orderService: OrderService,
    private readonly customerOrderEventService: CustomerOrderEventService,
    private readonly packingService: PackingService,
  ) {}

  // ─── Transition ─────────────────────────────────────────────────

  async transition(
    orderId: string,
    user: UserDocument,
    body: {
      stage: FulfillmentStage;
      action: FulfillmentTransitionAction;
      target?: 'designer' | FulfillmentStage;
      reason?: string;
      /** Cân + số đo thực tế, chỉ đi kèm lượt hoàn thành Đóng hàng (tuỳ chọn). */
      weightGram?: number;
      dimensions?: { width?: number; height?: number; length?: number };
    },
    ctx: AuditContext,
  ): Promise<OrderDocument> {
    let order = await this.orderModel.findById(orderId).lean();
    if (!order) throw new NotFoundException('Order not found');
    if (order.cancelledAt) {
      throw new BadRequestException('Đơn đã bị hủy — không thao tác được.');
    }
    if ((order as unknown as { heldAt?: Date | null }).heldAt) {
      throw new BadRequestException('Đơn đang bị giữ — mở lại (bỏ giữ) trước khi thao tác tiếp.');
    }

    // ── Self-heal "In": đơn đã `toolResultNote='ok'` (designer coi như xong)
    // nhưng `currentFulfillmentStage` lệch khỏi 'print' (null vì designer done
    // qua path không hook, hoặc set 'ok' tay) → khi In bấm "Bắt đầu", đưa
    // `currentFulfillmentStage` về 'print' để luồng start bên dưới chạy được.
    // GIỮ NGUYÊN status print nếu đã có (waiting/rework); chỉ init khi thiếu.
    // KHÔNG áp khi print đã 'done' (đơn đã in xong, đang ở stage sau) → không
    // kéo ngược đơn đã in.
    if (
      body.stage === FulfillmentStage.Print &&
      body.action === FulfillmentTransitionAction.Start &&
      order.toolResultNote === 'ok' &&
      order.currentFulfillmentStage !== FulfillmentStage.Print &&
      (order.fulfillmentStages?.print?.status ?? null) !== FulfillmentStageStatus.Done &&
      // Đơn đã đóng hàng xong (stage=null + fulfillmentCompletedAt) → KHÔNG hồi
      // sinh về print — tránh xưởng làm lại oan đơn đã hoàn thành.
      !(order as unknown as { fulfillmentCompletedAt?: Date | null }).fulfillmentCompletedAt
    ) {
      const cur = (order.fulfillmentStages?.print ?? {}) as FulfillmentStageState;
      const set: Record<string, unknown> = {
        readyForFulfill: true,
        currentFulfillmentStage: FulfillmentStage.Print,
      };
      if (!cur.status) {
        set['fulfillmentStages.print.status'] = FulfillmentStageStatus.Waiting;
        set['fulfillmentStages.print.waitingAt'] = new Date();
        set['fulfillmentStages.print.reworkCount'] = cur.reworkCount ?? 0;
        set['fulfillmentStages.print.workMs'] = cur.workMs ?? 0;
      }
      await this.orderModel.updateOne({ _id: orderId }, { $set: set });
      const reloaded = await this.orderModel.findById(orderId).lean();
      if (reloaded) order = reloaded;
    }

    const roleName = user.role?.name;
    const isOverride = roleName ? OVERRIDE_ROLES.includes(roleName) : false;

    // Worker constraint: stage tham số phải == user.fulfillmentStage và đơn
    // phải thuộc factory user. Override roles bypass.
    if (!isOverride) {
      if (roleName !== RoleType.Fulfillment) {
        throw new ForbiddenException(`Role ${roleName ?? 'unknown'} không có quyền transition fulfillment.`);
      }
      if (user.fulfillmentStage !== body.stage) {
        throw new ForbiddenException(
          `Bạn phụ trách stage '${user.fulfillmentStage}', không thao tác stage '${body.stage}'.`,
        );
      }
      if (!user.factoryId || String(order.factoryId) !== String(user.factoryId)) {
        throw new ForbiddenException('Đơn không thuộc factory của bạn.');
      }
      // Đơn phải đang ở stage này.
      if (order.currentFulfillmentStage !== body.stage) {
        throw new BadRequestException(
          `Đơn đang ở stage '${order.currentFulfillmentStage}', không phải '${body.stage}'.`,
        );
      }
    }

    const stages = (order.fulfillmentStages ?? {}) as FulfillmentStages;
    const stageState = stages[body.stage] ?? this.emptyState();
    const currentStatus = stageState.status ?? FulfillmentStageStatus.Waiting;

    // Xưởng luồng rút gọn: các auto-stage của flowType (merged: Ép/May ra —
    // no-sew: May vào/May ra) tự hoàn thành khi đơn chảy tới, rework-back nhắm
    // về auto-stage redirect lùi về công đoạn thường gần nhất phía trước.
    // `autoPack` — toggle riêng theo xưởng: Đóng hàng cũng tự hoàn thành.
    const factoryId = order.factoryId ? String(order.factoryId) : null;
    const flowType = getFactoryFlowTypeSync(this.orderModel.db, factoryId);
    const autoPack = getFactoryAutoPackSync(this.orderModel.db, factoryId);

    const plan = this.resolveTransition({
      stage: body.stage,
      action: body.action,
      currentStatus,
      stageState,
      target: body.target,
      reason: body.reason,
      stages,
      user,
      flowType,
      autoPack,
    });

    // Build atomic update — patch all stage state + timeline + top-level
    // currentFulfillmentStage / fulfillmentCompletedAt.
    const updated = await this.orderModel.findOneAndUpdate(
      {
        _id: orderId,
        [`fulfillmentStages.${body.stage}.status`]: currentStatus,
      },
      plan.patch,
      { new: true },
    );

    if (!updated) {
      throw new ConflictException('Trạng thái stage vừa thay đổi bởi người khác — refresh và thử lại.');
    }

    if (body.action === FulfillmentTransitionAction.ReworkBack) {
      // Đẩy về là thao tác riêng — ghi rõ công đoạn đích + lý do, thay vì 1
      // dòng đổi status trông giống hệt thay đổi trạng thái thường.
      void this.orderLogService.write({
        orderId,
        action: 'rework_back',
        field: String(plan.reworkTarget ?? body.target ?? ''),
        before: body.stage,
        after: body.reason,
        ctx: { ...ctx, user },
      });
    } else {
      void this.orderLogService.write({
        orderId,
        action: 'update',
        field: `fulfillmentStages.${body.stage}.status`,
        before: currentStatus,
        after: plan.nextStatus,
        ctx: { ...ctx, user },
      });
    }

    // Rework-back về designer trên đơn CHƯA ai ôm (soát 'ok' từ đầu → chưa từng
    // có designer) → auto-gán theo cấu hình xưởng, khỏi chờ leader phân/self-claim.
    // Engine tự lọc: đơn đã có assignee (rework về designer cũ) không bị đụng.
    if (body.action === FulfillmentTransitionAction.ReworkBack && body.target === 'designer') {
      void this.orderService.autoAssignAfterImport([orderId], { ...ctx, user });
    }

    // Đóng hàng xong (pack done → `fulfillmentCompletedAt` vừa được set) →
    // webhook `order.production_completed` cho khách API (ORD-4). Chỉ bắn ở
    // cạnh chuyển thật: đơn trước đó chưa có mốc hoàn thành.
    const wasCompleted = (order as unknown as { fulfillmentCompletedAt?: Date | null }).fulfillmentCompletedAt;
    const nowCompleted = (updated as unknown as { fulfillmentCompletedAt?: Date | null }).fulfillmentCompletedAt;
    if (!wasCompleted && nowCompleted) {
      // Kiện hàng (GAP-25/26/27): item vừa đóng xong được ghi vào kiện của đơn
      // — 1 kiện = 1 đơn seller. `void`: sổ kiện hỏng không được kéo theo lỗi
      // cho công nhân vừa đóng xong hàng, PackingService tự nuốt và ghi log.
      void this.packingService.ghiNhanDongGoi(
        {
          _id: String((updated as unknown as { _id: unknown })._id),
          productionId: (updated as unknown as { productionId?: string }).productionId,
          orderId: (updated as unknown as { orderId?: string }).orderId,
          factoryId: (updated as unknown as { factoryId?: string }).factoryId,
        },
        { _id: String(user._id), fullName: (user as unknown as { fullName?: string }).fullName },
      );
      if (body.weightGram || body.dimensions) {
        void this.packingService.capNhatCan(String((updated as unknown as { _id: unknown })._id), {
          weightGram: body.weightGram,
          dimensions: body.dimensions,
        });
      }

      this.customerOrderEventService.emit('order.production_completed', [
        {
          productionId: (updated as unknown as { productionId?: string }).productionId,
          userSku: (updated as unknown as { userSku?: string }).userSku,
          userEmail: (updated as unknown as { userEmail?: string }).userEmail,
        },
      ]);
    }

    return updated;
  }

  /**
   * Bulk transition N đơn trong 1 request (chọn cả cột ở kanban — trước đây FE
   * bắn N request song song, 400 đơn = 400-800 call → chạm rate limiter).
   * Loop `transition()` TỪNG đơn để giữ đủ business hook (timeline,
   * auto-advance luồng rút gọn, stock-out, webhook); concurrency giới hạn 5.
   * `start-complete`: start rồi complete — start fail (vd đơn vừa được start
   * chỗ khác) thì vẫn thử complete, kết quả do complete quyết định.
   */
  async bulkTransition(
    user: UserDocument,
    body: { stage: FulfillmentStage; action: 'start' | 'complete' | 'start-complete'; orderIds: string[] },
    ctx: AuditContext,
  ): Promise<{ ok: number; fail: number; failures: { orderId: string; message: string }[] }> {
    const ids = [...new Set(body.orderIds)];
    const failures: { orderId: string; message: string }[] = [];
    let ok = 0;

    const runOne = async (orderId: string): Promise<void> => {
      try {
        if (body.action === 'start-complete') {
          await this.transition(orderId, user, { stage: body.stage, action: FulfillmentTransitionAction.Start }, ctx).catch(
            () => undefined,
          );
          await this.transition(orderId, user, { stage: body.stage, action: FulfillmentTransitionAction.Complete }, ctx);
        } else {
          const action =
            body.action === 'start' ? FulfillmentTransitionAction.Start : FulfillmentTransitionAction.Complete;
          await this.transition(orderId, user, { stage: body.stage, action }, ctx);
        }
        ok += 1;
      } catch (err) {
        failures.push({ orderId, message: err instanceof Error ? err.message : String(err) });
      }
    };

    const CONCURRENCY = 5;
    const queue = [...ids];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          await runOne(id);
        }
      }),
    );

    return { ok, fail: failures.length, failures };
  }

  /**
   * Hoàn thành TOÀN BỘ đơn đang tồn ở công đoạn ĐÓNG HÀNG của 1 xưởng — nút
   * "Hoàn thành đơn tồn" đi kèm toggle `autoCompletePack` (toggle chỉ áp đơn
   * MỚI chảy tới; đơn tồn cũ dọn 1 lần bằng nút này). Đi qua `bulkTransition`
   * → `transition()` từng đơn nên giữ đủ hook (timeline, guard đơn giữ/hủy —
   * đơn held fail riêng nó với message rõ, không chặn cả lô).
   */
  async completePackBacklog(
    user: UserDocument,
    factoryId: string,
    ctx: AuditContext,
  ): Promise<{ total: number; ok: number; fail: number; failures: { orderId: string; message: string }[] }> {
    const docs = await this.orderModel
      .find({
        factoryId,
        cancelledAt: null,
        currentFulfillmentStage: FulfillmentStage.Pack,
        'fulfillmentStages.pack.status': {
          $in: [FulfillmentStageStatus.Waiting, FulfillmentStageStatus.Rework, FulfillmentStageStatus.InProgress],
        },
      })
      .select('_id')
      .lean();
    const ids = docs.map((d) => String(d._id));
    if (ids.length === 0) return { total: 0, ok: 0, fail: 0, failures: [] };
    const result = await this.bulkTransition(
      user,
      { stage: FulfillmentStage.Pack, action: 'start-complete', orderIds: ids },
      ctx,
    );
    return { total: ids.length, ...result };
  }

  /**
   * Quyết định patch + next status cho 1 transition. Trả `patch` để feed
   * thẳng vào `findOneAndUpdate`.
   */
  private resolveTransition(input: {
    stage: FulfillmentStage;
    action: FulfillmentTransitionAction;
    currentStatus: FulfillmentStageStatus;
    stageState: FulfillmentStageState;
    target?: 'designer' | FulfillmentStage;
    reason?: string;
    stages: FulfillmentStages;
    user: UserDocument;
    /** Luồng của xưởng (`FactoryEntity.flowType`) — quyết định auto-stage. */
    flowType?: FactoryFlowType;
    /** Toggle riêng theo xưởng (`FactoryEntity.autoCompletePack`): Đóng hàng cũng auto. */
    autoPack?: boolean;
  }): {
    nextStatus: FulfillmentStageStatus;
    patch: Record<string, unknown>;
    /** Đích THỰC SỰ của rework-back (auto-stage đã redirect lùi) — dùng cho nhật ký. */
    reworkTarget?: string;
  } {
    const now = new Date();
    const { stage, action, currentStatus, stageState, target, reason, stages, user } = input;
    const flowType = input.flowType ?? FactoryFlowType.Standard;
    const autoPack = input.autoPack ?? false;
    const userId = String(user._id);
    const userName = user.fullName;

    const timelineEntry = (
      toStatus: FulfillmentStageStatus,
      extra: Partial<FulfillmentTimelineEntry> = {},
    ): FulfillmentTimelineEntry => ({
      stage,
      action,
      fromStatus: currentStatus,
      toStatus,
      byUserId: userId,
      byUserName: userName,
      at: now,
      ...extra,
    });

    switch (action) {
      case FulfillmentTransitionAction.Start: {
        if (currentStatus !== FulfillmentStageStatus.Waiting && currentStatus !== FulfillmentStageStatus.Rework) {
          throw new BadRequestException(`Action 'start' chỉ hợp lệ từ 'waiting'/'rework' (current=${currentStatus}).`);
        }
        const set: Record<string, unknown> = {
          [`fulfillmentStages.${stage}.status`]: FulfillmentStageStatus.InProgress,
          [`fulfillmentStages.${stage}.assignee`]: userId,
          [`fulfillmentStages.${stage}.assignedAt`]: stageState.assignedAt ?? now,
          [`fulfillmentStages.${stage}.startedAt`]: now,
        };
        if (!stageState.firstStartedAt) {
          set[`fulfillmentStages.${stage}.firstStartedAt`] = now;
        }
        return {
          nextStatus: FulfillmentStageStatus.InProgress,
          patch: {
            $set: set,
            $push: { fulfillmentTimeline: timelineEntry(FulfillmentStageStatus.InProgress) },
          },
        };
      }

      case FulfillmentTransitionAction.Complete: {
        if (currentStatus !== FulfillmentStageStatus.InProgress) {
          throw new BadRequestException(`Action 'complete' chỉ hợp lệ từ 'in-progress' (current=${currentStatus}).`);
        }
        const delta = stageState.startedAt ? Math.max(0, now.getTime() - new Date(stageState.startedAt).getTime()) : 0;
        const set: Record<string, unknown> = {
          [`fulfillmentStages.${stage}.status`]: FulfillmentStageStatus.Done,
          [`fulfillmentStages.${stage}.completedAt`]: now,
        };
        const inc: Record<string, number> = {};
        if (delta > 0) inc[`fulfillmentStages.${stage}.workMs`] = delta;

        const timelineEntries: FulfillmentTimelineEntry[] = [timelineEntry(FulfillmentStageStatus.Done)];

        // Auto-advance: stage tiếp theo (nếu có). Set waiting bất kể đã từng
        // done hay chưa — workMs giữ nguyên cumulative cho stage đó. `waitingAt`
        // reset mỗi cycle (rework-back về lại stage này sẽ overwrite) — FE
        // hiển thị "Nhận task lúc..." cho user trong tab Đang chờ.
        let nextStage = this.nextStage(stage);

        // Luồng rút gọn: chừng nào stage kế còn là AUTO-STAGE của flow
        // (merged: In→Ép, May vào→May ra — no-sew: QC→May vào→May ra) thì tự
        // hoàn thành nó cùng thời điểm rồi nhảy tiếp, đơn dừng ở stage thường
        // đầu tiên. Ghi ĐỦ timestamp (waitingAt/startedAt/firstStartedAt/
        // completedAt = now) để mọi phép tính duration ra 0 thay vì NaN;
        // người thực hiện = worker stage vừa xong; workMs = 0.
        while (nextStage && isAutoStage(flowType, nextStage, autoPack)) {
          const merged = nextStage;
          const mergedState = stages[merged];
          set[`fulfillmentStages.${merged}.status`] = FulfillmentStageStatus.Done;
          set[`fulfillmentStages.${merged}.assignee`] = userId;
          set[`fulfillmentStages.${merged}.assignedAt`] = now;
          set[`fulfillmentStages.${merged}.waitingAt`] = now;
          set[`fulfillmentStages.${merged}.startedAt`] = now;
          set[`fulfillmentStages.${merged}.completedAt`] = now;
          if (!mergedState?.firstStartedAt) {
            set[`fulfillmentStages.${merged}.firstStartedAt`] = now;
          }
          if (mergedState?.completedAt) {
            // Vòng rework (đơn bị lùi về trước đó chạy lại): đánh dấu "làm lại"
            // như auto-advance thường.
            set[`fulfillmentStages.${merged}.reworkAt`] = now;
            inc[`fulfillmentStages.${merged}.reworkCount`] = (inc[`fulfillmentStages.${merged}.reworkCount`] ?? 0) + 1;
          } else if (!mergedState?.status) {
            // State chưa từng init (đơn legacy) → set đủ counter mặc định.
            set[`fulfillmentStages.${merged}.reworkCount`] = 0;
            set[`fulfillmentStages.${merged}.workMs`] = 0;
          }
          timelineEntries.push(
            timelineEntry(FulfillmentStageStatus.Done, {
              stage: merged,
              fromStatus: mergedState?.status ?? FulfillmentStageStatus.Waiting,
              // Phân biệt nguồn auto trong timeline: flow rút gọn vs toggle
              // "tự xong Đóng hàng" của xưởng.
              reason: isAutoStage(flowType, merged)
                ? 'Tự động hoàn thành (luồng rút gọn)'
                : 'Tự động hoàn thành (xưởng bật tự xong Đóng hàng)',
            }),
          );
          nextStage = this.nextStage(merged);
        }

        if (nextStage) {
          set.currentFulfillmentStage = nextStage;
          set[`fulfillmentStages.${nextStage}.status`] = FulfillmentStageStatus.Waiting;
          set[`fulfillmentStages.${nextStage}.waitingAt`] = now;
          // Nếu stage kế TỪNG hoàn thành (đơn đang chạy lại vòng mới do bị đẩy
          // lùi phía trên) → đây là "làm lại" → reworkCount++ + reworkAt để khi
          // hoàn thành lại đơn vào cột "Đã sửa". Flow xuôi bình thường: stage kế
          // chưa từng done → không tăng.
          const nextState = stages[nextStage];
          if (nextState?.completedAt) {
            set[`fulfillmentStages.${nextStage}.reworkAt`] = now;
            inc[`fulfillmentStages.${nextStage}.reworkCount`] =
              (inc[`fulfillmentStages.${nextStage}.reworkCount`] ?? 0) + 1;
          }
        } else {
          // pack done → flow xong toàn bộ.
          set.currentFulfillmentStage = null;
          set.fulfillmentCompletedAt = now;
        }

        return {
          nextStatus: FulfillmentStageStatus.Done,
          patch: {
            $set: set,
            ...(Object.keys(inc).length > 0 ? { $inc: inc } : {}),
            $push: { fulfillmentTimeline: { $each: timelineEntries } },
          },
        };
      }

      case FulfillmentTransitionAction.ReworkBack: {
        // Cho phép báo lỗi từ waiting / in-progress / rework (không bắt buộc
        // phải Bắt đầu trước). Từ waiting/rework: coi như chưa tính workMs
        // (startedAt chưa có → delta 0). 'done' không báo lỗi được (đã rời stage).
        if (
          currentStatus !== FulfillmentStageStatus.InProgress &&
          currentStatus !== FulfillmentStageStatus.Waiting &&
          currentStatus !== FulfillmentStageStatus.Rework
        ) {
          throw new BadRequestException(`Action 'rework-back' không hợp lệ từ trạng thái '${currentStatus}'.`);
        }
        if (!target) throw new BadRequestException('Field `target` bắt buộc khi rework-back.');
        if (!reason || !reason.trim()) {
          throw new BadRequestException('Field `reason` bắt buộc khi rework-back.');
        }

        // Reporter (this stage) → waiting (giữ assignee). Cộng workMs delta.
        const reporterDelta = stageState.startedAt
          ? Math.max(0, now.getTime() - new Date(stageState.startedAt).getTime())
          : 0;
        const set: Record<string, unknown> = {
          [`fulfillmentStages.${stage}.status`]: FulfillmentStageStatus.Waiting,
          [`fulfillmentStages.${stage}.reworkCount`]: (stageState.reworkCount ?? 0) + 1,
        };
        const inc: Record<string, number> = {};
        if (reporterDelta > 0) inc[`fulfillmentStages.${stage}.workMs`] = reporterDelta;

        if (target === 'designer') {
          // Đẩy về designer: reuse designer rework. Set productionError +
          // designerStatus = rework. Đơn rời khỏi flow fulfillment tạm thời.
          // currentFulfillmentStage giữ nguyên (= reporter stage); khi designer
          // complete xong, đơn quay lại đúng stage này. Worker thấy ở tab
          // "Đợi quay lại" (distinguish bằng `designerStatus === 'rework'`).
          set.designerStatus = 'rework';
          set.designerReworkAt = now;
          set.productionErrorSource = 'designer';
          set.productionErrorNote = reason;
          set.readyForFulfill = false;
          return {
            nextStatus: FulfillmentStageStatus.Waiting,
            reworkTarget: 'designer',
            patch: {
              $set: set,
              $inc: { ...inc, designerReworkCount: 1 },
              $push: {
                fulfillmentTimeline: timelineEntry(FulfillmentStageStatus.Waiting, {
                  reworkTarget: 'designer',
                  reason,
                }),
              },
            },
          };
        }

        // Xưởng luồng rút gọn: đích là AUTO-STAGE → redirect lùi về công đoạn
        // thường gần nhất phía trước — đơn không bao giờ dừng ở auto-stage,
        // lùi về đó sẽ kẹt vì xưởng không có worker giữ stage.
        const resolvedTarget = redirectAutoTarget(flowType, target, autoPack);

        // Target = FulfillmentStage → must be index < current.
        const reporterIdx = FULFILLMENT_STAGE_ORDER[stage];
        const targetIdx = FULFILLMENT_STAGE_ORDER[resolvedTarget];
        if (targetIdx >= reporterIdx) {
          throw new BadRequestException(`Target stage '${resolvedTarget}' không trước stage hiện tại '${stage}'.`);
        }

        // Chỉ target → rework (đơn về đó NGAY, chờ Bắt đầu). Các stage trung gian
        // (giữa target và reporter) GIỮ nguyên `done` + `completedAt` (lịch sử) —
        // tab-filter positional cho chúng vào "Đang chờ quay lại" khi đơn đang
        // upstream, và auto-advance sẽ reworkCount++ khi đơn thực sự quay về từng
        // stage. Tránh đánh dấu rework sớm (đơn chưa tới nơi) + double-count.
        set.currentFulfillmentStage = resolvedTarget;
        set[`fulfillmentStages.${resolvedTarget}.status`] = FulfillmentStageStatus.Rework;
        set[`fulfillmentStages.${resolvedTarget}.reworkAt`] = now;
        set[`fulfillmentStages.${resolvedTarget}.reworkFromStage`] = stage;
        set[`fulfillmentStages.${resolvedTarget}.reworkReason`] = reason;
        const targetState = stages[resolvedTarget] ?? this.emptyState();
        set[`fulfillmentStages.${resolvedTarget}.reworkCount`] = (targetState.reworkCount ?? 0) + 1;

        return {
          nextStatus: FulfillmentStageStatus.Waiting,
          reworkTarget: resolvedTarget,
          patch: {
            $set: set,
            ...(Object.keys(inc).length > 0 ? { $inc: inc } : {}),
            $push: {
              fulfillmentTimeline: timelineEntry(FulfillmentStageStatus.Waiting, {
                reworkTarget: resolvedTarget,
                reason,
              }),
            },
          },
        };
      }

      default:
        throw new BadRequestException(`Action không hỗ trợ: ${action}`);
    }
  }

  private nextStage(stage: FulfillmentStage): FulfillmentStage | null {
    const idx = FULFILLMENT_STAGE_ORDER[stage];
    if (idx >= FULFILLMENT_STAGES.length - 1) return null;
    return FULFILLMENT_STAGES[idx + 1] ?? null;
  }

  private emptyState(): FulfillmentStageState {
    return {
      status: FulfillmentStageStatus.Waiting,
      reworkCount: 0,
      workMs: 0,
    };
  }

  // ─── My Tasks (worker view) ─────────────────────────────────────

  /**
   * 4 tab:
   *   waiting     — đơn ở stage tôi, status=waiting, designerStatus != rework
   *   in-progress — status=in-progress
   *   rework      — status=rework
   *   watching    — đơn tôi đã rework-back về designer/stage trước; chưa quay lại
   *                  (currentFulfillmentStage != stage tôi HOẶC designerStatus=rework)
   */
  async getMyTasks(
    user: UserDocument,
    query: {
      tab?: FulfillmentTaskTab;
      stage?: FulfillmentStage;
      factoryId?: string;
      page?: number;
      size?: number;
      /** YYYY-MM-DD VN local. Empty string = explicit clear → all-time. */
      createdFrom?: string;
      createdTo?: string;
    },
  ): Promise<{
    data: ProductionOrder[];
    total: number;
    page: number;
    size: number;
    tabCounts: { waiting: number; inProgress: number; rework: number; done: number; watching: number };
  }> {
    const roleName = user.role?.name;
    const isOverride = roleName ? OVERRIDE_ROLES.includes(roleName) : false;

    const tab: FulfillmentTaskTab = query.tab ?? 'waiting';
    // `unassigned` tab — đơn chưa được gán Designer. Chỉ admin/manager
    // được phép xem để gán; worker không có quyền action này.
    if (tab === 'unassigned' && !isOverride) {
      throw new ForbiddenException('Bạn không có quyền xem đơn chưa gán.');
    }

    // Stage check — `unassigned` không phụ thuộc stage (đơn chưa có stage),
    // dùng dummy 'print' cho applyTabFilter (param unused trong case này).
    // Admin/manager không có fulfillmentStage → cho phép bỏ qua. Worker tabs
    // bắt buộc có stage để biết kanban col.
    const stage = query.stage ?? user.fulfillmentStage ?? FulfillmentStage.Print;
    if (!query.stage && !user.fulfillmentStage && tab !== 'unassigned' && !isOverride) {
      throw new BadRequestException('Thiếu stage (user chưa gán fulfillmentStage).');
    }
    const factoryId = query.factoryId ?? user.factoryId;
    if (!factoryId && !isOverride) {
      throw new BadRequestException('Thiếu factoryId (user chưa gán factoryId).');
    }
    const page = query.page && query.page > 0 ? query.page : 1;
    const size = query.size && query.size > 0 ? Math.min(query.size, 5000) : 50;

    const baseFilter = this.buildMyTaskBase(stage, factoryId, {
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    });
    const filter = this.applyTabFilter(baseFilter, tab, stage, String(user._id));

    const [data, total, tabCounts] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ priority: -1, orderAt: -1, inProductionAt: -1 })
        .skip((page - 1) * size)
        .limit(size)
        .lean(),
      this.orderModel.countDocuments(filter),
      this.countAllTabs(baseFilter, stage, String(user._id), isOverride),
    ]);

    return {
      data: data as unknown as ProductionOrder[],
      total,
      page,
      size,
      tabCounts,
    };
  }

  /**
   * Base filter cho My Tasks — MATCH SCOPE với `OrderFactoryTab` (factory tab
   * trên dashboard) để 2 page trả cùng tập đơn:
   *   - Factory scope: `factoryId == mine` HOẶC `originalFactoryId == mine`
   *     (gồm cả đơn đã transfer đi từ xưởng tôi). Override role không có
   *     factoryId → bỏ qua factory filter.
   *   - Date range: default 7 ngày gần nhất trên `inProductionAt` (giống
   *     `order.service.ts:buildVisibilityFilter` cho role Fulfillment). User
   *     truyền `createdFrom`/`createdTo` rỗng = explicit clear → all-time.
   *   - LOẠI đơn hủy (`cancelledAt: null`) — đơn hủy phải biến mất khỏi mọi
   *     hàng chờ/đang làm của công đoạn, kể cả khi bị hủy giữa chừng.
   *
   * `stage` không dùng ở đây (lọc per-tab bởi `applyTabFilter`) — giữ param
   * cho signature consistency.
   */
  private buildMyTaskBase(
    stage: FulfillmentStage,
    factoryId?: string,
    dateRange?: { createdFrom?: string; createdTo?: string },
  ): FilterQuery<OrderEntity> {
    void stage;
    const f: FilterQuery<OrderEntity> = { cancelledAt: null };
    if (factoryId) {
      f.$or = [{ factoryId }, { originalFactoryId: factoryId }];
    } else {
      // Override role (admin/manager) xem không khoá xưởng — vẫn loại đơn
      // chưa map xưởng + đơn xưởng US (ngoài luồng sản xuất).
      f.factoryId = productionFactoryClause(this.orderModel.db);
    }
    // Date logic: nếu user truyền cả 2 đều undefined → default 7 ngày. Nếu
    // truyền (kể cả empty string) → coi là explicit override / clear.
    const hasFrom = dateRange?.createdFrom !== undefined;
    const hasTo = dateRange?.createdTo !== undefined;
    if (!hasFrom && !hasTo) {
      const todayStart = vnTodayStart();
      const endOfToday = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      const startOfWindow = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
      f.inProductionAt = { $gte: startOfWindow, $lte: endOfToday };
    } else {
      const range: Record<string, Date> = {};
      if (dateRange?.createdFrom) range.$gte = vnDayStart(dateRange.createdFrom);
      if (dateRange?.createdTo) range.$lte = vnDayEnd(dateRange.createdTo);
      if (Object.keys(range).length > 0) f.inProductionAt = range;
      // Nếu cả 2 là empty string → no inProductionAt filter = all-time.
    }
    return f;
  }

  /**
   * Các clause "đơn đang ở phía TRƯỚC (upstream) fulfillment-stage `stg`" — dùng
   * cho positional tab filter (watching/done/fixed). Đơn upstream khi:
   *  - đang giữ ở tool-check (marker In báo thiếu file),
   *  - designer đang làm lại (`designerStatus='rework'`),
   *  - hoặc đang ở 1 stage fulfillment TRƯỚC `stg`.
   * ⚠️ Mirror với `OrderService.upstreamOfStageClauses` (bảng In).
   */
  private upstreamClauses(stg: FulfillmentStage): Record<string, unknown>[] {
    const fi = FULFILLMENT_STAGE_ORDER[stg];
    return [
      { productionErrorSource: 'tool-check', toolResultNote: 'error' },
      { designerStatus: 'rework' },
      { currentFulfillmentStage: { $in: FULFILLMENT_STAGES.slice(0, fi) } },
    ];
  }

  private applyTabFilter(
    base: FilterQuery<OrderEntity>,
    tab: FulfillmentTaskTab,
    stage: FulfillmentStage,
    userId: string,
  ): FilterQuery<OrderEntity> {
    switch (tab) {
      case 'waiting':
        // `readyForFulfill: true` đảm bảo không lộ orphan ngược (đơn từng vào
        // pipeline rồi toolResultNote toggle khỏi 'ok' → readyForFulfill=false
        // nhưng stage chưa clear). Match scope với FactoryOverview.
        return {
          ...base,
          readyForFulfill: true,
          currentFulfillmentStage: stage,
          [`fulfillmentStages.${stage}.status`]: FulfillmentStageStatus.Waiting,
          designerStatus: { $ne: 'rework' },
        };
      case 'in-progress':
        return {
          ...base,
          readyForFulfill: true,
          currentFulfillmentStage: stage,
          [`fulfillmentStages.${stage}.status`]: FulfillmentStageStatus.InProgress,
        };
      case 'rework':
        return {
          ...base,
          readyForFulfill: true,
          currentFulfillmentStage: stage,
          [`fulfillmentStages.${stage}.status`]: FulfillmentStageStatus.Rework,
        };
      case 'done':
        // "Đã xong" (positional) = đã hoàn thành stage này (có completedAt),
        // KHÔNG dính lỗi (reworkCount 0/thiếu), VÀ đơn đang ở phía SAU mình
        // (downstream) — tức KHÔNG upstream & không đang ở stage này. Đơn bị đẩy
        // lùi phía trên (upstream) chuyển sang tab "Đang chờ quay lại".
        // Merge $or qua $and vì base có $or factory scope (factoryId OR
        // originalFactoryId) — spread sẽ overwrite mất, dẫn đến lộ data xưởng khác.
        return mergeWithFactoryOr(base, {
          readyForFulfill: true,
          [`fulfillmentStages.${stage}.completedAt`]: { $exists: true, $ne: null },
          [`fulfillmentStages.${stage}.reworkCount`]: { $in: [0, null] },
          $nor: [...this.upstreamClauses(stage), { currentFulfillmentStage: stage }],
        });
      case 'fixed':
        // "Đã sửa" = hoàn thành stage này SAU KHI từng bị đẩy về (reworkCount>0),
        // đơn đang ở phía sau (downstream). Cùng điều kiện 'done' nhưng reworkCount>0.
        return mergeWithFactoryOr(base, {
          readyForFulfill: true,
          [`fulfillmentStages.${stage}.completedAt`]: { $exists: true, $ne: null },
          [`fulfillmentStages.${stage}.reworkCount`]: { $gt: 0 },
          $nor: [...this.upstreamClauses(stage), { currentFulfillmentStage: stage }],
        });
      case 'watching': {
        // "Đang chờ quay lại" (positional) = mình ĐÃ làm stage này (có completedAt)
        // HOẶC chính mình báo lỗi (reporter timeline) — VÀ đơn đang ở phía TRƯỚC
        // mình (upstream: tool-check hold / designer rework / stage fulfillment
        // trước). Stage-scoped (KHÔNG lọc byUserId): mọi người giữ công đoạn này
        // trong xưởng đều thấy.
        //
        // Điểm khác luật cũ: trước chỉ khớp khi CHÍNH stage này là người báo lỗi
        // (timeline stage=mine). Nay bất kỳ công đoạn đã-xong nào bị đơn đẩy lùi
        // qua đầu đều vào watching (kể cả khi công đoạn KHÁC báo lỗi).
        void userId;
        return mergeWithFactoryOr(base, {
          $and: [
            {
              $or: [
                { [`fulfillmentStages.${stage}.completedAt`]: { $exists: true, $ne: null } },
                {
                  fulfillmentTimeline: {
                    $elemMatch: { stage, action: FulfillmentTransitionAction.ReworkBack },
                  },
                },
              ],
            },
            { $or: this.upstreamClauses(stage) },
          ],
        });
      }
      case 'unassigned':
        // Đơn đã ready (toolResultNote='ok') nhưng CHƯA vào fulfillment
        // pipeline (currentFulfillmentStage null) — đơn skip Designer hoặc
        // pending Designer assignment. Chỉ Admin/Manager thấy → admin gán
        // designer qua bulk-assign-designer → đơn theo flow chuẩn.
        // KHÔNG filter theo stage vì đơn chưa có stage.
        return mergeWithFactoryOr(base, {
          readyForFulfill: true,
          currentFulfillmentStage: { $in: [null, undefined] },
        });
      default:
        return base;
    }
  }

  private async countAllTabs(
    base: FilterQuery<OrderEntity>,
    stage: FulfillmentStage,
    userId: string,
    isOverride: boolean,
  ): Promise<{
    waiting: number;
    inProgress: number;
    rework: number;
    done: number;
    fixed: number;
    watching: number;
    unassigned: number;
  }> {
    const [waiting, inProgress, rework, done, fixed, watching, unassigned] = await Promise.all([
      this.orderModel.countDocuments(this.applyTabFilter(base, 'waiting', stage, userId)),
      this.orderModel.countDocuments(this.applyTabFilter(base, 'in-progress', stage, userId)),
      this.orderModel.countDocuments(this.applyTabFilter(base, 'rework', stage, userId)),
      this.orderModel.countDocuments(this.applyTabFilter(base, 'done', stage, userId)),
      this.orderModel.countDocuments(this.applyTabFilter(base, 'fixed', stage, userId)),
      this.orderModel.countDocuments(this.applyTabFilter(base, 'watching', stage, userId)),
      // Workers không nhìn thấy số unassigned → tiết kiệm 1 countDocuments.
      isOverride
        ? this.orderModel.countDocuments(this.applyTabFilter(base, 'unassigned', stage, userId))
        : Promise.resolve(0),
    ]);
    return { waiting, inProgress, rework, done, fixed, watching, unassigned };
  }

  /**
   * Bảng tổng quan theo ngày (trang Task Fulfillment) — FULL luồng tất cả khâu.
   * Gom MỌI đơn theo `inProductionAt` (VN) trong xưởng user (gồm originalFactoryId)
   * → cùng trục ngày với bảng Designer/Soát tool, dễ đối chiếu + biết ưu tiên.
   *
   * Mỗi ngày bung ra: tổng đơn · soát tool (đã/chưa) · tool ok · designer
   * (nhận/xong) · và với CẢ 7 stage fulfillment metric {arrived,done,remaining,
   * rework}. FE dùng `query.stage` (= user.fulfillmentStage) chỉ để highlight +
   * bung 4 hàng cho stage đó — BE trả đủ mọi khâu bất kể stage.
   */
  async getDailyOverview(
    user: UserDocument,
    query: { days: number; from?: string; to?: string; stage?: FulfillmentStage },
  ): Promise<{
    days: FulfillmentDailyRow[];
    columnTotals: FulfillmentDailyColumnTotals;
    rangeDays: number;
  }> {
    const { start, end, days } = this.resolveDayWindow(query.days, query.from, query.to);
    const factoryId = user.factoryId;

    const match: FilterQuery<OrderEntity> = {
      inProductionAt: { $gte: start, $lte: end },
      deletedAt: null,
      cancelledAt: null,
    };
    if (factoryId) match.$or = [{ factoryId }, { originalFactoryId: factoryId }];

    const dayExpr = {
      $dateToString: { format: '%Y-%m-%d', date: '$inProductionAt', timezone: '+07:00' },
    };
    // Đã soát = toolResultNote có nội dung (≠ null và ≠ ''); chưa soát = ngược lại.
    const reviewedCond = { $gt: [{ $strLenCP: { $ifNull: ['$toolResultNote', ''] } }, 0] };

    const group: Record<string, unknown> = {
      _id: dayExpr,
      total: { $sum: 1 },
      toolReviewed: { $sum: { $cond: [reviewedCond, 1, 0] } },
      toolUnreviewed: { $sum: { $cond: [reviewedCond, 0, 1] } },
      toolOk: { $sum: { $cond: [{ $eq: ['$toolResultNote', 'ok'] }, 1, 0] } },
      designerReceived: {
        $sum: {
          $cond: [
            { $ne: [{ $ifNull: ['$designerStatus', DesignerStatus.Unassigned] }, DesignerStatus.Unassigned] },
            1,
            0,
          ],
        },
      },
      designerDone: { $sum: { $cond: [{ $eq: ['$designerStatus', DesignerStatus.Done] }, 1, 0] } },
      designerRework: { $sum: { $cond: [{ $eq: ['$designerStatus', DesignerStatus.Rework] }, 1, 0] } },
      // "Đã sửa" designer = done MÀ từng bị báo lỗi (designerReworkCount>0).
      designerFixed: {
        $sum: {
          $cond: [
            {
              $and: [
                { $eq: ['$designerStatus', DesignerStatus.Done] },
                { $gt: [{ $ifNull: ['$designerReworkCount', 0] }, 0] },
              ],
            },
            1,
            0,
          ],
        },
      },
    };
    // Metric mỗi stage: arrived = từng tới stage (status tồn tại); done/remaining/rework theo status hiện tại.
    for (const st of FULFILLMENT_STAGES) {
      const ref = `$fulfillmentStages.${st}.status`;
      const reworkCountRef = `$fulfillmentStages.${st}.reworkCount`;
      group[`s_${st}_arrived`] = {
        $sum: { $cond: [{ $ne: [{ $ifNull: [ref, null] }, null] }, 1, 0] },
      };
      group[`s_${st}_done`] = {
        $sum: { $cond: [{ $eq: [ref, FulfillmentStageStatus.Done] }, 1, 0] },
      };
      // "Đã sửa" stage = status 'done' MÀ reworkCount>0 (đã hoàn thành sau khi sửa lỗi).
      group[`s_${st}_fixed`] = {
        $sum: {
          $cond: [
            {
              $and: [{ $eq: [ref, FulfillmentStageStatus.Done] }, { $gt: [{ $ifNull: [reworkCountRef, 0] }, 0] }],
            },
            1,
            0,
          ],
        },
      };
      group[`s_${st}_remaining`] = {
        $sum: {
          $cond: [
            {
              $or: [{ $eq: [ref, FulfillmentStageStatus.Waiting] }, { $eq: [ref, FulfillmentStageStatus.InProgress] }],
            },
            1,
            0,
          ],
        },
      };
      group[`s_${st}_rework`] = {
        $sum: { $cond: [{ $eq: [ref, FulfillmentStageStatus.Rework] }, 1, 0] },
      };
    }

    const agg = await this.orderModel.aggregate<Record<string, number | string>>([
      { $match: match },
      { $group: group as PipelineStage.Group['$group'] },
    ]);
    const byDay = new Map(agg.map((r) => [String(r._id), r]));

    const emptyMetric = (): FulfillmentStageMetric => ({
      arrived: 0,
      done: 0,
      remaining: 0,
      rework: 0,
      fixed: 0,
    });
    const columnTotals: FulfillmentDailyColumnTotals = {
      total: 0,
      toolReviewed: 0,
      toolUnreviewed: 0,
      toolOk: 0,
      designerReceived: 0,
      designerDone: 0,
      designerRework: 0,
      designerFixed: 0,
      stages: Object.fromEntries(FULFILLMENT_STAGES.map((st) => [st, emptyMetric()])),
    };

    const rows: FulfillmentDailyRow[] = days.map((day) => {
      const r = byDay.get(day);
      const num = (k: string) => Number(r?.[k] ?? 0);
      const stages: Record<string, FulfillmentStageMetric> = {};
      for (const st of FULFILLMENT_STAGES) {
        const m: FulfillmentStageMetric = {
          arrived: num(`s_${st}_arrived`),
          done: num(`s_${st}_done`),
          remaining: num(`s_${st}_remaining`),
          rework: num(`s_${st}_rework`),
          fixed: num(`s_${st}_fixed`),
        };
        stages[st] = m;
        const ct = columnTotals.stages[st];
        ct.arrived += m.arrived;
        ct.done += m.done;
        ct.remaining += m.remaining;
        ct.rework += m.rework;
        ct.fixed += m.fixed;
      }
      const row: FulfillmentDailyRow = {
        day,
        total: num('total'),
        toolReviewed: num('toolReviewed'),
        toolUnreviewed: num('toolUnreviewed'),
        toolOk: num('toolOk'),
        designerReceived: num('designerReceived'),
        designerDone: num('designerDone'),
        designerRework: num('designerRework'),
        designerFixed: num('designerFixed'),
        stages,
      };
      columnTotals.total += row.total;
      columnTotals.toolReviewed += row.toolReviewed;
      columnTotals.toolUnreviewed += row.toolUnreviewed;
      columnTotals.toolOk += row.toolOk;
      columnTotals.designerReceived += row.designerReceived;
      columnTotals.designerDone += row.designerDone;
      columnTotals.designerRework += row.designerRework;
      columnTotals.designerFixed += row.designerFixed;
      return row;
    });

    return { days: rows, columnTotals, rangeDays: days.length };
  }

  /**
   * Cửa sổ ngày (tz VN) cho daily-overview: `from`+`to` → khoảng tùy biến (cap
   * 60 ngày), ngược lại N ngày gần nhất. `days` sort mới→cũ (FE reverse).
   */
  private resolveDayWindow(rangeDays: number, from?: string, to?: string): { start: Date; end: Date; days: string[] } {
    const MS_DAY = 86_400_000;
    const CAP = 60;
    const days: string[] = [];
    if (from && to) {
      const start = vnDayStart(from);
      const end = vnDayEnd(to);
      let cur = vnDayStart(to).getTime();
      const startMs = start.getTime();
      let i = 0;
      while (cur >= startMs && i < CAP) {
        days.push(new Date(cur + 7 * 60 * 60 * 1000).toISOString().slice(0, 10));
        cur -= MS_DAY;
        i += 1;
      }
      return { start, end, days };
    }
    const n = Math.max(1, Math.min(rangeDays || 7, CAP));
    const todayStart = vnTodayStart();
    const baseMs = todayStart.getTime();
    for (let i = 0; i < n; i += 1) {
      days.push(new Date(baseMs - i * MS_DAY + 7 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
    return {
      start: new Date(baseMs - (n - 1) * MS_DAY),
      end: new Date(baseMs + MS_DAY - 1),
      days,
    };
  }
}
