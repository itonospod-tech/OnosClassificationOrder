import { query } from '@anthropic-ai/claude-agent-sdk';
import { ConflictException, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import type { CeoOverview, CeoReport, CeoReportKind } from 'shared';

import { laTienTrinhChayCron } from '@/utils/cron-guard';
import { laThangTron } from '@/utils/report-period';

import { tachJson } from '../zalo-group/zalo-summary.logic';
import { buildCeoChartSvg } from './ceo-chart';
import { CeoDashboardService } from './ceo-dashboard.service';
import { CeoReportDocument, CeoReportEntity } from './ceo-report.entity';

const TZ = 'Asia/Ho_Chi_Minh';
const MODEL = process.env.CEO_REPORT_MODEL || process.env.ZALO_SUMMARY_MODEL || 'opus';
const HAN_GIAY = Number(process.env.CEO_REPORT_TIMEOUT_SEC || process.env.ZALO_SUMMARY_TIMEOUT_SEC || 150);
/** Xem ghi chú ở `zalo-summary.service.ts`: PM2 không có ~/.local/bin trong PATH. */
const CLAUDE_CLI = process.env.CLAUDE_CLI_PATH;
/** Tắt cron nội bộ bằng `CEO_REPORT_CRON_ENABLED=false` (mặc định BẬT, trừ NODE_ENV=test). */
const CRON_ENABLED = process.env.CEO_REPORT_CRON_ENABLED !== 'false' && process.env.NODE_ENV !== 'test';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tomTat', 'ketLuan', 'viecCanLam', 'ruiRo', 'diemSang'],
  properties: {
    tomTat: { type: 'string' },
    ketLuan: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    viecCanLam: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    ruiRo: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    diemSang: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
} as const;

const LOI_NHAC = `Bạn là trợ lý điều hành viết báo cáo cho CEO của một xưởng in ấn/may POD tại Việt Nam, khách chủ yếu ở Mỹ.
Dựa DUY NHẤT vào khối JSON số liệu bên dưới (đã tổng hợp từ hệ thống sản xuất). KHÔNG bịa số, KHÔNG suy đoán ngoài dữ liệu; số nào không có thì không nhắc.
Viết TIẾNG VIỆT, giọng thẳng, ngắn, cho người bận: mỗi câu có số cụ thể và so với kỳ trước (prevIn/prevOut/prevN2Pct/prevRatePct/prevBacklog/revenue.prev).
Ý nghĩa dữ liệu: production.in = đơn vào sản xuất; production.out = đơn đã đóng hàng (ra xưởng); revenue = giá trị đơn theo baseCost (USD) — gọi là "giá trị đơn", KHÔNG gọi là doanh thu;
sla.within[n=2].pct = % đơn đủ tuổi đã ra trong 2 ngày (chỉ tiêu 100%), n=0 chỉ tiêu 30%, n=1 chỉ tiêu 80%; sla.overdue = đơn quá hạn từ 3 ngày còn mở (đã loại đơn treo cũ);
quality.ratePct = % đơn có lỗi xưởng, bySource nguồn lỗi (designer = do thiết kế, factory = do xưởng, tool-check = do soát tool);
capacity.backlog = tồn trong xưởng (đơn chưa đóng, vào SX trong 45 ngày), staleOpen = đơn treo quá 45 ngày (nợ dữ liệu, không phải tồn thật), byStage = tồn theo chặng (tool-check → designer → print → press → qc-post-press → sew-in → sew-out → pack);
customers.top = khách theo đơn (tier = hạng VIP 0..5), rising/dropping = khách tăng/giảm mạnh so kỳ trước; people.designers = designer xong/tồn/làm lại, workers = công nhân theo công đoạn;
findings = kết luận máy đã tính theo luật (code + params) — hãy diễn giải chúng thành câu người đọc hiểu, có thể bổ sung nhận xét từ số khác.
QUY TẮC THEO KỲ (period.days): kỳ 1 ngày → kỳ so sánh chính là HÔM QUA (prevIn/prevOut = tiến độ), kèm tham chiếu NHỊP ở production.reference: sameWeekday (cùng thứ tuần trước) và avg7 (trung bình 7 ngày liền trước) — chỉ gọi là "sụt/tăng năng lực" khi lệch cùng chiều so với CẢ hôm qua lẫn avg7 (≥20%), còn lại mô tả là dao động theo nhịp; ngày cuối tuần/lễ vào-ra thấp là nhịp bình thường; KHÔNG kết luận về công suất, khách tăng/giảm hay giá trị đơn từ dao động một ngày (khách đẩy đơn theo lô); SLA của báo cáo ngày đánh giá LÔ ĐƠN VÀO NGÀY sla.cohortFrom (D−2, đã đủ tuổi) — nói rõ "lô vào ngày …"; sla.mature = 0 nghĩa là chưa có lô đủ tuổi, không viết % đúng hẹn. Kỳ ≥ 7 ngày → so kỳ liền trước, dùng đủ các luật. Với báo cáo ngày, việc cần làm tập trung vào: đơn quá hạn (sla.overdue), tồn theo chặng (capacity.byStage), designer tồn/làm lại — là những thứ có thể xử lý trong ngày.
Trả về JSON đúng khuôn: tomTat (2–3 câu tóm tắt kỳ: làm được bao nhiêu, đúng hẹn không, vấn đề lớn nhất), ketLuan (3–6 gạch đầu dòng, xếp quan trọng trước), viecCanLam (3–5 việc, mỗi việc ghi AI làm + LÀM GÌ + KHI NÀO, ví dụ "Trưởng ca TN: họp giải kẹt Ép sáng nay"), ruiRo (0–3 rủi ro nếu không hành động), diemSang (0–3 điểm tốt cần khen). Không dùng markdown, không emoji.`;

const kindOf = (from: string, to: string, days: number): CeoReportKind => {
  if (days === 1) return 'day';
  // Thứ trong tuần tính theo giờ VN: dịch mốc +7h rồi đọc bằng getUTC*.
  const vnF = new Date(new Date(`${from}T00:00:00+07:00`).getTime() + 7 * 3_600_000);
  if (days === 7 && vnF.getUTCDay() === 1) return 'week';
  // Phép nhận biết tháng dùng CHUNG với báo cáo khách hàng — hai bộ gán khác
  // nhãn cho cùng một kỳ thì agent bày sai một trong hai.
  if (laThangTron(from, to)) return 'month';

  return 'custom';
};
const vnDay = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/**
 * Nhận định của hệ thống cho CEO Dashboard: lấy `CeoOverview` → Agent SDK (cùng phiên
 * Claude Code + `CLAUDE_CLI_PATH` như tóm tắt Zalo) viết tiếng Việt theo khuôn JSON →
 * lưu `ceo_reports`. Chạy theo cron (ngày/tuần/tháng) hoặc nút "Cập nhật nhận định".
 * Agent ngoài đọc cùng bản này qua `GET /agent/ceo-report` — KHÔNG có đường ghi cho agent.
 */
@Injectable()
export class CeoReportService {
  private readonly logger = new Logger(CeoReportService.name);
  private readonly dangChay = new Set<string>();

  constructor(
    @InjectModel(CeoReportEntity.name) private readonly reportModel: Model<CeoReportDocument>,
    private readonly dashboard: CeoDashboardService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  isGenerating(from: string, to: string): boolean {
    return this.dangChay.has(`${from}_${to}`);
  }

  async getLatest(from: string, to: string): Promise<CeoReport | null> {
    const doc = await this.reportModel.findOne({ periodKey: `${from}_${to}` }).sort({ generatedAt: -1 }).lean();
    return doc ? this.toDto(doc as unknown as CeoReportEntity & { _id: unknown }) : null;
  }

  /**
   * Ảnh báo cáo (PNG) cho kỳ — thứ agent tải về rồi gửi thẳng Telegram/Zalo.
   *
   * Dựng TẠI MÁY CHỦ, agent không phải vẽ gì. Dùng lại `getOverview` (đã cache
   * 5 phút) nên gọi nhiều lần trong một kỳ gần như không tốn gì; nhận định thì
   * lấy bản mới nhất của kỳ, chưa có thì ảnh chỉ gồm số liệu.
   *
   * KHÔNG lưu ảnh vào Mongo: nhị phân trong document sẽ lọt ra `POST
   * /agent/query` (API-19 mở hết mọi bảng) làm phồng phản hồi, mà dựng lại chỉ
   * mất vài chục mili giây.
   */
  async renderChartPng(from: string, to: string): Promise<Buffer> {
    const [overview, report] = await Promise.all([this.dashboard.getOverview(from, to), this.getLatest(from, to)]);
    const svg = buildCeoChartSvg({ overview, report });

    // `sharp` nạp động: module này còn được nạp ở tiến trình microservice, và
    // nhị phân native của sharp không cần thiết ở đó.
    const sharp = (await import('sharp')).default;

    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  }

  /** Sinh nhận định mới cho kỳ; đang chạy cùng kỳ → 409. */
  async generate(from: string, to: string, trigger: 'cron' | 'manual'): Promise<CeoReport> {
    const key = `${from}_${to}`;
    if (this.dangChay.has(key)) throw new ConflictException('Đang sinh nhận định cho kỳ này — chờ xong rồi tải lại.');
    this.dangChay.add(key);
    const t0 = Date.now();
    try {
      const overview = await this.dashboard.getOverview(from, to);
      const parsed = await this.goiMoHinh(overview);
      const n2 = overview.sla.within.find((w) => w.n === 2)?.pct ?? null;
      const doc = await this.reportModel.create({
        periodKey: key,
        from,
        to,
        kind: kindOf(from, to, overview.period.days),
        tomTat: String(parsed.tomTat || '').trim(),
        ketLuan: this.list(parsed.ketLuan),
        viecCanLam: this.list(parsed.viecCanLam),
        ruiRo: this.list(parsed.ruiRo),
        diemSang: this.list(parsed.diemSang),
        soLieu: {
          in: overview.production.in,
          out: overview.production.out,
          revenue: overview.revenue.total,
          n2Pct: n2,
          errorRatePct: overview.quality.ratePct,
          backlog: overview.capacity.backlog,
          overdue: overview.sla.overdue.total,
        },
        findings: overview.findings,
        model: MODEL,
        generatedAt: new Date(),
        trigger,
      });
      this.logger.log(`[ceo-report] ${key} (${trigger}) xong sau ${Math.round((Date.now() - t0) / 1000)}s`);
      return this.toDto(doc.toObject() as unknown as CeoReportEntity & { _id: unknown });
    } catch (e) {
      this.logger.error(`[ceo-report] ${key} (${trigger}) thất bại: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    } finally {
      this.dangChay.delete(key);
    }
  }

  // ── Cron (giờ VN) — bỏ qua im lặng khi tắt bằng env; lỗi chỉ ghi log, không làm hỏng tiến trình. ──
  @Cron('0 7 * * *', { name: 'ceo-report-daily', timeZone: TZ })
  async cronDaily(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;
    if (!CRON_ENABLED) return;
    const y = vnDay(new Date(Date.now() - 864e5));
    await this.chayCron(y, y);
  }
  @Cron('10 7 * * 1', { name: 'ceo-report-weekly', timeZone: TZ })
  async cronWeekly(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;
    if (!CRON_ENABLED) return;
    const sun = new Date(Date.now() - 864e5);
    await this.chayCron(vnDay(new Date(sun.getTime() - 6 * 864e5)), vnDay(sun));
  }
  @Cron('20 7 1 * *', { name: 'ceo-report-monthly', timeZone: TZ })
  async cronMonthly(): Promise<void> {
    // Chỉ chạy ở tiến trình HTTP — xem `utils/cron-guard.ts`.
    if (!laTienTrinhChayCron(this.adapterHost)) return;
    if (!CRON_ENABLED) return;
    const lastDay = new Date(Date.now() - 864e5);
    const to = vnDay(lastDay);
    await this.chayCron(`${to.slice(0, 8)}01`, to);
  }
  private async chayCron(from: string, to: string): Promise<void> {
    try {
      await this.generate(from, to, 'cron');
    } catch (e) {
      this.logger.error(`[ceo-report] cron ${from}_${to} thất bại: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private list(v: unknown): string[] {
    return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
  }

  private toDto(d: CeoReportEntity & { _id: unknown }): CeoReport {
    return {
      _id: String(d._id),
      periodKey: d.periodKey,
      from: d.from,
      to: d.to,
      kind: d.kind as CeoReportKind,
      tomTat: d.tomTat,
      ketLuan: d.ketLuan || [],
      viecCanLam: d.viecCanLam || [],
      ruiRo: d.ruiRo || [],
      diemSang: d.diemSang || [],
      soLieu: d.soLieu as CeoReport['soLieu'],
      findings: (d.findings || []) as CeoReport['findings'],
      model: d.model,
      generatedAt: new Date(d.generatedAt).toISOString(),
      trigger: d.trigger,
    };
  }

  /** Rút gọn overview trước khi đưa vào lời nhắc — bỏ chuỗi ngày dài, giữ số quyết định. */
  private rutGon(o: CeoOverview): Record<string, unknown> {
    return {
      period: o.period,
      production: { in: o.production.in, out: o.production.out, prevIn: o.production.prevIn, prevOut: o.production.prevOut, reference: o.production.reference, dailyKyNay: o.production.daily.filter((d) => d.day >= o.period.from), byFactory: o.production.byFactory },
      revenue: o.revenue,
      sla: { targets: o.sla.targets, cohortFrom: o.sla.cohortFrom, cohortTo: o.sla.cohortTo, mature: o.sla.mature, within: o.sla.within, prevN2Pct: o.sla.prevN2Pct, overdue: { total: o.sla.overdue.total, byFactory: o.sla.overdue.byFactory, oldest: o.sla.overdue.sample.slice(0, 3) } },
      quality: o.quality,
      customers: { active: o.customers.active, prevActive: o.customers.prevActive, newCount: o.customers.newCount, top10SharePct: o.customers.top10SharePct, top: o.customers.top.slice(0, 8), rising: o.customers.rising, dropping: o.customers.dropping },
      capacity: { backlog: o.capacity.backlog, prevBacklog: o.capacity.prevBacklog, avgAgeDays: o.capacity.avgAgeDays, staleOpen: o.capacity.staleOpen, byStage: o.capacity.byStage, backlog7NgayGanNhat: o.capacity.history.slice(-7) },
      people: { designers: o.people.designers.slice(0, 8), workers: o.people.workers.slice(0, 10) },
      findings: o.findings,
    };
  }

  private async goiMoHinh(overview: CeoOverview): Promise<Record<string, unknown>> {
    const loiNhac = `${LOI_NHAC}\n\nKỲ: ${overview.period.from} → ${overview.period.to} (${overview.period.days} ngày), so với ${overview.period.prevFrom} → ${overview.period.prevTo}\n\n--- SỐ LIỆU (JSON) ---\n${JSON.stringify(this.rutGon(overview))}`;
    const ac = new AbortController();
    const dongHo = setTimeout(() => ac.abort(), HAN_GIAY * 1000);
    let vanBan = '';
    let coCauTruc: unknown;
    let ketThucLoi: string | undefined;
    let it: ReturnType<typeof query> | undefined;
    try {
      it = query({
        prompt: loiNhac,
        options: {
          model: MODEL,
          abortController: ac,
          ...(CLAUDE_CLI ? { pathToClaudeCodeExecutable: CLAUDE_CLI } : {}),
          allowedTools: [],
          maxTurns: 3,
          outputFormat: { type: 'json_schema', schema: SCHEMA },
        },
      });
      for await (const msg of it) {
        if (msg.type === 'assistant') {
          for (const b of msg.message.content) if (b.type === 'text') vanBan += b.text;
        }
        if (msg.type === 'result') {
          const r = msg as { subtype?: string; structured_output?: unknown };
          if (r.subtype === 'success') {
            if (r.structured_output !== undefined) coCauTruc = r.structured_output;
          } else if (r.subtype) ketThucLoi = r.subtype;
        }
      }
    } catch (error) {
      const mo = error instanceof Error ? error.message : String(error);
      if (ac.signal.aborted) throw new ServiceUnavailableException(`Mô hình không trả lời trong ${HAN_GIAY} giây — thử lại sau.`);
      this.logger.error(`[ceo-report] lỗi gốc từ Agent SDK: ${mo.slice(0, 500)}`);
      if (/ENOENT|not found|spawn/i.test(mo)) throw new ServiceUnavailableException('Máy chạy API chưa có CLI `claude` — cài Claude Code rồi đặt CLAUDE_CLI_PATH.');
      if (/auth|credential|login|unauthor|api[ _-]?key/i.test(mo)) throw new ServiceUnavailableException('Backend chưa đăng nhập được Claude — kiểm tra phiên Claude Code (~/.claude) của user chạy API.');
      throw new ServiceUnavailableException(`Gọi mô hình thất bại: ${mo.slice(0, 200)}`);
    } finally {
      clearTimeout(dongHo);
      it?.close();
    }
    if (ketThucLoi === 'error_max_turns' || ketThucLoi === 'error_max_structured_output_retries') {
      throw new UnprocessableEntityException(`Mô hình không hoàn thành nhận định (${ketThucLoi}).`);
    }
    if (ketThucLoi) throw new ServiceUnavailableException(`Lượt gọi kết thúc với lỗi ${ketThucLoi} — thử lại sau.`);
    const parsed = coCauTruc ?? tachJson(vanBan);
    if (!parsed || typeof parsed !== 'object') {
      this.logger.error(`[ceo-report] không tách được JSON; 300 ký tự đầu: ${vanBan.slice(0, 300)}`);
      throw new UnprocessableEntityException('Mô hình không trả về JSON đúng khuôn.');
    }
    return parsed as Record<string, unknown>;
  }
}
