import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Connection, Model } from 'mongoose';
import type { CeoOverview, CustomerReport, CustomerReportIssue } from 'shared';
import { CUSTOMER_REPORT_RULES } from 'shared';

import { laTienTrinhChayCron } from '@/utils/cron-guard';
import { khoangThang, laThangTron } from '@/utils/report-period';

import { CeoDashboardService } from '../ceo-dashboard/ceo-dashboard.service';
import { CeoReportService } from '../ceo-dashboard/ceo-report.service';
import { CustomerReportDocument, CustomerReportEntity } from './customer-report.entity';
import { dungDong, khachTang, khachTut, phanTramDoi, soNgayTonDong, vietTomTat } from './customer-report.logic';

const TZ = 'Asia/Ho_Chi_Minh';
/** Cửa sổ trượt 7 ngày, kết thúc ở HÔM QUA — hôm nay chưa đủ ngày để so. */
const WINDOW_DAYS = 7;

/** `RPT-1` — bù báo cáo kỳ tháng từ mốc này. */
const BU_TU_NAM = 2026;
const BU_TU_THANG = 1;
const BU_THANG_KEY = 'RPT-1:monthly_backfill_v1';
/** Mỗi kỳ CEO gọi mô hình tới 150 giây; tám kỳ là gần nửa tiếng. */
const BU_STALE_MS = 60 * 60 * 1000;

/** `yyyy-mm-dd` theo giờ VN. */
function vnDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Báo cáo KHÁCH HÀNG cho agent (`documents/AgentGuide/CustomerReport.md`).
 *
 * Nguồn số là `CeoDashboardService.getOverview()`, KHÔNG gộp lại từ
 * `customer_orders`. Đo 11/09/2026 cùng kỳ 04→10/09: gộp từ staging ra 81
 * khách / 5.373 đơn, CEO Dashboard ra 80 khách / 5.337 đơn — vì CEO loại đơn
 * hủy, đơn chưa map xưởng, đơn xưởng US. Hai báo cáo cùng gửi Chủ tịch một
 * buổi sáng mà lệch nhau thì không ai giải thích được.
 *
 * Phần chữ viết bằng LUẬT, không gọi mô hình: báo cáo chạy mỗi sáng và phải ra
 * cùng một câu cho cùng bộ số, để hôm nay đối chiếu được với hôm qua.
 */
@Injectable()
export class CustomerReportService implements OnModuleInit {
  private readonly logger = new Logger(CustomerReportService.name);
  private readonly dangChay = new Set<string>();

  constructor(
    @InjectModel(CustomerReportEntity.name) private readonly reportModel: Model<CustomerReportDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly dashboard: CeoDashboardService,
    private readonly ceoReports: CeoReportService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    // KHÔNG await: sinh 8 kỳ có thể mất ~20 phút (mỗi kỳ CEO gọi mô hình 30–150s).
    // Chặn boot vì một việc bù dữ liệu là đổi một phiền toái lấy một sự cố.
    void this.buThangThieu();
  }

  isGenerating(from: string, to: string): boolean {
    return this.dangChay.has(`${from}_${to}`);
  }

  async getLatest(from: string, to: string): Promise<CustomerReport | null> {
    const doc = await this.reportModel.findOne({ periodKey: `${from}_${to}` }).sort({ generatedAt: -1 }).lean();

    return doc ? (this.toDto(doc as unknown as Record<string, unknown>)) : null;
  }

  /** Kỳ mặc định của cron: 7 ngày kết thúc ở hôm qua (giờ VN). */
  kyMacDinh(): { from: string; to: string } {
    const homQua = new Date(Date.now() - 864e5);

    return { from: vnDay(new Date(homQua.getTime() - (WINDOW_DAYS - 1) * 864e5)), to: vnDay(homQua) };
  }

  @Cron('15 7 * * *', { name: 'customer-report-daily', timeZone: TZ })
  async cronDaily(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;
    const { from, to } = this.kyMacDinh();
    try {
      await this.generate(from, to, 'cron');
    } catch (e) {
      this.logger.error(`[customer-report] cron ${from}_${to} thất bại: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Kỳ THÁNG, chạy sáng mùng 1 cho tháng vừa khép lại.
   *
   * Sau cron ngày 15 phút (07:15 → 07:25) để hai lượt không giành nhau: cả hai
   * đều gọi `CeoDashboardService.getOverview()`, vốn có cache 5 phút theo
   * (from,to) nhưng là hai kỳ khác nhau nên không dùng chung được.
   */
  @Cron('25 7 1 * *', { name: 'customer-report-monthly', timeZone: TZ })
  async cronMonthly(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;
    // Hôm nay là mùng 1, nên "hôm qua" luôn là ngày cuối tháng trước.
    const cuoiThangTruoc = vnDay(new Date(Date.now() - 864e5));
    const from = `${cuoiThangTruoc.slice(0, 8)}01`;
    try {
      await this.generate(from, cuoiThangTruoc, 'cron');
    } catch (e) {
      this.logger.error(`[customer-report] cron tháng ${from}_${cuoiThangTruoc} thất bại: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * `RPT-1` — bù báo cáo kỳ THÁNG cho các tháng đã trôi qua (CEO + khách hàng).
   *
   * Vì sao cần: cron tháng chỉ chạy sáng mùng 1 và chỉ cho tháng vừa khép lại,
   * nên mọi tháng trước ngày bật tính năng sẽ KHÔNG BAO GIỜ có báo cáo. Agent
   * cần bảng T1→T8/2026, mà để agent tự gộp `customer_orders` thì nó phải tự
   * dựng lại bộ lọc của CEO Dashboard (loại đơn hủy, đơn chưa gán xưởng, đơn
   * xưởng US) — sai một mảnh là số sai gửi thẳng ra ngoài.
   *
   * Hoàn thành xác định bằng DỮ LIỆU, không bằng cờ: cờ chỉ chống hai tiến
   * trình chạy đè nhau. Tháng nào đã có báo cáo thì bỏ qua, nên lần sinh hỏng
   * giữa chừng sẽ được lần khởi động sau làm nốt thay vì mất luôn.
   */
  private async buThangThieu(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — cùng lý do với cron, xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;

    const homNay = vnDay(new Date());
    const [namNay, thangNay] = homNay.split('-').map(Number);
    const thangs: Array<{ from: string; to: string }> = [];
    // Từ 01/2026 tới tháng LIỀN TRƯỚC tháng hiện tại: tháng đang chạy chưa khép
    // lại nên báo cáo của nó sẽ sai ngay hôm sau.
    for (let n = BU_TU_NAM, t = BU_TU_THANG; n < namNay || (n === namNay && t < thangNay); t === 12 ? ((n += 1), (t = 1)) : (t += 1)) {
      thangs.push(khoangThang(n, t));
    }
    if (thangs.length === 0) return;

    const bo: Array<{ ten: string; col: string; sinh: (f: string, t: string) => Promise<unknown> }> = [
      { ten: 'ceo', col: 'ceo_reports', sinh: (f, t) => this.ceoReports.generate(f, t, 'cron') },
      { ten: 'customer', col: 'customer_reports', sinh: (f, t) => this.generate(f, t, 'cron') },
    ];

    // Tháng KHÔNG có đơn nào thì KHÔNG sinh báo cáo.
    //
    // OnosFactory mới chạy thật từ 06/2026; trước đó đơn nằm ở hệ cũ OnosPod.
    // Sinh báo cáo cho tháng 1–5 ra một bản toàn số 0, và một bảng T1→T8 với
    // năm dòng 0 đầu trông y hệt một cú sụp sản lượng. Không có báo cáo là
    // trung thực ("kỳ này hệ thống chưa có dữ liệu"); báo cáo rỗng thì không.
    const coDon = new Map<string, boolean>();
    for (const { from, to } of thangs) {
      const n = await this.connection.collection('orders').countDocuments(
        { inProductionAt: { $gte: new Date(`${from}T00:00:00+07:00`), $lt: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 864e5) } },
        { limit: 1 },
      );
      coDon.set(`${from}_${to}`, n > 0);
    }

    const thieu: Array<{ b: (typeof bo)[number]; from: string; to: string }> = [];
    for (const b of bo) {
      for (const { from, to } of thangs) {
        if (!coDon.get(`${from}_${to}`)) continue;
        const co = await this.connection.collection(b.col).findOne({ periodKey: `${from}_${to}` }, { projection: { _id: 1 } });
        if (!co) thieu.push({ b, from, to });
      }
    }

    const bo0 = [...coDon.entries()].filter(([, v]) => !v).map(([k]) => k.slice(0, 7));
    if (bo0.length > 0) this.logger.log(`[bu-thang] bỏ qua ${bo0.length} tháng chưa có đơn nào: ${bo0.join(', ')}`);
    if (thieu.length === 0) return;

    const db = this.connection.db;
    const now = new Date();
    const chiem = await db.collection('system_configs').updateOne(
      { key: BU_THANG_KEY },
      {
        $setOnInsert: {
          key: BU_THANG_KEY,
          value: { status: 'running', startedAt: now.toISOString() },
          description: 'RPT-1: bù báo cáo kỳ tháng (ceo_reports + customer_reports)',
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    if (chiem.upsertedCount === 0) {
      // Nhận lại lần chạy đã chết. Ngưỡng rộng vì mỗi kỳ CEO gọi mô hình tới
      // 150 giây, tám kỳ là gần nửa tiếng — đặt ngắn thì hai tiến trình cùng sinh.
      const cuHon = new Date(now.getTime() - BU_STALE_MS).toISOString();
      const nhanLai = await db.collection('system_configs').updateOne(
        { key: BU_THANG_KEY, 'value.startedAt': { $lt: cuHon } },
        { $set: { value: { status: 'running', startedAt: now.toISOString() }, updatedAt: now } },
      );
      if (nhanLai.modifiedCount === 0) return;
      this.logger.warn('[bu-thang] nhận lại lần chạy trước đã chết');
    }

    this.logger.log(`[bu-thang] cần sinh ${thieu.length} báo cáo kỳ tháng`);
    let xong = 0;
    for (const { b, from, to } of thieu) {
      try {
        // Tuần tự: các lượt CEO cùng gọi Agent SDK, chạy song song thì giành nhau.
        await b.sinh(from, to);
        xong++;
        this.logger.log(`[bu-thang] ${b.col} ${from}_${to} xong (${xong}/${thieu.length})`);
      } catch (e) {
        this.logger.error(`[bu-thang] ${b.col} ${from}_${to} thất bại: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await db.collection('system_configs').updateOne(
      { key: BU_THANG_KEY },
      { $set: { value: { status: xong === thieu.length ? 'done' : 'partial', xong, tong: thieu.length, finishedAt: new Date().toISOString() }, updatedAt: new Date() } },
    );
    this.logger.log(`[bu-thang] hoàn tất ${xong}/${thieu.length}`);
  }

  async generate(from: string, to: string, trigger: 'cron' | 'manual'): Promise<CustomerReport> {
    const key = `${from}_${to}`;
    this.dangChay.add(key);
    try {
      const overview = await this.dashboard.getOverview(from, to);
      const [ten, issues] = await Promise.all([this.tenTheoSku(overview), this.vanDeTuZalo()]);

      const tho = overview.customers.top.map((c) => ({ userSku: c.userSku, orders: c.orders, prevOrders: c.prevOrders, tier: c.tier }));
      // `rising`/`dropping` của CEO là top theo mức đổi; lọc lại bằng ngưỡng của
      // báo cáo này để danh sách có ý nghĩa thương mại, không chỉ đổi nhiều %.
      const ungVien = [
        ...tho,
        ...overview.customers.rising.map((r) => ({ userSku: r.userSku, orders: r.orders, prevOrders: r.prevOrders })),
        ...overview.customers.dropping.map((r) => ({ userSku: r.userSku, orders: r.orders, prevOrders: r.prevOrders })),
      ];
      const loc = [...new Map(ungVien.map((r) => [r.userSku, r])).values()];
      const tut = khachTut(loc);
      const tang = khachTang(loc);
      const moi = loc.filter((r) => !r.prevOrders && r.orders > 0);

      const doc = await this.reportModel.create({
        periodKey: key,
        from,
        to,
        // Tháng xét TRƯỚC: cron ngày sinh cửa sổ trượt 7 ngày nên nhánh `week`
        // rất rộng, và một tháng 31 ngày không bao giờ rơi vào đó — nhưng đặt
        // sau vẫn an toàn hơn là dựa vào thứ tự ngầm.
        kind: laThangTron(from, to) ? 'month' : overview.period.days === WINDOW_DAYS ? 'week' : 'custom',
        summary: vietTomTat(overview, tut, tang),
        metrics: {
          activeCustomers: overview.customers.active,
          activeCustomersPrev: overview.customers.prevActive,
          totalOrders: overview.production.in,
          totalOrdersPrev: overview.production.prevIn,
          changePct: phanTramDoi(overview.production.in, overview.production.prevIn),
          newCustomerCount: overview.customers.newCount,
          churnRiskCount: tut.length,
        },
        topCustomers: tho.slice(0, 10).map((r) => dungDong(r, ten.get(r.userSku))),
        surging: tang.slice(0, 10).map((r) => dungDong(r, ten.get(r.userSku))),
        declining: tut.slice(0, 10).map((r) => dungDong(r, ten.get(r.userSku))),
        newCustomers: moi.slice(0, 10).map((r) => dungDong(r, ten.get(r.userSku))),
        customerIssues: issues,
        conclusions: this.ketLuan(overview, tut, tang, issues),
        actionItems: this.viecCanLam(tut, issues),
        findings: [
          ...tut.map((r) => ({
            code: 'churn_risk',
            severity: 'warning' as const,
            params: { userSku: r.userSku, from: r.prevOrders, to: r.orders },
            action: 'Hỏi lại khách vì sao giảm đơn',
          })),
          ...issues
            .filter((i) => i.severity === 'gap')
            .map((i) => ({
              code: 'customer_issue_urgent',
              severity: 'critical' as const,
              params: { userSku: i.userSku, issue: i.issue, pendingDays: i.pendingDays },
              action: 'Xử lý dứt điểm vướng mắc đang treo',
            })),
        ],
        generatedAt: new Date(),
        trigger,
      });

      return this.toDto(doc.toObject() as Record<string, unknown>);
    } finally {
      this.dangChay.delete(key);
    }
  }

  /**
   * Tên người liên hệ theo mã khách — lấy từ danh tính Zalo ĐÃ DUYỆT
   * (`zalo_identities.customerId`, nối qua nhóm). Chưa nối thì để trống chứ
   * không lấy tạm từ tên nhóm: tên nhóm là chuỗi `OnosPod/ 2025/ MÃ/ …`, không
   * phải tên người.
   */
  private async tenTheoSku(o: CeoOverview): Promise<Map<string, string>> {
    const skus = [...new Set(o.customers.top.map((c) => c.userSku))];
    if (skus.length === 0) return new Map();

    const khach = await this.connection.collection('customers').find({ userSku: { $in: skus } }, { projection: { userSku: 1 } }).toArray();
    const skuTheoId = new Map(khach.map((c) => [String(c._id), String(c.userSku)]));
    if (skuTheoId.size === 0) return new Map();

    const nguoi = await this.connection
      .collection('zalo_identities')
      .find({ customerId: { $in: [...skuTheoId.keys()] }, kind: 'customer' }, { projection: { customerId: 1, displayName: 1, messageCount: 1 } })
      .sort({ messageCount: -1 })
      .toArray();

    const out = new Map<string, string>();
    for (const n of nguoi) {
      const sku = skuTheoId.get(String(n.customerId));
      // Một khách có thể có vài người; lấy người nhắn nhiều nhất làm đại diện.
      if (sku && !out.has(sku) && n.displayName) out.set(sku, String(n.displayName));
    }

    return out;
  }

  /**
   * Vướng mắc đang treo, lấy từ bản tóm tắt nhóm Zalo.
   *
   * Đây là ẢNH CHỤP HIỆN TẠI, không phải "phát sinh trong kỳ": mỗi nhóm chỉ giữ
   * MỘT bản tóm tắt mới nhất, không có chuỗi theo ngày. Báo cáo phải nói đúng
   * như vậy, đừng để người đọc tưởng là việc mới nảy trong 7 ngày.
   */
  private async vanDeTuZalo(): Promise<CustomerReportIssue[]> {
    // KHÔNG lọc theo top 10: một khách cỡ vừa đang có việc GẤP treo 12 ngày là
    // đúng thứ Chủ tịch cần nghe, mà lọc theo top thì họ biến mất khỏi báo cáo.
    const rows = await this.connection
      .collection('zalo_group_summaries')
      .find({ mucDo: { $in: ['gap', 'can-chu-y'] } }, { projection: { userSku: 1, mucDo: 1, tieuDe: 1, checklist: 1 } })
      .toArray();

    const now = new Date();

    return rows
      .filter((r) => r.userSku)
      .map((r) => ({
        userSku: String(r.userSku),
        severity: String(r.mucDo),
        issue: String(r.tieuDe ?? ''),
        pendingDays: soNgayTonDong(r.checklist as Array<{ xong?: boolean; taoLuc?: string }>, now),
      }))
      // Gấp lên trước, rồi tới việc treo lâu nhất.
      .sort((a, b) => (a.severity === b.severity ? (b.pendingDays ?? 0) - (a.pendingDays ?? 0) : a.severity === 'gap' ? -1 : 1))
      .slice(0, 15);
  }

  private ketLuan(o: CeoOverview, tut: ReturnType<typeof khachTut>, tang: ReturnType<typeof khachTang>, issues: CustomerReportIssue[]): string[] {
    const out: string[] = [];
    const d = phanTramDoi(o.production.in, o.production.prevIn);
    if (d != null) out.push(`Đơn vào ${d >= 0 ? 'tăng' : 'giảm'} ${Math.abs(d)}% so kỳ trước (${o.production.prevIn} → ${o.production.in}).`);
    if (o.customers.top10SharePct != null) out.push(`10 khách lớn nhất chiếm ${o.customers.top10SharePct}% đơn — càng cao càng phụ thuộc ít khách.`);
    if (tut.length > 0) {
      out.push(
        `${tut.length} khách giảm ≥ ${CUSTOMER_REPORT_RULES.decliningDropPct}% từ nền ≥ ${CUSTOMER_REPORT_RULES.decliningMinPrev} đơn: ` +
          tut.slice(0, 5).map((r) => `${r.userSku} (${r.prevOrders}→${r.orders})`).join(', ') + '.',
      );
    }
    if (tang.length > 0) out.push(`${tang.length} khách tăng mạnh: ` + tang.slice(0, 5).map((r) => `${r.userSku} (${r.prevOrders}→${r.orders})`).join(', ') + '.');
    const gap = issues.filter((i) => i.severity === 'gap');
    if (gap.length > 0) out.push(`${gap.length} khách đang có vướng mắc GẤP trong nhóm Zalo (ảnh chụp hiện tại, không riêng kỳ này).`);

    return out;
  }

  private viecCanLam(tut: ReturnType<typeof khachTut>, issues: CustomerReportIssue[]): string[] {
    const out: string[] = [];
    for (const r of tut.slice(0, 3)) out.push(`Sale phụ trách ${r.userSku}: hỏi lại vì sao đơn giảm từ ${r.prevOrders} xuống ${r.orders}, báo lại trong hôm nay.`);
    for (const i of issues.filter((x) => x.severity === 'gap').slice(0, 3)) {
      out.push(`Xử lý dứt điểm cho ${i.userSku}: ${i.issue}${i.pendingDays ? ` (đã treo ${i.pendingDays} ngày)` : ''}.`);
    }

    return out;
  }

  private toDto(d: Record<string, unknown>): CustomerReport {
    return {
      ...(d as unknown as CustomerReport),
      _id: String(d._id),
      generatedAt: new Date(d.generatedAt as Date).toISOString(),
    };
  }
}
