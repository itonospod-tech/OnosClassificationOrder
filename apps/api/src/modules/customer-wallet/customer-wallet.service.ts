import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import type {
  AdminWalletRow,
  AdminWalletTxnRow,
  CustomerWalletTxn,
  GetAdminWalletsDto,
  GetAdminWalletTxnsDto,
  GetCustomerWalletTxnsDto,
  WalletTxnKind,
} from 'shared';

import { CustomerEntity } from '@/modules/customer/customer.entity';

import type { CustomerWalletTransactionDocument, WalletTxnRefs } from './customer-wallet-transaction.entity';
import { CustomerWalletTransactionEntity } from './customer-wallet-transaction.entity';
import { checkWalletGuard, round2 } from './wallet-guard';
import { buildAdminTxnFilter } from './wallet-txn-filter';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** Ném khi ví + hạn mức không đủ — caller (seller-shipping) dịch thành mã an toàn. */
export class WalletInsufficientFundsException extends BadRequestException {
  constructor() {
    super('Số dư ví không đủ.');
  }
}

export interface ApplyTransactionInput {
  customerId: string;
  kind: WalletTxnKind;
  /** Dương = cộng, âm = trừ (USD). */
  amount: number;
  note?: string;
  by?: { userId?: string; userName?: string };
  refs?: WalletTxnRefs;
}

/**
 * Ví seller — MỌI biến động tiền đi qua đúng 1 hàm `applyTransaction()`:
 * transaction Mongo (replica set bắt buộc sẵn của dự án) gói [kiểm hạn mức →
 * insert record sổ cái có before/after → cập nhật cache walletBalance] nên số
 * dư không bao giờ lệch sổ. Idempotency 2 lớp qua `refs.requestId`: pre-check
 * trong transaction + unique index (customerId, kind, requestId) đỡ race.
 * Plan: `documents/Plans/SellerWallet-LabelPurchase.md`.
 */
@Injectable()
export class CustomerWalletService {
  constructor(
    @InjectModel(CustomerWalletTransactionEntity.name)
    private readonly txnModel: Model<CustomerWalletTransactionEntity>,
    @InjectModel(CustomerEntity.name)
    private readonly customerModel: Model<CustomerEntity>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async applyTransaction(input: ApplyTransactionInput): Promise<CustomerWalletTxn> {
    const amount = round2(input.amount);
    if (!amount) throw new BadRequestException('amount phải khác 0.');

    const session = await this.connection.startSession();
    try {
      let result: CustomerWalletTransactionDocument | null = null;
      // withTransaction tự retry TransientTransactionError (write conflict khi
      // 2 giao dịch cùng khách chạy song song) — vòng sau đọc lại balance mới.
      await session.withTransaction(async () => {
        if (input.refs?.requestId) {
          const existing = await this.txnModel
            .findOne({ customerId: input.customerId, kind: input.kind, 'refs.requestId': input.refs.requestId })
            .session(session);
          if (existing) {
            // Retry cùng requestId → trả record cũ, KHÔNG động tiền lần 2.
            result = existing;
            return;
          }
        }

        const customer = await this.customerModel.findById(input.customerId).session(session);
        if (!customer || customer.deletedAt) throw new NotFoundException('Không tìm thấy seller.');

        const guard = checkWalletGuard(customer.walletBalance, customer.creditLimit, amount);
        if (!guard.ok) throw new WalletInsufficientFundsException();

        const [doc] = await this.txnModel.create(
          [
            {
              customerId: input.customerId,
              kind: input.kind,
              amount,
              balanceBefore: guard.balanceBefore,
              balanceAfter: guard.balanceAfter,
              note: input.note,
              byUserId: input.by?.userId,
              byUserName: input.by?.userName,
              refs: input.refs,
            },
          ],
          { session },
        );
        await this.customerModel.updateOne(
          { _id: input.customerId },
          { $set: { walletBalance: guard.balanceAfter } },
          { session },
        );
        result = doc;
      });
      if (!result) throw new BadRequestException('Giao dịch ví không ghi được.');
      return this.toTxn(result);
    } catch (err) {
      // Race 2 request cùng requestId lọt qua pre-check: 1 commit, 1 dính
      // E11000 từ unique index — trả record thắng cuộc thay vì ném lỗi
      // (đường sống cho FE retry, không trừ tiền lần 2).
      if (input.refs?.requestId && isDuplicateKeyError(err)) {
        const existing = await this.txnModel.findOne({
          customerId: input.customerId,
          kind: input.kind,
          'refs.requestId': input.refs.requestId,
        });
        if (existing) return this.toTxn(existing);
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async getWallet(customerId: string): Promise<{ balance: number; creditLimit: number; currency: 'USD' }> {
    const customer = await this.customerModel.findById(customerId).select('walletBalance creditLimit');
    if (!customer) throw new NotFoundException('Không tìm thấy seller.');
    return { balance: round2(customer.walletBalance ?? 0), creditLimit: customer.creditLimit ?? 0, currency: 'USD' };
  }

  async listTransactions(
    customerId: string,
    dto: GetCustomerWalletTxnsDto,
  ): Promise<{ data: CustomerWalletTxn[]; total: number }> {
    const filter: Record<string, unknown> = { customerId };
    if (dto.kind) filter.kind = dto.kind;
    const [docs, total] = await Promise.all([
      this.txnModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((dto.page - 1) * dto.limit)
        .limit(dto.limit),
      this.txnModel.countDocuments(filter),
    ]);
    return { data: docs.map((d) => this.toTxn(d)), total };
  }

  /**
   * Staff view of the ledger across ALL sellers (legacy Billing › Transactions). Newest first.
   * Resolves `dto.search` to seller ids first. ponytail: the search is capped at 1000 matching sellers.
   */
  async listAllTransactions(dto: GetAdminWalletTxnsDto): Promise<{ data: AdminWalletTxnRow[]; total: number }> {
    let searchIds: string[] | undefined;
    if (dto.search?.trim()) {
      const rx = new RegExp(dto.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const found = await this.customerModel
        .find({ $or: [{ userSku: rx }, { userEmail: rx }, { fullName: rx }] })
        .select('_id')
        .limit(1000);
      searchIds = found.map((c) => String(c._id));
    }
    const filter = buildAdminTxnFilter(dto, searchIds);
    if (!filter) return { data: [], total: 0 };

    const [docs, total] = await Promise.all([
      this.txnModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((dto.page - 1) * dto.limit)
        .limit(dto.limit),
      this.txnModel.countDocuments(filter),
    ]);

    const customerIds = [...new Set(docs.map((d) => String(d.customerId)))];
    const orderIds = [...new Set(docs.flatMap((d) => d.refs?.orderIds ?? []))];
    const [customers, orders] = await Promise.all([
      this.customerModel.find({ _id: { $in: customerIds } }).select('userSku userEmail fullName'),
      orderIds.length
        ? this.txnModel.db
            .collection<{ _id: string; productionId?: string }>('orders')
            .find({ _id: { $in: orderIds } }, { projection: { productionId: 1 } })
            .toArray()
        : Promise.resolve([]),
    ]);
    const customerById = new Map(customers.map((c) => [String(c._id), c]));
    const productionIdByOrder = new Map(orders.map((o) => [String(o._id), o.productionId]));

    return {
      data: docs.map((d) => {
        const seller = customerById.get(String(d.customerId));
        return {
          ...this.toTxn(d),
          userSku: seller?.userSku ?? '',
          userEmail: seller?.userEmail ?? '',
          fullName: seller?.fullName || undefined,
          productionIds: (d.refs?.orderIds ?? [])
            .map((id) => productionIdByOrder.get(id))
            .filter((v): v is string => !!v),
        };
      }),
      total,
    };
  }

  async listWallets(dto: GetAdminWalletsDto): Promise<{ data: AdminWalletRow[]; total: number }> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (dto.search?.trim()) {
      const rx = new RegExp(dto.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ userSku: rx }, { userEmail: rx }, { fullName: rx }];
    }
    if (dto.activeOnly) {
      filter.$and = [{ $or: [{ walletBalance: { $ne: 0 } }, { creditLimit: { $gt: 0 } }] }];
    }
    const [customers, total] = await Promise.all([
      this.customerModel
        .find(filter)
        .select('userSku userEmail fullName tier walletBalance creditLimit')
        .sort({ walletBalance: -1, userSku: 1 })
        .skip((dto.page - 1) * dto.limit)
        .limit(dto.limit),
      this.customerModel.countDocuments(filter),
    ]);
    const ids = customers.map((c) => String(c._id));
    const lastTxns = await this.txnModel.aggregate<{ _id: string; lastTxnAt: Date }>([
      { $match: { customerId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$customerId', lastTxnAt: { $first: '$createdAt' } } },
    ]);
    const lastMap = new Map(lastTxns.map((t) => [t._id, t.lastTxnAt]));
    return {
      data: customers.map((c) => ({
        customerId: String(c._id),
        userSku: c.userSku,
        userEmail: c.userEmail,
        fullName: c.fullName || undefined,
        tier: c.tier,
        balance: round2(c.walletBalance ?? 0),
        creditLimit: c.creditLimit ?? 0,
        lastTxnAt: lastMap.get(String(c._id)) ?? null,
      })),
      total,
    };
  }

  async updateCreditLimit(customerId: string, creditLimit: number): Promise<{ balance: number; creditLimit: number }> {
    const customer = await this.customerModel.findByIdAndUpdate(customerId, { $set: { creditLimit } }, { new: true });
    if (!customer) throw new NotFoundException('Không tìm thấy seller.');
    return { balance: round2(customer.walletBalance ?? 0), creditLimit: customer.creditLimit };
  }

  private toTxn(doc: CustomerWalletTransactionDocument): CustomerWalletTxn {
    return {
      _id: String(doc._id),
      customerId: String(doc.customerId),
      kind: doc.kind,
      amount: doc.amount,
      balanceBefore: doc.balanceBefore,
      balanceAfter: doc.balanceAfter,
      note: doc.note || undefined,
      byUserId: doc.byUserId || undefined,
      byUserName: doc.byUserName || undefined,
      refs: doc.refs,
      createdAt: doc.createdAt,
    };
  }
}
