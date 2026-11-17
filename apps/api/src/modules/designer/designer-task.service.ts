import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { DesignerMyStats, DesignerTaskCard } from 'shared';
import {
  DesignerStatus,
  DesignerTransitionAction,
  FulfillmentStage,
  FulfillmentStageStatus,
  RoleType,
  WorkshopConfigCategory,
} from 'shared';
import { Status } from 'shared';

import { getExcludedFactoryIdSync } from '../../utils/excluded-factory';
import { withUrgentDateBypass } from '../../utils/urgent-date-bypass';
import { OrderDocument, OrderEntity } from '../order/order.entity';
import type { AuditContext } from '../order-log/order-log.service';
import { OrderLogService } from '../order-log/order-log.service';
import { RoleRepository } from '../role/role.repository';
import { UserDocument, UserEntity } from '../user/user.entity';
import { WorkshopConfigEntity } from '../workshop-config/workshop-config.entity';

const READY_FOR_FULFILL_CODE = 'ok';

const OVERRIDE_ROLES: RoleType[] = [RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager, RoleType.DesignerLeader];

/**
 * Role được phép **xem thay** kanban của designer khác (`viewUserId` trên các
 * endpoint `my-*`) — quản lý mở đúng trang /my-tasks của một nhân viên và thao
 * tác y như nhân viên đó.
 *
 * CỐ Ý là **giao** của 2 danh sách override sẵn có: `OVERRIDE_ROLES` (transition
 * đơn lẻ) và danh sách override cứng trong `bulkTransition`. Mở rộng quá giao
 * này thì trang rơi vào trạng thái nửa chạy nửa không — kéo được từng card
 * nhưng bulk lại báo "Task không thuộc bạn", tệ hơn là chặn hẳn từ đầu.
 * `DesignerLeader` nằm ngoài vì `bulkTransition` không cho leader override;
 * muốn mở cho leader thì phải sửa CẢ HAI chỗ cùng lúc.
 */
const VIEW_AS_ROLES: RoleType[] = [RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager];

/**
 * State machine cho task của Designer. Mọi transition đi qua method `transition`.
 * Race-safe bằng cách `findOneAndUpdate` với filter `designerStatus: expected` —
 * nếu 2 user transition đồng thời, người sau nhận 409 (FE refetch + retry).
 *
 * Side effects (chỉ áp lúc done): `toolResultNote='ok'` + `readyForFulfill=true`
 * — Fulfillment có thể pickup ngay sau khi designer hoàn thành.
 *
 * Owner constraint: sub-designer chỉ transition task có `assignee = user.assigneeCode`.
 * Leader/Admin/Manager bypass (override).
 */
@Injectable()
export class DesignerTaskService {
  constructor(
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    @InjectModel(UserEntity.name) private readonly userModel: Model<UserEntity>,
    @InjectModel(WorkshopConfigEntity.name)
    private readonly workshopConfigModel: Model<WorkshopConfigEntity>,
    private readonly roleRepository: RoleRepository,
    private readonly orderLogService: OrderLogService,
  ) {}

  /**
   * Validate designer nhận thay khi "báo không làm được → bàn giao": phải là
   * sub-designer (role Designer) đang Active và KHÁC chính mình. Mirror
   * `OrderService.assertAssigneeUserValid`.
   */
  private async assertHandoffTargetValid(targetUserId: string, selfUserId: string): Promise<void> {
    if (!targetUserId) {
      throw new BadRequestException('Phải chọn designer nhận thay khi báo không làm được.');
    }
    if (targetUserId === selfUserId) {
      throw new BadRequestException('Không thể bàn giao cho chính mình — chọn designer khác.');
    }
    const designerRole = await this.roleRepository.findOne({ name: RoleType.Designer });
    const u = await this.userModel
      .findOne({ _id: targetUserId, roleId: designerRole?._id }, { _id: 1, status: 1 })
      .lean();
    if (!u) {
      throw new BadRequestException('Designer nhận thay không hợp lệ (không tìm thấy hoặc không phải sub-designer).');
    }
    if ((u as unknown as { status?: string }).status !== Status.Active) {
      throw new BadRequestException('Designer nhận thay đã bị tắt — chọn người khác.');
    }
  }

  async transition(
    orderId: string,
    user: UserDocument,
    action: DesignerTransitionAction,
    reason: string | undefined,
    ctx: AuditContext,
    targetUserId?: string,
  ): Promise<OrderDocument> {
    const roleName = user.role?.name;
    const isOverride = roleName ? OVERRIDE_ROLES.includes(roleName) : false;

    const order = await this.orderModel.findById(orderId).lean();
    if (!order) throw new NotFoundException('Order not found');
    if ((order as unknown as { heldAt?: Date | null }).heldAt) {
      throw new BadRequestException('Đơn đang bị giữ — mở lại (bỏ giữ) trước khi thao tác tiếp.');
    }

    if (!isOverride) {
      if (roleName !== RoleType.Designer) {
        throw new ForbiddenException(`Role ${roleName ?? 'unknown'} không có quyền transition task.`);
      }
      if (order.assignee !== String(user._id)) {
        throw new ForbiddenException('Task này không thuộc bạn — không transition được.');
      }
    }

    // "Báo không làm được" = bàn giao BẮT BUỘC sang designer khác. `fromUserId`
    // = người đang ôm đơn (assignee) — người "không làm được"; không phải actor
    // (leader có thể thao tác thay). Validate target trước khi đổi state.
    const fromUserId = order.assignee || String(user._id);
    if (action === DesignerTransitionAction.Reject) {
      await this.assertHandoffTargetValid(targetUserId || '', fromUserId);
    }

    const currentStatus = order.designerStatus || DesignerStatus.Unassigned;
    const plan = this.resolveTransition(currentStatus, action, reason, {
      isFirstStart: !order.designerFirstStartedAt,
      designerStartedAt: order.designerStartedAt,
      targetUserId,
      fromUserId,
    });

    // Hook fulfillment khi designer.complete → vào/quay lại pipeline. Dùng CHUNG
    // với bulkTransition (xem applyCompleteFulfillmentHook).
    this.applyCompleteFulfillmentHook(
      order as { currentFulfillmentStage?: string | null; fulfillmentCompletedAt?: Date | null; factoryId?: string },
      action,
      plan,
    );

    // findOneAndUpdate với filter expected state → race-safe; nếu trong lúc
    // request đang xử lý mà user khác kéo card sang trạng thái khác thì update
    // này KHÔNG match, ta trả 409 để FE refetch.
    const updated = await this.orderModel.findOneAndUpdate(
      { _id: orderId, designerStatus: currentStatus },
      plan.patch,
      { new: true },
    );

    if (!updated) {
      throw new ConflictException('Trạng thái task vừa thay đổi bởi người khác — refresh và thử lại.');
    }

    void this.orderLogService.write({
      orderId,
      action: 'update',
      field: 'designerStatus',
      before: currentStatus,
      after: plan.nextStatus,
      ctx: { ...ctx, user },
    });

    if (plan.sideEffectLog) {
      void this.orderLogService.write({
        orderId,
        action: 'update',
        field: plan.sideEffectLog.field,
        before: plan.sideEffectLog.before,
        after: plan.sideEffectLog.after,
        ctx: { ...ctx, user },
      });
    }

    // Handoff "không làm được" — audit thêm: đổi assignee + lý do (actor = người
    // thao tác; nội dung ghi rõ người bàn giao & người nhận để tra sau).
    if (action === DesignerTransitionAction.Reject && targetUserId) {
      void this.orderLogService.writeMany([
        {
          orderId,
          action: 'update',
          field: 'assignee',
          before: fromUserId,
          after: targetUserId,
          ctx: { ...ctx, user },
        },
        {
          orderId,
          action: 'update',
          field: 'designerRejectedReason',
          before: null,
          after: reason || '(không nhập lý do)',
          ctx: { ...ctx, user },
        },
      ]);
    }

    return updated;
  }

  /**
   * Hook fulfillment khi designer **HOÀN THÀNH** (mutate `plan.patch.$set`):
   * - Đơn CHƯA vào fulfillment (`currentFulfillmentStage` rỗng) → kích hoạt stage
   *   Print `waiting` (đơn lần đầu vào In).
   * - Đơn ĐÃ trong pipeline (bị đẩy về designer từ 1 stage, reset về Print) → flip
   *   stage hiện tại sang `rework` để worker thấy ở tab "Cần làm lại" (re-flow toàn
   *   chuỗi). Xem `documents/Plans/UpstreamWatching-ReflowChain.md` §3.3.
   *
   * Dùng CHUNG cho `transition` (đơn lẻ) LẪN `bulkTransition` — nếu chỉ đặt ở path
   * đơn lẻ thì complete HÀNG LOẠT sẽ để đơn kẹt (`currentFulfillmentStage` set
   * nhưng stage vẫn `done` → vô hình ở mọi tab In; hoặc chưa bao giờ vào In).
   */
  private applyCompleteFulfillmentHook(
    order: { currentFulfillmentStage?: string | null; fulfillmentCompletedAt?: Date | null; factoryId?: string | null },
    action: DesignerTransitionAction,
    plan: { nextStatus: DesignerStatus; patch: Record<string, unknown> },
  ): void {
    if (action !== DesignerTransitionAction.Complete || plan.nextStatus !== DesignerStatus.Done) {
      return;
    }
    // Đơn xưởng US (ngoài luồng sản xuất) không vào fulfillment — designer
    // complete chỉ đổi trạng thái thiết kế, không init stage In.
    const excludedFactoryId = getExcludedFactoryIdSync(this.orderModel.db);
    if (excludedFactoryId && order.factoryId === excludedFactoryId) return;
    const currentFulfillmentStage = order.currentFulfillmentStage;
    // Đơn ĐÃ HOÀN THÀNH fulfillment (pack done → stage=null + fulfillmentCompletedAt)
    // cũng có stage rỗng — designer complete muộn KHÔNG được kéo đơn xong về
    // print/waiting (xưởng sẽ làm lại oan cả chuỗi).
    if (!currentFulfillmentStage && order.fulfillmentCompletedAt) return;
    const set = (plan.patch.$set ?? {}) as Record<string, unknown>;
    if (!currentFulfillmentStage) {
      set.currentFulfillmentStage = FulfillmentStage.Print;
      // `waitingAt = now` để user In thấy mốc "Nhận task lúc..." trong card.
      set['fulfillmentStages.print'] = {
        status: FulfillmentStageStatus.Waiting,
        reworkCount: 0,
        workMs: 0,
        waitingAt: new Date(),
      };
    } else {
      // Cycle quay về: đơn đã ở trong fulfillment, bị đẩy về designer → fix xong →
      // flip stage hiện tại sang rework (trước đó ở tab "Đang chờ quay lại").
      set[`fulfillmentStages.${currentFulfillmentStage}.status`] = FulfillmentStageStatus.Rework;
      set[`fulfillmentStages.${currentFulfillmentStage}.reworkAt`] = new Date();
    }
    plan.patch.$set = set;
  }

  /**
   * Quyết định patch + next state. Throw BadRequest nếu action không hợp lệ
   * với current state (vd. complete khi đang assigned).
   *
   * `context.designerStartedAt` + `isFirstStart` dùng để:
   *   - `start`: nếu first → set `designerFirstStartedAt`
   *   - `complete`: tính delta = now - startedAt → $inc `designerWorkMs`
   */
  private resolveTransition(
    current: DesignerStatus,
    action: DesignerTransitionAction,
    reason: string | undefined,
    context: {
      isFirstStart: boolean;
      designerStartedAt?: Date;
      /** Chỉ dùng cho action='reject' — designer nhận thay + người bàn giao. */
      targetUserId?: string;
      fromUserId?: string;
    },
  ): {
    nextStatus: DesignerStatus;
    patch: Record<string, unknown>;
    sideEffectLog?: { field: string; before: unknown; after: unknown };
  } {
    const now = new Date();

    switch (action) {
      case DesignerTransitionAction.Start: {
        if (current !== DesignerStatus.Assigned && current !== DesignerStatus.Rework) {
          throw new BadRequestException(
            `Action 'start' chỉ hợp lệ từ trạng thái 'assigned'/'rework' (current=${current}).`,
          );
        }
        const setPatch: Record<string, unknown> = {
          designerStatus: DesignerStatus.InProgress,
          designerStartedAt: now,
        };
        if (context.isFirstStart) {
          setPatch.designerFirstStartedAt = now;
        }
        return {
          nextStatus: DesignerStatus.InProgress,
          patch: { $set: setPatch },
        };
      }

      case DesignerTransitionAction.Restart: {
        if (current !== DesignerStatus.Rework) {
          throw new BadRequestException(`Action 'restart' chỉ hợp lệ từ trạng thái 'rework' (current=${current}).`);
        }
        // Per-cycle: reset designerStartedAt để complete sau tính đúng delta.
        return {
          nextStatus: DesignerStatus.InProgress,
          patch: {
            $set: {
              designerStatus: DesignerStatus.InProgress,
              designerStartedAt: now,
            },
          },
        };
      }

      case DesignerTransitionAction.Complete: {
        if (current !== DesignerStatus.InProgress) {
          throw new BadRequestException(
            `Action 'complete' chỉ hợp lệ từ trạng thái 'in-progress' (current=${current}).`,
          );
        }
        // Cộng dồn workMs = now - startedAt. Nếu startedAt thiếu (data legacy
        // / corrupt) → 0 để không sinh số âm.
        const delta = context.designerStartedAt
          ? Math.max(0, now.getTime() - new Date(context.designerStartedAt).getTime())
          : 0;
        return {
          nextStatus: DesignerStatus.Done,
          patch: {
            $set: {
              designerStatus: DesignerStatus.Done,
              designerCompletedAt: now,
              toolResultNote: READY_FOR_FULFILL_CODE,
              readyForFulfill: true,
              // Designer đã sửa xong lỗi → đơn rời "Nhật ký bù lỗi". Mirror hành
              // vi của `OrderService.updateField(toolResultNote='ok')` (chỉ path
              // đó clear, còn state-machine designer trước đây bỏ sót → đơn kẹt
              // lại trong error log dù đã fix).
              productionFirstErrorAt: null,
            },
            ...(delta > 0 ? { $inc: { designerWorkMs: delta } } : {}),
          },
          sideEffectLog: { field: 'toolResultNote', before: null, after: READY_FOR_FULFILL_CODE },
        };
      }

      case DesignerTransitionAction.Reject: {
        // "Báo không làm được" = BÀN GIAO thẳng sang designer khác (không còn
        // state `rejected`). Cho phép từ 'assigned' lẫn 'in-progress'. Đơn thành
        // `assigned` cho người nhận; đồng hồ per-cycle reset để KPI người mới
        // tính lại từ lúc nhận. Lịch sử đẩy vào `designerRejections` (nguồn
        // thống kê "Không làm được" theo `fromUserId`).
        if (current !== DesignerStatus.Assigned && current !== DesignerStatus.InProgress) {
          throw new BadRequestException(
            `Action 'reject' chỉ hợp lệ từ trạng thái 'assigned' hoặc 'in-progress' (current=${current}).`,
          );
        }
        const target = context.targetUserId;
        if (!target) {
          throw new BadRequestException('Thiếu designer nhận thay (targetUserId).');
        }
        return {
          nextStatus: DesignerStatus.Assigned,
          patch: {
            $set: {
              designerStatus: DesignerStatus.Assigned,
              assignee: target,
              designerAssignedAt: now,
              designerStartedAt: null,
              designerFirstStartedAt: null,
              designerCompletedAt: null,
              designerRejectedAt: null,
              designerRejectedReason: null,
            },
            $push: {
              designerRejections: {
                fromUserId: context.fromUserId || '',
                toUserId: target,
                reason: reason || undefined,
                at: now,
              },
            },
          },
        };
      }

      default: {
        throw new BadRequestException(`Action không hỗ trợ: ${action}`);
      }
    }
  }

  // ─── Sub-designer view (Phase 4) ────────────────────────────────────

  /**
   * Trả task của sub-designer hiện tại, grouped theo `designerStatus` cho
   * kanban 4 cột. TẤT CẢ cột (+ rejected drawer) lọc theo `inProductionAt`
   * trong khoảng `from`/`to` (mặc định today) — "đơn vào sản xuất ngày đó đang
   * ở cột nào". Đổi từ hành vi cũ (chỉ cột `done` lọc theo `designerCompletedAt`).
   *
   * Reject column trả riêng (drawer dưới kanban) — không pollute "Cần làm".
   */
  async getMyTasks(
    user: UserDocument,
    query: {
      from?: string;
      to?: string;
      type?: string;
      fabricType?: string;
      machineNumber?: string;
      toolResult?: string;
      toolResultNote?: string;
      userSku?: string;
      errorFile?: string;
      search?: string;
      /** Xem thay kanban của designer khác — chỉ VIEW_AS_ROLES (resolveViewUser). */
      viewUserId?: string;
    },
  ): Promise<{
    columns: {
      assigned: DesignerTaskCard[];
      inProgress: DesignerTaskCard[];
      rework: DesignerTaskCard[];
      done: DesignerTaskCard[];
      fixed: DesignerTaskCard[];
      watching: DesignerTaskCard[];
    };
    rejected: DesignerTaskCard[];
    userId: string;
    fullName?: string;
  }> {
    const { userId, fullName } = await this.resolveViewUser(user, query.viewUserId);
    const range = this.resolveDateRange(query.from, query.to);
    const baseFilter = this.buildMyTaskFilter(userId, query);
    // Lọc theo NGÀY VÀO SẢN XUẤT (`inProductionAt`) cho TẤT CẢ cột kanban (+
    // rejected drawer): chỉ hiện đơn vào sản xuất trong khoảng đã chọn (mặc
    // định hôm nay). Trước đây chỉ cột "Đã xong" lọc theo `designerCompletedAt`.
    baseFilter.inProductionAt = { $gte: range.start, $lte: range.end };
    // 3 cột đang có việc: đơn "Làm ngay" hiện bất kể ngày (Orders.md §17.5).
    const activeFilter = withUrgentDateBypass(baseFilter);

    // Drawer "Không làm được" = đơn user TỪNG báo không làm được rồi bàn giao đi
    // (giờ assignee đã là người khác) → query theo lịch sử `designerRejections`,
    // KHÔNG theo assignee hiện tại. Giữ nguyên các facet + cửa sổ ngày.
    const rejectedFilter: Record<string, unknown> = {
      ...baseFilter,
      'designerRejections.fromUserId': userId,
    };
    delete rejectedFilter.assignee;

    // Marker "đơn đang giữ ở Soát tool" (In báo thiếu file) → đơn ở phía TRƯỚC
    // designer (upstream). Task designer đã xong/đang chờ làm lại của đơn này
    // hiển thị ở cột "Đang chờ quay lại" (watching), KHÔNG ở Đã xong/Cần làm lại
    // (chưa tới lượt designer — chờ Support soát xong).
    const toolCheckMarker = { productionErrorSource: 'tool-check', toolResultNote: 'error' };
    const notMarker = { $nor: [toolCheckMarker] };

    const [assignedRaw, inProgressRaw, reworkRaw, doneRaw, fixedRaw, watchingRaw, rejectedRaw] = await Promise.all([
      this.orderModel
        .find({ ...activeFilter, designerStatus: DesignerStatus.Assigned })
        .sort({ priority: -1, designerAssignedAt: -1, inProductionAt: -1 })
        .lean(),
      this.orderModel
        .find({ ...activeFilter, designerStatus: DesignerStatus.InProgress })
        .sort({ priority: -1, designerStartedAt: -1, inProductionAt: -1 })
        .lean(),
      // "Cần làm lại" — loại đơn đang giữ ở Soát tool (chờ Support) → watching.
      this.orderModel
        .find({ ...activeFilter, ...notMarker, designerStatus: DesignerStatus.Rework })
        .sort({ priority: -1, designerReworkAt: -1, inProductionAt: -1 })
        .lean(),
      // "Đã xong" = done KHÔNG dính lỗi (designerReworkCount = 0/thiếu), đơn
      // KHÔNG bị đẩy về Soát tool.
      this.orderModel
        .find({
          ...baseFilter,
          ...notMarker,
          designerStatus: DesignerStatus.Done,
          designerReworkCount: { $in: [0, null] },
        })
        .sort({ priority: -1, designerCompletedAt: -1 })
        .lean(),
      // "Đã sửa" = done SAU KHI sửa lỗi (designerReworkCount > 0).
      this.orderModel
        .find({
          ...baseFilter,
          ...notMarker,
          designerStatus: DesignerStatus.Done,
          designerReworkCount: { $gt: 0 },
        })
        .sort({ priority: -1, designerCompletedAt: -1 })
        .lean(),
      // "Đang chờ quay lại" — đơn CỦA MÌNH (assignee scope ở baseFilter) đang
      // giữ ở Soát tool phía trên; task đã xong/đang chờ làm lại. Sau khi Support
      // soát xong → chuyển sang "Cần làm lại".
      this.orderModel
        .find({
          ...baseFilter,
          ...toolCheckMarker,
          designerStatus: { $in: [DesignerStatus.Done, DesignerStatus.Rework] },
        })
        .sort({ priority: -1, inProductionAt: -1 })
        .lean(),
      this.orderModel.find(rejectedFilter).sort({ priority: -1, updatedAt: -1, inProductionAt: -1 }).lean(),
    ]);

    return {
      columns: {
        assigned: assignedRaw.map(this.toCard),
        inProgress: inProgressRaw.map(this.toCard),
        rework: reworkRaw.map(this.toCard),
        done: doneRaw.map(this.toCard),
        fixed: fixedRaw.map(this.toCard),
        watching: watchingRaw.map(this.toCard),
      },
      rejected: rejectedRaw.map(this.toCard),
      userId,
      fullName,
    };
  }

  /**
   * Faceted filter options cho /my-tasks page. Mỗi facet exclude chính nó
   * khỏi filter để user thấy đầy đủ option của facet đó nhưng count phản ánh
   * cross-filter của các facet khác.
   */
  async getMyTaskFilters(
    user: UserDocument,
    query: {
      from?: string;
      to?: string;
      type?: string;
      fabricType?: string;
      machineNumber?: string;
      toolResult?: string;
      toolResultNote?: string;
      userSku?: string;
      errorFile?: string;
      /** Xem thay — facet count phải cùng scope người với kanban, nếu không số lệch. */
      viewUserId?: string;
    },
  ): Promise<{
    type: { value: string; label: string; count: number }[];
    fabricType: { value: string; label: string; count: number }[];
    machineNumber: { value: string; label: string; count: number }[];
    toolResult: { value: string; label: string; count: number }[];
    toolResultNote: { value: string; label: string; count: number }[];
    userSku: { value: string; label: string; count: number }[];
    errorFile: { value: string; label: string; count: number }[];
  }> {
    const { userId } = await this.resolveViewUser(user, query.viewUserId);
    // Đồng bộ với kanban: facet count cũng lọc theo `inProductionAt` trong khoảng.
    const range = this.resolveDateRange(query.from, query.to);

    type FacetKey = 'type' | 'fabricType' | 'machineNumber' | 'toolResult' | 'toolResultNote' | 'userSku';
    const KEYS: FacetKey[] = ['type', 'fabricType', 'machineNumber', 'toolResult', 'toolResultNote', 'userSku'];

    const aggregate = async (excludeKey: FacetKey, field: FacetKey) => {
      const filter = this.buildMyTaskFilter(userId, { ...query, [excludeKey]: undefined });
      const match = {
        ...filter,
        inProductionAt: { $gte: range.start, $lte: range.end },
        [field]: { $exists: true, $ne: null, $nin: [''] },
      };
      const agg = await this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: match },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
      return agg.map((r) => ({ value: r._id, label: r._id, count: r.count }));
    };

    // `errorFile` là field MẢNG → không dùng helper `aggregate()` chung (group
    // theo `$field` scalar sẽ group cả mảng làm 1 key). Cần `$unwind` trước
    // `$group`. Exclude chính errorFile khỏi filter (cross-narrow như facet kia).
    // 1 đơn nhiều loại → đếm ở nhiều option ⇒ tổng option có thể > số đơn (đúng).
    const errorFileFacet = async () => {
      const filter = this.buildMyTaskFilter(userId, { ...query, errorFile: undefined });
      const [agg, cfgs] = await Promise.all([
        this.orderModel.aggregate<{ _id: string; count: number }>([
          {
            $match: {
              ...filter,
              inProductionAt: { $gte: range.start, $lte: range.end },
              errorFile: { $exists: true, $ne: null, $not: { $size: 0 } },
            },
          },
          { $unwind: '$errorFile' },
          { $match: { errorFile: { $ne: '' } } },
          { $group: { _id: '$errorFile', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        // Resolve code→name ở BACKEND (như getWorkshopAvailableFilters) — không
        // phụ thuộc FE workshop_config store cho category error_file_type.
        this.workshopConfigModel.find({ category: WorkshopConfigCategory.ErrorFileType }, { code: 1, name: 1 }).lean(),
      ]);
      const nameMap = new Map<string, string>(cfgs.map((c) => [c.code, c.name]));
      return agg.map((r) => ({ value: r._id, label: nameMap.get(r._id) || r._id, count: r.count }));
    };

    const [typeOpts, fabricOpts, machineOpts, toolOpts, toolNoteOpts, userOpts, errorFileOpts] = await Promise.all([
      ...KEYS.map((k) => aggregate(k, k)),
      errorFileFacet(),
    ]);

    return {
      type: typeOpts,
      fabricType: fabricOpts,
      machineNumber: machineOpts,
      toolResult: toolOpts,
      toolResultNote: toolNoteOpts,
      userSku: userOpts,
      errorFile: errorFileOpts,
    };
  }

  /**
   * Bulk transition cho nhiều task của cùng sub-designer. Mỗi task áp state
   * machine giống `transition()`. Task không hợp lệ (sai owner, sai state)
   * skip + report. Race-safe per-row qua `findOneAndUpdate` filter expected.
   */
  async bulkTransition(
    user: UserDocument,
    ids: string[],
    action: DesignerTransitionAction,
    reason: string | undefined,
    ctx: AuditContext,
    targetUserId?: string,
  ): Promise<{
    matched: number;
    modified: number;
    skipped: { orderId: string; productionId: string; reason: string }[];
  }> {
    const roleName = user.role?.name;
    const userId = String(user._id);
    const isOverride = !!roleName && [RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager].includes(roleName);

    // Bàn giao "không làm được" hàng loạt → 1 designer nhận cho tất cả. Validate
    // target 1 lần trước vòng lặp.
    if (action === DesignerTransitionAction.Reject) {
      await this.assertHandoffTargetValid(targetUserId || '', userId);
    }

    const docs = await this.orderModel
      .find(
        { _id: { $in: ids } },
        {
          _id: 1,
          productionId: 1,
          assignee: 1,
          designerStatus: 1,
          designerStartedAt: 1,
          designerFirstStartedAt: 1,
          currentFulfillmentStage: 1,
          fulfillmentCompletedAt: 1,
          // Cho guard xưởng US trong applyCompleteFulfillmentHook.
          factoryId: 1,
        },
      )
      .lean();

    const skipped: { orderId: string; productionId: string; reason: string }[] = [];
    let modified = 0;

    for (const o of docs) {
      const orderId = String(o._id);
      const productionId = String((o as { productionId?: string }).productionId || orderId);

      if (!isOverride && o.assignee !== userId) {
        skipped.push({ orderId, productionId, reason: 'Task không thuộc bạn.' });
        continue;
      }

      const current = o.designerStatus || DesignerStatus.Unassigned;
      const fromUserId = o.assignee || userId;
      // Bàn giao cho chính người đang ôm = no-op → skip.
      if (action === DesignerTransitionAction.Reject && targetUserId === fromUserId) {
        skipped.push({ orderId, productionId, reason: 'Không thể bàn giao cho chính người đang ôm đơn.' });
        continue;
      }
      try {
        const plan = this.resolveTransition(current, action, reason, {
          isFirstStart: !o.designerFirstStartedAt,
          designerStartedAt: o.designerStartedAt,
          targetUserId,
          fromUserId,
        });
        // Cùng hook fulfillment như transition đơn lẻ — nếu thiếu, complete hàng
        // loạt để đơn kẹt (currentStage set nhưng stage vẫn 'done').
        this.applyCompleteFulfillmentHook(
          o as { currentFulfillmentStage?: string | null; fulfillmentCompletedAt?: Date | null; factoryId?: string },
          action,
          plan,
        );
        const updated = await this.orderModel.findOneAndUpdate({ _id: orderId, designerStatus: current }, plan.patch, {
          new: true,
        });
        if (!updated) {
          skipped.push({ orderId, productionId, reason: 'Trạng thái đã đổi (race) — refresh và thử lại.' });
          continue;
        }
        modified++;
        void this.orderLogService.write({
          orderId,
          action: 'update',
          field: 'designerStatus',
          before: current,
          after: plan.nextStatus,
          ctx: { ...ctx, user },
        });
        if (plan.sideEffectLog) {
          void this.orderLogService.write({
            orderId,
            action: 'update',
            field: plan.sideEffectLog.field,
            before: plan.sideEffectLog.before,
            after: plan.sideEffectLog.after,
            ctx: { ...ctx, user },
          });
        }
        if (action === DesignerTransitionAction.Reject && targetUserId) {
          void this.orderLogService.writeMany([
            {
              orderId,
              action: 'update',
              field: 'assignee',
              before: fromUserId,
              after: targetUserId,
              ctx: { ...ctx, user },
            },
            {
              orderId,
              action: 'update',
              field: 'designerRejectedReason',
              before: null,
              after: reason || '(không nhập lý do)',
              ctx: { ...ctx, user },
            },
          ]);
        }
      } catch (err) {
        skipped.push({ orderId, productionId, reason: (err as Error).message });
      }
    }

    return { matched: docs.length, modified, skipped };
  }

  /**
   * Quyết định kanban đang hiển thị của AI. Không truyền `viewUserId` (hoặc trỏ
   * về chính mình) → như cũ. Có truyền → phải là role trong `VIEW_AS_ROLES`.
   *
   * Trả luôn `fullName` của người ĐƯỢC XEM để tiêu đề trang nói đúng tên — nếu
   * echo tên người đăng nhập thì admin xem task của nhân viên khác mà tưởng là
   * của mình, rồi thao tác nhầm.
   */
  private async resolveViewUser(
    user: UserDocument,
    viewUserId?: string,
  ): Promise<{ userId: string; fullName?: string }> {
    const selfId = String(user._id);
    if (!viewUserId || viewUserId === selfId) return { userId: selfId, fullName: user.fullName };

    const roleName = user.role?.name;
    if (!roleName || !VIEW_AS_ROLES.includes(roleName)) {
      throw new ForbiddenException('Không có quyền xem task của nhân viên khác.');
    }
    const target = await this.userModel.findById(viewUserId, { _id: 1, fullName: 1 }).lean();
    if (!target) throw new BadRequestException('Nhân viên cần xem không tồn tại.');
    return { userId: String(target._id), fullName: (target as { fullName?: string }).fullName };
  }

  private buildMyTaskFilter(
    userId: string,
    query: {
      type?: string;
      fabricType?: string;
      machineNumber?: string;
      toolResult?: string;
      toolResultNote?: string;
      userSku?: string;
      errorFile?: string;
      search?: string;
    },
  ): Record<string, unknown> {
    // `cancelledAt: null` — đơn hủy phải biến mất khỏi kanban "Cần làm/Đang
    // làm/…" của designer, kể cả khi bị hủy giữa chừng.
    const filter: Record<string, unknown> = { assignee: userId, cancelledAt: null };
    if (query.type) filter.type = { $in: query.type.split(',').filter(Boolean) };
    if (query.fabricType) filter.fabricType = { $in: query.fabricType.split(',').filter(Boolean) };
    if (query.machineNumber) filter.machineNumber = { $in: query.machineNumber.split(',').filter(Boolean) };
    if (query.toolResult) filter.toolResult = { $in: query.toolResult.split(',').filter(Boolean) };
    if (query.toolResultNote) filter.toolResultNote = { $in: query.toolResultNote.split(',').filter(Boolean) };
    if (query.userSku) filter.userSku = { $in: query.userSku.split(',').filter(Boolean) };
    // `errorFile` là field MẢNG trên order → `$in` khớp nếu mảng chứa bất kỳ mã nào.
    if (query.errorFile) filter.errorFile = { $in: query.errorFile.split(',').filter(Boolean) };
    if (query.search) {
      filter.$or = [
        { productionId: { $regex: query.search, $options: 'i' } },
        { orderId: { $regex: query.search, $options: 'i' } },
      ];
    }
    return filter;
  }

  async getMyStats(
    user: UserDocument,
    period: 'today' | '7d' | '30d' | 'custom',
    from?: string,
    to?: string,
    viewUserId?: string,
  ): Promise<DesignerMyStats> {
    const { userId } = await this.resolveViewUser(user, viewUserId);
    const range = this.resolvePeriodRange(period, from, to);

    const [statusAgg, completedAgg, rejectedByMe] = await Promise.all([
      this.orderModel.aggregate<{ _id: DesignerStatus; count: number }>([
        { $match: { assignee: userId, cancelledAt: null } },
        { $group: { _id: '$designerStatus', count: { $sum: 1 } } },
      ]),
      this.orderModel
        .find(
          {
            assignee: userId,
            cancelledAt: null,
            designerStatus: DesignerStatus.Done,
            designerCompletedAt: { $gte: range.start, $lte: range.end },
          },
          {
            designerAssignedAt: 1,
            designerStartedAt: 1,
            designerFirstStartedAt: 1,
            designerCompletedAt: 1,
            designerReworkCount: 1,
            designerWorkMs: 1,
          },
        )
        .lean(),
      // "Không làm được" = số đơn user TỪNG báo không làm được rồi bàn giao đi
      // (nguồn: lịch sử `designerRejections.fromUserId`, không phụ thuộc assignee
      // hiện tại). All-time để tra được tổng đã bàn giao.
      this.orderModel.countDocuments({ 'designerRejections.fromUserId': userId }),
    ]);

    const counts: Partial<Record<DesignerStatus, number>> = {};
    for (const row of statusAgg) counts[row._id] = row.count;

    // Average response/work time chỉ tính trên completed period.
    let responseSumMs = 0;
    let responseN = 0;
    let workSumMs = 0;
    let workN = 0;
    let reworkSum = 0;
    for (const o of completedAgg) {
      // Response: ưu tiên firstStartedAt (immutable từ lần đầu). Fallback
      // designerStartedAt cho legacy data.
      const respStart = (o as { designerFirstStartedAt?: Date }).designerFirstStartedAt || o.designerStartedAt;
      if (o.designerAssignedAt && respStart) {
        responseSumMs += respStart.getTime() - o.designerAssignedAt.getTime();
        responseN++;
      }
      // Work: ưu tiên designerWorkMs cumulative. Fallback cho legacy (chỉ có
      // 1 cycle, không rework) → tính (completedAt - startedAt).
      const cumWorkMs = (o as { designerWorkMs?: number }).designerWorkMs;
      if (cumWorkMs && cumWorkMs > 0) {
        workSumMs += cumWorkMs;
        workN++;
      } else if (o.designerStartedAt && o.designerCompletedAt) {
        workSumMs += o.designerCompletedAt.getTime() - o.designerStartedAt.getTime();
        workN++;
      }
      reworkSum += o.designerReworkCount || 0;
    }

    const completedInPeriod = completedAgg.length;
    // "Đã sửa" = done trong period MÀ từng bị báo lỗi (designerReworkCount>0).
    const fixedInPeriod = completedAgg.filter((o) => (o.designerReworkCount || 0) > 0).length;
    return {
      assignedCount: counts[DesignerStatus.Assigned] || 0,
      inProgressCount: counts[DesignerStatus.InProgress] || 0,
      reworkCount: counts[DesignerStatus.Rework] || 0,
      rejectedCount: rejectedByMe,
      completedInPeriod,
      fixedInPeriod,
      avgResponseMin: responseN > 0 ? Math.round(responseSumMs / responseN / 60000) : 0,
      avgWorkMin: workN > 0 ? Math.round(workSumMs / workN / 60000) : 0,
      errorRate: completedInPeriod > 0 ? Math.round((reworkSum / completedInPeriod) * 100) / 100 : 0,
    };
  }

  /**
   * Breakdown số lượng đơn CỦA USER hiện tại theo NGÀY VÀO SẢN XUẤT
   * (`inProductionAt`, tz VN) trong `rangeDays` ngày gần nhất (7/14/30).
   * Focus vào đơn CHƯA XONG (assigned/rework/in-progress) — giúp designer thấy
   * đơn tồn cũ. `done` trả kèm để đối chiếu. Chỉ trả các ngày có >=1 đơn.
   *
   * Window theo `inProductionAt` — đồng bộ với cách kanban lọc; đơn tồn quá cũ
   * (ngoài N ngày) sẽ ẩn → dùng switcher 14/30 để mở rộng.
   */
  async getMyDailyBreakdown(
    user: UserDocument,
    rangeDays: number,
    viewUserId?: string,
  ): Promise<{
    days: {
      day: string;
      ageDays: number;
      assigned: number;
      rework: number;
      inProgress: number;
      done: number;
      unfinished: number;
    }[];
    totals: { assigned: number; rework: number; inProgress: number; done: number; unfinished: number };
    rangeDays: number;
  }> {
    const { userId } = await this.resolveViewUser(user, viewUserId);
    const MS_DAY = 86_400_000;
    // Biên ngày theo giờ VN (+07:00) — đồng bộ resolveDateRange.
    const vnStart = (d: string) => new Date(`${d}T00:00:00+07:00`);
    const vnEnd = (d: string) => new Date(`${d}T23:59:59.999+07:00`);
    const vnToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const start = new Date(vnStart(vnToday).getTime() - (rangeDays - 1) * MS_DAY);
    const end = vnEnd(vnToday);

    const agg = await this.orderModel.aggregate<{
      _id: { day: string; status: DesignerStatus };
      count: number;
    }>([
      {
        $match: {
          assignee: userId,
          cancelledAt: null,
          inProductionAt: { $gte: start, $lte: end },
          designerStatus: {
            $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework, DesignerStatus.Done],
          },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$inProductionAt', timezone: '+07:00' } },
            status: '$designerStatus',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    type DayAcc = { day: string; assigned: number; rework: number; inProgress: number; done: number };
    const statusKey: Partial<Record<DesignerStatus, keyof Omit<DayAcc, 'day'>>> = {
      [DesignerStatus.Assigned]: 'assigned',
      [DesignerStatus.Rework]: 'rework',
      [DesignerStatus.InProgress]: 'inProgress',
      [DesignerStatus.Done]: 'done',
    };

    const map = new Map<string, DayAcc>();
    const totals = { assigned: 0, rework: 0, inProgress: 0, done: 0, unfinished: 0 };
    for (const r of agg) {
      const key = statusKey[r._id.status];
      if (!key) continue;
      let day = map.get(r._id.day);
      if (!day) {
        day = { day: r._id.day, assigned: 0, rework: 0, inProgress: 0, done: 0 };
        map.set(r._id.day, day);
      }
      day[key] += r.count;
      totals[key] += r.count;
    }
    totals.unfinished = totals.assigned + totals.rework + totals.inProgress;

    const todayStartMs = vnStart(vnToday).getTime();
    const days = [...map.values()]
      .map((d) => {
        const unfinished = d.assigned + d.rework + d.inProgress;
        const ageDays = Math.max(0, Math.round((todayStartMs - vnStart(d.day).getTime()) / MS_DAY));
        return { ...d, unfinished, ageDays };
      })
      // Mới → cũ (ngày lớn lên đầu).
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

    return { days, totals, rangeDays };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private toCard = (o: Record<string, unknown>): DesignerTaskCard => ({
    _id: String(o._id),
    productionId: String(o.productionId),
    orderId: (o.orderId as string) || undefined,
    type: (o.type as string) || undefined,
    size: (o.size as string) || undefined,
    color: (o.color as string) || undefined,
    mockupUrl: (o.mockupUrl as string) || undefined,
    mockupOriginalUrl: (o.mockupOriginalUrl as string) || undefined,
    orderAt: o.orderAt as Date | undefined,
    inProductionAt: o.inProductionAt as Date | undefined,
    updatedAt: o.updatedAt as Date | undefined,
    fabricType: (o.fabricType as string) || undefined,
    machineNumber: (o.machineNumber as string) || undefined,
    toolResult: (o.toolResult as string) || undefined,
    toolResultNote: (o.toolResultNote as string) || undefined,
    designerStatus: (o.designerStatus as DesignerStatus) || DesignerStatus.Unassigned,
    designerAssignedAt: o.designerAssignedAt as Date | undefined,
    designerStartedAt: o.designerStartedAt as Date | undefined,
    designerFirstStartedAt: o.designerFirstStartedAt as Date | undefined,
    designerCompletedAt: o.designerCompletedAt as Date | undefined,
    designerRejectedAt: o.designerRejectedAt as Date | undefined,
    designerReworkAt: o.designerReworkAt as Date | undefined,
    designerRejectedReason: (o.designerRejectedReason as string) || undefined,
    designerReworkCount: (o.designerReworkCount as number) || 0,
    designerWorkMs: (o.designerWorkMs as number) || 0,
    productionError: (o.productionError as string) || undefined,
    productionErrorNote: (o.productionErrorNote as string) || undefined,
    errorFile: (o.errorFile as string[]) || undefined,
    errorFileNote: (o.errorFileNote as string) || undefined,
    designerRejections: (o.designerRejections as DesignerTaskCard['designerRejections']) || undefined,
    priority: (o.priority as DesignerTaskCard['priority']) || undefined,
  });

  private resolveDateRange(from?: string, to?: string): { start: Date; end: Date } {
    // Biên ngày theo giờ VN (+07:00) — đồng bộ với order.service (vnDayStart/
    // vnDayEnd). Tránh lệch ngày khi server chạy UTC: 'yyyy-mm-dd' phải hiểu là
    // NGÀY VN chứ không phải local của server.
    const vnStart = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00+07:00`);
    const vnEnd = (d: string) => new Date(`${d.slice(0, 10)}T23:59:59.999+07:00`);
    if (from || to) {
      return {
        start: from ? vnStart(from) : new Date(0),
        end: to ? vnEnd(to) : new Date(),
      };
    }
    // Default: hôm nay (theo VN).
    const vnToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { start: vnStart(vnToday), end: vnEnd(vnToday) };
  }

  private resolvePeriodRange(
    period: 'today' | '7d' | '30d' | 'custom',
    from?: string,
    to?: string,
  ): { start: Date; end: Date } {
    if (period === 'custom') return this.resolveDateRange(from, to);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (period === '7d') start.setDate(start.getDate() - 6);
    if (period === '30d') start.setDate(start.getDate() - 29);
    return { start, end };
  }
}
