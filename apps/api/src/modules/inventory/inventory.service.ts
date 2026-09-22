import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import type {
  AdjustInventoryDto,
  CreateReceiptInDto,
  GetInventoryItemsDto,
  GetInventoryReceiptsDto,
  GetInventoryTxnsDto,
  InventoryItem,
  InventoryReceipt,
  InventoryTxn,
  InventoryTxnKind,
  ReconcileRow,
  ScanOutDto,
  ScanOutPreview,
} from 'shared';

import { FactoryEntity } from '@/modules/factory/factory.entity';
import { OrderEntity } from '@/modules/order/order.entity';
import { ProductConfigEntity } from '@/modules/product-config/product-config.entity';

import {
  buildReceiptCode,
  buildReconcileOrderFilter,
  buildScanOutRequestId,
  resolveInventorySku,
  vnDayRange,
} from './inventory.logic';
import type { InventoryItemDocument } from './inventory-item.entity';
import { InventoryItemEntity } from './inventory-item.entity';
import type { InventoryReceiptDocument } from './inventory-receipt.entity';
import { InventoryReceiptEntity } from './inventory-receipt.entity';
import type { InventoryTransactionDocument, InventoryTxnRefs } from './inventory-transaction.entity';
import { InventoryTransactionEntity } from './inventory-transaction.entity';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

interface ApplyInventoryTxnInput {
  factoryId: string;
  sku: string;
  kind: InventoryTxnKind;
  /** Dương = cộng tồn, âm = trừ. Bỏ qua khi có `setTo` (kiểm kê). */
  qty?: number;
  /** Kiểm kê: chốt tồn VỀ số này — service tự tính delta trong transaction. */
  setTo?: number;
  note?: string;
  by?: { userId?: string; userName?: string };
  refs?: InventoryTxnRefs;
  /** Tên item khi phải tạo mới (nhập kho khai tên). */
  itemName?: string;
  /** true = item tạo mới đánh dấu autoCreated (sinh từ quét, thủ kho cần rà). */
  markAutoCreated?: boolean;
}

/**
 * Tồn kho theo xưởng — MỌI biến động đi qua đúng 1 hàm `applyTransaction()`:
 * transaction Mongo gói [upsert item → insert record sổ cái có before/after →
 * cập nhật cache quantity] nên tồn không bao giờ lệch sổ. Idempotency 2 lớp
 * qua `refs.requestId` (pre-check + unique index đỡ race) — mirror nguyên
 * khuôn `CustomerWalletService`. Tồn ĐƯỢC PHÉP ÂM (không chặn chuyền).
 * Plan: `documents/Plans/Inventory-FactoryStock.md`.
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(InventoryItemEntity.name) private readonly itemModel: Model<InventoryItemEntity>,
    @InjectModel(InventoryTransactionEntity.name)
    private readonly txnModel: Model<InventoryTransactionEntity>,
    @InjectModel(InventoryReceiptEntity.name)
    private readonly receiptModel: Model<InventoryReceiptEntity>,
    @InjectModel(OrderEntity.name) private readonly orderModel: Model<OrderEntity>,
    @InjectModel(ProductConfigEntity.name)
    private readonly productConfigModel: Model<ProductConfigEntity>,
    @InjectModel(FactoryEntity.name) private readonly factoryModel: Model<FactoryEntity>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async applyTransaction(input: ApplyInventoryTxnInput): Promise<{ txn: InventoryTxn; duplicated: boolean } | null> {
    const sku = input.sku.trim().toUpperCase();
    if (!sku) throw new BadRequestException('SKU rỗng.');

    const session = await this.connection.startSession();
    try {
      let result: InventoryTransactionDocument | null = null;
      let duplicated = false;
      let unchanged = false;
      await session.withTransaction(async () => {
        const item = await this.itemModel.findOneAndUpdate(
          { factoryId: input.factoryId, sku },
          {
            $setOnInsert: {
              factoryId: input.factoryId,
              sku,
              name: input.itemName ?? sku,
              unit: 'cái',
              quantity: 0,
              autoCreated: input.markAutoCreated ?? false,
              status: 'active',
            },
          },
          { upsert: true, new: true, session },
        );

        if (input.refs?.requestId) {
          const existing = await this.txnModel
            .findOne({ itemId: String(item._id), kind: input.kind, 'refs.requestId': input.refs.requestId })
            .session(session);
          if (existing) {
            // Retry cùng requestId → trả record cũ, KHÔNG động tồn lần 2.
            result = existing;
            duplicated = true;
            return;
          }
        }

        const qty = input.setTo !== undefined ? input.setTo - item.quantity : (input.qty ?? 0);
        if (!qty) {
          // Kiểm kê ra đúng số hệ thống → không ghi sổ.
          unchanged = true;
          return;
        }

        const balanceBefore = item.quantity;
        const balanceAfter = balanceBefore + qty;
        const [doc] = await this.txnModel.create(
          [
            {
              factoryId: input.factoryId,
              itemId: String(item._id),
              sku,
              kind: input.kind,
              qty,
              balanceBefore,
              balanceAfter,
              note: input.note,
              byUserId: input.by?.userId,
              byUserName: input.by?.userName,
              refs: input.refs,
            },
          ],
          { session },
        );
        await this.itemModel.updateOne({ _id: item._id }, { $set: { quantity: balanceAfter } }, { session });
        result = doc;
      });
      if (unchanged) return null;
      if (!result) throw new BadRequestException('Giao dịch kho không ghi được.');
      return { txn: this.toTxn(result), duplicated };
    } catch (err) {
      // Race 2 request cùng requestId lọt qua pre-check: 1 commit, 1 dính
      // E11000 từ unique index — trả record thắng cuộc thay vì ném lỗi.
      if (input.refs?.requestId && isDuplicateKeyError(err)) {
        const item = await this.itemModel.findOne({ factoryId: input.factoryId, sku });
        const existing = item
          ? await this.txnModel.findOne({
              itemId: String(item._id),
              kind: input.kind,
              'refs.requestId': input.refs.requestId,
            })
          : null;
        if (existing) return { txn: this.toTxn(existing), duplicated: true };
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  // -------------------------------------------------------------------------
  // Nhập kho / kiểm kê
  // -------------------------------------------------------------------------

  async createReceiptIn(dto: CreateReceiptInDto, by: { userId?: string; userName?: string }): Promise<InventoryReceipt> {
    const factory = await this.factoryModel.findById(dto.factoryId).select('shortName');
    if (!factory) throw new NotFoundException('Không tìm thấy xưởng.');

    const receipt = await this.createReceiptWithCode('in', dto.factoryId, factory.shortName, dto.lines, by, dto.note);

    for (let i = 0; i < dto.lines.length; i += 1) {
      const line = dto.lines[i];
      await this.applyTransaction({
        factoryId: dto.factoryId,
        sku: line.sku,
        kind: 'in',
        qty: line.qty,
        note: line.note ?? dto.note,
        by,
        itemName: line.name,
        // 1 dòng phiếu = 1 requestId — POST retry không cộng đúp.
        refs: { requestId: `${receipt._id}#${i}`, receiptId: String(receipt._id) },
      });
    }
    return this.toReceipt(receipt);
  }

  async adjust(dto: AdjustInventoryDto, by: { userId?: string; userName?: string }): Promise<{ applied: number; unchanged: number }> {
    let applied = 0;
    let unchanged = 0;
    for (const line of dto.lines) {
      const r = await this.applyTransaction({
        factoryId: dto.factoryId,
        sku: line.sku,
        kind: 'adjust',
        setTo: line.counted,
        note: line.note ?? dto.note,
        by,
      });
      if (r) applied += 1;
      else unchanged += 1;
    }
    return { applied, unchanged };
  }

  // -------------------------------------------------------------------------
  // Quét xuất kho theo đơn
  // -------------------------------------------------------------------------

  async getScanOutPreview(productionId: string): Promise<ScanOutPreview> {
    const { order, sku, resolvedBy } = await this.resolveOrderSku(productionId);
    const factory = order.factoryId
      ? await this.factoryModel.findById(order.factoryId).select('autoStockOut')
      : null;
    const [deductedTimes, lastTxn, item] = await Promise.all([
      this.txnModel.countDocuments({ kind: 'out', 'refs.productionId': order.productionId }),
      this.txnModel.findOne({ kind: 'out', 'refs.productionId': order.productionId }).sort({ createdAt: -1 }),
      sku && order.factoryId ? this.itemModel.findOne({ factoryId: order.factoryId, sku }) : null,
    ]);

    return {
      productionId: order.productionId,
      orderId: String(order._id),
      factoryId: order.factoryId ?? null,
      sku,
      resolvedBy,
      qty: order.quantity || 1,
      currentQuantity: item ? item.quantity : null,
      deductedTimes,
      lastDeductedAt: (lastTxn)?.createdAt ?? null,
      autoStockOut: factory?.autoStockOut ?? false,
    };
  }

  async scanOut(dto: ScanOutDto, by: { userId?: string; userName?: string }): Promise<{ txn: InventoryTxn; duplicated: boolean }> {
    const { order, sku: resolvedSku } = await this.resolveOrderSku(dto.productionId);
    if (!order.factoryId) throw new BadRequestException('Đơn chưa map xưởng — không biết trừ kho nào.');
    const sku = dto.skuOverride?.trim() || resolvedSku;
    if (!sku) throw new BadRequestException('Không suy được SKU kho từ đơn — chọn SKU tay (skuOverride).');

    const deductedTimes = await this.txnModel.countDocuments({
      kind: 'out',
      'refs.productionId': order.productionId,
    });

    if (dto.reason !== 'rework' && deductedTimes > 0) {
      // Guard: đơn đã trừ rồi mà không chủ đích rework → trả lượt cũ, không trừ thêm
      // (đường auto-label/đối soát gọi lặp đi vào đây).
      const existing = await this.txnModel
        .findOne({ kind: 'out', 'refs.productionId': order.productionId })
        .sort({ createdAt: -1 });
      if (existing) return { txn: this.toTxn(existing), duplicated: true };
    }

    const attempt = deductedTimes + 1;
    const result = await this.applyTransaction({
      factoryId: order.factoryId,
      sku,
      kind: 'out',
      qty: -(order.quantity || 1),
      note: dto.note,
      by,
      markAutoCreated: true,
      refs: {
        requestId: buildScanOutRequestId(order.productionId, attempt),
        productionId: order.productionId,
        orderId: String(order._id),
        source: dto.source,
        rework: attempt > 1,
      },
    });
    if (!result) throw new BadRequestException('Giao dịch kho không ghi được.');
    return result;
  }

  // -------------------------------------------------------------------------
  // Đối soát ngày
  // -------------------------------------------------------------------------

  async reconcilePreview(factoryId: string, date: string): Promise<ReconcileRow[]> {
    const orders = await this.orderModel
      .find(buildReconcileOrderFilter(factoryId, date))
      .select('productionId productConfigId type size quantity fulfillmentStages.print.completedAt')
      .limit(2000)
      .lean();
    if (orders.length === 0) return [];

    const deducted = new Set(
      await this.txnModel.distinct('refs.productionId', {
        kind: 'out',
        'refs.productionId': { $in: orders.map((o) => o.productionId) },
      }),
    );

    const configIds = [...new Set(orders.map((o) => o.productConfigId).filter(Boolean))] as string[];
    const configs = await this.productConfigModel
      .find({ _id: { $in: configIds } })
      .select('variations.sku')
      .lean();
    const variationsByConfig = new Map(
      configs.map((c) => [String(c._id), (c.variations ?? []).map((v) => v.sku).filter(Boolean)]),
    );

    return orders
      .filter((o) => !deducted.has(o.productionId))
      .map((o) => ({
        productionId: o.productionId,
        orderId: String(o._id),
        sku: resolveInventorySku(o, variationsByConfig.get(String(o.productConfigId)) ?? []).sku,
        qty: o.quantity || 1,
        printCompletedAt: o.fulfillmentStages?.print?.completedAt ?? null,
      }));
  }

  async reconcileApply(
    factoryId: string,
    date: string,
    by: { userId?: string; userName?: string },
  ): Promise<{ applied: number; skipped: number }> {
    const rows = await this.reconcilePreview(factoryId, date);
    let applied = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.sku) {
        skipped += 1;
        continue;
      }
      const r = await this.scanOut(
        { productionId: row.productionId, reason: 'normal', source: 'reconcile' },
        by,
      );
      if (r.duplicated) skipped += 1;
      else applied += 1;
    }
    return { applied, skipped };
  }

  // -------------------------------------------------------------------------
  // List / update
  // -------------------------------------------------------------------------

  async listItems(dto: GetInventoryItemsDto): Promise<{ data: InventoryItem[]; total: number }> {
    const filter: Record<string, unknown> = { factoryId: dto.factoryId };
    if (dto.negativeOnly) filter.quantity = { $lt: 0 };
    if (dto.search?.trim()) {
      const rx = new RegExp(dto.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ sku: rx }, { name: rx }];
    }
    const [docs, total] = await Promise.all([
      this.itemModel
        .find(filter)
        .sort({ sku: 1 })
        .skip((dto.page - 1) * dto.limit)
        .limit(dto.limit),
      this.itemModel.countDocuments(filter),
    ]);
    return { data: docs.map((d) => this.toItem(d)), total };
  }

  async updateItem(id: string, patch: Partial<Pick<InventoryItemEntity, 'name' | 'unit' | 'status' | 'autoCreated'>>): Promise<InventoryItem> {
    const doc = await this.itemModel.findByIdAndUpdate(id, { $set: patch }, { new: true });
    if (!doc) throw new NotFoundException('Không tìm thấy mặt hàng.');
    return this.toItem(doc);
  }

  async listTransactions(dto: GetInventoryTxnsDto): Promise<{ data: InventoryTxn[]; total: number }> {
    const filter: Record<string, unknown> = { factoryId: dto.factoryId };
    if (dto.kind) filter.kind = dto.kind;
    if (dto.sku?.trim()) filter.sku = dto.sku.trim().toUpperCase();
    if (dto.productionId?.trim()) filter['refs.productionId'] = dto.productionId.trim();
    if (dto.from || dto.to) {
      filter.createdAt = {
        ...(dto.from ? { $gte: dto.from } : {}),
        ...(dto.to ? { $lte: dto.to } : {}),
      };
    }
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

  async listReceipts(dto: GetInventoryReceiptsDto): Promise<{ data: InventoryReceipt[]; total: number }> {
    const filter: Record<string, unknown> = { factoryId: dto.factoryId };
    if (dto.type) filter.type = dto.type;
    const [docs, total] = await Promise.all([
      this.receiptModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((dto.page - 1) * dto.limit)
        .limit(dto.limit),
      this.receiptModel.countDocuments(filter),
    ]);
    return { data: docs.map((d) => this.toReceipt(d)), total };
  }

  async getReceipt(id: string): Promise<InventoryReceipt> {
    const doc = await this.receiptModel.findById(id);
    if (!doc) throw new NotFoundException('Không tìm thấy phiếu.');
    return this.toReceipt(doc);
  }

  /** Chốt phiếu XUẤT: gom mọi txn `out` chưa thuộc phiếu nào của xưởng trong ngày VN. */
  async closeOutReceipt(
    factoryId: string,
    date: string,
    by: { userId?: string; userName?: string },
  ): Promise<InventoryReceipt | null> {
    const { start, end } = vnDayRange(date);
    const txns = await this.txnModel.find({
      factoryId,
      kind: 'out',
      'refs.receiptId': { $exists: false },
      createdAt: { $gte: start, $lt: end },
    });
    if (txns.length === 0) return null;

    const factory = await this.factoryModel.findById(factoryId).select('shortName');
    const bySku = new Map<string, number>();
    for (const t of txns) bySku.set(t.sku, (bySku.get(t.sku) ?? 0) + Math.abs(t.qty));
    const lines = [...bySku.entries()].map(([sku, qty]) => ({ sku, qty }));

    const receipt = await this.createReceiptWithCode('out', factoryId, factory?.shortName, lines, by);
    // Gắn ngược receiptId — txn đã chốt phiếu không bị gom lần 2.
    await this.txnModel.updateMany(
      { _id: { $in: txns.map((t) => t._id) } },
      { $set: { 'refs.receiptId': String(receipt._id) } },
    );
    return this.toReceipt(receipt);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async resolveOrderSku(productionId: string) {
    const code = productionId.trim();
    const order = await this.orderModel
      .findOne({ productionId: code })
      .select('productionId factoryId productConfigId type size quantity');
    if (!order) throw new NotFoundException('Không tìm thấy đơn theo mã sản xuất.');

    const config = order.productConfigId
      ? await this.productConfigModel.findById(order.productConfigId).select('variations.sku')
      : null;
    const variationSkus = (config?.variations ?? []).map((v) => v.sku).filter(Boolean);
    const { sku, resolvedBy } = resolveInventorySku(order, variationSkus);
    return { order, sku, resolvedBy };
  }

  private async createReceiptWithCode(
    type: 'in' | 'out',
    factoryId: string,
    factoryShortName: string | undefined,
    lines: { sku: string; name?: string; qty: number; note?: string }[],
    by: { userId?: string; userName?: string },
    note?: string,
  ): Promise<InventoryReceiptDocument> {
    const now = new Date();
    const { start } = vnDayRange(
      new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10),
    );
    // Đánh số trong ngày — đụng unique code (2 người tạo cùng lúc) thì thử lại.
    for (let retry = 0; ; retry += 1) {
      const seq = (await this.receiptModel.countDocuments({ factoryId, type, createdAt: { $gte: start } })) + 1 + retry;
      try {
        return await this.receiptModel.create({
          code: buildReceiptCode(type, factoryShortName, now, seq),
          type,
          factoryId,
          lines: lines.map((l) => ({ ...l, sku: l.sku.trim().toUpperCase() })),
          byUserId: by.userId,
          byUserName: by.userName,
          note,
        });
      } catch (err) {
        if (retry < 3 && isDuplicateKeyError(err)) continue;
        throw err;
      }
    }
  }

  private toItem(doc: InventoryItemDocument): InventoryItem {
    return {
      _id: String(doc._id),
      factoryId: doc.factoryId,
      sku: doc.sku,
      name: doc.name,
      unit: doc.unit,
      quantity: doc.quantity,
      autoCreated: doc.autoCreated,
      status: doc.status,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private toTxn(doc: InventoryTransactionDocument): InventoryTxn {
    return {
      _id: String(doc._id),
      factoryId: doc.factoryId,
      itemId: doc.itemId,
      sku: doc.sku,
      kind: doc.kind,
      qty: doc.qty,
      balanceBefore: doc.balanceBefore,
      balanceAfter: doc.balanceAfter,
      note: doc.note ?? undefined,
      byUserId: doc.byUserId ?? undefined,
      byUserName: doc.byUserName ?? undefined,
      refs: doc.refs ?? undefined,
      createdAt: doc.createdAt,
    };
  }

  private toReceipt(doc: InventoryReceiptDocument): InventoryReceipt {
    return {
      _id: String(doc._id),
      code: doc.code,
      type: doc.type,
      factoryId: doc.factoryId,
      lines: doc.lines,
      byUserId: doc.byUserId ?? undefined,
      byUserName: doc.byUserName ?? undefined,
      note: doc.note ?? undefined,
      createdAt: doc.createdAt,
    };
  }
}
