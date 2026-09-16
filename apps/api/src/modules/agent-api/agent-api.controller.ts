import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Res, UseFilters, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import type { CeoOverview, CeoReport } from 'shared';
import type { GetCustomerReportResDto } from 'shared';
import {
  AgentQueryPayload,
  CeoOverviewQueryDto,
} from 'shared';
import {
  AgentQueryDto,
  AgentQueryResDto,
  GetAgentDocResDto,
  GetAgentSellerSupportResDto,
  ListAgentDocsResDto,
  ListAgentTablesResDto,
  ReadAgentTableQueryDto,
  ReadAgentTableResDto,
} from 'shared';
import {
  AgentZaloSendDto,
  type AgentZaloSendResDto,
  GetAgentZaloInboxDto,
  type GetAgentZaloInboxResDto,
  GetAgentZaloMessagesDto,
  type GetAgentZaloMessagesResDto,
} from 'shared';
import { Logger } from 'winston';

import { Auth } from '@/decorators';
import { SWAGGER_AGENT_KEY_SECURITY } from '@/setup-swagger';

import { CeoDashboardService } from '../ceo-dashboard/ceo-dashboard.service';
import { CeoReportService } from '../ceo-dashboard/ceo-report.service';
import { CustomerReportService } from '../customer-report/customer-report.service';
import { AGENT_API_RATE_LIMIT_PER_MIN, AGENT_API_RATE_LIMIT_TTL_MS, AGENT_ZALO_SEND_PER_MIN } from './agent-api.constants';
import { AgentApiKeyGuard } from './agent-api-key.guard';
import { AgentAuditService } from './agent-audit.service';
import { AgentDocsService } from './agent-docs.service';
import { AgentExceptionFilter } from './agent-exception.filter';
import { AgentQueryService } from './agent-query.service';
import { AgentReadService } from './agent-read.service';
import { AgentSellerSupportService } from './agent-seller-support.service';
import { AGENT_SWAGGER_DESCRIPTION, agentSummary } from './agent-swagger-guide';
import { AgentZaloInboundService } from './agent-zalo-inbound.service';
import { AgentZaloReadService } from './agent-zalo-read.service';
import { AgentZaloSendService } from './agent-zalo-send.service';

/**
 * Bộ API nội bộ cho AI agent (`API-1`) — xem
 * `documents/FunctionDescription/AgentApi.md`.
 *
 * CHỈ ĐỌC, không có ngoại lệ (BR-3). Xác thực bằng khoá riêng ở header
 * `X-Agent-Api-Key`; `@Auth(..., { public: true })` chỉ để bỏ qua JWT, còn
 * `AgentApiKeyGuard` mới là cửa thật và nó chạy TRƯỚC mọi validate tham số
 * (AC-01).
 */
/** Trần độ dài mỗi mảnh vết — nhật ký là VẾT, không phải bản sao yêu cầu. */
const DIGEST_MAX = 2000;

/**
 * Vết của một lượt `read_rows`: bộ lọc, cột và trần lô bên gọi đã dùng.
 *
 * Vì sao thêm: đường `query` ghi `queryDigest` ngay từ đầu, còn `read_rows` chỉ
 * ghi mỗi tên bảng — đo trên production 05/09: **0/10.203 lượt trong 24 giờ có
 * vết bộ lọc**, trong khi chính đường này kéo về 1,68 triệu dòng mỗi ngày. Số
 * bên agent báo ra mà vênh với hệ thì không truy được họ đã hỏi gì.
 *
 * `filter` tới dưới dạng chuỗi JSON (GET không có thân yêu cầu): parse được thì
 * lưu dạng object cho dễ đọc và truy vấn lại; không parse được thì giữ nguyên
 * văn — chính chuỗi hỏng đó mới là thứ cần nhìn khi bên kia gửi sai.
 *
 * KHÔNG cần che trường cấm ở đây: bộ lọc chứa trường cấm đã bị chặn từ vòng
 * phân tích (`isDeniedFieldPath`), nên thứ tới được đây vốn đã hợp lệ.
 */
function readDigest(query: ReadAgentTableQueryDto): Record<string, unknown> | undefined {
  const { filter, fields, limit } = query;
  if (!filter && !fields && limit === undefined) return undefined;

  let loc: unknown;
  if (filter) {
    try {
      loc = JSON.parse(filter.slice(0, DIGEST_MAX));
    } catch {
      loc = filter.slice(0, DIGEST_MAX);
    }
  }

  return {
    ...(loc === undefined ? {} : { filter: loc }),
    ...(fields ? { fields: fields.slice(0, DIGEST_MAX) } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

@Controller('agent')
@ApiTags('agent-api')
@UseGuards(AgentApiKeyGuard)
// Thân lỗi của nhánh này mang `code` theo bảng 8 mã đã công bố — filter chung
// của repo dựng lại thân từ đầu nên nuốt mất (`QA-2`). Chỉ gắn ở đây, không
// đụng nhánh nào khác của app.
@UseFilters(AgentExceptionFilter)
@ApiSecurity(SWAGGER_AGENT_KEY_SECURITY)
export class AgentApiController {
  constructor(
    private readonly read: AgentReadService,
    private readonly queries: AgentQueryService,
    private readonly docs: AgentDocsService,
    private readonly sellerSupport: AgentSellerSupportService,
    private readonly ceo: CeoDashboardService,
    private readonly ceoReports: CeoReportService,
    private readonly customerReports: CustomerReportService,
    private readonly zaloSend: AgentZaloSendService,
    private readonly zaloRead: AgentZaloReadService,
    private readonly zaloInbound: AgentZaloInboundService,
    private readonly audit: AgentAuditService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  /**
   * Log theo quy ước repo. KHÔNG log giá trị điều kiện lọc — email khách dùng
   * làm điều kiện lọc là dữ liệu BR-4, và file log không phải nơi cất nó.
   */
  private log(method: string, url: string, extra?: Record<string, unknown>): void {
    this.logger.info({ message: JSON.stringify({ method, url, ...extra }) });
  }

  @Get('tables')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: agentSummary('listTables'), description: AGENT_SWAGGER_DESCRIPTION.listTables })
  @HttpCode(HttpStatus.OK)
  async listTables(): Promise<ListAgentTablesResDto> {
    const startedAt = Date.now();
    this.log('GET', '/agent/tables');
    const data = await this.read.listTables();
    this.audit.write({
      capability: 'list_tables',
      returned: data.length,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });
    return { success: true, data };
  }

  @Get('tables/:table/rows')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: agentSummary('readRows'), description: AGENT_SWAGGER_DESCRIPTION.readRows })
  @HttpCode(HttpStatus.OK)
  async readRows(
    @Param('table') table: string,
    @Query() query: ReadAgentTableQueryDto,
  ): Promise<ReadAgentTableResDto> {
    const startedAt = Date.now();
    this.log('GET', '/agent/tables/:table/rows', { table });
    try {
      const data = await this.read.readRows(table, query.limit, query.cursor, query.fields, query.filter);
      this.audit.write({
        capability: 'read_rows',
        table,
        queryDigest: readDigest(query),
        returned: data.items.length,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
      });
      return { success: true, data };
    } catch (error) {
      this.audit.write({
        capability: 'read_rows',
        table,
        queryDigest: readDigest(query),
        durationMs: Date.now() - startedAt,
        ...this.outcomeOf(error),
      });
      throw error;
    }
  }

  @Post('query')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: agentSummary('query'), description: AGENT_SWAGGER_DESCRIPTION.query })
  @HttpCode(HttpStatus.OK)
  async query(@Body() body: AgentQueryDto): Promise<AgentQueryResDto> {
    const startedAt = Date.now();
    this.log('POST', '/agent/query', { table: body.table, mode: body.aggregate ? 'aggregate' : 'rows' });
    let digest: unknown;
    try {
      // Lớp chặn thứ nhất của AC-06 — chạy trước cả khi tra bảng.
      this.queries.assertNoOperatorKeysOutsideFilter(body);

      const spec = this.queries.spec(body.table);
      digest = this.queries.digest(spec, body.filter);
      const filter = this.queries.buildFilter(spec, body.filter);

      const result = body.aggregate
        ? await this.queries.aggregate(spec, filter, body.aggregate)
        : await this.queries.selectRows(spec, filter, body.select);

      const data: AgentQueryPayload = {
        items: result.items,
        meta: {
          table: spec.key,
          mode: body.aggregate ? 'aggregate' : 'rows',
          returned: result.items.length,
          limitApplied: result.limitApplied,
        },
      };
      this.audit.write({
        capability: 'query',
        table: body.table,
        queryDigest: digest,
        returned: data.items.length,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
      });
      return { success: true, data };
    } catch (error) {
      this.audit.write({
        capability: 'query',
        table: body.table,
        queryDigest: digest,
        durationMs: Date.now() - startedAt,
        ...this.outcomeOf(error),
      });
      throw error;
    }
  }

  /**
   * `AGENT-ZALO` — MỘT lệnh gọi trả đủ cho agent hỗ trợ khách / báo cáo chủ tịch.
   *
   * Thay cho việc agent tự ghép `zalo_group_summaries` + `zalo_group_links` +
   * `orders` + sản phẩm. Bốn vòng gọi cho một câu hỏi, mỗi chỗ ghép sai là một
   * câu trả lời sai gửi tới khách.
   *
   * Nhóm nội bộ KHÔNG BAO GIỜ xuất hiện ở đây: nguồn `zalo_group_summaries` chỉ
   * chứa nhóm khách/vận hành, tóm tắt bị xoá khi nhóm chuyển sang `internal`.
   */
  @Get('seller-support')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: 'Tình hình từng nhóm khách/vận hành kèm số liệu đơn sống và sản phẩm hay đặt' })
  @HttpCode(HttpStatus.OK)
  async getSellerSupport(
    @Query('mucDo') mucDo?: string,
    @Query('userSku') userSku?: string,
    @Query('limit') limit?: string,
    @Query('kemSanPham') kemSanPham?: string,
  ): Promise<GetAgentSellerSupportResDto> {
    const startedAt = Date.now();
    this.log('GET', '/agent/seller-support', { mucDo });
    const data = await this.sellerSupport.list({
      mucDo,
      userSku,
      limit: limit ? Number(limit) : undefined,
      kemSanPham: kemSanPham === 'false' ? false : undefined,
    });
    this.audit.write({
      capability: 'seller_support',
      returned: data.length,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });

    return { success: true, data };
  }

  /**
   * CEO Dashboard cho agent (07/09/2026): CÙNG số với trang `/adm/ceo` — một phản hồi 7 khối +
   * `findings` theo luật. Agent dùng để báo cáo ngày/tuần/tháng; định nghĩa số ở
   * `documents/AgentGuide/CeoDashboard.md`. Chỉ đọc.
   */
  @Get('ceo-overview')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: 'CEO overview — cùng số với dashboard lãnh đạo (from/to yyyy-mm-dd, ≤ 92 ngày)' })
  @HttpCode(HttpStatus.OK)
  async getCeoOverview(@Query() q: CeoOverviewQueryDto): Promise<{ success: true; data: CeoOverview }> {
    const startedAt = Date.now();
    this.log('GET', '/agent/ceo-overview');
    const data = await this.ceo.getOverview(q.from, q.to);
    this.audit.write({ capability: 'ceo_overview', queryDigest: { from: q.from, to: q.to }, returned: 1, durationMs: Date.now() - startedAt, outcome: 'ok' });
    return { success: true, data };
  }

  /** Nhận định mới nhất hệ thống đã viết cho kỳ (null nếu chưa có) — agent trích nguyên văn, không tự viết lại số. */
  @Get('ceo-report')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: 'Nhận định mới nhất của hệ thống cho kỳ (from/to) — tiếng Việt, kèm số cốt lõi' })
  @HttpCode(HttpStatus.OK)
  async getCeoReport(@Query() q: CeoOverviewQueryDto): Promise<{ success: true; data: { report: CeoReport | null; generating: boolean } }> {
    const startedAt = Date.now();
    this.log('GET', '/agent/ceo-report');
    const report = await this.ceoReports.getLatest(q.from, q.to);
    this.audit.write({ capability: 'ceo_report', queryDigest: { from: q.from, to: q.to }, returned: report ? 1 : 0, durationMs: Date.now() - startedAt, outcome: 'ok' });
    return { success: true, data: { report, generating: this.ceoReports.isGenerating(q.from, q.to) } };
  }

  /**
   * Ảnh báo cáo dựng SẴN phía máy chủ (PNG) — agent tải rồi gửi thẳng
   * Telegram/Zalo, KHÔNG phải tự vẽ.
   *
   * Nhận MỌI khoảng ngày (khác `ceo-report` vốn phải khớp đúng kỳ đã sinh): số
   * liệu luôn dựng được, còn nhận định thì có mới in, chưa có thì ảnh chỉ gồm
   * số. Trả nhị phân nên KHÔNG bọc `{success, data}` như các endpoint khác.
   */
  /**
   * Báo cáo KHÁCH HÀNG cho kỳ — song song `ceo-report`, cùng luật khớp
   * `periodKey` chính xác. Cron sinh 07:15 mỗi sáng cho cửa sổ 7 ngày kết thúc
   * ở hôm qua; kỳ khác thì `null` cho tới khi có người sinh.
   */
  @Get('customer-report')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: 'Báo cáo khách hàng cho kỳ (from/to) — tiếng Việt viết sẵn, kèm khách tăng/tụt và vướng mắc' })
  @HttpCode(HttpStatus.OK)
  async getCustomerReport(@Query() q: CeoOverviewQueryDto): Promise<GetCustomerReportResDto> {
    const startedAt = Date.now();
    this.log('GET', '/agent/customer-report');
    const report = await this.customerReports.getLatest(q.from, q.to);
    this.audit.write({ capability: 'customer_report', queryDigest: { from: q.from, to: q.to }, returned: report ? 1 : 0, durationMs: Date.now() - startedAt, outcome: 'ok' });

    return { success: true, data: { report, generating: this.customerReports.isGenerating(q.from, q.to) } };
  }

  /**
   * GỬI tin Zalo — ngoại lệ DUY NHẤT của luật chỉ-đọc (BR-3).
   *
   * Chốt chặn ở `agent-zalo-send.logic.ts`: chỉ nhóm `internal`/`operation`,
   * CẤM nhóm khách và nhóm chưa phân loại; `conversationId` (nếu truyền) phải
   * thuộc đúng nhóm đó. Mọi lượt gửi đều vào nhật ký kèm nội dung — nhắn ra
   * ngoài mà không có vết thì sau này không truy được ai đã nói gì.
   */
  @Post('zalo/send')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_ZALO_SEND_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: 'Gửi tin vào nhóm Zalo nội bộ/vận hành (CẤM nhóm khách)' })
  @HttpCode(HttpStatus.OK)
  async sendZalo(@Body() dto: AgentZaloSendDto): Promise<AgentZaloSendResDto> {
    const startedAt = Date.now();
    this.log('POST', '/agent/zalo/send');
    try {
      // Chế độ chọn bằng sự có mặt của `groupGlobalId`, không bằng suy đoán:
      // hai đường có HAI chốt chặn khác nhau (phân loại nhóm vs vai người nhận).
      const data = dto.groupGlobalId
        ? await this.zaloSend.guiTinNhom(dto.groupGlobalId, dto.content, { conversationId: dto.conversationId, accountName: dto.accountName, allowFallback: dto.allowFallback })
        : await this.zaloSend.guiTinRieng(dto.conversationId as string, dto.content);
      this.audit.write({
        capability: 'zalo_send',
        queryDigest: {
          groupGlobalId: dto.groupGlobalId,
          conversationId: data.conversationId,
          // Ghi vết ai nhận: đường DM không có tên nhóm để tra ngược sau này.
          recipient: 'recipient' in data ? data.recipient : undefined,
          // Ghi vết nick đã gửi: danh tính bộ phận là thứ người trong nhóm nhìn thấy.
          sentAsNick: data.sentAsNick,
          content: dto.content.slice(0, DIGEST_MAX),
        },
        returned: 1,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
      });

      return { success: true, data };
    } catch (e) {
      // Ghi vết cả lượt BỊ CHẶN: biết agent định nhắn vào đâu quan trọng ngang
      // biết nó đã nhắn gì.
      this.audit.write({
        capability: 'zalo_send',
        queryDigest: { groupGlobalId: dto.groupGlobalId, content: dto.content.slice(0, DIGEST_MAX), loi: e instanceof Error ? e.message : String(e) },
        returned: 0,
        durationMs: Date.now() - startedAt,
        outcome: 'error',
      });
      throw e;
    }
  }

  /**
   * ĐỌC tin của một nhóm — nền của cả ba nguồn kích hoạt.
   *
   * Cùng chốt loại nhóm với đường gửi: agent không đọc được nhóm khách hàng.
   * Đọc nhóm khách còn nặng hơn gửi nhầm — gửi nhầm thì người ta thấy và mắng,
   * còn đọc lén thì không ai biết.
   */
  @Get('zalo/groups/:groupGlobalId/messages')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: 'Đọc tin của một nhóm Zalo nội bộ/vận hành' })
  @HttpCode(HttpStatus.OK)
  async zaloMessages(
    @Param('groupGlobalId') groupGlobalId: string,
    @Query() q: GetAgentZaloMessagesDto,
  ): Promise<GetAgentZaloMessagesResDto> {
    const startedAt = Date.now();
    this.log('GET', `/agent/zalo/groups/${groupGlobalId}/messages`);
    const data = await this.zaloRead.tinCuaNhom(groupGlobalId, q.limit ?? 50, q.since);
    this.audit.write({
      capability: 'zalo_read',
      queryDigest: { groupGlobalId, limit: q.limit, since: q.since },
      returned: data.length,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });

    return { success: true, data, total: data.length };
  }

  /**
   * ĐỌC tin của một hội thoại RIÊNG.
   *
   * Cùng chốt với đường gửi riêng — mặc định cấm, chỉ `chairman`/`staff`. Đọc
   * trộm tin riêng của một người chưa ai xác định là ai còn khó biện minh hơn
   * nhắn nhầm cho họ: nhắn nhầm thì người ta thấy, đọc thì không.
   */
  @Get('zalo/dm/:conversationId/messages')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: 'Đọc tin của một hội thoại riêng (chỉ nhân viên/chủ tịch)' })
  @HttpCode(HttpStatus.OK)
  async zaloDmMessages(
    @Param('conversationId') conversationId: string,
    @Query() q: GetAgentZaloMessagesDto,
  ): Promise<GetAgentZaloMessagesResDto> {
    const startedAt = Date.now();
    this.log('GET', `/agent/zalo/dm/${conversationId}/messages`);
    const data = await this.zaloRead.tinCuaDm(conversationId, q.limit ?? 50, q.since);
    this.audit.write({
      capability: 'zalo_read',
      queryDigest: { conversationId, limit: q.limit, since: q.since, dm: true },
      returned: data.length,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });

    return { success: true, data, total: data.length };
  }

  /**
   * Hộp thư sự kiện đã lọc — đường lui khi máy bên nhận sập.
   *
   * Cùng một kho với đường đẩy webhook, không phải hai nguồn dữ liệu song song:
   * hai nguồn thì sớm muộn lệch nhau, và lúc đó không ai biết cái nào đúng.
   */
  @Get('zalo/inbox')
  @Auth([], [], { public: true })
  @ApiOperation({ summary: 'Sự kiện Zalo đáng đánh thức agent, từ một con trỏ' })
  @HttpCode(HttpStatus.OK)
  async zaloInbox(@Query() q: GetAgentZaloInboxDto): Promise<GetAgentZaloInboxResDto> {
    const startedAt = Date.now();
    this.log('GET', '/agent/zalo/inbox');
    const r = await this.zaloInbound.hopThu(q.cursor, q.since, q.limit ?? 50);
    this.audit.write({
      capability: 'zalo_inbox',
      queryDigest: { cursor: q.cursor, since: q.since },
      returned: r.total,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });

    return { success: true, ...r };
  }

  @Get('ceo-report/chart.png')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: 'Ảnh PNG báo cáo điều hành cho kỳ (from/to) — dựng sẵn để gửi Telegram/Zalo' })
  @HttpCode(HttpStatus.OK)
  async getCeoReportChart(@Query() q: CeoOverviewQueryDto, @Res() reply: FastifyReply): Promise<void> {
    const startedAt = Date.now();
    this.log('GET', '/agent/ceo-report/chart.png');
    const png = await this.ceoReports.renderChartPng(q.from, q.to);
    this.audit.write({ capability: 'ceo_report_chart', queryDigest: { from: q.from, to: q.to }, returned: 1, durationMs: Date.now() - startedAt, outcome: 'ok' });
    void reply
      .header('content-type', 'image/png')
      .header('content-disposition', `inline; filename="ceo-${q.from}_${q.to}.png"`)
      // Ảnh của một kỳ đã chốt không đổi nữa; cho phép cache ngắn để agent gọi
      // lại nhiều lần trong một phiên trả lời không dựng lại.
      .header('cache-control', 'private, max-age=300')
      .send(png);
  }

  @Get('docs')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: agentSummary('listDocs'), description: AGENT_SWAGGER_DESCRIPTION.listDocs })
  @HttpCode(HttpStatus.OK)
  listDocs(): ListAgentDocsResDto {
    const startedAt = Date.now();
    this.log('GET', '/agent/docs');
    const data = this.docs.list();
    this.audit.write({
      capability: 'docs_catalog',
      returned: data.length,
      durationMs: Date.now() - startedAt,
      outcome: 'ok',
    });
    return { success: true, data };
  }

  @Get('docs/:slug')
  @Auth([], [], { public: true })
  @Throttle({ default: { limit: AGENT_API_RATE_LIMIT_PER_MIN, ttl: AGENT_API_RATE_LIMIT_TTL_MS } })
  @ApiOperation({ summary: agentSummary('getDoc'), description: AGENT_SWAGGER_DESCRIPTION.getDoc })
  @HttpCode(HttpStatus.OK)
  getDoc(@Param('slug') slug: string): GetAgentDocResDto {
    const startedAt = Date.now();
    this.log('GET', '/agent/docs/:slug', { slug });
    try {
      const data = this.docs.get(slug);
      this.audit.write({
        capability: 'docs_get',
        docSlug: slug,
        returned: 1,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
      });
      return { success: true, data };
    } catch (error) {
      this.audit.write({
        capability: 'docs_get',
        docSlug: slug,
        durationMs: Date.now() - startedAt,
        ...this.outcomeOf(error),
      });
      throw error;
    }
  }

  /** Phân loại kết quả để ghi nhật ký — không bao giờ ném tiếp từ trong này. */
  private outcomeOf(error: unknown): { outcome: 'denied' | 'error' | 'timeout'; errorCode?: string } {
    const res = (error as { response?: { code?: string } })?.response;
    const code = typeof res?.code === 'string' ? res.code : undefined;
    if (code === 'QUERY_TIMEOUT') return { outcome: 'timeout', errorCode: code };
    if (code) return { outcome: 'denied', errorCode: code };
    return { outcome: 'error' };
  }
}
