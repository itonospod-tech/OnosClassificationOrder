import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import type {
  GetZaloGroupLinksResDto,
  GetZaloGroupSuggestionsResDto,
  GetZaloIdentitiesResDto,
  GetZaloSummariesResDto,
  GetZaloSummaryQueueResDto,
  SummarizeZaloGroupResDto,
  SyncZaloGroupsResDto,
  SyncZaloIdentitiesResDto,
  UpdateZaloGroupLinkResDto,
  UpdateZaloIdentityResDto,
  ZaloGroupCoverageResDto,
} from 'shared';
import {
  GetZaloGroupLinksDto,
  GetZaloIdentitiesDto,
  GetZaloSummariesDto,
  RoleType,
  SummarizeZaloGroupDto,
  SyncZaloGroupsDto,
  SyncZaloIdentitiesDto,
  ToggleZaloSummaryTaskDto,
  UpdateZaloGroupLinkDto,
  UpdateZaloIdentityDto,
} from 'shared';
import { Logger } from 'winston';

import { AuthZalo } from '@/decorators/http.decorator';

import type { UserDocument } from '../user/user.entity';
import { ZaloGroupService } from './zalo-group.service';
import { ZaloIdentityService } from './zalo-identity.service';
import { ZaloSummaryService } from './zalo-summary.service';

/**
 * Xem danh sách nhóm + tình hình + bảng phủ sóng.
 *
 * Khớp ĐÚNG với `page.zalo_groups` ở FE (SuperAdmin/Admin/Manager). Trước đây
 * còn có Support/SupportManager: họ không thấy menu nhưng vẫn gọi API được nếu
 * gõ thẳng URL — mà dữ liệu ở đây là tóm tắt nội dung chat với khách. Quyền
 * thật nằm ở BE, nên hai bên lệch nhau là chỗ chắc chắn bị bỏ sót khi rà soát
 * về sau. Cần mở cho Support thì mở ở CẢ hai nơi cùng lúc.
 */
const ZALO_GROUP_VIEW_ROLES = [RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager];

/** Gắn nhóm ↔ khách. Hẹp hơn xem: gắn sai là quy nhầm doanh thu sang khách khác. */
const ZALO_GROUP_EDIT_ROLES = [RoleType.SuperAdmin, RoleType.Admin, RoleType.Manager];

@ApiTags('zalo-groups')
@Controller('zalo-groups')
export class ZaloGroupController {
  constructor(
    private readonly zaloGroupService: ZaloGroupService,
    private readonly zaloSummaryService: ZaloSummaryService,
    private readonly zaloIdentityService: ZaloIdentityService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  @Get()
  @AuthZalo(ZALO_GROUP_VIEW_ROLES)
  @ApiOperation({ summary: 'Danh sách nhóm Zalo đã đồng bộ (lọc theo phân loại / khách / chưa gắn)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetZaloGroupLinksDto })
  async getGroups(
    @Query() dto: GetZaloGroupLinksDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetZaloGroupLinksResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/zalo-groups', userId: user._id, query: dto }),
    });

    return { success: true, ...(await this.zaloGroupService.getGroups(dto)) } as GetZaloGroupLinksResDto;
  }

  @Get('coverage')
  @AuthZalo(ZALO_GROUP_VIEW_ROLES)
  @ApiOperation({ summary: 'Bảng phủ sóng: còn bao nhiêu nhóm chưa xét, bao nhiêu khách chưa có nhóm' })
  @HttpCode(HttpStatus.OK)
  async getCoverage(@AuthUser() user: UserDocument): Promise<ZaloGroupCoverageResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/zalo-groups/coverage', userId: user._id }),
    });

    return { success: true, data: await this.zaloGroupService.getCoverage() };
  }

  @Get('suggestions')
  @AuthZalo(ZALO_GROUP_EDIT_ROLES)
  @ApiOperation({ summary: 'Gợi ý ghép nhóm ↔ khách theo tên nhóm (chỉ gợi ý, người vẫn phải duyệt)' })
  @HttpCode(HttpStatus.OK)
  async getSuggestions(@AuthUser() user: UserDocument): Promise<GetZaloGroupSuggestionsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/zalo-groups/suggestions', userId: user._id }),
    });

    return { success: true, data: await this.zaloGroupService.getSuggestions() };
  }

  @Post('sync')
  @AuthZalo(ZALO_GROUP_EDIT_ROLES)
  @ApiOperation({ summary: 'Nạp nhóm từ engine Zalo (onosceo) — KHÔNG đụng tới phân loại/khách đã gắn' })
  @HttpCode(HttpStatus.OK)
  async syncGroups(
    @Body() dto: SyncZaloGroupsDto,
    @AuthUser() user: UserDocument,
  ): Promise<SyncZaloGroupsResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/zalo-groups/sync',
        userId: user._id,
        groups: dto.groups?.length ?? 0,
      }),
    });

    return { success: true, data: await this.zaloGroupService.syncGroups(dto) };
  }

  @Patch(':id')
  @AuthZalo(ZALO_GROUP_EDIT_ROLES)
  @ApiOperation({ summary: 'Gắn / gỡ khách, đổi phân loại, chỉ định người phụ trách cho một nhóm' })
  @HttpCode(HttpStatus.OK)
  async updateLink(
    @Param('id') id: string,
    @Body() dto: UpdateZaloGroupLinkDto,
    @AuthUser() user: UserDocument,
  ): Promise<UpdateZaloGroupLinkResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'PATCH', url: `/zalo-groups/${id}`, userId: user._id, body: dto }),
    });

    return { success: true, data: await this.zaloGroupService.updateLink(id, dto, String(user._id)) } as UpdateZaloGroupLinkResDto;
  }

  // ─── Tóm tắt tình hình nhóm ──────────────────────────────────────

  @Get('summaries')
  @AuthZalo(ZALO_GROUP_VIEW_ROLES)
  @ApiOperation({ summary: 'Bảng tóm tắt tình hình các nhóm (gấp lên đầu)' })
  @HttpCode(HttpStatus.OK)
  async getSummaries(
    @Query() dto: GetZaloSummariesDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetZaloSummariesResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/zalo-groups/summaries', userId: user._id, query: dto }),
    });

    return { success: true, ...(await this.zaloSummaryService.list(dto)) } as GetZaloSummariesResDto;
  }

  @Get('summary-queue')
  @AuthZalo(ZALO_GROUP_EDIT_ROLES)
  @ApiOperation({ summary: 'Nhóm đang chờ tóm tắt + mốc tin cần lấy từ (cho script đồng bộ)' })
  @HttpCode(HttpStatus.OK)
  async getSummaryQueue(@AuthUser() user: UserDocument): Promise<GetZaloSummaryQueueResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/zalo-groups/summary-queue', userId: user._id }),
    });

    return { success: true, data: await this.zaloSummaryService.getQueue() };
  }

  @Post('summarize')
  @AuthZalo(ZALO_GROUP_EDIT_ROLES)
  @ApiOperation({
    summary: 'Đẩy một nhóm vào hàng đợi tóm tắt (trả về ngay, worker chạy nền)',
  })
  @HttpCode(HttpStatus.OK)
  async summarize(
    @Body() dto: SummarizeZaloGroupDto,
    @AuthUser() user: UserDocument,
  ): Promise<{ success: true; data: { queued: boolean } }> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/zalo-groups/summarize',
        userId: user._id,
        groupGlobalId: dto.groupGlobalId,
        messages: dto.messages?.length ?? 0,
      }),
    });

    // Trả về NGAY sau khi xếp hàng. Một lượt tóm tắt mất ~40 giây; giữ nó trong
    // request là mất trắng cả lượt mỗi khi có gì cắt kết nối (deploy, restart,
    // nginx timeout) — đã đứt hai lần trong lúc phát triển vì đúng lý do này.
    return { success: true, data: await this.zaloSummaryService.enqueue(dto) };
  }

  @Patch('summaries/:groupGlobalId/task')
  @AuthZalo(ZALO_GROUP_VIEW_ROLES)
  @ApiOperation({ summary: 'Tick / bỏ tick một việc trong danh sách của nhóm' })
  @HttpCode(HttpStatus.OK)
  async toggleTask(
    @Param('groupGlobalId') groupGlobalId: string,
    @Body() dto: ToggleZaloSummaryTaskDto,
    @AuthUser() user: UserDocument,
  ): Promise<SummarizeZaloGroupResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'PATCH',
        url: `/zalo-groups/summaries/${groupGlobalId}/task`,
        userId: user._id,
        body: dto,
      }),
    });

    return {
      success: true,
      data: await this.zaloSummaryService.toggleTask(groupGlobalId, dto.index, dto.xong),
    } as SummarizeZaloGroupResDto;
  }

  // ─── Định danh: ai là ai trong nhóm ──────────────────────────────

  @Get('identities')
  @AuthZalo(ZALO_GROUP_VIEW_ROLES)
  @ApiOperation({ summary: 'Danh sách người gửi trong nhóm Zalo + phân loại' })
  @HttpCode(HttpStatus.OK)
  async getIdentities(
    @Query() dto: GetZaloIdentitiesDto,
    @AuthUser() user: UserDocument,
  ): Promise<GetZaloIdentitiesResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/zalo-groups/identities', userId: user._id, query: dto }),
    });

    return { success: true, ...(await this.zaloIdentityService.list(dto)) } as GetZaloIdentitiesResDto;
  }

  @Get('identities/counts')
  @AuthZalo(ZALO_GROUP_VIEW_ROLES)
  @ApiOperation({ summary: 'Đếm định danh theo phân loại + số người chưa xác nhận' })
  @HttpCode(HttpStatus.OK)
  async getIdentityCounts(@AuthUser() user: UserDocument): Promise<{ success: true; data: Record<string, number> }> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/zalo-groups/identities/counts', userId: user._id }),
    });

    return { success: true, data: await this.zaloIdentityService.counts() };
  }

  @Post('identities/sync')
  @AuthZalo(ZALO_GROUP_EDIT_ROLES)
  @ApiOperation({ summary: 'Nạp người gửi từ engine Zalo + gieo đề xuất phân loại' })
  @HttpCode(HttpStatus.OK)
  async syncIdentities(
    @Body() dto: SyncZaloIdentitiesDto,
    @AuthUser() user: UserDocument,
  ): Promise<SyncZaloIdentitiesResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/zalo-groups/identities/sync',
        userId: user._id,
        count: dto.identities?.length ?? 0,
      }),
    });

    return { success: true, data: await this.zaloIdentityService.sync(dto) };
  }

  @Post('identities/apply-suggestions')
  @AuthZalo(ZALO_GROUP_EDIT_ROLES)
  @ApiOperation({ summary: 'Áp hàng loạt đề xuất của máy cho người chưa ai xác nhận' })
  @HttpCode(HttpStatus.OK)
  async applyIdentitySuggestions(
    @AuthUser() user: UserDocument,
  ): Promise<{ success: true; data: { applied: number } }> {
    this.logger.info({
      message: JSON.stringify({
        method: 'POST',
        url: '/zalo-groups/identities/apply-suggestions',
        userId: user._id,
      }),
    });

    return { success: true, data: await this.zaloIdentityService.applySuggestions(String(user._id)) };
  }

  @Patch('identities/:zaloUid')
  @AuthZalo(ZALO_GROUP_EDIT_ROLES)
  @ApiOperation({ summary: 'Xác nhận / sửa phân loại một người gửi' })
  @HttpCode(HttpStatus.OK)
  async updateIdentity(
    @Param('zaloUid') zaloUid: string,
    @Body() dto: UpdateZaloIdentityDto,
    @AuthUser() user: UserDocument,
  ): Promise<UpdateZaloIdentityResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'PATCH',
        url: `/zalo-groups/identities/${zaloUid}`,
        userId: user._id,
        body: dto,
      }),
    });

    return {
      success: true,
      data: await this.zaloIdentityService.update(zaloUid, dto, String(user._id)),
    } as UpdateZaloIdentityResDto;
  }
}
