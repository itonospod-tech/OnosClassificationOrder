import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { customerMatchKey, DesignerStatus, FulfillmentStage } from 'shared';

import { CustomerAssignmentService } from '@/modules/customer-assignment/customer-assignment.service';
import { FactoryRepository } from '@/modules/factory/factory.repository';
import { OrderEntity } from '@/modules/order/order.entity';
import { UserEntity } from '@/modules/user/user.entity';
import { designerFlowConds } from '@/utils/designer-flow';
import { getExcludedFactoryIdSync, productionFactoryClause } from '@/utils/excluded-factory';

import { buildReportDayWindows, SLA_DAY_COUNT } from '../build-period';
import type { SupportHold } from '../support-hold';
import type { DailyOrdersReportData, DesignerReportDay, ReportDayStats, SlaCohortRow } from '../types';

type MetricShape = {
  total: number;
  stockOut: number;
  soat: number;
  design: number;
  inPressQc: number;
  sew: number;
  pack: number;
  completedWithin2d: number;
  errorCount: number;
  needAction: number;
  rework: number;
  inProgress: number;
  done: number;
  backlog: number;
  unassignedNeed: number;
};
type DayGroupRow = MetricShape & { _id: number };
type CustomerGroupRow = MetricShape & { _id: { day: number; sku: string; email: string } };
type DesignerGroupRow = {
  _id: { day: number; assignee: string };
  errorCount: number;
  needAction: number;
  rework: number;
  inProgress: number;
  done: number;
};
type ToolCheckGroupRow = {
  _id: number;
  total: number;
  unreviewed: number;
  noteNotOk: number;
  reviewedOk: number;
  rework: number;
};

/**
 * 1 lần aggregate cho CẢ 3 view báo cáo Telegram (chính / theo designer /
 * theo xưởng) — `REPORT_DAY_COUNT` ngày liền kề, bucket `inProductionAt` giờ
 * VN. Scope MIRROR bảng "Tổng quan N ngày" Dashboard (`getDailyOverview`):
 * loại đơn hủy + đơn CHƯA map xưởng + xưởng US; công thức thiết kế tái dùng
 * `designerFlowConds()` — số khớp 100% bảng web.
 */
@Injectable()
export class DailyOrdersAggregator {
  constructor(
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    @InjectModel(UserEntity.name) private readonly userModel: Model<UserEntity>,
    private readonly customerAssignmentService: CustomerAssignmentService,
    private readonly factoryRepository: FactoryRepository,
  ) {}

  async aggregate(now: Date, factoryId?: string): Promise<DailyOrdersReportData> {
    const windows = buildReportDayWindows(now);
    const priorityCustomers = await this.customerAssignmentService.getPriorityCustomers();
    const prioritySkus = Array.from(new Set(priorityCustomers.map((c) => c.userSku)));

    const baseMatch: Record<string, unknown> = {
      cancelledAt: null,
      // Lọc 1 xưởng khi có `factoryId` (nút xưởng); mặc định = mọi xưởng SX (loại US).
      factoryId: factoryId || productionFactoryClause(this.orderModel.db),
      inProductionAt: { $gte: windows[0].from, $lt: windows[windows.length - 1].to },
    };

    const { assigneeExpr, statusExpr, s4Cond, poolCond, toolErrHasCond, backlogCond, unassignedNeedCond } =
      designerFlowConds();
    const assignedStatusCond = (status: DesignerStatus) => ({
      $and: [{ $ne: [assigneeExpr, ''] }, { $eq: [statusExpr, status] }],
    });
    // Phễu vòng đời: mỗi đơn ĐANG ở đúng 1 chặng (partition). `currentFulfillmentStage`
    // null = chưa vào fulfillment (soát tool/thiết kế) HOẶC đã pack done →
    // phân biệt bằng `fulfillmentCompletedAt`.
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
    const cfsExpr = { $ifNull: ['$currentFulfillmentStage', ''] };
    const completedExpr = { $ne: [{ $ifNull: ['$fulfillmentCompletedAt', null] }, null] };
    const notCompletedExpr = { $eq: [{ $ifNull: ['$fulfillmentCompletedAt', null] }, null] };
    // Chưa vào fulfillment (cfs rỗng) & chưa hoàn thành = còn ở giai đoạn soát/thiết kế.
    const preFulfillExpr = { $and: [{ $eq: [cfsExpr, ''] }, notCompletedExpr] };
    // Chưa soát tool = toolResultNote rỗng (khớp định nghĩa Lifecycle "chưa soát").
    const noteEmptyExpr = { $eq: [{ $ifNull: ['$toolResultNote', ''] }, ''] };

    const metricFields = {
      total: { $sum: 1 },
      stockOut: { $sum: { $cond: [completedExpr, 1, 0] } },
      // Tồn ở Soát tool: chưa vào fulfillment & chưa soát (note rỗng).
      soat: { $sum: { $cond: [{ $and: [preFulfillExpr, noteEmptyExpr] }, 1, 0] } },
      // Tồn ở Thiết kế: đã soát nhưng chưa vào fulfillment (đang/chờ thiết kế).
      design: { $sum: { $cond: [{ $and: [preFulfillExpr, { $not: [noteEmptyExpr] }] }, 1, 0] } },
      inPressQc: {
        $sum: {
          $cond: [
            { $in: [cfsExpr, [FulfillmentStage.Print, FulfillmentStage.Press, FulfillmentStage.QCPostPress]] },
            1,
            0,
          ],
        },
      },
      sew: { $sum: { $cond: [{ $in: [cfsExpr, [FulfillmentStage.SewIn, FulfillmentStage.SewOut]] }, 1, 0] } },
      pack: { $sum: { $cond: [{ $eq: [cfsExpr, FulfillmentStage.Pack] }, 1, 0] } },
      // Hoàn thành trong ≤2 ngày kể từ vào sản xuất (cho cột %2n).
      completedWithin2d: {
        $sum: {
          $cond: [
            {
              $and: [
                completedExpr,
                { $lte: [{ $subtract: ['$fulfillmentCompletedAt', '$inProductionAt'] }, TWO_DAYS_MS] },
              ],
            },
            1,
            0,
          ],
        },
      },
      // Tổng lỗi = "soát lỗi + đẩy về" = `poolCond` (từng soát ra lỗi ∨ đã vào
      // flow designer) — KHỚP CHÍNH XÁC hàng "Tổng lỗi" bảng Tổng quan Dashboard
      // (toolError + wasOkPushed = poolCond, 2 nửa rời nhau).
      errorCount: { $sum: { $cond: [poolCond, 1, 0] } },
      needAction: { $sum: { $cond: [assignedStatusCond(DesignerStatus.Assigned), 1, 0] } },
      rework: { $sum: { $cond: [assignedStatusCond(DesignerStatus.Rework), 1, 0] } },
      inProgress: { $sum: { $cond: [assignedStatusCond(DesignerStatus.InProgress), 1, 0] } },
      done: { $sum: { $cond: [assignedStatusCond(DesignerStatus.Done), 1, 0] } },
      backlog: { $sum: { $cond: [backlogCond, 1, 0] } },
      unassignedNeed: { $sum: { $cond: [unassignedNeedCond, 1, 0] } },
    };
    const designerStatusFields = {
      // Lỗi (per-designer) = số đơn của họ TỪNG bị soát tool ra lỗi
      // (`toolErrHasCond` = "soát lỗi"). KHÔNG dùng poolCond ở đây vì nhánh này
      // đã lọc s4 → poolCond luôn true = tổng đơn (vô nghĩa).
      errorCount: { $sum: { $cond: [toolErrHasCond, 1, 0] } },
      needAction: { $sum: { $cond: [{ $eq: [statusExpr, DesignerStatus.Assigned] }, 1, 0] } },
      rework: { $sum: { $cond: [{ $eq: [statusExpr, DesignerStatus.Rework] }, 1, 0] } },
      inProgress: { $sum: { $cond: [{ $eq: [statusExpr, DesignerStatus.InProgress] }, 1, 0] } },
      done: { $sum: { $cond: [{ $eq: [statusExpr, DesignerStatus.Done] }, 1, 0] } },
    };

    const [agg] = await this.orderModel.aggregate<{
      days: DayGroupRow[];
      customers: CustomerGroupRow[];
      designers: DesignerGroupRow[];
      toolCheck: ToolCheckGroupRow[];
    }>([
      { $match: baseMatch },
      {
        $addFields: {
          // Index ngày trong `windows` — match đã bound [from đầu, to cuối) nên
          // branch `$lt window.to` đầu tiên khớp chính là ngày của đơn.
          __dayIdx: {
            $switch: {
              branches: windows.map((w, i) => ({ case: { $lt: ['$inProductionAt', w.to] }, then: i })),
              default: windows.length - 1,
            },
          },
        },
      },
      {
        $facet: {
          days: [{ $group: { _id: '$__dayIdx', ...metricFields } }],
          customers: prioritySkus.length
            ? [
                { $match: { userSku: { $in: prioritySkus } } },
                {
                  $group: {
                    _id: {
                      day: '$__dayIdx',
                      sku: '$userSku',
                      email: { $toLower: { $ifNull: ['$userEmail', ''] } },
                    },
                    ...metricFields,
                  },
                },
              ]
            : [{ $match: { _id: { $exists: false } } }],
          designers: [
            // "Đã gán designer" — assignee set + status ∈ 4 trạng thái (MIRROR ma trận).
            { $match: { $expr: { $and: [{ $ne: [assigneeExpr, ''] }, s4Cond] } } },
            { $group: { _id: { day: '$__dayIdx', assignee: '$assignee' }, ...designerStatusFields } },
          ],
          // Soát tool per-day (mirror bảng "Tổng quan theo ngày" tab Soát tool).
          toolCheck: [
            {
              $group: {
                _id: '$__dayIdx',
                total: { $sum: 1 },
                unreviewed: { $sum: { $cond: [noteEmptyExpr, 1, 0] } },
                noteNotOk: { $sum: { $cond: [toolErrHasCond, 1, 0] } },
                reviewedOk: {
                  $sum: { $cond: [{ $and: [{ $not: [noteEmptyExpr] }, { $not: [toolErrHasCond] }] }, 1, 0] },
                },
                rework: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$productionErrorSource', 'tool-check'] },
                          { $eq: [{ $ifNull: ['$toolResultNote', ''] }, 'error'] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    const zeroDay = (label: string): ReportDayStats => ({
      label,
      total: 0,
      stockOut: 0,
      soat: 0,
      design: 0,
      inPressQc: 0,
      sew: 0,
      pack: 0,
      completedWithin2d: 0,
      errorCount: 0,
      needAction: 0,
      rework: 0,
      inProgress: 0,
      done: 0,
      backlog: 0,
      unassignedNeed: 0,
    });
    const toStats = (label: string, r: MetricShape): ReportDayStats => ({
      label,
      total: r.total,
      stockOut: r.stockOut,
      soat: r.soat,
      design: r.design,
      inPressQc: r.inPressQc,
      sew: r.sew,
      pack: r.pack,
      completedWithin2d: r.completedWithin2d,
      errorCount: r.errorCount,
      needAction: r.needAction,
      rework: r.rework,
      inProgress: r.inProgress,
      done: r.done,
      backlog: r.backlog,
      unassignedNeed: r.unassignedNeed,
    });

    const days = windows.map((w, idx) => {
      const row = (agg?.days || []).find((d) => d._id === idx);

      return row ? toStats(w.label, row) : zeroDay(w.label);
    });

    // Join số liệu (sku,email) → khách ưu tiên qua customerMatchKey (khóa nhận
    // diện chung toàn hệ thống — trim sku + lowercase email).
    const statsByKey = new Map<string, ReportDayStats[]>();
    for (const row of agg?.customers || []) {
      const key = customerMatchKey(row._id.sku, row._id.email);
      const perDay = statsByKey.get(key) ?? windows.map((w) => zeroDay(w.label));
      perDay[row._id.day] = toStats(windows[row._id.day].label, row);
      statsByKey.set(key, perDay);
    }
    const priorityRows = priorityCustomers.map((c) => ({
      ...c,
      days: statsByKey.get(customerMatchKey(c.userSku, c.userEmail)) ?? windows.map((w) => zeroDay(w.label)),
    }));

    const designerDays = await this.buildDesignerDays(
      windows.map((w) => w.label),
      agg?.designers || [],
      days,
    );

    const toolCheckDays = windows.map((w, idx) => {
      const r = (agg?.toolCheck || []).find((t) => t._id === idx);
      const total = r?.total ?? 0;
      const unreviewed = r?.unreviewed ?? 0;

      return {
        label: w.label,
        total,
        unreviewed,
        reviewed: total - unreviewed,
        noteNotOk: r?.noteNotOk ?? 0,
        reviewedOk: r?.reviewedOk ?? 0,
        rework: r?.rework ?? 0,
      };
    });

    const [factories, { slaDays, slaFactories }, supportHold] = await Promise.all([
      this.listProductionFactories(),
      this.aggregateSla(now, factoryId),
      this.aggregateSupportHold(now, factoryId),
    ]);

    return { days, priorityRows, designerDays, toolCheckDays, slaDays, slaFactories, supportHold, factories };
  }

  /**
   * Orders held by Support (marker pair) over ALL ages + the age of the oldest. Hold start = the latest
   * timeline entry that sent the order to tool-check (every send-back path writes one); falls back to
   * the first-error stamp, then `updatedAt`. Same scope as the funnel (no cancelled/deleted/unmapped/US).
   */
  private async aggregateSupportHold(now: Date, factoryId?: string): Promise<SupportHold> {
    const toolCheckAts = {
      $map: {
        input: {
          $filter: {
            input: { $ifNull: ['$fulfillmentTimeline', []] },
            cond: { $eq: ['$$this.reworkTarget', 'tool-check'] },
          },
        },
        in: '$$this.at',
      },
    };
    const [row] = await this.orderModel.aggregate<{ count: number; oldest: Date | null }>([
      {
        $match: {
          cancelledAt: null,
          deletedAt: null,
          factoryId: factoryId || productionFactoryClause(this.orderModel.db),
          productionErrorSource: 'tool-check',
          toolResultNote: 'error',
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          oldest: { $min: { $ifNull: [{ $max: toolCheckAts }, { $ifNull: ['$productionFirstErrorAt', '$updatedAt'] }] } },
        },
      },
    ]);

    return {
      count: row?.count ?? 0,
      oldestHours: row?.oldest ? (now.getTime() - new Date(row.oldest).getTime()) / 3_600_000 : 0,
    };
  }

  /**
   * Section "SLA sản xuất" — cohort theo ngày vào SX (`SLA_DAY_COUNT` ngày
   * liền kề, TÍNH CẢ Chủ nhật — khách lên đơn cả CN, user đã chốt; cửa sổ
   * RỘNG hơn phễu chính nên aggregate riêng): mỗi lô đếm stock out theo độ
   * trễ NGÀY LỊCH VN (N0/N1/N2/N3/trễ hơn/chưa xong) + đơn chưa xong đang kẹt
   * ở chặng nào; kèm `slaFactories` = tồn sau hạn N2 gộp theo xưởng (chỉ view
   * tổng). Cùng scope phễu chính (loại đơn hủy/chưa map xưởng/US, lọc 1 xưởng
   * khi có `factoryId`). Đơn giữ (hold) TÍNH GỘP. Chỉ tiêu: `SLA_TARGETS`.
   */
  private async aggregateSla(
    now: Date,
    factoryId?: string,
  ): Promise<{ slaDays: SlaCohortRow[]; slaFactories: { name: string; total: number; byDay: number[] }[] }> {
    const windows = buildReportDayWindows(now, SLA_DAY_COUNT);
    const MS_DAY = 86_400_000;
    const TZ_MS = 7 * 3_600_000;
    // Chỉ số ngày-lịch-VN của 1 mốc thời gian (epoch-day sau khi dịch +7h).
    const vnDayIdx = (field: string) => ({ $floor: { $divide: [{ $add: [{ $toLong: field }, TZ_MS] }, MS_DAY] } });

    const completedExpr = { $ne: [{ $ifNull: ['$fulfillmentCompletedAt', null] }, null] };
    const notCompletedExpr = { $eq: [{ $ifNull: ['$fulfillmentCompletedAt', null] }, null] };
    const cfsExpr = { $ifNull: ['$currentFulfillmentStage', ''] };
    const preFulfillExpr = { $and: [{ $eq: [cfsExpr, ''] }, notCompletedExpr] };
    const noteEmptyExpr = { $eq: [{ $ifNull: ['$toolResultNote', ''] }, ''] };
    // Độ trễ = hiệu ngày lịch VN (KHÁC cột %≤2 ngày của phễu vốn tính 48h tròn).
    const lagExpr = { $subtract: [vnDayIdx('$fulfillmentCompletedAt'), vnDayIdx('$inProductionAt')] };
    const doneAtLag = (cond: Record<string, unknown>) => ({
      $sum: { $cond: [{ $and: [completedExpr, cond] }, 1, 0] },
    });

    // Lô "đã đến hạn N2" = tuổi ≥ 2 ngày → mọi window trừ 2 window cuối.
    const overdueWindows = windows.slice(0, -2);

    const [agg] = await this.orderModel.aggregate<{
      days: (Omit<SlaCohortRow, 'label' | 'ageDays'> & { _id: number })[];
      factories: { _id: { day: number; factoryId: string }; notDone: number }[];
    }>([
      {
        $match: {
          cancelledAt: null,
          factoryId: factoryId || productionFactoryClause(this.orderModel.db),
          inProductionAt: { $gte: windows[0].from, $lt: windows[windows.length - 1].to },
        },
      },
      {
        $addFields: {
          __dayIdx: {
            $switch: {
              branches: windows.map((w, i) => ({ case: { $lt: ['$inProductionAt', w.to] }, then: i })),
              default: windows.length - 1,
            },
          },
        },
      },
      {
        $facet: {
          days: [
            {
              $group: {
                _id: '$__dayIdx',
                total: { $sum: 1 },
                // lag ≤ 0 gom về N0 (phòng data lệch: completedAt sớm hơn inProductionAt).
                doneN0: doneAtLag({ $lte: [lagExpr, 0] }),
                doneN1: doneAtLag({ $eq: [lagExpr, 1] }),
                doneN2: doneAtLag({ $eq: [lagExpr, 2] }),
                doneN3: doneAtLag({ $eq: [lagExpr, 3] }),
                doneLate: doneAtLag({ $gte: [lagExpr, 4] }),
                notDone: { $sum: { $cond: [notCompletedExpr, 1, 0] } },
                // Chưa xong đang kẹt ở đâu — cùng định nghĩa 5 chặng của phễu chính.
                stuckSoat: { $sum: { $cond: [{ $and: [preFulfillExpr, noteEmptyExpr] }, 1, 0] } },
                stuckDesign: { $sum: { $cond: [{ $and: [preFulfillExpr, { $not: [noteEmptyExpr] }] }, 1, 0] } },
                stuckInPressQc: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          cfsExpr,
                          [FulfillmentStage.Print, FulfillmentStage.Press, FulfillmentStage.QCPostPress],
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                stuckSew: {
                  $sum: { $cond: [{ $in: [cfsExpr, [FulfillmentStage.SewIn, FulfillmentStage.SewOut]] }, 1, 0] },
                },
                stuckPack: { $sum: { $cond: [{ $eq: [cfsExpr, FulfillmentStage.Pack] }, 1, 0] } },
              },
            },
          ],
          // Tồn sau hạn N2 theo (ngày, xưởng) — ma trận ngày × xưởng cho bảng
          // "tồn theo xưởng". Chỉ tính khi view tổng (không lọc xưởng) và có lô
          // đã đến hạn. Nhánh rỗng: match không bao giờ khớp.
          factories:
            !factoryId && overdueWindows.length > 0
              ? [
                  { $match: { $expr: { $lt: ['$__dayIdx', overdueWindows.length] }, fulfillmentCompletedAt: null } },
                  { $group: { _id: { day: '$__dayIdx', factoryId: '$factoryId' }, notDone: { $sum: 1 } } },
                ]
              : [{ $match: { _id: { $exists: false } } }],
        },
      },
    ]);

    const slaDays = windows.map((w, idx) => {
      const r = (agg?.days || []).find((x) => x._id === idx);

      return {
        label: w.label,
        ageDays: windows.length - 1 - idx,
        total: r?.total ?? 0,
        doneN0: r?.doneN0 ?? 0,
        doneN1: r?.doneN1 ?? 0,
        doneN2: r?.doneN2 ?? 0,
        doneN3: r?.doneN3 ?? 0,
        doneLate: r?.doneLate ?? 0,
        notDone: r?.notDone ?? 0,
        stuckSoat: r?.stuckSoat ?? 0,
        stuckDesign: r?.stuckDesign ?? 0,
        stuckInPressQc: r?.stuckInPressQc ?? 0,
        stuckSew: r?.stuckSew ?? 0,
        stuckPack: r?.stuckPack ?? 0,
      };
    });

    // Gom (ngày, xưởng) → ma trận byDay per xưởng; resolve tên (list đã loại
    // xưởng US — xưởng ngoài list bỏ qua), sort tổng tồn giảm dần.
    const factoryRows = agg?.factories || [];
    let slaFactories: { name: string; total: number; byDay: number[] }[] = [];
    if (factoryRows.length > 0) {
      const names = await this.listProductionFactories();
      const nameById = new Map(names.map((f) => [f.id, f.name]));
      const byFactory = new Map<string, number[]>();
      for (const r of factoryRows) {
        const id = String(r._id.factoryId);
        if (!nameById.has(id)) continue;
        const byDay = byFactory.get(id) ?? new Array(overdueWindows.length).fill(0);
        byDay[r._id.day] = r.notDone;
        byFactory.set(id, byDay);
      }
      slaFactories = [...byFactory.entries()]
        .map(([id, byDay]) => ({
          name: nameById.get(id) as string,
          total: byDay.reduce((s, n) => s + n, 0),
          byDay,
        }))
        .sort((a, b) => b.total - a.total);
    }

    return { slaDays, slaFactories };
  }

  /** Danh sách xưởng sản xuất (loại xưởng US) để dựng nút "🏭 <tên>" — độc lập filter. */
  private async listProductionFactories(): Promise<DailyOrdersReportData['factories']> {
    const excludedId = getExcludedFactoryIdSync(this.orderModel.db);
    const rows = await this.factoryRepository.findAll({ deletedAt: { $exists: false } });

    return rows
      .filter((f) => String(f._id) !== excludedId)
      .map((f) => ({ id: String(f._id), name: f.shortName || f.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** View "Theo designer": mỗi ngày 1 block, resolve assignee → fullName, sort tồn giảm dần. */
  private async buildDesignerDays(
    dayLabels: string[],
    rows: DesignerGroupRow[],
    dayStats: ReportDayStats[],
  ): Promise<DesignerReportDay[]> {
    const userIds = Array.from(new Set(rows.map((r) => r._id.assignee).filter(Boolean)));
    const users = userIds.length ? await this.userModel.find({ _id: { $in: userIds } }, { fullName: 1 }).lean() : [];
    const nameById = new Map(users.map((u) => [String(u._id), u.fullName]));

    return dayLabels.map((label, idx) => {
      const dayRows = rows
        .filter((r) => r._id.day === idx)
        .map((r) => ({
          fullName: nameById.get(r._id.assignee) || 'Khác (đã tắt)',
          errorCount: r.errorCount,
          needAction: r.needAction,
          rework: r.rework,
          inProgress: r.inProgress,
          done: r.done,
        }))
        .sort(
          (a, b) =>
            b.needAction + b.rework + b.inProgress - (a.needAction + a.rework + a.inProgress) || b.done - a.done,
        );

      return { label, rows: dayRows, unassignedNeed: dayStats[idx]?.unassignedNeed ?? 0 };
    });
  }
}
