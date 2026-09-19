import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { khoaGopKien, maPhieuBanGiao, ngayVN } from './packing.logic';
import { ShippingPackageEntity } from './shipping-package.entity';

/** Sinh mã kiện — cùng khuôn `PK-…` với kiện tạo lúc mua label. */
const genCode = (n: number): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i += 1) out += chars[Math.floor(Math.random() * chars.length)];

  return out;
};

export interface DonDongGoi {
  _id: string;
  productionId?: string;
  orderId?: string;
  factoryId?: string;
}

/**
 * KIỆN HÀNG ở công đoạn Đóng hàng — lấp GAP-25/26/27 của tài liệu chuyển đổi.
 *
 * Trước đây bản ghi kiện chỉ sinh lúc MUA VẬN ĐƠN và chỉ gom danh sách mã, nên
 * hệ không biết xưởng đã đóng cái gì, nặng bao nhiêu, ra khỏi kho lúc nào —
 * ba thứ mà hệ cũ có và là đầu vào bắt buộc để đối soát cước sau này.
 *
 * Ba việc ở đây, cố ý tách khỏi luồng mua label:
 *  1. Đóng hàng xong → tạo/ghép kiện theo mã đơn seller (`source: 'pack'`).
 *  2. Nhận cân + số đo thực tế do trạm nhập (tuỳ chọn, không chặn chuyền).
 *  3. Bàn giao: đóng dấu giờ xuất kho + cấp mã phiếu cho cả lô.
 *
 * KHÔNG được ném lỗi ngược lên luồng chuyển công đoạn: kiện là sổ sách, công
 * nhân đóng xong hàng rồi thì không thể vì lỗi ghi sổ mà bắt họ đóng lại.
 */
@Injectable()
export class PackingService {
  private readonly logger = new Logger(PackingService.name);

  constructor(
    @InjectModel(ShippingPackageEntity.name)
    private readonly packageModel: Model<ShippingPackageEntity>,
  ) {}

  /**
   * Ghi nhận một item vừa đóng gói xong vào kiện của đơn.
   *
   * Idempotent theo hai chiều: item thứ hai của cùng đơn ghép vào kiện đã có
   * (`$addToSet`), và quét lại cùng một item không đẻ kiện mới. Kiện đã sinh
   * sẵn từ lúc mua label cũng được dùng lại — chỉ bổ sung mốc đóng gói, giữ
   * nguyên `source: 'label'` để biết nó ra đời ở đâu.
   */
  async ghiNhanDongGoi(don: DonDongGoi, nguoi?: { _id?: string; fullName?: string }): Promise<void> {
    const khoa = khoaGopKien(don);
    if (!khoa) return;

    try {
      await this.packageModel.updateOne(
        { orderId: khoa, factoryId: don.factoryId || undefined },
        {
          $setOnInsert: {
            code: `PK-${genCode(10)}`,
            orderId: khoa,
            factoryId: don.factoryId || undefined,
            source: 'pack',
            createdAt: new Date(),
          },
          $set: {
            packedAt: new Date(),
            ...(nguoi?._id ? { packedByUserId: String(nguoi._id) } : {}),
            ...(nguoi?.fullName ? { packedByUserName: nguoi.fullName } : {}),
          },
          $addToSet: {
            productionOrderIds: String(don._id),
            ...(don.productionId ? { productionIds: don.productionId } : {}),
            ...(don.orderId?.trim() ? { orderCodes: don.orderId.trim() } : {}),
          },
        },
        { upsert: true },
      );
    } catch (e) {
      // Ghi sổ hỏng không được chặn chuyền — xem đầu lớp.
      this.logger.warn(`[packing] không ghi được kiện cho ${don.productionId ?? don._id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Kiện đã đóng gói, theo xưởng — mặc định chỉ lấy kiện CHƯA bàn giao.
   *
   * Sắp theo mốc đóng gói tăng dần: kiện nằm kho lâu nhất lên đầu, vì đó là
   * kiện dễ bị bỏ quên nhất khi xe tới.
   */
  async danhSachKien(loc: { factoryId?: string; daBanGiao?: boolean; limit?: number }): Promise<Record<string, unknown>[]> {
    const filter: Record<string, unknown> = { packedAt: { $exists: true } };
    if (loc.factoryId) filter.factoryId = loc.factoryId;
    filter.handoverAt = loc.daBanGiao ? { $exists: true } : { $exists: false };

    return this.packageModel
      .find(filter)
      .sort({ packedAt: 1 })
      .limit(Math.min(loc.limit ?? 200, 500))
      .lean() as unknown as Promise<Record<string, unknown>[]>;
  }

  /**
   * Bàn giao một lô kiện cho hãng: cấp MỘT mã phiếu cho cả lô rồi đóng dấu giờ
   * xuất kho.
   *
   * Số thứ tự phiếu đếm theo (xưởng, ngày VN) bằng cách đếm mã phiếu ĐÃ CÓ
   * trong ngày — không dùng bộ đếm riêng, vì phiếu bàn giao hỏng thì in lại
   * chứ không ai truy vết số nhảy cóc. Kiện đã bàn giao rồi bị loại khỏi lượt
   * này: đóng dấu đè sẽ xoá mất giờ xuất kho thật của chuyến trước.
   */
  async banGiao(
    ids: string[],
    thongTin: { factoryId?: string; carrier?: string },
    nguoi?: { _id?: string },
  ): Promise<{ handoverCode: string; count: number; skipped: number }> {
    const luc = new Date();
    // Tên ngắn xưởng đọc THẲNG bảng `factories` qua connection sẵn có — mã
    // phiếu chỉ cần hai ba chữ cái, không đáng kéo cả FactoryModule vào đây.
    const xuong = thongTin.factoryId
      ? ((await this.packageModel.db
          .collection('factories')
          .findOne({ _id: thongTin.factoryId as never }, { projection: { shortName: 1 } })) as { shortName?: string } | null)
      : null;
    const factoryShortName = xuong?.shortName;
    const tienTo = `BG-${(factoryShortName ?? 'NA').trim().toUpperCase() || 'NA'}-${ngayVN(luc)}-`;
    const daCo = await this.packageModel.distinct('handoverCode', { handoverCode: { $regex: `^${tienTo}` } });
    const handoverCode = maPhieuBanGiao(factoryShortName, luc, daCo.length + 1);

    const r = await this.packageModel.updateMany(
      { _id: { $in: ids }, handoverAt: { $exists: false } },
      {
        $set: {
          handoverAt: luc,
          handoverCode,
          ...(nguoi?._id ? { handoverByUserId: String(nguoi._id) } : {}),
          ...(thongTin.carrier ? { handoverCarrier: thongTin.carrier } : {}),
        },
      },
    );

    return { handoverCode, count: r.modifiedCount, skipped: ids.length - r.modifiedCount };
  }

  /**
   * Nhập cân + số đo thực tế cho kiện của một đơn.
   *
   * Nhận `productionOrderId` (id của item vừa quét) chứ không nhận id kiện:
   * công nhân ở trạm chỉ cầm con tem của item, không biết mã kiện. Không tìm
   * thấy kiện thì im lặng bỏ qua — đơn chưa đóng gói xong thì chưa có gì để cân.
   */
  async capNhatCan(
    productionOrderId: string,
    so: { weightGram?: number; dimensions?: { width?: number; height?: number; length?: number } },
  ): Promise<void> {
    if (!so.weightGram && !so.dimensions) return;
    try {
      await this.packageModel.updateOne(
        { productionOrderIds: String(productionOrderId) },
        {
          $set: {
            ...(so.weightGram ? { weightGram: so.weightGram } : {}),
            ...(so.dimensions ? { dimensions: so.dimensions } : {}),
          },
        },
      );
    } catch (e) {
      this.logger.warn(`[packing] không ghi được cân cho ${productionOrderId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
