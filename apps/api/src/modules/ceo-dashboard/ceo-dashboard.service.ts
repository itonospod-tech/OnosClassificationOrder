import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { CeoFinding, CeoOverview } from 'shared';
import type { ProductLine } from 'shared';
import { DesignerStatus, OPEN_ORDER_STALE_DAYS } from 'shared';

import { productionFactoryClause } from '@/utils/excluded-factory';
import { workshopStageSwitchExpr } from '@/utils/workshop-stage';

import { OrderDocument, OrderEntity } from '../order/order.entity';
import { SLA_TARGETS } from '../scheduled-reports/build-period';
import { UserEntity } from '../user/user.entity';

const TZ = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_DAYS = 92;
const HISTORY_DAYS = 30;
/** Đơn mở quá số ngày này = đơn treo (nợ dữ liệu, chưa đóng trên hệ thống) — tách khỏi tồn/quá hạn. */
const STALE_DAYS = OPEN_ORDER_STALE_DAYS;
const TOP_CUSTOMERS = 10;

type Row = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;
const pct = (part: number, whole: number): number | null => (whole > 0 ? round((part / whole) * 100) : null);
const dayStr = (field: string) => ({ $dateToString: { date: `$${field}`, format: '%Y-%m-%d', timezone: TZ } });
const dayDiff = (endDate: unknown, startDate: unknown) => ({ $dateDiff: { startDate, endDate, unit: 'day', timezone: TZ } });
// Biểu thức aggregation (KHÔNG dùng `$nin` — đó là toán tử truy vấn): đơn có lỗi xưởng =
// đã từng báo lỗi (`productionErrorCount` > 0) hoặc đang mang mã lỗi.
const erroredCond = {
  $or: [
    { $gt: [{ $ifNull: ['$productionErrorCount', 0] }, 0] },
    { $not: [{ $in: [{ $ifNull: ['$productionError', ''] }, ['', null]] }] },
  ],
};
const completedCond = { $ne: [{ $ifNull: ['$fulfillmentCompletedAt', null] }, null] };

/** Ngày yyyy-mm-dd (giờ VN) → mốc 00:00 VN dạng Date UTC. */
function vnDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+07:00`);
}
/** Date → yyyy-mm-dd theo giờ VN. */
function toVnDay(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * CEO Dashboard — gom 7 khối cho lãnh đạo từ collection `orders` (+ tên xưởng/user/tier
 * khách). Bộ lọc chuẩn của mọi thống kê: loại đơn hủy, đơn chưa map xưởng, xưởng US
 * (`productionFactoryClause`). Kỳ so sánh = kỳ liền trước cùng độ dài. Kết quả cache
 * 5 phút theo (from,to) — CEO xem nhiều lần trong buổi họp không đè DB.
 */
@Injectable()
export class CeoDashboardService {
  private readonly cache = new Map<string, { at: number; data: CeoOverview }>();

  constructor(
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(UserEntity.name) private readonly userModel: Model<UserEntity>,
  ) {}

  async getOverview(from: string, to: string, productLine?: ProductLine): Promise<CeoOverview> {
    const start = vnDayStart(from);
    const end = new Date(vnDayStart(to).getTime() + DAY_MS);
    if (!(end > start)) throw new BadRequestException('`to` phải ≥ `from`');
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (days > MAX_DAYS) throw new BadRequestException(`Khoảng tối đa ${MAX_DAYS} ngày`);
    const key = `${from}|${to}|${productLine ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.data, period: { ...hit.data.period, cached: true } };

    const now = new Date();
    // Kỳ so sánh CHÍNH luôn là kỳ liền trước cùng độ dài (1 ngày = hôm qua → đọc TIẾN ĐỘ);
    // kỳ 1 ngày có thêm tham chiếu NHỊP (`reference`: cùng thứ tuần trước + TB 7 ngày) để không
    // đọc nhầm Chủ nhật/thứ Hai thấp-cao theo nhịp tuần thành sụt/tăng năng lực.
    const isDay = days === 1;
    const cmpStart = new Date(start.getTime() - days * DAY_MS);
    const cmpEnd = start;
    // Lô SLA: kỳ 1 ngày → lô vào ngày D−2 (đã đủ tuổi N2), so với lô D−3; kỳ dài → chính kỳ.
    const slaStart = isDay ? new Date(start.getTime() - 2 * DAY_MS) : start;
    const slaEnd = isDay ? new Date(start.getTime() - DAY_MS) : end;
    const slaPrevStart = isDay ? new Date(slaStart.getTime() - DAY_MS) : cmpStart;
    const slaPrevEnd = isDay ? new Date(slaEnd.getTime() - DAY_MS) : cmpEnd;
    // Chuỗi ngày cho biểu đồ: kỳ 1 ngày phủ 7 ngày trước + hôm nay; kỳ dài phủ kỳ trước + kỳ này.
    const prevStart = isDay ? new Date(start.getTime() - 7 * DAY_MS) : cmpStart;
    const weekday = new Date(start.getTime() + 7 * 3_600_000).getUTCDay();
    const base: Row = {
      cancelledAt: { $exists: false },
      factoryId: productionFactoryClause(this.orderModel.db),
      // PRD-8 — tab dịch vụ ở Seller Hub Operations: KPI/SLA/chất lượng/xưởng đều theo dòng sản phẩm.
      ...(productLine ? { productLine } : {}),
    };
    const inRange = (s: Date, e: Date) => ({ $gte: s, $lt: e });

    const cohortGroup = {
      $group: {
        _id: null,
        n: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$baseCost', 0] } },
        ship: { $sum: { $ifNull: ['$shipCost', 0] } },
        errored: { $sum: { $cond: [erroredCond, 1, 0] } },
        completed: { $sum: { $cond: [completedCond, 1, 0] } },
        n0: { $sum: { $cond: [{ $and: [completedCond, { $lte: [dayDiff('$fulfillmentCompletedAt', '$inProductionAt'), 0] }] }, 1, 0] } },
        n1: { $sum: { $cond: [{ $and: [completedCond, { $lte: [dayDiff('$fulfillmentCompletedAt', '$inProductionAt'), 1] }] }, 1, 0] } },
        n2: { $sum: { $cond: [{ $and: [completedCond, { $lte: [dayDiff('$fulfillmentCompletedAt', '$inProductionAt'), 2] }] }, 1, 0] } },
        mature: { $sum: { $cond: [{ $gte: [dayDiff(now, '$inProductionAt'), 2] }, 1, 0] } },
        matureN2: {
          $sum: {
            $cond: [
              { $and: [{ $gte: [dayDiff(now, '$inProductionAt'), 2] }, completedCond, { $lte: [dayDiff('$fulfillmentCompletedAt', '$inProductionAt'), 2] }] },
              1,
              0,
            ],
          },
        },
      },
    };
    const factoryGroup = {
      $group: {
        _id: '$factoryId',
        n: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$baseCost', 0] } },
        errored: { $sum: { $cond: [erroredCond, 1, 0] } },
        completed: { $sum: { $cond: [completedCond, 1, 0] } },
        backlog: { $sum: { $cond: [completedCond, 0, 1] } },
        mature: { $sum: { $cond: [{ $gte: [dayDiff(now, '$inProductionAt'), 2] }, 1, 0] } },
        matureN2: {
          $sum: {
            $cond: [
              { $and: [{ $gte: [dayDiff(now, '$inProductionAt'), 2] }, completedCond, { $lte: [dayDiff('$fulfillmentCompletedAt', '$inProductionAt'), 2] }] },
              1,
              0,
            ],
          },
        },
      },
    };
    const customerGroup = {
      $group: {
        _id: { $ifNull: ['$userSku', ''] },
        n: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$baseCost', 0] } },
        held: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$heldAt', null] }, null] }, 1, 0] } },
        errored: { $sum: { $cond: [erroredCond, 1, 0] } },
      },
    };
    const overdueCutoff = new Date(vnDayStart(toVnDay(now)).getTime() - 2 * DAY_MS); // vào SX trước hôm-nay−2 (N3+)
    const histStart = new Date(end.getTime() - HISTORY_DAYS * DAY_MS);
    const staleCutoff = new Date(now.getTime() - STALE_DAYS * DAY_MS);
    const openActive: Row = { ...base, fulfillmentCompletedAt: { $exists: false }, inProductionAt: { $gte: staleCutoff } };

    const [daily, cur, prev, byFactoryRows, bySource, topTypes, typeTotals, overdueRows, overdueSample, custCur, custPrev, tierRows, openByStage, openAge, histDocs, desDone, desBacklog, desRework, workerRows, factoryDocs, staleOpen, outByFactory, slaCurRows, slaPrevRows, factorySlaRows] =
      await Promise.all([
        this.orderModel.aggregate<Row>([
          {
            $match: {
              ...base,
              $or: [
                { inProductionAt: inRange(prevStart, end) },
                { fulfillmentCompletedAt: inRange(prevStart, end) },
                { productionFirstErrorAt: inRange(prevStart, end) },
              ],
            },
          },
          {
            $facet: {
              in: [
                { $match: { inProductionAt: inRange(prevStart, end) } },
                { $group: { _id: dayStr('inProductionAt'), n: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$baseCost', 0] } } } },
              ],
              out: [{ $match: { fulfillmentCompletedAt: inRange(prevStart, end) } }, { $group: { _id: dayStr('fulfillmentCompletedAt'), n: { $sum: 1 } } }],
              err: [{ $match: { productionFirstErrorAt: inRange(prevStart, end) } }, { $group: { _id: dayStr('productionFirstErrorAt'), n: { $sum: 1 } } }],
              n2: [
                { $match: { inProductionAt: inRange(slaStart, slaEnd) } },
                {
                  $group: {
                    _id: dayStr('inProductionAt'),
                    mature: { $sum: { $cond: [{ $gte: [dayDiff(now, '$inProductionAt'), 2] }, 1, 0] } },
                    matureN2: {
                      $sum: {
                        $cond: [
                          { $and: [{ $gte: [dayDiff(now, '$inProductionAt'), 2] }, completedCond, { $lte: [dayDiff('$fulfillmentCompletedAt', '$inProductionAt'), 2] }] },
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
        ]),
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(start, end) } }, cohortGroup]),
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(cmpStart, cmpEnd) } }, cohortGroup]),
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(start, end) } }, factoryGroup, { $sort: { n: -1 } }]),
        this.orderModel.aggregate<Row>([
          { $match: { ...base, inProductionAt: inRange(start, end), $expr: erroredCond } },
          { $group: { _id: { $ifNull: ['$productionErrorSource', 'unknown'] }, n: { $sum: 1 } } },
          { $sort: { n: -1 } },
        ]),
        this.orderModel.aggregate<Row>([
          { $match: { ...base, inProductionAt: inRange(start, end), $expr: erroredCond } },
          { $group: { _id: { $ifNull: ['$type', ''] }, n: { $sum: 1 } } },
          { $sort: { n: -1 } },
          { $limit: 5 },
        ]),
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(start, end) } }, { $group: { _id: { $ifNull: ['$type', ''] }, n: { $sum: 1 } } }]),
        this.orderModel.aggregate<Row>([
          { $match: { ...openActive, inProductionAt: { $gte: staleCutoff, $lt: overdueCutoff } } },
          { $group: { _id: '$factoryId', n: { $sum: 1 } } },
          { $sort: { n: -1 } },
        ]),
        this.orderModel.aggregate<Row>([
          { $match: { ...openActive, inProductionAt: { $gte: staleCutoff, $lt: overdueCutoff } } },
          { $sort: { inProductionAt: 1 } },
          { $limit: 5 },
          { $project: { productionId: 1, userSku: 1, factoryId: 1, inProductionAt: 1, stage: workshopStageSwitchExpr() } },
        ]),
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(start, end) } }, customerGroup, { $sort: { n: -1 } }]),
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(cmpStart, cmpEnd) } }, { $group: { _id: { $ifNull: ['$userSku', ''] }, n: { $sum: 1 } } }]),
        this.orderModel.db.collection('customers').find({ deletedAt: { $exists: false } }, { projection: { userSku: 1, tier: 1 } }).toArray(),
        this.orderModel.aggregate<Row>([
          { $match: openActive },
          { $group: { _id: workshopStageSwitchExpr(), n: { $sum: 1 } } },
        ]),
        this.orderModel.aggregate<Row>([
          { $match: openActive },
          { $group: { _id: null, avgAge: { $avg: dayDiff(now, '$inProductionAt') } } },
        ]),
        this.orderModel
          .find(
            { ...base, inProductionAt: { $lt: end, $gte: new Date(histStart.getTime() - STALE_DAYS * DAY_MS) }, $or: [{ fulfillmentCompletedAt: { $exists: false } }, { fulfillmentCompletedAt: { $gte: histStart } }] },
            { inProductionAt: 1, fulfillmentCompletedAt: 1 },
          )
          .lean(),
        this.orderModel.aggregate<Row>([
          { $match: { ...base, designerCompletedAt: inRange(start, end), assignee: { $nin: [null, ''] } } },
          { $group: { _id: '$assignee', n: { $sum: 1 } } },
        ]),
        this.orderModel.aggregate<Row>([
          { $match: { ...base, designerStatus: { $in: [DesignerStatus.Assigned, DesignerStatus.InProgress, DesignerStatus.Rework] }, assignee: { $nin: [null, ''] } } },
          { $group: { _id: '$assignee', n: { $sum: 1 } } },
        ]),
        this.orderModel.aggregate<Row>([
          { $match: { ...base, inProductionAt: inRange(start, end), designerReworkCount: { $gt: 0 }, assignee: { $nin: [null, ''] } } },
          { $group: { _id: '$assignee', n: { $sum: '$designerReworkCount' } } },
        ]),
        this.orderModel.aggregate<Row>([
          { $match: { ...base, fulfillmentStages: { $exists: true } } },
          { $project: { st: { $objectToArray: '$fulfillmentStages' } } },
          { $unwind: '$st' },
          { $match: { 'st.v.completedAt': inRange(start, end), 'st.v.assignee': { $nin: [null, ''] } } },
          { $group: { _id: { stage: '$st.k', user: '$st.v.assignee' }, n: { $sum: 1 } } },
          { $sort: { n: -1 } },
        ]),
        this.orderModel.db.collection('factories').find({}, { projection: { name: 1, shortName: 1 } }).toArray(),
        this.orderModel.countDocuments({ ...base, fulfillmentCompletedAt: { $exists: false }, inProductionAt: { $exists: true, $ne: null, $lt: staleCutoff } }),
        // Đơn RA theo lịch từng xưởng (đóng hàng trong kỳ, bất kể vào SX khi nào) — cùng nghĩa với KPI "Đơn ra".
        this.orderModel.aggregate<Row>([{ $match: { ...base, fulfillmentCompletedAt: inRange(start, end) } }, { $group: { _id: '$factoryId', n: { $sum: 1 } } }]),
        // Lô SLA (khác cohort kỳ khi xem 1 ngày) — kỳ này / kỳ so sánh / theo xưởng.
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(slaStart, slaEnd) } }, cohortGroup]),
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(slaPrevStart, slaPrevEnd) } }, cohortGroup]),
        this.orderModel.aggregate<Row>([{ $match: { ...base, inProductionAt: inRange(slaStart, slaEnd) } }, factoryGroup]),
      ]);

    const facet = (daily[0] || {}) as Record<string, Row[]>;
    const factoryName = new Map(factoryDocs.map((f) => [String(f._id), { shortName: f.shortName as string | undefined, name: f.name as string | undefined }]));
    const c = (cur[0] || {});
    const p = (prev[0] || {});
    const sc = (slaCurRows[0] || {});
    const sp = (slaPrevRows[0] || {});
    const facSla = new Map(factorySlaRows.map((r) => [String(r._id), r]));

    // ── daily (kỳ trước + kỳ này) ──
    const inMap = new Map((facet.in || []).map((r) => [String(r._id), r]));
    const outMap = new Map((facet.out || []).map((r) => [String(r._id), num(r.n)]));
    const errMap = new Map((facet.err || []).map((r) => [String(r._id), num(r.n)]));
    const n2Map = new Map((facet.n2 || []).map((r) => [String(r._id), r]));
    const dailyRows: CeoOverview['production']['daily'] = [];
    const dailyN2: CeoOverview['sla']['dailyN2'] = [];
    const totalDays = Math.round((end.getTime() - prevStart.getTime()) / DAY_MS);
    for (let i = 0; i < totalDays; i++) {
      const dt = new Date(prevStart.getTime() + i * DAY_MS);
      const d = toVnDay(new Date(dt.getTime() + 12 * 3_600_000));
      const inRow = inMap.get(d);
      dailyRows.push({ day: d, in: num(inRow?.n), out: outMap.get(d) || 0, revenue: round(num(inRow?.revenue), 2), errors: errMap.get(d) || 0 });
      if (dt >= slaStart && dt < slaEnd) {
        const r = n2Map.get(d);
        dailyN2.push({ day: d, total: num(r?.mature), pct: pct(num(r?.matureN2), num(r?.mature)) });
      }
    }
    const sumOut = (s: Date, e: Date) => dailyRows.filter((r) => vnDayStart(r.day) >= s && vnDayStart(r.day) < e).reduce((a, r) => a + r.out, 0);
    const outCur = sumOut(start, end);
    const outPrev = sumOut(cmpStart, cmpEnd);
    // Tham chiếu nhịp cho kỳ 1 ngày: cùng thứ tuần trước (D−7) + trung bình D−7..D−1.
    const reference: CeoOverview['production']['reference'] = (() => {
      if (!isDay) return null;
      const before = dailyRows.filter((r) => r.day < from);
      const sw = dailyRows.find((r) => r.day === toVnDay(new Date(start.getTime() - 7 * DAY_MS + 12 * 3_600_000)));
      const avg = (k: 'in' | 'out' | 'revenue') => (before.length ? round(before.reduce((a, r) => a + r[k], 0) / before.length) : 0);
      return {
        sameWeekday: { day: sw?.day || from, in: num(sw?.in), out: num(sw?.out), revenue: round(num(sw?.revenue), 2) },
        avg7: { in: avg('in'), out: avg('out'), revenue: avg('revenue') },
      };
    })();

    // ── tồn theo ngày (30 ngày kết thúc ở `to`) ──
    const history: CeoOverview['capacity']['history'] = [];
    const docs = histDocs as Array<{ inProductionAt?: Date; fulfillmentCompletedAt?: Date }>;
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const dEnd = new Date(end.getTime() - i * DAY_MS);
      let n = 0;
      const staleAt = new Date(dEnd.getTime() - STALE_DAYS * DAY_MS);
      for (const o of docs) {
        if (o.inProductionAt && o.inProductionAt < dEnd && o.inProductionAt >= staleAt && (!o.fulfillmentCompletedAt || o.fulfillmentCompletedAt >= dEnd)) n++;
      }
      history.push({ day: toVnDay(new Date(dEnd.getTime() - 12 * 3_600_000)), backlog: n });
    }
    const openAt = (at: Date) => docs.filter((o) => o.inProductionAt && o.inProductionAt < at && o.inProductionAt >= new Date(at.getTime() - STALE_DAYS * DAY_MS) && (!o.fulfillmentCompletedAt || o.fulfillmentCompletedAt >= at)).length;
    const backlogNow = openAt(end);
    const prevBacklog = openAt(start);

    // ── xưởng ──
    const outFac = new Map(outByFactory.map((r) => [String(r._id), num(r.n)]));
    const byFactory: CeoOverview['production']['byFactory'] = byFactoryRows.map((r) => {
      const id = String(r._id);
      const outN = outFac.get(id) || 0;
      const outPerDay = round(outN / days);
      return {
        factoryId: id,
        shortName: factoryName.get(id)?.shortName,
        name: factoryName.get(id)?.name,
        in: num(r.n),
        out: outN,
        backlog: num(r.backlog),
        revenue: round(num(r.revenue), 2),
        errored: num(r.errored),
        n2Pct: pct(num(facSla.get(id)?.matureN2), num(facSla.get(id)?.mature)),
        outPerDay,
        daysToClear: outPerDay > 0 ? round(num(r.backlog) / outPerDay) : null,
      };
    });

    // ── khách ──
    const tierBySku = new Map<string, number | null>();
    for (const t of tierRows as Array<{ userSku?: string; tier?: number | null }>) {
      if (!t.userSku) continue;
      const cur0 = tierBySku.get(t.userSku);
      if (cur0 === undefined || (t.tier ?? -1) > (cur0 ?? -1)) tierBySku.set(t.userSku, t.tier ?? null);
    }
    const prevBySku = new Map(custPrev.map((r) => [String(r._id), num(r.n)]));
    const custRows = custCur.map((r) => ({ userSku: String(r._id), orders: num(r.n), prevOrders: prevBySku.get(String(r._id)) || 0, revenue: round(num(r.revenue), 2), tier: tierBySku.get(String(r._id)) ?? null, held: num(r.held), errored: num(r.errored) }));
    const totalCur = num(c.n);
    const top = custRows.slice(0, TOP_CUSTOMERS);
    const rising = custRows.filter((r) => r.prevOrders >= 3 && r.orders >= r.prevOrders * 1.5).sort((a, b) => b.orders - b.prevOrders - (a.orders - a.prevOrders)).slice(0, 5).map(({ userSku, orders, prevOrders }) => ({ userSku, orders, prevOrders }));
    const curSkus = new Set(custRows.map((r) => r.userSku));
    const dropping = [...prevBySku.entries()]
      .filter(([sku, n]) => n >= 5 && (custRows.find((r) => r.userSku === sku)?.orders || 0) <= n * 0.5)
      .map(([sku, n]) => ({ userSku: sku, orders: custRows.find((r) => r.userSku === sku)?.orders || 0, prevOrders: n }))
      .sort((a, b) => b.prevOrders - b.orders - (a.prevOrders - a.orders))
      .slice(0, 5);
    const newCount = custRows.filter((r) => r.prevOrders === 0).length;

    // ── nhân sự ──
    const userIds = new Set<string>();
    for (const r of [...desDone, ...desBacklog, ...desRework]) userIds.add(String(r._id));
    for (const r of workerRows) userIds.add(String((r._id as Row).user));
    const users = userIds.size ? await this.userModel.find({ _id: { $in: [...userIds] } }, { fullName: 1 }).lean() : [];
    const nameOf = new Map(users.map((u) => [String(u._id), (u as { fullName?: string }).fullName || String(u._id).slice(-4)]));
    const desMap = new Map<string, { done: number; backlog: number; rework: number }>();
    const des = (id: string) => desMap.get(id) || (desMap.set(id, { done: 0, backlog: 0, rework: 0 }), desMap.get(id)!);
    for (const r of desDone) des(String(r._id)).done = num(r.n);
    for (const r of desBacklog) des(String(r._id)).backlog = num(r.n);
    for (const r of desRework) des(String(r._id)).rework = num(r.n);
    const designers = [...desMap.entries()].map(([userId, v]) => ({ userId, name: nameOf.get(userId) || userId.slice(-4), ...v })).sort((a, b) => b.done - a.done || b.backlog - a.backlog);
    const workers = workerRows.slice(0, 40).map((r) => {
      const id = r._id as Row;
      return { userId: String(id.user), name: nameOf.get(String(id.user)) || String(id.user).slice(-4), stage: String(id.stage), done: num(r.n) };
    });

    // ── SLA ──
    const mature = num(sc.mature);
    const slaTotal = num(sc.n);
    const within = [
      { n: 0, count: num(sc.n0), pct: pct(num(sc.n0), slaTotal) },
      { n: 1, count: num(sc.n1), pct: pct(num(sc.n1), slaTotal) },
      { n: 2, count: num(sc.matureN2), pct: pct(num(sc.matureN2), mature) },
    ];
    const prevN2Pct = pct(num(sp.matureN2), num(sp.mature));
    const overdueTotal = overdueRows.reduce((a, r) => a + num(r.n), 0);

    const overview: CeoOverview = {
      period: {
        from,
        to,
        days,
        prevFrom: toVnDay(new Date(cmpStart.getTime() + 12 * 3_600_000)),
        prevTo: toVnDay(new Date(cmpEnd.getTime() - 12 * 3_600_000)),
        compareMode: 'previous',
        weekday,
        generatedAt: now.toISOString(),
        cached: false,
      },
      production: { in: totalCur, out: outCur, prevIn: num(p.n), prevOut: outPrev, daily: dailyRows, reference, byFactory },
      revenue: {
        total: round(num(c.revenue), 2),
        prev: round(num(p.revenue), 2),
        ship: round(num(c.ship), 2),
        avgPerOrder: totalCur ? round(num(c.revenue) / totalCur, 2) : 0,
        prevAvgPerOrder: num(p.n) ? round(num(p.revenue) / num(p.n), 2) : 0,
        currency: 'USD',
        basis: 'baseCost',
      },
      sla: {
        targets: SLA_TARGETS,
        cohortFrom: toVnDay(new Date(slaStart.getTime() + 12 * 3_600_000)),
        cohortTo: toVnDay(new Date(slaEnd.getTime() - 12 * 3_600_000)),
        mature,
        within,
        prevN2Pct,
        dailyN2,
        overdue: {
          total: overdueTotal,
          byFactory: overdueRows.map((r) => ({ factoryId: String(r._id), shortName: factoryName.get(String(r._id))?.shortName, count: num(r.n) })),
          sample: overdueSample.map((r) => ({
            productionId: String(r.productionId),
            userSku: r.userSku ? String(r.userSku) : undefined,
            factory: factoryName.get(String(r.factoryId))?.shortName,
            stage: String(r.stage),
            ageDays: r.inProductionAt ? Math.floor((now.getTime() - new Date(r.inProductionAt as Date).getTime()) / DAY_MS) : 0,
          })),
        },
      },
      quality: {
        errored: num(c.errored),
        ratePct: pct(num(c.errored), totalCur),
        prevRatePct: pct(num(p.errored), num(p.n)),
        bySource: bySource.map((r) => ({ source: String(r._id), count: num(r.n) })),
        topTypes: topTypes.map((r) => ({ type: String(r._id), count: num(r.n), total: num(typeTotals.find((t) => String(t._id) === String(r._id))?.n) })),
      },
      customers: {
        active: custRows.length,
        prevActive: prevBySku.size,
        newCount,
        top10SharePct: pct(top.reduce((a, r) => a + r.orders, 0), totalCur),
        top,
        rising,
        dropping,
      },
      capacity: {
        backlog: backlogNow,
        prevBacklog,
        avgAgeDays: openAge[0] ? round(num(openAge[0].avgAge)) : null,
        staleOpen: num(staleOpen),
        staleDays: STALE_DAYS,
        byStage: openByStage.map((r) => ({ stage: String(r._id), count: num(r.n) })),
        history,
      },
      people: { designers, workers },
      findings: [],
    };
    void curSkus;
    overview.findings = this.buildFindings(overview);
    this.cache.set(key, { at: Date.now(), data: overview });
    return overview;
  }

  /**
   * Kết luận + việc cần làm sinh THEO LUẬT từ số đã tính (không gọi mô hình): mỗi finding
   * có `code` (FE dịch thành câu), `params`, `severity`, `action` (mã việc). Thứ tự:
   * critical → warning → good → info. Luật ở đây là luật của dashboard, Agent có thể
   * đọc cùng endpoint để nói cùng kết luận.
   */
  private buildFindings(o: CeoOverview): CeoFinding[] {
    const f: CeoFinding[] = [];
    const delta = (cur: number, prev: number): number | null => (prev > 0 ? round(((cur - prev) / prev) * 100) : null);
    const days = o.period.days;
    const longEnough = days >= 7; // luật khách hàng/giá trị/tập trung chỉ có nghĩa với kỳ ≥ 7 ngày
    if (days === 1 && (o.period.weekday === 0 || o.period.weekday === 6)) {
      f.push({ code: 'weekend_day', severity: 'info', params: { day: o.period.from, weekday: o.period.weekday } });
    }
    const n2 = o.sla.within[2];
    const n2Target = o.sla.targets.find((t) => t.n === 2)?.pct ?? 100;
    if (o.sla.mature === 0) {
      f.push({ code: 'sla_pending', severity: 'info', params: { cohort: o.sla.cohortFrom } });
    }
    if (n2.pct !== null && o.sla.mature >= 10 && n2.pct < n2Target) {
      const worst = [...o.production.byFactory].filter((x) => x.n2Pct !== null).sort((a, b) => (a.n2Pct ?? 0) - (b.n2Pct ?? 0))[0];
      f.push({ code: 'sla_n2_below', severity: n2.pct < n2Target - 10 ? 'critical' : 'warning', params: { pct: n2.pct, target: n2Target, gap: round(n2Target - n2.pct), factory: worst?.shortName || '', factoryPct: worst?.n2Pct ?? 0 }, action: 'act_unblock_stage' });
    } else if (n2.pct !== null && o.sla.mature >= 10) {
      f.push({ code: 'sla_n2_ok', severity: 'good', params: { pct: n2.pct }, action: undefined });
    }
    if (o.sla.overdue.total > 0) {
      const top = o.sla.overdue.byFactory[0];
      f.push({ code: 'overdue_orders', severity: o.sla.overdue.total >= 10 ? 'critical' : 'warning', params: { n: o.sla.overdue.total, factory: top?.shortName || '', factoryN: top?.count || 0, oldest: o.sla.overdue.sample[0]?.ageDays || 0 }, action: 'act_clear_overdue' });
    }
    const outDelta = delta(o.production.out, o.production.prevOut);
    const weekend = days === 1 && (o.period.weekday === 0 || o.period.weekday === 6);
    if (days === 1 && o.production.reference) {
      // Ngày: chỉ kêu khi xấu/tốt ở CẢ hai phía — so hôm qua VÀ so trung bình 7 ngày (≥20%), không phải cuối tuần.
      const a7 = o.production.reference.avg7.out;
      const vsAvg = a7 > 0 ? round(((o.production.out - a7) / a7) * 100) : null;
      if (!weekend && outDelta !== null && vsAvg !== null && outDelta < 0 && vsAvg <= -20)
        f.push({ code: 'output_down_day', severity: 'warning', params: { out: o.production.out, prev: o.production.prevOut, avg7: a7, pctAvg: Math.abs(vsAvg) }, action: 'act_check_capacity' });
      else if (outDelta !== null && vsAvg !== null && outDelta > 0 && vsAvg >= 20)
        f.push({ code: 'output_up_day', severity: 'good', params: { out: o.production.out, prev: o.production.prevOut, avg7: a7, pctAvg: vsAvg } });
    } else if (outDelta !== null && Math.abs(outDelta) >= 10) {
      f.push({ code: outDelta > 0 ? 'output_up' : 'output_down', severity: outDelta > 0 ? 'good' : 'warning', params: { pct: Math.abs(outDelta), out: o.production.out, prev: o.production.prevOut }, action: outDelta < 0 ? 'act_check_capacity' : undefined });
    }
    const inOutGap = o.production.in - o.production.out;
    if (longEnough && o.production.in >= 20 && inOutGap > o.production.in * 0.25) f.push({ code: 'in_exceeds_out', severity: 'warning', params: { in: o.production.in, out: o.production.out, gap: inOutGap }, action: 'act_check_capacity' });
    const bDelta = delta(o.capacity.backlog, o.capacity.prevBacklog);
    if (bDelta !== null && bDelta >= 15) f.push({ code: 'backlog_rising', severity: 'warning', params: { pct: bDelta, backlog: o.capacity.backlog, prev: o.capacity.prevBacklog }, action: 'act_check_capacity' });
    const slow = o.production.byFactory.filter((x) => x.daysToClear !== null && x.daysToClear >= 3);
    if (slow.length) f.push({ code: 'factory_slow_clear', severity: 'warning', params: { factory: slow.map((x) => `${x.shortName || x.name} ${x.daysToClear}d`).join(', ') }, action: 'act_rebalance_factory' });
    if (o.quality.ratePct !== null && o.production.in >= 20) {
      const src = o.quality.bySource[0];
      const srcShare = src && o.quality.errored ? round((src.count / o.quality.errored) * 100) : 0;
      const rDelta = o.quality.prevRatePct !== null ? round(o.quality.ratePct - o.quality.prevRatePct) : null;
      if (o.quality.ratePct >= 5 || (rDelta !== null && rDelta >= 2)) f.push({ code: 'error_rate_high', severity: o.quality.ratePct >= 10 ? 'critical' : 'warning', params: { pct: o.quality.ratePct, delta: rDelta ?? 0, source: src?.source || '', share: srcShare, type: o.quality.topTypes[0]?.type || '' }, action: src?.source === 'designer' ? 'act_review_design' : 'act_review_factory' });
      else if (rDelta !== null && rDelta <= -1) f.push({ code: 'error_rate_down', severity: 'good', params: { pct: o.quality.ratePct, delta: Math.abs(rDelta) } });
    }
    if (longEnough && o.customers.dropping.length) f.push({ code: 'customers_dropping', severity: 'warning', params: { n: o.customers.dropping.length, list: o.customers.dropping.slice(0, 3).map((x) => `${x.userSku} ${x.prevOrders}→${x.orders}`).join(', ') }, action: 'act_contact_customers' });
    if (longEnough && o.customers.rising.length) f.push({ code: 'customers_rising', severity: 'good', params: { n: o.customers.rising.length, list: o.customers.rising.slice(0, 3).map((x) => `${x.userSku} ${x.prevOrders}→${x.orders}`).join(', ') } });
    const vipIssue = o.customers.top.filter((x) => (x.tier ?? 0) >= 3 && x.held + x.errored > 0);
    if (vipIssue.length) f.push({ code: 'vip_issues', severity: 'warning', params: { list: vipIssue.slice(0, 3).map((x) => `${x.userSku} (${x.held} giữ/${x.errored} lỗi)`).join(', ') }, action: 'act_vip_followup' });
    if (longEnough && o.customers.top10SharePct !== null && o.customers.top10SharePct >= 70 && o.customers.active >= 15) f.push({ code: 'customer_concentration', severity: 'info', params: { pct: o.customers.top10SharePct } });
    const overloaded = o.people.designers.filter((d) => d.backlog >= 30);
    if (overloaded.length) f.push({ code: 'designer_overload', severity: 'warning', params: { list: overloaded.slice(0, 3).map((d) => `${d.name} ${d.backlog}`).join(', ') }, action: 'act_rebalance_design' });
    const revDelta = delta(o.revenue.total, o.revenue.prev);
    if (longEnough && revDelta !== null && Math.abs(revDelta) >= 10) f.push({ code: revDelta > 0 ? 'revenue_up' : 'revenue_down', severity: revDelta > 0 ? 'good' : 'warning', params: { pct: Math.abs(revDelta), total: o.revenue.total, prev: o.revenue.prev } });
    const order: Record<CeoFinding['severity'], number> = { critical: 0, warning: 1, good: 2, info: 3 };
    return f.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 8);
  }
}
