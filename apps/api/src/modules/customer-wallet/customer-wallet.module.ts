import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CustomerEntity, CustomerSchema } from '@/modules/customer/customer.entity';

import { CustomerCreditLimitChangeEntity, CustomerCreditLimitChangeSchema } from './customer-credit-limit-change.entity';
import { CustomerWalletController } from './customer-wallet.controller';
import { CustomerWalletRepository } from './customer-wallet.repository';
import { CustomerWalletService } from './customer-wallet.service';
import { CustomerWalletAdminController } from './customer-wallet-admin.controller';
import { CustomerWalletTransactionEntity, CustomerWalletTransactionSchema } from './customer-wallet-transaction.entity';

/**
 * Ví seller (USD) — sổ cái append-only + cache số dư trên `customers`.
 * `CustomerWalletService` export cho `SellerShippingModule` trừ/hoàn tiền mua
 * label. Chỉ bind model Customer (không import CustomerModule) — tránh kéo
 * cả cây phụ thuộc của module đó vào đây.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomerWalletTransactionEntity.name, schema: CustomerWalletTransactionSchema },
      { name: CustomerEntity.name, schema: CustomerSchema },
      { name: CustomerCreditLimitChangeEntity.name, schema: CustomerCreditLimitChangeSchema },
    ]),
  ],
  controllers: [CustomerWalletController, CustomerWalletAdminController],
  providers: [CustomerWalletService, CustomerWalletRepository],
  exports: [CustomerWalletService],
})
export class CustomerWalletModule {}
