import { ZodValidationPipe } from '@anatine/zod-nestjs';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from 'core';
import {
  AdjustWalletDto,
  GetAdminWalletResDto,
  GetAdminWalletsDto,
  GetAdminWalletsResDto,
  GetAdminWalletTxnsDto,
  GetAdminWalletTxnsResDto,
  GetCreditLimitHistoryDto,
  GetCreditLimitHistoryResDto,
  GetCustomerWalletTxnsDto,
  GetCustomerWalletTxnsResDto,
  normalizeExternalTxnId,
  RoleType,
  TopupWalletDto,
  UpdateCreditLimitDto,
  WalletMutationResDto,
} from 'shared';
import { Logger } from 'winston';

import { Auth } from '@/decorators';
import type { UserDocument } from '@/modules/user/user.entity';

import { CustomerWalletService } from './customer-wallet.service';

/**
 * Quản trị ví seller ở hub (SellerPortal.md §9) — nạp tay phase 1 (seller
 * chuyển khoản ngoài hệ thống, admin cộng + ghi chú BẮT BUỘC), điều chỉnh
 * (+/− — hoàn tiền hủy label, sửa sai sót), hạn mức nợ, xem sổ cái từng seller.
 * Prefix `admin/...` cố ý KHÔNG chứa `/customer/` → RolesGuard chặn token khách.
 */
@Controller('admin/customer-wallets')
@ApiTags('customer-wallets-admin')
@UsePipes(ZodValidationPipe)
export class CustomerWalletAdminController {
  constructor(
    private readonly walletService: CustomerWalletService,
    @Inject('winston') private readonly logger: Logger,
  ) {}

  @Get()
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Danh sách ví seller (số dư + hạn mức + giao dịch gần nhất)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetAdminWalletsResDto })
  async listWallets(@Query() dto: GetAdminWalletsDto, @AuthUser() user: UserDocument): Promise<GetAdminWalletsResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'GET', url: '/admin/customer-wallets', userId: user._id }),
    });
    return { success: true, ...(await this.walletService.listWallets(dto)) };
  }

  // Declared BEFORE `:customerId/transactions` for readability; the two never collide (different segment counts).
  @Get('transactions')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Sổ cái ví của MỌI seller (lọc loại / ngày / seller)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetAdminWalletTxnsResDto })
  async listAllTransactions(@Query() dto: GetAdminWalletTxnsDto): Promise<GetAdminWalletTxnsResDto> {
    return { success: true, ...(await this.walletService.listAllTransactions(dto)) };
  }

  @Get(':customerId/transactions')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Sổ cái ví của 1 seller' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetCustomerWalletTxnsResDto })
  async listTransactions(
    @Param('customerId') customerId: string,
    @Query() dto: GetCustomerWalletTxnsDto,
  ): Promise<GetCustomerWalletTxnsResDto> {
    return { success: true, ...(await this.walletService.listTransactions(customerId, dto)) };
  }

  // Static `transactions` still wins over this parametric route, so the order of declaration does not matter.
  @Get(':customerId')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Ví của 1 seller (số dư + hạn mức hiện tại, đọc mới)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetAdminWalletResDto })
  async getWallet(@Param('customerId') customerId: string): Promise<GetAdminWalletResDto> {
    return { success: true, data: await this.walletService.getAdminWallet(customerId) };
  }

  @Post(':customerId/topup')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Nạp ví tay (phase 1 — seller chuyển khoản ngoài hệ thống)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WalletMutationResDto })
  async topup(
    @Param('customerId') customerId: string,
    @Body() dto: TopupWalletDto,
    @AuthUser() user: UserDocument,
  ): Promise<WalletMutationResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: `/admin/customer-wallets/${customerId}/topup`, userId: user._id }),
    });
    const { replayed, ...txn } = await this.walletService.applyTransaction({
      customerId,
      kind: 'topup',
      amount: dto.amount,
      note: dto.note,
      by: { userId: String(user._id), userName: user.fullName },
      refs: {
        requestId: dto.requestId,
        externalTxnId: normalizeExternalTxnId(dto.externalTxnId),
        attachmentUrl: dto.attachmentUrl,
      },
      strictReplay: true,
    });
    const wallet = await this.walletService.getWallet(customerId);
    return { success: true, data: { balance: wallet.balance, creditLimit: wallet.creditLimit, txn, replayed } };
  }

  @Post(':customerId/adjust')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Điều chỉnh ví (+/−) — hoàn tiền hủy label, sửa sai sót; bắt buộc ghi chú' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WalletMutationResDto })
  async adjust(
    @Param('customerId') customerId: string,
    @Body() dto: AdjustWalletDto,
    @AuthUser() user: UserDocument,
  ): Promise<WalletMutationResDto> {
    this.logger.info({
      message: JSON.stringify({ method: 'POST', url: `/admin/customer-wallets/${customerId}/adjust`, userId: user._id }),
    });
    const { replayed, ...txn } = await this.walletService.applyTransaction({
      customerId,
      kind: 'adjust',
      amount: dto.amount,
      note: dto.note,
      by: { userId: String(user._id), userName: user.fullName },
      refs: { requestId: dto.requestId },
      strictReplay: true,
    });
    const wallet = await this.walletService.getWallet(customerId);
    return { success: true, data: { balance: wallet.balance, creditLimit: wallet.creditLimit, txn, replayed } };
  }

  @Get(':customerId/credit-limit-history')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Lịch sử đổi hạn mức nợ của 1 seller (ai, lúc nào, từ → đến)' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GetCreditLimitHistoryResDto })
  async listCreditLimitHistory(
    @Param('customerId') customerId: string,
    @Query() dto: GetCreditLimitHistoryDto,
  ): Promise<GetCreditLimitHistoryResDto> {
    return { success: true, ...(await this.walletService.listCreditLimitHistory(customerId, dto)) };
  }

  @Patch(':customerId/credit-limit')
  @Auth([RoleType.Admin])
  @ApiOperation({ summary: 'Đặt hạn mức nợ ví cho seller' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WalletMutationResDto })
  async updateCreditLimit(
    @Param('customerId') customerId: string,
    @Body() dto: UpdateCreditLimitDto,
    @AuthUser() user: UserDocument,
  ): Promise<WalletMutationResDto> {
    this.logger.info({
      message: JSON.stringify({
        method: 'PATCH',
        url: `/admin/customer-wallets/${customerId}/credit-limit`,
        userId: user._id,
      }),
    });
    const data = await this.walletService.updateCreditLimit(
      customerId,
      dto.creditLimit,
      { userId: String(user._id), userName: user.fullName },
      dto.note,
      dto.largeIncreaseAck,
    );
    return { success: true, data };
  }
}
