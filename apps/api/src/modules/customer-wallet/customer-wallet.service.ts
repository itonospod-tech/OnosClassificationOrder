import type { OnModuleInit } from '@nestjs/common';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import type {
  AdminWalletRow,
  AdminWalletTxnRow,
  CreditLimitChange,
  CustomerWalletTxn,
  GetAdminWalletsDto,
  GetAdminWalletTxnsDto,
  GetCreditLimitHistoryDto,
  GetCustomerWalletTxnsDto,
  WalletTxnKind,
} from 'shared';

import { CustomerEntity } from '@/modules/customer/customer.entity';

import type { CustomerCreditLimitChangeDocument } from './customer-credit-limit-change.entity';
import { CustomerCreditLimitChangeEntity } from './customer-credit-limit-change.entity';
import type { CustomerWalletTransactionDocument, WalletTxnRefs } from './customer-wallet-transaction.entity';
import {
  CustomerWalletTransactionEntity,
  WALLET_TXN_EXTERNAL_TXN_ID_INDEX,
  WALLET_TXN_REQUEST_ID_INDEX,
} from './customer-wallet-transaction.entity';
import { checkWalletGuard, round2 } from './wallet-guard';
import { buildAdminTxnFilter } from './wallet-txn-filter';

// Module-level so specs that build the service with Object.create() (skipping field initialisers) still log.
const walletLogger = new Logger('CustomerWallet');

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
  /**
   * Staff money operations set this. A retry with the same `requestId` is a harmless replay only if it
   * asks for the SAME amount; a different amount means the client reused a key for another operation,
   * and silently returning the old row would hide that bug, so it is rejected with 409 instead.
   * Off by default: label purchases legitimately re-quote a price between retries.
   */
  strictReplay?: boolean;
}

/** `replayed` is true when this `requestId` had already been applied and nothing was written this time. */
export type AppliedWalletTransaction = CustomerWalletTxn & { replayed?: boolean };

/**
 * Ví seller — MỌI biến động tiền đi qua đúng 1 hàm `applyTransaction()`:
 * transaction Mongo (replica set bắt buộc sẵn của dự án) gói [kiểm hạn mức →
 * insert record sổ cái có before/after → cập nhật cache walletBalance] nên số
 * dư không bao giờ lệch sổ. Idempotency 2 lớp qua `refs.requestId`: pre-check
 * trong transaction + unique index (customerId, kind, requestId) đỡ race.
 * Plan: `documents/Plans/SellerWallet-LabelPurchase.md`.
 */
@Injectable()
export class CustomerWalletService implements OnModuleInit {
  constructor(
    @InjectModel(CustomerWalletTransactionEntity.name)
    private readonly txnModel: Model<CustomerWalletTransactionEntity>,
    @InjectModel(CustomerEntity.name)
    private readonly customerModel: Model<CustomerEntity>,
    @InjectModel(CustomerCreditLimitChangeEntity.name)
    private readonly creditLimitChangeModel: Model<CustomerCreditLimitChangeEntity>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Boot hook: assert the money-safety indexes. Not awaited, so an index build cannot block startup. */
  onModuleInit(): void {
    void this.ensureIndexes();
  }

  /**
   * Create the two unique indexes the wallet's double-spend protection stands on. Explicit because
   * autoIndex builds in the background and swallows errors: if one of these were missing, nobody would
   * know until a retry credited twice. Failures reach the log; the promise never rejects.
   */
  async ensureIndexes(): Promise<void> {
    for (const index of [WALLET_TXN_REQUEST_ID_INDEX, WALLET_TXN_EXTERNAL_TXN_ID_INDEX]) {
      try {
        await this.txnModel.collection.createIndex(
          index.keys as Record<string, 1>,
          index.options as Record<string, unknown>,
        );
      } catch (err) {
        walletLogger.error(
          `customer_wallet_transactions index ${JSON.stringify(index.keys)} build failed: ${(err as Error).message?.slice(0, 1000)}`,
        );
      }
    }
  }

  /** A row that already holds this bank reference, unless it is the very operation being retried. */
  private async findExternalTxnConflict(input: ApplyTransactionInput): Promise<CustomerWalletTransactionDocument | null> {
    const externalTxnId = input.refs?.externalTxnId;
    if (input.kind !== 'topup' || !externalTxnId) return null;
    const existing = await this.txnModel.findOne({ kind: 'topup', 'refs.externalTxnId': externalTxnId });
    if (!existing) return null;
    const isSameOperation =
      String(existing.customerId) === input.customerId &&
      !!input.refs?.requestId &&
      existing.refs?.requestId === input.refs.requestId;
    return isSameOperation ? null : existing;
  }

  /** Tell the operator what to do next, not just that it is a duplicate. */
  private async externalTxnConflict(existing: CustomerWalletTransactionDocument): Promise<ConflictException> {
    const seller = await this.customerModel.findById(existing.customerId).select('userSku fullName');
    const who = seller?.userSku || String(existing.customerId);
    const when = existing.createdAt
      ? new Date(existing.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
      : '';
    return new ConflictException(
      `Mã giao dịch "${existing.refs?.externalTxnId}" đã được nạp cho ${who}${when ? ` lúc ${when}` : ''}. ` +
        'Nếu cần sửa số dư thì dùng Điều chỉnh.',
    );
  }

  private assertSameAmount(existing: CustomerWalletTransactionDocument, amount: number, strict?: boolean): void {
    if (strict && round2(existing.amount) !== amount) {
      throw new ConflictException(
        'requestId đã được dùng cho một giao dịch khác (số tiền khác). Mở lại hộp thoại để tạo yêu cầu mới.',
      );
    }
  }

  async applyTransaction(input: ApplyTransactionInput): Promise<AppliedWalletTransaction> {
    const amount = round2(input.amount);
    if (!amount) throw new BadRequestException('amount phải khác 0.');

    // Friendly pre-check; the unique index below is what actually guarantees it under a race.
    const duplicateReference = await this.findExternalTxnConflict(input);
    if (duplicateReference) throw await this.externalTxnConflict(duplicateReference);

    const session = await this.connection.startSession();
    try {
      let result: CustomerWalletTransactionDocument | null = null;
      let replayed = false;
      // withTransaction tự retry TransientTransactionError (write conflict khi
      // 2 giao dịch cùng khách chạy song song) — vòng sau đọc lại balance mới.
      await session.withTransaction(async () => {
        replayed = false; // the callback can run again on a transient error
        if (input.refs?.requestId) {
          const existing = await this.txnModel
            .findOne({ customerId: input.customerId, kind: input.kind, 'refs.requestId': input.refs.requestId })
            .session(session);
          if (existing) {
            // Retry cùng requestId → trả record cũ, KHÔNG động tiền lần 2.
            this.assertSameAmount(existing, amount, input.strictReplay);
            result = existing;
            replayed = true;
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
      return replayed ? { ...this.toTxn(result), replayed: true } : this.toTxn(result);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Race 2 request cùng requestId lọt qua pre-check: 1 commit, 1 dính
        // E11000 từ unique index — trả record thắng cuộc thay vì ném lỗi
        // (đường sống cho FE retry, không trừ tiền lần 2).
        if (input.refs?.requestId) {
          const existing = await this.txnModel.findOne({
            customerId: input.customerId,
            kind: input.kind,
            'refs.requestId': input.refs.requestId,
          });
          if (existing) {
            this.assertSameAmount(existing, amount, input.strictReplay);
            return { ...this.toTxn(existing), replayed: true };
          }
        }
        // Not our requestId, so the other unique index fired: the bank reference was credited
        // by a different operation that won the race.
        const duplicateRef = await this.findExternalTxnConflict(input);
        if (duplicateRef) throw await this.externalTxnConflict(duplicateRef);
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

  /**
   * Set a seller's credit limit and record the change. The value and its audit row are written in ONE
   * transaction, so a limit can never change without a trace (nor a trace exist for a change that did not
   * happen), and `from` is read inside the same snapshot as the write. Setting the value it already has is
   * a no-op: no write, no audit row.
   */
  async updateCreditLimit(
    customerId: string,
    creditLimit: number,
    by?: { userId?: string; userName?: string },
    note?: string,
  ): Promise<{ balance: number; creditLimit: number }> {
    const session = await this.connection.startSession();
    try {
      let balance = 0;
      let current = 0;
      await session.withTransaction(async () => {
        const customer = await this.customerModel.findById(customerId).session(session);
        if (!customer || customer.deletedAt) throw new NotFoundException('Không tìm thấy seller.');
        const from = customer.creditLimit ?? 0;
        balance = round2(customer.walletBalance ?? 0);
        current = creditLimit;
        if (from === creditLimit) return;
        await this.customerModel.updateOne({ _id: customerId }, { $set: { creditLimit } }, { session });
        await this.creditLimitChangeModel.create(
          [{ customerId, from, to: creditLimit, note: note?.trim() || undefined, byUserId: by?.userId, byUserName: by?.userName }],
          { session },
        );
      });
      return { balance, creditLimit: current };
    } finally {
      await session.endSession();
    }
  }

  /** The audit trail of a seller's credit limit, newest change first. */
  async listCreditLimitHistory(
    customerId: string,
    dto: GetCreditLimitHistoryDto,
  ): Promise<{ data: CreditLimitChange[]; total: number }> {
    const [docs, total] = await Promise.all([
      this.creditLimitChangeModel
        .find({ customerId })
        .sort({ createdAt: -1 })
        .skip((dto.page - 1) * dto.limit)
        .limit(dto.limit),
      this.creditLimitChangeModel.countDocuments({ customerId }),
    ]);
    return { data: docs.map((d) => this.toCreditLimitChange(d)), total };
  }

  private toCreditLimitChange(doc: CustomerCreditLimitChangeDocument): CreditLimitChange {
    return {
      _id: String(doc._id),
      customerId: String(doc.customerId),
      from: doc.from,
      to: doc.to,
      note: doc.note || undefined,
      byUserId: doc.byUserId || undefined,
      byUserName: doc.byUserName || undefined,
      createdAt: doc.createdAt,
    };
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
