import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  AssignBacklogGroup,
  AssignBacklogOrder,
  DesignerLeaderboardRow,
  DesignerTimelineBucket,
  ErrorStats,
  PerformanceComponents,
  PerformanceScoreRow,
  PersonErrorRow,
  ProductBreakdownDesigner,
  ProductTimeRow,
  ToolCheckDayRow,
  ToolCheckErrorRow,
  ToolCheckFacet,
  ToolCheckOrder,
} from 'shared';
import {
  DesignerRank,
  DesignerStatus,
  FULFILLMENT_STAGE_LABELS,
  FulfillmentStage,
  rankFromScore,
  RoleType,
  Status,
  WorkshopConfigCategory,
} from 'shared';

import { designerFlowConds } from '../../utils/designer-flow';
import { productionFactoryClause } from '../../utils/excluded-factory';
import { OrderEntity } from '../order/order.entity';
import { productLineCondition } from '../order/product-line-filter';
import { OrderLogEntity } from '../order-log/order-log.entity';
import { ProductConfigEntity } from '../product-config/product-config.entity';
import { RoleRepository } from '../role/role.repository';
import { UserEntity } from '../user/user.entity';
import { WorkshopConfigEntity } from '../workshop-config/workshop-config.entity';

/**
 * Aggregations cho dashboard tab Designer (Leader/Admin only). 3 view:
 *   - Leaderboard (1 row / sub-designer): count + avg time + errorRate
 *   - Timeline (per-day buckets cho 1 designer): line chart 4 series
 *   - Error stats (split by errorSource): pie + breakdown table
 *
 * Identity: assignee = user._id. Resolve fullName từ users collection.
 */
/** Ngưỡng done tối thiểu trong kỳ để xếp hạng hiệu suất chính thức. */
const PERF_MIN_DONE = 10;

/** Ngưỡng đơn xong tối thiểu (cửa sổ 60 ngày) để gợi ý level sản phẩm. */
const PRODUCT_SUGGEST_MIN_DONE = 5;

/** Percentile 0..1 của `v` trong `values` (tie lấy trung bình thứ hạng); ≤1 phần tử → 0.5. */
function percentileOf(values: number[], v: number): number {
  const n = values.length;
  if (n <= 1) return 0.5;
  let less = 0;
  let equal = 0;
  for (const x of values) {
    if (x < v) less++;
    else if (x === v) equal++;
  }
  return (less + (equal - 1) / 2) / (n - 1);
}

/** Cell ma trận team — 4 trạng thái + sự kiện bàn giao (Không làm được / Nhận thêm). */
type TeamDailyCellShape = {
  assigned: number;
  rework: number;
  inProgress: number;
  done: number;
  rejected: number;
  received: number;
  unfinished: number;
};

@Injectable()
export class DesignerStatsService {
  private readonly logger = new Logger(DesignerStatsService.name);

  constructor(
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    @InjectModel(UserEntity.name) private readonly userModel: Model<UserEntity>,
    @InjectModel(WorkshopConfigEntity.name)
    private readonly workshopConfigModel: Model<WorkshopConfigEntity>,
    @InjectModel(OrderLogEntity.name)
    private readonly orderLogModel: Model<OrderLogEntity>,
    @InjectModel(ProductConfigEntity.name)
    private readonly productConfigModel: Model<ProductConfigEntity>,
    private readonly roleRepository: RoleRepository,
  ) {}

  async getPerformance(from?: string, to?: string, userId?: string): Promise<DesignerLeaderboardRow[]> {
    const range = this.resolveRange(from, to);

    // 1) Snapshot counts theo status (không filter date).
    const statusMatch: Record<string, unknown> = {
      assignee: { $exists: true, $ne: null },
      designerStatus: { $exists: true },
    };
    if (userId) statusMatch.assignee = userId;
    const statusAgg = await this.orderModel.aggregate<{
      _id: { uid: string; status: DesignerStatus };
      count: number;
    }>([
      { $match: statusMatch },
      {
        $group: {
          _id: { uid: '$assignee', status: '$designerStatus' },
          count: { $sum: 1 },
        },
      },
    ]);

    // 2) Completed in period.
    const completedMatch: Record<string, unknown> = {
      designerStatus: DesignerStatus.Done,
      designerCompletedAt: { $gte: range.start, $lte: range.end },
    };
    if (userId) completedMatch.assignee = userId;
    const completedDocs = await this.orderModel
      .find(completedMatch, {
        assignee: 1,
        designerAssignedAt: 1,
        designerStartedAt: 1,
        designerFirstStartedAt: 1,
        designerCompletedAt: 1,
        designerReworkCount: 1,
        designerWorkMs: 1,
      })
      .lean();

    // 3) Auto-include designer users chưa có task → row 0 trong leaderboard.
    //    Lookup all Designer users + collect userIds from data.
    // CHỈ designer ĐANG BẬT — leaderboard loại người đã tắt (kể cả lịch sử).
    const designerRole = await this.roleRepository.findOne({ name: RoleType.Designer });
    const teamUsers = designerRole
      ? await this.userModel
          .find({ roleId: designerRole._id, status: Status.Active }, { _id: 1, fullName: 1, email: 1 })
          .lean()
      : [];
    // Khi xem stats 1 user cụ thể (self-scope) → luôn cho phép; ngược lại chỉ
    // tính user active.
    const activeIds = new Set(teamUsers.map((u) => String(u._id)));
    const allow = (uid: string) => (userId ? uid === userId : activeIds.has(uid));

    const userIds = new Set<string>();
    for (const row of statusAgg) if (allow(row._id.uid)) userIds.add(row._id.uid);
    for (const o of completedDocs) {
      const a = (o as { assignee?: string }).assignee;
      if (a && allow(a)) userIds.add(a);
    }
    if (!userId) for (const u of teamUsers) userIds.add(String(u._id));

    const userMap = new Map<string, { fullName: string; email?: string }>();
    for (const u of teamUsers) {
      userMap.set(String(u._id), { fullName: u.fullName, email: u.email });
    }

    // 4) Build rows.
    const rows = new Map<string, DesignerLeaderboardRow>();
    const ensureRow = (uid: string): DesignerLeaderboardRow => {
      let r = rows.get(uid);
      if (!r) {
        const u = userMap.get(uid);
        r = {
          userId: uid,
          fullName: u?.fullName || '(unknown)',
          email: u?.email,
          assignedCount: 0,
          inProgressCount: 0,
          reworkCount: 0,
          rejectedCount: 0,
          completedInPeriod: 0,
          fixedInPeriod: 0,
          totalRejected: 0,
          totalRework: 0,
          avgResponseMin: 0,
          avgWorkMin: 0,
          errorRate: 0,
        };
        rows.set(uid, r);
      }
      return r;
    };

    if (userId) {
      ensureRow(userId);
    } else {
      for (const uid of userIds) ensureRow(uid);
    }

    for (const row of statusAgg) {
      const r = ensureRow(row._id.uid);
      switch (row._id.status) {
        case DesignerStatus.Assigned:
          r.assignedCount = row.count;
          break;
        case DesignerStatus.InProgress:
          r.inProgressCount = row.count;
          break;
        case DesignerStatus.Rework:
          r.reworkCount = row.count;
          break;
        case DesignerStatus.Rejected:
          r.rejectedCount = row.count;
          break;
      }
    }

    const completedAgg = new Map<
      string,
      {
        responseMs: number;
        responseN: number;
        workMs: number;
        workN: number;
        reworkSum: number;
        n: number;
        fixedN: number;
      }
    >();
    for (const o of completedDocs) {
      const uid = (o as { assignee?: string }).assignee;
      if (!uid) continue;
      const c = completedAgg.get(uid) || {
        responseMs: 0,
        responseN: 0,
        workMs: 0,
        workN: 0,
        reworkSum: 0,
        n: 0,
        fixedN: 0,
      };
      c.n++;
      // "Đã sửa" = done trong period MÀ từng bị báo lỗi (designerReworkCount>0).
      if ((o.designerReworkCount || 0) > 0) c.fixedN++;
      const aAt = o.designerAssignedAt;
      const sAt = o.designerStartedAt;
      const fsAt = (o as { designerFirstStartedAt?: Date }).designerFirstStartedAt;
      const cAt = o.designerCompletedAt;
      // Response: ưu tiên firstStartedAt (immutable); fallback startedAt cho legacy.
      const respStart = fsAt || sAt;
      if (aAt && respStart) {
        c.responseMs += respStart.getTime() - aAt.getTime();
        c.responseN++;
      }
      // Work: cumulative workMs nếu có (chính xác qua các cycle); legacy fallback.
      const cumWorkMs = (o as { designerWorkMs?: number }).designerWorkMs;
      if (cumWorkMs && cumWorkMs > 0) {
        c.workMs += cumWorkMs;
        c.workN++;
      } else if (sAt && cAt) {
        c.workMs += cAt.getTime() - sAt.getTime();
        c.workN++;
      }
      c.reworkSum += o.designerReworkCount || 0;
      completedAgg.set(uid, c);
    }
    for (const [uid, c] of completedAgg) {
      const r = ensureRow(uid);
      r.completedInPeriod = c.n;
      r.fixedInPeriod = c.fixedN;
      r.avgResponseMin = c.responseN > 0 ? Math.round(c.responseMs / c.responseN / 60000) : 0;
      r.avgWorkMin = c.workN > 0 ? Math.round(c.workMs / c.workN / 60000) : 0;
      r.errorRate = c.n > 0 ? Math.round((c.reworkSum / c.n) * 100) / 100 : 0;
    }

    // ─── Total rework trong period ─────────────────────────────────
    // Đếm từ OrderLog (mỗi lần designerStatus chuyển sang rework ghi 1 log).
    // Group theo order.assignee hiện tại (đơn rework do người đang ôm sửa).
    const logAgg = await this.orderLogModel.aggregate<{
      _id: { uid: string };
      count: number;
    }>([
      {
        $match: {
          field: 'designerStatus',
          after: 'rework',
          createdAt: { $gte: range.start, $lte: range.end },
        },
      },
      { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
      { $unwind: { path: '$order', preserveNullAndEmptyArrays: false } },
      ...(userId ? [{ $match: { 'order.assignee': userId } as Record<string, unknown> }] : []),
      { $group: { _id: { uid: '$order.assignee' }, count: { $sum: 1 } } },
    ]);
    for (const row of logAgg) {
      if (!row._id.uid) continue;
      ensureRow(row._id.uid).totalRework = row.count;
    }

    // ─── Total "Không làm được" trong period ───────────────────────
    // Nguồn = mảng lịch sử `designerRejections` trên order (quy về `fromUserId`
    // = người bàn giao, ĐÚNG người kể cả khi đơn đã sang tay người khác). Đếm
    // theo mốc `at` rơi trong kỳ.
    const rejectedAgg = await this.orderModel.aggregate<{ _id: string; count: number }>([
      { $match: { designerRejections: { $exists: true, $ne: [] } } },
      { $unwind: '$designerRejections' },
      {
        $match: {
          'designerRejections.at': { $gte: range.start, $lte: range.end },
          ...(userId ? { 'designerRejections.fromUserId': userId } : {}),
        },
      },
      { $group: { _id: '$designerRejections.fromUserId', count: { $sum: 1 } } },
    ]);
    for (const row of rejectedAgg) {
      if (!row._id) continue;
      ensureRow(row._id).totalRejected = row.count;
    }

    return (
      [...rows.values()]
        // Loại row của designer đã tắt (ensureRow ở các loop trên có thể tạo lại).
        .filter((r) => allow(r.userId))
        .sort((a, b) => b.completedInPeriod - a.completedInPeriod || b.assignedCount - a.assignedCount)
    );
  }

  async getTimeline(userId: string, from?: string, to?: string): Promise<DesignerTimelineBucket[]> {
    const range = this.resolveRange(from, to);
    const tz = 'Asia/Ho_Chi_Minh';

    const bucket = async (field: string): Promise<Map<string, number>> => {
      const match: Record<string, unknown> = {
        assignee: userId,
        [field]: { $gte: range.start, $lte: range.end },
      };
      const agg = await this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: match },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: tz },
            },
            count: { $sum: 1 },
          },
        },
      ]);
      return new Map(agg.map((r) => [r._id, r.count]));
    };

    const [assigned, started, completed, rework] = await Promise.all([
      bucket('designerAssignedAt'),
      bucket('designerStartedAt'),
      bucket('designerCompletedAt'),
      bucket('designerReworkAt'),
    ]);

    const buckets: DesignerTimelineBucket[] = [];
    const cursor = new Date(range.start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= range.end.getTime()) {
      const key = cursor.toISOString().slice(0, 10);
      buckets.push({
        date: key,
        assigned: assigned.get(key) || 0,
        started: started.get(key) || 0,
        completed: completed.get(key) || 0,
        rework: rework.get(key) || 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return buckets;
  }

  async getErrorStats(from?: string, to?: string): Promise<ErrorStats> {
    const range = this.resolveRange(from, to);

    // Label resolution từ workshop_config (chỉ để hiển thị tên đẹp).
    const configs = await this.workshopConfigModel
      .find({ category: WorkshopConfigCategory.ProductionError }, { code: 1, name: 1, errorSource: 1 })
      .lean();
    const cfgMap = new Map<string, { label?: string }>();
    for (const c of configs as Array<{ code: string; name?: string }>) {
      cfgMap.set(c.code, { label: c.name });
    }

    // Group theo (code, source) — source giờ là field per-order, không
    // resolve qua config nữa. Cho phép user override config khi cần.
    const agg = await this.orderModel.aggregate<{
      _id: { code: string; source: 'designer' | 'factory' | null };
      count: number;
    }>([
      {
        $match: {
          productionError: { $exists: true, $nin: [null, ''] },
          updatedAt: { $gte: range.start, $lte: range.end },
          // Đơn chưa map xưởng bị loại — chỉ xem qua trang "Không xác định xưởng".
          factoryId: productionFactoryClause(this.orderModel.db),
        },
      },
      {
        $group: {
          _id: {
            code: '$productionError',
            source: { $ifNull: ['$productionErrorSource', null] },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const bySource = { designer: 0, factory: 0, unknown: 0 };
    // Aggregate per-code (sum tất cả source thành 1 row code).
    const byCodeMap = new Map<string, { label?: string; source?: 'designer' | 'factory'; count: number }>();
    for (const row of agg) {
      const src = row._id.source;
      if (src === 'designer') bySource.designer += row.count;
      else if (src === 'factory') bySource.factory += row.count;
      else bySource.unknown += row.count;

      const cur = byCodeMap.get(row._id.code) || { label: cfgMap.get(row._id.code)?.label, count: 0 };
      cur.count += row.count;
      // Source ở byCode chỉ là indication — lấy source chính (designer/factory)
      // nếu có; nếu cùng code có cả 2 source thì giữ source phổ biến hơn.
      if (src && (!cur.source || row.count > 0)) cur.source = src;
      byCodeMap.set(row._id.code, cur);
    }

    const byCode = [...byCodeMap.entries()]
      .map(([code, v]) => ({
        code,
        label: v.label,
        errorSource: v.source,
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      bySource,
      byCode,
      total: bySource.designer + bySource.factory + bySource.unknown,
    };
  }

  /**
   * Ma trận Designer × Ngày (inProductionAt, tz VN) trong N ngày gần nhất
   * (7/14/30) cho MỌI sub-designer. Snapshot lens — mỗi ô là số đơn VÀO SẢN
   * XUẤT ngày đó ĐANG ở từng trạng thái. Focus 3 trạng thái chưa xong
   * (assigned/rework/inProgress) + done kèm. Tự include designer chưa có đơn.
   *
   * Scope ĐỒNG BỘ với bảng Tổng quan N ngày (`getDailyOverview`): loại đơn hủy
   * + đơn chưa map xưởng; đơn của designer ĐÃ TẮT gộp vào dòng "Khác (đã tắt)"
   * thay vì bỏ — để bất biến `Tổng/ngày = assignedToolError + assignedWasOk`
   * (hàng "Đã gán designer" bên Tổng quan) đúng từng ngày.
   */
  async getTeamDailyBreakdown(
    rangeDays: number,
    from?: string,
    to?: string,
    type?: string,
    customer?: string,
  ): Promise<{
    days: string[];
    rows: {
      userId: string;
      fullName: string;
      email?: string;
      cells: TeamDailyCellShape[];
      totals: TeamDailyCellShape;
      metrics?: {
        totalTasks: number;
        productTypes: number;
        productTypeNames: string[];
        avgResponseMin: number;
        avgWorkMin: number;
      };
    }[];
    columnTotals: TeamDailyCellShape[];
    grandTotals: TeamDailyCellShape;
    rangeDays: number;
  }> {
    const MS_DAY = 86_400_000;
    const DAY_CAP = 100; // giới hạn số cột sinh ra cho range tùy chỉnh rộng.
    const vnStart = (d: string) => new Date(`${d}T00:00:00+07:00`);
    const vnEnd = (d: string) => new Date(`${d}T23:59:59.999+07:00`);
    const vnToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Danh sách ngày (mới → cũ) + index map để đổ cell về đúng cột.
    const days: string[] = [];
    const dayIndex = new Map<string, number>();
    let start: Date;
    let end: Date;
    if (from || to) {
      // Khoảng tùy chỉnh (cho biểu đồ "theo designer"). Match theo [from,to] đầy
      // đủ; day-list cap DAY_CAP (chỉ ảnh hưởng cells, KHÔNG ảnh hưởng totals).
      const f = (from || to)!.slice(0, 10);
      const t = (to || from)!.slice(0, 10);
      start = vnStart(f);
      end = vnEnd(t);
      const startMs = start.getTime();
      let cur = vnStart(t).getTime();
      let i = 0;
      while (cur >= startMs && i < DAY_CAP) {
        const d = new Date(cur + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
        dayIndex.set(d, i);
        days.push(d);
        cur -= MS_DAY;
        i++;
      }
    } else {
      const baseMs = vnStart(vnToday).getTime();
      for (let i = 0; i < rangeDays; i++) {
        const d = new Date(baseMs - i * MS_DAY + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
        dayIndex.set(d, i);
        days.push(d);
      }
      start = new Date(baseMs - (rangeDays - 1) * MS_DAY);
      end = vnEnd(vnToday);
    }

    type CellKey = 'assigned' | 'rework' | 'inProgress' | 'done';
    const statusKey: Partial<Record<DesignerStatus, CellKey>> = {
      [DesignerStatus.Assigned]: 'assigned',
      [DesignerStatus.Rework]: 'rework',
      [DesignerStatus.InProgress]: 'inProgress',
      [DesignerStatus.Done]: 'done',
    };
    const emptyCell = () => ({
      assigned: 0,
      rework: 0,
      inProgress: 0,
      done: 0,
      rejected: 0,
      received: 0,
      unfinished: 0,
    });

    // Filter sản phẩm / khách hàng (áp dụng chung cho ma trận + 2 biểu đồ cột).
    const extraMatch: Record<string, unknown> = {};
    if (type) extraMatch.type = type;
    if (customer) extraMatch.userSku = customer;

    // Match sự kiện bàn giao "Không làm được" — cùng scope đơn với ma trận
    // (KHÔNG ràng designerStatus/assignee hiện tại — đơn có thể đã đi tiếp).
    const rejectionScope = {
      'designerRejections.0': { $exists: true },
      inProductionAt: { $gte: start, $lte: end },
      cancelledAt: null,
      factoryId: productionFactoryClause(this.orderModel.db),
      ...extraMatch,
    };
    const rejectionDayExpr = {
      $dateToString: { format: '%Y-%m-%d', date: '$inProductionAt', timezone: '+07:00' },
    };
    const buildRejectionAgg = (uidField: '$designerRejections.fromUserId' | '$designerRejections.toUserId') =>
      this.orderModel.aggregate<{ _id: { uid: string; day: string }; count: number }>([
        { $match: rejectionScope },
        { $unwind: '$designerRejections' },
        { $group: { _id: { uid: uidField, day: rejectionDayExpr }, count: { $sum: 1 } } },
      ]);

    // Match dùng chung cho ma trận + metrics per-designer (widget Top Designer).
    const matrixMatch = {
      assignee: { $exists: true, $nin: [null, ''] },
      inProductionAt: { $gte: start, $lte: end },
      designerStatus: {
        $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework, DesignerStatus.Done],
      },
      // Đồng bộ scope với Tổng quan: loại đơn hủy + đơn chưa map xưởng.
      cancelledAt: null,
      factoryId: productionFactoryClause(this.orderModel.db),
      ...extraMatch,
    };

    const [agg, rejAgg, recvAgg, metricsAgg, designerRole] = await Promise.all([
      this.orderModel.aggregate<{
        _id: { uid: string; day: string; status: DesignerStatus };
        count: number;
      }>([
        { $match: matrixMatch },
        {
          $group: {
            _id: {
              uid: '$assignee',
              day: { $dateToString: { format: '%Y-%m-%d', date: '$inProductionAt', timezone: '+07:00' } },
              status: '$designerStatus',
            },
            count: { $sum: 1 },
          },
        },
      ]),
      // Số LẦN "Không làm được" (bàn giao đi) theo (designer, ngày vào SX).
      buildRejectionAgg('$designerRejections.fromUserId'),
      // Số LẦN nhận bàn giao thêm theo (designer, ngày vào SX).
      buildRejectionAgg('$designerRejections.toUserId'),
      this.orderModel.aggregate<{
        _id: string;
        totalTasks: number;
        typeSet: string[];
        responseMsSum: number;
        responseN: number;
        workMsSum: number;
        workN: number;
      }>([
        { $match: matrixMatch },
        {
          $group: {
            _id: '$assignee',
            totalTasks: { $sum: 1 },
            // Số LOẠI sản phẩm khác nhau (order.type) — KHÔNG phải tổng quantity
            // (mỗi production = 1 sản phẩm nên sum quantity ≈ số task, vô nghĩa).
            typeSet: { $addToSet: { $ifNull: ['$type', ''] } },
            ...this.designerTimeGroupFields(),
          },
        },
      ]),
      this.roleRepository.findOne({ name: RoleType.Designer }),
    ]);

    // CHỈ designer ĐANG BẬT — thống kê loại người đã tắt.
    const teamUsers = designerRole
      ? await this.userModel
          .find({ roleId: designerRole._id, status: Status.Active }, { _id: 1, fullName: 1, email: 1 })
          .lean()
      : [];
    const activeIds = new Set(teamUsers.map((u) => String(u._id)));

    const nameMap = new Map<string, { fullName: string; email?: string }>();
    for (const u of teamUsers) nameMap.set(String(u._id), { fullName: u.fullName, email: u.email });

    const KEYS = ['assigned', 'rework', 'inProgress', 'done', 'rejected', 'received', 'unfinished'] as const;
    const rowCells = new Map<string, ReturnType<typeof emptyCell>[]>();
    const rowTotals = new Map<string, ReturnType<typeof emptyCell>>();
    const ensureRow = (uid: string) => {
      if (!rowCells.has(uid))
        rowCells.set(
          uid,
          days.map(() => emptyCell()),
        );
      if (!rowTotals.has(uid)) rowTotals.set(uid, emptyCell());
    };
    if (designerRole) for (const u of teamUsers) ensureRow(String(u._id));

    // Đơn gán cho designer ĐÃ TẮT / assignee ngoài team → gộp 1 dòng "Khác" để
    // Tổng/ngày vẫn đếm đủ mọi đơn đã gán (khớp hàng "Đã gán designer" Tổng quan).
    const INACTIVE_UID = '__inactive__';
    for (const r of agg) {
      const key = statusKey[r._id.status];
      if (!key) continue;
      const uid = activeIds.has(r._id.uid) ? r._id.uid : INACTIVE_UID;
      ensureRow(uid);
      // Totals cộng TRỰC TIẾP từ agg → đúng cho mọi khoảng (kể cả day-list bị cap).
      const tt = rowTotals.get(uid)!;
      tt[key] += r.count;
      if (key !== 'done') tt.unfinished += r.count;
      // Cells chỉ đổ khi ngày nằm trong day-list (preset ≤30; range cap 100).
      const col = dayIndex.get(r._id.day);
      if (col !== undefined) {
        const c = rowCells.get(uid)![col];
        c[key] += r.count;
        if (key !== 'done') c.unfinished += r.count;
      }
    }
    // Đổ sự kiện bàn giao vào cells/totals — cùng bucket "Khác" cho user đã tắt.
    const bumpEvents = (list: { _id: { uid: string; day: string }; count: number }[], key: 'rejected' | 'received') => {
      for (const r of list) {
        if (!r._id.uid) continue;
        const uid = activeIds.has(r._id.uid) ? r._id.uid : INACTIVE_UID;
        ensureRow(uid);
        rowTotals.get(uid)![key] += r.count;
        const col = dayIndex.get(r._id.day);
        if (col !== undefined) rowCells.get(uid)![col][key] += r.count;
      }
    };
    bumpEvents(rejAgg, 'rejected');
    bumpEvents(recvAgg, 'received');
    nameMap.set(INACTIVE_UID, { fullName: 'Khác (designer đã tắt)' });

    // Resolve tên cho assignee ngoài team (nếu có).
    const missingIds = [...rowTotals.keys()].filter((id) => !nameMap.has(id));
    if (missingIds.length > 0) {
      const extra = await this.userModel.find({ _id: { $in: missingIds } }, { _id: 1, fullName: 1, email: 1 }).lean();
      for (const u of extra) nameMap.set(String(u._id), { fullName: u.fullName, email: u.email });
    }

    // Metrics chỉ gắn cho designer đang bật — row "Khác (đã tắt)" bỏ qua.
    const metricsMap = new Map<
      string,
      {
        totalTasks: number;
        productTypes: number;
        productTypeNames: string[];
        avgResponseMin: number;
        avgWorkMin: number;
      }
    >();
    for (const m of metricsAgg) {
      if (!m._id || !activeIds.has(m._id)) continue;
      const typeNames = m.typeSet.filter((s) => s !== '').sort((a, b) => a.localeCompare(b));
      metricsMap.set(m._id, {
        totalTasks: m.totalTasks,
        productTypes: typeNames.length,
        // Cap 30 tên cho tooltip — FE hiện "+N khác" nếu productTypes lớn hơn.
        productTypeNames: typeNames.slice(0, 30),
        avgResponseMin: m.responseN > 0 ? Math.round(m.responseMsSum / m.responseN / 60000) : 0,
        avgWorkMin: m.workN > 0 ? Math.round(m.workMsSum / m.workN / 60000) : 0,
      });
    }

    const columnTotals = days.map(() => emptyCell());
    const grandTotals = emptyCell();
    const rows = [...rowTotals.entries()].map(([uid, totals]) => {
      const cells = rowCells.get(uid)!;
      cells.forEach((c, i) => {
        for (const k of KEYS) columnTotals[i][k] += c[k];
      });
      for (const k of KEYS) grandTotals[k] += totals[k];
      const info = nameMap.get(uid);
      return {
        userId: uid,
        fullName: info?.fullName || `#${uid.slice(-4)}`,
        email: info?.email,
        cells,
        totals,
        metrics: metricsMap.get(uid),
      };
    });

    // Sort: tồn nhiều lên đầu; hết tồn thì theo done desc; rồi tên.
    rows.sort(
      (a, b) =>
        b.totals.unfinished - a.totals.unfinished ||
        b.totals.done - a.totals.done ||
        a.fullName.localeCompare(b.fullName),
    );

    return { days, rows, columnTotals, grandTotals, rangeDays };
  }

  /**
   * Expression aggregation dùng chung tính thời gian nhận/làm task designer —
   * CÙNG công thức leaderboard `getPerformance` (response = firstStartedAt ||
   * startedAt − assignedAt; work = designerWorkMs cộng dồn, fallback
   * completedAt − startedAt cho đơn legacy). Chỉ tính trên task done.
   */
  private designerTimeAggExprs() {
    const isDone = { $eq: ['$designerStatus', DesignerStatus.Done] };
    const respStart = { $ifNull: ['$designerFirstStartedAt', { $ifNull: ['$designerStartedAt', null] }] };
    const hasResp = {
      $and: [isDone, { $ne: [respStart, null] }, { $ne: [{ $ifNull: ['$designerAssignedAt', null] }, null] }],
    };
    const cumWork = { $ifNull: ['$designerWorkMs', 0] };
    const hasCumWork = { $gt: [cumWork, 0] };
    const hasLegacyWork = {
      $and: [
        { $ne: [{ $ifNull: ['$designerStartedAt', null] }, null] },
        { $ne: [{ $ifNull: ['$designerCompletedAt', null] }, null] },
      ],
    };
    const hasWork = { $and: [isDone, { $or: [hasCumWork, hasLegacyWork] }] };
    return { isDone, respStart, hasResp, cumWork, hasCumWork, hasWork };
  }

  /**
   * 4 field `$group` tổng thời gian nhận/làm — dùng bởi metrics per-designer
   * (`getTeamDailyBreakdown`) + per-sản phẩm (`getProductTimeOverview`).
   */
  private designerTimeGroupFields() {
    const e = this.designerTimeAggExprs();
    return {
      responseMsSum: {
        $sum: { $cond: [e.hasResp, { $subtract: [e.respStart, '$designerAssignedAt'] }, 0] },
      },
      responseN: { $sum: { $cond: [e.hasResp, 1, 0] } },
      workMsSum: {
        $sum: {
          $cond: [
            e.hasWork,
            { $cond: [e.hasCumWork, e.cumWork, { $subtract: ['$designerCompletedAt', '$designerStartedAt'] }] },
            0,
          ],
        },
      },
      workN: { $sum: { $cond: [e.hasWork, 1, 0] } },
    };
  }

  /** Match dùng chung của scope "task đã gán designer trong kỳ" (mirror ma trận). */
  private buildProductTimeMatch(
    start: Date,
    end: Date,
    type?: string,
    customer?: string,
    designerId?: string,
  ): Record<string, unknown> {
    const match: Record<string, unknown> = {
      // designerId set → chế độ "Xem chi tiết" 1 designer từ widget Top Designer.
      assignee: designerId || { $exists: true, $nin: [null, ''] },
      inProductionAt: { $gte: start, $lte: end },
      designerStatus: {
        $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework, DesignerStatus.Done],
      },
      cancelledAt: null,
      factoryId: productionFactoryClause(this.orderModel.db),
    };
    if (type !== undefined) match.type = type;
    if (customer) match.userSku = customer;
    return match;
  }

  /**
   * Panel "Xem tất cả" từ widget Top Designer: thời gian TB nhận/làm task theo
   * TỪNG loại sản phẩm (`order.type`) của TOÀN BỘ designer trong kỳ lọc.
   * Cùng scope ma trận (`inProductionAt` + type/customer + loại hủy/chưa map).
   *
   * Mỗi row kèm level chính thức (`ProductConfig.level`, khớp fullName ~ type
   * case-insensitive như importOrders, fallback `productConfigId` trên đơn) +
   * gợi ý level 1..10 từ `computeProductLevelSuggestions()` (60 ngày cố định).
   */
  async getProductTimeOverview(
    from?: string,
    to?: string,
    type?: string,
    customer?: string,
    designerId?: string,
  ): Promise<{ rows: ProductTimeRow[] }> {
    const { start, end } = this.resolveVnWindow(7, from, to);
    const { isDone } = this.designerTimeAggExprs();
    const [agg, suggestByType, configs] = await Promise.all([
      this.orderModel.aggregate<{
        _id: string | null;
        mockupUrl?: string | null;
        productConfigId?: string | null;
        taskCount: number;
        doneCount: number;
        responseMsSum: number;
        responseN: number;
        workMsSum: number;
        workN: number;
      }>([
        { $match: this.buildProductTimeMatch(start, end, type || undefined, customer, designerId) },
        {
          $group: {
            _id: { $ifNull: ['$type', ''] },
            // Ảnh đại diện sản phẩm: $max ưu tiên string non-null (null < string).
            mockupUrl: { $max: '$mockupUrl' },
            productConfigId: { $max: '$productConfigId' },
            taskCount: { $sum: 1 },
            doneCount: { $sum: { $cond: [isDone, 1, 0] } },
            ...this.designerTimeGroupFields(),
          },
        },
        { $sort: { taskCount: -1 } },
      ]),
      this.computeProductLevelSuggestions(),
      this.productConfigModel
        .find({ deletedAt: { $exists: false } }, { fullName: 1, level: 1 })
        .lean<{ _id: unknown; fullName: string; level?: number }[]>(),
    ]);

    const configByName = new Map<string, { id: string; level?: number }>();
    const configById = new Map<string, { id: string; level?: number }>();
    for (const c of configs) {
      const entry = { id: String(c._id), level: c.level };
      configByName.set(c.fullName.trim().toLowerCase(), entry);
      configById.set(entry.id, entry);
    }

    return {
      rows: agg.map((r) => {
        const typeKey = r._id || '';
        const cfg =
          configByName.get(typeKey.trim().toLowerCase()) ||
          (r.productConfigId ? configById.get(String(r.productConfigId)) : undefined);
        return {
          type: typeKey,
          mockupUrl: r.mockupUrl || undefined,
          taskCount: r.taskCount,
          doneCount: r.doneCount,
          avgResponseMin: r.responseN > 0 ? Math.round(r.responseMsSum / r.responseN / 60000) : 0,
          avgWorkMin: r.workN > 0 ? Math.round(r.workMsSum / r.workN / 60000) : 0,
          productConfigId: cfg?.id,
          level: cfg?.level,
          ...suggestByType.get(typeKey),
        };
      }),
    };
  }

  /**
   * Gợi ý level sản phẩm 1..10 — thang TƯƠNG ĐỐI (percentile nội bộ, tự cân
   * chỉnh) trên cửa sổ 60 ngày CỐ ĐỊNH toàn hệ thống (không theo kỳ lọc để
   * gợi ý không nhảy khi admin đổi filter): 0.7 × percentile thời gian làm TB
   * + 0.3 × percentile tỉ lệ làm lại (reworkSum/done). Chỉ xét sản phẩm có
   * ≥ PRODUCT_SUGGEST_MIN_DONE đơn xong.
   */
  private async computeProductLevelSuggestions(): Promise<
    Map<string, Pick<ProductTimeRow, 'suggestedLevel' | 'suggestDone' | 'suggestAvgWorkMin' | 'suggestReworkPct'>>
  > {
    const sixty = this.resolveVnWindow(60);
    const { isDone } = this.designerTimeAggExprs();
    const agg = await this.orderModel.aggregate<{
      _id: string | null;
      doneCount: number;
      reworkSum: number;
      responseMsSum: number;
      responseN: number;
      workMsSum: number;
      workN: number;
    }>([
      { $match: this.buildProductTimeMatch(sixty.start, sixty.end) },
      {
        $group: {
          _id: { $ifNull: ['$type', ''] },
          doneCount: { $sum: { $cond: [isDone, 1, 0] } },
          reworkSum: { $sum: { $cond: [isDone, { $ifNull: ['$designerReworkCount', 0] }, 0] } },
          ...this.designerTimeGroupFields(),
        },
      },
    ]);

    const eligible = agg.filter((s) => s.doneCount >= PRODUCT_SUGGEST_MIN_DONE && s.workN > 0);
    const avgWorks = eligible.map((s) => s.workMsSum / s.workN);
    const reworkRates = eligible.map((s) => s.reworkSum / s.doneCount);
    const result = new Map<
      string,
      Pick<ProductTimeRow, 'suggestedLevel' | 'suggestDone' | 'suggestAvgWorkMin' | 'suggestReworkPct'>
    >();
    for (const s of eligible) {
      const avgWork = s.workMsSum / s.workN;
      const reworkRate = s.reworkSum / s.doneCount;
      const difficulty = 0.7 * percentileOf(avgWorks, avgWork) + 0.3 * percentileOf(reworkRates, reworkRate);
      result.set(s._id || '', {
        suggestedLevel: Math.min(10, Math.max(1, 1 + Math.round(difficulty * 9))),
        suggestDone: s.doneCount,
        suggestAvgWorkMin: Math.round(avgWork / 60000),
        suggestReworkPct: Math.round(reworkRate * 100),
      });
    }
    return result;
  }

  /**
   * Drill 1 sản phẩm trong panel "Xem tất cả": thống kê per-designer (làm bao
   * đơn của sản phẩm đó + TB nhận/làm — aggregation trên TOÀN BỘ đơn khớp,
   * không cap) + danh sách đơn/thiết kế (cap 300 mới nhất theo `inProductionAt`)
   * kèm thời gian nhận/làm từng đơn để FE gom nhóm theo designer. Cùng công
   * thức leaderboard; đơn chưa đủ mốc thời gian → bỏ trống.
   */
  async getProductTimeOrders(
    productType: string,
    from?: string,
    to?: string,
    customer?: string,
    designerId?: string,
  ): Promise<{
    designers: {
      userId: string;
      name?: string;
      taskCount: number;
      doneCount: number;
      avgResponseMin: number;
      avgWorkMin: number;
    }[];
    rows: {
      _id: string;
      productionId?: string;
      userSku?: string;
      assigneeId?: string;
      assigneeName?: string;
      designerStatus?: string;
      mockupUrl?: string;
      inProductionAt?: string;
      responseMin?: number;
      workMin?: number;
    }[];
  }> {
    const { start, end } = this.resolveVnWindow(7, from, to);
    const match = this.buildProductTimeMatch(start, end, undefined, customer, designerId);
    match.type = productType === '' ? { $in: [null, ''] } : productType;
    const { isDone } = this.designerTimeAggExprs();
    const [statAgg, docs] = await Promise.all([
      this.orderModel.aggregate<{
        _id: string;
        taskCount: number;
        doneCount: number;
        responseMsSum: number;
        responseN: number;
        workMsSum: number;
        workN: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: '$assignee',
            taskCount: { $sum: 1 },
            doneCount: { $sum: { $cond: [isDone, 1, 0] } },
            ...this.designerTimeGroupFields(),
          },
        },
        { $sort: { taskCount: -1 } },
      ]),
      this.orderModel
        .find(match, {
          productionId: 1,
          userSku: 1,
          assignee: 1,
          designerStatus: 1,
          designerAssignedAt: 1,
          designerFirstStartedAt: 1,
          designerStartedAt: 1,
          designerCompletedAt: 1,
          designerWorkMs: 1,
          mockupUrl: 1,
          inProductionAt: 1,
        })
        .sort({ inProductionAt: -1 })
        .limit(300)
        .lean(),
    ]);

    const assigneeIds = [
      ...new Set([...docs.map((d) => String(d.assignee || '')), ...statAgg.map((s) => String(s._id || ''))]),
    ].filter(Boolean);
    const users = assigneeIds.length
      ? await this.userModel.find({ _id: { $in: assigneeIds } }, { _id: 1, fullName: 1 }).lean()
      : [];
    const nameMap = new Map(users.map((u) => [String(u._id), u.fullName]));

    return {
      designers: statAgg
        .filter((s) => s._id)
        .map((s) => ({
          userId: String(s._id),
          name: nameMap.get(String(s._id)) || undefined,
          taskCount: s.taskCount,
          doneCount: s.doneCount,
          avgResponseMin: s.responseN > 0 ? Math.round(s.responseMsSum / s.responseN / 60000) : 0,
          avgWorkMin: s.workN > 0 ? Math.round(s.workMsSum / s.workN / 60000) : 0,
        })),
      rows: docs.map((d) => {
        const respStart = d.designerFirstStartedAt || d.designerStartedAt;
        const responseMin =
          d.designerAssignedAt && respStart
            ? Math.max(0, Math.round((respStart.getTime() - d.designerAssignedAt.getTime()) / 60000))
            : undefined;
        let workMin: number | undefined;
        if (d.designerStatus === DesignerStatus.Done) {
          if (d.designerWorkMs && d.designerWorkMs > 0) workMin = Math.round(d.designerWorkMs / 60000);
          else if (d.designerStartedAt && d.designerCompletedAt)
            workMin = Math.max(
              0,
              Math.round((d.designerCompletedAt.getTime() - d.designerStartedAt.getTime()) / 60000),
            );
        }
        return {
          _id: String(d._id),
          productionId: d.productionId || undefined,
          userSku: d.userSku || undefined,
          assigneeId: d.assignee ? String(d.assignee) : undefined,
          assigneeName: nameMap.get(String(d.assignee || '')) || undefined,
          designerStatus: d.designerStatus || undefined,
          mockupUrl: (d as { mockupUrl?: string }).mockupUrl || undefined,
          inProductionAt: d.inProductionAt ? new Date(d.inProductionAt).toISOString() : undefined,
          responseMin,
          workMin,
        };
      }),
    };
  }

  // ─── Performance scores (bảng xếp hạng hiệu suất + designerLevel) ────

  /**
   * Số liệu thô per-designer trong 1 cửa sổ ngày — input cho scoring.
   * `expectedMs` = Σ(giờ TB của TEAM cho loại SP đó × số đơn done của designer
   * theo loại) → chuẩn hóa tốc độ theo ĐỘ KHÓ rổ sản phẩm họ thực làm.
   */
  private async computePerfWindow(
    start: Date,
    end: Date,
  ): Promise<
    Map<
      string,
      {
        tasks: number;
        done: number;
        workMs: number;
        workN: number;
        respMs: number;
        respN: number;
        rework: number;
        expectedMs: number;
        rejections: number;
        claims: number;
      }
    >
  > {
    const { isDone } = this.designerTimeAggExprs();
    const [agg, rejAgg, claimAgg] = await Promise.all([
      this.orderModel.aggregate<{
        _id: { uid: string; type: string };
        taskCount: number;
        done: number;
        reworkSum: number;
        responseMsSum: number;
        responseN: number;
        workMsSum: number;
        workN: number;
      }>([
        { $match: this.buildProductTimeMatch(start, end) },
        {
          $group: {
            _id: { uid: '$assignee', type: { $ifNull: ['$type', ''] } },
            taskCount: { $sum: 1 },
            done: { $sum: { $cond: [isDone, 1, 0] } },
            reworkSum: { $sum: { $cond: [isDone, { $ifNull: ['$designerReworkCount', 0] }, 0] } },
            ...this.designerTimeGroupFields(),
          },
        },
      ]),
      // Số lần "Không làm được" (bàn giao đi) — trừ vào độ tin cậy.
      this.orderModel.aggregate<{ _id: string; count: number }>([
        {
          $match: {
            'designerRejections.0': { $exists: true },
            inProductionAt: { $gte: start, $lte: end },
            cancelledAt: null,
            factoryId: productionFactoryClause(this.orderModel.db),
          },
        },
        { $unwind: '$designerRejections' },
        { $group: { _id: '$designerRejections.fromUserId', count: { $sum: 1 } } },
      ]),
      // Chủ động "Nhận về mình": log đổi assignee mà ACTOR chính là người được
      // gán (leader gán hộ → after ≠ userId → không tính). Trục thời gian =
      // createdAt của log (thời điểm bấm nút).
      this.orderLogModel.aggregate<{ _id: string; count: number }>([
        {
          $match: {
            field: 'assignee',
            userId: { $exists: true, $nin: [null, ''] },
            createdAt: { $gte: start, $lte: end },
            $expr: { $eq: ['$after', '$userId'] },
          },
        },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ]),
    ]);

    const teamType = new Map<string, { ms: number; n: number }>();
    for (const r of agg) {
      const t = teamType.get(r._id.type) || { ms: 0, n: 0 };
      t.ms += r.workMsSum;
      t.n += r.workN;
      teamType.set(r._id.type, t);
    }

    const perUid = new Map<
      string,
      {
        tasks: number;
        done: number;
        workMs: number;
        workN: number;
        respMs: number;
        respN: number;
        rework: number;
        expectedMs: number;
        rejections: number;
        claims: number;
      }
    >();
    const ensure = (uid: string) => {
      let u = perUid.get(uid);
      if (!u) {
        u = {
          tasks: 0,
          done: 0,
          workMs: 0,
          workN: 0,
          respMs: 0,
          respN: 0,
          rework: 0,
          expectedMs: 0,
          rejections: 0,
          claims: 0,
        };
        perUid.set(uid, u);
      }
      return u;
    };
    for (const r of agg) {
      const u = ensure(r._id.uid);
      u.tasks += r.taskCount;
      u.done += r.done;
      u.workMs += r.workMsSum;
      u.workN += r.workN;
      u.respMs += r.responseMsSum;
      u.respN += r.responseN;
      u.rework += r.reworkSum;
      const tt = teamType.get(r._id.type)!;
      if (tt.n > 0 && r.workN > 0) u.expectedMs += (tt.ms / tt.n) * r.workN;
    }
    for (const r of rejAgg) if (r._id) ensure(r._id).rejections += r.count;
    for (const r of claimAgg) if (r._id) ensure(r._id).claims += r.count;
    return perUid;
  }

  /**
   * Chấm điểm 0-100 từ số liệu cửa sổ. 6 thành phần (mỗi cái 0..1, 0.5 =
   * trung bình team / thiếu dữ liệu): tốc độ chuẩn hóa 30% + chất lượng 25%
   * + sản lượng 15% + phản hồi 10% + độ tin cậy 10% + chủ động nhận task 10%
   * (0 lần = 0.5 trung lập, không phạt người không tự nhận). Median tính NỘI
   * BỘ cửa sổ trên designer đang bật.
   */
  private scorePerfWindow(perUid: Awaited<ReturnType<DesignerStatsService['computePerfWindow']>>): Map<
    string,
    {
      score: number;
      insufficient: boolean;
      components: PerformanceComponents;
      avgWorkMin: number;
      avgResponseMin: number;
      reworkCount: number;
      rejections: number;
      claims: number;
      done: number;
      tasks: number;
    }
  > {
    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const medDone = median([...perUid.values()].map((u) => u.done).filter((d) => d > 0));
    const medResp = median([...perUid.values()].filter((u) => u.respN > 0).map((u) => u.respMs / u.respN));
    const medClaims = median([...perUid.values()].map((u) => u.claims).filter((c) => c > 0));
    const clamp02 = (v: number) => Math.max(0, Math.min(2, v));

    const out = new Map<
      string,
      {
        score: number;
        insufficient: boolean;
        components: PerformanceComponents;
        avgWorkMin: number;
        avgResponseMin: number;
        reworkCount: number;
        rejections: number;
        claims: number;
        done: number;
        tasks: number;
      }
    >();
    for (const [uid, u] of perUid) {
      // >1 = nhanh hơn mặt bằng team trên cùng rổ sản phẩm → map [0..2]/2.
      const speed = u.workN > 0 && u.workMs > 0 && u.expectedMs > 0 ? clamp02(u.expectedMs / u.workMs) / 2 : 0.5;
      const quality = u.done > 0 ? 1 - Math.min(1, u.rework / u.done) : 0.5;
      const throughput = medDone > 0 ? clamp02(u.done / medDone) / 2 : 0.5;
      const avgRespMs = u.respN > 0 ? u.respMs / u.respN : 0;
      const response = u.respN > 0 && medResp > 0 ? (avgRespMs > 0 ? clamp02(medResp / avgRespMs) / 2 : 1) : 0.5;
      const reliability = u.tasks > 0 ? 1 - Math.min(1, u.rejections / u.tasks) : 0.5;
      // Chủ động: 0 lần tự nhận = 0.5 trung lập; = median người-có-nhận → 0.75;
      // gấp đôi median → 1. Chỉ thưởng, không phạt dưới mức trung lập.
      const proactive = u.claims === 0 || medClaims === 0 ? 0.5 : Math.min(1, 0.5 + (u.claims / medClaims) * 0.25);
      const score = Math.round(
        100 * (0.3 * speed + 0.25 * quality + 0.15 * throughput + 0.1 * response + 0.1 * reliability + 0.1 * proactive),
      );
      out.set(uid, {
        score,
        insufficient: u.done < PERF_MIN_DONE,
        components: { speed, quality, throughput, response, reliability, proactive },
        avgWorkMin: u.workN > 0 ? Math.round(u.workMs / u.workN / 60000) : 0,
        avgResponseMin: u.respN > 0 ? Math.round(u.respMs / u.respN / 60000) : 0,
        reworkCount: u.rework,
        rejections: u.rejections,
        claims: u.claims,
        done: u.done,
        tasks: u.tasks,
      });
    }
    return out;
  }

  /**
   * Bảng xếp hạng hiệu suất (tab Designer): điểm + hạng S/A/B/C/D theo kỳ lọc,
   * trend so kỳ liền trước cùng độ dài, hạng gợi ý từ rolling 60 ngày (nguồn
   * cho `designerLevel`) + level chính thức đang set. Chỉ designer đang bật.
   */
  async getPerformanceScores(from?: string, to?: string): Promise<{ rows: PerformanceScoreRow[]; minDone: number }> {
    const { start, end } = this.resolveVnWindow(7, from, to);
    const winMs = end.getTime() - start.getTime() + 1;
    const sixty = this.resolveVnWindow(60);
    const [curW, prevW, sixtyW, designerRole] = await Promise.all([
      this.computePerfWindow(start, end),
      this.computePerfWindow(new Date(start.getTime() - winMs), new Date(start.getTime() - 1)),
      this.computePerfWindow(sixty.start, sixty.end),
      this.roleRepository.findOne({ name: RoleType.Designer }),
    ]);
    const teamUsers = designerRole
      ? await this.userModel
          .find(
            { roleId: designerRole._id, status: Status.Active },
            { _id: 1, fullName: 1, email: 1, designerLevel: 1 },
          )
          .lean()
      : [];
    const activeIds = new Set(teamUsers.map((u) => String(u._id)));
    // Median chỉ tính trong team đang bật — loại assignee đã tắt/ngoài team.
    const onlyTeam = (m: Awaited<ReturnType<DesignerStatsService['computePerfWindow']>>) => {
      const n = new Map<string, ReturnType<typeof m.get> & object>() as typeof m;
      for (const [k, v] of m) if (activeIds.has(k)) n.set(k, v);
      return n;
    };
    const curS = this.scorePerfWindow(onlyTeam(curW));
    const prevS = this.scorePerfWindow(onlyTeam(prevW));
    const sixtyS = this.scorePerfWindow(onlyTeam(sixtyW));

    const rows: PerformanceScoreRow[] = teamUsers.map((u) => {
      const uid = String(u._id);
      const cur = curS.get(uid);
      const prev = prevS.get(uid);
      const sx = sixtyS.get(uid);
      const score = cur?.score ?? 50; // không có task nào trong kỳ → toàn neutral 0.5
      return {
        userId: uid,
        fullName: u.fullName,
        email: u.email,
        totalTasks: cur?.tasks ?? 0,
        done: cur?.done ?? 0,
        score,
        rank: rankFromScore(score),
        insufficient: cur ? cur.insufficient : true,
        components: cur?.components ?? {
          speed: 0.5,
          quality: 0.5,
          throughput: 0.5,
          response: 0.5,
          reliability: 0.5,
          proactive: 0.5,
        },
        avgWorkMin: cur?.avgWorkMin ?? 0,
        avgResponseMin: cur?.avgResponseMin ?? 0,
        reworkCount: cur?.reworkCount ?? 0,
        rejections: cur?.rejections ?? 0,
        claims: cur?.claims ?? 0,
        trend: cur && !cur.insufficient && prev && !prev.insufficient ? cur.score - prev.score : null,
        suggestedLevel: sx && !sx.insufficient ? rankFromScore(sx.score) : null,
        designerLevel: (u as { designerLevel?: DesignerRank }).designerLevel,
      };
    });
    // Đủ dữ liệu lên trước, trong nhóm sort điểm giảm dần.
    rows.sort((a, b) => Number(a.insufficient) - Number(b.insufficient) || b.score - a.score);
    return { rows, minDone: PERF_MIN_DONE };
  }

  /**
   * Set/xóa level chính thức (S-D) cho 1 designer — CHỈ tài khoản role
   * Designer. Gọi từ bảng xếp hạng (Admin).
   */
  async setDesignerLevel(
    userId: string,
    level: DesignerRank | null,
  ): Promise<{ userId: string; level: DesignerRank | null }> {
    const [user, designerRole] = await Promise.all([
      this.userModel.findOne({ _id: userId }, { _id: 1, roleId: 1 }).lean(),
      this.roleRepository.findOne({ name: RoleType.Designer }),
    ]);
    if (!user) throw new NotFoundException('User không tồn tại');
    if (!designerRole || String(user.roleId) !== String(designerRole._id)) {
      throw new BadRequestException('Chỉ set level cho tài khoản role Designer');
    }
    await this.userModel.updateOne(
      { _id: userId },
      level ? { $set: { designerLevel: level } } : { $unset: { designerLevel: 1 } },
    );
    return { userId, level };
  }

  /**
   * Danh sách option cho 2 dropdown filter (sản phẩm = `type`, khách hàng =
   * `userSku`) của tab Designer. Scope = "task đã gán designer TRONG KỲ LỌC"
   * (`buildProductTimeMatch`: inProductionAt [from,to] + loại đơn hủy/chưa map
   * xưởng) để option/count khớp đúng số liệu ma trận/panel theo thời gian đang
   * chọn. Customer cap 300 để payload không phình.
   */
  async getBreakdownFilters(
    from?: string,
    to?: string,
  ): Promise<{
    products: { value: string; label: string; count: number }[];
    customers: { value: string; label: string; count: number }[];
  }> {
    const { start, end } = this.resolveVnWindow(7, from, to);
    const scope = this.buildProductTimeMatch(start, end);
    const [typeRows, customerRows] = await Promise.all([
      this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: { ...scope, type: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: { ...scope, userSku: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$userSku', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 300 },
      ]),
    ]);
    const toOpts = (rows: { _id: string; count: number }[]) =>
      rows.map((r) => ({ value: r._id, label: r._id, count: r.count }));
    return { products: toOpts(typeRows), customers: toOpts(customerRows) };
  }

  /**
   * Bộ điều kiện aggregation dùng chung của flow designer (lăng kính tồn) —
   * ĐÃ TÁCH ra `utils/designer-flow.ts` vì báo cáo Telegram
   * (`DailyOrdersAggregator`) cũng cần MIRROR đúng công thức. Giữ delegate này
   * để không đổi call-site trong file.
   */
  private designerFlowConds() {
    return designerFlowConds();
  }

  /**
   * Badge sidebar — 4 số đếm gọn trong cửa sổ 7 ngày (đồng bộ định nghĩa với
   * các trang tương ứng, xem SidebarBadges.md):
   *   - designerUnassigned : MIRROR match `getAssignBacklog` (cần gán designer)
   *   - designerBacklog    : scope 'all' = MIRROR `columnTotals.backlog` của
   *     `getDailyOverview`; scope 'self' = tồn của chính designer (MIRROR
   *     backlogAgg per-designer: assignee = userId, status ∈ 3 trạng thái tồn)
   *   - toolCheckRework / toolCheckUnreviewed : MIRROR reworkMatch /
   *     unreviewedMatch của `getToolCheckOverview`
   */
  async getSidebarCounts(opts: {
    designerScope: 'all' | 'self' | 'none';
    includeToolCheck: boolean;
    userId?: string;
  }): Promise<{
    designerUnassigned: number | null;
    designerBacklog: number | null;
    toolCheckRework: number | null;
    toolCheckUnreviewed: number | null;
  }> {
    const { start, end } = this.resolveVnWindow(7);
    const inWindow = { $gte: start, $lte: end };
    const factoryClause = productionFactoryClause(this.orderModel.db);
    const alive = { deletedAt: null, cancelledAt: null, factoryId: factoryClause };

    const wantDesigner = opts.designerScope !== 'none';
    const [designerUnassigned, designerBacklog, toolCheckRework, toolCheckUnreviewed] = await Promise.all([
      wantDesigner
        ? this.orderModel.countDocuments({
            inProductionAt: inWindow,
            cancelledAt: null,
            toolResultNote: { $nin: [null, '', 'ok'] },
            factoryId: factoryClause,
            $or: [
              { designerStatus: DesignerStatus.Unassigned },
              { designerStatus: DesignerStatus.Rejected },
              { designerStatus: DesignerStatus.Rework, assignee: { $in: [null] } },
            ],
          })
        : Promise.resolve(null),
      opts.designerScope === 'all'
        ? this.orderModel
            .aggregate<{ n: number }>([
              {
                $match: {
                  inProductionAt: inWindow,
                  cancelledAt: null,
                  factoryId: factoryClause,
                  $expr: this.designerFlowConds().backlogCond,
                },
              },
              { $count: 'n' },
            ])
            .then((r) => r[0]?.n ?? 0)
        : opts.designerScope === 'self'
          ? this.orderModel.countDocuments({
              inProductionAt: inWindow,
              cancelledAt: null,
              factoryId: factoryClause,
              assignee: opts.userId,
              designerStatus: {
                $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework],
              },
            })
          : Promise.resolve(null),
      opts.includeToolCheck
        ? this.orderModel.countDocuments({
            inProductionAt: inWindow,
            productionErrorSource: 'tool-check',
            toolResultNote: 'error',
            ...alive,
          })
        : Promise.resolve(null),
      opts.includeToolCheck
        ? this.orderModel.countDocuments({
            inProductionAt: inWindow,
            toolResultNote: { $in: [null, ''] },
            ...alive,
          })
        : Promise.resolve(null),
    ]);

    return { designerUnassigned, designerBacklog, toolCheckRework, toolCheckUnreviewed };
  }

  /**
   * Badge cho cụm menu riêng từng xưởng (`Orders.md §25`) — cùng hai con số soát
   * tool như `getSidebarCounts` nhưng TÁCH THEO XƯỞNG.
   *
   * Lưu ý phạm vi: ở đây KHÔNG dùng `productionFactoryClause` (loại xưởng US)
   * — cụm menu của xưởng US là lọc tường minh, badge phải khớp với số trang đó
   * mở ra chứ không phải luôn bằng 0 (§21). Đơn chưa map xưởng tự rơi ra vì
   * `$group` theo `factoryId`.
   */
  async getSidebarCountsByFactory(): Promise<
    Record<string, { toolCheckRework: number; toolCheckUnreviewed: number }>
  > {
    const { start, end } = this.resolveVnWindow(7);
    const inWindow = { $gte: start, $lte: end };
    const base = {
      inProductionAt: inWindow,
      deletedAt: null,
      cancelledAt: null,
      factoryId: { $exists: true, $ne: null },
    };
    const groupByFactory = (match: Record<string, unknown>) =>
      this.orderModel.aggregate<{ _id: string | null; n: number }>([
        { $match: match },
        { $group: { _id: '$factoryId', n: { $sum: 1 } } },
      ]);
    const [reworkRows, unreviewedRows] = await Promise.all([
      groupByFactory({ ...base, productionErrorSource: 'tool-check', toolResultNote: 'error' }),
      groupByFactory({ ...base, toolResultNote: { $in: [null, ''] } }),
    ]);
    const out: Record<string, { toolCheckRework: number; toolCheckUnreviewed: number }> = {};
    const put = (id: string, key: 'toolCheckRework' | 'toolCheckUnreviewed', n: number) => {
      out[id] ||= { toolCheckRework: 0, toolCheckUnreviewed: 0 };
      out[id][key] = n;
    };
    for (const r of reworkRows) if (r._id) put(String(r._id), 'toolCheckRework', r.n);
    for (const r of unreviewedRows) if (r._id) put(String(r._id), 'toolCheckUnreviewed', r.n);
    return out;
  }

  /**
   * Banner đỏ "quá hạn 2 ngày" (MainLayout, xem OverdueAlertBanner.md) — đơn
   * `inProductionAt` từ 2 ngày trước trở về trước (hôm nay 13 → ngày 11 về
   * trước, chặn dưới = cửa sổ 7 ngày như SidebarCounts) mà vẫn còn:
   *   - toolCheckUnreviewed : chưa soát tool (MIRROR unreviewedMatch ToolCheck)
   *   - designerUnassigned  : cần gán designer (MIRROR match getAssignBacklog)
   *   - byDesigner          : đã gán nhưng chưa xong, group theo assignee
   *     (MIRROR backlogAgg per-designer của getDailyOverview)
   * Số là TOÀN HỆ THỐNG cho mọi role được xem — không scope theo người gọi.
   */
  async getOverdueAlert(): Promise<{
    cutoffDay: string;
    toolCheckUnreviewed: number;
    designerUnassigned: number;
    designerBacklog: number;
    byDesigner: { userId: string; name: string; count: number }[];
  }> {
    const MS_DAY = 86_400_000;
    const { start } = this.resolveVnWindow(7);
    const vnToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // Quá hạn = trước 00:00 HÔM QUA (giờ VN): hôm nay 13 → chỉ đếm ngày 11 về trước.
    const overdueBefore = new Date(new Date(`${vnToday}T00:00:00+07:00`).getTime() - MS_DAY);
    const cutoffDay = new Date(overdueBefore.getTime() - MS_DAY + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const inOverdue = { $gte: start, $lt: overdueBefore };
    const factoryClause = productionFactoryClause(this.orderModel.db);
    const alive = { deletedAt: null, cancelledAt: null, factoryId: factoryClause };

    const [toolCheckUnreviewed, designerUnassigned, backlogRows] = await Promise.all([
      this.orderModel.countDocuments({
        inProductionAt: inOverdue,
        toolResultNote: { $in: [null, ''] },
        ...alive,
      }),
      this.orderModel.countDocuments({
        inProductionAt: inOverdue,
        cancelledAt: null,
        toolResultNote: { $nin: [null, '', 'ok'] },
        factoryId: factoryClause,
        $or: [
          { designerStatus: DesignerStatus.Unassigned },
          { designerStatus: DesignerStatus.Rejected },
          { designerStatus: DesignerStatus.Rework, assignee: { $in: [null] } },
        ],
      }),
      this.orderModel.aggregate<{ _id: string; count: number }>([
        {
          $match: {
            inProductionAt: inOverdue,
            cancelledAt: null,
            factoryId: factoryClause,
            assignee: { $nin: [null, ''] },
            designerStatus: { $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework] },
          },
        },
        { $group: { _id: '$assignee', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const users = backlogRows.length
      ? await this.userModel
          .find({ _id: { $in: backlogRows.map((r) => r._id) } }, { _id: 1, fullName: 1, email: 1 })
          .lean()
      : [];
    const nameMap = new Map(users.map((u) => [String(u._id), u.fullName || u.email || String(u._id)]));

    const byDesigner = backlogRows.map((r) => ({
      userId: String(r._id),
      name: nameMap.get(String(r._id)) ?? String(r._id),
      count: r.count,
    }));

    return {
      cutoffDay,
      toolCheckUnreviewed,
      designerUnassigned,
      designerBacklog: byDesigner.reduce((s, r) => s + r.count, 0),
      byDesigner,
    };
  }

  /**
   * Bảng tổng quan N ngày (7/14/30) cho tab Designer — các hàng:
   *   1. total       — tất cả đơn inProductionAt ngày đó (mọi trạng thái)
   *   2. unreviewed  — toolResultNote null/'' (chưa soát)
   *   3. toolError   — "Soát lỗi": đơn TỪNG bị người soát đánh note lỗi ≠ 'ok'
   *                    (`toolCheckErrorNotes` non-empty — LỊCH SỬ, giữ kể cả đã
   *                    sửa về 'ok'; không dính note='error' do In báo). Kèm
   *                    toolErrorByNote (mã mới nhất) + toolErrorFixed +
   *                    toolErrorUnassigned + assignedToolError cho tooltip.
   *   4. wasOkPushed — "OK/chưa soát → đẩy về": chưa từng lỗi soát tool nhưng
   *                    đã vào flow designer (designerStatus ∈ 4, gồm rework
   *                    chưa ai ôm) — lịch sử.
   *   5. unassignedNeed (+Tool) / unassignedResolved / assignedToolError+
   *                    assignedWasOk — pool cần designer tách: chưa gán & ĐANG
   *                    lỗi / chưa gán & đã về ok / đã gán. BẤT BIẾN: toolError
   *                    + wasOkPushed = assignedTotal + unassignedNeed +
   *                    unassignedResolved; assignedTotal = Tổng/ngày của
   *                    getTeamDailyBreakdown.
   *   6. error       — đơn ĐANG lỗi còn lại (note set & != 'ok') + breakdown mã note
   *   7. backlog     — Tổng tồn (lăng kính designer): UNION chưa-soát ∨ đã-gán-
   *                    chưa-xong ∨ đang-lỗi-chưa-gán ≈ unreviewed +
   *                    (assignedTotal − designDone) + unassignedNeed
   * Kèm backlogByDesigner (per-designer × [assigned,inProgress,rework] — "Không
   * làm được"/rejected KHÔNG tính là tồn) + unassignedBacklog
   * cho bảng con khi expand hàng Tồn.
   */
  async getDailyOverview(
    rangeDays: number,
    type?: string,
    customer?: string,
    from?: string,
    to?: string,
  ): Promise<{
    days: string[];
    rows: {
      day: string;
      total: number;
      ok: number;
      unreviewed: number;
      error: number;
      errorUnassigned: number;
      toolError: number;
      toolErrorFixed: number;
      toolErrorUnassigned: number;
      toolErrorByNote: { code: string; count: number }[];
      assignedToolError: number;
      assignedWasOk: number;
      wasOkPushed: number;
      unassignedNeed: number;
      unassignedNeedTool: number;
      unassignedResolved: number;
      designDone: number;
      errorByNote: { code: string; count: number }[];
      backlog: number;
      unassigned: number;
    }[];
    backlogByDesigner: {
      userId: string;
      fullName: string;
      email?: string;
      assigned: number;
      inProgress: number;
      rework: number;
      total: number;
    }[];
    unassignedBacklog: number;
    columnTotals: {
      total: number;
      ok: number;
      unreviewed: number;
      error: number;
      errorUnassigned: number;
      toolError: number;
      toolErrorFixed: number;
      toolErrorUnassigned: number;
      assignedToolError: number;
      assignedWasOk: number;
      wasOkPushed: number;
      unassignedNeed: number;
      unassignedNeedTool: number;
      unassignedResolved: number;
      designDone: number;
      backlog: number;
    };
    rangeDays: number;
  }> {
    const { start, end, days } = this.resolveVnWindow(rangeDays, from, to);

    const extraMatch: Record<string, unknown> = {};
    if (type) extraMatch.type = type;
    if (customer) extraMatch.userSku = customer;
    // `cancelledAt: null` — loại đơn hủy khỏi mọi số liệu tổng quan. Đơn chưa
    // map xưởng cũng bị loại — chỉ xem qua trang "Không xác định xưởng".
    const baseMatch = {
      inProductionAt: { $gte: start, $lte: end },
      cancelledAt: null,
      factoryId: productionFactoryClause(this.orderModel.db),
      ...extraMatch,
    };

    const dayExpr = { $dateToString: { format: '%Y-%m-%d', date: '$inProductionAt', timezone: '+07:00' } };
    const {
      noteExpr,
      statusExpr,
      assigneeExpr,
      curErrorCond,
      toolErrHasCond,
      s4Cond,
      assignedCond,
      poolCond,
      unassignedNeedCond,
      backlogCond,
    } = this.designerFlowConds();

    const [rowsAgg, noteAgg, toolNoteAgg, backlogAgg, designerRole] = await Promise.all([
      // (a) per-day counts
      this.orderModel.aggregate<{
        _id: string;
        total: number;
        ok: number;
        unreviewed: number;
        error: number;
        errorUnassigned: number;
        toolError: number;
        toolErrorFixed: number;
        toolErrorUnassigned: number;
        assignedToolError: number;
        assignedWasOk: number;
        wasOkPushed: number;
        unassignedNeed: number;
        unassignedNeedTool: number;
        unassignedResolved: number;
        designDone: number;
        backlog: number;
        unassigned: number;
      }>([
        { $match: baseMatch },
        {
          $group: {
            _id: dayExpr,
            total: { $sum: 1 },
            // Đã soát xong, không lỗi (note = 'ok').
            ok: { $sum: { $cond: [{ $eq: [noteExpr, 'ok'] }, 1, 0] } },
            // Chưa soát (note rỗng).
            unreviewed: { $sum: { $cond: [{ $eq: [noteExpr, ''] }, 1, 0] } },
            // Đơn ĐANG lỗi còn lại (đã soát & note ≠ 'ok') — chưa xử lý xong.
            error: { $sum: { $cond: [curErrorCond, 1, 0] } },
            // "Soát lỗi": đơn TỪNG bị người soát tool đánh note lỗi (≠ ok) —
            // nguồn BỀN VỮNG `toolCheckErrorNotes` (giữ kể cả đơn đã sửa về
            // 'ok'; KHÔNG dính note='error' do In báo → tự loại đơn treo chưa
            // soát lại). Số lịch sử, không teo theo thời điểm hiện tại.
            toolError: { $sum: { $cond: [toolErrHasCond, 1, 0] } },
            // Trong toolError: đã sửa xong (note hiện tại = 'ok').
            toolErrorFixed: {
              $sum: { $cond: [{ $and: [toolErrHasCond, { $eq: [noteExpr, 'ok'] }] }, 1, 0] },
            },
            // Trong toolError: còn đang lỗi & chưa gán designer.
            toolErrorUnassigned: {
              $sum: {
                $cond: [{ $and: [toolErrHasCond, curErrorCond, { $eq: [assigneeExpr, ''] }] }, 1, 0],
              },
            },
            // Design ĐÃ XONG (assignee + status done) — khớp cột "Đã xong" ma trận.
            designDone: {
              $sum: {
                $cond: [{ $and: [{ $ne: [assigneeExpr, ''] }, { $eq: [statusExpr, DesignerStatus.Done] }] }, 1, 0],
              },
            },
            // "Đã gán designer" tách 2 nguồn — tổng 2 số = Tổng/ngày ma trận team.
            assignedToolError: {
              $sum: { $cond: [{ $and: [assignedCond, toolErrHasCond] }, 1, 0] },
            },
            assignedWasOk: {
              $sum: { $cond: [{ $and: [assignedCond, { $not: [toolErrHasCond] }] }, 1, 0] },
            },
            // "OK/chưa soát → đẩy về": chưa từng lỗi soát tool nhưng đã vào flow
            // designer (gồm rework chưa ai ôm) — lịch sử, không teo khi fix xong.
            wasOkPushed: {
              $sum: { $cond: [{ $and: [{ $not: [toolErrHasCond] }, s4Cond] }, 1, 0] },
            },
            // "Chưa gán designer" = pool cần designer & chưa gán & ĐANG lỗi
            // (note set ≠ ok). Phần đã về ok tách riêng `unassignedResolved` —
            // bất biến: toolError + wasOkPushed = assignedTotal + unassignedNeed
            // + unassignedResolved.
            unassignedNeed: { $sum: { $cond: [unassignedNeedCond, 1, 0] } },
            // Trong unassignedNeed: phần từng lỗi soát tool (FE lấy phần bù ra
            // nhóm "OK/chưa soát đẩy về").
            unassignedNeedTool: {
              $sum: {
                $cond: [{ $and: [toolErrHasCond, { $not: [assignedCond] }, curErrorCond] }, 1, 0],
              },
            },
            // Pool & chưa gán nhưng note đã về ok/rỗng — xử lý không cần designer.
            unassignedResolved: {
              $sum: {
                $cond: [{ $and: [poolCond, { $not: [assignedCond] }, { $not: [curErrorCond] }] }, 1, 0],
              },
            },
            // Đơn ĐANG lỗi & chưa gán designer (assignee rỗng) — nhóm "Chưa phân".
            errorUnassigned: {
              $sum: {
                $cond: [{ $and: [curErrorCond, { $eq: [assigneeExpr, ''] }] }, 1, 0],
              },
            },
            // Tổng tồn (lăng kính designer) = UNION: chưa soát ∨ đã gán chưa
            // xong ∨ đang lỗi chưa gán — đơn thuộc 2 nhóm chỉ đếm 1 lần.
            // = Chưa soát + (Đã gán − Đã xong) + Chưa gán khi các nhóm không
            // trùng (đơn CHƯA SOÁT nhưng ĐÃ GÁN sẽ làm tổng số học lớn hơn union).
            backlog: { $sum: { $cond: [backlogCond, 1, 0] } },
            // Đơn designerStatus=unassigned (cho bảng xổ "Chưa gán").
            unassigned: {
              $sum: { $cond: [{ $eq: [statusExpr, DesignerStatus.Unassigned] }, 1, 0] },
            },
          },
        },
      ]),
      // (b) errorByNote per day
      this.orderModel.aggregate<{ _id: { day: string; note: string }; count: number }>([
        { $match: { ...baseMatch, toolResultNote: { $nin: [null, '', 'ok'] } } },
        { $group: { _id: { day: dayExpr, note: '$toolResultNote' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      // (b2) toolErrorByNote per day — breakdown mã lỗi soát tool theo MÃ MỚI
      // NHẤT của đơn (phần tử cuối `toolCheckErrorNotes` — $addToSet append đuôi
      // khi gặp mã mới). Mỗi đơn đúng 1 dòng → tổng breakdown = toolError, khớp
      // con số ngoài ô + drill `toolErrorNote`.
      this.orderModel.aggregate<{ _id: { day: string; note: string }; count: number }>([
        { $match: { ...baseMatch, 'toolCheckErrorNotes.0': { $exists: true } } },
        {
          $group: {
            _id: { day: dayExpr, note: { $arrayElemAt: ['$toolCheckErrorNotes', -1] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
      // (c) backlog per designer (active statuses có assignee).
      // "Không làm được" (Rejected) KHÔNG tính là tồn — nằm ở backlog "Cần gán".
      this.orderModel.aggregate<{ _id: { uid: string; status: DesignerStatus }; count: number }>([
        {
          $match: {
            ...baseMatch,
            assignee: { $exists: true, $ne: null },
            designerStatus: {
              $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework],
            },
          },
        },
        { $group: { _id: { uid: '$assignee', status: '$designerStatus' }, count: { $sum: 1 } } },
      ]),
      this.roleRepository.findOne({ name: RoleType.Designer }),
    ]);

    // errorByNote / toolErrorByNote gom theo ngày
    const noteByDay = new Map<string, { code: string; count: number }[]>();
    for (const r of noteAgg) {
      const list = noteByDay.get(r._id.day) || [];
      list.push({ code: r._id.note, count: r.count });
      noteByDay.set(r._id.day, list);
    }
    const toolNoteByDay = new Map<string, { code: string; count: number }[]>();
    for (const r of toolNoteAgg) {
      const list = toolNoteByDay.get(r._id.day) || [];
      list.push({ code: r._id.note, count: r.count });
      toolNoteByDay.set(r._id.day, list);
    }

    const rowMap = new Map(rowsAgg.map((r) => [r._id, r]));
    const columnTotals = {
      total: 0,
      ok: 0,
      unreviewed: 0,
      error: 0,
      errorUnassigned: 0,
      toolError: 0,
      toolErrorFixed: 0,
      toolErrorUnassigned: 0,
      assignedToolError: 0,
      assignedWasOk: 0,
      wasOkPushed: 0,
      unassignedNeed: 0,
      unassignedNeedTool: 0,
      unassignedResolved: 0,
      designDone: 0,
      backlog: 0,
    };
    let unassignedBacklog = 0;
    const rows = days.map((day) => {
      const r = rowMap.get(day);
      const row = {
        day,
        total: r?.total ?? 0,
        ok: r?.ok ?? 0,
        unreviewed: r?.unreviewed ?? 0,
        error: r?.error ?? 0,
        errorUnassigned: r?.errorUnassigned ?? 0,
        toolError: r?.toolError ?? 0,
        toolErrorFixed: r?.toolErrorFixed ?? 0,
        toolErrorUnassigned: r?.toolErrorUnassigned ?? 0,
        toolErrorByNote: toolNoteByDay.get(day) || [],
        assignedToolError: r?.assignedToolError ?? 0,
        assignedWasOk: r?.assignedWasOk ?? 0,
        wasOkPushed: r?.wasOkPushed ?? 0,
        unassignedNeed: r?.unassignedNeed ?? 0,
        unassignedNeedTool: r?.unassignedNeedTool ?? 0,
        unassignedResolved: r?.unassignedResolved ?? 0,
        designDone: r?.designDone ?? 0,
        errorByNote: noteByDay.get(day) || [],
        backlog: r?.backlog ?? 0,
        unassigned: r?.unassigned ?? 0,
      };
      columnTotals.total += row.total;
      columnTotals.ok += row.ok;
      columnTotals.unreviewed += row.unreviewed;
      columnTotals.error += row.error;
      columnTotals.errorUnassigned += row.errorUnassigned;
      columnTotals.toolError += row.toolError;
      columnTotals.toolErrorFixed += row.toolErrorFixed;
      columnTotals.toolErrorUnassigned += row.toolErrorUnassigned;
      columnTotals.assignedToolError += row.assignedToolError;
      columnTotals.assignedWasOk += row.assignedWasOk;
      columnTotals.wasOkPushed += row.wasOkPushed;
      columnTotals.unassignedNeed += row.unassignedNeed;
      columnTotals.unassignedNeedTool += row.unassignedNeedTool;
      columnTotals.unassignedResolved += row.unassignedResolved;
      columnTotals.designDone += row.designDone;
      columnTotals.backlog += row.backlog;
      unassignedBacklog += row.unassigned;
      return row;
    });

    // Resolve tên designer cho bảng con — CHỈ designer ĐANG BẬT (thống kê active).
    const teamUsers = designerRole
      ? await this.userModel
          .find({ roleId: designerRole._id, status: Status.Active }, { _id: 1, fullName: 1, email: 1 })
          .lean()
      : [];
    const activeIds = new Set(teamUsers.map((u) => String(u._id)));
    const nameMap = new Map<string, { fullName: string; email?: string }>();
    for (const u of teamUsers) nameMap.set(String(u._id), { fullName: u.fullName, email: u.email });

    type BL = { assigned: number; inProgress: number; rework: number };
    const blMap = new Map<string, BL>();
    const bump = (uid: string, status: DesignerStatus, n: number) => {
      const cur = blMap.get(uid) || { assigned: 0, inProgress: 0, rework: 0 };
      if (status === DesignerStatus.Assigned) cur.assigned += n;
      else if (status === DesignerStatus.InProgress) cur.inProgress += n;
      else if (status === DesignerStatus.Rework) cur.rework += n;
      blMap.set(uid, cur);
    };
    for (const r of backlogAgg) bump(r._id.uid, r._id.status, r.count);

    const missingIds = [...blMap.keys()].filter((id) => !nameMap.has(id));
    if (missingIds.length > 0) {
      const extra = await this.userModel.find({ _id: { $in: missingIds } }, { _id: 1, fullName: 1, email: 1 }).lean();
      for (const u of extra) nameMap.set(String(u._id), { fullName: u.fullName, email: u.email });
    }

    const backlogByDesigner = [...blMap.entries()]
      // Chỉ giữ designer đang bật (loại người đã tắt / assignee ngoài team).
      .filter(([uid]) => activeIds.has(uid))
      .map(([uid, c]) => {
        const info = nameMap.get(uid);
        return {
          userId: uid,
          fullName: info?.fullName || `#${uid.slice(-4)}`,
          email: info?.email,
          assigned: c.assigned,
          inProgress: c.inProgress,
          rework: c.rework,
          total: c.assigned + c.inProgress + c.rework,
        };
      })
      .filter((d) => d.total > 0)
      .sort((a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName));

    return { days, rows, backlogByDesigner, unassignedBacklog, columnTotals, rangeDays: days.length };
  }

  /**
   * Bảng "Cần gán designer" — đơn `toolResultNote` đã soát & ≠ ok VÀ chưa có
   * người ôm (unassigned / rejected / rework-chưa-ôm), gom theo sản phẩm
   * (productConfigId → mockup/level/fullName), đơn chưa map → nhóm "Chưa map".
   */
  async getAssignBacklog(
    rangeDays: number,
    type?: string,
    customer?: string,
    from?: string,
    to?: string,
  ): Promise<{ groups: AssignBacklogGroup[]; total: number; rangeDays: number }> {
    const { start, end, days } = this.resolveVnWindow(rangeDays, from, to);

    const match: Record<string, unknown> = {
      inProductionAt: { $gte: start, $lte: end },
      cancelledAt: null, // loại đơn hủy khỏi pool "Cần gán" + self-claim
      // Đã soát & khác ok (KHÔNG gồm chưa soát null/'').
      toolResultNote: { $nin: [null, '', 'ok'] },
      // Đơn chưa map xưởng bị loại khỏi backlog "Cần gán" — chỉ xem qua trang
      // "Không xác định xưởng".
      factoryId: productionFactoryClause(this.orderModel.db),
      $or: [
        { designerStatus: DesignerStatus.Unassigned },
        { designerStatus: DesignerStatus.Rejected },
        // rework chưa ôm — assignee null/missing.
        { designerStatus: DesignerStatus.Rework, assignee: { $in: [null] } },
      ],
    };
    if (type) match.type = type;
    if (customer) match.userSku = customer;

    const orders = await this.orderModel
      .find(match, {
        productionId: 1,
        userSku: 1,
        size: 1,
        color: 1,
        type: 1,
        mockupUrl: 1,
        mockupOriginalUrl: 1,
        toolResultNote: 1,
        designerStatus: 1,
        inProductionAt: 1,
        productConfigId: 1,
        priority: 1,
      })
      .sort({ priority: -1, inProductionAt: -1 })
      .lean();

    const UNMAPPED = 'unmapped';
    const grouped = new Map<string, { orderIds: string[]; orders: AssignBacklogOrder[] }>();
    for (const o of orders as Array<Record<string, unknown>>) {
      const key = (o.productConfigId as string) || UNMAPPED;
      const g = grouped.get(key) || { orderIds: [], orders: [] };
      const id = String(o._id);
      g.orderIds.push(id);
      g.orders.push({
        _id: id,
        productionId: String(o.productionId ?? ''),
        userSku: o.userSku as string | undefined,
        size: o.size as string | undefined,
        color: o.color as string | undefined,
        type: o.type as string | undefined,
        mockupUrl: o.mockupUrl as string | undefined,
        mockupOriginalUrl: o.mockupOriginalUrl as string | undefined,
        toolResultNote: o.toolResultNote as string | undefined,
        designerStatus: o.designerStatus as string | undefined,
        inProductionAt: o.inProductionAt ? new Date(o.inProductionAt as Date).toISOString() : undefined,
        priority: o.priority as AssignBacklogOrder['priority'],
      });
      grouped.set(key, g);
    }

    const cfgIds = [...grouped.keys()].filter((k) => k !== UNMAPPED);
    const cfgs = cfgIds.length
      ? await this.productConfigModel
          .find({ _id: { $in: cfgIds } }, { fullName: 1, shortName: 1, mockup: 1, level: 1 })
          .lean()
      : [];
    const cfgMap = new Map<string, { fullName?: string; shortName?: string; mockup?: string; level?: number }>();
    for (const c of cfgs as Array<Record<string, unknown>>) {
      cfgMap.set(String(c._id), {
        fullName: c.fullName as string,
        shortName: c.shortName as string,
        mockup: c.mockup as string,
        level: c.level as number,
      });
    }

    const groups = [...grouped.entries()].map(([key, g]) => {
      const cfg = key !== UNMAPPED ? cfgMap.get(key) : undefined;
      return {
        key,
        fullName: cfg?.fullName || (key === UNMAPPED ? 'Chưa map' : `#${key.slice(-6)}`),
        shortName: cfg?.shortName,
        mockup: cfg?.mockup,
        level: cfg?.level,
        count: g.orders.length,
        orderIds: g.orderIds,
        orders: g.orders,
      };
    });

    // Sort count desc; nhóm "Chưa map" xuống cuối.
    groups.sort((a, b) => {
      if (a.key === UNMAPPED) return 1;
      if (b.key === UNMAPPED) return -1;
      return b.count - a.count || a.fullName.localeCompare(b.fullName);
    });

    return { groups, total: orders.length, rangeDays: days.length };
  }

  /**
   * Breakdown sản phẩm theo từng designer (cho tooltip biểu đồ Cơ cấu trạng
   * thái): mỗi designer → list sản phẩm (order.type) họ được gán trong kỳ +
   * số đơn/sản phẩm + level/mockup (từ ProductConfig). Phạm vi = mọi đơn đã gán
   * (assigned/in-progress/rework/done).
   */
  async getProductBreakdown(
    rangeDays: number,
    type?: string,
    customer?: string,
    from?: string,
    to?: string,
  ): Promise<{ designers: ProductBreakdownDesigner[] }> {
    const { start, end } = this.resolveVnWindow(rangeDays, from, to);

    const match: Record<string, unknown> = {
      inProductionAt: { $gte: start, $lte: end },
      assignee: { $exists: true, $ne: null },
      designerStatus: {
        $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework, DesignerStatus.Done],
      },
    };
    if (type) match.type = type;
    if (customer) match.userSku = customer;

    const [agg, designerRole] = await Promise.all([
      this.orderModel.aggregate<{
        _id: { uid: string; type: string };
        count: number;
        cfg: string | null;
      }>([
        { $match: match },
        {
          $group: {
            _id: { uid: '$assignee', type: { $ifNull: ['$type', ''] } },
            count: { $sum: 1 },
            cfg: { $max: '$productConfigId' },
          },
        },
      ]),
      this.roleRepository.findOne({ name: RoleType.Designer }),
    ]);

    // CHỈ designer ĐANG BẬT — thống kê sản phẩm loại người đã tắt.
    const teamUsers = designerRole
      ? await this.userModel.find({ roleId: designerRole._id, status: Status.Active }, { _id: 1, fullName: 1 }).lean()
      : [];
    const activeIds = new Set(teamUsers.map((u) => String(u._id)));
    const nameMap = new Map<string, string>();
    for (const u of teamUsers) nameMap.set(String(u._id), u.fullName);

    const cfgIds = [...new Set(agg.map((a) => a.cfg).filter(Boolean))] as string[];
    const cfgs = cfgIds.length
      ? await this.productConfigModel
          .find({ _id: { $in: cfgIds } }, { fullName: 1, shortName: 1, mockup: 1, level: 1 })
          .lean()
      : [];
    const cfgMap = new Map<string, { fullName?: string; shortName?: string; mockup?: string; level?: number }>();
    for (const c of cfgs as Array<Record<string, unknown>>) {
      cfgMap.set(String(c._id), {
        fullName: c.fullName as string,
        shortName: c.shortName as string,
        mockup: c.mockup as string,
        level: c.level as number,
      });
    }

    const byUser = new Map<string, ProductBreakdownDesigner>();
    for (const a of agg) {
      const uid = a._id.uid;
      if (!activeIds.has(uid)) continue; // bỏ designer đã tắt
      let d = byUser.get(uid);
      if (!d) {
        d = { userId: uid, fullName: nameMap.get(uid) || `#${uid.slice(-4)}`, total: 0, products: [] };
        byUser.set(uid, d);
      }
      const cfg = a.cfg ? cfgMap.get(a.cfg) : undefined;
      d.products.push({
        type: a._id.type || '(Chưa rõ)',
        fullName: cfg?.fullName,
        shortName: cfg?.shortName,
        mockup: cfg?.mockup,
        level: cfg?.level,
        count: a.count,
      });
      d.total += a.count;
    }

    const missingIds = [...byUser.keys()].filter((id) => !nameMap.has(id));
    if (missingIds.length > 0) {
      const extra = await this.userModel.find({ _id: { $in: missingIds } }, { _id: 1, fullName: 1 }).lean();
      for (const u of extra) {
        const d = byUser.get(String(u._id));
        if (d) d.fullName = u.fullName;
      }
    }

    const designers = [...byUser.values()].map((d) => ({
      ...d,
      products: d.products.sort((x, y) => y.count - x.count),
    }));
    return { designers };
  }

  /**
   * Tổng quan tab "Soát tool" (Support/Admin). Trong cửa sổ ngày (inProductionAt,
   * tz VN, + filter type/customer):
   *   - reworkList  : đơn In trả về "do soát tool" (source=tool-check + note=error) — ưu tiên
   *   - unreviewedList: đơn chưa soát (toolResultNote rỗng) — backlog
   *   - checkedCount : số đơn đã soát trong kỳ (toolCheckedAt ∈ kỳ)
   *   - errorCount   : số đơn đang chờ support (= reworkList)
   *   - byProduct / byCustomer / topCustomerError: thống kê lỗi tool-check (mọi
   *     đơn source=tool-check trong kỳ, cả đang chờ lẫn đã fix) theo sản phẩm /
   *     khách hàng (userSku) / khách × loại lỗi.
   */
  async getToolCheckOverview(
    rangeDays: number,
    type?: string,
    customer?: string,
    from?: string,
    to?: string,
    machineNumber?: string,
    priority?: string,
    productLine?: string,
  ): Promise<{
    checkedCount: number;
    errorCount: number;
    reworkList: ToolCheckOrder[];
    unreviewedList: ToolCheckOrder[];
    errorHistory: ToolCheckErrorRow[];
    days: ToolCheckDayRow[];
    columnTotals: {
      total: number;
      unreviewed: number;
      reviewed: number;
      reviewedError: number;
      reviewedOk: number;
      rework: number;
    };
    facets: {
      type: ToolCheckFacet[];
      customer: ToolCheckFacet[];
      machineNumber: ToolCheckFacet[];
      priority: ToolCheckFacet[];
    };
    rangeDays: number;
  }> {
    const { start, end, days } = this.resolveVnWindow(rangeDays, from, to);
    const inWindow = { $gte: start, $lte: end };
    // Product line is a SCOPE chosen by the menu (Tool 3D / Tool 2D–DTF), not one of the
    // facet filters: it narrows the facet options too, otherwise Tool 3D would offer 2D
    // product types in its dropdowns.
    const lineCond = productLineCondition(productLine);
    const lineScope = lineCond ? { productLine: lineCond } : {};
    const withFilters = (m: Record<string, unknown>) => {
      Object.assign(m, lineScope);
      if (type) m.type = type;
      if (customer) m.userSku = customer;
      if (machineNumber) m.machineNumber = machineNumber;
      if (priority) m.priority = Number(priority);
      return m;
    };
    const dayExpr = {
      $dateToString: { format: '%Y-%m-%d', date: '$inProductionAt', timezone: '+07:00' },
    };
    const noteExpr = { $ifNull: ['$toolResultNote', ''] };
    // Marker lịch sử "từng soát ra lỗi" (bền vững — xem ToolCheckWorkflow.md).
    const toolErrHasCond = { $gt: [{ $size: { $ifNull: ['$toolCheckErrorNotes', []] } }, 0] };
    const toolErrNoneCond = { $eq: [{ $size: { $ifNull: ['$toolCheckErrorNotes', []] } }, 0] };
    // `null` khớp cả giá trị null lẫn field vắng mặt → loại đơn đã xoá/hủy.
    // Đơn chưa map xưởng cũng bị loại khỏi Soát tool — chỉ xem qua trang
    // "Không xác định xưởng".
    const alive = { deletedAt: null, cancelledAt: null, factoryId: productionFactoryClause(this.orderModel.db) };

    const checkedMatch = withFilters({ toolCheckedAt: inWindow, ...alive });
    const reworkMatch = withFilters({
      inProductionAt: inWindow,
      productionErrorSource: 'tool-check',
      toolResultNote: 'error',
      ...alive,
    });
    const unreviewedMatch = withFilters({
      inProductionAt: inWindow,
      toolResultNote: { $in: [null, ''] },
      ...alive,
    });
    // Lịch sử "lỗi do người soát tool tạo ra" = đơn TỪNG bị đánh Note kq Tool ≠
    // ok (kể cả đã sửa về 'ok'). Nguồn BỀN VỮNG = field `toolCheckErrorNotes`
    // (dedup mã note ≠ ok, không bị xoá khi sửa). Lọc kỳ theo `inProductionAt`.
    const errHistoryMatch = withFilters({
      inProductionAt: inWindow,
      'toolCheckErrorNotes.0': { $exists: true },
      ...alive,
    });

    const LIST_CAP = 500;
    const HISTORY_CAP = 5000;
    const proj = {
      productionId: 1,
      userSku: 1,
      type: 1,
      size: 1,
      color: 1,
      mockupUrl: 1,
      mockupOriginalUrl: 1,
      toolResultNote: 1,
      errorFile: 1,
      errorFileNote: 1,
      productionError: 1,
      productionErrorNote: 1,
      productionErrorCount: 1,
      machineNumber: 1,
      inProductionAt: 1,
      priority: 1,
    };

    // Phạm vi facet = đơn Support quan tâm trong kỳ (chưa soát ∪ tool-check),
    // KHÔNG áp 3 filter type/customer/machine → dropdown ổn định (chọn xong
    // options không biến mất). `alive` để loại đơn xoá/hủy.
    const facetScope = {
      inProductionAt: inWindow,
      ...alive,
      ...lineScope,
      $or: [{ toolResultNote: { $in: [null, ''] } }, { productionErrorSource: 'tool-check' }],
    };
    const facetAgg = (field: string) =>
      this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: facetScope },
        { $group: { _id: { $ifNull: [`$${field}`, ''] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 200 },
      ]);
    const toFacet = (rows: { _id: string; count: number }[]): ToolCheckFacet[] =>
      rows.filter((r) => r._id !== '').map((r) => ({ value: r._id, count: r.count }));
    // `priority` là number → $toString để value ra chuỗi giống các facet khác.
    // Sort theo `_id` desc (cao→thấp) thay vì count để dropdown ổn định theo thứ tự mức.
    const priorityFacetAgg = () =>
      this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: facetScope },
        { $group: { _id: { $ifNull: [{ $toString: '$priority' }, ''] }, count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
      ]);

    const histProj = {
      productionId: 1,
      userSku: 1,
      userEmail: 1,
      type: 1,
      size: 1,
      color: 1,
      productConfigId: 1,
      mockupUrl: 1,
      mockupOriginalUrl: 1,
      toolCheckErrorNotes: 1,
      errorFileNote: 1,
      errorFile: 1,
    };

    const [
      checkedCount,
      reworkRaw,
      unreviewedRaw,
      candidatesRaw,
      dailyByDay,
      dailyNoteAgg,
      typeFacetAgg,
      customerFacetAgg,
      machineFacetAgg,
      priorityFacetAggRows,
    ] = await Promise.all([
      this.orderModel.countDocuments(checkedMatch),
      this.orderModel.find(reworkMatch, proj).sort({ priority: -1, inProductionAt: -1 }).limit(LIST_CAP).lean(),
      this.orderModel.find(unreviewedMatch, proj).sort({ priority: -1, inProductionAt: -1 }).limit(LIST_CAP).lean(),
      // Candidate: đơn từng bị đánh Note kq Tool ≠ ok trong kỳ. Mã note (loại
      // lỗi) nằm sẵn trong `toolCheckErrorNotes` — không cần join thêm.
      this.orderModel.find(errHistoryMatch, histProj).sort({ inProductionAt: -1 }).limit(HISTORY_CAP).lean(),
      // Per-day (áp cùng filter tab): tổng đơn + chưa soát / soát lỗi / soát ok
      // / In trả về trong 1 pass — đã soát suy ra sau (total−unreviewed).
      // Soát lỗi/OK là KẾT QUẢ SOÁT (lịch sử): lỗi = `toolCheckErrorNotes`
      // non-empty (không teo khi đơn sửa xong); ok = đã soát & CHƯA TỪNG lỗi
      // (gồm cả đơn soát ok bị In trả về treo note='error').
      this.orderModel.aggregate<{
        _id: string;
        total: number;
        unreviewed: number;
        reviewedError: number;
        reviewedOk: number;
        rework: number;
      }>([
        { $match: withFilters({ inProductionAt: inWindow, ...alive }) },
        {
          $group: {
            _id: dayExpr,
            total: { $sum: 1 },
            unreviewed: { $sum: { $cond: [{ $eq: [noteExpr, ''] }, 1, 0] } },
            reviewedError: { $sum: { $cond: [toolErrHasCond, 1, 0] } },
            reviewedOk: {
              $sum: { $cond: [{ $and: [{ $ne: [noteExpr, ''] }, toolErrNoneCond] }, 1, 0] },
            },
            rework: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$productionErrorSource', 'tool-check'] }, { $eq: [noteExpr, 'error'] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      // Breakdown "Note không ok" per-day theo MÃ MỚI NHẤT của đơn (phần tử
      // cuối `toolCheckErrorNotes` — $addToSet append đuôi khi gặp mã mới).
      // Mỗi đơn đúng 1 dòng → tổng breakdown = reviewedError, khớp con số
      // ngoài ô. MIRROR toolNoteAgg (b2) của getDailyOverview tab Designer.
      this.orderModel.aggregate<{ _id: { day: string; note: string }; count: number }>([
        { $match: withFilters({ inProductionAt: inWindow, 'toolCheckErrorNotes.0': { $exists: true }, ...alive }) },
        {
          $group: {
            _id: { day: dayExpr, note: { $arrayElemAt: ['$toolCheckErrorNotes', -1] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
      // Facet options (phạm vi Support, KHÔNG áp 4 filter → ổn định).
      facetAgg('type'),
      facetAgg('userSku'),
      facetAgg('machineNumber'),
      priorityFacetAgg(),
    ]);

    const toOrder = (o: Record<string, unknown>): ToolCheckOrder => ({
      _id: String(o._id),
      productionId: String(o.productionId ?? ''),
      userSku: o.userSku as string | undefined,
      type: o.type as string | undefined,
      size: o.size as string | undefined,
      color: o.color as string | undefined,
      mockupUrl: o.mockupUrl as string | undefined,
      mockupOriginalUrl: o.mockupOriginalUrl as string | undefined,
      toolResultNote: o.toolResultNote as string | undefined,
      errorFile: Array.isArray(o.errorFile) ? (o.errorFile as string[]) : undefined,
      errorFileNote: o.errorFileNote as string | undefined,
      productionError: o.productionError as string | undefined,
      productionErrorNote: o.productionErrorNote as string | undefined,
      productionErrorCount: o.productionErrorCount as number | undefined,
      machineNumber: o.machineNumber as string | undefined,
      inProductionAt: o.inProductionAt ? new Date(o.inProductionAt as Date).toISOString() : undefined,
      priority: o.priority as ToolCheckOrder['priority'],
    });

    const candidates = candidatesRaw as Array<Record<string, unknown>>;
    if (candidates.length >= HISTORY_CAP) {
      this.logger.warn(
        `[tool-check] errorHistory candidate cap ${HISTORY_CAP} reached — thống kê lịch sử lỗi có thể thiếu (thu hẹp kỳ/filter).`,
      );
    }

    // Label mã note kq Tool (workshop_config tool_result_note): code → name.
    const noteCfgs = await this.workshopConfigModel
      .find({ category: WorkshopConfigCategory.ToolResultNote }, { code: 1, name: 1 })
      .lean();
    const noteNameMap = new Map<string, string>();
    for (const c of noteCfgs as Array<Record<string, unknown>>) {
      noteNameMap.set(String(c.code), String(c.name));
    }

    // Resolve mockup/level/fullName theo productConfigId của candidate.
    const cfgIds = [...new Set(candidates.map((o) => o.productConfigId).filter(Boolean))] as string[];
    const cfgs = cfgIds.length
      ? await this.productConfigModel.find({ _id: { $in: cfgIds } }, { fullName: 1, mockup: 1, level: 1 }).lean()
      : [];
    const cfgMap = new Map<string, { fullName?: string; mockup?: string; level?: number }>();
    for (const c of cfgs as Array<Record<string, unknown>>) {
      cfgMap.set(String(c._id), {
        fullName: c.fullName as string,
        mockup: c.mockup as string,
        level: c.level as number,
      });
    }

    // Flat rows: mỗi (đơn × mã note ≠ ok). Mã note lấy sẵn từ `toolCheckErrorNotes`.
    const errorHistory: ToolCheckErrorRow[] = [];
    for (const o of candidates) {
      const oid = String(o._id);
      const cfg = o.productConfigId ? cfgMap.get(String(o.productConfigId)) : undefined;
      const notes = Array.isArray(o.toolCheckErrorNotes) ? (o.toolCheckErrorNotes as string[]).filter(Boolean) : [];
      const codes = notes.length ? [...new Set(notes)] : [''];
      const base = {
        orderId: oid,
        productionId: o.productionId as string | undefined,
        userSku: o.userSku as string | undefined,
        userEmail: o.userEmail as string | undefined,
        type: o.type as string | undefined,
        fullName: cfg?.fullName,
        mockup: cfg?.mockup,
        level: cfg?.level,
        note: (o.errorFileNote as string | undefined) || undefined,
        errorFile: Array.isArray(o.errorFile) ? (o.errorFile as string[]).filter(Boolean) : undefined,
        mockupUrl: o.mockupUrl as string | undefined,
        mockupOriginalUrl: o.mockupOriginalUrl as string | undefined,
        size: o.size as string | undefined,
        color: o.color as string | undefined,
      };
      for (const code of codes) {
        errorHistory.push({ ...base, code, codeLabel: code ? noteNameMap.get(code) : undefined });
      }
    }

    // Dải theo ngày: căn theo `days` (mới→cũ) từ resolveVnWindow.
    const dailyDayMap = new Map(dailyByDay.map((r) => [r._id, r]));
    const noteByDay = new Map<string, { code: string; count: number }[]>();
    for (const r of dailyNoteAgg) {
      const list = noteByDay.get(r._id.day) || [];
      list.push({ code: r._id.note, count: r.count });
      noteByDay.set(r._id.day, list);
    }
    const columnTotals = { total: 0, unreviewed: 0, reviewed: 0, reviewedError: 0, reviewedOk: 0, rework: 0 };
    const dayRows: ToolCheckDayRow[] = days.map((day) => {
      const r = dailyDayMap.get(day);
      const total = r?.total ?? 0;
      const unreviewed = r?.unreviewed ?? 0;
      const reviewed = Math.max(0, total - unreviewed);
      const reviewedOk = r?.reviewedOk ?? 0;
      const reviewedError = r?.reviewedError ?? 0;
      const rework = r?.rework ?? 0;
      columnTotals.total += total;
      columnTotals.unreviewed += unreviewed;
      columnTotals.reviewed += reviewed;
      columnTotals.reviewedError += reviewedError;
      columnTotals.reviewedOk += reviewedOk;
      columnTotals.rework += rework;
      return {
        day,
        total,
        unreviewed,
        reviewed,
        reviewedError,
        errorByNote: noteByDay.get(day) || [],
        reviewedOk,
        rework,
      };
    });

    return {
      checkedCount,
      errorCount: reworkRaw.length,
      reworkList: (reworkRaw as Array<Record<string, unknown>>).map(toOrder),
      unreviewedList: (unreviewedRaw as Array<Record<string, unknown>>).map(toOrder),
      errorHistory,
      days: dayRows,
      columnTotals,
      facets: {
        type: toFacet(typeFacetAgg),
        customer: toFacet(customerFacetAgg),
        machineNumber: toFacet(machineFacetAgg),
        priority: toFacet(priorityFacetAggRows),
      },
      rangeDays: days.length,
    };
  }

  /**
   * Cửa sổ ngày (tz VN) cho overview/assign-backlog. Nếu có cả `from`+`to` →
   * khoảng tùy biến (cap 60 ngày); ngược lại → N ngày gần nhất. `days` sort
   * mới→cũ (đồng bộ với FE reverse).
   */
  private resolveVnWindow(rangeDays: number, from?: string, to?: string): { start: Date; end: Date; days: string[] } {
    const MS_DAY = 86_400_000;
    const CAP = 60;
    const vnStart = (d: string) => new Date(`${d}T00:00:00+07:00`);
    const vnEnd = (d: string) => new Date(`${d}T23:59:59.999+07:00`);
    const vnToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const days: string[] = [];

    if (from && to) {
      const f = from.slice(0, 10);
      const t = to.slice(0, 10);
      const start = vnStart(f);
      const end = vnEnd(t);
      const startMs = start.getTime();
      let cur = vnStart(t).getTime();
      let i = 0;
      while (cur >= startMs && i < CAP) {
        days.push(new Date(cur + 7 * 60 * 60 * 1000).toISOString().slice(0, 10));
        cur -= MS_DAY;
        i++;
      }
      return { start, end, days };
    }

    const baseMs = vnStart(vnToday).getTime();
    for (let i = 0; i < rangeDays; i++) {
      days.push(new Date(baseMs - i * MS_DAY + 7 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
    return { start: new Date(baseMs - (rangeDays - 1) * MS_DAY), end: vnEnd(vnToday), days };
  }

  /** Range honoring `days` (nếu không có from/to). Mặc định 30 ngày. */
  private resolveRangeDays(from?: string, to?: string, days?: number): { start: Date; end: Date } {
    if (from || to) return this.resolveRange(from, to);
    if (days && days > 0) {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const start = new Date();
      start.setDate(start.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    return this.resolveRange();
  }

  /**
   * Thống kê lỗi theo NGƯỜI, 2 chiều:
   *  - `needFixCount`: đơn lỗi ĐANG cần người đó sửa (snapshot) = đơn đang mang
   *    lỗi & đang đứng ở công đoạn người đó phụ trách (fulfillment: theo
   *    (factory, currentFulfillmentStage); designer: designerStatus=rework +
   *    assignee). → chiều "bị quy lỗi / phải sửa".
   *  - `reportedCount`: số lần người đó ĐÃ báo lỗi (đẩy về) trong kỳ, đếm từ
   *    `fulfillmentTimeline` (action=rework-back, byUserId). → chiều "phát hiện".
   * Loại đơn hủy (`cancelledAt`). Date field: `inProductionAt` (needFix) /
   * `timeline.at` (reported).
   */
  async getPersonErrorOverview(
    from?: string,
    to?: string,
    days?: number,
    factoryId?: string,
  ): Promise<{ rows: PersonErrorRow[]; from?: string; to?: string }> {
    const range = this.resolveRangeDays(from, to, days);
    const errBase: Record<string, unknown> = {
      inProductionAt: { $gte: range.start, $lte: range.end },
      productionError: { $exists: true, $nin: [null, ''] },
      toolResultNote: 'error',
      cancelledAt: null, // match cả thiếu field lẫn null
      // Đơn chưa map xưởng bị loại khỏi "Lỗi theo người" — chỉ xem qua trang
      // "Không xác định xưởng".
      ...(factoryId ? { factoryId } : { factoryId: productionFactoryClause(this.orderModel.db) }),
    };

    const [fulfillAgg, designerAgg, reportedAgg, stageUsers] = await Promise.all([
      // Fulfillment: đơn lỗi đang đứng ở 1 công đoạn (không phải designer rework).
      this.orderModel.aggregate<{ _id: { factoryId?: string; stage: string }; count: number }>([
        { $match: { ...errBase, designerStatus: { $ne: 'rework' }, currentFulfillmentStage: { $ne: null } } },
        { $group: { _id: { factoryId: '$factoryId', stage: '$currentFulfillmentStage' }, count: { $sum: 1 } } },
      ]),
      // Designer: đơn đang designerStatus=rework → assignee phải sửa.
      this.orderModel.aggregate<{ _id: string; count: number }>([
        { $match: { ...errBase, designerStatus: 'rework', assignee: { $exists: true, $ne: null } } },
        { $group: { _id: '$assignee', count: { $sum: 1 } } },
      ]),
      // Đã báo lỗi trong kỳ (theo thời điểm báo = timeline.at).
      this.orderModel.aggregate<{ _id: { uid: string; name?: string }; count: number }>([
        {
          $match: {
            fulfillmentTimeline: { $elemMatch: { action: 'rework-back' } },
            ...(factoryId ? { factoryId } : { factoryId: productionFactoryClause(this.orderModel.db) }),
          },
        },
        { $unwind: '$fulfillmentTimeline' },
        {
          $match: {
            'fulfillmentTimeline.action': 'rework-back',
            'fulfillmentTimeline.at': { $gte: range.start, $lte: range.end },
            'fulfillmentTimeline.byUserId': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: { uid: '$fulfillmentTimeline.byUserId', name: '$fulfillmentTimeline.byUserName' },
            count: { $sum: 1 },
          },
        },
      ]),
      // Map (factory, stage) → user phụ trách công đoạn đó.
      this.userModel
        .find(
          { fulfillmentStage: { $exists: true, $ne: null } },
          { _id: 1, fullName: 1, factoryId: 1, fulfillmentStage: 1 },
        )
        .lean(),
    ]);

    const stageUserMap = new Map<string, { id: string; name: string }>();
    for (const u of stageUsers) {
      stageUserMap.set(`${String(u.factoryId ?? '')}::${u.fulfillmentStage}`, {
        id: String(u._id),
        name: u.fullName,
      });
    }

    const rowMap = new Map<string, PersonErrorRow>();
    const ensure = (userId: string, name: string, roleLabel: string): PersonErrorRow => {
      let r = rowMap.get(userId);
      if (!r) {
        r = { userId, name, roleLabel, needFixCount: 0, reportedCount: 0 };
        rowMap.set(userId, r);
      }
      return r;
    };

    // Chiều needFix — fulfillment.
    for (const g of fulfillAgg) {
      const stage = g._id.stage as FulfillmentStage;
      const label = FULFILLMENT_STAGE_LABELS[stage] ?? stage;
      const key = `${String(g._id.factoryId ?? '')}::${stage}`;
      const su = stageUserMap.get(key);
      const userId = su?.id ?? `stage:${String(g._id.factoryId ?? '')}:${stage}`;
      const name = su?.name ?? `Chưa gán · ${label}`;
      ensure(userId, name, label).needFixCount += g.count;
    }
    // Chiều needFix — designer (tên resolve sau).
    const designerIds = designerAgg.map((g) => g._id).filter(Boolean);
    for (const g of designerAgg) ensure(g._id, `#${g._id.slice(-4)}`, 'Designer').needFixCount += g.count;

    // Chiều reported.
    for (const g of reportedAgg) {
      const uid = g._id.uid;
      if (!uid) continue;
      const existing = rowMap.get(uid);
      const roleLabel = existing?.roleLabel ?? '—';
      ensure(uid, g._id.name || existing?.name || `#${uid.slice(-4)}`, roleLabel).reportedCount += g.count;
    }

    // Resolve tên + roleLabel cho các user chưa có tên đẹp (designer assignee +
    // reporter chưa xuất hiện ở chiều needFix).
    const needName = [...rowMap.keys()].filter((id) => !id.startsWith('stage:'));
    if (needName.length > 0) {
      const users = await this.userModel
        .find({ _id: { $in: needName } }, { _id: 1, fullName: 1, fulfillmentStage: 1 })
        .lean();
      const isDesigner = new Set(designerIds.map(String));
      for (const u of users) {
        const r = rowMap.get(String(u._id));
        if (!r) continue;
        r.name = u.fullName || r.name;
        if (r.roleLabel === '—' || r.roleLabel === 'Designer') {
          if (u.fulfillmentStage) r.roleLabel = FULFILLMENT_STAGE_LABELS[u.fulfillmentStage] ?? r.roleLabel;
          else if (isDesigner.has(String(u._id))) r.roleLabel = 'Designer';
        }
      }
    }

    const rows = [...rowMap.values()].sort(
      (a, b) => b.needFixCount - a.needFixCount || b.reportedCount - a.reportedCount || a.name.localeCompare(b.name),
    );
    return { rows, from, to };
  }

  /**
   * Drill-down: danh sách đơn lỗi ĐANG cần 1 người sửa (từ leaderboard trên).
   * `userId` có thể là user thật hoặc synthetic `stage:<factory>:<stage>` (công
   * đoạn chưa gán người).
   */
  async getPersonErrorOrders(
    userId: string,
    from?: string,
    to?: string,
    days?: number,
  ): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const range = this.resolveRangeDays(from, to, days);
    const base: Record<string, unknown> = {
      inProductionAt: { $gte: range.start, $lte: range.end },
      productionError: { $exists: true, $nin: [null, ''] },
      toolResultNote: 'error',
      cancelledAt: null,
    };

    let match: Record<string, unknown>;
    if (userId.startsWith('stage:')) {
      const [, factory, stage] = userId.split(':');
      match = {
        ...base,
        factoryId: factory || undefined,
        currentFulfillmentStage: stage,
        designerStatus: { $ne: 'rework' },
      };
    } else {
      const user = await this.userModel.findById(userId, { fulfillmentStage: 1, factoryId: 1 }).lean();
      if (user?.fulfillmentStage) {
        match = {
          ...base,
          factoryId: user.factoryId,
          currentFulfillmentStage: user.fulfillmentStage,
          designerStatus: { $ne: 'rework' },
        };
      } else {
        // Designer.
        match = { ...base, assignee: userId, designerStatus: 'rework' };
      }
    }

    const proj = {
      productionId: 1,
      type: 1,
      size: 1,
      color: 1,
      quantity: 1,
      mockupUrl: 1,
      productionError: 1,
      productionErrorNote: 1,
      productionErrorSource: 1,
      currentFulfillmentStage: 1,
      designerStatus: 1,
      inProductionAt: 1,
    };
    const [data, total] = await Promise.all([
      this.orderModel.find(match, proj).sort({ priority: -1, inProductionAt: -1 }).limit(500).lean(),
      this.orderModel.countDocuments(match),
    ]);
    return { data: data.map((d) => ({ ...d, _id: String(d._id) })), total };
  }

  /**
   * Bảng lỗi theo NGÀY (`inProductionAt`, VN tz) cho 1 công đoạn — hàng = mã lỗi,
   * cột = ngày. Dùng cho ô "Thống kê lỗi công đoạn" trong trang task fulfillment.
   */
  async getStageErrorDaily(
    stage: FulfillmentStage,
    factoryId?: string,
    from?: string,
    to?: string,
    days?: number,
  ): Promise<{
    days: string[];
    rows: { code: string; name: string; cells: number[]; total: number }[];
    columnTotals: number[];
    grandTotal: number;
  }> {
    const MS_DAY = 86_400_000;
    const DAY_CAP = 100;
    const vnStartD = (d: string) => new Date(`${d}T00:00:00+07:00`);
    const vnEndD = (d: string) => new Date(`${d}T23:59:59.999+07:00`);
    const vnToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const dayList: string[] = [];
    const dayIndex = new Map<string, number>();
    let start: Date;
    let end: Date;
    if (from || to) {
      const f = (from || to)!.slice(0, 10);
      const t = (to || from)!.slice(0, 10);
      start = vnStartD(f);
      end = vnEndD(t);
      let cur = vnStartD(t).getTime();
      const startMs = start.getTime();
      let i = 0;
      while (cur >= startMs && i < DAY_CAP) {
        const d = new Date(cur + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
        dayIndex.set(d, i);
        dayList.push(d);
        cur -= MS_DAY;
        i++;
      }
    } else {
      const rangeDays = days && days > 0 ? days : 7;
      const baseMs = vnStartD(vnToday).getTime();
      for (let i = 0; i < rangeDays; i++) {
        const d = new Date(baseMs - i * MS_DAY + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
        dayIndex.set(d, i);
        dayList.push(d);
      }
      start = new Date(baseMs - (rangeDays - 1) * MS_DAY);
      end = vnEndD(vnToday);
    }

    const agg = await this.orderModel.aggregate<{ _id: { code: string; day: string }; count: number }>([
      {
        $match: {
          inProductionAt: { $gte: start, $lte: end },
          currentFulfillmentStage: stage,
          productionError: { $exists: true, $nin: [null, ''] },
          toolResultNote: 'error',
          cancelledAt: null,
          ...(factoryId ? { factoryId } : { factoryId: productionFactoryClause(this.orderModel.db) }),
        },
      },
      {
        $group: {
          _id: {
            code: '$productionError',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$inProductionAt', timezone: '+07:00' } },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Resolve code → name.
    const cfgs = await this.workshopConfigModel
      .find({ category: WorkshopConfigCategory.ProductionError }, { code: 1, name: 1 })
      .lean();
    const nameMap = new Map<string, string>();
    for (const c of cfgs) nameMap.set(c.code, c.name);

    const rowCells = new Map<string, number[]>();
    const rowTotal = new Map<string, number>();
    for (const r of agg) {
      const code = r._id.code;
      if (!rowCells.has(code))
        rowCells.set(
          code,
          dayList.map(() => 0),
        );
      rowTotal.set(code, (rowTotal.get(code) ?? 0) + r.count);
      const col = dayIndex.get(r._id.day);
      if (col !== undefined) rowCells.get(code)![col] += r.count;
    }

    const columnTotals = dayList.map(() => 0);
    let grandTotal = 0;
    const rows = [...rowCells.entries()].map(([code, cells]) => {
      cells.forEach((v, i) => (columnTotals[i] += v));
      const total = rowTotal.get(code) ?? 0;
      grandTotal += total;
      return { code, name: nameMap.get(code) || code, cells, total };
    });
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { days: dayList, rows, columnTotals, grandTotal };
  }

  private resolveRange(from?: string, to?: string): { start: Date; end: Date } {
    if (!from && !to) {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const start = new Date();
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    const start = from ? new Date(from) : new Date(0);
    start.setHours(0, 0, 0, 0);
    const end = to ? new Date(to) : new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
}
